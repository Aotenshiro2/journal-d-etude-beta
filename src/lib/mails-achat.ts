// L'envoi des mails de confirmation d'achat (brief F1, 30/10/2026). Textes et
// regles : mails-achat-pur.ts. Par Resend, depuis support@, avec la cle et le
// repli des mails du Live Club (RESEND_API_KEY_LIVECLUB, sinon RESEND_API_KEY).
//
// Variables (journal, Vercel) :
//   RESEND_API_KEY_LIVECLUB ou RESEND_API_KEY   la cle Resend (domaine aoknowledge.com verifie) ;
//   ACHAT_FROM_EMAIL     (facultatif) l'expediteur, par defaut « AO Knowledge <support@aoknowledge.com> » ;
//   PILOTAGE_PORTAIL_LIEN  le lien de connexion du portail client Stripe Ao Knowledge (deja lu par Pilotage).
//
// Un seul mail par achat : la cle (abonnement sub_... ou session cs_...) est
// reservee dans mails_achat_envoyes AVANT l'envoi (insert ... on conflict do
// nothing). Deux livraisons du meme evenement, meme simultanees : une seule
// reservation gagne. Envoi rate : la reservation saute (un evenement rejoue
// pourra reessayer). Table absente (migration pas encore appliquee) : AUCUN
// mail, plutot que le risque d'en envoyer deux.
//
// Aucune fonction ne jette : l'appelant (un webhook) ne doit jamais echouer a
// cause d'un mail. Jamais l'adresse dans un log.

import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { appeler } from '@/lib/academie/achat'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'
import { CATALOGUE, MARGE_FIN_JOURS, type SlugOffrePilotage } from '@/lib/pilotage-paliers'
import {
  SQL_LIBERER_MAIL, SQL_MAIL_PARTI, SQL_RESERVER_MAIL, SUPPORT_MAIL, cleMailAchat, envoyerUneFois, formaterDateLongue, formaterEuros,
  lienDuModule, lienPortailPropre, lireAbonnementCarnet, lireSessionPayee, offreCarnet, produitDeOffrePilotage, rendreMail,
  type IssueMail, type ProduitMail, type VariablesMail,
} from '@/lib/mails-achat-pur'

export type { IssueMail }

const lienPortail = () => lienPortailPropre(process.env.PILOTAGE_PORTAIL_LIEN)

/** Reserve, envoie, note (envoyerUneFois, mails-achat-pur.ts). Ne jette jamais. */
export async function envoyerMailAchat(produit: ProduitMail, reference: string, v: VariablesMail): Promise<IssueMail> {
  const cle = cleMailAchat(produit, reference)
  const mail = rendreMail(produit, v)
  let raison = ''
  const issue = await envoyerUneFois({
    reserver: async () => {
      try {
        return (await prisma.$queryRawUnsafe<{ cle: string }[]>(SQL_RESERVER_MAIL, cle, produit)).length > 0
      } catch (err) {
        if (relationAbsente(err)) {
          console.warn(`[mails-achat] table mails_achat_envoyes absente (migration 20261031150000) : aucun mail ${produit}`)
          return 'sans_table'
        }
        console.warn(`[mails-achat] reservation impossible (${produit}) : ${messageErreur(err)}`)
        throw err
      }
    },
    envoyer: async () => {
      const cleResend = process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim()
      if (!cleResend) {
        raison = 'RESEND_API_KEY_LIVECLUB et RESEND_API_KEY absentes'
        return { ok: false, erreur: raison }
      }
      try {
        const { data, error } = await new Resend(cleResend).emails.send({
          from: process.env.ACHAT_FROM_EMAIL?.trim() || `AO Knowledge <${SUPPORT_MAIL}>`,
          to: v.email,
          replyTo: SUPPORT_MAIL,
          subject: mail.objet,
          html: mail.html,
          text: mail.texte,
        })
        if (error) {
          raison = `Resend : ${String(error.name ?? 'erreur').slice(0, 80)}`
          return { ok: false, erreur: raison }
        }
        return { ok: true, id: data?.id ?? null }
      } catch (err) {
        raison = `Resend : ${err instanceof Error ? err.name : 'erreur'}`
        return { ok: false, erreur: raison }
      }
    },
    liberer: async () => { await prisma.$executeRawUnsafe(SQL_LIBERER_MAIL, cle) },
    noter: async id => { await prisma.$executeRawUnsafe(SQL_MAIL_PARTI, cle, id ?? 'envoye') },
  })
  if (issue === 'envoye') console.info(`[mails-achat] mail ${produit} envoye${v.essai ? ' (essai)' : ''}`)
  else if (issue === 'echec') console.warn(`[mails-achat] mail ${produit} NON envoye${raison ? ` : ${raison}` : ''}`)
  return issue
}

// ---------------------------------------------------------------------------
// Les declencheurs
// ---------------------------------------------------------------------------

/**
 * Pilotage Premium ou Premium Duo : apres checkout.session.completed d'une
 * session de Pilotage, une fois le droit pose (synchroniserAbonnement).
 * `session` = la session relue chez Stripe ; `fin` = fin du droit (fin de
 * periode + MARGE_FIN_JOURS).
 */
export async function mailAchatPilotage(p: {
  session: Record<string, unknown>; abonnementId: string; slug: SlugOffrePilotage; email: string | null; essai: boolean; fin: Date | null
}): Promise<IssueMail> {
  const produit = produitDeOffrePilotage(p.slug)
  const s = lireSessionPayee(p.session)
  if (!produit || !s) return 'pas_concerne'
  const email = s.email ?? p.email
  if (!email) return 'sans_email'
  const finPeriode = p.fin ? new Date(p.fin.getTime() - MARGE_FIN_JOURS * 86400 * 1000) : null
  return envoyerMailAchat(produit, p.abonnementId, {
    prenom: s.prenom,
    offre: CATALOGUE[p.slug].titre,
    montant: formaterEuros(s.centimes ?? CATALOGUE[p.slug].centimes),
    prochaineEcheance: formaterDateLongue(finPeriode),
    lienPortail: lienPortail(),
    email,
    essai: p.essai || s.test,
  })
}

/**
 * Carnet Premium : une session d'abonnement du compte Ao Knowledge qui n'est
 * pas de Pilotage (liens de paiement du Carnet). L'abonnement est relu chez
 * Stripe ; seul un abonnement sur le produit du Carnet envoie le mail. Les
 * droits ne bougent pas (entitlements.ts lit Stripe en direct).
 */
export async function mailAchatCarnet(cle: string, session: Record<string, unknown>): Promise<IssueMail> {
  if (session.mode !== 'subscription') return 'pas_concerne'
  const s = lireSessionPayee(session)
  if (!s?.abonnementId) return 'pas_concerne'
  let ab: ReturnType<typeof lireAbonnementCarnet> = null
  try {
    ab = lireAbonnementCarnet(await appeler(cle, `/v1/subscriptions/${encodeURIComponent(s.abonnementId)}`))
  } catch (err) {
    console.warn(`[mails-achat] abonnement illisible pour le Carnet : ${messageErreur(err)}`)
    return 'echec'
  }
  if (!ab) return 'pas_concerne'
  if (!s.email) return 'sans_email'
  return envoyerMailAchat('carnet-premium', ab.id, {
    prenom: s.prenom,
    offre: offreCarnet(ab.rythme),
    montant: formaterEuros(s.centimes),
    prochaineEcheance: formaterDateLongue(ab.finPeriode),
    lienPortail: lienPortail(),
    email: s.email,
    essai: s.test,
  })
}

/** Un module a l'unite : apres l'acces pose par le webhook de l'academie. */
export async function mailAchatModule(p: {
  session: Record<string, unknown>; sessionId: string; moduleSlug: string; email: string | null; montantEur: number | null; essai: boolean
}): Promise<IssueMail> {
  const s = lireSessionPayee(p.session)
  const email = s?.email ?? p.email
  if (!email) return 'sans_email'
  let titre: string | null = null
  try {
    const l = await prisma.$queryRawUnsafe<{ titre: string | null }[]>(
      'select titre from public.academie_modules where slug = $1::text limit 1', p.moduleSlug)
    titre = l[0]?.titre?.trim() || null
  } catch (err) {
    console.warn(`[mails-achat] titre du module illisible : ${messageErreur(err)}`)
  }
  return envoyerMailAchat('module', p.sessionId, {
    prenom: s?.prenom ?? null,
    montant: formaterEuros(p.montantEur === null ? s?.centimes : Math.round(p.montantEur * 100)),
    titreModule: titre ?? p.moduleSlug,
    lienModule: lienDuModule(p.moduleSlug),
    email,
    essai: p.essai || !!s?.test,
  })
}
