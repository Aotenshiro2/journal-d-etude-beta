// Brique IA commune (mentorat, support, capture intelligente).
// Convention clés (28/08/2026, cf. credentials.local/README.md) : un produit =
// un workspace console = une clé = UNE variable d'env dédiée. Le fallback sur
// ANTHROPIC_API_KEY suit la leçon du secret Drive : accepter les deux noms.
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './db'

export type AiProduct = 'mentorat' | 'support' | 'capture'

const KEY_ENV: Record<AiProduct, string> = {
  mentorat: 'ANTHROPIC_API_KEY_CARNET',
  capture: 'ANTHROPIC_API_KEY_CARNET',
  support: 'ANTHROPIC_API_KEY_SUPPORT',
}

export function aiKeyFor(product: AiProduct): string | null {
  return process.env[KEY_ENV[product]] ?? process.env.ANTHROPIC_API_KEY ?? null
}

/** Client Anthropic du produit — throw clair si la clé n'est pas configurée */
export function aiClient(product: AiProduct): Anthropic {
  const apiKey = aiKeyFor(product)
  if (!apiKey) {
    throw new Error(`Clé API absente : pose ${KEY_ENV[product]} dans les variables d'environnement Vercel.`)
  }
  return new Anthropic({ apiKey })
}

// Modèles par défaut, surchargeables par env sans redéployer de code.
// claude-opus-5 par défaut (qualité d'abord) ; passer AI_MODEL_SUPPORT à
// claude-haiku-4-5 divise le coût du support par ~10 si Brice le décide.
export const AI_MODEL: Record<AiProduct, string> = {
  mentorat: process.env.AI_MODEL_MENTORAT ?? 'claude-opus-5',
  support: process.env.AI_MODEL_SUPPORT ?? 'claude-opus-5',
  capture: process.env.AI_MODEL_CAPTURE ?? 'claude-opus-5',
}

/**
 * Log d'usage par membre — la source de l'écran cockpit « jetons/coûts par
 * membre ». Best-effort : un échec de log ne casse jamais la réponse.
 */
export async function logAiUsage(
  userId: string,
  product: AiProduct,
  model: string,
  usage: { input_tokens: number; output_tokens: number }
): Promise<void> {
  try {
    await prisma.aiUsage.create({
      data: {
        userId,
        product,
        model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      },
    })
  } catch (err) {
    console.error('[ai] logAiUsage failed:', err)
  }
}

/** Concatène les blocs texte d'une réponse (content est une union discriminée) */
export function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
}

/**
 * Message d'erreur exploitable pour les routes : distinguer une clé morte
 * (401/403, l'erreur d'ENV la plus probable) d'une saturation (429) ou d'une
 * panne — un « indisponible » générique ne dit pas quoi réparer.
 */
export function aiErrorMessage(err: unknown, envVar: string): string {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) {
      return `Clé API invalide ou révoquée côté serveur : vérifie ${envVar} dans Vercel puis redéploie.`
    }
    if (err.status === 429) {
      return 'Trop de demandes en ce moment, réessaie dans un instant.'
    }
    if (err.status === 529 || (err.status ?? 0) >= 500) {
      return 'Le service IA est momentanément saturé, réessaie dans une minute.'
    }
  }
  return 'Le service IA est indisponible, réessaie ou contacte un humain.'
}
