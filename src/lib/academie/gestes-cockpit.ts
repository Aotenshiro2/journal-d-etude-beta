// Les ecritures des gestes du cockpit sur les acces a l'academie (18/10/2026),
// sorties de la route /api/cockpit/academie le 05/11/2026 pour qu'Agent AOK
// fasse le meme geste par sa carte (Brice, 05/11 : « que l'agent puisse faire
// depuis Telegram les gestes du cockpit »). La route et l'executeur de la
// carte (agent-gestes-cockpit.ts) appellent ces deux fonctions : memes
// requetes, memes issues. L'appelant a deja verifie le compte (allowlist du
// cockpit, ou compte d'Agent AOK) et lu le geste (lireGeste).
//
// pose_par / retire_par : 'cockpit:<uuid>' depuis l'ecran, 'agent:<uuid>'
// depuis une carte d'Agent AOK. Jette si la base refuse.

import { prisma } from '@/lib/db'
import { ajoutRetrait, noteAccorder, type GesteAccorder, type GesteRetirer } from './gestes-cockpit-pur'
import { SQL_GESTE_ACCORDER, SQL_GESTE_RETIRER } from './requetes'

type LigneAccorder = {
  offre_connue: number; deja_id: string | null; acces_id: string | null; debut: Date | null; fin: Date | null
}

export type IssueAccorderAcademie =
  | { issue: 'offre_inconnue' }
  | { issue: 'deja'; accesId: string }
  | { issue: 'accorde'; accesId: string | null; debut: Date | null; fin: Date | null }

/** Accorder une offre a un email (source 'offert'). Idempotent : un acces actif de la meme offre n'est pas double. */
export async function accorderAccesAcademieServeur(geste: GesteAccorder, acteur: string): Promise<IssueAccorderAcademie> {
  const [r] = await prisma.$queryRawUnsafe<LigneAccorder[]>(
    SQL_GESTE_ACCORDER, geste.email, geste.offre, geste.fin, acteur, noteAccorder(geste.raison),
  )
  if (!r || r.offre_connue === 0) return { issue: 'offre_inconnue' }
  if (r.deja_id) return { issue: 'deja', accesId: r.deja_id }
  return { issue: 'accorde', accesId: r.acces_id, debut: r.debut, fin: r.fin }
}

export type IssueRetirerAcademie =
  | { issue: 'inconnu' }
  | { issue: 'retire'; accesId: string; retireLe: Date }

/** Retirer un acces (retire_le, retire_par, raison ajoutee a la note). Inconnu ou deja retire : 'inconnu'. */
export async function retirerAccesAcademieServeur(geste: GesteRetirer, acteur: string): Promise<IssueRetirerAcademie> {
  const lignes = await prisma.$queryRawUnsafe<{ acces_id: string; retire_le: Date }[]>(
    SQL_GESTE_RETIRER, geste.accesId, acteur, ajoutRetrait(geste.raison),
  )
  if (lignes.length === 0) return { issue: 'inconnu' }
  return { issue: 'retire', accesId: lignes[0].acces_id, retireLe: lignes[0].retire_le }
}
