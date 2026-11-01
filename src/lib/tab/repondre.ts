// L'API DE TAB : PREPARER UNE REPONSE A UN MEMBRE (01/11/2026), le serveur.
// Regles, textes et constantes : repondre-pur.ts. Table :
// cockpit_tab_propositions (migration 20261101120000, ECRITE, A APPLIQUER :
// sans elle, la route repond 503 et rien ne part).
//
// Decision de Brice du 01/11 (« ok pour la B ») : Tab ou Tache PREPARENT, Brice
// ou Melanie ENVOIENT d'un clic dans Agent AOK. Trois portes :
//
// 1. proposerReponseTab (POST /support/<fil_id>/repondre, cle 'tab' ou
//    'tache') : controles purs (texte, securite, liens), fil relu en lecture
//    seule (bot du Live Club, membre qui a ecrit depuis moins de 30 jours),
//    cadence, puis la proposition est ENREGISTREE et une carte « Envoyer /
//    Annuler » part a chaque compte de l'equipe (cockpit_telegram_comptes :
//    Brice et Melanie) par le bot Agent AOK. RIEN ne part au membre. Un texte
//    suspect est refuse et Brice est alerte (alerterBriceSecurite). Une
//    proposition plus recente pour le meme fil remplace l'ancienne (ses cartes
//    perdent leurs boutons).
// 2. traiterBoutonPropositionTab (clic dans Agent AOK, appele par
//    agent-cockpit-telegram.ts APRES le verrou du compte de l'equipe) : la
//    ligne est verrouillee, le PREMIER clic l'emporte, le second recoit « déjà
//    traité par X ». Envoyer = controles refaits, fil relu, refus si l'equipe
//    a repondu depuis la proposition, puis l'envoi de l'onglet Support
//    (repondreAuFil, support-reponse.ts : meme livraison Telegram, meme
//    en-tete « Réponse de l'équipe AOK : », meme role human, meme sortie de
//    l'attente), une ligne « [système] » dans le fil (« via Tab », qui a
//    valide) et une ligne au journal d'acces de l'API au nom de la cle qui a
//    prepare. Annuler = rien ne part, trace au journal. Expiree (48 h) = rien
//    ne part. Jamais d'envoi sans clic, jamais de rejeu automatique.
// 3. listerPropositions (GET /support/propositions[/<id>]) et
//    dernieresPropositions (GET /support) : ou en est chaque proposition.
//
// Jamais le texte d'un message, un nom ni un email dans un log. Aucune cle ni
// jeton affiche.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { journaliser } from '@/lib/tab/acces'
import { porteeApi, type PorteeApi } from '@/lib/tab/pur'
import { alerterBriceSecurite } from '@/lib/securite/alerte'
import { nomBot } from '@/lib/liveclub/config'
import { texteReponseEquipe } from '@/lib/liveclub/support-pont-pur'
import { referenceFil } from '@/lib/alerte-equipe-telegram-pur'
import { libelleDestinataire, phraseIssueReponse } from '@/lib/reponse-membre-pur'
import type { ClicAgentTelegram, CompteCockpitTelegram } from '@/lib/agent-cockpit-telegram'
import {
  STATUTS_PROPOSITION,
  carteDecidee, clavierProposition, controlerTexteReponse, decisionClic, dernierMessageEquipe, expirationProposition, finDeCarte,
  heureParis, lireDemandeReponse, lireIdFil, ligneFilEnvoi, nomAuteur, nomCourt, nomEquipe, refusCadence, refusEquipePlusRapide,
  statutEffectif, statutPropositionEnClair, texteCarte, texteDejaTraite, verdictFil,
  type AuteurProposition, type DecisionClic, type FilLu, type VerbeProposition,
} from '@/lib/tab/repondre-pur'

type Tx = Prisma.TransactionClient

/** Ce que la route rend : statut HTTP, corps, lignes pour le journal, erreur pour le journal. */
export type SortieApi = { status: number; corps: Record<string, unknown>; lignes: number | null; erreur?: string }

const API_TG = 'https://api.telegram.org'
const MIGRATION = '20261101120000_cockpit_tab_propositions'

function premiereLigne(err: unknown): string {
  const brut = err instanceof Error ? err.message : String(err)
  return (brut.split('\n').filter(Boolean).pop() ?? '').slice(0, 200)
}

function tableAbsente(err: unknown): boolean {
  return /42P01|cockpit_tab_propositions.*(does not exist|n'existe pas)|relation .*cockpit_tab_propositions/i.test(err instanceof Error ? err.message : String(err))
}

function refus(status: number, erreur: string, detail?: string): SortieApi {
  return { status, corps: { ok: false, erreur }, lignes: null, erreur: (detail ?? erreur).slice(0, 300) }
}

const TABLE_ABSENTE: SortieApi = refus(
  503,
  `Cette route n'est pas encore en place (migration ${MIGRATION} à appliquer) : rien n'est proposé ni envoyé.`,
  'table cockpit_tab_propositions absente',
)

/** Lecture seule, delai borne : meme une erreur de ce code ne peut rien ecrire. */
async function enLectureSeule<T>(f: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('set transaction read only')
    await tx.$executeRawUnsafe(`set local statement_timeout = '8000ms'`)
    return f(tx)
  }, { maxWait: 5000, timeout: 20000 })
}

/**
 * Un appel au bot Agent AOK (TELEGRAM_BOT_TOKEN_COCKPIT) qui rend le resultat
 * de Telegram (message_id d'une carte), ou null. Meme jeton que tgCockpit
 * (agent-cockpit-telegram.ts), jamais affiche ni journalise. Ne jette pas.
 */
async function appelAgentAok(methode: string, params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const jeton = process.env.TELEGRAM_BOT_TOKEN_COCKPIT?.trim()
  if (!jeton) {
    console.error(`[tab/repondre] ${methode} : TELEGRAM_BOT_TOKEN_COCKPIT absent du projet journal`)
    return null
  }
  try {
    const r = await fetch(`${API_TG}/bot${jeton}/${methode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10_000),
    })
    const json = await r.json().catch(() => null) as { ok?: boolean; result?: unknown; description?: string } | null
    if (!r.ok || !json?.ok) {
      console.error(`[tab/repondre] ${methode} refuse par Telegram (${r.status}) : ${String(json?.description ?? '').slice(0, 120)}`)
      return null
    }
    return json.result && typeof json.result === 'object' ? json.result as Record<string, unknown> : {}
  } catch (err) {
    console.error(`[tab/repondre] ${methode} : ${premiereLigne(err).slice(0, 120)}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Le fil
// ---------------------------------------------------------------------------

type LigneFil = {
  id: string; app: string; telegram_id: bigint | null; messages: unknown
  email: string | null; nom: string | null; pseudo: string | null; attend_t: number | null
}

/** Le fil Support, son compte Telegram, son nom (registre du groupe, sinon fiche membre) et son email. */
async function lireFil(tx: Tx, id: string): Promise<FilLu | null> {
  const [l] = await tx.$queryRaw<LigneFil[]>`
    select t.id, t.app, t."telegramId" as telegram_id, t.messages, t."contactEmail" as email,
      coalesce(g.nom_affiche, m.nom) as nom, g.pseudo,
      (extract(epoch from t."escalatedAt") * 1000)::float8 as attend_t
    from public."SupportThread" t
    left join public.cockpit_telegram_membres g on g.telegram_id = t."telegramId"
    left join lateral (
      select me.nom from public.cockpit_membres_etat me where me.membre_id::text = t."membreId" limit 1) m on true
    where t.id = ${id}
    limit 1`
  if (!l) return null
  const tg = l.telegram_id === null ? null : Number(l.telegram_id)
  return {
    id: l.id,
    app: l.app,
    telegramId: tg !== null && Number.isSafeInteger(tg) && tg > 0 ? tg : null,
    nom: l.nom,
    pseudo: l.pseudo,
    email: l.email,
    messages: l.messages,
    attendT: l.attend_t === null ? null : Number(l.attend_t),
  }
}

function destinataireDe(f: FilLu): string {
  return libelleDestinataire({ nom: f.nom, pseudo: f.pseudo, email: f.email, telegramId: f.telegramId })
}

// ---------------------------------------------------------------------------
// Les cartes dans Agent AOK
// ---------------------------------------------------------------------------

/** Une carte partie : le chat, le message (pour la clore apres le clic) et a qui. */
type CarteEnvoyee = { chat: number; message: number; qui: string }

function lireCartes(brut: unknown): CarteEnvoyee[] {
  if (!Array.isArray(brut)) return []
  return brut.filter((c): c is CarteEnvoyee => !!c && typeof c === 'object'
    && Number.isSafeInteger((c as CarteEnvoyee).chat) && Number.isSafeInteger((c as CarteEnvoyee).message))
}

/** La carte a chaque compte de l'equipe (Brice et Melanie), avec ses boutons. Rend celles qui sont parties. */
async function envoyerCartes(id: string, carte: string): Promise<CarteEnvoyee[]> {
  const equipe = await prisma.$queryRaw<{ telegram_id: bigint; libelle: string | null }[]>`
    select telegram_id, libelle from public.cockpit_telegram_comptes order by cree_le`
  const parties: CarteEnvoyee[] = []
  for (const d of equipe) {
    const chat = Number(d.telegram_id)
    if (!Number.isSafeInteger(chat) || chat <= 0) continue
    const r = await appelAgentAok('sendMessage', {
      chat_id: chat, text: carte, reply_markup: { inline_keyboard: clavierProposition(id) }, link_preview_options: { is_disabled: true },
    })
    const message = Number(r?.message_id)
    if (Number.isSafeInteger(message) && message > 0) parties.push({ chat, message, qui: nomEquipe(d.libelle) })
  }
  return parties
}

/** Toutes les cartes d'une proposition decidee : la ligne de fin, plus de boutons. Ne jette pas. */
async function clore(carte: string, cartes: CarteEnvoyee[], fin: string, enPlus?: { chat: number; message: number }): Promise<void> {
  const liste = [...cartes]
  if (enPlus && Number.isSafeInteger(enPlus.message) && enPlus.message > 0
    && !liste.some((c) => c.chat === enPlus.chat && c.message === enPlus.message)) {
    liste.push({ ...enPlus, qui: '' })
  }
  for (const c of liste) {
    await appelAgentAok('editMessageText', {
      chat_id: c.chat, message_id: c.message, text: carteDecidee(carte, fin),
      reply_markup: { inline_keyboard: [] }, link_preview_options: { is_disabled: true },
    })
  }
}

// ---------------------------------------------------------------------------
// 1. Proposer (POST /support/<fil_id>/repondre)
// ---------------------------------------------------------------------------

type Ancienne = { id: string; statut: string; carte: string; cartes: unknown }

/**
 * Prepare une reponse : controles, proposition enregistree, cartes a
 * l'equipe. Rien ne part au membre. Ne jette pas.
 */
export async function proposerReponseTab(e: { portee: PorteeApi; cleId: string; fil: string; corps: unknown }): Promise<SortieApi> {
  // Seconde garde : seules les cles 'tab' et 'tache' arrivent ici (verifierCle), jamais une autre.
  const auteur: AuteurProposition | null = porteeApi(e.portee)
  if (!auteur) return refus(401, 'Clé inconnue ou coupée.')
  const filId = lireIdFil(e.fil)
  if (!filId) return refus(400, "Identifiant de fil invalide : prends le fil_id (uuid complet) d'un fil de GET /support. Rien n'est proposé.")
  const demande = lireDemandeReponse(e.corps)
  if (typeof demande === 'string') return refus(400, demande)

  const bot = nomBot()
  const controle = controlerTexteReponse(demande.texte, bot)
  if (!controle.ok) {
    if (controle.raison === 'suspect' && controle.analyse) {
      await alerterBriceSecurite({
        source: `API de Tab (clé de ${nomAuteur(auteur)}), réponse préparée pour un membre`,
        qui: referenceFil(filId),
        analyse: controle.analyse,
        suite: "Rien n'est proposé ni envoyé : la demande est refusée, aucune carte n'est partie.",
      })
    }
    return refus(controle.raison === 'vide' || controle.raison === 'trop_long' ? 400 : 422, controle.erreur, `refus ${controle.raison}`)
  }

  let fil: FilLu | null
  try {
    fil = await enLectureSeule((tx) => lireFil(tx, filId))
  } catch (err) {
    console.error(`[tab/repondre] fil illisible : ${premiereLigne(err)}`)
    return refus(502, "Lecture du fil impossible pour l'instant : rien n'est proposé. Réessaie dans un instant.", premiereLigne(err))
  }
  const maintenant = Date.now()
  const v = verdictFil(fil, maintenant)
  if (!v.ok) return refus(v.status, `${v.erreur} Rien n'est proposé.`, `refus ${v.raison}`)
  if (!fil) return refus(404, "Fil introuvable. Rien n'est proposé.")

  const reference = referenceFil(fil.id) ?? `fil ${fil.id.slice(0, 8)}`
  const destinataire = destinataireDe(fil)
  const expireT = expirationProposition(maintenant)
  const carte = texteCarte({
    auteur, fil, reference, destinataire, dernierMembreT: v.dernierMembreT, texte: controle.texte, bot, aVerifier: controle.aVerifier, expireT,
  })

  // Enregistrer, sous un verrou par fil : cadence de l'heure glissante, puis la proposition.
  let ecrit: { cadence: string } | { id: string }
  try {
    ecrit = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`tab:proposition:${filId}`}::text, 0))) as verrou`
      const [c] = await tx.$queryRaw<{ fil: number; cle: number }[]>`
        select
          (select count(*)::int from public.cockpit_tab_propositions
            where fil_id = ${filId} and propose_le > now() - interval '1 hour') as fil,
          (select count(*)::int from public.cockpit_tab_propositions
            where cle_id = ${e.cleId}::uuid and propose_le > now() - interval '1 hour') as cle`
      const cadence = refusCadence({ parFilHeure: c?.fil ?? 0, parCleHeure: c?.cle ?? 0 })
      if (cadence) return { cadence }
      const [p] = await tx.$queryRaw<{ id: string }[]>`
        insert into public.cockpit_tab_propositions (cle_id, auteur, fil_id, texte, carte, propose_le, expire_le)
        values (${e.cleId}::uuid, ${auteur}, ${filId}, ${controle.texte}, ${carte}, clock_timestamp(), ${new Date(expireT).toISOString()}::timestamptz)
        returning proposition_id::text as id`
      return { id: p.id }
    }, { maxWait: 5000, timeout: 15000 })
  } catch (err) {
    if (tableAbsente(err)) return TABLE_ABSENTE
    console.error(`[tab/repondre] proposition non enregistree : ${premiereLigne(err)}`)
    return refus(502, "Proposition non enregistrée (erreur de la base) : rien n'est proposé. Réessaie dans un instant.", premiereLigne(err))
  }
  if ('cadence' in ecrit) return refus(429, ecrit.cadence, 'cadence')
  const id = ecrit.id

  // Les cartes. Aucune partie = la proposition ne sert a rien : echec, et Tab le sait.
  let cartes: CarteEnvoyee[] = []
  try {
    cartes = await envoyerCartes(id, carte)
  } catch (err) {
    console.error(`[tab/repondre] equipe illisible : ${premiereLigne(err)}`)
  }
  try {
    if (cartes.length === 0) {
      await prisma.$executeRaw`
        update public.cockpit_tab_propositions
        set statut = 'echec', decide_le = now(), issue = 'Aucune carte n''a pu partir dans Agent AOK.'
        where proposition_id = ${id}::uuid and statut = 'proposee'`
    } else {
      await prisma.$executeRaw`
        update public.cockpit_tab_propositions set cartes = ${JSON.stringify(cartes)}::jsonb where proposition_id = ${id}::uuid`
    }
  } catch (err) {
    console.error(`[tab/repondre] cartes non notees : ${premiereLigne(err)}`)
  }
  if (cartes.length === 0) {
    return refus(502, "La carte n'a pu partir ni à Brice ni à Mélanie (Agent AOK injoignable) : rien n'est proposé, rien n'est parti au membre. "
      + 'Réessaie dans un instant, ou préviens Brice autrement.', 'cartes non livrees')
  }

  // Les propositions plus anciennes du meme fil encore en attente : remplacees (leurs cartes perdent leurs boutons).
  let remplacees: Ancienne[] = []
  try {
    remplacees = await prisma.$queryRaw<Ancienne[]>`
      update public.cockpit_tab_propositions o
      set statut = case when o.expire_le <= now() then 'expiree' else 'remplacee' end, decide_le = now()
      where o.fil_id = ${filId} and o.statut = 'proposee' and o.proposition_id <> ${id}::uuid
        and o.propose_le <= (select n.propose_le from public.cockpit_tab_propositions n where n.proposition_id = ${id}::uuid)
      returning o.proposition_id::text as id, o.statut, o.carte, o.cartes`
    for (const a of remplacees) await clore(a.carte, lireCartes(a.cartes), finDeCarte(a.statut, null))
  } catch (err) {
    console.error(`[tab/repondre] anciennes propositions non remplacees : ${premiereLigne(err)}`)
  }

  const tHumain = dernierMessageEquipe(fil.messages)
  const attend = fil.attendT !== null && !(tHumain !== null && tHumain >= fil.attendT)
  return {
    status: 202,
    lignes: 1,
    corps: {
      ok: true,
      libelle: "Réponse proposée, en attente de validation par Brice ou Mélanie : rien n'est parti au membre",
      donnees: {
        proposition_id: id,
        statut: 'proposee',
        statut_en_clair: statutPropositionEnClair('proposee'),
        fil_id: fil.id,
        reference,
        qui: destinataire,
        canal: 'bot Live Club (Telegram), message privé du bot des membres',
        texte_qui_partira: texteReponseEquipe(controle.texte),
        cartes_envoyees_a: cartes.map((c) => c.qui),
        expire_le: new Date(expireT).toISOString(),
        expire_le_paris: heureParis(expireT),
        fil_attend_un_humain: attend,
        a_verifier: controle.aVerifier,
        remplace: remplacees.map((a) => a.id),
      },
      notes: [
        "Rien n'est parti : Brice ou Mélanie l'envoient d'un clic dans Agent AOK (Envoyer ou Annuler). Le premier clic l'emporte.",
        `Où elle en est : GET /support/propositions/${id} (proposee, envoyee, annulee, expiree...).`,
        `Sans clic, elle expire le ${heureParis(expireT)} et ne part jamais seule.`,
        ...(remplacees.length ? ['Elle remplace ta proposition précédente pour ce fil, qui ne peut plus partir.'] : []),
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// 2. Le clic dans Agent AOK
// ---------------------------------------------------------------------------

type LigneProposition = {
  id: string; cle_id: string; auteur: string; fil_id: string; texte: string; carte: string; cartes: unknown
  statut: string; propose_t: number; expire_t: number; decide_par_libelle: string | null
}

type IssueEnvoi = { statut: 'envoyee' | 'refusee' | 'echec'; texte: string; http: number }

/** Le clic Envoyer, la proposition deja passee a 'envoi' : controles refaits, puis l'envoi de l'onglet Support. Ne jette pas. */
async function envoyerProposition(p: LigneProposition, par: string): Promise<IssueEnvoi> {
  const auteur: AuteurProposition = p.auteur === 'tache' ? 'tache' : 'tab'
  const c = controlerTexteReponse(p.texte, nomBot())
  if (!c.ok) return { statut: 'refusee', texte: `Rien n'est parti : ${c.erreur}`, http: 422 }
  let fil: FilLu | null
  try {
    fil = await enLectureSeule((tx) => lireFil(tx, p.fil_id))
  } catch (err) {
    console.error(`[tab/repondre] fil illisible au clic : ${premiereLigne(err)}`)
    return { statut: 'echec', texte: "Base illisible : rien n'est parti. Redemande la réponse à Tab dans un instant.", http: 502 }
  }
  const v = verdictFil(fil, Date.now())
  if (!v.ok) return { statut: 'refusee', texte: `${v.erreur} Rien n'est parti.`, http: v.status }
  if (!fil) return { statut: 'refusee', texte: "Fil introuvable. Rien n'est parti.", http: 404 }
  // L'equipe a repondu depuis la proposition (onglet Support, Agent AOK) : pas deux reponses.
  const tEquipe = dernierMessageEquipe(fil.messages)
  if (tEquipe !== null && tEquipe > Number(p.propose_t)) {
    return { statut: 'refusee', texte: refusEquipePlusRapide(nomCourt(fil), tEquipe), http: 409 }
  }

  const qui = destinataireDe(fil)
  const reference = referenceFil(fil.id)
  // L'envoi de l'onglet Support, a l'identique (import a la demande : le bundle de l'API n'en a besoin qu'ici).
  const { repondreAuFil } = await import('@/lib/support-reponse')
  let issue: Awaited<ReturnType<typeof repondreAuFil>>
  try {
    issue = await repondreAuFil(fil.id, c.texte, '[tab/repondre]')
  } catch (err) {
    console.error(`[tab/repondre] envoi impossible : ${premiereLigne(err)}`)
    return { statut: 'echec', texte: "Base illisible : rien n'a été envoyé ni enregistré. Redemande la réponse à Tab dans un instant.", http: 502 }
  }
  const phrase = phraseIssueReponse(issue, { qui, reference })
  if (phrase.genre === 'fait') {
    // La mention interne dans le fil Support (le membre ne voit pas le fil d'un compte Telegram).
    const { tracerEtape } = await import('@/lib/liveclub/support-pont')
    if (fil.telegramId) await tracerEtape(fil.telegramId, ligneFilEnvoi(auteur, par))
    return { statut: 'envoyee', texte: `${phrase.texte} Préparée par ${nomAuteur(auteur)}, validée par ${par}.`, http: 200 }
  }
  return { statut: phrase.genre === 'refus' ? 'refusee' : 'echec', texte: phrase.texte, http: phrase.genre === 'refus' ? 409 : 502 }
}

/**
 * Un clic Envoyer ou Annuler sous une carte de proposition, dans Agent AOK.
 * Appele par traiterClicAgentTelegram APRES le verrou du compte de l'equipe
 * (cockpit_telegram_comptes). Toujours answerCallbackQuery. Ne jette pas.
 */
export async function traiterBoutonPropositionTab(
  cq: ClicAgentTelegram, chatId: number, telegramId: number, compte: CompteCockpitTelegram,
  bouton: { id: string; verbe: VerbeProposition },
): Promise<void> {
  const debut = Date.now()
  const par = nomEquipe(compte.libelle)
  const userId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(compte.user_id) ? compte.user_id : null
  const acquitter = (texte?: string) =>
    appelAgentAok('answerCallbackQuery', { callback_query_id: cq.id, ...(texte ? { text: texte.slice(0, 190) } : {}) })
  const ici = { chat: chatId, message: Number(cq.message?.message_id) }

  // La decision, la ligne verrouillee : deux clics simultanes (Brice et Melanie) ne decident qu'une fois.
  let d: { genre: DecisionClic; p: LigneProposition | null }
  try {
    d = await prisma.$transaction(async (tx) => {
      const [p] = await tx.$queryRaw<LigneProposition[]>`
        select proposition_id::text as id, cle_id::text as cle_id, auteur, fil_id, texte, carte, cartes, statut,
          (extract(epoch from propose_le) * 1000)::float8 as propose_t,
          (extract(epoch from expire_le) * 1000)::float8 as expire_t,
          decide_par_libelle
        from public.cockpit_tab_propositions where proposition_id = ${bouton.id}::uuid
        for update`
      const genre = decisionClic(p?.statut, p ? Number(p.expire_t) : null, Date.now(), bouton.verbe)
      if (!p || genre === 'introuvable' || genre === 'deja') return { genre, p: p ?? null }
      const statut = genre === 'expiree' ? 'expiree' : genre === 'annuler' ? 'annulee' : 'envoi'
      await tx.$executeRaw`
        update public.cockpit_tab_propositions
        set statut = ${statut}, decide_le = now(), decide_par = ${userId}::uuid, decide_par_telegram = ${telegramId},
          decide_par_libelle = ${par}
        where proposition_id = ${p.id}::uuid`
      return { genre, p }
    }, { maxWait: 5000, timeout: 15000 })
  } catch (err) {
    console.warn(`[tab/repondre] clic non traite : ${premiereLigne(err).slice(0, 160)}`)
    await acquitter(tableAbsente(err) ? "Cette fonction n'est pas encore en place." : "Souci technique, rien n'a été fait. Réessaie dans un moment.")
    return
  }

  const retirerBoutons = () => Number.isSafeInteger(ici.message) && ici.message > 0
    ? appelAgentAok('editMessageReplyMarkup', { chat_id: ici.chat, message_id: ici.message, reply_markup: { inline_keyboard: [] } })
    : Promise.resolve(null)
  const p = d.p
  if (!p || d.genre === 'introuvable') {
    await acquitter('Cette proposition est introuvable.')
    await retirerBoutons()
    return
  }
  const cartes = lireCartes(p.cartes)
  if (d.genre === 'deja') {
    // Le second clic (ou un clic tardif) : « déjà traité par X ».
    await acquitter(texteDejaTraite(p.statut, p.decide_par_libelle))
    await retirerBoutons()
    return
  }
  if (d.genre === 'expiree') {
    await acquitter("Proposition expirée : rien n'est parti.")
    await clore(p.carte, cartes, finDeCarte('expiree', null), ici)
    return
  }
  if (d.genre === 'annuler') {
    await journaliser({
      cleId: p.cle_id, route: `/support/${p.fil_id}/repondre/annulation`, parametres: { proposition_id: p.id, decide_par: par },
      statut: 200, dureeMs: Date.now() - debut, lignes: 0, ip: null,
    })
    console.log('[tab/repondre] proposition annulee')
    await acquitter("Annulé : rien n'est parti.")
    await clore(p.carte, cartes, finDeCarte('annulee', par), ici)
    return
  }

  // Envoyer. Le bouton cesse de tourner tout de suite ; le resultat suit en message.
  await acquitter('Envoi en cours...')
  let r: IssueEnvoi
  try {
    r = await envoyerProposition(p, par)
  } catch (err) {
    console.error(`[tab/repondre] envoi interrompu : ${premiereLigne(err)}`)
    r = { statut: 'echec', texte: "Envoi interrompu par une erreur : vérifie le fil dans l'onglet Support avant de redemander.", http: 500 }
  }
  try {
    await prisma.$executeRaw`
      update public.cockpit_tab_propositions set statut = ${r.statut}, issue = ${r.texte.slice(0, 1000)}
      where proposition_id = ${p.id}::uuid and statut = 'envoi'`
  } catch (err) {
    console.error(`[tab/repondre] issue non notee : ${premiereLigne(err)}`)
  }
  // La trace au journal d'acces de l'API, au nom de la cle qui a prepare la reponse.
  await journaliser({
    cleId: p.cle_id, route: `/support/${p.fil_id}/repondre/envoi`,
    parametres: { proposition_id: p.id, decide_par: par, issue: r.statut },
    statut: r.http, dureeMs: Date.now() - debut, lignes: r.statut === 'envoyee' ? 1 : 0, ip: null,
    erreur: r.statut === 'envoyee' ? null : r.texte,
  })
  console.log(`[tab/repondre] proposition ${r.statut}`)
  await clore(p.carte, cartes, finDeCarte(r.statut, par, r.statut === 'envoyee' ? null : r.texte), ici)
  await appelAgentAok('sendMessage', { chat_id: chatId, text: r.texte, link_preview_options: { is_disabled: true } })
}

// ---------------------------------------------------------------------------
// 3. Ou en sont les propositions (GET)
// ---------------------------------------------------------------------------

type LigneLue = {
  id: string; auteur: string; fil_id: string; texte: string; statut: string; par_ta_cle: boolean
  propose_t: number; expire_t: number; decide_t: number | null; decide_par_libelle: string | null; issue: string | null
}

/** GET /support/propositions[/<id>] : les propositions, les plus recentes d'abord, avec leur statut lu. */
export async function listerPropositions(e: {
  cleId: string; id: string | null; fil: string | null; statut: string | null; limite: number
}): Promise<SortieApi> {
  const id = e.id === null ? null : lireIdFil(e.id)
  if (e.id !== null && !id) return refus(400, 'Identifiant de proposition invalide (uuid attendu).')
  const fil = e.fil ? lireIdFil(e.fil) : null
  if (e.fil && !fil) return refus(400, 'fil : le fil_id (uuid complet) de GET /support.')
  const statut = (e.statut ?? 'toutes').trim().toLowerCase()
  if (statut !== 'toutes' && !(STATUTS_PROPOSITION as readonly string[]).includes(statut)) {
    return refus(400, `statut : toutes, ${STATUTS_PROPOSITION.join(', ')}.`)
  }
  const limite = Math.min(Math.max(Math.trunc(e.limite) || 50, 1), 200)
  let lignes: LigneLue[]
  try {
    lignes = await enLectureSeule((tx) => tx.$queryRaw<LigneLue[]>`
      select p.proposition_id::text as id, p.auteur, p.fil_id, p.texte, p.statut, (p.cle_id = ${e.cleId}::uuid) as par_ta_cle,
        (extract(epoch from p.propose_le) * 1000)::float8 as propose_t,
        (extract(epoch from p.expire_le) * 1000)::float8 as expire_t,
        (extract(epoch from p.decide_le) * 1000)::float8 as decide_t,
        p.decide_par_libelle, p.issue
      from public.cockpit_tab_propositions p
      where (${id}::uuid is null or p.proposition_id = ${id}::uuid)
        and (${fil}::text is null or p.fil_id = ${fil}::text)
      order by p.propose_le desc
      limit ${id ? 1 : 500}`)
  } catch (err) {
    if (tableAbsente(err)) return TABLE_ABSENTE
    console.error(`[tab/repondre] propositions illisibles : ${premiereLigne(err)}`)
    return refus(502, "Lecture des propositions impossible pour l'instant.", premiereLigne(err))
  }
  if (id && lignes.length === 0) return refus(404, 'Proposition introuvable.')
  const maintenant = Date.now()
  const lues = lignes
    .map((l) => {
      const s = statutEffectif(l.statut, Number(l.expire_t), maintenant)
      return {
        proposition_id: l.id,
        preparee_par: nomAuteur(l.auteur === 'tache' ? 'tache' : 'tab'),
        par_ta_cle: l.par_ta_cle,
        fil_id: l.fil_id,
        reference: referenceFil(l.fil_id),
        statut: s,
        statut_en_clair: statutPropositionEnClair(s),
        proposee_le: heureParis(Number(l.propose_t)),
        expire_le: heureParis(Number(l.expire_t)),
        decidee_le: l.decide_t === null ? null : heureParis(Number(l.decide_t)),
        decidee_par: l.decide_par_libelle,
        issue: l.issue,
        texte: l.texte,
      }
    })
    .filter((l) => statut === 'toutes' || l.statut === statut)
    .slice(0, limite)
  if (id) {
    return { status: 200, lignes: 1, corps: { ok: true, libelle: `Réponse préparée : ${lues[0].statut_en_clair}`, donnees: { proposition: lues[0] } } }
  }
  return {
    status: 200,
    lignes: lues.length,
    corps: {
      ok: true,
      libelle: `Réponses préparées pour les membres (${statut === 'toutes' ? 'toutes' : statut}), les plus récentes d'abord`,
      donnees: { propositions: lues },
      notes: ['proposee = la carte attend Brice ou Mélanie ; envoyee = partie au membre ; annulee, expiree, remplacee, refusee, echec = rien n\'est parti.'],
    },
  }
}

/** Pour GET /support : la derniere proposition de chaque fil (table absente = aucune). Dans la transaction READ ONLY de la route. */
export async function dernieresPropositions(tx: Tx, filIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const r = new Map<string, Record<string, unknown>>()
  if (filIds.length === 0) return r
  // to_regclass ne leve pas d'erreur : une table absente n'interrompt pas la transaction de lecture.
  const [t] = await tx.$queryRaw<{ ok: boolean }[]>`select to_regclass('public.cockpit_tab_propositions') is not null as ok`
  if (!t?.ok) return r
  const lignes = await tx.$queryRaw<{ id: string; fil_id: string; auteur: string; statut: string; propose_t: number; expire_t: number }[]>`
    select distinct on (fil_id) proposition_id::text as id, fil_id, auteur, statut,
      (extract(epoch from propose_le) * 1000)::float8 as propose_t,
      (extract(epoch from expire_le) * 1000)::float8 as expire_t
    from public.cockpit_tab_propositions
    where fil_id = any(${filIds}::text[])
    order by fil_id, propose_le desc`
  const maintenant = Date.now()
  for (const l of lignes) {
    const s = statutEffectif(l.statut, Number(l.expire_t), maintenant)
    r.set(l.fil_id, {
      proposition_id: l.id,
      preparee_par: nomAuteur(l.auteur === 'tache' ? 'tache' : 'tab'),
      statut: s,
      statut_en_clair: statutPropositionEnClair(s),
      proposee_le: heureParis(Number(l.propose_t)),
    })
  }
  return r
}
