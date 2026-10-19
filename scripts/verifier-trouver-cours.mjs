// Verification de l'outil trouver_cours (19/10/2026) : les fonctions PURES
// (src/lib/trouver-cours-pur.ts, sans base), puis la VRAIE lecture en base
// (src/lib/trouver-cours.ts, fonction public.academie_trouver_cours, lecture
// seule) sur trois notions : FVG, journal, psychologie. Affiche les resultats.
// Aucun modele, aucun credit consomme.
//
// Lancement (Node 22, depuis apps/journal-d-etude) :
//   set -a, . ./.env.local, set +a (pour DATABASE_URL), puis
//   node scripts/verifier-trouver-cours.mjs [--sans-base] [--compte] [notion ...]
// --compte : le bot support avec les droits simules d'un membre Live Club
// (scripts/droits-simules.mjs), pour voir « ouvert pour toi ».

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

// Meme crochet que scripts/eval-fuites.mjs : imports sans extension et alias @/.
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

const pur = await import('../src/lib/trouver-cours-pur.ts')
const args = process.argv.slice(2)
const SANS_BASE = args.includes('--sans-base')
const NOTIONS = args.filter(a => !a.startsWith('--'))

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

assert.equal(pur.lireEntreeTrouverCours({}), null)
assert.equal(pur.lireEntreeTrouverCours({ notion: ' x ' }), null)
assert.deepEqual(pur.lireEntreeTrouverCours({ notion: '  FVG  ' }), { notion: 'FVG', limite: 3 })
assert.deepEqual(pur.lireEntreeTrouverCours({ notion: 'FVG', limite: 9 }), { notion: 'FVG', limite: 5 })
assert.deepEqual(pur.lireEntreeTrouverCours({ notion: 'FVG', limite: 1 }), { notion: 'FVG', limite: 3 })
assert.equal(pur.requeteEtendue('les FVG'), 'les fvg OR "fair value gap"')
assert.equal(pur.requeteEtendue('FVG fair value gap'), 'fvg OR "fair value gap"')
assert.equal(pur.requeteEtendue('Fair Value Gap'), '"fair value gap"')
assert.equal(pur.requeteEtendue('"risk-reward" -x'), 'x OR "risk reward"')
assert.equal(pur.requeteEtendue('psychologie'), 'psychologie')
assert.equal(pur.requeteEtendue('comprendre les FVG'), 'les fvg OR "fair value gap"')
assert.equal(pur.requeteEtendue('gestion du risque'), 'gestion du risque OR "money management"')
assert.equal(pur.requeteEtendue('cours'), 'cours')
assert.equal(pur.urlLecon('les-bases-smart-money', 'cours-7-fvg'), 'https://aoknowledge.com/academie/les-bases-smart-money/cours-7-fvg')
assert.equal(pur.accesDe({ gratuit: true, live_club: true, club_10: true }), 'gratuit')
assert.equal(pur.accesDe({ gratuit: false, live_club: true, club_10: true }), 'live_club')
assert.equal(pur.accesDe({ gratuit: false, live_club: false, club_10: true }), 'club_10')

const risque = pur.trouverMasterclasses('gestion du risque')
assert.ok(risque.length >= 1 && risque[0].titre === 'Gestion des Risques', 'la masterclass Gestion des Risques sort en premier')
assert.ok(risque.every(m => m.url === 'https://masterclass.aoknowledge.com'))
assert.deepEqual(pur.trouverMasterclasses('xyzabc'), [])

const ligne = (rang, extra = {}) => ({
  module_slug: 'm', module_titre: 'M', section_titre: null, lecon_slug: `l${rang}`, lecon_titre: 'L',
  type: 'video', format: 'cours', gratuit: false, live_club: true, club_10: true, rang,
  module_id: 'mod-1', section_id: null, usage: 'interne', apercu: false, ...extra,
})
assert.equal(pur.garderPertinentes([ligne(1), ligne(0.05)], 5).length, 1, 'le bruit tombe quand une lecon forte existe')
assert.equal(pur.garderPertinentes([ligne(0.05), ligne(0.04)], 5).length, 2, 'sans lecon forte, on garde ce qui sort')

const r = pur.resultatTrouverCours('liveclub', { notion: 'FVG', limite: 3 }, [ligne(1)])
assert.equal(r.cours[0].url, 'https://aoknowledge.com/academie/m/l1')
assert.match(r.cours[0].acces, /Live Club/)
assert.match(r.consigne, /n'expliques pas la notion/)
assert.ok(!/jamais/i.test(JSON.stringify(r)), 'pas de « jamais » dans le resultat')
assert.ok(!/[—–]/.test(JSON.stringify(r)), 'pas de tiret long dans le resultat')
const rien = pur.resultatTrouverCours('support', { notion: 'xyzabc', limite: 3 }, [])
assert.equal(rien.aucun_resultat, true)
const panne = pur.resultatTrouverCours('support', { notion: 'gestion du risque', limite: 3 }, null)
assert.equal(panne.recherche_indisponible, true)
assert.ok(panne.masterclass.length >= 1, 'les masterclass restent en panne de base')
// Les acces de la personne (19/10) : droits connus, visiteur, illisibles.
const { preparerDroits } = await import('../src/lib/academie/pur.ts')
const avecLiveClub = preparerDroits({ admin: false, etm: false, liveClub: 'oui', secoursEssai: false,
  lignes: [{ origine: 'base', source: null, slug: 'live-club', ouvreTout: false, moduleId: 'mod-1', sectionId: null }] })
const sansLiveClub = preparerDroits({ ...avecLiveClub, admin: false, etm: false, liveClub: 'non', secoursEssai: false,
  lignes: [{ origine: 'base', source: null, slug: 'live-club', ouvreTout: false, moduleId: 'mod-1', sectionId: null }] })
const ouvert = pur.resultatTrouverCours('support', { notion: 'FVG', limite: 3 }, [ligne(1)], { etat: 'droits', droits: avecLiveClub })
assert.equal(ouvert.cours[0].acces, 'ouvert pour toi')
const ferme = pur.resultatTrouverCours('support', { notion: 'FVG', limite: 3 }, [ligne(1)], { etat: 'droits', droits: sansLiveClub })
assert.match(ferme.cours[0].acces, /^pas dans tes accès pour l'instant : il s'ouvre avec le Live Club/)
const club10 = pur.resultatTrouverCours('support', { notion: 'FVG', limite: 3 }, [ligne(1, { live_club: false, module_id: 'mod-2' })], { etat: 'droits', droits: avecLiveClub })
assert.match(club10.cours[0].acces, /pas dans tes accès.*10% Club/)
const visiteur = pur.resultatTrouverCours('support', { notion: 'FVG', limite: 3 }, [ligne(1)])
assert.equal(visiteur.cours[0].acces, 'inclus dans le Live Club')
assert.match(visiteur.consigne, /en se connectant/)
const illisible = pur.resultatTrouverCours('liveclub', { notion: 'FVG', limite: 3 }, [ligne(1)], { etat: 'illisible' })
assert.match(illisible.cours[0].acces, /ne se vérifient pas/)
const lui = pur.resultatTrouverCours('liveclub', { notion: 'FVG', limite: 3 }, [ligne(1)], { etat: 'droits', droits: avecLiveClub })
assert.equal(lui.cours[0].acces, 'ouvert pour lui')
for (const x of [ouvert, ferme, club10, visiteur, illisible, lui]) assert.ok(!/jamais|[—–]/i.test(JSON.stringify(x)))
console.log('fonctions pures : ok')

// ---------------------------------------------------------------------------
// La vraie lecture en base
// ---------------------------------------------------------------------------

if (SANS_BASE) process.exit(0)
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL absente : set -a, . ./.env.local, set +a (ou --sans-base).')
  process.exit(1)
}

const { trouverCours } = await import('../src/lib/trouver-cours.ts')
const { droitsSimules } = await import('./droits-simules.mjs')
// --compte : droits simules d'un membre Live Club (offres de base lues en base).
const QUI = args.includes('--compte') ? { droits: await droitsSimules('oui') } : {}
const { prisma } = await import('../src/lib/db.ts')
let echecs = 0
for (const notion of NOTIONS.length ? NOTIONS : ['FVG', 'journal', 'psychologie']) {
  const res = await trouverCours({ notion, limite: 5 }, QUI.droits ? 'support' : 'liveclub', QUI)
  console.log(`\n== ${notion}`)
  if (res.recherche_indisponible) { console.log('  BASE ILLISIBLE'); echecs++; continue }
  if (res.aucun_resultat) { console.log('  aucun resultat'); continue }
  for (const c of res.cours) console.log(`  ${c.module} > ${c.lecon}\n    ${c.url}\n    ${c.acces}`)
  for (const m of res.masterclass) console.log(`  [masterclass] ${m.titre} : ${m.url}`)
  for (const c of res.cours) assert.match(c.url, /^https:\/\/aoknowledge\.com\/academie\/[a-z0-9-]+\/[a-z0-9-]+$/)
}
await prisma.$disconnect()
if (echecs) process.exit(1)
console.log('\nbase : ok')
