// « Envoyer un diagnostic » du Carnet du Trader (1.8.14, brief C4 du 05/11/2026) :
// les regles pures de POST /api/carnet/diagnostic. Aucun import : teste par
// scripts/verifier-diagnostic-carnet.mjs (bornes, filtrage des champs,
// formatage, cadence), sans base ni Telegram.
//
// Brice, 05/11 : « il faut qu'il puisse remonter d'une maniere ou d'une autre
// ses data [...] pour vraiment le regler grace aux infos de sa machine ». Le
// membre envoie, a son geste, les infos de sa machine et le deroule du dernier
// envoi vers une IA ; jamais un contenu de note (le Carnet ne le met pas, et
// cette lecture ne garde que les champs nommes ici). L'equipe le recoit en un
// message Telegram compact (alerterEquipeTexte). Rien n'est stocke.

export const OCTETS_MAX_DIAGNOSTIC = 32 * 1024
export const DIAGNOSTICS_PAR_JOUR = 5
export const TEXTE_MAX_DIAGNOSTIC = 3500
const JOUR_MS = 86_400_000

const LIEUX = ['panneau', 'pleinEcran', 'guide', 'serviceWorker'] as const
const GENRES = ['erreur', 'rejet', 'rendu', 'toast'] as const
const FOURNISSEURS = ['chatgpt', 'claude', 'gemini', 'perplexity', 'grok', 'other'] as const
const VOIES = ['champ', 'champ-remplace', 'depot', 'collage'] as const
const MODES = ['prefill', 'injection', 'fil'] as const
const PAGES = ['nouvelle', 'conversation', 'autre'] as const

export type Taille = { l: number; h: number }

export type ErreurDiagnostic = {
  le: number
  ou: (typeof LIEUX)[number]
  genre: (typeof GENRES)[number]
  message: string
  source: string | null
  ligne: number | null
  colonne: number | null
  fois: number
}

export type VoieDiagnostic = { voie: (typeof VOIES)[number]; donne: boolean; vu: boolean; ms: number; erreur: boolean }

export type EnvoiDiagnostic = {
  le: number
  fournisseur: (typeof FOURNISSEURS)[number] | 'inconnu'
  mode: (typeof MODES)[number]
  page: (typeof PAGES)[number]
  projet: boolean
  fichiers: { pdf: number; autres: number }
  stabilite: { ms: number; atteinte: boolean } | null
  declencheurs: boolean | null
  champsVus: { id: string; accept: string }[]
  voies: VoieDiagnostic[]
  pdfUploaded: boolean
  pdfNonVu: boolean
  imageOnly: boolean
  promptFilled: boolean
  durees: { chargement: number | null; attente: number | null; injection: number | null; total: number | null }
  erreur: string | null
  repli: boolean
}

export type DiagnosticCarnet = {
  schema: 1
  genereLe: string | null
  carnet: {
    version: string
    langue: string | null
    theme: 'clair' | 'sombre' | 'systeme'
    sombre: boolean
    mouvementReduit: boolean
    reglages: {
      captureAuto: boolean
      captures: boolean
      captureGraphiqueTrade: boolean
      extraction: boolean
      metadonnees: boolean
      affichageSecours: boolean
      noterD: boolean
      syncCoupee: boolean
      fournisseurIA: (typeof FOURNISSEURS)[number] | null
      filsIA: string[]
    }
  }
  navigateur: {
    marques: { marque: string; version: string }[]
    brave: boolean
    plateforme: string | null
    versionPlateforme: string | null
    architecture: string | null
    bits: string | null
    mobile: boolean | null
    userAgent: string | null
  }
  gpu: { contexte: 'webgl2' | 'webgl' | 'absent'; vendeur: string | null; rendu: string | null; renduLogiciel: boolean }
  ecran: {
    dpr: number | null
    zoomEstime: number | null
    echelleSysteme: number | null
    zoomOnglet: number | null
    panneau: Taille | null
    fenetre: Taille | null
    ecran: Taille | null
    profondeur: number | null
  }
  compte: { connecte: boolean; email: string | null }
  erreurs: ErreurDiagnostic[]
  dernierEnvoiIA: EnvoiDiagnostic | null
}

// ---------------------------------------------------------------------------
// Lecture : schema valide, champs inconnus retires, chaque texte borne
// ---------------------------------------------------------------------------

// Controles, zero-largeur, separateurs de ligne, marques de direction, BOM :
// construits par leurs codes, le source reste en ASCII.
const car = (n: number) => String.fromCharCode(n)
const plage = (a: number, b: number) => `${car(a)}-${car(b)}`
const INVISIBLES = new RegExp(`[${plage(0x00, 0x1f)}${plage(0x7f, 0x9f)}${plage(0x200b, 0x200f)}${plage(0x2028, 0x202e)}${plage(0x2060, 0x2064)}${car(0xfeff)}]`, 'g')

type Objet = Record<string, unknown>
const objet = (v: unknown): Objet | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Objet : null)
const vrai = (v: unknown) => v === true

/** Un texte sur une ligne, sans caractere invisible, borne ; null si vide. */
export function texteBorne(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(INVISIBLES, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max - 3)}...` : s
}

function entier(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null
}

function decimal(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 1000) / 1000 : null
}

function duree(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 3_600_000) : null
}

/** Un instant plausible (apres 2024, au plus un jour dans le futur), sinon null. */
function instant(v: unknown, maintenant: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > Date.UTC(2024, 0, 1) && v < maintenant + JOUR_MS ? Math.round(v) : null
}

function parmi<T extends string>(v: unknown, liste: readonly T[]): T | null {
  return typeof v === 'string' && (liste as readonly string[]).includes(v) ? v as T : null
}

function taille(v: unknown): Taille | null {
  const t = objet(v)
  const l = entier(t?.l, 100_000)
  const h = entier(t?.h, 100_000)
  return l === null || h === null ? null : { l, h }
}

const RENDU_LOGICIEL = /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|basic render driver|software (?:rasterizer|renderer)/i

/** Rendu logiciel (pas de vraie carte graphique, ou pilote absent), relu ici sans croire le Carnet sur parole. */
export function renduLogiciel(...textes: (string | null | undefined)[]): boolean {
  return textes.some(t => typeof t === 'string' && RENDU_LOGICIEL.test(t))
}

function lireErreur(v: unknown, maintenant: number): ErreurDiagnostic | null {
  const e = objet(v)
  if (!e) return null
  const le = instant(e.le, maintenant)
  const ou = parmi(e.ou, LIEUX)
  const genre = parmi(e.genre, GENRES)
  const message = genre === 'toast'
    ? (typeof e.message === 'string' && /^[\w.-]{1,60}$/.test(e.message) ? e.message : 'hors-dictionnaire')
    : texteBorne(e.message, 200)
  if (le === null || !ou || !genre || !message) return null
  const source = typeof e.source === 'string' && /^[\w./@<>-]{1,160}$/.test(e.source) ? e.source : null
  return { le, ou, genre, message, source, ligne: entier(e.ligne, 10_000_000), colonne: entier(e.colonne, 10_000_000), fois: entier(e.fois, 99_999) ?? 1 }
}

function lireEnvoi(v: unknown, maintenant: number): EnvoiDiagnostic | null {
  const t = objet(v)
  if (!t) return null
  const le = instant(t.le, maintenant)
  if (le === null) return null
  const fichiers = objet(t.fichiers)
  const stabilite = objet(t.stabilite)
  const durees = objet(t.durees)
  const champsVus = (Array.isArray(t.champsVus) ? t.champsVus : []).slice(0, 8).flatMap(c => {
    const x = objet(c)
    if (!x) return []
    const id = typeof x.id === 'string' && /^[\w:.-]{0,60}$/.test(x.id) ? x.id : ''
    const accept = (texteBorne(x.accept, 120) ?? '').replace(/[^\w/.*,+ -]/g, '')
    return [{ id, accept }]
  })
  const voies = (Array.isArray(t.voies) ? t.voies : []).slice(0, 8).flatMap(c => {
    const x = objet(c)
    const voie = parmi(x?.voie, VOIES)
    if (!x || !voie) return []
    return [{ voie, donne: vrai(x.donne), vu: vrai(x.vu), ms: duree(x.ms) ?? 0, erreur: vrai(x.erreur) }]
  })
  return {
    le,
    fournisseur: parmi(t.fournisseur, FOURNISSEURS) ?? 'inconnu',
    mode: parmi(t.mode, MODES) ?? 'injection',
    page: parmi(t.page, PAGES) ?? 'autre',
    projet: vrai(t.projet),
    fichiers: { pdf: entier(fichiers?.pdf, 20) ?? 0, autres: entier(fichiers?.autres, 20) ?? 0 },
    stabilite: stabilite && duree(stabilite.ms) !== null ? { ms: duree(stabilite.ms) as number, atteinte: vrai(stabilite.atteinte) } : null,
    declencheurs: typeof t.declencheurs === 'boolean' ? t.declencheurs : null,
    champsVus,
    voies,
    pdfUploaded: vrai(t.pdfUploaded),
    pdfNonVu: vrai(t.pdfNonVu),
    imageOnly: vrai(t.imageOnly),
    promptFilled: vrai(t.promptFilled),
    durees: { chargement: duree(durees?.chargement), attente: duree(durees?.attente), injection: duree(durees?.injection), total: duree(durees?.total) },
    erreur: typeof t.erreur === 'string' && /^[\w-]{1,40}$/.test(t.erreur) ? t.erreur : null,
    repli: vrai(t.repli),
  }
}

/**
 * Le diagnostic tel que la route le garde : seulement les champs nommes ici,
 * chacun type et borne. Refuse un corps qui n'est pas un diagnostic du Carnet
 * (schema 1, version du Carnet lisible).
 */
export function lireDiagnostic(brut: unknown, maintenant = Date.now()): { ok: true; diagnostic: DiagnosticCarnet } | { ok: false; erreur: string } {
  const d = objet(brut)
  if (!d || d.schema !== 1) return { ok: false, erreur: 'Diagnostic illisible (schema).' }
  const carnet = objet(d.carnet)
  const version = typeof carnet?.version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(carnet.version) ? carnet.version : null
  if (!carnet || !version) return { ok: false, erreur: 'Diagnostic illisible (version du Carnet).' }
  const r = objet(carnet.reglages) ?? {}
  const nav = objet(d.navigateur) ?? {}
  const gpu = objet(d.gpu) ?? {}
  const ecran = objet(d.ecran) ?? {}
  const compte = objet(d.compte) ?? {}
  const vendeur = texteBorne(gpu.vendeur, 200)
  const rendu = texteBorne(gpu.rendu, 300)
  const genere = typeof d.genereLe === 'string' && !Number.isNaN(Date.parse(d.genereLe)) ? new Date(Date.parse(d.genereLe)).toISOString() : null
  const marques = (Array.isArray(nav.marques) ? nav.marques : []).slice(0, 6).flatMap(m => {
    const x = objet(m)
    const marque = texteBorne(x?.marque, 60)
    return marque ? [{ marque, version: texteBorne(x?.version, 40) ?? '' }] : []
  })
  const erreurs = (Array.isArray(d.erreurs) ? d.erreurs : []).slice(-30)
    .map(e => lireErreur(e, maintenant))
    .filter((e): e is ErreurDiagnostic => e !== null)
  return {
    ok: true,
    diagnostic: {
      schema: 1,
      genereLe: genere,
      carnet: {
        version,
        langue: typeof carnet.langue === 'string' && /^[a-z]{2}$/.test(carnet.langue) ? carnet.langue : null,
        theme: parmi(carnet.theme, ['clair', 'sombre', 'systeme'] as const) ?? 'systeme',
        sombre: vrai(carnet.sombre),
        mouvementReduit: vrai(carnet.mouvementReduit),
        reglages: {
          captureAuto: vrai(r.captureAuto),
          captures: vrai(r.captures),
          captureGraphiqueTrade: vrai(r.captureGraphiqueTrade),
          extraction: vrai(r.extraction),
          metadonnees: vrai(r.metadonnees),
          affichageSecours: vrai(r.affichageSecours),
          noterD: vrai(r.noterD),
          syncCoupee: vrai(r.syncCoupee),
          fournisseurIA: parmi(r.fournisseurIA, FOURNISSEURS),
          filsIA: (Array.isArray(r.filsIA) ? r.filsIA : []).filter((f): f is string => parmi(f, FOURNISSEURS) !== null).slice(0, 6),
        },
      },
      navigateur: {
        marques,
        brave: vrai(nav.brave),
        plateforme: texteBorne(nav.plateforme, 40),
        versionPlateforme: texteBorne(nav.versionPlateforme, 40),
        architecture: texteBorne(nav.architecture, 20),
        bits: texteBorne(nav.bits, 10),
        mobile: typeof nav.mobile === 'boolean' ? nav.mobile : null,
        userAgent: texteBorne(nav.userAgent, 300),
      },
      gpu: {
        contexte: parmi(gpu.contexte, ['webgl2', 'webgl', 'absent'] as const) ?? 'absent',
        vendeur,
        rendu,
        renduLogiciel: vrai(gpu.renduLogiciel) || renduLogiciel(vendeur, rendu),
      },
      ecran: {
        dpr: decimal(ecran.dpr, 20),
        zoomEstime: decimal(ecran.zoomEstime, 10),
        echelleSysteme: decimal(ecran.echelleSysteme, 10),
        zoomOnglet: decimal(ecran.zoomOnglet, 10),
        panneau: taille(ecran.panneau),
        fenetre: taille(ecran.fenetre),
        ecran: taille(ecran.ecran),
        profondeur: entier(ecran.profondeur, 64),
      },
      compte: { connecte: vrai(compte.connecte), email: texteBorne(compte.email, 200) },
      erreurs,
      dernierEnvoiIA: lireEnvoi(d.dernierEnvoiIA, maintenant),
    },
  }
}

/**
 * Les textes libres du diagnostic (ecrits par le navigateur du membre, donc
 * forgeables) : la route les passe a l'analyse d'injection avant que le
 * message n'entre dans l'historique d'Agent AOK.
 */
export function champsLibres(d: DiagnosticCarnet): string[] {
  return [
    ...d.navigateur.marques.flatMap(m => [m.marque, m.version]),
    d.navigateur.plateforme, d.navigateur.versionPlateforme, d.navigateur.architecture, d.navigateur.bits, d.navigateur.userAgent,
    d.gpu.vendeur, d.gpu.rendu, d.compte.email,
    ...d.erreurs.flatMap(e => [e.message, e.source]),
    ...(d.dernierEnvoiIA?.champsVus ?? []).flatMap(c => [c.id, c.accept]),
  ].filter((s): s is string => typeof s === 'string' && s.length > 0)
}

// ---------------------------------------------------------------------------
// Le message a l'equipe
// ---------------------------------------------------------------------------

const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** « 05/11 20:14 », heure de Paris, en caracteres simples. */
export function heureCourte(ms: number): string {
  const p = Object.fromEntries(FORMAT_HEURE.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`
}

const secondes = (ms: number | null) => (ms === null ? '?' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`)
const ouiNon = (b: boolean) => (b ? 'oui' : 'non')
const pourcent = (z: number | null) => (z === null ? '?' : `${Math.round(z * 100)} %`)
const dim = (t: Taille | null) => (t ? `${t.l} x ${t.h}` : '?')

const LIEU: Record<ErreurDiagnostic['ou'], string> = { panneau: 'panneau', pleinEcran: 'plein écran', guide: 'Guide', serviceWorker: 'service worker' }
const PAGE: Record<EnvoiDiagnostic['page'], string> = { nouvelle: 'nouvelle conversation', conversation: 'conversation existante', autre: 'autre page' }
const MODE: Record<EnvoiDiagnostic['mode'], string> = { prefill: 'texte dans l\'adresse', injection: 'injection', fil: 'conversation choisie' }
const THEME: Record<DiagnosticCarnet['carnet']['theme'], string> = { clair: 'clair', sombre: 'sombre', systeme: 'système' }

function ligneErreur(e: ErreurDiagnostic, maxMessage: number): string {
  const ou = e.source ? ` (${e.source}${e.ligne !== null ? `:${e.ligne}` : ''})` : ''
  const message = e.message.length > maxMessage ? `${e.message.slice(0, maxMessage - 3)}...` : e.message
  return `- ${heureCourte(e.le)}, ${LIEU[e.ou]}, ${e.genre} : ${message}${ou}${e.fois > 1 ? ` x${e.fois}` : ''}`
}

function lignesEnvoi(e: EnvoiDiagnostic): string[] {
  const fichiers = e.fichiers.pdf + e.fichiers.autres === 0 ? 'sans fichier'
    : `${e.fichiers.pdf} PDF${e.fichiers.autres ? ` + ${e.fichiers.autres} autre${e.fichiers.autres > 1 ? 's' : ''}` : ''}`
  const issue = e.fichiers.pdf + e.fichiers.autres === 0 ? 'rien à joindre'
    : e.pdfUploaded ? 'PDF arrivé' : e.imageOnly ? 'images seulement (sans compte ?)' : e.pdfNonVu ? 'PDF NON VU' : 'PDF non joint'
  const champs = e.champsVus.length === 0 ? 'aucun'
    : e.champsVus.map(c => `${c.id ? `#${c.id}` : '(sans id)'} [${c.accept || 'tout'}]`).join(', ')
  const voies = e.voies.length === 0 ? 'aucune'
    : e.voies.map(v => `${v.voie} ${v.erreur ? 'en erreur' : v.donne ? `donné, ${v.vu ? 'vu' : 'non vu'}` : 'non donné'} (${secondes(v.ms)})`).join(' ; ')
  return [
    `Dernier envoi IA (${heureCourte(e.le)}) : ${e.fournisseur}, ${PAGE[e.page]}${e.projet ? ' (projet)' : ''}, ${MODE[e.mode]}, ${fichiers}${e.repli ? ', reparti sur une nouvelle conversation' : ''}${e.erreur ? `, échec : ${e.erreur}` : ''}`,
    `- résultat : ${issue} (pdfUploaded ${ouiNon(e.pdfUploaded)}, pdfNonVu ${ouiNon(e.pdfNonVu)}, imageOnly ${ouiNon(e.imageOnly)}), prompt rempli ${ouiNon(e.promptFilled)}`,
    `- stabilité : ${e.stabilite ? `${secondes(e.stabilite.ms)} (${e.stabilite.atteinte ? 'atteinte' : 'NON atteinte, 20 s écoulées'})` : '?'}${e.declencheurs === null ? '' : `, boutons d'ajout ${e.declencheurs ? 'cliqués' : 'introuvables'}`}`,
    `- champs vus : ${champs}`,
    `- voies : ${voies}`,
    `- durées : chargement ${secondes(e.durees.chargement)}, attente ${secondes(e.durees.attente)}, injection ${secondes(e.durees.injection)}, total ${secondes(e.durees.total)}`,
  ]
}

/**
 * Le message Telegram a l'equipe, compact, `max` caracteres au plus (3500 par
 * defaut). `qui` : l'email du compte tel que la base le connait (jamais celui
 * que le Carnet ecrit, qui n'est que rappele s'il differe).
 */
export function texteDiagnostic(d: DiagnosticCarnet, qui: string, max = TEXTE_MAX_DIAGNOSTIC): string {
  const n = d.navigateur
  const marque = n.marques.find(m => !/chromium/i.test(m.marque)) ?? n.marques[0]
  const navigateur = [
    marque ? `${marque.marque} ${marque.version}`.trim() : (n.userAgent ?? 'inconnu'),
    n.brave && !/brave/i.test(marque?.marque ?? '') ? 'Brave' : null,
    [n.plateforme, n.versionPlateforme].filter(Boolean).join(' ') || null,
    n.architecture ? `${n.architecture}${n.bits ? ` ${n.bits} bits` : ''}` : null,
    n.mobile ? 'mobile' : null,
  ].filter(Boolean).join(', ')
  const autres = n.marques.filter(m => m !== marque && !/chromium/i.test(m.marque)).map(m => m.marque)
  const g = d.gpu
  const carte = g.rendu ?? g.vendeur ?? 'non lue'
  const e = d.ecran
  const r = d.carnet.reglages
  const emailCarnet = d.compte.email && d.compte.email.toLowerCase() !== qui.toLowerCase() ? ` (le Carnet affiche ${d.compte.email})` : ''
  const recentes = [...d.erreurs].sort((a, b) => b.le - a.le).slice(0, 5)

  const construire = (maxMessage: number) => [
    'Diagnostic du Carnet, envoyé par le membre',
    `Qui : ${qui}${emailCarnet}`,
    `Carnet ${d.carnet.version} (${d.carnet.langue ?? '?'}), thème ${THEME[d.carnet.theme]}${d.carnet.theme === 'systeme' ? ` (${d.carnet.sombre ? 'sombre' : 'clair'})` : ''}, mouvement réduit ${ouiNon(d.carnet.mouvementReduit)}`,
    `Navigateur : ${navigateur}${autres.length ? ` (aussi : ${autres.join(', ')})` : ''}`,
    `Carte graphique : ${carte}${g.rendu && g.vendeur && !g.rendu.includes(g.vendeur) ? ` [${g.vendeur}]` : ''}, ${g.renduLogiciel ? 'RENDU LOGICIEL' : 'rendu matériel'}, ${g.contexte}`,
    `Écran : zoom estimé ${pourcent(e.zoomEstime)}${e.echelleSysteme ? ` (échelle système ${pourcent(e.echelleSysteme)})` : ''}, dpr ${e.dpr ?? '?'}, zoom de l'onglet ${pourcent(e.zoomOnglet)}, panneau ${dim(e.panneau)}, fenêtre ${dim(e.fenetre)}, écran ${dim(e.ecran)}`,
    `Affichage de secours : ${r.affichageSecours ? 'ACTIVÉ' : 'désactivé'}`,
    `Réglages : capture auto ${ouiNon(r.captureAuto)}, captures ${ouiNon(r.captures)}, graphique au trade ${ouiNon(r.captureGraphiqueTrade)}, sync coupée ${ouiNon(r.syncCoupee)}, IA par défaut ${r.fournisseurIA ?? 'aucune'}${r.filsIA.length ? `, conversation choisie : ${r.filsIA.join(', ')}` : ''}`,
    recentes.length === 0 ? 'Erreurs : aucune' : `Erreurs (${recentes.length} plus récente${recentes.length > 1 ? 's' : ''} sur ${d.erreurs.length}) :`,
    ...recentes.map(x => ligneErreur(x, maxMessage)),
    ...(d.dernierEnvoiIA ? lignesEnvoi(d.dernierEnvoiIA) : ['Dernier envoi IA : aucun']),
  ].join('\n')

  let texte = construire(180)
  if (texte.length > max) texte = construire(80)
  return texte.length > max ? `${texte.slice(0, max - 3)}...` : texte
}

// ---------------------------------------------------------------------------
// Cadence : 5 diagnostics par jour et par compte
// ---------------------------------------------------------------------------

/**
 * `envois` : les instants des diagnostics deja transmis pour ce compte. 24 h
 * glissantes. `reessayerDansMs` : quand le plus ancien sort de la fenetre.
 */
export function cadenceDiagnostic(envois: readonly number[], maintenant: number, limite = DIAGNOSTICS_PAR_JOUR): {
  autorise: boolean; restants: number; recents: number[]; reessayerDansMs: number
} {
  const recents = envois.filter(t => typeof t === 'number' && t <= maintenant && maintenant - t < JOUR_MS).sort((a, b) => a - b)
  const autorise = recents.length < limite
  return {
    autorise,
    restants: Math.max(0, limite - recents.length),
    recents,
    reessayerDansMs: autorise ? 0 : recents[recents.length - limite] + JOUR_MS - maintenant,
  }
}
