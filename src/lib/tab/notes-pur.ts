// L'ESPACE PERSO DE BRICE : les notes entre Tab et Claude Code (20/10/2026).
// Partie pure : lecture d'une note entrante, textes du ping. Table
// cockpit_perso_notes (migration 20261020230000).
//
// sens vers_claude : Tab ecrit pour Claude (POST /api/tab/v1/notes).
// sens vers_tab    : Claude (script local notes_tab.py) ou Brice (ecran Perso
//                    du cockpit) ecrit pour Tab ; un email reveille Tab.

export const TEXTE_MAX = 20_000
export const SUJET_MAX = 200
export const LIENS_MAX = 20
export const PROJETS = ['aok', 'belrive', 'perso', 'autre'] as const
export const STATUTS = ['nouvelle', 'lue', 'traitee'] as const

export type Projet = (typeof PROJETS)[number]
export type StatutNote = (typeof STATUTS)[number]
export type Sens = 'vers_claude' | 'vers_tab'
export type Auteur = 'tab' | 'claude' | 'brice'
/**
 * Les trois instances Claude Code de Brice (22/10/2026) : Umi (WSL), Sora (application de bureau
 * Windows) et Sekai (terminal Windows). toutes = les trois. les_deux = Sora et Umi : valeur des
 * notes d'avant le 22/10, gardee en base, plus jamais ecrite.
 */
export type Instance = 'sora' | 'umi' | 'sekai' | 'toutes' | 'les_deux'
export const NOM_INSTANCE: Record<Instance, string> = {
  sora: 'Sora', umi: 'Umi', sekai: 'Sekai', toutes: 'Sora, Umi et Sekai', les_deux: 'Sora et Umi',
}

/** sora, umi, sekai, toutes (ou « tous », « les trois », et l'ancien les_deux). Vide = toutes. */
export function lireInstance(v: unknown, permis: Instance[] = ['sora', 'umi', 'sekai', 'toutes']): Instance | null | 'invalide' {
  if (v === undefined || v === null || v === '') return null
  const s = String(v).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_')
  const tous = ['toutes', 'tous', 'les_trois', 'trois', 'all', 'les_deux', 'deux', 'les_2', 'both']
  const i = (tous.includes(s) ? 'toutes' : s) as Instance
  return permis.includes(i) ? i : 'invalide'
}

export type NoteEntrante = { sujet: string; texte: string; projet: Projet; liens: string[]; instance: Instance | null }

export type NotePerso = {
  note_id: string
  sens: Sens
  auteur: Auteur
  sujet: string
  texte: string
  projet: Projet
  liens: string[]
  statut: StatutNote
  cree_le: string
  lu_le: string | null
  traite_le: string | null
  ping_envoye_le: string | null
  instance: Instance | null
  lue_par: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function estUuid(v: string): boolean {
  return UUID.test(v)
}

/** Lit le corps d'une note : { sujet, texte, projet?, liens? }. Rend un message d'erreur en texte. */
export function lireNoteEntrante(corps: unknown): NoteEntrante | string {
  if (!corps || typeof corps !== 'object') return 'Corps JSON attendu : { sujet, texte, projet?, liens? }.'
  const c = corps as Record<string, unknown>
  const sujet = typeof c.sujet === 'string' ? c.sujet.trim() : ''
  const texte = typeof c.texte === 'string' ? c.texte.trim() : ''
  if (!sujet) return 'sujet manquant (texte court, 200 caractères au plus).'
  if (sujet.length > SUJET_MAX) return `sujet trop long : ${SUJET_MAX} caractères au plus.`
  if (!texte) return 'texte manquant.'
  if (texte.length > TEXTE_MAX) return `texte trop long : ${TEXTE_MAX} caractères au plus (reçu ${texte.length}).`
  const projetBrut = c.projet === undefined || c.projet === null || c.projet === '' ? 'aok' : String(c.projet).trim().toLowerCase()
  if (!(PROJETS as readonly string[]).includes(projetBrut)) return `projet inconnu : ${PROJETS.join(', ')}.`
  let liens: string[] = []
  if (c.liens !== undefined && c.liens !== null) {
    const brut = Array.isArray(c.liens) ? c.liens : typeof c.liens === 'string' ? [c.liens] : null
    if (!brut) return 'liens : une liste d\'adresses (ou une seule adresse en texte).'
    liens = brut.map((l) => String(l).trim()).filter(Boolean)
    if (liens.length > LIENS_MAX) return `liens : ${LIENS_MAX} au plus.`
    if (liens.some((l) => l.length > 2000)) return 'liens : 2 000 caractères au plus par lien.'
  }
  // pour (Tab ecrit a Claude) ou instance (Claude ecrit a Tab) : sora, umi, sekai, toutes.
  const instance = lireInstance(c.pour ?? c.instance)
  if (instance === 'invalide') return 'pour : sora, umi, sekai ou toutes (par défaut toutes).'
  return { sujet, texte, projet: projetBrut as Projet, liens, instance }
}

/** Le filtre ?statut= de GET /notes : nouvelle (par défaut), lue, traitee, ou toutes. */
export function lireFiltreStatut(v: string | null): StatutNote | 'toutes' | string {
  const s = (v ?? 'nouvelle').trim().toLowerCase().replace('traitée', 'traitee')
  if (s === 'toutes' || (STATUTS as readonly string[]).includes(s)) return s as StatutNote | 'toutes'
  return `statut inconnu : ${STATUTS.join(', ')} ou toutes.`
}

const NOM_AUTEUR: Record<Auteur, string> = { tab: 'Tab', claude: 'Claude', brice: 'Brice' }

function nomAuteur(a: Auteur, i: Instance | null): string {
  return a === 'claude' && (i === 'sora' || i === 'umi' || i === 'sekai') ? `Claude (${NOM_INSTANCE[i]})` : NOM_AUTEUR[a]
}

/** L'email qui reveille Tab. Texte brut, pas de HTML. */
export function emailPing(n: { note_id: string; auteur: Auteur; instance: Instance | null; sujet: string; texte: string; projet: Projet; liens: string[] }, base: string, test = false) {
  const objet = test ? 'Test du canal Claude → Tab' : `Note de ${nomAuteur(n.auteur, n.instance)} : ${n.sujet}`
  const lignes = [
    ...(test ? ['CECI EST UN TEST du canal de notes Claude → Tab. Rien à faire : marque-la lue pour essayer la route.', ''] : []),
    `Note de ${nomAuteur(n.auteur, n.instance)} pour Tab (projet ${n.projet}).`,
    `Sujet : ${n.sujet}`,
    '',
    n.texte,
    ...(n.liens.length ? ['', 'Liens :', ...n.liens] : []),
    '',
    '---',
    `Lis-la aussi par GET ${base}/notes (identifiant ${n.note_id}),`,
    `puis marque-la lue : POST ${base}/notes/${n.note_id}/lu.`,
    `Pour répondre : POST ${base}/notes { sujet, texte, projet, pour } (pour = sora, umi, sekai ou toutes).`,
  ]
  return { objet: objet.slice(0, 250), texte: lignes.join('\n') }
}

/** Le message Telegram a Brice quand Tab laisse une note pour Claude. */
export function messageBrice(sujet: string, instance: Instance | null = 'toutes'): string {
  return `Tab a laissé une note pour ${NOM_INSTANCE[instance ?? 'toutes']} : ${sujet}\nhttps://cockpit.aoknowledge.com/?vue=perso`
}
