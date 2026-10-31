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
//
// (22/10, Brice) Plus AUCUN renvoi vers support@ dans un message prive : un
// modele qui part des deux cotes prend un canal ('telegram' par defaut, celui
// du passage ; les fonctions email* ci-dessous passent 'email'). En prive,
// « Une question ? Écris-moi ici. » ; par email, « Répondez à cet email »
// (replyTo = support@, vouvoiement depuis le 30/10). Restent avec support@ les modeles qui ne partent QUE
// par email : bienvenue, acces broker, et le code de verification
// (emails-verification.ts).

import { Resend } from 'resend'
import { SUPPORT, URL_FORMATION_LIVECLUB, URL_PORTAIL_CARTE, lienBotAccueil, texteAbonnement } from './config'
import {
  BOUTON_REGLE, echapperHtml, formaterDateFr, formaterMontant, messageErreur, normaliserEmail, phraseARegler, phraseQuestion,
  phraseRetourApresReglement, type FactureARegler,
} from './pur'
import {
  BOUTON_EQUIPE_DEPOT, BOUTON_LOTS, EXEMPLE_LOTS, TENUE_LOTS, texteFermetureDepot, texteRelanceLots1, texteRelanceLots2, texteSuspensionLots,
} from './lots-pur'

export type ResultatEmail = { ok: true; id: string | null } | { ok: false; erreur: string }

/** Le canal d'un modele qui part des deux cotes : message prive du bot, ou email. */
export type Canal = 'telegram' | 'email'

export type ModeleMessage = {
  sujet: string
  paragraphes: string[]
  bouton?: { texte: string; url: string }
  /**
   * (22/10) Message prive SEULEMENT : un bouton qui revient au bot
   * (callback_data), sous le bouton a adresse. htmlEmail et texteTelegram
   * (texte brut de l'email) l'ignorent : un email n'a pas de bot derriere.
   */
  boutonBot?: { texte: string; data: string }
}

/** Les boutons d'un modele en message prive : le bouton a adresse, puis celui qui revient au bot. */
export function boutonsTelegram(m: ModeleMessage): { texte: string; url?: string; data?: string }[][] | undefined {
  const lignes = [
    ...(m.bouton ? [[{ texte: m.bouton.texte, url: m.bouton.url }]] : []),
    ...(m.boutonBot ? [[{ texte: m.boutonBot.texte, data: m.boutonBot.data }]] : []),
  ]
  return lignes.length ? lignes : undefined
}

// ---------------------------------------------------------------------------
// Les textes. Phrases courtes, francais parle.
//
// (30/10, Brice, brief F1) Un EMAIL vouvoie : il represente l'organisation, et
// il est signe « Brice et Mélanie » (htmlEmail, texteEmail). Un message PRIVE
// du bot garde le tutoiement du bot. Les modeles qui partent des deux cotes
// prennent donc le canal pour le ton aussi ; ceux qui ne partent que par
// email (bienvenue, acces broker) vouvoient toujours. Memes faits, meme
// declenchement : seuls le ton et la signature changent.
// ---------------------------------------------------------------------------

/** Le texte du bon ton : tutoiement en prive, vouvoiement par email. */
const ton = (canal: Canal, tu: string, vous: string) => (canal === 'email' ? vous : tu)

export function modeleBienvenue(lienBot: string): ModeleMessage {
  return {
    sujet: 'Bienvenue dans le Live Club',
    paragraphes: [
      'Bonjour, et bienvenue dans le Live Club !',
      'Votre paiement est bien passé. Il reste une étape pour entrer dans le groupe Telegram, et ça prend une minute.',
      "Ouvrez notre bot avec le bouton ci-dessous et appuyez sur Démarrer. Il vous donne le lien du groupe : vous demandez à rejoindre, et c'est accepté tout seul.",
      'Ce lien est personnel, gardez-le pour vous.',
      // (30/10, brief F1) Les videos de formation incluses sont sur
      // l'academie du site (URL_FORMATION_LIVECLUB, la meme adresse que le
      // bot des membres depuis le 18/10), plus sur Skool. L'adresse finit la
      // phrase : une ponctuation collee entrerait dans le lien.
      "À retenir : le bot et le groupe Telegram, c'est pour la communauté ; les vidéos de formation incluses sont dans l'académie du site. "
        + `Connectez-vous avec l'email de votre abonnement, et les cours inclus s'ouvrent : ${URL_FORMATION_LIVECLUB}`,
      `Un souci ? Répondez à cet email ou écrivez à ${SUPPORT}.`,
    ],
    bouton: { texte: 'Ouvrir le bot Telegram', url: lienBot },
  }
}

/**
 * (29/10) `mois` : la duree accordee (libre depuis le 29/10). Absente (renvoi
 * d'une invitation), la phrase ne dit que la date de fin, toujours juste.
 */
export function modeleAccesBroker(lienBot: string, jusquau: string, mois?: number): ModeleMessage {
  const duree = mois === undefined
    ? `jusqu'au ${formaterDateFr(jusquau)}`
    : `pendant ${mois} mois, jusqu'au ${formaterDateFr(jusquau)}`
  return {
    sujet: 'Votre accès au Live Club est ouvert',
    paragraphes: [
      'Bonjour,',
      `Grâce à votre compte chez notre broker partenaire, vous avez accès au Live Club ${duree}.`,
      "Pour entrer dans le groupe Telegram, ouvrez notre bot avec le bouton ci-dessous et appuyez sur Démarrer. Il vous donne le lien du groupe : vous demandez à rejoindre, et c'est accepté tout seul.",
      // (31/10, Brice) L'email parle aussi des premiers lots ; le bot donne la date limite a l'entree.
      `Un point important : tant que vos premiers lots ne sont pas tradés chez le broker, l'affiliation ne nous rémunère pas. `
        + `Pas besoin de risquer votre compte : ${EXEMPLE_LOTS}, avec une position tenue ${TENUE_LOTS}, suffisent. Ensuite, vous prenez tout votre temps.`,
      "Cet accès n'est pas renouvelable. Une semaine avant la fin, on vous prévient, et si vous voulez rester, il suffira de vous abonner.",
      `Une question ? Répondez à cet email ou écrivez à ${SUPPORT}.`,
    ],
    bouton: { texte: 'Ouvrir le bot Telegram', url: lienBot },
  }
}

/**
 * Pause : 'debut' quand la pause commence (le membre sort du groupe),
 * 'j7' une semaine avant la reprise des prelevements.
 */
export function modeleRappelPause(repriseLe: string, moment: 'debut' | 'j7' = 'debut', canal: Canal = 'telegram'): ModeleMessage {
  const date = formaterDateFr(repriseLe)
  if (moment === 'j7') {
    return {
      sujet: ton(canal, 'Ta pause du Live Club se termine bientôt', 'Votre pause du Live Club se termine bientôt'),
      paragraphes: [
        ton(canal, 'Salut !', 'Bonjour,'),
        ton(canal,
          `Petit rappel : ta pause se termine le ${date}. Ce jour-là, ton abonnement reprend et le prélèvement repart sur ta carte habituelle.`,
          `Petit rappel : votre pause se termine le ${date}. Ce jour-là, votre abonnement reprend et le prélèvement repart sur votre carte habituelle.`),
        ton(canal,
          "Dès que le paiement est passé, on t'envoie de quoi revenir dans le groupe.",
          'Dès que le paiement est passé, on vous envoie de quoi revenir dans le groupe.'),
        canal === 'telegram'
          ? `Tu préfères arrêter ou changer quelque chose ? Écris-moi ici avant le ${date}.`
          : `Vous préférez arrêter ou changer quelque chose ? Répondez à cet email avant le ${date}.`,
      ],
    }
  }
  return {
    sujet: ton(canal, 'Ta pause du Live Club a commencé', 'Votre pause du Live Club a commencé'),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      ton(canal,
        "Ta pause a commencé : ta période payée est terminée, donc tu sors du groupe Telegram pour le moment. Rien n'est prélevé pendant la pause.",
        "Votre pause a commencé : votre période payée est terminée, donc vous sortez du groupe Telegram pour le moment. Rien n'est prélevé pendant la pause."),
      ton(canal,
        `Ton abonnement reprend tout seul le ${date}. Dès que le paiement est passé, on t'envoie de quoi revenir dans le groupe.`,
        `Votre abonnement reprend tout seul le ${date}. Dès que le paiement est passé, on vous envoie de quoi revenir dans le groupe.`),
      phraseQuestion(canal),
    ],
  }
}

/**
 * Debut d'une pause SANS date de reprise (posee « indefiniment » au
 * Dashboard Stripe) : rien ne reprend tout seul, le membre doit demander.
 */
export function modeleDebutPauseSansReprise(canal: Canal = 'telegram'): ModeleMessage {
  return {
    sujet: ton(canal, 'Ta pause du Live Club a commencé', 'Votre pause du Live Club a commencé'),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      ton(canal,
        "Ta pause a commencé : ta période payée est terminée, donc tu sors du groupe Telegram pour le moment. Rien n'est prélevé pendant la pause.",
        "Votre pause a commencé : votre période payée est terminée, donc vous sortez du groupe Telegram pour le moment. Rien n'est prélevé pendant la pause."),
      ton(canal,
        "Ta pause n'a pas de date de fin. Quand tu veux reprendre, écris-moi ici : on relance ton abonnement, et dès que le paiement est passé, on t'envoie de quoi revenir dans le groupe.",
        "Votre pause n'a pas de date de fin. Quand vous voulez reprendre, répondez à cet email : on relance votre abonnement, et dès que le paiement est passé, on vous envoie de quoi revenir dans le groupe."),
    ],
  }
}

export function modeleRetour(lienBot: string, canal: Canal = 'telegram'): ModeleMessage {
  return {
    sujet: ton(canal, 'Ton retour dans le Live Club', 'Votre retour dans le Live Club'),
    paragraphes: [
      ton(canal, 'Salut, content de te revoir !', 'Bonjour, contents de vous revoir !'),
      ton(canal,
        "Ton abonnement a repris. Pour revenir dans le groupe Telegram, ouvre notre bot avec le bouton ci-dessous et appuie sur Démarrer : il te redonne le lien du groupe.",
        'Votre abonnement a repris. Pour revenir dans le groupe Telegram, ouvrez notre bot avec le bouton ci-dessous et appuyez sur Démarrer : il vous redonne le lien du groupe.'),
      phraseQuestion(canal, 'Un souci ?'),
    ],
    bouton: { texte: 'Revenir dans le groupe', url: lienBot },
  }
}

// Les messages « abonne-toi » donnent les DEUX portes (Brice, 29/09) dans le
// texte, par texteAbonnement() : pas de bouton qui en mettrait une seule en
// avant. Les adresses deviennent des liens dans l'email (paragrapheHtml), et
// Telegram les rend cliquables tout seul.

export function modeleRappelFinBroker(jusquau: string, canal: Canal = 'telegram'): ModeleMessage {
  return {
    sujet: ton(canal, 'Ton accès au Live Club se termine dans une semaine', 'Votre accès au Live Club se termine dans une semaine'),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      ton(canal,
        `Ton accès offert au Live Club se termine le ${formaterDateFr(jusquau)}. Il n'est pas renouvelable.`,
        `Votre accès offert au Live Club se termine le ${formaterDateFr(jusquau)}. Il n'est pas renouvelable.`),
      ton(canal,
        "Si tu veux rester dans le groupe, abonne-toi avant cette date avec la même adresse email, et tu n'auras rien d'autre à faire.",
        "Si vous voulez rester dans le groupe, abonnez-vous avant cette date avec la même adresse email, et vous n'aurez rien d'autre à faire."),
      texteAbonnement(canal === 'email'),
      phraseQuestion(canal),
    ],
  }
}

export function modeleFinBroker(canal: Canal = 'telegram'): ModeleMessage {
  return {
    sujet: ton(canal, 'Ton accès au Live Club est terminé', 'Votre accès au Live Club est terminé'),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      ton(canal,
        "Ton accès offert au Live Club est arrivé à son terme, donc tu sors du groupe Telegram. Merci d'avoir été là.",
        "Votre accès offert au Live Club est arrivé à son terme, donc vous sortez du groupe Telegram. Merci d'avoir été là."),
      ton(canal,
        "Tu veux revenir ? Abonne-toi avec la même adresse email, et on t'envoie de quoi rentrer dans le groupe.",
        'Vous voulez revenir ? Abonnez-vous avec la même adresse email, et on vous envoie de quoi rentrer dans le groupe.'),
      texteAbonnement(canal === 'email'),
      phraseQuestion(canal),
    ],
  }
}

/**
 * Exemption datee (Brice, 06/10) : rappel une semaine avant la date (le
 * dernier jour d'acces, jusquau inclus), puis message le jour de la sortie.
 */
export function modeleRappelFinExemption(jusquau: string, canal: Canal = 'telegram'): ModeleMessage {
  return {
    sujet: ton(canal, 'Ton accès au Live Club se termine bientôt', 'Votre accès au Live Club se termine bientôt'),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      ton(canal,
        `Ton accès au Live Club se termine le ${formaterDateFr(jusquau)}.`,
        `Votre accès au Live Club se termine le ${formaterDateFr(jusquau)}.`),
      ton(canal, 'Pour rester dans le groupe, abonne-toi avant cette date.', 'Pour rester dans le groupe, abonnez-vous avant cette date.'),
      texteAbonnement(canal === 'email'),
      phraseQuestion(canal),
    ],
  }
}

export function modeleFinExemption(canal: Canal = 'telegram'): ModeleMessage {
  return {
    sujet: ton(canal, 'Ton accès au Live Club est terminé', 'Votre accès au Live Club est terminé'),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      ton(canal,
        "Ton accès offert au Live Club est arrivé à son terme, donc tu sors du groupe Telegram. Merci d'avoir été là.",
        "Votre accès offert au Live Club est arrivé à son terme, donc vous sortez du groupe Telegram. Merci d'avoir été là."),
      ton(canal,
        "Pour revenir, abonne-toi, et on t'envoie de quoi rentrer dans le groupe.",
        'Pour revenir, abonnez-vous, et on vous envoie de quoi rentrer dans le groupe.'),
      texteAbonnement(canal === 'email'),
      phraseQuestion(canal),
    ],
  }
}

/**
 * Sortie d'un desabonne (seulement quand LIVECLUB_SORTIES_ACTIVES vaut '1') :
 * pourquoi, et comment revenir.
 */
export function modeleSortieDesabonne(canal: Canal = 'telegram'): ModeleMessage {
  return {
    sujet: ton(canal, 'Ton abonnement au Live Club est terminé', 'Votre abonnement au Live Club est terminé'),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      ton(canal,
        "Ton abonnement au Live Club est terminé, donc tu sors du groupe Telegram. Merci d'avoir été là.",
        "Votre abonnement au Live Club est terminé, donc vous sortez du groupe Telegram. Merci d'avoir été là."),
      ton(canal,
        "Tu veux revenir ? Abonne-toi avec la même adresse email, et on t'envoie de quoi rentrer dans le groupe.",
        'Vous voulez revenir ? Abonnez-vous avec la même adresse email, et on vous envoie de quoi rentrer dans le groupe.'),
      texteAbonnement(canal === 'email'),
      ton(canal,
        "Tu penses que c'est une erreur ? Écris-moi ici, on regarde tout de suite.",
        "Vous pensez que c'est une erreur ? Répondez à cet email, on regarde tout de suite."),
    ],
  }
}

/**
 * Rappel 3 jours avant un prelevement. echeance = jour du prelevement a
 * l'heure de Paris (jourParis). montant null = on ne le connait pas (apercu
 * de facture illisible) : le message ne donne que la date. lienBot : donne
 * seulement quand le message part par email (en prive, le membre est deja
 * dans le bot) ; c'est aussi lui qui dit le canal (avec lienBot : email, donc
 * vouvoiement).
 *
 * (16/10, Brice) Un rappel PREVIENT, il ne propose rien : plus de « tu veux
 * faire une pause ou arreter ? » (c'etait entrouvrir la porte), et plus de
 * renvoi vers support@ (l'equipe repond dans le bot).
 */
export function modeleRappelPrelevement(
  echeance: string,
  montant: { centimes: number; devise: string } | null,
  lienBot?: string,
): ModeleMessage {
  const date = formaterDateFr(echeance)
  const canal: Canal = lienBot ? 'email' : 'telegram'
  const question = lienBot ? `Une question ? Écrivez au bot du Live Club : ${lienBot}` : 'Une question ? Écris-moi ici.'
  return {
    sujet: ton(canal, `Ton prochain prélèvement Live Club, le ${date}`, `Votre prochain prélèvement Live Club, le ${date}`),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      montant
        ? ton(canal,
          `Petit rappel : ton abonnement au Live Club se renouvelle le ${date}. ${formaterMontant(montant.centimes, montant.devise)} seront prélevés sur ta carte habituelle.`,
          `Petit rappel : votre abonnement au Live Club se renouvelle le ${date}. ${formaterMontant(montant.centimes, montant.devise)} seront prélevés sur votre carte habituelle.`)
        : ton(canal,
          `Petit rappel : ton abonnement au Live Club se renouvelle le ${date}, avec un prélèvement sur ta carte habituelle.`,
          `Petit rappel : votre abonnement au Live Club se renouvelle le ${date}, avec un prélèvement sur votre carte habituelle.`),
      ton(canal,
        "Ta carte a changé ou arrive en fin de validité ? Mets-la à jour avant cette date avec le bouton ci-dessous. Tu te connectes avec l'email de ton paiement.",
        "Votre carte a changé ou arrive en fin de validité ? Mettez-la à jour avant cette date avec le bouton ci-dessous. Vous vous connectez avec l'email de votre paiement."),
      question,
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
      phraseQuestion('telegram', 'Un souci ?'),
    ],
    bouton: { texte: 'Revenir dans le groupe', url: lienGroupe },
  }
}

// ---------------------------------------------------------------------------
// Impayes (Brice, 30/09)
// ---------------------------------------------------------------------------

/**
 * Sortie du groupe 5 jours apres le premier echec de paiement. Ton neutre :
 * le montant du, le lien de la facture (le bouton quand il n'y en a qu'une,
 * dans le texte sinon), le tarif garde dans les 30 jours (limite = premier
 * echec + 30 jours), et comment revenir.
 *
 * (22/10, Brice, cas de Christine : sortie a 09:13, payee a 09:23, rien
 * jusqu'au passage du lendemain) Il n'y a pas de webhook Stripe : « ton acces
 * rouvre tout seul » etait faux pendant presque 24 h. En prive, le bouton
 * BOUTON_REGLE (« J'ai réglé : revenir dans le groupe ») fait relire le droit
 * en direct par le bot, qui donne le lien tout de suite (bot-membre.ts). Par
 * email : le lien du bot, ou un message ecrit donne le meme lien. Le passage
 * du lendemain matin reste le filet.
 */
export function modeleSortieImpaye(aRegler: readonly FactureARegler[], limite: string, canal: Canal = 'telegram'): ModeleMessage {
  const une = aRegler.length === 1 && aRegler[0].lien ? aRegler[0] : null
  return {
    sujet: ton(canal, 'Ton accès au Live Club est suspendu', 'Votre accès au Live Club est suspendu'),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      ton(canal,
        "Ton dernier paiement pour le Live Club n'est pas passé, et ça fait maintenant plus de 5 jours. Ton accès au groupe Telegram est donc suspendu pour le moment.",
        "Votre dernier paiement pour le Live Club n'est pas passé, et ça fait maintenant plus de 5 jours. Votre accès au groupe Telegram est donc suspendu pour le moment."),
      ...(aRegler.length ? [phraseARegler(aRegler, { lienDansLeTexte: !une, vous: canal === 'email' })] : []),
      phraseRetourApresReglement(canal, lienBotAccueil()),
      ton(canal,
        `Ton tarif actuel est gardé si tu règles dans les 30 jours, donc avant le ${formaterDateFr(limite)}.`,
        `Votre tarif actuel est gardé si vous réglez dans les 30 jours, donc avant le ${formaterDateFr(limite)}.`),
      phraseQuestion(canal),
    ],
    ...(une?.lien ? { bouton: { texte: 'Régler ma facture', url: une.lien } } : {}),
    ...(canal === 'telegram' ? { boutonBot: { texte: BOUTON_REGLE.texte, data: BOUTON_REGLE.data } } : {}),
  }
}

/**
 * Reouverture apres une sortie pour impaye (notre bot ou Metricgram) : la
 * phrase de Brice, puis le lien. 'prive' : un lien de DEMANDE d'adhesion
 * (jamais par email). 'email' : le lien personnel vers le bot, qui donne le
 * lien du groupe.
 */
export function modeleReouverture(lien: string, canal: 'prive' | 'email'): ModeleMessage {
  return {
    sujet: canal === 'prive' ? 'Ton accès au Live Club est réouvert' : 'Votre accès au Live Club est réouvert',
    paragraphes: [
      canal === 'prive'
        ? 'Ton paiement est passé, ton accès au Live Club est réouvert. Clique ici pour revenir.'
        : 'Votre paiement est passé, votre accès au Live Club est réouvert. Cliquez ici pour revenir.',
      canal === 'prive'
        ? "Appuie sur le bouton ci-dessous et demande à rejoindre le groupe : c'est accepté tout seul. Le lien marche pendant 14 jours."
        : 'Le bouton ci-dessous ouvre notre bot Telegram : appuyez sur Démarrer, il vous redonne le lien du groupe.',
      phraseQuestion(canal === 'prive' ? 'telegram' : 'email', 'Un souci ?'),
    ],
    bouton: { texte: 'Revenir dans le groupe', url: lien },
  }
}

/**
 * La fenetre de 30 jours est depassee : l'abonnement est arrete. factureAnnulee
 * = toutes ses factures ouvertes ont ete annulees (il n'a plus rien a regler).
 */
export function modeleFinFenetre(factureAnnulee: boolean, canal: Canal = 'telegram'): ModeleMessage {
  return {
    sujet: ton(canal, 'Ton abonnement au Live Club est terminé', 'Votre abonnement au Live Club est terminé'),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      ton(canal,
        `Ton dernier paiement pour le Live Club n'a pas été réglé dans les 30 jours, donc ton abonnement est arrêté et ton accès au groupe a pris fin.${factureAnnulee ? " Ta facture en attente est annulée : tu n'as plus rien à régler." : ''}`,
        `Votre dernier paiement pour le Live Club n'a pas été réglé dans les 30 jours, donc votre abonnement est arrêté et votre accès au groupe a pris fin.${factureAnnulee ? " Votre facture en attente est annulée : vous n'avez plus rien à régler." : ''}`),
      ton(canal,
        "Tu veux revenir ? Abonne-toi avec la même adresse email, et on t'envoie de quoi rentrer dans le groupe.",
        'Vous voulez revenir ? Abonnez-vous avec la même adresse email, et on vous envoie de quoi rentrer dans le groupe.'),
      texteAbonnement(canal === 'email'),
      phraseQuestion(canal),
    ],
  }
}

// ---------------------------------------------------------------------------
// (31/10) Le suivi des lots d'un acces broker (lots-pur.ts) : les deux
// relances et le message de la pause. En prive, les textes de lots-pur.ts et
// le bouton BOUTON_LOTS ; par email (bot bloque), le vouvoiement et le lien du
// bot (le membre y dit que c'est fait). Jamais de ban, rien de definitif.
// ---------------------------------------------------------------------------

const EXEMPLE_LOTS_PHRASE = `${EXEMPLE_LOTS}, avec une position tenue ${TENUE_LOTS}`

/** Relance 1 (pas-a-pas) ou 2 (quelques jours avant la fin du delai). limite = 'YYYY-MM-DD'. */
export function modeleRelanceLots(n: 1 | 2, limite: string, canal: Canal = 'telegram'): ModeleMessage {
  if (canal === 'telegram') {
    return {
      sujet: n === 1 ? 'Tes premiers lots chez le broker' : 'Quelques jours pour tes premiers lots',
      paragraphes: (n === 1 ? texteRelanceLots1(limite) : texteRelanceLots2(limite)).split('\n\n'),
      boutonBot: { texte: BOUTON_LOTS.texte, data: BOUTON_LOTS.data },
    }
  }
  const auBot = `dites-le au bot du Live Club (${lienBotAccueil()}) ou répondez à cet email : l'équipe vérifie chez le broker.`
  const dire = `Quand c'est fait, ${auBot}`
  return n === 1
    ? {
      sujet: 'Vos premiers lots chez le broker',
      paragraphes: [
        'Bonjour,',
        "Petit rappel pour votre accès au Live Club par le broker : vos premiers lots ne sont pas encore tradés chez lui, et tant qu'ils ne le sont pas, l'affiliation ne nous paie pas.",
        `Le plus simple : ouvrez votre plateforme chez le broker, prenez une position de ${EXEMPLE_LOTS}, gardez-la ${TENUE_LOTS}, puis fermez-la.`,
        `C'est tout, et vous avez jusqu'au ${formaterDateFr(limite)}. ${dire}`,
      ],
    }
    : {
      sujet: 'Quelques jours pour vos premiers lots',
      paragraphes: [
        'Bonjour,',
        `Il vous reste quelques jours pour trader vos premiers lots chez le broker : jusqu'au ${formaterDateFr(limite)}. Pour rappel, ${EXEMPLE_LOTS_PHRASE} suffisent.`,
        "Passé cette date, votre accès au groupe se met en pause tant que les lots ne sont pas faits. Rien de définitif : vous revenez dès que l'équipe les voit chez le broker.",
        `Déjà fait ? ${auBot.charAt(0).toUpperCase()}${auBot.slice(1)}`,
      ],
    }
}

/** Le message de la pause de l'acces (le passage vient de le sortir du groupe, sans ban). */
export function modeleSuspensionLots(canal: Canal = 'telegram'): ModeleMessage {
  if (canal === 'telegram') {
    return {
      sujet: 'Ton accès au Live Club est en pause',
      paragraphes: texteSuspensionLots().split('\n\n'),
      boutonBot: { texte: BOUTON_LOTS.texte, data: BOUTON_LOTS.data },
    }
  }
  return {
    sujet: 'Votre accès au Live Club est en pause',
    paragraphes: [
      'Bonjour,',
      'Vos premiers lots ne sont pas encore tradés chez le broker, et le délai est passé : votre accès au groupe Telegram est donc en pause pour le moment.',
      `Rien de définitif : dès que vos lots sont faits (${EXEMPLE_LOTS_PHRASE}, par exemple), dites-le au bot du Live Club (${lienBotAccueil()}) ou répondez à cet email. L'équipe vérifie chez le broker, et le bot vous redonne votre lien vers le groupe.`,
      phraseQuestion('email'),
    ],
  }
}

export function emailRelanceLots(email: string, n: 1 | 2, limite: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleRelanceLots(n, limite, 'email'))
}

export function emailSuspensionLots(email: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleSuspensionLots('email'))
}

/**
 * (31/10, Brice : « pas de commission pas d'acces ») L'acces broker ferme
 * parce que le depot n'a pas ete active (lots-pur.ts) : pourquoi, sans
 * reproche, et les deux portes (regulariser avec l'equipe, ou s'abonner). En
 * prive, le bouton « Contacter l'équipe » ; par email, repondre a l'email.
 */
export function modeleFermetureDepot(canal: Canal = 'telegram'): ModeleMessage {
  if (canal === 'telegram') {
    return {
      sujet: "Ton accès au Live Club par le broker n'est plus valide",
      paragraphes: texteFermetureDepot(texteAbonnement()).split('\n\n'),
      boutonBot: { texte: BOUTON_EQUIPE_DEPOT.texte, data: BOUTON_EQUIPE_DEPOT.data },
    }
  }
  return {
    sujet: "Votre accès au Live Club par le broker n'est plus valide",
    paragraphes: [
      'Bonjour,',
      "Votre accès au Live Club par le broker n'est plus valide : votre dépôt chez lui n'a pas été activé. Votre accès au groupe Telegram est donc fermé pour le moment.",
      "Pour revenir, deux possibilités : régulariser avec l'équipe (un nouveau dépôt activé chez le broker, puis vos premiers lots tradés), ou vous abonner au Live Club. "
        + "Pour régulariser, répondez à cet email : l'équipe vous répond.",
      texteAbonnement(true),
    ],
  }
}

export function emailFermetureDepot(email: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleFermetureDepot('email'))
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

/** Le modele en texte brut (message prive Telegram sans HTML, et corps texte d'un email avant sa signature). */
export function texteTelegram(m: ModeleMessage): string {
  return [...m.paragraphes, ...(m.bouton ? [`${m.bouton.texte} : ${m.bouton.url}`] : [])].join('\n\n')
}

/** La signature d'un email (brief F1, Brice 30/10). Jamais en message prive : le bot parle en son nom. */
export const SIGNATURE_EMAIL = 'Brice et Mélanie'

/** Le texte brut d'un email : le modele, puis la signature. */
export function texteEmail(m: ModeleMessage): string {
  return `${texteTelegram(m)}\n\n${SIGNATURE_EMAIL}`
}

export function htmlEmail(m: ModeleMessage): string {
  const corps = m.paragraphes
    .map(p => `<p style="margin:0 0 16px;line-height:1.5">${paragrapheHtml(p)}</p>`)
    .join('\n')
  const bouton = m.bouton
    ? `<p style="margin:24px 0"><a href="${echapperHtml(m.bouton.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">${echapperHtml(m.bouton.texte)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280">Si le bouton ne marche pas, copiez ce lien : ${echapperHtml(m.bouton.url)}</p>`
    : ''
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#ffffff;color:#111827;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px">
<div style="max-width:560px;margin:0 auto">
${corps}
${bouton}
<p style="margin:32px 0 0;line-height:1.5">${echapperHtml(SIGNATURE_EMAIL)}</p>
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
      text: texteEmail(m),
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

export function emailAccesBroker(email: string, lienBot: string, jusquau: string, mois?: number): Promise<ResultatEmail> {
  return envoyerModele(email, modeleAccesBroker(lienBot, jusquau, mois))
}

export function emailRappelPause(email: string, repriseLe: string, moment: 'debut' | 'j7' = 'debut'): Promise<ResultatEmail> {
  return envoyerModele(email, modeleRappelPause(repriseLe, moment, 'email'))
}

export function emailDebutPauseSansReprise(email: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleDebutPauseSansReprise('email'))
}

export function emailRetour(email: string, lienBot: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleRetour(lienBot, 'email'))
}

export function emailRappelFinBroker(email: string, jusquau: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleRappelFinBroker(jusquau, 'email'))
}

export function emailFinBroker(email: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleFinBroker('email'))
}

export function emailRappelFinExemption(email: string, jusquau: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleRappelFinExemption(jusquau, 'email'))
}

export function emailFinExemption(email: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleFinExemption('email'))
}

export function emailSortieDesabonne(email: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleSortieDesabonne('email'))
}

export function emailSortieImpaye(email: string, aRegler: readonly FactureARegler[], limite: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleSortieImpaye(aRegler, limite, 'email'))
}

/** lienBot : le lien PERSONNEL vers le bot (jamais un lien d'invitation du groupe). */
export function emailReouverture(email: string, lienBot: string): Promise<ResultatEmail> {
  return envoyerModele(email, modeleReouverture(lienBot, 'email'))
}

export function emailFinFenetre(email: string, factureAnnulee: boolean): Promise<ResultatEmail> {
  return envoyerModele(email, modeleFinFenetre(factureAnnulee, 'email'))
}

export function emailRappelPrelevement(
  email: string, echeance: string, montant: { centimes: number; devise: string } | null,
): Promise<ResultatEmail> {
  return envoyerModele(email, modeleRappelPrelevement(echeance, montant, lienBotAccueil()))
}
