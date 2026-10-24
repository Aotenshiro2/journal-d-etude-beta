// Le RELAIS D'ACCUEIL du Live Club (Brice, 24/10). Les regles pures vivent
// dans relais-pur.ts ; ici, la lecture, la garde, l'envoi et le bouton.
//
// Alex Auger, membre actif, contacte a la place de Brice et Melanie les
// membres qui s'inscrivent sans ecrire ou se taisent. Le BOT DES MEMBRES
// (@aok_liveclub_bot, TELEGRAM_LIVECLUB_BOT_TOKEN), pas Agent AOK (le bot de
// l'equipe, ouvert a tout le cockpit), lui envoie en prive, une fois par jour
// apres le passage du matin, les membres a qui dire un mot. Rien de nouveau =
// rien ne part.
//
// QUI EST RELAIS : cockpit_liveclub_relais (migration 20261024120000), une
// ligne par compte Telegram, ses motifs (accueil, silence : rien d'autre
// possible), actif ou coupe. Ajouter un relais = une ligne en base ; le couper
// = actif a false (aussi depuis le cockpit).
//
// SOURCES : cockpit_membres_risque (motifs accueil et silence seulement, lus
// ainsi en SQL et refiltres en pur), les comptes rattaches et le registre du
// groupe (cockpit_telegram_membres), l'equipe (cockpit_telegram_comptes), les
// exemptions en cours, les marques « fait » (cockpit_actions_traitees), la
// memoire du relais (cockpit_liveclub_relais_episodes), et le statut en
// direct dans le groupe (getChatMember) des membres a transmettre : un admin
// ou un compte sorti depuis la derniere collecte est ecarte. Toute lecture
// manquante = rien n'est envoye (une exclusion illisible pourrait laisser
// passer un compte de l'equipe).
//
// UNE FOIS : par jour (dernier_envoi_jour, reserve par un update atomique
// AVANT l'envoi) et par episode (une ligne par relais et par episode, inseree
// avant l'envoi, envoye_le pose quand le message est parti ; un message
// refuse retire ses lignes, qui repartiront le lendemain). Deux passages
// simultanes n'envoient donc rien deux fois.
//
// LE BOUTON « C'est fait » (rl:<episode_id>) : seulement pour le compte relais
// de l'episode, toujours actif. Il pose la marque dans
// cockpit_actions_traitees (membre_id, motif = cle_episode : la cle de l'ecran
// du cockpit et du resume), donc le cockpit la voit faite et le resume ne la
// reannonce pas. Le bouton n'entre ni au fil Support ni a l'historique de
// l'agent des membres : l'agent IA ne connait pas cette liste.
//
// INTERRUPTEUR : LIVECLUB_RELAIS=0 coupe l'envoi (rien n'est lu ni ecrit). Le
// bouton marche toujours.
//
// Jamais de nom, de pseudo, d'identifiant ni de texte de message dans un log :
// des comptes seulement.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { appelTelegram, envoyer, repondreBouton, statutDansLeGroupe } from './telegram'
import { jourParis } from './passage-regles'
import { messageErreur, relationAbsente } from './pur'
import {
  cleEpisodeRelais, clavierApresFait, decisionBoutonRelais, lignesPourRelais, lireBoutonRelais, messagesRelais,
  motifsDuRelais, noteMarqueRelais, textePresentation,
  TEXTE_BOUTON_DEJA, TEXTE_BOUTON_MARQUE, TEXTE_BOUTON_PANNE, TEXTE_BOUTON_REFUSE,
  type CandidatRelais, type CompteDuMembre, type ExclusionsRelais, type LigneRelais, type RelaisLu,
} from './relais-pur'

export type EtatRelais =
  | 'coupe' | 'table_absente' | 'sans_relais' | 'rien' | 'envoye' | 'echec' | 'deja_fait' | 'panne' | 'apercu'

export type BilanRelais = {
  etat: EtatRelais
  /** Relais actifs lus. */
  relais: number
  /** Membres transmis (ou a transmettre, en apercu). */
  lignes: number
  /** Relais qui ont tout recu. */
  livres: number
  messages: number
  /** En apercu seulement : les messages exacts, par relais (jamais dans la synthese du passage). */
  apercus?: { relais: string; messages: { texte: string; boutons: string[] }[] }[]
}

const bilan = (etat: EtatRelais, extra: Partial<BilanRelais> = {}): BilanRelais =>
  ({ etat, relais: 0, lignes: 0, livres: 0, messages: 0, ...extra })

/** LIVECLUB_RELAIS=0 coupe l'envoi au relais. Absent ou autre valeur : il tourne. */
export function relaisActif(): boolean {
  return process.env.LIVECLUB_RELAIS?.trim() !== '0'
}

/** Au-dela, une ligne reservee mais jamais partie (fonction coupee net) est oubliee : elle repartira. */
const RESERVATION_PERIMEE_MIN = 30
/** Statuts lus en direct au plus, par passage (getChatMember, ~1 par membre a transmettre). */
const MAX_STATUTS_DIRECTS = 60

type Client = Prisma.TransactionClient | typeof prisma

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

type Donnees = {
  relais: RelaisLu[]
  candidats: CandidatRelais[]
  equipe: Set<number>
  exemptes: Set<number>
  traitees: Set<string>
  /** Episodes deja transmis (ou en cours d'envoi), par relais. */
  transmis: Map<number, Set<string>>
}

async function lireDonnees(db: Client, o: { avecReserves: boolean }): Promise<Donnees> {
  const relaisLus = await db.$queryRaw<{ telegram_id: bigint; nom: string; motifs: unknown; presente_le: Date | null }[]>`
    select telegram_id, nom, motifs, presente_le from public.cockpit_liveclub_relais
    where actif order by cree_le, telegram_id`
  const relais: RelaisLu[] = relaisLus
    .map(r => ({ telegramId: Number(r.telegram_id), nom: r.nom, motifs: motifsDuRelais(r.motifs), presenteLe: r.presente_le?.toISOString() ?? null }))
    .filter(r => Number.isSafeInteger(r.telegramId) && r.telegramId > 0 && r.motifs.length > 0)
  if (relais.length === 0) {
    return { relais, candidats: [], equipe: new Set(), exemptes: new Set(), traitees: new Set(), transmis: new Map() }
  }

  // Les deux fenetres du relais, et elles seules : echec et prelevement ne sont jamais lus ici.
  const risque = await db.$queryRaw<{
    membre_id: string; cle_episode: string; motif: string; nom: string | null
    jours_silence: number | null; jours_anciennete: number | null; entree: string | null
  }[]>`
    select membre_id::text as membre_id, cle_episode, motif, nom, jours_silence, jours_anciennete, entree::text as entree
    from public.cockpit_membres_risque
    where motif in ('accueil', 'silence')`
  const ids = [...new Set(risque.map(r => r.membre_id))]
  const comptes = ids.length === 0 ? [] : await db.$queryRaw<{
    membre_id: string; telegram_id: bigint; pseudo: string | null; nom_affiche: string | null; present: boolean | null; statut_tg: string | null
  }[]>`
    select r.membre_id::text as membre_id, r.telegram_id, tm.pseudo, tm.nom_affiche, tm.present, tm.statut_tg
    from public.cockpit_liveclub_rattachements r
    left join public.cockpit_telegram_membres tm on tm.telegram_id = r.telegram_id
    where r.retire_le is null and r.membre_id::text = any(${ids}::text[])
    order by r.lie_le desc`
  const comptesParMembre = new Map<string, CompteDuMembre[]>()
  for (const c of comptes) {
    const liste = comptesParMembre.get(c.membre_id) ?? []
    liste.push({ telegramId: Number(c.telegram_id), pseudo: c.pseudo, nomAffiche: c.nom_affiche, present: c.present === true, statutTg: c.statut_tg })
    comptesParMembre.set(c.membre_id, liste)
  }
  const candidats: CandidatRelais[] = risque.map(r => ({
    membreId: r.membre_id, cleEpisode: r.cle_episode, motif: r.motif,
    joursSilence: r.jours_silence === null ? null : Number(r.jours_silence),
    joursAnciennete: r.jours_anciennete === null ? null : Number(r.jours_anciennete),
    entree: r.entree, nomFiche: r.nom, comptes: comptesParMembre.get(r.membre_id) ?? [],
  }))

  const equipe = await db.$queryRaw<{ telegram_id: bigint }[]>`select telegram_id from public.cockpit_telegram_comptes`
  const exemptes = await db.$queryRaw<{ telegram_id: bigint }[]>`
    select telegram_id from public.cockpit_liveclub_exemptions
    where retire_le is null and (jusquau is null or jusquau >= current_date)`
  const traitees = await db.$queryRaw<{ membre_id: string; motif: string }[]>`
    select membre_id::text as membre_id, motif from public.cockpit_actions_traitees where motif like 'a_risque:%'`
  // La memoire : les episodes partis, plus (hors apercu) ceux reserves par un passage en cours.
  const transmisLus = await db.$queryRaw<{ relais_id: bigint; membre_id: string; cle_episode: string }[]>`
    select relais_id, membre_id::text as membre_id, cle_episode from public.cockpit_liveclub_relais_episodes
    where relais_id::text = any(${relais.map(r => String(r.telegramId))}::text[])
      and (envoye_le is not null or ${o.avecReserves})`
  const transmis = new Map<number, Set<string>>()
  for (const t of transmisLus) {
    const id = Number(t.relais_id)
    const s = transmis.get(id) ?? new Set<string>()
    s.add(cleEpisodeRelais(t.membre_id, t.cle_episode))
    transmis.set(id, s)
  }

  return {
    relais,
    candidats,
    equipe: new Set(equipe.map(e => Number(e.telegram_id))),
    exemptes: new Set(exemptes.map(e => Number(e.telegram_id))),
    traitees: new Set(traitees.map(t => cleEpisodeRelais(t.membre_id, t.motif))),
    transmis,
  }
}

/**
 * Les lignes de chaque relais, avec le statut en direct des comptes a
 * transmettre (un admin, ou un compte sorti depuis la derniere collecte, est
 * ecarte). Statut illisible : le registre decide.
 */
async function lignesParRelais(d: Donnees, o: { enDirect: boolean }): Promise<Map<number, LigneRelais[]>> {
  const excl: ExclusionsRelais = { equipe: d.equipe, exemptes: d.exemptes, relais: new Set(d.relais.map(r => r.telegramId)) }
  const calculer = (e: ExclusionsRelais) => new Map(d.relais.map(r => [r.telegramId, lignesPourRelais(d.candidats, r, e, {
    traitees: d.traitees, dejaTransmis: d.transmis.get(r.telegramId) ?? new Set(),
  })]))
  const premier = calculer(excl)
  if (!o.enDirect) return premier
  const aVerifier = [...new Set([...premier.values()].flat().map(l => l.telegramId))].slice(0, MAX_STATUTS_DIRECTS)
  if (aVerifier.length === 0) return premier
  const statutsDirects = new Map<number, string | null>()
  for (const id of aVerifier) statutsDirects.set(id, await statutDansLeGroupe(id))
  return calculer({ ...excl, statutsDirects })
}

// ---------------------------------------------------------------------------
// L'envoi du jour
// ---------------------------------------------------------------------------

type IssueRelais = { etat: 'rien' | 'deja_fait' | 'envoye' | 'echec'; lignes: number; messages: number }

async function envoyerAuRelais(r: RelaisLu, lignes: LigneRelais[], jour: string): Promise<IssueRelais> {
  if (lignes.length === 0) return { etat: 'rien', lignes: 0, messages: 0 }

  // 1. Le jour, reserve AVANT tout envoi : un rejeu ou un second passage ne renvoie rien.
  const reserve = await prisma.$executeRaw`
    update public.cockpit_liveclub_relais set dernier_envoi_jour = ${jour}::date
    where telegram_id = ${r.telegramId} and actif and dernier_envoi_jour is distinct from ${jour}::date`
  if (reserve === 0) return { etat: 'deja_fait', lignes: 0, messages: 0 }

  // 2. Les episodes, reserves aussi : seules les lignes inserees ici partent.
  const inseres = await prisma.$queryRaw<{ episode_id: bigint; membre_id: string; cle_episode: string }[]>`
    insert into public.cockpit_liveclub_relais_episodes (relais_id, membre_id, cle_episode, motif)
    select ${r.telegramId}, x.membre_id::uuid, x.cle_episode, x.motif
    from unnest(${lignes.map(l => l.membreId)}::text[], ${lignes.map(l => l.cleEpisode)}::text[], ${lignes.map(l => l.motif)}::text[])
      as x(membre_id, cle_episode, motif)
    on conflict (relais_id, membre_id, cle_episode) do nothing
    returning episode_id, membre_id::text as membre_id, cle_episode`
  const idParCle = new Map(inseres.map(i => [cleEpisodeRelais(i.membre_id, i.cle_episode), Number(i.episode_id)]))
  const aEnvoyer = lignes.flatMap(l => {
    const episodeId = idParCle.get(cleEpisodeRelais(l.membreId, l.cleEpisode))
    return episodeId ? [{ ...l, episodeId }] : []
  })
  if (aEnvoyer.length === 0) return { etat: 'rien', lignes: 0, messages: 0 }

  // 3. Les messages : presentation en tete du tout premier.
  const messages = messagesRelais(aEnvoyer, { presentation: r.presenteLe ? null : textePresentation(r.nom) })
  let partis = 0
  let lignesParties = 0
  for (const [i, m] of messages.entries()) {
    const envoi = await envoyer(r.telegramId, m.texte, m.boutons, { html: true })
    if (!envoi.ok) {
      // Refuse (bot bloque, chat introuvable, panne) : les lignes non parties
      // sont retirees, elles repartiront le lendemain.
      console.warn(`[liveclub/relais] message ${i + 1}/${messages.length} refuse (code ${envoi.code ?? '?'})`)
      const restants = messages.slice(i).flatMap(x => x.episodes)
      try {
        await prisma.$executeRaw`
          delete from public.cockpit_liveclub_relais_episodes
          where episode_id = any(${restants}::bigint[]) and envoye_le is null`
      } catch (err) {
        console.warn(`[liveclub/relais] lignes non parties pas retirees : ${messageErreur(err).slice(0, 160)}`)
      }
      break
    }
    partis++
    lignesParties += m.episodes.length
    await prisma.$executeRaw`
      update public.cockpit_liveclub_relais_episodes set envoye_le = now()
      where episode_id = any(${m.episodes}::bigint[])`
    if (i === 0 && !r.presenteLe) {
      await prisma.$executeRaw`
        update public.cockpit_liveclub_relais set presente_le = now()
        where telegram_id = ${r.telegramId} and presente_le is null`
    }
  }
  return { etat: partis === messages.length ? 'envoye' : 'echec', lignes: lignesParties, messages: partis }
}

/**
 * L'envoi du jour aux relais. Ne jette pas : une panne rend un bilan 'panne'
 * (rien n'est envoye). Le passage l'appelle AVANT le resume du matin, pour
 * que le resume sache ce qui est deja transmis (« (Alex s'en occupe) »).
 *
 * `apercu` : compose les messages exacts et les rend (bilan.apercus) SANS
 * rien ecrire ni envoyer, lectures dans une transaction READ ONLY, sans la
 * garde du jour ni l'interrupteur. `enDirect` (defaut : vrai) : relit en
 * direct le statut dans le groupe des membres a transmettre (getChatMember,
 * une lecture, aucun message).
 */
export async function relaisDuMatin(o: { maintenant?: Date; apercu?: boolean; enDirect?: boolean } = {}): Promise<BilanRelais> {
  const apercu = o.apercu === true
  if (!apercu && !relaisActif()) return bilan('coupe')
  const jour = jourParis((o.maintenant ?? new Date()).toISOString())
  const enDirect = o.enDirect !== false

  if (apercu) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('set transaction read only')
        return apercuRelais(tx, { enDirect })
      }, { timeout: 60_000 })
    } catch (err) {
      if (relationAbsente(err)) return bilan('table_absente')
      console.warn(`[liveclub/relais] apercu impossible : ${messageErreur(err).slice(0, 200)}`)
      return bilan('panne')
    }
  }

  let donnees: Donnees
  try {
    // Les reservations d'un passage coupe net, jamais parties : oubliees.
    await prisma.$executeRaw`
      delete from public.cockpit_liveclub_relais_episodes
      where envoye_le is null and annonce_le < now() - make_interval(mins => ${RESERVATION_PERIMEE_MIN}::int)`
    donnees = await lireDonnees(prisma, { avecReserves: true })
  } catch (err) {
    if (relationAbsente(err)) {
      console.warn('[liveclub/relais] tables du relais absentes (migration 20261024120000) : aucun envoi')
      return bilan('table_absente')
    }
    console.warn(`[liveclub/relais] lecture impossible, aucun envoi : ${messageErreur(err).slice(0, 200)}`)
    return bilan('panne')
  }
  if (donnees.relais.length === 0) return bilan('sans_relais')

  let lignes: Map<number, LigneRelais[]>
  try {
    lignes = await lignesParRelais(donnees, { enDirect })
  } catch (err) {
    console.warn(`[liveclub/relais] tri impossible, aucun envoi : ${messageErreur(err).slice(0, 200)}`)
    return bilan('panne', { relais: donnees.relais.length })
  }

  const issues: IssueRelais[] = []
  for (const r of donnees.relais) {
    try {
      issues.push(await envoyerAuRelais(r, lignes.get(r.telegramId) ?? [], jour))
    } catch (err) {
      console.warn(`[liveclub/relais] envoi a un relais impossible : ${messageErreur(err).slice(0, 200)}`)
      issues.push({ etat: 'echec', lignes: 0, messages: 0 })
    }
  }
  const etat: EtatRelais = issues.some(i => i.etat === 'envoye') ? 'envoye'
    : issues.some(i => i.etat === 'echec') ? 'echec'
    : issues.some(i => i.etat === 'deja_fait') ? 'deja_fait' : 'rien'
  const b = bilan(etat, {
    relais: donnees.relais.length,
    lignes: issues.reduce((n, i) => n + i.lignes, 0),
    livres: issues.filter(i => i.etat === 'envoye').length,
    messages: issues.reduce((n, i) => n + i.messages, 0),
  })
  console.log(`[liveclub/relais] ${etat} : ${b.lignes} membre(s), ${b.messages} message(s), ${b.livres}/${b.relais} relais`)
  return b
}

/**
 * Les messages exacts que chaque relais recevrait maintenant, sans rien
 * ecrire ni envoyer, lus avec le client `db` deja ouvert : la transaction
 * READ ONLY de relaisDuMatin({ apercu }), ou la transaction annulee d'un
 * essai de migration (scripts/essayer-migration-relais.mjs). Les numeros
 * d'episode des boutons sont fictifs. Jette sur une panne de lecture.
 */
export async function apercuRelais(db: Client, o: { enDirect?: boolean } = {}): Promise<BilanRelais> {
  const donnees = await lireDonnees(db, { avecReserves: false })
  if (donnees.relais.length === 0) return bilan('sans_relais')
  const lignes = await lignesParRelais(donnees, { enDirect: o.enDirect !== false })
  const apercus = donnees.relais.map(r => {
    const siennes = (lignes.get(r.telegramId) ?? []).map((l, i) => ({ ...l, episodeId: i + 1 }))
    const messages = messagesRelais(siennes, { presentation: r.presenteLe ? null : textePresentation(r.nom) })
    return { relais: r.nom, messages: messages.map(m => ({ texte: m.texte, boutons: m.boutons.flat().map(b => b.texte) })) }
  })
  return bilan('apercu', {
    relais: donnees.relais.length,
    lignes: [...lignes.values()].reduce((n, l) => n + l.length, 0),
    messages: apercus.reduce((n, a) => n + a.messages.length, 0),
    apercus,
  })
}

// ---------------------------------------------------------------------------
// Les questions du relais a l'agent (Brice, 24/10)
// ---------------------------------------------------------------------------

/** Le compte qui ecrit est-il un relais actif ? Table absente ou panne : non (l'agent reste celui d'un membre). */
export async function estRelaisActif(telegramId: number, db: Client = prisma): Promise<boolean> {
  try {
    const r = await db.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from public.cockpit_liveclub_relais where telegram_id = ${telegramId} and actif`
    return (r[0]?.n ?? 0) > 0
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[liveclub/relais] statut de relais illisible : ${messageErreur(err).slice(0, 160)}`)
    return false
  }
}

const normaliser = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^@/, '').trim().toLowerCase()
const jourFr = (d: Date | null) => d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }) : null
const joursDepuis = (d: Date | null) => d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000)) : null

/**
 * L'outil membre_a_contacter : les faits utiles sur un membre DEJA TRANSMIS a
 * ce relais (et a lui seul), jamais le contenu d'un message, un email, un
 * paiement ou un abonnement. Recherche vide : la liste des membres transmis.
 * Ne jette pas.
 */
export async function ficheMembrePourRelais(relaisId: number, entree: unknown, db: Client = prisma): Promise<Record<string, unknown>> {
  const recherche = normaliser(typeof (entree as { recherche?: unknown })?.recherche === 'string' ? (entree as { recherche: string }).recherche : '')
  try {
    if (!(await estRelaisActif(relaisId, db))) return { erreur: "Tu n'es pas relais d'accueil : je n'ai rien sur les autres membres." }
    const transmis = await db.$queryRaw<{ membre_id: string; nom: string | null; date_entree: Date | null; transmis_le: Date; fait: boolean }[]>`
      select e.membre_id::text as membre_id, m.nom, m.date_entree, max(e.envoye_le) as transmis_le, bool_or(e.fait_le is not null) as fait
      from public.cockpit_liveclub_relais_episodes e
      join public.cockpit_membres m on m.membre_id = e.membre_id
      where e.relais_id = ${relaisId} and e.envoye_le is not null
      group by e.membre_id, m.nom, m.date_entree`
    if (transmis.length === 0) return { resultat: "Aucun membre ne t'a encore été transmis." }
    const ids = transmis.map(t => t.membre_id)
    const comptes = await db.$queryRaw<{ membre_id: string; telegram_id: bigint; pseudo: string | null; nom_affiche: string | null; entre_le: Date | null; present: boolean | null }[]>`
      select r.membre_id::text as membre_id, r.telegram_id, tm.pseudo, tm.nom_affiche, tm.entre_le, tm.present
      from public.cockpit_liveclub_rattachements r
      left join public.cockpit_telegram_membres tm on tm.telegram_id = r.telegram_id
      where r.retire_le is null and r.membre_id::text = any(${ids}::text[])`
    const fiches = transmis.map(t => {
      const cs = comptes.filter(c => c.membre_id === t.membre_id)
      const principal = cs.find(c => c.present) ?? cs[0]
      return { ...t, comptes: cs, nomTg: principal?.nom_affiche ?? t.nom ?? 'Membre sans nom', pseudo: principal?.pseudo ?? null }
    })
    if (!recherche) {
      return { membres_transmis: fiches.map(f => ({ prenom_nom: f.nom, nom_telegram: f.nomTg, pseudo: f.pseudo ? `@${f.pseudo}` : null, deja_fait: f.fait })) }
    }
    const trouves = fiches.filter(f => [f.nomTg, f.pseudo, f.nom].some(v => normaliser(v) && (normaliser(v).includes(recherche) || recherche.includes(normaliser(v))))).slice(0, 3)
    if (trouves.length === 0) return { resultat: "Ce membre n'est pas dans ta liste : je n'ai que les membres qu'on t'a transmis.", membres_transmis: fiches.map(f => f.nomTg) }

    const sortie = []
    for (const f of trouves) {
      const tgIds = f.comptes.map(c => String(c.telegram_id))
      const [msg] = tgIds.length === 0 ? [null] : await db.$queryRaw<{ total: number; premier: Date | null; dernier: Date | null; trente: number }[]>`
        select count(*)::int as total, min(dit_le) as premier, max(dit_le) as dernier,
          count(*) filter (where dit_le > now() - interval '30 days')::int as trente
        from public.cockpit_telegram_messages where telegram_id::text = any(${tgIds}::text[])`
      // L'academie : par l'email du rattachement, relie au compte du site. Seulement des comptes, jamais l'email.
      const [aca] = await db.$queryRaw<{ commencees: number; terminees: number; derniere: Date | null }[]>`
        select count(*)::int as commencees,
          count(*) filter (where p.terminee_le is not null or p.vu_le is not null)::int as terminees,
          max(p.derniere_vue_le) as derniere
        from public.academie_progression p
        where p.user_id in (
          select u.id from auth.users u join public.cockpit_liveclub_rattachements r on lower(u.email) = lower(r.email)
          where r.membre_id = ${f.membre_id}::uuid and r.email is not null)`
      const entreGroupe = f.comptes.map(c => c.entre_le).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null
      sortie.push({
        prenom_nom: f.nom,
        nom_telegram: f.nomTg,
        pseudo: f.pseudo ? `@${f.pseudo}` : null,
        membre_du_live_club_depuis: jourFr(f.date_entree),
        arrive_dans_le_groupe_telegram: jourFr(entreGroupe),
        jours_dans_le_groupe: joursDepuis(entreGroupe),
        messages_dans_le_groupe: msg?.total ?? 0,
        premier_message: jourFr(msg?.premier ?? null),
        dernier_message: jourFr(msg?.dernier ?? null),
        jours_depuis_dernier_message: joursDepuis(msg?.dernier ?? null),
        messages_des_30_derniers_jours: msg?.trente ?? 0,
        academie: aca && aca.commencees > 0
          ? { lecons_commencees: aca.commencees, lecons_terminees: aca.terminees, derniere_lecon_regardee: jourFr(aca.derniere) }
          : "aucune leçon regardée dans l'académie (ou compte du site non relié)",
        deja_marque_fait: f.fait,
      })
    }
    return { membres: sortie, consigne: "Faits seulement : ni contenu de message, ni email, ni paiement. Les replays du groupe Telegram ne sont pas mesurés, seulement l'académie du site." }
  } catch (err) {
    console.warn(`[liveclub/relais] fiche illisible : ${messageErreur(err).slice(0, 160)}`)
    return { erreur: 'Lecture impossible pour le moment, réessaie plus tard.' }
  }
}

// ---------------------------------------------------------------------------
// Le bouton « C'est fait »
// ---------------------------------------------------------------------------

type ClavierRecu = { inline_keyboard?: unknown }
export type BoutonRelaisTg = { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number }; reply_markup?: ClavierRecu } }

/**
 * Un appui sur « C'est fait » (data rl:<episode_id>). Appele par le bot des
 * membres AVANT tout le reste (ni fil Support, ni historique de l'agent).
 * Toujours answerCallbackQuery. Ne jette pas.
 */
export async function traiterBoutonRelais(bouton: BoutonRelaisTg): Promise<void> {
  const data = bouton.data ?? ''
  const episodeId = lireBoutonRelais(data)
  if (!episodeId) {
    await repondreBouton(bouton.id, TEXTE_BOUTON_REFUSE)
    return
  }
  let decision: ReturnType<typeof decisionBoutonRelais>
  try {
    decision = await prisma.$transaction(async (tx) => {
      // Verrou de la ligne : deux appuis simultanes ne marquent qu'une fois.
      const lignes = await tx.$queryRaw<{ relais_id: bigint; membre_id: string; cle_episode: string; envoye: boolean; fait: boolean; actif: boolean; nom: string }[]>`
        select e.relais_id, e.membre_id::text as membre_id, e.cle_episode, e.envoye_le is not null as envoye,
          e.fait_le is not null as fait, r.actif, r.nom
        from public.cockpit_liveclub_relais_episodes e
        join public.cockpit_liveclub_relais r on r.telegram_id = e.relais_id
        where e.episode_id = ${episodeId}
        for update of e`
      const l = lignes[0]
      const d = decisionBoutonRelais(bouton.from.id, l
        ? { relaisId: Number(l.relais_id), envoye: l.envoye, fait: l.fait, relaisActif: l.actif }
        : null)
      if (d !== 'marquer' || !l) return d
      await tx.$executeRaw`
        insert into public.cockpit_actions_traitees (membre_id, motif, traite_par, traite_par_telegram, note)
        values (${l.membre_id}::uuid, ${l.cle_episode}, null, ${bouton.from.id}, ${noteMarqueRelais(l.nom)})
        on conflict (membre_id, motif) do nothing`
      await tx.$executeRaw`
        update public.cockpit_liveclub_relais_episodes set fait_le = now() where episode_id = ${episodeId}`
      return d
    })
  } catch (err) {
    console.warn(`[liveclub/relais] bouton non traite : ${messageErreur(err).slice(0, 160)}`)
    await repondreBouton(bouton.id, relationAbsente(err) ? TEXTE_BOUTON_REFUSE : TEXTE_BOUTON_PANNE)
    return
  }

  if (decision === 'refuse') {
    await repondreBouton(bouton.id, TEXTE_BOUTON_REFUSE)
    return
  }
  await repondreBouton(bouton.id, decision === 'marquer' ? TEXTE_BOUTON_MARQUE : TEXTE_BOUTON_DEJA)
  // Le bouton appuye devient « Fait : ... » (best effort : le marquage est deja fait).
  const m = bouton.message
  const clavier = m ? clavierApresFait(m.reply_markup, data) : null
  if (m && clavier) {
    const r = await appelTelegram('editMessageReplyMarkup', { chat_id: m.chat.id, message_id: m.message_id, reply_markup: { inline_keyboard: clavier } })
    if (!r.ok && !/not modified/i.test(r.erreur)) console.warn(`[liveclub/relais] clavier non mis a jour (code ${r.code ?? '?'})`)
  }
}
