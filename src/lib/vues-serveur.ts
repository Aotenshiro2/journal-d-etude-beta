// LES VUES GARDEES, LUES PAR LE SERVEUR (20/10/2026, arbitrage de Brice).
//
// Sept vues du cockpit sont gardees par is_cockpit_member() (auth.uid()) : la
// bonne garde pour le navigateur, mais le serveur du journal se connecte en
// role postgres, sans session, et ces vues lui rendaient ZERO ligne (constate
// le 20/10 : 0 fil de support au lieu de 73, 0 appel IA au lieu de 116). Chaque
// vue a donc sa fonction serveur cockpit_serveur_<nom>() (migration
// 20261020160000_cockpit_vues_serveur.sql) : memes lignes, sans la garde,
// executable par postgres seul (retiree a public, anon, authenticated).
//
// Deux lecteurs : l'outil requete_sql de l'Agent AOK (agent-cockpit.ts) et
// l'API de Tab (src/lib/tab/). Pur, aucun reseau.

export const VUES_GARDEES = [
  'cockpit_support_threads',
  'cockpit_ia_depense_jour',
  'cockpit_membres_avatar',
  'cockpit_ia_usage',
  'cockpit_activite_journal',
  'cockpit_concepts_journal',
  'cockpit_mentorat_acces',
] as const

const GARDEES = new Set<string>(VUES_GARDEES)

/** La fonction serveur d'une vue gardee : cockpit_x -> cockpit_serveur_x. */
export function fonctionServeur(vue: string): string {
  return `cockpit_serveur_${vue.slice('cockpit_'.length)}`
}

/** Ce qu'on lit a la place d'une table ou vue : sa fonction serveur si elle est gardee. */
export function sourceLecture(nom: string): string {
  return GARDEES.has(nom) ? `public.${fonctionServeur(nom)}()` : `public."${nom.replace(/"/g, '""')}"`
}

/**
 * Le SQL d'une requete (SELECT ou WITH ... SELECT) dont chaque vue gardee
 * citee est relue par sa fonction serveur : un WITH de meme nom est place en
 * tete, et le prefixe public. de ces noms est retire, pour que la requete
 * ecrite par le modele marche telle quelle, alias compris. Les vues non citees
 * ne changent rien ; une requete qui n'en cite aucune revient intacte.
 */
export function avecVuesServeur(sql: string): string {
  const citees = VUES_GARDEES.filter((v) => new RegExp(`\\b${v}\\b`, 'i').test(sql))
  if (citees.length === 0) return sql
  let corps = sql
  for (const v of citees) corps = corps.replace(new RegExp(`\\b(public|"public")\\s*\\.\\s*("${v}"|${v})\\b`, 'gi'), v)
  const ctes = citees.map((v) => `${v} as (select * from public.${fonctionServeur(v)}())`).join(', ')
  const m = /^\s*with\s+(recursive\s+)?/i.exec(corps)
  if (m) return `with ${m[1] ?? ''}${ctes}, ${corps.slice(m[0].length)}`
  return `with ${ctes} ${corps.trim()}`
}
