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
}

/** Le texte de l'alerte, sobre, sans emoji ni tiret long. */
export function texteDemandeHumain(d: DemandeHumain): string {
  const message = (d.dernierMessage ?? '').replace(/\s+/g, ' ').trim()
  return [
    `Un membre demande un humain (${d.origine}).`,
    `Qui : ${d.qui?.trim() || 'inconnu'}`,
    message ? `Son dernier message : « ${message.length > 300 ? `${message.slice(0, 300)}...` : message} »` : null,
    `Réponds-lui depuis l'onglet Support du Cockpit, ta réponse lui arrive dans ${d.reponseDans} : ${LIEN_SUPPORT}`,
  ].filter(Boolean).join('\n')
}

/** Le dernier message du membre dans un fil Support (role 'user'). */
export function dernierMessageMembre(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown }
    if (m?.role === 'user' && typeof m.content === 'string' && m.content.trim()) return m.content
  }
  return null
}
