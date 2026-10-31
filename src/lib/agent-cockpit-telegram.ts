import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { boucleAgent, type ReponseAgent } from '@/lib/agent-cockpit'
import { auteurDemande, libelleBoutonConfirmer } from '@/lib/agent-cockpit-pur'
import { validerAction, executerAction, RefusAction, expurgerLiensInvitation, paramsPourLog } from '@/lib/stripe-actions'
import {
  DUREE_TOUR_DEFAUT_MS, GRACE_FILET_MS, MAX_OCTETS_IMAGE, MAX_OCTETS_VOCAL, MAX_TEXTE_TOUR_VOCAL, MAX_TRANSCRIPTION,
  TEXTE_IMAGE_REFUSEE, TEXTE_REPONSE_NON_PARTIE, TEXTE_TEMPS_DEPASSE,
  couperAuMot, decouperMessage, demandesEnSuspens, entreesQuestionEquipe, erreurDImage, historiquePourTour, ligneEntendu,
  marqueurRapportEquipe, messagesAvecCarte, messagesPourModele, noteSuspens, partsDuTour, texteDuTourVocal, texteEchecVocal,
  texteQuestionEquipe, texteRapportEquipe, typeImageDepuisOctets,
  type DemandesEnSuspens, type ImageALire, type ImageDuTour, type LectureVocal, type QuestionEquipe,
} from '@/lib/agent-cockpit-telegram-pur'
import { FOURNISSEUR_TRANSCRIPTION, delaiTranscription, telechargerEtTranscrire } from '@/lib/transcription-pur'
import { cleTranscriptionServeur, tracerTranscription } from '@/lib/transcription'
import type { RelanceEquipe } from '@/lib/agent-equipe'
import { analyserTexte, combinerAnalyses, rendreVisible } from '@/lib/securite/injection-pur'
import { alerterBriceSecurite } from '@/lib/securite/alerte'
import { telechargerFichierTelegram, type BotTelegram } from '@/lib/liveclub/telegram'
import { dernierePieceHistorique, phraseMainRendue, type PieceAgent } from '@/lib/liveclub/support-pont-pur'
import { lireDonneeRendreLaMain, referenceFil } from '@/lib/alerte-equipe-telegram-pur'
import { lireBoutonCorrection } from '@/lib/liveclub/relais-pur'

// Le TRAITEMENT du canal Telegram de l'agent cockpit (« Agent AOK »), sorti de
// la route /api/cockpit/agent/telegram le 08/10 pour servir a deux portes :
// - la route du bot Agent AOK (webhook, secret verifie par elle) ;
// - le bot des MEMBRES (@aok_liveclub_bot, liveclub/bot-membre.ts) : un compte
//   de l'equipe qui y ecrit du texte libre voit sa demande transmise ici,
//   exactement comme s'il l'avait ecrite a Agent AOK (meme conversation, memes
//   verrous, meme carte de confirmation), la reponse arrivant dans Agent AOK.
//
// Meme cerveau que la fenetre ✦ du cockpit (src/lib/agent-cockpit.ts).
//
// SECURITE, trois verrous, dans cet ordre :
// 1. Le secret de webhook (verifie par chaque route, jamais ici).
// 2. L'identifiant Telegram de l'EXPEDITEUR doit exister dans
//    cockpit_telegram_comptes (rempli a la main : Brice, Melanie).
// 3. Les actions gardent leur confirmation HUMAINE : boutons inline
//    Confirmer/Annuler, l'execution ne part qu'au clic (callback_query, sur le
//    bot Agent AOK), avec revalidation des parametres.
//
// La conversation est PERSISTEE cote serveur (cockpit_agent_conversations),
// contrairement au web ou le navigateur porte l'historique : Telegram ne
// renvoie que le dernier message. Toujours du TEXTE BRUT, comme au web.
//
// IMAGES (Brice, 15/10) : une photo, une capture envoyee en fichier (JPEG, PNG,
// WEBP), leur legende, un message transfere. La lecture du message est pure
// (agent-cockpit-telegram-pur.ts) ; l'image est telechargee ici, avec le jeton
// du bot QUI a recu le message (un file_id ne vaut que pour son bot), et part
// au modele en bloc image dans le tour courant SEULEMENT. L'historique n'en
// garde que la trace « [image envoyée] » et la legende, jamais le base64.
//
// VOCAUX (Brice, 31/10) : un message vocal ou un fichier audio est transcrit
// (transcrireVocalTelegram, Groq) puis traite comme un message ECRIT de la
// meme personne (memes verrous, meme analyse, memes cartes). L'historique
// garde la transcription sous « [message vocal, transcrit ci-dessous] » ; la
// reponse commence par la ligne « J'ai entendu », ajoutee par le serveur.

const MAX_MESSAGES_CONSERVES = 20
export const MAX_MESSAGE_LEN = 4000

const API_TG = 'https://api.telegram.org'

function jetonBot(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN_COCKPIT?.trim() || null
}

/** Le bot qui a recu le message : Agent AOK, ou le bot des membres (@aok_liveclub_bot). */
export type BotImage = BotTelegram

export type IssueImage =
  | { ok: true; image: ImageDuTour }
  | { ok: false; raison: 'trop_gros'; taille: number }
  | { ok: false; raison: 'pas_une_image' | 'illisible' }

/**
 * Recupere l'image chez Telegram : getFile, puis le fichier, avec le jeton du
 * bot qui a recu le message. Ne jette pas. JAMAIS l'URL du fichier dans un
 * log ni dans un message : elle contient le jeton du bot. Le poids est
 * verifie trois fois (annonce de getFile, Content-Length, octets lus), et le
 * type vient des octets, pas de ce qu'annonce Telegram.
 */
export async function telechargerImageTelegram(bot: BotImage, image: ImageALire): Promise<IssueImage> {
  // (16/10) Le telechargement est commun a tous les fichiers (liveclub/telegram.ts) ;
  // ici, le poids d'une image lue et son type, lu dans les octets.
  const issue = await telechargerFichierTelegram(bot, image.fileId, MAX_OCTETS_IMAGE, image.taille)
  if (!issue.ok) return issue
  const mediaType = typeImageDepuisOctets(issue.octets)
  if (!mediaType) return { ok: false, raison: 'pas_une_image' }
  return { ok: true, image: { base64: Buffer.from(issue.octets).toString('base64'), mediaType } }
}

/** (31/10) Un vocal transcrit : le texte du tour (trace + transcription), ou le message d'echec a envoyer tel quel. */
export type IssueVocal =
  | { ok: true; texte: string; transcription: string; transfert: string | null }
  | { ok: false; texte: string }

/**
 * (31/10) Un message vocal (ou un fichier audio) recu par `bot` : refus dits
 * en clair (duree, poids, format : lireVocalTelegram), puis telechargement
 * chez Telegram avec le jeton du bot qui l'a recu (un file_id ne vaut que pour
 * lui), transcription (transcription-pur.ts, delai borne par la limite du
 * tour) et cout trace (AiUsage, poste « transcription »). Ne jette pas. Jamais
 * la transcription, la cle ni l'URL du fichier dans un log : la raison et le
 * statut seulement.
 */
export async function transcrireVocalTelegram(
  bot: BotTelegram, lu: LectureVocal, o: { userId: string; limite: number; echange?: string | null },
): Promise<IssueVocal> {
  if (lu.genre === 'refus') return { ok: false, texte: lu.texte }
  const { vocal } = lu
  const cle = cleTranscriptionServeur()
  if (!cle) console.warn(`[transcription] ${FOURNISSEUR_TRANSCRIPTION.variableCle} absente du projet journal : vocal non transcrit`)
  const issue = await telechargerEtTranscrire(
    { fileId: vocal.fileId, taille: vocal.taille, nomFichier: vocal.nomFichier, mime: vocal.mime },
    {
      cle,
      maxOctets: MAX_OCTETS_VOCAL,
      telecharger: (fileId, max, taille) => telechargerFichierTelegram(bot, fileId, max, taille),
      fetch,
      delaiMs: delaiTranscription(o.limite, Date.now()),
      facturer: () => tracerTranscription({ userId: o.userId, dureeS: vocal.duree, echange: o.echange }),
    },
  )
  if (!issue.ok) {
    if (issue.raison !== 'sans_cle') {
      console.warn(`[transcription] ${FOURNISSEUR_TRANSCRIPTION.nom} : vocal non transcrit (${issue.raison}${issue.statut ? `, HTTP ${issue.statut}` : ''})`)
    }
    return { ok: false, texte: texteEchecVocal(issue.raison, { source: vocal.source, taille: issue.taille ?? vocal.taille }) }
  }
  const transcription = couperAuMot(issue.texte, MAX_TRANSCRIPTION)
  return { ok: true, texte: texteDuTourVocal(lu, transcription), transcription, transfert: lu.transfert }
}

/**
 * Appel a l'API du bot Agent AOK. Ne jette jamais : true si Telegram a
 * accepte (un refus est loggue, sans le texte du message).
 */
export async function tgCockpit(methode: string, params: Record<string, unknown>): Promise<boolean> {
  const jeton = jetonBot()
  if (!jeton) {
    console.error(`[cockpit/telegram] ${methode} : TELEGRAM_BOT_TOKEN_COCKPIT absent du projet journal`)
    return false
  }
  try {
    const reponse = await fetch(`${API_TG}/bot${jeton}/${methode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!reponse.ok) {
      const corps = await reponse.text()
      console.error(`[cockpit/telegram] ${methode} : ${corps.slice(0, 300)}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[cockpit/telegram] ${methode}`, err)
    return false
  }
}

/**
 * Une ligne de cockpit_agent_conversations.messages. `id` (15/10) : la
 * question d'un tour porte l'identifiant du tour (u<update_id> pour Agent
 * AOK, t<uuid> pour un message transmis par le bot des membres).
 */
type MessageStocke = {
  role: 'user' | 'assistant'; content: string; id?: string; piece?: PieceAgent
  /** (29/10) L'arrivee de la question (ISO) : une demande restee sans reponse se date. */
  le?: string
  /** (29/10) Une reponse d'echec (erreur, temps depasse, reponse partielle) : la demande reste en suspens. */
  echec?: true
  /** (29/10) Une question posee par l'autre membre de l'equipe (poser_question_equipe), dans le fil de la personne interrogee. */
  questionEquipe?: QuestionEquipe
  /** (29/10) La question d'equipe que cette ligne ferme (reponse rapportee). */
  rapportQuestion?: string
}

type LigneConversation = {
  chat_id: bigint
  messages: unknown
  action_en_attente: unknown
  nonce: string | null
  dernier_update_id: bigint | null
}

async function chargerConversation(chatId: number): Promise<LigneConversation | null> {
  const lignes = await prisma.$queryRaw<LigneConversation[]>`
    select chat_id, messages, action_en_attente, nonce, dernier_update_id
    from public.cockpit_agent_conversations where chat_id = ${chatId}`
  return lignes[0] ?? null
}

// HISTORIQUE EN AJOUT, JAMAIS EN REECRITURE (29/09) : l'agent peut reflechir
// deux minutes sur un message texte, et un clic Confirmer peut tomber pendant
// ce temps. Si chaque chemin reecrivait l'historique qu'il a lu au depart, le
// dernier a ecrire effacerait les lignes de l'autre, dont la ligne « ✓ » d'un
// remboursement fait : au tour suivant, le modele ne saurait plus qu'il est
// fait et pourrait le reproposer. Chaque ecriture AJOUTE donc ses messages a
// l'historique present en base au moment de l'ecriture, et la borne aux
// MAX_MESSAGES_CONSERVES derniers est appliquee en SQL, dans la meme
// instruction.
function historiqueAvecAjout(actuel: Prisma.Sql, ajout: Prisma.Sql): Prisma.Sql {
  const tout = Prisma.sql`((case when jsonb_typeof(${actuel}) = 'array' then ${actuel} else '[]'::jsonb end) || ${ajout})`
  return Prisma.sql`(select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
    from jsonb_array_elements(${tout}) with ordinality as a(e, i)
    where i > jsonb_array_length(${tout}) - ${MAX_MESSAGES_CONSERVES}::int)`
}

// Dans un « on conflict do update » : l'historique de la ligne existante,
// complete par les messages que porte l'insert. Les inserts qui l'utilisent
// nomment la table « c » (insert into ... as c).
const HISTORIQUE_UPSERT = historiqueAvecAjout(Prisma.raw('c.messages'), Prisma.raw('excluded.messages'))

/**
 * Ajoute des lignes a l'historique d'une conversation Agent AOK sans rien
 * reecrire (HISTORIQUE_UPSERT, meme borne), en creant la conversation s'il
 * le faut. Sert au resume du matin du Live Club (liveclub/resume.ts, 15/10),
 * pour qu'une question posee juste en dessous (« et pour Untel ? ») le voie.
 * Une ligne portant deja l'identifiant de la premiere ligne ajoutee : rien
 * (un resume rejoue n'entre pas deux fois). false = rien d'ajoute. Jette si
 * la base ne repond pas.
 */
export async function ajouterAHistoriqueAgent(chatId: number, telegramId: number, lignes: MessageStocke[]): Promise<boolean> {
  if (lignes.length === 0) return false
  const id = lignes[0].id ?? null
  const ajout = JSON.stringify(lignes)
  const ecrites = await prisma.$queryRaw<{ ok: number }[]>`
    insert into public.cockpit_agent_conversations as c (chat_id, telegram_id, messages)
    values (${chatId}, ${telegramId}, ${ajout}::jsonb)
    on conflict (chat_id) do update
    set messages = ${HISTORIQUE_UPSERT}, maj_le = now()
    where ${id}::text is null or not exists (
      select 1
      from jsonb_array_elements(case when jsonb_typeof(c.messages) = 'array' then c.messages else '[]'::jsonb end) as d(e)
      where d.e->>'id' = ${id}::text)
    returning 1 as ok`
  return ecrites.length > 0
}

export type CompteCockpitTelegram = { user_id: string; libelle: string | null }

/**
 * Le compte du cockpit derriere un identifiant Telegram (verrou 2), ou null.
 * Jette si la base ne repond pas.
 */
export async function compteCockpitTelegram(telegramId: number): Promise<CompteCockpitTelegram | null> {
  const lignes = await prisma.$queryRaw<CompteCockpitTelegram[]>`
    select user_id::text as user_id, libelle from public.cockpit_telegram_comptes
    where telegram_id = ${telegramId}`
  return lignes[0] ?? null
}

/** Formes minimales d'un clic sur un bouton inline d'Agent AOK. */
export type ClicAgentTelegram = {
  id: string
  data?: string
  from?: { id?: number }
  message?: { chat?: { id?: number }; message_id?: number }
}

/**
 * (16/10) Le bouton « Rendre la main au bot » sous une alerte du support :
 * le bot reprend les messages ecrits du membre (ligne au fil, fil sorti de
 * l'attente), sans rien dire au membre. Memes verrous que les cartes (compte
 * de l'equipe verifie par l'appelant). Le bouton est retire, une ligne le dit
 * dans Agent AOK et entre a l'historique.
 */
async function rendreLaMainDepuisAlerte(cq: ClicAgentTelegram, chatId: number, fil: string): Promise<void> {
  const { rendreLaMainAuBot } = await import('@/lib/liveclub/support-pont')
  let texte: string
  try {
    texte = phraseMainRendue(await rendreLaMainAuBot(fil), referenceFil(fil))
  } catch (err) {
    console.error('[cockpit/telegram] main rendue au bot impossible', err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : '?')
    texte = 'Impossible de rendre la main au bot (base illisible) : réessaie dans un instant.'
  }
  await tgCockpit('answerCallbackQuery', { callback_query_id: cq.id })
  const messageId = Number(cq.message?.message_id)
  if (Number.isSafeInteger(messageId) && messageId > 0) {
    await tgCockpit('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
  }
  await tgCockpit('sendMessage', { chat_id: chatId, text: texte })
  await ajouterReponseSeule(chatId, texte)
}

/** Un clic sur Confirmer / Annuler d'une carte d'Agent AOK. */
export async function traiterClicAgentTelegram(cq: ClicAgentTelegram): Promise<void> {
  const chatId = Number(cq.message?.chat?.id)
  const telegramId = Number(cq.from?.id)
  const donnee = String(cq.data ?? '')

  // Toujours acquitter, sinon le bouton tourne indefiniment chez l'humain.
  const acquitter = (texte?: string) =>
    tgCockpit('answerCallbackQuery', { callback_query_id: cq.id, ...(texte ? { text: texte } : {}) })

  const compte = Number.isSafeInteger(telegramId) ? await compteCockpitTelegram(telegramId) : null
  if (!compte || !chatId) {
    await acquitter('Accès réservé.')
    return
  }

  // (24/10) Valider / Refuser une correction de @ proposee par un relais
  // d'accueil (liveclub/corrections-pseudo.ts). Apres le verrou 2 : seuls les
  // comptes de cockpit_telegram_comptes arrivent ici. Import a la demande,
  // comme rendreLaMain (corrections-pseudo importe ce module).
  const correction = lireBoutonCorrection(donnee)
  if (correction) {
    const { traiterBoutonCorrection } = await import('@/lib/liveclub/corrections-pseudo')
    await traiterBoutonCorrection(cq, chatId, telegramId, compte, correction)
    return
  }

  // (16/10) « Rendre la main au bot », sous une alerte du support.
  const filRendu = lireDonneeRendreLaMain(donnee)
  if (filRendu) {
    await rendreLaMainDepuisAlerte(cq, chatId, filRendu)
    return
  }

  const [verbe, nonce] = donnee.split(':')
  if (!nonce || (verbe !== 'ok' && verbe !== 'non')) {
    await acquitter('Cette action n\'est plus en attente.')
    return
  }

  // CONSOMMATION ATOMIQUE AVANT EXECUTION (29/09) : la carte est retiree de
  // la conversation par UN update conditionne au nonce, et seul l'appel qui
  // recupere la ligne va plus loin. Deux clics rapproches, ou un rejeu
  // Telegram du meme callback, arrivent chacun ici : le premier emporte
  // l'action, le second ne trouve plus rien (nonce deja a null) et n'execute
  // rien. Annuler passe par la meme porte, pour qu'un Annuler et un Confirmer
  // croises ne fassent pas les deux. Contrepartie assumee : si l'execution
  // tombe en panne, la carte est perdue et il faut la redemander a l'agent.
  // On ne rejoue jamais seul un geste qui a pu partir a moitie.
  // RETURNING d'un UPDATE rend la ligne APRES modification : il rendrait
  // donc l'action deja remise a null (bug constate au premier test le 29/09,
  // « Action illisible »). La CTE verrouille la ligne et garde l'ancienne
  // valeur ; l'UPDATE qui suit la vide, et on rend la valeur gardee.
  const consommee = await prisma.$queryRaw<{ action_en_attente: unknown }[]>`
    with carte as (
      select chat_id, action_en_attente as action_avant
      from public.cockpit_agent_conversations
      where chat_id = ${chatId} and nonce = ${nonce} and action_en_attente is not null
      for update
    )
    update public.cockpit_agent_conversations c
    set action_en_attente = null, nonce = null, maj_le = now()
    from carte
    where c.chat_id = carte.chat_id
    returning carte.action_avant as action_en_attente`
  if (consommee.length === 0) {
    await acquitter('Cette action n\'est plus en attente.')
    return
  }

  let issue: string
  if (verbe === 'ok') {
    // Revalidation stricte : ce qui s'execute est ce qui a ete valide, pas
    // ce que porte le message Telegram.
    const action = validerAction(consommee[0].action_en_attente)
    if (typeof action === 'string') {
      issue = `Action refusée : ${action}`
    } else {
      try {
        issue = `✓ ${await executerAction(action, `agent:${compte.user_id}`)}`
        console.log(`[cockpit/telegram/action] ${compte.user_id} ${action.type} ${action.compte}`, paramsPourLog(action))
      } catch (err) {
        issue = err instanceof RefusAction
          ? `Rien n’a été fait. ${err.message}`
          : `L’action a échoué : ${err instanceof Error ? err.message : '?'}`
      }
    }
  } else {
    issue = '(action annulée, rien n’a été exécuté)'
  }

  // LE RESULTAT PART D'ABORD (29/09) : la carte est deja consommee, donc si
  // la route tombait ici en 500, le rejeu Telegram ne trouverait plus rien
  // et l'humain ne verrait que « plus en attente », sans le resultat ni le
  // lien d'invitation, qui n'existe nulle part ailleurs. L'ecriture de
  // l'historique vient apres, et son echec est journalise sans rien casser.
  await acquitter()
  await tgCockpit('sendMessage', { chat_id: chatId, text: issue })

  // Ajout a l'historique present en base, pas reecriture d'un historique lu
  // plus tot (voir historiqueAvecAjout). Cet update ne touche qu'aux
  // messages : une nouvelle carte proposee entre-temps garde son action et
  // son nonce. L'humain a recu le lien d'invitation ci-dessus, la
  // conversation conservee n'en garde qu'une mention.
  try {
    const ligne = JSON.stringify([{ role: 'assistant', content: expurgerLiensInvitation(issue) }])
    await prisma.$executeRaw`
      update public.cockpit_agent_conversations
      set messages = ${historiqueAvecAjout(Prisma.raw('messages'), Prisma.sql`${ligne}::jsonb`)},
          maj_le = now()
      where chat_id = ${chatId}`
  } catch (err) {
    console.error('[cockpit/telegram] historique apres action', err)
  }
}

export type EntreeAgentTelegram = {
  /** La conversation avec Agent AOK (en prive, l'id du chat est celui du compte). */
  chatId: number
  telegramId: number
  /**
   * Le texte du tour (texteDuTour : origine d'un transfert, trace de l'image,
   * texte ou legende). C'est lui qui va a l'historique.
   */
  texte: string
  /** (15/10) L'image du tour, deja telechargee : au modele seulement, jamais en base. */
  image?: ImageDuTour | null
  /**
   * (16/10) La piece jointe du tour (photo ou document), par sa reference
   * Telegram seulement : gardee dans l'historique, pour que
   * proposer_reponse_membre puisse l'envoyer a un membre. Jamais le fichier.
   */
  piece?: PieceAgent | null
  compte: CompteCockpitTelegram
  /**
   * update_id du bot Agent AOK, pour le dedoublonnage. null = message transmis
   * par le bot des membres, deja dedoublonne par lui (ses update_id suivent
   * une autre sequence : les ecrire ici ferait ignorer les vrais messages
   * d'Agent AOK).
   */
  updateId: number | null
  /** Transmis par le bot des membres : un accuse le rappelle en tete, dans Agent AOK. */
  transmis?: boolean
  /** Transmis seulement : appele des que l'accuse est livre dans Agent AOK, avant que l'agent reflechisse. */
  apresAccuse?: () => Promise<void>
  /**
   * (29/10) L'instant (ms) ou la reponse doit etre partie (limiteDuTour, d'apres
   * le maxDuration de la route). Absent : DUREE_TOUR_DEFAUT_MS depuis le debut du tour.
   */
  limite?: number
  /**
   * (29/10) Reprise d'une demande restee sans reponse, demandee par un autre
   * membre de l'equipe (reprendre_demande) : le tour tourne pour le titulaire
   * du fil, sur ses messages en suspens. Rien a reprendre = rien n'est fait.
   */
  reprise?: { par: string }
  /**
   * (31/10) Le tour vient d'un message vocal : sa transcription (le texte du
   * tour la porte deja, sous TRACE_VOCAL) et l'origine d'un vocal transfere.
   * La reponse commence par la ligne « J'ai entendu : « ... » », ajoutee par
   * le serveur (ligneEntendu), jamais gardee en base.
   */
  vocal?: { transcription: string; transfert: string | null } | null
}

/**
 * 'traite' : le message a ete pris en charge (reponse, carte, ou erreur dite
 * dans Agent AOK). 'doublon' : update deja traite. 'non_livre' (transmis
 * seulement) : Agent AOK n'a pas pu recevoir l'accuse (bot jamais ouvert par
 * ce compte, jeton absent, panne Telegram), rien n'a ete fait.
 */
export type IssueAgentTelegram = 'traite' | 'doublon' | 'non_livre'

const TEXTE_ERREUR_AGENT = 'L’agent n’a pas pu répondre (erreur côté serveur). Réessaie dans un instant.'

/**
 * (29/10) Envoie des messages dans l'ordre ; le dernier porte `boutons` s'il y
 * en a. Une reponse longue (six brouillons recopies) depassait les 4 096
 * caracteres d'un message : Telegram la refusait et RIEN ne partait. Elle est
 * maintenant coupee (decouperMessage, messagesAvecCarte), la carte toujours
 * entiere dans le dernier message. false = un envoi refuse (la suite n'est
 * pas envoyee).
 */
async function envoyerMessages(chatId: number, morceaux: string[], boutons?: unknown): Promise<boolean> {
  for (const [i, texte] of morceaux.entries()) {
    const dernier = i === morceaux.length - 1
    const ok = await tgCockpit('sendMessage', {
      chat_id: chatId, text: texte, ...(dernier && boutons ? { reply_markup: boutons } : {}),
    })
    if (!ok) return false
  }
  return true
}

/** Une reponse refusee par Telegram : dit en clair, jamais le silence. */
async function signalerNonPartie(chatId: number): Promise<void> {
  console.error('[cockpit/telegram] reponse refusee par Telegram, message de repli envoye')
  await tgCockpit('sendMessage', { chat_id: chatId, text: TEXTE_REPONSE_NON_PARTIE })
}

/**
 * Un message pour l'agent (texte, et image depuis le 15/10), d'ou qu'il
 * vienne. Un message TRANSMIS par le bot des membres passe d'abord par un
 * accuse dans Agent AOK : s'il n'est pas livre, rien n'est fait
 * ('non_livre') ; s'il l'est, toute panne qui suit est dite dans Agent AOK,
 * jamais renvoyee a l'appelant. Un message d'Agent AOK lui-meme garde le
 * comportement d'avant : une panne de la base jette, la route rend une erreur
 * et Telegram rejoue.
 */
export async function traiterTexteAgentTelegram(e: EntreeAgentTelegram): Promise<IssueAgentTelegram> {
  if (!e.transmis) return tourAgent(e)

  const extrait = e.texte.trim().slice(0, 1500)
  const livre = await tgCockpit('sendMessage', {
    chat_id: e.chatId,
    text: `Reçu depuis le bot Live Club :\n\n${extrait}`,
  })
  if (!livre) return 'non_livre'
  try {
    await e.apresAccuse?.()
  } catch (err) {
    console.warn('[cockpit/telegram] accuse cote bot des membres', err)
  }
  try {
    return await tourAgent(e)
  } catch (err) {
    console.error('[cockpit/telegram] demande transmise par le bot des membres', err)
    await tgCockpit('sendMessage', { chat_id: e.chatId, text: TEXTE_ERREUR_AGENT })
    return 'traite'
  }
}

/**
 * Ajoute une reponse seule a l'historique (apres une erreur de l'agent), pour
 * que le tour suivant sache que la question est restee sans reponse. Ne jette
 * pas.
 */
async function ajouterReponseSeule(chatId: number, contenu: string, o: { echec?: boolean } = {}): Promise<void> {
  try {
    const ligne = JSON.stringify([{ role: 'assistant', content: contenu, ...(o.echec ? { echec: true } : {}) }])
    await prisma.$executeRaw`
      update public.cockpit_agent_conversations
      set messages = ${historiqueAvecAjout(Prisma.raw('messages'), Prisma.sql`${ligne}::jsonb`)},
          maj_le = now()
      where chat_id = ${chatId}`
  } catch (err) {
    console.error('[cockpit/telegram] historique apres une erreur', err)
  }
}

async function tourAgent(e: EntreeAgentTelegram): Promise<IssueAgentTelegram> {
  const { chatId, telegramId, compte, updateId } = e
  const debut = Date.now()
  const limite = e.limite ?? debut + DUREE_TOUR_DEFAUT_MS
  const image = e.image ?? null
  const piece = e.piece ?? null
  // (31/10) Un vocal de 5 minutes transcrit depasse les 4 000 caracteres d'un message ecrit.
  const texte = e.texte.slice(0, e.vocal ? MAX_TEXTE_TOUR_VOCAL : MAX_MESSAGE_LEN).trim()
  if (!texte && !image) return 'traite'

  const conv = await chargerConversation(chatId)

  // Dedoublonnage : Telegram rejoue les updates restes sans reponse rapide.
  if (updateId !== null && conv?.dernier_update_id && updateId <= Number(conv.dernier_update_id)) {
    return 'doublon'
  }

  // Un message transmis (updateId null) ne touche pas au dernier update_id
  // d'Agent AOK, et n'a pas besoin du garde anti-rejeu des upserts : le bot
  // des membres l'a deja dedoublonne.
  const majUpdate = updateId === null
    ? Prisma.sql`c.dernier_update_id`
    : Prisma.sql`greatest(c.dernier_update_id, excluded.dernier_update_id)`
  const garde = updateId === null
    ? Prisma.sql`true`
    : Prisma.sql`c.dernier_update_id is distinct from excluded.dernier_update_id`

  // /start ou /reset : repartir propre (jamais pour une image legendee ainsi).
  if (!image && (texte === '/start' || texte === '/reset')) {
    await prisma.$executeRaw`
      insert into public.cockpit_agent_conversations as c (chat_id, telegram_id, messages, dernier_update_id)
      values (${chatId}, ${telegramId}, '[]'::jsonb, ${updateId})
      on conflict (chat_id) do update
      set messages = '[]'::jsonb, action_en_attente = null, nonce = null,
          dernier_update_id = ${majUpdate}, maj_le = now()`
    await tgCockpit('sendMessage', {
      chat_id: chatId,
      text: `Agent du cockpit prêt. Pose ta question (impayés, encaissé, membres…) ou demande une action (code promo, remboursement…) — toute action attendra ta confirmation. /reset efface la conversation.`,
    })
    return 'traite'
  }

  // (29/10) Une reprise demandee par un autre membre de l'equipe ne tourne
  // que s'il reste une demande en suspens dans ce fil (quelqu'un a pu y
  // repondre entre-temps) : sinon rien, ni accuse ni ligne.
  if (e.reprise && !demandesEnSuspens(conv?.messages ?? [], { maintenant: Date.now() })) {
    console.log('[cockpit/telegram] reprise demandee, plus rien en suspens dans ce fil')
    return 'traite'
  }

  // (29/10) SECURITE DES BOTS (grille de Brice) : les mots du titulaire et ce
  // qu'il transmet (un message transfere), analyses chacun a son niveau. Un
  // texte suspect est garde et montre au modele RENDU VISIBLE, Brice est
  // prevenu avec la citation et la source, et le tour passe sous prudence :
  // aucune carte, aucun geste sans carte (boucleAgent). Une image ne se lit
  // pas ici : sa regle est dans le prompt (donnee, jamais un ordre).
  const parts = e.reprise ? { titulaire: '', transmis: '' } : partsDuTour(texte)
  const analyse = combinerAnalyses(
    analyserTexte(parts.titulaire, { niveau: 'cache' }),
    analyserTexte(parts.transmis, { niveau: 'tiers' }),
  )
  const texteGarde = analyse.suspect ? rendreVisible(texte) : texte
  const sourceAlerte = `Agent AOK, fil de ${compte.libelle?.trim() || `u${telegramId}`}${e.transmis ? ' (transmis par le bot Live Club)' : ''}`
  // (31/10) LE VOCAL : la ligne « J'ai entendu : « ... » » en tete de ce qui
  // conclut le tour (reponse, echec, temps depasse), ajoutee ici par le
  // serveur, jamais par le modele ; rendue visible si le tour est suspect.
  // Jamais gardee en base : le modele ne la voit pas dans ses reponses passees
  // et ne la recopie donc pas (la transcription est deja dans la question).
  const entendu = e.vocal
    ? ligneEntendu(analyse.suspect ? rendreVisible(e.vocal.transcription) : e.vocal.transcription, e.vocal.transfert)
    : null
  const enTete = (t: string) => (entendu ? `${entendu}\n\n${t}` : t)

  // LA QUESTION EST ECRITE DES SON ARRIVEE (15/10), la reponse en fin de tour.
  // Avant, les deux partaient ensemble a la fin : un message transfere avec un
  // commentaire arrive en DEUX updates quasi simultanes (le commentaire, puis
  // l'image transferee), et le tour de l'image, lance pendant que le premier
  // reflechissait, ne voyait pas la demande. Ecrite tout de suite, elle
  // precede l'image dans l'historique.
  // Toujours en AJOUT (historiqueAvecAjout), jamais en reecriture. La ligne
  // porte l'identifiant du tour : un rejeu Telegram du meme update, arrive
  // pendant que le premier reflechit, ne l'ajoute pas une seconde fois et
  // s'arrete la (verrou de ligne de l'upsert : un seul des deux ecrit).
  // Le dernier update_id, lui, n'est ecrit qu'en fin de tour, comme avant :
  // les photos d'un album arrivent en parallele et dans le desordre, et un
  // update_id ecrit trop tot ferait ignorer les precedents.
  const idTour = updateId !== null ? `u${updateId}` : `t${randomUUID()}`
  // (29/10) `le` : l'arrivee de la question, pour dater une demande restee sans reponse.
  const question = JSON.stringify([
    { role: 'user', content: texteGarde, id: idTour, le: new Date(debut).toISOString(), ...(piece ? { piece } : {}) },
  ] satisfies MessageStocke[])
  const ecrite = await prisma.$queryRaw<{ messages: unknown }[]>`
    insert into public.cockpit_agent_conversations as c (chat_id, telegram_id, messages)
    values (${chatId}, ${telegramId}, ${question}::jsonb)
    on conflict (chat_id) do update
    set messages = ${HISTORIQUE_UPSERT}, maj_le = now()
    where not exists (
      select 1
      from jsonb_array_elements(case when jsonb_typeof(c.messages) = 'array' then c.messages else '[]'::jsonb end) as d(e)
      where d.e->>'id' = ${idTour})
    returning messages`
  if (ecrite.length === 0) return 'doublon'

  // (29/10) L'alerte a Brice, une fois la question ecrite (un rejeu Telegram
  // s'est arrete juste au-dessus) : la citation et la source.
  if (analyse.suspect) {
    await alerterBriceSecurite({
      source: `${sourceAlerte}, ${e.vocal ? (parts.transmis ? 'vocal transféré, transcrit' : 'message vocal, transcrit') : parts.transmis ? 'message transféré' : 'message'}`,
      analyse, suite: "Aucune carte ni aucun geste dans ce tour ; l'agent dit à son interlocuteur ce qu'il a repéré.",
    })
  }

  // L'historique pour le modele : ce qui precede SA question dans la base
  // (un tour concurrent ecrit apres lui n'est pas a lui), roles normalises,
  // puis la question du tour, avec son image s'il y en a une.
  // (29/10) Les messages restes sans reponse AVANT cette question (un tour
  // tue, un echec) : une note pour le modele, jamais gardee en base. Une
  // reprise (reprendre_demande) les fait traiter maintenant ; un tour
  // ordinaire les reprend sur une relance, sinon propose de les reprendre.
  const suspens: DemandesEnSuspens | null = demandesEnSuspens(ecrite[0].messages, { maintenant: Date.now(), avantId: idTour })
  const note = suspens ? noteSuspens(suspens, e.reprise ? { mode: 'reprise', par: e.reprise.par } : { mode: 'tour' }) : null
  const texteModele = note ? (e.reprise ? note : `${note}\n\n${texteGarde}`) : texteGarde
  const precedents = historiquePourTour(ecrite[0].messages, idTour)
  const historique = messagesPourModele(precedents, { texte: texteModele, image }) as Anthropic.MessageParam[]
  // (29/10) La derniere reponse de l'agent : un « oui » du titulaire s'y rapporte (poser_question_equipe).
  const derniereReponse = [...precedents].reverse().find(m => m.role === 'assistant')?.content ?? null

  // SIGNE DE VIE (retour Brice 25/09) : sur une question lourde l'agent peut
  // prendre une ou deux minutes, et un silence de deux minutes ressemble a une
  // panne. Un accuse court part tout de suite, puis l'indicateur « en train
  // d'ecrire » est rafraichi toutes les 4 s (Telegram l'efface au bout de 5)
  // jusqu'a la reponse. L'accuse n'entre pas dans l'historique du modele. Une
  // photo y a droit comme un texte (15/10).
  const accuse = e.reprise
    ? `Je reprends ta demande restée sans réponse (relancée par ${e.reprise.par})...`
    : 'Je vérifie…'
  await tgCockpit('sendMessage', { chat_id: chatId, text: accuse })
  await tgCockpit('sendChatAction', { chat_id: chatId, action: 'typing' })
  const battement = setInterval(() => {
    void tgCockpit('sendChatAction', { chat_id: chatId, action: 'typing' })
  }, 4000)

  // LE FILET (29/10, bug de Melanie du 28/10). La boucle connait la limite et
  // rend ce qui est fait avant elle. Si elle n'a pas rendu la main a la
  // limite + GRACE_FILET_MS (appel bloque, base lente...), l'appel en cours
  // est coupe et l'echec est dit en clair, avant que la plateforme tue la
  // fonction : un « Je vérifie... » n'est plus jamais suivi du silence.
  const controleur = new AbortController()
  let filet: ReturnType<typeof setTimeout> | undefined
  const delai = new Promise<'delai'>(resolve => {
    filet = setTimeout(() => resolve('delai'), Math.max(0, limite + GRACE_FILET_MS - Date.now()))
  })
  // Une demande notee depuis Telegram porte le libelle du compte (08/10).
  const travail = boucleAgent(historique, compte.user_id, {
    source: 'agent_telegram',
    auteur: auteurDemande({ libelle: compte.libelle, userId: compte.user_id }),
    // (16/10) La derniere piece recue ici, que proposer_reponse_membre peut joindre.
    piece: dernierePieceHistorique(ecrite[0].messages),
    limite,
    signal: controleur.signal,
    // (29/10) Securite des bots : qui parle, et la prudence du tour.
    texteTitulaire: analyse.suspect ? rendreVisible(parts.titulaire) : parts.titulaire,
    derniereReponse,
    chatId,
    prudence: analyse.suspect ? analyse : null,
    sourceAlerte,
  })
  // Perdue face au filet, sa fin (ou son erreur) n'interesse plus personne.
  travail.catch(() => undefined)

  let reponse: ReponseAgent | 'delai'
  try {
    reponse = await Promise.race([travail, delai])
  } catch (err) {
    console.error('[cockpit/telegram]', err)
    // Une image refusee par l'API (poids, dimensions, format) : dit en clair.
    const texteErreur = image && erreurDImage(err) ? TEXTE_IMAGE_REFUSEE : TEXTE_ERREUR_AGENT
    await tgCockpit('sendMessage', { chat_id: chatId, text: enTete(texteErreur) })
    await ajouterReponseSeule(chatId, texteErreur, { echec: true })
    return 'traite'
  } finally {
    clearTimeout(filet)
    clearInterval(battement)
  }

  if (reponse === 'delai') {
    controleur.abort()
    console.error(`[cockpit/telegram] filet : aucune reponse ${Math.round((Date.now() - debut) / 1000)} s apres le debut du tour, echec dit en clair`)
    await tgCockpit('sendMessage', { chat_id: chatId, text: enTete(TEXTE_TEMPS_DEPASSE) })
    await ajouterReponseSeule(chatId, TEXTE_TEMPS_DEPASSE, { echec: true })
    return 'traite'
  }

  // Une base qui ne repond plus au moment d'ecrire la reponse : la route
  // rendait une erreur, Telegram rejouait, et le rejeu s'arretait sur la
  // question deja ecrite (doublon) : le silence. Dit en clair a la place.
  // (31/10) Un vocal : la reponse envoyee commence par « J'ai entendu », l'historique garde la reponse seule.
  try {
    await livrerReponse({ chatId, telegramId, updateId, majUpdate, garde }, entendu ? { ...reponse, reply: enTete(reponse.reply) } : reponse, reponse.reply)
  } catch (err) {
    console.error('[cockpit/telegram] reponse non enregistree', err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : '?')
    await tgCockpit('sendMessage', { chat_id: chatId, text: enTete(TEXTE_ERREUR_AGENT) })
    return 'traite'
  }

  // (29/10) « Reprends la demande de Mel » : le tour de Mel, dans SON fil,
  // APRES cette reponse, avec le temps qui reste a cette fonction. Une reprise
  // ne relance jamais elle-meme (pas de chaine).
  // (29/10) Meme chemin pour une question posee a l'autre et une reponse rapportee (executerRelanceEquipe).
  if (!e.reprise) {
    for (const r of reponse.relances ?? []) {
      try {
        await executerRelanceEquipe(r, { limite })
      } catch (err) {
        console.error('[cockpit/telegram] relance dans le fil d\'un membre de l\'equipe impossible',
          err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : '?')
      }
    }
  }
  return 'traite'
}

/**
 * (29/10) Reprend, dans le fil d'un membre de l'equipe, sa demande restee sans
 * reponse (outil reprendre_demande, appele depuis le fil d'un autre). Le tour
 * tourne pour LUI : son compte (verifie dans cockpit_telegram_comptes), ses
 * cartes, sa conversation. Rien en suspens = rien n'est fait. Jette si la base
 * ne repond pas.
 */
export async function reprendreDemandeEquipe(r: RelanceEquipe, o: { limite?: number } = {}): Promise<IssueAgentTelegram> {
  const compte = await compteCockpitTelegram(r.chatId)
  if (!compte) {
    console.warn('[cockpit/telegram] relance : ce compte n\'est plus dans cockpit_telegram_comptes, rien n\'est fait')
    return 'traite'
  }
  return tourAgent({
    chatId: r.chatId, telegramId: r.chatId, compte, updateId: null,
    texte: `[système] ${r.par} a demandé de reprendre ta demande restée sans réponse.`,
    reprise: { par: r.par }, limite: o.limite,
  })
}

/**
 * (29/10) Ce qui part apres la reponse d'un tour, dans le fil d'un membre de
 * l'equipe : une question qu'on lui pose, la reponse a sa question, ou la
 * reprise de sa demande restee sans reponse. Jette si la base ne repond pas.
 */
export async function executerRelanceEquipe(r: RelanceEquipe, o: { limite?: number } = {}): Promise<void> {
  if (r.question) { await poserQuestionEquipe(r, r.question); return }
  if (r.rapport) { await rapporterReponseEquipe(r, r.rapport); return }
  await reprendreDemandeEquipe(r, o)
}

/**
 * La question dans le fil de la personne interrogee (« Brice demande : ... »),
 * puis ses deux lignes d'historique (le marqueur, la question) : quand elle
 * repond, son tour voit la question et qui l'a posee. Rien ne part si son
 * compte n'est plus dans l'equipe ; un refus de Telegram est dit au demandeur.
 */
async function poserQuestionEquipe(r: RelanceEquipe, q: QuestionEquipe): Promise<void> {
  const compte = await compteCockpitTelegram(r.chatId)
  if (!compte) {
    await tgCockpit('sendMessage', { chat_id: q.parChat, text: `La question n'est pas partie : ${r.qui} n'est plus un compte de l'équipe sur Agent AOK.` })
    return
  }
  if (!await tgCockpit('sendMessage', { chat_id: r.chatId, text: texteQuestionEquipe(q) })) {
    await tgCockpit('sendMessage', {
      chat_id: q.parChat,
      text: `La question n'a pas pu partir chez ${r.qui} (Telegram l'a refusée : son fil avec Agent AOK n'est peut-être pas ouvert). Rien n'est enregistré chez ${r.qui}.`,
    })
    return
  }
  await ajouterAHistoriqueAgent(r.chatId, r.chatId, entreesQuestionEquipe(q))
}

/**
 * La reponse rapportee dans le fil de celui qui a pose la question, telle que
 * la personne l'a ecrite, puis la question fermee dans le fil de celle-ci
 * (ligne rapportQuestion, « [système] » : ni question ni reponse pour les
 * demandes en suspens).
 */
async function rapporterReponseEquipe(r: RelanceEquipe, p: NonNullable<RelanceEquipe['rapport']>): Promise<void> {
  const texte = texteRapportEquipe({ de: p.de, question: p.question, reponse: p.reponse }).slice(0, MAX_MESSAGE_LEN)
  if (!await tgCockpit('sendMessage', { chat_id: r.chatId, text: texte })) {
    await tgCockpit('sendMessage', { chat_id: p.deChat, text: `Ta réponse n'a pas pu partir chez ${r.qui} (Telegram l'a refusée) : redis-la-moi dans un instant.` })
    return
  }
  await ajouterAHistoriqueAgent(r.chatId, r.chatId, [
    { role: 'user', content: marqueurRapportEquipe(p.de), id: `r-${p.questionId}` },
    { role: 'assistant', content: texte, id: `r-${p.questionId}-texte` },
  ])
  await ajouterAHistoriqueAgent(p.deChat, p.deChat, [
    { role: 'assistant', content: `[système] Réponse transmise à ${r.qui}.`, id: `r-${p.questionId}-fermee`, rapportQuestion: p.questionId },
  ])
}

type ContexteLivraison = {
  chatId: number; telegramId: number; updateId: number | null; majUpdate: Prisma.Sql; garde: Prisma.Sql
}

/**
 * La reponse d'un tour : ecrite a l'historique (en ajout), puis envoyee,
 * coupee si elle est longue, la carte et ses boutons dans le dernier message.
 * Une reponse refusee par Telegram est dite en clair (signalerNonPartie).
 * (31/10) `replyHistorique` : ce que l'historique garde, quand la reponse
 * envoyee porte en plus la ligne « J'ai entendu » d'un vocal.
 */
async function livrerReponse(c: ContexteLivraison, reponse: ReponseAgent, replyHistorique: string = reponse.reply): Promise<void> {
  const { chatId, telegramId, updateId, majUpdate, garde } = c
  // La reponse de ce tour, seule (la question est deja en base). Un rejeu
  // Telegram du MEME update s'est arrete a l'ecriture de la question ; la
  // clause where de chaque upsert reste en ceinture. (29/10) Une reponse
  // partielle (temps) est marquee echec : la demande reste en suspens.
  const tour = JSON.stringify([
    { role: 'assistant', content: replyHistorique, ...(reponse.inacheve ? { echec: true as const } : {}) },
  ] satisfies MessageStocke[])

  if (reponse.action) {
    const { resume, cle_presente, cle_manquante, ...action } = reponse.action
    if (!cle_presente) {
      await prisma.$executeRaw`
        insert into public.cockpit_agent_conversations as c (chat_id, telegram_id, messages, dernier_update_id)
        values (${chatId}, ${telegramId}, ${tour}::jsonb, ${updateId})
        on conflict (chat_id) do update
        set messages = ${HISTORIQUE_UPSERT},
            dernier_update_id = ${majUpdate}, maj_le = now()
        where ${garde}`
      const carte = `⚠️ ${resume}\n\n${cle_manquante
        ?? `La clé d'écriture du compte ${action.compte} n'est pas posée : rien ne peut être exécuté.`}`
      if (!await envoyerMessages(chatId, messagesAvecCarte(reponse.reply, carte))) await signalerNonPartie(chatId)
      return
    }

    // Verrou 3 : l'action attend le POUCE. Le nonce lie les boutons de CE
    // message a CETTE action ; une nouvelle proposition remplace l'ancienne.
    const nonce = randomUUID().slice(0, 8)
    await prisma.$executeRaw`
      insert into public.cockpit_agent_conversations as c
        (chat_id, telegram_id, messages, action_en_attente, nonce, dernier_update_id)
      values (${chatId}, ${telegramId}, ${tour}::jsonb,
              ${JSON.stringify(action)}::jsonb, ${nonce}, ${updateId})
      on conflict (chat_id) do update
      set messages = ${HISTORIQUE_UPSERT}, action_en_attente = excluded.action_en_attente,
          nonce = excluded.nonce,
          dernier_update_id = ${majUpdate}, maj_le = now()
      where ${garde}`
    // (29/10) Le bouton dit l'action precise (Brice : « un bouton a un clic,
    // avec un libelle qui dit l'action »), plus « Confirmer et exécuter ».
    const boutons = {
      inline_keyboard: [[
        { text: libelleBoutonConfirmer(action.type), callback_data: `ok:${nonce}` },
        { text: '❌ Annuler', callback_data: `non:${nonce}` },
      ]],
    }
    if (!await envoyerMessages(chatId, messagesAvecCarte(reponse.reply, `⚠️ ${resume}`), boutons)) await signalerNonPartie(chatId)
    return
  }

  await prisma.$executeRaw`
    insert into public.cockpit_agent_conversations as c (chat_id, telegram_id, messages, dernier_update_id)
    values (${chatId}, ${telegramId}, ${tour}::jsonb, ${updateId})
    on conflict (chat_id) do update
    set messages = ${HISTORIQUE_UPSERT}, action_en_attente = null, nonce = null,
        dernier_update_id = ${majUpdate}, maj_le = now()
    where ${garde}`
  if (!await envoyerMessages(chatId, decouperMessage(reponse.reply))) await signalerNonPartie(chatId)
}
