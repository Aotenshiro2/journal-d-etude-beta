// Le RESUME DU MATIN du Live Club (Brice, 15/10). Apres le passage quotidien
// (passage.ts, cron de 7 h UTC), Agent AOK (le bot du cockpit,
// TELEGRAM_BOT_TOKEN_COCKPIT) envoie EN PRIVE a l'equipe de
// cockpit_telegram_comptes (Brice et Melanie, personne d'autre) ce qui a
// bouge depuis le dernier resume envoye : des NOMS, pas des nombres. Rien ne
// part s'il ne s'est rien passe.
//
// SOURCES
// - le journal du bot (cockpit_liveclub_gestes), en premier : entrees,
//   sorties, pauses, arrets, impayes, adresses rattachees, et (15/10) les
//   comptes Telegram changes en libre-service ou en conflit (geste
//   compte_telegram, deja signales sur le moment par une alerte) ;
// - Stripe, en lecture : les nouveaux abonnes (abonnements crees sur un
//   produit Live Club), et ce que le membre fait SEUL dans le portail Stripe
//   (ou l'equipe au Dashboard), qui n'est pas dans le journal. CHOIX : une
//   COMPARAISON D'ETAT plutot que les events Stripe. Chaque resume garde un
//   instantane sans donnee personnelle ({ sub_id: statut|arret|pause }), le
//   suivant compare. Raisons : la cle de lecture n'a peut-etre pas le droit
//   « Events » (non verifiable sans elle), les events ne vivent que 30 jours,
//   et la comparaison ne depend que de la liste deja lue par le passage. Prix :
//   le premier resume ne voit pas ces changements (pas d'instantane avant), et
//   un aller-retour dans la meme journee ne se voit pas ;
// - les tables du cockpit : acces broker, exemptions, tarifs reserves poses
//   ou payes, demandes d'humain en attente (SupportThread), demandes de
//   l'equipe (cockpit_demandes) ;
// - (18/10) les membres A CONTACTER (cockpit_membres_risque) dont une fenetre
//   s'est ouverte depuis le dernier resume : la memoire des episodes deja
//   annonces vit a cote de l'instantane Stripe (risque_annonces, migration
//   20261018220000), et un episode marque « fait » au cockpit
//   (cockpit_actions_traitees) n'est pas annonce. Ce bloc suffit a faire
//   partir le resume. En pied, le nombre de ceux qui entrent dans une fenetre
//   sous 7 jours (cockpit_membres_a_venir), jamais envoye pour lui seul.
//   (24/10) Un episode deja transmis a un relais d'accueil (relais.ts) reste
//   dans la liste, marque « (Alex s'en occupe) » ; son « C'est fait » le
//   marque dans cockpit_actions_traitees comme l'ecran du cockpit.
//
// UNE FOIS PAR JOUR : table cockpit_liveclub_resumes (migration
// 20261015120000), une ligne par jour de Paris (cle primaire), reservee AVANT
// l'envoi. Un cron rejoue, ou lance a la main, ne renvoie rien. Table absente
// = aucun resume (jamais deux plutot qu'un de trop).
//
// INTERRUPTEUR : LIVECLUB_DIGEST=0 coupe le resume (rien n'est lu ni ecrit).
//
// Le resume entre aussi dans l'historique de leur conversation avec l'agent
// (cockpit_agent_conversations), precede d'une ligne « [système] » (voir
// MARQUEUR_RESUME_HISTORIQUE) : une question posee juste en dessous s'y
// rapporte. Jamais de nom, d'email ni de texte de message dans un log : des
// comptes seulement.

import { prisma } from '@/lib/db'
import { stripeGet } from '@/lib/stripe-actions'
import { ajouterAHistoriqueAgent, tgCockpit } from '@/lib/agent-cockpit-telegram'
import { cleStripeLecture } from './config'
import { listerAbonnementsLiveClub, type AbonnementResume } from './stripe'
import { formaterMontant, libelleTarifReserve, messageErreur, normaliserEmail, parPeriode, relationAbsente } from './pur'
import { jourParis } from './passage-regles'
import { phraseAdresse } from './adresses-pur'
import { idsDuDetail, libelleCourt, phraseCompteResume } from './comptes-telegram-pur'

/** Une liste d'identifiants (texte) d'un champ de details, ou rien. */
function idsListe(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
import {
  attentesHorsEquipe, changementsAbonnements, changementsHorsDuBot, cleAnnonce, cleGeste, composerResume, decouperResume,
  detailAccesBroker, detailAContacter, detailAttenteHumain, detailAvecRelais, detailDemande, detailExemption,
  detailNouvelAbonnement, detailRepriseBot, detailTarifReserve, entreesHistoriqueResume, episodesAAnnoncer,
  estNouvelAbonnement, evenementDeChangement, evenementDeGeste, instantaneAbonnements, memoireAnnonces, pseudoCroise, relaisParEpisode,
  texteSur,
  type EvenementResume, type GesteResume, type MembreAContacter, type MotifContact, type Personne,
} from './resume-pur'
import { repriseAutomatique } from './support-pont-pur'

/** La fenetre ne remonte jamais plus loin (apres une coupure, un long silence). */
const FENETRE_MAX_MS = 7 * 86_400_000
/** Clients Stripe lus pour les noms et emails, au plus, par resume. */
const MAX_CLIENTS_STRIPE = 40

export type EtatResume =
  | 'coupe' | 'deja_fait' | 'rien' | 'premier_repere' | 'envoye' | 'echec' | 'sans_destinataire' | 'table_absente' | 'panne'
  | 'apercu'

export type BilanResume = {
  etat: EtatResume; lignes: number; destinataires: number; livres: number; messages: number
  /** Le texte compose, en mode apercu seulement (jamais dans la synthese du passage). */
  texte?: string | null
}

/** LIVECLUB_DIGEST=0 coupe le resume (Brice, 15/10). Absent ou autre valeur : il tourne. */
export function resumeActif(): boolean {
  return process.env.LIVECLUB_DIGEST?.trim() !== '0'
}

const bilan = (etat: EtatResume, extra: Partial<BilanResume> = {}): BilanResume =>
  ({ etat, lignes: 0, destinataires: 0, livres: 0, messages: 0, ...extra })

type Repere = { jusqua: Date; etat: Record<string, string> | null; annonces: string[] | null }

/** Le dernier resume qui fait repere (envoye, ou premier instantane). Jette (table absente comprise). */
async function dernierRepere(): Promise<Repere | null> {
  const lignes = await prisma.$queryRaw<{ jusqua: Date; etat_abonnements: unknown; risque_annonces: unknown }[]>`
    select jusqua, etat_abonnements, risque_annonces from public.cockpit_liveclub_resumes
    where statut in ('repere', 'envoye')
    order by jusqua desc limit 1`
  const l = lignes[0]
  if (!l) return null
  const etat = l.etat_abonnements && typeof l.etat_abonnements === 'object' && !Array.isArray(l.etat_abonnements)
    ? l.etat_abonnements as Record<string, string> : null
  const annonces = Array.isArray(l.risque_annonces) ? l.risque_annonces.filter((x): x is string => typeof x === 'string') : null
  return { jusqua: l.jusqua, etat: etat && Object.keys(etat).length > 0 ? etat : null, annonces }
}

/** Reserve la ligne du jour. false = deja la (un autre passage, ou un rejeu). Jette sur une panne. */
async function reserverJour(o: {
  jour: string; depuis: Date; jusqua: Date; statut: 'en_cours' | 'repere'; etat: Record<string, string> | null; annonces: string[] | null
}): Promise<boolean> {
  const n = await prisma.$executeRaw`
    insert into public.cockpit_liveclub_resumes (jour, depuis, jusqua, statut, etat_abonnements, risque_annonces)
    values (${o.jour}::date, ${o.depuis}, ${o.jusqua}, ${o.statut}, ${JSON.stringify(o.etat ?? {})}::jsonb,
      ${o.annonces === null ? null : JSON.stringify(o.annonces)}::jsonb)
    on conflict (jour) do nothing`
  return n > 0
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

type LigneGeste = Omit<GesteResume, 'id' | 'telegram_id' | 'fait_le'> & { geste_id: bigint; telegram_id: bigint | null; fait_le: Date }

async function lireGestes(depuis: Date, jusqua: Date): Promise<GesteResume[]> {
  const lignes = await prisma.$queryRaw<LigneGeste[]>`
    select geste_id, geste, resultat, regle, details, fait_le, telegram_id, membre_id::text as membre_id, abonnement_id
    from public.cockpit_liveclub_gestes
    where fait_le > ${depuis} and fait_le <= ${jusqua}
      and (resultat = 'fait' or (geste in ('adresse', 'compte_telegram') and resultat in ('refuse', 'echec')))
    order by fait_le
    limit 2000`
  return lignes.map(l => ({
    id: String(l.geste_id), geste: l.geste, resultat: l.resultat, regle: l.regle, details: l.details,
    fait_le: l.fait_le.toISOString(), telegram_id: l.telegram_id === null ? null : Number(l.telegram_id),
    membre_id: l.membre_id, abonnement_id: l.abonnement_id,
  }))
}

/** Une lecture facultative : table absente ou panne = liste vide, et un code dans les erreurs. */
async function facultatif<T>(code: string, erreurs: string[], f: () => Promise<T[]>): Promise<T[]> {
  try {
    return await f()
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[liveclub/resume] ${code} illisible : ${messageErreur(err)}`)
    erreurs.push(code)
    return []
  }
}

// ---------------------------------------------------------------------------
// Les personnes : nom, email, @pseudo, ce qu'on en sait
// ---------------------------------------------------------------------------

class Annuaire {
  readonly personnes = new Map<string, Personne>()
  private clientsLus = 0
  private clients = new Map<string, { nom: string | null; email: string | null } | null>()

  completer(cle: string, p: Partial<Personne>) {
    const a = this.personnes.get(cle) ?? { nom: null, email: null, pseudo: null, telegramId: null }
    this.personnes.set(cle, {
      nom: a.nom ?? texteSur(p.nom) ?? null,
      email: a.email ?? (p.email ? normaliserEmail(p.email) : null),
      pseudo: a.pseudo ?? texteSur(p.pseudo, 40)?.replace(/^@+/, '') ?? null,
      telegramId: a.telegramId ?? p.telegramId ?? null,
    })
  }

  /** Le nom et l'email d'un client Stripe (cus_...), lus une fois. null = inconnu ou illisible. */
  async client(id: string | null | undefined): Promise<{ nom: string | null; email: string | null } | null> {
    if (!id || !/^cus_[A-Za-z0-9]+$/.test(id)) return null
    if (this.clients.has(id)) return this.clients.get(id) ?? null
    const cle = cleStripeLecture()
    if (!cle || this.clientsLus >= MAX_CLIENTS_STRIPE) return null
    this.clientsLus++
    try {
      const c = await stripeGet(cle, `/v1/customers/${id}`)
      const lu = c.deleted === true ? null : { nom: typeof c.name === 'string' ? c.name : null, email: typeof c.email === 'string' ? c.email : null }
      this.clients.set(id, lu)
      return lu
    } catch (err) {
      console.warn(`[liveclub/resume] client Stripe illisible : ${messageErreur(err).slice(0, 120)}`)
      this.clients.set(id, null)
      return null
    }
  }
}

/**
 * Complete l'annuaire pour toutes les cles des evenements : t<telegram>,
 * m<membre>, s<abonnement>, e<email>, p<profil>. Chaque lecture est
 * facultative : on dit ce qu'on a.
 */
async function resoudre(annuaire: Annuaire, cles: Set<string>, abonnements: Map<string, AbonnementResume>, erreurs: string[]) {
  const de = (prefixe: string) => [...cles].filter(c => c.startsWith(prefixe)).map(c => c.slice(prefixe.length))
  const telegrams = de('t').map(Number).filter(n => Number.isSafeInteger(n))
  const membres = new Set(de('m'))
  const emails = new Set(de('e'))
  const profils = de('p').filter(p => /^[0-9a-f-]{36}$/i.test(p))

  // Abonnements : le client Stripe, son nom et son email ; puis son compte Telegram.
  const clientsParCle = new Map<string, string>()
  for (const sub of de('s')) {
    const client = abonnements.get(sub)?.clientStripe ?? null
    if (!client) continue
    clientsParCle.set(`s${sub}`, client)
    const c = await annuaire.client(client)
    if (c) annuaire.completer(`s${sub}`, c)
  }

  // Comptes Telegram : pseudo et nom affiche, puis le payeur rattache.
  const clientsListe = [...new Set(clientsParCle.values())]
  const telegramsDesClients = clientsListe.length === 0 ? [] : await facultatif('rattachements_clients', erreurs, () => prisma.$queryRaw<{ client_stripe: string; telegram_id: bigint }[]>`
    select client_stripe, telegram_id from public.cockpit_liveclub_rattachements
    where retire_le is null and client_stripe = any(${clientsListe}::text[])`)
  const tgParClient = new Map(telegramsDesClients.map(r => [r.client_stripe, Number(r.telegram_id)]))
  for (const [cle, client] of clientsParCle) {
    const tid = tgParClient.get(client)
    if (tid) annuaire.completer(cle, { telegramId: tid })
  }

  // Adresses connues sans compte Telegram : leur rattachement eventuel.
  const emailsListe = [...emails]
  const telegramsDesEmails = emailsListe.length === 0 ? [] : await facultatif('rattachements_emails', erreurs, () => prisma.$queryRaw<{ email: string; telegram_id: bigint }[]>`
    select lower(email) as email, telegram_id from public.cockpit_liveclub_rattachements
    where retire_le is null and lower(email) = any(${emailsListe}::text[])`)
  for (const r of telegramsDesEmails) annuaire.completer(`e${r.email}`, { telegramId: Number(r.telegram_id), email: r.email })

  const tousTelegrams = [...new Set([
    ...telegrams,
    ...[...annuaire.personnes.values()].map(p => p.telegramId).filter((t): t is number => typeof t === 'number'),
  ])]
  const tg = tousTelegrams.length === 0 ? [] : await facultatif('telegram_membres', erreurs, () => prisma.$queryRaw<{ telegram_id: bigint; pseudo: string | null; nom_affiche: string | null }[]>`
    select telegram_id, pseudo, nom_affiche from public.cockpit_telegram_membres
    where telegram_id::text = any(${tousTelegrams.map(String)}::text[])`)
  const tgParId = new Map(tg.map(r => [Number(r.telegram_id), r]))
  const rattachements = telegrams.length === 0 ? [] : await facultatif('rattachements', erreurs, () => prisma.$queryRaw<{ telegram_id: bigint; email: string | null; membre_id: string | null; client_stripe: string | null }[]>`
    select telegram_id, email, membre_id::text as membre_id, client_stripe from public.cockpit_liveclub_rattachements
    where retire_le is null and telegram_id::text = any(${telegrams.map(String)}::text[])`)
  const membreDuTelegram = new Map<number, string>()
  for (const r of rattachements) {
    const tid = Number(r.telegram_id)
    annuaire.completer(`t${tid}`, { email: r.email })
    if (r.membre_id) { membreDuTelegram.set(tid, r.membre_id); membres.add(r.membre_id) }
    if (!r.email && r.client_stripe) {
      const c = await annuaire.client(r.client_stripe)
      if (c) annuaire.completer(`t${tid}`, c)
    }
  }

  // Fiches du cockpit : le nom, l'email principal ; et la fiche des adresses connues.
  const fichesDesEmails = emailsListe.length === 0 ? [] : await facultatif('fiches_emails', erreurs, () => prisma.$queryRaw<{ email: string; membre_id: string }[]>`
    select email, membre_id::text as membre_id from public.cockpit_membre_emails where email = any(${emailsListe}::text[])`)
  for (const f of fichesDesEmails) membres.add(f.membre_id)
  const membresListe = [...membres].filter(m => /^[0-9a-f-]{36}$/i.test(m))
  const fiches = membresListe.length === 0 ? [] : await facultatif('fiches', erreurs, () => prisma.$queryRaw<{ membre_id: string; nom: string | null; prenom: string | null; telegram: string | null; email: string | null }[]>`
    select m.membre_id::text as membre_id, m.nom, m.prenom, m.telegram,
      (select e.email from public.cockpit_membre_emails e where e.membre_id = m.membre_id order by e.principal desc, e.vu_le limit 1) as email
    from public.cockpit_membres m where m.membre_id::text = any(${membresListe}::text[])`)
  const ficheParId = new Map(fiches.map(f => [f.membre_id, f]))
  const deFiche = (f: { nom: string | null; prenom: string | null; telegram: string | null; email: string | null } | undefined): Partial<Personne> =>
    f ? { nom: f.nom || f.prenom, email: f.email, pseudo: f.telegram } : {}

  for (const m of de('m')) annuaire.completer(`m${m}`, deFiche(ficheParId.get(m)))
  for (const f of fichesDesEmails) annuaire.completer(`e${f.email}`, { nom: deFiche(ficheParId.get(f.membre_id)).nom ?? null })
  for (const tid of tousTelegrams) {
    const t = tgParId.get(tid)
    const fiche = deFiche(ficheParId.get(membreDuTelegram.get(tid) ?? ''))
    annuaire.completer(`t${tid}`, { telegramId: tid, nom: fiche.nom ?? null, email: fiche.email ?? null })
    if (t) annuaire.completer(`t${tid}`, { pseudo: t.pseudo, nom: t.nom_affiche })
  }
  // Pseudo et nom des cles qui ont trouve un compte Telegram en route.
  for (const [cle, p] of annuaire.personnes) {
    const t = p.telegramId ? tgParId.get(p.telegramId) : undefined
    if (t) annuaire.completer(cle, { pseudo: t.pseudo, nom: t.nom_affiche })
  }

  // Comptes AOK (support du site) : nom et adresse principale.
  if (profils.length > 0) {
    const comptes = await facultatif('profils', erreurs, () => prisma.$queryRaw<{ id: string; nom: string | null; email: string | null }[]>`
      select p.id::text as id, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as nom,
        (select pe.email from public.profile_emails pe where pe.profile_id = p.id order by pe.is_primary desc, pe.created_at limit 1) as email
      from public.profiles p where p.id::text = any(${profils}::text[])`)
    for (const c of comptes) annuaire.completer(`p${c.id}`, { nom: c.nom, email: c.email })
  }
}

// ---------------------------------------------------------------------------
// Le resume
// ---------------------------------------------------------------------------

/** Le montant d'un abonnement, « 139 € par mois ». */
function montantAbonnement(a: AbonnementResume): string | null {
  if (!a.montantPeriode) return null
  return `${formaterMontant(a.montantPeriode.centimes, a.montantPeriode.devise)} ${parPeriode(a.periodicite)}`.trim()
}

/**
 * Le resume du matin : lit, compose, envoie une fois par jour. Ne jette pas :
 * une panne rend un bilan 'panne' (rien n'est envoye, la ligne du jour n'est
 * pas posee, le resume suivant couvrira la periode).
 *
 * `apercu` : compose le texte et le rend (bilan.texte) SANS rien ecrire ni
 * envoyer, sans la garde du jour ni l'interrupteur (verification avant mise
 * en service, en lecture seule : SELECT et lectures Stripe).
 */
export async function resumeDuMatin(o: { maintenant?: Date; apercu?: boolean } = {}): Promise<BilanResume> {
  const apercu = o.apercu === true
  if (!apercu && !resumeActif()) return bilan('coupe')
  const jusqua = o.maintenant ?? new Date()
  const jour = jourParis(jusqua.toISOString())
  const erreurs: string[] = []

  try {
    // 1. Deja fait aujourd'hui ? Puis le repere : depuis quand, et l'instantane d'alors.
    let repere: Repere | null = null
    try {
      const deja = await prisma.$queryRaw<{ n: number }[]>`
        select 1 as n from public.cockpit_liveclub_resumes where jour = ${jour}::date limit 1`
      if (deja.length > 0 && !apercu) return bilan('deja_fait')
      repere = await dernierRepere()
    } catch (err) {
      if (!relationAbsente(err)) throw err
      if (!apercu) {
        console.warn('[liveclub/resume] table cockpit_liveclub_resumes absente (migration 20261015120000) : aucun resume')
        return bilan('table_absente')
      }
    }
    const plancher = new Date(jusqua.getTime() - FENETRE_MAX_MS)
    const depuis = repere ? (repere.jusqua > plancher ? repere.jusqua : plancher) : new Date(jusqua.getTime() - 86_400_000)

    // 2. Stripe : une lecture fraiche (le passage vient peut-etre de resilier).
    let abonnements: AbonnementResume[] | null = null
    try {
      abonnements = await listerAbonnementsLiveClub({ statut: 'all' })
    } catch (err) {
      console.warn(`[liveclub/resume] Stripe illisible, rubriques Stripe omises : ${messageErreur(err).slice(0, 160)}`)
      erreurs.push('stripe')
    }
    const parId = new Map((abonnements ?? []).map(a => [a.id, a]))
    // Stripe illisible : l'instantane du repere est garde tel quel.
    const instantane = abonnements ? instantaneAbonnements(abonnements, jusqua.toISOString()) : repere?.etat ?? null

    // 3. Le journal du bot, et les tables du cockpit.
    const gestes = await lireGestes(depuis, jusqua)
    const evenements: EvenementResume[] = []
    const annuaire = new Annuaire()
    const ajouter = (e: EvenementResume, p?: Partial<Personne>) => {
      evenements.push(e)
      if (p) annuaire.completer(e.qui, p)
    }

    // Les gestes 'adresse' : l'adresse rattachee se retrouve par ses identifiants.
    // (15/10) Les gestes 'compte_telegram' aussi : l'adresse du payeur, par le
    // lien du nouveau compte ou ceux des anciens.
    const idsRattachements = gestes.filter(g => g.geste === 'adresse' || g.geste === 'compte_telegram')
      .flatMap(g => [g.details?.rattachement_ancien, g.details?.rattachement_nouveau, ...idsListe(g.details?.rattachements_anciens)])
      .filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))
    const idsReserves = gestes.filter(g => g.geste === 'adresse')
      .map(g => g.details?.reserve_id).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))
    const rattachementsLus = idsRattachements.length === 0 ? [] : await facultatif('rattachements_adresses', erreurs, () => prisma.$queryRaw<{ id: string; email: string | null }[]>`
      select rattachement_id::text as id, lower(email) as email from public.cockpit_liveclub_rattachements
      where rattachement_id::text = any(${idsRattachements}::text[])`)
    const emailRattachement = new Map(rattachementsLus.map(r => [r.id, r.email]))
    const reservesLues = idsReserves.length === 0 ? [] : await facultatif('reserves_adresses', erreurs, () => prisma.$queryRaw<{ id: string; email: string; qui: string }[]>`
      select reserve_id::text as id, email, qui from public.cockpit_liveclub_tarifs_reserves where reserve_id::text = any(${idsReserves}::text[])`)
    const reserveParId = new Map(reservesLues.map(r => [r.id, r]))

    // (15/10) Les comptes Telegram nommes dans les gestes 'compte_telegram'
    // (le nouveau et les anciens) : leur pseudo ou leur nom du registre du groupe.
    const gestesComptes = gestes.filter(g => g.geste === 'compte_telegram')
    const idsComptes = [...new Set(gestesComptes.flatMap(g => [...(g.telegram_id ? [g.telegram_id] : []), ...idsDuDetail(g.details?.anciens)]))]
    const registreComptes = idsComptes.length === 0 ? [] : await facultatif('comptes_telegram', erreurs, () => prisma.$queryRaw<{ telegram_id: bigint; pseudo: string | null; nom_affiche: string | null }[]>`
      select telegram_id, pseudo, nom_affiche from public.cockpit_telegram_membres
      where telegram_id::text = any(${idsComptes.map(String)}::text[])`)
    const compteParId = new Map(registreComptes.map(r => [Number(r.telegram_id), { telegramId: Number(r.telegram_id), pseudo: r.pseudo, nom: r.nom_affiche }]))
    const libelleCompte = (id: number) => libelleCourt(compteParId.get(id) ?? { telegramId: id, pseudo: null, nom: null })

    for (const g of gestes) {
      let phrase: string | null = null
      let phraseCompte: string | null = null
      let cle = cleGeste(g)
      if (g.geste === 'compte_telegram') {
        // La personne : le payeur (son adresse, par le lien du nouveau compte
        // ou d'un ancien), sinon le compte qui a ecrit.
        const d = g.details ?? {}
        const lien = [d.rattachement_nouveau, ...idsListe(d.rattachements_anciens)].find((x): x is string => typeof x === 'string' && emailRattachement.has(x))
        const email = lien ? emailRattachement.get(lien) ?? null : null
        if (email) cle = `e${email}`
        phraseCompte = phraseCompteResume(g, libelleCompte)
      }
      if (g.geste === 'adresse') {
        const d = g.details ?? {}
        let email: string | null = null
        if (g.regle === 'telegram') {
          const id = d.ajoutee === 'connue' ? d.rattachement_ancien : d.rattachement_nouveau
          email = typeof id === 'string' ? emailRattachement.get(id) ?? null : null
        } else {
          email = (await annuaire.client(typeof d.client_paiement === 'string' ? d.client_paiement : null))?.email ?? null
          const r = typeof d.reserve_id === 'string' ? reserveParId.get(d.reserve_id) : undefined
          if (r && !g.telegram_id && !g.membre_id) {
            cle = `e${r.email}`
            annuaire.completer(cle, { nom: r.qui, email: r.email })
          }
        }
        phrase = phraseAdresse(g, email ? normaliserEmail(email) : null)
      }
      const ev = evenementDeGeste(g, { phraseAdresse: phrase, phraseCompte })
      if (ev) ajouter({ ...ev, qui: cle, quand: g.fait_le })
    }

    // Stripe : nouveaux abonnes, et changements hors du bot.
    if (abonnements) {
      const nouveaux = abonnements.filter(a => estNouvelAbonnement(a, depuis.toISOString(), jusqua.toISOString()))
      const idsNouveaux = nouveaux.map(a => a.id)
      const reservesPayees = idsNouveaux.length === 0 ? [] : await facultatif('reserves_nouveaux', erreurs, () => prisma.$queryRaw<{ abonnement_id: string }[]>`
        select abonnement_id from public.cockpit_liveclub_tarifs_reserves where abonnement_id = any(${idsNouveaux}::text[])`)
      const reserves = new Set(reservesPayees.map(r => r.abonnement_id))
      for (const a of nouveaux) {
        ajouter({
          rubrique: 'nouveaux', qui: `s${a.id}`, quand: a.creeLe ?? jusqua.toISOString(),
          detail: detailNouvelAbonnement({ montant: montantAbonnement(a), remise: a.aRemise, tarifReserve: reserves.has(a.id), statut: a.statut }),
        })
      }
      const changements = changementsHorsDuBot(changementsAbonnements(repere?.etat ?? null, instantane ?? {}), gestes)
      for (const c of changements) {
        const ev = evenementDeChangement(c, parId.get(c.abonnementId))
        ajouter({ ...ev, qui: `s${c.abonnementId}`, quand: jusqua.toISOString() })
      }
    }

    // Acces broker, exemptions, tarifs reserves.
    const acces = await facultatif('acces', erreurs, () => prisma.$queryRaw<{ email: string; jusquau: Date; telegram_id: bigint | null; pose_le: Date }[]>`
      select lower(email) as email, jusquau, telegram_id, pose_le from public.cockpit_liveclub_acces
      where pose_le > ${depuis} and pose_le <= ${jusqua} and retire_le is null`)
    for (const a of acces) {
      ajouter({ rubrique: 'acces', qui: `e${a.email}`, quand: a.pose_le.toISOString(), detail: detailAccesBroker(a.jusquau.toISOString().slice(0, 10)) },
        { email: a.email, telegramId: a.telegram_id === null ? null : Number(a.telegram_id) })
    }
    const exemptions = await facultatif('exemptions', erreurs, () => prisma.$queryRaw<{ telegram_id: bigint; membre_id: string | null; motif: string; jusquau: Date | null; pose_le: Date }[]>`
      select telegram_id, membre_id::text as membre_id, motif, jusquau, pose_le from public.cockpit_liveclub_exemptions
      where pose_le > ${depuis} and pose_le <= ${jusqua} and retire_le is null`)
    for (const x of exemptions) {
      ajouter({ rubrique: 'acces', qui: `t${Number(x.telegram_id)}`, quand: x.pose_le.toISOString(), detail: detailExemption(x.motif, x.jusquau ? x.jusquau.toISOString().slice(0, 10) : null) },
        { telegramId: Number(x.telegram_id) })
    }
    const reservesFenetre = await facultatif('reserves', erreurs, () => prisma.$queryRaw<{ email: string; qui: string; telegram_id: bigint | null; montant: number; devise: string; recurrence: string; cree_le: Date; paye_le: Date | null }[]>`
      select email, qui, telegram_id, montant::float8 as montant, devise, recurrence, cree_le, paye_le
      from public.cockpit_liveclub_tarifs_reserves
      where (cree_le > ${depuis} and cree_le <= ${jusqua} and retire_le is null)
         or (paye_le > ${depuis} and paye_le <= ${jusqua})`)
    for (const r of reservesFenetre) {
      const tarif = libelleTarifReserve(r)
      const p = { nom: r.qui, email: r.email, telegramId: r.telegram_id === null ? null : Number(r.telegram_id) }
      if (r.cree_le > depuis && r.cree_le <= jusqua) {
        ajouter({ rubrique: 'acces', qui: `e${r.email}`, quand: r.cree_le.toISOString(), detail: detailTarifReserve({ tarif, paye: false }) }, p)
      }
      if (r.paye_le && r.paye_le > depuis && r.paye_le <= jusqua) {
        ajouter({ rubrique: 'acces', qui: `e${r.email}`, quand: r.paye_le.toISOString(), detail: detailTarifReserve({ tarif, paye: true }) }, p)
      }
    }

    // Demandes d'humain en attente (toutes : les nouvelles comptent comme mouvement).
    // (16/10) Jamais un compte de l'equipe (cockpit_telegram_comptes).
    const equipe = await facultatif('equipe', erreurs, () => prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes`)
    const idsEquipe = equipe.map(e => Number(e.telegram_id))
    const attentesBrutes = await facultatif('support', erreurs, () => prisma.$queryRaw<{ id: string; app: string | null; telegram_id: bigint | null; user_id: string; email: string | null; escalade: Date }[]>`
      select id, app, "telegramId" as telegram_id, "userId" as user_id, "contactEmail" as email, "escalatedAt" as escalade
      from public."SupportThread" where "escalatedAt" is not null
      order by "escalatedAt" limit 50`)
    const attentes = attentesHorsEquipe(attentesBrutes, idsEquipe)
    for (const s of attentes) {
      const tid = s.telegram_id === null ? null : Number(s.telegram_id)
      const qui = tid ? `t${tid}` : /^[0-9a-f-]{36}$/i.test(s.user_id) ? `p${s.user_id}` : `h${s.id}`
      ajouter({
        rubrique: 'humains', qui, quand: s.escalade.toISOString(), ancien: s.escalade <= depuis,
        detail: detailAttenteHumain(s.escalade.toISOString(), s.app),
      }, { email: s.email, telegramId: tid })
    }

    // (16/10) Les fils ou le bot a repris SEUL la main (filet de securite : 24 h
    // sans message de l'equipe, support-pont-pur.ts). Lus dans les messages des
    // fils du bot qui ont bouge depuis 24 h avant la fenetre.
    const filsRecents = await facultatif('reprises', erreurs, () => prisma.$queryRaw<{ telegram_id: bigint; email: string | null; messages: unknown }[]>`
      select "telegramId" as telegram_id, "contactEmail" as email, messages from public."SupportThread"
      where app = 'telegram' and "telegramId" is not null
        and "updatedAt" > (${depuis}::timestamptz at time zone 'UTC') - interval '1 day'
      limit 200`)
    for (const s of attentesHorsEquipe(filsRecents, idsEquipe)) {
      const reprise = repriseAutomatique(s.messages, depuis.getTime(), jusqua.getTime())
      if (reprise === null) continue
      const tid = Number(s.telegram_id)
      const quand = new Date(reprise).toISOString()
      ajouter({ rubrique: 'reprises', qui: `t${tid}`, quand, detail: detailRepriseBot(quand) }, { email: s.email, telegramId: tid })
    }

    // Demandes de l'equipe notees par l'agent depuis le dernier resume.
    const demandes = await facultatif('demandes', erreurs, () => prisma.$queryRaw<{ id: string; auteur: string; texte: string; statut: string; cree_le: Date }[]>`
      select demande_id::text as id, auteur, texte, statut, cree_le from public.cockpit_demandes
      where cree_le > ${depuis} and cree_le <= ${jusqua} order by cree_le limit 30`)
    for (const d of demandes) {
      ajouter({ rubrique: 'demandes', qui: `d${d.id}`, quand: d.cree_le.toISOString(), detail: detailDemande(d.texte, d.statut) }, { nom: d.auteur })
    }

    // (18/10) Les membres a contacter : une fenetre ouverte depuis le dernier
    // resume, ni deja annoncee ni marquee « fait » au cockpit. Vue illisible :
    // rien d'annonce, et la memoire du repere est gardee telle quelle.
    const risque = await facultatif('membres_risque', erreurs, () => prisma.$queryRaw<{
      membre_id: string; cle_episode: string; motif: string; nom: string | null; email: string | null; telegram: string | null
      prochain_prelevement: string | null; prochaine_tentative: string | null; jours_silence: number | null
      jours_anciennete: number | null; entree: string | null
    }[]>`
      select membre_id::text as membre_id, cle_episode, motif, nom, email_principal as email, telegram,
        prochain_prelevement::text as prochain_prelevement, prochaine_tentative::text as prochaine_tentative,
        jours_silence, jours_anciennete, entree::text as entree
      from public.cockpit_membres_risque`)
    const risqueLu = !erreurs.includes('membres_risque')
    const traitees = await facultatif('risque_traitees', erreurs, () => prisma.$queryRaw<{ membre_id: string; motif: string }[]>`
      select membre_id::text as membre_id, motif from public.cockpit_actions_traitees where motif like 'a_risque:%'`)
    const membresRisque: MembreAContacter[] = risque.map(r => ({
      membreId: r.membre_id, cleEpisode: r.cle_episode, motif: r.motif as MotifContact,
      prochainPrelevement: r.prochain_prelevement, prochaineTentative: r.prochaine_tentative,
      joursSilence: r.jours_silence === null ? null : Number(r.jours_silence),
      joursAnciennete: r.jours_anciennete === null ? null : Number(r.jours_anciennete), entree: r.entree,
    }))
    const aAnnoncer = risqueLu ? episodesAAnnoncer(membresRisque, {
      annoncesAvant: repere?.annonces ?? null,
      traitees: new Set(traitees.map(t => cleAnnonce(t.membre_id, t.motif))),
      depuisJour: jourParis(depuis.toISOString()),
    }) : []
    const fiche = new Map(risque.map(r => [r.membre_id, r]))
    // (24/10) Les episodes transmis a un relais d'accueil actif (relais.ts, qui
    // passe juste avant dans le passage) : la ligne reste, marquee « (Alex
    // s'en occupe) ». Table absente ou illisible : aucune marque.
    const relayes = aAnnoncer.length === 0 ? [] : await facultatif('relais', erreurs, () => prisma.$queryRaw<{ membre_id: string; cle_episode: string; nom: string }[]>`
      select e.membre_id::text as membre_id, e.cle_episode, r.nom
      from public.cockpit_liveclub_relais_episodes e
      join public.cockpit_liveclub_relais r on r.telegram_id = e.relais_id
      where r.actif and e.envoye_le is not null and e.fait_le is null
      order by e.annonce_le`)
    const relaisDe = relaisParEpisode(relayes)
    // (24/10) Le @pseudo lu aux deux sources, fiche et compte rattache
    // (pseudoCroise) : Milene etait rattachee avec son @, absent de sa fiche.
    const idsAnnonces = [...new Set(aAnnoncer.map(m => m.membreId))]
    const pseudosRattaches = idsAnnonces.length === 0 ? [] : await facultatif('pseudos_rattaches', erreurs, () => prisma.$queryRaw<{ membre_id: string; pseudo: string }[]>`
      select distinct on (r.membre_id) r.membre_id::text as membre_id, tm.pseudo
      from public.cockpit_liveclub_rattachements r
      join public.cockpit_telegram_membres tm on tm.telegram_id = r.telegram_id
      where r.retire_le is null and tm.pseudo is not null and r.membre_id::text = any(${idsAnnonces}::text[])
      order by r.membre_id, tm.present desc nulls last, r.lie_le desc`)
    const pseudoRattache = new Map(pseudosRattaches.map(p => [p.membre_id, p.pseudo]))
    for (const m of aAnnoncer) {
      const r = fiche.get(m.membreId)
      const { pseudo, alerte } = pseudoCroise(r?.telegram, pseudoRattache.get(m.membreId))
      const base = detailAvecRelais(detailAContacter(m, jour), relaisDe.get(cleAnnonce(m.membreId, m.cleEpisode)) ?? [])
      const detail = alerte ? `${base} ; ${alerte}` : base
      // Un meme instant pour tous : le tri (stable) de composerResume garde l'ordre des fenetres.
      ajouter({ rubrique: 'contacter', qui: `m${m.membreId}`, quand: jusqua.toISOString(), detail },
        { nom: r?.nom ?? null, email: r?.email ?? null, pseudo })
    }
    const annonces = risqueLu
      ? memoireAnnonces(membresRisque.map(m => cleAnnonce(m.membreId, m.cleEpisode)), repere?.annonces ?? null, jour)
      : repere?.annonces ?? null
    // Le pied « Bientot » : un nombre, jamais une raison d'envoyer.
    const aVenir = await facultatif('membres_a_venir', erreurs, () => prisma.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from public.cockpit_membres_a_venir where entree <= current_date + 7`)
    const bientot = Number(aVenir[0]?.n ?? 0)

    // 4. Les noms, emails et pseudos.
    await resoudre(annuaire, new Set(evenements.map(e => e.qui)), parId, erreurs)
    const texte = composerResume(evenements, annuaire.personnes, { depuis: depuis.toISOString(), jusqua: jusqua.toISOString(), bientot })
    const lignes = texte ? texte.split('\n').filter(l => l.startsWith('- ')).length : 0

    if (apercu) {
      return bilan('apercu', { lignes, texte, messages: texte ? decouperResume(texte).length : 0 })
    }

    if (!texte) {
      // Rien a dire. Le tout premier resume pose quand meme un repere (son
      // instantane), sans quoi les changements Stripe ne se verraient jamais.
      if (!repere && instantane) {
        await reserverJour({ jour, depuis, jusqua, statut: 'repere', etat: instantane, annonces })
        console.log(`[liveclub/resume] rien a dire, premier repere pose (${Object.keys(instantane).length} abonnements)`)
        return bilan('premier_repere')
      }
      console.log('[liveclub/resume] rien a dire, aucun envoi')
      return bilan('rien')
    }

    // 5. La ligne du jour, AVANT l'envoi : un rejeu ne renverra rien.
    if (!await reserverJour({ jour, depuis, jusqua, statut: 'en_cours', etat: instantane, annonces })) return bilan('deja_fait')

    const destinataires = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`
    const messages = decouperResume(texte)
    let livres = 0
    for (const d of destinataires) {
      const chat = Number(d.telegram_id)
      if (!Number.isSafeInteger(chat) || chat <= 0) continue
      let tout = true
      for (const m of messages) {
        const ok = await tgCockpit('sendMessage', { chat_id: chat, text: m, link_preview_options: { is_disabled: true } })
        if (!ok) { tout = false; break }
      }
      if (!tout) continue
      livres++
      try {
        await ajouterAHistoriqueAgent(chat, chat, entreesHistoriqueResume(texte, jour))
      } catch (err) {
        console.warn(`[liveclub/resume] historique de l'agent non complete : ${messageErreur(err).slice(0, 160)}`)
      }
    }

    const etat: EtatResume = destinataires.length === 0 ? 'sans_destinataire' : livres > 0 ? 'envoye' : 'echec'
    try {
      await prisma.$executeRaw`
        update public.cockpit_liveclub_resumes
        set statut = ${etat === 'envoye' ? 'envoye' : 'echec'}, lignes = ${lignes}, destinataires = ${destinataires.length},
            livres = ${livres}, messages = ${messages.length}, erreurs = ${erreurs.slice(0, 20)}::text[], maj_le = now()
        where jour = ${jour}::date`
    } catch (err) {
      console.warn(`[liveclub/resume] ligne du jour non close : ${messageErreur(err).slice(0, 160)}`)
    }
    console.log(`[liveclub/resume] ${etat} : ${lignes} lignes, ${messages.length} message(s), ${livres}/${destinataires.length} destinataire(s)`
      + `${erreurs.length ? `, lectures manquantes : ${erreurs.join(',')}` : ''}`)
    return bilan(etat, { lignes, destinataires: destinataires.length, livres, messages: messages.length })
  } catch (err) {
    console.warn(`[liveclub/resume] resume impossible : ${messageErreur(err).slice(0, 200)}`)
    return bilan('panne')
  }
}
