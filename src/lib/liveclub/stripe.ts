// Stripe pour le Live Club (compte melanie, 29/09). Lecture EN DIRECT : le
// droit d'entrer dans le groupe se decide sur ce que Stripe dit maintenant,
// pas sur la derniere collecte du cockpit.
//
// Toutes les fonctions JETTENT sur une panne (cle absente, reseau, Stripe qui
// refuse) : c'est a l'appelant d'en faire un 'inconnu', jamais un 'non'.
// latest_invoice est toujours expand (derniereFacture). La pause, elle, se date par
// les metadonnees posees avec elle (voir metadonneesPause dans pur.ts).

import { stripeGet, stripePost } from '@/lib/stripe-actions'
import { PRODUITS_LIVECLUB, cleStripeLecture, cleStripeEcriture, estProduitLiveClub } from './config'
import {
  type AbonnementResume, resumerAbonnement, preparerPoseDePause, metadonneesAdoption,
  effacementMetadonneesPause, nbMoisPauseValide, statutDonneDroit, normaliserEmail, requeteRechercheEmail,
} from './pur'

export type { AbonnementResume }

function cleLecture(): string {
  const cle = cleStripeLecture()
  if (!cle) throw new Error('STRIPE_READ_KEY_MELANIE et STRIPE_AGENT_KEY_MELANIE absentes du projet journal.')
  return cle
}

function cleEcriture(): string {
  const cle = cleStripeEcriture()
  if (!cle) throw new Error('STRIPE_AGENT_KEY_MELANIE absente du projet journal : pause et arret impossibles.')
  return cle
}

function introuvable(err: unknown): boolean {
  return /No such (subscription|checkout\.session|customer)/i.test(err instanceof Error ? err.message : String(err))
}

const ID_ABONNEMENT = /^sub_[A-Za-z0-9]{8,}$/
const ID_CLIENT = /^cus_[A-Za-z0-9]{8,}$/

/** Les abonnements Live Club d'un client Stripe (tous statuts). */
export async function abonnementsLiveClubDuClient(clientStripe: string): Promise<AbonnementResume[]> {
  if (!ID_CLIENT.test(clientStripe)) throw new Error('client Stripe invalide (cus_...).')
  const q = new URLSearchParams({ customer: clientStripe, status: 'all', limit: '100' })
  q.append('expand[]', 'data.latest_invoice')
  const liste = await stripeGet(cleLecture(), `/v1/subscriptions?${q}`)
  const data = (liste.data as Record<string, unknown>[] | undefined) ?? []
  return data
    .map(s => resumerAbonnement(s, PRODUITS_LIVECLUB))
    .filter((a): a is AbonnementResume => a !== null)
}

type ClientBrut = { id?: string; email?: string | null }

/**
 * Les clients Stripe (cus_...) qui portent cet email, SANS tenir compte de la
 * casse. Le filtre ?email= de GET /v1/customers est sensible a la casse (doc
 * Stripe) : Prenom.Nom@gmail.com saisi sur Checkout y serait invisible. On
 * passe donc par la recherche (/v1/customers/search, « : » insensible a la
 * casse), filtree ensuite sur l'egalite exacte en minuscules. La recherche
 * a jusqu'a une minute de retard sur un client tout neuf : la liste ?email=
 * en minuscules est ajoutee pour ce cas. Jette si l'un des deux appels echoue
 * (une liste vide doit vouloir dire « personne », pas « pas pu lire »).
 */
export async function clientsStripeParEmail(email: string): Promise<string[]> {
  const propre = normaliserEmail(email)
  if (!propre) return []
  const cle = cleLecture()
  const trouves = new Set<string>()
  const garder = (clients: ClientBrut[] | undefined) => {
    for (const c of clients ?? []) {
      const id = String(c.id ?? '')
      if (ID_CLIENT.test(id) && String(c.email ?? '').trim().toLowerCase() === propre) trouves.add(id)
    }
  }

  let page: string | null = null
  for (let n = 0; n < 5; n++) {
    const q = new URLSearchParams({ query: requeteRechercheEmail(propre), limit: '100' })
    if (page) q.set('page', page)
    const res = await stripeGet(cle, `/v1/customers/search?${q}`)
    garder(res.data as ClientBrut[] | undefined)
    page = res.has_more === true && typeof res.next_page === 'string' ? res.next_page : null
    if (!page) break
  }
  if (page) throw new Error('Trop de clients Stripe pour cet email : recherche incomplete.')

  const liste = await stripeGet(cle, `/v1/customers?${new URLSearchParams({ email: propre, limit: '100' })}`)
  garder(liste.data as ClientBrut[] | undefined)
  return [...trouves]
}

/** Les abonnements Live Club de tous les clients Stripe qui portent cet email. */
export async function abonnementsLiveClubParEmail(email: string): Promise<AbonnementResume[]> {
  const clients = await clientsStripeParEmail(email)
  const tous: AbonnementResume[] = []
  for (const c of clients) tous.push(...await abonnementsLiveClubDuClient(c))
  return tous
}

/** Un abonnement Live Club par son id. null s'il n'existe pas ou n'est pas Live Club. */
export async function lireAbonnement(abonnementId: string): Promise<AbonnementResume | null> {
  if (!ID_ABONNEMENT.test(abonnementId)) return null
  try {
    const sub = await stripeGet(cleLecture(), `/v1/subscriptions/${abonnementId}?expand[]=latest_invoice`)
    return resumerAbonnement(sub, PRODUITS_LIVECLUB)
  } catch (err) {
    if (introuvable(err)) return null
    throw err
  }
}

export type FiltreAbonnements = {
  /** Statut Stripe a lister ('all' par defaut, qui inclut les termines). */
  statut?: 'all' | 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete_expired' | 'paused'
  /** Garde-fou de pagination (100 par page). 50 par defaut. */
  maxPages?: number
}

/**
 * Tous les abonnements Live Club du compte, pagine (starting_after). Pour le
 * passage quotidien. Jette si une page echoue : une liste a moitie lue ne doit
 * pas faire croire qu'un abonnement n'existe plus.
 */
export async function listerAbonnementsLiveClub(filtre: FiltreAbonnements = {}): Promise<AbonnementResume[]> {
  const cle = cleLecture()
  const maxPages = Math.max(1, Math.min(filtre.maxPages ?? 50, 200))
  const resultat: AbonnementResume[] = []
  let apres: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ status: filtre.statut ?? 'all', limit: '100' })
    q.append('expand[]', 'data.latest_invoice')
    if (apres) q.set('starting_after', apres)
    const liste = await stripeGet(cle, `/v1/subscriptions?${q}`)
    const data = (liste.data as Record<string, unknown>[] | undefined) ?? []
    for (const s of data) {
      const r = resumerAbonnement(s, PRODUITS_LIVECLUB)
      if (r) resultat.push(r)
    }
    if (liste.has_more !== true || data.length === 0) return resultat
    apres = String(data[data.length - 1].id)
  }
  throw new Error(`Plus de ${maxPages} pages d'abonnements : liste incomplete, rien n'est decide dessus.`)
}

async function abonnementVivant(abonnementId: string): Promise<Record<string, unknown>> {
  if (!ID_ABONNEMENT.test(abonnementId)) throw new Error('abonnement invalide (sub_...).')
  const sub = await stripeGet(cleEcriture(), `/v1/subscriptions/${abonnementId}?expand[]=latest_invoice`)
  if (!resumerAbonnement(sub, PRODUITS_LIVECLUB)) throw new Error("Cet abonnement n'est pas un abonnement Live Club.")
  const statut = String(sub.status ?? '')
  if (!statutDonneDroit(statut)) {
    throw new Error(`L'abonnement est « ${statut} » : on ne touche qu'a un abonnement vivant.`)
  }
  return sub
}

function resumeOuErreur(sub: Record<string, unknown>): AbonnementResume {
  const r = resumerAbonnement(sub, PRODUITS_LIVECLUB)
  if (!r) throw new Error("Stripe a renvoye un abonnement qui n'est pas Live Club.")
  return r
}

/** Arret a la fin de la periode payee (cancel_at_period_end=true). Le statut reste 'active' jusque-la. */
export async function programmerArret(abonnementId: string): Promise<AbonnementResume> {
  await abonnementVivant(abonnementId)
  const sub = await stripePost(cleEcriture(), `/v1/subscriptions/${abonnementId}`, {
    cancel_at_period_end: 'true', 'expand[]': 'latest_invoice',
  })
  return resumeOuErreur(sub)
}

/**
 * Annule un arret programme tant que la periode court. Un arret peut etre
 * pose de deux facons : cancel_at_period_end (bot, agent) ou une date
 * cancel_at (Dashboard, « annuler a une date »). On leve celui qui est pose
 * (cancel_at_period_end=false, puis cancel_at vide si une date reste), et on
 * JETTE si Stripe rend encore un arret : jamais « c'est annule » a tort.
 */
export async function annulerArret(abonnementId: string): Promise<AbonnementResume> {
  const brut = await abonnementVivant(abonnementId)
  const avant = resumeOuErreur(brut)
  if (!avant.arretPrevu) throw new Error("Aucun arret n'est programme sur cet abonnement.")
  const cle = cleEcriture()
  const chemin = `/v1/subscriptions/${abonnementId}`
  let sub = brut
  if (sub.cancel_at_period_end === true) {
    sub = await stripePost(cle, chemin, { cancel_at_period_end: 'false', 'expand[]': 'latest_invoice' })
  }
  if (typeof sub.cancel_at === 'number') {
    // Une valeur vide efface le champ chez Stripe.
    sub = await stripePost(cle, chemin, { cancel_at: '', 'expand[]': 'latest_invoice' })
  }
  const apres = resumeOuErreur(sub)
  if (apres.arretPrevu) throw new Error("Stripe garde un arret programme sur cet abonnement : rien n'est annule.")
  return apres
}

export type IssuePause = {
  /** Fin de la periode deja payee (ISO) : l'acces court jusque-la. */
  payeJusquau: string
  /** Reprise automatique des prelevements (ISO). */
  repriseLe: string
  abonnement: AbonnementResume
}

/**
 * Pause de 1 a 6 mois, MEME REGLE que l'agent du cockpit (stripe-actions) :
 * la periode payee va a son terme, puis behavior=void annule chaque facture
 * jusqu'a resumes_at = fin de periode + nbMois. Refuse une pause deja posee
 * (la fin de periode ne serait plus celle payee) et un arret programme.
 */
export async function pauser(abonnementId: string, nbMois: number): Promise<IssuePause> {
  if (!nbMoisPauseValide(nbMois)) throw new Error('Duree de pause : un nombre entier de mois, de 1 a 6.')
  const sub = await abonnementVivant(abonnementId)
  const avant = resumeOuErreur(sub)
  if (avant.pauseActive) throw new Error('Une pause est deja posee sur cet abonnement.')
  if (avant.arretPrevu) throw new Error("Un arret est programme : il faut l'annuler avant de poser une pause.")
  // Meme pose que l'agent du cockpit (preparerPoseDePause, pur.ts) : les
  // metadonnees datent le debut de la pause, sans elles pauseEffective ne
  // passe jamais a vrai.
  const pose = preparerPoseDePause(sub, nbMois)
  const apres = await stripePost(cleEcriture(), `/v1/subscriptions/${abonnementId}`, {
    ...pose.corps,
    'expand[]': 'latest_invoice',
  })
  return {
    payeJusquau: new Date(pose.finPeriodeSec * 1000).toISOString(),
    repriseLe: pose.reprise.toISOString(),
    abonnement: resumeOuErreur(apres),
  }
}

export type IssueAdoption = {
  /** Fin de periode retenue comme fin payee (ISO). */
  payeJusquau: string
  /** Reprise posee (ISO), null pour une pause sans reprise. */
  repriseLe: string | null
  /** La fin payee deja notee a ete gardee (pause modifiee au Dashboard, seul le sceau change). */
  finGardee: boolean
  abonnement: AbonnementResume
}

/**
 * Adopte une pause posee ou modifiee hors de nos poses (Dashboard Stripe) :
 * relit l'abonnement EN DIRECT, et si la pause est toujours la et toujours
 * sans metadonnees valables (ou avec un sceau qui ne correspond plus), pose
 * les metadonnees seules (metadonneesAdoption, pur.ts : fin payee deja notee
 * gardee, sinon fin de periode vue maintenant ; reprise = resumes_at). La
 * pause elle-meme n'est pas touchee. null = plus rien a adopter (pause levee,
 * ou datee entre-temps). Jette sur une panne ou une cle d'ecriture absente.
 */
export async function adopterPause(abonnementId: string): Promise<IssueAdoption | null> {
  const sub = await abonnementVivant(abonnementId)
  const adoption = metadonneesAdoption(sub)
  if (!adoption) return null
  const apres = await stripePost(cleEcriture(), `/v1/subscriptions/${abonnementId}`, {
    ...adoption.corps,
    'expand[]': 'latest_invoice',
  })
  return {
    payeJusquau: new Date(adoption.finPeriodeSec * 1000).toISOString(),
    repriseLe: adoption.repriseSec === null ? null : new Date(adoption.repriseSec * 1000).toISOString(),
    finGardee: adoption.finGardee,
    abonnement: resumeOuErreur(apres),
  }
}

/**
 * Efface nos metadonnees de pause restees apres une levee faite HORS de
 * l'agent (Dashboard Stripe) : relit l'abonnement EN DIRECT et n'efface que
 * s'il n'a plus de pause active (une pose arrivee entre-temps garde les
 * siennes). Sans ce menage, une pause posee plus tard au Dashboard pourrait
 * reprendre une fin payee perimee. false = rien a effacer. Jette sur une
 * panne ou une cle d'ecriture absente.
 */
export async function effacerMetadonneesPause(abonnementId: string): Promise<boolean> {
  const sub = await abonnementVivant(abonnementId)
  if (!resumeOuErreur(sub).metaPauseRestante) return false
  await stripePost(cleEcriture(), `/v1/subscriptions/${abonnementId}`, effacementMetadonneesPause())
  return true
}

export type SessionCheckoutResume = {
  id: string
  /** status de la session : 'open' | 'complete' | 'expired'. */
  statut: string
  /** payment_status : 'paid' | 'unpaid' | 'no_payment_required'. */
  paiement: string
  /** complete ET (paid OU abonnement active/trialing). */
  payee: boolean
  /** Un des produits Live Club est dans les line_items (ou l'abonnement). */
  estLiveClub: boolean
  abonnementId: string | null
  abonnementStatut: string | null
  clientStripe: string | null
  email: string | null
  prenom: string | null
  /** created de la session, en ISO (null s'il manque). */
  creeLe: string | null
}

function premierMot(s: unknown): string | null {
  const mot = String(s ?? '').trim().split(/\s+/)[0]
  return mot ? mot.slice(0, 40) : null
}

/**
 * Une session Checkout du compte melanie (line_items et subscription expand).
 * null si elle n'existe pas sur ce compte. Le prenom vient d'un champ
 * personnalise dont la cle evoque le prenom, sinon du premier mot du nom.
 */
export async function lireSessionCheckout(sessionId: string): Promise<SessionCheckoutResume | null> {
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return null
  const q = new URLSearchParams()
  q.append('expand[]', 'line_items')
  q.append('expand[]', 'subscription')
  let s: Record<string, unknown>
  try {
    s = await stripeGet(cleLecture(), `/v1/checkout/sessions/${sessionId}?${q}`)
  } catch (err) {
    if (introuvable(err)) return null
    throw err
  }

  const lignes = ((s.line_items as { data?: { price?: { product?: unknown } }[] } | undefined)?.data ?? [])
  const produitsLignes = lignes.map(l => {
    const p = l.price?.product
    return typeof p === 'string' ? p : (p as { id?: string } | undefined)?.id
  })
  const sub = s.subscription && typeof s.subscription === 'object'
    ? s.subscription as Record<string, unknown>
    : null
  const abonnementId = sub ? String(sub.id ?? '') || null
    : typeof s.subscription === 'string' ? s.subscription : null
  const abonnementStatut = sub ? String(sub.status ?? '') || null : null
  const estLiveClub = produitsLignes.some(p => estProduitLiveClub(p))
    || Boolean(sub && resumerAbonnement(sub, PRODUITS_LIVECLUB))

  const statut = String(s.status ?? '')
  const paiement = String(s.payment_status ?? '')
  const payee = statut === 'complete'
    && (paiement === 'paid' || abonnementStatut === 'active' || abonnementStatut === 'trialing')

  const details = s.customer_details as { email?: string | null; name?: string | null } | null | undefined
  const champs = (s.custom_fields as { key?: string; text?: { value?: string | null } | null }[] | undefined) ?? []
  const champPrenom = champs.find(c => /pr[eé]nom|first/i.test(String(c.key ?? '')))?.text?.value
  const client = typeof s.customer === 'string' ? s.customer
    : (s.customer as { id?: string } | null | undefined)?.id ?? null

  return {
    id: String(s.id ?? sessionId),
    statut,
    paiement,
    payee,
    estLiveClub,
    abonnementId,
    abonnementStatut,
    clientStripe: client,
    email: normaliserEmail(details?.email ?? s.customer_email),
    prenom: premierMot(champPrenom) ?? premierMot(details?.name),
    creeLe: typeof s.created === 'number' ? new Date(s.created * 1000).toISOString() : null,
  }
}
