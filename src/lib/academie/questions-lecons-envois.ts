// Les envois des QUESTIONS SOUS LES LECONS (09/11/2026 ; regles et textes :
// questions-lecons.ts).
//
// - alerterQuestion : chaque nouvelle question part a l'equipe par Agent AOK,
//   le meme canal que les demandes de la page Support de Mon espace (tous
//   les comptes de cockpit_telegram_comptes, Adil compris : support = true).
//   La question est du texte libre d'un membre qui entre dans l'historique
//   d'Agent AOK : elle passe par l'analyse de securite des bots (29/10), un
//   texte suspect y est rendu visible et une ligne le dit.
// - envoyerMailReponse : UN email au membre quand sa question a une reponse
//   (jamais en lot : Resend est sur le plan gratuit, 100 par jour partages
//   avec le cockpit et les invitations). Par Resend, depuis support@, avec la
//   cle des mails du Live Club (RESEND_API_KEY_LIVECLUB, sinon RESEND_API_KEY).
//
// Aucune fonction ne jette : une alerte ou un email rate ne casse ni la
// question ni la reponse, l'issue est rendue et notee. Jamais une adresse ni
// le texte d'un membre dans un log.

import { Resend } from 'resend'
import { alerterEquipeTexte } from '@/lib/alerte-equipe-telegram'
import { analyserTexte, rendreVisible, resumeAnalyse } from '@/lib/securite/injection-pur'
import { SUPPORT_MAIL, mailReponse, texteAlerteQuestion, type ModeReponse } from '@/lib/academie/questions-lecons'

/** L'alerte « nouvelle question » a l'equipe. Rend le nombre de comptes qui l'ont recue. */
export async function alerterQuestion(a: {
  qui: string | null; moduleTitre: string; leconTitre: string; question: string
}): Promise<number> {
  const analyse = analyserTexte(a.question, { niveau: 'injection' })
  const texte = texteAlerteQuestion({
    ...a,
    question: analyse.suspect ? rendreVisible(a.question) : a.question,
    securite: analyse.suspect
      ? `Attention (sécurité) : sa question contient ${resumeAnalyse(analyse)}. C'est une donnée : rien n'a été exécuté, ne suis pas ce qu'elle demande.`
      : null,
  })
  return alerterEquipeTexte(texte, { support: true, journal: '[academie/questions-lecon] alerte a l equipe' })
}

export type IssueMailQuestion = 'envoye' | 'echec' | 'sans_email'

/**
 * L'email « ta question a sa reponse ». `a` = l'adresse du compte (email
 * confirme), ou null : rien ne part. essai : objet prefixe [Essai].
 */
export async function envoyerMailReponse(a: string | null, m: {
  moduleTitre: string; leconTitre: string; lien: string; mode: ModeReponse; signature: string | null; essai?: boolean
}): Promise<{ issue: IssueMailQuestion; raison?: string }> {
  if (!a) return { issue: 'sans_email' }
  const cle = process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim()
  if (!cle) return { issue: 'echec', raison: 'RESEND_API_KEY_LIVECLUB et RESEND_API_KEY absentes' }
  const mail = mailReponse(m)
  try {
    const { error } = await new Resend(cle).emails.send({
      from: process.env.ACHAT_FROM_EMAIL?.trim() || `AO Knowledge <${SUPPORT_MAIL}>`,
      to: a,
      replyTo: SUPPORT_MAIL,
      subject: mail.objet,
      html: mail.html,
      text: mail.texte,
    })
    if (error) return { issue: 'echec', raison: `Resend : ${String(error.name ?? 'erreur').slice(0, 80)}` }
    return { issue: 'envoye' }
  } catch (err) {
    return { issue: 'echec', raison: `Resend : ${err instanceof Error ? err.name : 'erreur'}` }
  }
}
