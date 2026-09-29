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
import { abonnementsLiveClubDuClient, abonnementsLiveClubParEmail } from './stripe'
import { dateIso, finDuDroit, meilleurAbonnement, messageErreur, relationAbsente } from './pur'

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
  if (rattachement && (rattachement.client_stripe || rattachement.email)) {
    try {
      const clientMelanie = rattachement.client_stripe
        && (rattachement.compte == null || rattachement.compte === 'melanie')
        ? rattachement.client_stripe
        : null
      let abo = clientMelanie ? meilleurAbonnement(await abonnementsLiveClubDuClient(clientMelanie)) : null
      if (!abo && rattachement.email) {
        abo = meilleurAbonnement(await abonnementsLiveClubParEmail(rattachement.email))
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
  return { statut: 'non', raison: null, ...base }
}
