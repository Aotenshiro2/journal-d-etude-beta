// Passage quotidien du Live Club (29/09), appele par GET /api/cron/liveclub
// (cron Vercel, 7 h UTC). Six taches, dans cet ordre :
//   (a) PAUSES : adoption d'une pause posee hors du bot (Dashboard Stripe),
//       sortie quand la pause commence, rappel J-7 avant la reprise,
//       lien de retour quand les prelevements ont repris ;
//   (b) ACCES BROKER : rappel J-7, sortie a l'echeance sans abonnement ;
//   (c) DESABONNES : SIMULES tant que Metricgram tourne (un maitre par geste),
//       sauf LIVECLUB_SORTIES_ACTIVES === '1' ;
//   (e) RAPPEL J-3 avant chaque prelevement (Brice, 29/09) : montant, date,
//       lien du portail Stripe pour la carte, une fois par echeance ;
//   (f) SORTIES ABUSIVES DE METRICGRAM (transition, 29/09) : un compte sorti
//       ou banni par Metricgram alors que notre droit vaut 'oui' ET existait
//       deja le jour de la sortie est signale une fois par sortie (geste
//       'refus', regle 'sortie_abusive_metricgram'), et s'il a deja parle au
//       bot, le bot lui envoie un lien de retour, un seul par 30 jours (un
//       membre rebanni est signale 'rebanni_metricgram', sans second lien) ;
//       un lien rate sur une panne est retente 2 fois ;
//   (g) IMPAYES (Brice, 30/09) : sortie SANS ban 5 jours apres le premier
//       echec de paiement (abonnement past_due ou unpaid), une fois par
//       facture, avec le montant et le lien de la facture. SIMULEE sans
//       sortiesImpayesActives() (LIVECLUB_SORTIES_IMPAYES, ou la bascule) ;
//   (h) REOUVERTURE : la facture de la sortie (notre bot ou Metricgram) est
//       reglee, le membre est absent : ban leve, lien de demande d'adhesion
//       en prive, sinon lien personnel vers le bot par email. Une fois par
//       reouverture, REELLE meme avant la bascule (un droit ouvert) ;
//   (i) FENETRE DE 30 JOURS : resiliation de l'abonnement, puis annulation de
//       ses factures ouvertes, puis message. SIMULEE sans la bascule ;
//   (j) RATTRAPAGE des emails de bienvenue : abonnement cree depuis moins de
//       3 jours, sans compte Telegram ni email deja envoye. SIMULE sans la
//       bascule (Metricgram envoie encore le sien) ;
//   (k) EXEMPTIONS DATEES (Brice, 06/10) : une exemption datee vaut sortie
//       programmee. Rappel J-7 avant la date, puis, le lendemain de la date
//       (jusquau inclus), sortie SANS ban si le compte est present, ni admin
//       ni createur, et sans autre droit ; l'exemption est alors close
//       (retire_le, retire_par laisse vide : pas d'identite serveur en uuid).
//       Absent du groupe, ou autre droit : on clot simplement. Une fois par
//       exemption. SIMULEE sans la bascule. Une exemption permanente (sans
//       date) n'est jamais concernee ;
//   (o) SUIVI DES LOTS d'un acces broker (Brice et Mel, 31/10, lots-pur.ts) :
//       deux relances en prive, une fois chacune, puis a la fin du delai la
//       PAUSE de l'acces (sortie SANS ban, message), le filet du retour des
//       que les lots sont notes faits. Une declaration en cours arrete tout.
//       Pause SIMULEE sans la bascule ; LIVECLUB_SUIVI_LOTS=0 coupe la tache ;
//   (p) DEPOT PERDU (Brice, 31/10, « pas de commission pas d'acces ») : un
//       acces broker ferme sort SANS ban, recoit un message une fois, l'equipe
//       est prevenue une fois ; filet du retour apres une regularisation.
//       LIVECLUB_DEPOT_PERDU=0 coupe la tache ;
//   (q) CONSEILS D'ACCUEIL (Brice, 31/10, tips-accueil-pur.ts) : un nouveau
//       membre recoit un conseil par jour au plus (J+1, J+2, J+4, J+7), apres
//       les relances des lots. LIVECLUB_TIPS_ACCUEIL=0 coupe la tache ;
//   (d) purge des conversations privees de plus de 7 jours ;
//   (m) RESUME DU MATIN (Brice, 15/10, resume.ts) : en dernier, Agent AOK
//       envoie en prive a l'equipe (cockpit_telegram_comptes) ce qui a bouge
//       depuis le dernier resume, avec les noms ; rien s'il ne s'est rien
//       passe ; une fois par jour ; LIVECLUB_DIGEST=0 le coupe.
//   (n) RELAIS D'ACCUEIL (Brice, 24/10, relais.ts) : juste avant le resume,
//       le bot des membres envoie en prive a chaque relais (Alex) les membres
//       a qui dire un mot (accueil et silence seulement) ; rien de nouveau =
//       rien ; une fois par jour ; LIVECLUB_RELAIS=0 le coupe.
//
// A CHAQUE SORTIE REELLE (pause, fin d'acces broker, desabonne quand les
// sorties sont actives, fin d'exemption), le membre recoit un message :
// pourquoi, et comment revenir. En prive s'il a deja demarre le bot, sinon
// par email (pour une exemption : seulement si un email est connu).
//
// Metricgram ne voit ni les pauses (Stripe laisse 'active') ni les acces
// broker (aucun abonnement) : sur ces deux-la, on AGIT pour de vrai.
//
// PRUDENCE, avant toute sortie : presence verifiee en direct (getChatMember),
// jamais un admin ni le createur, droit relu en direct (droitLiveClub, plus
// les abonnements de l'email du payeur) et 'inconnu' = on ne touche a rien.
// La sortie passe par retirerDuLiveClub (SANS bannissement, refuse les
// exemptes). Au plus 20 sorties reelles par passage : la 21e est journalisee
// en refus 'plafond_passage' et plus aucune sortie n'est tentee.
//
// UNE FOIS, pour les MESSAGES : chaque envoi est reserve AVANT de partir
// (reserverGeste : verrou transactionnel + ligne 'fait' inseree seulement si
// aucune ligne equivalente n'existe), les acces broker dans rappel_envoye_le.
// Deux passages simultanes (cron livre deux fois, appel a la main) n'envoient
// donc pas deux fois. Les SORTIES, elles, se redecident a chaque passage : une
// pause laisse 'active' chez Stripe et Metricgram peut refaire entrer le
// membre, qu'on ressort alors (sans renvoyer le message).
// Jamais d'email, de texte de message ni de lien dans un log ou dans le
// journal ; la synthese ne rend que des comptes.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  retirerDuLiveClub, journaliserGesteLiveClub, stripeGet,
  type EntreeJournalLiveClub, type GesteJournal,
} from '@/lib/stripe-actions'
import {
  GRACE_JOURS, PLAFOND_RESILIATIONS_PASSAGE, PLAFOND_SORTIES_PASSAGE, chatId, cleStripeLecture, fermetureDepotPerduActive, lienBot,
  sortiesActives, sortiesImpayesActives, suiviLotsActif, tipsAccueilActifs,
} from './config'
import {
  accesFermeDeCommission, accesFermesParDepot, depotsPerdusDesAcces, suiviLotsDeCommission, suivisLotsATraiter,
  type LigneDepotPerdu, type LigneSuiviLots,
} from './lots-lecture'
import { limiteAnnonceeRelance2, limiteEffectiveLots, limiteLots, phaseLots, type IssueFermetureDepot } from './lots-pur'
import { alerterEquipeDepotPerdu, fermerRetourLots, retourApresLots, retourApresRegularisation, texteAlerteDepot } from './lots'
import {
  listerAbonnementsLiveClub, clientsStripeParEmail, abonnementsLiveClubParEmail, abonnementsLiveClubDuClient, adopterPause,
  effacerMetadonneesPause,
  lireAbonnement, apercuProchaineFacture as apercuStripe, facturesPayeesAbonnement, fermerFenetreImpaye,
  annulerFacturesOuvertes,
  type AbonnementResume,
} from './stripe'
import { droitLiveClub, type Droit } from './droits'
import { annulerReservationEmail, creerJeton, jetonExistant } from './jetons'
import { preparerBienvenue } from './bienvenue'
import { rapprocherTarifsReserves } from './reserves'
import { resumeDuMatin } from './resume'
import { relaisDuMatin } from './relais'
import { appelTelegram, envoyer, lienDemandeAdhesion } from './telegram'
import { lireEtatFil, tracerGeste, tracerMessageBot } from './support-pont'
import { quiRepond } from './support-pont-pur'
import { lireHistorique } from './conversations'
import {
  TIPS_ACCUEIL_DEPUIS, TIPS_FENETRE_JOURS, boutonsTip, dejaParle, estCleTip, texteTip, tipsDus,
} from './tips-accueil-pur'
import {
  emailRappelPause, emailDebutPauseSansReprise, emailRetour, emailRappelFinBroker, emailFinBroker,
  emailSortieDesabonne, emailRappelPrelevement, emailSortieImpaye, emailReouverture, emailFinFenetre, emailBienvenue,
  emailRappelFinExemption, emailFinExemption, emailRelanceLots, emailSuspensionLots, modeleRelanceLots, modeleSuspensionLots,
  emailFermetureDepot, modeleFermetureDepot,
  modeleRappelPause, modeleDebutPauseSansReprise, modeleRetour, modeleRappelFinBroker, modeleFinBroker,
  modeleSortieDesabonne, modeleRappelPrelevement, modeleRetourSortieAbusive, modeleSortieImpaye, modeleReouverture,
  modeleFinFenetre, modeleRappelFinExemption, modeleFinExemption, boutonsTelegram,
  type ModeleMessage, type ResultatEmail,
} from './emails'
import {
  abonnementOuvreLeGroupe, dateIso, enRetardDePaiement, etatImpaye, joursDepuisPremierEchec, limiteFenetreImpaye,
  messageErreur, normaliserEmail, relationAbsente, statutDonneDroit, statutTermine,
  type Impaye,
} from './pur'
import {
  PlafondSorties, pauseASortir, repriseAPrevenir, repriseFaite, desabonneHorsGrace, finAbonnement,
  debutSerieImpayee, brokerAPrevenir, brokerFini, lirePresence, estIntouchable,
  prelevementAPrevenir, montantAAnnoncer, clePrelevement, jourParis, sortieAbusiveASignaler, cleSortieAbusive,
  droitCouvraitLaSortie, retourARetenter, decisionSortieImpaye, decisionFenetre, decisionReouverture,
  factureRegleeApresSortie, bienvenueARattraper,
  jourLePlusAncien, phaseExemption, decisionRappelExemption, decisionFinExemption,
  FENETRE_FIN_BROKER_JOURS, FENETRE_RAPPEL_JOURS, RAPPEL_FIN_EXEMPTION_JOURS,
  type FactureBreve, type Presence, type LectureExemption,
} from './passage-regles'

const ACTEUR = 'cron:liveclub'
/** On arrete de prendre de nouveaux cas apres 4 minutes (maxDuration de la route : 300 s). */
const BUDGET_MS = 240_000
/** Garde-fou sur les rattachements sans client Stripe a resoudre par leur email. */
const MAX_RESOLUTIONS_EMAIL = 300
/** Le resume du matin ne part plus apres 4 min 25 (il lui faut quelques secondes, la route en a 300). */
const BUDGET_RESUME_MS = 265_000
/** Le relais d'accueil (24/10) passe avant le resume : il lui laisse au moins 10 s. */
const BUDGET_RELAIS_MS = 255_000

export type SynthesePassage = {
  ok: boolean
  sorties_actives: boolean
  /** Interrupteur separe de la sortie des impayes (LIVECLUB_SORTIES_IMPAYES, ou la bascule). */
  sorties_impayes_actives: boolean
  duree_ms: number
  /** Le budget de temps a ete atteint : le reste passera demain. */
  interrompu: boolean
  sorties_reelles: number
  plafond_atteint: boolean
  /** resorties : deja sortis pour cette pause mais revenus (Metricgram), ressortis sans message. */
  pauses: { adoptees: number; metadonnees_effacees: number; sorties: number; resorties: number; rappels_j7: number; retours: number; boucles_closes: number; deja_faits: number; ignores: number; inconnus: number; echecs: number }
  /** messages_fin : messages de fin d'acces partis (dont ceux rattrapes apres un echec). */
  broker: { rappels_j7: number; sorties: number; messages_fin: number; termines_sans_sortie: number; ignores: number; inconnus: number; echecs: number }
  /**
   * messages : messages de sortie partis (seulement quand les sorties sont
   * actives), dont ceux rattrapes apres un echec (7 jours au plus).
   */
  desabonnes: { simules: number; sorties: number; messages: number; deja_traites: number; gardes: number; absents: number; inconnus: number; echecs: number }
  /** Rappel J-3 avant prelevement. montants_inconnus : partis avec la date seule. */
  prelevements: { rappels_j3: number; montants_inconnus: number; apercus_illisibles: number; deja_faits: number; ignores: number; inconnus: number; echecs: number }
  /**
   * Sorties par Metricgram d'un compte qui avait droit au groupe.
   * signalees : nouvelles lignes 'sortie_abusive_metricgram' ; liens_envoyes :
   * lien de retour parti en prive ; sans_lien : signalees mais pas de lien
   * automatique (bot jamais demarre, bot bloque, droit vu par l'email seul,
   * panne Telegram, rebanni) : a reintegrer depuis le cockpit.
   * rebannis : Metricgram l'a ressorti apres un lien deja envoye (30 jours) :
   * pas de second lien, a corriger dans Metricgram. droit_posterieur : droit
   * pris apres la sortie (reabonne), pas une sortie abusive, rien d'ecrit.
   * retours_retentes : liens retentes apres une panne passagere.
   */
  metricgram: { signalees: number; liens_envoyes: number; sans_lien: number; rebannis: number; retours_retentes: number; deja_signalees: number; revenus: number; sans_droit: number; droit_posterieur: number; pour_impaye: number; inconnus: number; echecs: number }
  /**
   * (g) Sortie a 5 jours. en_grace : abonnements en retard depuis 5 jours au
   * plus (groupe garde) ; sans_compte : abonnements a sortir sans compte
   * Telegram rattache ; gardes : exempte, admin, ou autre droit ; deja_traites :
   * deja sortis (ou simules) pour cette facture.
   */
  impayes: { simules: number; sorties: number; messages: number; en_grace: number; deja_traites: number; gardes: number; absents: number; sans_compte: number; inconnus: number; echecs: number }
  /** (h) Reouverture apres une sortie pour impaye (facture reglee). */
  reouvertures: { liens_prives: number; emails: number; deja_revenus: number; deja_faits: number; sans_droit: number; inconnus: number; echecs: number }
  /** (i) Fenetre de 30 jours. plus_a_resilier : paye ou termine entre la liste et la relecture. */
  fenetre_30j: { simulees: number; resiliations: number; factures_annulees: number; factures_en_echec: number; messages: number; plus_a_resilier: number; reportees: number; deja_faits: number; inconnus: number; echecs: number }
  /** (j) Rattrapage des emails de bienvenue. */
  bienvenue: { simules: number; envoyes: number; deja_envoyes: number; deja_traites: number; rattaches: number; sans_email: number; inconnus: number; echecs: number }
  /**
   * (k) Exemptions datees (Brice, 06/10). rappels_j7 : rappels partis ;
   * sorties : sorties reelles ; simulees : rappels et sorties simules sans
   * l'interrupteur ; messages_fin : messages de fin partis (rattrapages
   * compris) ; closes_absent : plus dans le groupe, exemption close sans
   * sortie ni message ; gardees_autre_droit : abonnement, broker, acces
   * manuel ou admin du groupe, exemption close sans sortie ; sans_moyen :
   * rappel ou message impossible (bot jamais demarre, aucun email connu).
   */
  exemptions: { rappels_j7: number; sorties: number; simulees: number; messages_fin: number; closes_absent: number; gardees_autre_droit: number; sans_moyen: number; inconnus: number; echecs: number }
  /**
   * (o) Suivi des lots d'un acces broker (31/10). pauses : sorties reelles
   * (acces en pause, sans ban) ; simulees : sans sortiesActives() ; declares :
   * une declaration attend l'equipe (rien n'est fait) ; sans_compte : jamais
   * entre (lien personnel pas ouvert) ; gardes : admin, ou autre droit ;
   * retours : liens de retour du filet ; coupe : LIVECLUB_SUIVI_LOTS=0.
   */
  lots: {
    relances_1: number; relances_2: number; pauses: number; simulees: number; messages: number; retours: number
    deja_revenus: number; deja_faits: number; declares: number; absents: number; gardes: number; sans_compte: number
    inconnus: number; echecs: number; coupe: boolean
  }
  /**
   * (p) Depot perdu (31/10, « pas de commission, pas d'acces ») : sorties
   * reelles (sans ban), simulees sans sortiesActives(), messages de fermeture,
   * alertes a l'equipe, liens de retour apres une regularisation ; gardes :
   * admin, ou autre droit ; coupe : LIVECLUB_DEPOT_PERDU=0.
   */
  depots_perdus: {
    sorties: number; simulees: number; messages: number; alertes: number; retours: number; deja_revenus: number
    absents: number; gardes: number; sans_compte: number; inconnus: number; echecs: number; coupe: boolean
  }
  /**
   * (q) Conseils d'accueil (31/10, tips-accueil-pur.ts) : envoyes ; sautes
   * (sujet deja aborde) ; decales (relance des lots partie aujourd'hui) ;
   * absents, sans_droit, equipe (fil qui attend l'equipe ou equipe a la main) :
   * rien aujourd'hui ; coupe : LIVECLUB_TIPS_ACCUEIL=0.
   */
  tips: {
    envoyes: number; sautes: number; decales: number; absents: number; sans_droit: number; equipe: number
    deja_faits: number; inconnus: number; echecs: number; coupe: boolean
  }
  purge: { conversations: number }
  /**
   * (l) Tarifs reserves (13/10) : reservations ouvertes rapprochees des
   * abonnements de leur tarif (meme email). payees : marquees payees ce
   * passage ; en_attente : rien de paye ; illisibles : tarif pas lu chez Stripe.
   */
  tarifs_reserves: { payees: number; en_attente: number; illisibles: number }
  /**
   * (m) Resume du matin a l'equipe (15/10, resume.ts) : son etat (envoye,
   * rien, deja_fait, coupe, table_absente...), ses lignes et le nombre de
   * destinataires qui l'ont recu. Jamais un nom.
   */
  resume: { etat: string; lignes: number; livres: number }
  /**
   * (n) Relais d'accueil (24/10, relais.ts) : son etat (envoye, rien,
   * deja_fait, sans_relais, coupe, table_absente...), les membres transmis
   * et les relais qui ont tout recu. Jamais un nom.
   */
  relais: { etat: string; lignes: number; livres: number }
  /** Lignes de journal perdues (table ou contrainte pas encore migree). */
  journal_echecs: number
  /** Messages qui n'ont pu partir ni en prive ni par email. */
  messages_perdus: number
  /** Codes courts, sans aucune donnee personnelle. */
  erreurs: string[]
}

type Rattache = { telegramId: number; clientStripe: string | null; compte: string | null; email: string | null; membreId: string | null }

type Contexte = {
  maintenant: Date
  debut: number
  plafond: PlafondSorties
  s: SynthesePassage
  /** Comptes Telegram sortis pendant ce passage (une seule sortie par compte). */
  sortis: Set<number>
  emailsClients: Map<string, string | null>
  /**
   * Sorties (cleSortieAbusive) dont la facture impayee a ete reglee depuis :
   * la reouverture s'en charge, la tache Metricgram ne les signale pas comme
   * sorties abusives (ce n'en sont pas : le membre ne payait plus).
   */
  sortiesImpayeReglees: Set<string>
}

function tempsEcoule(ctx: Contexte): boolean {
  if (Date.now() - ctx.debut > BUDGET_MS) {
    ctx.s.interrompu = true
    return true
  }
  return false
}

function erreur(ctx: Contexte, code: string, err?: unknown) {
  if (!ctx.s.erreurs.includes(code)) ctx.s.erreurs.push(code)
  if (err !== undefined) console.warn(`[liveclub/passage] ${code} : ${messageErreur(err)}`)
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

async function lireRattachements(): Promise<Rattache[]> {
  const lignes = await prisma.$queryRaw<{ telegram_id: bigint; client_stripe: string | null; compte: string | null; email: string | null; membre_id: string | null }[]>`
    select telegram_id, client_stripe, compte, email, membre_id
    from public.cockpit_liveclub_rattachements
    where retire_le is null`
  return lignes
    .map(l => ({
      telegramId: Number(l.telegram_id), clientStripe: l.client_stripe, compte: l.compte,
      email: l.email, membreId: l.membre_id,
    }))
    .filter(r => Number.isSafeInteger(r.telegramId))
}

/**
 * client Stripe -> comptes Telegram rattaches. Meme lecture que droits.ts :
 * le client rattache ne compte que s'il vient du compte melanie (compte null
 * ou 'melanie'), car importer_metricgram.py garde aussi des clients du compte
 * aoknowledge. Et quand ce client ne porte aucun abonnement Live Club dans la
 * liste deja lue (achat ponctuel, abonnement pris sous un autre cus_ du meme
 * email), on resout AUSSI par l'email. Une resolution ratee laisse ce compte
 * hors du passage, ce qui ne sort personne.
 */
async function indexerParClient(
  ctx: Contexte,
  rattaches: Rattache[],
  abonnements: AbonnementResume[],
): Promise<Map<string, Rattache[]>> {
  const index = new Map<string, Rattache[]>()
  const ajouter = (cus: string, r: Rattache) => {
    const liste = index.get(cus) ?? []
    if (!liste.some(x => x.telegramId === r.telegramId)) liste.push(r)
    index.set(cus, liste)
  }
  const clientsLiveClub = new Set(abonnements.map(a => a.clientStripe).filter((c): c is string => Boolean(c)))
  const parEmail = new Map<string, string[]>()
  let resolutions = 0
  const budgetEpuise = () => {
    if (resolutions >= MAX_RESOLUTIONS_EMAIL || tempsEcoule(ctx)) {
      erreur(ctx, 'rattachements_par_email_non_resolus')
      return true
    }
    return false
  }
  for (const r of rattaches) {
    const clientMelanie = r.clientStripe && (r.compte == null || r.compte === 'melanie') ? r.clientStripe : null
    if (clientMelanie) {
      ajouter(clientMelanie, r)
      if (clientsLiveClub.has(clientMelanie)) continue
    }
    // Pas de client melanie qui porte le Live Club : on passe par l'email,
    // celui du rattachement, sinon celui du client melanie (lu sur Stripe).
    let email = normaliserEmail(r.email)
    if (!email && clientMelanie && !ctx.emailsClients.has(clientMelanie)) {
      if (budgetEpuise()) continue
      resolutions++
    }
    if (!email && clientMelanie) email = await emailClient(ctx, clientMelanie)
    if (!email) continue
    let clients = parEmail.get(email)
    if (!clients) {
      if (budgetEpuise()) continue
      resolutions++
      try {
        clients = await clientsStripeParEmail(email)
      } catch (err) {
        erreur(ctx, 'rattachements_par_email_illisibles', err)
        continue
      }
      parEmail.set(email, clients)
    }
    for (const cus of clients) ajouter(cus, r)
  }
  return index
}

/** telegram_id -> present, d'apres le webhook (pre-filtre des desabonnes). Vide si illisible. */
async function presencesConnues(ctx: Contexte): Promise<Map<number, boolean>> {
  try {
    const lignes = await prisma.$queryRaw<{ telegram_id: bigint; present: boolean }[]>`
      select telegram_id, present from public.cockpit_telegram_membres`
    return new Map(lignes.map(l => [Number(l.telegram_id), l.present]))
  } catch (err) {
    erreur(ctx, 'membres_telegram_illisibles', err)
    return new Map()
  }
}

/** Presence en direct dans le groupe (getChatMember). Panne = inconnu. */
async function presence(telegramId: number): Promise<Presence> {
  const c = chatId()
  if (!c) return { etat: 'inconnu', statut: null }
  const r = await appelTelegram('getChatMember', { chat_id: c, user_id: telegramId })
  if (!r.ok) {
    if (r.code === 400 && /user not found|participant_id_invalid|member not found/i.test(r.erreur)) {
      return { etat: 'non', statut: null }
    }
    return { etat: 'inconnu', statut: null }
  }
  const m = r.result as { status?: string; is_member?: boolean } | undefined
  return lirePresence(String(m?.status ?? '') || null, m?.is_member)
}

/** Email d'un client Stripe (cache du passage). null si absent ou illisible. */
async function emailClient(ctx: Contexte, clientStripe: string | null): Promise<string | null> {
  if (!clientStripe || !/^cus_[A-Za-z0-9]{8,}$/.test(clientStripe)) return null
  if (ctx.emailsClients.has(clientStripe)) return ctx.emailsClients.get(clientStripe) ?? null
  let email: string | null = null
  const cle = cleStripeLecture()
  if (cle) {
    try {
      const client = await stripeGet(cle, `/v1/customers/${clientStripe}`)
      email = normaliserEmail(client.email)
    } catch (err) {
      erreur(ctx, 'emails_clients_illisibles', err)
    }
  }
  ctx.emailsClients.set(clientStripe, email)
  return email
}

/**
 * Debut de la serie de factures impayees d'un abonnement 'unpaid' (Stripe en
 * direct, 100 factures les plus recentes). Jette sur une panne ; null si
 * aucune facture impayee n'est lisible.
 */
async function debutImpayes(abonnementId: string): Promise<string | null> {
  const cle = cleStripeLecture()
  if (!cle) throw new Error('cle Stripe de lecture absente')
  const q = new URLSearchParams({ subscription: abonnementId, limit: '100' })
  const liste = await stripeGet(cle, `/v1/invoices?${q}`)
  const factures: FactureBreve[] = ((liste.data as { status?: string; created?: number }[] | undefined) ?? [])
    .map(f => ({
      statut: String(f.status ?? ''),
      creeLe: typeof f.created === 'number' ? new Date(f.created * 1000).toISOString() : null,
    }))
  return debutSerieImpayee(factures)
}

/**
 * Le droit juste avant une sortie : droitLiveClub (exemption, abonnement du
 * payeur rattache, acces broker, acces manuel), puis les abonnements Live
 * Club portes par les emails connus du payeur (un nouvel abonnement pris sous
 * un autre client Stripe avec la meme adresse). Toute panne = inconnu.
 */
async function droitAvantSortie(
  telegramId: number,
  emails: (string | null)[],
): Promise<'oui' | 'non' | 'inconnu'> {
  return (await droitAvantSortieDetaille(telegramId, emails)).statut
}

/**
 * droitAvantSortie, avec la raison du 'oui' (exemption, abonnement, broker,
 * acces manuel ; 'abonnement' aussi pour un abonnement trouve par l'email).
 * exemptionIgnoree : la fin d'exemption juge le droit SANS cette exemption.
 */
async function droitAvantSortieDetaille(
  telegramId: number,
  emails: (string | null)[],
  opts: { exemptionIgnoree?: string | null } = {},
): Promise<{ statut: 'oui' | 'non' | 'inconnu'; raison: Droit['raison'] }> {
  const d = await droitLiveClub(telegramId, opts)
  if (d.statut !== 'non') return { statut: d.statut, raison: d.raison }
  const propres = [...new Set(emails.map(e => normaliserEmail(e)).filter((e): e is string => Boolean(e)))]
  for (const email of propres) {
    try {
      const abonnements = await abonnementsLiveClubParEmail(email)
      if (abonnements.some(abonnementOuvreLeGroupe)) return { statut: 'oui', raison: 'abonnement' }
    } catch {
      return { statut: 'inconnu', raison: null }
    }
  }
  return { statut: 'non', raison: null }
}

/**
 * Ce geste est-il deja dans le journal ? Jette si la table ne repond pas :
 * l'appelant ne fait alors rien (sans cette lecture, « une fois » ne tient pas).
 */
async function gesteExiste(p: {
  geste: GesteJournal
  regle: string
  resultats: string[]
  abonnementId?: string | null
  telegramId?: number | null
  /**
   * Fin payee de la pause ('YYYY-MM-DD', details.paye_jusquau) : c'est elle
   * qui identifie une pause, pas la reprise (null pour une pause sans
   * reprise, et changee quand la pause est prolongee au Dashboard).
   */
  payeJusquau?: string | null
  /** Un champ de details a egaler (ex. facture_id : « une fois par facture », 30/09). */
  detail?: { cle: string; valeur: string } | null
}): Promise<boolean> {
  const abo = p.abonnementId ?? null
  const tid = p.telegramId ?? null
  const paye = p.payeJusquau ?? null
  const cle = p.detail?.cle ?? null
  const valeur = p.detail?.valeur ?? null
  const lignes = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_liveclub_gestes
    where geste = ${p.geste} and regle = ${p.regle}
      and resultat = any(${p.resultats}::text[])
      and (${abo}::text is null or abonnement_id = ${abo})
      and (${tid}::bigint is null or telegram_id = ${tid}::bigint)
      and (${paye}::text is null or details->>'paye_jusquau' = ${paye})
      and (${cle}::text is null or details->>${cle}::text = ${valeur}::text)
    limit 1`
  return lignes.length > 0
}

/**
 * Ferme une ligne reservee (reserverGeste) qui n'est pas un envoi : son
 * resultat final et des details en plus. Une ligne 'fait' ou 'refuse' d'un
 * compte Telegram va aussi au fil Support (sauf fil: false, pour une simple
 * mise a jour). Une panne est comptee dans journal_echecs.
 */
async function noterGeste(
  ctx: Contexte,
  gesteId: bigint,
  n: { resultat: 'fait' | 'refuse' | 'echec'; details: Record<string, unknown>; fil?: boolean },
) {
  try {
    const lignes = await prisma.$queryRaw<{ telegram_id: bigint | null; membre_id: string | null; geste: string; resultat: string; regle: string | null; details: Record<string, unknown> | null }[]>`
      update public.cockpit_liveclub_gestes
      set resultat = ${n.resultat}, details = details || ${JSON.stringify(n.details)}::jsonb
      where geste_id = ${gesteId}
      returning telegram_id, membre_id::text as membre_id, geste, resultat, regle, details`
    const g = lignes[0]
    if (n.fil !== false && g?.telegram_id != null && (g.resultat === 'fait' || g.resultat === 'refuse')) {
      await tracerGeste(Number(g.telegram_id), { geste: g.geste, resultat: g.resultat, regle: g.regle, details: g.details }, { membreId: g.membre_id })
    }
  } catch (err) {
    ctx.s.journal_echecs++
    erreur(ctx, 'journal_ecriture', err)
  }
}

// ---------------------------------------------------------------------------
// Gestes
// ---------------------------------------------------------------------------

async function tracer(
  ctx: Contexte,
  entree: EntreeJournalLiveClub,
  contexte: { telegramId: number | null; membreId?: string | null; abonnementId?: string | null },
) {
  const r = await journaliserGesteLiveClub(entree, { ...contexte, acteur: ACTEUR })
  if (r === 'echec') ctx.s.journal_echecs++
}

type Reservation = {
  /** Cle du verrou : un meme envoi, quel que soit le passage qui le tente. */
  cle: string
  /** Condition « deja fait » (select 1 from cockpit_liveclub_gestes ...). */
  deja: Prisma.Sql
  geste: GesteJournal
  regle: string
  telegramId: number | null
  membreId?: string | null
  abonnementId: string | null
  details: Record<string, unknown>
}

/**
 * Reserve un envoi AVANT qu'il parte. Dans une seule transaction : verrou
 * consultatif de TRANSACTION sur la cle (pg_advisory_xact_lock, rendu au
 * commit : il tient derriere le pooler en mode transaction, contrairement a un
 * verrou de session), puis insertion de la ligne 'fait' seulement si la
 * condition « deja fait » est fausse. Le second passage attend le verrou, puis
 * voit la ligne du premier. Renvoie l'id de la ligne reservee, ou null si
 * l'envoi est deja fait. Jette si la base ne repond pas : l'appelant n'envoie
 * alors rien (sans reservation, « une fois » ne tient pas).
 */
async function reserverGeste(r: Reservation): Promise<bigint | null> {
  const lignes = await prisma.$transaction(async tx => {
    await tx.$queryRaw`
      select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${r.cle}::text, 0))) as verrou`
    return tx.$queryRaw<{ geste_id: bigint }[]>`
      insert into public.cockpit_liveclub_gestes
        (telegram_id, membre_id, abonnement_id, geste, resultat, acteur, regle, details)
      select ${r.telegramId}::bigint, ${r.membreId ?? null}::uuid, ${r.abonnementId}::text,
             ${r.geste}::text, 'fait', ${ACTEUR}::text, ${r.regle}::text, ${JSON.stringify(r.details)}::jsonb
      where not exists (${r.deja})
      returning geste_id`
  })
  return lignes[0]?.geste_id ?? null
}

/**
 * Ferme une reservation : l'envoi est parti (canal et compte Telegram notes)
 * ou rien n'est parti (la ligne passe en 'echec', le prochain passage
 * reessaie). Une panne ici est comptee dans journal_echecs.
 */
async function cloreReservation(
  ctx: Contexte,
  gesteId: bigint,
  envoi: { canal: 'prive' | 'email'; telegramId: number | null } | null,
) {
  try {
    if (envoi) {
      const lignes = await prisma.$queryRaw<{ telegram_id: bigint | null; membre_id: string | null; geste: string; resultat: string; regle: string | null; details: Record<string, unknown> | null }[]>`
        update public.cockpit_liveclub_gestes
        set details = details || ${JSON.stringify({ canal: envoi.canal })}::jsonb,
            telegram_id = coalesce(${envoi.telegramId}::bigint, telegram_id)
        where geste_id = ${gesteId}
        returning telegram_id, membre_id::text as membre_id, geste, resultat, regle, details`
      // Le geste reserve (inscrit 'fait' avant l'envoi, hors de
      // journaliserGesteLiveClub) va au fil Support une fois l'envoi parti.
      const g = lignes[0]
      if (g?.telegram_id != null) {
        await tracerGeste(Number(g.telegram_id), { geste: g.geste, resultat: g.resultat, regle: g.regle, details: g.details }, { membreId: g.membre_id })
      }
    } else {
      await prisma.$executeRaw`
        update public.cockpit_liveclub_gestes set resultat = 'echec' where geste_id = ${gesteId}`
    }
  } catch (err) {
    ctx.s.journal_echecs++
    erreur(ctx, 'journal_ecriture', err)
  }
}

/**
 * Prevenir le membre : en prive d'abord (chaque compte Telegram donne, le
 * premier qui passe suffit ; 403 = il n'a jamais ecrit au bot), sinon par
 * email. null = rien n'est parti.
 */
async function prevenir(
  ctx: Contexte,
  telegramIds: number[],
  email: string | null,
  m: ModeleMessage,
  parEmail: (email: string) => Promise<ResultatEmail>,
): Promise<{ canal: 'prive' | 'email'; telegramId: number | null } | null> {
  const texte = m.paragraphes.join('\n\n')
  // (22/10) Le bouton a adresse, puis celui qui revient au bot (sortie pour
  // impaye : « J'ai réglé : revenir dans le groupe »), en prive seulement.
  const boutons = boutonsTelegram(m)
  for (const tid of telegramIds) {
    const r = await envoyer(tid, texte, boutons)
    if (r.ok) {
      // Au fil Support du compte (Brice, 30/09) : le message delivre et les
      // libelles de ses boutons, jamais leur adresse. Ne jette pas.
      await tracerMessageBot(tid, texte, { boutons })
      return { canal: 'prive', telegramId: tid }
    }
  }
  if (email) {
    const r = await parEmail(email)
    if (r.ok) return { canal: 'email', telegramId: null }
  }
  ctx.s.messages_perdus++
  return null
}

/**
 * Une sortie REELLE, sous le plafond du passage. Le journal garde la regle du
 * passage quand la sortie est faite, et celle du refus sinon (exempte,
 * admin_du_groupe...) avec le motif du passage dans details.
 */
async function sortir(
  ctx: Contexte,
  telegramId: number,
  trace: { geste: GesteJournal; regle: string; abonnementId?: string | null; membreId?: string | null; details: Record<string, unknown> },
): Promise<'fait' | 'plafond' | 'refuse' | 'echec'> {
  const contexte = { telegramId, membreId: trace.membreId ?? null, abonnementId: trace.abonnementId ?? null }
  const place = ctx.plafond.prendre()
  if (!place.permis) {
    ctx.s.plafond_atteint = true
    if (place.premierRefus) {
      console.warn(`[liveclub/passage] plafond de ${PLAFOND_SORTIES_PASSAGE} sorties atteint : plus aucune sortie ce passage.`)
      await tracer(ctx, {
        geste: trace.geste, resultat: 'refuse', regle: 'plafond_passage',
        details: { ...trace.details, motif: trace.regle, plafond: PLAFOND_SORTIES_PASSAGE },
      }, contexte)
    }
    return 'plafond'
  }

  let issue: Awaited<ReturnType<typeof retirerDuLiveClub>>
  try {
    issue = await retirerDuLiveClub(telegramId)
  } catch (err) {
    ctx.plafond.rendre()
    erreur(ctx, 'retrait_en_erreur', err)
    await tracer(ctx, { geste: trace.geste, resultat: 'echec', regle: 'exception', details: { ...trace.details, motif: trace.regle } }, contexte)
    return 'echec'
  }
  if (issue.ok) {
    ctx.sortis.add(telegramId)
    await tracer(ctx, { geste: trace.geste, resultat: 'fait', regle: trace.regle, details: { ...issue.details, ...trace.details } }, contexte)
    return 'fait'
  }
  ctx.plafond.rendre()
  await tracer(ctx, {
    geste: trace.geste, resultat: issue.resultat, regle: issue.regle,
    details: { ...issue.details, ...trace.details, motif: trace.regle },
  }, contexte)
  return issue.resultat
}

// ---------------------------------------------------------------------------
// (a) Pauses
// ---------------------------------------------------------------------------

/**
 * 0. Une pause posee HORS de nos poses (tableau de bord Stripe, ou pose
 * d'avant les metadonnees) n'est jamais datee, donc jamais effective : le
 * membre garderait le groupe toute la pause. La premiere fois qu'on la voit,
 * on l'ADOPTE : metadonnees posees avec la fin de periode que Stripe donne
 * maintenant et la reprise posee (adopterPause, metadonneesAdoption dans
 * pur.ts), une ligne 'pause_adoptee' au journal. Elle est ensuite traitee
 * comme les autres. Si la periode avait deja tourne pendant la pause, la
 * sortie arrive un cycle plus tard que la vraie fin payee : c'est voulu,
 * prudent (un cycle de trop plutot qu'un payeur sorti). Une pause deja datee
 * puis MODIFIEE au Dashboard (reprise prolongee) est re-scellee en gardant sa
 * fin payee d'origine (fin_gardee au journal) : un membre deja sorti ne
 * retrouve pas le groupe. Rend l'abonnement relu apres l'adoption, ou null si
 * rien n'a ete adopte.
 */
async function adopterPauseSansDate(ctx: Contexte, a: AbonnementResume, rattaches: Rattache[]): Promise<AbonnementResume | null> {
  const s = ctx.s.pauses
  let issue: Awaited<ReturnType<typeof adopterPause>>
  try {
    issue = await adopterPause(a.id)
  } catch (err) {
    // Cle d'ecriture absente, Stripe en panne : on reessaie au prochain
    // passage. Une pause jamais datee reste non effective (personne ne
    // sort) ; une pause modifiee garde sa fin notee, donc son effet.
    erreur(ctx, 'pause_adoption', err)
    s.echecs++
    return null
  }
  if (!issue) return null
  s.adoptees++
  await tracer(ctx, {
    geste: 'pause', resultat: 'fait', regle: 'pause_adoptee',
    details: {
      paye_jusquau: issue.payeJusquau.slice(0, 10),
      reprise_le: issue.repriseLe ? issue.repriseLe.slice(0, 10) : null,
      sans_reprise: issue.repriseLe === null,
      // true : pause modifiee au Dashboard, fin payee d'origine gardee.
      fin_gardee: issue.finGardee,
    },
  }, { telegramId: rattaches[0]?.telegramId ?? null, membreId: rattaches[0]?.membreId ?? null, abonnementId: a.id })
  return issue.abonnement
}

/**
 * 0 bis. Pause levee au Dashboard (l'agent, lui, efface dans le meme appel) :
 * nos metadonnees restent sur l'abonnement. On les efface, sinon une pause
 * posee plus tard pourrait reprendre cette fin payee perimee et sortir un
 * membre qui a paye. Pas de ligne de journal (menage sans effet sur le
 * membre) ; un echec est compte et retente au prochain passage.
 */
async function effacerMetaPauseRestante(ctx: Contexte, a: AbonnementResume) {
  try {
    if (await effacerMetadonneesPause(a.id)) ctx.s.pauses.metadonnees_effacees++
  } catch (err) {
    erreur(ctx, 'pause_meta_effacement', err)
    ctx.s.pauses.echecs++
  }
}

async function tachePauses(ctx: Contexte, abonnements: AbonnementResume[], parClient: Map<string, Rattache[]>) {
  const s = ctx.s.pauses
  for (const lu of abonnements) {
    if (tempsEcoule(ctx)) return
    let a = lu
    const rattaches = a.clientStripe ? parClient.get(a.clientStripe) ?? [] : []

    if (a.metaPauseRestante && statutDonneDroit(a.statut)) {
      await effacerMetaPauseRestante(ctx, a)
    }
    if (a.pauseADater && statutDonneDroit(a.statut)) {
      a = await adopterPauseSansDate(ctx, a, rattaches) ?? a
    }

    // 1. La pause a commence : sortie du groupe. La sortie se redecide a
    // chaque passage (Stripe dit 'active', Metricgram peut le refaire
    // entrer) ; seul le message de debut de pause part une fois.
    //
    // Une pause s'identifie par sa FIN PAYEE (paye_jusquau), pas par sa
    // reprise : une pause « indefiniment » n'a pas de reprise, et une pause
    // prolongee au Dashboard change de reprise mais reste la meme pause
    // (meme sortie, pas de second message de debut).
    const payeJusquau = a.pausePayeJusquau ? a.pausePayeJusquau.slice(0, 10) : null
    if (pauseASortir(a) && payeJusquau) {
      const reprise = a.pauseJusquau ? a.pauseJusquau.slice(0, 10) : null
      for (const r of rattaches) {
        if (tempsEcoule(ctx)) return
        if (ctx.sortis.has(r.telegramId)) continue
        let dejaSorti: boolean
        try {
          dejaSorti = await gesteExiste({ geste: 'pause', regle: 'pause_effective', resultats: ['fait'], abonnementId: a.id, telegramId: r.telegramId, payeJusquau })
        } catch (err) {
          erreur(ctx, 'journal_illisible', err)
          s.inconnus++
          continue
        }
        const p = await presence(r.telegramId)
        if (p.etat === 'inconnu') { s.inconnus++; continue }
        if (p.etat === 'non') { if (dejaSorti) s.deja_faits++; else s.ignores++; continue }
        if (estIntouchable(p)) { s.ignores++; continue }
        const emailPayeur = await emailClient(ctx, a.clientStripe)
        const email = r.email ?? emailPayeur
        const droit = await droitAvantSortie(r.telegramId, [r.email, emailPayeur])
        if (droit === 'inconnu') { s.inconnus++; continue }
        if (droit === 'oui') { s.ignores++; continue }

        // pause_effective = premiere sortie de cette pause (c'est elle que
        // tacheRetours suit) ; pause_resortie = il etait revenu, on le ressort.
        const issue = await sortir(ctx, r.telegramId, {
          geste: 'pause', regle: dejaSorti ? 'pause_resortie' : 'pause_effective',
          abonnementId: a.id, membreId: r.membreId,
          details: { reprise_le: reprise, paye_jusquau: payeJusquau },
        })
        if (issue === 'plafond') continue
        if (issue !== 'fait') { s.echecs++; continue }
        if (dejaSorti) s.resorties++
        else s.sorties++

        // Message de debut de pause : une fois par compte et par pause (fin
        // payee), avec ou sans date de reprise.
        let reserve: bigint | null
        try {
          reserve = await reserverGeste({
            cle: `liveclub:pause_debut:${a.id}:${r.telegramId}:${payeJusquau}`,
            deja: Prisma.sql`
              select 1 from public.cockpit_liveclub_gestes d
              where d.geste = 'rappel' and d.regle = 'pause_debut' and d.resultat = 'fait'
                and d.abonnement_id = ${a.id} and d.telegram_id = ${r.telegramId}::bigint
                and d.details->>'paye_jusquau' = ${payeJusquau}`,
            geste: 'rappel', regle: 'pause_debut', telegramId: r.telegramId, membreId: r.membreId,
            abonnementId: a.id, details: { reprise_le: reprise, paye_jusquau: payeJusquau, sans_reprise: reprise === null },
          })
        } catch (err) {
          erreur(ctx, 'journal_reservation', err)
          continue
        }
        if (reserve === null) continue
        const envoi = reprise
          ? await prevenir(ctx, [r.telegramId], email, modeleRappelPause(reprise, 'debut'),
            e => emailRappelPause(e, reprise, 'debut'))
          : await prevenir(ctx, [r.telegramId], email, modeleDebutPauseSansReprise(),
            e => emailDebutPauseSansReprise(e))
        await cloreReservation(ctx, reserve, envoi)
      }
    }

    // 2. Rappel J-7 avant la reprise des prelevements, une fois par pause,
    // reserve avant l'envoi.
    const date = repriseAPrevenir(a, ctx.maintenant)
    if (date) {
      let reserve: bigint | null
      try {
        reserve = await reserverGeste({
          cle: `liveclub:pause_j7:${a.id}:${date}`,
          deja: Prisma.sql`
            select 1 from public.cockpit_liveclub_gestes d
            where d.geste = 'rappel' and d.regle = 'pause_j7' and d.resultat = 'fait'
              and d.abonnement_id = ${a.id} and d.details->>'reprise_le' = ${date}`,
          geste: 'rappel', regle: 'pause_j7', telegramId: rattaches[0]?.telegramId ?? null,
          membreId: rattaches[0]?.membreId ?? null, abonnementId: a.id, details: { reprise_le: date },
        })
      } catch (err) {
        erreur(ctx, 'journal_reservation', err)
        s.inconnus++
        continue
      }
      if (reserve === null) { s.deja_faits++; continue }
      const email = rattaches.find(r => r.email)?.email ?? await emailClient(ctx, a.clientStripe)
      const envoi = await prevenir(ctx, rattaches.map(r => r.telegramId), email,
        modeleRappelPause(date, 'j7'), e => emailRappelPause(e, date, 'j7'))
      await cloreReservation(ctx, reserve, envoi)
      if (envoi) s.rappels_j7++
      else s.echecs++
    }
  }
}

/**
 * 3. Retour apres une pause : on part des sorties 'pause_effective' encore
 * ouvertes, et on regarde si les prelevements ont repris.
 *
 * Une boucle est ouverte par la premiere sortie d'un compte sur un
 * abonnement, et fermee par toute ligne 'reprise' ('fait' ou 'refuse') posee
 * APRES elle pour le meme couple (abonnement, compte) : une seule boucle par
 * couple, meme si la pause a ete prolongee ou le membre sorti deux fois. Les
 * boucles mortes (abonnement canceled ou incomplete_expired, ou absent de la
 * liste Stripe, qui est complete ou n'est pas lue du tout)
 * sont fermees en 'refuse'/'pause_sans_reprise' pour ne pas encombrer la
 * lecture. Les plus recentes d'abord.
 */
async function tacheRetours(ctx: Contexte, parId: Map<string, AbonnementResume>) {
  const s = ctx.s.pauses
  let sorties: { geste_id: bigint; telegram_id: bigint; abonnement_id: string; membre_id: string | null; fait_le: Date; reprise_le: string | null }[]
  try {
    sorties = await prisma.$queryRaw`
      select * from (
        select distinct on (g.abonnement_id, g.telegram_id)
          g.geste_id, g.telegram_id, g.abonnement_id, g.membre_id, g.fait_le, g.details->>'reprise_le' as reprise_le
        from public.cockpit_liveclub_gestes g
        where g.geste = 'pause' and g.regle = 'pause_effective' and g.resultat = 'fait'
          and g.abonnement_id is not null and g.telegram_id is not null
          and g.fait_le > now() - interval '400 days'
          and not exists (
            select 1 from public.cockpit_liveclub_gestes r
            where r.geste = 'reprise' and r.resultat in ('fait', 'refuse')
              and r.abonnement_id = g.abonnement_id and r.telegram_id = g.telegram_id
              and r.fait_le >= g.fait_le)
        order by g.abonnement_id, g.telegram_id, g.fait_le
      ) as ouvertes
      order by fait_le desc
      limit 500`
  } catch (err) {
    erreur(ctx, 'journal_illisible', err)
    return
  }

  for (const g of sorties) {
    if (tempsEcoule(ctx)) return
    const telegramId = Number(g.telegram_id)
    const details = { pause_geste_id: String(g.geste_id), reprise_le: g.reprise_le }
    const contexte = { telegramId, membreId: g.membre_id, abonnementId: g.abonnement_id }
    const a = parId.get(g.abonnement_id)

    // Boucle morte : la pause ne reprendra jamais sur cet abonnement. 'unpaid'
    // reste ouvert : une facture reglee plus tard le fait repartir.
    if (!a || (statutTermine(a.statut) && a.statut !== 'unpaid')) {
      await tracer(ctx, {
        geste: 'reprise', resultat: 'refuse', regle: 'pause_sans_reprise',
        details: { ...details, statut: a?.statut ?? 'introuvable' },
      }, contexte)
      s.boucles_closes++
      continue
    }
    if (!repriseFaite(a, g.fait_le)) continue

    const p = await presence(telegramId)
    if (p.etat === 'inconnu') { s.inconnus++; continue }
    if (p.etat === 'oui') {
      // Deja revenu par un autre chemin : on ferme la boucle sans rien envoyer.
      await tracer(ctx, { geste: 'reprise', resultat: 'fait', regle: 'pause_deja_revenu', details }, contexte)
      s.deja_faits++
      continue
    }

    // Reserve AVANT le jeton et l'envoi : un seul passage cree le jeton et
    // envoie le lien, meme si deux passages tournent en meme temps.
    let reserve: bigint | null
    try {
      reserve = await reserverGeste({
        cle: `liveclub:retour:${a.id}:${telegramId}`,
        deja: Prisma.sql`
          select 1 from public.cockpit_liveclub_gestes r
          where r.geste = 'reprise' and r.resultat in ('fait', 'refuse')
            and r.abonnement_id = ${a.id} and r.telegram_id = ${telegramId}::bigint
            and r.fait_le >= ${g.fait_le}`,
        geste: 'reprise', regle: 'pause_retour', telegramId, membreId: g.membre_id,
        abonnementId: a.id, details,
      })
    } catch (err) {
      erreur(ctx, 'journal_reservation', err)
      s.inconnus++
      continue
    }
    if (reserve === null) { s.deja_faits++; continue }

    let lien: string
    try {
      const jeton = await jetonExistant({ abonnementId: a.id, usage: 'retour' })
        ?? await creerJeton({ usage: 'retour', clientStripe: a.clientStripe, abonnementId: a.id })
      lien = lienBot(jeton)
    } catch (err) {
      erreur(ctx, 'jetons_indisponibles', err)
      await cloreReservation(ctx, reserve, null)
      s.echecs++
      continue
    }
    const email = await emailClient(ctx, a.clientStripe)
    const envoi = await prevenir(ctx, [telegramId], email, modeleRetour(lien), e => emailRetour(e, lien))
    await cloreReservation(ctx, reserve, envoi)
    if (envoi) s.retours++
    else s.echecs++
  }
}

// ---------------------------------------------------------------------------
// (b) Acces broker
// ---------------------------------------------------------------------------

type LigneAcces = { acces_id: string; email: string; jusquau: Date; telegram_id: bigint | null; rappel_envoye_le: Date | null }

async function tacheBroker(ctx: Contexte) {
  const s = ctx.s.broker
  await rattraperMessagesFinBroker(ctx)
  let lignes: LigneAcces[]
  try {
    lignes = await prisma.$queryRaw<LigneAcces[]>`
      select acces_id, email, jusquau, telegram_id, rappel_envoye_le
      from public.cockpit_liveclub_acces
      where motif = 'broker' and retire_le is null and sorti_le is null
        and jusquau >= current_date - ${FENETRE_FIN_BROKER_JOURS}::int
        and jusquau <= current_date + ${FENETRE_RAPPEL_JOURS}::int
      order by jusquau`
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'acces_broker_table_absente' : 'acces_broker_illisibles', err)
    return
  }

  for (const l of lignes) {
    if (tempsEcoule(ctx)) return
    const jusquau = dateIso(l.jusquau)
    const tid = l.telegram_id != null ? Number(l.telegram_id) : null
    const contexte = { telegramId: tid, abonnementId: null }

    // 1. Rappel J-7 (avec le lien d'abonnement), une fois.
    if (brokerAPrevenir(jusquau, ctx.maintenant)) {
      if (l.rappel_envoye_le) continue
      // (31/10) Acces deja ferme pour un depot perdu (tache p) : il a eu son
      // message, pas de « ton acces se termine bientot » en plus.
      if ((await depotsPerdusDesAcces([l.acces_id])).has(l.acces_id)) { s.ignores++; continue }
      // Deja abonne (ou autre droit) : pas de rappel « abonne-toi ».
      try {
        const abonnements = await abonnementsLiveClubParEmail(l.email)
        if (abonnements.some(abonnementOuvreLeGroupe)) { s.ignores++; continue }
      } catch (err) {
        erreur(ctx, 'stripe_illisible_broker', err)
        s.inconnus++
        continue
      }
      if (tid) {
        const d = await droitLiveClub(tid)
        if (d.statut === 'inconnu') { s.inconnus++; continue }
        if (d.statut === 'oui' && d.raison !== 'acces_broker') { s.ignores++; continue }
      }
      let reserve: { acces_id: string }[]
      try {
        reserve = await prisma.$queryRaw`
          update public.cockpit_liveclub_acces set rappel_envoye_le = now()
          where acces_id = ${l.acces_id}::uuid and rappel_envoye_le is null
          returning acces_id`
      } catch (err) {
        erreur(ctx, 'acces_broker_ecriture', err)
        s.echecs++
        continue
      }
      if (reserve.length === 0) continue
      const envoi = await prevenir(ctx, tid ? [tid] : [], l.email, modeleRappelFinBroker(jusquau),
        e => emailRappelFinBroker(e, jusquau))
      if (!envoi) {
        // Rien n'est parti : on rend la reservation, le prochain passage reessaie.
        await prisma.$executeRaw`
          update public.cockpit_liveclub_acces set rappel_envoye_le = null where acces_id = ${l.acces_id}::uuid`
          .catch(err => erreur(ctx, 'acces_broker_ecriture', err))
      }
      await tracer(ctx, {
        geste: 'rappel', resultat: envoi ? 'fait' : 'echec', regle: 'broker_j7',
        details: { acces_id: l.acces_id, jusquau, ...(envoi ? { canal: envoi.canal } : {}) },
      }, { ...contexte, telegramId: envoi?.telegramId ?? tid })
      if (envoi) s.rappels_j7++
      else s.echecs++
      continue
    }

    // 2. Echeance passee : sortie s'il est la et sans autre droit.
    if (!brokerFini(jusquau, ctx.maintenant)) continue
    if (tid === null) { s.termines_sans_sortie++; continue }
    if (ctx.sortis.has(tid)) continue
    const p = await presence(tid)
    if (p.etat === 'inconnu') { s.inconnus++; continue }
    if (p.etat === 'non') { s.termines_sans_sortie++; continue }
    if (estIntouchable(p)) { s.ignores++; continue }
    const droit = await droitAvantSortie(tid, [l.email])
    if (droit === 'inconnu') { s.inconnus++; continue }
    if (droit === 'oui') { s.ignores++; continue }

    const issue = await sortir(ctx, tid, { geste: 'fin_acces', regle: 'broker_fin', details: { acces_id: l.acces_id, jusquau } })
    if (issue === 'plafond') continue
    if (issue !== 'fait') { s.echecs++; continue }
    s.sorties++
    try {
      await prisma.$executeRaw`
        update public.cockpit_liveclub_acces set sorti_le = now()
        where acces_id = ${l.acces_id}::uuid and sorti_le is null`
    } catch (err) {
      erreur(ctx, 'acces_broker_ecriture', err)
    }
    if (await messageFinBroker(ctx, l.acces_id, tid, l.email)) s.messages_fin++
  }
}

/**
 * Message de fin d'acces broker (pourquoi, comment revenir), une fois par
 * acces, reserve avant l'envoi (geste 'rappel', regle 'broker_fin_message').
 * Un envoi rate laisse la ligne en 'echec' : rattraperMessagesFinBroker le
 * retente. true = parti.
 */
async function messageFinBroker(ctx: Contexte, accesId: string, telegramId: number, email: string | null): Promise<boolean> {
  let reserve: bigint | null
  try {
    reserve = await reserverGeste({
      cle: `liveclub:broker_fin_message:${accesId}`,
      deja: Prisma.sql`
        select 1 from public.cockpit_liveclub_gestes d
        where d.geste = 'rappel' and d.regle = 'broker_fin_message' and d.resultat = 'fait'
          and d.details->>'acces_id' = ${accesId}`,
      geste: 'rappel', regle: 'broker_fin_message', telegramId, abonnementId: null,
      details: { acces_id: accesId },
    })
  } catch (err) {
    erreur(ctx, 'journal_reservation', err)
    return false
  }
  if (reserve === null) return false
  const envoi = await prevenir(ctx, [telegramId], email, modeleFinBroker(), e => emailFinBroker(e))
  await cloreReservation(ctx, reserve, envoi)
  return envoi !== null
}

/**
 * Messages de fin d'acces broker rates (ligne 'echec', aucune 'fait') pour
 * un acces sorti depuis moins de 7 jours : on retente. Seuls les echecs
 * notes comptent : une sortie d'avant cette reservation, qui n'a aucune
 * ligne de message, n'est pas reprise (le message etait deja parti sans
 * trace, on ne l'envoie pas deux fois).
 */
async function rattraperMessagesFinBroker(ctx: Contexte) {
  const s = ctx.s.broker
  let lignes: { acces_id: string; email: string; telegram_id: bigint }[]
  try {
    lignes = await prisma.$queryRaw`
      select a.acces_id::text as acces_id, a.email, a.telegram_id
      from public.cockpit_liveclub_acces a
      where a.motif = 'broker' and a.telegram_id is not null
        and a.sorti_le > now() - interval '7 days'
        and exists (
          select 1 from public.cockpit_liveclub_gestes e
          where e.geste = 'rappel' and e.regle = 'broker_fin_message' and e.resultat = 'echec'
            and e.details->>'acces_id' = a.acces_id::text)
        and not exists (
          select 1 from public.cockpit_liveclub_gestes f
          where f.geste = 'rappel' and f.regle = 'broker_fin_message' and f.resultat = 'fait'
            and f.details->>'acces_id' = a.acces_id::text)
      limit 100`
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'acces_broker_table_absente' : 'acces_broker_illisibles', err)
    return
  }
  for (const l of lignes) {
    if (tempsEcoule(ctx)) return
    const tid = Number(l.telegram_id)
    if (!Number.isSafeInteger(tid)) continue
    if (await messageFinBroker(ctx, l.acces_id, tid, l.email)) s.messages_fin++
    else s.echecs++
  }
}

// ---------------------------------------------------------------------------
// (c) Desabonnes (simules tant que Metricgram tourne)
// ---------------------------------------------------------------------------

async function tacheDesabonnes(ctx: Contexte, abonnements: AbonnementResume[], parClient: Map<string, Rattache[]>) {
  const s = ctx.s.desabonnes
  const reel = sortiesActives()
  if (reel) await rattraperMessagesSortieDesabonne(ctx, abonnements, parClient)
  const connues = await presencesConnues(ctx)
  const vus = new Set<number>()

  for (const a of abonnements) {
    const rattaches = a.clientStripe ? parClient.get(a.clientStripe) ?? [] : []
    if (rattaches.length === 0) continue
    // 'unpaid' avec une facture ouverte datee (Brice, 30/09) : c'est la
    // tache des impayes (sortie a 5 jours, fenetre de 30 jours) qui s'en
    // charge, avec le montant et le lien de la facture, pas un message
    // « abonnement termine ». Factures illisibles : on ne decide rien.
    if (a.statut === 'unpaid') {
      const e = etatImpaye(a, ctx.maintenant.getTime())
      if (e === 'illisible') { s.inconnus++; continue }
      if (e === 'grace' || e === 'suspendu' || e === 'fenetre_depassee') continue
    }
    // 'unpaid' se date sur ses factures impayees (sa periode avance toute
    // seule) : une lecture Stripe de plus, seulement pour ceux-la.
    let debutImpaye: string | null = null
    if (a.statut === 'unpaid') {
      if (tempsEcoule(ctx)) return
      try {
        debutImpaye = await debutImpayes(a.id)
      } catch (err) {
        erreur(ctx, 'factures_illisibles', err)
        s.inconnus++
        continue
      }
      if (!debutImpaye) { s.inconnus++; continue }
    }
    // La fin retenue est max(fin, fin payee) : un membre qui a paye en retard
    // apres la resiliation garde sa periode payee (finAbonnement). Sortie au
    // premier passage qui suit (GRACE_JOURS = 0 depuis le 08/10).
    if (!desabonneHorsGrace(a, ctx.maintenant, GRACE_JOURS, debutImpaye)) continue
    for (const r of rattaches) {
      if (tempsEcoule(ctx)) return
      if (vus.has(r.telegramId) || ctx.sortis.has(r.telegramId)) continue
      // Le webhook l'a vu partir : pas d'appel Telegram pour rien.
      if (connues.get(r.telegramId) === false) { s.absents++; continue }
      try {
        if (await gesteExiste({
          geste: 'retrait', regle: 'desabonne', resultats: reel ? ['fait'] : ['fait', 'simule'],
          abonnementId: a.id, telegramId: r.telegramId,
        })) {
          s.deja_traites++
          continue
        }
      } catch (err) {
        erreur(ctx, 'journal_illisible', err)
        s.inconnus++
        continue
      }
      const p = await presence(r.telegramId)
      if (p.etat === 'inconnu') { s.inconnus++; continue }
      if (p.etat === 'non') { s.absents++; continue }
      if (estIntouchable(p)) { s.gardes++; continue }
      const droit = await droitAvantSortie(r.telegramId, [r.email, await emailClient(ctx, a.clientStripe)])
      if (droit === 'inconnu') { s.inconnus++; continue }
      if (droit === 'oui') { s.gardes++; continue }
      vus.add(r.telegramId)

      const details = {
        statut: a.statut, fin: finAbonnement(a, debutImpaye)?.slice(0, 10) ?? null,
        paye_jusquau: a.payeJusquau?.slice(0, 10) ?? null, statut_tg: p.statut,
      }
      const contexte = { telegramId: r.telegramId, membreId: r.membreId, abonnementId: a.id }
      if (!reel) {
        await tracer(ctx, { geste: 'retrait', resultat: 'simule', regle: 'desabonne', details }, contexte)
        s.simules++
        continue
      }
      const issue = await sortir(ctx, r.telegramId, { geste: 'retrait', regle: 'desabonne', abonnementId: a.id, membreId: r.membreId, details })
      if (issue === 'plafond') continue
      if (issue !== 'fait') { s.echecs++; continue }
      s.sorties++
      if (await messageSortieDesabonne(ctx, a, r)) s.messages++
    }
  }
}

/**
 * Le message de sortie d'un desabonne (pourquoi, comment revenir), une fois
 * par abonnement et par compte, reserve avant l'envoi. true = parti.
 */
async function messageSortieDesabonne(ctx: Contexte, a: AbonnementResume, r: Rattache): Promise<boolean> {
  let reserve: bigint | null
  try {
    reserve = await reserverGeste({
      cle: `liveclub:sortie_desabonne:${a.id}:${r.telegramId}`,
      deja: Prisma.sql`
        select 1 from public.cockpit_liveclub_gestes d
        where d.geste = 'rappel' and d.regle = 'sortie_desabonne' and d.resultat = 'fait'
          and d.abonnement_id = ${a.id} and d.telegram_id = ${r.telegramId}::bigint`,
      geste: 'rappel', regle: 'sortie_desabonne', telegramId: r.telegramId, membreId: r.membreId,
      abonnementId: a.id, details: { statut: a.statut },
    })
  } catch (err) {
    erreur(ctx, 'journal_reservation', err)
    return false
  }
  if (reserve === null) return false
  const email = r.email ?? await emailClient(ctx, a.clientStripe)
  const envoi = await prevenir(ctx, [r.telegramId], email, modeleSortieDesabonne(), e => emailSortieDesabonne(e))
  await cloreReservation(ctx, reserve, envoi)
  return envoi !== null
}

/**
 * Desabonnes sortis pour de vrai depuis moins de 7 jours dont le message de
 * sortie n'est jamais parti (prive et email en echec) : le lendemain, le
 * compte est absent du groupe et la boucle principale l'ecarte avant tout
 * message. On le retente ici, sauf s'il est revenu dans le groupe (ou si sa
 * presence est illisible). La reservation garde l'unicite.
 */
async function rattraperMessagesSortieDesabonne(
  ctx: Contexte,
  abonnements: AbonnementResume[],
  parClient: Map<string, Rattache[]>,
) {
  const s = ctx.s.desabonnes
  let lignes: { abonnement_id: string; telegram_id: bigint; membre_id: string | null }[]
  try {
    lignes = await prisma.$queryRaw`
      select distinct on (g.abonnement_id, g.telegram_id) g.abonnement_id, g.telegram_id, g.membre_id::text as membre_id
      from public.cockpit_liveclub_gestes g
      where g.geste = 'retrait' and g.regle = 'desabonne' and g.resultat = 'fait'
        and g.abonnement_id is not null and g.telegram_id is not null
        and g.fait_le > now() - interval '7 days'
        and not exists (
          select 1 from public.cockpit_liveclub_gestes m
          where m.geste = 'rappel' and m.regle = 'sortie_desabonne' and m.resultat = 'fait'
            and m.abonnement_id = g.abonnement_id and m.telegram_id = g.telegram_id)
      order by g.abonnement_id, g.telegram_id, g.fait_le desc
      limit 100`
  } catch (err) {
    erreur(ctx, 'journal_illisible', err)
    return
  }
  const parId = new Map(abonnements.map(a => [a.id, a]))
  for (const l of lignes) {
    if (tempsEcoule(ctx)) return
    const telegramId = Number(l.telegram_id)
    const a = parId.get(l.abonnement_id)
    if (!a || !Number.isSafeInteger(telegramId)) continue
    const p = await presence(telegramId)
    if (p.etat !== 'non') continue
    const r = (a.clientStripe ? parClient.get(a.clientStripe) ?? [] : []).find(x => x.telegramId === telegramId)
      ?? { telegramId, clientStripe: a.clientStripe, compte: null, email: null, membreId: l.membre_id }
    if (await messageSortieDesabonne(ctx, a, r)) s.messages++
    else s.echecs++
  }
}

// ---------------------------------------------------------------------------
// (e) Rappel J-3 avant chaque prelevement
// ---------------------------------------------------------------------------

/**
 * Apercu de la prochaine facture (POST /v1/invoices/create_preview : rien
 * n'est cree chez Stripe), pour le montant reel apres remise, taxe et solde.
 * null sur une panne ou une cle sans ce droit : le rappel ne donne alors que
 * la date (montantAAnnoncer). Meme appel que l'outil mes_montants du bot
 * (apercuProchaineFacture de stripe.ts).
 */
async function apercuProchaineFacture(ctx: Contexte, abonnementId: string): Promise<Record<string, unknown> | null> {
  if (!cleStripeLecture()) return null
  try {
    return await apercuStripe(abonnementId)
  } catch (err) {
    if (ctx.s.prelevements.apercus_illisibles === 0) {
      console.warn(`[liveclub/passage] apercu de facture illisible : ${messageErreur(err)}`)
    }
    ctx.s.prelevements.apercus_illisibles++
    return null
  }
}

async function tachePrelevements(ctx: Contexte, abonnements: AbonnementResume[], parClient: Map<string, Rattache[]>) {
  const s = ctx.s.prelevements
  // Les rappels deja partis (une fois par echeance). Journal illisible = on
  // ne rappelle personne aujourd'hui.
  let dejaFaits: Set<string>
  try {
    const lignes = await prisma.$queryRaw<{ abonnement_id: string | null; echeance: string | null }[]>`
      select abonnement_id, details->>'echeance' as echeance
      from public.cockpit_liveclub_gestes
      where geste = 'rappel' and regle = 'prelevement_j3' and resultat = 'fait'
        and fait_le > now() - interval '15 days'`
    dejaFaits = new Set(lignes
      .filter((l): l is { abonnement_id: string; echeance: string } => Boolean(l.abonnement_id && l.echeance))
      .map(l => clePrelevement(l.abonnement_id, l.echeance)))
  } catch (err) {
    erreur(ctx, 'journal_illisible', err)
    return
  }

  for (const a of abonnements) {
    if (tempsEcoule(ctx)) return
    const echeance = prelevementAPrevenir(a, ctx.maintenant, dejaFaits)
    if (!echeance) continue

    const montant = montantAAnnoncer(await apercuProchaineFacture(ctx, a.id))
    // Rien a prelever (coupon a 100 %, solde crediteur) : pas de rappel.
    if (montant && montant.centimes === 0) { s.ignores++; continue }
    // Le jour annonce est celui de Paris ; la cle reste sur le jour UTC.
    const jour = a.finPeriode ? jourParis(a.finPeriode) : echeance

    let reserve: bigint | null
    try {
      reserve = await reserverGeste({
        cle: `liveclub:prelevement_j3:${a.id}:${echeance}`,
        deja: Prisma.sql`
          select 1 from public.cockpit_liveclub_gestes d
          where d.geste = 'rappel' and d.regle = 'prelevement_j3' and d.resultat = 'fait'
            and d.abonnement_id = ${a.id} and d.details->>'echeance' = ${echeance}`,
        geste: 'rappel', regle: 'prelevement_j3',
        telegramId: null, membreId: null, abonnementId: a.id,
        details: { echeance, jour_annonce: jour, montant_centimes: montant?.centimes ?? null, devise: montant?.devise ?? null },
      })
    } catch (err) {
      erreur(ctx, 'journal_reservation', err)
      s.inconnus++
      continue
    }
    if (reserve === null) { s.deja_faits++; continue }
    dejaFaits.add(clePrelevement(a.id, echeance))

    const rattaches = a.clientStripe ? parClient.get(a.clientStripe) ?? [] : []
    const email = rattaches.find(r => r.email)?.email ?? await emailClient(ctx, a.clientStripe)
    const envoi = await prevenir(ctx, rattaches.map(r => r.telegramId), email,
      modeleRappelPrelevement(jour, montant), e => emailRappelPrelevement(e, jour, montant))
    await cloreReservation(ctx, reserve, envoi)
    if (!envoi) { s.echecs++; continue }
    s.rappels_j3++
    if (!montant) s.montants_inconnus++
  }
}

// ---------------------------------------------------------------------------
// (f) Sorties abusives de Metricgram (transition, jusqu'a la bascule)
// ---------------------------------------------------------------------------

/** Les sorties par Metricgram regardees : 30 derniers jours. */
const FENETRE_SORTIES_METRICGRAM_JOURS = 30
/**
 * Un lien de retour automatique deja envoye a ce compte depuis moins de 30
 * jours : Metricgram l'a ressorti, il le ressortira encore. Pas de second lien
 * (retour 'rebanni_metricgram'), a corriger dans Metricgram.
 */
const FENETRE_REBANNI_JOURS = 30
/** Exemptions qui tiennent a un role (poses a la creation de la table, le 29/09) : elles couvrent toute sortie. */
const EXEMPTIONS_DE_ROLE = new Set(['fondateur', 'admin', 'equipe'])

type SortieMetricgram = { telegram_id: bigint; sorti_le: Date; par_qui: string | null }

type LigneSignalee = {
  geste_id: bigint
  telegram_id: bigint | null
  sorti_le: string | null
  retour: string | null
  essais: string | null
  fait_le: Date
}

type Couverture = 'oui' | 'non' | 'inconnu'

/**
 * Le droit d'AUJOURD'HUI existait-il le jour de la sortie ? Debut du droit
 * lu selon sa raison : start_date de l'abonnement (liste du passage, sinon
 * Stripe en direct), debut de l'acces broker, pose de l'acces manuel ou de
 * l'exemption (une exemption de role couvre toujours). Toute panne ou date
 * manquante = 'inconnu'. Un acces manuel prolonge apres la sortie peut avoir
 * une pose recente : il n'est alors pas signale (prudent, pas de faux positif).
 */
async function couvertureDuDroit(
  ctx: Contexte,
  telegramId: number,
  d: Droit,
  sortiLe: Date,
  parId: Map<string, AbonnementResume>,
): Promise<{ couverture: Couverture; debut: string | null }> {
  try {
    let debut: string | null = null
    if (d.raison === 'exemption') {
      const lignes = await prisma.$queryRaw<{ motif: string; pose_le: Date }[]>`
        select motif, pose_le from public.cockpit_liveclub_exemptions
        where telegram_id = ${telegramId}::bigint and retire_le is null
          and (jusquau is null or jusquau >= current_date)
        order by pose_le
        limit 1`
      if (!lignes[0]) return { couverture: 'inconnu', debut: null }
      if (EXEMPTIONS_DE_ROLE.has(lignes[0].motif)) return { couverture: 'oui', debut: null }
      debut = lignes[0].pose_le.toISOString()
    } else if (d.raison === 'abonnement' && d.abonnementId) {
      const a = parId.get(d.abonnementId) ?? await lireAbonnement(d.abonnementId)
      debut = a?.debutLe ?? null
    } else if (d.raison === 'acces_broker' && d.accesId) {
      const lignes = await prisma.$queryRaw<{ debut: string }[]>`
        select to_char(debut, 'YYYY-MM-DD') as debut from public.cockpit_liveclub_acces
        where acces_id = ${d.accesId}::uuid`
      debut = lignes[0]?.debut ?? null
    } else if (d.raison === 'acces_manuel' && d.membreId) {
      const lignes = await prisma.$queryRaw<{ pose_le: Date }[]>`
        select pose_le from public.cockpit_acces_manuel where membre_id = ${d.membreId}::uuid`
      debut = lignes[0]?.pose_le ? lignes[0].pose_le.toISOString() : null
    }
    return { couverture: droitCouvraitLaSortie(debut, sortiLe), debut }
  } catch (err) {
    erreur(ctx, 'debut_du_droit_illisible', err)
    return { couverture: 'inconnu', debut: null }
  }
}

/**
 * Le droit du compte (droitLiveClub, puis les abonnements portes par les
 * emails connus du payeur, comme avant une sortie) et s'il couvrait la sortie.
 */
async function droitALaSortie(
  ctx: Contexte,
  telegramId: number,
  siens: Rattache[],
  sortiLe: Date,
  parId: Map<string, AbonnementResume>,
): Promise<{ droit: 'oui' | 'non' | 'inconnu'; couverture: Couverture; d: Droit; raison: string | null; debut: string | null; abonnementId: string | null }> {
  const d = await droitLiveClub(telegramId)
  const base = { d, abonnementId: d.abonnementId ?? null }
  if (d.statut === 'inconnu') return { ...base, droit: 'inconnu', couverture: 'inconnu', raison: null, debut: null }
  if (d.statut === 'oui') {
    const c = await couvertureDuDroit(ctx, telegramId, d, sortiLe, parId)
    return { ...base, droit: 'oui', couverture: c.couverture, raison: d.raison, debut: c.debut }
  }
  const emails: (string | null)[] = siens.map(r => r.email)
  for (const r of siens) emails.push(await emailClient(ctx, r.clientStripe))
  const propres = [...new Set(emails.map(e => normaliserEmail(e)).filter((e): e is string => Boolean(e)))]
  const ouverts: AbonnementResume[] = []
  for (const email of propres) {
    try {
      ouverts.push(...(await abonnementsLiveClubParEmail(email)).filter(abonnementOuvreLeGroupe))
    } catch {
      return { ...base, droit: 'inconnu', couverture: 'inconnu', raison: null, debut: null }
    }
  }
  if (ouverts.length === 0) return { ...base, droit: 'non', couverture: 'inconnu', raison: null, debut: null }
  // Un seul abonnement deja la le jour de la sortie suffit ; une date
  // illisible sans autre preuve = inconnu.
  const couvrant = ouverts.find(a => droitCouvraitLaSortie(a.debutLe, sortiLe) === 'oui')
  const couverture: Couverture = couvrant
    ? 'oui'
    : ouverts.some(a => droitCouvraitLaSortie(a.debutLe, sortiLe) === 'inconnu') ? 'inconnu' : 'non'
  const retenu = couvrant ?? ouverts[0]
  return {
    ...base, droit: 'oui', couverture, raison: 'abonnement_par_email',
    debut: retenu.debutLe, abonnementId: retenu.id,
  }
}

/**
 * Lien de retour AUTOMATIQUE apres une sortie abusive, seulement si le membre
 * a deja parle au bot (une ligne dans cockpit_liveclub_conversations) et si
 * droitLiveClub dit 'oui' (c'est lui qui approuvera la demande d'adhesion).
 * Dans l'ordre : levee du ban (only_if_banned, sans effet sur un non banni),
 * lien de DEMANDE d'adhesion (le bot approuve a l'arrivee), message prive.
 * Rend l'issue en code court, pour le journal. Le lien ne va nulle part
 * ailleurs que dans le message.
 */
async function lienRetourAutomatique(ctx: Contexte, telegramId: number, droitBot: boolean): Promise<string> {
  if (!droitBot) return 'droit_vu_par_email_seul'
  try {
    const lignes = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from public.cockpit_liveclub_conversations where telegram_id = ${telegramId}::bigint limit 1`
    if (lignes.length === 0) return 'bot_jamais_demarre'
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'conversations_table_absente' : 'conversations_illisibles', err)
    return 'conversations_illisibles'
  }
  const c = chatId()
  if (!c) return 'config'
  const leve = await appelTelegram('unbanChatMember', { chat_id: c, user_id: telegramId, only_if_banned: true })
  if (!leve.ok) return 'echec_levee_ban'
  let lien: string
  try {
    lien = await lienDemandeAdhesion(`retour u${telegramId}`)
  } catch {
    return 'echec_lien'
  }
  const m = modeleRetourSortieAbusive(lien)
  const texte = m.paragraphes.join('\n\n')
  const boutons = m.bouton ? [[{ texte: m.bouton.texte, url: m.bouton.url }]] : undefined
  const envoi = await envoyer(telegramId, texte, boutons)
  if (envoi.ok) {
    // Au fil Support : le libelle du bouton, jamais le lien d'invitation.
    await tracerMessageBot(telegramId, texte, { boutons })
    return 'envoye'
  }
  return envoi.code === 403 ? 'bot_bloque' : 'echec_envoi'
}

async function tacheSortiesMetricgram(ctx: Contexte, rattaches: Rattache[], abonnements: AbonnementResume[] | null) {
  const s = ctx.s.metricgram
  let sorties: SortieMetricgram[]
  let signalees: LigneSignalee[]
  try {
    sorties = await prisma.$queryRaw<SortieMetricgram[]>`
      select telegram_id, sorti_le, par_qui
      from public.cockpit_telegram_membres
      where present = false and sorti_le is not null
        and par_qui ilike '%metric%'
        and sorti_le > now() - make_interval(days => ${FENETRE_SORTIES_METRICGRAM_JOURS}::int)
      order by sorti_le desc
      limit 200`
    signalees = await prisma.$queryRaw<LigneSignalee[]>`
      select geste_id, telegram_id, details->>'sorti_le' as sorti_le,
             details->>'retour' as retour, details->>'essais_retour' as essais, fait_le
      from public.cockpit_liveclub_gestes
      where geste = 'refus' and regle = 'sortie_abusive_metricgram'
        and resultat in ('fait', 'echec')
        and fait_le > now() - make_interval(days => ${FENETRE_SORTIES_METRICGRAM_JOURS + 30}::int)`
  } catch (err) {
    erreur(ctx, 'sorties_metricgram_illisibles', err)
    return
  }
  const dejaSignales = new Set(signalees
    .filter(l => l.telegram_id != null && Boolean(l.sorti_le))
    .map(l => cleSortieAbusive(Number(l.telegram_id), l.sorti_le as string)))
  // Comptes qui ont deja recu un lien automatique (30 jours) : un nouveau ban
  // Metricgram ne leur vaut pas un second lien.
  const limiteRebanni = ctx.maintenant.getTime() - FENETRE_REBANNI_JOURS * 86_400_000
  const dejaRelances = new Set(signalees
    .filter(l => l.telegram_id != null && l.retour === 'envoye' && l.fait_le.getTime() > limiteRebanni)
    .map(l => Number(l.telegram_id)))
  // Un lien de reouverture apres impaye (30/09) envoye depuis moins de 30
  // jours compte aussi : Metricgram qui le ressort ne lui vaut pas un second lien.
  try {
    const rouverts = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select distinct telegram_id from public.cockpit_liveclub_gestes
      where geste = 'invitation' and regle = 'reouverture_impaye' and resultat = 'fait' and telegram_id is not null
        and fait_le > now() - make_interval(days => ${FENETRE_REBANNI_JOURS}::int)`
    for (const r of rouverts) dejaRelances.add(Number(r.telegram_id))
  } catch (err) {
    erreur(ctx, 'journal_illisible', err)
    return
  }

  const parId = new Map((abonnements ?? []).map(a => [a.id, a]))
  const parCompte = new Map<number, Rattache[]>()
  for (const r of rattaches) parCompte.set(r.telegramId, [...parCompte.get(r.telegramId) ?? [], r])
  /** Comptes vus dans ce passage (nouvelle sortie) : pas de relance du lien en plus. */
  const vus = new Set<number>()

  for (const l of sorties) {
    if (tempsEcoule(ctx)) return
    const telegramId = Number(l.telegram_id)
    if (!Number.isSafeInteger(telegramId)) continue
    const sortie = { telegramId, sortiLe: l.sorti_le, parQui: l.par_qui }
    const cle = cleSortieAbusive(telegramId, l.sorti_le)
    if (dejaSignales.has(cle)) { s.deja_signalees++; continue }
    vus.add(telegramId)

    // Sortie d'un membre qui ne payait plus, et qui a regle depuis (30/09) :
    // pas une sortie abusive, la reouverture (h) s'en occupe.
    if (ctx.sortiesImpayeReglees.has(cle)) { s.pour_impaye++; continue }
    const p = await presence(telegramId)
    if (p.etat === 'inconnu') { s.inconnus++; continue }
    if (p.etat === 'oui') { s.revenus++; continue }

    // Le droit d'aujourd'hui, et surtout : existait-il le jour de la sortie ?
    // Un desabonne sorti a juste titre puis reabonne n'est pas une sortie
    // abusive (rien d'ecrit, pas de message « par erreur »).
    const lu = await droitALaSortie(ctx, telegramId, parCompte.get(telegramId) ?? [], l.sorti_le, parId)
    if (!sortieAbusiveASignaler(sortie, p.etat, lu.droit, lu.couverture, dejaSignales)) {
      if (lu.droit === 'inconnu' || (lu.droit === 'oui' && lu.couverture === 'inconnu')) s.inconnus++
      else if (lu.droit === 'oui') s.droit_posterieur++
      else s.sans_droit++
      continue
    }
    const d = lu.d

    const sortiLe = l.sorti_le.toISOString()
    const rebanni = dejaRelances.has(telegramId)
    let reserve: bigint | null
    try {
      reserve = await reserverGeste({
        cle: `liveclub:sortie_abusive:${cle}`,
        deja: Prisma.sql`
          select 1 from public.cockpit_liveclub_gestes d
          where d.geste = 'refus' and d.regle = 'sortie_abusive_metricgram'
            and d.resultat in ('fait', 'echec')
            and d.telegram_id = ${telegramId}::bigint and d.details->>'sorti_le' = ${sortiLe}`,
        geste: 'refus', regle: 'sortie_abusive_metricgram',
        telegramId, membreId: d.membreId ?? null, abonnementId: lu.abonnementId,
        details: {
          sorti_le: sortiLe, par_qui: l.par_qui, statut_tg: p.statut,
          raison: lu.raison,
          debut_du_droit: lu.debut ? lu.debut.slice(0, 10) : null,
          fin_du_droit: d.statut === 'oui' && d.fin ? d.fin.slice(0, 10) : null,
          ...(rebanni ? { a_corriger_dans_metricgram: true } : {}),
        },
      })
    } catch (err) {
      erreur(ctx, 'journal_reservation', err)
      s.inconnus++
      continue
    }
    if (reserve === null) { s.deja_signalees++; continue }
    dejaSignales.add(cle)
    s.signalees++
    // Signal reserve hors de journaliserGesteLiveClub : sa ligne au fil Support ici.
    await tracerGeste(telegramId, { geste: 'refus', resultat: 'fait', regle: 'sortie_abusive_metricgram' }, { membreId: d.membreId ?? null })

    // Deja relance apres un ban precedent : Metricgram le ressort a chaque
    // retour tant qu'il ne l'a pas dans sa base. Signale, sans second lien.
    const retour = rebanni ? 'rebanni_metricgram' : await lienRetourAutomatique(ctx, telegramId, d.statut === 'oui')
    await noterRetour(ctx, reserve, { retour })
    if (retour === 'envoye') {
      s.liens_envoyes++
      dejaRelances.add(telegramId)
      await tracer(ctx, {
        geste: 'invitation', resultat: 'fait', regle: 'sortie_abusive_metricgram', details: { sorti_le: sortiLe },
      }, { telegramId, membreId: d.membreId ?? null, abonnementId: lu.abonnementId })
    } else {
      s.sans_lien++
      if (rebanni) s.rebannis++
      else if (retourARetenter(retour, 0)) s.echecs++
    }
  }

  const courantes = new Map(sorties.map(x => [Number(x.telegram_id), x.sorti_le.toISOString()]))
  await retenterLiensRetour(ctx, signalees, courantes, vus, dejaRelances)
}

/** Ajoute des champs aux details d'une ligne du journal. Une panne est comptee. */
async function noterRetour(ctx: Contexte, gesteId: bigint, champs: Record<string, unknown>) {
  try {
    await prisma.$executeRaw`
      update public.cockpit_liveclub_gestes
      set details = details || ${JSON.stringify(champs)}::jsonb
      where geste_id = ${gesteId}`
  } catch (err) {
    ctx.s.journal_echecs++
    erreur(ctx, 'journal_ecriture', err)
  }
}

/**
 * Un lien de retour rate sur une panne passagere (echec_levee_ban,
 * echec_lien, echec_envoi, conversations_illisibles, config) est retente aux
 * passages suivants, au plus MAX_ESSAIS_RETOUR fois (details.essais_retour),
 * sans nouvelle ligne 'refus'. Seulement si cette sortie est toujours la
 * derniere sortie Metricgram du compte (courantes), que le compte est absent,
 * que droitLiveClub dit 'oui', et qu'aucun lien n'est deja parti vers lui.
 * La ligne est prise par une mise a jour conditionnelle (retour 'en_cours')
 * avant l'envoi : deux passages simultanes n'envoient pas deux liens.
 */
async function retenterLiensRetour(
  ctx: Contexte,
  signalees: LigneSignalee[],
  courantes: ReadonlyMap<number, string>,
  vus: ReadonlySet<number>,
  dejaRelances: Set<number>,
) {
  const s = ctx.s.metricgram
  const limite = ctx.maintenant.getTime() - FENETRE_SORTIES_METRICGRAM_JOURS * 86_400_000
  for (const l of signalees) {
    if (tempsEcoule(ctx)) return
    if (!retourARetenter(l.retour, l.essais) || l.fait_le.getTime() <= limite) continue
    const telegramId = Number(l.telegram_id)
    if (!Number.isSafeInteger(telegramId) || vus.has(telegramId) || dejaRelances.has(telegramId)) continue
    const sortiLe = l.sorti_le ? new Date(l.sorti_le) : null
    if (!sortiLe || !Number.isFinite(sortiLe.getTime()) || courantes.get(telegramId) !== sortiLe.toISOString()) continue
    const p = await presence(telegramId)
    if (p.etat !== 'non') continue
    const d = await droitLiveClub(telegramId)
    if (d.statut !== 'oui') continue

    const essais = Number(l.essais ?? 0) || 0
    let pris: { geste_id: bigint }[]
    try {
      pris = await prisma.$queryRaw<{ geste_id: bigint }[]>`
        update public.cockpit_liveclub_gestes
        set details = details || ${JSON.stringify({ retour: 'en_cours', essais_retour: essais + 1 })}::jsonb
        where geste_id = ${l.geste_id}
          and details->>'retour' = ${l.retour}
          and coalesce(details->>'essais_retour', '0') = ${String(essais)}
        returning geste_id`
    } catch (err) {
      erreur(ctx, 'journal_ecriture', err)
      continue
    }
    if (pris.length === 0) continue
    s.retours_retentes++
    const retour = await lienRetourAutomatique(ctx, telegramId, true)
    await noterRetour(ctx, l.geste_id, { retour })
    if (retour === 'envoye') {
      s.liens_envoyes++
      dejaRelances.add(telegramId)
      await tracer(ctx, {
        geste: 'invitation', resultat: 'fait', regle: 'sortie_abusive_metricgram',
        details: { sorti_le: l.sorti_le, relance: essais + 1 },
      }, { telegramId, membreId: d.membreId ?? null, abonnementId: d.abonnementId ?? null })
    } else if (retourARetenter(retour, 0)) {
      s.echecs++
    }
  }
}

// ---------------------------------------------------------------------------
// (g) Impayes : sortie 5 jours apres le premier echec (Brice, 30/09)
// ---------------------------------------------------------------------------

/** L'impaye lu d'un abonnement (null s'il n'est pas lu, illisible ou pas date). */
function impayeLu(a: AbonnementResume): (Impaye & { depuis: string }) | null {
  return a.impaye && a.impaye !== 'illisible' && a.impaye.depuis ? a.impaye as Impaye & { depuis: string } : null
}

/**
 * Sortie SANS ban d'un membre present, non exempte, non admin, sans autre
 * droit (broker, acces manuel, autre abonnement : droitAvantSortie), dont
 * l'abonnement est en retard de paiement depuis plus de 5 jours. Une fois par
 * facture (details.facture_id : la facture impayee la plus ancienne). SIMULEE
 * sans sortiesImpayesActives() : une ligne 'simule' par facture, a relire dans
 * le Journal du bot avant d'activer. Jamais sur une facture illisible ni un
 * droit 'inconnu'. Plafond de sorties du passage respecte (sortir).
 */
async function tacheImpayes(ctx: Contexte, abonnements: AbonnementResume[], parClient: Map<string, Rattache[]>) {
  const s = ctx.s.impayes
  const reel = sortiesImpayesActives()
  const maintenantMs = ctx.maintenant.getTime()
  for (const a of abonnements) {
    if (tempsEcoule(ctx)) return
    if (!enRetardDePaiement(a.statut)) continue
    const decision = decisionSortieImpaye(etatImpaye(a, maintenantMs), reel)
    if (decision === 'rien') continue
    if (decision === 'grace') { s.en_grace++; continue }
    if (decision === 'inconnu') { s.inconnus++; continue }
    const impaye = impayeLu(a)
    if (!impaye) { s.inconnus++; continue }
    const rattaches = a.clientStripe ? parClient.get(a.clientStripe) ?? [] : []
    if (rattaches.length === 0) { s.sans_compte++; continue }
    const detailFacture = impaye.factureId ? { cle: 'facture_id', valeur: impaye.factureId } : null

    for (const r of rattaches) {
      if (tempsEcoule(ctx)) return
      if (ctx.sortis.has(r.telegramId)) continue
      let deja: boolean
      try {
        deja = await gesteExiste({
          geste: 'retrait', regle: 'impaye_5j', resultats: reel ? ['fait'] : ['fait', 'simule'],
          abonnementId: a.id, telegramId: r.telegramId, detail: detailFacture,
        })
      } catch (err) {
        erreur(ctx, 'journal_illisible', err)
        s.inconnus++
        continue
      }
      if (deja) {
        s.deja_traites++
        if (reel) await rattraperMessageSortieImpaye(ctx, a, r, impaye)
        continue
      }
      const p = await presence(r.telegramId)
      if (p.etat === 'inconnu') { s.inconnus++; continue }
      if (p.etat === 'non') { s.absents++; continue }
      if (estIntouchable(p)) { s.gardes++; continue }
      const emailPayeur = await emailClient(ctx, a.clientStripe)
      // Exemption, acces broker, acces manuel, autre abonnement (meme par un
      // autre client Stripe du meme email) : on garde. Avec la regle des 5
      // jours, droitLiveClub ne compte plus cet abonnement-ci.
      const droit = await droitAvantSortie(r.telegramId, [r.email, emailPayeur])
      if (droit === 'inconnu') { s.inconnus++; continue }
      if (droit === 'oui') { s.gardes++; continue }

      const details = {
        statut: a.statut, impaye_depuis: impaye.depuis.slice(0, 10), jours: joursDepuisPremierEchec(a, maintenantMs),
        facture_id: impaye.factureId, statut_tg: p.statut,
      }
      const contexte = { telegramId: r.telegramId, membreId: r.membreId, abonnementId: a.id }
      if (decision === 'simuler') {
        await tracer(ctx, { geste: 'retrait', resultat: 'simule', regle: 'impaye_5j', details }, contexte)
        s.simules++
        continue
      }
      const issue = await sortir(ctx, r.telegramId, { geste: 'retrait', regle: 'impaye_5j', abonnementId: a.id, membreId: r.membreId, details })
      if (issue === 'plafond') continue
      if (issue !== 'fait') { s.echecs++; continue }
      s.sorties++
      if (await messageSortieImpaye(ctx, a, r, impaye)) s.messages++
    }
  }
}

/**
 * Le message de sortie pour impaye (montant, lien de la facture, tarif garde
 * dans les 30 jours ; en prive, le bouton « J'ai réglé : revenir dans le
 * groupe » qui redonne le lien des que c'est paye, 22/10), une fois par
 * abonnement, compte et facture, reserve avant l'envoi. En prive s'il a
 * demarre le bot, sinon par email (lien du bot). true = parti.
 */
async function messageSortieImpaye(ctx: Contexte, a: AbonnementResume, r: Rattache, impaye: Impaye & { depuis: string }): Promise<boolean> {
  const facture = impaye.factureId
  let reserve: bigint | null
  try {
    reserve = await reserverGeste({
      cle: `liveclub:sortie_impaye:${a.id}:${r.telegramId}:${facture ?? ''}`,
      deja: Prisma.sql`
        select 1 from public.cockpit_liveclub_gestes d
        where d.geste = 'rappel' and d.regle = 'sortie_impaye' and d.resultat = 'fait'
          and d.abonnement_id = ${a.id} and d.telegram_id = ${r.telegramId}::bigint
          and (${facture}::text is null or d.details->>'facture_id' = ${facture}::text)`,
      geste: 'rappel', regle: 'sortie_impaye', telegramId: r.telegramId, membreId: r.membreId,
      abonnementId: a.id, details: { facture_id: facture, impaye_depuis: impaye.depuis.slice(0, 10) },
    })
  } catch (err) {
    erreur(ctx, 'journal_reservation', err)
    return false
  }
  if (reserve === null) return false
  const limite = limiteFenetreImpaye(a) ?? impaye.depuis
  const email = r.email ?? await emailClient(ctx, a.clientStripe)
  const envoi = await prevenir(ctx, [r.telegramId], email, modeleSortieImpaye(impaye.aRegler, limite),
    e => emailSortieImpaye(e, impaye.aRegler, limite))
  await cloreReservation(ctx, reserve, envoi)
  return envoi !== null
}

/**
 * Sortie deja faite pour cette facture, message jamais parti (prive et email
 * en echec) : on le retente, si le membre est toujours hors du groupe. La
 * reservation garde l'unicite.
 */
async function rattraperMessageSortieImpaye(ctx: Contexte, a: AbonnementResume, r: Rattache, impaye: Impaye & { depuis: string }) {
  let envoye: boolean
  try {
    envoye = await gesteExiste({
      geste: 'rappel', regle: 'sortie_impaye', resultats: ['fait'], abonnementId: a.id, telegramId: r.telegramId,
      detail: impaye.factureId ? { cle: 'facture_id', valeur: impaye.factureId } : null,
    })
  } catch (err) {
    erreur(ctx, 'journal_illisible', err)
    return
  }
  if (envoye) return
  if ((await presence(r.telegramId)).etat !== 'non') return
  if (await messageSortieImpaye(ctx, a, r, impaye)) ctx.s.impayes.messages++
  else ctx.s.impayes.echecs++
}

// ---------------------------------------------------------------------------
// (h) Reouverture apres une sortie pour impaye (Brice, 30/09)
// ---------------------------------------------------------------------------

/** Sorties regardees : 45 derniers jours (le membre a 30 jours pour payer apres le premier echec). */
const FENETRE_REOUVERTURE_JOURS = 45

type SortieARouvrir = { telegram_id: bigint; sorti_le: Date; par: string }

/**
 * Le membre sorti pour impaye (par notre bot : retrait 'impaye_5j' ; ou par
 * Metricgram) dont la facture de la sortie est reglee depuis
 * (factureRegleeApresSortie : payee apres la sortie, due avant), et qui est
 * absent du groupe : ban leve (only_if_banned, sans effet sur un non banni),
 * puis « Ton paiement est passe, ton acces au Live Club est reouvert » avec
 * un lien de demande d'adhesion en prive s'il a demarre le bot, sinon le lien
 * personnel vers le bot par email. droitLiveClub doit dire 'oui' (c'est lui
 * qui approuvera la demande). Une fois par reouverture : une ligne
 * 'invitation' 'reouverture_impaye' ('fait', ou 'refuse' s'il est deja
 * revenu) posterieure a la sortie ferme la boucle. REELLE meme avant la
 * bascule. Seule la sortie la plus recente d'un compte est regardee.
 */
async function tacheReouvertures(ctx: Contexte, abonnements: AbonnementResume[], parClient: Map<string, Rattache[]>) {
  const s = ctx.s.reouvertures
  let sorties: SortieARouvrir[]
  let faites: { telegram_id: bigint; fait_le: Date }[]
  try {
    sorties = await prisma.$queryRaw<SortieARouvrir[]>`
      select telegram_id, sorti_le, par from (
        select telegram_id, fait_le as sorti_le, 'bot' as par
        from public.cockpit_liveclub_gestes
        where geste = 'retrait' and regle = 'impaye_5j' and resultat = 'fait' and telegram_id is not null
          and fait_le > now() - make_interval(days => ${FENETRE_REOUVERTURE_JOURS}::int)
        union all
        select telegram_id, sorti_le, 'metricgram' as par
        from public.cockpit_telegram_membres
        where present = false and sorti_le is not null and par_qui ilike '%metric%'
          and sorti_le > now() - make_interval(days => ${FENETRE_REOUVERTURE_JOURS}::int)
      ) as sorties
      order by sorti_le desc
      limit 300`
    // Une boucle se ferme aussi par un lien de retour « sorti par erreur »
    // deja envoye apres cette sortie (tache Metricgram) : pas deux liens.
    faites = await prisma.$queryRaw<{ telegram_id: bigint; fait_le: Date }[]>`
      select telegram_id, max(fait_le) as fait_le
      from public.cockpit_liveclub_gestes
      where geste = 'invitation' and telegram_id is not null
        and ((regle = 'reouverture_impaye' and resultat in ('fait', 'refuse'))
          or (regle = 'sortie_abusive_metricgram' and resultat = 'fait'))
        and fait_le > now() - make_interval(days => ${FENETRE_REOUVERTURE_JOURS + 30}::int)
      group by telegram_id`
  } catch (err) {
    erreur(ctx, 'reouvertures_illisibles', err)
    return
  }
  const derniereReouverture = new Map(faites.map(f => [Number(f.telegram_id), f.fait_le.getTime()]))

  // Compte Telegram -> ses abonnements actifs (index inverse de parClient), et son email connu.
  const actifsParCompte = new Map<number, AbonnementResume[]>()
  const emailParCompte = new Map<number, string>()
  for (const a of abonnements) {
    if ((a.statut !== 'active' && a.statut !== 'trialing') || a.pauseActive || !a.clientStripe) continue
    for (const r of parClient.get(a.clientStripe) ?? []) {
      actifsParCompte.set(r.telegramId, [...actifsParCompte.get(r.telegramId) ?? [], a])
      if (r.email && !emailParCompte.has(r.telegramId)) emailParCompte.set(r.telegramId, r.email)
    }
  }

  const vus = new Set<number>()
  for (const l of sorties) {
    if (tempsEcoule(ctx)) return
    const telegramId = Number(l.telegram_id)
    if (!Number.isSafeInteger(telegramId) || vus.has(telegramId)) continue
    vus.add(telegramId)
    const actifs = actifsParCompte.get(telegramId)
    if (!actifs?.length) continue
    if ((derniereReouverture.get(telegramId) ?? 0) >= l.sorti_le.getTime()) { s.deja_faits++; continue }

    // La facture impayee au moment de la sortie est-elle reglee depuis ?
    let abo: AbonnementResume | null = null
    let illisible = false
    for (const a of actifs) {
      try {
        if (factureRegleeApresSortie(await facturesPayeesAbonnement(a.id), l.sorti_le)) { abo = a; break }
      } catch (err) {
        erreur(ctx, 'factures_payees_illisibles', err)
        illisible = true
      }
    }
    if (!abo) { if (illisible) s.inconnus++; continue }
    const sortiLe = l.sorti_le.toISOString()
    ctx.sortiesImpayeReglees.add(cleSortieAbusive(telegramId, l.sorti_le))

    const p = await presence(telegramId)
    const droit: Droit | null = p.etat === 'non' ? await droitLiveClub(telegramId) : null
    const decision = decisionReouverture(true, p.etat, droit?.statut ?? 'inconnu', false)
    const contexte = { telegramId, membreId: droit?.membreId ?? null, abonnementId: abo.id }
    const details = { sorti_le: sortiLe, sortie_par: l.par }
    if (decision === 'inconnu') { s.inconnus++; continue }
    if (decision === 'sans_droit') { s.sans_droit++; continue }
    if (decision === 'deja_revenu') {
      // Revenu par un autre chemin : la boucle se ferme, sans message.
      await tracer(ctx, { geste: 'invitation', resultat: 'refuse', regle: 'reouverture_impaye', details: { ...details, motif: 'deja_dans_le_groupe' } }, contexte)
      s.deja_revenus++
      continue
    }
    if (decision !== 'envoyer') continue

    let reserve: bigint | null
    try {
      reserve = await reserverGeste({
        cle: `liveclub:reouverture:${telegramId}:${sortiLe}`,
        deja: Prisma.sql`
          select 1 from public.cockpit_liveclub_gestes r
          where r.geste = 'invitation' and r.telegram_id = ${telegramId}::bigint and r.fait_le >= ${l.sorti_le}
            and ((r.regle = 'reouverture_impaye' and r.resultat in ('fait', 'refuse'))
              or (r.regle = 'sortie_abusive_metricgram' and r.resultat = 'fait'))`,
        geste: 'invitation', regle: 'reouverture_impaye', telegramId, membreId: contexte.membreId,
        abonnementId: abo.id, details,
      })
    } catch (err) {
      erreur(ctx, 'journal_reservation', err)
      s.inconnus++
      continue
    }
    if (reserve === null) { s.deja_faits++; continue }
    const email = emailParCompte.get(telegramId) ?? await emailClient(ctx, abo.clientStripe)
    const envoi = await envoyerReouverture(ctx, telegramId, abo, email)
    await cloreReservation(ctx, reserve, envoi)
    if (!envoi) { s.echecs++; continue }
    if (envoi.canal === 'prive') s.liens_prives++
    else s.emails++
  }
}

/**
 * Ban leve d'abord (regle 3 de la roadmap), puis le message : en PRIVE avec
 * un lien de demande d'adhesion si le membre a deja parle au bot (le bot
 * approuvera la demande sur droitLiveClub), sinon (ou si le prive echoue) par
 * EMAIL avec le lien personnel vers le bot (jeton 'retour' de l'abonnement :
 * le bot redonne le lien du groupe). Jamais un lien d'invitation dans un
 * email. null = rien n'est parti.
 */
async function envoyerReouverture(
  ctx: Contexte,
  telegramId: number,
  a: AbonnementResume,
  email: string | null,
): Promise<{ canal: 'prive' | 'email'; telegramId: number | null } | null> {
  const c = chatId()
  if (!c) { erreur(ctx, 'chat_id_absent'); return null }
  const leve = await appelTelegram('unbanChatMember', { chat_id: c, user_id: telegramId, only_if_banned: true })
  if (!leve.ok) { erreur(ctx, 'reouverture_levee_ban', leve.erreur); return null }

  let demarre = false
  try {
    const lignes = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from public.cockpit_liveclub_conversations where telegram_id = ${telegramId}::bigint limit 1`
    demarre = lignes.length > 0
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'conversations_table_absente' : 'conversations_illisibles', err)
  }
  if (demarre) {
    try {
      const m = modeleReouverture(await lienDemandeAdhesion(`reouverture u${telegramId}`), 'prive')
      const texte = m.paragraphes.join('\n\n')
      const boutons = m.bouton ? [[{ texte: m.bouton.texte, url: m.bouton.url }]] : undefined
      const r = await envoyer(telegramId, texte, boutons)
      if (r.ok) {
        // Au fil Support : le texte et le libelle du bouton, jamais le lien.
        await tracerMessageBot(telegramId, texte, { boutons })
        return { canal: 'prive', telegramId }
      }
    } catch (err) {
      erreur(ctx, 'reouverture_lien', err)
    }
  }
  if (email) {
    try {
      const jeton = await jetonExistant({ abonnementId: a.id, usage: 'retour' })
        ?? await creerJeton({ usage: 'retour', clientStripe: a.clientStripe, abonnementId: a.id })
      const r = await emailReouverture(email, lienBot(jeton))
      if (r.ok) return { canal: 'email', telegramId: null }
    } catch (err) {
      erreur(ctx, 'jetons_indisponibles', err)
    }
  }
  ctx.s.messages_perdus++
  return null
}

// ---------------------------------------------------------------------------
// (i) Fenetre de retour de 30 jours (Brice, 30/09)
// ---------------------------------------------------------------------------

/**
 * Un abonnement past_due ou unpaid dont le premier echec date de plus de 30
 * jours : resilie (sans prorata ni remboursement), puis ses factures ouvertes
 * annulees (fermerFenetreImpaye, stripe.ts), avec la cle d'ecriture. Une fois
 * par abonnement (ligne 'arret' 'fenetre_30j' reservee avant l'appel). Une
 * cle sans le droit, une panne : la ligne passe en 'echec' (etape, message de
 * Stripe), rien d'autre ne bouge, le passage suivant reessaie. SIMULEE sans
 * la bascule (sortiesActives). Au plus PLAFOND_RESILIATIONS_PASSAGE par
 * passage. Puis, en reel : les factures restees ouvertes sont retentees, et
 * le message de fin part (une fois, sauf autre droit ouvert).
 */
async function tacheFenetre(ctx: Contexte, abonnements: AbonnementResume[], parClient: Map<string, Rattache[]>) {
  const s = ctx.s.fenetre_30j
  const reel = sortiesActives()
  const maintenantMs = ctx.maintenant.getTime()
  let tentatives = 0
  for (const a of abonnements) {
    if (tempsEcoule(ctx)) return
    if (!enRetardDePaiement(a.statut)) continue
    const etat = etatImpaye(a, maintenantMs)
    let deja = false
    if (etat === 'fenetre_depassee') {
      try {
        deja = await gesteExiste({ geste: 'arret', regle: 'fenetre_30j', resultats: reel ? ['fait'] : ['fait', 'simule'], abonnementId: a.id })
      } catch (err) {
        erreur(ctx, 'journal_illisible', err)
        s.inconnus++
        continue
      }
    }
    const decision = decisionFenetre(etat, reel, deja)
    // 'inconnu' (factures illisibles) est deja compte par la tache des impayes.
    if (decision === 'rien' || decision === 'inconnu') continue
    if (decision === 'deja_fait') { s.deja_faits++; continue }
    const impaye = impayeLu(a)
    if (!impaye) continue
    const rattaches = a.clientStripe ? parClient.get(a.clientStripe) ?? [] : []
    const details = {
      statut: a.statut, impaye_depuis: impaye.depuis.slice(0, 10), jours: joursDepuisPremierEchec(a, maintenantMs),
      factures_ouvertes: impaye.facturesOuvertes.length,
    }
    const contexte = { telegramId: rattaches[0]?.telegramId ?? null, membreId: rattaches[0]?.membreId ?? null, abonnementId: a.id }
    if (decision === 'simuler') {
      await tracer(ctx, { geste: 'arret', resultat: 'simule', regle: 'fenetre_30j', details }, contexte)
      s.simulees++
      continue
    }
    if (tentatives >= PLAFOND_RESILIATIONS_PASSAGE) {
      if (s.reportees === 0) console.warn(`[liveclub/passage] plafond de ${PLAFOND_RESILIATIONS_PASSAGE} resiliations atteint : le reste passera demain.`)
      s.reportees++
      continue
    }

    let reserve: bigint | null
    try {
      reserve = await reserverGeste({
        cle: `liveclub:fenetre_30j:${a.id}`,
        deja: Prisma.sql`
          select 1 from public.cockpit_liveclub_gestes d
          where d.geste = 'arret' and d.regle = 'fenetre_30j' and d.resultat = 'fait' and d.abonnement_id = ${a.id}`,
        geste: 'arret', regle: 'fenetre_30j', telegramId: contexte.telegramId, membreId: contexte.membreId,
        abonnementId: a.id, details,
      })
    } catch (err) {
      erreur(ctx, 'journal_reservation', err)
      s.inconnus++
      continue
    }
    if (reserve === null) { s.deja_faits++; continue }
    tentatives++

    let issue: Awaited<ReturnType<typeof fermerFenetreImpaye>>
    try {
      issue = await fermerFenetreImpaye(a.id, maintenantMs)
    } catch (err) {
      // Cle d'ecriture absente ou sans le droit, Stripe en panne : rien n'a change.
      erreur(ctx, 'fenetre_30j_stripe', err)
      await noterGeste(ctx, reserve, { resultat: 'echec', details: { etape: 'resiliation', erreur: messageErreur(err) } })
      s.echecs++
      continue
    }
    if (!issue.resilie) {
      await noterGeste(ctx, reserve, { resultat: 'refuse', details: { motif: issue.motif } })
      s.plus_a_resilier++
      continue
    }
    s.resiliations++
    s.factures_annulees += issue.facturesAnnulees
    if (issue.facturesEnEchec) {
      s.factures_en_echec += issue.facturesEnEchec
      erreur(ctx, 'fenetre_30j_facture')
    }
    await noterGeste(ctx, reserve, {
      resultat: 'fait',
      details: {
        factures_annulees: issue.facturesAnnulees, factures_non_annulees: issue.facturesEnEchec,
        ...(issue.erreurFacture ? { erreur_facture: issue.erreurFacture } : {}),
      },
    })
  }
  if (reel) {
    await rattraperFacturesFenetre(ctx)
    await messagesFinFenetre(ctx, abonnements, parClient)
  }
}

/**
 * Resiliation faite, mais une facture est restee ouverte (annulation refusee
 * ou en panne) : on la retente, 30 jours au plus. La ligne 'fait' est mise a
 * jour (sans nouvelle ligne au fil Support).
 */
async function rattraperFacturesFenetre(ctx: Contexte) {
  const s = ctx.s.fenetre_30j
  let lignes: { geste_id: bigint; abonnement_id: string; annulees: string | null }[]
  try {
    lignes = await prisma.$queryRaw`
      select geste_id, abonnement_id, details->>'factures_annulees' as annulees
      from public.cockpit_liveclub_gestes
      where geste = 'arret' and regle = 'fenetre_30j' and resultat = 'fait' and abonnement_id is not null
        and coalesce(details->>'factures_non_annulees', '0') <> '0'
        and fait_le > now() - interval '30 days'
      limit 50`
  } catch (err) {
    erreur(ctx, 'journal_illisible', err)
    return
  }
  for (const l of lignes) {
    if (tempsEcoule(ctx)) return
    const r = await annulerFacturesOuvertes(l.abonnement_id)
    s.factures_annulees += r.annulees
    if (r.enEchec) {
      s.factures_en_echec += r.enEchec
      erreur(ctx, 'fenetre_30j_facture')
    }
    await noterGeste(ctx, l.geste_id, {
      resultat: 'fait', fil: false,
      details: { factures_annulees: (Number(l.annulees ?? 0) || 0) + r.annulees, factures_non_annulees: r.enEchec },
    })
  }
}

/**
 * Le message de fin apres une resiliation de la fenetre de 30 jours : son
 * acces a pris fin, il peut revenir en se reabonnant (les deux portes). Une
 * fois par abonnement, 7 jours de rattrapage apres un envoi rate. Pas de
 * message si un autre droit lui ouvre encore le groupe (autre abonnement,
 * exemption, acces) : une ligne 'refuse' ferme la boucle. Droit inconnu : on
 * reessaie au passage suivant.
 */
async function messagesFinFenetre(ctx: Contexte, abonnements: AbonnementResume[], parClient: Map<string, Rattache[]>) {
  const s = ctx.s.fenetre_30j
  let lignes: { abonnement_id: string; non_annulees: string | null }[]
  try {
    lignes = await prisma.$queryRaw`
      select distinct on (g.abonnement_id) g.abonnement_id, g.details->>'factures_non_annulees' as non_annulees
      from public.cockpit_liveclub_gestes g
      where g.geste = 'arret' and g.regle = 'fenetre_30j' and g.resultat = 'fait' and g.abonnement_id is not null
        and g.fait_le > now() - interval '7 days'
        and not exists (
          select 1 from public.cockpit_liveclub_gestes m
          where m.geste = 'rappel' and m.regle = 'fin_fenetre_30j' and m.resultat in ('fait', 'refuse')
            and m.abonnement_id = g.abonnement_id)
      order by g.abonnement_id, g.fait_le desc
      limit 100`
  } catch (err) {
    erreur(ctx, 'journal_illisible', err)
    return
  }
  const parId = new Map(abonnements.map(a => [a.id, a]))
  for (const l of lignes) {
    if (tempsEcoule(ctx)) return
    const cus = parId.get(l.abonnement_id)?.clientStripe ?? null
    const rattaches = cus ? parClient.get(cus) ?? [] : []
    const emailPayeur = await emailClient(ctx, cus)
    let droit: 'oui' | 'non' | 'inconnu' = 'non'
    if (rattaches.length) {
      for (const r of rattaches) {
        const d = await droitAvantSortie(r.telegramId, [r.email, emailPayeur])
        if (d === 'oui') { droit = 'oui'; break }
        if (d === 'inconnu') droit = 'inconnu'
      }
    } else if (emailPayeur) {
      try {
        if ((await abonnementsLiveClubParEmail(emailPayeur)).some(abonnementOuvreLeGroupe)) droit = 'oui'
      } catch {
        droit = 'inconnu'
      }
    }
    if (droit === 'inconnu') { s.inconnus++; continue }
    const contexte = { telegramId: rattaches[0]?.telegramId ?? null, membreId: rattaches[0]?.membreId ?? null, abonnementId: l.abonnement_id }
    if (droit === 'oui') {
      await tracer(ctx, { geste: 'rappel', resultat: 'refuse', regle: 'fin_fenetre_30j', details: { motif: 'autre_droit' } }, contexte)
      continue
    }
    let reserve: bigint | null
    try {
      reserve = await reserverGeste({
        cle: `liveclub:fin_fenetre_30j:${l.abonnement_id}`,
        deja: Prisma.sql`
          select 1 from public.cockpit_liveclub_gestes d
          where d.geste = 'rappel' and d.regle = 'fin_fenetre_30j' and d.resultat in ('fait', 'refuse')
            and d.abonnement_id = ${l.abonnement_id}`,
        geste: 'rappel', regle: 'fin_fenetre_30j', telegramId: contexte.telegramId, membreId: contexte.membreId,
        abonnementId: l.abonnement_id, details: {},
      })
    } catch (err) {
      erreur(ctx, 'journal_reservation', err)
      continue
    }
    if (reserve === null) continue
    const annulee = (Number(l.non_annulees ?? 0) || 0) === 0
    const email = rattaches.find(r => r.email)?.email ?? emailPayeur
    const envoi = await prevenir(ctx, rattaches.map(r => r.telegramId), email, modeleFinFenetre(annulee), e => emailFinFenetre(e, annulee))
    await cloreReservation(ctx, reserve, envoi)
    if (envoi) s.messages++
    else s.echecs++
  }
}

// ---------------------------------------------------------------------------
// (j) Rattrapage des emails de bienvenue (Brice, 30/09)
// ---------------------------------------------------------------------------

/**
 * Un abonnement Live Club cree depuis moins de 3 jours (hors Payment Link :
 * Dashboard, portail, page jamais chargee), actif, dont le client n'a ni
 * compte Telegram rattache ni email de bienvenue deja envoye (ni jeton deja
 * utilise) : l'email de bienvenue de la page apres paiement, avec son jeton
 * d'entree (preparerBienvenue, bienvenue.ts : meme verrou, meme reservation).
 * Une fois par abonnement. SIMULE sans la bascule : avant elle, Metricgram
 * envoie encore son propre email.
 */
async function tacheBienvenue(ctx: Contexte, abonnements: AbonnementResume[], parClient: Map<string, Rattache[]>) {
  const s = ctx.s.bienvenue
  const reel = sortiesActives()
  const candidats = abonnements.filter(a => bienvenueARattraper(a, ctx.maintenant, { rattache: false, emailDejaEnvoye: false, dejaTraite: false }))
  if (!candidats.length) return
  const ids = candidats.map(a => a.id)
  let servis: Set<string>
  let traites: Set<string>
  try {
    const jetons = await prisma.$queryRaw<{ abonnement_id: string }[]>`
      select distinct abonnement_id from public.cockpit_liveclub_jetons
      where abonnement_id = any(${ids}::text[]) and (email_envoye_le is not null or utilise_le is not null)`
    const lignes = await prisma.$queryRaw<{ abonnement_id: string }[]>`
      select distinct abonnement_id from public.cockpit_liveclub_gestes
      where geste = 'invitation' and regle = 'bienvenue_rattrapage'
        and resultat = any(${reel ? ['fait'] : ['fait', 'simule']}::text[])
        and abonnement_id = any(${ids}::text[])`
    servis = new Set(jetons.map(j => j.abonnement_id))
    traites = new Set(lignes.map(l => l.abonnement_id))
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'jetons_table_absente' : 'bienvenue_illisible', err)
    s.inconnus += candidats.length
    return
  }

  for (const a of candidats) {
    if (tempsEcoule(ctx)) return
    const rattache = (a.clientStripe ? parClient.get(a.clientStripe) ?? [] : []).length > 0
    const emailDejaEnvoye = servis.has(a.id)
    const dejaTraite = traites.has(a.id)
    if (!bienvenueARattraper(a, ctx.maintenant, { rattache, emailDejaEnvoye, dejaTraite })) {
      if (rattache) s.rattaches++
      else if (emailDejaEnvoye) s.deja_envoyes++
      else s.deja_traites++
      continue
    }
    const contexte = { telegramId: null, abonnementId: a.id }
    if (!reel) {
      await tracer(ctx, { geste: 'invitation', resultat: 'simule', regle: 'bienvenue_rattrapage', details: { cree_le: a.creeLe?.slice(0, 10) ?? null } }, contexte)
      s.simules++
      continue
    }
    const email = await emailClient(ctx, a.clientStripe)
    if (!email) { s.sans_email++; continue }
    let prep: Awaited<ReturnType<typeof preparerBienvenue>>
    try {
      prep = await preparerBienvenue(a.id, { clientStripe: a.clientStripe, email, sessionTropAncienne: false })
    } catch (err) {
      erreur(ctx, relationAbsente(err) ? 'jetons_table_absente' : 'bienvenue_jeton', err)
      s.echecs++
      continue
    }
    if (prep.issue !== 'lien' || !prep.jeton || !prep.envoyerEmail) { s.deja_envoyes++; continue }
    const envoi = await emailBienvenue(email, lienBot(prep.jeton))
    if (!envoi.ok) {
      try {
        await annulerReservationEmail(prep.jeton)
      } catch (err) {
        erreur(ctx, 'bienvenue_reservation', err)
      }
      await tracer(ctx, { geste: 'invitation', resultat: 'echec', regle: 'bienvenue_rattrapage', details: { etape: 'email' } }, contexte)
      ctx.s.messages_perdus++
      s.echecs++
      continue
    }
    await tracer(ctx, { geste: 'invitation', resultat: 'fait', regle: 'bienvenue_rattrapage', details: { jeton_nouveau: prep.nouveau, email_envoye: true } }, contexte)
    s.envoyes++
  }
}

// ---------------------------------------------------------------------------
// (k) Exemptions datees : sortie programmee (Brice, 06/10)
// ---------------------------------------------------------------------------

type LigneExemption = {
  exemption_id: string
  telegram_id: bigint
  membre_id: string | null
  motif: string
  /** 'YYYY-MM-DD' (to_char : pas de decalage de fuseau sur une colonne date). */
  jusquau: string
  /** current_date de la base, 'YYYY-MM-DD' : celui de exemptionActive. */
  aujourdhui_base: string
}

type ExemptionLue = { id: string; telegramId: number; membreId: string | null; motif: string; jusquau: string }

/** Ce qui remplace la lecture quand le journal dit deja « fait » : la decision ne la regarde pas. */
const LECTURE_INUTILE: LectureExemption = { presence: 'inconnu', intouchable: false, droit: 'inconnu' }

/**
 * Les emails connus d'un compte exempte, le plus sur d'abord : ceux du membre
 * de l'exemption (cockpit_membre_emails, le principal en tete), puis ceux du
 * rattachement du compte Telegram (son membre, son email, l'email de son
 * client Stripe du compte melanie). Le premier sert au message quand le prive
 * ne passe pas ; tous servent au droit (un abonnement pris sous l'une de ces
 * adresses garde la personne). Jette si la base ne repond pas.
 */
async function emailsExemption(ctx: Contexte, membreId: string | null, siens: Rattache[]): Promise<string[]> {
  const emails: (string | null)[] = []
  const membres = [...new Set([membreId, ...siens.map(r => r.membreId)].filter((m): m is string => Boolean(m)))]
  if (membres.length) {
    const lignes = await prisma.$queryRaw<{ email: string }[]>`
      select email from public.cockpit_membre_emails
      where membre_id::text = any(${membres}::text[])
      order by (membre_id::text = ${membreId}::text) desc nulls last, principal desc, verifie desc, vu_le desc
      limit 10`
    emails.push(...lignes.map(l => l.email))
  }
  for (const r of siens) {
    emails.push(r.email)
    if (r.compte == null || r.compte === 'melanie') emails.push(await emailClient(ctx, r.clientStripe))
  }
  return [...new Set(emails.map(e => normaliserEmail(e)).filter((e): e is string => Boolean(e)))]
}

/**
 * Le compte a-t-il deja ecrit au bot (une ligne dans
 * cockpit_liveclub_conversations) ? Un bot ne peut pas ecrire le premier.
 * null si la table ne repond pas : on tente alors le prive quand meme.
 */
async function botDemarre(ctx: Contexte, telegramId: number): Promise<boolean | null> {
  try {
    const lignes = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from public.cockpit_liveclub_conversations where telegram_id = ${telegramId}::bigint limit 1`
    return lignes.length > 0
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'conversations_table_absente' : 'conversations_illisibles', err)
    return null
  }
}

/**
 * Clot une exemption echue : retire_le = now(). retire_par reste vide (c'est
 * un uuid de compte, le passage n'en a pas) : la ligne du journal, acteur
 * cron:liveclub, dit qui a clos. false sur une panne (le passage suivant
 * reprend).
 */
async function cloreExemption(ctx: Contexte, exemptionId: string): Promise<boolean> {
  try {
    await prisma.$executeRaw`
      update public.cockpit_liveclub_exemptions set retire_le = now()
      where exemption_id = ${exemptionId}::uuid and retire_le is null`
    return true
  } catch (err) {
    erreur(ctx, 'exemptions_ecriture', err)
    return false
  }
}

/** Presence en direct, puis (seulement s'il est la et pas admin) le droit SANS cette exemption. */
async function lireCompteExempte(
  ex: ExemptionLue,
  emails: string[],
): Promise<LectureExemption & { statutTg: string | null; raison: Droit['raison'] }> {
  const p = await presence(ex.telegramId)
  const intouchable = estIntouchable(p)
  if (p.etat !== 'oui' || intouchable) return { presence: p.etat, intouchable, droit: 'inconnu', statutTg: p.statut, raison: null }
  const d = await droitAvantSortieDetaille(ex.telegramId, emails, { exemptionIgnoree: ex.id })
  return { presence: 'oui', intouchable: false, droit: d.statut, statutTg: p.statut, raison: d.raison }
}

/**
 * Prevenir un compte exempte : en prive s'il a deja demarre le bot, sinon
 * par email SEULEMENT si un email est connu ; sinon rien (on ne peut pas).
 * 'sans_moyen' = ni l'un ni l'autre, rien n'est reserve ni ecrit.
 */
async function prevenirExempte(
  ctx: Contexte,
  ex: ExemptionLue,
  email: string | null,
  r: { regle: 'fin_exemption_j7' | 'fin_exemption_message'; details: Record<string, unknown> },
  m: ModeleMessage,
  parEmail: (email: string) => Promise<ResultatEmail>,
): Promise<'parti' | 'deja' | 'sans_moyen' | 'echec'> {
  if (!email && (await botDemarre(ctx, ex.telegramId)) === false) return 'sans_moyen'
  let reserve: bigint | null
  try {
    reserve = await reserverGeste({
      cle: `liveclub:${r.regle}:${ex.id}`,
      deja: Prisma.sql`
        select 1 from public.cockpit_liveclub_gestes d
        where d.geste = 'rappel' and d.regle = ${r.regle} and d.resultat = 'fait'
          and d.details->>'exemption_id' = ${ex.id}`,
      geste: 'rappel', regle: r.regle, telegramId: ex.telegramId, membreId: ex.membreId,
      abonnementId: null, details: { exemption_id: ex.id, ...r.details },
    })
  } catch (err) {
    erreur(ctx, 'journal_reservation', err)
    return 'echec'
  }
  if (reserve === null) return 'deja'
  const envoi = await prevenir(ctx, [ex.telegramId], email, m, parEmail)
  await cloreReservation(ctx, reserve, envoi)
  return envoi ? 'parti' : 'echec'
}

/**
 * Une exemption DATEE vaut sortie programmee (Brice, 06/10 : « dis clairement
 * au bot de sortir cette personne au premier janvier »). Pour chaque
 * exemption non retiree dont la date tombe dans les 7 prochains jours ou est
 * passee (jour de Paris, et current_date de la base : jourLePlusAncien) :
 * - J-7 a J0 : rappel « ton acces se termine le X, pour rester abonne-toi »,
 *   une fois, seulement a un compte present, ni admin, sans autre droit ;
 * - echue (le lendemain de jusquau) : decisionFinExemption. Sortie SANS ban
 *   (sortir : plafond du passage, retirerDuLiveClub), message de fin, puis
 *   l'exemption est close. Absent : close, sans sortie ni message. Admin ou
 *   autre droit (abonnement, broker, acces manuel) : gardee, close. Droit ou
 *   presence inconnus : rien. Une fois par exemption (details.exemption_id).
 * SIMULE sans sortiesActives() : une ligne 'simule' par exemption, rien de
 * clos, rien d'envoye.
 */
async function tacheExemptions(ctx: Contexte, rattaches: Rattache[]) {
  const s = ctx.s.exemptions
  const reel = sortiesActives()
  if (reel) await rattraperMessagesFinExemption(ctx, rattaches)
  let lignes: LigneExemption[]
  try {
    lignes = await prisma.$queryRaw<LigneExemption[]>`
      select exemption_id::text as exemption_id, telegram_id, membre_id::text as membre_id, motif,
             to_char(jusquau, 'YYYY-MM-DD') as jusquau, to_char(current_date, 'YYYY-MM-DD') as aujourdhui_base
      from public.cockpit_liveclub_exemptions
      where retire_le is null and jusquau is not null
        and jusquau <= current_date + ${RAPPEL_FIN_EXEMPTION_JOURS + 1}::int
      order by jusquau
      limit 200`
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'exemptions_table_absente' : 'exemptions_illisibles', err)
    return
  }
  if (!lignes.length) return
  const parCompte = new Map<number, Rattache[]>()
  for (const r of rattaches) parCompte.set(r.telegramId, [...parCompte.get(r.telegramId) ?? [], r])
  const jourDuPassage = jourParis(ctx.maintenant.toISOString())

  for (const l of lignes) {
    if (tempsEcoule(ctx)) return
    const tid = Number(l.telegram_id)
    if (!Number.isSafeInteger(tid)) continue
    const phase = phaseExemption({ jusquau: l.jusquau, retireLe: null }, jourLePlusAncien(jourDuPassage, l.aujourdhui_base))
    if (phase !== 'rappel_j7' && phase !== 'echue') continue
    // Deja sorti ce matin par une autre tache : le passage suivant le verra absent, et clora.
    if (ctx.sortis.has(tid)) continue
    const ex: ExemptionLue = { id: l.exemption_id, telegramId: tid, membreId: l.membre_id, motif: l.motif, jusquau: l.jusquau }
    const detail = { cle: 'exemption_id', valeur: ex.id }
    const resultats = reel ? ['fait'] : ['fait', 'simule']

    let deja: boolean
    try {
      deja = phase === 'rappel_j7'
        ? await gesteExiste({ geste: 'rappel', regle: 'fin_exemption_j7', resultats, telegramId: tid, detail })
        : await gesteExiste({ geste: 'fin_acces', regle: 'fin_exemption', resultats, telegramId: tid, detail })
    } catch (err) {
      erreur(ctx, 'journal_illisible', err)
      s.inconnus++
      continue
    }

    let emails: string[] = []
    let lecture: Awaited<ReturnType<typeof lireCompteExempte>> = { ...LECTURE_INUTILE, statutTg: null, raison: null }
    if (!deja) {
      try {
        emails = await emailsExemption(ctx, ex.membreId, parCompte.get(tid) ?? [])
      } catch (err) {
        // Sans les emails, un abonnement pris sous l'un d'eux echapperait au
        // droit : on ne decide rien.
        erreur(ctx, 'emails_membre_illisibles', err)
        s.inconnus++
        continue
      }
      lecture = await lireCompteExempte(ex, emails)
    }
    const email = emails[0] ?? null
    const base = { exemption_id: ex.id, jusquau: ex.jusquau, motif_exemption: ex.motif }
    const contexte = { telegramId: tid, membreId: ex.membreId, abonnementId: null }

    // 1. Rappel J-7 (jusqu'au jour meme : rattrapage d'un passage saute).
    if (phase === 'rappel_j7') {
      const d = decisionRappelExemption(phase, deja, lecture, reel)
      if (d === 'inconnu') { s.inconnus++; continue }
      if (d === 'simuler') {
        await tracer(ctx, { geste: 'rappel', resultat: 'simule', regle: 'fin_exemption_j7', details: base }, contexte)
        s.simulees++
        continue
      }
      if (d !== 'envoyer') continue
      const issue = await prevenirExempte(ctx, ex, email, { regle: 'fin_exemption_j7', details: { jusquau: ex.jusquau } },
        modeleRappelFinExemption(ex.jusquau), e => emailRappelFinExemption(e, ex.jusquau))
      if (issue === 'parti') s.rappels_j7++
      else if (issue === 'sans_moyen') s.sans_moyen++
      else if (issue === 'echec') s.echecs++
      continue
    }

    // 2. Echue : sortie, ou cloture.
    const d = decisionFinExemption(phase, deja, lecture, reel)
    switch (d) {
      case 'rien':
        continue
      case 'inconnu':
        s.inconnus++
        continue
      case 'deja_sortie':
        // Sortie deja faite (ou simulee) : on ne refait rien. En reel, la
        // cloture avait echoue apres la sortie : on la refait, sans ligne.
        if (reel && !(await cloreExemption(ctx, ex.id))) s.echecs++
        continue
      case 'simuler':
        await tracer(ctx, { geste: 'fin_acces', resultat: 'simule', regle: 'fin_exemption', details: { ...base, statut_tg: lecture.statutTg } }, contexte)
        s.simulees++
        continue
      case 'clore_absent':
      case 'clore_admin':
      case 'clore_autre_droit': {
        const garde = d !== 'clore_absent'
        // Une simulation n'ecrit rien d'autre que ses lignes 'simule' : on compte.
        if (!reel) { if (garde) s.gardees_autre_droit++; else s.closes_absent++; continue }
        if (!(await cloreExemption(ctx, ex.id))) { s.echecs++; continue }
        const cloture = d === 'clore_absent' ? 'absent' : d === 'clore_admin' ? 'admin' : 'autre_droit'
        await tracer(ctx, {
          geste: 'fin_acces', resultat: 'refuse', regle: 'fin_exemption',
          details: { ...base, cloture, statut_tg: lecture.statutTg, ...(d === 'clore_autre_droit' ? { raison_droit: lecture.raison } : {}) },
        }, contexte)
        if (garde) s.gardees_autre_droit++
        else s.closes_absent++
        continue
      }
      case 'sortir': {
        const issue = await sortir(ctx, tid, {
          geste: 'fin_acces', regle: 'fin_exemption', membreId: ex.membreId,
          details: { ...base, statut_tg: lecture.statutTg },
        })
        if (issue === 'plafond') continue
        if (issue !== 'fait') { s.echecs++; continue }
        s.sorties++
        // Close APRES la sortie : close avant, une sortie ratee ne serait
        // jamais retentee (le passage ne lit que les exemptions ouvertes).
        if (!(await cloreExemption(ctx, ex.id))) s.echecs++
        const m = await prevenirExempte(ctx, ex, email, { regle: 'fin_exemption_message', details: {} },
          modeleFinExemption(), e => emailFinExemption(e))
        if (m === 'parti') s.messages_fin++
        else if (m === 'sans_moyen') s.sans_moyen++
        else if (m === 'echec') s.echecs++
        continue
      }
    }
  }
}

/**
 * Messages de fin d'exemption rates (ligne 'echec', aucune 'fait') pour une
 * sortie 'fin_exemption' faite depuis moins de 7 jours : on retente, si le
 * compte est toujours hors du groupe. L'exemption est deja close : on part du
 * journal, pas de la table des exemptions. La reservation garde l'unicite.
 */
async function rattraperMessagesFinExemption(ctx: Contexte, rattaches: Rattache[]) {
  const s = ctx.s.exemptions
  let lignes: { telegram_id: bigint; membre_id: string | null; exemption_id: string; motif: string | null; jusquau: string | null }[]
  try {
    lignes = await prisma.$queryRaw`
      select distinct on (g.details->>'exemption_id')
        g.telegram_id, g.membre_id::text as membre_id, g.details->>'exemption_id' as exemption_id,
        g.details->>'motif_exemption' as motif, g.details->>'jusquau' as jusquau
      from public.cockpit_liveclub_gestes g
      where g.geste = 'fin_acces' and g.regle = 'fin_exemption' and g.resultat = 'fait'
        and g.telegram_id is not null and g.details->>'exemption_id' is not null
        and g.fait_le > now() - interval '7 days'
        and exists (
          select 1 from public.cockpit_liveclub_gestes e
          where e.geste = 'rappel' and e.regle = 'fin_exemption_message' and e.resultat = 'echec'
            and e.details->>'exemption_id' = g.details->>'exemption_id')
        and not exists (
          select 1 from public.cockpit_liveclub_gestes f
          where f.geste = 'rappel' and f.regle = 'fin_exemption_message' and f.resultat = 'fait'
            and f.details->>'exemption_id' = g.details->>'exemption_id')
      order by g.details->>'exemption_id', g.fait_le desc
      limit 100`
  } catch (err) {
    erreur(ctx, 'journal_illisible', err)
    return
  }
  for (const l of lignes) {
    if (tempsEcoule(ctx)) return
    const tid = Number(l.telegram_id)
    if (!Number.isSafeInteger(tid)) continue
    if ((await presence(tid)).etat !== 'non') continue
    const ex: ExemptionLue = { id: l.exemption_id, telegramId: tid, membreId: l.membre_id, motif: l.motif ?? '', jusquau: l.jusquau ?? '' }
    let emails: string[]
    try {
      emails = await emailsExemption(ctx, ex.membreId, rattaches.filter(r => r.telegramId === tid))
    } catch (err) {
      erreur(ctx, 'emails_membre_illisibles', err)
      continue
    }
    const m = await prevenirExempte(ctx, ex, emails[0] ?? null, { regle: 'fin_exemption_message', details: {} },
      modeleFinExemption(), e => emailFinExemption(e))
    if (m === 'parti') s.messages_fin++
    else if (m === 'echec') s.echecs++
  }
}

// ---------------------------------------------------------------------------
// (o) Suivi des lots d'un acces broker (Brice et Mel, 31/10, lots-pur.ts)
// ---------------------------------------------------------------------------

/**
 * Pour chaque acces broker actif dont un depot attend ses premiers lots :
 * - relance 1 (pas-a-pas) puis relance 2 (la date, et la pause qui suit), en
 *   prive sinon par email, chacune UNE fois par depot (reservation), l'etat
 *   relu juste avant (lots faits, declaration en cours, relance partie), et
 *   seulement a un membre present dans le groupe ;
 * - a la fin du delai (limite effective : jamais avant RELANCE_LOTS_2_AVANT_FIN
 *   jours apres la relance 2), la PAUSE de l'acces : sortie SANS ban par
 *   sortir() (plafond du passage), si le compte est present, ni admin ni
 *   createur, et sans autre droit (droit relu en direct) ; puis le message de
 *   la pause, une fois par depot. SIMULEE sans sortiesActives() (une ligne
 *   'simule' par depot, a relire dans le Journal du bot) ;
 * - le filet du retour (retoursApresLots) : lots notes faits apres une pause,
 *   membre absent et droit 'oui' : le lien de retour, une fois par depot.
 * Une declaration en cours (l'equipe verifie) arrete tout. LIVECLUB_SUIVI_LOTS=0 coupe la tache.
 */
async function tacheLots(ctx: Contexte) {
  const s = ctx.s.lots
  if (!suiviLotsActif()) {
    s.coupe = true
    return
  }
  await retoursApresLots(ctx)
  let suivis: LigneSuiviLots[]
  try {
    suivis = await suivisLotsATraiter()
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'lots_table_absente' : 'lots_illisibles', err)
    return
  }
  const aujourdhui = jourParis(ctx.maintenant.toISOString())
  for (const l of suivis) {
    if (tempsEcoule(ctx)) return
    const phase = phaseLots(l.suivi, aujourdhui)
    if (phase === 'attente') continue
    if (phase === 'declares') { s.declares++; continue }
    // Jamais entre (lien personnel jamais ouvert) : rien a relancer ni a mettre en pause.
    if (l.telegramId === null || !Number.isSafeInteger(l.telegramId)) { s.sans_compte++; continue }
    if (ctx.sortis.has(l.telegramId)) continue
    if (phase === 'pause') await mettreEnPauseLots(ctx, l, l.telegramId, aujourdhui)
    else await relancerLots(ctx, l, l.telegramId, phase === 'relance_1' ? 1 : 2, aujourdhui)
  }
}

/** Le suivi de CE depot relu juste avant d'agir (grille de Brice : l'etat, pas une sequence). null = plus rien a faire. */
async function reluLots(ctx: Contexte, l: LigneSuiviLots): Promise<LigneSuiviLots | null | 'panne'> {
  try {
    return await suiviLotsDeCommission(l.commissionId)
  } catch (err) {
    erreur(ctx, 'lots_illisibles', err)
    return 'panne'
  }
}

async function relancerLots(ctx: Contexte, l: LigneSuiviLots, tid: number, n: 1 | 2, aujourdhui: string) {
  const s = ctx.s.lots
  const relu = await reluLots(ctx, l)
  if (relu === 'panne') { s.inconnus++; return }
  if (!relu || phaseLots(relu.suivi, aujourdhui) !== (n === 1 ? 'relance_1' : 'relance_2')) return
  const p = await presence(tid)
  if (p.etat === 'inconnu') { s.inconnus++; return }
  if (p.etat === 'non') { s.absents++; return }
  const limite = n === 1 ? limiteLots(relu.suivi) : limiteAnnonceeRelance2(relu.suivi, aujourdhui)
  const regle = `lots_relance_${n}`
  let reserve: bigint | null
  try {
    reserve = await reserverGeste({
      cle: `liveclub:${regle}:${l.commissionId}`,
      deja: Prisma.sql`
        select 1 from public.cockpit_liveclub_gestes d
        where d.geste = 'rappel' and d.regle = ${regle} and d.resultat = 'fait'
          and d.details->>'commission_id' = ${l.commissionId}`,
      geste: 'rappel', regle, telegramId: tid, abonnementId: null,
      details: { acces_id: l.accesId, commission_id: l.commissionId, limite },
    })
  } catch (err) {
    erreur(ctx, 'journal_reservation', err)
    s.inconnus++
    return
  }
  if (reserve === null) { s.deja_faits++; return }
  const envoi = await prevenir(ctx, [tid], l.email, modeleRelanceLots(n, limite), e => emailRelanceLots(e, n, limite))
  await cloreReservation(ctx, reserve, envoi)
  if (!envoi) { s.echecs++; return }
  if (n === 1) s.relances_1++
  else s.relances_2++
}

async function mettreEnPauseLots(ctx: Contexte, l: LigneSuiviLots, tid: number, aujourdhui: string) {
  const s = ctx.s.lots
  const relu = await reluLots(ctx, l)
  if (relu === 'panne') { s.inconnus++; return }
  if (!relu || phaseLots(relu.suivi, aujourdhui) !== 'pause') return
  const p = await presence(tid)
  if (p.etat === 'inconnu') { s.inconnus++; return }
  if (p.etat === 'non') {
    // Deja hors du groupe : le droit refuse son entree et dit pourquoi. Un
    // message de pause rate apres une sortie se retente ici.
    s.absents++
    await rattraperMessageSuspensionLots(ctx, l, tid)
    return
  }
  if (estIntouchable(p)) { s.gardes++; return }
  // Abonnement, exemption, acces manuel (meme par un autre email) : on garde.
  const droit = await droitAvantSortie(tid, [l.email])
  if (droit === 'inconnu') { s.inconnus++; return }
  if (droit === 'oui') { s.gardes++; return }
  const details = { acces_id: l.accesId, commission_id: l.commissionId, limite: limiteEffectiveLots(relu.suivi), statut_tg: p.statut }
  if (!sortiesActives()) {
    let deja: boolean
    try {
      deja = await gesteExiste({
        geste: 'retrait', regle: 'lots_non_faits', resultats: ['simule'], telegramId: tid,
        detail: { cle: 'commission_id', valeur: l.commissionId },
      })
    } catch (err) {
      erreur(ctx, 'journal_illisible', err)
      s.inconnus++
      return
    }
    if (!deja) {
      await tracer(ctx, { geste: 'retrait', resultat: 'simule', regle: 'lots_non_faits', details }, { telegramId: tid })
      s.simulees++
    }
    return
  }
  const issue = await sortir(ctx, tid, { geste: 'retrait', regle: 'lots_non_faits', details })
  if (issue === 'plafond') return
  if (issue !== 'fait') { s.echecs++; return }
  s.pauses++
  if (await messageSuspensionLots(ctx, l, tid)) s.messages++
}

/** Le message de la pause, une fois par depot, reserve avant l'envoi. true = parti. */
async function messageSuspensionLots(ctx: Contexte, l: LigneSuiviLots, tid: number): Promise<boolean> {
  let reserve: bigint | null
  try {
    reserve = await reserverGeste({
      cle: `liveclub:lots_suspension_message:${l.commissionId}`,
      deja: Prisma.sql`
        select 1 from public.cockpit_liveclub_gestes d
        where d.geste = 'rappel' and d.regle = 'lots_suspension_message' and d.resultat = 'fait'
          and d.details->>'commission_id' = ${l.commissionId}`,
      geste: 'rappel', regle: 'lots_suspension_message', telegramId: tid, abonnementId: null,
      details: { acces_id: l.accesId, commission_id: l.commissionId },
    })
  } catch (err) {
    erreur(ctx, 'journal_reservation', err)
    return false
  }
  if (reserve === null) return false
  const envoi = await prevenir(ctx, [tid], l.email, modeleSuspensionLots(), e => emailSuspensionLots(e))
  await cloreReservation(ctx, reserve, envoi)
  return envoi !== null
}

/** Sorti pour ses lots, message jamais parti : on le retente (la reservation garde l'unicite). */
async function rattraperMessageSuspensionLots(ctx: Contexte, l: LigneSuiviLots, tid: number) {
  let sorti: boolean
  let envoye: boolean
  try {
    const detail = { cle: 'commission_id', valeur: l.commissionId }
    sorti = await gesteExiste({ geste: 'retrait', regle: 'lots_non_faits', resultats: ['fait'], telegramId: tid, detail })
    envoye = sorti && await gesteExiste({ geste: 'rappel', regle: 'lots_suspension_message', resultats: ['fait'], detail })
  } catch (err) {
    erreur(ctx, 'journal_illisible', err)
    return
  }
  if (!sorti || envoye) return
  if (await messageSuspensionLots(ctx, l, tid)) ctx.s.lots.messages++
  else ctx.s.lots.echecs++
}

/**
 * Le filet du retour : un membre mis en pause pour ses lots (sortie
 * 'lots_non_faits' de moins de 120 jours) dont les lots sont notes faits (ou
 * la commission recue) depuis, sans lien de retour encore parti. Absent et
 * droit 'oui' : le lien (retourApresLots, le meme que le clic de l'equipe,
 * une fois par depot). Deja dans le groupe : la boucle se ferme.
 */
async function retoursApresLots(ctx: Contexte) {
  const s = ctx.s.lots
  let lignes: { telegram_id: bigint; commission_id: string }[]
  try {
    lignes = await prisma.$queryRaw`
      select distinct on (g.details->>'commission_id') g.telegram_id, g.details->>'commission_id' as commission_id
      from public.cockpit_liveclub_gestes g
      join public.cockpit_commissions c on c.commission_id::text = g.details->>'commission_id'
      where g.geste = 'retrait' and g.regle = 'lots_non_faits' and g.resultat = 'fait' and g.telegram_id is not null
        and g.fait_le > now() - interval '120 days'
        and (c.lots_faits_le is not null or c.statut = 'recue')
        and not exists (
          select 1 from public.cockpit_liveclub_gestes r
          where r.geste = 'invitation' and r.regle = 'retour_lots' and r.resultat in ('fait', 'refuse')
            and r.details->>'commission_id' = g.details->>'commission_id')
      order by g.details->>'commission_id', g.fait_le desc
      limit 100`
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'lots_table_absente' : 'lots_illisibles', err)
    return
  }
  for (const l of lignes) {
    if (tempsEcoule(ctx)) return
    const tid = Number(l.telegram_id)
    if (!Number.isSafeInteger(tid)) continue
    const p = await presence(tid)
    if (p.etat === 'inconnu') { s.inconnus++; continue }
    if (p.etat === 'oui') {
      await fermerRetourLots(tid, l.commission_id, ACTEUR)
      s.deja_revenus++
      continue
    }
    const droit = await droitLiveClub(tid)
    if (droit.statut === 'inconnu') { s.inconnus++; continue }
    if (droit.statut === 'non') continue
    const r = await retourApresLots(tid, { commissionId: l.commission_id, acteur: ACTEUR })
    if (r === 'envoye') s.retours++
    else if (r === 'deja') s.deja_faits++
    else s.echecs++
  }
}

// ---------------------------------------------------------------------------
// (p) Le DEPOT PERDU (Brice, 31/10 : « pas de commission pas d'acces »,
// lots-pur.ts)
// ---------------------------------------------------------------------------

/**
 * Pour chaque acces broker FERME par un depot perdu (lots-lecture.ts) :
 * - l'etat relu juste avant (regularise entre-temps = rien) ;
 * - present dans le groupe, ni admin ni createur, sans autre droit (relu en
 *   direct) : sortie SANS ban par sortir() (plafond du passage). SIMULEE sans
 *   sortiesActives() (une ligne 'simule' par commission), rien d'autre ;
 * - puis le message de la fermeture, une fois par commission (en prive, sinon
 *   par email), sauf s'il garde le groupe par un autre droit ;
 * - puis l'alerte a Brice et Melanie dans Agent AOK, une fois par commission ;
 * - le filet du retour (retoursApresRegularisation) d'abord.
 * LIVECLUB_DEPOT_PERDU=0 coupe la tache.
 */
async function tacheDepotsPerdus(ctx: Contexte) {
  const s = ctx.s.depots_perdus
  if (!fermetureDepotPerduActive()) {
    s.coupe = true
    return
  }
  await retoursApresRegularisation(ctx)
  let fermes: LigneDepotPerdu[]
  try {
    fermes = await accesFermesParDepot()
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'depots_perdus_table_absente' : 'depots_perdus_illisibles', err)
    return
  }
  for (const l of fermes) {
    if (tempsEcoule(ctx)) return
    await fermerAccesDepot(ctx, l)
  }
}

/** Le message et l'alerte de CETTE commission sont-ils deja partis ? Jette si le journal ne repond pas. */
async function fermetureDejaTraitee(l: LigneDepotPerdu): Promise<boolean> {
  const detail = { cle: 'commission_id', valeur: l.commissionId }
  return await gesteExiste({ geste: 'rappel', regle: 'depot_perdu_message', resultats: ['fait'], detail })
    && await gesteExiste({ geste: 'acces_broker', regle: 'depot_perdu_alerte', resultats: ['fait'], detail })
}

async function fermerAccesDepot(ctx: Contexte, l: LigneDepotPerdu) {
  const s = ctx.s.depots_perdus
  let relu: LigneDepotPerdu | null
  try {
    relu = await accesFermeDeCommission(l.commissionId)
  } catch (err) {
    erreur(ctx, 'depots_perdus_illisibles', err)
    s.inconnus++
    return
  }
  // Regularise entre la liste et maintenant (commission remise en attendue, nouveau depot) : rien.
  if (!relu) return
  const tid = l.telegramId !== null && Number.isSafeInteger(l.telegramId) ? l.telegramId : null
  let issue: IssueFermetureDepot
  if (tid !== null) {
    const p = await presence(tid)
    if (p.etat === 'inconnu') { s.inconnus++; return }
    if (p.etat === 'oui') {
      if (estIntouchable(p)) { s.gardes++; return }
      const droit = await droitAvantSortie(tid, [l.email])
      if (droit === 'inconnu') { s.inconnus++; return }
      if (droit === 'oui') {
        issue = 'garde'
      } else {
        const details = { acces_id: l.accesId, commission_id: l.commissionId, statut_tg: p.statut }
        if (!sortiesActives()) {
          let deja: boolean
          try {
            deja = await gesteExiste({
              geste: 'retrait', regle: 'depot_perdu', resultats: ['simule'], telegramId: tid,
              detail: { cle: 'commission_id', valeur: l.commissionId },
            })
          } catch (err) {
            erreur(ctx, 'journal_illisible', err)
            s.inconnus++
            return
          }
          if (!deja) {
            await tracer(ctx, { geste: 'retrait', resultat: 'simule', regle: 'depot_perdu', details }, { telegramId: tid })
            s.simulees++
          }
          return
        }
        const r = await sortir(ctx, tid, { geste: 'retrait', regle: 'depot_perdu', details })
        if (r === 'plafond') return
        if (r !== 'fait') { s.echecs++; return }
        s.sorties++
        issue = 'sorti'
      }
    } else {
      // Deja hors du groupe : le droit refuse son entree et dit pourquoi.
      // Message et alerte deja partis : rien a relire (pas d'appel Stripe).
      try {
        if (await fermetureDejaTraitee(l)) { s.absents++; return }
      } catch (err) {
        erreur(ctx, 'journal_illisible', err)
        s.inconnus++
        return
      }
      const droit = await droitAvantSortie(tid, [l.email])
      if (droit === 'inconnu') { s.inconnus++; return }
      issue = droit === 'oui' ? 'garde' : 'absent'
      if (issue === 'absent') s.absents++
    }
  } else {
    // Jamais entre (lien personnel pas ouvert) : rien a sortir ; message par email.
    try {
      if (await fermetureDejaTraitee(l)) { s.sans_compte++; return }
      const abonnements = await abonnementsLiveClubParEmail(l.email)
      issue = abonnements.some(abonnementOuvreLeGroupe) ? 'garde' : 'sans_compte'
    } catch (err) {
      erreur(ctx, 'depots_perdus_illisibles', err)
      s.inconnus++
      return
    }
    if (issue === 'sans_compte') s.sans_compte++
  }
  if (issue === 'garde') s.gardes++

  // Le message au membre, une fois par commission (rien a lui dire s'il garde le groupe).
  const message = issue === 'garde' ? null : await messageFermetureDepot(ctx, l, tid)
  if (message === 'deja') {
    // Deja prevenu (un passage precedent) : l'alerte suit son propre « une fois ».
  } else if (message) {
    s.messages++
  }
  await alerteDepotPerdu(ctx, l, tid, issue, message === 'deja' ? null : message)
}

/** Le message de la fermeture, une fois par commission, reserve avant l'envoi. 'deja' = deja parti. */
async function messageFermetureDepot(ctx: Contexte, l: LigneDepotPerdu, tid: number | null): Promise<'prive' | 'email' | null | 'deja'> {
  let reserve: bigint | null
  try {
    reserve = await reserverGeste({
      cle: `liveclub:depot_perdu_message:${l.commissionId}`,
      deja: Prisma.sql`
        select 1 from public.cockpit_liveclub_gestes d
        where d.geste = 'rappel' and d.regle = 'depot_perdu_message' and d.resultat = 'fait'
          and d.details->>'commission_id' = ${l.commissionId}`,
      geste: 'rappel', regle: 'depot_perdu_message', telegramId: tid, abonnementId: null,
      details: { acces_id: l.accesId, commission_id: l.commissionId },
    })
  } catch (err) {
    erreur(ctx, 'journal_reservation', err)
    return null
  }
  if (reserve === null) return 'deja'
  const envoi = await prevenir(ctx, tid !== null ? [tid] : [], l.email, modeleFermetureDepot(), e => emailFermetureDepot(e))
  await cloreReservation(ctx, reserve, envoi)
  if (!envoi) ctx.s.depots_perdus.echecs++
  return envoi?.canal ?? null
}

/** L'alerte a Brice et Melanie (Agent AOK), une fois par commission. Rien n'est livre = la reservation est rendue (demain). */
async function alerteDepotPerdu(
  ctx: Contexte, l: LigneDepotPerdu, tid: number | null, issue: IssueFermetureDepot, message: 'prive' | 'email' | null,
) {
  let reserve: bigint | null
  try {
    reserve = await reserverGeste({
      cle: `liveclub:depot_perdu_alerte:${l.commissionId}`,
      deja: Prisma.sql`
        select 1 from public.cockpit_liveclub_gestes d
        where d.geste = 'acces_broker' and d.regle = 'depot_perdu_alerte' and d.resultat = 'fait'
          and d.details->>'commission_id' = ${l.commissionId}`,
      geste: 'acces_broker', regle: 'depot_perdu_alerte', telegramId: tid, abonnementId: null,
      details: { acces_id: l.accesId, commission_id: l.commissionId, issue },
    })
  } catch (err) {
    erreur(ctx, 'journal_reservation', err)
    return
  }
  if (reserve === null) return
  const texte = await texteAlerteDepot(l, { issue, message })
  const livres = await alerterEquipeDepotPerdu(texte, `depot-perdu-${l.commissionId}`)
  if (livres === 0) {
    await noterGeste(ctx, reserve, { resultat: 'echec', details: { livres: 0 }, fil: false })
    ctx.s.depots_perdus.echecs++
    return
  }
  await noterGeste(ctx, reserve, { resultat: 'fait', details: { livres } })
  ctx.s.depots_perdus.alertes++
}

/**
 * Le filet du retour apres une REGULARISATION : un membre sorti ou prevenu
 * pour un depot perdu (moins de 120 jours) dont l'acces n'est plus ferme (la
 * commission remise en attendue ou en lots faits, ou un autre depot attendu
 * ou recu sur le meme acces), sans lien de retour encore parti. Absent et
 * droit 'oui' : le lien (retourApresRegularisation, le meme qu'au clic de
 * l'equipe, une fois par commission). Deja dans le groupe : la boucle se ferme.
 */
async function retoursApresRegularisation(ctx: Contexte) {
  const s = ctx.s.depots_perdus
  let lignes: { telegram_id: bigint; commission_id: string }[]
  try {
    lignes = await prisma.$queryRaw`
      select distinct on (g.details->>'commission_id') g.telegram_id, g.details->>'commission_id' as commission_id
      from public.cockpit_liveclub_gestes g
      join public.cockpit_commissions c on c.commission_id::text = g.details->>'commission_id'
      where ((g.geste = 'retrait' and g.regle = 'depot_perdu') or (g.geste = 'rappel' and g.regle = 'depot_perdu_message'))
        and g.resultat = 'fait' and g.telegram_id is not null
        and g.fait_le > now() - interval '120 days'
        and exists (
          select 1 from public.cockpit_commissions c2
          where c2.acces_id = c.acces_id and c2.nature = 'depot' and c2.statut in ('attendue', 'recue'))
        and not exists (
          select 1 from public.cockpit_liveclub_gestes r
          where r.geste = 'invitation' and r.regle = 'retour_depot' and r.resultat in ('fait', 'refuse')
            and r.details->>'commission_id' = g.details->>'commission_id')
      order by g.details->>'commission_id', g.fait_le desc
      limit 100`
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'depots_perdus_table_absente' : 'depots_perdus_illisibles', err)
    return
  }
  for (const l of lignes) {
    if (tempsEcoule(ctx)) return
    const tid = Number(l.telegram_id)
    if (!Number.isSafeInteger(tid)) continue
    const p = await presence(tid)
    if (p.etat === 'inconnu') { s.inconnus++; continue }
    if (p.etat === 'oui') {
      await fermerRetourLots(tid, l.commission_id, ACTEUR, 'retour_depot')
      s.deja_revenus++
      continue
    }
    const droit = await droitLiveClub(tid)
    if (droit.statut === 'inconnu') { s.inconnus++; continue }
    // 'non' : encore ferme par un autre depot, ou en pause pour ses lots (le suivi des lots s'en charge).
    if (droit.statut === 'non') continue
    const r = await retourApresRegularisation(tid, { commissionId: l.commission_id, acteur: ACTEUR })
    if (r === 'envoye') s.retours++
    else if (r === 'echec') s.echecs++
  }
}

// ---------------------------------------------------------------------------
// (q) L'ACCUEIL ETALE EN CONSEILS (Brice, 31/10, tips-accueil-pur.ts)
// ---------------------------------------------------------------------------

/**
 * Pour chaque NOUVEAU membre entre depuis TIPS_ACCUEIL_DEPUIS (ligne
 * entree_acceptee, details.genre 'nouveau' et tips), dans la fenetre : le
 * conseil du jour s'il est du, un par jour au plus, une fois chacun, APRES les
 * relances des lots (une relance partie aujourd'hui le decale a demain).
 * L'etat relu juste avant : present dans le groupe, droit 'oui', fil qui
 * n'attend pas l'equipe et ou l'equipe n'a pas la main ; un conseil dont il a
 * deja parle est saute. En prive seulement : sans bot ouvert, rien.
 * LIVECLUB_TIPS_ACCUEIL=0 coupe la tache.
 */
async function tacheTipsAccueil(ctx: Contexte) {
  const s = ctx.s.tips
  if (!tipsAccueilActifs()) {
    s.coupe = true
    return
  }
  let entrees: { telegram_id: bigint; entre_le: string }[]
  try {
    entrees = await prisma.$queryRaw`
      select distinct on (g.telegram_id) g.telegram_id,
             to_char((g.fait_le at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') as entre_le
      from public.cockpit_liveclub_gestes g
      where g.geste = 'entree_acceptee' and g.resultat = 'fait' and g.telegram_id is not null
        and g.details->>'genre' = 'nouveau' and g.details->>'tips' = 'true'
        and (g.fait_le at time zone 'Europe/Paris')::date >= ${TIPS_ACCUEIL_DEPUIS}::date
        and g.fait_le > now() - make_interval(days => ${TIPS_FENETRE_JOURS + 1})
      order by g.telegram_id, g.fait_le desc
      limit 300`
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'tips_table_absente' : 'tips_illisibles', err)
    return
  }
  const aujourdhui = jourParis(ctx.maintenant.toISOString())
  for (const e of entrees) {
    if (tempsEcoule(ctx)) return
    const tid = Number(e.telegram_id)
    if (!Number.isSafeInteger(tid) || ctx.sortis.has(tid)) continue
    await tipDuMembre(ctx, tid, e.entre_le, aujourdhui)
  }
}

async function tipDuMembre(ctx: Contexte, tid: number, entreLe: string, aujourdhui: string) {
  const s = ctx.s.tips
  let lignes: { regle: string; resultat: string; tip: string | null; jour: string }[]
  try {
    lignes = await prisma.$queryRaw`
      select regle, resultat, details->>'tip' as tip,
             to_char((fait_le at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') as jour
      from public.cockpit_liveclub_gestes
      where telegram_id = ${tid}::bigint and geste = 'rappel'
        and regle in ('tip_accueil', 'lots_relance_1', 'lots_relance_2')
        and resultat in ('fait', 'refuse')
        and fait_le > now() - interval '40 days'`
  } catch (err) {
    erreur(ctx, 'journal_illisible', err)
    s.inconnus++
    return
  }
  const tips = lignes.filter(l => l.regle === 'tip_accueil')
  const relance = lignes.some(l => l.regle !== 'tip_accueil' && l.resultat === 'fait' && l.jour === aujourdhui)
  const dus = tipsDus({
    entreLe, aujourdhui,
    traites: new Set(tips.map(l => l.tip).filter(estCleTip)),
    envoyeAujourdhui: tips.some(l => l.resultat === 'fait' && l.jour === aujourdhui),
    relanceLotsAujourdhui: relance,
  })
  if (dus.length === 0) {
    if (relance) s.decales++
    return
  }
  // L'etat relu juste avant (grille de Brice) : dans le groupe, droit ouvert,
  // et l'equipe ni attendue ni en train de lui repondre.
  const p = await presence(tid)
  if (p.etat === 'inconnu') { s.inconnus++; return }
  if (p.etat === 'non') { s.absents++; return }
  const droit = await droitLiveClub(tid)
  if (droit.statut === 'inconnu') { s.inconnus++; return }
  if (droit.statut !== 'oui') { s.sans_droit++; return }
  const fil = await lireEtatFil(tid)
  if (fil && (fil.attend || quiRepond(fil.messages, Date.now()) === 'equipe')) { s.equipe++; return }
  // Ce qu'il a deja ecrit : au bot (7 derniers jours) et au fil Support.
  const historique = await lireHistorique(tid).catch(() => [])
  const textes = [
    ...historique.filter(m => m.role === 'user').map(m => m.content),
    ...(fil?.messages ?? []).map(m => (m && typeof m === 'object' ? m as { role?: unknown; content?: unknown } : {}))
      .filter(m => m.role === 'user' && typeof m.content === 'string').map(m => String(m.content)),
  ]
  for (const cle of dus) {
    let reserve: bigint | null
    try {
      reserve = await reserverGeste({
        cle: `liveclub:tip_accueil:${tid}:${cle}`,
        deja: Prisma.sql`
          select 1 from public.cockpit_liveclub_gestes d
          where d.geste = 'rappel' and d.regle = 'tip_accueil' and d.resultat in ('fait', 'refuse')
            and d.telegram_id = ${tid}::bigint and d.details->>'tip' = ${cle}`,
        geste: 'rappel', regle: 'tip_accueil', telegramId: tid, abonnementId: null,
        details: { tip: cle },
      })
    } catch (err) {
      erreur(ctx, 'journal_reservation', err)
      s.inconnus++
      return
    }
    if (reserve === null) { s.deja_faits++; return }
    // Il en a deja parle : le conseil est saute, le suivant peut partir aujourd'hui.
    if (dejaParle(cle, textes)) {
      await noterGeste(ctx, reserve, { resultat: 'refuse', details: { motif: 'deja_parle' }, fil: false })
      s.sautes++
      continue
    }
    const texte = texteTip(cle, { chat: chatId(), accesOffert: droit.raison !== 'abonnement' })
    const boutons = boutonsTip(cle)
    const r = await envoyer(tid, texte, boutons)
    if (!r.ok) {
      await cloreReservation(ctx, reserve, null)
      s.echecs++
      return
    }
    // Au fil Support : le texte et ses boutons ; la ligne du journal suit (cloreReservation).
    await tracerMessageBot(tid, texte, { boutons })
    await cloreReservation(ctx, reserve, { canal: 'prive', telegramId: tid })
    s.envoyes++
    return
  }
}

// ---------------------------------------------------------------------------
// (d) Purge des conversations privees
// ---------------------------------------------------------------------------

/**
 * Une conversation sans nouvelle depuis 7 jours perd son historique, et
 * l'action qui attendait une confirmation (un bouton vieux d'une semaine ne
 * doit plus rien executer). Le compteur du jour reste.
 */
async function tachePurge(ctx: Contexte) {
  try {
    ctx.s.purge.conversations = await prisma.$executeRaw`
      update public.cockpit_liveclub_conversations
      set messages = '[]'::jsonb, action_en_attente = null, nonce = null
      where maj_le < now() - interval '7 days'
        and (messages <> '[]'::jsonb or action_en_attente is not null or nonce is not null)`
  } catch (err) {
    erreur(ctx, relationAbsente(err) ? 'conversations_table_absente' : 'conversations_purge', err)
  }
}

// ---------------------------------------------------------------------------
// Le passage
// ---------------------------------------------------------------------------

/** Un contexte neuf : celui du passage, ou celui d'une reouverture apres paiement (webhook). */
function nouveauContexte(maintenant: Date): Contexte {
  return {
    maintenant,
    debut: Date.now(),
    plafond: new PlafondSorties(PLAFOND_SORTIES_PASSAGE),
    sortis: new Set(),
    emailsClients: new Map(),
    sortiesImpayeReglees: new Set(),
    s: {
      ok: true,
      sorties_actives: sortiesActives(),
      sorties_impayes_actives: sortiesImpayesActives(),
      duree_ms: 0,
      interrompu: false,
      sorties_reelles: 0,
      plafond_atteint: false,
      pauses: { adoptees: 0, metadonnees_effacees: 0, sorties: 0, resorties: 0, rappels_j7: 0, retours: 0, boucles_closes: 0, deja_faits: 0, ignores: 0, inconnus: 0, echecs: 0 },
      broker: { rappels_j7: 0, sorties: 0, messages_fin: 0, termines_sans_sortie: 0, ignores: 0, inconnus: 0, echecs: 0 },
      desabonnes: { simules: 0, sorties: 0, messages: 0, deja_traites: 0, gardes: 0, absents: 0, inconnus: 0, echecs: 0 },
      prelevements: { rappels_j3: 0, montants_inconnus: 0, apercus_illisibles: 0, deja_faits: 0, ignores: 0, inconnus: 0, echecs: 0 },
      metricgram: { signalees: 0, liens_envoyes: 0, sans_lien: 0, rebannis: 0, retours_retentes: 0, deja_signalees: 0, revenus: 0, sans_droit: 0, droit_posterieur: 0, pour_impaye: 0, inconnus: 0, echecs: 0 },
      impayes: { simules: 0, sorties: 0, messages: 0, en_grace: 0, deja_traites: 0, gardes: 0, absents: 0, sans_compte: 0, inconnus: 0, echecs: 0 },
      reouvertures: { liens_prives: 0, emails: 0, deja_revenus: 0, deja_faits: 0, sans_droit: 0, inconnus: 0, echecs: 0 },
      fenetre_30j: { simulees: 0, resiliations: 0, factures_annulees: 0, factures_en_echec: 0, messages: 0, plus_a_resilier: 0, reportees: 0, deja_faits: 0, inconnus: 0, echecs: 0 },
      bienvenue: { simules: 0, envoyes: 0, deja_envoyes: 0, deja_traites: 0, rattaches: 0, sans_email: 0, inconnus: 0, echecs: 0 },
      exemptions: { rappels_j7: 0, sorties: 0, simulees: 0, messages_fin: 0, closes_absent: 0, gardees_autre_droit: 0, sans_moyen: 0, inconnus: 0, echecs: 0 },
      lots: {
        relances_1: 0, relances_2: 0, pauses: 0, simulees: 0, messages: 0, retours: 0, deja_revenus: 0, deja_faits: 0,
        declares: 0, absents: 0, gardes: 0, sans_compte: 0, inconnus: 0, echecs: 0, coupe: false,
      },
      depots_perdus: {
        sorties: 0, simulees: 0, messages: 0, alertes: 0, retours: 0, deja_revenus: 0,
        absents: 0, gardes: 0, sans_compte: 0, inconnus: 0, echecs: 0, coupe: false,
      },
      tips: { envoyes: 0, sautes: 0, decales: 0, absents: 0, sans_droit: 0, equipe: 0, deja_faits: 0, inconnus: 0, echecs: 0, coupe: false },
      purge: { conversations: 0 },
      tarifs_reserves: { payees: 0, en_attente: 0, illisibles: 0 },
      resume: { etat: 'pas_lance', lignes: 0, livres: 0 },
      relais: { etat: 'pas_lance', lignes: 0, livres: 0 },
      journal_echecs: 0,
      messages_perdus: 0,
      erreurs: [],
    },
  }
}

export type SyntheseReouvertureClient = {
  ok: boolean
  /** Comptes Telegram rattaches a ce client (ou a l'email de la facture). */
  comptes: number
  reouvertures: SynthesePassage['reouvertures']
  messages_perdus: number
  /** Codes courts, sans aucune donnee personnelle. */
  erreurs: string[]
}

/**
 * (22/10, Brice) PRETE, PAS BRANCHEE : la reouverture (h) pour UN client
 * Stripe du compte melanie, des que sa facture est payee, appelee par le
 * webhook invoice.paid (POST /api/liveclub/stripe, actif seulement avec
 * STRIPE_WEBHOOK_SECRET_LIVECLUB ; reouverture-stripe-pur.ts dit quoi creer
 * chez Stripe). C'est EXACTEMENT la tache du passage (tacheReouvertures), sur
 * les seuls comptes rattaches a ce client (ou a l'email de la facture) et les
 * abonnements Live Club de ce client relus en direct : memes garde-fous
 * (facture de la sortie reglee apres la sortie, absent du groupe, droit 'oui'
 * relu en direct), meme reservation (une fois par reouverture : ni le
 * passage du lendemain ni un second webhook ne renvoient le message), meme
 * message (lien de demande d'adhesion en prive, sinon lien personnel vers le
 * bot par email). Ne jette pas : une panne laisse la reouverture au passage.
 */
export async function reouvertureApresPaiement(
  clientStripe: string,
  emailFacture: string | null,
  maintenant: Date = new Date(),
): Promise<SyntheseReouvertureClient> {
  const ctx = nouveauContexte(maintenant)
  const fin = (comptes: number): SyntheseReouvertureClient => ({
    ok: ctx.s.erreurs.length === 0,
    comptes,
    reouvertures: ctx.s.reouvertures,
    messages_perdus: ctx.s.messages_perdus,
    erreurs: ctx.s.erreurs,
  })
  if (!chatId()) {
    erreur(ctx, 'chat_id_absent')
    return fin(0)
  }
  let rattaches: Rattache[]
  try {
    rattaches = await lireRattachements()
  } catch (err) {
    erreur(ctx, 'rattachements_illisibles', err)
    return fin(0)
  }
  // Meme lecture que indexerParClient : le client rattache ne compte que s'il
  // vient du compte melanie ; sinon l'email (celui de la facture).
  const email = normaliserEmail(emailFacture)
  const siens = rattaches.filter(r =>
    (r.clientStripe === clientStripe && (r.compte == null || r.compte === 'melanie'))
    || (email !== null && normaliserEmail(r.email) === email))
  if (!siens.length) return fin(0)
  let abonnements: AbonnementResume[]
  try {
    abonnements = await abonnementsLiveClubDuClient(clientStripe)
  } catch (err) {
    erreur(ctx, 'stripe_illisible', err)
    return fin(siens.length)
  }
  try {
    await tacheReouvertures(ctx, abonnements, new Map([[clientStripe, siens]]))
  } catch (err) {
    erreur(ctx, 'reouvertures_interrompu', err)
  }
  return fin(siens.length)
}

export async function passageQuotidien(maintenant: Date = new Date()): Promise<SynthesePassage> {
  const ctx = nouveauContexte(maintenant)
  if (!chatId()) erreur(ctx, 'chat_id_absent')

  let rattaches: Rattache[] = []
  try {
    rattaches = await lireRattachements()
  } catch (err) {
    erreur(ctx, 'rattachements_illisibles', err)
  }

  // Une seule lecture Stripe, tous statuts : sans elle, aucune tache Stripe
  // ne decide rien (une liste a moitie lue ne fait sortir personne).
  let abonnements: AbonnementResume[] | null = null
  try {
    abonnements = await listerAbonnementsLiveClub({ statut: 'all' })
  } catch (err) {
    erreur(ctx, 'stripe_illisible', err)
  }

  const etape = async (code: string, f: () => Promise<void>) => {
    try {
      await f()
    } catch (err) {
      erreur(ctx, `${code}_interrompu`, err)
    }
  }

  if (abonnements) {
    const liste = abonnements
    const parClient = await indexerParClient(ctx, rattaches, liste)
    await etape('pauses', () => tachePauses(ctx, liste, parClient))
    await etape('retours', () => tacheRetours(ctx, new Map(liste.map(a => [a.id, a]))))
    await etape('broker', () => tacheBroker(ctx))
    // Impayes avant les desabonnes (une seule sortie par compte), et la
    // reouverture avant la tache Metricgram (sortiesImpayeReglees).
    await etape('impayes', () => tacheImpayes(ctx, liste, parClient))
    await etape('reouvertures', () => tacheReouvertures(ctx, liste, parClient))
    await etape('fenetre_30j', () => tacheFenetre(ctx, liste, parClient))
    await etape('desabonnes', () => tacheDesabonnes(ctx, liste, parClient))
    // Exemptions datees APRES les impayes et les desabonnes : un compte qui
    // releve aussi de l'un d'eux recoit le message le plus precis (facture,
    // abonnement termine) ; l'exemption est close au passage suivant (absent).
    // Le droit s'y relit en direct, sans la liste Stripe.
    await etape('exemptions', () => tacheExemptions(ctx, rattaches))
    await etape('prelevements', () => tachePrelevements(ctx, liste, parClient))
    await etape('bienvenue', () => tacheBienvenue(ctx, liste, parClient))
  } else {
    await etape('broker', () => tacheBroker(ctx))
    // Stripe illisible : un compte relie, ou dont un email est connu, lit
    // Stripe pour son droit, qui vaut alors 'inconnu' (aucune sortie). Un
    // compte sans aucun lien ne depend pas de Stripe : meme decision qu'avant.
    await etape('exemptions', () => tacheExemptions(ctx, rattaches))
  }
  // (o) Suivi des lots d'un acces broker (31/10), APRES les autres sorties
  // (une seule sortie par compte, le message le plus precis d'abord). Le droit
  // s'y relit en direct : une panne Stripe donne 'inconnu', rien ne part.
  await etape('lots', () => tacheLots(ctx))
  // (p) Depot perdu (31/10), juste apres les lots : un acces ferme sort sans
  // ban, recoit son message, et l'equipe est prevenue. Droit relu en direct.
  await etape('depots_perdus', () => tacheDepotsPerdus(ctx))
  // (q) L'accueil etale en conseils (31/10), APRES les relances des lots (une
  // relance partie aujourd'hui decale le conseil a demain).
  await etape('tips', () => tacheTipsAccueil(ctx))
  // Le droit s'y relit en direct (droitLiveClub) : la liste Stripe du passage
  // n'est pas necessaire, une panne Stripe donne 'inconnu' et rien ne part.
  await etape('metricgram', () => tacheSortiesMetricgram(ctx, rattaches, abonnements))
  // (l) Tarifs reserves (13/10) : lus par tarif chez Stripe, sans la liste du
  // passage. Le filet de la page de bienvenue (personne revenue sans passer
  // par elle). Un tarif illisible ne marque rien.
  await etape('tarifs_reserves', async () => {
    ctx.s.tarifs_reserves = await rapprocherTarifsReserves()
    if (ctx.s.tarifs_reserves.illisibles > 0) erreur(ctx, 'tarifs_reserves_illisibles')
  })
  await etape('purge', () => tachePurge(ctx))

  // (n) Le relais d'accueil (24/10, relais.ts) : apres les taches du passage,
  // JUSTE AVANT le resume. Pourquoi ici : (1) il ne depend pas du resume, qui
  // ne part que s'il y a du mouvement et peut etre coupe (LIVECLUB_DIGEST=0)
  // ou reporte ; (2) le resume lit ce qui vient d'etre transmis et marque ces
  // lignes « (Alex s'en occupe) » ; (3) son etape a son propre filet, et
  // relaisDuMatin ne jette pas : une panne d'envoi a Alex ne casse ni le
  // passage ni le resume. Une fois par jour (relais.ts), LIVECLUB_RELAIS=0
  // le coupe. Trop tard dans le budget : reporte au lendemain.
  await etape('relais', async () => {
    if (Date.now() - ctx.debut > BUDGET_RELAIS_MS) {
      ctx.s.relais.etat = 'reporte'
      erreur(ctx, 'relais_reporte')
      return
    }
    const b = await relaisDuMatin()
    ctx.s.relais = { etat: b.etat, lignes: b.lignes, livres: b.livres }
    if (b.etat === 'panne' || b.etat === 'echec') erreur(ctx, `relais_${b.etat}`)
  })

  // (m) Le resume du matin (15/10), APRES tout le reste : il dit ce que ce
  // passage vient de faire. Une fois par jour (resume.ts), LIVECLUB_DIGEST=0
  // le coupe. Il relit Stripe lui-meme (le passage a pu resilier entre-temps).
  // Trop tard dans le budget de la route (300 s) : reporte, le prochain
  // couvrira la periode.
  await etape('resume', async () => {
    if (Date.now() - ctx.debut > BUDGET_RESUME_MS) {
      ctx.s.resume.etat = 'reporte'
      erreur(ctx, 'resume_reporte')
      return
    }
    const b = await resumeDuMatin()
    ctx.s.resume = { etat: b.etat, lignes: b.lignes, livres: b.livres }
    if (b.etat === 'panne' || b.etat === 'echec' || b.etat === 'table_absente') erreur(ctx, `resume_${b.etat}`)
  })

  ctx.s.sorties_reelles = ctx.plafond.faites
  ctx.s.plafond_atteint = ctx.s.plafond_atteint || ctx.plafond.atteint
  ctx.s.duree_ms = Date.now() - ctx.debut
  ctx.s.ok = ctx.s.erreurs.length === 0 && !ctx.s.interrompu
  console.log(`[liveclub/passage] ${JSON.stringify(ctx.s)}`)
  return ctx.s
}
