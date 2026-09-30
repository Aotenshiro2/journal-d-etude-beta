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
  derniereFacture: { statut: string; payeeLe: string | null } | null
  /**
   * Prix d'une periode d'apres les items (unit_amount x quantity, en
   * centimes), AVANT remise. null si un item n'a pas de prix unitaire (palier,
   * prix a l'usage) ou si les devises different. Voir montantPeriodeAbonnement.
   */
  montantPeriode: { centimes: number; devise: string } | null
  /** Une remise (coupon, code promo) est posee sur l'abonnement ou un de ses items. */
  aRemise: boolean
  /** Stripe preleve tout seul (charge_automatically), pas une facture envoyee a payer. */
  prelevementAuto: boolean
  /**
   * Debut de l'abonnement (start_date, sinon created), ISO. Sert a dire si un
   * droit d'aujourd'hui existait deja a une date passee (sortie Metricgram).
   */
  debutLe: string | null
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
    ? sub.latest_invoice as { status?: string; status_transitions?: { paid_at?: number | null } }
    : null
  const derniereFacture = facture
    ? { statut: String(facture.status ?? ''), payeeLe: isoDepuisSec(facture.status_transitions?.paid_at) }
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
    prelevementAuto: sub.collection_method !== 'send_invoice',
    debutLe: isoDepuisSec(sub.start_date) ?? isoDepuisSec(sub.created),
  }
}

/**
 * L'abonnement ouvre-t-il le groupe a cet instant ? Statut vivant ET pas en
 * pause effective (une pause laisse 'active' chez Stripe), OU abonnement
 * termine dont la derniere facture, payee apres la resiliation, couvre encore
 * cet instant (payeJusquau).
 */
export function abonnementOuvreLeGroupeLe(a: AbonnementResume, maintenantMs: number): boolean {
  if (a.pauseEffective) return false
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
 * abonnement termine, la fin de la periode en cours sinon.
 */
export function finDuDroit(a: AbonnementResume): string | null {
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
