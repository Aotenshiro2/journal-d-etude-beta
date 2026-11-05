// La fiche d'un trade (brief J2, 05/11/2026) : une URL par fiche,
// /journal?trade=<segmentId> (l'id du trade dans Note.trades, unique pour le
// membre), partageable, et que le bouton retour du navigateur sait refaire.
// Le badge « Trade N » d'une note y mène quand le trade a des prix tapés dans
// le Carnet ou un trade du broker lié. Module pur (client et serveur).

import type { TradePrixData } from '@/types'

export const urlFiche = (segmentId: string) => `/journal?trade=${encodeURIComponent(segmentId)}`

const nombre = (x: unknown) => typeof x === 'number' && Number.isFinite(x)

/** Le trade a-t-il une fiche à montrer : des prix tapés dans le Carnet, ou un lien avec le broker ? */
export function aUneFiche(prix: TradePrixData | null | undefined, lieAuBroker: boolean): boolean {
  if (lieAuBroker) return true
  if (!prix || typeof prix !== 'object') return false
  return [prix.entree, prix.sortie, prix.taille, prix.stop, prix.tp].some(nombre)
    || (Array.isArray(prix.partiels) && prix.partiels.some(p => nombre(p?.prix)))
}

/** Le lien du badge, ou null. */
export const ficheDuBadge = (segmentId: string, prix: TradePrixData | null | undefined, lieAuBroker: boolean) =>
  aUneFiche(prix, lieAuBroker) ? urlFiche(segmentId) : null
