// L'acces aux apps accorde a la main (MentoratGrant, demande Brice du 28/08),
// sorti de la route /api/cockpit/mentorat le 05/11/2026 pour qu'Agent AOK
// fasse le meme geste par sa carte (Brice, 05/11 : « que l'agent puisse faire
// depuis Telegram les gestes du cockpit »). La route et l'executeur de la
// carte (agent-gestes-cockpit.ts) appellent ces fonctions : memes ecritures.
//
// MentoratGrant n'a pas de colonne d'auteur (ni default auth.uid(), ni
// trigger) : rien a poser de plus cote serveur. Retirer ne coupe PAS un droit
// automatique (ETM, Live Club actif, tier Skool premium/vip, Carnet Premium),
// cf. src/lib/entitlements.ts. L'email est deja en minuscules et valide.

import { prisma } from '@/lib/db'

export type GrantMentorat = { id: string; email: string; note: string | null; createdAt: Date; revokedAt: Date | null }

/** Le grant actif d'un email, ou null. */
export async function grantMentoratActif(email: string): Promise<GrantMentorat | null> {
  return prisma.mentoratGrant.findFirst({ where: { email, revokedAt: null } })
}

/** Accorder : cree un grant { email, note } si aucun n'est actif (idempotent). */
export async function accorderMentorat(email: string, note: string | null): Promise<{ deja: boolean; grant: GrantMentorat }> {
  const existant = await grantMentoratActif(email)
  if (existant) return { deja: true, grant: existant }
  const grant = await prisma.mentoratGrant.create({ data: { email, note } })
  return { deja: false, grant }
}

/** Retirer : pose revokedAt sur les grants actifs de cet email. Rend leur nombre. */
export async function retirerMentorat(email: string): Promise<number> {
  const { count } = await prisma.mentoratGrant.updateMany({
    where: { email, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return count
}
