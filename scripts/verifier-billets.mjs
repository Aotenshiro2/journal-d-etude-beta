// Verification HORS LIGNE du billet du jour de l'academie (27/10/2026) : la fenetre
// libre de 48 h dans la regle d'acces (src/lib/academie/pur.ts, ouvertureLecon) et la
// lecture de la saisie du cockpit (src/lib/academie/billets.ts). Node 22 supprime les
// types tout seul : les fonctions testees sont celles des routes.
//
// Lancement (depuis apps/journal-d-etude) : node scripts/verifier-billets.mjs
// Contre la base (transaction annulee) : scripts/essayer-migration-billets.mjs.

import assert from 'node:assert/strict'
import {
  FENETRE_LIBRE_BILLET_H, fenetreLibreOuverte, finFenetreLibre, ouvertureLecon, ouvertureModule, preparerDroits, trierRaisons,
} from '../src/lib/academie/pur.ts'
import {
  colonnesLecon, etatBillet, lireSaisieBillet, lireVideo, slugBillet, slugLibreBillet, LIMITES_BILLET,
} from '../src/lib/academie/billets.ts'

let blocs = 0
function bloc(nom, fn) {
  fn()
  blocs++
  console.log(`ok  ${nom}`)
}

const H = 3600 * 1000
const CHRONIQUES = 'mod-chroniques'
const BILLETS = 'sec-billets'
const publie = new Date('2026-10-27T08:00:00Z')
const t0 = publie.getTime()

const gratuit = preparerDroits({ admin: false, etm: false, secoursEssai: false, liveClub: 'non_lu', lignes: [] })
const payant = preparerDroits({
  admin: false, etm: false, secoursEssai: false, liveClub: 'non_lu',
  lignes: [{ origine: 'acces', source: 'stripe', slug: 'module-chroniques-de-l-accelerateur', ouvreTout: false, moduleId: CHRONIQUES, sectionId: null }],
})
const billet = { moduleId: CHRONIQUES, sectionId: BILLETS, usage: 'interne', apercu: false, billetPublieLe: publie }
const ancien = { moduleId: CHRONIQUES, sectionId: BILLETS, usage: 'interne', apercu: false, billetPublieLe: null }

bloc('fenetre libre : ouverte de la publication (incluse) a +48 h (exclue), fermee avant et apres', () => {
  assert.equal(FENETRE_LIBRE_BILLET_H, 48)
  assert.equal(finFenetreLibre(publie).toISOString(), '2026-10-29T08:00:00.000Z')
  assert.equal(finFenetreLibre('2026-10-27T08:00:00Z').toISOString(), '2026-10-29T08:00:00.000Z')
  assert.equal(finFenetreLibre(null), null)
  assert.equal(finFenetreLibre('pas une date'), null)
  assert.equal(fenetreLibreOuverte(publie, t0 - 1), false)
  assert.equal(fenetreLibreOuverte(publie, t0), true)
  assert.equal(fenetreLibreOuverte(publie, t0 + 47 * H), true)
  assert.equal(fenetreLibreOuverte(publie, t0 + 48 * H - 1), true)
  assert.equal(fenetreLibreOuverte(publie, t0 + 48 * H), false)
  assert.equal(fenetreLibreOuverte(null, t0), false)
})

bloc('compte gratuit : le billet s ouvre (raison billet) dans la fenetre, se ferme apres ; un ancien billet reste ferme', () => {
  assert.deepEqual(ouvertureLecon(gratuit, billet, t0 + 1 * H), { acces: 'ouvert', raisons: ['billet'] })
  assert.deepEqual(ouvertureLecon(gratuit, billet, t0 + 49 * H), { acces: 'ferme', raisons: [] })
  assert.deepEqual(ouvertureLecon(gratuit, billet, t0 - 1 * H), { acces: 'ferme', raisons: [] })
  assert.deepEqual(ouvertureLecon(gratuit, ancien, t0 + 1 * H), { acces: 'ferme', raisons: [] })
  // Sans date (appel d'avant le 27/10, trouver_cours) : rien ne change.
  assert.deepEqual(ouvertureLecon(gratuit, { moduleId: CHRONIQUES, sectionId: BILLETS, usage: 'interne', apercu: false }), { acces: 'ferme', raisons: [] })
})

bloc('compte payant (module achete) : ouvert avant, pendant et apres la fenetre, la raison achat passe devant', () => {
  assert.deepEqual(ouvertureLecon(payant, billet, t0 + 1 * H), { acces: 'ouvert', raisons: ['achat', 'billet'] })
  assert.deepEqual(ouvertureLecon(payant, billet, t0 + 72 * H), { acces: 'ouvert', raisons: ['achat'] })
  assert.deepEqual(ouvertureLecon(payant, ancien, t0 + 1 * H), { acces: 'ouvert', raisons: ['achat'] })
  assert.deepEqual(trierRaisons(['apercu', 'billet', 'compte']), ['compte', 'billet', 'apercu'])
})

bloc('le module des Chroniques d un compte gratuit : partiel (le billet seul), raison billet ; ferme apres la fenetre', () => {
  const pendant = [ouvertureLecon(gratuit, billet, t0 + H), ouvertureLecon(gratuit, ancien, t0 + H)]
  assert.deepEqual(ouvertureModule(gratuit, CHRONIQUES, pendant), { acces: 'partiel', raisons: ['billet'] })
  const apres = [ouvertureLecon(gratuit, billet, t0 + 50 * H), ouvertureLecon(gratuit, ancien, t0 + 50 * H)]
  assert.deepEqual(ouvertureModule(gratuit, CHRONIQUES, apres), { acces: 'ferme', raisons: [] })
})

bloc('video : guid Bunny, liens YouTube (watch, youtu.be, shorts, embed, live), id seul, vide ; le reste refuse', () => {
  assert.deepEqual(lireVideo('0D8F1B2C-3A4B-4C5D-8E6F-7A8B9C0D1E2F'), { hebergeur: 'bunny', id: '0d8f1b2c-3a4b-4c5d-8e6f-7a8b9c0d1e2f' })
  assert.deepEqual(lireVideo('https://iframe.mediadelivery.net/embed/123/0d8f1b2c-3a4b-4c5d-8e6f-7a8b9c0d1e2f'), { hebergeur: 'bunny', id: '0d8f1b2c-3a4b-4c5d-8e6f-7a8b9c0d1e2f' })
  for (const lien of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://m.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ',
  ]) assert.deepEqual(lireVideo(lien), { hebergeur: 'youtube', id: 'dQw4w9WgXcQ' }, lien)
  assert.equal(lireVideo(''), null)
  assert.equal(lireVideo('   '), null)
  assert.equal(lireVideo(null), null)
  assert.equal(lireVideo('https://vimeo.com/123'), 'invalide')
  assert.equal(lireVideo('https://www.youtube.com/watch?v=court'), 'invalide')
  assert.equal(lireVideo('javascript:alert(1)'), 'invalide')
  assert.equal(lireVideo(42), 'invalide')
})

bloc('saisie du cockpit : titre et texte obligatoires et bornes, date ISO ou maintenant, id uuid, video lue', () => {
  const ok = lireSaisieBillet({ titre: '  Le  billet ', contenu: 'Ligne 1\r\nLigne 2 ', publie_le: '2026-10-28T07:30:00.000Z', video: 'https://youtu.be/dQw4w9WgXcQ' })
  assert.deepEqual(ok, {
    id: null, titre: 'Le billet', contenu: 'Ligne 1\nLigne 2', publieLe: new Date('2026-10-28T07:30:00.000Z'),
    video: { hebergeur: 'youtube', id: 'dQw4w9WgXcQ' },
  })
  assert.equal(lireSaisieBillet({ titre: 'T', contenu: 'C' }).publieLe, null)
  assert.equal(lireSaisieBillet({ titre: 'T', contenu: 'C', publie_le: '' }).publieLe, null)
  assert.ok('erreur' in lireSaisieBillet({ titre: '', contenu: 'C' }))
  assert.ok('erreur' in lireSaisieBillet({ titre: 'T', contenu: '  ' }))
  assert.ok('erreur' in lireSaisieBillet({ titre: 'x'.repeat(LIMITES_BILLET.titre + 1), contenu: 'C' }))
  assert.ok('erreur' in lireSaisieBillet({ titre: 'T', contenu: 'x'.repeat(LIMITES_BILLET.contenu + 1) }))
  assert.ok('erreur' in lireSaisieBillet({ titre: 'T', contenu: 'C', publie_le: 'demain' }))
  assert.ok('erreur' in lireSaisieBillet({ titre: 'T', contenu: 'C', video: 'https://vimeo.com/1' }))
  assert.ok('erreur' in lireSaisieBillet({ id: 'pas-un-uuid', titre: 'T', contenu: 'C' }))
  assert.equal(lireSaisieBillet({ id: 'A0000000-0000-4000-8000-000000000001', titre: 'T', contenu: 'C' }).id, 'a0000000-0000-4000-8000-000000000001')
  assert.ok('erreur' in lireSaisieBillet(null))
})

bloc('slug : titre sans accents + jour de Paris (comme les billets importes), libre dans le module', () => {
  assert.equal(slugBillet("C'est quoi l'Order Flow ? Été", new Date('2026-10-27T23:30:00Z')), 'c-est-quoi-l-order-flow-ete-28-10-2026')
  assert.equal(slugBillet('!!!', new Date('2026-10-27T10:00:00Z')), 'billet-27-10-2026')
  assert.ok(slugBillet('x'.repeat(300), new Date('2026-10-27T10:00:00Z')).length <= 120)
  assert.equal(slugLibreBillet('a-27-10-2026', new Set(['a-27-10-2026', 'a-27-10-2026-2'])), 'a-27-10-2026-3')
  assert.equal(slugLibreBillet('b', new Set(['a'])), 'b')
})

bloc('colonnes de la lecon : Bunny = video (bibliotheque formation), YouTube = texte + lien en piece jointe, rien = texte', () => {
  assert.deepEqual(colonnesLecon({ hebergeur: 'bunny', id: 'g' }), { type: 'video', hebergeur: 'bunny', bibliotheque: 'formation', bunnyVideoId: 'g', ressources: [] })
  assert.deepEqual(colonnesLecon({ hebergeur: 'youtube', id: 'dQw4w9WgXcQ' }).ressources, [{ titre: 'La vidéo sur YouTube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }])
  assert.equal(colonnesLecon({ hebergeur: 'youtube', id: 'dQw4w9WgXcQ' }).type, 'texte')
  assert.deepEqual(colonnesLecon(null), { type: 'texte', hebergeur: null, bibliotheque: null, bunnyVideoId: null, ressources: [] })
})

bloc('etat pour la liste du cockpit : programme, fenetre, archive, cache (lecon plus publiee), retire', () => {
  const f = 48 * H
  const b = (o = {}) => ({ publie_le: publie, retire_le: null, lecon_statut: 'publie', ...o })
  assert.equal(etatBillet(b({ lecon_statut: 'brouillon' }), t0 - H, f), 'programme')
  assert.equal(etatBillet(b(), t0 + H, f), 'fenetre')
  assert.equal(etatBillet(b(), t0 + 48 * H, f), 'archive')
  assert.equal(etatBillet(b({ lecon_statut: 'brouillon' }), t0 + H, f), 'cache')
  assert.equal(etatBillet(b({ retire_le: new Date() }), t0 + H, f), 'retire')
})

console.log(`\n${blocs} blocs, tout passe.`)
