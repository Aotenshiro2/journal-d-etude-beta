// Pont entre le bot membre Live Club et l'ecran Support du cockpit (29/09).
//
// Decision Brice 5 : TOUTES les conversations privees du bot apparaissent dans
// l'onglet Support comme celles du site, avec l'etiquette 'telegram' (champ
// `app` du fil), les demandes d'humain en tete. La reponse humaine ecrite dans
// le cockpit repart au membre par le bot (POST /api/support/reply).
//
// Un fil par compte Telegram, pour toujours (index unique sur "telegramId",
// migration 20260930090100). Le fil ne porte pas de compte Supabase : userId
// vaut 'telegram:<id>', qui ne ressemble jamais a un uuid, donc aucune route
// du site (/api/support/thread, chat, escalate, toutes filtrees par l'uuid de
// la session) ne peut l'atteindre.
//
// Les colonnes telegram ("telegramId", "membreId", "contactEmail") vivent HORS
// du modele Prisma, en SQL brut : un deploiement du journal avant la migration
// ne casse donc pas le support du site (Prisma liste ses colonnes dans chaque
// SELECT). Avant la migration, ce pont echoue en silence.
//
// Jamais de texte de message ni d'email dans un log. Aucune fonction ne jette :
// une panne du support ne casse pas le bot.
//
// TOUTE la conversation (Brice, 30/09 : le Support ne montrait aucun fil
// Telegram, parce que seul le texte libre passait par ici) : commandes,
// appuis de boutons, chaque message du bot (menu, verification, invitations,
// messages prives du passage quotidien) et une ligne « [système] » pour les
// etapes du groupe (demande d'adhesion recue, acceptee, refusee). Un compte
// non rattache a son fil aussi (telegramId seul, sans membre). Rien n'entre
// en clair qui ouvrirait une porte : lien d'invitation, jeton de /start, code
// de verification (nettoyerPourSupport). Des boutons, seul le libelle entre
// (texteAvecBoutons) : l'adresse d'un bouton peut etre un lien d'invitation.
//
// Toutes les ecritures prennent un client en dernier parametre (prisma par
// defaut) : scripts/verifier-pont-support.mjs les rejoue dans une
// transaction toujours annulee, contre la vraie base.

import { Resend } from 'resend'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { alerterEquipeTelegram, dernierMessageMembre, nomTelegram } from '@/lib/alerte-equipe-telegram'
import { expurgerLiensInvitation, phraseGeste, type GesteLu } from './pur'
import { masquerCodes } from './verification-pur'
import type { Bouton } from './telegram'
import {
  PREFIXE_SYSTEME, LIGNE_EQUIPE_PREVENUE, LIGNE_MAIN_RENDUE, alerteAutorisee, estImage, quiRepond,
  DEBUT_ATTENTE_HUMAIN, LIGNE_DEMANDE_ANNULEE, alertePartieDepuis,
  type PieceSupport,
} from './support-pont-pur'

// (16/10) Le texte que lit le membre vit dans support-pont-pur.ts (la carte de
// l'agent le montre tel quel) ; reexporte ici pour les appelants d'avant.
export { texteReponseEquipe } from './support-pont-pur'

export type EchangeSupport = {
  telegramId: number
  membreId?: string | null
  email?: string | null
  /** 'systeme' : une etape ou un geste du bot (groupe, pause, rappel), affichee « [système] ». */
  role: 'membre' | 'ia' | 'humain' | 'systeme'
  texte: string
  veutHumain?: boolean
  /** (16/10) Une piece jointe (image du membre) : sa reference Telegram, jamais le fichier. */
  piece?: PieceSupport | null
  /**
   * (16/10) Le genre de l'alerte si le fil passe en attente : 'demande' (il
   * demande un humain) ou 'reponse' (l'equipe a la main et il lui repond).
   */
  alerte?: 'demande' | 'reponse'
  /**
   * (22/10, Brice : « j'ai cru que l'IA avait parle ») Pour un message du bot
   * (role 'ia') : 'bot' = texte fixe du bot (menu, « je previens l'equipe »...),
   * 'ia' = reponse de l'agent. Garde sur le message (champ `auteur`), le role
   * reste 'assistant' : le cockpit affiche « Bot » ou « IA », un ecran qui ne
   * connait pas le champ affiche « IA » comme avant.
   */
  auteur?: 'bot' | 'ia'
}

/** Ce que l'enregistrement a fait : le fil, et s'il vient de passer en attente (atomique). */
export type IssueEchangeSupport = { filId: string; passeEnAttente: boolean }

/** Le client SQL des ecritures : prisma, ou une transaction (test). */
export type ClientSupport = Pick<Prisma.TransactionClient, '$queryRaw'>

/** Meme plafond que /api/support/chat et /api/support/reply. */
const MAX_CARACTERES = 4000

/**
 * Les roles du modele support (ceux que lit l'ecran du cockpit). Une etape
 * 'systeme' est ecrite en 'system', avec le prefixe « [système] » dans le
 * texte : le cockpit l'affiche en ligne discrete (SupportView.tsx, 30/09), et
 * un cockpit plus ancien, qui ne connait que user, assistant et human, la
 * montre en bulle « IA » encore lisible. Le bot support du site ignore ce
 * role (versMessagesSupport), et un fil Telegram ne lui parvient jamais.
 */
const ROLE_SUPPORT = { membre: 'user', ia: 'assistant', humain: 'human', systeme: 'system' } as const

/**
 * Ce qui ne doit jamais entrer en clair dans un fil : les liens d'invitation
 * Telegram (expurgerLiensInvitation), un jeton de /start (lien t.me/...?start=
 * colle dans un message) et un code de verification a 6 chiffres
 * (masquerCodes, qui laisse les emails intacts).
 */
export function nettoyerPourSupport(texte: string): string {
  const sansJeton = texte.replace(/([?&]start=)[A-Za-z0-9_-]{8,}/g, '$1[jeton]')
  return masquerCodes(expurgerLiensInvitation(sansJeton))
}

/**
 * Le texte d'un message du bot tel qu'il entre au fil : suivi des LIBELLES de
 * ses boutons, jamais de leur adresse (un bouton « Rejoindre le groupe »
 * porte un lien d'invitation).
 */
export function texteAvecBoutons(texte: string, boutons?: Bouton[][]): string {
  const libelles = (boutons ?? []).flat().map(b => b.texte).filter(Boolean)
  return libelles.length ? `${texte}\n[boutons : ${libelles.join(' | ')}]` : texte
}

/** Le userId d'un fil Telegram (jamais un uuid Supabase). */
export function userIdTelegram(telegramId: number): string {
  return `telegram:${telegramId}`
}

function journaliser(ou: string, err: unknown): void {
  // Le message d'erreur Postgres ne porte que le nom de l'objet fautif, pas les
  // valeurs : on garde la premiere ligne, courte.
  const brut = err instanceof Error ? err.message : String(err)
  console.error(`[liveclub/support-pont] ${ou} :`, brut.split('\n')[0].slice(0, 160))
}

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

type MessageFil = { role: string; content: string; at?: string; piece?: PieceSupport; auteur?: 'bot' | 'ia' }

/**
 * Prevenir l'equipe qu'un membre du bot veut un humain, comme
 * /api/support/escalate pour le site (memes variables d'env). Seulement au
 * passage de "pas en attente" a "en attente" : un membre qui insiste ne
 * declenche pas un email par message. Ne jette pas.
 */
async function alerterEquipe(email: string | null, messages: MessageFil[], genre: 'demande' | 'reponse' = 'demande'): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY_SUPPORT ?? process.env.RESEND_API_KEY
  if (!apiKey) return
  try {
    const to = (process.env.SUPPORT_ALERT_EMAILS ?? 'brice.delannay@gmail.com')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const transcript = messages.slice(-6)
      .map(m => `<p><strong>${m.role === 'user' ? 'Membre' : m.role === 'human' ? 'Équipe' : m.role === 'system' || m.auteur === 'bot' ? 'Bot' : 'IA'}</strong> : ${
        echapper(String(m.content)).slice(0, 600)
      }${m.piece ? ' <em>(pièce jointe, à voir dans l\'onglet Support)</em>' : ''}</p>`)
      .join('\n')
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: process.env.SUPPORT_FROM_EMAIL ?? 'AOK Support <onboarding@resend.dev>',
      to,
      subject: genre === 'reponse'
        ? "Support Telegram : un membre du Live Club a répondu à l'équipe"
        : 'Support Telegram : un membre du Live Club veut parler à un humain',
      html: [
        genre === 'reponse'
          ? `<p>Un membre a répondu à l'équipe dans le bot Live Club${email ? ` (email connu : ${echapper(email)})` : ''}.</p>`
          : `<p>Un membre a demandé un humain au bot Live Club${email ? ` (email connu : ${echapper(email)})` : ''}.</p>`,
        `<p><a href="https://cockpit.aoknowledge.com/?vue=support">Ouvrir l'onglet Support du cockpit</a> pour répondre : ta réponse lui arrive dans Telegram.</p>`,
        '<hr />',
        '<p>Derniers échanges :</p>',
        transcript || '<p><em>Fil sans historique.</em></p>',
      ].join('\n'),
    })
    if (error) journaliser('alerte equipe', error.message)
  } catch (err) {
    journaliser('alerte equipe', err)
  }
}

/**
 * Ajoute un message au fil Telegram du compte (cree le fil au premier
 * message), en UNE requete : l'ajout se fait par concatenation jsonb, deux
 * messages simultanes ne s'ecrasent pas.
 *
 * - veutHumain : le fil passe en "veut un humain" (s'il ne l'etait pas deja,
 *   l'equipe est prevenue par email).
 * - role 'humain' : la demande est prise en main, le fil sort de l'attente.
 * - membreId et email ne remplacent la valeur connue que s'ils sont fournis.
 * - le texte passe par nettoyerPourSupport (lien d'invitation, jeton, code).
 * - un compte Telegram prive seulement (id > 0) : un groupe a un id negatif.
 * - (16/10) piece : la reference Telegram d'une image du membre, gardee sur
 *   le message (jamais le fichier).
 *
 * (16/10) PASSAGE EN ATTENTE ATOMIQUE. Avant, la CTE « avant » lisait l'etat
 * dans l'instantane du debut de l'ordre : deux messages simultanes (un album
 * de 3 photos arrive en 3 updates paralleles) le voyaient tous deux « pas en
 * attente » et prevenaient deux fois. Maintenant, l'ordre date sa demande par
 * une horloge propre (clock_timestamp, une seule lecture par ordre), et seul
 * celui dont la date est RESTEE sur le fil l'y a fait passer : sous le verrou
 * de ligne de l'upsert, le second garde la date du premier (coalesce sur la
 * version a jour). Une seule alerte, une seule reponse.
 * Et au plus une alerte par fil toutes les 10 minutes (alerteAutorisee) : la
 * ligne « [système] Équipe prévenue. » date la derniere.
 *
 * Renvoie le fil et s'il vient de passer en attente ; null si rien n'a ete
 * ecrit. Ne jette jamais.
 */
export async function enregistrerEchangeSupport(e: EchangeSupport, db: ClientSupport = prisma): Promise<IssueEchangeSupport | null> {
  try {
    if (!Number.isSafeInteger(e.telegramId) || e.telegramId <= 0) return null
    const brut = typeof e.texte === 'string' ? nettoyerPourSupport(e.texte.trim()) : ''
    const texte = (e.role === 'systeme' && brut ? `${PREFIXE_SYSTEME}${brut}` : brut).slice(0, MAX_CARACTERES)
    if (!texte) return null
    const role = ROLE_SUPPORT[e.role]
    if (!role) return null
    const message: MessageFil = {
      role, content: texte, at: new Date().toISOString(), ...(e.piece ? { piece: e.piece } : {}),
      ...(e.role === 'ia' && (e.auteur === 'bot' || e.auteur === 'ia') ? { auteur: e.auteur } : {}),
    }
    const veut = e.veutHumain === true && e.role !== 'humain'
    const prisEnMain = e.role === 'humain'
    const email = typeof e.email === 'string' && e.email.trim() ? e.email.trim().toLowerCase().slice(0, 200) : null
    const membreId = typeof e.membreId === 'string' && e.membreId.trim() ? e.membreId.trim().slice(0, 100) : null

    // Horodatages en UTC sans fuseau, comme ceux que Prisma ecrit (TIMESTAMP(3)).
    const lignes = await db.$queryRaw<{ passe_en_attente: boolean | null; messages: unknown; email: string | null; id: string }[]>`
      with horloge as (
        select timezone('utc', clock_timestamp())::timestamp(3) as t
      )
      insert into public."SupportThread"
        (id, "userId", app, messages, "escalatedAt", "createdAt", "updatedAt", "telegramId", "membreId", "contactEmail")
      values (
        gen_random_uuid()::text, ${userIdTelegram(e.telegramId)}, 'telegram',
        ${JSON.stringify([message])}::jsonb,
        case when ${veut}::boolean then (select t from horloge) end,
        timezone('utc', now()), timezone('utc', now()),
        ${e.telegramId}, ${membreId}, ${email}
      )
      on conflict ("telegramId") do update set
        messages = "SupportThread".messages || excluded.messages,
        "escalatedAt" = case
          when ${prisEnMain}::boolean then null
          when ${veut}::boolean then coalesce("SupportThread"."escalatedAt", excluded."escalatedAt")
          else "SupportThread"."escalatedAt" end,
        "membreId" = coalesce(excluded."membreId", "SupportThread"."membreId"),
        "contactEmail" = coalesce(excluded."contactEmail", "SupportThread"."contactEmail"),
        "updatedAt" = timezone('utc', now())
      returning ${veut}::boolean and "escalatedAt"::timestamp(3) = (select t from horloge) as passe_en_attente,
        messages, "contactEmail" as email, id`

    const ligne = lignes[0]
    if (!ligne) return null
    const passeEnAttente = veut && ligne.passe_en_attente === true
    if (passeEnAttente) {
      const messages = Array.isArray(ligne.messages) ? (ligne.messages as MessageFil[]) : [message]
      if (alerteAutorisee(messages, Date.now())) {
        const genre = e.alerte ?? 'demande'
        await alerterEquipe(ligne.email, messages, genre)
        // (16/10) Et un message Telegram d'Agent AOK a Brice et Mel, qui finit
        // par la reference du fil (pour lui repondre depuis Agent AOK), avec le
        // bouton « Rendre la main au bot » et l'image du message s'il en porte une.
        const nom = await nomTelegram(e.telegramId)
        await alerterEquipeTelegram({
          origine: 'bot Live Club',
          qui: [nom ?? `compte Telegram u${e.telegramId}`, ligne.email].filter(Boolean).join(', '),
          dernierMessage: dernierMessageMembre(messages),
          reponseDans: 'Telegram',
          fil: ligne.id,
          genre,
        }, { image: e.piece && estImage(e.piece) ? e.piece : null, rendreLaMain: true })
        await tracerEtape(e.telegramId, LIGNE_EQUIPE_PREVENUE, {}, db)
      }
    }
    return { filId: ligne.id, passeEnAttente }
  } catch (err) {
    journaliser('enregistrement', err)
    return null
  }
}

/**
 * Les messages du fil Telegram de ce compte (pour savoir si l'equipe a la
 * main), ou null : pas de fil, panne, avant la migration. Ne jette jamais.
 */
export async function lireMessagesFil(telegramId: number): Promise<unknown[] | null> {
  try {
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return null
    const lignes = await prisma.$queryRaw<{ messages: unknown }[]>`
      select messages from public."SupportThread" where "telegramId" = ${telegramId} limit 1`
    const m = lignes[0]?.messages
    return Array.isArray(m) ? m : null
  } catch (err) {
    journaliser('lecture du fil', err)
    return null
  }
}

/** (22/10) L'etat du fil relu juste avant un message du bot : ses messages, et depuis quand il attend un humain. */
export type EtatFil = { messages: unknown[]; attend: boolean; escaladeLe: Date | null }

/**
 * L'etat du fil Telegram de ce compte, en une lecture (Brice, 22/10 : les
 * messages du bot autour de l'equipe dependent de l'etat, pas d'une sequence
 * supposee). null : pas de fil, panne, avant la migration. Ne jette jamais.
 */
export async function lireEtatFil(telegramId: number): Promise<EtatFil | null> {
  try {
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return null
    const lignes = await prisma.$queryRaw<{ messages: unknown; escalated_at: Date | null }[]>`
      select messages, "escalatedAt" as escalated_at from public."SupportThread" where "telegramId" = ${telegramId} limit 1`
    const l = lignes[0]
    if (!l) return null
    const escaladeLe = l.escalated_at instanceof Date && Number.isFinite(l.escalated_at.getTime()) ? l.escalated_at : null
    return { messages: Array.isArray(l.messages) ? l.messages : [], attend: escaladeLe !== null, escaladeLe }
  } catch (err) {
    journaliser('lecture de l etat du fil', err)
    return null
  }
}

/**
 * (22/10, Brice) Le message d'attente, au plus UNE fois par periode
 * d'attente : il entre au fil seulement si le fil attend encore un humain et
 * qu'aucun message d'attente n'y est entre depuis le passage en attente
 * (« escalatedAt »). Une seule requete : sous le verrou de ligne de l'update,
 * trois messages simultanes du membre n'en font entrer qu'un (le second
 * relit la ligne a jour et ne trouve plus rien a faire). Meme regle, pure, que
 * attenteDejaDite (support-pont-pur.ts). Les dates du fil sont des ISO en UTC
 * (toISOString) : la comparaison de textes au meme format suffit, sans
 * conversion qui jetterait sur une date mal formee (qui ne compte pas, comme
 * dans la regle pure).
 * true = le message est entre au fil : l'appelant l'envoie. Ne jette jamais.
 */
export async function direAttenteUneFois(
  telegramId: number,
  texte: string,
  o: { boutons?: Bouton[][] } = {},
): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return false
    if (!texte.startsWith(DEBUT_ATTENTE_HUMAIN)) return false
    const message: MessageFil = {
      role: ROLE_SUPPORT.ia, content: texteAvecBoutons(texte, o.boutons).slice(0, MAX_CARACTERES),
      at: new Date().toISOString(), auteur: 'bot',
    }
    const lignes = await prisma.$queryRaw<{ id: string }[]>`
      update public."SupportThread" set
        messages = coalesce(messages, '[]'::jsonb) || ${JSON.stringify([message])}::jsonb,
        "updatedAt" = timezone('utc', now())
      where "telegramId" = ${telegramId}
        and "escalatedAt" is not null
        and not exists (
          select 1 from jsonb_array_elements(coalesce(messages, '[]'::jsonb)) m
          where m->>'role' = 'assistant'
            and left(coalesce(m->>'content', ''), ${DEBUT_ATTENTE_HUMAIN.length}::int) = ${DEBUT_ATTENTE_HUMAIN}
            and coalesce(m->>'at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            and coalesce(m->>'at', '') >= to_char("escalatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      returning id`
    return lignes.length > 0
  } catch (err) {
    journaliser('message d attente', err)
    return false
  }
}

/**
 * (22/10, Brice) Le membre annule sa demande avant que l'equipe ne reponde
 * (lecture-attente.ts) : la ligne « [système] Demande annulée par le membre. »
 * au fil, et le fil sort de l'attente, en une requete, SEULEMENT si l'attente
 * est toujours celle qu'on a lue (`escaladeLue`) : une reponse de l'equipe ou
 * une nouvelle demande arrivee entre-temps ne sont pas effacees. Si une alerte
 * est partie pour cette attente (ligne LIGNE_EQUIPE_PREVENUE depuis le passage
 * en attente), l'equipe recoit « X a annulé sa demande » par Agent AOK, pour
 * ne pas repondre pour rien ; pas d'email, pas de bouton. Aucune alerte
 * n'etait partie (rythme des 10 minutes) : rien a retirer, rien d'envoye.
 * true = annulee. Ne jette jamais.
 */
export async function annulerDemandeEquipe(telegramId: number, escaladeLue: Date): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return false
    const ligne: MessageFil = { role: ROLE_SUPPORT.systeme, content: `${PREFIXE_SYSTEME}${LIGNE_DEMANDE_ANNULEE}`, at: new Date().toISOString() }
    const lignes = await prisma.$queryRaw<{ id: string; messages: unknown; email: string | null }[]>`
      update public."SupportThread" set
        messages = coalesce(messages, '[]'::jsonb) || ${JSON.stringify([ligne])}::jsonb,
        "escalatedAt" = null,
        "updatedAt" = timezone('utc', now())
      where "telegramId" = ${telegramId}
        and "escalatedAt" = ${escaladeLue.toISOString()}::timestamp(3)
      returning id, messages, "contactEmail" as email`
    const l = lignes[0]
    if (!l) return false
    const messages = Array.isArray(l.messages) ? l.messages : []
    if (alertePartieDepuis(messages, escaladeLue.getTime())) {
      const nom = await nomTelegram(telegramId)
      await alerterEquipeTelegram({
        origine: 'bot Live Club',
        qui: [nom ?? `compte Telegram u${telegramId}`, l.email].filter(Boolean).join(', '),
        dernierMessage: dernierMessageMembre(messages),
        reponseDans: 'Telegram',
        fil: l.id,
        genre: 'annulee',
      })
    }
    return true
  } catch (err) {
    journaliser('annulation', err)
    return false
  }
}

export type IssueMainRendue =
  | { ok: true; dejaAuBot: boolean; messages: unknown; escalatedAt: null }
  | { ok: false; raison: 'introuvable' | 'pas_telegram' }

/**
 * « Rendre la main au bot » (Brice, 16/10) : la ligne « [système] Main rendue
 * au bot par l'équipe. » au fil, et le fil sort de l'attente (sinon le bot
 * continuerait de dire au membre qu'il a transmis). Rien n'est dit au membre.
 * Un fil ou le bot a deja la main et qui n'attend pas : rien n'est ecrit.
 * Fils du bot des membres seulement. Jette si la base ne repond pas.
 */
export async function rendreLaMainAuBot(threadId: string): Promise<IssueMainRendue> {
  const lignes = await prisma.$queryRaw<{ app: string; messages: unknown; attend: boolean }[]>`
    select app, messages, "escalatedAt" is not null as attend from public."SupportThread" where id = ${threadId} limit 1`
  const l = lignes[0]
  if (!l) return { ok: false, raison: 'introuvable' }
  if (l.app !== 'telegram') return { ok: false, raison: 'pas_telegram' }
  const dejaAuBot = quiRepond(l.messages, Date.now()) === 'bot'
  if (dejaAuBot && !l.attend) return { ok: true, dejaAuBot, messages: l.messages, escalatedAt: null }
  const ligne: MessageFil = { role: ROLE_SUPPORT.systeme, content: `${PREFIXE_SYSTEME}${LIGNE_MAIN_RENDUE}`, at: new Date().toISOString() }
  const maj = await prisma.$queryRaw<{ messages: unknown }[]>`
    update public."SupportThread" set
      messages = coalesce(messages, '[]'::jsonb) || ${JSON.stringify([ligne])}::jsonb,
      "escalatedAt" = null,
      "updatedAt" = timezone('utc', now())
    where id = ${threadId}
    returning messages`
  if (!maj[0]) return { ok: false, raison: 'introuvable' }
  // Ecrit : le bot reprend vraiment la main (un fil en attente le faisait taire).
  return { ok: true, dejaAuBot: false, messages: maj[0].messages, escalatedAt: null }
}

export type OptionsTrace = {
  boutons?: Bouton[][]
  membreId?: string | null
  email?: string | null
  /** false : Telegram a refuse l'envoi, le fil le dit (« [non délivré] »). */
  livre?: boolean
  /** (22/10) 'ia' : une reponse de l'agent. Par defaut 'bot' : un texte fixe du bot (affiche « Bot » au cockpit). */
  auteur?: 'bot' | 'ia'
}

/**
 * Un message ENVOYE par le bot a ce compte (menu, verification, invitation,
 * passage quotidien), avec les libelles de ses boutons. Ne jette jamais.
 */
export async function tracerMessageBot(
  telegramId: number,
  texte: string,
  o: OptionsTrace = {},
  db: ClientSupport = prisma,
): Promise<void> {
  const corps = texteAvecBoutons(o.livre === false ? `[non délivré] ${texte}` : texte, o.boutons)
  await enregistrerEchangeSupport({ telegramId, membreId: o.membreId, email: o.email, role: 'ia', texte: corps, auteur: o.auteur ?? 'bot' }, db)
}

/**
 * Une etape du bot pour ce compte, en une ligne courte (« Demande d'adhesion
 * au groupe recue »). Ne jette jamais.
 */
export async function tracerEtape(
  telegramId: number,
  etape: string,
  o: { membreId?: string | null } = {},
  db: ClientSupport = prisma,
): Promise<void> {
  await enregistrerEchangeSupport({ telegramId, membreId: o.membreId, role: 'systeme', texte: etape }, db)
}

/**
 * Un GESTE du bot (ligne du journal cockpit_liveclub_gestes) dans le fil du
 * compte : 'fait' ou 'refuse' seulement, en une ligne lisible (phraseGeste).
 * Appele par journaliserGesteLiveClub (stripe-actions.ts) et par le passage
 * quotidien pour ses envois reserves. Rien pour un compte absent ou un
 * groupe. Ne jette jamais.
 */
export async function tracerGeste(
  telegramId: number | null | undefined,
  g: GesteLu,
  o: { membreId?: string | null } = {},
  db: ClientSupport = prisma,
): Promise<void> {
  try {
    if (typeof telegramId !== 'number' || !Number.isSafeInteger(telegramId) || telegramId <= 0) return
    const phrase = phraseGeste(g)
    if (!phrase) return
    await tracerEtape(telegramId, phrase, o, db)
  } catch (err) {
    journaliser('geste', err)
  }
}

/**
 * Le fil de ce compte attend-il un humain ? false aussi sur panne ou avant la
 * migration : le bot continue alors de repondre normalement. Ne jette jamais.
 */
export async function estEnAttenteHumain(telegramId: number): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(telegramId)) return false
    const lignes = await prisma.$queryRaw<{ attend: boolean }[]>`
      select "escalatedAt" is not null as attend
      from public."SupportThread" where "telegramId" = ${telegramId} limit 1`
    return lignes[0]?.attend === true
  } catch (err) {
    journaliser('lecture attente', err)
    return false
  }
}

/**
 * Le compte Telegram d'un fil (pour la reponse humaine du cockpit), null si
 * le fil n'en a pas. Jette : l'appelant (la route reply) doit savoir qu'il ne
 * peut pas livrer.
 */
export async function telegramDuFil(threadId: string): Promise<number | null> {
  const lignes = await prisma.$queryRaw<{ telegram_id: bigint | null }[]>`
    select "telegramId" as telegram_id from public."SupportThread" where id = ${threadId} limit 1`
  const brut = lignes[0]?.telegram_id
  if (brut === null || brut === undefined) return null
  const n = Number(brut)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * Enregistre la reponse humaine du cockpit sur un fil Telegram, APRES sa
 * livraison dans Telegram, en UNE requete : ajout par concatenation jsonb,
 * donc un message du membre arrive pendant l'envoi (le pont ecrit en meme
 * temps) n'est pas ecrase.
 *
 * La demande d'humain ne s'eteint que si elle n'a pas bouge depuis la lecture
 * du fil (`escaladeLue`, lue avant l'envoi) : une NOUVELLE demande posee
 * pendant l'envoi reste allumee dans le cockpit. Colonne TIMESTAMP(3) en UTC
 * sans fuseau, comme l'ecrit Prisma : le 'Z' de l'ISO est ignore par le cast,
 * la comparaison se fait a la milliseconde.
 *
 * Jette : l'appelant (la route reply) doit dire au cockpit que la reponse est
 * livree mais pas enregistree. null si le fil a disparu.
 */
export async function ajouterReponseEquipe(
  threadId: string,
  texte: string,
  escaladeLue: Date | null,
  piece: PieceSupport | null = null,
): Promise<{ messages: unknown; escalatedAt: Date | null } | null> {
  // (16/10) piece : le fichier envoye avec la reponse, par le file_id que le
  // bot des membres a rendu (relu chez Telegram par l'onglet Support).
  const message: MessageFil = { role: ROLE_SUPPORT.humain, content: texte, at: new Date().toISOString(), ...(piece ? { piece } : {}) }
  const lu = escaladeLue ? escaladeLue.toISOString() : null
  const lignes = await prisma.$queryRaw<{ messages: unknown; escalated_at: Date | null }[]>`
    update public."SupportThread" set
      messages = coalesce(messages, '[]'::jsonb) || ${JSON.stringify([message])}::jsonb,
      "escalatedAt" = case
        when "escalatedAt" is not distinct from ${lu}::timestamp(3) then null
        else "escalatedAt" end,
      "updatedAt" = timezone('utc', now())
    where id = ${threadId}
    returning messages, "escalatedAt" as escalated_at`
  const ligne = lignes[0]
  return ligne ? { messages: ligne.messages, escalatedAt: ligne.escalated_at } : null
}
