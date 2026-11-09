// Verification HORS LIGNE de Mon coaching (09/11/2026) : le CALCUL DU RESTE
// (resumerCoaching), ce que voit le membre (vueMembre), le webhook de Cal (la
// SIGNATURE, la lecture d'un evenement, le RATTACHEMENT par l'email de
// l'invite), le regroupement par personne du cockpit, le corps des gestes du
// cockpit, les migrations et le code des routes (lus comme des fichiers).
// Fonctions pures et lecture de fichiers : aucune base, aucun reseau.
//
// 09/11, suite (brief D:\7_Agents\briefs\2026-11-09-mon-coaching-reglages.md) :
// on compte en HEURES (minutes), plus en seances. Une seance de 30 min retire
// 0,5 h, une annulee ne retire jamais rien, l'ETM se pose en heures eleve par
// eleve, une seance peut se partager entre deux droits.
//
// Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
//   node scripts/verifier-coaching.mjs
// Contre la base (transaction annulee) : scripts/essayer-migration-coaching-heures.mjs.

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import * as C from '../src/lib/coaching/pur.ts'

let blocs = 0
async function bloc(nom, fn) {
  await fn()
  blocs++
  console.log(`ok  ${nom}`)
}
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261109140000_coaching_seances.sql'
const MIGRATION_HEURES = 'sites/Aoknowledgecom/supabase/migrations/20261109200000_coaching_heures.sql'
function cheminMigration(fichier) {
  const candidats = [
    process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${fichier}`) : null,
    new URL(`../../../${fichier}`, import.meta.url),
  ].filter(Boolean)
  const trouve = candidats.find(u => existsSync(u))
  if (!trouve) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${fichier})`)
  return trouve
}

// Tiret demi-cadratin et cadratin.
const TIRETS = /[–—]/
const J = 24 * 3600 * 1000
const MAINTENANT = Date.UTC(2026, 10, 9, 12, 0, 0)
const jour = n => new Date(MAINTENANT + n * J).toISOString()
const droit = o => ({ coach: 'brice', minutes: 60, source: 'offert', reference: null, libelle: null, depuis: jour(-30), retire_le: null, ...o })
const seance = o => ({ coach: 'brice', duree_min: 60, statut: 'faite', source: 'cockpit', droit_id: null, ...o })
const PACK = droit({ id: 'pack-1', minutes: 480, seances: 8, source: 'pack', reference: 'coaching-8h', libelle: 'Pack 8 h', depuis: jour(-20) })

await bloc('heures : 8 h, 7,5 h, 0,5 h, 6 h 50, 50 min ; pluriel a partir de 2 ; pas de tiret cadratin', () => {
  const H = C.texteHeures
  assert.deepEqual([480, 450, 30, 0, 410, 75, 50, 15, 720, 390, 90].map(H),
    ['8 h', '7,5 h', '0,5 h', '0 h', '6 h 50', '1 h 15', '50 min', '15 min', '12 h', '6,5 h', '1,5 h'])
  assert.equal(C.phraseReste(360, 480, 'brice'), '6 h restantes sur 8 h avec Brice', 'la phrase du brief')
  assert.equal(C.phraseReste(90, 480, 'brice'), '1,5 h restante sur 8 h avec Brice', 'singulier sous 2')
  assert.equal(C.phraseReste(150, 720, 'brice'), '2,5 h restantes sur 12 h avec Brice')
  assert.equal(C.phraseReste(60, 120, 'melanie'), '1 h restante sur 2 h avec Mélanie')
  assert.equal(C.phraseReste(0, 480, 'brice'), '0 h restante sur 8 h avec Brice')
  assert.equal(C.phraseReste(50, 480, 'brice'), '50 min restantes sur 8 h avec Brice')
  assert.equal(C.phraseReste(30, 480, 'brice'), '0,5 h restante sur 8 h avec Brice')
  assert.equal(C.phraseSansDroit(120, 'melanie'), '2 h de coaching avec Mélanie')
  assert.equal(C.detailSeances(2, 1), '2 séances faites, 1 prévue')
  assert.equal(C.detailSeances(1, 1), '1 séance faite, 1 prévue')
  assert.equal(C.detailSeances(1, 0), '1 séance faite')
  assert.equal(C.detailSeances(0, 2), '2 séances prévues')
  assert.equal(C.detailSeances(0, 0), "aucune séance pour l'instant")
  assert.equal(C.minutesDuDroit({ minutes: 720 }), 720)
  assert.equal(C.minutesDuDroit({ minutes: null, seances: 3 }), 180, 'une ligne de l ancien journal : seances x 60')
  assert.equal(C.minutesDuDroit({ seances: 2 }), 120)
  assert.equal(C.minutesDuDroit({ minutes: '90' }), 90, 'un nombre en texte se lit')
  assert.equal(C.minutesDuDroit({}), 0)
  assert.equal(C.minutesDuDroit({ minutes: -30, seances: null }), 0)
  for (const t of [...Object.values(C.LIBELLE_STATUT), ...Object.values(C.TEXTE_ERREUR), ...Object.values(C.NOM_COACH),
    C.phraseReste(410, 720, 'melanie'), C.detailSeances(3, 2)]) assert.ok(!TIRETS.test(t), t)
})

await bloc('reste en heures : le pack 8 h entame (1 h et 30 min faites, 30 min prevue, 1 h annulee) = 6 h sur 8 h', () => {
  const r = C.resumerCoaching([PACK], [
    seance({ id: 's1', debut: jour(-10) }),
    seance({ id: 's2', debut: jour(-3), duree_min: 30 }),
    seance({ id: 's3', debut: jour(-1), statut: 'annulee' }),
    seance({ id: 's4', debut: jour(4), statut: 'prevue', source: 'cal', duree_min: 30 }),
  ], MAINTENANT)
  assert.equal(r.visible, true)
  assert.equal(r.lignes.length, 1)
  const [l] = r.lignes
  assert.deepEqual([l.total_min, l.faites_min, l.prevues_min, l.restantes_min, l.nb_faites, l.nb_prevues], [480, 90, 30, 360, 2, 1])
  assert.equal(l.phrase, '6 h restantes sur 8 h avec Brice')
  assert.equal(l.detail, '2 séances faites, 1 prévue')
  assert.equal(l.titre, 'Pack 8 h')
  assert.equal(l.famille, 'pack')
  assert.equal(l.pack, 'coaching-8h')
  assert.equal(r.prochain.id, 's4')
  assert.deepEqual(r.historique.map(x => x.id), ['s4', 's3', 's2', 's1'], 'la plus recente d abord')
  assert.equal(r.historique.find(x => x.id === 's3').statut_affiche, 'annulee')
  assert.equal(r.historique.find(x => x.id === 's3').ligne, null)
  assert.ok(r.historique.every(x => x.hors_min === 0))
  const passee = C.resumerCoaching([PACK], [seance({ id: 'p', debut: jour(-2), statut: 'prevue' })], MAINTENANT)
  assert.equal(passee.historique[0].statut_affiche, 'passee', 'une prevue dans le passe se lit « Passée »')
  assert.equal(passee.lignes[0].phrase, '7 h restantes sur 8 h avec Brice', 'et elle compte tant qu on ne la marque pas')
  assert.equal(passee.prochain, null)
})

await bloc('annulation : ne compte jamais, tot ou au dernier moment ; « annulee » rend l heure, « faite » la garde', () => {
  // Annulee cinq minutes avant le debut : le statut seul compte, jamais le moment.
  const tard = seance({ id: 't', debut: new Date(MAINTENANT + 5 * 60_000).toISOString(), statut: 'annulee' })
  assert.equal(C.resumerCoaching([PACK], [tard], MAINTENANT).lignes[0].phrase, '8 h restantes sur 8 h avec Brice')
  const lieeAnnulee = seance({ id: 'u', debut: jour(-1), statut: 'annulee', droit_id: 'pack-1' })
  assert.equal(C.resumerCoaching([PACK], [lieeAnnulee], MAINTENANT).lignes[0].restantes_min, 480, 'meme liee a un droit')
  // Un rendez-vous manque sans prevenir : prevu (passe), il compte tant que l'equipe ne le marque pas.
  const manque = seance({ id: 'm', debut: jour(-1), statut: 'prevue' })
  assert.equal(C.resumerCoaching([PACK], [manque], MAINTENANT).lignes[0].restantes_min, 420)
  assert.equal(C.resumerCoaching([PACK], [{ ...manque, statut: 'annulee' }], MAINTENANT).lignes[0].restantes_min, 480, '« annulée » la rend')
  assert.equal(C.resumerCoaching([PACK], [{ ...manque, statut: 'faite' }], MAINTENANT).lignes[0].restantes_min, 420, '« faite » la garde')
})

await bloc('reste : deux coachs, une ligne chacun, Brice d abord', () => {
  const r = C.resumerCoaching([
    PACK,
    droit({ id: 'mel-1', coach: 'melanie', minutes: 180, source: 'offert', depuis: jour(-15) }),
  ], [
    seance({ id: 'b1', debut: jour(-5) }),
    seance({ id: 'm1', coach: 'melanie', debut: jour(-4) }),
    seance({ id: 'm2', coach: 'melanie', debut: jour(2), statut: 'prevue', duree_min: 30 }),
  ], MAINTENANT)
  assert.deepEqual(r.lignes.map(l => l.phrase), ['7 h restantes sur 8 h avec Brice', '1,5 h restante sur 3 h avec Mélanie'])
  assert.deepEqual(r.lignes.map(l => l.titre), ['Pack 8 h', 'Heures de coaching'])
  assert.equal(r.prochain.id, 'm2')
  assert.deepEqual(r.hors_droits, { brice: 0, melanie: 0 })
  assert.deepEqual(r.hors_droits_min, { brice: 0, melanie: 0 })
})

await bloc('ETM en heures, eleve par eleve : 12 h a 2 x 30 min par semaine (Yacine), 6 h a 1 h toutes les 2 semaines (Florent)', () => {
  assert.equal(C.MINUTES_ETM_DEFAUT, 720, '1 h par semaine sur 3 mois')
  const yacine = C.resumerCoaching([droit({ id: 'etm-y', minutes: 720, source: 'etm', depuis: jour(-30) })],
    Array.from({ length: 8 }, (_, i) => seance({ id: `y${i}`, debut: jour(-28 + i * 3.5), duree_min: 30 })), MAINTENANT)
  assert.equal(yacine.lignes[0].titre, 'ETM')
  assert.equal(yacine.lignes[0].phrase, '8 h restantes sur 12 h avec Brice', '8 seances de 30 min = 4 h')
  assert.equal(yacine.lignes[0].detail, '8 séances faites')
  const florent = C.resumerCoaching([droit({ id: 'etm-f', minutes: 360, source: 'etm', depuis: jour(-45) })], [
    seance({ id: 'f1', debut: jour(-42) }), seance({ id: 'f2', debut: jour(-28) }), seance({ id: 'f3', debut: jour(-14) }),
    seance({ id: 'f4', debut: jour(1), statut: 'prevue' }),
  ], MAINTENANT)
  assert.equal(florent.lignes[0].phrase, '2 h restantes sur 6 h avec Brice')
  assert.equal(florent.lignes[0].detail, '3 séances faites, 1 prévue')
  const demi = C.resumerCoaching([droit({ id: 'etm-d', minutes: 390, source: 'etm' })], [seance({ id: 'd', debut: jour(-1), duree_min: 45 })], MAINTENANT)
  assert.equal(demi.lignes[0].phrase, '5 h 45 restantes sur 6,5 h avec Brice')
})

await bloc('Cal : une heure payee consomme SON droit (de sa duree), les autres le droit le plus ancien', () => {
  const cal = droit({ id: 'cal-1', minutes: 50, source: 'cal', reference: 'uidcal1', depuis: jour(-2) })
  const r = C.resumerCoaching([PACK, cal], [
    seance({ id: 'c1', debut: jour(-2), source: 'cal', droit_id: 'cal-1', duree_min: 50 }),
    seance({ id: 'x1', debut: jour(-1) }),
  ], MAINTENANT)
  const pack = r.lignes.find(l => l.famille === 'pack')
  const unite = r.lignes.find(l => l.famille === 'seances')
  assert.equal(pack.restantes_min, 420, 'x1 prend le pack (le plus ancien)')
  assert.equal(unite.restantes_min, 0, 'c1 prend son droit Cal')
  assert.equal(unite.phrase, '0 h restante sur 50 min avec Brice')
  assert.equal(r.historique.find(x => x.id === 'c1').ligne, 'brice:seances')
  assert.equal(r.historique.find(x => x.id === 'x1').ligne, 'brice:pack:coaching-8h')
  // Un droit_id vers un droit d'un autre coach ne force rien.
  const r2 = C.resumerCoaching([PACK, droit({ id: 'mel', coach: 'melanie' })], [seance({ id: 'y', debut: jour(-1), droit_id: 'mel' })], MAINTENANT)
  assert.equal(r2.lignes.find(l => l.coach === 'brice').restantes_min, 420)
  assert.equal(r2.lignes.find(l => l.coach === 'melanie').restantes_min, 60)
})

await bloc('partage : une seance prend sur deux droits ; le depassement se compte en minutes ; droit retire ignore', () => {
  const vieux = droit({ id: 'v', minutes: 90, source: 'offert', depuis: jour(-40) })
  const r = C.resumerCoaching([PACK, vieux], [seance({ id: 't1', debut: jour(-10) }), seance({ id: 't2', debut: jour(-5) })], MAINTENANT)
  const offert = r.lignes.find(l => l.famille === 'seances')
  const pack = r.lignes.find(l => l.famille === 'pack')
  assert.deepEqual([offert.restantes_min, offert.nb_faites], [0, 2], 't1 (1 h) puis 30 min de t2 sur le droit le plus ancien')
  assert.deepEqual([pack.restantes_min, pack.nb_faites, pack.phrase], [450, 1, '7,5 h restantes sur 8 h avec Brice'], 'les 30 min restantes de t2 sur le pack')
  assert.equal(r.historique.find(x => x.id === 't2').ligne, 'brice:seances', 'a egalite, la ligne la plus ancienne')
  assert.equal(r.hors_droits.brice, 0)

  const plein = C.resumerCoaching([PACK, droit({ id: 'o', minutes: 120, depuis: jour(-40) }), droit({ id: 'retire', minutes: 300, retire_le: jour(-1) })],
    Array.from({ length: 11 }, (_, i) => seance({ id: `s${String(i).padStart(2, '0')}`, debut: jour(-30 + i) })), MAINTENANT)
  assert.equal(plein.lignes.find(l => l.famille === 'seances').restantes_min, 0, 'les 2 premieres heures sur le droit le plus ancien')
  assert.equal(plein.lignes.find(l => l.famille === 'pack').restantes_min, 0)
  assert.deepEqual([plein.hors_droits.brice, plein.hors_droits_min.brice], [1, 60], '11 h pour 10 h de droits')
  const derniere = plein.historique.find(x => x.id === 's10')
  assert.deepEqual([derniere.ligne, derniere.hors_min], [null, 60])
  assert.ok(!plein.lignes.some(l => l.total_min === 300), 'le droit retire ne compte pas')

  const moitie = C.resumerCoaching([droit({ id: 'o', minutes: 90 })], [seance({ id: 'a', debut: jour(-2) }), seance({ id: 'b', debut: jour(-1) })], MAINTENANT)
  const b = moitie.historique.find(x => x.id === 'b')
  assert.deepEqual([b.ligne, b.hors_min], ['brice:seances', 30], 'la moitie de b depasse')
  assert.deepEqual([moitie.hors_droits.brice, moitie.hors_droits_min.brice], [1, 30])
})

await bloc('un coach sans droit : une ligne sans total, en heures ; rien = invisible', () => {
  const r = C.resumerCoaching([], [seance({ id: 'm', coach: 'melanie', debut: jour(-3) }), seance({ id: 'n', coach: 'melanie', debut: jour(3), statut: 'prevue', duree_min: 30 })], MAINTENANT)
  assert.equal(r.lignes.length, 1)
  assert.equal(r.lignes[0].total_min, null)
  assert.equal(r.lignes[0].restantes_min, null)
  assert.equal(r.lignes[0].phrase, '1,5 h de coaching avec Mélanie')
  assert.equal(r.lignes[0].detail, '1 séance faite, 1 prévue')
  assert.deepEqual(r.hors_droits_min, { brice: 0, melanie: 0 }, 'sans droit, ce n est pas un depassement')
  assert.equal(C.resumerCoaching([], [], MAINTENANT).visible, false)
  assert.equal(C.resumerCoaching([], [seance({ id: 'a', statut: 'annulee', debut: jour(1) })], MAINTENANT).visible, false, 'que des annulees')
  assert.equal(C.resumerCoaching([droit({ id: 'r', retire_le: jour(-1) })], [], MAINTENANT).visible, false, 'que des droits retires')
  assert.equal(C.resumerCoaching([PACK], [], MAINTENANT).lignes[0].phrase, '8 h restantes sur 8 h avec Brice')
})

await bloc('reprise : un droit ecrit par l ancien journal (seances seul) se lit en heures', () => {
  const r = C.resumerCoaching([
    droit({ id: 'ancien', minutes: undefined, seances: 3, source: 'etm' }),
    droit({ id: 'ancien2', minutes: null, seances: 2, coach: 'melanie' }),
  ], [seance({ id: 'x', debut: jour(-1), duree_min: 30 })], MAINTENANT)
  assert.deepEqual(r.lignes.map(l => l.phrase), ['2,5 h restantes sur 3 h avec Brice', '2 h restantes sur 2 h avec Mélanie'])
})

await bloc('reste : ETM a part, pack par offre, coach inconnu ignore', () => {
  const r = C.resumerCoaching([
    PACK, droit({ id: 'etm', minutes: 720, source: 'etm' }), droit({ id: 'bizarre', coach: 'adil', minutes: 180 }),
  ], [], MAINTENANT)
  assert.deepEqual(r.lignes.map(l => l.titre), ['Pack 8 h', 'ETM'])
})

await bloc('vueMembre : ni email, ni note, ni identifiant, ni source ; lien du pack ou contact du coach ; heures', () => {
  const r = C.resumerCoaching([
    { ...PACK, email: 'eleve@exemple.fr', note: 'note equipe' },
    droit({ id: 'mel', coach: 'melanie', minutes: 120, email: 'eleve@exemple.fr', note: 'interne' }),
  ], [seance({ id: 'z', debut: jour(2), statut: 'prevue', email: 'eleve@exemple.fr', note: 'secret', source: 'meet' })], MAINTENANT)
  const sans = C.vueMembre(r, {})
  const texte = JSON.stringify(sans)
  for (const interdit of ['eleve@exemple.fr', 'note equipe', 'interne', 'secret', '"id"', 'meet', 'droit_id', 'pose_par', 'hors_min']) {
    assert.ok(!texte.includes(interdit), `fuite : ${interdit}`)
  }
  assert.equal(sans.lignes[0].phrase, '7 h restantes sur 8 h avec Brice')
  assert.equal(sans.lignes[1].phrase, '2 h restantes sur 2 h avec Mélanie')
  assert.deepEqual(sans.lignes[0].reserver, { type: 'contact', coach: 'brice', libelle: 'Écrire à Brice' })
  assert.deepEqual(sans.lignes[1].reserver, { type: 'contact', coach: 'melanie', libelle: 'Écrire à Mélanie' })
  const avec = C.vueMembre(r, { 'coaching-8h': 'https://cal.com/brice-delannay/pack' })
  assert.deepEqual(avec.lignes[0].reserver, { type: 'lien', url: 'https://cal.com/brice-delannay/pack', libelle: 'Réserver une séance' })
  assert.equal(avec.lignes[1].reserver.type, 'contact', 'Melanie reste au contact')
  assert.equal(avec.prochain.coach_nom, 'Brice')
  assert.equal(avec.prochain.statut_libelle, 'Prévue')
  assert.equal(C.vueMembre({ ...r, historique: Array.from({ length: 80 }, () => r.historique[0]) }, {}).historique.length, 60)
})

const SECRET = 'whsec_essai_coaching'
const signe = (corps, secret = SECRET) => createHmac('sha256', secret).update(corps, 'utf8').digest('hex')

await bloc('signature Cal : bonne, mauvais secret, corps modifie, sans secret, en-tete mal forme', () => {
  const corps = JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { uid: 'abc123' } })
  assert.equal(C.verifierSignatureCal(corps, signe(corps), SECRET), true)
  assert.equal(C.verifierSignatureCal(corps, signe(corps).toUpperCase(), SECRET), true, 'hexadecimal en majuscules')
  assert.equal(C.verifierSignatureCal(corps, `sha256=${signe(corps)}`, SECRET), true, 'prefixe sha256=')
  assert.equal(C.verifierSignatureCal(corps, signe(corps, 'autre'), SECRET), false)
  assert.equal(C.verifierSignatureCal(`${corps} `, signe(corps), SECRET), false, 'un espace de plus')
  assert.equal(C.verifierSignatureCal(corps, signe(corps), ''), false, 'secret vide')
  assert.equal(C.verifierSignatureCal(corps, signe(corps), undefined), false, 'secret absent')
  assert.equal(C.verifierSignatureCal(corps, null, SECRET), false)
  assert.equal(C.verifierSignatureCal(corps, 'abc', SECRET), false)
  assert.equal(C.verifierSignatureCal(corps, signe(corps).slice(0, 63) + 'z', SECRET), false)
  assert.equal(C.verifierSignatureCal(corps, Buffer.from(signe(corps), 'hex').toString('base64'), SECRET), false, 'base64 refuse')
})

const TYPES = C.lireTypesSuivis('consultation-coaching, 4242')
const evt = (declencheur, p = {}) => ({
  triggerEvent: declencheur, createdAt: jour(0),
  payload: {
    type: 'consultation-coaching', eventTypeId: 7, uid: 'bk_UID_0001', title: 'Coaching',
    startTime: '2026-11-12T09:00:00Z', endTime: '2026-11-12T09:50:00Z',
    organizer: { email: 'Brice@AOKnowledge.com', name: 'Brice' },
    attendees: [{ email: 'brice@aoknowledge.com' }, { email: '  Eleve.Demo@Exemple.FR ', name: 'Eleve' }],
    price: 25000, currency: 'eur', status: 'ACCEPTED', ...p,
  },
})

await bloc('evenement Cal : creation suivie = seance prevue, invite rattache par son email (pas l organisateur)', () => {
  const e = C.lireEvenementCal(evt('BOOKING_CREATED'), TYPES)
  assert.deepEqual(e, {
    geste: 'poser', declencheur: 'BOOKING_CREATED', uid: 'bk_UID_0001', ancienUid: null, email: 'eleve.demo@exemple.fr',
    debut: '2026-11-12T09:00:00.000Z', duree_min: 50, type: 'consultation-coaching', paye: false,
  })
  assert.equal(C.lireEvenementCal(evt('BOOKING_PAID', { paymentId: 91 }), TYPES).paye, true)
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED', { paid: true }), TYPES).paye, true)
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED', { payment: [{ success: true }] }), TYPES).paye, true)
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED', { payment: [{ success: false }] }), TYPES).paye, false, 'paiement echoue')
  const rep = C.lireEvenementCal(evt('BOOKING_RESCHEDULED', { uid: 'bk_UID_0002', rescheduleUid: 'bk_UID_0001' }), TYPES)
  assert.equal(rep.geste, 'poser')
  assert.equal(rep.ancienUid, 'bk_UID_0001')
  assert.equal(C.lireEvenementCal(evt('BOOKING_RESCHEDULED', { rescheduleUid: 'bk_UID_0001' }), TYPES).ancienUid, null, 'meme uid')
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED', { type: 'autre', eventTypeId: 4242 }), TYPES).geste, 'poser', 'suivi par son id')
})

await bloc('evenement Cal : type non suivi, aucune liste, annulation (toujours, meme tardive), ping, corps plat, champs manquants', () => {
  assert.deepEqual(C.lireEvenementCal(evt('BOOKING_CREATED', { type: 'appel-decouverte' }), TYPES),
    { geste: 'ignorer', raison: 'type', declencheur: 'BOOKING_CREATED' })
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED'), new Set()).raison, 'types_non_regles', 'sans liste, rien ne se pose')
  assert.deepEqual(C.lireEvenementCal(evt('BOOKING_CANCELLED'), new Set()),
    { geste: 'annuler', declencheur: 'BOOKING_CANCELLED', uid: 'bk_UID_0001' }, 'l annulation passe toujours')
  // Une annulation de derniere minute (5 min avant) s'annule pareil : aucune regle de delai.
  assert.equal(C.lireEvenementCal({ ...evt('BOOKING_CANCELLED'), createdAt: '2026-11-12T08:55:00Z' }, TYPES).geste, 'annuler')
  assert.equal(C.lireEvenementCal(evt('BOOKING_REJECTED'), TYPES).geste, 'annuler')
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED', { status: 'CANCELLED' }), TYPES).geste, 'annuler')
  assert.equal(C.lireEvenementCal(evt('BOOKING_REQUESTED'), TYPES).raison, 'declencheur')
  assert.equal(C.lireEvenementCal({ triggerEvent: 'PING', payload: {} }, TYPES).raison, 'declencheur')
  assert.equal(C.lireEvenementCal({ triggerEvent: 'MEETING_ENDED', uid: 'x' }, TYPES).raison, 'corps')
  assert.equal(C.lireEvenementCal(null, TYPES).raison, 'corps')
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED', { uid: 'x;drop' }), TYPES).raison, 'uid')
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED', { attendees: [{ email: 'brice@aoknowledge.com' }] }), TYPES).raison, 'email')
  const parReponses = C.lireEvenementCal(evt('BOOKING_CREATED', { attendees: [], responses: { email: { value: 'Autre@Exemple.fr' } } }), TYPES)
  assert.equal(parReponses.email, 'autre@exemple.fr', 'repli sur le champ email du formulaire')
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED', { startTime: 'demain' }), TYPES).raison, 'date')
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED', { endTime: '2026-11-12T09:02:00Z' }), TYPES).raison, 'duree')
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED', { endTime: undefined, length: 60 }), TYPES).duree_min, 60)
})

await bloc('rattachement : email normalise, un seul compte sinon aucun ; types suivis', () => {
  assert.equal(C.normaliserEmail('  A.B@Exemple.FR '), 'a.b@exemple.fr')
  assert.equal(C.normaliserEmail('pas un email'), null)
  assert.equal(C.normaliserEmail('a@b'), null)
  assert.equal(C.normaliserEmail(42), null)
  assert.equal(C.compteUnique(['u1']), 'u1')
  assert.equal(C.compteUnique(['u1', 'u1']), 'u1')
  assert.equal(C.compteUnique(['u1', 'u2']), null, 'deux comptes : on garde l email seul')
  assert.equal(C.compteUnique([]), null)
  assert.deepEqual([...C.lireTypesSuivis(' A, b  c,,')], ['a', 'b', 'c'])
  assert.equal(C.lireTypesSuivis(undefined).size, 0)
  // La meme regle d'identite que les achats : le texte SQL est une copie exacte.
  const extraire = (texte, nom) => texte.match(new RegExp(`export const ${nom} = \`([\\s\\S]*?)\``))?.[1]
  const achats = extraire(lire('../src/lib/academie/requetes.ts'), 'SQL_COMPTES_DE_EMAIL')
  const coaching = extraire(lire('../src/lib/coaching/base.ts'), 'SQL_COMPTES_DE_EMAIL')
  assert.ok(achats && coaching)
  assert.equal(coaching, achats, 'SQL_COMPTES_DE_EMAIL a diverge')
})

await bloc('regroupement par personne : une fiche reunit ses emails, sinon par email', () => {
  const p = C.regrouperParPersonne(
    [{ ...PACK, email: 'a@exemple.fr' }, droit({ id: 'm', coach: 'melanie', email: 'b@exemple.fr' })],
    [seance({ id: 's', debut: jour(-1), email: 'A2@exemple.fr' }), seance({ id: 't', debut: jour(-2), email: 'c@exemple.fr' }), seance({ id: 'v', debut: jour(-2), email: null })],
    [{ email: 'a@exemple.fr', membre_id: 'f1', nom: 'Alice' }, { email: 'a2@exemple.fr', membre_id: 'f1', nom: 'Alice' }],
    MAINTENANT,
  )
  assert.equal(p.length, 3)
  const alice = p.find(x => x.membre_id === 'f1')
  assert.deepEqual(alice.emails, ['a2@exemple.fr', 'a@exemple.fr'])
  assert.equal(alice.resume.lignes[0].restantes_min, 420)
  assert.equal(p[0].cle, 'membre:f1', 'la plus recemment active d abord')
  assert.ok(p.some(x => x.cle === 'email:c@exemple.fr'))
})

await bloc('gestes du cockpit : corps verifies, droits en minutes (et l ancien ecran en seances)', () => {
  const D = C.lireDemandeCockpit
  assert.deepEqual(D({ action: 'lister' }), { action: 'lister' })
  assert.deepEqual(D({ action: 'fiche', emails: ['A@x.fr', 'a@x.fr'] }), { action: 'fiche', emails: ['a@x.fr'] })
  assert.equal(D({ action: 'fiche', emails: [] }).erreur, 'emails')
  assert.equal(D({ action: 'fiche', emails: ['x'] }).erreur, 'emails')
  const ok = D({ action: 'ajouter_seance', email: 'E@x.fr', coach: 'melanie', debut: '2026-11-08T14:00:00Z', duree_min: 30, note: '  Premiere  seance ' })
  assert.deepEqual(ok, { action: 'ajouter_seance', email: 'e@x.fr', coach: 'melanie', debut: '2026-11-08T14:00:00.000Z', duree_min: 30, statut: 'faite', note: 'Premiere seance' })
  assert.equal(D({ ...ok, coach: 'adil' }).erreur, 'coach')
  assert.equal(D({ ...ok, debut: '2019-01-01T00:00:00Z' }).erreur, 'date')
  assert.equal(D({ ...ok, duree_min: 4 }).erreur, 'duree')
  assert.equal(D({ ...ok, duree_min: 60.5 }).erreur, 'duree')
  assert.equal(D({ ...ok, statut: 'annulee' }).erreur, 'statut')
  assert.equal(D({ ...ok, note: 'x'.repeat(501) }).erreur, 'note')
  const id = '0b5f1c2e-4d3a-4b2c-9e8f-1a2b3c4d5e6f'
  assert.deepEqual(D({ action: 'statut_seance', id, statut: 'annulee' }), { action: 'statut_seance', id, statut: 'annulee' })
  assert.equal(D({ action: 'statut_seance', id: 'x', statut: 'faite' }).erreur, 'id')
  const etm = { action: 'accorder_droit', email: 'e@x.fr', coach: 'brice', minutes: 720, source: 'etm' }
  assert.deepEqual(D(etm), { action: 'accorder_droit', email: 'e@x.fr', coach: 'brice', minutes: 720, source: 'etm', depuis: null, note: null })
  assert.equal(D({ ...etm, minutes: 390 }).minutes, 390, '6,5 h')
  assert.equal(D({ ...etm, minutes: 15 }).minutes, 15)
  for (const m of [0, 10, 20, 6015, 90.5, '720', null]) assert.equal(D({ ...etm, minutes: m }).erreur, 'heures', String(m))
  const ancien = { action: 'accorder_droit', email: 'e@x.fr', coach: 'brice', seances: 3, source: 'offert' }
  assert.equal(D(ancien).minutes, 180, 'l ancien ecran envoie des seances : 3 h')
  assert.equal(D({ ...ancien, seances: 0 }).erreur, 'heures')
  assert.equal(D({ ...ancien, seances: 101 }).erreur, 'heures')
  assert.equal(D({ action: 'accorder_droit', email: 'e@x.fr', coach: 'brice', source: 'offert' }).erreur, 'heures', 'sans quantite')
  assert.equal(D({ ...ancien, source: 'pack' }).erreur, 'source', 'un pack ne se pose pas ici')
  assert.deepEqual(D({ action: 'corriger_droit', id, minutes: 600, note: 'Rythme revu' }), { action: 'corriger_droit', id, minutes: 600, note: 'Rythme revu' })
  assert.equal(D({ action: 'corriger_droit', id, minutes: 6001 }).erreur, 'heures')
  assert.equal(D({ action: 'corriger_droit', id, seances: 2 }).minutes, 120)
  assert.equal(D({ action: 'confirmer_detection', id, email: 'e@x.fr' }).coach, 'brice')
  assert.equal(D({ action: 'retirer_droit', id }).action, 'retirer_droit')
  assert.equal(D({ action: 'supprimer', id }).erreur, 'action')
  assert.equal(D(null).erreur, 'action')
})

/** Les ordres d'une migration, comme appliquer-migration.sh : coupes sur les points-virgules, commentaires retires. */
const sansCommentaires = sql => sql.split('\n').filter(x => !x.trim().startsWith('--')).join('\n')

await bloc('migration des seances : quatre tables sous RLS forcee, lecture seule pour authenticated, detections a l equipe', () => {
  const sql = readFileSync(cheminMigration(MIGRATION), 'utf8')
  for (const t of ['coaching_packs', 'coaching_droits', 'coaching_seances', 'coaching_detections']) {
    assert.ok(sql.includes(`alter table public.${t} enable row level security`), t)
    assert.ok(sql.includes(`alter table public.${t} force row level security`), t)
  }
  assert.ok(!/grant[^;]*(insert|update|delete)[^;]*to authenticated/i.test(sql), 'aucune ecriture pour authenticated')
  assert.ok(/grant select, insert on public\.coaching_detections to service_role/.test(sql))
  assert.ok(!/grant[^;]*(insert|update|delete)[^;]*coaching_(droits|seances)[^;]*service_role/i.test(sql), 'le script Meet ne pose jamais une seance')
  const detections = sql.match(/create policy (\w+) on public\.coaching_detections[^;]*/g) ?? []
  assert.equal(detections.length, 1)
  assert.ok(detections[0].includes('is_cockpit_member()'), 'un membre ne lit jamais une detection')
  for (const l of sql.split('\n').filter(x => x.trim().startsWith('--'))) assert.ok(!l.includes(';'), `point-virgule en commentaire : ${l}`)
  assert.ok(sql.includes('with (security_invoker = true)'))
  assert.ok(sql.includes("values ('coaching-8h', 'brice', 8, 60, 'Pack 8 h')"))
})

await bloc('migration des heures : minutes reprises, seances facultative, vue aux memes colonnes plus minutes, aucun droit nouveau', () => {
  const sql = readFileSync(cheminMigration(MIGRATION_HEURES), 'utf8')
  for (const l of sql.split('\n').filter(x => x.trim().startsWith('--'))) assert.ok(!l.includes(';'), `point-virgule en commentaire : ${l}`)
  const corps = sansCommentaires(sql)
  // Un point-virgule seulement en fin d'ordre (fin de ligne), jamais dans une chaine.
  for (const m of corps.matchAll(/;/g)) assert.ok(corps[m.index + 1] === '\n' || m.index === corps.length - 1, `point-virgule au milieu d un ordre : ${corps.slice(m.index - 40, m.index + 10)}`)
  for (const ch of corps.match(/'[^']*'/g) ?? []) assert.ok(!ch.includes(';'), ch)
  assert.ok(corps.includes('alter table public.coaching_droits add column if not exists minutes integer'))
  assert.ok(corps.includes('update public.coaching_droits set minutes = seances * 60\n where minutes is null and seances is not null'), 'reprise des lignes deja en base')
  assert.ok(corps.includes('alter table public.coaching_droits alter column seances drop not null'), 'l ancien journal ecrit encore seances seul')
  assert.ok(/check \(minutes is not null or seances is not null\)/.test(corps))
  assert.ok(/check \(minutes is null or minutes between 5 and 6000\)/.test(corps))
  assert.ok(corps.includes('update public.coaching_packs set minutes = seances * duree_min where minutes is null'), 'le pack 8 h donne 8 h')
  assert.ok(corps.includes('alter table public.coaching_packs alter column minutes set not null'))
  // La vue : memes colonnes, meme ordre, minutes a la fin (create or replace view ne permet rien d'autre).
  const vue = corps.match(/create or replace view public\.coaching_droits_tous with \(security_invoker = true\) as\n([\s\S]*?)\n\s*from public\.coaching_droits d/)?.[1]
  assert.ok(vue, 'vue introuvable')
  // Les colonnes, coupees sur les virgules hors parentheses (coalesce(a, b) reste entier).
  const morceaux = []
  let profondeur = 0
  let courant = ''
  for (const ch of vue.replace(/^select /, '')) {
    if (ch === '(') profondeur++
    if (ch === ')') profondeur--
    if (ch === ',' && profondeur === 0) { morceaux.push(courant); courant = '' } else courant += ch
  }
  morceaux.push(courant)
  const colonnes = morceaux.map(x => x.trim().split(/\s+as\s+/).pop().replace(/^d\./, ''))
  assert.deepEqual(colonnes.slice(0, 13), ['id', 'email', 'user_id', 'coach', 'seances', 'source', 'reference', 'libelle', 'depuis', 'note', 'pose_par', 'retire_le', 'derive'])
  assert.equal(colonnes[13], 'minutes')
  assert.equal(colonnes.length, 14)
  assert.ok(corps.includes('coalesce(d.minutes, d.seances * 60) as minutes'))
  assert.ok(corps.includes('p.minutes\n  from public.academie_acces a'))
  assert.ok(!/grant[^;]*to[^;]*anon/i.test(corps), 'rien pour anon')
  assert.ok(!/grant[^;]*(insert|update|delete)/i.test(corps), 'aucune ecriture nouvelle')
  assert.ok(corps.includes('grant select on public.coaching_droits_tous to authenticated, service_role'))
})

await bloc('routes : webhook public mais refuse sans secret, aucun email dans les journaux, droits en minutes', () => {
  const mw = lire('../middleware.ts')
  assert.ok(mw.includes("'/api/coaching/cal'"))
  const cal = lire('../src/app/api/coaching/cal/route.ts')
  assert.ok(cal.indexOf('CAL_WEBHOOK_SECRET') < cal.indexOf('req.text()'), 'le secret se verifie avant de lire le corps')
  assert.ok(/status: 503/.test(cal))
  for (const f of ['../src/app/api/coaching/cal/route.ts', '../src/app/api/cockpit/coaching/route.ts', '../src/app/api/compte/coaching/route.ts']) {
    const code = lire(f)
    for (const ligne of code.split('\n').filter(x => /console\.(info|warn|error|log)/.test(x))) {
      assert.ok(!/\.email|\.note|\.nom\b|corps\)/.test(ligne), `${f} : ${ligne.trim()}`)
    }
  }
  const compte = lire('../src/app/api/compte/coaching/route.ts')
  assert.ok(compte.includes('vueMembre('), 'le membre ne recoit que la vue filtree')
  const cockpit = lire('../src/app/api/cockpit/coaching/route.ts')
  assert.ok(cockpit.includes('corrigerDroit(prisma, d.id, d.minutes, d.note)'))
  assert.ok(!/d\.seances/.test(cockpit), 'plus aucune quantite en seances')
  const base = lire('../src/lib/coaching/base.ts')
  assert.ok(/insert into public\.coaching_droits \(email, user_id, coach, minutes, source, depuis, note, pose_par\)/.test(base))
  assert.ok(/insert into public\.coaching_droits \(email, user_id, coach, minutes, source, reference, pose_par, note\)/.test(base), 'heure Cal : la duree du rendez-vous')
  assert.ok(base.includes('set minutes = $2::int, seances = null'))
})

console.log(`\n${blocs} blocs ok`)
