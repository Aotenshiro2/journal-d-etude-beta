// Regles PURES du rattachement automatique d'une adresse email (Brice, 15/10) :
// aucune base, aucun reseau, aucun import. scripts/verifier-liveclub.mjs les
// charge telles quelles.
//
// LE CAS REEL : Yassine a un compte AOK (profile_emails). Il a paye son
// abonnement Live Club avec une AUTRE adresse, par son lien personnel (tarif
// reserve). Resultat : deux fiches dans le cockpit, et un compte AOK qui ne
// connait pas l'adresse du paiement. Brice : « retrouve son compte AOK et
// assigne-lui ce mail secondaire directement ».
//
// Une adresse n'est rattachee que sur une PREUVE, et seulement celles-ci :
// - 'tarif_reserve' : un tarif reserve (personnel) paye avec une autre adresse
//   que celle de la reservation. L'adresse du PAIEMENT va a la personne de la
//   reservation, jamais l'inverse : l'adresse de la reservation a ete donnee
//   par l'equipe, personne n'en a prouve la possession.
// - 'telegram' : un meme compte Telegram relie a deux adresses, chaque fois
//   par une preuve de possession (lien personnel de la page de bienvenue ou
//   code envoye par email, source 'bot' des rattachements). Les deux adresses
//   sont prouvees : le rattachement va dans les deux sens.
// Jamais par le nom. Jamais si l'adresse est deja sur un AUTRE compte AOK, ou
// sur une autre fiche du cockpit qui porte un abonnement vivant que la preuve
// ne couvre pas : on n'ecrase rien, on le signale (journal du bot, resume du
// matin).
//
// verified = true sur profile_emails ouvre des lectures (skool_members, voir
// la migration 20260930130400) : c'est pour ca qu'il ne se pose que sur preuve.

export type PreuveAdresse = 'tarif_reserve' | 'telegram'

/** Ce que la base dit d'une adresse (deja normalisee, en minuscules). */
export type AdresseLue = {
  email: string
  /** La ligne de profile_emails qui porte cette adresse (un compte AOK), ou null. */
  compte: { profileId: string; verifie: boolean } | null
  /** La fiche du cockpit (cockpit_membre_emails) qui porte cette adresse, ou null. */
  fiche: { membreId: string } | null
}

/** Un abonnement d'une fiche du cockpit (cockpit_abonnements). */
export type AbonnementFiche = { id: string; statut: string; client: string | null }

export type EntreeRattachement = {
  preuve: PreuveAdresse
  /** L'adresse de la personne connue (tarif reserve : celle de la reservation ; telegram : l'ancienne). */
  connue: AdresseLue
  /** L'adresse prouvee (tarif reserve : celle du paiement ; telegram : la nouvelle). */
  nouvelle: AdresseLue
  /** Les abonnements de chaque fiche en jeu, par membre_id. */
  abonnementsParFiche: Readonly<Record<string, readonly AbonnementFiche[]>>
  /**
   * Ce que la preuve couvre : l'abonnement qui a paye le tarif reserve, ou les
   * clients Stripe des deux rattachements. Un abonnement couvert est celui de
   * la personne elle-meme : il ne fait jamais conflit.
   */
  couverts: { abonnements: readonly string[]; clients: readonly string[] }
}

export type ActionCompte =
  | { action: 'ajouter'; profileId: string; email: string }
  | { action: 'verifier'; profileId: string; email: string }
  | { action: 'rien'; raison: 'deja' | 'sans_compte' | 'compte_non_verifie' }

export type ActionFiche =
  | { action: 'ajouter'; membreId: string; email: string }
  | { action: 'rien'; raison: 'deja' | 'sans_fiche' | 'doublon_fusion_collecte' | 'doublon_a_fusionner' }

export type RaisonConflit = 'autre_compte_aok' | 'autre_fiche_abonnee'

export type PlanRattachement = {
  /** Non null : rien n'est ecrit, ni sur le compte AOK, ni sur la fiche. */
  conflit: RaisonConflit | null
  compte: ActionCompte
  fiche: ActionFiche
}

/** Le symetrique d'une preuve : les deux adresses sont prouvees. */
export function preuveSymetrique(p: PreuveAdresse): boolean {
  return p === 'telegram'
}

/** Statuts d'un abonnement fini : il ne fait plus conflit. */
const STATUTS_FINIS = new Set(['canceled', 'incomplete_expired', 'incomplete'])

/**
 * Les abonnements VIVANTS d'une fiche que la preuve ne couvre pas. Les ids du
 * cockpit portent le prefixe de leur source (« stripe:sub_... ») : il est
 * retire avant la comparaison. Un abonnement sans client connu n'est jamais
 * couvert par un client.
 */
export function abonnementsHorsPreuve(
  abonnements: readonly AbonnementFiche[],
  couverts: { abonnements: readonly string[]; clients: readonly string[] },
): AbonnementFiche[] {
  const ids = new Set(couverts.abonnements.map(sansPrefixe))
  const clients = new Set(couverts.clients.filter(Boolean))
  return abonnements.filter(a => !STATUTS_FINIS.has(a.statut)
    && !ids.has(sansPrefixe(a.id))
    && !(a.client && clients.has(a.client)))
}

function sansPrefixe(id: string): string {
  return id.replace(/^[a-z]+:/, '')
}

/** Le cote du compte AOK. */
function planCompte(e: EntreeRattachement, symetrique: boolean): ActionCompte | RaisonConflit {
  const a = e.connue.compte
  const b = e.nouvelle.compte
  if (a && b) {
    if (a.profileId !== b.profileId) return 'autre_compte_aok'
    if (a.verifie && !b.verifie) return { action: 'verifier', profileId: a.profileId, email: e.nouvelle.email }
    if (symetrique && b.verifie && !a.verifie) return { action: 'verifier', profileId: b.profileId, email: e.connue.email }
    return { action: 'rien', raison: a.verifie || b.verifie ? 'deja' : 'compte_non_verifie' }
  }
  if (a) {
    // Une adresse rattachee sans preuve (ajoutee a la main, jamais verifiee)
    // ne designe personne : on n'y accroche rien.
    return a.verifie ? { action: 'ajouter', profileId: a.profileId, email: e.nouvelle.email } : { action: 'rien', raison: 'compte_non_verifie' }
  }
  if (b) {
    if (symetrique) {
      return b.verifie ? { action: 'ajouter', profileId: b.profileId, email: e.connue.email } : { action: 'rien', raison: 'compte_non_verifie' }
    }
    // Tarif reserve : l'adresse du paiement est deja celle d'un compte, et la
    // personne de la reservation n'en a pas. Ce n'est pas forcement elle (un
    // proche qui paie avec son compte) : on ne relie rien, on le signale.
    return 'autre_compte_aok'
  }
  return { action: 'rien', raison: 'sans_compte' }
}

/** Les deux adresses finissent-elles sur le meme compte AOK verifie ? */
function memeCompteApres(e: EntreeRattachement, compte: ActionCompte): boolean {
  if (compte.action !== 'rien') return true
  const a = e.connue.compte
  const b = e.nouvelle.compte
  return Boolean(a && b && a.profileId === b.profileId && a.verifie && b.verifie)
}

/** Le cote de la fiche du cockpit (cockpit_membre_emails). */
function planFiche(e: EntreeRattachement, symetrique: boolean, compte: ActionCompte): ActionFiche | RaisonConflit {
  const fa = e.connue.fiche
  const fb = e.nouvelle.fiche
  if (fa && fb) {
    if (fa.membreId === fb.membreId) return { action: 'rien', raison: 'deja' }
    // Deux fiches. Celle de l'adresse prouvee (les deux en symetrique) ne doit
    // porter aucun abonnement vivant que la preuve ne couvre pas : sinon c'est
    // peut-etre quelqu'un d'autre.
    const aVerifier = symetrique ? [fa, fb] : [fb]
    for (const f of aVerifier) {
      if (abonnementsHorsPreuve(e.abonnementsParFiche[f.membreId] ?? [], e.couverts).length > 0) return 'autre_fiche_abonnee'
    }
    // La cle primaire de cockpit_membre_emails est l'adresse : on ne la deplace
    // pas d'une fiche a l'autre. La collecte du matin (push_membres_supabase.py)
    // fusionne les fiches dont les adresses sont sur le meme compte AOK.
    return { action: 'rien', raison: memeCompteApres(e, compte) ? 'doublon_fusion_collecte' : 'doublon_a_fusionner' }
  }
  if (fa) return { action: 'ajouter', membreId: fa.membreId, email: e.nouvelle.email }
  if (fb && symetrique) return { action: 'ajouter', membreId: fb.membreId, email: e.connue.email }
  return { action: 'rien', raison: 'sans_fiche' }
}

/**
 * Le plan d'un rattachement sur preuve. Les deux adresses doivent etre
 * differentes et normalisees. Un conflit, d'un cote ou de l'autre, bloque
 * TOUT : rien n'est ecrit.
 */
export function planRattachement(e: EntreeRattachement): PlanRattachement {
  const symetrique = preuveSymetrique(e.preuve)
  const rien: PlanRattachement = { conflit: null, compte: { action: 'rien', raison: 'deja' }, fiche: { action: 'rien', raison: 'deja' } }
  if (!e.connue.email || !e.nouvelle.email || e.connue.email === e.nouvelle.email) return rien
  const compte = planCompte(e, symetrique)
  if (typeof compte === 'string') return { ...rien, conflit: compte }
  const fiche = planFiche(e, symetrique, compte)
  if (typeof fiche === 'string') return { ...rien, conflit: fiche }
  return { conflit: null, compte, fiche }
}

/**
 * Ce que le journal du bot retient d'un plan : 'fait' (quelque chose est
 * ecrit), 'refuse' (conflit, ou doublon de fiches que rien ne relie, a
 * fusionner a la main), ou null (rien a dire : deja fait, personne connue).
 */
export function resultatDuPlan(p: PlanRattachement): 'fait' | 'refuse' | null {
  if (p.conflit) return 'refuse'
  if (p.compte.action !== 'rien' || p.fiche.action === 'ajouter') return 'fait'
  if (p.fiche.action === 'rien' && p.fiche.raison === 'doublon_a_fusionner') return 'refuse'
  return null
}

/** Les details du journal (jamais d'email) : ce qui a ete fait de chaque cote. */
export function detailsDuPlan(p: PlanRattachement): Record<string, string> {
  const compte = p.compte.action === 'ajouter' ? 'ajoute' : p.compte.action === 'verifier' ? 'verifie' : p.compte.raison
  const fiche = p.fiche.action === 'ajouter' ? 'ajoute' : p.fiche.raison
  return p.conflit ? { raison: p.conflit } : {
    compte, fiche,
    ...(p.fiche.action === 'rien' && p.fiche.raison === 'doublon_a_fusionner' ? { raison: 'doublon_a_fusionner' } : {}),
  }
}

/**
 * L'adresse du paiement d'un tarif reserve, si elle n'est pas celle de la
 * reservation : c'est elle qu'on rattache. Les deux en minuscules, sans
 * espaces. null = meme adresse, ou adresse illisible.
 */
export function adresseDePaiementAutre(emailReserve: string | null | undefined, emailPaiement: string | null | undefined): string | null {
  const r = propre(emailReserve)
  const p = propre(emailPaiement)
  return r && p && r !== p ? p : null
}

/**
 * La preuve 'telegram' : le compte Telegram passe d'une adresse a une autre,
 * les DEUX fois par une preuve de possession (source 'bot' : lien personnel
 * ou code email). Un rattachement repris de Metricgram ou pose a la main par
 * l'equipe ne prouve pas que la personne possede l'adresse. null = pas de
 * preuve.
 */
export function preuveTelegram(
  ancien: { email: string | null; source: string } | null | undefined,
  nouveau: { email: string | null; source: string },
): { ancienne: string; nouvelle: string } | null {
  if (!ancien || ancien.source !== 'bot' || nouveau.source !== 'bot') return null
  const a = propre(ancien.email)
  const n = propre(nouveau.email)
  return a && n && a !== n ? { ancienne: a, nouvelle: n } : null
}

function propre(brut: unknown): string | null {
  const s = String(brut ?? '').trim().toLowerCase()
  if (s.length < 5 || s.length > 254) return null
  return /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[a-z]{2,}$/.test(s) ? s : null
}

/**
 * Ce que dit le resume du matin d'un geste 'adresse' (email resolu par
 * l'appelant, ou null), en minuscule et sans point final : il suit le nom de
 * la personne sur sa ligne.
 */
export function phraseAdresse(g: {
  resultat: string
  regle: string | null
  details?: Record<string, unknown> | null
}, email: string | null = null): string {
  const d = g.details ?? {}
  const quoi = email ? `adresse ${email}` : 'autre adresse'
  const preuve = g.regle === 'telegram'
    ? 'même compte Telegram vérifié sur les deux adresses'
    : 'tarif réservé payé avec cette adresse'
  if (g.resultat === 'echec') return `${quoi} : rattachement automatique en panne, à faire à la main`
  if (g.resultat === 'refuse') {
    if (d.raison === 'autre_compte_aok') return `${quoi} non rattachée : elle est déjà sur un autre compte AOK, rien n'a été changé, à vérifier`
    if (d.raison === 'autre_fiche_abonnee') return `${quoi} non rattachée : elle est sur une autre fiche du cockpit avec un abonnement en cours, rien n'a été changé, à vérifier`
    if (d.raison === 'doublon_a_fusionner') return `${quoi} a sa propre fiche et aucun compte AOK ne relie les deux : fiches à fusionner à la main (${preuve})`
    return `${quoi} non rattachée automatiquement, à vérifier`
  }
  const faits: string[] = []
  if (d.compte === 'ajoute') faits.push('ajoutée à son compte AOK')
  if (d.compte === 'verifie') faits.push('vérifiée sur son compte AOK')
  if (d.fiche === 'ajoute') faits.push('rattachée à sa fiche du cockpit')
  if (d.fiche === 'doublon_fusion_collecte') faits.push('ses deux fiches seront fusionnées par la collecte du matin')
  return `${quoi} ${faits.length ? faits.join(', ') : 'déjà connue'} (${preuve})`
}
