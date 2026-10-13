// Le message d'accueil dans le groupe Live Club (Brice, 13/10). Metricgram
// postait une annonce a chaque entree ; notre bot le fait desormais, sur un
// ton plus sobre (« chaleureux, mais pas too much »), et pas a chaque fois :
// - un NOUVEAU membre (jamais vu dans le groupe) : bienvenue ;
// - un membre qui revient apres au moins JOURS_ABSENCE_RETOUR jours dehors :
//   « bon retour » ;
// - un retour rapide (sorti pour un impaye, puis revenu apres avoir paye) :
//   rien, personne n'a besoin d'une annonce.
// Un compte deja connu mais sans date de sortie (historique importe de
// Metricgram) : rien non plus, on ne sait pas depuis quand il est parti.
// Module pur : aucun import, teste par scripts/verifier-accueil-groupe.mjs.

export const JOURS_ABSENCE_RETOUR = 30

const JOUR_MS = 86_400_000
const STATUTS_DEDANS = ['member', 'administrator', 'creator', 'restricted']

/** La ligne de cockpit_telegram_membres AVANT l'evenement (null = jamais vu). */
export type AvantEntree = { present: boolean | null; sortiLe: Date | null } | null

export type Accueil = 'nouveau' | 'retour' | null

/**
 * Faut-il publier un accueil pour cet evenement chat_member ? Seulement sur
 * une ENTREE (ancien statut dehors, nouveau statut dedans) : un changement de
 * droits d'un membre deja present, ou un rejeu de l'update par Telegram (la
 * ligne dit deja « present »), ne publie rien.
 */
export function accueilAPublier(
  avant: AvantEntree,
  ancienStatut: string | null | undefined,
  nouveauPresent: boolean,
  quand: Date,
): Accueil {
  if (!nouveauPresent) return null
  if (ancienStatut && STATUTS_DEDANS.includes(ancienStatut)) return null
  if (!avant) return 'nouveau'
  if (avant.present === true) return null
  if (!avant.sortiLe) return null
  const absence = quand.getTime() - avant.sortiLe.getTime()
  return absence >= JOURS_ABSENCE_RETOUR * JOUR_MS ? 'retour' : null
}

/** @pseudo s'il existe, sinon le prenom, sinon rien de nominatif. */
export function nomPourAccueil(pseudo: string | null | undefined, prenom: string | null | undefined): string | null {
  const p = (pseudo ?? '').replace(/^@/, '').trim()
  if (p) return `@${p}`
  const n = (prenom ?? '').trim()
  return n || null
}

export function texteAccueil(accueil: Exclude<Accueil, null>, nom: string | null): string {
  if (accueil === 'nouveau') {
    return `Bienvenue dans le Live Club${nom ? `, ${nom}` : ''}. Installe-toi tranquillement : `
      + `les messages épinglés t'expliquent comment ça marche, et tu peux te présenter quand tu veux.`
  }
  return `Bon retour dans le Live Club${nom ? `, ${nom}` : ''}. On est contents de te revoir parmi nous.`
}
