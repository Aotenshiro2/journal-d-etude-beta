// « Lire une capture » du Carnet (1.8.14, brief C5) côté serveur : l'appel à
// l'IA. Le même moteur que les documents de Pilotage (documents-serveur.ts) :
// le produit 'pilotage' (sa clé, ANTHROPIC_API_KEY_PILOTAGE), AI_MODEL.pilotage,
// un outil forcé, et UNE ligne AiUsage au poste 'document' : c'est elle que
// compte pilotage-niveau.ts, donc la lecture d'un ticket prend une lecture du
// palier, comme un document. Les règles sont dans lire-ordre-pur.ts.

import Anthropic from '@anthropic-ai/sdk'
import { aiClient, aiErrorMessage, AI_MODEL, logAiUsage } from '@/lib/ai'
import {
  DELAI_ORDRE_MS, MAX_JETONS_ORDRE, OUTIL_ORDRE, PROMPT_ORDRE, contenuOrdre, lectureOrdreDepuisIA,
  type LectureOrdre, type TypeImageOrdre,
} from '@/lib/lire-ordre-pur'

export async function lireOrdreParIA(
  userId: string, media: TypeImageOrdre, data: string,
): Promise<{ lecture: LectureOrdre } | { erreur: string; statut: number; indisponible?: boolean }> {
  let ia
  try {
    ia = aiClient('pilotage')
  } catch (err) {
    return { erreur: err instanceof Error ? err.message : 'Lecture indisponible', statut: 503, indisponible: true }
  }
  try {
    const model = AI_MODEL.pilotage
    const reponse = await ia.messages.create({
      model,
      max_tokens: MAX_JETONS_ORDRE,
      system: [{ type: 'text', text: PROMPT_ORDRE, cache_control: { type: 'ephemeral' } }],
      tools: [OUTIL_ORDRE],
      // Forcé : une structure, pas une réponse rédigée à reparser.
      tool_choice: { type: 'tool', name: OUTIL_ORDRE.name },
      messages: [{ role: 'user', content: contenuOrdre(media, data) }],
    } as never, { timeout: DELAI_ORDRE_MS, maxRetries: 0 })
    // Une lecture comptée dès que l'appel a abouti (même compteur que les documents).
    await logAiUsage(userId, 'pilotage', model, reponse.usage, null, { usage: 'document' })
    const entree = (reponse.content.find((c: { type: string }) => c.type === 'tool_use') as { input?: unknown } | undefined)?.input
    const lecture = lectureOrdreDepuisIA(entree)
    if (reponse.stop_reason === 'max_tokens') {
      lecture.confiance = Math.min(lecture.confiance, 0.5)
      lecture.remarque = ['Lecture coupée : vérifie chaque champ.', lecture.remarque].filter(Boolean).join(' ').slice(0, 300)
    }
    return { lecture }
  } catch (err) {
    console.error('[carnet/lire-ordre]', err instanceof Error ? err.message : err)
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return { erreur: "La lecture a pris trop de temps : réessaie, ou recadre la capture sur le panneau d'ordre.", statut: 504 }
    }
    return { erreur: aiErrorMessage(err, 'ANTHROPIC_API_KEY_PILOTAGE'), statut: 502 }
  }
}
