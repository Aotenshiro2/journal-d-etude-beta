// Les paliers de Pilotage (brief E1, 30/10/2026 ; plan Edgyx, section 7 ter),
// sans base ni reseau ni import : scripts/verifier-pilotage-paliers.mjs les
// teste avec Node seul.
//
// Trois paliers, et on ne vend pas « une meilleure IA » (decision de Brice du
// 30/08) : on vend le nombre de lectures intelligentes, les documents longs
// lus en entier, et la place du coffre.
//   - libre    : 10 lectures sur 30 jours glissants, plus 25 offertes les
//                7 premiers jours (a partir de la premiere lecture du membre,
//                consommees AVANT les 10), coffre 100 Mo, une tranche par
//                document long (« lu en partie, Premium lit en entier ») ;
//   - premium  : Pilotage Premium (5,99 EUR par mois ou 57 a l'annee), Premium
//                Duo (8,99 ou 79, avec le Carnet Premium), ou une raison Club
//                du Carnet (Live Club, Formation, ETM, acces manuel, Skool) :
//                200 lectures sur 30 jours, coffre 2 Go, 4 tranches ;
//   - equipe   : estSansPlafond (ia-budget.ts), sans limite, coffre 10 Go.
//
// La fenetre de 30 jours est celle de ia-budget.ts (la fenetre suit l'argent,
// decision du 30/08) : une lecture compte 30 jours, puis sort du compteur.

export type Palier = 'libre' | 'premium' | 'equipe'

/** Les deux produits vendus (familles d'offres). */
export type ProduitPilotage = 'pilotage-premium' | 'premium-duo'

/** Les quatre offres, telles que Pilotage les demande (brief E2). */
export type OffreDemandee = 'premium-mensuel' | 'premium-annuel' | 'duo-mensuel' | 'duo-annuel'

/** Les slugs des offres en base (academie_offres, type abonnement). */
export const OFFRES_PILOTAGE = {
  'premium-mensuel': 'pilotage-premium-mensuel',
  'premium-annuel': 'pilotage-premium-annuel',
  'duo-mensuel': 'premium-duo-mensuel',
  'duo-annuel': 'premium-duo-annuel',
} as const satisfies Record<OffreDemandee, string>

export type SlugOffrePilotage = (typeof OFFRES_PILOTAGE)[OffreDemandee]

export const SLUGS_OFFRES_PILOTAGE: readonly SlugOffrePilotage[] = Object.values(OFFRES_PILOTAGE)
export const SLUGS_DUO: readonly SlugOffrePilotage[] = ['premium-duo-mensuel', 'premium-duo-annuel']

/** Les prix affiches (EUR), les memes que ceux crees chez Stripe (scripts/creer-produits-stripe-pilotage.mjs). */
export const TARIFS = { premiumMensuel: 5.99, premiumAnnuel: 57, duoMensuel: 8.99, duoAnnuel: 79 } as const

/** Le catalogue : produit, rythme, prix en centimes, nom chez Stripe et libelle du paiement (lu par le cockpit). */
export const CATALOGUE: Record<SlugOffrePilotage, {
  produit: ProduitPilotage; rythme: 'month' | 'year'; centimes: number; titre: string; libellePaiement: string
}> = {
  'pilotage-premium-mensuel': { produit: 'pilotage-premium', rythme: 'month', centimes: 599, titre: 'Pilotage Premium (mensuel)', libellePaiement: 'Pilotage Premium : abonnement mensuel' },
  'pilotage-premium-annuel': { produit: 'pilotage-premium', rythme: 'year', centimes: 5700, titre: 'Pilotage Premium (annuel)', libellePaiement: 'Pilotage Premium : abonnement annuel' },
  'premium-duo-mensuel': { produit: 'premium-duo', rythme: 'month', centimes: 899, titre: 'Premium Duo, Carnet et Pilotage (mensuel)', libellePaiement: 'Premium Duo (Carnet + Pilotage) : abonnement mensuel' },
  'premium-duo-annuel': { produit: 'premium-duo', rythme: 'year', centimes: 7900, titre: 'Premium Duo, Carnet et Pilotage (annuel)', libellePaiement: 'Premium Duo (Carnet + Pilotage) : abonnement annuel' },
}

/** Le nom du produit chez Stripe : c'est lui que la collecte du cockpit range (catalogue_aoknowledge.json). */
export const NOMS_PRODUITS: Record<ProduitPilotage, string> = {
  'pilotage-premium': 'Pilotage Premium',
  'premium-duo': 'Premium Duo (Carnet + Pilotage)',
}

/** L'offre demandee par Pilotage (« premium-mensuel ») ou son slug complet, sinon null. */
export function offreDemandee(valeur: unknown): SlugOffrePilotage | null {
  if (typeof valeur !== 'string') return null
  const v = valeur.trim()
  if (Object.prototype.hasOwnProperty.call(OFFRES_PILOTAGE, v)) return OFFRES_PILOTAGE[v as OffreDemandee]
  return (SLUGS_OFFRES_PILOTAGE as readonly string[]).includes(v) ? (v as SlugOffrePilotage) : null
}

export const estSlugPilotage = (v: unknown): v is SlugOffrePilotage =>
  typeof v === 'string' && (SLUGS_OFFRES_PILOTAGE as readonly string[]).includes(v)

export const produitDe = (slug: SlugOffrePilotage): ProduitPilotage => CATALOGUE[slug].produit

// ---------------------------------------------------------------------------
// Le palier
// ---------------------------------------------------------------------------

/** Les raisons Club du Carnet (RAISONS_CLUB de ia-niveau.ts, recopiees : ce module n'importe rien). */
export const RAISONS_CLUB_PILOTAGE = ['etm', 'manuel', 'liveclub', 'skool-vip', 'skool-premium', 'formation'] as const

export interface ResolutionPalier { palier: Palier; raison: string | null }

/**
 * Le palier, dans l'ordre : l'equipe (estSansPlafond), un abonnement Pilotage
 * actif (Duo d'abord : il dit plus), une raison Club du Carnet, sinon libre.
 * `raisonCarnet` = la raison de checkMentoratAccess (entitlements.ts) ; le
 * Carnet Premium seul (carnet-premium) n'ouvre PAS Pilotage Premium.
 */
export function resoudrePalier(o: {
  sansPlafond: boolean
  produits: readonly ProduitPilotage[]
  raisonCarnet: string | null
}): ResolutionPalier {
  if (o.sansPlafond) return { palier: 'equipe', raison: 'equipe' }
  if (o.produits.includes('premium-duo')) return { palier: 'premium', raison: 'premium-duo' }
  if (o.produits.includes('pilotage-premium')) return { palier: 'premium', raison: 'pilotage-premium' }
  if (o.raisonCarnet && (RAISONS_CLUB_PILOTAGE as readonly string[]).includes(o.raisonCarnet)) {
    return { palier: 'premium', raison: o.raisonCarnet }
  }
  return { palier: 'libre', raison: null }
}

// ---------------------------------------------------------------------------
// Les lectures intelligentes
// ---------------------------------------------------------------------------

export const JOURS_FENETRE = 30
export const LECTURES_PAR_PALIER: Record<Palier, number | null> = { libre: 10, premium: 200, equipe: null }
export const LECTURES_OFFERTES = 25
export const JOURS_OFFERTES = 7
export const MESSAGE_LECTURES_EPUISEES = 'Tes lectures du mois sont épuisées.'

const JOUR_MS = 24 * 3600 * 1000

export interface Lectures {
  /** Les lectures comptees sur 30 jours (hors offertes). */
  utilisees: number
  /** null : sans limite (equipe). */
  limite: number | null
  /** Ce qui reste des 25 offertes (0 hors libre ou apres les 7 jours). */
  offertes: number
  /** Fin des offertes quand il en reste, sinon le jour ou la plus ancienne lecture comptee sort de la fenetre. */
  jusquAu: string | null
}

export interface Compteur { autorise: boolean; lectures: Lectures }

/** Depuis quand lire les lectures du membre pour les compter : la fenetre, ou la premiere lecture si sa semaine offerte la touche. */
export function debutDesLectures(premiere: Date | null, maintenant: Date): Date {
  const fenetre = new Date(maintenant.getTime() - JOURS_FENETRE * JOUR_MS)
  if (premiere && premiere.getTime() + JOURS_OFFERTES * JOUR_MS > fenetre.getTime() && premiere < fenetre) return premiere
  return fenetre
}

/**
 * Le compteur d'un membre. `dates` : ses lectures du poste document depuis
 * debutDesLectures (l'ordre n'importe pas), `premiere` : sa toute premiere
 * lecture (null s'il n'en a jamais fait).
 *
 * En libre, les 25 premieres lectures de la semaine qui suit la premiere sont
 * offertes : elles ne comptent pas dans les 10. Un membre qui n'a encore rien
 * lu a ses 25 offertes devant lui (jusquAu = dans 7 jours, la semaine
 * commencera a sa premiere lecture). En premium, tout compte dans les 200.
 */
export function compterLectures(o: { palier: Palier; dates: readonly Date[]; premiere: Date | null; maintenant: Date }): Compteur {
  const t = o.maintenant.getTime()
  const debut = t - JOURS_FENETRE * JOUR_MS
  const limite = LECTURES_PAR_PALIER[o.palier]
  const dates = [...o.dates].map(d => d.getTime()).filter(Number.isFinite).sort((a, b) => a - b)

  const debutOffre = o.premiere ? o.premiere.getTime() : null
  const finOffre = debutOffre === null ? t + JOURS_OFFERTES * JOUR_MS : debutOffre + JOURS_OFFERTES * JOUR_MS
  let offertesLues = 0
  const comptees: number[] = []
  for (const d of dates) {
    if (o.palier === 'libre' && debutOffre !== null && d >= debutOffre && d < finOffre && offertesLues < LECTURES_OFFERTES) {
      offertesLues++
      continue
    }
    if (d >= debut) comptees.push(d)
  }

  const offertes = o.palier === 'libre' && finOffre > t ? Math.max(0, LECTURES_OFFERTES - offertesLues) : 0
  const utilisees = comptees.length
  const finFenetre = comptees.length ? new Date(comptees[0] + JOURS_FENETRE * JOUR_MS).toISOString() : null
  const jusquAu = limite === null ? null : offertes > 0 ? new Date(finOffre).toISOString() : finFenetre
  const autorise = limite === null || offertes > 0 || utilisees < limite
  return { autorise, lectures: { utilisees, limite, offertes, jusquAu } }
}

/** Les dates apres une lecture faite maintenant (le compteur rendu avec la lecture). */
export function apresUneLecture(o: { palier: Palier; dates: readonly Date[]; premiere: Date | null; maintenant: Date }): Compteur {
  return compterLectures({ ...o, dates: [...o.dates, o.maintenant], premiere: o.premiere ?? o.maintenant })
}

/** Le quota rendu par documents/lire (200 et 429) : le compteur et le palier. */
export const quotaDe = (c: Compteur, palier: Palier) => ({ ...c.lectures, palier })

// ---------------------------------------------------------------------------
// Le coffre et les tranches
// ---------------------------------------------------------------------------

const MO = 1024 * 1024
export const COFFRE_PAR_PALIER: Record<Palier, number> = { libre: 100 * MO, premium: 2048 * MO, equipe: 10240 * MO }

const LIBELLE_COFFRE: Record<Palier, string> = { libre: '100 Mo', premium: '2 Go', equipe: '10 Go' }

export function coffrePlein(palier: Palier, octetsDejaGardes: number, taille: number): boolean {
  return octetsDejaGardes + taille > COFFRE_PAR_PALIER[palier]
}

export function messageCoffrePlein(palier: Palier): string {
  const suite = palier === 'libre' ? ' Premium garde 2 Go.' : ''
  return `Ton coffre est plein (${LIBELLE_COFFRE[palier]}) : l'original n'a pas été gardé. Retire des documents que tu n'as plus besoin de garder, puis redépose celui-ci.${suite}`
}

/** Les tranches d'un document long lues par palier (D3 : 4 au plus). */
export const TRANCHES_PAR_PALIER: Record<Palier, number> = { libre: 1, premium: 4, equipe: 4 }
export const REMARQUE_LU_EN_PARTIE = 'Lu en partie : Premium lit les documents longs en entier.'

// ---------------------------------------------------------------------------
// L'achat : retour, session Checkout, abonnement
// ---------------------------------------------------------------------------

export const SITE_PILOTAGE = 'https://pilotage.aoknowledge.com'
export const ORIGINES_RETOUR_PILOTAGE: readonly string[] = [SITE_PILOTAGE, 'http://localhost:3210']

/**
 * L'adresse de retour de Checkout : seulement la page /offres de Pilotage, en
 * production ou en dev local (port 3210), jamais une redirection ouverte.
 * `retour` (du corps) doit etre « /offres » ; l'origine de la requete choisit
 * la base, sinon la production.
 */
export function retourPilotage(retour: unknown, origine: string | null): string | null {
  if (retour !== undefined && retour !== '/offres') return null
  const base = origine && ORIGINES_RETOUR_PILOTAGE.includes(origine) ? origine : SITE_PILOTAGE
  return `${base}/offres?session_id={CHECKOUT_SESSION_ID}`
}

export const URL_CGV = 'https://aoknowledge.com/conditions-generales'

export function texteRetractation(produit: ProduitPilotage): string {
  return `J'accepte les [conditions générales](${URL_CGV}) et je demande l'accès immédiat à ${NOMS_PRODUITS[produit]} : je renonce à mon droit de rétractation de 14 jours.`
}

/**
 * Les parametres de POST /v1/checkout/sessions en mode abonnement (Embedded
 * Checkout, comme l'academie). Connecte : email prerempli et compte en
 * client_reference_id, poses par le serveur depuis le jeton. Les metadata de
 * l'abonnement (source pilotage, offre, compte) sont celles que le webhook lit
 * a chaque renouvellement.
 */
export function corpsSessionAbonnement(o: {
  slug: SlugOffrePilotage; prix: string; retourUrl: string; userId: string | null; email: string | null; essai: boolean
}): URLSearchParams {
  const produit = produitDe(o.slug)
  const c = new URLSearchParams()
  c.set('mode', 'subscription')
  c.set('ui_mode', 'embedded')
  c.set('redirect_on_completion', 'if_required')
  c.set('return_url', o.retourUrl)
  c.set('line_items[0][price]', o.prix)
  c.set('line_items[0][quantity]', '1')
  c.set('locale', 'fr')
  c.set('consent_collection[terms_of_service]', 'required')
  c.set('custom_text[terms_of_service_acceptance][message]', texteRetractation(produit))
  if (o.userId) {
    c.set('client_reference_id', o.userId)
    c.set('metadata[user_id]', o.userId)
    c.set('subscription_data[metadata][user_id]', o.userId)
  }
  if (o.email) c.set('customer_email', o.email)
  c.set('metadata[source]', 'pilotage')
  c.set('metadata[pilotage_offre]', o.slug)
  c.set('metadata[essai]', o.essai ? '1' : '0')
  c.set('subscription_data[description]', NOMS_PRODUITS[produit])
  c.set('subscription_data[metadata][source]', 'pilotage')
  c.set('subscription_data[metadata][pilotage_offre]', o.slug)
  c.set('subscription_data[metadata][essai]', o.essai ? '1' : '0')
  return c
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const chaine = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const idDe = (v: unknown): string | null => chaine(v) ?? chaine(objet(v).id)

export const estSessionId = (v: unknown): v is string => typeof v === 'string' && /^cs_[A-Za-z0-9_]{10,250}$/.test(v)
export const estAbonnementId = (v: unknown): v is string => typeof v === 'string' && /^sub_[A-Za-z0-9]{6,250}$/.test(v)

export function emailPropre(v: unknown): string | null {
  const e = chaine(v)?.toLowerCase() ?? null
  if (!e || e.length < 3 || e.length > 320 || e.indexOf('@') < 1) return null
  return e
}

export type SessionLue =
  | {
    ok: true; sessionId: string; abonnementId: string; offre: SlugOffrePilotage | null; userId: string | null; email: string | null; essai: boolean
    /** Le moment du paiement si l'acheteur a coche la case de retractation (consent.terms_of_service = 'accepted'), sinon null. */
    renonciationLe: Date | null
  }
  | { ok: false; raison: 'pas_pilotage' | 'incomplet' | 'en_attente' }

/** Une session Checkout de Pilotage revenue de Stripe : l'abonnement qu'elle ouvre, ou pourquoi rien. */
export function lireSessionPilotage(s: Record<string, unknown>): SessionLue {
  const meta = objet(s.metadata)
  const id = chaine(s.id)
  if (meta.source !== 'pilotage' || s.mode !== 'subscription' || !estSessionId(id)) return { ok: false, raison: 'pas_pilotage' }
  if (s.status !== 'complete') return { ok: false, raison: 'incomplet' }
  if (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') return { ok: false, raison: 'en_attente' }
  const abonnementId = idDe(s.subscription)
  if (!estAbonnementId(abonnementId)) return { ok: false, raison: 'incomplet' }
  const ref = chaine(s.client_reference_id)
  const details = objet(s.customer_details)
  const cree = typeof s.created === 'number' ? new Date(s.created * 1000) : new Date()
  return {
    renonciationLe: objet(s.consent).terms_of_service === 'accepted' ? cree : null,
    ok: true,
    sessionId: id,
    abonnementId,
    offre: estSlugPilotage(meta.pilotage_offre) ? meta.pilotage_offre : null,
    userId: ref && UUID.test(ref) ? ref.toLowerCase() : null,
    email: emailPropre(details.email) ?? emailPropre(s.customer_email),
    essai: meta.essai === '1',
  }
}

/** Les etats ou l'abonnement ouvre le droit : actif, essai, impaye en relance (comme le Carnet Premium). */
export const STATUTS_ACTIFS = ['active', 'trialing', 'past_due'] as const
/** Marge apres la fin de periode : le renouvellement a le temps d'arriver (invoice.paid). */
export const MARGE_FIN_JOURS = 3

export type AbonnementLu = {
  id: string
  statut: string
  actif: boolean
  /** Fin du droit : fin de la periode payee + MARGE_FIN_JOURS (null si Stripe ne la donne pas). */
  fin: Date | null
  /** L'offre : metadata pilotage_offre, sinon le prix reconnu (prixVersOffre). */
  offre: SlugOffrePilotage | null
  prix: string | null
  clientId: string | null
  clientEmail: string | null
  userId: string | null
  essai: boolean
  /** La facture la plus recente (in_...), pour retrouver la charge. */
  facture: string | null
}

/**
 * Un abonnement Stripe (objet, client deplie ou non). current_period_end vit
 * sur l'item depuis les versions recentes de l'API (2025-09-30.clover,
 * epinglee) ; l'ancien emplacement est lu aussi.
 */
export function lireAbonnement(s: Record<string, unknown>, prixVersOffre: (prix: string) => SlugOffrePilotage | null = () => null): AbonnementLu | null {
  const id = chaine(s.id)
  if (!estAbonnementId(id)) return null
  const meta = objet(s.metadata)
  const item = objet((Array.isArray(objet(s.items).data) ? (objet(s.items).data as unknown[]) : [])[0])
  const prix = idDe(item.price)
  const finS = typeof item.current_period_end === 'number' ? item.current_period_end
    : typeof s.current_period_end === 'number' ? s.current_period_end : null
  const statut = chaine(s.status) ?? 'inconnu'
  const client = s.customer
  const ref = chaine(meta.user_id)
  return {
    id,
    statut,
    actif: (STATUTS_ACTIFS as readonly string[]).includes(statut),
    fin: finS === null ? null : new Date((finS + MARGE_FIN_JOURS * 86400) * 1000),
    offre: estSlugPilotage(meta.pilotage_offre) ? meta.pilotage_offre : prix ? prixVersOffre(prix) : null,
    prix,
    clientId: idDe(client),
    clientEmail: emailPropre(objet(client).email),
    userId: ref && UUID.test(ref) ? ref.toLowerCase() : null,
    essai: meta.essai === '1',
    facture: idDe(s.latest_invoice),
  }
}

/** L'abonnement d'une facture (invoice.paid) : parent.subscription_details (clover), sinon l'ancien champ. */
export function abonnementDeFacture(f: Record<string, unknown>): string | null {
  const parent = objet(objet(f.parent).subscription_details)
  const id = idDe(parent.subscription) ?? idDe(f.subscription)
  return estAbonnementId(id) ? id : null
}

/** La charge d'une liste invoice_payments (payment.charge, ou payment_intent.latest_charge deplie). */
export function chargeDesPaiements(liste: unknown): string | null {
  for (const p of Array.isArray(liste) ? liste : []) {
    const ip = objet(p)
    if (ip.status !== undefined && ip.status !== 'paid') continue
    const pay = objet(ip.payment)
    const id = idDe(pay.charge) ?? idDe(objet(pay.payment_intent).latest_charge)
    if (id && /^(ch|py)_[A-Za-z0-9]{6,200}$/.test(id)) return id
  }
  return null
}
