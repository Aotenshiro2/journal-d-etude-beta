// LE PARRAINAGE PAR CODE du Live Club (05/11/2026) : la partie SERVEUR (base,
// Stripe en lecture, Telegram). Les regles, les textes et l'enchainement sont
// dans parrainage-pur.ts, testes hors ligne (scripts/verifier-parrainage.mjs).
//
// Qui appelle :
// - la route du webhook Stripe du Live Club (/api/liveclub/stripe, invoice.paid
//   signe) : parrainageApresPaiement ;
// - le passage du matin (passage.ts, etape 'parrainages') : filetParrainages,
//   qui relit les factures payees des 7 derniers jours (un evenement manque,
//   ou le webhook pas encore branche) et reprend les notifications restees en
//   plan ;
// - la carte d'Agent AOK « code de parrainage » (controlerCodeParrainage,
//   executerCodeParrainage) et la carte de code promo avec parrain
//   (enregistrerCodeParrainage) ;
// - la repartition (lireAVerserParrainages), le resume du matin
//   (lireFilleulsFenetre) et l'API de Tab (lectures.ts, GET /membres).
//
// Tables (migration 20261105120000, sites/Aoknowledgecom, ECRITE, NON
// appliquee) : cockpit_liveclub_parrains (code -> parrain) et
// cockpit_liveclub_filleuls (une ligne par abonnement filleul, cle unique sur
// l'abonnement). SANS ELLES, rien ne casse : table absente = aucun code connu,
// rien n'est note ni envoye, la carte dit que la migration manque.
//
// Jamais de nom, d'email ni de texte de message dans un log : des comptes.

import { prisma } from '@/lib/db'
import { RefusAction, stripeGet, type ActionAgent } from '@/lib/stripe-actions'
import { alerterEquipeTexte } from '@/lib/alerte-equipe-telegram'
import { cleStripeEcriture, cleStripeLecture } from './config'
import { lireAbonnement } from './stripe'
import { envoyer } from './telegram'
import { tracerMessageBot } from './support-pont'
import { messageErreur, relationAbsente, uuidDeActeur } from './pur'
import {
  DELAI_INCERTAIN_MIN, FENETRE_FILET_JOURS, OFFRE_LIVE_CLUB,
  alerterPourFilleul, carteCodeParrainage, carteDeclaration, codeApres, codesDesRemises, detailParParrain, etatDeclaration,
  factureRemboursee, grouperParParrain, jourParisDe, libelleDepenseParrainage, lireParamsCodeParrainage, lireParamsDeclaration, lireRemboursement,
  notifierGroupe, phraseAVerser, texteAlerteRemboursement, texteParrain, traiterFactureFilleul, traiterFactures,
  type BilanFilet, type CodeParrainage, type EtatDeclaration, type FactureFilleul, type FilleulANotifier, type FilleulDuMois,
  type IssueFilleul, type NotificationFinale, type OutilsParrainage, type ParamsCodeParrainage, type ParrainCodePromo,
} from './parrainage-pur'

const MIGRATION = '20261105120000_cockpit_liveclub_parrainage'
/** (05/11) La declaration du mois, l'annulation par remboursement, la memoire des cartes de fin de mois. */
const MIGRATION_DECLARATION = '20261105190000_cockpit_parrainage_declaration'
const ABSENTE = `Les tables du parrainage n'existent pas encore (migration ${MIGRATION} à appliquer) : rien n'est enregistré.`

// La repartition (nom et cote du produit, solde du mois) : import dynamique,
// repartition/serveur.ts importe ce fichier (l'avertissement du mois).
async function nomOffre(offreId: string): Promise<string | null> {
  return (await import('@/lib/repartition/serveur')).nomOffre(offreId)
}
async function coteDuProduit(offreId: string): Promise<'brice' | 'mel' | null> {
  return (await import('@/lib/repartition/serveur')).coteDuProduit(offreId)
}
async function phraseSoldeDuMois(mois: string): Promise<string | null> {
  return (await import('@/lib/repartition/serveur')).phraseSoldeDuMois(mois)
}

// ---------------------------------------------------------------------------
// Lectures en base
// ---------------------------------------------------------------------------

type LigneCode = {
  code_id: string; code: string; parrain: string; parrain_pseudo: string | null; parrain_telegram_id: bigint | null
  parrain_email: string | null; taux_pct: number; taux_palier_pct: number; palier: number; depuis: string; actif: boolean
}

function versCode(l: LigneCode): CodeParrainage {
  return {
    codeId: l.code_id, code: l.code, parrain: l.parrain, pseudo: l.parrain_pseudo,
    telegramId: l.parrain_telegram_id === null ? null : Number(l.parrain_telegram_id),
    email: l.parrain_email, tauxPct: Number(l.taux_pct), tauxPalierPct: Number(l.taux_palier_pct),
    palier: Number(l.palier), depuis: l.depuis, actif: l.actif,
  }
}

/** Tous les codes de parrainage (actifs ou non). Jette (table absente comprise). */
export async function lireCodesParrainage(): Promise<CodeParrainage[]> {
  const lignes = await prisma.$queryRaw<LigneCode[]>`
    select code_id::text as code_id, code, parrain, parrain_pseudo, parrain_telegram_id, parrain_email,
      taux_pct::float8 as taux_pct, taux_palier_pct::float8 as taux_palier_pct, palier,
      to_char(depuis, 'YYYY-MM-DD') as depuis, actif
    from public.cockpit_liveclub_parrains order by pose_le`
  return lignes.map(versCode)
}

async function codeParCle(code: string): Promise<CodeParrainage | null> {
  const lignes = await prisma.$queryRaw<LigneCode[]>`
    select code_id::text as code_id, code, parrain, parrain_pseudo, parrain_telegram_id, parrain_email,
      taux_pct::float8 as taux_pct, taux_palier_pct::float8 as taux_palier_pct, palier,
      to_char(depuis, 'YYYY-MM-DD') as depuis, actif
    from public.cockpit_liveclub_parrains where upper(code) = upper(${code}) limit 1`
  return lignes[0] ? versCode(lignes[0]) : null
}

// ---------------------------------------------------------------------------
// Stripe, en lecture (cle de lecture, repli sur la cle de l'agent si la
// premiere n'a pas le droit de lire les codes promo)
// ---------------------------------------------------------------------------

async function lireStripe(chemin: string): Promise<Record<string, unknown>> {
  const lecture = cleStripeLecture()
  if (!lecture) throw new Error('STRIPE_READ_KEY_MELANIE et STRIPE_AGENT_KEY_MELANIE absentes du projet journal.')
  try {
    return await stripeGet(lecture, chemin)
  } catch (err) {
    const ecriture = cleStripeEcriture()
    if (ecriture && ecriture !== lecture && /permission|restricted/i.test(messageErreur(err))) return stripeGet(ecriture, chemin)
    throw err
  }
}

const AVEC_CODES = () => {
  const q = new URLSearchParams()
  q.append('expand[]', 'discounts.promotion_code')
  return q
}

/** Les codes promo d'une facture : ses remises, puis celles de l'abonnement. Jette sur une panne. */
async function codesDeLaFacture(f: FactureFilleul): Promise<string[]> {
  if (f.factureId) {
    const facture = await lireStripe(`/v1/invoices/${f.factureId}?${AVEC_CODES()}`)
    const codes = codesDesRemises(facture.discounts)
    if (codes && codes.length > 0) return codes
  }
  const sub = await lireStripe(`/v1/subscriptions/${f.abonnementId}?${AVEC_CODES()}`)
  return codesDesRemises(sub.discounts) ?? []
}

/** Les factures PAYEES des derniers jours, remises et codes promo deplies (le filet). Jette sur une panne. */
async function facturesRecentes(maintenantMs: number, depuisSec?: number): Promise<unknown[]> {
  const depuis = depuisSec ?? Math.floor(maintenantMs / 1000) - FENETRE_FILET_JOURS * 86_400
  const toutes: unknown[] = []
  let apres: string | null = null
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ status: 'paid', limit: '100', 'created[gte]': String(depuis) })
    q.append('expand[]', 'data.discounts.promotion_code')
    if (apres) q.set('starting_after', apres)
    const liste = await lireStripe(`/v1/invoices?${q}`)
    const data = (liste.data as Record<string, unknown>[] | undefined) ?? []
    toutes.push(...data)
    if (liste.has_more !== true || data.length === 0) return toutes
    apres = String(data[data.length - 1].id)
  }
  throw new Error('Plus de 500 factures payées en 7 jours : liste incomplète, rien n\'est décidé dessus.')
}

// ---------------------------------------------------------------------------
// Les outils du traitement (parrainage-pur.ts)
// ---------------------------------------------------------------------------

async function prenomFiche(f: FactureFilleul): Promise<string | null> {
  try {
    const lignes = await prisma.$queryRaw<{ prenom: string | null }[]>`
      select me.prenom from public.cockpit_abonnements a
      join public.cockpit_membres_etat me on me.membre_id = a.membre_id
      where a.abonnement_id in (${`stripe:${f.abonnementId}`}, ${f.abonnementId}) and me.prenom is not null
      limit 1`
    return lignes[0]?.prenom ?? null
  } catch {
    return null
  }
}

/** Le compte Telegram du parrain par son pseudo : le registre du groupe, puis l'historique des noms. Un seul compte, sinon null. */
async function resoudreParrain(c: CodeParrainage): Promise<number | null> {
  if (!c.pseudo) return null
  const unique = (lignes: { telegram_id: bigint }[]) => {
    const ids = [...new Set(lignes.map(l => Number(l.telegram_id)))].filter(n => Number.isSafeInteger(n) && n > 0)
    return ids.length === 1 ? ids[0] : ids.length === 0 ? null : 'plusieurs' as const
  }
  try {
    const groupe = unique(await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_membres where lower(pseudo) = lower(${c.pseudo}) limit 3`)
    if (groupe !== null) return groupe === 'plusieurs' ? null : groupe
    const noms = unique(await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select distinct telegram_id from public.cockpit_telegram_noms where lower(pseudo) = lower(${c.pseudo}) limit 3`)
    return noms === 'plusieurs' ? null : noms
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[liveclub/parrainage] compte du parrain illisible : ${messageErreur(err).slice(0, 160)}`)
    return null
  }
}

async function envoyerParrain(telegramId: number, texte: string): Promise<'ok' | 'refus' | 'echec'> {
  const r = await envoyer(telegramId, texte)
  if (r.ok) {
    // Le fil Support du parrain garde le message, comme tout message du bot.
    try { await tracerMessageBot(telegramId, texte) } catch { /* le message est parti : le fil n'est qu'une trace */ }
    return 'ok'
  }
  console.warn(`[liveclub/parrainage] message au parrain non parti (code ${r.code ?? '?'})`)
  return r.code === 403 || r.code === 400 ? 'refus' : 'echec'
}

async function reserverNotification(filleulId: string): Promise<boolean> {
  const lignes = await prisma.$queryRaw<{ n: number }[]>`
    update public.cockpit_liveclub_filleuls
    set notification_tentee_le = now(), notification = null
    where filleul_id = ${filleulId}::uuid and notifie_le is null
      and (notification_tentee_le is null or notification = 'a_reprendre')
    returning 1 as n`
  return lignes.length > 0
}

/** L'alerte d'un envoi incertain : posee une fois, et pas avant DELAI_INCERTAIN_MIN. */
async function reserverIncertain(filleulId: string): Promise<boolean> {
  const lignes = await prisma.$queryRaw<{ n: number }[]>`
    update public.cockpit_liveclub_filleuls
    set notification_tentee_le = now(), notification = 'incertain'
    where filleul_id = ${filleulId}::uuid and notifie_le is null
      and (notification is null or notification = 'incertain')
      and notification_tentee_le < now() - make_interval(mins => ${DELAI_INCERTAIN_MIN}::int)
    returning 1 as n`
  return lignes.length > 0
}

async function marquerNotification(filleulId: string, issue: NotificationFinale): Promise<void> {
  const fini = issue === 'parrain' || issue === 'equipe' || issue === 'incertain'
  await prisma.$executeRaw`
    update public.cockpit_liveclub_filleuls
    set notification = ${issue}, notifie_le = ${fini ? new Date() : null}::timestamptz
    where filleul_id = ${filleulId}::uuid`
}

type Lecteur = Pick<typeof prisma, '$queryRaw'>

/** Les filleuls deja notes de CE parrain, tous ses codes compris (meme compte Telegram ou meme pseudo), annules exclus. */
async function compterFilleuls(db: Lecteur, c: CodeParrainage): Promise<number> {
  const compte = await db.$queryRaw<{ n: number }[]>`
    select count(*)::int as n from public.cockpit_liveclub_filleuls fi
    join public.cockpit_liveclub_parrains p on p.code_id = fi.code_id
    where fi.statut <> 'annulee' and (
      p.code_id = ${c.codeId}::uuid
      or (${c.telegramId}::bigint is not null and p.parrain_telegram_id = ${c.telegramId}::bigint)
      or (${c.pseudo}::text is not null and lower(p.parrain_pseudo) = lower(${c.pseudo}::text)))`
  return compte[0]?.n ?? 0
}

async function noter(e: Parameters<OutilsParrainage['noter']>[0], calcul: Parameters<OutilsParrainage['noter']>[1]) {
  const f = e.facture
  const c = e.code
  return prisma.$transaction(async (tx) => {
    // Un seul a la fois : le rang du filleul se compte sous ce verrou.
    await tx.$queryRaw`select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended('liveclub:parrainage', 0))) as verrou`
    const deja = await tx.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from public.cockpit_liveclub_filleuls where abonnement_id = ${f.abonnementId}`
    if ((deja[0]?.n ?? 0) > 0) return null
    const k = calcul(await compterFilleuls(tx, c))
    const lignes = await tx.$queryRaw<{ filleul_id: string }[]>`
      insert into public.cockpit_liveclub_filleuls
        (code_id, code, abonnement_id, client_stripe, facture_id, prenom, paye_le, montant_paye, devise,
         rang, taux_pct, commission, mois, source)
      values (${c.codeId}::uuid, ${c.code}, ${f.abonnementId}, ${f.client}, ${f.factureId}, ${e.prenom}, ${f.payeLe}::timestamptz,
        ${(f.montant / 100).toFixed(2)}::numeric, ${f.devise}, ${k.rang}::int, ${k.tauxPct}::numeric,
        ${(k.commission / 100).toFixed(2)}::numeric, ${e.mois}, ${e.source})
      on conflict (abonnement_id) do nothing
      returning filleul_id::text as filleul_id`
    return lignes[0] ? { filleulId: lignes[0].filleul_id, ...k } : null
  })
}

async function dejaNote(abonnementId: string): Promise<boolean> {
  const l = await prisma.$queryRaw<{ n: number }[]>`
    select count(*)::int as n from public.cockpit_liveclub_filleuls where abonnement_id = ${abonnementId}`
  return (l[0]?.n ?? 0) > 0
}

/**
 * Les outils du traitement. `aBlanc` (rattrapage, 05/11) : tout est LU pour de
 * vrai (Stripe, base, compte du parrain), rien n'est ecrit ni envoye ; ce qui
 * serait fait va dans `journal` (les rangs se comptent comme au vrai passage).
 */
function outilsServeur(o: { codes?: () => Promise<CodeParrainage[]>; aBlanc?: boolean; journal?: string[] } = {}): OutilsParrainage {
  let cache: Promise<CodeParrainage[]> | null = null
  const journal = o.journal ?? []
  const vrais: OutilsParrainage = {
    maintenant: () => new Date().toISOString(),
    codesParrainage: o.codes ?? (() => (cache ??= lireCodesParrainage())),
    codesDeLaFacture,
    dejaNote,
    estLiveClub: async (abonnementId) => (await lireAbonnement(abonnementId)) !== null,
    prenomFiche,
    noter,
    reserverNotification,
    resoudreParrain,
    envoyerParrain,
    alerterEquipe: (texte) => alerterEquipeTexte(texte, { journal: '[liveclub/parrainage] alerte a l equipe' }),
    marquerNotification,
  }
  if (!o.aBlanc) return vrais
  const notes = new Map<string, number>()
  let n = 0
  return {
    ...vrais,
    noter: async (e, calcul) => {
      if (await dejaNote(e.facture.abonnementId)) return null
      const cle = e.code.telegramId !== null ? `t${e.code.telegramId}` : e.code.pseudo ? `p${e.code.pseudo.toLowerCase()}` : `c${e.code.codeId}`
      const avant = notes.get(cle) ?? 0
      notes.set(cle, avant + 1)
      const k = calcul(await compterFilleuls(prisma, e.code) + avant)
      journal.push(`FILLEUL : ${e.prenom ?? '(sans prénom)'}, code ${e.code.code} (${e.code.parrain}), payé le ${jourParisDe(e.facture.payeLe)}, `
        + `${(e.facture.montant / 100).toFixed(2)} ${e.facture.devise}, rang ${k.rang}, ${k.tauxPct} %, commission ${(k.commission / 100).toFixed(2)}, mois ${e.mois}`)
      return { filleulId: `a-blanc-${++n}`, ...k }
    },
    reserverNotification: async () => true,
    marquerNotification: async () => {},
    envoyerParrain: async (telegramId, texte) => {
      journal.push(`  -> message privé au compte ${telegramId} (si Telegram le refuse : alerte à l'équipe) : ${texte}`)
      return 'ok'
    },
    alerterEquipe: async (texte) => {
      journal.push(`  -> alerte à l'équipe :\n${texte.split('\n').map(l => `     ${l}`).join('\n')}`)
      return 1
    },
  }
}

// ---------------------------------------------------------------------------
// Le webhook (invoice.paid signe) et le filet du matin
// ---------------------------------------------------------------------------

export type IssueWebhookParrainage = { etat: 'ok' | 'table_absente' | 'panne'; issue?: IssueFilleul['etat']; raison?: string }

/**
 * Une facture payee recue par le webhook : note le filleul et previent le
 * parrain, une seule fois par abonnement. 'panne' = Stripe ou la base
 * illisibles : la route rend 500 et Stripe rejoue (rien n'a ete note, ou la
 * ligne deja notee fait taire le rejeu). Table absente : rien, sans erreur.
 */
export async function parrainageApresPaiement(evenement: unknown): Promise<IssueWebhookParrainage> {
  try {
    const r = await traiterFactureFilleul(evenement, 'webhook', outilsServeur())
    if (r.etat === 'note') console.info(`[liveclub/parrainage] filleul note (rang ${r.rang}, ${r.tauxPct} %), notification ${r.notification}`)
    return { etat: 'ok', issue: r.etat, ...(r.etat === 'ignore' ? { raison: r.raison } : {}) }
  } catch (err) {
    if (relationAbsente(err)) return { etat: 'table_absente' }
    console.warn(`[liveclub/parrainage] facture non traitee : ${messageErreur(err).slice(0, 200)}`)
    return { etat: 'panne' }
  }
}

export type BilanParrainages = BilanFilet & { etat: string; reprises: number; incertains: number; annulees: number }

const BILAN_VIDE = (etat: string): BilanParrainages => ({
  etat, lues: 0, notees: 0, prevenus: 0, equipe: 0, a_reprendre: 0, ignorees: 0, deja: 0, erreurs: 0, reprises: 0, incertains: 0, annulees: 0,
})

/** Le debut d'un jour de Paris (AAAA-MM-JJ), en secondes : minuit a Paris, ete comme hiver. */
function debutJourParis(jour: string): number {
  for (const decalage of ['+02:00', '+01:00']) {
    const t = Date.parse(`${jour}T00:00:00${decalage}`)
    if (jourParisDe(new Date(t).toISOString()) === jour && jourParisDe(new Date(t - 1000).toISOString()) !== jour) return Math.floor(t / 1000)
  }
  return Math.floor(Date.parse(`${jour}T00:00:00Z`) / 1000)
}

type LigneANotifier = {
  filleul_id: string; code_id: string; prenom: string | null; paye_le: Date; montant: number; devise: string
  rang: number; taux_pct: number; commission: number; notification: string | null; tentee: Date | null
}

/**
 * Le filet du matin (passage.ts) : (1) les factures payees des 7 derniers
 * jours, une par une (memes regles que le webhook : une facture deja notee
 * ne fait rien) ; (2) les filleuls notes depuis plus de 30 minutes dont le
 * parrain n'a pas ete prevenu : a reprendre (envoi rate et alerte non livree)
 * = on recommence ; tentative restee sans resultat = envoi INCERTAIN, l'equipe
 * est prevenue avec la phrase, rien n'est renvoye au parrain ; (3) (05/11)
 * les premiers paiements rembourses : commission annulee (verifierRemboursements).
 * Ne jette pas.
 *
 * (05/11) Le RATTRAPAGE (scripts/rattraper-parrainages.mjs, une fois apres le
 * deploiement, sur GO) : `depuisJour` = '2026-10-22' (date des codes) au lieu
 * des 7 derniers jours ; `aBlanc` = tout est lu, rien n'est ecrit ni envoye,
 * `journal` recoit ce qui serait fait (ni reprises ni remboursements a blanc).
 */
export async function filetParrainages(
  maintenant: Date = new Date(), o: { depuisJour?: string; aBlanc?: boolean; journal?: string[] } = {},
): Promise<BilanParrainages> {
  let codes: CodeParrainage[]
  try {
    codes = await lireCodesParrainage()
  } catch (err) {
    if (relationAbsente(err)) return BILAN_VIDE('table_absente')
    console.warn(`[liveclub/parrainage] codes illisibles : ${messageErreur(err).slice(0, 160)}`)
    return BILAN_VIDE('base_illisible')
  }
  if (!codes.some(c => c.actif)) return BILAN_VIDE('sans_code')
  const outils = outilsServeur({ codes: async () => codes, aBlanc: o.aBlanc, journal: o.journal })

  let factures: unknown[]
  let bilan: BilanParrainages
  try {
    factures = await facturesRecentes(maintenant.getTime(), o.depuisJour ? debutJourParis(o.depuisJour) : undefined)
    bilan = { ...await traiterFactures(factures, outils), etat: 'ok', reprises: 0, incertains: 0, annulees: 0 }
  } catch (err) {
    console.warn(`[liveclub/parrainage] factures illisibles : ${messageErreur(err).slice(0, 160)}`)
    bilan = { ...BILAN_VIDE('stripe_illisible') }
  }
  if (o.aBlanc) return bilan

  // (2) Les notifications restees en plan.
  let lignes: LigneANotifier[] = []
  try {
    lignes = await prisma.$queryRaw<LigneANotifier[]>`
      select filleul_id::text as filleul_id, code_id::text as code_id, prenom, paye_le, montant_paye::float8 as montant,
        devise, rang, taux_pct::float8 as taux_pct, commission::float8 as commission, notification,
        notification_tentee_le as tentee
      from public.cockpit_liveclub_filleuls
      where notifie_le is null and cree_le < now() - make_interval(mins => ${DELAI_INCERTAIN_MIN}::int)
        and statut <> 'annulee'
      order by cree_le limit 20`
  } catch (err) {
    console.warn(`[liveclub/parrainage] reprises illisibles : ${messageErreur(err).slice(0, 160)}`)
    bilan.erreurs++
  }
  const parId = new Map(codes.map(c => [c.codeId, c]))
  // (05/11) Les notifications a reprendre : UN message par parrain (notifierGroupe).
  const aReprendre: FilleulANotifier[] = []
  for (const l of lignes) {
    const code = parId.get(l.code_id)
    if (!code) continue
    const n: FilleulANotifier = {
      filleulId: l.filleul_id, rang: Number(l.rang), tauxPct: Number(l.taux_pct), commission: Math.round(Number(l.commission) * 100),
      code, prenom: l.prenom, montant: Math.round(Number(l.montant) * 100), devise: l.devise, payeLe: l.paye_le.toISOString(), email: null,
    }
    try {
      if (l.tentee === null || l.notification === 'a_reprendre') {
        aReprendre.push(n)
      } else if (await reserverIncertain(l.filleul_id)) {
        const contexte = {
          prenom: n.prenom, code: code.code, commission: n.commission, devise: n.devise, tauxPct: n.tauxPct,
          rang: n.rang, palier: code.palier, payeLe: n.payeLe, maintenant: maintenant.toISOString(),
        }
        await alerterPourFilleul(n, contexte, texteParrain(contexte), 'incertain', outils)
        bilan.incertains++
      }
    } catch (err) {
      console.warn(`[liveclub/parrainage] reprise ratee : ${messageErreur(err).slice(0, 160)}`)
      bilan.erreurs++
    }
  }
  for (const groupe of grouperParParrain(aReprendre)) {
    try {
      if (await notifierGroupe(groupe, outils) !== 'deja') bilan.reprises += groupe.length
    } catch (err) {
      console.warn(`[liveclub/parrainage] reprise ratee : ${messageErreur(err).slice(0, 160)}`)
      bilan.erreurs++
    }
  }

  // (3) Les premiers paiements rembourses depuis (05/11).
  const r = await verifierRemboursements()
  bilan.annulees = r.annulees
  bilan.erreurs += r.erreurs
  console.log(`[liveclub/parrainage] filet : ${JSON.stringify(bilan)}`)
  return bilan
}

// ---------------------------------------------------------------------------
// Le remboursement (Brice, 05/11) : « la commission est annulée s'il a été
// remboursé ». Filet du matin, et webhook charge.refunded (meme fonction).
// ---------------------------------------------------------------------------

/** Les filleuls relus au plus : ceux payes depuis 120 jours, encore dus. */
const MAX_REMBOURSEMENTS = 50

/**
 * Les filleuls encore dus (a_verser, declaree) payes depuis 120 jours, ou ceux
 * d'un client (webhook) : leur facture relue chez Stripe (paiements, charge
 * depliee). Remboursee en entier : statut annulee, commission a 0 (gardee dans
 * commission_initiale). Deja declaree : alerte a l'equipe (la carte de
 * correction suit au passage). Rien au parrain. Ne jette pas.
 */
export async function verifierRemboursements(o: { client?: string } = {}): Promise<{ annulees: number; erreurs: number }> {
  let lignes: { filleul_id: string; facture_id: string; mois: string }[]
  try {
    lignes = await prisma.$queryRaw<{ filleul_id: string; facture_id: string; mois: string }[]>`
      select filleul_id::text as filleul_id, facture_id, mois from public.cockpit_liveclub_filleuls
      where statut in ('a_verser', 'declaree') and facture_id is not null
        and (${o.client ?? null}::text is null or client_stripe = ${o.client ?? null}::text)
        and paye_le > now() - interval '120 days'
      order by paye_le limit ${MAX_REMBOURSEMENTS}::int`
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[liveclub/parrainage] remboursements illisibles : ${messageErreur(err).slice(0, 160)}`)
    return { annulees: 0, erreurs: relationAbsente(err) ? 0 : 1 }
  }
  let annulees = 0
  let erreurs = 0
  for (const l of lignes) {
    try {
      const q = new URLSearchParams({ invoice: l.facture_id, limit: '10' })
      q.append('expand[]', 'data.payment.charge')
      const paiements = await lireStripe(`/v1/invoice_payments?${q}`)
      if (!factureRemboursee(paiements.data)) continue
      if (await annulerFilleul(l.filleul_id, l.mois)) annulees++
    } catch (err) {
      console.warn(`[liveclub/parrainage] remboursement non verifie : ${messageErreur(err).slice(0, 160)}`)
      erreurs++
    }
  }
  return { annulees, erreurs }
}

/** L'annulation d'UN filleul rembourse, sous le verrou du mois ; l'alerte s'il etait deja declare. */
async function annulerFilleul(filleulId: string, mois: string): Promise<boolean> {
  const issue = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`liveclub:parrainage:mois:${mois}`}::text, 0))) as verrou`
    const avant = await tx.$queryRaw<{ statut: string; commission: number; prenom: string | null; code: string; parrain: string }[]>`
      select f.statut, f.commission::float8 as commission, f.prenom, f.code, p.parrain
      from public.cockpit_liveclub_filleuls f join public.cockpit_liveclub_parrains p on p.code_id = f.code_id
      where f.filleul_id = ${filleulId}::uuid for update of f`
    const a = avant[0]
    if (!a || (a.statut !== 'a_verser' && a.statut !== 'declaree')) return null
    await tx.$executeRaw`
      update public.cockpit_liveclub_filleuls
      set statut = 'annulee', commission_initiale = commission, commission = 0, annulee_le = now(), annulee_raison = 'rembourse'
      where filleul_id = ${filleulId}::uuid`
    return a
  })
  if (!issue) return false
  console.info(`[liveclub/parrainage] filleul annule (premier paiement rembourse)${issue.statut === 'declaree' ? ', deja declare : alerte a l equipe' : ''}`)
  if (issue.statut === 'declaree') {
    const e = await lireEtatDeclaration(mois)
    await alerterEquipeTexte(texteAlerteRemboursement({
      prenom: issue.prenom, parrain: issue.parrain, code: issue.code, commission: Math.round(Number(issue.commission) * 100),
      mois, depense: e?.depense?.montant ?? null, du: e?.du ?? 0,
    }), { journal: '[liveclub/parrainage] remboursement apres declaration' })
  }
  return true
}

/** Le webhook charge.refunded (signe) : les filleuls de ce client relus. 'panne' : Stripe rejoue. */
export async function parrainageApresRemboursement(evenement: unknown): Promise<{ etat: 'ok' | 'panne'; annulees: number }> {
  const r = lireRemboursement(evenement)
  if (!r) return { etat: 'ok', annulees: 0 }
  const v = await verifierRemboursements({ client: r.client })
  return { etat: v.erreurs > 0 ? 'panne' : 'ok', annulees: v.annulees }
}

// ---------------------------------------------------------------------------
// La declaration du mois (Brice, 05/11) : les commissions d'un mois deviennent
// UNE depense du Live Club, par carte (parrainage-pur.ts, carteDeclaration).
// ---------------------------------------------------------------------------

/**
 * Ou en est la declaration d'un mois : ses filleuls et la depense vivante.
 * null = tables ou colonnes absentes (migrations 20261105120000 et
 * 20261105190000), ou base illisible : ni avertissement ni carte.
 */
export async function lireEtatDeclaration(mois: string, db: Lecteur = prisma): Promise<EtatDeclaration | null> {
  try {
    const filleuls = await db.$queryRaw<{ filleul_id: string; parrain: string; prenom: string | null; commission: number; statut: FilleulDuMois['statut']; depense_id: string | null }[]>`
      select f.filleul_id::text as filleul_id, p.parrain, f.prenom, f.commission::float8 as commission, f.statut, f.depense_id::text as depense_id
      from public.cockpit_liveclub_filleuls f join public.cockpit_liveclub_parrains p on p.code_id = f.code_id
      where f.mois = ${mois} order by f.paye_le`
    const depenses = await db.$queryRaw<{ depense_id: string; montant: number; pose_le: Date }[]>`
      select depense_id::text as depense_id, montant::float8 as montant, pose_le from public.cockpit_depenses
      where parrainage_mois = ${mois} and retire_le is null order by pose_le desc limit 1`
    const d = depenses[0]
    return etatDeclaration(
      filleuls.map(f => ({
        filleulId: f.filleul_id, parrain: f.parrain, prenom: f.prenom, commission: Math.round(Number(f.commission) * 100),
        statut: f.statut, depenseId: f.depense_id,
      })),
      d ? { depenseId: d.depense_id, montant: Math.round(Number(d.montant) * 100), poseLe: d.pose_le.toISOString() } : null,
    )
  } catch (err) {
    if (!relationAbsente(err) && !/42703|column .* does not exist/i.test(messageErreur(err))) {
      console.warn(`[liveclub/parrainage] declaration illisible : ${messageErreur(err).slice(0, 160)}`)
    }
    return null
  }
}

/** Les mois finis (3 derniers au plus) dont la declaration n'est pas a jour : la carte de fin de mois. */
export async function moisADeclarer(moisCourant: string): Promise<{ mois: string; etat: EtatDeclaration }[]> {
  let mois: { mois: string }[]
  try {
    mois = await prisma.$queryRaw<{ mois: string }[]>`
      select distinct mois from public.cockpit_liveclub_filleuls where mois < ${moisCourant} order by mois desc limit 3`
  } catch {
    return []
  }
  const sortie: { mois: string; etat: EtatDeclaration }[] = []
  for (const m of mois) {
    const etat = await lireEtatDeclaration(m.mois)
    if (etat && !etat.aJour) sortie.push({ mois: m.mois, etat })
  }
  return sortie
}

/** L'avertissement de la repartition d'un mois (Revenus) : null une fois la declaration a jour. */
export async function phraseParrainagesDuMois(mois: string, moisCourant: string): Promise<string | null> {
  const e = await lireEtatDeclaration(mois)
  return e ? phraseAVerser(e, mois, { moisCourant }) : null
}

export type ControleDeclaration = { action: ActionAgent; carte: string; court: string; manque: string | null } | { erreur: string }

/** Avant la carte (lecture seule) : l'etat du mois, la carte composee par le serveur. */
export async function controlerDeclarationParrainage(action: ActionAgent): Promise<ControleDeclaration> {
  const moisCourant = jourParisDe(new Date().toISOString()).slice(0, 7)
  const p = lireParamsDeclaration(action.params, { moisCourant })
  if (typeof p === 'string') return { erreur: p }
  const e = await lireEtatDeclaration(p.mois)
  if (!e) return { erreur: `Les tables du parrainage ne sont pas encore à jour (migrations ${MIGRATION} et ${MIGRATION_DECLARATION} à appliquer) : rien à déclarer.` }
  const produit = (await nomOffre(OFFRE_LIVE_CLUB)) ?? 'Live Club'
  const c = carteDeclaration(p.mois, e, { produit })
  if (!c) {
    return {
      erreur: e.depense
        ? `Les commissions de parrainage ${deMoisLibelle(p.mois)} sont déjà déclarées (${(e.depense.montant / 100).toFixed(2).replace('.', ',')} €, le ${jourParisDe(e.depense.poseLe)}) : rien à refaire.`
        : `Aucune commission de parrainage pour ${p.mois} : rien à déclarer.`,
    }
  }
  return {
    action: { ...action, compte: 'cockpit', params: { mois: p.mois, du: e.du, remplace: e.depense?.depenseId ?? null } },
    carte: c.carte, court: c.court, manque: null,
  }
}

function deMoisLibelle(mois: string): string {
  return libelleDepenseParrainage(mois).replace('Commissions de parrainage ', '')
}

/**
 * Le clic : sous le verrou du mois, l'etat relu doit etre celui de la carte
 * (sinon refus, redemander la carte) ; l'ancienne depense retiree s'il y en a
 * une, la nouvelle posee (produit Live Club, cote Mel, payee par Mel), les
 * filleuls dus passes « declaree ». Une seule depense vivante par mois (index
 * unique de la base).
 */
export async function executerDeclarationParrainage(action: ActionAgent, acteur: string): Promise<string> {
  const posePar = uuidDeActeur(acteur)
  if (!posePar) throw new Error("Auteur de l'action illisible : rien n'a été écrit.")
  const moisCourant = jourParisDe(new Date().toISOString()).slice(0, 7)
  const p = lireParamsDeclaration(action.params, { moisCourant })
  if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a été fait.`)
  const produit = (await nomOffre(OFFRE_LIVE_CLUB)) ?? null
  if (!produit) throw new RefusAction(`Le produit ${OFFRE_LIVE_CLUB} est introuvable dans cockpit_offres : rien n'a été déclaré.`)
  const cote = (await coteDuProduit(OFFRE_LIVE_CLUB)) ?? 'mel'
  try {
    const r = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`liveclub:parrainage:mois:${p.mois}`}::text, 0))) as verrou`
      const e = await lireEtatDeclaration(p.mois, tx)
      if (!e) throw new RefusAction(`Les tables du parrainage ne sont pas encore à jour (migration ${MIGRATION_DECLARATION} à appliquer) : rien n'a été déclaré.`)
      if (e.aJour) throw new RefusAction(`Déjà à jour : les commissions de parrainage ${deMoisLibelle(p.mois)} sont déclarées. Rien n'a été refait.`)
      if ((p.du !== null && p.du !== e.du) || p.remplace !== (e.depense?.depenseId ?? null)) {
        throw new RefusAction(`Les commissions de parrainage ${deMoisLibelle(p.mois)} ont changé depuis la carte (dû : ${(e.du / 100).toFixed(2).replace('.', ',')} €) : redemande-la, rien n'a été fait.`)
      }
      if (e.depense) {
        await tx.$executeRaw`
          update public.cockpit_depenses set retire_le = now(), retire_par = ${posePar}::uuid
          where depense_id = ${e.depense.depenseId}::uuid and retire_le is null`
      }
      let depenseId: string | null = null
      if (e.du > 0) {
        const lignes = await tx.$queryRaw<{ depense_id: string }[]>`
          insert into public.cockpit_depenses (libelle, montant, mois, payee_par, cote, offre_id, note, pose_par, via, parrainage_mois)
          values (${libelleDepenseParrainage(p.mois)}, ${(e.du / 100).toFixed(2)}::numeric, ${p.mois}, ${cote}, ${cote}, ${OFFRE_LIVE_CLUB},
            ${detailParParrain(e.dus).slice(0, 500)}, ${posePar}::uuid, 'agent', ${p.mois})
          returning depense_id::text as depense_id`
        depenseId = lignes[0].depense_id
        const ids = e.dus.map(f => f.filleulId)
        await tx.$executeRaw`
          update public.cockpit_liveclub_filleuls set statut = 'declaree', depense_id = ${depenseId}::uuid
          where filleul_id::text = any(${ids}::text[]) and statut in ('a_verser', 'declaree')`
      }
      return { e, depenseId }
    })
    const solde = await phraseSoldeDuMois(p.mois).catch(() => null)
    const quoi = r.depenseId
      ? `Dépense ajoutée à ${nomMoisDe(p.mois)} : ${libelleDepenseParrainage(p.mois)}, ${detailParParrain(r.e.dus)} = ${(r.e.du / 100).toFixed(2).replace('.', ',')} €, `
        + `produit ${produit}, côté ${cote === 'mel' ? 'Mel' : 'Brice'}, payée par ${cote === 'mel' ? 'Mel' : 'Brice'}.`
      : `Dépense des commissions de parrainage ${deMoisLibelle(p.mois)} retirée : plus rien à verser ce mois-là.`
    return `${quoi}${r.e.depense && r.depenseId ? ' L\'ancienne dépense est retirée.' : ''}${solde ? `\n${solde}` : ''}`
      + '\nReste à verser les commissions aux parrains (hors du cockpit).'
  } catch (err) {
    if (relationAbsente(err) || /42703|column .* does not exist/i.test(messageErreur(err))) {
      throw new RefusAction(`Les tables du parrainage ne sont pas encore à jour (migration ${MIGRATION_DECLARATION} à appliquer) : rien n'a été déclaré.`)
    }
    if (/23505|unique/i.test(messageErreur(err))) {
      throw new RefusAction(`Les commissions de parrainage ${deMoisLibelle(p.mois)} viennent d'être déclarées : rien n'a été refait.`)
    }
    throw err
  }
}

function nomMoisDe(mois: string): string {
  return deMoisLibelle(mois).replace(/^d'|^de /, '')
}

export type FilleulFenetre = {
  abonnementId: string; creeLe: string; code: string; parrain: string; pseudo: string | null; montant: number; devise: string
  commission: number; tauxPct: number; rang: number; mois: string; notification: string | null
}

/** Les filleuls notes dans une fenetre (resume du matin). Jette : le resume en fait une lecture facultative. */
export async function lireFilleulsFenetre(depuis: Date, jusqua: Date): Promise<FilleulFenetre[]> {
  const lignes = await prisma.$queryRaw<{
    abonnement_id: string; cree_le: Date; code: string; parrain: string; parrain_pseudo: string | null; montant: number; devise: string
    commission: number; taux_pct: number; rang: number; mois: string; notification: string | null
  }[]>`
    select f.abonnement_id, f.cree_le, f.code, p.parrain, p.parrain_pseudo, f.montant_paye::float8 as montant, f.devise,
      f.commission::float8 as commission, f.taux_pct::float8 as taux_pct, f.rang, f.mois, f.notification
    from public.cockpit_liveclub_filleuls f join public.cockpit_liveclub_parrains p on p.code_id = f.code_id
    where f.cree_le > ${depuis} and f.cree_le <= ${jusqua}
    order by f.cree_le limit 100`
  return lignes.map(l => ({
    abonnementId: l.abonnement_id, creeLe: l.cree_le.toISOString(), code: l.code, parrain: l.parrain, pseudo: l.parrain_pseudo,
    montant: Math.round(Number(l.montant) * 100), devise: l.devise, commission: Math.round(Number(l.commission) * 100),
    tauxPct: Number(l.taux_pct), rang: Number(l.rang), mois: l.mois, notification: l.notification,
  }))
}

// ---------------------------------------------------------------------------
// La carte d'Agent AOK : ajouter ou modifier un code de parrainage
// ---------------------------------------------------------------------------

export type ControleCodeParrainage = { action: ActionAgent; carte: string; manque: string | null } | { erreur: string }

/**
 * Avant la carte (lecture seule) : la ligne existante du code (modification)
 * ou rien (nouveau code, le parrain est alors exige), le compte Telegram du
 * parrain cherche par son pseudo. La carte est composee par le serveur.
 */
export async function controlerCodeParrainage(action: ActionAgent): Promise<ControleCodeParrainage> {
  const p = lireParamsCodeParrainage(action.params)
  if (typeof p === 'string') return { erreur: p }
  let existant: CodeParrainage | null
  try {
    existant = await codeParCle(p.code)
  } catch (err) {
    if (relationAbsente(err)) return { erreur: ABSENTE }
    return { erreur: `Lecture impossible avant la carte (${messageErreur(err).slice(0, 160)}) : réessaie dans un instant.` }
  }
  if (!existant && !p.parrain) return { erreur: `Le code ${p.code} n'est pas encore un code de parrainage : il faut le parrain (son prénom) et son @pseudo Telegram.` }
  const params: ParamsCodeParrainage = { ...p, code_id: existant?.codeId ?? null }
  const apres = codeApres(params, existant, jourParisDe(new Date().toISOString()))
  // Le compte Telegram, cherche par le pseudo s'il n'est pas donne (lecture seule).
  if (params.telegram_id === null && apres.telegramId === null && apres.pseudo) {
    const trouve = await resoudreParrain({ ...apres, codeId: existant?.codeId ?? '' } as CodeParrainage)
    if (trouve !== null) params.telegram_id = trouve
  }
  const aujourdhui = jourParisDe(new Date().toISOString())
  return {
    action: { ...action, compte: 'cockpit', params: { ...params } },
    carte: carteCodeParrainage(params, existant, aujourdhui),
    manque: null,
  }
}

type IssueEnregistrement = { quoi: 'cree' | 'modifie' | 'inchange'; code: CodeParrainage }

/** L'ecriture, sous verrou par code : cree ou complete la ligne. Jette RefusAction sur une carte perimee. */
async function enregistrer(p: ParamsCodeParrainage, acteur: string, attendu: 'nouveau' | 'existant' | 'peu_importe'): Promise<IssueEnregistrement> {
  const aujourdhui = jourParisDe(new Date().toISOString())
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`liveclub:parrainage:code:${p.code.toUpperCase()}`}::text, 0))) as verrou`
    const lus = await tx.$queryRaw<LigneCode[]>`
      select code_id::text as code_id, code, parrain, parrain_pseudo, parrain_telegram_id, parrain_email,
        taux_pct::float8 as taux_pct, taux_palier_pct::float8 as taux_palier_pct, palier,
        to_char(depuis, 'YYYY-MM-DD') as depuis, actif
      from public.cockpit_liveclub_parrains where upper(code) = upper(${p.code}) limit 1 for update`
    const existant = lus[0] ? versCode(lus[0]) : null
    if (attendu === 'nouveau' && existant) throw new RefusAction(`Le code ${existant.code} a été enregistré entre-temps (parrain ${existant.parrain}) : redemande la carte pour le modifier.`)
    if (attendu === 'existant' && (!existant || existant.codeId !== p.code_id)) throw new RefusAction(`Le code ${p.code} a changé depuis la carte : redemande-la.`)
    const a = codeApres(p, existant, aujourdhui)
    if (!a.parrain) throw new RefusAction(`Le code ${p.code} n'a pas de parrain : redemande la carte avec son prénom.`)
    if (!existant) {
      const crees = await tx.$queryRaw<{ code_id: string }[]>`
        insert into public.cockpit_liveclub_parrains
          (code, parrain, parrain_pseudo, parrain_telegram_id, parrain_email, taux_pct, taux_palier_pct, palier, depuis, actif, pose_par, note)
        values (${a.code}, ${a.parrain}, ${a.pseudo}, ${a.telegramId}::bigint, ${a.email}, ${a.tauxPct}::numeric, ${a.tauxPalierPct}::numeric,
          ${a.palier}::int, ${a.depuis}::date, ${a.actif}, ${acteur}, ${p.note})
        returning code_id::text as code_id`
      return { quoi: 'cree', code: { ...a, codeId: crees[0].code_id } }
    }
    const pareil = a.parrain === existant.parrain && a.pseudo === existant.pseudo && a.telegramId === existant.telegramId
      && a.email === existant.email && a.tauxPct === existant.tauxPct && a.tauxPalierPct === existant.tauxPalierPct
      && a.palier === existant.palier && a.depuis === existant.depuis && a.actif === existant.actif && !p.note
    if (pareil) return { quoi: 'inchange', code: existant }
    await tx.$executeRaw`
      update public.cockpit_liveclub_parrains set
        parrain = ${a.parrain}, parrain_pseudo = ${a.pseudo}, parrain_telegram_id = ${a.telegramId}::bigint, parrain_email = ${a.email},
        taux_pct = ${a.tauxPct}::numeric, taux_palier_pct = ${a.tauxPalierPct}::numeric, palier = ${a.palier}::int,
        depuis = ${a.depuis}::date, actif = ${a.actif}, maj_par = ${acteur}, maj_le = now(),
        note = coalesce(${p.note}, note)
      where code_id = ${existant.codeId}::uuid`
    return { quoi: 'modifie', code: { ...a, codeId: existant.codeId } }
  })
}

/** Le clic de la carte « code de parrainage ». */
export async function executerCodeParrainage(action: ActionAgent, acteur: string): Promise<string> {
  const p = lireParamsCodeParrainage(action.params)
  if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a été fait.`)
  try {
    const r = await enregistrer(p, acteur, p.code_id ? 'existant' : 'nouveau')
    if (r.quoi === 'cree') return `Code de parrainage ${r.code.code} enregistré pour ${r.code.parrain}. Ses prochains filleuls seront notés à leur premier paiement.`
    if (r.quoi === 'inchange') return `Le code de parrainage ${r.code.code} était déjà enregistré tel quel : rien n'a changé.`
    return r.code.actif
      ? `Code de parrainage ${r.code.code} modifié (${r.code.parrain}). Les filleuls déjà notés gardent leur commission.`
      : `Code de parrainage ${r.code.code} désactivé : les prochains abonnés avec ce code ne seront plus comptés pour ${r.code.parrain}.`
  } catch (err) {
    if (relationAbsente(err)) throw new RefusAction(ABSENTE)
    throw err
  }
}

/**
 * Apres la creation d'un code promo AVEC parrain (carte de code promo, compte
 * melanie) : le code devient aussi un code de parrainage, aux taux par
 * defaut. Ne jette pas : le code promo existe deja chez Stripe, la phrase dit
 * ce qui reste a faire.
 */
export async function enregistrerCodeParrainage(code: string, parrain: ParrainCodePromo, acteur: string): Promise<string> {
  const p = lireParamsCodeParrainage({
    code, parrain: parrain.parrain, pseudo: parrain.parrain_pseudo, telegram_id: parrain.parrain_telegram_id, email: parrain.parrain_email,
  })
  if (typeof p === 'string') return `Pas enregistré comme code de parrainage : ${p}`
  try {
    if (p.telegram_id === null && p.pseudo) {
      const trouve = await resoudreParrain({ codeId: '', code: p.code, parrain: p.parrain ?? '', pseudo: p.pseudo, telegramId: null, email: null, tauxPct: 0, tauxPalierPct: 0, palier: 0, depuis: '', actif: true })
      if (trouve !== null) p.telegram_id = trouve
    }
    const r = await enregistrer(p, acteur, 'peu_importe')
    return r.quoi === 'cree'
      ? `Enregistré comme code de parrainage de ${r.code.parrain} : ses filleuls seront notés à leur premier paiement.`
      : `Déjà un code de parrainage (${r.code.parrain}) : ${r.quoi === 'inchange' ? 'rien n\'a changé' : 'parrain mis à jour'}.`
  } catch (err) {
    if (relationAbsente(err)) return `Pas enregistré comme code de parrainage : ${ABSENTE} Redemande la carte de parrainage une fois la migration passée.`
    return `Pas enregistré comme code de parrainage (${messageErreur(err).slice(0, 120)}) : redemande la carte de parrainage.`
  }
}
