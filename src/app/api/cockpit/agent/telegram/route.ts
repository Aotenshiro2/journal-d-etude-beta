import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { boucleAgent } from '@/lib/agent-cockpit'
import { validerAction, executerAction } from '@/lib/stripe-actions'
import type Anthropic from '@anthropic-ai/sdk'

// Le canal TELEGRAM de l'agent cockpit (go Brice 04/09) : meme cerveau que la
// fenetre ✦ du cockpit (src/lib/agent-cockpit.ts), autre porte d'entree.
//
// SECURITE, trois verrous, dans cet ordre :
// 1. Le secret de webhook (en-tete X-Telegram-Bot-Api-Secret-Token, pose au
//    setWebhook) : sans lui, la requete n'est pas de Telegram, on repond 401.
// 2. L'identifiant Telegram de l'EXPEDITEUR doit exister dans
//    cockpit_telegram_comptes (rempli a la main : Brice, Melanie). Un inconnu
//    recoit son identifiant en reponse, pour qu'on puisse l'ajouter — et rien
//    d'autre.
// 3. Les actions Stripe gardent leur confirmation HUMAINE : boutons inline
//    Confirmer/Annuler, l'execution ne part qu'au clic (callback_query), avec
//    revalidation des parametres — exactement le circuit du web.
//
// La conversation est PERSISTEE cote serveur (cockpit_agent_conversations),
// contrairement au web ou le navigateur porte l'historique : Telegram ne
// renvoie que le dernier message. Toujours du TEXTE BRUT, comme au web.
//
// Telegram REJOUE un update reste sans 200 : on traite en synchrone (l'agent
// peut prendre 30 s) et on dedoublonne par update_id, ceinture et bretelles.

export const maxDuration = 120

const MAX_MESSAGES_CONSERVES = 20
const MAX_MESSAGE_LEN = 4000

const API_TG = 'https://api.telegram.org'

function jetonBot(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN_COCKPIT?.trim() || null
}

async function tg(methode: string, params: Record<string, unknown>): Promise<void> {
  const jeton = jetonBot()
  if (!jeton) return
  try {
    const reponse = await fetch(`${API_TG}/bot${jeton}/${methode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!reponse.ok) {
      const corps = await reponse.text()
      console.error(`[cockpit/telegram] ${methode} : ${corps.slice(0, 300)}`)
    }
  } catch (err) {
    console.error(`[cockpit/telegram] ${methode}`, err)
  }
}

type MessageStocke = { role: 'user' | 'assistant'; content: string }

type LigneConversation = {
  chat_id: bigint
  messages: unknown
  action_en_attente: unknown
  nonce: string | null
  dernier_update_id: bigint | null
}

async function chargerConversation(chatId: number): Promise<LigneConversation | null> {
  const lignes = await prisma.$queryRaw<LigneConversation[]>`
    select chat_id, messages, action_en_attente, nonce, dernier_update_id
    from public.cockpit_agent_conversations where chat_id = ${chatId}`
  return lignes[0] ?? null
}

export async function POST(req: NextRequest) {
  // Verrou 1 : la requete vient bien de Telegram.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const update = await req.json().catch(() => ({}))

  // ── Un clic sur Confirmer / Annuler ──────────────────────────────────────
  if (update.callback_query) {
    const cq = update.callback_query
    const chatId = Number(cq.message?.chat?.id)
    const telegramId = Number(cq.from?.id)
    const donnee = String(cq.data ?? '')

    // Toujours acquitter, sinon le bouton tourne indefiniment chez l'humain.
    const acquitter = (texte?: string) =>
      tg('answerCallbackQuery', { callback_query_id: cq.id, ...(texte ? { text: texte } : {}) })

    const compte = await prisma.$queryRaw<{ user_id: string }[]>`
      select user_id::text as user_id from public.cockpit_telegram_comptes
      where telegram_id = ${telegramId}`
    if (compte.length === 0 || !chatId) {
      await acquitter('Accès réservé.')
      return NextResponse.json({ ok: true })
    }

    const conv = await chargerConversation(chatId)
    const [verbe, nonce] = donnee.split(':')
    if (!conv || !conv.action_en_attente || !nonce || nonce !== conv.nonce) {
      await acquitter('Cette action n’est plus en attente.')
      return NextResponse.json({ ok: true })
    }

    let issue: string
    if (verbe === 'ok') {
      // Revalidation stricte : ce qui s'execute est ce qui a ete valide, pas
      // ce que porte le message Telegram.
      const action = validerAction(conv.action_en_attente)
      if (typeof action === 'string') {
        issue = `Action refusée : ${action}`
      } else {
        try {
          issue = `✓ ${await executerAction(action)}`
          console.log(`[cockpit/telegram/action] ${compte[0].user_id} ${action.type} ${action.compte}`, action.params)
        } catch (err) {
          issue = `L’action a échoué : ${err instanceof Error ? err.message : '?'}`
        }
      }
    } else {
      issue = '(action annulée, rien n’a été exécuté)'
    }

    const messages = (Array.isArray(conv.messages) ? conv.messages : []) as MessageStocke[]
    messages.push({ role: 'assistant', content: issue })
    await prisma.$executeRaw`
      update public.cockpit_agent_conversations
      set action_en_attente = null, nonce = null,
          messages = ${JSON.stringify(messages.slice(-MAX_MESSAGES_CONSERVES))}::jsonb,
          maj_le = now()
      where chat_id = ${chatId}`

    await acquitter()
    await tg('sendMessage', { chat_id: chatId, text: issue })
    return NextResponse.json({ ok: true })
  }

  // ── Un message texte ─────────────────────────────────────────────────────
  const message = update.message
  const texte = typeof message?.text === 'string' ? message.text.slice(0, MAX_MESSAGE_LEN).trim() : ''
  const chatId = Number(message?.chat?.id)
  const telegramId = Number(message?.from?.id)
  const updateId = Number(update.update_id ?? 0)
  if (!texte || !chatId || !telegramId) return NextResponse.json({ ok: true })

  // Verrou 2 : seuls Brice et Melanie. Un inconnu recoit son identifiant —
  // c'est la seule information qu'on lui donne, et c'est celle qu'il faut
  // pour l'ajouter a cockpit_telegram_comptes.
  const compte = await prisma.$queryRaw<{ user_id: string; libelle: string | null }[]>`
    select user_id::text as user_id, libelle from public.cockpit_telegram_comptes
    where telegram_id = ${telegramId}`
  if (compte.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `Accès réservé à l'équipe AOK. Ton identifiant Telegram : ${telegramId} — donne-le à Brice pour être ajouté.`,
    })
    return NextResponse.json({ ok: true })
  }

  const conv = await chargerConversation(chatId)

  // Dedoublonnage : Telegram rejoue les updates restes sans reponse rapide.
  if (conv?.dernier_update_id && updateId <= Number(conv.dernier_update_id)) {
    return NextResponse.json({ ok: true })
  }

  // /start ou /reset : repartir propre.
  if (texte === '/start' || texte === '/reset') {
    await prisma.$executeRaw`
      insert into public.cockpit_agent_conversations (chat_id, telegram_id, messages, dernier_update_id)
      values (${chatId}, ${telegramId}, '[]'::jsonb, ${updateId})
      on conflict (chat_id) do update
      set messages = '[]'::jsonb, action_en_attente = null, nonce = null,
          dernier_update_id = ${updateId}, maj_le = now()`
    await tg('sendMessage', {
      chat_id: chatId,
      text: `Agent du cockpit prêt. Pose ta question (impayés, encaissé, membres…) ou demande une action (code promo, remboursement…) — toute action attendra ta confirmation. /reset efface la conversation.`,
    })
    return NextResponse.json({ ok: true })
  }

  const messages = (Array.isArray(conv?.messages) ? conv!.messages : []) as MessageStocke[]
  messages.push({ role: 'user', content: texte })

  // L'historique pour le modele : notre format stocke est deja le sien.
  const historique: Anthropic.MessageParam[] = messages
    .filter((m) => m.content)
    .map((m) => ({ role: m.role, content: m.content }))

  let reponse
  try {
    reponse = await boucleAgent(historique, compte[0].user_id)
  } catch (err) {
    console.error('[cockpit/telegram]', err)
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'L’agent n’a pas pu répondre (erreur côté serveur). Réessaie dans un instant.',
    })
    return NextResponse.json({ ok: true })
  }

  messages.push({ role: 'assistant', content: reponse.reply })

  if (reponse.action) {
    const { resume, cle_presente, ...action } = reponse.action
    if (!cle_presente) {
      await prisma.$executeRaw`
        insert into public.cockpit_agent_conversations (chat_id, telegram_id, messages, dernier_update_id)
        values (${chatId}, ${telegramId}, ${JSON.stringify(messages.slice(-MAX_MESSAGES_CONSERVES))}::jsonb, ${updateId})
        on conflict (chat_id) do update
        set messages = excluded.messages, dernier_update_id = ${updateId}, maj_le = now()`
      await tg('sendMessage', {
        chat_id: chatId,
        text: `${reponse.reply}\n\n⚠️ ${resume}\n\nLa clé d'écriture du compte ${action.compte} n'est pas posée : rien ne peut être exécuté.`,
      })
      return NextResponse.json({ ok: true })
    }

    // Verrou 3 : l'action attend le POUCE. Le nonce lie les boutons de CE
    // message a CETTE action ; une nouvelle proposition remplace l'ancienne.
    const nonce = randomUUID().slice(0, 8)
    await prisma.$executeRaw`
      insert into public.cockpit_agent_conversations
        (chat_id, telegram_id, messages, action_en_attente, nonce, dernier_update_id)
      values (${chatId}, ${telegramId}, ${JSON.stringify(messages.slice(-MAX_MESSAGES_CONSERVES))}::jsonb,
              ${JSON.stringify(action)}::jsonb, ${nonce}, ${updateId})
      on conflict (chat_id) do update
      set messages = excluded.messages, action_en_attente = excluded.action_en_attente,
          nonce = excluded.nonce, dernier_update_id = ${updateId}, maj_le = now()`
    await tg('sendMessage', {
      chat_id: chatId,
      text: `${reponse.reply}\n\n⚠️ ${resume}`,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Confirmer et exécuter', callback_data: `ok:${nonce}` },
          { text: '❌ Annuler', callback_data: `non:${nonce}` },
        ]],
      },
    })
    return NextResponse.json({ ok: true })
  }

  await prisma.$executeRaw`
    insert into public.cockpit_agent_conversations (chat_id, telegram_id, messages, dernier_update_id)
    values (${chatId}, ${telegramId}, ${JSON.stringify(messages.slice(-MAX_MESSAGES_CONSERVES))}::jsonb, ${updateId})
    on conflict (chat_id) do update
    set messages = excluded.messages, action_en_attente = null, nonce = null,
        dernier_update_id = ${updateId}, maj_le = now()`
  await tg('sendMessage', { chat_id: chatId, text: reponse.reply })
  return NextResponse.json({ ok: true })
}
