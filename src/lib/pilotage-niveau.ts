// Le palier d'un membre de Pilotage et ses compteurs (brief E1, 30/10/2026).
// Les regles sont pures (pilotage-paliers.ts) ; ici on lit, TOUJOURS borne au
// userId du jeton.
//
// Le palier : l'equipe (estSansPlafond, sur un email verifie du compte), un
// abonnement Pilotage Premium ou Premium Duo actif (academie_acces, par le
// compte ou un email verifie), une raison Club du Carnet (checkMentoratAccess,
// lue seulement sans abonnement : elle peut appeler Stripe), sinon libre.
// Les lectures : les lignes AiUsage du poste 'document' (une par document lu,
// tranches comprises, brief D3).

import { prisma } from '@/lib/db'
import { SQL_IDENTITE } from '@/lib/academie/requetes'
import { checkMentoratAccess } from '@/lib/entitlements'
import { estSansPlafond } from '@/lib/ia-budget'
import { octetsDuCoffre } from '@/lib/documents-serveur'
import { abonnementsDuMembre, portailDe, type AbonnementActif, clePilotage } from '@/lib/pilotage-abonnement'
import {
  COFFRE_PAR_PALIER, TARIFS, compterLectures, debutDesLectures, quotaDe, resoudrePalier,
  type Compteur, type Palier,
} from '@/lib/pilotage-paliers'

export interface PalierMembre {
  palier: Palier
  raison: string | null
  /** Emails verifies du compte (minuscules). */
  emails: string[]
  /** profiles.role = 'admin' ou compte de l'equipe : l'achat d'essai lui est ouvert avant la vente publique. */
  admin: boolean
  /** L'abonnement Pilotage actif le plus long, s'il y en a un (le portail s'y rattache). */
  abonnement: AbonnementActif | null
}

export async function palierDuMembre(userId: string): Promise<PalierMembre> {
  const ident = (await prisma.$queryRawUnsafe<{ role: string | null; emails: string[] | null }[]>(SQL_IDENTITE, userId))[0]
  const emails = ident?.emails ?? []
  const sansPlafond = emails.some(e => estSansPlafond(e))
  const admin = sansPlafond || ident?.role === 'admin'
  if (sansPlafond) return { ...resoudrePalier({ sansPlafond, produits: [], raisonCarnet: null }), emails, admin, abonnement: null }

  const abonnements = await abonnementsDuMembre(userId, emails)
  const raisonCarnet = abonnements.length ? null : (await checkMentoratAccess(userId)).reason
  const r = resoudrePalier({ sansPlafond, produits: abonnements.map(a => a.produit), raisonCarnet })
  // Le Duo d'abord quand il y en a un (c'est lui que dit la raison).
  const abonnement = abonnements.find(a => a.produit === 'premium-duo') ?? abonnements[0] ?? null
  return { ...r, emails, admin, abonnement }
}

/** L'achat d'essai avant la vente publique : profiles.role = 'admin' ou compte de l'equipe (sans Stripe ni cockpit). */
export async function estAdminPilotage(userId: string): Promise<boolean> {
  const ident = (await prisma.$queryRawUnsafe<{ role: string | null; emails: string[] | null }[]>(SQL_IDENTITE, userId))[0]
  return ident?.role === 'admin' || (ident?.emails ?? []).some(e => estSansPlafond(e))
}

export interface EntreeCompteur { palier: Palier; dates: Date[]; premiere: Date | null; maintenant: Date }

/** Les lectures du membre (poste document) et son compteur. */
export async function compteurDuMembre(userId: string, palier: Palier, maintenant = new Date()): Promise<{ entree: EntreeCompteur; compteur: Compteur }> {
  const premiere = (await prisma.aiUsage.findFirst({
    where: { userId, usage: 'document' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true },
  }))?.createdAt ?? null
  const depuis = debutDesLectures(premiere, maintenant)
  const lignes = await prisma.aiUsage.findMany({
    where: { userId, usage: 'document', createdAt: { gte: depuis } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true }, take: 5000,
  })
  const entree: EntreeCompteur = { palier, dates: lignes.map(l => l.createdAt), premiere, maintenant }
  return { entree, compteur: compterLectures(entree) }
}

/** Ce que la lecture d'un document demande : le palier, l'autorisation, le quota a rendre, l'entree du compteur. */
export async function quotaDuMembre(userId: string) {
  const p = await palierDuMembre(userId)
  const { entree, compteur } = await compteurDuMembre(userId, p.palier)
  return { palier: p.palier, autorise: compteur.autorise, quota: quotaDe(compteur, p.palier), entree }
}

/** La reponse de GET /api/pilotage/niveau. */
export async function niveauDuMembre(userId: string) {
  const p = await palierDuMembre(userId)
  const [{ compteur }, octets, portail] = await Promise.all([
    compteurDuMembre(userId, p.palier),
    octetsDuCoffre(userId),
    p.abonnement ? portailDe(clePilotage(), p.abonnement.reference) : Promise.resolve(null),
  ])
  return {
    palier: p.palier,
    raison: p.raison,
    lectures: compteur.lectures,
    coffre: { octets, limite: COFFRE_PAR_PALIER[p.palier] },
    portail,
    offres: { ...TARIFS },
  }
}
