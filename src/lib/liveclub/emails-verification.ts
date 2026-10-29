// L'email du code de verification du bot Live Club (29/09), par Resend,
// depuis support@, comme les autres emails du Live Club (emails.ts, dont on
// reprend le rendu). Ne jette pas : ok false + erreur. Jamais l'adresse ni le
// code dans un log.

import { Resend } from 'resend'
import { SUPPORT } from './config'
import { htmlEmail, texteEmail, type ModeleMessage, type ResultatEmail } from './emails'
import { messageErreur, normaliserEmail } from './pur'
import { CODE_VALIDITE_MINUTES } from './verification-pur'

/** (30/10, brief F1) Un email vouvoie et se signe « Brice et Mélanie » (htmlEmail, texteEmail). */
export function modeleCodeVerification(code: string): ModeleMessage {
  return {
    sujet: `Votre code pour le bot Live Club : ${code}`,
    paragraphes: [
      'Bonjour,',
      `Voici votre code pour relier votre compte Telegram à votre abonnement Live Club : ${code}`,
      `Tapez-le dans votre conversation avec le bot. Il marche ${CODE_VALIDITE_MINUTES} minutes.`,
      "Vous n'avez rien demandé ? Ne faites rien : sans ce code, rien ne change. Et ne le donnez à personne.",
      `Une question ? Écrivez à ${SUPPORT}.`,
    ],
  }
}

export async function emailCodeVerification(email: string, code: string): Promise<ResultatEmail> {
  const destinataire = normaliserEmail(email)
  if (!destinataire) return { ok: false, erreur: 'Adresse email invalide.' }
  const cle = process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim()
  if (!cle) return { ok: false, erreur: 'RESEND_API_KEY_LIVECLUB et RESEND_API_KEY absentes du projet journal.' }
  const m = modeleCodeVerification(code)
  try {
    const { data, error } = await new Resend(cle).emails.send({
      from: process.env.LIVECLUB_FROM_EMAIL?.trim() || 'Live Club AOKnowledge <support@aoknowledge.com>',
      to: destinataire,
      replyTo: SUPPORT,
      subject: m.sujet,
      html: htmlEmail(m),
      text: texteEmail(m),
    })
    if (error) return { ok: false, erreur: `Resend : ${String(error.message ?? error.name ?? '?').slice(0, 200)}` }
    return { ok: true, id: data?.id ?? null }
  } catch (err) {
    return { ok: false, erreur: `Resend : ${messageErreur(err)}` }
  }
}
