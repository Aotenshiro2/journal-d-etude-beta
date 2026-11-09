// Le 10% Club paye par PayPal, sans reseau ni base (29/10/2026). Testable
// seul (scripts/verifier-club-paypal.mjs) : aucun import.
//
// Decision de Brice : on garde PayPal pour la formation complete (PayPal
// propose le 4x et avance l'argent, Stripe non). Mais le paiement passe
// desormais par notre serveur (plan de l'academie, section 6, point 6) :
// commande creee et capturee par le journal (Orders v2), puis l'acces
// « formation-complete » s'ouvre tout seul et un email part.
//
// - customIdDe / lireCustomId : le titulaire de l'acces, porte par la
//   commande (u:<uuid> si le compte est connecte, e:<email> sinon) ;
// - decisionCommande : qui peut creer une commande (vente ouverte ou essai admin) ;
// - montantAttendu : 1 EUR en essai, le prix de l'offre sinon ;
// - corpsCommande : le corps de POST /v2/checkout/orders ;
// - lireCommande / etatCapture : ce qu'une commande PayPal relue ouvre ;
// - cleIdempotence : la reference unique de l'acces et l'en-tete PayPal-Request-Id ;
// - noteAcces, modeleEmailClub, htmlEmailClub, texteEmailClub : la trace et l'email ;
// - offrePayPal, offreDeReference, prixCommande, titulaireDe : quelle offre, quel prix, a qui ;
// - modeleEmailCoaching, texteAlerteCoaching, texteAlerteNonNote : le coaching de 8 h.
//
// 08/11/2026 : la meme mecanique vend aussi le coaching de 8 h propose sur
// /merci, juste apres l'achat du Club (PLAN-UPSELL.md, section 7, decide par
// Brice le 08/11). Une seule mecanique pour les deux : OFFRES_PAYPAL dit ce
// qui change d'une offre a l'autre (slug en base, reference_id, prix a
// defaut, case de renonciation), la page dit quelle offre elle vend
// (offrePayPal), et la capture relit l'offre dans la commande PayPal
// (offreDeReference), jamais dans le corps de la requete.

/** L'offre que vend /club : la formation complete (17 modules, Masterclass a part). */
export const OFFRE_CLUB = 'formation-complete'

/** L'offre du coaching de 8 h (academie_offres.slug, migration 20261108235500). */
export const OFFRE_COACHING = 'coaching-8h'

/** Le prix public si la base n'en donne pas (academie_offres.prix_eur). */
export const PRIX_CLUB_DEFAUT_EUR = 1999

/** L'achat test de Brice, rembourse ensuite. */
export const PRIX_ESSAI_EUR = 1

/** purchase_units[0].reference_id : seules ces commandes sont relues comme des achats du 10% Club. */
export const REFERENCE_PUBLIQUE = 'club-10'
export const REFERENCE_ESSAI = 'club-10-essai'

export const DESCRIPTION_COMMANDE = '10% Club - formation complète AO Knowledge'

// ---------------------------------------------------------------------------
// Les offres vendues par ce tunnel PayPal
// ---------------------------------------------------------------------------

export type CleOffre = 'club' | 'coaching'

export type OffrePayPal = {
  cle: CleOffre
  /** academie_offres.slug : la ligne academie_acces de l'achat pointe sur cette offre. */
  slug: string
  /** Le nom dans la note de l'achat et les alertes de l'equipe. */
  nom: string
  /** Le prix si la base n'en donne pas. null : l'offre DOIT etre en base pour se vendre (migration d'abord). */
  prixDefautEur: number | null
  /** purchase_units[0].reference_id, vente publique puis essai admin a 1 EUR. */
  reference: string
  referenceEssai: string
  /** purchase_units[0].description, vue par l'acheteur chez PayPal (127 caracteres au plus). */
  description: string
  /** Prefixe de l'en-tete PayPal-Request-Id de la capture. */
  prefixeCapture: string
  /**
   * La case « acces immediat, je renonce a la retractation » est exigee
   * avant la commande (contenu numerique ouvert tout de suite). Le coaching
   * se livre en seances, plus tard : pas de case, le droit de retractation
   * reste entier.
   */
  renonciation: boolean
}

export const OFFRES_PAYPAL: Record<CleOffre, OffrePayPal> = {
  club: {
    cle: 'club',
    slug: OFFRE_CLUB,
    nom: '10% Club',
    prixDefautEur: PRIX_CLUB_DEFAUT_EUR,
    reference: REFERENCE_PUBLIQUE,
    referenceEssai: REFERENCE_ESSAI,
    description: DESCRIPTION_COMMANDE,
    prefixeCapture: 'club10-capture-',
    renonciation: true,
  },
  coaching: {
    cle: 'coaching',
    slug: OFFRE_COACHING,
    nom: 'Coaching 8 h',
    prixDefautEur: null,
    reference: 'coaching-8h',
    referenceEssai: 'coaching-8h-essai',
    description: 'Coaching individuel 8 h avec Brice - AO Knowledge',
    prefixeCapture: 'coaching8h-capture-',
    renonciation: false,
  },
}

/**
 * L'offre demandee par la page : absente = le 10% Club (les pages d'avant le
 * 08/11 n'envoient rien), 'club' ou 'coaching', sinon null (la route rend 400).
 */
export function offrePayPal(v: unknown): OffrePayPal | null {
  if (v === undefined || v === null || v === 'club') return OFFRES_PAYPAL.club
  if (v === 'coaching') return OFFRES_PAYPAL.coaching
  return null
}

/** L'offre et le mode essai portes par un reference_id relu chez PayPal, ou null (pas une commande de ce tunnel). */
export function offreDeReference(v: unknown): { offre: OffrePayPal; essai: boolean } | null {
  for (const offre of Object.values(OFFRES_PAYPAL)) {
    if (v === offre.reference) return { offre, essai: false }
    if (v === offre.referenceEssai) return { offre, essai: true }
  }
  return null
}

/** custom_id : 127 caracteres au plus chez PayPal, prefixe compris. */
export const MAX_CUSTOM_ID = 127

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** L'identifiant d'une commande ou d'une capture PayPal (17 caracteres en pratique). */
export const estIdPayPal = (v: unknown): v is string => typeof v === 'string' && /^[A-Z0-9]{10,40}$/i.test(v)

/**
 * L'email d'un acheteur sans compte : minuscules, sans espaces, forme
 * raisonnable, assez court pour tenir dans custom_id avec son prefixe « e: ».
 */
export function emailClub(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  if (e.length < 6 || e.length > MAX_CUSTOM_ID - 2) return null
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/.test(e)) return null
  return e
}

export type Titulaire = { userId: string; email?: undefined } | { email: string; userId?: undefined }

/**
 * A qui se rattache l'achat : le compte du jeton d'abord (l'email du corps
 * est alors ignore), sinon l'email envoye par la page. Sur /merci, c'est
 * l'email de l'achat du 10% Club que la page a garde (ou celui que l'acheteur
 * tape) : le coaching se rattache ainsi a la meme personne que le Club.
 * null : ni compte ni email valable (la route rend 400 'email').
 */
export function titulaireDe(p: { userId: string | null; email: unknown }): Titulaire | null {
  if (p.userId && UUID.test(p.userId)) return { userId: p.userId.toLowerCase() }
  const email = emailClub(p.email)
  return email ? { email } : null
}

/** Le custom_id de la commande : le compte connecte d'abord, sinon l'email tape. */
export function customIdDe(t: Titulaire): string {
  if (t.userId) return `u:${t.userId.toLowerCase()}`
  return `e:${t.email}`
}

/** Le titulaire lu dans un custom_id, ou null s'il n'est pas de nous. */
export function lireCustomId(v: unknown): Titulaire | null {
  if (typeof v !== 'string' || v.length > MAX_CUSTOM_ID) return null
  if (v.startsWith('u:') && UUID.test(v.slice(2))) return { userId: v.slice(2).toLowerCase() }
  if (v.startsWith('e:')) {
    const email = emailClub(v.slice(2))
    return email && email === v.slice(2) ? { email } : null
  }
  return null
}

export type Decision = 'ok' | 'ferme' | 'jeton' | 'droit'

/**
 * Qui peut creer une commande. Vente fermee (CLUB_PAYPAL_PUBLIC absente) :
 * seulement une demande essai d'un compte admin. Vente ouverte : tout le
 * monde, et l'essai a 1 EUR reste reserve a l'admin.
 */
export function decisionCommande(p: { ouvert: boolean; essai: boolean; connecte: boolean; admin: boolean }): Decision {
  if (p.essai) {
    if (!p.connecte) return 'jeton'
    return p.admin ? 'ok' : 'droit'
  }
  return p.ouvert ? 'ok' : 'ferme'
}

/**
 * Le montant de la commande, en euros : 1 en essai, sinon le prix en base,
 * a defaut celui de l'offre (1 999 pour le Club). null : l'offre n'a pas de
 * prix a defaut (coaching) et la base n'en donne pas, rien ne se vend.
 */
export function montantAttendu(p: { essai: boolean; prixBase: number | null; offre?: OffrePayPal }): number | null {
  if (p.essai) return PRIX_ESSAI_EUR
  if (typeof p.prixBase === 'number' && Number.isFinite(p.prixBase) && p.prixBase > 0) return p.prixBase
  return (p.offre ?? OFFRES_PAYPAL.club).prixDefautEur
}

/**
 * Le prix d'une commande a creer, d'apres la ligne de l'offre en base (null
 * si l'offre n'y est pas, undefined si on ne l'a pas lue). Une offre sans
 * prix a defaut (coaching) ne se vend pas, meme en essai, tant qu'elle n'est
 * pas en base : l'achat ne pourrait pas y etre note apres la capture.
 */
export function prixCommande(p: { offre: OffrePayPal; essai: boolean; ligne: { prix: number | null } | null | undefined }):
  { ok: true; montantEur: number } | { ok: false } {
  if (p.offre.prixDefautEur === null && !p.ligne) return { ok: false }
  const montantEur = montantAttendu({ essai: p.essai, prixBase: p.ligne?.prix ?? null, offre: p.offre })
  return montantEur === null ? { ok: false } : { ok: true, montantEur }
}

/** « 1999.00 » : le format de PayPal (deux decimales, point). */
export const valeurPayPal = (eur: number) => (Math.round(eur * 100) / 100).toFixed(2)

/** Une valeur PayPal en centimes, ou null. */
export function centimes(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(v)) return null
  return Math.round(Number(v) * 100)
}

/**
 * Le corps de POST /v2/checkout/orders. application_context plutot que
 * payment_source.paypal.experience_context : avec les boutons du JS SDK,
 * l'acheteur peut choisir la carte (formulaire invite) ou le 4x, et
 * application_context vaut pour toutes les sources (NO_SHIPPING compris).
 */
export function corpsCommande(p: { titulaire: Titulaire; montantEur: number; essai: boolean; offre?: OffrePayPal }): Record<string, unknown> {
  const offre = p.offre ?? OFFRES_PAYPAL.club
  return {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: p.essai ? offre.referenceEssai : offre.reference,
      description: offre.description,
      custom_id: customIdDe(p.titulaire),
      amount: { currency_code: 'EUR', value: valeurPayPal(p.montantEur) },
    }],
    application_context: {
      brand_name: 'AO Knowledge',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      locale: 'fr-FR',
    },
  }
}

/**
 * La reference unique de l'acces (academie_acces.reference, index
 * academie_acces_paypal_reference_idx) : l'identifiant de la commande. Une
 * commande ouvre l'acces une seule fois, quel que soit le nombre d'appels.
 */
export const cleIdempotence = (orderId: string) => orderId.toUpperCase()

/** L'en-tete PayPal-Request-Id de la capture : la rejouer rend la meme reponse chez PayPal. */
export const requeteCapture = (orderId: string, offre: CleOffre = 'club') =>
  `${OFFRES_PAYPAL[offre].prefixeCapture}${cleIdempotence(orderId)}`

export type CaptureLue = { id: string; statut: string; centimes: number | null }

export type CommandeLue = {
  orderId: string
  /** Statut de la commande : CREATED, APPROVED, COMPLETED, VOIDED, PAYER_ACTION_REQUIRED... */
  statut: string
  essai: boolean
  /** L'offre lue dans reference_id (jamais dans la requete de la page). */
  offre: CleOffre
  titulaire: Titulaire
  centimes: number
  devise: string
  /** create_time de la commande : la case de renonciation est cochee avant sa creation. */
  creeLe: Date | null
  payeurEmail: string | null
  /** payer.name.given_name, brut (le mail d'acces le met en forme avec prenomDe, mails-achat-pur.ts). */
  payeurPrenom: string | null
  capture: CaptureLue | null
}

export type LectureCommande =
  | { ok: true; commande: CommandeLue }
  | { ok: false; raison: 'pas_club' | 'incomplet' }

function objet(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

function date(v: unknown): Date | null {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** La capture qui compte : une COMPLETED s'il y en a, sinon la premiere. */
function captureDe(unite: Record<string, unknown>): CaptureLue | null {
  const captures = objet(unite.payments).captures
  if (!Array.isArray(captures) || !captures.length) return null
  const lues = captures.map(objet).filter(c => estIdPayPal(c.id)).map(c => ({
    id: String(c.id),
    statut: typeof c.status === 'string' ? c.status : 'INCONNU',
    centimes: centimes(objet(c.amount).value),
  }))
  return lues.find(c => c.statut === 'COMPLETED') ?? lues[0] ?? null
}

/**
 * Une commande PayPal relue (GET /v2/checkout/orders/:id, ou la reponse de la
 * capture) : l'achat qu'elle porte (10% Club ou coaching), ou pourquoi rien.
 * Seules comptent nos commandes : un reference_id de OFFRES_PAYPAL (club-10,
 * coaching-8h, ou leur essai) et un custom_id que nous avons pose. La raison
 * 'pas_club' garde son nom d'avant le 08/11 : « pas une commande de ce tunnel ».
 */
export function lireCommande(o: Record<string, unknown>): LectureCommande {
  const unites = Array.isArray(o.purchase_units) ? o.purchase_units.map(objet) : []
  const u = unites[0] ?? {}
  const ref = offreDeReference(u.reference_id)
  if (!estIdPayPal(o.id) || !ref || unites.length !== 1) {
    return { ok: false, raison: 'pas_club' }
  }
  const capture = captureDe(u)
  // La capture repete custom_id : utile quand purchase_units vient d'une reponse minimale.
  const customs = Array.isArray(objet(u.payments).captures) ? (objet(u.payments).captures as unknown[]).map(c => objet(c).custom_id) : []
  const titulaire = lireCustomId(u.custom_id) ?? lireCustomId(customs.find(c => typeof c === 'string'))
  const montant = objet(u.amount)
  const total = centimes(montant.value)
  if (!titulaire || total === null || typeof montant.currency_code !== 'string') return { ok: false, raison: 'incomplet' }
  const payeur = objet(o.payer)
  const payeurEmail = typeof payeur.email_address === 'string' ? payeur.email_address.trim().toLowerCase() || null : null
  return {
    ok: true,
    commande: {
      orderId: cleIdempotence(String(o.id)),
      statut: typeof o.status === 'string' ? o.status : 'INCONNU',
      essai: ref.essai,
      offre: ref.offre.cle,
      titulaire,
      centimes: total,
      devise: montant.currency_code,
      creeLe: date(o.create_time),
      payeurEmail,
      payeurPrenom: typeof objet(payeur.name).given_name === 'string' ? String(objet(payeur.name).given_name).trim() || null : null,
      capture,
    },
  }
}

export type EtatCapture =
  | 'a_capturer' | 'capturee' | 'en_attente' | 'refusee' | 'remboursee' | 'non_approuvee' | 'annulee' | 'inconnu'

/** Ou en est le paiement : ce qui decide la capture, puis l'acces. */
export function etatCapture(c: Pick<CommandeLue, 'statut' | 'capture'>): EtatCapture {
  if (c.capture) {
    const s = c.capture.statut
    if (s === 'COMPLETED' || s === 'PARTIALLY_REFUNDED') return 'capturee'
    if (s === 'PENDING') return 'en_attente'
    if (s === 'DECLINED' || s === 'FAILED') return 'refusee'
    if (s === 'REFUNDED') return 'remboursee'
    return 'inconnu'
  }
  if (c.statut === 'APPROVED') return 'a_capturer'
  if (c.statut === 'CREATED' || c.statut === 'SAVED' || c.statut === 'PAYER_ACTION_REQUIRED') return 'non_approuvee'
  if (c.statut === 'VOIDED') return 'annulee'
  return 'inconnu'
}

/**
 * La commande porte-t-elle le bon montant (EUR, 1 EUR en essai, le prix de
 * son offre sinon) ? Une offre sans prix en base ni prix a defaut : jamais.
 */
export function montantConforme(
  c: Pick<CommandeLue, 'centimes' | 'devise' | 'essai'> & { offre?: CleOffre }, prixBase: number | null,
): boolean {
  const attendu = montantAttendu({ essai: c.essai, prixBase, offre: OFFRES_PAYPAL[c.offre ?? 'club'] })
  return attendu !== null && c.devise === 'EUR' && c.centimes === Math.round(attendu * 100)
}

/** Le premier « issue » d'une erreur PayPal (ORDER_ALREADY_CAPTURED, INSTRUMENT_DECLINED...), sans valeur ni description. */
export function issuePayPal(corps: unknown): string {
  const d = objet(corps).details
  const premier = Array.isArray(d) ? objet(d[0]).issue : undefined
  if (typeof premier === 'string' && /^[A-Z_]{3,80}$/.test(premier)) return premier
  const nom = objet(corps).name
  return typeof nom === 'string' && /^[A-Z_]{3,80}$/.test(nom) ? nom : 'INCONNU'
}

/** La note de l'acces : de quoi retrouver le paiement chez PayPal (1 000 caracteres au plus). */
export function noteAcces(p: {
  orderId: string; captureId: string; centimes: number; essai: boolean; renonciationLe: Date | null
  payeurEmail: string | null; email: string | null; offre?: CleOffre
}): string {
  const offre = OFFRES_PAYPAL[p.offre ?? 'club']
  const bouts = [
    `PayPal ${offre.nom} : commande ${p.orderId}, capture ${p.captureId}, ${(p.centimes / 100).toFixed(2)} EUR`,
    p.essai ? 'ACHAT TEST (essai a 1 EUR, a rembourser)' : null,
    !offre.renonciation ? 'seances a fixer avec Brice, aucun contenu ouvert' : p.renonciationLe ? null : 'renonciation datee de la capture (date de commande illisible)',
    p.payeurEmail && p.payeurEmail !== p.email ? `email du payeur PayPal : ${p.payeurEmail}` : null,
  ]
  return bouts.filter(Boolean).join(' | ').slice(0, 1000)
}

// ---------------------------------------------------------------------------
// L'email d'acces (Resend, depuis support@ ; replyTo support@)
// ---------------------------------------------------------------------------

export const URL_ACADEMIE = 'https://aoknowledge.com/academie'
export const URL_CONNEXION = 'https://aoknowledge.com/connexion'
export const URL_COMPTES_LIES = 'https://aoknowledge.com/mon-espace/parametres/comptes'

export type ModeleEmailClub = {
  sujet: string
  /** Paragraphes ; {lien:<url>|<texte>} devient un lien en HTML et « texte : url » en texte brut. */
  paragraphes: string[]
  /** null : pas de bouton (le mail du coaching sans lien de reservation). */
  bouton: { texte: string; url: string } | null
}

export const URL_CONDITIONS = 'https://aoknowledge.com/conditions-generales'

/** La signature des mails d'achat (brief F1, Brice 30/10 : vouvoiement, « Brice et Mélanie »). */
export const SIGNATURE_CLUB = ['À bientôt sur les marchés,', 'Brice et Mélanie'] as const

/**
 * L'email d'acces : ce qui est ouvert, ou entrer, avec quelle adresse, et
 * comment en ajouter une. Texte valide de la Formation complete (brief F1,
 * 30/10, D:\2_Creation\Productions\Ecriture\2026-10-30-mails-confirmation-achat.md,
 * section 5), MOT POUR MOT : le meme que modeleFormation (mails-achat-pur.ts),
 * verifie par scripts/verifier-mails-achat.mjs. montant (« 1 999 euros ») et
 * prenom deja mis en forme par l'appelant (formaterEuros, prenomDe) ; absents,
 * la phrase s'en passe.
 */
export function modeleEmailClub(p: { email: string; essai: boolean; montant?: string | null; prenom?: string | null }): ModeleEmailClub {
  const paiement = p.montant ? `votre paiement de ${p.montant} est bien reçu` : 'votre paiement est bien reçu'
  return {
    sujet: `${p.essai ? '[Essai] ' : ''}Votre accès au 10% Club est ouvert`,
    paragraphes: [
      p.prenom ? `Bonjour ${p.prenom},` : 'Bonjour,',
      `Bienvenue dans le 10% Club. Merci, ${paiement}, et la formation complète est ouverte, à vie. Si vous payez en 4 fois, les échéances sont gérées par PayPal, pas par nous.`,
      "Tout est dans l'académie : le parcours de 0 à 5, Psychologie et émotions, les Chroniques de l'Accélérateur, Journaling, nos articles privés, les archives et les replays du Live Club. Le Carnet du Trader Premium et Pilotage Premium sont inclus aussi, avec la même adresse.",
      `Pour entrer : {lien:${URL_CONNEXION}|aoknowledge.com/connexion}, avec ${p.email}, l'adresse de votre achat. C'est elle qui ouvre l'accès. Pas encore de compte ? Il se crée à votre première connexion. Une autre adresse vous convient mieux ? Une fois connecté, ajoutez-la dans Mon espace, Comptes liés : {lien:${URL_COMPTES_LIES}|aoknowledge.com/mon-espace/parametres/comptes}`,
      'Vous pouvez reprendre le parcours depuis le début ou au niveau qui est le vôtre : votre progression se garde toute seule.',
      `Vous avez demandé l'accès immédiat en payant, ce qui vaut renonciation à votre droit de rétractation (nos conditions : {lien:${URL_CONDITIONS}|aoknowledge.com/conditions-generales}). Votre reçu, lui, vient de PayPal.`,
      'Une question, un souci ? Répondez à cet email, ou écrivez à support@aoknowledge.com : ça arrive chez nous dans les deux cas.',
    ],
    bouton: { texte: "Ouvrir l'académie", url: URL_ACADEMIE },
  }
}

export function echapper(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const LIEN = /\{lien:(https:\/\/[^|}]+)\|([^}]+)\}/g

function paragrapheHtml(p: string): string {
  let html = ''
  let dernier = 0
  for (const m of p.matchAll(LIEN)) {
    html += echapper(p.slice(dernier, m.index))
    html += `<a href="${echapper(m[1])}" style="color:#111827">${echapper(m[2])}</a>`
    dernier = (m.index ?? 0) + m[0].length
  }
  return html + echapper(p.slice(dernier))
}

/** Meme gabarit que les emails du Live Club (liveclub/emails.ts), signe Brice et Melanie (brief F1). */
export function htmlEmailClub(m: ModeleEmailClub): string {
  const corps = m.paragraphes.map(p => `<p style="margin:0 0 16px;line-height:1.5">${paragrapheHtml(p)}</p>`).join('\n')
  const bouton = m.bouton
    ? `<p style="margin:24px 0"><a href="${echapper(m.bouton.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">${echapper(m.bouton.texte)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280">Si le bouton ne marche pas, copiez ce lien : ${echapper(m.bouton.url)}</p>
`
    : ''
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#ffffff;color:#111827;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px">
<div style="max-width:560px;margin:0 auto">
${corps}
${bouton}<p style="margin:32px 0 0;line-height:1.5">${SIGNATURE_CLUB.map(echapper).join('<br>')}</p>
</div></body></html>`
}

export function texteEmailClub(m: ModeleEmailClub): string {
  const paragraphes = m.paragraphes.map(p => p.replace(LIEN, (_t, url: string) => url))
  return [...paragraphes, ...(m.bouton ? [`${m.bouton.texte} : ${m.bouton.url}`] : []), SIGNATURE_CLUB.join('\n')].join('\n\n')
}

// ---------------------------------------------------------------------------
// Le coaching de 8 h (08/11/2026) : l'email de l'acheteur et l'alerte de l'equipe
// ---------------------------------------------------------------------------

/**
 * Le lien de reservation des seances. Aucun lien propre au coaching de 8 h
 * le 08/11 : cal.com/brice-delannay montre l'appel decouverte (30 min) et une
 * consultation PAYANTE (50 min, 250 EUR) ; les evenements caches deep-dive et
 * elite-trader-mentorship servent d'autres offres. Sans lien, l'email dit
 * que Brice contacte l'acheteur sous 48 h, et l'alerte le lui rappelle. Un
 * lien se pose sans code par la variable COACHING_RESERVATION_URL (journal).
 */
export const URL_RESERVATION_COACHING: string | null = null

/** Un lien de reservation acceptable (https, sans espace, 300 caracteres au plus), ou null. */
export function lienReservation(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const u = v.trim()
  if (!/^https:\/\/[^\s<>"'{}|\\^`]+$/.test(u) || u.length > 300) return null
  try {
    return new URL(u).protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

/**
 * L'email de l'acheteur du coaching : meme expediteur, meme gabarit et meme
 * signature que le mail du Club (vouvoiement, brief F1). Ce qui est paye, ce
 * que contiennent les seances (les points de /merci), l'adresse a laquelle
 * l'achat est rattache, puis la suite : le lien de reservation s'il existe,
 * sinon « Brice vous contacte sous 48 h ». Aucun acces a l'academie : le
 * coaching se livre en seances.
 */
export function modeleEmailCoaching(p: {
  email: string; essai: boolean; montant?: string | null; prenom?: string | null; reservation: string | null
}): ModeleEmailClub {
  const paiement = p.montant ? `votre paiement de ${p.montant} est bien reçu` : 'votre paiement est bien reçu'
  const reservation = lienReservation(p.reservation)
  return {
    sujet: `${p.essai ? '[Essai] ' : ''}Votre coaching avec Brice est confirmé`,
    paragraphes: [
      p.prenom ? `Bonjour ${p.prenom},` : 'Bonjour,',
      `Merci, ${paiement} : vos 8 séances de coaching individuel avec Brice vous attendent. Si vous payez en 4 fois, les échéances sont gérées par PayPal, pas par nous.`,
      "Chaque séance dure 1 h. On y analyse vos trades et votre journal, et on corrige votre process en temps réel. Entre deux séances, vous avez un accès prioritaire par message.",
      reservation
        ? `Pour fixer votre première séance, choisissez votre créneau : {lien:${reservation}|${reservation.replace(/^https:\/\//, '')}}`
        : 'Brice vous contacte sous 48 h pour fixer votre première séance.',
      `Votre coaching est enregistré avec ${p.email}, l'adresse de votre achat. C'est elle que nous utilisons pour vous joindre. Votre reçu, lui, vient de PayPal.`,
      "Une question d'ici là ? Répondez à cet email, ou écrivez à support@aoknowledge.com : ça arrive chez nous dans les deux cas.",
    ],
    bouton: reservation ? { texte: 'Réserver ma première séance', url: reservation } : null,
  }
}

/**
 * L'alerte de l'equipe a chaque coaching paye (Telegram, Agent AOK, comme la
 * capture en attente) : qui, combien, s'il a bien un achat du 10% Club, si
 * l'email est parti, et ce qu'il reste a faire. Rien que PayPal ne sache deja.
 */
export function texteAlerteCoaching(p: {
  orderId: string; captureId: string; centimes: number; essai: boolean
  email: string | null; payeurEmail: string | null; membreClub: boolean | null
  emailEnvoye: boolean; reservation: string | null
}): string {
  const club = p.membreClub === true
    ? 'Rattache a un achat du 10% Club (meme compte ou meme email).'
    : p.membreClub === false
      ? 'AUCUN achat du 10% Club trouve pour ce compte ou cet email : verifier qui a paye.'
      : "Achat du 10% Club non verifie (base illisible)."
  const mail = !p.emailEnvoye
    ? "Email de confirmation NON envoye : prevenir l'acheteur a la main."
    : p.reservation ? "Email envoye avec le lien de reservation." : 'Email envoye : il dit que Brice le contacte sous 48 h.'
  return [
    `Coaching 8 h PAYE${p.essai ? ' (essai a 1 EUR, a rembourser)' : ''} : ${(p.centimes / 100).toFixed(2)} EUR par PayPal.`,
    `Acheteur : ${p.email ?? 'email inconnu'}${p.payeurEmail && p.payeurEmail !== p.email ? ` (payeur PayPal : ${p.payeurEmail})` : ''}.`,
    club,
    mail,
    p.reservation ? null : 'A FAIRE : le contacter sous 48 h pour fixer la premiere seance.',
    `Commande ${p.orderId}, capture ${p.captureId}.`,
  ].filter(Boolean).join('\n')
}

/** L'alerte d'un paiement encaisse dont l'achat n'a pas pu etre note (base, offre absente) : a reprendre a la main. */
export function texteAlerteNonNote(p: { orderId: string; captureId: string; centimes: number; essai: boolean; email: string | null; offre: CleOffre }): string {
  const offre = OFFRES_PAYPAL[p.offre]
  return [
    `${offre.nom} : paiement PayPal ENCAISSE mais NON NOTE en base${p.essai ? ' (essai)' : ''}.`,
    `Commande ${p.orderId}, capture ${p.captureId}, ${(p.centimes / 100).toFixed(2)} EUR${p.email ? `, pour ${p.email}` : ''}.`,
    `Relancer la capture une fois la base revenue (elle est idempotente) : POST https://journal.aoknowledge.com/api/club/paypal/capturer {"order_id":"${p.orderId}"}`,
  ].join('\n')
}

/** L'alerte de l'equipe pour une capture en attente (Telegram, Agent AOK). Pas de secret, rien que PayPal ne sache deja. */
export function texteAlerteEnAttente(p: {
  orderId: string; captureId: string; centimes: number; essai: boolean; email: string | null; offre?: CleOffre
}): string {
  const offre = OFFRES_PAYPAL[p.offre ?? 'club']
  const coaching = offre.cle === 'coaching'
  return [
    `${offre.nom} : paiement PayPal EN ATTENTE${p.essai ? ' (essai)' : ''}.`,
    `Commande ${p.orderId}, capture ${p.captureId}, ${(p.centimes / 100).toFixed(2)} EUR${p.email ? `, ${coaching ? 'achat' : 'acces'} prevu pour ${p.email}` : ''}.`,
    coaching
      ? "Le coaching n'est PAS encore note. Pas de webhook PayPal pour l'instant : une fois le paiement confirme chez PayPal, relancer la capture (elle note l'achat, envoie l'email et l'alerte) :"
      : "L'acces n'est PAS ouvert. Pas de webhook PayPal pour l'instant : une fois le paiement confirme chez PayPal, relancer la capture (elle ouvre l'acces et envoie l'email) :",
    `POST https://journal.aoknowledge.com/api/club/paypal/capturer {"order_id":"${p.orderId}"}`,
  ].join('\n')
}
