// (01/11) Le SERVEUR de la « pause de l'abonnement + acces par depot broker »
// (regles, textes et enchainement du clic : pause-depot-pur.ts) :
// - controlerPauseDepot : la carte d'Agent AOK, en lecture seule (Stripe pour
//   l'abonnement, la base pour l'acces, le depot et la pause du parcours) ;
// - executerPauseDepot : le clic (executerAction, stripe-actions.ts), avec
//   les vrais outils : une transaction pour l'acces, le depot et le marqueur,
//   pauser() (stripe.ts) pour la pause, le message au membre ;
// - parcoursPauseDepotMembre : l'outil pause_par_depot du bot des membres ;
// - les lectures du parcours (bot, passage, resume, Tab) ;
// - l'alerte a l'equipe quand les lots ne sont pas faits (passage, tache o).
//
// Securite (grille de Brice, 29/10) : toute ecriture passe par la carte et le
// clic de Brice ou de Melanie ; le membre n'ecrit rien d'autre qu'une ligne de
// demande dans le journal, sur SON compte (identite = son telegram_id), et son
// texte n'entre dans aucun outil. Jamais d'email ni de nom dans un log.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { RefusAction, journaliserGesteLiveClub, type ActionAgent } from '@/lib/stripe-actions'
import { contexteParis, depotPourPauseDepot, noteDepotPourPause, type DepotPourPause } from '@/lib/repartition/serveur'
import { centimes, euros, versEuros } from '@/lib/repartition/pur'
import { nomTelegram } from '@/lib/alerte-equipe-telegram'
import { rendreVisible } from '@/lib/securite/injection-pur'
import { SQL_PAUSES_DEPOT } from '@/lib/vues-serveur'
import { OFFRE_PAUSE_DEPOT, cleStripeEcriture, suiviLotsActif } from './config'
import { estMelanie } from '@/lib/agent-cockpit-pur'
import { abonnementsLiveClubDuClient, abonnementsLiveClubParEmail, lireAbonnement, pauser, type AbonnementResume } from './stripe'
import { rattachementActif } from './rattacher'
import { envoyer } from './telegram'
import { tracerGeste, tracerMessageBot } from './support-pont'
import { adresseEnvoi } from './adresse-envoi'
import { boutonsTelegram, emailMessagePauseDepot, modeleMessagePauseDepot } from './emails'
import { suiviLotsDeCommission, type LigneSuiviLots } from './lots-lecture'
import { limiteLots } from './lots-pur'
import { dateIso, formaterMontant, messageErreur, relationAbsente, statutDonneDroit, uuidDeActeur } from './pur'
import {
  MARQUEUR_ALERTE_LOTS_PAUSE_DEPOT, MARQUEUR_DECLARATION_PAUSE_DEPOT, PausePasPosee, REGLE_DECLARATION_PAUSE_DEPOT, REGLE_MESSAGE_PAUSE_DEPOT, REGLE_PAUSE_DEPOT, RefusPauseDepot, TYPE_PAUSE_DEPOT,
  carteCourtePauseDepot, carteLonguePauseDepot, datesPauseDepot, etapesPauseDepot, executerPauseDepotAvec, limiteLotsPauseDepot,
  lireDeclarationMembre, lireEtapeMembre, lireParamsPauseDepot, offreDuJour, paramsCarteDeclaration, prevenirEquipeDeclarationAvec,
  recolterDeclaration, texteMembreDeclaration, type DeclarationDepot, reponseMembrePauseDepot, resultatPauseDepot, texteAlerteLotsPauseDepot,
  type AbonnementPourPauseDepot, type CartePauseDepot, type EtapesPauseDepot, type EtatMembrePauseDepot, type IssueMessagePauseDepot,
  type LectureBasePauseDepot, type OutilsPauseDepot, type ParamsPauseDepot, type PlanPauseDepot,
} from './pause-depot-pur'

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>

const ACTEUR_MEMBRE = 'bot:membre'

// ---------------------------------------------------------------------------
// Les lectures du parcours (la vue calculee cockpit_liveclub_pauses_depot)
// ---------------------------------------------------------------------------

export type PauseDepotLue = {
  accesId: string
  email: string
  telegramId: number | null
  nom: string | null
  pseudo: string | null
  abonnementId: string | null
  broker: string | null
  debut: string
  accesJusquau: string
  payeJusquau: string | null
  /** La reprise des prelevements, 'YYYY-MM-DD' (= le dernier jour de l'acces). */
  repriseLe: string
  enCours: boolean
}

type LigneVue = {
  acces_id: string; email: string; telegram_id: bigint | null; nom: string | null; pseudo: string | null
  abonnement_id: string | null; broker: string | null; debut: string; acces_jusquau: string
  paye_jusquau: string | null; reprise_le: string | null; en_cours: boolean
}

function versPause(l: LigneVue): PauseDepotLue {
  return {
    accesId: l.acces_id, email: l.email, telegramId: l.telegram_id === null ? null : Number(l.telegram_id),
    nom: l.nom, pseudo: l.pseudo, abonnementId: l.abonnement_id, broker: l.broker, debut: l.debut,
    accesJusquau: l.acces_jusquau, payeJusquau: l.paye_jusquau, repriseLe: l.reprise_le ?? l.acces_jusquau, enCours: l.en_cours === true,
  }
}

/** Les pauses du parcours (en cours seulement par defaut), les reprises les plus proches d'abord. Jette sur une panne. */
export async function lirePausesDepot(o: { enCours?: boolean } = {}): Promise<PauseDepotLue[]> {
  const lignes = await prisma.$queryRawUnsafe<LigneVue[]>(
    `select * from (${SQL_PAUSES_DEPOT}) v ${o.enCours === false ? '' : 'where v.en_cours'} order by v.acces_jusquau limit 200`)
  return lignes.map(versPause)
}

/** La pause en cours de ce compte Telegram, ou null. Jette sur une panne. */
export async function pauseDepotDuCompte(telegramId: number): Promise<PauseDepotLue | null> {
  const lignes = await prisma.$queryRawUnsafe<LigneVue[]>(
    `select * from (${SQL_PAUSES_DEPOT}) v where v.telegram_id = $1::bigint and v.en_cours order by v.pose_le desc limit 1`, telegramId)
  return lignes[0] ? versPause(lignes[0]) : null
}

/** La pause en cours posee par ce parcours sur cet abonnement, ou null. Jette sur une panne. */
export async function pauseDepotDeAbonnement(abonnementId: string): Promise<PauseDepotLue | null> {
  const lignes = await prisma.$queryRawUnsafe<LigneVue[]>(
    `select * from (${SQL_PAUSES_DEPOT}) v where v.abonnement_id = $1 and v.en_cours order by v.pose_le desc limit 1`, abonnementId)
  return lignes[0] ? versPause(lignes[0]) : null
}

/** La pause du parcours de cet acces, en cours ou non, ou null. Jette sur une panne. */
export async function pauseDepotDeAcces(accesId: string): Promise<PauseDepotLue | null> {
  const lignes = await prisma.$queryRawUnsafe<LigneVue[]>(
    `select * from (${SQL_PAUSES_DEPOT}) v where v.acces_id = $1 limit 1`, accesId)
  return lignes[0] ? versPause(lignes[0]) : null
}

/**
 * (passage, tache b) Cet acces broker est-il celui d'une pause du parcours
 * dont l'abonnement va reprendre (vivant, toujours en pause, aucun arret) ?
 * Alors pas de rappel « ton acces se termine, abonne-toi » : le rappel J-7 de
 * la pause s'en charge. 'inconnu' sur une panne : rien n'est envoye.
 */
export async function accesDePauseQuiReprend(accesId: string): Promise<boolean | 'inconnu'> {
  try {
    const l = await pauseDepotDeAcces(accesId)
    if (!l?.abonnementId) return false
    const a = await lireAbonnement(l.abonnementId)
    return Boolean(a && statutDonneDroit(a.statut) && a.pauseActive && !a.arretPrevu)
  } catch (err) {
    console.warn(`[liveclub/pause-depot] acces illisible : ${relationAbsente(err) ? 'table absente' : messageErreur(err).slice(0, 160)}`)
    return 'inconnu'
  }
}

// ---------------------------------------------------------------------------
// Ce que la carte lit
// ---------------------------------------------------------------------------

function versAbonnement(a: AbonnementResume): AbonnementPourPauseDepot {
  const tarif = a.montantPeriode
    ? `${formaterMontant(a.montantPeriode.centimes, a.montantPeriode.devise)}${a.periodicite ? ` par ${a.periodicite}` : ''}${a.aRemise ? ' avant remise' : ''}`
    : null
  return {
    id: a.id, statut: a.statut, finPeriode: a.finPeriode, arretPrevu: a.arretPrevu, pauseActive: a.pauseActive,
    pauseJusquau: a.pauseJusquau, pausePayeJusquau: a.pausePayeJusquau, clientStripe: a.clientStripe, tarif,
  }
}

/** L'acces de l'adresse (et son parcours), le depot deja inscrit, la pause du parcours sur cet abonnement. */
async function lireBase(db: Db, p: ParamsPauseDepot, abonnementId: string): Promise<LectureBasePauseDepot> {
  const acces = await db.$queryRaw<{ acces_id: string; jusquau: string; actif: boolean; telegram_id: bigint | null; abonnement: string | null }[]>`
    select a.acces_id::text as acces_id, to_char(a.jusquau, 'YYYY-MM-DD') as jusquau,
      (a.retire_le is null and a.sorti_le is null and a.jusquau >= current_date) as actif, a.telegram_id,
      (select g.abonnement_id from public.cockpit_liveclub_gestes g
        where g.geste = 'acces_broker' and g.regle = ${REGLE_PAUSE_DEPOT} and g.resultat = 'fait'
          and g.details->>'acces_id' = a.acces_id::text
        order by g.fait_le desc limit 1) as abonnement
    from public.cockpit_liveclub_acces a
    where lower(a.email) = ${p.email} and a.motif = 'broker'
    limit 1`
  const emails = [p.email, ...(p.email_abonnement ? [p.email_abonnement] : [])]
  const depot = await db.$queryRaw<{ commission_id: string; acces_id: string | null }[]>`
    select c.commission_id::text as commission_id, c.acces_id::text as acces_id
    from public.cockpit_commissions c
    left join public.cockpit_liveclub_acces a on a.acces_id = c.acces_id
    where c.partenaire_id = ${p.partenaire} and c.nature = 'depot' and c.le = ${p.le}::date
      and c.montant_base = ${versEuros(centimes(p.montant) ?? 0)}::numeric
      and (lower(c.email) = any(${emails}::text[]) or lower(a.email) = any(${emails}::text[]))
    order by c.pose_le
    limit 1`
  const pause = await db.$queryRaw<{ reprise: string | null }[]>`
    select g.details->>'reprise_le' as reprise from public.cockpit_liveclub_gestes g
    where g.geste = 'pause' and g.regle = ${REGLE_PAUSE_DEPOT} and g.resultat = 'fait' and g.abonnement_id = ${abonnementId}
    order by g.fait_le desc
    limit 1`
  const a = acces[0]
  return {
    acces: a
      ? {
        accesId: a.acces_id, jusquau: a.jusquau, actif: a.actif === true, abonnementDuParcours: a.abonnement,
        telegramId: a.telegram_id === null ? null : Number(a.telegram_id),
      }
      : null,
    depot: depot[0] ? { commissionId: depot[0].commission_id, accesId: depot[0].acces_id } : null,
    pauseDuParcours: pause[0]?.reprise ?? null,
  }
}

/** Le compte Telegram relie a l'abonnement (le lien actif le plus recent), ou null. */
async function telegramDeAbonnement(clientStripe: string | null, email: string): Promise<number | null> {
  const l = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
    select telegram_id from public.cockpit_liveclub_rattachements
    where retire_le is null and telegram_id is not null
      and ((${clientStripe}::text is not null and client_stripe = ${clientStripe}::text) or lower(email) = ${email})
    order by lie_le desc
    limit 1`
  return l[0] ? Number(l[0].telegram_id) : null
}

function carteDe(o: {
  p: ParamsPauseDepot; qui: string; telegramId: number | null; a: AbonnementPourPauseDepot; depot: DepotPourPause
  plan: PlanPauseDepot; etapes: EtapesPauseDepot; limiteLots: string | null
}): CartePauseDepot {
  return {
    qui: o.qui, email: o.p.email, emailAbonnement: o.p.email_abonnement,
    telegram: o.telegramId ? `compte Telegram u${o.telegramId}` : null,
    tarif: o.a.tarif, partenaireNom: o.depot.partenaireNom, montant: o.depot.base, le: o.p.le,
    commission: o.depot.attendue, phraseCommission: o.depot.phrase,
    payeJusquau: o.plan.payeJusquau, repriseLe: o.plan.repriseLe, debutAcces: dateIso(new Date()), mois: o.p.mois,
    limiteLots: o.limiteLots, etapes: o.etapes,
  }
}

export type ControlePauseDepot =
  | { erreur: string }
  | { action: ActionAgent; carte: string; court: string; manque: string | null }

/**
 * Le controle AVANT la carte (lecture seule) : la commission du depot (comme
 * la carte de depot broker), l'abonnement chez Stripe (un seul en cours), ce
 * qui existe deja (acces, depot, pause du parcours), les dates, son compte
 * Telegram. Un refus retourne au modele, qui le dit. La carte est composee
 * ici (longue pour Brice, courte pour Melanie) ; abonnement_id, les dates et
 * telegram_id sont poses ici et relus au clic.
 */
export async function controlerPauseDepot(action: ActionAgent): Promise<ControlePauseDepot> {
  const { aujourdhui } = contexteParis()
  const p = lireParamsPauseDepot(action.params, { aujourdhui })
  if (typeof p === 'string') return { erreur: p }
  const depot = await depotPourPauseDepot(p)
  if ('erreur' in depot) return { erreur: depot.erreur }

  const emailAbonnement = p.email_abonnement ?? p.email
  let abonnements: AbonnementResume[]
  try {
    abonnements = await abonnementsLiveClubParEmail(emailAbonnement)
  } catch (err) {
    return { erreur: `Lecture Stripe impossible avant la carte (${messageErreur(err).slice(0, 160)}) : réessaie dans un instant.` }
  }
  const enCours = abonnements.filter(a => statutDonneDroit(a.statut) || a.statut === 'unpaid')
  if (enCours.length === 0) {
    return {
      erreur: `Aucun abonnement Live Club en cours à ${emailAbonnement} : rien n'est proposé. `
        + (p.email_abonnement ? '' : "Si son abonnement est à une autre adresse que celle du broker, demande-la à ton interlocuteur (email_abonnement). ")
        + "Pour un client qui n'est pas abonné, c'est la carte de dépôt broker classique.",
    }
  }
  if (enCours.length > 1) {
    return { erreur: `${enCours.length} abonnements Live Club en cours à ${emailAbonnement} : ce parcours n'en met qu'un en pause. Dis-le à ton interlocuteur, rien n'est proposé.` }
  }
  const a = versAbonnement(enCours[0])
  const base = await lireBase(prisma, p, a.id)
  const etapes = etapesPauseDepot({ abonnement: a, base, email: p.email })
  if (typeof etapes === 'string') return { erreur: etapes }
  const plan = datesPauseDepot(a, etapes, p.mois)
  if (!plan) return { erreur: "Dates de son abonnement illisibles chez Stripe : réessaie dans un instant." }

  const telegramId = base.acces?.telegramId ?? await telegramDeAbonnement(a.clientStripe, emailAbonnement)
  const nom = telegramId ? await nomTelegram(telegramId) : null
  const qui = rendreVisible(p.client ?? nom ?? p.email)
  // Le delai des lots : celui du suivi s'il existe deja (depot relie), sinon a partir d'aujourd'hui.
  const limite = !suiviLotsActif() ? null
    : base.depot ? await limiteDuDepot(base.depot.commissionId) ?? limiteLotsPauseDepot(dateIso(new Date()))
      : limiteLotsPauseDepot(dateIso(new Date()))
  const params: ParamsPauseDepot = {
    ...p, abonnement_id: a.id, paye_jusquau: plan.payeJusquau, reprise_le: plan.repriseLe, telegram_id: telegramId,
  }
  const carte = carteDe({ p, qui, telegramId, a, depot, plan, etapes, limiteLots: limite })
  return {
    action: { type: TYPE_PAUSE_DEPOT as ActionAgent['type'], compte: 'cockpit', params: { ...params } },
    carte: carteLonguePauseDepot(carte),
    court: carteCourtePauseDepot(carte),
    manque: etapes.pause === 'poser' && !cleStripeEcriture()
      ? "STRIPE_AGENT_KEY_MELANIE absente du projet journal : la pause ne pourrait pas être posée. Rien n'est fait."
      : null,
  }
}

/** La fin du delai des lots d'un depot deja suivi, ou null. Ne jette pas. */
async function limiteDuDepot(commissionId: string): Promise<string | null> {
  try {
    const l = await suiviLotsDeCommission(commissionId)
    return l ? limiteLots(l.suivi) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Le clic
// ---------------------------------------------------------------------------

/** Verrou de transaction sur une cle (rendu au commit). */
async function verrou(tx: Db, cle: string): Promise<void> {
  await tx.$queryRaw`select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${cle}::text, 0))) as verrou`
}

/** Le message au membre, reserve avant l'envoi (une fois par acces). */
async function prevenirMembre(o: {
  accesId: string; telegramId: number | null; email: string; partenaire: string; plan: PlanPauseDepot; commissionId: string; acteur: string
}): Promise<IssueMessagePauseDepot> {
  let reserve: bigint | null
  try {
    const lignes = await prisma.$transaction(async tx => {
      await verrou(tx, `liveclub:${REGLE_MESSAGE_PAUSE_DEPOT}:${o.accesId}`)
      return tx.$queryRaw<{ geste_id: bigint }[]>`
        insert into public.cockpit_liveclub_gestes (telegram_id, geste, resultat, acteur, regle, details)
        select ${o.telegramId}::bigint, 'rappel', 'fait', ${o.acteur}, ${REGLE_MESSAGE_PAUSE_DEPOT}, ${JSON.stringify({ acces_id: o.accesId })}::jsonb
        where not exists (
          select 1 from public.cockpit_liveclub_gestes d
          where d.geste = 'rappel' and d.regle = ${REGLE_MESSAGE_PAUSE_DEPOT} and d.resultat = 'fait'
            and d.details->>'acces_id' = ${o.accesId})
        returning geste_id`
    })
    reserve = lignes[0]?.geste_id ?? null
  } catch (err) {
    console.warn(`[liveclub/pause-depot] message non reserve : ${messageErreur(err).slice(0, 160)}`)
    return null
  }
  if (reserve === null) return 'deja'

  const contenu = {
    partenaire: o.partenaire, payeJusquau: o.plan.payeJusquau, repriseLe: o.plan.repriseLe,
    limiteLots: suiviLotsActif() ? await limiteDuDepot(o.commissionId) : null,
  }
  let canal: 'prive' | 'email' | null = null
  if (o.telegramId) {
    const m = modeleMessagePauseDepot(contenu, 'telegram')
    const texte = m.paragraphes.join('\n\n')
    const boutons = boutonsTelegram(m)
    const r = await envoyer(o.telegramId, texte, boutons)
    await tracerMessageBot(o.telegramId, texte, { boutons, livre: r.ok })
    if (r.ok) canal = 'prive'
  }
  if (!canal) {
    const adresse = await adresseEnvoi({ emailIdentite: o.email, accesId: o.accesId })
    if (adresse && (await emailMessagePauseDepot(adresse, contenu)).ok) canal = 'email'
  }
  try {
    if (canal) {
      await prisma.$executeRaw`
        update public.cockpit_liveclub_gestes set details = details || ${JSON.stringify({ canal })}::jsonb where geste_id = ${reserve}`
      await tracerGeste(o.telegramId, { geste: 'rappel', resultat: 'fait', regle: REGLE_MESSAGE_PAUSE_DEPOT, details: { acces_id: o.accesId, canal } })
    } else {
      await prisma.$executeRaw`update public.cockpit_liveclub_gestes set resultat = 'echec' where geste_id = ${reserve}`
    }
  } catch (err) {
    console.warn(`[liveclub/pause-depot] message non clos : ${messageErreur(err).slice(0, 160)}`)
  }
  return canal
}

/** L'execution au clic (executerAction, stripe-actions.ts). RefusAction : rien n'a ete fait ; Error : une panne. */
export async function executerPauseDepot(action: ActionAgent, acteur: string): Promise<string> {
  const posePar = uuidDeActeur(acteur)
  if (!posePar) throw new Error("Auteur de l'action illisible : rien n'a été fait.")
  const { aujourdhui } = contexteParis()
  const p = lireParamsPauseDepot(action.params, { aujourdhui })
  if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a été fait.`)
  const depot = await depotPourPauseDepot(p)
  if ('erreur' in depot) throw new RefusAction(`${depot.erreur.split('. ')[0]}. Rien n'a été fait.`)

  const outils: OutilsPauseDepot = {
    aujourdhui: dateIso(new Date()),
    lireAbonnement: async (id) => {
      const a = await lireAbonnement(id)
      return a ? versAbonnement(a) : null
    },
    lireBase: (q, id) => lireBase(prisma, q, id),
    poserAccesEtDepot: async (o) => {
      const abonnementId = o.abonnement.id
      const issue = await prisma.$transaction(async (tx) => {
        await verrou(tx, `liveclub:pause_depot:${abonnementId}`)
        await verrou(tx, `liveclub:acces:${o.p.email}`)
        // Relu sous les verrous : la carte a pu etre confirmee deux fois.
        const base = await lireBase(tx, o.p, abonnementId)
        const relu = etapesPauseDepot({ abonnement: o.abonnement, base, email: o.p.email })
        if (typeof relu === 'string') throw new RefusPauseDepot(relu)
        if (relu.acces !== o.etapes.acces || relu.depot !== o.etapes.depot) {
          throw new RefusPauseDepot("L'accès ou le dépôt a changé depuis la lecture (carte confirmée deux fois ?) : redemande la carte, rien n'a été fait.")
        }
        let accesId: string
        if (o.etapes.acces === 'poser') {
          const l = await tx.$queryRaw<{ acces_id: string }[]>`
            insert into public.cockpit_liveclub_acces (email, motif, source, debut, jusquau, pose_par, note, telegram_id)
            values (${o.p.email}, 'broker', ${o.p.partenaire}, current_date, ${o.repriseLe}::date, ${acteur},
                    ${`pause de l'abonnement par un dépôt ${depot.partenaireNom}`}, ${o.telegramId}::bigint)
            on conflict do nothing
            returning acces_id::text as acces_id`
          if (!l[0]) throw new RefusPauseDepot(`${o.p.email} vient de recevoir un accès broker (carte confirmée en même temps) : rien n'a été fait.`)
          accesId = l[0].acces_id
        } else {
          accesId = (base.acces as NonNullable<LectureBasePauseDepot['acces']>).accesId
          // L'acces court jusqu'a la reprise (dates alignees), relie a son compte s'il ne l'etait pas.
          await tx.$executeRaw`
            update public.cockpit_liveclub_acces
            set jusquau = ${o.repriseLe}::date, telegram_id = coalesce(telegram_id, ${o.telegramId}::bigint)
            where acces_id = ${accesId}::uuid`
        }
        let commissionId: string
        if (o.etapes.depot === 'inscrire') {
          const l = await tx.$queryRaw<{ commission_id: string }[]>`
            insert into public.cockpit_commissions
              (partenaire_id, nature, acces_id, email, client, le, montant_base, taux_pct, montant_fixe,
               commission_attendue, note, pose_par, via)
            values (${depot.partenaireId}, 'depot', ${accesId}::uuid, null, ${o.p.client}, ${o.p.le}::date, ${versEuros(depot.base)}::numeric,
                    ${depot.taux.tauxPct}::numeric, ${depot.taux.montantFixe === null ? null : versEuros(depot.taux.montantFixe)}::numeric,
                    ${versEuros(depot.attendue)}::numeric, ${noteDepotPourPause(depot.libelle, o.p.note)}, ${posePar}::uuid, 'agent')
            returning commission_id::text as commission_id`
          if (!l[0]) throw new Error("La base n'a pas inscrit le dépôt.")
          commissionId = l[0].commission_id
        } else {
          commissionId = (base.depot as NonNullable<LectureBasePauseDepot['depot']>).commissionId
          if (o.etapes.depot === 'relier') {
            const n = await tx.$executeRaw`
              update public.cockpit_commissions set acces_id = ${accesId}::uuid
              where commission_id = ${commissionId}::uuid and acces_id is null`
            if (n === 0) throw new RefusPauseDepot("Le dépôt déjà inscrit vient d'être relié ailleurs : redemande la carte, rien n'a été fait.")
          }
        }
        // Le marqueur du parcours, dans la meme transaction : sans lui, rien n'est pose.
        const details = {
          acces_id: accesId, abonnement_id: abonnementId, commission_id: commissionId,
          paye_jusquau: o.payeJusquau, reprise_le: o.repriseLe, jusquau: o.repriseLe,
          partenaire: o.p.partenaire, mois: o.p.mois, acces: o.etapes.acces, depot: o.etapes.depot,
        }
        await tx.$executeRaw`
          insert into public.cockpit_liveclub_gestes (telegram_id, abonnement_id, geste, resultat, acteur, regle, details)
          values (${o.telegramId}::bigint, ${abonnementId}, 'acces_broker', 'fait', ${acteur}, ${REGLE_PAUSE_DEPOT},
                  ${JSON.stringify(details)}::jsonb)`
        return { accesId, commissionId, details }
      })
      // Au fil Support du membre : une ligne courte. Ne jette pas.
      await tracerGeste(o.telegramId, { geste: 'acces_broker', resultat: 'fait', regle: REGLE_PAUSE_DEPOT, details: issue.details })
      return { accesId: issue.accesId, commissionId: issue.commissionId }
    },
    poserPause: async (id, mois) => {
      const issue = await pauser(id, mois)
      return { payeJusquau: issue.payeJusquau.slice(0, 10), repriseLe: issue.repriseLe.slice(0, 10) }
    },
    alignerAcces: async (accesId, jusquau) => {
      await prisma.$executeRaw`update public.cockpit_liveclub_acces set jusquau = ${jusquau}::date where acces_id = ${accesId}::uuid`
    },
    journaliserPause: async (o) => {
      await journaliserGesteLiveClub({
        geste: 'pause', resultat: 'fait', regle: REGLE_PAUSE_DEPOT,
        details: { etape: 'pause_programmee', nb_mois: o.mois, paye_jusquau: o.plan.payeJusquau, reprise_le: o.plan.repriseLe, acces_id: o.accesId },
      }, { telegramId: o.telegramId, acteur, abonnementId: o.abonnementId })
    },
    prevenirMembre: (o) => prevenirMembre({ ...o, acteur }),
  }

  try {
    const issue = await executerPauseDepotAvec(p, outils)
    const nom = p.telegram_id ? await nomTelegram(p.telegram_id) : null
    return resultatPauseDepot(issue, {
      qui: rendreVisible(p.client ?? nom ?? p.email), partenaire: depot.partenaireNom,
      phraseCommission: issue.etapes.depot === 'garder' ? null : depot.phrase,
    })
  } catch (err) {
    if (err instanceof RefusPauseDepot) throw new RefusAction(err.message)
    if (err instanceof PausePasPosee) throw new Error(err.message)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Le bot des membres : l'outil pause_par_depot
// ---------------------------------------------------------------------------

/** Ou en est le membre qui ecrit : pause deja en place, abonne, ou non. Ne jette pas. */
async function etatMembre(telegramId: number): Promise<EtatMembrePauseDepot> {
  try {
    const enPlace = await pauseDepotDuCompte(telegramId).catch((err: unknown) => {
      // Table ou colonne absente : pas de pause du parcours, la suite decide.
      if (relationAbsente(err)) return null
      throw err
    })
    if (enPlace) return { genre: 'en_place', partenaire: enPlace.broker, repriseLe: enPlace.repriseLe }
    const r = await rattachementActif(telegramId)
    if (!r) return { genre: 'pas_abonne' }
    const duClient = r.client_stripe && (r.compte == null || r.compte === 'melanie') ? await abonnementsLiveClubDuClient(r.client_stripe) : []
    const parEmail = !duClient.some(a => statutDonneDroit(a.statut)) && r.email ? await abonnementsLiveClubParEmail(r.email) : []
    return [...duClient, ...parEmail].some(a => statutDonneDroit(a.statut)) ? { genre: 'abonne' } : { genre: 'pas_abonne' }
  } catch (err) {
    console.warn(`[liveclub/pause-depot] etat du membre illisible : ${messageErreur(err).slice(0, 160)}`)
    return { genre: 'panne' }
  }
}

/** La ligne du journal (et du fil Support) d'une demande, une fois par 24 h et par regle. Ne jette pas. */
async function noterDemande(telegramId: number, regle: string, details: Record<string, unknown>): Promise<void> {
  try {
    const deja = await prisma.$queryRaw<{ n: number }[]>`
      select 1 as n from public.cockpit_liveclub_gestes
      where geste = 'acces_broker' and regle = ${regle} and resultat = 'fait' and telegram_id = ${telegramId}::bigint
        and fait_le > now() - interval '24 hours'
      limit 1`
    if (deja.length) return
    await journaliserGesteLiveClub({ geste: 'acces_broker', resultat: 'fait', regle, details }, { telegramId, acteur: ACTEUR_MEMBRE })
  } catch (err) {
    console.warn(`[liveclub/pause-depot] demande non notee : ${messageErreur(err).slice(0, 160)}`)
  }
}

/**
 * L'outil pause_par_depot du bot des membres (agent-membre.ts) : la reponse
 * du serveur (jamais celle du modele), et veutHumain quand l'equipe doit
 * agir (conditions a envoyer, depot a verifier) : la route passe alors le fil
 * en « veut un humain », ce qui envoie l'alerte existante a Brice et Mel.
 */
export async function parcoursPauseDepotMembre(
  telegramId: number, entree: unknown, o: { textesDuMembre?: readonly string[] } = {},
): Promise<{ texte: string; veutHumain: boolean; panne: boolean }> {
  const etape = lireEtapeMembre(entree)
  const etat = await etatMembre(telegramId)
  const { aujourdhui } = contexteParis()
  const r = reponseMembrePauseDepot(etat, etape, offreDuJour(aujourdhui))
  if (etat.genre === 'abonne' && etape === 'depot_fait') {
    // (04/11, cas d'Arthur) Montant, date et adresse chez le broker : ceux de
    // l'outil, sinon recoltes dans ses messages ; la carte (ou ce qui manque)
    // chez CHAQUE compte de l'equipe, quel que soit l'etat de son fil Support.
    const d = recolterDeclaration(lireDeclarationMembre(entree, { aujourdhui }), o.textesDuMembre ?? [])
    await noterDemande(telegramId, r.regle ?? REGLE_DECLARATION_PAUSE_DEPOT, { etape, abonne: true, montant: d.montant, le: d.le })
    await prevenirEquipeDeclaration(telegramId, d, aujourdhui)
    return { texte: texteMembreDeclaration(r.texte, d), veutHumain: r.equipe, panne: false }
  }
  if (r.regle) await noterDemande(telegramId, r.regle, { etape, abonne: etat.genre === 'abonne' })
  return { texte: r.texte, veutHumain: r.equipe, panne: etat.genre === 'panne' }
}

/**
 * (04/11) La declaration « depot fait » d'un abonne chez Brice ET Mel : la
 * carte du clic pre-remplie (controlerPauseDepot) posee dans sa conversation
 * d'Agent AOK, ou l'alerte avec ce qui manque. Ne jette pas.
 */
export async function prevenirEquipeDeclaration(telegramId: number, d: DeclarationDepot, aujourdhui: string): Promise<number> {
  try {
    const { tgCockpit, ajouterAHistoriqueAgent, proposerCarteEquipe } = await import('@/lib/agent-cockpit-telegram')
    const r = await rattachementActif(telegramId).catch(() => null)
    const nom = await nomTelegram(telegramId)
    const emailAbonnement = r?.email ?? null
    const id = `depot-${telegramId}-${Date.now().toString(36)}`
    const entrees = (texte: string) => [
      { role: 'user' as const, content: MARQUEUR_DECLARATION_PAUSE_DEPOT, id },
      { role: 'assistant' as const, content: texte, id: `${id}-texte` },
    ]
    const issue = await prevenirEquipeDeclarationAvec({
      qui: rendreVisible(nom ?? emailAbonnement ?? `compte Telegram u${telegramId}`),
      email: d.email ?? emailAbonnement, partenaire: OFFRE_PAUSE_DEPOT.partenaire || 'le broker', d,
    }, {
      equipe: async () => (await prisma.$queryRaw<{ telegram_id: bigint; libelle: string | null }[]>`
        select telegram_id, libelle from public.cockpit_telegram_comptes order by cree_le`)
        .map(l => ({ chat: Number(l.telegram_id), court: estMelanie(l.libelle) }))
        .filter(l => Number.isSafeInteger(l.chat) && l.chat > 0),
      carte: async () => {
        const params = paramsCarteDeclaration({ d, emailAbonnement, client: nom, jourMessage: aujourdhui })
        if (typeof params === 'string') return { manque: params }
        const c = await controlerPauseDepot({ type: TYPE_PAUSE_DEPOT as ActionAgent['type'], compte: 'cockpit', params })
        if ('erreur' in c) return { manque: c.erreur }
        if (c.manque) return { manque: c.manque }
        return { action: c.action as unknown as Record<string, unknown>, carte: c.carte, court: c.court }
      },
      poserCarte: (chat, action, texte) => proposerCarteEquipe(chat, action, texte, entrees(texte)),
      envoyer: async (chat, texte) => {
        if (!await tgCockpit('sendMessage', { chat_id: chat, text: texte.slice(0, 4000), link_preview_options: { is_disabled: true } })) return false
        await ajouterAHistoriqueAgent(chat, chat, entrees(texte)).catch(() => false)
        return true
      },
    })
    console.log(`[liveclub/pause-depot] declaration de depot : ${issue.livres}/${issue.vises} destinataire(s), ${issue.cartes} carte(s)`)
    return issue.livres
  } catch (err) {
    console.warn(`[liveclub/pause-depot] declaration de depot non transmise : ${messageErreur(err).slice(0, 160)}`)
    return 0
  }
}

/** (agent-membre.ts) La pause du parcours en cours de ce membre, pour sa consigne. null sur panne. */
export async function pauseDepotPourAgentMembre(telegramId: number): Promise<{ partenaire: string | null; repriseLe: string } | null> {
  try {
    const l = await pauseDepotDuCompte(telegramId)
    return l ? { partenaire: l.broker, repriseLe: l.repriseLe } : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// L'equipe : lots pas faits a la fin du delai (passage, tache o)
// ---------------------------------------------------------------------------

/** Le texte de l'alerte pour ce suivi (nom, montant et reprise mis en forme ici). Ne jette pas. */
export async function texteAlerteLots(l: LigneSuiviLots): Promise<string> {
  const nom = l.client ?? (l.telegramId !== null ? await nomTelegram(l.telegramId).catch(() => null) : null)
  const pause = await pauseDepotDeAcces(l.accesId).catch(() => null)
  return texteAlerteLotsPauseDepot({
    qui: rendreVisible(nom ?? l.email), email: l.email, partenaire: l.partenaire,
    depot: l.montantBase === null ? null : euros(centimes(l.montantBase) ?? 0), depotLe: l.depotLe,
    repriseLe: pause?.repriseLe ?? null,
  })
}

/**
 * L'alerte a chaque compte de l'equipe (Agent AOK), et dans son historique
 * (une question posee juste en dessous s'y rapporte). Le nombre de comptes
 * qui l'ont recue. Import a l'appel : pas de cycle avec le bot des membres.
 */
export async function alerterEquipePauseDepot(texte: string, id: string): Promise<number> {
  try {
    const { tgCockpit, ajouterAHistoriqueAgent } = await import('@/lib/agent-cockpit-telegram')
    const equipe = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`
    let livres = 0
    for (const dest of equipe) {
      const chat = Number(dest.telegram_id)
      if (!Number.isSafeInteger(chat) || chat <= 0) continue
      if (!await tgCockpit('sendMessage', { chat_id: chat, text: texte.slice(0, 4000), link_preview_options: { is_disabled: true } })) continue
      livres++
      await ajouterAHistoriqueAgent(chat, chat, [
        { role: 'user', content: MARQUEUR_ALERTE_LOTS_PAUSE_DEPOT, id },
        { role: 'assistant', content: texte, id: `${id}-texte` },
      ]).catch(() => false)
    }
    console.log(`[liveclub/pause-depot] alerte lots : ${livres}/${equipe.length} destinataire(s)`)
    return livres
  } catch (err) {
    console.warn(`[liveclub/pause-depot] alerte lots non envoyee : ${messageErreur(err).slice(0, 160)}`)
    return 0
  }
}
