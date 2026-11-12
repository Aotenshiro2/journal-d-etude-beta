// « Gérer mon abonnement » depuis Mon espace (12/11/2026, correctif) : les
// abonnements ranges par client Stripe, les libelles, la lecture d'un abonnement
// Pilotage, le client demande par la page, et la route (compte du jeton, client
// relu avant d'ouvrir le portail, retour sur Mon espace > Achats, Live Club
// jamais dedans). Aucune base, aucun reseau, aucun appel a Stripe.
// node scripts/verifier-portail-abonnements.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const P = await import('../src/lib/portail-abonnements-pur.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const A = 'cus_AAAAAAAAAAAA'
const B = 'cus_BBBBBBBBBBBB'

await bloc('libelles : Duo, Pilotage, Carnet, soutiens', () => {
  assert.equal(P.libelleAbonnement({ app: 'duo', soutien: false }), 'Premium Duo (Carnet et Pilotage)')
  assert.equal(P.libelleAbonnement({ app: 'pilotage', soutien: false }), 'Pilotage Premium')
  assert.equal(P.libelleAbonnement({ app: 'pilotage', soutien: true }), 'Soutien de Pilotage')
  assert.equal(P.libelleAbonnement({ app: 'carnet', soutien: false }), 'Carnet Premium')
  assert.equal(P.libelleAbonnement({ app: 'carnet', soutien: true }), 'Soutien du Carnet')
  assert.equal(P.libelleAbonnement({ app: 'aok', soutien: true }), 'Soutien AOKnowledge')
})

await bloc('groupes : un portail par client, ordre Duo, Pilotage, Carnet, AOK, sans doublon', () => {
  const g = P.grouperParClient([
    { app: 'aok', soutien: true, client: B },
    null,
    undefined,
    { app: 'carnet', soutien: false, client: A },
    { app: 'pilotage', soutien: false, client: A },
    { app: 'carnet', soutien: false, client: A },
    { app: 'duo', soutien: false, client: B },
  ])
  assert.deepEqual(g, [
    { client: B, abonnements: ['Premium Duo (Carnet et Pilotage)', 'Soutien AOKnowledge'] },
    { client: A, abonnements: ['Pilotage Premium', 'Carnet Premium'] },
  ])
  assert.deepEqual(P.grouperParClient([]), [])
})

await bloc('groupes : un client mal forme ou une app inconnue est ignore', () => {
  assert.deepEqual(P.grouperParClient([
    { app: 'carnet', soutien: false, client: 'sub_123456789' },
    { app: 'carnet', soutien: false, client: '' },
    { app: 'liveclub', soutien: false, client: A },
  ]), [])
})

await bloc('client demande : cus_ seulement, rien d\'autre', () => {
  assert.equal(P.lireClientDemande({ client: A }), A)
  for (const c of [null, undefined, [], 'cus_x', {}, { client: 'sub_ABCDEFGHIJ' }, { client: 'cus_' }, { client: 'cus_abc def ghi' }, { client: 12 }, { client: `cus_${'a'.repeat(80)}` }]) {
    assert.equal(P.lireClientDemande(c), null, JSON.stringify(c))
  }
})

await bloc('client du membre : seulement un client de ses groupes', () => {
  const g = [{ client: A, abonnements: ['Carnet Premium'] }]
  assert.equal(P.clientDuMembre(g, A), true)
  assert.equal(P.clientDuMembre(g, B), false)
  assert.equal(P.clientDuMembre([], A), false)
})

await bloc('abonnement Pilotage relu : actif, essai, impaye en relance ; client en texte ou objet ; soutien sur Pilotage seul', () => {
  assert.deepEqual(P.lireAbonnementPilotage({ status: 'active', customer: A, metadata: {} }, 'pilotage'), { app: 'pilotage', soutien: false, client: A })
  assert.deepEqual(P.lireAbonnementPilotage({ status: 'trialing', customer: { id: A }, metadata: { soutien: '1' } }, 'pilotage'), { app: 'pilotage', soutien: true, client: A })
  assert.deepEqual(P.lireAbonnementPilotage({ status: 'past_due', customer: A, metadata: { soutien: '1' } }, 'duo'), { app: 'duo', soutien: false, client: A })
  for (const status of ['canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused', undefined]) {
    assert.equal(P.lireAbonnementPilotage({ status, customer: A }, 'pilotage'), null, String(status))
  }
  assert.equal(P.lireAbonnementPilotage({ status: 'active', customer: null }, 'pilotage'), null)
  assert.equal(P.lireAbonnementPilotage(null, 'pilotage'), null)
})

await bloc('retour du portail : Mon espace > Achats', () => {
  assert.equal(P.RETOUR_PORTAIL, 'https://aoknowledge.com/mon-espace/parametres/achats')
})

await bloc('route : compte du jeton, client relu avant le portail, rien de sensible dans les logs', () => {
  const route = lire('../src/app/api/compte/portail/route.ts')
  assert.match(route, /compteDuJeton\(req\)/)
  assert.match(route, /clientDuMembre\(groupes, client\)/)
  assert.ok(route.indexOf('clientDuMembre(groupes, client)') < route.indexOf('sessionPortail(client)'), 'le client est verifie avant la session')
  assert.match(route, /'abonnement', 403/)
  assert.doesNotMatch(route, /console\.\w+\([^)]*\$\{(client|url|email)/)
  assert.match(route, /export async function GET/)
  assert.match(route, /export async function POST/)
})

await bloc('serveur : memes lectures que le badge, cle de Pilotage pour le portail, jamais le Live Club', () => {
  const s = lire('../src/lib/portail-abonnements.ts')
  assert.match(s, /abonnementCarnetDe\(adresse\)/)
  assert.match(s, /abonnementAokDe\(adresse\)/)
  assert.match(s, /abonnementsDuMembre\(userId, adresses\)/)
  assert.match(s, /portailDuClient\(clePilotage\(\), client, RETOUR_PORTAIL\)/)
  assert.doesNotMatch(s, /liveclub\/config|URL_PORTAIL_CARTE|STRIPE_.*MELANIE/i)
})

console.log(`\n${n} blocs verifies`)
