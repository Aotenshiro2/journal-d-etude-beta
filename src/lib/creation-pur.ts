// L'ONGLET CREATION DU COCKPIT : la partie PURE de /api/cockpit/creation
// (16/10/2026). Aucune base, aucun reseau, aucun import : lecture de la
// demande et des noeuds, numerotation, serialisation de l'arbre, entrees des
// prompts, mots de recherche et mise en forme de la matiere des PDF et de la
// reference commune (ICT), schemas
// des outils, validation de la sortie de l'IA.
//
// Les formes (noeud, demande, contenu) suivent le contrat commun ecran /
// serveur du 16/10 (contrat-creation.md) : l'ecran du cockpit les lit telles
// quelles, ne pas en changer une d'un seul cote. La numerotation affichee
// (1, 1.5, 1.5.2) se calcule ici comme a l'ecran : rang 1-base par `ordre`
// parmi les freres, concatene avec celui du parent.
//
// Les prompts eux-memes ne sont pas ici : ils vivent dans
// D:\1_Ecriture\Systeme\methode-structuration-sujet.md et arrivent par
// cockpit_methode_textes (npm run pousser:methodes, apps/cockpit).

export type Marque = 'v' | 'b' | 'i' | 'm' | 'q' | 'fait' | 'a_faire'
export const MARQUES: readonly Marque[] = ['v', 'b', 'i', 'm', 'q', 'fait', 'a_faire']

export type Noeud = {
  id: string
  parent: string | null
  ordre: number
  texte: string
  marque: Marque | null
  source: string | null
  question: string | null
  mure: boolean
  /**
   * Le nom court de l'idee (1 a 4 mots, « La psychologie ») quand le noeud est
   * une CATEGORIE et pas encore une phrase (27/10/2026, retour de Brice : on
   * commence par les grandes idees). Absent sur les noeuds ecrits avant :
   * champ optionnel du jsonb, aucune migration. `texte` dit alors ce qu'elle couvre.
   */
  idee?: string | null
  /**
   * La phrase qui explique le noeud, choisie par l'auteur (geste « phrase »,
   * 27/10/2026). Champ optionnel du jsonb, aucune migration. Ne ferme rien :
   * le noeud garde ses enfants et peut toujours se creuser.
   */
  phrase?: string | null
}

export type Statut = 'a_redecouper' | 'trou' | 'mure' | 'brut'

export type Geste = 'assiste' | 'genere' | 'titre' | 'phrase' | 'idee' | 'idees'

export type Demande =
  | { geste: 'assiste'; decoupage_id: string; cible: string | null; matiere_collee?: string }
  | { geste: 'genere'; decoupage_id: string; cible: string | null; matiere_collee?: string }
  /** Une phrase pour expliquer UN noeud : la cible est obligatoire. */
  | { geste: 'phrase'; decoupage_id: string; cible: string; matiere_collee?: string }
  /** La grande idee d'UN noeud (son nom court) : la cible est obligatoire. */
  | { geste: 'idee'; decoupage_id: string; cible: string; matiere_collee?: string }
  /** Un nom pour chaque noeud sans nom du decoupage, en un appel : pas de cible (le serveur les choisit). */
  | { geste: 'idees'; decoupage_id: string; cible: null; matiere_collee?: string }
  | { geste: 'titre'; titre: string }

export type Action = 'garder' | 'remplacer' | 'deplacer' | 'ajouter'
export const ACTIONS: readonly Action[] = ['garder', 'remplacer', 'deplacer', 'ajouter']

export type PropositionAssiste = {
  cible: string | null
  action: Action
  texte?: string
  vers?: string | null
  marque?: Marque | null
  source?: string | null
  raison: string
}
export type ContenuAssiste = {
  propositions: PropositionAssiste[]
  questions: Array<{ cible: string | null; question: string }>
  sans_vecu?: string[]
}

export type PieceEnfant = {
  texte: string; marque: Marque | null; source: string | null; question?: string | null
  /** Le nom court du noeud (idee, concept, raison). Absent seulement dans une sortie d'avant le 27/10. */
  idee?: string | null
  /** true = une fondation : ses enfants ne seraient que des reformulations (test des cinq enfants). */
  mure?: boolean
}
export type PieceGeneree = PieceEnfant & { enfants?: PieceEnfant[] }
export type ContenuGenere = { decoupages: Array<{ nom: string; angle: string; pieces: PieceGeneree[] }> }

/** Le geste « phrase » : trois phrases au plus, au choix de l'auteur. */
export type ContenuPhrase = { phrases: string[] }
export const MAX_PHRASES = 3
export const MAX_PHRASE = 400

/**
 * Le geste « idee » (27/10/2026, Brice : une bulle qui n'a qu'une phrase se
 * resume par une grande idee, « Non-respect de la prop firm », qui devient
 * son nom ; la phrase reste dessous). Trois noms au plus, au choix de l'auteur.
 */
export type ContenuIdee = { noms: string[] }
export const MAX_NOMS = 3
/** Un nom court : 1 a 5 mots. Au-dela, c'est une phrase : il tombe. */
export const MAX_MOTS_NOM = 5
/** Le geste « idees » : les noms de chaque noeud sans nom, en un appel. */
export type ContenuIdees = { noeuds: Array<{ ref: string; noms: string[] }> }
/** Noeuds sans nom envoyes au plus dans un lot (les suivants attendent le lot d'apres). */
export const MAX_LOT_IDEES = 40

export type Verdict = 'tient' | 'depasse' | 'trahit'
export const VERDICTS: readonly Verdict[] = ['tient', 'depasse', 'trahit']
export type ContenuTitre = {
  candidates: Array<{ decoupage_id: string; ref: string; verdict: Verdict; raison: string }>
  manque?: { piece: string; questions: string[] } | null
}

export const MAX_MATIERE_COLLEE = 40_000
export const MAX_TITRE = 300
export const MAX_DECOUPAGES_GENERES = 3
/** Le nom court d'une idee : 1 a 4 mots demandes, 80 caracteres toleres. */
export const MAX_IDEE = 80

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// --- Petits outils ------------------------------------------------------------

const estObjet = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

const liste = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])

/** Texte propre ou null : coupe a `max`, et aucun tiret long ne passe (regle de Brice). */
function texte(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null
  const t = x.replace(/[\u2014\u2013]/g, '-').trim().slice(0, max)
  return t ? t : null
}

/** Une marque du contrat, ou null. Tolere [V], V, ?, « a faire ». */
export function normaliserMarque(x: unknown): Marque | null {
  if (typeof x !== 'string') return null
  const s = x.trim().toLowerCase().replace(/^\[|\]$/g, '').trim()
  if (s === '?') return 'q'
  const k = s.replace(/[\s-]+/g, '_').replace(/^à_/, 'a_')
  return (MARQUES as readonly string[]).includes(k) ? (k as Marque) : null
}

// --- La demande ---------------------------------------------------------------

/** Le corps de POST /api/cockpit/creation, valide. Une chaine = le message d'erreur (400). */
export function lireDemande(brut: unknown): Demande | string {
  if (!estObjet(brut)) return 'Corps de requête illisible.'
  const geste = brut.geste
  if (geste === 'titre') {
    const titre = typeof brut.titre === 'string' ? brut.titre.trim().slice(0, MAX_TITRE) : ''
    if (!titre) return 'titre requis.'
    return { geste, titre }
  }
  if (geste !== 'assiste' && geste !== 'genere' && geste !== 'phrase' && geste !== 'idee' && geste !== 'idees') {
    return 'geste attendu : assiste, genere, phrase, idee, idees ou titre.'
  }
  const decoupageId = typeof brut.decoupage_id === 'string' ? brut.decoupage_id.trim() : ''
  if (!UUID.test(decoupageId)) return 'decoupage_id invalide.'
  let cible: string | null = null
  if (brut.cible !== undefined && brut.cible !== null) {
    if (typeof brut.cible !== 'string' || !brut.cible.trim() || brut.cible.length > 64) return 'cible invalide.'
    cible = brut.cible.trim()
  }
  const decoupage_id = decoupageId.toLowerCase()
  const matiere = typeof brut.matiere_collee === 'string' && brut.matiere_collee.trim()
    ? brut.matiere_collee.slice(0, MAX_MATIERE_COLLEE)
    : null
  if (geste === 'phrase' || geste === 'idee') {
    // Une phrase explique UN noeud, une grande idee nomme UN noeud : jamais l'aieul (il a son titre).
    if (cible === null) return geste === 'phrase' ? 'cible requise pour une phrase.' : 'cible requise pour un nom.'
    return matiere ? { geste, decoupage_id, cible, matiere_collee: matiere } : { geste, decoupage_id, cible }
  }
  if (geste === 'idees') {
    // Le lot vise tous les noeuds sans nom : une cible n'a pas de sens, elle est ignoree.
    return matiere ? { geste, decoupage_id, cible: null, matiere_collee: matiere } : { geste, decoupage_id, cible: null }
  }
  return matiere ? { geste, decoupage_id, cible, matiere_collee: matiere } : { geste, decoupage_id, cible }
}

/** Brice ? Label ou email de l'allowlist contenant « brice », sans casse. */
export function estBrice(...valeurs: Array<string | null | undefined>): boolean {
  return valeurs.some((v) => typeof v === 'string' && /brice/i.test(v))
}

// --- L'arbre ------------------------------------------------------------------

/**
 * Les noeuds tels que stockes (jsonb ecrit par l'ecran), lus comme l'ecran les
 * lit (apps/cockpit/src/lib/creation.ts, lireNoeuds) pour que les num soient
 * les memes des deux cotes : une entree sans id est ignoree, un id en double
 * garde la premiere, ordre absent = 0, marque hors liste = null.
 */
export function lireNoeuds(brut: unknown): Noeud[] {
  const vus = new Set<string>()
  const noeuds: Noeud[] = []
  for (const x of liste(brut)) {
    if (!estObjet(x)) continue
    const id = typeof x.id === 'string' ? x.id : ''
    if (!id || vus.has(id)) continue
    vus.add(id)
    const n: Noeud = {
      id,
      parent: typeof x.parent === 'string' && x.parent !== '' ? x.parent : null,
      ordre: typeof x.ordre === 'number' && Number.isFinite(x.ordre) ? x.ordre : 0,
      texte: typeof x.texte === 'string' ? x.texte : '',
      marque: typeof x.marque === 'string' && (MARQUES as readonly string[]).includes(x.marque) ? (x.marque as Marque) : null,
      source: typeof x.source === 'string' && x.source.trim() ? x.source : null,
      question: typeof x.question === 'string' && x.question.trim() ? x.question : null,
      mure: x.mure === true,
    }
    if (typeof x.idee === 'string' && x.idee.trim()) n.idee = x.idee.trim()
    if (typeof x.phrase === 'string' && x.phrase.trim()) n.phrase = x.phrase.trim()
    noeuds.push(n)
  }
  return noeuds
}

/**
 * Le parent EFFECTIF de chaque noeud, comme a l'ecran : un parent inconnu, le
 * noeud lui-meme ou une boucle n'importe ou dans sa lignee ramenent le noeud
 * sous l'aieul (null). Garantit un arbre parcourable.
 */
function parentsEffectifs(noeuds: Noeud[]): Map<string, string | null> {
  const parDeclare = new Map(noeuds.map((n) => [n.id, n.parent]))
  const effectif = new Map<string, string | null>()
  for (const n of noeuds) {
    const p = n.parent
    if (p === null || p === n.id || !parDeclare.has(p)) { effectif.set(n.id, null); continue }
    const vus = new Set<string>([n.id])
    let courant: string | null = p
    let boucle = false
    while (courant !== null && parDeclare.has(courant)) {
      if (vus.has(courant)) { boucle = true; break }
      vus.add(courant)
      courant = parDeclare.get(courant) ?? null
    }
    effectif.set(n.id, boucle ? null : p)
  }
  return effectif
}

/** Les enfants de chaque parent (null = l'aieul), ranges par `ordre` puis par position. */
export function enfantsParParent(noeuds: Noeud[]): Map<string | null, Noeud[]> {
  const effectif = parentsEffectifs(noeuds)
  const groupes = new Map<string | null, Noeud[]>()
  for (const n of noeuds) {
    const p = effectif.get(n.id) ?? null
    const g = groupes.get(p)
    if (g) g.push(n)
    else groupes.set(p, [n])
  }
  // sort est stable : a ordre egal, l'ordre du tableau decide (comme a l'ecran).
  for (const g of groupes.values()) g.sort((a, b) => a.ordre - b.ordre)
  return groupes
}

export type LigneArbre = { noeud: Noeud; num: string; parent: string | null; statut: Statut }

/** L'arbre a plat, dans l'ordre de lecture (parcours en profondeur), avec num et statut. */
export function parcourir(noeuds: Noeud[]): LigneArbre[] {
  const groupes = enfantsParParent(noeuds)
  const lignes: LigneArbre[] = []
  const descendre = (parent: string | null, prefixe: string) => {
    for (const [i, n] of (groupes.get(parent) ?? []).entries()) {
      const num = prefixe ? `${prefixe}.${i + 1}` : `${i + 1}`
      lignes.push({ noeud: n, num, parent, statut: statutNoeud(n, (groupes.get(n.id) ?? []).length > 0) })
      descendre(n.id, num)
    }
  }
  descendre(null, '')
  return lignes
}

/** Statut affiche, jamais stocke : a_redecouper > trou > mure > brut. */
export function statutNoeud(n: Noeud, aDesEnfants: boolean): Statut {
  if (aDesEnfants) return 'a_redecouper'
  if (n.marque === 'q') return 'trou'
  if (n.mure) return 'mure'
  return 'brut'
}

/** id -> num affiche (1.5.2). */
export function numeroter(noeuds: Noeud[]): Map<string, string> {
  return new Map(parcourir(noeuds).map((l) => [l.noeud.id, l.num]))
}

/**
 * Les noeuds sans nom (`idee` absent), dans l'ordre de lecture de l'arbre, au
 * plus `max` (le lot du geste idees). Un noeud au texte vide n'a rien a nommer.
 */
export function noeudsSansNom(noeuds: Noeud[], max = MAX_LOT_IDEES): Noeud[] {
  return parcourir(noeuds)
    .map((l) => l.noeud)
    .filter((n) => !n.idee?.trim() && n.texte.trim() !== '')
    .slice(0, max)
}

/** Les descendants d'un noeud (lui exclu). */
export function descendants(noeuds: Noeud[], id: string): Set<string> {
  const groupes = enfantsParParent(noeuds)
  const res = new Set<string>()
  const pile = [...(groupes.get(id) ?? [])]
  while (pile.length) {
    const n = pile.pop()!
    if (res.has(n.id)) continue
    res.add(n.id)
    pile.push(...(groupes.get(n.id) ?? []))
  }
  return res
}

const cellule = (x: string | null, max = 600): string =>
  x ? x.replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, max) || '-' : '-'

export const ENTETE_TABLEAU = 'num | ref | parent_ref | texte | marque | source | statut'

/**
 * Le texte d'un noeud dans un tableau : « La psychologie : ce qu'elle couvre »
 * pour un noeud nomme, plus sa phrase quand l'auteur en a choisi une.
 */
export function texteTableau(n: Pick<Noeud, 'texte' | 'idee' | 'phrase'>): string {
  const idee = n.idee?.trim()
  const base = idee ? `${idee} : ${n.texte}` : n.texte
  const phrase = n.phrase?.trim()
  return phrase ? `${base} (phrase : « ${phrase} »)` : base
}

/**
 * Le tableau `num | ref | parent_ref | texte | marque | source | statut`.
 * `exclure` : les refs a taire (mode genere : ce qui est deja sous la cible).
 * Les num restent ceux de l'arbre complet, ceux que l'auteur voit a l'ecran.
 * Le statut, lui, se calcule sur ce qui est montre.
 */
export function serialiserArbre(noeuds: Noeud[], exclure: Set<string> = new Set()): string {
  const nums = numeroter(noeuds)
  const montres = noeuds.filter((n) => !exclure.has(n.id))
  const lignes = parcourir(montres).map((l) =>
    [
      nums.get(l.noeud.id) ?? l.num,
      l.noeud.id,
      l.parent ?? '-',
      cellule(texteTableau(l.noeud)),
      l.noeud.marque ?? '-',
      cellule(l.noeud.source, 200),
      l.statut,
    ].join(' | '),
  )
  return [ENTETE_TABLEAU, ...lignes].join('\n')
}

// --- Les entrees des prompts --------------------------------------------------

export type LigneDecoupage = {
  id: string
  titre: string
  phrase: string | null
  usage: string
  parent_idee?: string | null
  noeuds: Noeud[]
}

/** Le message de l'utilisateur pour le Prompt 1 (gestes assiste, genere, phrase, idee et idees). */
export function entreesPrompt1(p: {
  geste: 'assiste' | 'genere' | 'phrase' | 'idee' | 'idees'
  auteur: string
  ligne: LigneDecoupage
  cible: string | null
  matiereAuteur: boolean
  matiereCollee: string | null
  /** Le nombre de pages de PDF de l'auteur envoyees dans le systeme (0 = aucune). */
  pagesPdf?: number
  /** Les pages de la REFERENCE commune envoyees dans le systeme, a part (absent ou 0 page = aucune). */
  reference?: { pages: number; tiers: string[] }
  outil: string
}): string {
  const { geste, ligne, cible } = p
  const nums = numeroter(ligne.noeuds)
  const noeudCible = cible ? ligne.noeuds.find((n) => n.id === cible) ?? null : null

  // Mode genere : page blanche sous la cible, le reste de l'arbre reste la pour le contexte.
  const exclure = geste === 'genere'
    ? (cible ? descendants(ligne.noeuds, cible) : new Set(ligne.noeuds.map((n) => n.id)))
    : new Set<string>()
  const montres = ligne.noeuds.filter((n) => !exclure.has(n.id)).length

  const objet = [ligne.titre.trim(), ligne.phrase?.trim()].filter(Boolean).join(' : ')
  const laCible = noeudCible
    ? `ref ${noeudCible.id} (num ${nums.get(noeudCible.id) ?? '?'}) « ${cellule(texteTableau(noeudCible))} »`
    : "l'aïeul, c'est-à-dire l'objet lui-même"
  const consigneCible = geste === 'assiste'
    ? 'Juge les pièces SOUS la cible (garder, remplacer, deplacer) et propose ce qui manque sous elle. Le reste de l\'arbre est là pour le contexte.'
    : geste === 'phrase'
      ? 'Propose la phrase qui explique ce nœud, et rien d\'autre. Sa lignée et ses enfants sont dans le tableau, pour le contexte.'
      : geste === 'idee'
        ? 'Propose le nom court de ce nœud (la grande idée que son texte illustre), et rien d\'autre. Sa lignée et ses enfants sont dans le tableau, pour le contexte.'
        : geste === 'idees'
          ? 'Propose un nom court pour chacun des NŒUDS À NOMMER ci-dessous, et rien d\'autre. Le reste de l\'arbre est là pour le contexte.'
          : 'Propose trois découpages de la cible : ses pièces, et si besoin un niveau d\'enfants. Ce qui existe déjà sous elle ne t\'est pas montré, c\'est voulu (page blanche). Le reste de l\'arbre est là pour le contexte.'
  // Gestes phrase et idee : la lignee dite en clair, du plus large au noeud.
  const ligneeDe = (n: Noeud) =>
    [...ancetres(ligne.noeuds, n.id)].reverse().concat(n).map((x) => cellule(texteTableau(x), 200)).join(' > ')
  const lignee = (geste === 'phrase' || geste === 'idee') && noeudCible ? ligneeDe(noeudCible) : null
  // Geste idees : les noeuds a nommer, chacun avec sa ref et sa lignee.
  const aNommer = geste === 'idees'
    ? noeudsSansNom(ligne.noeuds).map((n) => `  - ref ${n.id} (num ${nums.get(n.id) ?? '?'}) : ${ligneeDe(n)}`)
    : []

  const sources: string[] = []
  if (p.matiereAuteur) sources.push('les extraits de MANIFESTE.md, idees-du-moment.md et banque-contenus.md fournis dans le système')
  if (p.pagesPdf) {
    sources.push(`${p.pagesPdf} page${p.pagesPdf > 1 ? 's' : ''} de ses PDF fournie${p.pagesPdf > 1 ? 's' : ''} dans le système (une feuille qui s'y adosse : marque b, source « PDF <fichier>, p. <n> »)`)
  }
  let matiere: string
  if (sources.length && p.matiereCollee) matiere = `${sources.join(', ')}, et la matière collée ci-dessous.`
  else if (sources.length) matiere = `${sources.join(', et ')}.`
  else if (p.matiereCollee) matiere = 'la matière collée ci-dessous, rien d\'autre.'
  else matiere = 'aucune. N\'invente rien : une pièce sans matière est marquée q et devient une question.'

  const arbre = montres > 0
    ? serialiserArbre(ligne.noeuds, exclure)
    : geste === 'genere' ? '(vide : mode genere)' : "(vide : l'auteur n'a encore rien dit)"

  // La reference n'est pas de la matiere : elle a sa ligne a elle, apres MATIERE.
  const nRef = p.reference?.pages ?? 0
  const reference = nRef > 0 && p.reference
    ? `- RÉFÉRENCE : ${nRef} page${nRef > 1 ? 's' : ''} de ${p.reference.tiers.join(', ') || 'référence'} `
      + `fournie${nRef > 1 ? 's' : ''} à part dans le système. Ce n'est pas la matière de l'auteur : `
      + `${consigneReference(p.reference.tiers)}.`
    : null

  return [
    'Entrées :',
    `- AUTEUR : ${p.auteur}`,
    `- OBJET : ${objet}`,
    ligne.parent_idee?.trim() ? `- IDÉE AU-DESSUS DE L'OBJET (contexte) : ${ligne.parent_idee.trim()}` : null,
    `- USAGE : ${ligne.usage}`,
    '- NIVEAU : arbre',
    `- MODE : ${geste}`,
    `- CIBLE : ${laCible}. ${consigneCible}`,
    geste === 'genere' ? `- NIVEAU DES PIÈCES À RENDRE : ${consigneNiveau(profondeurDe(ligne.noeuds, noeudCible?.id ?? null) + 1)}` : null,
    lignee ? `- LIGNÉE DU NŒUD (du plus large au nœud) : ${objet} > ${lignee}` : null,
    aNommer.length ? `- NŒUDS À NOMMER (${aNommer.length}, chacun avec sa lignée du plus large au nœud) :\n${aNommer.join('\n')}` : null,
    "- CE QUE L'AUTEUR A DÉJÀ DIT (une ligne par pièce) :",
    arbre,
    `- MATIERE : ${matiere}`,
    reference,
    p.matiereCollee ?`\nMATIÈRE COLLÉE PAR L'AUTEUR :\n<<<\n${p.matiereCollee}\n>>>` : null,
    `\nRends ta sortie par l'outil ${p.outil}, et seulement par lui.`,
  ].filter((x): x is string => x !== null).join('\n')
}

/** Le message de l'utilisateur pour le Prompt 2 (geste titre). */
export function entreesPrompt2(titre: string, arbres: LigneDecoupage[], outil: string): string {
  const blocs = arbres.map((a) => [
    `=== decoupage_id : ${a.id}`,
    `titre : ${cellule(a.titre)}${a.phrase?.trim() ? ` (phrase : ${cellule(a.phrase)})` : ''}`,
    `usage : ${a.usage}`,
    a.noeuds.length ? serialiserArbre(a.noeuds) : '(aucune pièce)',
  ].join('\n'))
  return [
    'Entrées :',
    `- TITRE : ${titre}`,
    arbres.length
      ? `- ARBRES : ${arbres.length} découpage(s) stocké(s). Pour chacun : decoupage_id, titre (l'aïeul), puis le tableau.`
      : '- ARBRES : aucun découpage stocké pour l\'instant.',
    ...blocs.map((b) => `\n${b}`),
    `\nRends ta sortie par l'outil ${outil}, et seulement par lui.`,
  ].join('\n')
}

// --- Du general au particulier, en concepts (27/10/2026) ------------------------
//
// Retour de Brice apres son premier vrai usage (live du 27/10, « Pourquoi tu
// crames tes comptes et comment arreter ? ») : le geste genere rendait au premier
// niveau des PHRASES punchlines (« Tu ne crames pas un compte sur un trade... »).
// Puis sa precision du meme jour, qui fait regle : un noeud est une IDEE, un
// CONCEPT ou une RAISON (« le tilt est une raison de pourquoi ca arrive : il doit
// avoir sa bulle, decomposee derriere en cinq raisons qui peuvent generer
// l'etat de tilt »), toujours nomme (`idee` court) avec ce qu'il couvre (`texte`).
// Le critere pour creuser n'est pas « tient en une phrase » mais le TEST DES
// CINQ ENFANTS : cinq enfants vraiment distincts (causes, composantes,
// raisonnements) = on creuse ; cinq reformulations de la meme idee = une
// FONDATION de la pyramide (mure). La generation ne produit aucune punchline :
// la phrase s'obtient a la demande, noeud par noeud (geste « phrase »), et
// n'empeche pas de creuser. L'exemple de reference est le decoupage reel de
// Brice pendant ce live et les etiquettes du programme de la semaine de
// Melanie : un exemple de FORME, jamais de contenu a recopier.

/** La profondeur d'un noeud : 1 sous l'aieul, 2 en dessous... ; null (l'aieul) = 0. */
export function profondeurDe(noeuds: Noeud[], id: string | null): number {
  if (id === null || !noeuds.some((n) => n.id === id)) return 0
  return ancetres(noeuds, id).length + 1
}

/** Le test qui decide si un noeud se creuse ou s'il est une fondation. */
export const TEST_DES_CINQ_ENFANTS = 'LE TEST DES CINQ ENFANTS, pour chaque nœud : peux-tu lui trouver cinq enfants réellement distincts '
  + '(des causes, des composantes, des raisonnements différents, pas la même idée redite) ? Si oui, il se creuse : il reçoit '
  + 'ses enfants. Si les enfants possibles ne seraient que des tournures différentes de la même phrase, c\'est une FONDATION '
  + 'de la pyramide : `mure` = true, aucun enfant. Un concept qu\'on sait déjà dire en une phrase peut très bien se creuser '
  + 'encore (ses causes, ses raisonnements) : « ça tient en une phrase » ne décide jamais de l\'arrêt.'

/** La forme des pieces rendues a la profondeur `p` (1 = sous l'aieul), enfants compris. */
export function consigneNiveau(p: number): string {
  const forme = 'Chaque nœud est nommé : `idee` = son nom court (1 à 4 mots), `texte` = une ligne qui dit ce qu\'il couvre. '
    + 'Jamais de phrase punchline.'
  if (p <= 1) {
    return 'profondeur 1, sous l\'aïeul : des IDÉES, des CONCEPTS ou des RAISONS. Des catégories du type des étiquettes d\'un '
      + 'programme de lives conviennent souvent (« La psychologie », « Le détachement émotionnel ») ; une raison est aussi un '
      + 'bon nœud (« Le tilt », une raison de pourquoi ça arrive). ' + forme + ' Puis le test des cinq enfants sur chacun.'
  }
  return `profondeur ${p} : des idées, concepts ou raisons plus petits que leur parent (ses causes, ses composantes, ses `
    + `raisonnements). ${forme} Puis le test des cinq enfants sur chacun. La profondeur ne décide rien : une branche peut `
    + 'avoir besoin de deux niveaux, une autre de quatre.'
}

export const CONSIGNE_DU_GENERAL_AU_PARTICULIER = [
  'DU GÉNÉRAL AU PARTICULIER, EN CONCEPTS. Tu cherches des concepts, pas des phrases. Un nœud est une idée, un concept ou une raison (une cause), toujours nommé, et il sert d\'ancrage à ce qu\'il contient : ses causes, ses composantes, ses raisonnements. La ligne NIVEAU DES PIÈCES À RENDRE dit la forme attendue : elle prime sur toute consigne du prompt qui demanderait des pièces ou des feuilles d\'une phrase.',
  TEST_DES_CINQ_ENFANTS,
  'AUCUNE PUNCHLINE, nulle part, pas même aux fondations : une fondation garde son nom et sa ligne. La phrase qui explique un nœud se demande à part, nœud par nœud, et ne l\'empêche pas d\'être creusé.',
  'Au niveau 1, une catégorie fait un ou quelques mots, du type des étiquettes d\'un programme de lives (« Gestion du risque », « Psychologie », « Discipline », « Résultats » ; ou « Organisation », « Adaptation », « Performance ») : jamais une phrase, jamais un verbe conjugué. Si la phrase de l\'objet, son titre ou la matière collée portent déjà de telles étiquettes, elles sont la première base du niveau 1 (garde-les, complète ou fusionne, et dis-le dans l\'angle).',
  'Champs : `idee` = le nom court (toujours), `texte` = ce qu\'il couvre en une ligne (jamais une punchline), `mure` = true pour une fondation, false sinon.',
  'Donne un niveau d\'enfants sous chaque nœud de profondeur 1 qui passe le test des cinq enfants, quand tu as de quoi.',
  'EXEMPLE DE FORME (pas de contenu à recopier). Objet : « Pourquoi tu crames tes comptes et comment arrêter ? ». Mauvais premier niveau : « Tu ne crames pas un compte sur un trade, tu le crames sur une tension psychologique que tu cherches à faire baisser » (une punchline : elle ne se génère pas, l\'auteur la demandera sur le nœud qu\'elle explique). Bon premier niveau, celui de l\'auteur en live : 1. idee « La conscience du corps », texte « le tilt se sent avant de se voir : signaux physiques, pause, bilan après la session » ; 2. « La nature des comptes » (challenge jetable contre compte propre, coûts cachés des validations) ; 3. « Le détachement » (les gains latents qui poussent à forcer, l\'objectif à long terme) ; 4. « La technique et les routines » (la rupture de routine comme alerte, un seul actif de référence) ; 5. « Les données » (exporter l\'historique avant de réinitialiser, l\'analyser). Les enfants de « La conscience du corps » : « Les signaux physiques du stress », « La pause dès les premiers signes », « Le bilan après chaque session », « L\'auto-sabotage ».',
  'EXEMPLE DE CHAÎNE (forme encore). « Le tilt » est une raison : il a sa bulle, et il se décompose en cinq raisons qui peuvent générer l\'état de tilt, dont « Le FOMO ». « Le FOMO » se creuse encore si on peut l\'expliquer de cinq façons réellement différentes (cinq causes ou raisonnements distincts) ; si ces cinq explications ne sont que des tournures de la même phrase, « Le FOMO » est une fondation (`mure` = true).',
].join('\n')

/**
 * Le geste « phrase » (27/10/2026, Brice : « je dois avoir la possibilite, en
 * cliquant sur un bouton, d'avoir une phrase pour expliquer ce concept, mais je
 * dois pouvoir continuer de creuser la pyramide »). Un appel court, sur UN noeud.
 */
export const CONSIGNE_PHRASE = [
  'UNE PHRASE POUR EXPLIQUER LE NŒUD CIBLE. Rends trois phrases au plus (une seule si le concept est simple et qu\'une deuxième ne serait qu\'une tournure de la première), au choix de l\'auteur.',
  'Chaque phrase explique le concept (son nom et ce qu\'il couvre) à quelqu\'un qui ne le connaît pas : une seule phrase, dans la voix de l\'auteur (tutoiement, phrases courtes, mots simples, aucun tiret long).',
  'Les trois phrases prennent trois angles différents (une cause, une image, une conséquence...), jamais trois tournures de la même.',
  'Appuie-toi sur la LIGNÉE (ce que le nœud sert au-dessus de lui), sur ses enfants s\'il en a, et sur la matière fournie. N\'invente aucun vécu ni aucun chiffre. Une citation de la RÉFÉRENCE se formule comme elle le demande.',
  'La phrase ne ferme rien : le nœud garde ses enfants et peut encore se creuser. Ne propose ni enfants ni découpage.',
].join('\n')

/**
 * La regle d'un NOM, commune aux gestes idee et idees (27/10/2026, Brice :
 * « Florent prenait sur la prop firm des trades qu'il n'aurait jamais pris sur
 * son compte propre » se resume par « Non-respect de la prop firm »).
 */
export const REGLE_DU_NOM = [
  'UN NOM, PAS UNE PHRASE. Un nom fait 1 à 5 mots : une idée, un concept ou une raison (« Le tilt », « Le FOMO », « Non-respect de la prop firm », « La revanche sur le marché »). Jamais une phrase, jamais un verbe conjugué, pas de point final, aucun tiret long.',
  'Le nom dit ce que le texte du nœud ILLUSTRE, pas ce qu\'il raconte : tu nommes la grande idée dont la phrase est un exemple, tu ne la résumes pas mot à mot. Exemple : « Florent prenait sur la prop firm des trades qu\'il n\'aurait jamais pris sur son compte propre » se nomme « Non-respect de la prop firm » (ou « Le compte des autres »), jamais « Florent et ses trades sur la prop firm ».',
  'Pas de prénom ni de cas particulier dans le nom : le nom tient pour tous les cas que le nœud pourrait illustrer.',
  'Appuie-toi sur la LIGNÉE (le nom doit tenir sous son parent, sans le répéter), sur ses enfants s\'il en a, et sur la matière fournie. Si la matière de l\'auteur nomme déjà cette idée, reprends son mot.',
  'Ne touche jamais au texte du nœud : seul le nom est demandé. Ne propose ni enfants, ni découpage, ni phrase.',
].join('\n')

/** Le geste « idee » : trois noms pour UN noeud. Un appel court. */
export const CONSIGNE_IDEE = [
  'LE NOM DU NŒUD CIBLE. Rends trois noms au plus, au choix de l\'auteur, qui prennent trois angles différents (l\'idée, le concept, la raison), jamais trois tournures du même.',
  REGLE_DU_NOM,
].join('\n')

/** Le geste « idees » : trois noms pour chacun des noeuds sans nom, en un appel. */
export const CONSIGNE_IDEES = [
  'LES NOMS DES NŒUDS À NOMMER. Pour CHAQUE nœud de la liste NŒUDS À NOMMER, et seulement pour eux : sa ref telle qu\'elle figure dans la liste, et trois noms au plus, au choix de l\'auteur, qui prennent des angles différents.',
  'Deux nœuds frères ne reçoivent pas le même nom : s\'ils disent la même idée, dis-le par deux noms qui marquent la différence.',
  REGLE_DU_NOM,
].join('\n')

// --- Le systeme ---------------------------------------------------------------

const CONSIGNES_COMMUNES = [
  'Réponds en français, tutoiement, phrases courtes, aucun tiret long. Les `ref` que tu renvoies sont celles du tableau, jamais les num.',
  'Dans les tableaux : num = la numérotation que l\'auteur voit, ref = l\'identifiant interne de la pièce, parent_ref = la ref de son parent (- = directement sous l\'aïeul), statut = a_redecouper (a des enfants), trou (marque q), mure (une fondation : ses enfants ne seraient que des reformulations), brut (pas encore jugé).',
  'Marques (tableaux et outil) : v = [V] vécu de l\'auteur, b = [B] cas ou passage de la matière fournie (banque-contenus, ou une page d\'un PDF de l\'auteur : source « PDF <fichier>, p. <n> »), i = [I] mention dans idees-du-moment, m = [M] thèse sans cas (y compris une citation de la RÉFÉRENCE, jamais b : ce n\'est pas la matière de l\'auteur), q = [?] rien encore (un trou, qui devient une question), fait = [fait], a_faire = [a faire]. Usage savoir : v, b, i, m, q. Usage production : fait, a_faire, q.',
].join('\n')

const CONSIGNES_GESTE: Record<Geste, string> = {
  assiste: [
    'Pour chaque pièce sous la CIBLE, une proposition : garder, remplacer (texte = la nouvelle phrase) ou deplacer (vers = ref du nouveau parent, null = sous l\'aïeul), avec sa raison en une ligne.',
    'Ce qui manque : action ajouter, cible = ref du parent (null = l\'aïeul), texte, marque et source exacte.',
    'questions : une par trou, dans l\'ordre de l\'arbre, cible = ref de la pièce concernée.',
    'Usage savoir : sans_vecu = les refs des pièces sans aucune feuille v.',
  ].join('\n'),
  genere: [
    `Trois découpages au plus, chacun avec un nom court (« Par le symptôme »), son angle en une phrase et ses pièces : cinq par défaut, jamais une pièce inventée pour atteindre cinq.`,
    CONSIGNE_DU_GENERAL_AU_PARTICULIER,
    'Une pièce sans matière : marque q, et la question à poser à l\'auteur dans question.',
  ].join('\n'),
  phrase: CONSIGNE_PHRASE,
  idee: CONSIGNE_IDEE,
  idees: CONSIGNE_IDEES,
  titre: [
    'candidates : les feuilles qui tiennent la promesse du titre, de la meilleure à la moins bonne, avec decoupage_id et ref tels qu\'ils figurent dans les ARBRES, le verdict (tient, depasse, trahit) et la raison en une ligne.',
    'Si rien ne tient : manque = la pièce d\'arbre qui manque et les questions à poser à Brice pour la construire. Sinon manque = null.',
  ].join('\n'),
}

/** Le texte systeme : le prompt de la methode, puis les consignes de sortie. */
export function texteSysteme(prompt: string, geste: Geste): string {
  return [
    prompt.trim(),
    '---',
    `Ta sortie passe uniquement par l'outil ${OUTILS[geste].name} : il remplace la section « Sortie » du prompt ci-dessus.`,
    CONSIGNES_COMMUNES,
    CONSIGNES_GESTE[geste],
  ].join('\n\n')
}

/** Le bloc systeme de la matiere de l'auteur (seulement pour Brice). */
export function texteMatiere(matieres: Array<{ nom: string; contenu: string }>): string {
  return [
    "MATIÈRE DE L'AUTEUR (extraits fournis, la seule matière avec ce qu'il a dit et ce qu'il colle) :",
    ...matieres.map((m) => `\n=== ${m.nom} ===\n${m.contenu.trim()}`),
  ].join('\n')
}

// --- La matiere des PDF de l'auteur (cockpit_matiere_pages) --------------------
//
// Le texte des PDF d'un auteur, une ligne par page, extrait par
// extraire_matiere_pdf.py (automations du pilotage). La route cherche les
// pages de l'auteur du decoupage (to_tsquery francais, en OU sur les mots
// ci-dessous, tri par ts_rank) et n'en garde que les meilleures, jusqu'a
// environ MAX_MATIERE_PDF caracteres. Une feuille adossee a une page est [B],
// source « PDF <fichier>, p. <n> » (methode, Prompt 1, regle 5).

export type PageMatiere = { source: string; page: number; texte: string }

export const MAX_MOTS_RECHERCHE = 25
export const MAX_MATIERE_PDF = 40_000
const MIN_LONGUEUR_MOT = 4

/**
 * Des mots de 4 lettres et plus qui ne disent rien de l'objet. Le
 * dictionnaire francais de Postgres en ecarte deja une partie : ceux-ci ne
 * prennent pas une des 25 places.
 */
const MOTS_VIDES = new Set([
  'ainsi', 'alors', 'après', 'apres', 'aussi', 'autre', 'autres', 'avant', 'avec', 'avoir', 'bien',
  'celle', 'celles', 'celui', 'cela', 'ceci', 'cette', 'ceux', 'chaque', 'chez', 'comme', 'comment',
  'contre', 'dans', 'déjà', 'deja', 'depuis', 'doit', 'donc', 'dont', 'elle', 'elles', 'encore',
  'entre', 'était', 'etait', 'être', 'etre', 'fait', 'faire', 'faut', 'jamais', 'leur', 'leurs',
  'lorsque', 'mais', 'même', 'meme', 'mêmes', 'moins', 'notre', 'nous', 'parce', 'pendant', 'peut',
  'plus', 'plusieurs', 'pour', 'pourquoi', 'puis', 'quand', 'quel', 'quelle', 'quelles', 'quels',
  'quelque', 'quelques', 'quoi', 'sans', 'selon', 'sera', 'sinon', 'soit', 'sont', 'sous', 'tant',
  'toujours', 'tous', 'tout', 'toute', 'toutes', 'très', 'tres', 'trop', 'vers', 'voici', 'voilà',
  'votre', 'vous',
])

/** Les ancetres d'un noeud, du plus proche au plus lointain (l'aieul n'en est pas : c'est l'objet). */
export function ancetres(noeuds: Noeud[], id: string): Noeud[] {
  const effectif = parentsEffectifs(noeuds)
  const parId = new Map(noeuds.map((n) => [n.id, n]))
  const res: Noeud[] = []
  const vus = new Set<string>([id])
  let p = effectif.get(id) ?? null
  while (p !== null && !vus.has(p)) {
    vus.add(p)
    const n = parId.get(p)
    if (!n) break
    res.push(n)
    p = effectif.get(p) ?? null
  }
  return res
}

/**
 * Les mots significatifs de textes, dans leur ordre d'apparition : lettres
 * seulement (« l'entière » donne « entière »), 4 caracteres et plus, en
 * minuscules, sans les mots vides, dedoublonnes, `max` au plus.
 * Exception : un sigle de 3 lettres ecrit en MAJUSCULES compte (FVG, BOS,
 * OTE, SMT, PDA : le vocabulaire ICT des PDF de Melanie est fait de sigles).
 */
export function motsSignificatifs(textes: Array<string | null | undefined>, max = MAX_MOTS_RECHERCHE): string[] {
  const mots: string[] = []
  const vus = new Set<string>()
  for (const t of textes) {
    if (typeof t !== 'string') continue
    for (const brut of t.normalize('NFC').match(/\p{L}+/gu) ?? []) {
      const mot = brut.toLowerCase()
      const sigle = [...brut].length === 3 && brut === brut.toUpperCase() && brut !== mot
      if (([...mot].length < MIN_LONGUEUR_MOT && !sigle) || MOTS_VIDES.has(mot) || vus.has(mot)) continue
      vus.add(mot)
      mots.push(mot)
      if (mots.length >= max) return mots
    }
  }
  return mots
}

/**
 * Les mots de la recherche dans la matiere d'un decoupage : le titre, la
 * phrase, le texte de la cible puis celui de ses ancetres, du plus proche au
 * plus lointain (au-dela de 25 mots, ce sont les plus lointains qui tombent).
 * Cible null (l'aieul) : le titre et la phrase seulement.
 */
export function motsDuDecoupage(titre: string, phrase: string | null, noeuds: Noeud[], cible: string | null): string[] {
  const n = cible ? noeuds.find((x) => x.id === cible) ?? null : null
  const lignee = n ? [n, ...ancetres(noeuds, n.id)] : []
  return motsSignificatifs([titre, phrase, ...lignee.map((x) => x.texte)])
}

/** La requete to_tsquery : les mots en OU. Que des lettres, donc rien a echapper. Vide = pas de recherche. */
export function requeteTsquery(mots: string[]): string {
  return mots.filter((m) => /^\p{L}+$/u.test(m)).join(' | ')
}

/**
 * Les pages a envoyer, prises dans l'ordre recu (le meilleur ts_rank
 * d'abord) jusqu'a environ `max` caracteres : on s'arrete a la premiere page
 * qui ferait deborder. La premiere passe toujours (coupee a `max` si elle
 * depasse a elle seule).
 */
export function choisirPages<T extends PageMatiere>(pages: T[], max = MAX_MATIERE_PDF): T[] {
  const gardees: T[] = []
  let total = 0
  for (const p of pages) {
    const texte = typeof p.texte === 'string' ? p.texte.trim() : ''
    if (!texte) continue
    if (gardees.length && total + texte.length > max) break
    const coupe = texte.slice(0, max)
    gardees.push({ ...p, texte: coupe })
    total += coupe.length
  }
  return gardees
}

/** Le libelle d'une page, celui que la feuille prend pour source : « PDF la discipline en trading, p. 11 ». */
export function libellePage(source: string, page: number): string {
  return `PDF ${source.replace(/\.pdf$/i, '').trim()}, p. ${page}`
}

/** Le bloc systeme des pages de PDF : rangees par fichier puis par page, chacune sous son libelle. */
export function texteMatierePdf(pages: PageMatiere[]): string {
  const rangees = [...pages].sort((a, b) => a.source.localeCompare(b.source, 'fr') || a.page - b.page)
  return [
    "MATIÈRE DE L'AUTEUR : PAGES DE SES PDF (retrouvées par une recherche sur l'objet et la cible). "
      + "Chaque page commence par son libellé, « PDF <fichier>, p. <n> » : une feuille qui s'adosse à une page "
      + 'est marquée b, et ce libellé exact est sa source.',
    ...rangees.map((p) => `\n${libellePage(p.source, p.page)} :\n${p.texte.trim()}`),
  ].join('\n')
}

// --- La reference commune (cockpit_matiere_pages, reference = true) -------------
//
// Les PDF d'un tiers (ICT : notes du mentorship, glossaire, SMT), extraits par
// extraire_matiere_pdf.py --reference (migration 20261016170000). Ce n'est la
// matiere d'aucun auteur : la route les cherche pour TOUT decoupage, avec la
// meme requete que la matiere de l'auteur, en garde les meilleures jusqu'a
// environ MAX_REFERENCE caracteres, et les envoie dans un bloc systeme a part.
// Une feuille qui ne repose que sur elle se formule « ICT a dit [...] »,
// marque [M], source « ICT, <fichier>, p. <n> » (methode, Prompt 1, regle 5).
// Le tiers est la colonne auteur de la page : rien d'ICT n'est ecrit ici.

/** Une page de reference : son tiers (la colonne auteur, ex. ICT) en plus. */
export type PageReference = PageMatiere & { auteur: string }

export const MAX_REFERENCE = 15_000

/** Les tiers des pages, sans doublon, dans l'ordre alphabetique. */
export function tiersReference(pages: PageReference[]): string[] {
  const tiers = new Set(pages.map((p) => (typeof p.auteur === 'string' ? p.auteur.trim() : '')).filter(Boolean))
  return [...tiers].sort((a, b) => a.localeCompare(b, 'fr'))
}

/** La consigne de citation. Un seul tiers : son nom en clair. Plusieurs : un gabarit. */
export function consigneReference(tiers: string[]): string {
  const t = tiers.length === 1 ? tiers[0] : '<tiers>'
  return `une feuille qui ne repose que sur elle se formule « ${t} a dit [...] », marque m ([M]), source « ${t}, <fichier>, p. <n> »`
    + (tiers.length > 1 ? ' (le tiers est le début du libellé de la page)' : '')
}

/** Le libelle d'une page de reference, celui que la feuille prend pour source : « ICT, MONTH 6 NOTES, p. 12 ». */
export function libelleReference(auteur: string, source: string, page: number): string {
  return `${auteur.trim() || 'Référence'}, ${source.replace(/\.pdf$/i, '').trim()}, p. ${page}`
}

/** Le bloc systeme de la reference : a part, nomme comme tel, rangee par tiers, fichier puis page. */
export function texteReference(pages: PageReference[]): string {
  const tiers = tiersReference(pages)
  const rangees = [...pages].sort((a, b) =>
    (a.auteur ?? '').localeCompare(b.auteur ?? '', 'fr') || a.source.localeCompare(b.source, 'fr') || a.page - b.page)
  return [
    `RÉFÉRENCE (${tiers.join(', ') || 'un tiers'}, pas la matière de l'auteur) : ${consigneReference(tiers)}. `
      + "Elle aide à nommer, à vérifier et à citer. Pages retrouvées par une recherche sur l'objet et la cible, "
      + 'chacune sous son libellé.',
    ...rangees.map((p) => `\n${libelleReference(p.auteur ?? '', p.source, p.page)} :\n${p.texte.trim()}`),
  ].join('\n')
}

// --- Les outils (un seul par appel, force par tool_choice) ----------------------

type Schema = { type: 'object'; properties: Record<string, unknown>; required: string[] }
export type Outil = { name: string; description: string; input_schema: Schema }

const REF_OU_NULL = { type: ['string', 'null'] }
const MARQUE = { type: ['string', 'null'], enum: [...MARQUES, null] }
const PIECE_ENFANT = {
  type: 'object',
  properties: {
    idee: {
      type: 'string',
      description: 'Le nom court du nœud, toujours : une idée, un concept ou une raison (1 à 4 mots, ex. « La psychologie », « Le tilt », « Le FOMO »).',
    },
    texte: { type: 'string', description: 'Ce que le nœud couvre, en une ligne. Jamais une punchline.' },
    mure: { type: 'boolean', description: 'true = une fondation : ses enfants possibles ne seraient que des reformulations (test des cinq enfants).' },
    marque: MARQUE,
    source: { type: ['string', 'null'], description: 'Source exacte, ou null.' },
    question: { type: ['string', 'null'], description: 'Pour un trou (marque q) : la question à poser à l\'auteur.' },
  },
  required: ['idee', 'texte', 'mure', 'marque', 'source'],
}
/** Un nom court (gestes idee et idees). */
const NOM = {
  type: 'string',
  description: 'Un nom de 1 à 5 mots : une idée, un concept ou une raison. Jamais une phrase, pas de verbe conjugué, pas de point final.',
}

export const OUTILS: Record<Geste, Outil> = {
  assiste: {
    name: 'rendre_assistance',
    description: 'Rend le jugement des pièces de l\'auteur sous la cible, ce qui manque, et les questions des trous.',
    input_schema: {
      type: 'object',
      properties: {
        propositions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cible: { ...REF_OU_NULL, description: 'ref de la pièce concernée, null = l\'aïeul. Pour ajouter : la ref du parent.' },
              action: { type: 'string', enum: [...ACTIONS] },
              texte: { type: 'string', description: 'remplacer et ajouter : la phrase.' },
              vers: { ...REF_OU_NULL, description: 'deplacer : ref du nouveau parent, null = sous l\'aïeul.' },
              marque: MARQUE,
              source: { type: ['string', 'null'], description: 'Source exacte, ou null.' },
              raison: { type: 'string', description: 'Une ligne.' },
            },
            required: ['cible', 'action', 'raison'],
          },
        },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cible: { ...REF_OU_NULL, description: 'ref de la pièce du trou, null = l\'aïeul.' },
              question: { type: 'string' },
            },
            required: ['cible', 'question'],
          },
        },
        sans_vecu: { type: 'array', items: { type: 'string' }, description: 'Usage savoir : refs des pièces sans aucune feuille v.' },
      },
      required: ['propositions', 'questions'],
    },
  },
  genere: {
    name: 'rendre_decoupages',
    description: 'Rend trois découpages au plus de la cible, chacun avec son angle.',
    input_schema: {
      type: 'object',
      properties: {
        decoupages: {
          type: 'array',
          maxItems: MAX_DECOUPAGES_GENERES,
          items: {
            type: 'object',
            properties: {
              nom: { type: 'string', description: 'Court, ex. « Par le symptôme ».' },
              angle: { type: 'string', description: 'Une phrase.' },
              pieces: {
                type: 'array',
                items: {
                  ...PIECE_ENFANT,
                  properties: { ...PIECE_ENFANT.properties, enfants: { type: 'array', items: PIECE_ENFANT } },
                },
              },
            },
            required: ['nom', 'angle', 'pieces'],
          },
        },
      },
      required: ['decoupages'],
    },
  },
  phrase: {
    name: 'rendre_phrases',
    description: 'Rend trois phrases au plus qui expliquent le nœud cible, au choix de l\'auteur.',
    input_schema: {
      type: 'object',
      properties: {
        phrases: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_PHRASES,
          items: { type: 'string', description: 'Une phrase, dans la voix de l\'auteur : tutoiement, phrases courtes, aucun tiret long.' },
        },
      },
      required: ['phrases'],
    },
  },
  idee: {
    name: 'rendre_noms',
    description: 'Rend trois noms courts au plus pour le nœud cible (la grande idée que son texte illustre), au choix de l\'auteur.',
    input_schema: {
      type: 'object',
      properties: {
        noms: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_NOMS,
          items: NOM,
        },
      },
      required: ['noms'],
    },
  },
  idees: {
    name: 'rendre_noms_du_lot',
    description: 'Rend, pour chaque nœud à nommer, sa ref et trois noms courts au plus.',
    input_schema: {
      type: 'object',
      properties: {
        noeuds: {
          type: 'array',
          maxItems: MAX_LOT_IDEES,
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'La ref du nœud, telle qu\'elle figure dans la liste NŒUDS À NOMMER.' },
              noms: { type: 'array', minItems: 1, maxItems: MAX_NOMS, items: NOM },
            },
            required: ['ref', 'noms'],
          },
        },
      },
      required: ['noeuds'],
    },
  },
  titre: {
    name: 'rendre_candidates',
    description: 'Rend les feuilles candidates pour le titre, et ce qui manque si rien ne tient.',
    input_schema: {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              decoupage_id: { type: 'string' },
              ref: { type: 'string' },
              verdict: { type: 'string', enum: [...VERDICTS] },
              raison: { type: 'string', description: 'Une ligne.' },
            },
            required: ['decoupage_id', 'ref', 'verdict', 'raison'],
          },
        },
        manque: {
          type: ['object', 'null'],
          properties: {
            piece: { type: 'string' },
            questions: { type: 'array', items: { type: 'string' } },
          },
          required: ['piece', 'questions'],
        },
      },
      required: ['candidates'],
    },
  },
}

// --- La validation de la sortie ---------------------------------------------

/**
 * Resout une ref rendue par l'IA. null = l'aieul, undefined = inconnue (a retirer).
 * Filet : un num (1.5) rendu a la place d'une ref est ramene a sa ref.
 */
function resolveur(noeuds: Noeud[]): (x: unknown) => string | null | undefined {
  const ids = new Set(noeuds.map((n) => n.id))
  const parNum = new Map([...numeroter(noeuds)].map(([id, num]) => [num, id]))
  return (x) => {
    if (x === null) return null
    if (typeof x !== 'string') return undefined
    const s = x.trim()
    if (!s || /^(-|null|a[iï]eul|l'a[iï]eul)$/i.test(s)) return null
    if (ids.has(s)) return s
    return parNum.get(s.replace(/^num\s*/i, ''))
  }
}

export function validerAssiste(brut: unknown, noeuds: Noeud[]): ContenuAssiste {
  const b = estObjet(brut) ? brut : {}
  const resoudre = resolveur(noeuds)
  const propositions: PropositionAssiste[] = []
  for (const p of liste(b.propositions).slice(0, 100)) {
    if (!estObjet(p)) continue
    const action = p.action as Action
    if (!ACTIONS.includes(action)) continue
    const cible = p.cible === undefined && action === 'ajouter' ? null : resoudre(p.cible)
    if (cible === undefined) continue
    const out: PropositionAssiste = { cible, action, raison: texte(p.raison, 500) ?? '' }
    if (action === 'remplacer' || action === 'ajouter') {
      const t = texte(p.texte, 1000)
      if (!t) continue
      out.texte = t
    }
    if (action === 'deplacer') {
      if (cible === null || !('vers' in p)) continue
      const vers = resoudre(p.vers)
      if (vers === undefined || vers === cible) continue
      if (vers !== null && descendants(noeuds, cible).has(vers)) continue
      out.vers = vers
    }
    if ('marque' in p) out.marque = normaliserMarque(p.marque)
    if ('source' in p) out.source = texte(p.source, 300)
    propositions.push(out)
  }

  const questions: ContenuAssiste['questions'] = []
  for (const q of liste(b.questions).slice(0, 60)) {
    if (!estObjet(q)) continue
    const question = texte(q.question, 500)
    if (!question) continue
    const cible = q.cible === undefined ? null : resoudre(q.cible)
    if (cible === undefined) continue
    questions.push({ cible, question })
  }

  const contenu: ContenuAssiste = { propositions, questions }
  if (Array.isArray(b.sans_vecu)) {
    contenu.sans_vecu = [...new Set(
      b.sans_vecu.map((x) => resoudre(x)).filter((x): x is string => typeof x === 'string'),
    )]
  }
  return contenu
}

function lirePiece(x: unknown, avecEnfants: boolean): PieceGeneree | null {
  if (!estObjet(x)) return null
  const t = texte(x.texte, 1000)
  if (!t) return null
  const piece: PieceGeneree = { texte: t, marque: normaliserMarque(x.marque), source: texte(x.source, 300) }
  if ('question' in x) piece.question = texte(x.question, 500)
  // Le nom court d'une categorie : sans point final (ce n'est pas une phrase).
  const idee = texte(x.idee, MAX_IDEE)?.replace(/[.\s]+$/, '')
  if (idee) piece.idee = idee
  if (avecEnfants) {
    const enfants = liste(x.enfants).slice(0, 12)
      .map((e) => lirePiece(e, false))
      .filter((e): e is PieceGeneree => e !== null)
    if (enfants.length) piece.enfants = enfants
  }
  // Une fondation n'a pas d'enfants : si l'IA en donne quand meme, le noeud se creuse.
  if (x.mure === true && !piece.enfants) piece.mure = true
  return piece
}

/** La sortie du geste phrase : 3 phrases au plus, non vides, sans doublon, sans tiret long. */
export function validerPhrase(brut: unknown): ContenuPhrase {
  const b = estObjet(brut) ? brut : {}
  const vues = new Set<string>()
  const phrases: string[] = []
  for (const x of liste(b.phrases)) {
    const p = texte(x, MAX_PHRASE)
    if (!p) continue
    const cle = p.toLowerCase().replace(/\s+/g, ' ')
    if (vues.has(cle)) continue
    vues.add(cle)
    phrases.push(p)
    if (phrases.length >= MAX_PHRASES) break
  }
  return { phrases }
}

/**
 * Un nom court propre, ou null : guillemets et ponctuation finale retires,
 * aucun tiret long, et plus de MAX_MOTS_NOM mots = une phrase, qui tombe.
 */
export function lireNom(x: unknown): string | null {
  const t = texte(x, MAX_IDEE)
  if (!t) return null
  const nom = t
    .replace(/^[\s«"“'‘]+|[\s»"”'’]+$/g, '')
    .replace(/[\s.!?…;:,]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!nom) return null
  if (nom.split(' ').filter((m) => /[\p{L}\p{N}]/u.test(m)).length > MAX_MOTS_NOM) return null
  return nom
}

/** Des noms : 3 au plus, propres, sans doublon (casse et espaces ignores). */
function lireNoms(x: unknown): string[] {
  const vus = new Set<string>()
  const noms: string[] = []
  for (const brut of liste(x)) {
    const nom = lireNom(brut)
    if (!nom) continue
    const cle = nom.toLowerCase()
    if (vus.has(cle)) continue
    vus.add(cle)
    noms.push(nom)
    if (noms.length >= MAX_NOMS) break
  }
  return noms
}

/** La sortie du geste idee : 3 noms courts au plus. */
export function validerIdee(brut: unknown): ContenuIdee {
  const b = estObjet(brut) ? brut : {}
  return { noms: lireNoms(b.noms) }
}

/**
 * La sortie du geste idees : seuls les noeuds DEMANDES (`aNommer`, les refs
 * envoyees) passent, une fois chacun, dans l'ordre de l'arbre ; un noeud sans
 * nom exploitable tombe.
 */
export function validerIdees(brut: unknown, noeuds: Noeud[], aNommer: string[]): ContenuIdees {
  const b = estObjet(brut) ? brut : {}
  const resoudre = resolveur(noeuds)
  const permis = new Set(aNommer)
  const parRef = new Map<string, string[]>()
  for (const x of liste(b.noeuds).slice(0, MAX_LOT_IDEES * 2)) {
    if (!estObjet(x)) continue
    const ref = resoudre(x.ref)
    if (typeof ref !== 'string' || !permis.has(ref) || parRef.has(ref)) continue
    const noms = lireNoms(x.noms)
    if (noms.length) parRef.set(ref, noms)
  }
  return { noeuds: aNommer.filter((r) => parRef.has(r)).map((ref) => ({ ref, noms: parRef.get(ref)! })) }
}

export function validerGenere(brut: unknown): ContenuGenere {
  const b = estObjet(brut) ? brut : {}
  const decoupages: ContenuGenere['decoupages'] = []
  for (const d of liste(b.decoupages).slice(0, 6)) {
    if (decoupages.length >= MAX_DECOUPAGES_GENERES) break
    if (!estObjet(d)) continue
    const pieces = liste(d.pieces).slice(0, 12)
      .map((x) => lirePiece(x, true))
      .filter((x): x is PieceGeneree => x !== null)
    if (!pieces.length) continue
    decoupages.push({ nom: texte(d.nom, 120) ?? `Découpage ${decoupages.length + 1}`, angle: texte(d.angle, 400) ?? '', pieces })
  }
  return { decoupages }
}

export function validerTitre(brut: unknown, arbres: LigneDecoupage[]): ContenuTitre {
  const b = estObjet(brut) ? brut : {}
  const resolveurs = new Map(arbres.map((a) => [a.id.toLowerCase(), resolveur(a.noeuds)]))
  const vus = new Set<string>()
  const candidates: ContenuTitre['candidates'] = []
  for (const c of liste(b.candidates).slice(0, 40)) {
    if (!estObjet(c)) continue
    const decoupageId = typeof c.decoupage_id === 'string' ? c.decoupage_id.trim().toLowerCase() : ''
    const resoudre = resolveurs.get(decoupageId)
    if (!resoudre) continue
    const ref = resoudre(c.ref)
    if (typeof ref !== 'string') continue
    const verdict = (typeof c.verdict === 'string'
      ? c.verdict.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      : '') as Verdict
    if (!VERDICTS.includes(verdict)) continue
    const cle = `${decoupageId}|${ref}`
    if (vus.has(cle)) continue
    vus.add(cle)
    candidates.push({ decoupage_id: decoupageId, ref, verdict, raison: texte(c.raison, 500) ?? '' })
  }

  let manque: ContenuTitre['manque'] = null
  if (estObjet(b.manque)) {
    const piece = texte(b.manque.piece, 600)
    if (piece) {
      manque = {
        piece,
        questions: liste(b.manque.questions).map((q) => texte(q, 500)).filter((q): q is string => q !== null).slice(0, 20),
      }
    }
  }
  return { candidates, manque }
}
