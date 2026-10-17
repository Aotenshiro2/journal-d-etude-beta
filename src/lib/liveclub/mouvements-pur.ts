// Les arrivees et les departs des chats TRACES (Brice, 17/10/2026) : regles
// PURES, aucun reseau, aucune base. scripts/verifier-mouvements.mjs les verifie.
//
// Chats traces = les deux chats de Melanie ou le bot @aok_liveclub_bot est
// admin sans droits : le canal « MELMOM | ICT Trading » et le groupe « Les AS
// du NAS ». Liste en variable d'environnement (TELEGRAM_CHATS_TRACES), jamais
// en dur. Pour eux, le webhook ENREGISTRE chaque chat_member dans
// cockpit_telegram_mouvements (migration 20261017230000) et ne fait RIEN
// d'autre : ni message, ni accueil, ni exclusion, ni logique du Live Club.
//
// Le but : tracer le parcours des abonnes (conversion). D'ou le soin pris sur
// le lien d'invitation (nom, createur) et le mode d'arrivee.

const STATUTS = ['creator', 'administrator', 'member', 'restricted', 'left', 'kicked'] as const
export type StatutTg = (typeof STATUTS)[number]
export type Sens = 'arrivee' | 'depart' | 'autre'
export type Mode = 'lien' | 'demande' | 'dossier' | 'ajout' | 'direct' | 'volontaire' | 'retire'

type UtilisateurTg = { id?: unknown; is_bot?: boolean; first_name?: unknown; last_name?: unknown; username?: unknown }
type MembreTg = { status?: unknown; is_member?: unknown; user?: UtilisateurTg }

/** Le lien d'invitation tel que la Bot API le donne (ChatInviteLink). */
export type LienInvitationTg = {
  invite_link?: unknown
  name?: unknown
  creator?: UtilisateurTg
  is_primary?: unknown
  creates_join_request?: unknown
  subscription_price?: unknown
}

/** Un update chat_member (ChatMemberUpdated), forme minimale lue ici. */
export type ChangementMembreTg = {
  chat?: { id?: unknown; title?: unknown; type?: unknown }
  from?: UtilisateurTg
  date?: unknown
  old_chat_member?: MembreTg
  new_chat_member?: MembreTg
  invite_link?: LienInvitationTg
  via_join_request?: unknown
  via_chat_folder_invite_link?: unknown
}

/** Une ligne de public.cockpit_telegram_mouvements (hors id et recu_le). */
export type LigneMouvement = {
  updateId: number
  chatId: number
  groupe: string | null
  typeChat: 'channel' | 'supergroup' | 'group' | null
  telegramId: number
  pseudo: string | null
  nomAffiche: string | null
  ancienStatut: StatutTg | null
  nouveauStatut: StatutTg | null
  sens: Sens
  mode: Mode | null
  parId: number | null
  parQui: string | null
  inviteLienNom: string | null
  inviteLienUrl: string | null
  inviteCreePar: string | null
  inviteCreeParId: number | null
  invitePrincipal: boolean | null
  inviteSurDemande: boolean | null
  invitePrixEtoiles: number | null
  viaDemande: boolean
  viaDossier: boolean
  survenuLe: Date
}

/**
 * Les identifiants des chats traces, lus dans TELEGRAM_CHATS_TRACES
 * ("-1001651103428,-1003191036223"). Separateurs : virgule, point-virgule ou
 * espace. Seuls les entiers sont gardes. Le chat du Live Club n'en fait
 * JAMAIS partie, meme si on l'y met par erreur : sa logique ne doit pas etre
 * court-circuitee par le tracage.
 */
export function chatsTraces(brut: string | undefined | null, chatLiveClub?: string | null): Set<string> {
  const liveClub = (chatLiveClub ?? '').trim()
  const ids = new Set<string>()
  for (const morceau of (brut ?? '').split(/[\s,;]+/)) {
    const id = morceau.trim()
    if (/^-?\d{1,20}$/.test(id) && id !== liveClub) ids.add(id)
  }
  return ids
}

/** Le chat d'un update, s'il en porte un (chat_member, my_chat_member, chat_join_request). */
export function chatDeLUpdate(update: Record<string, unknown> | null | undefined): string | null {
  if (!update) return null
  for (const cle of ['chat_member', 'my_chat_member', 'chat_join_request']) {
    const partie = update[cle] as { chat?: { id?: unknown } } | undefined
    const id = partie?.chat?.id
    if (typeof id === 'number' || typeof id === 'string') return String(id)
  }
  return null
}

function statut(m: MembreTg | undefined): StatutTg | null {
  const s = m?.status
  return typeof s === 'string' && (STATUTS as readonly string[]).includes(s) ? (s as StatutTg) : null
}

/** Dedans = membre, admin, createur, ou restreint encore membre (is_member). */
export function estDedans(m: MembreTg | undefined): boolean | null {
  const s = statut(m)
  if (!s) return null
  if (s === 'restricted') return m?.is_member !== false
  return s === 'member' || s === 'administrator' || s === 'creator'
}

export function sensDuChangement(ancien: MembreTg | undefined, nouveau: MembreTg | undefined): Sens {
  const avant = estDedans(ancien)
  const apres = estDedans(nouveau)
  // Pas d'ancien statut lisible : on juge sur le nouveau seul.
  if (avant === null) return apres === true ? 'arrivee' : apres === false ? 'depart' : 'autre'
  if (apres === null || avant === apres) return 'autre'
  return apres ? 'arrivee' : 'depart'
}

function texte(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

function entierPositif(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null
}

/** @pseudo, sinon prenom et nom : la meme forme que par_qui du Live Club. */
export function nomDe(u: UtilisateurTg | undefined): string | null {
  if (!u) return null
  const pseudo = texte(u.username, 64)?.replace(/^@+/, '')
  if (pseudo) return `@${pseudo}`
  return texte([texte(u.first_name, 150), texte(u.last_name, 150)].filter(Boolean).join(' '), 300)
}

/**
 * L'url d'un lien d'invitation, MASQUEE. Un lien d'invitation est une cle
 * d'entree : il ne dort pas en clair dans une table. Telegram tronque deja un
 * lien cree par un autre admin (« https://t.me/+AbCdEfG… ») : il est garde
 * tel quel. Un lien complet (cree par le bot lui-meme) est tronque de la meme
 * facon : le debut du code, puis « … ». Ce reste suffit a distinguer deux
 * liens sans nom, sans permettre d'entrer.
 */
export function masquerLien(url: unknown): string | null {
  const brut = texte(url, 200)
  if (!brut) return null
  if (/…|\.\.\.$/.test(brut)) return brut.slice(0, 100)
  const m = /^(.*?(?:\/\+|\/joinchat\/))([A-Za-z0-9_-]+)/.exec(brut)
  if (m) return `${m[1]}${m[2].slice(0, 6)}…`.slice(0, 100)
  // Forme inconnue : on ne garde que l'hote, jamais le chemin.
  const hote = /^(https?:\/\/[^/]+)/.exec(brut)
  return hote ? `${hote[1]}/…` : null
}

/** Le mode d'arrivee ou de depart, selon les indices que Telegram donne. */
export function modeDuChangement(cm: ChangementMembreTg, sens: Sens): Mode | null {
  const membre = entierPositif(cm.new_chat_member?.user?.id)
  const auteur = entierPositif(cm.from?.id)
  const parLuiMeme = membre !== null && auteur === membre
  if (sens === 'arrivee') {
    if (cm.via_chat_folder_invite_link === true) return 'dossier'
    if (cm.via_join_request === true) return 'demande'
    if (cm.invite_link) return 'lien'
    if (auteur !== null && !parLuiMeme) return 'ajout'
    return 'direct'
  }
  if (sens === 'depart') return parLuiMeme ? 'volontaire' : 'retire'
  return null
}

/**
 * La ligne a ecrire pour un chat_member d'un chat trace, ou null quand il n'y
 * a rien a ecrire (identifiant illisible, bot).
 */
export function mouvementDepuisUpdate(updateId: number, cm: ChangementMembreTg | null | undefined, recuLe = new Date()): LigneMouvement | null {
  if (!cm || !Number.isSafeInteger(updateId)) return null
  const chatBrut = cm.chat?.id
  const chatId = typeof chatBrut === 'string' ? Number(chatBrut) : chatBrut
  if (typeof chatId !== 'number' || !Number.isSafeInteger(chatId)) return null
  const u = cm.new_chat_member?.user
  const telegramId = entierPositif(u?.id)
  if (!telegramId || u?.is_bot) return null

  const sens = sensDuChangement(cm.old_chat_member, cm.new_chat_member)
  const type = cm.chat?.type
  const lien = cm.invite_link
  const prix = typeof lien?.subscription_price === 'number' && Number.isSafeInteger(lien.subscription_price)
    && lien.subscription_price >= 0 ? lien.subscription_price : null
  const date = typeof cm.date === 'number' && Number.isFinite(cm.date) && cm.date > 0 ? new Date(cm.date * 1000) : recuLe

  return {
    updateId,
    chatId,
    groupe: texte(cm.chat?.title, 200),
    typeChat: type === 'channel' || type === 'supergroup' || type === 'group' ? type : null,
    telegramId,
    pseudo: texte(u?.username, 64)?.replace(/^@+/, '') || null,
    nomAffiche: texte([texte(u?.first_name, 150), texte(u?.last_name, 150)].filter(Boolean).join(' '), 300),
    ancienStatut: statut(cm.old_chat_member),
    nouveauStatut: statut(cm.new_chat_member),
    sens,
    mode: modeDuChangement(cm, sens),
    parId: entierPositif(cm.from?.id),
    parQui: nomDe(cm.from),
    inviteLienNom: texte(lien?.name, 64),
    inviteLienUrl: masquerLien(lien?.invite_link),
    inviteCreePar: nomDe(lien?.creator),
    inviteCreeParId: entierPositif(lien?.creator?.id),
    invitePrincipal: typeof lien?.is_primary === 'boolean' ? lien.is_primary : null,
    inviteSurDemande: typeof lien?.creates_join_request === 'boolean' ? lien.creates_join_request : null,
    invitePrixEtoiles: prix,
    viaDemande: cm.via_join_request === true,
    viaDossier: cm.via_chat_folder_invite_link === true,
    survenuLe: date,
  }
}
