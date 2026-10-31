// Les abonnements aux emails d'un compte (31/10/2026) : le branchement
// serveur. Logique : kit-abonnements-pur.ts. Client Kit : kit.ts. Base :
// kit-abonnements-depot.ts. Choix : kit-choix.ts. Routes :
// /api/compte/abonnements (GET et POST).
//
// Logs : compte tronque, issue, statut Kit ou code d'erreur de base. Jamais
// une adresse ni le corps d'une reponse Kit.

import { prisma } from '@/lib/db'
import { tronquer } from '@/lib/academie/http'
import { ErreurKit, cleKit, clientKit } from './kit'
import { CHOIX_KIT } from './kit-choix'
import { depotPrisma } from './kit-abonnements-depot'
import {
  enregistrerAbonnements as enregistrer, lireAbonnements as lire,
  type Dependances, type IssueAbonnements,
} from './kit-abonnements-pur'

export type IssueServeur = IssueAbonnements | { ok: false; erreur: 'config' | 'kit' | 'indisponible' }

function dependances(): Dependances | null {
  const cle = cleKit()
  if (!cle) return null
  return { kit: clientKit(cle), depot: depotPrisma(prisma), choix: CHOIX_KIT }
}

function codeErreur(err: unknown): string {
  if (err instanceof ErreurKit) return `kit ${err.statut}`
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; meta?: { code?: unknown } }
  const codes = [e.code, e.meta?.code].filter((x): x is string => typeof x === 'string')
  return codes.length ? codes.join('/') : err instanceof Error ? err.name : 'erreur'
}

async function executer(quoi: string, userId: string, f: (d: Dependances) => Promise<IssueAbonnements>): Promise<IssueServeur> {
  const d = dependances()
  if (!d) {
    console.warn('[compte/abonnements] config incomplete : CONVERTKIT_API_KEY (ou KIT_API_KEY)')
    return { ok: false, erreur: 'config' }
  }
  try {
    const r = await f(d)
    const issue = r.ok ? (r.abonnements.resynchro !== 'non' ? `ok, resynchro ${r.abonnements.resynchro}` : 'ok') : r.erreur
    console.log(`[compte/abonnements] ${quoi} compte=${tronquer(userId)} : ${issue}`)
    return r
  } catch (err) {
    console.warn(`[compte/abonnements] ${quoi} compte=${tronquer(userId)} : ${codeErreur(err)}`)
    return { ok: false, erreur: err instanceof ErreurKit ? 'kit' : 'indisponible' }
  }
}

export const lireAbonnements = (userId: string) => executer('lecture', userId, d => lire(d, userId))

export const enregistrerAbonnements = (userId: string, demande: Record<string, boolean>) =>
  executer('choix', userId, d => enregistrer(d, userId, demande))
