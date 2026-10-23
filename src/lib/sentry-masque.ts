// Le secret du connecteur MCP de ChatGPT est dans le CHEMIN de l'URL
// (/api/mcp/<secret>, 23/10/2026). Sentry trace 100 % des requetes et
// rapporte les erreurs de requete avec leur adresse : sans ce masque, le
// secret partirait chez Sentry. Toute chaine de l'evenement (url, nom de
// transaction, fil d'Ariane, spans) est masquee avant l'envoi.
// Sans import : charge par sentry.server.config.ts et sentry.edge.config.ts.

const CHEMIN_MCP = /\/api\/mcp\/[^/?#\s"'<>]+/g

export function masquerSecretMcp<T>(valeur: T, profondeur = 0): T {
  if (typeof valeur === 'string') return valeur.replace(CHEMIN_MCP, '/api/mcp/[masque]') as T
  if (valeur === null || typeof valeur !== 'object' || profondeur > 20) return valeur
  if (Array.isArray(valeur)) {
    for (let i = 0; i < valeur.length; i += 1) valeur[i] = masquerSecretMcp(valeur[i], profondeur + 1)
    return valeur
  }
  const o = valeur as Record<string, unknown>
  for (const k of Object.keys(o)) o[k] = masquerSecretMcp(o[k], profondeur + 1)
  return valeur
}
