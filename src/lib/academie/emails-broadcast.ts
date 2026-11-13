// EMAIL A TOUS PAR LES ENVOIS GROUPES GRATUITS DE RESEND (Broadcasts) (13/11/2026 ;
// Brice : « Ok B » ; brief D:\7_Agents\briefs\2026-11-13-email-a-tous-resend-broadcasts.md ;
// migration du workspace 20261113210000_academie_emails_annonces.sql, ECRITE NON appliquee).
//
// Pourquoi : l'envoi un par un (/emails, API batch) compte dans le quota transactionnel
// du plan gratuit (100 par jour, 3 000 par mois), partage avec les emails de compte et
// les invitations : 301 adresses n'y passent pas. Les Broadcasts n'y comptent pas
// (FAQ pricing de Resend, lue le 13/11) ; le plan gratuit compte les CONTACTS (1 000) et
// les SEGMENTS (3). Donc : nos adresses deviennent des contacts Resend, rangees dans deux
// segments (« tous », « comptes ») et abonnees a un sujet (Topic) « Annonces de
// l'academie » ; l'envoi aux membres est UN Broadcast vers un segment, limite au sujet.
// Les ESSAIS restent des emails transactionnels (quelques adresses de l'equipe).
//
// LE SENS DE LA SYNCHRONISATION (decide le 13/11, voir aussi l'ETAT du journal) :
// - base -> Resend (descendant) : les contacts et leurs segments. Un contact NOUVEAU est cree
//   avec ses segments et le sujet en opt_in, ou en opt_out s'il est desinscrit chez nous ou
//   chez Resend. Un contact EXISTANT ne recoit que des ajouts ou retraits de SEGMENT, et le cas
//   echeant un opt_out du sujet (desinscription posee chez nous, poussee une fois). Jamais un
//   opt_in sur un contact existant, jamais « unsubscribed: false » : la synchronisation ne
//   reabonne PERSONNE (le type EcrivainResend ne sait meme pas l'ecrire). Les imports en lot
//   passent en on_conflict « skip » : un contact deja la n'est pas touche.
// - Resend -> base (montant) : les desinscriptions seulement. Un contact desinscrit chez Resend
//   (desinscription globale, ou clic « se desinscrire » dans un de nos Broadcasts, ou plainte)
//   entre dans academie_emails_desinscriptions (source « resend »). Notre table reste la
//   reference cote cockpit (compte affiche, confirmation) ; Resend reste le dernier filtre a
//   l'envoi (il n'envoie pas a un desinscrit du sujet).
// - Une reinscription ne se fait que par le membre lui-meme, sur la page de Resend. Elle
//   n'est pas relue dans notre table (cas rare : le compte du cockpit serait alors un peu bas).
//
// CE FICHIER N'IMPORTE RIEN : scripts/verifier-emails-annonces.mjs et
// scripts/simuler-synchro-resend.mjs l'importent tel quel sous Node 22. Resend lui est
// PASSE : LecteurResend (lectures seules, tout ce que la SIMULATION a en main) et
// EcrivainResend (ecritures, utilise seulement quand ANNONCES_EMAIL_MODE vaut « reel »,
// emails-annonces-serveur.ts). Jamais une cle ni une adresse dans un journal.

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const SEGMENTS_CLES = ['tous', 'comptes'] as const
export type SegmentCle = (typeof SEGMENTS_CLES)[number]

/** Les noms des segments chez Resend (retrouves par leur nom a chaque synchronisation). */
export const SEGMENTS_RESEND: Record<SegmentCle, string> = {
  tous: 'Académie : tous les membres',
  comptes: 'Académie : comptes',
}

/** Le sujet (Topic) des annonces : se desinscrire de lui ne coupe pas le reste. */
export const SUJET_RESEND = {
  nom: 'Annonces de l\'académie',
  description: 'Les annonces de l\'académie AO Knowledge : nouveaux cours, lives, changements. Ton compte et tes cours ne changent pas.',
  defaut: 'opt_in' as const,
}

/** Le lien de desinscription, rempli par Resend pour chaque destinataire du Broadcast. */
export const VARIABLE_DESINSCRIPTION = '{{{RESEND_UNSUBSCRIBE_URL}}}'

/** Plan gratuit de Resend, lu le 13/11 (resend.com/pricing) : contacts et segments. */
export const LIMITES_GRATUIT = { contacts: 1000, segments: 3 } as const

/** Au-dela de ce nombre de contacts a creer, un import en lot (contacts.imports) plutot qu'un appel par contact. */
export const SEUIL_IMPORT = 20

/** 10 requetes par seconde par equipe (en-tete ratelimit-policy « 10;w=1 », lu le 13/11) : on reste a 8. */
export const CADENCE_MS = 125

export const PREFIXE_NOM_BROADCAST = 'Annonce académie'

// ---------------------------------------------------------------------------
// Les formes echangees avec Resend (structurelles : le SDK y entre par un adaptateur)
// ---------------------------------------------------------------------------

export type ErreurResend = { name?: string; message?: string; statusCode?: number | null } | null
export type Rep<T> = { data: T | null; error: ErreurResend }
export type Page<T> = { data: T[]; has_more?: boolean }
export type ContactR = { id: string; email: string; unsubscribed: boolean }
export type SegmentR = { id: string; name: string }
export type SujetR = { id: string; name: string; default_subscription?: string }

/** LECTURES seules. La simulation n'a que cet objet en main. */
export type LecteurResend = {
  domaines(): Promise<Rep<Page<{ name: string; status: string }>>>
  segments(o: { after?: string }): Promise<Rep<Page<SegmentR>>>
  sujets(): Promise<Rep<Page<SujetR>>>
  contacts(o: { after?: string; segmentId?: string }): Promise<Rep<Page<ContactR>>>
  imports(o: { status: 'queued' | 'in_progress' }): Promise<Rep<Page<{ id: string; status: string }>>>
  destinataires(broadcastId: string, o: { type: 'unsubscribed' | 'complained'; after?: string }): Promise<Rep<Page<{ id: string; email: string }>>>
  broadcasts(o: { after?: string }): Promise<Rep<Page<{ id: string; name: string | null; status: string }>>>
}

/**
 * ECRITURES. Volontairement etroit : un contact existant ne peut recevoir qu'un opt_out du
 * sujet (sujetsOptOut), jamais un opt_in ni un « unsubscribed: false ».
 */
export type EcrivainResend = {
  creerSegment(nom: string): Promise<Rep<{ id: string }>>
  creerSujet(o: { name: string; description: string; defaultSubscription: 'opt_in' | 'opt_out' }): Promise<Rep<{ id: string }>>
  creerContact(o: { email: string; segments: { id: string }[]; topics: { id: string; subscription: 'opt_in' | 'opt_out' }[] }): Promise<Rep<{ id: string }>>
  importer(o: { csv: string; segments: { id: string }[]; topics: { id: string; subscription: 'opt_in' | 'opt_out' }[] }): Promise<Rep<{ id: string }>>
  ajouterSegment(o: { contactId: string; segmentId: string }): Promise<Rep<unknown>>
  retirerSegment(o: { contactId: string; segmentId: string }): Promise<Rep<unknown>>
  sujetsOptOut(o: { contactId: string; sujetId: string }): Promise<Rep<unknown>>
  creerBroadcast(o: PayloadBroadcast): Promise<Rep<{ id: string }>>
  envoyerBroadcast(id: string): Promise<Rep<{ id: string }>>
}

/** Le minimum du SDK resend (6.24) dont les adaptateurs ont besoin. */
export type SdkResend = {
  domains: { list(): Promise<unknown> }
  segments: { list(o?: object): Promise<unknown>; create(o: { name: string }): Promise<unknown> }
  topics: { list(): Promise<unknown>; create(o: { name: string; description?: string; defaultSubscription: 'opt_in' | 'opt_out' }): Promise<unknown> }
  contacts: {
    list(o?: object): Promise<unknown>
    create(o: { email: string; segments?: { id: string }[]; topics?: { id: string; subscription: 'opt_in' | 'opt_out' }[] }): Promise<unknown>
    imports: { list(o?: object): Promise<unknown>; create(o: { file: Blob; columnMap?: { email?: string }; onConflict?: 'upsert' | 'skip'; segments?: { id: string }[]; topics?: { id: string; subscription: 'opt_in' | 'opt_out' }[] }): Promise<unknown> }
    segments: { add(o: { contactId: string; segmentId: string }): Promise<unknown>; remove(o: { contactId: string; segmentId: string }): Promise<unknown> }
    topics: { update(o: { id: string; topics: { id: string; subscription: 'opt_in' | 'opt_out' }[] }): Promise<unknown> }
  }
  broadcasts: {
    list(o?: object): Promise<unknown>
    recipients(id: string, o: { type: 'unsubscribed' | 'complained'; limit?: number; after?: string }): Promise<unknown>
    create(o: PayloadBroadcast): Promise<unknown>
    send(id: string): Promise<unknown>
  }
}

const rep = <T>(p: Promise<unknown>) => p as Promise<Rep<T>>

/**
 * Les lectures, depuis le SDK. 100 par page (le maximum de Resend). L'objet rendu ne porte
 * QUE des lectures : la simulation n'en recoit pas d'autre (ecrivainDepuisSdk n'est appele
 * qu'en mode reel).
 */
export function lecteurDepuisSdk(r: SdkResend): LecteurResend {
  return {
    domaines: () => rep(r.domains.list()),
    segments: (o) => rep(r.segments.list({ limit: 100, ...(o.after ? { after: o.after } : {}) })),
    sujets: () => rep(r.topics.list()),
    contacts: (o) => rep(r.contacts.list({ limit: 100, ...(o.after ? { after: o.after } : {}), ...(o.segmentId ? { segmentId: o.segmentId } : {}) })),
    imports: (o) => rep(r.contacts.imports.list({ limit: 100, status: o.status })),
    destinataires: (id, o) => rep(r.broadcasts.recipients(id, { type: o.type, limit: 100, ...(o.after ? { after: o.after } : {}) })),
    broadcasts: (o) => rep(r.broadcasts.list({ limit: 100, ...(o.after ? { after: o.after } : {}) })),
  }
}

/** Les ecritures, depuis le SDK. Import en lot TOUJOURS en on_conflict « skip ». */
export function ecrivainDepuisSdk(r: SdkResend): EcrivainResend {
  return {
    creerSegment: (nom) => rep(r.segments.create({ name: nom })),
    creerSujet: (o) => rep(r.topics.create(o)),
    creerContact: (o) => rep(r.contacts.create(o)),
    importer: (o) => rep(r.contacts.imports.create({
      file: new Blob([o.csv], { type: 'text/csv' }), columnMap: { email: 'email' }, onConflict: 'skip', segments: o.segments, topics: o.topics,
    })),
    ajouterSegment: (o) => rep(r.contacts.segments.add(o)),
    retirerSegment: (o) => rep(r.contacts.segments.remove(o)),
    sujetsOptOut: (o) => rep(r.contacts.topics.update({ id: o.contactId, topics: [{ id: o.sujetId, subscription: 'opt_out' }] })),
    creerBroadcast: (o) => rep(r.broadcasts.create(o)),
    envoyerBroadcast: (id) => rep(r.broadcasts.send(id)),
  }
}

// ---------------------------------------------------------------------------
// Cadence et erreurs
// ---------------------------------------------------------------------------

const attendre = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Un pas de cadence : au moins `ms` entre deux appels du meme passage. */
export function cadence(ms = CADENCE_MS): () => Promise<void> {
  let dernier = 0
  return async () => {
    const reste = dernier + ms - Date.now()
    if (reste > 0) await attendre(reste)
    dernier = Date.now()
  }
}

export function estLimite(e: ErreurResend): boolean {
  return !!e && (e.statusCode === 429 || e.name === 'rate_limit_exceeded')
}

export function estRestreinte(e: ErreurResend): boolean {
  return !!e && (e.name === 'restricted_api_key' || /restricted|only send emails/i.test(e.message ?? ''))
}

/** Un appel cadence, repris une fois apres 1,1 s si Resend repond 429. */
export async function appel<T>(pas: () => Promise<void>, f: () => Promise<Rep<T>>): Promise<Rep<T>> {
  await pas()
  let r = await f()
  if (estLimite(r.error)) {
    await attendre(1100)
    await pas()
    r = await f()
  }
  return r
}

/** Un message d'erreur Resend lisible, sans adresse ni cle, 200 caracteres au plus. */
export function messageResend(e: ErreurResend | unknown): string {
  const brut = e && typeof e === 'object' && 'message' in e ? `${(e as { name?: string }).name ?? 'erreur'} : ${(e as { message?: string }).message ?? ''}` : String(e)
  return brut.replace(/re_[A-Za-z0-9_]+/g, 're_[cle]').replace(/[^\s@;,()<>"']+@[^\s@;,()<>"']+/g, '[email]').replace(/\s+/g, ' ').slice(0, 200)
}

/** Toutes les pages d'une liste (curseur « after » = id du dernier element), 50 pages au plus. */
export async function toutesLesPages<T extends { id: string }>(pas: () => Promise<void>, f: (after?: string) => Promise<Rep<Page<T>>>): Promise<T[]> {
  const sortie: T[] = []
  let after: string | undefined
  for (let i = 0; i < 50; i++) {
    const r = await appel(pas, () => f(after))
    if (r.error || !r.data) throw new ErreurLecture(r.error)
    sortie.push(...r.data.data)
    if (!r.data.has_more || r.data.data.length === 0) break
    after = r.data.data[r.data.data.length - 1].id
  }
  return sortie
}

export class ErreurLecture extends Error {
  readonly restreinte: boolean
  constructor(e: ErreurResend) {
    super(messageResend(e))
    this.restreinte = estRestreinte(e)
  }
}

// ---------------------------------------------------------------------------
// La cle : une lecture qui exige le Full access
// ---------------------------------------------------------------------------

export type VerifCle = {
  acces: 'absente' | 'complet' | 'envoi_seulement' | 'invalide' | 'erreur'
  domaine: string | null
  domaine_verifie: boolean
  message: string
}

export const DOMAINE_ENVOI = 'aoknowledge.com'

/**
 * La liste des domaines exige une cle « Full access » : une cle « Sending access » est
 * refusee (restricted_api_key). Le Broadcast et les contacts exigent le meme niveau.
 */
export async function verifierCle(l: LecteurResend | null): Promise<VerifCle> {
  if (!l) return { acces: 'absente', domaine: null, domaine_verifie: false, message: 'Aucune clé Resend dans le journal (RESEND_API_KEY_ANNONCES ou RESEND_API_KEY).' }
  let r: Rep<Page<{ name: string; status: string }>>
  try { r = await l.domaines() } catch (err) { return { acces: 'erreur', domaine: null, domaine_verifie: false, message: messageResend(err) } }
  if (r.error) {
    if (estRestreinte(r.error)) {
      return { acces: 'envoi_seulement', domaine: null, domaine_verifie: false, message: 'Clé « Sending access » : elle envoie, mais Resend lui refuse les contacts, les segments et les Broadcasts.' }
    }
    if (r.error.statusCode === 401 || r.error.statusCode === 403 || /api.key/i.test(r.error.name ?? '')) {
      return { acces: 'invalide', domaine: null, domaine_verifie: false, message: messageResend(r.error) }
    }
    return { acces: 'erreur', domaine: null, domaine_verifie: false, message: messageResend(r.error) }
  }
  const d = (r.data?.data ?? []).find((x) => x.name === DOMAINE_ENVOI) ?? null
  return {
    acces: 'complet',
    domaine: d ? d.name : null,
    domaine_verifie: d?.status === 'verified',
    message: d ? `Clé « Full access ». Domaine ${d.name} : ${d.status}.` : `Clé « Full access », mais le domaine ${DOMAINE_ENVOI} est absent de ce compte Resend.`,
  }
}

// ---------------------------------------------------------------------------
// L'etat chez Resend (lectures seules)
// ---------------------------------------------------------------------------

export type EtatResend = {
  segments: SegmentR[]
  sujet: SujetR | null
  contacts: ContactR[]
  membres: Record<SegmentCle, string[]>
  importsEnCours: number
  desinscritsBroadcasts: string[]
}

export const norm = (e: string) => e.trim().toLowerCase()

/**
 * Lit tout ce que la synchronisation compare : segments, sujet, contacts (avec leur
 * desinscription globale), membres de nos deux segments, imports en cours, et les
 * desinscriptions et plaintes de nos Broadcasts passes. Environ 10 appels pour 300 contacts.
 */
export async function lireEtatResend(l: LecteurResend, broadcastsPasses: readonly string[], pas = cadence()): Promise<EtatResend> {
  const segments = await toutesLesPages(pas, (after) => l.segments({ after }))
  const sujets = await appel(pas, () => l.sujets())
  if (sujets.error || !sujets.data) throw new ErreurLecture(sujets.error)
  const sujet = sujets.data.data.find((s) => s.name === SUJET_RESEND.nom) ?? null
  const contacts = await toutesLesPages(pas, (after) => l.contacts({ after }))
  const membres: Record<SegmentCle, string[]> = { tous: [], comptes: [] }
  for (const cle of SEGMENTS_CLES) {
    const s = segments.find((x) => x.name === SEGMENTS_RESEND[cle])
    if (s) membres[cle] = (await toutesLesPages(pas, (after) => l.contacts({ after, segmentId: s.id }))).map((c) => c.id)
  }
  let importsEnCours = 0
  for (const status of ['queued', 'in_progress'] as const) {
    const r = await appel(pas, () => l.imports({ status }))
    if (r.error || !r.data) throw new ErreurLecture(r.error)
    importsEnCours += r.data.data.length
  }
  const desinscrits = new Set<string>()
  for (const id of broadcastsPasses.slice(0, 20)) {
    for (const type of ['unsubscribed', 'complained'] as const) {
      for (const d of await toutesLesPages(pas, (after) => l.destinataires(id, { type, after }))) desinscrits.add(norm(d.email))
    }
  }
  return {
    segments, sujet, contacts: contacts.map((c) => ({ id: c.id, email: norm(c.email), unsubscribed: c.unsubscribed === true })),
    membres, importsEnCours, desinscritsBroadcasts: [...desinscrits].sort(),
  }
}

// ---------------------------------------------------------------------------
// Le plan de synchronisation (pur)
// ---------------------------------------------------------------------------

export type CibleContact = { email: string; compte: boolean }
export type DesinscritBase = { email: string; resend_le: string | Date | null }
export type Abonnement = 'opt_in' | 'opt_out'

export type Plan = {
  segments_a_creer: SegmentCle[]
  sujet_a_creer: boolean
  creer: { email: string; segments: SegmentCle[]; sujet: Abonnement }[]
  ajouter: { contactId: string; segment: SegmentCle }[]
  retirer: { contactId: string; segment: SegmentCle }[]
  pousser_desinscriptions: { contactId: string; email: string }[]
  importer_desinscriptions: string[]
  bloquants: string[]
  avertissements: string[]
  totaux: { cible: number; cible_comptes: number; contacts_resend: number; contacts_apres: number; segments_resend: number; segments_apres: number }
}

/**
 * Compare notre liste (le groupe « tous ») et nos desinscrits a l'etat de Resend. PUR.
 * Regles : voir l'en-tete du fichier. Aucun opt_in ni reabonnement pour un contact existant.
 */
export function planifierSynchro(cible: readonly CibleContact[], base: readonly DesinscritBase[], etat: EtatResend): Plan {
  const voulu = new Map<string, boolean>()
  for (const c of cible) voulu.set(norm(c.email), (voulu.get(norm(c.email)) ?? false) || c.compte)
  const contactParEmail = new Map(etat.contacts.map((c) => [norm(c.email), c]))
  const emailParId = new Map(etat.contacts.map((c) => [c.id, norm(c.email)]))
  const dans: Record<SegmentCle, Set<string>> = { tous: new Set(etat.membres.tous), comptes: new Set(etat.membres.comptes) }
  const baseActifs = new Set(base.map((d) => norm(d.email)))
  const nonPousses = new Set(base.filter((d) => d.resend_le === null).map((d) => norm(d.email)))
  const chezResend = new Set<string>([...etat.contacts.filter((c) => c.unsubscribed).map((c) => norm(c.email)), ...etat.desinscritsBroadcasts.map(norm)])

  const plan: Plan = {
    segments_a_creer: SEGMENTS_CLES.filter((k) => !etat.segments.some((s) => s.name === SEGMENTS_RESEND[k])),
    sujet_a_creer: etat.sujet === null,
    creer: [], ajouter: [], retirer: [], pousser_desinscriptions: [],
    importer_desinscriptions: [...chezResend].filter((e) => !baseActifs.has(e) || nonPousses.has(e)).sort(),
    bloquants: [], avertissements: [],
    totaux: { cible: voulu.size, cible_comptes: [...voulu.values()].filter(Boolean).length, contacts_resend: etat.contacts.length, contacts_apres: 0, segments_resend: etat.segments.length, segments_apres: 0 },
  }

  for (const [email, compte] of [...voulu.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const segments: SegmentCle[] = compte ? ['tous', 'comptes'] : ['tous']
    const contact = contactParEmail.get(email)
    if (!contact) {
      plan.creer.push({ email, segments, sujet: baseActifs.has(email) || chezResend.has(email) ? 'opt_out' : 'opt_in' })
      continue
    }
    for (const s of segments) if (!dans[s].has(contact.id)) plan.ajouter.push({ contactId: contact.id, segment: s })
  }
  // Nos desinscrits que Resend ne connait pas encore et qui y ont un contact : opt_out du sujet.
  for (const email of [...nonPousses].sort()) {
    const contact = contactParEmail.get(email)
    if (contact && !chezResend.has(email)) plan.pousser_desinscriptions.push({ contactId: contact.id, email })
  }
  // Un contact range dans nos segments qui n'y a plus sa place (plus membre, plus de compte) en sort.
  for (const s of SEGMENTS_CLES) {
    for (const id of [...dans[s]].sort()) {
      const email = emailParId.get(id)
      if (email === undefined) continue
      const compte = voulu.get(email)
      if (compte === undefined || (s === 'comptes' && !compte)) plan.retirer.push({ contactId: id, segment: s })
    }
  }

  plan.totaux.contacts_apres = etat.contacts.length + plan.creer.length
  plan.totaux.segments_apres = etat.segments.length + plan.segments_a_creer.length
  if (plan.totaux.contacts_apres > LIMITES_GRATUIT.contacts) {
    plan.bloquants.push(`Plan gratuit de Resend : ${plan.totaux.contacts_apres} contacts après la synchronisation, pour ${LIMITES_GRATUIT.contacts} au plus.`)
  } else if (plan.totaux.contacts_apres > LIMITES_GRATUIT.contacts * 0.8) {
    plan.avertissements.push(`${plan.totaux.contacts_apres} contacts sur ${LIMITES_GRATUIT.contacts} : le plafond du plan gratuit approche.`)
  }
  if (plan.totaux.segments_apres > LIMITES_GRATUIT.segments) {
    const autres = etat.segments.filter((s) => !Object.values(SEGMENTS_RESEND).includes(s.name)).map((s) => `« ${s.name} »`).join(', ')
    plan.bloquants.push(`Plan gratuit de Resend : ${LIMITES_GRATUIT.segments} segments au plus, il en faudrait ${plan.totaux.segments_apres}${autres ? ` (déjà là : ${autres})` : ''}.`)
  } else if (plan.totaux.segments_apres === LIMITES_GRATUIT.segments && plan.segments_a_creer.length > 0) {
    const autres = etat.segments.filter((s) => !Object.values(SEGMENTS_RESEND).includes(s.name)).map((s) => `« ${s.name} »`).join(', ')
    plan.avertissements.push(`Les ${LIMITES_GRATUIT.segments} segments du plan gratuit seront pris${autres ? ` (${autres} occupe la troisième place)` : ''}.`)
  }
  if (etat.importsEnCours > 0) plan.bloquants.push(`Un import de contacts est en cours chez Resend (${etat.importsEnCours}) : attendre sa fin avant d'envoyer.`)
  return plan
}

export type ResumePlan = {
  segments_a_creer: string[]
  sujet_a_creer: string | null
  creer: number
  creer_desinscrits: number
  creer_comptes: number
  voie_creation: 'aucune' | 'un_par_un' | 'import'
  ajouter: number
  retirer: number
  pousser_desinscriptions: number
  importer_desinscriptions: number
  bloquants: string[]
  avertissements: string[]
  totaux: Plan['totaux']
}

/** Le plan en NOMBRES (ce que le cockpit affiche et ce que les journaux ecrivent) : aucune adresse. */
export function resumePlan(p: Plan): ResumePlan {
  return {
    segments_a_creer: p.segments_a_creer.map((k) => SEGMENTS_RESEND[k]),
    sujet_a_creer: p.sujet_a_creer ? SUJET_RESEND.nom : null,
    creer: p.creer.length,
    creer_desinscrits: p.creer.filter((c) => c.sujet === 'opt_out').length,
    creer_comptes: p.creer.filter((c) => c.segments.includes('comptes')).length,
    voie_creation: p.creer.length === 0 ? 'aucune' : p.creer.length > SEUIL_IMPORT ? 'import' : 'un_par_un',
    ajouter: p.ajouter.length,
    retirer: p.retirer.length,
    pousser_desinscriptions: p.pousser_desinscriptions.length,
    importer_desinscriptions: p.importer_desinscriptions.length,
    bloquants: p.bloquants,
    avertissements: p.avertissements,
    totaux: p.totaux,
  }
}

/** Le plan est-il vide (rien a ecrire chez Resend) ? Les desinscriptions a verser chez nous ne comptent pas. */
export function planVide(p: Plan): boolean {
  return p.segments_a_creer.length === 0 && !p.sujet_a_creer && p.creer.length === 0 && p.ajouter.length === 0 &&
    p.retirer.length === 0 && p.pousser_desinscriptions.length === 0
}

/** Les imports a lancer : un par combinaison (segments, abonnement au sujet), CSV d'une colonne « email ». */
export function lotsImport(creer: Plan['creer']): { segments: SegmentCle[]; sujet: Abonnement; csv: string; n: number }[] {
  const groupes = new Map<string, { segments: SegmentCle[]; sujet: Abonnement; emails: string[] }>()
  for (const c of creer) {
    const cle = `${c.segments.join('+')}|${c.sujet}`
    const g = groupes.get(cle) ?? { segments: c.segments, sujet: c.sujet, emails: [] }
    g.emails.push(c.email)
    groupes.set(cle, g)
  }
  return [...groupes.values()].map((g) => ({
    segments: g.segments, sujet: g.sujet, n: g.emails.length,
    csv: ['email', ...g.emails.filter((e) => /^[^@\s,";]+@[^@\s,";]+$/.test(e))].join('\n') + '\n',
  }))
}

// ---------------------------------------------------------------------------
// Appliquer le plan (ECRITURES : mode reel seulement)
// ---------------------------------------------------------------------------

export type ResultatSynchro = {
  segments: Partial<Record<SegmentCle, string>>
  sujet: string | null
  crees: number
  importes: number
  imports_lances: number
  ajoutes: number
  retires: number
  pousses: number
  /** Adresses dont la desinscription est maintenant connue de Resend (pour resend_le). Jamais journalisees. */
  emails_connus_de_resend: string[]
  erreurs: string[]
}

/** Les ids de nos segments et du sujet, crees au besoin (seule creation d'objet de compte). */
async function idsResend(e: EcrivainResend, etat: EtatResend, plan: Plan, pas: () => Promise<void>, res: ResultatSynchro): Promise<void> {
  for (const k of SEGMENTS_CLES) {
    const s = etat.segments.find((x) => x.name === SEGMENTS_RESEND[k])
    if (s) { res.segments[k] = s.id; continue }
    if (!plan.segments_a_creer.includes(k)) continue
    const r = await appel(pas, () => e.creerSegment(SEGMENTS_RESEND[k]))
    if (r.error || !r.data) res.erreurs.push(`segment ${k} : ${messageResend(r.error)}`)
    else res.segments[k] = r.data.id
  }
  if (etat.sujet) { res.sujet = etat.sujet.id; return }
  const r = await appel(pas, () => e.creerSujet({ name: SUJET_RESEND.nom, description: SUJET_RESEND.description, defaultSubscription: SUJET_RESEND.defaut }))
  if (r.error || !r.data) res.erreurs.push(`sujet : ${messageResend(r.error)}`)
  else res.sujet = r.data.id
}

/**
 * Ecrit le plan chez Resend. Refuse tout si le plan a un bloquant. Les erreurs sont
 * collectees (sans adresse) : une synchronisation partielle se rejoue sans dommage.
 */
export async function appliquerPlan(e: EcrivainResend, etat: EtatResend, plan: Plan, pas = cadence()): Promise<ResultatSynchro> {
  const res: ResultatSynchro = { segments: {}, sujet: null, crees: 0, importes: 0, imports_lances: 0, ajoutes: 0, retires: 0, pousses: 0, emails_connus_de_resend: [], erreurs: [] }
  if (plan.bloquants.length > 0) { res.erreurs.push(...plan.bloquants); return res }
  await idsResend(e, etat, plan, pas, res)
  const sujet = res.sujet
  if (!sujet || SEGMENTS_CLES.some((k) => !res.segments[k])) return res
  const segId = (k: SegmentCle) => res.segments[k] as string

  if (plan.creer.length > SEUIL_IMPORT) {
    for (const lot of lotsImport(plan.creer)) {
      const r = await appel(pas, () => e.importer({ csv: lot.csv, segments: lot.segments.map((k) => ({ id: segId(k) })), topics: [{ id: sujet, subscription: lot.sujet }] }))
      if (r.error) { res.erreurs.push(`import (${lot.n}) : ${messageResend(r.error)}`); continue }
      res.imports_lances++
      res.importes += lot.n
    }
    for (const c of plan.creer) if (c.sujet === 'opt_out') res.emails_connus_de_resend.push(c.email)
  } else {
    for (const c of plan.creer) {
      const r = await appel(pas, () => e.creerContact({ email: c.email, segments: c.segments.map((k) => ({ id: segId(k) })), topics: [{ id: sujet, subscription: c.sujet }] }))
      if (r.error) { res.erreurs.push(`contact : ${messageResend(r.error)}`); continue }
      res.crees++
      if (c.sujet === 'opt_out') res.emails_connus_de_resend.push(c.email)
    }
  }
  for (const a of plan.ajouter) {
    const r = await appel(pas, () => e.ajouterSegment({ contactId: a.contactId, segmentId: segId(a.segment) }))
    if (r.error) res.erreurs.push(`ajout au segment ${a.segment} : ${messageResend(r.error)}`)
    else res.ajoutes++
  }
  for (const a of plan.retirer) {
    const r = await appel(pas, () => e.retirerSegment({ contactId: a.contactId, segmentId: segId(a.segment) }))
    if (r.error) res.erreurs.push(`retrait du segment ${a.segment} : ${messageResend(r.error)}`)
    else res.retires++
  }
  for (const d of plan.pousser_desinscriptions) {
    const r = await appel(pas, () => e.sujetsOptOut({ contactId: d.contactId, sujetId: sujet }))
    if (r.error) { res.erreurs.push(`désinscription : ${messageResend(r.error)}`); continue }
    res.pousses++
    res.emails_connus_de_resend.push(d.email)
  }
  return res
}

/** Le compte rendu d'une synchronisation, en nombres (pour la colonne synchro et les journaux). */
export function resumeResultat(r: ResultatSynchro): Omit<ResultatSynchro, 'emails_connus_de_resend' | 'segments' | 'sujet'> & { segments: string[]; sujet: boolean; desinscriptions_connues: number } {
  return {
    segments: Object.keys(r.segments), sujet: r.sujet !== null, crees: r.crees, importes: r.importes, imports_lances: r.imports_lances,
    ajoutes: r.ajoutes, retires: r.retires, pousses: r.pousses, desinscriptions_connues: r.emails_connus_de_resend.length, erreurs: r.erreurs,
  }
}

// ---------------------------------------------------------------------------
// Le Broadcast
// ---------------------------------------------------------------------------

export type PayloadBroadcast = {
  segmentId: string
  topicId: string
  from: string
  replyTo: string
  subject: string
  html: string
  text: string
  name: string
  send: false
}

/** Le nom du Broadcast : la date et l'id de NOTRE envoi entre crochets (retrouve a la reprise). */
export function nomBroadcast(envoiId: string, quand: Date): string {
  return `${PREFIXE_NOM_BROADCAST} ${quand.toISOString().slice(0, 10)} [${envoiId}]`
}

export function trouverBroadcast<T extends { name: string | null }>(liste: readonly T[], envoiId: string): T | null {
  return liste.find((b) => (b.name ?? '').includes(`[${envoiId}]`)) ?? null
}

/** Le Broadcast en BROUILLON (send: false) : l'id est garde en base avant l'envoi. */
export function payloadBroadcast(o: {
  segmentId: string; sujetId: string; expediteur: string; repondreA: string; sujet: string; html: string; texte: string; nom: string
}): PayloadBroadcast {
  if (!o.html.includes(VARIABLE_DESINSCRIPTION) || !o.texte.includes(VARIABLE_DESINSCRIPTION)) {
    throw new Error('le lien de désinscription de Resend manque à l\'email')
  }
  return {
    segmentId: o.segmentId, topicId: o.sujetId, from: o.expediteur, replyTo: o.repondreA,
    subject: o.sujet, html: o.html, text: o.texte, name: o.nom.slice(0, 200), send: false,
  }
}

// ---------------------------------------------------------------------------
// Les requetes (ici pour que l'essai de la migration joue EXACTEMENT les memes)
// ---------------------------------------------------------------------------

/** Nos desinscrits actifs et la date a laquelle Resend les connait. */
export const SQL_DESINSCRITS_BASE = `
select email, resend_le
  from public.academie_emails_desinscriptions
 where reinscrit_le is null
 order by email`

/**
 * Les desinscriptions lues chez Resend ($1 emails) versees chez nous. Une reinscription
 * posee chez nous est effacee : la desinscription chez Resend l'emporte, toujours.
 */
export const SQL_IMPORTER_DESINSCRITS = `
insert into public.academie_emails_desinscriptions (email, source, resend_le)
select lower(btrim(e)), 'resend', now()
  from unnest($1::text[]) as e
 where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+$'
on conflict (email) do update
   set desinscrit_le = case when public.academie_emails_desinscriptions.reinscrit_le is null
                            then public.academie_emails_desinscriptions.desinscrit_le else now() end,
       source = case when public.academie_emails_desinscriptions.reinscrit_le is null
                     then public.academie_emails_desinscriptions.source else 'resend' end,
       reinscrit_le = null,
       resend_le = coalesce(public.academie_emails_desinscriptions.resend_le, now())`

/** Nos desinscriptions maintenant connues de Resend ($1 emails). */
export const SQL_NOTER_RESEND_LE = `
update public.academie_emails_desinscriptions
   set resend_le = now()
 where email = any($1::text[]) and resend_le is null`

/** Les Broadcasts de nos envois passes (leurs desinscriptions sont relues a chaque synchronisation). */
export const SQL_BROADCASTS_PASSES = `
select resend_broadcast_id as id
  from public.academie_emails_envois
 where resend_broadcast_id is not null
 order by cree_le desc
 limit 20`

/** $1 envoi, $2 id du Broadcast. Pose une seule fois. */
export const SQL_NOTER_BROADCAST = `
update public.academie_emails_envois
   set resend_broadcast_id = $2
 where id = $1::uuid and resend_broadcast_id is null`

/** $1 envoi, $2 compte rendu de la synchronisation (nombres). */
export const SQL_NOTER_SYNCHRO = `
update public.academie_emails_envois
   set synchro = $2::jsonb
 where id = $1::uuid`

/** Les lignes d'un envoi remises au Broadcast ($1 envoi, $2 id du Broadcast). */
export const SQL_CONFIER = `
update public.academie_emails_destinataires
   set statut = 'confie', resend_id = $2, traite_le = now()
 where envoi_id = $1::uuid and statut = 'a_envoyer'`

/** Simulation d'un Broadcast : toutes les lignes d'un envoi ($1) notees « simule ». */
export const SQL_SIMULER_TOUT = `
update public.academie_emails_destinataires
   set statut = 'simule', traite_le = now()
 where envoi_id = $1::uuid and statut = 'a_envoyer'`
