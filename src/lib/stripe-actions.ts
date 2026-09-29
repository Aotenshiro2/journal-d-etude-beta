// Les actions Stripe de l'agent cockpit (demande Brice 03/09) : generer un
// code promo, rembourser un paiement, creer un produit.
//
// PROTOCOLE : l'agent PROPOSE (tool call intercepte, jamais execute), l'ecran
// affiche une carte de confirmation, et c'est le clic de Brice/Melanie qui
// appelle /api/cockpit/agent/action — l'execution ne passe donc JAMAIS par le
// modele. La validation des parametres vit ici, cote serveur, pas dans le
// prompt.
//
// CLES : une par compte, EN ECRITURE, distinctes des cles de collecte (qui
// restent lecture seule — c'est une qualite). Posees dans Vercel (journal) :
//   STRIPE_AGENT_KEY_AOKNOWLEDGE  (comptant)
//   STRIPE_AGENT_KEY_MELANIE      (recurrent Live Club)
// Permissions minimales de la cle restreinte : Charges = ecriture (couvre les
// remboursements), Coupons = ecriture (couvre les codes promotionnels),
// Produits = ecriture (couvre les tarifs). Tant que la cle manque, la carte
// de confirmation le dit au lieu d'un bouton Confirmer.

import { prisma } from '@/lib/db'
import {
  finPeriodeAbonnement, calculerReprisePause, decouperEmails, normaliserEmail, preparerPoseDePause,
  effacementMetadonneesPause,
} from '@/lib/liveclub/pur'

// La regle de la pause vit dans liveclub/pur.ts (testable sans base) ; elle
// est reexportee ici pour les appelants de stripe-actions (29/09).
export { finPeriodeAbonnement, calculerReprisePause }

const API = 'https://api.stripe.com'

// Version d'API EPINGLEE : les deux comptes n'ont pas le meme defaut (celui de
// Melanie est sur « clover », l'autre non), et clover a change la creation des
// codes promo (promotion[type]+promotion[coupon] au lieu de coupon) — le
// premier essai reel du 04/09 est tombe sur « Received unknown parameter:
// coupon ». Epingler rend le comportement identique partout, pour toujours.
const STRIPE_VERSION = '2025-09-30.clover'

export type CompteStripe = 'aoknowledge' | 'melanie'

const ENV_PAR_COMPTE: Record<CompteStripe, string> = {
  aoknowledge: 'STRIPE_AGENT_KEY_AOKNOWLEDGE',
  melanie: 'STRIPE_AGENT_KEY_MELANIE',
}

export function cleAgent(compte: CompteStripe): string | null {
  return process.env[ENV_PAR_COMPTE[compte]]?.trim() || null
}

export function nomVariableCle(compte: CompteStripe): string {
  return ENV_PAR_COMPTE[compte]
}

function estCompte(v: unknown): v is CompteStripe {
  return v === 'aoknowledge' || v === 'melanie'
}

/** GET Stripe (version epinglee). `chemin` porte sa query. Jette si Stripe refuse. */
export async function stripeGet(cle: string, chemin: string): Promise<Record<string, unknown>> {
  const reponse = await fetch(`${API}${chemin}`, {
    headers: { Authorization: `Bearer ${cle}`, 'Stripe-Version': STRIPE_VERSION },
  })
  const json = (await reponse.json()) as Record<string, unknown>
  if (!reponse.ok) {
    const err = json?.error as { message?: string } | undefined
    throw new Error(err?.message?.slice(0, 300) || `Stripe a répondu ${reponse.status}`)
  }
  return json
}

/** POST Stripe en form-urlencoded (version epinglee). Jette si Stripe refuse. */
export async function stripePost(
  cle: string,
  chemin: string,
  corps: Record<string, string>,
): Promise<Record<string, unknown>> {
  const reponse = await fetch(`${API}${chemin}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cle}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_VERSION,
    },
    body: new URLSearchParams(corps).toString(),
  })
  const json = (await reponse.json()) as Record<string, unknown>
  if (!reponse.ok) {
    const err = json?.error as { message?: string } | undefined
    throw new Error(err?.message?.slice(0, 300) || `Stripe a répondu ${reponse.status}`)
  }
  return json
}

// ---------------------------------------------------------------------------
// Les trois actions. Chacune valide STRICTEMENT ses parametres : un parametre
// inattendu ou mal forme est un refus, pas une tolerance — c'est du texte qui
// vient d'un modele.
// ---------------------------------------------------------------------------

export type ActionAgent = {
  type: 'code_promo' | 'remboursement' | 'produit' | 'revoquer_code'
    | 'retirer_telegram' | 'reintegrer_telegram'
    | 'pause_abonnement' | 'reprise_abonnement'
    | 'acces_broker'
  // 'telegram' pour les actions du groupe Live Club (retrait, reintegration,
  // acces broker) : pas un compte Stripe, mais la carte de confirmation
  // affiche d'ou vient le pouvoir.
  compte: CompteStripe | 'telegram'
  params: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Actions TELEGRAM (groupe Live Club, 10/09, revues le 29/09). Regles gravees
// dans la roadmap : UN MAITRE PAR GESTE (Metricgram sort encore les
// desinscrits de son circuit, nos actions ne servent qu'aux ECARTS et a la
// pause, jusqu'a la bascule) ; toute reintegration fait unban AVANT le lien
// (Metricgram, lui, bannit) ; le lien est a usage unique et expire sous 14
// jours.
//
// 29/09, decision de Brice : JAMAIS DE BANNISSEMENT pour une sortie. Retirer =
// unbanChatMember SANS only_if_banned sur un membre present, ce qui le sort du
// groupe sans le bannir (doc Telegram). Jamais un admin ou le createur du
// groupe (verifie par getChatMember), jamais un exempte actif
// (cockpit_liveclub_exemptions). Les deux gestes vivent ici, dans
// retirerDuLiveClub et reintegrerAuLiveClub : l'agent (carte de confirmation)
// et le bouton du cockpit (/api/cockpit/liveclub/membre) passent par les
// memes fonctions, donc par les memes refus.
// ---------------------------------------------------------------------------

const API_TG = 'https://api.telegram.org'

export function cleTelegramPresente(): boolean {
  return Boolean(process.env.TELEGRAM_LIVECLUB_BOT_TOKEN?.trim()
    && process.env.TELEGRAM_LIVECLUB_CHAT_ID?.trim())
}

/** Appel brut a l'API Bot du groupe Live Club. Jette si Telegram refuse. */
export async function telegramPost(methode: string, corps: Record<string, unknown>): Promise<Record<string, unknown>> {
  const jeton = process.env.TELEGRAM_LIVECLUB_BOT_TOKEN?.trim()
  if (!jeton) throw new Error('TELEGRAM_LIVECLUB_BOT_TOKEN absent du projet journal.')
  const reponse = await fetch(`${API_TG}/bot${jeton}/${methode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  })
  const json = (await reponse.json()) as { ok?: boolean; description?: string; result?: unknown }
  if (!json.ok) throw new Error(`Telegram ${methode} : ${String(json.description ?? '?').slice(0, 200)}`)
  return json as Record<string, unknown>
}

/**
 * Le numero Telegram tel qu'il arrive (nombre, "123456789" ou "u123456789").
 * null = illisible : on refuse plutot que de deviner.
 */
export function lireTelegramId(brut: unknown): number | null {
  const s = String(brut ?? '').trim().replace(/^u/i, '')
  if (!/^\d{5,15}$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

export type GesteLiveClub = 'retirer' | 'reintegrer'

/**
 * L'issue d'un geste sur le groupe. `regle` est le code du motif, repris tel
 * quel dans cockpit_liveclub_gestes (manuel, exempte, admin_du_groupe,
 * absent_du_groupe, telegram, config, exemptions_illisibles). `details` part
 * dans la meme ligne : JAMAIS de lien d'invitation ni de texte de message.
 */
export type IssueGesteLiveClub =
  | {
    ok: true
    geste: GesteLiveClub
    message: string
    /** Reintegration seulement. Rendu a l'humain, jamais journalise ni loggue. */
    invite_link?: string
    regle: string
    details: Record<string, unknown>
  }
  | {
    ok: false
    geste: GesteLiveClub
    resultat: 'refuse' | 'echec'
    erreur: string
    regle: string
    statutHttp: number
    details: Record<string, unknown>
  }

function chatLiveClub(): number | null {
  const brut = process.env.TELEGRAM_LIVECLUB_CHAT_ID?.trim()
  return brut ? Number(brut) : null
}

function messageErreur(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200)
}

// La table n'existe pas encore (migration pas appliquee) : code Postgres 42P01.
function relationAbsente(err: unknown): boolean {
  return /42P01|relation .* does not exist/i.test(err instanceof Error ? err.message : String(err))
}

/**
 * L'exemption active d'un compte Telegram (fondateur, admin, equipe,
 * favorise), posee depuis le cockpit. Active = pas retiree, et sans date ou
 * date pas encore passee. Table absente = aucune exemption lue (avant la
 * migration il ne peut pas y en avoir), toute autre erreur remonte : on ne
 * retire personne sur une lecture ratee.
 */
export async function exemptionActive(telegramId: number): Promise<{ motif: string; jusquau: Date | null } | null> {
  try {
    const lignes = await prisma.$queryRaw<{ motif: string; jusquau: Date | null }[]>`
      select motif, jusquau from public.cockpit_liveclub_exemptions
      where telegram_id = ${telegramId}
        and retire_le is null
        and (jusquau is null or jusquau >= current_date)
      limit 1`
    return lignes[0] ?? null
  } catch (err) {
    if (relationAbsente(err)) {
      console.warn('[liveclub] cockpit_liveclub_exemptions absente (migration 20260929190100 pas appliquee) : aucune exemption lue.')
      return null
    }
    throw err
  }
}

/**
 * Sortir quelqu'un du groupe SANS le bannir. Dans l'ordre : exemption active
 * = refus ; getChatMember ; createur ou admin = refus ; absent (left, kicked,
 * restricted hors du groupe) = on ne fait RIEN, et surtout pas un unban qui
 * leverait le ban d'un banni ; sinon unbanChatMember sans only_if_banned.
 */
export async function retirerDuLiveClub(telegramId: number): Promise<IssueGesteLiveClub> {
  const geste: GesteLiveClub = 'retirer'
  const chatId = chatLiveClub()
  if (!chatId || !process.env.TELEGRAM_LIVECLUB_BOT_TOKEN?.trim()) {
    return {
      ok: false, geste, resultat: 'echec', regle: 'config', statutHttp: 503, details: {},
      erreur: 'TELEGRAM_LIVECLUB_BOT_TOKEN ou TELEGRAM_LIVECLUB_CHAT_ID absent du projet journal.',
    }
  }

  let exemption: { motif: string } | null
  try {
    exemption = await exemptionActive(telegramId)
  } catch (err) {
    return {
      ok: false, geste, resultat: 'echec', regle: 'exemptions_illisibles', statutHttp: 503,
      details: { erreur: messageErreur(err) },
      erreur: 'Impossible de lire les exemptions : rien n’a été fait, par prudence.',
    }
  }
  if (exemption) {
    return {
      ok: false, geste, resultat: 'refuse', regle: 'exempte', statutHttp: 409,
      details: { motif: exemption.motif },
      erreur: `u${telegramId} est exempté (${exemption.motif}) : on ne le retire pas. `
        + `Si c’est voulu, retire d’abord l’exemption dans le cockpit.`,
    }
  }

  let statut = ''
  let estMembre: boolean | undefined
  try {
    const reponse = await telegramPost('getChatMember', { chat_id: chatId, user_id: telegramId })
    const membre = reponse.result as { status?: string; is_member?: boolean } | undefined
    statut = String(membre?.status ?? '')
    estMembre = membre?.is_member
  } catch (err) {
    return {
      ok: false, geste, resultat: 'echec', regle: 'telegram', statutHttp: 502,
      details: { etape: 'getChatMember', erreur: messageErreur(err) },
      erreur: `Telegram ne dit pas si u${telegramId} est dans le groupe : ${messageErreur(err)}`,
    }
  }

  if (statut === 'creator' || statut === 'administrator') {
    return {
      ok: false, geste, resultat: 'refuse', regle: 'admin_du_groupe', statutHttp: 409,
      details: { statut_tg: statut },
      erreur: `u${telegramId} est ${statut === 'creator' ? 'le créateur' : 'administrateur'} du groupe : on ne le retire jamais.`,
    }
  }

  const present = statut === 'member' || (statut === 'restricted' && estMembre === true)
  if (!present) {
    return {
      ok: false, geste, resultat: 'refuse', regle: 'absent_du_groupe', statutHttp: 409,
      details: { statut_tg: statut || null },
      erreur: statut === 'kicked'
        ? `u${telegramId} n’est pas dans le groupe (banni, sans doute par Metricgram) : rien à retirer, et son ban reste en place.`
        : `u${telegramId} n’est pas dans le groupe (statut Telegram « ${statut || 'inconnu'} ») : rien à retirer.`,
    }
  }

  try {
    await telegramPost('unbanChatMember', { chat_id: chatId, user_id: telegramId })
  } catch (err) {
    return {
      ok: false, geste, resultat: 'echec', regle: 'telegram', statutHttp: 502,
      details: { etape: 'unbanChatMember', statut_tg: statut, erreur: messageErreur(err) },
      erreur: `Telegram a refusé la sortie de u${telegramId} : ${messageErreur(err)}`,
    }
  }
  return {
    ok: true, geste, regle: 'manuel', details: { statut_tg: statut },
    message: `u${telegramId} est sorti du groupe Live Club, sans bannissement : `
      + `un lien d’invitation valide suffirait à le faire revenir.`,
  }
}

/**
 * Reintegrer : unban avec only_if_banned D'ABORD (leve un ban, le notre avant
 * le 29/09 ou celui de Metricgram, sans toucher a un membre present), puis un
 * lien a usage unique valable 14 jours. Le lien revient dans invite_link et
 * nulle part ailleurs.
 */
export async function reintegrerAuLiveClub(telegramId: number): Promise<IssueGesteLiveClub> {
  const geste: GesteLiveClub = 'reintegrer'
  const chatId = chatLiveClub()
  if (!chatId || !process.env.TELEGRAM_LIVECLUB_BOT_TOKEN?.trim()) {
    return {
      ok: false, geste, resultat: 'echec', regle: 'config', statutHttp: 503, details: {},
      erreur: 'TELEGRAM_LIVECLUB_BOT_TOKEN ou TELEGRAM_LIVECLUB_CHAT_ID absent du projet journal.',
    }
  }

  try {
    await telegramPost('unbanChatMember', { chat_id: chatId, user_id: telegramId, only_if_banned: true })
  } catch (err) {
    return {
      ok: false, geste, resultat: 'echec', regle: 'telegram', statutHttp: 502,
      details: { etape: 'unbanChatMember', erreur: messageErreur(err) },
      erreur: `Telegram a refusé de lever le ban de u${telegramId} : ${messageErreur(err)}`,
    }
  }

  const expire = Math.floor(Date.now() / 1000) + 14 * 86400
  let lien: string | undefined
  try {
    const reponse = await telegramPost('createChatInviteLink', {
      chat_id: chatId,
      member_limit: 1,
      expire_date: expire,
      name: `reintegration u${telegramId}`,
    })
    lien = (reponse.result as { invite_link?: string } | undefined)?.invite_link
  } catch (err) {
    return {
      ok: false, geste, resultat: 'echec', regle: 'telegram', statutHttp: 502,
      details: { etape: 'createChatInviteLink', ban_leve: true, erreur: messageErreur(err) },
      erreur: `Ban levé pour u${telegramId}, mais Telegram n’a pas créé le lien : ${messageErreur(err)}`,
    }
  }
  if (!lien) {
    return {
      ok: false, geste, resultat: 'echec', regle: 'telegram', statutHttp: 502,
      details: { etape: 'createChatInviteLink', ban_leve: true },
      erreur: `Ban levé pour u${telegramId}, mais Telegram n’a renvoyé aucun lien.`,
    }
  }
  return {
    ok: true, geste, regle: 'manuel', invite_link: lien,
    details: { lien_expire_le: new Date(expire * 1000).toISOString() },
    message: `u${telegramId} peut revenir : ban levé s’il y en avait un. `
      + `Lien à lui transmettre, usage unique, expire dans 14 jours.`,
  }
}

/**
 * Les valeurs de cockpit_liveclub_gestes.geste. Les quatre dernieres
 * (acces_broker, arret_annule, invitation, fin_acces) demandent la migration
 * 20260929200300 : avant elle, l'insert bute sur le check et la ligne est
 * perdue (loggue), jamais le geste.
 */
export type GesteJournal =
  | 'retrait' | 'reintegration' | 'entree_acceptee' | 'entree_refusee'
  | 'pause' | 'arret' | 'reprise' | 'rappel' | 'refus'
  | 'acces_broker' | 'arret_annule' | 'invitation' | 'fin_acces'

export type ResultatGeste = 'fait' | 'refuse' | 'echec' | 'simule'

/** Une ligne de journal qui ne vient pas de retirerDuLiveClub / reintegrerAuLiveClub. */
export type EntreeJournalLiveClub = {
  geste: GesteJournal
  resultat: ResultatGeste
  regle?: string | null
  /** JAMAIS de texte de message, de lien d'invitation ni d'email. */
  details?: Record<string, unknown>
}

export type ContexteJournalLiveClub = {
  telegramId: number | null
  membreId?: string | null
  acteur: string
  abonnementId?: string | null
  /** update_id Telegram : unique en base, un update rejoue ne trace pas deux fois. */
  updateId?: number | null
  /** Remplace le geste deduit d'une IssueGesteLiveClub (ex. un retrait du passage quotidien trace en 'fin_acces'). */
  geste?: GesteJournal
  /** Remplace la regle d'une IssueGesteLiveClub (ex. 'pause' au lieu de 'manuel'). */
  regle?: string
}

/**
 * Une ligne par tentative dans cockpit_liveclub_gestes (SQL brut, comme les
 * autres ecritures serveur). Ne jette JAMAIS : si la table manque (migration
 * 20260929190200 pas appliquee) ou si l'insert echoue, on le loggue et le
 * geste garde sa reponse. Ni le lien ni le message ne sont ecrits.
 * Renvoie 'doublon' quand l'update_id est deja trace (rien n'est ecrit).
 */
export async function journaliserGesteLiveClub(
  issue: IssueGesteLiveClub | EntreeJournalLiveClub,
  contexte: ContexteJournalLiveClub,
): Promise<'ecrit' | 'doublon' | 'echec'> {
  const deIssue = 'ok' in issue
  const geste: GesteJournal = contexte.geste
    ?? (deIssue ? (issue.geste === 'retirer' ? 'retrait' : 'reintegration') : issue.geste)
  const resultat: ResultatGeste = deIssue ? (issue.ok ? 'fait' : issue.resultat) : issue.resultat
  const regle = contexte.regle ?? issue.regle ?? null
  const details = issue.details ?? {}
  try {
    const n = await prisma.$executeRaw`
      insert into public.cockpit_liveclub_gestes
        (telegram_id, membre_id, abonnement_id, geste, resultat, acteur, regle, update_id, details)
      values (${contexte.telegramId}, ${contexte.membreId ?? null}::uuid, ${contexte.abonnementId ?? null},
              ${geste}, ${resultat}, ${contexte.acteur}, ${regle}, ${contexte.updateId ?? null},
              ${JSON.stringify(details)}::jsonb)
      on conflict (update_id) do nothing`
    return n === 0 ? 'doublon' : 'ecrit'
  } catch (err) {
    console.warn(`[liveclub/gestes] journalisation impossible (${geste} u${contexte.telegramId ?? '?'} ${resultat})`
      + `${relationAbsente(err) ? ' : table absente, migration 20260929190200 pas appliquee' : ` : ${messageErreur(err)}`}`)
    return 'echec'
  }
}

export function validerAction(brut: unknown): ActionAgent | string {
  const a = brut as ActionAgent
  if (!a || typeof a !== 'object') return 'Action illisible.'
  if (!a.params || typeof a.params !== 'object') return 'Paramètres manquants.'
  const p = a.params

  // Les actions du groupe Telegram n'ont pas de compte Stripe.
  if (a.type === 'retirer_telegram' || a.type === 'reintegrer_telegram') {
    const telegramId = lireTelegramId(p.telegram_id)
    if (telegramId === null) {
      return 'telegram_id invalide (le numéro u… de cockpit_telegram_membres, sans le u).'
    }
    const qui = String(p.qui ?? '').trim().slice(0, 80)
    if (!qui) return 'Précise QUI (nom ou pseudo) pour que la carte de confirmation soit lisible.'
    return { type: a.type, compte: 'telegram', params: { telegram_id: telegramId, qui } }
  }

  // Acces broker (RaiseFx, 29/09) : une liste d'emails colles par Melanie.
  // Liste ou texte (un par ligne, virgules) ; une seule adresse illisible et
  // c'est un refus, pour que le modele la montre au lieu de l'avaler.
  if (a.type === 'acces_broker') {
    const brut = p.emails
    const morceaux = Array.isArray(brut)
      ? brut.flatMap(e => decouperEmails(String(e ?? '')))
      : typeof brut === 'string' ? decouperEmails(brut) : []
    if (morceaux.length === 0) return 'emails : au moins une adresse.'
    const invalides = morceaux.filter(e => !normaliserEmail(e))
    if (invalides.length) {
      return `Adresse(s) illisible(s) : ${invalides.slice(0, 5).map(e => e.slice(0, 80)).join(', ')}. `
        + `Corrige-les ou retire-les, puis repropose.`
    }
    const emails = [...new Set(morceaux.map(e => normaliserEmail(e) as string))]
    if (emails.length > 50) return '50 emails au plus par carte : découpe la liste.'
    const note = p.note == null ? null : String(p.note).trim().slice(0, 200) || null
    return { type: 'acces_broker', compte: 'telegram', params: { emails, note } }
  }

  if (!estCompte(a.compte)) return 'Compte inconnu : aoknowledge ou melanie.'

  if (a.type === 'pause_abonnement' || a.type === 'reprise_abonnement') {
    const abo = String(p.abonnement_id ?? '').replace(/^stripe:/, '')
    if (!/^sub_[A-Za-z0-9]{8,}$/.test(abo)) {
      return 'abonnement_id invalide (sub_..., depuis cockpit_abonnements sans le préfixe stripe:).'
    }
    const qui = String(p.qui ?? '').trim().slice(0, 80)
    if (!qui) return 'Précise QUI pour que la carte de confirmation soit lisible.'
    if (a.type === 'reprise_abonnement') {
      return { type: a.type, compte: a.compte, params: { abonnement_id: abo, qui } }
    }
    const mois = Number(p.nb_mois)
    if (!(Number.isInteger(mois) && mois >= 1 && mois <= 6)) {
      return 'nb_mois : entier entre 1 et 6.'
    }
    return { type: a.type, compte: a.compte, params: { abonnement_id: abo, qui, nb_mois: mois } }
  }

  if (a.type === 'code_promo') {
    const code = String(p.code ?? '').toUpperCase()
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return 'Code invalide (3 à 30 caractères, A-Z 0-9 - _).'
    const pourcentage = p.pourcentage == null ? null : Number(p.pourcentage)
    const montant = p.montant == null ? null : Number(p.montant)
    if ((pourcentage == null) === (montant == null)) {
      return 'Il faut soit un pourcentage, soit un montant fixe — exactement un des deux.'
    }
    if (pourcentage != null && !(pourcentage >= 1 && pourcentage <= 100)) {
      return 'Pourcentage entre 1 et 100.'
    }
    if (montant != null && !(montant > 0 && montant <= 5000)) {
      return 'Montant entre 0 et 5 000.'
    }
    const duree = String(p.duree ?? 'once')
    if (!['once', 'forever', 'repeating'].includes(duree)) {
      return 'Durée : once, forever ou repeating.'
    }
    const mois = p.duree_mois == null ? null : Number(p.duree_mois)
    if (duree === 'repeating' && !(mois && mois >= 1 && mois <= 24)) {
      return 'repeating demande duree_mois (1 à 24).'
    }
    const max = p.max_utilisations == null ? null : Number(p.max_utilisations)
    if (max != null && !(Number.isInteger(max) && max >= 1 && max <= 10000)) {
      return 'max_utilisations : entier entre 1 et 10 000.'
    }
    const expire = p.expire_le == null ? null : String(p.expire_le)
    if (expire && !/^\d{4}-\d{2}-\d{2}$/.test(expire)) return 'expire_le au format YYYY-MM-DD.'
    const devise = String(p.devise ?? 'eur').toLowerCase()
    if (!['eur', 'usd'].includes(devise)) return 'Devise : EUR ou USD.'
    return {
      type: 'code_promo', compte: a.compte,
      params: { code, pourcentage, montant, devise, duree, duree_mois: mois, max_utilisations: max, expire_le: expire },
    }
  }

  if (a.type === 'remboursement') {
    // Nos paiement_id sont "stripe:ch_..." : on tolere le prefixe.
    const charge = String(p.charge_id ?? '').replace(/^stripe:/, '')
    if (!/^ch_[A-Za-z0-9]{8,}$/.test(charge)) {
      return 'charge_id invalide (attendu ch_..., depuis cockpit_paiements).'
    }
    const montant = p.montant == null ? null : Number(p.montant)
    if (montant != null && !(montant > 0 && montant <= 10000)) {
      return 'Montant du remboursement entre 0 et 10 000 (vide = remboursement total).'
    }
    return { type: 'remboursement', compte: a.compte, params: { charge_id: charge, montant } }
  }

  if (a.type === 'revoquer_code') {
    const code = String(p.code ?? '').trim()
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(code)) return 'Code à révoquer invalide.'
    return { type: 'revoquer_code', compte: a.compte, params: { code } }
  }

  if (a.type === 'produit') {
    const nom = String(p.nom ?? '').trim()
    if (nom.length < 3 || nom.length > 80) return 'Nom du produit : 3 à 80 caractères.'
    const montant = Number(p.montant)
    if (!(montant > 0 && montant <= 20000)) return 'Prix entre 0 et 20 000.'
    const devise = String(p.devise ?? 'eur').toLowerCase()
    if (!['eur', 'usd'].includes(devise)) return 'Devise : EUR ou USD.'
    const recurrence = p.recurrence == null ? null : String(p.recurrence)
    if (recurrence && !['month', 'year'].includes(recurrence)) {
      return 'Récurrence : month, year, ou rien (comptant).'
    }
    return { type: 'produit', compte: a.compte, params: { nom, montant, devise, recurrence } }
  }

  return 'Type d’action inconnu.'
}

/** Une phrase qui dit ce que l'action va faire, pour la carte de confirmation. */
export function resumeAction(a: ActionAgent): string {
  const p = a.params
  if (a.type === 'code_promo') {
    const reduc = p.pourcentage != null
      ? `${p.pourcentage} %`
      : `${p.montant} ${String(p.devise).toUpperCase()}`
    const duree = p.duree === 'forever' ? 'à vie'
      : p.duree === 'repeating' ? `pendant ${p.duree_mois} mois` : 'une fois'
    const limites = [
      p.max_utilisations != null ? `${p.max_utilisations} utilisations max` : null,
      p.expire_le ? `expire le ${p.expire_le}` : null,
    ].filter(Boolean).join(', ')
    return `Créer le code ${p.code} : ${reduc} ${duree}${limites ? ` (${limites})` : ''} sur le compte ${a.compte}.`
  }
  if (a.type === 'remboursement') {
    return `Rembourser ${p.montant != null ? `${p.montant} ` : 'INTÉGRALEMENT '}le paiement ${p.charge_id} sur le compte ${a.compte}.`
  }
  if (a.type === 'revoquer_code') {
    return `Désactiver le code ${p.code} sur le compte ${a.compte} : plus personne ne pourra le taper. `
      + `Les réductions déjà appliquées aux abonnés continuent, elles.`
  }
  if (a.type === 'pause_abonnement') {
    return `Mettre l'abonnement de ${p.qui} en pause ${p.nb_mois} mois : la période déjà payée `
      + `va à son terme, puis plus aucun prélèvement jusqu'à la reprise automatique. `
      + `Le retrait du Telegram reste un geste séparé.`
  }
  if (a.type === 'reprise_abonnement') {
    return `Lever la pause de l'abonnement de ${p.qui} : les prélèvements reprennent au prochain cycle.`
  }
  if (a.type === 'retirer_telegram') {
    return `Retirer ${p.qui} (u${p.telegram_id}) du groupe Telegram Live Club, SANS le bannir : `
      + `il sort, et un lien d'invitation valide suffirait à le faire revenir. `
      + `Refusé d'office si c'est un admin du groupe ou un exempté.`
  }
  if (a.type === 'reintegrer_telegram') {
    return `Réintégrer ${p.qui} (u${p.telegram_id}) dans le groupe Live Club : levée du ban s'il y en a un `
      + `(celui de Metricgram compris) + lien d'invitation à usage unique (14 jours) à lui transmettre.`
  }
  if (a.type === 'acces_broker') {
    const emails = (p.emails as string[]) ?? []
    return `Accorder 6 mois d'accès broker au Live Club, à partir d'aujourd'hui, à ${emails.length} `
      + `adresse${emails.length > 1 ? 's' : ''} : ${emails.join(', ')}. `
      + `Chacune reçoit un email de support@ avec son lien personnel vers le bot. `
      + `Non renouvelable : une adresse qui a déjà eu un accès broker est refusée, `
      + `et une adresse déjà abonnée est signalée sans rien accorder.`
      + (p.note ? ` Note : ${p.note}` : '')
  }
  return `Créer le produit « ${p.nom} » à ${p.montant} ${String(p.devise).toUpperCase()}${p.recurrence ? `/${p.recurrence === 'month' ? 'mois' : 'an'}` : ' (comptant)'} sur le compte ${a.compte}.`
}

/**
 * Une action refusee par une regle (exempte, admin du groupe, deja dehors) :
 * rien n'a ete execute, et ce n'est pas une panne. Les routes de l'agent la
 * distinguent d'un echec et ne l'affichent jamais comme un succes.
 */
export class RefusAction extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefusAction'
  }
}

/**
 * Remplace les liens d'invitation Telegram d'un texte avant de le conserver
 * (historique de conversation) : le lien part a l'humain, pas en base.
 */
export function expurgerLiensInvitation(texte: string): string {
  return texte.replace(/https?:\/\/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)\S+/gi, '[lien transmis]')
}

/**
 * Execute une action DEJA validee. Renvoie une phrase de resultat, jette
 * RefusAction si une regle a bloque le geste, Error sur une panne.
 * `acteur` signe la ligne de cockpit_liveclub_gestes pour les gestes Telegram
 * (agent:<uuid> depuis les deux canaux de l'agent).
 */
export async function executerAction(a: ActionAgent, acteur = 'agent'): Promise<string> {
  // ── Groupe Telegram ───────────────────────────────────────────────────────
  // Memes fonctions que le bouton du cockpit : memes refus (admin, exempte),
  // meme journal. Le lien d'invitation revient a l'humain dans la phrase de
  // resultat, jamais dans le journal.
  if (a.type === 'retirer_telegram' || a.type === 'reintegrer_telegram') {
    const id = Number(a.params.telegram_id)
    const issue = a.type === 'retirer_telegram'
      ? await retirerDuLiveClub(id)
      : await reintegrerAuLiveClub(id)
    await journaliserGesteLiveClub(issue, { telegramId: id, acteur })

    if (!issue.ok) {
      // Refus (exempte, admin, deja dehors) : rien n'a ete fait, ce n'est pas
      // une panne. Erreur a part, pour que les canaux de l'agent ne l'affichent
      // ni comme un succes ni comme un echec.
      if (issue.resultat === 'refuse') throw new RefusAction(`${a.params.qui} : ${issue.erreur}`)
      throw new Error(issue.erreur)
    }
    return issue.invite_link
      ? `${a.params.qui} : ${issue.message} Lien : ${issue.invite_link}`
      : `${a.params.qui} : ${issue.message} La table cockpit_telegram_membres l'enregistrera au prochain événement.`
  }

  // ── Acces broker (RaiseFx) ────────────────────────────────────────────────
  // Meme fonction que le formulaire du cockpit. Import dynamique : acces.ts
  // importe deja ce fichier (journaliserGesteLiveClub), on evite le cycle.
  if (a.type === 'acces_broker') {
    const { accorderAccesBroker, prerequisAccesBroker } = await import('@/lib/liveclub/acces')
    const manque = prerequisAccesBroker()
    if (manque) throw new Error(manque)
    const emails = (a.params.emails as string[]) ?? []
    const resultats = await accorderAccesBroker(emails, {
      acteur, note: typeof a.params.note === 'string' ? a.params.note : null,
    })
    const lignes = resultats.map(r => {
      switch (r.resultat) {
        case 'accorde':
          return `${r.email} : ${r.renvoi ? 'accès déjà accordé, invitation renvoyée,' : 'accordé'} jusqu'au ${r.jusquau}`
            + (r.emailEnvoye ? ', email parti' : `, ATTENTION email PAS parti (${r.erreur ?? '?'})`)
        case 'deja_accorde':
          return `${r.email} : déjà eu un accès broker${r.jusquau ? ` (jusqu'au ${r.jusquau})` : ''}, non renouvelable, rien fait`
        case 'deja_abonne':
          return `${r.email} : déjà abonné au Live Club, rien accordé`
        case 'invalide':
          return `${r.email} : adresse illisible, rien fait`
        default:
          return `${r.email} : échec, rien accordé (${r.erreur ?? '?'})`
      }
    })
    const accordes = resultats.filter(r => r.resultat === 'accorde' && !r.renvoi).length
    // Tout en echec (base ou Stripe illisible) : c'est une panne, pas un succes.
    if (resultats.length > 0 && resultats.every(r => r.resultat === 'echec')) {
      throw new Error(`Aucun accès accordé.\n${lignes.join('\n')}`)
    }
    // Un message Telegram tient en 4 096 caracteres : au-dela de 25 adresses,
    // on ne detaille que ce qui n'est pas un accord propre.
    const detail = resultats.length > 25
      ? lignes.filter((_l, i) => !(resultats[i].resultat === 'accorde' && resultats[i].emailEnvoye))
      : lignes
    return `Accès broker : ${accordes} accordé${accordes > 1 ? 's' : ''} sur ${resultats.length}.`
      + (detail.length ? `\n${detail.join('\n')}` : ' Tous les emails sont partis.')
  }

  const cle = cleAgent(a.compte as CompteStripe)
  if (!cle) {
    throw new Error(
      `La clé d'écriture du compte ${a.compte} n'existe pas encore `
      + `(variable ${nomVariableCle(a.compte as CompteStripe)} sur le projet journal).`,
    )
  }
  const p = a.params

  if (a.type === 'pause_abonnement' || a.type === 'reprise_abonnement') {
    const abo = String(p.abonnement_id)

    if (a.type === 'reprise_abonnement') {
      // Vider pause_collection = lever la pause. Le prochain cycle preleve.
      // Dans le MEME appel, effacer les metadonnees qui dataient la pause
      // (liveclub/pur.ts) : laissees en place, une pause posee plus tard au
      // Dashboard reprendrait cette fin payee perimee et sortirait un membre
      // qui a paye.
      await stripePost(cle, `/v1/subscriptions/${abo}`, {
        pause_collection: '',
        ...effacementMetadonneesPause(),
      })
      return `Pause levée pour ${p.qui} : les prélèvements reprennent au prochain cycle. `
        + `La réintégration Telegram reste un geste séparé (proposer_reintegrer_telegram).`
    }

    // REGLE (Brice, 10/09) : la pause demarre a la date de renouvellement,
    // jamais en milieu de periode payee. pause_collection ne touche que les
    // factures FUTURES : posee maintenant, la periode payee va a son terme,
    // puis behavior=void annule chaque facture jusqu'a resumes_at — calcule
    // ici depuis la vraie fin de periode, jamais depuis une date du modele.
    const sub = await stripeGet(cle, `/v1/subscriptions/${abo}`)
    const statut = String(sub.status ?? '')
    if (!['active', 'trialing', 'past_due'].includes(statut)) {
      throw new Error(`L'abonnement est « ${statut} » : on ne met en pause qu'un abonnement vivant.`)
    }

    // MEME pose que pauser() du bot (preparerPoseDePause, liveclub/pur.ts) :
    // pause_collection et les metadonnees qui datent le debut de la pause
    // (META_PAUSE_PAYE_JUSQUAU, META_PAUSE_REPRISE), dans le meme appel. Sans
    // elles, le bot du Live Club ne sait pas quand la periode payee se termine
    // et ne sort personne. Refuse une pause deja posee.
    const pose = preparerPoseDePause(sub, Number(p.nb_mois))
    await stripePost(cle, `/v1/subscriptions/${abo}`, pose.corps)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return `Abonnement de ${p.qui} en pause : payé jusqu'au ${fmt(new Date(pose.finPeriodeSec * 1000))}, `
      + `reprise automatique des prélèvements le ${fmt(pose.reprise)}. Visible dans le cockpit après la `
      + `prochaine collecte. ⚠️ Le retrait du Telegram à la fin de la période payée reste un geste `
      + `séparé tant que le raccord n'est pas construit.`
  }

  if (a.type === 'code_promo') {
    // `name` = le code : sans lui, la liste « Bons de reduction » de Stripe
    // affiche l'identifiant aleatoire du coupon (retour Brice 04/09).
    const coupon: Record<string, string> = {
      duration: String(p.duree), name: String(p.code),
    }
    if (p.pourcentage != null) coupon.percent_off = String(p.pourcentage)
    else {
      coupon.amount_off = String(Math.round(Number(p.montant) * 100))
      coupon.currency = String(p.devise)
    }
    if (p.duree === 'repeating') coupon.duration_in_months = String(p.duree_mois)
    const cree = await stripePost(cle, '/v1/coupons', coupon)

    // Forme « clover » : le coupon se reference dans un hash promotion.
    const promo: Record<string, string> = {
      'promotion[type]': 'coupon',
      'promotion[coupon]': String(cree.id),
      code: String(p.code),
    }
    if (p.max_utilisations != null) promo.max_redemptions = String(p.max_utilisations)
    if (p.expire_le) {
      promo.expires_at = String(Math.floor(new Date(`${p.expire_le}T23:59:59Z`).getTime() / 1000))
    }
    const codePromo = await stripePost(cle, '/v1/promotion_codes', promo)
    return `Code ${(codePromo as { code?: string }).code} créé sur ${a.compte}. `
      + `Visible dans le cockpit après la prochaine collecte (demain matin).`
  }

  if (a.type === 'remboursement') {
    const corps: Record<string, string> = { charge: String(p.charge_id) }
    if (p.montant != null) corps.amount = String(Math.round(Number(p.montant) * 100))
    const remb = await stripePost(cle, '/v1/refunds', corps)
    const centimes = Number((remb as { amount?: number }).amount ?? 0)
    return `Remboursement de ${(centimes / 100).toFixed(2)} ${String((remb as { currency?: string }).currency ?? '').toUpperCase()} créé `
      + `(${(remb as { id?: string }).id}). Le paiement passera en remboursé à la prochaine collecte.`
  }

  if (a.type === 'revoquer_code') {
    // On retrouve le code vivant par son texte, puis on le desactive. Le
    // coupon sous-jacent n'est PAS supprime : les reductions deja appliquees
    // aux abonnes continuent — couper un avantage accorde est un autre geste,
    // qui ne passe pas par l'agent.
    const reponse = await fetch(
      `${API}/v1/promotion_codes?${new URLSearchParams({
        code: String(p.code), active: 'true', limit: '1',
      })}`,
      { headers: { Authorization: `Bearer ${cle}`, 'Stripe-Version': STRIPE_VERSION } },
    )
    const liste = (await reponse.json()) as { data?: { id: string }[] }
    const vivant = liste.data?.[0]
    if (!vivant) {
      throw new Error(`Aucun code actif « ${p.code} » sur le compte ${a.compte}.`)
    }
    await stripePost(cle, `/v1/promotion_codes/${vivant.id}`, { active: 'false' })
    return `Code ${p.code} désactivé sur ${a.compte}. Les réductions déjà en cours `
      + `chez les abonnés continuent. Visible dans le cockpit après la prochaine collecte.`
  }

  // produit
  const produit = await stripePost(cle, '/v1/products', { name: String(p.nom) })
  const prix: Record<string, string> = {
    product: String(produit.id),
    unit_amount: String(Math.round(Number(p.montant) * 100)),
    currency: String(p.devise),
  }
  if (p.recurrence) prix['recurring[interval]'] = String(p.recurrence)
  await stripePost(cle, '/v1/prices', prix)
  return `Produit « ${p.nom} » créé sur ${a.compte} avec son tarif. `
    + `⚠️ Pense à l'ajouter à PRODUITS_STRIPE (push_membres_supabase.py) pour que ses paiements soient classés.`
}
