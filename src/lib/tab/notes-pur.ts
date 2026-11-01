// L'ESPACE PERSO DE BRICE : les notes entre Tab et Claude Code (20/10/2026).
// Partie pure : lecture d'une note entrante, textes du ping. Table
// cockpit_perso_notes (migration 20261020230000).
//
// sens vers_claude : Tab ecrit pour Claude (POST /api/tab/v1/notes).
// sens vers_tab    : Claude (script local notes_tab.py) ou Brice (ecran Perso
//                    du cockpit) ecrit pour Tab ; un email reveille Tab.
//
// TACHE (01/11/2026, migration 20261101030000_cockpit_notes_tache.sql) : un
// deuxieme assistant de Brice, avec sa cle a lui (portee 'tache') et les memes
// routes que Tab. Il lit les notes vers_tab (Claude ou Brice ecrit aux
// assistants) et les notes de Tab pour tache ou pour toutes ; il ecrit pour
// Claude (auteur tache, sens vers_claude). Il garde sa propre lecture
// (lue_par contient 'tache') sans toucher au statut de Tab.

export const TEXTE_MAX = 20_000
export const SUJET_MAX = 200
export const LIENS_MAX = 20
export const PROJETS = ['aok', 'belrive', 'perso', 'autre'] as const
export const STATUTS = ['nouvelle', 'lue', 'traitee'] as const

export type Projet = (typeof PROJETS)[number]
export type StatutNote = (typeof STATUTS)[number]
export type Sens = 'vers_claude' | 'vers_tab'
/** gpt (23/10/2026) : ChatGPT, par le connecteur MCP de Belrive (projet belrive seulement). tache (01/11/2026) : Tache, par sa cle. */
export type Auteur = 'tab' | 'claude' | 'brice' | 'gpt' | 'tache'
/**
 * Les trois instances Claude Code de Brice (22/10/2026) : Umi (WSL), Sora (application de bureau
 * Windows) et Sekai (terminal Windows). toutes = les trois (et Tache pour une note de Tab, depuis le
 * 01/11/2026). les_deux = Sora et Umi : valeur des notes d'avant le 22/10, gardee en base, plus
 * jamais ecrite. tache (01/11/2026) : une note de Tab pour Tache.
 */
export type Instance = 'sora' | 'umi' | 'sekai' | 'toutes' | 'les_deux' | 'tache'
export const NOM_INSTANCE: Record<Instance, string> = {
  sora: 'Sora', umi: 'Yume', sekai: 'Sekai', toutes: 'Sora, Yume et Sekai', les_deux: 'Sora et Yume', tache: 'Tache',
}

/** A qui chacun peut ecrire (champ pour). Par defaut (ecran Perso, script de Claude) : les instances. */
export const POUR_DEFAUT: Instance[] = ['sora', 'umi', 'sekai', 'toutes']
/** Tab ecrit aussi a Tache (01/11/2026). */
export const POUR_TAB: Instance[] = ['sora', 'umi', 'sekai', 'tache', 'toutes']
/** Tache ecrit aux instances, comme Tab (pas a lui-meme). */
export const POUR_TACHE: Instance[] = ['sora', 'umi', 'sekai', 'toutes']

/** sora, umi, sekai, toutes (ou « tous », « les trois », et l'ancien les_deux), tache si permis. Vide = toutes. */
export function lireInstance(v: unknown, permis: Instance[] = POUR_DEFAUT): Instance | null | 'invalide' {
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

/** Lit le corps d'une note : { sujet, texte, projet?, liens?, pour? }. Rend un message d'erreur en texte. */
export function lireNoteEntrante(corps: unknown, permis: Instance[] = POUR_DEFAUT): NoteEntrante | string {
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
  // pour (Tab ecrit a Claude) ou instance (Claude ecrit a Tab) : sora, umi, sekai, toutes (tache pour Tab).
  const instance = lireInstance(c.pour ?? c.instance, permis)
  if (instance === 'invalide') {
    const liste = permis.filter((i) => i !== 'toutes')
    return `pour : ${liste.join(', ')} ou toutes (par défaut toutes).`
  }
  return { sujet, texte, projet: projetBrut as Projet, liens, instance }
}

// ---------------------------------------------------------------------------
// Les notes de Tache (01/11/2026)
// ---------------------------------------------------------------------------

export type FiltreNotes = StatutNote | 'toutes'
export type Lecteur = 'sora' | 'umi' | 'sekai' | 'tache'
type Visee = Pick<NotePerso, 'sens' | 'auteur' | 'instance'>

/**
 * Les notes que Tache voit : toute note vers_tab (Claude ou Brice ecrit aux assistants), et les
 * notes de Tab pour tache ou pour toutes. Pas les siennes, ni celles de ChatGPT aux instances.
 */
export function notePourTache(n: Visee): boolean {
  return n.sens === 'vers_tab' || (n.sens === 'vers_claude' && n.auteur === 'tab' && (n.instance === 'tache' || n.instance === 'toutes'))
}

export function lueParTache(n: Pick<NotePerso, 'lue_par'>): boolean {
  return (n.lue_par ?? []).includes('tache')
}

/**
 * Le filtre ?statut= de GET /notes pour la cle de Tache : nouvelle = pas encore lue par Tache
 * (quel que soit le statut, qui est celui de Tab ou des instances), lue = lue par Tache,
 * traitee = statut traitee, toutes = sans filtre. Meme regle que le SQL de listerNotesTache.
 */
export function filtreTache(n: Pick<NotePerso, 'statut' | 'lue_par'>, filtre: FiltreNotes): boolean {
  if (filtre === 'toutes') return true
  if (filtre === 'nouvelle') return !lueParTache(n)
  if (filtre === 'lue') return lueParTache(n)
  return n.statut === 'traitee'
}

/**
 * Qui doit avoir lu une note vers_claude pour qu'elle passe a lue. null : note vers_tab, dont le
 * statut est celui de Tab (une lecture de Tache ne le change pas). Liste vide : une instance
 * precise, lue des sa lecture. MIROIR de cockpit_perso_note_lue (migration
 * 20261101030000_cockpit_notes_tache.sql) : garder les deux d'accord.
 */
export function lecteursAttendus(n: Visee): Lecteur[] | null {
  if (n.sens === 'vers_tab') return null
  const i = n.instance ?? 'les_deux'
  if (i === 'les_deux') return ['sora', 'umi']
  if (i === 'toutes') return n.auteur === 'tab' ? ['sora', 'umi', 'sekai', 'tache'] : ['sora', 'umi', 'sekai']
  return []
}

/** Ce que le lecteur a le droit de marquer lu (miroir de la garde de cockpit_perso_note_lue). */
export function peutMarquerLue(n: Visee, lecteur: Lecteur): boolean {
  if (lecteur === 'tache') return notePourTache(n)
  return n.sens === 'vers_claude' && n.instance !== 'tache'
}

/**
 * Une lecture : la note apres que le lecteur l'a marquee lue, ou null s'il n'en a pas le droit.
 * MIROIR de cockpit_perso_note_lue, pour les verifications sans base.
 */
export function lectureParLecteur(
  n: Visee & Pick<NotePerso, 'statut' | 'lue_par'>, lecteur: Lecteur,
): { statut: StatutNote; lue_par: string[] } | null {
  if (!peutMarquerLue(n, lecteur)) return null
  const lue_par = (n.lue_par ?? []).includes(lecteur) ? [...n.lue_par] : [...(n.lue_par ?? []), lecteur]
  const attendus = lecteursAttendus(n)
  if (attendus === null || n.statut !== 'nouvelle') return { statut: n.statut, lue_par }
  return { statut: attendus.every((a) => lue_par.includes(a)) ? 'lue' : 'nouvelle', lue_par }
}

/** Le filtre ?statut= de GET /notes : nouvelle (par défaut), lue, traitee, ou toutes. */
export function lireFiltreStatut(v: string | null): StatutNote | 'toutes' | string {
  const s = (v ?? 'nouvelle').trim().toLowerCase().replace('traitée', 'traitee')
  if (s === 'toutes' || (STATUTS as readonly string[]).includes(s)) return s as StatutNote | 'toutes'
  return `statut inconnu : ${STATUTS.join(', ')} ou toutes.`
}

const NOM_AUTEUR: Record<Auteur, string> = { tab: 'Tab', claude: 'Claude', brice: 'Brice', gpt: 'ChatGPT', tache: 'Tache' }

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
    `Pour répondre : POST ${base}/notes { sujet, texte, projet, pour } (pour = sora, umi, sekai, tache ou toutes).`,
    ...(n.auteur === 'gpt' ? ['ChatGPT (Projet Belrive de Brice) lit les notes du projet belrive : pour qu\'il voie ta réponse, écris-la avec projet = belrive.'] : []),
  ]
  return { objet: objet.slice(0, 250), texte: lignes.join('\n') }
}

/** Le message Telegram a Brice quand Tab (ou ChatGPT, auteur gpt, ou Tache) laisse une note pour Claude. */
export function messageBrice(sujet: string, instance: Instance | null = 'toutes', auteur: Auteur = 'tab'): string {
  const qui = auteur === 'gpt' ? 'ChatGPT (Belrive)' : auteur === 'tache' ? 'Tache' : 'Tab'
  // « toutes » d'une note de Tab inclut Tache (01/11/2026).
  const pour = (instance ?? 'toutes') === 'toutes' && auteur === 'tab' ? 'Sora, Yume, Sekai et Tache' : NOM_INSTANCE[instance ?? 'toutes']
  return `${qui} a laissé une note pour ${pour} : ${sujet}\nhttps://cockpit.aoknowledge.com/?vue=perso`
}
