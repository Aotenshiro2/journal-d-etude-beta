// L'EFFACEMENT DES DONNEES D'UNE PERSONNE : les regles PURES (Brice, 15/10/2026).
// Aucune base, aucun reseau, aucun import : scripts/verifier-effacement.mjs
// les charge telles quelles.
//
// Trois niveaux, jamais automatiques. C'est l'equipe qui qualifie le niveau
// avec la personne, puis l'execute par l'agent du cockpit (proposer_effacement,
// carte de confirmation). Le bot des membres ne propose jamais l'effacement :
// il transmet la demande (prompt-membre.ts).
//
// Ce qui est efface, garde ou anonymise, table par table, et pourquoi :
// docs/EFFACEMENT-DONNEES.md (il fait foi). Les comptes viennent de
// cockpit_effacement_apercu et de cockpit_effacer (migration
// 20261016090000_cockpit_effacement.sql) : memes cles des deux cotes.

export type Niveau = 1 | 2 | 3

export const NOMS_NIVEAUX: Record<Niveau, string> = {
  1: 'ne plus être suivi',
  2: 'effacer ses échanges avec nos bots',
  3: 'partir et tout effacer',
}

const RAPPEL_NIVEAUX = 'niveau : 1 (ne plus être suivi), 2 (effacer ses échanges avec nos bots) ou 3 (partir et tout effacer). '
  + "C'est l'équipe qui le choisit avec la personne : s'il n'a pas été dit, demande-le, ne le choisis jamais."

/**
 * Le niveau, strictement : 1, 2 ou 3 (nombre ou chiffre seul). Tout le reste
 * est un refus qui rappelle les trois niveaux, pour que le modele demande au
 * lieu de choisir.
 */
export function lireNiveau(brut: unknown): Niveau | string {
  const n = typeof brut === 'number' ? brut : typeof brut === 'string' && /^\s*[123]\s*$/.test(brut) ? Number(brut) : NaN
  return n === 1 || n === 2 || n === 3 ? n : RAPPEL_NIVEAUX
}

/** Les identifiants resolus d'une personne (liens certains), tels que la carte les garde. */
export type CibleEffacement = { telegram: number[]; membres: string[]; archives: string[]; emails: string[] }

export const MAX_CIBLE = { telegram: 6, membres: 3, archives: 6, emails: 8 } as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ARCHIVE = /^p-[a-z0-9][a-z0-9-]{0,120}$/
const EMAIL = /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[a-z]{2,}$/

export function cibleVide(c: CibleEffacement): boolean {
  return c.telegram.length + c.membres.length + c.archives.length + c.emails.length === 0
}

/** La cible memorisee par la carte, validee strictement (rien d'inattendu ne passe). */
export function lireCible(brut: unknown): CibleEffacement | string {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return 'cible illisible.'
  const b = brut as Record<string, unknown>
  const liste = (k: string): unknown[] | null => (b[k] == null ? [] : Array.isArray(b[k]) ? (b[k] as unknown[]) : null)
  const tg = liste('telegram')
  const mb = liste('membres')
  const ar = liste('archives')
  const em = liste('emails')
  if (!tg || !mb || !ar || !em) return 'cible illisible (listes attendues).'
  const telegram = [...new Set(tg.map(Number))]
  if (telegram.some((x) => !Number.isSafeInteger(x) || x <= 0)) return 'cible : numéro Telegram invalide.'
  const membres = [...new Set(mb.map((x) => String(x).toLowerCase()))]
  if (membres.some((x) => !UUID.test(x))) return 'cible : fiche membre invalide.'
  const archives = [...new Set(ar.map(String))]
  if (archives.some((x) => !ARCHIVE.test(x))) return "cible : fiche d'archive invalide."
  const emails = [...new Set(em.map((x) => String(x).trim().toLowerCase()))]
  if (emails.some((x) => x.length > 254 || !EMAIL.test(x))) return 'cible : email invalide.'
  if (telegram.length > MAX_CIBLE.telegram || membres.length > MAX_CIBLE.membres
    || archives.length > MAX_CIBLE.archives || emails.length > MAX_CIBLE.emails) {
    return 'cible trop large : plusieurs personnes probablement réunies, à vérifier à la main.'
  }
  return { telegram: telegram.sort((x, y) => x - y), membres: membres.sort(), archives: archives.sort(), emails: emails.sort() }
}

export type ParamsEffacement = { niveau: Niveau; qui: string; cible?: CibleEffacement }

/** Les parametres de proposer_effacement (et de la carte memorisee). */
export function lireParamsEffacement(p: Record<string, unknown>): ParamsEffacement | string {
  const qui = String(p.qui ?? '').replace(/\s+/g, ' ').trim()
  if (!qui) return "qui : la personne (nom, @pseudo, numéro Telegram u..., email, ou l'identifiant rendu par fiche_personne)."
  if (qui.length > 120) return 'qui trop long (120 caractères au plus).'
  const niveau = lireNiveau(p.niveau)
  if (typeof niveau === 'string') return niveau
  if (p.cible == null) return { niveau, qui }
  const cible = lireCible(p.cible)
  if (typeof cible === 'string') return cible
  return { niveau, qui, cible }
}

// ---------------------------------------------------------------------------
// L'apercu (cockpit_effacement_apercu) et le resultat (cockpit_effacer)
// ---------------------------------------------------------------------------

export type Comptes = Record<string, number>

export type ApercuEffacement = {
  niveau: Niveau
  cibles: Comptes
  efface: Comptes
  anonymise: Comptes
  garde: Comptes
  externe: Comptes
  bloquants: string[]
  alertes: string[]
}

function comptes(v: unknown): Comptes {
  const r: Comptes = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return r
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(x)
    if (Number.isFinite(n) && n >= 0) r[k] = Math.round(n)
  }
  return r
}

function textes(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Le JSON de cockpit_effacement_apercu, ou null s'il est illisible. */
export function lireApercu(brut: unknown): ApercuEffacement | null {
  const o = typeof brut === 'string' ? (() => { try { return JSON.parse(brut) as unknown } catch { return null } })() : brut
  if (!o || typeof o !== 'object') return null
  const a = o as Record<string, unknown>
  const niveau = lireNiveau(a.niveau)
  if (typeof niveau === 'string') return null
  return {
    niveau,
    cibles: comptes(a.cibles),
    efface: comptes(a.efface),
    anonymise: comptes(a.anonymise),
    garde: comptes(a.garde),
    externe: comptes(a.externe),
    bloquants: textes(a.bloquants),
    alertes: textes(a.alertes),
  }
}

export type ResultatEffacement = {
  effacementId: string | null
  niveau: Niveau
  efface: Comptes
  anonymise: Comptes
  garde: Comptes
}

/** Le JSON rendu par cockpit_effacer, ou null. */
export function lireResultat(brut: unknown): ResultatEffacement | null {
  const o = typeof brut === 'string' ? (() => { try { return JSON.parse(brut) as unknown } catch { return null } })() : brut
  if (!o || typeof o !== 'object') return null
  const a = o as Record<string, unknown>
  const niveau = lireNiveau(a.niveau)
  if (typeof niveau === 'string') return null
  return {
    effacementId: typeof a.effacement_id === 'string' ? a.effacement_id : null,
    niveau,
    efface: comptes(a.efface),
    anonymise: comptes(a.anonymise),
    garde: comptes(a.garde),
  }
}

const somme = (c: Comptes) => Object.values(c).reduce((s, n) => s + n, 0)

/** Ce qui bougerait : efface plus anonymise. Zero = rien a faire a ce niveau. */
export function totalTouche(a: Pick<ApercuEffacement, 'efface' | 'anonymise'>): number {
  return somme(a.efface) + somme(a.anonymise)
}

const BLOQUANTS: Record<string, string> = {
  equipe: "c'est un compte de l'équipe (cockpit ou Agent AOK) : le niveau 3 ne s'applique pas à l'équipe.",
  formateur: "son compte AOK est formateur d'un cours : à régler à la main avant tout effacement de niveau 3.",
  tarif_reserve_en_attente: "un tarif réservé l'attend encore, avec un lien de paiement actif : retire-le d'abord "
    + '(proposer_retirer_tarif_reserve), puis repropose l\'effacement.',
  trop_large: 'la recherche réunit trop de comptes ou de fiches (plus de 3 fiches ou comptes AOK, ou plus de 6 comptes '
    + 'Telegram) : plusieurs personnes sont sans doute mêlées, à vérifier à la main.',
}

/** Un refus avant la carte (bloquant, ou rien a effacer), ou null. */
export function refusApercu(a: ApercuEffacement): string | null {
  const raisons = a.bloquants.map((b) => BLOQUANTS[b] ?? `refus : ${b}.`)
  if (raisons.length) return `Effacement de niveau ${a.niveau} refusé, rien n'a été proposé : ${raisons.join(' ')}`
  if (totalTouche(a) === 0) {
    return `Rien à effacer au niveau ${a.niveau} (${NOMS_NIVEAUX[a.niveau]}) pour cette personne : aucune donnée de ce niveau en base.`
  }
  return null
}

// ---------------------------------------------------------------------------
// La carte : app par app
// ---------------------------------------------------------------------------

type Libelle = [singulier: string, pluriel: string]

/** Les cles de l'apercu, rangees par app, avec leur libelle. L'ordre est celui de la carte. */
export const APPS: { app: string; cles: Record<string, Libelle> }[] = [
  {
    app: 'Groupes Telegram',
    cles: {
      tg_messages: ['message relevé', 'messages relevés'],
      tg_noms: ['nom (historique)', 'noms (historique)'],
      tg_registre: ['ligne du registre du groupe', 'lignes du registre du groupe'],
    },
  },
  {
    app: "Archive d'avant le 30/08",
    cles: {
      archive_fiches: ['fiche', 'fiches'],
      archive_paroles: ['parole', 'paroles'],
      archive_vies: ['extrait de vie', 'extraits de vie'],
      archive_dossiers: ['dossier', 'dossiers'],
      archive_themes: ['thème', 'thèmes'],
      archive_reseaux: ['profil posté', 'profils postés'],
      archive_presences: ['présence dans un salon', 'présences dans des salons'],
      archive_echanges: ["lien d'échange", "liens d'échange"],
      archive_notes: ["note de l'équipe", "notes de l'équipe"],
      archive_propositions: ["proposition d'enquête", "propositions d'enquête"],
      archive_liens_manuels: ['rattachement posé à la main', 'rattachements posés à la main'],
    },
  },
  {
    app: 'Bot des membres et support',
    cles: {
      bot_fils: ['fil de conversation', 'fils de conversation'],
      bot_conversations: ['mémoire du bot', 'mémoires du bot'],
    },
  },
  {
    app: "Journal d'Études",
    cles: {
      journal_notes: ['note', 'notes'],
      journal_messages: ['bloc de note', 'blocs de notes'],
      journal_canevas: ['canevas', 'canevas'],
      journal_annotations: ['annotation', 'annotations'],
      journal_etiquettes: ['étiquette', 'étiquettes'],
      journal_dossiers: ['dossier', 'dossiers'],
      journal_patterns: ['pattern', 'patterns'],
      journal_rituels: ['rituel', 'rituels'],
      journal_jeu_abc: ['partie du jeu ABC', 'parties du jeu ABC'],
      journal_imports_trades: ['trade importé', 'trades importés'],
      journal_plans_mentor: ['plan du mentor', 'plans du mentor'],
      journal_activite: ["jour d'activité", "jours d'activité"],
      journal_acces_mentor: ['accès mentor accordé à la main', 'accès mentor accordés à la main'],
    },
  },
  {
    app: 'Compte AOK (site, masterclass, académie)',
    cles: {
      aok_comptes: ['compte', 'comptes'],
      aok_identites: ['identité de connexion', 'identités de connexion'],
      aok_sessions: ['session', 'sessions'],
      aok_profils: ['profil', 'profils'],
      aok_emails: ['email du compte', 'emails du compte'],
      aok_journaux_securite: ['trace de connexion', 'traces de connexion'],
      connexions_tentees: ['tentative de connexion', 'tentatives de connexion'],
      skool_miroir: ['ligne Skool', 'lignes Skool'],
      masterclass_inscriptions: ['inscription masterclass', 'inscriptions masterclass'],
      quiz_reponses: ['réponse au quiz', 'réponses au quiz'],
      academie_progression: ["leçon suivie à l'académie", "leçons suivies à l'académie"],
      academie_acces: ["accès à l'académie", "accès à l'académie"],
      aok_objectifs: ['objectif', 'objectifs'],
      aok_progression: ['progression de cours', 'progressions de cours'],
      aok_lecons: ['leçon perso', 'leçons perso'],
      aok_comptes_propfirm: ['compte prop firm', 'comptes prop firm'],
      aok_recherches: ['recherche', 'recherches'],
    },
  },
  {
    app: 'Cockpit (sa fiche)',
    cles: {
      fiche_membres: ['fiche membre', 'fiches membres'],
      fiche_emails: ['email', 'emails'],
      fiche_notes: ["note de l'équipe", "notes de l'équipe"],
      fiche_avatar: ['avatar posé à la main', 'avatars posés à la main'],
      fiche_etm: ['statut ETM', 'statuts ETM'],
      fiche_acces_manuel: ['accès posé à la main', 'accès posés à la main'],
      fiche_actions_traitees: ['action traitée', 'actions traitées'],
      fiche_contact: ['contact posé à la main', 'contacts posés à la main'],
      fiche_lien_archive: ["lien vers l'archive", "liens vers l'archive"],
    },
  },
  {
    app: 'Live Club',
    cles: {
      lc_rattachements: ['rattachement Telegram', 'rattachements Telegram'],
      lc_exemptions: ['exemption', 'exemptions'],
      lc_gestes: ['geste du bot', 'gestes du bot'],
      lc_acces_broker: ['accès broker', 'accès broker'],
      lc_tarifs_reserves: ['tarif réservé', 'tarifs réservés'],
      lc_jetons: ['lien personnel', 'liens personnels'],
      lc_codes: ['code de vérification', 'codes de vérification'],
      lc_codes_adresses: ['compteur de codes', 'compteurs de codes'],
    },
  },
]

const ANONYMISE: Record<string, string> = {
  tg_registre_noms: 'le registre du groupe garde son compte (présence) mais plus son nom',
  ia_usage: "le coût de l'IA de ses échanges reste, sans lien vers lui",
  lc_acces_broker_gardes: 'accès broker liés à une commission : gardés (pièce de la commission), sans compte Telegram ni note',
  academie_acces_preuves: "accès académie payés ou avec renonciation à la rétractation : gardés comme preuve, sans compte",
}

function nombre(n: number, l: Libelle): string {
  return `${n} ${n > 1 ? l[1] : l[0]}`
}

/** Une ligne par app qui a quelque chose (zero = rien dit). Les cles inconnues vont dans « Autres ». */
export function lignesParApp(c: Comptes, maxParApp = 7): string[] {
  const connues = new Set(APPS.flatMap((a) => Object.keys(a.cles)))
  const lignes: string[] = []
  for (const a of APPS) {
    const morceaux = Object.entries(a.cles)
      .filter(([k]) => (c[k] ?? 0) > 0)
      .map(([k, l]) => nombre(c[k], l))
    if (morceaux.length === 0) continue
    const vus = morceaux.slice(0, maxParApp)
    lignes.push(`- ${a.app} : ${vus.join(', ')}${morceaux.length > vus.length ? `, et ${morceaux.length - vus.length} autre(s) table(s)` : ''}.`)
  }
  const autres = Object.entries(c).filter(([k, n]) => !connues.has(k) && n > 0)
  if (autres.length) lignes.push(`- Autres : ${autres.map(([k, n]) => `${k} ${n}`).join(', ')}.`)
  return lignes
}

function anonymiseLignes(c: Comptes): string[] {
  return Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `- ${n} : ${ANONYMISE[k] ?? k}.`)
}

/** Ce qui reste a faire a la main (hors base), selon le niveau et ce que l'apercu sait. */
export function etapesManuelles(niveau: Niveau, externe: Comptes = {}): string[] {
  if (niveau !== 3) return []
  const r = [
    "Kit : supprimer l'abonné (son email) s'il y est.",
    'Skool : le retirer du groupe Skool s\'il y est (aucune API, ni chez nous ni chez Skool).',
  ]
  if ((externe.abonnements_autres_vivants ?? 0) > 0) {
    r.push(`Stripe du compte aoknowledge : ${externe.abonnements_autres_vivants} abonnement(s) hors Live Club à arrêter au Dashboard.`)
  }
  if ((externe.abonnements_live_club_impayes ?? 0) > 0) {
    r.push(`Stripe : ${externe.abonnements_live_club_impayes} abonnement(s) Live Club impayé(s) (unpaid) à résilier au Dashboard, l'arrêt de fin de période ne s'y applique pas.`)
  }
  return r
}

/**
 * Longueur maximale de la carte. Sur Telegram, la reponse, le texte a dire a
 * la personne (900 caracteres au plus) et la carte partent dans UN message de
 * 4 096 caracteres : au-dela, Telegram le refuse et la carte n'arrive pas.
 */
export const MAX_CARTE = 2800

/**
 * La carte de confirmation : ce qui sera efface app par app (comptes de
 * l'apercu), ce qui reste, ce qui est fait hors base, l'irreversible. Texte
 * brut, une ligne par app (l'ecran du cockpit et Telegram gardent les
 * retours a la ligne). Bornee a MAX_CARTE : moins de tables citees par app
 * (les autres comptees) plutot qu'une carte coupee.
 */
export function composerCarte(qui: string, a: ApercuEffacement): string {
  let carte = ''
  for (const maxParApp of [7, 4, 2, 1]) {
    carte = composerCarteAvec(qui, a, maxParApp)
    if (carte.length <= MAX_CARTE) return carte
  }
  return carte
}

function composerCarteAvec(qui: string, a: ApercuEffacement, maxParApp: number): string {
  const c = a.cibles
  const cible = [
    c.comptes_telegram ? `${c.comptes_telegram} compte(s) Telegram` : null,
    c.fiches_membres ? `${c.fiches_membres} fiche(s) membre` : null,
    c.comptes_aok ? `${c.comptes_aok} compte(s) AOK` : null,
    c.emails ? `${c.emails} email(s)` : null,
    c.fiches_archive ? `${c.fiches_archive} fiche(s) d'archive` : null,
  ].filter(Boolean).join(', ')
  const l: string[] = [
    `Effacer les données de ${qui}, niveau ${a.niveau} : ${NOMS_NIVEAUX[a.niveau]}${cible ? ` (${cible})` : ''}.`,
    'Effacé, app par app :',
    ...lignesParApp(a.efface, maxParApp),
  ]
  if (a.niveau === 1 || a.niveau === 3) {
    l.push('- Groupes Telegram : plus rien de ce qu\'il écrit ne sera relevé, ni son nom, ni sa fiche d\'archive (listes d\'oubli).')
  }
  const anonymes = anonymiseLignes(a.anonymise)
  if (anonymes.length) l.push('Gardé sans identité :', ...anonymes)
  const e = a.externe
  if (a.niveau === 3) {
    l.push('Hors base, au clic :')
    l.push(`- Stripe : ${e.abonnements_live_club_vivants
      ? `${e.abonnements_live_club_vivants} abonnement(s) Live Club vivant(s) d'après la collecte du matin`
      : 'aucun abonnement Live Club vivant d\'après la collecte du matin'}, relu en direct au clic : arrêt à la fin de la période payée, rien de remboursé.`
      + (e.abonnements_arret_deja_prevu ? ` ${e.abonnements_arret_deja_prevu} a déjà son arrêt programmé.` : ''))
    l.push(`- Telegram : sortie du groupe Live Club sans bannissement${e.comptes_dans_le_groupe ? ` (${e.comptes_dans_le_groupe} compte(s) présent(s))` : ' si un de ses comptes y est'}.`)
  }
  const g = a.garde
  const reste: string[] = []
  if (a.niveau === 3) {
    reste.push(`${g.paiements ?? 0} paiement(s), avec son nom et son email figés avant l'effacement (pièces comptables)`)
    if (g.abonnements) reste.push(`${g.abonnements} abonnement(s), historique sans fiche`)
    if (g.commissions) reste.push(`${g.commissions} commission(s) liée(s) à lui`)
    if (g.academie_lectures) reste.push(`${g.academie_lectures} ligne(s) du journal de lecture de l'académie (preuve, sans compte)`)
    reste.push('ses factures et paiements chez Stripe (Stripe les garde)')
  } else {
    reste.push('il reste membre : abonnement, fiche, compte AOK et Journal ne bougent pas')
  }
  reste.push('ses messages dans les groupes Telegram (c\'est à lui de les supprimer)')
  l.push(`Reste : ${reste.join(' ; ')}.`)
  if (a.alertes.includes('paiements_sans_nom')) {
    l.push("ATTENTION : aucun nom connu pour ses paiements (fiche sans nom, compte AOK sans nom) : seul l'email sera figé, le nom reste chez Stripe.")
  }
  if (a.alertes.includes('plusieurs_fiches') || a.alertes.includes('plusieurs_comptes_aok')) {
    l.push('ATTENTION : plusieurs fiches ou comptes AOK sont réunis par leurs emails : vérifie que c\'est bien la même personne avant de confirmer.')
  }
  const manuel = etapesManuelles(a.niveau, e)
  if (manuel.length) l.push('À faire à la main ensuite :', ...manuel.map((m) => `- ${m}`))
  l.push(a.niveau === 3
    ? 'IRRÉVERSIBLE : rien de ce qui est effacé ne pourra lui être rendu, ni ses notes du Journal, ni son compte AOK.'
    : 'IRRÉVERSIBLE : ce qui est effacé ne pourra pas lui être rendu.')
  return l.join('\n')
}

// ---------------------------------------------------------------------------
// Les textes pour la personne : avant (la prevenir), apres (le recapitulatif)
// ---------------------------------------------------------------------------

/**
 * Ce que l'equipe dit a la personne AVANT de confirmer. Niveau 1 : Brice veut
 * qu'elle sache que ca degrade son suivi. Verifie le 15/10 dans le code : le
 * mentor du Journal d'Etudes (mentorat-brief.ts, /api/mentorat/*) ne lit que
 * ses notes, ses trades, ses jugements et ses imports, JAMAIS ses messages du
 * groupe, ses noms ni l'archive. Le texte le dit tel quel.
 */
export const TEXTES_PREVENIR: Record<Niveau, string> = {
  1: "Avant qu'on le fasse : on efface les messages de toi qu'on a relevés dans les groupes Telegram, l'historique de tes noms "
    + "et ce que notre archive garde de toi, et on ne relèvera plus ce que tu écris. Tu restes membre, ton abonnement ne change pas. "
    + "Ce que ça change pour toi : l'équipe n'aura plus cet historique pour te suivre et te répondre en connaissant ton parcours, "
    + "et les outils reliés à ton compte qui s'en serviraient plus tard ne l'auront pas. Le mentor du Journal d'Études, lui, "
    + "lit tes notes et tes trades, pas tes messages du groupe : il ne change pas. Tes messages restent visibles dans les groupes, "
    + "c'est toi qui peux les supprimer. C'est définitif.",
  2: "Avant qu'on le fasse : on efface l'historique de tes échanges avec le bot du Live Club et avec notre support. "
    + "Tu restes membre, ton abonnement ne change pas. Ce que ça change pour toi : ni le bot ni l'équipe ne sauront plus "
    + "ce que tu as demandé avant, il faudra tout réexpliquer si tu reviens sur un sujet. C'est définitif.",
  3: "Avant qu'on le fasse : ton abonnement s'arrête à la fin de la période déjà payée (rien n'est remboursé, plus rien n'est "
    + "prélevé ensuite), tu sors du groupe Telegram sans être banni, et on supprime ton compte AOK dans toutes nos apps : "
    + "tes notes et ton historique du Journal d'Études (et ce que le mentor en avait tiré), ton accès au site, à la masterclass "
    + "et à l'académie, tes échanges avec nos bots, ce qu'on a relevé de tes messages, et ta fiche chez nous. Si tu tiens à tes "
    + "notes, garde-en une copie avant. On garde seulement tes paiements, avec ton nom et ton email, parce que la loi nous "
    + "oblige à garder nos pièces comptables ; Stripe garde aussi ses propres factures. Tes messages restent visibles dans les "
    + "groupes, c'est toi qui peux les supprimer. C'est définitif : on ne pourra rien te rendre.",
}

/** Le bloc que le serveur ajoute AVANT la carte, pour Brice ou Mel. */
export function texteAvantCarte(niveau: Niveau): string {
  return `À dire à la personne AVANT de confirmer (niveau ${niveau}, ${NOMS_NIVEAUX[niveau]}) :\n« ${TEXTES_PREVENIR[niveau]} »`
}

export type IssueStripe = {
  /** Abonnements dont l'arret vient d'etre programme, avec leur fin de periode (ISO). */
  arretes: { fin: string | null }[]
  dejaPrevus: number
  /** Live Club 'unpaid' : l'arret de fin de periode ne s'y applique pas. */
  impayes: number
}

export type IssueTelegram = { sortis: number; absents: number; refuses: number; echecs: number; comptesEnEchec: number[] }

const jourFr = (iso: string | null | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null
}

/** La fin d'acces la plus tardive parmi les abonnements arretes, au format JJ/MM/AAAA. */
export function finAbonnement(s: IssueStripe | null): string | null {
  const fins = (s?.arretes ?? []).map((a) => a.fin).filter((f): f is string => typeof f === 'string').sort()
  return fins.length ? jourFr(fins[fins.length - 1]) : null
}

/** Le recapitulatif a transmettre a la personne, apres l'execution. Jamais un nom, un email ni un identifiant. */
export function recapitulatifPersonne(niveau: Niveau, o: { stripe?: IssueStripe | null; telegram?: IssueTelegram | null } = {}): string {
  if (niveau === 1) {
    return "C'est fait : on a effacé les messages de toi qu'on avait relevés dans les groupes Telegram, l'historique de tes noms "
      + "et ce que notre archive gardait de toi, et on ne relève plus ce que tu écris. Tu restes membre, rien ne change à ton "
      + "abonnement. Tes messages restent visibles dans les groupes : tu peux les supprimer toi-même dans Telegram."
  }
  if (niveau === 2) {
    return "C'est fait : l'historique de tes échanges avec notre bot et notre support est effacé. Tu restes membre ; "
      + 'si tu nous réécris, la conversation repart de zéro.'
  }
  const fin = finAbonnement(o.stripe ?? null)
  const abonnement = fin
    ? `ton abonnement s'arrête à la fin de la période déjà payée, le ${fin}, et plus rien ne sera prélevé`
    : (o.stripe?.arretes.length ?? 0) > 0 || (o.stripe?.dejaPrevus ?? 0) > 0
      ? "ton abonnement s'arrête à la fin de la période déjà payée, et plus rien ne sera prélevé"
      : null
  const groupe = (o.telegram?.sortis ?? 0) > 0 ? "tu n'es plus dans le groupe Telegram (sans bannissement)" : null
  const faits = [abonnement, groupe, "ton compte AOK et tes notes du Journal d'Études sont supprimés", 'ta fiche chez nous est effacée']
    .filter(Boolean)
  return `C'est fait : ${faits.join(', ')}. On garde seulement tes paiements, avec ton nom et ton email, parce que la loi `
    + 'nous oblige à garder nos pièces comptables ; Stripe garde aussi ses propres factures. Tes messages restent visibles '
    + 'dans les groupes Telegram : tu peux les supprimer toi-même.'
}

/** Ce qui part dans cockpit_effacements.externe : des nombres, jamais un identifiant. */
export function externePourJournal(s: IssueStripe | null, t: IssueTelegram | null): Comptes {
  const r: Comptes = {}
  if (s) {
    r.stripe_arrets = s.arretes.length
    r.stripe_deja_prevus = s.dejaPrevus
    r.stripe_impayes = s.impayes
  }
  if (t) {
    r.telegram_sortis = t.sortis
    r.telegram_absents = t.absents
    r.telegram_refuses = t.refuses
    r.telegram_echecs = t.echecs
  }
  return r
}

/**
 * Le resultat rendu a Brice ou Mel apres le clic : ce qui a ete fait, ce qui
 * reste, ce qu'il reste a faire a la main, et le recapitulatif a transmettre.
 */
export function phraseResultat(
  r: ResultatEffacement,
  o: { stripe?: IssueStripe | null; telegram?: IssueTelegram | null; externe?: Comptes } = {},
): string {
  const l: string[] = [`Effacement de niveau ${r.niveau} fait (${NOMS_NIVEAUX[r.niveau]}), journalisé sans nom ni email.`]
  const efface = lignesParApp(r.efface, 5)
  l.push(efface.length ? 'Effacé :' : 'Effacé : rien en base à ce niveau.', ...efface)
  const anonymes = anonymiseLignes(r.anonymise)
  if (anonymes.length) l.push('Gardé sans identité :', ...anonymes)
  if (r.niveau === 3) {
    l.push(`Gardé : ${r.garde.paiements ?? 0} paiement(s) avec son nom et son email (${r.garde.paiements_figes ?? 0} figé(s) à l'instant), `
      + `${r.garde.abonnements ?? 0} abonnement(s) en historique, ses factures chez Stripe.`)
    const s = o.stripe
    if (s) {
      const fin = finAbonnement(s)
      l.push(`Stripe : ${s.arretes.length} arrêt(s) programmé(s) à la fin de la période payée${fin ? ` (accès jusqu'au ${fin})` : ''}`
        + `${s.dejaPrevus ? `, ${s.dejaPrevus} déjà programmé(s)` : ''}.`)
    }
    const t = o.telegram
    if (t) {
      l.push(`Telegram : ${t.sortis} compte(s) sorti(s) du groupe sans bannissement`
        + `${t.absents ? `, ${t.absents} déjà absent(s)` : ''}${t.refuses ? `, ${t.refuses} refusé(s) (admin du groupe)` : ''}.`)
    }
    // Les impayes lus en direct chez Stripe remplacent ceux de la collecte du matin.
    const manuel = etapesManuelles(3, s ? { ...(o.externe ?? {}), abonnements_live_club_impayes: 0 } : (o.externe ?? {}))
    if (s?.impayes) manuel.push(`Stripe : ${s.impayes} abonnement(s) Live Club impayé(s) à résilier au Dashboard.`)
    if (t && t.echecs > 0) {
      manuel.push(`Telegram : la sortie a échoué pour ${t.comptesEnEchec.map((x) => `u${x}`).join(', ')} : `
        + 'le retirer à la main (proposer_retirer_telegram), ses données sont déjà effacées.')
    }
    if (manuel.length) l.push('À faire à la main :', ...[...new Set(manuel)].map((m) => `- ${m}`))
  }
  l.push(`À transmettre à la personne :\n« ${recapitulatifPersonne(r.niveau, o)} »`)
  return l.join('\n')
}

// ---------------------------------------------------------------------------
// Le bot des membres : jamais de proposition d'effacement
// ---------------------------------------------------------------------------

const NIVEAUX_LISTES = [
  /niveau\s*[123]\b/,
  /ne plus (?:etre|être) suivi/,
  /(?:trois|3)\s+(?:niveaux|options|possibilites|possibilités|choix)/,
  /partir et tout effacer/,
]
const OFFRES = /(?:tu peux|vous pouvez|tu as le droit|vous avez le droit|je peux|on peut|veux-tu|voulez-vous|souhaites-tu|souhaitez-vous|si tu veux|si vous voulez)[^.?!\n]{0,60}(?:effac|supprim|oubli)/
const FAIT = /(?:j'ai|on a|c'est|nous avons)[^.?!\n]{0,30}(?:effacé|supprimé|oublié)/

/**
 * Un texte du bot (constante, ou reponse) qui PROPOSE l'effacement, en liste
 * les niveaux, ou dit qu'il est fait : la regle de Brice (15/10) l'interdit.
 * La transmission neutre a l'equipe passe.
 */
export function proposeEffacement(texte: string): boolean {
  const t = texte.toLowerCase().replace(/[’]/g, "'")
  return NIVEAUX_LISTES.some((r) => r.test(t)) || OFFRES.test(t) || FAIT.test(t)
}
