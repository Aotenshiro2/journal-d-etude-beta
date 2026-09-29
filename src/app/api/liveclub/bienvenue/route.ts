import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { lienBot, nomBot } from '@/lib/liveclub/config'
import { lireSessionCheckout } from '@/lib/liveclub/stripe'
import { annulerReservationEmail } from '@/lib/liveclub/jetons'
import { emailBienvenue } from '@/lib/liveclub/emails'
import { genererJeton, messageErreur, relationAbsente } from '@/lib/liveclub/pur'
import { journaliserGesteLiveClub } from '@/lib/stripe-actions'

/**
 * POST /api/liveclub/bienvenue : la page apres paiement du Live Club
 * (aoknowledge.com/live-club/bienvenue, et sa copie sur le site de Melanie).
 * PUBLIQUE, sans compte : la preuve, c'est le session_id que Stripe met dans
 * l'URL de retour, verifie ici aupres de Stripe (compte melanie).
 *
 * Corps : { session_id: 'cs_live_...' | 'cs_test_...' }.
 * Reponse : { ok: true, lien_bot, prenom? } ou { ok: false, erreur }.
 *
 * Dans l'ordre : session du compte melanie (la cle de lecture de Melanie ne
 * voit pas les sessions d'un autre compte), produit Live Club, complete et
 * payee ; puis le jeton 'entree' de CET abonnement (reutilise s'il en existe
 * un valable, sinon cree : une page rechargee rend le meme lien) ; puis
 * l'email de bienvenue, UNE seule fois par abonnement. Rien d'autre de la
 * session ne repart que le prenom. Jamais le session_id, le jeton ni l'email
 * dans un log.
 *
 * Une session Checkout reste « complete + paid » pour toujours : son URL de
 * retour ne doit pas redevenir une cle d'entree. Donc on ne cree JAMAIS de
 * nouveau jeton pour un abonnement dont un jeton a deja servi (quelle que
 * soit son expiration), ni pour une session de plus de DUREE_JETON_JOURS
 * jours. Dans le premier cas la page recoit le lien du bot sans parametre et
 * deja_utilise: true (le membre rouvre le bot depuis son compte deja lie).
 * Le tout sous un verrou par abonnement (pg_advisory_xact_lock) : deux
 * chargements croises rendent le meme jeton et un seul email part.
 */

export const maxDuration = 30

const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]+$/
const MAX_SESSION = 255

// Le site (production et previews Vercel), le site de Melanie (comme dans
// support-cors.ts), le dev local, et en supplement les origines posees dans
// LIVECLUB_ORIGINES_EXTRA, separees par des virgules. Le CORS n'est pas la
// barriere de securite (la verification Stripe l'est) : il dit seulement
// quels sites ont le droit de lire la reponse.
const ORIGINES = [
  /^https:\/\/(www\.)?aoknowledge\.com$/,
  /^https:\/\/(www\.)?melaniechart\.com$/, // MelTrade, le site de Melanie
  /^https:\/\/[a-z0-9-]+-aotenshiros-projects\.vercel\.app$/, // previews Vercel
  /^http:\/\/localhost(:\d+)?$/, // dev local
]

function originesExtra(): string[] {
  return (process.env.LIVECLUB_ORIGINES_EXTRA ?? '')
    .split(',')
    .map(o => o.trim().replace(/\/+$/, '').toLowerCase())
    .filter(o => /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(o))
}

function corsBienvenue(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin')
  if (!origin) return {}
  const autorisee = ORIGINES.some(re => re.test(origin)) || originesExtra().includes(origin.toLowerCase())
  if (!autorisee) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsBienvenue(req) })
}

const SUPPORT_TXT = 'Écris-nous à support@aoknowledge.com, on règle ça vite.'

// Duree d'un jeton d'entree, et age maximal d'une session pour en creer un.
const DUREE_JETON_JOURS = 30

type Preparation =
  /** jeton null = un jeton a deja servi et plus aucun n'est valable : rien de cree. */
  | { issue: 'lien'; jeton: string | null; nouveau: boolean; dejaUtilise: boolean; envoyerEmail: boolean }
  /** Session trop ancienne et aucun jeton valable : on ne cree rien. */
  | { issue: 'trop_ancienne' }

/**
 * Le jeton d'entree de cet abonnement et la reservation de l'email de
 * bienvenue, en UNE transaction verrouillee par abonnement : tant qu'un
 * appel tient le verrou, un second attend, puis voit le jeton et la
 * reservation du premier. Tout passe par `tx` (une seule connexion : pas
 * d'appel a la bibliotheque des jetons, qui prendrait une autre connexion).
 */
async function preparerBienvenue(
  abonnementId: string,
  n: { clientStripe: string | null; email: string | null; sessionTropAncienne: boolean },
): Promise<Preparation> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`
      select pg_advisory_xact_lock(hashtext('liveclub_bienvenue'), hashtext(${abonnementId}))`

    const jetons = await tx.$queryRaw<{ jeton: string; valable: boolean; utilise: boolean; email_envoye: boolean }[]>`
      select jeton, expire_le > now() as valable, utilise_le is not null as utilise,
             email_envoye_le is not null as email_envoye
      from public.cockpit_liveclub_jetons
      where abonnement_id = ${abonnementId} and usage = 'entree'
      order by cree_le desc`
    const dejaUtilise = jetons.some(j => j.utilise)
    const emailDeja = jetons.some(j => j.email_envoye)
    const valable = jetons.find(j => j.valable)

    let jeton: string | null = valable?.jeton ?? null
    let nouveau = false
    if (!jeton) {
      // Un jeton a deja servi : l'abonnement a son compte Telegram, on n'en
      // ouvre pas un second avec une vieille URL de retour.
      if (dejaUtilise) return { issue: 'lien', jeton: null, nouveau: false, dejaUtilise: true, envoyerEmail: false }
      if (n.sessionTropAncienne) return { issue: 'trop_ancienne' }
      jeton = genererJeton()
      await tx.$executeRaw`
        insert into public.cockpit_liveclub_jetons
          (jeton, usage, client_stripe, abonnement_id, email, expire_le)
        values (${jeton}, 'entree', ${n.clientStripe}, ${abonnementId}, ${n.email},
                now() + make_interval(days => ${DUREE_JETON_JOURS}::int))`
      nouveau = true
    }

    // L'email, une seule fois par abonnement (tous jetons confondus), et
    // seulement avec un lien qui n'a pas encore servi.
    let envoyerEmail = false
    if (n.email && !emailDeja && !(valable?.utilise)) {
      const reserve = await tx.$queryRaw<{ jeton: string }[]>`
        update public.cockpit_liveclub_jetons set email_envoye_le = now()
        where jeton = ${jeton} and email_envoye_le is null
        returning jeton`
      envoyerEmail = reserve.length === 1
    }
    return { issue: 'lien', jeton, nouveau, dejaUtilise: Boolean(valable?.utilise), envoyerEmail }
  })
}

export async function POST(req: NextRequest) {
  const headers = corsBienvenue(req)
  const refus = (erreur: string, status: number) =>
    NextResponse.json({ ok: false, erreur }, { status, headers })

  const body = await req.json().catch(() => ({}))
  const sessionId = typeof body?.session_id === 'string' ? body.session_id.trim() : ''
  if (!sessionId || sessionId.length > MAX_SESSION || !SESSION_RE.test(sessionId)) {
    return refus(`Le lien de cette page est incomplet. ${SUPPORT_TXT}`, 400)
  }

  // 1. La session, chez Stripe, en direct.
  let session
  try {
    session = await lireSessionCheckout(sessionId)
  } catch (err) {
    console.warn(`[liveclub/bienvenue] Stripe illisible : ${messageErreur(err)}`)
    return refus('On n\'arrive pas à vérifier ton paiement pour le moment. Réessaie dans une minute. '
      + 'Si ça dure, écris-nous à support@aoknowledge.com.', 502)
  }
  if (!session) return refus(`On ne retrouve pas ce paiement. ${SUPPORT_TXT}`, 404)
  if (!session.estLiveClub) return refus(`Ce paiement ne concerne pas le Live Club. ${SUPPORT_TXT}`, 404)
  // 409 = UNIQUEMENT « paiement pas encore confirme » : la page du site en
  // fait un message d'attente avec un bouton reessayer (LiveClubBienvenuePage).
  if (!session.payee) {
    return refus('Ton paiement n\'est pas encore confirmé. Recharge cette page dans quelques minutes.', 409)
  }
  if (!session.abonnementId) {
    console.warn('[liveclub/bienvenue] session Live Club payee sans abonnement')
    return refus(`On ne retrouve pas ton abonnement. ${SUPPORT_TXT}`, 502)
  }
  const abonnementId = session.abonnementId

  // 2. Le jeton d'entree de cet abonnement (le meme a chaque rechargement)
  //    et la reservation de l'email, sous verrou.
  const creeLe = session.creeLe ? Date.parse(session.creeLe) : NaN
  const sessionTropAncienne = Number.isFinite(creeLe)
    && Date.now() - creeLe > DUREE_JETON_JOURS * 24 * 3600 * 1000
  let prep: Preparation
  try {
    prep = await preparerBienvenue(abonnementId, {
      clientStripe: session.clientStripe, email: session.email, sessionTropAncienne,
    })
  } catch (err) {
    console.warn(`[liveclub/bienvenue] jeton impossible : ${relationAbsente(err) ? 'table cockpit_liveclub_jetons absente (migration 20260929200000)' : messageErreur(err)}`)
    return refus(`Petit souci technique de notre côté. ${SUPPORT_TXT}`, 503)
  }
  if (prep.issue === 'trop_ancienne') {
    return refus(`Ce lien de paiement est trop ancien pour ouvrir un nouvel accès. ${SUPPORT_TXT}`, 410)
  }
  const { jeton, nouveau, dejaUtilise } = prep
  // Jeton deja servi et expire : le bot sans parametre (le compte deja lie
  // retrouve son menu). Un jeton deja servi mais valable ne marche que pour
  // le compte qui l'a pris : le rendre ne fuit rien.
  const lien = jeton ? lienBot(jeton) : `https://t.me/${nomBot()}`

  // 3. L'email de bienvenue, reserve a l'etape 2. Un echec ici ne bloque
  //    pas la page : le lien est deja a l'ecran.
  let emailEnvoye = false
  if (prep.envoyerEmail && jeton && session.email) {
    const envoi = await emailBienvenue(session.email, lien)
    if (envoi.ok) {
      emailEnvoye = true
    } else {
      console.warn(`[liveclub/bienvenue] email pas parti : ${envoi.erreur}`)
      try {
        await annulerReservationEmail(jeton)
      } catch (err) {
        console.warn(`[liveclub/bienvenue] reservation d'email pas rendue : ${messageErreur(err)}`)
      }
    }
  }

  // Une ligne de journal quand quelque chose s'est passe (jeton neuf ou
  // email parti), pas a chaque rechargement. Ni jeton ni email dedans.
  if (nouveau || emailEnvoye) {
    await journaliserGesteLiveClub(
      {
        geste: 'invitation', resultat: 'fait', regle: 'bienvenue',
        details: { jeton_nouveau: nouveau, email_envoye: emailEnvoye, mode: sessionId.startsWith('cs_test_') ? 'test' : 'live' },
      },
      { telegramId: null, acteur: 'site:bienvenue', abonnementId },
    )
  }

  return NextResponse.json(
    {
      ok: true, lien_bot: lien,
      ...(session.prenom ? { prenom: session.prenom } : {}),
      // Le lien a deja servi a un compte Telegram : la page le dit (rouvre le
      // bot depuis ce compte, sinon support@).
      ...(dejaUtilise ? { deja_utilise: true } : {}),
    },
    { headers },
  )
}
