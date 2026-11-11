// Le badge « Soutien » d'un compte (brief du 11/11/2026) : un abonnement de
// soutien actif sur le Carnet ou sur Pilotage, relu chez Stripe (soutien-pur.ts
// pour la regle, aucune table). Rendu par /api/academie/moi (compte.soutien) pour
// Mon espace. Ne fait jamais tomber l'appelant : une source illisible vaut null.

import { prisma } from '@/lib/db'
import { SQL_IDENTITE } from '@/lib/academie/requetes'
import { emailConfirme } from '@/lib/academie/achat'
import { abonnementCarnetDe } from '@/lib/entitlements'
import { soutientPilotage } from '@/lib/pilotage-abonnement'

export type SoutienDuCompte = { carnet: boolean | null; pilotage: boolean | null }

/** Au plus 4 s : au-dela, inconnu (null), la page s'affiche sans le badge. */
const DELAI_MS = 4000

function borne<T>(p: Promise<T>, defaut: T): Promise<T> {
  return Promise.race([
    p.catch(() => defaut),
    new Promise<T>(resolve => setTimeout(() => resolve(defaut), DELAI_MS)),
  ])
}

export async function soutienDuCompte(userId: string): Promise<SoutienDuCompte> {
  const [email, ident] = await Promise.all([
    emailConfirme(userId).catch(() => null),
    prisma.$queryRawUnsafe<{ emails: string[] | null }[]>(SQL_IDENTITE, userId).then(l => l[0]?.emails ?? []).catch(() => [] as string[]),
  ])
  const [carnet, pilotage] = await Promise.all([
    borne(abonnementCarnetDe(email).then(v => (v ? v.soutien : null)), null),
    borne(soutientPilotage(userId, ident), null),
  ])
  return { carnet, pilotage }
}
