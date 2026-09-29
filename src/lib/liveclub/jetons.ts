// Jetons d'entree du Live Club (29/09) : le lien personnel t.me/<bot>?start=
// <jeton> relie un compte Telegram a un payeur (abonnement) ou a un acces
// broker. Un jeton est un SECRET : table serveur seulement (migration
// 20260929200000), jamais dans un log ni dans le journal des gestes.
//
// Avant la migration, chaque fonction jette une ErreurTableLiveClub au message
// clair (le bot repond « souci technique », il ne dit pas « lien invalide »).

import { prisma } from '@/lib/db'
import { genererJeton, jetonBienForme, normaliserEmail, relationAbsente } from './pur'

export class ErreurTableLiveClub extends Error {
  constructor(table: string, migration: string) {
    super(`Table ${table} absente (migration ${migration} pas appliquee).`)
    this.name = 'ErreurTableLiveClub'
  }
}

function tableJetons(err: unknown): never {
  if (relationAbsente(err)) throw new ErreurTableLiveClub('cockpit_liveclub_jetons', '20260929200000')
  throw err
}

export type UsageJeton = 'entree' | 'retour'

export type LigneJeton = {
  jeton: string
  usage: UsageJeton
  client_stripe: string | null
  abonnement_id: string | null
  acces_id: string | null
  email: string | null
  cree_le: Date
  expire_le: Date
  utilise_le: Date | null
  telegram_id: bigint | null
  email_envoye_le: Date | null
}

export type NouveauJeton = {
  usage: UsageJeton
  clientStripe?: string | null
  abonnementId?: string | null
  accesId?: string | null
  email?: string | null
}

/** Cree un jeton de 24 caracteres valable `dureeJours` jours. Jette si l'insert echoue. */
export async function creerJeton(n: NouveauJeton, dureeJours = 30): Promise<string> {
  if (n.usage !== 'entree' && n.usage !== 'retour') throw new Error('usage de jeton inconnu.')
  const jours = Math.max(1, Math.min(Math.round(dureeJours), 400))
  const jeton = genererJeton()
  try {
    await prisma.$executeRaw`
      insert into public.cockpit_liveclub_jetons
        (jeton, usage, client_stripe, abonnement_id, acces_id, email, expire_le)
      values (${jeton}, ${n.usage}, ${n.clientStripe ?? null}, ${n.abonnementId ?? null},
              ${n.accesId ?? null}::uuid, ${n.email ? normaliserEmail(n.email) : null},
              now() + make_interval(days => ${jours}::int))`
  } catch (err) {
    tableJetons(err)
  }
  return jeton
}

/**
 * Le jeton encore valable (non expire, utilise ou non) le plus recent pour cet
 * abonnement ou cet acces broker, ou null. `usage` restreint au type voulu.
 * Un jeton deja utilise reste bon pour le MEME compte Telegram (voir
 * consommerJeton) : le rendre a une page rechargee ne cree pas de fuite.
 */
export async function jetonExistant(
  cible: { abonnementId?: string | null; accesId?: string | null; usage?: UsageJeton },
): Promise<string | null> {
  return (await jetonExistantDetail(cible))?.jeton ?? null
}

export type JetonExistant = {
  jeton: string
  /** Deja consomme : il ne marche plus QUE pour le compte Telegram qui l'a pris. */
  utilise: boolean
  telegramId: bigint | null
}

/**
 * Comme jetonExistant, avec l'etat du jeton. Un jeton deja lie a un compte
 * Telegram est mort pour tout autre compte : la page de bienvenue doit le
 * dire (« ce lien a deja servi, ecris a support@ ») plutot que le rendre tel
 * quel a un payeur qui ouvre le bot depuis un autre compte.
 */
export async function jetonExistantDetail(
  cible: { abonnementId?: string | null; accesId?: string | null; usage?: UsageJeton },
): Promise<JetonExistant | null> {
  const abo = cible.abonnementId ?? null
  const acces = cible.accesId ?? null
  if (!abo && !acces) return null
  try {
    const lignes = await prisma.$queryRaw<{ jeton: string; utilise_le: Date | null; telegram_id: bigint | null }[]>`
      select jeton, utilise_le, telegram_id from public.cockpit_liveclub_jetons
      where expire_le > now()
        and (${cible.usage ?? null}::text is null or usage = ${cible.usage ?? null})
        and ((${abo}::text is not null and abonnement_id = ${abo})
          or (${acces}::uuid is not null and acces_id = ${acces}::uuid))
      order by cree_le desc
      limit 1`
    const l = lignes[0]
    return l ? { jeton: l.jeton, utilise: l.utilise_le !== null, telegramId: l.telegram_id } : null
  } catch (err) {
    return tableJetons(err)
  }
}

/** La ligne d'un jeton (sans rien consommer), ou null. */
export async function lireJeton(jeton: string): Promise<LigneJeton | null> {
  if (!jetonBienForme(jeton)) return null
  try {
    const lignes = await prisma.$queryRaw<LigneJeton[]>`
      select * from public.cockpit_liveclub_jetons where jeton = ${jeton} limit 1`
    return lignes[0] ?? null
  } catch (err) {
    return tableJetons(err)
  }
}

/**
 * Consomme un jeton pour ce compte Telegram, en UN update atomique : il passe
 * si le jeton n'est pas expire ET (jamais utilise, OU deja utilise par ce meme
 * compte, qui peut rouvrir son lien). Un autre compte = null. Si le jeton vise
 * un acces broker encore sans compte Telegram, l'acces recoit ce telegram_id
 * dans la meme requete (c'est ce qui permet a droitLiveClub de le voir).
 * null = jeton inconnu, expire ou pris par quelqu'un d'autre.
 */
export async function consommerJeton(jeton: string, telegramId: number): Promise<LigneJeton | null> {
  if (!jetonBienForme(jeton) || !Number.isSafeInteger(telegramId)) return null
  try {
    const lignes = await prisma.$queryRaw<LigneJeton[]>`
      with j as (
        update public.cockpit_liveclub_jetons
        set utilise_le = coalesce(utilise_le, now()), telegram_id = ${telegramId}
        where jeton = ${jeton}
          and expire_le > now()
          and (utilise_le is null or telegram_id = ${telegramId})
        returning *
      ), a as (
        update public.cockpit_liveclub_acces acc
        set telegram_id = ${telegramId}
        from j
        where j.acces_id is not null and acc.acces_id = j.acces_id and acc.telegram_id is null
        returning acc.acces_id
      )
      select j.* from j`
    return lignes[0] ?? null
  } catch (err) {
    if (relationAbsente(err) && /cockpit_liveclub_acces/.test(String(err))) {
      throw new ErreurTableLiveClub('cockpit_liveclub_acces', '20260929200100')
    }
    return tableJetons(err)
  }
}

/**
 * Reserve l'envoi de l'email lie a ce jeton, atomiquement : true = cet appel
 * a pose email_envoye_le et DOIT envoyer ; false = deja envoye (ou jeton
 * inconnu). Si l'envoi echoue ensuite, annulerReservationEmail le rend.
 */
export async function reserverEnvoiEmail(jeton: string): Promise<boolean> {
  try {
    const lignes = await prisma.$queryRaw<{ jeton: string }[]>`
      update public.cockpit_liveclub_jetons set email_envoye_le = now()
      where jeton = ${jeton} and email_envoye_le is null
      returning jeton`
    return lignes.length === 1
  } catch (err) {
    return tableJetons(err)
  }
}

export async function annulerReservationEmail(jeton: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      update public.cockpit_liveclub_jetons set email_envoye_le = null where jeton = ${jeton}`
  } catch (err) {
    tableJetons(err)
  }
}
