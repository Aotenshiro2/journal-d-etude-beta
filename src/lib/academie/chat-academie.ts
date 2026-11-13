// LE SALON « QUESTIONS DE L'ACADEMIE » (12/11/2026 ; brief
// D:\7_Agents\briefs\2026-11-12-chat-academie.md ; migration du workspace
// 20261112210000_academie_chat.sql).
//
// Un seul salon, sur /academie/chat du site : tout compte connecte lit et
// ecrit. Brice, 11/11 : « l'equivalent d'un canal leger ou poser les
// questions, comme la Community de Skool, pas une concurrence au Live Club ».
// - Texte seul, 2000 caracteres au plus apres nettoyage.
// - Comptes gratuits : 20 messages par jour de Paris ; membres d'un programme
//   (Live Club, formation, module achete, ETM, VIP, Premium Skool : statut de
//   aok_annuaire_acces autre que communaute) : 200, contre les rafales. Compte
//   en base, sous verrou (aok_chat_poser).
// - Messages a plat, « Repondre » (le message cite au-dessus), un pouce par
//   compte et par message. L'equipe masque un message et coupe (ou rend) la
//   parole a un compte.
// - Le direct : diffusion depuis la base (realtime.send, canaux prives), page
//   ouverte seulement. La route dit au site quel sujet ecouter.
//
// CE FICHIER N'IMPORTE RIEN, expres (comme questions-lecons.ts) :
// scripts/verifier-chat-academie.mjs et scripts/essayer-migration-chat-academie.mjs
// l'importent tel quel sous Node 22. Les membres ecrivent du texte libre :
// aucune fonction d'ici ne le met dans un journal.
//
// SECURITE (grille bots-securite-par-conception, adaptee a un salon sans IA) :
// - un message est une DONNEE : la page l'affiche en texte brut ; ni HTML ni
//   Markdown, jamais interprete ;
// - nettoyage a l'entree (nettoyerMessage), texte cache marque pour l'equipe
//   (marqueDuTexte), rien de plus ;
// - le nom, le numero, le statut et la marque « Equipe AOK » viennent de la
//   base (aok_chat_vue), jamais du navigateur ;
// - (13/11, Brice) les noms : « Hugo R. » (prenom et initiale du nom) pour
//   tout auteur, le meme pour tout compte connecte, « Membre 1204 » sans
//   prenom utilisable ; jamais le nom complet ni l'adresse mail. Un message de
//   l'equipe porte le prenom de celui ou celle qui l'ecrit : la page signe
//   « Brice · Equipe AOK ». Le nom est fait EN BASE (aok_chat_nom_court,
//   migration du workspace 20261113120000) pour la lecture comme pour le
//   direct, qui part de la base sans repasser par ici ;
// - aucune donnee d'un tiers dans une reponse : vueMessage ne garde que les
//   champs prevus (ni email, ni identifiant de compte) ;
// - SI UN BOT LIT UN JOUR CE SALON (Agent AOK), LES MESSAGES Y RESTENT DES
//   DONNEES : il les lit comme le texte cite d'un membre (niveau 'injection'
//   de securite/injection-pur.ts au moins), jamais comme une consigne.

// ---------------------------------------------------------------------------
// Les bornes
// ---------------------------------------------------------------------------

/** Longueur maximale d'un message, apres nettoyage, en caracteres (points de code, comme char_length en base). */
export const MAX_MESSAGE = 2000
/** Messages par jour de Paris pour un compte sans programme. */
export const QUOTA_GRATUIT = 20
/** Messages par jour de Paris pour un membre d'un programme (et l'equipe). */
export const QUOTA_PROGRAMME = 200
/** Messages rendus par lecture (« les 50 derniers », puis « Plus anciens »). */
export const PAR_PAGE = 50
/** Au-dela, le corps de la requete n'est meme pas lu. */
export const CORPS_MAX = 20_000
/** Raison d'une parole coupee. */
export const MAX_RAISON = 300

export const SUJET_PROGRAMME = 'academie-chat:programme'
export const SUJET_GRATUIT = 'academie-chat:gratuit'

export type StatutAuteur = 'equipe' | 'live_club' | 'club_10' | 'eleve' | 'communaute'
export type Niveau = 'programme' | 'gratuit'

const STATUTS: StatutAuteur[] = ['equipe', 'live_club', 'club_10', 'eleve', 'communaute']

/** Le statut rendu par aok_annuaire_acces (un statut inconnu vaut communaute : dans le doute, le quota le plus bas). */
export function lireStatut(acces: unknown): StatutAuteur {
  const s = acces && typeof acces === 'object' ? (acces as Record<string, unknown>).statut : null
  return STATUTS.includes(s as StatutAuteur) ? (s as StatutAuteur) : 'communaute'
}

/** Programme (ou equipe) : tout statut autre que communaute. */
export const niveauDuStatut = (s: StatutAuteur): Niveau => (s === 'communaute' ? 'gratuit' : 'programme')

/** Le quota du jour : 20 pour un compte gratuit, 200 pour un programme ou l'equipe. */
export const quotaDuStatut = (s: StatutAuteur): number => (niveauDuStatut(s) === 'programme' ? QUOTA_PROGRAMME : QUOTA_GRATUIT)

/** Le sujet du direct que ce compte ecoute. */
export const sujetDuNiveau = (n: Niveau): string => (n === 'programme' ? SUJET_PROGRAMME : SUJET_GRATUIT)

// ---------------------------------------------------------------------------
// Nettoyer un message
// ---------------------------------------------------------------------------

const PICTO = /\p{Extended_Pictographic}/u
const estEmoji = (cp: number | undefined) => cp !== undefined && (PICTO.test(String.fromCodePoint(cp)) || (cp >= 0x1f1e6 && cp <= 0x1f1ff))
const estPeauOuVs = (cp: number) => cp === 0xfe0f || cp === 0xfe0e || (cp >= 0x1f3fb && cp <= 0x1f3ff)

/**
 * Le point de code est-il un caractere a retirer ? Controles C0 (sauf la fin de
 * ligne), DEL et C1 ; largeur nulle et formats invisibles ; direction (Trojan
 * source) ; tags Unicode (texte ASCII invisible) ; selecteurs de variante
 * supplementaires (charge cachee derriere un emoji). Le ZWJ reste entre deux
 * emojis (familles, metiers), il disparait ailleurs. VS15/VS16 restent apres
 * un caractere (presentation d'un emoji), une suite de selecteurs part.
 */
function aRetirer(cps: number[], i: number): boolean {
  const cp = cps[i]
  if (cp === 0x0a) return false
  if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) return true
  if (cp === 0x200d) {
    let j = i - 1
    while (j >= 0 && estPeauOuVs(cps[j])) j--
    return !(estEmoji(cps[j]) && estEmoji(cps[i + 1]))
  }
  if (cp === 0x00ad || cp === 0x034f || cp === 0x061c || cp === 0x180e) return true
  if ((cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f)) return true
  if (cp === 0xfeff || (cp >= 0xfff9 && cp <= 0xfffb)) return true
  if (cp >= 0x1d173 && cp <= 0x1d17a) return true
  if (cp >= 0xe0000 && cp <= 0xe007f) return true
  if (cp >= 0xe0100 && cp <= 0xe01ef) return true
  if (cp >= 0xfe00 && cp <= 0xfe0f) return i === 0 || (cps[i - 1] >= 0xfe00 && cps[i - 1] <= 0xfe0f)
  return false
}

/** Les commentaires HTML : invisibles dans une page, ils n'ont rien a faire dans un message. */
const COMMENTAIRE_HTML = /<!--[\s\S]*?(?:-->|$)/g

export type Nettoyage = { texte: string } | { erreur: 'vide' | 'longueur' | 'texte' }

/**
 * Un message tape : NFC, fins de ligne unifiees, tabulations en espaces, sans
 * commentaire HTML ni caractere invisible, espaces repetees ramenees a une,
 * trois lignes vides ou plus ramenees a une, bords retires. Longueur comptee
 * en points de code (comme char_length en base).
 */
export function nettoyerMessage(brut: unknown): Nettoyage {
  if (typeof brut !== 'string') return { erreur: 'texte' }
  if (brut.length > MAX_MESSAGE * 8) return { erreur: 'longueur' }
  const cps = Array.from(brut.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(COMMENTAIRE_HTML, ' '), c => c.codePointAt(0) as number)
  const garde: number[] = []
  for (let i = 0; i < cps.length; i++) if (!aRetirer(cps, i)) garde.push(cps[i])
  const texte = String.fromCodePoint(...garde)
    .split('\n')
    .map(l => l.replace(/[ \u00a0\u2000-\u200a\u202f\u205f\u3000]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!texte) return { erreur: 'vide' }
  if (Array.from(texte).length > MAX_MESSAGE) return { erreur: 'longueur' }
  return { texte }
}

// ---------------------------------------------------------------------------
// Le texte cache : enregistre nettoye et marque pour l'equipe, rien de plus
// ---------------------------------------------------------------------------

/** Ce que rend analyserTexte (securite/injection-pur.ts), reduit a ce qu'on lit ici. */
export type SignalLu = { genre: string; fort: boolean; nombre?: number }

const NOMS_MARQUE: Record<string, string> = {
  invisibles: 'caractères invisibles',
  bidi: 'caractères de direction',
  tags: 'texte en caractères tags',
  selecteurs: 'sélecteurs de variante en suite',
  base64: 'long bloc Base64',
  commentaire_html: 'commentaire HTML',
  style_cache: 'style HTML qui masque',
}

/**
 * La marque pour l'equipe (null : rien a signaler). Le texte envoye est
 * analyse AVANT nettoyage, au niveau 'cache' (les mots du membre, pas une
 * consigne a chercher) : un signal fort (3 invisibles dans 100 caracteres,
 * tags, direction, commentaire HTML, Base64 qui cache une phrase...), ou un
 * long bloc Base64 (200 caracteres et plus, signal faible pour un bot mais
 * cite par le brief). Un caractere invisible isole (copier-coller) ne marque pas.
 */
export function marqueDuTexte(signaux: SignalLu[]): string | null {
  const motifs: string[] = []
  for (const s of signaux) {
    const long = s.genre === 'base64' && typeof s.nombre === 'number' && s.nombre >= 200
    if (!s.fort && !long) continue
    const nom = NOMS_MARQUE[s.genre]
    if (nom && !motifs.includes(nom)) motifs.push(nom)
  }
  if (!motifs.length) return null
  return `Texte caché à l'envoi (retiré si invisible) : ${motifs.join(', ')}.`.slice(0, 300)
}

// ---------------------------------------------------------------------------
// Le corps de la route
// ---------------------------------------------------------------------------

export type Demande =
  | { action: 'lire'; avant: string | null }
  | { action: 'envoyer'; texte: string; reponse_a: string | null; brut: string }
  | { action: 'pouce'; id: string }
  | { action: 'masquer'; id: string }
  | { action: 'couper'; id: string; raison: string | null }
  | { action: 'rendre'; numero: number }

export type ErreurDemande = 'action' | 'id' | 'vide' | 'longueur' | 'texte' | 'raison' | 'numero'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const lireUuid = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return UUID_RE.test(s) ? s : null
}

/**
 * Le corps de POST /api/academie/chat :
 *   { action: 'lire', avant? }                 les 50 derniers, ou les 50 d'avant le message `avant`
 *   { action: 'envoyer', texte, reponse_a? }   un message (texte seul)
 *   { action: 'pouce', id }                    pose ou enleve son pouce
 *   { action: 'masquer', id }                  equipe : le message disparait chez tout le monde
 *   { action: 'couper', id, raison? }          equipe : l'auteur du message n'ecrit plus
 *   { action: 'rendre', numero }               equipe : rend la parole (numero de membre)
 */
export function lireDemande(corps: unknown): Demande | { erreur: ErreurDemande } {
  const c = (corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : {}) as Record<string, unknown>
  switch (c.action) {
    case 'lire': {
      if (c.avant === undefined || c.avant === null) return { action: 'lire', avant: null }
      const avant = lireUuid(c.avant)
      return avant ? { action: 'lire', avant } : { erreur: 'id' }
    }
    case 'envoyer': {
      const n = nettoyerMessage(c.texte)
      if ('erreur' in n) return { erreur: n.erreur }
      let reponse_a: string | null = null
      if (c.reponse_a !== undefined && c.reponse_a !== null) {
        reponse_a = lireUuid(c.reponse_a)
        if (!reponse_a) return { erreur: 'id' }
      }
      return { action: 'envoyer', texte: n.texte, reponse_a, brut: c.texte as string }
    }
    case 'pouce':
    case 'masquer': {
      const id = lireUuid(c.id)
      return id ? { action: c.action, id } : { erreur: 'id' }
    }
    case 'couper': {
      const id = lireUuid(c.id)
      if (!id) return { erreur: 'id' }
      if (c.raison === undefined || c.raison === null || c.raison === '') return { action: 'couper', id, raison: null }
      const r = nettoyerMessage(c.raison)
      if ('erreur' in r) return r.erreur === 'vide' ? { action: 'couper', id, raison: null } : { erreur: 'raison' }
      if (Array.from(r.texte).length > MAX_RAISON) return { erreur: 'raison' }
      return { action: 'couper', id, raison: r.texte }
    }
    case 'rendre': {
      const n = typeof c.numero === 'number' ? c.numero : typeof c.numero === 'string' && /^\d{1,12}$/.test(c.numero) ? Number(c.numero) : NaN
      return Number.isSafeInteger(n) && n > 0 ? { action: 'rendre', numero: n } : { erreur: 'numero' }
    }
    default:
      return { erreur: 'action' }
  }
}

// ---------------------------------------------------------------------------
// Les refus, dits en clair
// ---------------------------------------------------------------------------

export type CodeRefus =
  | 'jeton' | 'action' | 'id' | 'vide' | 'longueur' | 'texte' | 'raison' | 'numero'
  | 'parole' | 'quota' | 'reponse' | 'introuvable' | 'equipe' | 'cible_equipe' | 'indisponible'

/** La phrase d'un refus, au tutoiement de l'academie. quota : selon le niveau du compte. */
export function messageRefus(code: CodeRefus, o: { max?: number; niveau?: Niveau } = {}): string {
  switch (code) {
    case 'quota':
      return o.niveau === 'programme'
        ? `Tu as écrit tes ${o.max ?? QUOTA_PROGRAMME} messages d'aujourd'hui. Tu pourras écrire de nouveau demain.`
        : `Tu as écrit tes ${o.max ?? QUOTA_GRATUIT} messages d'aujourd'hui. Les membres d'un programme en ont ${QUOTA_PROGRAMME}.`
    case 'parole': return 'Tu ne peux plus écrire dans ce salon.'
    case 'vide': return 'Ton message est vide.'
    case 'longueur': return `Ton message dépasse ${MAX_MESSAGE} caractères.`
    case 'texte': return 'Ton message doit être du texte.'
    case 'reponse': return "Le message auquel tu réponds n'existe plus."
    case 'introuvable': return "Ce message n'est plus dans le salon."
    case 'jeton': return 'Ta session a expiré. Reconnecte-toi.'
    case 'equipe': return "Ce geste est réservé à l'équipe."
    case 'cible_equipe': return "On ne coupe pas la parole à un compte de l'équipe."
    case 'raison': return `La raison dépasse ${MAX_RAISON} caractères.`
    case 'indisponible': return 'Le salon ne répond pas pour le moment. Réessaie dans un instant.'
    default: return "La demande n'est pas valide."
  }
}

// ---------------------------------------------------------------------------
// Ce que la page recoit d'un message : les champs prevus, rien d'autre
// ---------------------------------------------------------------------------

/**
 * L'auteur d'un message. nom : « Hugo R. » pour un membre (null : « Membre
 * 1204 ») ; pour l'equipe, le prenom de celui ou celle qui ecrit (null :
 * « Equipe AOK » seul), numero toujours null.
 */
export type AuteurVue = { equipe: boolean; numero: number | null; nom: string | null; statut: StatutAuteur }
export type CitationVue =
  | { etat: 'visible'; id: string; extrait: string; auteur: AuteurVue }
  | { etat: 'masque' | 'supprime' }
export type MessageVue = {
  id: string
  cree_le: string
  texte: string
  /** Liens cliquables (auteur avec programme ou equipe au moment de l'envoi). */
  liens: boolean
  auteur: AuteurVue
  pouces: number
  reponse_a: CitationVue | null
  /** Ce compte a mis son pouce (lecture seulement ; le direct ne le dit pas). */
  pouce_moi?: boolean
  /** Equipe seulement : texte cache a l'envoi. */
  marque?: string | null
  /** Equipe seulement : l'auteur n'a plus la parole. */
  auteur_sans_parole?: boolean
}

const entier = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN
  return Number.isSafeInteger(n) ? n : null
}
const chaine = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export function lireAuteur(x: unknown): AuteurVue {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const equipe = o.equipe === true
  return {
    equipe,
    numero: equipe ? null : entier(o.numero),
    // (13/11) L'equipe garde son prenom : la signature « Brice · Equipe AOK ».
    nom: chaine(o.nom)?.slice(0, 80) ?? null,
    statut: equipe ? 'equipe' : STATUTS.includes(o.statut as StatutAuteur) ? (o.statut as StatutAuteur) : 'communaute',
  }
}

/**
 * Un message rendu par aok_chat_vue, reduit aux champs prevus (si la fonction
 * en base gagne un champ un jour, il ne sort pas sans passer par ici). null si
 * la ligne est illisible (message masque entre deux lectures).
 */
export function vueMessage(x: unknown): MessageVue | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const id = lireUuid(o.id)
  const texte = typeof o.texte === 'string' ? o.texte : null
  const cree = typeof o.cree_le === 'string' && !Number.isNaN(Date.parse(o.cree_le)) ? new Date(o.cree_le).toISOString() : null
  if (!id || texte === null || !cree) return null
  let reponse_a: CitationVue | null = null
  if (o.reponse_a && typeof o.reponse_a === 'object') {
    const r = o.reponse_a as Record<string, unknown>
    const rid = lireUuid(r.id)
    if (r.etat === 'visible' && rid && typeof r.extrait === 'string') {
      reponse_a = { etat: 'visible', id: rid, extrait: r.extrait.slice(0, 200), auteur: lireAuteur(r.auteur) }
    } else {
      reponse_a = { etat: r.etat === 'masque' ? 'masque' : 'supprime' }
    }
  }
  return {
    id,
    cree_le: cree,
    texte,
    liens: o.liens === true,
    auteur: lireAuteur(o.auteur),
    pouces: Math.max(0, entier(o.pouces) ?? 0),
    reponse_a,
  }
}

// ---------------------------------------------------------------------------
// L'alerte a l'equipe par Agent AOK (12/11/2026 soir, Brice : « Les questions
// remonte par les agent aok de moi et Mel ? »)
// ---------------------------------------------------------------------------
//
// Chaque nouveau message d'un compte qui n'est pas de l'equipe (reponses
// comprises) part en message prive aux comptes diffusion = 'equipe' de
// cockpit_telegram_comptes (Brice et Melanie), par alerterEquipeTexte (texte
// brut, aucun parse_mode, apercu des liens coupe). Garde contre les rafales :
// l'alerte ne part que si l'auteur n'a ecrit AUCUN autre message dans les 10
// minutes d'avant (SQL_ALERTE_PERMISE) : au plus une alerte par auteur toutes
// les 10 minutes, sans table de plus. Ni email ni identifiant de compte : le
// nom affiche dans le salon (ou « Membre 1204 ») et son statut.

export const LIEN_SALON = 'https://aoknowledge.com/academie/chat'
/** Extrait du message dans l'alerte. */
export const MAX_EXTRAIT_ALERTE = 300
/** Pas plus d'une alerte par auteur dans cette fenetre. */
export const FENETRE_ALERTE_MIN = 10

export const LIBELLE_STATUT: Record<StatutAuteur, string> = {
  equipe: 'Équipe AOK',
  live_club: 'Live Club',
  club_10: '10% Club',
  eleve: "Élève de l'académie",
  communaute: 'Communauté',
}

/**
 * Le nom tel que le salon l'affiche : « Hugo R. », sinon le numero ; pour
 * l'equipe, « Brice · Equipe AOK » (« Equipe AOK » seul sans prenom). Jamais un email.
 */
export function nomAffiche(a: AuteurVue): string {
  if (a.equipe) return a.nom ? `${a.nom} · ${LIBELLE_STATUT.equipe}` : LIBELLE_STATUT.equipe
  return a.nom ?? (a.numero !== null ? `Membre ${a.numero}` : 'Un membre')
}

/**
 * Les adresses du membre desamorcees : Telegram rend cliquable toute adresse
 * d'un texte brut, meme sans parse_mode. « https://x.fr » devient
 * « https[:]//x.fr », « www.x.fr » devient « www[.]x.fr » : lisible par
 * l'equipe, jamais un lien a cliquer depuis l'alerte.
 */
export function desamorcerLiens(t: string): string {
  return t.replace(/\b([a-z][a-z0-9+.-]{1,15}):\/\//gi, '$1[:]//').replace(/\bwww\./gi, 'www[.]').replace(/\bt\.me\//gi, 't[.]me/')
}

/** L'extrait : sur une ligne, MAX_EXTRAIT_ALERTE caracteres au plus (points de code), points de suite si coupe. */
export function extraitAlerte(texte: string, max = MAX_EXTRAIT_ALERTE): string {
  const ligne = texte.replace(/\s+/g, ' ').trim()
  const cps = Array.from(ligne)
  return cps.length > max ? `${cps.slice(0, max - 3).join('').trimEnd()}...` : ligne
}

/**
 * Le texte de l'alerte, sobre, sans emoji ni tiret long. `extrait` arrive deja
 * rendu visible par l'appelant si l'analyse de securite l'a trouve suspect, et
 * `securite` dit alors pourquoi. Texte brut (aucun parse_mode) : rien a echapper.
 */
export function texteAlerteChat(a: {
  nom: string; statut: StatutAuteur; extrait: string; reponse: boolean; marque: boolean; securite?: string | null
}): string {
  return [
    "Nouvelle question dans le salon de l'académie",
    `De : ${a.nom} (${LIBELLE_STATUT[a.statut]})${a.reponse ? ', en réponse à un message' : ''}`,
    `Son message : « ${desamorcerLiens(a.extrait)} »`,
    a.marque ? "Texte caché retiré à l'envoi." : null,
    a.securite?.trim() || null,
    `Pour répondre : ${LIEN_SALON}`,
  ].filter(Boolean).join('\n')
}

/**
 * L'alerte part-elle : l'auteur n'est pas de l'equipe, et il n'a ecrit aucun
 * AUTRE message dans les 10 minutes d'avant (ordre (cree_le, id) : de deux
 * envois simultanes, seul le premier alerte).
 */
export const SQL_ALERTE_PERMISE = `
select exists (select 1 from public.aok_chat_messages x where x.id = $1::uuid)
   and not exists (
  select 1 from public.aok_chat_messages m, public.aok_chat_messages c
   where c.id = $1::uuid
     and m.user_id = c.user_id and m.id <> c.id
     and (m.cree_le, m.id) < (c.cree_le, c.id)
     and m.cree_le > c.cree_le - make_interval(mins => $2::int)
) as permise
`

// ---------------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------------

export type ClientSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

/** Le statut du compte (aok_annuaire_acces), son numero, sa parole et ses messages du jour de Paris. */
export const SQL_COMPTE = `
select public.aok_annuaire_acces($1::uuid) as acces,
       (select p.client_number from public.profiles p where p.id = $1::uuid) as numero,
       exists (select 1 from public.aok_chat_sans_parole s where s.user_id = $1::uuid and s.rendue_le is null) as sans_parole,
       (select count(*)::int from public.aok_chat_messages m
         where m.user_id = $1::uuid
           and m.cree_le >= (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris') as envoyes
`

/**
 * Les messages visibles, du plus recent au plus ancien : les 50 derniers, ou
 * les 50 d'avant le message $3 (cle (cree_le, id), index aok_chat_messages_fil_idx).
 * Un de plus que la page pour savoir s'il en reste. Les colonnes de l'equipe
 * ne sortent que si $4 est vrai.
 */
export const SQL_LIRE = `
select public.aok_chat_vue(m.id, $2) as vue,
       exists (select 1 from public.aok_chat_pouces po where po.message_id = m.id and po.user_id = $1::uuid) as pouce_moi,
       case when $4::boolean then m.marque end as marque,
       case when $4::boolean then exists (select 1 from public.aok_chat_sans_parole s where s.user_id = m.user_id and s.rendue_le is null) end as auteur_sans_parole
  from public.aok_chat_messages m
 where m.masque_le is null
   and ($3::uuid is null or (m.cree_le, m.id) < (select a.cree_le, a.id from public.aok_chat_messages a where a.id = $3::uuid))
 order by m.cree_le desc, m.id desc
 limit $5::int
`

export const SQL_POSER = `select public.aok_chat_poser($1::uuid, $2, $3, $4::int, $5::uuid, $6) as r`

export const SQL_VUE = `select public.aok_chat_vue($1::uuid, $2) as vue`

export const SQL_POUCE = `select public.aok_chat_pouce($1::uuid, $2::uuid) as r`

export const SQL_MASQUER = `
update public.aok_chat_messages set masque_le = now(), masque_par = $2::uuid
 where id = $1::uuid and masque_le is null
returning id::text as id
`

/** L'auteur d'un message (pour couper la parole) : son compte et son statut au moment de l'envoi. */
export const SQL_AUTEUR = `select user_id::text as user_id, statut_auteur from public.aok_chat_messages where id = $1::uuid`

export const SQL_COUPER = `
insert into public.aok_chat_sans_parole (user_id, coupee_par, raison)
select $1::uuid, $2::uuid, $3
 where not public.aok_est_equipe($1::uuid)
on conflict (user_id) where rendue_le is null do nothing
returning id::text as id
`

export const SQL_RENDRE = `
update public.aok_chat_sans_parole s set rendue_le = now(), rendue_par = $2::uuid
  from public.profiles p
 where p.client_number = $1::bigint and s.user_id = p.id and s.rendue_le is null
returning s.id::text as id
`

/** Equipe : les comptes sans parole (numero et nom connus de l'equipe, jamais l'email). */
export const SQL_SANS_PAROLE = `
select p.client_number as numero,
       nullif(coalesce(nullif(btrim(p.nom_affiche), ''), btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))), '') as nom,
       s.raison, s.coupee_le
  from public.aok_chat_sans_parole s
  join public.profiles p on p.id = s.user_id
 where s.rendue_le is null
 order by s.coupee_le desc
 limit 100
`

export type Compte = { statut: StatutAuteur; numero: number | null; sans_parole: boolean; envoyes: number }

export async function lireCompte(c: ClientSql, userId: string): Promise<Compte> {
  const l = await c.$queryRawUnsafe<{ acces: unknown; numero: unknown; sans_parole: boolean; envoyes: number }[]>(SQL_COMPTE, userId)
  const r = l[0]
  return {
    statut: lireStatut(r?.acces),
    numero: entier(typeof r?.numero === 'bigint' ? Number(r.numero) : r?.numero),
    sans_parole: r?.sans_parole === true,
    envoyes: Number(r?.envoyes ?? 0),
  }
}

/** Les messages visibles par ce compte, du plus ancien au plus recent, et s'il en reste avant. */
export async function lireMessages(c: ClientSql, userId: string, niveau: Niveau, avant: string | null, equipe: boolean): Promise<{ messages: MessageVue[]; plus_anciens: boolean }> {
  const l = await c.$queryRawUnsafe<{ vue: unknown; pouce_moi: boolean; marque: string | null; auteur_sans_parole: boolean | null }[]>(
    SQL_LIRE, userId, niveau, avant, equipe, PAR_PAGE + 1)
  const plus_anciens = l.length > PAR_PAGE
  const messages: MessageVue[] = []
  for (const ligne of l.slice(0, PAR_PAGE)) {
    // Une donnee de membre : rendue telle quelle a la page (texte brut), jamais interpretee.
    const v = vueMessage(ligne.vue)
    if (!v) continue
    v.pouce_moi = ligne.pouce_moi === true
    if (equipe) {
      v.marque = ligne.marque ?? null
      v.auteur_sans_parole = ligne.auteur_sans_parole === true
    }
    messages.push(v)
  }
  return { messages: messages.reverse(), plus_anciens }
}

export type IssuePoser =
  | { ok: true; id: string; envoyes: number; max: number }
  | { ok: false; refus: 'parole' | 'quota' | 'reponse' | 'compte'; envoyes?: number; max?: number }

export async function poserMessage(c: ClientSql, userId: string, texte: string, statut: StatutAuteur, reponseA: string | null, marque: string | null): Promise<IssuePoser> {
  const l = await c.$queryRawUnsafe<{ r: Record<string, unknown> | null }[]>(SQL_POSER, userId, texte, statut, quotaDuStatut(statut), reponseA, marque)
  const r = l[0]?.r ?? {}
  if (typeof r.refus === 'string') {
    const refus = (['parole', 'quota', 'reponse'] as const).find(x => x === r.refus) ?? 'compte'
    return { ok: false, refus, envoyes: entier(r.envoyes) ?? undefined, max: entier(r.max) ?? undefined }
  }
  const id = lireUuid(r.id)
  if (!id) return { ok: false, refus: 'compte' }
  return { ok: true, id, envoyes: entier(r.envoyes) ?? 0, max: entier(r.max) ?? quotaDuStatut(statut) }
}

/** La garde contre les rafales (SQL_ALERTE_PERMISE). En cas de doute (ligne absente), pas d'alerte. */
export async function alertePermise(c: ClientSql, messageId: string): Promise<boolean> {
  const l = await c.$queryRawUnsafe<{ permise: boolean }[]>(SQL_ALERTE_PERMISE, messageId, FENETRE_ALERTE_MIN)
  return l[0]?.permise === true
}

export async function vueDe(c: ClientSql, id: string, niveau: Niveau): Promise<MessageVue | null> {
  const l = await c.$queryRawUnsafe<{ vue: unknown }[]>(SQL_VUE, id, niveau)
  return vueMessage(l[0]?.vue)
}

export async function basculerPouce(c: ClientSql, userId: string, id: string): Promise<{ id: string; pouces: number; pouce_moi: boolean } | null> {
  const l = await c.$queryRawUnsafe<{ r: Record<string, unknown> | null }[]>(SQL_POUCE, userId, id)
  const r = l[0]?.r
  if (!r) return null
  return { id, pouces: Math.max(0, entier(r.pouces) ?? 0), pouce_moi: r.pouce_moi === true }
}

export async function masquerMessage(c: ClientSql, id: string, par: string): Promise<boolean> {
  const l = await c.$queryRawUnsafe<{ id: string }[]>(SQL_MASQUER, id, par)
  return l.length > 0
}

/** 'fait', 'deja' (deja sans parole), 'equipe' (un compte de l'equipe), 'introuvable'. */
export async function couperParole(c: ClientSql, messageId: string, par: string, raison: string | null): Promise<'fait' | 'deja' | 'equipe' | 'introuvable'> {
  const a = await c.$queryRawUnsafe<{ user_id: string; statut_auteur: string }[]>(SQL_AUTEUR, messageId)
  if (!a[0]) return 'introuvable'
  if (a[0].statut_auteur === 'equipe') return 'equipe'
  const l = await c.$queryRawUnsafe<{ id: string }[]>(SQL_COUPER, a[0].user_id, par, raison)
  if (l.length) return 'fait'
  const e = await c.$queryRawUnsafe<{ e: boolean }[]>(`select public.aok_est_equipe($1::uuid) as e`, a[0].user_id)
  return e[0]?.e ? 'equipe' : 'deja'
}

export async function rendreParole(c: ClientSql, numero: number, par: string): Promise<boolean> {
  const l = await c.$queryRawUnsafe<{ id: string }[]>(SQL_RENDRE, numero, par)
  return l.length > 0
}

export type SansParole = { numero: number | null; nom: string | null; raison: string | null; coupee_le: string }

export async function listeSansParole(c: ClientSql): Promise<SansParole[]> {
  const l = await c.$queryRawUnsafe<{ numero: unknown; nom: string | null; raison: string | null; coupee_le: Date | string }[]>(SQL_SANS_PAROLE)
  return l.map(x => ({
    numero: entier(typeof x.numero === 'bigint' ? Number(x.numero) : x.numero),
    nom: x.nom,
    raison: x.raison,
    coupee_le: new Date(x.coupee_le).toISOString(),
  }))
}
