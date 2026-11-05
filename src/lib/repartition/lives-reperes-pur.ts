// LES LIVES REPERES DES INTERVENANTS (05/11/2026, GO de Brice) : la partie
// PURE. Aucune base, aucun reseau, aucun import : scripts/verifier-parrainage.mjs
// la charge telle quelle.
//
// La vue cockpit_lives_detectes (18/10) compte les jours ou le compte Telegram
// d'un intervenant (cockpit_intervenants.telegram_id, Adrien = 1392343532)
// poste un lien Zoom dans le sujet « Annonce » du Live Club. Elle pre-remplit
// « Déclarer les lives » du cockpit, mais personne n'y pense : octobre
// affichait « aucun ». Deux rappels :
// - chaque DIMANCHE, une ligne au resume du matin par intervenant : les lives
//   reperes cette semaine (lundi a dimanche) et ce mois-ci ;
// - au DEBUT du mois suivant, une carte pre-remplie a Brice et Melanie (meme
//   mecanisme que la carte des commissions de parrainage,
//   cartes-fin-de-mois.ts), dont le clic suit le chemin de la carte des lives
//   du mois (une seule declaration vivante par intervenant, produit et mois).
//   Deja declares : pas de carte.

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

function utc(jour: string): Date {
  return new Date(`${jour}T12:00:00Z`)
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** '2026-11-03' -> '3', '2026-11-01' -> '1er' (05/11 : jamais « 1 novembre »). */
export function numeroDuJour(jour: string): string {
  const n = Number(jour.slice(8, 10))
  return n === 1 ? '1er' : String(n)
}

/** 'mardi' pour '2026-10-13'. */
export function nomJour(jour: string): string {
  return JOURS[utc(jour).getUTCDay()]
}

/** Vrai le dimanche. */
export function estDimanche(jour: string): boolean {
  return utc(jour).getUTCDay() === 0
}

/** Le lundi de la semaine d'un jour (lundi a dimanche). */
export function lundiDe(jour: string): string {
  const d = utc(jour)
  const ecart = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - ecart)
  return iso(d)
}

/** '2026-11' -> '2026-10'. */
export function moisPrecedent(mois: string): string {
  const [a, m] = mois.split('-').map(Number)
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}

export function nomMoisLives(mois: string): string {
  return MOIS_FR[Number(mois.slice(5, 7)) - 1] ?? mois
}

/** « d'Adrien », « de Paul ». */
function deNom(nom: string): string {
  return /^[aeiouyhàâäéèêëîïôöûüAEIOUYHÀÂÄÉÈÊËÎÏÔÖÛÜ]/.test(nom) ? `d'${nom}` : `de ${nom}`
}

/** 7500 -> '75 €', 7550 -> '75,50 €'. */
function eurosCourts(centimes: number): string {
  const n = Number.isInteger(centimes / 100) ? String(centimes / 100) : (centimes / 100).toFixed(2).replace('.', ',')
  return `${n} €`
}

/**
 * La ligne du dimanche pour un intervenant, en minuscule et sans point final
 * (format des lignes du resume) : « 2 lives repérés cette semaine (mardi 14,
 * jeudi 16) ; 3 ce mois-ci ». Les jours sont ceux de ses liens Zoom dans
 * Annonce, sans doublon.
 */
export function ligneLivesSemaine(jours: readonly string[], aujourdhui: string): string {
  const uniques = [...new Set(jours)].sort()
  const lundi = lundiDe(aujourdhui)
  const semaine = uniques.filter(j => j >= lundi && j <= aujourdhui)
  const mois = uniques.filter(j => j.slice(0, 7) === aujourdhui.slice(0, 7) && j <= aujourdhui)
  const liste = semaine.map(j => `${nomJour(j)} ${numeroDuJour(j)}`).join(', ')
  const n = semaine.length
  return `${n} live${n > 1 ? 's' : ''} repéré${n > 1 ? 's' : ''} cette semaine${n ? ` (${liste})` : ''} ; ${mois.length} ce mois-ci`
}

/**
 * La carte de fin de mois des lives d'un intervenant : longue (Brice) et
 * courte (Mel). « Lives d'Adrien en octobre : 3 repérés (14, 21, 22/10), 3 x
 * 75 € = 225 €. Déclarer en dépense du Live Club ? »
 */
export function carteLives(o: {
  intervenant: string; mois: string; jours: readonly string[]; prixUnitaire: number; produit: string; complement?: string | null
}): { carte: string; court: string } {
  const uniques = [...new Set(o.jours)].sort()
  const n = uniques.length
  const jours = `${uniques.map(numeroDuJour).join(', ')}/${o.mois.slice(5, 7)}`
  const court = `Lives ${deNom(o.intervenant)} en ${nomMoisLives(o.mois)} : ${n} repéré${n > 1 ? 's' : ''} (${jours}), `
    + `${n} x ${eurosCourts(o.prixUnitaire)} = ${eurosCourts(n * o.prixUnitaire)}. Déclarer en dépense du ${o.produit} ?`
  const carte = `${court} Repérés par ses liens Zoom dans le sujet Annonce : un live annulé ou en double se corrige `
    + `en me redonnant le bon nombre.${o.complement ? ` ${o.complement}` : ''}`
  return { carte, court }
}

/** La memoire de la carte proposee d'elle-meme (une par intervenant, produit, mois et nombre). */
export function cleCarteLives(intervenant: string, offreId: string, mois: string, nombre: number): string {
  return `lives:${intervenant.trim().toLowerCase()}:${offreId}:${mois}:${nombre}`
}
