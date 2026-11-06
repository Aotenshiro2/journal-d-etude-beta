// LES BESOINS DES MEMBRES, SIGNAUX DE FRICTION ET LIMITES DES AGENTS
// (06/11/2026, apres-midi) : la partie PURE, sans base ni reseau, rejouee par
// scripts/verifier-besoins.mjs et scripts/eval-limites.mjs.
//
// Brice, 06/11 : les signaux automatiques au niveau « Refus + impasses »
// (contrat besoins-contrat-api.md, section « Suite du 06/11 apres-midi »), et
// « l'agent Live Club peut aussi nous remonter ses besoins, ses frictions pour
// l'ameliorer ».
//
// 1. Les SIGNAUX. Un signal = l'outil a dit « non » au membre (refus) ou le
//    membre est tombe dans une impasse. Envoye UNE fois au moment de
//    l'evenement, jamais par minuterie. La liste des cles est FERMEE et vit
//    ICI, seule source : chaque cle dit qui peut l'envoyer (les apps des
//    outils, ou le serveur seul pour les bots), son genre (refus = carte bug,
//    impasse = carte blocage), son titre de carte et le contexte permis. Aucun
//    contenu libre : un contexte hors liste est refuse, une valeur est bornee
//    a 60 caracteres et normalisee selon son genre.
// 2. Les LIMITES DES AGENTS. Sans IA, au serveur : une recherche (fiches
//    produits, cours) qui ne rend rien, un agent qui n'aboutit pas, un passage
//    a l'equipe qui suit une recherche. Par l'agent : l'outil noter_limite.
//    Le TRI DE BRICE est applique ICI, par le serveur (triLimites) : « une
//    demande sur une donnee sensible qui ne concerne pas l'eleve directement,
//    j'en veux pas, a part si ca vient d'un admin. Mais une demande ou l'IA ne
//    sait pas, on le met dans a trier. » La consigne du prompt ne suffit pas.
//
// Securite (grille de Brice) : la cle et le contexte d'un signal ne vont
// jamais dans un prompt ; le texte du membre reste une donnee ; aucune donnee
// d'un tiers ne repart ; rien de secret dans un log.

import type Anthropic from '@anthropic-ai/sdk'
import { FORMULE_REFUS, TEXTE_PROMOS } from '../politique-information'
import { APPS_BOUTON, type AppBouton } from './bouton-pur'
import { MAX_RESUME, MAX_TITRE, nettoyerTexteIA, normaliserCle, type BesoinPropose, type NatureBesoin, type OutilBesoin } from './pur'

// ---------------------------------------------------------------------------
// La liste fermee des signaux
// ---------------------------------------------------------------------------

/** Ce qu'une valeur de contexte peut etre (la normalisation suit le genre). */
export type GenreValeur = 'jeton' | 'texte' | 'chemin' | 'plateforme' | 'app_fil'

/** Refus (l'outil a dit non : carte bug) ou impasse (le membre est bloque : carte blocage). */
export type GenreSignal = 'refus' | 'impasse'

export type DefinitionSignal = {
  /** Les apps qui peuvent l'envoyer par POST /api/besoins/signal ; 'serveur' = le serveur du journal seulement. */
  apps: readonly AppBouton[] | 'serveur'
  genre: GenreSignal
  /** Le titre de la carte creee au seuil (80 caracteres au plus, sans tiret long). */
  titre: string
  /** Les champs de contexte permis et leur genre. */
  contexte: Readonly<Record<string, GenreValeur>>
}

/** Valeur de contexte : 60 caracteres au plus (contrat). */
export const MAX_VALEUR_CONTEXTE = 60

/** Les plateformes que le Carnet connait (carnet.capture_impossible) ; le reste devient « autre ». */
export const PLATEFORMES_CARNET = ['chatgpt', 'claude', 'gemini', 'perplexity', 'mistral', 'copilot', 'deepseek', 'grok', 'notion', 'youtube', 'tradingview'] as const

/** Les apps d'un fil du chat support (site.info_absente) ; le reste devient « autre ». */
export const APPS_FIL_SUPPORT = ['extension', 'journal', 'site', 'masterclass', 'pilotage', 'academie', 'meltrade'] as const

const DEFINITIONS = {
  'pilotage.import_releve_non_reconnu': { apps: ['pilotage'], genre: 'refus', titre: "Pilotage : relevé de broker non reconnu à l'import", contexte: { extension: 'jeton', broker_detecte: 'texte' } },
  'pilotage.import_broker_autre': { apps: ['pilotage'], genre: 'impasse', titre: "Pilotage : broker absent de la liste à l'import", contexte: { broker_saisi: 'texte' } },
  'pilotage.import_erreur': { apps: ['pilotage'], genre: 'refus', titre: "Pilotage : erreur pendant l'import d'un relevé", contexte: { etape: 'jeton' } },
  'carnet.capture_impossible': { apps: ['extension'], genre: 'refus', titre: 'Carnet : capture impossible', contexte: { plateforme: 'plateforme', raison: 'jeton' } },
  'carnet.sync_echec': { apps: ['extension'], genre: 'refus', titre: 'Carnet : synchronisation en échec', contexte: { code: 'jeton' } },
  'carnet.export_echec': { apps: ['extension'], genre: 'refus', titre: 'Carnet : export en échec', contexte: { format: 'jeton' } },
  'academie.recherche_vide': { apps: ['site', 'academie', 'masterclass'], genre: 'impasse', titre: 'Académie : recherche sans résultat', contexte: { termes: 'texte' } },
  'academie.video_illisible': { apps: ['academie', 'masterclass'], genre: 'refus', titre: 'Académie : vidéo illisible', contexte: { lecon: 'jeton' } },
  'journal.import_echec': { apps: ['journal'], genre: 'refus', titre: "Journal : import de trades en échec", contexte: { code: 'jeton' } },
  'site.page_introuvable': { apps: ['site'], genre: 'impasse', titre: 'Site : page introuvable', contexte: { chemin: 'chemin' } },
  'site.paiement_refuse': { apps: ['site'], genre: 'refus', titre: 'Site : paiement refusé', contexte: { offre: 'jeton' } },
  // Le serveur seul (bot des membres du Live Club, chat du support).
  'bot.bouton_perime': { apps: 'serveur', genre: 'impasse', titre: 'Bot : bouton périmé', contexte: {} },
  'bot.message_non_compris': { apps: 'serveur', genre: 'impasse', titre: 'Bot : message non compris', contexte: {} },
  'bot.info_absente': { apps: 'serveur', genre: 'impasse', titre: "Bot : l'info manque dans les fiches ou les cours", contexte: { sujet: 'texte' } },
  'bot.agent_echec': { apps: 'serveur', genre: 'refus', titre: "Bot : l'agent n'a pas abouti", contexte: {} },
  'bot.transmis_sans_reponse': { apps: 'serveur', genre: 'impasse', titre: "Bot : transmis à l'équipe faute de réponse", contexte: { sujet: 'texte' } },
  'site.info_absente': { apps: 'serveur', genre: 'impasse', titre: "Chat du support : l'info manque", contexte: { app: 'app_fil', sujet: 'texte' } },
} satisfies Record<string, DefinitionSignal>

export type CleSignal = keyof typeof DEFINITIONS

/** La liste fermee : la seule source des cles, de leur genre, de leur titre et de leur contexte. */
export const SIGNAUX: Readonly<Record<CleSignal, DefinitionSignal>> = DEFINITIONS

export const CLES_SIGNAUX = Object.keys(SIGNAUX) as CleSignal[]

/** La forme d'une cle de carte (contrainte de la migration 20261106120000). */
export const RE_CLE_CARTE = /^[a-z]+[.][a-z0-9_]{1,64}$/

export function estCleSignal(v: unknown): v is CleSignal {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SIGNAUX, v)
}

/** Une cle que les outils peuvent envoyer eux-memes (pas une cle du serveur). */
export function estCleClient(v: unknown): v is CleSignal {
  return estCleSignal(v) && SIGNAUX[v].apps !== 'serveur'
}

/** L'outil d'une carte de signal : le prefixe de la cle. */
export function outilDuSignal(cle: CleSignal): OutilBesoin {
  return cle.slice(0, cle.indexOf('.')) as OutilBesoin
}

export function natureDuSignal(cle: CleSignal): NatureBesoin {
  return SIGNAUX[cle].genre === 'refus' ? 'bug' : 'blocage'
}

/** Le besoin d'une carte de signal (seuil atteint, ou ligne C du bouton) : titre fixe, AUCUN mot de membre. */
export function besoinDuSignal(cle: CleSignal): BesoinPropose {
  const d = SIGNAUX[cle]
  return { outil: outilDuSignal(cle), nature: natureDuSignal(cle), titre: d.titre.slice(0, MAX_TITRE), cle, resume: d.titre.slice(0, MAX_RESUME) }
}

// ---------------------------------------------------------------------------
// Le contexte : borne, normalise, jamais de texte libre hors de la cle
// ---------------------------------------------------------------------------

const RE_EMAIL = /[^\s@]+@[^\s@]+/g
const RE_URL = /\b(?:https?:\/\/|www\.)\S+/gi
const RE_PSEUDO = /(^|\s)@\S+/g
const RE_LONGS_NOMBRES = /\d{6,}/g

function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Coupe a `max` sur un mot quand c'est possible. */
function couper(s: string, max: number): string {
  if (s.length <= max) return s
  const coupe = s.slice(0, max + 1)
  const espace = coupe.lastIndexOf(' ')
  return (espace > max * 0.6 ? coupe.slice(0, espace) : s.slice(0, max)).trim()
}

/** Un identifiant court (code, etape, format, extension, raison, offre, lecon) : minuscules ASCII, chiffres, _ . - */
function jeton(v: string): string {
  return sansAccents(v).toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(0, MAX_VALEUR_CONTEXTE).replace(/[_.-]+$/g, '')
}

/** Quelques mots (sujet, termes, broker) : sans email, lien, @, long nombre ; minuscules sans accents ; lettres, chiffres, espaces. */
function texteCourt(v: string): string {
  const t = v.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(RE_EMAIL, ' ').replace(RE_URL, ' ').replace(RE_PSEUDO, ' ').replace(RE_LONGS_NOMBRES, ' ')
  return couper(sansAccents(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(), MAX_VALEUR_CONTEXTE)
}

/**
 * Un chemin de page : sans requete ni fragment, commence par /, caracteres
 * d'URL simples ; un segment qui ressemble a un identifiant ou a un jeton
 * (long nombre, long hexadecimal, @) devient « :id ». 60 caracteres au plus.
 */
function chemin(v: string): string {
  const sans = v.split(/[?#]/)[0].replace(/[\p{Cc}\p{Cf}\s]/gu, '')
  if (!sans.startsWith('/') || sans.startsWith('//')) return ''
  const segments = sans.split('/').map((s, i) => {
    if (i === 0) return s
    if (s.includes('@') || /\d{6,}/.test(s) || /^[0-9a-f-]{16,}$/i.test(s) || s.length > 40) return ':id'
    return s.replace(/[^A-Za-z0-9_.~%-]+/g, '')
  })
  return segments.join('/').slice(0, MAX_VALEUR_CONTEXTE)
}

function normaliserValeur(genre: GenreValeur, brut: string): string {
  switch (genre) {
    case 'jeton': return jeton(brut)
    case 'texte': return texteCourt(brut)
    case 'chemin': return chemin(brut)
    case 'plateforme': {
      const j = jeton(brut)
      return j ? ((PLATEFORMES_CARNET as readonly string[]).includes(j) ? j : 'autre') : ''
    }
    case 'app_fil': {
      const j = jeton(brut)
      return j ? ((APPS_FIL_SUPPORT as readonly string[]).includes(j) ? j : 'autre') : ''
    }
  }
}

export type Contexte = Record<string, string>

/**
 * Le contexte d'un signal. Refuse (null) : pas un objet, un champ hors de la
 * cle, une valeur qui n'est ni texte ni nombre. Une valeur vide apres
 * normalisation est retiree. Rien d'autre ne passe.
 */
export function normaliserContexte(cle: CleSignal, brut: unknown): Contexte | null {
  if (brut === undefined || brut === null) return {}
  if (typeof brut !== 'object' || Array.isArray(brut)) return null
  const permis = SIGNAUX[cle].contexte
  const sortie: Contexte = {}
  for (const [k, v] of Object.entries(brut as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(permis, k)) return null
    if (v === undefined || v === null || v === '') continue
    if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) return null
    const n = normaliserValeur(permis[k], String(v).slice(0, 400))
    if (n) sortie[k] = n
  }
  return sortie
}

/** Le contexte d'un signal du serveur : jamais d'erreur, les champs hors liste sont ecartes. */
export function contexteServeur(cle: CleSignal, brut: Record<string, unknown>): Contexte {
  const permis = SIGNAUX[cle].contexte
  const propre: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(brut)) if (Object.prototype.hasOwnProperty.call(permis, k)) propre[k] = v
  return normaliserContexte(cle, propre) ?? {}
}

export type CorpsSignal = { app: AppBouton; cle: CleSignal; contexte: Contexte }
export type ErreurCorpsSignal = { erreur: string; status: 400 }

/** Corps de requete au plus pour POST /api/besoins/signal (un petit objet). */
export const CORPS_SIGNAL_MAX_OCTETS = 4096

/** Le corps de POST /api/besoins/signal : { app, cle, contexte? }. 400 : cle inconnue ou du serveur, app hors de la cle, contexte invalide. */
export function lireCorpsSignal(corps: unknown): CorpsSignal | ErreurCorpsSignal {
  const c = corps && typeof corps === 'object' && !Array.isArray(corps) ? (corps as Record<string, unknown>) : null
  if (!c) return { erreur: 'Corps JSON attendu : { app, cle, contexte? }.', status: 400 }
  if (!estCleClient(c.cle)) return { erreur: 'cle inconnue.', status: 400 }
  const app = typeof c.app === 'string' ? c.app.trim().toLowerCase() : ''
  if (!(APPS_BOUTON as readonly string[]).includes(app)) return { erreur: `app inconnue : ${APPS_BOUTON.join(', ')}.`, status: 400 }
  const apps = SIGNAUX[c.cle].apps
  if (apps === 'serveur' || !(apps as readonly string[]).includes(app)) return { erreur: 'Cette cle ne vient pas de cette app.', status: 400 }
  const contexte = normaliserContexte(c.cle, c.contexte)
  if (!contexte) return { erreur: 'contexte invalide pour cette cle.', status: 400 }
  return { app: app as AppBouton, cle: c.cle, contexte }
}

/**
 * Le champ `signal` du corps de POST /api/besoins/signaler (ligne C) : absent
 * = null ; une cle des outils permise pour cette app = la cle ; sinon une
 * erreur 400 (on ne rattache pas une demande a une cle inventee).
 */
export function lireSignalDuBouton(v: unknown, app: AppBouton): CleSignal | null | ErreurCorpsSignal {
  if (v === undefined || v === null || v === '') return null
  if (!estCleClient(v)) return { erreur: 'signal inconnu.', status: 400 }
  const apps = SIGNAUX[v].apps
  if (apps === 'serveur' || !(apps as readonly string[]).includes(app)) return { erreur: 'Ce signal ne vient pas de cette app.', status: 400 }
  return v
}

// ---------------------------------------------------------------------------
// La cadence et le seuil
// ---------------------------------------------------------------------------

/** Un meme signal par personne et par cle au plus une fois par heure. */
export const CADENCE_CLE_MINUTES = 60
/** 30 signaux par personne et par 24 heures glissantes. */
export const SIGNAUX_PAR_JOUR = 30
/** 3 personnes distinctes en 7 jours sur une cle = une carte a_trier. */
export const SEUIL_PERSONNES = 3
export const SEUIL_JOURS = 7

export type DecisionCadence = 'ecrire' | 'cadence_cle' | 'cadence_jour'

/** La cadence, d'apres ce que la base a deja pour cette personne (lu sous verrou). */
export function decisionCadence(o: { dejaCetteHeure: boolean; aujourdhui: number }): DecisionCadence {
  if (o.dejaCetteHeure) return 'cadence_cle'
  if (o.aujourdhui >= SIGNAUX_PAR_JOUR) return 'cadence_jour'
  return 'ecrire'
}

/**
 * Le seuil, d'apres les personnes distinctes des 7 derniers jours et la carte
 * qui porte deja la cle (fusions suivies). Une carte existante, QUEL QUE SOIT
 * son statut, est gardee telle quelle : rattachement, jamais de reouverture
 * (une carte refusee reste refusee).
 */
export function decisionSeuil(o: { personnes7j: number; carteExiste: boolean }): 'rien' | 'rattacher' | 'creer' {
  if (o.personnes7j < SEUIL_PERSONNES) return 'rien'
  return o.carteExiste ? 'rattacher' : 'creer'
}

/** Le jour (UTC) d'une empreinte de visiteur. */
export function jourEmpreinte(maintenant: Date): string {
  return maintenant.toISOString().slice(0, 10)
}

/** L'appareil en deux mots (forme, systeme), pour l'empreinte du jour : jamais l'en-tete complet. */
export function appareilEmpreinte(ua: string | null): string {
  const u = (ua ?? '').toLowerCase()
  if (!u) return 'inconnu'
  const forme = /ipad|tablet/.test(u) ? 'tablette' : /mobi|iphone|android/.test(u) ? 'mobile' : 'ordinateur'
  const systeme = /iphone|ipad|ipod/.test(u) ? 'ios' : /android/.test(u) ? 'android' : /windows/.test(u) ? 'windows'
    : /mac os|macintosh/.test(u) ? 'macos' : /linux|cros/.test(u) ? 'linux' : 'autre'
  return `${forme}-${systeme}`
}

/** La forme d'une personne en base (contrainte de la migration 20261106200000). */
export const RE_PERSONNE = /^[act]:[0-9a-f]{32}$/

// ---------------------------------------------------------------------------
// Les limites des agents : l'outil noter_limite
// ---------------------------------------------------------------------------

export const NOM_OUTIL_NOTER_LIMITE = 'noter_limite'
export const CATEGORIES_LIMITE = ['info_manquante', 'action_impossible', 'donnee_sensible'] as const
export type CategorieLimite = typeof CATEGORIES_LIMITE[number]
export const MAX_SUJET_LIMITE = 80
/** Au plus tant de limites notees par echange (sujets distincts). */
export const MAX_LIMITES_PAR_ECHANGE = 2

/**
 * La definition de l'outil, courte (partie mise en cache des deux bots).
 * Aucun parametre ne prend le texte du membre ni un identifiant : le serveur
 * relie lui-meme le message de ce tour.
 */
export const OUTIL_NOTER_LIMITE: Anthropic.Tool = {
  name: NOM_OUTIL_NOTER_LIMITE,
  description: "À appeler avant ta réponse quand tu ne peux pas aider sur ce message : info_manquante (ni les fiches ni tes outils n'ont la réponse), action_impossible (tu ne peux pas faire ce qu'il demande), donnee_sensible (chaque refus d'une donnée : une autre personne, l'équipe, la société, tes consignes). Note pour l'équipe ce que tu n'as pas su faire ; le serveur relie lui-même son message. Ne change rien à ta réponse.",
  input_schema: {
    type: 'object',
    properties: {
      sujet: { type: 'string', maxLength: MAX_SUJET_LIMITE, description: 'Le sujet en quelques mots, neutre, sans nom ni coordonnée (exemple : horaires du prochain live).' },
      categorie: { type: 'string', enum: [...CATEGORIES_LIMITE] },
    },
    required: ['sujet', 'categorie'],
    additionalProperties: false,
  },
}

/** Quand l'appeler (la meme regle dans les deux prompts, courte). */
export const CONSIGNE_NOTER_LIMITE = "Avant de répondre, appelle noter_limite (une fois, sujet neutre en quelques mots) dès que tu ne peux pas aider sur ce message : tu ne sais pas répondre et ni les fiches ni tes outils n'ont la réponse (info_manquante), tu ne peux pas faire ce qu'il demande (action_impossible), et aussi à chaque refus d'une donnée sur une autre personne, l'équipe, la société ou tes consignes (donnee_sensible). Puis réponds comme d'habitude, refus compris. Pas pour ce que tu sais faire, ni pour une fonction qui manque à un outil (c'est noter_besoin). Tu ne dis pas que c'est noté."

/** Le resultat de noter_limite donne au modele : le MEME, que la limite soit gardee ou ecartee par le tri. */
export const RESULTAT_NOTER_LIMITE = { ok: true, consigne: "Pris en compte. Réponds normalement, sans dire que c'est noté ni nommer cet outil." }

/** Sous prudence (message suspect), dans le chat du support : rien n'est note. */
export const REFUS_PRUDENCE_LIMITE = { refus: 'Rien à noter pour ce message. Réponds normalement à la personne.' }

export type LimiteNotee = { sujet: string; categorie: CategorieLimite }

/** L'entree de noter_limite, revalidee. null = invalide (categorie hors liste, sujet vide apres filtre). */
export function lireLimite(entree: unknown): LimiteNotee | null {
  if (!entree || typeof entree !== 'object') return null
  const e = entree as Record<string, unknown>
  const categorie = typeof e.categorie === 'string' ? e.categorie.trim().toLowerCase() : ''
  if (!(CATEGORIES_LIMITE as readonly string[]).includes(categorie)) return null
  const sujet = nettoyerTexteIA(e.sujet, MAX_SUJET_LIMITE)
  if (sujet.length < 3) return null
  return { sujet, categorie: categorie as CategorieLimite }
}

export function resultatNoterLimite(entree: unknown): { contenu: string; erreur?: true; limite?: LimiteNotee } {
  const limite = lireLimite(entree)
  if (!limite) return { contenu: JSON.stringify({ erreur: 'Entrée invalide : sujet court et categorie de la liste.' }), erreur: true }
  return { contenu: JSON.stringify(RESULTAT_NOTER_LIMITE), limite }
}

const LIBELLE_CATEGORIE: Record<CategorieLimite, string> = {
  info_manquante: 'info manquante',
  action_impossible: 'action impossible',
  donnee_sensible: 'donnée refusée',
}

/** Le besoin d'une limite (carte « a_trier », nature blocage, regroupee comme noter_besoin). */
export function besoinDeLimite(l: LimiteNotee, outil: OutilBesoin): BesoinPropose {
  const titre = l.sujet.slice(0, MAX_TITRE)
  return {
    outil, nature: 'blocage', titre,
    cle: normaliserCle(`limite_${l.sujet}`, outil, titre),
    resume: `Limite de l'agent (${LIBELLE_CATEGORIE[l.categorie]}) : ${l.sujet}`.slice(0, MAX_RESUME),
  }
}

// ---------------------------------------------------------------------------
// Les limites vues par le serveur pendant un echange, puis le TRI
// ---------------------------------------------------------------------------

/** Une recherche de l'agent (fiches produits ou cours) et ce qu'elle a rendu. */
export type Consultation = { outil: 'connaissances_produits' | 'trouver_cours'; sujet: string; vide: boolean }

export type SuiviLimites = {
  consultations: Consultation[]
  /** demander_un_humain appele dans cet echange (le tri ecarte un humain demande, un remboursement, une reclamation). */
  humain: boolean
  limites: LimiteNotee[]
  /** L'agent n'a pas abouti (tours epuises, reponse vide) : le bot retombe sur le menu. */
  echec: boolean
  /** Message suspect (detecteur d'injection) : rien des limites n'est garde. */
  prudence: boolean
}

export function suiviLimites(): SuiviLimites {
  return { consultations: [], humain: false, limites: [], echec: false, prudence: false }
}

/**
 * Une recherche de l'agent et son resultat (l'objet que l'outil rend au
 * modele). « Rien rendu » : connaissances_produits sans fiche (sujet hors
 * liste), trouver_cours sans lecon ni masterclass (aucun_resultat). Une panne
 * (recherche_indisponible) ou une entree illisible n'est pas une absence.
 */
export function noterConsultation(s: SuiviLimites, nom: string, entree: unknown, resultat: unknown): void {
  const r = resultat && typeof resultat === 'object' ? (resultat as Record<string, unknown>) : {}
  const e = entree && typeof entree === 'object' ? (entree as Record<string, unknown>) : {}
  if (nom === 'connaissances_produits') {
    const brut = e.sujets
    const sujets = (Array.isArray(brut) ? brut : [brut]).filter((x): x is string => typeof x === 'string').join(' ')
    const vide = typeof r.erreur === 'string' && !Array.isArray(r.fiches)
    s.consultations.push({ outil: 'connaissances_produits', sujet: sujets, vide })
    return
  }
  if (nom === 'trouver_cours') {
    if (typeof r.erreur === 'string' || r.recherche_indisponible === true) return
    const notion = typeof r.notion === 'string' ? r.notion : typeof e.notion === 'string' ? e.notion : ''
    s.consultations.push({ outil: 'trouver_cours', sujet: notion, vide: r.aucun_resultat === true })
  }
}

/** demander_un_humain : « transmis faute de reponse » sauf si le membre demandait lui-meme l'equipe (tri de fin d'echange). */
export function noterHumain(s: SuiviLimites): void {
  s.humain = true
}

/** noter_limite : gardee pour le tri de fin d'echange, sujets distincts, au plus MAX_LIMITES_PAR_ECHANGE. */
export function noterLimite(s: SuiviLimites, l: LimiteNotee): void {
  if (s.limites.some(x => x.sujet === l.sujet) || s.limites.length >= MAX_LIMITES_PAR_ECHANGE) return
  s.limites.push(l)
}

/**
 * Le passage a l'equipe que le prompt du bot PREVOIT hors ignorance (le
 * membre veut parler a quelqu'un, un remboursement, une remise, une
 * reclamation, l'effacement de ses donnees, une adresse email a relier, une
 * facture, « on m'a promis », « Brice a valide ») : ce n'est pas une
 * ignorance de l'agent. Le reste des passages a l'equipe en est une.
 */
const RE_DEMANDE_HUMAIN = /rembours|r[ée]clam|plainte|litige|humain|quelqu.un|une (vraie )?personne|parler (a|à)|conseill[eè]re?|joindre|remise|r[ée]duc|promo|promis|valid[ée]|supprim|effac|oubli|rgpd|adresse|e-?mail|factur/i

export function demandeUnHumain(texteMembre: string): boolean {
  return RE_DEMANDE_HUMAIN.test(texteMembre)
}

/**
 * La reponse de l'agent porte un refus des regles d'information
 * (politique-information.ts : la formule de refus, ou la reponse des promos
 * qui suit toute question de code ou de tarif) : la demande touchait une
 * donnee que l'agent ne donne pas.
 */
export function estRefusPolitique(reponse: string): boolean {
  if (!reponse) return false
  return reponse.includes(FORMULE_REFUS) || reponse.includes(TEXTE_PROMOS.slice(0, 40))
}

/** Rien a trier dans cet echange (le cas courant) : ni limite, ni recherche vide, ni passage a l'equipe, ni echec. */
export function rienANoter(s: SuiviLimites): boolean {
  return !s.limites.length && !s.consultations.some(c => c.vide) && !s.humain && !s.echec
}

/** L'echange touche-t-il une donnee sensible ? Alors seulement le serveur demande si la personne est un admin. */
export function echangeSensible(s: SuiviLimites, reponse: string): boolean {
  return s.limites.some(l => l.categorie === 'donnee_sensible') || estRefusPolitique(reponse)
}

/**
 * La limite que le SERVEUR note lui-meme pour un admin quand la reponse porte
 * un refus des regles d'information et que l'agent n'a rien note (Haiku ne
 * pense pas toujours a l'outil quand il refuse) : « d'un admin = carte a
 * trier » ne depend pas du modele. Sujet fixe, aucun mot du message.
 */
export const LIMITE_REFUS_ADMIN: LimiteNotee = { sujet: 'Donnée refusée par le bot', categorie: 'donnee_sensible' }

/**
 * La limite que le SERVEUR note lui-meme quand le bot passe la main a l'equipe
 * faute de reponse (« transmis sans reponse ») et que l'agent n'a rien note :
 * « une demande ou l'IA ne sait pas, on le met dans a trier » ne depend pas
 * du modele (eval T3 du 06/11 : Haiku transmet sans appeler noter_limite).
 * Sujet fixe, aucun mot du message : une seule carte les recueille.
 */
export const LIMITE_SANS_REPONSE: LimiteNotee = { sujet: 'Question sans réponse du bot', categorie: 'info_manquante' }

export type SignalAEmettre = { cle: CleSignal; contexte: Contexte }
export type BilanLimites = { limites: LimiteNotee[]; signaux: SignalAEmettre[]; ecarte: 'prudence' | 'sensible' | null }

/**
 * LE TRI DE BRICE, applique par le serveur a la fin d'un echange.
 * - Message suspect : rien (ni limite ni signal avec contexte) ; seul l'echec
 *   de l'agent, sans contexte, reste un signal.
 * - Donnee sensible (categorie donnee_sensible, ou refus des regles
 *   d'information dans la reponse) d'une personne qui n'est PAS un admin :
 *   RIEN n'est enregistre, ni carte, ni demande, ni signal.
 * - Sinon (ignorance, action impossible, ou donnee sensible d'un admin) : les
 *   limites vont en carte « a_trier », et les signaux du serveur partent.
 *   Deux filets du serveur, sujet fixe, quand l'agent n'a rien note : le
 *   refus d'une donnee a un admin (LIMITE_REFUS_ADMIN), et le passage a
 *   l'equipe faute de reponse (LIMITE_SANS_REPONSE).
 * `admin` n'est lu que si l'echange est sensible (echangeSensible).
 */
export function triLimites(s: SuiviLimites, o: {
  bot: 'liveclub' | 'support'
  admin: boolean
  texteMembre: string
  reponse: string
  /** support : l'app du fil (contexte de site.info_absente). */
  app?: string
}): BilanLimites {
  if (s.prudence) {
    return { limites: [], signaux: s.echec && o.bot === 'liveclub' ? [{ cle: 'bot.agent_echec', contexte: {} }] : [], ecarte: 'prudence' }
  }
  if (echangeSensible(s, o.reponse) && !o.admin) return { limites: [], signaux: [], ecarte: 'sensible' }
  const limites = [...s.limites]
  if (o.admin && estRefusPolitique(o.reponse) && !limites.some(l => l.categorie === 'donnee_sensible')) limites.push(LIMITE_REFUS_ADMIN)
  const signaux: SignalAEmettre[] = []
  const vides = s.consultations.filter(c => c.vide)
  const derniereVide = vides[vides.length - 1]
  if (o.bot === 'liveclub') {
    if (derniereVide) signaux.push({ cle: 'bot.info_absente', contexte: contexteServeur('bot.info_absente', { sujet: derniereVide.sujet }) })
    if (s.humain && !demandeUnHumain(o.texteMembre)) {
      const derniere = s.consultations[s.consultations.length - 1]
      signaux.push({ cle: 'bot.transmis_sans_reponse', contexte: contexteServeur('bot.transmis_sans_reponse', { sujet: derniere?.sujet ?? '' }) })
      if (!limites.length) limites.push(LIMITE_SANS_REPONSE)
    }
    if (s.echec) signaux.push({ cle: 'bot.agent_echec', contexte: {} })
  } else if (derniereVide) {
    signaux.push({ cle: 'site.info_absente', contexte: contexteServeur('site.info_absente', { app: o.app ?? '', sujet: derniereVide.sujet }) })
  }
  return { limites, signaux, ecarte: null }
}
