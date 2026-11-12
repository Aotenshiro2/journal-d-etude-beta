// Le Carnet Premium reconnu par le compte (12/11/2026, correctif « Payment Link ») :
// l'acheteur qui change d'email dans Stripe a quand meme l'acces, grace au
// client_reference_id pose par l'extension sur le lien de paiement. Le chemin
// entier (index des sessions, abonnement relu, repli par email) rejoue avec un
// FAUX Stripe. Aucune base, aucun reseau, aucun appel a Stripe.
//
//   node scripts/verifier-carnet-reference.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const C = await import('../src/lib/carnet-premium-pur.ts')
const S = await import('../src/lib/soutien-pur.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const UID = '6b0f1c9e-3a2d-4c1b-9e8f-0123456789ab'
const UID2 = '11111111-2222-3333-4444-555555555555'
const EMAIL_COMPTE = 'eleve@exemple.fr'
const EMAIL_STRIPE = 'autre.adresse@exemple.org'
const [MENSUEL, ANNUEL] = C.LIENS_PAIEMENT_CARNET

const session = (o = {}) => ({
  id: `cs_live_${Math.random().toString(36).slice(2, 12)}`, object: 'checkout.session', mode: 'subscription', status: 'complete',
  payment_status: 'paid', client_reference_id: UID, customer: 'cus_PAYEUR', created: 1794000000, payment_link: MENSUEL, ...o,
})
const abonnement = (o = {}) => ({
  id: 'sub_CARNET', status: 'active', customer: 'cus_PAYEUR', metadata: {},
  items: { data: [{ price: { id: 'price_1U9QKMEAT4qWdUNVv0OSIusl', product: S.CARNET_PREMIUM_PRODUIT } }] }, ...o,
})

/**
 * Un faux Stripe : `sessions` par lien de paiement, `clients` (id, email),
 * `abonnements` par client. `pannes` : appel -> code HTTP rendu. Chaque appel
 * est note (chemin, cle) dans `appels`.
 */
function fauxStripe({ sessions = {}, clients = [], abonnements = {}, pannes = {} } = {}) {
  const appels = []
  const lireListe = async (chemin, appel, cle) => {
    appels.push({ chemin, appel, cle })
    if (appel in pannes) return { ok: false, statut: pannes[appel] }
    const u = new URL(`https://api.stripe.com${chemin}`)
    const q = u.searchParams
    if (u.pathname === '/v1/checkout/sessions') {
      assert.equal(cle, 'sessions', 'les sessions se lisent avec la cle des sessions')
      assert.equal(q.get('status'), 'complete')
      const depuis = Number(q.get('created[gte]') ?? 0)
      return { ok: true, data: (sessions[q.get('payment_link')] ?? []).filter(s => s.created >= depuis) }
    }
    assert.equal(cle, 'carnet', `${appel} : cle du Carnet`)
    if (u.pathname === '/v1/subscriptions') return { ok: true, data: abonnements[q.get('customer')] ?? [] }
    if (u.pathname === '/v1/customers') return { ok: true, data: clients.filter(c => c.email === q.get('email')) }
    if (u.pathname === '/v1/customers/search') {
      const cherche = /email:'(.*)'/.exec(q.get('query'))[1].toLowerCase()
      return { ok: true, data: clients.filter(c => c.email.toLowerCase() === cherche) }
    }
    throw new Error(`appel inattendu ${chemin}`)
  }
  return { lireListe, appels }
}

const reconnaitre = (stripe, o = {}) =>
  C.reconnaitreCarnet({ compte: UID, email: EMAIL_COMPTE, lire: stripe.lireListe, index: C.creerIndexReferences(), ...o })

// ── Le cas du correctif ─────────────────────────────────────────────────────

await bloc('email different chez Stripe, client_reference_id present : acces ouvert, par le compte', async () => {
  // Le client Stripe porte l'adresse tapee au paiement, pas celle du compte : l'email seul ne le trouvait pas.
  const stripe = fauxStripe({
    sessions: { [MENSUEL]: [session()] },
    clients: [{ id: 'cus_PAYEUR', email: EMAIL_STRIPE }],
    abonnements: { cus_PAYEUR: [abonnement()] },
  })
  assert.deepEqual(await reconnaitre(stripe), { oui: true, sur: true, par: 'compte' })
  // Avant le correctif (email seul) : aucun client a l'email du compte, donc non.
  assert.deepEqual(await reconnaitre(stripe, { compte: null }), { oui: false, sur: true, par: null })
  assert.deepEqual(await reconnaitre(stripe, { index: null }), { oui: false, sur: true, par: null })
})

await bloc('le compte d abord : les sessions des deux liens sont lues avant tout email, l email n est pas lu si le compte suffit', async () => {
  const stripe = fauxStripe({ sessions: { [ANNUEL]: [session({ payment_link: ANNUEL })] }, abonnements: { cus_PAYEUR: [abonnement()] } })
  assert.deepEqual(await reconnaitre(stripe), { oui: true, sur: true, par: 'compte' })
  const ordre = stripe.appels.map(a => a.appel)
  assert.deepEqual(ordre, ['checkout/sessions', 'checkout/sessions', 'subscriptions'])
  assert.deepEqual(stripe.appels.slice(0, 2).map(a => new URL(`https://x${a.chemin}`).searchParams.get('payment_link')), [MENSUEL, ANNUEL])
})

await bloc('repli par email : sans session du compte, l abonne a l email exact passe (liste puis recherche), comme avant', async () => {
  const parListe = fauxStripe({ clients: [{ id: 'cus_A', email: EMAIL_COMPTE }], abonnements: { cus_A: [abonnement({ customer: 'cus_A' })] } })
  assert.deepEqual(await reconnaitre(parListe), { oui: true, sur: true, par: 'email' })
  // Majuscules chez Stripe : la liste (sensible a la casse) ne le voit pas, la recherche si.
  const parRecherche = fauxStripe({ clients: [{ id: 'cus_B', email: 'Eleve@Exemple.fr' }], abonnements: { cus_B: [abonnement({ customer: 'cus_B' })] } })
  assert.deepEqual(await reconnaitre(parRecherche), { oui: true, sur: true, par: 'email' })
  assert.ok(parRecherche.appels.some(a => a.appel === 'customers/search'))
  // Un email voisin remonte par la recherche ne compte pas.
  const voisin = fauxStripe({ clients: [{ id: 'cus_C', email: 'jean.eleve@exemple.fr' }], abonnements: { cus_C: [abonnement()] } })
  const r = await C.reconnaitreCarnet({ compte: null, email: 'eleve@exemple.fr', lire: async (chemin, appel, cle) => {
    if (appel === 'customers/search') return { ok: true, data: [{ id: 'cus_C', email: 'jean.eleve@exemple.fr' }] }
    return voisin.lireListe(chemin, appel, cle)
  }, index: null })
  assert.deepEqual(r, { oui: false, sur: true, par: null })
})

await bloc('le compte d un autre, un abonnement arrete ou d un autre produit : pas d acces', async () => {
  const autre = fauxStripe({ sessions: { [MENSUEL]: [session({ client_reference_id: UID2 })] }, abonnements: { cus_PAYEUR: [abonnement()] } })
  assert.deepEqual(await reconnaitre(autre), { oui: false, sur: true, par: null })
  for (const ab of [abonnement({ status: 'canceled' }), abonnement({ status: 'incomplete' }), abonnement({ status: 'incomplete_expired' }),
    abonnement({ items: { data: [{ price: { product: 'prod_AUTRE' } }] } })]) {
    const s = fauxStripe({ sessions: { [MENSUEL]: [session()] }, abonnements: { cus_PAYEUR: [ab] } })
    assert.deepEqual(await reconnaitre(s), { oui: false, sur: true, par: null }, ab.status)
  }
  // Essai et impaye en relance ouvrent, comme par email.
  for (const status of ['trialing', 'past_due']) {
    const s = fauxStripe({ sessions: { [MENSUEL]: [session()] }, abonnements: { cus_PAYEUR: [abonnement({ status })] } })
    assert.equal((await reconnaitre(s)).oui, true, status)
  }
})

await bloc('referenceDeSession : session d abonnement terminee, uuid (minuscules), client cus_ ; le reste est ignore', () => {
  assert.deepEqual(C.referenceDeSession(session({ client_reference_id: UID.toUpperCase() })), { compte: UID, client: 'cus_PAYEUR' })
  assert.deepEqual(C.referenceDeSession(session({ customer: { id: 'cus_DEPLIE' } })), { compte: UID, client: 'cus_DEPLIE' })
  // Paiement en attente (SEPA) : la session compte, c'est l'abonnement qui dira.
  assert.deepEqual(C.referenceDeSession(session({ payment_status: 'unpaid' })), { compte: UID, client: 'cus_PAYEUR' })
  for (const o of [{ status: 'open' }, { status: 'expired' }, { mode: 'payment' }, { client_reference_id: null }, { client_reference_id: 'pas-un-uuid' },
    { client_reference_id: `${UID} x` }, { customer: null }, { customer: 'acct_X' }]) {
    assert.equal(C.referenceDeSession(session(o)), null, JSON.stringify(o))
  }
  assert.equal(C.referenceDeSession(null), null)
  assert.equal(C.referenceDeSession('cs_x'), null)
})

await bloc('index : relu au plus une fois par minute, puis seulement depuis la derniere lecture moins 25 h ; une session tardive est vue', async () => {
  const sessions = { [MENSUEL]: [] }
  const stripe = fauxStripe({ sessions, abonnements: { cus_PAYEUR: [abonnement()] } })
  const index = C.creerIndexReferences()
  const t0 = 1794000000 * 1000
  assert.deepEqual(await index.clientsDe(UID, stripe.lireListe, t0), { clients: [], sur: true })
  const premiere = stripe.appels.filter(a => a.appel === 'checkout/sessions')
  assert.equal(premiere.length, 2)
  assert.ok(premiere.every(a => !a.chemin.includes('created')), 'premiere lecture : tout')
  // Dans la minute : pas de relecture.
  await index.clientsDe(UID, stripe.lireListe, t0 + 30_000)
  assert.equal(stripe.appels.length, 2)
  // Une session ouverte 20 h avant la premiere lecture, terminee apres : vue a la relecture suivante.
  sessions[MENSUEL].push(session({ created: 1794000000 - 20 * 3600 }))
  const r = await index.clientsDe(UID, stripe.lireListe, t0 + 61_000)
  assert.deepEqual(r, { clients: ['cus_PAYEUR'], sur: true })
  const borne = new URL(`https://x${stripe.appels.at(-1).chemin}`).searchParams.get('created[gte]')
  assert.equal(Number(borne), 1794000000 - C.MARGE_SESSIONS_S)
  // Deux verifications simultanees partagent la lecture.
  const avant = stripe.appels.length
  await Promise.all([index.clientsDe(UID, stripe.lireListe, t0 + 200_000), index.clientsDe(UID2, stripe.lireListe, t0 + 200_001)])
  assert.equal(stripe.appels.length - avant, 2)
})

await bloc('index : pagination par starting_after, 100 par page, 10 pages au plus par lien', async () => {
  const beaucoup = Array.from({ length: 250 }, (_, i) => session({ id: `cs_live_${String(i).padStart(4, '0')}`, client_reference_id: i === 249 ? UID : UID2, customer: i === 249 ? 'cus_DERNIER' : 'cus_X' }))
  const appels = []
  const lireListe = async (chemin, appel) => {
    appels.push(chemin)
    const q = new URL(`https://x${chemin}`).searchParams
    if (q.get('payment_link') !== MENSUEL) return { ok: true, data: [] }
    const apres = q.get('starting_after')
    const debut = apres ? beaucoup.findIndex(s => s.id === apres) + 1 : 0
    return { ok: true, data: beaucoup.slice(debut, debut + Number(q.get('limit'))) }
  }
  const r = await C.creerIndexReferences().clientsDe(UID, lireListe, 0)
  assert.deepEqual(r, { clients: ['cus_DERNIER'], sur: true })
  assert.equal(appels.filter(c => c.includes(MENSUEL)).length, 3)
  const borne = C.creerIndexReferences({ pagesMax: 2 })
  assert.deepEqual((await borne.clientsDe(UID, lireListe, 0)).clients, [])
})

await bloc('pannes : passagere = reponse pas sure (le non ne se garde pas) ; cle sans droit sur les sessions = l email decide comme avant', async () => {
  const base = { clients: [], abonnements: {} }
  for (const code of [500, 503, 429, 0]) {
    const s = fauxStripe({ ...base, pannes: { 'checkout/sessions': code } })
    assert.deepEqual(await reconnaitre(s), { oui: false, sur: false, par: null }, String(code))
  }
  for (const code of [401, 403, 400]) {
    const s = fauxStripe({ ...base, pannes: { 'checkout/sessions': code } })
    assert.deepEqual(await reconnaitre(s), { oui: false, sur: true, par: null }, String(code))
  }
  // Un delai depasse sur les sessions : passager, l'email est quand meme lu.
  const lent = fauxStripe({ clients: [{ id: 'cus_A', email: EMAIL_COMPTE }], abonnements: { cus_A: [abonnement({ customer: 'cus_A' })] } })
  const r = await reconnaitre({ lireListe: async (chemin, appel, cle) => {
    if (appel === 'checkout/sessions') { const e = new Error('delai'); e.name = 'TimeoutError'; throw e }
    return lent.lireListe(chemin, appel, cle)
  } })
  assert.deepEqual(r, { oui: true, sur: true, par: 'email' })
  // Abonnement illisible du client du compte : pas sur, l'email est essaye ensuite.
  const sub = fauxStripe({ sessions: { [MENSUEL]: [session()] }, pannes: { subscriptions: 500 } })
  assert.deepEqual(await reconnaitre(sub), { oui: false, sur: false, par: null })
  // Liste des clients en panne : pas sur, pas de recherche (comme avant).
  const clients = fauxStripe({ pannes: { customers: 403 } })
  assert.deepEqual(await reconnaitre(clients, { compte: null }), { oui: false, sur: false, par: null })
  assert.ok(!clients.appels.some(a => a.appel === 'customers/search'))
})

await bloc('un client deja relu par le compte ne l est pas une seconde fois par l email', async () => {
  const stripe = fauxStripe({
    sessions: { [MENSUEL]: [session()] },
    clients: [{ id: 'cus_PAYEUR', email: EMAIL_COMPTE }],
    abonnements: { cus_PAYEUR: [abonnement({ status: 'canceled' })] },
  })
  assert.deepEqual(await reconnaitre(stripe), { oui: false, sur: true, par: null })
  assert.equal(stripe.appels.filter(a => a.appel === 'subscriptions').length, 1)
})

await bloc('branchement : entitlements passe le compte, lit les sessions avec la cle des sessions, et les liens sont ceux du Carnet', () => {
  const e = lire('../src/lib/entitlements.ts')
  assert.match(e, /if \(await hasCarnetPremium\(userId, email\)\) \{/)
  assert.match(e, /const r = await reconnaitreCarnet\(\{\n\s+compte: userId,\n\s+email,\n\s+index: indexReferencesCarnet,/)
  assert.match(e, /produit: CARNET_PREMIUM_PRODUCT,/)
  assert.match(e, new RegExp(`CARNET_PREMIUM_PRODUCT = '${S.CARNET_PREMIUM_PRODUIT}'`))
  assert.match(e, /quelle === 'sessions' \? cleSessions : key/)
  assert.match(e, /if \(reponseSure\) ecrireCacheCarnet\(cle, false\)/)
  assert.match(e, /process\.env\.STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE\?\.trim\(\) \|\|/)
  assert.doesNotMatch(e, /from '\.\/pilotage-abonnement'|from '@\/lib\/pilotage-abonnement'/, 'pas de boucle d imports')
  // Les liens releves chez Stripe le 12/11/2026 (mensuel, annuel).
  assert.deepEqual([...C.LIENS_PAIEMENT_CARNET], ['plink_1U9QKNEAT4qWdUNVowL5u5Lt', 'plink_1UAR2DEAT4qWdUNVg5UXbGGU'])
  assert.equal(C.MARGE_SESSIONS_S, 25 * 3600)
  assert.equal(C.INDEX_FRAIS_MS, 60_000)
})

console.log(`\n${n} blocs ok`)
