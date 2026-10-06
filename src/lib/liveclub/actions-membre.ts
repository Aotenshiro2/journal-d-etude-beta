// Ce qu'un membre peut faire sur SON abonnement depuis le bot (29/09) : lire
// sa situation, preparer une pause, un arret ou l'annulation d'un arret, et
// l'executer apres SON clic de confirmation.
//
// Ce module ne depend PAS de l'IA : le menu a boutons et l'agent Haiku
// passent tous les deux par ici. L'identite vient TOUJOURS du serveur (le
// telegram_id de l'update, puis son rattachement) : aucune fonction ne prend
// un identifiant de membre venu d'un texte.
//
// Aucun geste de promo, de remboursement ou de prix : ce sont des demandes
// pour l'equipe, que le bot lui transmet (fil Support, reponse ici).
//
// Les MONTANTS du membre (Brice, 30/09) : montantsDuMembre, pour l'outil
// mes_montants de l'agent. Lecture seule (apercu de facture, factures
// ouvertes), pour le payeur rattache a CE compte Telegram et lui seul.
//
// support@ ne reste que pour une panne (PANNE : base ou Stripe illisible,
// ou le pont vers l'equipe lui-meme en panne) : ce que le bot ou l'equipe par
// le fil Support savent faire ne renvoie plus vers un email (Brice, 30/09).
//
// (06/10) Un compte NON rattache a un payeur peut avoir un acces offert
// (exemption, acces broker, acces manuel) : profilSansRattachement le
// reconnait avant tout parcours « non rattache », et la situation, les
// montants et les gestes lui repondent (rien a payer, rien a mettre en pause).

import { journaliserGesteLiveClub, type GesteJournal } from '@/lib/stripe-actions'
import { SUPPORT, URLS_ABONNEMENT, URL_PORTAIL_CARTE, texteAbonnement } from './config'
import { droitLiveClub, type Droit } from './droits'
import { rattachementActif, type Rattachement } from './rattacher'
import {
  abonnementsLiveClubDuClient, clientsStripeParEmail, lireAbonnement,
  pauser, programmerArret, annulerArret, apercuProchaineFacture, facturesOuvertesAbonnement,
  type AbonnementResume,
} from './stripe'
import {
  abonnementOuvreLeGroupe, accesSansAbonnement, calculerReprisePause, enRetardDePaiement, etatImpaye, faitsImpaye, faitsMontants,
  formaterDateFr, messageErreur, nbMoisPauseValide, parcoursSansRattachement, peutAvoirUnImpaye, phraseImpaye, statutDonneDroit,
  statutTermine,
  type AccesSansAbonnement, type EntreeImpaye, type EntreeMontants, type FaitsMontants,
} from './pur'
import type { ActionMembre } from './conversations'
import type { Bouton } from './telegram'

/** Signature des gestes faits par un membre depuis le bot. */
export const ACTEUR_BOT_MEMBRE = 'bot:membre'

// ---------------------------------------------------------------------------
// Le payeur et ses abonnements
// ---------------------------------------------------------------------------

/**
 * Les clients Stripe du compte melanie qui sont ceux du payeur rattache, meme
 * lecture que droitLiveClub : le client rattache n'est garde que s'il vient
 * du compte melanie (importer_metricgram.py pose aussi des clients du compte
 * aoknowledge, inconnus de melanie), et on y ajoute les clients de son email
 * (l'abonnement peut vivre sur un autre cus_ du meme email). Union sans
 * doublon. Jette sur une panne Stripe.
 */
async function clientsDuPayeur(r: Rattachement): Promise<string[]> {
  const clients = new Set<string>()
  if (r.client_stripe && (r.compte == null || r.compte === 'melanie')) clients.add(r.client_stripe)
  if (r.email) for (const c of await clientsStripeParEmail(r.email)) clients.add(c)
  return [...clients]
}

/** Les abonnements Live Club du payeur rattache (tous statuts). Jette sur une panne Stripe. */
export async function abonnementsDuPayeur(r: Rattachement): Promise<AbonnementResume[]> {
  const tous: AbonnementResume[] = []
  for (const c of await clientsDuPayeur(r)) tous.push(...await abonnementsLiveClubDuClient(c))
  return tous
}

/** Le rattachement actif, ou null. Ne jette pas : une base illisible = pas de rattachement lu. */
export async function rattachementOuNull(telegramId: number): Promise<Rattachement | null | 'illisible'> {
  try {
    return await rattachementActif(telegramId)
  } catch (err) {
    console.warn(`[liveclub/bot] rattachement illisible pour u${telegramId} : ${messageErreur(err)}`)
    return 'illisible'
  }
}

export type ProfilSansRattachement =
  | { parcours: 'acces_offert'; droit: Droit; acces: AccesSansAbonnement }
  | { parcours: 'non_rattache'; droit: Droit }
  | { parcours: 'panne'; droit: Droit }

/**
 * Un compte SANS rattachement lisible (aucun, ou la base n'a pas repondu) :
 * son droit decide du parcours (Brice, 06/10, Nelly : exemption permanente,
 * reliee a aucun abonnement, a qui le bot demandait l'email de son paiement).
 * Ordre de lecture : le rattachement (deja lu par l'appelant), PUIS
 * droitLiveClub, qui lit l'exemption et l'acces broker par le telegram_id,
 * rattache ou non (l'acces manuel, lui, ne se lit que par le membre du
 * rattachement). Voir parcoursSansRattachement (pur.ts). Ne jette pas.
 */
export async function profilSansRattachement(telegramId: number, r: null | 'illisible'): Promise<ProfilSansRattachement> {
  const droit = await droitLiveClub(telegramId)
  const parcours = parcoursSansRattachement(r === null ? 'aucun' : 'illisible', droit)
  const acces = accesSansAbonnement(droit, { texteAbonnement: texteAbonnement() })
  if (parcours === 'acces_offert' && acces) return { parcours, droit, acces }
  if (parcours === 'non_rattache') return { parcours, droit }
  return { parcours: 'panne', droit }
}

// ---------------------------------------------------------------------------
// La situation, en francais parle (menu « Mon abonnement » et outil de l'agent)
// ---------------------------------------------------------------------------

function phraseAbonnement(a: AbonnementResume): string {
  const fin = a.finPeriode ? formaterDateFr(a.finPeriode) : null
  const reprise = a.pauseJusquau ? formaterDateFr(a.pauseJusquau) : null
  if (a.pauseEffective) {
    return `Ton abonnement est en pause${reprise ? ` jusqu'au ${reprise}` : ''}. Rien n'est prélevé pendant la pause, et il reprend tout seul${reprise ? ' ce jour-là' : ''}.`
  }
  if (a.pauseActive) {
    return `Une pause est prévue : ta période payée va jusqu'au ${fin ?? '?'}, tu gardes le groupe jusque-là. Ensuite rien n'est prélevé, et l'abonnement reprend tout seul${reprise ? ` le ${reprise}` : ''}.`
  }
  // Paiement en retard, factures lues (Brice, 30/09) : 5 jours de groupe
  // garde, puis le montant et le lien de la facture, puis au-dela de 30 jours
  // un nouvel abonnement. Avant l'arret programme : un abonnement en retard
  // ne garde plus le groupe « jusqu'a la fin de la periode ». Factures pas
  // lues : les anciennes phrases ci-dessous.
  const impaye = phraseImpaye(a, Date.now(), URL_PORTAIL_CARTE)
  if (impaye) return impaye
  if (a.arretPrevu && statutDonneDroit(a.statut)) {
    return `Ton abonnement s'arrête${fin ? ` le ${fin}` : ' à la fin de la période en cours'} : rien ne sera plus prélevé. Tu gardes le groupe jusque-là, et tu peux encore changer d'avis.`
  }
  if (a.statut === 'active' || a.statut === 'trialing') {
    return `Ton abonnement Live Club est actif.${fin ? ` Prochain renouvellement le ${fin}.` : ''}`
  }
  if (a.statut === 'past_due') {
    return `Ton dernier paiement n'est pas passé. Il va être retenté tout seul : vérifie ta carte, tu peux la changer sur ${URL_PORTAIL_CARTE}. Tu gardes le groupe pendant ce temps.`
  }
  // Resilie mais paye jusqu'a une date encore a venir (regle « ce qui est
  // paye est du ») : il est ACTIF jusque-la, pas « termine ».
  if (statutTermine(a.statut) && a.payeJusquau && Date.parse(a.payeJusquau) > Date.now()) {
    return `Ton abonnement est actif jusqu'au ${formaterDateFr(a.payeJusquau)} : ta dernière période est payée, tu gardes le groupe jusque-là. Il ne se renouvelle pas, et rien ne sera plus prélevé.`
  }
  // Terminé : la date la plus tardive entre la fin reelle et la fin payee.
  const finReelle = [a.termineLe, a.payeJusquau].filter((d): d is string => Boolean(d)).sort().pop()
  const termine = finReelle ? formaterDateFr(finReelle) : null
  return `Ton abonnement est terminé${termine ? ` depuis le ${termine}` : ''}.`
}

/**
 * L'abonnement a-t-il une phrase « en cours » ? Vivant chez Stripe, resilie
 * mais encore paye, ou en retard de paiement avec ses factures lues (un
 * unpaid reste en place chez Stripe : sa facture se regle, Brice 30/09).
 */
function abonnementEnCours(a: AbonnementResume): boolean {
  if (statutDonneDroit(a.statut) || abonnementOuvreLeGroupe(a)) return true
  const e = etatImpaye(a)
  return enRetardDePaiement(a.statut) && (e === 'grace' || e === 'suspendu' || e === 'fenetre_depassee')
}

/** Le statut d'un abonnement « en cours » dans les faits de l'agent. */
function statutDesFaits(a: AbonnementResume): string {
  if (a.pauseEffective) return 'en_pause'
  const e = etatImpaye(a)
  if (e === 'suspendu') return 'acces_suspendu_paiement_en_retard'
  if (e === 'fenetre_depassee') return 'paiement_non_regle_depuis_plus_de_30_jours'
  if (statutDonneDroit(a.statut)) return a.statut
  return a.statut === 'unpaid' ? 'paiement_en_retard' : 'resilie_mais_paye'
}

export type Situation =
  | { etat: 'non_rattache' }
  | { etat: 'illisible' }
  | {
    etat: 'ok'; texte: string; faits: Record<string, unknown>
    /** Acces ouvert sans abonnement (exemption, broker, acces manuel) : l'agent recoit CONSIGNE_ACCES_OFFERT. */
    accesOffert?: true
  }

/**
 * La situation du membre qui ecrit, en phrases pretes a envoyer, plus les
 * faits bruts pour l'agent (dates, statut ; aucun identifiant Stripe).
 * (06/10) Sans rattachement lisible, le droit d'abord : un acces offert a sa
 * situation, une panne reste 'illisible', le reste 'non_rattache'.
 */
export async function situationDuMembre(telegramId: number): Promise<Situation> {
  const r = await rattachementOuNull(telegramId)
  if (r === 'illisible' || !r) {
    const p = await profilSansRattachement(telegramId, r)
    if (p.parcours === 'acces_offert') return { etat: 'ok', texte: p.acces.texte, faits: p.acces.faits, accesOffert: true }
    return p.parcours === 'panne' ? { etat: 'illisible' } : { etat: 'non_rattache' }
  }

  let abonnements: AbonnementResume[]
  try {
    abonnements = await abonnementsDuPayeur(r)
  } catch (err) {
    console.warn(`[liveclub/bot] Stripe illisible pour u${telegramId} : ${messageErreur(err)}`)
    return { etat: 'illisible' }
  }

  const vivants = abonnements.filter(abonnementEnCours)
  if (vivants.length) {
    return {
      etat: 'ok',
      texte: vivants.map(phraseAbonnement).join('\n\n'),
      faits: {
        abonnements: vivants.map(a => ({
          statut: statutDesFaits(a),
          fin_periode: a.finPeriode ? formaterDateFr(a.finPeriode) : null,
          actif_jusquau: statutDonneDroit(a.statut) ? null : a.payeJusquau ? formaterDateFr(a.payeJusquau) : null,
          arret_programme: a.arretPrevu,
          pause_prevue_ou_en_cours: a.pauseActive,
          reprise_apres_pause: a.pauseJusquau ? formaterDateFr(a.pauseJusquau) : null,
          // Impaye (Brice, 30/09) : groupe garde jusqu'a, ou montant et lien a regler.
          ...faitsImpaye(a),
        })),
      },
    }
  }

  // Pas d'abonnement vivant : un autre droit (exemption, acces broker, acces
  // manuel) peut ouvrir le groupe. Memes textes que pour un compte non
  // rattache (accesSansAbonnement, pur.ts).
  const droit = await droitLiveClub(telegramId)
  const acces = accesSansAbonnement(droit, { texteAbonnement: texteAbonnement() })
  if (acces) return { etat: 'ok', texte: acces.texte, faits: acces.faits, accesOffert: true }
  const fin = droit.fin ? formaterDateFr(droit.fin) : null
  // Un 'oui' par abonnement sans abonnement vivant lu ici (lectures Stripe
  // decalees) : la phrase d'avant le 06/10.
  if (droit.statut === 'oui') {
    return {
      etat: 'ok',
      texte: `Ton accès au Live Club est ouvert${fin ? ` jusqu'au ${fin}` : ''}, sans abonnement à gérer ici. Une question ? L'équipe peut te répondre ici.`,
      faits: { acces: 'ouvert_sans_abonnement', jusquau: fin },
    }
  }
  if (droit.statut === 'inconnu') return { etat: 'illisible' }
  const dernier = abonnements[0]
  return {
    etat: 'ok',
    texte: `${dernier ? phraseAbonnement(dernier) : "Je ne trouve pas d'abonnement Live Club à ton nom."}\n\n${texteAbonnement()}`,
    faits: { acces: 'aucun', abonnement_termine: Boolean(dernier) },
  }
}

// ---------------------------------------------------------------------------
// Les montants du membre (outil mes_montants, Brice 30/09)
// ---------------------------------------------------------------------------

export type Montants =
  | { etat: 'non_rattache' }
  | { etat: 'illisible' }
  /** (06/10) Sans rattachement, acces offert : rien a payer, et sa situation. */
  | { etat: 'acces_offert'; texte: string }
  | { etat: 'ok'; faits: FaitsMontants }

/**
 * Ce que paie le membre QUI ECRIT : pour chaque abonnement vivant, le tarif
 * apres remise et le prochain prelevement (apercu de la prochaine facture,
 * comme le rappel J-3) ; pour chaque abonnement en retard ou a la derniere
 * facture ouverte, ce qui reste a regler et le lien de paiement. L'identite
 * vient du rattachement du compte Telegram, jamais d'un texte. Un apercu
 * illisible donne « montant non disponible » (ou le prix des items s'il n'y
 * a aucune remise, voir montantsDeLaPeriode) ; une liste de factures
 * illisible, « montant non disponible » aussi. Lecture seule. Ne jette pas.
 */
export async function montantsDuMembre(telegramId: number): Promise<Montants> {
  const r = await rattachementOuNull(telegramId)
  if (r === 'illisible' || !r) {
    const p = await profilSansRattachement(telegramId, r)
    if (p.parcours === 'acces_offert') return { etat: 'acces_offert', texte: p.acces.texte }
    return p.parcours === 'panne' ? { etat: 'illisible' } : { etat: 'non_rattache' }
  }

  let abonnements: AbonnementResume[]
  try {
    abonnements = await abonnementsDuPayeur(r)
  } catch (err) {
    console.warn(`[liveclub/bot] Stripe illisible pour u${telegramId} : ${messageErreur(err)}`)
    return { etat: 'illisible' }
  }

  const vivants: EntreeMontants[] = []
  for (const a of abonnements.filter(x => statutDonneDroit(x.statut))) {
    let apercu: Record<string, unknown> | null = null
    try {
      apercu = await apercuProchaineFacture(a.id)
    } catch (err) {
      // Arret programme (pas de prochaine facture), cle sans ce droit, panne.
      console.warn(`[liveclub/bot] apercu de facture illisible pour u${telegramId} : ${messageErreur(err)}`)
    }
    vivants.push({ abonnement: a, apercu })
  }

  const impayes: EntreeImpaye[] = []
  for (const a of abonnements.filter(peutAvoirUnImpaye)) {
    try {
      impayes.push({ abonnement: a, factures: await facturesOuvertesAbonnement(a.id) })
    } catch (err) {
      console.warn(`[liveclub/bot] factures illisibles pour u${telegramId} : ${messageErreur(err)}`)
      impayes.push({ abonnement: a, factures: 'illisible' })
    }
  }
  return { etat: 'ok', faits: faitsMontants(vivants, impayes) }
}

// ---------------------------------------------------------------------------
// Preparer une action (sans rien executer)
// ---------------------------------------------------------------------------

export type Preparation =
  | {
    ok: true
    action: Omit<ActionMembre, 'expire'>
    resume: string
    /**
     * Arret seulement : une pause pourrait etre posee a la place (ni pause
     * deja prevue, ni paiement en retard, fin de periode connue). C'est la
     * condition pour proposer la pause avant l'arret (Brice, 30/09).
     */
    pausePossible?: boolean
  }
  | {
    ok: false
    raison: string
    /**
     * Le bot ne peut pas le faire, l'equipe si (Brice, 30/09 : transmettre
     * au lieu de renvoyer vers un email). L'agent previent l'equipe
     * (veutHumain) ; le menu a boutons joint « Contacter l'equipe ».
     */
    equipe?: true
  }

const PANNE = `Je n'arrive pas à lire ton abonnement en ce moment. Réessaie dans un moment, ou écris à ${SUPPORT}.`
const NON_RATTACHE = `Je ne sais pas encore à quel abonnement ton compte Telegram est lié. Envoie-moi ici l'email de ton paiement : je t'envoie un code pour vérifier, et je te relie à ton abonnement.`

/**
 * Prepare une pause (1 a 6 mois), un arret ou l'annulation d'un arret sur
 * L'abonnement vivant du membre qui ecrit. Rien n'est execute : la phrase
 * `resume` part avec les boutons Confirmer / Annuler.
 *
 * (06/10) Sans rattachement, un acces offert (exemption, broker, acces
 * manuel) n'a rien a mettre en pause ni a arreter : on le lui dit, avant meme
 * de demander combien de mois.
 */
export async function preparerAction(
  telegramId: number,
  type: ActionMembre['type'],
  nbMois?: number,
): Promise<Preparation> {
  const r = await rattachementOuNull(telegramId)
  if (r === 'illisible' || !r) {
    const p = await profilSansRattachement(telegramId, r)
    if (p.parcours === 'acces_offert') return { ok: false, raison: p.acces.rienAGerer }
    return { ok: false, raison: p.parcours === 'panne' ? PANNE : NON_RATTACHE }
  }
  if (type === 'pause' && !nbMoisPauseValide(nbMois)) {
    return { ok: false, raison: 'Une pause dure de 1 à 6 mois : dis-moi combien.' }
  }

  let abonnements: AbonnementResume[]
  try {
    abonnements = await abonnementsDuPayeur(r)
  } catch {
    return { ok: false, raison: PANNE }
  }
  const vivants = abonnements.filter(a => statutDonneDroit(a.statut))
  if (vivants.length === 0) {
    const paye = abonnements.find(abonnementEnCours)
    if (paye?.payeJusquau) {
      return { ok: false, raison: `Ton abonnement est déjà arrêté : il reste actif jusqu'au ${formaterDateFr(paye.payeJusquau)}, puis il s'arrête, et rien ne sera plus prélevé. Rien à changer de ce côté.` }
    }
    return { ok: false, raison: `Je ne trouve pas d'abonnement Live Club en cours à ton nom, donc rien à changer.` }
  }
  if (vivants.length > 1) {
    return { ok: false, equipe: true, raison: `Tu as plusieurs abonnements Live Club en cours. Pour ne pas se tromper, c'est l'équipe qui s'en occupe.` }
  }
  const a = vivants[0]
  const fin = a.finPeriode ? formaterDateFr(a.finPeriode) : null
  const base = { abonnementId: a.id, clientStripe: a.clientStripe }

  if (type === 'pause') {
    const n = nbMois as number
    if (a.pauseActive) {
      return { ok: false, equipe: true, raison: `Une pause est déjà prévue${a.pauseJusquau ? ` jusqu'au ${formaterDateFr(a.pauseJusquau)}` : ''}. Pour la changer, c'est l'équipe qui s'en occupe.` }
    }
    if (a.arretPrevu) {
      return { ok: false, raison: `Ton abonnement s'arrête déjà${fin ? ` le ${fin}` : ''}. Si tu préfères une pause, annule d'abord l'arrêt, puis demande la pause.` }
    }
    if (a.statut === 'past_due') {
      return { ok: false, equipe: true, raison: `Ton dernier paiement n'est pas passé, donc je ne peux pas poser de pause : c'est l'équipe qui va regarder.` }
    }
    if (!a.finPeriode) return { ok: false, raison: PANNE }
    const reprise = formaterDateFr(calculerReprisePause(Math.floor(Date.parse(a.finPeriode) / 1000), n).toISOString())
    return {
      ok: true,
      action: { ...base, type: 'pause', nbMois: n },
      resume: `Tu confirmes une pause de ${n} mois ?\n\n`
        + `Ta période payée va jusqu'au ${fin} : tu gardes le groupe jusque-là. `
        + `Ensuite, rien n'est prélevé pendant ${n} mois, et ton abonnement reprend tout seul le ${reprise}. `
        + `Pendant la pause tu sors du groupe, et tu y reviens dès que le paiement repart.`,
    }
  }

  if (type === 'arret') {
    if (a.arretPrevu) {
      return { ok: false, raison: `L'arrêt est déjà programmé${fin ? ` pour le ${fin}` : ''}. Tu gardes le groupe jusque-là.` }
    }
    return {
      ok: true,
      action: { ...base, type: 'arret' },
      // Memes conditions que la branche pause ci-dessus (arretPrevu est
      // deja exclu) : on ne propose pas une pause que le bot refuserait.
      pausePossible: !a.pauseActive && a.statut !== 'past_due' && Boolean(a.finPeriode),
      resume: `Tu confirmes l'arrêt de ton abonnement ?\n\n`
        + `Plus rien ne sera prélevé. Tu gardes le groupe jusqu'au ${fin ?? 'bout de la période payée'}, puis tu en sors. `
        + `Tu peux changer d'avis jusqu'à cette date.`,
    }
  }

  // annuler_arret
  if (!a.arretPrevu) {
    return { ok: false, raison: `Aucun arrêt n'est prévu sur ton abonnement : il continue normalement.` }
  }
  return {
    ok: true,
    action: { ...base, type: 'annuler_arret' },
    resume: `Tu confirmes que tu restes ?\n\n`
      + `L'arrêt prévu${fin ? ` le ${fin}` : ''} est annulé, et ton abonnement continue normalement.`,
  }
}

// ---------------------------------------------------------------------------
// Executer, APRES le clic du membre et la consommation du nonce
// ---------------------------------------------------------------------------

const GESTE_PAR_ACTION: Record<ActionMembre['type'], GesteJournal> = {
  pause: 'pause',
  arret: 'arret',
  annuler_arret: 'arret_annule',
}

/**
 * Execute une action dont le nonce vient d'etre consomme. Re-verifie avant
 * tout que l'abonnement vise appartient TOUJOURS au payeur rattache a ce
 * compte Telegram (le rattachement a pu changer depuis la proposition).
 * Journalise le geste (pause, arret, arret_annule) et renvoie la phrase pour
 * le membre. Ne jette pas.
 */
export async function executerActionMembre(
  telegramId: number,
  action: ActionMembre,
  updateId: number | null,
): Promise<string> {
  const geste = GESTE_PAR_ACTION[action.type]
  const contexte = {
    telegramId, acteur: ACTEUR_BOT_MEMBRE, abonnementId: action.abonnementId, updateId,
  }

  const r = await rattachementOuNull(telegramId)
  if (r === 'illisible' || !r) {
    await journaliserGesteLiveClub(
      { geste, resultat: r ? 'echec' : 'refuse', regle: r ? 'rattachement_illisible' : 'non_rattache', details: {} },
      contexte,
    )
    return r ? PANNE : NON_RATTACHE
  }
  const membreId = r.membre_id

  try {
    const clients = await clientsDuPayeur(r)
    const abo = await lireAbonnement(action.abonnementId)
    if (!abo || !abo.clientStripe || !clients.includes(abo.clientStripe)) {
      await journaliserGesteLiveClub(
        { geste, resultat: 'refuse', regle: 'abonnement_pas_au_payeur', details: {} },
        { ...contexte, membreId },
      )
      return `Cet abonnement n'est plus lié à ton compte Telegram, donc je n'ai rien changé. Écris à ${SUPPORT} si besoin.`
    }
  } catch (err) {
    await journaliserGesteLiveClub(
      { geste, resultat: 'echec', regle: 'stripe', details: { etape: 'verification', erreur: messageErreur(err) } },
      { ...contexte, membreId },
    )
    return PANNE
  }

  try {
    if (action.type === 'pause') {
      const issue = await pauser(action.abonnementId, action.nbMois as number)
      await journaliserGesteLiveClub(
        {
          geste, resultat: 'fait', regle: 'demande_membre',
          details: { etape: 'pause_programmee', nb_mois: action.nbMois, paye_jusquau: issue.payeJusquau.slice(0, 10), reprise_le: issue.repriseLe.slice(0, 10) },
        },
        { ...contexte, membreId },
      )
      return `C'est fait. Ta pause de ${action.nbMois} mois est programmée.\n\n`
        + `Tu gardes le groupe jusqu'au ${formaterDateFr(issue.payeJusquau)}. `
        + `Ton abonnement reprend tout seul le ${formaterDateFr(issue.repriseLe)}, et on te prévient une semaine avant.`
    }
    if (action.type === 'arret') {
      const apres = await programmerArret(action.abonnementId)
      await journaliserGesteLiveClub(
        { geste, resultat: 'fait', regle: 'demande_membre', details: { fin: apres.finPeriode?.slice(0, 10) ?? null } },
        { ...contexte, membreId },
      )
      return `C'est fait. Ton abonnement s'arrête${apres.finPeriode ? ` le ${formaterDateFr(apres.finPeriode)}` : ' à la fin de la période payée'}, et plus rien ne sera prélevé.\n\n`
        + `Tu gardes le groupe jusque-là. Si tu changes d'avis avant, écris-moi, je peux annuler l'arrêt.`
    }
    const apres = await annulerArret(action.abonnementId)
    await journaliserGesteLiveClub(
      { geste, resultat: 'fait', regle: 'demande_membre', details: { fin_periode: apres.finPeriode?.slice(0, 10) ?? null } },
      { ...contexte, membreId },
    )
    return `C'est fait, l'arrêt est annulé. Ton abonnement continue normalement${apres.finPeriode ? `, prochain renouvellement le ${formaterDateFr(apres.finPeriode)}` : ''}.`
  } catch (err) {
    await journaliserGesteLiveClub(
      { geste, resultat: 'echec', regle: 'stripe', details: { etape: action.type, erreur: messageErreur(err) } },
      { ...contexte, membreId },
    )
    return `Ça n'a pas marché de notre côté, et rien n'a changé sur ton abonnement. Réessaie dans un moment, ou écris à ${SUPPORT}.`
  }
}

// ---------------------------------------------------------------------------
// Les claviers du menu sans IA. callback_data courts (<= 64 octets).
// ---------------------------------------------------------------------------

export function clavierMenu(): Bouton[][] {
  return [
    [{ texte: 'Mon abonnement', data: 'm:abo' }],
    [{ texte: 'Mettre en pause', data: 'm:pause' }, { texte: 'Arrêter', data: 'm:arret' }],
    [{ texte: 'Annuler un arrêt prévu', data: 'm:annuler' }],
    [{ texte: "Contacter l'équipe", data: 'm:equipe' }],
  ]
}

/** Sous un refus que seule l'equipe peut regler (Preparation.equipe) : le fil passe en « veut un humain ». */
export function clavierEquipe(): Bouton[][] {
  return [[{ texte: "Contacter l'équipe", data: 'm:equipe' }]]
}

/** « aoknowledge.com », « melaniechart.com » : le domaine d'une porte d'abonnement, pour un bouton. */
function domaine(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Menu d'un compte pas encore rattache : verifier son email (decision 4),
 * s'abonner par l'une des deux portes (decision 1), ou appeler l'equipe.
 */
export function clavierSansRattachement(): Bouton[][] {
  return [
    [{ texte: "J'ai payé : vérifier mon email", data: 'v:email' }],
    ...URLS_ABONNEMENT.map(url => [{ texte: `M'abonner sur ${domaine(url)}`, url }]),
    [{ texte: "Contacter l'équipe", data: 'm:equipe' }],
  ]
}

/**
 * Menu d'un compte a acces offert SANS rattachement (Brice, 06/10) : rien a
 * mettre en pause ni a arreter, donc sa situation et l'equipe. Jamais « J'ai
 * paye : verifier mon email ».
 */
export function clavierAccesOffert(): Bouton[][] {
  return [
    [{ texte: 'Mon abonnement', data: 'm:abo' }],
    [{ texte: "Contacter l'équipe", data: 'm:equipe' }],
  ]
}

export function clavierDureesPause(): Bouton[][] {
  return [
    [1, 2, 3].map(n => ({ texte: `${n} mois`, data: `p:${n}` })),
    [4, 5, 6].map(n => ({ texte: `${n} mois`, data: `p:${n}` })),
  ]
}

/**
 * Sous TEXTE_PAUSE_AVANT_ARRET (config.ts) : la pause (le choix des durees,
 * comme le bouton du menu) ou l'arret quand meme, qui passe directement a la
 * confirmation, sans reproposer la pause.
 */
export function clavierPauseAvantArret(): Bouton[][] {
  return [
    [{ texte: 'Plutôt une pause', data: 'm:pause' }],
    [{ texte: "J'arrête quand même", data: 'm:arret_ok' }],
  ]
}

export function clavierConfirmation(nonce: string): Bouton[][] {
  return [[{ texte: 'Oui, je confirme', data: `c:${nonce}` }, { texte: 'Non, laisse tomber', data: `x:${nonce}` }]]
}

/**
 * Le bouton « Contacter l'equipe » : le fil passe en « veut un humain » dans
 * l'ecran Support du cockpit, et la reponse de l'equipe arrive ici, par le bot.
 */
export const TEXTE_EQUIPE = `C'est noté, je préviens l'équipe : quelqu'un va te répondre ici, dans cette conversation.\n\n`
  + `Écris ta question juste en dessous, en quelques mots.`

/**
 * « Contacter l'equipe » quand le fil Support n'a pas pu passer en attente
 * (pont en panne, migration pas appliquee) : personne ne verrait le message
 * ici, donc on donne l'adresse de l'equipe au lieu de promettre une reponse.
 */
export const TEXTE_EQUIPE_INDISPONIBLE = `Je n'arrive pas à prévenir l'équipe d'ici pour le moment.\n\n`
  + `Écris-lui à ${SUPPORT}, avec l'email de ton paiement : elle te répond par email.`

/**
 * Ajoute a une reponse qui promet l'equipe, quand le fil Support n'a pas pu
 * passer en attente : le membre a toujours une porte qui marche.
 */
export const TEXTE_SECOURS_EQUIPE = `Si personne ne te répond ici, écris à ${SUPPORT} avec l'email de ton paiement.`

/** Pendant qu'un humain de l'equipe a la main : le bot ne repond pas a sa place. */
export const TEXTE_ATTENTE_HUMAIN = `J'ai transmis ton message à l'équipe : quelqu'un te répond ici, dans cette conversation.\n\n`
  + `En attendant, les boutons marchent toujours :`

export const TEXTE_NON_RATTACHE = `Je ne sais pas encore qui tu es côté abonnement.\n\n`
  + `Tu as payé ? Envoie-moi ici l'email de ton paiement : je t'envoie un code à 6 chiffres pour vérifier, puis je te relie à ton abonnement.\n\n`
  + `Pas encore abonné ? ${texteAbonnement()}`

export const TEXTE_PANNE = PANNE
