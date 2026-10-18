// Les gestes du cockpit sur les acces a l'academie (18/10/2026) : accorder
// une offre (un module seul, la formation complete...) a un email, avec une
// raison et une date de fin facultative, ou retirer un acces, avec une raison.
//
// Fonctions PURES (aucune base, aucun reseau, aucun alias d'import) : la route
// /api/cockpit/academie les appelle, scripts/verifier-gestes-academie.mjs les
// teste avec Node seul, comme pur.ts.
//
// L'acces se pose dans academie_acces, source 'offert', pose_par
// 'cockpit:<uuid>' : droitsAcademie (droits.ts, SQL_ACCES) le lit deja, sans
// rien changer, des que l'eleve se connecte avec cet email VERIFIE. Retirer
// pose retire_le et retire_par, jamais de delete (la ligne reste la trace).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const JOUR_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Longueur maximale d'une raison (la colonne note en tient 1 000, on garde de la marge pour le retrait). */
export const MAX_RAISON = 400

export type GesteAccorder = {
  action: 'accorder'
  email: string
  offre: string
  /** Dernier jour d'acces (YYYY-MM-DD, inclus, heure de Paris), ou null = a vie. */
  fin: string | null
  raison: string
}

export type GesteRetirer = {
  action: 'retirer'
  accesId: string
  raison: string
}

export type Geste = GesteAccorder | GesteRetirer

/** Un jour civil valide (2026-02-30 refuse). */
export function jourValide(v: string): boolean {
  const m = JOUR_RE.exec(v)
  if (!m) return false
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(a, mo - 1, j))
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j
}

function texte(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Lit le corps d'une demande. Rend le geste, ou { erreur } (message pour
 * l'ecran). aujourdhui = 'YYYY-MM-DD' (heure de Paris) : une fin passee est
 * refusee, une fin aujourd'hui est acceptee (acces jusqu'a ce soir).
 */
export function lireGeste(corps: unknown, aujourdhui: string): Geste | { erreur: string } {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  const raison = texte(c.raison)
  if (!raison) return { erreur: 'Une raison est demandée.' }
  if (raison.length > MAX_RAISON) return { erreur: `Raison trop longue (${MAX_RAISON} caractères au plus).` }

  if (c.action === 'accorder') {
    const email = texte(c.email).toLowerCase()
    if (!EMAIL_RE.test(email) || email.length > 320) return { erreur: 'Email invalide.' }
    const offre = texte(c.offre)
    if (!SLUG_RE.test(offre) || offre.length > 80) return { erreur: 'Offre invalide.' }
    let fin: string | null = null
    if (c.fin !== undefined && c.fin !== null && c.fin !== '') {
      const f = texte(c.fin)
      if (!jourValide(f)) return { erreur: 'Date de fin invalide (AAAA-MM-JJ).' }
      if (f < aujourdhui) return { erreur: 'La date de fin est déjà passée.' }
      fin = f
    }
    return { action: 'accorder', email, offre, fin, raison }
  }

  if (c.action === 'retirer') {
    const accesId = texte(c.acces_id)
    if (!UUID_RE.test(accesId)) return { erreur: 'Accès invalide.' }
    return { action: 'retirer', accesId: accesId.toLowerCase(), raison }
  }

  return { erreur: 'action (accorder | retirer) requise.' }
}

/** pose_par / retire_par d'un geste du cockpit. */
export function acteurCockpit(userId: string): string {
  return `cockpit:${userId}`
}

/** La note d'un acces accorde : la raison telle quelle. */
export function noteAccorder(raison: string): string {
  return raison.slice(0, 1000)
}

/**
 * Ce que le retrait ajoute a la note (SQL_GESTE_RETIRER le colle apres
 * l'ancienne note, qu'il tronque pour que la raison du retrait tienne).
 */
export function ajoutRetrait(raison: string): string {
  return `Retrait : ${raison}`.slice(0, 1000)
}

/** Le jour de Paris d'un instant, 'YYYY-MM-DD'. */
export function jourParis(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
