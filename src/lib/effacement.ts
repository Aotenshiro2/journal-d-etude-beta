// L'EFFACEMENT DES DONNEES D'UNE PERSONNE, cote serveur (Brice, 15/10/2026).
// Regles pures et textes : effacement-pur.ts. Inventaire qui fait foi :
// docs/EFFACEMENT-DONNEES.md. Base : migration
// 20261016090000_cockpit_effacement.sql (cockpit_effacement_cibles,
// cockpit_effacement_apercu, cockpit_effacer, role postgres seulement).
//
// Un seul chemin : l'outil proposer_effacement de l'agent du cockpit
// (agent-cockpit.ts), qui n'est servi qu'a l'equipe. Jamais automatique,
// jamais depuis un bot des membres (scripts/verifier-effacement.mjs le
// verifie statiquement).
//
// - Avant la carte (controlerActionEffacement) : la personne est resolue
//   comme pour fiche_personne (le resolveur est passe par l'agent, ce module
//   n'importe pas la fiche), puis l'APERCU compte, en transaction READ ONLY,
//   ce que le niveau effacerait. La carte le dit app par app.
// - Au clic (executerActionEffacement), niveau 3 : Stripe d'abord (arret a la
//   fin de la periode payee, programmerArret, abonnements relus en direct) ;
//   une panne Stripe arrete tout, rien n'est efface. Puis cockpit_effacer en
//   UNE transaction (le payeur est fige sur ses paiements en premier). Puis
//   Telegram : sortie sans ban (retirerDuLiveClub), apres l'effacement pour
//   qu'une exemption ne la bloque pas. Les gestes ne vont PAS au journal du
//   bot (ils recreeraient une trace de la personne) : cockpit_effacements
//   en garde les comptes.
// - Jamais un nom, un email ni un identifiant de la personne dans un log.

import { prisma } from '@/lib/db'
import { RefusAction, cleTelegramPresente, retirerDuLiveClub, type ActionAgent } from '@/lib/stripe-actions'
import { cleStripeEcriture, cleStripeLecture } from '@/lib/liveclub/config'
import { abonnementsLiveClubDuClient, clientsStripeParEmail, programmerArret, type AbonnementResume } from '@/lib/liveclub/stripe'
import { messageErreur, statutDonneDroit } from '@/lib/liveclub/pur'
import {
  lireParamsEffacement, lireCible, cibleVide, lireApercu, lireResultat, refusApercu, composerCarte, texteAvantCarte,
  externePourJournal, phraseResultat,
  type ApercuEffacement, type CibleEffacement, type Comptes, type IssueStripe, type IssueTelegram, type Niveau,
} from '@/lib/effacement-pur'

export const MIGRATION_EFFACEMENT = '20261016090000_cockpit_effacement.sql'

/** La personne designee, telle que la rend resoudrePersonnePourEffacement (fiche-personne.ts). */
export type ResolutionEffacement =
  | { statut: 'un'; ids: { telegram: number[]; membres: string[]; archives: string[] }; email: string | null; libelle: string }
  | { statut: 'plusieurs' | 'aucun' | 'erreur'; reponse: string; email: string | null }

export type ControleEffacement =
  | { erreur: string }
  | { action: ActionAgent; carte: string; avant: string; manque: string | null }

function fonctionAbsente(err: unknown): boolean {
  return /42883|function public\.cockpit_effac\w*\(.*\) does not exist|cockpit_effac\w* does not exist/i.test(messageErreur(err))
}

const MIGRATION_ABSENTE = `La migration ${MIGRATION_EFFACEMENT} n'est pas appliquée : l'effacement n'est pas encore possible. `
  + 'Dis-le à Brice, rien n\'a été proposé.'

/** L'apercu d'un niveau, en transaction READ ONLY (la fonction est STABLE en plus). Jette sur une panne. */
export async function lireApercuEffacement(niveau: Niveau, c: CibleEffacement): Promise<ApercuEffacement> {
  const lignes = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('set transaction read only')
    await tx.$executeRawUnsafe(`set local statement_timeout = '15000ms'`)
    return tx.$queryRawUnsafe<{ a: string }[]>(
      'select public.cockpit_effacement_apercu($1::int, $2::bigint[], $3::uuid[], $4::text[], $5::text[])::text as a',
      niveau, c.telegram, c.membres, c.emails, c.archives)
  }, { maxWait: 5000, timeout: 25000 })
  const a = lireApercu(lignes[0]?.a)
  if (!a) throw new Error("apercu illisible")
  return a
}

/** Les cibles completes (comptes Telegram, fiches, emails, comptes AOK), en lecture seule. */
async function lireCiblesCompletes(c: CibleEffacement): Promise<{ telegram: number[]; membres: string[]; emails: string[] }> {
  const lignes = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('set transaction read only')
    return tx.$queryRawUnsafe<{ c: string }[]>(
      'select to_jsonb(x)::text as c from public.cockpit_effacement_cibles($1::bigint[], $2::uuid[], $3::text[], $4::text[]) x',
      c.telegram, c.membres, c.emails, c.archives)
  })
  const o = JSON.parse(lignes[0]?.c ?? '{}') as Record<string, unknown>
  const liste = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]) : [])
  return {
    telegram: liste('telegram_ids').map(Number).filter((x) => Number.isSafeInteger(x) && x > 0),
    membres: liste('membre_ids').map(String),
    emails: liste('emails').map(String),
  }
}

/** La reponse « plusieurs » de la fiche, avec la consigne de l'effacement. */
function candidatsPourEffacement(reponse: string): string {
  try {
    const o = JSON.parse(reponse) as Record<string, unknown>
    o.consigne = 'Plusieurs personnes correspondent. Ne choisis pas : montre-les (nom, ce qui les distingue), demande laquelle, '
      + 'puis rappelle proposer_effacement avec son identifiant (u..., membre:<uuid>, p-...). Un lien PROBABLE n\'est jamais une preuve.'
    return JSON.stringify(o)
  } catch {
    return reponse
  }
}

/**
 * Le controle AVANT la carte : la personne, l'apercu, les refus. `erreur`
 * retourne au modele (il demande, ou dit pourquoi) ; sinon la carte, le texte
 * a dire a la personne avant (ajoute par l'agent avant la carte) et ce qui
 * manque pour executer.
 */
export async function controlerActionEffacement(
  a: ActionAgent,
  resoudre: (qui: string) => Promise<ResolutionEffacement>,
): Promise<ControleEffacement> {
  const p = lireParamsEffacement(a.params)
  if (typeof p === 'string') return { erreur: p }

  const r = await resoudre(p.qui)
  if (r.statut === 'plusieurs') return { erreur: candidatsPourEffacement(r.reponse) }
  if (r.statut === 'erreur') {
    try {
      return { erreur: String((JSON.parse(r.reponse) as { erreur?: unknown }).erreur ?? 'Recherche impossible.') }
    } catch {
      return { erreur: 'Recherche de la personne impossible : réessaie dans un instant.' }
    }
  }
  const ids = r.statut === 'un' ? r.ids : { telegram: [], membres: [], archives: [] }
  // Un email sans fiche ni compte Telegram (un compte AOK seul, un inscrit a
  // la masterclass) reste une cible : l'apercu dira s'il y a quelque chose.
  if (r.statut === 'aucun' && !r.email) {
    return { erreur: `Personne trouvée pour « ${p.qui} » : ni nom, ni compte Telegram, ni fiche. Demande une autre orthographe, `
      + 'le @pseudo, le numéro Telegram (u...) ou son email. Rien n\'a été proposé.' }
  }
  const cible = lireCible({ ...ids, emails: r.email ? [r.email] : [] })
  if (typeof cible === 'string') return { erreur: `${cible} Rien n'a été proposé.` }
  if (cibleVide(cible)) return { erreur: 'Aucun identifiant pour cette personne : rien n\'a été proposé.' }

  let apercu: ApercuEffacement
  try {
    apercu = await lireApercuEffacement(p.niveau, cible)
  } catch (err) {
    if (fonctionAbsente(err)) return { erreur: MIGRATION_ABSENTE }
    console.error(`[cockpit/effacement] apercu impossible : ${messageErreur(err)}`)
    return { erreur: `Lecture impossible avant la carte (${messageErreur(err).slice(0, 160)}) : réessaie dans un instant.` }
  }
  const refus = refusApercu(apercu)
  if (refus) return { erreur: refus }

  const manque: string[] = []
  if (p.niveau === 3) {
    if (!cleStripeLecture()) manque.push("aucune clé Stripe du compte melanie (STRIPE_READ_KEY_MELANIE ou STRIPE_AGENT_KEY_MELANIE) : impossible de vérifier ses abonnements")
    if ((apercu.externe.abonnements_live_club_vivants ?? 0) > 0 && !cleStripeEcriture()) {
      manque.push("la clé d'écriture STRIPE_AGENT_KEY_MELANIE manque : impossible d'arrêter son abonnement")
    }
    if (cible.telegram.length + (apercu.cibles.comptes_telegram ?? 0) > 0 && !cleTelegramPresente()) {
      manque.push("le bot du groupe Live Club n'est pas configuré (TELEGRAM_LIVECLUB_BOT_TOKEN, TELEGRAM_LIVECLUB_CHAT_ID) : impossible de le sortir du groupe")
    }
  }

  return {
    action: { type: 'effacement', compte: 'cockpit', params: { niveau: p.niveau, qui: p.qui.slice(0, 80), cible } },
    carte: composerCarte(p.qui.slice(0, 80), apercu),
    avant: texteAvantCarte(p.niveau),
    manque: manque.length ? `Rien ne peut être exécuté : ${manque.join(' ; ')}.` : null,
  }
}

/**
 * Niveau 3 : les abonnements Live Club de la personne, relus EN DIRECT chez
 * Stripe (ses clients connus en base, plus ceux de ses emails), arretes a la
 * fin de la periode payee. Jette sur une panne : rien ne sera efface.
 */
async function arreterAbonnements(c: { telegram: number[]; membres: string[]; emails: string[] }): Promise<IssueStripe> {
  if (!cleStripeLecture()) throw new Error("Aucune clé Stripe du compte melanie : impossible de vérifier ses abonnements. Rien n'a été effacé.")
  const clients = new Set<string>()
  const lignes = await prisma.$queryRawUnsafe<{ c: string | null }[]>(`
    select client_stripe as c from public.cockpit_abonnements
     where membre_id = any($1::uuid[]) and client_stripe is not null
    union
    select client_stripe from public.cockpit_liveclub_rattachements
     where client_stripe is not null
       and (telegram_id = any($2::bigint[]) or membre_id = any($1::uuid[]) or lower(email) = any($3::text[]))`,
  c.membres, c.telegram, c.emails)
  for (const l of lignes) if (l.c && /^cus_[A-Za-z0-9]{8,}$/.test(l.c)) clients.add(l.c)
  for (const e of c.emails) for (const id of await clientsStripeParEmail(e)) clients.add(id)

  const abonnements = new Map<string, AbonnementResume>()
  for (const client of clients) for (const ab of await abonnementsLiveClubDuClient(client)) abonnements.set(ab.id, ab)

  const issue: IssueStripe = { arretes: [], dejaPrevus: 0, impayes: 0 }
  for (const ab of abonnements.values()) {
    if (ab.statut === 'unpaid') { issue.impayes++; continue }
    if (!statutDonneDroit(ab.statut)) continue
    if (ab.arretPrevu) { issue.dejaPrevus++; continue }
    if (!cleStripeEcriture()) {
      throw new Error("La clé d'écriture STRIPE_AGENT_KEY_MELANIE manque : son abonnement ne peut pas être arrêté. Rien n'a été effacé.")
    }
    try {
      const apres = await programmerArret(ab.id)
      issue.arretes.push({ fin: apres.finPeriode })
    } catch (err) {
      throw new Error(`Stripe a refusé l'arrêt d'un abonnement (${messageErreur(err).slice(0, 160)}) : rien n'a été effacé`
        + (issue.arretes.length ? `, mais ${issue.arretes.length} arrêt(s) à la fin de la période payée sont déjà programmés` : '')
        + ". Réessaie dans un instant, ou arrête-le au Dashboard Stripe puis redemande l'effacement.")
    }
  }
  return issue
}

/** Niveau 3 : la sortie du groupe, sans ban, compte par compte. Ne jette pas. */
async function sortirDuGroupe(telegram: number[]): Promise<IssueTelegram> {
  const t: IssueTelegram = { sortis: 0, absents: 0, refuses: 0, echecs: 0, comptesEnEchec: [] }
  for (const id of telegram) {
    try {
      const issue = await retirerDuLiveClub(id)
      if (issue.ok) t.sortis++
      else if (issue.regle === 'absent_du_groupe') t.absents++
      else if (issue.resultat === 'refuse') t.refuses++
      else { t.echecs++; t.comptesEnEchec.push(id) }
    } catch {
      t.echecs++
      t.comptesEnEchec.push(id)
    }
  }
  return t
}

/**
 * L'execution, apres le clic. Rend le resultat pour l'equipe, qui finit par
 * le recapitulatif a transmettre a la personne. RefusAction = rien n'a ete
 * fait (garde-fou) ; Error = panne (le message dit ce qui a deja ete fait).
 */
export async function executerActionEffacement(a: ActionAgent, acteur: string): Promise<string> {
  const p = lireParamsEffacement(a.params)
  if (typeof p === 'string') throw new RefusAction(p)
  if (!p.cible || cibleVide(p.cible)) throw new RefusAction("Carte sans personne : redemande l'effacement à l'agent.")
  const cible = p.cible

  let stripe: IssueStripe | null = null
  let externe: Comptes = {}
  let telegram: number[] = cible.telegram
  if (p.niveau === 3) {
    let completes: Awaited<ReturnType<typeof lireCiblesCompletes>>
    let apercu: ApercuEffacement
    try {
      completes = await lireCiblesCompletes(cible)
      apercu = await lireApercuEffacement(3, cible)
    } catch (err) {
      if (fonctionAbsente(err)) throw new Error(`La migration ${MIGRATION_EFFACEMENT} n'est pas appliquée : rien n'a été effacé.`)
      throw new Error(`Lecture impossible avant l'effacement (${messageErreur(err).slice(0, 160)}) : rien n'a été effacé.`)
    }
    const refus = refusApercu(apercu)
    if (refus) throw new RefusAction(refus)
    externe = apercu.externe
    telegram = completes.telegram
    stripe = await arreterAbonnements(completes)
  }

  let brut: string | undefined
  try {
    const lignes = await prisma.$queryRawUnsafe<{ r: string }[]>(
      'select public.cockpit_effacer($1::int, $2::bigint[], $3::uuid[], $4::text[], $5::text[], $6::text)::text as r',
      p.niveau, cible.telegram, cible.membres, cible.emails, cible.archives, acteur.slice(0, 80))
    brut = lignes[0]?.r
  } catch (err) {
    const deja = stripe?.arretes.length
      ? ` ATTENTION : ${stripe.arretes.length} arrêt(s) d'abonnement à la fin de la période payée sont déjà programmés chez Stripe.`
      : ''
    if (fonctionAbsente(err)) throw new Error(`La migration ${MIGRATION_EFFACEMENT} n'est pas appliquée : rien n'a été effacé.${deja}`)
    const garde = /cockpit_effacer : ([^\n]+)/.exec(messageErreur(err))
    if (garde) throw new RefusAction(`Refusé par la base : ${garde[1]}. Rien n'a été effacé.${deja}`)
    console.error(`[cockpit/effacement] niveau ${p.niveau} refuse par la base : ${messageErreur(err)}`)
    throw new Error(`La base a refusé l'effacement (${messageErreur(err).slice(0, 160)}) : rien n'a été effacé.${deja}`)
  }
  const resultat = lireResultat(brut)
  if (!resultat) throw new Error("Effacement fait, mais son compte rendu est illisible : vérifie le journal cockpit_effacements.")

  const sortie = p.niveau === 3 && telegram.length ? await sortirDuGroupe(telegram) : null

  if (resultat.effacementId && (stripe || sortie)) {
    try {
      await prisma.$executeRawUnsafe(
        'update public.cockpit_effacements set externe = $1::jsonb where effacement_id = $2::uuid',
        JSON.stringify(externePourJournal(stripe, sortie)), resultat.effacementId)
    } catch (err) {
      console.warn(`[cockpit/effacement] gestes externes non journalises : ${messageErreur(err)}`)
    }
  }
  console.log(`[cockpit/effacement] niveau ${p.niveau} fait (${resultat.effacementId ?? '?'})`)
  return phraseResultat(resultat, { stripe, telegram: sortie, externe })
}
