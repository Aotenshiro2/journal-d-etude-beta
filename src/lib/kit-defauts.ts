// Les choix par defaut des inscrits par formulaire Kit (31/10/2026) : le
// branchement serveur. Regle et logique : kit-defauts-pur.ts. Routes :
// /api/kit/webhook/[secret] (temps reel) et /api/cron/kit-defauts (filet).
//
// Logs : ids Kit et comptes seulement. Jamais une adresse.

import { prisma } from '@/lib/db'
import { cleKit, clientKit, ErreurKit } from './kit'
import { CHOIX_KIT } from './kit-choix'
import { gardePrisma } from './kit-abonnements-depot'
import {
  cheminSecret, debutDuFilet, filetDefauts, traiterAbonnes,
  type DependancesDefauts, type SyntheseDefauts,
} from './kit-defauts-pur'

/** Le secret du chemin attendu, ou null (cle serveur absente : la route rend 503). */
export function cheminAttendu(): string | null {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  return s && s.length >= 32 ? cheminSecret(s) : null
}

function dependances(): DependancesDefauts | null {
  const cle = cleKit()
  return cle ? { kit: clientKit(cle), garde: gardePrisma(prisma), choix: CHOIX_KIT } : null
}

const resume = (s: SyntheseDefauts) =>
  `vus ${s.vus}, poses ${s.pose}, deja choisis ${s.deja_choisi}, membres ecartes ${s.membre}, inactifs ${s.inactif}, absents ${s.absent}, erreurs ${s.erreurs}`

/** Les abonnes d'une livraison de webhook. Ne jette jamais (appele apres la reponse). */
export async function traiterWebhook(ids: readonly number[]): Promise<void> {
  const d = dependances()
  if (!d) { console.warn('[kit/webhook] CONVERTKIT_API_KEY (ou KIT_API_KEY) absente : rien pose, le filet rattrapera'); return }
  const s = await traiterAbonnes(d, ids)
  console.log(`[kit/webhook] ${resume(s)}`)
}

export type IssueFilet = { ok: true; synthese: SyntheseDefauts } | { ok: false; erreur: string }

/** Le filet quotidien : abonnes actifs des 72 dernieres heures sans aucun choix. */
export async function passerFilet(maintenant = new Date()): Promise<IssueFilet> {
  const d = dependances()
  if (!d) return { ok: false, erreur: 'config' }
  try {
    const s = await filetDefauts(d, debutDuFilet(maintenant))
    console.log(`[cron/kit-defauts] ${resume(s)}`)
    return { ok: true, synthese: s }
  } catch (err) {
    const code = err instanceof ErreurKit ? `kit ${err.statut}` : err instanceof Error ? err.name : 'erreur'
    console.warn(`[cron/kit-defauts] interrompu : ${code}`)
    return { ok: false, erreur: 'kit' }
  }
}
