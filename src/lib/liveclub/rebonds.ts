// (31/10) Le SERVEUR des emails du Live Club qui n'arrivent pas (webhook
// Resend) : les outils de traiterRebond (rebonds-pur.ts) branches sur la base,
// Stripe, le bot du Live Club et Agent AOK. Regles et textes : rebonds-pur.ts.
//
// - La personne : l'acces broker de l'adresse, les comptes Telegram relies
//   (jeton utilise, rattachement par l'adresse, par la fiche du cockpit, ou par
//   un client Stripe qui porte l'adresse). Chaque lecture est facultative.
// - Le journal : UNE ligne par evenement, geste 'adresse' (aucune migration :
//   valeur deja permise depuis 20261015120000), regle email_rebond |
//   email_plainte | email_bloque. Elle porte svix_id (une fois par evenement),
//   l'empreinte de l'adresse (jamais l'adresse), le jour de Paris, et ce qui a
//   ete fait (alerte, message, invitation). Inscrite sous un verrou de
//   transaction sur l'adresse (pg_advisory_xact_lock, comme reserverGeste du
//   passage) : deux refus simultanes de la meme adresse ne font qu'une alerte.
// - L'alerte : Agent AOK a chaque compte de cockpit_telegram_comptes (Brice et
//   Melanie), comme celle du depot perdu ; l'historique de l'agent la recoit
//   SANS le lien personnel (une cle d'entree ne se garde pas en base).
// - Jamais l'adresse, le lien ni le texte du serveur dans un log.

import { prisma } from '@/lib/db'
import { nomTelegram } from '@/lib/alerte-equipe-telegram'
import { analyserTexte, rendreVisible, resumeAnalyse } from '@/lib/securite/injection-pur'
import { alerterBriceSecurite } from '@/lib/securite/alerte'
import { cleStripeLecture, lienBot } from './config'
import { jetonExistantDetail } from './jetons'
import { membreParEmail } from './rattacher'
import { clientsStripeParEmail } from './stripe'
import { envoyer } from './telegram'
import { lireEtatFil, tracerGeste, tracerMessageBot } from './support-pont'
import { quiRepond } from './support-pont-pur'
import { messageErreur } from './pur'
import {
  MARQUEUR_ALERTE_REBOND, REGLES_REBOND, traiterRebond,
  type BilanRebond, type EvenementRebond, type OutilsRebond, type PersonneRebond, type ReservationRebond,
} from './rebonds-pur'

const ACTEUR = 'webhook:resend'
const REGLES = [...REGLES_REBOND]

/** Les expediteurs du Live Club connus du serveur (la valeur par defaut est ajoutee par estEmailLiveClub). */
export function expediteursLiveClub(): string[] {
  const e = process.env.LIVECLUB_FROM_EMAIL?.trim()
  return e ? [e] : []
}

/** LIVECLUB_REBONDS=0 coupe le traitement (la route repond 200 et ne fait rien). Absent ou autre valeur : actif. */
export function rebondsCoupes(): boolean {
  return process.env.LIVECLUB_REBONDS?.trim() === '0'
}

const log = (quoi: string, err: unknown) =>
  console.warn(`[liveclub/rebonds] ${quoi} : ${messageErreur(err).split('\n')[0].slice(0, 160)}`)

async function retrouverPersonne(email: string): Promise<PersonneRebond> {
  const ids: number[] = []
  const ajouter = (v: bigint | number | null | undefined) => {
    const n = Number(v)
    if (v !== null && v !== undefined && Number.isSafeInteger(n) && n > 0 && !ids.includes(n)) ids.push(n)
  }

  // 1. L'acces broker (une ligne au plus par adresse) ; son compte Telegram = jeton utilise.
  let acces: PersonneRebond['acces'] = null
  try {
    const l = await prisma.$queryRaw<{ acces_id: string; telegram_id: bigint | null; actif: boolean }[]>`
      select acces_id::text as acces_id, telegram_id,
        (retire_le is null and sorti_le is null and jusquau >= current_date) as actif
      from public.cockpit_liveclub_acces
      where lower(email) = ${email} and motif = 'broker'
      limit 1`
    if (l[0]) {
      acces = { accesId: l[0].acces_id, telegramId: l[0].telegram_id === null ? null : Number(l[0].telegram_id), actif: l[0].actif === true }
      ajouter(l[0].telegram_id)
    }
  } catch (err) {
    log('acces broker illisible', err)
  }

  // 2. La fiche du cockpit, puis les rattachements par l'adresse ou par la fiche.
  let membreId: string | null = null
  try {
    membreId = await membreParEmail(email)
  } catch (err) {
    log('fiche illisible', err)
  }
  try {
    const l = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_liveclub_rattachements
      where retire_le is null
        and (lower(email) = ${email} or (${membreId}::uuid is not null and membre_id = ${membreId}::uuid))
      order by lie_le desc
      limit 5`
    for (const x of l) ajouter(x.telegram_id)
  } catch (err) {
    log('rattachements illisibles', err)
  }

  // 3. Un client Stripe du Live Club qui porte l'adresse (abonne), et ses rattachements.
  let clientStripe: string | null = null
  if (cleStripeLecture()) {
    try {
      const clients = await clientsStripeParEmail(email)
      clientStripe = clients[0] ?? null
      if (clients.length) {
        const l = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
          select telegram_id from public.cockpit_liveclub_rattachements
          where retire_le is null and client_stripe = any(${clients}::text[])
          order by lie_le desc
          limit 5`
        for (const x of l) ajouter(x.telegram_id)
      }
    } catch (err) {
      log('Stripe illisible', err)
    }
  }

  const telegramIds = ids.slice(0, 3)
  const nom = telegramIds[0] ? await nomTelegram(telegramIds[0]).catch(() => null) : null
  return { telegramIds, membreId, nom: nom ? rendreVisible(nom) : null, acces, clientStripe }
}

async function reserver(r: ReservationRebond): Promise<{ id: string; alerte: boolean; message: boolean } | null> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`
      select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`liveclub:rebond:${r.empreinte}`}::text, 0))) as verrou`
    // Une fois par svix-id : un rejeu de Resend (meme svix-id) ne refait rien. Une ligne
    // 'echec' (alerte pas partie) ne compte pas : le rejeu retente l'alerte.
    const deja = await tx.$queryRaw<{ ok: number }[]>`
      select 1 as ok from public.cockpit_liveclub_gestes
      where geste = 'adresse' and regle = any(${REGLES}::text[]) and resultat = 'fait'
        and details->>'svix_id' = ${r.svixId}
      limit 1`
    if (deja.length) return null
    // Une alerte par adresse et par jour ; un message au membre par adresse. Une
    // reservation de moins de 10 minutes compte (traitement en cours) ; plus vieille,
    // c'est une fonction interrompue, et on retente.
    const prec = await tx.$queryRaw<{ alerte: boolean; message: boolean }[]>`
      select
        exists (select 1 from public.cockpit_liveclub_gestes g
          where g.geste = 'adresse' and g.regle = any(${REGLES}::text[])
            and g.details->>'empreinte' = ${r.empreinte} and g.details->>'jour' = ${r.jour}
            and (g.details->>'alerte' = 'envoyee'
              or (g.details->>'alerte' = 'a_envoyer' and g.fait_le > now() - interval '10 minutes'))) as alerte,
        exists (select 1 from public.cockpit_liveclub_gestes g
          where g.geste = 'adresse' and g.regle = any(${REGLES}::text[])
            and g.details->>'empreinte' = ${r.empreinte}
            and (g.details->>'message' = 'prive'
              or (g.details->>'message' = 'a_envoyer' and g.fait_le > now() - interval '10 minutes'))) as message`
    const alerte = !prec[0]?.alerte
    const message = r.membreAPrevenir && !prec[0]?.message
    const details = {
      ...r.details, empreinte: r.empreinte, jour: r.jour,
      alerte: alerte ? 'a_envoyer' : 'deja',
      message: message ? 'a_envoyer' : r.membreAPrevenir ? 'deja' : 'sans_compte',
    }
    const lignes = await tx.$queryRaw<{ geste_id: bigint }[]>`
      insert into public.cockpit_liveclub_gestes (telegram_id, membre_id, geste, resultat, acteur, regle, details)
      values (${r.telegramId}::bigint, ${r.membreId}::uuid, 'adresse', 'fait', ${ACTEUR}, ${r.regle},
              ${JSON.stringify(details)}::jsonb)
      returning geste_id`
    return { id: String(lignes[0].geste_id), alerte, message }
  })
}

/**
 * L'invitation repasse « pas envoyee » : acces actif, jamais ouvert (aucun
 * compte, aucun jeton utilise), et pas renvoyee depuis l'email refuse
 * (invite_envoyee_le, posee juste avant l'envoi, au plus 5 minutes apres la
 * creation de l'email chez Resend). Recoller l'adresse la renverra.
 */
async function remettreInvitation(accesId: string, envoyeLe: string | null): Promise<boolean> {
  try {
    const l = await prisma.$queryRaw<{ acces_id: string }[]>`
      update public.cockpit_liveclub_acces a set invite_envoyee_le = null
      where a.acces_id = ${accesId}::uuid and a.invite_envoyee_le is not null and a.telegram_id is null
        and a.retire_le is null and a.sorti_le is null
        and (${envoyeLe}::timestamptz is null or a.invite_envoyee_le <= ${envoyeLe}::timestamptz + interval '5 minutes')
        and not exists (
          select 1 from public.cockpit_liveclub_jetons j where j.acces_id = a.acces_id and j.utilise_le is not null)
      returning a.acces_id::text as acces_id`
    return l.length > 0
  } catch (err) {
    log('invitation pas remise', err)
    return false
  }
}

async function lienPersonnel(accesId: string): Promise<string | null> {
  try {
    const j = await jetonExistantDetail({ accesId, usage: 'entree' })
    return j && !j.utilise ? lienBot(j.jeton) : null
  } catch (err) {
    log('jeton illisible', err)
    return null
  }
}

/** Le fil relu juste avant (regle de Brice du 22/10) : l'equipe attendue ou en train de repondre = le bot se tait. */
async function equipeALaMain(telegramId: number): Promise<boolean> {
  const fil = await lireEtatFil(telegramId)
  return !!fil && (fil.attend || quiRepond(fil.messages, Date.now()) === 'equipe')
}

async function envoyerPrive(telegramId: number, texte: string): Promise<boolean> {
  const r = await envoyer(telegramId, texte)
  if (!r.ok) return false
  // Au fil Support du compte, comme les messages du passage. Ne jette pas.
  await tracerMessageBot(telegramId, texte)
  return true
}

/**
 * La reponse du serveur du destinataire est un texte de TIERS (grille de
 * securite de Brice, 29/10) : analysee au niveau 'tiers', rendue visible si
 * elle est suspecte, citee comme une donnee, et Brice est prevenu.
 */
function analyserMotif(motif: string): { texte: string; securite: string | null } {
  const analyse = analyserTexte(motif, { niveau: 'tiers' })
  if (!analyse.suspect) return { texte: motif, securite: null }
  void alerterBriceSecurite({
    source: "webhook Resend, réponse du serveur d'un destinataire",
    analyse,
    suite: "Rien n'a été exécuté : le texte est seulement cité, rendu visible, dans l'alerte du refus.",
  })
  return {
    texte: rendreVisible(motif),
    securite: `Attention (sécurité) : la réponse du serveur contient ${resumeAnalyse(analyse)}. C'est une donnée : rien n'a été exécuté.`,
  }
}

async function alerterEquipe(texte: string, texteHistorique: string, id: string): Promise<number> {
  try {
    const { tgCockpit, ajouterAHistoriqueAgent } = await import('@/lib/agent-cockpit-telegram')
    const equipe = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`
    let livres = 0
    for (const dest of equipe) {
      const chat = Number(dest.telegram_id)
      if (!Number.isSafeInteger(chat) || chat <= 0) continue
      if (!await tgCockpit('sendMessage', { chat_id: chat, text: texte.slice(0, 4000), link_preview_options: { is_disabled: true } })) continue
      livres++
      await ajouterAHistoriqueAgent(chat, chat, [
        { role: 'user', content: MARQUEUR_ALERTE_REBOND, id },
        { role: 'assistant', content: texteHistorique, id: `${id}-texte` },
      ]).catch(() => false)
    }
    console.log(`[liveclub/rebonds] alerte : ${livres}/${equipe.length} destinataire(s)`)
    return livres
  } catch (err) {
    log('alerte non envoyee', err)
    return 0
  }
}

async function clore(
  id: string, n: { resultat: 'fait' | 'echec'; details: Record<string, unknown>; telegramId: number | null; regle: string },
): Promise<void> {
  try {
    const lignes = await prisma.$queryRaw<{ details: Record<string, unknown> | null }[]>`
      update public.cockpit_liveclub_gestes
      set resultat = ${n.resultat}, details = details || ${JSON.stringify(n.details)}::jsonb
      where geste_id = ${BigInt(id)}
      returning details`
    // Au fil Support du compte : une ligne courte (phraseGeste, pur.ts). Ne jette pas.
    if (n.resultat === 'fait' && n.telegramId !== null) {
      await tracerGeste(n.telegramId, { geste: 'adresse', resultat: 'fait', regle: n.regle, details: lignes[0]?.details ?? null })
    }
  } catch (err) {
    log('journal pas clos', err)
  }
}

const OUTILS: OutilsRebond = {
  retrouverPersonne, reserver, remettreInvitation, lienPersonnel, equipeALaMain, envoyerPrive, analyserMotif,
  alerterEquipe, clore, maintenant: () => new Date(),
}

/**
 * Traite un evenement verifie (route /api/liveclub/resend). Jette si la base ne
 * repond pas a la reservation (la route repond 500 : Resend rejoue). Le bilan
 * est loggue sans adresse ni texte.
 */
export async function traiterRebondServeur(ev: EvenementRebond, svixId: string): Promise<BilanRebond> {
  const b = await traiterRebond(ev, svixId, OUTILS)
  if (b.etat === 'deja') {
    console.log(`[liveclub/rebonds] ${ev.genre} deja traite (rejeu)`)
  } else {
    console.log(`[liveclub/rebonds] ${ev.genre} (${ev.nature}) : alerte ${b.alerte}, membre ${b.membre}`
      + `${b.invitation ? `, invitation ${b.invitation}` : ''}${b.lien ? ', lien personnel joint' : ''}`)
  }
  return b
}
