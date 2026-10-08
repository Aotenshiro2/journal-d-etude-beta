// Fonctions PURES de l'agent du Cockpit (08/10) : aucune base, aucun reseau,
// aucun import. scripts/verifier-liveclub.mjs les charge telles quelles.
//
// LES DEMANDES DE L'EQUIPE (Brice, 08/10 : « si elle fait une demande qui
// n'est pas encore prevue dans Cockpit, la demande doit pouvoir remonter
// jusqu'a notre task picker »). L'agent ne developpe pas : il NOTE
// (outil noter_demande, table cockpit_demandes), et la demande s'affiche dans
// l'onglet Support du cockpit, ou Brice la fait passer au task picker.

/** D'ou vient une demande : la fenetre du cockpit, ou Agent AOK sur Telegram. */
export type SourceDemande = 'agent_cockpit' | 'agent_telegram'

/** La demande reformulee : une phrase actionnable. */
export const MAX_TEXTE_DEMANDE = 300
/** La demande telle qu'ecrite (check de la table : 500 caracteres au plus). */
export const MAX_CITATION_DEMANDE = 500

export type DemandeLue = { texte: string; citation: string | null }

/**
 * Les parametres de noter_demande, ou la raison du refus (rendue au modele
 * pour qu'il corrige). Le texte est ramene a une ligne ; la citation garde
 * ses retours a la ligne et est coupee a 500 caracteres.
 */
export function lireDemande(brut: unknown): DemandeLue | string {
  const p = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>
  const texte = String(p.texte ?? '').replace(/\s+/g, ' ').trim()
  if (texte.length < 5) return 'texte : la demande reformulée en une phrase actionnable.'
  if (texte.length > MAX_TEXTE_DEMANDE) {
    return `texte trop long (${texte.length} caractères) : une seule phrase de ${MAX_TEXTE_DEMANDE} caractères au plus.`
  }
  const citation = String(p.citation ?? '').trim().slice(0, MAX_CITATION_DEMANDE).trim() || null
  return { texte, citation }
}

/**
 * L'auteur d'une demande : le libelle du compte Telegram de l'equipe
 * (cockpit_telegram_comptes) quand il est connu, sinon 'cockpit:<uuid>'.
 */
export function auteurDemande(o: { libelle?: string | null; userId: string }): string {
  const libelle = o.libelle?.trim().slice(0, 60)
  return libelle || `cockpit:${o.userId}`
}
