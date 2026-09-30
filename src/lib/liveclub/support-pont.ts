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
import { expurgerLiensInvitation, phraseGeste, type GesteLu } from './pur'
import { masquerCodes } from './verification-pur'
import type { Bouton } from './telegram'

export type EchangeSupport = {
  telegramId: number
  membreId?: string | null
  email?: string | null
  /** 'systeme' : une etape ou un geste du bot (groupe, pause, rappel), affichee « [système] ». */
  role: 'membre' | 'ia' | 'humain' | 'systeme'
  texte: string
  veutHumain?: boolean
}

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
const PREFIXE_SYSTEME = '[système] '

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

type MessageFil = { role: string; content: string; at?: string }

/**
 * Prevenir l'equipe qu'un membre du bot veut un humain, comme
 * /api/support/escalate pour le site (memes variables d'env). Seulement au
 * passage de "pas en attente" a "en attente" : un membre qui insiste ne
 * declenche pas un email par message. Ne jette pas.
 */
async function alerterEquipe(email: string | null, messages: MessageFil[]): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY_SUPPORT ?? process.env.RESEND_API_KEY
  if (!apiKey) return
  try {
    const to = (process.env.SUPPORT_ALERT_EMAILS ?? 'brice.delannay@gmail.com')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const transcript = messages.slice(-6)
      .map(m => `<p><strong>${m.role === 'user' ? 'Membre' : m.role === 'human' ? 'Équipe' : m.role === 'system' ? 'Bot' : 'IA'}</strong> : ${
        echapper(String(m.content)).slice(0, 600)
      }</p>`)
      .join('\n')
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: process.env.SUPPORT_FROM_EMAIL ?? 'AOK Support <onboarding@resend.dev>',
      to,
      subject: 'Support Telegram : un membre du Live Club veut parler à un humain',
      html: [
        `<p>Un membre a demandé un humain au bot Live Club${email ? ` (email connu : ${echapper(email)})` : ''}.</p>`,
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
 *
 * Ne jette jamais.
 */
export async function enregistrerEchangeSupport(e: EchangeSupport, db: ClientSupport = prisma): Promise<void> {
  try {
    if (!Number.isSafeInteger(e.telegramId) || e.telegramId <= 0) return
    const brut = typeof e.texte === 'string' ? nettoyerPourSupport(e.texte.trim()) : ''
    const texte = (e.role === 'systeme' && brut ? `${PREFIXE_SYSTEME}${brut}` : brut).slice(0, MAX_CARACTERES)
    if (!texte) return
    const role = ROLE_SUPPORT[e.role]
    if (!role) return
    const message: MessageFil = { role, content: texte, at: new Date().toISOString() }
    const veut = e.veutHumain === true && e.role !== 'humain'
    const prisEnMain = e.role === 'humain'
    const email = typeof e.email === 'string' && e.email.trim() ? e.email.trim().toLowerCase().slice(0, 200) : null
    const membreId = typeof e.membreId === 'string' && e.membreId.trim() ? e.membreId.trim().slice(0, 100) : null

    // La CTE lit l'etat AVANT l'ecriture (meme instantane) : on sait si le fil
    // attendait deja un humain, pour ne prevenir l'equipe qu'une fois.
    // Horodatages en UTC sans fuseau, comme ceux que Prisma ecrit.
    const lignes = await db.$queryRaw<{ attendait: boolean | null; messages: unknown; email: string | null }[]>`
      with avant as (
        select "escalatedAt" is not null as attendait
        from public."SupportThread" where "telegramId" = ${e.telegramId}
      )
      insert into public."SupportThread"
        (id, "userId", app, messages, "escalatedAt", "createdAt", "updatedAt", "telegramId", "membreId", "contactEmail")
      values (
        gen_random_uuid()::text, ${userIdTelegram(e.telegramId)}, 'telegram',
        ${JSON.stringify([message])}::jsonb,
        case when ${veut}::boolean then timezone('utc', now()) end,
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
      returning (select attendait from avant) as attendait, messages, "contactEmail" as email`

    const ligne = lignes[0]
    if (veut && ligne && ligne.attendait !== true) {
      const messages = Array.isArray(ligne.messages) ? (ligne.messages as MessageFil[]) : [message]
      await alerterEquipe(ligne.email, messages)
    }
  } catch (err) {
    journaliser('enregistrement', err)
  }
}

export type OptionsTrace = {
  boutons?: Bouton[][]
  membreId?: string | null
  email?: string | null
  /** false : Telegram a refuse l'envoi, le fil le dit (« [non délivré] »). */
  livre?: boolean
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
  await enregistrerEchangeSupport({ telegramId, membreId: o.membreId, email: o.email, role: 'ia', texte: corps }, db)
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

/** Ce que le membre lit dans Telegram quand l'equipe lui repond du cockpit. */
export function texteReponseEquipe(message: string): string {
  return `Réponse de l'équipe AOK :\n\n${message}`
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
): Promise<{ messages: unknown; escalatedAt: Date | null } | null> {
  const message: MessageFil = { role: ROLE_SUPPORT.humain, content: texte, at: new Date().toISOString() }
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
