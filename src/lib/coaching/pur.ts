// MON COACHING : LA LOGIQUE PURE (09/11/2026). Brief
// D:\7_Agents\briefs\2026-11-09-mon-coaching-seances.md, migration
// sites/Aoknowledgecom/supabase/migrations/20261109140000_coaching_seances.sql.
//
// Ce fichier ne lit ni la base ni le reseau (seulement node:crypto pour la
// signature) : il est verifie hors ligne par scripts/verifier-coaching.mjs.
//   1. le calcul du reste (resumerCoaching) : quels droits, quelles seances,
//      combien il en reste, par coach et par famille de droits ;
//   2. ce que voit le membre (vueMembre) : les phrases, le prochain rendez-vous,
//      l'historique, le bouton pour reserver ;
//   3. le webhook de Cal : la signature (verifierSignatureCal) et la lecture
//      d'un evenement (lireEvenementCal), avec le rattachement par l'email de
//      l'invite (normaliserEmail, compteUnique) ;
//   4. le corps des gestes du cockpit (lireDemandeCockpit).
//
// LE CALCUL DU RESTE, EN HEURES (09/11/2026, suite : brief
// D:\7_Agents\briefs\2026-11-09-mon-coaching-reglages.md, migration
// 20261109200000_coaching_heures.sql). Tout se compte en MINUTES :
//   - un droit porte des minutes (pack 8 h = 480, ETM pose eleve par eleve,
//     12 h par defaut) tant qu'il n'est pas retire ;
//   - une seance prevue ou faite retire sa duree (30 min = 0,5 h). Une seance
//     ANNULEE NE RETIRE JAMAIS RIEN, annulee tot ou au dernier moment (Brice :
//     « Une annulation de derniere minute ne compte pas »). Un rendez-vous
//     manque sans prevenir reste prevu (« Passee ») et compte tant que l'equipe
//     ne le marque pas : « annulee » rend l'heure, « faite » la garde ;
//   - une seance liee a un droit (droit_id) prend d'abord sur lui (une heure
//     payee sur Cal consomme son propre droit) ;
//   - le reste de sa duree prend, dans l'ordre des dates, sur le droit le plus
//     ancien du meme coach qui a encore du temps, puis le suivant (une seance
//     peut se partager entre deux droits) ;
//   - ce qui ne trouve aucune place est « hors droits » (le cockpit le signale) ;
//   - une ligne par coach et par famille : le pack (par offre), l'ETM, les
//     heures a l'unite (offertes ou payees sur Cal). Un coach sans aucun droit
//     mais avec des seances a une ligne sans total.
// Les phrases : « 6 h restantes sur 8 h avec Brice », « 7,5 h », « 6 h 50 ».

import { createHmac, timingSafeEqual } from 'node:crypto'

export const COACHS = ['brice', 'melanie'] as const
export type Coach = (typeof COACHS)[number]
export const NOM_COACH: Record<Coach, string> = { brice: 'Brice', melanie: 'Mélanie' }
export const estCoach = (v: unknown): v is Coach => typeof v === 'string' && (COACHS as readonly string[]).includes(v)

export type SourceDroit = 'pack' | 'etm' | 'cal' | 'offert'
export type StatutSeance = 'prevue' | 'faite' | 'annulee'
export type SourceSeance = 'cal' | 'cockpit' | 'meet'
export const STATUTS_SEANCE: readonly StatutSeance[] = ['prevue', 'faite', 'annulee']

/** Un droit, tel que le rend la vue coaching_droits_tous. */
export type Droit = {
  id: string
  coach: Coach
  /** La quantite du droit en minutes (vue coaching_droits_tous, migration 20261109200000). */
  minutes?: number | null
  /** L'ancienne quantite en seances d'une heure : lue seulement si minutes manque. */
  seances?: number | null
  source: SourceDroit
  /** pack : le slug de l'offre ; cal : l'uid du rendez-vous ; sinon libre ou vide. */
  reference: string | null
  /** pack : son libelle (« Pack 8 h ») ; sinon vide. */
  libelle: string | null
  depuis: string | Date
  retire_le: string | Date | null
  email?: string | null
  note?: string | null
  pose_par?: string | null
}

/** Une seance, telle que la rend la table coaching_seances. */
export type Seance = {
  id: string
  coach: Coach
  debut: string | Date
  duree_min: number
  statut: StatutSeance
  source: SourceSeance
  droit_id: string | null
  email?: string | null
  note?: string | null
}

export type Famille = 'pack' | 'etm' | 'seances'

export type LigneCoaching = {
  /** coach:famille, ou coach:pack:<slug>. */
  cle: string
  coach: Coach
  famille: Famille
  /** Le slug du pack (famille pack), sinon null. */
  pack: string | null
  titre: string
  /** Le total des droits en minutes. null = aucun droit pour ce coach, seulement des seances. */
  total_min: number | null
  /** Les minutes prises sur cette ligne par les seances faites, puis prevues. */
  faites_min: number
  prevues_min: number
  /** total_min - faites_min - prevues_min, ou null sans droit. */
  restantes_min: number | null
  /** Le nombre de seances faites et prevues qui prennent sur cette ligne. */
  nb_faites: number
  nb_prevues: number
  phrase: string
  detail: string
}

export type StatutAffiche = 'prevue' | 'passee' | 'faite' | 'annulee'

export type SeanceResumee = Seance & {
  statut_affiche: StatutAffiche
  /** La ligne qui la decompte (celle qui en prend le plus), ou null : annulee, ou hors droits. */
  ligne: string | null
  /** Les minutes de cette seance qui n'ont trouve aucune place (0 le plus souvent). */
  hors_min: number
}

export type ResumeCoaching = {
  /** La rubrique se montre : au moins un droit en cours, ou une seance non annulee. */
  visible: boolean
  lignes: LigneCoaching[]
  prochain: SeanceResumee | null
  /** La plus recente d'abord. */
  historique: SeanceResumee[]
  /** Le nombre de seances prevues ou faites qui depassent les droits, par coach. */
  hors_droits: Record<Coach, number>
  /** Les minutes qui depassent les droits, par coach. */
  hors_droits_min: Record<Coach, number>
}

const ms = (d: string | Date) => (d instanceof Date ? d.getTime() : Date.parse(d))
const ORDRE_FAMILLE: Record<Famille, number> = { pack: 0, etm: 1, seances: 2 }

export function familleDe(d: Pick<Droit, 'source'>): Famille {
  return d.source === 'pack' ? 'pack' : d.source === 'etm' ? 'etm' : 'seances'
}

export function cleLigne(d: Pick<Droit, 'coach' | 'source' | 'reference'>): string {
  const f = familleDe(d)
  return f === 'pack' ? `${d.coach}:pack:${d.reference ?? ''}` : `${d.coach}:${f}`
}

const positif = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** La quantite d'un droit en minutes : minutes, ou l'ancienne quantite en seances d'une heure. 0 = rien. */
export function minutesDuDroit(d: Pick<Droit, 'minutes' | 'seances'>): number {
  const m = positif(d.minutes)
  if (m !== null) return m
  const n = positif(d.seances)
  return n !== null ? n * 60 : 0
}

/** La duree d'une seance en minutes, 0 si elle est illisible. */
const dureeDe = (x: Pick<Seance, 'duree_min'>): number => positif(x.duree_min) ?? 0

/**
 * Une duree en heures, a la francaise : « 8 h », « 7,5 h », « 0,5 h » (demi-heures
 * en decimal), « 6 h 50 », « 1 h 15 », « 50 min » (le reste).
 */
export function texteHeures(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m % 60 === 0) return `${m / 60} h`
  if (m % 30 === 0) return `${Math.floor(m / 60)},5 h`
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** Le pluriel qui suit une duree : a partir de 2 (2 h, 2,5 h, 50 min), jamais en dessous (1,5 h restante). */
const sDuree = (min: number) => {
  const m = Math.max(0, Math.round(min))
  return m >= 120 || (m < 60 && m % 30 !== 0 && m >= 2) ? 's' : ''
}

const s = (n: number) => (Math.abs(n) >= 2 ? 's' : '')

/** « 6 h restantes sur 8 h avec Brice », « 0,5 h restante sur 12 h avec Brice », « 0 h restante sur 8 h avec Brice ». */
export function phraseReste(restantesMin: number, totalMin: number, coach: Coach): string {
  return `${texteHeures(restantesMin)} restante${sDuree(restantesMin)} sur ${texteHeures(totalMin)} avec ${NOM_COACH[coach]}`
}

/** Un coach sans droit : « 2 h de coaching avec Mélanie ». */
export function phraseSansDroit(min: number, coach: Coach): string {
  return `${texteHeures(min)} de coaching avec ${NOM_COACH[coach]}`
}

/** « 2 séances faites, 1 prévue », « 1 séance prévue », « aucune séance pour l'instant ». */
export function detailSeances(faites: number, prevues: number): string {
  if (!faites && !prevues) return "aucune séance pour l'instant"
  if (!prevues) return `${faites} séance${s(faites)} faite${s(faites)}`
  if (!faites) return `${prevues} séance${s(prevues)} prévue${s(prevues)}`
  return `${faites} séance${s(faites)} faite${s(faites)}, ${prevues} prévue${s(prevues)}`
}

function titreLigne(famille: Famille, libelle: string | null): string {
  if (famille === 'pack') return libelle || 'Pack de coaching'
  if (famille === 'etm') return 'ETM'
  return 'Heures de coaching'
}

export function statutAffiche(se: Pick<Seance, 'statut' | 'debut'>, maintenant: number): StatutAffiche {
  if (se.statut === 'annulee') return 'annulee'
  if (se.statut === 'faite') return 'faite'
  return ms(se.debut) >= maintenant ? 'prevue' : 'passee'
}

export const LIBELLE_STATUT: Record<StatutAffiche, string> = {
  prevue: 'Prévue',
  passee: 'Passée',
  faite: 'Faite',
  annulee: 'Annulée',
}

/** Le calcul du reste, en minutes. maintenant en millisecondes (Date.now() par defaut). */
export function resumerCoaching(droits: Droit[], seances: Seance[], maintenant = Date.now()): ResumeCoaching {
  const actifs = droits
    .filter(d => !d.retire_le && estCoach(d.coach) && minutesDuDroit(d) > 0)
    .sort((a, b) => ms(a.depuis) - ms(b.depuis) || a.id.localeCompare(b.id))
  const capacite = new Map<string, number>(actifs.map(d => [d.id, minutesDuDroit(d)]))
  const utilise = new Map<string, number>(actifs.map(d => [d.id, 0]))
  const parId = new Map(actifs.map(d => [d.id, d]))
  const place = (d: Droit) => (capacite.get(d.id) ?? 0) - (utilise.get(d.id) ?? 0)

  const valides = seances.filter(x => estCoach(x.coach) && STATUTS_SEANCE.includes(x.statut))
  // Seule une seance prevue ou faite retire du temps. Une annulee jamais.
  const comptees = valides
    .filter(x => (x.statut === 'prevue' || x.statut === 'faite') && dureeDe(x) > 0)
    .sort((a, b) => ms(a.debut) - ms(b.debut) || a.id.localeCompare(b.id))

  // Ce que chaque seance prend a chaque droit, en minutes.
  const reste = new Map<string, number>(comptees.map(x => [x.id, dureeDe(x)]))
  const parts = new Map<string, { droit: Droit; min: number }[]>()
  const prendre = (x: Seance, d: Droit) => {
    const n = Math.min(place(d), reste.get(x.id) ?? 0)
    if (n <= 0) return
    utilise.set(d.id, (utilise.get(d.id) ?? 0) + n)
    reste.set(x.id, (reste.get(x.id) ?? 0) - n)
    const l = parts.get(x.id) ?? []
    l.push({ droit: d, min: n })
    parts.set(x.id, l)
  }
  // 1. Les seances liees a un droit precis prennent d'abord sur lui.
  for (const x of comptees) {
    const d = x.droit_id ? parId.get(x.droit_id) : undefined
    if (d && d.coach === x.coach) prendre(x, d)
  }
  // 2. Le reste de chaque seance : le droit le plus ancien du meme coach qui a du temps, puis le suivant.
  for (const x of comptees) {
    for (const d of actifs) {
      if ((reste.get(x.id) ?? 0) <= 0) break
      if (d.coach === x.coach) prendre(x, d)
    }
  }

  // Les lignes : une par coach et par famille (un pack par offre).
  type Acc = {
    coach: Coach; famille: Famille; pack: string | null; libelle: string | null
    total: number; faites: number; prevues: number; nbFaites: number; nbPrevues: number
  }
  const acc = new Map<string, Acc>()
  for (const d of actifs) {
    const cle = cleLigne(d)
    const f = familleDe(d)
    const a = acc.get(cle) ?? {
      coach: d.coach, famille: f, pack: f === 'pack' ? d.reference : null, libelle: d.libelle,
      total: 0, faites: 0, prevues: 0, nbFaites: 0, nbPrevues: 0,
    }
    a.total += capacite.get(d.id) ?? 0
    acc.set(cle, a)
  }
  const ligneDe = new Map<string, string>()
  for (const x of comptees) {
    const parLigne = new Map<string, number>()
    for (const p of parts.get(x.id) ?? []) {
      const cle = cleLigne(p.droit)
      parLigne.set(cle, (parLigne.get(cle) ?? 0) + p.min)
    }
    let principale: string | null = null
    let plus = 0
    for (const [cle, min] of parLigne) {
      const a = acc.get(cle)!
      if (x.statut === 'faite') { a.faites += min; a.nbFaites++ } else { a.prevues += min; a.nbPrevues++ }
      if (min > plus) { principale = cle; plus = min }
    }
    if (principale) ligneDe.set(x.id, principale)
  }

  // Ce qui reste sans place : un coach sans aucun droit a une ligne sans total,
  // sinon c'est « hors droits ».
  const sansDroit = new Map<Coach, { faites: number; prevues: number; nbFaites: number; nbPrevues: number }>()
  const hors: Record<Coach, number> = { brice: 0, melanie: 0 }
  const horsMin: Record<Coach, number> = { brice: 0, melanie: 0 }
  const horsDe = new Map<string, number>()
  for (const x of comptees) {
    const r = reste.get(x.id) ?? 0
    if (r <= 0) continue
    if (!actifs.some(d => d.coach === x.coach)) {
      const c = sansDroit.get(x.coach) ?? { faites: 0, prevues: 0, nbFaites: 0, nbPrevues: 0 }
      if (x.statut === 'faite') { c.faites += r; c.nbFaites++ } else { c.prevues += r; c.nbPrevues++ }
      sansDroit.set(x.coach, c)
      ligneDe.set(x.id, `${x.coach}:seances`)
    } else {
      hors[x.coach]++
      horsMin[x.coach] += r
      horsDe.set(x.id, r)
    }
  }

  const lignes: LigneCoaching[] = []
  for (const [cle, a] of acc) {
    const restantes = a.total - a.faites - a.prevues
    lignes.push({
      cle, coach: a.coach, famille: a.famille, pack: a.pack, titre: titreLigne(a.famille, a.libelle),
      total_min: a.total, faites_min: a.faites, prevues_min: a.prevues, restantes_min: restantes,
      nb_faites: a.nbFaites, nb_prevues: a.nbPrevues,
      phrase: phraseReste(restantes, a.total, a.coach), detail: detailSeances(a.nbFaites, a.nbPrevues),
    })
  }
  for (const [coach, c] of sansDroit) {
    lignes.push({
      cle: `${coach}:seances`, coach, famille: 'seances', pack: null, titre: titreLigne('seances', null),
      total_min: null, faites_min: c.faites, prevues_min: c.prevues, restantes_min: null,
      nb_faites: c.nbFaites, nb_prevues: c.nbPrevues,
      phrase: phraseSansDroit(c.faites + c.prevues, coach), detail: detailSeances(c.nbFaites, c.nbPrevues),
    })
  }
  lignes.sort((a, b) => COACHS.indexOf(a.coach) - COACHS.indexOf(b.coach)
    || ORDRE_FAMILLE[a.famille] - ORDRE_FAMILLE[b.famille] || a.cle.localeCompare(b.cle))

  const resumees: SeanceResumee[] = valides.map(x => ({
    ...x,
    statut_affiche: statutAffiche(x, maintenant),
    ligne: x.statut === 'annulee' ? null : (ligneDe.get(x.id) ?? null),
    hors_min: horsDe.get(x.id) ?? 0,
  }))
  const historique = [...resumees].sort((a, b) => ms(b.debut) - ms(a.debut) || a.id.localeCompare(b.id))
  const prochain = resumees
    .filter(x => x.statut === 'prevue' && ms(x.debut) >= maintenant)
    .sort((a, b) => ms(a.debut) - ms(b.debut))[0] ?? null

  return {
    visible: actifs.length > 0 || valides.some(x => x.statut !== 'annulee'),
    lignes, prochain, historique, hors_droits: hors, hors_droits_min: horsMin,
  }
}

// ---------------------------------------------------------------------------
// Par personne (la vue « Coaching » du cockpit)
// ---------------------------------------------------------------------------

/** L'email d'une fiche du cockpit (cockpit_membre_emails). */
export type FicheEmail = { email: string; membre_id: string; nom: string | null }

export type PersonneCoaching = {
  /** membre:<uuid> si l'un de ses emails a une fiche, sinon email:<email>. */
  cle: string
  membre_id: string | null
  nom: string | null
  emails: string[]
  resume: ResumeCoaching
  /** La date la plus recente (seance ou droit), pour ranger la liste. */
  derniere: string | null
}

/**
 * Regroupe droits et seances par personne : par fiche du cockpit quand l'email
 * en a une (plusieurs emails, une personne), sinon par email. Une ligne sans
 * email n'est rangee nulle part. La plus recemment active d'abord.
 */
export function regrouperParPersonne(
  droits: Droit[], seances: Seance[], fiches: FicheEmail[], maintenant = Date.now(),
): PersonneCoaching[] {
  const fiche = new Map(fiches.map(f => [f.email, f]))
  type G = { membre_id: string | null; nom: string | null; emails: Set<string>; droits: Droit[]; seances: Seance[]; derniere: number }
  const groupes = new Map<string, G>()
  const groupe = (email: string): G => {
    const f = fiche.get(email)
    const cle = f ? `membre:${f.membre_id}` : `email:${email}`
    let g = groupes.get(cle)
    if (!g) {
      g = { membre_id: f?.membre_id ?? null, nom: f?.nom ?? null, emails: new Set(), droits: [], seances: [], derniere: 0 }
      groupes.set(cle, g)
    }
    g.emails.add(email)
    return g
  }
  for (const d of droits) {
    const e = normaliserEmail(d.email)
    if (!e) continue
    const g = groupe(e)
    g.droits.push(d)
    g.derniere = Math.max(g.derniere, ms(d.depuis) || 0)
  }
  for (const x of seances) {
    const e = normaliserEmail(x.email)
    if (!e) continue
    const g = groupe(e)
    g.seances.push(x)
    g.derniere = Math.max(g.derniere, ms(x.debut) || 0)
  }
  return [...groupes.entries()]
    .map(([cle, g]) => ({
      cle, membre_id: g.membre_id, nom: g.nom, emails: [...g.emails].sort(),
      resume: resumerCoaching(g.droits, g.seances, maintenant),
      derniere: g.derniere ? new Date(g.derniere).toISOString() : null,
    }))
    .sort((a, b) => (b.derniere ?? '').localeCompare(a.derniere ?? '') || a.cle.localeCompare(b.cle))
}

// ---------------------------------------------------------------------------
// 2. Ce que voit le membre (route /api/compte/coaching)
// ---------------------------------------------------------------------------

/** Le bouton de la ligne : le lien de reservation du pack s'il existe, sinon ecrire au coach. */
export type Reserver = { type: 'lien'; url: string; libelle: string } | { type: 'contact'; coach: Coach; libelle: string }

/** Les liens de reservation connus, par slug de pack (variables du journal, deja validees). */
export type LiensReservation = Partial<Record<string, string | null>>

export function reserverPour(l: Pick<LigneCoaching, 'coach' | 'famille' | 'pack'>, liens: LiensReservation): Reserver {
  const url = l.famille === 'pack' && l.pack ? liens[l.pack] ?? null : null
  if (url) return { type: 'lien', url, libelle: 'Réserver une séance' }
  return { type: 'contact', coach: l.coach, libelle: l.coach === 'melanie' ? 'Écrire à Mélanie' : 'Écrire à Brice' }
}

export type SeanceMembre = {
  debut: string
  duree_min: number
  coach: Coach
  coach_nom: string
  statut: StatutAffiche
  statut_libelle: string
}

export type LigneMembre = Omit<LigneCoaching, 'cle'> & { cle: string; coach_nom: string; reserver: Reserver }

export type VueMembre = {
  visible: boolean
  lignes: LigneMembre[]
  prochain: SeanceMembre | null
  historique: SeanceMembre[]
}

const iso = (d: string | Date) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString())

function seanceMembre(x: SeanceResumee): SeanceMembre {
  return {
    debut: iso(x.debut), duree_min: x.duree_min, coach: x.coach, coach_nom: NOM_COACH[x.coach],
    statut: x.statut_affiche, statut_libelle: LIBELLE_STATUT[x.statut_affiche],
  }
}

/**
 * Ce que la route rend au membre : jamais un email, une note de l'equipe, un
 * identifiant ni la source d'une seance. 60 seances d'historique au plus.
 */
export function vueMembre(r: ResumeCoaching, liens: LiensReservation): VueMembre {
  return {
    visible: r.visible,
    lignes: r.lignes.map(l => ({ ...l, coach_nom: NOM_COACH[l.coach], reserver: reserverPour(l, liens) })),
    prochain: r.prochain ? seanceMembre(r.prochain) : null,
    historique: r.historique.slice(0, 60).map(seanceMembre),
  }
}

// ---------------------------------------------------------------------------
// 3. Le webhook de Cal
// ---------------------------------------------------------------------------

/**
 * La signature de Cal : en-tete X-Cal-Signature-256 = HMAC-SHA256 du corps brut
 * avec le secret du webhook, en hexadecimal. Comparaison a temps constant.
 * Sans secret, rien ne passe.
 */
export function verifierSignatureCal(corps: string, entete: string | null, secret: string | null | undefined): boolean {
  if (!secret || !entete) return false
  const recu = entete.trim().toLowerCase().replace(/^sha256=/, '')
  if (!/^[0-9a-f]{64}$/.test(recu)) return false
  const attendu = createHmac('sha256', secret).update(corps, 'utf8').digest()
  const b = Buffer.from(recu, 'hex')
  return b.length === attendu.length && timingSafeEqual(b, attendu)
}

/** Un email normalise (minuscules, sans espaces autour), ou null s'il n'en a pas la forme. */
export function normaliserEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  if (e.length < 3 || e.length > 254) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}

/** Le compte du site a rattacher : seulement s'il n'y en a qu'un (sinon l'email suffit). */
export function compteUnique(ids: string[]): string | null {
  const u = [...new Set(ids.filter(Boolean))]
  return u.length === 1 ? u[0] : null
}

/** Les types d'evenement Cal suivis (variable CAL_COACHING_TYPES) : slugs ou ids, separes par des virgules ou des espaces. */
export function lireTypesSuivis(v: string | null | undefined): Set<string> {
  return new Set((v ?? '').split(/[\s,]+/).map(x => x.trim().toLowerCase()).filter(Boolean))
}

export type EvenementCal =
  | { geste: 'ignorer'; raison: 'corps' | 'declencheur' | 'uid' | 'types_non_regles' | 'type' | 'email' | 'date' | 'duree'; declencheur: string | null }
  | {
      geste: 'poser'
      declencheur: string
      uid: string
      /** Le rendez-vous d'origine d'un report (rescheduleUid). */
      ancienUid: string | null
      email: string
      debut: string
      duree_min: number
      type: string
      /** L'heure est payee chez Cal : elle donne son propre droit d'une seance. */
      paye: boolean
    }
  | { geste: 'annuler'; declencheur: string; uid: string }

const UID = /^[A-Za-z0-9_-]{6,120}$/
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)

/**
 * Un evenement du webhook de Cal (enveloppe { triggerEvent, createdAt, payload }) :
 *   BOOKING_CREATED, BOOKING_PAID, BOOKING_RESCHEDULED -> poser (creer ou mettre a jour la seance) ;
 *   BOOKING_CANCELLED, BOOKING_REJECTED                -> annuler ;
 *   tout le reste                                      -> ignorer.
 * Une seance ne se pose que pour un type d'evenement suivi (slug payload.type ou
 * id payload.eventTypeId dans typesSuivis) : sans liste, rien ne se pose (un appel
 * decouverte gratuit ne doit jamais consommer un pack). L'annulation, elle, passe
 * toujours : elle ne touche qu'une seance deja connue.
 * L'invite = le premier participant qui n'est pas l'organisateur.
 */
export function lireEvenementCal(brut: unknown, typesSuivis: ReadonlySet<string>): EvenementCal {
  const env = obj(brut)
  if (!env) return { geste: 'ignorer', raison: 'corps', declencheur: null }
  const declencheur = typeof env.triggerEvent === 'string' ? env.triggerEvent.toUpperCase() : null
  const p = obj(env.payload)
  if (!declencheur || !p) return { geste: 'ignorer', raison: 'corps', declencheur }
  const poser = ['BOOKING_CREATED', 'BOOKING_PAID', 'BOOKING_RESCHEDULED'].includes(declencheur)
  const annuler = ['BOOKING_CANCELLED', 'BOOKING_REJECTED'].includes(declencheur)
  if (!poser && !annuler) return { geste: 'ignorer', raison: 'declencheur', declencheur }
  const uid = typeof p.uid === 'string' && UID.test(p.uid) ? p.uid : null
  if (!uid) return { geste: 'ignorer', raison: 'uid', declencheur }
  const statut = typeof p.status === 'string' ? p.status.toUpperCase() : ''
  if (annuler || statut === 'CANCELLED' || statut === 'REJECTED') return { geste: 'annuler', declencheur, uid }

  if (typesSuivis.size === 0) return { geste: 'ignorer', raison: 'types_non_regles', declencheur }
  const slug = typeof p.type === 'string' ? p.type.trim().toLowerCase() : ''
  const idType = typeof p.eventTypeId === 'number' || typeof p.eventTypeId === 'string' ? String(p.eventTypeId).trim() : ''
  if (!(slug && typesSuivis.has(slug)) && !(idType && typesSuivis.has(idType))) return { geste: 'ignorer', raison: 'type', declencheur }

  const organisateur = normaliserEmail(obj(p.organizer)?.email)
  const participants = Array.isArray(p.attendees) ? p.attendees : []
  let email: string | null = null
  for (const a of participants) {
    const e = normaliserEmail(obj(a)?.email)
    if (e && e !== organisateur) { email = e; break }
  }
  if (!email) {
    const r = obj(p.responses)
    const champ = r?.email
    const e = normaliserEmail(typeof champ === 'string' ? champ : obj(champ)?.value)
    if (e && e !== organisateur) email = e
  }
  if (!email) return { geste: 'ignorer', raison: 'email', declencheur }

  const debut = typeof p.startTime === 'string' ? Date.parse(p.startTime) : NaN
  if (!Number.isFinite(debut)) return { geste: 'ignorer', raison: 'date', declencheur }
  const fin = typeof p.endTime === 'string' ? Date.parse(p.endTime) : NaN
  let duree = Number.isFinite(fin) ? Math.round((fin - debut) / 60_000) : NaN
  if (!Number.isFinite(duree) && typeof p.length === 'number') duree = Math.round(p.length)
  if (!Number.isFinite(duree) || duree < 5 || duree > 480) return { geste: 'ignorer', raison: 'duree', declencheur }

  const ancien = typeof p.rescheduleUid === 'string' && UID.test(p.rescheduleUid) && p.rescheduleUid !== uid ? p.rescheduleUid : null
  const paiementId = typeof p.paymentId === 'number' || (typeof p.paymentId === 'string' && p.paymentId.trim() !== '')
  const paiements = Array.isArray(p.payment) && p.payment.some(x => obj(x)?.success === true)
  const paye = declencheur === 'BOOKING_PAID' || p.paid === true || paiementId || paiements

  return {
    geste: 'poser', declencheur, uid, ancienUid: ancien, email,
    debut: new Date(debut).toISOString(), duree_min: duree, type: slug || idType, paye,
  }
}

// ---------------------------------------------------------------------------
// 4. Les gestes du cockpit (route /api/cockpit/coaching)
// ---------------------------------------------------------------------------

export const MAX_NOTE = 500
/** Un droit pose depuis le cockpit : de 15 min a 100 h, par quart d'heure (12 h = 720, 6,5 h = 390). */
export const MIN_MINUTES_DROIT = 15
export const MAX_MINUTES_DROIT = 6000
export const PAS_MINUTES_DROIT = 15
/** L'ETM par defaut (Brice, 09/11) : 1 h par semaine sur 3 mois. Le cockpit le preremplit, l'equipe l'ajuste. */
export const MINUTES_ETM_DEFAUT = 12 * 60

export type DemandeCockpit =
  | { action: 'lister' }
  | { action: 'fiche'; emails: string[] }
  | { action: 'ajouter_seance'; email: string; coach: Coach; debut: string; duree_min: number; statut: 'prevue' | 'faite'; note: string | null }
  | { action: 'statut_seance'; id: string; statut: StatutSeance }
  | { action: 'accorder_droit'; email: string; coach: Coach; minutes: number; source: 'offert' | 'etm'; depuis: string | null; note: string | null }
  | { action: 'corriger_droit'; id: string; minutes: number; note: string | null }
  | { action: 'retirer_droit'; id: string }
  | { action: 'confirmer_detection'; id: string; email: string; coach: Coach; duree_min: number | null }
  | { action: 'ecarter_detection'; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const lireUuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null)

/** Une note facultative : texte borne, sans caracteres de controle. undefined = absente. */
function lireNote(v: unknown): string | null | 'invalide' {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string') return 'invalide'
  const t = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > MAX_NOTE ? 'invalide' : t
}

/** Une date ISO lisible, entre 2020 et dans deux ans. */
function lireDate(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null
  const t = Date.parse(v)
  if (!Number.isFinite(t)) return null
  if (t < Date.UTC(2020, 0, 1) || t > Date.now() + 2 * 365 * 24 * 3600 * 1000) return null
  return new Date(t).toISOString()
}

const entier = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null

/**
 * La quantite d'un droit pose depuis le cockpit, en minutes : `minutes` (par
 * quart d'heure, de 15 min a 100 h), ou `seances` (de 1 a 100, en heures
 * pleines) que l'ancien ecran du cockpit envoie encore tant qu'il n'est pas
 * redeploye. null = invalide ou absente.
 */
function lireMinutesDroit(c: Record<string, unknown>): number | null {
  if (c.minutes !== undefined) {
    const m = entier(c.minutes, MIN_MINUTES_DROIT, MAX_MINUTES_DROIT)
    return m !== null && m % PAS_MINUTES_DROIT === 0 ? m : null
  }
  const n = entier(c.seances, 1, MAX_MINUTES_DROIT / 60)
  return n === null ? null : n * 60
}

export type ErreurCockpit = 'action' | 'id' | 'email' | 'coach' | 'date' | 'duree' | 'statut' | 'heures' | 'source' | 'note' | 'emails'

/** Le corps de POST /api/cockpit/coaching, verifie. */
export function lireDemandeCockpit(corps: unknown): DemandeCockpit | { erreur: ErreurCockpit } {
  const c = obj(corps) ?? {}
  switch (c.action) {
    case 'lister':
      return { action: 'lister' }
    case 'fiche': {
      if (!Array.isArray(c.emails) || c.emails.length === 0 || c.emails.length > 20) return { erreur: 'emails' }
      const emails = [...new Set(c.emails.map(normaliserEmail))]
      if (emails.some(e => e === null)) return { erreur: 'emails' }
      return { action: 'fiche', emails: emails as string[] }
    }
    case 'ajouter_seance': {
      const email = normaliserEmail(c.email)
      if (!email) return { erreur: 'email' }
      if (!estCoach(c.coach)) return { erreur: 'coach' }
      const debut = lireDate(c.debut)
      if (!debut) return { erreur: 'date' }
      const duree = entier(c.duree_min, 5, 480)
      if (duree === null) return { erreur: 'duree' }
      const statut = c.statut ?? 'faite'
      if (statut !== 'prevue' && statut !== 'faite') return { erreur: 'statut' }
      const note = lireNote(c.note)
      if (note === 'invalide') return { erreur: 'note' }
      return { action: 'ajouter_seance', email, coach: c.coach, debut, duree_min: duree, statut, note }
    }
    case 'statut_seance': {
      const id = lireUuid(c.id)
      if (!id) return { erreur: 'id' }
      if (!STATUTS_SEANCE.includes(c.statut as StatutSeance)) return { erreur: 'statut' }
      return { action: 'statut_seance', id, statut: c.statut as StatutSeance }
    }
    case 'accorder_droit': {
      const email = normaliserEmail(c.email)
      if (!email) return { erreur: 'email' }
      if (!estCoach(c.coach)) return { erreur: 'coach' }
      const minutes = lireMinutesDroit(c)
      if (minutes === null) return { erreur: 'heures' }
      if (c.source !== 'offert' && c.source !== 'etm') return { erreur: 'source' }
      let depuis: string | null = null
      if (c.depuis !== undefined && c.depuis !== null && c.depuis !== '') {
        depuis = lireDate(c.depuis)
        if (!depuis) return { erreur: 'date' }
      }
      const note = lireNote(c.note)
      if (note === 'invalide') return { erreur: 'note' }
      return { action: 'accorder_droit', email, coach: c.coach, minutes, source: c.source, depuis, note }
    }
    case 'corriger_droit': {
      const id = lireUuid(c.id)
      if (!id) return { erreur: 'id' }
      const minutes = lireMinutesDroit(c)
      if (minutes === null) return { erreur: 'heures' }
      const note = lireNote(c.note)
      if (note === 'invalide') return { erreur: 'note' }
      return { action: 'corriger_droit', id, minutes, note }
    }
    case 'retirer_droit': {
      const id = lireUuid(c.id)
      return id ? { action: 'retirer_droit', id } : { erreur: 'id' }
    }
    case 'confirmer_detection': {
      const id = lireUuid(c.id)
      if (!id) return { erreur: 'id' }
      const email = normaliserEmail(c.email)
      if (!email) return { erreur: 'email' }
      const coach = c.coach ?? 'brice'
      if (!estCoach(coach)) return { erreur: 'coach' }
      let duree: number | null = null
      if (c.duree_min !== undefined && c.duree_min !== null) {
        duree = entier(c.duree_min, 5, 480)
        if (duree === null) return { erreur: 'duree' }
      }
      return { action: 'confirmer_detection', id, email, coach, duree_min: duree }
    }
    case 'ecarter_detection': {
      const id = lireUuid(c.id)
      return id ? { action: 'ecarter_detection', id } : { erreur: 'id' }
    }
    default:
      return { erreur: 'action' }
  }
}

/** Le texte d'une erreur de corps, pour l'ecran du cockpit. */
export const TEXTE_ERREUR: Record<ErreurCockpit, string> = {
  action: 'Geste inconnu.',
  id: 'Identifiant invalide.',
  email: 'Adresse email invalide.',
  emails: "Liste d'emails invalide.",
  coach: 'Coach inconnu (Brice ou Mélanie).',
  date: 'Date invalide.',
  duree: 'Durée invalide (5 à 480 minutes).',
  statut: 'Statut inconnu.',
  heures: "Nombre d'heures invalide (de 15 min à 100 h, par quart d'heure).",
  source: 'Origine inconnue (offert ou ETM).',
  note: `Note trop longue (${MAX_NOTE} caractères au plus).`,
}
