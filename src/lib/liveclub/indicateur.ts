// L'INDICATEUR TRADINGVIEW D'ALEX (Brice, 05/11/2026) : la lecture, l'ecriture
// et l'envoi. Les regles, les textes et les messages : indicateur-pur.ts (le
// pourquoi y est, avec la phrase de Brice). Branche dans bot-membre.ts (le
// bouton, l'etape, la carte, l'outil de l'agent) et dans passage.ts (tache u).
//
// Brice, 05/11 : « c'est la conversation qu'il [Alex] a avec l'agent live club
// qui lui transmet les infos dans leur conversation ». Les messages partent
// donc du BOT DES MEMBRES (TELEGRAM_LIVECLUB_BOT_TOKEN) vers le relais qui
// porte cockpit_liveclub_relais.indicateur (et actif) : Alex aujourd'hui, relu
// dans la table a chaque envoi, jamais en dur.
//
// LA TRACE : cockpit_liveclub_indicateur (migration 20261105250000), une ligne
// par demande, une seule ouverte par compte Telegram. Un message a Alex est
// RESERVE avant de partir (envoi_reserve_le, update atomique) : le bouton et
// le passage, ou deux passages, n'envoient pas deux fois. Telegram refuse
// (Alex a bloque le bot) : la reservation est liberee, la trace garde « a
// transmettre » (pseudo_transmis different du pseudo) ou « depart a prevenir »
// (prevenu_depart_le nul), et le passage suivant reessaie.
//
// L'ETAPE et la CARTE : cockpit_liveclub_conversations.action_en_attente (le
// meme emplacement que les confirmations de conversations.ts, types
// indicateur_pseudo et indicateur), avec un nonce. Une nouvelle proposition
// (pause, arret...) remplace l'etape, comme d'habitude ; un bouton ic:/ix:
// ne consomme que SON nonce et SES types.
//
// LES DEPARTS : un membre « actif » = un droit en cours au Live Club, la regle
// qui decide qui reste dans le groupe (droitLiveClub : abonnement, acces
// broker, exemption, acces manuel). 'non' = depart (une fois), 'inconnu' = on
// ne touche a rien. Relu au bouton et a la carte, et par le passage du matin
// (comptes sortis par ce passage d'abord, puis absents du groupe, puis les
// plus anciennement relus, MAX_DROITS_PASSAGE au plus).
//
// INTERRUPTEUR : LIVECLUB_INDICATEUR=0 coupe les messages a Alex et la tache
// du passage (les demandes restent notees « a transmettre »).
//
// Jamais de nom, de pseudo, d'identifiant ni de texte de message dans un log :
// des comptes et des codes seulement.

import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { droitLiveClub } from './droits'
import { envoyer, type Bouton } from './telegram'
import { messageErreur, relationAbsente } from './pur'
import { nomPropre, pseudoPropre } from './relais-pur'
import {
  MAX_DROITS_PASSAGE, MAX_ENVOIS_PASSAGE, TEXTE_ANNULE, TEXTE_BOUTON_PERIME, TEXTE_DROIT_ILLISIBLE, TEXTE_ETAPE,
  TEXTE_NON_MEMBRE, TEXTE_PANNE_INDICATEUR, TEXTE_PAS_ENCORE, TEXTE_PSEUDO_INVALIDE, TEXTE_RELANCE, TEXTE_RELANCE_CARTE,
  TYPES_ETAPE_INDICATEUR, annonceAFaire, boutonsCarte, boutonsEtape, decisionDemande, estEtapeIndicateur, etapeExpiree,
  issueDroit, lireEntreePseudo, messageChangementAlex, messageDemandeAlex, messageDepartAlex, nouvelleCarte, nouvelleEtape,
  ordreVerification, pseudosARetirer, statutDemande, texteApres, texteCarte, texteEtapeDeja, textePresentationAlex,
  type DecisionDemande, type EtapeIndicateur, type LigneAVerifier, type QuiPourAlex,
} from './indicateur-pur'

/** LIVECLUB_INDICATEUR=0 coupe les messages a Alex et la tache du passage. */
export function indicateurActif(): boolean {
  return process.env.LIVECLUB_INDICATEUR?.trim() !== '0'
}

/** Une reservation d'envoi plus vieille (fonction coupee net) est oubliee. */
const RESERVATION_PERIMEE_MIN = 15

/** Le compte qui ecrit (champ from de l'update) : l'identite vient de Telegram, jamais d'un texte. */
export type CompteIndicateur = { id: number; first_name?: string; username?: string }

/** Ce que le bot envoie au membre. `equipe` : joindre « Contacter l'equipe ». */
export type ReponseIndicateur = { texte: string; boutons?: Bouton[][]; equipe?: true }

function colonneAbsente(err: unknown): boolean {
  return /42703|column .* does not exist/i.test(err instanceof Error ? err.message : String(err))
}

/** La migration manque (table ou colonne) : le parcours dit « bientot », le passage ne fait rien. */
function migrationAbsente(err: unknown): boolean {
  return relationAbsente(err) || colonneAbsente(err)
}

const panne = (): ReponseIndicateur => ({ texte: TEXTE_PANNE_INDICATEUR, equipe: true })

// ---------------------------------------------------------------------------
// L'etape et la carte (cockpit_liveclub_conversations)
// ---------------------------------------------------------------------------

async function poserEtape(telegramId: number, etape: EtapeIndicateur): Promise<string> {
  const nonce = randomBytes(9).toString('base64url')
  await prisma.$executeRaw`
    insert into public.cockpit_liveclub_conversations (telegram_id, action_en_attente, nonce, maj_le)
    values (${telegramId}, ${JSON.stringify(etape)}::jsonb, ${nonce}, now())
    on conflict (telegram_id) do update set
      action_en_attente = excluded.action_en_attente, nonce = excluded.nonce, maj_le = now()`
  return nonce
}

/** L'etape ou la carte en cours de ce compte (pas expiree), ou null. Jette sur une panne. */
async function lireEtape(telegramId: number): Promise<{ etape: EtapeIndicateur; nonce: string } | null> {
  const lignes = await prisma.$queryRaw<{ action_en_attente: unknown; nonce: string | null }[]>`
    select action_en_attente, nonce from public.cockpit_liveclub_conversations
    where telegram_id = ${telegramId} and nonce is not null
      and action_en_attente ->> 'type' = any(${[...TYPES_ETAPE_INDICATEUR]}::text[])
    limit 1`
  const l = lignes[0]
  if (!l?.nonce || !estEtapeIndicateur(l.action_en_attente) || etapeExpiree(l.action_en_attente, Date.now())) return null
  return { etape: l.action_en_attente, nonce: l.nonce }
}

/** Consomme le nonce de CE compte pour ces types, en un seul UPDATE (un double clic ne passe qu'une fois). */
async function consommerEtape(telegramId: number, nonce: string, types: readonly string[]): Promise<EtapeIndicateur | 'expire' | null> {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) return null
  const lignes = await prisma.$queryRaw<{ action_en_attente: unknown }[]>`
    update public.cockpit_liveclub_conversations set nonce = null, maj_le = now()
    where telegram_id = ${telegramId} and nonce = ${nonce}
      and action_en_attente ->> 'type' = any(${[...types]}::text[])
    returning action_en_attente`
  const e = lignes[0]?.action_en_attente
  if (!estEtapeIndicateur(e)) return null
  return etapeExpiree(e, Date.now()) ? 'expire' : e
}

// ---------------------------------------------------------------------------
// Les demandes (cockpit_liveclub_indicateur)
// ---------------------------------------------------------------------------

type Ouverte = { demandeId: number; pseudo: string; pseudoTransmis: string | null; demandeLe: string }

/** La demande ouverte de ce compte, ou null. Jette sur une panne (et sur une table absente). */
async function lireOuverte(telegramId: number): Promise<Ouverte | null> {
  const l = (await prisma.$queryRaw<{ demande_id: bigint; pseudo_tradingview: string; pseudo_transmis: string | null; demande_le: string }[]>`
    select demande_id, pseudo_tradingview, pseudo_transmis,
      to_char(demande_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as demande_le
    from public.cockpit_liveclub_indicateur
    where telegram_id = ${telegramId} and depart_le is null
    limit 1`)[0]
  return l ? { demandeId: Number(l.demande_id), pseudo: l.pseudo_tradingview, pseudoTransmis: l.pseudo_transmis, demandeLe: l.demande_le } : null
}

/**
 * Note la demande (une transaction, verrou par compte Telegram) : nouvelle
 * ligne, rien (meme pseudo), ou pseudo change. La decision est reprise sous
 * le verrou : deux clics simultanes n'ecrivent qu'une fois.
 */
async function enregistrerDemande(
  telegramId: number,
  pseudo: string,
  o: { prenom: string | null; pseudoTelegram: string | null; membreId: string | null },
): Promise<{ demandeId: number; decision: DecisionDemande; ancien: string | null }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`liveclub:indicateur:${telegramId}`}::text, 0))) as verrou`
    const l = (await tx.$queryRaw<{ demande_id: bigint; pseudo_tradingview: string; pseudo_transmis: string | null }[]>`
      select demande_id, pseudo_tradingview, pseudo_transmis from public.cockpit_liveclub_indicateur
      where telegram_id = ${telegramId} and depart_le is null
      limit 1 for update`)[0]
    const decision = decisionDemande(l ? { pseudo: l.pseudo_tradingview } : null, pseudo)
    if (!l) {
      const [n] = await tx.$queryRaw<{ demande_id: bigint }[]>`
        insert into public.cockpit_liveclub_indicateur (telegram_id, membre_id, prenom, pseudo_telegram, pseudo_tradingview, statut)
        values (${telegramId}, ${o.membreId}::uuid, ${o.prenom}, ${o.pseudoTelegram}, ${pseudo}, 'a_transmettre')
        returning demande_id`
      return { demandeId: Number(n.demande_id), decision, ancien: null }
    }
    if (decision === 'identique') return { demandeId: Number(l.demande_id), decision, ancien: null }
    const statut = statutDemande({ pseudo, pseudoTransmis: l.pseudo_transmis, departLe: null })
    await tx.$executeRaw`
      update public.cockpit_liveclub_indicateur set
        pseudo_tradingview = ${pseudo}, statut = ${statut},
        prenom = coalesce(${o.prenom}, prenom), pseudo_telegram = coalesce(${o.pseudoTelegram}, pseudo_telegram),
        membre_id = coalesce(membre_id, ${o.membreId}::uuid), maj_le = now()
      where demande_id = ${l.demande_id}`
    return { demandeId: Number(l.demande_id), decision, ancien: l.pseudo_tradingview }
  })
}

/** Le relais qui recoit les demandes (cockpit_liveclub_relais.indicateur, actif), ou null. Ne jette pas. */
async function destinataire(): Promise<{ telegramId: number; nom: string } | null> {
  try {
    const l = (await prisma.$queryRaw<{ telegram_id: bigint; nom: string }[]>`
      select telegram_id, nom from public.cockpit_liveclub_relais
      where actif and indicateur
      order by cree_le, telegram_id
      limit 1`)[0]
    const id = l ? Number(l.telegram_id) : 0
    return l && Number.isSafeInteger(id) && id > 0 ? { telegramId: id, nom: l.nom } : null
  } catch (err) {
    if (!migrationAbsente(err)) console.warn(`[liveclub/indicateur] relais illisible : ${messageErreur(err).slice(0, 160)}`)
    return null
  }
}

/** Alex a-t-il deja recu un message de l'indicateur ? (la presentation part une fois, en tete du premier) */
async function dejaPresente(): Promise<boolean> {
  const r = await prisma.$queryRaw<{ oui: boolean }[]>`
    select exists (select 1 from public.cockpit_liveclub_indicateur
      where transmis_le is not null or prevenu_depart_le is not null) as oui`
  return r[0]?.oui === true
}

type LigneEnvoi = {
  telegram_id: bigint; prenom: string | null; pseudo_telegram: string | null
  pseudo_tradingview: string; pseudo_transmis: string | null; jour: string
}

const quiDe = (l: LigneEnvoi): QuiPourAlex => ({ prenom: l.prenom, pseudoTelegram: l.pseudo_telegram, telegramId: Number(l.telegram_id) })

export type IssueEnvoi = 'envoye' | 'rien' | 'echec' | 'sans_destinataire' | 'coupe'

/**
 * Le message qui attend de partir chez Alex pour CETTE demande (demande ou
 * pseudo change), reserve, envoye, puis note. Refus de Telegram : la
 * reservation est liberee, le passage suivant reessaie. Ne jette pas.
 */
export async function transmettreDemande(demandeId: number): Promise<IssueEnvoi> {
  if (!indicateurActif()) return 'coupe'
  const dest = await destinataire()
  if (!dest) return 'sans_destinataire'
  try {
    const l = (await prisma.$queryRaw<(LigneEnvoi & { demande_le: string })[]>`
      update public.cockpit_liveclub_indicateur set envoi_reserve_le = now()
      where demande_id = ${demandeId} and depart_le is null
        and (pseudo_transmis is null or lower(pseudo_transmis) <> lower(pseudo_tradingview))
        and (envoi_reserve_le is null or envoi_reserve_le < now() - make_interval(mins => ${RESERVATION_PERIMEE_MIN}::int))
      returning telegram_id, prenom, pseudo_telegram, pseudo_tradingview, pseudo_transmis,
        to_char(demande_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as demande_le,
        to_char(now() at time zone 'Europe/Paris', 'YYYY-MM-DD') as jour`)[0]
    if (!l) return 'rien'
    const annonce = annonceAFaire({ pseudo: l.pseudo_tradingview, pseudoTransmis: l.pseudo_transmis, departLe: null })
    if (!annonce) {
      await prisma.$executeRaw`update public.cockpit_liveclub_indicateur set envoi_reserve_le = null where demande_id = ${demandeId}`
      return 'rien'
    }
    const corps = annonce.genre === 'demande'
      ? messageDemandeAlex(quiDe(l), l.pseudo_tradingview, l.demande_le)
      : messageChangementAlex(quiDe(l), annonce.ancien, l.pseudo_tradingview, l.jour)
    const texte = (await dejaPresente()) ? corps : `${textePresentationAlex(dest.nom)}\n\n${corps}`
    const r = await envoyer(dest.telegramId, texte, undefined, { html: true })
    if (!r.ok) {
      console.warn(`[liveclub/indicateur] demande refusee par Telegram (code ${r.code ?? '?'}), gardee a transmettre`)
      await prisma.$executeRaw`
        update public.cockpit_liveclub_indicateur set envoi_reserve_le = null, dernier_echec_le = now() where demande_id = ${demandeId}`
      return 'echec'
    }
    // Le pseudo annonce devient celui qu'Alex a ; s'il a change pendant l'envoi, il reste un message a faire.
    await prisma.$executeRaw`
      update public.cockpit_liveclub_indicateur set
        pseudo_transmis = ${l.pseudo_tradingview}, transmis_le = now(), envoi_reserve_le = null,
        statut = case when depart_le is not null then 'partie'
                      when lower(pseudo_tradingview) = lower(${l.pseudo_tradingview}) then 'transmise'
                      else 'a_transmettre' end
      where demande_id = ${demandeId}`
    return 'envoye'
  } catch (err) {
    console.warn(`[liveclub/indicateur] envoi d une demande impossible : ${messageErreur(err).slice(0, 160)}`)
    return 'echec'
  }
}

/** Le droit est tombe : la demande se ferme (une fois). */
async function marquerDepart(demandeId: number): Promise<boolean> {
  const n = await prisma.$executeRaw`
    update public.cockpit_liveclub_indicateur set depart_le = now(), statut = 'partie', maj_le = now()
    where demande_id = ${demandeId} and depart_le is null`
  return n > 0
}

/** Le message de depart a Alex, une seule fois par depart (reserve, envoye, note). Ne jette pas. */
export async function prevenirDepart(demandeId: number): Promise<IssueEnvoi> {
  if (!indicateurActif()) return 'coupe'
  const dest = await destinataire()
  if (!dest) return 'sans_destinataire'
  try {
    const l = (await prisma.$queryRaw<LigneEnvoi[]>`
      update public.cockpit_liveclub_indicateur set envoi_reserve_le = now()
      where demande_id = ${demandeId} and depart_le is not null and prevenu_depart_le is null
        and (envoi_reserve_le is null or envoi_reserve_le < now() - make_interval(mins => ${RESERVATION_PERIMEE_MIN}::int))
      returning telegram_id, prenom, pseudo_telegram, pseudo_tradingview, pseudo_transmis,
        to_char(depart_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as jour`)[0]
    if (!l) return 'rien'
    const corps = messageDepartAlex(quiDe(l), pseudosARetirer({ pseudo: l.pseudo_tradingview, pseudoTransmis: l.pseudo_transmis }), l.jour)
    const texte = (await dejaPresente()) ? corps : `${textePresentationAlex(dest.nom)}\n\n${corps}`
    const r = await envoyer(dest.telegramId, texte, undefined, { html: true })
    if (!r.ok) {
      console.warn(`[liveclub/indicateur] depart refuse par Telegram (code ${r.code ?? '?'}), garde a prevenir`)
      await prisma.$executeRaw`
        update public.cockpit_liveclub_indicateur set envoi_reserve_le = null, dernier_echec_le = now() where demande_id = ${demandeId}`
      return 'echec'
    }
    await prisma.$executeRaw`
      update public.cockpit_liveclub_indicateur set prevenu_depart_le = now(), envoi_reserve_le = null where demande_id = ${demandeId}`
    return 'envoye'
  } catch (err) {
    console.warn(`[liveclub/indicateur] message de depart impossible : ${messageErreur(err).slice(0, 160)}`)
    return 'echec'
  }
}

/**
 * (05/11) EFFACEMENT DE NIVEAU 3 (« partir et tout effacer », effacement.ts) :
 * cockpit_effacer ne connait pas cette table (fonction de 800 lignes, non
 * redefinie pour une table ; membre_id y passe seulement a nul). Ici, APRES
 * l'effacement en base : chaque demande encore ouverte de ces comptes se
 * ferme et Alex recoit le message de depart habituel (le pseudo a retirer,
 * sinon l'acces resterait ouvert chez TradingView), puis les lignes sont
 * supprimees. Table absente (migration pas appliquee) : rien. Jette sur une
 * autre panne, pour que l'appelant le dise.
 */
export async function effacerDemandesIndicateur(telegramIds: readonly number[], membreIds: readonly string[]): Promise<{ effacees: number; alexPrevenu: number }> {
  const tg = telegramIds.filter((t) => Number.isSafeInteger(t) && t > 0)
  const mb = membreIds.filter((m) => /^[0-9a-f-]{36}$/i.test(m))
  if (tg.length === 0 && mb.length === 0) return { effacees: 0, alexPrevenu: 0 }
  let lignes: { demande_id: number; transmise: boolean; prevenu: boolean }[]
  try {
    lignes = await prisma.$queryRaw<{ demande_id: number; transmise: boolean; prevenu: boolean }[]>`
      select demande_id::int as demande_id, (pseudo_transmis is not null or statut = 'transmise') as transmise,
        (prevenu_depart_le is not null) as prevenu
      from public.cockpit_liveclub_indicateur
      where telegram_id = any(${tg}::bigint[]) or membre_id = any(${mb}::uuid[])`
  } catch (err) {
    if (/42P01|does not exist/i.test(messageErreur(err))) return { effacees: 0, alexPrevenu: 0 }
    throw err
  }
  let alexPrevenu = 0
  for (const l of lignes) {
    if (!l.transmise || l.prevenu) continue
    await marquerDepart(l.demande_id)
    if ((await prevenirDepart(l.demande_id)) === 'envoye') alexPrevenu++
  }
  const ids = lignes.map((l) => l.demande_id)
  const effacees = ids.length === 0 ? 0 : await prisma.$executeRaw`
    delete from public.cockpit_liveclub_indicateur where demande_id = any(${ids}::bigint[])`
  return { effacees, alexPrevenu }
}

/** Le droit tombe au moment ou le membre ecrit au bot : la demande se ferme et Alex est prevenu. Ne jette pas. */
async function departDepuisLeBot(demandeId: number): Promise<void> {
  try {
    if (await marquerDepart(demandeId)) await prevenirDepart(demandeId)
  } catch (err) {
    console.warn(`[liveclub/indicateur] depart non note : ${messageErreur(err).slice(0, 160)}`)
  }
}

// ---------------------------------------------------------------------------
// Le parcours du membre (bot-membre.ts envoie, et trace au fil Support)
// ---------------------------------------------------------------------------

/**
 * « Indicateur d'Alex » (bouton, conseil, ou l'agent qui oriente) : le droit
 * relu en direct, puis l'etape (pseudo attendu), ou la demande deja ouverte.
 * Ne jette pas.
 */
export async function etapeIndicateur(u: CompteIndicateur): Promise<ReponseIndicateur> {
  const droit = await droitLiveClub(u.id)
  if (droit.statut === 'inconnu') return { texte: TEXTE_DROIT_ILLISIBLE, equipe: true }
  let ouverte: Ouverte | null
  try {
    ouverte = await lireOuverte(u.id)
  } catch (err) {
    if (migrationAbsente(err)) return { texte: TEXTE_PAS_ENCORE }
    console.warn(`[liveclub/indicateur] demande illisible : ${messageErreur(err).slice(0, 160)}`)
    return panne()
  }
  if (issueDroit(droit.statut) === 'depart') {
    // Rien n'est garde pour un non-membre ; une demande ouverte se ferme (Alex prevenu).
    if (ouverte) await departDepuisLeBot(ouverte.demandeId)
    return { texte: TEXTE_NON_MEMBRE }
  }
  let nonce: string
  try {
    nonce = await poserEtape(u.id, nouvelleEtape(Date.now()))
  } catch (err) {
    console.warn(`[liveclub/indicateur] etape non posee : ${messageErreur(err).slice(0, 160)}`)
    return panne()
  }
  return { texte: ouverte ? texteEtapeDeja(ouverte) : TEXTE_ETAPE, boutons: boutonsEtape(nonce) }
}

/**
 * Un message ECRIT pendant l'etape ou la carte. null = pas d'etape en cours,
 * ou une phrase (le parcours habituel la lit) : rien n'est fait ici. Le pseudo
 * n'est jamais pris dans une phrase. Ne jette pas.
 */
export async function reponseTexteIndicateur(u: CompteIndicateur, texte: string): Promise<ReponseIndicateur | null> {
  let e: Awaited<ReturnType<typeof lireEtape>>
  try {
    e = await lireEtape(u.id)
  } catch {
    return null
  }
  if (!e) return null
  const entree = lireEntreePseudo(texte)
  if (entree.genre === 'phrase') return null
  const carte = e.etape.type === 'indicateur'
  try {
    if (entree.genre === 'annuler') {
      await consommerEtape(u.id, e.nonce, TYPES_ETAPE_INDICATEUR)
      return { texte: TEXTE_ANNULE }
    }
    if (entree.genre === 'relance') {
      return carte ? { texte: TEXTE_RELANCE_CARTE, boutons: boutonsCarte(e.nonce) } : { texte: TEXTE_RELANCE, boutons: boutonsEtape(e.nonce) }
    }
    if (entree.genre === 'invalide') return { texte: TEXTE_PSEUDO_INVALIDE, boutons: boutonsEtape(e.nonce) }
    const ouverte = await lireOuverte(u.id)
    const decision = decisionDemande(ouverte, entree.pseudo)
    if (decision === 'identique') {
      await consommerEtape(u.id, e.nonce, TYPES_ETAPE_INDICATEUR)
      return { texte: texteApres('identique', entree.pseudo, null) }
    }
    const nonce = await poserEtape(u.id, nouvelleCarte(entree.pseudo, Date.now()))
    const qui = { prenom: u.first_name ?? null, pseudoTelegram: u.username ?? null }
    return { texte: texteCarte(qui, entree.pseudo, decision === 'changement' && ouverte ? ouverte.pseudo : null), boutons: boutonsCarte(nonce) }
  } catch (err) {
    if (migrationAbsente(err)) return { texte: TEXTE_PAS_ENCORE }
    console.warn(`[liveclub/indicateur] pseudo non traite : ${messageErreur(err).slice(0, 160)}`)
    return panne()
  }
}

/**
 * « Oui, envoie a Alex » (ic:<nonce>) : la carte consommee (une fois), le
 * droit relu, la demande notee, puis le message a Alex (tout de suite ; s'il
 * ne part pas, le passage du matin reessaie). Ne jette pas.
 */
export async function confirmerIndicateur(u: CompteIndicateur, nonce: string): Promise<ReponseIndicateur> {
  let c: Awaited<ReturnType<typeof consommerEtape>>
  try {
    c = await consommerEtape(u.id, nonce, ['indicateur'])
  } catch (err) {
    if (migrationAbsente(err)) return { texte: TEXTE_PAS_ENCORE }
    console.warn(`[liveclub/indicateur] carte illisible : ${messageErreur(err).slice(0, 160)}`)
    return panne()
  }
  if (!c || c === 'expire' || c.type !== 'indicateur') return { texte: TEXTE_BOUTON_PERIME }
  const droit = await droitLiveClub(u.id)
  if (droit.statut === 'inconnu') return { texte: TEXTE_DROIT_ILLISIBLE, equipe: true }
  if (issueDroit(droit.statut) === 'depart') {
    try {
      const ouverte = await lireOuverte(u.id)
      if (ouverte) await departDepuisLeBot(ouverte.demandeId)
    } catch {
      // Rien de plus : le passage relira ce droit.
    }
    return { texte: TEXTE_NON_MEMBRE }
  }
  let r: Awaited<ReturnType<typeof enregistrerDemande>>
  try {
    r = await enregistrerDemande(u.id, c.pseudo, {
      prenom: nomPropre(u.first_name, 60),
      pseudoTelegram: pseudoPropre(u.username),
      membreId: droit.membreId ?? null,
    })
  } catch (err) {
    if (migrationAbsente(err)) return { texte: TEXTE_PAS_ENCORE }
    console.warn(`[liveclub/indicateur] demande non notee : ${messageErreur(err).slice(0, 160)}`)
    return panne()
  }
  if (r.decision !== 'identique') await transmettreDemande(r.demandeId)
  return { texte: texteApres(r.decision, c.pseudo, r.ancien) }
}

/** « Laisser tomber » (ix:<nonce>), sous l'etape ou sous la carte. Ne jette pas. */
export async function annulerIndicateur(telegramId: number, nonce: string): Promise<ReponseIndicateur> {
  try {
    const c = await consommerEtape(telegramId, nonce, TYPES_ETAPE_INDICATEUR)
    if (!c || c === 'expire') return { texte: TEXTE_BOUTON_PERIME }
    return { texte: TEXTE_ANNULE }
  } catch (err) {
    if (!migrationAbsente(err)) console.warn(`[liveclub/indicateur] annulation illisible : ${messageErreur(err).slice(0, 160)}`)
    return { texte: TEXTE_ANNULE }
  }
}

// ---------------------------------------------------------------------------
// Le passage du matin (tache u)
// ---------------------------------------------------------------------------

export type BilanIndicateur = {
  /** ok, coupe, table_absente, panne, sans_destinataire (aucun relais actif ne recoit les demandes). */
  etat: string
  /** Demandes (ou pseudos changes) parties chez Alex. */
  transmises: number
  /** Departs notes ce passage. */
  departs: number
  /** Departs dits a Alex. */
  prevenus: number
  /** Droits relus et toujours ouverts. */
  verifies: number
  /** Droits illisibles (rien n'est touche). */
  inconnus: number
  /** Messages refuses par Telegram (gardes, reessayes au passage suivant). */
  echecs: number
}

const bilanVide = (etat: string): BilanIndicateur => ({ etat, transmises: 0, departs: 0, prevenus: 0, verifies: 0, inconnus: 0, echecs: 0 })

/**
 * Pour le passage quotidien, apres les sorties du jour : (1) les messages qui
 * attendent de partir chez Alex, droit relu juste avant ; (2) le droit des
 * demandes ouvertes (comptes sortis par ce passage d'abord) : 'non' = depart ;
 * (3) les departs a dire a Alex, une fois chacun. `tempsEcoule` : le budget
 * du passage, aucune nouvelle lecture de droit au-dela. Ne jette pas.
 */
export async function tacheIndicateur(o: { sortis: ReadonlySet<number>; tempsEcoule: () => boolean; maintenant?: Date }): Promise<BilanIndicateur> {
  if (!indicateurActif()) return bilanVide('coupe')
  const b = bilanVide('ok')
  const maintenant = (o.maintenant ?? new Date()).getTime()
  try {
    // (1) Ce qui attend de partir (demande, pseudo change), le droit relu juste avant.
    const attente = await prisma.$queryRaw<{ demande_id: bigint; telegram_id: bigint }[]>`
      select demande_id, telegram_id from public.cockpit_liveclub_indicateur
      where depart_le is null and (pseudo_transmis is null or lower(pseudo_transmis) <> lower(pseudo_tradingview))
      order by maj_le, demande_id
      limit ${MAX_ENVOIS_PASSAGE}`
    const vus = new Set<number>()
    for (const l of attente) {
      if (o.tempsEcoule()) break
      const id = Number(l.demande_id)
      vus.add(id)
      const droit = await droitLiveClub(Number(l.telegram_id))
      const issue = issueDroit(droit.statut)
      if (issue === 'inconnu') { b.inconnus++; continue }
      if (issue === 'depart') {
        if (await marquerDepart(id)) b.departs++
        continue
      }
      await prisma.$executeRaw`update public.cockpit_liveclub_indicateur set droit_verifie_le = now() where demande_id = ${id}`
      const r = await transmettreDemande(id)
      if (r === 'envoye') b.transmises++
      else if (r === 'echec') b.echecs++
      // Aucun relais ne recoit les demandes (Alex coupe, ou colonne indicateur a faux) : la synthese le dit.
      else if (r === 'sans_destinataire') b.etat = 'sans_destinataire'
    }

    // (2) Le droit des demandes ouvertes : sortis par ce passage, puis absents du groupe, puis les plus anciennement relus.
    const ouvertes = await prisma.$queryRaw<{ demande_id: bigint; telegram_id: bigint; present: boolean | null; droit_verifie_le: Date | null; demande_le: Date }[]>`
      select i.demande_id, i.telegram_id, tm.present, i.droit_verifie_le, i.demande_le
      from public.cockpit_liveclub_indicateur i
      left join public.cockpit_telegram_membres tm on tm.telegram_id = i.telegram_id
      where i.depart_le is null
      limit 2000`
    const lignes: LigneAVerifier[] = ouvertes
      .map(l => ({
        demandeId: Number(l.demande_id), telegramId: Number(l.telegram_id), present: l.present,
        droitVerifieLe: l.droit_verifie_le?.toISOString() ?? null, demandeLe: l.demande_le.toISOString(),
      }))
      .filter(l => !vus.has(l.demandeId))
    for (const l of ordreVerification(lignes, { sortis: o.sortis, max: MAX_DROITS_PASSAGE, maintenant })) {
      if (o.tempsEcoule()) break
      const issue = issueDroit((await droitLiveClub(l.telegramId)).statut)
      if (issue === 'depart') {
        if (await marquerDepart(l.demandeId)) b.departs++
        continue
      }
      await prisma.$executeRaw`update public.cockpit_liveclub_indicateur set droit_verifie_le = now() where demande_id = ${l.demandeId}`
      if (issue === 'garde') b.verifies++
      else b.inconnus++
    }

    // (3) Les departs a dire a Alex (ceux de ce passage, et ceux qu'un refus de Telegram a gardes).
    const departs = await prisma.$queryRaw<{ demande_id: bigint }[]>`
      select demande_id from public.cockpit_liveclub_indicateur
      where depart_le is not null and prevenu_depart_le is null
      order by depart_le, demande_id
      limit ${MAX_ENVOIS_PASSAGE}`
    for (const d of departs) {
      const r = await prevenirDepart(Number(d.demande_id))
      if (r === 'envoye') b.prevenus++
      else if (r === 'echec') b.echecs++
      else if (r === 'sans_destinataire') b.etat = 'sans_destinataire'
    }
  } catch (err) {
    if (migrationAbsente(err)) return { ...b, etat: 'table_absente' }
    console.warn(`[liveclub/indicateur] passage interrompu : ${messageErreur(err).slice(0, 200)}`)
    return { ...b, etat: 'panne' }
  }
  console.log(`[liveclub/indicateur] ${b.transmises} transmise(s), ${b.departs} depart(s), ${b.prevenus} prevenu(s), ${b.verifies} droit(s) relu(s), ${b.inconnus} inconnu(s), ${b.echecs} echec(s)`)
  return b
}
