// L'inscription a la newsletter juste apres la creation d'un compte (31/10/2026).
// Le journal (/auth) et l'extension Carnet l'appellent sans session : le compte
// vient d'etre cree et son email n'est pas encore confirme. La route
// /api/newsletter/subscribe est donc publique, et c'est cette regle qui la garde.
// Sans elle, n'importe qui pourrait inscrire l'adresse d'un autre.
//
// - Connecte (Bearer) : seulement une adresse du compte (connexion ou verifiee).
// - Sans session : seulement l'adresse d'un compte cree il y a moins de
//   FENETRE_INSCRIPTION_H heures, qui a coche « newsletter » a l'inscription
//   (raw_user_meta_data.newsletter_subscribed), et une seule fois par compte
//   (une ligne « inscription » dans profile_consentements suffit a l'ecarter).
//
// Une demande ecartee recoit la meme reponse qu'une demande servie : la route
// ne dit pas si une adresse a un compte. Aucun import : Node le charge tel quel.

export const FENETRE_INSCRIPTION_H = 24

export type CompteInscription = {
  id: string
  creeLe: Date
  /** raw_user_meta_data.newsletter_subscribed vaut true. */
  newsletter: boolean
  /** Une ligne source « inscription » existe deja dans profile_consentements. */
  dejaInscrit: boolean
}

export type DecisionInscription =
  | { action: 'inscrire'; profileId: string }
  | { action: 'ignorer'; raison: 'autre_adresse' | 'sans_compte' | 'sans_accord' | 'trop_tard' | 'deja_inscrit' }

export function decisionInscription(p: {
  /** L'uuid du compte connecte (Bearer verifie), sinon null. */
  connecte: string | null
  /** Les adresses du compte connecte (connexion et verifiees), en minuscules. */
  adressesDuConnecte: string[]
  /** Le compte dont l'adresse de connexion est celle demandee, sinon null. */
  compte: CompteInscription | null
  email: string
  maintenant: Date
}): DecisionInscription {
  if (p.connecte) {
    return p.adressesDuConnecte.includes(p.email)
      ? { action: 'inscrire', profileId: p.connecte }
      : { action: 'ignorer', raison: 'autre_adresse' }
  }
  const c = p.compte
  if (!c) return { action: 'ignorer', raison: 'sans_compte' }
  if (!c.newsletter) return { action: 'ignorer', raison: 'sans_accord' }
  if (p.maintenant.getTime() - c.creeLe.getTime() > FENETRE_INSCRIPTION_H * 3600_000) return { action: 'ignorer', raison: 'trop_tard' }
  if (c.dejaInscrit) return { action: 'ignorer', raison: 'deja_inscrit' }
  return { action: 'inscrire', profileId: c.id }
}
