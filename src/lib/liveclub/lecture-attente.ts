// (22/10, Brice) Lire le SENS d'un message ecrit pendant l'attente d'un humain.
//
// Le fil du bot des membres attend l'equipe, qui n'a pas encore repondu, et
// le membre ecrit. Avant, le bot repondait a l'aveugle « J'ai transmis ton
// message a l'equipe », meme a « tout est good, c'était un accident ». Ici, un
// appel court a Haiku dit si le message ANNULE la demande (« annule ») ou non
// (« autre »). La consigne, la requete et la lecture de la sortie sont pures
// (support-pont-pur.ts, CONSIGNE_LECTURE_ATTENTE) ; bot-membre.ts decide.
//
// Pourquoi un appel dedie et pas l'agent des membres : l'agent porte un prompt
// de 4 400 jetons, des outils et des gestes ; le detourner pour classer
// demanderait de toucher son prompt (evals). Ici, une consigne fermee, le fil
// recent en contexte (6 messages), un mot en sortie : environ 470 jetons
// d'entree et 5 de sortie (mesure du 22/10, scripts/eval-lecture-attente.mjs),
// soit autour de 0,05 centime par message, et 0,5 a 1,5 s de plus, seulement
// quand le fil attend un humain et que le membre ecrit. Le modele ne peut
// qu'une chose : faire annuler la demande du membre qui ecrit.
//
// Panne (cle absente, erreur, delai depasse, sortie illisible) : null, que
// decisionEnAttente traite comme « autre » : on transmet sans rien annuler.
// Aucun texte de message dans un log. L'usage va a AiUsage, poste
// liveclub_membre (le bot des membres), comme l'agent.

import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { textOf } from '@/lib/ai'
import { coutMicroEuros } from '@/lib/ia-prix'
import { cleAgentMembre } from './agent-membre'
import { MODELE_LIVECLUB } from './prompt-membre'
import { messageErreur } from './pur'
import { lireSensEnAttente, requeteLectureAttente, type SensEnAttente } from './support-pont-pur'
import { analyserTexte } from '@/lib/securite/injection-pur'
import { alerterBriceSecurite } from '@/lib/securite/alerte'

/** Au-dela, on n'attend plus : le membre attend sa reponse, et la panne transmet sans rien annuler. */
export const DELAI_LECTURE_ATTENTE_MS = 6000

/** Grille de prix : l'id date de Haiku 4.5 est facture comme claude-haiku-4-5 (comme agent-membre.ts). */
function modeleGrille(modele: string): string {
  return modele.startsWith('claude-haiku-4-5') ? 'claude-haiku-4-5' : modele
}

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
        usage: 'liveclub_membre',
        echange: randomUUID(),
      },
    })
  } catch (err) {
    console.warn(`[liveclub/lecture-attente] usage non trace : ${messageErreur(err)}`)
  }
}

/**
 * Le sens du message `texte` que le membre vient d'ecrire pendant l'attente
 * (`fil` : les messages du fil, lus apres l'ajout du sien). null = panne ou
 * sortie illisible. Ne jette jamais.
 */
export async function lireSensEnAttenteIA(telegramId: number, texte: string, fil: unknown): Promise<SensEnAttente | null> {
  // (29/10, securite des bots) Un message suspect (texte cache, consigne a une
  // IA) n'est pas lu par le modele : il ne peut rien annuler, il est transmis
  // tel quel a l'equipe (null = « autre »), et Brice est prevenu.
  const analyse = analyserTexte(texte, { niveau: 'injection' })
  if (analyse.suspect) {
    await alerterBriceSecurite({
      source: 'bot Live Club, message d\'un membre pendant l\'attente de l\'équipe', qui: `u${telegramId}`, analyse,
      suite: "Rien n'a été annulé ni lu par l'IA : le message est transmis à l'équipe dans son fil Support.",
    })
    return null
  }
  const apiKey = cleAgentMembre()
  if (!apiKey) {
    console.warn('[liveclub/lecture-attente] cle API absente : message transmis sans lecture')
    return null
  }
  try {
    const client = new Anthropic({ apiKey, timeout: DELAI_LECTURE_ATTENTE_MS, maxRetries: 0 })
    const reponse = await client.messages.create(requeteLectureAttente(MODELE_LIVECLUB, fil, texte))
    await tracerUsage(telegramId, reponse.usage)
    const sens = lireSensEnAttente(textOf(reponse))
    if (!sens) console.warn(`[liveclub/lecture-attente] sortie illisible pour u${telegramId} : message transmis`)
    return sens
  } catch (err) {
    console.warn(`[liveclub/lecture-attente] lecture impossible pour u${telegramId} : ${messageErreur(err)}`)
    return null
  }
}
