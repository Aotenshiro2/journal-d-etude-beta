// Brique IA commune (mentorat, support, capture intelligente).
// Convention clés (28/08/2026, cf. credentials.local/README.md) : un produit =
// un workspace console = une clé = UNE variable d'env dédiée. Le fallback sur
// ANTHROPIC_API_KEY suit la leçon du secret Drive : accepter les deux noms.
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './db'
import { coutMicroEuros, type JetonsUtilises } from './ia-prix'

export type AiProduct = 'mentorat' | 'support' | 'capture' | 'etude' | 'cockpit' | 'pilotage'

const KEY_ENV: Record<AiProduct, string> = {
  mentorat: 'ANTHROPIC_API_KEY_CARNET',
  capture: 'ANTHROPIC_API_KEY_CARNET',
  // L'étude (2e temps de la capture) est le même produit commercial que la
  // capture : même clé, même workspace console, une seule facture à lire.
  etude: 'ANTHROPIC_API_KEY_CARNET',
  support: 'ANTHROPIC_API_KEY_SUPPORT',
  cockpit: 'ANTHROPIC_API_KEY_COCKPIT',
  pilotage: 'ANTHROPIC_API_KEY_PILOTAGE',
}

export function aiKeyFor(product: AiProduct): string | null {
  return (
    process.env[KEY_ENV[product]] ??
    // ANTHROPIC_API_KEY_COCKPIT existe depuis le 30/08/2026 (posée par Brice sur
    // journal-d-etude-beta) : ce repli sur la clé support ne sert donc plus,
    // gardé comme filet si la variable disparaissait d'un environnement.
    (product === 'cockpit' ? process.env.ANTHROPIC_API_KEY_SUPPORT : undefined) ??
    process.env.ANTHROPIC_API_KEY ??
    null
  )
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
  // Capture = travail de SECRÉTAIRE (extraire, trier, ne rien juger). Haiku
  // s'en sort très bien et coûte 0,4 centime ; mesuré au banc du 30/08, il
  // n'invente plus rien dès qu'on ne lui demande plus d'avis. C'est le bon
  // outil pour la tâche, pas un modèle au rabais.
  capture: process.env.AI_MODEL_CAPTURE ?? 'claude-haiku-4-5',
  // Étude = lecture de la note dans le cadre de l'académie. Là, la profondeur
  // se voit : au banc, Opus a lu un outil de position sur un JPEG et repéré
  // deux erreurs classiques que Haiku n'a pas vues.
  etude: process.env.AI_MODEL_ETUDE ?? 'claude-opus-5',
  cockpit: process.env.AI_MODEL_COCKPIT ?? 'claude-opus-5',
  // Lecture de relevés : opus par défaut comme partout, mais c'est la tâche la
  // plus mécanique du lot. Passer AI_MODEL_PILOTAGE à claude-haiku-4-5 divise
  // la facture par ~10 si la qualité tient sur les relevés réels.
  pilotage: process.env.AI_MODEL_PILOTAGE ?? 'claude-opus-5',
}

/**
 * Log d'usage par membre — la source de l'écran cockpit « jetons/coûts par
 * membre » ET l'assiette des budgets IA. Best-effort : un échec de log ne
 * casse jamais la réponse.
 *
 * Les jetons de CACHE arrivent hors de input_tokens : les oublier, c'est
 * sous-compter la dépense exactement là où on l'optimise. Le coût est figé ici,
 * avec la grille en vigueur au moment de l'appel — jamais recalculé après coup,
 * sinon un changement de tarif réécrit la consommation passée des membres.
 */
export async function logAiUsage(
  userId: string,
  product: AiProduct,
  model: string,
  usage: JetonsUtilises,
  niveau?: string | null
): Promise<void> {
  try {
    await prisma.aiUsage.create({
      data: {
        userId,
        product,
        model,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        costMicros: coutMicroEuros(model, usage),
        niveau: niveau ?? null,
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
