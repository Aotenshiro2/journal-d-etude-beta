// Le Carnet Premium reconnu chez Stripe (12/11/2026, correctif « Payment Link ») :
// d'abord par le compte (client_reference_id), puis par l'email en repli.
//
// Avant : entitlements.ts ne reconnaissait l'abonne que par l'email du client
// Stripe. Le lien de paiement de l'extension pre-remplit l'email du compte,
// mais l'acheteur peut le changer dans Stripe : il payait et n'avait pas
// l'acces. L'extension pose pourtant le compte en client_reference_id
// (carnet-du-trader-extension, src/lib/offres.ts, lienPaiement), que personne
// ne lisait.
//
// Comme Pilotage (pilotage-paliers.ts, lireSessionPilotage) : le compte du
// client_reference_id d'abord (un uuid, mis en minuscules), l'email ensuite.
// Pilotage ecrit le droit en base depuis son webhook ; le Carnet n'a pas de
// table de droits (verification en direct, et ce correctif ne pose aucune
// migration). On lit donc chez Stripe les sessions terminees des deux liens de
// paiement du Carnet, rangees par compte dans la memoire de l'instance
// (creerIndexReferences), et l'abonnement de leur client est relu a chaque
// verification, exactement comme celui qu'on trouve par email : un abonnement
// arrete ferme l'acces de la meme facon par les deux chemins.
//
// Pur : aucun appel reseau ici. La lecture Stripe est injectee (LireListe), ce
// qui rejoue le chemin entier avec un faux Stripe
// (scripts/verifier-carnet-reference.mjs).

import { CARNET_PREMIUM_PRODUIT, lireAbonnementsApp } from './soutien-pur'

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const chaine = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const idDe = (v: unknown): string | null => chaine(v) ?? chaine(objet(v).id)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Les deux liens de paiement du Carnet Premium (compte Ao Knowledge, releves
 * chez Stripe le 12/11/2026) : mensuel buy.stripe.com/fZucN51..., annuel
 * buy.stripe.com/7sY00ja... (les URL de l'extension, offres.ts).
 */
export const LIENS_PAIEMENT_CARNET = ['plink_1U9QKNEAT4qWdUNVowL5u5Lt', 'plink_1UAR2DEAT4qWdUNVg5UXbGGU'] as const

/** Une session Checkout vit 24 h au plus : chaque relecture reprend 25 h avant la derniere relecture reussie. */
export const MARGE_SESSIONS_S = 25 * 3600
/** L'index est relu au plus une fois par minute et par instance. */
export const INDEX_FRAIS_MS = 60 * 1000
/** 100 sessions par page, 10 pages par lien et par relecture au plus. */
export const PAGES_MAX = 10

// ---------------------------------------------------------------------------
// La lecture Stripe (injectee)
// ---------------------------------------------------------------------------

/** Une liste Stripe : `data`, ou le code HTTP de l'erreur (0 = reseau). */
export type Lecture = { ok: true; data: unknown[] } | { ok: false; statut: number }

/**
 * Lit une liste Stripe (GET). `cle` : 'sessions' pour les sessions Checkout
 * (la cle des sessions du Carnet), 'carnet' pour les clients et les
 * abonnements (la cle du Carnet). Un delai depasse peut jeter.
 */
export type LireListe = (chemin: string, appel: string, cle: 'sessions' | 'carnet') => Promise<Lecture>

/**
 * Une erreur qui passera (reseau, quota, panne Stripe) : la reponse n'est pas
 * sure. Un 400, 401 ou 403 dit que la cle n'y a pas droit : durable, le chemin
 * par le compte est alors absent (signale dans les journaux), l'email decide
 * comme avant.
 */
export const erreurPassagere = (statut: number): boolean => statut === 0 || statut === 429 || statut >= 500

// ---------------------------------------------------------------------------
// Le compte d'une session
// ---------------------------------------------------------------------------

export type ReferenceCarnet = { compte: string; client: string }

/**
 * Une session Checkout d'un lien de paiement du Carnet : le compte qui l'a
 * ouverte (client_reference_id, un uuid) et le client Stripe qui paie. Seule
 * une session d'abonnement terminee compte ; le paiement lui-meme se juge sur
 * l'abonnement, relu a chaque verification.
 */
export function referenceDeSession(brut: unknown): ReferenceCarnet | null {
  const s = objet(brut)
  if (s.mode !== 'subscription' || s.status !== 'complete') return null
  const ref = chaine(s.client_reference_id)
  const client = idDe(s.customer)
  if (!ref || !UUID.test(ref) || !client || !client.startsWith('cus_')) return null
  return { compte: ref.toLowerCase(), client }
}

// ---------------------------------------------------------------------------
// L'index des comptes (memoire de l'instance)
// ---------------------------------------------------------------------------

export type ClientsDuCompte = { clients: string[]; sur: boolean }

export type IndexReferences = {
  /** Les clients Stripe qui ont paye un lien du Carnet ouvert par ce compte. `sur` : faux si Stripe n'a pas pu etre lu. */
  clientsDe(compte: string, lire: LireListe, maintenantMs?: number): Promise<ClientsDuCompte>
}

/**
 * L'index compte -> clients Stripe, tire des sessions terminees des liens de
 * paiement. La premiere lecture prend tout ; les suivantes, au plus une fois
 * par minute, ne reprennent que les sessions creees depuis la derniere lecture
 * reussie, moins MARGE_SESSIONS_S (une session ouverte avant et terminee apres
 * est ainsi vue). Il ne fait que grandir : c'est l'abonnement, relu a chaque
 * fois, qui dit si l'acces est ouvert. Deux verifications simultanees
 * partagent la meme lecture.
 */
export function creerIndexReferences(o: { liens?: readonly string[]; fraisMs?: number; pagesMax?: number } = {}): IndexReferences {
  const liens = o.liens ?? LIENS_PAIEMENT_CARNET
  const fraisMs = o.fraisMs ?? INDEX_FRAIS_MS
  const pagesMax = o.pagesMax ?? PAGES_MAX
  const parCompte = new Map<string, Set<string>>()
  let relueLe: number | null = null // debut (ms) de la derniere relecture reussie
  let tenteeLe = -Infinity
  let sur = false
  let enCours: Promise<void> | null = null

  async function relire(lire: LireListe, debutMs: number): Promise<void> {
    const depuis = relueLe === null ? 0 : Math.max(0, Math.floor(relueLe / 1000) - MARGE_SESSIONS_S)
    let issue: 'ok' | 'passagere' | 'durable' = 'ok'
    for (const lien of liens) {
      let apres: string | null = null
      for (let page = 0; page < pagesMax; page++) {
        const q = new URLSearchParams({ payment_link: lien, status: 'complete', limit: '100' })
        if (depuis > 0) q.set('created[gte]', String(depuis))
        if (apres) q.set('starting_after', apres)
        let r: Lecture
        try {
          r = await lire(`/v1/checkout/sessions?${q}`, 'checkout/sessions', 'sessions')
        } catch {
          r = { ok: false, statut: 0 } // delai depasse : passager
        }
        if (!r.ok) {
          if (erreurPassagere(r.statut)) issue = 'passagere'
          else if (issue === 'ok') issue = 'durable'
          break
        }
        for (const brut of r.data) {
          const ref = referenceDeSession(brut)
          if (!ref) continue
          const clients = parCompte.get(ref.compte) ?? new Set<string>()
          clients.add(ref.client)
          parCompte.set(ref.compte, clients)
        }
        const dernier = r.data.length ? chaine(objet(r.data[r.data.length - 1]).id) : null
        if (r.data.length < 100 || !dernier) break
        apres = dernier
      }
    }
    if (issue === 'ok') relueLe = debutMs
    sur = issue !== 'passagere'
  }

  return {
    async clientsDe(compte, lire, maintenantMs = Date.now()) {
      if (!enCours && maintenantMs - tenteeLe >= fraisMs) {
        tenteeLe = maintenantMs
        enCours = relire(lire, maintenantMs).finally(() => { enCours = null })
      }
      if (enCours) await enCours
      return { clients: [...(parCompte.get(compte.toLowerCase()) ?? [])], sur }
    },
  }
}

// ---------------------------------------------------------------------------
// La reconnaissance : le compte d'abord, l'email en repli
// ---------------------------------------------------------------------------

export type Reconnaissance = {
  oui: boolean
  /** Faux si une lecture Stripe a echoue en chemin : un « non » ne se garde pas en cache. */
  sur: boolean
  par: 'compte' | 'email' | null
}

/**
 * Le compte a-t-il un abonnement Carnet Premium ouvert (actif, essai, impaye
 * en relance) ?
 * 1. Par le compte : les clients des sessions des liens de paiement dont le
 *    client_reference_id est ce compte, quel que soit l'email tape chez Stripe.
 * 2. Par l'email, en repli (le chemin d'avant, inchange) : les clients Stripe
 *    dont l'email est EXACTEMENT celui du compte (casse ignoree), par la liste
 *    puis par la recherche (insensible a la casse, indexee avec retard).
 * Un client deja relu n'est pas relu deux fois.
 */
export async function reconnaitreCarnet(p: {
  compte: string | null
  email: string
  lire: LireListe
  index: IndexReferences | null
  produit?: string
  maintenantMs?: number
}): Promise<Reconnaissance> {
  const produit = p.produit ?? CARNET_PREMIUM_PRODUIT
  const cle = p.email.toLowerCase().trim()
  let sur = true
  const vus = new Set<string>()

  const abonne = async (client: string): Promise<boolean> => {
    if (vus.has(client)) return false
    vus.add(client)
    const r = await p.lire(`/v1/subscriptions?customer=${encodeURIComponent(client)}&limit=20`, 'subscriptions', 'carnet')
    if (!r.ok) {
      sur = false
      return false
    }
    return lireAbonnementsApp(r.data, produit).actif
  }

  // 1. Le compte (client_reference_id).
  const compte = p.compte && UUID.test(p.compte.trim()) ? p.compte.trim().toLowerCase() : null
  if (compte && p.index) {
    const r = await p.index.clientsDe(compte, p.lire, p.maintenantMs)
    if (!r.sur) sur = false
    for (const client of r.clients) {
      if (await abonne(client)) return { oui: true, sur: true, par: 'compte' }
    }
  }

  // 2. L'email, en repli. Seuls les clients dont l'email est EXACTEMENT celui
  // du compte comptent : la recherche Stripe n'est pas une egalite.
  const parmi = async (clients: unknown[]): Promise<boolean> => {
    for (const brut of clients) {
      const c = objet(brut)
      const id = chaine(c.id)
      if (!id || (chaine(c.email) ?? '').toLowerCase() !== cle) continue
      if (await abonne(id)) return true
    }
    return false
  }
  const liste = await p.lire(`/v1/customers?email=${encodeURIComponent(p.email)}&limit=10`, 'customers', 'carnet')
  if (!liste.ok) return { oui: false, sur: false, par: null } // cle fausse, quota, panne : inutile d'insister
  if (await parmi(liste.data)) return { oui: true, sur: true, par: 'email' }
  const requete = `email:'${p.email.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const trouves = await p.lire(`/v1/customers/search?query=${encodeURIComponent(requete)}&limit=10`, 'customers/search', 'carnet')
  if (!trouves.ok) return { oui: false, sur: false, par: null }
  if (await parmi(trouves.data)) return { oui: true, sur: true, par: 'email' }
  return { oui: false, sur, par: null }
}
