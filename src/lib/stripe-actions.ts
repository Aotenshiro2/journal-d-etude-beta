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
// Produits = ecriture (couvre les tarifs), Payment Links = ecriture (liens de
// paiement de l'agent, 13/10 : sans elle, le resultat dit quoi demander a
// Adil). Tant que la cle manque, la carte de confirmation le dit au lieu d'un
// bouton Confirmer.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  finPeriodeAbonnement, calculerReprisePause, decouperEmails, normaliserEmail, preparerPoseDePause,
  effacementMetadonneesPause, resumerAbonnement, expurgerLiensInvitation, lireTelegramId,
  dateIso, formaterDateFr, lireParamsExemption, uuidDeActeur, refusReintegration,
  etapeApresExemption, etapeApresReintegration, etapeApresAccesBroker,
  lireParamsLienPaiement, lireParamsMarquageLiveClub, lireTarifStripe, choisirTarif, libelleTarif,
  refusLienLiveClub, corpsLienPaiement, urlLienAvecEmail, phraseLienPaiementCree, phraseProduitCree,
  masquerCleStripe, estRefusDePermission, permissionLienPaiementManquante, type TarifLu,
  lireParamsAbonnementReserve, lireParamsRetraitReserve, NOM_PRODUIT_TARIFS_RESERVES,
} from '@/lib/liveclub/pur'
import { URL_BIENVENUE_LIVECLUB, cleStripeLecture, estProduitLiveClub, nomBot } from '@/lib/liveclub/config'
import { inscrireProduitLiveClub, lireProduitsLiveClub, produitsLiveClub } from '@/lib/liveclub/produits'
import { tracerGeste } from '@/lib/liveclub/support-pont'
import {
  estTypeRepartition, lireParamsRepartition, resumeRepartition, jourParis, moisParis, type TypeRepartition,
} from '@/lib/repartition/pur'

// La regle de la pause vit dans liveclub/pur.ts (testable sans base) ; elle
// est reexportee ici pour les appelants de stripe-actions (29/09).
// expurgerLiensInvitation aussi (30/09), lireTelegramId (08/10).
export { finPeriodeAbonnement, calculerReprisePause, expurgerLiensInvitation, lireTelegramId }

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

/**
 * DELETE Stripe (version epinglee), parametres en query string. Sert a la
 * resiliation d'un abonnement impaye depuis plus de 30 jours (passage
 * quotidien du Live Club, 30/09). Jette si Stripe refuse (cle sans le droit
 * compris : Stripe renvoie alors une erreur de permission).
 */
export async function stripeDelete(
  cle: string,
  chemin: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const q = new URLSearchParams(params).toString()
  const reponse = await fetch(`${API}${chemin}${q ? `?${q}` : ''}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${cle}`, 'Stripe-Version': STRIPE_VERSION },
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
    | 'acces_broker' | 'exemption'
    // Acces payant a un tarif particulier (13/10) : lien de paiement d'un
    // produit, et marquage d'un produit existant comme produit Live Club.
    | 'lien_paiement' | 'marquer_live_club'
    // Tarif RESERVE a une personne (13/10) : tarif a son nom, lien personnel
    // et reservation en une carte ; et son retrait (liveclub/reserves.ts).
    | 'abonnement_reserve' | 'retirer_tarif_reserve'
    // La repartition Brice / Melanie (08/10) : depots, commissions, taux,
    // intervenants, depenses, reglements (repartition/pur.ts et serveur.ts).
    | TypeRepartition
  // 'telegram' pour les actions du groupe Live Club (retrait, reintegration,
  // acces broker, exemption) : pas un compte Stripe, mais la carte de
  // confirmation affiche d'ou vient le pouvoir. 'cockpit' pour la
  // repartition : des lignes dans les tables du cockpit, aucun compte externe
  // (sauf l'acces broker que pose un depot, via acces.ts).
  compte: CompteStripe | 'telegram' | 'cockpit'
  params: Record<string, unknown>
}

/**
 * Les parametres d'une action tels qu'ils peuvent aller dans un log : le
 * nombre d'adresses d'un acces broker (jamais les adresses), une exemption
 * sans sa note, un depot sans l'email ni le client.
 */
export function paramsPourLog(a: ActionAgent): Record<string, unknown> {
  if (a.type === 'acces_broker') return { emails: ((a.params.emails as string[]) ?? []).length }
  if (a.type === 'exemption') {
    return { telegram_id: a.params.telegram_id, motif: a.params.motif, jusquau: a.params.jusquau ?? null }
  }
  if (a.type === 'depot_broker' || a.type === 'commission_affiliation') {
    return { partenaire: a.params.partenaire, montant: a.params.montant ?? null, le: a.params.le }
  }
  if (a.type === 'lien_paiement') {
    return { produit_id: a.params.produit_id, price_id: a.params.price_id ?? null, email: a.params.email ? 'oui' : 'non' }
  }
  // Tarif reserve (13/10) : ni l'email ni le nom de la personne.
  if (a.type === 'abonnement_reserve') {
    return {
      price_id: a.params.price_id ?? null, montant: a.params.montant ?? null, recurrence: a.params.recurrence ?? null,
      telegram: a.params.telegram_id ? 'oui' : 'non',
    }
  }
  if (a.type === 'retirer_tarif_reserve') return { reserve_id: a.params.reserve_id ?? null }
  if (estTypeRepartition(a.type)) {
    return Object.fromEntries(Object.entries(a.params).filter(([k]) => k !== 'note' && k !== 'qui'))
  }
  return a.params
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

// lireTelegramId vit dans liveclub/pur.ts depuis le 08/10 (reexporte en tete).

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
 * retire personne sur une lecture ratee. sauf (06/10) : une exemption a ne
 * pas compter (le passage quotidien juge la fin de celle-la).
 */
export async function exemptionActive(
  telegramId: number,
  sauf: string | null = null,
): Promise<{ motif: string; jusquau: Date | null } | null> {
  try {
    const lignes = await prisma.$queryRaw<{ motif: string; jusquau: Date | null }[]>`
      select motif, jusquau from public.cockpit_liveclub_exemptions
      where telegram_id = ${telegramId}
        and retire_le is null
        and (jusquau is null or jusquau >= current_date)
        and (${sauf}::uuid is null or exemption_id <> ${sauf}::uuid)
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
 * Poser une exemption depuis l'agent du Cockpit (08/10), carte confirmee :
 * meme table et meme regle que le formulaire du cockpit (une seule exemption
 * ouverte par compte Telegram, index partiel). Une exemption deja active =
 * refus, rien ne change (la modifier reste un geste du cockpit). Une
 * exemption ECHUE mais pas encore close par le passage quotidien est close
 * (retire_par = l'auteur), sinon l'index refuserait la nouvelle. pose_par :
 * l'uuid de l'auteur, que la base ne connait pas hors d'une session
 * (default auth.uid() vide). Une course perdue (index) = refus.
 */
export async function poserExemptionServeur(
  p: { telegramId: number; motif: string; jusquau: string | null; note: string | null },
  posePar: string,
): Promise<{ ok: true; exemptionId: string; echueClose: boolean } | { ok: false; refus: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const ouvertes = await tx.$queryRaw<{ exemption_id: string; motif: string; jusquau: Date | null; active: boolean }[]>`
        select exemption_id::text as exemption_id, motif, jusquau,
               (jusquau is null or jusquau >= current_date) as active
        from public.cockpit_liveclub_exemptions
        where telegram_id = ${p.telegramId} and retire_le is null
        for update`
      const active = ouvertes.find(o => o.active)
      if (active) {
        return {
          ok: false as const,
          refus: `u${p.telegramId} a déjà une exemption active (${active.motif}, `
            + `${active.jusquau ? `jusqu'au ${formaterDateFr(dateIso(active.jusquau))}` : 'sans date de fin'}) : rien n'a été changé. `
            + `Pour la modifier, retire-la d'abord dans le cockpit, puis repose-la.`,
        }
      }
      for (const echue of ouvertes) {
        await tx.$executeRaw`
          update public.cockpit_liveclub_exemptions
          set retire_le = now(), retire_par = ${posePar}::uuid
          where exemption_id = ${echue.exemption_id}::uuid and retire_le is null`
      }
      const lignes = await tx.$queryRaw<{ exemption_id: string }[]>`
        insert into public.cockpit_liveclub_exemptions (telegram_id, motif, jusquau, note, pose_par)
        values (${p.telegramId}, ${p.motif}, ${p.jusquau}::date, ${p.note}, ${posePar}::uuid)
        returning exemption_id::text as exemption_id`
      return { ok: true as const, exemptionId: lignes[0].exemption_id, echueClose: ouvertes.length > 0 }
    })
  } catch (err) {
    if (/23505|duplicate key/i.test(err instanceof Error ? err.message : String(err))) {
      return { ok: false, refus: `u${p.telegramId} vient de recevoir une autre exemption : rien n'a été changé, relis la liste des exemptions.` }
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
    // (09/10, Michael Penella) Sorti depuis quelques jours, ou jamais venu :
    // Telegram ne le connait plus dans le groupe (« member not found ») et
    // refuse l'unban. Rien a lever : on passe au lien, comme estDansLeGroupe.
    if (!/user not found|participant_id_invalid|member not found/i.test(messageErreur(err))) return {
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
 * perdue (loggue), jamais le geste. 'adresse' (15/10 : une adresse email
 * rattachee sur preuve, liveclub/adresses.ts) demande la migration
 * 20261015120000, meme regle. 'compte_telegram' (15/10 : un abonnement qui
 * passe d'un compte Telegram a un autre, ou un conflit, liveclub/comptes-telegram.ts)
 * demande la migration 20261015230000, meme regle.
 */
export type GesteJournal =
  | 'retrait' | 'reintegration' | 'entree_acceptee' | 'entree_refusee'
  | 'pause' | 'arret' | 'reprise' | 'rappel' | 'refus'
  | 'acces_broker' | 'arret_annule' | 'invitation' | 'fin_acces'
  | 'adresse' | 'compte_telegram'

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
 *
 * Fil Support (Brice, 30/09 : voir les GESTES du bot dans le fil du membre) :
 * une ligne 'fait' ou 'refuse' ecrite pour un compte Telegram ajoute aussi une
 * ligne « [système] » lisible dans son fil (tracerGeste, support-pont.ts, qui
 * ne jette jamais). Pas de fil pour un geste sans telegram_id, ni pour un
 * geste 'simule' ou 'echec' (ils restent dans le journal du bot), ni pour un
 * doublon.
 */
export async function journaliserGesteLiveClub(
  issue: IssueGesteLiveClub | EntreeJournalLiveClub,
  contexte: ContexteJournalLiveClub,
  /** prisma, ou une transaction (scripts/verifier-pont-support.mjs, toujours annulee). */
  db: Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'> = prisma,
): Promise<'ecrit' | 'doublon' | 'echec'> {
  const deIssue = 'ok' in issue
  const geste: GesteJournal = contexte.geste
    ?? (deIssue ? (issue.geste === 'retirer' ? 'retrait' : 'reintegration') : issue.geste)
  const resultat: ResultatGeste = deIssue ? (issue.ok ? 'fait' : issue.resultat) : issue.resultat
  const regle = contexte.regle ?? issue.regle ?? null
  const details = issue.details ?? {}
  try {
    const n = await db.$executeRaw`
      insert into public.cockpit_liveclub_gestes
        (telegram_id, membre_id, abonnement_id, geste, resultat, acteur, regle, update_id, details)
      values (${contexte.telegramId}, ${contexte.membreId ?? null}::uuid, ${contexte.abonnementId ?? null},
              ${geste}, ${resultat}, ${contexte.acteur}, ${regle}, ${contexte.updateId ?? null},
              ${JSON.stringify(details)}::jsonb)
      on conflict (update_id) do nothing`
    if (n === 0) return 'doublon'
    if (contexte.telegramId !== null) {
      await tracerGeste(contexte.telegramId, { geste, resultat, regle, details }, { membreId: contexte.membreId ?? null }, db)
    }
    return 'ecrit'
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

  // La repartition (08/10) : validation stricte dans repartition/pur.ts, au
  // jour et au mois de Paris. Aucun compte Stripe.
  if (estTypeRepartition(a.type)) {
    const maintenant = new Date()
    const lu = lireParamsRepartition(a.type, p, { aujourdhui: jourParis(maintenant), moisCourant: moisParis(maintenant) })
    if (typeof lu === 'string') return lu
    return { type: a.type, compte: 'cockpit', params: lu }
  }

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

  // Exemption (08/10) : un geste de l'equipe, cle = le compte Telegram.
  // jusquau INCLUS, jamais deja passe (jour de la base, en UTC).
  if (a.type === 'exemption') {
    const lu = lireParamsExemption(p, dateIso(new Date()))
    if (typeof lu === 'string') return lu
    return { type: 'exemption', compte: 'telegram', params: lu }
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

  // Marquer un produit EXISTANT comme produit Live Club (13/10) : une ligne
  // de cockpit_liveclub_produits. Compte melanie seulement : c'est le seul que
  // lisent le bot, la page de bienvenue et le passage quotidien.
  if (a.type === 'marquer_live_club') {
    if (a.compte != null && a.compte !== 'melanie') {
      return "Un produit Live Club vit sur le compte melanie : c'est le seul que lisent le bot et la page de bienvenue."
    }
    const lu = lireParamsMarquageLiveClub(p)
    if (typeof lu === 'string') return lu
    return { type: 'marquer_live_club', compte: 'melanie', params: lu }
  }

  // Tarif RESERVE a une personne (13/10) : compte melanie seulement, comme
  // tout le Live Club. Le tarif repris, le montant lu et l'inscription du
  // produit sont remplis par le controle avant la carte (reserves.ts), et
  // tout est relu a l'execution.
  if (a.type === 'abonnement_reserve' || a.type === 'retirer_tarif_reserve') {
    if (a.compte != null && a.compte !== 'melanie') {
      return "Un tarif réservé du Live Club vit sur le compte melanie : c'est le seul que lisent le bot et la page de bienvenue."
    }
    const lu = a.type === 'abonnement_reserve' ? lireParamsAbonnementReserve(p) : lireParamsRetraitReserve(p)
    if (typeof lu === 'string') return lu
    return { type: a.type, compte: 'melanie', params: lu }
  }

  if (!estCompte(a.compte)) return 'Compte inconnu : aoknowledge ou melanie.'

  // Lien de paiement PERSONNEL d'un produit (13/10). Le tarif, le nom et le
  // statut Live Club sont lus chez Stripe avant la carte (controlerActionStripe)
  // et relus a l'execution.
  if (a.type === 'lien_paiement') {
    const lu = lireParamsLienPaiement(p)
    if (typeof lu === 'string') return lu
    if (lu.live_club === true && a.compte !== 'melanie') {
      return "Un lien Live Club se crée sur le compte melanie : c'est le seul que lisent la page de bienvenue et le bot."
    }
    return { type: 'lien_paiement', compte: a.compte, params: lu }
  }

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
    // live_club (13/10) : le produit est inscrit comme produit Live Club a sa
    // creation. Un abonnement du compte melanie : la page de bienvenue et le
    // bot ne lisent que celui-la, et ne font entrer que sur un abonnement.
    if (p.live_club != null && typeof p.live_club !== 'boolean') return 'live_club : vrai ou faux.'
    const liveClub = p.live_club === true
    if (liveClub && a.compte !== 'melanie') {
      return "Un produit Live Club se crée sur le compte melanie : c'est le seul que lisent le bot et la page de bienvenue."
    }
    if (liveClub && !recurrence) {
      return 'Un produit Live Club est un abonnement : précise recurrence (month ou year). '
        + 'La page de bienvenue ne fait entrer que sur un abonnement.'
    }
    return { type: 'produit', compte: a.compte, params: { nom, montant, devise, recurrence, live_club: liveClub } }
  }

  return 'Type d’action inconnu.'
}

/** Une phrase qui dit ce que l'action va faire, pour la carte de confirmation. */
export function resumeAction(a: ActionAgent): string {
  const p = a.params
  if (estTypeRepartition(a.type)) return resumeRepartition(a.type, p)
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
      + `(celui de Metricgram compris) + lien d'invitation à usage unique (14 jours) à lui transmettre. `
      + `Refusé d'office s'il n'a aucun droit ouvert (abonnement, exemption, accès broker, accès manuel).`
  }
  if (a.type === 'exemption') {
    const fin = p.jusquau
      ? `jusqu'au ${formaterDateFr(String(p.jusquau))} inclus : le bot le sortira le lendemain s'il n'a pas d'autre droit`
      : 'sans date de fin (permanente)'
    return `Exempter ${p.qui} (u${p.telegram_id}) au Live Club, motif ${p.motif}, ${fin}. `
      + `Il entre ensuite tout seul par le bot, sans abonnement. Refusé d'office s'il a déjà une exemption active.`
      + (p.note ? ` Note : ${p.note}` : '')
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
  if (a.type === 'lien_paiement') {
    const tarif = typeof p.montant_centimes === 'number' && typeof p.devise === 'string'
      ? libelleTarif({
        montant: p.montant_centimes, devise: p.devise,
        recurrence: typeof p.recurrence === 'string' ? p.recurrence : null,
        nbIntervalles: typeof p.nb_intervalles === 'number' ? p.nb_intervalles : 1,
      })
      : null
    return `Créer un lien de paiement PERSONNEL pour ${p.qui} (un seul paiement possible) : `
      + `« ${p.produit_nom ?? p.produit_id} »${tarif ? `, ${tarif}` : ''}, compte ${a.compte}`
      + (p.email ? `, email prérempli ${p.email}` : '')
      + (p.live_club === true
        ? '. Après le paiement : la page de bienvenue du Live Club, qui le guide vers le bot, qui le fait entrer tout seul.'
        : '. Après le paiement : la page de confirmation de Stripe.')
  }
  if (a.type === 'abonnement_reserve') {
    const tarif = typeof p.montant_centimes === 'number' && typeof p.devise === 'string'
      ? libelleTarif({
        montant: p.montant_centimes, devise: p.devise,
        recurrence: typeof p.recurrence === 'string' ? p.recurrence : null, nbIntervalles: 1,
      })
      : `${p.montant} € par ${p.recurrence === 'year' ? 'an' : 'mois'}`
    const produit = p.produit_nom ?? p.produit_id
    return `Ouvrir à ${p.qui} (${p.email}${p.telegram_id ? `, compte Telegram u${p.telegram_id}` : ''}) un abonnement Live Club `
      + `à un tarif RÉSERVÉ, ${tarif} : `
      + (p.price_id
        ? `son tarif existant ${p.price_id} (« ${produit} »)`
        : `un tarif créé à son nom sur le produit « ${NOM_PRODUIT_TARIFS_RESERVES} »`)
      + ', puis son lien de paiement personnel (un seul paiement, email prérempli). Ce tarif ne sert qu\'à cette personne, '
      + 'et elle n\'entre dans le groupe qu\'une fois payé. Le bot des membres la reconnaîtra et lui donnera ce même lien.'
      + (p.inscrire_produit === true ? ` Le produit « ${produit} » sera aussi inscrit comme produit Live Club.` : '')
      + (p.note ? ` Note : ${p.note}` : '')
  }
  if (a.type === 'retirer_tarif_reserve') {
    return `Retirer la réservation de ${p.qui} (${p.email}${p.tarif ? `, ${p.tarif}` : ''}, `
      + `${p.payee === true ? 'payée' : 'en attente de paiement'}) : `
      + (p.payee === true
        ? 'son abonnement continue, rien ne change chez Stripe.'
        : 'son lien de paiement est désactivé, et le bot ne le lui donnera plus.')
  }
  if (a.type === 'marquer_live_club') {
    return `Marquer le produit « ${p.produit_nom ?? p.produit_id} » (${p.produit_id}, compte melanie) comme produit Live Club : `
      + 'ses abonnés entreront par le bot, la page de bienvenue les reconnaîtra et la collecte les classera en live-club.'
      + (p.note ? ` Note : ${p.note}` : '')
  }
  return `Créer le produit « ${p.nom} » à ${p.montant} ${String(p.devise).toUpperCase()}${p.recurrence ? `/${p.recurrence === 'month' ? 'mois' : 'an'}` : ' (comptant)'} sur le compte ${a.compte}.`
    + (p.live_club === true ? ' Il ouvrira le Live Club : bot, page de bienvenue et collecte le reconnaîtront.' : '')
}

// ---------------------------------------------------------------------------
// Liens de paiement et produits Live Club (13/10) : le controle AVANT la carte
// lit chez Stripe le produit et le tarif, pour que la carte dise exactement ce
// qui sera cree (nom, montant, retour apres paiement). L'execution relit tout.
// ---------------------------------------------------------------------------

export type ControleCarteStripe =
  | { erreur: string }
  | { action: ActionAgent; complement: string | null; manque: string | null }

/** Les types controles par controlerActionStripe avant la carte. */
export function aControleStripe(type: ActionAgent['type']): boolean {
  return type === 'lien_paiement' || type === 'marquer_live_club'
    || type === 'abonnement_reserve' || type === 'retirer_tarif_reserve'
}

/** La cle qui LIT un compte : celle de l'agent (l'ecriture lit aussi), sinon la cle de lecture de melanie. */
function cleLectureCompte(compte: CompteStripe): string | null {
  return cleAgent(compte) ?? (compte === 'melanie' ? cleStripeLecture() : null)
}

const CLE_MELANIE_ABSENTE = "Aucune clé Stripe du compte melanie sur le projet journal (STRIPE_AGENT_KEY_MELANIE ou STRIPE_READ_KEY_MELANIE) : impossible de lire le produit."

function introuvableStripe(err: unknown, quoi: 'product' | 'price'): boolean {
  return new RegExp(`No such ${quoi}`, 'i').test(err instanceof Error ? err.message : String(err))
}

type PreparationLien = { produitNom: string; tarif: TarifLu; liveClub: boolean }

/**
 * Lit chez Stripe le produit et le tarif d'un lien de paiement, et dit si le
 * produit ouvre le Live Club (liste dynamique). Une chaine = refus d'une regle
 * (produit introuvable ou archive, tarif ambigu, lien Live Club impossible,
 * liste illisible). Jette sur une panne.
 */
async function preparerLien(cle: string, compte: CompteStripe, p: Record<string, unknown>): Promise<PreparationLien | string> {
  const produitId = String(p.produit_id)
  let produit: Record<string, unknown>
  try {
    produit = await stripeGet(cle, `/v1/products/${produitId}`)
  } catch (err) {
    if (introuvableStripe(err, 'product')) return `Produit ${produitId} introuvable sur le compte ${compte}.`
    throw err
  }
  const nom = String(produit.name ?? produitId).slice(0, 120)
  if (produit.active !== true) return `Le produit « ${nom} » est archivé : il faut le réactiver au Dashboard Stripe avant d'en faire un lien.`

  const demande = typeof p.price_id === 'string' && p.price_id ? p.price_id : null
  let bruts: unknown[]
  if (demande) {
    try {
      bruts = [await stripeGet(cle, `/v1/prices/${demande}`)]
    } catch (err) {
      if (introuvableStripe(err, 'price')) return `Tarif ${demande} introuvable sur le compte ${compte}.`
      throw err
    }
  } else {
    const liste = await stripeGet(cle, `/v1/prices?${new URLSearchParams({ product: produitId, active: 'true', limit: '20' })}`)
    bruts = (liste.data as unknown[] | undefined) ?? []
  }
  const tarif = choisirTarif(
    bruts.map(lireTarifStripe).filter((t): t is TarifLu => t !== null), produitId, demande,
  )
  if (typeof tarif === 'string') return tarif

  const liste = await lireProduitsLiveClub()
  const liveClub = estProduitLiveClub(produitId, liste.produits)
  if (!liveClub && !liste.complete) {
    return 'La liste des produits Live Club est illisible pour le moment : réessaie dans une minute.'
  }
  if (liveClub) {
    const refus = refusLienLiveClub(compte, tarif)
    if (refus) return refus
  }
  return { produitNom: nom, tarif, liveClub }
}

/**
 * Controle avant la carte d'un lien de paiement ou d'un marquage Live Club.
 * `erreur` retourne au modele (il corrige ou pose la question) ; sinon la
 * carte part avec les champs lus chez Stripe et, au besoin, un avertissement.
 */
export async function controlerActionStripe(a: ActionAgent): Promise<ControleCarteStripe> {
  try {
    // Tarif reserve (13/10) : la place en base, le tarif repris chez Stripe.
    // Import dynamique : reserves.ts importe ce fichier.
    if (a.type === 'abonnement_reserve' || a.type === 'retirer_tarif_reserve') {
      const { controlerActionTarifReserve } = await import('@/lib/liveclub/reserves')
      return await controlerActionTarifReserve(a)
    }

    if (a.type === 'lien_paiement') {
      const compte = a.compte as CompteStripe
      const cle = cleLectureCompte(compte)
      // Sans cle, la carte part sans bouton : ceQuiManque (agent-cockpit.ts) le dit.
      if (!cle) return { action: a, complement: null, manque: null }
      const prep = await preparerLien(cle, compte, a.params)
      if (typeof prep === 'string') return { erreur: prep }
      const action: ActionAgent = {
        ...a,
        params: {
          ...a.params,
          price_id: prep.tarif.id, produit_nom: prep.produitNom, montant_centimes: prep.tarif.montant,
          devise: prep.tarif.devise, recurrence: prep.tarif.recurrence, nb_intervalles: prep.tarif.nbIntervalles,
          live_club: prep.liveClub,
        },
      }
      // Le compte de Melanie ne vend que le Live Club : un produit de ce
      // compte qui ne l'ouvre pas est tres probablement un oubli.
      const complement = !prep.liveClub && compte === 'melanie'
        ? "ATTENTION : ce produit n'ouvre PAS le Live Club (il n'est pas inscrit comme produit Live Club) : "
          + "la personne paierait sans entrer. Pour un accès Live Club, il faut d'abord le marquer (proposer_marquer_live_club)."
        : null
      return { action, complement, manque: null }
    }

    if (a.type === 'marquer_live_club') {
      const cle = cleLectureCompte('melanie')
      if (!cle) return { erreur: CLE_MELANIE_ABSENTE }
      const produitId = String(a.params.produit_id)
      let produit: Record<string, unknown>
      try {
        produit = await stripeGet(cle, `/v1/products/${produitId}`)
      } catch (err) {
        if (introuvableStripe(err, 'product')) {
          return { erreur: `Produit ${produitId} introuvable sur le compte melanie (un produit du compte aoknowledge ne peut pas ouvrir le Live Club).` }
        }
        throw err
      }
      const nom = String(produit.name ?? produitId).slice(0, 120)
      if (estProduitLiveClub(produitId, (await lireProduitsLiveClub()).produits)) {
        return { erreur: `« ${nom} » (${produitId}) ouvre déjà le Live Club : rien à marquer. Pour faire payer quelqu'un, propose proposer_lien_paiement.` }
      }
      const prix = await stripeGet(cle, `/v1/prices?${new URLSearchParams({ product: produitId, active: 'true', limit: '20' })}`)
      const recurrents = ((prix.data as unknown[] | undefined) ?? [])
        .map(lireTarifStripe)
        .filter((t): t is TarifLu => t !== null && t.actif && t.recurrence !== null)
      const avertissements = [
        produit.active !== true ? 'ATTENTION : ce produit est archivé chez Stripe.' : null,
        recurrents.length === 0
          ? "ATTENTION : il n'a aucun tarif récurrent actif, et la page de bienvenue ne fait entrer que sur un abonnement."
          : null,
      ].filter(Boolean)
      return {
        action: { ...a, params: { ...a.params, produit_nom: nom } },
        complement: avertissements.length ? avertissements.join(' ') : null,
        manque: null,
      }
    }

    return { action: a, complement: null, manque: null }
  } catch (err) {
    const message = masquerCleStripe(messageErreur(err))
    if (estRefusDePermission(message)) {
      return { erreur: `Stripe refuse cette lecture à la clé du compte (${message}). Aucune carte : dis-le, la permission « Products » en lecture manque à la clé.` }
    }
    return { erreur: `Lecture Stripe impossible avant la carte (${message}) : réessaie dans un instant.` }
  }
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

// expurgerLiensInvitation vit dans liveclub/pur.ts depuis le 30/09 (le pont
// Support l'utilise, et ce fichier appelle le pont : pas d'import en boucle).
// Il est reexporte en tete de fichier pour les appelants d'avant.

/**
 * Execute une action DEJA validee. Renvoie une phrase de resultat, jette
 * RefusAction si une regle a bloque le geste, Error sur une panne.
 * `acteur` signe la ligne de cockpit_liveclub_gestes pour les gestes Telegram
 * (agent:<uuid> depuis les deux canaux de l'agent).
 */
export async function executerAction(a: ActionAgent, acteur = 'agent'): Promise<string> {
  // ── Repartition Brice / Melanie (08/10) ───────────────────────────────────
  // Depots, commissions, taux, intervenants, depenses, reglements. Import
  // dynamique : repartition/serveur.ts importe ce fichier (RefusAction).
  if (estTypeRepartition(a.type)) {
    const { executerActionRepartition } = await import('@/lib/repartition/serveur')
    return executerActionRepartition(a, acteur)
  }

  // ── Groupe Telegram ───────────────────────────────────────────────────────
  // Memes fonctions que le bouton du cockpit : memes refus (admin, exempte),
  // meme journal. Le lien d'invitation revient a l'humain dans la phrase de
  // resultat, jamais dans le journal.
  if (a.type === 'retirer_telegram' || a.type === 'reintegrer_telegram') {
    const id = Number(a.params.telegram_id)
    const qui = String(a.params.qui)

    // (08/10, Brice) La reintegration ne sert qu'a quelqu'un qui A un droit
    // et reste bloque : sans droit, rien ne compterait sa duree et rien ne le
    // sortirait a la fin. Droit lu en direct (droitLiveClub, abonnement Stripe
    // compris) ; 'inconnu' = rien n'est tente. Import dynamique : droits.ts
    // importe ce fichier (exemptionActive). Le refus est journalise comme les
    // autres tentatives.
    if (a.type === 'reintegrer_telegram') {
      const { droitLiveClub } = await import('@/lib/liveclub/droits')
      const refus = refusReintegration(await droitLiveClub(id), qui, nomBot())
      if (refus) {
        await journaliserGesteLiveClub(
          { geste: 'reintegration', resultat: refus.genre === 'refus' ? 'refuse' : 'echec', regle: refus.regle, details: {} },
          { telegramId: id, acteur },
        )
        if (refus.genre === 'refus') throw new RefusAction(refus.message)
        throw new Error(refus.message)
      }
    }

    const issue = a.type === 'retirer_telegram'
      ? await retirerDuLiveClub(id)
      : await reintegrerAuLiveClub(id)
    await journaliserGesteLiveClub(issue, { telegramId: id, acteur })

    if (!issue.ok) {
      // Refus (exempte, admin, deja dehors) : rien n'a ete fait, ce n'est pas
      // une panne. Erreur a part, pour que les canaux de l'agent ne l'affichent
      // ni comme un succes ni comme un echec.
      if (issue.resultat === 'refuse') throw new RefusAction(`${qui} : ${issue.erreur}`)
      throw new Error(issue.erreur)
    }
    // La derniere ligne dit l'etape humaine suivante (08/10).
    return issue.invite_link
      ? `${qui} : ban levé s'il y en avait un, lien à usage unique valable 14 jours.\n`
        + etapeApresReintegration(qui, issue.invite_link)
      : `${qui} : ${issue.message} La table cockpit_telegram_membres l'enregistrera au prochain événement.`
  }

  // ── Exemption (08/10) ─────────────────────────────────────────────────────
  // Le geste de l'equipe (fondateur, admin, equipe, favorise), cle = le compte
  // Telegram. Rien n'est fait sur le groupe : la personne entre seule par le
  // bot, qui lit l'exemption (droitLiveClub). Pas de ligne au journal du bot :
  // la ligne d'exemption porte deja qui l'a posee et quand.
  if (a.type === 'exemption') {
    const posePar = uuidDeActeur(acteur)
    if (!posePar) throw new Error("Auteur de l'action illisible : l'exemption n'a pas été posée.")
    const qui = String(a.params.qui)
    const id = Number(a.params.telegram_id)
    const jusquau = typeof a.params.jusquau === 'string' ? a.params.jusquau : null
    const issue = await poserExemptionServeur({
      telegramId: id, motif: String(a.params.motif), jusquau,
      note: typeof a.params.note === 'string' ? a.params.note : null,
    }, posePar)
    if (!issue.ok) throw new RefusAction(`${qui} : ${issue.refus}`)
    const fin = jusquau
      ? `jusqu'au ${formaterDateFr(jusquau)} inclus (le bot le sortira le lendemain s'il n'a pas d'autre droit)`
      : 'sans date de fin'
    return `${qui} (u${id}) est exempté au Live Club (${a.params.motif}), ${fin}.`
      + (issue.echueClose ? ' Son ancienne exemption, échue, est close.' : '')
      + `\n${etapeApresExemption(qui, nomBot())}`
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
    // La derniere ligne dit l'etape humaine suivante (08/10).
    return `Accès broker : ${accordes} accordé${accordes > 1 ? 's' : ''} sur ${resultats.length}.`
      + (detail.length ? `\n${detail.join('\n')}` : ' Tous les emails sont partis.')
      + `\n${etapeApresAccesBroker(resultats, nomBot())}`
  }

  // ── Produit existant -> produit Live Club (13/10) ─────────────────────────
  // Une ligne de cockpit_liveclub_produits, apres relecture du produit chez
  // Stripe (compte melanie). Aucune ecriture chez Stripe : la cle de lecture
  // suffit.
  if (a.type === 'marquer_live_club') {
    const cleLu = cleLectureCompte('melanie')
    if (!cleLu) throw new Error(`${CLE_MELANIE_ABSENTE} Rien n'a été marqué.`)
    const produitId = String(a.params.produit_id)
    let produit: Record<string, unknown>
    try {
      produit = await stripeGet(cleLu, `/v1/products/${produitId}`)
    } catch (err) {
      if (introuvableStripe(err, 'product')) throw new RefusAction(`Produit ${produitId} introuvable sur le compte melanie : rien n'a été marqué.`)
      throw err
    }
    const nom = String(produit.name ?? produitId).slice(0, 120)
    const issue = await inscrireProduitLiveClub({
      produitId, nom, posePar: acteur, note: typeof a.params.note === 'string' ? a.params.note : null,
    })
    if (!issue.ok) throw new Error(`${issue.message} Rien n'a été marqué.`)
    const suite = `Étape suivante : pour faire payer quelqu'un à ce tarif, demande-moi son lien de paiement (produit ${produitId}).`
    return issue.deja
      ? `« ${nom} » (${produitId}) ouvrait déjà le Live Club : rien n'a changé.\n${suite}`
      : `« ${nom} » (${produitId}) ouvre maintenant le Live Club : ses abonnés entrent par le bot, la page de bienvenue `
        + `les reconnaît (sous une minute) et la collecte les classe en live-club.\n${suite}`
  }

  // ── Tarif reserve a une personne (13/10) ──────────────────────────────────
  // Tarif a son nom (ou repris), lien personnel et reservation ; ou son
  // retrait. Import dynamique : reserves.ts importe ce fichier.
  if (a.type === 'abonnement_reserve' || a.type === 'retirer_tarif_reserve') {
    const { executerActionTarifReserve } = await import('@/lib/liveclub/reserves')
    return executerActionTarifReserve(a, acteur)
  }

  const cle = cleAgent(a.compte as CompteStripe)
  if (!cle) {
    throw new Error(
      `La clé d'écriture du compte ${a.compte} n'existe pas encore `
      + `(variable ${nomVariableCle(a.compte as CompteStripe)} sur le projet journal).`,
    )
  }
  const p = a.params

  // ── Lien de paiement personnel (13/10) ────────────────────────────────────
  // Produit et tarif RELUS chez Stripe (la carte a pu vieillir), statut Live
  // Club relu dans la liste : s'il a change depuis la carte, rien n'est cree.
  // Un seul paiement possible (restrictions.completed_sessions.limit = 1).
  if (a.type === 'lien_paiement') {
    const compte = a.compte as CompteStripe
    const qui = String(p.qui)
    const prep = await preparerLien(cle, compte, p)
    if (typeof prep === 'string') throw new RefusAction(`${prep} Rien n'a été créé.`)
    if (typeof p.live_club === 'boolean' && p.live_club !== prep.liveClub) {
      throw new RefusAction(`Le produit ${prep.liveClub ? 'ouvre maintenant' : "n'ouvre plus"} le Live Club depuis la carte : `
        + "rien n'a été créé, redemande le lien.")
    }
    let lien: Record<string, unknown>
    try {
      lien = await stripePost(cle, '/v1/payment_links', corpsLienPaiement({
        priceId: prep.tarif.id, liveClub: prep.liveClub, urlBienvenue: URL_BIENVENUE_LIVECLUB, qui,
      }))
    } catch (err) {
      const message = masquerCleStripe(messageErreur(err))
      if (estRefusDePermission(message)) {
        throw new Error(permissionLienPaiementManquante(compte, nomVariableCle(compte), message))
      }
      throw new Error(`Stripe a refusé le lien de paiement (${message}) : rien n'a été créé.`)
    }
    const url = String(lien.url ?? '')
    if (!/^https:\/\/\S+$/.test(url)) throw new Error("Stripe n'a pas rendu l'adresse du lien : vérifie au Dashboard (Liens de paiement) avant de le redemander.")
    const email = typeof p.email === 'string' && p.email ? p.email : null
    return phraseLienPaiementCree({
      qui, produitNom: prep.produitNom, tarif: libelleTarif(prep.tarif), liveClub: prep.liveClub,
      url: urlLienAvecEmail(url, email), emailPrerempli: email !== null,
    })
  }

  if (a.type === 'pause_abonnement' || a.type === 'reprise_abonnement') {
    const abo = String(p.abonnement_id)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)

    // Lu AVANT tout geste, derniere facture comprise : pendant une pause,
    // Stripe fait AVANCER current_period_end sans rien encaisser, donc la
    // seule vraie fin payee est celle notee dans les metadonnees a la pose
    // (pausePayeJusquau de resumerAbonnement, liveclub/pur.ts), dementie si
    // une facture a ete payee apres elle. null = pas un abonnement Live Club
    // (compte aoknowledge) : on ne parle alors que de ce que Stripe dit.
    const sub = await stripeGet(cle, `/v1/subscriptions/${abo}?expand[]=latest_invoice`)
    const resume = resumerAbonnement(sub, await produitsLiveClub())

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
      const payee = resume?.pausePayeJusquau ?? null
      return `Pause levée pour ${p.qui} : les prélèvements reprennent au prochain cycle.`
        + (payee ? ` La période payée avant la pause allait jusqu'au ${fmt(new Date(payee))}.` : '')
        + ` La réintégration Telegram reste un geste séparé (proposer_reintegrer_telegram).`
    }

    // REGLE (Brice, 10/09) : la pause demarre a la date de renouvellement,
    // jamais en milieu de periode payee. pause_collection ne touche que les
    // factures FUTURES : posee maintenant, la periode payee va a son terme,
    // puis behavior=void annule chaque facture jusqu'a resumes_at — calcule
    // ici depuis la vraie fin de periode, jamais depuis une date du modele.
    const statut = String(sub.status ?? '')
    if (!['active', 'trialing', 'past_due'].includes(statut)) {
      throw new Error(`L'abonnement est « ${statut} » : on ne met en pause qu'un abonnement vivant.`)
    }

    // Deja en pause : refus, avec la VRAIE fin payee (metadonnee de pause),
    // jamais la fin de periode Stripe, qui a avance pendant la pause.
    const pause = sub.pause_collection as { resumes_at?: number | null } | null | undefined
    if (pause && (pause.resumes_at == null || pause.resumes_at * 1000 > Date.now())) {
      const payee = resume?.pausePayeJusquau ?? null
      throw new RefusAction(`${p.qui} : une pause est déjà posée sur cet abonnement`
        + (payee ? `, période payée jusqu'au ${fmt(new Date(payee))}` : ', fin payée pas encore datée par le bot')
        + (typeof pause.resumes_at === 'number'
          ? `, reprise des prélèvements le ${fmt(new Date(pause.resumes_at * 1000))}`
          : ', sans date de reprise')
        + `. Rien n'a été changé. Pour la modifier : lever la pause, puis en reposer une.`)
    }

    // MEME refus que pauser() du bot : un arret programme (fin de periode ou
    // date d'arret) se croiserait avec la pause. On n'en pose pas par-dessus.
    if (sub.cancel_at_period_end === true || typeof sub.cancel_at === 'number') {
      const fin = typeof sub.cancel_at === 'number' ? sub.cancel_at : finPeriodeAbonnement(sub)
      throw new RefusAction(`${p.qui} : un arrêt est déjà programmé sur cet abonnement`
        + (fin ? ` (fin le ${fmt(new Date(fin * 1000))})` : '')
        + `. Rien n'a été changé. Pour une pause, il faut d'abord annuler l'arrêt (le membre peut le faire`
        + ` depuis le bot, ou au Dashboard Stripe).`)
    }

    // MEME pose que pauser() du bot (preparerPoseDePause, liveclub/pur.ts) :
    // pause_collection et les metadonnees qui datent le debut de la pause
    // (META_PAUSE_PAYE_JUSQUAU, META_PAUSE_REPRISE), dans le meme appel. Sans
    // elles, le bot du Live Club ne sait pas quand la periode payee se termine
    // et ne sort personne.
    const pose = preparerPoseDePause(sub, Number(p.nb_mois))
    await stripePost(cle, `/v1/subscriptions/${abo}`, pose.corps)

    // Trace au journal du Live Club, comme la pause posee par le bot : c'est
    // la que l'agent relit la vraie fin payee pendant la pause (details
    // paye_jusquau). Regle 'manuel', jamais 'pause_effective' que le passage
    // quotidien suit ; pas de compte Telegram (inconnu ici). Ne jette pas.
    if (resume) {
      await journaliserGesteLiveClub({
        geste: 'pause', resultat: 'fait', regle: 'manuel',
        details: {
          etape: 'pause_programmee', nb_mois: Number(p.nb_mois),
          paye_jusquau: fmt(new Date(pose.finPeriodeSec * 1000)), reprise_le: fmt(pose.reprise),
        },
      }, { telegramId: null, acteur, abonnementId: abo })
    }

    return `Abonnement de ${p.qui} en pause : payé jusqu'au ${fmt(new Date(pose.finPeriodeSec * 1000))}, `
      + `reprise automatique des prélèvements le ${fmt(pose.reprise)}. Visible dans le cockpit après la `
      + `prochaine collecte.`
      + (resume
        ? ` Si son compte Telegram est rattaché, le passage quotidien le sortira du groupe à la fin de la période payée et le préviendra.`
        : '')
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
  // live_club (13/10) : inscrit dans cockpit_liveclub_produits juste apres sa
  // creation, ce qui suffit au bot, a la page de bienvenue, au passage
  // quotidien et a la collecte (push_membres_supabase.py lit la meme table).
  // Une inscription ratee ne fait pas echouer l'action (le produit existe deja
  // chez Stripe) : le resultat le dit et propose le marquage.
  const produit = await stripePost(cle, '/v1/products', { name: String(p.nom) })
  const centimes = Math.round(Number(p.montant) * 100)
  const prix: Record<string, string> = {
    product: String(produit.id),
    unit_amount: String(centimes),
    currency: String(p.devise),
  }
  if (p.recurrence) prix['recurring[interval]'] = String(p.recurrence)
  const tarif = await stripePost(cle, '/v1/prices', prix)
  let inscription: 'faite' | 'deja' | 'table_absente' | 'echec' | null = null
  if (p.live_club === true) {
    const issue = await inscrireProduitLiveClub({
      produitId: String(produit.id), nom: String(p.nom), posePar: acteur, note: "créé par l'agent du cockpit",
    })
    inscription = issue.ok ? (issue.deja ? 'deja' : 'faite') : issue.raison
  }
  return phraseProduitCree({
    nom: String(p.nom), compte: a.compte, produitId: String(produit.id), priceId: String(tarif.id),
    tarif: libelleTarif({
      montant: centimes, devise: String(p.devise),
      recurrence: p.recurrence ? String(p.recurrence) : null, nbIntervalles: 1,
    }),
    inscription,
  })
}
