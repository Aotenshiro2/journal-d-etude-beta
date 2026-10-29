// Les heures « telles qu'affichées » d'un export, ramenées à de vrais instants
// (29/10/2026, suite du brief A). Fonctions PURES, aucun import, aucune
// bibliothèque : Intl suffit. scripts/verifier-imports-trades.mjs les charge
// telles quelles.
//
// Tradovate (rapport Performance) et beaucoup de CSV écrivent l'heure de
// l'écran du trader, sans décalage. Seules, ces heures ne se comparent pas aux
// segments du Carnet (de vrais instants) : un trade de 15:30 à Paris en été
// est à 13:30 UTC. Quand le membre donne son fuseau (nom IANA, « Europe/Paris »),
// on interprète ces heures locales dans ce fuseau. Sans fuseau : rien ne change.

const formats = new Map<string, Intl.DateTimeFormat>()

/** Un format par fuseau, gardé : un gros export en demande des dizaines de milliers. */
function formatDe(timeZone: string): Intl.DateTimeFormat {
  let f = formats.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    formats.set(timeZone, f)
  }
  return f
}

/** Le nom IANA reconnu (forme canonique, « europe/paris » donne « Europe/Paris »), ou null. */
export function nomFuseau(brut: string): string | null {
  const s = brut.trim()
  if (!s || s.length > 64) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: s }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

/**
 * Le champ `fuseau` d'une requête d'import : absent ou vide = null (rien ne
 * change), reconnu = son nom canonique, sinon le message d'erreur à rendre (400).
 */
export function fuseauDemande(brut: unknown): { fuseau: string | null } | { erreur: string } {
  if (brut === undefined || brut === null || brut === '') return { fuseau: null }
  const nom = typeof brut === 'string' ? nomFuseau(brut) : null
  if (nom) return { fuseau: nom }
  return { erreur: `Fuseau inconnu : « ${String(brut).slice(0, 64)} ». Donne un nom IANA, par exemple Europe/Paris ou America/New_York.` }
}

/** Le décalage du fuseau à un instant donné, en ms (heure locale moins UTC : +7 200 000 à Paris en été). */
export function decalageMs(timeZone: string, instant: number): number {
  const p: Record<string, string> = {}
  for (const x of formatDe(timeZone).formatToParts(new Date(instant))) p[x.type] = x.value
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  const seconde = instant - (((instant % 1000) + 1000) % 1000) // formatToParts ignore les ms
  return local - seconde
}

/**
 * L'instant réel d'une heure locale. `naif` porte l'heure telle qu'affichée,
 * codée comme si elle était UTC (c'est ce que rendent les lecteurs). Deux
 * passes : le décalage pris à l'heure naïve peut être celui d'avant ou
 * d'après un changement d'heure, on le recalcule à l'instant trouvé. Une heure
 * qui n'existe pas (passage à l'heure d'été) ou qui existe deux fois (retour à
 * l'heure d'hiver) donne l'un des deux instants possibles, sans erreur.
 */
export function instantDepuisHeureLocale(naif: Date, timeZone: string): Date {
  const t = naif.getTime()
  const d1 = decalageMs(timeZone, t)
  const d2 = decalageMs(timeZone, t - d1)
  return new Date(t - d2)
}

/**
 * Les trades dont les heures sont « telles qu'affichées » (`fuseau` absent ou
 * null) passent dans le fuseau donné, qui est écrit dans `fuseau`. Ceux dont
 * le fichier donnait un décalage ne bougent pas. `idExterne` ne bouge jamais :
 * le même fichier importé avec ou sans fuseau reste reconnu (dédoublonnage).
 */
export function appliquerFuseau<T extends { entreLe: Date; sortiLe: Date | null; fuseau?: string | null }>(trades: T[], timeZone: string): T[] {
  return trades.map(t => (t.fuseau
    ? t
    : {
      ...t,
      entreLe: instantDepuisHeureLocale(t.entreLe, timeZone),
      sortiLe: t.sortiLe ? instantDepuisHeureLocale(t.sortiLe, timeZone) : null,
      fuseau: timeZone,
    }))
}
