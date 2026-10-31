// La repartition Brice / Melanie cote SERVEUR (08/10/2026) : lecture des six
// tables et des paiements, calcul par le module pur (./pur.ts), et les gestes
// de l'agent du Cockpit (controle avant la carte, execution apres le clic).
//
// Trois appelants :
// - l'outil de lecture repartition_du_mois de l'agent (agent-cockpit.ts) ;
// - la route /api/cockpit/repartition, qui sert l'onglet Revenus du cockpit
//   (le calcul ne vit qu'ici : le cockpit affiche, il ne recalcule pas) ;
// - executerAction (stripe-actions.ts), qui delegue ici les huit actions de
//   la repartition apres la confirmation humaine.
//
// Tables absentes (migration 20261008170000 pas appliquee) : la lecture rend
// des listes vides et le dit (tables_absentes), l'ecriture refuse en clair.
// Meme regle pour le tarif par live (migration 20261008190000) : tant que
// ses colonnes manquent, les tarifs sont comptes vides et les lives refuses.

import { prisma } from '@/lib/db'
import { RefusAction, type ActionAgent } from '@/lib/stripe-actions'
import { accorderAccesBroker, prerequisAccesBroker } from '@/lib/liveclub/acces'
import { nomBot } from '@/lib/liveclub/config'
import { relationAbsente, uuidDeActeur } from '@/lib/liveclub/pur'
import {
  type Commission, type Cote, type Depense, type DepenseLives, type Litige, type NatureReglement, type Reglement, type Repartition,
  litigeDeLigne, phraseReglement,
  type TarifIntervenant, type TauxPartenaire, type TypeRepartition, type UniteIntervenant, type Vente,
  NOM_COTE, PART_APPORTEUR_PCT, PART_BRICE_COMMUNE_PCT, bornesMois, centimes, cleIntervenant, commissionDuTaux, coteDuCompte, deMois,
  depenseDesLives, etapeApresDepot, etapeApresMarquage,
  euros, glissementCommission, jourDuPaiement, jourParis, libelleDepenseLives, libelleJour, libelleLives, libelleMois,
  libelleTarif, libelleTaux, moisDe, moisParis, moisPrevuCommission, moisValide, partsCommission, pourcent,
  repartitionDuMois, tarifDuMois, tarifsEnVigueur, tauxEnVigueur, venteDePaiement, versEuros,
  type CommissionRetro, PREFIXE_NOTE_ACCORD, accordNote, phraseRetroactif, planRetroactif, texteDepotDejaInscrit,
} from '@/lib/repartition/pur'

const MIGRATION = '20261008170000_cockpit_repartition.sql'
const MIGRATION_LIVES = '20261008190000_cockpit_intervenants_par_live.sql'
const MIGRATION_NATURE = '20261018093000_cockpit_reglements_nature.sql'

/** Une colonne manque (42703) : la migration du tarif par live n'est pas encore appliquee. */
function colonneAbsente(err: unknown): boolean {
  return /42703|column .* does not exist/i.test(err instanceof Error ? err.message : String(err))
}

/** Des centimes en texte '12.50' pour un ::numeric (exact, sans passer par un flottant). */
const numeric = (c: number) => (Math.round(c) / 100).toFixed(2)

/**
 * La raison lisible d'une erreur de la base. Une requete brute Prisma rend
 * « Invalid `prisma.$queryRaw()` invocation: » en premiere ligne et la vraie
 * raison (code et message Postgres) plus bas, ou dans meta.message.
 */
function erreurLisible(err: unknown): string {
  const meta = (err as { meta?: { message?: unknown } } | null)?.meta
  if (meta && typeof meta.message === 'string' && meta.message.trim()) return meta.message.trim().slice(0, 200)
  const texte = err instanceof Error ? err.message : String(err)
  const lignes = texte.split('\n').map(l => l.trim()).filter(Boolean)
  return (lignes[lignes.length - 1] ?? 'erreur inconnue').slice(0, 200)
}

const texteErreur = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Aujourd'hui et le mois courant, a Paris. */
export function contexteParis(maintenant: Date = new Date()): { aujourdhui: string; moisCourant: string } {
  return { aujourdhui: jourParis(maintenant), moisCourant: moisParis(maintenant) }
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

type LignePaiement = {
  paiement_id: string
  compte: string | null
  date_paiement: string
  horodatage: Date | null
  montant: number
  frais: number | null
  offre_id: string | null
}

type LigneCommission = {
  commission_id: string
  partenaire_id: string
  partenaire: string
  nature: 'depot' | 'affiliation'
  acces_id: string | null
  email: string | null
  client: string | null
  le: string
  montant_base: number | null
  taux_pct: number | null
  montant_fixe: number | null
  commission_attendue: number
  lots_faits_le: string | null
  statut: 'attendue' | 'recue' | 'perdue'
  montant_recu: number | null
  recue_le: string | null
  encaisse_par: Cote
  note: string | null
  pose_le: Date
}

type LigneTaux = {
  taux_id: string
  partenaire_id: string
  a_partir_du: string
  taux_pct: number | null
  montant_fixe: number | null
  note: string | null
  pose_le: Date
}

type LignePartenaire = { partenaire_id: string; nom: string; nature: 'broker' | 'affiliation'; note: string | null }

type LigneIntervenant = {
  part_id: string
  intervenant: string
  offre_id: string
  /** Euros par unite (par live). */
  montant_par_unite: number
  unite: UniteIntervenant
  a_partir_du: string
  note: string | null
  pose_le: Date
}

type LigneDepense = {
  depense_id: string
  libelle: string
  montant: number
  mois: string
  payee_par: Cote
  cote: Cote | null
  offre_id: string | null
  part_brice_pct: number | null
  /** Les lives d'un intervenant : les trois remplis ensemble, ou aucun. */
  intervenant: string | null
  quantite: number | null
  prix_unitaire: number | null
  note: string | null
  via: string
  pose_le: Date
}

type LigneReglement = {
  reglement_id: string
  /** null : colonne pas encore en base (20261018093000), donc une avance. */
  nature: NatureReglement | null
  de: Cote
  a: Cote
  montant: number
  regle_le: string
  mois: string
  note: string | null
  via: string
  pose_le: Date
}

/**
 * Une lecture, ou une liste vide si la table n'existe pas encore, ou n'a pas
 * encore ses colonnes (notee dans `absentes`).
 */
async function lireOuVide<T>(table: string, absentes: Set<string>, lire: () => Promise<T[]>): Promise<T[]> {
  try {
    return await lire()
  } catch (err) {
    if (relationAbsente(err) || colonneAbsente(err)) {
      absentes.add(table)
      return []
    }
    throw err
  }
}

/** Les paiements autour d'un mois (un jour de marge : le mois se juge au jour de Paris). */
async function lirePaiements(mois: string): Promise<LignePaiement[]> {
  const { debut, fin } = bornesMois(mois)
  try {
    return await prisma.$queryRaw<LignePaiement[]>`
      select paiement_id, compte, date_paiement::text as date_paiement, horodatage,
             montant::float8 as montant, frais::float8 as frais, offre_id
      from public.cockpit_paiements
      where date_paiement between (${debut}::date - 1) and (${fin}::date + 1)`
  } catch (err) {
    // Base d'avant la colonne horodatage (20260929190500) : le jour UTC suffit.
    if (!/horodatage|42703/i.test(texteErreur(err))) throw err
    return prisma.$queryRaw<LignePaiement[]>`
      select paiement_id, compte, date_paiement::text as date_paiement, null::timestamptz as horodatage,
             montant::float8 as montant, frais::float8 as frais, offre_id
      from public.cockpit_paiements
      where date_paiement between (${debut}::date - 1) and (${fin}::date + 1)`
  }
}

function lireCommissions(): Promise<LigneCommission[]> {
  return prisma.$queryRaw<LigneCommission[]>`
    select c.commission_id::text as commission_id, c.partenaire_id, p.nom as partenaire, c.nature,
           c.acces_id::text as acces_id, coalesce(c.email, a.email) as email, c.client,
           c.le::text as le, c.montant_base::float8 as montant_base, c.taux_pct::float8 as taux_pct,
           c.montant_fixe::float8 as montant_fixe, c.commission_attendue::float8 as commission_attendue,
           c.lots_faits_le::text as lots_faits_le, c.statut, c.montant_recu::float8 as montant_recu,
           c.recue_le::text as recue_le, c.encaisse_par, c.note, c.pose_le
    from public.cockpit_commissions c
    join public.cockpit_partenaires p on p.partenaire_id = c.partenaire_id
    left join public.cockpit_liveclub_acces a on a.acces_id = c.acces_id
    order by c.le desc, c.pose_le desc`
}

function lireTaux(): Promise<LigneTaux[]> {
  return prisma.$queryRaw<LigneTaux[]>`
    select taux_id::text as taux_id, partenaire_id, a_partir_du::text as a_partir_du,
           taux_pct::float8 as taux_pct, montant_fixe::float8 as montant_fixe, note, pose_le
    from public.cockpit_partenaire_taux
    order by partenaire_id, a_partir_du desc, pose_le desc`
}

function lirePartenaires(): Promise<LignePartenaire[]> {
  return prisma.$queryRaw<LignePartenaire[]>`
    select partenaire_id, nom, nature, note from public.cockpit_partenaires order by nom`
}

function lireIntervenants(): Promise<LigneIntervenant[]> {
  return prisma.$queryRaw<LigneIntervenant[]>`
    select part_id::text as part_id, intervenant, offre_id, montant_par_unite::float8 as montant_par_unite,
           unite, a_partir_du::text as a_partir_du, note, pose_le
    from public.cockpit_intervenants
    order by offre_id, a_partir_du desc, pose_le desc`
}

async function lireDepenses(mois: string): Promise<LigneDepense[]> {
  try {
    return await prisma.$queryRaw<LigneDepense[]>`
      select depense_id::text as depense_id, libelle, montant::float8 as montant, mois, payee_par, cote,
             offre_id, part_brice_pct::float8 as part_brice_pct, intervenant, quantite,
             prix_unitaire::float8 as prix_unitaire, note, via, pose_le
      from public.cockpit_depenses
      where mois = ${mois} and retire_le is null
      order by pose_le`
  } catch (err) {
    // Base d'avant le tarif par live (20261008190000) : aucune depense de lives.
    if (!colonneAbsente(err)) throw err
    return prisma.$queryRaw<LigneDepense[]>`
      select depense_id::text as depense_id, libelle, montant::float8 as montant, mois, payee_par, cote,
             offre_id, part_brice_pct::float8 as part_brice_pct, null::text as intervenant, null::int as quantite,
             null::float8 as prix_unitaire, note, via, pose_le
      from public.cockpit_depenses
      where mois = ${mois} and retire_le is null
      order by pose_le`
  }
}

/** Les tarifs d'UN intervenant (tous produits), pour les lives du mois. */
async function tarifsDe(intervenant: string): Promise<TarifIntervenant[]> {
  const cle = cleIntervenant(intervenant)
  return (await lireIntervenants()).map(versTarif).filter(t => cleIntervenant(t.intervenant) === cle)
}

/** Les lives deja declares (non retires) d'un intervenant, pour un produit et un mois. */
async function livesDejaDeclares(intervenant: string, offreId: string, mois: string) {
  return prisma.$queryRaw<{ depense_id: string; quantite: number; prix_unitaire: number; montant: number; payee_par: Cote }[]>`
    select depense_id::text as depense_id, quantite, prix_unitaire::float8 as prix_unitaire,
           montant::float8 as montant, payee_par
    from public.cockpit_depenses
    where intervenant is not null and lower(intervenant) = lower(${intervenant.trim()})
      and offre_id = ${offreId} and mois = ${mois} and retire_le is null`
}

async function lireReglements(mois: string): Promise<LigneReglement[]> {
  try {
    return await prisma.$queryRaw<LigneReglement[]>`
      select reglement_id::text as reglement_id, nature, de, a, montant::float8 as montant, regle_le::text as regle_le,
             mois, note, via, pose_le
      from public.cockpit_reglements
      where mois = ${mois} and retire_le is null
      order by regle_le, pose_le`
  } catch (err) {
    // Base d'avant la colonne nature (20261018093000) : tout est une avance.
    if (!colonneAbsente(err)) throw err
    return prisma.$queryRaw<LigneReglement[]>`
      select reglement_id::text as reglement_id, null::text as nature, de, a, montant::float8 as montant,
             regle_le::text as regle_le, mois, note, via, pose_le
      from public.cockpit_reglements
      where mois = ${mois} and retire_le is null
      order by regle_le, pose_le`
  }
}

type LigneLitige = {
  litige_id: string
  compte: string | null
  paiement_id: string | null
  montant: number
  devise: string | null
  statut: string
  motif: string | null
  ouvert_le: Date
  clos_le: Date | null
  frais: number | null
  restitue: number | null
}

/** Tous les litiges Stripe (une poignee) : le module pur garde ceux qui comptent dans le mois (regle 7). */
function lireLitiges(): Promise<LigneLitige[]> {
  return prisma.$queryRaw<LigneLitige[]>`
    select litige_id, compte, paiement_id, montant::float8 as montant, devise, statut, motif,
           ouvert_le, clos_le, frais::float8 as frais, restitue::float8 as restitue
    from public.cockpit_litiges
    order by ouvert_le`
}

const versReglement = (r: LigneReglement): Reglement => ({
  id: r.reglement_id, nature: r.nature ?? 'avance', de: r.de, a: r.a, montant: centimes(r.montant) ?? 0,
  regleLe: r.regle_le, mois: r.mois, note: r.note,
})

async function lireNomsOffres(): Promise<Record<string, string>> {
  const lignes = await prisma.$queryRaw<{ offre_id: string; nom: string }[]>`
    select offre_id, nom from public.cockpit_offres`
  return Object.fromEntries(lignes.map(l => [l.offre_id, l.nom]))
}

const iso = (d: Date | string | null) => (d instanceof Date ? d.toISOString() : d)

function versCommission(c: LigneCommission): Commission {
  return {
    id: c.commission_id,
    partenaire: c.partenaire,
    client: c.client ?? c.email,
    le: c.le,
    lotsFaitsLe: c.lots_faits_le,
    statut: c.statut,
    attendue: centimes(c.commission_attendue) ?? 0,
    recue: c.montant_recu === null ? null : centimes(c.montant_recu),
    recueLe: c.recue_le,
    encaissePar: c.encaisse_par,
  }
}

function versTaux(t: LigneTaux): TauxPartenaire {
  return {
    partenaireId: t.partenaire_id,
    aPartirDu: t.a_partir_du,
    tauxPct: t.taux_pct,
    montantFixe: t.montant_fixe === null ? null : centimes(t.montant_fixe),
    poseLe: iso(t.pose_le),
  }
}

function versTarif(i: LigneIntervenant): TarifIntervenant {
  return {
    intervenant: i.intervenant, offreId: i.offre_id, montantParUnite: centimes(i.montant_par_unite) ?? 0,
    unite: i.unite ?? 'live', aPartirDu: i.a_partir_du, poseLe: iso(i.pose_le),
  }
}

function versDepense(d: LigneDepense): Depense {
  const lives = d.intervenant && d.quantite && d.prix_unitaire !== null
    ? { intervenant: d.intervenant, quantite: d.quantite, prixUnitaire: centimes(d.prix_unitaire) ?? 0 }
    : null
  return {
    id: d.depense_id, libelle: d.libelle, montant: centimes(d.montant) ?? 0, mois: d.mois,
    payeePar: d.payee_par, cote: d.cote, offreId: d.offre_id, partBricePct: d.part_brice_pct, lives,
  }
}

/** Le cote de chaque produit d'apres ses ventes Stripe (le compte le plus frequent). */
async function cotesDesProduits(offreIds: readonly string[]): Promise<Record<string, Cote>> {
  if (offreIds.length === 0) return {}
  const lignes = await prisma.$queryRaw<{ offre_id: string; compte: string; n: number }[]>`
    select offre_id, compte, count(*)::int as n from public.cockpit_paiements
    where offre_id = any(${[...offreIds]}::text[]) and compte is not null
    group by offre_id, compte`
  const meilleur = new Map<string, { compte: string; n: number }>()
  for (const l of lignes) {
    const deja = meilleur.get(l.offre_id)
    if (!deja || l.n > deja.n) meilleur.set(l.offre_id, { compte: l.compte, n: l.n })
  }
  const cotes: Record<string, Cote> = {}
  for (const [offreId, m] of meilleur) {
    const c = coteDuCompte(m.compte)
    if (c) cotes[offreId] = c
  }
  return cotes
}

/**
 * Les tarifs qui valent pour les lives d'un mois, un par intervenant et par
 * produit (le cockpit en fait son formulaire, l'agent sa lecture), avec le
 * cote du produit et ce qui est deja declare ce mois-la.
 */
function tarifsDuMois(
  intervenants: readonly LigneIntervenant[], depenses: readonly LigneDepense[], mois: string,
  noms: Record<string, string>, cotes: Record<string, Cote>,
) {
  const tarifs = intervenants.map(versTarif)
  const vus = new Set<string>()
  const lignes = []
  for (const t of tarifs) {
    const cle = `${cleIntervenant(t.intervenant)}|${t.offreId}`
    if (vus.has(cle)) continue
    vus.add(cle)
    const r = tarifDuMois(tarifs, t.intervenant, mois, t.offreId)
    if (!r.ok) continue
    const deja = depenses.find(d => d.intervenant && d.offre_id === r.tarif.offreId
      && cleIntervenant(d.intervenant) === cleIntervenant(r.tarif.intervenant))
    lignes.push({
      intervenant: r.tarif.intervenant.trim(),
      offre_id: r.tarif.offreId,
      offre: noms[r.tarif.offreId] ?? r.tarif.offreId,
      montant_par_unite: versEuros(r.tarif.montantParUnite),
      unite: r.tarif.unite,
      tarif: libelleTarif(r.tarif),
      a_partir_du: r.tarif.aPartirDu,
      change_en_cours_de_mois: r.avant ? libelleTarif(r.avant) : null,
      cote: cotes[r.tarif.offreId] ?? null,
      libelle_depense: libelleDepenseLives(r.tarif.intervenant),
      deja_declare: deja
        ? { depense_id: deja.depense_id, quantite: deja.quantite, prix_unitaire: deja.prix_unitaire, montant: deja.montant }
        : null,
    })
  }
  return lignes.sort((a, b) => a.intervenant.localeCompare(b.intervenant) || a.offre.localeCompare(b.offre))
}

/** Tout ce qu'il faut pour un mois, et le calcul. */
async function chargerMois(mois: string, moisCourant: string) {
  const absentes = new Set<string>()
  // Les litiges ne font jamais tomber la repartition : table absente ou
  // illisible, aucun litige compte, et un avertissement le dit (regle 7).
  let litigesNonLus = false
  const [paiements, commissions, intervenants, depenses, reglements, nomsOffres, litiges] = await Promise.all([
    lirePaiements(mois),
    lireOuVide('cockpit_commissions', absentes, lireCommissions),
    lireOuVide('cockpit_intervenants', absentes, lireIntervenants),
    lireOuVide('cockpit_depenses', absentes, () => lireDepenses(mois)),
    lireOuVide('cockpit_reglements', absentes, () => lireReglements(mois)),
    lireNomsOffres().catch(() => ({} as Record<string, string>)),
    lireLitiges().catch((err): LigneLitige[] => {
      litigesNonLus = true
      if (relationAbsente(err)) absentes.add('cockpit_litiges')
      else console.error('[repartition] litiges illisibles', erreurLisible(err))
      return []
    }),
  ])

  const ventes: Vente[] = []
  const horsStripe = { nb: 0, montant: 0 }
  for (const p of paiements) {
    const v = venteDePaiement(p)
    if (v) {
      ventes.push(v)
    } else if (moisDe(jourDuPaiement(p)) === mois) {
      horsStripe.nb += 1
      horsStripe.montant += centimes(p.montant) ?? 0
    }
  }

  const repartition = repartitionDuMois({
    mois,
    moisCourant,
    ventes,
    commissions: commissions.map(versCommission),
    depenses: depenses.map(versDepense),
    reglements: reglements.map(versReglement),
    litiges: litiges.map(litigeDeLigne).filter((l): l is Litige => l !== null),
    litigesNonLus,
    horsStripe,
    nomsOffres,
  })
  const cotes = await cotesDesProduits([...new Set(intervenants.map(i => i.offre_id))])
    .catch(() => ({} as Record<string, Cote>))
  const tarifs = tarifsDuMois(intervenants, depenses, mois, nomsOffres, cotes)
  return { repartition, commissions, intervenants, depenses, reglements, nomsOffres, tarifs, absentes: [...absentes] }
}

const paire = (r: Record<Cote, number>) => ({ brice: versEuros(r.brice), mel: versEuros(r.mel) })

/** La repartition en euros (nombres a 2 decimales), pour le JSON de l'agent et du cockpit. */
export function repartitionEnEuros(r: Repartition) {
  const cote = (c: Cote) => {
    const d = r.cotes[c]
    return {
      nb_ventes: d.nbVentes, encaisse: versEuros(d.encaisse), rembourse: versEuros(d.rembourse),
      frais: versEuros(d.frais), frais_inconnus: d.fraisInconnus,
      net_ventes: versEuros(d.netVentes), commissions: versEuros(d.commissions), depenses: versEuros(d.depenses),
      intervenants: versEuros(d.intervenants), litiges: versEuros(d.litiges), base: versEuros(d.base), parts: paire(d.parts),
    }
  }
  return {
    mois: r.mois,
    libelle_mois: libelleMois(r.mois),
    phrase: r.phrase,
    // La phrase de tete et ce qui compose le solde, en phrases (Brice, 17/10 :
    // « on se doit de rendre ces ecrans plus limpides »).
    phrase_tete: r.phraseTete,
    explication: r.explication,
    etat_du_mois: r.regle ? 'regle' : 'a_regler',
    regle: r.regle ? { le: r.regle.le, de: r.regle.de, a: r.regle.a, montant: versEuros(r.regle.montant) } : null,
    avances: { mel_vers_brice: versEuros(r.avances.melVersBrice), brice_vers_mel: versEuros(r.avances.briceVersMel) },
    dettes: { mel_envers_brice: versEuros(r.dettes.melEnversBrice), brice_envers_mel: versEuros(r.dettes.briceEnversMel) },
    litiges: {
      perdus: { nb: r.litiges.perdus.nb, montant: versEuros(r.litiges.perdus.montant) },
      en_cours: { nb: r.litiges.enCours.nb, montant: versEuros(r.litiges.enCours.montant) },
    },
    solde_brice: versEuros(r.solde),
    solde_avant_reglements: versEuros(r.soldeAvantReglements),
    formule: "Solde de Brice = somme de ses parts - (ce qu'il a eu en main - ce qu'il a payé). Positif : Mel lui doit ce montant. Négatif : il doit à Mel. Les règlements du mois s'en déduisent.",
    hypothese: 'Une dépense compte pour celui qui l\'a payée : les lives d\'un intervenant sont payés par la personne notée sur la dépense (par défaut le côté du produit, Mel pour le Live Club).',
    // Les regles en clair, pour l'ecran du cockpit : son bundle est servi sans
    // session, il n'embarque donc aucune regle de partage (cockpit/CLAUDE.md).
    regles: {
      partage: `Celui qui apporte la vente prend ${PART_APPORTEUR_PCT} %, l'autre ${100 - PART_APPORTEUR_PCT} %.`,
      depense: `Une dépense commune se partage ${PART_BRICE_COMMUNE_PCT}/${100 - PART_BRICE_COMMUNE_PCT}, sauf part donnée. `
        + 'Rattachée à un côté ou à un produit, elle est déduite de ce côté avant son partage.',
      commission: "Une commission compte dans le mois où elle est reçue. Tant qu'elle ne l'est pas, elle glisse de mois en mois.",
      intervenant: "Un intervenant touche une somme fixe par live, rien sur les ventes. Chaque mois, ses lives (nombre x tarif en vigueur ce mois-là) font une dépense rattachée à son produit, déduite de ce côté avant le partage.",
      litige: "Un paiement contesté et perdu sort du partage, avec ses frais de litige, du côté du Stripe qui l'avait encaissé, le mois où il est perdu. Un litige en cours ne change rien tant qu'il n'est pas perdu.",
      reglement: "Pendant le mois, les sommes s'accumulent : une dette (l'un doit une somme à l'autre, hors des ventes) ou une avance (l'un a donné de l'argent à l'autre). En fin de mois, celui qui doit paie le solde : le mois est réglé.",
    },
    part_apporteur_pct: PART_APPORTEUR_PCT,
    parts: paire(r.parts),
    en_main: paire(r.enMain),
    reglements: { mel_vers_brice: versEuros(r.reglements.melVersBrice), brice_vers_mel: versEuros(r.reglements.briceVersMel) },
    cotes: { mel: cote('mel'), brice: cote('brice') },
    communes: { total: versEuros(r.communes.total), parts: paire(r.communes.parts) },
    intervenants: r.intervenants.map(i => ({
      intervenant: i.intervenant, offre_id: i.offreId, paye_par: i.payePar, quantite: i.quantite,
      prix_unitaire: versEuros(i.prixUnitaire), montant: versEuros(i.montant),
      detail: libelleLives(i.quantite, i.prixUnitaire),
    })),
    commissions: {
      recues: { nb: r.commissions.recues.nb, montant: versEuros(r.commissions.recues.montant) },
      attendues: {
        nb: r.commissions.attendues.nb, montant: versEuros(r.commissions.attendues.montant),
        glissees: r.commissions.attendues.glissees,
      },
    },
    lignes: r.lignes.map(l => ({
      genre: l.genre, libelle: l.libelle, phrase: l.phrase, cote: l.cote, detail: l.detail ?? null,
      en_main: paire(l.enMain), parts: paire(l.parts),
      lives: l.lives
        ? { intervenant: l.lives.intervenant, quantite: l.lives.quantite, prix_unitaire: versEuros(l.lives.prixUnitaire) }
        : null,
    })),
    avertissements: r.avertissements,
  }
}

/** La lecture de l'outil repartition_du_mois de l'agent : le detail et le solde, en euros. */
export async function repartitionPourAgent(moisDemande: unknown): Promise<string> {
  const { moisCourant } = contexteParis()
  const mois = moisDemande === null || moisDemande === undefined || moisDemande === '' ? moisCourant : String(moisDemande).trim()
  if (!moisValide(mois)) return JSON.stringify({ erreur: 'mois : au format AAAA-MM (ex. 2026-10), ou vide pour le mois en cours.' })
  try {
    const m = await chargerMois(mois, moisCourant)
    const attendues = m.commissions.filter(c => c.statut === 'attendue').slice(0, 30).map(c => ({
      commission_id: c.commission_id, partenaire: c.partenaire, client: c.client ?? c.email, depot_le: c.le,
      attendue: c.commission_attendue, lots_faits_le: c.lots_faits_le,
      mois_prevu: moisPrevuCommission({ statut: c.statut, le: c.le, lotsFaitsLe: c.lots_faits_le }, moisCourant),
      glissee: glissementCommission({ statut: c.statut, le: c.le, lotsFaitsLe: c.lots_faits_le }, moisCourant),
    }))
    return JSON.stringify({
      ...repartitionEnEuros(m.repartition),
      commissions_attendues: attendues,
      // Les tarifs des intervenants qui valent ce mois-ci, et les lives deja
      // declares : leurs lives sont des depenses (lignes genre depense).
      tarifs_intervenants_du_mois: m.tarifs.map(t => ({
        intervenant: t.intervenant, offre_id: t.offre_id, offre: t.offre, tarif: t.tarif, depuis: t.a_partir_du,
        change_en_cours_de_mois: t.change_en_cours_de_mois,
        lives_declares: t.deja_declare
          ? `${libelleLives(t.deja_declare.quantite ?? 0, centimes(t.deja_declare.prix_unitaire) ?? 0)} = ${euros(centimes(t.deja_declare.montant) ?? 0)}`
          : null,
      })),
      tables_absentes: m.absentes,
      ...(m.absentes.length ? { note_tables: `Tables ou colonnes pas encore en base (migrations ${MIGRATION} et ${MIGRATION_LIVES} à appliquer) : comptées vides.` } : {}),
    })
  } catch (err) {
    return JSON.stringify({ erreur: `Répartition illisible : ${erreurLisible(err)}` })
  }
}

/** Ce que l'onglet Revenus du cockpit affiche : la repartition du mois et les listes a gerer. */
export async function repartitionPourCockpit(mois: string) {
  const { moisCourant, aujourdhui } = contexteParis()
  const absentes = new Set<string>()
  const [m, partenaires, taux] = await Promise.all([
    chargerMois(mois, moisCourant),
    lireOuVide('cockpit_partenaires', absentes, lirePartenaires),
    lireOuVide('cockpit_partenaire_taux', absentes, lireTaux),
  ])
  for (const t of m.absentes) absentes.add(t)
  const tauxCalc = taux.map(versTaux)

  return {
    mois,
    mois_courant: moisCourant,
    aujourdhui,
    repartition: repartitionEnEuros(m.repartition),
    commissions: m.commissions.map(c => {
      const pour = { statut: c.statut, le: c.le, lotsFaitsLe: c.lots_faits_le }
      return {
        commission_id: c.commission_id, partenaire_id: c.partenaire_id, partenaire: c.partenaire, nature: c.nature,
        client: c.client, email: c.email, le: c.le, montant_base: c.montant_base,
        taux: libelleTaux({ tauxPct: c.taux_pct, montantFixe: c.montant_fixe === null ? null : centimes(c.montant_fixe) }, c.nature),
        commission_attendue: c.commission_attendue, lots_faits_le: c.lots_faits_le, statut: c.statut,
        montant_recu: c.montant_recu, recue_le: c.recue_le, encaisse_par: c.encaisse_par, note: c.note,
        mois_prevu: moisPrevuCommission(pour, moisCourant), glissee: glissementCommission(pour, moisCourant),
      }
    }),
    partenaires: partenaires.map(p => {
      const actuel = tauxEnVigueur(tauxCalc, p.partenaire_id, aujourdhui)
      return {
        partenaire_id: p.partenaire_id, nom: p.nom, nature: p.nature, note: p.note,
        taux_actuel: actuel ? libelleTaux(actuel, p.nature === 'broker' ? 'depot' : 'affiliation') : null,
        depuis: actuel?.aPartirDu ?? null,
        historique: taux.filter(t => t.partenaire_id === p.partenaire_id).map(t => ({
          taux_id: t.taux_id, a_partir_du: t.a_partir_du,
          libelle: libelleTaux(versTaux(t), p.nature === 'broker' ? 'depot' : 'affiliation'),
          note: t.note, pose_le: iso(t.pose_le),
        })),
      }
    }),
    intervenants: m.intervenants.map(i => {
      // La ligne qui fait foi aujourd'hui pour cet intervenant et ce produit :
      // la premiere de la liste (triee a_partir_du puis pose_le decroissants)
      // qui a deja commence. Les autres sont l'historique, ou a venir.
      const cle = cleIntervenant(i.intervenant)
      const dernier = m.intervenants.find(x => x.offre_id === i.offre_id
        && cleIntervenant(x.intervenant) === cle && x.a_partir_du <= aujourdhui)
      return {
        part_id: i.part_id, intervenant: i.intervenant, offre_id: i.offre_id,
        offre: m.nomsOffres[i.offre_id] ?? i.offre_id,
        montant_par_unite: i.montant_par_unite, unite: i.unite, tarif: libelleTarif(versTarif(i)),
        a_partir_du: i.a_partir_du, note: i.note,
        en_vigueur: dernier?.part_id === i.part_id,
        a_venir: i.a_partir_du > aujourdhui,
      }
    }),
    // Les tarifs qui valent pour les lives du mois affiche (formulaire « Lives du mois »).
    tarifs_du_mois: m.tarifs,
    depenses: m.depenses.map(d => ({
      depense_id: d.depense_id, libelle: d.libelle, montant: d.montant, mois: d.mois, payee_par: d.payee_par,
      cote: d.cote, offre_id: d.offre_id, part_brice_pct: d.part_brice_pct,
      intervenant: d.intervenant, quantite: d.quantite, prix_unitaire: d.prix_unitaire,
      lives: d.intervenant && d.quantite && d.prix_unitaire !== null
        ? libelleLives(d.quantite, centimes(d.prix_unitaire) ?? 0)
        : null,
      note: d.note, via: d.via,
    })),
    reglements: m.reglements.map(r => ({
      reglement_id: r.reglement_id, nature: r.nature ?? 'avance', de: r.de, a: r.a, montant: r.montant,
      regle_le: r.regle_le, mois: r.mois, note: r.note, via: r.via,
      phrase: phraseReglement(versReglement(r)),
    })),
    offres: m.nomsOffres,
    tables_absentes: [...absentes],
  }
}

// ---------------------------------------------------------------------------
// Les gestes de l'agent : lectures communes
// ---------------------------------------------------------------------------

async function partenaireParId(id: string): Promise<LignePartenaire | null> {
  const lignes = await prisma.$queryRaw<LignePartenaire[]>`
    select partenaire_id, nom, nature, note from public.cockpit_partenaires where partenaire_id = ${id}`
  return lignes[0] ?? null
}

async function tauxDuPartenaire(id: string): Promise<TauxPartenaire[]> {
  const lignes = await prisma.$queryRaw<LigneTaux[]>`
    select taux_id::text as taux_id, partenaire_id, a_partir_du::text as a_partir_du,
           taux_pct::float8 as taux_pct, montant_fixe::float8 as montant_fixe, note, pose_le
    from public.cockpit_partenaire_taux where partenaire_id = ${id}`
  return lignes.map(versTaux)
}

type AccesExistant = { acces_id: string; jusquau: string; actif: boolean }

async function accesParEmail(email: string): Promise<AccesExistant | null> {
  const lignes = await prisma.$queryRaw<AccesExistant[]>`
    select acces_id::text as acces_id, jusquau::text as jusquau,
           (retire_le is null and sorti_le is null and jusquau >= current_date) as actif
    from public.cockpit_liveclub_acces
    where lower(email) = ${email} and motif = 'broker'
    limit 1`
  return lignes[0] ?? null
}

async function commissionParId(id: string): Promise<LigneCommission | null> {
  const lignes = await prisma.$queryRaw<LigneCommission[]>`
    select c.commission_id::text as commission_id, c.partenaire_id, p.nom as partenaire, c.nature,
           c.acces_id::text as acces_id, coalesce(c.email, a.email) as email, c.client,
           c.le::text as le, c.montant_base::float8 as montant_base, c.taux_pct::float8 as taux_pct,
           c.montant_fixe::float8 as montant_fixe, c.commission_attendue::float8 as commission_attendue,
           c.lots_faits_le::text as lots_faits_le, c.statut, c.montant_recu::float8 as montant_recu,
           c.recue_le::text as recue_le, c.encaisse_par, c.note, c.pose_le
    from public.cockpit_commissions c
    join public.cockpit_partenaires p on p.partenaire_id = c.partenaire_id
    left join public.cockpit_liveclub_acces a on a.acces_id = c.acces_id
    where c.commission_id = ${id}::uuid`
  return lignes[0] ?? null
}

/**
 * (29/10, cas de Victor Weber) Un depot DEJA INSCRIT : meme broker, meme jour
 * de depot, meme montant, meme personne (email de la ligne ou de son acces
 * broker), SANS limite de temps. Avant : seulement les 10 dernieres minutes,
 * et une carte confirmee plus tard inscrivait la commission une seconde fois.
 */
async function depotDejaInscrit(partenaireId: string, le: string, base: number, email: string): Promise<string | null> {
  const lignes = await prisma.$queryRaw<{
    qui: string | null; partenaire: string; le: string; montant_base: number; commission_attendue: number; statut: string; pose_le: string | null
  }[]>`
    select coalesce(c.client, c.email, a.email) as qui, p.nom as partenaire, c.le::text as le,
           c.montant_base::float8 as montant_base, c.commission_attendue::float8 as commission_attendue,
           c.statut, c.pose_le::text as pose_le
    from public.cockpit_commissions c
    join public.cockpit_partenaires p on p.partenaire_id = c.partenaire_id
    left join public.cockpit_liveclub_acces a on a.acces_id = c.acces_id
    where c.partenaire_id = ${partenaireId} and c.nature = 'depot' and c.le = ${le}::date
      and c.montant_base = ${versEuros(base)}::numeric
      and (lower(c.email) = ${email} or lower(a.email) = ${email})
    order by c.pose_le
    limit 1`
  const d = lignes[0]
  if (!d) return null
  return texteDepotDejaInscrit({
    qui: d.qui ?? email, partenaire: d.partenaire, base: centimes(d.montant_base) ?? base, le: d.le,
    attendue: centimes(d.commission_attendue) ?? 0, statut: d.statut, poseLe: d.pose_le,
  })
}

/** (29/10) Les commissions d'un partenaire depuis une date, pour un taux retroactif. */
async function commissionsDepuis(partenaireId: string, depuis: string): Promise<CommissionRetro[]> {
  const lignes = await prisma.$queryRaw<{
    commission_id: string; qui: string | null; le: string; montant_base: number | null; commission_attendue: number; statut: string; note: string | null
  }[]>`
    select c.commission_id::text as commission_id, coalesce(c.client, c.email, a.email, 'client') as qui, c.le::text as le,
           c.montant_base::float8 as montant_base, c.commission_attendue::float8 as commission_attendue, c.statut, c.note
    from public.cockpit_commissions c
    left join public.cockpit_liveclub_acces a on a.acces_id = c.acces_id
    where c.partenaire_id = ${partenaireId} and c.le >= ${depuis}::date
    order by c.le, c.pose_le`
  return lignes.map(l => ({
    commissionId: l.commission_id, qui: l.qui ?? 'client', le: l.le,
    base: l.montant_base === null ? null : centimes(l.montant_base), attendue: centimes(l.commission_attendue) ?? 0,
    statut: l.statut === 'recue' ? 'recue' : l.statut === 'perdue' ? 'perdue' : 'attendue', note: l.note,
  }))
}

/** (29/10) L'accord d'un partenaire avant un changement, en clair : son taux en vigueur et l'accord note. */
function accordAvant(avant: TauxPartenaire | null, note: string | null, nature: 'depot' | 'affiliation'): string {
  const accord = accordNote(note)
  return [
    avant ? `${libelleTaux(avant, nature)} depuis le ${libelleJour(avant.aPartirDu)}` : 'aucun taux général',
    accord ? `accord noté : ${accord}` : null,
  ].filter(Boolean).join(' ; ')
}

async function nomOffre(offreId: string): Promise<string | null> {
  const lignes = await prisma.$queryRaw<{ nom: string }[]>`
    select nom from public.cockpit_offres where offre_id = ${offreId}`
  return lignes[0]?.nom ?? null
}

/** Le cote d'un produit d'apres ses ventes Stripe (le compte le plus frequent), ou null. */
async function coteDuProduit(offreId: string): Promise<Cote | null> {
  const lignes = await prisma.$queryRaw<{ compte: string }[]>`
    select compte from public.cockpit_paiements
    where offre_id = ${offreId} and compte is not null
    group by compte order by count(*) desc limit 1`
  return coteDuCompte(lignes[0]?.compte)
}

const qui = (c: { client: string | null; email: string | null }) => c.client ?? c.email ?? 'le client'

/** Commission attendue, mois prevu et parts, en une phrase (carte et resultat). */
function phraseCommission(o: {
  attendue: number | null; taux: TauxPartenaire; nature: 'depot' | 'affiliation'; le: string; client: string; moisCourant: string
  /** (29/10) « commission propre à ce dépôt » quand elle a ete donnee avec lui. */
  libelle?: string
}): string {
  const libelle = o.libelle ?? libelleTaux(o.taux, o.nature)
  if (o.attendue === null) return `Taux de ${libelle} : montant inconnu sans la base.`
  const prevu = moisPrevuCommission({ statut: 'attendue', le: o.le, lotsFaitsLe: null }, o.moisCourant) ?? o.moisCourant
  const parts = partsCommission(o.attendue)
  return `Commission attendue : ${euros(o.attendue)} (${libelle}), prévue fin ${libelleMois(prevu)}`
    + (o.nature === 'depot' ? ` si ${o.client} fait ses lots d'ici là, sinon elle glisse au mois suivant.` : '.')
    + ` Part de Mel : ${euros(parts.mel)}, part de Brice : ${euros(parts.brice)} (70/30, avant dépenses).`
}

/**
 * (29/10) Le taux qui fixe la commission d'un depot ou d'une affiliation : la
 * commission donnee pour CE depot (« on prend 400 EUR »), qui prime, sinon le
 * taux du partenaire en vigueur a sa date. null = ni l'un ni l'autre.
 */
async function tauxPourDepot(
  type: TypeRepartition, p: Record<string, unknown>, partenaireId: string, le: string,
): Promise<{ taux: TauxPartenaire; libelle?: string } | null> {
  if (type === 'depot_broker' && p.commission !== null && p.commission !== undefined) {
    const c = centimes(p.commission)
    if (c !== null) {
      return { taux: { partenaireId, aPartirDu: le, tauxPct: null, montantFixe: c }, libelle: 'commission propre à ce dépôt' }
    }
  }
  const taux = tauxEnVigueur(await tauxDuPartenaire(partenaireId), partenaireId, le)
  return taux ? { taux } : null
}

/** Le solde d'un mois en une phrase, ou null si la lecture echoue (jamais bloquant). */
async function phraseSoldeDuMois(mois: string): Promise<string | null> {
  try {
    const { moisCourant } = contexteParis()
    const m = await chargerMois(mois, moisCourant)
    return `Solde ${deMois(mois)} : ${m.repartition.phrase}.`
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Avant la carte : ce que le modele doit savoir (taux inconnu, offre
// inconnue...), et le complement chiffre qui rend la carte lisible.
// ---------------------------------------------------------------------------

export type ControleCarte =
  | { erreur: string }
  | {
    action: ActionAgent; complement: string | null; manque: string | null
    /**
     * (31/10) Ce que la carte COURTE (Melanie) doit garder du complement : un
     * avertissement qui change ce que fait le clic (acces broker deja eu).
     */
    alerte?: string | null
  }

/**
 * Controle une action de repartition DEJA validee (validerAction), avant de
 * montrer la carte. `erreur` retourne au modele (il pose la question ou
 * corrige) ; sinon la carte part, avec un complement chiffre, et `manque`
 * quand l'execution est impossible (cle Resend ou Stripe absente).
 */
export async function controlerActionRepartition(a: ActionAgent): Promise<ControleCarte> {
  const p = a.params
  const type = a.type as TypeRepartition
  const { moisCourant } = contexteParis()
  try {
    if (type === 'depot_broker' || type === 'commission_affiliation') {
      const nom = String(p.partenaire_nom)
      const partenaire = await partenaireParId(String(p.partenaire))
      // (29/10) Les questions vont a l'INTERLOCUTEUR (Brice ou Mel, dans son
      // fil), plus « demande a Melanie » : Brice, 28/10, « c'est typiquement
      // les questions que l'agent devrait poser a Mel, pas a moi ».
      if (!partenaire) {
        return {
          erreur: `Partenaire « ${nom} » absent de la base (cockpit_partenaires) : rien n'est proposé. Demande à ton interlocuteur, `
            + `dans ce fil et en une question, ce qui manque : la commission de ${nom} (un taux général en % du dépôt ou un montant fixe `
            + `par client, et depuis quand ; ou seulement la commission de ce dépôt)${type === 'depot_broker' ? ", la date du dépôt et la durée de l'accès si elles ne sont pas dites" : ''}. `
            + `Puis propose d'abord proposer_taux_partenaire (nature ${type === 'depot_broker' ? 'broker' : 'affiliation'} ; sans taux si seule `
            + `la commission de ce dépôt est connue), et ce geste ensuite.`,
        }
      }
      if (type === 'depot_broker' && partenaire.nature !== 'broker') {
        return { erreur: `${partenaire.nom} est une affiliation, pas un broker : utilise proposer_commission_affiliation.` }
      }
      const le = String(p.le)
      // (29/10, cas de Victor Weber) Un depot deja inscrit : rien a proposer.
      if (type === 'depot_broker') {
        const deja = await depotDejaInscrit(partenaire.partenaire_id, le, centimes(p.montant) ?? 0, String(p.email))
        if (deja) return { erreur: `${deja} Dis-le à ton interlocuteur au lieu de proposer une carte.` }
      }
      const choix = await tauxPourDepot(type, p, partenaire.partenaire_id, le)
      if (!choix) {
        // (29/10) L'accord connu (note du partenaire, un accord a paliers) :
        // le modele l'applique sans le redemander.
        const accord = accordNote(partenaire.note)
        if (accord) {
          return {
            erreur: `Pas de taux général pour ${partenaire.nom} au ${libelleJour(le)}, mais son accord est noté : « ${accord} ». `
              + `Ne le redemande pas : calcule la commission de ce dépôt d'après lui, passe-la (commission) et repropose. `
              + `Si l'accord ne permet pas de la calculer pour ce montant, demande seulement ce qui manque.`,
          }
        }
        return {
          erreur: `Aucun accord connu pour ${partenaire.nom} au ${libelleJour(le)}. Demande à ton interlocuteur, dans ce fil et en une question, `
            + `l'accord de ${partenaire.nom} (la règle de commission : un montant fixe par dépôt ou un % du dépôt ; le dépôt minimum et les paliers ; depuis quand), `
            + `ou seulement la commission de ce dépôt (commission). Un accord simple : propose d'abord proposer_taux_partenaire (taux, accord, `
            + `a_partir_du au plus tard le ${le}) ; un accord à paliers : proposer_taux_partenaire sans taux avec accord. Puis ce geste.`,
        }
      }
      const { taux, libelle } = choix
      const nature = type === 'depot_broker' ? 'depot' : 'affiliation'
      const base = p.montant === null || p.montant === undefined ? null : centimes(p.montant)
      const attendue = commissionDuTaux(taux, base)
      if (attendue === null) {
        return { erreur: `Le taux de ${partenaire.nom} est en % : il faut le montant de la vente (montant) pour calculer la commission. Demande-le.` }
      }
      const client = String(p.client ?? p.email ?? 'le client')
      let complement = phraseCommission({ attendue, taux, nature, le, client, moisCourant, libelle })
      const accordConnu = accordNote(partenaire.note)
      if (accordConnu) complement += ` Accord de ${partenaire.nom} : ${accordConnu}.`
      let manque: string | null = null
      let alerte: string | null = null
      if (type === 'depot_broker') {
        const acces = await accesParEmail(String(p.email))
        if (acces) {
          alerte = `Cette adresse a déjà eu un accès broker (jusqu'au ${libelleJour(acces.jusquau)}) : il ne sera pas refait, le dépôt y sera relié.`
          complement += ` ${alerte}`
        } else {
          manque = prerequisAccesBroker()
        }
      }
      return { action: a, complement, manque, alerte }
    }

    if (type === 'marquer_commission') {
      const c = await commissionParId(String(p.commission_id))
      if (!c) return { erreur: 'commission_id introuvable dans cockpit_commissions : relis la table et donne l\'identifiant exact.' }
      if (c.statut !== 'attendue') {
        return { erreur: `Cette commission est déjà ${c.statut === 'recue' ? `reçue (${euros(centimes(c.montant_recu) ?? 0)} le ${libelleJour(c.recue_le ?? '')})` : 'perdue'} : rien à marquer. Une correction se fait dans le cockpit (onglet Revenus).` }
      }
      const enrichie: ActionAgent = { ...a, params: { ...p, qui: p.qui ?? qui(c) } }
      const attendue = centimes(c.commission_attendue) ?? 0
      let complement = `${qui(c)}, ${c.nature === 'depot' ? `dépôt de ${euros(centimes(c.montant_base) ?? 0)}` : 'affiliation'} chez ${c.partenaire} du ${libelleJour(c.le)}, commission attendue ${euros(attendue)}.`
      if (p.etat === 'recue') {
        const recue = centimes(p.montant) ?? 0
        const parts = partsCommission(recue)
        complement += ` Reçue : ${euros(recue)}, part de Mel ${euros(parts.mel)}, part de Brice ${euros(parts.brice)}.`
      }
      return { action: enrichie, complement, manque: null }
    }

    if (type === 'taux_partenaire') {
      const partenaire = await partenaireParId(String(p.partenaire))
      if (!partenaire && !p.nature) {
        return { erreur: `${p.partenaire_nom} est un nouveau partenaire : demande s'il s'agit d'un broker (des dépôts) ou d'une affiliation, puis repropose avec nature.` }
      }
      // (29/10, accords des brokers) La carte dit l'ANCIEN accord (taux en
      // vigueur a la date d'effet, accord note), le nouveau (le resume) et la
      // date d'effet ; en retroactif, les depots touches.
      const aPartirDu = String(p.a_partir_du)
      const nature = (partenaire?.nature ?? p.nature) === 'broker' ? 'depot' : 'affiliation'
      const avant = partenaire
        ? tauxEnVigueur(await tauxDuPartenaire(partenaire.partenaire_id), partenaire.partenaire_id, aPartirDu)
        : null
      // Sans taux : ENREGISTRER un nouveau partenaire, ou noter l'accord a paliers d'un partenaire connu.
      if (p.sans_taux === true) {
        if (partenaire) {
          if (!p.accord) {
            return { erreur: `${partenaire.nom} est déjà enregistré : pour lui poser un taux, il faut taux_pct ou montant_fixe ; pour un accord à paliers, accord (le texte de l'accord) ; la commission d'un seul dépôt passe par proposer_depot_broker (commission).` }
          }
          return {
            action: a,
            complement: `Avant : ${accordAvant(avant, partenaire.note, nature)}.`
              + (avant ? ` Le taux général de ${libelleTaux(avant, nature)} reste en base : chaque dépôt devra porter sa commission (commission), calculée d'après le nouvel accord.` : ''),
            manque: null,
          }
        }
        return {
          action: a,
          complement: `Nouveau partenaire (${p.nature}), sans taux général : chaque dépôt devra porter sa commission (proposer_depot_broker, commission)${p.accord ? ", calculée d'après cet accord" : " tant qu'un taux n'est pas posé"}.`,
          manque: null,
        }
      }
      let complement = partenaire
        ? `Avant : ${accordAvant(avant, partenaire.note, nature)}.`
        : `Nouveau partenaire (${p.nature}).`
      if (p.retroactif === true) {
        if (!partenaire) return { erreur: "retroactif : un nouveau partenaire n'a aucun dépôt inscrit. Repropose sans retroactif." }
        const t = { tauxPct: p.taux_pct === null || p.taux_pct === undefined ? null : Number(p.taux_pct), montantFixe: p.montant_fixe === null || p.montant_fixe === undefined ? null : centimes(p.montant_fixe) }
        complement += `\n${phraseRetroactif(planRetroactif(await commissionsDepuis(partenaire.partenaire_id, aPartirDu), t, aPartirDu), aPartirDu)}`
      }
      return { action: a, complement, manque: null }
    }

    if (type === 'intervenant') {
      const nom = await nomOffre(String(p.offre_id))
      if (!nom) return { erreur: await offreInconnue(String(p.offre_id)) }
      const avant = tarifsEnVigueur(await tarifsDe(String(p.intervenant)), String(p.intervenant), String(p.a_partir_du))
        .find(t => t.offreId === p.offre_id)
      return {
        action: a,
        complement: `Produit : ${nom}. `
          + (avant ? `Avant : ${libelleTarif(avant)} depuis le ${libelleJour(avant.aPartirDu)}.` : `Premier tarif de ${p.intervenant} sur ce produit.`)
          + ' Les lives déjà déclarés gardent le tarif de leur mois.',
        manque: null,
      }
    }

    if (type === 'lives_du_mois') {
      const prepare = await preparerLives(p)
      if ('erreur' in prepare) return { erreur: prepare.erreur }
      const { depense, tarif, avant, nomProduit, payeParDefaut } = prepare
      const params = {
        ...p,
        intervenant: depense.intervenant,
        offre_id: depense.offreId,
        cote: depense.cote,
        payee_par: depense.payeePar,
        prix_unitaire: versEuros(depense.prixUnitaire),
      }
      let complement = `${nomProduit} est côté ${NOM_COTE[depense.cote]}. Tarif : ${libelleTarif(tarif)} depuis le ${libelleJour(tarif.aPartirDu)}.`
      if (avant) {
        complement += ` Le tarif a changé en cours de mois (${libelleTarif(avant)} au 1er) : c'est le dernier qui vaut pour tout le mois.`
      }
      if (payeParDefaut) {
        complement += ` Payée par ${NOM_COTE[depense.payeePar]} par défaut (le côté du produit) : à corriger si c'est l'autre qui le paie.`
      }
      return { action: { ...a, params }, complement, manque: null }
    }

    if (type === 'depense') {
      if (p.rattachement !== 'produit') return { action: a, complement: null, manque: null }
      const nom = await nomOffre(String(p.offre_id))
      if (!nom) return { erreur: `offre_id « ${p.offre_id} » inconnu : cherche l'identifiant dans cockpit_offres, ou rattache la dépense à brice, mel ou commune.` }
      const cote = await coteDuProduit(String(p.offre_id))
      if (!cote) {
        return { erreur: `Je ne sais pas de quel côté est ${nom} (aucune vente Stripe connue) : demande s'il faut la rattacher au côté brice ou mel.` }
      }
      return {
        action: { ...a, params: { ...p, cote } },
        complement: `${nom} est côté ${NOM_COTE[cote]} (d'après ses ventes Stripe).`,
        manque: null,
      }
    }

    // reglement : le solde du mois avant, pour que la carte se lise.
    const solde = await phraseSoldeDuMois(String(p.mois))
    return { action: a, complement: solde ? `Avant ce règlement, ${solde.charAt(0).toLowerCase()}${solde.slice(1)}` : null, manque: null }
  } catch (err) {
    if (relationAbsente(err)) {
      return { erreur: `Les tables de la répartition ne sont pas encore en base (migration ${MIGRATION} à appliquer) : rien ne peut être noté pour l'instant. Dis-le simplement.` }
    }
    if (colonneAbsente(err)) {
      return { erreur: `Le tarif par live n'est pas encore en base (migration ${MIGRATION_LIVES} à appliquer) : rien ne peut être noté pour l'instant. Dis-le simplement.` }
    }
    throw err
  }
}

async function offreInconnue(offreId: string): Promise<string> {
  const offres = await prisma.$queryRaw<{ offre_id: string }[]>`
    select offre_id from public.cockpit_offres order by offre_id limit 40`
  return `offre_id « ${offreId} » inconnu. Les produits : ${offres.map(o => o.offre_id).join(', ')}.`
}

type LivesPrepares =
  | { erreur: string; refus?: boolean }
  | {
    depense: DepenseLives
    tarif: TarifIntervenant
    avant: TarifIntervenant | null
    nomProduit: string
    payeParDefaut: boolean
  }

/**
 * Les lives d'un mois, prets a ecrire : tarif du mois (depenseDesLives, pur),
 * cote du produit (ses ventes Stripe, ou celui de la carte), deja declares.
 * Commun au controle avant la carte et a l'execution apres le clic : chaque
 * refus dit au modele quoi demander (le tarif, le produit, le cote).
 */
async function preparerLives(p: Record<string, unknown>): Promise<LivesPrepares> {
  const intervenant = String(p.intervenant)
  const mois = String(p.mois)
  const offreDemandee = typeof p.offre_id === 'string' && p.offre_id ? p.offre_id : null
  const tarifs = await tarifsDe(intervenant)
  const coteCarte = p.cote === 'brice' || p.cote === 'mel' ? p.cote : null
  const premier = tarifDuMois(tarifs, intervenant, mois, offreDemandee)
  // Le cote connu par les ventes du produit prime : celui de la carte ne sert
  // que quand les ventes ne disent rien (le modele l'a demande).
  const coteProduit = premier.ok ? ((await coteDuProduit(premier.tarif.offreId)) ?? coteCarte) : null
  const r = depenseDesLives(tarifs, {
    intervenant, mois, nombre: Number(p.nombre), offreId: offreDemandee,
    cote: () => coteProduit,
    payeePar: p.payee_par === 'brice' || p.payee_par === 'mel' ? p.payee_par : null,
  })
  if (!r.ok) {
    const fin = libelleJour(bornesMois(mois).fin)
    if (r.raison === 'aucun') {
      const autres = tarifs.length
        ? ` Tarifs connus : ${tarifs.map(t => `${t.offreId} ${libelleTarif(t)} depuis le ${libelleJour(t.aPartirDu)}`).join(', ')}.`
        : ''
      return {
        erreur: `Aucun tarif connu pour ${intervenant}${offreDemandee ? ` sur ${offreDemandee}` : ''} en ${libelleMois(mois)}.${autres} `
          + `Demande combien il touche par live et depuis quand, propose d'abord proposer_intervenant (a_partir_du au plus tard le ${fin}), puis ces lives.`,
      }
    }
    if (r.raison === 'plusieurs') {
      return { erreur: `${intervenant} a un tarif sur plusieurs produits (${r.offres.join(', ')}) : demande pour lequel sont ces lives, puis repropose avec offre_id.` }
    }
    if (r.raison === 'cote_inconnu') {
      const nom = (await nomOffre(r.offres[0])) ?? r.offres[0]
      return { erreur: `Je ne sais pas de quel côté est ${nom} (aucune vente Stripe connue) : demande s'il est côté brice ou mel, puis repropose avec cote.` }
    }
    return { erreur: 'nombre : le nombre de lives faits dans le mois, un entier positif.' }
  }
  const d = r.depense
  const nomProduit = (await nomOffre(d.offreId)) ?? d.offreId
  const deja = await livesDejaDeclares(d.intervenant, d.offreId, mois)
  if (deja.length) {
    const x = deja[0]
    return {
      refus: true,
      erreur: `Les lives de ${d.intervenant} sur ${nomProduit} sont déjà déclarés pour ${libelleMois(mois)} : `
        + `${libelleLives(x.quantite, centimes(x.prix_unitaire) ?? 0)} = ${euros(centimes(x.montant) ?? 0)}, payée par ${NOM_COTE[x.payee_par]}. `
        + 'Pour corriger, retire cette dépense dans le cockpit (onglet Revenus, Dépenses), puis redéclare le bon nombre.',
    }
  }
  return { depense: d, tarif: r.tarif, avant: r.avant, nomProduit, payeParDefaut: !(p.payee_par === 'brice' || p.payee_par === 'mel') }
}

// ---------------------------------------------------------------------------
// Apres le clic : l'execution. Renvoie la phrase de resultat (derniere ligne
// = l'etape humaine suivante), jette RefusAction si une regle bloque, Error
// sur une panne.
// ---------------------------------------------------------------------------

export async function executerActionRepartition(a: ActionAgent, acteur: string): Promise<string> {
  const posePar = uuidDeActeur(acteur)
  if (!posePar) throw new Error("Auteur de l'action illisible : rien n'a été écrit.")
  try {
    return await executer(a, posePar, acteur)
  } catch (err) {
    if (relationAbsente(err)) {
      throw new Error(`Les tables de la répartition ne sont pas encore en base (migration ${MIGRATION} à appliquer) : rien n'a été écrit.`)
    }
    if (colonneAbsente(err)) {
      throw new Error(`Le tarif par live n'est pas encore en base (migration ${MIGRATION_LIVES} à appliquer) : rien n'a été écrit.`)
    }
    throw err
  }
}

async function executer(a: ActionAgent, posePar: string, acteur: string): Promise<string> {
  const p = a.params
  const type = a.type as TypeRepartition
  const { moisCourant } = contexteParis()
  const note = typeof p.note === 'string' ? p.note : null

  if (type === 'depot_broker' || type === 'commission_affiliation') {
    const partenaire = await partenaireParId(String(p.partenaire))
    if (!partenaire) throw new RefusAction(`${p.partenaire_nom} : partenaire inconnu, rien n'a été fait. Donne d'abord son taux.`)
    if (type === 'depot_broker' && partenaire.nature !== 'broker') {
      throw new RefusAction(`${partenaire.nom} est une affiliation, pas un broker : rien n'a été fait.`)
    }
    const le = String(p.le)
    // Le taux en vigueur au jour du depot, ou la commission donnee pour ce
    // depot (29/10), FIGE dans la ligne.
    const choix = await tauxPourDepot(type, p, partenaire.partenaire_id, le)
    if (!choix) throw new RefusAction(`Aucun taux connu pour ${partenaire.nom} au ${libelleJour(le)}, ni commission donnée pour ce dépôt : rien n'a été fait.`)
    const { taux, libelle } = choix
    const nature = type === 'depot_broker' ? 'depot' : 'affiliation'
    const base = p.montant === null || p.montant === undefined ? null : centimes(p.montant)
    const attendue = commissionDuTaux(taux, base)
    if (attendue === null) throw new RefusAction(`Le taux de ${partenaire.nom} est en % : il faut le montant de la vente. Rien n'a été fait.`)
    const client = typeof p.client === 'string' ? p.client : null

    if (type === 'commission_affiliation') {
      const lignes = await prisma.$queryRaw<{ commission_id: string }[]>`
        insert into public.cockpit_commissions
          (partenaire_id, nature, client, le, montant_base, taux_pct, montant_fixe, commission_attendue, note, pose_par, via)
        values (${partenaire.partenaire_id}, 'affiliation', ${client}, ${le}::date,
                ${base === null ? null : versEuros(base)}::numeric, ${taux.tauxPct}::numeric,
                ${taux.montantFixe === null ? null : versEuros(taux.montantFixe)}::numeric,
                ${versEuros(attendue)}::numeric, ${note}, ${posePar}::uuid, 'agent')
        returning commission_id::text as commission_id`
      if (!lignes[0]) throw new Error("La base n'a pas inscrit la commission.")
      return `Affiliation ${partenaire.nom} inscrite pour ${client}, le ${libelleJour(le)}.\n`
        + `${phraseCommission({ attendue, taux, nature, le, client: client ?? 'le client', moisCourant })}\n`
        + `Quand ${partenaire.nom} paie, donne-moi le montant reçu et la date.`
    }

    // Depot broker : l'acces d'abord (6 mois, non renouvelable, acces.ts),
    // puis le depot relie a cet acces.
    const email = String(p.email)
    const quiClient = client ?? email
    // (29/10, cas de Victor Weber) Garde contre un double depot, SANS limite de
    // temps et AVANT tout geste : meme broker, meme jour, meme montant, meme
    // personne (email de la ligne ou de son acces). Avant : 10 minutes
    // seulement, et une carte confirmee plus tard comptait la commission deux fois.
    const deja = await depotDejaInscrit(partenaire.partenaire_id, le, base ?? 0, email)
    if (deja) throw new RefusAction(deja)
    let acces = await accesParEmail(email)
    let issue: 'email_parti' | 'email_pas_parti' | 'existant' | 'abonne'
    let ligneAcces: string
    if (acces) {
      issue = 'existant'
      ligneAcces = `Accès Live Club : ${email} a déjà eu son accès broker (jusqu'au ${libelleJour(acces.jusquau)}), non renouvelable, rien de refait.`
    } else {
      const manque = prerequisAccesBroker()
      if (manque) throw new Error(`${manque} Le dépôt n'est pas inscrit non plus.`)
      // (29/10) La duree demandee (6 mois par defaut), et le vrai broker en source.
      const [r] = await accorderAccesBroker([email], {
        acteur, note: `dépôt ${partenaire.nom}`, mois: typeof p.mois === 'number' ? p.mois : undefined, source: partenaire.partenaire_id,
      })
      if (!r || r.resultat === 'echec') {
        throw new Error(`Accès pas posé, dépôt pas inscrit : ${r?.erreur ?? 'aucune réponse'}. Réessaie dans un instant.`)
      }
      if (r.resultat === 'invalide') throw new RefusAction(`${email} : adresse illisible, rien n'a été fait.`)
      if (r.resultat === 'deja_abonne') {
        issue = 'abonne'
        ligneAcces = `Accès Live Club : ${email} est déjà abonné, aucun accès broker posé (il resterait disponible).`
      } else {
        acces = await accesParEmail(email)
        if (r.resultat === 'deja_accorde' || r.renvoi) {
          issue = 'existant'
          ligneAcces = `Accès Live Club : ${email} avait déjà un accès broker${r.jusquau ? ` (jusqu'au ${libelleJour(r.jusquau)})` : ''}, non renouvelable.`
        } else {
          issue = r.emailEnvoye ? 'email_parti' : 'email_pas_parti'
          ligneAcces = `Accès Live Club : accordé jusqu'au ${libelleJour(r.jusquau ?? '')}, `
            + (r.emailEnvoye ? 'email d\'invitation parti.' : `ATTENTION email PAS parti (${r.erreur ?? '?'}).`)
        }
      }
    }

    // Deux cartes confirmees en meme temps : la garde d'en haut a pu passer
    // pour les deux. Relue juste avant l'ecriture, par l'acces cette fois.
    const doublon = await prisma.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from public.cockpit_commissions
      where partenaire_id = ${partenaire.partenaire_id} and nature = 'depot' and le = ${le}::date
        and montant_base = ${versEuros(base ?? 0)}::numeric
        and (acces_id = ${acces?.acces_id ?? null}::uuid or lower(email) = ${email})`
    if ((doublon[0]?.n ?? 0) > 0) {
      throw new RefusAction(`Ce dépôt de ${euros(base ?? 0)} pour ${quiClient} est déjà inscrit : rien n'a été refait.`)
    }

    try {
      await prisma.$executeRaw`
        insert into public.cockpit_commissions
          (partenaire_id, nature, acces_id, email, client, le, montant_base, taux_pct, montant_fixe,
           commission_attendue, note, pose_par, via)
        values (${partenaire.partenaire_id}, 'depot', ${acces?.acces_id ?? null}::uuid,
                ${acces ? null : email}, ${client}, ${le}::date, ${versEuros(base ?? 0)}::numeric,
                ${taux.tauxPct}::numeric, ${taux.montantFixe === null ? null : versEuros(taux.montantFixe)}::numeric,
                ${versEuros(attendue)}::numeric, ${libelle ? [`[${libelle}]`, note].filter(Boolean).join(' ') : note}, ${posePar}::uuid, 'agent')`
    } catch (err) {
      if (relationAbsente(err)) throw err
      throw new Error(`${ligneAcces}\nMais le dépôt n'est PAS inscrit (${erreurLisible(err)}) : redemande l'inscription du dépôt, l'accès ne sera pas refait.`)
    }

    return `Dépôt de ${euros(base ?? 0)} chez ${partenaire.nom} inscrit pour ${client ? `${client} (${email})` : email}, le ${libelleJour(le)}.\n`
      + `${phraseCommission({ attendue, taux, nature, le, client: quiClient, moisCourant, libelle })}\n`
      + `${ligneAcces}\n`
      + etapeApresDepot({ acces: issue, qui: quiClient, partenaire: partenaire.nom, bot: nomBot() })
  }

  if (type === 'marquer_commission') {
    const id = String(p.commission_id)
    const c = await commissionParId(id)
    if (!c) throw new RefusAction('Commission introuvable : rien n\'a été fait.')
    const etat = String(p.etat) as 'lots_faits' | 'recue' | 'perdue'
    const le = String(p.le)
    let n: number
    if (etat === 'lots_faits') {
      n = await prisma.$executeRaw`
        update public.cockpit_commissions
        set lots_faits_le = ${le}::date, maj_par = ${posePar}::uuid, note = coalesce(${note}, note)
        where commission_id = ${id}::uuid and statut = 'attendue'`
    } else if (etat === 'recue') {
      n = await prisma.$executeRaw`
        update public.cockpit_commissions
        set statut = 'recue', montant_recu = ${Number(p.montant)}::numeric, recue_le = ${le}::date,
            encaisse_par = ${String(p.encaisse_par ?? 'mel')}, maj_par = ${posePar}::uuid, note = coalesce(${note}, note)
        where commission_id = ${id}::uuid and statut = 'attendue'`
    } else {
      n = await prisma.$executeRaw`
        update public.cockpit_commissions
        set statut = 'perdue', maj_par = ${posePar}::uuid, note = coalesce(${note}, note)
        where commission_id = ${id}::uuid and statut = 'attendue'`
    }
    if (n === 0) throw new RefusAction(`La commission de ${qui(c)} n'est plus attendue (déjà ${c.statut}) : rien n'a été changé.`)

    if (etat === 'lots_faits') {
      const prevu = moisPrevuCommission({ statut: 'attendue', le: c.le, lotsFaitsLe: le }, moisCourant) ?? moisCourant
      return `Lots faits le ${libelleJour(le)} pour ${qui(c)} (${c.partenaire}) : commission de ${euros(centimes(c.commission_attendue) ?? 0)} `
        + `attendue fin ${libelleMois(prevu)}.\n${etapeApresMarquage('lots_faits', c.partenaire)}`
    }
    if (etat === 'recue') {
      const recue = centimes(p.montant) ?? 0
      const parts = partsCommission(recue)
      const ecart = recue - (centimes(c.commission_attendue) ?? 0)
      return `Commission de ${qui(c)} (${c.partenaire}) reçue : ${euros(recue)} le ${libelleJour(le)}, `
        + `encaissée par ${NOM_COTE[(p.encaisse_par as Cote) ?? 'mel']}`
        + (ecart ? ` (attendue ${euros(centimes(c.commission_attendue) ?? 0)}, écart ${euros(ecart)})` : '')
        + `. Part de Mel : ${euros(parts.mel)}, part de Brice : ${euros(parts.brice)}.\n`
        + etapeApresMarquage('recue', c.partenaire, moisDe(le))
    }
    return `Commission de ${qui(c)} (${c.partenaire}) marquée perdue.\n${etapeApresMarquage('perdue', c.partenaire)}`
  }

  if (type === 'taux_partenaire') {
    const id = String(p.partenaire)
    const nomSaisi = String(p.partenaire_nom)
    const aPartirDu = String(p.a_partir_du)
    const sansTaux = p.sans_taux === true
    // (29/10, accords des brokers) L'accord en clair, date, note sur le
    // partenaire (le texte courant) et sur la ligne de taux (l'historique).
    const accord = typeof p.accord === 'string' && p.accord.trim() ? p.accord.trim() : null
    const noteAccord = accord ? `${PREFIXE_NOTE_ACCORD}${libelleJour(aPartirDu)} : ${accord}`.slice(0, 500) : null
    const retroactif = p.retroactif === true && !sansTaux
    const t = {
      tauxPct: p.taux_pct === null || p.taux_pct === undefined ? null : Number(p.taux_pct),
      montantFixe: p.montant_fixe === null || p.montant_fixe === undefined ? null : centimes(p.montant_fixe),
    }
    const issue = await prisma.$transaction(async (tx) => {
      const existant = await tx.$queryRaw<LignePartenaire[]>`
        select partenaire_id, nom, nature, note from public.cockpit_partenaires where partenaire_id = ${id} for update`
      let partenaire = existant[0]
      const noteAvant = partenaire?.note ?? null
      // (29/10) Sans taux ni accord : l'enregistrement d'un NOUVEAU partenaire seulement.
      if (partenaire && sansTaux && !noteAccord) {
        throw new RefusAction(`${partenaire.nom} est déjà enregistré : rien n'a été fait. Pour son taux, il faut un pourcentage ou un montant fixe ; pour un accord à paliers, son texte.`)
      }
      if (!partenaire) {
        const nature = p.nature === 'broker' ? 'broker' : p.nature === 'affiliation' ? 'affiliation' : null
        if (!nature) {
          throw new RefusAction(`${nomSaisi} est un nouveau partenaire : précise s'il s'agit d'un broker ou d'une affiliation. Rien n'a été fait.`)
        }
        const notePartenaire = noteAccord ?? (sansTaux ? note : null)
        await tx.$executeRaw`
          insert into public.cockpit_partenaires (partenaire_id, nom, nature, note, pose_par, via)
          values (${id}, ${nomSaisi}, ${nature}, ${notePartenaire}, ${posePar}::uuid, 'agent')
          on conflict (partenaire_id) do nothing`
        partenaire = { partenaire_id: id, nom: nomSaisi, nature, note: notePartenaire }
      } else if (noteAccord) {
        // Un partenaire connu : son accord courant change (l'ancien est dans la carte et ce resultat).
        await tx.$executeRaw`update public.cockpit_partenaires set note = ${noteAccord} where partenaire_id = ${id}`
      }
      if (sansTaux) return { partenaire, avant: null, nouveau: existant.length === 0, noteAvant, retro: null }
      const avantLignes = await tx.$queryRaw<LigneTaux[]>`
        select taux_id::text as taux_id, partenaire_id, a_partir_du::text as a_partir_du,
               taux_pct::float8 as taux_pct, montant_fixe::float8 as montant_fixe, note, pose_le
        from public.cockpit_partenaire_taux where partenaire_id = ${id}`
      const avant = tauxEnVigueur(avantLignes.map(versTaux), id, aPartirDu)
      await tx.$executeRaw`
        insert into public.cockpit_partenaire_taux (partenaire_id, a_partir_du, taux_pct, montant_fixe, note, pose_par, via)
        values (${id}, ${aPartirDu}::date, ${p.taux_pct === null ? null : Number(p.taux_pct)}::numeric,
                ${p.montant_fixe === null ? null : Number(p.montant_fixe)}::numeric, ${noteAccord ?? note}, ${posePar}::uuid, 'agent')`
      // (29/10) Retroactif, dit explicitement : les commissions ENCORE
      // ATTENDUES depuis la date d'effet prennent le nouveau taux (fige dans
      // la ligne, comme a l'inscription). Recues, perdues et commissions
      // propres a un depot ne bougent jamais.
      let retro: ReturnType<typeof planRetroactif> | null = null
      if (retroactif && existant.length > 0) {
        const lignes = await tx.$queryRaw<{
          commission_id: string; qui: string | null; le: string; montant_base: number | null; commission_attendue: number; statut: string; note: string | null
        }[]>`
          select c.commission_id::text as commission_id, coalesce(c.client, c.email, a.email, 'client') as qui, c.le::text as le,
                 c.montant_base::float8 as montant_base, c.commission_attendue::float8 as commission_attendue, c.statut, c.note
          from public.cockpit_commissions c
          left join public.cockpit_liveclub_acces a on a.acces_id = c.acces_id
          where c.partenaire_id = ${id} and c.le >= ${aPartirDu}::date
          order by c.le, c.pose_le
          for update of c`
        retro = planRetroactif(lignes.map(l => ({
          commissionId: l.commission_id, qui: l.qui ?? 'client', le: l.le,
          base: l.montant_base === null ? null : centimes(l.montant_base), attendue: centimes(l.commission_attendue) ?? 0,
          statut: l.statut === 'recue' ? 'recue' : l.statut === 'perdue' ? 'perdue' : 'attendue', note: l.note,
        })), t, aPartirDu)
        const marque = `[taux revu le ${libelleJour(jourParis(new Date()))}, rétroactif]`
        for (const c of retro.touchees) {
          await tx.$executeRaw`
            update public.cockpit_commissions
            set taux_pct = ${t.tauxPct}::numeric,
                montant_fixe = ${t.montantFixe === null ? null : versEuros(t.montantFixe)}::numeric,
                commission_attendue = ${versEuros(c.apres)}::numeric,
                note = left(trim(coalesce(note, '') || ' ' || ${marque}), 500)
            where commission_id = ${c.commissionId}::uuid and statut = 'attendue'`
        }
      }
      return { partenaire, avant, nouveau: existant.length === 0, noteAvant, retro }
    })
    const nature = issue.partenaire.nature === 'broker' ? 'depot' : 'affiliation'
    const ancien = issue.nouveau ? null : accordAvant(issue.avant, issue.noteAvant, nature)
    if (sansTaux) {
      if (noteAccord) {
        return `Accord de ${issue.partenaire.nom} noté à partir du ${libelleJour(aPartirDu)} : ${accord}`
          + (issue.nouveau ? ` (nouveau partenaire, ${issue.partenaire.nature}).` : ` (avant : ${ancien}).`)
          + `\nEnsuite : chaque ${nature === 'depot' ? 'dépôt' : 'commission'} chez ${issue.partenaire.nom} porte sa commission, calculée d'après cet accord ; `
          + `les dépôts déjà inscrits gardent la leur. S'il y a un dépôt en cours, réponds « suite » pour sa carte.`
      }
      return `${issue.partenaire.nom} est enregistré (${issue.partenaire.nature}), sans taux général pour l'instant.\n`
        + `Ensuite : chaque ${nature === 'depot' ? 'dépôt' : 'commission'} chez ${issue.partenaire.nom} porte sa commission, `
        + `jusqu'à ce qu'un taux soit posé ; s'il y a un dépôt en cours, réponds « suite » pour sa carte.`
    }
    return `Taux de ${issue.partenaire.nom} : ${libelleTaux(t, nature)} à partir du ${libelleJour(aPartirDu)}`
      + (issue.nouveau ? ` (nouveau partenaire, ${issue.partenaire.nature}).` : ` (avant : ${ancien}).`)
      + (accord ? ` Accord noté : ${accord}.` : '')
      + (issue.retro
        ? `\n${phraseRetroactif(issue.retro, aPartirDu).replace('Dépôts touchés', 'Commissions revues')}\n`
        : ` Les dépôts déjà inscrits gardent le taux de leur date.\n`)
      + `Rien à faire : les prochains ${nature === 'depot' ? 'dépôts' : 'clients'} prendront ce taux.`
  }

  if (type === 'intervenant') {
    const offreId = String(p.offre_id)
    const nom = await nomOffre(offreId)
    if (!nom) throw new RefusAction(`offre_id « ${offreId} » inconnu : rien n'a été fait.`)
    const intervenant = String(p.intervenant)
    const aPartirDu = String(p.a_partir_du)
    const unite = (p.unite as UniteIntervenant | undefined) ?? 'live'
    const montant = centimes(p.montant_par_live) ?? 0
    if (montant <= 0) throw new RefusAction('Le tarif par live doit être positif : rien n\'a été fait.')
    const avant = tarifsEnVigueur(await tarifsDe(intervenant), intervenant, aPartirDu).find(t => t.offreId === offreId)
    await prisma.$executeRaw`
      insert into public.cockpit_intervenants (intervenant, offre_id, montant_par_unite, unite, a_partir_du, note, pose_par, via)
      values (${intervenant}, ${offreId}, ${numeric(montant)}::numeric, ${unite}, ${aPartirDu}::date,
              ${note}, ${posePar}::uuid, 'agent')`
    return `Tarif de ${intervenant} sur ${nom} : ${libelleTarif({ montantParUnite: montant, unite })} à partir du ${libelleJour(aPartirDu)}`
      + (avant ? ` (avant : ${libelleTarif(avant)}).` : ' (premier tarif).')
      + ` Les lives déjà déclarés gardent le tarif de leur mois.\n`
      + `Rien à faire maintenant : à la fin de chaque mois, dis-moi combien de lives ${intervenant} a faits.`
  }

  if (type === 'lives_du_mois') {
    const prepare = await preparerLives(p)
    if ('erreur' in prepare) {
      if (prepare.refus) throw new RefusAction(`${prepare.erreur} Rien n'a été fait.`)
      // Le reste du message parle au modele : a l'humain, la premiere phrase suffit.
      const premiere = prepare.erreur.split(/(?<=\.)\s/)[0]
      throw new RefusAction(`${premiere} Rien n'a été fait, redemande la carte.`)
    }
    const d = prepare.depense
    // La carte a montre un tarif : s'il a change depuis, on n'ecrit pas un
    // autre montant que celui qui a ete confirme.
    const prixCarte = p.prix_unitaire === null || p.prix_unitaire === undefined ? null : centimes(p.prix_unitaire)
    if (prixCarte !== null && prixCarte !== d.prixUnitaire) {
      throw new RefusAction(`Le tarif de ${d.intervenant} a changé depuis la carte (${euros(prixCarte)} sur la carte, `
        + `${euros(d.prixUnitaire)} maintenant) : rien n'a été fait, redemande la carte.`)
    }
    const mois = d.mois
    try {
      await prisma.$executeRaw`
        insert into public.cockpit_depenses
          (libelle, montant, mois, payee_par, cote, offre_id, intervenant, quantite, prix_unitaire, note, pose_par, via)
        values (${d.libelle}, ${numeric(d.montant)}::numeric, ${mois}, ${d.payeePar}, ${d.cote}, ${d.offreId},
                ${d.intervenant}, ${d.quantite}::int, ${numeric(d.prixUnitaire)}::numeric, ${note}, ${posePar}::uuid, 'agent')`
    } catch (err) {
      // L'index unique (une declaration vivante par intervenant, produit et mois).
      if (/23505|unique/i.test(texteErreur(err))) {
        throw new RefusAction(`Les lives de ${d.intervenant} pour ${libelleMois(mois)} viennent d'être déclarés : rien n'a été refait.`)
      }
      throw err
    }
    const solde = await phraseSoldeDuMois(mois)
    return `Dépense ajoutée à ${libelleMois(mois)} : ${d.libelle}, ${libelleLives(d.quantite, d.prixUnitaire)} = ${euros(d.montant)}, `
      + `produit ${prepare.nomProduit} (côté ${NOM_COTE[d.cote]}), payée par ${NOM_COTE[d.payeePar]}, déduite de ce côté avant le 70/30.`
      + (solde ? `\n${solde}` : '')
      + `\nRien à faire : elle compte dans la répartition ${deMois(mois)}.`
  }

  if (type === 'depense') {
    let cote = p.cote === null || p.cote === undefined ? null : (p.cote as Cote)
    const offreId = typeof p.offre_id === 'string' ? p.offre_id : null
    if (p.rattachement === 'produit') {
      cote = cote ?? (offreId ? await coteDuProduit(offreId) : null)
      if (!cote) throw new RefusAction('Je ne sais pas de quel côté est ce produit : rattache la dépense à brice ou mel. Rien n\'a été fait.')
    }
    const mois = String(p.mois)
    await prisma.$executeRaw`
      insert into public.cockpit_depenses (libelle, montant, mois, payee_par, cote, offre_id, part_brice_pct, note, pose_par, via)
      values (${String(p.libelle)}, ${Number(p.montant)}::numeric, ${mois}, ${String(p.payee_par)}, ${cote},
              ${offreId}, ${p.part_brice_pct === null || p.part_brice_pct === undefined ? null : Number(p.part_brice_pct)}::numeric,
              ${note}, ${posePar}::uuid, 'agent')`
    const rattache = cote
      ? (offreId ? `produit ${offreId}, côté ${NOM_COTE[cote]}` : `côté ${NOM_COTE[cote]}`)
      : `commune, ${p.part_brice_pct === null || p.part_brice_pct === undefined ? '50/50' : `${pourcent(Number(p.part_brice_pct))} pour Brice`}`
    const solde = await phraseSoldeDuMois(mois)
    return `Dépense ajoutée à ${libelleMois(mois)} : ${p.libelle}, ${euros(centimes(p.montant) ?? 0)}, payée par ${NOM_COTE[p.payee_par as Cote]}, ${rattache}.`
      + (solde ? `\n${solde}` : '')
      + `\nRien à faire : elle compte dans la répartition ${deMois(mois)}.`
  }

  // reglement : une dette, une avance ou le reglement du mois (regle 8).
  const mois = String(p.mois)
  const nature = (p.nature as NatureReglement | undefined) ?? 'reglement'
  try {
    await prisma.$executeRaw`
      insert into public.cockpit_reglements (nature, de, a, montant, regle_le, mois, note, pose_par, via)
      values (${nature}, ${String(p.de)}, ${String(p.a)}, ${Number(p.montant)}::numeric, ${String(p.le)}::date, ${mois},
              ${note}, ${posePar}::uuid, 'agent')`
  } catch (err) {
    if (!colonneAbsente(err)) throw err
    // Base d'avant la colonne nature (20261018093000) : une ligne y vaut une
    // avance. Le reste ne peut pas etre note sans fausser le solde.
    if (nature !== 'avance') {
      throw new RefusAction(`La nature des règlements n'est pas encore en base (migration ${MIGRATION_NATURE} à appliquer) : rien n'est noté.`)
    }
    await prisma.$executeRaw`
      insert into public.cockpit_reglements (de, a, montant, regle_le, mois, note, pose_par, via)
      values (${String(p.de)}, ${String(p.a)}, ${Number(p.montant)}::numeric, ${String(p.le)}::date, ${mois},
              ${note}, ${posePar}::uuid, 'agent')`
  }
  const solde = await phraseSoldeDuMois(mois)
  const phrase = phraseReglement({
    nature, de: p.de as Cote, a: p.a as Cote, montant: centimes(p.montant) ?? 0, regleLe: String(p.le), mois, note,
  })
  return `Noté : ${phrase}.`
    + (solde ? `\n${solde}` : '')
    + '\nRien à faire.'
}
