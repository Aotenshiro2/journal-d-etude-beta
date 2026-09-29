// Le bot des membres @aok_liveclub_bot (29/09) : demandes d'adhesion, /start
// avec le jeton personnel, menu a boutons, confirmations, et l'agent Haiku
// pour le texte libre des comptes rattaches. La route du webhook aiguille,
// ce module traite.
//
// Regles tenues ici :
// - le coeur (entrer, refuser, executer) ne passe JAMAIS par l'IA ;
// - l'identite est le `from.id` de l'update, jamais un texte ;
// - un droit 'inconnu' ne tranche rien (demande laissee en attente) ;
// - on ne traite que les demandes nees de NOS liens (createur du lien = notre
//   bot) : tant que Metricgram tourne, ses entrees restent les siennes ;
// - jamais de texte de message, de jeton ni de lien d'invitation dans un log
//   ou dans le journal des gestes ;
// - (29/09) un compte non rattache se rattache par un code envoye a l'email
//   de son paiement (verification.ts), sans jamais savoir si une adresse est
//   celle d'un abonne ;
// - (29/09) chaque message ecrit et chaque reponse vont au fil Support du
//   cockpit (support-pont.ts), qui peut passer en « veut un humain ».

import { journaliserGesteLiveClub } from '@/lib/stripe-actions'
import { prisma } from '@/lib/db'
import { SUPPORT, chatId, texteAbonnement } from './config'
import { droitLiveClub, type Droit } from './droits'
import { consommerJeton, ErreurTableLiveClub } from './jetons'
import { rattacherTelegram, type Rattachement } from './rattacher'
import {
  envoyer, repondreBouton, retirerBoutons, lienDemandeAdhesion, approuverDemande,
  refuserDemande, estDansLeGroupe, statutDansLeGroupe, appelTelegram, type Bouton,
  type ResultatTelegram,
} from './telegram'
import {
  preparerAction, executerActionMembre, situationDuMembre, rattachementOuNull,
  clavierMenu, clavierSansRattachement, clavierDureesPause, clavierConfirmation,
  TEXTE_EQUIPE, TEXTE_EQUIPE_INDISPONIBLE, TEXTE_SECOURS_EQUIPE, TEXTE_NON_RATTACHE, TEXTE_PANNE,
  TEXTE_ATTENTE_HUMAIN, ACTEUR_BOT_MEMBRE,
} from './actions-membre'
import {
  premierPassage, reserverMessageIA, lireHistorique, ajouterEchange,
  poserActionEnAttente, consommerNonce,
} from './conversations'
import { repondreAuMembre } from './agent-membre'
import { enregistrerEchangeSupport, estEnAttenteHumain } from './support-pont'
import {
  envoyerCodeSiConnu, rattacherParEmail, reserverCode, verifierCode, type CodeReserve, type IssueCode,
} from './verification'
import { CODE_ENVOIS_HEURE, CODE_VALIDITE_MINUTES, intentionNonRattache, masquerCodes } from './verification-pur'
import { jetonBienForme, messageErreur, normaliserEmail, relationAbsente } from './pur'

// Formes minimales des updates Telegram utilises ici.
type Utilisateur = { id: number; is_bot?: boolean; first_name?: string }
type Chat = { id: number; type: string }
export type MessageTg = { message_id: number; chat: Chat; from?: Utilisateur; text?: string }
export type DemandeAdhesionTg = {
  chat: Chat
  from: Utilisateur
  user_chat_id?: number
  invite_link?: { creator?: { id?: number }; creates_join_request?: boolean }
}
export type BoutonTg = { id: string; from: Utilisateur; data?: string; message?: { message_id: number; chat: Chat } }

/** L'id numerique de notre bot : la partie avant « : » du jeton. */
function idDuBot(): number | null {
  const avant = process.env.TELEGRAM_LIVECLUB_BOT_TOKEN?.trim().split(':')[0]
  const n = Number(avant)
  return avant && Number.isSafeInteger(n) ? n : null
}

/**
 * Dedoublonnage d'un update prive. Table absente (migration pas appliquee) =
 * on traite quand meme : Telegram ne rejoue qu'un webhook reste sans reponse.
 */
async function nouveauPrive(telegramId: number, updateId: number): Promise<boolean> {
  try {
    return await premierPassage(telegramId, updateId)
  } catch (err) {
    if (!(err instanceof ErreurTableLiveClub)) console.warn(`[liveclub/bot] dedoublonnage impossible : ${messageErreur(err)}`)
    return true
  }
}

/** Un update de demande d'adhesion deja trace dans le journal des gestes ? */
async function demandeDejaTraitee(updateId: number): Promise<boolean> {
  try {
    const lignes = await prisma.$queryRaw<{ n: number }[]>`
      select 1 as n from public.cockpit_liveclub_gestes where update_id = ${updateId} limit 1`
    return lignes.length > 0
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[liveclub/bot] lecture du journal impossible : ${messageErreur(err)}`)
    return false
  }
}

function texteAccueil(prenom?: string): string {
  return `Salut${prenom ? ` ${prenom.slice(0, 40)}` : ''} ! Je suis le bot du Live Club.\n\n`
    + `Je te fais entrer dans le groupe, et je gère ton abonnement avec toi : le voir, le mettre en pause, l'arrêter. `
    + `Tu peux m'écrire ou utiliser les boutons.\n\n`
    + `À savoir : l'équipe du Live Club peut lire cette conversation, pour t'aider si besoin.`
}

/**
 * Trace un message dans le fil Support du cockpit (decision 5 : toutes les
 * conversations du bot y sont, etiquette 'telegram'). L'identite ne vient
 * que du rattachement, jamais d'un texte. Ne jette pas : une panne du support
 * ne casse pas le bot.
 */
async function versSupport(
  telegramId: number,
  r: Rattachement | null,
  role: 'membre' | 'ia',
  texte: string,
  veutHumain = false,
): Promise<void> {
  try {
    await enregistrerEchangeSupport({
      telegramId, membreId: r?.membre_id ?? null, email: r?.email ?? null, role, texte,
      ...(veutHumain ? { veutHumain: true } : {}),
    })
  } catch (err) {
    console.warn(`[liveclub/bot] fil support non ecrit : ${messageErreur(err)}`)
  }
}

/**
 * Envoie au membre ET trace la reponse du bot dans le fil Support.
 *
 * Avec veutHumain, le fil passe d'abord en attente, puis on RELIT l'attente :
 * le pont ne jette jamais et ne dit pas s'il a ecrit. Sans confirmation
 * (panne, migration du support pas appliquee), on ne promet pas une reponse
 * que personne ne verra : `secours` remplace le texte, ou a defaut l'adresse
 * de l'equipe lui est ajoutee.
 */
function repondeur(chat: number, telegramId: number, r: Rattachement | null) {
  return async (texte: string, boutons?: Bouton[][], veutHumain = false, secours?: string): Promise<void> => {
    if (!veutHumain) {
      await envoyer(chat, texte, boutons)
      await versSupport(telegramId, r, 'ia', texte)
      return
    }
    await versSupport(telegramId, r, 'ia', texte, true)
    if (await estEnAttenteHumain(telegramId)) {
      await envoyer(chat, texte, boutons)
      return
    }
    console.warn(`[liveclub/bot] mise en attente d'un humain non confirmee pour u${telegramId} : adresse de l'equipe donnee`)
    await envoyer(chat, secours ?? `${texte}\n\n${TEXTE_SECOURS_EQUIPE}`, boutons)
  }
}

async function envoyerMenu(
  chat: number,
  telegramId: number,
  entete?: string,
  dejaLu?: Awaited<ReturnType<typeof rattachementOuNull>>,
): Promise<void> {
  const r = dejaLu !== undefined ? dejaLu : await rattachementOuNull(telegramId)
  if (r && r !== 'illisible') {
    await envoyer(chat, entete ?? 'Que veux-tu faire ?', clavierMenu())
  } else {
    await envoyer(chat, entete ? `${entete}\n\n${TEXTE_NON_RATTACHE}` : TEXTE_NON_RATTACHE, clavierSansRattachement())
  }
}

// ---------------------------------------------------------------------------
// (4) Demande d'adhesion au groupe
// ---------------------------------------------------------------------------

function messageRefus(): string {
  return `Salut ! Je ne trouve pas d'abonnement Live Club actif lié à ton compte Telegram, donc je ne peux pas t'ouvrir le groupe.\n\n`
    + `Tu as payé et ça bloque quand même ? Envoie-moi ici l'email de ton paiement : je t'envoie un code pour vérifier, et je te relie à ton abonnement.\n\n`
    + texteAbonnement()
}

/**
 * Une demande d'adhesion. On ECRIT d'abord au demandeur (5 minutes, tant que
 * la demande est en attente), PUIS on approuve ou on refuse.
 */
export async function traiterDemandeAdhesion(demande: DemandeAdhesionTg, updateId: number): Promise<void> {
  const groupe = chatId()
  if (!groupe || demande.chat?.id !== groupe) return
  const u = demande.from
  if (!u?.id || u.is_bot) return

  // Un maitre par geste : une demande nee d'un lien qui n'est pas le notre
  // (Metricgram, un admin) n'est pas a nous. On ne la touche pas.
  const bot = idDuBot()
  if (!bot || demande.invite_link?.creator?.id !== bot) return

  if (await demandeDejaTraitee(updateId)) return

  const droit: Droit = await droitLiveClub(u.id)
  const ecrireA = demande.user_chat_id ?? u.id
  const contexte = { telegramId: u.id, membreId: droit.membreId ?? null, acteur: ACTEUR_BOT_MEMBRE, abonnementId: droit.abonnementId ?? null, updateId }

  if (droit.statut === 'inconnu') {
    await envoyer(ecrireA, `Salut ! J'ai bien reçu ta demande pour rejoindre le Live Club, mais j'ai un souci technique pour vérifier ton accès.\n\n`
      + `Ta demande reste en attente. Si rien ne bouge d'ici quelques minutes, renvoie /start ici ou écris à ${SUPPORT}.`)
    await journaliserGesteLiveClub(
      { geste: 'entree_acceptee', resultat: 'echec', regle: 'droit_inconnu', details: { sources: droit.erreurs?.length ?? 0 } },
      contexte,
    )
    return
  }

  if (droit.statut === 'oui') {
    await envoyer(ecrireA, `Bienvenue dans le Live Club ! Ta demande est acceptée, le groupe s'ouvre à l'instant.\n\n`
      + `Je reste là pour ton abonnement : écris-moi ici quand tu veux (le voir, une pause, un arrêt).`)
    const r = await approuverDemande(u.id)
    await journaliserGesteLiveClub(
      r.ok
        ? { geste: 'entree_acceptee', resultat: 'fait', regle: droit.raison, details: {} }
        : { geste: 'entree_acceptee', resultat: 'echec', regle: 'telegram', details: { etape: 'approveChatJoinRequest', erreur: r.erreur } },
      contexte,
    )
    return
  }

  await envoyer(ecrireA, messageRefus())
  const r = await refuserDemande(u.id)
  await journaliserGesteLiveClub(
    r.ok
      ? { geste: 'entree_refusee', resultat: 'fait', regle: 'sans_droit', details: {} }
      : { geste: 'entree_refusee', resultat: 'echec', regle: 'telegram', details: { etape: 'declineChatJoinRequest', erreur: r.erreur } },
    contexte,
  )
}

// ---------------------------------------------------------------------------
// Reprise d'une demande laissee en attente, et ban a lever avant un lien
// ---------------------------------------------------------------------------

/**
 * La derniere decision du bot sur une demande d'adhesion de ce compte est
 * restee en echec (droit inconnu, ou approbation refusee par Telegram) : la
 * demande attend encore, et Telegram n'en renverra pas d'autre tant qu'elle
 * n'est pas traitee. Seules nos demandes (liens de notre bot) sont tracees
 * ici, donc on ne reprend jamais une demande de Metricgram.
 */
async function demandeLaisseeEnAttente(telegramId: number): Promise<boolean> {
  try {
    const lignes = await prisma.$queryRaw<{ resultat: string }[]>`
      select resultat from public.cockpit_liveclub_gestes
      where telegram_id = ${telegramId} and acteur = ${ACTEUR_BOT_MEMBRE}
        and geste in ('entree_acceptee', 'entree_refusee')
      order by fait_le desc, geste_id desc
      limit 1`
    return lignes[0]?.resultat === 'echec'
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[liveclub/bot] lecture du journal impossible : ${messageErreur(err)}`)
    return false
  }
}

const TEXTE_DEMANDE_ACCEPTEE = `C'est bon, ta demande pour rejoindre le Live Club est acceptée : le groupe s'ouvre à l'instant.\n\n`
  + `Je reste là pour ton abonnement : écris-moi ici quand tu veux (le voir, une pause, un arrêt).`

/**
 * Approuve la demande laissee en attente si le droit est maintenant 'oui'.
 * L'approbation n'a pas de fenetre de temps (seule l'ecriture au demandeur
 * en a une). Renvoie true si le membre vient d'entrer. `updateId` n'est pose
 * que sur la ligne de succes : c'est alors le seul geste de l'update.
 */
async function reprendreDemandeEnAttente(u: Utilisateur, updateId: number, droitConnu?: Droit): Promise<boolean> {
  if (!(await demandeLaisseeEnAttente(u.id))) return false
  const droit = droitConnu ?? await droitLiveClub(u.id)
  if (droit.statut !== 'oui') return false

  const contexte = { telegramId: u.id, membreId: droit.membreId ?? null, acteur: ACTEUR_BOT_MEMBRE, abonnementId: droit.abonnementId ?? null }
  const r = await approuverDemande(u.id)
  if (r.ok) {
    await journaliserGesteLiveClub(
      { geste: 'entree_acceptee', resultat: 'fait', regle: droit.raison, details: { reprise: true } },
      { ...contexte, updateId },
    )
    return true
  }
  // 400 = plus de demande en attente (retiree, ou traitee ailleurs) : on le
  // note pour ne plus reessayer. Autre erreur = on reessaiera au prochain /start.
  await journaliserGesteLiveClub(
    r.code === 400
      ? { geste: 'entree_acceptee', resultat: 'refuse', regle: 'plus_de_demande', details: { reprise: true } }
      : { geste: 'entree_acceptee', resultat: 'echec', regle: 'telegram', details: { etape: 'approveChatJoinRequest', reprise: true, erreur: r.erreur } },
    { ...contexte, updateId: null },
  )
  return false
}

/**
 * Un compte banni du groupe ne peut pas revenir par un lien d'invitation.
 * Pour un payeur dont le droit est 'oui', on leve le ban avec only_if_banned
 * (comme reintegrerAuLiveClub : ban de Metricgram, d'un admin, ou le notre
 * d'avant la regle sans ban), puis le lien peut marcher. Statut illisible =
 * on laisse passer, comme avant. Journalise 'reintegration'.
 */
async function leverBanSiBanni(u: Utilisateur, droit: Droit): Promise<'libre' | 'leve' | 'echec'> {
  if (await statutDansLeGroupe(u.id) !== 'kicked') return 'libre'
  const groupe = chatId()
  const r: ResultatTelegram = groupe
    ? await appelTelegram('unbanChatMember', { chat_id: groupe, user_id: u.id, only_if_banned: true })
    : { ok: false, erreur: 'TELEGRAM_LIVECLUB_CHAT_ID absent ou illisible du projet journal.', code: null }
  await journaliserGesteLiveClub(
    r.ok
      ? { geste: 'reintegration', resultat: 'fait', regle: 'payeur_banni', details: { statut_tg: 'kicked' } }
      : { geste: 'reintegration', resultat: 'echec', regle: 'telegram', details: { etape: 'unbanChatMember', erreur: r.erreur } },
    { telegramId: u.id, membreId: droit.membreId ?? null, acteur: ACTEUR_BOT_MEMBRE, abonnementId: droit.abonnementId ?? null, updateId: null },
  )
  return r.ok ? 'leve' : 'echec'
}

// ---------------------------------------------------------------------------
// Payeur rattache, droit ouvert, mais hors du groupe : le lien de retour
// ---------------------------------------------------------------------------

/** Pas plus d'un lien de retour par tranche de 10 minutes sur un clic de bouton. */
const LIEN_BOUTON_MINUTES = 10

/** Un lien vers le groupe a-t-il deja ete envoye a ce compte il y a peu ? */
async function lienEnvoyeRecemment(telegramId: number): Promise<boolean> {
  try {
    const lignes = await prisma.$queryRaw<{ n: number }[]>`
      select 1 as n from public.cockpit_liveclub_gestes
      where telegram_id = ${telegramId} and acteur = ${ACTEUR_BOT_MEMBRE}
        and geste = 'invitation' and resultat = 'fait'
        and fait_le > now() - make_interval(mins => ${LIEN_BOUTON_MINUTES}::int)
      limit 1`
    return lignes.length > 0
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[liveclub/bot] lecture du journal impossible : ${messageErreur(err)}`)
    return false
  }
}

type OptionsRetour = {
  /** D'ou vient la demande (details du journal). */
  declencheur: 'start' | 'menu' | 'jeton_invalide' | 'bouton' | 'verification'
  /** Texte place avant l'explication (accueil, lien expire...). */
  entete?: string
  /** Boutons ajoutes sous le lien (le menu, sur /start et /menu). */
  boutons?: Bouton[][]
  /** Tenter la reprise d'une demande laissee en attente (deja faite sur /start et /menu). */
  reprendre: boolean
}

/**
 * Un compte RATTACHE (l'appelant l'a verifie) qui n'est pas dans le groupe
 * alors que son droit est 'oui' : ban de Metricgram, sortie d'une ancienne
 * pause, lien d'entree jamais ouvert... On lui envoie un lien de demande
 * d'adhesion avec l'explication, au lieu du seul menu. Presence ou droit
 * 'inconnu' : aucun lien, on dit de reessayer ou d'ecrire au support.
 * Renvoie true si un message est parti (l'appelant n'envoie alors pas son
 * menu seul) ; false = dans le groupe, sans droit, ou rien a dire.
 *
 * Sur un clic de bouton (`declencheur` 'bouton'), un lien deja envoye dans
 * les 10 dernieres minutes suffit : pas un lien neuf par clic.
 */
async function proposerRetourAuGroupe(chat: number, u: Utilisateur, updateId: number, o: OptionsRetour): Promise<boolean> {
  if (o.declencheur === 'bouton' && await lienEnvoyeRecemment(u.id)) return false
  const presence = await estDansLeGroupe(u.id)
  if (presence === 'oui') return false
  const droit = await droitLiveClub(u.id)
  if (droit.statut === 'non') return false

  const contexte = { telegramId: u.id, membreId: droit.membreId ?? null, acteur: ACTEUR_BOT_MEMBRE, abonnementId: droit.abonnementId ?? null }
  const avant = o.entete ? `${o.entete}\n\n` : ''
  const details = { declencheur: o.declencheur }

  if (droit.statut === 'inconnu' || presence === 'inconnu') {
    await envoyer(chat, `${avant}Je n'arrive pas à vérifier ton accès au groupe en ce moment, donc je ne t'envoie pas de lien. `
      + `Si tu n'es pas dans le groupe, réessaie dans quelques minutes avec /menu, ou écris à ${SUPPORT}.`, o.boutons)
    await journaliserGesteLiveClub(
      { geste: 'invitation', resultat: 'echec', regle: droit.statut === 'inconnu' ? 'droit_inconnu' : 'presence_inconnue', details },
      { ...contexte, updateId: null },
    )
    return true
  }

  // Une demande a nous attend deja : on l'approuve, un nouveau lien ne
  // servirait a rien tant qu'elle n'est pas traitee.
  if (o.reprendre && await reprendreDemandeEnAttente(u, updateId, droit)) {
    await envoyer(chat, `${avant}${TEXTE_DEMANDE_ACCEPTEE}`, o.boutons)
    return true
  }

  if (await leverBanSiBanni(u, droit) === 'echec') {
    await envoyer(chat, `${avant}Ton accès est bon, mais un ancien blocage t'empêche de revenir dans le groupe, et je n'arrive pas à le lever.\n\n`
      + `Écris à ${SUPPORT}, l'équipe s'en occupe.`, o.boutons)
    await journaliserGesteLiveClub(
      { geste: 'invitation', resultat: 'echec', regle: 'ban_non_leve', details },
      { ...contexte, updateId: null },
    )
    return true
  }

  let lien: string
  try {
    lien = await lienDemandeAdhesion(`bot u${u.id}`)
  } catch (err) {
    await envoyer(chat, `${avant}Ton accès est ouvert, mais je n'arrive pas à créer ton lien vers le groupe là, tout de suite. `
      + `Réessaie dans quelques minutes avec /menu, ou écris à ${SUPPORT}.`, o.boutons)
    await journaliserGesteLiveClub(
      { geste: 'invitation', resultat: 'echec', regle: 'telegram', details: { ...details, etape: 'createChatInviteLink', erreur: messageErreur(err) } },
      { ...contexte, updateId: null },
    )
    return true
  }
  await envoyer(chat, `${avant}Ton accès au Live Club est ouvert, mais tu n'es pas dans le groupe en ce moment. Voilà ton lien pour y revenir :\n\n`
    + `1. Appuie sur le bouton « Rejoindre le groupe ».\n`
    + `2. Demande à rejoindre le groupe.\n`
    + `3. C'est accepté tout seul, en quelques secondes.\n\n`
    + `Ce lien est personnel : il ne marche que pour ton compte.`,
  [[{ texte: 'Rejoindre le groupe', url: lien }], ...(o.boutons ?? [])])
  // updateId pose ici : c'est le seul geste de l'update qui le porte (les
  // lignes ci-dessus et celles de leverBanSiBanni vont sans).
  await journaliserGesteLiveClub(
    { geste: 'invitation', resultat: 'fait', regle: 'retour_groupe', details: { ...details, raison: droit.raison } },
    { ...contexte, updateId },
  )
  return true
}

// ---------------------------------------------------------------------------
// (5) /start <jeton>, (6) /start ou /menu, (7) texte libre
// ---------------------------------------------------------------------------

async function traiterStartJeton(chat: number, u: Utilisateur, jeton: string, updateId: number): Promise<void> {
  const journal = (entree: Parameters<typeof journaliserGesteLiveClub>[0], extra: { membreId?: string | null; abonnementId?: string | null } = {}) =>
    journaliserGesteLiveClub(entree, { telegramId: u.id, acteur: ACTEUR_BOT_MEMBRE, updateId, ...extra })

  let ligne: Awaited<ReturnType<typeof consommerJeton>> = null
  if (jetonBienForme(jeton)) {
    try {
      ligne = await consommerJeton(jeton, u.id)
    } catch (err) {
      console.warn(`[liveclub/bot] jeton illisible pour u${u.id} : ${messageErreur(err)}`)
      await envoyer(chat, `J'ai un souci technique pour lire ton lien. Réessaie dans quelques minutes, ou écris à ${SUPPORT}.`)
      await journal({ geste: 'invitation', resultat: 'echec', regle: 'jetons_illisibles', details: {} })
      return
    }
  }
  if (!ligne) {
    // Compte deja relie a un payeur (vieux lien rouvert) : s'il a le droit et
    // n'est pas dans le groupe, un lien de retour ; sinon son menu.
    const r = await rattachementOuNull(u.id)
    if (r && r !== 'illisible') {
      const entete = `Ce lien ne sert plus (il a expiré, ou il a déjà servi), mais ton compte Telegram est déjà relié à ton abonnement.`
      if (await proposerRetourAuGroupe(chat, u, updateId, { declencheur: 'jeton_invalide', entete, boutons: clavierMenu(), reprendre: true })) return
      await envoyer(chat, `${entete}\n\nQue veux-tu faire ?`, clavierMenu())
      await journal({ geste: 'invitation', resultat: 'refuse', regle: 'jeton_invalide', details: { rattache: true } })
      return
    }
    await envoyer(chat, `Ce lien ne marche pas : il a expiré, ou il a déjà servi à un autre compte Telegram.\n\n`
      + `Pas de souci : envoie-moi ici l'email de ton paiement. Je t'envoie un code pour vérifier, et je te relie à ton abonnement.`, clavierSansRattachement())
    await journal({ geste: 'invitation', resultat: 'refuse', regle: 'jeton_invalide', details: {} })
    return
  }

  // Le lien est bon : on relie ce compte Telegram au payeur du jeton.
  if (ligne.client_stripe || ligne.email) {
    try {
      await rattacherTelegram(u.id, { clientStripe: ligne.client_stripe, email: ligne.email, source: 'bot' })
    } catch (err) {
      console.warn(`[liveclub/bot] rattachement impossible pour u${u.id} : ${messageErreur(err)}`)
    }
  }

  const extra = { abonnementId: ligne.abonnement_id }
  const dedans = await estDansLeGroupe(u.id)
  if (dedans === 'oui') {
    await envoyer(chat, `Tu es déjà dans le groupe Live Club, tout est bon.\n\nJe reste là pour ton abonnement :`, clavierMenu())
    await journal({ geste: 'invitation', resultat: 'refuse', regle: 'deja_dans_le_groupe', details: { usage: ligne.usage } }, extra)
    return
  }

  const droit = await droitLiveClub(u.id)
  if (droit.statut === 'inconnu') {
    await envoyer(chat, `J'ai un souci technique pour vérifier ton accès. Réessaie dans quelques minutes en rouvrant ton lien, ou écris à ${SUPPORT}.`)
    await journal({ geste: 'invitation', resultat: 'echec', regle: 'droit_inconnu', details: { usage: ligne.usage } }, extra)
    return
  }
  if (droit.statut === 'non') {
    await envoyer(chat, `Ton lien est bon, mais je ne vois pas d'abonnement actif en ce moment, donc je ne peux pas t'ouvrir le groupe.\n\n`
      + `Si tu viens de payer, attends une minute et rouvre ton lien.\n\n${texteAbonnement()}`, clavierMenu())
    await journal({ geste: 'invitation', resultat: 'refuse', regle: 'sans_droit', details: { usage: ligne.usage } }, extra)
    return
  }

  // Une demande a nous attend deja (droit inconnu a l'epoque) : on l'approuve,
  // un nouveau lien ne servirait a rien tant qu'elle n'est pas traitee.
  if (await reprendreDemandeEnAttente(u, updateId, droit)) {
    await envoyer(chat, TEXTE_DEMANDE_ACCEPTEE, clavierMenu())
    return
  }

  if (await leverBanSiBanni(u, droit) === 'echec') {
    await envoyer(chat, `Ton accès est bon, mais un ancien blocage t'empêche de revenir dans le groupe, et je n'arrive pas à le lever.\n\n`
      + `Écris à ${SUPPORT}, l'équipe s'en occupe.`)
    await journal({ geste: 'invitation', resultat: 'echec', regle: 'ban_non_leve', details: { usage: ligne.usage } }, extra)
    return
  }

  let lien: string
  try {
    lien = await lienDemandeAdhesion(`bot u${u.id}`)
  } catch (err) {
    await envoyer(chat, `Je n'arrive pas à créer ton lien vers le groupe là, tout de suite. Réessaie dans quelques minutes, ou écris à ${SUPPORT}.`)
    await journal({ geste: 'invitation', resultat: 'echec', regle: 'telegram', details: { etape: 'createChatInviteLink', erreur: messageErreur(err) } }, extra)
    return
  }
  const boutons: Bouton[][] = [[{ texte: 'Rejoindre le groupe', url: lien }]]
  await envoyer(chat, `C'est bon, ton accès est ouvert !\n\n`
    + `1. Appuie sur le bouton ci-dessous.\n`
    + `2. Demande à rejoindre le groupe.\n`
    + `3. C'est accepté tout seul, en quelques secondes.\n\n`
    + `Ce lien est personnel : il ne marche que pour ton compte.`, boutons)
  await journal({ geste: 'invitation', resultat: 'fait', regle: droit.raison, details: { usage: ligne.usage } }, { ...extra, membreId: droit.membreId ?? null })
}

// ---------------------------------------------------------------------------
// Verification par code email d'un compte NON rattache (decision 4)
// ---------------------------------------------------------------------------

const TEXTE_DEMANDE_EMAIL = `Envoie-moi ici l'adresse email de ton paiement, en un message.\n\n`
  + `Je t'envoie un code à 6 chiffres à cette adresse, pour vérifier que c'est bien toi, puis je te relie à ton abonnement.`

/**
 * La MEME phrase que l'adresse soit connue ou non : rien ici ne dit a
 * quelqu'un si une adresse est celle d'un abonne.
 */
const TEXTE_CODE_DEMANDE = `C'est noté. Si cette adresse est celle d'un paiement Live Club, tu vas recevoir un code à 6 chiffres par email d'ici quelques minutes (regarde aussi dans les spams).\n\n`
  + `Tape-le ici. Il marche ${CODE_VALIDITE_MINUTES} minutes.`

function texteIssueCode(issue: Exclude<IssueCode, { etat: 'ok' }>): string {
  if (issue.etat === 'aucun') {
    return `Je n'ai pas de code en cours pour toi. Envoie-moi d'abord l'email de ton paiement, je t'en envoie un.`
  }
  if (issue.etat === 'expire') {
    return `Ce code a expiré (il marche ${CODE_VALIDITE_MINUTES} minutes). Renvoie-moi l'email de ton paiement, je t'en envoie un nouveau.`
  }
  if (issue.etat === 'bloque') {
    return `Trop de codes faux pour cette adresse dans l'heure, je n'en accepte plus pour le moment. Réessaie dans une heure.\n\n`
      + `Si ça bloque encore, écris à ${SUPPORT} avec l'email de ton paiement, l'équipe s'en occupe.`
  }
  if (issue.etat === 'epuise') {
    return `Trop d'essais avec ce code, il ne marche plus. Renvoie-moi l'email de ton paiement pour en recevoir un nouveau.\n\n`
      + `Si ça bloque encore, écris à ${SUPPORT} avec l'email de ton paiement, l'équipe s'en occupe.`
  }
  return `Ce n'est pas le bon code. Vérifie le dernier email reçu : un nouveau code remplace l'ancien. `
    + `Il te reste ${issue.restants} ${issue.restants > 1 ? 'essais' : 'essai'}.`
}

/** Le code est juste : on relie le compte, puis le lien du groupe si le droit est ouvert. */
async function apresCodeValide(chat: number, u: Utilisateur, email: string, updateId: number): Promise<void> {
  const repondre = repondeur(chat, u.id, null)
  const rattachement = await rattacherParEmail(u.id, email)
  if (rattachement.etat === 'deja_pris') {
    await repondre(`Ton email est bien vérifié, mais ton abonnement est déjà relié à un autre compte Telegram.\n\n`
      + `Si tu as changé de compte, écris à ${SUPPORT} avec l'email de ton paiement : l'équipe fait le changement.`)
    return
  }
  if (rattachement.etat === 'panne') {
    await repondre(`Ton email est bien vérifié, mais je n'arrive pas à te relier à ton abonnement là, tout de suite. `
      + `Renvoie-moi ton email dans quelques minutes pour un nouveau code, ou écris à ${SUPPORT}.`)
    return
  }

  const lu = await rattachementOuNull(u.id)
  const r = lu && lu !== 'illisible' ? lu : null
  const entete = `C'est bon, ton email est vérifié : ton compte Telegram est maintenant relié à ton abonnement.`
  // Droit ouvert et hors du groupe : le lien de retour (ban leve s'il le faut).
  if (await proposerRetourAuGroupe(chat, u, updateId, { declencheur: 'verification', entete, boutons: clavierMenu(), reprendre: true })) {
    await versSupport(u.id, r, 'ia', `${entete} (suite : lien vers le groupe, ou explication si l'accès ne peut pas être vérifié)`)
    return
  }
  // Pas de lien : dans le groupe, ou pas de droit ouvert.
  const droit = await droitLiveClub(u.id)
  const suite = droit.statut === 'non'
    ? `Mais je ne vois pas d'abonnement Live Club actif en ce moment, donc je ne peux pas t'ouvrir le groupe.\n\n${texteAbonnement()}`
    : `Tu es déjà dans le groupe, tout est bon. Que veux-tu faire ?`
  await repondeur(chat, u.id, r)(`${entete}\n\n${suite}`, clavierMenu())
}

/**
 * Le texte libre d'un compte PAS ENCORE rattache : un email = demande de
 * code, 6 chiffres = le code, le reste = l'explication (ou, si l'equipe a la
 * main, « message transmis »). Le code tape n'est jamais recopie dans le fil
 * Support.
 */
async function traiterNonRattache(chat: number, u: Utilisateur, texte: string, updateId: number): Promise<void> {
  const intention = intentionNonRattache(texte)
  // Un code tape n'est jamais lisible dans le fil Support, meme glisse dans
  // une phrase que lireCode n'a pas reconnue.
  await versSupport(u.id, null, 'membre', intention.type === 'code' ? '[code de vérification tapé]' : masquerCodes(texte))
  const repondre = repondeur(chat, u.id, null)

  if (intention.type === 'email') {
    const email = normaliserEmail(intention.brut)
    if (!email) {
      await repondre(`Cette adresse ne me semble pas complète. Renvoie-la moi en entier, par exemple : prenom@exemple.com`)
      return
    }
    let code: CodeReserve | null
    try {
      code = await reserverCode(u.id, email)
    } catch (err) {
      if (!(err instanceof ErreurTableLiveClub)) console.warn(`[liveclub/bot] code non reserve : ${messageErreur(err)}`)
      await repondre(`J'ai un souci technique pour t'envoyer un code. Réessaie dans quelques minutes, ou écris à ${SUPPORT} avec l'email de ton paiement.`)
      return
    }
    if (!code) {
      await repondre(`Tu as déjà demandé ${CODE_ENVOIS_HEURE} codes dans l'heure. Attends un peu avant d'en redemander un, ou écris à ${SUPPORT} avec l'email de ton paiement.`)
      return
    }
    // La reponse part AVANT de regarder si l'adresse est connue : ni le texte
    // ni le delai ne le disent.
    await repondre(TEXTE_CODE_DEMANDE)
    if (await envoyerCodeSiConnu(u.id, email, code) === 'panne') {
      console.warn(`[liveclub/bot] code non envoye pour u${u.id} : panne (adresse non loggee)`)
    }
    return
  }

  if (intention.type === 'code') {
    let issue: IssueCode
    try {
      issue = await verifierCode(u.id, intention.code)
    } catch (err) {
      if (!(err instanceof ErreurTableLiveClub)) console.warn(`[liveclub/bot] code illisible : ${messageErreur(err)}`)
      await repondre(`J'ai un souci technique pour vérifier ton code. Réessaie dans quelques minutes, ou écris à ${SUPPORT} avec l'email de ton paiement.`)
      return
    }
    if (issue.etat === 'ok') {
      await apresCodeValide(chat, u, issue.email, updateId)
      return
    }
    await repondre(texteIssueCode(issue))
    return
  }

  if (await estEnAttenteHumain(u.id)) {
    await repondre(TEXTE_ATTENTE_HUMAIN, clavierSansRattachement())
    return
  }
  await repondre(TEXTE_NON_RATTACHE, clavierSansRattachement())
}

/**
 * Le texte libre : l'agent pour un compte rattache, dans la limite du jour,
 * sinon le menu ; la verification par code pour un compte non rattache.
 * Chaque message du membre et chaque reponse du bot vont au fil Support du
 * cockpit. Si l'equipe a la main (fil « veut un humain »), le bot ne repond
 * pas a sa place : les boutons (gestes deterministes) restent la.
 */
async function traiterTexteLibre(chat: number, u: Utilisateur, texte: string, updateId: number): Promise<void> {
  const r = await rattachementOuNull(u.id)
  if (r === 'illisible') {
    await versSupport(u.id, null, 'membre', masquerCodes(texte))
    await repondeur(chat, u.id, null)(TEXTE_PANNE)
    return
  }
  if (!r) {
    await traiterNonRattache(chat, u, texte, updateId)
    return
  }

  await versSupport(u.id, r, 'membre', texte)
  const repondre = repondeur(chat, u.id, r)

  if (await estEnAttenteHumain(u.id)) {
    await repondre(TEXTE_ATTENTE_HUMAIN, clavierMenu())
    return
  }

  let sousLePlafond: boolean
  let historique: Awaited<ReturnType<typeof lireHistorique>>
  try {
    sousLePlafond = await reserverMessageIA(u.id)
    historique = sousLePlafond ? await lireHistorique(u.id) : []
  } catch (err) {
    if (!(err instanceof ErreurTableLiveClub)) console.warn(`[liveclub/bot] conversation illisible : ${messageErreur(err)}`)
    await repondre(`Je ne peux pas répondre aux messages écrits pour le moment. Les boutons marchent :`, clavierMenu())
    return
  }
  if (!sousLePlafond) {
    await repondre(`Tu m'as beaucoup écrit aujourd'hui, je m'arrête là pour les messages écrits. Les boutons marchent toujours :`, clavierMenu())
    return
  }

  await appelTelegram('sendChatAction', { chat_id: chat, action: 'typing' })
  let reponse: Awaited<ReturnType<typeof repondreAuMembre>>
  try {
    reponse = await repondreAuMembre(u.id, historique, texte)
  } catch (err) {
    console.warn(`[liveclub/bot] agent indisponible : ${messageErreur(err)}`)
    // L'agent ne sait pas repondre : le fil passe en « veut un humain ».
    await repondre(`Je n'arrive pas à répondre là, tout de suite, donc je préviens l'équipe : quelqu'un va te répondre ici. En attendant, les boutons marchent :`, clavierMenu(), true)
    return
  }

  if (reponse.action) {
    let nonce: string
    try {
      nonce = await poserActionEnAttente(u.id, reponse.action)
    } catch (err) {
      console.warn(`[liveclub/bot] action non posee : ${messageErreur(err)}`)
      await repondre(TEXTE_PANNE)
      return
    }
    await repondre(reponse.texte, clavierConfirmation(nonce), reponse.veutHumain === true)
  } else {
    // L'agent n'a pas abouti : le filet est le menu a boutons, joint au message.
    await repondre(reponse.texte, reponse.repli ? clavierMenu() : undefined, reponse.veutHumain === true)
  }
  try {
    await ajouterEchange(u.id, texte, reponse.texte)
  } catch (err) {
    console.warn(`[liveclub/bot] historique non ecrit : ${messageErreur(err)}`)
  }
}

/** Un message prive (deja filtre : chat.type === 'private'). */
export async function traiterMessagePrive(message: MessageTg, updateId: number): Promise<void> {
  const u = message.from
  if (!u?.id || u.is_bot) return
  const chat = message.chat.id
  if (!(await nouveauPrive(u.id, updateId))) return

  const texte = (message.text ?? '').trim()
  if (!texte) {
    await envoyer(chat, `Je ne lis que les messages écrits. Écris-moi, ou utilise les boutons :`, clavierMenu())
    return
  }

  // /start <param> (deep link), /start, /menu. « @nom_du_bot » est tolere.
  const commande = /^\/(start|menu)(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(texte)
  if (commande) {
    const param = commande[2]
    if (commande[1].toLowerCase() === 'start' && param) {
      await traiterStartJeton(chat, u, param, updateId)
      return
    }
    // Une demande laissee en attente (droit inconnu a l'epoque) est reprise
    // ici : c'est ce que le message d'attente demande de faire.
    if (await reprendreDemandeEnAttente(u, updateId)) {
      await envoyer(chat, TEXTE_DEMANDE_ACCEPTEE, clavierMenu())
      return
    }
    const start = commande[1].toLowerCase() === 'start'
    const entete = start ? texteAccueil(u.first_name) : undefined
    const r = await rattachementOuNull(u.id)
    // Payeur rattache avec le droit, mais hors du groupe : le lien de retour
    // avec le menu, au lieu du seul menu.
    if (r && r !== 'illisible' && await proposerRetourAuGroupe(chat, u, updateId, {
      declencheur: start ? 'start' : 'menu', entete, boutons: clavierMenu(), reprendre: false,
    })) return
    await envoyerMenu(chat, u.id, entete, r)
    return
  }

  await traiterTexteLibre(chat, u, texte.slice(0, 2000), updateId)
}

// ---------------------------------------------------------------------------
// (8) Boutons
// ---------------------------------------------------------------------------

async function proposer(chat: number, telegramId: number, prep: Awaited<ReturnType<typeof preparerAction>>): Promise<void> {
  if (!prep.ok) {
    await envoyer(chat, prep.raison)
    return
  }
  let nonce: string
  try {
    nonce = await poserActionEnAttente(telegramId, prep.action)
  } catch (err) {
    console.warn(`[liveclub/bot] action non posee : ${messageErreur(err)}`)
    await envoyer(chat, TEXTE_PANNE)
    return
  }
  await envoyer(chat, prep.resume, clavierConfirmation(nonce))
}

/** Un clic sur un bouton. Toujours answerCallbackQuery, quoi qu'il arrive. */
export async function traiterBouton(bouton: BoutonTg, updateId: number): Promise<void> {
  const u = bouton.from
  const message = bouton.message
  if (!u?.id || u.is_bot || !message || message.chat.type !== 'private') {
    await repondreBouton(bouton.id)
    return
  }
  const chat = message.chat.id
  if (!(await nouveauPrive(u.id, updateId))) {
    await repondreBouton(bouton.id)
    return
  }
  const data = bouton.data ?? ''

  const r = await rattachementOuNull(u.id)
  const identite = r && r !== 'illisible' ? r : null

  // « Contacter l'equipe » : le fil passe en « veut un humain » (decision 5),
  // la reponse de l'equipe arrivera ici par le bot.
  if (data === 'm:equipe') {
    await repondreBouton(bouton.id)
    await versSupport(u.id, identite, 'membre', `[bouton] Contacter l'équipe`)
    await repondeur(chat, u.id, identite)(TEXTE_EQUIPE, undefined, true, TEXTE_EQUIPE_INDISPONIBLE)
    return
  }

  // « J'ai paye : verifier mon email » (decision 4).
  if (data === 'v:email') {
    await repondreBouton(bouton.id)
    if (identite) {
      await envoyer(chat, `Ton compte Telegram est déjà relié à ton abonnement, pas besoin de code. Que veux-tu faire ?`, clavierMenu())
      return
    }
    await envoyer(chat, TEXTE_DEMANDE_EMAIL)
    return
  }

  // Tout le reste demande un compte rattache.
  if (r === 'illisible' || !r) {
    await repondreBouton(bouton.id)
    await envoyer(chat, r ? TEXTE_PANNE : TEXTE_NON_RATTACHE, r ? undefined : clavierSansRattachement())
    return
  }

  // Un bouton du menu, d'un payeur qui a le droit mais n'est pas dans le
  // groupe : d'abord le lien de retour (un par 10 minutes), puis la reponse
  // au bouton. Apres repondreBouton, pour ne pas faire tourner le bouton.
  const retour = () => proposerRetourAuGroupe(chat, u, updateId, { declencheur: 'bouton', reprendre: true })

  if (data === 'm:abo') {
    await repondreBouton(bouton.id)
    await retour()
    const s = await situationDuMembre(u.id)
    await envoyer(chat, s.etat === 'ok' ? s.texte : s.etat === 'non_rattache' ? TEXTE_NON_RATTACHE : TEXTE_PANNE, clavierMenu())
    return
  }
  if (data === 'm:pause') {
    await repondreBouton(bouton.id)
    await retour()
    await envoyer(chat, `Une pause de combien de mois ? Elle démarre à la fin de ta période déjà payée.`, clavierDureesPause())
    return
  }
  const pause = /^p:([1-6])$/.exec(data)
  if (pause) {
    await repondreBouton(bouton.id)
    await proposer(chat, u.id, await preparerAction(u.id, 'pause', Number(pause[1])))
    return
  }
  if (data === 'm:arret' || data === 'm:annuler') {
    await repondreBouton(bouton.id)
    await retour()
    await proposer(chat, u.id, await preparerAction(u.id, data === 'm:arret' ? 'arret' : 'annuler_arret'))
    return
  }

  const confirmation = /^([cx]):([A-Za-z0-9_-]{8,32})$/.exec(data)
  if (confirmation) {
    let issue: Awaited<ReturnType<typeof consommerNonce>>
    try {
      issue = await consommerNonce(u.id, confirmation[2])
    } catch (err) {
      console.warn(`[liveclub/bot] nonce illisible : ${messageErreur(err)}`)
      await repondreBouton(bouton.id, "Souci technique, rien n'a été fait.")
      return
    }
    // Le bouton a servi (ou ne sert plus) : on l'enleve du message.
    await retirerBoutons(chat, message.message_id)
    if (issue.etat === 'inconnu') {
      await repondreBouton(bouton.id, 'Ce bouton ne marche plus.')
      await envoyer(chat, `Ce bouton ne marche plus (déjà utilisé, ou remplacé par une demande plus récente). Rien n'a été fait.`, clavierMenu())
      return
    }
    if (issue.etat === 'expire') {
      await repondreBouton(bouton.id, 'Trop tard, redemande.')
      await envoyer(chat, `Ce bouton a expiré, et rien n'a été fait. Redemande, je te le repropose.`, clavierMenu())
      return
    }
    if (confirmation[1] === 'x') {
      await repondreBouton(bouton.id, 'OK, rien de fait.')
      await envoyer(chat, `OK, je laisse tout comme c'est. Rien n'a changé.`)
      return
    }
    await repondreBouton(bouton.id, "Je m'en occupe.")
    await envoyer(chat, await executerActionMembre(u.id, issue.action, updateId))
    return
  }

  // Bouton inconnu (ancien message) : le menu, precede du lien de retour s'il le faut.
  await repondreBouton(bouton.id)
  await retour()
  await envoyerMenu(chat, u.id, undefined, r)
}
