// LA FICHE D'UNE PERSONNE pour l'agent du Cockpit (chantier « noms et paroles
// des membres », passe 2, Brice 15/10/2026) : regles PURES, aucun reseau,
// aucun import. scripts/verifier-fiche-personne.mjs les verifie.
//
// Brice : « si je demande a notre agent de me donner des informations sur
// Fred, il doit etre capable de me donner son ressenti, ses messages comme
// celui-ci si je le demande, ou de m'en faire un resume ». Et si Fred se
// renomme, l'agent doit connaitre ses anciens noms.
//
// Trois regles vivent ici :
// 1. QUI EST QUI. Une personne est un groupe de « noeuds » : un compte
//    Telegram (tg:<id>), une fiche membre payant (membre:<uuid>), une fiche
//    d'archive (archive:<personne_id>). Deux noeuds ne sont REUNIS que par un
//    lien certain (meme compte Telegram, rattachement prouve, numero pose a la
//    main, rapprochement certain de l'archive). Un lien par le NOM ou par le
//    pseudo declare au paiement reste « probable » : il est dit, jamais suivi.
//    Plusieurs groupes trouves = plusieurs candidats, et l'agent demande.
// 2. LES MESSAGES MARQUANTS, sans IA : premiers messages, messages longs, et
//    ceux qui parlent d'arrivee, de depart, de pause, d'abonnement, de
//    remerciement ou de difficulte (mots-cles, poids, seuil).
// 3. LA BORNE : la fiche tient dans BUDGET_FICHE caracteres de JSON, par
//    paliers (moins d'elements, textes plus courts), jamais coupee au milieu.

// ---------------------------------------------------------------------------
// 1. Lire « qui »
// ---------------------------------------------------------------------------

export const MAX_QUI = 120
export const MIN_TEXTE = 3

/**
 * La table de translate() cote SQL et de normaliser() cote serveur : LA MEME,
 * pour que le motif cherche et la valeur en base soient normalises pareil.
 * Postgres n'a pas l'extension unaccent sur ce projet (lu le 15/10).
 */
export const ACCENTS = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ'
export const SANS_ACCENTS = 'aaaaaaceeeeiiiinooooouuuuyy'

export type QuiLu =
  | { genre: 'telegram'; id: number }
  | { genre: 'membre'; id: string }
  | { genre: 'archive'; id: string }
  | { genre: 'email'; email: string }
  | { genre: 'texte'; brut: string; exact: string; motif: string }

/** Minuscules et accents retires, exactement comme translate(lower(x), ACCENTS, SANS_ACCENTS). */
export function normaliser(s: string): string {
  let r = ''
  for (const c of s.toLowerCase()) {
    const i = ACCENTS.indexOf(c)
    r += i >= 0 ? SANS_ACCENTS[i] : c
  }
  return r
}

/** Echappe les jokers de LIKE (antislash, %, _), l'antislash etant l'echappement par defaut. */
export function echapperLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * « qui » tel que le modele le passe : un nom, un ancien nom, un @pseudo, un
 * numero Telegram (u123 ou 123), un email, ou l'identifiant rendu par un
 * appel precedent (u..., membre:<uuid>, p-...). Une erreur en clair sinon.
 */
export function lireQui(entree: unknown): QuiLu | { erreur: string } {
  const brut = typeof entree === 'string'
    ? entree
    : entree && typeof entree === 'object' ? (entree as { qui?: unknown }).qui : undefined
  if (typeof brut !== 'string' || !brut.trim()) {
    return { erreur: 'qui manquant : un nom, un ancien nom, un @pseudo, un numéro Telegram (u...) ou un email.' }
  }
  const t = brut.replace(/\s+/g, ' ').trim()
  if (t.length > MAX_QUI) return { erreur: `qui trop long (${MAX_QUI} caractères au plus).` }

  const tg = /^u?(\d{5,15})$/i.exec(t)
  if (tg) {
    const id = Number(tg[1])
    if (Number.isSafeInteger(id) && id > 0) return { genre: 'telegram', id }
  }
  const membre = /^(?:membre:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(t)
  if (membre) return { genre: 'membre', id: membre[1].toLowerCase() }
  const archive = /^(?:archive:)?(p-[a-z0-9][a-z0-9-]*)$/.exec(t)
  if (archive) return { genre: 'archive', id: archive[1] }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { genre: 'email', email: t.toLowerCase() }

  const texte = t.replace(/^@+/, '').trim()
  const exact = normaliser(texte)
  if (exact.length < MIN_TEXTE) {
    return { erreur: `qui trop court : ${MIN_TEXTE} caractères au moins pour chercher un nom ou un pseudo.` }
  }
  return { genre: 'texte', brut: texte, exact, motif: `%${echapperLike(exact)}%` }
}

// ---------------------------------------------------------------------------
// 2. Qui est qui : les groupes
// ---------------------------------------------------------------------------

/** 'tg:<id>' | 'membre:<uuid>' | 'archive:<personne_id>'. */
export type Noeud = string

/** Ce qui a ete trouve : le noeud, le champ qui a repondu, sa valeur, et s'il repond exactement. */
export type Touche = { noeud: Noeud; champ: string; valeur: string | null; exact: boolean }

/** Un lien entre deux noeuds. certain = il reunit ; sinon il est seulement dit. */
export type LienLu = { a: Noeud; b: Noeud; nature: string; certain: boolean }

export type Groupe = {
  noeuds: Noeud[]
  touches: Touche[]
  certains: LienLu[]
  /** Liens probables qui touchent le groupe (l'autre bout peut etre hors du groupe). */
  probables: LienLu[]
}

const RANG_NOEUD: Record<string, number> = { tg: 0, membre: 1, archive: 2 }

export function genreNoeud(n: Noeud): 'tg' | 'membre' | 'archive' | null {
  const g = n.slice(0, n.indexOf(':'))
  return g === 'tg' || g === 'membre' || g === 'archive' ? g : null
}

export function valeurNoeud(n: Noeud): string {
  return n.slice(n.indexOf(':') + 1)
}

/** Les comptes Telegram d'abord, puis les fiches membres, puis l'archive. */
export function comparerNoeuds(x: Noeud, y: Noeud): number {
  const r = (RANG_NOEUD[genreNoeud(x) ?? ''] ?? 9) - (RANG_NOEUD[genreNoeud(y) ?? ''] ?? 9)
  if (r !== 0) return r
  return x < y ? -1 : x > y ? 1 : 0
}

/** Un noeud lisible par l'agent et rejouable dans fiche_personne : u123, membre:<uuid>, p-xxx. */
export function libelleNoeud(n: Noeud): string {
  const g = genreNoeud(n)
  const v = valeurNoeud(n)
  if (g === 'tg') return `u${v}`
  if (g === 'membre') return `membre:${v}`
  return v
}

/**
 * Les personnes trouvees. Union des noeuds touches par les seuls liens
 * CERTAINS (fermeture transitive sur les liens fournis) ; un groupe n'existe
 * que s'il contient au moins un noeud touche. Un lien probable ne reunit
 * jamais : il est attache a chaque groupe qu'il touche.
 */
export function grouper(touches: Touche[], liens: LienLu[]): Groupe[] {
  const parent = new Map<Noeud, Noeud>()
  const racine = (n: Noeud): Noeud => {
    let r = n
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as Noeud
    let c = n
    while (c !== r) {
      const suivant = parent.get(c) as Noeud
      parent.set(c, r)
      c = suivant
    }
    return r
  }
  const ajouter = (n: Noeud) => { if (!parent.has(n)) parent.set(n, n) }
  const unir = (a: Noeud, b: Noeud) => {
    const ra = racine(a)
    const rb = racine(b)
    if (ra === rb) return
    // La racine la plus petite gagne : le resultat ne depend pas de l'ordre.
    if (comparerNoeuds(ra, rb) <= 0) parent.set(rb, ra)
    else parent.set(ra, rb)
  }
  for (const t of touches) ajouter(t.noeud)
  for (const l of liens) {
    if (!l.certain || l.a === l.b) continue
    ajouter(l.a)
    ajouter(l.b)
    unir(l.a, l.b)
  }

  const touchees = new Set(touches.map((t) => racine(t.noeud)))
  const parRacine = new Map<Noeud, Noeud[]>()
  for (const n of parent.keys()) {
    const r = racine(n)
    if (!touchees.has(r)) continue
    const l = parRacine.get(r) ?? []
    l.push(n)
    parRacine.set(r, l)
  }

  const cleLien = (l: LienLu) => [l.a, l.b].sort().join('|') + '|' + l.nature
  const groupes: Groupe[] = []
  for (const noeuds of parRacine.values()) {
    const dedans = new Set(noeuds)
    const vus = new Set<string>()
    const certains: LienLu[] = []
    const probables: LienLu[] = []
    for (const l of liens) {
      const k = cleLien(l)
      if (vus.has(k)) continue
      if (l.certain && dedans.has(l.a) && dedans.has(l.b)) { vus.add(k); certains.push(l) }
      else if (!l.certain && (dedans.has(l.a) || dedans.has(l.b))) { vus.add(k); probables.push(l) }
    }
    const vusT = new Set<string>()
    const touchesDuGroupe = touches.filter((t) => {
      const k = `${t.noeud}|${t.champ}|${t.valeur}`
      if (!dedans.has(t.noeud) || vusT.has(k)) return false
      vusT.add(k)
      return true
    })
    groupes.push({ noeuds: noeuds.sort(comparerNoeuds), touches: touchesDuGroupe, certains, probables })
  }
  return groupes.sort((x, y) => comparerNoeuds(x.noeuds[0], y.noeuds[0]))
}

export function idsDuGroupe(g: Pick<Groupe, 'noeuds'>): { telegram: number[]; membres: string[]; archives: string[] } {
  const telegram: number[] = []
  const membres: string[] = []
  const archives: string[] = []
  for (const n of g.noeuds) {
    const g2 = genreNoeud(n)
    if (g2 === 'tg') { const id = Number(valeurNoeud(n)); if (Number.isSafeInteger(id) && id > 0) telegram.push(id) }
    else if (g2 === 'membre') membres.push(valeurNoeud(n))
    else if (g2 === 'archive') archives.push(valeurNoeud(n))
  }
  return { telegram, membres, archives }
}

/** « nom Telegram « Fred trader » (exact) ». Trois au plus par personne. */
export function phrasesTrouvePar(touches: Touche[], max = 3): string[] {
  const tri = [...touches].sort((x, y) => Number(y.exact) - Number(x.exact))
  const vus = new Set<string>()
  const r: string[] = []
  for (const t of tri) {
    const p = t.valeur ? `${t.champ} « ${t.valeur} »${t.exact ? ' (exact)' : ''}` : t.champ
    if (vus.has(p)) continue
    vus.add(p)
    r.push(p)
    if (r.length >= max) break
  }
  return r
}

/** « u123 et membre:<uuid> : rattachement metricgram ». */
export function phraseLien(l: LienLu): string {
  return `${libelleNoeud(l.a)} et ${libelleNoeud(l.b)} : ${l.nature}${l.certain ? '' : ' (PROBABLE, à confirmer)'}`
}

// --- Les candidats ----------------------------------------------------------

export const MAX_CANDIDATS = 10

/** Ce qu'il faut pour choisir entre plusieurs personnes, par noeud (cle = valeur du noeud). */
export type StatsCandidats = {
  messages: Record<string, { n: number; dernier: string | null }>
  present: Record<string, boolean | null>
  noms: Record<string, { nom: string | null; pseudo: string | null }>
  membres: Record<string, { nom: string | null; abonnement_en_cours: boolean | null; dernier_paiement: string | null }>
  archive: Record<string, { nom: string | null; messages: number | null; premier: string | null; dernier: string | null; nature: string | null }>
}

export type Candidat = {
  identifiant: string
  noms: string[]
  trouve_par: string[]
  messages_depuis_30_08: number
  dernier_message: string | null
  dans_le_groupe_live_club: boolean | null
  abonnement_en_cours: boolean | null
  archive: string | null
  liens_probables?: string[]
}

function nomAvecPseudo(nom: string | null | undefined, pseudo: string | null | undefined): string | null {
  if (nom && pseudo) return `${nom} (@${pseudo})`
  if (nom) return nom
  if (pseudo) return `@${pseudo}`
  return null
}

export function resumerCandidat(g: Groupe, s: StatsCandidats): Candidat & { _exact: boolean; _archiveDernier: string; _archiveMessages: number } {
  const noms: string[] = []
  let messages = 0
  let dernier: string | null = null
  let present: boolean | null = null
  let abonnement: boolean | null = null
  let archive: string | null = null
  let archiveDernier = ''
  let archiveMessages = 0
  for (const n of g.noeuds) {
    const v = valeurNoeud(n)
    const genre = genreNoeud(n)
    if (genre === 'tg') {
      const nom = nomAvecPseudo(s.noms[v]?.nom, s.noms[v]?.pseudo)
      noms.push(nom ? `${nom}, u${v}` : `u${v}`)
      messages += s.messages[v]?.n ?? 0
      const d = s.messages[v]?.dernier ?? null
      if (d && (!dernier || d > dernier)) dernier = d
      const p = s.present[v]
      if (p === true) present = true
      else if (p === false && present === null) present = false
    } else if (genre === 'membre') {
      const m = s.membres[v]
      noms.push(`fiche membre « ${m?.nom ?? '?'} »`)
      if (m?.abonnement_en_cours === true) abonnement = true
      else if (m?.abonnement_en_cours === false && abonnement === null) abonnement = false
    } else if (genre === 'archive') {
      const a = s.archive[v]
      noms.push(`archive « ${a?.nom ?? v} »`)
      archiveMessages += a?.messages ?? 0
      if ((a?.dernier ?? '') > archiveDernier) archiveDernier = a?.dernier ?? ''
      const bornes = a?.premier ? ` ${a.premier.slice(0, 7)} à ${(a.dernier ?? a.premier).slice(0, 7)}` : ''
      archive = `${a?.messages ?? 0} messages avant le 30/08${bornes}${a?.nature ? `, ${a.nature}` : ''}`
    }
  }
  return {
    identifiant: libelleNoeud(g.noeuds[0]),
    noms: noms.slice(0, 5),
    trouve_par: phrasesTrouvePar(g.touches),
    messages_depuis_30_08: messages,
    dernier_message: dernier,
    dans_le_groupe_live_club: present,
    abonnement_en_cours: abonnement,
    archive,
    ...(g.probables.length ? { liens_probables: g.probables.slice(0, 3).map(phraseLien) } : {}),
    _exact: g.touches.some((t) => t.exact),
    _archiveDernier: archiveDernier,
    _archiveMessages: archiveMessages,
  }
}

/**
 * Plusieurs personnes : la liste a montrer, la plus vivante d'abord (dans le
 * groupe, messages depuis le 30/08, abonnement en cours, reponse exacte,
 * archive recente). Le classement aide a lire, il ne choisit pas : l'agent
 * demande toujours laquelle.
 */
export function listerCandidats(groupes: Groupe[], s: StatsCandidats, max = MAX_CANDIDATS): { total: number; candidats: Candidat[] } {
  const r = groupes.map((g) => resumerCandidat(g, s))
  const b = (x: boolean | null) => (x === true ? 1 : 0)
  r.sort((x, y) =>
    b(y.dans_le_groupe_live_club) - b(x.dans_le_groupe_live_club)
    || y.messages_depuis_30_08 - x.messages_depuis_30_08
    || b(y.abonnement_en_cours) - b(x.abonnement_en_cours)
    || Number(y._exact) - Number(x._exact)
    || (y._archiveDernier > x._archiveDernier ? 1 : y._archiveDernier < x._archiveDernier ? -1 : 0)
    || y._archiveMessages - x._archiveMessages
    || (x.identifiant < y.identifiant ? -1 : x.identifiant > y.identifiant ? 1 : 0))
  return {
    total: r.length,
    candidats: r.slice(0, max).map(({ _exact, _archiveDernier, _archiveMessages, ...c }) => {
      void _exact; void _archiveDernier; void _archiveMessages
      return c
    }),
  }
}

// ---------------------------------------------------------------------------
// 3. Les noms successifs
// ---------------------------------------------------------------------------

export type NomLu = {
  telegram_id: number
  pseudo: string | null
  nom_affiche: string | null
  premier_vu: string
  dernier_vu: string
  source: string
}

export type NomSortie = { nom: string | null; pseudo: string | null; vu_du: string; vu_au: string; source: string }
export type NomsDuCompte = { compte: string; actuel: NomSortie; anciens: NomSortie[] }

const sortieNom = (n: NomLu): NomSortie => ({
  nom: n.nom_affiche, pseudo: n.pseudo, vu_du: n.premier_vu.slice(0, 10), vu_au: n.dernier_vu.slice(0, 10), source: n.source,
})

/**
 * Par compte : le nom ACTUEL (le dernier vu ; a egalite, le plus recemment
 * apparu) et les ANCIENS, du plus recent au plus ancien. Les dates sont celles
 * des OBSERVATIONS (collecte, evenement, message au bot), jamais la date du
 * changement : Telegram ne garde pas l'historique des noms.
 */
export function nomsSuccessifs(noms: NomLu[], maxAnciens = 20): NomsDuCompte[] {
  const parCompte = new Map<number, NomLu[]>()
  for (const n of noms) {
    const l = parCompte.get(n.telegram_id) ?? []
    l.push(n)
    parCompte.set(n.telegram_id, l)
  }
  const r: NomsDuCompte[] = []
  for (const [id, l] of [...parCompte.entries()].sort((x, y) => x[0] - y[0])) {
    const tri = [...l].sort((x, y) =>
      (y.dernier_vu > x.dernier_vu ? 1 : y.dernier_vu < x.dernier_vu ? -1 : 0)
      || (y.premier_vu > x.premier_vu ? 1 : y.premier_vu < x.premier_vu ? -1 : 0))
    r.push({ compte: `u${id}`, actuel: sortieNom(tri[0]), anciens: tri.slice(1, 1 + maxAnciens).map(sortieNom) })
  }
  return r
}

// ---------------------------------------------------------------------------
// 4. Les messages marquants
// ---------------------------------------------------------------------------

export type MessageLu = {
  chat_id: number
  message_id: number
  groupe: string
  sujet: string | null
  /** Heure de Paris, « AAAA-MM-JJ HH:MM ». */
  le: string
  /** Horodatage en millisecondes, pour trier. */
  t: number
  /** Le texte ou la legende (deja borne par la lecture), null = media seul. */
  texte: string | null
  /** La longueur du texte COMPLET en base. */
  longueur: number
  a_media: boolean
  type_media: string | null
}

export type Motif = 'premier' | 'long' | 'depart' | 'arrivee' | 'pause' | 'abonnement' | 'remerciement' | 'difficulte'

export const SEUIL_MARQUANT = 3
export const MIN_LONGUEUR_MOTIF = 15
export const LONGUEUR_LONG = 300
export const LONGUEUR_TRES_LONG = 700

/**
 * Les mots-cles, sur le texte normalise (minuscules, sans accents, apostrophe
 * droite). Un poids de 3 suffit seul a rendre un message marquant ; la
 * difficulte « faible » (perte, difficile...) est trop courante dans un salon
 * de trading pour suffire seule.
 */
const REGLES: { motif: Motif; poids: number; re: RegExp }[] = [
  {
    motif: 'depart', poids: 5,
    // « je retire » seul est un retrait d'argent (payout), « bonne continuation
    // a toi » salue le depart d'un AUTRE : ni l'un ni l'autre (calibre le 15/10
    // sur les 8 637 messages collectes).
    re: /\bje (vous )?quitte\b|\bquitter? (le|ce|du) (groupe|club|live|canal)|\bje me (retire|desabonne|desinscri)|\bje m'en vais\b|\bmon depart\b|\b(j'arrete|je stoppe) (le|mon|l'|les) ?(abonnement|live|club|groupe|trading)|\badieu\b|\bbonne continuation\b(?! a (toi|vous|lui|elle))/,
  },
  {
    motif: 'arrivee', poids: 4,
    re: /\bje me presente\b|\bje suis nouv(eau|elle)\b|\bnouv(eau|elle) (ici|membre|dans le groupe|parmi vous)\b|\bje viens (d'arriver|de (vous )?rejoindre|d'integrer|de m'abonner|de m'inscrire)|\b(ravie?|contente?|heureu(x|se)) (de (vous )?rejoindre|d'etre (parmi|ici))|\bmerci pour (l'|votre |ton )accueil/,
  },
  {
    motif: 'pause', poids: 3,
    // Pas « break » : en trading, c'est une cassure de structure.
    re: /\b(je|on|j'ai) (fais|fait|prends|prend|mets|met|me mets) (une |en )?pause\b|\ben pause\b|\bfaire une (pause|coupure)\b|\bpetite pause\b|\bje reviendrai\b|\bje reviens (bientot|dans|vers|apres)\b|\bje suis de retour\b|\bde retour (parmi|dans le|sur le|apres)\b|\bprendre du recul\b/,
  },
  {
    motif: 'abonnement', poids: 3,
    re: /abonnement|\babonnee?s?\b|desabonn|resili|prelevement|renouvel|\bfacture|rembours|\btarif|\bpaiement|\bcarte bancaire\b/,
  },
  {
    motif: 'remerciement', poids: 3,
    re: /\bje (vous |te )?remercie\b|\bun (grand|immense|enorme|gros) merci\b|\bmerci (beaucoup|infiniment|enormement|pour tout|pour vos|pour leurs|pour ton|pour votre)\b|\bmerci a (vous|tous|toutes|toi|l'equipe|mel|melanie|brice|@)|\bgratitude\b|\breconnaissante?\b/,
  },
  {
    motif: 'difficulte', poids: 3,
    re: /\bdecourag|\bdemotiv|\bdeprim|\bmalade\b|\bhopital\b|\bdeces\b|\bepuise|\bj'en ai marre\b|\bmarre\b|\bgalere|\b(manque|faute) de temps\b|\bpas (le|assez de) temps\b|\bplus le temps\b|\bprobleme(s)? perso|\bsoucis? (perso|de sante|familia)|\bje doute\b|\bj'ai peur\b|\bstress/,
  },
  {
    motif: 'difficulte', poids: 1,
    re: /\bdifficile\b|\bcompliqu|\bpertes?\b|\bperdu\b|\bcrame|\bdur\b/,
  },
]

/** Les apostrophes typographiques (U+2019, U+2018, U+02BC), ramenees a l'apostrophe droite. */
const APOSTROPHES = new RegExp(`[${String.fromCharCode(0x2019, 0x2018, 0x02bc)}]`, 'g')

export function texteNormalise(s: string): string {
  return normaliser(s.replace(APOSTROPHES, "'")).replace(/\s+/g, ' ')
}

/** Les motifs d'un texte et son score. Un texte trop court n'a que sa longueur. */
export function lireMotifs(texte: string | null, longueur: number): { motifs: Motif[]; score: number } {
  const motifs: Motif[] = []
  let score = 0
  if (texte && texte.trim().length >= MIN_LONGUEUR_MOTIF) {
    const t = texteNormalise(texte)
    for (const r of REGLES) {
      if (motifs.includes(r.motif)) continue
      if (r.re.test(t)) { motifs.push(r.motif); score += r.poids }
    }
  }
  if (longueur >= LONGUEUR_LONG) {
    motifs.push('long')
    score += longueur >= LONGUEUR_TRES_LONG ? 4 : 3
  }
  return { motifs, score }
}

export type MessageChoisi = MessageLu & { motifs: Motif[]; score: number }

const plusRecent = (x: MessageLu, y: MessageLu) => y.t - x.t || y.message_id - x.message_id

/**
 * Les N plus recents (medias compris), puis les MARQUANTS hors de ceux-la :
 * les premiers messages ecrits (un tiers des places au plus, deux au plus),
 * puis les meilleurs scores au-dessus du seuil (a egalite, le plus recent).
 * Chaque message n'apparait qu'une fois ; les recents portent aussi leurs
 * motifs. Marquants rendus dans l'ordre chronologique.
 */
export function choisirMessages(
  messages: MessageLu[], nbRecents: number, nbMarquants: number,
): { recents: MessageChoisi[]; marquants: MessageChoisi[] } {
  const tri = [...messages].sort(plusRecent)
  const avecMotifs: MessageChoisi[] = tri.map((m) => ({ ...m, ...lireMotifs(m.texte, m.longueur) }))
  const recents = avecMotifs.slice(0, Math.max(0, nbRecents))
  const pris = new Set(recents.map((m) => `${m.chat_id}/${m.message_id}`))
  const libre = (m: MessageChoisi) => !pris.has(`${m.chat_id}/${m.message_id}`)

  const nbPremiers = Math.min(2, Math.floor(Math.max(0, nbMarquants) / 3))
  const premiers: MessageChoisi[] = []
  for (let i = avecMotifs.length - 1; i >= 0 && premiers.length < nbPremiers; i--) {
    const m = avecMotifs[i]
    if (!m.texte || !libre(m)) continue
    premiers.push({ ...m, motifs: ['premier', ...m.motifs] })
    pris.add(`${m.chat_id}/${m.message_id}`)
  }
  const restants = Math.max(0, nbMarquants - premiers.length)
  const scores = avecMotifs
    .filter((m) => m.texte && libre(m) && m.score >= SEUIL_MARQUANT)
    .sort((x, y) => y.score - x.score || plusRecent(x, y))
    .slice(0, restants)
  const marquants = [...premiers, ...scores].sort((x, y) => x.t - y.t || x.message_id - y.message_id)
  return { recents, marquants }
}

// ---------------------------------------------------------------------------
// 5. La fiche et sa borne
// ---------------------------------------------------------------------------

/** Budget de la fiche : 12 000 caracteres de JSON (environ 3 500 jetons), sous le plafond de 14 000 de l'agent. */
export const BUDGET_FICHE = 12000

export type Ligne = Record<string, unknown>

export type FilSupport = {
  fil: string
  app: string | null
  nb_messages: number
  humain_demande_le: string | null
  cree_le: string | null
  maj_le: string | null
  derniers: { role: string | null; le: string | null; texte: string | null }[]
}

/** Ce que la lecture rassemble pour UNE personne (fiche-personne.ts). */
export type DonneesFiche = {
  trouvePar: string[]
  /** Les comptes Telegram de la personne (liens certains seulement). */
  telegram: number[]
  liens: string[]
  liensProbables: string[]
  identite: { noms: NomLu[]; registre: Ligne[]; membres: Ligne[]; emails: Ligne[]; archive: Ligne[] }
  liveClub: {
    abonnements: Ligne[]; exemptions: Ligne[]; acces_broker: Ligne[]; tarifs_reserves: Ligne[]
    acces_manuel: Ligne[]; etm: Ligne[]; rattachements: Ligne[]; gestes_total: number; gestes: Ligne[]
  }
  archive: { vies: Ligne[]; themes: Ligne[]; paroles: Ligne[] }
  notes: Ligne[]
  messages: { total: number; par_groupe: Ligne[]; par_sujet: Ligne[]; liste: MessageLu[] }
  support: FilSupport[]
  /** Comptes effaces a leur demande (cockpit_telegram_oublis) : { compte, oublie_le }. */
  oublis: Ligne[]
}

export type Palier = {
  recents: number; marquants: number; texteRecent: number; texteMarquant: number
  vies: number; texteVie: number; paroles: number; texteParole: number
  notes: number; texteNote: number; support: number; texteSupport: number
  gestes: number; sujets: number; anciensNoms: number
}

export const PALIERS: Palier[] = [
  { recents: 6, marquants: 10, texteRecent: 300, texteMarquant: 500, vies: 6, texteVie: 250, paroles: 5, texteParole: 300, notes: 5, texteNote: 250, support: 8, texteSupport: 250, gestes: 10, sujets: 8, anciensNoms: 20 },
  { recents: 5, marquants: 8, texteRecent: 220, texteMarquant: 350, vies: 5, texteVie: 200, paroles: 4, texteParole: 220, notes: 4, texteNote: 200, support: 6, texteSupport: 200, gestes: 8, sujets: 6, anciensNoms: 15 },
  { recents: 4, marquants: 6, texteRecent: 160, texteMarquant: 250, vies: 4, texteVie: 160, paroles: 3, texteParole: 160, notes: 3, texteNote: 150, support: 4, texteSupport: 150, gestes: 6, sujets: 5, anciensNoms: 10 },
  { recents: 3, marquants: 5, texteRecent: 120, texteMarquant: 180, vies: 3, texteVie: 120, paroles: 2, texteParole: 120, notes: 2, texteNote: 120, support: 3, texteSupport: 120, gestes: 4, sujets: 4, anciensNoms: 8 },
  { recents: 2, marquants: 3, texteRecent: 80, texteMarquant: 120, vies: 2, texteVie: 80, paroles: 1, texteParole: 80, notes: 1, texteNote: 80, support: 2, texteSupport: 80, gestes: 3, sujets: 3, anciensNoms: 5 },
]

/** Coupe un texte a `max` caracteres, « ... » compris. */
export function couper(t: string | null | undefined, max: number): string | null {
  if (t === null || t === undefined) return null
  const s = String(t)
  if (s.length <= max) return s
  if (max <= 3) return s.slice(0, Math.max(0, max))
  return `${s.slice(0, max - 3).trimEnd()}...`
}

function couperChamp(l: Ligne[], champ: string, max: number): Ligne[] {
  return l.map((x) => ({ ...x, [champ]: couper(x[champ] as string | null | undefined, max) }))
}

function sortieMessage(m: MessageChoisi, max: number): Ligne {
  const texte = couper(m.texte, max)
  return {
    le: m.le,
    groupe: m.groupe,
    ...(m.sujet ? { sujet: m.sujet } : {}),
    texte,
    ...(m.texte !== null && m.longueur > (texte?.length ?? 0) ? { longueur: m.longueur } : {}),
    ...(m.a_media ? { media: m.type_media ?? 'autre' } : {}),
    ...(m.motifs.length ? { motifs: m.motifs } : {}),
    ref: `${m.chat_id}:${m.message_id}`,
  }
}

/** Les paroles d'archive : les dernieres, puis les longues, puis les premieres, rendues dans l'ordre des dates. */
export function choisirParoles(paroles: Ligne[], n: number): Ligne[] {
  const ordre: Record<string, number> = { dernier: 0, long: 1, premier: 2 }
  return [...paroles]
    .sort((x, y) => (ordre[String(x.rang)] ?? 9) - (ordre[String(y.rang)] ?? 9))
    .slice(0, Math.max(0, n))
    .sort((x, y) => String(x.dit_le ?? '').localeCompare(String(y.dit_le ?? '')))
}

export const REGLE_MARQUANTS =
  'Sans IA : les premiers messages, les longs (300 caractères et plus), et ceux qui parlent d\'arrivée, de départ, '
  + 'de pause, d\'abonnement, de remerciement ou de difficulté (mots-clés). Les récents ne sont pas répétés.'

/** La fiche composee a un palier donne (aucune borne ici : voir fichePourAgent). */
export function composerFiche(d: DonneesFiche, p: Palier): Ligne {
  const { recents, marquants } = choisirMessages(d.messages.liste, p.recents, p.marquants)
  const noms = nomsSuccessifs(d.identite.noms, p.anciensNoms)
  return {
    statut: 'fiche',
    trouve_par: d.trouvePar,
    identite: {
      telegram: d.telegram.map((x) => `u${x}`),
      noms_successifs: noms,
      registre_du_groupe: d.identite.registre,
      membres: d.identite.membres,
      emails: d.identite.emails,
      archive: d.identite.archive,
      liens: d.liens,
      ...(d.liensProbables.length ? { liens_probables: d.liensProbables } : {}),
    },
    live_club: {
      abonnements: d.liveClub.abonnements,
      exemptions: d.liveClub.exemptions,
      acces_broker: d.liveClub.acces_broker,
      tarifs_reserves: d.liveClub.tarifs_reserves,
      acces_manuel: d.liveClub.acces_manuel,
      etm: d.liveClub.etm,
      rattachements: d.liveClub.rattachements,
      gestes_total: d.liveClub.gestes_total,
      gestes_derniers: d.liveClub.gestes.slice(0, p.gestes),
    },
    archive: {
      vies: couperChamp(d.archive.vies.slice(0, p.vies), 'extrait', p.texteVie),
      themes: d.archive.themes,
      paroles: couperChamp(choisirParoles(d.archive.paroles, p.paroles), 'texte', p.texteParole),
    },
    notes_equipe: couperChamp(d.notes.slice(0, p.notes), 'texte', p.texteNote),
    messages: {
      depuis: '2026-08-30',
      ...(d.oublis.length ? { effaces_a_sa_demande: d.oublis } : {}),
      total: d.messages.total,
      lus: d.messages.liste.length,
      par_groupe: d.messages.par_groupe,
      par_sujet: d.messages.par_sujet.slice(0, p.sujets),
      recents: recents.map((m) => sortieMessage(m, p.texteRecent)),
      marquants: marquants.map((m) => sortieMessage(m, p.texteMarquant)),
      regle_marquants: REGLE_MARQUANTS,
    },
    support: d.support.map((f) => ({
      ...f,
      derniers: (p.support > 0 ? f.derniers.slice(-p.support) : []).map((m) => ({ ...m, texte: couper(m.texte, p.texteSupport) })),
    })),
  }
}

/** Ce qu'on retire, dans cet ordre, quand meme le dernier palier deborde. */
const DERNIERS_RECOURS: { nom: string; retirer: (f: Ligne) => void }[] = [
  { nom: 'support', retirer: (f) => { f.support = (f.support as Ligne[]).map((x) => ({ ...x, derniers: [] })) } },
  { nom: 'archive.paroles', retirer: (f) => { (f.archive as Ligne).paroles = [] } },
  { nom: 'archive.vies', retirer: (f) => { (f.archive as Ligne).vies = [] } },
  { nom: 'notes_equipe', retirer: (f) => { f.notes_equipe = [] } },
  { nom: 'live_club.gestes_derniers', retirer: (f) => { (f.live_club as Ligne).gestes_derniers = [] } },
  { nom: 'messages.recents', retirer: (f) => { (f.messages as Ligne).recents = [] } },
  { nom: 'messages.marquants', retirer: (f) => { (f.messages as Ligne).marquants = [] } },
  { nom: 'messages.par_sujet', retirer: (f) => { (f.messages as Ligne).par_sujet = [] } },
  { nom: 'archive.themes', retirer: (f) => { (f.archive as Ligne).themes = [] } },
  {
    nom: 'identite.noms_successifs (anciens)',
    retirer: (f) => {
      const id = f.identite as Ligne
      id.noms_successifs = (id.noms_successifs as NomsDuCompte[]).map((n) => ({ ...n, anciens: n.anciens.slice(0, 2) }))
    },
  },
  {
    nom: 'live_club et identite (listes au plus 2)',
    retirer: (f) => {
      for (const s of [f.live_club as Ligne, f.identite as Ligne]) {
        for (const [k, v] of Object.entries(s)) if (Array.isArray(v)) s[k] = v.slice(0, 2)
      }
      f.support = (f.support as Ligne[]).slice(0, 1)
    },
  },
]

const NOTE_BORNE =
  'Textes coupés (« ... », longueur = taille complète) : un message entier se lit par requete_sql sur '
  + 'cockpit_telegram_messages (ref = chat_id:message_id). Fiche raccourcie : demande une section précise par requete_sql.'

/**
 * La fiche en JSON, au plus `budget` caracteres : le premier palier qui tient,
 * sinon le dernier allege section par section (DERNIERS_RECOURS), sinon
 * l'identite seule. Jamais un JSON coupe au milieu.
 */
export function fichePourAgent(d: DonneesFiche, budget = BUDGET_FICHE): string {
  const avecBorne = (f: Ligne, palier: number, retire: string[]): string => JSON.stringify({
    ...f,
    borne: {
      budget, palier, raccourcie: palier > 0 || retire.length > 0,
      ...(retire.length ? { retire } : {}),
      note: NOTE_BORNE,
    },
  })
  for (let i = 0; i < PALIERS.length; i++) {
    const s = avecBorne(composerFiche(d, PALIERS[i]), i, [])
    if (s.length <= budget) return s
  }
  const dernier = PALIERS.length - 1
  const f = composerFiche(d, PALIERS[dernier])
  const retire: string[] = []
  for (const r of DERNIERS_RECOURS) {
    r.retirer(f)
    retire.push(r.nom)
    const s = avecBorne(f, dernier, retire)
    if (s.length <= budget) return s
  }
  // L'identite seule, coupee si besoin : cas pathologique (des dizaines de comptes).
  const minimal = JSON.stringify({
    statut: 'fiche',
    trouve_par: d.trouvePar.slice(0, 3).map((x) => couper(x, 120)),
    identite: {
      telegram: d.telegram.slice(0, 5).map((x) => `u${x}`),
      noms_successifs: nomsSuccessifs(d.identite.noms, 0).slice(0, 5),
      liens: d.liens.slice(0, 5).map((x) => couper(x, 160)),
    },
    messages: { total: d.messages.total, ...(d.oublis.length ? { effaces_a_sa_demande: d.oublis.slice(0, 3) } : {}) },
    borne: { budget, palier: dernier, raccourcie: true, retire: ['tout sauf l\'identité'], note: NOTE_BORNE },
  })
  if (minimal.length <= budget) return minimal
  return JSON.stringify({
    statut: 'fiche',
    erreur: 'Fiche trop grande même réduite : interroge les tables par requete_sql (cockpit_telegram_noms, cockpit_telegram_messages).',
    borne: { budget, raccourcie: true },
  })
}

/** Rien de connu sur ce groupe (un numero ou un identifiant qui n'est nulle part). */
export function ficheVide(d: DonneesFiche): boolean {
  const i = d.identite
  const l = d.liveClub
  return i.noms.length === 0 && i.registre.length === 0 && i.membres.length === 0 && i.archive.length === 0
    && d.messages.total === 0 && l.rattachements.length === 0 && l.gestes_total === 0 && l.exemptions.length === 0
    && l.acces_broker.length === 0 && l.tarifs_reserves.length === 0 && d.support.length === 0
    && d.oublis.length === 0
}

/** Les messages tels que la lecture les rend en JSON (champs nuls retires), en MessageLu. */
export function lireMessagesJson(l: unknown): MessageLu[] {
  if (!Array.isArray(l)) return []
  const r: MessageLu[] = []
  for (const x of l as Ligne[]) {
    const chat = Number(x.chat_id)
    const id = Number(x.message_id)
    if (!Number.isFinite(chat) || !Number.isFinite(id)) continue
    const texte = typeof x.texte === 'string' ? x.texte : null
    r.push({
      chat_id: chat,
      message_id: id,
      groupe: typeof x.groupe === 'string' ? x.groupe : '?',
      sujet: typeof x.sujet === 'string' ? x.sujet : null,
      le: typeof x.le === 'string' ? x.le : '',
      t: Number(x.t) || 0,
      texte,
      longueur: Number(x.longueur) || (texte ? texte.length : 0),
      a_media: x.a_media === true,
      type_media: typeof x.type_media === 'string' ? x.type_media : null,
    })
  }
  return r
}

/** La reponse quand plusieurs personnes correspondent. */
export function reponseCandidats(qui: string, groupes: Groupe[], s: StatsCandidats): string {
  const { total, candidats } = listerCandidats(groupes, s)
  return JSON.stringify({
    statut: 'plusieurs',
    qui,
    total,
    candidats,
    ...(total > candidats.length ? { autres: total - candidats.length } : {}),
    consigne: 'Plusieurs personnes correspondent. Ne choisis pas : montre-les à ton interlocuteur (nom, ce qui les distingue) '
      + 'et demande laquelle, puis rappelle fiche_personne avec son identifiant. Un lien PROBABLE (par le nom ou le pseudo '
      + 'déclaré au paiement) n\'est jamais une preuve.',
  })
}

export const OU_ON_A_CHERCHE =
  'historique des noms Telegram (tous les noms passés), registre du groupe Live Club, auteurs des messages des groupes, '
  + 'archive (nom, alias, pseudo), fiches membres (nom, pseudo déclaré au paiement), contacts posés à la main, emails '
  + '(fiches membres, rattachements, accès broker, tarifs réservés, fil Support)'

export function reponseAucun(qui: string, indices: string[] = []): string {
  return JSON.stringify({
    statut: 'aucun',
    qui,
    cherche_dans: OU_ON_A_CHERCHE,
    ...(indices.length ? { indices } : {}),
    consigne: 'Personne trouvée. Dis où tu as cherché ; propose une autre orthographe, un ancien nom, le @pseudo ou le numéro '
      + 'Telegram. Ne conclus pas qu\'elle n\'existe pas.',
  })
}
