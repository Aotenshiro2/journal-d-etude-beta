// Cree sur le Stripe Ao Knowledge les deux produits de Pilotage et leurs prix
// recurrents (brief E1, 30/10/2026), puis pose stripe_product_id et
// stripe_price_id dans les quatre offres d'academie_offres (migration
// 20261031120000_pilotage_offres.sql) :
//   Pilotage Premium                  5,99 EUR par mois, 57 EUR par an
//   Premium Duo (Carnet + Pilotage)   8,99 EUR par mois, 79 EUR par an
// Le catalogue (prix, rythmes, noms) vient de src/lib/pilotage-paliers.ts : une
// seule source pour le script et le serveur.
//
// Idempotent, sans dependre de la base : le produit est retrouve chez Stripe
// par sa metadata pilotage_produit (recherche), le prix par son lookup_key
// (= slug de l'offre) ; une offre qui a deja son stripe_price_id est sautee ;
// chaque creation porte une Idempotency-Key. Aucun lien de paiement : la vente
// passe par /api/pilotage/achat (et reste fermee sans PILOTAGE_ACHAT_PUBLIC=1).
//
// --essai : lit seulement (base et Stripe en lecture), n'ecrit RIEN, dit ce qui
// serait cree. N'affiche jamais la cle.
//
// Lancement (depuis apps/journal-d-etude, Node 22) :
//   set -a && . ./.env.local && set +a && node scripts/creer-produits-stripe-pilotage.mjs [--essai]

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { CATALOGUE, NOMS_PRODUITS, SLUGS_OFFRES_PILOTAGE } from '../src/lib/pilotage-paliers.ts'

const essai = process.argv.includes('--essai')
const coffre = JSON.parse(readFileSync('/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/stripe-api.local.json', 'utf8'))
const cle = coffre.comptes.find((c) => c.libelle === 'aoknowledge')?.secret_key
if (!cle) throw new Error('cle Stripe aoknowledge absente du coffre')

async function stripe(methode, chemin, corps, idem) {
  const r = await fetch(`https://api.stripe.com/v1/${chemin}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${cle}`,
      ...(corps ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idem ? { 'Idempotency-Key': idem } : {}),
    },
    body: corps ? new URLSearchParams(corps) : undefined,
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Stripe ${methode} ${chemin.split('?')[0]} ${r.status} : ${j.error?.message ?? 'erreur'}`)
  return j
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: lignes, error } = await sb.from('academie_offres')
  .select('id, slug, prix_eur, stripe_product_id, stripe_price_id').in('slug', [...SLUGS_OFFRES_PILOTAGE])
if (error) throw new Error(`academie_offres illisible : ${error.message}`)
const enBase = new Map(lignes.map((l) => [l.slug, l]))
if (enBase.size < SLUGS_OFFRES_PILOTAGE.length) {
  const manquent = SLUGS_OFFRES_PILOTAGE.filter((s) => !enBase.has(s))
  const message = `offres absentes en base : ${manquent.join(', ')} (migration 20261031120000_pilotage_offres.sql pas appliquee ?)`
  if (!essai) throw new Error(message)
  console.log(`attention   ${message}`)
}

/** Le produit d'une famille : en base sur une de ses offres, sinon retrouve chez Stripe par sa metadata, sinon a creer. */
const produits = new Map()
async function produitDe(produit) {
  if (produits.has(produit)) return produits.get(produit)
  const deja = SLUGS_OFFRES_PILOTAGE.map((s) => enBase.get(s)).find((l) => l?.stripe_product_id && CATALOGUE[l.slug].produit === produit)
  let id = deja?.stripe_product_id ?? null
  if (!id) {
    const trouves = await stripe('GET', `products/search?query=${encodeURIComponent(`metadata['pilotage_produit']:'${produit}'`)}&limit=3`)
    id = trouves.data?.find((p) => p.active)?.id ?? null
  }
  if (!id && !essai) {
    const p = await stripe('POST', 'products', {
      name: NOMS_PRODUITS[produit],
      description: produit === 'premium-duo'
        ? 'Le Carnet Premium et Pilotage Premium ensemble.'
        : 'Pilotage : 200 lectures intelligentes sur 30 jours, documents longs lus en entier, coffre de 2 Go.',
      'metadata[pilotage_produit]': produit,
      'metadata[source]': 'pilotage',
    }, `pilotage-produit-${produit}`)
    id = p.id
    console.log(`cree        produit ${NOMS_PRODUITS[produit]} ${id}`)
  }
  produits.set(produit, id)
  return id
}

for (const slug of SLUGS_OFFRES_PILOTAGE) {
  const c = CATALOGUE[slug]
  const l = enBase.get(slug)
  const montant = `${c.centimes / 100} EUR / ${c.rythme === 'month' ? 'mois' : 'an'}`
  if (l?.stripe_price_id) { console.log(`deja fait   ${slug} ${l.stripe_price_id}`); continue }
  if (l && Math.round(Number(l.prix_eur) * 100) !== c.centimes) {
    throw new Error(`${slug} : prix en base ${l.prix_eur} EUR different du catalogue ${c.centimes / 100} EUR`)
  }
  const produit = await produitDe(c.produit)
  const existants = await stripe('GET', `prices?lookup_keys[]=${encodeURIComponent(slug)}&active=true&limit=3`)
  let prix = existants.data?.find((p) => p.unit_amount === c.centimes && p.recurring?.interval === c.rythme && (!produit || p.product === produit)) ?? null
  if (essai) {
    console.log(`${prix ? 'existe      ' : 'a creer     '}${slug} ${montant}${produit ? ` produit ${produit}` : ` produit ${NOMS_PRODUITS[c.produit]} a creer`}${prix ? ` prix ${prix.id}` : ''}`)
    continue
  }
  if (!prix) {
    prix = await stripe('POST', 'prices', {
      product: produit, currency: 'eur', unit_amount: String(c.centimes),
      'recurring[interval]': c.rythme,
      lookup_key: slug,
      nickname: c.titre,
      'metadata[pilotage_offre]': slug,
    }, `pilotage-prix-${slug}-${c.centimes}`)
    console.log(`cree        prix ${slug} ${montant} ${prix.id}`)
  }
  const u = await sb.from('academie_offres').update({ stripe_product_id: produit, stripe_price_id: prix.id }).eq('slug', slug)
  if (u.error) throw new Error(`${slug} : ecriture en base refusee : ${u.error.message}`)
  console.log(`pose        ${slug} ${produit} ${prix.id}`)
}
if (essai) console.log('essai : rien n a ete ecrit (ni chez Stripe ni en base)')
