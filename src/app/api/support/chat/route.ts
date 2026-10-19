import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { aiClient, AI_MODEL, logAiUsage, textOf, aiErrorMessage } from '@/lib/ai'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { filtrerSortie } from '@/lib/politique-information'
import type Anthropic from '@anthropic-ai/sdk'
import { MAX_TOURS_SUPPORT, requeteSupport, resultatOutilSupport, versMessagesSupport } from '@/lib/support-prompt'
import { trouverCours } from '@/lib/trouver-cours'

// L'appel Claude peut dépasser les 10 s par défaut des fonctions Vercel
export const maxDuration = 60

interface ThreadMessage {
  role: 'user' | 'assistant' | 'human'
  content: string
  at: string
}

// Le prompt (produits, règles d'information, contexte par app) et la requête
// vivent dans @/lib/support-prompt (module pur, rejoué par scripts/eval-fuites.mjs).
// Règles communes aux deux bots : @/lib/politique-information.

const MAX_HISTORY = 20
const MAX_MESSAGE_LEN = 4000

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  const body = await req.json()
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : ''
  // 'telegram' est reserve aux fils du bot Live Club (ecrits par
  // src/lib/liveclub/support-pont.ts) : un client du site ne peut pas s'en
  // reclamer, sinon le cockpit le prendrait pour un fil Telegram.
  const appBrute = typeof body.app === 'string' && body.app ? body.app.slice(0, 32) : 'extension'
  const app = appBrute.trim().toLowerCase() === 'telegram' ? 'extension' : appBrute
  const threadId = typeof body.threadId === 'string' ? body.threadId : null
  if (!message) return NextResponse.json({ error: 'Message vide' }, { status: 400, headers: cors })

  // Fil existant (au propriétaire seulement). Un NOUVEAU fil n'est créé
  // qu'APRÈS une réponse réussie : créer avant laissait des fils vides à
  // chaque échec (3 fils fantômes constatés le 28/08 pendant le dogfooding).
  const thread = threadId
    ? await prisma.supportThread.findFirst({ where: { id: threadId, userId } })
    : null

  const history = (Array.isArray(thread?.messages) ? thread!.messages : []) as unknown as ThreadMessage[]
  const recent = history.slice(-MAX_HISTORY)

  let client
  try {
    client = aiClient('support')
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Clé API absente' }, { status: 503, headers: cors })
  }

  try {
    const model = AI_MODEL.support
    // Boucle d'outils (18/10) : la lecture des fiches produits
    // (connaissances_produits, src/lib/connaissances-outil.ts) et, depuis le
    // 19/10, trouver_cours (lecons de l'academie en direct et masterclass,
    // src/lib/trouver-cours.ts), comme le bot Live Club. Chaque tour est
    // trace dans AiUsage.
    const messages = versMessagesSupport(recent, message)
    let texte = ''
    for (let tour = 0; tour < MAX_TOURS_SUPPORT; tour++) {
      const response = await client.messages.create(requeteSupport(model, app, messages))
      await logAiUsage(userId, 'support', model, response.usage)
      if (response.stop_reason !== 'tool_use') {
        texte = textOf(response)
        break
      }
      messages.push({ role: 'assistant', content: response.content })
      const resultats: Anthropic.ToolResultBlockParam[] = []
      for (const bloc of response.content) {
        if (bloc.type !== 'tool_use') continue
        const r = await resultatOutilSupport(bloc.name, bloc.input, e => trouverCours(e, 'support', { userId }))
        resultats.push({ type: 'tool_result', tool_use_id: bloc.id, content: r.contenu, ...(r.erreur ? { is_error: true } : {}) })
      }
      messages.push({ role: 'user', content: resultats })
    }
    // Filet de sortie (politique d'information, 30/09) : emails, téléphones et
    // prénoms d'équipe non publics que le membre n'a ni écrits ni reçus de
    // l'équipe (réponses 'human' du fil, qu'il a déjà lues).
    const filtre = filtrerSortie(texte, [message, ...recent.filter(m => m.role === 'user' || m.role === 'human').map(m => m.content)])
    if (filtre.retraits) console.warn(`[support/chat] ${filtre.retraits} donnee(s) retiree(s) de la reponse`)
    const reply = filtre.texte || 'Je ne peux pas répondre à ça. Utilise « Parler à un humain » et on te répondra directement.'

    const now = new Date().toISOString()
    const updated: ThreadMessage[] = [
      ...history,
      { role: 'user', content: message, at: now },
      { role: 'assistant', content: reply, at: now },
    ]
    const saved = thread
      ? await prisma.supportThread.update({
          where: { id: thread.id },
          data: { messages: updated as object[] },
        })
      : await prisma.supportThread.create({
          data: { userId, app, messages: updated as object[] },
        })

    return NextResponse.json({ threadId: saved.id, reply }, { headers: cors })
  } catch (err) {
    console.error('[support/chat]', err)
    return NextResponse.json({ error: aiErrorMessage(err, 'ANTHROPIC_API_KEY_SUPPORT') }, { status: 502, headers: cors })
  }
}
