// Regrouper des textes courts proches (Pilotage 0.4, 10/11/2026) : les causes
// « Autre » que les membres donnent quand un compte part au cimetière. Brice :
// « quand une même proposition revient souvent, elle doit pouvoir rejoindre la
// liste ». Les textes arrivent déjà normalisés par le signal (minuscules, sans
// accents, lettres, chiffres et espaces, 60 caractères) ; on compare leurs mots
// utiles. Pur, sans base : scripts/lire-causes-cimetiere.mjs le nourrit.

/** Les mots qui ne disent rien de la cause. */
const VIDES = new Set([
  'a', 'ai', 'au', 'aux', 'avec', 'c', 'ce', 'ces', 'cette', 'd', 'dans', 'de', 'des', 'du', 'en', 'est', 'et', 'etait', 'il',
  'j', 'je', 'l', 'la', 'le', 'les', 'leur', 'm', 'ma', 'me', 'mes', 'mon', 'n', 'ne', 'on', 'ou', 'par', 'pas', 'plus', 'pour',
  'qu', 'que', 'qui', 's', 'sa', 'se', 'ses', 'son', 'sur', 't', 'trop', 'tres', 'un', 'une', 'y', 'the', 'my', 'of', 'to', 'i',
])

/** Les mots utiles d'un texte, au singulier grossier (« news » et « new » restent distincts sous 4 lettres). */
export function motsUtiles(texte: string): string[] {
  const propre = texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  const mots = propre.split(' ').filter(m => m.length >= 2 && !VIDES.has(m)).map(m => (m.length > 4 && /[sx]$/.test(m) ? m.slice(0, -1) : m))
  return [...new Set(mots)]
}

/** Deux textes disent la même chose : la moitié de leurs mots utiles en commun (Jaccard), ou l'un contient tous les mots de l'autre. */
export function textesProches(a: string, b: string): boolean {
  const ma = motsUtiles(a)
  const mb = motsUtiles(b)
  if (!ma.length || !mb.length) return a.trim() === b.trim()
  const communs = ma.filter(m => mb.includes(m)).length
  const union = new Set([...ma, ...mb]).size
  if (communs / union >= 0.5) return true
  const [court, long] = ma.length <= mb.length ? [ma, mb] : [mb, ma]
  return court.length >= 2 && court.every(m => long.includes(m))
}

export type TexteCompte = { texte: string; personnes: number; fois: number }
export type GroupeTextes = { texte: string; personnes: number; fois: number; variantes: string[] }

/**
 * Les textes regroupés : chaque groupe prend le nom de son texte le plus porté
 * (le plus de personnes, puis de fois), et la somme des personnes et des fois de
 * ses variantes (une personne qui a écrit deux variantes compte deux fois).
 * Tri : les groupes les plus portés d'abord.
 */
export function regrouperTextes(entrees: TexteCompte[]): GroupeTextes[] {
  const tries = entrees
    .filter(e => e.texte && e.texte.trim())
    .sort((x, y) => y.personnes - x.personnes || y.fois - x.fois || x.texte.localeCompare(y.texte))
  const groupes: GroupeTextes[] = []
  for (const e of tries) {
    const groupe = groupes.find(g => textesProches(g.texte, e.texte) || g.variantes.some(v => textesProches(v, e.texte)))
    if (groupe) {
      groupe.personnes += e.personnes
      groupe.fois += e.fois
      groupe.variantes.push(e.texte)
    } else {
      groupes.push({ texte: e.texte, personnes: e.personnes, fois: e.fois, variantes: [] })
    }
  }
  return groupes.sort((x, y) => y.personnes - x.personnes || y.fois - x.fois)
}
