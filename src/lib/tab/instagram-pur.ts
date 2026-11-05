// L'API DE TAB : la lecture INSTAGRAM, partie PURE (05/11/2026, note de Tab 60478b43,
// chantier « Instagram : lecture »). Aucun reseau, aucune base.
//
// Ce que la collecte (collect_meta.py, tache Windows AOK-Collecte-Meta) range, et qu'on lit ici :
// - cockpit_social_jour (instagram). Un jour = le jour de Meta (le decalage d'un jour de la
//   couverture et des nouveaux abonnes est corrige depuis le 05/11). nouveaux_abonnes =
//   abonnements gagnes, desabonnes = perdus (follows_and_unfollows). metriques.couverture_7j
//   et couverture_30j = comptes UNIQUES touches sur les 7 ou 30 jours finissant ce jour-la,
//   et leur ventilation couverture_7j_par_follow_type (FOLLOWER = abonnes, NON_FOLLOWER =
//   non-abonnes) ; metriques.website_clicks = clics vers le site.
// - cockpit_social_publications : par reel ig_reels_avg_watch_time (ms), reels_skip_rate (%),
//   duree_s, part_vue ; par post follows (abonnements gagnes) et profile_visits.
// - cockpit_social_comptes.details.reperes : quartiles des 100 derniers reels, calcules par
//   la collecte. Bon = au-dessus du p75 (mieux que 3 reels sur 4), tres bon au-dessus du
//   p90, faible = sous le p25.
// Jamais la somme des couvertures quotidiennes pour une periode : une personne vue deux
// jours y compte deux fois (au 05/11 : 504 comptes uniques sur 30 jours, 1 261 en somme).

export type Seuil = { n: number; p25: number; mediane: number; p75: number; p90: number }
export type Reperes = {
  base?: { regle?: string; nombre?: number; du?: string; au?: string }
  seuils?: Record<string, Seuil | null | undefined>
  calcule_le?: string
}
export type Niveau = 'tres_bon' | 'bon' | 'normal' | 'faible'

export type JourIG = {
  jour: string
  abonnes: number | null
  nouveaux_abonnes: number | null
  desabonnes: number | null
  vues: number | null
  visites_profil: number | null
  interactions: number | null
  metriques: Record<string, unknown> | null
}

export type PubIG = {
  publication_id: string
  publie_le: string | null
  type: string | null
  legende: string | null
  lien: string | null
  j_aime: number | null
  commentaires: number | null
  partages: number | null
  enregistrements: number | null
  couverture: number | null
  vues: number | null
  metriques: Record<string, unknown> | null
}

export const OBJECTIFS = ['decouverte', 'valeur', 'confiance', 'vente', 'communaute'] as const
export type Objectif = (typeof OBJECTIFS)[number]

/** La grille de lecture de Tab (note 60478b43) : l'indicateur a regarder d'abord, puis ensuite. */
export const GRILLE_LECTURE: Record<Objectif, { nom: string; regarder_d_abord: string; ensuite: string }> = {
  decouverte: { nom: 'Découverte', regarder_d_abord: 'la part de non-abonnés touchés et les partages', ensuite: 'les abonnements gagnés' },
  valeur: { nom: 'Valeur', regarder_d_abord: 'les enregistrements', ensuite: 'le temps de visionnage' },
  confiance: { nom: 'Confiance', regarder_d_abord: 'les visites du profil', ensuite: 'les commentaires' },
  vente: { nom: 'Vente', regarder_d_abord: 'les clics vers le site et les messages reçus', ensuite: 'les visites du profil' },
  communaute: { nom: 'Communauté', regarder_d_abord: 'à écrire par Tab (absente de sa grille du 04/11)', ensuite: 'à écrire par Tab' },
}

/** Ce que Meta ne donne pas par l'API (seulement dans l'appli) : Tab le releve par capture. */
export const PAS_DANS_L_API = 'Courbe de rétention d\'un reel, part de non-abonnés et abonnements gagnés PAR REEL : seulement dans l\'appli Instagram (relevé par capture hebdomadaire).'

export function nombre(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : null
}

/** Le niveau d'une valeur face aux reperes. `inverse` : plus bas = mieux (taux de saut). */
export function niveau(v: number | null | undefined, s: Seuil | null | undefined, inverse = false): Niveau | null {
  if (v === null || v === undefined || !Number.isFinite(v) || !s) return null
  if (inverse) {
    if (v < s.p25) return 'bon'
    if (v > s.p75) return 'faible'
    return 'normal'
  }
  if (v > s.p90 && s.p90 > s.p75) return 'tres_bon'
  if (v > s.p75) return 'bon'
  if (v < s.p25) return 'faible'
  return 'normal'
}

export function nbJours(du: string, au: string): number {
  return Math.round((Date.parse(`${au}T00:00:00Z`) - Date.parse(`${du}T00:00:00Z`)) / 86_400_000) + 1
}

function decaler(j: string, n: number): string {
  const d = new Date(`${j}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Le dernier jour que Meta a fini de compter : le plus recent ou les abonnements sont mesures. */
export function dernierJourComplet(jours: JourIG[]): string | null {
  let d: string | null = null
  for (const j of jours) if (nombre(j.nouveaux_abonnes) !== null && (d === null || j.jour > d)) d = j.jour
  return d
}

/**
 * La periode effectivement lue : la periode demandee, reculee pour finir au dernier jour
 * complet si elle va plus loin (Meta livre avec 1 a 2 jours de retard). Meme duree.
 */
export function periodeMesuree(du: string, au: string, complet: string | null): { du: string; au: string; reculee: boolean } {
  if (!complet || au <= complet) return { du, au, reculee: false }
  const n = nbJours(du, au)
  return { du: decaler(complet, -(n - 1)), au: complet, reculee: true }
}

export type Bilan = {
  du: string
  au: string
  jours_mesures: number
  abonnements_gagnes: number | null
  desabonnements: number | null
  abonnes_net: number | null
  comptes_touches_uniques: number | null
  part_non_abonnes_touches_pct: number | null
  part_non_abonnes_mode: 'comptes_uniques' | 'somme_des_jours' | null
  visites_profil: number | null
  clics_vers_le_site: number | null
  vues: number | null
  interactions: number | null
}

const arrondi = (v: number | null, d = 2): number | null => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d)

/** Le bilan du compte sur [du, au] (bornes incluses), a partir des jours de la collecte. */
export function bilanPeriode(jours: JourIG[], du: string, au: string): Bilan {
  const dans = jours.filter((j) => j.jour >= du && j.jour <= au)
  const somme = (f: (j: JourIG) => unknown): number | null => {
    let s: number | null = null
    for (const j of dans) {
      const v = nombre(f(j))
      if (v !== null) s = (s ?? 0) + v
    }
    return s
  }
  const m = (j: JourIG) => j.metriques ?? {}
  const gagnes = somme((j) => j.nouveaux_abonnes)
  const perdus = somme((j) => j.desabonnes)
  const n = nbJours(du, au)
  const fin = jours.find((j) => j.jour === au)
  let uniques: number | null = null
  let part: number | null = null
  let mode: Bilan['part_non_abonnes_mode'] = null
  if ((n === 7 || n === 30) && fin) {
    uniques = nombre(m(fin)[`couverture_${n}j`])
    const v = m(fin)[`couverture_${n}j_par_follow_type`] as Record<string, unknown> | undefined
    const a = nombre(v?.FOLLOWER) ?? 0
    const na = nombre(v?.NON_FOLLOWER) ?? 0
    if (a + na > 0) { part = (na / (a + na)) * 100; mode = 'comptes_uniques' }
  }
  if (mode === null) {
    const a = somme((j) => (m(j).reach_par_follow_type as Record<string, unknown> | undefined)?.FOLLOWER)
    const na = somme((j) => (m(j).reach_par_follow_type as Record<string, unknown> | undefined)?.NON_FOLLOWER)
    if ((a ?? 0) + (na ?? 0) > 0) { part = ((na ?? 0) / ((a ?? 0) + (na ?? 0))) * 100; mode = 'somme_des_jours' }
  }
  return {
    du, au,
    jours_mesures: dans.filter((j) => nombre(j.nouveaux_abonnes) !== null).length,
    abonnements_gagnes: gagnes,
    desabonnements: perdus,
    abonnes_net: gagnes === null && perdus === null ? null : (gagnes ?? 0) - (perdus ?? 0),
    comptes_touches_uniques: uniques,
    part_non_abonnes_touches_pct: arrondi(part, 1),
    part_non_abonnes_mode: mode,
    visites_profil: somme((j) => j.visites_profil),
    clics_vers_le_site: somme((j) => m(j).website_clicks),
    vues: somme((j) => j.vues),
    interactions: somme((j) => j.interactions),
  }
}

const TYPES: Record<string, string> = { REELS: 'reel', FEED: 'post', CAROUSEL_ALBUM: 'carrousel', IMAGE: 'image', VIDEO: 'vidéo' }

/** Une publication lue : ses taux (en %), leur niveau face aux reperes, et sa grille si son objectif est connu. */
export function lirePublication(p: PubIG, reperes: Reperes | null, objectif: Objectif | null = null) {
  const s = reperes?.seuils ?? {}
  const m = p.metriques ?? {}
  const couv = nombre(p.couverture)
  const taux = (v: unknown) => { const x = nombre(v); return x !== null && couv ? x / couv : null }
  const tp = taux(p.partages)
  const te = taux(p.enregistrements)
  const tl = taux(p.j_aime)
  const tc = taux(p.commentaires)
  const partVue = nombre(m.part_vue)
  const saut = nombre(m.reels_skip_rate)
  const moyenMs = nombre(m.ig_reels_avg_watch_time)
  const pct = (v: number | null) => arrondi(v === null ? null : v * 100, 2)
  return {
    publie_le: p.publie_le,
    type: TYPES[p.type ?? ''] ?? p.type,
    legende: p.legende,
    lien: p.lien,
    objectif: objectif ? GRILLE_LECTURE[objectif].nom : null,
    comptes_touches: couv,
    vues: nombre(p.vues),
    j_aime: nombre(p.j_aime),
    commentaires: nombre(p.commentaires),
    partages: nombre(p.partages),
    enregistrements: nombre(p.enregistrements),
    reposts: nombre(m.reposts),
    visites_profil: nombre(m.profile_visits),
    abonnements_gagnes: nombre(m.follows),
    duree_s: nombre(m.duree_s),
    temps_moyen_vu_s: moyenMs === null ? null : arrondi(moyenMs / 1000, 1),
    part_vue_pct: pct(partVue),
    passe_des_le_debut_pct: saut,
    partages_pour_100_comptes: pct(tp),
    enregistrements_pour_100_comptes: pct(te),
    j_aime_pour_100_comptes: pct(tl),
    commentaires_pour_100_comptes: pct(tc),
    niveaux: {
      comptes_touches: niveau(couv, s.couverture),
      partages: niveau(tp, s.taux_partages),
      enregistrements: niveau(te, s.taux_enregistrements),
      j_aime: niveau(tl, s.taux_likes),
      commentaires: niveau(tc, s.taux_commentaires),
      part_vue: niveau(partVue, s.part_vue),
      passe_des_le_debut: niveau(saut, s.taux_saut, true),
    },
    comment_lire: objectif ? GRILLE_LECTURE[objectif] : null,
  }
}

/** Les reperes rendus lisibles : taux en %, durees en secondes. */
export function reperesLisibles(r: Reperes | null) {
  if (!r?.seuils) return null
  const s = r.seuils
  const en = (x: Seuil | null | undefined, f: number, d: number) => x
    ? { mediane: arrondi(x.mediane * f, d), faible_sous: arrondi(x.p25 * f, d), bon_au_dessus: arrondi(x.p75 * f, d), tres_bon_au_dessus: arrondi(x.p90 * f, d), reels: x.n }
    : null
  return {
    base: r.base ?? null,
    calcule_le: r.calcule_le ?? null,
    comptes_touches: en(s.couverture, 1, 0),
    partages_pour_100_comptes: en(s.taux_partages, 100, 2),
    enregistrements_pour_100_comptes: en(s.taux_enregistrements, 100, 2),
    j_aime_pour_100_comptes: en(s.taux_likes, 100, 2),
    commentaires_pour_100_comptes: en(s.taux_commentaires, 100, 2),
    part_vue_pct: en(s.part_vue, 100, 0),
    passe_des_le_debut_pct: en(s.taux_saut, 1, 1),
    temps_moyen_vu_s: en(s.temps_moyen_s, 1, 1),
  }
}

function ecart(a: number | null, b: number | null): string {
  if (a === null || b === null) return ''
  const d = a - b
  return d === 0 ? ' (comme la période d\'avant)' : ` (période d'avant : ${b.toLocaleString('fr-FR')})`
}

/** La lecture de la periode en 5 lignes, pour Tab. */
export function enBref(a: Bilan, b: Bilan, publications: number, stories: { nombre: number; couverture_moyenne: number | null } | null): string[] {
  const net = a.abonnes_net
  const lignes = [
    `Abonnés : ${a.abonnements_gagnes ?? '?'} gagnés, ${a.desabonnements ?? '?'} perdus, solde ${net === null ? '?' : (net > 0 ? '+' : '') + net}${ecart(net, b.abonnes_net)}.`,
    a.comptes_touches_uniques !== null
      ? `Comptes touchés : ${a.comptes_touches_uniques.toLocaleString('fr-FR')} uniques${ecart(a.comptes_touches_uniques, b.comptes_touches_uniques)}.`
      : 'Comptes touchés : Meta ne donne les comptes uniques que sur 7 ou 30 jours (demande une période de 7 ou 30 jours).',
    a.part_non_abonnes_touches_pct !== null
      ? `Hors abonnés : ${a.part_non_abonnes_touches_pct.toLocaleString('fr-FR')} % des comptes touchés ne te suivent pas${b.part_non_abonnes_touches_pct !== null ? ` (avant : ${b.part_non_abonnes_touches_pct.toLocaleString('fr-FR')} %)` : ''}.`
      : 'Hors abonnés : pas mesuré sur la période.',
    `Profil : ${a.visites_profil ?? 0} visites, ${a.clics_vers_le_site ?? 0} clics vers le site${ecart(a.clics_vers_le_site, b.clics_vers_le_site)}.`,
    `Publications : ${publications} reel(s) ou post(s)${stories ? `, ${stories.nombre} story(s)${stories.couverture_moyenne !== null ? `, ${stories.couverture_moyenne} comptes touchés en moyenne par story` : ''}` : ''}.`,
  ]
  return lignes
}
