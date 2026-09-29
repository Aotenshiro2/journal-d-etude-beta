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
 * 'unpaid' a part : l'abonnement reste en place chez Stripe et continue
 * d'emettre des factures (non tentees), donc sa periode avance a chaque cycle
 * et current_period_end tombe presque toujours dans le futur. On date alors
 * sur le debut de la serie de factures impayees (debutImpaye, voir
 * debutSerieImpayee), jamais sur la periode.
 */
export function finAbonnement(a: AbonnementResume, debutImpaye: string | null = null): string | null {
  if (a.statut === 'unpaid') return debutImpaye
  return a.termineLe ?? a.finPeriode ?? null
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
