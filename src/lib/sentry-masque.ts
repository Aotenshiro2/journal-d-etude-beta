// Le secret du connecteur MCP de ChatGPT est dans le CHEMIN de l'URL
// (/api/mcp/<secret>, 23/10/2026). Sentry trace 100 % des requetes et
// rapporte les erreurs de requete avec leur adresse : sans ce masque, le
// secret partirait chez Sentry. Toute chaine de l'evenement (url, nom de
// transaction, fil d'Ariane, spans) est masquee avant l'envoi.
// Depuis le 01/11/2026, aussi le connecteur MCP du cockpit pour Tache
// (/api/mcp-cockpit/<secret>). Depuis le 05/11/2026, aussi le connecteur de
// l'assistant d'Alex pour son indicateur (/api/mcp-alex/<secret>).
// Depuis le 08/11/2026, aussi le jeton des invitations de l'academie
// (/api/academie/invitation?j=<43 caracteres>) : dans une adresse, une
// chaine de requete (« j=... »), un objet { j: ... } ou une paire ['j', ...].
// Sans import : charge par sentry.server.config.ts et sentry.edge.config.ts.

const CHEMIN_MCP = /\/api\/(mcp|mcp-cockpit|mcp-alex)\/[^/?#\s"'<>]+/g
const JETON_INVITATION = /((?:^|[?&\s"'])j=)[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g
const JETON_SEUL = /^[A-Za-z0-9_-]{43}$/

export function masquerSecretMcp<T>(valeur: T, profondeur = 0): T {
  if (typeof valeur === 'string') {
    return valeur.replace(CHEMIN_MCP, '/api/$1/[masque]').replace(JETON_INVITATION, '$1[masque]') as T
  }
  if (valeur === null || typeof valeur !== 'object' || profondeur > 20) return valeur
  if (Array.isArray(valeur)) {
    if (valeur.length === 2 && valeur[0] === 'j' && typeof valeur[1] === 'string' && JETON_SEUL.test(valeur[1])) {
      valeur[1] = '[masque]'
      return valeur
    }
    for (let i = 0; i < valeur.length; i += 1) valeur[i] = masquerSecretMcp(valeur[i], profondeur + 1)
    return valeur
  }
  const o = valeur as Record<string, unknown>
  for (const k of Object.keys(o)) {
    const v = o[k]
    o[k] = k === 'j' && typeof v === 'string' && JETON_SEUL.test(v) ? '[masque]' : masquerSecretMcp(v, profondeur + 1)
  }
  return valeur
}
