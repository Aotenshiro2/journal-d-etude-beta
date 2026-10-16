// L'alerte « un membre demande un humain » par Agent AOK (Brice, 16/10) : en
// plus de l'email, un message Telegram en prive a chaque compte de l'equipe
// (cockpit_telegram_comptes : Brice et Melanie), ajoute a l'historique de sa
// conversation avec l'agent pour qu'une question posee juste en dessous s'y
// rapporte. Meme mecanique que les alertes de compte Telegram
// (liveclub/comptes-telegram.ts). Ne jette jamais : une alerte ratee ne casse
// pas l'escalade. Regles et texte : alerte-equipe-telegram-pur.ts.

import { prisma } from '@/lib/db'
import { entreesHistoriqueAlerte } from '@/lib/liveclub/comptes-telegram-pur'
import { texteDemandeHumain, type DemandeHumain } from '@/lib/alerte-equipe-telegram-pur'

export { dernierMessageMembre, texteDemandeHumain, type DemandeHumain } from '@/lib/alerte-equipe-telegram-pur'

/** Nom et pseudo d'un compte Telegram, tels que le groupe les connait. */
export async function nomTelegram(telegramId: number): Promise<string | null> {
  try {
    const l = await prisma.$queryRaw<{ pseudo: string | null; nom_affiche: string | null }[]>`
      select pseudo, nom_affiche from public.cockpit_telegram_membres where telegram_id = ${telegramId}`
    if (!l[0]) return null
    return [l[0].nom_affiche, l[0].pseudo ? `@${l[0].pseudo}` : null].filter(Boolean).join(' ') || null
  } catch {
    return null
  }
}

/**
 * Envoie l'alerte a chaque compte de l'equipe par Agent AOK. Renvoie le nombre
 * de destinataires qui l'ont recue. L'agent est importe a l'appel (pas au
 * chargement), pour ne pas creer de cycle avec le bot des membres.
 */
export async function alerterEquipeTelegram(d: DemandeHumain): Promise<number> {
  try {
    const { tgCockpit, ajouterAHistoriqueAgent } = await import('@/lib/agent-cockpit-telegram')
    const destinataires = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`
    const texte = texteDemandeHumain(d)
    const id = `humain-${Date.now().toString(36)}`
    let livres = 0
    for (const dest of destinataires) {
      const chat = Number(dest.telegram_id)
      if (!Number.isSafeInteger(chat) || chat <= 0) continue
      if (!await tgCockpit('sendMessage', { chat_id: chat, text: texte.slice(0, 4000), link_preview_options: { is_disabled: true } })) continue
      livres++
      await ajouterAHistoriqueAgent(chat, chat, entreesHistoriqueAlerte(texte, id)).catch(() => false)
    }
    console.log(`[alerte-equipe] demande d'humain (${d.origine}) : ${livres}/${destinataires.length} destinataire(s)`)
    return livres
  } catch (err) {
    console.warn(`[alerte-equipe] alerte Telegram non envoyee : ${(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 160)}`)
    return 0
  }
}
