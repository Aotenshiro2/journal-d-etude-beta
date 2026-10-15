// PLUSIEURS COMPTES TELEGRAM POUR UNE MEME PERSONNE (Brice, 15/10/2026), cote
// serveur. Les regles et les textes sont PURS (comptes-telegram-pur.ts) ; les
// liens en base dans rattacher.ts (changerDeCompte) ; les messages au compte
// qui ecrit et le fil Support dans bot-membre.ts.
//
// Ce module fait :
// - situationChangementCompte : apres le code email d'un compte B, quand un
//   autre compte A tient deja l'abonnement : libre-service, garde-fou atteint
//   ou panne, et le nom des comptes A (Telegram en direct, sinon le registre
//   du groupe ; jamais l'historique des noms, que ni le bot ni l'agent des
//   membres ne lisent) ;
// - executerChangementCompte (« Utiliser ce compte-ci ») : le lien passe a B
//   (garde-fou relu dans la transaction), chaque ancien compte sort du groupe
//   SANS ban s'il n'a pas d'autre droit (retirerDuLiveClub), recoit un message
//   court s'il a demarre le bot, puis le journal et l'alerte (a) ;
// - signalerCompte (« Ce n'est pas moi », garde-fou, panne) : rien ne change,
//   le journal et l'alerte (b), ou « a faire a la main » sur une panne ;
// - alerterEquipeCompte : l'ALERTE IMMEDIATE a Brice et Mel, en prive par
//   Agent AOK (comptes de cockpit_telegram_comptes, comme le resume du matin),
//   ajoutee a l'historique de leur conversation avec l'agent.
//
// Le journal du bot (geste compte_telegram, migration 20261015230000) ne
// garde que des identifiants : comptes Telegram, rattachements. Jamais
// d'email, de nom ni de texte dans un log. Rien ici ne jette.

import { prisma } from '@/lib/db'
import { journaliserGesteLiveClub, retirerDuLiveClub, stripeGet } from '@/lib/stripe-actions'
import { ajouterAHistoriqueAgent, tgCockpit } from '@/lib/agent-cockpit-telegram'
import { ACTEUR_BOT_MEMBRE, clavierEquipe } from './actions-membre'
import { chatId, cleStripeLecture } from './config'
import { droitLiveClub } from './droits'
import { autresComptesDuPayeur, changementsRecents, changerDeCompte, membreParEmail } from './rattacher'
import { payeurDeLAdresse } from './verification'
import { clientsStripeParEmail } from './stripe'
import { appelTelegram, envoyer as envoyerTelegram } from './telegram'
import { tracerMessageBot } from './support-pont'
import { messageErreur } from './pur'
import { identiteTelegram, type UtilisateurTg } from './noms-pur'
import {
  RAISON_CHANGEMENT_COMPTE, decisionChangementCompte, entreesHistoriqueAlerte, texteAlerteCompte, texteAncienCompte,
  type AlerteCompte, type CompteTelegramLu, type DecisionCompte, type PayeurAlerte, type SortieAncien,
} from './comptes-telegram-pur'

/** L'utilisateur Telegram de l'update (champ from). */
export type UtilisateurBot = UtilisateurTg & { id: number }

/** Le code SQLSTATE d'une erreur (« Code: `42703` »), sinon un extrait court. Jamais de valeur. */
function codeErreur(err: unknown): string {
  const m = /Code: `?([0-9A-Z]{5})`?/.exec(err instanceof Error ? err.message : String(err))
  return m ? `sql_${m[1]}` : messageErreur(err).slice(0, 120)
}

// ---------------------------------------------------------------------------
// Les comptes et le payeur, tels qu'on les nomme
// ---------------------------------------------------------------------------

/** Le compte qui ecrit, d'apres le champ from de l'update. */
export function compteDeLUpdate(u: UtilisateurBot): CompteTelegramLu {
  const i = identiteTelegram(u)
  return { telegramId: u.id, pseudo: i?.pseudo ?? null, nom: i?.nomAffiche ?? null }
}

/**
 * Le pseudo et le nom de ces comptes : Telegram en direct (getChatMember dans
 * le groupe, qui rend l'utilisateur meme sorti), sinon le registre du groupe
 * (cockpit_telegram_membres). Cinq comptes au plus. Ne jette pas : un compte
 * illisible garde son seul numero.
 */
export async function lireComptesTelegram(ids: readonly number[]): Promise<CompteTelegramLu[]> {
  const uniques = [...new Set(ids)].filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 5)
  if (uniques.length === 0) return []
  const registre = new Map<number, { pseudo: string | null; nom: string | null }>()
  try {
    const lignes = await prisma.$queryRaw<{ telegram_id: bigint; pseudo: string | null; nom_affiche: string | null }[]>`
      select telegram_id, pseudo, nom_affiche from public.cockpit_telegram_membres
      where telegram_id::text = any(${uniques.map(String)}::text[])`
    for (const l of lignes) registre.set(Number(l.telegram_id), { pseudo: l.pseudo, nom: l.nom_affiche })
  } catch (err) {
    console.warn(`[liveclub/comptes] registre du groupe illisible : ${codeErreur(err)}`)
  }
  const groupe = chatId()
  const sortie: CompteTelegramLu[] = []
  for (const id of uniques) {
    let direct: ReturnType<typeof identiteTelegram> = null
    if (groupe) {
      const r = await appelTelegram('getChatMember', { chat_id: groupe, user_id: id })
      if (r.ok) direct = identiteTelegram((r.result as { user?: UtilisateurTg } | undefined)?.user ?? null)
    }
    const reg = registre.get(id)
    sortie.push({ telegramId: id, pseudo: direct?.pseudo ?? reg?.pseudo ?? null, nom: direct?.nomAffiche ?? reg?.nom ?? null })
  }
  return sortie
}

/** Le nom du payeur pour l'alerte : sa fiche du cockpit, sinon son client Stripe. Ne jette pas. */
async function payeurPourAlerte(email: string, clients: readonly string[]): Promise<PayeurAlerte> {
  let nom: string | null = null
  try {
    const lignes = await prisma.$queryRaw<{ nom: string | null; prenom: string | null }[]>`
      select m.nom, m.prenom from public.cockpit_membre_emails e
      join public.cockpit_membres m on m.membre_id = e.membre_id
      where e.email = ${email} limit 1`
    nom = lignes[0]?.nom || lignes[0]?.prenom || null
  } catch (err) {
    console.warn(`[liveclub/comptes] fiche du payeur illisible : ${codeErreur(err)}`)
  }
  const cle = cleStripeLecture()
  const client = clients.find(c => /^cus_[A-Za-z0-9]+$/.test(c))
  if (!nom && cle && client) {
    try {
      const c = await stripeGet(cle, `/v1/customers/${client}`)
      nom = typeof c.name === 'string' && c.name.trim() ? c.name : null
    } catch (err) {
      console.warn(`[liveclub/comptes] client Stripe illisible : ${messageErreur(err).slice(0, 120)}`)
    }
  }
  return { nom, email }
}

// ---------------------------------------------------------------------------
// L'alerte a Brice et Mel, et le journal du bot
// ---------------------------------------------------------------------------

/**
 * Envoie l'alerte en prive par Agent AOK a chaque compte de
 * cockpit_telegram_comptes, et l'ajoute a l'historique de sa conversation
 * avec l'agent (une question posee juste en dessous s'y rapporte). Renvoie le
 * nombre de destinataires qui l'ont recue. Ne jette pas.
 */
export async function alerterEquipeCompte(alerte: AlerteCompte, id: string): Promise<number> {
  const texte = texteAlerteCompte(alerte)
  let destinataires: { telegram_id: bigint }[]
  try {
    destinataires = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`
  } catch (err) {
    console.warn(`[liveclub/comptes] alerte ${alerte.genre} non envoyee, comptes de l'equipe illisibles : ${codeErreur(err)}`)
    return 0
  }
  let livres = 0
  for (const d of destinataires) {
    const chat = Number(d.telegram_id)
    if (!Number.isSafeInteger(chat) || chat <= 0) continue
    if (!await tgCockpit('sendMessage', { chat_id: chat, text: texte.slice(0, 4000), link_preview_options: { is_disabled: true } })) continue
    livres++
    try {
      await ajouterAHistoriqueAgent(chat, chat, entreesHistoriqueAlerte(texte, id))
    } catch (err) {
      console.warn(`[liveclub/comptes] historique de l'agent non complete : ${codeErreur(err)}`)
    }
  }
  console.log(`[liveclub/comptes] alerte ${alerte.genre} : ${livres}/${destinataires.length} destinataire(s)`)
  return livres
}

type ContexteGeste = { telegramId: number; membreId: string | null; updateId: number | null }

/** Une ligne du journal du bot (geste compte_telegram) : des identifiants seulement. */
async function journaliserCompte(
  resultat: 'fait' | 'refuse' | 'echec',
  regle: string,
  ctx: ContexteGeste,
  details: Record<string, unknown>,
): Promise<void> {
  await journaliserGesteLiveClub(
    { geste: 'compte_telegram', resultat, regle, details },
    { telegramId: ctx.telegramId, membreId: ctx.membreId, acteur: ACTEUR_BOT_MEMBRE, abonnementId: null, updateId: ctx.updateId },
  )
}

async function membreOuNull(email: string): Promise<string | null> {
  try {
    return await membreParEmail(email)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Le parcours
// ---------------------------------------------------------------------------

export type SituationCompte = { decision: DecisionCompte; anciens: CompteTelegramLu[] }

/**
 * Apres le code email du compte B, l'abonnement etant tenu par d'autres
 * comptes (rattacherParEmail 'deja_pris') : la decision (libre-service,
 * garde-fou, panne) et le nom des autres comptes. Ne jette pas.
 */
export async function situationChangementCompte(pris: {
  email: string
  clients: readonly string[]
  autres: readonly { telegramId: number }[]
}): Promise<SituationCompte> {
  let n: number | null
  try {
    n = await changementsRecents(pris.email, pris.clients)
  } catch (err) {
    // 42703 : colonne absente, migration 20261015230000 pas encore appliquee.
    console.warn(`[liveclub/comptes] garde-fou illisible (${codeErreur(err)}) : pas de libre-service`)
    n = null
  }
  const anciens = await lireComptesTelegram(pris.autres.map(a => a.telegramId))
  return { decision: decisionChangementCompte({ autres: pris.autres.length, changementsRecents: n }), anciens }
}

export type IssueSignal = 'pas_moi' | 'garde_30j' | 'panne'

/**
 * Rien ne change : le journal (refus ou panne, dans le fil Support de B) et
 * l'ALERTE a Brice et Mel. Les autres comptes sont relus (ils ont pu changer
 * depuis le choix), sinon ceux du choix. Le fil de B passe en attente d'un
 * humain par l'appelant (bot-membre.ts). Ne jette pas.
 */
export async function signalerCompte(o: {
  u: UtilisateurBot
  email: string
  issue: IssueSignal
  updateId: number | null
  /** Les comptes connus au moment du choix (repli si la base ne repond pas). */
  anciensConnus: readonly number[]
  /** Deja lus par l'appelant : pas de nouvelle lecture. */
  anciens?: readonly CompteTelegramLu[]
  clients?: readonly string[]
}): Promise<void> {
  try {
    let clients = o.clients ? [...o.clients] : null
    if (!clients) {
      try {
        clients = await clientsStripeParEmail(o.email)
      } catch {
        clients = []
      }
    }
    let ids = [...o.anciensConnus]
    let rattachements: string[] = []
    try {
      const autres = await autresComptesDuPayeur(o.u.id, o.email, clients)
      if (autres.length) {
        ids = [...new Set(autres.map(a => Number(a.telegram_id)))]
        rattachements = autres.map(a => a.rattachement_id)
      }
    } catch (err) {
      console.warn(`[liveclub/comptes] autres comptes illisibles : ${codeErreur(err)}`)
    }
    // Les noms deja lus par l'appelant servent s'ils couvrent les memes comptes.
    const connus = new Map((o.anciens ?? []).map(c => [c.telegramId, c]))
    const anciens = ids.length > 0 && ids.every(id => connus.has(id))
      ? ids.map(id => connus.get(id) as CompteTelegramLu)
      : await lireComptesTelegram(ids)
    await journaliserCompte(o.issue === 'panne' ? 'echec' : 'refuse', o.issue,
      { telegramId: o.u.id, membreId: await membreOuNull(o.email), updateId: o.updateId },
      { anciens: ids.map(String), ...(rattachements.length ? { rattachements_anciens: rattachements } : {}) })
    const payeur = await payeurPourAlerte(o.email, clients)
    const nouveau = compteDeLUpdate(o.u)
    const alerte: AlerteCompte = o.issue === 'panne'
      ? { genre: 'panne', payeur, anciens, nouveau }
      : { genre: 'conflit', raison: o.issue, payeur, anciens, nouveau }
    await alerterEquipeCompte(alerte, `compte-${o.issue}-u${o.u.id}-${Date.now()}`)
  } catch (err) {
    console.warn(`[liveclub/comptes] signalement ${o.issue} incomplet pour u${o.u.id} : ${codeErreur(err)}`)
  }
}

/** Le compte a-t-il deja ecrit au bot ? null si la table ne repond pas (on tente alors). */
async function aDemarreLeBot(telegramId: number): Promise<boolean | null> {
  try {
    const lignes = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from public.cockpit_liveclub_conversations where telegram_id = ${telegramId}::bigint limit 1`
    return lignes.length > 0
  } catch {
    return null
  }
}

/**
 * L'ancien compte sort du groupe, SANS ban, s'il n'a pas d'autre droit
 * (exemption, acces broker ou manuel : droitLiveClub, maintenant que son
 * lien est retire). Droit illisible : on ne touche a rien (jamais une sortie
 * sur un « on ne sait pas »). Journalise la sortie (retrait, regle
 * changement_compte) ou son echec.
 */
async function sortirAncienCompte(telegramId: number): Promise<SortieAncien> {
  try {
    const droit = await droitLiveClub(telegramId)
    if (droit.statut === 'oui') return 'autre_droit'
    if (droit.statut === 'inconnu') return 'inconnu'
    const issue = await retirerDuLiveClub(telegramId)
    const contexte = { telegramId, membreId: null, acteur: ACTEUR_BOT_MEMBRE, abonnementId: null }
    if (issue.ok) {
      await journaliserGesteLiveClub(issue, { ...contexte, regle: RAISON_CHANGEMENT_COMPTE })
      return 'sorti'
    }
    if (issue.regle === 'absent_du_groupe') return 'absent'
    if (issue.regle === 'admin_du_groupe') return 'admin'
    if (issue.regle === 'exempte') return 'autre_droit'
    await journaliserGesteLiveClub(issue, contexte)
    return 'echec'
  } catch (err) {
    console.warn(`[liveclub/comptes] sortie de u${telegramId} impossible : ${codeErreur(err)}`)
    return 'echec'
  }
}

/** Le message court a l'ancien compte, s'il a deja demarre le bot (un bot n'ecrit jamais le premier). */
async function prevenirAncienCompte(telegramId: number, sortie: SortieAncien): Promise<void> {
  // Un autre droit (ou admin) : il garde le groupe, rien a lui annoncer.
  if (sortie === 'autre_droit' || sortie === 'admin') return
  if (await aDemarreLeBot(telegramId) === false) return
  const texte = texteAncienCompte(sortie === 'sorti')
  const boutons = clavierEquipe()
  const r = await envoyerTelegram(telegramId, texte, boutons)
  await tracerMessageBot(telegramId, texte, { boutons, livre: r.ok })
}

export type IssueExecution =
  | { etat: 'fait'; anciens: CompteTelegramLu[]; sorties: Record<string, SortieAncien> }
  /** Plus personne d'autre ne tenait l'abonnement : le lien de B est pose, rien d'autre. */
  | { etat: 'sans_autre' }
  | { etat: 'garde'; anciens: CompteTelegramLu[] }
  | { etat: 'panne'; anciens: CompteTelegramLu[] }

/**
 * « Utiliser ce compte-ci » : l'abonnement de cette adresse (prouvee par B)
 * passe sur le compte B. Garde-fou relu dans la transaction (changerDeCompte).
 * Puis, pour chaque ancien compte : sortie du groupe sans ban et message
 * court ; enfin le journal (fait) et l'ALERTE (a). Garde-fou atteint ou
 * panne : rien ne change, signalerCompte. Le lien d'entree de B et les
 * messages a B sont envoyes par l'appelant. Ne jette pas.
 */
export async function executerChangementCompte(o: {
  u: UtilisateurBot
  email: string
  anciensConnus: readonly number[]
  updateId: number | null
}): Promise<IssueExecution> {
  const panne = async (raison: string): Promise<IssueExecution> => {
    console.warn(`[liveclub/comptes] changement de compte impossible pour u${o.u.id} : ${raison}`)
    const anciens = await lireComptesTelegram(o.anciensConnus)
    await signalerCompte({ u: o.u, email: o.email, issue: 'panne', updateId: o.updateId, anciensConnus: o.anciensConnus, anciens })
    return { etat: 'panne', anciens }
  }

  let payeur: { clients: string[]; clientStripe: string | null }
  try {
    payeur = await payeurDeLAdresse(o.email)
  } catch (err) {
    return panne(`stripe (${messageErreur(err).slice(0, 80)})`)
  }

  let issue: Awaited<ReturnType<typeof changerDeCompte>>
  try {
    issue = await changerDeCompte(o.u.id, { email: o.email, clients: payeur.clients, clientStripe: payeur.clientStripe })
  } catch (err) {
    return panne(codeErreur(err))
  }

  const ids = [...new Set(issue.anciens.map(a => Number(a.telegram_id)))]
  if (issue.etat === 'garde') {
    const anciens = await lireComptesTelegram(ids)
    await signalerCompte({ u: o.u, email: o.email, issue: 'garde_30j', updateId: o.updateId, anciensConnus: ids, anciens, clients: payeur.clients })
    return { etat: 'garde', anciens }
  }
  if (ids.length === 0) return { etat: 'sans_autre' }

  // Les noms AVANT la sortie (le registre du groupe et Telegram les ont encore).
  const anciens = await lireComptesTelegram(ids)
  const sorties: Record<string, SortieAncien> = {}
  for (const id of ids) {
    sorties[String(id)] = await sortirAncienCompte(id)
    try {
      await prevenirAncienCompte(id, sorties[String(id)])
    } catch (err) {
      console.warn(`[liveclub/comptes] message a u${id} non envoye : ${codeErreur(err)}`)
    }
  }
  await journaliserCompte('fait', 'libre_service', { telegramId: o.u.id, membreId: issue.membreId, updateId: o.updateId }, {
    anciens: ids.map(String),
    rattachements_anciens: issue.anciens.map(a => a.rattachement_id),
    rattachement_nouveau: issue.rattachementId,
    sorties,
  })
  console.log(`[liveclub/comptes] u${o.u.id} : abonnement repris de ${ids.length} compte(s) en libre-service (${Object.values(sorties).join(',')})`)
  try {
    const payeurAlerte = await payeurPourAlerte(o.email, payeur.clients)
    await alerterEquipeCompte(
      { genre: 'libre_service', payeur: payeurAlerte, anciens, nouveau: compteDeLUpdate(o.u), sorties },
      `compte-libre-service-u${o.u.id}-${Date.now()}`,
    )
  } catch (err) {
    console.warn(`[liveclub/comptes] alerte libre-service non envoyee : ${codeErreur(err)}`)
  }
  return { etat: 'fait', anciens, sorties }
}
