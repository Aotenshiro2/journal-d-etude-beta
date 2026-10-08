// Fonctions PURES de la repartition entre Brice et Melanie (08/10/2026) :
// aucune base, aucun reseau, aucun import. C'est voulu, comme
// liveclub/pur.ts : scripts/verifier-repartition.mjs les teste avec Node seul
// (suppression des types de Node 22), sans lanceur de tests.
//
// LES REGLES (Brice, 08/10/2026), toutes tranchees :
// 1. Deux cotes. Le cote « mel » : abonnements Live Club (Stripe de Melanie,
//    compte « melanie »), commissions broker, affiliations, produits de Mel.
//    Le cote « brice » : ventes de formation (premium, VIP, ETM...) sur le
//    Stripe de Brice (compte « aoknowledge »). Le compte d'un paiement est
//    connu par cockpit_paiements.compte, pose par la collecte
//    (collect_stripe.py, _compte de chaque charge).
// 2. Celui qui apporte la vente prend 70 %, l'autre 30 %. Saro est hors
//    calcul : il n'apparait nulle part ici.
// 3. Base du partage d'une vente : encaisse - frais Stripe - remboursements.
//    Un intervenant (Adrien...) ne prend rien sur les ventes : il touche une
//    SOMME FIXE PAR LIVE (correction de Brice, 08/10). Son tarif est DATE et
//    rattache a un produit (cockpit_intervenants, jamais ici) ; chaque mois,
//    le nombre de lives declare fait une DEPENSE du mois (nombre x tarif en
//    vigueur ce mois-la), rattachee a ce produit, donc deduite de son cote
//    avant le 70/30 (regle 5), et payee par celui qui le paie (Mel par
//    defaut pour le Live Club, choisi dans la carte).
// 4. Une commission (broker, affiliation) compte dans le mois ou elle est
//    RECUE. Attendue, elle glisse de mois en mois jusqu'a recue ou perdue.
// 5. Une depense rattachee a un cote ou a un produit est deduite de ce cote
//    avant son 70/30. Commune : 50/50, sauf repartition donnee.
// 6. Le solde du mois, en GRAND LIVRE : chaque flux dit qui l'a eu en main
//    (Stripe de Mel -> Mel, Stripe de Brice -> Brice, commission -> Mel sauf
//    indication) ou qui l'a paye, et comment il se partage entre les deux.
//
//      Solde de Brice = somme de ses parts - (ce qu'il a eu en main - ce qu'il a paye)
//
//    Positif : Mel lui doit ce montant. Negatif : il doit a Mel.
//    Les lives d'un intervenant sont une depense comme une autre : en main
//    NEGATIF de celui qui les a payes, parts negatives en 70/30 du cote du
//    produit. Les reglements faits (« c'est regle ») se deduisent du solde : un
//    reglement de Mel a Brice, c'est de l'argent que Brice a eu en main.
//    Mois en heure de Paris.
//
// Tous les montants sont en CENTIMES (entiers) : aucun arrondi flottant ne
// s'accumule, et chaque ligne du grand livre se partage au centime pres (la
// part de Mel est le reste, donc les deux parts font toujours le tout, et le
// solde de Brice est exactement l'oppose de celui de Mel).

export type Cote = 'brice' | 'mel'
export const COTES: readonly Cote[] = ['brice', 'mel']

/** La part de celui qui apporte la vente (Brice, 08/10). L'autre prend le reste. */
export const PART_APPORTEUR_PCT = 70
/** Une depense commune sans repartition donnee. */
export const PART_BRICE_COMMUNE_PCT = 50

export const NOM_COTE: Record<Cote, string> = { brice: 'Brice', mel: 'Mel' }

export function autreCote(c: Cote): Cote {
  return c === 'brice' ? 'mel' : 'brice'
}

/** La part de Brice (en %) sur un flux d'un cote : 70 s'il l'a apporte, 30 sinon. */
export function partBriceDuCote(c: Cote): number {
  return c === 'brice' ? PART_APPORTEUR_PCT : 100 - PART_APPORTEUR_PCT
}

/** Le cote d'un compte Stripe de cockpit_paiements.compte, ou null (PayPal, virement, inconnu). */
export function coteDuCompte(compte: unknown): Cote | null {
  if (compte === 'melanie') return 'mel'
  if (compte === 'aoknowledge') return 'brice'
  return null
}

/** 'brice', 'mel', 'melanie', 'Mélanie' -> le cote ; autre chose -> null. */
export function lireCote(v: unknown): Cote | null {
  const s = sansAccents(String(v ?? '')).trim().toLowerCase()
  if (s === 'brice') return 'brice'
  if (s === 'mel' || s === 'melanie') return 'mel'
  return null
}

function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// ---------------------------------------------------------------------------
// Montants
// ---------------------------------------------------------------------------

/** Arrondi a l'entier, symetrique autour de zero (-2,5 -> -3, comme 2,5 -> 3). */
export function arrondi(v: number): number {
  const r = Math.round(Math.abs(v))
  return v < 0 ? -r : r
}

/** Des euros (nombre ou texte, virgule acceptee) en centimes, ou null s'ils sont illisibles. */
export function centimes(euros: unknown): number | null {
  if (euros === null || euros === undefined || euros === '') return null
  const n = typeof euros === 'number' ? euros : Number(String(euros).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? arrondi(n * 100) : null
}

/** Des centimes en euros (nombre a 2 decimales), pour le JSON et la base. */
export function versEuros(c: number): number {
  return Math.round(c) / 100
}

/**
 * 125050 -> '1 250,50 €', 25000 -> '250 €', -9900 -> '-99 €'. Separateur de
 * milliers = espace simple (jamais l'espace insecable de toLocaleString).
 */
export function euros(c: number): string {
  const signe = c < 0 ? '-' : ''
  const abs = Math.abs(Math.round(c))
  const entier = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const reste = abs % 100
  return `${signe}${entier}${reste ? `,${String(reste).padStart(2, '0')}` : ''} €`
}

/** « 50 » -> '50 %', 12.5 -> '12,5 %'. */
export function pourcent(p: number): string {
  return `${String(Math.round(p * 100) / 100).replace('.', ',')} %`
}

/**
 * Partage un montant (centimes, signe) selon la part de Brice en %. La part
 * de Mel est le RESTE : les deux font toujours exactement le montant.
 */
export function partager(montant: number, partBricePct: number): Record<Cote, number> {
  const brice = arrondi((montant * partBricePct) / 100)
  return { brice, mel: montant - brice }
}

// ---------------------------------------------------------------------------
// Dates et mois, en heure de Paris
// ---------------------------------------------------------------------------

const FORMAT_JOUR_PARIS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Le jour de Paris d'un instant, 'YYYY-MM-DD'. */
export function jourParis(d: Date): string {
  const parts = FORMAT_JOUR_PARIS.formatToParts(d)
  const v = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${v('year')}-${v('month')}-${v('day')}`
}

/** Le mois de Paris d'un instant, 'YYYY-MM'. */
export function moisParis(d: Date): string {
  return jourParis(d).slice(0, 7)
}

export function moisValide(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

/** 'YYYY-MM-DD' qui existe vraiment au calendrier (pas de 30 fevrier). */
export function jourValide(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s
}

export function moisDe(jour: string): string {
  return jour.slice(0, 7)
}

export function moisSuivant(mois: string): string {
  const [a, m] = mois.split('-').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

export function moisPrecedent(mois: string): string {
  const [a, m] = mois.split('-').map(Number)
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}

/** Premier et dernier jour d'un mois, 'YYYY-MM-DD'. */
export function bornesMois(mois: string): { debut: string; fin: string } {
  const [a, m] = mois.split('-').map(Number)
  const dernier = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return { debut: `${mois}-01`, fin: `${mois}-${String(dernier).padStart(2, '0')}` }
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** '2026-10' -> 'octobre 2026'. */
export function libelleMois(mois: string): string {
  const [a, m] = mois.split('-')
  return `${MOIS_FR[Number(m) - 1] ?? m} ${a}`
}

/** '2026-10' -> « d'octobre 2026 », '2026-03' -> « de mars 2026 » (élision devant une voyelle). */
export function deMois(mois: string): string {
  const libelle = libelleMois(mois)
  return /^[aeiouéèêh]/i.test(libelle) ? `d'${libelle}` : `de ${libelle}`
}

/** '2026-10-01' -> '1er octobre 2026'. */
export function libelleJour(jour: string): string {
  const [a, m, j] = jour.split('-')
  const n = Number(j)
  return `${n === 1 ? '1er' : n} ${MOIS_FR[Number(m) - 1] ?? m} ${a}`
}

/** Une valeur de date de la base (Date, ou texte) en 'YYYY-MM-DD' de Paris si c'est un instant. */
function jourDe(v: string | Date): string {
  if (v instanceof Date) return jourParis(v)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : jourParis(new Date(v))
}

/**
 * Le jour de Paris d'un paiement de cockpit_paiements : l'horodatage quand la
 * collecte le connait (un paiement du 1er a 0 h 30 a Paris est date de la
 * veille en UTC), sinon date_paiement (jour UTC, faute de mieux).
 */
export function jourDuPaiement(p: { horodatage?: string | Date | null; date_paiement: string | Date }): string {
  if (p.horodatage) {
    const d = p.horodatage instanceof Date ? p.horodatage : new Date(p.horodatage)
    if (!Number.isNaN(d.getTime())) return jourParis(d)
  }
  return jourDe(p.date_paiement)
}

// ---------------------------------------------------------------------------
// Tarifs des intervenants et taux des partenaires : deux tables DATEES, meme
// regle. En vigueur a une date = la ligne a_partir_du la plus recente avant
// ou ce jour-la ; a egalite, la derniere posee. Rien ne s'efface : un
// changement est une ligne de plus, l'historique reste lisible.
// ---------------------------------------------------------------------------

/** Les unites d'un tarif d'intervenant : une liste FERMEE (la base a la meme). */
export const UNITES_INTERVENANT = ['live'] as const
export type UniteIntervenant = (typeof UNITES_INTERVENANT)[number]

/** Le tarif d'un intervenant sur un produit, a partir d'une date (cockpit_intervenants). */
export type TarifIntervenant = {
  intervenant: string
  offreId: string
  /** Centimes par unite (par live), positif. */
  montantParUnite: number
  unite: UniteIntervenant
  aPartirDu: string
  poseLe?: string | null
}

function plusRecente<T extends { aPartirDu: string; poseLe?: string | null }>(a: T, b: T): T {
  if (a.aPartirDu !== b.aPartirDu) return a.aPartirDu > b.aPartirDu ? a : b
  return String(a.poseLe ?? '') >= String(b.poseLe ?? '') ? a : b
}

/** 'Adrien', ' adrien ', 'ADRIEN' -> la meme personne (accents et casse ignores). */
export function cleIntervenant(nom: string): string {
  return sansAccents(nom).trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Les tarifs d'un intervenant en vigueur a une date, un par produit, tries par produit. */
export function tarifsEnVigueur(
  tarifs: readonly TarifIntervenant[], intervenant: string, jour: string,
): TarifIntervenant[] {
  const cle = cleIntervenant(intervenant)
  const parProduit = new Map<string, TarifIntervenant>()
  for (const t of tarifs) {
    if (cleIntervenant(t.intervenant) !== cle || t.aPartirDu > jour) continue
    const deja = parProduit.get(t.offreId)
    parProduit.set(t.offreId, deja ? plusRecente(deja, t) : t)
  }
  return [...parProduit.values()].sort((a, b) => a.offreId.localeCompare(b.offreId))
}

export type TarifDuMois =
  | {
    ok: true
    tarif: TarifIntervenant
    /** Le tarif en vigueur le 1er du mois s'il etait different : il a change en cours de mois. */
    avant: TarifIntervenant | null
  }
  | { ok: false; raison: 'aucun' | 'plusieurs'; offres: string[] }

/**
 * Le tarif qui s'applique aux lives d'un intervenant pour un mois : celui en
 * vigueur le DERNIER jour du mois (un tarif qui demarre en cours de mois vaut
 * pour tout le mois, puisqu'on declare un seul nombre par mois ; `avant` le
 * signale). Sans offreId, le produit est deduit des tarifs : refus s'il y en
 * a plusieurs ('plusieurs', avec la liste) ou aucun ('aucun').
 */
export function tarifDuMois(
  tarifs: readonly TarifIntervenant[], intervenant: string, mois: string, offreId?: string | null,
): TarifDuMois {
  const { debut, fin } = bornesMois(mois)
  const enVigueur = tarifsEnVigueur(tarifs, intervenant, fin).filter(t => !offreId || t.offreId === offreId)
  if (enVigueur.length === 0) return { ok: false, raison: 'aucun', offres: [] }
  if (enVigueur.length > 1) return { ok: false, raison: 'plusieurs', offres: enVigueur.map(t => t.offreId) }
  const tarif = enVigueur[0]
  const auDebut = tarifsEnVigueur(tarifs, intervenant, debut).find(t => t.offreId === tarif.offreId) ?? null
  const avant = auDebut && auDebut.montantParUnite !== tarif.montantParUnite ? auDebut : null
  return { ok: true, tarif, avant }
}

/** 'live' -> 'lives' au pluriel. */
export function nomUnite(unite: UniteIntervenant, nombre: number): string {
  return nombre > 1 ? `${unite}s` : unite
}

/** '50 € par live'. */
export function libelleTarif(t: { montantParUnite: number; unite: UniteIntervenant }): string {
  return `${euros(t.montantParUnite)} par ${t.unite}`
}

/** '6 lives x 50 €'. */
export function libelleLives(quantite: number, prixUnitaire: number, unite: UniteIntervenant = 'live'): string {
  return `${quantite} ${nomUnite(unite, quantite)} x ${euros(prixUnitaire)}`
}

/** « Lives d'Adrien », « Lives de Paul » : le libelle d'une depense de lives. */
export function libelleDepenseLives(intervenant: string): string {
  const nom = intervenant.replace(/\s+/g, ' ').trim()
  return /^[aeiouyéèêëàâîïôûh]/i.test(nom) ? `Lives d'${nom}` : `Lives de ${nom}`
}

/** Les lives d'un intervenant pour un mois, devenus depense (montants en centimes). */
export type DepenseLives = {
  libelle: string
  intervenant: string
  offreId: string
  mois: string
  quantite: number
  /** Centimes par live : le tarif en vigueur ce mois-la. */
  prixUnitaire: number
  /** Centimes : quantite x prixUnitaire. */
  montant: number
  /** Le cote du produit : la depense est deduite de ce cote avant son 70/30. */
  cote: Cote
  payeePar: Cote
}

/**
 * LA DEPENSE D'UN MOIS a partir d'un nombre de lives et des tarifs dates :
 * nombre x tarif en vigueur ce mois-la (tarifDuMois), rattachee au produit
 * du tarif. `cote` = le cote de ce produit (le serveur le connait par ses
 * ventes Stripe) ; payee par `payeePar`, sinon par ce cote (Mel pour le Live
 * Club). Refus clair si aucun tarif, ou plusieurs produits possibles.
 */
export function depenseDesLives(
  tarifs: readonly TarifIntervenant[],
  o: {
    intervenant: string; mois: string; nombre: number; offreId?: string | null
    cote: Cote | ((offreId: string) => Cote | null); payeePar?: Cote | null
  },
): { ok: true; depense: DepenseLives; tarif: TarifIntervenant; avant: TarifIntervenant | null }
  | { ok: false; raison: 'aucun' | 'plusieurs' | 'cote_inconnu' | 'nombre'; offres: string[] } {
  if (!Number.isInteger(o.nombre) || o.nombre <= 0) return { ok: false, raison: 'nombre', offres: [] }
  const t = tarifDuMois(tarifs, o.intervenant, o.mois, o.offreId)
  if (!t.ok) return t
  const cote = typeof o.cote === 'function' ? o.cote(t.tarif.offreId) : o.cote
  if (!cote) return { ok: false, raison: 'cote_inconnu', offres: [t.tarif.offreId] }
  const intervenant = t.tarif.intervenant.replace(/\s+/g, ' ').trim()
  return {
    ok: true,
    tarif: t.tarif,
    avant: t.avant,
    depense: {
      libelle: libelleDepenseLives(intervenant),
      intervenant,
      offreId: t.tarif.offreId,
      mois: o.mois,
      quantite: o.nombre,
      prixUnitaire: t.tarif.montantParUnite,
      montant: o.nombre * t.tarif.montantParUnite,
      cote,
      payeePar: o.payeePar ?? cote,
    },
  }
}

export type TauxPartenaire = {
  partenaireId: string
  aPartirDu: string
  /** % du depot (ou de la vente affiliee) ; exclusif avec montantFixe. */
  tauxPct: number | null
  /** Centimes par client ; exclusif avec tauxPct. */
  montantFixe: number | null
  poseLe?: string | null
}

export function tauxEnVigueur(
  taux: readonly TauxPartenaire[], partenaireId: string, jour: string,
): TauxPartenaire | null {
  let retenu: TauxPartenaire | null = null
  for (const t of taux) {
    if (t.partenaireId !== partenaireId || t.aPartirDu > jour) continue
    retenu = retenu ? plusRecente(retenu, t) : t
  }
  return retenu
}

/**
 * La commission qu'un taux donne, en centimes : % de la base, ou montant
 * fixe. null = impossible (un % sans base).
 */
export function commissionDuTaux(
  t: { tauxPct: number | null; montantFixe: number | null }, base: number | null,
): number | null {
  if (t.montantFixe !== null) return t.montantFixe
  if (t.tauxPct === null || base === null) return null
  return arrondi((base * t.tauxPct) / 100)
}

/** '50 % du dépôt' ou '30 € par client'. */
export function libelleTaux(t: { tauxPct: number | null; montantFixe: number | null }, nature: 'depot' | 'affiliation' = 'depot'): string {
  if (t.montantFixe !== null) return `${euros(t.montantFixe)} par client`
  return `${pourcent(t.tauxPct ?? 0)} ${nature === 'depot' ? 'du dépôt' : 'de la vente'}`
}

// ---------------------------------------------------------------------------
// Ventes
// ---------------------------------------------------------------------------

export type Vente = {
  id: string
  cote: Cote
  offreId: string | null
  /** Jour de Paris : il choisit le mois de la vente. */
  jour: string
  /** Centimes encaisses (avant remboursement). */
  encaisse: number
  /** Centimes rembourses. */
  rembourse: number
  /** Centimes de frais Stripe ; null = inconnus (comptes a zero, et signales). */
  frais: number | null
}

export type VenteCalculee = Vente & {
  /** encaisse - rembourse - frais : ce qui se partage, et ce que l'encaisseur garde en main. */
  net: number
}

/**
 * Une vente et son net : encaisse - remboursements - frais Stripe (inconnus
 * = zero, signales a cote). Aucun intervenant ici : ses lives sont une
 * depense du mois (depenseDesLives).
 */
export function calculerVente(v: Vente): VenteCalculee {
  return { ...v, net: v.encaisse - v.rembourse - (v.frais ?? 0) }
}

/**
 * Une ligne de cockpit_paiements (euros) en vente (centimes), ou null hors
 * Stripe (pas de compte, donc pas de cote connu). Le montant collecte est
 * DEJA net des remboursements (amount - amount_refunded, collect_stripe.py) :
 * un remboursement partiel ou total est donc deja retire de « encaisse », et
 * une ligne negative (remboursement saisi comme paiement negatif) devient un
 * remboursement.
 */
export function venteDePaiement(p: {
  paiement_id: string
  compte: string | null
  montant: number | string
  frais: number | string | null
  offre_id: string | null
  date_paiement: string | Date
  horodatage?: string | Date | null
}): Vente | null {
  const cote = coteDuCompte(p.compte)
  if (!cote) return null
  const montant = centimes(p.montant) ?? 0
  return {
    id: p.paiement_id,
    cote,
    offreId: p.offre_id,
    jour: jourDuPaiement(p),
    encaisse: Math.max(montant, 0),
    rembourse: Math.max(-montant, 0),
    frais: p.frais === null || p.frais === undefined ? null : centimes(p.frais),
  }
}

// ---------------------------------------------------------------------------
// Commissions (broker, affiliation)
// ---------------------------------------------------------------------------

export type StatutCommission = 'attendue' | 'recue' | 'perdue'

export type Commission = {
  id: string
  partenaire: string
  client: string | null
  /** Jour du depot (ou de la vente affiliee). */
  le: string
  lotsFaitsLe: string | null
  statut: StatutCommission
  /** Centimes attendus (taux fige a l'inscription). */
  attendue: number
  /** Centimes recus (statut recue). */
  recue: number | null
  recueLe: string | null
  /** Qui a touche l'argent : Mel sauf indication. */
  encaissePar: Cote
}

/**
 * Le mois ou une commission ATTENDUE doit tomber : le broker paie a la fin du
 * mois ou le client a fait ses lots (le mois du depot s'il les fait tout de
 * suite). Lots pas faits, ou paiement pas arrive : elle GLISSE, au plus tot
 * le mois courant. null = plus attendue (recue ou perdue).
 */
export function moisPrevuCommission(c: Pick<Commission, 'statut' | 'le' | 'lotsFaitsLe'>, moisCourant: string): string | null {
  if (c.statut !== 'attendue') return null
  const depart = c.lotsFaitsLe && c.lotsFaitsLe > c.le ? c.lotsFaitsLe : c.le
  const mois = moisDe(depart)
  return mois > moisCourant ? mois : moisCourant
}

/**
 * Pourquoi une commission attendue a glisse, ou null si elle est dans son
 * mois : 'lots' = le client n'a pas encore fait ses lots, 'paiement' = lots
 * faits, le broker n'a pas encore paye.
 */
export function glissementCommission(
  c: Pick<Commission, 'statut' | 'le' | 'lotsFaitsLe'>, moisCourant: string,
): 'lots' | 'paiement' | null {
  if (c.statut !== 'attendue') return null
  const depart = c.lotsFaitsLe && c.lotsFaitsLe > c.le ? c.lotsFaitsLe : c.le
  if (moisDe(depart) >= moisCourant) return null
  return c.lotsFaitsLe ? 'paiement' : 'lots'
}

/** Le mois ou une commission compte : celui ou elle est RECUE. null sinon. */
export function moisDeLaCommission(c: Pick<Commission, 'statut' | 'recueLe'>): string | null {
  return c.statut === 'recue' && c.recueLe ? moisDe(c.recueLe) : null
}

/** Le partage d'une commission : cote Mel, donc 70 % Mel, 30 % Brice. */
export function partsCommission(montant: number): Record<Cote, number> {
  return partager(montant, partBriceDuCote('mel'))
}

// ---------------------------------------------------------------------------
// Depenses et reglements
// ---------------------------------------------------------------------------

export type Depense = {
  id: string
  libelle: string
  /** Centimes, positif. */
  montant: number
  mois: string
  payeePar: Cote
  /** null = commune. */
  cote: Cote | null
  offreId: string | null
  /** Commune seulement : la part de Brice en % (null = 50/50). */
  partBricePct: number | null
  /**
   * Les lives d'un intervenant (null pour une depense ordinaire) : le
   * montant vaut quantite x prixUnitaire, rattache au produit offreId.
   */
  lives?: { intervenant: string; quantite: number; prixUnitaire: number } | null
}

export type Reglement = {
  id: string
  de: Cote
  a: Cote
  /** Centimes, positif. */
  montant: number
  regleLe: string
  mois: string
}

// ---------------------------------------------------------------------------
// Le grand livre du mois
// ---------------------------------------------------------------------------

export type LigneGrandLivre = {
  genre: 'ventes' | 'commission' | 'depense' | 'reglement'
  libelle: string
  /** Le cote dont le flux depend (null : commune, reglement). */
  cote: Cote | null
  /** Ce que chacun a eu en main (positif) ou a paye (negatif), en centimes. */
  enMain: Record<Cote, number>
  /** Comment le flux se partage. Somme des parts = somme de enMain (0 pour un reglement). */
  parts: Record<Cote, number>
  /** Le detail en une ligne (encaisse, frais, nombre de lives x tarif...). */
  detail?: string
  /** Une depense de lives : l'intervenant, le nombre et le tarif (centimes). */
  lives?: { intervenant: string; quantite: number; prixUnitaire: number }
}

export type DetailCote = {
  nbVentes: number
  encaisse: number
  rembourse: number
  /** Frais Stripe connus. */
  frais: number
  /** Nombre de ventes sans frais connus (comptes a zero). */
  fraisInconnus: number
  /** Net des ventes : ce que l'encaisseur garde en main. */
  netVentes: number
  /** Commissions recues ce mois (cote Mel seulement). */
  commissions: number
  /** Depenses rattachees a ce cote ou a l'un de ses produits, lives des intervenants compris. */
  depenses: number
  /** Dont les lives des intervenants (deja comptes dans depenses). */
  intervenants: number
  /** Ce qui se partage en 70/30 : netVentes + commissions - depenses. */
  base: number
  /** La base partagee : la part de chacun. */
  parts: Record<Cote, number>
}

export type EntreeRepartition = {
  mois: string
  /** Le mois de Paris d'aujourd'hui : les commissions attendues y glissent. */
  moisCourant: string
  /** Les ventes du mois (les autres sont ignorees, par le jour de Paris). */
  ventes: readonly Vente[]
  /** Toutes les commissions : le module garde les recues du mois et les attendues. */
  commissions: readonly Commission[]
  depenses: readonly Depense[]
  reglements: readonly Reglement[]
  /** Les paiements hors Stripe du mois, non comptes (pas de compte connu). */
  horsStripe?: { nb: number; montant: number }
  /** offre_id -> nom, pour des libelles lisibles. */
  nomsOffres?: Readonly<Record<string, string>>
}

export type Repartition = {
  mois: string
  cotes: Record<Cote, DetailCote>
  /** Ce qui revient aux intervenants ce mois : leurs lives (depenses), et qui les paie. */
  intervenants: { intervenant: string; offreId: string; payePar: Cote; quantite: number; prixUnitaire: number; montant: number }[]
  communes: { total: number; parts: Record<Cote, number> }
  /** Somme des parts de chacun (ventes, commissions, depenses). */
  parts: Record<Cote, number>
  /** Ce que chacun a eu en main, depenses payees deduites, AVANT les reglements. */
  enMain: Record<Cote, number>
  /** Solde de Brice avant les reglements du mois. */
  soldeAvantReglements: number
  reglements: { melVersBrice: number; briceVersMel: number }
  /** Solde de Brice apres les reglements : positif, Mel lui doit ce montant. */
  solde: number
  phrase: string
  commissions: {
    recues: { nb: number; montant: number }
    /** Les attendues a ce jour (toutes glissent au plus tot vers le mois courant). */
    attendues: { nb: number; montant: number; glissees: number }
  }
  lignes: LigneGrandLivre[]
  avertissements: string[]
}

/** « Mel doit 120 € à Brice », « Brice doit 80 € à Mel », ou personne. Solde vu de Brice. */
export function phraseSolde(soldeBrice: number): string {
  if (soldeBrice > 0) return `Mel doit ${euros(soldeBrice)} à Brice`
  if (soldeBrice < 0) return `Brice doit ${euros(-soldeBrice)} à Mel`
  return 'Personne ne doit rien à personne'
}

const zero = (): Record<Cote, number> => ({ brice: 0, mel: 0 })

function detailVide(): DetailCote {
  return {
    nbVentes: 0, encaisse: 0, rembourse: 0, frais: 0, fraisInconnus: 0,
    netVentes: 0, commissions: 0, depenses: 0, intervenants: 0, base: 0, parts: zero(),
  }
}

/** Le solde de Brice d'un ensemble de lignes : ses parts - ce qu'il a eu en main. */
export function soldeDesLignes(lignes: readonly LigneGrandLivre[]): number {
  return lignes.reduce((s, l) => s + l.parts.brice - l.enMain.brice, 0)
}

/**
 * LA REPARTITION D'UN MOIS. Construit le grand livre ligne par ligne, puis
 * en tire les parts, ce que chacun a eu en main, et le solde.
 *
 * - Ventes : une ligne par cote et par produit. En main : l'encaisseur (le
 *   proprietaire du Stripe), pour le NET (frais et remboursements
 *   deduits). Parts : 70/30.
 * - Commission recue ce mois : en main de qui l'a touchee (Mel sauf
 *   indication), parts 30 Brice / 70 Mel (cote Mel).
 * - Depense : en main NEGATIF de qui l'a payee. Parts negatives : 70/30 du
 *   cote ou du produit rattache, sinon la repartition commune. Les lives
 *   d'un intervenant sont une depense rattachee a son produit.
 * - Reglement : en main + pour celui qui recoit, - pour celui qui verse,
 *   parts nulles.
 */
export function repartitionDuMois(e: EntreeRepartition): Repartition {
  const lignes: LigneGrandLivre[] = []
  const avertissements: string[] = []
  const cotes: Record<Cote, DetailCote> = { brice: detailVide(), mel: detailVide() }
  const nomOffre = (id: string | null) => (id ? e.nomsOffres?.[id] ?? id : 'non classé')

  // Ventes, regroupees par cote et produit.
  const groupes = new Map<string, { cote: Cote; offreId: string | null; ventes: VenteCalculee[] }>()
  for (const v of e.ventes) {
    if (moisDe(v.jour) !== e.mois) continue
    const calc = calculerVente(v)
    const cle = `${v.cote}|${v.offreId ?? ''}`
    const g = groupes.get(cle) ?? { cote: v.cote, offreId: v.offreId, ventes: [] }
    g.ventes.push(calc)
    groupes.set(cle, g)
  }
  const ordreGroupes = [...groupes.values()].sort((a, b) =>
    a.cote === b.cote ? nomOffre(a.offreId).localeCompare(nomOffre(b.offreId)) : (a.cote === 'mel' ? -1 : 1))
  for (const g of ordreGroupes) {
    const d = cotes[g.cote]
    let encaisse = 0, rembourse = 0, frais = 0, inconnus = 0, net = 0
    for (const v of g.ventes) {
      encaisse += v.encaisse
      rembourse += v.rembourse
      if (v.frais === null) inconnus += 1
      else frais += v.frais
      net += v.net
    }
    d.nbVentes += g.ventes.length
    d.encaisse += encaisse
    d.rembourse += rembourse
    d.frais += frais
    d.fraisInconnus += inconnus
    d.netVentes += net
    const enMain = zero()
    enMain[g.cote] = net
    const morceaux = [`${g.ventes.length} vente${g.ventes.length > 1 ? 's' : ''}`, `encaissé ${euros(encaisse)}`]
    if (rembourse) morceaux.push(`remboursé ${euros(rembourse)}`)
    morceaux.push(`frais Stripe ${euros(frais)}${inconnus ? ` (${inconnus} inconnus)` : ''}`)
    lignes.push({
      genre: 'ventes',
      libelle: `${nomOffre(g.offreId)} (Stripe de ${NOM_COTE[g.cote]})`,
      cote: g.cote,
      enMain,
      parts: partager(net, partBriceDuCote(g.cote)),
      detail: `${morceaux.join(', ')}, net ${euros(net)}`,
    })
  }

  // Commissions : recues ce mois (elles comptent ici), attendues (a suivre).
  let nbRecues = 0, recues = 0, nbAttendues = 0, attendues = 0, glissees = 0
  for (const c of [...e.commissions].sort((a, b) => a.le.localeCompare(b.le))) {
    if (c.statut === 'attendue') {
      nbAttendues += 1
      attendues += c.attendue
      if (glissementCommission(c, e.moisCourant)) glissees += 1
      continue
    }
    if (moisDeLaCommission(c) !== e.mois || c.recue === null) continue
    nbRecues += 1
    recues += c.recue
    cotes.mel.commissions += c.recue
    const enMain = zero()
    enMain[c.encaissePar] = c.recue
    lignes.push({
      genre: 'commission',
      libelle: `Commission ${c.partenaire}${c.client ? `, ${c.client}` : ''}`,
      cote: 'mel',
      enMain,
      parts: partsCommission(c.recue),
      detail: `reçue le ${libelleJour(c.recueLe ?? '')} par ${NOM_COTE[c.encaissePar]}, attendue ${euros(c.attendue)}`,
    })
  }

  // Depenses du mois (les lives des intervenants en sont).
  const communes = { total: 0, parts: zero() }
  const parIntervenant = new Map<string, Repartition['intervenants'][number]>()
  for (const d of e.depenses) {
    if (d.mois !== e.mois) continue
    const enMain = zero()
    enMain[d.payeePar] = -d.montant
    if (d.cote) {
      cotes[d.cote].depenses += d.montant
      const lives = d.lives ?? null
      if (lives) {
        cotes[d.cote].intervenants += d.montant
        const cle = `${cleIntervenant(lives.intervenant)}|${d.offreId ?? ''}|${d.payeePar}|${lives.prixUnitaire}`
        const deja = parIntervenant.get(cle) ?? {
          intervenant: lives.intervenant.trim(), offreId: d.offreId ?? '', payePar: d.payeePar,
          quantite: 0, prixUnitaire: lives.prixUnitaire, montant: 0,
        }
        deja.quantite += lives.quantite
        deja.montant += d.montant
        parIntervenant.set(cle, deja)
      }
      lignes.push({
        genre: 'depense',
        libelle: d.libelle,
        cote: d.cote,
        enMain,
        parts: partager(-d.montant, partBriceDuCote(d.cote)),
        detail: (lives ? `${libelleLives(lives.quantite, lives.prixUnitaire)}, ` : '')
          + `payée par ${NOM_COTE[d.payeePar]}, `
          + (d.offreId ? `produit ${nomOffre(d.offreId)} (côté ${NOM_COTE[d.cote]})` : `côté ${NOM_COTE[d.cote]}`),
        ...(lives ? { lives: { intervenant: lives.intervenant.trim(), quantite: lives.quantite, prixUnitaire: lives.prixUnitaire } } : {}),
      })
      continue
    }
    const pct = d.partBricePct ?? PART_BRICE_COMMUNE_PCT
    const parts = partager(-d.montant, pct)
    communes.total += d.montant
    communes.parts.brice -= parts.brice
    communes.parts.mel -= parts.mel
    lignes.push({
      genre: 'depense',
      libelle: d.libelle,
      cote: null,
      enMain,
      parts,
      detail: `payée par ${NOM_COTE[d.payeePar]}, commune ${d.partBricePct === null ? '50/50' : `${pourcent(pct)} Brice`}`,
    })
  }

  // Base et parts de chaque cote : la somme de SES lignes (ventes,
  // commissions, depenses rattachees), arrondies ligne a ligne.
  for (const c of COTES) {
    const d = cotes[c]
    d.base = d.netVentes + d.commissions - d.depenses
    d.parts = lignes.filter(l => l.cote === c).reduce(
      (s, l) => ({ brice: s.brice + l.parts.brice, mel: s.mel + l.parts.mel }), zero())
  }

  const parts = zero()
  const enMain = zero()
  for (const l of lignes) {
    for (const c of COTES) {
      parts[c] += l.parts[c]
      enMain[c] += l.enMain[c]
    }
  }
  const soldeAvantReglements = parts.brice - enMain.brice

  // Reglements du mois : en main de celui qui recoit, parts nulles.
  const reglements = { melVersBrice: 0, briceVersMel: 0 }
  for (const r of e.reglements) {
    if (r.mois !== e.mois || r.de === r.a) continue
    if (r.de === 'mel') reglements.melVersBrice += r.montant
    else reglements.briceVersMel += r.montant
    const em = zero()
    em[r.a] = r.montant
    em[r.de] = -r.montant
    lignes.push({
      genre: 'reglement',
      libelle: `Règlement de ${NOM_COTE[r.de]} à ${NOM_COTE[r.a]}`,
      cote: null,
      enMain: em,
      parts: zero(),
      detail: `le ${libelleJour(r.regleLe)}`,
    })
  }
  const solde = soldeDesLignes(lignes)

  // Ce qui merite d'etre dit a cote du chiffre.
  const inconnus = cotes.brice.fraisInconnus + cotes.mel.fraisInconnus
  if (inconnus) {
    avertissements.push(`Frais Stripe non comptés sur ${inconnus} vente${inconnus > 1 ? 's' : ''} (inconnus à la collecte) : leur net est surestimé d'autant.`)
  }
  if (e.horsStripe && e.horsStripe.nb > 0) {
    avertissements.push(`${e.horsStripe.nb} paiement${e.horsStripe.nb > 1 ? 's' : ''} hors Stripe (PayPal, virement...) pour ${euros(e.horsStripe.montant)} : non comptés, faute de savoir qui les a encaissés.`)
  }

  return {
    mois: e.mois,
    cotes,
    intervenants: [...parIntervenant.values()].filter(i => i.montant !== 0)
      .sort((a, b) => b.montant - a.montant),
    communes,
    parts,
    enMain,
    soldeAvantReglements,
    reglements,
    solde,
    phrase: phraseSolde(solde),
    commissions: {
      recues: { nb: nbRecues, montant: recues },
      attendues: { nb: nbAttendues, montant: attendues, glissees },
    },
    lignes,
    avertissements,
  }
}

// ---------------------------------------------------------------------------
// Les outils de l'agent du Cockpit (08/10) : validation STRICTE des
// parametres (c'est du texte qui vient d'un modele), cote serveur, et texte
// de la carte de confirmation. Les montants restent en EUROS dans les
// parametres (la carte memorisee est relue et revalidee a l'execution : la
// validation doit etre idempotente).
// ---------------------------------------------------------------------------

export const TYPES_REPARTITION = [
  'depot_broker', 'commission_affiliation', 'marquer_commission',
  'taux_partenaire', 'intervenant', 'lives_du_mois', 'depense', 'reglement',
] as const
export type TypeRepartition = (typeof TYPES_REPARTITION)[number]

export function estTypeRepartition(t: unknown): t is TypeRepartition {
  return (TYPES_REPARTITION as readonly string[]).includes(String(t))
}

export type ContexteParams = {
  /** 'YYYY-MM-DD', jour de Paris. */
  aujourdhui: string
  /** 'YYYY-MM', mois de Paris. */
  moisCourant: string
}

/** 'RaiseFx', 'Raise FX', 'raisefx' -> 'raisefx'. null s'il ne reste rien d'utilisable. */
export function slugPartenaire(nom: unknown): string | null {
  const s = sansAccents(String(nom ?? '')).toLowerCase().replace(/[^a-z0-9]/g, '')
  return s.length >= 2 && s.length <= 40 ? s : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function texteCourt(v: unknown, max: number): string | null {
  const s = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/** Euros a 2 decimales dans ]min, max], ou le message d'erreur. */
function lireEuros(v: unknown, nom: string, o: { min?: number; max: number; zeroAccepte?: boolean }): number | string {
  const c = centimes(v)
  if (c === null) return `${nom} : un montant en euros (ex. 500 ou 49,90).`
  const min = o.min ?? 0
  if (o.zeroAccepte ? c < min * 100 : c <= min * 100) return `${nom} : un montant ${o.zeroAccepte ? 'positif ou nul' : 'positif'}.`
  if (c > o.max * 100) return `${nom} : ${euros(o.max * 100)} au plus.`
  return versEuros(c)
}

/** Un jour 'YYYY-MM-DD', le defaut si vide ; jamais apres `auPlusTard` s'il est donne. */
function lireJour(v: unknown, nom: string, defaut: string, auPlusTard?: string): string | string[] {
  const s = v === null || v === undefined ? '' : String(v).trim()
  if (!s) return [defaut]
  if (!jourValide(s)) return `${nom} : une date AAAA-MM-JJ.`
  if (auPlusTard && s > auPlusTard) return `${nom} : ${s} est dans le futur.`
  return [s]
}

function lireMois(v: unknown, defaut: string): string | string[] {
  const s = v === null || v === undefined ? '' : String(v).trim()
  if (!s) return [defaut]
  if (!moisValide(s)) return 'mois : au format AAAA-MM (ex. 2026-10).'
  return [s]
}

/** Vide -> 'live' (l'unite par defaut) ; une unite de la liste fermee, ou null. */
function lireUnite(v: unknown): UniteIntervenant | null {
  const s = v === null || v === undefined ? '' : String(v).trim().toLowerCase()
  if (!s) return 'live'
  const u = s === 'lives' ? 'live' : s
  return (UNITES_INTERVENANT as readonly string[]).includes(u) ? (u as UniteIntervenant) : null
}

function lireEmail(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  return s.length <= 254 && /^[^\s@<>(),;"]+@[^\s@<>(),;"]+\.[a-z]{2,}$/.test(s) ? s : null
}

/**
 * Les parametres d'un outil de repartition, normalises, ou la raison du
 * refus (rendue au modele pour qu'il corrige ou pose la question).
 */
export function lireParamsRepartition(
  type: TypeRepartition, p: Record<string, unknown>, ctx: ContexteParams,
): Record<string, unknown> | string {
  const note = texteCourt(p.note, 300)

  if (type === 'depot_broker' || type === 'commission_affiliation') {
    const partenaire = slugPartenaire(p.partenaire)
    if (!partenaire) return 'partenaire : le nom du broker ou du partenaire (ex. RaiseFx).'
    const partenaireNom = texteCourt(p.partenaire_nom, 80) ?? (texteCourt(p.partenaire, 80) as string)
    const jour = lireJour(p.le, 'le', ctx.aujourdhui, ctx.aujourdhui)
    if (typeof jour === 'string') return jour
    const client = texteCourt(p.client, 120)
    if (type === 'depot_broker') {
      const email = lireEmail(p.email)
      if (!email) {
        return "email : l'adresse email du client, nécessaire pour son accès au Live Club. Si elle n'est pas donnée, demande-la, n'en invente jamais."
      }
      const montant = lireEuros(p.montant, 'montant (le dépôt)', { max: 1000000 })
      if (typeof montant === 'string') return montant
      return { partenaire, partenaire_nom: partenaireNom, email, client, montant, le: jour[0], note }
    }
    // Affiliation : la base n'est utile qu'a un taux en % (le serveur le dit).
    let montant: number | null = null
    if (p.montant !== null && p.montant !== undefined && p.montant !== '') {
      const m = lireEuros(p.montant, 'montant (la vente affiliée)', { max: 1000000 })
      if (typeof m === 'string') return m
      montant = m
    }
    if (!client) return 'client : qui a été apporté (nom ou email), pour que la commission soit reconnaissable.'
    return { partenaire, partenaire_nom: partenaireNom, client, montant, le: jour[0], note }
  }

  if (type === 'marquer_commission') {
    const id = String(p.commission_id ?? '').trim().toLowerCase()
    if (!UUID.test(id)) return 'commission_id : l\'identifiant exact, depuis cockpit_commissions.'
    const etat = String(p.etat ?? '').trim()
    if (!['lots_faits', 'recue', 'perdue'].includes(etat)) return 'etat : lots_faits, recue ou perdue.'
    const jour = lireJour(p.le, 'le', ctx.aujourdhui, ctx.aujourdhui)
    if (typeof jour === 'string') return jour
    const qui = texteCourt(p.qui, 80)
    if (etat === 'recue') {
      const montant = lireEuros(p.montant, 'montant (reçu)', { max: 10000000, zeroAccepte: true })
      if (typeof montant === 'string') return `${montant} Demande le montant réellement reçu.`
      const encaissePar = p.encaisse_par === null || p.encaisse_par === undefined || p.encaisse_par === ''
        ? 'mel' : lireCote(p.encaisse_par)
      if (!encaissePar) return 'encaisse_par : brice ou mel (Mel par défaut).'
      return { commission_id: id, etat, montant, le: jour[0], encaisse_par: encaissePar, qui, note }
    }
    return { commission_id: id, etat, le: jour[0], qui, note }
  }

  if (type === 'taux_partenaire') {
    const partenaire = slugPartenaire(p.partenaire)
    if (!partenaire) return 'partenaire : le nom du broker ou du partenaire (ex. RaiseFx).'
    const partenaireNom = texteCourt(p.partenaire_nom, 80) ?? (texteCourt(p.partenaire, 80) as string)
    let nature: 'broker' | 'affiliation' | null = null
    if (p.nature !== null && p.nature !== undefined && p.nature !== '') {
      const n = String(p.nature).trim().toLowerCase()
      if (n !== 'broker' && n !== 'affiliation') return 'nature : broker ou affiliation.'
      nature = n
    }
    const aPct = p.taux_pct !== null && p.taux_pct !== undefined && p.taux_pct !== ''
    const aFixe = p.montant_fixe !== null && p.montant_fixe !== undefined && p.montant_fixe !== ''
    if (aPct === aFixe) return 'Il faut soit taux_pct (en % du dépôt), soit montant_fixe (euros par client) : exactement un des deux.'
    let tauxPct: number | null = null
    let montantFixe: number | null = null
    if (aPct) {
      const t = Number(String(p.taux_pct).replace(',', '.').replace('%', '').trim())
      if (!Number.isFinite(t) || t < 0 || t > 500) return 'taux_pct : un pourcentage entre 0 et 500 (ex. 50 pour 50 % du dépôt).'
      tauxPct = Math.round(t * 100) / 100
    } else {
      const m = lireEuros(p.montant_fixe, 'montant_fixe', { max: 100000, zeroAccepte: true })
      if (typeof m === 'string') return m
      montantFixe = m
    }
    const jour = lireJour(p.a_partir_du, 'a_partir_du', ctx.aujourdhui)
    if (typeof jour === 'string') return jour
    return { partenaire, partenaire_nom: partenaireNom, nature, taux_pct: tauxPct, montant_fixe: montantFixe, a_partir_du: jour[0], note }
  }

  if (type === 'intervenant') {
    const intervenant = texteCourt(p.intervenant, 80)
    if (!intervenant) return 'intervenant : son prénom (ex. Adrien).'
    const offreId = texteCourt(p.offre_id, 80)
    if (!offreId || /\s/.test(offreId)) return "offre_id : l'identifiant du produit, depuis cockpit_offres (ex. live-club)."
    const unite = lireUnite(p.unite)
    if (!unite) return 'unite : live (la seule unité pour l\'instant).'
    const montant = lireEuros(p.montant_par_live, 'montant_par_live (ce qu\'il touche par live, en euros)', { max: 100000 })
    if (typeof montant === 'string') return `${montant} Si ce n'est pas dit, demande combien il prend par live.`
    const jour = lireJour(p.a_partir_du, 'a_partir_du', ctx.aujourdhui)
    if (typeof jour === 'string') return jour
    return { intervenant, offre_id: offreId, montant_par_live: montant, unite, a_partir_du: jour[0], note }
  }

  if (type === 'lives_du_mois') {
    const intervenant = texteCourt(p.intervenant, 80)
    if (!intervenant) return 'intervenant : son prénom (ex. Adrien).'
    const mois = lireMois(p.mois, ctx.moisCourant)
    if (typeof mois === 'string') return mois
    if (mois[0] > ctx.moisCourant) return `mois : ${mois[0]} n'est pas encore commencé, on déclare les lives faits.`
    const brut = String(p.nombre ?? '').trim()
    const nombre = Number(brut)
    if (!brut || !Number.isInteger(nombre) || nombre < 1 || nombre > 1000) {
      return 'nombre : le nombre de lives faits dans le mois, un entier positif (ex. 6).'
    }
    const vide = (v: unknown) => v === null || v === undefined || v === ''
    let payeePar: Cote | null = null
    if (!vide(p.payee_par)) {
      payeePar = lireCote(p.payee_par)
      if (!payeePar) return 'payee_par : brice ou mel (vide = le côté du produit, Mel pour le Live Club).'
    }
    let offreId: string | null = null
    if (!vide(p.offre_id)) {
      offreId = texteCourt(p.offre_id, 80)
      if (!offreId || /\s/.test(offreId)) return "offre_id : l'identifiant du produit, depuis cockpit_offres (ex. live-club)."
    }
    // Poses par le serveur avant la carte (cote du produit, tarif du mois),
    // relus a l'execution : la validation reste idempotente.
    let cote: Cote | null = null
    if (!vide(p.cote)) {
      cote = lireCote(p.cote)
      if (!cote) return 'cote : brice ou mel, le côté du produit.'
    }
    let prixUnitaire: number | null = null
    if (!vide(p.prix_unitaire)) {
      const prix = lireEuros(p.prix_unitaire, 'prix_unitaire', { max: 100000 })
      if (typeof prix === 'string') return prix
      prixUnitaire = prix
    }
    return {
      intervenant, mois: mois[0], nombre, offre_id: offreId, cote, payee_par: payeePar, prix_unitaire: prixUnitaire, note,
    }
  }

  if (type === 'depense') {
    const libelle = texteCourt(p.libelle, 200)
    if (!libelle) return 'libelle : ce que c\'est (ex. abonnement Canva).'
    const montant = lireEuros(p.montant, 'montant', { max: 1000000 })
    if (typeof montant === 'string') return montant
    const mois = lireMois(p.mois, ctx.moisCourant)
    if (typeof mois === 'string') return mois
    const payeePar = lireCote(p.payee_par)
    if (!payeePar) return 'payee_par : brice ou mel. Si ce n\'est pas dit, demande qui a payé.'
    const rattachement = String(p.rattachement ?? 'commune').trim().toLowerCase()
    if (rattachement === 'commune') {
      let partBrice: number | null = null
      if (p.part_brice_pct !== null && p.part_brice_pct !== undefined && p.part_brice_pct !== '') {
        const n = Number(String(p.part_brice_pct).replace(',', '.').replace('%', '').trim())
        if (!Number.isFinite(n) || n < 0 || n > 100) return 'part_brice_pct : la part de Brice entre 0 et 100 (vide = 50/50).'
        partBrice = Math.round(n * 100) / 100
      }
      return { libelle, montant, mois: mois[0], payee_par: payeePar, rattachement, cote: null, offre_id: null, part_brice_pct: partBrice, note }
    }
    const cote = lireCote(rattachement)
    if (cote) return { libelle, montant, mois: mois[0], payee_par: payeePar, rattachement: cote, cote, offre_id: null, part_brice_pct: null, note }
    if (rattachement !== 'produit') return 'rattachement : commune, brice, mel ou produit.'
    const offreId = texteCourt(p.offre_id, 80)
    if (!offreId || /\s/.test(offreId)) return "offre_id : l'identifiant du produit, depuis cockpit_offres."
    // Le cote du produit est pose par le serveur (d'apres ses ventes) avant la carte.
    const coteProduit = p.cote === null || p.cote === undefined || p.cote === '' ? null : lireCote(p.cote)
    return { libelle, montant, mois: mois[0], payee_par: payeePar, rattachement, cote: coteProduit, offre_id: offreId, part_brice_pct: null, note }
  }

  // reglement
  const de = lireCote(p.de)
  const a = lireCote(p.a)
  if (!de || !a) return 'de et a : brice ou mel (qui a versé, qui a reçu).'
  if (de === a) return 'de et a doivent être deux personnes différentes.'
  const montant = lireEuros(p.montant, 'montant', { max: 1000000 })
  if (typeof montant === 'string') return montant
  const jour = lireJour(p.le, 'le', ctx.aujourdhui, ctx.aujourdhui)
  if (typeof jour === 'string') return jour
  const mois = lireMois(p.mois, ctx.moisCourant)
  if (typeof mois === 'string') return mois
  return { de, a, montant, le: jour[0], mois: mois[0], note }
}

const eur = (v: unknown) => euros(centimes(v) ?? 0)

/** Le texte de la carte de confirmation (sans le complement calcule par le serveur). */
export function resumeRepartition(type: TypeRepartition, p: Record<string, unknown>): string {
  const note = p.note ? ` Note : ${p.note}` : ''
  switch (type) {
    case 'depot_broker':
      return `Inscrire un dépôt de ${eur(p.montant)} chez ${p.partenaire_nom}, le ${libelleJour(String(p.le))}, `
        + `pour ${p.client ? `${p.client} (${p.email})` : p.email}. Si cette adresse n'a jamais eu d'accès broker, `
        + `elle reçoit 6 mois de Live Club et son email d'invitation part tout de suite (non renouvelable).${note}`
    case 'commission_affiliation':
      return `Inscrire une commission d'affiliation ${p.partenaire_nom} pour ${p.client}, le ${libelleJour(String(p.le))}`
        + `${p.montant !== null && p.montant !== undefined ? `, sur une vente de ${eur(p.montant)}` : ''}.${note}`
    case 'marquer_commission':
      if (p.etat === 'lots_faits') return `Noter que ${p.qui ?? 'le client'} a fait ses lots le ${libelleJour(String(p.le))}.${note}`
      if (p.etat === 'recue') {
        return `Marquer la commission${p.qui ? ` de ${p.qui}` : ''} reçue : ${eur(p.montant)} le ${libelleJour(String(p.le))}, `
          + `encaissée par ${NOM_COTE[p.encaisse_par as Cote]}. Elle comptera dans ${libelleMois(moisDe(String(p.le)))}.${note}`
      }
      return `Marquer la commission${p.qui ? ` de ${p.qui}` : ''} perdue : elle sort des commissions attendues.${note}`
    case 'taux_partenaire': {
      const t = { tauxPct: (p.taux_pct as number | null) ?? null, montantFixe: p.montant_fixe === null || p.montant_fixe === undefined ? null : centimes(p.montant_fixe) }
      return `Taux de ${p.partenaire_nom}${p.nature ? ` (${p.nature})` : ''} : ${libelleTaux(t)} à partir du ${libelleJour(String(p.a_partir_du))}. `
        + `Les dépôts déjà inscrits gardent le taux de leur date.${note}`
    }
    case 'intervenant': {
      const unite = (p.unite as UniteIntervenant | undefined) ?? 'live'
      return `Tarif de ${p.intervenant} sur ${p.offre_id} : ${libelleTarif({ montantParUnite: centimes(p.montant_par_live) ?? 0, unite })} `
        + `à partir du ${libelleJour(String(p.a_partir_du))}. Chaque mois, ses lives déclarés font une dépense de ce produit, `
        + `déduite de son côté avant le 70/30.${note}`
    }
    case 'lives_du_mois': {
      const n = Number(p.nombre)
      const prix = p.prix_unitaire === null || p.prix_unitaire === undefined ? null : centimes(p.prix_unitaire)
      const combien = prix === null
        ? `${n} ${nomUnite('live', n)} au tarif en vigueur`
        : `${libelleLives(n, prix)} = ${euros(n * prix)}`
      const produit = p.offre_id
        ? `rattachée au produit ${p.offre_id}${p.cote ? ` (côté ${NOM_COTE[p.cote as Cote]})` : ''}, déduite avant son 70/30`
        : 'rattachée au produit de son tarif, déduite avant son 70/30'
      const payeur = p.payee_par
        ? `payée par ${NOM_COTE[p.payee_par as Cote]}`
        : 'payée par le côté du produit'
      return `Ajouter à ${libelleMois(String(p.mois))} une dépense d'intervenant : ${p.intervenant}, ${combien}, `
        + `${produit}, ${payeur}.${note}`
    }
    case 'depense': {
      const rattache = p.rattachement === 'commune'
        ? `commune, ${p.part_brice_pct === null || p.part_brice_pct === undefined ? '50/50' : `${pourcent(Number(p.part_brice_pct))} pour Brice`}`
        : p.rattachement === 'produit'
          ? `produit ${p.offre_id}${p.cote ? ` (côté ${NOM_COTE[p.cote as Cote]})` : ''}, déduite avant son 70/30`
          : `côté ${NOM_COTE[p.rattachement as Cote]}, déduite avant son 70/30`
      return `Ajouter une dépense à ${libelleMois(String(p.mois))} : ${p.libelle}, ${eur(p.montant)}, `
        + `payée par ${NOM_COTE[p.payee_par as Cote]}, ${rattache}.${note}`
    }
    case 'reglement':
      return `Noter un règlement : ${NOM_COTE[p.de as Cote]} a versé ${eur(p.montant)} à ${NOM_COTE[p.a as Cote]} `
        + `le ${libelleJour(String(p.le))}, sur le solde ${deMois(String(p.mois))}.${note}`
  }
}

// ---------------------------------------------------------------------------
// L'etape humaine suivante, en une ligne, a la fin de chaque resultat (comme
// les gestes d'acces du 08/10).
// ---------------------------------------------------------------------------

export type IssueAccesDepot = 'email_parti' | 'email_pas_parti' | 'existant' | 'abonne'

export function etapeApresDepot(o: { acces: IssueAccesDepot; qui: string; partenaire: string; bot: string }): string {
  const lots = `dis-moi quand ${o.qui} a fait ses lots chez ${o.partenaire}.`
  switch (o.acces) {
    case 'email_parti': return `Rien à faire pour l'accès : ${o.qui} reçoit son lien par email. Ensuite, ${lots}`
    case 'email_pas_parti': return `Dis à ${o.qui} d'ouvrir @${o.bot} et d'appuyer sur Démarrer, puis ${lots}`
    case 'existant': return `Rien à faire pour l'accès (il existe déjà). Ensuite, ${lots}`
    case 'abonne': return `Rien à faire pour l'accès (déjà abonné au Live Club). Ensuite, ${lots}`
  }
}

export function etapeApresMarquage(etat: 'lots_faits' | 'recue' | 'perdue', partenaire: string, moisRecue?: string): string {
  if (etat === 'lots_faits') return `Quand ${partenaire} paie, donne-moi le montant reçu et la date.`
  if (etat === 'recue') return `Rien à faire : elle compte dans la répartition ${deMois(moisRecue ?? '')}.`
  return 'Rien à faire : elle sort des commissions attendues.'
}
