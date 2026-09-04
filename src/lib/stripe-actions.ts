// Les actions Stripe de l'agent cockpit (demande Brice 03/09) : generer un
// code promo, rembourser un paiement, creer un produit.
//
// PROTOCOLE : l'agent PROPOSE (tool call intercepte, jamais execute), l'ecran
// affiche une carte de confirmation, et c'est le clic de Brice/Melanie qui
// appelle /api/cockpit/agent/action — l'execution ne passe donc JAMAIS par le
// modele. La validation des parametres vit ici, cote serveur, pas dans le
// prompt.
//
// CLES : une par compte, EN ECRITURE, distinctes des cles de collecte (qui
// restent lecture seule — c'est une qualite). Posees dans Vercel (journal) :
//   STRIPE_AGENT_KEY_AOKNOWLEDGE  (comptant)
//   STRIPE_AGENT_KEY_MELANIE      (recurrent Live Club)
// Permissions minimales de la cle restreinte : Charges = ecriture (couvre les
// remboursements), Coupons = ecriture (couvre les codes promotionnels),
// Produits = ecriture (couvre les tarifs). Tant que la cle manque, la carte
// de confirmation le dit au lieu d'un bouton Confirmer.

const API = 'https://api.stripe.com'

// Version d'API EPINGLEE : les deux comptes n'ont pas le meme defaut (celui de
// Melanie est sur « clover », l'autre non), et clover a change la creation des
// codes promo (promotion[type]+promotion[coupon] au lieu de coupon) — le
// premier essai reel du 04/09 est tombe sur « Received unknown parameter:
// coupon ». Epingler rend le comportement identique partout, pour toujours.
const STRIPE_VERSION = '2025-09-30.clover'

export type CompteStripe = 'aoknowledge' | 'melanie'

const ENV_PAR_COMPTE: Record<CompteStripe, string> = {
  aoknowledge: 'STRIPE_AGENT_KEY_AOKNOWLEDGE',
  melanie: 'STRIPE_AGENT_KEY_MELANIE',
}

export function cleAgent(compte: CompteStripe): string | null {
  return process.env[ENV_PAR_COMPTE[compte]]?.trim() || null
}

export function nomVariableCle(compte: CompteStripe): string {
  return ENV_PAR_COMPTE[compte]
}

function estCompte(v: unknown): v is CompteStripe {
  return v === 'aoknowledge' || v === 'melanie'
}

async function stripePost(
  cle: string,
  chemin: string,
  corps: Record<string, string>,
): Promise<Record<string, unknown>> {
  const reponse = await fetch(`${API}${chemin}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cle}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_VERSION,
    },
    body: new URLSearchParams(corps).toString(),
  })
  const json = (await reponse.json()) as Record<string, unknown>
  if (!reponse.ok) {
    const err = json?.error as { message?: string } | undefined
    throw new Error(err?.message?.slice(0, 300) || `Stripe a répondu ${reponse.status}`)
  }
  return json
}

// ---------------------------------------------------------------------------
// Les trois actions. Chacune valide STRICTEMENT ses parametres : un parametre
// inattendu ou mal forme est un refus, pas une tolerance — c'est du texte qui
// vient d'un modele.
// ---------------------------------------------------------------------------

export type ActionAgent = {
  type: 'code_promo' | 'remboursement' | 'produit' | 'revoquer_code'
  compte: CompteStripe
  params: Record<string, unknown>
}

export function validerAction(brut: unknown): ActionAgent | string {
  const a = brut as ActionAgent
  if (!a || typeof a !== 'object') return 'Action illisible.'
  if (!estCompte(a.compte)) return 'Compte inconnu : aoknowledge ou melanie.'
  if (!a.params || typeof a.params !== 'object') return 'Paramètres manquants.'
  const p = a.params

  if (a.type === 'code_promo') {
    const code = String(p.code ?? '').toUpperCase()
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return 'Code invalide (3 à 30 caractères, A-Z 0-9 - _).'
    const pourcentage = p.pourcentage == null ? null : Number(p.pourcentage)
    const montant = p.montant == null ? null : Number(p.montant)
    if ((pourcentage == null) === (montant == null)) {
      return 'Il faut soit un pourcentage, soit un montant fixe — exactement un des deux.'
    }
    if (pourcentage != null && !(pourcentage >= 1 && pourcentage <= 100)) {
      return 'Pourcentage entre 1 et 100.'
    }
    if (montant != null && !(montant > 0 && montant <= 5000)) {
      return 'Montant entre 0 et 5 000.'
    }
    const duree = String(p.duree ?? 'once')
    if (!['once', 'forever', 'repeating'].includes(duree)) {
      return 'Durée : once, forever ou repeating.'
    }
    const mois = p.duree_mois == null ? null : Number(p.duree_mois)
    if (duree === 'repeating' && !(mois && mois >= 1 && mois <= 24)) {
      return 'repeating demande duree_mois (1 à 24).'
    }
    const max = p.max_utilisations == null ? null : Number(p.max_utilisations)
    if (max != null && !(Number.isInteger(max) && max >= 1 && max <= 10000)) {
      return 'max_utilisations : entier entre 1 et 10 000.'
    }
    const expire = p.expire_le == null ? null : String(p.expire_le)
    if (expire && !/^\d{4}-\d{2}-\d{2}$/.test(expire)) return 'expire_le au format YYYY-MM-DD.'
    const devise = String(p.devise ?? 'eur').toLowerCase()
    if (!['eur', 'usd'].includes(devise)) return 'Devise : EUR ou USD.'
    return {
      type: 'code_promo', compte: a.compte,
      params: { code, pourcentage, montant, devise, duree, duree_mois: mois, max_utilisations: max, expire_le: expire },
    }
  }

  if (a.type === 'remboursement') {
    // Nos paiement_id sont "stripe:ch_..." : on tolere le prefixe.
    const charge = String(p.charge_id ?? '').replace(/^stripe:/, '')
    if (!/^ch_[A-Za-z0-9]{8,}$/.test(charge)) {
      return 'charge_id invalide (attendu ch_..., depuis cockpit_paiements).'
    }
    const montant = p.montant == null ? null : Number(p.montant)
    if (montant != null && !(montant > 0 && montant <= 10000)) {
      return 'Montant du remboursement entre 0 et 10 000 (vide = remboursement total).'
    }
    return { type: 'remboursement', compte: a.compte, params: { charge_id: charge, montant } }
  }

  if (a.type === 'revoquer_code') {
    const code = String(p.code ?? '').trim()
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(code)) return 'Code à révoquer invalide.'
    return { type: 'revoquer_code', compte: a.compte, params: { code } }
  }

  if (a.type === 'produit') {
    const nom = String(p.nom ?? '').trim()
    if (nom.length < 3 || nom.length > 80) return 'Nom du produit : 3 à 80 caractères.'
    const montant = Number(p.montant)
    if (!(montant > 0 && montant <= 20000)) return 'Prix entre 0 et 20 000.'
    const devise = String(p.devise ?? 'eur').toLowerCase()
    if (!['eur', 'usd'].includes(devise)) return 'Devise : EUR ou USD.'
    const recurrence = p.recurrence == null ? null : String(p.recurrence)
    if (recurrence && !['month', 'year'].includes(recurrence)) {
      return 'Récurrence : month, year, ou rien (comptant).'
    }
    return { type: 'produit', compte: a.compte, params: { nom, montant, devise, recurrence } }
  }

  return 'Type d’action inconnu.'
}

/** Une phrase qui dit ce que l'action va faire, pour la carte de confirmation. */
export function resumeAction(a: ActionAgent): string {
  const p = a.params
  if (a.type === 'code_promo') {
    const reduc = p.pourcentage != null
      ? `${p.pourcentage} %`
      : `${p.montant} ${String(p.devise).toUpperCase()}`
    const duree = p.duree === 'forever' ? 'à vie'
      : p.duree === 'repeating' ? `pendant ${p.duree_mois} mois` : 'une fois'
    const limites = [
      p.max_utilisations != null ? `${p.max_utilisations} utilisations max` : null,
      p.expire_le ? `expire le ${p.expire_le}` : null,
    ].filter(Boolean).join(', ')
    return `Créer le code ${p.code} : ${reduc} ${duree}${limites ? ` (${limites})` : ''} sur le compte ${a.compte}.`
  }
  if (a.type === 'remboursement') {
    return `Rembourser ${p.montant != null ? `${p.montant} ` : 'INTÉGRALEMENT '}le paiement ${p.charge_id} sur le compte ${a.compte}.`
  }
  if (a.type === 'revoquer_code') {
    return `Désactiver le code ${p.code} sur le compte ${a.compte} : plus personne ne pourra le taper. `
      + `Les réductions déjà appliquées aux abonnés continuent, elles.`
  }
  return `Créer le produit « ${p.nom} » à ${p.montant} ${String(p.devise).toUpperCase()}${p.recurrence ? `/${p.recurrence === 'month' ? 'mois' : 'an'}` : ' (comptant)'} sur le compte ${a.compte}.`
}

/** Execute une action DEJA validee. Renvoie une phrase de resultat. */
export async function executerAction(a: ActionAgent): Promise<string> {
  const cle = cleAgent(a.compte)
  if (!cle) {
    throw new Error(
      `La clé d'écriture du compte ${a.compte} n'existe pas encore `
      + `(variable ${nomVariableCle(a.compte)} sur le projet journal).`,
    )
  }
  const p = a.params

  if (a.type === 'code_promo') {
    // `name` = le code : sans lui, la liste « Bons de reduction » de Stripe
    // affiche l'identifiant aleatoire du coupon (retour Brice 04/09).
    const coupon: Record<string, string> = {
      duration: String(p.duree), name: String(p.code),
    }
    if (p.pourcentage != null) coupon.percent_off = String(p.pourcentage)
    else {
      coupon.amount_off = String(Math.round(Number(p.montant) * 100))
      coupon.currency = String(p.devise)
    }
    if (p.duree === 'repeating') coupon.duration_in_months = String(p.duree_mois)
    const cree = await stripePost(cle, '/v1/coupons', coupon)

    // Forme « clover » : le coupon se reference dans un hash promotion.
    const promo: Record<string, string> = {
      'promotion[type]': 'coupon',
      'promotion[coupon]': String(cree.id),
      code: String(p.code),
    }
    if (p.max_utilisations != null) promo.max_redemptions = String(p.max_utilisations)
    if (p.expire_le) {
      promo.expires_at = String(Math.floor(new Date(`${p.expire_le}T23:59:59Z`).getTime() / 1000))
    }
    const codePromo = await stripePost(cle, '/v1/promotion_codes', promo)
    return `Code ${(codePromo as { code?: string }).code} créé sur ${a.compte}. `
      + `Visible dans le cockpit après la prochaine collecte (demain matin).`
  }

  if (a.type === 'remboursement') {
    const corps: Record<string, string> = { charge: String(p.charge_id) }
    if (p.montant != null) corps.amount = String(Math.round(Number(p.montant) * 100))
    const remb = await stripePost(cle, '/v1/refunds', corps)
    const centimes = Number((remb as { amount?: number }).amount ?? 0)
    return `Remboursement de ${(centimes / 100).toFixed(2)} ${String((remb as { currency?: string }).currency ?? '').toUpperCase()} créé `
      + `(${(remb as { id?: string }).id}). Le paiement passera en remboursé à la prochaine collecte.`
  }

  if (a.type === 'revoquer_code') {
    // On retrouve le code vivant par son texte, puis on le desactive. Le
    // coupon sous-jacent n'est PAS supprime : les reductions deja appliquees
    // aux abonnes continuent — couper un avantage accorde est un autre geste,
    // qui ne passe pas par l'agent.
    const reponse = await fetch(
      `${API}/v1/promotion_codes?${new URLSearchParams({
        code: String(p.code), active: 'true', limit: '1',
      })}`,
      { headers: { Authorization: `Bearer ${cle}`, 'Stripe-Version': STRIPE_VERSION } },
    )
    const liste = (await reponse.json()) as { data?: { id: string }[] }
    const vivant = liste.data?.[0]
    if (!vivant) {
      throw new Error(`Aucun code actif « ${p.code} » sur le compte ${a.compte}.`)
    }
    await stripePost(cle, `/v1/promotion_codes/${vivant.id}`, { active: 'false' })
    return `Code ${p.code} désactivé sur ${a.compte}. Les réductions déjà en cours `
      + `chez les abonnés continuent. Visible dans le cockpit après la prochaine collecte.`
  }

  // produit
  const produit = await stripePost(cle, '/v1/products', { name: String(p.nom) })
  const prix: Record<string, string> = {
    product: String(produit.id),
    unit_amount: String(Math.round(Number(p.montant) * 100)),
    currency: String(p.devise),
  }
  if (p.recurrence) prix['recurring[interval]'] = String(p.recurrence)
  await stripePost(cle, '/v1/prices', prix)
  return `Produit « ${p.nom} » créé sur ${a.compte} avec son tarif. `
    + `⚠️ Pense à l'ajouter à PRODUITS_STRIPE (push_membres_supabase.py) pour que ses paiements soient classés.`
}
