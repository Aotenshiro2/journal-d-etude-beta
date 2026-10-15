import { NextRequest, NextResponse } from 'next/server'
import {
  compteCockpitTelegram, telechargerImageTelegram, traiterClicAgentTelegram, traiterTexteAgentTelegram, tgCockpit,
} from '@/lib/agent-cockpit-telegram'
import {
  lireMessageTelegram, texteDuTour, texteEchecImage, texteImageTropGrosse, texteNonLu, type ImageDuTour,
} from '@/lib/agent-cockpit-telegram-pur'

// Le canal TELEGRAM de l'agent cockpit (go Brice 04/09) : meme cerveau que la
// fenetre ✦ du cockpit (src/lib/agent-cockpit.ts), autre porte d'entree.
//
// Depuis le 08/10, le TRAITEMENT vit dans src/lib/agent-cockpit-telegram.ts :
// le bot des membres (@aok_liveclub_bot) y transmet le texte libre d'un compte
// de l'equipe, qui recoit la reponse ici, dans Agent AOK. Cette route ne garde
// que ce qui est propre au webhook d'Agent AOK : le secret, la lecture de
// l'update, et la reponse a un inconnu.
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
// Telegram REJOUE un update reste sans 200 : on traite en synchrone (l'agent
// peut prendre 30 s) et on dedoublonne par update_id, ceinture et bretelles.

export const maxDuration = 120

export async function POST(req: NextRequest) {
  // Verrou 1 : la requete vient bien de Telegram.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const update = await req.json().catch(() => ({}))

  // ── Un clic sur Confirmer / Annuler ──────────────────────────────────────
  if (update.callback_query) {
    await traiterClicAgentTelegram(update.callback_query)
    return NextResponse.json({ ok: true })
  }

  // ── Un message : texte, photo, capture en fichier, legende, transfert ────
  // (15/10, Brice) Avant, seul message.text etait lu : une photo, sa legende
  // ou un message transfere portant une image etaient ignores EN SILENCE.
  // La lecture est pure (lireMessageTelegram) ; rien n'est telecharge avant
  // le verrou 2.
  const message = update.message
  const chatId = Number(message?.chat?.id)
  const telegramId = Number(message?.from?.id)
  const updateId = Number(update.update_id ?? 0)
  if (!message || !chatId || !telegramId) return NextResponse.json({ ok: true })
  const lecture = lireMessageTelegram(message)
  if (lecture.genre === 'vide') return NextResponse.json({ ok: true })

  // Verrou 2 : seuls Brice et Melanie. Un inconnu recoit son identifiant —
  // c'est la seule information qu'on lui donne, et c'est celle qu'il faut
  // pour l'ajouter a cockpit_telegram_comptes.
  const compte = await compteCockpitTelegram(telegramId)
  if (!compte) {
    await tgCockpit('sendMessage', {
      chat_id: chatId,
      text: `Accès réservé à l'équipe AOK. Ton identifiant Telegram : ${telegramId} — donne-le à Brice pour être ajouté.`,
    })
    return NextResponse.json({ ok: true })
  }

  // Ce que l'agent ne lit pas, ou une image trop lourde : dit en clair, sans
  // appeler le modele.
  if (lecture.genre === 'trop_gros') {
    await tgCockpit('sendMessage', { chat_id: chatId, text: texteImageTropGrosse(lecture.taille) })
    return NextResponse.json({ ok: true })
  }
  if (lecture.genre === 'non_lu') {
    await tgCockpit('sendMessage', { chat_id: chatId, text: texteNonLu(lecture.quoi) })
    return NextResponse.json({ ok: true })
  }

  // L'image, avec le jeton d'Agent AOK (le file_id ne vaut que pour lui).
  let image: ImageDuTour | null = null
  if (lecture.image) {
    const issue = await telechargerImageTelegram('cockpit', lecture.image)
    if (!issue.ok) {
      await tgCockpit('sendMessage', { chat_id: chatId, text: texteEchecImage(issue) })
      return NextResponse.json({ ok: true })
    }
    image = issue.image
  }

  await traiterTexteAgentTelegram({ chatId, telegramId, texte: texteDuTour(lecture), image, compte, updateId })
  return NextResponse.json({ ok: true })
}
