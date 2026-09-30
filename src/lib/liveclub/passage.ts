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
//   (d) purge des conversations privees de plus de 7 jours.
//
// A CHAQUE SORTIE REELLE (pause, fin d'acces broker, desabonne quand les
// sorties sont actives), le membre recoit un message : pourquoi, et comment
// revenir. En prive s'il a deja demarre le bot, sinon par email.
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
import { GRACE_JOURS, PLAFOND_SORTIES_PASSAGE, chatId, cleStripeLecture, lienBot, sortiesActives } from './config'
import {
  listerAbonnementsLiveClub, clientsStripeParEmail, abonnementsLiveClubParEmail, adopterPause, effacerMetadonneesPause,
  lireAbonnement, apercuProchaineFacture as apercuStripe,
  type AbonnementResume,
} from './stripe'
import { droitLiveClub, type Droit } from './droits'
import { creerJeton, jetonExistant } from './jetons'
import { appelTelegram, envoyer, lienDemandeAdhesion } from './telegram'
import { tracerGeste, tracerMessageBot } from './support-pont'
import {
  emailRappelPause, emailDebutPauseSansReprise, emailRetour, emailRappelFinBroker, emailFinBroker,
  emailSortieDesabonne, emailRappelPrelevement,
  modeleRappelPause, modeleDebutPauseSansReprise, modeleRetour, modeleRappelFinBroker, modeleFinBroker,
  modeleSortieDesabonne, modeleRappelPrelevement, modeleRetourSortieAbusive,
  type ModeleMessage, type ResultatEmail,
} from './emails'
import { abonnementOuvreLeGroupe, dateIso, messageErreur, normaliserEmail, relationAbsente, statutDonneDroit, statutTermine } from './pur'
import {
  PlafondSorties, pauseASortir, repriseAPrevenir, repriseFaite, desabonneHorsGrace, finAbonnement,
  debutSerieImpayee, brokerAPrevenir, brokerFini, lirePresence, estIntouchable,
  prelevementAPrevenir, montantAAnnoncer, clePrelevement, jourParis, sortieAbusiveASignaler, cleSortieAbusive,
  droitCouvraitLaSortie, retourARetenter,
  FENETRE_FIN_BROKER_JOURS, FENETRE_RAPPEL_JOURS,
  type FactureBreve, type Presence,
} from './passage-regles'

const ACTEUR = 'cron:liveclub'
/** On arrete de prendre de nouveaux cas apres 4 minutes (maxDuration de la route : 300 s). */
const BUDGET_MS = 240_000
/** Garde-fou sur les rattachements sans client Stripe a resoudre par leur email. */
const MAX_RESOLUTIONS_EMAIL = 300

export type SynthesePassage = {
  ok: boolean
  sorties_actives: boolean
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
  metricgram: { signalees: number; liens_envoyes: number; sans_lien: number; rebannis: number; retours_retentes: number; deja_signalees: number; revenus: number; sans_droit: number; droit_posterieur: number; inconnus: number; echecs: number }
  purge: { conversations: number }
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
  const d = await droitLiveClub(telegramId)
  if (d.statut !== 'non') return d.statut
  const propres = [...new Set(emails.map(e => normaliserEmail(e)).filter((e): e is string => Boolean(e)))]
  for (const email of propres) {
    try {
      const abonnements = await abonnementsLiveClubParEmail(email)
      if (abonnements.some(abonnementOuvreLeGroupe)) return 'oui'
    } catch {
      return 'inconnu'
    }
  }
  return 'non'
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
}): Promise<boolean> {
  const abo = p.abonnementId ?? null
  const tid = p.telegramId ?? null
  const paye = p.payeJusquau ?? null
  const lignes = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_liveclub_gestes
    where geste = ${p.geste} and regle = ${p.regle}
      and resultat = any(${p.resultats}::text[])
      and (${abo}::text is null or abonnement_id = ${abo})
      and (${tid}::bigint is null or telegram_id = ${tid}::bigint)
      and (${paye}::text is null or details->>'paye_jusquau' = ${paye})
    limit 1`
  return lignes.length > 0
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
  const boutons = m.bouton ? [[{ texte: m.bouton.texte, url: m.bouton.url }]] : undefined
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
    // La grace part de max(fin, fin payee) : un membre qui a paye en retard
    // apres la resiliation garde sa periode payee, puis 7 jours (finAbonnement).
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

export async function passageQuotidien(maintenant: Date = new Date()): Promise<SynthesePassage> {
  const ctx: Contexte = {
    maintenant,
    debut: Date.now(),
    plafond: new PlafondSorties(PLAFOND_SORTIES_PASSAGE),
    sortis: new Set(),
    emailsClients: new Map(),
    s: {
      ok: true,
      sorties_actives: sortiesActives(),
      duree_ms: 0,
      interrompu: false,
      sorties_reelles: 0,
      plafond_atteint: false,
      pauses: { adoptees: 0, metadonnees_effacees: 0, sorties: 0, resorties: 0, rappels_j7: 0, retours: 0, boucles_closes: 0, deja_faits: 0, ignores: 0, inconnus: 0, echecs: 0 },
      broker: { rappels_j7: 0, sorties: 0, messages_fin: 0, termines_sans_sortie: 0, ignores: 0, inconnus: 0, echecs: 0 },
      desabonnes: { simules: 0, sorties: 0, messages: 0, deja_traites: 0, gardes: 0, absents: 0, inconnus: 0, echecs: 0 },
      prelevements: { rappels_j3: 0, montants_inconnus: 0, apercus_illisibles: 0, deja_faits: 0, ignores: 0, inconnus: 0, echecs: 0 },
      metricgram: { signalees: 0, liens_envoyes: 0, sans_lien: 0, rebannis: 0, retours_retentes: 0, deja_signalees: 0, revenus: 0, sans_droit: 0, droit_posterieur: 0, inconnus: 0, echecs: 0 },
      purge: { conversations: 0 },
      journal_echecs: 0,
      messages_perdus: 0,
      erreurs: [],
    },
  }
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
    await etape('desabonnes', () => tacheDesabonnes(ctx, liste, parClient))
    await etape('prelevements', () => tachePrelevements(ctx, liste, parClient))
  } else {
    await etape('broker', () => tacheBroker(ctx))
  }
  // Le droit s'y relit en direct (droitLiveClub) : la liste Stripe du passage
  // n'est pas necessaire, une panne Stripe donne 'inconnu' et rien ne part.
  await etape('metricgram', () => tacheSortiesMetricgram(ctx, rattaches, abonnements))
  await etape('purge', () => tachePurge(ctx))

  ctx.s.sorties_reelles = ctx.plafond.faites
  ctx.s.plafond_atteint = ctx.s.plafond_atteint || ctx.plafond.atteint
  ctx.s.duree_ms = Date.now() - ctx.debut
  ctx.s.ok = ctx.s.erreurs.length === 0 && !ctx.s.interrompu
  console.log(`[liveclub/passage] ${JSON.stringify(ctx.s)}`)
  return ctx.s
}
