// Les videos de l'essai de la page protegee de l'academie (15/10/2026).
//
// Pour l'essai, une constante suffit : ce sont les deux videos envoyees sur
// la bibliotheque Bunny « Formation » du 12 au 15/10 pour mesurer le poids et
// la qualite (PLAN-ACADEMIE.md, sections 11 et 12, V1 point 1).
//
// Depuis la migration 20261015210000, ces deux videos sont les lecons du
// module « essai » (table academie_lecons) et la route de lecture passe par
// les tables et droitsAcademie. Cette liste ne sert plus que de secours, si
// les tables n'existent pas encore (code deploye avant la migration).
//
// La liste fait foi cote serveur : la page du site affiche les memes videos,
// mais une video qui n'est pas ici repond 400, quoi que la page envoie.

export type VideoEssai = {
  /** guid de la video chez Bunny Stream (minuscules). */
  id: string
  titre: string
  dureeMin: number
}

export const VIDEOS_ESSAI: readonly VideoEssai[] = [
  {
    id: 'b03789d3-f998-44ec-8c3c-5d8c5977008c',
    titre: "Formation 2023, Episode 4 : L'IPDA et la Théorie du Temps et du Prix",
    dureeMin: 36,
  },
  {
    id: 'c4413ef9-44d5-4df6-8387-b633e7882769',
    titre: 'Replay : Study Together du 05/11',
    dureeMin: 63,
  },
]

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * La video d'essai demandee, ou null si la valeur n'est pas un guid de la
 * liste. Accepte les majuscules (Bunny affiche ses guid en minuscules, un
 * copier-coller peut les changer), rend toujours le guid de la liste.
 */
export function videoEssai(valeur: unknown): VideoEssai | null {
  if (typeof valeur !== 'string') return null
  const id = valeur.trim().toLowerCase()
  if (!GUID_RE.test(id)) return null
  return VIDEOS_ESSAI.find(v => v.id === id) ?? null
}
