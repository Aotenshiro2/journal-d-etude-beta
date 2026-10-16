// Regles pures de l'alerte « un membre demande un humain » (alerte-equipe-telegram.ts).
// Aucun import : teste par scripts/verifier-alerte-equipe.mjs.

const LIEN_SUPPORT = 'https://cockpit.aoknowledge.com/?vue=support'

export type DemandeHumain = {
  /** D'ou vient la demande : le bot Live Club, ou l'app du support du site. */
  origine: string
  /** Qui, en clair : nom, @pseudo, email, ce qu'on a. */
  qui: string | null
  /** Le dernier message ecrit par le membre, s'il y en a un. */
  dernierMessage: string | null
  /** La reponse humaine part dans Telegram (Live Club) ou dans le chat du site. */
  reponseDans: 'Telegram' | 'son chat'
  /**
   * (16/10) L'identifiant du fil Support : sa reference courte termine
   * l'alerte, pour que « reponds-lui : ... » ecrit juste en dessous, dans
   * Agent AOK, vise ce fil sans ambiguite (proposer_reponse_membre).
   */
  fil?: string | null
  /**
   * (16/10) 'demande' : il demande un humain. 'reponse' : l'equipe a la main
   * dans ce fil et le membre lui a repondu (bot Live Club, support-pont-pur.ts).
   */
  genre?: 'demande' | 'reponse'
  /** (16/10) Son message porte une image : 'jointe' sous l'alerte, ou 'onglet' (a voir dans l'onglet Support). */
  image?: 'jointe' | 'onglet' | null
}

/** Le bouton « Rendre la main au bot » sous l'alerte : callback_data rm:<id du fil> (64 octets au plus). */
export function donneeRendreLaMain(fil: string): string | null {
  const id = typeof fil === 'string' ? fil.trim().toLowerCase() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? `rm:${id}` : null
}

/** L'identifiant du fil d'un clic « Rendre la main au bot », ou null. */
export function lireDonneeRendreLaMain(data: unknown): string | null {
  const m = typeof data === 'string' ? /^rm:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(data) : null
  return m ? m[1] : null
}

export const LIBELLE_RENDRE_LA_MAIN = 'Rendre la main au bot'

/**
 * La reference courte d'un fil Support : « fil » suivi des 8 premiers
 * caracteres de son identifiant (un uuid). Lue par lireFil
 * (reponse-membre-pur.ts), qui la retrouve par prefixe et refuse si deux fils
 * la partagent. null si l'identifiant n'est pas un uuid.
 */
export function referenceFil(id: string | null | undefined): string | null {
  const brut = typeof id === 'string' ? id.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(brut)) return null
  return `fil ${brut.slice(0, 8)}`
}

/** Le texte de l'alerte, sobre, sans emoji ni tiret long. */
export function texteDemandeHumain(d: DemandeHumain): string {
  const message = (d.dernierMessage ?? '').replace(/\s+/g, ' ').trim()
  const reference = referenceFil(d.fil)
  const cite = message.length > 300 ? `${message.slice(0, 300)}...` : message
  // Un geste sans texte (« (a appuyé sur Contacter l'équipe) ») se dit sans guillemets.
  const ligneMessage = !message ? null
    : /^\(.*\)$/.test(message) ? `Son dernier message : ${message}`
      : `${d.genre === 'reponse' ? 'Son message' : 'Son dernier message'} : « ${cite} »`
  const qui = d.qui?.trim() || null
  return [
    d.genre === 'reponse'
      ? `${qui ?? 'Un membre'} a répondu à l'équipe (${d.origine}).`
      : `Un membre demande un humain (${d.origine}).`,
    d.genre === 'reponse' ? null : `Qui : ${qui ?? 'inconnu'}`,
    ligneMessage,
    d.image === 'jointe' ? 'Avec une image : la voici juste en dessous.'
      : d.image === 'onglet' ? "Avec une image, à voir dans l'onglet Support." : null,
    reference
      ? `Ta réponse lui arrive dans ${d.reponseDans}, d'ici ou depuis l'onglet Support du Cockpit : ${LIEN_SUPPORT}`
      : `Réponds-lui depuis l'onglet Support du Cockpit, ta réponse lui arrive dans ${d.reponseDans} : ${LIEN_SUPPORT}`,
    // (16/10) La ligne d'aide, en dernier, avec la reference du fil.
    reference ? `Pour lui répondre d'ici : dis-moi « réponds-lui : ton message » (${reference}).` : null,
  ].filter(Boolean).join('\n')
}

/**
 * La ligne « [système] » qui precede l'alerte dans l'historique de la
 * conversation avec Agent AOK : l'alerte n'est pas une question de l'equipe,
 * et le fil qu'elle cite est celui que vise « reponds-lui » juste en dessous.
 */
export const MARQUEUR_DEMANDE_HUMAIN = "[système] Alerte du support (un membre demande un humain, ou répond à l'équipe), envoyée automatiquement par Agent AOK (ce n'est pas une question de l'équipe)."

/** Les deux lignes ajoutees a l'historique d'Agent AOK : le marqueur, puis l'alerte telle qu'envoyee. */
export function entreesHistoriqueDemandeHumain(texte: string, id: string): { role: 'user' | 'assistant'; content: string; id: string }[] {
  return [
    { role: 'user', content: MARQUEUR_DEMANDE_HUMAIN, id },
    { role: 'assistant', content: texte, id: `${id}-texte` },
  ]
}

const LIGNE_BOUTON = /^\[bouton\]\s*(.+)$/
const COMMANDE = /^\/(start|menu)\b/i
const TRACES_SANS_TEXTE: Record<string, string> = {
  '[image]': '(a envoyé une image)',
  '[message sans texte]': '(a envoyé un message sans texte)',
  '[code de vérification tapé]': '(a tapé un code de vérification)',
}

/**
 * Le dernier VRAI message ecrit par le membre dans un fil Support (role
 * 'user'), depuis la derniere reponse de l'equipe (16/10, cas de Lea : l'alerte
 * citait « [bouton] Contacter l'équipe »). Les lignes de bouton, les
 * commandes (/start, /menu) et les traces sans texte sont sautees. S'il n'y a
 * aucun vrai message : le geste le plus recent, entre parentheses
 * (« (a appuyé sur Contacter l'équipe) », « (a envoyé une image) »).
 */
export function dernierMessageMembre(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null
  let repli: string | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown }
    if (m?.role === 'human') break
    if (m?.role !== 'user' || typeof m.content !== 'string') continue
    const t = m.content.trim()
    if (!t) continue
    const bouton = LIGNE_BOUTON.exec(t)
    if (bouton) { repli ??= `(a appuyé sur ${bouton[1].trim()})`; continue }
    if (TRACES_SANS_TEXTE[t]) { repli ??= TRACES_SANS_TEXTE[t]; continue }
    if (COMMANDE.test(t)) continue
    return m.content
  }
  return repli
}
