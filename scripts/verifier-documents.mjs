// Les documents du trader deposes dans Pilotage (brief D1, 30/10/2026) : la
// nature d'un document et les refus, les lecteurs sans IA (Cash History de
// Tradovate, Trader Dashboard, CSV de trades, releve MetaTrader 4), le choix
// texte ou vision, la remise en forme de ce que rend l'IA, le rapprochement du
// compte de Pilotage, la limite de 5 lectures IA par jour, l'import par
// `trades` (dedoublonnage), le coffre, et le bornage des nouvelles routes au
// membre. Fonctions pures, aucune base, aucun reseau ; fixtures SYNTHETIQUES
// (memes en-tetes que les vrais exports, valeurs inventees).
// node scripts/verifier-documents.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const D = await import('../src/lib/documents-pilotage.ts')
const IA = await import('../src/lib/documents-pilotage-ia.ts')
const E = await import('../src/lib/trades-envoyes.ts')
const { separerNouveaux, empreinteTrade, parserFichierTrades } = await import('../src/lib/imports-trades.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')
const octets = s => new TextEncoder().encode(s)
const avecEntete = (entete, taille = 64) => { const o = new Uint8Array(taille); o.set(entete); return o }
// Le BOM d'Excel, ecrit en code (jamais en caractere invisible).
const BOM = String.fromCharCode(0xfeff)
const ftyp = marque => avecEntete([0, 0, 0, 0x18, ...octets('ftyp'), ...octets(marque)])
const preparer = (nom, type, o, textePdf) => D.preparerLecture({ nom, nature: D.natureDuDocument(nom, type, o), octets: o, textePdf })

// ── Fixtures (valeurs inventees) ─────────────────────────────────────────────

const CASH = [
  'Account,Transaction ID,Timestamp,Date,Delta,Amount,Cash Change Type,Currency,Contract',
  'APEX0000000001,100000000001,10/06/2026 09:31:02,2026-10-06,-1.50,"50,000.00", Commission,USD,MNQZ6',
  'APEX0000000001,100000000002,10/06/2026 09:40:10,2026-10-06,120.00,"50,118.50", Trade Paired,USD,MNQZ6',
  'APEX0000000001,100000000003,10/07/2026 10:00:00,2026-10-07,-0.75,"50,117.75", Exchange Fee,USD,MNQZ6',
  'APEX0000000001,100000000004,10/08/2026 15:00:00,2026-10-08,"-1,000.00","49,117.75", Payout,USD,',
  'APEX0000000001,100000000005,10/09/2026 15:00:00,,250.00,"49,367.75", Deposit,USD,',
  'APEX0000000001,100000000006,10/10/2026 15:00:00,2026-10-10,-50.00,"49,317.75", Withdrawal,USD,',
  'APEX0000000001,100000000007,10/11/2026 15:00:00,pas une date,abc,"49,317.75", Commission,USD,MNQZ6',
  'APEX0000000001,100000000008,10/12/2026 15:00:00,2026-10-12,0.00,"49,317.75", Commission,USD,MNQZ6',
].join('\r\n')

const DASHBOARD = [
  '"Account","Account Name","Alert State","Open Profit/Loss","Closed Profit/Loss","P&L","Account Balance","Cash On Hand","Account Currency","Auto Liquidate"',
  '"PA-APEX-00001-01","APEX-00001 (Membre Essai)","0","0.00","125.50","125.50","51125.50","51125.50","USD","Enabled"',
  '"APEX-00001-02","APEX-00001 (Membre Essai)","0","0.00","-40.00","-40.00","49960.00","49960.00","USD","Enabled"',
].join('\n')

const TRADOVATE = [
  'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration',
  'NQZ6,-2,0,0.25,900000000001,900000000002,1,20000.00,20010.00,$200.00,10/05/2026 15:30:00,10/05/2026 15:35:10,5min 10sec',
  'ESZ6,-2,0,0.25,900000000003,900000000004,2,6000.00,5995.50,"$(450.00)",10/06/2026 16:10:00,10/06/2026 16:02:30,7min 30sec',
].join('\r\n')

const GENERIQUE = [
  'Instrument;Open time;Close time;Side;Qty;Profit',
  'DAX;2026-10-06 09:15:00;2026-10-06 09:20:00;Buy;1;250,00',
  'DAX;2026-10-13 10:00:00;2026-10-13 10:30:00;Sell;2;-100,00',
].join('\n')

// Le meme rapport Performance que TRADOVATE, tel que le texte de son PDF sort d'unpdf (sans ids de fills, duree coupee).
const PERFORMANCE_PDF = [
  'ALL TRADES', 'Gross P/L $(250.00)', '# of Trades 2', '# of Contracts 3', 'Trade Fees & Comm. $(4.20)',
  'P&L HISTORY', 'TRADES', 'Symbol Qty Buy Price Buy Time Duration Sell Time Sell Price P&L',
  'NQZ6 1 20000.00 10/05/2026 15:30:00 5min 10sec 10/05/2026 15:35:10 20010.00 $200.00',
  'ESZ6 2 6000.00 10/06/2026 16:10:00 7min', '30sec', '10/06/2026 16:02:30 5995.50 $(450.00)',
].join('\n')

// Le meme Cash History que CASH (ses six lignes lisibles), tel que le texte de son PDF sort d'unpdf.
const CASH_PDF = [
  'Date: 2026-10-06 acc. #: APEX0000000001', 'Transaction ID Contract Timestamp Delta Amount Currency Cash Change Type',
  '100000000001 MNQZ6 10/06/2026 09:31:02 -1.50 50,000.00 USD Commission',
  '100000000002 MNQZ6 10/06/2026 09:40:10 120.00 50,118.50 USD Trade Paired',
  'Date: 2026-10-07 acc. #: APEX0000000001', 'Transaction ID Contract Timestamp Delta Amount Currency Cash Change Type',
  '100000000003 MNQZ6 10/07/2026 10:00:00 -0.75 50,117.75 USD Exchange Fee',
  'Date: 2026-10-08 acc. #: APEX0000000001', 'Transaction ID Contract Timestamp Delta Amount Currency Cash Change Type',
  '100000000004 10/08/2026 15:00:00 -1,000.00 49,117.75 USD Payout',
  'Date: 2026-10-09 acc. #: APEX0000000001', 'Transaction ID Contract Timestamp Delta Amount Currency Cash Change Type',
  '100000000005 10/09/2026 15:00:00 250.00 49,367.75 USD Deposit',
  'Date: 2026-10-10 acc. #: APEX0000000001', 'Transaction ID Contract Timestamp Delta Amount Currency Cash Change Type',
  '100000000006 10/10/2026 15:00:00 -50.00 49,317.75 USD Withdrawal',
  'TOTAL: transactions6',
].join('\n')

const BANQUE = ['Date;Libellé;Débit;Crédit', '06/10/2026;CARTE BOULANGERIE;4,20;', '07/10/2026;VIREMENT RECU;;100,00'].join('\n')

const td = (...c) => c.map(x => `<td>${x}</td>`).join('')
const MT4 = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">
<html><head><title>Statement: 7000001 - Membre Essai</title><meta name="generator" content="MetaQuotes Software Corp.">
<style>td { font: 8pt Tahoma; }</style></head>
<body><div align=center>
<div style="font: 20pt Times New Roman"><b>Courtier Essai Ltd.</b></div><br>
<table>
<tr align=left><td colspan=2><b>Account: 7000001</b></td><td colspan=5><b>Name: Membre Essai</b></td><td colspan=2><b>Currency: EUR</b></td><td colspan=2><b>Leverage: 1:100</b></td></tr>
<tr align=left><td colspan=13><b>Closed Transactions:</b></td></tr>
<tr>${td('Ticket', 'Open Time', 'Type', 'Size', 'Item', 'Price', 'S / L', 'T / P', 'Close Time', 'Price', 'Commission', 'Taxes', 'Swap', 'Profit')}</tr>
<tr><td title="Depot">1000001</td><td>2026.01.05 08:00:00</td><td>balance</td><td colspan=10>Depot carte</td><td>1&nbsp;000.00</td></tr>
<tr>${td('1000002', '2026.01.06 09:15:00', 'buy', '0.50', 'dax40', '19000.0', '18950.0', '0.0', '2026.01.06 09:45:30', '19020.0', '-2.00', '0.00', '-0.50', '10.00')}</tr>
<tr>${td('1000003', '2026.01.07 10:00:00', 'sell', '1.00', 'eurusd', '1.10000', '0.00000', '0.00000', '2026.01.07 11:00:00', '1.09900', '0.00', '0.00', '0.00', '-25.00')}</tr>
<tr><td title="cancelled">1000004</td><td>2026.01.08 10:00:00</td><td>buy limit</td><td>1.00</td><td>dax40</td><td>18000</td><td>0</td><td>0</td><td>2026.01.08 12:00:00</td><td>18000</td><td colspan=4>cancelled</td></tr>
<tr><td>1000005</td><td>2026.01.20 18:00:00</td><td>balance</td><td colspan=10>Retrait Neteller</td><td>-300.00</td></tr>
<tr align=right><td colspan=10>&nbsp;</td><td>-2.00</td><td>0.00</td><td>-0.50</td><td>-15.00</td></tr>
<tr align=left><td colspan=13><b>Open Trades:</b></td></tr>
<tr><td colspan=13 align=center>No transactions</td></tr>
<tr align=left><td colspan=13><b>Summary:</b></td></tr>
<tr><td colspan=3><b>Deposit/Withdrawal:</b></td><td colspan=2><b>700.00</b></td><td colspan=3><b>Credit Facility:</b></td><td><b>0.00</b></td></tr>
<tr><td colspan=3><b>Closed Trade P/L:</b></td><td colspan=2><b>-17.50</b></td><td colspan=3><b>Floating P/L:</b></td><td><b>0.00</b></td></tr>
<tr><td colspan=3><b>Balance:</b></td><td colspan=2><b>682.50</b></td><td colspan=3><b>Equity:</b></td><td><b>682.50</b></td></tr>
</table></div></body></html>`

const PAGE = `<html><head><title>Releve Courtier</title><script>var x = "ne doit pas sortir"</script><style>.a{}</style></head>
<body><!-- commentaire cache --><h1>Etat de compte</h1><table><tr><th>Date</th><th>Montant</th></tr><tr><td>2026-10-06</td><td>1&nbsp;000,00&euro;</td></tr></table><p>Fin &amp; total</p></body></html>`

// ── La nature et les refus ───────────────────────────────────────────────────

bloc('nature : refus des HEIC, RAR, ZIP, videos, classeurs, sans appel IA (methode nom, raison dite)', () => {
  const cas = [
    ['IMG_0001.HEIC', 'image/heic', ftyp('heic'), /HEIC/],
    ['photo.jpg', 'image/jpeg', ftyp('mif1'), /HEIC/], // une HEIC renommee : les octets l'emportent
    ['archives.rar', '', avecEntete([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]), /Archive/],
    ['factures.zip', 'application/zip', avecEntete([0x50, 0x4b, 0x03, 0x04]), /Archive/],
    ['classeur.xlsx', '', avecEntete([0x50, 0x4b, 0x03, 0x04]), /Classeur/],
    ['ancien.xls', '', avecEntete([0xd0, 0xcf, 0x11, 0xe0]), /Classeur/],
    ['IMG_1928.MOV', 'video/quicktime', ftyp('qt  '), /Vidéo/],
    ['clip.mp4', 'video/mp4', octets('pas une video lisible'), /Vidéo/],
    ['note.docx', '', avecEntete([0x50, 0x4b, 0x03, 0x04]), /Word/],
    ['binaire.bin', '', avecEntete([0x00, 0x01, 0x02, 0x03, 0x00]), /Format inconnu/],
  ]
  for (const [nom, type, o, raison] of cas) {
    const p = preparer(nom, type, o)
    assert.ok('lecture' in p, `${nom} : devrait etre lu sans IA`)
    assert.equal(p.lecture.type, 'illisible', nom)
    assert.equal(p.lecture.methode, 'nom', nom)
    assert.match(p.lecture.remarque, raison, nom)
  }
  // Ce qui se lit : aux octets d'abord.
  assert.equal(D.natureDuDocument('scan.png', 'image/png', avecEntete([0x25, 0x50, 0x44, 0x46])).famille, 'pdf')
  assert.equal(D.natureDuDocument('x', '', avecEntete([0x89, 0x50, 0x4e, 0x47])).media, 'image/png')
  assert.equal(D.natureDuDocument('x.gif', '', avecEntete([0x47, 0x49, 0x46, 0x38])).media, 'image/gif')
  assert.equal(D.natureDuDocument('x.jpg', '', avecEntete([0xff, 0xd8, 0xff, 0xe0])).media, 'image/jpeg')
  assert.equal(D.natureDuDocument('Cash History.csv', 'text/csv', octets(CASH)).famille, 'csv')
  assert.equal(D.natureDuDocument('statement.htm', '', octets(MT4)).famille, 'html')
  assert.equal(D.natureDuDocument('sans-extension', '', octets('<!DOCTYPE html><html></html>')).famille, 'html')
  assert.equal(D.natureDuDocument('releve.ofx', '', octets('OFXHEADER:100')).famille, 'texte')
  // Un PDF qui n'en est pas un : refuse, pas envoye a l'IA.
  assert.equal(D.natureDuDocument('abime.pdf', 'application/pdf', octets('rien du tout')).famille, 'refuse')
  // UTF-16 (relevés MetaTrader 5) et Windows-1252 se decodent.
  const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Été'].flatMap(c => [c.charCodeAt(0), 0])])
  assert.equal(D.decoderTexte(utf16), 'Été')
  assert.equal(D.decoderTexte(new Uint8Array([0x52, 0xe9, 0x73])), 'Rés')
  assert.equal(D.natureDuDocument('rapport.html', '', utf16).famille, 'html')
})

// ── Les lecteurs sans IA ────────────────────────────────────────────────────

bloc('Cash History de Tradovate : mouvements-compte sans IA, types d apres Cash Change Type, montants signes', () => {
  const p = preparer('Cash History.csv', 'text/csv', octets(CASH))
  assert.ok('lecture' in p)
  const l = p.lecture
  assert.equal(l.type, 'mouvements-compte')
  assert.equal(l.methode, 'csv')
  assert.equal(l.broker, 'Tradovate')
  assert.equal(l.firme, 'Apex')
  assert.equal(l.identifiant, 'APEX0000000001')
  assert.equal(l.devise, 'USD')
  assert.deepEqual(l.periode, { debut: '2026-10-06', fin: '2026-10-10' })
  assert.deepEqual(l.mouvements.map(m => [m.date, m.type, m.montant]), [
    ['2026-10-06', 'frais', -1.5],
    ['2026-10-06', 'autre', 120],
    ['2026-10-07', 'frais', -0.75],
    ['2026-10-08', 'payout', -1000],
    ['2026-10-09', 'depot', 250], // Date vide : celle du Timestamp
    ['2026-10-10', 'retrait', -50],
  ])
  assert.equal(l.mouvements[0].libelle, 'Commission MNQZ6')
  assert.equal(l.mouvements[3].libelle, 'Payout')
  assert.match(l.remarque, /1 ligne illisible/)
  assert.equal(l.confiance, 0.8)
  assert.equal(D.typeCashChange(' Trade Paired'), 'autre')
  assert.equal(D.typeCashChange('Clearing Fee'), 'frais')
  // Le Cash History envoye en .txt se reconnait aussi.
  assert.equal(preparer('export.txt', 'text/plain', octets(CASH)).lecture.type, 'mouvements-compte')
})

bloc('Trader Dashboard : capture-tableau sans IA, le solde de chaque compte, rapproche ligne par ligne', () => {
  const p = preparer('Trader Dashboard - Apex.csv', 'text/csv', octets(DASHBOARD))
  assert.ok('lecture' in p)
  const l = p.lecture
  assert.equal(l.type, 'capture-tableau')
  assert.equal(l.methode, 'csv')
  assert.equal(l.firme, 'Apex')
  assert.equal(l.identifiant, null) // deux comptes
  assert.equal(l.capture.date, null)
  assert.deepEqual(l.capture.comptes.map(c => [c.identifiant, c.solde, c.pnl, c.devise]), [
    ['PA-APEX-00001-01', 51125.5, 125.5, 'USD'],
    ['APEX-00001-02', 49960, -40, 'USD'],
  ])
  const comptes = [
    { id: 'c-perf', firmName: 'Apex', identifiants: ['PA-APEX-00001-01'] },
    { id: 'c-eval', firmName: 'Apex', identifiants: ['apex 00001 02'] },
  ]
  const r = D.avecCompte(l, comptes)
  assert.deepEqual(r.capture.comptes.map(c => c.compteId), ['c-perf', 'c-eval'])
  assert.equal(r.compteId, null) // deux comptes Apex, aucun identifiant unique : on ne devine pas
})

bloc('CSV : Tradovate Performance par parserFichierTrades (trades, csv) ; colonnes devinees ; releve bancaire vers l IA', () => {
  const t = preparer('Performance.csv', 'text/csv', octets(TRADOVATE)).lecture
  assert.equal(t.type, 'trades')
  assert.equal(t.methode, 'csv')
  assert.equal(t.broker, 'Tradovate')
  assert.equal(t.trades.length, 2)
  assert.equal(t.trades[0].source, 'tradovate-performance')
  assert.equal(t.trades[0].idExterne, '900000000001-900000000002')
  assert.deepEqual(t.periode, { debut: '2026-10-05', fin: '2026-10-06' })
  // « sep=, » d'Excel et BOM en tete : ignores.
  assert.equal(preparer('p.csv', 'text/csv', octets(BOM + '"sep=,"\r\n' + TRADOVATE)).lecture.trades.length, 2)

  const g = preparer('export.csv', 'text/csv', octets(GENERIQUE)).lecture
  assert.equal(g.type, 'trades')
  assert.equal(g.trades.length, 2)
  assert.equal(g.confiance, 0.6)
  assert.equal(g.proposition.symbole, 'Instrument')
  assert.equal(g.proposition.pnl, 'Profit')
  assert.ok(g.entetes.includes('Open time'))
  assert.match(g.remarque, /Colonnes devinées/)

  const b = preparer('releve-banque.csv', 'text/csv', octets(BANQUE))
  assert.equal(b.ia, 'texte')
  assert.equal(b.prefixe, 'csv')
  assert.match(b.texte, /CARTE BOULANGERIE/)
})

bloc('releve MetaTrader 4 en HTML : trades, depots, retraits et resume sans IA ; ordres annules ignores', () => {
  const p = preparer('Statement-Essai-7000001-2026.htm', 'text/html', octets(MT4))
  assert.ok('lecture' in p)
  const l = p.lecture
  assert.equal(l.type, 'releve-broker')
  assert.equal(l.methode, 'csv')
  assert.equal(l.broker, 'Courtier Essai Ltd.')
  assert.equal(l.identifiant, '7000001')
  assert.equal(l.devise, 'EUR')
  assert.deepEqual(l.periode, { debut: '2026-01-05', fin: '2026-01-20' })
  assert.equal(l.trades.length, 2)
  const [achat, vente] = l.trades
  assert.equal(achat.source, 'mt4:courtier')
  assert.equal(achat.idExterne, '7000001-1000002')
  assert.equal(achat.symbole, 'DAX40')
  assert.equal(achat.direction, 'long')
  assert.equal(achat.quantite, 0.5)
  assert.equal(achat.entreLe.toISOString(), '2026-01-06T09:15:00.000Z')
  assert.equal(achat.dureeSec, 1830)
  assert.equal(achat.pnl, 9.5) // profit + swap + taxes
  assert.equal(achat.frais, 2) // commission
  assert.equal(achat.stopPrix, 18950)
  assert.equal(achat.fuseau, null)
  assert.equal(vente.direction, 'short')
  assert.equal(vente.stopPrix, null) // S / L a 0 = pas de stop
  assert.deepEqual(l.mouvements.map(m => [m.date, m.type, m.montant, m.libelle]), [
    ['2026-01-05', 'depot', 1000, 'Depot carte'],
    ['2026-01-20', 'retrait', -300, 'Retrait Neteller'],
  ])
  assert.deepEqual(l.releveBroker, {
    broker: 'Courtier Essai Ltd.', identifiant: '7000001', periode: { debut: '2026-01-05', fin: '2026-01-20' },
    resultat: -17.5, depots: 1000, retraits: -300, soldeFin: 682.5, devise: 'EUR',
  })
  assert.match(l.remarque, /1 ordre en attente annulé ignoré/)
  // Net d'un trade = Closed P/L du releve.
  assert.equal(l.trades.reduce((s, t) => s + t.pnl - t.frais, 0), -17.5)
})

bloc('HTML ordinaire : texte des tables et du corps pour l IA, scripts, styles et commentaires retires', () => {
  const p = preparer('etat.html', 'text/html', octets(PAGE))
  assert.equal(p.ia, 'texte')
  assert.equal(p.prefixe, 'html')
  assert.ok(!p.texte.includes('ne doit pas sortir'))
  assert.ok(!p.texte.includes('commentaire cache'))
  assert.match(p.texte, /^Releve Courtier\n/)
  assert.match(p.texte, /Date \| Montant/)
  assert.match(p.texte, /2026-10-06 \| 1 000,00€/)
  assert.match(p.texte, /Fin & total/)
})

// ── Le meme rapport en CSV et en PDF : memes faits, memes cles ──────────────

bloc('Performance de Tradovate en PDF : lu sans IA, meme source que le CSV, cle = empreinteTrade ; CSV puis PDF (et l inverse) = 0 nouveau', () => {
  const pdf = avecEntete([0x25, 0x50, 0x44, 0x46])
  const p = preparer('Performance.20261006.180000.pdf', 'application/pdf', pdf, PERFORMANCE_PDF)
  assert.ok('lecture' in p, 'le PDF Performance se lit sans IA')
  const l = p.lecture
  assert.deepEqual([l.type, l.methode, l.broker, l.confiance], ['trades', 'csv', 'Tradovate', 1])
  const csv = parserFichierTrades(TRADOVATE).trades
  assert.equal(l.trades.length, 2)
  for (const [i, t] of l.trades.entries()) {
    const c = csv[i]
    assert.equal(t.source, 'tradovate-performance')
    assert.equal(t.idExterne, empreinteTrade(t))
    for (const champ of ['symbole', 'direction', 'quantite', 'prixEntree', 'prixSortie', 'pnl', 'devise', 'dureeSec']) assert.equal(t[champ], c[champ], champ)
    assert.equal(t.entreLe.getTime(), c.entreLe.getTime())
    assert.equal(t.sortiLe.getTime(), c.sortiLe.getTime())
    assert.equal(empreinteTrade(t), empreinteTrade(c))
  }
  // CSV deja en base (cles = ids de fills), puis le PDF : tout est reconnu a l'empreinte.
  const connusPdf = E.connusParEmpreinte(l.trades, new Set(), csv)
  assert.equal(separerNouveaux(l.trades, connusPdf).length, 0)
  // PDF deja en base, puis le CSV : pareil.
  const connusCsv = E.connusParEmpreinte(csv, new Set(), l.trades)
  assert.equal(separerNouveaux(csv, connusCsv).length, 0)
  // Un trade de plus dans le CSV reste nouveau ; une execution en base ne reconnait qu'un trade.
  const plus = [...csv, { ...csv[0], idExterne: '900000000009-900000000010' }]
  assert.equal(separerNouveaux(plus, E.connusParEmpreinte(plus, new Set(), l.trades)).length, 1)
  // Une execution deja reconnue par sa cle ne sert pas une seconde fois.
  assert.equal(separerNouveaux(csv, E.connusParEmpreinte(csv, new Set([csv[0].idExterne]), [csv[0]])).length, 1)
  // Le CSV sans ids de fills a deja la meme cle que le PDF.
  const sansIds = TRADOVATE.replace('900000000001,900000000002', ',')
  assert.equal(parserFichierTrades(sansIds).trades[0].idExterne, l.trades[0].idExterne)
  // Les empreintes rendues au front : les memes pour les deux documents.
  const viaCsv = D.finaliserLecture(preparer('Performance.csv', 'text/csv', octets(TRADOVATE)).lecture, []).empreintes
  assert.deepEqual(D.finaliserLecture(l, []).empreintes, viaCsv)
  assert.equal(viaCsv[0], `trade|tradovate-performance|${empreinteTrade(csv[0])}`)
  // Un rapport incomplet (une ligne illisible) le dit.
  const abime = PERFORMANCE_PDF.replace('$(450.00)', 'illisible')
  const r = preparer('Performance.pdf', 'application/pdf', pdf, abime).lecture
  assert.equal(r.trades.length, 1)
  assert.equal(r.confiance, 0.7)
  assert.match(r.remarque, /en annonce 2/)
})

bloc('Cash History en PDF : lu sans IA, memes mouvements et memes empreintes que le CSV ; rang pour deux mouvements identiques', () => {
  const pdf = avecEntete([0x25, 0x50, 0x44, 0x46])
  const p = preparer('Cash History.20261010.120000.pdf', 'application/pdf', pdf, CASH_PDF)
  assert.ok('lecture' in p, 'le PDF Cash History se lit sans IA')
  const viaPdf = D.finaliserLecture(p.lecture, [])
  const viaCsv = D.finaliserLecture(preparer('Cash History.csv', 'text/csv', octets(CASH)).lecture, [])
  assert.deepEqual([viaPdf.lecture.type, viaPdf.lecture.methode, viaPdf.lecture.identifiant, viaPdf.lecture.firme], ['mouvements-compte', 'csv', 'APEX0000000001', 'Apex'])
  const sans = ms => ms.map(({ date, type, montant, devise, libelle, empreinte }) => ({ date, type, montant, devise, libelle, empreinte }))
  assert.deepEqual(sans(viaPdf.lecture.mouvements), sans(viaCsv.lecture.mouvements))
  assert.deepEqual(viaPdf.empreintes, viaCsv.empreintes)
  assert.equal(viaCsv.lecture.mouvements[0].empreinte, 'mouvement|2026-10-06|frais|-1.50|USD|apex0000000001')
  assert.equal(viaPdf.lecture.confiance, 1)
  // Deux commissions identiques le meme jour : deux empreintes.
  const double = CASH.split('\r\n')
  double.splice(2, 0, double[1].replace('100000000001', '100000000011'))
  const m = D.finaliserLecture(preparer('c.csv', 'text/csv', octets(double.join('\r\n'))).lecture, []).lecture.mouvements
  assert.equal(m[0].empreinte, 'mouvement|2026-10-06|frais|-1.50|USD|apex0000000001')
  assert.equal(m[1].empreinte, 'mouvement|2026-10-06|frais|-1.50|USD|apex0000000001#2')
  // Une ligne en moins que le total annonce : le relevé le dit.
  const manque = D.lireCashHistoryPdf(CASH_PDF.replace('transactions6', 'transactions7'))
  assert.equal(manque.confiance, 0.7)
})

bloc('empreintes : releve de broker (broker, compte, periode), deux exports MetaTrader du meme compte, facture deposee deux fois', () => {
  const mt4 = D.finaliserLecture(preparer('Statement.htm', 'text/html', octets(MT4)).lecture, [])
  assert.equal(mt4.lecture.releveBroker.empreinte, 'releve|courtier|7000001|2026-01-05|2026-01-20')
  assert.ok(mt4.empreintes.includes('releve|courtier|7000001|2026-01-05|2026-01-20'))
  assert.ok(mt4.empreintes.includes('mouvement|2026-01-05|depot|1000.00|EUR|7000001'))
  assert.equal(mt4.empreintes.filter(e => e.startsWith('trade|mt4:courtier|')).length, 2)
  // Le « Detailed Statement » du meme compte : memes cles de trades (ticket), memes empreintes.
  const detaille = D.finaliserLecture(preparer('DetailedStatement.htm', 'text/html', octets(MT4.replace('<title>Statement:', '<title>Detailed Statement:'))).lecture, [])
  assert.deepEqual(detaille.lecture.trades.map(t => [t.source, t.idExterne]), mt4.lecture.trades.map(t => [t.source, t.idExterne]))
  assert.deepEqual(detaille.empreintes, mt4.empreintes)
  // Le nom court du broker : « Courtier Essai Ltd. » lu en HTML et « Courtier » lu par l'IA se valent.
  assert.equal(D.empreinteReleve({ broker: 'Courtier', identifiant: '7000001', periode: { debut: '2026-01-05', fin: '2026-01-20' } }), mt4.lecture.releveBroker.empreinte)
  // La meme facture « (1) » et « (2) » : meme empreinte, le nom du fichier n'y entre pas.
  const facture = { type: 'facture', confiance: 1, remarque: '', facture: { fournisseur: 'Apex Trader Funding Inc.', date: '2026-06-10', montant: -85, devise: 'USD', objet: 'propfirm', libelle: 'x' } }
  const f1 = D.finaliserLecture(IA.lectureDepuisIA(facture, { methode: 'texte' }), []).empreintes
  const f2 = D.finaliserLecture(IA.lectureDepuisIA({ ...facture, facture: { ...facture.facture, fournisseur: 'Apex' } }, { methode: 'vision' }), []).empreintes
  assert.deepEqual(f1, ['facture|apex|2026-06-10|-85.00|USD'])
  assert.deepEqual(f2, f1)
  // Rien a comparer : liste vide.
  assert.deepEqual(D.finaliserLecture(D.lectureVide('illisible', 'nom'), []).empreintes, [])
})

// ── Texte avant image ───────────────────────────────────────────────────────

bloc('texte ou vision : 200 caracteres utiles au moins pour lire le texte d un PDF, sinon le PDF en vision ; image en vision', () => {
  const texte = n => 'a'.repeat(n)
  assert.equal(D.methodePourPdf(texte(199)), 'vision')
  assert.equal(D.methodePourPdf(texte(200)), 'texte')
  assert.equal(D.methodePourPdf(' \n\t'.repeat(500) + '. , ; |'.repeat(100)), 'vision') // espaces et ponctuation ne comptent pas
  assert.equal(D.methodePourPdf(null), 'vision')
  assert.equal(D.caracteresUtiles('Délai 12 €'), 7)

  const pdf = avecEntete([0x25, 0x50, 0x44, 0x46, 0x2d])
  const lisible = preparer('Performance.20260215.pdf', 'application/pdf', pdf, 'Total P/L 123.45 '.repeat(20))
  assert.equal(lisible.ia, 'texte')
  assert.equal(lisible.prefixe, 'pdf')
  assert.match(lisible.indice, /performance Tradovate/)
  const scan = preparer('scan.pdf', 'application/pdf', pdf, '   ')
  assert.equal(scan.ia, 'vision')
  assert.equal(scan.bloc, 'pdf')
  assert.equal(scan.media, 'application/pdf')
  assert.equal(preparer('illisible.pdf', 'application/pdf', pdf, null).ia, 'vision') // extraction echouee
  const facture = preparer('amember-invoice-ABCDE.pdf', 'application/pdf', pdf, 'Invoice '.repeat(40))
  assert.equal(facture.ia, 'texte')
  assert.match(facture.indice, /facture de propfirm/)
  const capture = preparer('Screen Shot.png', 'image/png', avecEntete([0x89, 0x50, 0x4e, 0x47]))
  assert.deepEqual([capture.ia, capture.bloc, capture.media, capture.prefixe], ['vision', 'image', 'image/png', 'image'])
  const gif = preparer('DetailedStatement.gif', '', avecEntete([0x47, 0x49, 0x46, 0x38]))
  assert.equal(gif.media, 'image/gif')

  // Le contenu envoye : le texte (jamais le base64), ou le document, ou l'image.
  const c1 = IA.contenuPourIA(lisible, 'Performance.pdf', 'QkFTRTY0')
  assert.equal(c1.length, 2)
  assert.equal(c1[0].type, 'text')
  assert.match(c1[0].text, /^Texte extrait du PDF « Performance.pdf »/)
  assert.ok(!JSON.stringify(c1).includes('QkFTRTY0'))
  assert.deepEqual(IA.contenuPourIA(scan, 'scan.pdf', 'QkFTRTY0')[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QkFTRTY0' } })
  assert.deepEqual(IA.contenuPourIA(capture, 'c.png', 'QkFTRTY0')[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QkFTRTY0' } })
  assert.match(IA.contenuPourIA(facture, 'amember-invoice-ABCDE.pdf', '')[1].text, /aMember/)
  // Un texte trop long est coupe, et l'IA le sait.
  const long = preparer('long.txt', 'text/plain', octets('x'.repeat(D.TEXTE_MAX_IA + 10)))
  assert.equal(long.texte.length, D.TEXTE_MAX_IA)
  assert.equal(long.coupe, true)
  assert.match(IA.contenuPourIA(long, 'long.txt', '')[1].text, /coupé/)
})

// ── L'IA : un prompt, un outil pour tous les types, sa sortie verifiee ──────

bloc('l outil porte tous les types ; la sortie de l IA est verifiee, jamais devinee', () => {
  const schema = IA.OUTIL_DOCUMENT.input_schema
  assert.deepEqual(schema.properties.type.enum, ['trades', 'mouvements-compte', 'facture', 'releve-bancaire', 'releve-broker', 'capture-tableau', 'autre', 'illisible'])
  for (const champ of ['trades', 'mouvements', 'facture', 'operations', 'releveBroker', 'capture', 'firme', 'broker', 'identifiant', 'periode', 'devise', 'confiance', 'remarque']) {
    assert.ok(schema.properties[champ], champ)
  }
  assert.deepEqual(schema.properties.mouvements.items.properties.type.enum, ['achat', 'renouvellement', 'reset', 'activation', 'payout', 'depot', 'retrait', 'frais', 'autre'])
  assert.deepEqual(schema.properties.facture.properties.objet.enum, ['propfirm', 'formation', 'outil', 'autre'])
  for (const type of schema.properties.type.enum) assert.ok(IA.PROMPT_DOCUMENT.includes(`- ${type} :`), type)

  // Trades lus dans un PDF : source, empreinte, decalage, rejets.
  const l = IA.lectureDepuisIA({
    type: 'trades', confiance: 1.7, firme: 'Apex', broker: 'Tradovate', identifiant: 'APEX-00001-01', devise: 'usd', periode: null, remarque: '',
    trades: [
      { symbole: 'NQZ6', direction: 'long', quantite: 2, entreLe: '2026-10-06T15:30:00', sortiLe: '2026-10-06T15:35:00', pnl: 200, frais: -4.2, ticket: null },
      { symbole: 'NQZ6', direction: 'short', quantite: 1, entreLe: '2026-10-06T16:00:00+02:00', sortiLe: null, pnl: -50 },
      { symbole: 'NQZ6', direction: 'long', quantite: 2, entreLe: '2026-10-06T15:30:00', sortiLe: '2026-10-06T15:35:00', pnl: 200 },
      { symbole: 'ESZ6', entreLe: '2026-10-06', pnl: 10 }, // sans heure : ecarte
      { symbole: 'ESZ6', entreLe: '2026-10-06T10:00:00', sortiLe: '2026-10-06T09:00:00', pnl: 10 }, // sortie avant entree
      { symbole: '', entreLe: '2026-10-06T10:00:00', pnl: 10 },
    ],
  }, { methode: 'texte', prefixe: 'pdf' })
  assert.equal(l.type, 'trades')
  assert.equal(l.methode, 'texte')
  assert.equal(l.confiance, 1)
  assert.equal(l.devise, 'USD')
  assert.equal(l.trades.length, 3)
  assert.equal(l.trades[0].source, 'ia:tradovate')
  assert.equal(l.trades[0].compte, 'APEX-00001-01')
  assert.equal(l.trades[0].frais, 4.2)
  assert.equal(l.trades[0].dureeSec, 300)
  assert.equal(l.trades[0].fuseau, null)
  assert.equal(l.trades[1].entreLe.toISOString(), '2026-10-06T14:00:00.000Z')
  assert.equal(l.trades[1].fuseau, '+02:00')
  assert.equal(l.trades[2].idExterne, `${l.trades[0].idExterne}#2`) // deux lignes identiques : un rang
  assert.deepEqual(l.periode, { debut: '2026-10-06', fin: '2026-10-06' })
  assert.match(l.remarque, /3 trades sans date, heure ou résultat lisibles écartés/)
  // Le meme document relu donne les memes cles.
  const relu = IA.lectureDepuisIA({ type: 'trades', confiance: 1, broker: 'Tradovate', identifiant: 'APEX-00001-01', remarque: '', trades: [
    { symbole: 'NQZ6', direction: 'long', quantite: 2, entreLe: '2026-10-06T15:30:00', sortiLe: '2026-10-06T15:35:00', pnl: 200 },
  ] }, { methode: 'texte', prefixe: 'pdf' })
  assert.equal(relu.trades[0].idExterne, l.trades[0].idExterne)
  // Un export reconnu a son nom garde la meme source, que l'IA ait lu le broker ou non.
  const unTrade = { symbole: 'NQZ6', entreLe: '2026-10-06T15:30:00', pnl: 1 }
  const origine = D.preparerLecture({ nom: 'Performance.20260215.131220.pdf', nature: D.natureDuDocument('p.pdf', '', avecEntete([0x25, 0x50, 0x44, 0x46])), octets: avecEntete([0x25, 0x50, 0x44, 0x46]), textePdf: 'x'.repeat(300) }).origine
  assert.equal(origine, 'tradovate-performance')
  for (const broker of ['Tradovate', null]) {
    const lu = IA.lectureDepuisIA({ type: 'trades', confiance: 1, broker, remarque: '', trades: [unTrade] }, { methode: 'texte', prefixe: 'pdf', origine })
    assert.equal(lu.trades[0].source, 'tradovate-performance')
  }
  assert.equal(IA.lectureDepuisIA({ type: 'trades', confiance: 1, remarque: '', trades: [unTrade] }, { methode: 'vision', prefixe: 'image' }).trades[0].source, 'ia:inconnu')
  assert.equal(D.origineDuNom('amember-invoice-ABCDE.pdf'), null)
  assert.equal(D.origineDuNom('Statement-Courtier.htm'), null)
  // La cle : l'empreinte du lecteur Tradovate (ids de fills absents), jamais le nom du fichier.
  assert.equal(l.trades[0].idExterne, empreinteTrade(l.trades[0]))
  assert.equal(l.trades[0].idExterne, 'NQZ6-2026-10-06T15:30:00.000Z-2-200')
  assert.equal(IA.sourceIA('eToro (Europe) Ltd.'), 'ia:etoro')
  assert.ok(!('ticket' in IA.OUTIL_DOCUMENT.input_schema.properties.trades.items.properties))

  const f = IA.lectureDepuisIA({ type: 'facture', confiance: 0.9, firme: 'Apex Trader Funding', remarque: '', facture: { fournisseur: 'Apex Trader Funding Inc.', date: '2026-06-31', montant: '-$85.00', devise: 'USD', objet: 'abonnement', libelle: '50K Tradovate' } }, { methode: 'texte', prefixe: 'pdf' })
  assert.deepEqual(f.facture, { fournisseur: 'Apex Trader Funding Inc.', date: null, montant: -85, devise: 'USD', objet: 'autre', libelle: '50K Tradovate' })

  const b = IA.lectureDepuisIA({ type: 'releve-bancaire', confiance: 0.8, remarque: 'ok', operations: [
    { date: '2026-10-06', libelle: 'CARTE', montant: -4.2 }, { date: '06/10/2026', libelle: 'X', montant: 3 }, { date: '2026-10-07', libelle: 'ZERO', montant: 0 },
  ] }, { methode: 'vision', prefixe: 'pdf' })
  assert.deepEqual(b.operations, [{ date: '2026-10-06', libelle: 'CARTE', montant: -4.2 }])
  assert.equal(b.methode, 'vision')

  const r = IA.lectureDepuisIA({ type: 'releve-broker', confiance: 0.7, broker: 'Courtier', identifiant: '42', remarque: '', periode: { debut: '2021-12-31', fin: '2021-01-01' },
    releveBroker: { resultat: 120.5, depots: 1000, retraits: 300, soldeFin: 820.5, devise: 'EUR' },
    mouvements: [{ date: '2021-03-01', type: 'depot', montant: 1000, libelle: 'Depot' }, { date: '2021-04-01', type: 'cadeau', montant: -5, libelle: 'x' }] }, { methode: 'texte', prefixe: 'pdf' })
  assert.deepEqual(r.periode, { debut: '2021-01-01', fin: '2021-12-31' })
  assert.equal(r.releveBroker.retraits, -300)
  assert.equal(r.releveBroker.broker, 'Courtier')
  assert.equal(r.releveBroker.identifiant, '42')
  assert.deepEqual(r.mouvements.map(m => m.type), ['depot', 'autre'])

  const c = IA.lectureDepuisIA({ type: 'capture-tableau', confiance: 0.6, remarque: '', capture: { date: null, solde: 50250, pnl: '250.00', devise: null, texte: 'Solde et P&L du jour' } }, { methode: 'vision', prefixe: 'image' })
  assert.deepEqual(c.capture, { date: null, solde: 50250, pnl: 250, devise: null, texte: 'Solde et P&L du jour' })

  assert.equal(IA.lectureDepuisIA(undefined, { methode: 'vision', prefixe: 'image' }).type, 'illisible')
  assert.equal(IA.lectureDepuisIA({ type: 'inconnu', confiance: 'x', remarque: '' }, { methode: 'texte', prefixe: 'pdf' }).type, 'autre')
  assert.equal(IA.lectureDepuisIA({ type: 'autre', confiance: 'x', remarque: '' }, { methode: 'texte', prefixe: 'pdf' }).confiance, 0.5)
  assert.match(IA.lectureDepuisIA({ type: 'autre', confiance: 1, remarque: '' }, { methode: 'texte', prefixe: 'html', coupe: true }).remarque, /seul le début/)
})

// ── Le compte de Pilotage ───────────────────────────────────────────────────

bloc('rapprochement compteId : identifiant, puis firme, puis broker ; plusieurs candidats ou aucun = null', () => {
  const comptes = [
    { id: 'apex-1', firmName: 'Apex', brokerName: 'Tradovate', identifiants: ['APEX-00001-01'] },
    { id: 'apex-2', firmName: 'Apex', brokerName: 'Tradovate', identifiants: ['APEX-00001-02'] },
    { id: 'topstep', firmName: 'Topstep', brokerName: 'TopstepX', identifiants: [] },
    { id: 'vantage', firmName: null, brokerName: 'Vantage', identifiants: ['514000'] },
  ]
  // Identifiant (sans casse ni ponctuation), meme quand la firme designerait un autre compte.
  assert.equal(D.rapprocherCompte({ identifiant: 'apex 00001 02', firme: 'Topstep' }, comptes), 'apex-2')
  // Firme : un seul compte Topstep.
  assert.equal(D.rapprocherCompte({ identifiant: 'INCONNU', firme: 'TOPSTEP', broker: null }, comptes), 'topstep')
  // Firme ecrite en long : « Apex Trader Funding » prolonge « Apex », mais deux comptes Apex : on ne devine pas.
  assert.equal(D.rapprocherCompte({ firme: 'Apex Trader Funding' }, comptes), null)
  // Broker : un seul compte chez Vantage (nom lu « Vantage International Group Limited »).
  assert.equal(D.rapprocherCompte({ broker: 'Vantage International Group Limited' }, comptes), 'vantage')
  // Un identifiant lu qu'aucun compte ne porte : un compte qui a deja ses identifiants n'est pas pris par la firme.
  const unSeulApex = [comptes[0], comptes[2]]
  assert.equal(D.rapprocherCompte({ identifiant: 'APEX-00001-09', firme: 'Apex' }, unSeulApex), null)
  assert.equal(D.rapprocherCompte({ identifiant: null, firme: 'Apex' }, unSeulApex), 'apex-1')
  assert.equal(D.rapprocherCompte({ identifiant: 'S1-0001', firme: 'Topstep' }, unSeulApex), 'topstep') // Topstep n'a pas d'identifiant
  // Aucun.
  assert.equal(D.rapprocherCompte({ firme: 'FTMO', broker: 'MetaQuotes' }, comptes), null)
  assert.equal(D.rapprocherCompte({ identifiant: null, firme: null, broker: null }, comptes), null)
  assert.equal(D.rapprocherCompte({ firme: 'Apex' }, []), null)
  // Un nom trop court ne prolonge rien.
  assert.equal(D.rapprocherCompte({ firme: 'Top' }, comptes), null)
  // body.comptes est nettoye : id obligatoire, chaines bornees, identifiants en liste.
  assert.deepEqual(D.lireComptes([{ id: 'a', firmName: ' Apex ', identifiants: ['x', 3, ''] }, { nom: 'sans id' }, 'texte']), [
    { id: 'a', nom: null, firmName: 'Apex', brokerName: null, identifiants: ['x'] },
  ])
  assert.deepEqual(D.lireComptes('pas une liste'), [])
})

// ── La limite du jour ───────────────────────────────────────────────────────

bloc('limite : 4 lues puis la 5e passe, la 6e refuse ; sans plafond passe ; jour de Paris', () => {
  assert.equal(D.LIMITE_LECTURES_IA_JOUR, 5)
  assert.equal(D.etatQuota(0, false).autorise, true)
  assert.equal(D.etatQuota(4, false).autorise, true) // la 5e
  assert.equal(D.etatQuota(5, false).autorise, false) // la 6e
  assert.deepEqual(D.etatQuota(5, false).quota, { lusParIaAujourdhui: 5, limite: 5, sansPlafond: false })
  assert.equal(D.etatQuota(40, true).autorise, true)
  assert.equal(D.MESSAGE_LIMITE, 'Tu as lu tes 5 documents du jour, reviens demain.')
  // Minuit a Paris, heure d'ete et d'hiver, et juste apres minuit.
  assert.equal(D.debutJourParis(new Date('2026-07-15T10:00:00Z')).toISOString(), '2026-07-14T22:00:00.000Z')
  assert.equal(D.debutJourParis(new Date('2026-12-15T10:00:00Z')).toISOString(), '2026-12-14T23:00:00.000Z')
  assert.equal(D.debutJourParis(new Date('2026-10-29T23:30:00Z')).toISOString(), '2026-10-29T23:00:00.000Z') // 00:30 a Paris le 30
  assert.equal(D.debutJourParis(new Date('2026-10-29T22:30:00Z')).toISOString(), '2026-10-28T23:00:00.000Z') // 23:30 a Paris le 29
  assert.equal(D.debutJourParis(new Date('2026-10-25T12:00:00Z')).toISOString(), '2026-10-24T22:00:00.000Z') // jour du passage a l'heure d'hiver
})

// ── L'import par trades ─────────────────────────────────────────────────────

bloc('import par trades : verifies, source imposee, dedoublonnage (userId, source, idExterne) comme un CSV', () => {
  const lecture = preparer('Statement-Essai.htm', 'text/html', octets(MT4)).lecture
  // Les trades passent par JSON (dates en chaines), comme entre Pilotage et le journal.
  const envoyes = JSON.parse(JSON.stringify(lecture.trades))
  const r = E.lireTradesEnvoyes(envoyes, lecture.trades[0].source)
  assert.equal(r.format, 'mt4:courtier')
  assert.deepEqual(r.erreurs, [])
  assert.equal(r.trades.length, 2)
  assert.deepEqual(r.trades.map(t => t.idExterne), lecture.trades.map(t => t.idExterne))
  assert.equal(r.trades[0].entreLe.getTime(), lecture.trades[0].entreLe.getTime())
  assert.equal(r.trades[0].quantite, 0.5)
  // Renvoyer les memes trades : 0 nouveau.
  assert.equal(separerNouveaux(r.trades, new Set(r.trades.map(t => t.idExterne))).length, 0)
  // La source donnee l'emporte sur celle des lignes ; invalide = rien n'est lu.
  assert.ok(E.lireTradesEnvoyes(envoyes, 'pdf:autre').trades.every(t => t.source === 'pdf:autre'))
  assert.equal(E.lireTradesEnvoyes(envoyes, '').format, null)
  assert.equal(E.lireTradesEnvoyes(envoyes, 'avec espace').format, null)
  assert.equal(E.lireTradesEnvoyes('pas une liste', 'pdf:x').trades.length, 0)
  // Lignes douteuses ecartees avec leur raison ; doublon d'idExterne ecarte.
  const mauvais = E.lireTradesEnvoyes([
    { idExterne: 'a', symbole: 'NQ', entreLe: '2026-10-06T10:00:00.000Z', pnl: 10, quantite: 1, fuseau: 'Europe/Paris' },
    { idExterne: 'a', symbole: 'NQ', entreLe: '2026-10-06T11:00:00.000Z', pnl: 10 },
    { idExterne: 'b', symbole: 'NQ', entreLe: 'hier', pnl: 10 },
    { idExterne: 'c', symbole: 'NQ', entreLe: '2026-10-06T10:00:00.000Z', pnl: '10' },
    { idExterne: 'd', symbole: 'NQ', entreLe: '2026-10-06T10:00:00.000Z', pnl: 1, quantite: -2 },
    { idExterne: 'e', symbole: 'NQ', entreLe: '2026-10-06T10:00:00.000Z', sortiLe: '2026-10-06T09:00:00.000Z', pnl: 1 },
    { idExterne: 'f', symbole: 'NQ', entreLe: '2026-10-06T10:00:00.000Z', pnl: 1, fuseau: 'Mars/Olympus', devise: 'euro' },
    null,
  ], 'pdf:x')
  assert.deepEqual(mauvais.trades.map(t => t.idExterne), ['a', 'f'])
  assert.equal(mauvais.trades[0].fuseau, 'Europe/Paris')
  assert.equal(mauvais.trades[1].fuseau, null) // fuseau inconnu : heure telle qu'affichee
  assert.equal(mauvais.trades[1].devise, 'USD')
  assert.equal(mauvais.erreurs.length, 6)
  assert.match(mauvais.erreurs[0], /Trade 2 : même idExterne que le trade 1/)
  assert.equal(E.lireTradesEnvoyes(new Array(E.TRADES_ENVOYES_MAX + 1).fill({}), 'pdf:x').trades.length, 0)
})

// ── Le coffre ────────────────────────────────────────────────────────────────

bloc('coffre : chemin dans le dossier du membre, nom nettoye, 200 Mo par membre, types gardes', () => {
  const uid = '11111111-2222-3333-4444-555555555555'
  assert.equal(D.nettoyerNom('Relevé Mars 2025 (2).PDF'), 'Releve-Mars-2025-2.pdf')
  assert.equal(D.nettoyerNom('../../etc/passwd'), 'etc-passwd')
  assert.equal(D.nettoyerNom('***'), 'document')
  assert.equal(D.cheminDocument(uid, 'abc', 'Cash History.csv'), `${uid}/abc-Cash-History.csv`)
  assert.ok(!D.cheminDocument(uid, 'abc', '../x/../../y.pdf').includes('..'))
  assert.equal(D.coffreAccepte(D.COFFRE_MAX_OCTETS - 10, 10), true)
  assert.equal(D.coffreAccepte(D.COFFRE_MAX_OCTETS - 10, 11), false)
  assert.equal(D.COFFRE_MAX_OCTETS, 200 * 1024 * 1024)
  assert.equal(D.typeCoffre('application/pdf'), 'application/pdf')
  assert.equal(D.typeCoffre('application/x-msdownload'), 'application/octet-stream')
  assert.equal(D.BUCKET_DOCUMENTS, 'documents-pilotage')
})

// ── Les routes : bornees au membre, CORS de Pilotage ────────────────────────

bloc('controle statique : chaque acces a DocumentPilotage et au coffre est borne au userId ; CORS et jeton comme releve', () => {
  const serveur = lire('../src/lib/documents-serveur.ts')
  const appels = (source, prefixe) => {
    const trouves = []
    let i = source.indexOf(prefixe)
    while (i >= 0) {
      let j = source.indexOf('(', i), prof = 0
      for (let k = j; k < source.length; k++) {
        if (source[k] === '(') prof++
        if (source[k] === ')' && --prof === 0) { j = k; break }
      }
      trouves.push(source.slice(i, j + 1))
      i = source.indexOf(prefixe, j)
    }
    return trouves
  }
  const tables = appels(serveur, 'prisma.documentPilotage.')
  assert.ok(tables.length >= 7, `${tables.length} appels`)
  for (const appel of tables) {
    assert.ok(/where: \{ (id, )?userId \}/.test(appel) || /data: \{\s*id, userId,/.test(appel), `appel non borne au membre : ${appel.slice(0, 90)}`)
  }
  // Le stockage : un chemin construit avec le userId du jeton, ou lu sur une ligne trouvee avec { id, userId }.
  assert.match(serveur, /const chemin = cheminDocument\(userId, id, o\.nom\)/)
  for (const f of ['lienDocument', 'supprimerDocument']) {
    const debut = serveur.indexOf(`export async function ${f}`)
    const corps = serveur.slice(debut, serveur.indexOf('\n}\n', debut))
    assert.match(corps, /prisma\.documentPilotage\.findFirst\(\{ where: \{ id, userId \}, select: \{ chemin: true \} \}\)/, f)
    assert.ok(!/storage\.from\([^)]*\)\.(createSignedUrl|remove)\((?!\[?document\.chemin)/.test(corps), f)
  }
  assert.match(serveur, /createSignedUrl\(document\.chemin, 600\)/)
  // Le compte d'usage : poste 'document', meme cle et meme modele que releve.
  assert.match(serveur, /aiClient\('pilotage'\)/)
  assert.match(serveur, /const model = AI_MODEL\.pilotage/)
  assert.match(serveur, /logAiUsage\(userId, 'pilotage', model, reponse\.usage, null, \{ usage: 'document' \}\)/)
  assert.match(serveur, /appelsDuPosteDepuis\(userId, 'document', debutJourParis\(new Date\(\)\)\)/)
  assert.match(serveur, /return etatQuota\(lus, estSansPlafond\(email\)\)/)
  assert.match(lire('../src/lib/ia-budget.ts'), /prisma\.aiUsage\.count\(\{ where: \{ userId, usage, createdAt: \{ gte: depuis \} \} \}\)/)
  assert.match(lire('../src/lib/ai.ts'), /\| 'document'/)

  const routes = {
    '../src/app/api/pilotage/documents/lire/route.ts': 'POST, OPTIONS',
    '../src/app/api/pilotage/documents/route.ts': 'GET, OPTIONS',
    '../src/app/api/pilotage/documents/[id]/route.ts': 'DELETE, OPTIONS',
    '../src/app/api/pilotage/documents/[id]/lien/route.ts': 'GET, OPTIONS',
  }
  for (const [f, methodes] of Object.entries(routes)) {
    const source = lire(f)
    assert.ok(source.includes(`const METHODES = '${methodes}'`), f)
    assert.match(source, /export async function OPTIONS\(req: NextRequest\) \{\s*return corsPreflight\(req, METHODES\)/, f)
    assert.match(source, /const cors = corsHeaders\(req, METHODES\)\s*const userId = await getUserId\(req\)\s*if \(!userId\) return NextResponse\.json\(\{ error: 'Non connecté\.' \}, \{ status: 401, headers: cors \}\)/, f)
    assert.ok(!source.includes('prisma.'), `${f} : la base passe par documents-serveur.ts`)
    // Chaque reponse porte les en-tetes CORS.
    for (const reponse of source.match(/NextResponse\.json\([\s\S]*?\{ (status: \d+, )?headers: [^}]*\}/g) ?? []) assert.ok(/headers: (cors|\{ \.\.\.cors)/.test(reponse), reponse.slice(0, 80))
  }
  const route = lire('../src/app/api/pilotage/documents/lire/route.ts')
  assert.match(route, /export const maxDuration = 60/)
  assert.match(route, /if \(!etat\.autorise\) return NextResponse\.json\(\{ error: MESSAGE_LIMITE, quota \}, \{ status: 429, headers: cors \}\)/)
  // La limite ne s'applique qu'aux lectures par l'IA : le test vient apres la lecture sans IA.
  assert.ok(route.indexOf("if ('lecture' in prep)") < route.indexOf('if (!etat.autorise)'))
  for (const f of ['[id]/route.ts', '[id]/lien/route.ts']) {
    assert.match(lire(`../src/app/api/pilotage/documents/${f}`), /if \(!RE_ID\.test\(id\)\) return NextResponse\.json\(\{ error: 'Document introuvable\.' \}, \{ status: 404/)
  }

  // L'import par trades : meme dedoublonnage, meme regroupement que le csv.
  const imp = lire('../src/app/api/pilotage/trades/import/route.ts')
  assert.match(imp, /const envoyes = Array\.isArray\(body\.trades\) \? lireTradesEnvoyes\(body\.trades, body\.source\) : null/)
  assert.match(imp, /const lu = envoyes \?\? parserFichierTrades\(csv, fichier \?\? undefined, colonnes\)/)
  assert.match(imp, /where: \{ userId, source: trades\[0\]\.source, idExterne: \{ in: trades\.map\(t => t\.idExterne\) \} \}/)
  assert.match(imp, /const resultat = await confirmerImport\(userId, compteId, nouveaux, fichier\)/)
  // Puis l'empreinte, parmi les executions du membre de la meme source.
  assert.match(imp, /prisma\.tradeImport\.findMany\(\{\s*where: \{ userId, source: trades\[0\]\.source, entreLe: \{ in: /)
  assert.match(imp, /const connus = connusParEmpreinte\(trades, new Set\(existants\.map\(e => e\.idExterne\)\), memeEntree\)\s*const nouveaux = separerNouveaux\(trades, connus\)/)
  // La lecture rendue : compte rapproche et empreintes.
  assert.match(route, /const fin = finaliserLecture\(lecture, comptes\)/)
  assert.match(route, /lecture: fin\.lecture,\s*empreintes: fin\.empreintes,/)

  // Les modules purs n'importent que des modules purs (ni @/, ni Next, ni Prisma, ni Supabase).
  for (const pur of ['../src/lib/documents-pilotage.ts', '../src/lib/documents-pilotage-ia.ts', '../src/lib/trades-envoyes.ts']) {
    const source = lire(pur)
    const modules = [...source.matchAll(/^import\b[\s\S]*?from '([^']+)'/gm)].map(m => m[1])
    assert.ok(modules.length > 0, pur)
    for (const m of modules) assert.match(m, /^\.\/(imports-trades|fuseau|documents-pilotage)$/, `${pur} : ${m}`)
    assert.ok(!/\bimport\(/.test(source), `${pur} : import dynamique`)
  }
})

bloc('schema et migration : DocumentPilotage, bucket prive sans policy, table fermee', () => {
  const schema = lire('../prisma/schema.prisma')
  const debut = schema.indexOf('model DocumentPilotage {')
  assert.ok(debut >= 0)
  const modele = schema.slice(debut, schema.indexOf('}', debut))
  for (const ligne of [/id\s+String\s+@id @default\(uuid\(\)\)/, /userId\s+String\b/, /nom\s+String\b/, /type\s+String\b/, /taille\s+Int\b/, /chemin\s+String\s+@unique/,
    /lectureType\s+String\b/, /compteId\s+String\?/, /periodeDebut\s+DateTime\?\s+@db\.Date/, /periodeFin\s+DateTime\?\s+@db\.Date/, /createdAt\s+DateTime\s+@default\(now\(\)\)/, /@@index\(\[userId, createdAt\]\)/]) {
    assert.match(modele, ligne)
  }
  const migration = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261031090000_documents_pilotage.sql', import.meta.url)
  if (existsSync(migration)) {
    const sql = readFileSync(migration, 'utf8')
    assert.match(sql, /values \('documents-pilotage', 'documents-pilotage', false, 10485760,/)
    assert.match(sql, /set public = false, file_size_limit = 10485760/)
    assert.ok(!/create policy/i.test(sql), 'aucune policy sur le bucket')
    for (const col of ['"userId" TEXT NOT NULL', '"taille" INTEGER NOT NULL', '"chemin" TEXT NOT NULL', '"lectureType" TEXT NOT NULL', '"compteId" TEXT,', '"periodeDebut" DATE', '"periodeFin" DATE', '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP']) {
      assert.ok(sql.includes(col), col)
    }
    assert.ok(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "DocumentPilotage_chemin_key"'))
    assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS "DocumentPilotage_userId_createdAt_idx"'))
    assert.match(sql, /ALTER TABLE "DocumentPilotage" ENABLE ROW LEVEL SECURITY;\s*REVOKE ALL ON TABLE "DocumentPilotage" FROM anon, authenticated;/)
    // Les types du bucket sont ceux que le coffre garde.
    for (const t of D.TYPES_COFFRE) assert.ok(sql.includes(`'${t}'`), t)
  }
})

console.log(`\n${n} blocs verifies, tout est bon.`)
