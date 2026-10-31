// Ce que partagent les scripts de bascule des choix d'abonnement Kit
// (31/10/2026, decision de Brice) : kit-bascule-rattrapage.mjs,
// kit-bascule-broadcasts.mjs, kit-bascule-relecture.mjs.
//
// - La liste des choix vient de src/lib/kit-choix.ts (la meme que les routes
//   et la carte « Mes emails ») : rien n'est recopie ici.
// - ESSAI par defaut : uniquement des lectures (GET). --appliquer ecrit, et
//   seulement sur le GO de Brice.
// - La cle : KIT_API_KEY ou CONVERTKIT_API_KEY de l'environnement, sinon la
//   ligne KIT_API_KEY de D:\1_Ecriture\Systeme\contexte\secrets-kit.local.md
//   (meme lecture que collect_kit.py). Jamais affichee.
// - Kit limite une cle a 120 requetes par 60 s glissantes : on espace les
//   appels (environ 109 par minute) et on attend sur un 429.
// - Aucune adresse n'est affichee : on ne manipule que des ids, et une erreur
//   ne cite que la methode, le chemin sans parametres et le statut.

import { readFileSync } from 'node:fs'

export { CHOIX_KIT, CLE_NEWSLETTER_HEBDO, TAG_CONSENTEMENT_PUB } from '../src/lib/kit-choix.ts'

export const APPLIQUER = process.argv.includes('--appliquer')
export const MODE = APPLIQUER ? 'APPLIQUER (ecriture chez Kit)' : 'ESSAI (lecture seule)'

/** Les newsletters du samedi deja programmees pour tous les abonnes : S46 a S50. */
export const BROADCASTS_SAMEDI = [
  { nom: 'S46', id: 26577821 },
  { nom: 'S47', id: 26577827 },
  { nom: 'S48', id: 26577828 },
  { nom: 'S49', id: 26577829 },
  { nom: 'S50', id: 26577830 },
]

const SECRETS = '/mnt/d/1_Ecriture/Systeme/contexte/secrets-kit.local.md'
const BASE = 'https://api.kit.com/v4'
const ECART_MS = 550

function lireCle() {
  const env = (process.env.KIT_API_KEY || process.env.CONVERTKIT_API_KEY || '').trim()
  if (env) return env
  let texte = ''
  try { texte = readFileSync(SECRETS, 'utf8') } catch { /* absent */ }
  const m = /KIT_API_KEY[\s*]*[:=][\s*`]*([A-Za-z0-9_-]+)/.exec(texte)
  if (!m) throw new Error('Cle Kit introuvable : ni KIT_API_KEY ni CONVERTKIT_API_KEY, ni ligne KIT_API_KEY dans le fichier secrets')
  return m[1]
}

const CLE = lireCle()
let dernier = 0
let appels = 0
const dormir = ms => new Promise(r => setTimeout(r, ms))
export const nombreAppels = () => appels

/** Un appel a Kit : { statut, json }. Espace les appels, attend sur un 429. */
export async function kit(chemin, init = {}) {
  for (let essai = 0; essai < 6; essai++) {
    const attente = dernier + ECART_MS - Date.now()
    if (attente > 0) await dormir(attente)
    dernier = Date.now()
    appels++
    const r = await fetch(BASE + chemin, {
      ...init,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Kit-Api-Key': CLE },
      signal: AbortSignal.timeout(30000),
    })
    if (r.status === 429) {
      const s = Number(r.headers.get('retry-after'))
      await dormir(Number.isFinite(s) && s > 0 ? s * 1000 : 15000)
      continue
    }
    const texte = await r.text().catch(() => '')
    let json = null
    try { json = texte ? JSON.parse(texte) : null } catch { json = null }
    return { statut: r.status, json }
  }
  throw new Error(`Kit ${init.method ?? 'GET'} ${chemin.split('?')[0]} : 429 persistant`)
}

/** Un appel qui doit reussir (2xx), sinon une erreur sans corps ni adresse. */
export async function exiger(chemin, init = {}) {
  const r = await kit(chemin, init)
  if (r.statut < 200 || r.statut >= 300) throw new Error(`Kit ${init.method ?? 'GET'} ${chemin.split('?')[0]} -> ${r.statut}`)
  return r.json
}

/** Tous les ids d'une liste paginee de Kit (abonnes d'un tag, abonnes...). */
export async function tousLesIds(chemin, cle = 'subscribers') {
  const ids = new Set()
  let apres = null
  for (let page = 0; page < 200; page++) {
    const sep = chemin.includes('?') ? '&' : '?'
    const j = await exiger(`${chemin}${sep}per_page=1000${apres ? `&after=${encodeURIComponent(apres)}` : ''}`)
    for (const x of j?.[cle] ?? []) if (typeof x.id === 'number') ids.add(x.id)
    if (!j?.pagination?.has_next_page || !j.pagination.end_cursor) return ids
    apres = j.pagination.end_cursor
  }
  throw new Error(`Kit ${chemin.split('?')[0]} : plus de 200 pages`)
}

/** Les tags du compte Kit : Map id -> nom. */
export async function tagsDuCompte() {
  const noms = new Map()
  let apres = null
  for (let page = 0; page < 50; page++) {
    const j = await exiger(`/tags?per_page=1000${apres ? `&after=${encodeURIComponent(apres)}` : ''}`)
    for (const t of j?.tags ?? []) noms.set(t.id, t.name)
    if (!j?.pagination?.has_next_page || !j.pagination.end_cursor) break
    apres = j.pagination.end_cursor
  }
  return noms
}

/** Les abonnes ACTIFS a qui le rattrapage d'un choix s'adresse (null : aucun rattrapage). */
export async function ciblesDuRattrapage(choix, actifs, cache = new Map()) {
  if (!choix.rattrapage) return null
  const requis = choix.rattrapage.tagRequis
  if (!requis) return actifs
  if (!cache.has(requis)) cache.set(requis, await tousLesIds(`/tags/${requis}/subscribers?status=active`))
  const porteurs = cache.get(requis)
  return new Set([...actifs].filter(id => porteurs.has(id)))
}

/** Le filtre d'audience « tag N » au format de Kit v4. */
export const filtreTag = tag => [{ all: [{ type: 'tag', ids: [tag] }], any: null, none: null }]

/** Le filtre lu vise-t-il exactement ce tag (et rien d'autre) ? */
export function vise(filtre, tag) {
  if (!Array.isArray(filtre) || filtre.length !== 1) return false
  const g = filtre[0] ?? {}
  const tous = Array.isArray(g.all) ? g.all : []
  const vide = x => x == null || (Array.isArray(x) && x.length === 0)
  return tous.length === 1 && tous[0]?.type === 'tag' && Array.isArray(tous[0].ids)
    && tous[0].ids.length === 1 && Number(tous[0].ids[0]) === tag && vide(g.any) && vide(g.none)
}

/** Le filtre lu, en clair et court. */
export function resumeFiltre(filtre) {
  if (!Array.isArray(filtre) || !filtre.length) return 'aucun (tous les abonnes)'
  return filtre.map(g => ['all', 'any', 'none']
    .filter(k => Array.isArray(g?.[k]) && g[k].length)
    .map(k => `${k}: ${g[k].map(x => x.type + (Array.isArray(x.ids) && x.ids.length ? ` ${x.ids.join(',')}` : '')).join(' + ')}`)
    .join(' ; ')).join(' | ')
}

/** Une date ISO a plus de `minutes` dans le futur ? */
export const dansLeFutur = (iso, minutes = 30) => !!iso && Date.parse(iso) > Date.now() + minutes * 60000

export const ligne = (...cols) => console.log(cols.map(c => String(c)).join('  '))
