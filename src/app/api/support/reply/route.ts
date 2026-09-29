import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { envoyer } from '@/lib/liveclub/telegram'
import { ajouterReponseEquipe, telegramDuFil, texteReponseEquipe } from '@/lib/liveclub/support-pont'

/**
 * POST /api/support/reply — la prise de main humaine depuis le cockpit.
 *
 * Réservé à l'allowlist du cockpit (`cockpit_allowlist`, la même qui garde
 * tout l'écran) : être authentifié ne prouve rien, le projet Supabase est
 * partagé avec un site à inscription publique.
 *
 * Ajoute un message `role: 'human'` au fil et remet `escalatedAt` à null :
 * la demande d'humain est prise en main. Le membre voit la réponse dans le
 * chat de son extension (qui recharge le fil à l'ouverture).
 *
 * Fil 'telegram' (bot membre Live Club, decision Brice du 29/09) : le membre
 * n'a pas de chat a rouvrir, la reponse lui PART dans Telegram par le bot
 * (sendMessage, jeton TELEGRAM_LIVECLUB_BOT_TOKEN). On envoie AVANT
 * d'enregistrer : si Telegram refuse (membre qui a bloque le bot, jeton
 * absent), rien n'est ecrit, la demande reste en attente et le cockpit
 * affiche la raison. Livre puis echec d'ecriture : 500 avec
 * livreTelegram=true, enregistre=false, pour que l'equipe ne renvoie pas.
 * La valeur app 'telegram' est reservee au pont (chat et escalate la
 * remplacent par leur valeur par defaut), un fil du site ne peut donc pas se faire passer pour un fil
 * Telegram.
 *
 * CORS : le cockpit (cockpit.aoknowledge.com) appelle depuis le navigateur,
 * contrairement à l'extension qui échappe au CORS par ses host_permissions.
 */

const MAX_MESSAGE_LEN = 4000

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  // Le garde réel : l'allowlist du cockpit, par UUID.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })
  }

  const body = await req.json().catch(() => ({}))
  const threadId = typeof body.threadId === 'string' ? body.threadId : null
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : ''
  if (!threadId || !message) {
    return NextResponse.json({ error: 'threadId et message requis' }, { status: 400, headers })
  }

  const thread = await prisma.supportThread.findUnique({ where: { id: threadId } })
  if (!thread) return NextResponse.json({ error: 'Fil introuvable' }, { status: 404, headers })

  if (thread.app === 'telegram') {
    let telegramId: number | null
    try {
      telegramId = await telegramDuFil(thread.id)
    } catch (err) {
      console.error('[support/reply] compte Telegram illisible:', err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'erreur')
      return NextResponse.json({ error: 'Compte Telegram du fil illisible (migration 20260930090100 appliquée ?).' }, { status: 500, headers })
    }
    if (!telegramId) {
      return NextResponse.json({ error: 'Ce fil Telegram ne porte aucun compte : réponse impossible à livrer.' }, { status: 409, headers })
    }
    const envoi = await envoyer(telegramId, texteReponseEquipe(message))
    if (!envoi.ok) {
      const raison = envoi.code === 403
        ? 'le membre a bloqué le bot'
        : envoi.code === 400 ? 'conversation Telegram introuvable' : envoi.erreur
      return NextResponse.json({ error: `Réponse non livrée dans Telegram : ${raison}.` }, { status: 502, headers })
    }

    // Livre : on enregistre en UNE requete (concatenation jsonb). L'envoi peut
    // durer (jusqu'a ~20 s avec les rejeux sur 429) : reecrire le tableau lu
    // avant l'envoi effacerait ce que le membre a ecrit entre-temps.
    try {
      const maj = await ajouterReponseEquipe(thread.id, message, thread.escalatedAt)
      if (!maj) throw new Error('fil disparu pendant l\'envoi')
      return NextResponse.json({
        ok: true,
        livreTelegram: true,
        enregistre: true,
        messages: maj.messages,
        escalatedAt: maj.escalatedAt,
      }, { headers })
    } catch (err) {
      console.error('[support/reply] reponse livree mais non enregistree:', err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'erreur')
      return NextResponse.json({
        ok: false,
        livreTelegram: true,
        enregistre: false,
        error: 'Réponse livrée dans Telegram mais non enregistrée dans le fil : ne la renvoie pas, le membre l\'a déjà reçue.',
      }, { status: 500, headers })
    }
  }

  const messages = (Array.isArray(thread.messages) ? thread.messages : []) as unknown[]
  const nouveau = { role: 'human', content: message, at: new Date().toISOString() }

  const maj = await prisma.supportThread.update({
    where: { id: thread.id },
    data: {
      messages: [...messages, nouveau] as object[],
      // La demande d'humain est prise en main : la chip « veut un humain »
      // s'éteint dans le cockpit. Une nouvelle escalade la rallumera.
      escalatedAt: null,
    },
  })

  return NextResponse.json({ ok: true, messages: maj.messages, escalatedAt: null, livreTelegram: false }, { headers })
}
