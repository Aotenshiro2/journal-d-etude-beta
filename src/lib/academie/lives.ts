// LE CALENDRIER DES LIVES DE L'ACADEMIE (13/11/2026, brief
// D:\7_Agents\briefs\2026-11-13-calendrier-des-lives.md, inventaire A5).
//
// Skool ferme le 16/11 et son calendrier avec lui. Deux sortes de lives :
//   - les lives de Brice, le mardi et le jeudi a 20 h (heure de Paris), une
//     SERIE : une date s'annule ou se deplace sans casser la serie ;
//   - les lives partenaires, ajoutes par l'equipe, dont le lien n'existe
//     souvent qu'a la derniere minute (le Live Fixing change son lien au
//     demarrage) : l'equipe le colle depuis le cockpit.
// Migration du workspace : 20261113200000_academie_lives.sql (tables fermees
// au navigateur, aok_lives_entre deplie les series a l'heure de Paris).
//
// LA REGLE DU LIEN (question posee a Brice le 13/11, construite sur la reco) :
//   - la liste des lives est lisible par tous, connecte ou non ;
//   - le LIEN ne part qu'a un compte qui y a droit selon le niveau du live :
//       tous       tout compte connecte (comptes gratuits compris)
//       programme  un compte avec un programme (statut de l'annuaire autre que
//                  communaute) ou le niveau live_club
//       live_club  Live Club actif, eleve ETM, membre VIP, equipe
//     reco : lives de Brice = live_club, lives partenaires = tous (Brice,
//     08/11 : les membres du Live Club n'ont pas besoin des liens des lives
//     d'Arnaud, ce sont des lives publics de partenaires) ;
//   - et seulement dans la FENETRE : de 30 minutes avant le debut jusqu'a la
//     fin du live. Avant, la page dit a quelle heure le lien s'affiche.
//   - Un Live Club illisible (Stripe en panne) ne dit jamais « non » : la page
//     dit que l'acces n'a pas pu etre verifie (etat 'inconnu').
//
// Ce fichier est PUR (aucun import a l'execution) : scripts/verifier-lives.mjs
// le teste sans base ni reseau. Les requetes SQL sont ici aussi (des chaines),
// jouees par les routes.
//
// SECURITE : un titre, une description ou un lien sont des DONNEES ecrites par
// l'equipe, rendues en texte par le site (jamais en HTML). Le lien est valide
// ici : https seulement, sans identifiants, sans espace ni caractere de
// controle. Aucun email ni identifiant de compte ne part vers la page d'un
// membre (vueMembre ne garde que les champs prevus).

export type Genre = 'aok' | 'partenaire'
export type NiveauAcces = 'tous' | 'programme' | 'live_club'
export type StatutLive = 'prevu' | 'annule'

export const GENRES: readonly Genre[] = ['aok', 'partenaire']
export const NIVEAUX: readonly NiveauAcces[] = ['tous', 'programme', 'live_club']

/** Le lien s'affiche 30 minutes avant le debut (reco a Brice). */
export const AVANCE_LIEN_MIN = 30
/** La page d'un membre montre les 4 semaines qui viennent. */
export const HORIZON_MEMBRE_JOURS = 28
/** Le cockpit montre 3 jours en arriere (un live d'hier, son lien) et 8 semaines devant. */
export const COCKPIT_ARRIERE_JOURS = 3
export const COCKPIT_DEVANT_JOURS = 56

export const LIMITES = { titre: 120, animateur: 80, description: 600, lien: 500, dureeMin: 10, dureeMax: 600 } as const

const MINUTE = 60_000
const JOUR = 86_400_000

// ---------------------------------------------------------------------------
// Ce que rend aok_lives_entre
// ---------------------------------------------------------------------------

export type LigneLive = {
  cle: string
  serie_id: string | null
  live_id: string | null
  date_serie: Date | string | null
  titre: string
  animateur: string | null
  genre: string
  description: string | null
  debut: Date | string
  debut_prevu: Date | string
  duree_min: number
  acces: string
  lien: string | null
  lien_le: Date | string | null
  lien_serie: boolean
  statut: string
}

export const SQL_ENTRE = `select * from public.aok_lives_entre($1::timestamptz, $2::timestamptz)`

const iso = (d: Date | string | null | undefined): string | null => {
  if (d == null) return null
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime())

/** 'YYYY-MM-DD' d'une date de la base (Prisma rend un Date a minuit UTC pour une colonne date). */
export function jourIso(d: Date | string | null | undefined): string | null {
  if (d == null) return null
  if (typeof d === 'string') return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null
}

const estGenre = (g: unknown): g is Genre => GENRES.includes(g as Genre)
const estNiveau = (n: unknown): n is NiveauAcces => NIVEAUX.includes(n as NiveauAcces)

// ---------------------------------------------------------------------------
// Le lecteur et son droit
// ---------------------------------------------------------------------------

export type Lecteur =
  | { connecte: false }
  | { connecte: true; liveClub: 'oui' | 'non' | 'inconnu'; programme: boolean }

/**
 * Le lecteur a partir de droitsAcademie (equipe, admin, etm, vip, liveClub) et
 * du statut de aok_annuaire_acces. Live Club au sens des lives : abonnement ou
 * acces sans Stripe ('oui'), ETM, VIP ou equipe. Un Live Club 'inconnu' (Stripe
 * illisible) reste 'inconnu' : jamais un faux non.
 */
export function lecteurDe(
  d: { equipe: boolean; admin: boolean; etm: boolean; vip: boolean; liveClub: string },
  statutAnnuaire: string | null,
): Lecteur {
  const liveClub: 'oui' | 'non' | 'inconnu' =
    d.equipe || d.admin || d.etm || d.vip || d.liveClub === 'oui' ? 'oui' : d.liveClub === 'inconnu' ? 'inconnu' : 'non'
  const programme = liveClub === 'oui' || (statutAnnuaire != null && statutAnnuaire !== 'communaute')
  return { connecte: true, liveClub, programme }
}

/** Le droit du lecteur au lien d'un live de ce niveau. */
export function aDroit(niveau: NiveauAcces, l: Lecteur): 'oui' | 'non' | 'inconnu' | 'connexion' {
  if (!l.connecte) return 'connexion'
  if (niveau === 'tous') return 'oui'
  if (l.liveClub === 'oui') return 'oui'
  if (niveau === 'programme') return l.programme ? 'oui' : l.liveClub === 'inconnu' ? 'inconnu' : 'non'
  return l.liveClub === 'inconnu' ? 'inconnu' : 'non'
}

// ---------------------------------------------------------------------------
// L'etat du lien d'un live, pour un lecteur, a un instant
// ---------------------------------------------------------------------------

/**
 *   annule     le live est annule
 *   fini       le live est termine
 *   connexion  pas connecte : « Connecte-toi pour avoir le lien »
 *   ferme      pas le droit : la page dit a qui le live est reserve
 *   inconnu    le droit n'a pas pu etre verifie (Stripe illisible)
 *   avant      le droit, mais trop tot : le lien s'affiche a ouvre_le
 *   attente    dans la fenetre, l'equipe n'a pas encore colle le lien
 *   pret       dans la fenetre, le lien part (et SEULEMENT dans cet etat)
 */
export type EtatLien = 'annule' | 'fini' | 'connexion' | 'ferme' | 'inconnu' | 'avant' | 'attente' | 'pret'

export function ouvertureLien(debut: Date | string): number {
  return ms(debut) - AVANCE_LIEN_MIN * MINUTE
}

export function etatLien(
  l: Pick<LigneLive, 'debut' | 'duree_min' | 'acces' | 'lien' | 'statut'>,
  lecteur: Lecteur,
  maintenant: number,
): EtatLien {
  if (l.statut === 'annule') return 'annule'
  const fin = ms(l.debut) + l.duree_min * MINUTE
  if (maintenant >= fin) return 'fini'
  const niveau: NiveauAcces = estNiveau(l.acces) ? l.acces : 'live_club'
  const droit = aDroit(niveau, lecteur)
  if (droit === 'connexion') return 'connexion'
  if (droit === 'non') return 'ferme'
  if (droit === 'inconnu') return 'inconnu'
  if (maintenant < ouvertureLien(l.debut)) return 'avant'
  return l.lien ? 'pret' : 'attente'
}

/** Ce que la page d'un membre recoit d'un live : les champs prevus, le lien dans l'etat 'pret' seulement. */
export type LiveMembre = {
  cle: string
  titre: string
  animateur: string | null
  genre: Genre
  description: string | null
  debut: string
  fin: string
  duree_min: number
  statut: StatutLive
  deplace_de: string | null
  acces: NiveauAcces
  etat: EtatLien
  ouvre_le: string
  lien: string | null
}

export function vueMembre(l: LigneLive, lecteur: Lecteur, maintenant: number): LiveMembre | null {
  const debut = iso(l.debut)
  const prevu = iso(l.debut_prevu)
  if (!debut || !Number.isFinite(l.duree_min)) return null
  const etat = etatLien(l, lecteur, maintenant)
  const deplace = prevu !== null && prevu !== debut && l.serie_id !== null
  return {
    cle: l.cle,
    titre: l.titre,
    animateur: l.animateur,
    genre: estGenre(l.genre) ? l.genre : 'aok',
    description: l.description,
    debut,
    fin: new Date(ms(debut) + l.duree_min * MINUTE).toISOString(),
    duree_min: l.duree_min,
    statut: l.statut === 'annule' ? 'annule' : 'prevu',
    deplace_de: deplace ? prevu : null,
    acces: estNiveau(l.acces) ? l.acces : 'live_club',
    etat,
    ouvre_le: new Date(ouvertureLien(debut)).toISOString(),
    lien: etat === 'pret' ? l.lien : null,
  }
}

/** La fenetre lue pour un membre : ce qui n'est pas fini, jusqu'a 4 semaines. */
export function fenetreMembre(maintenant: number): { du: Date; au: Date } {
  return { du: new Date(maintenant), au: new Date(maintenant + HORIZON_MEMBRE_JOURS * JOUR) }
}

export function fenetreCockpit(maintenant: number): { du: Date; au: Date } {
  return { du: new Date(maintenant - COCKPIT_ARRIERE_JOURS * JOUR), au: new Date(maintenant + COCKPIT_DEVANT_JOURS * JOUR) }
}

// ---------------------------------------------------------------------------
// Nettoyer ce que l'equipe ecrit
// ---------------------------------------------------------------------------

// Controles, largeur nulle, marques de direction, separateurs de ligne, BOM,
// balises Unicode : retires. (Construit par code point : aucun caractere
// invisible dans ce fichier.)
const INVISIBLES = new RegExp(
  '[' + [
    [0x0000, 0x0008], [0x000b, 0x000c], [0x000e, 0x001f], [0x007f, 0x009f], [0x00ad, 0x00ad],
    [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0xfeff, 0xfeff],
  ].map(([a, b]) => (a === b ? `\\u{${a.toString(16)}}` : `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`)).join('') + ']'
  + '|[\\u{e0000}-\\u{e007f}]',
  'gu',
)
/** Le meme motif sans g : un test sans etat. */
const UN_INVISIBLE = new RegExp(INVISIBLES.source, 'u')

/** Un texte d'une ligne : NFC, invisibles retires, espaces reduits. null si vide. */
export function texteLigne(v: unknown, max: number): string | null | 'trop_long' {
  if (typeof v !== 'string') return null
  const t = v.normalize('NFC').replace(INVISIBLES, '').replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  if (!t) return null
  return [...t].length > max ? 'trop_long' : t
}

/** Un texte de quelques lignes (description) : lignes gardees, lignes vides reduites. */
export function texteBloc(v: unknown, max: number): string | null | 'trop_long' {
  if (typeof v !== 'string') return null
  const t = v.normalize('NFC').replace(/\r\n?/g, '\n').replace(INVISIBLES, '').replace(/\t/g, ' ')
    .split('\n').map(x => x.replace(/ {2,}/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!t) return null
  return [...t].length > max ? 'trop_long' : t
}

/**
 * Un lien colle par l'equipe : https seulement, sans identifiants (user:mot
 * de passe@), sans espace ni invisible, 500 caracteres au plus. Rend l'adresse
 * normalisee par URL, ou null.
 */
export function lireLien(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const brut = v.trim()
  if (!brut || brut.length > LIMITES.lien) return null
  if (/[\s<>"'`\\]/.test(brut) || UN_INVISIBLE.test(brut)) return null
  let u: URL
  try { u = new URL(brut) } catch { return null }
  if (u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (!u.hostname.includes('.') || u.hostname.endsWith('.')) return null
  const href = u.href
  return href.length >= 12 && href.length <= LIMITES.lien ? href : null
}

const JOUR_RE = /^\d{4}-\d{2}-\d{2}$/
const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function jourValide(v: unknown): string | null {
  if (typeof v !== 'string' || !JOUR_RE.test(v)) return null
  const d = new Date(`${v}T12:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null
}

const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null)

/** Un instant dans des bornes raisonnables : 2 jours en arriere, 400 jours devant. */
export function instantValide(v: unknown, maintenant: number): string | null {
  if (typeof v !== 'string' || v.length > 40) return null
  const t = new Date(v).getTime()
  if (!Number.isFinite(t)) return null
  if (t < maintenant - 2 * JOUR || t > maintenant + 400 * JOUR) return null
  return new Date(t).toISOString()
}

function duree(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) && n >= LIMITES.dureeMin && n <= LIMITES.dureeMax ? n : null
}

function jours(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 7) return null
  const j = [...new Set(v.map(Number))].sort((a, b) => a - b)
  return j.every(x => Number.isInteger(x) && x >= 1 && x <= 7) ? j : null
}

// ---------------------------------------------------------------------------
// Les demandes du cockpit
// ---------------------------------------------------------------------------

/** Une date de live : un ponctuel (id) ou une date d'une serie (serie_id + date_serie). */
export type Cible = { id: string } | { serie_id: string; date_serie: string }

export type ChampsSerie = {
  titre: string
  animateur: string | null
  genre: Genre
  description: string | null
  jours: number[]
  heure: string
  duree_min: number
  toutes_les_semaines: number
  debut: string
  fin: string | null
  acces: NiveauAcces
  lien: string | null
}

export type ChampsLive = {
  titre: string
  animateur: string | null
  genre: Genre
  description: string | null
  debut: string
  duree_min: number
  acces: NiveauAcces
  lien: string | null
}

export type DemandeEquipe =
  | { action: 'lister' }
  | { action: 'creer_serie'; serie: ChampsSerie }
  | { action: 'modifier_serie'; id: string; serie: ChampsSerie }
  | { action: 'arreter_serie'; id: string; fin: string }
  | { action: 'supprimer_serie'; id: string }
  | { action: 'creer_live'; live: ChampsLive }
  | { action: 'modifier_live'; id: string; live: ChampsLive }
  | { action: 'supprimer_live'; id: string }
  | { action: 'lien'; cible: Cible; lien: string | null }
  | { action: 'annuler'; cible: Cible }
  | { action: 'retablir'; cible: Cible }
  | { action: 'deplacer'; cible: Cible; debut: string | null; duree_min: number | null }
  | { action: 'texte_date'; cible: Cible; titre: string | null; description: string | null }

export type ErreurDemande =
  | 'action' | 'id' | 'cible' | 'titre' | 'animateur' | 'genre' | 'description' | 'jours' | 'heure' | 'duree'
  | 'semaines' | 'debut' | 'fin' | 'acces' | 'lien'

export const TEXTE_ERREUR: Record<ErreurDemande, string> = {
  action: 'Action inconnue.',
  id: 'Identifiant manquant ou invalide.',
  cible: 'Date de live introuvable dans la demande.',
  titre: `Titre manquant ou trop long (${LIMITES.titre} caractères au plus).`,
  animateur: `Nom de l'animateur trop long (${LIMITES.animateur} caractères au plus).`,
  genre: 'Genre inconnu (live AOK ou partenaire).',
  description: `Description trop longue (${LIMITES.description} caractères au plus).`,
  jours: 'Choisis au moins un jour de la semaine.',
  heure: 'Heure invalide (HH:MM, heure de Paris).',
  duree: `Durée invalide (de ${LIMITES.dureeMin} à ${LIMITES.dureeMax} minutes).`,
  semaines: 'Rythme invalide (toutes les 1 à 4 semaines).',
  debut: 'Date de début invalide (2 jours en arrière à 400 jours devant).',
  fin: 'Date de fin invalide (après le début).',
  acces: "Niveau d'accès inconnu (tous, programme, Live Club).",
  lien: 'Lien refusé : une adresse https:// complète, sans espace ni identifiants.',
}

function lireCible(v: unknown): Cible | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = uuid(o.id)
  if (id) return { id }
  const serie = uuid(o.serie_id)
  const date = jourValide(o.date_serie)
  return serie && date ? { serie_id: serie, date_serie: date } : null
}

/** Le champ lien d'une demande : absent ou vide = null, sinon il doit etre valide. */
function champLien(v: unknown): { ok: true; lien: string | null } | { ok: false } {
  if (v == null || (typeof v === 'string' && !v.trim())) return { ok: true, lien: null }
  const l = lireLien(v)
  return l ? { ok: true, lien: l } : { ok: false }
}

function champsCommuns(o: Record<string, unknown>):
  | { ok: true; titre: string; animateur: string | null; genre: Genre; description: string | null; acces: NiveauAcces; lien: string | null }
  | { ok: false; erreur: ErreurDemande } {
  const titre = texteLigne(o.titre, LIMITES.titre)
  if (titre === null || titre === 'trop_long') return { ok: false, erreur: 'titre' }
  const animateur = texteLigne(o.animateur, LIMITES.animateur)
  if (animateur === 'trop_long') return { ok: false, erreur: 'animateur' }
  if (!estGenre(o.genre)) return { ok: false, erreur: 'genre' }
  const description = texteBloc(o.description, LIMITES.description)
  if (description === 'trop_long') return { ok: false, erreur: 'description' }
  if (!estNiveau(o.acces)) return { ok: false, erreur: 'acces' }
  const lien = champLien(o.lien)
  if (!lien.ok) return { ok: false, erreur: 'lien' }
  return { ok: true, titre, animateur, genre: o.genre, description, acces: o.acces, lien: lien.lien }
}

function lireSerie(v: unknown, maintenant: number): { serie: ChampsSerie } | { erreur: ErreurDemande } {
  if (!v || typeof v !== 'object') return { erreur: 'titre' }
  const o = v as Record<string, unknown>
  const c = champsCommuns(o)
  if (!c.ok) return { erreur: c.erreur }
  const j = jours(o.jours)
  if (!j) return { erreur: 'jours' }
  if (typeof o.heure !== 'string' || !HEURE_RE.test(o.heure)) return { erreur: 'heure' }
  const d = duree(o.duree_min)
  if (d === null) return { erreur: 'duree' }
  const semaines = o.toutes_les_semaines == null ? 1 : Number(o.toutes_les_semaines)
  if (!Number.isInteger(semaines) || semaines < 1 || semaines > 4) return { erreur: 'semaines' }
  const debut = jourValide(o.debut)
  // Une serie peut commencer dans le passe (on la modifie), pas avant 2026.
  if (!debut || debut < '2026-01-01' || new Date(`${debut}T12:00:00Z`).getTime() > maintenant + 400 * JOUR) return { erreur: 'debut' }
  let fin: string | null = null
  if (o.fin != null && o.fin !== '') {
    fin = jourValide(o.fin)
    if (!fin || fin < debut) return { erreur: 'fin' }
  }
  const communs = { titre: c.titre, animateur: c.animateur, genre: c.genre, description: c.description, acces: c.acces, lien: c.lien }
  return { serie: { ...communs, jours: j, heure: o.heure, duree_min: d, toutes_les_semaines: semaines, debut, fin } }
}

function lireLive(v: unknown, maintenant: number): { live: ChampsLive } | { erreur: ErreurDemande } {
  if (!v || typeof v !== 'object') return { erreur: 'titre' }
  const o = v as Record<string, unknown>
  const c = champsCommuns(o)
  if (!c.ok) return { erreur: c.erreur }
  const debut = instantValide(o.debut, maintenant)
  if (!debut) return { erreur: 'debut' }
  const d = duree(o.duree_min)
  if (d === null) return { erreur: 'duree' }
  const communs = { titre: c.titre, animateur: c.animateur, genre: c.genre, description: c.description, acces: c.acces, lien: c.lien }
  return { live: { ...communs, debut, duree_min: d } }
}

/** Lit le corps de POST /api/cockpit/lives. Tout ce qui n'est pas prevu est ignore. */
export function lireDemandeEquipe(corps: unknown, maintenant: number): DemandeEquipe | { erreur: ErreurDemande } {
  if (!corps || typeof corps !== 'object') return { erreur: 'action' }
  const o = corps as Record<string, unknown>
  switch (o.action) {
    case 'lister':
      return { action: 'lister' }
    case 'creer_serie': {
      const s = lireSerie(o.serie, maintenant)
      return 'erreur' in s ? s : { action: 'creer_serie', serie: s.serie }
    }
    case 'modifier_serie': {
      const id = uuid(o.id)
      if (!id) return { erreur: 'id' }
      const s = lireSerie(o.serie, maintenant)
      return 'erreur' in s ? s : { action: 'modifier_serie', id, serie: s.serie }
    }
    case 'arreter_serie': {
      const id = uuid(o.id)
      if (!id) return { erreur: 'id' }
      const fin = jourValide(o.fin)
      return fin ? { action: 'arreter_serie', id, fin } : { erreur: 'fin' }
    }
    case 'supprimer_serie':
    case 'supprimer_live': {
      const id = uuid(o.id)
      return id ? { action: o.action, id } : { erreur: 'id' }
    }
    case 'creer_live': {
      const l = lireLive(o.live, maintenant)
      return 'erreur' in l ? l : { action: 'creer_live', live: l.live }
    }
    case 'modifier_live': {
      const id = uuid(o.id)
      if (!id) return { erreur: 'id' }
      const l = lireLive(o.live, maintenant)
      return 'erreur' in l ? l : { action: 'modifier_live', id, live: l.live }
    }
    case 'lien': {
      const cible = lireCible(o.cible)
      if (!cible) return { erreur: 'cible' }
      const l = champLien(o.lien)
      return l.ok ? { action: 'lien', cible, lien: l.lien } : { erreur: 'lien' }
    }
    case 'annuler':
    case 'retablir': {
      const cible = lireCible(o.cible)
      return cible ? { action: o.action, cible } : { erreur: 'cible' }
    }
    case 'deplacer': {
      const cible = lireCible(o.cible)
      if (!cible) return { erreur: 'cible' }
      let debut: string | null = null
      if (o.debut != null) {
        debut = instantValide(o.debut, maintenant)
        if (!debut) return { erreur: 'debut' }
      }
      // Un live ponctuel n'a pas d'horaire de serie ou revenir.
      if (debut === null && 'id' in cible) return { erreur: 'debut' }
      let d: number | null = null
      if (o.duree_min != null && o.duree_min !== '') {
        d = duree(o.duree_min)
        if (d === null) return { erreur: 'duree' }
      }
      return { action: 'deplacer', cible, debut, duree_min: d }
    }
    case 'texte_date': {
      const cible = lireCible(o.cible)
      if (!cible) return { erreur: 'cible' }
      const titre = texteLigne(o.titre, LIMITES.titre)
      if (titre === 'trop_long') return { erreur: 'titre' }
      const description = texteBloc(o.description, LIMITES.description)
      if (description === 'trop_long') return { erreur: 'description' }
      // Un ponctuel garde toujours un titre.
      if (titre === null && 'id' in cible) return { erreur: 'titre' }
      return { action: 'texte_date', cible, titre, description }
    }
    default:
      return { erreur: 'action' }
  }
}

// ---------------------------------------------------------------------------
// La demande d'un membre
// ---------------------------------------------------------------------------

/** POST /api/academie/lives : { action: 'lire' } seulement (corps vide accepte). */
export function lireDemandeMembre(corps: unknown): { action: 'lire' } | { erreur: 'action' } {
  if (corps == null) return { action: 'lire' }
  if (typeof corps !== 'object') return { erreur: 'action' }
  const a = (corps as Record<string, unknown>).action
  return a === undefined || a === 'lire' ? { action: 'lire' } : { erreur: 'action' }
}

// ---------------------------------------------------------------------------
// Ce que le cockpit recoit
// ---------------------------------------------------------------------------

export type SerieLue = {
  id: string
  titre: string
  animateur: string | null
  genre: string
  description: string | null
  jours: number[]
  heure: string
  duree_min: number
  toutes_les_semaines: number
  debut: Date | string
  fin: Date | string | null
  acces: string
  lien: string | null
  modifie_le: Date | string
  modifie_par: string | null
}

export type SerieCockpit = Omit<SerieLue, 'debut' | 'fin' | 'modifie_le' | 'genre' | 'acces'> & {
  genre: Genre
  acces: NiveauAcces
  debut: string
  fin: string | null
  modifie_le: string
  modifie_par_libelle: string | null
}

export type LiveCockpit = {
  cle: string
  serie_id: string | null
  live_id: string | null
  date_serie: string | null
  titre: string
  animateur: string | null
  genre: Genre
  description: string | null
  debut: string
  debut_prevu: string
  fin: string
  duree_min: number
  acces: NiveauAcces
  lien: string | null
  lien_le: string | null
  lien_serie: boolean
  statut: StatutLive
  deplace: boolean
  ouvre_le: string
}

export function vueSerieCockpit(s: SerieLue, libelles: Map<string, string>): SerieCockpit {
  return {
    id: s.id,
    titre: s.titre,
    animateur: s.animateur,
    genre: estGenre(s.genre) ? s.genre : 'aok',
    description: s.description,
    jours: (s.jours ?? []).map(Number),
    heure: s.heure,
    duree_min: s.duree_min,
    toutes_les_semaines: s.toutes_les_semaines,
    debut: jourIso(s.debut) ?? '',
    fin: jourIso(s.fin),
    acces: estNiveau(s.acces) ? s.acces : 'live_club',
    lien: s.lien,
    modifie_le: iso(s.modifie_le) ?? '',
    modifie_par: null,
    modifie_par_libelle: s.modifie_par ? libelles.get(s.modifie_par) ?? (s.modifie_par.startsWith('cockpit:') ? 'équipe' : s.modifie_par) : null,
  }
}

export function vueLiveCockpit(l: LigneLive): LiveCockpit | null {
  const debut = iso(l.debut)
  const prevu = iso(l.debut_prevu) ?? debut
  if (!debut || !prevu) return null
  return {
    cle: l.cle,
    serie_id: l.serie_id,
    live_id: l.live_id,
    date_serie: jourIso(l.date_serie),
    titre: l.titre,
    animateur: l.animateur,
    genre: estGenre(l.genre) ? l.genre : 'aok',
    description: l.description,
    debut,
    debut_prevu: prevu,
    fin: new Date(ms(debut) + l.duree_min * MINUTE).toISOString(),
    duree_min: l.duree_min,
    acces: estNiveau(l.acces) ? l.acces : 'live_club',
    lien: l.lien,
    lien_le: iso(l.lien_le),
    lien_serie: l.lien_serie === true,
    statut: l.statut === 'annule' ? 'annule' : 'prevu',
    deplace: l.serie_id !== null && prevu !== debut,
    ouvre_le: new Date(ouvertureLien(debut)).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Les requetes de l'equipe (role postgres, parametres $n)
// ---------------------------------------------------------------------------

export const SQL_SERIES = `
select id::text, titre, animateur, genre, description, jours, to_char(heure, 'HH24:MI') as heure, duree_min,
       toutes_les_semaines::int as toutes_les_semaines, debut, fin, acces, lien, modifie_le, modifie_par
  from public.academie_lives_series
 order by (fin is not null and fin < (now() at time zone 'Europe/Paris')::date), debut, titre`

const COLONNES_SERIE = `titre, animateur, genre, description, jours, heure, duree_min, toutes_les_semaines, debut, fin, acces, lien`
const VALEURS_SERIE = `$1::text, $2::text, $3::text, $4::text, $5::smallint[], $6::time, $7::int, $8::smallint, $9::date, $10::date, $11::text, $12::text`

export const SQL_CREER_SERIE = `
insert into public.academie_lives_series (${COLONNES_SERIE}, cree_par, modifie_par)
values (${VALEURS_SERIE}, $13::text, $13::text)
returning id::text`

export const SQL_MODIFIER_SERIE = `
update public.academie_lives_series
   set (${COLONNES_SERIE}, modifie_le, modifie_par) = (${VALEURS_SERIE}, now(), $13::text)
 where id = $14::uuid
returning id::text`

export const valeursSerie = (s: ChampsSerie, par: string) => [
  s.titre, s.animateur, s.genre, s.description, s.jours, s.heure, s.duree_min, s.toutes_les_semaines, s.debut, s.fin, s.acces, s.lien, par,
]

export const SQL_ARRETER_SERIE = `
update public.academie_lives_series
   set fin = greatest($2::date, debut), modifie_le = now(), modifie_par = $3::text
 where id = $1::uuid
returning id::text`

export const SQL_SUPPRIMER_SERIE = `delete from public.academie_lives_series where id = $1::uuid returning id::text`

const COLONNES_LIVE = `titre, animateur, genre, description, debut, duree_min, acces, lien, lien_le`
const VALEURS_LIVE = `$1::text, $2::text, $3::text, $4::text, $5::timestamptz, $6::int, $7::text, $8::text, case when $8::text is null then null else now() end`

export const SQL_CREER_LIVE = `
insert into public.academie_lives (${COLONNES_LIVE}, cree_par, modifie_par)
values (${VALEURS_LIVE}, $9::text, $9::text)
returning id::text`

/** Le lien_le ne bouge que si le lien change. */
export const SQL_MODIFIER_LIVE = `
update public.academie_lives
   set titre = $1::text, animateur = $2::text, genre = $3::text, description = $4::text, debut = $5::timestamptz,
       duree_min = $6::int, acces = $7::text,
       lien_le = case when $8::text is null then null when lien is distinct from $8::text then now() else lien_le end,
       lien = $8::text,
       modifie_le = now(), modifie_par = $9::text
 where id = $10::uuid and serie_id is null
returning id::text`

export const valeursLive = (l: ChampsLive, par: string) => [l.titre, l.animateur, l.genre, l.description, l.debut, l.duree_min, l.acces, l.lien, par]

export const SQL_SUPPRIMER_LIVE = `delete from public.academie_lives where id = $1::uuid and serie_id is null returning id::text`

// Les gestes sur UNE date. Un ponctuel : update de sa ligne. Une date de serie :
// l'exception est creee si elle n'existe pas (seulement si la date est bien une
// date de la serie, aok_lives_date_de_serie), puis le champ change.

/** Le geste sur une date de serie : $1 serie, $2 date, $3 par, puis les valeurs du geste a partir de $4. */
function exception(colonnes: string[], valeurs: string[], miseAJour: string): string {
  return `
insert into public.academie_lives (serie_id, date_serie, ${colonnes.join(', ')}, cree_par, modifie_par)
select $1::uuid, $2::date, ${valeurs.join(', ')}, $3::text, $3::text
 where public.aok_lives_date_de_serie($1::uuid, $2::date)
on conflict (serie_id, date_serie) where serie_id is not null
do update set ${miseAJour}, modifie_le = now(), modifie_par = excluded.modifie_par
returning id::text`
}

export const SQL_LIEN_SERIE = exception(['lien', 'lien_le'], ['$4::text', 'case when $4::text is null then null else now() end'],
  'lien = excluded.lien, lien_le = excluded.lien_le')
export const SQL_LIEN_PONCTUEL = `
update public.academie_lives set lien = $2::text, lien_le = case when $2::text is null then null else now() end,
       modifie_le = now(), modifie_par = $3::text
 where id = $1::uuid and serie_id is null
returning id::text`

export const SQL_STATUT_SERIE = exception(['statut'], ['$4::text'], 'statut = excluded.statut')
export const SQL_STATUT_PONCTUEL = `
update public.academie_lives set statut = $2::text, modifie_le = now(), modifie_par = $3::text
 where id = $1::uuid and serie_id is null
returning id::text`

export const SQL_DEPLACER_SERIE = exception(['debut', 'duree_min'], ['$4::timestamptz', '$5::int'],
  'debut = excluded.debut, duree_min = excluded.duree_min')
export const SQL_DEPLACER_PONCTUEL = `
update public.academie_lives set debut = $2::timestamptz, duree_min = coalesce($4::int, duree_min),
       modifie_le = now(), modifie_par = $3::text
 where id = $1::uuid and serie_id is null
returning id::text`

export const SQL_TEXTE_SERIE = exception(['titre', 'description'], ['$4::text', '$5::text'],
  'titre = excluded.titre, description = excluded.description')
export const SQL_TEXTE_PONCTUEL = `
update public.academie_lives set titre = $2::text, description = $4::text, modifie_le = now(), modifie_par = $3::text
 where id = $1::uuid and serie_id is null
returning id::text`

/** La requete et ses valeurs pour un geste sur une date (lien, annuler, retablir, deplacer, texte_date). */
export function requeteDate(d: Extract<DemandeEquipe, { cible: Cible }>, par: string): { sql: string; valeurs: unknown[] } {
  const serie = 'serie_id' in d.cible
  const tete = serie ? [(d.cible as { serie_id: string }).serie_id, (d.cible as { date_serie: string }).date_serie, par] : null
  const id = 'id' in d.cible ? d.cible.id : null
  switch (d.action) {
    case 'lien':
      return serie ? { sql: SQL_LIEN_SERIE, valeurs: [...tete!, d.lien] } : { sql: SQL_LIEN_PONCTUEL, valeurs: [id, d.lien, par] }
    case 'annuler':
    case 'retablir': {
      const statut = d.action === 'annuler' ? 'annule' : 'prevu'
      return serie ? { sql: SQL_STATUT_SERIE, valeurs: [...tete!, statut] } : { sql: SQL_STATUT_PONCTUEL, valeurs: [id, statut, par] }
    }
    case 'deplacer':
      return serie
        ? { sql: SQL_DEPLACER_SERIE, valeurs: [...tete!, d.debut, d.duree_min] }
        : { sql: SQL_DEPLACER_PONCTUEL, valeurs: [id, d.debut, par, d.duree_min] }
    case 'texte_date':
      return serie
        ? { sql: SQL_TEXTE_SERIE, valeurs: [...tete!, d.titre, d.description] }
        : { sql: SQL_TEXTE_PONCTUEL, valeurs: [id, d.titre, par, d.description] }
  }
}

/** Les tables ou les fonctions de la migration manquent (code deploye avant elle). */
export function migrationAbsente(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /42P01|42883|relation .* does not exist|function public\.aok_lives_\w+\(.*\) does not exist/i.test(m)
}
