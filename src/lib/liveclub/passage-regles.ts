// Regles PURES du passage quotidien du Live Club (29/09) : qui est a
// prevenir, a sortir ou a faire revenir, a partir de ce que Stripe et la base
// disent. Aucune base, aucun reseau, aucun import de valeur (seulement des
// types, effaces par Node) : scripts de verification lancables avec Node 22
// seul, comme pur.ts.

import type { AbonnementResume } from './pur'

const JOUR_MS = 86_400_000

/** Rappels envoyes dans les 7 jours qui precedent l'echeance (rattrapage si un passage a saute). */
export const FENETRE_RAPPEL_JOURS = 7
/** Un acces broker fini depuis plus longtemps n'est plus regarde (il ne peut plus rentrer). */
export const FENETRE_FIN_BROKER_JOURS = 60

/** Jours UTC pleins de `depuis` a `jusqua` (negatif si `jusqua` est passe). */
function jours(depuis: Date, jusqua: string): number {
  const a = Date.parse(`${depuis.toISOString().slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${jusqua.slice(0, 10)}T00:00:00Z`)
  return Math.round((b - a) / JOUR_MS)
}

function vivant(statut: string): boolean {
  return statut === 'active' || statut === 'trialing' || statut === 'past_due'
}

function termine(statut: string): boolean {
  return statut === 'canceled' || statut === 'unpaid' || statut === 'incomplete_expired'
}

// ---------------------------------------------------------------------------
// Pauses
// ---------------------------------------------------------------------------

/**
 * La pause a commence (periode payee finie, facture annulee) sur un
 * abonnement encore vivant chez Stripe : le membre n'a plus acces au groupe.
 */
export function pauseASortir(a: AbonnementResume): boolean {
  return a.pauseEffective && vivant(a.statut)
}

/** Date de reprise 'YYYY-MM-DD' si la reprise tombe dans les 7 prochains jours, sinon null. */
export function repriseAPrevenir(a: AbonnementResume, maintenant: Date): string | null {
  if (!a.pauseActive || !a.pauseJusquau || a.arretPrevu || !vivant(a.statut)) return null
  const n = jours(maintenant, a.pauseJusquau)
  return n >= 0 && n <= FENETRE_RAPPEL_JOURS ? a.pauseJusquau.slice(0, 10) : null
}

/**
 * Les prelevements ont repris apres une sortie pour pause : abonnement actif,
 * plus de pause posee, et la derniere facture payee APRES la sortie (pendant
 * la pause, toutes les factures sont annulees : une facture payee plus tard
 * prouve la reprise, qu'elle soit venue a la date prevue ou plus tot).
 */
export function repriseFaite(a: AbonnementResume, sortiLe: Date): boolean {
  if (a.statut !== 'active' && a.statut !== 'trialing') return false
  if (a.pauseActive) return false
  const f = a.derniereFacture
  if (!f || f.statut !== 'paid' || !f.payeeLe) return false
  return Date.parse(f.payeeLe) > sortiLe.getTime()
}

// ---------------------------------------------------------------------------
// Desabonnes
// ---------------------------------------------------------------------------

/**
 * Date de fin retenue pour la grace : ended_at, sinon la fin de la derniere
 * periode (incomplete_expired sans ended_at). null = on ne sait pas, on ne
 * sort personne.
 *
 * « Ce qui est paye est du » (Brice, 29/09) : si la derniere facture est
 * payee APRES la resiliation (paiement en retard, voir finPayeeTerminee) et
 * couvre une periode qui finit apres cette date, la fin retenue est la fin de cette periode payee
 * (payeJusquau). La grace part donc de max(fin, fin payee). payeJusquau ne
 * remplace jamais une fin inconnue : sans fin datee, on ne sort toujours
 * personne.
 *
 * 'unpaid' a part : l'abonnement reste en place chez Stripe et continue
 * d'emettre des factures (non tentees), donc sa periode avance a chaque cycle
 * et current_period_end tombe presque toujours dans le futur. On date alors
 * sur le debut de la serie de factures impayees (debutImpaye, voir
 * debutSerieImpayee), jamais sur la periode.
 */
export function finAbonnement(a: AbonnementResume, debutImpaye: string | null = null): string | null {
  const fin = a.statut === 'unpaid' ? debutImpaye : a.termineLe ?? a.finPeriode ?? null
  if (!fin || !a.payeJusquau) return fin
  return Date.parse(a.payeJusquau) > Date.parse(fin) ? a.payeJusquau : fin
}

/** Abonnement termine depuis plus de graceJours jours (GRACE_JOURS de config.ts, 7 comme Metricgram). */
export function desabonneHorsGrace(
  a: AbonnementResume,
  maintenant: Date,
  graceJours: number,
  debutImpaye: string | null = null,
): boolean {
  if (!termine(a.statut)) return false
  const fin = finAbonnement(a, debutImpaye)
  if (!fin) return false
  const t = Date.parse(fin)
  return Number.isFinite(t) && maintenant.getTime() - t > graceJours * JOUR_MS
}

export type FactureBreve = { statut: string; creeLe: string | null }

/**
 * Debut de la serie de factures impayees d'un abonnement 'unpaid'. Les
 * factures arrivent de la plus recente a la plus ancienne (ordre de GET
 * /v1/invoices) : on remonte jusqu'a la premiere facture payee et on garde la
 * plus ancienne facture 'open' ou 'uncollectible' vue avant elle. Les
 * factures annulees (void, une pause) et les brouillons sont sautes. null =
 * aucune facture impayee lisible : on ne date pas, on ne sort personne.
 */
export function debutSerieImpayee(factures: FactureBreve[]): string | null {
  let debut: number | null = null
  for (const f of factures) {
    if (f.statut === 'paid') break
    if (f.statut !== 'open' && f.statut !== 'uncollectible') continue
    const t = f.creeLe ? Date.parse(f.creeLe) : NaN
    if (Number.isFinite(t) && (debut === null || t < debut)) debut = t
  }
  return debut === null ? null : new Date(debut).toISOString()
}

// ---------------------------------------------------------------------------
// Rappel avant prelevement (Brice, 29/09) : 3 jours avant chaque prelevement,
// montant et date, et le lien pour mettre sa carte a jour. Une fois par
// echeance (geste 'rappel', regle 'prelevement_j3', details.echeance).
// ---------------------------------------------------------------------------

export const RAPPEL_PRELEVEMENT_JOURS = 3

/** Cle « une fois par echeance » : abonnement + jour du prelevement ('YYYY-MM-DD'). */
export function clePrelevement(abonnementId: string, echeance: string): string {
  return `${abonnementId}:${echeance.slice(0, 10)}`
}

/**
 * Jour du prochain prelevement ('YYYY-MM-DD') s'il faut prevenir aujourd'hui,
 * sinon null. Seulement un abonnement qui va VRAIMENT etre preleve :
 * active ou trialing (past_due est deja en relance chez Stripe), prelevement
 * automatique (pas une facture envoyee), aucune pause posee (programmee ou en
 * cours : les factures sont annulees), aucun arret programme, et un montant
 * connu non nul (coupon a 100 %). La date vient de finPeriode
 * (items.data[].current_period_end, API clover). Fenetre : de J-3 a J-1, pour
 * rattraper un passage qui aurait saute ; l'unicite par echeance vient de
 * dejaFaits (journal) et de la reservation en base.
 */
export function prelevementAPrevenir(
  a: AbonnementResume,
  maintenant: Date,
  dejaFaits: ReadonlySet<string> = new Set(),
): string | null {
  if (a.statut !== 'active' && a.statut !== 'trialing') return null
  if (!a.prelevementAuto || a.pauseActive || a.arretPrevu || !a.finPeriode) return null
  if (a.montantPeriode && a.montantPeriode.centimes === 0 && !a.aRemise) return null
  const n = jours(maintenant, a.finPeriode)
  if (n < 1 || n > RAPPEL_PRELEVEMENT_JOURS) return null
  const echeance = a.finPeriode.slice(0, 10)
  return dejaFaits.has(clePrelevement(a.id, echeance)) ? null : echeance
}

/**
 * Montant a annoncer, en centimes : celui de l'apercu de la prochaine facture
 * (POST /v1/invoices/create_preview, amount_due : apres remise, taxe et
 * solde du client) s'il est lisible. Sans apercu, null : le message ne donne
 * que la date. Pas de repli sur le prix des items : il ignore la taxe, le
 * solde crediteur et une remise posee sur le client, et annoncerait un
 * montant faux.
 */
export function montantAAnnoncer(
  apercu: { amount_due?: unknown; currency?: unknown } | null,
): { centimes: number; devise: string } | null {
  if (apercu && typeof apercu.amount_due === 'number' && apercu.amount_due >= 0 && typeof apercu.currency === 'string' && apercu.currency) {
    return { centimes: apercu.amount_due, devise: apercu.currency.toLowerCase() }
  }
  return null
}

/**
 * Jour ('YYYY-MM-DD') d'un instant a l'heure de Paris : c'est le jour que le
 * membre vit. Un abonnement pris a 0 h 30 a Paris finit sa periode a 22 h 30
 * UTC la veille : le jour UTC annoncerait le prelevement un jour trop tot.
 * La cle « une fois par echeance » reste sur le jour UTC (stable).
 */
export function jourParis(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso.slice(0, 10)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(t))
  const v = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${v('year')}-${v('month')}-${v('day')}`
}

// ---------------------------------------------------------------------------
// Sorties abusives de Metricgram (transition, Brice 29/09)
// ---------------------------------------------------------------------------

/** L'auteur de la sortie (par_qui du webhook) est le bot Metricgram. */
export function sortiParMetricgram(parQui: string | null | undefined): boolean {
  return /metric/i.test(String(parQui ?? ''))
}

/** Cle « une fois par sortie » : compte Telegram + instant de la sortie (ISO). */
export function cleSortieAbusive(telegramId: number, sortiLe: Date | string): string {
  const iso = typeof sortiLe === 'string' ? new Date(sortiLe).toISOString() : sortiLe.toISOString()
  return `${telegramId}:${iso}`
}

/**
 * Le droit d'aujourd'hui existait-il deja au moment de la sortie ? debut =
 * debut de ce droit : start_date de l'abonnement (ISO), debut d'un acces
 * broker ('YYYY-MM-DD', jour entier), pose d'un acces manuel ou d'une
 * exemption (ISO). null ou illisible = 'inconnu', et on ne signale pas. La fin
 * du droit n'est pas relue : un droit qui vaut 'oui' aujourd'hui finit apres
 * aujourd'hui, donc apres la sortie.
 */
export function droitCouvraitLaSortie(debut: string | null | undefined, sortiLe: Date | string): 'oui' | 'non' | 'inconnu' {
  const sortiMs = typeof sortiLe === 'string' ? Date.parse(sortiLe) : sortiLe.getTime()
  if (!debut || !Number.isFinite(sortiMs)) return 'inconnu'
  if (/^\d{4}-\d{2}-\d{2}$/.test(debut)) {
    return debut <= new Date(sortiMs).toISOString().slice(0, 10) ? 'oui' : 'non'
  }
  const t = Date.parse(debut)
  if (!Number.isFinite(t)) return 'inconnu'
  return t <= sortiMs ? 'oui' : 'non'
}

/**
 * Une sortie Metricgram a signaler : le compte est sorti ou banni par le bot
 * Metricgram, n'est pas revenu (presence lue en direct), notre droit vaut
 * 'oui' (abonnement actif, periode payee, exemption, broker, acces manuel)
 * ET ce droit existait deja le jour de la sortie (couverture, voir
 * droitCouvraitLaSortie) : un desabonne sorti a juste titre puis reabonne
 * n'est pas une sortie abusive. Jamais sur un droit ou une couverture
 * 'inconnu', ni sur une presence inconnue ; une fois par sortie (dejaSignales).
 */
export function sortieAbusiveASignaler(
  s: { telegramId: number; sortiLe: Date | string; parQui: string | null },
  presence: 'oui' | 'non' | 'inconnu',
  droit: 'oui' | 'non' | 'inconnu',
  couverture: 'oui' | 'non' | 'inconnu',
  dejaSignales: ReadonlySet<string> = new Set(),
): boolean {
  if (!sortiParMetricgram(s.parQui)) return false
  if (presence !== 'non' || droit !== 'oui' || couverture !== 'oui') return false
  return !dejaSignales.has(cleSortieAbusive(s.telegramId, s.sortiLe))
}

/** Liens de retour automatiques retentes au plus 2 fois apres une panne passagere. */
export const MAX_ESSAIS_RETOUR = 2

/**
 * Le lien de retour d'une sortie abusive deja signalee est-il a retenter ?
 * Seulement apres une panne passagere (echec_levee_ban, echec_lien,
 * echec_envoi, conversations_illisibles, config), au plus MAX_ESSAIS_RETOUR
 * fois. Jamais apres 'envoye', 'bot_jamais_demarre', 'bot_bloque',
 * 'droit_vu_par_email_seul', 'rebanni_metricgram' ni 'en_cours' (un autre
 * passage s'en occupe, ou s'est arrete en route : on ne renvoie pas).
 */
export function retourARetenter(retour: string | null | undefined, essais: number | string | null | undefined): boolean {
  const r = String(retour ?? '')
  if (!/^echec_/.test(r) && r !== 'conversations_illisibles' && r !== 'config') return false
  const n = Number(essais ?? 0)
  return Number.isFinite(n) && n < MAX_ESSAIS_RETOUR
}

// ---------------------------------------------------------------------------
// Acces broker ('YYYY-MM-DD', inclusif : l'acces vaut encore le jour jusquau)
// ---------------------------------------------------------------------------

export function brokerAPrevenir(jusquau: string, maintenant: Date): boolean {
  const n = jours(maintenant, jusquau)
  return n >= 0 && n <= FENETRE_RAPPEL_JOURS
}

export function brokerFini(jusquau: string, maintenant: Date): boolean {
  const n = jours(maintenant, jusquau)
  return n < 0 && -n <= FENETRE_FIN_BROKER_JOURS
}

// ---------------------------------------------------------------------------
// Presence dans le groupe (reponse brute de getChatMember)
// ---------------------------------------------------------------------------

export type Presence = { etat: 'oui' | 'non' | 'inconnu'; statut: string | null }

/**
 * member, restricted dans le groupe = present ; administrator et creator
 * aussi, mais on ne les sort jamais (estIntouchable) ; left, kicked = absent.
 */
export function lirePresence(statut: string | null, estMembre: boolean | undefined): Presence {
  const s = statut || null
  if (s === 'member' || s === 'administrator' || s === 'creator') return { etat: 'oui', statut: s }
  if (s === 'restricted') return { etat: estMembre === true ? 'oui' : 'non', statut: s }
  if (s === 'left' || s === 'kicked') return { etat: 'non', statut: s }
  return { etat: 'inconnu', statut: s }
}

export function estIntouchable(p: Presence): boolean {
  return p.statut === 'administrator' || p.statut === 'creator'
}

// ---------------------------------------------------------------------------
// Plafond de sorties reelles
// ---------------------------------------------------------------------------

/**
 * Compteur des sorties REELLES d'un passage. prendre() dit si une sortie de
 * plus est permise ; au premier refus, premierRefus passe a true une seule
 * fois (l'appelant journalise alors le plafond, puis n'essaie plus).
 */
export class PlafondSorties {
  readonly plafond: number
  faites = 0
  atteint = false
  private refusJournalise = false

  // Pas de propriete de parametre (constructor(readonly x)) : Node 22 ne sait
  // pas l'effacer, et ce fichier doit rester lancable sans compilateur.
  constructor(plafond: number) {
    this.plafond = plafond
  }

  prendre(): { permis: true } | { permis: false; premierRefus: boolean } {
    if (this.faites < this.plafond) {
      this.faites++
      return { permis: true }
    }
    this.atteint = true
    const premierRefus = !this.refusJournalise
    this.refusJournalise = true
    return { permis: false, premierRefus }
  }

  /** Une sortie reservee qui n'a pas eu lieu (refus ou echec Telegram) rend sa place. */
  rendre(): void {
    if (this.faites > 0) this.faites--
  }
}
