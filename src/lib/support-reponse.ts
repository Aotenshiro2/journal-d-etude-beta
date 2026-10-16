// LA REPONSE HUMAINE A UN FIL SUPPORT (16/10/2026), sortie de la route
// /api/support/reply pour servir a deux portes, avec les memes garde-fous :
// - l'onglet Support du cockpit (la route : memes entrees, memes sorties) ;
// - l'agent du cockpit, apres le clic sur la carte de proposer_reponse_membre
//   (reponse-membre.ts), depuis la fenetre du cockpit ou depuis Agent AOK.
//
// Les garde-fous (decisions de Brice du 29/09, inchangees) :
// - Fil 'telegram' (bot des membres du Live Club) : la reponse PART d'abord
//   dans Telegram par le bot des membres (TELEGRAM_LIVECLUB_BOT_TOKEN). Si
//   Telegram refuse (membre qui a bloque le bot, jeton absent), RIEN n'est
//   ecrit et la demande reste en attente. Livree puis echec d'ecriture :
//   'livre_non_enregistre', pour que personne ne la renvoie.
// - Fil du site (extension, site, apps) : ajoutee au fil, le membre la lit a
//   la prochaine ouverture de son chat.
// - Role 'human', et le fil sort de l'attente (escalatedAt a null ; pour un
//   fil Telegram, seulement si aucune nouvelle demande n'est arrivee pendant
//   l'envoi : ajouterReponseEquipe).
//
// L'appelant lit et borne l'entree ; ce module revérifie (texte non vide,
// 4 000 caracteres au plus). Jamais le texte d'un message dans un log.
//
// (16/10) Une PIECE JOINTE (fil Telegram seulement : le chat du site n'affiche
// que du texte) : le bot des membres l'envoie (sendPhoto ou sendDocument), le
// texte en legende (1 024 caracteres au plus, en-tete compris), depuis la
// memoire ou par un file_id du meme bot. Le fil garde le message humain avec
// le file_id RENDU par le bot des membres : l'onglet Support le relit.

import { prisma } from '@/lib/db'
import { envoyer, envoyerFichierTelegram } from '@/lib/liveclub/telegram'
import { ajouterReponseEquipe, telegramDuFil, texteReponseEquipe } from '@/lib/liveclub/support-pont'
import {
  legendeFichier, pieceDuResultat, refusLegende, texteFilEnvoi, type FichierLu, type PieceSupport,
} from '@/lib/liveclub/support-pont-pur'

/** Meme plafond que /api/support/chat et le pont. */
export const MAX_REPONSE_FIL = 4000

/** Un fichier a envoyer avec la reponse : deja lu (type, poids, methode), ses octets ou un file_id du bot des membres. */
export type FichierReponse = { lu: FichierLu; octets?: Uint8Array; fileIdMembres?: string }

export type IssueReponseFil =
  | { ok: true; canal: 'telegram'; app: string; messages: unknown; escalatedAt: Date | null; piece: PieceSupport | null }
  | { ok: true; canal: 'site'; app: string; messages: unknown; escalatedAt: null }
  | { ok: false; raison: 'texte_invalide' | 'introuvable' | 'compte_illisible' | 'sans_compte' | 'livre_non_enregistre' | 'piece_hors_telegram' }
  | { ok: false; raison: 'non_livre'; detail: string; code: number | null }
  | { ok: false; raison: 'legende_trop_longue'; detail: string }

function premiereLigne(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'erreur'
}

/**
 * Envoie la reponse de l'equipe sur le fil `threadId`. `journal` prefixe les
 * logs (la route garde « [support/reply] »). Jette seulement si la base ne
 * repond pas a la lecture du fil (la route rendait alors une 500, inchange).
 */
export async function repondreAuFil(
  threadId: string,
  message: string,
  journal = '[support/reply]',
  fichier: FichierReponse | null = null,
): Promise<IssueReponseFil> {
  if (typeof message !== 'string' || (!message.trim() && !fichier) || message.length > MAX_REPONSE_FIL) {
    return { ok: false, raison: 'texte_invalide' }
  }
  // Avec une piece, le texte part en legende : trop long = refus, rien n'est coupe.
  const legende = fichier ? legendeFichier(message) : null
  const refus = legende ? refusLegende(legende) : null
  if (refus) return { ok: false, raison: 'legende_trop_longue', detail: refus }

  const thread = await prisma.supportThread.findUnique({ where: { id: threadId } })
  if (!thread) return { ok: false, raison: 'introuvable' }
  if (fichier && thread.app !== 'telegram') return { ok: false, raison: 'piece_hors_telegram' }

  if (thread.app === 'telegram') {
    let telegramId: number | null
    try {
      telegramId = await telegramDuFil(thread.id)
    } catch (err) {
      console.error(`${journal} compte Telegram illisible:`, premiereLigne(err))
      return { ok: false, raison: 'compte_illisible' }
    }
    if (!telegramId) return { ok: false, raison: 'sans_compte' }

    const envoi = fichier && legende
      ? await envoyerFichierTelegram(fichier.lu.methode, { chat_id: String(telegramId), caption: legende }, {
        octets: fichier.octets, fileId: fichier.fileIdMembres, nom: fichier.lu.nom, mime: fichier.lu.mime,
      })
      : await envoyer(telegramId, texteReponseEquipe(message))
    if (!envoi.ok) {
      const detail = envoi.code === 403
        ? 'le membre a bloqué le bot'
        : envoi.code === 400 ? 'conversation Telegram introuvable' : envoi.erreur
      return { ok: false, raison: 'non_livre', detail, code: envoi.code }
    }
    // Le fichier envoye, par le file_id que le bot des membres vient de rendre.
    const piece = fichier ? pieceDuResultat(envoi.result, fichier.lu) : null

    // Livre : on enregistre en UNE requete (concatenation jsonb). L'envoi peut
    // durer (jusqu'a ~20 s avec les rejeux sur 429) : reecrire le tableau lu
    // avant l'envoi effacerait ce que le membre a ecrit entre-temps.
    try {
      const contenu = fichier ? texteFilEnvoi(message, fichier.lu) : message
      const maj = await ajouterReponseEquipe(thread.id, contenu, thread.escalatedAt, piece)
      if (!maj) throw new Error('fil disparu pendant l\'envoi')
      return { ok: true, canal: 'telegram', app: thread.app, messages: maj.messages, escalatedAt: maj.escalatedAt, piece }
    } catch (err) {
      console.error(`${journal} reponse livree mais non enregistree:`, premiereLigne(err))
      return { ok: false, raison: 'livre_non_enregistre' }
    }
  }

  const messages = (Array.isArray(thread.messages) ? thread.messages : []) as unknown[]
  const nouveau = { role: 'human', content: message, at: new Date().toISOString() }

  const maj = await prisma.supportThread.update({
    where: { id: thread.id },
    data: {
      messages: [...messages, nouveau] as object[],
      // La demande d'humain est prise en main : la chip « veut un humain »
      // s'éteint dans le cockpit. Une nouvelle escalade la rallumera.
      escalatedAt: null,
    },
  })

  return { ok: true, canal: 'site', app: thread.app, messages: maj.messages, escalatedAt: null }
}
