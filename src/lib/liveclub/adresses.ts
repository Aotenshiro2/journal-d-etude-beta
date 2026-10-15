// Rattachement automatique d'une adresse email a une personne connue, sur
// PREUVE (Brice, 15/10). Les regles sont PURES (adresses-pur.ts, testees par
// scripts/verifier-liveclub.mjs) ; ici, la base.
//
// Deux appelants :
// - reserves.ts, quand un tarif reserve est marque paye par un abonnement
//   dont l'adresse n'est pas celle de la reservation (page de bienvenue,
//   passage quotidien, bot) : preuve 'tarif_reserve' ;
// - rattacher.ts, quand un compte Telegram passe d'une adresse a une autre,
//   les deux fois par lien personnel ou code email : preuve 'telegram'.
//
// Ce qui s'ecrit, dans UNE transaction, sous verrou sur chaque adresse :
// - le compte AOK : profile_emails, adresse secondaire (is_primary false),
//   verified true, source 'paiement' ou 'telegram' ;
// - la fiche du cockpit : cockpit_membre_emails, principal false (comme le
//   rattachement manuel du cockpit), verifie true.
// Jamais d'ecrasement : une adresse deja sur un autre compte AOK, ou sur une
// autre fiche avec un abonnement vivant que la preuve ne couvre pas, ne bouge
// pas, et le conflit est signale (log, journal du bot, resume du matin).
//
// Le journal du bot (cockpit_liveclub_gestes, geste 'adresse', migration
// 20261015120000) garde la trace sans email : des identifiants (reservation,
// client Stripe, rattachements) qui permettent au resume du matin de
// retrouver les adresses. Avant la migration, la ligne est perdue (loggue),
// jamais le rattachement.
//
// Rien ici ne jette : une panne laisse les adresses comme elles etaient.

import { prisma } from '@/lib/db'
import { journaliserGesteLiveClub } from '@/lib/stripe-actions'
import { messageErreur, normaliserEmail } from './pur'
import {
  detailsDuPlan, planRattachement, resultatDuPlan,
  type AbonnementFiche, type AdresseLue, type PlanRattachement, type PreuveAdresse,
} from './adresses-pur'

const ACTEUR = 'serveur:adresses'

export type PreuveRattachement =
  | {
      preuve: 'tarif_reserve'
      /** L'adresse de la reservation (la personne connue). */
      emailReserve: string
      /** L'adresse du paiement (celle qu'on rattache). */
      emailPaiement: string
      reserveId: string
      abonnementId: string
      /** Le client Stripe du paiement (cus_...), pour retrouver l'adresse sans l'ecrire au journal. */
      clientPaiement: string | null
      telegramId: number | null
    }
  | {
      preuve: 'telegram'
      telegramId: number
      ancien: { rattachementId: string; email: string; clientStripe: string | null }
      nouveau: { rattachementId: string; email: string; clientStripe: string | null }
    }

export type IssueAdresse =
  | { etat: 'fait' | 'conflit' | 'rien'; plan: PlanRattachement }
  | { etat: 'panne' }

type LigneCompte = { email: string; profile_id: string; verified: boolean }
type LigneFiche = { email: string; membre_id: string }
type LigneAbonnement = { membre_id: string; abonnement_id: string; statut: string; client_stripe: string | null }

/** Les deux adresses de la preuve, normalisees : [connue, nouvelle]. */
function adresses(p: PreuveRattachement): [string | null, string | null] {
  return p.preuve === 'tarif_reserve'
    ? [normaliserEmail(p.emailReserve), normaliserEmail(p.emailPaiement)]
    : [normaliserEmail(p.ancien.email), normaliserEmail(p.nouveau.email)]
}

function couverts(p: PreuveRattachement): { abonnements: string[]; clients: string[] } {
  return p.preuve === 'tarif_reserve'
    ? { abonnements: [p.abonnementId], clients: [] }
    : { abonnements: [], clients: [p.ancien.clientStripe, p.nouveau.clientStripe].filter((c): c is string => Boolean(c)) }
}

/**
 * Rattache l'adresse prouvee a la personne connue (compte AOK et fiche du
 * cockpit), selon planRattachement. Journalise le resultat (geste
 * 'adresse'). Ne jette jamais.
 */
export async function rattacherAdresseSurPreuve(p: PreuveRattachement): Promise<IssueAdresse> {
  const [connue, nouvelle] = adresses(p)
  if (!connue || !nouvelle || connue === nouvelle) {
    return { etat: 'rien', plan: { conflit: null, compte: { action: 'rien', raison: 'deja' }, fiche: { action: 'rien', raison: 'deja' } } }
  }
  const source: PreuveAdresse = p.preuve
  const sourceCompte = p.preuve === 'tarif_reserve' ? 'paiement' : 'telegram'

  let plan: PlanRattachement
  // La fiche de la personne, pour la ligne du journal (posee dans la transaction).
  const ancre: { membreId: string | null } = { membreId: null }
  try {
    plan = await prisma.$transaction(async tx => {
      // Un verrou par adresse, toujours dans le meme ordre : deux preuves
      // simultanees sur la meme adresse se suivent au lieu de se croiser.
      for (const e of [connue, nouvelle].sort()) {
        await tx.$queryRaw`
          select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`adresse:${e}`}::text, 0))) as verrou`
      }
      const emails = [connue, nouvelle]
      const comptes = await tx.$queryRaw<LigneCompte[]>`
        select lower(email) as email, profile_id::text as profile_id, verified
        from public.profile_emails where lower(email) = any(${emails}::text[])`
      const fiches = await tx.$queryRaw<LigneFiche[]>`
        select email, membre_id::text as membre_id
        from public.cockpit_membre_emails where email = any(${emails}::text[])`
      const membres = [...new Set(fiches.map(f => f.membre_id))]
      const abonnements = membres.length === 0 ? [] : await tx.$queryRaw<LigneAbonnement[]>`
        select membre_id::text as membre_id, abonnement_id, statut, client_stripe
        from public.cockpit_abonnements where membre_id::text = any(${membres}::text[])`

      const lue = (email: string): AdresseLue => {
        const c = comptes.find(x => x.email === email)
        const f = fiches.find(x => x.email === email)
        return {
          email,
          compte: c ? { profileId: c.profile_id, verifie: c.verified } : null,
          fiche: f ? { membreId: f.membre_id } : null,
        }
      }
      const parFiche: Record<string, AbonnementFiche[]> = {}
      for (const a of abonnements) {
        (parFiche[a.membre_id] ??= []).push({ id: a.abonnement_id, statut: a.statut, client: a.client_stripe })
      }
      const entree = { preuve: source, connue: lue(connue), nouvelle: lue(nouvelle), abonnementsParFiche: parFiche, couverts: couverts(p) }
      const decide = planRattachement(entree)
      ancre.membreId = decide.fiche.action === 'ajouter' ? decide.fiche.membreId
        : entree.connue.fiche?.membreId ?? entree.nouvelle.fiche?.membreId ?? null
      if (decide.conflit) return decide

      let compte = decide.compte
      if (compte.action === 'ajouter') {
        const n = await tx.$executeRaw`
          insert into public.profile_emails (profile_id, email, is_primary, verified, source)
          values (${compte.profileId}::uuid, ${compte.email}, false, true, ${sourceCompte})
          on conflict (email) do nothing`
        // Inseree entre la lecture et l'ecriture (un ajout depuis Mon espace) : on n'y touche pas.
        if (n === 0) compte = { action: 'rien', raison: 'deja' }
      } else if (compte.action === 'verifier') {
        const n = await tx.$executeRaw`
          update public.profile_emails set verified = true
          where lower(email) = ${compte.email} and profile_id = ${compte.profileId}::uuid and verified = false`
        if (n === 0) compte = { action: 'rien', raison: 'deja' }
      }
      let fiche = decide.fiche
      if (fiche.action === 'ajouter') {
        const n = await tx.$executeRaw`
          insert into public.cockpit_membre_emails (email, membre_id, principal, verifie)
          values (${fiche.email}, ${fiche.membreId}::uuid, false, true)
          on conflict (email) do nothing`
        if (n === 0) fiche = { action: 'rien', raison: 'deja' }
      }
      return { conflit: null, compte, fiche }
    })
  } catch (err) {
    console.warn(`[liveclub/adresses] rattachement ${source} impossible (${codeErreur(err)}) : ${messageErreur(err)}`)
    // Le message d'erreur reste dans le log (premiere ligne seulement) : le
    // journal ne garde qu'un code, une erreur Postgres pouvant citer la ligne.
    await journaliser(p, 'echec', { erreur: codeErreur(err), ajoutee: 'nouvelle' }, null)
    return { etat: 'panne' }
  }

  const resultat = resultatDuPlan(plan)
  const resume = `compte=${plan.compte.action === 'rien' ? plan.compte.raison : plan.compte.action} fiche=${plan.fiche.action === 'rien' ? plan.fiche.raison : plan.fiche.action}`
  if (plan.conflit) {
    console.warn(`[liveclub/adresses] CONFLIT ${source} (${plan.conflit}) : adresse non rattachee, a verifier`)
  } else {
    console.log(`[liveclub/adresses] ${source} : ${resume}`)
  }
  // Laquelle des deux adresses est rattachee (le resume la retrouve par les
  // identifiants de la preuve) : en preuve 'telegram', ce peut etre l'ancienne.
  const cible = plan.compte.action !== 'rien' ? plan.compte.email : plan.fiche.action === 'ajouter' ? plan.fiche.email : nouvelle
  const ajoutee = cible === connue ? 'connue' : 'nouvelle'
  if (resultat) await journaliser(p, resultat, { ...detailsDuPlan(plan), ajoutee }, ancre.membreId)
  return { etat: plan.conflit ? 'conflit' : resultat === 'fait' ? 'fait' : 'rien', plan }
}

/** Le code SQLSTATE d'une erreur Prisma (« Raw query failed. Code: `23505` »), sinon 'panne'. Rien d'autre du message. */
function codeErreur(err: unknown): string {
  const m = /Code: `([0-9A-Z]{5})`/.exec(err instanceof Error ? err.message : '')
  return m ? `sql_${m[1]}` : 'panne'
}

/** La ligne du journal du bot : des identifiants, jamais une adresse. */
async function journaliser(
  p: PreuveRattachement,
  resultat: 'fait' | 'refuse' | 'echec',
  details: Record<string, string>,
  membreId: string | null,
): Promise<void> {
  const refs: Record<string, string> = p.preuve === 'tarif_reserve'
    ? { reserve_id: p.reserveId, ...(p.clientPaiement ? { client_paiement: p.clientPaiement } : {}) }
    : { rattachement_ancien: p.ancien.rattachementId, rattachement_nouveau: p.nouveau.rattachementId }
  await journaliserGesteLiveClub(
    { geste: 'adresse', resultat, regle: p.preuve, details: { ...refs, ...details } },
    {
      telegramId: p.telegramId,
      membreId,
      acteur: ACTEUR,
      abonnementId: p.preuve === 'tarif_reserve' ? p.abonnementId : null,
    },
  )
}
