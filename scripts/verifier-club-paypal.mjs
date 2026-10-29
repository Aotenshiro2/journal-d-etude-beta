// Verifie les regles pures du 10% Club paye par PayPal (src/lib/academie/club-paypal-pur.ts),
// hors ligne, sans PayPal ni base (29/10/2026).
//
//   node scripts/verifier-club-paypal.mjs
//
// Node 22 retire les types tout seul : le .ts est importe tel quel.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DESCRIPTION_COMMANDE, MAX_CUSTOM_ID, OFFRE_CLUB, PRIX_CLUB_DEFAUT_EUR, PRIX_ESSAI_EUR, REFERENCE_ESSAI, REFERENCE_PUBLIQUE,
  URL_ACADEMIE, URL_COMPTES_LIES, URL_CONNEXION,
  centimes, cleIdempotence, corpsCommande, customIdDe, decisionCommande, emailClub, estIdPayPal, etatCapture, htmlEmailClub,
  issuePayPal, lireCommande, lireCustomId, modeleEmailClub, montantAttendu, montantConforme, noteAcces, requeteCapture,
  texteAlerteEnAttente, texteEmailClub, valeurPayPal,
} from '../src/lib/academie/club-paypal-pur.ts'
import { SQL_POSER_ACHAT_PAYPAL } from '../src/lib/academie/requetes.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

const UUID = '11111111-2222-3333-4444-555555555555'

bloc('email sans compte : propre, valide, tient dans custom_id', () => {
  assert.equal(emailClub('  Eleve@Exemple.FR '), 'eleve@exemple.fr')
  for (const x of ['', 'a@b', 'pas-un-email', 'a b@c.fr', 'a@b.c', '<a@b.fr>', 'a@b.fr;x', 3, null, undefined]) {
    assert.equal(emailClub(x), null, String(x))
  }
  const long = `${'a'.repeat(MAX_CUSTOM_ID - 2 - '@ex.fr'.length)}@ex.fr`
  assert.equal(emailClub(long), long)
  assert.equal(emailClub(`a${long}`), null, '126 caracteres : e:<email> depasserait 127')
})

bloc('custom_id : u:<uuid> ou e:<email>, relu a l identique, le reste refuse', () => {
  assert.equal(customIdDe({ userId: UUID.toUpperCase() }), `u:${UUID}`)
  assert.equal(customIdDe({ email: 'eleve@exemple.fr' }), 'e:eleve@exemple.fr')
  assert.deepEqual(lireCustomId(`u:${UUID}`), { userId: UUID })
  assert.deepEqual(lireCustomId('e:eleve@exemple.fr'), { email: 'eleve@exemple.fr' })
  for (const x of ['u:pas-un-uuid', 'e:Eleve@Exemple.fr', 'e:pas-un-email', 'x:abc', `u:${UUID}x`, '', null, 42, `e:${'a'.repeat(130)}@b.fr`]) {
    assert.equal(lireCustomId(x), null, String(x))
  }
  const long = `${'a'.repeat(MAX_CUSTOM_ID - 2 - '@ex.fr'.length)}@ex.fr`
  assert.ok(customIdDe({ email: long }).length <= MAX_CUSTOM_ID)
})

bloc('qui cree une commande : vente fermee = essai admin seulement ; ouverte = tous, essai toujours admin', () => {
  const d = (ouvert, essai, connecte, admin) => decisionCommande({ ouvert, essai, connecte, admin })
  // Fermee
  assert.equal(d(false, false, false, false), 'ferme')
  assert.equal(d(false, false, true, true), 'ferme', 'meme l admin passe par essai tant que c est ferme')
  assert.equal(d(false, true, false, false), 'jeton')
  assert.equal(d(false, true, true, false), 'droit')
  assert.equal(d(false, true, true, true), 'ok')
  // Ouverte
  assert.equal(d(true, false, false, false), 'ok')
  assert.equal(d(true, false, true, false), 'ok')
  assert.equal(d(true, true, true, false), 'droit', 'essai d un non-admin refuse meme ouvert')
  assert.equal(d(true, true, false, false), 'jeton')
  assert.equal(d(true, true, true, true), 'ok', 'l admin garde son essai a 1 EUR')
})

bloc('montant : 1 EUR en essai, prix en base sinon, 1 999 a defaut', () => {
  assert.equal(PRIX_ESSAI_EUR, 1)
  assert.equal(PRIX_CLUB_DEFAUT_EUR, 1999)
  assert.equal(montantAttendu({ essai: true, prixBase: 1999 }), 1)
  assert.equal(montantAttendu({ essai: false, prixBase: 1999 }), 1999)
  assert.equal(montantAttendu({ essai: false, prixBase: 1499.5 }), 1499.5)
  for (const p of [null, 0, -3, NaN, Infinity]) assert.equal(montantAttendu({ essai: false, prixBase: p }), 1999, String(p))
  assert.equal(valeurPayPal(1999), '1999.00')
  assert.equal(valeurPayPal(1), '1.00')
  assert.equal(valeurPayPal(1499.5), '1499.50')
  assert.equal(centimes('1999.00'), 199900)
  assert.equal(centimes('1.00'), 100)
  assert.equal(centimes('1.5'), 150)
  for (const x of ['1,00', '-1.00', '1.001', '', 1, null]) assert.equal(centimes(x), null, String(x))
})

bloc('corps de la commande : CAPTURE, EUR, sans livraison, payer maintenant, francais', () => {
  const c = corpsCommande({ titulaire: { email: 'eleve@exemple.fr' }, montantEur: 1999, essai: false })
  assert.equal(c.intent, 'CAPTURE')
  assert.equal(c.purchase_units.length, 1)
  const u = c.purchase_units[0]
  assert.equal(u.reference_id, REFERENCE_PUBLIQUE)
  assert.equal(u.description, DESCRIPTION_COMMANDE)
  assert.equal(u.description, '10% Club - formation complète AO Knowledge')
  assert.equal(u.custom_id, 'e:eleve@exemple.fr')
  assert.deepEqual(u.amount, { currency_code: 'EUR', value: '1999.00' })
  assert.deepEqual(c.application_context, { brand_name: 'AO Knowledge', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', locale: 'fr-FR' })
  const e = corpsCommande({ titulaire: { userId: UUID }, montantEur: 1, essai: true })
  assert.equal(e.purchase_units[0].reference_id, REFERENCE_ESSAI)
  assert.equal(e.purchase_units[0].custom_id, `u:${UUID}`)
  assert.equal(e.purchase_units[0].amount.value, '1.00')
})

bloc('idempotence : la commande est la cle, en majuscules ; meme PayPal-Request-Id a chaque capture', () => {
  assert.equal(cleIdempotence('5o190127tn364715t'), '5O190127TN364715T')
  assert.equal(requeteCapture('5o190127tn364715t'), requeteCapture('5O190127TN364715T'))
  assert.equal(requeteCapture('5O190127TN364715T'), 'club10-capture-5O190127TN364715T')
  assert.ok(estIdPayPal('5O190127TN364715T'))
  for (const x of ['', 'abc', '5O19-0127', '../../v1', 'x'.repeat(41), null]) assert.equal(estIdPayPal(x), false, String(x))
})

const approuvee = {
  id: '5O190127TN364715T', status: 'APPROVED', create_time: '2026-10-29T10:00:00Z',
  payer: { email_address: 'Payeur@PayPal.fr' },
  purchase_units: [{ reference_id: 'club-10', custom_id: 'e:eleve@exemple.fr', amount: { currency_code: 'EUR', value: '1999.00' } }],
}
// Une fois capturee, la commande est COMPLETED chez PayPal, meme si sa capture est PENDING.
const capturee = (statut, extra = {}) => ({
  ...approuvee, status: 'COMPLETED',
  purchase_units: [{
    ...approuvee.purchase_units[0],
    payments: { captures: [{ id: '3C679366HH908993F', status: statut, amount: { currency_code: 'EUR', value: '1999.00' }, custom_id: 'e:eleve@exemple.fr' }] },
    ...extra,
  }],
})

bloc('commande relue : nos commandes seulement, titulaire, montant, date, payeur', () => {
  const r = lireCommande(approuvee)
  assert.equal(r.ok, true)
  assert.equal(r.commande.orderId, '5O190127TN364715T')
  assert.equal(r.commande.essai, false)
  assert.deepEqual(r.commande.titulaire, { email: 'eleve@exemple.fr' })
  assert.equal(r.commande.centimes, 199900)
  assert.equal(r.commande.devise, 'EUR')
  assert.equal(r.commande.creeLe.toISOString(), '2026-10-29T10:00:00.000Z')
  assert.equal(r.commande.payeurEmail, 'payeur@paypal.fr')
  assert.equal(r.commande.capture, null)
  assert.equal(etatCapture(r.commande), 'a_capturer')

  assert.deepEqual(lireCommande({ ...approuvee, purchase_units: [{ ...approuvee.purchase_units[0], reference_id: 'autre' }] }), { ok: false, raison: 'pas_club' })
  assert.deepEqual(lireCommande({ ...approuvee, purchase_units: [] }), { ok: false, raison: 'pas_club' })
  assert.deepEqual(lireCommande({ ...approuvee, id: '../x' }), { ok: false, raison: 'pas_club' })
  assert.deepEqual(lireCommande({ ...approuvee, purchase_units: [approuvee.purchase_units[0], approuvee.purchase_units[0]] }), { ok: false, raison: 'pas_club' })
  assert.deepEqual(lireCommande({ ...approuvee, purchase_units: [{ ...approuvee.purchase_units[0], custom_id: 'x:1' }] }), { ok: false, raison: 'incomplet' })

  const essai = lireCommande({ ...approuvee, purchase_units: [{ reference_id: 'club-10-essai', custom_id: `u:${UUID}`, amount: { currency_code: 'EUR', value: '1.00' } }] })
  assert.equal(essai.commande.essai, true)
  assert.deepEqual(essai.commande.titulaire, { userId: UUID })
  assert.equal(montantConforme(essai.commande, 1999), true)
  assert.equal(montantConforme(essai.commande, null), true)
})

bloc('etat de la capture : terminee, en attente, refusee, remboursee, pas approuvee, annulee', () => {
  const etat = o => etatCapture(lireCommande(o).commande)
  assert.equal(etat(capturee('COMPLETED')), 'capturee')
  assert.equal(etat(capturee('PARTIALLY_REFUNDED')), 'capturee')
  assert.equal(etat(capturee('PENDING')), 'en_attente')
  assert.equal(etat(capturee('DECLINED')), 'refusee')
  assert.equal(etat(capturee('FAILED')), 'refusee')
  assert.equal(etat(capturee('REFUNDED')), 'remboursee')
  assert.equal(etat({ ...approuvee, status: 'CREATED' }), 'non_approuvee')
  assert.equal(etat({ ...approuvee, status: 'PAYER_ACTION_REQUIRED' }), 'non_approuvee')
  assert.equal(etat({ ...approuvee, status: 'VOIDED' }), 'annulee')
  const r = lireCommande(capturee('COMPLETED'))
  assert.deepEqual(r.commande.capture, { id: '3C679366HH908993F', statut: 'COMPLETED', centimes: 199900 })
  // Reponse de capture sans custom_id sur l'unite : celui de la capture suffit.
  const sansCustom = capturee('COMPLETED')
  delete sansCustom.purchase_units[0].custom_id
  assert.deepEqual(lireCommande(sansCustom).commande.titulaire, { email: 'eleve@exemple.fr' })
})

bloc('montant verifie avant capture : EUR, 1 999 public, 1 en essai', () => {
  const c = lireCommande(approuvee).commande
  assert.equal(montantConforme(c, 1999), true)
  assert.equal(montantConforme(c, null), true, 'prix absent en base : 1 999 par defaut')
  assert.equal(montantConforme(c, 1499), false)
  assert.equal(montantConforme({ ...c, devise: 'USD' }, 1999), false)
  assert.equal(montantConforme({ ...c, centimes: 100 }, 1999), false, 'une commande publique a 1 EUR ne passe pas')
  assert.equal(montantConforme({ ...c, essai: true }, 1999), false, 'un essai a 1 999 ne passe pas non plus')
})

bloc('erreurs PayPal : l issue seulement, jamais la valeur', () => {
  assert.equal(issuePayPal({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED', value: 'e:x@y.fr' }] }), 'ORDER_ALREADY_CAPTURED')
  assert.equal(issuePayPal({ name: 'RESOURCE_NOT_FOUND' }), 'RESOURCE_NOT_FOUND')
  assert.equal(issuePayPal({ details: [{ issue: 'x@y.fr' }] }), 'INCONNU')
  assert.equal(issuePayPal(null), 'INCONNU')
})

bloc('note de l acces : commande, capture, montant, essai, payeur s il differe', () => {
  const base = { orderId: '5O190127TN364715T', captureId: '3C679366HH908993F', centimes: 199900, essai: false, renonciationLe: new Date(), email: 'eleve@exemple.fr' }
  const n1 = noteAcces({ ...base, payeurEmail: 'eleve@exemple.fr' })
  assert.match(n1, /commande 5O190127TN364715T, capture 3C679366HH908993F, 1999\.00 EUR/)
  assert.doesNotMatch(n1, /payeur|ACHAT TEST/)
  const n2 = noteAcces({ ...base, essai: true, centimes: 100, payeurEmail: 'autre@paypal.fr', renonciationLe: null })
  assert.match(n2, /1\.00 EUR/)
  assert.match(n2, /ACHAT TEST/)
  assert.match(n2, /email du payeur PayPal : autre@paypal\.fr/)
  assert.match(n2, /renonciation datee de la capture/)
  assert.ok(noteAcces({ ...base, payeurEmail: `${'a'.repeat(1200)}@x.fr` }).length <= 1000)
})

bloc('email d acces : objet, ce qui est ouvert, l academie, CETTE adresse, Comptes lies', () => {
  const m = modeleEmailClub({ email: 'eleve@exemple.fr', essai: false })
  assert.equal(m.sujet, 'Ton accès au 10% Club est ouvert')
  assert.equal(modeleEmailClub({ email: 'a@b.fr', essai: true }).sujet, '[Essai] Ton accès au 10% Club est ouvert')
  assert.equal(m.bouton.url, URL_ACADEMIE)
  assert.equal(URL_ACADEMIE, 'https://aoknowledge.com/academie')
  const texte = texteEmailClub(m)
  const html = htmlEmailClub(m)
  for (const t of [texte, html]) {
    assert.ok(t.includes('eleve@exemple.fr'))
    assert.ok(t.includes(URL_CONNEXION))
    assert.ok(t.includes(URL_COMPTES_LIES))
    assert.ok(t.includes(URL_ACADEMIE))
    assert.match(t, /CETTE adresse/)
    assert.match(t, /parcours de 0 à 5/)
    assert.doesNotMatch(t, /[–—…“”‘’ ]/, 'typographie simple')
  }
  assert.ok(html.includes(`<a href="${URL_COMPTES_LIES}"`))
  assert.doesNotMatch(texte, /\{lien:/)
  const piege = htmlEmailClub(modeleEmailClub({ email: '<script>@x.fr', essai: false }))
  assert.doesNotMatch(piege, /<script>/)
})

bloc('alerte en attente : la commande et la relance, aucun secret', () => {
  const t = texteAlerteEnAttente({ orderId: '5O190127TN364715T', captureId: '3C679366HH908993F', centimes: 199900, essai: false, email: 'eleve@exemple.fr' })
  assert.match(t, /EN ATTENTE/)
  assert.match(t, /\/api\/club\/paypal\/capturer \{"order_id":"5O190127TN364715T"\}/)
  assert.doesNotMatch(t, /secret|client_id|Bearer/i)
})

bloc('base : l index de la migration est celui de l ON CONFLICT, l offre est formation-complete', () => {
  assert.equal(OFFRE_CLUB, 'formation-complete')
  const migration = readFileSync(new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261029140000_academie_achat_paypal.sql', import.meta.url), 'utf8')
  assert.match(migration, /create unique index if not exists academie_acces_paypal_reference_idx\s+on public\.academie_acces \(reference\)\s+where source = 'paypal' and reference is not null;/)
  assert.match(SQL_POSER_ACHAT_PAYPAL, /on conflict \(reference\) where source = 'paypal' and reference is not null do nothing/)
  assert.match(SQL_POSER_ACHAT_PAYPAL, /'paypal', \$4::text, \$5::numeric, now\(\), null, \$6::timestamptz, 'paypal', \$7::text, \$8::text, 'brice'/)
  const sansCommentaires = migration.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  assert.equal(sansCommentaires.split(';').filter(s => s.trim()).length, 2, 'deux ordres, aucun point-virgule dans les chaines')
})

bloc('middleware : les routes du club sont publiques (le jeton est facultatif, verifie dans la route)', () => {
  const mw = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8')
  assert.match(mw, /const publicPaths = \[[^\]]*'\/api\/club\/paypal'[,\]]/)
})

console.log(`\n${n} blocs ok`)
