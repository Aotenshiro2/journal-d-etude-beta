// Cree chez Stripe Ao Knowledge le webhook de la vente a l'unite de
// l'academie (19/10/2026) et pose son secret de signature dans Vercel
// (STRIPE_WEBHOOK_SECRET_ACADEMIE, production). N'affiche jamais ni la cle
// ni le secret.
//
// Idempotent : si l'adresse a deja un webhook, rien n'est cree (Stripe ne
// redonne pas le secret d'un webhook existant : le supprimer dans le tableau
// de bord pour en refaire un).
//
// Lancement (depuis apps/journal-d-etude, WSL, nvm charge) :
//   node scripts/creer-webhook-achat-academie.mjs [--essai]

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const URL_WEBHOOK = 'https://journal.aoknowledge.com/api/academie/achat/webhook'
const EVENEMENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded']
const essai = process.argv.includes('--essai')

const coffre = JSON.parse(readFileSync('/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/stripe-api.local.json', 'utf8'))
const cle = coffre.comptes.find((c) => c.libelle === 'aoknowledge')?.secret_key
if (!cle) throw new Error('cle Stripe aoknowledge absente du coffre')

async function stripe(chemin, corps) {
  const r = await fetch(`https://api.stripe.com/v1/${chemin}`, {
    method: corps ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${cle}`, 'Stripe-Version': '2025-09-30.clover', ...(corps ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: corps ? new URLSearchParams(corps) : undefined,
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Stripe ${chemin} ${r.status} : ${j.error?.type ?? 'erreur'}`)
  return j
}

const existants = await stripe('webhook_endpoints?limit=100')
const deja = existants.data.find((w) => w.url === URL_WEBHOOK)
if (deja) {
  console.log(`deja en place : ${deja.id} (${deja.status}), evenements ${deja.enabled_events.join(', ')}`)
  process.exit(0)
}
if (essai) { console.log(`a creer : ${URL_WEBHOOK} (${EVENEMENTS.join(', ')})`); process.exit(0) }

const corps = { url: URL_WEBHOOK, api_version: '2025-09-30.clover', description: 'Academie AOK : vente a l unite (journal)' }
EVENEMENTS.forEach((e, i) => { corps[`enabled_events[${i}]`] = e })
const w = await stripe('webhook_endpoints', corps)
console.log(`webhook cree : ${w.id}`)

const pose = spawnSync('npx', ['vercel', 'env', 'add', 'STRIPE_WEBHOOK_SECRET_ACADEMIE', 'production'], {
  input: w.secret, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8',
})
if (pose.status !== 0) {
  console.log('ECHEC de la pose dans Vercel : le secret est dans le tableau de bord Stripe (Developpeurs, Webhooks, ce webhook, « Signing secret »).')
  process.exit(1)
}
console.log('secret pose dans Vercel (production) : STRIPE_WEBHOOK_SECRET_ACADEMIE')
