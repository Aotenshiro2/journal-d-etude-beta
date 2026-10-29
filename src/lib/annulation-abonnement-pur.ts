// L'ANNULATION D'UN ABONNEMENT STRIPE PAR L'AGENT DU COCKPIT (demande de
// Brice, 30/10/2026 : « Cela fait partie des demandes que je suis censé pouvoir
// faire à l'agent. »). Carnet Premium, Pilotage Premium, Premium Duo (compte
// aoknowledge) et Live Club (compte melanie).
//
// Fonctions PURES : aucune base, aucun reseau, aucun import (comme
// liveclub/pur.ts : scripts/verifier-annulation-abonnement.mjs les teste avec
// Node seul). D'ou les trois petits formats recopies plus bas (date, montant,
// periode), alignes sur ceux de liveclub/pur.ts.
//
// Le chemin est celui des autres cartes : l'agent propose
// (proposer_annulation_abonnement), le serveur retrouve l'abonnement chez
// Stripe AVANT la carte (stripe-actions.ts, controlerActionStripe), la carte
// dit en clair qui, quoi, combien, l'echeance et ce qui se passe, et seul le
// clic de Brice ou Melanie l'execute (executerAction) :
//   - fin-de-periode (defaut) : POST /v1/subscriptions/<id> cancel_at_period_end=true,
//     le membre garde ce qu'il a paye, rien n'est rembourse ;
//   - immediatement (essai, remboursement, fraude) : DELETE /v1/subscriptions/<id>,
//     sans facture finale ni prorata.
// Annuler n'est pas rembourser : un remboursement reste sa propre carte.
// Le droit cote membre suit seul (webhook Pilotage, verification en direct du
// Carnet, passage quotidien du Live Club) : rien ici n'y touche.

export const QUANDS_ANNULATION = ['fin-de-periode', 'immediatement'] as const
export type QuandAnnulation = (typeof QUANDS_ANNULATION)[number]

/** Le motif tel qu'il part chez Stripe (cancellation_details[comment]) et sur la carte. */
export const MOTIF_MAX = 200

const ID_ABONNEMENT = /^sub_[A-Za-z0-9]{8,}$/
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/
/** Statuts d'un abonnement deja fini chez Stripe : rien a annuler. */
const STATUTS_TERMINES = ['canceled', 'incomplete_expired']

export type ParamsAnnulation = {
  /** sub_..., sans le prefixe stripe: ; pose par le controle avant la carte quand seul l'email est donne. */
  abonnement_id: string | null
  /** L'email du membre (minuscules) : sert a retrouver l'abonnement quand l'id manque. */
  email: string | null
  quand: QuandAnnulation
  motif: string | null
  qui: string | null
  // Champs du SERVEUR (controle avant la carte, lus chez Stripe) : gardes
  // s'ils sont bien formes, toujours reecrits par le controle, jamais crus a
  // l'execution (qui relit l'abonnement).
  produit: string | null
  tarif: string | null
  /** Prochaine echeance (fin de la periode en cours, ou fin de l'essai), YYYY-MM-DD. */
  echeance: string | null
  statut: string | null
  /** Un arret deja programme (cancel_at ou fin de periode), YYYY-MM-DD. */
  arret_le: string | null
  /** Une pause posee : reprise des prelevements le (YYYY-MM-DD), 'sans-date' si aucune. */
  pause_jusquau: string | null
}

function texteBorne(v: unknown, max: number): string | null {
  if (v == null) return null
  const s = String(v).replace(/\s+/g, ' ').trim().slice(0, max)
  return s || null
}

function dateLue(v: unknown): string | null {
  return typeof v === 'string' && DATE_ISO.test(v) ? v : null
}

/** Meme regle que normaliserEmail (liveclub/pur.ts). */
export function normaliserEmailAnnulation(brut: unknown): string | null {
  const s = String(brut ?? '').trim().toLowerCase()
  if (s.length < 5 || s.length > 254) return null
  return /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[a-z]{2,}$/.test(s) ? s : null
}

/**
 * Les parametres d'une annulation proposee par l'agent, ou la raison du refus
 * (rendue au modele). Il faut l'abonnement_id OU l'email du membre.
 */
export function lireParamsAnnulation(p: Record<string, unknown>): ParamsAnnulation | string {
  let abonnement: string | null = null
  if (p.abonnement_id != null && String(p.abonnement_id).trim() !== '') {
    abonnement = String(p.abonnement_id).trim().replace(/^stripe:/, '')
    if (!ID_ABONNEMENT.test(abonnement)) {
      return 'abonnement_id invalide (sub_..., depuis cockpit_abonnements sans le préfixe stripe:), ou vide avec l\'email du membre.'
    }
  }
  let email: string | null = null
  if (p.email != null && String(p.email).trim() !== '') {
    email = normaliserEmailAnnulation(p.email)
    if (!email) return `Email illisible (${String(p.email).trim().slice(0, 80)}) : corrige-le, ou passe l'abonnement_id.`
  }
  if (!abonnement && !email) {
    return "Il faut l'abonnement à annuler : abonnement_id (sub_..., cockpit_abonnements), ou l'email du membre pour que je le retrouve chez Stripe."
  }
  const quandBrut = p.quand == null || String(p.quand).trim() === '' ? 'fin-de-periode' : String(p.quand).trim()
  if (!(QUANDS_ANNULATION as readonly string[]).includes(quandBrut)) {
    return 'quand : fin-de-periode (défaut, le membre garde ce qu\'il a payé) ou immediatement.'
  }
  const pause = p.pause_jusquau === 'sans-date' ? 'sans-date' : dateLue(p.pause_jusquau)
  return {
    abonnement_id: abonnement,
    email,
    quand: quandBrut as QuandAnnulation,
    motif: texteBorne(p.motif, MOTIF_MAX),
    qui: texteBorne(p.qui, 80),
    produit: texteBorne(p.produit, 200),
    tarif: texteBorne(p.tarif, 120),
    echeance: dateLue(p.echeance),
    statut: typeof p.statut === 'string' && /^[a-z_]{3,30}$/.test(p.statut) ? p.statut : null,
    arret_le: dateLue(p.arret_le),
    pause_jusquau: pause,
  }
}

// ---------------------------------------------------------------------------
// Lecture d'un abonnement Stripe brut (version epinglee 2025-09-30.clover :
// current_period_end sur les items, la racine en repli).
// ---------------------------------------------------------------------------

export type AbonnementLu = {
  id: string
  statut: string
  clientId: string | null
  nom: string | null
  email: string | null
  /** Noms des produits (l'identifiant quand le nom n'a pas pu etre lu). */
  produits: string[]
  produitIds: string[]
  /** « 5,99 € par mois », « 79 € par an, remise en cours », null si illisible. */
  tarif: string | null
  /** Prochaine echeance : fin de la periode en cours, ou de l'essai (YYYY-MM-DD). */
  echeance: string | null
  /** Arret deja programme (cancel_at, ou fin de periode si cancel_at_period_end), YYYY-MM-DD. */
  arretLe: string | null
  /** Pause posee et pas finie : reprise le (YYYY-MM-DD), 'sans-date' sinon ; null = pas de pause. */
  pauseJusquau: string | null
  /** Fin reelle d'un abonnement termine (ended_at), YYYY-MM-DD. */
  termineLe: string | null
}

function isoJour(sec: unknown): string | null {
  return typeof sec === 'number' && sec > 0 ? new Date(sec * 1000).toISOString().slice(0, 10) : null
}

type ItemBrut = {
  quantity?: number | null
  current_period_end?: number
  discounts?: unknown
  price?: {
    product?: unknown
    unit_amount?: number | null
    currency?: string | null
    recurring?: { interval?: unknown; interval_count?: unknown } | null
  } | null
}

function itemsDe(sub: Record<string, unknown>): ItemBrut[] {
  const data = (sub.items as { data?: unknown } | undefined)?.data
  return Array.isArray(data) ? data as ItemBrut[] : []
}

/** Les identifiants des produits d'un abonnement brut (price.product, chaine ou objet), sans doublon. */
export function produitsDeAbonnement(sub: Record<string, unknown>): string[] {
  const ids: string[] = []
  for (const i of itemsDe(sub)) {
    const p = i.price?.product
    const id = typeof p === 'string' ? p : (p && typeof p === 'object' ? String((p as { id?: unknown }).id ?? '') : '')
    if (/^prod_[A-Za-z0-9]{6,}$/.test(id) && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** 599 + 'eur' -> '5,99 €' (formaterMontant de liveclub/pur.ts). */
function montantFr(centimes: number, devise: string): string {
  const entier = Number.isInteger(centimes / 100)
  const nombre = entier ? String(centimes / 100) : (centimes / 100).toFixed(2).replace('.', ',')
  const d = devise.toLowerCase()
  return d === 'eur' ? `${nombre} €` : `${nombre} ${d.toUpperCase()}`
}

const INTERVALLES_FR: Record<string, [string, string]> = {
  day: ['jour', 'jours'], week: ['semaine', 'semaines'], month: ['mois', 'mois'], year: ['an', 'ans'],
}

/** Le montant d'une periode (somme des items, avant remise) et son rythme, ou null si illisible. */
function tarifDe(sub: Record<string, unknown>): string | null {
  const items = itemsDe(sub)
  if (!items.length) return null
  let centimes = 0
  let devise: string | null = null
  for (const i of items) {
    const unitaire = i.price?.unit_amount
    const cur = String(i.price?.currency ?? '').toLowerCase()
    if (typeof unitaire !== 'number' || !cur) return null
    if (devise && devise !== cur) return null
    devise = cur
    centimes += unitaire * (typeof i.quantity === 'number' && i.quantity >= 0 ? i.quantity : 1)
  }
  if (!devise) return null
  const r = items[0].price?.recurring
  const noms = INTERVALLES_FR[String(r?.interval ?? '')]
  const n = typeof r?.interval_count === 'number' && Number.isInteger(r.interval_count) && r.interval_count > 0 ? r.interval_count : 1
  const rythme = !noms ? '' : n === 1 ? ` par ${noms[0]}` : ` ${noms[1] === 'semaines' ? 'toutes les' : 'tous les'} ${n} ${noms[1]}`
  const posee = (v: unknown) => (Array.isArray(v) && v.length > 0) || Boolean(v && typeof v === 'object' && !Array.isArray(v))
  const remise = posee(sub.discounts) || posee(sub.discount) || items.some(i => posee(i.discounts))
  return `${montantFr(centimes, devise)}${rythme}${remise ? ', remise en cours' : ''}`
}

/**
 * Un abonnement Stripe brut, lu pour la carte. `nomsProduits` : prod_... -> nom
 * (lus a part chez Stripe). `sub.customer` peut etre l'objet client (expand,
 * ou pose par l'appelant) ou son identifiant. null si l'objet est illisible.
 */
export function lireAbonnementStripe(
  sub: Record<string, unknown>,
  nomsProduits: Record<string, string>,
  maintenantMs: number,
): AbonnementLu | null {
  const id = String(sub.id ?? '')
  if (!ID_ABONNEMENT.test(id)) return null
  const statut = String(sub.status ?? '')
  const c = sub.customer
  const client = c && typeof c === 'object' ? c as { id?: unknown; name?: unknown; email?: unknown } : null
  const clientId = typeof c === 'string' ? c : client && typeof client.id === 'string' ? client.id : null
  const produitIds = produitsDeAbonnement(sub)

  const finPeriode = itemsDe(sub)[0]?.current_period_end ?? (sub as { current_period_end?: number }).current_period_end
  const echeance = statut === 'trialing' && typeof sub.trial_end === 'number' ? isoJour(sub.trial_end) : isoJour(finPeriode)
  const arretLe = typeof sub.cancel_at === 'number'
    ? isoJour(sub.cancel_at)
    : sub.cancel_at_period_end === true ? echeance : null

  const pause = sub.pause_collection as { resumes_at?: number | null } | null | undefined
  const pauseEnCours = Boolean(pause) && (pause?.resumes_at == null || pause.resumes_at * 1000 > maintenantMs)

  return {
    id,
    statut,
    clientId,
    nom: client ? texteBorne(client.name, 80) : null,
    email: client ? normaliserEmailAnnulation(client.email) : null,
    produits: produitIds.map(p => texteBorne(nomsProduits[p], 120) ?? p),
    produitIds,
    tarif: tarifDe(sub),
    echeance,
    arretLe,
    pauseJusquau: pauseEnCours ? (isoJour(pause?.resumes_at) ?? 'sans-date') : null,
    termineLe: isoJour(sub.ended_at),
  }
}

export function abonnementTermine(statut: string): boolean {
  return STATUTS_TERMINES.includes(statut)
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** '2026-11-12' -> '12 novembre 2026' (formaterDateFr de liveclub/pur.ts). */
export function dateFrAnnulation(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const jour = Number(m[3])
  return `${jour === 1 ? '1er' : jour} ${MOIS_FR[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

function ligneAbonnement(a: AbonnementLu): string {
  const echeance = a.arretLe
    ? `arrêt déjà programmé le ${dateFrAnnulation(a.arretLe)}`
    : a.echeance ? `prochaine échéance le ${dateFrAnnulation(a.echeance)}` : 'échéance inconnue'
  return `${a.id} : ${a.produits.join(' + ') || 'produit inconnu'}${a.tarif ? `, ${a.tarif}` : ''}, statut ${a.statut || '?'}, ${echeance}`
}

const COMPTES_DES_PRODUITS = 'Live Club = compte melanie ; Carnet Premium, Pilotage Premium et Premium Duo = compte aoknowledge'

/**
 * L'abonnement a annuler parmi ceux lus chez Stripe, ou la raison de ne
 * proposer aucune carte (rendue au modele, qui la dit ou pose la question) :
 * aucun abonnement en cours, PLUSIEURS (il demande lequel), deja termine,
 * ou un abonnement qui n'est pas celui de l'email donne.
 */
export function choisirAbonnement(
  lus: readonly AbonnementLu[],
  o: { abonnementId: string | null; email: string | null; compte: string },
): { abonnement: AbonnementLu } | { erreur: string } {
  if (o.abonnementId) {
    const a = lus.find(x => x.id === o.abonnementId)
    if (!a) {
      return { erreur: `Abonnement ${o.abonnementId} introuvable sur le compte ${o.compte} (${COMPTES_DES_PRODUITS}). Aucune carte.` }
    }
    if (o.email && a.email && a.email !== o.email) {
      return { erreur: `L'abonnement ${a.id} appartient à ${a.email}, pas à ${o.email} : vérifie de qui il s'agit avant de reproposer. Aucune carte.` }
    }
    if (abonnementTermine(a.statut)) {
      return { erreur: `L'abonnement ${a.id} est déjà terminé (statut ${a.statut}${a.termineLe ? `, fini le ${dateFrAnnulation(a.termineLe)}` : ''}) : rien à annuler.` }
    }
    return { abonnement: a }
  }
  const email = o.email ?? '?'
  const enCours = lus.filter(a => !abonnementTermine(a.statut))
  if (enCours.length === 0) {
    const termines = lus.length
    return {
      erreur: `Aucun abonnement en cours pour ${email} sur le compte ${o.compte}`
        + (termines ? ` (${termines} abonnement${termines > 1 ? 's' : ''} déjà terminé${termines > 1 ? 's' : ''})` : '')
        + `. Vérifie l'adresse (le membre a pu payer avec une autre) ou l'autre compte (${COMPTES_DES_PRODUITS}). Aucune carte.`,
    }
  }
  if (enCours.length > 1) {
    return {
      erreur: `${enCours.length} abonnements en cours pour ${email} sur le compte ${o.compte} :\n`
        + enCours.slice(0, 8).map(a => `- ${ligneAbonnement(a)}`).join('\n')
        + '\nDemande lequel annuler (ou s\'il faut annuler les deux, une carte à la fois), puis repropose avec son abonnement_id.',
    }
  }
  return { abonnement: enCours[0] }
}

/** Ce qui interdit la carte pour ce `quand`, ou null. */
export function refusAnnulation(a: AbonnementLu, quand: QuandAnnulation, qui: string): string | null {
  if (abonnementTermine(a.statut)) return `L'abonnement ${a.id} est déjà terminé (statut ${a.statut}) : rien à annuler.`
  if (quand === 'fin-de-periode' && a.arretLe) {
    return `Un arrêt est déjà programmé sur l'abonnement de ${qui} (${a.id}, fin le ${dateFrAnnulation(a.arretLe)}) : rien à faire. `
      + 'Pour l\'arrêter tout de suite, repropose avec quand immediatement.'
  }
  if (quand === 'fin-de-periode' && (a.statut === 'incomplete' || a.statut === 'paused')) {
    return `L'abonnement de ${qui} (${a.id}) est « ${a.statut} » : il n'a pas de période payée qui court. `
      + 'Seul l\'arrêt immédiat a un sens : repropose avec quand immediatement si c\'est voulu.'
  }
  return null
}

/** Un avertissement a ajouter sous la carte, ou null. */
export function avertissementAnnulation(a: AbonnementLu, quand: QuandAnnulation): string | null {
  if (quand === 'fin-de-periode' && (a.statut === 'past_due' || a.statut === 'unpaid')) {
    return `ATTENTION : paiement en retard (${a.statut}). Jusqu'à la fin de la période, Stripe peut encore relancer la facture ouverte : `
      + 'pour tout arrêter tout de suite, il faut l\'arrêt immédiat.'
  }
  return null
}

/** Les parametres de la carte : ceux du modele, plus ce que le serveur a lu chez Stripe. */
export function paramsDepuisAbonnement(p: ParamsAnnulation, a: AbonnementLu): ParamsAnnulation {
  return {
    ...p,
    abonnement_id: a.id,
    email: a.email ?? p.email,
    qui: a.nom ?? p.qui ?? a.email ?? p.email,
    produit: a.produits.join(' + ') || null,
    tarif: a.tarif,
    echeance: a.echeance,
    statut: a.statut || null,
    arret_le: a.arretLe,
    pause_jusquau: a.pauseJusquau,
  }
}

/**
 * LA CARTE, en clair : le membre, le produit, le montant et le rythme, la
 * prochaine echeance, et ce qui se passe (« s'arrête le <date>, rien n'est
 * remboursé » ou « s'arrête maintenant »).
 */
export function carteAnnulation(p: ParamsAnnulation, compte: string): string {
  const qui = p.qui ?? p.email ?? 'ce membre'
  const email = p.email && p.email !== qui ? ` (${p.email})` : ''
  const essai = p.statut === 'trialing'
  const quoi = `${p.produit ?? 'produit à relire chez Stripe'}${p.tarif ? `, ${p.tarif}` : ''}`
  const etat = essai ? ", en période d'essai" : p.statut && p.statut !== 'active' ? `, statut ${p.statut}` : ''
  const echeance = p.arret_le
    ? `arrêt déjà programmé le ${dateFrAnnulation(p.arret_le)}`
    : p.echeance
      ? `${essai ? "fin de l'essai" : 'prochaine échéance'} le ${dateFrAnnulation(p.echeance)}`
      : 'prochaine échéance inconnue'
  const fin = p.echeance ? dateFrAnnulation(p.echeance) : null

  let effet: string
  if (p.quand === 'immediatement') {
    effet = "Il s'arrête maintenant : l'accès se ferme tout de suite et plus rien n'est prélevé. "
      + 'Rien n\'est remboursé : un remboursement est une carte à part.'
  } else if (essai) {
    effet = `Il s'arrête à la fin de l'essai${fin ? `, le ${fin}` : ''}, sans aucun prélèvement.`
  } else {
    effet = `Il s'arrête ${fin ? `le ${fin}` : 'à la fin de la période payée'}, rien n'est remboursé : `
      + 'le membre garde son accès jusque-là, puis plus aucun prélèvement.'
  }
  const pause = p.pause_jusquau
    ? ` Il est en pause (prélèvements suspendus${p.pause_jusquau === 'sans-date' ? ', sans date de reprise' : ` jusqu'au ${dateFrAnnulation(p.pause_jusquau)}`}).`
    : ''
  return `${p.quand === 'immediatement' ? 'Arrêter MAINTENANT' : 'Arrêter à la fin de la période'} l'abonnement de ${qui}${email}, `
    + `compte ${compte} : ${quoi}${etat}, ${echeance}. ${effet}${pause}`
    + (p.motif ? ` Motif : ${p.motif}.` : '')
    + (p.abonnement_id ? ` (${p.abonnement_id})` : '')
}

// ---------------------------------------------------------------------------
// L'appel Stripe, a la confirmation.
// ---------------------------------------------------------------------------

export type RequeteAnnulation = { methode: 'DELETE' | 'POST'; chemin: string; corps: Record<string, string> }

/**
 * L'appel exact. Immediatement : DELETE, sans facture finale (invoice_now) ni
 * prorata (prorate), donc ni prelevement ni avoir. Fin de periode : POST
 * cancel_at_period_end=true. Le motif part dans cancellation_details[comment],
 * visible au Dashboard Stripe.
 */
export function requeteAnnulation(abonnementId: string, quand: QuandAnnulation, motif: string | null): RequeteAnnulation {
  if (!ID_ABONNEMENT.test(abonnementId)) throw new Error('abonnement invalide (sub_...).')
  const chemin = `/v1/subscriptions/${abonnementId}`
  const commentaire = `Agent AOK (cockpit)${motif ? ` : ${motif.slice(0, MOTIF_MAX)}` : ''}`
  if (quand === 'immediatement') {
    return {
      methode: 'DELETE', chemin,
      corps: { invoice_now: 'false', prorate: 'false', 'cancellation_details[comment]': commentaire },
    }
  }
  return {
    methode: 'POST', chemin,
    corps: { cancel_at_period_end: 'true', 'cancellation_details[comment]': commentaire },
  }
}

/** Le resultat rendu a l'humain apres une annulation reussie. */
export function phraseAnnulationFaite(o: {
  qui: string; produit: string | null; quand: QuandAnnulation; finLe: string | null; liveClub: boolean
}): string {
  const quoi = `${o.qui}${o.produit ? ` (${o.produit})` : ''}`
  const suite = o.liveClub
    ? 'Telegram : rien à faire, le passage quotidien s\'occupe de la sortie du groupe et prévient le membre.'
    : 'Rien à faire à la main : le droit à l\'app suit l\'abonnement tout seul.'
  if (o.quand === 'immediatement') {
    return `Abonnement de ${quoi} arrêté maintenant. Rien n'a été remboursé : pour un remboursement, demande-le-moi, c'est une carte à part.\n${suite}`
  }
  return `Abonnement de ${quoi} : arrêt programmé ${o.finLe ? `le ${dateFrAnnulation(o.finLe)}` : 'à la fin de la période payée'}. `
    + `Rien n'est remboursé, le membre garde son accès jusque-là, puis plus aucun prélèvement.\n${suite}`
}

/**
 * Un echec Stripe a la confirmation, en clair. `permission` : Stripe refuse
 * la cle restreinte (estRefusDePermission de liveclub/pur.ts) ; c'est un
 * reglage du Dashboard, pas une panne. `incertain` : pas de reponse de Stripe
 * (reseau) : on ne sait pas si l'appel est passe. `message` : deja masque
 * (masquerCleStripe).
 */
export function phraseEchecAnnulation(o: {
  message: string; permission: boolean; incertain: boolean; compte: string; variable: string; quand: QuandAnnulation
}): string {
  if (o.permission) {
    const cite = /rak_[a-z_]+/i.exec(o.message)?.[0]
    return `Rien n'a été annulé : la clé de l'agent du compte ${o.compte} (${o.variable}) n'a pas la permission « Subscriptions » en écriture. `
      + `C'est un réglage à faire par Brice${o.compte === 'melanie' ? ' (ou Adil, sur le Stripe de Mélanie)' : ''} : `
      + 'Stripe, Développeurs, Clés API, la clé de l\'agent, Modifier, Subscriptions : Écriture'
      + (cite ? ` (Stripe la nomme ${cite})` : '')
      + ', puis redemande-moi l\'annulation.'
  }
  if (o.incertain) {
    return `Stripe n'a pas répondu (${o.message}) : on ne sait pas si l'annulation est passée. `
      + 'Regarde l\'abonnement au Dashboard Stripe avant de la redemander.'
  }
  return `Stripe a refusé ${o.quand === 'immediatement' ? "l'arrêt immédiat" : "l'arrêt en fin de période"} (${o.message}) : rien n'a changé.`
}

/**
 * La lecture AVANT la carte refusee faute de permission : quoi ajouter a la
 * cle (lire l'abonnement, et chercher le client quand on part de l'email).
 */
export function phraseLectureRefusee(o: { compte: string; variable: string; message: string; parEmail: boolean }): string {
  return `Stripe refuse de lire l'abonnement avec la clé du compte ${o.compte} (${o.variable}) : ${o.message}. Aucune carte. `
    + `Dis-le tel quel : il manque à cette clé la permission « Subscriptions »${o.parEmail ? ' et « Customers » (pour chercher par email)' : ''}, `
    + 'réglage à faire par Brice au Dashboard Stripe (Subscriptions en écriture couvre aussi la lecture et l\'annulation).'
}
