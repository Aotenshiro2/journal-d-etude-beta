// Verifie les regles pures de la vente a l'unite (src/lib/academie/achat-pur.ts),
// hors ligne, sans Stripe ni base (19/10/2026).
//
//   node scripts/verifier-achat-academie.mjs
//
// Node 22 retire les types tout seul : le .ts est importe tel quel.

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { corpsSession, lireAchat, retourSur, verifierSignature, TEXTE_RETRACTATION } from '../src/lib/academie/achat-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

bloc('retour : pages de l academie seulement', () => {
  assert.equal(retourSur('/academie/journaling/lecon-1'), '/academie/journaling/lecon-1')
  assert.equal(retourSur('/academie/journaling'), '/academie/journaling')
  for (const x of ['//site.com', '/connexion', '/academie/x?y=1', '/academie/\\x', 'https://a.b/academie/x', '/academie/x\ty', 3, null]) {
    assert.equal(retourSur(x), null, String(x))
  }
})

const offre = { moduleSlug: 'journaling', moduleTitre: 'Journaling', offreSlug: 'module-journaling', stripePriceId: 'price_123' }

bloc('session : embarquee, compte pose par le serveur, libelle pour le cockpit', () => {
  const c = corpsSession(offre, { retourUrl: 'https://aoknowledge.com/academie/journaling?achat_session={CHECKOUT_SESSION_ID}', userId: 'u1', email: 'a@b.fr', essai: true })
  assert.equal(c.get('ui_mode'), 'embedded')
  assert.equal(c.get('redirect_on_completion'), 'if_required')
  assert.equal(c.get('line_items[0][price]'), 'price_123')
  assert.equal(c.get('client_reference_id'), 'u1')
  assert.equal(c.get('customer_email'), 'a@b.fr')
  assert.equal(c.get('metadata[essai]'), '1')
  assert.equal(c.get('metadata[academie_offre]'), 'module-journaling')
  assert.match(c.get('payment_intent_data[description]'), /^Académie AOK : Journaling$/)
  assert.equal(c.get('consent_collection[terms_of_service]'), 'required')
  assert.equal(c.get('custom_text[terms_of_service_acceptance][message]'), TEXTE_RETRACTATION)
  assert.match(TEXTE_RETRACTATION, /\(https:\/\/aoknowledge\.com\/conditions-generales\)/)
  assert.equal(c.has('payment_method_types[0]'), false, 'moyens de paiement laisses au tableau de bord (express)')
  const anonyme = corpsSession(offre, { retourUrl: 'x', userId: null, email: null, essai: false })
  assert.equal(anonyme.has('client_reference_id'), false)
  assert.equal(anonyme.has('customer_email'), false)
  assert.equal(anonyme.get('metadata[essai]'), '0')
})

const payee = {
  id: 'cs_live_a1b2c3d4e5f6g7', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 4900, created: 1760000000,
  client_reference_id: '11111111-2222-3333-4444-555555555555',
  customer_details: { email: ' Eleve@Exemple.FR ' },
  metadata: { source: 'academie', academie_module: 'journaling', academie_offre: 'module-journaling', essai: '1' },
  payment_intent: { id: 'pi_1', latest_charge: 'ch_abcdef123' },
  consent: { terms_of_service: 'accepted' },
}

bloc('achat : session payee lue', () => {
  const r = lireAchat(payee)
  assert.equal(r.ok, true)
  assert.equal(r.achat.email, 'eleve@exemple.fr')
  assert.equal(r.achat.montantEur, 49)
  assert.equal(r.achat.chargeId, 'ch_abcdef123')
  assert.equal(r.achat.userId, '11111111-2222-3333-4444-555555555555')
  assert.equal(r.achat.essai, true)
  assert.ok(r.achat.renonciationLe instanceof Date, 'case cochee : renonciation posee')
  const sansCase = lireAchat({ ...payee, consent: null })
  assert.equal(sansCase.ok && sansCase.achat.renonciationLe, null, 'sans case cochee : pas de renonciation')
})

bloc('achat : refus', () => {
  assert.deepEqual(lireAchat({ ...payee, metadata: {} }), { ok: false, raison: 'pas_academie' })
  assert.deepEqual(lireAchat({ ...payee, status: 'open' }), { ok: false, raison: 'incomplet' })
  assert.deepEqual(lireAchat({ ...payee, payment_status: 'unpaid' }), { ok: false, raison: 'en_attente' })
  assert.deepEqual(lireAchat({ ...payee, customer_details: {}, client_reference_id: null }), { ok: false, raison: 'incomplet' })
  const sansCompte = lireAchat({ ...payee, client_reference_id: 'pas-un-uuid', payment_intent: 'pi_1' })
  assert.equal(sansCompte.ok && sansCompte.achat.userId, null)
  assert.equal(sansCompte.ok && sansCompte.achat.chargeId, null)
})

bloc('webhook : signature', () => {
  const secret = 'whsec_essai'
  const corps = '{"type":"checkout.session.completed"}'
  const t = 1760000000
  const v1 = createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex')
  assert.equal(verifierSignature(corps, `t=${t},v1=${v1}`, secret, t + 10), true)
  assert.equal(verifierSignature(corps, `t=${t},v1=00${v1.slice(2)},v1=${v1}`, secret, t), true)
  assert.equal(verifierSignature(corps + ' ', `t=${t},v1=${v1}`, secret, t), false)
  assert.equal(verifierSignature(corps, `t=${t},v1=${v1}`, 'autre', t), false)
  assert.equal(verifierSignature(corps, `t=${t},v1=${v1}`, secret, t + 301), false)
  assert.equal(verifierSignature(corps, null, secret, t), false)
})

console.log(`\n${n} blocs ok`)
