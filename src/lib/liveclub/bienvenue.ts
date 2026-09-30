// Le jeton d'entree et l'email de bienvenue d'un abonnement Live Club (sortis
// de la route /api/liveclub/bienvenue le 30/09) : la page apres paiement ET le
// rattrapage du passage quotidien (abonnements crees hors Payment Link, Brice
// 30/09) passent par la MEME fonction, donc par le meme verrou et la meme
// reservation de l'email. Une page chargee pendant le passage ne fait pas
// partir deux emails.

import { prisma } from '@/lib/db'
import { genererJeton } from './pur'

/** Duree d'un jeton d'entree, et age maximal d'une session Checkout pour en creer un. */
export const DUREE_JETON_JOURS = 30

export type PreparationBienvenue =
  /** jeton null = un jeton a deja servi et plus aucun n'est valable : rien de cree. */
  | { issue: 'lien'; jeton: string | null; nouveau: boolean; dejaUtilise: boolean; envoyerEmail: boolean }
  /** Session trop ancienne et aucun jeton valable : on ne cree rien. */
  | { issue: 'trop_ancienne' }

/**
 * Le jeton d'entree de cet abonnement et la reservation de l'email de
 * bienvenue, en UNE transaction verrouillee par abonnement : tant qu'un
 * appel tient le verrou, un second attend, puis voit le jeton et la
 * reservation du premier. Tout passe par `tx` (une seule connexion : pas
 * d'appel a la bibliotheque des jetons, qui prendrait une autre connexion).
 *
 * Jamais de nouveau jeton pour un abonnement dont un jeton a deja servi
 * (l'abonnement a son compte Telegram), ni, pour la page, apres une session
 * de plus de DUREE_JETON_JOURS jours (sessionTropAncienne). L'email part une
 * seule fois par abonnement, tous jetons confondus, et seulement avec un lien
 * qui n'a pas encore servi. Si l'envoi echoue ensuite, l'appelant rend la
 * reservation (annulerReservationEmail, jetons.ts).
 */
export async function preparerBienvenue(
  abonnementId: string,
  n: { clientStripe: string | null; email: string | null; sessionTropAncienne: boolean },
): Promise<PreparationBienvenue> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`
      select pg_advisory_xact_lock(hashtext('liveclub_bienvenue'), hashtext(${abonnementId}))`

    const jetons = await tx.$queryRaw<{ jeton: string; valable: boolean; utilise: boolean; email_envoye: boolean }[]>`
      select jeton, expire_le > now() as valable, utilise_le is not null as utilise,
             email_envoye_le is not null as email_envoye
      from public.cockpit_liveclub_jetons
      where abonnement_id = ${abonnementId} and usage = 'entree'
      order by cree_le desc`
    const dejaUtilise = jetons.some(j => j.utilise)
    const emailDeja = jetons.some(j => j.email_envoye)
    const valable = jetons.find(j => j.valable)

    let jeton: string | null = valable?.jeton ?? null
    let nouveau = false
    if (!jeton) {
      // Un jeton a deja servi : l'abonnement a son compte Telegram, on n'en
      // ouvre pas un second avec une vieille URL de retour.
      if (dejaUtilise) return { issue: 'lien', jeton: null, nouveau: false, dejaUtilise: true, envoyerEmail: false }
      if (n.sessionTropAncienne) return { issue: 'trop_ancienne' }
      jeton = genererJeton()
      await tx.$executeRaw`
        insert into public.cockpit_liveclub_jetons
          (jeton, usage, client_stripe, abonnement_id, email, expire_le)
        values (${jeton}, 'entree', ${n.clientStripe}, ${abonnementId}, ${n.email},
                now() + make_interval(days => ${DUREE_JETON_JOURS}::int))`
      nouveau = true
    }

    // L'email, une seule fois par abonnement (tous jetons confondus), et
    // seulement avec un lien qui n'a pas encore servi.
    let envoyerEmail = false
    if (n.email && !emailDeja && !(valable?.utilise)) {
      const reserve = await tx.$queryRaw<{ jeton: string }[]>`
        update public.cockpit_liveclub_jetons set email_envoye_le = now()
        where jeton = ${jeton} and email_envoye_le is null
        returning jeton`
      envoyerEmail = reserve.length === 1
    }
    return { issue: 'lien', jeton, nouveau, dejaUtilise: Boolean(valable?.utilise), envoyerEmail }
  })
}
