// Les TARIFS RESERVES du Live Club (Brice, 13/10) : « ouvre un abonnement a ce
// prix pour cette personne ». Table cockpit_liveclub_tarifs_reserves
// (migration 20261013160000), ecrite par ce module seulement.
//
// Un tarif reserve est PERSONNEL : un prix ouvert a UNE personne (son email),
// jamais repris pour quelqu'un d'autre. Le nom d'un produit (« Live Club
// ETM ») ne dit rien du prix d'un autre eleve.
//
// - L'agent du cockpit pose la reservation (proposer_abonnement_reserve, une
//   carte) : le tarif a son nom sur le produit commun « Live Club (tarif
//   reserve) » (ou un tarif existant qui lui est destine), son Payment Link
//   personnel (un seul paiement, email prerempli, retour par la page de
//   bienvenue), puis la ligne. Retrait : proposer_retirer_tarif_reserve, ou
//   le bouton du cockpit (/api/cockpit/liveclub/reserves).
// - Le bot des membres donne SON lien a la personne, reconnue par son compte
//   Telegram (pose par l'equipe) ou par son email VERIFIE (code, rattachement).
//   Avant tout lien, il verifie que le tarif n'est pas deja paye ; un lien qui
//   ne marche plus est recree.
// - Apres paiement : la page de bienvenue (session Checkout), le passage
//   quotidien et le bot posent paye_le et abonnement_id. Le tarif etant
//   personnel, le rapprochement se fait D'ABORD par price_id, l'email en
//   second (cas reel du 13/10 : Yassine a paye son tarif avec une autre
//   adresse). Un abonnement vivant sur le tarif = reservation payee.
//   L'acces vient de l'abonnement, comme pour tout abonne : aucun droit avant.
//
// Les regles sont PURES (pur.ts, testees par scripts/verifier-liveclub.mjs) ;
// ici, la base et Stripe. Jamais d'email ni de lien dans un log.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  stripeGet, stripePost, cleAgent, nomVariableCle, RefusAction,
  type ActionAgent, type ControleCarteStripe,
} from '@/lib/stripe-actions'
import { PRODUITS_LIVECLUB, URL_BIENVENUE_LIVECLUB, cleStripeLecture, estProduitLiveClub, nomBot } from './config'
import {
  inscrireProduitLiveClub, inscrireProduitTarifsReserves, lireProduitsLiveClub, produitTarifsReservesInscrit,
} from './produits'
import { abonnementsLiveClubParEmail } from './stripe'
import {
  abonnementDeLaReserve, abonnementOuvreLeGroupe, corpsLienPaiement, corpsTarifReserve, dateIso, decisionLienReserve,
  ecartTarifDemande, estRefusDePermission, formaterDateFr, libelleTarif, libelleTarifReserve, lireAbonnementPourReserve,
  lireLienStripe, lireParamsAbonnementReserve, lireParamsRetraitReserve, lireTarifStripe, masquerCleStripe, messageErreur,
  normaliserEmail, permissionLienPaiementManquante, phraseAbonnementReserveCree, refusTarifDejaPaye, refusTarifRepris,
  relationAbsente,
  reservePourCompte, urlLienAvecEmail,
  META_RESERVE_POUR, META_ROLE_PRODUIT, NOM_PRODUIT_TARIFS_RESERVES, ROLE_PRODUIT_TARIFS_RESERVES,
  type AbonnementPourReserve, type LienStripeLu, type ParamsAbonnementReserve, type ReserveLue, type TarifLu,
} from './pur'

export type { ReserveLue }

/** Une ligne de la table, telle que ce module la lit. */
type LigneReserve = ReserveLue & {
  tarif_cree: boolean
  cree_par: string
  cree_le: Date
  abonnement_id: string | null
  note: string | null
}

const COLONNES = Prisma.raw(`reserve_id::text as reserve_id, qui, email, telegram_id, produit_id, price_id, tarif_cree,
  montant::float8 as montant, devise, recurrence, lien_id, lien_url, cree_par, cree_le, paye_le, abonnement_id,
  retire_le, note`)

const MIGRATION = '20261013160000_cockpit_liveclub_tarifs_reserves.sql'
const TABLE_ABSENTE = `La table cockpit_liveclub_tarifs_reserves n'existe pas encore (migration ${MIGRATION} à appliquer).`

function doublon(err: unknown): boolean {
  return /23505|duplicate key|unique constraint/i.test(err instanceof Error ? err.message : String(err))
}

/** La cle qui ECRIT le compte melanie (tarifs, liens) : celle de l'agent. */
function cleEcriture(): string | null {
  return cleAgent('melanie')
}

/** La cle qui LIT le compte melanie : celle de l'agent (l'ecriture lit aussi), sinon la cle de lecture. */
function cleLecture(): string | null {
  return cleAgent('melanie') ?? cleStripeLecture()
}

// ---------------------------------------------------------------------------
// Lectures en base
// ---------------------------------------------------------------------------

/** Les reservations ACTIVES (retire_le null) d'un email ou d'un compte Telegram. Jette (table absente comprise). */
async function lireActives(o: { email: string | null; telegramId: number | null }): Promise<LigneReserve[]> {
  return prisma.$queryRaw<LigneReserve[]>`
    select ${COLONNES} from public.cockpit_liveclub_tarifs_reserves
    where retire_le is null
      and ((${o.email}::text is not null and email = ${o.email}::text)
        or (${o.telegramId}::bigint is not null and telegram_id = ${o.telegramId}::bigint))
    order by cree_le desc
    limit 5`
}

async function relire(reserveId: string): Promise<LigneReserve | null> {
  const lignes = await prisma.$queryRaw<LigneReserve[]>`
    select ${COLONNES} from public.cockpit_liveclub_tarifs_reserves
    where reserve_id = ${reserveId}::uuid limit 1`
  return lignes[0] ?? null
}

/**
 * La reservation OUVERTE (active, pas encore payee) a donner a ce compte
 * Telegram, ou null : a son compte Telegram, ou a son email verifie (jamais un
 * email tape et non verifie, voir reservePourCompte). Table absente ou panne
 * = null : le bot garde son parcours habituel. Ne jette pas.
 */
export async function reserveOuvertePourCompte(telegramId: number, emailVerifie: string | null): Promise<ReserveLue | null> {
  const email = emailVerifie ? normaliserEmail(emailVerifie) : null
  try {
    const lignes = await prisma.$queryRaw<LigneReserve[]>`
      select ${COLONNES} from public.cockpit_liveclub_tarifs_reserves
      where retire_le is null and paye_le is null
        and (telegram_id = ${telegramId}::bigint or (${email}::text is not null and email = ${email}::text))
      order by cree_le desc
      limit 5`
    return reservePourCompte(lignes, { telegramId, emailVerifie: email })
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[liveclub/reserves] reservations illisibles pour u${telegramId} : ${messageErreur(err)}`)
    return null
  }
}

/**
 * Une reservation active porte-t-elle cette adresse ? Pour l'envoi du code de
 * verification (adresseConnue, verification.ts) : une adresse de reservation
 * est connue. Table absente = false. Jette sur une panne (l'appelant compte
 * une source illisible).
 */
export async function adresseReservee(email: string): Promise<boolean> {
  const propre = normaliserEmail(email)
  if (!propre) return false
  try {
    const lignes = await prisma.$queryRaw<{ n: number }[]>`
      select 1 as n from public.cockpit_liveclub_tarifs_reserves
      where retire_le is null and email = ${propre} limit 1`
    return lignes.length > 0
  } catch (err) {
    if (relationAbsente(err)) return false
    throw err
  }
}

/**
 * Note le compte Telegram sur la reservation, s'il n'y en a pas encore (la
 * personne vient de verifier son email par code) : le bot la reconnaitra
 * ensuite des Demarrer. Un compte deja sur une autre reservation active :
 * rien (index unique). Ne jette pas.
 */
export async function poserTelegramSurReserve(reserveId: string, telegramId: number): Promise<void> {
  try {
    await prisma.$executeRaw`
      update public.cockpit_liveclub_tarifs_reserves set telegram_id = ${telegramId}::bigint
      where reserve_id = ${reserveId}::uuid and telegram_id is null and retire_le is null`
  } catch (err) {
    if (!doublon(err)) console.warn(`[liveclub/reserves] compte Telegram non note sur la reservation : ${messageErreur(err)}`)
  }
}

/** Marque une reservation payee. false = deja payee, retiree, ou disparue. Jette sur une panne. */
async function marquerPayee(reserveId: string, abonnementId: string): Promise<boolean> {
  const n = await prisma.$executeRaw`
    update public.cockpit_liveclub_tarifs_reserves
    set paye_le = now(), abonnement_id = ${abonnementId}
    where reserve_id = ${reserveId}::uuid and paye_le is null and retire_le is null`
  return n > 0
}

// ---------------------------------------------------------------------------
// Stripe : liens, abonnements d'un tarif, produit commun
// ---------------------------------------------------------------------------

async function lireLien(cle: string, lienId: string): Promise<LienStripeLu> {
  try {
    return lireLienStripe(await stripeGet(cle, `/v1/payment_links/${lienId}`))
  } catch (err) {
    return /No such payment_?link/i.test(messageErreur(err)) ? { etat: 'introuvable' } : { etat: 'illisible' }
  }
}

/** Les abonnements d'un tarif (tous statuts), avec l'email du client. Jette sur une panne. */
async function abonnementsDuTarif(cle: string, priceId: string): Promise<AbonnementPourReserve[]> {
  const tous: AbonnementPourReserve[] = []
  let apres: string | null = null
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ price: priceId, status: 'all', limit: '100' })
    q.append('expand[]', 'data.customer')
    if (apres) q.set('starting_after', apres)
    const liste = await stripeGet(cle, `/v1/subscriptions?${q}`)
    const data = (liste.data as unknown[] | undefined) ?? []
    for (const s of data) {
      const a = lireAbonnementPourReserve(s)
      if (a) tous.push(a)
    }
    if (liste.has_more !== true || data.length === 0) return tous
    apres = String((data[data.length - 1] as { id?: unknown }).id ?? '')
  }
  throw new Error('Plus de 500 abonnements sur ce tarif : lecture incomplete.')
}

/**
 * Le Payment Link PERSONNEL d'une reservation : un seul paiement, retour par
 * la page de bienvenue, email en metadonnee. L'URL rendue porte l'email
 * prerempli. Jette avec un message pret a lire (permission comprise).
 */
async function creerLienReserve(cle: string, o: { priceId: string; qui: string; email: string; reserveId: string | null }): Promise<{ id: string; url: string }> {
  let lien: Record<string, unknown>
  try {
    lien = await stripePost(cle, '/v1/payment_links', {
      ...corpsLienPaiement({ priceId: o.priceId, liveClub: true, urlBienvenue: URL_BIENVENUE_LIVECLUB, qui: o.qui }),
      [`metadata[${META_RESERVE_POUR}]`]: o.email,
      ...(o.reserveId ? { 'metadata[reserve_id]': o.reserveId } : {}),
    })
  } catch (err) {
    const message = masquerCleStripe(messageErreur(err))
    if (estRefusDePermission(message)) throw new Error(permissionLienPaiementManquante('melanie', nomVariableCle('melanie'), message))
    throw new Error(`Stripe a refusé le lien de paiement (${message}).`)
  }
  const id = String(lien.id ?? '')
  const url = String(lien.url ?? '')
  if (!/^plink_[A-Za-z0-9]+$/.test(id) || !/^https:\/\/\S+$/.test(url)) {
    throw new Error("Stripe n'a pas rendu le lien de paiement : vérifie au Dashboard (Liens de paiement).")
  }
  return { id, url: urlLienAvecEmail(url, o.email) }
}

/** Desactive un Payment Link. false = Stripe a refuse (ou panne). Ne jette pas. */
async function desactiverLien(cle: string, lienId: string): Promise<boolean> {
  try {
    await stripePost(cle, `/v1/payment_links/${lienId}`, { active: 'false' })
    return true
  } catch (err) {
    console.warn(`[liveclub/reserves] lien non desactive : ${masquerCleStripe(messageErreur(err))}`)
    return false
  }
}

/**
 * Le produit commun des tarifs reserves : sa ligne en base (role
 * tarif_reserve), sinon le produit deja cree chez Stripe (metadonnee
 * aok_role, ligne perdue), sinon un produit neuf. Inscrit comme produit Live
 * Club avec son role. Jette (RefusAction pour un produit archive).
 */
async function produitCommun(cle: string, acteur: string): Promise<string> {
  const inscrit = await produitTarifsReservesInscrit()
  if (inscrit) {
    let produit: Record<string, unknown>
    try {
      produit = await stripeGet(cle, `/v1/products/${inscrit}`)
    } catch (err) {
      if (/No such product/i.test(messageErreur(err))) {
        throw new Error(`Le produit commun ${inscrit} est introuvable chez Stripe (compte melanie) : préviens Brice. Rien n'a été créé.`)
      }
      throw err
    }
    if (produit.active !== true) {
      throw new RefusAction(`Le produit commun « ${NOM_PRODUIT_TARIFS_RESERVES} » (${inscrit}) est archivé chez Stripe : réactive-le au Dashboard, puis redemande. Rien n'a été créé.`)
    }
    return inscrit
  }

  let id: string | null = null
  try {
    const q = new URLSearchParams({
      query: `metadata['${META_ROLE_PRODUIT}']:'${ROLE_PRODUIT_TARIFS_RESERVES}' AND active:'true'`, limit: '1',
    })
    const trouves = await stripeGet(cle, `/v1/products/search?${q}`)
    const premier = ((trouves.data as { id?: unknown }[] | undefined) ?? [])[0]
    id = typeof premier?.id === 'string' ? premier.id : null
  } catch (err) {
    console.warn(`[liveclub/reserves] recherche du produit commun impossible : ${masquerCleStripe(messageErreur(err))}`)
  }
  if (!id) {
    const cree = await stripePost(cle, '/v1/products', {
      name: NOM_PRODUIT_TARIFS_RESERVES,
      [`metadata[${META_ROLE_PRODUIT}]`]: ROLE_PRODUIT_TARIFS_RESERVES,
      'metadata[cree_par]': 'agent_cockpit',
    })
    id = String(cree.id ?? '')
    if (!/^prod_[A-Za-z0-9]{6,}$/.test(id)) throw new Error("Stripe n'a pas rendu l'identifiant du produit commun : rien d'autre n'a été créé.")
  }
  const ins = await inscrireProduitTarifsReserves({ produitId: id, nom: NOM_PRODUIT_TARIFS_RESERVES, posePar: acteur })
  if (!ins.ok) throw new Error(`Le produit commun ${id} existe chez Stripe, mais ${ins.message} Rien d'autre n'a été créé.`)
  return id
}

type TarifRepris = {
  tarif: TarifLu
  produitId: string
  produitNom: string
  produitActif: boolean
  reservePour: string | null
  produitDeBase: boolean
  produitLiveClub: boolean
  listeComplete: boolean
}

/** Un tarif EXISTANT lu chez Stripe (produit compris), ou la raison du refus. Jette sur une panne. */
async function lireTarifRepris(cle: string, priceId: string): Promise<TarifRepris | string> {
  let prix: Record<string, unknown>
  try {
    prix = await stripeGet(cle, `/v1/prices/${priceId}?expand[]=product`)
  } catch (err) {
    if (/No such price/i.test(messageErreur(err))) return `Tarif ${priceId} introuvable sur le compte melanie.`
    throw err
  }
  const tarif = lireTarifStripe(prix)
  if (!tarif) return `Tarif ${priceId} illisible chez Stripe.`
  const produit = prix.product && typeof prix.product === 'object' ? prix.product as Record<string, unknown> : null
  const meta = (prix.metadata as Record<string, unknown> | null | undefined)?.[META_RESERVE_POUR]
  const liste = await lireProduitsLiveClub()
  return {
    tarif,
    produitId: tarif.produit,
    produitNom: String(produit?.name ?? tarif.produit).slice(0, 120),
    produitActif: produit ? produit.active === true : true,
    reservePour: typeof meta === 'string' && meta.trim() ? meta.trim() : null,
    produitDeBase: (PRODUITS_LIVECLUB as readonly string[]).includes(tarif.produit),
    produitLiveClub: estProduitLiveClub(tarif.produit, liste.produits),
    listeComplete: liste.complete,
  }
}

/** Les emails des reservations (retirees comprises) posees sur ce tarif. Jette. */
async function reservesDuTarif(priceId: string): Promise<{ email: string }[]> {
  return prisma.$queryRaw<{ email: string }[]>`
    select email from public.cockpit_liveclub_tarifs_reserves where price_id = ${priceId}`
}

// ---------------------------------------------------------------------------
// Le lien a donner par le bot
// ---------------------------------------------------------------------------

export type IssueLienReserve =
  | { etat: 'lien'; url: string; tarif: string }
  /** Un abonnement paie deja la reservation : elle vient d'etre marquee payee, aucun lien. */
  | { etat: 'payee' }
  | { etat: 'panne' }

/**
 * Le lien de paiement de cette reservation, pour le bot. D'abord : le tarif
 * est-il deja paye (abonnement vivant sur ce tarif, quelle que soit
 * l'adresse, ou termine au meme email) ? Alors la reservation est marquee
 * payee et aucun lien ne part : jamais un second paiement. Ensuite, le lien
 * enregistre s'il marche encore (decisionLienReserve), sinon un nouveau lien,
 * enregistre sans ecraser celui qu'un message simultane aurait pose. Stripe
 * illisible : le lien enregistre (limite a un seul paiement) s'il y en a un,
 * jamais un nouveau. Ne jette pas.
 */
export async function lienDeLaReserve(r: ReserveLue): Promise<IssueLienReserve> {
  const tarif = libelleTarifReserve(r)
  try {
    const lecture = cleLecture()
    if (!lecture) {
      console.warn('[liveclub/reserves] aucune cle Stripe du compte melanie : lien de reservation non verifie')
      return r.lien_url ? { etat: 'lien', url: r.lien_url, tarif } : { etat: 'panne' }
    }
    let abonnements: AbonnementPourReserve[] | null = null
    try {
      abonnements = await abonnementsDuTarif(lecture, r.price_id)
    } catch (err) {
      console.warn(`[liveclub/reserves] abonnements du tarif illisibles : ${masquerCleStripe(messageErreur(err))}`)
    }
    const abo = abonnements ? abonnementDeLaReserve(r, abonnements) : null
    if (abo) {
      await marquerPayee(r.reserve_id, abo.id)
      return { etat: 'payee' }
    }

    const lu = r.lien_id && r.lien_url ? await lireLien(lecture, r.lien_id) : null
    if (decisionLienReserve(r, lu) === 'reutiliser' && r.lien_url) return { etat: 'lien', url: r.lien_url, tarif }
    // Un nouveau lien seulement si l'on sait que rien n'est paye.
    if (!abonnements) return { etat: 'panne' }

    const cle = cleEcriture()
    if (!cle) {
      console.warn(`[liveclub/reserves] ${nomVariableCle('melanie')} absente : lien de reservation non recree`)
      return { etat: 'panne' }
    }
    const neuf = await creerLienReserve(cle, { priceId: r.price_id, qui: r.qui, email: r.email, reserveId: r.reserve_id })
    const n = await prisma.$executeRaw`
      update public.cockpit_liveclub_tarifs_reserves
      set lien_id = ${neuf.id}, lien_url = ${neuf.url}, lien_cree_le = now()
      where reserve_id = ${r.reserve_id}::uuid and retire_le is null and paye_le is null
        and lien_id is not distinct from ${r.lien_id}::text`
    if (n > 0) return { etat: 'lien', url: neuf.url, tarif }
    // Un autre message a pose un lien entre-temps (ou la reservation a bouge) :
    // le notre ne sert a rien.
    await desactiverLien(cle, neuf.id)
    const relu = await relire(r.reserve_id)
    if (relu && !relu.retire_le && !relu.paye_le && relu.lien_url) return { etat: 'lien', url: relu.lien_url, tarif }
    return { etat: 'panne' }
  } catch (err) {
    console.warn(`[liveclub/reserves] lien de reservation impossible : ${masquerCleStripe(messageErreur(err))}`)
    return { etat: 'panne' }
  }
}

// ---------------------------------------------------------------------------
// Apres paiement : page de bienvenue et passage quotidien
// ---------------------------------------------------------------------------

/**
 * La page de bienvenue (session Checkout payee) : les reservations ouvertes
 * dont le tarif est dans la session sont marquees payees, D'ABORD par le
 * tarif (personnel), l'email en second (abonnementDeLaReserve) : une
 * personne peut payer avec une autre adresse. Renvoie le nombre marque. Ne
 * jette pas.
 */
export async function marquerReservesPayeesParSession(s: {
  email: string | null; prix: readonly string[]; abonnementId: string; statut: string | null
}): Promise<number> {
  const prix = s.prix.filter(p => /^price_[A-Za-z0-9]+$/.test(p))
  if (prix.length === 0) return 0
  const email = normaliserEmail(s.email)
  try {
    const lignes = await prisma.$queryRaw<LigneReserve[]>`
      select ${COLONNES} from public.cockpit_liveclub_tarifs_reserves
      where retire_le is null and paye_le is null and price_id = any(${prix}::text[])`
    let n = 0
    for (const r of lignes) {
      const abo = abonnementDeLaReserve(r, [{ id: s.abonnementId, statut: s.statut ?? 'active', email, prix }])
      if (abo && await marquerPayee(r.reserve_id, abo.id)) n++
    }
    return n
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[liveclub/reserves] reservation non marquee payee : ${messageErreur(err)}`)
    return 0
  }
}

export type BilanReserves = { payees: number; en_attente: number; illisibles: number }

/**
 * Passage quotidien : chaque reservation ouverte est rapprochee des
 * abonnements de son tarif, d'abord par le tarif, l'email en second
 * (abonnementDeLaReserve). Un tarif illisible ne decide rien. Table absente
 * = rien. Jette seulement si la base ne repond pas.
 */
export async function rapprocherTarifsReserves(): Promise<BilanReserves> {
  const bilan: BilanReserves = { payees: 0, en_attente: 0, illisibles: 0 }
  let lignes: LigneReserve[]
  try {
    lignes = await prisma.$queryRaw<LigneReserve[]>`
      select ${COLONNES} from public.cockpit_liveclub_tarifs_reserves
      where retire_le is null and paye_le is null
      order by cree_le`
  } catch (err) {
    if (relationAbsente(err)) return bilan
    throw err
  }
  if (lignes.length === 0) return bilan
  const cle = cleLecture()
  if (!cle) {
    bilan.illisibles = lignes.length
    return bilan
  }
  const parTarif = new Map<string, LigneReserve[]>()
  for (const r of lignes) parTarif.set(r.price_id, [...(parTarif.get(r.price_id) ?? []), r])
  for (const [priceId, reserves] of parTarif) {
    let abonnements: AbonnementPourReserve[]
    try {
      abonnements = await abonnementsDuTarif(cle, priceId)
    } catch (err) {
      console.warn(`[liveclub/reserves] abonnements du tarif illisibles : ${masquerCleStripe(messageErreur(err))}`)
      bilan.illisibles += reserves.length
      continue
    }
    for (const r of reserves) {
      const abo = abonnementDeLaReserve(r, abonnements)
      if (abo && await marquerPayee(r.reserve_id, abo.id)) bilan.payees++
      else if (!abo) bilan.en_attente++
    }
  }
  return bilan
}

// ---------------------------------------------------------------------------
// Retrait (agent du cockpit et bouton du cockpit)
// ---------------------------------------------------------------------------

export type IssueRetraitReserve = { ok: true; message: string } | { ok: false; refus: string }

/**
 * Retire la reservation active (par son id, sinon par l'email). La ligne
 * d'abord (retire_le, retire_par), puis, si rien n'est paye : le lien est
 * desactive et un tarif cree pour elle est archive. Une reservation payee :
 * son abonnement continue, rien ne change chez Stripe. Jette si la base ne
 * repond pas.
 */
export async function retirerTarifReserve(
  o: { reserveId: string | null; email: string | null },
  acteur: string,
): Promise<IssueRetraitReserve> {
  const email = normaliserEmail(o.email)
  let lignes: LigneReserve[]
  try {
    lignes = await prisma.$queryRaw<LigneReserve[]>`
      update public.cockpit_liveclub_tarifs_reserves
      set retire_le = now(), retire_par = ${acteur.slice(0, 120)}
      where retire_le is null
        and ((${o.reserveId}::text is not null and reserve_id = ${o.reserveId}::uuid)
          or (${o.reserveId}::text is null and ${email}::text is not null and email = ${email}::text))
      returning ${COLONNES}`
  } catch (err) {
    if (relationAbsente(err)) return { ok: false, refus: TABLE_ABSENTE }
    throw err
  }
  const r = lignes[0]
  if (!r) return { ok: false, refus: `Aucune réservation active ${email ? `pour ${email}` : 'à ce numéro'} : rien n'a été retiré.` }
  const tarif = libelleTarifReserve(r)
  if (r.paye_le) {
    return {
      ok: true,
      message: `Réservation de ${r.qui} (${tarif}) retirée de la liste. Elle était payée : son abonnement continue, `
        + "rien n'a changé chez Stripe (une pause ou un arrêt restent des gestes à part).",
    }
  }
  const cle = cleEcriture()
  const fait: string[] = []
  if (r.lien_id) {
    if (cle && await desactiverLien(cle, r.lien_id)) fait.push('son lien de paiement est désactivé')
    else {
      fait.push(`ATTENTION : son lien de paiement n'a pas pu être désactivé (${cle ? 'Stripe a refusé' : `${nomVariableCle('melanie')} absente`}), `
        + 'désactive-le au Dashboard Stripe (Liens de paiement)')
    }
  }
  if (r.tarif_cree && cle) {
    try {
      await stripePost(cle, `/v1/prices/${r.price_id}`, { active: 'false' })
      fait.push('son tarif est archivé')
    } catch (err) {
      console.warn(`[liveclub/reserves] tarif non archive : ${masquerCleStripe(messageErreur(err))}`)
    }
  }
  return {
    ok: true,
    message: `Réservation de ${r.qui} (${tarif}) retirée${fait.length ? ` : ${fait.join(', ')}` : ''}. Le bot ne lui donnera plus ce lien.`,
  }
}

// ---------------------------------------------------------------------------
// L'agent du cockpit : controle avant la carte, puis execution
// ---------------------------------------------------------------------------

/**
 * La place est-elle libre ? Une seule reservation active par email, et un
 * compte Telegram sur une seule reservation active. La raison du refus, ou
 * null. Jette (table absente comprise : relationAbsente).
 */
async function refusPlace(p: { email: string; telegram_id: number | null; qui: string }): Promise<string | null> {
  const lignes = await lireActives({ email: p.email, telegramId: p.telegram_id })
  const sienne = lignes.find(l => l.email === p.email)
  if (sienne) {
    const etat = sienne.paye_le ? `payée le ${formaterDateFr(dateIso(new Date(sienne.paye_le)))}` : 'en attente de paiement'
    return `${sienne.qui} (${p.email}) a déjà une réservation active : ${libelleTarifReserve(sienne)}, ${etat}. `
      + "Une seule par personne : pour changer son prix, retire-la d'abord (proposer_retirer_tarif_reserve), puis repropose."
  }
  const autre = lignes.find(l => l.email !== p.email)
  if (autre && p.telegram_id !== null) {
    return `Le compte Telegram u${p.telegram_id} est déjà sur la réservation active de ${autre.qui} (${autre.email}) : `
      + 'vérifie le numéro, ou propose sans telegram_id.'
  }
  return null
}

/**
 * Controle AVANT la carte d'un abonnement reserve ou d'un retrait : la place,
 * le tarif repris lu chez Stripe (personnel, mensuel ou annuel, pas un prix
 * public, montant conforme). Une erreur retourne au modele ; sinon la carte
 * part avec les champs lus. Jette sur une panne Stripe (l'appelant la dit).
 */
export async function controlerActionTarifReserve(a: ActionAgent): Promise<ControleCarteStripe> {
  if (a.type === 'retirer_tarif_reserve') {
    const p = lireParamsRetraitReserve(a.params)
    if (typeof p === 'string') return { erreur: p }
    let lignes: LigneReserve[]
    try {
      lignes = await lireActives({ email: p.email, telegramId: null })
    } catch (err) {
      return { erreur: relationAbsente(err) ? TABLE_ABSENTE : `Lecture des réservations impossible (${messageErreur(err)}) : réessaie dans un instant.` }
    }
    const r = lignes.find(l => l.email === p.email)
    if (!r) return { erreur: `Aucune réservation active pour ${p.email} (cockpit_liveclub_tarifs_reserves) : rien à retirer.` }
    return {
      action: { ...a, params: { ...p, qui: r.qui, reserve_id: r.reserve_id, tarif: libelleTarifReserve(r), payee: r.paye_le !== null } },
      complement: null, manque: null,
    }
  }

  const p = lireParamsAbonnementReserve(a.params)
  if (typeof p === 'string') return { erreur: p }
  let refus: string | null
  try {
    refus = await refusPlace(p)
  } catch (err) {
    return { erreur: relationAbsente(err) ? TABLE_ABSENTE : `Lecture des réservations impossible (${messageErreur(err)}) : réessaie dans un instant.` }
  }
  if (refus) return { erreur: refus }

  const cle = cleLecture()
  // Sans aucune cle, la carte part sans bouton : ceQuiManque (agent-cockpit.ts) le dit.
  if (!cle) return { action: a, complement: null, manque: null }

  let params: ParamsAbonnementReserve
  if (p.price_id) {
    const lu = await lireTarifRepris(cle, p.price_id)
    if (typeof lu === 'string') return { erreur: lu }
    const autres = await reservesDuTarif(p.price_id).catch(() => null)
    if (autres === null) return { erreur: 'Lecture des réservations impossible : réessaie dans un instant.' }
    const r = refusTarifRepris({
      email: p.email, tarif: lu.tarif, reservePour: lu.reservePour, produitDeBase: lu.produitDeBase,
      produitActif: lu.produitActif, autresReserves: autres,
    }) ?? ecartTarifDemande(p, lu.tarif)
      // Deja paye par un abonnement vivant (quelle que soit l'adresse) : rien a reserver.
      ?? refusTarifDejaPaye(p.price_id, await abonnementsDuTarif(cle, p.price_id))
    if (r) return { erreur: r }
    if (!lu.produitLiveClub && !lu.listeComplete) {
      return { erreur: 'La liste des produits Live Club est illisible pour le moment : réessaie dans une minute.' }
    }
    params = {
      ...p, montant_centimes: lu.tarif.montant, devise: lu.tarif.devise,
      recurrence: lu.tarif.recurrence === 'year' ? 'year' : 'month',
      produit_id: lu.produitId, produit_nom: lu.produitNom, inscrire_produit: !lu.produitLiveClub,
    }
  } else {
    params = {
      ...p, montant_centimes: Math.round(Number(p.montant) * 100), devise: 'eur',
      produit_id: null, produit_nom: NOM_PRODUIT_TARIFS_RESERVES, inscrire_produit: false,
    }
  }

  // Deja abonne au Live Club : un avertissement sur la carte, pas un refus.
  let complement: string | null = null
  try {
    if ((await abonnementsLiveClubParEmail(p.email)).some(abonnementOuvreLeGroupe)) {
      complement = 'ATTENTION : cette adresse a déjà un abonnement Live Club actif. Un second abonnement la ferait payer deux fois.'
    }
  } catch {
    complement = "Je n'ai pas pu vérifier si cette adresse est déjà abonnée."
  }
  return { action: { ...a, params }, complement, manque: null }
}

/**
 * Execute une carte DEJA confirmee : abonnement reserve (tarif, lien, ligne)
 * ou retrait. Tout est relu. Jette RefusAction si une regle bloque (rien n'a
 * ete cree), Error sur une panne, avec ce qui existe deja chez Stripe.
 */
export async function executerActionTarifReserve(a: ActionAgent, acteur: string): Promise<string> {
  if (a.type === 'retirer_tarif_reserve') {
    const p = lireParamsRetraitReserve(a.params)
    if (typeof p === 'string') throw new RefusAction(p)
    const issue = await retirerTarifReserve({ reserveId: p.reserve_id, email: p.email }, acteur)
    if (!issue.ok) throw new RefusAction(issue.refus)
    return issue.message
  }

  const p = lireParamsAbonnementReserve(a.params)
  if (typeof p === 'string') throw new RefusAction(p)
  const cle = cleEcriture()
  if (!cle) {
    throw new Error(`La clé d'écriture du compte melanie n'existe pas encore (${nomVariableCle('melanie')} sur le projet journal) : rien n'a été créé.`)
  }

  // 1. La place, relue.
  let refus: string | null
  try {
    refus = await refusPlace(p)
  } catch (err) {
    if (relationAbsente(err)) throw new Error(`${TABLE_ABSENTE} Rien n'a été créé.`)
    throw err
  }
  if (refus) throw new RefusAction(`${refus} Rien n'a été créé.`)

  // 2. Le tarif : repris (relu, personnel) ou cree a son nom.
  let tarif: TarifLu
  let produitId: string
  let tarifCree = false
  let produitInscrit = false
  if (p.price_id) {
    const lu = await lireTarifRepris(cle, p.price_id)
    if (typeof lu === 'string') throw new RefusAction(`${lu} Rien n'a été créé.`)
    const r = refusTarifRepris({
      email: p.email, tarif: lu.tarif, reservePour: lu.reservePour, produitDeBase: lu.produitDeBase,
      produitActif: lu.produitActif, autresReserves: await reservesDuTarif(p.price_id),
    }) ?? ecartTarifDemande(p, lu.tarif)
      ?? refusTarifDejaPaye(p.price_id, await abonnementsDuTarif(cle, p.price_id))
    if (r) throw new RefusAction(`${r} Rien n'a été créé.`)
    if (!lu.produitLiveClub) {
      if (!lu.listeComplete) throw new Error("La liste des produits Live Club est illisible : rien n'a été créé, réessaie dans une minute.")
      const ins = await inscrireProduitLiveClub({
        produitId: lu.produitId, nom: lu.produitNom, posePar: acteur, note: `tarif réservé à ${p.qui}`,
      })
      if (!ins.ok) throw new Error(`${ins.message} Rien n'a été créé.`)
      produitInscrit = !ins.deja
    }
    // Le tarif porte desormais l'email de la personne (au mieux : il est deja a elle en base).
    if (!lu.reservePour) {
      await stripePost(cle, `/v1/prices/${p.price_id}`, { [`metadata[${META_RESERVE_POUR}]`]: p.email })
        .catch(err => console.warn(`[liveclub/reserves] metadonnee du tarif non posee : ${masquerCleStripe(messageErreur(err))}`))
    }
    tarif = lu.tarif
    produitId = lu.produitId
  } else {
    produitId = await produitCommun(cle, acteur)
    const cree = await stripePost(cle, '/v1/prices', corpsTarifReserve({
      produitId, montantCentimes: Math.round(Number(p.montant) * 100), devise: 'eur',
      recurrence: p.recurrence ?? 'month', qui: p.qui, email: p.email,
    }))
    const lu = lireTarifStripe(cree)
    if (!lu) throw new Error("Stripe n'a pas rendu le tarif créé : vérifie au Dashboard avant de redemander. Rien n'est réservé.")
    tarif = lu
    tarifCree = true
  }
  const libelle = libelleTarif(tarif)
  const reprise = tarifCree
    ? ` Le tarif ${tarif.id} (${libelle}, à son nom) existe déjà chez Stripe : redemande en reprenant ce price_id.`
    : ''

  // 3. Le lien personnel.
  let lien: { id: string; url: string }
  try {
    lien = await creerLienReserve(cle, { priceId: tarif.id, qui: p.qui, email: p.email, reserveId: null })
  } catch (err) {
    throw new Error(`${messageErreur(err)} Rien n'est réservé.${reprise}`)
  }

  // 4. La reservation.
  try {
    await prisma.$executeRaw`
      insert into public.cockpit_liveclub_tarifs_reserves
        (qui, email, telegram_id, compte, produit_id, price_id, tarif_cree, montant, devise, recurrence,
         lien_id, lien_url, lien_cree_le, cree_par, note)
      values (${p.qui}, ${p.email}, ${p.telegram_id}::bigint, 'melanie', ${produitId}, ${tarif.id}, ${tarifCree},
              ${(tarif.montant ?? 0) / 100}::numeric, ${tarif.devise}, ${tarif.recurrence ?? 'month'},
              ${lien.id}, ${lien.url}, now(), ${acteur.slice(0, 120)}, ${p.note})`
  } catch (err) {
    await desactiverLien(cle, lien.id)
    if (doublon(err)) {
      throw new RefusAction(`Une autre réservation vient d'être posée pour ${p.email} ou pour ce compte Telegram : `
        + `le lien créé a été désactivé, rien n'est réservé.${reprise}`)
    }
    throw new Error(`La base a refusé la réservation (${messageErreur(err)}) : le lien créé a été désactivé, rien n'est réservé.${reprise}`)
  }

  return phraseAbonnementReserveCree({
    qui: p.qui, email: p.email, tarif: libelle, url: lien.url, bot: nomBot(), avecTelegram: p.telegram_id !== null,
    priceRepris: tarifCree ? null : tarif.id, produitInscrit,
  })
}