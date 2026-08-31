/**
 * Lot 0 du 0.2 — classer la taxonomie. `Tag.category` est vide sur les 129
 * étiquettes des 6 membres qui taguent ; sans classement, l'écran « étudier un
 * concept » liste pêle-mêle de vrais concepts ICT, des instruments, des
 * plateformes, des jours de la semaine et du bruit de test.
 *
 * ⚠️ PAR DÉFAUT CE SCRIPT N'ÉCRIT RIEN. Il montre ce qu'il ferait.
 *   Blanc :   node scripts/classer-etiquettes-0.2.mjs
 *   Écriture : node scripts/classer-etiquettes-0.2.mjs --appliquer
 *
 * Trois partis pris, à connaître avant de relancer :
 *
 * 1. LE CLASSEMENT SE FAIT PAR NOM, pas par (nom, membre). Deux membres qui
 *    écrivent « macro breaker » parlent de la même chose : la catégorie est un
 *    vocabulaire partagé, même si la taxonomie reste privée à chacun.
 *
 * 2. ON NE FUSIONNE RIEN. Les 10 « doublons » repérés par
 *    `lister-etiquettes.mjs` appartiennent presque tous à des membres
 *    DIFFÉRENTS (`Tag` est unique par (name, userId)) : les fusionner
 *    détruirait la taxonomie de quelqu'un. Un seul vrai doublon existe,
 *    `tp`/`TP` chez brice.d — laissé à son arbitrage, pas traité ici.
 *
 * 3. CE QUI N'EST PAS CLASSABLE VA DANS `a-trier`, et pas ailleurs. Une
 *    quinzaine d'étiquettes sont des abréviations indécidables de l'extérieur
 *    (`ker`, `qlys`, `blc`, `bb`, `hrlr`, `std`, `shadow`) ou des raccourcis
 *    personnels (`race`, `ferrari`, `the futur`). Les deviner remplirait de
 *    bruit le champ censé en retirer.
 *
 * Les catégories ne sont PAS un enum en base : `Tag.category` est un `String?`.
 * D'autres émergeront avec les élèves (Brice, 31/08) — les ajouter ne demande
 * ni migration ni redéploiement du modèle, seulement une ligne ici.
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const appliquer = process.argv.includes('--appliquer')

/** nom normalisé (minuscules, rogné) → catégorie */
const CLASSEMENT = {
  // ── concept : ce qu'on étudie. Structure de marché, modèle, setup. ─────────
  'macro breaker': 'concept', 'ffvg m1': 'concept', 'ffvg m1 monday': 'concept',
  'ffvg m15 asian': 'concept', 'ffvg m15 ldn': 'concept', 'first fvg london': 'concept',
  'macro ifvg': 'concept', 'amd': 'concept', 'nro': 'concept', 'ote': 'concept',
  'reversal': 'concept', 'breaker block': 'concept', 'propulsion block': 'concept',
  'volume inbalance': 'concept', 'modele 2022': 'concept', 'modèle 2022': 'concept',
  'mss': 'concept', 'ms': 'concept', 'middle accu': 'concept', 'quadrants': 'concept',
  'consolidation sur side of liquidity': 'concept', '50% drt': 'concept', '50:10': 'concept',
  'range': 'concept', 'fibo': 'concept', 'fibonacci': 'concept', 'htf': 'concept',
  'contre tendance': 'concept', 'bullish': 'concept', 'short': 'concept', 'no setup': 'concept',

  // ── moment : quand. Macros, pré-market, unités de temps, jours. ────────────
  'macro': 'moment', 'macro 10h20': 'moment', 'macro 10h20 10h40': 'moment',
  'macro 9h20 9h40': 'moment', 'macro 9h50': 'moment', 'macro 9h50 10h10': 'moment',
  'macro 10h50 11h10': 'moment', 'macro 11h20 11h40': 'moment', 'pré market 7h 9h': 'moment',
  '1m': 'moment', '15m': 'moment', '1h': 'moment', '4h': 'moment', 'd': 'moment',
  'daily': 'moment', 'w': 'moment', 'lundi': 'moment', 'mardi': 'moment',
  'vendredi': 'moment', 'days of week': 'moment', 'rth': 'moment',

  // ── instrument : sur quoi. ────────────────────────────────────────────────
  'nq': 'instrument', 'nq1!': 'instrument', 'mnq': 'instrument', 'mnq1!': 'instrument',
  'mes1!': 'instrument', 'es': 'instrument', 'xauusd': 'instrument', 'spcx': 'instrument',

  // ── evenement : les rendez-vous macro-économiques. ────────────────────────
  'nfp': 'evenement', 'ppi': 'evenement', 'veille cpi': 'evenement',
  'day before nfp': 'evenement', 'annonce éco jackson hole symposium': 'evenement',

  // ── execution : la gestion de la position. ────────────────────────────────
  'tp': 'execution', 'sl': 'execution', 'be': 'execution', 'trade': 'execution',

  // ── mental : l'état et le retour sur soi. ─────────────────────────────────
  'fatigué': 'mental', "j'aurais du": 'mental', 'réalisation': 'mental', 'lecon': 'mental',

  // ── source : qui, où, avec quel outil. ────────────────────────────────────
  'bricedlb': 'source', 'melmom': 'source', 'jim kwik': 'source', 'justin sung': 'source',
  'kevin trudeau': 'source', 'ponzi letrone': 'source', 'ict': 'source',
  'tradingview': 'source', 'topstepx': 'source', 'topstep': 'source', 'prop-firm': 'source',
  'funded': 'source', 'youtube': 'source', 'skool': 'source', 'cme': 'source', 'nyse': 'source',
  'formation trading': 'source', 'mentorat': 'source',

  // ── activite : ce qu'on faisait. ──────────────────────────────────────────
  'backtest': 'activite', 'backtest nq cfd': 'activite', 'live trading': 'activite',
  'analyse': 'activite', 'analyse vendredi': 'activite', 'trading': 'activite',
  'stats': 'activite', 'nouvelle séquence': 'activite',

  // ── a-trier : ce que je ne peux PAS décider de l'extérieur. ───────────────
  // Abréviations indécidables + raccourcis personnels + bruit de test.
  // Brice tranche ; en attendant elles restent visibles mais rangées à part.
  'ker': 'a-trier', 'qlys': 'a-trier', 'blc': 'a-trier', 'bb': 'a-trier',
  'hrlr': 'a-trier', 'std': 'a-trier', 'std pré market': 'a-trier', 'shadow': 'a-trier',
  'race': 'a-trier', 'ferrari': 'a-trier', 'the futur': 'a-trier', 'mindmap': 'a-trier',
  'sélection-zone': 'a-trier', 'eth': 'a-trier', // Ethereum ou Electronic Trading Hours ?
  'test': 'a-trier', 'exemple': 'a-trier', 'groupe': 'a-trier', 'piece-jointe': 'a-trier',
  'liveclub · trading knowledge —': 'a-trier',
}

const tags = await prisma.tag.findMany({ select: { id: true, name: true, category: true, userId: true } })

const parCategorie = new Map()
const inconnues = []
for (const t of tags) {
  const cat = CLASSEMENT[t.name.trim().toLowerCase()]
  if (!cat) { inconnues.push(t.name); continue }
  if (!parCategorie.has(cat)) parCategorie.set(cat, [])
  parCategorie.get(cat).push(t.name)
}

console.log(`\n${appliquer ? '── ÉCRITURE ──' : '── BLANC (rien ne sera écrit) ──'}\n`)
console.table([...parCategorie.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([categorie, noms]) => ({ categorie, étiquettes: noms.length, exemples: [...new Set(noms)].slice(0, 5).join(' · ') })))

if (inconnues.length) {
  console.log(`⚠️ ${inconnues.length} étiquette(s) absente(s) du classement — elles resteraient SANS catégorie :`)
  console.log('   ' + [...new Set(inconnues)].join(' · '))
} else {
  console.log('Toutes les étiquettes de la base sont couvertes par le classement.')
}

if (!appliquer) {
  console.log('\nRelancer avec --appliquer pour écrire.')
} else {
  let n = 0
  for (const t of tags) {
    const cat = CLASSEMENT[t.name.trim().toLowerCase()]
    if (!cat || t.category === cat) continue
    await prisma.tag.update({ where: { id: t.id }, data: { category: cat } })
    n++
  }
  console.log(`\n${n} étiquette(s) classée(s).`)
}

await prisma.$disconnect()
