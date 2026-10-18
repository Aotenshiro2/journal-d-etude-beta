// L'OUTIL generer_post DE L'AGENT AOK (19/10/2026) : le generateur de posts
// de l'onglet Creation, depuis Telegram (ou la fenetre de l'agent). Brice ou
// Mel envoient une idee ou une capture, l'agent pose les questions manquantes
// puis appelle cet outil, qui passe par la MEME fonction que l'ecran
// (genererPost) et range le brouillon dans cockpit_generations.
//
// Rien n'est poste nulle part : le resultat revient a l'agent, qui recopie le
// brouillon dans sa reponse pour qu'on le copie-colle. La capture est la
// derniere piece recue dans la conversation (canal.piece), telechargee avec
// le jeton du bot qui l'a recue, jamais stockee.

import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { telechargerFichierTelegram } from '@/lib/liveclub/telegram'
import { MAX_OCTETS_IMAGE, typeImageDepuisOctets } from '@/lib/agent-cockpit-telegram-pur'
import { OBJECTIFS, lireDemandeGeneration, lirePersonne } from '@/lib/generation-pur'
import { genererPost, type OrigineGeneration } from '@/lib/generation'
import type { PieceAgent } from '@/lib/liveclub/support-pont-pur'

export const OUTIL_GENERER_POST: Anthropic.Tool = {
  name: 'generer_post',
  description:
    "Écrit un BROUILLON de post (Live Club, canal MELMOM, Skool, newsletter, réseau social) dans la voix de Brice ou de Mel, à partir d'une idée (sens idee) ou de la dernière capture reçue dans la conversation (sens capture). Rien n'est publié ni envoyé : le brouillon revient ici et se copie-colle. Sans carte. AVANT d'appeler : il faut le canal cible et l'objectif ; pour une capture, demande en une seule fois ce qui manque parmi le sujet à enseigner (un mot), le biais du jour, le trade pris et son résultat, posté en direct ou en relecture (l'actif, l'unité de temps et la date seulement si le filigrane TradingView n'est pas lisible). Le vécu ne s'invente pas : s'il manque, l'outil le demande dans « questions ».",
  input_schema: {
    type: 'object',
    properties: {
      personne: { type: 'string', enum: ['brice', 'mel'], description: 'Qui signe le post. Vide = ton interlocuteur.' },
      canal: {
        type: 'string',
        description: "Le canal cible, tel qu'il est nommé dans la base : « Live club / Mindset », « Live club / Explication charts. », « MELMOM | ICT Trading », « Skool (communauté) », « Newsletter (Kit) », ou un autre (réseau social, en clair).",
      },
      objectif: { type: 'string', enum: [...OBJECTIFS] },
      sens: { type: 'string', enum: ['idee', 'capture'] },
      idee: { type: 'string', description: "L'idée, le sujet ou la source, avec les mots de ton interlocuteur." },
      sujet: { type: 'string', description: 'Le sujet à enseigner, en un mot ou deux.' },
      biais: { type: 'string', description: 'Le biais du jour.' },
      trade: { type: 'string', description: 'Le trade pris et son résultat (ou « pas de trade »).' },
      moment: { type: 'string', enum: ['direct', 'relecture'] },
      actif: { type: 'string', description: "Actif, unité de temps, date : seulement si la capture ne les montre pas." },
      retoucher: { type: 'string', description: "L'identifiant (generation_id) d'un brouillon déjà rendu, pour le régénérer ou le retoucher." },
      consigne: { type: 'string', description: 'Avec retoucher : ce qu\'il faut changer. Sans consigne, retoucher = une autre version.' },
    },
    required: ['canal', 'objectif', 'sens'],
  },
}

const erreur = (texte: string) => JSON.stringify({ erreur: texte })

/** Le resultat de l'outil, en JSON pour le modele. Ne jette pas. */
export async function genererPostPourAgent(
  entree: unknown,
  userId: string,
  origine: OrigineGeneration,
  piece: PieceAgent | null,
): Promise<{ contenu: string; erreur: boolean }> {
  const e = (typeof entree === 'object' && entree !== null ? entree : {}) as Record<string, unknown>

  let personne = lirePersonne(e.personne)
  if (!personne) {
    const [l] = await prisma.$queryRaw<{ label: string | null }[]>`
      select label from public.cockpit_allowlist where user_id = ${userId}::uuid limit 1`
    personne = lirePersonne(l?.label ?? null)
  }
  if (!personne) return { contenu: erreur('Qui signe ce post, Brice ou Mel ? Redemande-le avant de rappeler l\'outil.'), erreur: true }

  let image: { media_type: string; data: string } | null = null
  if (e.sens === 'capture') {
    if (!piece) {
      return { contenu: erreur("Aucune capture dans les derniers messages : demande qu'on l'envoie en photo sur Telegram (ou dans l'écran Génération du Cockpit)."), erreur: true }
    }
    const issue = await telechargerFichierTelegram(piece.bot, piece.file_id, MAX_OCTETS_IMAGE, piece.taille)
    if (!issue.ok) {
      return {
        contenu: erreur(issue.raison === 'trop_gros' ? 'La capture est trop lourde : demande-la en photo (compressée par Telegram).' : 'La capture est illisible chez Telegram : demande qu\'on la renvoie.'),
        erreur: true,
      }
    }
    const type = typeImageDepuisOctets(issue.octets)
    if (!type) return { contenu: erreur('La dernière pièce reçue n\'est pas une image (JPEG, PNG ou WEBP).'), erreur: true }
    image = { media_type: type, data: Buffer.from(issue.octets).toString('base64') }
  }

  const demande = lireDemandeGeneration({
    personne,
    canal: e.canal,
    objectif: e.objectif,
    sens: e.sens,
    idee: e.idee,
    reponses: { sujet: e.sujet, biais: e.biais, trade: e.trade, moment: e.moment, actif: e.actif },
    image,
    parent_id: e.retoucher,
    consigne: e.consigne,
  })
  if (typeof demande === 'string') return { contenu: erreur(demande), erreur: true }

  const r = await genererPost(demande, userId, origine)
  if (!r.ok) return { contenu: erreur(r.erreur), erreur: true }
  return {
    contenu: JSON.stringify({
      generation_id: r.id,
      brouillon: r.contenu.brouillon,
      format: r.contenu.format,
      lecture: r.contenu.lecture,
      chart: r.contenu.chart,
      debordement: r.contenu.debordement,
      questions: r.contenu.questions,
      risques: r.contenu.risques,
      inspirations: r.contenu.inspirations,
      sources: r.contenu.sources,
      a_faire: "Recopie le brouillon TEL QUEL, sans y toucher, entre deux lignes vides, puis en dessous et en peu de mots : la lecture (capture), le chart à joindre, le débordement, les questions et les risques s'il y en a. Ne poste rien, nulle part. Rangé dans le Cockpit (onglet Création, Génération) pour la note.",
    }),
    erreur: false,
  }
}
