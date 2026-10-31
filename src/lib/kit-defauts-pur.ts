// Les choix par defaut des inscrits par FORMULAIRE Kit (31/10/2026). Kit est
// sur le plan gratuit : pas de regle « formulaire, alors tags ». Deux chemins
// les posent a sa place :
// - en temps reel, les webhooks Kit « subscriber.form_subscribe » (un par
//   formulaire actif) vers /api/kit/webhook/<secret> ;
// - le filet quotidien (/api/cron/kit-defauts, 05:00 UTC) sur les abonnes
//   actifs crees dans les 72 dernieres heures, au cas ou un webhook se perd
//   (les webhooks historiques de Kit ne sont ni signes ni rejoues).
//
// La regle, la meme pour les deux : un abonne recoit les choix par defaut
// (tagsInscription, src/lib/kit-choix.ts) seulement s'il est ACTIF, n'a AUCUN
// tag « Choix » et n'est pas un membre qui a regle ses choix dans Mon espace
// (abonne relie a un compte, ou ligne « mon_espace » dans le journal des
// consentements) : un membre qui a tout decoche n'est jamais recoche.
//
// Du corps d'un webhook, on ne croit que l'id de l'abonne : tout le reste est
// relu chez Kit. Sans base ni reseau ici : le serveur (kit-defauts.ts) donne
// le client Kit et la garde, le verificateur des faux.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ClientKit } from './kit'
import type { ChoixKit } from './kit-choix'

/** Au plus tant d'abonnes traites par livraison de webhook (le filet rattrape le reste). */
export const WEBHOOK_MAX_ABONNES = 20
/** La fenetre du filet quotidien. */
export const FILET_HEURES = 14 * 24

const USAGE_CHEMIN = 'aok:kit-webhook:chemin:v1'

/**
 * Le secret du chemin du webhook (40 caracteres hexadecimaux), derive d'un
 * secret serveur deja pose (SUPABASE_SERVICE_ROLE_KEY) : aucune variable de
 * plus. Le changer (rotation de la cle) demande de recreer les webhooks.
 */
export function cheminSecret(cleServeur: string): string {
  return createHmac('sha256', cleServeur).update(USAGE_CHEMIN, 'utf8').digest('hex').slice(0, 40)
}

/** Comparaison a temps constant du segment de chemin recu. */
export function secretCorrespond(recu: string, attendu: string): boolean {
  const a = Buffer.from(String(recu))
  const b = Buffer.from(attendu)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Les ids d'abonnes d'une livraison. Format historique (webhooks de
 * /v4/webhooks) : { subscriber: { id } }. Format des « webhook endpoints »
 * (si Kit les ouvre un jour a la cle API) : { events: [{ type:
 * 'subscriber.subscribed_to_form', data: { subscriber: { id } } }] }. Rien
 * d'autre n'est lu. Sans doublon, au plus WEBHOOK_MAX_ABONNES.
 */
export function idsDuWebhook(corps: unknown): number[] {
  const ids: number[] = []
  const ajouter = (x: unknown) => {
    const id = (x && typeof x === 'object' ? (x as { id?: unknown }).id : null)
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && !ids.includes(id)) ids.push(id)
  }
  if (corps && typeof corps === 'object') {
    const c = corps as { subscriber?: unknown; events?: unknown }
    ajouter(c.subscriber)
    if (Array.isArray(c.events)) {
      for (const e of c.events) {
        const ev = (e && typeof e === 'object' ? e : {}) as { type?: unknown; data?: { subscriber?: unknown } }
        if (ev.type === 'subscriber.subscribed_to_form') ajouter(ev.data?.subscriber)
      }
    }
  }
  return ids.slice(0, WEBHOOK_MAX_ABONNES)
}

/** Ce que la garde lit en base : l'abonne est-il un membre qui a regle ses choix ? */
export type GardeMembres = { ecarte(kitId: number): Promise<boolean> }

export type DependancesDefauts = { kit: ClientKit; garde: GardeMembres; choix: readonly ChoixKit[] }

export type IssueDefauts = 'pose' | 'absent' | 'inactif' | 'deja_choisi' | 'membre'

/** Pose les choix par defaut a CET abonne s'il est vierge (voir la regle en tete). Idempotent. */
export async function poserDefautsSiVierge(d: DependancesDefauts, id: number): Promise<IssueDefauts> {
  const a = await d.kit.abonne(id)
  if (!a) return 'absent'
  if (a.etat !== 'active') return 'inactif'
  const tags = new Set(await d.kit.tagsDe(id))
  if (d.choix.some(c => tags.has(c.tag))) return 'deja_choisi'
  if (await d.garde.ecarte(id)) return 'membre'
  for (const c of d.choix) if (c.inscription) await d.kit.poserTag(c.tag, id)
  return 'pose'
}

export type SyntheseDefauts = Record<IssueDefauts | 'vus' | 'erreurs', number>

const vide = (): SyntheseDefauts => ({ vus: 0, pose: 0, absent: 0, inactif: 0, deja_choisi: 0, membre: 0, erreurs: 0 })

/** Traite une liste d'abonnes, une erreur n'arrete pas les suivants. */
export async function traiterAbonnes(d: DependancesDefauts, ids: readonly number[]): Promise<SyntheseDefauts> {
  const s = vide()
  for (const id of ids) {
    s.vus++
    try { s[await poserDefautsSiVierge(d, id)]++ } catch { s.erreurs++ }
  }
  return s
}

/**
 * Le filet : les abonnes actifs crees depuis `depuis` (par defaut les
 * FILET_HEURES dernieres heures), passes a la meme regle. En ESSAI
 * (scripts), le client Kit donne n'ecrit pas.
 */
export async function filetDefauts(d: DependancesDefauts, depuis: Date): Promise<SyntheseDefauts> {
  const recents = await d.kit.abonnesActifsCreesDepuis(depuis)
  return traiterAbonnes(d, recents.map(r => r.id))
}

export const debutDuFilet = (maintenant: Date, heures = FILET_HEURES) => new Date(maintenant.getTime() - heures * 3600000)
