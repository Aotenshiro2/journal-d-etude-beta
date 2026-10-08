import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { boucleAgent } from '@/lib/agent-cockpit'
import { auteurDemande } from '@/lib/agent-cockpit-pur'
import { validerAction, executerAction, RefusAction, expurgerLiensInvitation, paramsPourLog } from '@/lib/stripe-actions'

// Le TRAITEMENT du canal Telegram de l'agent cockpit (« Agent AOK »), sorti de
// la route /api/cockpit/agent/telegram le 08/10 pour servir a deux portes :
// - la route du bot Agent AOK (webhook, secret verifie par elle) ;
// - le bot des MEMBRES (@aok_liveclub_bot, liveclub/bot-membre.ts) : un compte
//   de l'equipe qui y ecrit du texte libre voit sa demande transmise ici,
//   exactement comme s'il l'avait ecrite a Agent AOK (meme conversation, memes
//   verrous, meme carte de confirmation), la reponse arrivant dans Agent AOK.
//
// Meme cerveau que la fenetre ✦ du cockpit (src/lib/agent-cockpit.ts).
//
// SECURITE, trois verrous, dans cet ordre :
// 1. Le secret de webhook (verifie par chaque route, jamais ici).
// 2. L'identifiant Telegram de l'EXPEDITEUR doit exister dans
//    cockpit_telegram_comptes (rempli a la main : Brice, Melanie).
// 3. Les actions gardent leur confirmation HUMAINE : boutons inline
//    Confirmer/Annuler, l'execution ne part qu'au clic (callback_query, sur le
//    bot Agent AOK), avec revalidation des parametres.
//
// La conversation est PERSISTEE cote serveur (cockpit_agent_conversations),
// contrairement au web ou le navigateur porte l'historique : Telegram ne
// renvoie que le dernier message. Toujours du TEXTE BRUT, comme au web.

const MAX_MESSAGES_CONSERVES = 20
export const MAX_MESSAGE_LEN = 4000

const API_TG = 'https://api.telegram.org'

function jetonBot(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN_COCKPIT?.trim() || null
}

/**
 * Appel a l'API du bot Agent AOK. Ne jette jamais : true si Telegram a
 * accepte (un refus est loggue, sans le texte du message).
 */
export async function tgCockpit(methode: string, params: Record<string, unknown>): Promise<boolean> {
  const jeton = jetonBot()
  if (!jeton) {
    console.error(`[cockpit/telegram] ${methode} : TELEGRAM_BOT_TOKEN_COCKPIT absent du projet journal`)
    return false
  }
  try {
    const reponse = await fetch(`${API_TG}/bot${jeton}/${methode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!reponse.ok) {
      const corps = await reponse.text()
      console.error(`[cockpit/telegram] ${methode} : ${corps.slice(0, 300)}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[cockpit/telegram] ${methode}`, err)
    return false
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

// HISTORIQUE EN AJOUT, JAMAIS EN REECRITURE (29/09) : l'agent peut reflechir
// deux minutes sur un message texte, et un clic Confirmer peut tomber pendant
// ce temps. Si chaque chemin reecrivait l'historique qu'il a lu au depart, le
// dernier a ecrire effacerait les lignes de l'autre, dont la ligne « ✓ » d'un
// remboursement fait : au tour suivant, le modele ne saurait plus qu'il est
// fait et pourrait le reproposer. Chaque ecriture AJOUTE donc ses messages a
// l'historique present en base au moment de l'ecriture, et la borne aux
// MAX_MESSAGES_CONSERVES derniers est appliquee en SQL, dans la meme
// instruction.
function historiqueAvecAjout(actuel: Prisma.Sql, ajout: Prisma.Sql): Prisma.Sql {
  const tout = Prisma.sql`((case when jsonb_typeof(${actuel}) = 'array' then ${actuel} else '[]'::jsonb end) || ${ajout})`
  return Prisma.sql`(select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
    from jsonb_array_elements(${tout}) with ordinality as a(e, i)
    where i > jsonb_array_length(${tout}) - ${MAX_MESSAGES_CONSERVES}::int)`
}

// Dans un « on conflict do update » : l'historique de la ligne existante,
// complete par les messages que porte l'insert. Les inserts qui l'utilisent
// nomment la table « c » (insert into ... as c).
const HISTORIQUE_UPSERT = historiqueAvecAjout(Prisma.raw('c.messages'), Prisma.raw('excluded.messages'))

export type CompteCockpitTelegram = { user_id: string; libelle: string | null }

/**
 * Le compte du cockpit derriere un identifiant Telegram (verrou 2), ou null.
 * Jette si la base ne repond pas.
 */
export async function compteCockpitTelegram(telegramId: number): Promise<CompteCockpitTelegram | null> {
  const lignes = await prisma.$queryRaw<CompteCockpitTelegram[]>`
    select user_id::text as user_id, libelle from public.cockpit_telegram_comptes
    where telegram_id = ${telegramId}`
  return lignes[0] ?? null
}

/** Formes minimales d'un clic sur un bouton inline d'Agent AOK. */
export type ClicAgentTelegram = {
  id: string
  data?: string
  from?: { id?: number }
  message?: { chat?: { id?: number } }
}

/** Un clic sur Confirmer / Annuler d'une carte d'Agent AOK. */
export async function traiterClicAgentTelegram(cq: ClicAgentTelegram): Promise<void> {
  const chatId = Number(cq.message?.chat?.id)
  const telegramId = Number(cq.from?.id)
  const donnee = String(cq.data ?? '')

  // Toujours acquitter, sinon le bouton tourne indefiniment chez l'humain.
  const acquitter = (texte?: string) =>
    tgCockpit('answerCallbackQuery', { callback_query_id: cq.id, ...(texte ? { text: texte } : {}) })

  const compte = Number.isSafeInteger(telegramId) ? await compteCockpitTelegram(telegramId) : null
  if (!compte || !chatId) {
    await acquitter('Accès réservé.')
    return
  }

  const [verbe, nonce] = donnee.split(':')
  if (!nonce || (verbe !== 'ok' && verbe !== 'non')) {
    await acquitter('Cette action n\'est plus en attente.')
    return
  }

  // CONSOMMATION ATOMIQUE AVANT EXECUTION (29/09) : la carte est retiree de
  // la conversation par UN update conditionne au nonce, et seul l'appel qui
  // recupere la ligne va plus loin. Deux clics rapproches, ou un rejeu
  // Telegram du meme callback, arrivent chacun ici : le premier emporte
  // l'action, le second ne trouve plus rien (nonce deja a null) et n'execute
  // rien. Annuler passe par la meme porte, pour qu'un Annuler et un Confirmer
  // croises ne fassent pas les deux. Contrepartie assumee : si l'execution
  // tombe en panne, la carte est perdue et il faut la redemander a l'agent.
  // On ne rejoue jamais seul un geste qui a pu partir a moitie.
  // RETURNING d'un UPDATE rend la ligne APRES modification : il rendrait
  // donc l'action deja remise a null (bug constate au premier test le 29/09,
  // « Action illisible »). La CTE verrouille la ligne et garde l'ancienne
  // valeur ; l'UPDATE qui suit la vide, et on rend la valeur gardee.
  const consommee = await prisma.$queryRaw<{ action_en_attente: unknown }[]>`
    with carte as (
      select chat_id, action_en_attente as action_avant
      from public.cockpit_agent_conversations
      where chat_id = ${chatId} and nonce = ${nonce} and action_en_attente is not null
      for update
    )
    update public.cockpit_agent_conversations c
    set action_en_attente = null, nonce = null, maj_le = now()
    from carte
    where c.chat_id = carte.chat_id
    returning carte.action_avant as action_en_attente`
  if (consommee.length === 0) {
    await acquitter('Cette action n\'est plus en attente.')
    return
  }

  let issue: string
  if (verbe === 'ok') {
    // Revalidation stricte : ce qui s'execute est ce qui a ete valide, pas
    // ce que porte le message Telegram.
    const action = validerAction(consommee[0].action_en_attente)
    if (typeof action === 'string') {
      issue = `Action refusée : ${action}`
    } else {
      try {
        issue = `✓ ${await executerAction(action, `agent:${compte.user_id}`)}`
        console.log(`[cockpit/telegram/action] ${compte.user_id} ${action.type} ${action.compte}`, paramsPourLog(action))
      } catch (err) {
        issue = err instanceof RefusAction
          ? `Rien n’a été fait. ${err.message}`
          : `L’action a échoué : ${err instanceof Error ? err.message : '?'}`
      }
    }
  } else {
    issue = '(action annulée, rien n’a été exécuté)'
  }

  // LE RESULTAT PART D'ABORD (29/09) : la carte est deja consommee, donc si
  // la route tombait ici en 500, le rejeu Telegram ne trouverait plus rien
  // et l'humain ne verrait que « plus en attente », sans le resultat ni le
  // lien d'invitation, qui n'existe nulle part ailleurs. L'ecriture de
  // l'historique vient apres, et son echec est journalise sans rien casser.
  await acquitter()
  await tgCockpit('sendMessage', { chat_id: chatId, text: issue })

  // Ajout a l'historique present en base, pas reecriture d'un historique lu
  // plus tot (voir historiqueAvecAjout). Cet update ne touche qu'aux
  // messages : une nouvelle carte proposee entre-temps garde son action et
  // son nonce. L'humain a recu le lien d'invitation ci-dessus, la
  // conversation conservee n'en garde qu'une mention.
  try {
    const ligne = JSON.stringify([{ role: 'assistant', content: expurgerLiensInvitation(issue) }])
    await prisma.$executeRaw`
      update public.cockpit_agent_conversations
      set messages = ${historiqueAvecAjout(Prisma.raw('messages'), Prisma.sql`${ligne}::jsonb`)},
          maj_le = now()
      where chat_id = ${chatId}`
  } catch (err) {
    console.error('[cockpit/telegram] historique apres action', err)
  }
}

export type EntreeAgentTelegram = {
  /** La conversation avec Agent AOK (en prive, l'id du chat est celui du compte). */
  chatId: number
  telegramId: number
  texte: string
  compte: CompteCockpitTelegram
  /**
   * update_id du bot Agent AOK, pour le dedoublonnage. null = message transmis
   * par le bot des membres, deja dedoublonne par lui (ses update_id suivent
   * une autre sequence : les ecrire ici ferait ignorer les vrais messages
   * d'Agent AOK).
   */
  updateId: number | null
  /** Transmis par le bot des membres : un accuse le rappelle en tete, dans Agent AOK. */
  transmis?: boolean
  /** Transmis seulement : appele des que l'accuse est livre dans Agent AOK, avant que l'agent reflechisse. */
  apresAccuse?: () => Promise<void>
}

/**
 * 'traite' : le message a ete pris en charge (reponse, carte, ou erreur dite
 * dans Agent AOK). 'doublon' : update deja traite. 'non_livre' (transmis
 * seulement) : Agent AOK n'a pas pu recevoir l'accuse (bot jamais ouvert par
 * ce compte, jeton absent, panne Telegram), rien n'a ete fait.
 */
export type IssueAgentTelegram = 'traite' | 'doublon' | 'non_livre'

const TEXTE_ERREUR_AGENT = 'L’agent n’a pas pu répondre (erreur côté serveur). Réessaie dans un instant.'

/**
 * Un message texte pour l'agent, d'ou qu'il vienne. Un message TRANSMIS par
 * le bot des membres passe d'abord par un accuse dans Agent AOK : s'il n'est
 * pas livre, rien n'est fait ('non_livre') ; s'il l'est, toute panne qui suit
 * est dite dans Agent AOK, jamais renvoyee a l'appelant. Un message d'Agent
 * AOK lui-meme garde le comportement d'avant : une panne de la base jette, la
 * route rend une erreur et Telegram rejoue.
 */
export async function traiterTexteAgentTelegram(e: EntreeAgentTelegram): Promise<IssueAgentTelegram> {
  if (!e.transmis) return tourAgent(e)

  const extrait = e.texte.trim().slice(0, 1500)
  const livre = await tgCockpit('sendMessage', {
    chat_id: e.chatId,
    text: `Reçu depuis le bot Live Club :\n\n${extrait}`,
  })
  if (!livre) return 'non_livre'
  try {
    await e.apresAccuse?.()
  } catch (err) {
    console.warn('[cockpit/telegram] accuse cote bot des membres', err)
  }
  try {
    return await tourAgent(e)
  } catch (err) {
    console.error('[cockpit/telegram] demande transmise par le bot des membres', err)
    await tgCockpit('sendMessage', { chat_id: e.chatId, text: TEXTE_ERREUR_AGENT })
    return 'traite'
  }
}

async function tourAgent(e: EntreeAgentTelegram): Promise<IssueAgentTelegram> {
  const { chatId, telegramId, compte, updateId } = e
  const texte = e.texte.slice(0, MAX_MESSAGE_LEN).trim()
  if (!texte) return 'traite'

  const conv = await chargerConversation(chatId)

  // Dedoublonnage : Telegram rejoue les updates restes sans reponse rapide.
  if (updateId !== null && conv?.dernier_update_id && updateId <= Number(conv.dernier_update_id)) {
    return 'doublon'
  }

  // Un message transmis (updateId null) ne touche pas au dernier update_id
  // d'Agent AOK, et n'a pas besoin du garde anti-rejeu des upserts : le bot
  // des membres l'a deja dedoublonne.
  const majUpdate = updateId === null
    ? Prisma.sql`c.dernier_update_id`
    : Prisma.sql`greatest(c.dernier_update_id, excluded.dernier_update_id)`
  const garde = updateId === null
    ? Prisma.sql`true`
    : Prisma.sql`c.dernier_update_id is distinct from excluded.dernier_update_id`

  // /start ou /reset : repartir propre.
  if (texte === '/start' || texte === '/reset') {
    await prisma.$executeRaw`
      insert into public.cockpit_agent_conversations as c (chat_id, telegram_id, messages, dernier_update_id)
      values (${chatId}, ${telegramId}, '[]'::jsonb, ${updateId})
      on conflict (chat_id) do update
      set messages = '[]'::jsonb, action_en_attente = null, nonce = null,
          dernier_update_id = ${majUpdate}, maj_le = now()`
    await tgCockpit('sendMessage', {
      chat_id: chatId,
      text: `Agent du cockpit prêt. Pose ta question (impayés, encaissé, membres…) ou demande une action (code promo, remboursement…) — toute action attendra ta confirmation. /reset efface la conversation.`,
    })
    return 'traite'
  }

  // Cet instantane ne sert QU'AU MODELE : il n'est jamais reecrit en base.
  // En fin de tour, seuls les deux messages de ce tour (question et reponse)
  // sont ajoutes a l'historique present en base a ce moment-la (voir
  // historiqueAvecAjout), pour ne pas effacer une ligne « ✓ » ecrite par un
  // clic Confirmer pendant que l'agent reflechissait.
  const messages = (Array.isArray(conv?.messages) ? conv!.messages : []) as MessageStocke[]
  messages.push({ role: 'user', content: texte })

  // L'historique pour le modele : notre format stocke est deja le sien.
  const historique: Anthropic.MessageParam[] = messages
    .filter((m) => m.content)
    .map((m) => ({ role: m.role, content: m.content }))

  // SIGNE DE VIE (retour Brice 25/09) : sur une question lourde l'agent peut
  // prendre une ou deux minutes, et un silence de deux minutes ressemble a une
  // panne. Un accuse court part tout de suite, puis l'indicateur « en train
  // d'ecrire » est rafraichi toutes les 4 s (Telegram l'efface au bout de 5)
  // jusqu'a la reponse. L'accuse n'entre pas dans l'historique du modele.
  await tgCockpit('sendMessage', { chat_id: chatId, text: 'Je vérifie…' })
  await tgCockpit('sendChatAction', { chat_id: chatId, action: 'typing' })
  const battement = setInterval(() => {
    void tgCockpit('sendChatAction', { chat_id: chatId, action: 'typing' })
  }, 4000)

  let reponse
  try {
    // Une demande notee depuis Telegram porte le libelle du compte (08/10).
    reponse = await boucleAgent(historique, compte.user_id, {
      source: 'agent_telegram',
      auteur: auteurDemande({ libelle: compte.libelle, userId: compte.user_id }),
    })
  } catch (err) {
    clearInterval(battement)
    console.error('[cockpit/telegram]', err)
    await tgCockpit('sendMessage', { chat_id: chatId, text: TEXTE_ERREUR_AGENT })
    return 'traite'
  }

  clearInterval(battement)
  // Les deux messages de ce tour, les seuls que ce chemin ecrit en base. Un
  // rejeu Telegram du MEME update, traite en parallele, n'ajoute rien une
  // seconde fois : la clause where de chaque upsert l'ecarte quand ce
  // update_id est deja ecrit.
  const tour = JSON.stringify([
    { role: 'user', content: texte },
    { role: 'assistant', content: reponse.reply },
  ] satisfies MessageStocke[])

  if (reponse.action) {
    const { resume, cle_presente, cle_manquante, ...action } = reponse.action
    if (!cle_presente) {
      await prisma.$executeRaw`
        insert into public.cockpit_agent_conversations as c (chat_id, telegram_id, messages, dernier_update_id)
        values (${chatId}, ${telegramId}, ${tour}::jsonb, ${updateId})
        on conflict (chat_id) do update
        set messages = ${HISTORIQUE_UPSERT},
            dernier_update_id = ${majUpdate}, maj_le = now()
        where ${garde}`
      await tgCockpit('sendMessage', {
        chat_id: chatId,
        text: `${reponse.reply}\n\n⚠️ ${resume}\n\n${cle_manquante
          ?? `La clé d'écriture du compte ${action.compte} n'est pas posée : rien ne peut être exécuté.`}`,
      })
      return 'traite'
    }

    // Verrou 3 : l'action attend le POUCE. Le nonce lie les boutons de CE
    // message a CETTE action ; une nouvelle proposition remplace l'ancienne.
    const nonce = randomUUID().slice(0, 8)
    await prisma.$executeRaw`
      insert into public.cockpit_agent_conversations as c
        (chat_id, telegram_id, messages, action_en_attente, nonce, dernier_update_id)
      values (${chatId}, ${telegramId}, ${tour}::jsonb,
              ${JSON.stringify(action)}::jsonb, ${nonce}, ${updateId})
      on conflict (chat_id) do update
      set messages = ${HISTORIQUE_UPSERT}, action_en_attente = excluded.action_en_attente,
          nonce = excluded.nonce,
          dernier_update_id = ${majUpdate}, maj_le = now()
      where ${garde}`
    await tgCockpit('sendMessage', {
      chat_id: chatId,
      text: `${reponse.reply}\n\n⚠️ ${resume}`,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Confirmer et exécuter', callback_data: `ok:${nonce}` },
          { text: '❌ Annuler', callback_data: `non:${nonce}` },
        ]],
      },
    })
    return 'traite'
  }

  await prisma.$executeRaw`
    insert into public.cockpit_agent_conversations as c (chat_id, telegram_id, messages, dernier_update_id)
    values (${chatId}, ${telegramId}, ${tour}::jsonb, ${updateId})
    on conflict (chat_id) do update
    set messages = ${HISTORIQUE_UPSERT}, action_en_attente = null, nonce = null,
        dernier_update_id = ${majUpdate}, maj_le = now()
    where ${garde}`
  await tgCockpit('sendMessage', { chat_id: chatId, text: reponse.reply })
  return 'traite'
}
