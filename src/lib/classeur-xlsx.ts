// Les classeurs Excel (.xlsx, .xlsm) déposés par les membres (10/11/2026, les
// fichiers d'Alex : « NinjaTrader Grid ... .xlsx »). Un classeur se lit comme
// son PREMIER ONGLET UTILE (dans l'ordre du classeur, visible, au moins une
// ligne d'en-têtes et une ligne de données), rendu en CSV : il passe ensuite
// par les mêmes reconnaissances que le CSV (imports-trades.ts,
// documents-pilotage.ts). Rien n'est deviné ici : les cellules sont recopiées,
// les dates d'Excel (nombres de jours) écrites « AAAA-MM-JJ HH:mm:ss ».
//
// Dépendance : fflate (décompression ZIP, aucune dépendance, déjà dans l'arbre
// par jspdf ; 0.8.3 au moins : la 0.8.2 boucle sans fin sur un ZIP64 abîmé,
// GHSA-px8p-9vwx-vf98, d'où aussi le refus des ZIP64 avant fflate). Le XML se
// lit ici, au plus juste (workbook, rels, sharedStrings, styles, feuilles) :
// pas de bibliothèque XML, pas de formules recalculées (la valeur gardée par
// Excel est prise telle quelle).
//
// Garde-fous : 25 Mo décompressés par partie lue, 60 Mo en tout, 100 000
// lignes, 256 colonnes ; au-delà, refus ou feuille coupée, dit au membre.
//
// Module serveur et scripts : scripts/verifier-imports-trades.mjs le charge tel quel.

import { unzipSync } from 'fflate'

export const CLASSEUR_MAX_PARTIE = 25_000_000
export const CLASSEUR_MAX_TOTAL = 60_000_000
export const CLASSEUR_MAX_LIGNES = 100_000
export const CLASSEUR_MAX_COLONNES = 256

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const MESSAGE_CLASSEUR_ILLISIBLE = 'Classeur illisible : ouvre-le dans Excel, enregistre-le de nouveau en .xlsx (ou la feuille en CSV), puis dépose-le.'
export const MESSAGE_CLASSEUR_VIDE = "Classeur vide : aucune feuille ne porte une ligne d'en-têtes suivie de données."
export const MESSAGE_CLASSEUR_TROP_GROS = 'Classeur trop gros pour être lu ici : exporte une période plus courte, ou la feuille en CSV.'

export type Classeur =
  | { texte: string; feuille: string; feuilles: number; coupe: boolean }
  | { erreur: string }

// ── XML ──────────────────────────────────────────────────────────────────────

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Les entités XML, puis les « _x000D_ » d'OOXML (caractères échappés dans le texte des cellules). */
function texteXml(brut: string): string {
  return brut
    .replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (_, e: string) => {
      if (e[0] !== '#') return ENTITES[e]
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
}

/** La valeur d'un attribut d'une balise ouvrante (« r:id », « name »...), ou null. */
function attribut(balise: string, nom: string): string | null {
  const m = new RegExp(`\\s${nom.replace(':', '\\:')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(balise)
  return m ? texteXml(m[1] ?? m[2] ?? '') : null
}

/** Les balises ouvrantes d'un élément, préfixe d'espace de noms permis (« <x:sheet ...> »). */
function balises(xml: string, element: string): string[] {
  return xml.match(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${element}(?=[\\s/>])[^>]*>`, 'g')) ?? []
}

/** Le texte de tous les <t> d'un fragment (les runs d'un texte enrichi), sans la phonétique (<rPh>). */
function texteDesT(fragment: string): string {
  const sansPhonetique = fragment.replace(/<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh>/g, '')
  let sortie = ''
  for (const m of sansPhonetique.matchAll(/<(?:[\w.-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g)) sortie += texteXml(m[1])
  return sortie
}

// ── Chemins dans l'archive ───────────────────────────────────────────────────

/** Un chemin relatif à un dossier de l'archive (« worksheets/sheet1.xml » depuis « xl/ »), « .. » compris. */
function resoudre(dossier: string, cible: string): string {
  const parties = (cible.startsWith('/') ? cible.slice(1) : `${dossier}${cible}`).split('/')
  const pile: string[] = []
  for (const p of parties) {
    if (p === '..') pile.pop()
    else if (p && p !== '.') pile.push(p)
  }
  return pile.join('/')
}

const dossierDe = (chemin: string) => chemin.slice(0, chemin.lastIndexOf('/') + 1)

/** Les relations d'une partie (Id vers chemin résolu et type). */
function relations(xml: string | undefined, dossier: string): Map<string, { cible: string; type: string }> {
  const sortie = new Map<string, { cible: string; type: string }>()
  if (!xml) return sortie
  for (const b of balises(xml, 'Relationship')) {
    const id = attribut(b, 'Id')
    const cible = attribut(b, 'Target')
    if (id && cible && attribut(b, 'TargetMode') !== 'External') sortie.set(id, { cible: resoudre(dossier, cible), type: attribut(b, 'Type') ?? '' })
  }
  return sortie
}

// ── Dates d'Excel ────────────────────────────────────────────────────────────

/** Les formats intégrés qui sont des dates (14-17, 27-36, 50-58), des heures (18-21, 45-47) ou les deux (22). */
const FORMATS_DATE = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58])
const FORMATS_HEURE = new Set([18, 19, 20, 21, 22, 45, 46, 47])

type Genre = 'nombre' | 'date' | 'heure' | 'dateheure'

/** Ce qu'un code de format personnalisé affiche : sans le texte entre guillemets ni les [couleurs], d/y = date, h/s = heure. */
function genreDuFormat(code: string): Genre {
  const net = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').split(';')[0]
  const date = /[dy]/i.test(net)
  const heure = /[hs]/i.test(net)
  if (date && heure) return 'dateheure'
  if (date) return 'date'
  if (heure) return 'heure'
  // « mmm », « mm/yyyy » sans d ni y : rare ; « m » seul se lit comme un mois.
  return /m/i.test(net) && !/[0#?]/.test(net) ? 'date' : 'nombre'
}

/** Le genre de chaque style de cellule (cellXfs), d'après son numFmtId. */
function genresDesStyles(xml: string | undefined): Genre[] {
  if (!xml) return []
  const personnalises = new Map<number, Genre>()
  for (const b of balises(xml, 'numFmt')) {
    const id = Number(attribut(b, 'numFmtId'))
    const code = attribut(b, 'formatCode')
    if (Number.isInteger(id) && code !== null) personnalises.set(id, genreDuFormat(code))
  }
  const bloc = /<(?:[\w.-]+:)?cellXfs\b[\s\S]*?<\/(?:[\w.-]+:)?cellXfs>/.exec(xml)?.[0] ?? ''
  return balises(bloc, 'xf').map(b => {
    const id = Number(attribut(b, 'numFmtId') ?? 0)
    if (personnalises.has(id)) return personnalises.get(id)!
    if (FORMATS_DATE.has(id) && FORMATS_HEURE.has(id)) return 'dateheure'
    if (FORMATS_DATE.has(id)) return 'date'
    if (FORMATS_HEURE.has(id)) return 'heure'
    return 'nombre'
  })
}

const deux = (n: number) => String(n).padStart(2, '0')

/**
 * Un nombre de jours d'Excel en texte, à la seconde : « 2026-11-09 09:49:21 »,
 * « 2026-11-09 » (date seule), « 09:49:21 » (heure seule). Système 1900 (le 0
 * est le 30/12/1899, le faux 29/02/1900 d'Excel compris) ou 1904.
 */
export function dateExcel(serie: number, genre: Exclude<Genre, 'nombre'>, systeme1904 = false): string | null {
  if (!Number.isFinite(serie) || serie < 0 || serie > 2_958_465) return null
  const secondes = Math.round(serie * 86_400)
  const base = systeme1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const d = new Date(base + secondes * 1000)
  const jour = `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`
  const heure = `${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}:${deux(d.getUTCSeconds())}`
  if (genre === 'heure' && serie < 1) return heure
  if (genre === 'date' && secondes % 86_400 === 0) return jour
  return `${jour} ${heure}`
}

/** Un nombre tel qu'Excel le garde (« 27046.25 », « 1.5E-3 »), sans le bruit binaire (« 0.30000000000000004 »). */
function nombre(brut: string): string {
  const s = brut.trim()
  if (/^-?\d{1,15}(\.\d{1,10})?$/.test(s)) return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  const n = Number(s)
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : s
}

// ── Les feuilles ─────────────────────────────────────────────────────────────

/** « AB » donne 27 (base 1) ; null si la référence n'a pas de colonne. */
function colonneDe(reference: string | null): number | null {
  const m = reference ? /^([A-Z]{1,3})\d*$/i.exec(reference) : null
  if (!m) return null
  let n = 0
  for (const c of m[1].toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64)
  return n
}

/** Un champ CSV : retours à la ligne aplatis (le lecteur va ligne par ligne), guillemets quand il le faut. */
function champCsv(valeur: string): string {
  const v = valeur.replace(/\r\n|\r|\n/g, ' ')
  return /[",;\t]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

interface Feuille { lignes: string[]; coupe: boolean }

function lireFeuille(xml: string, partages: string[], genres: Genre[], systeme1904: boolean): Feuille {
  const lignes: string[] = []
  let coupe = false
  const donnees = /<(?:[\w.-]+:)?sheetData\b[^>]*?(?:\/>|>([\s\S]*)<\/(?:[\w.-]+:)?sheetData>)/.exec(xml)?.[1] ?? ''
  for (const m of donnees.matchAll(/<(?:[\w.-]+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?row>)/g)) {
    const corps = m[2] ?? ''
    const cellules: string[] = []
    let colonne = 0
    for (const c of corps.matchAll(/<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g)) {
      const attrs = ` ${c[1]}`
      const contenu = c[2] ?? ''
      colonne = colonneDe(attribut(attrs, 'r')) ?? colonne + 1
      if (colonne > CLASSEUR_MAX_COLONNES) continue
      const t = attribut(attrs, 't') ?? 'n'
      const v = /<(?:[\w.-]+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?v>/.exec(contenu)?.[1]
      let valeur = ''
      if (t === 's') valeur = partages[Number(v)] ?? ''
      else if (t === 'inlineStr') valeur = texteDesT(/<(?:[\w.-]+:)?is\b[\s\S]*?<\/(?:[\w.-]+:)?is>/.exec(contenu)?.[0] ?? '')
      else if (t === 'str') valeur = v === undefined ? '' : texteXml(v)
      else if (t === 'b') valeur = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : ''
      else if (t === 'e' || v === undefined) valeur = ''
      else {
        const genre = genres[Number(attribut(attrs, 's') ?? 0)] ?? 'nombre'
        valeur = genre === 'nombre' ? nombre(v) : (dateExcel(Number(v), genre, systeme1904) ?? nombre(v))
      }
      while (cellules.length < colonne - 1) cellules.push('')
      cellules[colonne - 1] = valeur
    }
    while (cellules.length > 0 && !cellules[cellules.length - 1].trim()) cellules.pop()
    if (cellules.length === 0) continue
    if (lignes.length >= CLASSEUR_MAX_LIGNES) { coupe = true; break }
    lignes.push(cellules.map(champCsv).join(','))
  }
  return { lignes, coupe }
}

// ── L'archive ────────────────────────────────────────────────────────────────

/** La signature de fin d'un ZIP64 (« PK\x06\x07 ») : refusé avant fflate, un classeur de quelques Mo n'en a jamais besoin. */
function estZip64(octets: Uint8Array): boolean {
  const debut = Math.max(0, octets.length - 70_000)
  for (let i = octets.length - 4; i >= debut; i--) {
    if (octets[i] === 0x50 && octets[i + 1] === 0x4b && octets[i + 2] === 0x06 && (octets[i + 3] === 0x07 || octets[i + 3] === 0x06)) return true
  }
  return false
}

/**
 * Le premier onglet utile d'un classeur .xlsx, en CSV (virgule, guillemets à la
 * norme), avec son nom et le nombre de feuilles. Un classeur abîmé, chiffré
 * (mot de passe), trop gros ou vide rend `erreur`, dite au membre.
 */
export function texteDuClasseur(octets: Uint8Array): Classeur {
  if (octets.length < 4 || octets[0] !== 0x50 || octets[1] !== 0x4b) {
    // Un classeur protégé par mot de passe est un conteneur OLE (D0 CF 11 E0), pas un ZIP.
    if (octets[0] === 0xd0 && octets[1] === 0xcf) return { erreur: 'Classeur protégé par un mot de passe, ou au format .xls : enregistre-le sans mot de passe en .xlsx, ou la feuille en CSV.' }
    return { erreur: MESSAGE_CLASSEUR_ILLISIBLE }
  }
  if (estZip64(octets)) return { erreur: MESSAGE_CLASSEUR_TROP_GROS }

  let total = 0
  const tropGros = new Set<string>()
  let parties: Record<string, Uint8Array>
  try {
    parties = unzipSync(octets, {
      filter: f => {
        if (!/\.(xml|rels)$/i.test(f.name)) return false
        if (f.originalSize > CLASSEUR_MAX_PARTIE || total + f.originalSize > CLASSEUR_MAX_TOTAL) { tropGros.add(f.name); return false }
        total += f.originalSize
        return true
      },
    })
  } catch {
    return { erreur: MESSAGE_CLASSEUR_ILLISIBLE }
  }
  const decodeur = new TextDecoder('utf-8')
  const lire = (chemin: string): string | undefined => (parties[chemin] ? decodeur.decode(parties[chemin]) : undefined)

  // Le classeur : la relation officeDocument de la racine, sinon xl/workbook.xml.
  const racine = relations(lire('_rels/.rels'), '')
  const cheminClasseur = [...racine.values()].find(r => /\/officeDocument$/.test(r.type))?.cible ?? 'xl/workbook.xml'
  const classeur = lire(cheminClasseur)
  if (!classeur) return { erreur: tropGros.size > 0 ? MESSAGE_CLASSEUR_TROP_GROS : MESSAGE_CLASSEUR_ILLISIBLE }
  const dossier = dossierDe(cheminClasseur)
  const rels = relations(lire(`${dossier}_rels/${cheminClasseur.slice(dossier.length)}.rels`), dossier)
  const cibleDeType = (fin: string) => [...rels.values()].find(r => r.type.endsWith(fin))?.cible

  const partages: string[] = []
  const xmlPartages = lire(cibleDeType('/sharedStrings') ?? `${dossier}sharedStrings.xml`)
  if (xmlPartages) for (const m of xmlPartages.matchAll(/<(?:[\w.-]+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?si>)/g)) partages.push(texteDesT(m[1] ?? ''))
  const genres = genresDesStyles(lire(cibleDeType('/styles') ?? `${dossier}styles.xml`))
  const systeme1904 = balises(classeur, 'workbookPr').some(b => /^(1|true)$/i.test(attribut(b, 'date1904') ?? ''))

  const feuilles = balises(classeur, 'sheet')
  let illisibles = 0
  for (const b of feuilles) {
    if (/^(hidden|veryHidden)$/.test(attribut(b, 'state') ?? '')) continue
    const rel = rels.get(attribut(b, 'r:id') ?? '')
    if (!rel || !/\/worksheet$/.test(rel.type)) continue
    const xml = lire(rel.cible)
    if (!xml) { illisibles++; if (tropGros.has(rel.cible)) return { erreur: MESSAGE_CLASSEUR_TROP_GROS }; continue }
    const { lignes, coupe } = lireFeuille(xml, partages, genres, systeme1904)
    if (lignes.length >= 2) {
      return { texte: lignes.join('\n'), feuille: (attribut(b, 'name') ?? 'Feuille').slice(0, 80), feuilles: feuilles.length, coupe }
    }
  }
  return { erreur: illisibles > 0 && illisibles === feuilles.length ? MESSAGE_CLASSEUR_ILLISIBLE : MESSAGE_CLASSEUR_VIDE }
}

/** Un .xlsx ou un .xlsm d'après son nom, ou un ZIP au type MIME d'un classeur. */
export function estClasseur(nom: string, type = ''): boolean {
  return /\.(xlsx|xlsm)$/i.test(nom.trim()) || type.toLowerCase().startsWith(MIME_XLSX)
}
