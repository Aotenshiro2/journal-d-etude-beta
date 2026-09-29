// Passage quotidien du Live Club (29/09), appele par GET /api/cron/liveclub
// (cron Vercel, 7 h UTC). Quatre taches, dans cet ordre :
//   (a) PAUSES : adoption d'une pause posee hors du bot (Dashboard Stripe),
//       sortie quand la pause commence, rappel J-7 avant la reprise,
//       lien de retour quand les prelevements ont repris ;
//   (b) ACCES BROKER : rappel J-7, sortie a l'echeance sans abonnement ;
//   (c) DESABONNES : SIMULES tant que Metricgram tourne (un maitre par geste),
//       sauf LIVECLUB_SORTIES_ACTIVES === '1' ;
//   (d) purge des conversations privees de plus de 7 jours.
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
  type AbonnementResume,
} from './stripe'
import { droitLiveClub } from './droits'
import { creerJeton, jetonExistant } from './jetons'
import { appelTelegram, envoyer } from './telegram'
import {
  emailRappelPause, emailDebutPauseSansReprise, emailRetour, emailRappelFinBroker, emailFinBroker,
  modeleRappelPause, modeleDebutPauseSansReprise, modeleRetour, modeleRappelFinBroker, modeleFinBroker,
  type ModeleMessage, type ResultatEmail,
} from './emails'
import { abonnementOuvreLeGroupe, dateIso, messageErreur, normaliserEmail, relationAbsente, statutDonneDroit, statutTermine } from './pur'
import {
  PlafondSorties, pauseASortir, repriseAPrevenir, repriseFaite, desabonneHorsGrace, finAbonnement,
  debutSerieImpayee, brokerAPrevenir, brokerFini, lirePresence, estIntouchable,
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
  broker: { rappels_j7: number; sorties: number; termines_sans_sortie: number; ignores: number; inconnus: number; echecs: number }
  desabonnes: { simules: number; sorties: number; deja_traites: number; gardes: number; absents: number; inconnus: number; echecs: number }
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
async function droitAvantSortie(telegramId: number, emails: (string | null)[]): Promise<'oui' | 'non' | 'inconnu'> {
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
      await prisma.$executeRaw`
        update public.cockpit_liveclub_gestes
        set details = details || ${JSON.stringify({ canal: envoi.canal })}::jsonb,
            telegram_id = coalesce(${envoi.telegramId}::bigint, telegram_id)
        where geste_id = ${gesteId}`
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
    if (r.ok) return { canal: 'prive', telegramId: tid }
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
    await prevenir(ctx, [tid], l.email, modeleFinBroker(), e => emailFinBroker(e))
  }
}

// ---------------------------------------------------------------------------
// (c) Desabonnes (simules tant que Metricgram tourne)
// ---------------------------------------------------------------------------

async function tacheDesabonnes(ctx: Contexte, abonnements: AbonnementResume[], parClient: Map<string, Rattache[]>) {
  const s = ctx.s.desabonnes
  const reel = sortiesActives()
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

      const details = { statut: a.statut, fin: finAbonnement(a, debutImpaye)?.slice(0, 10) ?? null, statut_tg: p.statut }
      const contexte = { telegramId: r.telegramId, membreId: r.membreId, abonnementId: a.id }
      if (!reel) {
        await tracer(ctx, { geste: 'retrait', resultat: 'simule', regle: 'desabonne', details }, contexte)
        s.simules++
        continue
      }
      const issue = await sortir(ctx, r.telegramId, { geste: 'retrait', regle: 'desabonne', abonnementId: a.id, membreId: r.membreId, details })
      if (issue === 'fait') s.sorties++
      else if (issue !== 'plafond') s.echecs++
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
      broker: { rappels_j7: 0, sorties: 0, termines_sans_sortie: 0, ignores: 0, inconnus: 0, echecs: 0 },
      desabonnes: { simules: 0, sorties: 0, deja_traites: 0, gardes: 0, absents: 0, inconnus: 0, echecs: 0 },
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
  } else {
    await etape('broker', () => tacheBroker(ctx))
  }
  await etape('purge', () => tachePurge(ctx))

  ctx.s.sorties_reelles = ctx.plafond.faites
  ctx.s.plafond_atteint = ctx.s.plafond_atteint || ctx.plafond.atteint
  ctx.s.duree_ms = Date.now() - ctx.debut
  ctx.s.ok = ctx.s.erreurs.length === 0 && !ctx.s.interrompu
  console.log(`[liveclub/passage] ${JSON.stringify(ctx.s)}`)
  return ctx.s
}
