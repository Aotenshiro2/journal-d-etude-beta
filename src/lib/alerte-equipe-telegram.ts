// L'alerte « un membre demande un humain » par Agent AOK (Brice, 16/10) : en
// plus de l'email, un message Telegram en prive a chaque compte de l'equipe
// (cockpit_telegram_comptes : Brice et Melanie), ajoute a l'historique de sa
// conversation avec l'agent pour qu'une question posee juste en dessous s'y
// rapporte. Meme mecanique que les alertes de compte Telegram
// (liveclub/comptes-telegram.ts). Ne jette jamais : une alerte ratee ne casse
// pas l'escalade. Regles et texte : alerte-equipe-telegram-pur.ts.
// (16/10) L'alerte finit par la reference du fil (« fil 1a2b3c4d ») : Brice ou
// Mel repondent d'ici, « reponds-lui : ... » (outil proposer_reponse_membre de
// l'agent, carte de confirmation, reponse-membre.ts).
// (16/10) Pour un fil du bot des membres : le bouton « Rendre la main au bot »
// sous l'alerte (clic traite par Agent AOK, agent-cockpit-telegram.ts), et
// l'image du message s'il en porte une : telechargee avec le jeton du bot des
// membres, renvoyee par sendPhoto avec celui d'Agent AOK, en memoire
// seulement. Image illisible : l'alerte dit « a voir dans l'onglet Support ».

import { prisma } from '@/lib/db'
import {
  LIBELLE_RENDRE_LA_MAIN, donneeRendreLaMain, entreesHistoriqueDemandeHumain, referenceFil, texteDemandeHumain,
  type DemandeHumain,
} from '@/lib/alerte-equipe-telegram-pur'
import { envoyerFichierTelegram, telechargerFichierTelegram } from '@/lib/liveclub/telegram'
import { MAX_IMAGE_LUE, type PieceSupport } from '@/lib/liveclub/support-pont-pur'
import { typeImageDepuisOctets } from '@/lib/agent-cockpit-telegram-pur'

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

export type OptionsAlerte = {
  /** L'image du message du membre (fil du bot des membres) : jointe sous l'alerte si elle se relit. */
  image?: PieceSupport | null
  /** Le bouton « Rendre la main au bot » sous l'alerte (fils du bot des membres seulement). */
  rendreLaMain?: boolean
}

/**
 * Envoie l'alerte a chaque compte de l'equipe par Agent AOK. Renvoie le nombre
 * de destinataires qui l'ont recue. L'agent est importe a l'appel (pas au
 * chargement), pour ne pas creer de cycle avec le bot des membres.
 */
export async function alerterEquipeTelegram(d: DemandeHumain, o: OptionsAlerte = {}): Promise<number> {
  try {
    const { tgCockpit, ajouterAHistoriqueAgent } = await import('@/lib/agent-cockpit-telegram')
    const destinataires = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`

    // L'image, une seule fois pour tous les destinataires, jamais sur disque.
    let image: { octets: Uint8Array; mime: string } | null = null
    if (o.image) {
      const lu = await telechargerFichierTelegram('liveclub', o.image.file_id, MAX_IMAGE_LUE, o.image.taille)
      const mime = lu.ok ? typeImageDepuisOctets(lu.octets) : null
      if (lu.ok && mime) image = { octets: lu.octets, mime }
    }
    const texte = texteDemandeHumain({ ...d, image: o.image ? (image ? 'jointe' : 'onglet') : null })
    const bouton = o.rendreLaMain && d.fil ? donneeRendreLaMain(d.fil) : null
    const reference = referenceFil(d.fil)

    const id = `humain-${Date.now().toString(36)}`
    let livres = 0
    for (const dest of destinataires) {
      const chat = Number(dest.telegram_id)
      if (!Number.isSafeInteger(chat) || chat <= 0) continue
      if (!await tgCockpit('sendMessage', {
        chat_id: chat, text: texte.slice(0, 4000), link_preview_options: { is_disabled: true },
        ...(bouton ? { reply_markup: { inline_keyboard: [[{ text: LIBELLE_RENDRE_LA_MAIN, callback_data: bouton }]] } } : {}),
      })) continue
      livres++
      if (image) {
        const envoi = await envoyerFichierTelegram('sendPhoto', {
          chat_id: String(chat), caption: `Image de son message${reference ? ` (${reference})` : ''}.`,
        }, { octets: image.octets, nom: 'image', mime: image.mime }, 'cockpit')
        if (!envoi.ok) {
          await tgCockpit('sendMessage', { chat_id: chat, text: "L'image n'a pas pu être jointe : à voir dans l'onglet Support." })
        }
      }
      await ajouterAHistoriqueAgent(chat, chat, entreesHistoriqueDemandeHumain(texte, id)).catch(() => false)
    }
    console.log(`[alerte-equipe] ${d.genre === 'reponse' ? 'reponse a l equipe' : d.genre === 'annulee' ? 'demande annulee' : "demande d'humain"} (${d.origine}) : ${livres}/${destinataires.length} destinataire(s)${o.image ? `, image ${image ? 'jointe' : 'non jointe'}` : ''}`)
    return livres
  } catch (err) {
    console.warn(`[alerte-equipe] alerte Telegram non envoyee : ${(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 160)}`)
    return 0
  }
}
