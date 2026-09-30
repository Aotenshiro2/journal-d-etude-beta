// Fonctions PURES du Live Club (29/09) : aucune base, aucun reseau, aucun
// alias d'import. C'est voulu : scripts/verifier-liveclub.mjs les teste avec
// Node seul (suppression des types de Node 22), sans lanceur de tests.
//
// La regle de la pause (debut a la fin de la periode payee) vit ICI et
// stripe-actions.ts la reexporte : une seule source pour l'agent du cockpit
// et pour le bot des membres.

import { randomBytes } from 'crypto'

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' en UTC. */
export function dateIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function ajouterJours(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000)
}

/**
 * Nombre de jours pleins de `depuis` a `jusqua` (dates 'YYYY-MM-DD' ou
 * instants ISO), en comparant les jours UTC. Negatif si `jusqua` est passe.
 */
export function joursEntre(depuis: string | Date, jusqua: string | Date): number {
  const jour = (x: string | Date) => {
    const iso = typeof x === 'string' ? x : x.toISOString()
    return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  }
  return Math.round((jour(jusqua) - jour(depuis)) / 86_400_000)
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** '2026-10-12' ou un instant ISO -> '12 octobre 2026' (jour UTC). */
export function formaterDateFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const jour = Number(m[3])
  return `${jour === 1 ? '1er' : jour} ${MOIS_FR[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

// ---------------------------------------------------------------------------
// Regle de la pause (Brice, 10/09) : la pause demarre a la date de
// renouvellement, jamais en milieu de periode payee. Clover (2025-09-30) porte
// current_period_end sur les items, pas a la racine : on lit items d'abord,
// la racine en repli (anciennes versions).
// ---------------------------------------------------------------------------

/** Fin de la periode en cours d'un abonnement Stripe brut, en secondes, ou null. */
export function finPeriodeAbonnement(sub: Record<string, unknown>): number | null {
  const items = (sub.items as { data?: { current_period_end?: number }[] } | undefined)?.data ?? []
  const fin = items[0]?.current_period_end
    ?? (sub as { current_period_end?: number }).current_period_end
  return typeof fin === 'number' && fin > 0 ? fin : null
}

/**
 * Date de reprise des prelevements : fin de la periode payee + nbMois
 * (setUTCMonth, comme le code d'origine du 10/09 : le 31 + 1 mois deborde sur
 * le mois suivant, c'est le comportement deja en service).
 */
export function calculerReprisePause(finPeriodeSec: number, nbMois: number): Date {
  const reprise = new Date(finPeriodeSec * 1000)
  reprise.setUTCMonth(reprise.getUTCMonth() + nbMois)
  return reprise
}

export function nbMoisPauseValide(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 6
}

// ---------------------------------------------------------------------------
// Statuts Stripe
// ---------------------------------------------------------------------------

/** Statuts qui ouvrent le groupe (past_due = relance en cours, on laisse). */
export function statutDonneDroit(statut: string): boolean {
  return statut === 'active' || statut === 'trialing' || statut === 'past_due'
}

/** Statuts d'un abonnement fini, candidat a la sortie apres la grace. */
export function statutTermine(statut: string): boolean {
  return statut === 'canceled' || statut === 'unpaid' || statut === 'incomplete_expired'
}

export type AbonnementResume = {
  id: string
  statut: string
  /** Fin de la periode en cours (ISO), null si Stripe ne la donne pas. */
  finPeriode: string | null
  /** cancel_at_period_end, ou une date d'arret posee (cancel_at). */
  arretPrevu: boolean
  /** Date de reprise des prelevements (pause_collection.resumes_at), ISO. */
  pauseJusquau: string | null
  /** Une pause est posee (programmee ou en cours). */
  pauseActive: boolean
  /**
   * La pause a commence : la periode payee (datee au moment de la pose, dans
   * les metadonnees, voir metadonneesPause) est finie. Stripe laisse le statut
   * 'active' pendant une pause : c'est CE champ qui dit que le membre n'a plus
   * acces. Une pause posee sans ces metadonnees (Dashboard, avant le 29/09)
   * n'est pas effective ici tant que le passage quotidien ne l'a pas adoptee
   * (pauseADater, metadonneesAdoption) : dans le doute personne ne sort. Une
   * pause MODIFIEE au Dashboard (sceau different) garde sa fin notee, donc
   * reste effective.
   */
  pauseEffective: boolean
  /** Fin de la periode payee avant la pause (ISO), si la pose l'a notee. */
  pausePayeJusquau: string | null
  /**
   * Pause sans fin payee valable (Dashboard Stripe, ou une ancienne pose) ou
   * dont le sceau ne correspond plus (modifiee au Dashboard) : le passage
   * quotidien doit l'adopter ou la re-sceller (metadonneesAdoption).
   */
  pauseADater: boolean
  /**
   * Plus de pause active, mais nos metadonnees de pause sont restees (pause
   * levee au Dashboard) : le passage quotidien les efface, sinon une pause
   * posee plus tard pourrait reprendre une fin payee perimee.
   */
  metaPauseRestante: boolean
  /** Premier produit Live Club de l'abonnement. */
  produit: string
  clientStripe: string | null
  /** Fin reelle (ended_at), ISO, pour les abonnements termines. */
  termineLe: string | null
  /**
   * Abonnement TERMINE (canceled, unpaid, incomplete_expired) dont la derniere
   * facture est payee : fin de la periode que cette facture couvre (ISO).
   * Regle de Brice (29/09) : « ce qui est paye est du ». Le droit court
   * jusque-la meme si Stripe a resilie avant (paiement en retard apres la
   * resiliation), et la grace du passage quotidien part de cette date.
   * null pour un abonnement vivant, si la derniere facture n'est pas payee
   * (on ne prolonge jamais sur une facture impayee), si elle a ete payee
   * avant la resiliation (resiliation immediate, remboursement), si elle n'a
   * rien encaisse ou si un avoir l'a suivie. Voir finPayeeTerminee.
   */
  payeJusquau: string | null
  /**
   * finaliseeLe (30/09) : finalisation de la facture (status_transitions.
   * finalized_at, repli sur created), pour savoir si elle etait deja due au
   * moment d'une sortie du groupe.
   */
  derniereFacture: { statut: string; payeeLe: string | null; finaliseeLe: string | null } | null
  /**
   * Prix d'une periode d'apres les items (unit_amount x quantity, en
   * centimes), AVANT remise. null si un item n'a pas de prix unitaire (palier,
   * prix a l'usage) ou si les devises different. Voir montantPeriodeAbonnement.
   */
  montantPeriode: { centimes: number; devise: string } | null
  /** Une remise (coupon, code promo) est posee sur l'abonnement ou un de ses items. */
  aRemise: boolean
  /** « mois », « 3 mois », « an » : la periode du prix (price.recurring), null si illisible. */
  periodicite: string | null
  /** Stripe preleve tout seul (charge_automatically), pas une facture envoyee a payer. */
  prelevementAuto: boolean
  /**
   * Debut de l'abonnement (start_date, sinon created), ISO. Sert a dire si un
   * droit d'aujourd'hui existait deja a une date passee (sortie Metricgram).
   */
  debutLe: string | null
  /** Creation de l'abonnement chez Stripe (created), ISO : rattrapage des emails de bienvenue. */
  creeLe: string | null
  /**
   * Impayes (Brice, 30/09), pour un abonnement past_due ou unpaid seulement :
   * ses factures ouvertes lues (lireImpaye). Absent = pas lu (abonnement a
   * jour, ou lecture pas faite) ; 'illisible' = la lecture a echoue. Pose par
   * stripe.ts (completerImpaye), jamais par resumerAbonnement. Voir etatImpaye.
   */
  impaye?: Impaye | 'illisible'
}

function isoDepuisSec(s: unknown): string | null {
  return typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : null
}

// ---------------------------------------------------------------------------
// Date de debut d'une pause. Stripe ne dit pas QUAND pause_collection a ete
// posee, et fait avancer current_period_end pendant la pause : la fin de la
// periode payee ne se relit plus sur l'abonnement. Une facture annulee
// (void) ne suffit pas non plus : elle peut dater d'avant la pose (correction
// manuelle). Chaque pose (bot et agent du cockpit) note donc la fin payee et
// la date de reprise dans les metadonnees de l'abonnement, dans le MEME appel.
//
// Cycle de vie (constats relecteur 29/09) :
//   - chaque LEVEE de pause efface les deux metadonnees : l'agent du cockpit
//     dans le meme appel (reprise_abonnement), le passage quotidien pour une
//     levee faite au Dashboard (metaPauseRestante, effacerMetadonneesPause).
//     Une metadonnee presente pendant une pause active vient donc de CETTE
//     pause, eventuellement modifiee au Dashboard (reprise prolongee, ou
//     passee de « indefiniment » a une date) ;
//   - la fin payee notee vaut donc tant qu'aucune facture payee APRES elle
//     ne la dement (finPayeeNotee) : une facture payee apres la fin notee
//     prouve que ces metadonnees sont restees d'une ancienne pause ;
//   - la reprise sert de SCEAU : si elle ne correspond plus a la pause en
//     cours, la pause a ete modifiee hors de nos poses. La fin payee notee
//     reste valable (la sortie n'est pas remise en cause), et le passage
//     quotidien re-scelle (pauseADater, metadonneesAdoption garde la fin).
// ---------------------------------------------------------------------------

export const META_PAUSE_PAYE_JUSQUAU = 'liveclub_paye_jusquau'
export const META_PAUSE_REPRISE = 'liveclub_pause_reprise'
/**
 * Sceau d'une pause SANS date de reprise (Dashboard : « indefiniment »). Seul
 * le passage quotidien le pose, en adoptant une telle pause ; nos poses ont
 * toujours une reprise.
 */
export const SCEAU_SANS_REPRISE = 'sans'

/**
 * Champs a ajouter au POST qui pose (ou adopte) la pause : fin payee et
 * reprise en secondes Unix, en texte. reprise null = pause sans reprise.
 */
export function metadonneesPause(finPeriodeSec: number, reprise: Date | null): Record<string, string> {
  return {
    [`metadata[${META_PAUSE_PAYE_JUSQUAU}]`]: String(Math.floor(finPeriodeSec)),
    [`metadata[${META_PAUSE_REPRISE}]`]: reprise ? String(Math.floor(reprise.getTime() / 1000)) : SCEAU_SANS_REPRISE,
  }
}

/**
 * Champs a ajouter au POST qui LEVE une pause (ou nettoie apres une levee
 * faite au Dashboard) : une valeur vide efface la cle chez Stripe.
 */
export function effacementMetadonneesPause(): Record<string, string> {
  return {
    [`metadata[${META_PAUSE_PAYE_JUSQUAU}]`]: '',
    [`metadata[${META_PAUSE_REPRISE}]`]: '',
  }
}

function metadonnees(sub: Record<string, unknown>): Record<string, unknown> | null {
  const m = sub.metadata
  return m && typeof m === 'object' ? m as Record<string, unknown> : null
}

/** L'abonnement porte encore une de nos metadonnees de pause (non vide). */
export function porteMetadonneesPause(sub: Record<string, unknown>): boolean {
  const meta = metadonnees(sub)
  return [META_PAUSE_PAYE_JUSQUAU, META_PAUSE_REPRISE]
    .some(k => typeof meta?.[k] === 'string' && (meta[k] as string) !== '')
}

/** La derniere facture (latest_invoice expand) a ete payee APRES finSec. */
function facturePayeeApres(sub: Record<string, unknown>, finSec: number): boolean {
  const f = sub.latest_invoice && typeof sub.latest_invoice === 'object'
    ? sub.latest_invoice as { status?: string; status_transitions?: { paid_at?: number | null } }
    : null
  const payeeLe = f?.status_transitions?.paid_at
  return f?.status === 'paid' && typeof payeeLe === 'number' && payeeLe > finSec
}

/**
 * La fin payee notee dans les metadonnees, en secondes, si elle vaut encore :
 * presente, et pas dementie par une facture payee apres elle (reste d'une
 * ancienne pause qu'on n'aurait pas pu effacer). Le sceau n'entre pas en
 * compte ici (voir sceauValable).
 */
function finPayeeNotee(sub: Record<string, unknown>): number | null {
  const fin = Number(metadonnees(sub)?.[META_PAUSE_PAYE_JUSQUAU])
  if (!Number.isFinite(fin) || fin <= 0) return null
  return facturePayeeApres(sub, fin) ? null : fin
}

/** Le sceau (reprise notee) correspond a la pause en cours. repriseSec null = pause sans reprise. */
function sceauValable(sub: Record<string, unknown>, repriseSec: number | null): boolean {
  const sceau = metadonnees(sub)?.[META_PAUSE_REPRISE]
  if (repriseSec !== null) return Number(sceau) === repriseSec
  return sceau === SCEAU_SANS_REPRISE
}

export type PoseDePause = {
  /** Fin de la periode payee, en secondes. */
  finPeriodeSec: number
  reprise: Date
  /** Corps du POST /v1/subscriptions/{id} : pause_collection ET metadonnees, dans le meme appel. */
  corps: Record<string, string>
}

/**
 * La pose d'une pause de nbMois sur un abonnement Stripe brut, MEME regle pour
 * le bot (pauser) et l'agent du cockpit (pause_abonnement) : la periode payee
 * va a son terme, puis behavior=void jusqu'a fin de periode + nbMois, et les
 * metadonnees qui datent le debut. Refuse une pause deja posee : la fin de
 * periode lue ne serait plus celle payee (Stripe la fait avancer pendant la
 * pause), et les metadonnees seraient fausses. Jette avec un message lisible.
 */
export function preparerPoseDePause(sub: Record<string, unknown>, nbMois: unknown): PoseDePause {
  if (!nbMoisPauseValide(nbMois)) throw new Error('Durée de pause : un nombre entier de mois, de 1 à 6.')
  const pause = sub.pause_collection as { resumes_at?: number | null } | null | undefined
  if (pause && (pause.resumes_at == null || pause.resumes_at * 1000 > Date.now())) {
    throw new Error('Une pause est déjà posée sur cet abonnement.')
  }
  const fin = finPeriodeAbonnement(sub)
  if (!fin) throw new Error("Fin de période introuvable sur l'abonnement.")
  const reprise = calculerReprisePause(fin, nbMois)
  return {
    finPeriodeSec: fin,
    reprise,
    corps: {
      'pause_collection[behavior]': 'void',
      'pause_collection[resumes_at]': String(Math.floor(reprise.getTime() / 1000)),
      ...metadonneesPause(fin, reprise),
    },
  }
}

export type AdoptionDePause = {
  finPeriodeSec: number
  /** pause_collection.resumes_at, null pour une pause sans reprise. */
  repriseSec: number | null
  /**
   * true : la fin payee deja notee est gardee (pause modifiee hors de nos
   * poses, seul le sceau change). false : premiere adoption, fin de periode
   * vue maintenant.
   */
  finGardee: boolean
  /** Corps du POST : les metadonnees seules, la pause elle-meme n'est pas touchee. */
  corps: Record<string, string>
}

/**
 * Adoption d'une pause posee ou modifiee HORS de nos poses (Dashboard
 * Stripe). null si l'abonnement n'a pas de pause active a dater (aucune
 * pause, ou metadonnees et sceau deja valables) ou pas de fin de periode.
 *
 * - Pause MODIFIEE (fin payee notee et valable, sceau different : reprise
 *   prolongee, ou « indefiniment » devenu une date) : on GARDE la fin payee
 *   notee et on ne change que le sceau. Relire current_period_end ici serait
 *   faux : Stripe l'a fait avancer pendant la pause, et un membre deja sorti
 *   retrouverait un droit sans payer.
 * - PREMIERE adoption (aucune fin notee valable) : fin de periode que Stripe
 *   donne AU MOMENT ou on la voit (items.data[].current_period_end, API
 *   clover), reprise telle que posee (pause_collection.resumes_at, ou le
 *   sceau 'sans'). PRUDENT, et en retard d'un cycle dans le pire cas : si la
 *   pause a ete posee avant le dernier renouvellement, la periode payee est
 *   deja finie (facture annulee) et Stripe a fait avancer current_period_end ;
 *   la sortie du groupe arrive alors un cycle plus tard que la vraie fin
 *   payee. On prefere un membre qui reste un cycle de trop a un membre sorti
 *   alors qu'il a paye.
 */
export function metadonneesAdoption(sub: Record<string, unknown>, maintenantMs: number = Date.now()): AdoptionDePause | null {
  const pause = sub.pause_collection as { resumes_at?: number | null } | null | undefined
  if (!pause) return null
  const repriseSec = typeof pause.resumes_at === 'number' ? pause.resumes_at : null
  if (repriseSec !== null && repriseSec * 1000 <= maintenantMs) return null
  const notee = finPayeeNotee(sub)
  if (notee !== null && sceauValable(sub, repriseSec)) return null
  const fin = notee ?? finPeriodeAbonnement(sub)
  if (!fin) return null
  return {
    finPeriodeSec: fin,
    repriseSec,
    finGardee: notee !== null,
    corps: metadonneesPause(fin, repriseSec === null ? null : new Date(repriseSec * 1000)),
  }
}

type LigneFacture = { amount?: number; period?: { start?: number; end?: number } | null }

/**
 * Fin de la periode payee d'un abonnement TERMINE, en secondes, ou null.
 * Seulement si la derniere facture (latest_invoice expand) est 'paid' ET a
 * ete payee APRES la fin de l'abonnement (status_transitions.paid_at
 * posterieur a canceled_at et a ended_at) : c'est le paiement en retard d'un
 * abonnement deja resilie. Une facture payee avant la resiliation ne
 * prolonge rien : une resiliation immediate (exclusion, remboursement) garde
 * la sortie a ended_at + grace, et une resiliation en fin de periode a deja
 * ended_at = fin payee. Aucune date de fin connue = pas de prolongation.
 * Refus aussi si rien n'a ete encaisse (amount_paid absent ou nul : coupon a
 * 100 %, solde crediteur) ou si un avoir a suivi le paiement
 * (post_payment_credit_notes_amount > 0 : remboursement total ou partiel).
 * Limite : un remboursement fait sur la charge, sans avoir, ne se voit pas
 * sur la facture. La fin vient des lignes de cette facture (lines.data[].period.end, la plus
 * lointaine parmi les lignes de montant positif : un avoir de prorata ou une
 * ligne a zero ne paie rien). Si la facture ne porte pas ses lignes, repli
 * sur la fin de periode de l'abonnement (items.data[].current_period_end,
 * API clover). Lignes presentes mais aucune positive = null : rien de paye a
 * prolonger.
 */
export function finPayeeTerminee(sub: Record<string, unknown>): number | null {
  if (!statutTermine(String(sub.status ?? ''))) return null
  const f = sub.latest_invoice && typeof sub.latest_invoice === 'object'
    ? sub.latest_invoice as {
      status?: string
      amount_paid?: number
      post_payment_credit_notes_amount?: number
      status_transitions?: { paid_at?: number | null } | null
      lines?: { data?: LigneFacture[] } | null
    }
    : null
  if (f?.status !== 'paid') return null
  if (typeof f.amount_paid !== 'number' || f.amount_paid <= 0) return null
  if (typeof f.post_payment_credit_notes_amount === 'number' && f.post_payment_credit_notes_amount > 0) return null
  const payeeLe = f.status_transitions?.paid_at
  if (typeof payeeLe !== 'number' || payeeLe <= 0) return null
  const bornes = [sub.canceled_at, sub.ended_at].filter((t): t is number => typeof t === 'number' && t > 0)
  if (!bornes.length || payeeLe <= Math.max(...bornes)) return null
  const lignes = f.lines?.data
  if (Array.isArray(lignes)) {
    const fins = lignes
      .filter(l => typeof l.amount === 'number' && l.amount > 0)
      .map(l => l.period?.end)
      .filter((e): e is number => typeof e === 'number' && e > 0)
    return fins.length ? Math.max(...fins) : null
  }
  return finPeriodeAbonnement(sub)
}

type ItemPrix = {
  quantity?: number | null
  price?: { unit_amount?: number | null; currency?: string | null } | null
  discounts?: unknown[] | null
}

/**
 * Prix d'une periode d'apres les items d'un abonnement brut, AVANT remise :
 * somme des unit_amount x quantity (quantite 1 par defaut). null si aucun
 * item, si un prix unitaire manque (palier, usage) ou si les devises
 * different : on n'affiche jamais un montant devine.
 */
export function montantPeriodeAbonnement(sub: Record<string, unknown>): { centimes: number; devise: string } | null {
  const items = (sub.items as { data?: ItemPrix[] } | undefined)?.data ?? []
  if (!items.length) return null
  let centimes = 0
  let devise: string | null = null
  for (const i of items) {
    const unitaire = i.price?.unit_amount
    const cur = String(i.price?.currency ?? '').toLowerCase()
    if (typeof unitaire !== 'number' || !cur) return null
    if (devise && devise !== cur) return null
    devise = cur
    const quantite = typeof i.quantity === 'number' && i.quantity >= 0 ? i.quantity : 1
    centimes += unitaire * quantite
  }
  return devise ? { centimes, devise } : null
}

/** Une remise est posee : discounts (API recente) ou discount (ancienne), sur l'abonnement ou un item. */
export function abonnementARemise(sub: Record<string, unknown>): boolean {
  const posee = (v: unknown) => (Array.isArray(v) && v.length > 0) || Boolean(v && typeof v === 'object' && !Array.isArray(v))
  if (posee(sub.discounts) || posee(sub.discount)) return true
  const items = (sub.items as { data?: ItemPrix[] } | undefined)?.data ?? []
  return items.some(i => posee(i.discounts))
}

/**
 * 4900 + 'eur' -> '49 €', 4990 -> '49,90 €'. Autre devise : code en
 * majuscules apres le montant ('49 USD').
 */
export function formaterMontant(centimes: number, devise: string): string {
  const entier = Number.isInteger(centimes / 100)
  const nombre = entier ? String(centimes / 100) : (centimes / 100).toFixed(2).replace('.', ',')
  const d = devise.toLowerCase()
  return d === 'eur' ? `${nombre} €` : `${nombre} ${d.toUpperCase()}`
}

const INTERVALLES_FR: Record<string, [string, string]> = {
  day: ['jour', 'jours'], week: ['semaine', 'semaines'], month: ['mois', 'mois'], year: ['an', 'ans'],
}

/**
 * La periode du prix du premier item (price.recurring) : « mois », « 3 mois »,
 * « an ». null si le prix n'est pas recurrent ou illisible.
 */
export function periodiciteAbonnement(sub: Record<string, unknown>): string | null {
  const items = (sub.items as { data?: { price?: { recurring?: { interval?: unknown; interval_count?: unknown } | null } | null }[] } | undefined)?.data ?? []
  const r = items[0]?.price?.recurring
  const noms = INTERVALLES_FR[String(r?.interval ?? '')]
  if (!noms) return null
  const n = typeof r?.interval_count === 'number' && Number.isInteger(r.interval_count) && r.interval_count > 0 ? r.interval_count : 1
  return n === 1 ? noms[0] : `${n} ${noms[1]}`
}

/**
 * Resume d'un abonnement Stripe brut (latest_invoice expand ou non). null si
 * aucun de ses items ne porte un des produits donnes : ce n'est pas un
 * abonnement Live Club.
 */
export function resumerAbonnement(
  sub: Record<string, unknown>,
  produits: readonly string[],
): AbonnementResume | null {
  const items = (sub.items as { data?: { price?: { product?: unknown } }[] } | undefined)?.data ?? []
  const produit = items
    .map(i => {
      const p = i.price?.product
      return typeof p === 'string' ? p : (p as { id?: string } | undefined)?.id
    })
    .find((p): p is string => Boolean(p && produits.includes(p)))
  if (!produit) return null

  const pause = sub.pause_collection as { resumes_at?: number | null } | null | undefined
  const pauseActive = Boolean(pause)
    && (pause?.resumes_at == null || pause.resumes_at * 1000 > Date.now())

  const facture = sub.latest_invoice && typeof sub.latest_invoice === 'object'
    ? sub.latest_invoice as { status?: string; created?: number; status_transitions?: { paid_at?: number | null; finalized_at?: number | null } }
    : null
  const derniereFacture = facture
    ? {
      statut: String(facture.status ?? ''),
      payeeLe: isoDepuisSec(facture.status_transitions?.paid_at),
      finaliseeLe: isoDepuisSec(facture.status_transitions?.finalized_at) ?? isoDepuisSec(facture.created),
    }
    : null

  const client = typeof sub.customer === 'string'
    ? sub.customer
    : (sub.customer as { id?: string } | null | undefined)?.id ?? null

  const finPayee = pauseActive ? finPayeeNotee(sub) : null
  const repriseSec = typeof pause?.resumes_at === 'number' ? pause.resumes_at : null

  return {
    id: String(sub.id ?? ''),
    statut: String(sub.status ?? ''),
    finPeriode: isoDepuisSec(finPeriodeAbonnement(sub)),
    arretPrevu: sub.cancel_at_period_end === true || typeof sub.cancel_at === 'number',
    pauseJusquau: isoDepuisSec(pause?.resumes_at),
    pauseActive,
    pauseEffective: finPayee !== null && finPayee * 1000 <= Date.now(),
    pausePayeJusquau: isoDepuisSec(finPayee),
    pauseADater: pauseActive && (finPayee === null || !sceauValable(sub, repriseSec)),
    metaPauseRestante: !pauseActive && porteMetadonneesPause(sub),
    produit,
    clientStripe: client,
    termineLe: isoDepuisSec(sub.ended_at),
    payeJusquau: isoDepuisSec(finPayeeTerminee(sub)),
    derniereFacture,
    montantPeriode: montantPeriodeAbonnement(sub),
    aRemise: abonnementARemise(sub),
    periodicite: periodiciteAbonnement(sub),
    prelevementAuto: sub.collection_method !== 'send_invoice',
    debutLe: isoDepuisSec(sub.start_date) ?? isoDepuisSec(sub.created),
    creeLe: isoDepuisSec(sub.created),
  }
}

/**
 * L'abonnement ouvre-t-il le groupe a cet instant ? Statut vivant ET pas en
 * pause effective (une pause laisse 'active' chez Stripe), OU abonnement
 * termine dont la derniere facture, payee apres la resiliation, couvre encore
 * cet instant (payeJusquau).
 *
 * Impayes (Brice, 30/09) : un abonnement past_due ou unpaid dont les
 * factures ouvertes sont lues (impaye) n'ouvre le groupe que pendant les 5
 * jours qui suivent le premier echec (etatImpaye 'grace'), puis plus du tout.
 * Factures pas lues, illisibles ou sans facture ouverte datable : l'ancienne
 * regle (past_due garde le groupe, unpaid non).
 */
export function abonnementOuvreLeGroupeLe(a: AbonnementResume, maintenantMs: number): boolean {
  if (a.pauseEffective) return false
  const impaye = etatImpaye(a, maintenantMs)
  if (impaye === 'grace') return true
  if (impaye === 'suspendu' || impaye === 'fenetre_depassee') return false
  if (statutDonneDroit(a.statut)) return true
  if (!statutTermine(a.statut) || !a.payeJusquau) return false
  const fin = Date.parse(a.payeJusquau)
  return Number.isFinite(fin) && fin > maintenantMs
}

/**
 * Meme chose, maintenant. Un seul parametre, expres : elle sert de callback
 * (.some, .filter) et l'index du tableau ne doit pas devenir une date.
 */
export function abonnementOuvreLeGroupe(a: AbonnementResume): boolean {
  return abonnementOuvreLeGroupeLe(a, Date.now())
}

/**
 * Fin du droit que donne l'abonnement (ISO) : la fin payee pour un
 * abonnement termine, la fin de la periode en cours sinon. Paiement en retard
 * encore dans ses 5 jours (Brice, 30/09) : la fin de ces 5 jours.
 */
export function finDuDroit(a: AbonnementResume): string | null {
  const grace = finGraceImpaye(a)
  if (grace) return grace
  return statutTermine(a.statut) ? a.payeJusquau : a.finPeriode
}

/** L'abonnement qui ouvre le groupe, le plus lointain en premier. */
export function meilleurAbonnement(
  abonnements: AbonnementResume[],
  maintenantMs: number = Date.now(),
): AbonnementResume | null {
  return abonnements
    .filter(a => abonnementOuvreLeGroupeLe(a, maintenantMs))
    .sort((a, b) => (finDuDroit(b) ?? '').localeCompare(finDuDroit(a) ?? ''))[0] ?? null
}

/**
 * Meme payeur ? Le client Stripe prime, puis l'email, puis le membre.
 */
export function memePayeur(
  ancien: { client_stripe: string | null; email: string | null; membre_id: string | null },
  nouveau: { clientStripe: string | null; email: string | null; membreId: string | null },
): boolean {
  if (nouveau.clientStripe) return ancien.client_stripe === nouveau.clientStripe
  if (nouveau.email) return ancien.email === nouveau.email
  if (nouveau.membreId) return ancien.membre_id === nouveau.membreId
  return false
}

// ---------------------------------------------------------------------------
// Jetons, emails, Telegram
// ---------------------------------------------------------------------------

/** 24 caracteres base64url (18 octets aleatoires), valide comme param de /start. */
export function genererJeton(): string {
  return randomBytes(18).toString('base64url')
}

export function jetonBienForme(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{24}$/.test(s)
}

/** Email en minuscules sans espaces, ou null s'il ne ressemble pas a un email. */
export function normaliserEmail(brut: unknown): string | null {
  const s = String(brut ?? '').trim().toLowerCase()
  if (s.length < 5 || s.length > 254) return null
  return /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[a-z]{2,}$/.test(s) ? s : null
}

/**
 * Requete de GET /v1/customers/search pour un email deja normalise. Le « : »
 * de la recherche Stripe ignore la casse, mais sur un champ texte il accepte
 * aussi un email plus long qui contient les memes mots : l'appelant garde
 * seulement les clients dont l'email, en minuscules, est EXACTEMENT celui-ci.
 */
export function requeteRechercheEmail(emailNormalise: string): string {
  return `email:"${emailNormalise.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Une liste collee (un par ligne, virgules, points-virgules, espaces) -> morceaux non vides. */
export function decouperEmails(texte: string): string[] {
  return texte.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
}

/** Nom d'un lien d'invitation : Telegram le limite a 32 caracteres. */
export function nomLienInvitation(nom: string): string {
  return (nom.trim() || 'Live Club').slice(0, 32)
}

// ---------------------------------------------------------------------------
// Pause proposee avant un arret (Brice, 30/09)
// ---------------------------------------------------------------------------

/** Messages regardes pour savoir si la pause vient d'etre proposee (2 echanges). */
const MESSAGES_PROPOSITION_PAUSE = 4
/** Au-dela, une nouvelle demande d'arret est une nouvelle demande. */
const HEURES_PROPOSITION_PAUSE = 24

/**
 * La pause a-t-elle deja ete proposee pour CETTE demande d'arret ? Vrai si un
 * des derniers messages du bot (4 messages, moins de 24 heures) parle de pause
 * ET de tarif : le texte du serveur (TEXTE_PAUSE_AVANT_ARRET, config.ts) ou
 * l'argument donne par l'agent. Une seule proposition par demande, pas
 * d'insistance : l'arret suivant passe directement a la confirmation.
 */
export function pauseDejaProposee(
  historique: readonly { role: string; content: string; at?: string }[],
  maintenantMs: number = Date.now(),
): boolean {
  return historique.slice(-MESSAGES_PROPOSITION_PAUSE).some(m => {
    if (m.role !== 'assistant' || typeof m.content !== 'string') return false
    const quand = m.at ? Date.parse(m.at) : NaN
    if (Number.isFinite(quand) && maintenantMs - quand > HEURES_PROPOSITION_PAUSE * 3_600_000) return false
    return /pause/i.test(m.content) && /tarif/i.test(m.content)
  })
}

// ---------------------------------------------------------------------------
// Montants du membre (Brice, 30/09) : ce qu'il paie par periode apres remise,
// son prochain prelevement, et ce qui lui reste a regler, pour LUI seul (outil
// mes_montants de l'agent, actions-membre.ts). Rien d'autre ne sort d'ici que
// des montants deja mis en forme, des dates et un lien de paiement : aucun
// identifiant Stripe (client, abonnement, facture, remise), aucun code ni nom
// de coupon.
// ---------------------------------------------------------------------------

export type Montant = { centimes: number; devise: string }

export const MONTANT_NON_DISPONIBLE = 'montant non disponible'
export const LIEN_NON_DISPONIBLE = 'lien non disponible'

/**
 * Un montant Stripe lisible (centimes entiers, 0 ou plus, devise non vide),
 * ou null. Meme lecture que montantAAnnoncer (passage-regles.ts, qui ne peut
 * pas importer ce fichier).
 */
export function lireMontant(centimes: unknown, devise: unknown): Montant | null {
  if (typeof centimes !== 'number' || !Number.isInteger(centimes) || centimes < 0) return null
  if (typeof devise !== 'string' || !devise.trim()) return null
  return { centimes, devise: devise.trim().toLowerCase() }
}

/**
 * Le tarif d'une periode APRES remise et le montant du prochain prelevement,
 * d'apres l'apercu de la prochaine facture (POST /v1/invoices/create_preview,
 * comme le rappel J-3) : `total` (apres remise et taxe) pour le tarif,
 * `amount_due` (apres le solde du client) pour le prelevement. Apercu
 * illisible : le prix des items SEULEMENT si aucune remise n'est posee
 * (Brice, 30/09), sinon null, que le bot dit « montant non disponible ».
 */
export function montantsDeLaPeriode(
  a: AbonnementResume,
  apercu: Record<string, unknown> | null,
): { tarif: Montant | null; prelevement: Montant | null } {
  const total = lireMontant(apercu?.total, apercu?.currency)
  const du = lireMontant(apercu?.amount_due, apercu?.currency)
  if (total || du) return { tarif: total ?? du, prelevement: du ?? total }
  const repli = !a.aRemise && a.montantPeriode ? a.montantPeriode : null
  return { tarif: repli, prelevement: repli }
}

/** Une remise s'applique : posee sur l'abonnement, ou visible dans l'apercu (total_discount_amounts). */
export function remiseAppliquee(a: AbonnementResume, apercu: Record<string, unknown> | null): boolean {
  if (a.aRemise) return true
  const remises = apercu?.total_discount_amounts
  return Array.isArray(remises)
    && remises.some(r => typeof (r as { amount?: unknown } | null)?.amount === 'number' && (r as { amount: number }).amount > 0)
}

/** « par mois », « par an », « tous les 3 mois » : la periode d'un tarif, en francais. */
export function parPeriode(periodicite: string | null): string {
  if (!periodicite) return ''
  if (!/^\d/.test(periodicite)) return `par ${periodicite}`
  return /semaines$/.test(periodicite) ? `toutes les ${periodicite}` : `tous les ${periodicite}`
}

export type FactureARegler = Montant & { lien: string | null; factureLe: string | null }

/**
 * La SELECTION du montant du : dans des factures Stripe brutes (GET
 * /v1/invoices?subscription=...&status=open), celles qui restent a regler :
 * statut 'open' et un reste a payer positif (amount_remaining, pas
 * amount_due : un paiement partiel est deduit). La plus recente d'abord, `max`
 * au plus. Le lien est la page de paiement Stripe (hosted_invoice_url), en
 * https seulement ; aucun identifiant de facture ne sort.
 */
export function facturesARegler(factures: readonly unknown[], max = 3): FactureARegler[] {
  const lues: (FactureARegler & { t: number })[] = []
  for (const brut of factures) {
    const f = brut as { status?: unknown; amount_remaining?: unknown; currency?: unknown; hosted_invoice_url?: unknown; created?: unknown } | null
    if (!f || f.status !== 'open') continue
    const m = lireMontant(f.amount_remaining, f.currency)
    if (!m || m.centimes <= 0) continue
    const lien = typeof f.hosted_invoice_url === 'string' && /^https:\/\/\S+$/.test(f.hosted_invoice_url) ? f.hosted_invoice_url : null
    lues.push({ ...m, lien, factureLe: isoDepuisSec(f.created), t: typeof f.created === 'number' ? f.created : 0 })
  }
  return lues
    .sort((x, y) => y.t - x.t)
    .slice(0, max)
    .map(f => ({ centimes: f.centimes, devise: f.devise, lien: f.lien, factureLe: f.factureLe }))
}

/** Un abonnement ou chercher un reste a regler : paiement en retard (past_due, unpaid) ou derniere facture ouverte. */
export function peutAvoirUnImpaye(a: AbonnementResume): boolean {
  return a.statut === 'past_due' || a.statut === 'unpaid' || a.derniereFacture?.statut === 'open'
}

export type EntreeMontants = {
  /** Un abonnement vivant (active, trialing, past_due) du membre. */
  abonnement: AbonnementResume
  /** L'apercu brut de sa prochaine facture, null s'il est illisible ou absent. */
  apercu: Record<string, unknown> | null
}

export type EntreeImpaye = {
  abonnement: AbonnementResume
  /** Ses factures ouvertes brutes, 'illisible' si la liste n'a pas pu etre lue. */
  factures: readonly unknown[] | 'illisible'
}

export type FaitsMontants = {
  abonnements: {
    statut: 'actif' | 'essai' | 'paiement_en_retard' | 'pause_prevue' | 'en_pause' | 'arret_programme'
    /** « 89 € par mois », ou MONTANT_NON_DISPONIBLE. */
    tarif: string
    /** SA remise s'applique (jamais laquelle, ni son code). */
    remise: boolean
    prochain_prelevement: { date: string; montant: string } | null
    /** Pourquoi il n'y a pas de prochain prelevement. */
    sans_prelevement?: string
  }[]
  /** Ce qui reste a regler, la facture la plus recente d'abord (3 au plus). */
  a_regler: { montant: string; facture_du: string | null; lien: string }[]
  /** Un paiement est en retard mais son montant n'est pas lisible. */
  a_regler_non_disponible?: string
  rien_a_regler?: true
  aucun_abonnement_en_cours?: true
  /**
   * Impaye de plus de 5 jours encore dans la fenetre de 30 jours (Brice,
   * 30/09) : le groupe est ferme, il rouvre des que le paiement passe, au
   * tarif actuel si c'est regle avant cette date.
   */
  acces_au_groupe_suspendu?: true
  acces_rouvre_des_que_le_paiement_passe?: true
  tarif_actuel_garde_si_regle_avant?: string
}

/**
 * Ce que l'outil mes_montants donne au modele, pour le membre qui ecrit :
 * tarif et prochain prelevement de chaque abonnement vivant, et ce qui reste
 * a regler. Montants mis en forme (formaterMontant), dates en francais.
 */
export function faitsMontants(
  vivants: readonly EntreeMontants[],
  impayes: readonly EntreeImpaye[],
  maintenantMs: number = Date.now(),
): FaitsMontants {
  const abonnements = vivants.map(({ abonnement: a, apercu }) => {
    const { tarif, prelevement } = montantsDeLaPeriode(a, apercu)
    const statut: FaitsMontants['abonnements'][number]['statut'] = a.pauseEffective ? 'en_pause'
      : a.pauseActive ? 'pause_prevue'
      : a.arretPrevu ? 'arret_programme'
      : a.statut === 'past_due' ? 'paiement_en_retard'
      : a.statut === 'trialing' ? 'essai'
      : 'actif'
    const periode = parPeriode(a.periodicite)
    const sans = a.arretPrevu ? 'arrêt programmé : plus rien ne sera prélevé'
      : a.pauseEffective ? "en pause : rien n'est prélevé pendant la pause"
      : a.pauseActive ? 'pause prévue : rien ne sera prélevé pendant la pause'
      : !a.prelevementAuto ? 'pas de prélèvement automatique : chaque facture arrive à régler'
      : !a.finPeriode ? 'date du prochain prélèvement inconnue'
      : null
    return {
      statut,
      tarif: tarif ? `${formaterMontant(tarif.centimes, tarif.devise)}${periode ? ` ${periode}` : ''}` : MONTANT_NON_DISPONIBLE,
      remise: remiseAppliquee(a, apercu),
      prochain_prelevement: sans || !a.finPeriode ? null : {
        date: formaterDateFr(a.finPeriode),
        montant: prelevement ? formaterMontant(prelevement.centimes, prelevement.devise) : MONTANT_NON_DISPONIBLE,
      },
      ...(sans ? { sans_prelevement: sans } : {}),
    }
  })

  const aRegler: FaitsMontants['a_regler'] = []
  let nonDisponible = false
  for (const i of impayes) {
    if (i.factures === 'illisible') { nonDisponible = true; continue }
    const factures = facturesARegler(i.factures)
    if (factures.length) {
      for (const f of factures) {
        aRegler.push({
          montant: formaterMontant(f.centimes, f.devise),
          facture_du: f.factureLe ? formaterDateFr(f.factureLe) : null,
          lien: f.lien ?? LIEN_NON_DISPONIBLE,
        })
      }
    } else if (i.abonnement.statut === 'past_due' || i.abonnement.statut === 'unpaid') {
      nonDisponible = true
    }
  }

  const dette = detteOuverte(impayes.map(i => i.abonnement), maintenantMs)
  return {
    abonnements,
    a_regler: aRegler.slice(0, 3),
    ...(nonDisponible ? { a_regler_non_disponible: "un paiement est en retard, mais le montant n'est pas lisible pour le moment" } : {}),
    ...(!aRegler.length && !nonDisponible ? { rien_a_regler: true as const } : {}),
    ...(!abonnements.length ? { aucun_abonnement_en_cours: true as const } : {}),
    ...(dette ? {
      acces_au_groupe_suspendu: true as const,
      acces_rouvre_des_que_le_paiement_passe: true as const,
      tarif_actuel_garde_si_regle_avant: formaterDateFr(dette.limite),
    } : {}),
  }
}

// ---------------------------------------------------------------------------
// Impayes (Brice, 30/09). Le compte Stripe de Melanie marque l'abonnement
// « non paye » (unpaid) quand toutes les relances echouent (environ 14 jours,
// 8 tentatives), facture laissee ouverte : payer cette facture ramene
// l'abonnement a 'active', au meme tarif. Deux delais, comptes depuis le
// PREMIER ECHEC de la facture impayee la plus ancienne encore ouverte :
//   - 5 jours : le droit au groupe tombe (avant, on laisse : carte expiree,
//     decouvert passager), et le passage quotidien sort le membre, sans ban ;
//   - 30 jours : la fenetre de retour se ferme, le passage resilie
//     l'abonnement et annule sa facture ; revenir = nouvel abonnement, au
//     prix du moment.
//
// La date du premier echec n'est pas un champ de la facture Stripe (API
// clover). Pour un prelevement automatique (charge_automatically), la
// premiere tentative de paiement part a la FINALISATION de la facture
// (status_transitions.finalized_at, environ une heure apres sa creation) :
// c'est elle qui echoue la premiere. Repli sur created. Pour une facture
// envoyee (send_invoice), rien n'est preleve : l'echec, c'est l'echeance
// passee sans paiement (due_date), repli sur finalized_at puis created. La
// vraie heure de la tentative ratee vivrait dans les paiements de la facture
// (invoice.payments, puis le PaymentIntent) : deux lectures Stripe de plus par
// facture, pour une difference d'une heure environ.
// ---------------------------------------------------------------------------

/** Jours apres le premier echec pendant lesquels un abonnement en retard ouvre encore le groupe. */
export const JOURS_IMPAYE_SORTIE = 5
/** Jours apres le premier echec pendant lesquels la facture se regle au tarif actuel (fenetre de retour). */
export const JOURS_FENETRE_RETOUR = 30

const JOUR_MS = 86_400_000

type FactureBrute = {
  id?: unknown
  status?: unknown
  collection_method?: unknown
  due_date?: unknown
  created?: unknown
  amount_remaining?: unknown
  status_transitions?: { finalized_at?: unknown; paid_at?: unknown } | null
}

function secondesPositives(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/**
 * Le premier echec d'une facture Stripe brute, en secondes, ou null : voir
 * l'en-tete de la section (finalized_at pour un prelevement automatique,
 * due_date pour une facture envoyee, repli sur created).
 */
export function premierEchecFacture(brut: unknown): number | null {
  if (!brut || typeof brut !== 'object') return null
  const f = brut as FactureBrute
  const finalisee = secondesPositives(f.status_transitions?.finalized_at)
  const creee = secondesPositives(f.created)
  if (f.collection_method === 'send_invoice') return secondesPositives(f.due_date) ?? finalisee ?? creee
  return finalisee ?? creee
}

export type Impaye = {
  /** Premier echec de la facture impayee la plus ancienne encore ouverte (ISO), null = aucune facture ouverte datable. */
  depuis: string | null
  /** Id de cette facture : la cle « une fois par facture » du passage. Jamais montre au membre. */
  factureId: string | null
  /** Ids de toutes les factures ouvertes de l'abonnement : celles a annuler quand la fenetre se ferme. */
  facturesOuvertes: string[]
  /** Ce qui reste a regler, la plus recente d'abord (facturesARegler) : montants et liens de paiement. */
  aRegler: FactureARegler[]
}

/**
 * Les factures ouvertes brutes d'un abonnement (GET /v1/invoices,
 * status=open) -> l'impaye. Une facture ouverte dont le reste a payer est nul
 * (avoir, solde) ne date pas l'impaye.
 */
export function lireImpaye(factures: readonly unknown[]): Impaye {
  let plusAncienne: { t: number; id: string | null } | null = null
  const ouvertes: string[] = []
  for (const brut of factures) {
    if (!brut || typeof brut !== 'object') continue
    const f = brut as FactureBrute
    if (f.status !== 'open') continue
    const id = typeof f.id === 'string' && /^in_[A-Za-z0-9]+$/.test(f.id) ? f.id : null
    if (id) ouvertes.push(id)
    if (typeof f.amount_remaining === 'number' && f.amount_remaining <= 0) continue
    const t = premierEchecFacture(f)
    if (t !== null && (plusAncienne === null || t < plusAncienne.t)) plusAncienne = { t, id }
  }
  return {
    depuis: plusAncienne ? new Date(plusAncienne.t * 1000).toISOString() : null,
    factureId: plusAncienne?.id ?? null,
    facturesOuvertes: ouvertes,
    aRegler: facturesARegler(factures),
  }
}

/** Statuts Stripe d'un paiement en retard, ceux que la regle des impayes regarde. */
export function enRetardDePaiement(statut: string): boolean {
  return statut === 'past_due' || statut === 'unpaid'
}

/**
 * Ou en est l'impaye d'un abonnement, a cet instant :
 * - 'a_jour' : ni past_due ni unpaid ;
 * - 'non_lu' : en retard, factures pas lues (ancienne regle) ;
 * - 'illisible' : en retard, la lecture des factures a echoue (on ne decide rien) ;
 * - 'sans_facture' : en retard, aucune facture ouverte datable (ancienne regle) ;
 * - 'grace' : premier echec il y a 5 jours au plus, le groupe reste ouvert ;
 * - 'suspendu' : plus de 5 jours, 30 au plus : plus de groupe, dette payable au tarif actuel ;
 * - 'fenetre_depassee' : plus de 30 jours : le passage resilie.
 */
export type EtatImpaye = 'a_jour' | 'non_lu' | 'illisible' | 'sans_facture' | 'grace' | 'suspendu' | 'fenetre_depassee'

export function etatImpaye(a: AbonnementResume, maintenantMs: number = Date.now()): EtatImpaye {
  if (!enRetardDePaiement(a.statut)) return 'a_jour'
  if (a.impaye === undefined) return 'non_lu'
  if (a.impaye === 'illisible') return 'illisible'
  if (!a.impaye.depuis) return 'sans_facture'
  const ecoule = maintenantMs - Date.parse(a.impaye.depuis)
  if (!Number.isFinite(ecoule)) return 'illisible'
  if (ecoule <= JOURS_IMPAYE_SORTIE * JOUR_MS) return 'grace'
  if (ecoule <= JOURS_FENETRE_RETOUR * JOUR_MS) return 'suspendu'
  return 'fenetre_depassee'
}

function depuisImpaye(a: AbonnementResume): number | null {
  if (!enRetardDePaiement(a.statut) || !a.impaye || a.impaye === 'illisible' || !a.impaye.depuis) return null
  const t = Date.parse(a.impaye.depuis)
  return Number.isFinite(t) ? t : null
}

/** Jours pleins depuis le premier echec (arrondi par defaut), null si l'impaye n'est pas date. */
export function joursDepuisPremierEchec(a: AbonnementResume, maintenantMs: number = Date.now()): number | null {
  const t = depuisImpaye(a)
  return t === null ? null : Math.floor((maintenantMs - t) / JOUR_MS)
}

/** Fin des 5 jours ou le groupe reste ouvert (ISO), null si l'impaye n'est pas date. */
export function finGraceImpaye(a: AbonnementResume): string | null {
  const t = depuisImpaye(a)
  return t === null ? null : new Date(t + JOURS_IMPAYE_SORTIE * JOUR_MS).toISOString()
}

/** Fin de la fenetre de retour au tarif actuel (ISO), null si l'impaye n'est pas date. */
export function limiteFenetreImpaye(a: AbonnementResume): string | null {
  const t = depuisImpaye(a)
  return t === null ? null : new Date(t + JOURS_FENETRE_RETOUR * JOUR_MS).toISOString()
}

export type Dette = {
  /** Premier echec (ISO). */
  depuis: string
  /** Fin de la fenetre de retour au tarif actuel (ISO) : premier echec + 30 jours. */
  limite: string
  /** Ce qui reste a regler, la plus recente d'abord (3 au plus). */
  aRegler: FactureARegler[]
}

/**
 * « La dette d'abord » (Brice, 30/09) : parmi les abonnements d'un payeur,
 * ceux dont l'acces est suspendu pour un impaye ENCORE dans la fenetre de 30
 * jours, avec ce qui reste a regler. null s'il n'y en a pas (ou plus : au-dela
 * de 30 jours, la facture est annulee, et on propose un nouvel abonnement).
 */
export function detteOuverte(abonnements: readonly AbonnementResume[], maintenantMs: number = Date.now()): Dette | null {
  let depuis: number | null = null
  const factures: FactureARegler[] = []
  // Le meme abonnement peut arriver deux fois (lu par le client, puis par l'email).
  const vus = new Set<string>()
  for (const a of abonnements) {
    if (vus.has(a.id)) continue
    vus.add(a.id)
    if (etatImpaye(a, maintenantMs) !== 'suspendu') continue
    const t = depuisImpaye(a)
    if (t === null || !a.impaye || a.impaye === 'illisible') continue
    if (depuis === null || t < depuis) depuis = t
    factures.push(...a.impaye.aRegler)
  }
  if (depuis === null || !factures.length) return null
  const aRegler = [...factures]
    .sort((x, y) => (y.factureLe ?? '').localeCompare(x.factureLe ?? ''))
    .slice(0, 3)
  return {
    depuis: new Date(depuis).toISOString(),
    limite: new Date(depuis + JOURS_FENETRE_RETOUR * JOUR_MS).toISOString(),
    aRegler,
  }
}

/**
 * Les lignes « ce qui reste a regler » d'un message, montants compris. Une
 * facture : une phrase, et son lien si lienDansLeTexte (sinon l'appelant le
 * met sur un bouton). Plusieurs : une ligne par facture, lien compris. Rien a
 * regler : chaine vide.
 */
export function phraseARegler(aRegler: readonly FactureARegler[], o: { lienDansLeTexte: boolean }): string {
  if (!aRegler.length) return ''
  const facture = (f: FactureARegler) => (f.factureLe ? ` sur ta facture du ${formaterDateFr(f.factureLe)}` : '')
  if (aRegler.length === 1) {
    const f = aRegler[0]
    const base = `Il reste ${formaterMontant(f.centimes, f.devise)} à régler${facture(f)}.`
    if (!o.lienDansLeTexte) return base
    return f.lien ? `${base} Tu peux la régler ici : ${f.lien}` : `${base} Le lien de paiement n'est pas disponible là, tout de suite.`
  }
  const lignes = aRegler.map(f => {
    const quand = f.factureLe ? `, facture du ${formaterDateFr(f.factureLe)}` : ''
    return `- ${formaterMontant(f.centimes, f.devise)}${quand} : ${f.lien ?? LIEN_NON_DISPONIBLE}`
  })
  return `Il reste à régler :\n${lignes.join('\n')}`
}

/**
 * Ce que le bot dit a un payeur dont l'acces est suspendu pour un impaye
 * encore ouvert (point 4 de Brice, 30/09) : le montant et le lien de sa
 * facture, « regle-la et ton acces rouvre tout seul, a ton tarif actuel »,
 * AU LIEU d'un nouvel abonnement. Ton neutre, jamais de relance.
 */
export function texteDette(d: Dette): string {
  const plusieurs = d.aRegler.length > 1
  return [
    "Ton dernier paiement pour le Live Club n'est pas passé, et ça fait plus de 5 jours : ton abonnement ne t'ouvre plus le groupe pour le moment.",
    phraseARegler(d.aRegler, { lienDansLeTexte: true }),
    `${plusieurs ? 'Règle-les' : 'Règle-la'} et ton accès rouvre tout seul, à ton tarif actuel (si c'est réglé avant le ${formaterDateFr(d.limite)}). `
      + `Dès que c'est fait, écris-moi /menu : je te redonne le lien du groupe tout de suite.`,
  ].join('\n\n')
}

/**
 * La phrase « Mon abonnement » d'un abonnement en retard de paiement, selon
 * son etat (null = pas de regle des impayes : l'appelant garde sa phrase).
 * portailCarte : le portail Stripe du compte (config.ts), passe en parametre
 * parce que ce module n'importe rien.
 */
export function phraseImpaye(a: AbonnementResume, maintenantMs: number, portailCarte: string): string | null {
  const etat = etatImpaye(a, maintenantMs)
  if (etat === 'grace') {
    const fin = finGraceImpaye(a)
    const suite = a.statut === 'past_due'
      ? `Il va être retenté tout seul : vérifie ta carte, tu peux la changer sur ${portailCarte}.`
      : phraseARegler(a.impaye && a.impaye !== 'illisible' ? a.impaye.aRegler : [], { lienDansLeTexte: true })
    return [`Ton dernier paiement n'est pas passé.`, suite, `Tu gardes le groupe jusqu'au ${fin ? formaterDateFr(fin) : '?'}.`]
      .filter(Boolean).join(' ')
  }
  if (etat === 'suspendu') {
    const d = detteOuverte([a], maintenantMs)
    return d ? texteDette(d) : "Ton dernier paiement pour le Live Club n'est pas passé, et ça fait plus de 5 jours : ton abonnement ne t'ouvre plus le groupe pour le moment."
  }
  if (etat === 'fenetre_depassee') {
    return "Ton dernier paiement pour le Live Club n'a pas été réglé dans les 30 jours : ton abonnement ne t'ouvre plus le groupe, et pour revenir, c'est un nouvel abonnement."
  }
  return null
}

/**
 * Les faits bruts de l'impaye pour l'agent (outil mon_abonnement) : montants
 * deja mis en forme, dates en francais, liens de paiement. Rien sur un
 * abonnement a jour.
 */
export function faitsImpaye(a: AbonnementResume, maintenantMs: number = Date.now()): Record<string, unknown> {
  const etat = etatImpaye(a, maintenantMs)
  if (etat === 'grace') {
    const fin = finGraceImpaye(a)
    return { paiement_en_retard: true, groupe_garde_jusquau: fin ? formaterDateFr(fin) : null }
  }
  if (etat === 'suspendu') {
    const d = detteOuverte([a], maintenantMs)
    return {
      paiement_en_retard: true,
      acces_au_groupe_suspendu: true,
      a_regler: (d?.aRegler ?? []).map(f => ({
        montant: formaterMontant(f.centimes, f.devise),
        facture_du: f.factureLe ? formaterDateFr(f.factureLe) : null,
        lien: f.lien ?? LIEN_NON_DISPONIBLE,
      })),
      acces_rouvre_des_que_le_paiement_passe: true,
      tarif_actuel_garde_si_regle_avant: d ? formaterDateFr(d.limite) : null,
    }
  }
  if (etat === 'fenetre_depassee') {
    return { paiement_en_retard: true, acces_au_groupe_suspendu: true, fenetre_de_30_jours_depassee: true, revenir: 'nouvel abonnement' }
  }
  return {}
}

// ---------------------------------------------------------------------------
// Les gestes du bot dans le fil Support (Brice, 30/09) : une ligne courte et
// lisible par geste 'fait' ou 'refuse' du journal (cockpit_liveclub_gestes).
// Elle ne lit que le geste, la regle et des DATES des details : jamais un
// lien, un jeton, un code ni un email (le journal n'en porte pas, et la ligne
// passe encore par nettoyerPourSupport).
// ---------------------------------------------------------------------------

/**
 * Remplace les liens d'invitation Telegram d'un texte avant de le conserver
 * (historique de conversation, fil Support) : le lien part a l'humain, pas en
 * base. Ici depuis le 30/09 (stripe-actions.ts le reexporte).
 */
export function expurgerLiensInvitation(texte: string): string {
  return texte.replace(/https?:\/\/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)\S+/gi, '[lien transmis]')
}

/** Pourquoi un droit est ouvert (droits.ts, raison), en francais. */
const RAISONS_DROIT: Record<string, string> = {
  abonnement: 'abonnement', exemption: 'exemption', acces_broker: 'accès broker', acces_manuel: 'accès manuel',
}

/** Motifs d'un refus de sortie (retirerDuLiveClub, passage quotidien). */
const MOTIFS_REFUS: Record<string, string> = {
  exempte: 'membre exempté', admin_du_groupe: 'administrateur du groupe', absent_du_groupe: "déjà hors du groupe",
  plafond_passage: 'plafond du passage atteint, reportée',
}

export type GesteLu = {
  geste: string
  resultat: string
  regle: string | null
  details?: Record<string, unknown> | null
}

/**
 * La ligne « [système] » d'un geste du bot (sans le prefixe), ou null s'il
 * ne va pas au fil : 'simule' et 'echec' restent dans le journal. Une regle
 * inconnue garde une ligne generique, jamais le code brut d'un detail.
 */
export function phraseGeste(g: GesteLu): string | null {
  if (g.resultat !== 'fait' && g.resultat !== 'refuse') return null
  const d = g.details ?? {}
  const date = (champ: string): string | null => {
    const v = d[champ]
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? formaterDateFr(v) : null
  }
  const fait = g.resultat === 'fait'
  const regle = g.regle ?? ''
  const raison = RAISONS_DROIT[regle]
  const motif = MOTIFS_REFUS[regle]

  switch (g.geste) {
    case 'entree_acceptee':
      if (!fait) return regle === 'plus_de_demande' ? "Plus de demande d'adhésion en attente." : "Entrée dans le groupe non acceptée."
      return `Entrée dans le groupe acceptée${raison ? ` (${raison})` : ''}${d.reprise ? ', demande en attente reprise' : ''}.`
    case 'entree_refusee':
      if (fait && regle === 'impaye_ouvert') return 'Entrée dans le groupe refusée (paiement en retard, facture à régler).'
      return fait ? "Entrée dans le groupe refusée (pas de droit ouvert)." : "Refus d'entrée non appliqué."
    case 'invitation': {
      const canal = d.canal === 'email' ? ' par email' : ''
      if (!fait) {
        if (regle === 'jeton_invalide') return 'Lien personnel expiré ou déjà utilisé.'
        if (regle === 'deja_dans_le_groupe') return 'Lien personnel ouvert : déjà dans le groupe.'
        if (regle === 'sans_droit') return "Lien personnel ouvert : pas d'abonnement actif."
        if (regle === 'impaye_ouvert') return 'Lien vers le groupe non envoyé : paiement en retard, facture à régler.'
        if (regle === 'reouverture_impaye') return 'Paiement passé : déjà revenu dans le groupe.'
        return 'Lien vers le groupe non envoyé.'
      }
      if (regle === 'retour_groupe') return 'Lien de retour vers le groupe envoyé.'
      if (regle === 'sortie_abusive_metricgram') return 'Bannissement levé, lien de retour envoyé.'
      if (regle === 'broker_renvoi') return "Lien d'accès broker renvoyé par email."
      if (regle === 'reouverture_impaye') return `Paiement passé : accès réouvert, lien de retour envoyé${canal}.`
      if (regle === 'bienvenue_rattrapage') return 'Email de bienvenue envoyé (rattrapage du passage quotidien).'
      return `Lien d'entrée dans le groupe envoyé${raison ? ` (${raison})` : ''}.`
    }
    case 'reintegration':
      if (!fait) return `Réintégration non faite${motif ? ` (${motif})` : ''}.`
      return regle === 'payeur_banni' ? 'Ancien blocage du groupe levé (droit ouvert).' : "Réintégré dans le groupe par l'équipe."
    case 'retrait':
      if (!fait) return `Sortie du groupe non faite${motif ? ` (${motif})` : ''}.`
      if (regle === 'desabonne') return 'Sortie du groupe (abonnement terminé).'
      if (regle === 'impaye_5j') return 'Sortie du groupe (paiement en retard depuis plus de 5 jours).'
      return "Sorti du groupe par l'équipe."
    case 'fin_acces':
      return fait ? "Sortie du groupe (fin d'accès broker)." : `Sortie de fin d'accès broker non faite${motif ? ` (${motif})` : ''}.`
    case 'pause': {
      if (!fait) return `Pause non posée${motif ? ` (${motif})` : ''}.`
      if (regle === 'pause_effective' || regle === 'pause_resortie') return 'Sortie du groupe (début de la pause).'
      if (regle === 'pause_adoptee') return 'Pause posée hors du bot, prise en compte.'
      const reprise = date('reprise_le')
      const jusqua = date('paye_jusquau')
      if (regle === 'manuel') return `Pause programmée par l'équipe${reprise ? `, reprise le ${reprise}` : ''}.`
      return `Pause programmée${jusqua ? `, groupe gardé jusqu'au ${jusqua}` : ''}${reprise ? `, reprise le ${reprise}` : ''}.`
    }
    case 'arret': {
      if (regle === 'fenetre_30j') {
        if (!fait) return 'Abonnement non arrêté : sa situation a changé entre-temps (paiement passé, ou déjà terminé).'
        const nonAnnulees = Number(d.factures_non_annulees ?? 0)
        return `Abonnement arrêté : paiement en retard depuis plus de 30 jours, ${nonAnnulees > 0 ? 'facture pas encore annulée' : 'facture annulée'}.`
      }
      if (!fait) return 'Arrêt non programmé.'
      const fin = date('fin')
      return `Arrêt programmé${fin ? ` au ${fin}` : ' à la fin de la période payée'}${regle === 'manuel' ? " par l'équipe" : ''}.`
    }
    case 'arret_annule':
      return fait ? "Arrêt annulé : l'abonnement continue." : 'Annulation de l\'arrêt non faite.'
    case 'reprise':
      if (!fait) return regle === 'pause_sans_reprise' ? 'Pause sans date de reprise : pas de retour automatique.' : 'Retour après la pause non fait.'
      if (regle === 'pause_deja_revenu') return 'Retour après la pause : déjà revenu dans le groupe.'
      return 'Retour après la pause : lien de retour envoyé.'
    case 'rappel': {
      if (!fait) return 'Rappel non envoyé.'
      const canal = d.canal === 'email' ? ' par email' : ''
      if (regle === 'prelevement_j3') {
        const jour = date('jour_annonce') ?? date('echeance')
        return `Rappel J-3 envoyé${canal}${jour ? ` (prélèvement du ${jour})` : ''}.`
      }
      if (regle === 'pause_j7') return `Rappel de fin de pause envoyé${canal} (J-7).`
      if (regle === 'pause_debut') return `Message de début de pause envoyé${canal}.`
      if (regle === 'sortie_desabonne') return `Message de fin d'abonnement envoyé${canal}.`
      if (regle === 'sortie_impaye') return `Message de sortie pour paiement en retard envoyé${canal} (montant et lien de la facture).`
      if (regle === 'fin_fenetre_30j') return `Message de fin d'abonnement (paiement en retard de plus de 30 jours) envoyé${canal}.`
      if (regle === 'broker_j7') return `Rappel de fin d'accès broker envoyé${canal} (J-7).`
      if (regle === 'broker_fin_message') return `Message de fin d'accès broker envoyé${canal}.`
      return `Rappel envoyé${canal}.`
    }
    case 'refus':
      if (regle === 'sortie_abusive_metricgram') return 'Sortie par Metricgram repérée (droit ouvert).'
      return 'Refus noté par le bot.'
    case 'acces_broker': {
      const jusqua = date('jusquau')
      return fait ? `Accès broker ouvert${jusqua ? ` jusqu'au ${jusqua}` : ''}.` : 'Accès broker non ouvert.'
    }
    default:
      return fait ? 'Geste du bot fait.' : 'Geste du bot refusé.'
  }
}

// ---------------------------------------------------------------------------
// Libelles des boutons pour le fil Support (Brice, 30/09 : toute la
// conversation du bot se lit dans le cockpit). Memes textes que les claviers
// d'actions-membre.ts. Jamais le nonce d'une confirmation.
// ---------------------------------------------------------------------------

const LIBELLES_BOUTONS: Record<string, string> = {
  'm:abo': 'Mon abonnement',
  'm:pause': 'Mettre en pause',
  'm:arret': 'Arrêter',
  'm:arret_ok': "J'arrête quand même",
  'm:annuler': 'Annuler un arrêt prévu',
  'm:equipe': "Contacter l'équipe",
  'v:email': "J'ai payé : vérifier mon email",
}

/** Le libelle lisible d'un callback_data (« Mon abonnement », « Pause de 3 mois », « Oui, je confirme »). */
export function libelleBouton(data: string): string {
  const connu = LIBELLES_BOUTONS[data]
  if (connu) return connu
  const pause = /^p:([1-6])$/.exec(data)
  if (pause) return `Pause de ${pause[1]} mois`
  if (/^c:/.test(data)) return 'Oui, je confirme'
  if (/^x:/.test(data)) return 'Non, laisse tomber'
  return 'bouton inconnu'
}

/** callback_data : 1 a 64 octets (limite Telegram). */
export function callbackDataValide(s: string): boolean {
  const n = new TextEncoder().encode(s).length
  return n >= 1 && n <= 64
}

export function echapperHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Le code Postgres « table absente » (42P01), ou son message. */
export function relationAbsente(err: unknown): boolean {
  return /42P01|relation .* does not exist/i.test(err instanceof Error ? err.message : String(err))
}

export function messageErreur(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200)
}
