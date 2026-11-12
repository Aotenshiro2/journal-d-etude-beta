// « Gérer mon abonnement » depuis Mon espace (12/11/2026, correctif) : les regles
// pures. Les abonnements du compte AOKnowledge chez Stripe (Carnet Premium,
// Pilotage Premium, Duo, soutien), ranges par client Stripe : un portail client
// Stripe montre tous les abonnements d'UN client, et un membre qui a paye deux
// fois par Checkout a souvent deux clients. Le Live Club (compte Stripe de
// Melanie) n'est jamais ici : il se gere depuis son bot Telegram.
// Pur, sans import serveur : scripts/verifier-portail-abonnements.mjs.

import { STATUTS_ABONNEMENT_ACTIF, estMarqueSoutien } from './soutien-pur'

/** Les abonnements que le portail du compte AOKnowledge sait gerer. */
export type AppAbonnement = 'duo' | 'pilotage' | 'carnet' | 'aok'

export type AbonnementVu = { app: AppAbonnement; soutien: boolean; client: string }

/** Un portail : un client Stripe et les abonnements qu'il porte, en clair. */
export type GroupePortail = { client: string; abonnements: string[] }

/** Le retour du portail : la rubrique Achats de Mon espace. */
export const RETOUR_PORTAIL = 'https://aoknowledge.com/mon-espace/parametres/achats'

const ORDRE: readonly AppAbonnement[] = ['duo', 'pilotage', 'carnet', 'aok']

export function libelleAbonnement(a: Pick<AbonnementVu, 'app' | 'soutien'>): string {
  if (a.app === 'duo') return 'Premium Duo (Carnet et Pilotage)'
  if (a.app === 'pilotage') return a.soutien ? 'Soutien de Pilotage' : 'Pilotage Premium'
  if (a.app === 'carnet') return a.soutien ? 'Soutien du Carnet' : 'Carnet Premium'
  return 'Soutien AOKnowledge'
}

/** Un identifiant de client Stripe, rien d'autre. */
export const estClientStripe = (v: unknown): v is string => typeof v === 'string' && /^cus_[A-Za-z0-9]{6,64}$/.test(v)

/**
 * Les abonnements vus, ranges par client (dans l'ordre Duo, Pilotage, Carnet,
 * soutien AOKnowledge), libelles sans doublon. Les entrees nulles (source
 * illisible ou sans abonnement) et les clients mal formes sont ignores.
 */
export function grouperParClient(vus: readonly (AbonnementVu | null | undefined)[]): GroupePortail[] {
  const tries = vus
    .filter((v): v is AbonnementVu => Boolean(v) && estClientStripe(v?.client) && ORDRE.includes((v as AbonnementVu).app))
    .sort((a, b) => ORDRE.indexOf(a.app) - ORDRE.indexOf(b.app))
  const groupes = new Map<string, string[]>()
  for (const v of tries) {
    const liste = groupes.get(v.client) ?? []
    const libelle = libelleAbonnement(v)
    if (!liste.includes(libelle)) liste.push(libelle)
    groupes.set(v.client, liste)
  }
  return [...groupes].map(([client, abonnements]) => ({ client, abonnements }))
}

/** Le client demande par la page ({ client: 'cus_...' }), ou null. */
export function lireClientDemande(corps: unknown): string | null {
  const v = corps && typeof corps === 'object' && !Array.isArray(corps) ? (corps as Record<string, unknown>).client : null
  return estClientStripe(v) ? v : null
}

/** Le portail ne s'ouvre que pour un client qui porte un abonnement de CE compte. */
export const clientDuMembre = (groupes: readonly GroupePortail[], client: string): boolean =>
  groupes.some(g => g.client === client)

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/**
 * Un abonnement Pilotage ou Duo relu chez Stripe (GET /v1/subscriptions/<id>) :
 * actif (actif, essai, impaye en relance), son client, sa marque soutien. Sinon null.
 */
export function lireAbonnementPilotage(brut: unknown, app: 'duo' | 'pilotage'): AbonnementVu | null {
  const s = objet(brut)
  if (!(STATUTS_ABONNEMENT_ACTIF as readonly string[]).includes(String(s.status))) return null
  const client = typeof s.customer === 'string' ? s.customer : objet(s.customer).id
  if (!estClientStripe(client)) return null
  return { app, soutien: app === 'pilotage' && estMarqueSoutien(s.metadata), client }
}
