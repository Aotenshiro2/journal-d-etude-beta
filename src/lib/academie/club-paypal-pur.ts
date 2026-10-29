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
// - noteAcces, modeleEmailClub, htmlEmailClub, texteEmailClub : la trace et l'email.

/** L'offre que vend /club : la formation complete (17 modules, Masterclass a part). */
export const OFFRE_CLUB = 'formation-complete'

/** Le prix public si la base n'en donne pas (academie_offres.prix_eur). */
export const PRIX_CLUB_DEFAUT_EUR = 1999

/** L'achat test de Brice, rembourse ensuite. */
export const PRIX_ESSAI_EUR = 1

/** purchase_units[0].reference_id : seules ces commandes sont relues comme des achats du 10% Club. */
export const REFERENCE_PUBLIQUE = 'club-10'
export const REFERENCE_ESSAI = 'club-10-essai'

export const DESCRIPTION_COMMANDE = '10% Club - formation complète AO Knowledge'

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

/** Le montant de la commande, en euros : 1 en essai, sinon le prix en base (a defaut 1 999). */
export function montantAttendu(p: { essai: boolean; prixBase: number | null }): number {
  if (p.essai) return PRIX_ESSAI_EUR
  return typeof p.prixBase === 'number' && Number.isFinite(p.prixBase) && p.prixBase > 0 ? p.prixBase : PRIX_CLUB_DEFAUT_EUR
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
export function corpsCommande(p: { titulaire: Titulaire; montantEur: number; essai: boolean }): Record<string, unknown> {
  return {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: p.essai ? REFERENCE_ESSAI : REFERENCE_PUBLIQUE,
      description: DESCRIPTION_COMMANDE,
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
export const requeteCapture = (orderId: string) => `club10-capture-${cleIdempotence(orderId)}`

export type CaptureLue = { id: string; statut: string; centimes: number | null }

export type CommandeLue = {
  orderId: string
  /** Statut de la commande : CREATED, APPROVED, COMPLETED, VOIDED, PAYER_ACTION_REQUIRED... */
  statut: string
  essai: boolean
  titulaire: Titulaire
  centimes: number
  devise: string
  /** create_time de la commande : la case de renonciation est cochee avant sa creation. */
  creeLe: Date | null
  payeurEmail: string | null
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
 * capture) : l'achat du 10% Club qu'elle porte, ou pourquoi rien. Seules
 * comptent nos commandes : reference_id club-10 (ou club-10-essai) et un
 * custom_id que nous avons pose.
 */
export function lireCommande(o: Record<string, unknown>): LectureCommande {
  const unites = Array.isArray(o.purchase_units) ? o.purchase_units.map(objet) : []
  const u = unites[0] ?? {}
  const reference = u.reference_id
  if (!estIdPayPal(o.id) || (reference !== REFERENCE_PUBLIQUE && reference !== REFERENCE_ESSAI) || unites.length !== 1) {
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
      essai: reference === REFERENCE_ESSAI,
      titulaire,
      centimes: total,
      devise: montant.currency_code,
      creeLe: date(o.create_time),
      payeurEmail,
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

/** La commande porte-t-elle le bon montant (EUR, 1 EUR en essai, le prix sinon) ? */
export function montantConforme(c: Pick<CommandeLue, 'centimes' | 'devise' | 'essai'>, prixBase: number | null): boolean {
  return c.devise === 'EUR' && c.centimes === Math.round(montantAttendu({ essai: c.essai, prixBase }) * 100)
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
  payeurEmail: string | null; email: string | null
}): string {
  const bouts = [
    `PayPal 10% Club : commande ${p.orderId}, capture ${p.captureId}, ${(p.centimes / 100).toFixed(2)} EUR`,
    p.essai ? 'ACHAT TEST (essai a 1 EUR, a rembourser)' : null,
    p.renonciationLe ? null : 'renonciation datee de la capture (date de commande illisible)',
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
  bouton: { texte: string; url: string }
}

/** L'email d'acces : ce qui est ouvert, ou entrer, avec quelle adresse, et comment en ajouter une. */
export function modeleEmailClub(p: { email: string; essai: boolean }): ModeleEmailClub {
  return {
    sujet: `${p.essai ? '[Essai] ' : ''}Ton accès au 10% Club est ouvert`,
    paragraphes: [
      'Bienvenue dans le 10% Club. Ton paiement est bien reçu : ta formation complète est ouverte, à vie.',
      "Tout est dans l'académie : le parcours de 0 à 5, Psychologie et émotions, les Chroniques de l'Accélérateur, Journaling, nos articles privés, les archives et les replays du Live Club.",
      `Pour y entrer, connecte-toi avec CETTE adresse : ${p.email}. Pas encore de compte ? Il se crée à ta première connexion : {lien:${URL_CONNEXION}|aoknowledge.com/connexion}`,
      `Tu préfères une autre adresse ? Une fois connecté, ajoute-la dans Comptes liés : {lien:${URL_COMPTES_LIES}|Mon espace, Comptes liés}`,
      'Une question ? Réponds simplement à cet email.',
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

/** Meme gabarit que les emails du Live Club (liveclub/emails.ts), signe AO Knowledge. */
export function htmlEmailClub(m: ModeleEmailClub): string {
  const corps = m.paragraphes.map(p => `<p style="margin:0 0 16px;line-height:1.5">${paragrapheHtml(p)}</p>`).join('\n')
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#ffffff;color:#111827;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px">
<div style="max-width:560px;margin:0 auto">
${corps}
<p style="margin:24px 0"><a href="${echapper(m.bouton.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">${echapper(m.bouton.texte)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280">Si le bouton ne marche pas, copie ce lien : ${echapper(m.bouton.url)}</p>
<p style="margin:32px 0 0;font-size:13px;color:#6b7280">AO Knowledge</p>
</div></body></html>`
}

export function texteEmailClub(m: ModeleEmailClub): string {
  const paragraphes = m.paragraphes.map(p => p.replace(LIEN, (_t, url: string) => url))
  return [...paragraphes, `${m.bouton.texte} : ${m.bouton.url}`, 'AO Knowledge'].join('\n\n')
}

/** L'alerte de l'equipe pour une capture en attente (Telegram, Agent AOK). Pas de secret, rien que PayPal ne sache deja. */
export function texteAlerteEnAttente(p: { orderId: string; captureId: string; centimes: number; essai: boolean; email: string | null }): string {
  return [
    `10% Club : paiement PayPal EN ATTENTE${p.essai ? ' (essai)' : ''}.`,
    `Commande ${p.orderId}, capture ${p.captureId}, ${(p.centimes / 100).toFixed(2)} EUR${p.email ? `, acces prevu pour ${p.email}` : ''}.`,
    "L'acces n'est PAS ouvert. Pas de webhook PayPal pour l'instant : une fois le paiement confirme chez PayPal, relancer la capture (elle ouvre l'acces et envoie l'email) :",
    `POST https://journal.aoknowledge.com/api/club/paypal/capturer {"order_id":"${p.orderId}"}`,
  ].join('\n')
}
