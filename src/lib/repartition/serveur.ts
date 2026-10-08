// La repartition Brice / Melanie cote SERVEUR (08/10/2026) : lecture des six
// tables et des paiements, calcul par le module pur (./pur.ts), et les gestes
// de l'agent du Cockpit (controle avant la carte, execution apres le clic).
//
// Trois appelants :
// - l'outil de lecture repartition_du_mois de l'agent (agent-cockpit.ts) ;
// - la route /api/cockpit/repartition, qui sert l'onglet Revenus du cockpit
//   (le calcul ne vit qu'ici : le cockpit affiche, il ne recalcule pas) ;
// - executerAction (stripe-actions.ts), qui delegue ici les sept actions de
//   la repartition apres la confirmation humaine.
//
// Tables absentes (migration 20261008170000 pas appliquee) : la lecture rend
// des listes vides et le dit (tables_absentes), l'ecriture refuse en clair.

import { prisma } from '@/lib/db'
import { RefusAction, type ActionAgent } from '@/lib/stripe-actions'
import { accorderAccesBroker, prerequisAccesBroker } from '@/lib/liveclub/acces'
import { nomBot } from '@/lib/liveclub/config'
import { relationAbsente, uuidDeActeur } from '@/lib/liveclub/pur'
import {
  type Commission, type Cote, type Depense, type PartIntervenant, type Reglement, type Repartition,
  type TauxPartenaire, type TypeRepartition, type Vente,
  NOM_COTE, PART_APPORTEUR_PCT, PART_BRICE_COMMUNE_PCT, bornesMois, centimes, commissionDuTaux, coteDuCompte, deMois, etapeApresDepot, etapeApresMarquage,
  euros, glissementCommission, intervenantsEnVigueur, jourDuPaiement, jourParis, libelleJour, libelleMois,
  libelleTaux, moisDe, moisParis, moisPrevuCommission, moisValide, partsCommission, pourcent,
  repartitionDuMois, tauxEnVigueur, venteDePaiement, versEuros,
} from '@/lib/repartition/pur'

const MIGRATION = '20261008170000_cockpit_repartition.sql'

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
  pourcentage: number
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
  note: string | null
  via: string
  pose_le: Date
}

type LigneReglement = {
  reglement_id: string
  de: Cote
  a: Cote
  montant: number
  regle_le: string
  mois: string
  note: string | null
  via: string
  pose_le: Date
}

/** Une lecture, ou une liste vide si la table n'existe pas encore (notee dans `absentes`). */
async function lireOuVide<T>(table: string, absentes: Set<string>, lire: () => Promise<T[]>): Promise<T[]> {
  try {
    return await lire()
  } catch (err) {
    if (relationAbsente(err)) {
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
    select part_id::text as part_id, intervenant, offre_id, pourcentage::float8 as pourcentage,
           a_partir_du::text as a_partir_du, note, pose_le
    from public.cockpit_intervenants
    order by offre_id, a_partir_du desc, pose_le desc`
}

function lireDepenses(mois: string): Promise<LigneDepense[]> {
  return prisma.$queryRaw<LigneDepense[]>`
    select depense_id::text as depense_id, libelle, montant::float8 as montant, mois, payee_par, cote,
           offre_id, part_brice_pct::float8 as part_brice_pct, note, via, pose_le
    from public.cockpit_depenses
    where mois = ${mois} and retire_le is null
    order by pose_le`
}

function lireReglements(mois: string): Promise<LigneReglement[]> {
  return prisma.$queryRaw<LigneReglement[]>`
    select reglement_id::text as reglement_id, de, a, montant::float8 as montant, regle_le::text as regle_le,
           mois, note, via, pose_le
    from public.cockpit_reglements
    where mois = ${mois} and retire_le is null
    order by regle_le, pose_le`
}

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

function versPart(i: LigneIntervenant): PartIntervenant {
  return { intervenant: i.intervenant, offreId: i.offre_id, pourcentage: i.pourcentage, aPartirDu: i.a_partir_du, poseLe: iso(i.pose_le) }
}

/** Tout ce qu'il faut pour un mois, et le calcul. */
async function chargerMois(mois: string, moisCourant: string) {
  const absentes = new Set<string>()
  const [paiements, commissions, intervenants, depenses, reglements, nomsOffres] = await Promise.all([
    lirePaiements(mois),
    lireOuVide('cockpit_commissions', absentes, lireCommissions),
    lireOuVide('cockpit_intervenants', absentes, lireIntervenants),
    lireOuVide('cockpit_depenses', absentes, () => lireDepenses(mois)),
    lireOuVide('cockpit_reglements', absentes, () => lireReglements(mois)),
    lireNomsOffres().catch(() => ({} as Record<string, string>)),
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
    intervenants: intervenants.map(versPart),
    commissions: commissions.map(versCommission),
    depenses: depenses.map((d): Depense => ({
      id: d.depense_id, libelle: d.libelle, montant: centimes(d.montant) ?? 0, mois: d.mois,
      payeePar: d.payee_par, cote: d.cote, offreId: d.offre_id, partBricePct: d.part_brice_pct,
    })),
    reglements: reglements.map((r): Reglement => ({
      id: r.reglement_id, de: r.de, a: r.a, montant: centimes(r.montant) ?? 0, regleLe: r.regle_le, mois: r.mois,
    })),
    horsStripe,
    nomsOffres,
  })
  return { repartition, commissions, intervenants, depenses, reglements, nomsOffres, absentes: [...absentes] }
}

const paire = (r: Record<Cote, number>) => ({ brice: versEuros(r.brice), mel: versEuros(r.mel) })

/** La repartition en euros (nombres a 2 decimales), pour le JSON de l'agent et du cockpit. */
export function repartitionEnEuros(r: Repartition) {
  const cote = (c: Cote) => {
    const d = r.cotes[c]
    return {
      nb_ventes: d.nbVentes, encaisse: versEuros(d.encaisse), rembourse: versEuros(d.rembourse),
      frais: versEuros(d.frais), frais_inconnus: d.fraisInconnus, intervenants: versEuros(d.intervenants),
      net_ventes: versEuros(d.netVentes), commissions: versEuros(d.commissions), depenses: versEuros(d.depenses),
      base: versEuros(d.base), parts: paire(d.parts),
    }
  }
  return {
    mois: r.mois,
    libelle_mois: libelleMois(r.mois),
    phrase: r.phrase,
    solde_brice: versEuros(r.solde),
    solde_avant_reglements: versEuros(r.soldeAvantReglements),
    formule: "Solde de Brice = somme de ses parts - (ce qu'il a eu en main - ce qu'il a payé). Positif : Mel lui doit ce montant. Négatif : il doit à Mel. Les règlements du mois s'en déduisent.",
    hypothese: "Celui qui encaisse une vente paie lui-même l'intervenant du produit : sa part est déduite de ce que l'encaisseur a eu en main.",
    // Les regles en clair, pour l'ecran du cockpit : son bundle est servi sans
    // session, il n'embarque donc aucune regle de partage (cockpit/CLAUDE.md).
    regles: {
      partage: `Celui qui apporte la vente prend ${PART_APPORTEUR_PCT} %, l'autre ${100 - PART_APPORTEUR_PCT} %.`,
      depense: `Une dépense commune se partage ${PART_BRICE_COMMUNE_PCT}/${100 - PART_BRICE_COMMUNE_PCT}, sauf part donnée. `
        + 'Rattachée à un côté ou à un produit, elle est déduite de ce côté avant son partage.',
      commission: "Une commission compte dans le mois où elle est reçue. Tant qu'elle ne l'est pas, elle glisse de mois en mois.",
      intervenant: "La part d'un intervenant se prend sur l'encaissé du produit, avant le partage. Un produit sans intervenant se partage directement.",
    },
    part_apporteur_pct: PART_APPORTEUR_PCT,
    parts: paire(r.parts),
    en_main: paire(r.enMain),
    reglements: { mel_vers_brice: versEuros(r.reglements.melVersBrice), brice_vers_mel: versEuros(r.reglements.briceVersMel) },
    cotes: { mel: cote('mel'), brice: cote('brice') },
    communes: { total: versEuros(r.communes.total), parts: paire(r.communes.parts) },
    intervenants: r.intervenants.map(i => ({
      intervenant: i.intervenant, offre_id: i.offreId, paye_par: i.payePar, montant: versEuros(i.montant),
    })),
    commissions: {
      recues: { nb: r.commissions.recues.nb, montant: versEuros(r.commissions.recues.montant) },
      attendues: {
        nb: r.commissions.attendues.nb, montant: versEuros(r.commissions.attendues.montant),
        glissees: r.commissions.attendues.glissees,
      },
    },
    lignes: r.lignes.map(l => ({
      genre: l.genre, libelle: l.libelle, cote: l.cote, detail: l.detail ?? null,
      en_main: paire(l.enMain), parts: paire(l.parts),
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
      tables_absentes: m.absentes,
      ...(m.absentes.length ? { note_tables: `Tables pas encore en base (migration ${MIGRATION} à appliquer) : comptées vides.` } : {}),
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
      const cle = i.intervenant.trim().toLowerCase()
      const dernier = m.intervenants.find(x => x.offre_id === i.offre_id
        && x.intervenant.trim().toLowerCase() === cle && x.a_partir_du <= aujourdhui)
      return {
        part_id: i.part_id, intervenant: i.intervenant, offre_id: i.offre_id,
        offre: m.nomsOffres[i.offre_id] ?? i.offre_id, pourcentage: i.pourcentage, a_partir_du: i.a_partir_du,
        note: i.note,
        en_vigueur: dernier?.part_id === i.part_id,
        a_venir: i.a_partir_du > aujourdhui,
      }
    }),
    depenses: m.depenses.map(d => ({
      depense_id: d.depense_id, libelle: d.libelle, montant: d.montant, mois: d.mois, payee_par: d.payee_par,
      cote: d.cote, offre_id: d.offre_id, part_brice_pct: d.part_brice_pct, note: d.note, via: d.via,
    })),
    reglements: m.reglements.map(r => ({
      reglement_id: r.reglement_id, de: r.de, a: r.a, montant: r.montant, regle_le: r.regle_le, mois: r.mois,
      note: r.note, via: r.via,
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
}): string {
  if (o.attendue === null) return `Taux de ${libelleTaux(o.taux, o.nature)} : montant inconnu sans la base.`
  const prevu = moisPrevuCommission({ statut: 'attendue', le: o.le, lotsFaitsLe: null }, o.moisCourant) ?? o.moisCourant
  const parts = partsCommission(o.attendue)
  return `Commission attendue : ${euros(o.attendue)} (${libelleTaux(o.taux, o.nature)}), prévue fin ${libelleMois(prevu)}`
    + (o.nature === 'depot' ? ` si ${o.client} fait ses lots d'ici là, sinon elle glisse au mois suivant.` : '.')
    + ` Part de Mel : ${euros(parts.mel)}, part de Brice : ${euros(parts.brice)} (70/30, avant dépenses).`
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
  | { action: ActionAgent; complement: string | null; manque: string | null }

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
      if (!partenaire) {
        return {
          erreur: `Partenaire « ${nom} » inconnu : aucun taux enregistré. Demande à Mélanie le taux de ${nom} `
            + `(en % du dépôt, ou un montant fixe par client) et depuis quand, propose d'abord proposer_taux_partenaire `
            + `(nature ${type === 'depot_broker' ? 'broker' : 'affiliation'}), puis ce geste.`,
        }
      }
      if (type === 'depot_broker' && partenaire.nature !== 'broker') {
        return { erreur: `${partenaire.nom} est une affiliation, pas un broker : utilise proposer_commission_affiliation.` }
      }
      const le = String(p.le)
      const taux = tauxEnVigueur(await tauxDuPartenaire(partenaire.partenaire_id), partenaire.partenaire_id, le)
      if (!taux) {
        return {
          erreur: `Aucun taux connu pour ${partenaire.nom} au ${libelleJour(le)}. Demande à Mélanie son taux à cette date `
            + `(en % du dépôt, ou un montant fixe par client), propose d'abord proposer_taux_partenaire (a_partir_du au plus tard le ${le}), puis ce geste.`,
        }
      }
      const nature = type === 'depot_broker' ? 'depot' : 'affiliation'
      const base = p.montant === null || p.montant === undefined ? null : centimes(p.montant)
      const attendue = commissionDuTaux(taux, base)
      if (attendue === null) {
        return { erreur: `Le taux de ${partenaire.nom} est en % : il faut le montant de la vente (montant) pour calculer la commission. Demande-le.` }
      }
      const client = String(p.client ?? p.email ?? 'le client')
      let complement = phraseCommission({ attendue, taux, nature, le, client, moisCourant })
      let manque: string | null = null
      if (type === 'depot_broker') {
        const acces = await accesParEmail(String(p.email))
        if (acces) {
          complement += ` Cette adresse a déjà eu un accès broker (jusqu'au ${libelleJour(acces.jusquau)}) : il ne sera pas refait, le dépôt y sera relié.`
        } else {
          manque = prerequisAccesBroker()
        }
      }
      return { action: a, complement, manque }
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
      const avant = partenaire
        ? tauxEnVigueur(await tauxDuPartenaire(partenaire.partenaire_id), partenaire.partenaire_id, String(p.a_partir_du))
        : null
      const nature = (partenaire?.nature ?? p.nature) === 'broker' ? 'depot' : 'affiliation'
      return {
        action: a,
        complement: partenaire
          ? (avant ? `Avant : ${libelleTaux(avant, nature)} depuis le ${libelleJour(avant.aPartirDu)}.` : `Premier taux de ${partenaire.nom}.`)
          : `Nouveau partenaire (${p.nature}).`,
        manque: null,
      }
    }

    if (type === 'intervenant') {
      const nom = await nomOffre(String(p.offre_id))
      if (!nom) {
        const offres = await prisma.$queryRaw<{ offre_id: string }[]>`
          select offre_id from public.cockpit_offres order by offre_id limit 40`
        return { erreur: `offre_id « ${p.offre_id} » inconnu. Les produits : ${offres.map(o => o.offre_id).join(', ')}.` }
      }
      const verdict = await verifierTotalIntervenants(String(p.offre_id), String(p.intervenant), Number(p.pourcentage), String(p.a_partir_du))
      if (typeof verdict === 'string') return { erreur: verdict }
      return { action: a, complement: `Produit : ${nom}. ${verdict.texte}`, manque: null }
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
    throw err
  }
}

/**
 * Les intervenants d'un produit a une date si cette ligne entrait en
 * vigueur : refus si le total depasse 100 %, sinon une phrase.
 */
async function verifierTotalIntervenants(offreId: string, intervenant: string, pct: number, aPartirDu: string): Promise<string | { texte: string }> {
  const lignes = (await lireIntervenants()).map(versPart).filter(l => l.offreId === offreId)
  const avant = intervenantsEnVigueur(lignes, offreId, aPartirDu)
  const apres = intervenantsEnVigueur(
    [...lignes, { intervenant, offreId, pourcentage: pct, aPartirDu, poseLe: '9999-12-31' }], offreId, aPartirDu)
  const total = apres.reduce((s, i) => s + i.pourcentage, 0)
  if (total > 100) {
    return `Avec ce changement, les intervenants de ${offreId} prendraient ${pourcent(total)} : plus de 100 %. Rien n'est proposé, vérifie les parts.`
  }
  const cle = intervenant.trim().toLowerCase()
  const ancien = avant.find(i => i.intervenant.trim().toLowerCase() === cle)
  const liste = apres.length ? apres.map(i => `${i.intervenant} ${pourcent(i.pourcentage)}`).join(', ') : 'aucun'
  return { texte: `Avant : ${ancien ? pourcent(ancien.pourcentage) : 'rien'}. Intervenants après ce changement : ${liste}.` }
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
    // Le taux en vigueur au jour du depot, FIGE dans la ligne.
    const taux = tauxEnVigueur(await tauxDuPartenaire(partenaire.partenaire_id), partenaire.partenaire_id, le)
    if (!taux) throw new RefusAction(`Aucun taux connu pour ${partenaire.nom} au ${libelleJour(le)} : rien n'a été fait. Donne d'abord son taux.`)
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
    let acces = await accesParEmail(email)
    let issue: 'email_parti' | 'email_pas_parti' | 'existant' | 'abonne'
    let ligneAcces: string
    if (acces) {
      issue = 'existant'
      ligneAcces = `Accès Live Club : ${email} a déjà eu son accès broker (jusqu'au ${libelleJour(acces.jusquau)}), non renouvelable, rien de refait.`
    } else {
      const manque = prerequisAccesBroker()
      if (manque) throw new Error(`${manque} Le dépôt n'est pas inscrit non plus.`)
      const [r] = await accorderAccesBroker([email], { acteur, note: `dépôt ${partenaire.nom}` })
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

    // Garde contre un double geste (deux cartes pour le meme depot) : meme
    // personne, meme partenaire, meme jour, meme montant, il y a moins de 10 minutes.
    const doublon = await prisma.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from public.cockpit_commissions
      where partenaire_id = ${partenaire.partenaire_id} and nature = 'depot' and le = ${le}::date
        and montant_base = ${versEuros(base ?? 0)}::numeric
        and (acces_id = ${acces?.acces_id ?? null}::uuid or lower(email) = ${email})
        and pose_le > now() - interval '10 minutes'`
    if ((doublon[0]?.n ?? 0) > 0) {
      throw new RefusAction(`Ce dépôt de ${euros(base ?? 0)} pour ${quiClient} vient déjà d'être inscrit : rien n'a été refait.`)
    }

    try {
      await prisma.$executeRaw`
        insert into public.cockpit_commissions
          (partenaire_id, nature, acces_id, email, client, le, montant_base, taux_pct, montant_fixe,
           commission_attendue, note, pose_par, via)
        values (${partenaire.partenaire_id}, 'depot', ${acces?.acces_id ?? null}::uuid,
                ${acces ? null : email}, ${client}, ${le}::date, ${versEuros(base ?? 0)}::numeric,
                ${taux.tauxPct}::numeric, ${taux.montantFixe === null ? null : versEuros(taux.montantFixe)}::numeric,
                ${versEuros(attendue)}::numeric, ${note}, ${posePar}::uuid, 'agent')`
    } catch (err) {
      if (relationAbsente(err)) throw err
      throw new Error(`${ligneAcces}\nMais le dépôt n'est PAS inscrit (${erreurLisible(err)}) : redemande l'inscription du dépôt, l'accès ne sera pas refait.`)
    }

    return `Dépôt de ${euros(base ?? 0)} chez ${partenaire.nom} inscrit pour ${client ? `${client} (${email})` : email}, le ${libelleJour(le)}.\n`
      + `${phraseCommission({ attendue, taux, nature, le, client: quiClient, moisCourant })}\n`
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
    const issue = await prisma.$transaction(async (tx) => {
      const existant = await tx.$queryRaw<LignePartenaire[]>`
        select partenaire_id, nom, nature, note from public.cockpit_partenaires where partenaire_id = ${id} for update`
      let partenaire = existant[0]
      if (!partenaire) {
        const nature = p.nature === 'broker' ? 'broker' : p.nature === 'affiliation' ? 'affiliation' : null
        if (!nature) {
          throw new RefusAction(`${nomSaisi} est un nouveau partenaire : précise s'il s'agit d'un broker ou d'une affiliation. Rien n'a été fait.`)
        }
        await tx.$executeRaw`
          insert into public.cockpit_partenaires (partenaire_id, nom, nature, pose_par, via)
          values (${id}, ${nomSaisi}, ${nature}, ${posePar}::uuid, 'agent')
          on conflict (partenaire_id) do nothing`
        partenaire = { partenaire_id: id, nom: nomSaisi, nature, note: null }
      }
      const avantLignes = await tx.$queryRaw<LigneTaux[]>`
        select taux_id::text as taux_id, partenaire_id, a_partir_du::text as a_partir_du,
               taux_pct::float8 as taux_pct, montant_fixe::float8 as montant_fixe, note, pose_le
        from public.cockpit_partenaire_taux where partenaire_id = ${id}`
      const avant = tauxEnVigueur(avantLignes.map(versTaux), id, aPartirDu)
      await tx.$executeRaw`
        insert into public.cockpit_partenaire_taux (partenaire_id, a_partir_du, taux_pct, montant_fixe, note, pose_par, via)
        values (${id}, ${aPartirDu}::date, ${p.taux_pct === null ? null : Number(p.taux_pct)}::numeric,
                ${p.montant_fixe === null ? null : Number(p.montant_fixe)}::numeric, ${note}, ${posePar}::uuid, 'agent')`
      return { partenaire, avant, nouveau: existant.length === 0 }
    })
    const nature = issue.partenaire.nature === 'broker' ? 'depot' : 'affiliation'
    const t = {
      tauxPct: p.taux_pct === null ? null : Number(p.taux_pct),
      montantFixe: p.montant_fixe === null ? null : centimes(p.montant_fixe),
    }
    return `Taux de ${issue.partenaire.nom} : ${libelleTaux(t, nature)} à partir du ${libelleJour(aPartirDu)}`
      + (issue.nouveau ? ` (nouveau partenaire, ${issue.partenaire.nature}).` : issue.avant ? ` (avant : ${libelleTaux(issue.avant, nature)}).` : ' (premier taux).')
      + ` Les dépôts déjà inscrits gardent le taux de leur date.\n`
      + `Rien à faire : les prochains ${nature === 'depot' ? 'dépôts' : 'clients'} prendront ce taux.`
  }

  if (type === 'intervenant') {
    const offreId = String(p.offre_id)
    const nom = await nomOffre(offreId)
    if (!nom) throw new RefusAction(`offre_id « ${offreId} » inconnu : rien n'a été fait.`)
    const verdict = await verifierTotalIntervenants(offreId, String(p.intervenant), Number(p.pourcentage), String(p.a_partir_du))
    if (typeof verdict === 'string') throw new RefusAction(verdict)
    await prisma.$executeRaw`
      insert into public.cockpit_intervenants (intervenant, offre_id, pourcentage, a_partir_du, note, pose_par, via)
      values (${String(p.intervenant)}, ${offreId}, ${Number(p.pourcentage)}::numeric, ${String(p.a_partir_du)}::date,
              ${note}, ${posePar}::uuid, 'agent')`
    const pct = Number(p.pourcentage)
    return (pct === 0
      ? `${p.intervenant} ne prend plus rien sur ${nom} à partir du ${libelleJour(String(p.a_partir_du))}.`
      : `${p.intervenant} prend ${pourcent(pct)} de l'encaissé de ${nom} à partir du ${libelleJour(String(p.a_partir_du))}, payé par celui qui encaisse.`)
      + ` ${verdict.texte}\nRien à faire : la répartition en tient compte dès cette date.`
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

  // reglement
  const mois = String(p.mois)
  await prisma.$executeRaw`
    insert into public.cockpit_reglements (de, a, montant, regle_le, mois, note, pose_par, via)
    values (${String(p.de)}, ${String(p.a)}, ${Number(p.montant)}::numeric, ${String(p.le)}::date, ${mois},
            ${note}, ${posePar}::uuid, 'agent')`
  const solde = await phraseSoldeDuMois(mois)
  return `Règlement noté : ${NOM_COTE[p.de as Cote]} a versé ${euros(centimes(p.montant) ?? 0)} à ${NOM_COTE[p.a as Cote]} `
    + `le ${libelleJour(String(p.le))}, sur le solde ${deMois(mois)}.`
    + (solde ? `\n${solde.replace(/\.$/, '')} après ce règlement.` : '')
    + '\nRien à faire.'
}
