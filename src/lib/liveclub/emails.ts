// Emails du Live Club (29/09), par Resend, depuis support@. HTML simple et
// texte brut. AUCUN lien d'invitation Telegram dans un email : seulement le
// lien personnel vers le bot, qui donne lui-meme le lien du groupe.
//
// Chaque email part d'un « modele » (sujet, paragraphes, bouton) exporte :
// le bot et le passage quotidien reprennent le meme texte en message prive
// (texteTelegram), pour que le membre lise la meme chose partout.
//
// Aucune fonction ne jette : ok false + erreur, et l'appelant decide. Jamais
// l'adresse dans un log.

import { Resend } from 'resend'
import { SUPPORT, URL_PORTAIL_CARTE, MOIS_ACCES_BROKER, lienBotAccueil, texteAbonnement } from './config'
import { echapperHtml, formaterDateFr, formaterMontant, messageErreur, normaliserEmail } from './pur'

export type ResultatEmail = { ok: true; id: string | null } | { ok: false; erreur: string }

export type ModeleMessage = {
  sujet: string
  paragraphes: string[]
  bouton?: { texte: string; url: string }
}

// ---------------------------------------------------------------------------
// Les textes. Tutoiement, phrases courtes, francais parle.
// ---------------------------------------------------------------------------

export function modeleBienvenue(lienBot: string): ModeleMessage {
  return {
    sujet: 'Bienvenue dans le Live Club',
    paragraphes: [
      'Salut, et bienvenue dans le Live Club !',
      "Ton paiement est bien passé. Il reste une étape pour entrer dans le groupe Telegram, et ça prend une minute.",
      "Ouvre notre bot avec le bouton ci-dessous et appuie sur Démarrer. Il te donne le lien du groupe : tu demandes à rejoindre, et c'est accepté tout seul.",
      "Ce lien est personnel, garde-le pour toi.",
      `Un souci ? Réponds à cet email ou écris à ${SUPPORT}.`,
    ],
    bouton: { texte: 'Ouvrir le bot Telegram', url: lienBot },
  }
}

export function modeleAccesBroker(lienBot: string, jusquau: string): ModeleMessage {
  return {
    sujet: 'Ton accès au Live Club est ouvert',
    paragraphes: [
      'Salut !',
      `Grâce à ton compte chez notre broker partenaire, tu as accès au Live Club pendant ${MOIS_ACCES_BROKER} mois, jusqu'au ${formaterDateFr(jusquau)}.`,
      "Pour entrer dans le groupe Telegram, ouvre notre bot avec le bouton ci-dessous et appuie sur Démarrer. Il te donne le lien du groupe : tu demandes à rejoindre, et c'est accepté tout seul.",
      "Cet accès n'est pas renouvelable. Une semaine avant la fin, on te prévient, et si tu veux rester, il suffira de t'abonner.",
      `Une question ? Réponds à cet email ou écris à ${SUPPORT}.`,
    ],
    bouton: { texte: 'Ouvrir le bot Telegram', url: lienBot },
  }
}

/**
 * Pause : 'debut' quand la pause commence (le membre sort du groupe),
 * 'j7' une semaine avant la reprise des prelevements.
 */
export function modeleRappelPause(repriseLe: string, moment: 'debut' | 'j7' = 'debut'): ModeleMessage {
  const date = formaterDateFr(repriseLe)
  if (moment === 'j7') {
    return {
      sujet: 'Ta pause du Live Club se termine bientôt',
      paragraphes: [
        'Salut !',
        `Petit rappel : ta pause se termine le ${date}. Ce jour-là, ton abonnement reprend et le prélèvement repart sur ta carte habituelle.`,
        "Dès que le paiement est passé, on t'envoie de quoi revenir dans le groupe.",
        `Tu préfères arrêter ou changer quelque chose ? Écris-nous avant le ${date} à ${SUPPORT}.`,
      ],
    }
  }
  return {
    sujet: 'Ta pause du Live Club a commencé',
    paragraphes: [
      'Salut !',
      "Ta pause a commencé : ta période payée est terminée, donc tu sors du groupe Telegram pour le moment. Rien n'est prélevé pendant la pause.",
      `Ton abonnement reprend tout seul le ${date}. Dès que le paiement est passé, on t'envoie de quoi revenir dans le groupe.`,
      `Une question ? Écris à ${SUPPORT}.`,
    ],
  }
}

/**
 * Debut d'une pause SANS date de reprise (posee « indefiniment » au
 * Dashboard Stripe) : rien ne reprend tout seul, le membre doit demander.
 */
export function modeleDebutPauseSansReprise(): ModeleMessage {
  return {
    sujet: 'Ta pause du Live Club a commencé',
    paragraphes: [
      'Salut !',
      "Ta pause a commencé : ta période payée est terminée, donc tu sors du groupe Telegram pour le moment. Rien n'est prélevé pendant la pause.",
      `Ta pause n'a pas de date de fin. Quand tu veux reprendre, écris-nous à ${SUPPORT} : on relance ton abonnement, et dès que le paiement est passé, on t'envoie de quoi revenir dans le groupe.`,
    ],
  }
}

export function modeleRetour(lienBot: string): ModeleMessage {
  return {
    sujet: 'Ton retour dans le Live Club',
    paragraphes: [
      'Salut, content de te revoir !',
      "Ton abonnement a repris. Pour revenir dans le groupe Telegram, ouvre notre bot avec le bouton ci-dessous et appuie sur Démarrer : il te redonne le lien du groupe.",
      `Un souci ? Écris à ${SUPPORT}.`,
    ],
    bouton: { texte: 'Revenir dans le groupe', url: lienBot },
  }
}

// Les messages « abonne-toi » donnent les DEUX portes (Brice, 29/09) dans le
// texte, par texteAbonnement() : pas de bouton qui en mettrait une seule en
// avant. Les adresses deviennent des liens dans l'email (paragrapheHtml), et
// Telegram les rend cliquables tout seul.

export function modeleRappelFinBroker(jusquau: string): ModeleMessage {
  return {
    sujet: 'Ton accès au Live Club se termine dans une semaine',
    paragraphes: [
      'Salut !',
      `Ton accès offert au Live Club se termine le ${formaterDateFr(jusquau)}. Il n'est pas renouvelable.`,
      "Si tu veux rester dans le groupe, abonne-toi avant cette date avec la même adresse email, et tu n'auras rien d'autre à faire.",
      texteAbonnement(),
      `Une question ? Écris à ${SUPPORT}.`,
    ],
  }
}

export function modeleFinBroker(): ModeleMessage {
  return {
    sujet: 'Ton accès au Live Club est terminé',
    paragraphes: [
      'Salut !',
      "Ton accès offert au Live Club est arrivé à son terme, donc tu sors du groupe Telegram. Merci d'avoir été là.",
      "Tu veux revenir ? Abonne-toi avec la même adresse email, et on t'envoie de quoi rentrer dans le groupe.",
      texteAbonnement(),
      `Une question ? Écris à ${SUPPORT}.`,
    ],
  }
}

/**
 * Sortie d'un desabonne (seulement quand LIVECLUB_SORTIES_ACTIVES vaut '1') :
 * pourquoi, et comment revenir.
 */
export function modeleSortieDesabonne(): ModeleMessage {
  return {
    sujet: 'Ton abonnement au Live Club est terminé',
    paragraphes: [
      'Salut !',
      "Ton abonnement au Live Club est terminé, donc tu sors du groupe Telegram. Merci d'avoir été là.",
      "Tu veux revenir ? Abonne-toi avec la même adresse email, et on t'envoie de quoi rentrer dans le groupe.",
      texteAbonnement(),
      `Tu penses que c'est une erreur ? Écris à ${SUPPORT} avec l'email de ton paiement, on regarde tout de suite.`,
    ],
  }
}

/**
 * Rappel 3 jours avant un prelevement. echeance = jour du prelevement a
 * l'heure de Paris (jourParis). montant null = on ne le connait pas (apercu
 * de facture illisible) : le message ne donne que la date. lienBot : donne
 * seulement quand le message part par email (en prive, le membre est deja
 * dans le bot). Pause et arret se font par le bot : le support ne reste que
 * pour le reste.
 */
export function modeleRappelPrelevement(
  echeance: string,
  montant: { centimes: number; devise: string } | null,
  lienBot?: string,
): ModeleMessage {
  const date = formaterDateFr(echeance)
  const bot = "Tu veux faire une pause ou arrêter avant cette date ? Écris au bot du Live Club, il s'en occupe"
  return {
    sujet: `Ton prochain prélèvement Live Club, le ${date}`,
    paragraphes: [
      'Salut !',
      montant
        ? `Petit rappel : ton abonnement au Live Club se renouvelle le ${date}. ${formaterMontant(montant.centimes, montant.devise)} seront prélevés sur ta carte habituelle.`
        : `Petit rappel : ton abonnement au Live Club se renouvelle le ${date}, avec un prélèvement sur ta carte habituelle.`,
      "Ta carte a changé ou arrive en fin de validité ? Mets-la à jour avant cette date avec le bouton ci-dessous. Tu te connectes avec l'email de ton paiement.",
      lienBot ? `${bot} : ${lienBot}` : `${bot}.`,
      `Pour le reste, écris à ${SUPPORT}.`,
    ],
    bouton: { texte: 'Mettre à jour ma carte', url: URL_PORTAIL_CARTE },
  }
}

/**
 * Lien de retour apres une sortie a tort par Metricgram (transition). En
 * PRIVE seulement : c'est un lien de demande d'adhesion, jamais dans un email.
 */
export function modeleRetourSortieAbusive(lienGroupe: string): ModeleMessage {
  return {
    sujet: 'Ton retour dans le Live Club',
    paragraphes: [
      'Salut ! Tu as été sorti du groupe Live Club par erreur, alors que ton accès est toujours valable. Désolé pour ça.',
      "Pour revenir, appuie sur le bouton ci-dessous et demande à rejoindre : c'est accepté tout seul. Le lien marche pendant 14 jours.",
      `Un souci ? Écris à ${SUPPORT}.`,
    ],
    bouton: { texte: 'Revenir dans le groupe', url: lienGroupe },
  }
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

/**
 * Un paragraphe echappe, ses adresses https en liens. La ponctuation collee a
 * la fin d'une adresse reste hors du lien.
 */
export function paragrapheHtml(p: string): string {
  return echapperHtml(p).replace(/https:\/\/[^\s<]+/g, brut => {
    const url = brut.replace(/[.,;:!?)]+$/, '')
    return `<a href="${url}" style="color:#111827">${url}</a>${brut.slice(url.length)}`
  })
}

/** Le modele en texte brut (email texte, ou message prive Telegram sans HTML). */
export function texteTelegram(m: ModeleMessage): string {
  return [...m.paragraphes, ...(m.bouton ? [`${m.bouton.texte} : ${m.bouton.url}`] : [])].join('\n\n')
}

export function htmlEmail(m: ModeleMessage): string {
  const corps = m.paragraphes
    .map(p => `<p style="margin:0 0 16px;line-height:1.5">${paragrapheHtml(p)}</p>`)
    .join('\n')
  const bouton = m.bouton
    ? `<p style="margin:24px 0"><a href="${echapperHtml(m.bouton.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">${echapperHtml(m.bouton.texte)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280">Si le bouton ne marche pas, copie ce lien : ${echapperHtml(m.bouton.url)}</p>`
    : ''
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#ffffff;color:#111827;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px">
<div style="max-width:560px;margin:0 auto">
${corps}
${bouton}
<p style="margin:32px 0 0;font-size:13px;color:#6b7280">Le Live Club AOKnowledge</p>
</div></body></html>`
}

async function envoyerModele(email: string, m: ModeleMessage): Promise<ResultatEmail> {
  const destinataire = normaliserEmail(email)
  if (!destinataire) return { ok: false, erreur: 'Adresse email invalide.' }
  const cle = process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim()
  if (!cle) return { ok: false, erreur: 'RESEND_API_KEY_LIVECLUB et RESEND_API_KEY absentes du projet journal.' }
  try {
    const { data, error } = await new Resend(cle).emails.send({
      from: process.env.LIVECLUB_FROM_EMAIL?.trim() || 'Live Club AOKnowledge <support@aoknowledge.com>',
      to: destinataire,
      replyTo: SUPPORT,
      subject: m.sujet,
      html: htmlEmail(m),
      text: texteTelegram(m),
    })
    if (error) return { ok: false, erreur: `Resend : ${String(error.message ?? error.name ?? '?').slice(0, 200)}` }
    return { ok: true, id: data?.id ?? null }
  } catch (err) {
    return { ok: false, erreur: `Resend : ${messageErreur(err)}` }
  }
}

export function emailBienvenue(email: string, lienBot: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleBienvenue(lienBot))
}

export function emailAccesBroker(email: string, lienBot: string, jusquau: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleAccesBroker(lienBot, jusquau))
}

export function emailRappelPause(email: string, repriseLe: string, moment: 'debut' | 'j7' = 'debut'): Promise<ResultatEmail> {
  return envoyerModele(email, modeleRappelPause(repriseLe, moment))
}

export function emailDebutPauseSansReprise(email: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleDebutPauseSansReprise())
}

export function emailRetour(email: string, lienBot: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleRetour(lienBot))
}

export function emailRappelFinBroker(email: string, jusquau: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleRappelFinBroker(jusquau))
}

export function emailFinBroker(email: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleFinBroker())
}

export function emailSortieDesabonne(email: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleSortieDesabonne())
}

export function emailRappelPrelevement(
  email: string, echeance: string, montant: { centimes: number; devise: string } | null,
): Promise<ResultatEmail> {
  return envoyerModele(email, modeleRappelPrelevement(echeance, montant, lienBotAccueil()))
}
