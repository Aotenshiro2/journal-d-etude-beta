// Les droits d'un compte du site sur l'academie (15/10/2026).
//
// droitsAcademie(userId) : LA regle d'acces (PLAN-ACADEMIE.md, section 4.3),
// une seule fonction pour la route de lecture, le suivi et l'ecran d'accueil.
// Elle fait l'union de :
//   - l'equipe : profiles.role = 'admin' ouvre tout (le role METIER vit dans
//     profiles.role ; auth.users.role reste 'authenticated') ;
//   - le statut ETM actif (cockpit_statut_etm, par un email verifie) : tout ;
//   - tout compte : l'offre « compte gratuit », les lecons d'usage
//     externe_compte ou externe_libre, les lecons d'apercu ;
//   - les acces actifs (academie_acces) par user_id OU par un email VERIFIE
//     du compte (email confirme de auth.users, profile_emails verified) ;
//   - le Live Club EN DIRECT : acces broker actif ou acces manuel du cockpit
//     (lus en base), sinon abonnement chez Stripe MelTrade par email
//     (abonnementsLiveClubParEmail, memes statuts que droitLiveClub :
//     meilleurAbonnement). Actif, il ouvre l'offre « live club » (le paquet
//     du moment) et les acces de source liveclub (paquet d'entree) ; arrete,
//     ces lignes restent en base, suspendues, et reviennent avec lui.
//     Les EXEMPTIONS du Live Club ne comptent pas encore : elles sont posees
//     sur un compte Telegram, et un compte du site n'est pas encore lie a
//     Telegram (bouton « lier mon Telegram », plan 4.5). A brancher alors.
//   - le secours de la page d'essai (decision B du 06/10, voir pur.ts,
//     FaitsCompte.secoursEssai) : rang Skool vip ou premium, abonnement vu
//     par le cockpit, acces mentorat manuel. N'ouvre que le module « essai »,
//     jusqu'au transvasage des acces Skool (plan 4.4).
//
// Performances : deux lectures en base (identite, puis faits du cockpit et
// acces en parallele), et Stripe seulement si le Live Club peut changer
// quelque chose (pas pour l'equipe, l'ETM, ni un compte sans contenu Live
// Club a ouvrir). Stripe : cache par email (oui 10 min, non 5 min, 500
// entrees), 4 s au plus par email ; un delai ou une erreur rend le Live Club
// 'inconnu', sans cache.
//
// Jamais un faux « non » : une base illisible fait JETER droitsAcademie (la
// route repond 503) ; un Stripe illisible rend 'inconnu' les contenus que
// seul le Live Club ouvrirait (la route de lecture repond 503 pour eux,
// l'ecran les montre « inconnu »).
//
// aAccesAcademieEssai (plus bas) est la regle de l'essai d'avant les tables :
// la route de lecture ne s'en sert plus que si les tables academie_* sont
// absentes (code deploye avant la migration).

import { prisma } from '@/lib/db'
import { checkMentoratAccess, type MentoratReason } from '@/lib/entitlements'
import { abonnementsLiveClubParEmail } from '@/lib/liveclub/stripe'
import { lireProduitsLiveClub } from '@/lib/liveclub/produits'
import { meilleurAbonnement } from '@/lib/liveclub/pur'
import {
  CacheCourt, conclureLiveClub, liveClubUtile, preparerDroits,
  type Droits, type EtatLiveClub, type FaitsCompte, type LigneAcces,
} from './pur'
import { SQL_ACCES, SQL_FAITS_COCKPIT, SQL_IDENTITE } from './requetes'

export type DroitsAcademie = Droits & {
  /** Sources illisibles (codes courts, sans donnee personnelle), pour les logs. */
  erreurs: string[]
}

// ---------------------------------------------------------------------------
// Live Club chez Stripe MelTrade, par email
// ---------------------------------------------------------------------------

const STRIPE_DELAI_MS = 4000
const CACHE_OUI_MS = 10 * 60 * 1000
const CACHE_NON_MS = 5 * 60 * 1000
const cacheLiveClub = new CacheCourt<boolean>(500)
const erreursSignalees = new Set<string>()

function signalerUneFois(code: string, message: string) {
  if (erreursSignalees.has(code)) return
  erreursSignalees.add(code)
  console.warn(`[academie/droits] ${message} (signale une seule fois par instance)`)
}

class DelaiDepasse extends Error {
  constructor() {
    super('delai depasse')
    this.name = 'DelaiDepasse'
  }
}

/** La promesse, ou une DelaiDepasse au bout de ms. L'appel continue en fond, sans effet. */
function avecDelai<T>(promesse: Promise<T>, ms: number): Promise<T> {
  let minuteur: ReturnType<typeof setTimeout> | undefined
  const delai = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new DelaiDepasse()), ms)
  })
  return Promise.race([promesse, delai]).finally(() => clearTimeout(minuteur))
}

async function liveClubParEmail(email: string): Promise<'oui' | 'non' | 'inconnu'> {
  const enCache = cacheLiveClub.lire(email)
  if (enCache !== undefined) return enCache ? 'oui' : 'non'
  try {
    const abonnements = await avecDelai(abonnementsLiveClubParEmail(email), STRIPE_DELAI_MS)
    if (meilleurAbonnement(abonnements)) {
      cacheLiveClub.ecrire(email, true, CACHE_OUI_MS)
      return 'oui'
    }
    // Comme droitLiveClub : sans la liste complete des produits Live Club, un
    // abonnement d'un produit inscrit depuis a pu etre ignore. Pas de 'non'.
    if (!(await lireProduitsLiveClub()).complete) {
      signalerUneFois('produits', 'liste des produits Live Club incomplete : Live Club inconnu')
      return 'inconnu'
    }
    cacheLiveClub.ecrire(email, false, CACHE_NON_MS)
    return 'non'
  } catch (err) {
    const nom = err instanceof Error ? err.name : 'erreur'
    // Jamais le message : il peut reprendre la requete (et donc l'email).
    signalerUneFois(`stripe:${nom}`, nom === 'DelaiDepasse'
      ? `Stripe MelTrade n'a pas repondu en ${STRIPE_DELAI_MS} ms : Live Club inconnu, sans cache`
      : `Stripe MelTrade illisible (${nom}) : Live Club inconnu, sans cache`)
    return 'inconnu'
  }
}

// ---------------------------------------------------------------------------
// La regle
// ---------------------------------------------------------------------------

type LigneIdentite = { role: string | null; emails: string[] | null }
type LigneCockpit = {
  etm: boolean; broker_jusquau: string | null; manuel_jusquau: string | null; secours_essai: boolean
}
type LigneAccesSql = {
  origine: 'acces' | 'base' | 'essai'; source: string | null; slug: string | null; ouvre_tout: boolean
  module_id: string | null; section_id: string | null
}

/**
 * Les droits d'un compte sur l'academie. Jette si la base est illisible
 * (tables absentes comprises : relationAbsente le dit a l'appelant).
 */
export async function droitsAcademie(userId: string): Promise<DroitsAcademie> {
  const identite = (await prisma.$queryRawUnsafe<LigneIdentite[]>(SQL_IDENTITE, userId))[0]
  const emails = identite?.emails ?? []
  const admin = identite?.role === 'admin'

  const [cockpit, lignesSql] = await Promise.all([
    prisma.$queryRawUnsafe<LigneCockpit[]>(SQL_FAITS_COCKPIT, emails),
    prisma.$queryRawUnsafe<LigneAccesSql[]>(SQL_ACCES, userId, emails),
  ])
  const c = cockpit[0]
  const lignes: LigneAcces[] = lignesSql.map(l => ({
    origine: l.origine,
    source: l.source,
    slug: l.slug,
    ouvreTout: l.ouvre_tout === true,
    moduleId: l.module_id,
    sectionId: l.section_id,
  }))
  const faits: Omit<FaitsCompte, 'liveClub'> = {
    admin,
    etm: c?.etm === true,
    secoursEssai: c?.secours_essai === true,
    lignes,
  }

  const erreurs: string[] = []
  let liveClub: EtatLiveClub = 'non_lu'
  if (liveClubUtile(faits)) {
    const brokerOuManuel = Boolean(c?.broker_jusquau || c?.manuel_jusquau)
    const stripe = brokerOuManuel ? [] : await Promise.all(emails.map(liveClubParEmail))
    liveClub = conclureLiveClub({ brokerOuManuel, stripe })
    if (liveClub === 'inconnu') erreurs.push('liveclub: stripe illisible')
  }

  return { ...preparerDroits({ ...faits, liveClub }), erreurs }
}

/**
 * Les droits d'un visiteur sans compte (19/10/2026, /api/academie/catalogue) :
 * seulement les offres de base (compte gratuit, Live Club), Live Club non lu.
 * Ce que le compte gratuit ouvre sort donc « ouvert » avec la raison
 * 'compte' : la page dit « gratuit avec un compte », elle ne le lit pas.
 */
export async function droitsVisiteur(): Promise<DroitsAcademie> {
  const lignesSql = await prisma.$queryRawUnsafe<LigneAccesSql[]>(SQL_ACCES, '00000000-0000-0000-0000-000000000000', [])
  const lignes: LigneAcces[] = lignesSql
    .filter(l => l.origine === 'base')
    .map(l => ({
      origine: l.origine, source: l.source, slug: l.slug, ouvreTout: l.ouvre_tout === true, moduleId: l.module_id, sectionId: l.section_id,
    }))
  return { ...preparerDroits({ admin: false, etm: false, secoursEssai: false, liveClub: 'non_lu', lignes }), erreurs: [] }
}

// ---------------------------------------------------------------------------
// L'essai d'avant les tables (decision B, 06/10)
// ---------------------------------------------------------------------------
//
// La page d'essai est visible par Brice et par tout membre payant (Live
// Club, Premium, VIP, ETM), PAS par le Carnet Premium seul. Donc, dans
// l'ordre : profiles.role = 'admin', sinon checkMentoratAccess
// (src/lib/entitlements.ts), qui rend UNE raison : etm, manuel, liveclub,
// skool-vip, skool-premium, formation ouvrent, carnet-premium n'ouvre pas.
// checkMentoratAccess essaie le Carnet Premium en DERNIER : s'il rend
// 'carnet-premium', c'est qu'aucune autre raison n'a ete trouvee, l'exclure
// ne cache donc aucun membre payant. Le Live Club y est lu par l'etat du
// cockpit (abonnement_en_cours, rafraichi chaque matin).
//
// Jette si la base est illisible : la route en fait un 503, jamais un refus.

export type RaisonAcademieEssai = 'admin' | Exclude<MentoratReason, 'carnet-premium'>

export type AccesAcademieEssai = {
  acces: boolean
  /** Pourquoi le compte a acces (utile a la page), null s'il n'a pas acces. */
  raison: RaisonAcademieEssai | null
}

const RAISONS_MEMBRE_PAYANT: ReadonlySet<MentoratReason> = new Set<MentoratReason>([
  'etm', 'manuel', 'liveclub', 'skool-vip', 'skool-premium', 'formation',
])

function estRaisonMembrePayant(r: MentoratReason | null): r is Exclude<MentoratReason, 'carnet-premium'> {
  return r !== null && RAISONS_MEMBRE_PAYANT.has(r)
}

export async function aAccesAcademieEssai(userId: string): Promise<AccesAcademieEssai> {
  // 1. L'equipe (Brice) : lu en premier, sans Stripe ni cockpit.
  const profils = await prisma.$queryRaw<{ role: string | null }[]>`
    select role::text as role from public.profiles where id = ${userId}::uuid limit 1
  `
  if (profils[0]?.role === 'admin') return { acces: true, raison: 'admin' }

  // 2. Les membres payants, par la meme lecture que le mode mentorat.
  const mentorat = await checkMentoratAccess(userId)
  if (mentorat.entitled && estRaisonMembrePayant(mentorat.reason)) {
    return { acces: true, raison: mentorat.reason }
  }
  return { acces: false, raison: null }
}
