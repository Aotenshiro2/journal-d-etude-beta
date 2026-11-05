// La synthese des trades (brief J1, J4, 05/11/2026) : le prevu tape dans le
// Carnet (Note.trades[].prix, nettoye a l'ecriture par POST /api/notes) face a
// l'effectif du broker (positions liees, copies comprises), les ecarts, le
// ressenti, le jugement, les captures, le resume ; la route en lecture seule,
// bornee au membre. Fonctions pures et lecture du code : aucune base, aucun
// reseau ; fixtures SYNTHETIQUES.
// node scripts/verifier-synthese-trades.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const S = await import('../src/lib/synthese-trades-pur.ts')
const P = await import('../src/lib/prix-carnet.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const iso = hm => `2026-10-05T${hm}:00.000Z`
const ms = hm => Date.parse(iso(hm))
/** Une position telle que la rend vuePositions (positions.ts). */
const pos = (positionId, extra = {}) => ({
  positionId, compteId: 'cA', compte: null, symbole: 'NQZ6', direction: 'long', devise: 'USD',
  entreLe: iso('10:02'), sortiLe: iso('10:20'), quantite: 1, pnl: 200, frais: 4, prixEntree: 20001, prixSortie: 20010,
  stopPrix: null, executions: 1, segmentRef: 's1', fuseau: '+02:00', manuelle: false, ...extra,
})
const prevu = prix => S.lirePrevu({ prix })

// ── Le nettoyage a l'ecriture (POST /api/notes) ─────────────────────────────

bloc('nettoyage : prix et instrument gardes intacts quand ils sont valables, le reste du segment non touche', () => {
  const segment = {
    id: 's1', startedAt: 1, outcome: 'gain', r: 2, cooldown: { lesson: 'attendre' },
    prix: { entree: 20000, sortie: 20010, taille: 2, stop: 19990, tp: 20030, partiels: [{ prix: 20015, taille: 1 }], devise: 'USD' },
    instrument: 'NQ',
  }
  assert.deepEqual(P.nettoyerSegment(segment), segment)
  const sans = { id: 's2', startedAt: 2 }
  assert.equal(P.nettoyerSegment(sans), sans, 'un segment sans prix ni instrument est rendu tel quel')
  assert.deepEqual(P.nettoyerTradesCarnet([segment, null, 'x', sans]), [segment, sans])
  assert.equal(P.nettoyerTradesCarnet('pas un tableau'), null)
})

bloc('nettoyage : nombres finis, 10 partiels au plus, instrument de 20 caracteres, illisible retire', () => {
  const partiels = Array.from({ length: 14 }, (_, i) => ({ prix: 100 + i, taille: i === 0 ? 'x' : 1 }))
  const net = P.nettoyerSegment({
    id: 's1', startedAt: 1,
    prix: { entree: '20000', sortie: null, taille: 1, stop: 19990, tp: Number.POSITIVE_INFINITY, partiels: [{ taille: 1 }, 'x', ...partiels] },
    instrument: '  EURUSD-tres-long-nom-de-contrat  ',
  })
  assert.deepEqual(Object.keys(net.prix).sort(), ['partiels', 'stop', 'taille'])
  assert.equal(net.prix.partiels.length, P.PARTIELS_MAX)
  assert.deepEqual(net.prix.partiels[0], { prix: 100 }) // taille illisible retiree, prix garde
  assert.equal(net.instrument, 'EURUSD-tres-long-nom')
  assert.equal(net.instrument.length, P.INSTRUMENT_MAX)
  const vide = P.nettoyerSegment({ id: 's2', startedAt: 1, prix: 'abc', instrument: '   ' })
  assert.deepEqual(vide, { id: 's2', startedAt: 1 })
  assert.deepEqual(P.nettoyerPrix({ partiels: 'abc' }), {})
  // La route l'utilise (les objets seulement, comme avant), et le type du segment connait les champs.
  assert.match(lire('../src/app/api/notes/route.ts'), /const cleanTrades = nettoyerTradesCarnet\(trades\)/)
  const types = lire('../src/types/index.ts')
  assert.match(types, /export interface TradePrixData \{[\s\S]*?partiels\?: \{ prix: number; taille\?: number \}\[\]/)
  assert.match(types, /export interface TradeSegmentData \{[\s\S]*?prix\?: TradePrixData[\s\S]*?instrument\?: string/)
  assert.match(types, /export interface TradePrixData \{[\s\S]*?sens\?: 'achat' \| 'vente'[\s\S]*?typeOrdre\?: 'marche' \| 'limite' \| 'stop'[\s\S]*?risque\?: \{ montant: number; unite: 'USD' \| '%' \}/)
})

bloc('nettoyage (Carnet 1.8.14) : sens, type d ordre et risque gardes s ils sont valables, bornes sinon', () => {
  const prix = { entree: 27287, stop: 27245.5, tp: 27350.5, taille: 6, sens: 'achat', typeOrdre: 'limite', risque: { montant: 100, unite: 'USD' } }
  assert.deepEqual(P.nettoyerPrix(prix), prix)
  assert.deepEqual(P.nettoyerPrix({ sens: 'vente', typeOrdre: 'marche', risque: { montant: 1.5, unite: '%' } }), { sens: 'vente', typeOrdre: 'marche', risque: { montant: 1.5, unite: '%' } })
  // Valeurs hors liste ou douteuses : retirees, jamais devinees.
  assert.deepEqual(P.nettoyerPrix({ sens: 'long', typeOrdre: 'market', risque: { montant: 100, unite: 'EUR' } }), {})
  assert.deepEqual(P.nettoyerPrix({ risque: { montant: 150, unite: '%' } }), {})
  assert.deepEqual(P.nettoyerPrix({ risque: { montant: -5, unite: 'USD' } }), {})
  assert.deepEqual(P.nettoyerPrix({ risque: { montant: P.RISQUE_MAX, unite: 'USD' } }), {})
  assert.deepEqual(P.nettoyerPrix({ risque: 'beaucoup' }), {})
  // Le risque est reduit a { montant, unite } : une cle de plus ne passe pas.
  assert.deepEqual(P.nettoyerPrix({ risque: { montant: 100, unite: 'USD', note: 'x'.repeat(5000) } }), { risque: { montant: 100, unite: 'USD' } })
  assert.deepEqual(P.nettoyerRisque({ montant: 2, unite: '%' }), { montant: 2, unite: '%' })
  assert.equal(P.nettoyerRisque(null), null)
  // Un segment d'une note d'avant la 1.8.14 reste intact.
  const ancien = { id: 's9', startedAt: 9, prix: { entree: 1, stop: 0.5 } }
  assert.deepEqual(P.nettoyerSegment(ancien), ancien)
})

// ── Le prevu, le sens, le R ─────────────────────────────────────────────────

bloc('prevu : rPrevu = |tp - entree| / |entree - stop| ; null sans l un des trois ou risque nul ; sens du stop', () => {
  assert.deepEqual(prevu({ entree: 20000, stop: 19990, tp: 20030, taille: 2, partiels: [{ prix: 20015 }] }), {
    entree: 20000, stop: 19990, tp: 20030, taille: 2, sortie: null, partiels: [{ prix: 20015, taille: null }], rPrevu: 3,
    sens: null, typeOrdre: null, risque: null,
  })
  assert.equal(S.calculerRPrevu(1.1, 1.102, 1.095), 2.5) // short sur EURUSD
  assert.equal(S.calculerRPrevu(100, null, 110), null)
  assert.equal(S.calculerRPrevu(100, 95, null), null)
  assert.equal(S.calculerRPrevu(100, 100, 110), null)
  assert.deepEqual(S.lirePrevu({}), {
    entree: null, stop: null, tp: null, taille: null, sortie: null, partiels: [], rPrevu: null, sens: null, typeOrdre: null, risque: null,
  })
  assert.equal(S.sensDuTrade('short', 100, 95), -1) // la direction du broker passe d'abord
  assert.equal(S.sensDuTrade(null, 100, 95), 1)
  assert.equal(S.sensDuTrade(null, 100, 105), -1)
  assert.equal(S.sensDuTrade(null, 100, null), null)
})

bloc('sens (Carnet 1.8.14) : le sens CHOISI prime sur le sens deduit du stop, jamais sur le broker', () => {
  assert.equal(S.sensDuTrade(null, 100, 95, 'vente'), -1) // le stop dirait long
  assert.equal(S.sensDuTrade(null, 100, 105, 'achat'), 1) // le stop dirait short
  assert.equal(S.sensDuTrade(null, null, null, 'vente'), -1)
  assert.equal(S.sensDuTrade('long', 100, 95, 'vente'), 1) // le broker a execute un long
  assert.equal(S.sensDuTrade(null, 100, 95, null), 1)
  const p = prevu({ entree: 20000, stop: 19990, sens: 'vente', typeOrdre: 'stop', risque: { montant: 1, unite: '%' } })
  assert.equal(p.sens, 'vente')
  assert.equal(p.typeOrdre, 'stop')
  assert.deepEqual(p.risque, { montant: 1, unite: '%' })
  // Sans direction du broker, les ecarts s'orientent par le sens choisi : une vente prevue a 20 000, faite a 20 001 = mieux.
  const e = S.effectifDesPositions([pos('a', { direction: null, prixEntree: 20001, prixSortie: 19990, quantite: 1 })])
  const ecarts = S.ecartsDuTrade(p, e, ms('10:00'))
  assert.equal(ecarts.entree, -1)
  assert.equal(ecarts.rReel, 1.1)
  // Sans sens choisi, le stop sous l'entree dit long : le meme ecart devient « moins bien ».
  const sansSens = S.ecartsDuTrade(prevu({ entree: 20000, stop: 19990 }), e, ms('10:00'))
  assert.equal(sansSens.entree, 1)
})

// ── Les ecarts ──────────────────────────────────────────────────────────────

bloc('long : entree payee plus cher = ecart positif, rReel sur le risque prevu, sortie au TP, delai d entree', () => {
  const p = prevu({ entree: 20000, stop: 19990, tp: 20030, taille: 2, sortie: 20031 })
  const e = S.effectifDesPositions([pos('a', { prixEntree: 20001, prixSortie: 20030, quantite: 2 })])
  const ecarts = S.ecartsDuTrade(p, e, ms('10:00'))
  assert.deepEqual(ecarts, {
    entree: 1, sortie: 1, taille: 0, risque: 10, rReel: 2.9, sortieVsPlan: 'tp', delaiEntreeMin: 2, heureIncertaine: false,
  })
})

bloc('short : vendu plus bas = ecart positif ; sortie pire que le stop ; rReel negatif', () => {
  const p = prevu({ entree: 20000, stop: 20010, tp: 19970 })
  const e = S.effectifDesPositions([pos('a', { direction: 'short', prixEntree: 19998, prixSortie: 20013, pnl: -300 })])
  const ecarts = S.ecartsDuTrade(p, e, ms('10:00'))
  assert.equal(ecarts.entree, 2)
  assert.equal(ecarts.rReel, -1.5)
  assert.equal(ecarts.sortieVsPlan, 'au-dela-stop')
  // Racheté a 20010,5 : a un dixieme du risque du stop = au stop.
  const auStop = S.effectifDesPositions([pos('a', { direction: 'short', prixEntree: 20000, prixSortie: 20010.5 })])
  assert.equal(S.ecartsDuTrade(p, auStop, ms('10:00')).sortieVsPlan, 'stop')
  // Coupe en perte avant le stop, et en gain avant le TP.
  assert.equal(S.ecartsDuTrade(p, S.effectifDesPositions([pos('a', { direction: 'short', prixEntree: 20000, prixSortie: 20005 })]), 0).sortieVsPlan, 'avant-stop')
  assert.equal(S.ecartsDuTrade(p, S.effectifDesPositions([pos('a', { direction: 'short', prixEntree: 20000, prixSortie: 19985 })]), 0).sortieVsPlan, 'avant-tp')
})

bloc('sans stop tape : le stop du broker sert d unite ; sans aucun stop : rReel null, TP seul juge la sortie', () => {
  const p = prevu({ entree: 20000, tp: 20030 })
  const avecStopBroker = S.effectifDesPositions([pos('a', { prixEntree: 20000, prixSortie: 20015, stopPrix: 19985 })])
  const a = S.ecartsDuTrade(p, avecStopBroker, ms('10:00'))
  assert.equal(a.risque, 15)
  assert.equal(a.rReel, 1)
  assert.equal(a.sortieVsPlan, 'avant-tp')
  const sansStop = S.ecartsDuTrade(p, S.effectifDesPositions([pos('a', { prixEntree: 20000, prixSortie: 20029 })]), ms('10:00'))
  assert.equal(sansStop.risque, null)
  assert.equal(sansStop.rReel, null)
  assert.equal(sansStop.sortieVsPlan, 'tp') // a un dixieme de la distance au TP
  // Ni stop ni TP : pas de plan.
  assert.equal(S.ecartsDuTrade(prevu({ entree: 20000 }), S.effectifDesPositions([pos('a')]), 0).sortieVsPlan, null)
})

bloc('sans tp : la sortie se juge au stop seulement ; une sortie en gain sans TP n a pas de categorie', () => {
  const p = prevu({ entree: 20000, stop: 19990 })
  assert.equal(p.rPrevu, null)
  const gain = S.ecartsDuTrade(p, S.effectifDesPositions([pos('a', { prixEntree: 20000, prixSortie: 20020 })]), 0)
  assert.equal(gain.rReel, 2)
  assert.equal(gain.sortieVsPlan, null)
  assert.equal(S.ecartsDuTrade(p, S.effectifDesPositions([pos('a', { prixEntree: 20000, prixSortie: 19995 })]), 0).sortieVsPlan, 'avant-stop')
  assert.equal(S.ecartsDuTrade(p, S.effectifDesPositions([pos('a', { prixEntree: 20000, prixSortie: 19989.5 })]), 0).sortieVsPlan, 'stop')
})

bloc('BE : sortie au prix d entree = rReel 0, classee avant-stop ; sans sens (ni direction ni stop) les ecarts orientes sont null', () => {
  const p = prevu({ entree: 20000, stop: 19990, tp: 20030 })
  const be = S.ecartsDuTrade(p, S.effectifDesPositions([pos('a', { prixEntree: 20000, prixSortie: 20000, pnl: 0 })]), 0)
  assert.equal(be.rReel, 0)
  assert.equal(be.entree, 0)
  assert.equal(be.sortieVsPlan, 'avant-stop')
  const sansSens = S.ecartsDuTrade(prevu({ entree: 20000, taille: 1 }), S.effectifDesPositions([pos('a', { direction: null, quantite: 3 })]), 0)
  assert.equal(sansSens.entree, null)
  assert.equal(sansSens.rReel, null)
  assert.equal(sansSens.taille, 2) // la taille ne depend pas du sens
})

bloc('copies sur trois comptes : prix ponderes, taille d UN compte, P&L additionne, comptes distincts, executions', () => {
  const e = S.effectifDesPositions([
    pos('c', { compteId: 'cC', compte: 'XX-03', entreLe: iso('10:02'), prixEntree: 20002, quantite: 1, pnl: 190, frais: 2, executions: 2 }),
    pos('a', { compteId: 'cA', entreLe: iso('10:01'), prixEntree: 20000, quantite: 2, pnl: 400, frais: 4 }),
    pos('b', { compteId: 'cB', compte: 'XX-02', entreLe: iso('10:01'), prixEntree: 20001, quantite: 1, pnl: 195, frais: null, sortiLe: iso('10:25') }),
  ])
  assert.deepEqual(e.positions.map(p => p.positionId), ['a', 'b', 'c'])
  assert.equal(e.entree, 20000.75) // (2 x 20000 + 20001 + 20002) / 4
  assert.equal(e.taille, 2) // la premiere position, pas la somme des comptes
  assert.equal(e.pnl, 785)
  assert.equal(e.devise, 'USD')
  assert.equal(e.frais, 6)
  assert.equal(e.executions, 4)
  assert.equal(e.comptes, 3)
  assert.equal(e.dureeSec, 24 * 60) // de 10:01 a 10:25
  assert.equal(S.effectifDesPositions([]), null)
  // Deux copies sur le meme compte Pilotage mais deux comptes du broker (un export Quantower a sous-comptes) : deux comptes.
  assert.equal(S.effectifDesPositions([pos('a', { compte: 'XX-01' }), pos('b', { compte: 'XX-02' })]).comptes, 2)
})

bloc('partiels : le prevu garde ses clotures partielles ; plusieurs executions = une sortie ponderee cote broker', () => {
  const p = prevu({ entree: 20000, stop: 19990, tp: 20040, taille: 2, partiels: [{ prix: 20020, taille: 1 }, { prix: 20040 }] })
  assert.deepEqual(p.partiels, [{ prix: 20020, taille: 1 }, { prix: 20040, taille: null }])
  // La position du broker agregee par vuePositions (prix de sortie deja pondere : 20030 pour 1 a 20020 et 1 a 20040).
  const e = S.effectifDesPositions([pos('a', { quantite: 2, prixEntree: 20000, prixSortie: 20030, executions: 2 })])
  const ecarts = S.ecartsDuTrade(p, e, ms('10:00'))
  assert.equal(ecarts.rReel, 3)
  assert.equal(ecarts.sortieVsPlan, 'avant-tp')
  assert.equal(e.executions, 2)
})

bloc('devise : rien n est converti ; deux devises = P&L et frais null, chaque position garde ses montants', () => {
  const eur = S.effectifDesPositions([pos('a', { devise: 'EUR', pnl: 50, frais: 1 })])
  assert.equal(eur.devise, 'EUR')
  assert.equal(eur.pnl, 50)
  const melange = S.effectifDesPositions([pos('a', { devise: 'EUR', pnl: 50, frais: 1 }), pos('b', { devise: 'USD', pnl: 60, frais: 2, entreLe: iso('10:03') })])
  assert.equal(melange.devise, null)
  assert.equal(melange.pnl, null)
  assert.equal(melange.frais, null)
  assert.deepEqual(melange.positions.map(p => [p.devise, p.pnl]), [['EUR', 50], ['USD', 60]])
})

bloc('heure incertaine : une position sans fuseau (heure affichee stockee en UTC) le dit ; delai en minutes, une decimale', () => {
  const p = prevu({ entree: 20000 })
  const sure = S.ecartsDuTrade(p, S.effectifDesPositions([pos('a', { entreLe: '2026-10-05T10:01:30.000Z' })]), ms('10:00'))
  assert.equal(sure.delaiEntreeMin, 1.5)
  assert.equal(sure.heureIncertaine, false)
  const incertaine = S.ecartsDuTrade(p, S.effectifDesPositions([pos('a'), pos('b', { fuseau: null, compteId: 'cB' })]), ms('10:00'))
  assert.equal(incertaine.heureIncertaine, true)
  // Une heure telle qu'affichee a Paris (12:02 stockee comme 12:02 UTC) : deux heures de trop, d'ou le drapeau.
  assert.equal(S.ecartsDuTrade(p, S.effectifDesPositions([pos('a', { entreLe: iso('12:02'), fuseau: null })]), ms('10:00')).delaiEntreeMin, 122)
})

// ── La synthese complete ────────────────────────────────────────────────────

const notes = [
  { id: 'n1', title: 'Seance NY', warmups: [{ startedAt: ms('09:30'), emotionLevel: 35 }, { startedAt: ms('11:00'), emotionLevel: 80 }], trades: [
    { id: 's1', startedAt: ms('10:00'), closedAt: ms('10:30'), outcome: 'gain', r: 3, instrument: 'NQ',
      prix: { entree: 20000, stop: 19990, tp: 20030, taille: 1 }, cooldown: { emotion: 'calme', error: ' entre tot ', lesson: 'attendre' } },
    { id: 's2', startedAt: ms('11:10'), outcome: 'perte', prix: { entree: 1.1, stop: 1.102, tp: 1.095 } }, // pas de position : prevu sans broker
    { id: 's3', startedAt: Date.parse('2026-10-07T10:00:00.000Z') }, // hors periode
  ] },
]
const positions = [
  pos('a', { segmentRef: 's1', prixEntree: 20001, prixSortie: 20030 }),
  pos('b', { segmentRef: 's1', compteId: 'cB', compte: 'XX-02', prixEntree: 20001, prixSortie: 20030 }),
  pos('x', { segmentRef: null, entreLe: iso('12:00'), sortiLe: iso('12:10') }), // broker sans note
  pos('z', { segmentRef: 'disparu', entreLe: iso('13:00'), sortiLe: iso('13:10') }), // segment supprime : sans note
  pos('y', { segmentRef: null, entreLe: '2026-10-09T10:00:00.000Z', sortiLe: '2026-10-09T10:10:00.000Z' }), // hors periode
]
const jugements = [
  { tradeRef: 's1', grade: 'C', causeCategory: 'emotionnel', phrase: 'premier avis', createdAt: new Date(iso('11:00')) },
  { tradeRef: 's1', grade: 'B+', causeCategory: 'technique', phrase: ' entree propre ', createdAt: new Date(iso('12:00')) },
]
const captures = [
  { messageId: 'm1', tradeRef: 's1', contenu: 'https://exemple.test/capture-1.png' },
  { messageId: 'm2', tradeRef: 's1', contenu: '<p>avant</p><img src="https://exemple.test/capture-2.webp" alt="">' },
  { messageId: 'm3', tradeRef: 's1', contenu: 'data:image/png;base64,AAAA' }, // ecartee
  { messageId: 'm4', tradeRef: null, contenu: 'https://exemple.test/sans-trade.png' },
]
const periode = { depuis: S.lireBorne('2026-10-05', false), jusqu: S.lireBorne('2026-10-05', true) }

bloc('synthese : periode, prevu face aux copies, ressenti, dernier jugement, captures http seulement', () => {
  const r = S.synthetiser({ notes, positions, jugements, captures, periode })
  assert.deepEqual(r.trades.map(t => t.segmentId), ['s2', 's1']) // du plus recent au plus ancien, s3 hors periode
  const s1 = r.trades.find(t => t.segmentId === 's1')
  assert.equal(s1.noteTitle, 'Seance NY')
  assert.equal(s1.instrument, 'NQ')
  assert.equal(s1.startedAt, iso('10:00'))
  assert.equal(s1.closedAt, iso('10:30'))
  assert.equal(s1.prevu.rPrevu, 3)
  assert.equal(s1.effectif.comptes, 2)
  assert.equal(s1.effectif.pnl, 400)
  assert.equal(s1.ecarts.entree, 1)
  assert.equal(s1.ecarts.sortieVsPlan, 'tp')
  assert.deepEqual(s1.ressenti, { emotionDepart: 35, emotion: 'calme', erreur: 'entre tot', lecon: 'attendre' })
  assert.deepEqual(s1.jugement, { grade: 'B+', phrase: 'entree propre', cause: 'technique' })
  assert.deepEqual(s1.captures, [{ url: 'https://exemple.test/capture-1.png', messageId: 'm1' }, { url: 'https://exemple.test/capture-2.webp', messageId: 'm2' }])
  const s2 = r.trades.find(t => t.segmentId === 's2')
  assert.equal(s2.effectif, null)
  assert.equal(s2.ecarts, null)
  assert.equal(s2.jugement, null)
  assert.equal(s2.instrument, null)
  assert.equal(s2.ressenti.emotionDepart, 80)
  assert.deepEqual(r.positionsSansNote.map(p => p.positionId), ['x', 'z'])
})

bloc('resume : lies, prevus sans broker, broker sans note, ecart d entree en R et par instrument, sorties', () => {
  const r = S.synthetiser({ notes, positions, jugements, captures, periode })
  assert.deepEqual(r.resume, {
    trades: 2, lies: 1, prevusSansBroker: 1, brokerSansNote: 2, positionsLiees: 2,
    ecartEntreeMoyen: 0.1, ecartEntreeParInstrument: [{ instrument: 'NQ', n: 1, moyenne: 1 }],
    sortiesAvantPlan: 0, sorties: { tp: 1, avantTp: 0, stop: 0, avantStop: 0, auDelaStop: 0, sansPlan: 0 },
    heuresIncertaines: 0,
  })
  // Sans periode : tout, s3 compris (sans position).
  const tout = S.synthetiser({ notes, positions, jugements: [], captures: [], periode: { depuis: null, jusqu: null } })
  assert.equal(tout.trades.length, 3)
  assert.deepEqual(tout.positionsSansNote.map(p => p.positionId), ['x', 'z', 'y'])
  assert.equal(S.synthetiser({ notes: [], positions: [], jugements: [], captures: [], periode }).resume.ecartEntreeMoyen, null)
})

bloc('brief J2 : sorties du broker = executions de la premiere position, par sortie (ouvertes a la fin) ; ordre du trade dans la note', () => {
  const t = hm => new Date(iso(hm))
  const execs = [
    { id: 'e2', positionId: 'a', prixEntree: 20100.25, prixSortie: 20131, quantite: 1, sortiLe: t('10:30') },
    { id: 'a', positionId: 'a', prixEntree: 20100.25, prixSortie: 20120.5, quantite: 1, sortiLe: t('10:12') },
    { id: 'b', positionId: null, prixEntree: 20100.5, prixSortie: 20125, quantite: 2, sortiLe: t('10:20') }, // la copie : position b
    { id: 'o', positionId: 'a', prixEntree: 20101, prixSortie: null, quantite: 1, sortiLe: null },
  ]
  const e = S.effectifDesPositions([pos('b', { compteId: 'cB', entreLe: iso('10:02') }), pos('a', { entreLe: iso('10:01'), quantite: 3 })], execs)
  assert.deepEqual(e.sorties, [
    { entree: 20100.25, prix: 20120.5, quantite: 1, le: iso('10:12') },
    { entree: 20100.25, prix: 20131, quantite: 1, le: iso('10:30') },
    { entree: 20101, prix: null, quantite: 1, le: null },
  ])
  assert.deepEqual(S.effectifDesPositions([pos('a')]).sorties, []) // sans executions fournies
  const r = S.synthetiser({ notes, positions, jugements: [], captures: [], periode, executions: [{ id: 'a', positionId: 'a', prixEntree: 20001, prixSortie: 20030, quantite: 1, sortiLe: t('10:20') }] })
  assert.deepEqual(r.trades.map(x => [x.segmentId, x.ordre]), [['s2', 2], ['s1', 1]])
  assert.deepEqual(r.trades.find(x => x.segmentId === 's1').effectif.sorties, [{ entree: 20001, prix: 20030, quantite: 1, le: iso('10:20') }])
  assert.match(lire('../src/app/api/trades/synthese/route.ts'), /periode,\s*executions,\s*\}\)/)
})

bloc('bornes et captures : date seule (jour compris) ou instant ISO, illisible = NaN ; URL http(s) seulement', () => {
  assert.equal(S.lireBorne('2026-10-05', false), Date.parse('2026-10-05T00:00:00Z'))
  assert.equal(S.lireBorne('2026-10-05', true), Date.parse('2026-10-06T00:00:00Z'))
  assert.equal(S.lireBorne('2026-10-05T10:00:00Z', true), Date.parse('2026-10-05T10:00:00Z') + 1)
  assert.ok(Number.isNaN(S.lireBorne('hier', false)))
  assert.equal(S.lireBorne(null, false), null)
  assert.equal(S.urlDeCapture('  https://exemple.test/a.png '), 'https://exemple.test/a.png')
  assert.equal(S.urlDeCapture("<img src='http://exemple.test/b.jpg'>"), 'http://exemple.test/b.jpg')
  assert.equal(S.urlDeCapture('data:image/png;base64,AAAA'), null)
  assert.equal(S.urlDeCapture('javascript:alert(1)'), null)
  assert.equal(S.urlDeCapture('texte libre'), null)
})

// ── La route ────────────────────────────────────────────────────────────────

bloc('route GET /api/trades/synthese : jeton ou cookie, CORS, lecture seule, chaque lecture bornee au membre', () => {
  const route = lire('../src/app/api/trades/synthese/route.ts')
  assert.match(route, /const METHODES = 'GET, OPTIONS'/)
  assert.match(route, /export async function OPTIONS\(req: NextRequest\) \{\s*return corsPreflight\(req, METHODES\)/)
  assert.match(route, /const userId = await getUserId\(req\)\s*if \(!userId\) return NextResponse\.json\(\{ error: 'Non connecté\.' \}, \{ status: 401, headers: cors \}\)/)
  assert.ok(!/export async function (POST|PATCH|PUT|DELETE)/.test(route), 'lecture seule')
  assert.ok(!/\.(create|update|upsert|delete)(Many)?\(/.test(route), 'aucune ecriture')
  assert.match(route, /executionsDuMembre\(userId\)/)
  assert.match(route, /prisma\.note\.findMany\(\{ where: \{ userId, deletedAt: null \}/)
  assert.match(route, /prisma\.annotation\.findMany\(\{\s*where: \{ userId, tradeRef: \{ in: refs \} \}/)
  // Message n'a pas de userId : borne par sa note.
  assert.match(route, /prisma\.message\.findMany\(\{\s*where: \{ tradeRef: \{ in: refs \}, type: \{ in: \[\.\.\.IMAGE_TYPES\] \}, note: \{ userId, deletedAt: null \} \}/)
  assert.match(route, /if \(Number\.isNaN\(depuis\) \|\| Number\.isNaN\(jusqu\)\) \{\s*return NextResponse\.json\(\{ error: [^}]*\}, \{ status: 400, headers: cors \}\)/)
  // Le module de calcul n'importe que des modules purs.
  const pur = lire('../src/lib/synthese-trades-pur.ts')
  assert.deepEqual([...pur.matchAll(/^import\b[\s\S]*?from '([^']+)'/gm)].map(m => m[1]), ['./carnet-sur-positions', './prix-carnet', './positions'])
  assert.ok(!/^import /m.test(lire('../src/lib/prix-carnet.ts')), 'prix-carnet.ts importe quelque chose')
})

console.log(`\n${n} blocs verifies, tout est bon.`)
