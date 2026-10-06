// L'AGENT du bot Live Club (29/09) : Claude Haiku 4.5 repond en prive aux
// membres RATTACHES a un abonnement, et (06/10) aux comptes non rattaches dont
// l'acces est offert sans abonnement (exemption, acces broker, acces manuel :
// leurs outils rendent cette situation, avec CONSIGNE_ACCES_OFFERT, et leurs
// propositions sont refusees, rien a gerer). Il lit leur abonnement et PROPOSE une
// pause, un arret ou l'annulation d'un arret ; il n'execute rien. La boucle
// s'arrete a la premiere proposition valide, et c'est le bouton de
// confirmation du membre (nonce consomme en base) qui execute, sans modele.
//
// OUTILS FERMES : aucun ne prend d'identifiant. L'identite est le telegram_id
// de l'update, passe par le serveur ; le modele ne peut donc lire ni toucher
// l'abonnement de quelqu'un d'autre, quoi qu'on lui ecrive. Aucun outil de
// promo, de remboursement, de code ni de changement de prix, et aucun ne lit
// les coupons ou codes promotionnels Stripe (verifie le 30/09 : mon_abonnement
// rend statut et dates ; mes_montants, du 30/09, des montants deja mis en
// forme, un booleen « remise », des dates et le lien de paiement d'une facture
// ouverte : ni identifiant Stripe, ni code, ni nom de coupon, voir
// faitsMontants dans pur.ts). Les liens partenaires et les liens utiles PUBLIES sont
// dans le prompt, via src/lib/politique-information.ts (30/09) ; le modele
// n'en cree aucun. demander_un_humain (29/09,
// decision 5) ne touche a rien : il leve le drapeau veutHumain, et c'est le
// bot qui fait passer le fil en « veut un humain » dans l'ecran Support.
//
// Le coeur du bot (entrees, sorties, execution) ne depend jamais d'ici : si
// l'IA echoue ou si le plafond du jour est atteint, la route bascule sur le
// menu a boutons.
//
// Cle (convention du 28/08, cf. ai.ts) : un produit = une variable d'env.
// ANTHROPIC_API_KEY_LIVECLUB, repli sur ANTHROPIC_API_KEY_SUPPORT tant que le
// workspace dedie n'existe pas.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { textOf } from '@/lib/ai'
import { coutMicroEuros } from '@/lib/ia-prix'
import { expurgerLiensInvitation } from '@/lib/stripe-actions'
import { filtrerSortie } from '@/lib/politique-information'
import { TEXTE_PAUSE_AVANT_ARRET } from './config'
import { montantsDuMembre, preparerAction, situationDuMembre } from './actions-membre'
import type { ActionMembre, MessageConserve } from './conversations'
import { messageErreur, pauseDejaProposee } from './pur'
import {
  CONSIGNE_ACCES_OFFERT, CONSIGNE_EQUIPE_TRANSMISE, CONSIGNE_MONTANTS, MODELE_LIVECLUB, RESULTAT_DEMANDER_UN_HUMAIN, requeteAgentMembre,
} from './prompt-membre'

export { MODELE_LIVECLUB }

const KEY_ENV = 'ANTHROPIC_API_KEY_LIVECLUB'
const KEY_ENV_REPLI = 'ANTHROPIC_API_KEY_SUPPORT'

const MAX_TOURS = 4

/**
 * Stripe ou la base illisibles pour un outil de lecture : reessayer, ou
 * transmettre a l'equipe s'il lui faut une reponse (pas d'adresse email :
 * Brice, 30/09 ; le bot ajoute support@ lui-meme si le pont est en panne).
 */
const ILLISIBLE = "Abonnement illisible pour le moment : propose de réessayer dans un moment, ou, s'il a besoin d'une réponse maintenant, de prévenir l'équipe (demander_un_humain), qui lui répondra ici."

/** L'agent n'a pas abouti : l'equipe est prevenue (veutHumain), le menu reste la. */
const TEXTE_SANS_REPONSE = `Je n'ai pas de réponse sûre là-dessus, donc je préviens l'équipe : quelqu'un va te répondre ici, dans cette conversation. En attendant, le menu est là :`

export function cleAgentMembre(): string | null {
  return process.env[KEY_ENV]?.trim() || process.env[KEY_ENV_REPLI]?.trim() || null
}

function clientAgent(): Anthropic {
  const apiKey = cleAgentMembre()
  if (!apiKey) throw new Error(`Cle API absente : pose ${KEY_ENV} (ou ${KEY_ENV_REPLI}) dans les variables d'environnement Vercel.`)
  return new Anthropic({ apiKey })
}

// Le prompt, les outils et la requete : ./prompt-membre.ts (module pur, rejoue par scripts/eval-fuites.mjs).

const TYPE_PAR_OUTIL: Record<string, ActionMembre['type']> = {
  proposer_pause: 'pause',
  proposer_arret: 'arret',
  proposer_annuler_arret: 'annuler_arret',
}

export type ReponseAgentMembre = {
  /** Texte a envoyer au membre. */
  texte: string
  /** Presente = une action attend le clic du membre ; `texte` contient deja la phrase de confirmation du serveur. */
  action?: Omit<ActionMembre, 'expire'>
  /** Vrai = l'agent n'a pas abouti (tours epuises, reponse vide) : la route joint le menu a boutons. */
  repli?: true
  /**
   * Vrai = le membre demande l'arret et `texte` lui propose d'abord la pause
   * (TEXTE_PAUSE_AVANT_ARRET) : aucune action posee, la route joint
   * clavierPauseAvantArret().
   */
  pauseAvantArret?: true
  /**
   * Vrai = le fil passe en « veut un humain » dans l'ecran Support du
   * cockpit : l'agent a appele demander_un_humain, ou il n'a pas abouti.
   */
  veutHumain?: true
}

/**
 * Historique conserve -> messages de l'API : alternance stricte, premier
 * message utilisateur (deux messages de meme role a la suite sont fusionnes,
 * un assistant en tete est ecarte).
 */
function versMessages(historique: MessageConserve[], question: string): Anthropic.MessageParam[] {
  const brut = [...historique.map(m => ({ role: m.role, content: m.content })), { role: 'user' as const, content: question }]
  const sortie: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of brut) {
    if (!m.content.trim()) continue
    if (sortie.length === 0 && m.role !== 'user') continue
    const dernier = sortie[sortie.length - 1]
    if (dernier && dernier.role === m.role) dernier.content = `${dernier.content}\n\n${m.content}`
    else sortie.push({ ...m })
  }
  return sortie
}

/** Grille de prix : l'id date de Haiku 4.5 est facture comme claude-haiku-4-5. */
function modeleGrille(modele: string): string {
  return modele.startsWith('claude-haiku-4-5') ? 'claude-haiku-4-5' : modele
}

/**
 * Trace l'usage dans AiUsage (produit 'liveclub'), best effort. L'utilisateur
 * est 'liveclub:u<telegram_id>' : un membre du groupe n'a pas forcement de
 * compte AOK.
 */
async function tracerUsage(telegramId: number, usage: Anthropic.Usage): Promise<void> {
  try {
    await prisma.aiUsage.create({
      data: {
        userId: `liveclub:u${telegramId}`,
        product: 'liveclub',
        model: MODELE_LIVECLUB,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        costMicros: coutMicroEuros(modeleGrille(MODELE_LIVECLUB), usage),
      },
    })
  } catch (err) {
    console.warn(`[liveclub/agent] usage non trace : ${messageErreur(err)}`)
  }
}

/**
 * La boucle question -> outils -> reponse, pour le membre `telegramId` (deja
 * verifie RATTACHE, ou a acces offert sans rattachement, par la route). Jette sur une erreur d'API ou une cle
 * absente : la route bascule alors sur le menu a boutons.
 */
export async function repondreAuMembre(
  telegramId: number,
  historique: MessageConserve[],
  question: string,
  /** (06/10) Acces offert sans rattachement : contexteAccesOffert (prompt-membre.ts). */
  o: { contexte?: string } = {},
): Promise<ReponseAgentMembre> {
  const client = clientAgent()
  const messages = versMessages(historique, question)
  // demander_un_humain appele pendant la boucle : le drapeau suit la reponse.
  let humain = false
  const drapeau = (): { veutHumain?: true } => (humain ? { veutHumain: true } : {})
  // Filet de sortie (politique d'information, 30/09) : liens d'invitation,
  // emails et telephones que le membre n'a pas ecrits lui-meme.
  const textesDuMembre = [question, ...historique.filter(m => m.role === 'user').map(m => m.content)]
  const nettoyer = (brut: string): string => {
    const f = filtrerSortie(expurgerLiensInvitation(brut), textesDuMembre)
    if (f.retraits) console.warn(`[liveclub/agent] ${f.retraits} donnee(s) retiree(s) de la reponse pour u${telegramId}`)
    return f.texte
  }

  for (let tour = 0; tour < MAX_TOURS; tour++) {
    const response = await client.messages.create(requeteAgentMembre(messages, o.contexte))
    await tracerUsage(telegramId, response.usage)

    if (response.stop_reason !== 'tool_use') {
      const texte = nettoyer(textOf(response))
      return texte
        ? { texte, ...drapeau() }
        : { texte: TEXTE_SANS_REPONSE, repli: true, veutHumain: true }
    }

    messages.push({ role: 'assistant', content: response.content })
    const resultats: Anthropic.ToolResultBlockParam[] = []
    for (const bloc of response.content) {
      if (bloc.type !== 'tool_use') continue

      if (bloc.name === 'demander_un_humain') {
        humain = true
        resultats.push({
          type: 'tool_result', tool_use_id: bloc.id,
          content: JSON.stringify(RESULTAT_DEMANDER_UN_HUMAIN),
        })
        continue
      }

      if (bloc.name === 'mon_abonnement') {
        const s = await situationDuMembre(telegramId)
        const contenu = s.etat === 'ok'
          ? { situation: s.texte, faits: s.faits, ...(s.accesOffert ? { consigne: CONSIGNE_ACCES_OFFERT } : {}) }
          : s.etat === 'non_rattache'
            ? { erreur: 'Compte Telegram lie a aucun abonnement.' }
            : { erreur: ILLISIBLE }
        resultats.push({ type: 'tool_result', tool_use_id: bloc.id, content: JSON.stringify(contenu) })
        continue
      }

      // Les montants du membre qui ecrit (Brice, 30/09), et de lui seul.
      if (bloc.name === 'mes_montants') {
        const m = await montantsDuMembre(telegramId)
        const contenu = m.etat === 'ok'
          ? { montants: m.faits, consigne: CONSIGNE_MONTANTS }
          : m.etat === 'acces_offert'
            ? { rien_a_payer: true, situation: m.texte, consigne: CONSIGNE_ACCES_OFFERT }
            : m.etat === 'non_rattache'
              ? { erreur: 'Compte Telegram lie a aucun abonnement.' }
              : { erreur: ILLISIBLE }
        resultats.push({ type: 'tool_result', tool_use_id: bloc.id, content: JSON.stringify(contenu) })
        continue
      }

      const type = TYPE_PAR_OUTIL[bloc.name]
      if (!type) {
        resultats.push({ type: 'tool_result', tool_use_id: bloc.id, content: JSON.stringify({ erreur: 'Outil inconnu.' }), is_error: true })
        continue
      }
      // Le nombre de mois vient du modele : il est revalide par preparerAction
      // (entier 1 a 6), comme tout ce qui sort d'un texte.
      const nbMois = type === 'pause' ? Number((bloc.input as { nb_mois?: unknown })?.nb_mois) : undefined
      const prep = await preparerAction(telegramId, type, nbMois)
      if (!prep.ok) {
        // Seule l'equipe peut le faire (plusieurs abonnements, pause a
        // changer, paiement en retard) : l'agent transmet lui-meme (Brice,
        // 30/09), au lieu de donner une adresse email.
        if (prep.equipe) humain = true
        const contenu = prep.equipe ? { refus: prep.raison, equipe_prevenue: true, consigne: CONSIGNE_EQUIPE_TRANSMISE } : { refus: prep.raison }
        resultats.push({ type: 'tool_result', tool_use_id: bloc.id, content: JSON.stringify(contenu) })
        continue
      }
      // Proposition valide : la boucle s'arrete. La phrase de confirmation est
      // celle du SERVEUR (ce qui sera vraiment fait), pas celle du modele.
      const avant = nettoyer(textOf(response))
      // Arret (Brice, 30/09) : la premiere fois, la pause d'abord, avec
      // l'argument du tarif et les boutons du menu, sans action posee. Deja
      // proposee (historique, ou le texte du modele juste avant) : la
      // confirmation, sans insister.
      const vu = avant ? [...historique, { role: 'assistant' as const, content: avant }] : historique
      if (type === 'arret' && prep.pausePossible && !pauseDejaProposee(vu)) {
        return { texte: avant ? `${avant}\n\n${TEXTE_PAUSE_AVANT_ARRET}` : TEXTE_PAUSE_AVANT_ARRET, pauseAvantArret: true, ...drapeau() }
      }
      return { texte: avant ? `${avant}\n\n${prep.resume}` : prep.resume, action: prep.action, ...drapeau() }
    }
    messages.push({ role: 'user', content: resultats })
  }
  return { texte: TEXTE_SANS_REPONSE, repli: true, veutHumain: true }
}
