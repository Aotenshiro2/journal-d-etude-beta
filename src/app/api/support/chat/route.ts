import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { aiClient, AI_MODEL, logAiUsage, textOf, aiErrorMessage } from '@/lib/ai'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { filtrerSortie } from '@/lib/politique-information'
import type Anthropic from '@anthropic-ai/sdk'
import { MAX_TOURS_SUPPORT, requeteSupport, resultatOutilSupport, versMessagesSupport } from '@/lib/support-prompt'
import { trouverCours } from '@/lib/trouver-cours'
import { texteAvecPhrase, type BesoinPropose } from '@/lib/besoins/pur'
import { noterBesoinsDuChat } from '@/lib/besoins/serveur'
import { analyserTexte } from '@/lib/securite/injection-pur'
import { alerterBriceSecurite } from '@/lib/securite/alerte'
// (06/11, apres-midi) Les limites des agents : noter_limite, les recherches vides, le tri de Brice par le serveur.
import { NOM_OUTIL_NOTER_LIMITE, REFUS_PRUDENCE_LIMITE, noterConsultation, noterLimite, suiviLimites } from '@/lib/besoins/signaux-pur'
import { appliquerLimitesChat } from '@/lib/besoins/signaux'

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
    // Un message du membre = un echange, quel que soit le nombre de tours d'outils.
    const echange = randomUUID()
    // (06/11) Besoins des membres, lot 1 : les besoins notes par noter_besoin,
    // gardes en memoire et enregistres APRES la sauvegarde du fil.
    const besoins: BesoinPropose[] = []
    // (06/11, apres-midi) Les limites de l'agent : recherches vides et noter_limite,
    // triees par le serveur APRES la sauvegarde du fil (tri de Brice). Un
    // message suspect (detecteur d'injection) : noter_limite refuse, rien garde.
    const suivi = suiviLimites()
    suivi.prudence = analyserTexte(message, { niveau: 'injection' }).suspect
    for (let tour = 0; tour < MAX_TOURS_SUPPORT; tour++) {
      const response = await client.messages.create(requeteSupport(model, app, messages))
      await logAiUsage(userId, 'support', model, response.usage, null, { usage: 'support_chat', echange })
      if (response.stop_reason !== 'tool_use') {
        texte = textOf(response)
        break
      }
      messages.push({ role: 'assistant', content: response.content })
      const resultats: Anthropic.ToolResultBlockParam[] = []
      for (const bloc of response.content) {
        if (bloc.type !== 'tool_use') continue
        if (bloc.name === NOM_OUTIL_NOTER_LIMITE && suivi.prudence) {
          resultats.push({ type: 'tool_result', tool_use_id: bloc.id, content: JSON.stringify(REFUS_PRUDENCE_LIMITE) })
          continue
        }
        const r = await resultatOutilSupport(bloc.name, bloc.input, e => trouverCours(e, 'support', { userId }))
        if (r.besoin) besoins.push(r.besoin)
        if (r.limite) noterLimite(suivi, r.limite)
        if (r.brut) noterConsultation(suivi, bloc.name, bloc.input, r.brut)
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

    // (06/11, apres-midi) Les limites de l'agent : le tri de Brice par le
    // serveur (donnee sensible d'un non-admin = rien), puis la carte (sans
    // phrase au membre) et le signal site.info_absente. Ne jette pas.
    await appliquerLimitesChat({ userId, app, filId: saved.id, texte: message, reponse: reply, suivi })

    // (06/11) Les besoins notes : enregistres maintenant que le fil existe (le
    // texte garde est le message du membre tel qu'au fil). Enregistre et non
    // suspect : la phrase du serveur s'ajoute a la reponse, une fois, et le fil
    // est reecrit avec elle. Un echec : rien, la reponse part comme avant.
    let replyFinale = reply
    if (besoins.length) {
      const note = await noterBesoinsDuChat({ userId, app, filId: saved.id, texte: message, besoins, peutDire: !!filtre.texte })
      // (06/11, lots 2 a 4) Une demande enregistree SUSPECTE (texte cache,
      // consigne adressee a une IA) : Brice est prevenu, comme pour le bot des
      // membres (anti-rafale d'alerte.ts). Rien n'est dit au membre.
      if (note.suspects > 0) {
        await alerterBriceSecurite({
          source: `chat support (${app}), besoin noté`, qui: `compte ${userId.slice(0, 8)}`,
          analyse: analyserTexte(message, { niveau: 'injection' }),
          suite: "La demande est gardée dans les besoins, marquée suspecte, sans phrase au membre. Rien d'autre n'a été fait.",
        })
      }
      if (note.phrase) {
        replyFinale = texteAvecPhrase(reply, true)
        try {
          await prisma.supportThread.update({
            where: { id: saved.id },
            data: { messages: [...updated.slice(0, -1), { role: 'assistant', content: replyFinale, at: now }] as object[] },
          })
        } catch (err) {
          console.warn('[support/chat] phrase du besoin non ecrite au fil', err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : '?')
        }
      }
    }

    return NextResponse.json({ threadId: saved.id, reply: replyFinale }, { headers: cors })
  } catch (err) {
    console.error('[support/chat]', err)
    return NextResponse.json({ error: aiErrorMessage(err, 'ANTHROPIC_API_KEY_SUPPORT') }, { status: 502, headers: cors })
  }
}
