// Le soutien dans les apps (brief du 11/11/2026) : la decision de vendre
// l'abonnement existant en mode soutien (accepte ou refuse selon le cas), la
// marque soutien sur la session et l'abonnement, la lecture des abonnements
// (badge present ou absent), la raison gardee pour Pilotage, puis la lecture du
// code des routes. Fonctions pures et lecture du code : aucune base, aucun
// reseau, aucun appel a Stripe.
// node scripts/verifier-soutien.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const S = await import('../src/lib/soutien-pur.ts')
const P = await import('../src/lib/pilotage-paliers.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

// ── La decision ──────────────────────────────────────────────────────────────

bloc('decision : achat accepte quand le Premium est compris, sans abonnement, vente ouverte', () => {
  const base = { connecte: true, ouvert: true, admin: false, dejaAbonne: false, compris: true }
  assert.deepEqual(S.decisionSoutien(base), { ok: true })
})

bloc('decision : achat refuse sans compte (401), vente fermee (403), abonnement deja actif (409), rien de compris (409)', () => {
  const base = { connecte: true, ouvert: true, admin: false, dejaAbonne: false, compris: true }
  assert.deepEqual(S.decisionSoutien({ ...base, connecte: false }), { ok: false, erreur: 'compte', status: 401 })
  assert.deepEqual(S.decisionSoutien({ ...base, ouvert: false }), { ok: false, erreur: 'ferme', status: 403 })
  assert.deepEqual(S.decisionSoutien({ ...base, dejaAbonne: true }), { ok: false, erreur: 'deja', status: 409 })
  assert.deepEqual(S.decisionSoutien({ ...base, compris: false }), { ok: false, erreur: 'pas_compris', status: 409 })
  // L'ordre : sans compte d'abord, meme si tout le reste refuse aussi.
  assert.equal(S.decisionSoutien({ connecte: false, ouvert: false, admin: false, dejaAbonne: true, compris: false }).erreur, 'compte')
})

bloc("decision : l'admin essaie avant l'ouverture et sans formule, jamais un second abonnement", () => {
  const admin = { connecte: true, ouvert: false, admin: true, dejaAbonne: false, compris: false }
  assert.deepEqual(S.decisionSoutien(admin), { ok: true })
  assert.deepEqual(S.decisionSoutien({ ...admin, dejaAbonne: true }), { ok: false, erreur: 'deja', status: 409 })
})

bloc('raisons comprises : Live Club, VIP, Premium Skool, Formation, ETM, manuel ; ni Duo, ni Carnet Premium, ni equipe', () => {
  for (const r of ['liveclub', 'skool-vip', 'skool-premium', 'formation', 'etm', 'manuel']) assert.equal(S.estRaisonComprise(r), true, r)
  for (const r of ['duo', 'carnet-premium', 'premium-duo', 'pilotage-premium', 'equipe', null, undefined, '']) assert.equal(S.estRaisonComprise(r), false, String(r))
  // Les raisons Club de Pilotage, sans l'equipe : une seule liste de verite.
  assert.deepEqual([...S.RAISONS_COMPRISES], P.RAISONS_CLUB_PILOTAGE.filter(r => r !== 'equipe'))
})

bloc('vente ouverte : SOUTIEN_APPS_PUBLIC=1 seulement', () => {
  assert.equal(S.soutienOuvert({ SOUTIEN_APPS_PUBLIC: '1' }), true)
  assert.equal(S.soutienOuvert({ SOUTIEN_APPS_PUBLIC: ' 1 ' }), true)
  assert.equal(S.soutienOuvert({}), false)
  assert.equal(S.soutienOuvert({ SOUTIEN_APPS_PUBLIC: 'true' }), false)
})

// ── Le badge : les abonnements relus ─────────────────────────────────────────

const ab = (id, status, produit, metadata = {}, customer = 'cus_test01') => ({
  id, status, customer, metadata, items: { data: [{ price: { id: 'price_x', product: produit } }] },
})
const CARNET = S.CARNET_PREMIUM_PRODUIT

bloc('badge present : un abonnement actif marque soutien=1 (actif, essai, impaye en relance)', () => {
  for (const st of ['active', 'trialing', 'past_due']) {
    const v = S.lireAbonnementsApp([ab('sub_aaaaaa1', st, CARNET, { soutien: '1' })], CARNET)
    assert.deepEqual(v, { actif: true, soutien: true, abonnement: 'sub_aaaaaa1', client: 'cus_test01' }, st)
  }
})

bloc('badge absent : abonnement sans la marque, arrete, impaye abandonne, autre produit, liste vide', () => {
  assert.deepEqual(S.lireAbonnementsApp([ab('sub_aaaaaa2', 'active', CARNET)], CARNET),
    { actif: true, soutien: false, abonnement: 'sub_aaaaaa2', client: 'cus_test01' })
  for (const st of ['canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused']) {
    assert.deepEqual(S.lireAbonnementsApp([ab('sub_aaaaaa3', st, CARNET, { soutien: '1' })], CARNET),
      { actif: false, soutien: false, abonnement: null, client: null }, st)
  }
  assert.equal(S.lireAbonnementsApp([ab('sub_aaaaaa4', 'active', 'prod_autre', { soutien: '1' })], CARNET).actif, false)
  assert.equal(S.lireAbonnementsApp([], CARNET).soutien, false)
  assert.equal(S.lireAbonnementsApp(null, CARNET).soutien, false)
  assert.equal(S.lireAbonnementsApp([ab('sub_aaaaaa5', 'active', CARNET, { soutien: 'true' })], CARNET).soutien, false)
})

bloc("badge : l'abonnement de soutien est retenu pour le portail, meme apres un abonnement ordinaire", () => {
  const v = S.lireAbonnementsApp([
    ab('sub_ordinaire', 'active', CARNET, {}, 'cus_un'),
    ab('sub_soutien01', 'active', CARNET, { soutien: '1' }, 'cus_deux'),
  ], CARNET)
  assert.deepEqual(v, { actif: true, soutien: true, abonnement: 'sub_soutien01', client: 'cus_deux' })
  // Prix deplie (objet produit) : lu aussi.
  const deplie = { ...ab('sub_deplie01', 'active', CARNET, { soutien: '1' }), items: { data: [{ price: { product: { id: CARNET } } }] } }
  assert.equal(S.lireAbonnementsApp([deplie], CARNET).soutien, true)
})

bloc('marque : soutien=1 sur une session ou un abonnement, rien d autre', () => {
  assert.equal(S.estMarqueSoutien({ soutien: '1' }), true)
  for (const m of [{}, { soutien: '0' }, { soutien: 1 }, null, undefined, 'soutien']) assert.equal(S.estMarqueSoutien(m), false)
})

// ── La session du Carnet ─────────────────────────────────────────────────────

bloc('Carnet : prix existants par defaut (5,99 par mois, 57,50 par an), surcharge propre seulement', () => {
  assert.equal(S.prixCarnet({}, 'mois'), 'price_1U9QKMEAT4qWdUNVv0OSIusl')
  assert.equal(S.prixCarnet({}, 'an'), 'price_1UAR2CEAT4qWdUNVgqnFaTd8')
  assert.equal(S.prixCarnet({ CARNET_PRIX_MENSUEL: 'price_AbC123456' }, 'mois'), 'price_AbC123456')
  assert.equal(S.prixCarnet({ CARNET_PRIX_ANNUEL: 'prod_pasunprix' }, 'an'), 'price_1UAR2CEAT4qWdUNVgqnFaTd8')
  assert.deepEqual({ ...S.TARIFS_CARNET }, { mois: 5.99, an: 57.5 })
  assert.equal(S.periodeCarnet('mois'), 'mois')
  assert.equal(S.periodeCarnet('an'), 'an')
  assert.equal(S.periodeCarnet('annuel'), null)
  // Les memes prix que l'extension (src/lib/offres.ts du Carnet) : le produit d'entitlements.ts.
  assert.match(lire('../src/lib/entitlements.ts'), new RegExp(`CARNET_PREMIUM_PRODUCT = '${CARNET}'`))
})

bloc('Carnet : session hebergee, abonnement existant, marque soutien sur la session et l abonnement, sans source', () => {
  const c = S.corpsSessionSoutienCarnet({ prix: 'price_1U9QKMEAT4qWdUNVv0OSIusl', userId: '11111111-2222-3333-4444-555555555555', email: 'eleve@exemple.fr', essai: false })
  const g = k => c.get(k)
  assert.equal(g('mode'), 'subscription')
  assert.equal(g('ui_mode'), null)
  assert.equal(g('line_items[0][price]'), 'price_1U9QKMEAT4qWdUNVv0OSIusl')
  assert.equal(g('metadata[soutien]'), '1')
  assert.equal(g('subscription_data[metadata][soutien]'), '1')
  assert.equal(g('subscription_data[metadata][app]'), 'carnet')
  assert.equal(g('subscription_data[metadata][user_id]'), '11111111-2222-3333-4444-555555555555')
  assert.equal(g('client_reference_id'), '11111111-2222-3333-4444-555555555555')
  assert.equal(g('customer_email'), 'eleve@exemple.fr')
  assert.equal(g('metadata[essai]'), '0')
  // Pas de source : le webhook de Pilotage n'y touche pas aux droits, il envoie le mail du Carnet.
  assert.equal(g('metadata[source]'), null)
  assert.equal(g('subscription_data[metadata][source]'), null)
  assert.equal(g('success_url'), 'https://aoknowledge.com/mon-espace?soutien=carnet')
  assert.equal(g('cancel_url'), 'https://aoknowledge.com/mon-espace')
  assert.equal(g('consent_collection[terms_of_service]'), 'required')
  const e = S.corpsSessionSoutienCarnet({ prix: 'price_x', userId: 'u', email: null, essai: true })
  assert.equal(e.get('customer_email'), null)
  assert.equal(e.get('metadata[essai]'), '1')
})

bloc("Carnet : seule une URL checkout.stripe.com est rendue a l'extension", () => {
  assert.equal(S.urlCheckoutSure('https://checkout.stripe.com/c/pay/cs_test_abc'), 'https://checkout.stripe.com/c/pay/cs_test_abc')
  for (const u of ['https://evil.example/checkout.stripe.com/', 'http://checkout.stripe.com/x', '', null, 42]) assert.equal(S.urlCheckoutSure(u), null)
})

// ── Pilotage ─────────────────────────────────────────────────────────────────

bloc('Pilotage : la session de soutien porte soutien=1 ; une session ordinaire ne le porte pas', () => {
  const base = { slug: 'pilotage-premium-mensuel', prix: 'price_p', retourUrl: 'https://pilotage.aoknowledge.com/offres?session_id={CHECKOUT_SESSION_ID}', userId: 'u', email: null, essai: false }
  const s = P.corpsSessionAbonnement({ ...base, soutien: true })
  assert.equal(s.get('metadata[soutien]'), '1')
  assert.equal(s.get('subscription_data[metadata][soutien]'), '1')
  assert.equal(s.get('metadata[source]'), 'pilotage') // le droit se pose comme pour tout abonnement
  const o = P.corpsSessionAbonnement(base)
  assert.equal(o.get('metadata[soutien]'), null)
  assert.equal(o.get('subscription_data[metadata][soutien]'), null)
})

bloc('Pilotage : la raison Club reste affichee tant que la formule court, celle de l abonnement ensuite', () => {
  assert.equal(S.raisonAvecSoutien({ raison: 'pilotage-premium', soutien: true, raisonClub: 'liveclub' }), 'liveclub')
  assert.equal(S.raisonAvecSoutien({ raison: 'pilotage-premium', soutien: true, raisonClub: null }), 'pilotage-premium')
  assert.equal(S.raisonAvecSoutien({ raison: 'pilotage-premium', soutien: true, raisonClub: 'carnet-premium' }), 'pilotage-premium')
  assert.equal(S.raisonAvecSoutien({ raison: 'pilotage-premium', soutien: false, raisonClub: 'liveclub' }), 'pilotage-premium')
})

// ── Lecture du code des routes ───────────────────────────────────────────────

bloc('routes : achat de Pilotage (soutien Premium seul, decision avant Stripe), route du Carnet, /moi et niveau', () => {
  const achat = lire('../src/app/api/pilotage/achat/route.ts')
  assert.match(achat, /const soutien = corps\.soutien === true/)
  assert.match(achat, /slug !== 'pilotage-premium-mensuel' && slug !== 'pilotage-premium-annuel'/)
  assert.ok(achat.indexOf('decisionSoutien(') < achat.indexOf('creerSessionAbonnement(cle'), 'decision avant la session')
  assert.match(achat, /admin: essai && Boolean\(p\?\.admin\)/)

  const carnet = lire('../src/app/api/carnet/soutien/route.ts')
  assert.match(carnet, /getUserId\(req\)/)
  assert.ok(carnet.indexOf('decisionSoutien(') < carnet.indexOf("appeler(cle, '/v1/checkout/sessions'"), 'decision avant la session')
  assert.match(carnet, /if \(!e\.carnet\) return refus\('indisponible', 503\)/)
  // Route NON publique : le middleware exige un Bearer (aucune entree dans publicPaths).
  assert.ok(!/'\/api\/carnet/.test(lire('../middleware.ts')))

  const moi = lire('../src/app/api/academie/moi/route.ts')
  assert.match(moi, /soutien: await soutien/)
  assert.match(lire('../src/lib/pilotage-niveau.ts'), /soutien: vu\.soutien/)
})

console.log(`\n${n} blocs verifies.`)
