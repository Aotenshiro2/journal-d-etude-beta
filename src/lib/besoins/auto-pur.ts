// LES BESOINS DES MEMBRES, LA ROUTE AUTOMATIQUE DU TRI (10/11/2026) : les
// regles pures de POST /api/cockpit/besoins/auto.
//
// Brice, 10/11 : le tri du soir des besoins par un agent (tache planifiee
// « tri-besoins-du-soir »), qui peut prevenir les membres en passant une carte
// en livre ou en refuse. La route est appelee de serveur a serveur, sans
// session : un jeton dedie (BESOINS_AUTO_TOKEN), compare en temps constant.
//
// - Quatre actions, et RIEN d'autre : lire (les cartes a_trier, leurs demandes
//   et leurs signaux), statut (planifie, en_cours, livre, refuse, avec
//   note_equipe et raison_refus ; le brief d'une carte planifiee est ecrit par
//   le serveur et rendu), fusionner, prevenir.
// - Les gestes REUTILISENT ceux du cockpit (cockpit.ts : changerStatut,
//   modifierBesoin, fusionnerBesoins, apercuPrevenir, prevenirMembres) et la
//   lecture de l'API de Tab (tab.ts). prevenir envoie le message de l'apercu
//   (messageParDefaut, celui que le bouton « Prevenir » propose), aux memes
//   destinataires, et un membre deja prevenu ne l'est pas deux fois (la
//   reservation de prevenirMembres).
// - Garde-fous : 20 cartes et 30 messages par appel au plus ; chaque geste
//   trace dans besoin_geste (par = tri automatique, quand, quoi) AVANT de
//   rendre la reponse, et aucun geste si la table manque (503) ; essai = a
//   blanc (rien d'ecrit, rien d'envoye, le geste trace « simule »).
// - Aucune donnee personnelle dans les logs ni dans la trace (des nombres),
//   et la reponse de prevenir ne rend ni nom ni adresse.
//
// Ce fichier n'importe ni la base ni le reseau : executerAuto recoit ses
// depots (auto.ts pour les vrais, scripts/verifier-besoins-auto.mjs pour les
// faux).

import { createHash, timingSafeEqual } from 'node:crypto'
import { lireId, texteEquipe } from './cockpit-pur'

export const ACTEUR_AUTO = 'tri automatique'
export const MIGRATION_GESTES = '20261110190000'
export const ACTIONS_AUTO = ['lire', 'statut', 'fusionner', 'prevenir'] as const
export type ActionAuto = typeof ACTIONS_AUTO[number]
export const STATUTS_AUTO = ['planifie', 'en_cours', 'livre', 'refuse'] as const
export type StatutAuto = typeof STATUTS_AUTO[number]

export const MAX_CARTES_AUTO = 20
export const MAX_MESSAGES_AUTO = 30
/** Envois tentes par la route sur 24 h glissantes (lus dans besoin_geste) : un agent en boucle s'arrete la. */
export const MAX_MESSAGES_JOUR = 100
/** raison_refus part aux membres dans le message : courte, sans lien, adresse, balise ni gabarit. */
export const RAISON_MAX = 300

/**
 * Les passages permis a l'agent : vers l'avant seulement. Une carte livree ou
 * refusee ne bouge plus (c'est la main de Brice), une carte planifiee ne se
 * replanifie pas (le brief et son envoi a Sora seraient reecrits).
 */
export const PASSAGES_AUTO: Readonly<Record<string, readonly StatutAuto[]>> = {
  a_trier: ['planifie', 'en_cours', 'livre', 'refuse'],
  planifie: ['en_cours', 'livre', 'refuse'],
  en_cours: ['livre', 'refuse'],
}

export function passagePermis(de: string, vers: StatutAuto): boolean {
  return (PASSAGES_AUTO[de] ?? []).includes(vers)
}

const RE_RAISON_INTERDITE = /https?:|www\.|[@<>{}[\]\\]|\b[a-z0-9-]+\.[a-z]{2,6}\/|\b[a-z0-9-]+\.(com|fr|net|org|io|co|me|ly|gg|app|link|xyz|be|ch|ru|info|biz)\b/i

/** Une raison de refus qu'un membre peut recevoir telle quelle, ou null. */
export function raisonPermise(v: unknown): string | null {
  const t = texteEquipe(v, RAISON_MAX + 1)
  if (!t || t.length > RAISON_MAX || RE_RAISON_INTERDITE.test(t)) return null
  return t
}
/** Les demandes rendues par carte a la lecture (les plus recentes). */
export const DEMANDES_PAR_CARTE = 50
/** Un jeton plus court est tenu pour absent : tout est refuse. */
export const JETON_MIN = 32
export const CORPS_MAX_OCTETS = 64_000

// ---------------------------------------------------------------------------
// Le jeton
// ---------------------------------------------------------------------------

/**
 * L'en-tete Authorization est-il « Bearer <secret> » ? Les deux cotes sont
 * haches avant la comparaison en temps constant : ni la longueur ni le contenu
 * ne fuient par le temps de reponse. Secret absent ou trop court : non.
 */
export function jetonValide(entete: string | null | undefined, secret: string | null | undefined): boolean {
  const s = secret?.trim()
  if (!s || s.length < JETON_MIN) return false
  const recu = createHash('sha256').update(entete ?? '', 'utf8').digest()
  const attendu = createHash('sha256').update(`Bearer ${s}`, 'utf8').digest()
  return timingSafeEqual(recu, attendu)
}

// ---------------------------------------------------------------------------
// Le corps
// ---------------------------------------------------------------------------

export type ItemStatut = { id: string; statut: StatutAuto; noteEquipe: string | null; raison: string | null }
export type CommandeAuto =
  | { action: 'lire'; essai: boolean }
  | { action: 'statut'; essai: boolean; cartes: ItemStatut[] }
  | { action: 'fusionner'; essai: boolean; fusions: { sourceId: string; cibleId: string }[] }
  | { action: 'prevenir'; essai: boolean; ids: string[] }
export type ErreurAuto = { erreur: string; status: number }

const CLES_PERMISES: Record<ActionAuto, readonly string[]> = {
  lire: ['action', 'essai'],
  statut: ['action', 'essai', 'cartes'],
  fusionner: ['action', 'essai', 'fusions'],
  prevenir: ['action', 'essai', 'ids'],
}
const CLES_STATUT = ['id', 'statut', 'note_equipe', 'raison_refus']
const CLES_FUSION = ['sourceId', 'cibleId']

const objet = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

function liste(v: unknown, nom: string): unknown[] | ErreurAuto {
  if (!Array.isArray(v) || v.length === 0) return { erreur: `${nom} : une liste non vide.`, status: 400 }
  if (v.length > MAX_CARTES_AUTO) return { erreur: `${nom} : ${MAX_CARTES_AUTO} cartes au plus par appel.`, status: 400 }
  return v
}

/**
 * Le corps de la route. Toute action hors des quatre, toute cle inconnue, toute
 * liste vide ou de plus de 20 cartes, tout id qui n'est pas un uuid : refuse (400).
 */
export function lireCommandeAuto(corps: unknown): CommandeAuto | ErreurAuto {
  const c = objet(corps)
  if (!c) return { erreur: 'Corps JSON attendu.', status: 400 }
  const action = typeof c.action === 'string' ? c.action : ''
  if (!(ACTIONS_AUTO as readonly string[]).includes(action)) {
    return { erreur: `action : ${ACTIONS_AUTO.join(', ')}. Toute autre action est refusée.`, status: 400 }
  }
  const a = action as ActionAuto
  const inconnue = Object.keys(c).find(k => !CLES_PERMISES[a].includes(k))
  if (inconnue) return { erreur: `Clé non permise pour ${a} : ${inconnue.slice(0, 40)}.`, status: 400 }
  if (c.essai !== undefined && typeof c.essai !== 'boolean') return { erreur: 'essai : true ou false.', status: 400 }
  const essai = c.essai === true

  if (a === 'lire') return { action: 'lire', essai }

  if (a === 'statut') {
    const l = liste(c.cartes, 'cartes')
    if (!Array.isArray(l)) return l
    const cartes: ItemStatut[] = []
    for (const brut of l) {
      const x = objet(brut)
      if (!x) return { erreur: 'cartes : des objets { id, statut, note_equipe?, raison_refus? }.', status: 400 }
      const k = Object.keys(x).find(k => !CLES_STATUT.includes(k))
      if (k) return { erreur: `Clé non permise dans cartes : ${k.slice(0, 40)}.`, status: 400 }
      const id = lireId(x.id)
      if (!id) return { erreur: 'cartes : id requis (uuid).', status: 400 }
      if (cartes.some(y => y.id === id)) return { erreur: 'cartes : une carte en double.', status: 400 }
      const statut = typeof x.statut === 'string' && (STATUTS_AUTO as readonly string[]).includes(x.statut) ? (x.statut as StatutAuto) : null
      if (!statut) return { erreur: `statut : ${STATUTS_AUTO.join(', ')}.`, status: 400 }
      let noteEquipe: string | null = null
      if (x.note_equipe !== undefined) {
        noteEquipe = texteEquipe(x.note_equipe, 2000)
        if (!noteEquipe) return { erreur: 'note_equipe : un texte non vide (2 000 caractères au plus).', status: 400 }
      }
      let raison: string | null = null
      if (x.raison_refus !== undefined) {
        if (statut !== 'refuse') return { erreur: 'raison_refus : seulement avec le statut refuse.', status: 400 }
        raison = raisonPermise(x.raison_refus)
        if (!raison) return { erreur: `raison_refus : un texte non vide de ${RAISON_MAX} caractères au plus, sans lien, adresse, @, balise ni accolade (il part aux membres).`, status: 400 }
      }
      cartes.push({ id, statut, noteEquipe, raison })
    }
    return { action: 'statut', essai, cartes }
  }

  if (a === 'fusionner') {
    const l = liste(c.fusions, 'fusions')
    if (!Array.isArray(l)) return l
    const fusions: { sourceId: string; cibleId: string }[] = []
    for (const brut of l) {
      const x = objet(brut)
      if (!x) return { erreur: 'fusions : des objets { sourceId, cibleId }.', status: 400 }
      const k = Object.keys(x).find(k => !CLES_FUSION.includes(k))
      if (k) return { erreur: `Clé non permise dans fusions : ${k.slice(0, 40)}.`, status: 400 }
      const sourceId = lireId(x.sourceId)
      const cibleId = lireId(x.cibleId)
      if (!sourceId || !cibleId) return { erreur: 'fusions : sourceId et cibleId requis (uuid).', status: 400 }
      if (sourceId === cibleId) return { erreur: 'fusions : une carte ne se fusionne pas dans elle-même.', status: 400 }
      if (fusions.some(f => f.sourceId === sourceId)) return { erreur: 'fusions : une source en double.', status: 400 }
      fusions.push({ sourceId, cibleId })
    }
    return { action: 'fusionner', essai, fusions }
  }

  const l = liste(c.ids, 'ids')
  if (!Array.isArray(l)) return l
  const ids: string[] = []
  for (const brut of l) {
    const id = lireId(brut)
    if (!id) return { erreur: 'ids : des uuid de cartes.', status: 400 }
    if (ids.includes(id)) return { erreur: 'ids : une carte en double.', status: 400 }
    ids.push(id)
  }
  return { action: 'prevenir', essai, ids }
}

// ---------------------------------------------------------------------------
// L'execution
// ---------------------------------------------------------------------------

export type ReponseAuto = { status: number; corps: Record<string, unknown> }
export type ResultatGeste = 'fait' | 'refuse' | 'echec' | 'simule'
/** Une ligne de besoin_geste : des nombres et des statuts, jamais une donnee de membre. */
export type GesteAuto = {
  action: ActionAuto
  carteId: string | null
  resultat: ResultatGeste
  details: Record<string, string | number | boolean | null>
}

export type DepotsAuto = {
  /** besoin_geste existe-t-elle ? (false = migration absente ; une panne leve) */
  tracesPresentes(): Promise<boolean>
  tracer(g: GesteAuto): Promise<void>
  /** Les cartes a_trier (max), chacune avec ses demandes et ses signaux ; plus = il en reste au-dela. */
  lire(max: number): Promise<{ cartes: Record<string, unknown>[]; plus: boolean; notes: string[] }>
  /** Le statut d'une carte et si elle est fusionnee ; null = introuvable. */
  etatCarte(id: string): Promise<{ statut: string; fusionnee: boolean } | null>
  /** Les envois tentes par la route sur les dernieres 24 h (besoin_geste). */
  tentativesDuJour(): Promise<number>
  modifierNote(id: string, note: string): Promise<ReponseAuto>
  changerStatut(id: string, statut: StatutAuto, raison: string | null): Promise<ReponseAuto>
  fusionner(sourceId: string, cibleId: string): Promise<ReponseAuto>
  apercu(id: string): Promise<ReponseAuto>
  prevenir(id: string, message: string, budgetMs: number, maxEnvois: number): Promise<ReponseAuto>
  maintenant(): number
}

export function resultatDe(status: number): ResultatGeste {
  return status < 300 ? 'fait' : status < 500 ? 'refuse' : 'echec'
}

const nombre = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const texteErreur = (r: ReponseAuto): string => (typeof r.corps.error === 'string' ? r.corps.error : `statut ${r.status}`)

/**
 * La reponse de prevenirMembres, sans nom ni adresse : des comptes, et pour
 * chaque echec ou envoi « a la main » l'id de la demande et le canal.
 */
export function resumePrevenir(r: ReponseAuto): {
  envoyes: number; echecs: number; aLaMain: number; restants: number; tentatives: number
  echecsDetail: { demandeId: string; canal: string; raison: string }[]; aLaMainDetail: { demandeId: string }[]
} {
  const c = r.corps
  const details = objet(c.details) ?? {}
  const echecs = Array.isArray(details.echecs) ? details.echecs : []
  const aLaMain = Array.isArray(details.aLaMain) ? details.aLaMain : []
  return {
    envoyes: nombre(c.envoyes), echecs: nombre(c.echecs), aLaMain: nombre(c.aLaMain), restants: nombre(c.restants), tentatives: nombre(c.tentatives),
    echecsDetail: echecs.map(e => objet(e) ?? {}).map(e => ({ demandeId: String(e.demandeId ?? ''), canal: String(e.canal ?? ''), raison: String(e.raison ?? '').slice(0, 80) })),
    aLaMainDetail: aLaMain.map(e => objet(e) ?? {}).map(e => ({ demandeId: String(e.demandeId ?? '') })),
  }
}

/**
 * Execute une commande deja lue. Aucun geste sans trace : la table absente,
 * rien ne se fait (503). Une trace qui echoue apres le geste est comptee dans
 * la reponse (traces.echec), le geste n'est pas defait.
 */
export async function executerAuto(cmd: CommandeAuto, d: DepotsAuto, budgetMs: number): Promise<ReponseAuto> {
  const debut = d.maintenant()
  if (!(await d.tracesPresentes())) {
    return { status: 503, corps: { error: `Le journal des gestes n'est pas en base (migration ${MIGRATION_GESTES} à appliquer) : aucune action sans trace.` } }
  }
  const traces = { ok: 0, echec: 0 }
  const tracer = async (g: GesteAuto) => {
    try {
      await d.tracer(g)
      traces.ok++
    } catch {
      traces.echec++
    }
  }

  if (cmd.action === 'lire') {
    const l = await d.lire(MAX_CARTES_AUTO)
    await tracer({ action: 'lire', carteId: null, resultat: cmd.essai ? 'simule' : 'fait', details: { cartes: l.cartes.length, plus: l.plus } })
    return { status: 200, corps: { ok: true, action: 'lire', cartes: l.cartes, plus: l.plus, notes: l.notes, traces } }
  }

  if (cmd.action === 'statut') {
    const resultats: Record<string, unknown>[] = []
    for (const c of cmd.cartes) {
      const details = { statut: c.statut, note: c.noteEquipe !== null, raison: c.raison !== null }
      const e = await d.etatCarte(c.id)
      const refus = !e ? { status: 404, error: 'Carte introuvable.' }
        : e.fusionnee ? { status: 400, error: 'Cette carte est fusionnée dans une autre : change le statut de la carte qui la remplace.' }
          : !passagePermis(e.statut, c.statut) ? { status: 409, error: `Passage ${e.statut} vers ${c.statut} réservé au cockpit.` } : null
      if (refus) {
        resultats.push({ id: c.id, ...refus })
        await tracer({ action: 'statut', carteId: e ? c.id : null, resultat: 'refuse', details: { ...details, de: e?.statut ?? null, status: refus.status } })
        continue
      }
      if (cmd.essai) {
        resultats.push({ id: c.id, simule: true, de: e?.statut ?? null, ...details })
        await tracer({ action: 'statut', carteId: c.id, resultat: 'simule', details })
        continue
      }
      if (c.noteEquipe !== null) {
        const n = await d.modifierNote(c.id, c.noteEquipe)
        if (n.status !== 200) {
          resultats.push({ id: c.id, status: n.status, error: texteErreur(n) })
          await tracer({ action: 'statut', carteId: c.id, resultat: resultatDe(n.status), details: { ...details, etape: 'note', status: n.status } })
          continue
        }
      }
      const r = await d.changerStatut(c.id, c.statut, c.raison)
      resultats.push(r.status === 200
        ? { id: c.id, status: 200, ok: true, statut: c.statut, ...(typeof r.corps.brief === 'string' ? { brief: r.corps.brief } : {}) }
        : { id: c.id, status: r.status, error: texteErreur(r) })
      await tracer({ action: 'statut', carteId: c.id, resultat: resultatDe(r.status), details: { ...details, status: r.status } })
    }
    return { status: 200, corps: { ok: true, action: 'statut', essai: cmd.essai, resultats, traces } }
  }

  if (cmd.action === 'fusionner') {
    const resultats: Record<string, unknown>[] = []
    for (const f of cmd.fusions) {
      // Seule une carte a trier se fusionne ici : une carte planifiee, en cours, livree ou refusee reste a Brice.
      const e = await d.etatCarte(f.sourceId)
      if (!e || e.fusionnee || e.statut !== 'a_trier') {
        const refus = !e ? { status: 404, error: 'Carte source introuvable.' } : { status: 409, error: 'Seule une carte à trier (non fusionnée) se fusionne par la route automatique.' }
        resultats.push({ sourceId: f.sourceId, cibleId: f.cibleId, ...refus })
        await tracer({ action: 'fusionner', carteId: e ? f.sourceId : null, resultat: 'refuse', details: { cible: f.cibleId, status: refus.status } })
        continue
      }
      if (cmd.essai) {
        resultats.push({ sourceId: f.sourceId, cibleId: f.cibleId, simule: true })
        await tracer({ action: 'fusionner', carteId: f.sourceId, resultat: 'simule', details: { cible: f.cibleId } })
        continue
      }
      const r = await d.fusionner(f.sourceId, f.cibleId)
      resultats.push(r.status === 200 ? { sourceId: f.sourceId, cibleId: f.cibleId, status: 200, ok: true } : { sourceId: f.sourceId, cibleId: f.cibleId, status: r.status, error: texteErreur(r) })
      await tracer({ action: 'fusionner', carteId: f.sourceId, resultat: resultatDe(r.status), details: { cible: f.cibleId, status: r.status } })
    }
    return { status: 200, corps: { ok: true, action: 'fusionner', essai: cmd.essai, resultats, traces } }
  }

  // prevenir : le message de l'apercu (celui du bouton du cockpit), 30 envois au plus pour tout l'appel,
  // et 100 sur 24 h glissantes pour la route.
  const duJour = cmd.essai ? 0 : await d.tentativesDuJour()
  const plafondDuJour = MAX_MESSAGES_JOUR - duJour < MAX_MESSAGES_AUTO
  let reste = Math.max(0, Math.min(MAX_MESSAGES_AUTO, MAX_MESSAGES_JOUR - duJour))
  const resultats: Record<string, unknown>[] = []
  for (const id of cmd.ids) {
    const ecoule = d.maintenant() - debut
    if (!cmd.essai && (reste <= 0 || ecoule >= budgetMs)) {
      const raison = reste <= 0 && plafondDuJour ? 'limite du jour' : reste <= 0 ? 'limite de messages' : 'temps'
      resultats.push({ id, status: 429, restante: true, error: `Pas traitée dans cet appel (${raison}) : relancer.` })
      await tracer({ action: 'prevenir', carteId: id, resultat: 'refuse', details: { limite: raison } })
      continue
    }
    const a = await d.apercu(id)
    if (a.status !== 200) {
      resultats.push({ id, status: a.status, error: texteErreur(a) })
      await tracer({ action: 'prevenir', carteId: id, resultat: resultatDe(a.status), details: { etape: 'apercu', status: a.status } })
      continue
    }
    const message = typeof a.corps.message === 'string' ? a.corps.message : ''
    const destinataires = (Array.isArray(a.corps.destinataires) ? a.corps.destinataires : []).map(x => objet(x) ?? {})
    const dejaPrevenus = nombre(a.corps.dejaPrevenus)
    const canaux: Record<string, number> = {}
    for (const x of destinataires) canaux[String(x.canal ?? 'inconnu')] = (canaux[String(x.canal ?? 'inconnu')] ?? 0) + 1
    if (cmd.essai) {
      resultats.push({ id, simule: true, statut: a.corps.statut ?? null, message, destinataires: destinataires.length, canaux, dejaPrevenus })
      await tracer({ action: 'prevenir', carteId: id, resultat: 'simule', details: { destinataires: destinataires.length, dejaPrevenus } })
      continue
    }
    if (!destinataires.length) {
      resultats.push({ id, status: 200, ok: true, envoyes: 0, dejaPrevenus, rien: 'Tous les membres de cette carte sont déjà prévenus.' })
      await tracer({ action: 'prevenir', carteId: id, resultat: 'fait', details: { envoyes: 0, dejaPrevenus } })
      continue
    }
    const r = await d.prevenir(id, message, budgetMs - ecoule, reste)
    if (r.status !== 200) {
      resultats.push({ id, status: r.status, error: texteErreur(r) })
      await tracer({ action: 'prevenir', carteId: id, resultat: resultatDe(r.status), details: { status: r.status } })
      continue
    }
    const s = resumePrevenir(r)
    reste -= s.tentatives
    resultats.push({ id, status: 200, ok: true, ...s, dejaPrevenus })
    await tracer({
      action: 'prevenir', carteId: id, resultat: s.echecs > 0 && s.envoyes === 0 ? 'echec' : 'fait',
      details: { envoyes: s.envoyes, echecs: s.echecs, aLaMain: s.aLaMain, restants: s.restants, tentatives: s.tentatives, dejaPrevenus },
    })
  }
  return { status: 200, corps: { ok: true, action: 'prevenir', essai: cmd.essai, messagesRestants: Math.max(0, reste), resultats, traces } }
}
