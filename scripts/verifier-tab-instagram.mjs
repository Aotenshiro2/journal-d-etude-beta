// Verification locale de la LECTURE INSTAGRAM de l'API de Tab (05/11/2026, note de Tab 60478b43).
// Aucune base, aucun reseau : les fonctions pures (src/lib/tab/instagram-pur.ts) tournent sur
// des cas construits, et le cablage (instagram.ts, reseaux() de lectures.ts) est controle sur
// son texte. Node 22 retire les types : ce script importe les .ts directement.
//
//   node scripts/verifier-tab-instagram.mjs
//
// Sort en code 1 au premier ecart.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'
const I = await import('../src/lib/tab/instagram-pur.ts')

let blocs = 0
const bloc = (nom, f) => { f(); blocs++; console.log(`ok ${blocs}. ${nom}`) }

const S = { n: 100, p25: 0.002, mediane: 0.0043, p75: 0.0061, p90: 0.008 }

bloc('niveau face aux reperes (bon = mieux que 3 reels sur 4)', () => {
  assert.equal(I.niveau(0.009, S), 'tres_bon')
  assert.equal(I.niveau(0.007, S), 'bon')
  assert.equal(I.niveau(0.0043, S), 'normal')
  assert.equal(I.niveau(0.001, S), 'faible')
  assert.equal(I.niveau(null, S), null)
  assert.equal(I.niveau(0.5, null), null)
  // taux de saut : plus bas = mieux
  const saut = { n: 100, p25: 30, mediane: 45, p75: 60, p90: 70 }
  assert.equal(I.niveau(20, saut, true), 'bon')
  assert.equal(I.niveau(65, saut, true), 'faible')
  // p75 = p90 (beaucoup de zeros) : pas de « tres bon » artificiel
  assert.equal(I.niveau(0.01, { n: 10, p25: 0, mediane: 0, p75: 0.002, p90: 0.002 }), 'bon')
})

const jour = (j, o = {}) => ({ jour: j, abonnes: null, nouveaux_abonnes: 0, desabonnes: 0, vues: 10, visites_profil: 1, interactions: 0, metriques: {}, ...o })

bloc('dernier jour complet et periode reculee', () => {
  const js = [jour('2026-11-01'), jour('2026-11-02'), jour('2026-11-03'), jour('2026-11-04', { nouveaux_abonnes: null })]
  assert.equal(I.dernierJourComplet(js), '2026-11-03')
  assert.deepEqual(I.periodeMesuree('2026-10-30', '2026-11-05', '2026-11-03'), { du: '2026-10-28', au: '2026-11-03', reculee: true })
  assert.deepEqual(I.periodeMesuree('2026-10-20', '2026-10-26', '2026-11-03'), { du: '2026-10-20', au: '2026-10-26', reculee: false })
  assert.equal(I.nbJours('2026-10-28', '2026-11-03'), 7)
})

bloc('bilan : comptes UNIQUES de Meta, jamais la somme des jours', () => {
  const js = []
  for (let d = 1; d <= 7; d++) {
    js.push(jour(`2026-10-0${d}`, {
      nouveaux_abonnes: d === 3 ? 2 : 0, desabonnes: d % 2, visites_profil: 2,
      metriques: { website_clicks: d === 7 ? 4 : 0, reach_par_follow_type: { FOLLOWER: 90, NON_FOLLOWER: 10 } },
    }))
  }
  js[6].metriques.couverture_7j = 169
  js[6].metriques.couverture_7j_par_follow_type = { FOLLOWER: 150, NON_FOLLOWER: 19 }
  const b = I.bilanPeriode(js, '2026-10-01', '2026-10-07')
  assert.equal(b.abonnements_gagnes, 2)
  assert.equal(b.desabonnements, 4)
  assert.equal(b.abonnes_net, -2)
  assert.equal(b.comptes_touches_uniques, 169)
  assert.equal(b.part_non_abonnes_touches_pct, 11.2)
  assert.equal(b.part_non_abonnes_mode, 'comptes_uniques')
  assert.equal(b.visites_profil, 14)
  assert.equal(b.clics_vers_le_site, 4)
  // 5 jours : pas de comptes uniques, la part vient de la somme des jours (et le dit)
  const c = I.bilanPeriode(js, '2026-10-01', '2026-10-05')
  assert.equal(c.comptes_touches_uniques, null)
  assert.equal(c.part_non_abonnes_mode, 'somme_des_jours')
  assert.equal(c.part_non_abonnes_touches_pct, 10)
})

bloc('publication : taux pour 100 comptes, niveaux, part vue', () => {
  const R = { seuils: { couverture: { n: 100, p25: 323, mediane: 438, p75: 657, p90: 900 }, taux_enregistrements: S, taux_partages: { n: 100, p25: 0, mediane: 0, p75: 0.0024, p90: 0.005 } } }
  const p = { publication_id: '1', publie_le: '2026-08-24 23:20', type: 'REELS', legende: 'x', lien: null, j_aime: 6, commentaires: 0, partages: 0, enregistrements: 1, couverture: 170, vues: 206, metriques: { part_vue: 0.5545, reels_skip_rate: 48.5, ig_reels_avg_watch_time: 14511, duree_s: 26.17 } }
  const l = I.lirePublication(p, R, 'valeur')
  assert.equal(l.type, 'reel')
  assert.equal(l.enregistrements_pour_100_comptes, 0.59)
  assert.equal(l.niveaux.comptes_touches, 'faible')
  assert.equal(l.niveaux.enregistrements, 'normal')
  assert.equal(l.niveaux.partages, 'normal')
  assert.equal(l.part_vue_pct, 55.45)
  assert.equal(l.temps_moyen_vu_s, 14.5)
  assert.equal(l.comment_lire.regarder_d_abord, 'les enregistrements')
  assert.equal(I.lirePublication(p, null).niveaux.comptes_touches, null)
})

bloc('en bref : cinq lignes', () => {
  const a = { abonnements_gagnes: 2, desabonnements: 8, abonnes_net: -6, comptes_touches_uniques: 169, part_non_abonnes_touches_pct: 11.2, visites_profil: 20, clics_vers_le_site: 4 }
  const b = { abonnes_net: -3, comptes_touches_uniques: 211, part_non_abonnes_touches_pct: 8, clics_vers_le_site: 0 }
  const l = I.enBref(a, b, 0, { nombre: 9, couverture_moyenne: 60 })
  assert.equal(l.length, 5)
  assert.match(l[0], /2 gagnés, 8 perdus, solde -6/)
  assert.match(l[1], /169 uniques/)
  assert.match(l[4], /9 story/)
  // texte clavier seulement (regle de l'organisation)
  for (const x of l) assert.ok(!/[–—…“”‘’]/.test(x), x)
})

bloc('cablage : instagram.ts lit la collecte, reseaux() le branche', () => {
  const srv = readFileSync(new URL('../src/lib/tab/instagram.ts', import.meta.url), 'utf8')
  assert.match(srv, /details -> 'reperes'/)
  assert.match(srv, /couverture|bilanPeriode/)
  assert.ok(!/sum\(couverture\)/.test(srv), 'jamais la somme des couvertures pour Instagram')
  assert.match(srv, /cockpit_social_objectifs/)
  assert.match(srv, /to_regclass/, 'table des objectifs testee avant lecture (transaction READ ONLY)')
  const lec = readFileSync(new URL('../src/lib/tab/lectures.ts', import.meta.url), 'utf8')
  assert.match(lec, /lectureInstagram\(c, notes\)/)
  assert.match(lec, /plateforme = 'facebook' and jour between/, 'le resume par somme ne vaut plus que pour Facebook')
  const aide = readFileSync(new URL('../src/lib/tab/aide.ts', import.meta.url), 'utf8')
  assert.match(aide, /en_bref/)
  const mig = readFileSync(new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261105200000_cockpit_social_objectifs.sql', import.meta.url), 'utf8')
  for (const o of I.OBJECTIFS) assert.ok(mig.includes(`'${o}'`), `objectif ${o} dans la migration`)
})

console.log(`\n${blocs} blocs verifies.`)
