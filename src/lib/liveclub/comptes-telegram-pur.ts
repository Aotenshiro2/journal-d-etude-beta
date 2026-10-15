// PLUSIEURS COMPTES TELEGRAM POUR UNE MEME PERSONNE (Brice, 15/10/2026) :
// regles PURES, aucune base, aucun reseau, aucun import. scripts/verifier-liveclub.mjs
// les charge telles quelles.
//
// LE CAS REEL (14/10) : un abonnement relie par la page de bienvenue au compte
// Telegram A, entre dans le groupe ; deux minutes plus tard, un compte B
// verifie la MEME adresse par le code email. Le bot refusait (« deja relie a
// un autre compte Telegram ») et renvoyait vers support@. Sans doute la meme
// personne avec deux comptes.
//
// LES REGLES DE BRICE (15/10) :
// - comme un compte AOK peut avoir plusieurs emails, une personne peut avoir
//   plusieurs comptes Telegram, mais UN SEUL a le droit d'etre dans le Live
//   Club a la fois ;
// - B, qui a PROUVE l'adresse (code email), choisit : « Utiliser ce compte-ci »
//   (le lien actif passe a B, celui de A est retire avec sa raison, A sort du
//   groupe sans ban) ou « Ce n'est pas moi » (rien ne change, le fil passe en
//   attente d'un humain, ALERTE a Brice et Mel) ;
// - garde-fou : plus d'un changement de compte en 30 jours pour un meme
//   abonnement = pas de libre-service, transmis a l'equipe avec une alerte ;
// - jamais de renvoi vers support@ pour ce que l'equipe peut traiter : seule
//   une panne du pont vers l'equipe le donne (bot-membre.ts, repondeur).

/** La fenetre du garde-fou, en jours. */
export const JOURS_GARDE_CHANGEMENT = 30
/**
 * Changements deja faits par le bot dans la fenetre a partir desquels le
 * libre-service se ferme : un deja fait, le suivant passe par l'equipe.
 */
export const MAX_CHANGEMENTS_LIBRE_SERVICE = 1
/** Duree de validite des deux boutons du choix. */
export const VALIDITE_CHOIX_MINUTES = 30
/** cockpit_liveclub_rattachements.retire_raison d'un lien retire par un changement de compte. */
export const RAISON_CHANGEMENT_COMPTE = 'changement_compte'

export const LIBELLE_UTILISER = 'Utiliser ce compte-ci'
export const LIBELLE_PAS_MOI = "Ce n'est pas moi"

// ---------------------------------------------------------------------------
// Les decisions
// ---------------------------------------------------------------------------

export type DecisionCompte = 'libre_service' | 'garde' | 'panne' | 'aucun'

/**
 * Ce que le bot fait quand un compte B vient de prouver une adresse dont
 * l'abonnement est deja relie a un ou plusieurs autres comptes actifs.
 * `changementsRecents` : changements de compte deja faits par le bot pour ce
 * payeur dans les 30 derniers jours, null s'il n'a pas pu etre lu (panne, ou
 * migration 20261015230000 pas appliquee) : jamais de libre-service a
 * l'aveugle.
 */
export function decisionChangementCompte(e: { autres: number; changementsRecents: number | null }): DecisionCompte {
  if (!(e.autres > 0)) return 'aucun'
  if (e.changementsRecents === null || !Number.isFinite(e.changementsRecents)) return 'panne'
  return e.changementsRecents >= MAX_CHANGEMENTS_LIBRE_SERVICE ? 'garde' : 'libre_service'
}

export type ChoixCompte = 'utiliser' | 'pas_moi'
export type IssueChoix = 'changer' | 'conflit' | 'garde' | 'panne'

/**
 * Apres le bouton. « Ce n'est pas moi » : conflit, toujours, sans rien lire
 * (rien ne change). « Utiliser ce compte-ci » : la garde est RELUE au moment
 * du geste (un autre changement a pu passer entre-temps).
 */
export function decisionApresChoix(e: { choix: ChoixCompte; changementsRecents: number | null }): IssueChoix {
  if (e.choix === 'pas_moi') return 'conflit'
  if (e.changementsRecents === null || !Number.isFinite(e.changementsRecents)) return 'panne'
  return e.changementsRecents >= MAX_CHANGEMENTS_LIBRE_SERVICE ? 'garde' : 'changer'
}

// ---------------------------------------------------------------------------
// Les boutons, et le choix en attente (cockpit_liveclub_conversations)
// ---------------------------------------------------------------------------

const NONCE = /^[A-Za-z0-9_-]{8,32}$/

/** Les deux boutons du choix (callback_data courts : « k: » + nonce, « n: » + nonce). */
export function boutonsChoixCompte(nonce: string): { texte: string; data: string }[][] {
  return [
    [{ texte: LIBELLE_UTILISER, data: `k:${nonce}` }],
    [{ texte: LIBELLE_PAS_MOI, data: `n:${nonce}` }],
  ]
}

/** Le bouton appuye, ou null si ce n'est pas un bouton du choix. */
export function lireBoutonChoixCompte(data: string): { choix: ChoixCompte; nonce: string } | null {
  const m = /^([kn]):(.+)$/.exec(data)
  if (!m || !NONCE.test(m[2])) return null
  return { choix: m[1] === 'k' ? 'utiliser' : 'pas_moi', nonce: m[2] }
}

/**
 * Le choix pose en attente pour le compte B : l'adresse qu'il vient de
 * prouver et les comptes qui tenaient l'abonnement a ce moment. Pose par le
 * serveur, jamais par un texte.
 */
export type ChoixCompteEnAttente = { type: 'changer_compte'; email: string; anciens: number[]; expire: string }

export function estChoixCompteEnAttente(x: unknown): x is ChoixCompteEnAttente {
  const c = x as ChoixCompteEnAttente
  return Boolean(c && c.type === 'changer_compte' && typeof c.email === 'string' && c.email.includes('@')
    && Array.isArray(c.anciens) && c.anciens.every(a => Number.isSafeInteger(a) && a > 0)
    && typeof c.expire === 'string')
}

export function nouveauChoixCompte(email: string, anciens: readonly number[], maintenantMs: number): ChoixCompteEnAttente {
  return {
    type: 'changer_compte',
    email,
    anciens: [...new Set(anciens.filter(a => Number.isSafeInteger(a) && a > 0))].slice(0, 10),
    expire: new Date(maintenantMs + VALIDITE_CHOIX_MINUTES * 60_000).toISOString(),
  }
}

export function choixExpire(c: ChoixCompteEnAttente, maintenantMs: number): boolean {
  const t = Date.parse(c.expire)
  return !Number.isFinite(t) || t < maintenantMs
}

// ---------------------------------------------------------------------------
// Les comptes : ce qu'on en dit
// ---------------------------------------------------------------------------

/** Un compte Telegram tel qu'on le nomme (pseudo sans arobase). */
export type CompteTelegramLu = { telegramId: number; pseudo: string | null; nom: string | null }

// Caracteres de controle et invisibles, construits par leur code pour qu'aucun
// ne figure en clair dans ce fichier (meme liste que resume-pur.ts).
const INVISIBLES = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g')

/** Un texte tape par un tiers (nom, pseudo) : une ligne, sans controle, `max` caracteres au plus. */
export function nomSur(brut: unknown, max = 40): string | null {
  if (typeof brut !== 'string') return null
  const s = brut.replace(INVISIBLES, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s
}

function pseudoSur(brut: unknown): string | null {
  const p = nomSur(typeof brut === 'string' ? brut.replace(/^@+/, '') : null, 40)
  return p && /^[A-Za-z0-9_]{3,40}$/.test(p) ? p : null
}

/**
 * Ce que le compte B lit de l'autre compte : « @pseudo », sinon son nom
 * Telegram, sinon rien (null). Plusieurs comptes : separes par une virgule.
 * Jamais l'identifiant numerique, jamais un email.
 */
export function libellePourMembre(comptes: readonly CompteTelegramLu[]): string | null {
  const morceaux = comptes.map(c => {
    const p = pseudoSur(c.pseudo)
    return p ? `@${p}` : nomSur(c.nom)
  }).filter((x): x is string => Boolean(x))
  return morceaux.length ? [...new Set(morceaux)].join(', ') : null
}

/** Ce que l'equipe lit d'un compte : « @pseudo (Nom), u123 », ce qu'on en a. */
export function libellePourEquipe(c: CompteTelegramLu): string {
  const p = pseudoSur(c.pseudo)
  const n = nomSur(c.nom)
  const qui = p && n ? `@${p} (${n})` : p ? `@${p}` : n
  return qui ? `${qui}, u${c.telegramId}` : `u${c.telegramId}`
}

/** Un compte en une piece, pour une ligne du resume : « @pseudo (u123) », « Nom (u123) » ou « u123 ». */
export function libelleCourt(c: CompteTelegramLu): string {
  const p = pseudoSur(c.pseudo)
  const qui = p ? `@${p}` : nomSur(c.nom)
  return qui ? `${qui} (u${c.telegramId})` : `u${c.telegramId}`
}

/** Le payeur pour l'equipe : « Nom, email », ce qu'on en a. */
export function libellePayeur(p: { nom: string | null; email: string | null }): string {
  const morceaux = [nomSur(p.nom, 60), nomSur(p.email, 120)].filter((x): x is string => Boolean(x))
  return morceaux.length ? morceaux.join(', ') : 'payeur non identifié'
}

// ---------------------------------------------------------------------------
// Les textes du bot des membres (sans aucune adresse email)
// ---------------------------------------------------------------------------

function autreCompte(libelle: string | null, plusieurs: boolean): string {
  const quoi = plusieurs ? "d'autres comptes Telegram" : 'un autre compte Telegram'
  return libelle ? `${quoi} (${libelle})` : quoi
}

/** Le choix propose au compte B, avec les deux boutons (boutonsChoixCompte). */
export function texteChoixCompte(libelle: string | null, plusieurs = false): string {
  const lui = plusieurs ? 'ces comptes sont aussi à toi' : 'ce compte est aussi à toi'
  const pasLui = plusieurs ? "ces comptes ne sont pas à toi" : "ce compte n'est pas à toi"
  return `C'est bon, ton email est vérifié.\n\n`
    + `Ton abonnement est déjà utilisé par ${autreCompte(libelle, plusieurs)}. Un seul compte peut être dans le Live Club.\n\n`
    + `- Si ${lui} et que tu veux passer sur celui-ci : appuie sur « ${LIBELLE_UTILISER} ». L'autre compte sortira du groupe.\n`
    + `- Si ${pasLui} : appuie sur « ${LIBELLE_PAS_MOI} ». Je ne change rien et je préviens l'équipe.`
}

/** Le meme choix, redonne quand B ecrit au lieu d'appuyer. */
export function texteRappelChoix(libelle: string | null, plusieurs = false): string {
  return `Avant tout, choisis avec les boutons ci-dessous.\n\n${texteChoixCompte(libelle, plusieurs)}`
}

/** Garde-fou atteint : pas de libre-service, l'equipe est prevenue (fil en attente d'un humain). */
export function texteGardeCompte(libelle: string | null, plusieurs = false): string {
  return `C'est bon, ton email est vérifié.\n\n`
    + `Ton abonnement est déjà utilisé par ${autreCompte(libelle, plusieurs)}, et il a déjà changé de compte Telegram il y a moins de ${JOURS_GARDE_CHANGEMENT} jours. `
    + `Par sécurité, ce nouveau changement passe par l'équipe : je la préviens, elle te répond ici, dans cette conversation.`
}

/** Le bot ne peut pas faire le changement (lecture ou ecriture en panne) : l'equipe est prevenue. */
export function textePanneCompte(libelle: string | null, plusieurs = false): string {
  return `C'est bon, ton email est vérifié.\n\n`
    + `Ton abonnement est déjà utilisé par ${autreCompte(libelle, plusieurs)}. Je n'arrive pas à faire le changement moi-même là, tout de suite : `
    + `je préviens l'équipe, elle s'en occupe et te répond ici, dans cette conversation.`
}

export const DEBUT_PAS_MOI = `D'accord, je ne change rien.`

/** « Ce n'est pas moi » : rien ne change, l'equipe est prevenue. */
export const TEXTE_PAS_MOI = `${DEBUT_PAS_MOI} Je préviens l'équipe : elle vérifie avec les deux comptes et te répond ici, dans cette conversation.`

/** En tete du message de B apres le changement (suivi du lien vers le groupe s'il le faut). */
export const TEXTE_CHANGEMENT_FAIT = `C'est fait : ton abonnement est maintenant relié à ce compte-ci, et l'autre compte n'y a plus accès.`

/** Un bouton du choix vieux de plus de 30 minutes, ou deja utilise. */
export const TEXTE_CHOIX_PERIME = `Ce bouton ne marche plus (déjà utilisé, ou trop ancien), et rien n'a changé.\n\n`
  + `Pour recommencer, renvoie-moi ici l'email de ton paiement : je t'envoie un nouveau code.`

/**
 * Le message court a l'ancien compte A (s'il a deja demarre le bot). `sorti` :
 * il vient de sortir du groupe. Le bouton « Contacter l'equipe » l'accompagne.
 */
export function texteAncienCompte(sorti: boolean): string {
  return `Ton abonnement Live Club est maintenant relié à un autre compte Telegram, à la demande de son titulaire (email du paiement vérifié par code). `
    + `Un seul compte peut être dans le Live Club${sorti ? ' : celui-ci sort donc du groupe, sans blocage' : ''}.\n\n`
    + `Ce n'est pas toi qui l'as demandé ? Appuie sur « Contacter l'équipe » : elle te répond ici.`
}

// ---------------------------------------------------------------------------
// Les alertes a Brice et Mel (Agent AOK, en prive)
// ---------------------------------------------------------------------------

/** Ce qui est arrive a l'ancien compte apres un changement. */
export type SortieAncien = 'sorti' | 'absent' | 'autre_droit' | 'inconnu' | 'echec' | 'admin'

const PHRASES_SORTIE: Record<SortieAncien, string> = {
  sorti: 'sorti du groupe, sans blocage',
  absent: "n'était pas dans le groupe",
  autre_droit: 'garde le groupe : il a un autre droit ouvert (exemption, accès broker ou manuel)',
  inconnu: "PAS sorti du groupe : son droit n'a pas pu être lu, à vérifier",
  echec: 'PAS sorti du groupe : Telegram a refusé, à vérifier',
  admin: "administrateur du groupe, pas sorti",
}

export type PayeurAlerte = { nom: string | null; email: string | null }

export type AlerteCompte =
  | {
    genre: 'libre_service'
    payeur: PayeurAlerte
    anciens: readonly CompteTelegramLu[]
    nouveau: CompteTelegramLu
    /** Par compte Telegram (cle = id en texte). */
    sorties: Readonly<Record<string, SortieAncien>>
  }
  | {
    genre: 'conflit'
    raison: 'pas_moi' | 'garde_30j'
    payeur: PayeurAlerte
    anciens: readonly CompteTelegramLu[]
    nouveau: CompteTelegramLu
  }
  | {
    genre: 'panne'
    payeur: PayeurAlerte
    anciens: readonly CompteTelegramLu[]
    nouveau: CompteTelegramLu
  }

function listeComptes(c: readonly CompteTelegramLu[]): string {
  return c.length ? c.map(libellePourEquipe).join(' et ') : 'un autre compte Telegram'
}

/** Le texte de l'alerte (texte brut, sans mise en forme : Agent AOK l'envoie tel quel). */
export function texteAlerteCompte(a: AlerteCompte): string {
  const payeur = libellePayeur(a.payeur)
  const nouveau = libellePourEquipe(a.nouveau)
  if (a.genre === 'libre_service') {
    const anciens = a.anciens.length
      ? a.anciens.map(c => `Ancien compte : ${libellePourEquipe(c)}, ${PHRASES_SORTIE[a.sorties[String(c.telegramId)] ?? 'inconnu']}`)
      : ['Ancien compte : inconnu']
    return [
      'Changement de compte Telegram fait en libre-service (bot des membres du Live Club).',
      '',
      `Abonnement de : ${payeur}`,
      ...anciens,
      `Nouveau compte : ${nouveau}`,
      '',
      `Preuve : le nouveau compte a tapé le code envoyé à l'adresse du paiement, puis choisi « ${LIBELLE_UTILISER} ».`,
    ].join('\n')
  }
  if (a.genre === 'conflit') {
    const raison = a.raison === 'pas_moi'
      ? `Le second compte a tapé le code envoyé à l'adresse du paiement, puis répondu « ${LIBELLE_PAS_MOI} » : l'autre compte n'est pas à lui.`
      : `Le second compte a tapé le code envoyé à l'adresse du paiement, mais cet abonnement a déjà changé de compte Telegram il y a moins de ${JOURS_GARDE_CHANGEMENT} jours : pas de libre-service.`
    return [
      `Conflit de compte Telegram à vérifier : l'abonnement de ${payeur} est utilisé par ${listeComptes(a.anciens)} ; ${nouveau} dit être le titulaire. Contactez les deux comptes.`,
      '',
      raison,
      "Rien n'a été changé. Son fil Support (onglet Support du cockpit) attend une réponse de l'équipe.",
    ].join('\n')
  }
  return [
    `Changement de compte Telegram à faire à la main : l'abonnement de ${payeur} est utilisé par ${listeComptes(a.anciens)} ; ${nouveau} a vérifié l'adresse par code et veut l'utiliser.`,
    '',
    "Le bot n'a pas pu faire le changement (lecture ou écriture en panne). Rien n'a été changé. Son fil Support (onglet Support du cockpit) attend une réponse de l'équipe.",
  ].join('\n')
}

/**
 * La ligne qui precede l'alerte dans l'historique de la conversation avec
 * Agent AOK (meme raison que MARQUEUR_RESUME_HISTORIQUE, resume-pur.ts : une
 * question posee juste en dessous s'y rapporte).
 */
export const MARQUEUR_ALERTE_HISTORIQUE = "[système] Alerte du bot des membres du Live Club, envoyée automatiquement par Agent AOK (ce n'est pas une question de l'équipe)."

export function entreesHistoriqueAlerte(texte: string, id: string): { role: 'user' | 'assistant'; content: string; id: string }[] {
  return [
    { role: 'user', content: MARQUEUR_ALERTE_HISTORIQUE, id },
    { role: 'assistant', content: texte, id: `${id}-texte` },
  ]
}

// ---------------------------------------------------------------------------
// Le journal du bot (geste compte_telegram) et le resume du matin
// ---------------------------------------------------------------------------

/** Les ids Telegram (en texte dans le journal) d'un champ de details. */
export function idsDuDetail(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v.map(x => Number(x)).filter(x => Number.isSafeInteger(x) && x > 0)
}

/**
 * La phrase du resume du matin pour un geste compte_telegram, en minuscule et
 * sans point final (elle suit le nom de la personne). `libelle` nomme un
 * compte Telegram par son id (resolu par l'appelant).
 */
export function phraseCompteResume(
  g: { resultat: string; regle: string | null; details?: Record<string, unknown> | null; telegram_id: number | null },
  libelle: (telegramId: number) => string,
): string {
  const d = g.details ?? {}
  const anciens = idsDuDetail(d.anciens)
  const de = anciens.length ? anciens.map(libelle).join(' et ') : 'un autre compte'
  const vers = g.telegram_id ? libelle(g.telegram_id) : 'un autre compte'
  if (g.resultat === 'fait') {
    const sorties = (d.sorties && typeof d.sorties === 'object' ? d.sorties : {}) as Record<string, unknown>
    const pasSortis = anciens.filter(a => ['inconnu', 'echec'].includes(String(sorties[String(a)] ?? '')))
    return `compte Telegram changé en libre-service, de ${de} à ${vers}`
      + (pasSortis.length ? ` (${pasSortis.map(libelle).join(' et ')} pas sorti du groupe, à vérifier)` : '')
  }
  if (g.resultat === 'refuse') {
    if (g.regle === 'garde_30j') return `${vers} demande l'abonnement utilisé par ${de}, deuxième changement de compte en moins de ${JOURS_GARDE_CHANGEMENT} jours : transmis à l'équipe, à vérifier`
    return `conflit à vérifier : ${vers} dit être le titulaire, l'abonnement est utilisé par ${de}`
  }
  return `changement de compte Telegram de ${de} à ${vers} en panne : à faire à la main`
}
