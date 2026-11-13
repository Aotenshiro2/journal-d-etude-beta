// LA RECHERCHE DANS TOUTES LES LECONS DE L'ACADEMIE (13/11/2026, FEATURE, branche
// academie-cloche-recherche ; brief D:\7_Agents\briefs\2026-11-13-cloche-et-recherche.md).
//
// Avant : la recherche n'existait que dans Rediffusion des Lives (titres, et « ce qui a
// ete dit » prepare a l'avance). Ici : un champ dans le bandeau du site, des resultats par
// module et par lecon, cherches dans le titre de la lecon, le titre et le resume du module,
// et le TEXTE de la lecon (le Markdown d'une lecon ecrite, le texte sous une video).
//
// LES ACCES (le point qui compte) : le texte d'une lecon ne sort JAMAIS si la lecon n'est
// pas ouverte pour ce compte. Une lecon fermee qui correspond apparait avec son titre (deja
// public dans le catalogue) et son cadenas, SANS extrait. Un visiteur sans compte ne recoit
// d'extrait que pour une lecon d'apercu (raison 'apercu') : ce qu'un compte gratuit ouvre se
// lit avec un compte. La route decide (ouvertureLecon) ; ce fichier applique.
//
// LA REGLE DE CORRESPONDANCE (comme norm() de Rediffusion, site src/academie/rediffusion.ts :
// sans accents, sans majuscules) :
// - la recherche est coupee en mots (2 caracteres au moins, ou un nombre) ;
// - une lecon correspond si CHAQUE mot est dans son titre, son texte ou le titre de son
//   module, et au moins un dans son titre ou son texte (« psychologie peur » trouve la
//   lecon du module Psychologie qui parle de peur) ;
// - un module correspond si chaque mot est dans son titre ou son resume ;
// - classement : le titre d'abord, puis la phrase entiere, puis le nombre d'occurrences.
//
// CE FICHIER N'IMPORTE RIEN, expres : scripts/verifier-cloche-recherche.mjs et
// scripts/essayer-cloche-recherche.mjs l'importent tel quel sous Node 22.

export const MIN_Q = 2
export const MAX_Q = 80
export const MAX_TERMES = 6
/** Lecons montrees au plus, tous modules confondus. */
export const MAX_LECONS = 60
/** Lecons montrees au plus par module (n dit combien correspondent en tout). */
export const MAX_PAR_MODULE = 8
/** Largeur d'un extrait, en caracteres. */
export const LARGEUR_EXTRAIT = 220
/** Avant le premier mot trouve, dans l'extrait. */
const AVANT = 70
/** Occurrences comptees au plus par mot (classement). */
const MAX_OCCURRENCES = 10

// ---------------------------------------------------------------------------
// Le texte
// ---------------------------------------------------------------------------

/** Sans accents et sans majuscules (la regle de norm() de Rediffusion, sans trim). */
export function normaliser(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Les mots de la recherche, normalises, dans l'ordre (la phrase entiere, mots vides compris). */
export function motsDe(q: string): string[] {
  return normaliser(q.slice(0, MAX_Q)).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** Les mots vides : ils ne comptent pas, sauf si la recherche n'a qu'eux. */
const MOTS_VIDES = new Set([
  'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'en', 'au', 'aux', 'ce', 'ces', 'se', 'sa', 'son', 'ses', 'sur',
  'par', 'pour', 'que', 'qui', 'est', 'il', 'je', 'tu', 'on', 'ou', 'dans', 'avec', 'ne', 'pas', 'mon', 'ma', 'mes', 'ton',
  'ta', 'tes', 'the', 'of', 'and', 'to', 'in',
])

/**
 * Les mots cherches : normalises, uniques, 2 caracteres au moins (ou un nombre), sans les mots
 * vides (« plan de trading » cherche plan et trading), MAX_TERMES au plus.
 */
export function termesDe(q: string): string[] {
  const tous: string[] = []
  for (const t of motsDe(q)) {
    if ((t.length < MIN_Q && !/^\d+$/.test(t)) || tous.includes(t)) continue
    tous.push(t)
  }
  const pleins = tous.filter(t => !MOTS_VIDES.has(t))
  return (pleins.length ? pleins : tous).slice(0, MAX_TERMES)
}

/**
 * Le Markdown d'une lecon en texte brut, sur une ligne : sans images ni balises, liens
 * reduits a leur texte, sans titres, puces, blocs ::: ni signes de mise en forme.
 */
export function texteBrut(markdown: string | null | undefined): string {
  return (markdown ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*•+]|\d+[.)])\s+/gm, '')
    .replace(/^:::.*$/gm, ' ')
    .replace(/[*_`>~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Un texte pret a chercher : le brut (pour l'extrait), le normalise (pour chercher), et la
 * carte des positions quand la normalisation change la longueur (rare : un caractere
 * combinant isole, un syllabaire). carte[i] = position dans brut du caractere i de norm.
 */
export type TexteIndexe = { brut: string; norm: string; carte: Int32Array | null }

export function indexer(brut: string): TexteIndexe {
  const norm = normaliser(brut)
  if (norm.length === brut.length) return { brut, norm, carte: null }
  const morceaux: string[] = []
  const carte: number[] = []
  let i = 0
  for (const c of brut) {
    const n = normaliser(c)
    for (let k = 0; k < n.length; k++) carte.push(i)
    morceaux.push(n)
    i += c.length
  }
  return { brut, norm: morceaux.join(''), carte: Int32Array.from(carte) }
}

const versBrut = (t: TexteIndexe, p: number) => (t.carte ? (t.carte[Math.min(p, t.carte.length - 1)] ?? 0) : p)

function occurrences(norm: string, terme: string, max = MAX_OCCURRENCES): number {
  let n = 0
  let i = norm.indexOf(terme)
  while (i >= 0 && n < max) { n++; i = norm.indexOf(terme, i + terme.length) }
  return n
}

/**
 * L'extrait autour de la phrase entiere si elle y est, sinon du premier mot trouve :
 * LARGEUR_EXTRAIT caracteres, coupes sur des espaces, « … » de chaque cote coupe.
 */
export function extraitAutour(t: TexteIndexe, termes: string[], phrase: string): string | null {
  let p = phrase.includes(' ') ? t.norm.indexOf(phrase) : -1
  if (p < 0) {
    for (const x of termes) {
      const i = t.norm.indexOf(x)
      if (i >= 0 && (p < 0 || i < p)) p = i
    }
  }
  if (p < 0) return null
  const b = versBrut(t, p)
  const len = t.brut.length
  let debut = Math.max(0, b - AVANT)
  let fin = Math.min(len, debut + LARGEUR_EXTRAIT)
  if (fin === len) debut = Math.max(0, fin - LARGEUR_EXTRAIT)
  if (debut > 0) {
    const e = t.brut.indexOf(' ', debut)
    if (e >= 0 && e < b) debut = e + 1
  }
  if (fin < len) {
    const e = t.brut.lastIndexOf(' ', fin)
    if (e > b) fin = e
  }
  const corps = t.brut.slice(debut, fin).trim()
  return `${debut > 0 ? '…' : ''}${corps}${fin < len ? '…' : ''}`
}

// ---------------------------------------------------------------------------
// La recherche
// ---------------------------------------------------------------------------

export type ModuleCherchable = {
  id: string; slug: string; titre: string; resume: string | null; ordre: number; lienExterne: string | null
}
export type LeconCherchable = {
  id: string; moduleId: string; slug: string; titre: string; type: string; dureeS: number | null; ordre: number
  section: string | null
}
export type Ouverture = { acces: 'ouvert' | 'ferme' | 'inconnu'; raisons: readonly string[] }

export type LeconTrouvee = {
  slug: string
  titre: string
  type: string
  duree_s: number | null
  section: string | null
  acces: 'ouvert' | 'ferme' | 'inconnu'
  /** Ou les mots ont ete trouves : le titre, le texte (ou les deux). */
  ou: ('titre' | 'texte')[]
  /** Un passage du texte, SEULEMENT si la lecon est ouverte pour ce compte (sinon null). */
  extrait: string | null
}

export type ModuleTrouve = {
  slug: string
  titre: string
  resume: string | null
  /** Le titre ou le resume du module contient tous les mots. */
  correspond: boolean
  /** Le nombre de lecons du module qui correspondent (MAX_PAR_MODULE montrees au plus). */
  n: number
  lecons: LeconTrouvee[]
}

export type Resultats = { termes: string[]; total: number; modules: ModuleTrouve[] }

export type EntreeRecherche = {
  q: string
  modules: readonly ModuleCherchable[]
  /** Les lecons LISIBLES seulement (lecon et module publies) : la route les choisit. */
  lecons: readonly LeconCherchable[]
  textes: ReadonlyMap<string, TexteIndexe>
  ouverture: (l: LeconCherchable) => Ouverture
  /** L'extrait d'une lecon ouverte peut-il sortir (visiteur : apercu seulement) ? */
  extraitPermis: (o: Ouverture) => boolean
}

type Trouvee = { l: LeconCherchable; score: number; sortie: LeconTrouvee }

export function chercher(e: EntreeRecherche): Resultats {
  const termes = termesDe(e.q)
  if (!termes.length) return { termes, total: 0, modules: [] }
  // La phrase entiere, mots vides compris (« plan de trading ») : bonus au classement, et l'extrait la prefere.
  const phrase = motsDe(e.q).join(' ')

  const modules = new Map(e.modules.map(m => [m.id, m]))
  const titresModules = new Map(e.modules.map(m => [m.id, normaliser(m.titre)]))
  const parModule = new Map<string, Trouvee[]>()
  let total = 0

  for (const l of e.lecons) {
    const m = modules.get(l.moduleId)
    if (!m) continue
    const titre = normaliser(l.titre)
    const texte = e.textes.get(l.id) ?? null
    const titreModule = titresModules.get(l.moduleId) ?? ''
    const enTitre = termes.filter(t => titre.includes(t))
    const enTexte = texte ? termes.filter(t => texte.norm.includes(t)) : []
    if (!enTitre.length && !enTexte.length) continue
    if (!termes.every(t => enTitre.includes(t) || enTexte.includes(t) || titreModule.includes(t))) continue

    const o = e.ouverture(l)
    let score = enTitre.length * 10 + (titre.includes(phrase) ? 25 : 0)
    if (texte) {
      for (const t of enTexte) score += occurrences(texte.norm, t)
      if (phrase.includes(' ') && texte.norm.includes(phrase)) score += 5
    }
    const ou: ('titre' | 'texte')[] = []
    if (enTitre.length) ou.push('titre')
    if (enTexte.length) ou.push('texte')
    const extrait = texte && enTexte.length && o.acces === 'ouvert' && e.extraitPermis(o)
      ? extraitAutour(texte, termes, phrase) : null
    const liste = parModule.get(l.moduleId) ?? []
    liste.push({
      l, score,
      sortie: { slug: l.slug, titre: l.titre, type: l.type, duree_s: l.dureeS, section: l.section, acces: o.acces, ou, extrait },
    })
    parModule.set(l.moduleId, liste)
    total++
  }

  const sortis: { m: ModuleCherchable; score: number; correspond: boolean; trouvees: Trouvee[] }[] = []
  for (const m of e.modules) {
    const champ = normaliser(`${m.titre} ${m.resume ?? ''}`)
    const correspond = termes.every(t => champ.includes(t))
    const trouvees = (parModule.get(m.id) ?? []).sort((a, b) => b.score - a.score || a.l.ordre - b.l.ordre)
    if (!correspond && !trouvees.length) continue
    sortis.push({ m, correspond, trouvees, score: (trouvees[0]?.score ?? 0) + (correspond ? 30 : 0) })
  }
  sortis.sort((a, b) => b.score - a.score || a.m.ordre - b.m.ordre || a.m.titre.localeCompare(b.m.titre))

  let montrees = 0
  const res: ModuleTrouve[] = sortis.map(({ m, correspond, trouvees }) => {
    const place = Math.max(0, Math.min(MAX_PAR_MODULE, MAX_LECONS - montrees))
    const lecons = trouvees.slice(0, place).map(t => t.sortie)
    montrees += lecons.length
    return { slug: m.slug, titre: m.titre, resume: m.resume, correspond, n: trouvees.length, lecons }
  })
  return { termes, total, modules: res }
}

// ---------------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------------

/**
 * Les textes des lecons LISIBLES (lecon et module publies), non vides. Lus par le
 * serveur seulement : ils ne sortent qu'en extrait, et pour une lecon ouverte.
 */
export const SQL_TEXTES_LECONS = `
select l.id::text as id, l.contenu
  from public.academie_lecons l
  join public.academie_modules m on m.id = l.module_id
 where m.statut = 'publie' and l.statut = 'publie'
   and l.contenu is not null and btrim(l.contenu) <> ''
`
