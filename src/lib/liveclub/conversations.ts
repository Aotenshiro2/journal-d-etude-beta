// Memoire courte des conversations privees du bot Live Club (29/09), table
// cockpit_liveclub_conversations (migration 20260929200200, serveur
// seulement : ce sont les messages prives des membres).
//
// Trois usages, tous atomiques en base :
// - dedoublonnage des webhooks rejoues (dernier_update_id) ;
// - plafond de messages IA par membre et par jour ;
// - l'action proposee (pause, arret, annulation d'arret) et son nonce, que le
//   bouton de confirmation CONSOMME par un UPDATE ... WHERE nonce = $1
//   RETURNING, jamais lire-puis-effacer.
//
// Jamais de texte de message dans un log. Avant la migration, chaque fonction
// jette une ErreurTableLiveClub : le bot bascule alors sur le menu sans IA.

import { randomBytes } from 'crypto'
import { prisma } from '@/lib/db'
import { PLAFOND_MESSAGES_IA_JOUR } from './config'
import { relationAbsente } from './pur'
import { ErreurTableLiveClub } from './jetons'

/** Historique garde par compte (messages, pas echanges). */
export const MAX_MESSAGES_HISTORIQUE = 20
/** Longueur max d'un message conserve (un roman colle ne gonfle pas la base). */
const MAX_CARACTERES_MESSAGE = 2000

function tableConversations(err: unknown): never {
  if (relationAbsente(err)) throw new ErreurTableLiveClub('cockpit_liveclub_conversations', '20260929200200')
  throw err
}

export type MessageConserve = { role: 'user' | 'assistant'; content: string; at?: string }

/**
 * Premier passage de cet update pour ce compte ? Pose dernier_update_id dans
 * le meme ordre (insert ou update conditionnel). Rend false seulement si c'est
 * EXACTEMENT le dernier update traite (le cas d'un webhook rejoue apres un
 * delai). Pas de « plus ancien = deja vu » : Telegram peut livrer en
 * parallele, et deux messages rapproches arriveraient dans le desordre, le
 * premier serait perdu. Les gestes sensibles ont leur propre verrou (nonce,
 * jeton). Cree la ligne du compte au premier contact.
 */
export async function premierPassage(telegramId: number, updateId: number): Promise<boolean> {
  try {
    const lignes = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      insert into public.cockpit_liveclub_conversations (telegram_id, dernier_update_id, maj_le)
      values (${telegramId}, ${updateId}, now())
      on conflict (telegram_id) do update set dernier_update_id = excluded.dernier_update_id, maj_le = now()
        where cockpit_liveclub_conversations.dernier_update_id is distinct from excluded.dernier_update_id
      returning telegram_id`
    return lignes.length === 1
  } catch (err) {
    return tableConversations(err)
  }
}

/**
 * Reserve un message IA pour aujourd'hui (jour de Paris), atomiquement :
 * true = sous le plafond, le compteur a pris +1 ; false = plafond atteint.
 * La ligne doit exister (premierPassage l'a creee) ; sinon elle est creee ici.
 */
export async function reserverMessageIA(telegramId: number): Promise<boolean> {
  try {
    const lignes = await prisma.$queryRaw<{ nb_messages_jour: number }[]>`
      insert into public.cockpit_liveclub_conversations (telegram_id, jour, nb_messages_jour, maj_le)
      values (${telegramId}, (now() at time zone 'Europe/Paris')::date, 1, now())
      on conflict (telegram_id) do update set
        nb_messages_jour = case
          when cockpit_liveclub_conversations.jour = (now() at time zone 'Europe/Paris')::date
            then cockpit_liveclub_conversations.nb_messages_jour + 1
          else 1 end,
        jour = (now() at time zone 'Europe/Paris')::date,
        maj_le = now()
        where cockpit_liveclub_conversations.jour is distinct from (now() at time zone 'Europe/Paris')::date
           or cockpit_liveclub_conversations.nb_messages_jour < ${PLAFOND_MESSAGES_IA_JOUR}
      returning nb_messages_jour`
    return lignes.length === 1
  } catch (err) {
    return tableConversations(err)
  }
}

function estMessage(m: unknown): m is MessageConserve {
  const x = m as MessageConserve
  return Boolean(x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string')
}

/** L'historique court du compte (au plus MAX_MESSAGES_HISTORIQUE), du plus ancien au plus recent. */
export async function lireHistorique(telegramId: number): Promise<MessageConserve[]> {
  try {
    const lignes = await prisma.$queryRaw<{ messages: unknown }[]>`
      select messages from public.cockpit_liveclub_conversations where telegram_id = ${telegramId} limit 1`
    const brut = lignes[0]?.messages
    return Array.isArray(brut) ? brut.filter(estMessage).slice(-MAX_MESSAGES_HISTORIQUE) : []
  } catch (err) {
    return tableConversations(err)
  }
}

/**
 * Ajoute un echange (question du membre, reponse du bot) et ne garde que les
 * MAX_MESSAGES_HISTORIQUE derniers messages. Lecture puis ecriture : deux
 * messages simultanes du meme membre peuvent perdre une ligne d'historique,
 * jamais une action (l'action et le nonce vivent dans d'autres colonnes).
 */
export async function ajouterEchange(telegramId: number, question: string, reponse: string): Promise<void> {
  const at = new Date().toISOString()
  const avant = await lireHistorique(telegramId)
  const apres = [
    ...avant,
    { role: 'user' as const, content: question.slice(0, MAX_CARACTERES_MESSAGE), at },
    { role: 'assistant' as const, content: reponse.slice(0, MAX_CARACTERES_MESSAGE), at },
  ].slice(-MAX_MESSAGES_HISTORIQUE)
  try {
    await prisma.$executeRaw`
      insert into public.cockpit_liveclub_conversations (telegram_id, messages, maj_le)
      values (${telegramId}, ${JSON.stringify(apres)}::jsonb, now())
      on conflict (telegram_id) do update set messages = excluded.messages, maj_le = now()`
  } catch (err) {
    tableConversations(err)
  }
}

/** L'action qu'un bouton de confirmation peut declencher. Posee par le serveur, jamais par le modele. */
export type ActionMembre = {
  type: 'pause' | 'arret' | 'annuler_arret'
  abonnementId: string
  /** Client Stripe de l'abonnement au moment de la proposition (re-verifie a la confirmation). */
  clientStripe: string | null
  nbMois?: number
  /** ISO : au-dela, la confirmation est refusee (le membre redemande). */
  expire: string
}

/** Duree de validite d'un bouton de confirmation. */
const VALIDITE_CONFIRMATION_MIN = 30

/**
 * Pose l'action en attente du compte avec un nonce neuf (12 caracteres
 * base64url : 'c:' + nonce tient dans les 64 octets de callback_data).
 * Une nouvelle proposition remplace la precedente : l'ancien bouton ne marche
 * plus. Renvoie le nonce.
 */
export async function poserActionEnAttente(
  telegramId: number,
  action: Omit<ActionMembre, 'expire'>,
): Promise<string> {
  const nonce = randomBytes(9).toString('base64url')
  const complete: ActionMembre = {
    ...action,
    expire: new Date(Date.now() + VALIDITE_CONFIRMATION_MIN * 60_000).toISOString(),
  }
  try {
    await prisma.$executeRaw`
      insert into public.cockpit_liveclub_conversations (telegram_id, action_en_attente, nonce, maj_le)
      values (${telegramId}, ${JSON.stringify(complete)}::jsonb, ${nonce}, now())
      on conflict (telegram_id) do update set
        action_en_attente = excluded.action_en_attente, nonce = excluded.nonce, maj_le = now()`
  } catch (err) {
    tableConversations(err)
  }
  return nonce
}

function estAction(a: unknown): a is ActionMembre {
  const x = a as ActionMembre
  return Boolean(x && ['pause', 'arret', 'annuler_arret'].includes(x.type)
    && typeof x.abonnementId === 'string' && typeof x.expire === 'string')
}

export type IssueNonce =
  | { etat: 'ok'; action: ActionMembre }
  | { etat: 'inconnu' }
  | { etat: 'expire' }

/**
 * Consomme le nonce de CE compte, en un seul UPDATE : un double clic, un
 * webhook rejoue ou un vieux bouton ne passe qu'une fois, ou pas du tout.
 * L'action reste en colonne (inerte sans nonce) pour la trace.
 */
export async function consommerNonce(telegramId: number, nonce: string): Promise<IssueNonce> {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) return { etat: 'inconnu' }
  let lignes: { action_en_attente: unknown }[]
  try {
    lignes = await prisma.$queryRaw<{ action_en_attente: unknown }[]>`
      update public.cockpit_liveclub_conversations set nonce = null, maj_le = now()
      where telegram_id = ${telegramId} and nonce = ${nonce}
      returning action_en_attente`
  } catch (err) {
    return tableConversations(err)
  }
  const action = lignes[0]?.action_en_attente
  if (!estAction(action)) return { etat: 'inconnu' }
  if (Date.parse(action.expire) < Date.now()) return { etat: 'expire' }
  return { etat: 'ok', action }
}
