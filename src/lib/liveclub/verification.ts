// Verification par code email pour un compte Telegram NON rattache (Brice,
// 29/09, decision 4). Table cockpit_liveclub_codes (migration 20260930090000,
// serveur seulement).
//
// Le parcours, conduit par bot-membre.ts :
// 1. le membre ecrit l'email de son paiement ;
// 2. reserverCode : un envoi reserve atomiquement (3 par heure et par compte),
//    code neuf hache en base ; le bot repond TOUT DE SUITE, la meme phrase que
//    l'adresse soit connue ou non ;
// 3. envoyerCodeSiConnu, APRES la reponse : l'email ne part que si l'adresse
//    est connue (client Stripe du compte melanie, acces broker, membre) et pas
//    trop sollicitee ; le code n'est marque « envoye » (envoye_le) qu'a ce
//    moment. Une adresse inconnue garde sa ligne, avec un code que personne
//    n'a recu et qui ne sera JAMAIS accepte : les essais s'y comportent
//    exactement pareil, reponse comprise ;
// 4. le membre tape le code : verifierCode compte l'essai (5 par code, 10 codes
//    faux par adresse et par heure tous comptes confondus) et le consomme ;
// 5. rattacherParEmail relie le compte aux clients Stripe de l'adresse.
//
// Jamais de code, d'adresse ni de texte de message dans un log. Avant la
// migration, chaque fonction de base jette une ErreurTableLiveClub.

import { prisma } from '@/lib/db'
import { ErreurTableLiveClub } from './jetons'
import { membreParEmail, rattacherTelegram } from './rattacher'
import { abonnementsLiveClubParEmail, clientsStripeParEmail } from './stripe'
import { meilleurAbonnement, messageErreur, normaliserEmail, relationAbsente } from './pur'
import { emailCodeVerification } from './emails-verification'
import {
  CODE_COMPTES_PAR_EMAIL_HEURE, CODE_ENVOIS_HEURE, CODE_ESSAIS_MAX, CODE_RATES_PAR_EMAIL_HEURE,
  CODE_VALIDITE_MINUTES, codeCorrespond, genererCode, genererSel, hacherCode,
} from './verification-pur'

function tableCodes(err: unknown): never {
  if (relationAbsente(err)) throw new ErreurTableLiveClub('cockpit_liveclub_codes', '20260930090000')
  throw err
}

/** Un code reserve : le code en clair (a envoyer, jamais a logguer) et son hache (pour le marquer envoye). */
export type CodeReserve = { code: string; hache: string }

// ---------------------------------------------------------------------------
// 2. Reserver un envoi
// ---------------------------------------------------------------------------

/**
 * Pose un code neuf pour ce compte, si la limite de 3 demandes par heure le
 * permet, en UN upsert conditionnel : le code precedent ne marche plus, les
 * essais repartent a zero, et le code n'est pas encore « envoye » (il ne
 * sera accepte que si envoyerCodeSiConnu le fait partir). Renvoie le code et
 * son hache, ou null si la limite est atteinte. `email` doit etre normalise.
 */
export async function reserverCode(telegramId: number, email: string): Promise<CodeReserve | null> {
  const code = genererCode()
  const sel = genererSel()
  const hache = hacherCode(code, sel)
  try {
    const lignes = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      insert into public.cockpit_liveclub_codes
        (telegram_id, email, code_hache, sel, expire_le, essais, envoyes, fenetre_le, envoye_le, valide_le, cree_le, maj_le)
      values (${telegramId}, ${email}, ${hache}, ${sel},
              now() + make_interval(mins => ${CODE_VALIDITE_MINUTES}::int), 0, 1, now(), null, null, now(), now())
      on conflict (telegram_id) do update set
        email = excluded.email,
        code_hache = excluded.code_hache,
        sel = excluded.sel,
        expire_le = excluded.expire_le,
        essais = 0,
        envoye_le = null,
        valide_le = null,
        envoyes = case when cockpit_liveclub_codes.fenetre_le <= now() - interval '1 hour'
                       then 1 else cockpit_liveclub_codes.envoyes + 1 end,
        fenetre_le = case when cockpit_liveclub_codes.fenetre_le <= now() - interval '1 hour'
                          then now() else cockpit_liveclub_codes.fenetre_le end,
        maj_le = now()
        where cockpit_liveclub_codes.fenetre_le <= now() - interval '1 hour'
           or cockpit_liveclub_codes.envoyes < ${CODE_ENVOIS_HEURE}
      returning telegram_id`
    return lignes.length === 1 ? { code, hache } : null
  } catch (err) {
    return tableCodes(err)
  }
}

// ---------------------------------------------------------------------------
// 3. Envoyer, seulement si l'adresse est connue
// ---------------------------------------------------------------------------

/**
 * L'adresse est-elle celle d'un payeur ou d'un ayant droit ? Client Stripe du
 * compte melanie, acces broker en cours, ou membre du cockpit. Un oui d'une
 * source suffit. Sans oui, une seule source illisible = null (on ne sait
 * pas) : Stripe en panne ne doit pas faire passer un vrai payeur pour une
 * adresse inconnue, en silence.
 */
async function adresseConnue(email: string): Promise<boolean | null> {
  let illisibles = 0
  try {
    if ((await clientsStripeParEmail(email)).length > 0) return true
  } catch {
    illisibles++
  }
  try {
    const lignes = await prisma.$queryRaw<{ n: number }[]>`
      select 1 as n from public.cockpit_liveclub_acces
      where retire_le is null and sorti_le is null and jusquau >= current_date
        and lower(email) = ${email}
      limit 1`
    if (lignes.length > 0) return true
  } catch {
    illisibles++
  }
  try {
    if (await membreParEmail(email)) return true
  } catch {
    illisibles++
  }
  return illisibles > 0 ? null : false
}

/** Trop de comptes Telegram differents ont demande un code pour cette adresse dans l'heure ? */
async function adresseSollicitee(email: string): Promise<boolean> {
  try {
    const lignes = await prisma.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from public.cockpit_liveclub_codes
      where email = ${email} and maj_le > now() - interval '1 hour'`
    return (lignes[0]?.n ?? 0) > CODE_COMPTES_PAR_EMAIL_HEURE
  } catch (err) {
    return tableCodes(err)
  }
}

export type IssueEnvoiCode = 'envoye' | 'inconnue' | 'sollicitee' | 'remplace' | 'panne'

/**
 * Envoie le code par email si l'adresse est connue, et le marque « envoye »
 * (seul un code marque peut etre accepte). A appeler APRES la reponse au
 * membre : ce qui se passe ici ne change rien a ce qu'il lit. L'issue sert au
 * log de l'appelant (sans adresse). Ne jette pas.
 */
export async function envoyerCodeSiConnu(telegramId: number, email: string, reserve: CodeReserve): Promise<IssueEnvoiCode> {
  try {
    if (await adresseSollicitee(email)) return 'sollicitee'
    const connue = await adresseConnue(email)
    if (connue === null) return 'panne'
    if (!connue) return 'inconnue'
    // Marquer AVANT l'envoi : un code recu doit pouvoir servir. Si un code plus
    // recent l'a remplace entre-temps, on n'envoie rien (il serait inutile).
    let marque: { n: number }[]
    try {
      marque = await prisma.$queryRaw<{ n: number }[]>`
        update public.cockpit_liveclub_codes set envoye_le = now()
        where telegram_id = ${telegramId} and code_hache = ${reserve.hache}
          and email = ${email} and valide_le is null
        returning 1 as n`
    } catch (err) {
      return tableCodes(err)
    }
    if (marque.length === 0) return 'remplace'
    const r = await emailCodeVerification(email, reserve.code)
    if (!r.ok) {
      console.warn(`[liveclub/verification] email du code non parti : ${r.erreur}`)
      // Personne ne l'a recu : il redevient inacceptable (au mieux).
      await prisma.$executeRaw`
        update public.cockpit_liveclub_codes set envoye_le = null
        where telegram_id = ${telegramId} and code_hache = ${reserve.hache}`.catch(() => undefined)
      return 'panne'
    }
    return 'envoye'
  } catch (err) {
    console.warn(`[liveclub/verification] envoi du code impossible : ${messageErreur(err)}`)
    return 'panne'
  }
}

// ---------------------------------------------------------------------------
// 4. Verifier le code tape
// ---------------------------------------------------------------------------

export type IssueCode =
  | { etat: 'ok'; email: string }
  | { etat: 'faux'; restants: number }
  | { etat: 'epuise' }
  | { etat: 'expire' }
  | { etat: 'aucun' }
  | { etat: 'bloque' }

type LigneEssai = { code_hache: string; sel: string; email: string | null; essais: number; envoye_le: Date | null }

/**
 * Compte l'essai (5 au plus par code, code non expire), compare a temps
 * constant, et consomme le code s'il est juste (un seul passage, meme sur
 * deux messages simultanes). Jette si la base ne repond pas.
 *
 * Deux gardes contre la devinette (1 chance sur 1 000 000 par essai) :
 * - un code jamais envoye (envoye_le null : adresse inconnue ou trop
 *   sollicitee) n'est jamais accepte, meme tape juste ; la reponse est la
 *   meme que pour un code faux ;
 * - 10 codes faux au plus par ADRESSE et par heure, tous comptes Telegram
 *   confondus ('bloque' au-dela). Tout se passe dans une transaction qui
 *   verrouille la ligne du compte puis celle de l'adresse : deux essais
 *   simultanes ne passent pas sous le plafond ensemble.
 */
export async function verifierCode(telegramId: number, code: string): Promise<IssueCode> {
  let issue: IssueCode | null
  try {
    issue = await prisma.$transaction(async tx => {
      const cible = await tx.$queryRaw<{ email: string | null }[]>`
        select email from public.cockpit_liveclub_codes
        where telegram_id = ${telegramId}
          and code_hache is not null and valide_le is null
          and expire_le > now() and essais < ${CODE_ESSAIS_MAX}
        for update`
      if (cible.length === 0) return null
      const email = cible[0].email

      // Le budget de l'adresse, fenetre d'une heure remise a zero si elle est
      // passee. L'upsert verrouille la ligne jusqu'a la fin de la transaction.
      let budgetOuvert = false
      if (email) {
        const budget = await tx.$queryRaw<{ ratees: number }[]>`
          insert into public.cockpit_liveclub_codes_adresses (email, ratees, fenetre_le)
          values (${email}, 0, now())
          on conflict (email) do update set
            ratees = case when cockpit_liveclub_codes_adresses.fenetre_le <= now() - interval '1 hour'
                          then 0 else cockpit_liveclub_codes_adresses.ratees end,
            fenetre_le = case when cockpit_liveclub_codes_adresses.fenetre_le <= now() - interval '1 hour'
                              then now() else cockpit_liveclub_codes_adresses.fenetre_le end
          returning ratees`
        budgetOuvert = (budget[0]?.ratees ?? CODE_RATES_PAR_EMAIL_HEURE) < CODE_RATES_PAR_EMAIL_HEURE
      }

      const essai = await tx.$queryRaw<LigneEssai[]>`
        update public.cockpit_liveclub_codes set essais = essais + 1, maj_le = now()
        where telegram_id = ${telegramId}
        returning code_hache, sel, email, essais, envoye_le`
      const l = essai[0]
      if (!l) return null
      if (email && !budgetOuvert) return { etat: 'bloque' as const }

      const juste = !!l.email && l.envoye_le !== null && codeCorrespond(code, l.sel, l.code_hache)
      if (!juste) {
        if (email) {
          await tx.$executeRaw`
            update public.cockpit_liveclub_codes_adresses set ratees = ratees + 1
            where email = ${email}`
        }
        const restants = Math.max(0, CODE_ESSAIS_MAX - l.essais)
        return restants === 0 ? { etat: 'epuise' as const } : { etat: 'faux' as const, restants }
      }

      const pris = await tx.$queryRaw<{ email: string | null }[]>`
        update public.cockpit_liveclub_codes set code_hache = null, valide_le = now(), maj_le = now()
        where telegram_id = ${telegramId} and code_hache = ${l.code_hache}
        returning email`
      const valide = pris[0]?.email
      return valide ? { etat: 'ok' as const, email: valide } : { etat: 'aucun' as const }
    })
  } catch (err) {
    return tableCodes(err)
  }
  if (issue) return issue

  // Pas d'essai compte : dire pourquoi, sans rien changer.
  let etat: { code_hache: string | null; expire_le: Date | null; essais: number }[]
  try {
    etat = await prisma.$queryRaw<{ code_hache: string | null; expire_le: Date | null; essais: number }[]>`
      select code_hache, expire_le, essais from public.cockpit_liveclub_codes
      where telegram_id = ${telegramId} limit 1`
  } catch (err) {
    return tableCodes(err)
  }
  const e = etat[0]
  if (!e || !e.code_hache) return { etat: 'aucun' }
  if (e.essais >= CODE_ESSAIS_MAX) return { etat: 'epuise' }
  return { etat: 'expire' }
}

// ---------------------------------------------------------------------------
// 5. Rattacher
// ---------------------------------------------------------------------------

export type IssueRattachementEmail =
  | { etat: 'rattache' }
  | { etat: 'deja_pris' }
  | { etat: 'panne' }

/**
 * Relie ce compte Telegram au payeur de cette adresse VERIFIEE (source
 * 'bot'). Le client Stripe garde est celui de l'abonnement Live Club qui
 * ouvre le groupe, sinon le premier client de l'adresse, sinon aucun (acces
 * broker ou membre : l'email suffit a droitLiveClub).
 *
 * Refus 'deja_pris' si un AUTRE compte Telegram est deja rattache a cette
 * adresse ou a l'un de ses clients : un abonnement, un compte. Le changement
 * de compte passe par l'equipe. Ne jette pas.
 */
export async function rattacherParEmail(telegramId: number, emailBrut: string): Promise<IssueRattachementEmail> {
  const email = normaliserEmail(emailBrut)
  if (!email) return { etat: 'panne' }
  try {
    const clients = await clientsStripeParEmail(email)
    const pris = await prisma.$queryRaw<{ n: number }[]>`
      select 1 as n from public.cockpit_liveclub_rattachements
      where retire_le is null and telegram_id <> ${telegramId}
        and (lower(email) = ${email}
          or (client_stripe is not null and client_stripe = any(${clients}::text[])))
      limit 1`
    if (pris.length > 0) return { etat: 'deja_pris' }

    let clientStripe: string | null = null
    if (clients.length > 0) {
      const abonnements = await abonnementsLiveClubParEmail(email)
      clientStripe = meilleurAbonnement(abonnements)?.clientStripe
        ?? abonnements[0]?.clientStripe
        ?? clients[0]
    }
    await rattacherTelegram(telegramId, { clientStripe, email, source: 'bot' })
    return { etat: 'rattache' }
  } catch (err) {
    console.warn(`[liveclub/verification] rattachement impossible pour u${telegramId} : ${messageErreur(err)}`)
    return { etat: 'panne' }
  }
}
