// Verification HORS LIGNE de Mon coaching (09/11/2026) : le CALCUL DU RESTE
// (resumerCoaching), ce que voit le membre (vueMembre), le webhook de Cal (la
// SIGNATURE, la lecture d'un evenement, le RATTACHEMENT par l'email de
// l'invite), le regroupement par personne du cockpit, le corps des gestes du
// cockpit, la migration et le code des routes (lus comme des fichiers).
// Fonctions pures et lecture de fichiers : aucune base, aucun reseau.
//
// Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
//   node scripts/verifier-coaching.mjs
// Contre la base (transaction annulee) : scripts/essayer-migration-coaching.mjs.

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
function cheminMigration() {
  const candidats = [
    process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${MIGRATION}`) : null,
    new URL(`../../../${MIGRATION}`, import.meta.url),
  ].filter(Boolean)
  const trouve = candidats.find(u => existsSync(u))
  if (!trouve) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${MIGRATION})`)
  return trouve
}

// Tiret demi-cadratin et cadratin.
const TIRETS = /[–—]/
const J = 24 * 3600 * 1000
const MAINTENANT = Date.UTC(2026, 10, 9, 12, 0, 0)
const jour = n => new Date(MAINTENANT + n * J).toISOString()
const droit = o => ({ coach: 'brice', seances: 1, source: 'offert', reference: null, libelle: null, depuis: jour(-30), retire_le: null, ...o })
const seance = o => ({ coach: 'brice', duree_min: 60, statut: 'faite', source: 'cockpit', droit_id: null, ...o })
const PACK = droit({ id: 'pack-1', seances: 8, source: 'pack', reference: 'coaching-8h', libelle: 'Pack 8 h', depuis: jour(-20) })

await bloc('phrases : singulier a 0 et 1, pluriel au-dela, pas de tiret cadratin', () => {
  assert.equal(C.phraseReste(5, 8, 'brice'), '5 séances restantes sur 8 avec Brice')
  assert.equal(C.phraseReste(1, 8, 'brice'), '1 séance restante sur 8 avec Brice')
  assert.equal(C.phraseReste(0, 8, 'melanie'), '0 séance restante sur 8 avec Mélanie')
  assert.equal(C.detailSeances(2, 1), '2 faites, 1 prévue')
  assert.equal(C.detailSeances(1, 0), '1 faite')
  assert.equal(C.detailSeances(0, 0), "aucune séance pour l'instant")
  for (const t of [...Object.values(C.LIBELLE_STATUT), ...Object.values(C.TEXTE_ERREUR), ...Object.values(C.NOM_COACH)]) assert.ok(!TIRETS.test(t), t)
})

await bloc('reste : un pack entame (2 faites, 1 prevue, 1 annulee) = 5 sur 8, prochain rendez-vous, passee', () => {
  const r = C.resumerCoaching([PACK], [
    seance({ id: 's1', debut: jour(-10) }),
    seance({ id: 's2', debut: jour(-3) }),
    seance({ id: 's3', debut: jour(-1), statut: 'annulee' }),
    seance({ id: 's4', debut: jour(4), statut: 'prevue', source: 'cal' }),
  ], MAINTENANT)
  assert.equal(r.visible, true)
  assert.equal(r.lignes.length, 1)
  const [l] = r.lignes
  assert.deepEqual([l.total, l.faites, l.prevues, l.restantes], [8, 2, 1, 5])
  assert.equal(l.phrase, '5 séances restantes sur 8 avec Brice')
  assert.equal(l.titre, 'Pack 8 h')
  assert.equal(l.famille, 'pack')
  assert.equal(l.pack, 'coaching-8h')
  assert.equal(r.prochain.id, 's4')
  assert.deepEqual(r.historique.map(x => x.id), ['s4', 's3', 's2', 's1'], 'la plus recente d abord')
  assert.equal(r.historique.find(x => x.id === 's3').statut_affiche, 'annulee')
  assert.equal(r.historique.find(x => x.id === 's3').ligne, null)
  const passee = C.resumerCoaching([PACK], [seance({ id: 'p', debut: jour(-2), statut: 'prevue' })], MAINTENANT)
  assert.equal(passee.historique[0].statut_affiche, 'passee', 'une prevue dans le passe se lit « Passée »')
  assert.equal(passee.lignes[0].restantes, 7, 'et elle compte')
  assert.equal(passee.prochain, null)
})

await bloc('reste : deux coachs, une ligne chacun, Brice d abord', () => {
  const r = C.resumerCoaching([
    PACK,
    droit({ id: 'mel-1', coach: 'melanie', seances: 3, source: 'offert', depuis: jour(-15) }),
  ], [
    seance({ id: 'b1', debut: jour(-5) }),
    seance({ id: 'm1', coach: 'melanie', debut: jour(-4) }),
    seance({ id: 'm2', coach: 'melanie', debut: jour(2), statut: 'prevue' }),
  ], MAINTENANT)
  assert.deepEqual(r.lignes.map(l => l.phrase), ['7 séances restantes sur 8 avec Brice', '1 séance restante sur 3 avec Mélanie'])
  assert.deepEqual(r.lignes.map(l => l.titre), ['Pack 8 h', 'Séances'])
  assert.equal(r.prochain.id, 'm2')
  assert.deepEqual(r.hors_droits, { brice: 0, melanie: 0 })
})

await bloc('reste : une heure payee sur Cal consomme SON droit, les autres le droit le plus ancien', () => {
  const cal = droit({ id: 'cal-1', source: 'cal', reference: 'uidcal1', depuis: jour(-2) })
  const r = C.resumerCoaching([PACK, cal], [
    seance({ id: 'c1', debut: jour(-2), source: 'cal', droit_id: 'cal-1' }),
    seance({ id: 'x1', debut: jour(-1) }),
  ], MAINTENANT)
  const pack = r.lignes.find(l => l.famille === 'pack')
  const unite = r.lignes.find(l => l.famille === 'seances')
  assert.equal(pack.restantes, 7, 'x1 prend le pack (le plus ancien)')
  assert.equal(unite.restantes, 0, 'c1 prend son droit Cal')
  assert.equal(unite.phrase, '0 séance restante sur 1 avec Brice')
  assert.equal(r.historique.find(x => x.id === 'c1').ligne, 'brice:seances')
  assert.equal(r.historique.find(x => x.id === 'x1').ligne, 'brice:pack:coaching-8h')
  // Un droit_id vers un droit d'un autre coach ou plein ne force rien.
  const r2 = C.resumerCoaching([PACK, droit({ id: 'mel', coach: 'melanie' })], [seance({ id: 'y', debut: jour(-1), droit_id: 'mel' })], MAINTENANT)
  assert.equal(r2.lignes.find(l => l.coach === 'brice').restantes, 7)
  assert.equal(r2.lignes.find(l => l.coach === 'melanie').restantes, 1)
})

await bloc('reste : premier arrive premier servi, depassement = hors droits, droit retire ignore', () => {
  const vieux = droit({ id: 'v', seances: 2, source: 'offert', depuis: jour(-40) })
  const r = C.resumerCoaching([PACK, vieux, droit({ id: 'retire', seances: 5, retire_le: jour(-1) })], [
    ...Array.from({ length: 11 }, (_, i) => seance({ id: `s${String(i).padStart(2, '0')}`, debut: jour(-30 + i) })),
  ], MAINTENANT)
  assert.equal(r.lignes.find(l => l.famille === 'seances').restantes, 0, 'les 2 premieres sur le droit le plus ancien')
  assert.equal(r.lignes.find(l => l.famille === 'pack').restantes, 0)
  assert.equal(r.hors_droits.brice, 1, '11 seances pour 10 places')
  assert.ok(!r.lignes.some(l => l.total === 5), 'le droit retire ne compte pas')
})

await bloc('reste : un coach sans droit mais avec des seances, une ligne sans total ; rien = invisible', () => {
  const r = C.resumerCoaching([], [seance({ id: 'm', coach: 'melanie', debut: jour(-3) }), seance({ id: 'n', coach: 'melanie', debut: jour(3), statut: 'prevue' })], MAINTENANT)
  assert.equal(r.lignes.length, 1)
  assert.equal(r.lignes[0].total, null)
  assert.equal(r.lignes[0].phrase, '2 séances avec Mélanie')
  assert.equal(r.lignes[0].detail, '1 faite, 1 prévue')
  assert.equal(C.resumerCoaching([], [], MAINTENANT).visible, false)
  assert.equal(C.resumerCoaching([], [seance({ id: 'a', statut: 'annulee', debut: jour(1) })], MAINTENANT).visible, false, 'que des annulees')
  assert.equal(C.resumerCoaching([droit({ id: 'r', retire_le: jour(-1) })], [], MAINTENANT).visible, false, 'que des droits retires')
  assert.equal(C.resumerCoaching([PACK], [], MAINTENANT).lignes[0].phrase, '8 séances restantes sur 8 avec Brice')
})

await bloc('reste : ETM a part, pack par offre, coach inconnu ignore', () => {
  const r = C.resumerCoaching([
    PACK, droit({ id: 'etm', seances: 6, source: 'etm' }), droit({ id: 'bizarre', coach: 'adil', seances: 3 }),
  ], [], MAINTENANT)
  assert.deepEqual(r.lignes.map(l => l.titre), ['Pack 8 h', 'ETM'])
})

await bloc('vueMembre : ni email, ni note, ni identifiant, ni source ; lien du pack ou contact du coach', () => {
  const r = C.resumerCoaching([
    { ...PACK, email: 'eleve@exemple.fr', note: 'note equipe' },
    droit({ id: 'mel', coach: 'melanie', seances: 2, email: 'eleve@exemple.fr', note: 'interne' }),
  ], [seance({ id: 'z', debut: jour(2), statut: 'prevue', email: 'eleve@exemple.fr', note: 'secret', source: 'meet' })], MAINTENANT)
  const sans = C.vueMembre(r, {})
  const texte = JSON.stringify(sans)
  for (const interdit of ['eleve@exemple.fr', 'note equipe', 'interne', 'secret', '"id"', 'meet', 'droit_id', 'pose_par']) {
    assert.ok(!texte.includes(interdit), `fuite : ${interdit}`)
  }
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

await bloc('evenement Cal : type non suivi, aucune liste, annulation, ping, corps plat, champs manquants', () => {
  assert.deepEqual(C.lireEvenementCal(evt('BOOKING_CREATED', { type: 'appel-decouverte' }), TYPES),
    { geste: 'ignorer', raison: 'type', declencheur: 'BOOKING_CREATED' })
  assert.equal(C.lireEvenementCal(evt('BOOKING_CREATED'), new Set()).raison, 'types_non_regles', 'sans liste, rien ne se pose')
  assert.deepEqual(C.lireEvenementCal(evt('BOOKING_CANCELLED'), new Set()),
    { geste: 'annuler', declencheur: 'BOOKING_CANCELLED', uid: 'bk_UID_0001' }, 'l annulation passe toujours')
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
  assert.equal(alice.resume.lignes[0].restantes, 7)
  assert.equal(p[0].cle, 'membre:f1', 'la plus recemment active d abord')
  assert.ok(p.some(x => x.cle === 'email:c@exemple.fr'))
})

await bloc('gestes du cockpit : corps verifies', () => {
  const D = C.lireDemandeCockpit
  assert.deepEqual(D({ action: 'lister' }), { action: 'lister' })
  assert.deepEqual(D({ action: 'fiche', emails: ['A@x.fr', 'a@x.fr'] }), { action: 'fiche', emails: ['a@x.fr'] })
  assert.equal(D({ action: 'fiche', emails: [] }).erreur, 'emails')
  assert.equal(D({ action: 'fiche', emails: ['x'] }).erreur, 'emails')
  const ok = D({ action: 'ajouter_seance', email: 'E@x.fr', coach: 'melanie', debut: '2026-11-08T14:00:00Z', duree_min: 60, note: '  Premiere  seance ' })
  assert.deepEqual(ok, { action: 'ajouter_seance', email: 'e@x.fr', coach: 'melanie', debut: '2026-11-08T14:00:00.000Z', duree_min: 60, statut: 'faite', note: 'Premiere seance' })
  assert.equal(D({ ...ok, coach: 'adil' }).erreur, 'coach')
  assert.equal(D({ ...ok, debut: '2019-01-01T00:00:00Z' }).erreur, 'date')
  assert.equal(D({ ...ok, duree_min: 4 }).erreur, 'duree')
  assert.equal(D({ ...ok, duree_min: 60.5 }).erreur, 'duree')
  assert.equal(D({ ...ok, statut: 'annulee' }).erreur, 'statut')
  assert.equal(D({ ...ok, note: 'x'.repeat(501) }).erreur, 'note')
  const id = '0b5f1c2e-4d3a-4b2c-9e8f-1a2b3c4d5e6f'
  assert.deepEqual(D({ action: 'statut_seance', id, statut: 'annulee' }), { action: 'statut_seance', id, statut: 'annulee' })
  assert.equal(D({ action: 'statut_seance', id: 'x', statut: 'faite' }).erreur, 'id')
  assert.equal(D({ action: 'accorder_droit', email: 'e@x.fr', coach: 'brice', seances: 3, source: 'pack' }).erreur, 'source', 'un pack ne se pose pas ici')
  assert.equal(D({ action: 'accorder_droit', email: 'e@x.fr', coach: 'brice', seances: 0, source: 'offert' }).erreur, 'seances')
  assert.equal(D({ action: 'accorder_droit', email: 'e@x.fr', coach: 'brice', seances: 6, source: 'etm' }).source, 'etm')
  assert.equal(D({ action: 'corriger_droit', id, seances: 101 }).erreur, 'seances')
  assert.equal(D({ action: 'confirmer_detection', id, email: 'e@x.fr' }).coach, 'brice')
  assert.equal(D({ action: 'retirer_droit', id }).action, 'retirer_droit')
  assert.equal(D({ action: 'supprimer', id }).erreur, 'action')
  assert.equal(D(null).erreur, 'action')
})

await bloc('migration : quatre tables sous RLS forcee, lecture seule pour authenticated, detections a l equipe, rien dans les commentaires', () => {
  const sql = readFileSync(cheminMigration(), 'utf8')
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

await bloc('routes : webhook public mais refuse sans secret, aucun email dans les journaux', () => {
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
})

console.log(`\n${blocs} blocs ok`)
