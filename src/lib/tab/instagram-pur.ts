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
//   duree_s, part_vue ; par post follows (abonnements gagnes), profile_visits et
//   clics_lien_profil (clics sur le lien du profil apres ce post, depuis le 05/11).
// - cockpit_social_comptes.details.reperes : quartiles des 100 derniers reels, calcules par
//   la collecte. Bon = au-dessus du p75 (mieux que 3 reels sur 4), tres bon au-dessus du
//   p90, faible = sous le p25. Sous `compte` : les memes quartiles pour le compte, sur des
//   periodes de 7 et 30 jours (fenetres glissantes : abonnes net, part de non-abonnes,
//   comptes touches, visites du profil).
// Les textes « comment lire » (COMMENT_LIRE) sont la section 4 du plan de Tab (« Plan
// Instagram insights Cockpit », 03/11, note 5141f90b) ; ses reperes chiffres du 03/11 sont
// remplaces par ceux que la collecte recalcule chaque matin.
// Jamais la somme des couvertures quotidiennes pour une periode : une personne vue deux
// jours y compte deux fois (au 05/11 : 504 comptes uniques sur 30 jours, 1 261 en somme).

export type Seuil = { n: number; p25: number; mediane: number; p75: number; p90: number }
export type FenetreCompte = {
  fenetres?: number
  abonnes_net?: Seuil | null
  part_non_abonnes?: Seuil | null
  comptes_touches?: Seuil | null
  visites_profil?: Seuil | null
}
export type Reperes = {
  base?: { regle?: string; nombre?: number; du?: string; au?: string }
  seuils?: Record<string, Seuil | null | undefined>
  compte?: { base?: { regle?: string; du?: string; au?: string; jours?: number }; fenetres?: Record<string, FenetreCompte | undefined> }
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
  // Absente de son tableau d'objectifs, donnee par sa section 4 : « Likes et commentaires :
  // utiles pour les posts communauté (questions, débats) ».
  communaute: { nom: 'Communauté', regarder_d_abord: 'les commentaires', ensuite: 'les likes' },
}

/** Ce que Meta ne donne pas par l'API (seulement dans l'appli Instagram). */
export const PAS_DANS_L_API = 'Courbe de rétention d\'un reel, part de non-abonnés, abonnements gagnés et clics PAR REEL, messages reçus : seulement dans l\'appli Instagram (« Qui a vu ton post »). Un relevé par capture du meilleur reel de la semaine est prévu quand les reels reprendront.'

/** Comment lire chaque indicateur : la section 4 du plan de Tab (03/11). */
export const COMMENT_LIRE: Record<string, { ce_que_c_est: string; calcul?: string; comment_lire: string; action?: string }> = {
  comptes_touches: {
    ce_que_c_est: 'Le nombre de comptes différents qui ont vu le post (ou le compte, sur une période).',
    comment_lire: 'Seule, elle dit peu. Ce qui compte est qui elle touche (abonnés ou non) et ce que ces gens font ensuite.',
    action: 'Couverture haute mais rien d\'autre qui suit : accroche qui attire mais contenu qui ne retient pas. Couverture basse : sujet ou accroche à revoir, ou heure de publication.',
  },
  part_non_abonnes: {
    ce_que_c_est: 'La part des comptes touchés qui ne te suivent pas encore. C\'est le vrai chiffre de la découverte.',
    comment_lire: 'Faible : Instagram ne montre tes contenus qu\'à ta base, il ne les pousse pas plus loin. Forte : le sujet intéresse au-delà de ton cercle.',
    action: 'Repérer les sujets qui sortent de ta base et en faire des séries. Pour un reel précis, la répartition se lit dans l\'appli (« Qui a vu ton post »).',
  },
  part_vue: {
    ce_que_c_est: 'Combien de secondes, en moyenne, les gens regardent un reel, rapporté à sa durée : la part du reel vue en moyenne.',
    calcul: 'temps moyen de visionnage / durée du reel (au-dessus de 100 % : revu en boucle)',
    comment_lire: 'Une part vue élevée sur un reel court est bon signe pour la diffusion. Beaucoup de gens qui passent dès les 3 premières secondes : accroche ratée. Une chute au milieu (courbe de rétention, dans l\'appli) : longueur ou passage confus.',
    action: 'Retravailler l\'ouverture (première phrase, premier plan) et couper ce qui précède les décrochages.',
  },
  partages: {
    ce_que_c_est: 'Les gens qui envoient le post à quelqu\'un. C\'est ce qui fait voyager le contenu hors de ta base.',
    calcul: 'partages / comptes touchés',
    comment_lire: 'Un post partagé dit « ça m\'a parlé, je l\'envoie à un pote ». Les sujets relatables (psychologie, erreurs, vécu) se partagent plus que la technique.',
    action: 'Refaire le format et le sujet des posts les plus partagés : c\'est le meilleur levier de découverte.',
  },
  enregistrements: {
    ce_que_c_est: 'Les gens qui gardent le post pour y revenir.',
    calcul: 'enregistrements / comptes touchés',
    comment_lire: 'C\'est l\'indicateur des contenus éducatifs. Un post technique peu enregistré n\'a pas été jugé utile.',
    action: 'Plus d\'astuces actionnables et vérifiables sur un graphique, une idée par reel.',
  },
  visites_profil: {
    ce_que_c_est: 'Les gens qui ont eu envie de savoir qui tu es.',
    comment_lire: 'C\'est le pont entre le contenu et la vente. Beaucoup de vues et peu de visites : contenu consommé, mais personne ne se demande qui parle.',
    action: 'Signature reconnaissable, appel à aller voir le profil, et un profil qui convertit (bio claire, lien vers l\'offre).',
  },
  abonnements_et_clics: {
    ce_que_c_est: 'Les deux résultats concrets : le visiteur te suit, ou il va voir l\'offre (clic sur le lien du profil).',
    comment_lire: 'À rapprocher des visites du profil. Des visites sans abonnements : le profil ne donne pas envie de rester.',
    action: 'Soigner le profil et les épingles ; pour les posts « vente », un seul appel à l\'action clair.',
  },
  likes_et_commentaires: {
    ce_que_c_est: 'De la réaction, pas un objectif en soi.',
    comment_lire: 'Utiles pour les posts « communauté » (questions, débats). Pour le reste, ils ne disent pas si le post a rempli son rôle.',
  },
}

const HAUT = (x: Niveau | null | undefined) => x === 'bon' || x === 'tres_bon'

/** L'action proposee pour une publication : d'apres son objectif, sinon d'apres ce qui sort du lot. */
export function actionProposee(n: {
  comptes_touches: Niveau | null; partages: Niveau | null; enregistrements: Niveau | null
  part_vue: Niveau | null; passe_des_le_debut: Niveau | null
}, reel: boolean, objectif: Objectif | null): string {
  if (reel && (n.passe_des_le_debut === 'faible' || n.part_vue === 'faible')) return `Les gens décrochent tôt : ${COMMENT_LIRE.part_vue.action!.charAt(0).toLowerCase()}${COMMENT_LIRE.part_vue.action!.slice(1)}`
  const plusPartage = 'Plus partagé que 3 de tes reels sur 4 : refais ce format et ce sujet, c\'est le meilleur levier de découverte.'
  const plusEnregistre = 'Plus enregistré que 3 de tes reels sur 4 : refais un contenu pratique sur ce sujet, sous un autre angle.'
  if (objectif === 'decouverte') return HAUT(n.partages) ? plusPartage : 'Peu partagé : les sujets relatables (psychologie, erreurs, vécu) se partagent plus que la technique.'
  if (objectif === 'valeur') return HAUT(n.enregistrements) ? plusEnregistre : `Peu enregistré : ${COMMENT_LIRE.enregistrements.action!.charAt(0).toLowerCase()}${COMMENT_LIRE.enregistrements.action!.slice(1)}`
  if (objectif === 'confiance') return COMMENT_LIRE.visites_profil.action!
  if (objectif === 'vente') return `${COMMENT_LIRE.abonnements_et_clics.action!} Compare les clics aux visites du profil.`
  if (objectif === 'communaute') return 'Une question ou un débat qui appelle une réponse : les commentaires sont le chiffre de ce post.'
  if (HAUT(n.comptes_touches) && !HAUT(n.partages) && !HAUT(n.enregistrements)) return 'Beaucoup de comptes touchés mais rien d\'autre qui suit : l\'accroche attire, le contenu ne retient pas.'
  if (HAUT(n.enregistrements)) return plusEnregistre
  if (HAUT(n.partages)) return plusPartage
  if (n.comptes_touches === 'faible') return 'Peu de comptes touchés : sujet ou accroche à revoir, ou heure de publication.'
  return 'Rien qui sorte du lot : son objectif dira quel chiffre regarder d\'abord.'
}

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

/**
 * Le niveau du bilan face aux reperes du compte, pour une periode de 7 ou 30 jours (fenetres
 * glissantes de meme duree). null pour une autre duree, ou sans reperes du compte.
 */
export function niveauxBilan(b: Bilan, r: Reperes | null, duree: number) {
  const f = r?.compte?.fenetres?.[String(duree)]
  if (!f || (duree !== 7 && duree !== 30)) return null
  const part = b.part_non_abonnes_mode === 'comptes_uniques' && b.part_non_abonnes_touches_pct !== null
    ? b.part_non_abonnes_touches_pct / 100 : null
  return {
    abonnes_net: niveau(b.abonnes_net, f.abonnes_net),
    part_non_abonnes: niveau(part, f.part_non_abonnes),
    comptes_touches: niveau(b.comptes_touches_uniques, f.comptes_touches),
    visites_profil: b.jours_mesures === duree ? niveau(b.visites_profil, f.visites_profil) : null,
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
  const niveaux = {
    comptes_touches: niveau(couv, s.couverture),
    partages: niveau(tp, s.taux_partages),
    enregistrements: niveau(te, s.taux_enregistrements),
    j_aime: niveau(tl, s.taux_likes),
    commentaires: niveau(tc, s.taux_commentaires),
    part_vue: niveau(partVue, s.part_vue),
    passe_des_le_debut: niveau(saut, s.taux_saut, true),
  }
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
    visites_profil_pour_100_comptes: pct(taux(m.profile_visits)),
    abonnements_gagnes: nombre(m.follows),
    clics_lien_profil: nombre(m.clics_lien_profil),
    duree_s: nombre(m.duree_s),
    temps_moyen_vu_s: moyenMs === null ? null : arrondi(moyenMs / 1000, 1),
    part_vue_pct: pct(partVue),
    passe_des_le_debut_pct: saut,
    partages_pour_100_comptes: pct(tp),
    enregistrements_pour_100_comptes: pct(te),
    j_aime_pour_100_comptes: pct(tl),
    commentaires_pour_100_comptes: pct(tc),
    niveaux,
    comment_lire: objectif ? GRILLE_LECTURE[objectif] : null,
    action_proposee: actionProposee(niveaux, p.type === 'REELS', objectif),
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
    compte: r.compte?.fenetres ? reperesCompteLisibles(r.compte) : null,
  }
}

function reperesCompteLisibles(c: NonNullable<Reperes['compte']>) {
  const en = (x: Seuil | null | undefined, f: number, d: number) => x
    ? { mediane: arrondi(x.mediane * f, d), faible_sous: arrondi(x.p25 * f, d), bon_au_dessus: arrondi(x.p75 * f, d), periodes: x.n }
    : null
  const fen = (k: string) => {
    const x = c.fenetres?.[k]
    return x ? {
      abonnes_net: en(x.abonnes_net, 1, 1),
      part_non_abonnes_pct: en(x.part_non_abonnes, 100, 1),
      comptes_touches_uniques: en(x.comptes_touches, 1, 0),
      visites_profil: en(x.visites_profil, 1, 0),
    } : null
  }
  return { base: c.base ?? null, sur_7_jours: fen('7'), sur_30_jours: fen('30') }
}

function ecart(a: number | null, b: number | null): string {
  if (a === null || b === null) return ''
  const d = a - b
  return d === 0 ? ' (comme la période d\'avant)' : ` (période d'avant : ${b.toLocaleString('fr-FR')})`
}

const MOT_NIVEAU: Record<Niveau, string> = { tres_bon: 'très bon', bon: 'bon', normal: 'dans la moyenne', faible: 'faible' }

/** La lecture de la periode en 5 lignes, pour Tab. `niveaux` : face aux reperes du compte (7 ou 30 jours). */
export function enBref(
  a: Bilan, b: Bilan, publications: number, stories: { nombre: number; couverture_moyenne: number | null } | null,
  niveaux: ReturnType<typeof niveauxBilan> = null, duree = 7,
): string[] {
  const net = a.abonnes_net
  const pour = duree === 30 ? '30 jours' : 'une semaine'
  const qual = (x: Niveau | null | undefined) => (x ? `, ${MOT_NIVEAU[x]} pour ${pour}` : '')
  const lignes = [
    `Abonnés : ${a.abonnements_gagnes ?? '?'} gagnés, ${a.desabonnements ?? '?'} perdus, solde ${net === null ? '?' : (net > 0 ? '+' : '') + net}${ecart(net, b.abonnes_net)}${qual(niveaux?.abonnes_net)}.`,
    a.comptes_touches_uniques !== null
      ? `Comptes touchés : ${a.comptes_touches_uniques.toLocaleString('fr-FR')} uniques${ecart(a.comptes_touches_uniques, b.comptes_touches_uniques)}${qual(niveaux?.comptes_touches)}.`
      : 'Comptes touchés : Meta ne donne les comptes uniques que sur 7 ou 30 jours (demande une période de 7 ou 30 jours).',
    a.part_non_abonnes_touches_pct !== null
      ? `Hors abonnés : ${a.part_non_abonnes_touches_pct.toLocaleString('fr-FR')} % des comptes touchés ne te suivent pas${b.part_non_abonnes_touches_pct !== null ? ` (avant : ${b.part_non_abonnes_touches_pct.toLocaleString('fr-FR')} %)` : ''}${qual(niveaux?.part_non_abonnes)}.`
      : 'Hors abonnés : pas mesuré sur la période.',
    `Profil : ${a.visites_profil ?? 0} visites${qual(niveaux?.visites_profil)}, ${a.clics_vers_le_site ?? 0} clics vers le site${ecart(a.clics_vers_le_site, b.clics_vers_le_site)}.`,
    `Publications : ${publications} reel(s) ou post(s)${stories ? `, ${stories.nombre} story(s)${stories.couverture_moyenne !== null ? `, ${stories.couverture_moyenne} comptes touchés en moyenne par story` : ''}` : ''}.`,
  ]
  return lignes
}
