// Cree sur le Stripe Ao Knowledge un produit et un prix unique (EUR) par module
// de l'academie qui a un prix (academie_modules.prix_eur), puis pose
// stripe_product_id / stripe_price_id dans academie_modules et dans l'offre
// « module-<slug> » d'academie_offres. Decision Brice du 18/10/2026.
//
// Idempotent : un module qui a deja son stripe_price_id est saute, et la
// creation Stripe porte une Idempotency-Key par module. Aucun lien de paiement
// n'est cree : rien n'est en vente tant que la page d'achat n'existe pas.
// N'affiche jamais la cle.
//
// Lancement (depuis apps/journal-d-etude) :
//   set -a && . ./.env.local && set +a && node scripts/creer-produits-stripe-modules.mjs [--essai]

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const essai = process.argv.includes('--essai')
const coffre = JSON.parse(readFileSync('/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/stripe-api.local.json', 'utf8'))
const cle = coffre.comptes.find((c) => c.libelle === 'aoknowledge')?.secret_key
if (!cle) throw new Error('cle Stripe aoknowledge absente du coffre')

async function stripe(chemin, corps, idem) {
  const r = await fetch(`https://api.stripe.com/v1/${chemin}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idem },
    body: new URLSearchParams(corps),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Stripe ${chemin} ${r.status} : ${j.error?.message ?? 'erreur'}`)
  return j
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: modules, error } = await sb.from('academie_modules')
  .select('id, slug, titre, prix_eur, stripe_product_id, stripe_price_id').not('prix_eur', 'is', null).order('ordre')
if (error) throw error

for (const m of modules) {
  if (m.stripe_price_id) { console.log(`deja fait   ${m.slug}`); continue }
  const centimes = Math.round(Number(m.prix_eur) * 100)
  if (essai) { console.log(`a creer     ${m.slug} ${centimes / 100} EUR`); continue }
  const produit = m.stripe_product_id ? { id: m.stripe_product_id } : await stripe('products', {
    name: `Ao Knowledge - ${m.titre}`,
    'metadata[academie_module]': m.slug,
    'metadata[source]': 'academie',
  }, `academie-produit-${m.slug}`)
  const prix = await stripe('prices', {
    product: produit.id, currency: 'eur', unit_amount: String(centimes),
    'metadata[academie_module]': m.slug,
  }, `academie-prix-${m.slug}-${centimes}`)
  const u1 = await sb.from('academie_modules').update({ stripe_product_id: produit.id, stripe_price_id: prix.id }).eq('id', m.id)
  if (u1.error) throw u1.error
  const u2 = await sb.from('academie_offres').update({ stripe_product_id: produit.id, stripe_price_id: prix.id, canal: 'stripe_aok' })
    .eq('slug', `module-${m.slug}`)
  if (u2.error) throw u2.error
  console.log(`cree        ${m.slug} ${centimes / 100} EUR ${produit.id} ${prix.id}`)
}
