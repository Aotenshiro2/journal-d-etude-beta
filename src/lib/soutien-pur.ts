// Le soutien dans les apps (brief du 11/11/2026, labo
// D:\6_Societe\Pilotage\soutien\labo). Sans base ni reseau ni import :
// scripts/verifier-soutien.mjs le teste avec Node seul.
//
// Le Carnet Premium et Pilotage Premium sont compris dans le Live Club, la
// Formation, ETM, le VIP et les acces manuels. Un membre qui les a deja peut
// quand meme prendre l'abonnement EXISTANT (memes prix, aucun produit Stripe
// neuf) pour soutenir l'app : l'abonnement porte la metadonnee soutien=1 (sur
// la session Checkout et sur l'abonnement). Le droit ne change pas ; si la
// formule s'arrete, l'abonnement ouvre le Premium comme n'importe lequel.
// Le badge « Soutien » = un abonnement actif marque soutien=1, relu chez Stripe
// (aucune table, aucune migration).
//
// Doctrine (Brice) : la vente se suggere, elle ne se force pas. Le soutien ne
// se propose que la ou le Premium est deja compris.

/**
 * Les raisons qui comprennent deja le Premium par une FORMULE : les raisons Club
 * (RAISONS_CLUB_PILOTAGE) sans 'equipe' (l'equipe AOK n'a rien a soutenir ; un
 * compte admin passe par l'essai).
 */
export const RAISONS_COMPRISES = ['etm', 'manuel', 'liveclub', 'skool-vip', 'skool-premium', 'formation'] as const

export const estRaisonComprise = (raison: string | null | undefined): boolean =>
  typeof raison === 'string' && (RAISONS_COMPRISES as readonly string[]).includes(raison)

// ---------------------------------------------------------------------------
// La decision : vendre l'abonnement en mode soutien, ou pas
// ---------------------------------------------------------------------------

/**
 * compte       : pas de compte (le soutien se rattache au compte qui a la formule) ;
 * ferme        : SOUTIEN_APPS_PUBLIC n'est pas a 1 (seul un compte admin essaie) ;
 * deja         : un abonnement de cette app est deja actif (jamais deux) ;
 * pas_compris  : le Premium n'est pas compris, c'est un achat normal, pas un soutien.
 */
export type RefusSoutien = 'compte' | 'ferme' | 'deja' | 'pas_compris'

export const STATUT_REFUS_SOUTIEN: Record<RefusSoutien, number> = { compte: 401, ferme: 403, deja: 409, pas_compris: 409 }

export type DecisionSoutien = { ok: true } | { ok: false; erreur: RefusSoutien; status: number }

export function decisionSoutien(o: {
  connecte: boolean
  /** La vente du soutien est ouverte a tous (SOUTIEN_APPS_PUBLIC=1). */
  ouvert: boolean
  /** Compte admin ou de l'equipe : l'essai avant ouverture, meme sans formule. */
  admin: boolean
  /** Un abonnement de cette app actif (soutien ou non). */
  dejaAbonne: boolean
  /** Le Premium vient d'une formule (estRaisonComprise). */
  compris: boolean
}): DecisionSoutien {
  const refus = (erreur: RefusSoutien): DecisionSoutien => ({ ok: false, erreur, status: STATUT_REFUS_SOUTIEN[erreur] })
  if (!o.connecte) return refus('compte')
  if (!o.ouvert && !o.admin) return refus('ferme')
  if (o.dejaAbonne) return refus('deja')
  if (!o.compris && !o.admin) return refus('pas_compris')
  return { ok: true }
}

/** La vente du soutien ouverte a tous : SOUTIEN_APPS_PUBLIC=1 (go de Brice). */
export const soutienOuvert = (env: Record<string, string | undefined>): boolean => env.SOUTIEN_APPS_PUBLIC?.trim() === '1'

// ---------------------------------------------------------------------------
// La marque soutien sur Stripe
// ---------------------------------------------------------------------------

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const chaine = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const idDe = (v: unknown): string | null => chaine(v) ?? chaine(objet(v).id)

/** La metadonnee posee sur la session et l'abonnement. */
export const META_SOUTIEN = 'soutien'

/** Un objet Stripe (session, abonnement) marque soutien=1. */
export const estMarqueSoutien = (metadata: unknown): boolean => objet(metadata)[META_SOUTIEN] === '1'

/** Les etats ou un abonnement compte (comme le Carnet Premium et Pilotage : actif, essai, impaye en relance). */
export const STATUTS_ABONNEMENT_ACTIF = ['active', 'trialing', 'past_due'] as const

export type AbonnementsApp = {
  /** Un abonnement de l'app actif, soutien ou non. */
  actif: boolean
  /** Un abonnement de l'app actif ET marque soutien. */
  soutien: boolean
  /** L'abonnement de soutien (sinon l'actif) : le portail s'y rattache. */
  abonnement: string | null
  client: string | null
}

/**
 * Une liste d'abonnements Stripe (GET /v1/subscriptions) lue pour un produit :
 * y a-t-il un actif, est-il de soutien. Les items dont le prix porte un autre
 * produit sont ignores.
 */
export function lireAbonnementsApp(liste: unknown, produit: string): AbonnementsApp {
  let actif: { id: string; client: string | null } | null = null
  let soutien: { id: string; client: string | null } | null = null
  for (const brut of Array.isArray(liste) ? liste : []) {
    const s = objet(brut)
    const id = chaine(s.id)
    if (!id || !(STATUTS_ABONNEMENT_ACTIF as readonly string[]).includes(String(s.status))) continue
    const items = Array.isArray(objet(s.items).data) ? (objet(s.items).data as unknown[]) : []
    const duProduit = items.some(i => {
      const prix = objet(objet(i).price)
      return idDe(prix.product) === produit
    })
    if (!duProduit) continue
    const vu = { id, client: idDe(s.customer) }
    actif ??= vu
    if (estMarqueSoutien(s.metadata)) soutien ??= vu
  }
  const retenu = soutien ?? actif
  return { actif: actif !== null, soutien: soutien !== null, abonnement: retenu?.id ?? null, client: retenu?.client ?? null }
}

// ---------------------------------------------------------------------------
// Le Carnet : l'abonnement Carnet Premium existant, en mode soutien
// ---------------------------------------------------------------------------

/** Le produit Carnet Premium (Stripe Ao Knowledge), le meme que entitlements.ts. */
export const CARNET_PREMIUM_PRODUIT = 'prod_V9jniZCCbIJsmV'

/**
 * Les prix existants du Carnet Premium (relevés dans l'extension, src/lib/offres.ts,
 * verifies le 31/08/2026) : 5,99 EUR par mois, 57,50 EUR par an. Surchargeables
 * par CARNET_PRIX_MENSUEL et CARNET_PRIX_ANNUEL. Aucun prix neuf.
 */
export const PRIX_CARNET_DEFAUT = { mois: 'price_1U9QKMEAT4qWdUNVv0OSIusl', an: 'price_1UAR2CEAT4qWdUNVgqnFaTd8' } as const
export const TARIFS_CARNET = { mois: 5.99, an: 57.5 } as const

export type PeriodeCarnet = 'mois' | 'an'

export const periodeCarnet = (v: unknown): PeriodeCarnet | null => (v === 'mois' || v === 'an' ? v : null)

export function prixCarnet(env: Record<string, string | undefined>, periode: PeriodeCarnet): string {
  const surcharge = (periode === 'mois' ? env.CARNET_PRIX_MENSUEL : env.CARNET_PRIX_ANNUEL)?.trim()
  return surcharge && /^price_[A-Za-z0-9]{6,250}$/.test(surcharge) ? surcharge : PRIX_CARNET_DEFAUT[periode]
}

/** Le retour apres le paiement : Mon espace, ou le badge se voit. */
export const RETOUR_SOUTIEN = 'https://aoknowledge.com/mon-espace'

export const URL_CGV_SOUTIEN = 'https://aoknowledge.com/conditions-generales'

/**
 * La session Checkout HEBERGEE (l'extension ouvre un onglet : pas de formulaire
 * integre dans le panneau) de l'abonnement Carnet Premium existant, marquee
 * soutien. Pas de metadata `source` sur la session : le webhook de Pilotage
 * l'ignore pour les droits et, voyant soutien=1, envoie le mail de
 * remerciement a la place du mail du Carnet (mails-achat-pur.ts,
 * planMailHorsPilotage, 11/11/2026). L'abonnement porte soutien=1, app=carnet
 * et le compte.
 */
export function corpsSessionSoutienCarnet(o: {
  prix: string; userId: string; email: string | null; essai: boolean
}): URLSearchParams {
  const c = new URLSearchParams()
  c.set('mode', 'subscription')
  c.set('success_url', `${RETOUR_SOUTIEN}?soutien=carnet`)
  c.set('cancel_url', RETOUR_SOUTIEN)
  c.set('line_items[0][price]', o.prix)
  c.set('line_items[0][quantity]', '1')
  c.set('locale', 'fr')
  c.set('consent_collection[terms_of_service]', 'required')
  c.set('custom_text[terms_of_service_acceptance][message]',
    `J'accepte les [conditions générales](${URL_CGV_SOUTIEN}) et je demande l'accès immédiat au Carnet Premium : je renonce à mon droit de rétractation de 14 jours.`)
  c.set('client_reference_id', o.userId)
  if (o.email) c.set('customer_email', o.email)
  c.set(`metadata[${META_SOUTIEN}]`, '1')
  c.set('metadata[app]', 'carnet')
  c.set('metadata[user_id]', o.userId)
  c.set('metadata[essai]', o.essai ? '1' : '0')
  c.set(`subscription_data[metadata][${META_SOUTIEN}]`, '1')
  c.set('subscription_data[metadata][app]', 'carnet')
  c.set('subscription_data[metadata][user_id]', o.userId)
  c.set('subscription_data[metadata][essai]', o.essai ? '1' : '0')
  c.set('subscription_data[description]', 'Carnet Premium (soutien)')
  return c
}

/** L'URL de Checkout rendue par Stripe : seulement checkout.stripe.com, jamais une redirection ouverte. */
export const urlCheckoutSure = (v: unknown): string | null => {
  const u = chaine(v)
  return u && /^https:\/\/checkout\.stripe\.com\//.test(u) ? u : null
}

// ---------------------------------------------------------------------------
// Pilotage : la raison affichee quand l'abonnement est un soutien
// ---------------------------------------------------------------------------

/**
 * Un abonne de soutien dont la formule court encore garde sa raison Club
 * (« Inclus dans ton Live Club ») : l'abonnement ne change pas ce qu'il a. Si
 * la formule s'arrete, la raison redevient celle de l'abonnement.
 */
export function raisonAvecSoutien(o: { raison: string | null; soutien: boolean; raisonClub: string | null }): string | null {
  if (o.soutien && estRaisonComprise(o.raisonClub)) return o.raisonClub
  return o.raison
}

// ---------------------------------------------------------------------------
// Le soutien AOKnowledge : la page aoknowledge.com/soutenir (11/11/2026, go de
// Brice, brief soutien-mail-et-page-soutenir, partie 2)
// ---------------------------------------------------------------------------
//
// Un abonnement mensuel au produit « Soutien AOKnowledge » (cree chez Stripe le
// 11/11, compte Ao Knowledge, mode reel ; rien d'autre n'est cree). Trois
// paliers a prix fixe (5, 10, 20 EUR) et un montant au choix (2 a 200 EUR, en
// euros entiers, price_data sur le meme produit). Les quatre donnent la meme
// chose : le badge « Soutien ». Il faut un compte (le badge se pose dessus),
// aucune formule n'est exigee. Un seul soutien AOK actif par compte.
// La session porte soutien=aok (session et abonnement) et AUCUNE metadata
// source : le webhook de Pilotage la prend pour une session hors Pilotage et
// envoie le remerciement (mails-achat-pur.ts, planMailHorsPilotage).

/** Le produit « Soutien AOKnowledge » (metadonnee soutien=aok chez Stripe). */
export const PRODUIT_SOUTIEN_AOK = 'prod_VboqdWtBxA9SnV'

/** La marque des sessions et abonnements de /soutenir. */
export const MARQUE_SOUTIEN_AOK = 'aok'

/** Les prix mensuels deja crees (lookup_key soutien_aok_<n>_mois). */
export const PRIX_SOUTIEN_AOK: Readonly<Record<number, string>> = {
  5: 'price_1UabCfEAT4qWdUNVCALk05Fc',
  10: 'price_1UabCgEAT4qWdUNV7J6fxGes',
  20: 'price_1UabChEAT4qWdUNVFKUjkAT1',
}

export const MONTANT_SOUTIEN_MIN = 2
export const MONTANT_SOUTIEN_MAX = 200

/** Un montant mensuel en euros entiers, de 2 a 200, sinon null (ni texte, ni decimale, ni hors bornes). */
export function montantSoutienAok(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return null
  return v >= MONTANT_SOUTIEN_MIN && v <= MONTANT_SOUTIEN_MAX ? v : null
}

export const RETOUR_SOUTIEN_AOK = 'https://aoknowledge.com/mon-espace?soutien=aok'
export const PAGE_SOUTIEN_AOK = 'https://aoknowledge.com/soutenir'

/** L'abonnement de /soutenir porte la marque soutien=aok. */
export const estMarqueSoutienAok = (metadata: unknown): boolean => objet(metadata)[META_SOUTIEN] === MARQUE_SOUTIEN_AOK

/**
 * La session Checkout HEBERGEE du soutien AOKnowledge : abonnement mensuel,
 * prix existant pour 5, 10 et 20 EUR, sinon price_data sur le produit. Les
 * conditions a accepter, comme Pilotage. Marque soutien=aok sur la session et
 * l'abonnement, sans metadata source.
 */
export function corpsSessionSoutienAok(o: { montant: number; userId: string; email: string }): URLSearchParams {
  const c = new URLSearchParams()
  c.set('mode', 'subscription')
  c.set('success_url', RETOUR_SOUTIEN_AOK)
  c.set('cancel_url', PAGE_SOUTIEN_AOK)
  const prix = PRIX_SOUTIEN_AOK[o.montant]
  if (prix) {
    c.set('line_items[0][price]', prix)
  } else {
    c.set('line_items[0][price_data][currency]', 'eur')
    c.set('line_items[0][price_data][product]', PRODUIT_SOUTIEN_AOK)
    c.set('line_items[0][price_data][recurring][interval]', 'month')
    c.set('line_items[0][price_data][unit_amount]', String(o.montant * 100))
  }
  c.set('line_items[0][quantity]', '1')
  c.set('locale', 'fr')
  c.set('consent_collection[terms_of_service]', 'required')
  c.set('custom_text[terms_of_service_acceptance][message]',
    `J'accepte les [conditions générales](${URL_CGV_SOUTIEN}) et je demande que mon soutien commence tout de suite : je renonce à mon droit de rétractation de 14 jours.`)
  c.set('client_reference_id', o.userId)
  c.set('customer_email', o.email)
  for (const cle of ['metadata', 'subscription_data[metadata]']) {
    c.set(`${cle}[${META_SOUTIEN}]`, MARQUE_SOUTIEN_AOK)
    c.set(`${cle}[app]`, 'aok')
    c.set(`${cle}[user_id]`, o.userId)
    c.set(`${cle}[montant]`, String(o.montant))
  }
  c.set('subscription_data[description]', 'Soutien AOKnowledge')
  return c
}

/**
 * compte      : pas de compte (le badge se pose sur le compte) ;
 * montant     : ni 5, 10, 20, ni un entier de 2 a 200 ;
 * email       : le compte n'a pas d'adresse confirmee (Checkout l'exige, et le doublon se cherche par elle) ;
 * indisponible: l'abonnement ne se lit pas chez Stripe (on ne vend pas a l'aveugle : deux soutiens seraient pires qu'un refus) ;
 * deja        : un soutien AOKnowledge est deja actif ;
 * stripe      : Stripe n'a pas rendu d'URL de Checkout.
 */
export type RefusSoutienAok = 'compte' | 'montant' | 'email' | 'indisponible' | 'deja' | 'stripe'

export const STATUT_REFUS_SOUTIEN_AOK: Record<RefusSoutienAok, number> = {
  compte: 401, montant: 400, email: 409, indisponible: 503, deja: 409, stripe: 502,
}

export type DepsSoutienAok = {
  /** Le compte du jeton et son email confirme, ou null. Peut jeter (Supabase injoignable). */
  compte: () => Promise<{ userId: string; email: string | null } | null>
  /** Les abonnements AOK de l'email (lireAbonnementsApp), null = illisible. */
  abonnement: (email: string) => Promise<AbonnementsApp | null>
  /** POST /v1/checkout/sessions (Stripe). Peut jeter. */
  creerSession: (corps: URLSearchParams) => Promise<Record<string, unknown>>
}

export type ReponseSoutienAok = { status: number; corps: { ok: true; url: string } | { ok: false; erreur: RefusSoutienAok } }

/**
 * POST /api/academie/soutien, sans Next ni Stripe : le compte, le montant, le
 * doublon, puis la session. Le meme ordre que les refus de la route.
 */
export async function sessionSoutienAok(corps: unknown, d: DepsSoutienAok): Promise<ReponseSoutienAok> {
  const refus = (erreur: RefusSoutienAok): ReponseSoutienAok => ({ status: STATUT_REFUS_SOUTIEN_AOK[erreur], corps: { ok: false, erreur } })
  const compte = await d.compte()
  if (!compte) return refus('compte')
  const montant = montantSoutienAok(objet(corps).montant)
  if (montant === null) return refus('montant')
  if (!compte.email) return refus('email')
  const ab = await d.abonnement(compte.email)
  if (!ab) return refus('indisponible')
  if (ab.actif) return refus('deja')
  const s = await d.creerSession(corpsSessionSoutienAok({ montant, userId: compte.userId, email: compte.email }))
  const url = urlCheckoutSure(s.url)
  return url ? { status: 200, corps: { ok: true, url } } : refus('stripe')
}
