// Droits d'accès au mode mentorat (décision Brice 28/08) : réservé aux
// membres — statut ETM, Live Club actif, Skool premium ou vip, ou accès
// accordé à la main (anciens formats « tout inclus », cas particuliers). Un
// simple inscrit newsletter n'y a pas droit.
//
// ETM (règle Brice 09/09/2026) : le mentorat privé (~4 000 € / 3 mois, payé
// par virement, très peu d'élèves) est un STATUT posé sur le membre depuis la
// fiche du cockpit (table cockpit_statut_etm). Il ouvre les apps et le ring
// VIP Skool ; il N'OUVRE PAS le Live Club, qui est un abonnement à part et se
// cumule. Ce n'est pas un grant manuel : le grant est un geste commercial
// posé sur un email, l'ETM dit qui la personne est pour nous.
//
// Source de vérité : les tables cockpit_* du même Postgres, alimentées chaque
// matin par AOK-Push-Membres (Stripe Mélanie + Skool). cockpit_membre_emails
// rattache TOUS les emails connus d'un membre : un élève connecté au journal
// avec son deuxième email est quand même reconnu. Le backend décide, jamais
// l'extension.
import { prisma } from './db'

export type MentoratReason = 'etm' | 'manuel' | 'liveclub' | 'skool-vip' | 'skool-premium' | 'carnet-premium'

// Le produit « Carnet Premium » (5,99 €/mois) sur le Stripe aoknowledge —
// créé le 28/08/2026. La vérification en direct donne l'accès IMMÉDIAT après
// paiement, sans attendre la synchro cockpit du lendemain matin.
const CARNET_PREMIUM_PRODUCT = 'prod_V9jniZCCbIJsmV'

// Nom de la variable (constat du 29/09/2026) : c'est STRIPE_KEY_CARNET_AOK qui
// est posée dans Vercel (production, depuis le 28/08) ; le code lisait
// STRIPE_KEY_CARNET, jamais posée, donc la vérif en direct répondait toujours
// non. Même leçon que pour les clés IA (src/lib/ai.ts) : accepter les deux noms.
let cleCarnetAbsenteSignalee = false

function stripeKeyCarnet(): string | null {
  const key = process.env.STRIPE_KEY_CARNET_AOK || process.env.STRIPE_KEY_CARNET || null
  if (!key && !cleCarnetAbsenteSignalee) {
    cleCarnetAbsenteSignalee = true
    console.warn(
      '[entitlements] Ni STRIPE_KEY_CARNET_AOK ni STRIPE_KEY_CARNET : vérif Carnet Premium en direct désactivée.'
    )
  }
  return key
}

// Garde-fous de la vérif en direct (relecture du 29/09/2026). Elle tourne à
// chaque appel IA d'un non-abonné (capture, mentorat, via ia-niveau.ts) : sans
// délai maximum ni cache, un Stripe lent faisait attendre toutes ces routes.
// - Chaque appel Stripe est coupé à 3 s. Un délai dépassé répond non SANS
//   mise en cache : l'élève qui vient de payer retente et passe.
// - Cache mémoire par email (minuscules) : oui 10 min, non 5 min, 500 entrées
//   au plus. Il vit dans l'instance (chaque instance Vercel a le sien, un
//   redémarrage le vide). Seules les réponses sûres y entrent : un non tiré
//   d'une erreur Stripe (401, 403, 429, 5xx, réseau) n'est pas gardé.
// - Une erreur HTTP est journalisée une fois par code et par instance, sans
//   clé ni email.
//
// Casse de l'email : le filtre email= de /v1/customers est sensible à la
// casse, nos emails sont en minuscules, un acheteur qui a tapé des majuscules
// sur Stripe n'était pas retrouvé. Choix : la liste d'abord (lecture
// immédiate, couvre l'achat de la minute et le cas courant), puis, si elle ne
// donne aucun abonné, /v1/customers/search (email:'...', insensible à la
// casse, mais indexé avec jusqu'à une minute de retard selon Stripe, d'où la
// liste en premier). La recherche demande le même droit de lecture des
// clients que la liste ; si la clé la refuse (403) ou si le compte n'y a pas
// accès (400), l'erreur est journalisée une fois et la réponse reste celle
// de la liste. Un second essai « avec l'email tel que stocké » n'apporterait
// rien : l'email passé ici est déjà en minuscules (auth.users + lower()).
const STRIPE_DELAI_MS = 3000
const CACHE_OUI_MS = 10 * 60 * 1000
const CACHE_NON_MS = 5 * 60 * 1000
const CACHE_MAX = 500

const cacheCarnet = new Map<string, { oui: boolean; expire: number }>()

function lireCacheCarnet(email: string): boolean | null {
  const entree = cacheCarnet.get(email)
  if (!entree) return null
  if (entree.expire <= Date.now()) {
    cacheCarnet.delete(email)
    return null
  }
  return entree.oui
}

function ecrireCacheCarnet(email: string, oui: boolean) {
  const maintenant = Date.now()
  cacheCarnet.delete(email) // réinsérée en fin : l'ordre de la Map reste l'âge
  if (cacheCarnet.size >= CACHE_MAX) {
    for (const [k, v] of cacheCarnet) if (v.expire <= maintenant) cacheCarnet.delete(k)
  }
  while (cacheCarnet.size >= CACHE_MAX) {
    const plusAncienne = cacheCarnet.keys().next().value
    if (plusAncienne === undefined) break
    cacheCarnet.delete(plusAncienne)
  }
  cacheCarnet.set(email, { oui, expire: maintenant + (oui ? CACHE_OUI_MS : CACHE_NON_MS) })
}

const codesStripeSignales = new Set<string>()

function signalerErreurStripe(appel: string, status: number) {
  const code = status >= 500 ? '5xx' : String(status)
  if (codesStripeSignales.has(code)) return
  codesStripeSignales.add(code)
  console.error(
    `[entitlements] Stripe ${appel} a répondu ${status} : vérif Carnet Premium en échec (code ${code} signalé une seule fois par instance).`
  )
}

type ClientStripe = { id: string; email?: string | null }
type AbonnementStripe = { status: string; items: { data: { price: { product: string } }[] } }

// La liste `data` de la réponse, ou null si Stripe répond une erreur HTTP. Un
// délai dépassé remonte en exception (TimeoutError), traitée par l'appelant.
async function lireStripe<T>(chemin: string, key: string, appel: string): Promise<T[] | null> {
  const res = await fetch(`https://api.stripe.com${chemin}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(STRIPE_DELAI_MS),
  })
  if (!res.ok) {
    signalerErreurStripe(appel, res.status)
    return null
  }
  return ((await res.json()).data ?? []) as T[]
}

async function hasCarnetPremium(email: string): Promise<boolean> {
  const key = stripeKeyCarnet()
  if (!key) return false // clé absente : les autres voies d'accès suffisent
  const cle = email.toLowerCase().trim()
  const enCache = lireCacheCarnet(cle)
  if (enCache !== null) return enCache

  let reponseSure = true // passe à false dès qu'une lecture Stripe échoue
  try {
    const clientsVus = new Set<string>()
    // Seuls les clients dont l email est EXACTEMENT celui de l utilisateur
    // comptent (casse ignoree) : la recherche Stripe n est pas une egalite
    // (bob@gmail.com peut remonter jean.bob@gmail.com), et ouvrir le
    // Premium au mauvais compte serait pire que de le refuser.
    const abonneParmi = async (clients: ClientStripe[]): Promise<boolean> => {
      for (const c of clients) {
        if ((c.email ?? '').toLowerCase().trim() !== cle) continue
        if (clientsVus.has(c.id)) continue
        clientsVus.add(c.id)
        const subs = await lireStripe<AbonnementStripe>(
          `/v1/subscriptions?customer=${c.id}&limit=20`,
          key,
          'subscriptions'
        )
        if (!subs) {
          reponseSure = false
          continue
        }
        if (
          subs.some(
            s =>
              (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due') &&
              s.items.data.some(i => i.price.product === CARNET_PREMIUM_PRODUCT)
          )
        ) {
          return true
        }
      }
      return false
    }

    const liste = await lireStripe<ClientStripe>(
      `/v1/customers?email=${encodeURIComponent(email)}&limit=10`,
      key,
      'customers'
    )
    if (!liste) {
      reponseSure = false // clé fausse, quota, panne : inutile d'insister avec la recherche
    } else {
      if (await abonneParmi(liste)) {
        ecrireCacheCarnet(cle, true)
        return true
      }
      const requete = `email:'${email.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      const trouves = await lireStripe<ClientStripe>(
        `/v1/customers/search?query=${encodeURIComponent(requete)}&limit=10`,
        key,
        'customers/search'
      )
      if (!trouves) {
        reponseSure = false
      } else if (await abonneParmi(trouves)) {
        ecrireCacheCarnet(cle, true)
        return true
      }
    }
  } catch (err) {
    const nom = (err as { name?: string } | null)?.name
    if (nom === 'TimeoutError' || nom === 'AbortError') {
      console.warn(
        `[entitlements] Stripe n'a pas répondu en ${STRIPE_DELAI_MS} ms : Carnet Premium répond non, sans mise en cache.`
      )
    } else {
      console.error('[entitlements] Stripe carnet-premium check failed:', err)
    }
    return false
  }
  if (reponseSure) ecrireCacheCarnet(cle, false)
  return false
}

export interface MentoratAccess {
  entitled: boolean
  reason: MentoratReason | null
  email: string | null
}

export async function checkMentoratAccess(userId: string): Promise<MentoratAccess> {
  // L'email du compte connecté (Supabase Auth, même base)
  const users = await prisma.$queryRaw<{ email: string | null }[]>`
    select email from auth.users where id = ${userId}::uuid limit 1
  `
  const email = users[0]?.email?.toLowerCase().trim() ?? null
  if (!email) return { entitled: false, reason: null, email: null }

  // 0. Statut ETM actif sur le membre, par n'importe lequel de ses emails.
  // Lu en premier : c'est le statut le plus haut, et il ne dépend ni de
  // Stripe ni du tier Skool exporté.
  const etm = await prisma.$queryRaw<{ un: number }[]>`
    select 1 as un
    from cockpit_statut_etm s
    join cockpit_membre_emails me on me.membre_id = s.membre_id
    where s.retire_le is null and lower(me.email) = ${email}
    limit 1
  `
  if (etm.length > 0) return { entitled: true, reason: 'etm', email }

  // 1. Accès accordé à la main (couvre les cas hors cockpit)
  const grant = await prisma.mentoratGrant.findFirst({
    where: { email, revokedAt: null },
  })
  if (grant) return { entitled: true, reason: 'manuel', email }

  // 2. Droits automatiques via le cockpit, par n'importe lequel de ses emails
  const rows = await prisma.$queryRaw<{ tier_skool: string | null; abonnement_en_cours: boolean | null }[]>`
    select e.tier_skool, e.abonnement_en_cours
    from cockpit_membre_emails me
    join cockpit_membres_etat e on e.membre_id = me.membre_id
    where lower(me.email) = ${email}
    limit 1
  `
  const m = rows[0]
  if (m) {
    if (m.abonnement_en_cours) return { entitled: true, reason: 'liveclub', email }
    if (m.tier_skool === 'vip') return { entitled: true, reason: 'skool-vip', email }
    if (m.tier_skool === 'premium') return { entitled: true, reason: 'skool-premium', email }
  }

  // 3. Abonnement Carnet Premium (Stripe aoknowledge, vérif en direct :
  // l'accès s'ouvre dans la minute qui suit le paiement)
  if (await hasCarnetPremium(email)) {
    return { entitled: true, reason: 'carnet-premium', email }
  }

  return { entitled: false, reason: null, email }
}
