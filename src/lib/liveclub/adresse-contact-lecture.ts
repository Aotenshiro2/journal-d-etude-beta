// (31/10) Les LECTURES de l'adresse de contact d'un acces broker
// (adresse-contact-pur.ts) : l'etape 2 de l'adresse d'envoi (adresse-envoi.ts,
// la seule fonction qui choisit ou part un email), et quel acces porte une
// adresse de contact (webhook Resend, rebonds.ts).
//
// Avant la migration 20261031210000 (table absente) : le comportement
// d'avant, l'adresse de l'acces, avec un avertissement unique dans les logs.
// Une autre panne de lecture : pareil. Jamais d'adresse dans un log.

import { prisma } from '@/lib/db'
import { messageErreur } from './pur'
import { MIGRATION_CONTACTS, TABLE_CONTACTS, tableContactsAbsente } from './adresse-contact-pur'

/** Un avertissement par cause et par instance (la table absente ne remplit pas les logs). */
const avertis = new Set<string>()
function avertir(suite: string, err: unknown) {
  const absente = tableContactsAbsente(err)
  const cle = `${absente ? 'absente' : 'illisible'}:${suite}`
  if (avertis.has(cle)) return
  avertis.add(cle)
  if (absente) {
    console.warn(`[liveclub/contact] table ${TABLE_CONTACTS} absente (migration ${MIGRATION_CONTACTS} pas appliquee) : ${suite}.`)
  } else {
    console.warn(`[liveclub/contact] adresse de contact illisible (${messageErreur(err)}) : ${suite}.`)
  }
}

/** L'adresse de contact en cours de l'acces, ou null (aucune, table absente, panne). */
export async function adresseContactAcces(accesId: string): Promise<string | null> {
  try {
    const l = await prisma.$queryRaw<{ email: string }[]>`
      select email from public.cockpit_liveclub_acces_contacts
      where acces_id = ${accesId}::uuid and retire_le is null
      limit 1`
    return l[0]?.email ?? null
  } catch (err) {
    avertir("email a l'adresse de l'acces, comme avant", err)
    return null
  }
}

export type AccesParContact = {
  accesId: string
  /** L'adresse de l'acces (celle du broker), minuscules. */
  emailAcces: string
  telegramId: number | null
  actif: boolean
  /** L'adresse est l'adresse de contact EN COURS (sinon : une ancienne). */
  enCours: boolean
}

/**
 * L'acces broker dont cette adresse est (ou a ete) l'adresse de contact : la
 * ligne en cours d'abord, sinon la plus recente. null = aucune, ou table
 * absente (le webhook fait comme avant).
 */
export async function accesParAdresseContact(email: string): Promise<AccesParContact | null> {
  try {
    const l = await prisma.$queryRaw<{ acces_id: string; email_acces: string; telegram_id: bigint | null; actif: boolean; en_cours: boolean }[]>`
      select a.acces_id::text as acces_id, lower(a.email) as email_acces, a.telegram_id,
        (a.retire_le is null and a.sorti_le is null and a.jusquau >= current_date) as actif,
        (c.retire_le is null) as en_cours
      from public.cockpit_liveclub_acces_contacts c
      join public.cockpit_liveclub_acces a on a.acces_id = c.acces_id
      where c.email = ${email} and a.motif = 'broker'
      order by (c.retire_le is null) desc, c.pose_le desc
      limit 1`
    const x = l[0]
    if (!x) return null
    return {
      accesId: x.acces_id, emailAcces: x.email_acces,
      telegramId: x.telegram_id === null ? null : Number(x.telegram_id),
      actif: x.actif === true, enCours: x.en_cours === true,
    }
  } catch (err) {
    avertir('adresse de contact non cherchee', err)
    return null
  }
}
