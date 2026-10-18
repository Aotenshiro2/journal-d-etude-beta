// LE GENERATEUR DE POSTS DU COCKPIT : la partie PURE (19/10/2026). Aucune
// base, aucun reseau : lecture de la demande, choix des inspirations et des
// passages de matiere, construction du prompt, schema de sortie, validation.
// La partie serveur (lectures, appel, rangement) est dans generation.ts, que
// partagent la route /api/cockpit/generation et l'outil generer_post de
// l'Agent AOK.
//
// Les regles d'ecriture ne sont pas recopiees ici : elles arrivent de
// cockpit_methode_textes (cles generateur:*, npm run pousser:inspirations,
// apps/cockpit), qui les lit sur le disque (fiche de style, README de la base
// d'inspirations, essai du 18/10, regles de Brice notees en memoire). Ce
// fichier ne porte que la consigne de sortie et les six regles du GO de Brice
// du 18/10, qui disent comment ces textes s'appliquent.

import { motsSignificatifs } from '@/lib/creation-pur'

export const MODELE_GENERATION = 'claude-opus-5-5'

export const OBJECTIFS = [
  'enseigner', 'creer_du_lien', 'rassurer', 'convertir', 'retenir', 'acquerir', 'recadrer', 'celebrer', 'animer',
] as const
export type Objectif = (typeof OBJECTIFS)[number]

export type Personne = 'brice' | 'mel'
export type Sens = 'idee' | 'capture'
export type Moment = 'direct' | 'relecture'
export type TypeImage = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

export type Reponses = {
  sujet: string | null
  biais: string | null
  trade: string | null
  moment: Moment | null
  actif: string | null
}

export type DemandeGeneration = {
  personne: Personne
  canal: string
  objectif: Objectif
  sens: Sens
  idee: string | null
  reponses: Reponses
  image: { media_type: TypeImage; data: string } | null
  /** Regenerer ou retoucher : le brouillon d'origine. */
  parent_id: string | null
  /** Retoucher : la consigne libre. Absente avec un parent = regenerer. */
  consigne: string | null
}

export const MAX_IDEE = 8000
export const MAX_CONSIGNE = 2000
export const MAX_REPONSE = 400
/** Base64 d'une image : l'ecran la reduit avant l'envoi (corps d'une fonction Vercel : 4,5 Mo). */
export const MAX_IMAGE_B64 = 4_000_000
const TYPES_IMAGE: readonly TypeImage[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const estObjet = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

/** Texte propre ou null : coupe a `max`, sans tiret long (regle de Brice). */
export function propre(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null
  const t = sansTiretLong(x).trim().slice(0, max)
  return t ? t : null
}

export function sansTiretLong(t: string): string {
  return t.replace(/[ \t]*—[ \t]*/g, ' - ').replace(/–/g, '-')
}

/** La personne d'une valeur libre (« Brice », « Mélanie », « mel »), ou null. */
export function lirePersonne(x: unknown): Personne | null {
  if (typeof x !== 'string') return null
  const s = x.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (/brice/.test(s)) return 'brice'
  if (/^mel|melanie|melmom/.test(s)) return 'mel'
  return null
}

/** Le corps de la demande, valide. Une chaine = le message d'erreur (400). */
export function lireDemandeGeneration(brut: unknown): DemandeGeneration | string {
  if (!estObjet(brut)) return 'Corps de requête illisible.'
  const personne = lirePersonne(brut.personne)
  if (!personne) return 'personne attendue : brice ou mel.'
  const canal = propre(brut.canal, 120)
  if (!canal) return 'canal requis.'
  const objectif = typeof brut.objectif === 'string' ? brut.objectif.trim() as Objectif : null
  if (!objectif || !OBJECTIFS.includes(objectif)) return `objectif attendu : ${OBJECTIFS.join(', ')}.`
  const sens = brut.sens === 'capture' ? 'capture' : brut.sens === 'idee' ? 'idee' : null
  if (!sens) return 'sens attendu : idee ou capture.'
  const idee = propre(brut.idee, MAX_IDEE)
  const r = estObjet(brut.reponses) ? brut.reponses : {}
  const moment = r.moment === 'direct' || r.moment === 'relecture' ? r.moment : null
  const reponses: Reponses = {
    sujet: propre(r.sujet, MAX_REPONSE),
    biais: propre(r.biais, MAX_REPONSE),
    trade: propre(r.trade, MAX_REPONSE),
    moment,
    actif: propre(r.actif, MAX_REPONSE),
  }
  let image: DemandeGeneration['image'] = null
  if (brut.image !== undefined && brut.image !== null) {
    if (!estObjet(brut.image)) return 'image illisible.'
    const mt = brut.image.media_type as TypeImage
    const data = typeof brut.image.data === 'string' ? brut.image.data.replace(/^data:[^,]+,/, '').trim() : ''
    if (!TYPES_IMAGE.includes(mt)) return 'image : JPEG, PNG, WEBP ou GIF.'
    if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) return 'image : base64 attendu.'
    if (data.length > MAX_IMAGE_B64) return 'image trop lourde : réduis-la avant de l\'envoyer.'
    image = { media_type: mt, data }
  }
  const parent = typeof brut.parent_id === 'string' && UUID.test(brut.parent_id.trim()) ? brut.parent_id.trim().toLowerCase() : null
  const consigne = propre(brut.consigne, MAX_CONSIGNE)
  if (consigne && !parent) return 'une retouche demande parent_id.'
  if (sens === 'capture' && !image) return 'sens capture : image requise.'
  if (sens === 'idee' && !idee && !reponses.sujet && !parent) return 'sens idee : une idée, un sujet ou une source à écrire.'
  return { personne, canal, objectif, sens, idee, reponses, image, parent_id: parent, consigne }
}

// --- Les inspirations -----------------------------------------------------------

export type Inspiration = {
  id: string
  personne: string
  axe: string | null
  role: 'forme' | 'matiere'
  format: string | null
  format_cible: string | null
  objectifs: string[]
  canal: string | null
  canal_registre: string | null
  date_pub: string | null
  source: string | null
  texte: string
  image: string | null
  declencheur: string | null
  pourquoi: string | null
  refus: string | null
  concepts: string[]
}

export type Axe = 'mindset' | 'technique'

/** L'axe vise : une capture est technique, sinon le canal le dit (Mindset, Explication charts), sinon aucun. */
export function axeCible(canal: string, sens: Sens): Axe | null {
  if (sens === 'capture') return 'technique'
  if (/mindset/i.test(canal)) return 'mindset'
  if (/chart|technique/i.test(canal)) return 'technique'
  return null
}

const famille = (canal: string | null) => (canal ?? '').split('/')[0].trim().toLowerCase()

/** Les mots de la recherche : l'idee, les reponses, la consigne. */
export function motsDeLaDemande(d: Pick<DemandeGeneration, 'idee' | 'reponses' | 'consigne'>): string[] {
  return motsSignificatifs([d.reponses.sujet, d.idee, d.reponses.biais, d.consigne], 20)
}

function recouvrement(i: Inspiration, mots: string[]): number {
  if (!mots.length) return 0
  const sac = `${i.concepts.join(' ')} ${i.texte} ${i.declencheur ?? ''}`.toLowerCase()
  let n = 0
  for (const m of mots) if (sac.includes(m)) n++
  return Math.min(n, 4)
}

export function scoreForme(i: Inspiration, d: Pick<DemandeGeneration, 'canal' | 'objectif'>, axe: Axe | null, mots: string[]): number {
  let s = 0
  if (i.canal && i.canal.toLowerCase() === d.canal.toLowerCase()) s += 6
  else if (famille(i.canal) && famille(i.canal) === famille(d.canal)) s += 2
  if (i.objectifs[0] === d.objectif) s += 5
  else if (i.objectifs.includes(d.objectif)) s += 3
  if (axe && i.axe === axe) s += 3
  return s + recouvrement(i, mots)
}

export type FormeChoisie = { inspiration: Inspiration; memeCanal: boolean }

/**
 * 4 a 8 inspirations « forme » de la meme personne : celles du canal cible
 * d'abord (5 au plus), puis les meilleures des autres canaux (debordements
 * possibles), 6 en tout par defaut, 8 au plus. Tri stable par score, puis par
 * id pour que deux appels identiques envoient la meme chose.
 */
export function choisirFormes(toutes: Inspiration[], d: Pick<DemandeGeneration, 'personne' | 'canal' | 'objectif'>, axe: Axe | null, mots: string[]): FormeChoisie[] {
  const miennes = toutes.filter((i) => i.role === 'forme' && i.personne === d.personne)
  const notees = miennes
    .map((i) => ({ i, s: scoreForme(i, d, axe, mots) }))
    .sort((a, b) => b.s - a.s || a.i.id.localeCompare(b.i.id))
  const canal = d.canal.toLowerCase()
  const memes = notees.filter((x) => (x.i.canal ?? '').toLowerCase() === canal).slice(0, 5)
  const autres = notees.filter((x) => (x.i.canal ?? '').toLowerCase() !== canal)
  // 6 en tout, 7 quand le canal en fournit 5 : toujours au moins deux modeles d'ailleurs.
  const voulu = Math.min(8, Math.max(6, memes.length + 2))
  const choisies = [...memes, ...autres.slice(0, Math.max(0, voulu - memes.length))].slice(0, 8)
  return choisies.map((x) => ({ inspiration: x.i, memeCanal: (x.i.canal ?? '').toLowerCase() === canal }))
}

/** Le registre par defaut d'un canal : celui que portent ses inspirations. */
export function registreDuCanal(toutes: Inspiration[], canal: string): string | null {
  const c = canal.toLowerCase()
  return toutes.find((i) => (i.canal ?? '').toLowerCase() === c && i.canal_registre)?.canal_registre ?? null
}

// --- La matiere -----------------------------------------------------------------

export type TypePassage = 'inspiration' | 'pdf' | 'reference' | 'banque'
export type Passage = { type: TypePassage; libelle: string; texte: string; ref: string }

export const MAX_PASSAGE = 3000
export const MAX_PASSAGES = 4

/** Les inspirations « matiere » de la personne qui parlent du sujet (au moins un mot en commun). */
export function choisirMatiereInspirations(toutes: Inspiration[], personne: Personne, axe: Axe | null, mots: string[]): Passage[] {
  return toutes
    .filter((i) => i.role === 'matiere' && i.personne === personne)
    .map((i) => ({ i, s: recouvrement(i, mots) * 2 + (axe && i.axe === axe ? 1 : 0) }))
    .filter((x) => recouvrement(x.i, mots) > 0)
    .sort((a, b) => b.s - a.s || a.i.id.localeCompare(b.i.id))
    .slice(0, 2)
    .map(({ i }) => ({
      type: 'inspiration' as const,
      ref: i.id,
      libelle: `Inspiration ${i.id} (${i.canal ?? 'matière'}${i.format_cible ? `, pour un format ${i.format_cible}` : ''})`,
      texte: [
        i.texte.slice(0, MAX_PASSAGE),
        i.refus ? `Refus de l'auteur : ${i.refus}` : null,
        i.declencheur ? `Déclencheur : ${i.declencheur}` : null,
      ].filter(Boolean).join('\n'),
    }))
}

/** Les sections d'un fichier markdown (titres de niveau 2 et 3), pour la banque de contenus de Brice. */
export function sectionsMarkdown(texte: string): Array<{ titre: string; corps: string }> {
  const sections: Array<{ titre: string; corps: string }> = []
  let courante: { titre: string; lignes: string[] } | null = null
  for (const l of texte.split('\n')) {
    const m = l.match(/^#{2,3}\s+(.+)$/)
    if (m) {
      if (courante) sections.push({ titre: courante.titre, corps: courante.lignes.join('\n').trim() })
      courante = { titre: m[1].trim(), lignes: [] }
    } else if (courante) courante.lignes.push(l)
  }
  if (courante) sections.push({ titre: courante.titre, corps: courante.lignes.join('\n').trim() })
  return sections.filter((s) => s.corps)
}

export function choisirBanque(banque: string | null, mots: string[]): Passage[] {
  if (!banque || !mots.length) return []
  return sectionsMarkdown(banque)
    .map((s) => {
      const sac = `${s.titre} ${s.corps}`.toLowerCase()
      return { s, n: mots.filter((m) => sac.includes(m)).length }
    })
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 1)
    .map(({ s }) => ({ s: { ...s, titre: s.titre.replace(/\[([^\]]*)\]\([^)]*\)?/g, '$1').replace(/[()]/g, '').trim() } }))
    .map(({ s }) => ({
      type: 'banque' as const,
      ref: `banque:${s.titre.slice(0, 80)}`,
      libelle: `Banque de contenus de Brice, « ${s.titre.slice(0, 80)} »`,
      texte: s.corps.slice(0, MAX_PASSAGE),
    }))
}

/** 1 a 4 passages : pour un sujet technique la reference et les PDF d'abord, sinon le vecu et la banque d'abord. */
export function assemblerPassages(axe: Axe | null, p: { inspirations: Passage[]; banque: Passage[]; pdf: Passage[]; reference: Passage[] }): Passage[] {
  const [i0, i1] = p.inspirations
  const [p0, p1] = p.pdf
  const [r0, r1] = p.reference
  const b0 = p.banque[0]
  const ordre = axe === 'technique'
    ? [r0, p0, i0, r1, p1, b0, i1]
    : [i0, b0, p0, r0, i1, p1, r1]
  return ordre.filter((x): x is Passage => !!x).slice(0, MAX_PASSAGES)
}

// --- Le prompt ------------------------------------------------------------------

export const CONSIGNES = `Tu écris un BROUILLON de post pour AO Knowledge (Brice et Mel, trading ICT, Live Club). L'auteur le copie-colle lui-même : rien n'est publié automatiquement, et tu ne t'adresses jamais à lui dans le brouillon.

Les règles de Brice, dans cet ordre :
1. La voix et le format viennent des INSPIRATIONS « forme » fournies : des textes réellement publiés par l'auteur. Un live, une vidéo, un coaching, un PDF (inspirations « matiere », pages de PDF, banque de contenus) est de la MATIÈRE : il donne le sujet, le cas, le refus, jamais la voix ni le format.
2. Le post sert l'OBJECTIF demandé (enseigner, creer_du_lien, rassurer, convertir, retenir, acquerir, recadrer, celebrer, animer). Le format se choisit pour lui.
3. Le canal cible donne le registre par défaut, et ses inspirations passent en premier. Les canaux ne sont pas enfermés dans des formats : tu peux emprunter le format ou le ton d'un autre canal quand l'objectif le justifie, jamais au hasard ni par défaut. Si tu le fais, dis-le en une ligne dans « debordement » (quel format, de quel canal, pourquoi). Sinon debordement = null.
4. Chez Brice, un refus nommé (ce qu'il corrige, « c'est l'inverse qu'il faut faire »). Chez Mel, son vécu récent et la correction de la prémisse d'un membre. Le vécu ne s'invente pas : aucune scène, aucun chiffre, aucun trade, aucun résultat, aucune date que la demande ou la matière ne donnent. S'il en faut un et qu'il manque, écris sans lui (ou avec un repère [à compléter : ...] à l'endroit exact) et pose la question dans « questions ».
5. Une idée tirée d'ICT se formule « ICT a dit [...] ». Une définition du glossaire (compilation d'un tiers) se dit « dans le vocabulaire ICT ». Un mécanisme technique ne s'affirme que s'il est énoncé dans une page fournie (référence ICT, PDF de l'auteur) ou dans la demande : jamais reconstitué depuis un dialogue de live, jamais de mémoire. Sans source, reste sur ce que la demande dit, ou pose une question.
6. Aucun tiret long (le caractère U+2014). Aucun « jamais » dans un engagement envers les membres. Aucun nom réel de membre (« un membre »). Sur le Live Club, on parle aux membres directement, dans le registre du canal, pas de « un élève m'a dit ».

Sens A (une idée, un sujet, une source) : le post. Si le sujet est technique, « chart » décrit le chart à joindre (actif, unité de temps, ce qui doit être tracé), sinon chart = null. lecture = null.
Sens B (une capture) : « lecture » dit ce que tu lis sur l'image (actif, unité de temps et date si le filigrane TradingView les montre, niveaux, annotations, ce qui s'est passé), puis le brouillon est le tip qui colle à ce que l'auteur veut enseigner. Ce que l'image seule ne dit pas (biais du jour, trade pris et résultat, direct ou relecture) vient des réponses de l'auteur, sinon c'est une question. chart = null (la capture est le chart).

Le texte du post va dans « brouillon », prêt à coller tel quel : pas de guillemets autour, pas de titre « Brouillon », pas de commentaire. Des messages en rafale (formats G, H, J de Mel) : sépare-les par une ligne qui ne contient que ---.
format : la lettre et le nom du format choisi (README de la base).
inspirations : les ids des inspirations dont tu as réellement pris la voix ou le format. sources : les libellés exacts des passages de matière réellement utilisés.
questions : ce qu'il faut demander à l'auteur (vécu manquant, information que rien ne donne), une question courte par ligne, vide si rien ne manque.
risques : en une ou deux lignes, ce que l'auteur doit vérifier avant de publier (raccourci, supposition, source un peu large), ou null.
Réponds uniquement par l'objet JSON demandé.`

const NOMS: Record<Personne, string> = {
  brice: 'Brice (fondateur d\'AO Knowledge)',
  mel: 'Mel (Mélanie, MELMOM, associée de Brice, admin du Live Club). Il n\'existe pas de fiche de style pour elle : sa voix, ce sont ses inspirations « forme »',
}

function bloc(x: string): string {
  return `<<<\n${sansTiretLong(x).trim()}\n>>>`
}

export function texteInspiration(c: FormeChoisie): string {
  const i = c.inspiration
  return [
    `=== ${i.id} | canal : ${i.canal ?? '?'}${c.memeCanal ? ' (canal cible)' : ' (autre canal : débordement possible)'} | format ${i.format ?? '?'} | objectifs : ${i.objectifs.join(', ') || '?'} | axe : ${i.axe ?? '?'}${i.image ? ' | publié avec une capture' : ''}`,
    i.pourquoi ? `Pourquoi ça marche : ${sansTiretLong(i.pourquoi)}` : null,
    i.refus ? `Refus : ${sansTiretLong(i.refus)}` : null,
    i.declencheur ? `Déclencheur : ${sansTiretLong(i.declencheur)}` : null,
    'Texte publié :',
    bloc(i.texte),
  ].filter((x): x is string => x !== null).join('\n')
}

export type Parent = { brouillon: string; consigne: string | null }

/** Le message de l'utilisateur (texte). L'image, s'il y en a une, part en bloc a part, avant lui. */
export function entreeGeneration(p: {
  d: DemandeGeneration
  registre: string | null
  formes: FormeChoisie[]
  passages: Passage[]
  parent: Parent | null
}): string {
  const { d } = p
  const r = d.reponses
  const lignesReponses = [
    r.sujet ? `- Sujet à enseigner : ${r.sujet}` : null,
    r.biais ? `- Biais du jour : ${r.biais}` : null,
    r.trade ? `- Trade pris et résultat : ${r.trade}` : null,
    r.moment ? `- Moment : ${r.moment === 'direct' ? 'posté en direct' : 'posté en relecture, après coup'}` : null,
    r.actif ? `- Actif, unité de temps, date : ${r.actif}` : null,
  ].filter((x): x is string => x !== null)

  const parties: string[] = [
    'DEMANDE',
    `- Qui écrit : ${NOMS[d.personne]}.`,
    `- Canal cible : ${d.canal}.${p.registre ? ` Registre par défaut de ce canal : ${sansTiretLong(p.registre)}` : ' Aucune inspiration de ce canal dans la base : pars des inspirations de l\'auteur qui servent le même objectif, et dis dans « debordement » ce que tu empruntes.'}`,
    `- Objectif : ${d.objectif}.`,
    `- Sens : ${d.sens === 'capture' ? 'B, une capture est jointe (image ci-dessus)' : 'A, une idée, un sujet ou une source'}.`,
    d.idee ? `- Idée, sujet ou source donnés par l'auteur :\n${bloc(d.idee)}` : null,
    lignesReponses.length ? `- Réponses de l'auteur :\n${lignesReponses.join('\n')}` : (d.sens === 'capture' ? "- Réponses de l'auteur : aucune. Ce que l'image ne dit pas est une question." : null),
  ].filter((x): x is string => x !== null)

  parties.push('', `INSPIRATIONS « FORME » (${p.formes.length}) : la voix et le format.`)
  for (const f of p.formes) parties.push('', texteInspiration(f))

  if (p.passages.length) {
    parties.push('', `MATIÈRE (${p.passages.length} passage${p.passages.length > 1 ? 's' : ''}) : le sujet, le cas, le refus, jamais la voix. Une page de référence ICT se cite « ICT a dit [...] ».`)
    for (const x of p.passages) parties.push('', `--- ${x.libelle}`, bloc(x.texte))
  } else {
    parties.push('', 'MATIÈRE : aucun passage trouvé. N\'invente aucun mécanisme ni aucun vécu.')
  }

  if (p.parent) {
    parties.push('', p.parent.consigne
      ? `RETOUCHE. Voici le brouillon précédent, à reprendre selon la consigne de l'auteur, sans perdre ce qui tenait :\n${bloc(p.parent.brouillon)}\nConsigne : ${p.parent.consigne}`
      : `NOUVELLE VERSION. L'auteur veut une autre proposition que celle-ci (autre angle ou autre format, mêmes règles) :\n${bloc(p.parent.brouillon)}`)
  }
  return parties.join('\n')
}

// --- La sortie ------------------------------------------------------------------

const TEXTE_OU_NULL = { type: ['string', 'null'] }

export const SCHEMA_SORTIE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    brouillon: { type: 'string' },
    format: { type: 'string' },
    lecture: TEXTE_OU_NULL,
    chart: TEXTE_OU_NULL,
    debordement: TEXTE_OU_NULL,
    inspirations: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
    risques: TEXTE_OU_NULL,
  },
  required: ['brouillon', 'format', 'lecture', 'chart', 'debordement', 'inspirations', 'sources', 'questions', 'risques'],
} as const

export type ContenuGeneration = {
  brouillon: string
  format: string | null
  lecture: string | null
  chart: string | null
  debordement: string | null
  inspirations: string[]
  sources: string[]
  questions: string[]
  risques: string | null
}

/** La sortie de l'IA, validee : ids et sources ramenes a ce qui a ete envoye, aucun tiret long. Null = inexploitable. */
export function validerSortie(brut: unknown, idsEnvoyes: string[], libellesEnvoyes: string[]): ContenuGeneration | null {
  let o: unknown = brut
  if (typeof brut === 'string') {
    const t = brut.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try { o = JSON.parse(t) } catch { return null }
  }
  if (!estObjet(o)) return null
  const brouillon = propre(o.brouillon, 12_000)
  if (!brouillon) return null
  const liste = (x: unknown, max: number) =>
    (Array.isArray(x) ? x : []).map((v) => propre(v, max)).filter((v): v is string => v !== null)
  const ids = new Set(idsEnvoyes)
  const inspirations = [...new Set(liste(o.inspirations, 40).filter((x) => ids.has(x)))]
  const sources = [...new Set(liste(o.sources, 300).map((s) => libellesEnvoyes.find((l) => l === s || l.startsWith(s) || s.startsWith(l)) ?? null)
    .filter((s): s is string => s !== null))]
  return {
    brouillon,
    format: propre(o.format, 120),
    lecture: propre(o.lecture, 3000),
    chart: propre(o.chart, 1500),
    debordement: propre(o.debordement, 500),
    inspirations,
    sources,
    questions: liste(o.questions, 400).slice(0, 8),
    risques: propre(o.risques, 800),
  }
}
