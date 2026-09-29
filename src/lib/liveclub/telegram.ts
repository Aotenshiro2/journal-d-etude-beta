// Appels Telegram du bot des membres @aok_liveclub_bot (29/09). Meme jeton
// que les gestes d'admin (TELEGRAM_LIVECLUB_BOT_TOKEN).
//
// Limites Telegram : ~1 message/seconde par chat, ~30/s au total. Sur un 429,
// on attend retry_after (plafonne pour tenir dans la duree d'une fonction
// Vercel) puis on rejoue, deux fois au plus. Jamais de texte de message ni de
// lien d'invitation dans les logs.

import { chatId } from './config'
import { callbackDataValide, messageErreur, nomLienInvitation } from './pur'

const API_TG = 'https://api.telegram.org'
const ATTENTE_MAX_S = 10

export type ResultatTelegram =
  | { ok: true; result: unknown }
  | { ok: false; erreur: string; code: number | null }

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Appel brut qui ne jette pas, avec respect de retry_after. */
export async function appelTelegram(methode: string, corps: Record<string, unknown>): Promise<ResultatTelegram> {
  const jeton = process.env.TELEGRAM_LIVECLUB_BOT_TOKEN?.trim()
  if (!jeton) return { ok: false, erreur: 'TELEGRAM_LIVECLUB_BOT_TOKEN absent du projet journal.', code: null }
  for (let essai = 0; essai < 3; essai++) {
    let json: { ok?: boolean; description?: string; error_code?: number; result?: unknown; parameters?: { retry_after?: number } }
    try {
      const reponse = await fetch(`${API_TG}/bot${jeton}/${methode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      })
      json = await reponse.json()
    } catch (err) {
      return { ok: false, erreur: `Telegram ${methode} : ${messageErreur(err)}`, code: null }
    }
    if (json.ok) return { ok: true, result: json.result }
    const attente = json.parameters?.retry_after
    if (json.error_code === 429 && typeof attente === 'number' && essai < 2) {
      await pause(Math.min(attente, ATTENTE_MAX_S) * 1000)
      continue
    }
    return {
      ok: false,
      erreur: `Telegram ${methode} : ${String(json.description ?? '?').slice(0, 200)}`,
      code: json.error_code ?? null,
    }
  }
  return { ok: false, erreur: `Telegram ${methode} : trop de requetes.`, code: 429 }
}

/** Un bouton : callback_data (<= 64 octets) OU url. */
export type Bouton = { texte: string; data?: string; url?: string }

function clavier(boutons: Bouton[][]): { inline_keyboard: Record<string, string>[][] } {
  return {
    inline_keyboard: boutons.map(ligne => ligne.map((b): Record<string, string> => {
      if (b.url) return { text: b.texte, url: b.url }
      if (!b.data || !callbackDataValide(b.data)) throw new Error(`callback_data invalide (1 a 64 octets) : « ${b.texte} ».`)
      return { text: b.texte, callback_data: b.data }
    })),
  }
}

export type OptionsEnvoi = { html?: boolean; apercuLien?: boolean }

/**
 * Message a un chat (prive en general). Ne jette pas : ok false avec le code
 * Telegram (403 = le membre a bloque le bot ou ne lui a jamais ecrit, 400 =
 * chat introuvable), pour que l'appelant bascule sur l'email.
 */
export async function envoyer(
  chat: number,
  texte: string,
  boutons?: Bouton[][],
  options: OptionsEnvoi = {},
): Promise<ResultatTelegram & { messageId?: number }> {
  let markup: ReturnType<typeof clavier> | undefined
  try {
    markup = boutons?.length ? clavier(boutons) : undefined
  } catch (err) {
    return { ok: false, erreur: messageErreur(err), code: null }
  }
  const r = await appelTelegram('sendMessage', {
    chat_id: chat,
    text: texte.slice(0, 4096),
    ...(options.html ? { parse_mode: 'HTML' } : {}),
    ...(options.apercuLien ? {} : { link_preview_options: { is_disabled: true } }),
    ...(markup ? { reply_markup: markup } : {}),
  })
  if (!r.ok) return r
  return { ...r, messageId: (r.result as { message_id?: number } | undefined)?.message_id }
}

/** Toujours repondre a un callback_query (sinon le bouton tourne dans le vide). */
export async function repondreBouton(callbackQueryId: string, texte?: string): Promise<ResultatTelegram> {
  return appelTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(texte ? { text: texte.slice(0, 200) } : {}),
  })
}

/** Retire les boutons d'un message deja envoye (apres une confirmation). */
export async function retirerBoutons(chat: number, messageId: number): Promise<ResultatTelegram> {
  return appelTelegram('editMessageReplyMarkup', {
    chat_id: chat, message_id: messageId, reply_markup: { inline_keyboard: [] },
  })
}

function chatOuErreur(): number {
  const c = chatId()
  if (!c) throw new Error('TELEGRAM_LIVECLUB_CHAT_ID absent ou illisible du projet journal.')
  return c
}

/**
 * Lien de DEMANDE d'adhesion (creates_join_request=true, donc sans
 * member_limit, incompatible), valable 14 jours. La demande arrive au bot en
 * chat_join_request, qui l'approuve ou la refuse. Le lien part a la personne,
 * jamais en base ni dans un log. Jette si Telegram refuse.
 */
export async function lienDemandeAdhesion(nom: string): Promise<string> {
  const r = await appelTelegram('createChatInviteLink', {
    chat_id: chatOuErreur(),
    name: nomLienInvitation(nom),
    expire_date: Math.floor(Date.now() / 1000) + 14 * 86400,
    creates_join_request: true,
  })
  if (!r.ok) throw new Error(r.erreur)
  const lien = (r.result as { invite_link?: string } | undefined)?.invite_link
  if (!lien) throw new Error("Telegram n'a renvoye aucun lien d'invitation.")
  return lien
}

const SANS_CHAT: ResultatTelegram = { ok: false, erreur: 'TELEGRAM_LIVECLUB_CHAT_ID absent ou illisible du projet journal.', code: null }

/** Ne jette pas. Ecrire au demandeur AVANT (5 minutes, tant que la demande est en attente). */
export async function approuverDemande(userId: number): Promise<ResultatTelegram> {
  const c = chatId()
  return c ? appelTelegram('approveChatJoinRequest', { chat_id: c, user_id: userId }) : SANS_CHAT
}

/** Ne jette pas. Ecrire au demandeur AVANT (5 minutes, tant que la demande est en attente). */
export async function refuserDemande(userId: number): Promise<ResultatTelegram> {
  const c = chatId()
  return c ? appelTelegram('declineChatJoinRequest', { chat_id: c, user_id: userId }) : SANS_CHAT
}

/**
 * Present dans le groupe ? getChatMember : member, administrator, creator,
 * ou restricted avec is_member = oui ; left, kicked, restricted hors groupe =
 * non ; panne ou configuration absente = inconnu.
 */
export async function estDansLeGroupe(telegramId: number): Promise<'oui' | 'non' | 'inconnu'> {
  const c = chatId()
  if (!c) return 'inconnu'
  const r = await appelTelegram('getChatMember', { chat_id: c, user_id: telegramId })
  if (!r.ok) {
    // « user not found » / « participant_id_invalid » : jamais venu dans le groupe.
    if (r.code === 400 && /user not found|participant_id_invalid|member not found/i.test(r.erreur)) return 'non'
    return 'inconnu'
  }
  const m = r.result as { status?: string; is_member?: boolean } | undefined
  const statut = String(m?.status ?? '')
  if (statut === 'member' || statut === 'administrator' || statut === 'creator') return 'oui'
  if (statut === 'restricted') return m?.is_member === true ? 'oui' : 'non'
  if (statut === 'left' || statut === 'kicked') return 'non'
  return 'inconnu'
}

/** Statut Telegram brut dans le groupe (pour refuser admins et createur), null si illisible. */
export async function statutDansLeGroupe(telegramId: number): Promise<string | null> {
  const c = chatId()
  if (!c) return null
  const r = await appelTelegram('getChatMember', { chat_id: c, user_id: telegramId })
  if (!r.ok) return null
  return String((r.result as { status?: string } | undefined)?.status ?? '') || null
}
