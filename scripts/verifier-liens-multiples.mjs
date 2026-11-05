// Liens multiples (brief J1, J2 et J3, 05/11/2026, copy trading) : un segment
// du Carnet porte plusieurs positions (les copies d'un trade sur plusieurs
// comptes), une position porte au plus un segment ; le numero de compte du
// broker (`compte`) sur chaque position ; ce que le multi-lien change pour les
// lecteurs (regroupement, rapprochement, jugement du Carnet, segments non
// lies) ; les formes du PATCH, nouvelles et anciennes. Fonctions pures et
// lecture du code des routes : aucune base, aucun reseau ; fixtures SYNTHETIQUES.
// node scripts/verifier-liens-multiples.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { liensAHarmoniser, planLienMultiple, positionDe, positionsRecalculees, vuePositions } from '../src/lib/positions.ts'
import { candidatsPourUnePosition, proposerLiens, segmentsDesNotes } from '../src/lib/correspondances-carnet.ts'
import { ajouterCarnet, compterSegmentsNonLies } from '../src/lib/carnet-sur-positions.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const t = hm => new Date(`2026-10-05T${hm}:00.000Z`)
const ex = (id, entree, sortie, extra = {}) => ({
  id, compteId: 'cA', compte: null, symbole: 'NQZ6', direction: 'long', devise: 'USD', entreLe: t(entree), sortiLe: sortie ? t(sortie) : null,
  quantite: 1, pnl: 10, frais: null, prixEntree: null, prixSortie: null, stopPrix: null,
  positionId: null, positionManuelle: false, segmentRef: null, fuseau: null, ...extra,
})

/** Ce que fait regrouperEnMemoire (trades-serveur.ts) : positions d'avant, recalcul, liens harmonises. */
function regrouper(executions) {
  const avant = new Map(executions.map(e => [e.id, positionDe(e)]))
  const cible = positionsRecalculees(executions)
  for (const e of executions) if (cible.has(e.id)) e.positionId = cible.get(e.id)
  const liens = liensAHarmoniser(executions, avant)
  for (const [id, ref] of liens) executions.find(e => e.id === id).segmentRef = ref
  return Object.fromEntries(liens)
}

// ── J2 : le compte du broker sur chaque position ────────────────────────────

bloc('J2 : compte = le premier non nul des executions dans l ordre d entree ; null quand le fichier ne le dit pas', () => {
  const [v] = vuePositions([
    ex('b', '10:05', '10:20', { positionId: 'a', compte: 'XX-000002' }),
    ex('a', '10:00', '10:10', { positionId: 'a', compte: null }),
    ex('c', '10:06', '10:21', { positionId: 'a', compte: 'XX-000003' }),
  ])
  assert.equal(v.compte, 'XX-000002')
  assert.equal(vuePositions([ex('x', '09:00', '09:05')])[0].compte, null)
  // Le champ est lu en base avec les autres (GET et reponse du PATCH passent par vuePositions).
  assert.match(lire('../src/lib/trades-serveur.ts'), /const CHAMPS_EXECUTION = \{\s*id: true, compteId: true, compte: true,/)
  assert.match(lire('../src/lib/trades-serveur.ts'), /id: randomUUID\(\), compteId, compte: t\.compte,/)
})

// ── Le regroupement ne defait plus les copies ───────────────────────────────

bloc('regroupement : les copies sur deux comptes gardent le meme segment (suppression, recalcul de tous les comptes)', () => {
  // Les deux copies, deja liees a s1, recalculees ensemble (supprimerExecutions sans compteId).
  const execs = [
    ex('a1', '10:00', '10:10', { positionId: 'a1', segmentRef: 's1' }),
    ex('b1', '10:00', '10:10', { compteId: 'cB', positionId: 'b1', segmentRef: 's1' }),
    ex('c1', '10:00', '10:10', { compteId: 'cC', compte: 'XX-03', positionId: 'c1', segmentRef: 's1' }),
  ]
  assert.deepEqual(regrouper(execs), {})
  assert.deepEqual(execs.map(e => e.segmentRef), ['s1', 's1', 's1'])
  // Sans `avant` (la regle d'avant le multi-lien), la plus recente des copies l'aurait perdu.
  const ancien = Object.fromEntries(liensAHarmoniser([
    ex('a1', '10:00', '10:10', { positionId: 'a1', segmentRef: 's1' }), ex('b1', '10:01', '10:10', { compteId: 'cB', positionId: 'b1', segmentRef: 's1' }),
  ]))
  assert.deepEqual(ancien, { b1: null })
})

bloc('regroupement : une position coupee (execution retiree) ne garde son lien que sur sa partie la plus ancienne, la copie le garde', () => {
  // Sur cA : a (10:00-10:10), c (10:12-10:20) reunies par b (10:05-10:15), liees a s1 ; b est retiree.
  // Sur cB : la copie, liee a s1.
  const execs = [
    ex('a', '10:00', '10:10', { positionId: 'a', segmentRef: 's1' }),
    ex('c', '10:12', '10:20', { positionId: 'a', segmentRef: 's1' }),
    ex('k', '10:00', '10:20', { compteId: 'cB', positionId: 'k', segmentRef: 's1' }),
  ]
  assert.deepEqual(regrouper(execs), { c: null })
  assert.deepEqual(execs.map(e => [e.id, e.positionId, e.segmentRef]), [['a', 'a', 's1'], ['c', 'c', null], ['k', 'k', 's1']])
})

bloc('regroupement : l execution qui rejoint herite ; deux positions liees qui se rejoignent : le lien le plus ancien', () => {
  const herite = [ex('a', '10:00', '10:10', { positionId: 'a', segmentRef: 's1' }), ex('n', '10:05', '10:12')]
  assert.deepEqual(regrouper(herite), { n: 's1' })
  const jointes = [
    ex('a', '10:00', '10:10', { positionId: 'a', segmentRef: 's1' }),
    ex('b', '10:20', '10:30', { positionId: 'b', segmentRef: 's2' }),
    ex('m', '10:08', '10:22'), // relie a et b
  ]
  assert.deepEqual(regrouper(jointes), { b: 's1', m: 's1' })
})

// ── J3 : lier plusieurs positions ───────────────────────────────────────────

bloc('lier plusieurs : toutes les executions des positions ; deja liees au meme segment = permis', () => {
  const execs = [
    ex('a', '10:00', '10:10', { positionId: 'a' }), ex('a2', '10:05', '10:12', { positionId: 'a' }),
    ex('b', '10:00', '10:10', { compteId: 'cB', positionId: 'b', segmentRef: 's1' }),
    ex('x', '11:00', '11:10'), // seule, positionId vide : sa propre position
  ]
  assert.deepEqual(planLienMultiple(execs, ['a', 'b', 'x'], 's1'), { ids: ['a', 'a2', 'b', 'x'] })
})

bloc('lier plusieurs : position introuvable = 404 ; liee a un AUTRE segment = 409 avec son positionId, rien a ecrire', () => {
  const execs = [ex('a', '10:00', '10:10', { positionId: 'a' }), ex('b', '10:00', '10:10', { compteId: 'cB', positionId: 'b', segmentRef: 's2' })]
  assert.deepEqual(planLienMultiple(execs, ['a', 'zz'], 's1'), { erreur: 'Position introuvable.', status: 404, positionId: 'zz' })
  const refus = planLienMultiple(execs, ['a', 'b'], 's1')
  assert.equal(refus.status, 409)
  assert.equal(refus.positionId, 'b')
  assert.match(refus.erreur, /autre trade du Carnet/)
  assert.ok(!('ids' in refus))
})

// ── Les lecteurs ────────────────────────────────────────────────────────────

const ms = hm => t(hm).getTime()
const notes = [{ id: 'n1', title: 'Seance NY', trades: [{ id: 's1', startedAt: ms('09:58'), closedAt: ms('10:20'), outcome: 'gain', r: 2 }], warmups: [{ startedAt: ms('09:30'), emotionLevel: 40 }] }]

bloc('rapprochement : un segment deja porte par une position n est pas libre, la copie importee ensuite est proposee', () => {
  const segments = segmentsDesNotes(notes)
  const copie = { positionId: 'b', compteId: 'cB', entreLe: t('10:00').toISOString(), sortiLe: t('10:10').toISOString(), segmentRef: null }
  const { liens, correspondances } = proposerLiens([copie], segments, ['s1'])
  assert.deepEqual(liens, [])
  assert.deepEqual(correspondances.map(c => [c.positionId, c.candidats.map(s => s.segmentRef)]), [['b', ['s1']]])
  // Libre : liee d'office, comme avant.
  assert.deepEqual(proposerLiens([copie], segments, []).liens, [{ positionId: 'b', segmentRef: 's1' }])
})

bloc('candidats d une position (bouton Lier de Pilotage, fusion de master) : un segment qui porte deja plusieurs copies', () => {
  const segments = segmentsDesNotes(notes)
  // candidatsDuCarnet garde, par segment, la premiere position lue : ici a, alors que s1 porte a ET b.
  const lies = new Map([['s1', 'a']])
  const pos = (positionId, segmentRef) => ({ positionId, entreLe: t('10:00').toISOString(), sortiLe: t('10:10').toISOString(), segmentRef })
  // Chaque copie deja liee ne se voit jamais proposer son propre segment, qu'elle soit la premiere lue ou non.
  assert.deepEqual(candidatsPourUnePosition(pos('a', 's1'), segments, lies), [])
  assert.deepEqual(candidatsPourUnePosition(pos('b', 's1'), segments, lies), [])
  // Une copie pas encore liee : s1 est propose et marque porte (lieA non nul, l'une des copies) ;
  // le PATCH lier a positionId seul repondra 409, la forme { positionIds, ajouter } l'ajoute.
  const [c, ...reste] = candidatsPourUnePosition(pos('d', null), segments, lies)
  assert.deepEqual(reste, [])
  assert.equal(c.segmentRef, 's1')
  assert.equal(c.chevauche, true)
  assert.equal(c.lieA, 'a')
})

bloc('jugement du Carnet : chaque copie porte le meme carnet ; le segment n est compte qu une fois parmi les non lies', () => {
  const jugements = [{ tradeRef: 's1', grade: 'B+', causeCategory: 'technique', phrase: 'plan suivi', createdAt: t('11:00') }]
  const copies = [{ positionId: 'a', segmentRef: 's1' }, { positionId: 'b', segmentRef: 's1' }, { positionId: 'c', segmentRef: 's1' }]
  const avec = ajouterCarnet(copies, notes, jugements)
  assert.equal(avec.length, 3)
  assert.ok(avec.every(p => p.carnet && p.carnet.grade === 'B+' && p.carnet.noteId === 'n1' && p.carnet.emotionDepart === 40))
  // Le meme jugement porte par 3 copies : un lecteur qui compte les positions le compte 3 fois (Pilotage, « tous mes comptes »).
  assert.equal(avec.filter(p => p.carnet?.grade).length, 3)
  assert.equal(compterSegmentsNonLies(notes, ['s1', 's1', 's1'], { depuis: null, jusqu: null }), 0)
  assert.equal(compterSegmentsNonLies(notes, [], { depuis: null, jusqu: null }), 1)
})

// ── Les routes ──────────────────────────────────────────────────────────────

bloc('PATCH : nouvelles formes avant les anciennes, bornees au membre ; anciennes formes inchangees', () => {
  const route = lire('../src/app/api/pilotage/trades/positions/route.ts')
  const patch = route.slice(route.indexOf('export async function PATCH'))
  const nouveau = patch.indexOf("if (action === 'lier' && Array.isArray(body.positionIds))")
  const delier = patch.indexOf("const segmentADelier = action === 'delier' && !texte(body.positionId) ? texte(body.segmentRef) : null")
  const ancien = patch.indexOf('const positionId = texte(body.positionId)')
  assert.ok(nouveau > 0 && delier > nouveau && ancien > delier, 'ordre des formes')
  const multi = patch.slice(nouveau, delier)
  assert.match(multi, /if \(!segments\.some\(s => s\.segmentRef === segmentRef\)\) return refus\('Segment du Carnet introuvable\.', 404\)/)
  assert.match(multi, /const plan = planLienMultiple\(executions, positionIds, segmentRef\)/)
  assert.match(multi, /plan\.status === 409 \? \{ error: plan\.erreur, positionId: plan\.positionId \} : \{ error: plan\.erreur \}/)
  // Le refus passe AVANT toute ecriture.
  assert.ok(multi.indexOf("if ('erreur' in plan)") < multi.indexOf('prisma.tradeImport.updateMany'))
  assert.match(multi, /prisma\.tradeImport\.updateMany\(\{ where: \{ userId, id: \{ in: plan\.ids \} \}, data: \{ segmentRef \} \}\)/)
  assert.match(multi, /const apres = await executionsDuMembre\(userId, \{ segmentRef \}\)/)
  assert.match(patch.slice(delier, ancien), /prisma\.tradeImport\.updateMany\(\{ where: \{ userId, segmentRef \}, data: \{ segmentRef: null \} \}\)/)
  // Les anciennes formes : lier avec positionId (409 si le segment est porte ailleurs), delier, separer sans `avant`.
  const anciennes = patch.slice(ancien)
  assert.match(anciennes, /where: \{ userId, segmentRef, id: \{ notIn: ids \} \}[\s\S]{0,300}positionId: positionDe\(ailleurs\) \},\s*\{ status: 409/)
  assert.match(anciennes, /const liens = liensAHarmoniser\(executions\)\n/)
  assert.match(anciennes, /await prisma\.tradeImport\.updateMany\(\{ where: \{ userId, id: \{ in: ids \} \}, data: \{ segmentRef: null \} \}\)/)
  // Le recalcul des positions passe les positions d'avant.
  assert.match(lire('../src/lib/trades-serveur.ts'), /const avant = new Map\(executions\.map\(e => \[e\.id, positionDe\(e\)\]\)\)[\s\S]*?liensAHarmoniser\(executions, avant\)/)
})

console.log(`\n${n} blocs verifies, tout est bon.`)
