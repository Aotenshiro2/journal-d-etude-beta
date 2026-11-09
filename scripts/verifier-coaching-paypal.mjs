// Verifie les regles pures du coaching de 8 h vendu par le tunnel PayPal du
// 10% Club (src/lib/academie/club-paypal-pur.ts, 08/11/2026), hors ligne,
// sans PayPal ni base : le choix de l'offre, le rattachement de l'acheteur,
// le prix, la commande relue, l'email et l'alerte de l'equipe.
//
//   node scripts/verifier-coaching-paypal.mjs
//   MIGRATIONS_DIR=<...>/sites/Aoknowledgecom/supabase/migrations node scripts/verifier-coaching-paypal.mjs
//
// Node 22 retire les types tout seul : le .ts est importe tel quel.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  OFFRES_PAYPAL, OFFRE_CLUB, OFFRE_COACHING, URL_RESERVATION_COACHING,
  corpsCommande, htmlEmailClub, lienReservation, lireCommande, modeleEmailClub, modeleEmailCoaching, montantAttendu,
  montantConforme, noteAcces, offreDeReference, offrePayPal, prixCommande, requeteCapture, texteAlerteCoaching,
  texteAlerteEnAttente, texteAlerteNonNote, texteEmailClub, titulaireDe,
} from '../src/lib/academie/club-paypal-pur.ts'
import { SQL_MEMBRE_OFFRE, SQL_POSER_ACHAT_PAYPAL } from '../src/lib/academie/requetes.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

const UUID = '11111111-2222-3333-4444-555555555555'
// Tirets longs, points de suspension, guillemets courbes, espaces insecables.
const TYPO = /[–—…“”‘’  ]/

bloc('choix de l offre : rien = le Club (pages d avant), club, coaching, le reste refuse', () => {
  assert.equal(offrePayPal(undefined), OFFRES_PAYPAL.club)
  assert.equal(offrePayPal(null), OFFRES_PAYPAL.club)
  assert.equal(offrePayPal('club'), OFFRES_PAYPAL.club)
  assert.equal(offrePayPal('coaching'), OFFRES_PAYPAL.coaching)
  for (const x of ['', 'Coaching', 'coaching-8h', 'formation-complete', 1, {}, []]) assert.equal(offrePayPal(x), null, String(x))
  assert.equal(OFFRES_PAYPAL.club.slug, OFFRE_CLUB)
  assert.equal(OFFRES_PAYPAL.coaching.slug, OFFRE_COACHING)
  assert.equal(OFFRE_COACHING, 'coaching-8h')
  assert.equal(OFFRES_PAYPAL.club.renonciation, true, 'le Club garde sa case de renonciation')
  assert.equal(OFFRES_PAYPAL.coaching.renonciation, false, 'le coaching se livre en seances : pas de case')
  assert.equal(OFFRES_PAYPAL.coaching.prixDefautEur, null, 'le coaching ne se vend pas sans son offre en base')
  for (const o of Object.values(OFFRES_PAYPAL)) assert.ok(o.description.length <= 127, o.cle)
})

bloc('reference_id : chaque offre a la sienne, essai compris, et la relit', () => {
  const refs = Object.values(OFFRES_PAYPAL).flatMap(o => [o.reference, o.referenceEssai])
  assert.equal(new Set(refs).size, refs.length, 'aucune reference partagee')
  assert.deepEqual(offreDeReference('club-10'), { offre: OFFRES_PAYPAL.club, essai: false })
  assert.deepEqual(offreDeReference('club-10-essai'), { offre: OFFRES_PAYPAL.club, essai: true })
  assert.deepEqual(offreDeReference('coaching-8h'), { offre: OFFRES_PAYPAL.coaching, essai: false })
  assert.deepEqual(offreDeReference('coaching-8h-essai'), { offre: OFFRES_PAYPAL.coaching, essai: true })
  for (const x of ['autre', '', null, 'CLUB-10', 'coaching']) assert.equal(offreDeReference(x), null, String(x))
})

bloc('rattachement de l acheteur : le compte du jeton d abord, sinon l email de l achat du Club', () => {
  assert.deepEqual(titulaireDe({ userId: UUID.toUpperCase(), email: 'autre@exemple.fr' }), { userId: UUID }, 'connecte : l email du corps est ignore')
  assert.deepEqual(titulaireDe({ userId: null, email: '  Eleve@Exemple.FR ' }), { email: 'eleve@exemple.fr' })
  assert.equal(titulaireDe({ userId: null, email: 'pas-un-email' }), null)
  assert.equal(titulaireDe({ userId: null, email: undefined }), null)
  assert.deepEqual(titulaireDe({ userId: 'pas-un-uuid', email: 'eleve@exemple.fr' }), { email: 'eleve@exemple.fr' })
  // Le meme titulaire part en custom_id, quelle que soit l'offre : le coaching se rattache comme le Club.
  const club = corpsCommande({ titulaire: { email: 'eleve@exemple.fr' }, montantEur: 1999, essai: false })
  const coaching = corpsCommande({ titulaire: { email: 'eleve@exemple.fr' }, montantEur: 1000, essai: false, offre: OFFRES_PAYPAL.coaching })
  assert.equal(club.purchase_units[0].custom_id, coaching.purchase_units[0].custom_id)
})

bloc('prix : le coaching exige son offre en base (essai compris), le Club garde son 1 999 a defaut', () => {
  const coaching = OFFRES_PAYPAL.coaching
  assert.deepEqual(prixCommande({ offre: coaching, essai: false, ligne: { prix: 1000 } }), { ok: true, montantEur: 1000 })
  assert.deepEqual(prixCommande({ offre: coaching, essai: true, ligne: { prix: 1000 } }), { ok: true, montantEur: 1 })
  assert.deepEqual(prixCommande({ offre: coaching, essai: false, ligne: null }), { ok: false }, 'migration pas appliquee')
  assert.deepEqual(prixCommande({ offre: coaching, essai: true, ligne: null }), { ok: false }, 'meme l essai : l achat ne pourrait pas etre note')
  assert.deepEqual(prixCommande({ offre: coaching, essai: false, ligne: { prix: null } }), { ok: false }, 'offre sans prix')
  assert.deepEqual(prixCommande({ offre: OFFRES_PAYPAL.club, essai: false, ligne: null }), { ok: true, montantEur: 1999 })
  assert.deepEqual(prixCommande({ offre: OFFRES_PAYPAL.club, essai: true, ligne: undefined }), { ok: true, montantEur: 1 })
  assert.equal(montantAttendu({ essai: false, prixBase: null, offre: coaching }), null)
  assert.equal(montantAttendu({ essai: false, prixBase: null }), 1999, 'sans offre : le Club, comme avant')
})

bloc('commande du coaching : sa reference, sa description, le montant, la meme forme que le Club', () => {
  const c = corpsCommande({ titulaire: { userId: UUID }, montantEur: 1000, essai: false, offre: OFFRES_PAYPAL.coaching })
  const u = c.purchase_units[0]
  assert.equal(u.reference_id, 'coaching-8h')
  assert.equal(u.description, 'Coaching individuel 8 h avec Brice - AO Knowledge')
  assert.equal(u.custom_id, `u:${UUID}`)
  assert.deepEqual(u.amount, { currency_code: 'EUR', value: '1000.00' })
  assert.equal(c.intent, 'CAPTURE')
  assert.equal(c.application_context.shipping_preference, 'NO_SHIPPING')
  const e = corpsCommande({ titulaire: { userId: UUID }, montantEur: 1, essai: true, offre: OFFRES_PAYPAL.coaching })
  assert.equal(e.purchase_units[0].reference_id, 'coaching-8h-essai')
  assert.equal(requeteCapture('5o190127tn364715t', 'coaching'), 'coaching8h-capture-5O190127TN364715T')
  assert.equal(requeteCapture('5o190127tn364715t'), 'club10-capture-5O190127TN364715T', 'le Club garde son en-tete')
})

const commandeCoaching = (statut = 'APPROVED', extra = {}) => ({
  id: '7AB12345CD678901E', status: statut, create_time: '2026-11-08T21:00:00Z',
  payer: { email_address: 'payeur@paypal.fr', name: { given_name: 'Eleve' } },
  purchase_units: [{ reference_id: 'coaching-8h', custom_id: 'e:eleve@exemple.fr', amount: { currency_code: 'EUR', value: '1000.00' }, ...extra }],
})

bloc('commande relue : l offre vient de PayPal, le montant se verifie contre le prix du coaching', () => {
  const r = lireCommande(commandeCoaching())
  assert.equal(r.ok, true)
  assert.equal(r.commande.offre, 'coaching')
  assert.equal(r.commande.essai, false)
  assert.deepEqual(r.commande.titulaire, { email: 'eleve@exemple.fr' })
  assert.equal(montantConforme(r.commande, 1000), true)
  assert.equal(montantConforme(r.commande, null), false, 'offre absente : jamais capturee')
  assert.equal(montantConforme(r.commande, 1999), false, 'pas au prix du Club')
  // Une commande a 1 000 EUR qui se dit Club ne passe pas non plus.
  const club = lireCommande({ ...commandeCoaching(), purchase_units: [{ ...commandeCoaching().purchase_units[0], reference_id: 'club-10' }] })
  assert.equal(club.commande.offre, 'club')
  assert.equal(montantConforme(club.commande, 1999), false)
  const essai = lireCommande({ ...commandeCoaching(), purchase_units: [{ reference_id: 'coaching-8h-essai', custom_id: `u:${UUID}`, amount: { currency_code: 'EUR', value: '1.00' } }] })
  assert.equal(essai.commande.essai, true)
  assert.equal(essai.commande.offre, 'coaching')
  assert.equal(montantConforme(essai.commande, null), true, 'essai a 1 EUR : le prix en base ne compte pas')
})

bloc('note de l achat : coaching, seances a fixer, jamais de renonciation', () => {
  const base = { orderId: '7AB12345CD678901E', captureId: '9XY12345CD678901Z', centimes: 100000, essai: false, renonciationLe: null, payeurEmail: 'eleve@exemple.fr', email: 'eleve@exemple.fr' }
  const t = noteAcces({ ...base, offre: 'coaching' })
  assert.match(t, /^PayPal Coaching 8 h : commande 7AB12345CD678901E, capture 9XY12345CD678901Z, 1000\.00 EUR/)
  assert.match(t, /seances a fixer avec Brice, aucun contenu ouvert/)
  assert.doesNotMatch(t, /renonciation/)
  assert.match(noteAcces({ ...base }), /^PayPal 10% Club : /, 'le Club garde sa note')
})

bloc('email du coaching sans lien de reservation : paye, seances, Brice sous 48 h, adresse de l achat', () => {
  assert.equal(URL_RESERVATION_COACHING, null, 'aucun lien propre au coaching le 08/11')
  const m = modeleEmailCoaching({ email: 'eleve@exemple.fr', essai: false, montant: '1 000 euros', prenom: 'Eleve', reservation: null })
  assert.equal(m.sujet, 'Votre coaching avec Brice est confirmé')
  assert.equal(m.bouton, null)
  const texte = texteEmailClub(m)
  const html = htmlEmailClub(m)
  for (const t of [texte, html]) {
    assert.ok(t.includes('Bonjour Eleve,'))
    assert.ok(t.includes('1 000 euros'))
    assert.match(t, /8 h de coaching individuel avec Brice/)
    // 09/11 (Brice) : un accompagnement pendant la formation, pas de l'ETM, sans date limite, sans promesse.
    assert.match(t, /pendant que vous parcourez la formation/)
    assert.match(t, /leçons sont bien comprises/)
    assert.match(t, /exercices et des guidelines/)
    assert.match(t, /pas de date limite/)
    assert.doesNotMatch(t, /8 séances|accès prioritaire|en temps réel|valable|expire|dans les \d+ mois|\b\d+ mois\b/, 'ni seances comptees, ni ancienne promesse, ni duree de validite')
    assert.doesNotMatch(t, /garanti|résultats? assurés?|rentab/i, 'aucune promesse de resultat')
    assert.match(t, /Brice vous contacte sous 48 h pour fixer votre première séance\./)
    assert.ok(t.includes('eleve@exemple.fr'))
    assert.match(t, /4 fois/)
    assert.ok(t.includes('Brice et Mélanie'), 'meme signature que le mail du Club')
    assert.doesNotMatch(t, TYPO, 'typographie simple')
    assert.doesNotMatch(t, /académie est ouverte|Ouvrir l/, 'aucun acces a l academie')
    assert.doesNotMatch(t, /rétractation/)
  }
  assert.doesNotMatch(html, /Si le bouton ne marche pas/, 'pas de bouton sans lien')
  assert.equal(modeleEmailCoaching({ email: 'a@b.fr', essai: true, reservation: null }).sujet, '[Essai] Votre coaching avec Brice est confirmé')
  assert.ok(texteEmailClub(modeleEmailCoaching({ email: 'a@b.fr', essai: false, reservation: null })).startsWith('Bonjour,\n\nMerci, votre paiement est bien reçu'))
})

bloc('email du coaching avec un lien de reservation : le lien et le bouton, plus de 48 h', () => {
  const url = 'https://cal.com/exemple/coaching'
  const m = modeleEmailCoaching({ email: 'eleve@exemple.fr', essai: false, reservation: url })
  assert.deepEqual(m.bouton, { texte: 'Réserver ma première séance', url })
  const html = htmlEmailClub(m)
  assert.ok(html.includes(`<a href="${url}"`))
  assert.doesNotMatch(texteEmailClub(m), /48 h/)
  assert.ok(texteEmailClub(m).includes(url))
  // Un lien douteux est ignore : on retombe sur les 48 h.
  for (const x of ['http://cal.com/x', 'javascript:alert(1)', 'https://a b.fr', 'https://x.fr/{y}', 'https://x.fr/a|b', '', null, 3, `https://x.fr/${'a'.repeat(300)}`]) {
    assert.equal(lienReservation(x), null, String(x))
    assert.match(texteEmailClub(modeleEmailCoaching({ email: 'a@b.fr', essai: false, reservation: x })), /sous 48 h/, String(x))
  }
  assert.equal(lienReservation('  https://cal.com/brice-delannay/x  '), 'https://cal.com/brice-delannay/x')
  const piege = htmlEmailClub(modeleEmailCoaching({ email: '<script>@x.fr', essai: false, reservation: null }))
  assert.doesNotMatch(piege, /<script>/)
})

bloc('le mail du Club ne change pas : bouton, lien de secours, signature', () => {
  const html = htmlEmailClub(modeleEmailClub({ email: 'eleve@exemple.fr', essai: false }))
  assert.match(html, /\n<p style="margin:24px 0"><a href="https:\/\/aoknowledge\.com\/academie"[^\n]*<\/p>\n<p style="margin:0 0 16px;font-size:13px;color:#6b7280">Si le bouton ne marche pas, copiez ce lien : https:\/\/aoknowledge\.com\/academie<\/p>\n<p style="margin:32px 0 0;line-height:1.5">À bientôt sur les marchés,<br>Brice et Mélanie<\/p>/)
  assert.match(texteEmailClub(modeleEmailClub({ email: 'eleve@exemple.fr', essai: false })), /Ouvrir l'académie : https:\/\/aoknowledge\.com\/academie\n\nÀ bientôt/)
})

bloc('alerte de l equipe : qui, combien, rattache au Club ou non, ce qu il reste a faire', () => {
  const base = { orderId: '7AB12345CD678901E', captureId: '9XY12345CD678901Z', centimes: 100000, essai: false, email: 'eleve@exemple.fr', payeurEmail: 'eleve@exemple.fr', emailEnvoye: true, reservation: null }
  const a = texteAlerteCoaching({ ...base, membreClub: true })
  assert.match(a, /^Coaching 8 h PAYE : 1000\.00 EUR par PayPal\./)
  assert.match(a, /Acheteur : eleve@exemple\.fr\./)
  assert.match(a, /Rattache a un achat du 10% Club/)
  assert.match(a, /contacte sous 48 h/)
  assert.match(a, /A FAIRE : le contacter sous 48 h/)
  assert.match(a, /Commande 7AB12345CD678901E, capture 9XY12345CD678901Z\./)
  assert.match(texteAlerteCoaching({ ...base, membreClub: false }), /AUCUN achat du 10% Club/)
  assert.match(texteAlerteCoaching({ ...base, membreClub: null }), /non verifie/)
  assert.match(texteAlerteCoaching({ ...base, membreClub: true, emailEnvoye: false }), /NON envoye/)
  assert.match(texteAlerteCoaching({ ...base, membreClub: true, payeurEmail: 'autre@paypal.fr' }), /payeur PayPal : autre@paypal\.fr/)
  const lien = texteAlerteCoaching({ ...base, membreClub: true, reservation: 'https://cal.com/x' })
  assert.match(lien, /lien de reservation/)
  assert.doesNotMatch(lien, /A FAIRE/)
  assert.match(texteAlerteCoaching({ ...base, membreClub: true, essai: true, centimes: 100 }), /\(essai a 1 EUR, a rembourser\) : 1\.00 EUR/)
  for (const t of [a, texteAlerteEnAttente({ ...base, offre: 'coaching' }), texteAlerteNonNote({ ...base, offre: 'coaching' })]) {
    assert.doesNotMatch(t, /secret|client_id|Bearer/i)
  }
  const attente = texteAlerteEnAttente({ ...base, offre: 'coaching' })
  assert.match(attente, /^Coaching 8 h : paiement PayPal EN ATTENTE\./)
  assert.match(attente, /achat prevu pour eleve@exemple\.fr/)
  assert.match(attente, /\/api\/club\/paypal\/capturer \{"order_id":"7AB12345CD678901E"\}/)
  assert.match(texteAlerteEnAttente({ ...base }), /^10% Club : paiement PayPal EN ATTENTE\./, 'le Club garde son alerte')
  assert.match(texteAlerteNonNote({ ...base, offre: 'coaching' }), /ENCAISSE mais NON NOTE/)
})

bloc('base : la ligne d achat sans renonciation, la recherche de l achat du Club, la migration du coaching', () => {
  assert.match(SQL_POSER_ACHAT_PAYPAL, /\$6::timestamptz/, 'la renonciation peut etre vide (coaching)')
  assert.match(SQL_MEMBRE_OFFRE, /o\.slug = \$3::text/)
  assert.match(SQL_MEMBRE_OFFRE, /a\.retire_le is null and a\.debut <= now\(\) and \(a\.fin is null or a\.fin > now\(\)\)/)
  assert.match(SQL_MEMBRE_OFFRE, /pe\.verified = true/)
  assert.match(SQL_MEMBRE_OFFRE, /u\.email_confirmed_at is not null/)
  const fichier = '20261108235500_academie_offre_coaching.sql'
  const chemin = process.env.MIGRATIONS_DIR
    ? `${process.env.MIGRATIONS_DIR.replace(/\/$/, '')}/${fichier}`
    : new URL(`../../../sites/Aoknowledgecom/supabase/migrations/${fichier}`, import.meta.url)
  if (!existsSync(chemin)) {
    console.log(`    (migration introuvable a ${chemin} : donner MIGRATIONS_DIR ; partie NON verifiee)`)
    return
  }
  const migration = readFileSync(chemin, 'utf8')
  const sansCommentaires = migration.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  assert.equal(sansCommentaires.split(';').filter(s => s.trim()).length, 3, 'trois ordres, aucun point-virgule dans les chaines')
  assert.match(migration, /insert into public\.cockpit_offres [\s\S]*'coaching-8h', 'Coaching 8 h avec Brice \(apres le 10% Club\)', 'coaching', 'ponctuel', 'E4', 1000, 'EUR', false,/)
  assert.match(migration, /insert into public\.academie_offres [\s\S]*'coaching-8h', 'Coaching 8 h avec Brice', 'pack', 'paypal', false, 1000, 'coaching-8h',/)
  assert.doesNotMatch(sansCommentaires, /academie_offre_contenus/, 'le coaching n ouvre aucun contenu')
  assert.equal((migration.match(/on conflict \((offre_id|slug)\) do nothing/g) ?? []).length, 2, 'rejouable')
})

console.log(`\n${n} blocs ok`)
