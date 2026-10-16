// Regles PURES de la reponse a un membre depuis l'agent du cockpit (outil
// proposer_reponse_membre, Brice 16/10/2026) : lecture des parametres,
// designation du fil, choix du fil, carte de confirmation, phrase du resultat.
// Aucun import : teste par scripts/verifier-reponse-membre.mjs.
// Serveur : reponse-membre.ts. Envoi : support-reponse.ts (le meme que
// l'onglet Support du cockpit).

/** Texte d'une reponse proposee par l'agent : la carte doit tenir dans un message Telegram (4 096). */
export const MAX_TEXTE_REPONSE = 3000
export const MAX_FIL = 120

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type CanalReponse = 'telegram' | 'site'

export type ParamsReponseMembre = {
  /** Ce que le modele a donne : reference « fil 1a2b3c4d », identifiant du fil, ou une personne. */
  fil: string
  /** Le texte qui partira, mot pour mot (espaces de debut et de fin retires, rien d'autre). */
  texte: string
  /** (16/10) Joindre la piece recue dans Agent AOK (demande du modele, la piece vient du serveur). */
  piece_jointe?: boolean
  // Poses par le controle avant la carte, qui les ECRASE toujours : jamais
  // pris au modele. Relus a l'execution (fil_id est obligatoire au clic).
  fil_id?: string
  qui?: string
  reference?: string
  canal?: CanalReponse
  app?: string
  /** (16/10) La piece a envoyer : sa reference Telegram et le bot qui l'a recue (support-pont-pur.ts, PieceAgent). */
  piece?: PieceParam
}

/** La piece d'une carte, telle que le controle la pose (meme forme que PieceAgent, relue strictement). */
export type PieceParam = {
  bot: 'cockpit' | 'liveclub'
  file_id: string
  file_unique_id: string | null
  type: 'photo' | 'document'
  mime: string | null
  nom: string | null
  taille: number | null
}

function lirePieceParam(x: unknown): PieceParam | null {
  if (!x || typeof x !== 'object') return null
  const p = x as Record<string, unknown>
  if (p.bot !== 'cockpit' && p.bot !== 'liveclub') return null
  if (typeof p.file_id !== 'string' || !p.file_id || p.file_id.length > 300) return null
  if (p.type !== 'photo' && p.type !== 'document') return null
  const texte = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : null)
  return {
    bot: p.bot, file_id: p.file_id, file_unique_id: texte(p.file_unique_id, 100), type: p.type,
    mime: texte(p.mime, 120), nom: texte(p.nom, 120),
    taille: typeof p.taille === 'number' && Number.isFinite(p.taille) && p.taille >= 0 ? p.taille : null,
  }
}

/** Lecture stricte des parametres (a la proposition, puis au clic). Une chaine = refus. */
export function lireParamsReponseMembre(p: Record<string, unknown>): ParamsReponseMembre | string {
  const fil = typeof p.fil === 'string' ? p.fil.replace(/\s+/g, ' ').trim() : ''
  if (!fil) {
    return "fil manquant : la référence citée en fin d'alerte (« fil 1a2b3c4d »), l'identifiant du fil, "
      + 'ou la personne (nom, @pseudo, numéro u..., email).'
  }
  if (fil.length > MAX_FIL) return `fil trop long (${MAX_FIL} caractères au plus).`
  if (p.piece_jointe != null && typeof p.piece_jointe !== 'boolean') return 'piece_jointe : vrai ou faux.'
  const piece = p.piece == null ? null : lirePieceParam(p.piece)
  if (p.piece != null && !piece) return 'Pièce jointe illisible.'
  const avecPiece = p.piece_jointe === true || piece !== null
  if (p.texte != null && typeof p.texte !== 'string') return 'texte : une chaîne.'
  if (p.texte == null && !avecPiece) return 'texte manquant : le message qui partira, mot pour mot.'
  const texte = typeof p.texte === 'string' ? p.texte.trim() : ''
  // Avec une piece jointe, le texte (la legende) peut etre vide.
  if (!texte && !avecPiece) return 'texte vide : rien à envoyer.'
  if (texte.length > MAX_TEXTE_REPONSE) {
    return `texte trop long (${texte.length} caractères, ${MAX_TEXTE_REPONSE} au plus) : propose de le couper en deux réponses.`
  }
  const r: ParamsReponseMembre = { fil, texte }
  if (p.piece_jointe === true) r.piece_jointe = true
  if (piece) r.piece = piece
  if (p.fil_id != null) {
    const id = String(p.fil_id).trim().toLowerCase()
    if (!UUID.test(id)) return 'fil_id invalide.'
    r.fil_id = id
  }
  if (typeof p.qui === 'string' && p.qui.trim()) r.qui = p.qui.trim().slice(0, 200)
  if (typeof p.reference === 'string' && /^fil [0-9a-f]{8}$/.test(p.reference)) r.reference = p.reference
  if (p.canal === 'telegram' || p.canal === 'site') r.canal = p.canal
  if (typeof p.app === 'string' && p.app.trim()) r.app = p.app.trim().slice(0, 40)
  return r
}

// ---------------------------------------------------------------------------
// Designer le fil
// ---------------------------------------------------------------------------

export type CibleFil =
  | { genre: 'id'; id: string }
  | { genre: 'prefixe'; prefixe: string }
  | { genre: 'personne'; qui: string }

/**
 * Ce que designe `fil` : l'identifiant complet d'un fil (uuid, nu ou precede
 * de « fil »), la reference courte d'une alerte (« fil 1a2b3c4d » : le mot
 * fil, ou #, est obligatoire devant les 8 caracteres, sinon un numero
 * Telegram de 8 chiffres serait pris pour un fil), ou une personne (nom,
 * @pseudo, u..., email, identifiant rendu par fiche_personne).
 */
export function lireFil(fil: string): CibleFil {
  const t = fil.replace(/\s+/g, ' ').trim().replace(/^[(«"'\s]+|[)»"'.\s]+$/g, '')
  const m = /^((?:fil|#)\s*[:#-]?\s*)?([0-9a-f]{8})(-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i.exec(t)
  if (m) {
    if (m[3]) return { genre: 'id', id: `${m[2]}${m[3]}`.toLowerCase() }
    if (m[1]) return { genre: 'prefixe', prefixe: m[2].toLowerCase() }
  }
  return { genre: 'personne', qui: t }
}

// ---------------------------------------------------------------------------
// Choisir le fil
// ---------------------------------------------------------------------------

export type FilCandidat = {
  id: string
  /** « fil 1a2b3c4d » (referenceFil, alerte-equipe-telegram-pur.ts). */
  reference: string
  app: string
  telegramId: number | null
  /** La fiche membre portee par le fil (fils Telegram), pour le rattacher a une personne. */
  membreId: string | null
  nom: string | null
  pseudo: string | null
  email: string | null
  /** 'YYYY-MM-DD HH:MI' a l'heure de Paris ; null = n'attend pas d'humain. */
  attendLe: string | null
  /** Pour comparer : millisecondes, null = n'attend pas. */
  attendT: number | null
  /** Dernier echange, 'YYYY-MM-DD HH:MI' a l'heure de Paris. */
  majLe: string
  majT: number
}

export type ChoixFil =
  | { statut: 'aucun' }
  | { statut: 'un'; fil: FilCandidat; pourquoi: 'seul' | 'attente' | 'recent'; total: number }
  | { statut: 'plusieurs'; fils: FilCandidat[]; pourquoi: 'attente' | 'egalite' | 'reference' | 'personnes' }

function dedoublonner(fils: FilCandidat[]): FilCandidat[] {
  const vus = new Set<string>()
  return fils.filter((f) => (vus.has(f.id) ? false : (vus.add(f.id), true)))
}

/** Ceux qui attendent un humain d'abord (la demande la plus recente en tete), puis le dernier echange. */
export function trierFils(fils: FilCandidat[]): FilCandidat[] {
  return [...fils].sort((a, b) =>
    Number(b.attendT !== null) - Number(a.attendT !== null)
    || (b.attendT ?? 0) - (a.attendT ?? 0)
    || b.majT - a.majT
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Le fil d'UNE personne (Brice, 16/10) : celui qui attend un humain d'abord,
 * sinon le plus recent. Deux fils en attente, ou deux fils au meme instant :
 * on ne choisit pas, l'agent demande.
 */
export function choisirFil(fils: FilCandidat[]): ChoixFil {
  const uniques = dedoublonner(fils)
  if (uniques.length === 0) return { statut: 'aucun' }
  if (uniques.length === 1) return { statut: 'un', fil: uniques[0], pourquoi: 'seul', total: 1 }
  const attente = uniques.filter((f) => f.attendLe !== null)
  if (attente.length === 1) return { statut: 'un', fil: attente[0], pourquoi: 'attente', total: uniques.length }
  if (attente.length > 1) return { statut: 'plusieurs', fils: trierFils(attente), pourquoi: 'attente' }
  const tries = trierFils(uniques)
  if (tries[0].majT === tries[1].majT) {
    return { statut: 'plusieurs', fils: tries.filter((f) => f.majT === tries[0].majT), pourquoi: 'egalite' }
  }
  return { statut: 'un', fil: tries[0], pourquoi: 'recent', total: uniques.length }
}

/** Une personne trouvee : ses comptes Telegram, ses fiches membres, ses emails. */
export type PersonneFils = { telegram: number[]; membres: string[]; emails: string[] }

/**
 * Les fils lus, repartis par personne : un fil est a elle s'il porte un de
 * ses comptes Telegram, une de ses fiches, ou un de ses emails (compte AOK du
 * site, ou email donne au bot). Un fil peut aller a deux personnes.
 */
export function repartirFilsParPersonne(fils: FilCandidat[], personnes: PersonneFils[]): FilCandidat[][] {
  return personnes.map((g) => {
    const tg = new Set(g.telegram)
    const mb = new Set(g.membres.map((x) => x.toLowerCase()))
    const em = new Set(g.emails.map((x) => x.trim().toLowerCase()))
    return fils.filter((f) => (f.telegramId !== null && tg.has(f.telegramId))
      || (f.membreId !== null && mb.has(f.membreId.toLowerCase()))
      || (f.email !== null && em.has(f.email.trim().toLowerCase())))
  })
}

/**
 * Les fils de PLUSIEURS personnes trouvees par un nom (une liste par
 * personne). Seules comptent celles qui ont un fil Support ; deux personnes
 * qui ont exactement les memes fils n'en font qu'une. Une seule : son fil
 * (choisirFil). Plusieurs : on ne choisit jamais, l'agent demande.
 */
export function choisirFilParPersonne(personnes: FilCandidat[][]): ChoixFil {
  const distinctes = new Map<string, FilCandidat[]>()
  for (const l of personnes) {
    const u = dedoublonner(l)
    if (u.length) distinctes.set(u.map((f) => f.id).sort().join('|'), u)
  }
  if (distinctes.size === 0) return { statut: 'aucun' }
  const listes = [...distinctes.values()]
  if (listes.length > 1) return { statut: 'plusieurs', fils: trierFils(dedoublonner(listes.flat())), pourquoi: 'personnes' }
  return choisirFil(listes[0])
}

/** Une reference courte partagee par plusieurs fils (prefixe) : jamais de choix. */
export function choisirFilParReference(fils: FilCandidat[]): ChoixFil {
  const uniques = dedoublonner(fils)
  if (uniques.length === 0) return { statut: 'aucun' }
  if (uniques.length === 1) return { statut: 'un', fil: uniques[0], pourquoi: 'seul', total: 1 }
  return { statut: 'plusieurs', fils: trierFils(uniques), pourquoi: 'reference' }
}

// ---------------------------------------------------------------------------
// Ecrire : destinataire, ambiguite, carte, resultat
// ---------------------------------------------------------------------------

/** '2026-10-16 10:31' -> '16/10/2026 à 10:31'. */
export function dateFr(s: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/.exec(String(s ?? ''))
  if (!m) return String(s ?? '?')
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` à ${m[4]}:${m[5]}` : ''}`
}

/** « Jean Dufour (@wrdxr2d2, jean@exemple.fr) », ou « compte Telegram u123 » sans nom connu. */
export function libelleDestinataire(f: Pick<FilCandidat, 'nom' | 'pseudo' | 'email' | 'telegramId'>): string {
  const nom = f.nom?.trim() || null
  const pseudo = f.pseudo?.trim() ? `@${f.pseudo.trim().replace(/^@+/, '')}` : null
  const morceaux = [nom, pseudo, f.email?.trim() || null].filter((x): x is string => Boolean(x))
  if (!nom && !pseudo && f.telegramId) morceaux.splice(0, 0, `compte Telegram u${f.telegramId}`)
  if (morceaux.length === 0) return 'membre sans nom ni email connus'
  return morceaux.length > 1 ? `${morceaux[0]} (${morceaux.slice(1).join(', ')})` : morceaux[0]
}

const POURQUOI_PLUSIEURS: Record<Extract<ChoixFil, { statut: 'plusieurs' }>['pourquoi'], string> = {
  attente: 'Plusieurs fils de cette personne attendent un humain.',
  egalite: 'Plusieurs fils de cette personne ont bougé au même instant.',
  reference: 'Cette référence courte désigne plusieurs fils.',
  personnes: 'Plusieurs personnes correspondent, chacune avec un fil Support.',
}

/** La reponse rendue au modele quand il faut demander : JSON, une ligne par fil. */
export function reponsePlusieursFils(choix: Extract<ChoixFil, { statut: 'plusieurs' }>, max = 10): string {
  return JSON.stringify({
    statut: 'plusieurs',
    pourquoi: POURQUOI_PLUSIEURS[choix.pourquoi],
    consigne: 'Ne choisis pas : montre-les à ton interlocuteur, une ligne chacun (qui, app, attente, dernier échange), '
      + 'demande lequel, puis rappelle proposer_reponse_membre avec fil = sa référence (« fil xxxxxxxx ») tel quel et le même texte. '
      + "Rien n'a été envoyé.",
    total: choix.fils.length,
    fils: choix.fils.slice(0, max).map((f) => ({
      reference: f.reference,
      qui: libelleDestinataire(f),
      app: f.app,
      attend_un_humain_depuis: f.attendLe ? dateFr(f.attendLe) : null,
      dernier_echange: dateFr(f.majLe),
    })),
  })
}

export type EntreeCarte = {
  fil: FilCandidat
  canal: CanalReponse
  /** Exactement ce qui partira (Telegram : avec l'en-tete du bot, texteReponseEquipe). */
  texteEnvoye: string
  /** Le bot des membres, sans @. */
  botMembres: string
  pourquoi: 'seul' | 'attente' | 'recent'
  total: number
  /**
   * Trouve par un nom qui designe plusieurs personnes, dont une seule a un
   * fil Support : la carte le dit, pour que l'equipe verifie le destinataire.
   */
  homonymes?: { cherche: string; personnes: number } | null
  /**
   * (16/10) La piece jointe, decrite par le serveur (descriptionFichier,
   * support-pont-pur.ts : type, nom, taille, en photo ou en fichier). Le texte
   * part alors en legende.
   */
  piece?: string | null
}

/**
 * La carte de confirmation : le destinataire (nom, @pseudo, email, app),
 * ou part le message, l'etat du fil, et le TEXTE EXACT qui partira, en
 * dernier. Sobre : ni tiret long, ni emoji.
 */
export function composerCarteReponse(e: EntreeCarte): string {
  const f = e.fil
  return [
    `Répondre à ${libelleDestinataire(f)}, app ${f.app}, ${f.reference}.`,
    e.homonymes && e.homonymes.personnes > 1
      ? `Attention : « ${e.homonymes.cherche} » désigne ${e.homonymes.personnes} personnes, une seule a un fil Support : vérifie que c'est bien elle.`
      : null,
    e.total > 1
      ? `Choisi parmi ses ${e.total} fils Support : ${e.pourquoi === 'attente' ? 'celui qui attend un humain' : 'le plus récent'}.`
      : null,
    f.attendLe
      ? `Il attend un humain depuis le ${dateFr(f.attendLe)} : après l'envoi, le fil sort de l'attente.`
      : `Le fil n'attend pas d'humain (dernier échange le ${dateFr(f.majLe)}) : la réponse s'ajoute à la conversation.`,
    e.canal === 'telegram'
      ? `Où ça part : dans Telegram, en message privé du bot des membres (@${e.botMembres.replace(/^@+/, '')}). `
        + "S'il a bloqué le bot, rien ne part et rien n'est enregistré."
      : `Où ça part : dans son chat du support (app ${f.app}). Il la lira à la prochaine ouverture du chat : aucune notification ne part.`,
    e.piece ? `Pièce jointe : ${e.piece}.` : null,
    e.piece ? 'Légende exacte qui partira :' : 'Texte exact qui partira :',
    e.texteEnvoye,
  ].filter((l): l is string => l !== null).join('\n')
}

/** L'issue de l'envoi (support-reponse.ts), en sa forme utile ici. */
export type IssueLue =
  | { ok: true; canal: CanalReponse; app: string; escalatedAt: unknown; piece?: unknown }
  | { ok: false; raison: string; detail?: string; code?: number | null }

/** fait = renvoye tel quel ; refus = rien fait par une regle ; echec = panne ou non livre. */
export type PhraseIssue = { genre: 'fait' | 'refus' | 'echec'; texte: string }

/** La phrase du resultat apres le clic : livre ou non, et ce qu'il advient du fil. */
export function phraseIssueReponse(issue: IssueLue, c: { qui: string; reference: string | null }): PhraseIssue {
  const ref = c.reference ? ` (${c.reference})` : ''
  if (issue.ok) {
    if (issue.canal === 'telegram') {
      return {
        genre: 'fait',
        texte: `Réponse livrée à ${c.qui} dans Telegram (bot des membres)${issue.piece ? ', pièce jointe comprise,' : ''} `
          + `et enregistrée dans son fil Support${ref}.`
          + (issue.escalatedAt == null
            ? " Le fil n'attend plus d'humain."
            : " Une nouvelle demande d'humain est arrivée pendant l'envoi : le fil reste en attente."),
      }
    }
    return {
      genre: 'fait',
      texte: `Réponse enregistrée dans le fil Support de ${c.qui}${ref}, app ${issue.app} : il la lira à la prochaine `
        + "ouverture de son chat, aucune notification n'est partie. Le fil n'attend plus d'humain.",
    }
  }
  switch (issue.raison) {
    case 'livre_non_enregistre':
      return {
        genre: 'fait',
        texte: `Réponse LIVRÉE à ${c.qui} dans Telegram, mais PAS enregistrée dans son fil Support${ref} (erreur de la base) : `
          + "ne la renvoie pas, il l'a reçue. Le fil reste en attente dans l'onglet Support du cockpit.",
      }
    case 'non_livre':
      return {
        genre: 'echec',
        texte: `Réponse NON livrée à ${c.qui} dans Telegram : ${issue.detail ?? 'raison inconnue'}. `
          + "Rien n'a été enregistré, le fil n'a pas bougé."
          + (issue.code === 403 ? ' Il faut le joindre autrement (email).' : ''),
      }
    case 'introuvable':
      return { genre: 'refus', texte: `Le fil${ref} n'existe plus : rien n'a été envoyé.` }
    case 'sans_compte':
      return { genre: 'refus', texte: "Ce fil Telegram ne porte aucun compte : réponse impossible à livrer, rien n'a été envoyé." }
    case 'compte_illisible':
      return { genre: 'echec', texte: "Compte Telegram du fil illisible : rien n'a été envoyé. Réessaie dans un instant." }
    case 'texte_invalide':
      return { genre: 'refus', texte: "Texte vide ou trop long : rien n'a été envoyé." }
    case 'piece_hors_telegram':
      return { genre: 'refus', texte: "Le chat du site n'affiche que du texte : la pièce jointe n'est pas partie, rien n'a été envoyé." }
    case 'legende_trop_longue':
      return { genre: 'refus', texte: `${issue.detail ?? 'Légende trop longue.'} Rien n'a été envoyé.` }
    default:
      return { genre: 'echec', texte: `Réponse non envoyée (${issue.raison}).` }
  }
}
