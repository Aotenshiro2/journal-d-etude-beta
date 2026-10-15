// Le droit d'un compte du site a la page d'essai de l'academie (15/10/2026).
//
// Decision B de Brice (06/10, PLAN-ACADEMIE.md section 2) : la page d'essai
// est visible par lui et par tout membre payant (Live Club, Premium, VIP,
// ETM), PAS par le Carnet Premium seul. Donc, dans l'ordre :
//   1. profiles.role = 'admin' (le role METIER vit dans profiles.role ;
//      auth.users.role reste 'authenticated' pour tout le monde) ;
//   2. sinon checkMentoratAccess (src/lib/entitlements.ts), qui rend UNE
//      raison : etm, manuel, liveclub, skool-vip, skool-premium ouvrent,
//      carnet-premium n'ouvre pas.
// checkMentoratAccess essaie le Carnet Premium en DERNIER : s'il rend
// 'carnet-premium', c'est qu'aucune autre raison n'a ete trouvee, l'exclure
// ne cache donc aucun membre payant.
//
// Ce n'est PAS encore droitsAcademie (section 4.3 du plan : modules ouverts
// et raison de chacun, union des acces) : ce sera avec les tables academie_*.
// Le Live Club est lu ici par l'etat du cockpit (abonnement_en_cours,
// rafraichi chaque matin), pas en direct chez Stripe : un nouvel abonne peut
// attendre le passage du lendemain. Assez pour l'essai.
//
// Jette si la base est illisible : la route en fait un 503, jamais un refus.

import { prisma } from '@/lib/db'
import { checkMentoratAccess, type MentoratReason } from '@/lib/entitlements'

export type RaisonAcademieEssai = 'admin' | Exclude<MentoratReason, 'carnet-premium'>

export type AccesAcademieEssai = {
  acces: boolean
  /** Pourquoi le compte a acces (utile a la page), null s'il n'a pas acces. */
  raison: RaisonAcademieEssai | null
}

const RAISONS_MEMBRE_PAYANT: ReadonlySet<MentoratReason> = new Set<MentoratReason>([
  'etm', 'manuel', 'liveclub', 'skool-vip', 'skool-premium',
])

function estRaisonMembrePayant(r: MentoratReason | null): r is Exclude<MentoratReason, 'carnet-premium'> {
  return r !== null && RAISONS_MEMBRE_PAYANT.has(r)
}

export async function aAccesAcademieEssai(userId: string): Promise<AccesAcademieEssai> {
  // 1. L'equipe (Brice) : lu en premier, sans Stripe ni cockpit.
  const profils = await prisma.$queryRaw<{ role: string | null }[]>`
    select role::text as role from public.profiles where id = ${userId}::uuid limit 1
  `
  if (profils[0]?.role === 'admin') return { acces: true, raison: 'admin' }

  // 2. Les membres payants, par la meme lecture que le mode mentorat.
  const mentorat = await checkMentoratAccess(userId)
  if (mentorat.entitled && estRaisonMembrePayant(mentorat.reason)) {
    return { acces: true, raison: mentorat.reason }
  }
  return { acces: false, raison: null }
}
