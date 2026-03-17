/**
 * Supprime les balises HTML d'une chaîne de caractères
 */
export function stripHtml(html: string): string {
  if (!html) return ''
  
  // Supprimer les balises HTML avec une regex
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/**
 * Tronque un texte à une longueur donnée avec ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength).trim() + '...'
}

/**
 * Extrait l'URL d'une image depuis un contenu message.
 * Gère deux cas : HTML avec attribut src OU URL brute envoyée par l'extension.
 */
export function extractImageSrc(content: string): string | null {
  if (!content) return null
  // Case 1: HTML <img src="...">
  const fromAttr = content.match(/src=["']([^"']+)["']/)?.[1]
  if (fromAttr) return fromAttr
  // Case 2: Raw URL (sent by extension as message content)
  const trimmed = content.trim()
  if (/^https?:\/\//.test(trimmed) || /^data:image\//.test(trimmed)) return trimmed
  return null
}

/**
 * Formate une date relative (ex: "2h", "3j")
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  if (diffDays > 0) return `${diffDays}j`
  if (diffHours > 0) return `${diffHours}h`
  if (diffMinutes > 0) return `${diffMinutes}m`
  return "À l'instant"
}