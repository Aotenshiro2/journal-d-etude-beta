// (01/11) PAUSE DE L'ABONNEMENT + ACCES PAR DEPOT BROKER, pour un membre DEJA
// abonne au Live Club. Module PUR (aucune base, aucun reseau) : l'offre, la
// lecture des parametres de la carte d'Agent AOK, les dates, les refus, les
// textes (cartes, membre, equipe) et l'enchainement du clic, ses outils en
// parametre (executerPauseDepotAvec). Le serveur : pause-depot.ts. Teste par
// scripts/verifier-pause-depot.mjs (faux Stripe, fausse base).
//
// Le besoin (Brice et Mel, 01/11) : un abonne fait un depot chez un broker
// partenaire, ce qui lui donne 6 mois de Live Club. Pendant ces 6 mois, son
// abonnement est en PAUSE (aucun prelevement) et il GARDE le groupe, sans
// trou. A la fin, l'abonnement reprend tout seul, ou il choisit d'arreter.
// Premier cas : Arthur, abonne depuis le 07/06, renouvellement le 07/11/2026.
//
// LE PARCOURS
// 1. Le membre (bot du Live Club, outil pause_par_depot) : l'offre en court.
//    Les conditions (broker, lien d'affiliation, depot minimum, lots) viennent
//    d'OFFRE_PAUSE_DEPOT (config.ts), EN ATTENTE DE MEL : tant qu'une seule
//    manque, le bot n'en donne aucune (rien d'invente), il dit que l'equipe
//    les lui envoie et l'equipe est prevenue par l'alerte existante (« un
//    membre demande un humain », Brice et Mel). Quand il dit que son depot
//    est fait : la meme alerte, l'equipe verifie chez le broker.
// 2. L'equipe (Agent AOK, carte « dépôt broker d'un abonné : pause + accès ») :
//    au clic, EN UNE FOIS (executerPauseDepotAvec) :
//    a. l'acces broker pose MALGRE l'abonnement en cours (le refus
//       'deja_abonne' d'accorderAccesBroker, acces.ts, ne vaut pas pour ce
//       parcours, et pour lui seul : il ne passe pas par accorderAccesBroker),
//       relie a son compte Telegram (il est deja dans le groupe : aucun email
//       d'invitation), jusqu'au jour de la reprise INCLUS ;
//    b. le depot inscrit comme la carte de depot broker (commission figee,
//       lots, 70/30 et mois des lots inchanges : repartition/serveur.ts), et
//       relie a cet acces ; un depot deja inscrit sans acces (carte de depot
//       d'un abonne, avant ce parcours) est relie, jamais inscrit deux fois ;
//    c. l'abonnement mis en pause par le chemin existant (pauser, stripe.ts,
//       la cle STRIPE_AGENT_KEY_MELANIE) : la periode payee va a son terme,
//       puis plus aucun prelevement jusqu'a la reprise ;
//    d. un message au membre, en prive sinon par email, une fois.
//    LES DATES SONT ALIGNEES : reprise = fin de la periode payee + N mois
//    (calculerReprisePause, la regle de toute pause), et l'acces broker court
//    jusqu'a ce jour-la inclus. Avant la fin de la periode payee, l'abonnement
//    ouvre le groupe ; pendant la pause, l'acces broker ; le jour de la
//    reprise, les deux. Pas de trou, pas de double paiement.
// 3. Le groupe : pendant la pause, droitLiveClub ne compte plus l'abonnement
//    (pause effective) mais trouve l'acces broker par le compte Telegram :
//    'oui', donc ni le debut de pause ni la fin de l'acces ne le sortent.
// 4. Fin : le rappel J-7 de la pause (passage, tache a) part avec le texte de
//    ce parcours (il reste dans le groupe ; arreter, c'est le dire au bot) ;
//    le rappel J-7 de fin d'acces broker (tache b) est saute tant que
//    l'abonnement reprend ; la reprise est celle de Stripe, automatique.
//
// LE MARQUEUR : une ligne du journal (cockpit_liveclub_gestes, geste
// 'acces_broker', regle REGLE_PAUSE_DEPOT, details.acces_id et abonnement_id),
// ecrite dans la MEME transaction que l'acces. AUCUNE migration : le motif de
// l'acces reste 'broker' (check de la table) ; c'est cette ligne qui dit qu'un
// acces appartient a ce parcours (droits, lots, passage, resume, vue).
//
// LES LOTS : le suivi des lots s'applique (paragraphe des lots dans le message
// du clic, relances J+14 et J+18 avec le texte de ce parcours, carte « lots
// tradés oui / non »). Lots pas faits a la fin du delai : la pause de l'ACCES
// (sortie du groupe) ne s'applique PAS ici, son abonnement etant en pause.
// PROPOSITION a faire valider par Brice (SUITE_LOTS_PAUSE_DEPOT) : la pause
// s'arrete et l'abonnement reprend. En attendant sa decision : il garde le
// groupe, et l'equipe est prevenue UNE fois dans Agent AOK (texteAlerteLotsPauseDepot),
// qui lui propose la carte de reprise de l'abonnement.

import { COMMISSION_PAUSE_DEPOT, OFFRE_PAUSE_DEPOT } from './config'
import { calculerReprisePause, dateIso, formaterDateFr, normaliserEmail, phraseQuestion } from './pur'
import {
  BOUTON_LOTS, DELAI_LOTS_JOURS, ETAPES_LOTS, EXEMPLE_LOTS, RELANCE_LOTS_1_JOURS, RELANCE_LOTS_2_AVANT_FIN_JOURS,
  SUIVI_LOTS_DEPUIS, TENUE_LOTS, jourPlus, paragrapheLotsAdmission,
} from './lots-pur'
import { centimes, euros, jourCourt, libelleJour, slugPartenaire } from '../repartition/pur'

// ---------------------------------------------------------------------------
// L'offre
// ---------------------------------------------------------------------------

export type OffrePauseDepot = { partenaire: string; lien: string; depotMinimum: string; lots: string }

/** La duree de l'acces (et de la pause) par defaut : 6 mois, la duree de la regle de toute pause au plus. */
export const MOIS_PAUSE_DEPOT = 6
/** = nbMoisPauseValide (pur.ts) : une pause dure de 1 a 6 mois. */
export const MOIS_PAUSE_DEPOT_MAX = 6

/** Les quatre conditions sont la (et le lien est une adresse https). Une seule manque : aucune n'est donnee. */
export function conditionsCompletes(o: OffrePauseDepot = OFFRE_PAUSE_DEPOT): boolean {
  return Boolean(o.partenaire.trim() && o.depotMinimum.trim() && o.lots.trim() && /^https:\/\/\S+$/.test(o.lien.trim()))
}

// ---------------------------------------------------------------------------
// Les noms (carte, outils, journal)
// ---------------------------------------------------------------------------

/** Le type d'action de la carte (stripe-actions.ts, agent-cockpit.ts). */
export const TYPE_PAUSE_DEPOT = 'pause_depot'
/** L'outil d'Agent AOK. */
export const NOM_OUTIL_AGENT_PAUSE_DEPOT = 'proposer_pause_depot'
/** L'outil du bot des membres. */
export const NOM_OUTIL_MEMBRE_PAUSE_DEPOT = 'pause_par_depot'

/** Journal : le marqueur du parcours (geste 'acces_broker') ET la pause posee (geste 'pause'). */
export const REGLE_PAUSE_DEPOT = 'pause_depot'
/** Journal (geste 'acces_broker') : le membre demande l'offre. */
export const REGLE_DEMANDE_PAUSE_DEPOT = 'pause_depot_demande'
/** Journal (geste 'acces_broker') : le membre dit que son depot est fait. */
export const REGLE_DECLARATION_PAUSE_DEPOT = 'pause_depot_declare'
/** Journal (geste 'acces_broker') : lots pas faits a la fin du delai, l'equipe prevenue (une fois par depot). */
export const REGLE_LOTS_PAUSE_DEPOT = 'pause_depot_lots'
/** Journal (geste 'rappel') : le message au membre apres le clic (une fois par acces). */
export const REGLE_MESSAGE_PAUSE_DEPOT = 'pause_depot_message'

/**
 * (01/11) La suite quand les lots ne sont pas faits a la fin du delai, POUR
 * CE PARCOURS. 'equipe' (en service, en attendant Brice) : il garde le groupe,
 * son abonnement reste en pause, et l'equipe est prevenue une fois pour
 * decider. 'reprise' (la PROPOSITION, pas codee) : la pause s'arrete et
 * l'abonnement reprend. Rien ne coupe l'acces sans que l'abonnement reprenne.
 */
export const SUITE_LOTS_PAUSE_DEPOT: 'equipe' | 'reprise' = 'equipe'

// ---------------------------------------------------------------------------
// Les textes au membre (bot du Live Club : tutoiement ; emails : vouvoiement)
// ---------------------------------------------------------------------------

/** Ce que le serveur repond au membre (outil pause_par_depot) ; equipe = l'alerte part. */
export type ReponseMembrePauseDepot = { texte: string; equipe: boolean; regle: string | null }

const ENTETE_OFFRE = (chez: string, mois: number) =>
  `Oui, c'est possible ! En faisant un dépôt ${chez}, tu as ${mois} mois de Live Club offerts. `
  + `Pendant ces ${mois} mois, ton abonnement est en pause : rien n'est prélevé, et tu restes dans le groupe, sans coupure. `
  + `À la fin, il reprend tout seul, ou tu arrêtes si tu préfères.`

/**
 * L'offre en court. Conditions completes : le broker, le depot minimum, les
 * lots et le lien, tels quels. Une seule manque : AUCUNE n'est donnee,
 * l'equipe les envoie (et elle est prevenue).
 */
export function texteOffrePauseDepot(o: OffrePauseDepot = OFFRE_PAUSE_DEPOT, mois = MOIS_PAUSE_DEPOT): { texte: string; equipe: boolean } {
  if (!conditionsCompletes(o)) {
    return {
      texte: `${ENTETE_OFFRE('chez notre broker partenaire', mois)}\n\n`
        + "Les conditions (le broker, le dépôt minimum et les premiers lots à trader), c'est l'équipe qui te les envoie, ici même : je viens de la prévenir.",
      equipe: true,
    }
  }
  const partenaire = o.partenaire.trim()
  return {
    texte: [
      ENTETE_OFFRE(`chez ${partenaire}, notre broker partenaire`, mois),
      `Les conditions : un dépôt d'au moins ${o.depotMinimum.trim()}, puis tes premiers lots à trader (${o.lots.trim()}). Pour ouvrir ton compte, passe par ce lien : ${o.lien.trim()}`,
      "Quand ton dépôt est fait, dis-le-moi ici : l'équipe vérifie chez le broker, met ta pause en place et te le confirme.",
    ].join('\n\n'),
    equipe: false,
  }
}

export const TEXTE_DEPOT_DECLARE_PAUSE = "Merci, c'est noté ! Je préviens l'équipe : elle vérifie ton dépôt chez le broker, puis met ton abonnement en pause et te le confirme ici. D'ici là, rien ne change pour toi."

export const TEXTE_PAS_ABONNE_PAUSE = "Ce parcours sert à mettre un abonnement en pause pendant l'accès par le broker, et je ne trouve pas d'abonnement en cours à ton nom. "
  + "Je préviens l'équipe : elle voit avec toi, ici, ce qui est possible."

export const TEXTE_PANNE_PAUSE_DEPOT = "Je n'arrive pas à lire ton abonnement là, tout de suite. Réessaie dans un moment, ou appuie sur « Contacter l'équipe » : elle te répond ici."

export function texteDejaEnPlace(o: { partenaire: string | null; repriseLe: string }): string {
  return `C'est déjà en place : ta pause par le dépôt${o.partenaire ? ` chez ${o.partenaire}` : ''} court jusqu'au ${formaterDateFr(o.repriseLe)}, `
    + `et tu gardes le groupe jusque-là, sans coupure. Ce jour-là, ton abonnement reprend tout seul.`
}

export type EtatMembrePauseDepot =
  | { genre: 'panne' }
  | { genre: 'pas_abonne' }
  | { genre: 'en_place'; partenaire: string | null; repriseLe: string }
  | { genre: 'abonne' }

export type EtapeMembrePauseDepot = 'renseignement' | 'depot_fait'

/** L'etape demandee par le modele : 'depot_fait' seulement si c'est dit, sinon le renseignement. */
export function lireEtapeMembre(entree: unknown): EtapeMembrePauseDepot {
  const e = entree && typeof entree === 'object' ? (entree as Record<string, unknown>).etape : null
  return e === 'depot_fait' ? 'depot_fait' : 'renseignement'
}

/**
 * La reponse du serveur au membre, d'apres son etat relu juste avant (grille
 * de Brice : l'etat, pas une sequence). equipe = la reponse part avec
 * l'alerte « un membre demande un humain » (Brice et Mel) ; regle = la ligne
 * du journal (et du fil Support) a ecrire, null = aucune.
 */
export function reponseMembrePauseDepot(
  etat: EtatMembrePauseDepot, etape: EtapeMembrePauseDepot, offre: OffrePauseDepot = OFFRE_PAUSE_DEPOT,
): ReponseMembrePauseDepot {
  switch (etat.genre) {
    case 'panne': return { texte: TEXTE_PANNE_PAUSE_DEPOT, equipe: false, regle: null }
    case 'en_place': return { texte: texteDejaEnPlace(etat), equipe: false, regle: null }
    case 'pas_abonne': return { texte: TEXTE_PAS_ABONNE_PAUSE, equipe: true, regle: REGLE_DEMANDE_PAUSE_DEPOT }
    case 'abonne':
      if (etape === 'depot_fait') return { texte: TEXTE_DEPOT_DECLARE_PAUSE, equipe: true, regle: REGLE_DECLARATION_PAUSE_DEPOT }
      return { ...texteOffrePauseDepot(offre), regle: REGLE_DEMANDE_PAUSE_DEPOT }
  }
}

/** Un message au membre, prive ou email : la forme de ModeleMessage (emails.ts). */
export type ModelePauseDepot = {
  sujet: string
  paragraphes: string[]
  boutonBot?: { texte: string; data: string }
}

type Canal = 'telegram' | 'email'
const ton = (canal: Canal, tu: string, vous: string) => (canal === 'email' ? vous : tu)
const EXEMPLE_LOTS_PHRASE = `${EXEMPLE_LOTS}, avec une position tenue ${TENUE_LOTS}`

/**
 * (01/11) Les lots de CE parcours : la condition de Mel (OFFRE_PAUSE_DEPOT.lots,
 * « 10 lots sur le Nasdaq a 10 $ du point, en une ou plusieurs positions »), et
 * pas l'exemple general des acces broker (« 2 lots sur le NAS, 30 secondes ») :
 * le membre lit le meme chiffre dans les conditions, le message du clic et les
 * relances. Condition vide : l'exemple general, comme avant.
 */
export function lotsPauseDepot(o: OffrePauseDepot = OFFRE_PAUSE_DEPOT): string {
  return o.lots.trim() || EXEMPLE_LOTS_PHRASE
}

/** (01/11) Le paragraphe des lots du message du clic, avec les lots de ce parcours. */
export function paragrapheLotsPauseDepot(limite: string, o: OffrePauseDepot = OFFRE_PAUSE_DEPOT): string {
  if (!o.lots.trim()) return paragrapheLotsAdmission(limite)
  return `Un mot sur ton accès par le broker : tant que tes premiers lots ne sont pas tradés chez lui, l'affiliation ne nous paie pas. `
    + `Ce qu'il faut : ${o.lots.trim()}. Tu as jusqu'au ${formaterDateFr(limite)} pour les faire. `
    + `Quand c'est fait, dis-le-moi ici : l'équipe vérifie chez le broker.`
}

/**
 * Le message au membre apres le clic de l'equipe : le depot note, la pause et
 * ses dates, le groupe garde, la reprise ou l'arret, ses lots. lienBot : le
 * lien du bot (lienBotAccueil, config.ts), pour l'email seulement.
 */
export function modeleConfirmationPauseDepot(
  o: { partenaire: string; payeJusquau: string; repriseLe: string; limiteLots: string | null },
  canal: Canal, lienBot: string,
): ModelePauseDepot {
  const paye = formaterDateFr(o.payeJusquau)
  const reprise = formaterDateFr(o.repriseLe)
  if (canal === 'telegram') {
    return {
      sujet: 'Ta pause par le dépôt broker est en place',
      paragraphes: [
        `Salut ! Ton dépôt chez ${o.partenaire} est bien noté, merci.`,
        `Ton abonnement passe en pause : ta période payée va jusqu'au ${paye}, puis rien n'est prélevé jusqu'au ${reprise}. `
          + `Et tu gardes le groupe tout du long, grâce à ton accès par le broker : aucune coupure.`,
        `Le ${reprise}, ton abonnement reprend tout seul. Une semaine avant, je te fais signe, et si tu préfères arrêter là, il suffira de me le dire.`,
        ...(o.limiteLots ? [paragrapheLotsPauseDepot(o.limiteLots)] : []),
        phraseQuestion('telegram'),
      ],
      ...(o.limiteLots ? { boutonBot: { texte: BOUTON_LOTS.texte, data: BOUTON_LOTS.data } } : {}),
    }
  }
  return {
    sujet: 'Votre pause par le dépôt broker est en place',
    paragraphes: [
      'Bonjour,',
      `Votre dépôt chez ${o.partenaire} est bien noté, merci.`,
      `Votre abonnement passe en pause : votre période payée va jusqu'au ${paye}, puis rien n'est prélevé jusqu'au ${reprise}. `
        + `Vous gardez le groupe Telegram tout du long, grâce à votre accès par le broker : aucune coupure.`,
      `Le ${reprise}, votre abonnement reprend tout seul. Une semaine avant, on vous prévient, et si vous préférez arrêter là, il suffira de nous le dire.`,
      ...(o.limiteLots
        ? [`Un point important : tant que vos premiers lots ne sont pas tradés chez le broker, l'affiliation ne nous rémunère pas. `
          + `Ce qu'il faut : ${lotsPauseDepot()}. Vous avez jusqu'au ${formaterDateFr(o.limiteLots)}. `
          + `Quand c'est fait, dites-le au bot du Live Club (${lienBot}) ou répondez à cet email : l'équipe vérifie chez le broker.`]
        : []),
      phraseQuestion('email'),
    ],
  }
}

/**
 * Le rappel J-7 avant la reprise, pour une pause de ce parcours (le passage,
 * tache a, a la place du rappel J-7 d'une pause classique, qui parle de
 * revenir dans le groupe) : il y reste, et arreter, c'est le dire.
 */
export function modeleRappelPauseDepot(repriseLe: string, canal: Canal): ModelePauseDepot {
  const date = formaterDateFr(repriseLe)
  return {
    sujet: ton(canal, 'Ta pause par le dépôt broker se termine bientôt', 'Votre pause par le dépôt broker se termine bientôt'),
    paragraphes: [
      ton(canal, 'Salut !', 'Bonjour,'),
      ton(canal,
        `Petit rappel : ta pause d'abonnement, liée à ton dépôt chez le broker, se termine le ${date}. Ce jour-là, ton abonnement reprend tout seul et le prélèvement repart sur ta carte habituelle.`,
        `Petit rappel : votre pause d'abonnement, liée à votre dépôt chez le broker, se termine le ${date}. Ce jour-là, votre abonnement reprend tout seul et le prélèvement repart sur votre carte habituelle.`),
      ton(canal,
        'Tu restes dans le groupe, sans coupure : rien à faire de ton côté.',
        'Vous restez dans le groupe Telegram, sans coupure : rien à faire de votre côté.'),
      canal === 'telegram'
        ? `Tu préfères arrêter là ? Écris-moi ici avant le ${date} : on arrête ton abonnement, et rien ne sera prélevé.`
        : `Vous préférez arrêter là ? Répondez à cet email avant le ${date} : on arrête votre abonnement, et rien ne sera prélevé.`,
    ],
  }
}

/**
 * Les relances des lots (J+14 et J+18) pour ce parcours : memes faits que
 * celles d'un acces broker (lots-pur.ts), mais la suite n'est pas une sortie
 * du groupe : l'equipe revient vers lui (SUITE_LOTS_PAUSE_DEPOT).
 */
export function modeleRelanceLotsPauseDepot(n: 1 | 2, limite: string, canal: Canal, lienBot: string): ModelePauseDepot {
  const date = formaterDateFr(limite)
  if (canal === 'telegram') {
    const quand = `Quand c'est fait, appuie sur « ${BOUTON_LOTS.texte} » ou écris-le-moi ici : l'équipe vérifie chez le broker.`
    return {
      sujet: n === 1 ? 'Tes premiers lots chez le broker' : 'Quelques jours pour tes premiers lots',
      paragraphes: n === 1
        ? [
          `Salut ! Petit rappel pour ta pause d'abonnement par le dépôt chez le broker : tes premiers lots ne sont pas encore tradés chez lui, et tant qu'ils ne le sont pas, l'affiliation ne nous paie pas.`,
          OFFRE_PAUSE_DEPOT.lots.trim()
            ? `Ce qu'il faut : ${lotsPauseDepot()}.`
            : `Le plus simple, en trois étapes :\n${ETAPES_LOTS.map((e, i) => `${i + 1}. ${e}`).join('\n')}`,
          `Tu as jusqu'au ${date}. ${quand}`,
        ]
        : [
          `Salut ! Il te reste quelques jours pour trader tes premiers lots chez le broker : jusqu'au ${date}.`,
          `Pour rappel : ${lotsPauseDepot()}.`,
          "Ta pause d'abonnement repose sur ce dépôt : si les lots ne sont pas faits à cette date, l'équipe revient vers toi pour voir la suite ensemble.",
          `Déjà fait ? Appuie sur « ${BOUTON_LOTS.texte} » ou écris-le-moi ici : l'équipe vérifie chez le broker.`,
        ],
      boutonBot: { texte: BOUTON_LOTS.texte, data: BOUTON_LOTS.data },
    }
  }
  const auBot = `dites-le au bot du Live Club (${lienBot}) ou répondez à cet email : l'équipe vérifie chez le broker.`
  return n === 1
    ? {
      sujet: 'Vos premiers lots chez le broker',
      paragraphes: [
        'Bonjour,',
        "Petit rappel pour votre pause d'abonnement par le dépôt chez le broker : vos premiers lots ne sont pas encore tradés chez lui, et tant qu'ils ne le sont pas, l'affiliation ne nous paie pas.",
        OFFRE_PAUSE_DEPOT.lots.trim()
          ? `Ce qu'il faut : ${lotsPauseDepot()}.`
          : `Le plus simple : ouvrez votre plateforme chez le broker, prenez une position de ${EXEMPLE_LOTS}, gardez-la ${TENUE_LOTS}, puis fermez-la.`,
        `C'est tout, et vous avez jusqu'au ${date}. Quand c'est fait, ${auBot}`,
      ],
    }
    : {
      sujet: 'Quelques jours pour vos premiers lots',
      paragraphes: [
        'Bonjour,',
        `Il vous reste quelques jours pour trader vos premiers lots chez le broker : jusqu'au ${date}. Pour rappel : ${lotsPauseDepot()}.`,
        "Votre pause d'abonnement repose sur ce dépôt : si les lots ne sont pas faits à cette date, l'équipe revient vers vous pour voir la suite ensemble.",
        `Déjà fait ? ${auBot.charAt(0).toUpperCase()}${auBot.slice(1)}`,
      ],
    }
}

/** La ligne ajoutee a sa situation (« Mon abonnement », outil mon_abonnement) quand une pause de ce parcours court. */
export function ligneSituationPauseDepot(o: { partenaire: string | null; repriseLe: string }): string {
  return `Cette pause vient de ton dépôt${o.partenaire ? ` chez ${o.partenaire}` : ' chez notre broker partenaire'} : `
    + `tu gardes le groupe pendant tout ce temps, et ton abonnement reprend tout seul le ${formaterDateFr(o.repriseLe)}.`
}

/**
 * Le bloc du serveur pour l'agent des membres, quand une pause de ce parcours
 * court : il GARDE le groupe (le prompt commun dit qu'une pause fait sortir).
 */
export function consignePauseDepotMembre(o: { partenaire: string | null; repriseLe: string }): string {
  return `Information du serveur sur le membre qui t'écrit (ce n'est pas un message du membre) : son abonnement est en pause grâce à son dépôt `
    + `${o.partenaire ? `chez ${o.partenaire}, notre broker partenaire` : 'chez notre broker partenaire'}. Rien n'est prélevé jusqu'au ${formaterDateFr(o.repriseLe)}, `
    + `et il GARDE le groupe pendant tout ce temps, par son accès broker : ce n'est pas une pause classique, il ne sort pas du groupe. `
    + `Le ${formaterDateFr(o.repriseLe)}, son abonnement reprend tout seul ; s'il préfère arrêter, c'est proposer_arret, comme d'habitude. `
    + `Ne lui propose pas d'autre pause tant que celle-ci court. S'il te pose une question sur sa pause, réponds avec ces informations, simplement.`
}

// ---------------------------------------------------------------------------
// La carte d'Agent AOK : les parametres
// ---------------------------------------------------------------------------

export type ParamsPauseDepot = {
  /** Le broker, slug (raisefx). */
  partenaire: string
  partenaire_nom: string
  /** L'adresse du membre chez le broker (celle du depot) : l'adresse de l'acces, minuscules. */
  email: string
  /** L'adresse de son abonnement Stripe si elle est autre, sinon null. */
  email_abonnement: string | null
  client: string | null
  /** Le depot, en euros. */
  montant: number
  /** Le jour du depot 'YYYY-MM-DD'. */
  le: string
  /** La duree de la pause et de l'acces, en mois (1 a 6). */
  mois: number
  /** La commission propre a CE depot, en euros, ou null (le taux du broker). */
  commission: number | null
  note: string | null
  // Poses par le controle avant la carte (ils ecrasent ce que donne le
  // modele), relus et compares au clic.
  abonnement_id?: string
  paye_jusquau?: string
  reprise_le?: string
  telegram_id?: number | null
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/
const ID_ABONNEMENT = /^sub_[A-Za-z0-9]{8,}$/

function texteCourt(v: unknown, max: number): string | null {
  const s = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/** Des euros dans ]0, max] (ou [0, max]), ou le message d'erreur. */
function lireMontant(v: unknown, nom: string, max: number, zero = false): number | string {
  const c = centimes(v)
  if (c === null) return `${nom} : un montant en euros (ex. 500 ou 49,90).`
  if (zero ? c < 0 : c <= 0) return `${nom} : un montant ${zero ? 'positif ou nul' : 'positif'}.`
  if (c > max * 100) return `${nom} : ${euros(max * 100)} au plus.`
  return Math.round(c) / 100
}

/**
 * Les parametres lus STRICTEMENT (du texte d'un modele). Une chaine = le
 * refus, rendu au modele pour qu'il corrige ou pose la question. Idempotent :
 * la carte memorisee est relue au clic.
 */
export function lireParamsPauseDepot(p: Record<string, unknown>, ctx: { aujourdhui: string }): ParamsPauseDepot | string {
  const partenaire = slugPartenaire(p.partenaire)
  if (!partenaire) return 'partenaire : le nom du broker (ex. RaiseFx).'
  const partenaireNom = texteCourt(p.partenaire_nom, 80) ?? (texteCourt(p.partenaire, 80) as string)
  const email = normaliserEmail(p.email)
  if (!email) {
    return "email : l'adresse du membre chez le broker (celle de son dépôt). Si elle n'est pas donnée, demande-la, n'en invente jamais."
  }
  let emailAbonnement: string | null = null
  if (p.email_abonnement !== null && p.email_abonnement !== undefined && String(p.email_abonnement).trim() !== '') {
    emailAbonnement = normaliserEmail(p.email_abonnement)
    if (!emailAbonnement) return "email_abonnement : l'adresse de son abonnement au Live Club, si elle n'est pas celle du broker."
    if (emailAbonnement === email) emailAbonnement = null
  }
  const montant = lireMontant(p.montant, 'montant (le dépôt)', 1_000_000)
  if (typeof montant === 'string') return montant
  const brutJour = p.le === null || p.le === undefined ? '' : String(p.le).trim()
  const le = brutJour || ctx.aujourdhui
  if (!JOUR.test(le)) return 'le : la date du dépôt, AAAA-MM-JJ.'
  if (le > ctx.aujourdhui) return `le : ${le} est dans le futur.`
  let mois = MOIS_PAUSE_DEPOT
  if (p.mois !== null && p.mois !== undefined && p.mois !== '') {
    const n = typeof p.mois === 'number' ? p.mois : Number(String(p.mois).trim())
    if (!Number.isInteger(n) || n < 1 || n > MOIS_PAUSE_DEPOT_MAX) {
      return `mois : la durée en mois entiers, de 1 à ${MOIS_PAUSE_DEPOT_MAX} (une pause d'abonnement ne dépasse pas ${MOIS_PAUSE_DEPOT_MAX} mois). Vide = ${MOIS_PAUSE_DEPOT}.`
    }
    mois = n
  }
  let commission: number | null = null
  if (p.commission !== null && p.commission !== undefined && p.commission !== '') {
    const c = lireMontant(p.commission, 'commission (celle de ce dépôt)', 100_000, true)
    if (typeof c === 'string') return c
    commission = c
  }
  const lu: ParamsPauseDepot = {
    partenaire, partenaire_nom: partenaireNom, email, email_abonnement: emailAbonnement,
    client: texteCourt(p.client, 120), montant, le, mois, commission, note: texteCourt(p.note, 300),
  }
  if (typeof p.abonnement_id === 'string' && ID_ABONNEMENT.test(p.abonnement_id)) lu.abonnement_id = p.abonnement_id
  if (typeof p.paye_jusquau === 'string' && JOUR.test(p.paye_jusquau)) lu.paye_jusquau = p.paye_jusquau
  if (typeof p.reprise_le === 'string' && JOUR.test(p.reprise_le)) lu.reprise_le = p.reprise_le
  if ('telegram_id' in p) {
    const t = typeof p.telegram_id === 'number' ? p.telegram_id : Number(p.telegram_id)
    lu.telegram_id = p.telegram_id !== null && Number.isSafeInteger(t) && t > 0 ? t : null
  }
  return lu
}

/** Les parametres d'une carte tels qu'ils peuvent aller dans un log : ni email, ni nom, ni note. */
export function paramsPourLogPauseDepot(p: Record<string, unknown>): Record<string, unknown> {
  return {
    partenaire: p.partenaire ?? null, montant: p.montant ?? null, le: p.le ?? null, mois: p.mois ?? null,
    commission: p.commission === null || p.commission === undefined ? 'taux' : 'propre',
    abonnement: typeof p.abonnement_id === 'string' ? 'lu' : 'non', reprise_le: p.reprise_le ?? null,
  }
}

/** L'entete d'une carte pas encore controlee (resumeAction) : la carte entiere vient du controle. */
export function resumePauseDepot(p: Record<string, unknown>): string {
  return `Dépôt broker de ${String(p.client ?? p.email ?? '?')}, déjà abonné : pause de son abonnement et accès Live Club.`
}

// ---------------------------------------------------------------------------
// Les dates
// ---------------------------------------------------------------------------

export type PlanPauseDepot = {
  /** Fin de la periode payee 'YYYY-MM-DD' (jour UTC, comme les metadonnees de la pause). */
  payeJusquau: string
  /** Reprise des prelevements 'YYYY-MM-DD' = dernier jour de l'acces broker (inclus). */
  repriseLe: string
}

/**
 * Les dates d'apres la fin de la periode payee (ISO, AbonnementResume) et la
 * duree : la MEME regle que toute pause (calculerReprisePause, pur.ts :
 * fin + N mois), donc la meme date que celle que pauser() posera chez Stripe.
 * null si la fin est illisible.
 */
export function planPauseDepot(finPeriodeIso: string | null, mois: number): PlanPauseDepot | null {
  const t = finPeriodeIso ? Date.parse(finPeriodeIso) : NaN
  if (!Number.isFinite(t) || t <= 0) return null
  const finSec = Math.floor(t / 1000)
  return { payeJusquau: dateIso(new Date(finSec * 1000)), repriseLe: dateIso(calculerReprisePause(finSec, mois)) }
}

/**
 * La fin du delai des lots annoncee (limiteLots de lots-pur.ts pour un acces
 * qui commence `debut`, sans entree par le lien : il est deja dans le groupe).
 */
export function limiteLotsPauseDepot(debut: string): string {
  return jourPlus(debut > SUIVI_LOTS_DEPUIS ? debut : SUIVI_LOTS_DEPUIS, DELAI_LOTS_JOURS)
}

// ---------------------------------------------------------------------------
// Ce qu'on lit, et les etapes (refus compris)
// ---------------------------------------------------------------------------

/** L'abonnement lu chez Stripe (AbonnementResume reduit). */
export type AbonnementPourPauseDepot = {
  id: string
  statut: string
  finPeriode: string | null
  arretPrevu: boolean
  pauseActive: boolean
  /** Reprise de la pause posee (ISO), ou null. */
  pauseJusquau: string | null
  /** Fin payee notee a la pose (ISO), ou null. */
  pausePayeJusquau: string | null
  clientStripe: string | null
  /** « 49 € par mois », ou null. */
  tarif: string | null
}

/** L'acces broker de l'adresse du membre (motif broker), et s'il appartient deja a ce parcours. */
export type AccesExistantPauseDepot = {
  accesId: string
  /** 'YYYY-MM-DD' */
  jusquau: string
  /** Ni retire, ni sorti, pas fini. */
  actif: boolean
  /** L'abonnement du parcours qui l'a pose (journal), ou null : un acces broker ordinaire. */
  abonnementDuParcours: string | null
  telegramId: number | null
}

/** Un depot deja inscrit (meme broker, meme jour, meme montant, meme personne). */
export type DepotExistant = { commissionId: string; accesId: string | null }

export type LectureBasePauseDepot = {
  acces: AccesExistantPauseDepot | null
  depot: DepotExistant | null
  /** La reprise 'YYYY-MM-DD' de la pause deja posee par CE parcours sur cet abonnement (journal), ou null. */
  pauseDuParcours: string | null
}

export type EtapesPauseDepot = {
  acces: 'poser' | 'garder'
  depot: 'inscrire' | 'relier' | 'garder'
  pause: 'poser' | 'garder'
}

const VIVANTS = ['active', 'trialing']

/**
 * Ce qui reste a faire, ou le refus (une chaine). Les memes regles avant la
 * carte et au clic. Une carte a moitie faite (pause refusee par Stripe apres
 * l'acces et le depot) se redemande : elle ne fait que ce qui manque.
 */
export function etapesPauseDepot(o: {
  abonnement: AbonnementPourPauseDepot
  base: LectureBasePauseDepot
  email: string
}): EtapesPauseDepot | string {
  const a = o.abonnement
  if (a.statut === 'past_due' || a.statut === 'unpaid') {
    return "Son dernier paiement n'est pas passé : pas de pause tant que ce n'est pas réglé. Rien n'est proposé."
  }
  if (!VIVANTS.includes(a.statut)) return `Son abonnement est « ${a.statut} » : ce parcours ne met en pause qu'un abonnement en cours. Rien n'est proposé.`
  if (a.arretPrevu) {
    return `Un arrêt est programmé sur son abonnement${a.finPeriode ? ` (fin le ${formaterDateFr(a.finPeriode)})` : ''} : `
      + "il faut d'abord l'annuler (il peut le faire depuis le bot), puis reproposer. Rien n'est proposé."
  }

  const b = o.base
  let acces: EtapesPauseDepot['acces'] = 'poser'
  if (b.acces) {
    if (b.acces.abonnementDuParcours !== a.id) {
      return `${o.email} a déjà eu un accès broker (jusqu'au ${formaterDateFr(b.acces.jusquau)}) : non renouvelable, rien n'est proposé. `
        + "Si c'est une autre adresse que celle de son dépôt, donne celle du dépôt."
    }
    if (!b.acces.actif) return "L'accès broker de ce parcours est retiré ou terminé : rien n'est refait."
    acces = 'garder'
  }

  let depot: EtapesPauseDepot['depot'] = 'inscrire'
  if (b.depot) {
    if (b.depot.accesId === null) depot = 'relier'
    else if (b.acces && b.depot.accesId === b.acces.accesId) depot = 'garder'
    else return 'Ce dépôt est déjà inscrit sur un autre accès broker : rien n\'est proposé.'
  }

  let pause: EtapesPauseDepot['pause'] = 'poser'
  if (a.pauseActive) {
    const reprise = a.pauseJusquau ? a.pauseJusquau.slice(0, 10) : null
    // La pause de CE parcours : notee au journal, ou (reponse de Stripe perdue
    // au clic precedent) posee jusqu'au dernier jour de l'acces du parcours.
    const duParcours = reprise !== null && (reprise === b.pauseDuParcours
      || (b.acces !== null && b.acces.abonnementDuParcours === a.id && reprise === b.acces.jusquau))
    if (!duParcours) {
      return `Une pause est déjà posée sur son abonnement${reprise ? ` (reprise le ${formaterDateFr(reprise)})` : ', sans date de reprise'} : `
        + "rien n'est proposé. Pour la remplacer : lever la pause, puis reproposer."
    }
    pause = 'garder'
  } else if (!a.finPeriode) {
    return "Fin de période introuvable sur son abonnement : réessaie dans un instant."
  }

  // Tout en place ET la pause notee au journal (sinon le clic precedent s'est
  // arrete avant la fin : la carte redemandee note la pause et previent le membre).
  if (acces === 'garder' && depot === 'garder' && pause === 'garder' && b.pauseDuParcours) {
    return `Tout est déjà en place : accès broker jusqu'au ${formaterDateFr(b.acces?.jusquau ?? '')}, dépôt inscrit, abonnement en pause. Rien à refaire.`
  }
  return { acces, depot, pause }
}

/** Les dates de la carte : celles de la pause deja posee par ce parcours, sinon le plan. null = illisibles. */
export function datesPauseDepot(a: AbonnementPourPauseDepot, etapes: EtapesPauseDepot, mois: number): PlanPauseDepot | null {
  if (etapes.pause === 'garder') {
    if (!a.pauseJusquau) return null
    const paye = a.pausePayeJusquau ?? a.finPeriode
    return paye ? { payeJusquau: paye.slice(0, 10), repriseLe: a.pauseJusquau.slice(0, 10) } : null
  }
  return planPauseDepot(a.finPeriode, mois)
}

// ---------------------------------------------------------------------------
// Les cartes (Brice : longue ; Mel : courte)
// ---------------------------------------------------------------------------

export type CartePauseDepot = {
  qui: string
  email: string
  emailAbonnement: string | null
  /** « compte Telegram u5026707870 », ou null : aucun compte relie a son abonnement. */
  telegram: string | null
  tarif: string | null
  partenaireNom: string
  /** Centimes. */
  montant: number
  le: string
  /** Centimes. */
  commission: number
  /** La phrase de la commission (attendue, mois prevu, 70/30), du serveur de la repartition. */
  phraseCommission: string
  payeJusquau: string
  repriseLe: string
  /** Debut de l'acces broker (aujourd'hui), 'YYYY-MM-DD'. */
  debutAcces: string
  mois: number
  /** La fin du delai des lots, ou null (suivi des lots coupe). */
  limiteLots: string | null
  etapes: EtapesPauseDepot
}

function ligneDepot(c: CartePauseDepot): string {
  switch (c.etapes.depot) {
    case 'inscrire': return 'Le dépôt est inscrit, relié à son accès broker : commission figée, mois des lots et 70/30 comme une carte de dépôt broker.'
    case 'relier': return 'Le dépôt déjà inscrit pour lui est relié à son accès broker (rien n\'est inscrit deux fois).'
    case 'garder': return 'Le dépôt est déjà inscrit et relié : rien à refaire.'
  }
}

function ligneAcces(c: CartePauseDepot): string {
  if (c.etapes.acces === 'garder') return `Son accès broker de ce parcours existe déjà ; il court jusqu'au ${libelleJour(c.repriseLe)} inclus.`
  return `Accès broker posé du ${libelleJour(c.debutAcces)} au ${libelleJour(c.repriseLe)} inclus, malgré son abonnement en cours, `
    + (c.telegram
      ? `relié à son ${c.telegram} : aucun email d'invitation, il est déjà dans le groupe.`
      : `sur l'adresse ${c.email} : aucun compte Telegram n'est relié à son abonnement, le bot le reliera quand il lui écrira.`)
}

function lignePause(c: CartePauseDepot): string {
  if (c.etapes.pause === 'garder') return `Son abonnement est déjà en pause jusqu'au ${libelleJour(c.repriseLe)} : rien à refaire.`
  return `Son abonnement est mis en pause : période payée jusqu'au ${libelleJour(c.payeJusquau)}, puis aucun prélèvement pendant ${c.mois} mois, `
    + `reprise automatique le ${libelleJour(c.repriseLe)}, le jour où son accès broker se termine. Pas de trou, pas de double paiement.`
}

/** La carte longue (Brice). */
export function carteLonguePauseDepot(c: CartePauseDepot): string {
  const qui = [c.email !== c.qui ? c.email : null, c.emailAbonnement ? `abonnement à ${c.emailAbonnement}` : null, c.telegram].filter(Boolean).join(', ')
  return [
    "Dépôt broker d'un abonné : pause de son abonnement et accès Live Club, en une fois.",
    `${c.qui}${qui ? ` (${qui})` : ''}, abonné au Live Club${c.tarif ? ` (${c.tarif})` : ''}.`,
    `Dépôt de ${euros(c.montant)} chez ${c.partenaireNom} le ${libelleJour(c.le)}. ${c.phraseCommission}`,
    'Au clic :',
    `1. ${ligneDepot(c)}`,
    `2. ${ligneAcces(c)}`,
    `3. ${lignePause(c)}`,
    '4. Il reste dans le groupe tout du long, et reçoit un message (en privé, sinon par email) qui lui dit tout ça, avec ses lots.',
    c.limiteLots
      ? `Ses lots : premiers lots à trader d'ici le ${libelleJour(c.limiteLots)}, relances en privé à J+${RELANCE_LOTS_1_JOURS} et J+${DELAI_LOTS_JOURS - RELANCE_LOTS_2_AVANT_FIN_JOURS}, `
        + "puis la carte « lots tradés oui / non » ici quand il les déclare. Lots pas faits à cette date : il garde le groupe (son abonnement est en pause), "
        + 'et vous êtes prévenus ici pour décider de la suite (reprendre son abonnement, par exemple).'
      : 'Ses lots : le suivi des lots est coupé, rien ne le relance.',
    `Fin : une semaine avant le ${libelleJour(c.repriseLe)}, il reçoit un rappel : son abonnement reprend ce jour-là, ou il peut arrêter avant.`,
  ].join('\n')
}

/** La carte courte (Mel : « pas la patience des messages detailles »). */
export function carteCourtePauseDepot(c: CartePauseDepot): string {
  const alerte = !c.telegram && c.etapes.acces === 'poser' ? ' Aucun compte Telegram relié à son abonnement.' : ''
  const reste = c.etapes.acces === 'garder' || c.etapes.depot === 'garder' || c.etapes.pause === 'garder'
    ? ' Seul ce qui manque sera fait.' : ''
  return `Dépôt ${c.partenaireNom} de ${euros(c.montant)} le ${jourCourt(c.le)} pour ${c.qui}, commission ${euros(c.commission)}. `
    + `Abonnement en pause du ${jourCourt(c.payeJusquau)} au ${libelleJour(c.repriseLe)}, accès broker jusqu'au même jour : `
    + `il garde le groupe, reprise toute seule.${alerte}${reste}`
}

// ---------------------------------------------------------------------------
// Le clic : l'enchainement, ses outils en parametre (faux dans le test)
// ---------------------------------------------------------------------------

/** Un refus : rien n'a ete fait (le serveur en fait une RefusAction). */
export class RefusPauseDepot extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefusPauseDepot'
  }
}

/** L'acces et le depot sont poses, la pause non : une panne a dire telle quelle (le serveur en fait une Error). */
export class PausePasPosee extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PausePasPosee'
  }
}

export type IssueMessagePauseDepot = 'prive' | 'email' | 'deja' | null

export type OutilsPauseDepot = {
  /** L'abonnement relu chez Stripe (cle de lecture). null = introuvable, ou pas un abonnement Live Club. */
  lireAbonnement(abonnementId: string): Promise<AbonnementPourPauseDepot | null>
  /** L'acces de l'adresse, le depot deja inscrit, la pause du parcours (journal). */
  lireBase(p: ParamsPauseDepot, abonnementId: string): Promise<LectureBasePauseDepot>
  /**
   * EN UNE TRANSACTION, sous un verrou par abonnement : refus de la base
   * refaits, l'acces pose (s'il manque) jusqu'a la reprise, le depot inscrit
   * ou relie, la ligne du journal (le marqueur). Jette RefusPauseDepot si la
   * base a change depuis la lecture.
   */
  poserAccesEtDepot(o: {
    p: ParamsPauseDepot; abonnement: AbonnementPourPauseDepot; repriseLe: string; payeJusquau: string
    telegramId: number | null; etapes: EtapesPauseDepot
  }): Promise<{ accesId: string; commissionId: string }>
  /** La pause par le chemin existant (pauser, stripe.ts). Jette sur un refus de Stripe. */
  poserPause(abonnementId: string, mois: number): Promise<PlanPauseDepot>
  /** Le filet : l'acces court jusqu'a la vraie reprise (si Stripe avait pose une autre date). */
  alignerAcces(accesId: string, jusquau: string): Promise<void>
  /** La ligne 'pause' du journal (regle REGLE_PAUSE_DEPOT), comme les autres poses. */
  journaliserPause(o: { abonnementId: string; telegramId: number | null; accesId: string; mois: number; plan: PlanPauseDepot }): Promise<void>
  /** Le message au membre, une fois par acces (reserve). */
  prevenirMembre(o: {
    accesId: string; commissionId: string; telegramId: number | null; email: string; partenaire: string; plan: PlanPauseDepot; debutAcces: string
  }): Promise<IssueMessagePauseDepot>
  /** Aujourd'hui, 'YYYY-MM-DD' (jour UTC de la base : debut de l'acces). */
  aujourdhui: string
}

export type IssuePauseDepot = {
  etapes: EtapesPauseDepot
  accesId: string
  commissionId: string
  plan: PlanPauseDepot
  message: IssueMessagePauseDepot
  /** Stripe a pose une autre reprise que celle de la carte : l'acces a ete aligne dessus. */
  aligne: boolean
}

/**
 * Le clic, EN UNE FOIS. Tout est relu avant d'agir (la carte a pu vieillir) :
 * l'abonnement chez Stripe, l'acces, le depot et la pause en base. Les dates
 * de la carte doivent etre encore justes (une periode renouvelee entre la
 * carte et le clic = refus, rien n'est fait). Puis, dans l'ordre :
 * l'acces et le depot (une transaction), la pause chez Stripe, le message.
 * L'acces avant la pause, expres : si Stripe refuse la pause, il a le groupe
 * et paie encore (rien de perdu, la carte se redemande) ; l'inverse le
 * sortirait du groupe au debut de la pause.
 */
export async function executerPauseDepotAvec(p: ParamsPauseDepot, outils: OutilsPauseDepot): Promise<IssuePauseDepot> {
  if (!p.abonnement_id || !p.paye_jusquau || !p.reprise_le || !('telegram_id' in p)) {
    throw new RefusPauseDepot("Carte sans lecture de l'abonnement : redemande-la, rien n'a été fait.")
  }
  const a = await outils.lireAbonnement(p.abonnement_id)
  if (!a) throw new RefusPauseDepot(`Abonnement ${p.abonnement_id} introuvable chez Stripe (ou ce n'est plus un abonnement Live Club) : rien n'a été fait.`)
  const base = await outils.lireBase(p, a.id)
  const etapes = etapesPauseDepot({ abonnement: a, base, email: p.email })
  if (typeof etapes === 'string') throw new RefusPauseDepot(etapes)
  const plan = datesPauseDepot(a, etapes, p.mois)
  if (!plan) throw new RefusPauseDepot("Dates de son abonnement illisibles : rien n'a été fait, réessaie dans un instant.")
  if (plan.payeJusquau !== p.paye_jusquau || plan.repriseLe !== p.reprise_le) {
    throw new RefusPauseDepot(`Les dates de son abonnement ont changé depuis la carte (payé jusqu'au ${formaterDateFr(plan.payeJusquau)}, `
      + `reprise le ${formaterDateFr(plan.repriseLe)}) : redemande la carte, rien n'a été fait.`)
  }

  // 1. L'acces et le depot (et le marqueur), en une transaction.
  let accesId = base.acces?.accesId ?? ''
  let commissionId = base.depot?.commissionId ?? ''
  if (etapes.acces === 'poser' || etapes.depot !== 'garder' || base.acces?.jusquau !== plan.repriseLe) {
    const pose = await outils.poserAccesEtDepot({
      p, abonnement: a, repriseLe: plan.repriseLe, payeJusquau: plan.payeJusquau,
      telegramId: p.telegram_id ?? null, etapes,
    })
    accesId = pose.accesId
    commissionId = pose.commissionId
  }

  // 2. La pause chez Stripe, par le chemin existant.
  let reel = plan
  let aligne = false
  if (etapes.pause === 'poser') {
    try {
      reel = await outils.poserPause(a.id, p.mois)
    } catch (err) {
      const raison = err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : String(err)
      throw new PausePasPosee(`${p.client ?? p.email} : accès broker posé jusqu'au ${formaterDateFr(plan.repriseLe)} et dépôt inscrit, `
        + `mais la pause n'est PAS posée chez Stripe (${raison}). Il garde le groupe, et son abonnement continue d'être prélevé. `
        + 'Redemande-moi la même carte : elle ne fera que la pause.')
    }
    if (reel.repriseLe !== plan.repriseLe) {
      await outils.alignerAcces(accesId, reel.repriseLe)
      aligne = true
    }
    await outils.journaliserPause({ abonnementId: a.id, telegramId: p.telegram_id ?? null, accesId, mois: p.mois, plan: reel })
  } else if (!base.pauseDuParcours) {
    // La pause etait posee mais pas notee (reponse de Stripe perdue) : la ligne du journal, rattrapee.
    await outils.journaliserPause({ abonnementId: a.id, telegramId: p.telegram_id ?? null, accesId, mois: p.mois, plan })
  }

  // 3. Le message au membre (une fois par acces).
  const message = await outils.prevenirMembre({
    accesId, commissionId, telegramId: p.telegram_id ?? null, email: p.email_abonnement ?? p.email, partenaire: p.partenaire_nom,
    plan: reel, debutAcces: outils.aujourdhui,
  })
  return { etapes, accesId, commissionId, plan: reel, message, aligne }
}

/** La phrase du resultat pour l'equipe ; la derniere ligne dit l'etape humaine suivante. */
export function resultatPauseDepot(i: IssuePauseDepot, o: { qui: string; partenaire: string; phraseCommission: string | null }): string {
  const depot = i.etapes.depot === 'inscrire' ? 'dépôt inscrit' : i.etapes.depot === 'relier' ? 'dépôt déjà inscrit, relié à son accès' : 'dépôt déjà inscrit'
  const acces = i.etapes.acces === 'poser' ? `accès broker posé jusqu'au ${libelleJour(i.plan.repriseLe)} inclus` : `accès broker jusqu'au ${libelleJour(i.plan.repriseLe)} inclus`
  const pause = i.etapes.pause === 'poser'
    ? `abonnement en pause (payé jusqu'au ${libelleJour(i.plan.payeJusquau)}, reprise automatique le ${libelleJour(i.plan.repriseLe)})`
    : `abonnement déjà en pause jusqu'au ${libelleJour(i.plan.repriseLe)}`
  const message = i.message === 'prive' ? 'Il a reçu le message en privé (dates, groupe gardé, lots).'
    : i.message === 'email' ? 'Il a reçu le message par email (dates, groupe gardé, lots).'
      : i.message === 'deja' ? 'Son message était déjà parti.'
        : "Je n'ai pas pu le prévenir (bot jamais ouvert, email qui ne passe pas) : dis-le-lui de vive voix."
  return [
    `C'est fait pour ${o.qui} : ${depot}, ${acces}, ${pause}. Il garde le groupe tout du long.`,
    ...(o.phraseCommission ? [o.phraseCommission] : []),
    ...(i.aligne ? ["Stripe a posé une autre date de reprise que celle de la carte : son accès broker a été aligné dessus."] : []),
    message,
    `Ensuite, rien à faire : dis-moi quand il a fait ses lots chez ${o.partenaire}.`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// L'alerte a l'equipe : lots pas faits a la fin du delai (une fois par depot)
// ---------------------------------------------------------------------------

export function texteAlerteLotsPauseDepot(o: {
  qui: string; email: string | null; partenaire: string; depot: string | null; depotLe: string; repriseLe: string | null
}): string {
  const email = o.email && o.email !== o.qui ? ` (${o.email})` : ''
  const de = /^[aeiouyhàâéèêëîïôûü]/i.test(o.qui) ? `d'${o.qui}` : `de ${o.qui}`
  return [
    `Lots pas tradés à la fin du délai : ${o.qui}${email}, dépôt${o.depot ? ` de ${o.depot}` : ''} chez ${o.partenaire} du ${libelleJour(o.depotLe)}, `
      + `abonnement en pause par ce dépôt${o.repriseLe ? ` jusqu'au ${libelleJour(o.repriseLe)}` : ''}.`,
    "Rien n'a été coupé : il garde le groupe, et son abonnement reste en pause.",
    `À décider : reprendre son abonnement maintenant (dis-moi « reprends l'abonnement ${de} »), ou attendre ses lots.`,
  ].join('\n')
}

/** Le marqueur de l'historique d'Agent AOK : l'alerte n'est pas une question de l'equipe. */
export const MARQUEUR_ALERTE_LOTS_PAUSE_DEPOT = "[système] Alerte « lots pas tradés, pause par dépôt broker », envoyée automatiquement par le passage du matin (ce n'est pas une question de l'équipe)."

// ---------------------------------------------------------------------------
// (04/11, cas d'Arthur) La declaration « depot fait » d'un abonne : chez Brice
// ET Mel, la carte pre-remplie prete a valider, ou l'alerte avec ce qui manque.
//
// Avant : la declaration ne passait que par l'alerte generique « un membre
// demande un humain » (support-pont.ts), qui (1) ne part que si le fil PASSE
// en attente (deja en attente = rien) et au plus une fois par 10 min, et (2)
// ne disait ni le parcours, ni le montant, ni la carte a valider : Arthur
// (01/11 19:42, « je viens de faire le depot chez raise FX ») n'a donne
// aucune carte, et personne n'a valide avant son renouvellement du 07/11.
// Maintenant : une alerte propre au parcours, envoyee a chaque compte de
// l'equipe quel que soit l'etat du fil, avec la carte du clic (controlerPauseDepot)
// posee dans sa conversation d'Agent AOK. Une carte qui attend deja n'est
// pas remplacee : l'alerte le dit, la carte en texte.
// ---------------------------------------------------------------------------

/** Ce que le membre a dit de son depot (outil pause_par_depot, etape depot_fait), rien de devine. */
export type DeclarationDepot = { montant: number | null; le: string | null; email: string | null }

/** Lecture stricte : un montant illisible, une date mal formee ou future, une adresse invalide = null. */
export function lireDeclarationMembre(entree: unknown, ctx: { aujourdhui: string }): DeclarationDepot {
  const e = entree && typeof entree === 'object' ? (entree as Record<string, unknown>) : {}
  const brutMontant = e.montant === null || e.montant === undefined ? '' : String(e.montant).replace(/€|euros?|eur/gi, '').trim()
  const m = brutMontant ? lireMontant(brutMontant, 'montant', 1_000_000) : null
  const brutJour = typeof e.le === 'string' ? e.le.trim() : ''
  return {
    montant: typeof m === 'number' ? m : null,
    le: JOUR.test(brutJour) && brutJour <= ctx.aujourdhui ? brutJour : null,
    email: normaliserEmail(e.email_broker),
  }
}

/** Ajoutee a la reponse au membre quand il n'a pas donne le montant : l'equipe en a besoin pour la carte. */
export const QUESTION_MONTANT_DEPOT = "Pour que l'équipe aille plus vite : de combien est ton dépôt ? Et si ton compte chez le broker est à une autre adresse email que ton abonnement, donne-la-moi aussi."

export function texteMembreDeclaration(texte: string, d: DeclarationDepot): string {
  return d.montant === null ? `${texte}\n\n${QUESTION_MONTANT_DEPOT}` : texte
}

/**
 * Les parametres de la carte (proposer_pause_depot) d'apres la declaration,
 * ou ce qui manque, en clair pour l'equipe. Date absente = le jour de son
 * message (« je viens de faire le depot »). Commission : celle du parcours
 * (COMMISSION_PAUSE_DEPOT) chez son broker, des le minimum.
 */
export function paramsCarteDeclaration(o: {
  d: DeclarationDepot; emailAbonnement: string | null; client: string | null; jourMessage: string
  offre?: OffrePauseDepot; commission?: typeof COMMISSION_PAUSE_DEPOT
}): Record<string, unknown> | string {
  const offre = o.offre ?? OFFRE_PAUSE_DEPOT
  const com = o.commission ?? COMMISSION_PAUSE_DEPOT
  if (!offre.partenaire.trim()) return "le broker de l'offre (conditions de l'offre vides)"
  if (o.d.montant === null) return "le montant de son dépôt (il ne l'a pas donné, le bot vient de le lui demander)"
  const email = o.d.email ?? o.emailAbonnement
  if (!email) return 'son adresse email (aucune adresse reliée à son compte Telegram)'
  const le = o.d.le ?? o.jourMessage
  const regle = slugPartenaire(offre.partenaire) === com.partenaire ? regleCommissionAu(le, com) : null
  if (regle && o.d.montant < regle.minimum) {
    return `un dépôt d'au moins ${euros(regle.minimum * 100)} (il annonce ${euros(Math.round(o.d.montant * 100))}) : à voir avec lui`
  }
  const aConfirmer = Boolean(regle?.promo && regle.commission === null)
  return {
    partenaire: offre.partenaire.trim(), email,
    email_abonnement: o.d.email && o.emailAbonnement && o.emailAbonnement !== o.d.email ? o.emailAbonnement : null,
    client: o.client, montant: o.d.montant, le, mois: MOIS_PAUSE_DEPOT,
    commission: regle ? (regle.commission ?? 0) : null,
    note: [
      `Déclaré par le membre au bot le ${jourCourt(o.jourMessage)}${o.d.le ? '' : ' (date du dépôt = jour du message)'}.`,
      regle?.promo ? `Dépôt de la ${regle.promo}.` : null,
      aConfirmer ? 'Commission à confirmer (0 € inscrit) : à corriger dans le cockpit.' : null,
    ].filter(Boolean).join(' '),
  }
}

/** Le minimum et la commission d'un depot du jour `le` : ceux de la promo si le jour y tombe (dates incluses). commission null = a confirmer. */
export function regleCommissionAu(le: string, com: typeof COMMISSION_PAUSE_DEPOT = COMMISSION_PAUSE_DEPOT): { minimum: number; commission: number | null; promo: string | null } {
  const p = com.promo
  if (p && le >= p.du && le <= p.au) return { minimum: p.depotMinimumEuros, commission: p.fixeEuros, promo: p.libelle }
  return { minimum: com.depotMinimumEuros, commission: com.fixeEuros, promo: null }
}

/** L'offre annoncee au membre aujourd'hui : le minimum de la promo en cours, sinon l'offre telle quelle. */
export function offreDuJour(aujourdhui: string, offre: OffrePauseDepot = OFFRE_PAUSE_DEPOT, com: typeof COMMISSION_PAUSE_DEPOT = COMMISSION_PAUSE_DEPOT): OffrePauseDepot {
  const p = com.promo
  if (!p || slugPartenaire(offre.partenaire) !== com.partenaire || aujourdhui < p.du || aujourdhui > p.au || !offre.depotMinimum.trim()) return offre
  return { ...offre, depotMinimum: `${euros(p.depotMinimumEuros * 100)} (${p.libelle}, jusqu'au ${libelleJour(p.au)} inclus ; ${offre.depotMinimum.trim()} ensuite)` }
}

const MONTANT_DANS_TEXTE = /(\d{1,3}(?:[ .  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:€|euros?\b|eur\b|e\b)/i
const EMAIL_DANS_TEXTE = /[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[a-z]{2,}/i

/**
 * (04/11, Brice : « le bot les a lues mais pas recoltees ») Ce que le modele
 * n'a pas passe a l'outil, recolte dans les messages DU MEMBRE (le plus
 * recent d'abord) : un montant suivi de sa devise, une adresse email. Rien
 * n'est pris dans les textes du bot. La date n'est pas devinee.
 */
export function recolterDeclaration(d: DeclarationDepot, textesDuMembre: readonly string[]): DeclarationDepot {
  let { montant, email } = d
  for (const t of textesDuMembre) {
    if (montant === null) {
      const m = MONTANT_DANS_TEXTE.exec(t)
      if (m) {
        const n = Number(m[1].replace(/[^\d]/g, '') + (m[2] ? `.${m[2]}` : ''))
        if (Number.isFinite(n) && n > 0 && n <= 1_000_000) montant = n
      }
    }
    if (email === null) email = normaliserEmail(EMAIL_DANS_TEXTE.exec(t)?.[0])
  }
  return { ...d, montant, email }
}

/** Le texte de l'alerte : la declaration, puis la carte a valider, ou ce qui manque. Sans nom d'outil. */
export function texteAlerteDeclarationPauseDepot(o: {
  qui: string; email: string | null; partenaire: string; d: DeclarationDepot
  carte: string | null; manque: string | null; occupee?: boolean
}): string {
  const email = o.email && o.email !== o.qui ? ` (${o.email})` : ''
  const depot = o.d.montant === null ? '' : ` : ${euros(Math.round(o.d.montant * 100))}${o.d.le ? `, le ${libelleJour(o.d.le)}` : ''}`
  const lignes = [`Pause par dépôt broker : ${o.qui}${email} dit que son dépôt chez ${o.partenaire} est fait${depot}.`]
  const demande = `dis-moi « pause par dépôt pour ${o.email ?? o.qui}, dépôt de ... € le JJ/MM » et je prépare la carte.`
  if (o.carte && !o.occupee) {
    lignes.push(`Vérifie le dépôt chez ${o.partenaire}, puis valide la carte ci-dessous : elle inscrit le dépôt, pose son accès broker, met son abonnement en pause et le prévient.`, '', o.carte)
  } else if (o.carte) {
    lignes.push(`Une autre carte attend déjà ta réponse ici : celle-ci n'a pas pris sa place. Pour la valider ensuite, ${demande}`, '', o.carte)
  } else {
    lignes.push(`Pas de carte : il manque ${o.manque ?? 'une information'}. Dès que tu l'as, ${demande}`)
  }
  return lignes.join('\n')
}

/** Le marqueur de l'historique d'Agent AOK : l'alerte n'est pas une question de l'equipe. */
export const MARQUEUR_DECLARATION_PAUSE_DEPOT = "[système] Alerte « un abonné dit que son dépôt broker est fait (pause par dépôt) », envoyée automatiquement par le bot des membres (ce n'est pas une question de l'équipe)."

export type CarteDeclaration = { action: Record<string, unknown>; carte: string; court: string }
export type OutilsDeclaration = {
  /** Chaque compte de l'equipe (cockpit_telegram_comptes) ; court = Melanie (la carte courte). */
  equipe: () => Promise<{ chat: number; court: boolean }[]>
  /** La carte du clic (controle compris) ou ce qui manque. Peut jeter. */
  carte: () => Promise<CarteDeclaration | { manque: string }>
  /** Pose la carte dans la conversation, sans remplacer une carte qui attend, et l'envoie avec ses boutons. */
  poserCarte: (chat: number, action: Record<string, unknown>, texte: string) => Promise<'posee' | 'occupee' | 'refusee'>
  /** Un texte simple (et l'historique). */
  envoyer: (chat: number, texte: string) => Promise<boolean>
}

/**
 * L'alerte a CHAQUE compte de l'equipe, quel que soit l'etat du fil Support.
 * Ne jette pas : une lecture ratee devient « ce qui manque ». vises = comptes
 * de l'equipe, livres = alertes parties, cartes = cartes posees.
 */
export async function prevenirEquipeDeclarationAvec(
  o: { qui: string; email: string | null; partenaire: string; d: DeclarationDepot }, outils: OutilsDeclaration,
): Promise<{ vises: number; livres: number; cartes: number }> {
  let lue: CarteDeclaration | { manque: string }
  try {
    lue = await outils.carte()
  } catch {
    lue = { manque: "la lecture avant la carte (Stripe ou la base), qui a échoué : redemande-la-moi dans un instant" }
  }
  const equipe = await outils.equipe()
  let livres = 0
  let cartes = 0
  for (const dest of equipe) {
    try {
      if ('action' in lue) {
        const carte = dest.court ? lue.court : lue.carte
        const issue = await outils.poserCarte(dest.chat, lue.action, texteAlerteDeclarationPauseDepot({ ...o, carte, manque: null }))
        if (issue === 'posee') { livres++; cartes++; continue }
        if (issue === 'refusee') continue
        if (await outils.envoyer(dest.chat, texteAlerteDeclarationPauseDepot({ ...o, carte, manque: null, occupee: true }))) livres++
      } else if (await outils.envoyer(dest.chat, texteAlerteDeclarationPauseDepot({ ...o, carte: null, manque: lue.manque }))) {
        livres++
      }
    } catch {
      // Un compte en panne n'empeche pas les autres.
    }
  }
  return { vises: equipe.length, livres, cartes }
}
