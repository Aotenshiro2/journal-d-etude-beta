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
//
// (01/11) LES VUES CALCULEES PAR LE SERVEUR : une lecture qui n'existe pas en
// base (aucune migration), definie ici par sa requete, et qu'une requete de
// l'Agent AOK peut citer comme une vue : un WITH de meme nom est place en
// tete, comme pour une vue gardee. La premiere :
// cockpit_liveclub_pauses_depot, les membres en « pause de l'abonnement +
// acces par depot broker » (liveclub/pause-depot-pur.ts).

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

/**
 * (01/11) Les membres en « pause de l'abonnement + acces par depot broker » :
 * une ligne par acces broker de ce parcours (le marqueur du journal :
 * cockpit_liveclub_gestes, geste 'acces_broker', regle 'pause_depot', la plus
 * recente). Colonnes : acces_id, email (celle du broker), telegram_id, nom,
 * pseudo, abonnement_id, broker, debut, acces_jusquau (dernier jour de
 * l'acces, inclus), paye_jusquau (fin de la periode payee avant la pause),
 * reprise_le (reprise des prelevements = acces_jusquau), depot, commission
 * (attendue), commission_statut, lots_faits_le, en_cours (acces ni retire, ni
 * sorti, pas fini), pose_le. Lecture seule, sans fonction en base.
 */
export const SQL_PAUSES_DEPOT = `select distinct on (a.acces_id)
    a.acces_id::text as acces_id, lower(a.email) as email, a.telegram_id,
    tm.nom_affiche as nom, tm.pseudo,
    g.abonnement_id, coalesce(p.nom, a.source) as broker,
    to_char(a.debut, 'YYYY-MM-DD') as debut, to_char(a.jusquau, 'YYYY-MM-DD') as acces_jusquau,
    g.details->>'paye_jusquau' as paye_jusquau, g.details->>'reprise_le' as reprise_le,
    c.montant_base as depot, c.commission_attendue as commission, c.statut as commission_statut,
    to_char(c.lots_faits_le, 'YYYY-MM-DD') as lots_faits_le,
    (a.retire_le is null and a.sorti_le is null and a.jusquau >= current_date) as en_cours,
    g.fait_le as pose_le
  from public.cockpit_liveclub_gestes g
  join public.cockpit_liveclub_acces a on a.acces_id::text = g.details->>'acces_id'
  left join public.cockpit_partenaires p on p.partenaire_id = a.source
  left join public.cockpit_commissions c on c.commission_id::text = g.details->>'commission_id'
  left join public.cockpit_telegram_membres tm on tm.telegram_id = a.telegram_id
  where g.geste = 'acces_broker' and g.regle = 'pause_depot' and g.resultat = 'fait'
  order by a.acces_id, g.fait_le desc`

/** Les vues calculees : leur nom et leur requete (un WITH de meme nom). */
export const VUES_CALCULEES: Readonly<Record<string, string>> = {
  cockpit_liveclub_pauses_depot: SQL_PAUSES_DEPOT,
}

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
 * (01/11) Une vue calculee citee recoit de meme son WITH, avec sa requete.
 */
export function avecVuesServeur(sql: string): string {
  const cite = (v: string) => new RegExp(`\\b${v}\\b`, 'i').test(sql)
  const citees = VUES_GARDEES.filter(cite)
  const calculees = Object.keys(VUES_CALCULEES).filter(cite)
  if (citees.length === 0 && calculees.length === 0) return sql
  let corps = sql
  for (const v of [...citees, ...calculees]) corps = corps.replace(new RegExp(`\\b(public|"public")\\s*\\.\\s*("${v}"|${v})\\b`, 'gi'), v)
  const ctes = [
    ...citees.map((v) => `${v} as (select * from public.${fonctionServeur(v)}())`),
    ...calculees.map((v) => `${v} as (${VUES_CALCULEES[v]})`),
  ].join(', ')
  const m = /^\s*with\s+(recursive\s+)?/i.exec(corps)
  if (m) return `with ${m[1] ?? ''}${ctes}, ${corps.slice(m[0].length)}`
  return `with ${ctes} ${corps.trim()}`
}
