// APERCU EN LECTURE SEULE de l'outil fiche_personne de l'agent du Cockpit
// (passe 2 du chantier « noms et paroles des membres », 15/10/2026).
//
// Execute le VRAI code (src/lib/fiche-personne.ts) contre la vraie base. La
// fiche se lit dans une transaction READ ONLY (SET TRANSACTION READ ONLY dans
// fichePersonnePourAgent) : rien ne peut etre ecrit. Aucun appel au modele.
//
// Sortie : la STRUCTURE et les COMPTES seulement. Aucun texte de message,
// aucun nom, aucun email : chaque chaine est remplacee par sa longueur, sauf
// une courte liste de champs qui ne portent pas de contenu (dates, groupe,
// sujet, motifs, statuts, sources).
//
// Lancement (Node 22, depuis apps/journal-d-etude) :
//   set -a && . ./.env && set +a && node scripts/apercu-fiche-personne.mjs "u1644619224"

import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = pathToFileURL(path.join(RACINE, 'src') + path.sep).href
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) } catch (err) {
    let base = null
    if (spec.startsWith('@/')) base = new URL(spec.slice(2), SRC).href
    else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL) base = new URL(spec, ctx.parentURL).href
    if (!base) throw err
    for (const c of [base + '.ts', base + '/index.ts']) { try { return await next(c, ctx) } catch {} }
    throw err
  }
}`))

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL absente : charger le .env du journal (set -a && . ./.env && set +a).')
  process.exit(1)
}
const qui = process.argv[2]
if (!qui) {
  console.error('Usage : node scripts/apercu-fiche-personne.mjs "<qui>"')
  process.exit(2)
}

const { fichePersonnePourAgent } = await import('../src/lib/fiche-personne.ts')
const { prisma } = await import('../src/lib/db.ts')

// Champs affiches tels quels : ils ne portent ni nom, ni email, ni texte.
const BRUT = new Set([
  'statut', 'groupe', 'sujet', 'le', 'vu_du', 'vu_au', 'source', 'motifs', 'rang', 'present', 'abonnement_en_cours',
  'offre_id', 'palier', 'raccourcie', 'budget', 'geste', 'resultat', 'regle', 'role', 'app', 'statut_tg', 'total', 'lus',
  'messages', 'avec_texte', 'mentions', 'nb_messages', 'gestes_total', 'dans_le_groupe_live_club', 'messages_depuis_30_08',
  'longueur', 'retire', 'premier', 'dernier', 'famille', 'theme', 'rubrique', 'sur', 'nature', 'palier', 'periodicite',
  'compte', 'principal', 'verifie', 'tier_skool', 'debut', 'fin_periode', 'annule_le', 'annule_a_la_fin', 'pause_jusquau',
  'impaye', 'date_entree', 'dit_le', 'depuis', 'media', 'humain_demande_le', 'maj_le', 'cree_le', 'autres', 'par',
  'entre_le', 'sorti_le', 'lie_le', 'retire_le', 'connu_par', 'a_parle_en_prive', 'avatar', 'origine_statut',
])

function squelette(v, cle = '') {
  if (v === null || v === undefined) return v
  if (Array.isArray(v)) return v.map((x) => squelette(x, cle))
  if (typeof v === 'object') {
    const r = {}
    for (const [k, x] of Object.entries(v)) r[k] = squelette(x, k)
    return r
  }
  if (BRUT.has(cle)) return v
  if (typeof v === 'string') return `<${v.length} car.>`
  if (typeof v === 'number') return '<nombre>'
  return v
}

const debut = Date.now()
const json = await fichePersonnePourAgent(qui)
const duree = Date.now() - debut
let fiche
try { fiche = JSON.parse(json) } catch { console.error('Reponse illisible (pas du JSON).'); process.exit(1) }
console.log(`Taille du JSON rendu au modele : ${json.length} caracteres, lu en ${duree} ms.`)
console.log(JSON.stringify(squelette(fiche), null, 1))
await prisma.$disconnect()
