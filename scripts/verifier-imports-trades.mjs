// Les trades qui restent (brief A, 29/10/2026) : les lecteurs (Tradovate,
// TopstepX, CSV generique, Quantower refuse), le regroupement des executions
// en positions, le rapprochement avec les segments du Carnet, et le bornage
// des routes au membre. Fonctions pures, aucune base, aucun reseau ; fixtures
// SYNTHETIQUES (memes en-tetes que les vrais exports, valeurs inventees).
// node scripts/verifier-imports-trades.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { parserFichierTrades, proposerColonnes, separerNouveaux, lireColonnes } from '../src/lib/imports-trades.ts'
import { liensAHarmoniser, planFusion, positionsRecalculees, regrouperEnPositions, totauxParCompte, vuePositions } from '../src/lib/positions.ts'
import { candidatsPourPosition, proposerLiens, segmentsDesNotes, FENETRE_OUVERTE_MS } from '../src/lib/correspondances-carnet.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const ids = r => r.trades.map(t => t.idExterne)
const reimport = r => separerNouveaux(r.trades, new Set(ids(r))).length

// ── Fixtures ────────────────────────────────────────────────────────────────

const TRADOVATE = [
  'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration',
  'NQZ6,-2,0,0.25,900000000001,900000000002,1,20000.00,20010.00,$200.00,10/05/2026 15:30:00,10/05/2026 15:35:10,5min 10sec',
  'ESZ6,-2,0,0.25,900000000003,900000000004,2,6000.00,5995.50,"$(450.00)",10/06/2026 16:10:00,10/06/2026 16:02:30,7min 30sec',
].join('\r\n')

const ENTETES_TOPSTEPX = 'Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type,TradeDay,TradeDuration'
const TOPSTEPX = [
  '﻿' + ENTETES_TOPSTEPX,
  '500000001,MNQZ6,10/05/2026 15:30:00 +02:00,10/05/2026 15:32:30 +02:00,20000.000000000,20005.000000000,0.74000,10.000000000,1,Long,10/05/2026 00:00:00 -05:00,00:02:30.1234560',
  '500000002,MNQZ6,10/05/2026 15:31:00 +02:00,10/05/2026 15:40:00 +02:00,20002.000000000,20010.000000000,0.74000,16.000000000,1,Long,10/05/2026 00:00:00 -05:00,00:09:00.0000000',
  '500000003,MNQZ6,10/05/2026 16:00:00 +02:00,10/05/2026 16:05:00 +02:00,20020.000000000,20015.000000000,1.48000,20.000000000,2,Short,10/05/2026 00:00:00 -05:00,1.00:05:00',
  '500000004,MNQZ6,pas une date,10/05/2026 16:05:00 +02:00,20020.000000000,20015.000000000,0.74000,10.000000000,1,Long,10/05/2026 00:00:00 -05:00,00:05:00',
  '500000005,MNQZ6,10/05/2026 17:00:00 +02:00,10/05/2026 17:05:00 +02:00,20020.000000000,20015.000000000,0.74000,10.000000000,1,Flat,10/05/2026 00:00:00 -05:00,00:05:00',
  '500000001,MNQZ6,10/05/2026 15:30:00 +02:00,10/05/2026 15:32:30 +02:00,20000.000000000,20005.000000000,0.74000,10.000000000,1,Long,10/05/2026 00:00:00 -05:00,00:02:30',
].join('\r\n')

// Un export « Excel francais » : point-virgule, virgule decimale, dates jour d'abord.
const GENERIQUE = [
  'Instrument;Ouverture;Clôture;Sens;Quantité;Prix entrée;Prix sortie;Résultat;Frais;Ticket;Stop',
  'DAX;06/10/2026 09:15:00;06/10/2026 09:20:00;Achat;1;19000,5;19010,5;250,00;2,50;T-1;18990',
  'DAX;13/10/2026 10:00:00;13/10/2026 10:30:00;Vente;2;19100;19080;1 000,00;-5;T-2;0',
  'DAX;14/10/2026 10:00:00;;Vente;1;19100;;-50;;T-3;',
  'DAX;15/10/2026 25:00:00;15/10/2026 10:30:00;Vente;1;19100;19080;10;;T-4;',
  ';16/10/2026 10:00:00;16/10/2026 10:30:00;Vente;1;19100;19080;abc;;T-5;',
  'DAX;17/10/2026 10:00:00;17/10/2026 10:30:00;Achat;0,5;19100;19080;10;;T-6;',
  'DAX;18/10/2026 10:00:00;18/10/2026 10:30:00;Achat;1;19100;19080;10;;T-1;',
].join('\n')
const COLONNES = {
  symbole: 'Instrument', entreLe: 'Ouverture', sortiLe: 'Clôture', direction: 'Sens', quantite: 'Quantité',
  prixEntree: 'Prix entrée', prixSortie: 'Prix sortie', pnl: 'Résultat', frais: 'Frais', idExterne: 'Ticket', stopPrix: 'Stop',
  devise: 'eur',
}

const QUANTOWER = [
  '﻿Account,Symbol,Description,Symbol type,Expiration date,Strike price,Side,Order type,Quantity,Price,Trigger price,TIF,Status,Date/Time,Order ID,Order group ID,Connection name,Original status,Additional parameters,Exchange,Comment,Average fill price,Order value,Qty. filled,Qty. remaining,',
  'DEMO-001,NQZ6,Contrat de demo,Futures,18/12/2026 00:00:00 -05:00,0,Buy,Limit,1,"20000,5",,GTC,Filled,05/10/2026 09:00:00 -05:00,1000001,,Rithmic,complete,,CME,,"20000,5",400010,1,0,',
].join('\r\n')

// ── Les lecteurs ────────────────────────────────────────────────────────────

bloc('Tradovate : lu tel quel (heure affichee, sans fuseau), reimport = 0 nouveau', () => {
  const r = parserFichierTrades(TRADOVATE)
  assert.equal(r.format, 'tradovate-performance')
  assert.deepEqual(r.erreurs, [])
  assert.equal(r.trades.length, 2)
  const [long, short] = r.trades
  assert.equal(long.direction, 'long')
  assert.equal(long.entreLe.toISOString(), '2026-10-05T15:30:00.000Z')
  assert.equal(long.idExterne, '900000000001-900000000002')
  assert.equal(short.direction, 'short') // vendu d'abord
  assert.equal(short.entreLe.toISOString(), '2026-10-06T16:02:30.000Z')
  assert.equal(short.prixEntree, 5995.5)
  assert.equal(short.pnl, -450)
  assert.equal(short.dureeSec, 450)
  assert.equal(short.fuseau ?? null, null)
  assert.equal(reimport(r), 0)
})

bloc('TopstepX : vrai instant UTC, decalage garde, frais, duree, lignes rejetees avec leur raison', () => {
  const r = parserFichierTrades(TOPSTEPX, 'trades_export.csv')
  assert.equal(r.format, 'topstepx-trades')
  assert.equal(r.trades.length, 3)
  const [a, , c] = r.trades
  assert.equal(a.source, 'topstepx-trades')
  assert.equal(a.idExterne, '500000001')
  assert.equal(a.symbole, 'MNQZ6')
  assert.equal(a.entreLe.toISOString(), '2026-10-05T13:30:00.000Z') // 15:30 a +02:00
  assert.equal(a.sortiLe.toISOString(), '2026-10-05T13:32:30.000Z')
  assert.equal(a.fuseau, '+02:00')
  assert.equal(a.frais, 0.74)
  assert.equal(a.dureeSec, 150)
  assert.equal(a.devise, 'USD')
  assert.equal(a.stopPrix, null) // le fichier ne dit rien du stop
  assert.equal(c.direction, 'short')
  assert.equal(c.quantite, 2)
  assert.equal(c.dureeSec, 86_700) // « 1.00:05:00 », au-dela d'un jour
  assert.equal(r.erreurs.length, 3)
  assert.match(r.erreurs[0], /^Ligne 5 illisible \(EnteredAt illisible\) : ignorée\.$/)
  assert.match(r.erreurs[1], /^Ligne 6 illisible \(Type ni Long ni Short\)/)
  assert.match(r.erreurs[2], /^Ligne 7 : même Id que la ligne 2/)
  assert.equal(reimport(r), 0)
})

bloc('TopstepX : un fichier repasse par un Excel francais (point-virgule) se lit encore', () => {
  const pv = TOPSTEPX.split('\r\n').slice(0, 2).map(l => l.replace(/,/g, ';')).join('\r\n')
  const r = parserFichierTrades(pv)
  assert.equal(r.format, 'topstepx-trades')
  assert.equal(r.trades.length, 1)
  assert.equal(r.trades[0].pnl, 10)
})

bloc('CSV generique sans colonnes : en-tetes et proposition, aucune ligne lue', () => {
  const r = parserFichierTrades(GENERIQUE)
  assert.equal(r.format, 'csv-generique')
  assert.equal(r.trades.length, 0)
  assert.equal(r.entetes.length, 11)
  assert.match(r.erreurs[0], /désigne les colonnes/)
  const { devise, ...attendu } = COLONNES
  void devise
  assert.deepEqual(r.proposition, attendu)
  // Noms anglais et doublons (MT5 : deux « Time », deux « Price ») : renommes, proposes.
  const mt5 = parserFichierTrades('Time,Position,Symbol,Type,Volume,Price,S / L,T / P,Time,Price,Commission,Swap,Profit\n')
  assert.deepEqual(mt5.entetes.slice(8, 10), ['Time (2)', 'Price (2)'])
  assert.deepEqual(proposerColonnes(['Entry Time (UTC)', 'Exit Time (UTC)', 'Ticker', 'P&L', 'Side']), {
    symbole: 'Ticker', entreLe: 'Entry Time (UTC)', sortiLe: 'Exit Time (UTC)', pnl: 'P&L', direction: 'Side',
  })
})

bloc('CSV generique avec colonnes : montants francais, sens, stop, rejets motives, reimport = 0', () => {
  const r = parserFichierTrades(GENERIQUE, 'export.csv', lireColonnes(COLONNES))
  assert.equal(r.format, 'csv-generique')
  assert.equal(r.trades.length, 3)
  const [a, b, c] = r.trades
  assert.equal(a.entreLe.toISOString(), '2026-10-06T09:15:00.000Z') // jour d'abord (le 13/10 tranche)
  assert.equal(a.fuseau, null) // pas de decalage dans le fichier
  assert.equal(a.direction, 'long')
  assert.equal(a.prixEntree, 19000.5)
  assert.equal(a.frais, 2.5)
  assert.equal(a.stopPrix, 18990)
  assert.equal(a.devise, 'EUR')
  assert.equal(a.dureeSec, 300)
  assert.equal(a.idExterne, 'T-1|DAX|2026-10-06T09:15:00.000Z')
  assert.equal(b.pnl, 1000)
  assert.equal(b.quantite, 2)
  assert.equal(b.frais, 5) // un cout, quel que soit son signe dans le fichier
  assert.equal(b.stopPrix, null) // 0 = pas de stop (MT4/MT5)
  assert.equal(c.sortiLe, null)
  assert.equal(c.prixSortie, null)
  assert.equal(r.erreurs.length, 4)
  assert.match(r.erreurs[0], /^Ligne 5 illisible \(date d'entrée illisible\)/)
  assert.match(r.erreurs[1], /^Ligne 6 illisible \(symbole vide, P&L illisible\)/)
  assert.match(r.erreurs[2], /^Ligne 7 illisible \(quantité illisible/)
  assert.match(r.erreurs[3], /^Ligne 8 : même identifiant que la ligne 2/)
  assert.equal(reimport(parserFichierTrades(GENERIQUE, 'export.csv', lireColonnes(COLONNES))), 0)
})

bloc('CSV generique : ISO avec decalage, AM/PM, dates ambigues, colonne absente', () => {
  const iso = 'symbol,open_time,close_time,side,qty,pnl\nEURUSD,2026-10-05T08:00:00Z,2026-10-05 10:30:00+02:00,sell,3,12.5\n'
  const r = parserFichierTrades(iso, undefined, { symbole: 'symbol', entreLe: 'open_time', sortiLe: 'close_time', direction: 'side', quantite: 'qty', pnl: 'pnl' })
  assert.equal(r.trades[0].entreLe.toISOString(), '2026-10-05T08:00:00.000Z')
  assert.equal(r.trades[0].sortiLe.toISOString(), '2026-10-05T08:30:00.000Z')
  assert.equal(r.trades[0].fuseau, '+00:00')
  assert.equal(r.trades[0].direction, 'short')
  const col = { symbole: 's', entreLe: 'e', pnl: 'p' }
  // 04/06 et 05/07 : rien ne tranche, on ne devine pas.
  const ambigu = 's,e,p\nNQ,04/06/2026 09:00:00,1\nNQ,05/07/2026 3:15 PM,2\n'
  const r1 = parserFichierTrades(ambigu, undefined, col)
  assert.equal(r1.trades.length, 0)
  assert.match(r1.erreurs[0], /Dates ambiguës.*formatDate/)
  const r2 = parserFichierTrades(ambigu, undefined, { ...col, formatDate: 'MM/DD/YYYY' })
  assert.equal(r2.trades[0].entreLe.toISOString(), '2026-04-06T09:00:00.000Z')
  assert.equal(r2.trades[1].entreLe.toISOString(), '2026-05-07T15:15:00.000Z')
  assert.equal(parserFichierTrades(ambigu, undefined, { ...col, formatDate: 'JJ/MM/AAAA' }).trades[0].entreLe.toISOString(), '2026-06-04T09:00:00.000Z')
  // Le 31/02 n'existe pas : rejete, pas glisse au 3 mars.
  assert.match(parserFichierTrades('s,e,p\nNQ,31/02/2026 09:00:00,1\nNQ,13/02/2026 09:00:00,1\n', undefined, col).erreurs[0], /^Ligne 2 illisible/)
  const r3 = parserFichierTrades(ambigu, undefined, { ...col, pnl: 'Profit' })
  assert.match(r3.erreurs[0], /« Profit » \(pnl\) introuvable/)
  assert.ok(r3.proposition)
  assert.match(parserFichierTrades(ambigu, undefined, { symbole: 's', pnl: 'p' }).erreurs[0], /non désignée : entreLe/)
})

bloc('CSV generique sans identifiant : empreinte stable, deux partiels identiques gardes', () => {
  const f = 's,e,q,p\nNQ,2026-10-05 09:00:00,1,50\nNQ,2026-10-05 09:00:00,1,50\nNQ,2026-10-05 09:01:00,1,50\n'
  const col = { symbole: 's', entreLe: 'e', quantite: 'q', pnl: 'p' }
  const r = parserFichierTrades(f, undefined, col)
  assert.deepEqual(ids(r), [
    'NQ|2026-10-05T09:00:00.000Z|1|50', 'NQ|2026-10-05T09:00:00.000Z|1|50#2', 'NQ|2026-10-05T09:01:00.000Z|1|50',
  ])
  assert.equal(separerNouveaux(parserFichierTrades(f, undefined, col).trades, new Set(ids(r))).length, 0)
  // Un fichier plus long qui reprend le premier : seules les lignes en plus sont nouvelles.
  const plus = f + 'NQ,2026-10-06 09:00:00,2,80\n'
  assert.equal(separerNouveaux(parserFichierTrades(plus, undefined, col).trades, new Set(ids(r))).length, 1)
})

bloc('Quantower : reconnu et refuse, avec le nouveau message', () => {
  const r = parserFichierTrades(QUANTOWER)
  assert.equal(r.format, 'quantower-orders')
  assert.equal(r.trades.length, 0)
  assert.equal(r.erreurs[0], "Ce fichier est un historique d'ordres, pas de trades : exporte le rapport Performance de Tradovate, ou envoie-nous ton fichier au support pour qu'on l'ajoute.")
  assert.deepEqual(parserFichierTrades('  \n').erreurs, ['Fichier vide.'])
})

bloc('lireColonnes : seuls les champs connus, en chaines', () => {
  assert.equal(lireColonnes(null), undefined)
  assert.equal(lireColonnes(['symbole']), undefined)
  assert.deepEqual(lireColonnes({ symbole: ' Sym ', pnl: 3, inconnu: 'x', entreLe: '' }), { symbole: 'Sym' })
})

// ── Le regroupement en positions ────────────────────────────────────────────

const t = hm => new Date(`2026-10-05T${hm}:00.000Z`)
const ex = (id, entree, sortie, extra = {}) => ({
  id, compteId: 'c1', symbole: 'NQZ6', direction: 'long', devise: 'USD', entreLe: t(entree), sortiLe: sortie ? t(sortie) : null,
  quantite: 1, pnl: 10, frais: null, prixEntree: null, prixSortie: null, stopPrix: null,
  positionId: null, positionManuelle: false, segmentRef: null, fuseau: null, ...extra,
})
const groupes = execs => Object.fromEntries(regrouperEnPositions(execs))

bloc('partiel : meme entree, sorties echelonnees = une position', () => {
  assert.deepEqual(groupes([ex('a2', '10:00', '10:10'), ex('a1', '10:00', '10:05')]), { a1: 'a1', a2: 'a1' })
})

bloc('ajout : entre avant la sortie complete = meme position ; bornes comprises', () => {
  assert.deepEqual(groupes([ex('a', '10:00', '10:10'), ex('b', '10:05', '10:12'), ex('c', '10:12', '10:20')]), { a: 'a', b: 'a', c: 'a' })
})

bloc('deux positions separees dans le temps', () => {
  assert.deepEqual(groupes([ex('a', '10:00', '10:05'), ex('b', '10:06', '10:08')]), { a: 'a', b: 'b' })
})

bloc('direction opposee : jamais la meme position, et le long reprend apres', () => {
  const r = groupes([ex('a', '10:00', '10:30'), ex('b', '10:05', '10:07', { direction: 'short' }), ex('c', '10:10', '10:20')])
  assert.deepEqual(r, { a: 'a', b: 'b', c: 'a' })
})

bloc('choix manuel conserve : ni recalcule, ni rejoint', () => {
  const r = groupes([ex('a', '10:00', '10:10', { positionManuelle: true, positionId: 'a' }), ex('b', '10:05', '10:12')])
  assert.deepEqual(r, { b: 'b' })
})

bloc('par compte et par symbole : jamais melanges', () => {
  const r = Object.fromEntries(positionsRecalculees([
    ex('a', '10:00', '10:10'), ex('b', '10:05', '10:12', { compteId: 'c2' }), ex('c', '10:05', '10:12', { symbole: 'ESZ6' }), ex('d', '10:06', '10:08'),
  ]))
  assert.deepEqual(r, { a: 'a', b: 'b', c: 'c', d: 'a' })
})

bloc('vue agregee : sommes, moyennes ponderees, premier stop, bornes', () => {
  const [v] = vuePositions([
    ex('a', '10:00', '10:10', { positionId: 'a', quantite: 1, prixEntree: 100, prixSortie: 110, pnl: 0.1, frais: 1.2, fuseau: '+02:00' }),
    ex('b', '10:05', '10:20', { positionId: 'a', quantite: 3, prixEntree: 104, prixSortie: 112, pnl: 0.2, stopPrix: 95, segmentRef: 's1' }),
  ])
  assert.deepEqual(v, {
    positionId: 'a', compteId: 'c1', symbole: 'NQZ6', direction: 'long', devise: 'USD',
    entreLe: '2026-10-05T10:00:00.000Z', sortiLe: '2026-10-05T10:20:00.000Z',
    quantite: 4, pnl: 0.3, frais: 1.2, prixEntree: 103, prixSortie: 111.5, stopPrix: 95,
    executions: 2, segmentRef: 's1', fuseau: '+02:00', manuelle: false,
  })
  // Une execution d'avant le regroupement (positionId vide) est sa propre position.
  const vues = vuePositions([ex('x', '09:00', '09:05'), ex('y', '11:00', null)])
  assert.deepEqual(vues.map(p => [p.positionId, p.frais, p.prixEntree, p.sortiLe]), [['y', null, null, null], ['x', null, null, '2026-10-05T09:05:00.000Z']])
})

bloc('totaux par compte pour la fiche de compte : n, pnl, frais, bornes, une ligne par monnaie', () => {
  const vues = vuePositions([
    ex('a', '09:00', '09:10', { positionId: 'a', pnl: 100.1, frais: 1.5 }),
    ex('b', '10:00', '10:10', { positionId: 'b', pnl: -40.2 }),
    ex('c', '11:00', '11:10', { positionId: 'c', pnl: 5, frais: 0.5 }),
    ex('d', '12:00', '12:10', { positionId: 'd', compteId: 'c2', devise: 'EUR', pnl: 7 }),
    ex('e', '13:00', '13:10', { positionId: 'e', compteId: 'c2', devise: 'USD', pnl: 3 }),
  ])
  assert.deepEqual(totauxParCompte(vues), [
    { compteId: 'c1', n: 3, pnl: 64.9, frais: 2, devise: 'USD', premierLe: '2026-10-05T09:00:00.000Z', dernierLe: '2026-10-05T11:00:00.000Z' },
    { compteId: 'c2', n: 1, pnl: 7, frais: null, devise: 'EUR', premierLe: '2026-10-05T12:00:00.000Z', dernierLe: '2026-10-05T12:00:00.000Z' },
    { compteId: 'c2', n: 1, pnl: 3, frais: null, devise: 'USD', premierLe: '2026-10-05T13:00:00.000Z', dernierLe: '2026-10-05T13:00:00.000Z' },
  ])
  assert.deepEqual(totauxParCompte([]), [])
})

bloc('le lien au Carnet suit la position, un segment = une position ; la fusion verifie compte, symbole, sens', () => {
  const liens = Object.fromEntries(liensAHarmoniser([
    ex('a', '10:00', '10:10', { positionId: 'a', segmentRef: 's1' }), ex('b', '10:05', '10:12', { positionId: 'a' }), ex('c', '11:00', '11:10'),
  ]))
  assert.deepEqual(liens, { b: 's1' })
  // Une position liee coupee en deux (separation, execution retiree) : la plus ancienne garde le lien.
  const coupe = Object.fromEntries(liensAHarmoniser([
    ex('b', '10:05', '10:12', { positionId: 'b', segmentRef: 's1' }), ex('a', '10:00', '10:10', { positionId: 'a', segmentRef: 's1' }),
  ]))
  assert.deepEqual(coupe, { b: null })
  // Deux positions liees qui se rejoignent : le lien de la plus ancienne execution l'emporte.
  const jointes = Object.fromEntries(liensAHarmoniser([
    ex('a', '10:00', '10:10', { positionId: 'a', segmentRef: 's1' }), ex('b', '10:05', '10:12', { positionId: 'a', segmentRef: 's2' }),
  ]))
  assert.deepEqual(jointes, { b: 's1' })
  assert.deepEqual(planFusion([ex('b', '10:05', '10:12', { segmentRef: 's2' }), ex('a', '10:00', '10:10')]), { positionId: 'a', segmentRef: 's2' })
  assert.match(planFusion([ex('a', '10:00', '10:10'), ex('b', '11:00', '11:10', { direction: 'short' })]).erreur, /même sens/)
  assert.match(planFusion([ex('a', '10:00', '10:10'), ex('b', '11:00', '11:10', { symbole: 'ESZ6' })]).erreur, /même symbole/)
  assert.match(planFusion([ex('a', '10:00', '10:10'), ex('b', '11:00', '11:10', { compteId: 'c2' })]).erreur, /même compte/)
  assert.match(planFusion([ex('a', '10:00', '10:10', { positionId: 'a' }), ex('b', '10:05', '10:12', { positionId: 'a' })]).erreur, /au moins deux/)
})

// ── Les correspondances avec le Carnet ──────────────────────────────────────

const ms = hm => t(hm).getTime()
const notes = [
  { id: 'n1', title: 'Seance NY', trades: [
    { id: 's1', startedAt: ms('10:00'), closedAt: ms('10:20'), outcome: 'gain' },
    { id: 's2', startedAt: ms('13:00') }, // encore ouvert : quatre heures
    { startedAt: ms('09:00') }, // sans id : ignore
    null,
  ] },
  { id: 'n2', title: 'Autre', trades: { pas: 'un tableau' } },
  { id: 'n3', title: 'Londres', trades: [{ id: 's3', startedAt: ms('10:15'), closedAt: ms('10:40') }] },
]
const pos = (positionId, entree, sortie, segmentRef = null) => ({ positionId, entreLe: t(entree).toISOString(), sortiLe: sortie ? t(sortie).toISOString() : null, segmentRef })

bloc('segments du Carnet : forme verifiee, fenetre ouverte de quatre heures', () => {
  const segments = segmentsDesNotes(notes)
  assert.deepEqual(segments.map(s => s.segmentRef), ['s1', 's2', 's3'])
  // ordre = la place dans Note.trades a partir de 1 (« Trade 2 »), pour l'affichage seulement.
  assert.deepEqual(segments[1], { segmentRef: 's2', noteId: 'n1', noteTitle: 'Seance NY', ordre: 2, startedAt: ms('13:00'), closedAt: null })
  assert.equal(segments[2].ordre, 1)
  assert.equal(FENETRE_OUVERTE_MS, 4 * 3600 * 1000)
  assert.deepEqual(candidatsPourPosition(pos('p', '16:59', '17:30'), segments).map(s => s.segmentRef), ['s2'])
  assert.deepEqual(candidatsPourPosition(pos('p', '17:01', '17:30'), segments), [])
})

bloc('un candidat = lie ; deux = proposes ; aucun = rien ; deja pris = propose', () => {
  const segments = segmentsDesNotes(notes)
  const { liens, correspondances } = proposerLiens([
    pos('un', '10:02', '10:05'), // s1 seul
    pos('deux', '10:16', '10:18'), // s1 et s3
    pos('aucun', '08:00', '08:30'),
    pos('deja', '10:00', '10:05', 's9'), // deja liee : laissee telle quelle
    pos('pris', '13:30', '13:40'), // s2 seul, mais deja lie ailleurs
  ], segments, ['s2'])
  assert.deepEqual(liens, [{ positionId: 'un', segmentRef: 's1' }])
  assert.deepEqual(correspondances.map(c => [c.positionId, c.candidats.map(s => s.segmentRef)]), [['deux', ['s1', 's3']], ['pris', ['s2']]])
  assert.deepEqual(Object.keys(correspondances[0].candidats[0]).sort(), ['closedAt', 'noteId', 'noteTitle', 'ordre', 'segmentRef', 'startedAt'])
  // Deux positions qui n'ont que le meme segment : la premiere le prend, la seconde choisira.
  const r = proposerLiens([pos('b', '13:20', '13:25'), pos('a', '13:05', '13:10')], segments, [])
  assert.deepEqual(r.liens, [{ positionId: 'a', segmentRef: 's2' }])
  assert.deepEqual(r.correspondances.map(c => c.positionId), ['b'])
})

// ── Les routes : bornees au membre, CORS de Pilotage ────────────────────────

bloc('chaque acces a TradeImport est borne au userId ; CORS et jeton comme releve', () => {
  const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')
  const fichiers = [
    '../src/lib/trades-serveur.ts',
    '../src/app/api/pilotage/trades/import/route.ts',
    '../src/app/api/pilotage/trades/positions/route.ts',
    '../src/app/api/imports-trades/route.ts',
  ]
  for (const f of fichiers) {
    const source = lire(f)
    let i = source.indexOf('prisma.tradeImport.')
    while (i >= 0) {
      // L'appel entier, parentheses equilibrees.
      let j = source.indexOf('(', i), prof = 0
      for (let k = j; k < source.length; k++) {
        if (source[k] === '(') prof++
        if (source[k] === ')' && --prof === 0) { j = k; break }
      }
      const appel = source.slice(i, j + 1)
      // Ou le `where` partage de supprimerExecutions, construit avec userId en tete.
      const borne = appel.includes('userId') || (/[{,] where \}\)$/.test(appel) && /const where: Prisma\.TradeImportWhereInput = \{\s*userId,/.test(source))
      assert.ok(borne, `${f} : appel non borne au membre : ${appel.slice(0, 80)}`)
      i = source.indexOf('prisma.tradeImport.', j)
    }
  }
  for (const f of fichiers.slice(1, 3)) {
    const source = lire(f)
    assert.match(source, /export async function OPTIONS\(req: NextRequest\) \{\s*return corsPreflight\(req, METHODES\)/)
    assert.match(source, /const userId = await getUserId\(req\)\s*if \(!userId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401, headers: cors \}\)/)
  }
  assert.match(lire(fichiers[1]), /const METHODES = 'POST, DELETE, OPTIONS'/)
  assert.match(lire(fichiers[2]), /const METHODES = 'GET, PATCH, OPTIONS'/)
  // Un segment deja lie ailleurs : 409 avec la position qui le porte ; un corps illisible ne vide jamais tout.
  assert.match(lire(fichiers[2]), /where: \{ userId, segmentRef, id: \{ notIn: ids \} \}[\s\S]{0,300}positionId: positionDe\(ailleurs\) \},\s*\{ status: 409/)
  assert.match(lire(fichiers[1]), /if \(!body \|\| typeof body !== 'object' \|\| Array\.isArray\(body\)\) \{\s*return NextResponse\.json\(\{ error: "Requête illisible : rien n'a été retiré\." \}, \{ status: 400/)
  // L'insertion et la reecriture des positions partent dans une transaction.
  assert.match(lire(fichiers[0]), /prisma\.\$transaction\(\[\s*prisma\.tradeImport\.createMany\(\{[\s\S]*?skipDuplicates: true,\s*\}\),\s*\.\.\.ecrituresDesChangements/)
  // Les modules purs n'importent rien (ni @/, ni Next, ni Prisma) : ce script les charge tels quels.
  for (const pur of ['../src/lib/imports-trades.ts', '../src/lib/positions.ts', '../src/lib/correspondances-carnet.ts']) {
    assert.ok(!/^import /m.test(lire(pur)), `${pur} importe quelque chose`)
  }
  // Le filtre du membre passe APRES le filtre de l'appelant : il ne se contourne pas.
  assert.match(lire(fichiers[0]), /where: \{ \.\.\.filtre, userId \}/)
  // Le mentor lit les executions comme avant.
  assert.match(lire('../src/lib/mentorat-brief.ts'), /prisma\.tradeImport\.findMany\(\{\s*where: \{ userId, entreLe: \{ gte: sinceDate \} \},\s*select: \{ symbole: true, pnl: true, devise: true \},/)
})

bloc('schema et migration : les six colonnes, les trois index, la table reste fermee', () => {
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
  const modele = schema.slice(schema.indexOf('model TradeImport {'), schema.indexOf('}', schema.indexOf('model TradeImport {')))
  for (const ligne of [/positionId\s+String\?/, /positionManuelle\s+Boolean\s+@default\(false\)/, /compteId\s+String\?/, /segmentRef\s+String\?/, /stopPrix\s+Float\?/, /fuseau\s+String\?/,
    /@@index\(\[userId, positionId\]\)/, /@@index\(\[userId, compteId\]\)/, /@@index\(\[userId, segmentRef\]\)/]) {
    assert.match(modele, ligne)
  }
  const migration = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261030090000_trade_import_positions.sql', import.meta.url)
  if (existsSync(migration)) {
    const sql = readFileSync(migration, 'utf8')
    for (const col of ['positionId" TEXT', 'positionManuelle" BOOLEAN NOT NULL DEFAULT false', 'compteId" TEXT', 'segmentRef" TEXT', 'stopPrix" DOUBLE PRECISION', 'fuseau" TEXT']) {
      assert.ok(sql.includes(`ADD COLUMN IF NOT EXISTS "${col}`), col)
    }
    for (const idx of ['positionId', 'compteId', 'segmentRef']) assert.ok(sql.includes(`CREATE INDEX IF NOT EXISTS "TradeImport_userId_${idx}_idx"`), idx)
    assert.match(sql, /ENABLE ROW LEVEL SECURITY;\s*REVOKE ALL ON TABLE "TradeImport" FROM anon, authenticated;/)
  }
})

console.log(`\n${n} blocs verifies, tout est bon.`)
