// Regles PURES du RESUME DU MATIN du Live Club (Brice, 15/10) : aucune base,
// aucun reseau, aucun import de valeur. scripts/verifier-liveclub.mjs les
// charge telles quelles.
//
// Brice : « Telegram en prive, ca me va ; on ne rajoute pas Adil ; chaque
// matin, s'il y a eu du mouvement : les nouveaux abonnes avec leurs infos
// principales, nom, email et nom Telegram si on l'a ; meme pour les pauses,
// les reprises : il faut nous donner les NOMS, pas juste le nombre ».
//
// Ce module transforme des faits deja lus (journal du bot, Stripe, tables du
// cockpit) en evenements, puis en texte : une ligne par personne et par
// rubrique, rubriques vides omises, decoupe en messages Telegram de 4096
// caracteres au plus. Rien a dire = rien a envoyer (null). La lecture, la
// garde « une fois par jour » et l'envoi vivent dans resume.ts.

/** Ce qu'on sait d'une personne. Tout est facultatif : on dit ce qu'on a. */
export type Personne = { nom: string | null; email: string | null; pseudo: string | null; telegramId: number | null }

export type RubriqueResume =
  | 'nouveaux' | 'arrets' | 'pauses' | 'impayes' | 'sorties' | 'entrees' | 'acces' | 'adresses' | 'comptes' | 'humains'
  | 'reprises' | 'demandes' | 'contacter' | 'suspens'

/** Les rubriques, dans l'ordre du message. */
export const RUBRIQUES_RESUME: readonly { cle: RubriqueResume; titre: string }[] = [
  { cle: 'nouveaux', titre: 'Nouveaux abonnés' },
  { cle: 'arrets', titre: 'Arrêts demandés ou annulés' },
  { cle: 'pauses', titre: 'Pauses et reprises' },
  { cle: 'impayes', titre: 'Impayés' },
  { cle: 'sorties', titre: 'Sorties du groupe' },
  { cle: 'entrees', titre: 'Entrées dans le groupe' },
  { cle: 'acces', titre: 'Accès broker, exemptions et tarifs réservés' },
  { cle: 'adresses', titre: 'Adresses rattachées automatiquement' },
  { cle: 'comptes', titre: 'Comptes Telegram changés ou en conflit' },
  { cle: 'contacter', titre: 'À contacter' },
  { cle: 'humains', titre: "Demandes d'humain en attente" },
  { cle: 'reprises', titre: "Fils rendus au bot seul (24 h sans message de l'équipe)" },
  { cle: 'demandes', titre: "Nouvelles demandes de l'équipe" },
  { cle: 'suspens', titre: "Demandes de l'équipe restées sans réponse (Agent AOK)" },
]

export type EvenementResume = {
  rubrique: RubriqueResume
  /** La cle de la personne (voir Personne) : ses evenements d'une rubrique tiennent sur une ligne. */
  qui: string
  /** En minuscule, sans point final : il suit le nom sur la ligne. */
  detail: string
  /** Instant ISO, pour l'ordre des lignes. */
  quand: string
  /**
   * Deja la avant la fenetre (une demande d'humain qui attend encore) : il
   * figure dans le resume, mais ne suffit pas a l'envoyer.
   */
  ancien?: boolean
}

export const TITRE_RESUME = 'Live Club, ce qui a bougé depuis hier'
/** Limite d'un message Telegram (sendMessage), en caracteres. */
export const MAX_MESSAGE_TELEGRAM = 4096
/** Au-dela, le titre donne la date de depart au lieu de « depuis hier ». */
const FENETRE_HIER_MS = 36 * 3600 * 1000

// ---------------------------------------------------------------------------
// Petits formats
// ---------------------------------------------------------------------------

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** '2026-11-12' (ou un instant ISO) -> '12 novembre 2026' (jour lu tel quel). */
export function dateFr(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return null
  const jour = Number(m[3])
  return `${jour === 1 ? '1er' : jour} ${MOIS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

/** Un instant -> '14 octobre à 9 h 05', a l'heure de Paris. */
export function dateHeureParis(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t))
  const v = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const jour = Number(v('day'))
  return `${jour === 1 ? '1er' : jour} ${MOIS[Number(v('month')) - 1] ?? v('month')} à ${Number(v('hour'))} h ${v('minute')}`
}

// Caracteres de controle et invisibles, construits par leur code pour qu'aucun
// ne figure en clair dans ce fichier.
const INVISIBLES = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g')

/** Un texte tape par un tiers (nom Stripe, pseudo, demande) : une ligne, sans controle, `max` caracteres au plus. */
export function texteSur(brut: unknown, max = 60): string | null {
  if (typeof brut !== 'string') return null
  const s = brut.replace(INVISIBLES, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s
}

/** « Prénom Nom, email, @pseudo », ce qu'on en a. */
export function identite(p: Personne | undefined, qui: string): string {
  const morceaux: string[] = []
  const nom = texteSur(p?.nom)
  const email = texteSur(p?.email, 120)
  const pseudo = texteSur(p?.pseudo, 40)?.replace(/^@+/, '')
  if (nom) morceaux.push(nom)
  if (email) morceaux.push(email)
  if (pseudo) morceaux.push(`@${pseudo}`)
  if (morceaux.length) return morceaux.join(', ')
  if (p?.telegramId) return `compte Telegram u${p.telegramId}`
  const tid = /^t(\d+)$/.exec(qui)
  return tid ? `compte Telegram u${tid[1]}` : 'personne non identifiée'
}

// ---------------------------------------------------------------------------
// Le journal du bot (cockpit_liveclub_gestes)
// ---------------------------------------------------------------------------

export type GesteResume = {
  id: string
  geste: string
  resultat: string
  regle: string | null
  details: Record<string, unknown> | null
  fait_le: string
  telegram_id: number | null
  membre_id: string | null
  abonnement_id: string | null
}

/** La personne d'un geste : son compte Telegram, sinon sa fiche, sinon son abonnement. */
export function cleGeste(g: GesteResume): string {
  if (g.telegram_id) return `t${g.telegram_id}`
  if (g.membre_id) return `m${g.membre_id}`
  if (g.abonnement_id) return `s${g.abonnement_id}`
  return `g${g.id}`
}

const RAISON_ENTREE: Record<string, string> = {
  acces_broker: ' (accès broker)', exemption: ' (accès offert)', acces_manuel: ' (accès manuel)',
}

function date(d: Record<string, unknown>, champ: string): string | null {
  const v = d[champ]
  return typeof v === 'string' ? dateFr(v) : null
}

/**
 * La rubrique et la phrase d'un geste du journal, ou null s'il n'a pas sa
 * place dans le resume (rappels, refus, simulations, echecs). Seuls les gestes
 * 'fait' comptent, sauf 'adresse' et 'compte_telegram' (un conflit ou une
 * panne se signalent). `phraseAdresse` : la phrase d'un geste 'adresse',
 * calculee par l'appelant (elle demande l'adresse, que le journal ne garde
 * pas). `phraseCompte` (15/10) : celle d'un geste 'compte_telegram'
 * (phraseCompteResume, comptes-telegram-pur.ts : les comptes nommes).
 */
export function evenementDeGeste(
  g: GesteResume,
  o: { phraseAdresse?: string | null; phraseCompte?: string | null } = {},
): { rubrique: RubriqueResume; detail: string } | null {
  const d = g.details ?? {}
  const regle = g.regle ?? ''
  if (g.geste === 'adresse') {
    if (!['fait', 'refuse', 'echec'].includes(g.resultat)) return null
    return { rubrique: 'adresses', detail: o.phraseAdresse || 'autre adresse traitée, voir le journal du bot' }
  }
  if (g.geste === 'compte_telegram') {
    if (!['fait', 'refuse', 'echec'].includes(g.resultat)) return null
    return { rubrique: 'comptes', detail: o.phraseCompte || 'compte Telegram changé ou en conflit, voir le journal du bot' }
  }
  if (g.resultat !== 'fait') return null
  switch (g.geste) {
    case 'entree_acceptee':
      return { rubrique: 'entrees', detail: `entré dans le groupe${RAISON_ENTREE[regle] ?? ''}` }
    case 'retrait':
      if (regle === 'desabonne') return { rubrique: 'sorties', detail: 'sorti du groupe : abonnement terminé, fin de la période payée' }
      if (regle === 'impaye_5j') return { rubrique: 'impayes', detail: 'sorti du groupe : paiement en retard depuis plus de 5 jours' }
      if (regle === 'changement_compte') return { rubrique: 'sorties', detail: 'sorti du groupe : son abonnement est passé sur un autre compte Telegram' }
      // (31/10) Suivi des lots (lots-pur.ts) : pause, pas un bannissement.
      if (regle === 'lots_non_faits') return { rubrique: 'sorties', detail: 'accès broker en pause : premiers lots pas tradés dans le délai, sorti du groupe sans blocage' }
      // (31/10) « Pas de commission, pas d'accès » (lots-pur.ts) : fermé, pas un bannissement.
      if (regle === 'depot_perdu') return { rubrique: 'sorties', detail: 'accès broker fermé : dépôt pas activé (commission perdue), sorti du groupe sans blocage' }
      return { rubrique: 'sorties', detail: "sorti du groupe par l'équipe" }
    case 'fin_acces':
      return regle === 'fin_exemption' || d.motif === 'fin_exemption'
        ? { rubrique: 'sorties', detail: "sorti du groupe : fin de l'accès offert" }
        : { rubrique: 'sorties', detail: "sorti du groupe : fin de l'accès broker" }
    case 'pause': {
      if (regle === 'pause_effective') return { rubrique: 'pauses', detail: 'début de la pause : sorti du groupe' }
      if (regle === 'pause_resortie') return { rubrique: 'pauses', detail: 'en pause mais revenu dans le groupe : ressorti' }
      if (regle === 'pause_adoptee') return { rubrique: 'pauses', detail: 'pause posée hors du bot (Stripe), prise en compte' }
      const reprise = date(d, 'reprise_le')
      const qui = regle === 'manuel' ? "pause posée par l'équipe" : regle === 'demande_membre' ? 'pause demandée' : 'pause posée'
      return { rubrique: 'pauses', detail: `${qui}${reprise ? `, reprise le ${reprise}` : ''}` }
    }
    case 'reprise':
      if (regle === 'pause_deja_revenu') return { rubrique: 'pauses', detail: 'fin de la pause : déjà revenu dans le groupe' }
      return { rubrique: 'pauses', detail: 'fin de la pause : lien de retour envoyé' }
    case 'arret': {
      if (regle === 'fenetre_30j') return { rubrique: 'impayes', detail: 'abonnement arrêté : paiement en retard depuis plus de 30 jours' }
      const fin = date(d, 'fin')
      const qui = regle === 'manuel' ? "arrêt programmé par l'équipe" : regle === 'demande_membre' ? 'arrêt demandé' : 'arrêt programmé'
      return { rubrique: 'arrets', detail: `${qui}${fin ? `, accès jusqu'au ${fin}` : ''}` }
    }
    case 'arret_annule':
      return { rubrique: 'arrets', detail: "arrêt annulé, l'abonnement continue" }
    case 'invitation':
      if (regle === 'reouverture_impaye') {
        return { rubrique: 'impayes', detail: `paiement passé : accès rouvert, lien envoyé${d.canal === 'email' ? ' par email' : ''}` }
      }
      if (regle === 'retour_lots') return { rubrique: 'sorties', detail: 'premiers lots vus chez le broker : accès rouvert, lien envoyé' }
      if (regle === 'retour_depot') return { rubrique: 'sorties', detail: 'situation régularisée avec le broker : accès rouvert, lien envoyé' }
      return null
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Stripe : nouveaux abonnes, et ce qui a change hors du bot (portail, Dashboard)
// ---------------------------------------------------------------------------

/** Ce que le resume lit d'un abonnement (AbonnementResume, stripe.ts). */
export type AbonnementPourResume = {
  id: string
  statut: string
  arretPrevu: boolean
  pauseActive: boolean
  pauseJusquau: string | null
  finPeriode: string | null
  creeLe: string | null
  termineLe: string | null
}

const STATUTS_FINIS = new Set(['canceled', 'incomplete_expired'])
const STATUTS_SANS_PAIEMENT = new Set(['incomplete', 'incomplete_expired'])

/**
 * L'etat d'un abonnement en une chaine courte, sans donnee personnelle :
 * « statut|arret|reprise de la pause ». C'est ce que le resume garde d'un
 * jour sur l'autre (cockpit_liveclub_resumes.etat_abonnements) pour voir ce
 * qui a change hors du bot.
 */
export function codeAbonnement(a: AbonnementPourResume): string {
  const pause = a.pauseActive ? (a.pauseJusquau?.slice(0, 10) || 'sans') : ''
  return `${a.statut}|${a.arretPrevu ? 1 : 0}|${pause}`
}

function lireCode(code: string): { statut: string; arret: boolean; pause: string | null } {
  const [statut = '', arret = '0', pause = ''] = code.split('|')
  return { statut, arret: arret === '1', pause: pause || null }
}

/**
 * L'instantane des abonnements : les vivants, et les finis depuis moins de
 * `joursFinis` jours (au-dela, plus rien ne bouge). { sub_id: code }.
 */
export function instantaneAbonnements(abonnements: readonly AbonnementPourResume[], maintenantIso: string, joursFinis = 60): Record<string, string> {
  const limite = Date.parse(maintenantIso) - joursFinis * 86_400_000
  const sortie: Record<string, string> = {}
  for (const a of abonnements) {
    if (!a.id) continue
    if (STATUTS_FINIS.has(a.statut)) {
      const fin = a.termineLe ? Date.parse(a.termineLe) : NaN
      if (!Number.isFinite(fin) || fin < limite) continue
    }
    sortie[a.id] = codeAbonnement(a)
  }
  return sortie
}

export type GenreChangement = 'arret_demande' | 'arret_annule' | 'pause' | 'reprise' | 'resilie'
export type ChangementAbonnement = { abonnementId: string; genre: GenreChangement }

/**
 * Ce qui a change entre deux instantanes. Pas d'instantane avant (premier
 * resume) : rien. Un abonnement nouveau n'est pas un changement (il est dans
 * les nouveaux abonnes). Une fin apres un arret programme est attendue : rien
 * (la sortie du groupe dira le reste).
 */
export function changementsAbonnements(avant: Readonly<Record<string, string>> | null, apres: Readonly<Record<string, string>>): ChangementAbonnement[] {
  if (!avant) return []
  const sortie: ChangementAbonnement[] = []
  for (const [id, codeApres] of Object.entries(apres)) {
    const codeAvant = avant[id]
    if (!codeAvant || codeAvant === codeApres) continue
    const a = lireCode(codeAvant)
    const b = lireCode(codeApres)
    const vivantAvant = !STATUTS_FINIS.has(a.statut)
    const vivantApres = !STATUTS_FINIS.has(b.statut)
    if (vivantAvant && !vivantApres) {
      if (!a.arret) sortie.push({ abonnementId: id, genre: 'resilie' })
      continue
    }
    if (!vivantApres) continue
    if (!a.arret && b.arret) sortie.push({ abonnementId: id, genre: 'arret_demande' })
    if (a.arret && !b.arret) sortie.push({ abonnementId: id, genre: 'arret_annule' })
    if (!a.pause && b.pause) sortie.push({ abonnementId: id, genre: 'pause' })
    if (a.pause && !b.pause) sortie.push({ abonnementId: id, genre: 'reprise' })
  }
  return sortie
}

function couvreChangement(g: GesteResume, c: ChangementAbonnement): boolean {
  if (g.resultat !== 'fait' || g.abonnement_id !== c.abonnementId) return false
  switch (c.genre) {
    case 'arret_demande': return g.geste === 'arret' && g.regle !== 'fenetre_30j'
    case 'arret_annule': return g.geste === 'arret_annule'
    case 'pause': return g.geste === 'pause'
    case 'reprise': return g.geste === 'reprise'
    case 'resilie': return g.geste === 'arret' && g.regle === 'fenetre_30j'
  }
}

/** Les changements que le journal du bot ne dit pas deja (un geste fait sur le meme abonnement). */
export function changementsHorsDuBot(changements: readonly ChangementAbonnement[], gestes: readonly GesteResume[]): ChangementAbonnement[] {
  return changements.filter(c => !gestes.some(g => couvreChangement(g, c)))
}

/** La phrase d'un changement vu chez Stripe (portail du membre ou Dashboard). */
export function evenementDeChangement(c: ChangementAbonnement, a: AbonnementPourResume | undefined): { rubrique: RubriqueResume; detail: string } {
  switch (c.genre) {
    case 'arret_demande': {
      const fin = dateFr(a?.finPeriode)
      return { rubrique: 'arrets', detail: `arrêt demandé via Stripe${fin ? `, accès jusqu'au ${fin}` : ''}` }
    }
    case 'arret_annule': return { rubrique: 'arrets', detail: "arrêt annulé via Stripe, l'abonnement continue" }
    case 'resilie': return { rubrique: 'arrets', detail: 'abonnement résilié via Stripe' }
    case 'pause': {
      const reprise = dateFr(a?.pauseJusquau)
      return { rubrique: 'pauses', detail: `pause posée via Stripe${reprise ? `, reprise le ${reprise}` : ', sans date de reprise'}` }
    }
    case 'reprise': return { rubrique: 'pauses', detail: 'fin de la pause, prélèvements repris' }
  }
}

/** Un abonnement cree dans la fenetre (]depuis, jusqua]) dont le premier paiement n'a pas echoue. */
export function estNouvelAbonnement(a: AbonnementPourResume, depuisIso: string, jusquaIso: string): boolean {
  if (STATUTS_SANS_PAIEMENT.has(a.statut) || !a.creeLe) return false
  const t = Date.parse(a.creeLe)
  return Number.isFinite(t) && t > Date.parse(depuisIso) && t <= Date.parse(jusquaIso)
}

/** « nouvel abonnement, 139 € par mois, avec remise (tarif réservé) ». */
export function detailNouvelAbonnement(o: { montant: string | null; remise: boolean; tarifReserve: boolean; statut: string }): string {
  return `nouvel abonnement${o.montant ? `, ${o.montant}` : ''}${o.remise ? ', avec remise' : ''}`
    + `${o.tarifReserve ? ' (tarif réservé)' : ''}${o.statut === 'canceled' ? ', déjà arrêté' : ''}`
}

// ---------------------------------------------------------------------------
// Acces, demandes
// ---------------------------------------------------------------------------

const MOTIFS_EXEMPTION: Record<string, string> = {
  fondateur: 'fondateur', admin: 'administrateur', equipe: 'équipe', favorise: 'favorisé',
}

export function detailAccesBroker(jusquau: string | null): string {
  const fin = dateFr(jusquau)
  return `accès broker ouvert${fin ? ` jusqu'au ${fin}` : ''}`
}

export function detailExemption(motif: string, jusquau: string | null): string {
  const fin = dateFr(jusquau)
  return `accès offert (${MOTIFS_EXEMPTION[motif] ?? motif})${fin ? ` jusqu'au ${fin}` : ', sans date de fin'}`
}

export function detailTarifReserve(o: { tarif: string; paye: boolean }): string {
  return o.paye ? `tarif réservé payé (${o.tarif})` : `tarif réservé ouvert (${o.tarif}), en attente de paiement`
}

export function detailAttenteHumain(escaladeIso: string, app: string | null): string {
  return `attend une réponse de l'équipe depuis le ${dateHeureParis(escaladeIso)}${app && app !== 'telegram' ? ` (support du site, ${app})` : ''}`
}

/**
 * (16/10) Les demandes d'humain en attente, SANS les comptes de l'equipe
 * (cockpit_telegram_comptes) : un fil de Melanie du 08/10, d'avant la
 * transmission de l'equipe a l'agent, y figurait chaque matin.
 */
export function attentesHorsEquipe<T extends { telegram_id: bigint | number | null }>(attentes: readonly T[], equipe: Iterable<number>): T[] {
  const ids = new Set([...equipe].map(Number))
  return attentes.filter(a => a.telegram_id === null || !ids.has(Number(a.telegram_id)))
}

/** (16/10) Le bot a repris seul la main d'un fil : 24 h sans message de l'equipe (support-pont-pur.ts). */
export function detailRepriseBot(repriseIso: string): string {
  return `le bot a repris la main le ${dateHeureParis(repriseIso)}, sans message de l'équipe depuis 24 h`
}

const STATUTS_DEMANDE: Record<string, string> = { au_picker: ' (déjà au picker)', faite: ' (déjà faite)', refusee: ' (refusée)' }

export function detailDemande(texte: string, statut: string): string {
  return `« ${texteSur(texte, 200) ?? 'demande sans texte'} »${STATUTS_DEMANDE[statut] ?? ''}`
}

/**
 * (29/10) Une demande d'un membre de l'equipe restee sans reponse (ou
 * inachevee) dans son fil Agent AOK (demandesEnSuspens,
 * agent-cockpit-telegram-pur.ts). Brice : une demande de Mel restee sans
 * reponse etait perdue, personne ne le savait.
 */
export function detailSuspens(o: { extraits: readonly string[]; depuisIso: string | null; inachevee: boolean; nom: string }): string {
  const liste = o.extraits.slice(0, 3).map(t => `« ${texteSur(t, 120) ?? 'message sans texte'} »`).join(', ')
  const plus = o.extraits.length > 3 ? ` et ${o.extraits.length - 3} autre${o.extraits.length > 4 ? 's' : ''}` : ''
  const quand = o.depuisIso ? ` depuis le ${dateHeureParis(o.depuisIso)}` : ''
  return `${liste}${plus}, ${o.inachevee ? 'inachevée' : 'sans réponse'}${quand} ; pour la relancer : « reprends la demande de ${o.nom} »`
}

// ---------------------------------------------------------------------------
// Les membres a contacter (18/10, cockpit_membres_risque)
// ---------------------------------------------------------------------------
//
// Brice : les membres a risque sont une liste de personnes a CONTACTER
// (message perso, invitation a un live, rappel de carte), jamais une sanction.
// Le resume annonce ceux dont une fenetre s'est OUVERTE depuis le dernier
// resume : un episode (membre_id::cle_episode) absent de la memoire du resume
// precedent (cockpit_liveclub_resumes.risque_annonces), et pas deja marque
// « fait » au cockpit (cockpit_actions_traitees, meme cle que l'ecran). Sans
// memoire (les resumes d'avant le 18/10) : seules les fenetres ouvertes apres
// le jour du dernier resume, et aucun echec (sa date d'ouverture n'est pas
// connue) : le premier resume ne deverse pas toute la liste.

export type MotifContact = 'echec' | 'prelevement' | 'silence' | 'accueil'

/** Une ligne de cockpit_membres_risque, telle que le resume la lit. */
export type MembreAContacter = {
  membreId: string
  cleEpisode: string
  motif: MotifContact
  prochainPrelevement: string | null
  prochaineTentative: string | null
  joursSilence: number | null
  joursAnciennete: number | null
  /** Jour d'ouverture de la fenetre (AAAA-MM-JJ), nul pour un echec. */
  entree: string | null
}

/** La cle d'un episode, la meme que celle du cockpit (cleTraitee, ATraiter.tsx). */
export const cleAnnonce = (membreId: string, cleEpisode: string) => `${membreId}::${cleEpisode}`

/** Jours entre deux dates AAAA-MM-JJ (b - a). */
function ecartJours(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
}

/** L'ordre des fenetres, celui de l'ecran du cockpit. */
export const ORDRE_MOTIFS_CONTACT: readonly MotifContact[] = ['echec', 'prelevement', 'silence', 'accueil']

/**
 * Les episodes a annoncer : ni deja annonces (memoire), ni marques « fait ».
 * `annoncesAvant` null = pas de memoire : on retient les fenetres ouvertes
 * apres `depuisJour` (le jour de Paris du dernier resume), sans les echecs.
 * Ranges par fenetre (echec, prelevement, silence, accueil), puis par entree.
 */
export function episodesAAnnoncer(
  membres: readonly MembreAContacter[],
  o: { annoncesAvant: readonly string[] | null; traitees: ReadonlySet<string>; depuisJour: string },
): MembreAContacter[] {
  const connus = o.annoncesAvant ? new Set(o.annoncesAvant) : null
  return membres.filter(m => {
    const cle = cleAnnonce(m.membreId, m.cleEpisode)
    if (o.traitees.has(cle)) return false
    if (connus) return !connus.has(cle)
    return m.motif !== 'echec' && !!m.entree && m.entree.slice(0, 10) > o.depuisJour
  }).sort((a, b) => ORDRE_MOTIFS_CONTACT.indexOf(a.motif) - ORDRE_MOTIFS_CONTACT.indexOf(b.motif)
    || (a.entree ?? '').localeCompare(b.entree ?? ''))
}

/** Au-dela, une cle n'est plus gardee en memoire (aucune fenetre ne dure autant). */
const MEMOIRE_JOURS = 62

/**
 * La memoire a garder : les episodes presents aujourd'hui, plus ceux d'avant
 * dont la date (fin de la cle, AAAA-MM-JJ ou AAAA-MM pour un echec) a moins de
 * 62 jours. Un membre qui sort de la liste un jour (collecte en retard) puis
 * revient avec le meme episode n'est donc pas reannonce. Triee, sans doublon.
 */
export function memoireAnnonces(cles: readonly string[], avant: readonly string[] | null, aujourdhui: string): string[] {
  const garde = (cle: string) => {
    const m = /:(\d{4}-\d{2})(-\d{2})?$/.exec(cle)
    if (!m) return false
    return ecartJours(`${m[1]}${m[2] ?? '-01'}`, aujourdhui) <= MEMOIRE_JOURS
  }
  return [...new Set([...cles, ...(avant ?? []).filter(garde)])].sort()
}

/** Le motif d'un membre a contacter, en minuscule et sans point final (il suit le nom). */
export function detailAContacter(m: MembreAContacter, aujourdhui: string): string {
  switch (m.motif) {
    case 'echec': {
      const tentative = dateFr(m.prochaineTentative)
      return `paiement en échec${tentative ? `, nouvelle tentative le ${tentative}` : ''}`
    }
    case 'prelevement': {
      const n = m.prochainPrelevement ? ecartJours(aujourdhui, m.prochainPrelevement) : null
      const quand = n === null ? 'proche' : n <= 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} jours`
      return `prélèvement ${quand}, rien écrit depuis 30 j`
    }
    case 'silence':
      return `silencieux depuis ${m.joursSilence ?? 14} jours`
    case 'accueil':
      return `nouveau, pas encore un mot (arrivé il y a ${m.joursAnciennete ?? 5} j)`
  }
}

// (24/10) Le relais d'accueil (relais.ts, relais-pur.ts) : un episode
// transmis a un relais actif reste dans « À contacter », marque « (Alex s'en
// occupe) », pour ne pas faire doublon. Une fois que le relais a appuye sur
// « C'est fait », l'episode est marque dans cockpit_actions_traitees et sort
// de la liste comme tout episode traite.

/** Les noms des relais par episode (membre_id::cle_episode), sans doublon, dans l'ordre lu. */
export function relaisParEpisode(lignes: readonly { membre_id: string; cle_episode: string; nom: string | null }[]): Map<string, string[]> {
  const sortie = new Map<string, string[]>()
  for (const l of lignes) {
    const nom = texteSur(l.nom, 30)
    if (!nom) continue
    const cle = cleAnnonce(l.membre_id, l.cle_episode)
    const noms = sortie.get(cle) ?? []
    if (!noms.includes(nom)) noms.push(nom)
    sortie.set(cle, noms)
  }
  return sortie
}

/** « silencieux depuis 15 jours (Alex s'en occupe) » ; deux relais : « (Alex et Sam s'en occupent) ». */
export function detailAvecRelais(detail: string, noms: readonly string[]): string {
  const propres = [...new Set(noms.map(n => texteSur(n, 30)).filter((n): n is string => !!n))]
  if (propres.length === 0) return detail
  if (propres.length === 1) return `${detail} (${propres[0]} s'en occupe)`
  return `${detail} (${propres.slice(0, -1).join(', ')} et ${propres[propres.length - 1]} s'en occupent)`
}

/**
 * Le @pseudo d'un membre lu aux deux sources (Brice, 24/10) : le champ
 * Telegram de sa fiche et le compte rattache (registre du groupe). L'une
 * comble l'autre ; deux @ differents remontent en alerte, a verifier par
 * l'equipe. Le compte rattache passe devant : c'est celui du groupe.
 */
export function pseudoCroise(fiche: string | null | undefined, rattache: string | null | undefined): { pseudo: string | null; alerte: string | null } {
  // Un vrai @ seulement : le champ de la fiche porte parfois un nom (« Christophe chapelier », « Ginger »).
  const propre = (s: string | null | undefined) => {
    const t = texteSur(s, 40)?.replace(/^@+/, '').trim() ?? ''
    return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(t) ? t : null
  }
  const f = propre(fiche)
  const r = propre(rattache)
  const alerte = f && r && f.toLowerCase() !== r.toLowerCase()
    ? `deux @ différents, @${f} sur la fiche et @${r} sur le compte rattaché, à vérifier`
    : null
  return { pseudo: r ?? f, alerte }
}

/** La ligne « Bientôt », ou rien. Elle ne fait jamais partir le resume a elle seule (composerResume). */
export function ligneBientot(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null
  return n === 1
    ? 'Bientôt : 1 membre entre dans une fenêtre cette semaine'
    : `Bientôt : ${n} membres entrent dans une fenêtre cette semaine`
}

// ---------------------------------------------------------------------------
// Le message
// ---------------------------------------------------------------------------

/** Y a-t-il de quoi envoyer ? Une demande d'humain plus ancienne que la fenetre ne suffit pas. */
export function ilYAMouvement(evenements: readonly EvenementResume[]): boolean {
  return evenements.some(e => !e.ancien)
}

/** La premiere ligne : « depuis hier », ou la date de depart si la fenetre est plus longue. */
export function titreResume(depuisIso: string, jusquaIso: string): string {
  const ecart = Date.parse(jusquaIso) - Date.parse(depuisIso)
  if (!Number.isFinite(ecart) || ecart <= FENETRE_HIER_MS) return TITRE_RESUME
  const jour = dateFr(depuisIso)
  return jour ? `Live Club, ce qui a bougé depuis le ${jour}` : TITRE_RESUME
}

/**
 * Le resume, ou null s'il n'y a rien a dire. Une ligne par personne et par
 * rubrique (ses evenements separes par « ; »), dans l'ordre ou ils sont
 * arrives ; rubriques vides omises ; un evenement en double (meme detail pour
 * la meme personne) n'est dit qu'une fois. `bientot` (18/10) : le nombre de
 * membres qui entrent dans une fenetre de contact dans les 7 jours, dit en
 * pied ; il ne suffit jamais a envoyer.
 */
export function composerResume(
  evenements: readonly EvenementResume[],
  personnes: ReadonlyMap<string, Personne>,
  o: { depuis: string; jusqua: string; bientot?: number },
): string | null {
  if (!ilYAMouvement(evenements)) return null
  const tries = [...evenements].sort((a, b) => Date.parse(a.quand) - Date.parse(b.quand))
  const blocs: string[] = [titreResume(o.depuis, o.jusqua)]
  for (const { cle, titre } of RUBRIQUES_RESUME) {
    const parQui = new Map<string, string[]>()
    for (const e of tries) {
      if (e.rubrique !== cle) continue
      const details = parQui.get(e.qui) ?? []
      if (!details.includes(e.detail)) details.push(e.detail)
      parQui.set(e.qui, details)
    }
    if (parQui.size === 0) continue
    const lignes = [...parQui].map(([qui, details]) => `- ${identite(personnes.get(qui), qui)} : ${details.join(' ; ')}`)
    blocs.push([titre, ...lignes].join('\n'))
  }
  // (18/10) Qui entre dans une fenetre de contact dans les 7 jours : un
  // nombre, en pied, seulement si autre chose fait deja partir le resume.
  const bientot = ligneBientot(o.bientot ?? 0)
  if (bientot) blocs.push(bientot)
  return blocs.join('\n\n')
}

/** Coupe une ligne trop longue en morceaux de `max` caracteres au plus. */
function couper(ligne: string, max: number): string[] {
  const morceaux: string[] = []
  for (let i = 0; i < ligne.length; i += max) morceaux.push(ligne.slice(i, i + max))
  return morceaux.length ? morceaux : ['']
}

/**
 * Decoupe le resume en messages Telegram de `max` caracteres au plus, sans
 * couper une rubrique tant qu'elle tient dans un message. Une rubrique trop
 * longue est coupee entre deux lignes, et la suite reprend son titre
 * (« Titre (suite) »).
 */
export function decouperResume(texte: string, max = MAX_MESSAGE_TELEGRAM): string[] {
  const messages: string[] = []
  let courant = ''
  const pousser = () => { if (courant) messages.push(courant); courant = '' }
  const joint = (a: string, sep: string, b: string) => (a ? `${a}${sep}${b}` : b)
  for (const bloc of texte.split('\n\n')) {
    if (!bloc) continue
    // La rubrique entiere tient avec ce qui precede : a la suite.
    if (joint(courant, '\n\n', bloc).length <= max) { courant = joint(courant, '\n\n', bloc); continue }
    // Elle tient seule : un nouveau message.
    if (bloc.length <= max) { pousser(); courant = bloc; continue }
    // Trop longue pour un message : coupee entre deux lignes, en commencant
    // dans le message en cours s'il reste la place du titre et d'une ligne.
    const [titreBrut, ...lignes] = bloc.split('\n')
    const titre = titreBrut.slice(0, max)
    const suite = `${titre} (suite)`.length < max ? `${titre} (suite)` : ''
    const premiere = lignes[0] ?? ''
    if (joint(courant, '\n\n', `${titre}\n${premiere}`).length > max) pousser()
    courant = joint(courant, '\n\n', titre)
    for (const ligne of lignes) {
      if (courant.length + 1 + ligne.length <= max) { courant = `${courant}\n${ligne}`; continue }
      pousser()
      const place = suite ? max - suite.length - 1 : max
      for (const [i, m] of couper(ligne, place).entries()) {
        if (i > 0) pousser()
        courant = suite ? `${suite}\n${m}` : m
      }
    }
  }
  pousser()
  return messages
}

// ---------------------------------------------------------------------------
// L'historique de la conversation avec l'agent (cockpit_agent_conversations)
// ---------------------------------------------------------------------------

/**
 * La ligne qui precede le resume dans l'historique. Pourquoi une ligne
 * « utilisateur » : la normalisation de l'historique (normaliserHistorique,
 * agent-cockpit-telegram-pur.ts, 15/10) ecarte une reponse qui ouvre la
 * conversation et fusionne deux reponses qui se suivent. Precede de cette
 * ligne, le resume reste lisible par le modele, a sa place, et une question
 * « et pour Untel ? » posee juste en dessous s'y rapporte.
 */
export const MARQUEUR_RESUME_HISTORIQUE = "[système] Résumé du matin du Live Club, envoyé automatiquement par Agent AOK (ce n'est pas une question de l'équipe)."

/** Les deux lignes a ajouter a l'historique, avec un identifiant par jour (jamais ajoutees deux fois). */
export function entreesHistoriqueResume(texte: string, jour: string): { role: 'user' | 'assistant'; content: string; id: string }[] {
  return [
    { role: 'user', content: MARQUEUR_RESUME_HISTORIQUE, id: `resume-${jour}` },
    { role: 'assistant', content: texte, id: `resume-${jour}-texte` },
  ]
}
