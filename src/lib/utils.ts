import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).trim() + '…'
}

export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  const diffWeek = Math.floor(diffDay / 7)
  const diffMonth = Math.floor(diffDay / 30)

  if (diffSec < 60) return 'à l\'instant'
  if (diffMin < 60) return `il y a ${diffMin} min`
  if (diffHour < 24) return `il y a ${diffHour}h`
  if (diffDay < 7) return `il y a ${diffDay}j`
  if (diffWeek < 4) return `il y a ${diffWeek} sem`
  if (diffMonth < 12) return `il y a ${diffMonth} mois`
  return `il y a ${Math.floor(diffMonth / 12)} an${Math.floor(diffMonth / 12) > 1 ? 's' : ''}`
}

export function extractImageSrc(content: string): string | null {
  // URL brute (format utilisé par l'extension pour les messages image)
  if (/^https?:\/\//.test(content) || content.startsWith('//')) return content
  // HTML avec balise <img>
  const match = content.match(/<img[^>]+src=["']([^"']+)["']/)
  return match ? match[1] : null
}
