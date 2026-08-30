// Niveau d'usage IA d'un membre. Trois paliers plus le cas « inconnu ».
//
// Décision Brice du 30/08/2026 : on ne différencie plus par la qualité du
// modèle sur la capture (« toi, tu as l'IA moins bonne » est mauvais à vendre
// et faux : Haiku est le bon outil pour extraire). Ce qui se paie, c'est
// l'ÉTUDE — la lecture de la note dans le cadre de l'académie — et le nombre
// de fois qu'on peut la demander.
//
// La porte d'entrée du niveau libre est volontairement fermée : « connu du
// cockpit », pas « a créé un compte ». Créer un compte ne coûte rien, donc un
// niveau libre ouvert à tout compte authentifié est ouvert à Internet.
import { prisma } from './db'
import { checkMentoratAccess, type MentoratReason } from './entitlements'

export type NiveauIA = 'club' | 'premium' | 'libre' | 'aucun'

export interface AccesIA {
  niveau: NiveauIA
  /** la capture (secrétaire) est-elle autorisée ? */
  capture: boolean
  /** l'étude (lecture dans le cadre) est-elle autorisée ? */
  etude: boolean
  raison: MentoratReason | null
  email: string | null
}

/** Les voies d'accès qui ouvrent le palier Club. skool-premium y est rangé
 *  avec skool-vip : même niveau d'accès pour l'instant (tranché le 30/08). */
const RAISONS_CLUB: MentoratReason[] = ['manuel', 'liveclub', 'skool-vip', 'skool-premium']

/** L'email est-il rattaché à un membre connu du cockpit, abonné ou non ?
 *  cockpit_membre_emails porte TOUS les emails connus d'un membre : quelqu'un
 *  connecté avec son deuxième email est quand même reconnu. */
async function connuDuCockpit(email: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ un: number }[]>`
    select 1 as un from cockpit_membre_emails where lower(email) = ${email} limit 1
  `
  return rows.length > 0
}

export async function resoudreNiveauIA(userId: string): Promise<AccesIA> {
  const acces = await checkMentoratAccess(userId)
  const email = acces.email

  if (acces.entitled && acces.reason) {
    const niveau: NiveauIA = RAISONS_CLUB.includes(acces.reason) ? 'club' : 'premium'
    return { niveau, capture: true, etude: true, raison: acces.reason, email }
  }

  if (email && (await connuDuCockpit(email))) {
    // Membre AOK sans abonnement : la capture, pas l'étude. Le bouton
    // « Étudier la note » lui est visible et verrouillé, avec la raison.
    return { niveau: 'libre', capture: true, etude: false, raison: null, email }
  }

  return { niveau: 'aucun', capture: false, etude: false, raison: null, email }
}

// Les modèles employés vivent dans AI_MODEL (src/lib/ai.ts), une seule source
// de vérité pour toute la brique IA. La capture tourne sur le même modèle à
// tous les paliers : ce qui se paie, c'est l'étude et son nombre.
