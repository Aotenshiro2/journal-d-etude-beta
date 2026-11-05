// L'ecran « Mes trades », la fiche d'un trade et le guide du Journal (brief J2,
// 05/11/2026) : ce que mes-trades-pur.ts tire de la synthese (periode, mots
// des pastilles, calendrier, six panneaux, sorties prevues face au broker,
// phrases des ecarts, echelle), sur les donnees d'EXEMPLE du labo
// (scripts/exemples-mes-trades.ts, passees par le vrai calcul), puis la
// lecture du code : la page /journal, les trois composants provisoires, le
// badge de trade, le guide. Aucune base, aucun reseau.
// node scripts/verifier-mes-trades.mjs
process.env.TZ = 'Europe/Paris'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const M = await import('../src/lib/mes-trades-pur.ts')
const X = await import('./exemples-mes-trades.ts')
const G = await import('../src/lib/guide-journal.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const novembre = X.syntheseExemple(M.debutPeriode('mois', X.MAINTENANT_EXEMPLE).getTime())
const tout = X.syntheseExemple(null)
const trade = id => tout.trades.find(t => t.segmentId === id)
const nqLong = trade('seg-nq-long')

// -- Les nombres et les dates ------------------------------------------------

bloc('nombres : a la francaise, espace simple entre les milliers, deux decimales des qu il y en a ; points et R', () => {
  assert.equal(M.formatNombre(20100), '20 100')
  assert.equal(M.formatNombre(20100.25), '20 100,25')
  assert.equal(M.formatNombre(20120.5), '20 120,50')
  assert.equal(M.formatNombre(1.08523), '1,08523')
  assert.equal(M.formatNombre(-9), '-9')
  assert.equal(M.formatNombre(0.1 + 0.2), '0,30')
  assert.ok(!/[\u00a0\u202f]/.test(M.formatNombre(1234567.5)), 'aucune espace insecable')
  assert.equal(M.formatPts(0.25), '0,25 pt')
  assert.equal(M.formatPts(-9), '9 pts')
  assert.equal(M.formatPts(1.5), '1,50 pt')
  assert.equal(M.formatPtsSigne(0.25), '+0,25 pt')
  assert.equal(M.formatPtsSigne(-2), '-2 pts')
  assert.equal(M.formatPtsSigne(0), '0 pt')
  assert.equal(M.formatR(2), '2,0')
  assert.equal(M.formatR(1.275), '1,3')
  assert.equal(M.formatR(-1), '-1,0')
  assert.equal(M.ordinal(1), '1re')
  assert.equal(M.ordinal(2), '2e')
})

bloc('dates : heure locale (Paris) ; une position sans fuseau se lit a l heure affichee (composantes UTC)', () => {
  assert.equal(M.jourDe('2026-11-02T23:30:00Z'), '2026-11-03')
  assert.equal(M.jourDe('2026-11-02T23:30:00Z', true), '2026-11-02')
  assert.equal(M.dateCourte('2026-11-03T08:40:00Z'), 'mar. 03/11')
  assert.equal(M.dateCourte('2026-11-03T08:40:00Z', false, true), 'mardi 03/11')
  assert.equal(M.heureDe('2026-11-03T08:40:00Z'), '09:40')
  assert.equal(M.heureDe('2026-11-02T15:32:00Z', true), '15:32')
})

bloc('periode : Ce mois = le 1er a minuit local, 3 mois = le 1er d il y a deux mois, Tout = sans borne ; adresse de la synthese', () => {
  const debut = M.debutPeriode('mois', X.MAINTENANT_EXEMPLE)
  assert.equal(debut.toISOString(), '2026-10-31T23:00:00.000Z')
  assert.equal(M.debutPeriode('3mois', X.MAINTENANT_EXEMPLE).toISOString(), '2026-08-31T22:00:00.000Z')
  assert.equal(M.debutPeriode('tout', X.MAINTENANT_EXEMPLE), null)
  assert.equal(M.urlSynthese('mois', X.MAINTENANT_EXEMPLE), '/api/trades/synthese?depuis=2026-10-31T23%3A00%3A00.000Z')
  assert.equal(M.urlSynthese('tout', X.MAINTENANT_EXEMPLE), '/api/trades/synthese')
  assert.deepEqual(M.PERIODES.map(p => p.libelle), ['Ce mois', '3 mois', 'Tout'])
  assert.ok(M.estPeriode('3mois') && !M.estPeriode('semaine'))
  // La route lit bien un instant ISO comme borne.
  assert.match(lire('../src/lib/synthese-trades-pur.ts'), /const t = Date\.parse\(jourSeul \? `\$\{brut\}T00:00:00Z` : brut\)/)
})

// -- Les pastilles et les elements -------------------------------------------

bloc('pastilles : comme prevu, sortie avant ton TP, stop depasse de 2 pts, pas de trade du broker, pas de note', () => {
  assert.deepEqual(M.pastilleDuTrade(nqLong), { texte: 'Sortie avant ton TP', ton: 'ambre' })
  assert.deepEqual(M.pastilleDuTrade(trade('seg-nq-short')), { texte: 'Comme prévu', ton: 'vert' })
  assert.deepEqual(M.pastilleDuTrade(trade('seg-es-stop')), { texte: 'Stop dépassé de 2 pts', ton: 'rouge' })
  assert.deepEqual(M.pastilleDuTrade(trade('seg-nq-sans')), { texte: 'Pas de trade du broker', ton: 'gris' })
  assert.deepEqual(M.pastilleDuTrade(trade('seg-mnq')), { texte: 'Sortie avant ton TP', ton: 'ambre' })
  assert.deepEqual(M.PASTILLE_SANS_NOTE, { texte: 'Pas de note', ton: 'gris' })
  // Au stop, coupe avant le stop, encore ouvert, en gain sans TP.
  const variante = (t, ecarts, effectif = {}) => ({ ...t, ecarts: { ...t.ecarts, ...ecarts }, effectif: { ...t.effectif, ...effectif } })
  assert.equal(M.pastilleDuTrade(variante(nqLong, { sortieVsPlan: 'stop' })).texte, 'Au stop, comme prévu')
  assert.equal(M.pastilleDuTrade(variante(nqLong, { sortieVsPlan: 'avant-stop' })).texte, 'Coupé avant ton stop')
  assert.equal(M.pastilleDuTrade(variante(nqLong, {}, { sortie: null })).texte, 'Encore ouvert')
  const sansTp = { ...variante(nqLong, { sortieVsPlan: null }), prevu: { ...nqLong.prevu, tp: null } }
  assert.equal(M.pastilleDuTrade(sansTp).texte, 'En gain, sans TP')
})

bloc('elements : trades et positions sans note, du plus recent au plus ancien ; sens long / short', () => {
  const e = M.elementsDe(novembre)
  // es1 est liee (au trade ES) : elle n est pas un element a part.
  assert.deepEqual(e.map(x => x.cle), ['t:seg-mnq', 'p:libre1', 't:seg-nq-sans', 't:seg-nq-short', 't:seg-nq-long', 't:seg-es-stop', 'p:libre2'])
  assert.equal(M.sensDe(nqLong), 1)
  assert.equal(M.sensDe(trade('seg-nq-short')), -1)
  assert.equal(M.sensDe(trade('seg-nq-sans')), 1) // stop sous l entree, sans broker
  assert.equal(M.libelleSens(-1), 'short')
  assert.equal(nqLong.ordre, 1)
  assert.equal(trade('seg-nq-sans').ordre, 3)
})

// -- Le calendrier -----------------------------------------------------------

bloc('calendrier : jours de bourse (lundi-vendredi), samedi et dimanche quand un trade y tombe ; points par jour ; mois de la periode', () => {
  const nov = M.semainesDuMois(2026, 10)
  assert.equal(nov.length, 5) // le 1er est un dimanche : la premiere semaine commence le lundi 2
  assert.deepEqual(nov[0], ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'])
  assert.deepEqual(nov[4], ['2026-11-30', null, null, null, null])
  // Avec le week-end, le dimanche 1er ouvre une semaine de plus.
  const avecWeekend = M.semainesDuMois(2026, 10, true)
  assert.equal(avecWeekend.length, 6)
  assert.deepEqual(avecWeekend[0], [null, null, null, null, null, null, '2026-11-01'])
  assert.equal(avecWeekend[1][6], '2026-11-08')
  assert.deepEqual(M.semainesDuMois(2026, 0)[0], [null, null, null, '2026-01-01', '2026-01-02'])
  assert.ok(M.estWeekend('2026-11-01') && !M.estWeekend('2026-11-02'))
  const jours = M.parJour(M.elementsDe(novembre))
  assert.deepEqual(jours.get('2026-11-03').map(M.pointDe), ['lie', 'lie', 'sans'])
  assert.deepEqual(jours.get('2026-11-02').map(M.pointDe), ['broker', 'lie'])
  assert.deepEqual(jours.get('2026-11-04').map(M.pointDe), ['broker'])
  assert.deepEqual(M.moisDeLaPeriode('mois', X.MAINTENANT_EXEMPLE, null), [{ annee: 2026, mois: 10 }])
  assert.deepEqual(M.moisDeLaPeriode('3mois', X.MAINTENANT_EXEMPLE, null).map(m => m.mois), [8, 9, 10])
  assert.deepEqual(M.moisDeLaPeriode('tout', X.MAINTENANT_EXEMPLE, '2025-12-15').map(m => `${m.annee}-${m.mois}`), ['2025-11', '2026-0', '2026-1', '2026-2', '2026-3', '2026-4', '2026-5', '2026-6', '2026-7', '2026-8', '2026-9', '2026-10'])
})

// -- Les six panneaux et leurs listes ----------------------------------------

bloc('panneaux : lies sur notes, entree de l instrument le plus trade, sorties avant le plan, R prevu et reel, sans broker, sans note', () => {
  const c = M.chiffresPanneaux(novembre)
  assert.deepEqual(c.lies, { n: 4, sur: 5 })
  assert.equal(c.entree.instrument, 'NQ')
  assert.equal(c.entree.n, 2)
  assert.equal(c.entree.moyenne, 0.25) // +0,25 pt sur le long et sur le short
  assert.equal(c.entree.autres, 2) // ES et MNQ
  assert.deepEqual(c.avantPlan, { n: 2, sur: 4 }) // le NQ long et le MNQ
  assert.equal(c.r.n, 3) // le MNQ n a pas de stop : pas de R
  assert.ok(Math.abs(c.r.prevu - (2 + 2.67 + 2.5) / 3) < 1e-9)
  assert.equal(c.sansBroker, 1)
  assert.equal(c.sansNote, 2)
  const liste = cle => M.elementsDeLaListe(cle, novembre).map(e => e.cle)
  assert.deepEqual(liste('avant-plan'), ['t:seg-mnq', 't:seg-nq-long'])
  assert.deepEqual(liste('sans-broker'), ['t:seg-nq-sans'])
  assert.deepEqual(liste('sans-note'), ['p:libre1', 'p:libre2'])
  assert.deepEqual(liste('lies'), ['t:seg-mnq', 't:seg-nq-short', 't:seg-nq-long', 't:seg-es-stop'])
  assert.deepEqual(liste('r'), ['t:seg-nq-short', 't:seg-nq-long', 't:seg-es-stop'])
  assert.ok(M.estCleListe('avant-plan') && !M.estCleListe('toString') && !M.estCleListe(null))
})

// -- La fiche ----------------------------------------------------------------

bloc('fiche : sorties prevues face aux sorties du broker d un compte (partiels, TP), ecart brut et qualite', () => {
  const l = M.lignesDeSortie(nqLong, 1)
  assert.deepEqual(l.map(x => [x.libelle, x.prevu?.prix, x.prevu?.estTp, x.effectif, x.ecart, x.qualite, x.proche, x.suite]), [
    ['1re sortie', 20120, false, 20120.5, 0.5, 'mieux', true, null],
    ['2e sortie', 20140, true, 20131, -9, 'moins', false, 'avant ton TP'],
  ])
  // Short : une seule sortie (le TP), rachat 1 pt au-dessus = moins bien, mais dans le dixieme du risque (15) : rien a signaler.
  const s = M.lignesDeSortie(trade('seg-nq-short'), -1)
  assert.deepEqual(s.map(x => [x.libelle, x.prevu.prix, x.effectif, x.ecart, x.qualite, x.proche, x.suite]), [['Sortie', 20120, 20121, 1, 'moins', true, null]])
  // Sorti au-dela du stop : la sortie se compare au stop, pas au TP.
  const es = M.lignesDeSortie(trade('seg-es-stop'), 1)
  assert.deepEqual(es.map(x => [x.libelle, x.prevu.prix, x.prevu.estStop, x.effectif, x.ecart, x.suite]), [['Sortie', 6845, true, 6843, -2, 'stop dépassé']])
  // Sans broker : la sortie prevue seule.
  assert.deepEqual(M.lignesDeSortie(trade('seg-nq-sans'), 1).map(x => [x.prevu.prix, x.effectif]), [[20240, null]])
  assert.equal(M.qualite(0.25, 1, 'entree'), 'moins') // long paye plus cher
  assert.equal(M.qualite(-0.25, -1, 'entree'), 'moins') // short vendu plus bas
  assert.equal(M.qualite(0, null, 'sortie'), 'egal')
  assert.equal(M.qualite(1, null, 'sortie'), null)
})

bloc('fiche : les quatre ecarts en une ligne (entree, sortie, taille, R) sur les cas du labo', () => {
  assert.equal(M.texteEntree(nqLong), '+0,25 pt, comme prévu')
  assert.equal(M.texteSortie(nqLong), '2e partiel 9 pts avant ton TP')
  assert.equal(M.texteTaille(nqLong), '2, comme prévu (x3 comptes)')
  assert.equal(M.texteR(nqLong), '2,0 prévu, 1,3 réel')
  assert.equal(M.texteSortie(trade('seg-es-stop')), 'Stop dépassé de 2 pts')
  assert.equal(M.texteEntree(trade('seg-oct')), 'Pile à ton prix')
  assert.equal(M.texteSortie(trade('seg-oct')), 'Au TP, comme prévu')
  assert.equal(M.texteEntree(trade('seg-mnq')), '1 pt plus loin que prévu') // sans stop : pas de tolerance
  assert.equal(M.texteSortie(trade('seg-mnq')), '12 pts avant ton TP')
  assert.equal(M.texteR(trade('seg-mnq')), 'Pas de stop, donc pas de R')
  // Short : le signe est celui du prix (vendu 0,25 sous le prevu), comme dans le tableau du detail.
  assert.equal(M.texteEntree(trade('seg-nq-short')), '-0,25 pt, comme prévu')
  assert.equal(M.texteSortie(trade('seg-nq-sans')), 'Pas de trade du broker')
  assert.equal(M.texteEntree(trade('seg-nq-sans')), '20 210 prévu')
  assert.equal(M.texteTaille(trade('seg-nq-sans')), '1 prévu')
  assert.ok(trade('seg-es-stop').ecarts.heureIncertaine)
  assert.ok(!nqLong.ecarts.heureIncertaine)
})

bloc('echelle : domaine avec marge, libelles etales sans chevauchement et dans le cadre, ordre rendu', () => {
  assert.deepEqual(M.domaineEchelle([20080, 20140, 20100.25]).map(x => Math.round(x * 100) / 100), [20072.8, 20147.2])
  assert.deepEqual(M.domaineEchelle([100]), [99, 101])
  assert.equal(M.domaineEchelle([]), null)
  const y = M.etalerLibelles([100, 104, 300, 102], 14, 10, 310)
  assert.deepEqual(y, [100, 128, 300, 114]) // 100, 102 et 104 s ecartent de 14 dans leur ordre ; 300 ne bouge pas
  const bas = M.etalerLibelles([305, 300, 309], 14, 10, 310)
  assert.deepEqual([...bas].sort((a, b) => a - b), [282, 296, 310])
  assert.deepEqual(M.etalerLibelles([50, 200], 14, 0, 400), [50, 200]) // assez ecartes : rien ne bouge
})

// -- Le guide ----------------------------------------------------------------

bloc('guide : 9 etapes en trois temps dans un seul module, etape 7 par le menu de la roue, vignettes public/guide/etape-N.png', () => {
  assert.equal(G.ETAPES_GUIDE.length, 9)
  assert.deepEqual(G.ETAPES_GUIDE.map(e => e.temps), ['noter', 'etudier', 'etudier', 'etudier', 'etudier', 'etudier', 'verifier', 'verifier', 'verifier'])
  assert.deepEqual(Object.keys(G.TEMPS), ['noter', 'etudier', 'verifier'])
  assert.deepEqual(G.ETAPES_GUIDE.map(e => e.image), G.ETAPES_GUIDE.map((_, i) => `/guide/etape-${i + 1}.png`))
  const sept = G.ETAPES_GUIDE[6]
  assert.match(sept.texte, /menu de la roue/)
  assert.match(sept.texte, /« Importer mes trades »/)
  assert.ok(G.ETAPES_GUIDE[2].blocs, 'l etape des blocs montre chaque sorte de bloc')
  assert.deepEqual(G.BLOCS_NOTE, ['Texte', 'Capture', 'Trade', 'Warmup', 'Cooldown', 'DOL'])
  // Aller plus loin : ce que les 9 etapes ne couvrent pas, sans doublon.
  const liens = G.ALLER_PLUS_LOIN.flatMap(g => g.items.flatMap(i => i.liens.map(l => l.href)))
  for (const h of ['/concepts', '/analytics', '/session', '/patterns']) assert.ok(liens.includes(h), h)
  assert.equal(new Set(liens).size, liens.length)
  assert.ok(liens.some(h => h.startsWith('https://chromewebstore.google.com/')))
  // Les deux presentations lisent le meme module.
  for (const f of ['GuideCarrousel', 'GuidePasAPas']) assert.match(lire(`../src/components/guide/${f}.tsx`), /from '@\/lib\/guide-journal'/)
  // Caracteres clavier : pas de tiret cadratin, de guillemets courbes ni de points de suspension en un caractere.
  const texte = lire('../src/lib/guide-journal.ts') + lire('../src/lib/mes-trades-pur.ts')
  assert.ok(!/[\u2014\u2013\u2018\u2019\u201c\u201d\u2026\u00a0\u202f]/.test(texte))
})

bloc('guide : le carrousel a la premiere ouverture (user_metadata.guide_journal_vu), pose a Terminer ou a la fermeture', () => {
  const page = lire('../src/app/guide/page.tsx')
  assert.match(page, /user\.user_metadata\?\.guide_journal_vu !== true/)
  const conteneur = lire('../src/components/guide/GuideJournal.tsx')
  assert.match(conteneur, /supabase\.auth\.updateUser\(\{ data: \{ guide_journal_vu: true \} \}\)/)
  assert.match(conteneur, /<GuidePasAPas onRevoir=\{\(\) => setCarrousel\(true\)\} \/>/)
  assert.match(lire('../src/components/guide/GuidePasAPas.tsx'), /Revoir pas à pas/)
  const carrousel = lire('../src/components/guide/GuideCarrousel.tsx')
  assert.match(carrousel, /Terminer/)
  assert.match(carrousel, /Précédent/)
})

// -- Le curseur et les vues (labo 2 : vues 4, curseur 2, fiche 1) ----------------

const propsCurseur = t => {
  const sens = M.sensDe(t)
  return {
    sens, entree: t.prevu.entree ?? t.effectif?.entree ?? null, stop: t.prevu.stop ?? t.effectif?.stop ?? null, tp: t.prevu.tp,
    sorties: M.sortiesEffectives(t).map(s => s.prix), partiels: M.sortiesPrevues(t, sens).filter(p => !p.estTp).map(p => p.prix),
    rReel: t.ecarts?.rReel ?? null,
  }
}
const arr = x => Math.round(x * 10) / 10

bloc('curseur 2 (labo 2) : stop a 8 %, TP a 92 %, entree a 8 + 84/(1+rPrevu) %, tout en R ; stop depasse hors piste ; sans plan ou sans broker : vide', () => {
  const g = M.geometrieCurseur(propsCurseur(nqLong))
  assert.deepEqual([g.stop, g.entree, g.tp].map(arr), [8, 36, 92]) // rPrevu 2
  assert.deepEqual(g.sorties.map(arr), [64.7, 79.4]) // 1,025 R puis 1,55 R
  assert.deepEqual(g.partiels.map(arr), [64]) // la partielle prevue a 1 R
  assert.equal(M.formatRSigne(g.rObtenu), '+1,3 R')
  assert.ok(g.gain)
  assert.deepEqual([g.trajet.de, g.trajet.a].map(arr), [36, 79.4])
  assert.equal(g.deborde, null)
  // Short : il se lit comme un long (le TP a droite).
  const s = M.geometrieCurseur(propsCurseur(trade('seg-nq-short')))
  assert.deepEqual([s.stop, s.tp].map(arr), [8, 92])
  assert.equal(arr(s.sorties[0]), 90.5)
  assert.ok(s.gain)
  // Stop depasse : la sortie sort de la piste a gauche, le trajet couvre tout le risque, en rouge.
  const es = M.geometrieCurseur(propsCurseur(trade('seg-es-stop')))
  assert.deepEqual([es.stop, es.entree].map(arr), [8, 32]) // rPrevu 2,5
  assert.deepEqual(es.deborde, { de: 1.5, a: es.stop })
  assert.deepEqual(es.trajet, { de: es.stop, a: es.entree })
  assert.ok(!es.gain)
  assert.equal(M.formatRSigne(es.rObtenu), '-1,4 R')
  assert.equal(es.val, 7)
  // Sans broker, sans stop : la piste vide.
  assert.equal(M.geometrieCurseur(propsCurseur(trade('seg-nq-sans'))), null)
  assert.equal(M.geometrieCurseur(propsCurseur(trade('seg-mnq'))), null)
  assert.equal(M.formatRSigne(0), '0,0 R')
  // 3 mois : l'ecart d'entree moyen sur NQ (0,25, 0,25 et 0) s'affiche a deux decimales.
  const troisMois = X.syntheseExemple(M.debutPeriode('3mois', X.MAINTENANT_EXEMPLE).getTime())
  assert.equal(M.chiffresPanneaux(troisMois).entree.moyenne, 0.17)
  assert.equal(M.arrondiEcart(0.000123), 0.00012)
  // Le composant : la geometrie pure, la piste visible dans les deux themes.
  const curseur = lire('../src/components/mes-trades/CurseurSortie.tsx')
  assert.match(curseur, /const g = geometrieCurseur\(props\)/)
  assert.match(curseur, /border-dashed" style=\{\{ borderColor: 'var\(--trade-piste\)' \}\}/)
  const css = lire('../src/app/globals.css')
  assert.match(css, /--trade-piste: rgba\(15, 23, 42, 0\.14\);/)
  assert.match(css, /--trade-piste: rgba\(255, 255, 255, 0\.16\);/)
})

bloc('vues 4 (labo 2) : pastilles, calendrier et trades du jour ; jour par defaut = le dernier de la periode qui a des trades', () => {
  assert.equal(M.dernierJourAvecTrades(M.elementsDe(novembre)), '2026-11-05')
  assert.equal(M.dernierJourAvecTrades([]), null)
  assert.equal(M.libelleJour('2026-11-03'), 'mar. 03/11')
  assert.deepEqual(Object.keys(M.COURTS_LISTES), Object.keys(M.TITRES_LISTES))
  const vues = lire('../src/components/mes-trades/VuesMesTrades.tsx')
  assert.match(vues, /const jourVise = jour \?\? dernierJourAvecTrades\(elements\)/)
  assert.match(vues, /min-\[761px\]:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.1fr\)\]/)
  assert.ok(!/ToggleGroup|localStorage/.test(vues), 'plus de selecteur a trois choix')
  const page = lire('../src/components/mes-trades/MesTrades.tsx')
  // Recliquer la pastille revient au jour ; choisir un jour enleve la pastille ; le jour et la pastille sans historique.
  assert.match(page, /const choisirPanneau = \(cle: CleListe\) => remplacer\(\{ jour, liste: liste === cle \? null : cle \}\)/)
  assert.match(page, /const choisirJour = \(j: string\) => remplacer\(\{ jour: j \}\)/)
  assert.match(page, /router\.push\(adresse\(\{ liste, jour, trade: segmentId \}\)/)
})

// -- La page et les composants -----------------------------------------------

bloc('page /journal : l ecran remplace ComingSoon ; les choix du labo 2 ; fiche par URL ; badge en lien', () => {
  const page = lire('../src/app/journal/page.tsx')
  assert.ok(!/ComingSoon/.test(page))
  assert.match(page, /<MesTrades \/>/)
  const dossier = '../src/components/mes-trades/'
  for (const f of ['MesTrades', 'VuesMesTrades', 'VuePanneaux', 'VueCalendrier', 'VueFile', 'CurseurSortie', 'FicheTrade', 'FicheEchelle', 'FicheDetail']) {
    assert.ok(existsSync(new URL(`${dossier}${f}.tsx`, import.meta.url)), f)
  }
  // Les trois points tranches par Brice au labo 2, plus rien de provisoire.
  for (const f of ['VuesMesTrades', 'CurseurSortie', 'FicheTrade']) {
    const source = lire(`${dossier}${f}.tsx`)
    assert.match(source, /labo 2/, f)
    assert.ok(!/PROVISOIRE/.test(source), f)
  }
  // Fiche 1 : le detail deplie dans la meme carte, la rangee repliee cachee, l'etat retenu (try/catch).
  const fiche = lire(`${dossier}FicheTrade.tsx`)
  assert.match(fiche, /try \{[^}]*localStorage\.getItem/)
  assert.match(fiche, /<FicheEchelle trade=\{trade\} sansRepli=\{detail\}>/)
  assert.match(fiche, /<FicheDetail trade=\{trade\} integre \/>/)
  // Les deux pieges du labo 2 : pas de fond de tuile dans les cellules, l'icone de « Capture » garde sa taille.
  const detail = lire(`${dossier}FicheDetail.tsx`)
  assert.ok(!/<td[^>]*(case-bg|canvas-bg)/.test(detail), 'cellule avec un fond de tuile')
  assert.match(detail, /<TeteBloc icone=\{<ImageIcon className="size-3\.5" aria-hidden="true" \/>\}>Capture<\/TeteBloc>/)
  assert.match(lire(`${dossier}fiche-commun.tsx`), /<img src=\{c\.url\} alt=\{`Capture \$\{i \+ 1\} du trade`\} className="block h-auto w-full"/)
  // La fiche : /journal?trade=<segmentId>, le badge y mene.
  assert.match(lire(`${dossier}MesTrades.tsx`), /const tradeId = params\.get\('trade'\)/)
  assert.match(lire('../src/lib/fiche-trade.ts'), /\/journal\?trade=\$\{encodeURIComponent\(segmentId\)\}/)
  assert.match(lire('../src/components/StudyCanvas.tsx'), /meta\.fiche \?/)
  // Le titre dans la barre et le libelle du menu.
  const shell = lire('../src/components/CanvasShell.tsx')
  assert.match(shell, /label: 'Documenter mes trades', titre: 'Mes trades'/)
  assert.match(lire('../src/components/NoteMapCanvas.tsx'), /label: 'Documenter mes trades'/)
  // Aucun harnais d'essai livre.
  assert.ok(!existsSync(new URL('../src/app/guide-essai-mes-trades', import.meta.url)), 'harnais d essai encore la')
})

console.log(`\n${n} blocs verifies, tout est bon.`)
