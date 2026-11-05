// Le « prévu » d'un trade du Carnet (brief J1, 05/11/2026) : ce que le membre a
// tapé dans le panneau du trade, copié dans Note.trades[] (JSON, source de
// vérité extension) par POST /api/notes. Module PUR, aucun import :
// scripts/verifier-synthese-trades.mjs le charge tel quel.
//
// Note.trades[] peut porter :
//   prix?: { entree?, sortie?, taille?, stop?, tp?, partiels?: { prix, taille? }[],
//            sens?: 'achat' | 'vente', typeOrdre?: 'marche' | 'limite' | 'stop',
//            risque?: { montant, unite: 'USD' | '%' } }   (les trois derniers : Carnet 1.8.14)
//   instrument?: string (« NQ », « MNQ », « ES », « EURUSD »)
// Le nettoyage GARDE tout ce qui est valable tel quel (les autres champs du
// segment et les clés inconnues de `prix` ne sont pas touchés) et borne le
// reste : nombres finis, 10 partiels au plus, instrument de 20 caractères au
// plus, sens et type d'ordre dans leur liste, risque positif (100 % au plus,
// réduit à { montant, unite }). Ce qui ne se lit pas est retiré, jamais deviné.
// Le stop et le TP restent des PRIX : le Carnet convertit ses ticks avant.

export const PARTIELS_MAX = 10
export const INSTRUMENT_MAX = 20
export const SENS_CARNET = ['achat', 'vente'] as const
export const TYPES_ORDRE_CARNET = ['marche', 'limite', 'stop'] as const
export const RISQUE_MAX = 1e9

export type SensCarnet = (typeof SENS_CARNET)[number]
export type TypeOrdreCarnet = (typeof TYPES_ORDRE_CARNET)[number]
export interface RisqueCarnet { montant: number; unite: 'USD' | '%' }

/** Les prix du Carnet, nettoyés. */
export interface PrixCarnet {
  entree?: number
  sortie?: number
  taille?: number
  stop?: number
  tp?: number
  partiels?: { prix: number; taille?: number }[]
  /** Le sens CHOISI par le membre (1.8.14). */
  sens?: SensCarnet
  typeOrdre?: TypeOrdreCarnet
  risque?: RisqueCarnet
}

type Objet = Record<string, unknown>
const objet = (x: unknown): Objet | null => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Objet) : null)
const fini = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

const CHAMPS_PRIX = ['entree', 'sortie', 'taille', 'stop', 'tp'] as const

/** Le risque tapé : { montant > 0, unite USD ou % (100 au plus) }, sans autre clé ; null sinon. */
export function nettoyerRisque(brut: unknown): RisqueCarnet | null {
  const r = objet(brut)
  if (!r || !fini(r.montant) || r.montant <= 0 || r.montant >= RISQUE_MAX) return null
  if (r.unite !== 'USD' && r.unite !== '%') return null
  if (r.unite === '%' && r.montant > 100) return null
  return { montant: r.montant, unite: r.unite }
}

/** `prix` nettoyé : null quand ce n'est pas un objet (le champ est alors retiré du segment). */
export function nettoyerPrix(brut: unknown): (PrixCarnet & Objet) | null {
  const p = objet(brut)
  if (!p) return null
  const sortie: Objet = { ...p }
  for (const champ of CHAMPS_PRIX) {
    if (champ in sortie && !fini(sortie[champ])) delete sortie[champ]
  }
  if ('sens' in sortie && !SENS_CARNET.includes(sortie.sens as SensCarnet)) delete sortie.sens
  if ('typeOrdre' in sortie && !TYPES_ORDRE_CARNET.includes(sortie.typeOrdre as TypeOrdreCarnet)) delete sortie.typeOrdre
  if ('risque' in sortie) {
    const risque = nettoyerRisque(sortie.risque)
    if (risque) sortie.risque = risque
    else delete sortie.risque
  }
  if ('partiels' in sortie) {
    if (!Array.isArray(sortie.partiels)) {
      delete sortie.partiels
    } else {
      const partiels: { prix: number; taille?: number }[] = []
      for (const brutPartiel of sortie.partiels) {
        const q = objet(brutPartiel)
        if (!q || !fini(q.prix)) continue
        partiels.push(fini(q.taille) ? { prix: q.prix, taille: q.taille } : { prix: q.prix })
        if (partiels.length === PARTIELS_MAX) break
      }
      sortie.partiels = partiels
    }
  }
  return sortie as PrixCarnet & Objet
}

/** L'instrument tapé : une chaîne non vide de 20 caractères au plus, sinon null. */
export function nettoyerInstrument(brut: unknown): string | null {
  if (typeof brut !== 'string') return null
  const s = brut.trim().slice(0, INSTRUMENT_MAX)
  return s ? s : null
}

/**
 * Un segment de Note.trades : tel quel, sauf `prix` et `instrument` bornés
 * (retirés s'ils ne se lisent pas). Un segment qui n'a ni l'un ni l'autre est
 * rendu tel quel (même objet).
 */
export function nettoyerSegment<T extends object>(segment: T): T {
  const s = segment as Objet
  if (!('prix' in s) && !('instrument' in s)) return segment
  const sortie: Objet = { ...s }
  if ('prix' in sortie) {
    const prix = nettoyerPrix(sortie.prix)
    if (prix) sortie.prix = prix
    else delete sortie.prix
  }
  if ('instrument' in sortie) {
    const instrument = nettoyerInstrument(sortie.instrument)
    if (instrument) sortie.instrument = instrument
    else delete sortie.instrument
  }
  return sortie as T
}

/** Le body.trades de POST /api/notes : les objets seulement (comme avant), chacun nettoyé. */
export function nettoyerTradesCarnet(brut: unknown): object[] | null {
  if (!Array.isArray(brut)) return null
  return brut.filter((t: unknown): t is object => t != null && typeof t === 'object').map(nettoyerSegment)
}
