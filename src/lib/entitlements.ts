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
import { CARNET_PREMIUM_PRODUIT, lireAbonnementsApp, type AbonnementsApp } from './soutien-pur'
import { estEquipe } from './academie/pur'
import { creerIndexReferences, reconnaitreCarnet, type Lecture } from './carnet-premium-pur'

// 'duo' (brief E1, 30/10/2026) : l'abonnement Premium Duo (Carnet + Pilotage,
// Stripe aoknowledge) ouvre le même palier que 'carnet-premium'.
// 'equipe' (09/11/2026) : le statut équipe AOK (profiles.role = 'admin',
// estEquipe), qui ouvre ce qu'ouvre un abonnement actif, sans abonnement.
export type MentoratReason = 'equipe' | 'etm' | 'manuel' | 'liveclub' | 'skool-vip' | 'skool-premium' | 'formation' | 'duo' | 'carnet-premium'

// Le produit « Carnet Premium » (5,99 €/mois) sur le Stripe aoknowledge,
// créé le 28/08/2026. La vérification en direct donne l'accès IMMÉDIAT après
// paiement, sans attendre la synchro cockpit du lendemain matin.
const CARNET_PREMIUM_PRODUCT = 'prod_V9jniZCCbIJsmV'
//
// Reconnaissance (12/11/2026, correctif Payment Link, carnet-premium-pur.ts) :
// d'abord le compte posé par l'extension en client_reference_id sur le lien de
// paiement, puis l'email en repli. Avant, l'email seul : un acheteur qui
// changeait d'email dans Stripe payait sans avoir l'accès.

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

// Les sessions Checkout des liens de paiement (lues pour le client_reference_id) :
// la clé des sessions du Carnet (STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE, celle
// de /api/carnet/soutien), sinon celle de Pilotage puis de l'académie (même
// chaîne que clePilotage, recopiée ici : l'importer ferait une boucle
// d'imports par academie/droits), sinon celle du Carnet. Même compte Stripe.
function cleSessionsCarnet(): string | null {
  return (
    process.env.STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE?.trim() ||
    process.env.STRIPE_PILOTAGE_KEY_AOKNOWLEDGE?.trim() ||
    process.env.STRIPE_CHECKOUT_KEY_AOKNOWLEDGE?.trim() ||
    process.env.STRIPE_AGENT_KEY_AOKNOWLEDGE?.trim() ||
    stripeKeyCarnet()
  )
}

// L'index compte -> clients Stripe des liens de paiement, un par instance.
const indexReferencesCarnet = creerIndexReferences()

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

// Une fois par appel et par code (12/11/2026 : par appel aussi, pour qu'un 403
// des sessions Checkout ne soit pas tu par un 403 deja signale ailleurs).
function signalerErreurStripe(appel: string, status: number) {
  const code = status >= 500 ? '5xx' : String(status)
  if (codesStripeSignales.has(`${appel}:${code}`)) return
  codesStripeSignales.add(`${appel}:${code}`)
  console.error(
    `[entitlements] Stripe ${appel} a répondu ${status} : vérif Carnet Premium en échec (code ${code} signalé une seule fois par instance).`
  )
}

type ClientStripe = { id: string; email?: string | null }

// La liste `data` de la réponse, ou le code de l'erreur HTTP. Un délai dépassé
// remonte en exception (TimeoutError), traitée par l'appelant.
async function lireStripeBrut(chemin: string, key: string, appel: string): Promise<Lecture> {
  const res = await fetch(`https://api.stripe.com${chemin}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(STRIPE_DELAI_MS),
  })
  if (!res.ok) {
    signalerErreurStripe(appel, res.status)
    return { ok: false, statut: res.status }
  }
  const data = (await res.json()).data
  return { ok: true, data: Array.isArray(data) ? data : [] }
}

// La liste `data` de la réponse, ou null si Stripe répond une erreur HTTP.
async function lireStripe<T>(chemin: string, key: string, appel: string): Promise<T[] | null> {
  const r = await lireStripeBrut(chemin, key, appel)
  return r.ok ? (r.data as T[]) : null
}

// Le compte (client_reference_id des liens de paiement) d'abord, l'email en
// repli : reconnaitreCarnet (carnet-premium-pur.ts). Le cache reste par email
// (un compte = un email) ; un « non » ne s'y garde que si toutes les lectures
// ont abouti.
async function hasCarnetPremium(userId: string, email: string): Promise<boolean> {
  const key = stripeKeyCarnet()
  if (!key) return false // clé absente : les autres voies d'accès suffisent
  const cle = email.toLowerCase().trim()
  const enCache = lireCacheCarnet(cle)
  if (enCache !== null) return enCache

  let reponseSure = true // passe à false dès qu'une lecture Stripe échoue
  try {
    const cleSessions = cleSessionsCarnet() ?? key
    const r = await reconnaitreCarnet({
      compte: userId,
      email,
      index: indexReferencesCarnet,
      produit: CARNET_PREMIUM_PRODUCT,
      lire: (chemin, appel, quelle) => lireStripeBrut(chemin, quelle === 'sessions' ? cleSessions : key, appel),
    })
    if (r.oui) {
      ecrireCacheCarnet(cle, true)
      return true
    }
    reponseSure = r.sur
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

// Le soutien du Carnet (11/11/2026, soutien-pur.ts) : l'abonnement Carnet
// Premium du compte, et s'il est marque soutien=1. Lu a part de
// hasCarnetPremium, qui ne tourne pas pour un membre du Club (son acces vient
// de sa formule) : ici on regarde l'abonnement meme quand le Premium est
// compris. La liste par email seulement (le soutien s'achete depuis le compte,
// email pre-rempli en minuscules). Memes garde-fous : 3 s par appel, cache 5
// min des reponses sures (500 entrees), null quand Stripe ne repond pas.
const CACHE_SOUTIEN_MS = 5 * 60 * 1000
const cacheSoutienCarnet = new Map<string, { vu: AbonnementsApp; expire: number }>()

export function oublierSoutienCarnet(email: string) {
  cacheSoutienCarnet.delete(email.toLowerCase().trim())
}

export async function abonnementCarnetDe(email: string | null): Promise<AbonnementsApp | null> {
  const key = stripeKeyCarnet()
  if (!key || !email) return null
  const cle = email.toLowerCase().trim()
  const enCache = cacheSoutienCarnet.get(cle)
  if (enCache && enCache.expire > Date.now()) return enCache.vu
  try {
    const clients = await lireStripe<ClientStripe>(`/v1/customers?email=${encodeURIComponent(cle)}&limit=10`, key, 'customers')
    if (!clients) return null
    let vu: AbonnementsApp = { actif: false, soutien: false, abonnement: null, client: null }
    for (const c of clients) {
      if ((c.email ?? '').toLowerCase().trim() !== cle) continue
      const subs = await lireStripe<unknown>(`/v1/subscriptions?customer=${c.id}&limit=20`, key, 'subscriptions')
      if (!subs) return null
      const lu = lireAbonnementsApp(subs, CARNET_PREMIUM_PRODUIT)
      if (lu.soutien) { vu = lu; break }
      if (lu.actif && !vu.actif) vu = lu
    }
    if (cacheSoutienCarnet.size >= CACHE_MAX) cacheSoutienCarnet.clear()
    cacheSoutienCarnet.set(cle, { vu, expire: Date.now() + CACHE_SOUTIEN_MS })
    return vu
  } catch (err) {
    const nom = (err as { name?: string } | null)?.name
    console.warn(`[entitlements] soutien du Carnet illisible (${nom === 'TimeoutError' || nom === 'AbortError' ? 'delai' : 'erreur'})`)
    return null
  }
}

export interface MentoratAccess {
  entitled: boolean
  reason: MentoratReason | null
  email: string | null
}

export async function checkMentoratAccess(userId: string): Promise<MentoratAccess> {
  // L'email du compte connecté (Supabase Auth, même base) et son rôle métier
  // (profiles.role, lu dans la même requête pour le statut équipe).
  const users = await prisma.$queryRaw<{ email: string | null; role: string | null }[]>`
    select u.email, p.role::text as role
    from auth.users u left join public.profiles p on p.id = u.id
    where u.id = ${userId}::uuid limit 1
  `
  const email = users[0]?.email?.toLowerCase().trim() ?? null
  if (!email) return { entitled: false, reason: null, email: null }

  // -1. Le statut équipe AOK (09/11/2026, Brice : « je suis l'administrateur
  // principal [...] on a un statut à part ») : Brice, Mélanie, Adil, Adrien.
  // Il ouvre ce qu'ouvre un abonnement actif, sans abonnement ni Stripe.
  if (estEquipe(users[0]?.role)) return { entitled: true, reason: 'equipe', email }

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

  // 2 bis. Le pack Formation complète (1 999 €) ouvre aussi les apps, comme le
  // rang Premium de Skool le faisait (décision Brice 18/10/2026). Lu dans
  // academie_acces par email ou par compte : actif = non retiré, commencé,
  // sans fin ou fin future.
  const pack = await prisma.$queryRaw<{ un: number }[]>`
    select 1 as un
    from academie_acces a
    join academie_offres o on o.id = a.offre_id
    where o.slug = 'formation-complete'
      and a.retire_le is null and a.debut <= now() and (a.fin is null or a.fin > now())
      and (a.user_id = ${userId}::uuid or a.email = ${email})
    limit 1
  `
  if (pack.length > 0) return { entitled: true, reason: 'formation', email }

  // 2 ter. L'abonnement Premium Duo (brief E1, 30/10/2026) : le Carnet Premium
  // et Pilotage Premium. Le droit est une ligne academie_acces posée par la
  // confirmation de la page et le webhook de Pilotage (fin = fin de la période
  // payée + 3 jours), lue comme le pack Formation.
  const duo = await prisma.$queryRaw<{ un: number }[]>`
    select 1 as un
    from academie_acces a
    join academie_offres o on o.id = a.offre_id
    where o.slug in ('premium-duo-mensuel', 'premium-duo-annuel')
      and a.retire_le is null and a.debut <= now() and (a.fin is null or a.fin > now())
      and (a.user_id = ${userId}::uuid or a.email = ${email})
    limit 1
  `
  if (duo.length > 0) return { entitled: true, reason: 'duo', email }

  // 3. Abonnement Carnet Premium (Stripe aoknowledge, vérif en direct :
  // l'accès s'ouvre dans la minute qui suit le paiement). Le compte d'abord
  // (client_reference_id du lien de paiement), l'email en repli.
  if (await hasCarnetPremium(userId, email)) {
    return { entitled: true, reason: 'carnet-premium', email }
  }

  return { entitled: false, reason: null, email }
}
