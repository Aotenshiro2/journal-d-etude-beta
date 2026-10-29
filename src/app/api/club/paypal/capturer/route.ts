import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  alerterEquipeClub, capturerCommandePayPal, configPayPal, envoyerEmailClub, ErreurPayPal, lireCommandePayPal, poserAccesClub,
  prixClub,
} from '@/lib/academie/club-paypal'
import {
  estIdPayPal, etatCapture, lireCommande, montantConforme, noteAcces, texteAlerteEnAttente, type CommandeLue,
} from '@/lib/academie/club-paypal-pur'
import { emailConfirme } from '@/lib/academie/achat'
import { roleAcademie } from '@/lib/academie/droits'
import { estAdmin } from '@/lib/academie/pur'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { SQL_IDENTITE } from '@/lib/academie/requetes'
import { messageErreur } from '@/lib/liveclub/pur'
import { formaterEuros, prenomDe } from '@/lib/mails-achat-pur'

/**
 * POST /api/club/paypal/capturer : appelee par le onApprove des boutons PayPal
 * de /club, juste apres l'accord de l'acheteur (29/10/2026). Route PUBLIQUE :
 * rien n'est cru du corps, la commande est relue chez PayPal (nos commandes
 * seulement : reference_id club-10, custom_id pose par nous, montant attendu)
 * puis capturee cote serveur. Idempotente : une commande deja capturee rend
 * la meme reponse, l'acces n'est pose qu'une fois (index
 * academie_acces_paypal_reference_idx) et l'email ne part qu'a sa creation.
 *
 * Capture COMPLETED : acces formation-complete (source paypal, a vie, cote
 * brice, renonciation = create_time de la commande), puis l'email d'acces.
 * Capture PENDING : rien n'est ouvert, l'equipe est prevenue sur Telegram
 * (pas de webhook PayPal dans ce lot) ; rappeler cette route une fois le
 * paiement confirme ouvre l'acces.
 *
 * Corps : { order_id }, Bearer facultatif (seulement pour compte_lie).
 * 200 { ok, etat: 'ouvert', email, compte_lie } | { ok, etat: 'en_attente' }
 * 400 'corps' | 404 'commande' | 402 'refuse' (INSTRUMENT_DECLINED : la page
 * relance les boutons, l'acheteur choisit un autre moyen) | 402 'echoue'
 * (capture DECLINED ou FAILED, definitif) | 409 'non_approuve' | 'annule' |
 * 'rembourse' | 'montant' | 503 'config' | 'indisponible' | 502 'paypal'
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  let corps: Record<string, unknown>
  try { corps = (await req.json()) as Record<string, unknown> } catch { return refus('corps', 400) }
  const orderId = corps && typeof corps === 'object' ? corps.order_id : null
  if (!estIdPayPal(orderId)) return refus('corps', 400)

  const config = configPayPal()
  if (!config) return refus('config', 503)

  // 1. La commande, relue chez PayPal.
  let brute: Record<string, unknown>
  try {
    brute = await lireCommandePayPal(config, orderId)
  } catch (err) {
    if (err instanceof ErreurPayPal && err.statut === 404) return refus('commande', 404)
    if (err instanceof ErreurPayPal && (err.statut === 401 || err.statut === 403)) return refus('config', 503)
    console.warn(`[club/paypal/capturer] commande illisible : ${err instanceof ErreurPayPal ? err.message : messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  let lu = lireCommande(brute)
  if (!lu.ok) {
    console.warn(`[club/paypal/capturer] commande ${orderId} ignoree (${lu.raison})`)
    return refus('commande', 404)
  }

  // 2. Le montant : celui que la route commande a pose (1 EUR en essai, le prix sinon). Verifie AVANT de capturer.
  let prixBase: number | null = null
  if (!lu.commande.essai) {
    try { prixBase = await prixClub() } catch (err) {
      console.warn(`[club/paypal/capturer] base illisible : ${messageErreur(err)}`)
      return refus('indisponible', 503)
    }
  } else {
    // Une commande se cree aussi dans le navigateur avec le seul client id
    // public (actions.order.create du SDK) : reference_id club-10-essai et
    // 1 EUR ne prouvent rien. L'essai n'est capture que pour un compte admin.
    const titulaireEssai = lu.commande.titulaire.userId ?? null
    let admin = false
    if (titulaireEssai) {
      try { admin = estAdmin(await roleAcademie(titulaireEssai)) } catch (err) {
        console.warn(`[club/paypal/capturer] role illisible : ${messageErreur(err)}`)
        return refus('indisponible', 503)
      }
    }
    if (!admin) {
      console.warn(`[club/paypal/capturer] commande ${lu.commande.orderId} : essai hors compte admin, non capturee`)
      return refus('montant', 409)
    }
  }
  if (!montantConforme(lu.commande, prixBase)) {
    console.warn(`[club/paypal/capturer] commande ${lu.commande.orderId} : montant inattendu (${lu.commande.centimes} centimes ${lu.commande.devise}${lu.commande.essai ? ', essai' : ''}), non capturee`)
    return refus('montant', 409)
  }

  // 3. La capture, si elle n'est pas deja faite.
  let captureeIci = false
  const avant = etatCapture(lu.commande)
  if (avant === 'a_capturer') {
    try {
      const apres = lireCommande(await capturerCommandePayPal(config, lu.commande.orderId))
      // Reponse de capture incomplete : on relit la commande.
      lu = apres.ok && apres.commande.capture ? apres : lireCommande(await lireCommandePayPal(config, lu.commande.orderId))
      captureeIci = true
    } catch (err) {
      if (err instanceof ErreurPayPal && err.issue === 'INSTRUMENT_DECLINED') return refus('refuse', 402)
      if (err instanceof ErreurPayPal && (err.issue === 'ORDER_NOT_APPROVED' || err.issue === 'PAYER_ACTION_REQUIRED')) return refus('non_approuve', 409)
      if (err instanceof ErreurPayPal && (err.statut === 401 || err.statut === 403)) return refus('config', 503)
      console.warn(`[club/paypal/capturer] capture ${orderId} impossible : ${err instanceof ErreurPayPal ? err.message : messageErreur(err)}`)
      return refus('paypal', 502)
    }
    if (!lu.ok) return refus('commande', 404)
  }
  const c: CommandeLue = lu.commande
  const etat = etatCapture(c)

  if (etat === 'non_approuvee' || etat === 'a_capturer') return refus('non_approuve', 409)
  if (etat === 'annulee') return refus('annule', 409)
  if (etat === 'refusee') return refus('echoue', 402)
  if (etat === 'remboursee') return refus('rembourse', 409)

  // Le titulaire : le compte de custom_id (son email confirme), sinon l'email de custom_id.
  let email: string | null = c.titulaire.email ?? null
  const userId = c.titulaire.userId ?? null
  if (userId) {
    try { email = await emailConfirme(userId) } catch (err) {
      console.warn(`[club/paypal/capturer] email du compte illisible : ${messageErreur(err)}`)
      return refus('indisponible', 503)
    }
  }

  if (etat === 'en_attente' || !c.capture || etat === 'inconnu') {
    console.warn(`[club/paypal/capturer] capture EN ATTENTE commande=${c.orderId} capture=${c.capture?.id ?? 'aucune'} statut=${c.capture?.statut ?? c.statut}${c.essai ? ' essai' : ''}`)
    // Une alerte par capture faite ici (pas a chaque relecture d'une commande en attente).
    if (captureeIci && c.capture) {
      await alerterEquipeClub(texteAlerteEnAttente({ orderId: c.orderId, captureId: c.capture.id, centimes: c.centimes, essai: c.essai, email }))
    }
    return NextResponse.json({ ok: true, etat: 'en_attente' }, { headers })
  }

  // 4. Capture terminee : l'acces, une seule fois.
  const captureId = c.capture.id
  const montantEur = (c.capture.centimes ?? c.centimes) / 100
  let r: { offreConnue: boolean; cree: boolean }
  try {
    r = await poserAccesClub({
      userId, email, orderId: c.orderId, montantEur, captureId,
      renonciationLe: c.creeLe ?? new Date(),
      note: noteAcces({
        orderId: c.orderId, captureId, centimes: c.capture.centimes ?? c.centimes, essai: c.essai,
        renonciationLe: c.creeLe, payeurEmail: c.payeurEmail, email,
      }),
    })
  } catch (err) {
    console.warn(`[club/paypal/capturer] PAYE mais acces NON pose commande=${c.orderId} : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!r.offreConnue) {
    console.warn(`[club/paypal/capturer] PAYE mais offre formation-complete absente en base, commande=${c.orderId}`)
    return refus('indisponible', 503)
  }

  if (r.cree) {
    console.info(`[club/paypal/capturer] acces pose commande=${c.orderId} compte=${userId ? tronquer(userId) : 'email'} ${montantEur} EUR${c.essai ? ' essai' : ''}`)
    if (email) {
      const envoi = await envoyerEmailClub(email, c.essai, {
        montant: formaterEuros(c.capture.centimes ?? c.centimes),
        prenom: prenomDe(c.payeurPrenom),
      })
      if (!envoi.ok) console.warn(`[club/paypal/capturer] email d'acces NON envoye commande=${c.orderId} : ${envoi.erreur}`)
    } else {
      console.warn(`[club/paypal/capturer] acces pose sans email confirme (compte=${userId ? tronquer(userId) : '?'}) : pas d'email d'acces`)
    }
  }

  // Le compte connecte porte-t-il cet acces ? (meme regle que /api/academie/achat/confirmer)
  let compteLie = false
  try {
    const connecte = await compteDuJeton(req)
    if (connecte) {
      if (userId === connecte) compteLie = true
      else if (email) {
        const ident = (await prisma.$queryRawUnsafe<{ emails: string[] | null }[]>(SQL_IDENTITE, connecte))[0]
        compteLie = (ident?.emails ?? []).includes(email)
      }
    }
  } catch { /* compte illisible : la page proposera le lien de connexion */ }

  return NextResponse.json({ ok: true, etat: 'ouvert', email, compte_lie: compteLie }, { headers })
}
