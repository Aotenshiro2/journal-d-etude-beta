// Le soutien AOKnowledge (page aoknowledge.com/soutenir, 11/11/2026) : le montant
// (paliers et montant au choix), la session Checkout et ses marques, la route
// rejouee avec un FAUX Stripe (refus sans compte, double soutien refuse, montant
// hors bornes refuse, metadonnees posees), le badge, et le lien avec le mail de
// remerciement. Aucune base, aucun reseau, aucun appel a Stripe.
// node scripts/verifier-soutien-aok.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const S = await import('../src/lib/soutien-pur.ts')
const M = await import('../src/lib/mails-achat-pur.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const UID = '6b0f1c9e-3a2d-4c1b-9e8f-0123456789ab'
const EMAIL = 'eleve@exemple.fr'

await bloc('montant : 5, 10, 20 et tout entier de 2 a 200 ; ni texte, ni decimale, ni hors bornes', () => {
  for (const m of [2, 5, 7, 10, 20, 99, 200]) assert.equal(S.montantSoutienAok(m), m, String(m))
  for (const m of [1, 0, -5, 201, 1000, 2.5, 9.99, '10', '', null, undefined, NaN, Infinity, [10], { montant: 10 }]) {
    assert.equal(S.montantSoutienAok(m), null, String(m))
  }
  assert.equal(S.MONTANT_SOUTIEN_MIN, 2)
  assert.equal(S.MONTANT_SOUTIEN_MAX, 200)
})

await bloc('produit et prix : ceux crees chez Stripe le 11/11 (aucun autre)', () => {
  assert.equal(S.PRODUIT_SOUTIEN_AOK, 'prod_VboqdWtBxA9SnV')
  assert.deepEqual({ ...S.PRIX_SOUTIEN_AOK }, {
    5: 'price_1UabCfEAT4qWdUNVCALk05Fc', 10: 'price_1UabCgEAT4qWdUNV7J6fxGes', 20: 'price_1UabChEAT4qWdUNVFKUjkAT1',
  })
})

const corps = montant => Object.fromEntries(S.corpsSessionSoutienAok({ montant, userId: UID, email: EMAIL }))

await bloc('session : palier = prix existant, montant au choix = price_data mensuel sur le produit, en centimes', () => {
  for (const m of [5, 10, 20]) {
    const c = corps(m)
    assert.equal(c['line_items[0][price]'], S.PRIX_SOUTIEN_AOK[m])
    assert.ok(!Object.keys(c).some(k => k.includes('price_data')), `${m} : pas de price_data`)
  }
  const c = corps(7)
  assert.equal(c['line_items[0][price]'], undefined)
  assert.equal(c['line_items[0][price_data][currency]'], 'eur')
  assert.equal(c['line_items[0][price_data][product]'], 'prod_VboqdWtBxA9SnV')
  assert.equal(c['line_items[0][price_data][recurring][interval]'], 'month')
  assert.equal(c['line_items[0][price_data][unit_amount]'], '700')
  assert.equal(corps(200)['line_items[0][price_data][unit_amount]'], '20000')
  assert.equal(c['line_items[0][quantity]'], '1')
})

await bloc('session : abonnement, marque soutien=aok sur la session ET l abonnement, sans source, conditions, retours', () => {
  const c = corps(10)
  assert.equal(c.mode, 'subscription')
  assert.equal(c.success_url, 'https://aoknowledge.com/mon-espace?soutien=aok')
  assert.equal(c.cancel_url, 'https://aoknowledge.com/soutenir')
  assert.equal(c['consent_collection[terms_of_service]'], 'required')
  assert.match(c['custom_text[terms_of_service_acceptance][message]'], /\[conditions générales\]\(https:\/\/aoknowledge\.com\/conditions-generales\)/)
  assert.equal(c.client_reference_id, UID)
  assert.equal(c.customer_email, EMAIL)
  for (const p of ['metadata', 'subscription_data[metadata]']) {
    assert.equal(c[`${p}[soutien]`], 'aok', p)
    assert.equal(c[`${p}[app]`], 'aok', p)
    assert.equal(c[`${p}[user_id]`], UID, p)
    assert.equal(c[`${p}[montant]`], '10', p)
  }
  assert.equal(c['subscription_data[description]'], 'Soutien AOKnowledge')
  // Sans source : le webhook de Pilotage la traite hors Pilotage (aucun droit), et envoie le remerciement.
  assert.ok(!Object.keys(c).some(k => /source/.test(k)), 'aucune metadata source')
  assert.ok(!Object.values(c).some(v => /—|–/.test(v)), 'tiret long')
})

// Le faux Stripe : il note chaque session demandee et rend une URL de Checkout.
function fauxStripe({ compte = { userId: UID, email: EMAIL }, abonnement = { actif: false, soutien: false, abonnement: null, client: null }, url = 'https://checkout.stripe.com/c/pay/cs_test_x' } = {}) {
  const appels = { sessions: [], abonnements: [] }
  return {
    appels,
    deps: {
      compte: async () => compte,
      abonnement: async e => { appels.abonnements.push(e); return abonnement },
      creerSession: async c => { appels.sessions.push(Object.fromEntries(c)); return { id: 'cs_test_x', url } },
    },
  }
}

await bloc('route (faux Stripe) : refus sans compte (401), Stripe jamais appele', async () => {
  const f = fauxStripe({ compte: null })
  assert.deepEqual(await S.sessionSoutienAok({ montant: 10 }, f.deps), { status: 401, corps: { ok: false, erreur: 'compte' } })
  assert.equal(f.appels.sessions.length, 0)
  assert.equal(f.appels.abonnements.length, 0)
})

await bloc('route (faux Stripe) : montant libre hors bornes refuse (400), Stripe jamais appele', async () => {
  for (const montant of [1, 201, 0, 2.5, '10', null, undefined]) {
    const f = fauxStripe()
    assert.deepEqual(await S.sessionSoutienAok({ montant }, f.deps), { status: 400, corps: { ok: false, erreur: 'montant' } }, String(montant))
    assert.equal(f.appels.sessions.length, 0)
  }
  assert.equal((await S.sessionSoutienAok({}, fauxStripe().deps)).corps.erreur, 'montant')
  assert.equal((await S.sessionSoutienAok(null, fauxStripe().deps)).corps.erreur, 'montant')
})

await bloc('route (faux Stripe) : double soutien refuse (409 deja) ; Stripe illisible = 503, on ne vend pas a l aveugle ; sans email confirme = 409', async () => {
  const deja = fauxStripe({ abonnement: { actif: true, soutien: false, abonnement: 'sub_AOK123456', client: 'cus_x' } })
  assert.deepEqual(await S.sessionSoutienAok({ montant: 5 }, deja.deps), { status: 409, corps: { ok: false, erreur: 'deja' } })
  assert.deepEqual(deja.appels.abonnements, [EMAIL])
  assert.equal(deja.appels.sessions.length, 0)
  const illisible = fauxStripe({ abonnement: null })
  assert.deepEqual(await S.sessionSoutienAok({ montant: 5 }, illisible.deps), { status: 503, corps: { ok: false, erreur: 'indisponible' } })
  assert.equal(illisible.appels.sessions.length, 0)
  const sansEmail = fauxStripe({ compte: { userId: UID, email: null } })
  assert.deepEqual(await S.sessionSoutienAok({ montant: 5 }, sansEmail.deps), { status: 409, corps: { ok: false, erreur: 'email' } })
  assert.equal(sansEmail.appels.sessions.length, 0)
})

await bloc('route (faux Stripe) : accepte, une seule session, metadonnees posees ; URL hors checkout.stripe.com = 502', async () => {
  for (const montant of [5, 10, 20, 2, 37, 200]) {
    const f = fauxStripe()
    const r = await S.sessionSoutienAok({ montant }, f.deps)
    assert.deepEqual(r, { status: 200, corps: { ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_x' } }, String(montant))
    assert.equal(f.appels.sessions.length, 1)
    const s = f.appels.sessions[0]
    assert.equal(s['metadata[soutien]'], 'aok')
    assert.equal(s['subscription_data[metadata][soutien]'], 'aok')
    assert.equal(s['metadata[montant]'], String(montant))
    assert.equal(s.mode, 'subscription')
  }
  const f = fauxStripe({ url: 'https://exemple.fr/piege' })
  assert.deepEqual(await S.sessionSoutienAok({ montant: 10 }, f.deps), { status: 502, corps: { ok: false, erreur: 'stripe' } })
})

const ab = (id, status, produit, metadata = {}) => ({
  id, status, customer: 'cus_test01', metadata, items: { data: [{ price: { id: 'price_x', product: produit } }] },
})

await bloc('badge : un abonnement AOK actif (actif, essai, impaye en relance) = soutien ; arrete ou autre produit = rien', () => {
  const AOK = S.PRODUIT_SOUTIEN_AOK
  for (const st of ['active', 'trialing', 'past_due']) assert.equal(S.lireAbonnementsApp([ab('sub_aok0001', st, AOK, { soutien: 'aok' })], AOK).actif, true, st)
  for (const st of ['canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused']) assert.equal(S.lireAbonnementsApp([ab('sub_aok0002', st, AOK)], AOK).actif, false, st)
  assert.equal(S.lireAbonnementsApp([ab('sub_aok0003', 'active', S.CARNET_PREMIUM_PRODUIT, { soutien: '1' })], AOK).actif, false, 'le Carnet ne compte pas pour AOK')
  assert.equal(S.lireAbonnementsApp([ab('sub_aok0004', 'active', AOK)], AOK).client, 'cus_test01', 'le portail se rattache au client')
  assert.equal(S.estMarqueSoutienAok({ soutien: 'aok' }), true)
  assert.equal(S.estMarqueSoutienAok({ soutien: '1' }), false)
  // /moi : compte.soutien.aok, borne a 4 s comme le Carnet et Pilotage.
  const so = lire('../src/lib/soutien.ts')
  assert.match(so, /export type SoutienDuCompte = \{ carnet: boolean \| null; pilotage: boolean \| null; aok: boolean \| null \}/)
  assert.match(so, /borne\(abonnementAokDe\(email\)\.then\(v => \(v \? v\.actif : null\)\), null\)/)
  assert.match(so, /return \{ carnet, pilotage, aok \}/)
  assert.match(lire('../src/lib/soutien-aok.ts'), /lireAbonnementsApp\(subs, PRODUIT_SOUTIEN_AOK\)/)
})

await bloc('mail : une session de /soutenir payee donne le remerciement « a AOKnowledge » (partie 1)', () => {
  const c = corps(10)
  const meta = Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]))
  const metaAb = Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith('subscription_data[metadata][')).map(([k, v]) => [k.slice(28, -1), v]))
  assert.deepEqual(meta, { soutien: 'aok', app: 'aok', user_id: UID, montant: '10' })
  assert.deepEqual(metaAb, meta)
  const session = {
    id: 'cs_live_abcdefghijkl', mode: 'subscription', status: 'complete', payment_status: 'paid', livemode: true,
    customer_details: { email: EMAIL, name: 'Camille Martin' }, amount_total: 1000, subscription: 'sub_AOK1234567', metadata: meta,
  }
  const abonnement = { id: 'sub_AOK1234567', metadata: metaAb, items: { data: [{ price: { product: S.PRODUIT_SOUTIEN_AOK, recurring: { interval: 'month' } } }] } }
  const p = M.planMailHorsPilotage(session, abonnement, null)
  assert.equal(p.produit, 'soutien')
  assert.equal(p.variables.soutien, 'aok')
  const r = M.rendreMail(p.produit, p.variables)
  assert.equal(r.modele.paragraphes[1], 'Merci pour ton soutien à AOKnowledge.')
})

await bloc('route : GET et POST derriere le jeton (non publique), CORS de l academie, regles avant Stripe, cle du soutien du Carnet', () => {
  const r = lire('../src/app/api/academie/soutien/route.ts')
  assert.match(r, /const METHODES = 'GET, POST, OPTIONS'/)
  assert.match(r, /export async function GET\(/)
  assert.match(r, /export async function POST\(/)
  assert.match(r, /const r = await sessionSoutienAok\(corps, \{/)
  assert.match(r, /return appeler\(cle, '\/v1\/checkout\/sessions', c\)/)
  assert.match(r, /portailDuClient\(cleSoutienAok\(\), ab\.client, PAGE_SOUTIEN_AOK\)/)
  // Le middleware : aucune entree publique ne couvre /api/academie/soutien (Bearer exige).
  const mw = lire('../middleware.ts')
  const publics = /const publicPaths = \[([^\]]+)\]/.exec(mw)[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''))
  assert.ok(publics.length > 5)
  assert.ok(!publics.some(p => '/api/academie/soutien'.startsWith(p)), 'route publique')
  // La cle : celle des sessions de soutien du Carnet (aucune variable neuve).
  assert.match(lire('../src/lib/soutien-aok.ts'), /process\.env\.STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE\?\.trim\(\) \|\| clePilotage\(\)/)
})

console.log(`\n${n} blocs verifies, tout est bon.`)
