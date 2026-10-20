// L'API DE TAB : la partie PURE (20/10/2026). Dates a l'heure de Paris,
// periodes, pagination, montants, enveloppe des reponses. Aucun reseau.
//
// Tab est l'assistant IA personnel de Brice (WhatsApp, mails, Telegram) : il
// lit le cockpit par /api/tab/v1/..., en LECTURE SEULE, avec une cle.

export const FUSEAU = 'Europe/Paris'
export const LIMITE_DEFAUT = 50
export const LIMITE_MAX = 500
export const DEBIT_PAR_MINUTE = 60

const JOUR = /^\d{4}-\d{2}-\d{2}$/

/** Le jour de Paris d'un instant, AAAA-MM-JJ. */
export function jourParis(d: Date = new Date()): string {
  return d.toLocaleDateString('sv-SE', { timeZone: FUSEAU })
}

/** L'heure de Paris lisible : « 20/10/2026 15:42 ». */
export function heureParisLisible(d: Date = new Date()): string {
  return d.toLocaleString('fr-FR', { timeZone: FUSEAU, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function jourValide(j: string): boolean {
  if (!JOUR.test(j)) return false
  const d = new Date(`${j}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === j
}

/** Decale un jour AAAA-MM-JJ de n jours (calendrier, sans fuseau). */
export function decalerJour(j: string, n: number): string {
  const d = new Date(`${j}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function joursDuMois(mois: string): number {
  const [a, m] = mois.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}

export function moisPrecedent(mois: string): string {
  const [a, m] = mois.split('-').map(Number)
  return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7)
}

/** Le meme jour un mois plus tot, borne a la fin du mois (31/10 -> 30/09). */
export function unMoisAvant(j: string): string {
  const mois = moisPrecedent(j.slice(0, 7))
  const jour = Math.min(Number(j.slice(8, 10)), joursDuMois(mois))
  return `${mois}-${String(jour).padStart(2, '0')}`
}

/** Lundi de la semaine d'un jour (semaine francaise). */
export function lundiDe(j: string): string {
  const d = new Date(`${j}T00:00:00Z`)
  const ecart = (d.getUTCDay() + 6) % 7
  return decalerJour(j, -ecart)
}

const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

export function jourLisible(j: string): string {
  const [a, m, d] = j.split('-').map(Number)
  return `${d === 1 ? '1er' : d} ${MOIS_LONGS[m - 1]} ${a}`
}

export function moisLisible(mois: string): string {
  const [a, m] = mois.split('-').map(Number)
  return `${MOIS_LONGS[m - 1]} ${a}`
}

export type DefautPeriode = 'mois' | 'semaine' | '7j' | '30j' | 'jour' | 'tout'

export type Periode = { du: string; au: string; fuseau: string; libelle: string; par_defaut: boolean }

/**
 * La periode demandee (du / au, AAAA-MM-JJ, heure de Paris, bornes incluses),
 * ou celle par defaut de la route. Une chaine = le message d'erreur (400).
 */
export function lirePeriode(params: URLSearchParams, defaut: DefautPeriode, aujourdhui = jourParis()): Periode | string {
  const du = params.get('du')?.trim() || null
  const au = params.get('au')?.trim() || null
  if (du && !jourValide(du)) return 'du : au format AAAA-MM-JJ (heure de Paris).'
  if (au && !jourValide(au)) return 'au : au format AAAA-MM-JJ (heure de Paris).'
  let debut: string
  let fin: string
  if (du || au) {
    fin = au ?? aujourdhui
    debut = du ?? fin.slice(0, 8) + '01'
  } else {
    fin = aujourdhui
    debut = defaut === 'mois' ? `${aujourdhui.slice(0, 7)}-01`
      : defaut === 'semaine' ? lundiDe(aujourdhui)
      : defaut === '7j' ? decalerJour(aujourdhui, -6)
      : defaut === '30j' ? decalerJour(aujourdhui, -29)
      : defaut === 'jour' ? aujourdhui
      : '2000-01-01'
    if (defaut === 'semaine') fin = decalerJour(debut, 6)
  }
  if (debut > fin) return 'du doit précéder au.'
  const libelle = debut === '2000-01-01' ? `tout l'historique jusqu'au ${jourLisible(fin)}`
    : debut === fin ? `le ${jourLisible(debut)}`
    : `du ${jourLisible(debut)} au ${jourLisible(fin)}`
  return { du: debut, au: fin, fuseau: FUSEAU, libelle, par_defaut: !(du || au) }
}

export type Pagination = { limite: number; decalage: number }

/** limite (1 a 500, 50 par defaut) et curseur (opaque, rendu par la page precedente). */
export function lirePagination(params: URLSearchParams, limiteDefaut = LIMITE_DEFAUT): Pagination | string {
  const l = params.get('limite')
  let limite = limiteDefaut
  if (l !== null && l !== '') {
    const n = Number(l)
    if (!Number.isInteger(n) || n < 1) return 'limite : un entier de 1 à 500.'
    limite = Math.min(n, LIMITE_MAX)
  }
  const c = params.get('curseur')
  let decalage = 0
  if (c) {
    const d = lireCurseur(c)
    if (d === null) return 'curseur illisible : reprends celui rendu par la page précédente (pagination.curseur_suivant).'
    decalage = d
  }
  return { limite, decalage }
}

export function curseur(decalage: number): string {
  return Buffer.from(`o:${decalage}`, 'utf8').toString('base64url')
}

export function lireCurseur(c: string): number | null {
  try {
    const t = Buffer.from(c, 'base64url').toString('utf8')
    const m = /^o:(\d{1,7})$/.exec(t)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

/** La pagination d'une liste lue avec limite + 1 lignes. */
export function paginer<T>(lignes: T[], p: Pagination, total?: number | null) {
  const encore = lignes.length > p.limite
  const page = encore ? lignes.slice(0, p.limite) : lignes
  return {
    page,
    pagination: {
      limite: p.limite,
      rendues: page.length,
      ...(total !== undefined && total !== null ? { total } : {}),
      curseur_suivant: encore ? curseur(p.decalage + p.limite) : null,
      aide: encore ? 'Il y a une suite : rappelle la même adresse avec curseur=<curseur_suivant>.' : 'Fin de la liste.',
    },
  }
}

/** Un montant en euros, arrondi au centime (nombre). */
export function centimes(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Le libelle d'un montant comme le cockpit l'affiche dans ses tuiles : euros entiers, « 4 566 € ». */
export function eurosTuile(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'non mesuré'
  return `${Math.round(v).toLocaleString('fr-FR').replace(/ | /g, ' ')} €`
}

/** Le libelle d'un montant au centime, « 49,90 € ». */
export function eurosExact(v: number | null | undefined, devise = 'EUR'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'non mesuré'
  const s = v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, ' ')
  return devise === 'EUR' ? `${s} €` : devise === 'USD' ? `${s} $` : `${s} ${devise}`
}

export function pourcentage(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null
  return `${v >= 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} %`
}

/** Coupe un texte. */
export function couper(t: string | null | undefined, max: number): string | null {
  if (t === null || t === undefined) return null
  const s = String(t)
  return s.length <= max ? s : `${s.slice(0, max - 3).trimEnd()}...`
}

/** JSON sans BigInt ni Date brute (Date -> ISO). */
export function versJson(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)))
}

/** Un nom de colonne ou de table sur : lettres, chiffres, soulignes. */
export const IDENTIFIANT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/

/** Les colonnes et tables JAMAIS rendues : secrets, jetons, hachages, adresses IP. */
export const COLONNE_SECRETE = /(^|_)(token|jeton|secret|hash|hache|hachee|empreinte|nonce|password|mot_de_passe|api_key|cle_api|code_hash)($|_)|^ip$|_key$|^learnybox_api_key$/i

export const TABLES_EXCLUES = new Set([
  'cockpit_liveclub_codes', 'cockpit_liveclub_codes_adresses', 'cockpit_liveclub_jetons', 'cockpit_oublis_emails',
  'cockpit_tab_cles', 'cockpit_allowlist', 'cockpit_telegram_comptes', 'cockpit_agent_conversations',
  'cockpit_agent_cartes', 'cockpit_liveclub_conversations', 'quiz_reponses_debit',
])

/** Les tables et vues du perimetre generique : celles du cockpit, de l'academie, et AiUsage. */
export function tableLisible(nom: string): boolean {
  if (TABLES_EXCLUES.has(nom)) return false
  return /^cockpit_/.test(nom) || /^academie_/.test(nom) || nom === 'AiUsage' || nom === 'upcoming_sessions'
}
