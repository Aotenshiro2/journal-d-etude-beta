// « Gérer mon abonnement » depuis Mon espace (12/11/2026, correctif) : les
// abonnements du compte AOKnowledge d'un membre, relus chez Stripe, et la session
// du portail client Stripe. Regles pures : portail-abonnements-pur.ts.
//
// Aucune source neuve : les memes lectures que le badge « Soutien » de /moi
// (soutien.ts) et que l'offre de Pilotage (pilotage-niveau.ts).
//   Pilotage et Duo : les acces de academie_acces (reference sub_...), relus
//     avec la cle de Pilotage ;
//   Carnet Premium (et son soutien) : abonnementCarnetDe, cle du Carnet ;
//   Soutien AOKnowledge (/soutenir) : abonnementAokDe.
// Le portail : portailDuClient avec la cle de Pilotage (Customer portal en
// ecriture), retour sur Mon espace > Achats. Meme compte Stripe (Ao Knowledge)
// pour tout ; le Live Club (compte de Melanie) n'y est jamais.
// Une source illisible ou trop lente (6 s) ne fait pas tomber les autres :
// `incomplet` le dit. Logs : jamais un email, un client ni une URL.

import { prisma } from '@/lib/db'
import { SQL_IDENTITE } from '@/lib/academie/requetes'
import { appeler, emailConfirme, ErreurStripe } from '@/lib/academie/achat'
import { abonnementCarnetDe } from '@/lib/entitlements'
import { messageErreur } from '@/lib/liveclub/pur'
import { abonnementsDuMembre, clePilotage, portailDuClient } from '@/lib/pilotage-abonnement'
import { RETOUR_PORTAIL, grouperParClient, lireAbonnementPilotage, type AbonnementVu, type GroupePortail } from '@/lib/portail-abonnements-pur'
import { abonnementAokDe } from '@/lib/soutien-aok'

const DELAI_MS = 6000
/** Au plus trois adresses confirmees du compte, trois abonnements Pilotage. */
const MAX_ADRESSES = 3
const MAX_PILOTAGE = 3

/** Une lecture bornee : au-dela du delai ou en erreur, `undefined` (illisible). */
function borne<T>(p: Promise<T>): Promise<T | undefined> {
  return Promise.race([
    p.catch(() => undefined),
    new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), DELAI_MS)),
  ])
}

async function abonnementPilotage(cle: string, reference: string, app: 'duo' | 'pilotage'): Promise<AbonnementVu | null> {
  try {
    return lireAbonnementPilotage(await appeler(cle, `/v1/subscriptions/${encodeURIComponent(reference)}`), app)
  } catch (err) {
    console.warn(`[compte/portail] abonnement Pilotage illisible : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    throw err
  }
}

export type AbonnementsDuCompte = { groupes: GroupePortail[]; incomplet: boolean }

export async function abonnementsDuCompte(userId: string): Promise<AbonnementsDuCompte> {
  const [email, emails] = await Promise.all([
    emailConfirme(userId).catch(() => null),
    prisma.$queryRawUnsafe<{ emails: string[] | null }[]>(SQL_IDENTITE, userId).then(l => l[0]?.emails ?? []).catch(() => [] as string[]),
  ])
  const adresses = [...new Set([email, ...emails].filter((e): e is string => Boolean(e)))].slice(0, MAX_ADRESSES)

  const lectures: Promise<AbonnementVu | null | undefined>[] = []

  // Pilotage et Duo : les acces en base, puis l'abonnement chez Stripe.
  const cle = clePilotage()
  const acces = await borne(abonnementsDuMembre(userId, adresses))
  let incomplet = acces === undefined
  for (const a of (acces ?? []).filter(x => x.reference?.startsWith('sub_')).slice(0, MAX_PILOTAGE)) {
    if (!cle) { incomplet = true; break }
    lectures.push(borne(abonnementPilotage(cle, a.reference as string, a.produit === 'premium-duo' ? 'duo' : 'pilotage')))
  }

  // Carnet Premium et soutien AOKnowledge : les clients de chaque adresse.
  for (const adresse of adresses) {
    lectures.push(borne(abonnementCarnetDe(adresse).then(v =>
      v === null ? undefined : v.actif && v.client ? { app: 'carnet' as const, soutien: v.soutien, client: v.client } : null)))
    lectures.push(borne(abonnementAokDe(adresse).then(v =>
      v === null ? undefined : v.actif && v.client ? { app: 'aok' as const, soutien: true, client: v.client } : null)))
  }

  const vus = await Promise.all(lectures)
  if (vus.some(v => v === undefined)) incomplet = true
  return { groupes: grouperParClient(vus), incomplet }
}

/** La session du portail pour ce client (URL de courte duree), sinon le lien de secours, sinon null. */
export async function sessionPortail(client: string): Promise<string | null> {
  return portailDuClient(clePilotage(), client, RETOUR_PORTAIL)
}
