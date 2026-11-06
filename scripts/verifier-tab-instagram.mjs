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
  // reel peu vu (part vue faible face aux reperes) : l'action parle de l'ouverture
  const R2 = { seuils: { ...R.seuils, part_vue: { n: 100, p25: 0.6, mediane: 0.7, p75: 0.8, p90: 0.9 } } }
  assert.match(I.lirePublication(p, R2, 'valeur').action_proposee, /décrochent tôt/)
  assert.match(l.action_proposee, /Peu enregistré/)
})

bloc('post : visites en taux, clics sur le lien du profil, action selon l\'objectif', () => {
  const p = { publication_id: '2', publie_le: '2026-05-27 10:00', type: 'FEED', legende: 'x', lien: null, j_aime: 10, commentaires: 2, partages: 0, enregistrements: 0, couverture: 200, vues: 300, metriques: { profile_visits: 4, follows: 1, clics_lien_profil: 1 } }
  const l = I.lirePublication(p, null, 'vente')
  assert.equal(l.visites_profil_pour_100_comptes, 2)
  assert.equal(l.clics_lien_profil, 1)
  assert.match(l.action_proposee, /un seul appel à l'action clair/)
  assert.equal(I.lirePublication(p, null, 'communaute').comment_lire.regarder_d_abord, 'les commentaires')
  assert.match(I.lirePublication(p, null).action_proposee, /Rien qui sorte du lot/)
})

bloc('textes de Tab (section 4) : tous les indicateurs, clavier seulement', () => {
  for (const k of ['comptes_touches', 'part_non_abonnes', 'part_vue', 'partages', 'enregistrements', 'visites_profil', 'abonnements_et_clics', 'likes_et_commentaires']) {
    assert.ok(I.COMMENT_LIRE[k]?.ce_que_c_est && I.COMMENT_LIRE[k]?.comment_lire, k)
  }
  for (const o of I.OBJECTIFS) assert.ok(!/à écrire/.test(I.GRILLE_LECTURE[o].regarder_d_abord), `grille ${o} remplie`)
  const tout = JSON.stringify([I.COMMENT_LIRE, I.GRILLE_LECTURE, I.PAS_DANS_L_API])
  assert.ok(!/[–—…“”‘’]/.test(tout), 'pas de tiret long, de points de suspension ni de guillemets courbes')
})

bloc('niveaux du bilan face aux periodes de meme duree du compte', () => {
  const q = (p25, mediane, p75, p90) => ({ n: 59, p25, mediane, p75, p90 })
  const R = { compte: { fenetres: { 7: { abonnes_net: q(-4, -3, -1, 0), part_non_abonnes: q(0.034, 0.048, 0.074, 0.115), comptes_touches: q(190, 228, 278.5, 308.8), visites_profil: q(22, 27, 37, 44.4) } } } }
  const b = { abonnes_net: -5, comptes_touches_uniques: 168, part_non_abonnes_touches_pct: 4.8, part_non_abonnes_mode: 'comptes_uniques', visites_profil: 20, jours_mesures: 7 }
  const n = I.niveauxBilan(b, R, 7)
  assert.deepEqual(n, { abonnes_net: 'faible', part_non_abonnes: 'normal', comptes_touches: 'faible', visites_profil: 'faible', messages_recus: null })
  assert.equal(I.niveauxBilan(b, R, 30), null, 'pas de reperes 30 jours dans ce cas')
  assert.equal(I.niveauxBilan(b, null, 7), null)
  assert.equal(I.niveauxBilan({ ...b, jours_mesures: 6 }, R, 7).visites_profil, null, 'semaine incomplete : pas de niveau des visites')
  const lisibles = I.reperesLisibles({ seuils: {}, compte: { base: { jours: 65 }, fenetres: R.compte.fenetres } })
  assert.equal(lisibles.compte.sur_7_jours.part_non_abonnes_pct.mediane, 4.8)
  assert.equal(lisibles.compte.sur_30_jours, null)
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
  // avec les niveaux du compte : le mot suit le chiffre
  const n = I.enBref(a, b, 0, null, { abonnes_net: 'faible', part_non_abonnes: 'bon', comptes_touches: 'normal', visites_profil: null }, 7)
  assert.match(n[0], /solde -6 .*, faible pour une semaine\.$/)
  assert.match(n[1], /dans la moyenne pour une semaine/)
  assert.match(n[2], /bon pour une semaine/)
  assert.ok(!/pour une semaine/.test(n[3]), 'pas de niveau sans repere')
})

bloc('messages recus : comptes du compte, bilan, en bref, 3 jours apres un post « vente »', () => {
  const js = []
  for (let d = 1; d <= 9; d++) js.push(jour(`2026-11-0${d}`, { metriques: d <= 2 ? {} : { messages_recus: d, nouvelles_conversations: d === 5 ? 1 : 0 } }))
  const b = I.bilanPeriode(js, '2026-11-03', '2026-11-09')
  assert.equal(b.messages_recus, 3 + 4 + 5 + 6 + 7 + 8 + 9)
  assert.equal(b.nouvelles_conversations, 1)
  assert.equal(I.bilanPeriode(js, '2026-11-01', '2026-11-02').messages_recus, null, 'jours pas comptes : null, pas 0')
  const m = I.messagesApres('2026-11-04 18:30', js)
  assert.equal(m.messages_recus, 4 + 5 + 6)
  assert.equal(m.jours_comptes, 3)
  assert.equal(m.moyenne_sur_3_jours, 18)
  assert.equal(I.messagesApres('2026-11-01 10:00', js).messages_recus, null, '1 jour compte sur 3 : pas de chiffre')
  assert.equal(I.messagesApres('2026-11-01 10:00', js).jours_comptes, 1)
  assert.equal(I.messagesApres('2026-11-08 10:00', js).messages_recus, null, 'post trop recent : pas encore 3 jours')
  assert.equal(I.messagesApres(null, js), null)
  const a = { abonnements_gagnes: 1, desabonnements: 0, abonnes_net: 1, comptes_touches_uniques: 100, part_non_abonnes_touches_pct: 5, visites_profil: 10, clics_vers_le_site: 2, messages_recus: 42 }
  const l = I.enBref(a, { ...a, messages_recus: 30 }, 0, null, { messages_recus: 'bon' }, 7)
  assert.match(l[3], /42 messages reçus \(période d'avant : 30\), bon pour une semaine\.$/)
  assert.ok(!/messages/.test(I.enBref({ ...a, messages_recus: null }, a, 0, null)[3]), 'sans comptage, pas de messages dans la ligne')
  assert.ok(I.COMMENT_LIRE.messages_recus.ce_que_c_est.includes('jamais leur contenu'))
})

bloc('cablage : instagram.ts lit la collecte, reseaux() le branche', () => {
  const srv = readFileSync(new URL('../src/lib/tab/instagram.ts', import.meta.url), 'utf8')
  assert.match(srv, /details -> 'reperes'/)
  assert.match(srv, /couverture|bilanPeriode/)
  assert.ok(!/sum\(couverture\)/.test(srv), 'jamais la somme des couvertures pour Instagram')
  assert.match(srv, /cockpit_social_objectifs/)
  assert.match(srv, /to_regclass/, 'table des objectifs testee avant lecture (transaction READ ONLY)')
  assert.match(srv, /comment_lire_chaque_indicateur: COMMENT_LIRE/)
  assert.match(srv, /niveauxBilan\(actuelle, compte\.reperes, n\)/)
  assert.match(srv, /messages_recus_du_compte_3_jours: messagesApres\(x\.publie_le, jours\)/)
  const lec = readFileSync(new URL('../src/lib/tab/lectures.ts', import.meta.url), 'utf8')
  assert.match(lec, /lectureInstagram\(c, notes\)/)
  assert.match(lec, /plateforme = 'facebook' and jour between/, 'le resume par somme ne vaut plus que pour Facebook')
  const aide = readFileSync(new URL('../src/lib/tab/aide.ts', import.meta.url), 'utf8')
  assert.match(aide, /en_bref/)
  const mig = readFileSync(new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261105200000_cockpit_social_objectifs.sql', import.meta.url), 'utf8')
  for (const o of I.OBJECTIFS) assert.ok(mig.includes(`'${o}'`), `objectif ${o} dans la migration`)
})

console.log(`\n${blocs} blocs verifies.`)
