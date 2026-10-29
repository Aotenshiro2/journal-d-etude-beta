// Les mails de confirmation d'achat (brief F1, 30/10/2026), sans base ni
// reseau ni import : scripts/verifier-mails-achat.mjs les teste avec Node seul.
//
// Textes repris MOT POUR MOT de
// D:\2_Creation\Productions\Ecriture\2026-10-30-mails-confirmation-achat.md
// (vouvoiement, signature « Brice et Mélanie », envoi depuis support@). Un
// texte se change dans ce fichier source d'abord, puis ici.
//
// - un modele par produit : Pilotage Premium, Premium Duo, Carnet Premium,
//   module a l'unite, Formation complete (le 10% Club, envoye par
//   club-paypal.ts avec modeleEmailClub, aligne sur le meme texte) ;
// - rendreMail : { objet, texte, html } comme les mails du Live Club ;
// - les regles de l'envoi : quel evenement envoie (jamais un renouvellement),
//   la cle anti-doublon, le prefixe [Essai], le prenom, le montant, la date.
//
// Le Live Club n'a pas de modele ici : son texte attend Melanie.

export type ProduitMail = 'pilotage-premium' | 'premium-duo' | 'carnet-premium' | 'module' | 'formation'

/** Le produit « Carnet Premium » sur le Stripe Ao Knowledge (meme valeur que CARNET_PREMIUM_PRODUCT, entitlements.ts). */
export const PRODUIT_STRIPE_CARNET_PREMIUM = 'prod_V9jniZCCbIJsmV'

export const URL_SITE = 'https://aoknowledge.com'
export const URL_DOCUMENTS_PILOTAGE = 'https://pilotage.aoknowledge.com/documents'
export const URL_EXTENSION = 'https://aoknowledge.com/library/extension'
export const URL_ACADEMIE_MAIL = 'https://aoknowledge.com/academie'
export const SUPPORT_MAIL = 'support@aoknowledge.com'
export const PREFIXE_ESSAI = '[Essai] '

/** Ce que le mail affiche. Une variable absente change la phrase, jamais un trou dans le texte. */
export type VariablesMail = {
  prenom: string | null
  /** « Pilotage Premium (mensuel) » : abonnements seulement. */
  offre?: string | null
  /** « 5,99 euros » (formaterEuros). */
  montant: string | null
  /** « 30 novembre 2026 » (formaterDateLongue) : abonnements seulement. */
  prochaineEcheance?: string | null
  /** Lien de connexion au portail client Stripe (PILOTAGE_PORTAIL_LIEN). */
  lienPortail?: string | null
  titreModule?: string | null
  lienModule?: string | null
  email: string
  essai: boolean
}

export type ModeleMail = {
  objet: string
  preheader: string
  /** Le corps sans la signature. Un « \n » dans un paragraphe = retour a la ligne. */
  paragraphes: string[]
  bouton: { texte: string; url: string }
}

export type MailRendu = { objet: string; texte: string; html: string }

export const SIGNATURE = 'À bientôt sur les marchés,\nBrice et Mélanie'

const QUESTION = `Une question, un souci ? Répondez à cet email, ou écrivez à ${SUPPORT_MAIL} : ça arrive chez nous dans les deux cas.`
const RECU_MON_ESPACE = 'Votre reçu est dans Mon espace, rubrique Achats : aoknowledge.com/mon-espace/parametres/achats'
const RETRACTATION = "Vous avez demandé l'accès immédiat en payant, ce qui vaut renonciation à votre droit de rétractation (nos conditions : aoknowledge.com/conditions-generales)."

const bonjour = (v: VariablesMail) => (v.prenom ? `Bonjour ${v.prenom},` : 'Bonjour,')
const objetDe = (v: VariablesMail, objet: string) => `${v.essai ? PREFIXE_ESSAI : ''}${objet}`
/** « : Pilotage Premium (mensuel), 5,99 euros » ; ce qui manque tombe. */
const offreEtMontant = (v: VariablesMail) => [v.offre, v.montant].filter(Boolean).join(', ')
const recu = (merci: string, v: VariablesMail) => {
  const quoi = offreEtMontant(v)
  return quoi ? `${merci} : ${quoi}.` : `${merci}.`
}

// ---------------------------------------------------------------------------
// 1. Pilotage Premium (mensuel et annuel)
// ---------------------------------------------------------------------------

export function modelePilotagePremium(v: VariablesMail): ModeleMail {
  const echeance = v.prochaineEcheance ? `Côté abonnement, le prochain prélèvement tombe le ${v.prochaineEcheance}. Pour` : 'Côté abonnement, pour'
  const gerer = v.lienPortail
    ? `changer de carte, de rythme ou arrêter : ${v.lienPortail} (le bouton « Gérer mon abonnement » de pilotage.aoknowledge.com/offres mène au même endroit).`
    : 'changer de carte, de rythme ou arrêter : le bouton « Gérer mon abonnement » de pilotage.aoknowledge.com/offres.'
  return {
    objet: objetDe(v, 'Pilotage Premium est ouvert'),
    preheader: 'Votre paiement est bien passé. Voilà ce qui change, et par où commencer.',
    paragraphes: [
      bonjour(v),
      `${recu("Merci, c'est bien reçu", v)} Pilotage Premium est ouvert sur votre compte AOKnowledge, vous n'avez rien à activer (si le compteur n'a pas bougé au bout d'une minute, rechargez la page).`,
      "Concrètement, vous passez à 200 lectures intelligentes par mois, les documents longs sont lus en entier, et votre coffre monte à 2 Go pour garder vos originaux. Une lecture intelligente, c'est un document que Pilotage lit pour vous quand il ne le reconnaît pas tout seul : une facture, un relevé en PDF, une capture. Le reste de Pilotage ne change pas, vous l'aviez déjà.",
      "Pour commencer, déposez vos documents : vous glissez un dossier entier (exports de votre plateforme, relevés, factures, captures), Pilotage trie, vous montre une revue avant d'écrire quoi que ce soit, puis range chaque chose à sa place. Vos originaux restent dans votre coffre, dans « Mes documents ».",
      "Pilotage est encore jeune (version 0.3) : il bouge souvent, et l'écran Versions de l'app dit ce qui a changé.",
      `${echeance} ${gerer} Si vous arrêtez, Premium reste ouvert jusqu'à la fin de la période déjà payée. ${RECU_MON_ESPACE}`,
      QUESTION,
    ],
    bouton: { texte: 'Déposer mes documents', url: URL_DOCUMENTS_PILOTAGE },
  }
}

// ---------------------------------------------------------------------------
// 2. Premium Duo (Carnet Premium + Pilotage Premium)
// ---------------------------------------------------------------------------

export function modelePremiumDuo(v: VariablesMail): ModeleMail {
  const prelevement = v.prochaineEcheance
    ? `Un seul prélèvement pour les deux, le prochain le ${v.prochaineEcheance}.`
    : 'Un seul prélèvement pour les deux.'
  const gerer = v.lienPortail
    ? `Pour changer de carte, de rythme ou arrêter : ${v.lienPortail}.`
    : 'Pour changer de carte, de rythme ou arrêter : le bouton « Gérer mon abonnement » de pilotage.aoknowledge.com/offres.'
  return {
    objet: objetDe(v, 'Votre Duo est ouvert'),
    preheader: 'Le Carnet Premium et Pilotage Premium, sur un seul abonnement.',
    paragraphes: [
      bonjour(v),
      `${recu('Merci, votre paiement est bien passé', v)} Un seul abonnement ouvre les deux, le Carnet du Trader Premium et Pilotage Premium, sur votre compte AOKnowledge.`,
      `Dans le Carnet, vous avez maintenant la capture intelligente, vos graphiques lus à l'image, le bouton « Approfondir cette note » et le mode mentorat. Ouvrez l'extension depuis la barre de votre navigateur et connectez-vous avec ${v.email}, l'adresse de votre achat : « Carnet Premium est actif » s'affiche dans Mon forfait. Pas encore installée ? aoknowledge.com/library/extension`,
      "Dans Pilotage, vous passez à 200 lectures intelligentes par mois, les documents longs sont lus en entier, et votre coffre monte à 2 Go. Pour commencer, déposez vos documents : vous glissez un dossier entier (exports, relevés, factures, captures), Pilotage trie et vous montre une revue avant d'écrire quoi que ce soit. Il est encore jeune (version 0.3), l'écran Versions de l'app dit ce qui bouge.",
      `${prelevement} ${gerer} Si vous arrêtez, tout reste ouvert jusqu'à la fin de la période déjà payée, puis le Carnet et Pilotage repassent à leur version gratuite. ${RECU_MON_ESPACE}`,
      QUESTION,
    ],
    bouton: { texte: 'Déposer mes documents', url: URL_DOCUMENTS_PILOTAGE },
  }
}

// ---------------------------------------------------------------------------
// 3. Carnet Premium (mensuel et annuel)
// ---------------------------------------------------------------------------

export function modeleCarnetPremium(v: VariablesMail): ModeleMail {
  const echeance = v.prochaineEcheance ? `Côté abonnement, le prochain prélèvement tombe le ${v.prochaineEcheance}. Pour` : 'Côté abonnement, pour'
  const gerer = v.lienPortail
    ? `changer de carte, de rythme ou arrêter : ${v.lienPortail} (le même lien est dans le reçu que Stripe vous envoie).`
    : 'changer de carte, de rythme ou arrêter : le lien est dans le reçu que Stripe vous envoie.'
  return {
    objet: objetDe(v, 'Carnet Premium est actif'),
    preheader: 'Votre abonnement est en place. Ce que ça ouvre, et comment le vérifier.',
    paragraphes: [
      bonjour(v),
      `${recu("Merci, c'est bien reçu", v)} Carnet Premium s'ouvre sur votre compte AOKnowledge.`,
      "Dans le Carnet du Trader, ça ajoute la capture intelligente (le carnet lit votre capture et en tire la note), vos graphiques lus à l'image, le bouton « Approfondir cette note » et le mode mentorat, un plan d'évolution écrit à partir de ce que vous avez documenté. Le carnet gratuit reste entier : tout ce que vous faisiez déjà continue pareil.",
      `Pour le vérifier, ouvrez l'extension depuis la barre de votre navigateur et connectez-vous avec ${v.email}. C'est cette adresse qui ouvre l'accès, donc avec une autre vous ne verriez rien changer. Dans Mon forfait, vous lisez « Carnet Premium est actif ». Ensuite, faites une capture sur une page de trading et regardez ce que le carnet en tire. Pas encore installé ? aoknowledge.com/library/extension`,
      `${echeance} ${gerer} Si vous arrêtez, Premium reste ouvert jusqu'à la fin de la période déjà payée. Votre reçu est aussi dans Mon espace, rubrique Achats : aoknowledge.com/mon-espace/parametres/achats`,
      QUESTION,
    ],
    bouton: { texte: 'Ouvrir le Carnet', url: URL_EXTENSION },
  }
}

// ---------------------------------------------------------------------------
// 4. Un module de l'academie, achete a l'unite
// ---------------------------------------------------------------------------

/** L'adresse d'un module (meme forme que lienModule, trouver-cours-pur.ts). */
export const lienDuModule = (slug: string) => `${URL_ACADEMIE_MAIL}/${encodeURIComponent(slug)}`

export function modeleModule(v: VariablesMail): ModeleMail {
  // Le webhook donne toujours un titre (la base, sinon le slug) : le repli ne sert qu'a ne jamais laisser de trou.
  const leModule = v.titreModule ? `le module « ${v.titreModule} »` : 'votre module'
  const lien = v.lienModule || URL_ACADEMIE_MAIL
  const paiement = v.montant
    ? `Merci, votre paiement est bien passé : ${v.montant} pour ${leModule}.`
    : `Merci, votre paiement est bien passé pour ${leModule}.`
  return {
    objet: objetDe(v, v.titreModule ? `Le module ${v.titreModule} est ouvert` : 'Votre module est ouvert'),
    preheader: 'Votre accès est actif, à vie. Reprenez là où vous voulez.',
    paragraphes: [
      bonjour(v),
      `${paiement} Il est ouvert sur votre compte AOKnowledge, à vie.`,
      `Pour y entrer : ${lien}\nConnectez-vous avec ${v.email}, l'adresse de votre achat, c'est elle qui ouvre l'accès. Pas encore de compte ? Il se crée à votre première connexion, avec cette adresse.`,
      'Pour commencer, lancez la première leçon. Votre progression se garde toute seule, et le module reste dans « Mes cours » sur aoknowledge.com/mon-espace, avec un bouton « Continuer » pour reprendre où vous vous êtes arrêté.',
      `${RETRACTATION} ${RECU_MON_ESPACE}`,
      QUESTION,
    ],
    bouton: { texte: 'Ouvrir le module', url: lien },
  }
}

// ---------------------------------------------------------------------------
// 5. La Formation complete (10% Club, PayPal)
// ---------------------------------------------------------------------------

/**
 * Le texte valide de la Formation complete. L'envoi reel reste celui du
 * 10% Club (club-paypal.ts, modeleEmailClub dans club-paypal-pur.ts, meme
 * texte, verifie par scripts/verifier-mails-achat.mjs).
 */
export function modeleFormation(v: VariablesMail): ModeleMail {
  const paiement = v.montant ? `votre paiement de ${v.montant} est bien reçu` : 'votre paiement est bien reçu'
  return {
    objet: objetDe(v, 'Votre accès au 10% Club est ouvert'),
    preheader: "Votre formation complète est ouverte, à vie. Entrez avec l'adresse de votre achat.",
    paragraphes: [
      bonjour(v),
      `Bienvenue dans le 10% Club. Merci, ${paiement}, et la formation complète est ouverte, à vie. Si vous payez en 4 fois, les échéances sont gérées par PayPal, pas par nous.`,
      "Tout est dans l'académie : le parcours de 0 à 5, Psychologie et émotions, les Chroniques de l'Accélérateur, Journaling, nos articles privés, les archives et les replays du Live Club. Le Carnet du Trader Premium et Pilotage Premium sont inclus aussi, avec la même adresse.",
      `Pour entrer : aoknowledge.com/connexion, avec ${v.email}, l'adresse de votre achat. C'est elle qui ouvre l'accès. Pas encore de compte ? Il se crée à votre première connexion. Une autre adresse vous convient mieux ? Une fois connecté, ajoutez-la dans Mon espace, Comptes liés : aoknowledge.com/mon-espace/parametres/comptes`,
      'Vous pouvez reprendre le parcours depuis le début ou au niveau qui est le vôtre : votre progression se garde toute seule.',
      `${RETRACTATION} Votre reçu, lui, vient de PayPal.`,
      QUESTION,
    ],
    bouton: { texte: "Ouvrir l'académie", url: URL_ACADEMIE_MAIL },
  }
}

export const MODELES: Record<ProduitMail, (v: VariablesMail) => ModeleMail> = {
  'pilotage-premium': modelePilotagePremium,
  'premium-duo': modelePremiumDuo,
  'carnet-premium': modeleCarnetPremium,
  module: modeleModule,
  formation: modeleFormation,
}

// ---------------------------------------------------------------------------
// Les regles de l'envoi
// ---------------------------------------------------------------------------

/** Le produit du mail d'une offre de Pilotage (slug academie_offres), ou null. */
export function produitDeOffrePilotage(slug: unknown): 'pilotage-premium' | 'premium-duo' | null {
  if (slug === 'pilotage-premium-mensuel' || slug === 'pilotage-premium-annuel') return 'pilotage-premium'
  if (slug === 'premium-duo-mensuel' || slug === 'premium-duo-annuel') return 'premium-duo'
  return null
}

/**
 * Le seul evenement qui envoie un mail d'achat : le paiement d'un achat
 * (checkout.session.completed, ou async_payment_succeeded pour un paiement
 * differe d'un module). invoice.paid (renouvellement),
 * customer.subscription.* (changement, arret) : jamais.
 */
export function evenementEnvoieMail(type: unknown): boolean {
  return type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded'
}

/**
 * La cle anti-doublon (mails_achat_envoyes.cle) : une par abonnement (sub_...)
 * ou par paiement (cs_... d'un module). Le meme evenement rejoue, ou la page
 * et le webhook ensemble, retombent sur la meme cle : un seul mail.
 */
export function cleMailAchat(produit: ProduitMail, reference: string): string {
  return `${produit}:${reference}`
}

/**
 * Le prenom tire du nom saisi chez Stripe (customer_details.name) : le premier
 * mot s'il ressemble a un prenom (lettres, tiret, apostrophe, 2 a 30
 * caracteres), avec sa capitale. Sinon null, et le mail dit « Bonjour, ».
 */
export function prenomDe(nom: unknown): string | null {
  if (typeof nom !== 'string') return null
  const premier = nom.trim().split(/\s+/)[0] ?? ''
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'-]{1,29}$/.test(premier)) return null
  const bas = premier.toLowerCase()
  return bas.replace(/(^|[-'])([a-zà-öø-ÿ])/g, (_t, sep: string, l: string) => sep + l.toUpperCase())
}

/** « 5,99 euros », « 57 euros », « 1 999 euros » (espaces simples), ou null. */
export function formaterEuros(centimes: unknown): string | null {
  if (typeof centimes !== 'number' || !Number.isFinite(centimes) || centimes <= 0) return null
  const c = Math.round(centimes)
  const entier = Math.floor(c / 100)
  const reste = c % 100
  const milliers = String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return reste ? `${milliers},${String(reste).padStart(2, '0')} euros` : `${milliers} euros`
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** « 1er décembre 2026 », « 30 novembre 2026 », a l'heure de Paris ; null si la date manque. */
export function formaterDateLongue(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p)
  if (!m) return null
  const jour = Number(m[3])
  return `${jour === 1 ? '1er' : jour} ${MOIS[Number(m[2]) - 1]} ${m[1]}`
}

/** Le lien du portail : seulement un lien de connexion du portail Stripe (billing.stripe.com). */
export function lienPortailPropre(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const l = v.trim()
  return /^https:\/\/billing\.stripe\.com\/[A-Za-z0-9/_-]+$/.test(l) ? l : null
}

const chaine = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export type AbonnementCarnet = { id: string; rythme: 'month' | 'year' | null; finPeriode: Date | null }

/**
 * Un abonnement Stripe relu (GET /v1/subscriptions/:id) : est-ce un Carnet
 * Premium (un item sur le produit du Carnet) ? Le rythme et la fin de la
 * periode payee (item clover, sinon l'ancien champ). Sinon null.
 */
export function lireAbonnementCarnet(s: Record<string, unknown>): AbonnementCarnet | null {
  const id = chaine(s.id)
  if (!id || !/^sub_[A-Za-z0-9]{6,250}$/.test(id)) return null
  const items = Array.isArray(objet(s.items).data) ? (objet(s.items).data as unknown[]).map(objet) : []
  const item = items.find(i => {
    const prix = objet(i.price)
    const produit = chaine(prix.product) ?? chaine(objet(prix.product).id)
    return produit === PRODUIT_STRIPE_CARNET_PREMIUM
  })
  if (!item) return null
  const intervalle = objet(objet(item.price).recurring).interval
  const finS = typeof item.current_period_end === 'number' ? item.current_period_end
    : typeof s.current_period_end === 'number' ? s.current_period_end : null
  return {
    id,
    rythme: intervalle === 'month' || intervalle === 'year' ? intervalle : null,
    finPeriode: finS === null ? null : new Date(finS * 1000),
  }
}

export const offreCarnet = (rythme: 'month' | 'year' | null) =>
  rythme === 'year' ? 'Carnet Premium (annuel)' : rythme === 'month' ? 'Carnet Premium (mensuel)' : 'Carnet Premium'

export type SessionPayee = {
  sessionId: string
  abonnementId: string | null
  email: string | null
  prenom: string | null
  centimes: number | null
  /** Une session de test Stripe (livemode false) : le mail part avec [Essai]. */
  test: boolean
}

/** Une session Checkout complete ET payee (abonnement ou paiement), ou null. */
export function lireSessionPayee(s: Record<string, unknown>): SessionPayee | null {
  const id = chaine(s.id)
  if (!id || !/^cs_[A-Za-z0-9_]{10,250}$/.test(id)) return null
  if (s.status !== 'complete') return null
  if (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') return null
  const details = objet(s.customer_details)
  const email = (chaine(details.email) ?? chaine(s.customer_email))?.toLowerCase() ?? null
  const sub = chaine(s.subscription) ?? chaine(objet(s.subscription).id)
  return {
    sessionId: id,
    abonnementId: sub && sub.startsWith('sub_') ? sub : null,
    email: email && email.indexOf('@') > 0 ? email : null,
    prenom: prenomDe(details.name),
    centimes: typeof s.amount_total === 'number' ? s.amount_total : null,
    test: s.livemode === false,
  }
}

// ---------------------------------------------------------------------------
// Le rendu (meme gabarit que les mails du Live Club, liveclub/emails.ts)
// ---------------------------------------------------------------------------

export function echapper(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Les adresses du texte deviennent des liens : https://..., support@, et nos
// domaines ecrits sans https (aoknowledge.com/..., pilotage.aoknowledge.com/...).
// Le domaine nu doit suivre un debut de ligne ou un blanc : pas la fin d'un email.
const ADRESSES = /(https:\/\/[^\s]+)|(support@aoknowledge\.com)|((?:^|[\s(])(?:pilotage\.)?aoknowledge\.com(?:\/[^\s]*)?)/g

function lienHtml(affiche: string, href: string): string {
  return `<a href="${echapper(href)}" style="color:#111827">${echapper(affiche)}</a>`
}

/** Un paragraphe echappe, ses adresses en liens (la ponctuation collee reste hors du lien), ses retours a la ligne en <br>. */
export function paragrapheHtml(p: string): string {
  let html = ''
  let dernier = 0
  for (const m of p.matchAll(ADRESSES)) {
    const debut = m.index ?? 0
    let brut = m[0]
    let avant = ''
    if (m[3]) {
      const blanc = /^[\s(]/.exec(brut)
      if (blanc) { avant = blanc[0]; brut = brut.slice(1) }
    }
    const adresse = brut.replace(/[.,;:!?)»]+$/, '')
    const apres = brut.slice(adresse.length)
    html += echapper(p.slice(dernier, debut)) + echapper(avant)
    if (m[2]) html += lienHtml(adresse, `mailto:${adresse}`)
    else html += lienHtml(adresse, adresse.startsWith('https://') ? adresse : `https://${adresse}`)
    html += echapper(apres)
    dernier = debut + m[0].length
  }
  return (html + echapper(p.slice(dernier))).replace(/\n/g, '<br>')
}

export function texteMail(m: ModeleMail): string {
  return [...m.paragraphes, `${m.bouton.texte} : ${m.bouton.url}`, SIGNATURE].join('\n\n')
}

export function htmlMail(m: ModeleMail): string {
  const corps = m.paragraphes.map(p => `<p style="margin:0 0 16px;line-height:1.5">${paragrapheHtml(p)}</p>`).join('\n')
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#ffffff;color:#111827;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${echapper(m.preheader)}</div>
<div style="max-width:560px;margin:0 auto">
${corps}
<p style="margin:24px 0"><a href="${echapper(m.bouton.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">${echapper(m.bouton.texte)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280">Si le bouton ne marche pas, copiez ce lien : ${echapper(m.bouton.url)}</p>
<p style="margin:32px 0 0;line-height:1.5">${paragrapheHtml(SIGNATURE)}</p>
</div></body></html>`
}

export function rendreMail(produit: ProduitMail, v: VariablesMail): MailRendu & { modele: ModeleMail } {
  const m = MODELES[produit](v)
  return { objet: m.objet, texte: texteMail(m), html: htmlMail(m), modele: m }
}

// ---------------------------------------------------------------------------
// L'anti-doublon (table mails_achat_envoyes, migration 20261031150000)
// ---------------------------------------------------------------------------

export type IssueMail = 'envoye' | 'deja_envoye' | 'sans_email' | 'sans_table' | 'echec' | 'pas_concerne'

/** Ce que l'envoi demande au monde (la base, Resend) : injecte, pour que la regle se teste sans eux. */
export type DepsEnvoi = {
  /** true = la cle est a nous (premiere fois), false = deja reservee, 'sans_table' = migration absente. Peut jeter. */
  reserver: () => Promise<boolean | 'sans_table'>
  envoyer: () => Promise<{ ok: true; id: string | null } | { ok: false; erreur: string }>
  /** L'envoi a echoue : la reservation saute. */
  liberer: () => Promise<void>
  /** L'envoi est parti. */
  noter: (id: string | null) => Promise<void>
}

/**
 * La regle « un seul mail par achat » : reserver la cle AVANT d'envoyer.
 * Deja reservee : rien. Table absente ou base injoignable : rien (mieux vaut
 * aucun mail que deux). Envoi rate : la reservation saute pour qu'un
 * evenement rejoue puisse reessayer. Ne jette jamais.
 */
export async function envoyerUneFois(d: DepsEnvoi): Promise<IssueMail> {
  let reserve: boolean | 'sans_table'
  try {
    reserve = await d.reserver()
  } catch {
    return 'echec'
  }
  if (reserve === 'sans_table') return 'sans_table'
  if (!reserve) return 'deja_envoye'
  let r: Awaited<ReturnType<DepsEnvoi['envoyer']>>
  try {
    r = await d.envoyer()
  } catch (err) {
    r = { ok: false, erreur: err instanceof Error ? err.name : 'erreur' }
  }
  try {
    if (r.ok) await d.noter(r.id)
    else await d.liberer()
  } catch { /* le suivi rate ne change pas l'issue de l'envoi */ }
  return r.ok ? 'envoye' : 'echec'
}

/** $1 = cle, $2 = produit. Reserve l'envoi : une ligne rendue = a nous d'envoyer, aucune = deja fait. */
export const SQL_RESERVER_MAIL = `
insert into public.mails_achat_envoyes (cle, produit)
values ($1::text, $2::text)
on conflict (cle) do nothing
returning cle
`

/** $1 = cle, $2 = id Resend ou null. L'envoi est parti. */
export const SQL_MAIL_PARTI = `
update public.mails_achat_envoyes set resend_id = $2::text where cle = $1::text
`

/** $1 = cle. L'envoi a echoue : la reservation saute, un prochain evenement pourra reessayer. */
export const SQL_LIBERER_MAIL = `
delete from public.mails_achat_envoyes where cle = $1::text and resend_id is null
`
