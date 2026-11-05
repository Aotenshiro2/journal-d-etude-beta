// LE PARRAINAGE PAR CODE du Live Club (05/11/2026) : la partie PURE. Aucune
// base, aucun reseau, aucun import : scripts/verifier-parrainage.mjs la charge
// telle quelle, avec un faux Stripe et une fausse base.
//
// Les faits (chat Telegram « Code promo live club », 22/10, lu le 05/11) :
// Adil a cree trois codes promo Stripe sur le compte melanie, BARBU17 pour
// Alex (@Alex17310), SAUCISSON pour Fab (@Nyfab34), 10kONEDAY pour Nadege
// (@NadegeNQ). Le code donne au nouveau le Live Club a 99 EUR par mois au lieu
// de 139. MELMOM2 est le code de Mel elle-meme : ce n'est pas un parrainage.
//
// Les regles (Brice, 05/11) :
// - le parrain touche 20 % du PREMIER paiement de son filleul, compte a la fin
//   du mois, et 30 % a partir de son 11e filleul (annonce d'Adil du 22/10) ;
// - le bot des membres le previent en prive, avec le PRENOM du filleul
//   (option b), jamais son nom complet ni son email ;
// - un parrain injoignable (jamais ecrit au bot, envoi refuse) : pas d'email
//   sans son accord, Brice et Melanie recoivent dans Agent AOK la phrase a lui
//   transmettre ;
// - une seule notification et une seule commission par abonnement filleul,
//   quel que soit le nombre d'evenements (webhook, rejeu, filet du matin).
//
// Ce qui DECLENCHE : une facture payee (invoice.paid, signee par Stripe, ou
// relue chez Stripe par le passage du matin) qui est la PREMIERE d'un
// abonnement (billing_reason subscription_create), d'un montant non nul, avec
// une remise dont le code promo est un code de parrainage actif. Rien d'autre :
// aucun modele, aucun texte d'un membre ne fait partir ce message.

/** Le code de Mel elle-meme : jamais un parrainage (le controle de la carte le refuse, la base aussi). */
export const CODES_HORS_PARRAINAGE: readonly string[] = ['MELMOM2']
/** Le taux par defaut : 20 % du premier paiement du filleul. */
export const TAUX_PARRAINAGE_PCT = 20
/** Au-dela du palier : 30 % (annonce d'Adil du 22/10). */
export const TAUX_PALIER_PCT = 30
/** Le palier : a partir du 11e filleul, le taux du palier. */
export const PALIER_FILLEULS = 10
/** Le filet du matin relit les factures payees de ces derniers jours. */
export const FENETRE_FILET_JOURS = 7
/** Un envoi tente sans resultat depuis ce delai est « incertain » : l'equipe est prevenue, rien n'est renvoye. */
export const DELAI_INCERTAIN_MIN = 30
/** Prenom introuvable ou douteux. */
export const NOUVEAU_MEMBRE = 'un nouveau membre'

export const TYPE_CODE_PARRAINAGE = 'code_parrainage'
export const NOM_OUTIL_AGENT_PARRAINAGE = 'proposer_code_parrainage'

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

// ---------------------------------------------------------------------------
// Petits formats
// ---------------------------------------------------------------------------

const FORMAT_JOUR_PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Le jour de Paris (AAAA-MM-JJ) d'un instant ISO. */
export function jourParisDe(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso.slice(0, 10)
  return FORMAT_JOUR_PARIS.format(new Date(t))
}

/** Le mois (AAAA-MM) d'un jour AAAA-MM-JJ. */
export function moisDuJour(jour: string): string {
  return jour.slice(0, 7)
}

/** '2026-11' -> 'novembre'. */
export function nomMois(mois: string): string {
  return MOIS_FR[Number(mois.slice(5, 7)) - 1] ?? mois
}

/** '2026-10' -> « d'octobre », '2026-11' -> « de novembre ». */
export function deMois(mois: string): string {
  const nom = nomMois(mois)
  return /^[aeiou]/.test(nom) ? `d'${nom}` : `de ${nom}`
}

/** '2026-11-03' -> '3 novembre'. */
export function jourCourtFr(jour: string): string {
  return `${Number(jour.slice(8, 10))} ${nomMois(jour)}`
}

/** 1980 centimes -> '19,80 €' (toujours deux decimales). */
export function euros(centimes: number, devise = 'eur'): string {
  const n = (centimes / 100).toFixed(2).replace('.', ',')
  return devise.toLowerCase() === 'eur' ? `${n} €` : `${n} ${devise.toUpperCase()}`
}

/** 9900 centimes -> '99 €', 9950 -> '99,50 €'. */
export function montantLisible(centimes: number, devise = 'eur'): string {
  if (Number.isInteger(centimes / 100)) {
    const n = String(centimes / 100)
    return devise.toLowerCase() === 'eur' ? `${n} €` : `${n} ${devise.toUpperCase()}`
  }
  return euros(centimes, devise)
}

/** 20 -> '20 %', 12.5 -> '12,5 %'. */
export function pourcent(t: number): string {
  return `${Number.isInteger(t) ? String(t) : String(t).replace('.', ',')} %`
}

/** « de Fab », « d'Alex » : l'elision devant une voyelle ou un h. */
export function deNom(nom: string): string {
  return /^[aeiouyhàâäéèêëîïôöûüAEIOUYHÀÂÄÉÈÊËÎÏÔÖÛÜ]/.test(nom) ? `d'${nom}` : `de ${nom}`
}

/** 1 -> '1er', 11 -> '11e'. */
export function rangLisible(n: number): string {
  return n === 1 ? '1er' : `${n}e`
}

// ---------------------------------------------------------------------------
// Les codes
// ---------------------------------------------------------------------------

const MOTIF_CODE = /^[A-Za-z0-9_-]{3,30}$/

/** Le code compare sans la casse (Stripe l'accepte sans la casse), ou null s'il est illisible. */
export function cleCode(code: unknown): string | null {
  const s = String(code ?? '').trim()
  return MOTIF_CODE.test(s) ? s.toUpperCase() : null
}

export function estCodeHorsParrainage(code: unknown): boolean {
  const c = cleCode(code)
  return c !== null && CODES_HORS_PARRAINAGE.includes(c)
}

/** Un code de parrainage tel qu'en base (cockpit_liveclub_parrains). */
export type CodeParrainage = {
  codeId: string
  /** Tel que saisi (affiche au parrain). */
  code: string
  /** Son prenom ou son nom, pour l'equipe. */
  parrain: string
  pseudo: string | null
  telegramId: number | null
  email: string | null
  tauxPct: number
  tauxPalierPct: number
  palier: number
  /** AAAA-MM-JJ : un paiement d'avant ne compte pas. */
  depuis: string
  actif: boolean
}

/**
 * Le code de parrainage d'une facture : le premier de ses codes promo qui est
 * un code de parrainage ACTIF (sans la casse). MELMOM2 et les codes inconnus
 * ne donnent rien.
 */
export function choisirCode(codesFacture: readonly string[], codes: readonly CodeParrainage[]): CodeParrainage | null {
  for (const brut of codesFacture) {
    const c = cleCode(brut)
    if (!c || CODES_HORS_PARRAINAGE.includes(c)) continue
    const trouve = codes.find(x => x.actif && cleCode(x.code) === c)
    if (trouve) return trouve
  }
  return null
}

// ---------------------------------------------------------------------------
// La facture
// ---------------------------------------------------------------------------

export type FactureFilleul = {
  factureId: string | null
  abonnementId: string
  client: string
  /** amount_paid, en centimes. */
  montant: number
  devise: string
  /** Instant du paiement (status_transitions.paid_at, sinon created), ISO. */
  payeLe: string
  /** customer_name de la facture, brut (jamais affiche tel quel au parrain). */
  nomClient: string | null
  emailClient: string | null
  /** Les codes lus sur les remises depliees ; null = remises en identifiants, a relire chez Stripe. */
  codes: string[] | null
}

const ID_FACTURE = /^in_[A-Za-z0-9]{6,64}$/
const ID_CLIENT = /^cus_[A-Za-z0-9]{6,64}$/
const ID_ABONNEMENT = /^sub_[A-Za-z0-9]{6,64}$/
const EMAIL = /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[a-z]{2,}$/

function texte(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Les codes promo des remises DEPLIEES (expand discounts.promotion_code) :
 * une remise reste un identifiant (« di_... ») ou son promotion_code un
 * identifiant (« promo_... ») = null, il faut relire chez Stripe. Une remise
 * sans code promo (coupon pose a la main) ne donne rien.
 */
export function codesDesRemises(remises: unknown): string[] | null {
  if (!Array.isArray(remises)) return []
  const codes: string[] = []
  for (const r of remises) {
    if (typeof r === 'string') return null
    if (!r || typeof r !== 'object') continue
    const promo = (r as { promotion_code?: unknown }).promotion_code
    if (promo === null || promo === undefined) continue
    if (typeof promo === 'string') return null
    const code = texte((promo as { code?: unknown }).code)
    if (code) codes.push(code)
  }
  return codes
}

/**
 * Une facture qui PEUT etre le premier paiement d'un filleul, lue dans un
 * evenement Stripe (invoice.paid) ou une facture brute (liste du filet).
 * null = rien a faire, sans appel : autre evenement, facture non payee, pas
 * la premiere de l'abonnement (billing_reason subscription_create), montant
 * nul, sans abonnement ni client, ou sans aucune remise (pas de code possible).
 */
export function lireFactureFilleul(brut: unknown): FactureFilleul | null {
  if (!brut || typeof brut !== 'object') return null
  let o: unknown = brut
  const e = brut as { object?: unknown; type?: unknown; data?: { object?: unknown } }
  if (e.object === 'event' || typeof e.type === 'string') {
    if (e.type !== 'invoice.paid') return null
    o = e.data?.object
  }
  if (!o || typeof o !== 'object') return null
  const f = o as {
    object?: unknown; id?: unknown; status?: unknown; billing_reason?: unknown; amount_paid?: unknown; currency?: unknown
    customer?: unknown; customer_name?: unknown; customer_email?: unknown; subscription?: unknown; created?: unknown
    parent?: { subscription_details?: { subscription?: unknown } | null } | null
    status_transitions?: { paid_at?: unknown } | null
    discounts?: unknown; total_discount_amounts?: unknown
  }
  if (f.object !== 'invoice' || f.status !== 'paid') return null
  if (f.billing_reason !== 'subscription_create') return null
  const montant = typeof f.amount_paid === 'number' && Number.isInteger(f.amount_paid) ? f.amount_paid : 0
  if (montant <= 0) return null
  const client = texte(f.customer)
  if (!client || !ID_CLIENT.test(client)) return null
  const sub = texte(f.subscription) ?? texte(f.parent?.subscription_details?.subscription)
  if (!sub || !ID_ABONNEMENT.test(sub)) return null
  const remises = Array.isArray(f.discounts) ? f.discounts : []
  const montantsRemises = Array.isArray(f.total_discount_amounts) ? f.total_discount_amounts : []
  if (remises.length === 0 && montantsRemises.length === 0) return null
  const paye = f.status_transitions?.paid_at
  const cree = f.created
  const sec = typeof paye === 'number' && paye > 0 ? paye : typeof cree === 'number' && cree > 0 ? cree : null
  if (sec === null) return null
  const id = texte(f.id)
  const email = texte(f.customer_email)?.toLowerCase() ?? null
  return {
    factureId: id && ID_FACTURE.test(id) ? id : null,
    abonnementId: sub,
    client,
    montant,
    devise: (texte(f.currency) ?? 'eur').toLowerCase(),
    payeLe: new Date(sec * 1000).toISOString(),
    nomClient: texte(f.customer_name),
    emailClient: email && EMAIL.test(email) && email.length <= 254 ? email : null,
    // Remises en identifiants (evenement du webhook) : null, relues chez Stripe.
    codes: remises.length === 0 ? null : codesDesRemises(remises),
  }
}

// ---------------------------------------------------------------------------
// Le prenom
// ---------------------------------------------------------------------------

/** Un mot de prenom : des lettres, un trait d'union ou une apostrophe au milieu, 2 a 24 caracteres. */
const MOT_PRENOM = /^\p{L}+(?:['-]\p{L}+)*$/u

/**
 * Le PRENOM d'un nom de client (le premier mot), en casse propre
 * (« THOMAS » et « thomas » -> « Thomas », « jean-pierre » -> « Jean-Pierre »).
 * null s'il est douteux : chiffres, arobase, initiale (« T. »), une seule
 * lettre, trop long. C'est le seul morceau du filleul qui part au parrain.
 */
export function prenomDe(nom: unknown): string | null {
  const s = String(nom ?? '').normalize('NFC').trim()
  if (!s) return null
  const mot = s.split(/\s+/)[0]
  if (mot.length < 2 || mot.length > 24 || !MOT_PRENOM.test(mot)) return null
  return mot.toLowerCase().replace(/(^|['-])(\p{L})/gu, (_m, sep: string, l: string) => sep + l.toUpperCase())
}

// ---------------------------------------------------------------------------
// La commission
// ---------------------------------------------------------------------------

/** Le taux du n-ieme filleul : le taux du palier a partir du (palier + 1)-ieme. */
export function tauxDuRang(rang: number, c: Pick<CodeParrainage, 'tauxPct' | 'tauxPalierPct' | 'palier'>): number {
  return rang > c.palier ? c.tauxPalierPct : c.tauxPct
}

/** La commission en centimes, arrondie au centime. */
export function commissionCentimes(montant: number, tauxPct: number): number {
  return Math.round((montant * tauxPct) / 100)
}

export type CalculCommission = { rang: number; tauxPct: number; commission: number }

/**
 * Le calcul fait DANS la transaction d'inscription (verrou pose) : rang = les
 * filleuls deja notes de ce parrain + 1, puis le taux de ce rang et la
 * commission sur ce qui a REELLEMENT ete paye.
 */
export function calculerCommission(dejaNotes: number, c: Pick<CodeParrainage, 'tauxPct' | 'tauxPalierPct' | 'palier'>, montant: number): CalculCommission {
  const rang = Math.max(0, Math.floor(dejaNotes)) + 1
  const tauxPct = tauxDuRang(rang, c)
  return { rang, tauxPct, commission: commissionCentimes(montant, tauxPct) }
}

// ---------------------------------------------------------------------------
// Les textes
// ---------------------------------------------------------------------------

export type ContexteTexte = {
  prenom: string | null
  code: string
  commission: number
  devise: string
  tauxPct: number
  rang: number
  palier: number
  /** Instant du paiement, ISO. */
  payeLe: string
  /** Instant de l'envoi, ISO. */
  maintenant: string
}

/**
 * Le message PRIVE au parrain, par le bot des membres (tutoiement, court,
 * chaleureux, ni emoji ni « jamais »). Le prenom seul, ou « un nouveau
 * membre ». Paiement d'un autre jour (le filet du matin) : la date. Le
 * 11e filleul : le passage au taux du palier.
 */
export function texteParrain(o: ContexteTexte): string {
  const qui = o.prenom ?? NOUVEAU_MEMBRE
  const jour = jourParisDe(o.payeLe)
  const aujourdhui = jourParisDe(o.maintenant)
  const arrivee = jour === aujourdhui
    ? `${qui} vient de rejoindre le Live Club`
    : `${qui} a rejoint le Live Club le ${jourCourtFr(jour)}`
  const mois = moisDuJour(jour)
  // (05/11, rattrapage) Un mois deja passe : la commission est comptee avec celles de ce mois-la.
  const quand = mois === moisDuJour(aujourdhui) ? 'à la fin du mois' : `avec les commissions ${deMois(mois)}`
  const palier = o.rang === o.palier + 1
    ? ` C'est ton ${rangLisible(o.rang)} filleul : à partir de lui, ta commission passe à ${pourcent(o.tauxPct)}.`
    : ''
  return `Bonne nouvelle : ${arrivee} grâce à ton code ${o.code}. `
    + `Ta commission de ${euros(o.commission, o.devise)} (${pourcent(o.tauxPct)} de son premier paiement) sera comptée ${quand}.`
    + `${palier} Merci à toi !`
}

/** Pourquoi le parrain n'a pas recu son message. */
export type RaisonAlerte = 'sans_compte' | 'refus' | 'echec' | 'incertain'

/**
 * L'alerte a Brice et Melanie (Agent AOK) quand le parrain n'a pas pu etre
 * prevenu : qui, quel code, combien, pourquoi, et la phrase EXACTE a lui
 * transmettre. Le filleul y est nomme par son prenom (et son email s'il est
 * propre) : le nom brut du client Stripe n'entre pas dans l'historique de
 * l'agent.
 */
export function texteAlerteEquipe(o: ContexteTexte & {
  parrain: string; pseudo: string | null; montant: number; email: string | null; raison: RaisonAlerte; texte: string
}): string {
  const filleul = `${o.prenom ?? NOUVEAU_MEMBRE}${o.email ? ` (${o.email})` : ''}`
  const jour = jourParisDe(o.payeLe)
  const mois = moisDuJour(jour)
  const parrain = `${o.parrain}${o.pseudo ? ` (@${o.pseudo})` : ''}`
  const raison = o.raison === 'sans_compte'
    ? `Je n'ai pas pu prévenir ${o.parrain} : son compte Telegram n'est pas connu${o.pseudo ? ` (@${o.pseudo} introuvable dans le groupe)` : ''}. Pas d'email sans son accord.`
    : o.raison === 'refus'
      ? `Je n'ai pas pu prévenir ${o.parrain} en privé : Telegram refuse le message (pas de conversation ouverte avec le bot des membres, ou bot bloqué). Pas d'email sans son accord.`
      : o.raison === 'echec'
        ? `Le message à ${o.parrain} n'est pas parti (Telegram ne répond pas). Rien ne sera renvoyé tout seul.`
        : `Un envoi à ${o.parrain} a été tenté sans confirmation : vérifie avec ${o.parrain} avant de lui renvoyer la phrase.`
  return [
    `Nouveau filleul du Live Club : ${filleul}, abonnement payé le ${jourCourtFr(jour)} avec le code ${o.code} ${deNom(parrain)}.`,
    `Premier paiement ${montantLisible(o.montant, o.devise)}, commission ${euros(o.commission, o.devise)} `
      + `(${pourcent(o.tauxPct)}, ${rangLisible(o.rang)} filleul), `
      + `${mois === moisDuJour(jourParisDe(o.maintenant)) ? `à verser fin ${nomMois(mois)}` : `comptée avec les commissions ${deMois(mois)}`}.`,
    raison,
    `Phrase à lui transmettre :\n« ${o.texte} »`,
  ].join('\n\n')
}

/** Ce que le resume du matin dit de la notification. */
export function phraseNotification(notification: string | null, parrain: string): string {
  if (notification === 'parrain') return `${parrain} prévenu en privé par le bot`
  if (notification === 'equipe') return `${parrain} à prévenir à la main (phrase envoyée dans Agent AOK)`
  if (notification === 'incertain') return `envoi à ${parrain} incertain, à vérifier (alerte dans Agent AOK)`
  return `${parrain} pas encore prévenu`
}

/** La ligne du resume du matin, en minuscule, sans point final. */
export function detailResumeParrainage(o: {
  code: string; parrain: string; pseudo: string | null; montant: number; devise: string; commission: number
  tauxPct: number; rang: number; mois: string; notification: string | null
}): string {
  return `filleul ${deNom(o.parrain)}${o.pseudo ? ` (@${o.pseudo})` : ''} avec le code ${o.code} : `
    + `premier paiement ${montantLisible(o.montant, o.devise)}, commission ${euros(o.commission, o.devise)} `
    + `(${pourcent(o.tauxPct)}, ${rangLisible(o.rang)} filleul) à verser fin ${nomMois(o.mois)}, `
    + phraseNotification(o.notification, o.parrain)
}

// ---------------------------------------------------------------------------
// LA DECLARATION DU MOIS (Brice, 05/11 : « les commissions sont dans les
// dépenses du Live Club, comme pour les lives d'Adrien »). Les commissions d'un
// mois deviennent UNE depense rattachee au produit Live Club (cote Mel,
// deduite avant le 70/30, payee par Mel), par une CARTE d'Agent AOK : proposee
// d'elle-meme par le passage au debut du mois suivant, ou demandee. Une seule
// declaration vivante par mois (index unique sur cockpit_depenses.parrainage_mois).
// Une declaration qui ne correspond plus (un filleul ajoute ou rembourse apres
// coup) se REMPLACE par la meme carte : l'ancienne depense est retiree, la
// nouvelle posee, jamais d'ecriture toute seule.
// ---------------------------------------------------------------------------

export const TYPE_DECLARATION_PARRAINAGE = 'declaration_parrainage'
export const NOM_OUTIL_AGENT_DECLARATION = 'proposer_parrainages_du_mois'
/** Le produit Live Club dans cockpit_offres (celui des lives d'Adrien). */
export const OFFRE_LIVE_CLUB = 'live-club'

/** Un filleul du mois, tel que la declaration le lit. */
export type FilleulDuMois = {
  filleulId: string
  parrain: string
  prenom: string | null
  /** Centimes (0 pour un filleul annule). */
  commission: number
  statut: 'a_verser' | 'declaree' | 'versee' | 'annulee'
  depenseId: string | null
}

/** La depense vivante des commissions de parrainage du mois, s'il y en a une. */
export type DepenseParrainage = { depenseId: string; montant: number; poseLe: string }

export type EtatDeclaration = {
  /** Ce qui est du ce mois-ci : la somme des filleuls non annules (centimes). */
  du: number
  /** Les filleuls non annules. */
  dus: FilleulDuMois[]
  /** La depense vivante, ou null. */
  depense: DepenseParrainage | null
  /** Vrai : la depense vivante couvre exactement les filleuls dus (ou rien n'est du ni declare). */
  aJour: boolean
}

/** Ou en est la declaration d'un mois. */
export function etatDeclaration(filleuls: readonly FilleulDuMois[], depense: DepenseParrainage | null): EtatDeclaration {
  const dus = filleuls.filter(f => f.statut !== 'annulee')
  const du = dus.reduce((s, f) => s + f.commission, 0)
  const aJour = depense
    ? depense.montant === du && dus.every(f => f.depenseId === depense.depenseId)
    : dus.length === 0
  return { du, dus, depense, aJour }
}

/** « Commissions de parrainage d'octobre » : le libelle de la depense. */
export function libelleDepenseParrainage(mois: string): string {
  return `Commissions de parrainage ${deMois(mois)}`
}

/** « Alex 19,80 € (Thomas), Fab 19,80 € (un nouveau membre) » : par parrain, ses filleuls entre parentheses. */
export function detailParParrain(dus: readonly FilleulDuMois[]): string {
  const parParrain = new Map<string, { total: number; prenoms: string[] }>()
  for (const f of dus) {
    const x = parParrain.get(f.parrain) ?? { total: 0, prenoms: [] }
    x.total += f.commission
    x.prenoms.push(f.prenom ?? NOUVEAU_MEMBRE)
    parParrain.set(f.parrain, x)
  }
  return [...parParrain.entries()].map(([p, x]) => `${p} ${euros(x.total)} (${x.prenoms.join(', ')})`).join(', ')
}

/**
 * La carte de la declaration (longue pour Brice, courte pour Mel), ou null si
 * rien n'est a faire. Exemple : « Commissions de parrainage d'octobre : Alex
 * 19,80 € (Thomas), Fab 19,80 € (Lucie) = 39,60 €. Déclarer en dépense du
 * Live Club ? »
 */
export function carteDeclaration(mois: string, e: EtatDeclaration, o: { produit?: string } = {}): { carte: string; court: string } | null {
  if (e.aJour) return null
  const produit = o.produit ?? 'Live Club'
  const tete = `Commissions de parrainage ${deMois(mois)}`
  if (e.dus.length === 0 && e.depense) {
    const court = `${tete} : plus rien à verser (filleuls remboursés). Retirer la dépense de ${euros(e.depense.montant)} ?`
    return { court, carte: `${court} La répartition ${deMois(mois)} ne la comptera plus.` }
  }
  const somme = `${detailParParrain(e.dus)} = ${euros(e.du)}`
  if (e.depense) {
    const court = `${tete} : ${somme}. Remplacer la dépense de ${euros(e.depense.montant)} par ${euros(e.du)} ?`
    return {
      court,
      carte: `${court} L'ancienne dépense est retirée, la nouvelle compte dans la répartition ${deMois(mois)} `
        + `(produit ${produit}, côté Mel, déduite avant le 70/30, payée par Mel).`,
    }
  }
  const court = `${tete} : ${somme}. Déclarer en dépense du ${produit} ?`
  return {
    court,
    carte: `${court} Comme les lives d'Adrien : rattachée au produit ${produit}, côté Mel, déduite avant le 70/30, payée par Mel. `
      + 'Les filleuls de ce mois passent « déclarés ».',
  }
}

/**
 * Ce que la carte attend de trouver au clic : le mois, ce qui est du, et la
 * depense qu'elle remplace (ou aucune). Si la base a bouge entre la carte et
 * le clic, le clic refuse et dit de redemander la carte.
 */
export type ParamsDeclaration = { mois: string; du: number | null; remplace: string | null }

export function lireParamsDeclaration(p: Record<string, unknown>, o: { moisCourant: string }): ParamsDeclaration | string {
  const mois = String(p.mois ?? '').trim()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) return 'mois : AAAA-MM, le mois des commissions de parrainage (un mois fini).'
  if (mois >= o.moisCourant) return `Les commissions de parrainage se déclarent une fois le mois fini : ${nomMois(mois)} n'est pas terminé.`
  let du: number | null = null
  if (p.du !== null && p.du !== undefined && p.du !== '') {
    const n = Number(p.du)
    if (!Number.isInteger(n) || n < 0) return 'du : posé par le serveur (centimes).'
    du = n
  }
  const remplace = typeof p.remplace === 'string' && UUID.test(p.remplace) ? p.remplace : null
  return { mois, du, remplace }
}

/**
 * (Revenus, repartition_du_mois) L'avertissement du mois tant que la
 * declaration n'est pas a jour : ce qui reste a declarer, ou la depense qui ne
 * correspond plus. null = a jour (ou rien) : l'avertissement disparait.
 */
export function phraseAVerser(e: EtatDeclaration, mois: string, o: { moisCourant: string }): string | null {
  if (e.aJour) return null
  const fini = mois < o.moisCourant
  const suite = fini
    ? 'Une carte pour le déclarer en dépense du Live Club arrive dans Agent AOK.'
    : 'Ce montant sera déclaré en dépense du Live Club au début du mois prochain, par une carte dans Agent AOK.'
  if (e.depense) {
    return `Parrainages du Live Club : la dépense déclarée (${euros(e.depense.montant)}) ne correspond plus à ce qui est dû `
      + `(${euros(e.du)}${e.dus.length ? ` : ${detailParParrain(e.dus)}` : ''}). Une carte pour la corriger arrive dans Agent AOK.`
  }
  return `Parrainages du Live Club : ${euros(e.du)} à verser aux parrains ${fini ? `pour ${nomMois(mois)}` : `fin ${nomMois(mois)}`} `
    + `(${e.dus.length} filleul${e.dus.length > 1 ? 's' : ''} : ${detailParParrain(e.dus)}). Pas encore déduit de ce calcul. ${suite}`
}

/** La memoire de la carte proposee d'elle-meme : une par etat du mois (un changement en donne une nouvelle). */
export function cleCarteDeclaration(mois: string, e: EtatDeclaration): string {
  return `parrainage:${mois}:${e.du}:${e.dus.length}:${e.depense?.depenseId ?? 'aucune'}`
}

// ---------------------------------------------------------------------------
// LE REMBOURSEMENT (Brice, 05/11 : « la commission est annulée s'il a été
// remboursé »). Premier paiement rembourse en entier : statut annulee,
// commission a 0. Deja dans une declaration : l'equipe est alertee (la carte
// de correction suit), pas de correction automatique de l'argent. Rien au parrain.
// ---------------------------------------------------------------------------

/** Un evenement charge.refunded signe : le client Stripe a relire, ou null. */
export function lireRemboursement(brut: unknown): { client: string } | null {
  if (!brut || typeof brut !== 'object') return null
  const e = brut as { type?: unknown; data?: { object?: unknown } }
  if (e.type !== 'charge.refunded') return null
  const c = e.data?.object as { object?: unknown; customer?: unknown } | undefined
  if (!c || c.object !== 'charge') return null
  const client = texte(c.customer)
  return client && ID_CLIENT.test(client) ? { client } : null
}

/**
 * Les paiements d'une facture (GET /v1/invoice_payments, charge depliee) :
 * remboursee = un paiement paye dont la charge est remboursee EN ENTIER. Un
 * remboursement partiel ne fait rien (question a Brice).
 */
export function factureRemboursee(paiements: unknown): boolean {
  if (!Array.isArray(paiements)) return false
  return paiements.some((p) => {
    const charge = (p as { payment?: { charge?: unknown } | null } | null)?.payment?.charge
    if (!charge || typeof charge !== 'object') return false
    const c = charge as { refunded?: unknown; amount?: unknown; amount_refunded?: unknown }
    return c.refunded === true || (typeof c.amount === 'number' && c.amount > 0 && c.amount_refunded === c.amount)
  })
}

/** L'alerte a l'equipe : un filleul rembourse dont la commission etait deja declaree. */
export function texteAlerteRemboursement(o: {
  prenom: string | null; parrain: string; code: string; commission: number; mois: string; depense: number | null; du: number
}): string {
  const tete = `Parrainage annulé : le premier paiement de ${o.prenom ?? NOUVEAU_MEMBRE} (filleul ${deNom(o.parrain)}, code ${o.code}) a été remboursé. `
    + `Sa commission de ${euros(o.commission)} est annulée, rien n'est dit à ${o.parrain}.`
  if (o.depense === null) return tete
  return `${tete}\n\nElle était déjà dans la dépense « ${libelleDepenseParrainage(o.mois)} » (${euros(o.depense)}) : à corriger. `
    + `La carte qui la corrige (${euros(o.depense)} -> ${euros(o.du)}) arrive au prochain passage du matin, ou demande-la-moi.`
}

// ---------------------------------------------------------------------------
// Le traitement d'une facture, avec ses outils en parametre
// ---------------------------------------------------------------------------

export type SourceFilleul = 'webhook' | 'passage'

export type EntreeFilleul = {
  code: CodeParrainage
  facture: FactureFilleul
  prenom: string | null
  mois: string
  source: SourceFilleul
}

export type LigneFilleul = CalculCommission & { filleulId: string }

export type NotificationFinale = 'parrain' | 'equipe' | 'a_reprendre' | 'incertain'

export type OutilsParrainage = {
  /** Instant courant, ISO. */
  maintenant: () => string
  /** Les codes de parrainage (actifs ou non). Jette sur une panne. */
  codesParrainage: () => Promise<CodeParrainage[]>
  /** Les codes promo de la facture, relus chez Stripe (facture, puis abonnement). Jette sur une panne. */
  codesDeLaFacture: (f: FactureFilleul) => Promise<string[]>
  dejaNote: (abonnementId: string) => Promise<boolean>
  /** Un abonnement sur un produit Live Club ? Jette sur une panne (jamais un faux « non »). */
  estLiveClub: (abonnementId: string) => Promise<boolean>
  /** Le prenom de la fiche du cockpit (client ou abonnement), ou null. */
  prenomFiche: (f: FactureFilleul) => Promise<string | null>
  /**
   * L'inscription, sous verrou : compte les filleuls deja notes du parrain,
   * calcule (calculerCommission), insere UNE ligne par abonnement. null = deja
   * notee (un autre evenement est passe avant).
   */
  noter: (e: EntreeFilleul, calcul: (dejaNotes: number) => CalculCommission) => Promise<LigneFilleul | null>
  /** Pose la tentative d'envoi. false = deja tentee ou faite : on ne renvoie pas. */
  reserverNotification: (filleulId: string) => Promise<boolean>
  /** Le compte Telegram du parrain par son pseudo (registre du groupe), ou null. */
  resoudreParrain: (c: CodeParrainage) => Promise<number | null>
  envoyerParrain: (telegramId: number, texte: string) => Promise<'ok' | 'refus' | 'echec'>
  /** Le nombre de comptes d'Agent AOK qui ont recu l'alerte. */
  alerterEquipe: (texte: string) => Promise<number>
  marquerNotification: (filleulId: string, issue: NotificationFinale) => Promise<void>
}

export type RaisonIgnore = 'pas_un_premier_paiement' | 'sans_code' | 'hors_parrainage' | 'avant_le_code' | 'hors_live_club'

export type IssueFilleul =
  | { etat: 'ignore'; raison: RaisonIgnore }
  | { etat: 'deja' }
  | { etat: 'note'; filleulId: string; rang: number; tauxPct: number; commission: number; notification: NotificationFinale | 'deja' }

export type FilleulANotifier = LigneFilleul & {
  code: CodeParrainage
  prenom: string | null
  montant: number
  devise: string
  payeLe: string
  email: string | null
}

/**
 * Previent le parrain d'UN filleul deja note : la tentative est posee AVANT
 * l'envoi (reserverNotification), donc un rejeu ne renvoie rien. Telegram
 * d'abord (compte connu, sinon cherche par le pseudo) ; refus ou compte
 * inconnu : l'alerte a l'equipe avec la phrase. Alerte non livree : la ligne
 * reste « a_reprendre » pour le filet du lendemain.
 */
export async function notifierFilleul(n: FilleulANotifier, outils: OutilsParrainage): Promise<NotificationFinale | 'deja'> {
  if (!await outils.reserverNotification(n.filleulId)) return 'deja'
  const contexte: ContexteTexte = {
    prenom: n.prenom, code: n.code.code, commission: n.commission, devise: n.devise, tauxPct: n.tauxPct,
    rang: n.rang, palier: n.code.palier, payeLe: n.payeLe, maintenant: outils.maintenant(),
  }
  const texte = texteParrain(contexte)
  let raison: RaisonAlerte
  const telegramId = n.code.telegramId ?? await outils.resoudreParrain(n.code)
  if (telegramId === null) {
    raison = 'sans_compte'
  } else {
    const r = await outils.envoyerParrain(telegramId, texte)
    if (r === 'ok') {
      await outils.marquerNotification(n.filleulId, 'parrain')
      return 'parrain'
    }
    raison = r === 'refus' ? 'refus' : 'echec'
  }
  return alerterPourFilleul(n, contexte, texte, raison, outils)
}

/** L'alerte a l'equipe pour un filleul, puis la marque ('equipe', 'incertain' ou 'a_reprendre'). */
export async function alerterPourFilleul(
  n: FilleulANotifier, contexte: ContexteTexte, texte: string, raison: RaisonAlerte, outils: OutilsParrainage,
): Promise<NotificationFinale> {
  const alerte = texteAlerteEquipe({
    ...contexte, parrain: n.code.parrain, pseudo: n.code.pseudo, montant: n.montant, email: n.email, raison, texte,
  })
  const livres = await outils.alerterEquipe(alerte)
  const issue: NotificationFinale = livres > 0 ? (raison === 'incertain' ? 'incertain' : 'equipe') : 'a_reprendre'
  await outils.marquerNotification(n.filleulId, issue)
  return issue
}

/**
 * Une facture payee : est-ce le premier paiement d'un filleul ? Si oui, UNE
 * ligne (commission au taux de son rang) et UNE notification. Ordre : ce qui
 * ne coute rien d'abord (lecture de la facture, codes en base), puis Stripe
 * seulement pour une facture qui porte une remise. Jette sur une panne de
 * lecture : l'appelant laisse Stripe rejouer (webhook) ou le filet reprendre.
 */
export async function traiterFactureFilleul(brut: unknown, source: SourceFilleul, outils: OutilsParrainage): Promise<IssueFilleul> {
  const f = lireFactureFilleul(brut)
  if (!f) return { etat: 'ignore', raison: 'pas_un_premier_paiement' }
  const codes = await outils.codesParrainage()
  if (!codes.some(c => c.actif)) return { etat: 'ignore', raison: 'sans_code' }
  const codesFacture = f.codes ?? await outils.codesDeLaFacture(f)
  const code = choisirCode(codesFacture, codes)
  if (!code) {
    return { etat: 'ignore', raison: codesFacture.some(estCodeHorsParrainage) ? 'hors_parrainage' : 'sans_code' }
  }
  if (jourParisDe(f.payeLe) < code.depuis) return { etat: 'ignore', raison: 'avant_le_code' }
  if (await outils.dejaNote(f.abonnementId)) return { etat: 'deja' }
  if (!await outils.estLiveClub(f.abonnementId)) return { etat: 'ignore', raison: 'hors_live_club' }
  const prenom = prenomDe(f.nomClient) ?? prenomDe(await outils.prenomFiche(f))
  const mois = moisDuJour(jourParisDe(f.payeLe))
  const ligne = await outils.noter({ code, facture: f, prenom, mois, source }, (n) => calculerCommission(n, code, f.montant))
  if (!ligne) return { etat: 'deja' }
  const notification = await notifierFilleul({
    ...ligne, code, prenom, montant: f.montant, devise: f.devise, payeLe: f.payeLe, email: f.emailClient,
  }, outils)
  return { etat: 'note', ...ligne, notification }
}

export type BilanFilet = { lues: number; notees: number; prevenus: number; equipe: number; a_reprendre: number; ignorees: number; deja: number; erreurs: number }

/** Le filet du matin : chaque facture de la liste, une par une ; une erreur n'arrete pas les autres. */
export async function traiterFactures(factures: readonly unknown[], outils: OutilsParrainage): Promise<BilanFilet> {
  const b: BilanFilet = { lues: factures.length, notees: 0, prevenus: 0, equipe: 0, a_reprendre: 0, ignorees: 0, deja: 0, erreurs: 0 }
  // (05/11) Les plus anciennes d'abord : le rang des filleuls suit l'ordre des paiements
  // (Stripe rend les plus recentes en tete, le rattrapage remonte au 22/10).
  const quand = (f: unknown) => {
    const o = f as { status_transitions?: { paid_at?: unknown } | null; created?: unknown } | null
    const t = o?.status_transitions?.paid_at ?? o?.created
    return typeof t === 'number' ? t : 0
  }
  const ordre = [...factures].sort((a, b) => quand(a) - quand(b))
  for (const brut of ordre) {
    try {
      const r = await traiterFactureFilleul(brut, 'passage', outils)
      if (r.etat === 'ignore') b.ignorees++
      else if (r.etat === 'deja') b.deja++
      else {
        b.notees++
        if (r.notification === 'parrain') b.prevenus++
        else if (r.notification === 'equipe' || r.notification === 'incertain') b.equipe++
        else if (r.notification === 'a_reprendre') b.a_reprendre++
      }
    } catch {
      b.erreurs++
    }
  }
  return b
}

// ---------------------------------------------------------------------------
// La carte d'Agent AOK : ajouter ou modifier un code de parrainage
// ---------------------------------------------------------------------------

export type ParamsCodeParrainage = {
  code: string
  parrain: string | null
  pseudo: string | null
  telegram_id: number | null
  email: string | null
  taux_pct: number | null
  taux_palier_pct: number | null
  palier: number | null
  depuis: string | null
  actif: boolean | null
  note: string | null
  /** Pose par le controle avant la carte : la ligne existante (modification), relue au clic. */
  code_id: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const JOUR = /^\d{4}-\d{2}-\d{2}$/

function nomCourt(v: unknown, max: number): string | null | 'invalide' {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  if (!s) return null
  if (s.length > max || !/^[\p{L}\p{N} .'-]+$/u.test(s)) return 'invalide'
  return s
}

/** Un pseudo Telegram, sans @. null = absent, 'invalide' = illisible. */
export function lirePseudo(v: unknown): string | null | 'invalide' {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim().replace(/^@+/, '')
  if (!s) return null
  return /^[A-Za-z0-9_]{3,32}$/.test(s) ? s : 'invalide'
}

/** Un compte Telegram (nombre, « 123 » ou « u123 »). null = absent, 'invalide' = illisible. */
export function lireCompteTelegram(v: unknown): number | null | 'invalide' {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim().replace(/^u/i, '')
  if (!/^\d{4,15}$/.test(s)) return 'invalide'
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : 'invalide'
}

function lireTaux(v: unknown, nom: string): number | null | string {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 100 || Math.round(n * 100) !== n * 100) return `${nom} : un pourcentage entre 0 et 100 (ex. 20).`
  return n
}

/**
 * Les parametres de la carte « code de parrainage », lus strictement (texte
 * d'un modele). Le parrain n'est exige que pour un NOUVEAU code (le controle
 * le sait, pas cette lecture). MELMOM2 est refuse : c'est le code de Mel.
 */
export function lireParamsCodeParrainage(p: Record<string, unknown>): ParamsCodeParrainage | string {
  const brut = String(p.code ?? '').trim()
  if (!MOTIF_CODE.test(brut)) return 'code : le code promo tel quel, 3 à 30 caractères (lettres, chiffres, - et _).'
  if (estCodeHorsParrainage(brut)) return `${brut.toUpperCase()} est le code de Mélanie : ce n'est pas un code de parrainage.`
  const parrain = nomCourt(p.parrain, 60)
  if (parrain === 'invalide') return 'parrain : son prénom ou son nom, 60 caractères au plus, sans symbole.'
  const pseudo = lirePseudo(p.pseudo)
  if (pseudo === 'invalide') return 'pseudo : son @pseudo Telegram (lettres, chiffres et _), ou rien.'
  const telegramId = lireCompteTelegram(p.telegram_id)
  if (telegramId === 'invalide') return 'telegram_id : son numéro de compte Telegram (u123... ou 123...), ou rien.'
  let email: string | null = null
  if (p.email !== null && p.email !== undefined && p.email !== '') {
    const e = String(p.email).trim().toLowerCase()
    if (!EMAIL.test(e) || e.length > 254) return 'email : une adresse lisible, ou rien.'
    email = e
  }
  const taux = lireTaux(p.taux_pct, 'taux_pct')
  if (typeof taux === 'string') return taux
  const tauxPalier = lireTaux(p.taux_palier_pct, 'taux_palier_pct')
  if (typeof tauxPalier === 'string') return tauxPalier
  let palier: number | null = null
  if (p.palier !== null && p.palier !== undefined && p.palier !== '') {
    const n = Number(p.palier)
    if (!Number.isInteger(n) || n < 0 || n > 1000) return 'palier : un nombre entier de filleuls (10 : le taux du palier à partir du 11e).'
    palier = n
  }
  let depuis: string | null = null
  if (p.depuis !== null && p.depuis !== undefined && p.depuis !== '') {
    const d = String(p.depuis).trim()
    if (!JOUR.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return 'depuis : AAAA-MM-JJ.'
    depuis = d
  }
  let actif: boolean | null = null
  if (p.actif !== null && p.actif !== undefined) {
    if (typeof p.actif !== 'boolean') return 'actif : vrai ou faux.'
    actif = p.actif
  }
  const note = p.note === null || p.note === undefined ? null : String(p.note).replace(/\s+/g, ' ').trim().slice(0, 200) || null
  const codeId = typeof p.code_id === 'string' && UUID.test(p.code_id) ? p.code_id : null
  if (!parrain && !pseudo && telegramId === null && email === null && taux === null && tauxPalier === null
    && palier === null && depuis === null && actif === null && note === null) {
    return 'Rien à enregistrer : donne au moins le parrain (son prénom et son @pseudo) ou ce qui change.'
  }
  return {
    code: brut, parrain, pseudo, telegram_id: telegramId, email, taux_pct: taux, taux_palier_pct: tauxPalier,
    palier, depuis, actif, note, code_id: codeId,
  }
}

/** Ce que la ligne deviendra : l'existante completee par la carte, ou une nouvelle avec les defauts. */
export function codeApres(p: ParamsCodeParrainage, existant: CodeParrainage | null, aujourdhui: string): Omit<CodeParrainage, 'codeId'> {
  return {
    code: existant?.code ?? p.code,
    parrain: p.parrain ?? existant?.parrain ?? '',
    pseudo: p.pseudo ?? existant?.pseudo ?? null,
    telegramId: p.telegram_id ?? existant?.telegramId ?? null,
    email: p.email ?? existant?.email ?? null,
    tauxPct: p.taux_pct ?? existant?.tauxPct ?? TAUX_PARRAINAGE_PCT,
    tauxPalierPct: p.taux_palier_pct ?? existant?.tauxPalierPct ?? TAUX_PALIER_PCT,
    palier: p.palier ?? existant?.palier ?? PALIER_FILLEULS,
    depuis: p.depuis ?? existant?.depuis ?? aujourdhui,
    actif: p.actif ?? existant?.actif ?? true,
  }
}

function regleLisible(c: Pick<CodeParrainage, 'tauxPct' | 'tauxPalierPct' | 'palier'>): string {
  return c.tauxPalierPct === c.tauxPct
    ? `${pourcent(c.tauxPct)} du premier paiement de chaque filleul`
    : `${pourcent(c.tauxPct)} du premier paiement de chaque filleul, ${pourcent(c.tauxPalierPct)} à partir du ${rangLisible(c.palier + 1)}`
}

function jourFr(jour: string): string {
  return `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`
}

/**
 * La carte, composee par le serveur : un nouveau code, une modification (ce
 * qui change, avant -> apres) ou une desactivation. Les filleuls deja notes
 * gardent leur commission.
 */
export function carteCodeParrainage(p: ParamsCodeParrainage, existant: CodeParrainage | null, aujourdhui: string): string {
  const a = codeApres(p, existant, aujourdhui)
  const compte = a.telegramId !== null
    ? `compte Telegram ${a.telegramId}`
    : 'compte Telegram pas encore trouvé : il sera cherché par son pseudo au moment de le prévenir, sinon vous recevrez ici la phrase à lui transmettre'
  const qui = `${a.parrain}${a.pseudo ? ` (@${a.pseudo}, ${compte})` : ` (${compte})`}`
  if (!existant) {
    return `Enregistrer le code de parrainage ${a.code} ${deNom(qui)} : ${regleLisible(a)}, depuis le ${jourFr(a.depuis)}`
      + `${a.actif ? '' : ' (enregistré mais désactivé)'}. `
      + `Chaque nouvel abonné au Live Club avec ce code sera noté à son premier paiement, et ${a.parrain} prévenu en privé par le bot avec son prénom.`
  }
  if (existant.actif && a.actif === false) {
    return `Désactiver le code de parrainage ${existant.code} ${deNom(existant.parrain)} : les prochains abonnés avec ce code ne seront plus comptés comme ses filleuls. `
      + 'Le code promo reste valable chez Stripe, et les filleuls déjà notés gardent leur commission.'
  }
  const changements: string[] = []
  const ajouter = (nom: string, avant: string, apres: string) => { if (avant !== apres) changements.push(`${nom} ${avant} -> ${apres}`) }
  ajouter('parrain', existant.parrain, a.parrain)
  ajouter('pseudo', existant.pseudo ? `@${existant.pseudo}` : 'aucun', a.pseudo ? `@${a.pseudo}` : 'aucun')
  ajouter('compte Telegram', existant.telegramId === null ? 'inconnu' : String(existant.telegramId), a.telegramId === null ? 'inconnu' : String(a.telegramId))
  ajouter('email', existant.email ?? 'aucun', a.email ?? 'aucun')
  ajouter('règle', regleLisible(existant), regleLisible(a))
  ajouter('depuis le', jourFr(existant.depuis), jourFr(a.depuis))
  ajouter('état', existant.actif ? 'actif' : 'désactivé', a.actif ? 'actif' : 'désactivé')
  if (changements.length === 0) return `Le code de parrainage ${existant.code} ${deNom(existant.parrain)} est déjà enregistré tel quel : rien ne changera.`
  return `Modifier le code de parrainage ${existant.code} : ${changements.join(' ; ')}. Les filleuls déjà notés gardent leur commission.`
}

/** L'entete d'une carte quand le controle n'a pas pu la composer. */
export function resumeCodeParrainage(p: Record<string, unknown>): string {
  return `Enregistrer ou modifier le code de parrainage ${String(p.code ?? '?')}${p.parrain ? ` (parrain ${String(p.parrain)})` : ''}.`
}

/** Les parametres tels qu'ils vont dans un log : ni pseudo, ni email, ni nom. */
export function paramsPourLogParrainage(p: Record<string, unknown>): Record<string, unknown> {
  return {
    code: p.code ?? null, actif: p.actif ?? null, taux_pct: p.taux_pct ?? null, palier: p.palier ?? null,
    telegram: p.telegram_id ? 'oui' : 'non', modification: p.code_id ? 'oui' : 'non',
  }
}

// ---------------------------------------------------------------------------
// Un code promo cree AVEC son parrain (carte de code promo, compte melanie)
// ---------------------------------------------------------------------------

export type ParrainCodePromo = { parrain: string; parrain_pseudo: string | null; parrain_telegram_id: number | null; parrain_email: string | null }

/**
 * Les champs parrain d'une carte de code promo : null = pas de parrain (un
 * code promo ordinaire), une chaine = refus. Le parrain est exige des qu'un
 * autre champ parrain est donne.
 */
export function lireParrainCodePromo(p: Record<string, unknown>): ParrainCodePromo | null | string {
  const donne = (v: unknown) => v !== null && v !== undefined && v !== ''
  if (!donne(p.parrain) && !donne(p.parrain_pseudo) && !donne(p.parrain_telegram_id) && !donne(p.parrain_email)) return null
  const lu = lireParamsCodeParrainage({
    code: p.code, parrain: p.parrain, pseudo: p.parrain_pseudo, telegram_id: p.parrain_telegram_id, email: p.parrain_email,
  })
  if (typeof lu === 'string') return lu
  if (!lu.parrain) return 'parrain : son prénom (le code promo est alors aussi son code de parrainage).'
  return { parrain: lu.parrain, parrain_pseudo: lu.pseudo, parrain_telegram_id: lu.telegram_id, parrain_email: lu.email }
}

/** La phrase ajoutee a la carte de code promo quand elle porte un parrain. */
export function complementCodePromo(p: ParrainCodePromo): string {
  return `Puis l'enregistrer comme code de parrainage ${deNom(p.parrain)}${p.parrain_pseudo ? ` (@${p.parrain_pseudo})` : ''} : `
    + `${regleLisible({ tauxPct: TAUX_PARRAINAGE_PCT, tauxPalierPct: TAUX_PALIER_PCT, palier: PALIER_FILLEULS })}, `
    + 'chaque filleul noté à son premier paiement.'
}
