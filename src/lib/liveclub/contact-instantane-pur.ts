// LES MEMBRES A CONTACTER, LUS DANS L'INSTANTANE DU MATIN (02/11/2026).
//
// La base Nano est tombee le 02/11 : les vues cockpit_membres_risque et
// cockpit_membres_a_venir coutent environ 1,1 s et 70 000 blocs par lecture.
// La migration 20261102150000 les fige une fois par jour dans deux tables,
// <vue>_instantane (memes colonnes, plus calcule_le), refaites par
// cockpit_membres_contact_recalculer(), avec l'heure du calcul dans
// cockpit_instantanes. Ici, la regle pure du choix de la source.
//
// Regle : l'instantane sert s'il existe et date de moins de 30 h (le cron
// tourne chaque matin a 7 h UTC : 30 h laissent passer un matin en retard,
// pas un jour entier sans calcul). Sinon on relit la vue en direct : migration
// pas encore passee, fonction en echec, cron arrete. L'ordre de mise en ligne
// ne casse donc rien. Miroir cote cockpit : apps/cockpit/src/views/membres/
// MembresRisque.tsx (FRAICHEUR_INSTANTANE_MS), a garder d'accord.

/** Au-dela, l'instantane est juge perime et on relit la vue. */
export const FRAICHEUR_INSTANTANE_MS = 30 * 3600_000

/** Suffixe des tables instantane : cockpit_membres_risque -> cockpit_membres_risque_instantane. */
export const SUFFIXE_INSTANTANE = '_instantane'

export type EtatInstantane = {
  /** Les tables et cockpit_instantanes existent (to_regclass). */
  existe: boolean
  /** cockpit_instantanes.calcule_le de la vue, ou null si jamais calcule. */
  calculeLe: Date | string | null
}

/**
 * Le suffixe a coller au nom de la vue : '_instantane' si l'instantane est
 * la et frais, '' (la vue en direct) sinon. Seules deux valeurs possibles :
 * le suffixe entre dans le SQL tel quel (Prisma.raw), jamais une saisie.
 */
export function suffixeSource(e: EtatInstantane, maintenant: number = Date.now()): '' | typeof SUFFIXE_INSTANTANE {
  if (!e.existe || e.calculeLe === null) return ''
  const t = e.calculeLe instanceof Date ? e.calculeLe.getTime() : Date.parse(e.calculeLe)
  if (!Number.isFinite(t)) return ''
  // Une date dans le futur (horloges decalees) reste acceptee jusqu'a 30 h.
  return Math.abs(maintenant - t) <= FRAICHEUR_INSTANTANE_MS ? SUFFIXE_INSTANTANE : ''
}
