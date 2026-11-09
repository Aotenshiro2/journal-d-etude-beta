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
// LE CALCUL DU RESTE, en clair :
//   - un droit compte tant qu'il n'est pas retire ; une seance compte (consomme
//     une place) si elle est prevue ou faite, jamais annulee ;
//   - une seance liee a un droit (droit_id) le consomme d'abord, s'il est du
//     meme coach et a encore de la place (une heure payee sur Cal consomme son
//     propre droit) ;
//   - les autres prennent, dans l'ordre de leur date, le droit le plus ancien
//     du meme coach qui a encore de la place (premier arrive, premier servi) ;
//   - ce qui ne trouve pas de place est « hors droits » (le cockpit le signale) ;
//   - une ligne par coach et par famille : le pack (par offre), l'ETM, les
//     seances a l'unite (offertes ou payees sur Cal). Un coach sans aucun droit
//     mais avec des seances a une ligne « seances » sans total.

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
  seances: number
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
  /** null = aucun droit pour ce coach, seulement des seances. */
  total: number | null
  faites: number
  prevues: number
  restantes: number | null
  phrase: string
  detail: string
}

export type StatutAffiche = 'prevue' | 'passee' | 'faite' | 'annulee'

export type SeanceResumee = Seance & {
  statut_affiche: StatutAffiche
  /** La ligne qui la decompte (cle), ou null : annulee, ou hors droits. */
  ligne: string | null
}

export type ResumeCoaching = {
  /** La rubrique se montre : au moins un droit en cours, ou une seance non annulee. */
  visible: boolean
  lignes: LigneCoaching[]
  prochain: SeanceResumee | null
  /** La plus recente d'abord. */
  historique: SeanceResumee[]
  /** Seances prevues ou faites qui n'ont trouve aucune place, par coach. */
  hors_droits: Record<Coach, number>
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

const s = (n: number) => (Math.abs(n) >= 2 ? 's' : '')

/** « 5 séances restantes sur 8 avec Brice », « 0 séance restante sur 8 avec Brice ». */
export function phraseReste(restantes: number, total: number, coach: Coach): string {
  return `${restantes} séance${s(restantes)} restante${s(restantes)} sur ${total} avec ${NOM_COACH[coach]}`
}

/** « 2 faites, 1 prévue », « aucune séance pour l'instant ». */
export function detailSeances(faites: number, prevues: number): string {
  const morceaux: string[] = []
  if (faites) morceaux.push(`${faites} faite${s(faites)}`)
  if (prevues) morceaux.push(`${prevues} prévue${s(prevues)}`)
  return morceaux.length ? morceaux.join(', ') : "aucune séance pour l'instant"
}

function titreLigne(famille: Famille, libelle: string | null): string {
  if (famille === 'pack') return libelle || 'Pack de coaching'
  if (famille === 'etm') return 'ETM'
  return 'Séances'
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

/** Le calcul du reste. maintenant en millisecondes (Date.now() par defaut). */
export function resumerCoaching(droits: Droit[], seances: Seance[], maintenant = Date.now()): ResumeCoaching {
  const actifs = droits
    .filter(d => !d.retire_le && estCoach(d.coach) && Number.isFinite(d.seances) && d.seances > 0)
    .sort((a, b) => ms(a.depuis) - ms(b.depuis) || a.id.localeCompare(b.id))
  const utilise = new Map<string, number>(actifs.map(d => [d.id, 0]))
  const parId = new Map(actifs.map(d => [d.id, d]))
  const place = (d: Droit) => d.seances - (utilise.get(d.id) ?? 0)

  const valides = seances.filter(x => estCoach(x.coach) && STATUTS_SEANCE.includes(x.statut))
  const comptees = valides
    .filter(x => x.statut === 'prevue' || x.statut === 'faite')
    .sort((a, b) => ms(a.debut) - ms(b.debut) || a.id.localeCompare(b.id))

  const affectation = new Map<string, Droit>()
  // 1. Les seances liees a un droit precis.
  for (const x of comptees) {
    const d = x.droit_id ? parId.get(x.droit_id) : undefined
    if (d && d.coach === x.coach && place(d) > 0) {
      affectation.set(x.id, d)
      utilise.set(d.id, (utilise.get(d.id) ?? 0) + 1)
    }
  }
  // 2. Les autres : le droit le plus ancien du meme coach qui a de la place.
  const hors: Record<Coach, number> = { brice: 0, melanie: 0 }
  for (const x of comptees) {
    if (affectation.has(x.id)) continue
    const d = actifs.find(r => r.coach === x.coach && place(r) > 0)
    if (d) {
      affectation.set(x.id, d)
      utilise.set(d.id, (utilise.get(d.id) ?? 0) + 1)
    } else {
      hors[x.coach]++
    }
  }

  // Les lignes : une par coach et par famille (un pack par offre).
  type Acc = { coach: Coach; famille: Famille; pack: string | null; libelle: string | null; total: number; faites: number; prevues: number; depuis: number }
  const acc = new Map<string, Acc>()
  for (const d of actifs) {
    const cle = cleLigne(d)
    const f = familleDe(d)
    const a = acc.get(cle) ?? { coach: d.coach, famille: f, pack: f === 'pack' ? d.reference : null, libelle: d.libelle, total: 0, faites: 0, prevues: 0, depuis: ms(d.depuis) }
    a.total += d.seances
    acc.set(cle, a)
  }
  const ligneDe = new Map<string, string>()
  for (const x of comptees) {
    const d = affectation.get(x.id)
    if (!d) continue
    const cle = cleLigne(d)
    ligneDe.set(x.id, cle)
    const a = acc.get(cle)!
    if (x.statut === 'faite') a.faites++
    else a.prevues++
  }
  // Un coach sans droit mais avec des seances : une ligne sans total.
  const sansDroit = new Map<Coach, { faites: number; prevues: number }>()
  for (const x of comptees) {
    if (affectation.has(x.id) || actifs.some(r => r.coach === x.coach)) continue
    const c = sansDroit.get(x.coach) ?? { faites: 0, prevues: 0 }
    if (x.statut === 'faite') c.faites++
    else c.prevues++
    sansDroit.set(x.coach, c)
    ligneDe.set(x.id, `${x.coach}:seances`)
  }

  const lignes: LigneCoaching[] = []
  for (const [cle, a] of acc) {
    const restantes = a.total - a.faites - a.prevues
    lignes.push({
      cle, coach: a.coach, famille: a.famille, pack: a.pack, titre: titreLigne(a.famille, a.libelle),
      total: a.total, faites: a.faites, prevues: a.prevues, restantes,
      phrase: phraseReste(restantes, a.total, a.coach), detail: detailSeances(a.faites, a.prevues),
    })
  }
  for (const [coach, c] of sansDroit) {
    const n = c.faites + c.prevues
    lignes.push({
      cle: `${coach}:seances`, coach, famille: 'seances', pack: null, titre: 'Séances',
      total: null, faites: c.faites, prevues: c.prevues, restantes: null,
      phrase: `${n} séance${s(n)} avec ${NOM_COACH[coach]}`, detail: detailSeances(c.faites, c.prevues),
    })
  }
  lignes.sort((a, b) => COACHS.indexOf(a.coach) - COACHS.indexOf(b.coach)
    || ORDRE_FAMILLE[a.famille] - ORDRE_FAMILLE[b.famille] || a.cle.localeCompare(b.cle))

  const resumees: SeanceResumee[] = valides.map(x => ({
    ...x, statut_affiche: statutAffiche(x, maintenant), ligne: x.statut === 'annulee' ? null : (ligneDe.get(x.id) ?? null),
  }))
  const historique = [...resumees].sort((a, b) => ms(b.debut) - ms(a.debut) || a.id.localeCompare(b.id))
  const prochain = resumees
    .filter(x => x.statut === 'prevue' && ms(x.debut) >= maintenant)
    .sort((a, b) => ms(a.debut) - ms(b.debut))[0] ?? null

  return {
    visible: actifs.length > 0 || valides.some(x => x.statut !== 'annulee'),
    lignes, prochain, historique, hors_droits: hors,
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
export const MAX_SEANCES_DROIT = 100

export type DemandeCockpit =
  | { action: 'lister' }
  | { action: 'fiche'; emails: string[] }
  | { action: 'ajouter_seance'; email: string; coach: Coach; debut: string; duree_min: number; statut: 'prevue' | 'faite'; note: string | null }
  | { action: 'statut_seance'; id: string; statut: StatutSeance }
  | { action: 'accorder_droit'; email: string; coach: Coach; seances: number; source: 'offert' | 'etm'; depuis: string | null; note: string | null }
  | { action: 'corriger_droit'; id: string; seances: number; note: string | null }
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

export type ErreurCockpit = 'action' | 'id' | 'email' | 'coach' | 'date' | 'duree' | 'statut' | 'seances' | 'source' | 'note' | 'emails'

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
      const seances = entier(c.seances, 1, MAX_SEANCES_DROIT)
      if (seances === null) return { erreur: 'seances' }
      if (c.source !== 'offert' && c.source !== 'etm') return { erreur: 'source' }
      let depuis: string | null = null
      if (c.depuis !== undefined && c.depuis !== null && c.depuis !== '') {
        depuis = lireDate(c.depuis)
        if (!depuis) return { erreur: 'date' }
      }
      const note = lireNote(c.note)
      if (note === 'invalide') return { erreur: 'note' }
      return { action: 'accorder_droit', email, coach: c.coach, seances, source: c.source, depuis, note }
    }
    case 'corriger_droit': {
      const id = lireUuid(c.id)
      if (!id) return { erreur: 'id' }
      const seances = entier(c.seances, 1, MAX_SEANCES_DROIT)
      if (seances === null) return { erreur: 'seances' }
      const note = lireNote(c.note)
      if (note === 'invalide') return { erreur: 'note' }
      return { action: 'corriger_droit', id, seances, note }
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
  seances: `Nombre de séances invalide (1 à ${MAX_SEANCES_DROIT}).`,
  source: 'Origine inconnue (offert ou ETM).',
  note: `Note trop longue (${MAX_NOTE} caractères au plus).`,
}
