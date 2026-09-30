// Le droit d'un compte Telegram a etre dans le groupe Live Club (29/09).
//
// Ordre de lecture : exemption active, abonnement Stripe EN DIRECT du payeur
// rattache, acces broker, acces manuel du cockpit. Le premier 'oui' tranche.
// Un 'non' demande que TOUTES les sources aient ete lues sans erreur : une
// seule source illisible (Stripe en panne, table pas encore migree) et
// aucun 'oui' ailleurs = 'inconnu', et 'inconnu' ne fait jamais sortir ni
// refuser personne. droitLiveClub ne jette jamais.

import { prisma } from '@/lib/db'
import { exemptionActive } from '@/lib/stripe-actions'
import { rattachementActif, membreParEmail } from './rattacher'
import { abonnementsLiveClubDuClient, abonnementsLiveClubParEmail, type AbonnementResume } from './stripe'
import { dateIso, detteOuverte, finDuDroit, meilleurAbonnement, messageErreur, relationAbsente, type Dette } from './pur'

export { meilleurAbonnement }

export type Droit = {
  statut: 'oui' | 'non' | 'inconnu'
  raison: 'exemption' | 'abonnement' | 'acces_broker' | 'acces_manuel' | null
  /** Fin du droit ('YYYY-MM-DD' ou ISO) quand elle est connue. */
  fin?: string
  abonnementId?: string
  clientStripe?: string
  membreId?: string
  accesId?: string
  /**
   * 'non' seulement (Brice, 30/09, « la dette d'abord ») : le droit tombe a
   * cause d'un impaye de plus de 5 jours encore dans la fenetre de 30 jours.
   * Le bot donne alors le montant et le lien de la facture au lieu des liens
   * d'abonnement (detteOuverte, pur.ts).
   */
  dette?: Dette
  /** Sources illisibles (codes courts, sans donnee personnelle), pour les logs. */
  erreurs?: string[]
}

type LigneAcces = { acces_id: string; jusquau: Date }
type LigneManuel = { acces_jusquau: Date }

export async function droitLiveClub(telegramId: number): Promise<Droit> {
  const erreurs: string[] = []
  const base: Omit<Droit, 'statut' | 'raison'> = {}

  // 1. Exemption active (fondateur, admin, equipe, favorise).
  try {
    const ex = await exemptionActive(telegramId)
    if (ex) return { statut: 'oui', raison: 'exemption', ...(ex.jusquau ? { fin: dateIso(ex.jusquau) } : {}) }
  } catch (err) {
    erreurs.push(`exemptions: ${messageErreur(err)}`)
  }

  // 2. Le payeur rattache, et ses abonnements Stripe en direct.
  let rattachement: Awaited<ReturnType<typeof rattachementActif>> = null
  try {
    rattachement = await rattachementActif(telegramId)
  } catch (err) {
    erreurs.push(`rattachements: ${messageErreur(err)}`)
  }
  if (rattachement?.client_stripe) base.clientStripe = rattachement.client_stripe
  if (rattachement?.membre_id) base.membreId = rattachement.membre_id

  // Le client rattache n'est lu sur le compte melanie que s'il en vient :
  // importer_metricgram.py garde aussi des clients du compte aoknowledge, et
  // un client melanie sans abonnement Live Club (achat ponctuel) quand
  // l'abonnement vit sur un autre cus_ du meme email. Dans ces deux cas on
  // relit par l'email avant de conclure.
  // Les abonnements lus (pour la dette d'un 'non', Brice 30/09).
  const lus: AbonnementResume[] = []
  if (rattachement && (rattachement.client_stripe || rattachement.email)) {
    try {
      const clientMelanie = rattachement.client_stripe
        && (rattachement.compte == null || rattachement.compte === 'melanie')
        ? rattachement.client_stripe
        : null
      // Un abonnement en retard de paiement vient avec ses factures ouvertes
      // (stripe.ts) : passe 5 jours apres le premier echec, il n'ouvre plus
      // le groupe (abonnementOuvreLeGroupeLe, pur.ts).
      let abo: AbonnementResume | null = null
      if (clientMelanie) {
        const duClient = await abonnementsLiveClubDuClient(clientMelanie)
        lus.push(...duClient)
        abo = meilleurAbonnement(duClient)
      }
      if (!abo && rattachement.email) {
        const parEmail = await abonnementsLiveClubParEmail(rattachement.email)
        lus.push(...parEmail)
        abo = meilleurAbonnement(parEmail)
      } else if (!abo && !clientMelanie) {
        // Client d'un autre compte Stripe, sans email pour le retrouver : on
        // ne sait pas, et un 'non' ferait refuser ou sortir un payeur.
        erreurs.push('stripe: client rattache hors du compte melanie, sans email')
      }
      // Un abonnement termine dont la derniere facture payee couvre encore
      // aujourd'hui compte aussi (meilleurAbonnement) : fin = fin payee.
      if (abo) {
        const fin = finDuDroit(abo)
        return {
          statut: 'oui', raison: 'abonnement', ...base,
          abonnementId: abo.id,
          ...(abo.clientStripe ? { clientStripe: abo.clientStripe } : {}),
          ...(fin ? { fin } : {}),
        }
      }
    } catch (err) {
      erreurs.push(`stripe: ${messageErreur(err)}`)
    }
  }

  // 3. Acces broker actif : lie a ce compte Telegram, ou a l'email rattache.
  try {
    const email = rattachement?.email ?? null
    const lignes = await prisma.$queryRaw<LigneAcces[]>`
      select acces_id, jusquau from public.cockpit_liveclub_acces
      where retire_le is null and sorti_le is null and jusquau >= current_date
        and (telegram_id = ${telegramId}
          or (${email}::text is not null and lower(email) = lower(${email})))
      order by jusquau desc
      limit 1`
    if (lignes[0]) {
      return { statut: 'oui', raison: 'acces_broker', ...base, accesId: lignes[0].acces_id, fin: dateIso(lignes[0].jusquau) }
    }
  } catch (err) {
    erreurs.push(relationAbsente(err)
      ? 'acces: table cockpit_liveclub_acces absente (migration 20260929200100 pas appliquee)'
      : `acces: ${messageErreur(err)}`)
  }

  // 4. Acces manuel du cockpit sur le membre rattache.
  let membreId = rattachement?.membre_id ?? null
  if (!membreId && rattachement?.email) {
    try {
      membreId = await membreParEmail(rattachement.email)
      if (membreId) base.membreId = membreId
    } catch (err) {
      erreurs.push(`membre: ${messageErreur(err)}`)
    }
  }
  if (membreId) {
    try {
      const lignes = await prisma.$queryRaw<LigneManuel[]>`
        select acces_jusquau from public.cockpit_acces_manuel
        where membre_id = ${membreId}::uuid and acces_jusquau >= current_date
        limit 1`
      if (lignes[0]) {
        return { statut: 'oui', raison: 'acces_manuel', ...base, fin: dateIso(lignes[0].acces_jusquau) }
      }
    } catch (err) {
      erreurs.push(`acces_manuel: ${messageErreur(err)}`)
    }
  }

  if (erreurs.length) {
    console.warn(`[liveclub/droits] u${telegramId} : droit inconnu (${erreurs.length} source(s) illisible(s))`)
    return { statut: 'inconnu', raison: null, ...base, erreurs }
  }
  const dette = detteOuverte(lus)
  return { statut: 'non', raison: null, ...base, ...(dette ? { dette } : {}) }
}
