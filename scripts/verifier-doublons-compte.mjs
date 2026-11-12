// Un doublon = le meme document sur le MEME compte (brief J1, 05/11/2026,
// copy trading) : les cles rangees sur le compte de Pilotage, la recherche
// bornee a ce compte, les lignes d'avant encore reconnues, Quantower inchange,
// l'ecran /imports du journal comme avant. Fonctions pures et une BASE
// SIMULEE en memoire (memes filtres que trades-serveur.ts, contrainte unique
// (userId, source, idExterne) comprise) : aucune base reelle, aucun reseau ;
// fixtures SYNTHETIQUES.
// node scripts/verifier-doublons-compte.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const D = await import('../src/lib/doublons-compte.ts')
const { parserFichierTrades, separerNouveaux } = await import('../src/lib/imports-trades.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

// ── Fixtures ────────────────────────────────────────────────────────────────

// Le rapport Performance de Tradovate en CSV (ids de fills), et le « meme » sans ids (comme son PDF) : meme source.
const ENTETE = 'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration'
const CSV = [
  ENTETE,
  'NQZ6,-2,0,0.25,900000000001,900000000002,1,20000.00,20010.00,$200.00,10/05/2026 15:30:00,10/05/2026 15:35:10,5min 10sec',
  'ESZ6,-2,0,0.25,900000000003,900000000004,2,6000.00,5995.50,"$(450.00)",10/06/2026 16:10:00,10/06/2026 16:02:30,7min 30sec',
].join('\r\n')
const SANS_IDS = CSV.replace(/900000000001,900000000002/, ',').replace(/900000000003,900000000004/, ',')
const tradovate = () => parserFichierTrades(CSV).trades
const tradovateSansIds = () => parserFichierTrades(SANS_IDS).trades

// Quantower : la cle dit deja le compte du broker (« XX-01|MNQZ6|entree|sortie|q|pnl »).
const quantower = compte => [{
  source: 'quantower-executions', idExterne: `${compte}|MNQZ6|2026-10-06T14:00:00.000Z|2026-10-06T14:05:00.000Z|1|20`, compte,
  symbole: 'MNQZ6', direction: 'long', quantite: 1, prixEntree: 20000, prixSortie: 20010,
  entreLe: new Date('2026-10-06T14:00:00.000Z'), sortiLe: new Date('2026-10-06T14:05:00.000Z'), pnl: 20, devise: 'USD', frais: 1, dureeSec: 300, fuseau: '-05:00', stopPrix: null,
}]

// ── La base simulee : les filtres de recherchesDoublons, lus comme Prisma ───

const egal = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b)
function correspond(ligne, where) {
  for (const [champ, cond] of Object.entries(where)) {
    if (champ === 'OR') {
      if (!cond.some(w => correspond(ligne, w))) return false
    } else if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && 'in' in cond) {
      if (!cond.in.some(v => egal(ligne[champ], v))) return false
    } else if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && 'startsWith' in cond) {
      if (typeof ligne[champ] !== 'string' || !ligne[champ].startsWith(cond.startsWith)) return false
    } else if (!egal(ligne[champ] ?? null, cond)) {
      return false
    }
  }
  return true
}
const trouver = (base, where) => base.filter(l => correspond(l, where))

/**
 * Un import tel que le font les routes : Pilotage (compteId, cles rangees, empreinte)
 * ou l'ecran /imports du journal (sans compte, cle seule). Memes etapes que
 * clesDejaConnues (trades-serveur.ts), puis l'insertion createMany + skipDuplicates.
 */
function importer(base, { userId = 'u1', compteId = null, ecran = false }, lus) {
  const trades = ecran ? lus : D.rangerSurCompte(lus, compteId)
  const { parCle, parEntree } = D.recherchesDoublons(compteId, trades)
  const cle = trouver(base, { ...parCle, userId })
  const entree = ecran ? [] : trouver(base, { ...parEntree, userId })
  const nouveaux = separerNouveaux(trades, D.clesConnues(trades, compteId, cle, entree))
  let importes = 0
  for (const t of nouveaux) {
    if (base.some(l => l.userId === userId && l.source === t.source && l.idExterne === t.idExterne)) continue // contrainte unique
    base.push({ ...t, userId, compteId })
    importes++
  }
  return { nouveaux: nouveaux.length, dejaConnus: trades.length - nouveaux.length, importes }
}

// ── Les cles ────────────────────────────────────────────────────────────────

bloc('cle rangee sur le compte : suffixe stable, idempotente, base retrouvee ; Quantower et sans compte inchanges', () => {
  assert.equal(D.MARQUE_COMPTE, '|compte:')
  assert.equal(D.cleSurCompte('900000000001-900000000002', 'tradovate-performance', 'cA'), '900000000001-900000000002|compte:cA')
  assert.equal(D.cleSurCompte('900000000001-900000000002|compte:cA', 'tradovate-performance', 'cA'), '900000000001-900000000002|compte:cA')
  assert.equal(D.cleSurCompte('k', 'csv-generique', null), 'k')
  for (const source of ['quantower-executions', 'quantower-orders']) assert.equal(D.cleSurCompte('XX-01|MNQZ6|t', source, 'cA'), 'XX-01|MNQZ6|t')
  assert.equal(D.cleDeBase('a-b|compte:cA'), 'a-b')
  assert.equal(D.cleDeBase('a-b'), 'a-b')
  const t = tradovate()
  assert.deepEqual(D.rangerSurCompte(t, 'cA').map(x => x.idExterne), ['900000000001-900000000002|compte:cA', '900000000003-900000000004|compte:cA'])
  assert.equal(D.rangerSurCompte(t, null), t)
  assert.equal(t[0].idExterne, '900000000001-900000000002', 'les trades lus ne sont pas modifies')
})

bloc('recherches : sur le compte (cle sous ses deux formes, empreinte) ; Quantower cle tous comptes ; sans compte tous comptes', () => {
  const t = D.rangerSurCompte(tradovate(), 'cA')
  const { parCle, parEntree } = D.recherchesDoublons('cA', t)
  assert.deepEqual(parCle, {
    source: 'tradovate-performance', compteId: 'cA',
    idExterne: { in: ['900000000001-900000000002|compte:cA', '900000000003-900000000004|compte:cA', '900000000001-900000000002', '900000000003-900000000004'] },
  })
  assert.equal(parEntree.compteId, 'cA')
  assert.deepEqual(parEntree.entreLe.in.map(d => d.toISOString()), ['2026-10-05T15:30:00.000Z', '2026-10-06T16:02:30.000Z'])
  const q = D.recherchesDoublons('cA', quantower('XX-01'))
  assert.deepEqual(q.parCle, { source: 'quantower-executions', idExterne: { in: [quantower('XX-01')[0].idExterne] } })
  assert.equal(q.parEntree.compteId, 'cA')
  const sans = D.recherchesDoublons(null, tradovate())
  assert.equal(sans.parCle.compteId, undefined)
  assert.equal(sans.parCle.OR.length, 2)
  assert.equal(sans.parEntree.compteId, undefined)
  // Aucun userId dans les filtres : l'appelant l'ajoute APRES (il ne se contourne pas).
  assert.ok(!JSON.stringify([parCle, parEntree, q, sans]).includes('userId'))
})

// ── Les quatre cas du brief ─────────────────────────────────────────────────

bloc('(a) meme trade sur deux comptes copies : deux lignes rangees, une par compte', () => {
  const base = []
  assert.deepEqual(importer(base, { compteId: 'cA' }, tradovate()), { nouveaux: 2, dejaConnus: 0, importes: 2 })
  assert.deepEqual(importer(base, { compteId: 'cB' }, tradovate()), { nouveaux: 2, dejaConnus: 0, importes: 2 })
  assert.equal(base.length, 4)
  assert.deepEqual(base.map(l => l.compteId), ['cA', 'cA', 'cB', 'cB'])
  // Le meme trade sans ids (l'equivalent de son PDF) sur un troisieme compte : range lui aussi.
  assert.deepEqual(importer(base, { compteId: 'cC' }, tradovateSansIds()), { nouveaux: 2, dejaConnus: 0, importes: 2 })
  // Un autre membre n'est jamais vu.
  assert.deepEqual(importer(base, { userId: 'u2', compteId: 'cA' }, tradovate()), { nouveaux: 2, dejaConnus: 0, importes: 2 })
})

bloc('(b) meme fichier, meme compte, deux fois : 0 nouveau ; son PDF (autre cle, meme empreinte) aussi', () => {
  const base = []
  importer(base, { compteId: 'cA' }, tradovate())
  assert.deepEqual(importer(base, { compteId: 'cA' }, tradovate()), { nouveaux: 0, dejaConnus: 2, importes: 0 })
  assert.deepEqual(importer(base, { compteId: 'cA' }, tradovateSansIds()), { nouveaux: 0, dejaConnus: 2, importes: 0 })
  // Dans l'autre sens : le PDF d'abord, puis le CSV.
  const base2 = []
  importer(base2, { compteId: 'cA' }, tradovateSansIds())
  assert.deepEqual(importer(base2, { compteId: 'cA' }, tradovate()), { nouveaux: 0, dejaConnus: 2, importes: 0 })
  assert.equal(base.length + base2.length, 4)
})

bloc('(c) ancienne ligne (cle sans compte, compteId rempli) : reconnue sur son compte, rangee a cote sur un autre', () => {
  // Les lignes d'avant J1 : cle telle que lue, compteId rempli par l'import de Pilotage.
  const base = tradovate().map(t => ({ ...t, userId: 'u1', compteId: 'cA' }))
  assert.deepEqual(importer(base, { compteId: 'cA' }, tradovate()), { nouveaux: 0, dejaConnus: 2, importes: 0 })
  assert.deepEqual(importer(base, { compteId: 'cA' }, tradovateSansIds()), { nouveaux: 0, dejaConnus: 2, importes: 0 })
  // Sur un autre compte : rangee, sans heurter la contrainte unique (cle differente).
  assert.deepEqual(importer(base, { compteId: 'cB' }, tradovate()), { nouveaux: 2, dejaConnus: 0, importes: 2 })
  assert.deepEqual(base.filter(l => l.compteId === 'cB').map(l => l.idExterne), ['900000000001-900000000002|compte:cB', '900000000003-900000000004|compte:cB'])
  // Une ligne d'avant importee SANS compte (ecran /imports) n'est pas du compte cA : rangee sur cA.
  const ecran = tradovate().map(t => ({ ...t, userId: 'u1', compteId: null }))
  assert.deepEqual(importer(ecran, { compteId: 'cA' }, tradovate()), { nouveaux: 2, dejaConnus: 0, importes: 2 })
})

bloc('(d) Quantower inchange : cle du broker, reimport 0 ; deux comptes du broker sur deux comptes Pilotage : ranges', () => {
  const base = []
  assert.deepEqual(importer(base, { compteId: 'cA' }, quantower('XX-01')), { nouveaux: 1, dejaConnus: 0, importes: 1 })
  assert.equal(base[0].idExterne, quantower('XX-01')[0].idExterne)
  assert.deepEqual(importer(base, { compteId: 'cA' }, quantower('XX-01')), { nouveaux: 0, dejaConnus: 1, importes: 0 })
  // Le meme fichier sur un autre compte Pilotage : sa cle (unique tous comptes) le dit deja connu, comme avant.
  assert.deepEqual(importer(base, { compteId: 'cB' }, quantower('XX-01')), { nouveaux: 0, dejaConnus: 1, importes: 0 })
  // La copie sur un autre compte du broker, dans son propre fichier : avant J1, l'empreinte (tous comptes)
  // la disait connue ; maintenant elle est rangee.
  assert.deepEqual(importer(base, { compteId: 'cB' }, quantower('XX-02')), { nouveaux: 1, dejaConnus: 0, importes: 1 })
  assert.equal(base.length, 2)
})

bloc('apercu sans compte et ecran /imports : tous comptes confondus, une cle rangee reconnue par sa base', () => {
  const base = []
  importer(base, { compteId: 'cA' }, tradovate())
  // L'ecran /imports (cle seule, comme avant) : le document deja range sur cA n'ajoute rien.
  assert.deepEqual(importer(base, { ecran: true }, tradovate()), { nouveaux: 0, dejaConnus: 2, importes: 0 })
  // L'apercu de Pilotage sans compteId : tous comptes, cle et empreinte.
  assert.deepEqual(importer(base, {}, tradovateSansIds()), { nouveaux: 0, dejaConnus: 2, importes: 0 })
  // Les lignes d'avant (cle de base) restent reconnues par l'ecran.
  const avant = tradovate().map(t => ({ ...t, userId: 'u1', compteId: null }))
  assert.deepEqual(importer(avant, { ecran: true }, tradovate()), { nouveaux: 0, dejaConnus: 2, importes: 0 })
  // Un fichier nouveau sur l'ecran : importe sans compte, cle de base.
  const neuf = []
  assert.deepEqual(importer(neuf, { ecran: true }, tradovate()), { nouveaux: 2, dejaConnus: 0, importes: 2 })
  assert.deepEqual(neuf.map(l => [l.idExterne, l.compteId]), [['900000000001-900000000002', null], ['900000000003-900000000004', null]])
})

bloc('deux trades identiques (deux partiels au meme prix) : une ligne d avant ne reconnait qu un trade', () => {
  const partiel = { source: 'csv-generique', compte: null, symbole: 'DAX', direction: 'long', quantite: 1, prixEntree: 19000, prixSortie: 19010, entreLe: new Date('2026-10-06T09:15:00.000Z'), sortiLe: new Date('2026-10-06T09:20:00.000Z'), pnl: 10, devise: 'EUR', frais: null, dureeSec: 300, fuseau: null, stopPrix: null }
  const deux = [{ ...partiel, idExterne: 'DAX|2026-10-06T09:15:00.000Z|1|10' }, { ...partiel, idExterne: 'DAX|2026-10-06T09:15:00.000Z|1|10#2' }]
  // Avant J1, un seul des deux etait en base sur cA : le second est nouveau, pas reconnu a l'empreinte.
  const base = [{ ...deux[0], userId: 'u1', compteId: 'cA' }]
  assert.deepEqual(importer(base, { compteId: 'cA' }, deux), { nouveaux: 1, dejaConnus: 1, importes: 1 })
  assert.deepEqual(importer(base, { compteId: 'cA' }, deux), { nouveaux: 0, dejaConnus: 2, importes: 0 })
})

// ── Carnet 1.10.0 (12/11/2026) : les trades lus par l'IA (capture d'une page, image, document) ──

// Le meme trade lu trois fois : sur une capture du Carnet, sur une image deposee
// (source « ia:<identifiant lu> », ou « ia:inconnu » quand rien n'est lu), et
// dans l'export CSV de la plateforme (source du lecteur, ids de fills).
const lu = (source, idExterne, champs = {}) => ({
  source, idExterne, compte: null, symbole: 'MNQZ6', direction: 'long', quantite: 2, prixEntree: 21450.25, prixSortie: 21462.5,
  entreLe: new Date('2026-11-12T08:31:12.000Z'), sortiLe: new Date('2026-11-12T08:44:50.000Z'), pnl: 49, devise: 'USD', frais: 1.48, dureeSec: 818, fuseau: 'Europe/Paris', stopPrix: null,
  ...champs,
})
const EMPREINTE = 'MNQZ6-2026-11-12T08:31:12.000Z-2-49'
const capture = () => [lu('capture:topstepx', EMPREINTE)]
const imageLue = identifiant => [lu(`ia:${identifiant}`, EMPREINTE)]
const exportCsv = () => [lu('topstepx-trades', 'fill-7001')]

bloc('recherches : une source lue par l IA cherche son empreinte dans toutes les sources du compte, un export aussi dans celles lues par l IA', () => {
  assert.ok(D.sourceLueParIA('capture:topstepx') && D.sourceLueParIA('ia:inconnu') && D.sourceLueParIA('ia:pp000123'))
  assert.ok(!D.sourceLueParIA('tradovate-performance') && !D.sourceLueParIA('quantower-executions') && !D.sourceLueParIA('iax'))
  const c = D.recherchesDoublons('cA', D.rangerSurCompte(capture(), 'cA'))
  assert.equal(c.parCle.source, 'capture:topstepx')
  assert.deepEqual(Object.keys(c.parEntree).sort(), ['compteId', 'entreLe'])
  const e = D.recherchesDoublons('cA', D.rangerSurCompte(exportCsv(), 'cA'))
  assert.equal(e.parEntree.source, undefined)
  assert.deepEqual(e.parEntree.OR, [{ source: 'topstepx-trades' }, { source: { startsWith: 'ia:' } }, { source: { startsWith: 'capture:' } }])
  // Sans compte (apercu sans compte, ecran /imports) : rien ne change, meme source.
  assert.equal(D.recherchesDoublons(null, capture()).parEntree.source, 'capture:topstepx')
})

bloc('(e) une capture puis l export du meme trade, sur le meme compte : 0 nouveau, dans les deux sens', () => {
  const base = []
  assert.deepEqual(importer(base, { compteId: 'cA' }, capture()), { nouveaux: 1, dejaConnus: 0, importes: 1 })
  assert.deepEqual(importer(base, { compteId: 'cA' }, exportCsv()), { nouveaux: 0, dejaConnus: 1, importes: 0 })
  const base2 = []
  importer(base2, { compteId: 'cA' }, exportCsv())
  assert.deepEqual(importer(base2, { compteId: 'cA' }, capture()), { nouveaux: 0, dejaConnus: 1, importes: 0 })
  assert.equal(base.length + base2.length, 2)
})

bloc('(f) le meme trade lu sous deux sources de l IA (compte lu une fois, pas l autre ; image puis capture) : 0 nouveau', () => {
  const base = []
  importer(base, { compteId: 'cA' }, imageLue('pp000123'))
  assert.deepEqual(importer(base, { compteId: 'cA' }, imageLue('inconnu')), { nouveaux: 0, dejaConnus: 1, importes: 0 })
  assert.deepEqual(importer(base, { compteId: 'cA' }, capture()), { nouveaux: 0, dejaConnus: 1, importes: 0 })
  // La meme capture deux fois : reconnue par sa cle, comme avant.
  const base2 = []
  importer(base2, { compteId: 'cA' }, capture())
  assert.deepEqual(importer(base2, { compteId: 'cA' }, capture()), { nouveaux: 0, dejaConnus: 1, importes: 0 })
})

bloc('(g) copy trading inchange : la capture du meme trade sur un autre compte est rangee ; deux exports entre eux, meme source seulement', () => {
  const base = []
  importer(base, { compteId: 'cA' }, exportCsv())
  assert.deepEqual(importer(base, { compteId: 'cB' }, capture()), { nouveaux: 1, dejaConnus: 0, importes: 1 })
  // Deux exports de plateformes differentes au meme instant : rien de change (meme source seulement).
  assert.deepEqual(importer(base, { compteId: 'cA' }, [lu('tradovate-performance', 'f-1')]), { nouveaux: 1, dejaConnus: 0, importes: 1 })
  // Une ligne d'une autre source ne reconnait qu'un trade, et jamais par sa cle.
  const deux = [lu('capture:topstepx', EMPREINTE), lu('capture:topstepx', `${EMPREINTE}#2`)]
  const base2 = []
  importer(base2, { compteId: 'cA' }, exportCsv())
  assert.deepEqual(importer(base2, { compteId: 'cA' }, deux), { nouveaux: 1, dejaConnus: 1, importes: 1 })
  // Une ligne d'une autre source a la MEME cle que l'import : elle compte a l'empreinte, sans passer pour la cle.
  const base3 = [{ ...lu('ia:inconnu', `${EMPREINTE}|compte:cA`), userId: 'u1', compteId: 'cA' }]
  assert.deepEqual(importer(base3, { compteId: 'cA' }, capture()), { nouveaux: 0, dejaConnus: 1, importes: 0 })
  assert.ok(!D.clesConnues(D.rangerSurCompte(capture(), 'cA'), 'cA', [], []).size)
})

// ── Le code des routes : les memes etapes que la base simulee ───────────────

bloc('routes : Pilotage range puis cherche sur son compte, l ecran /imports tous comptes sans empreinte, userId en dernier', () => {
  const pilotage = lire('../src/app/api/pilotage/trades/import/route.ts')
  assert.match(pilotage, /const trades = rangerSurCompte\(fuseau\.fuseau \? appliquerFuseau\(lu\.trades, fuseau\.fuseau\) : lu\.trades, compteId\)/)
  assert.match(pilotage, /const connus = await clesDejaConnues\(userId, compteId, trades\)\s*const nouveaux = separerNouveaux\(trades, connus\)/)
  assert.ok(!pilotage.includes('prisma.tradeImport.'), 'la route de Pilotage ne lit plus la table elle-meme')
  const ecran = lire('../src/app/api/imports-trades/route.ts')
  assert.match(ecran, /const connus = await clesDejaConnues\(userId, null, trades, \{ empreinte: false \}\)/)
  assert.ok(!ecran.includes('rangerSurCompte'), "l'ecran /imports ne range rien sur un compte")
  const serveur = lire('../src/lib/trades-serveur.ts')
  const debut = serveur.indexOf('export async function clesDejaConnues')
  const fonction = serveur.slice(debut, serveur.indexOf('\n}\n', debut))
  assert.match(fonction, /const \{ parCle, parEntree \} = recherchesDoublons\(compteId, trades\)/)
  assert.match(fonction, /where: \{ \.\.\.parCle, userId \}/)
  assert.match(fonction, /where: \{ \.\.\.parEntree, userId \}, select: \{ idExterne: true, source: true,/)
  assert.match(fonction, /return clesConnues\(trades, compteId, cle, entree\)/)
  // Le module pur n'importe que des modules purs, et aucune migration : la contrainte unique ne change pas.
  const pur = lire('../src/lib/doublons-compte.ts')
  assert.deepEqual([...pur.matchAll(/^import\b[\s\S]*?from '([^']+)'/gm)].map(m => m[1]), ['./trades-envoyes'])
  assert.match(lire('../prisma/schema.prisma'), /@@unique\(\[userId, source, idExterne\]\)/)
})

console.log(`\n${n} blocs verifies, tout est bon.`)
