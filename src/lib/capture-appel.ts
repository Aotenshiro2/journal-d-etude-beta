// Montage et exécution d'un appel de capture. Commun aux deux temps
// (secrétaire et étude) pour que les deux routes ne divergent jamais sur les
// détails qui comptent : placement du cache, gestion de l'image, effort.
import type Anthropic from '@anthropic-ai/sdk'
import { aiClient, AI_MODEL, logAiUsage, textOf, type AiProduct } from './ai'
import {
  SOCLE_SECRETAIRE, SOCLE_ETUDE, cadrePour,
  SCHEMA_SECRETAIRE, SCHEMA_ETUDE, type Famille,
} from './capture-prompts'

/** Haiku 4.5 REFUSE output_config.effort (400). Les modèles 5 l'acceptent.
 *  Ne pas tester sur une liste de modèles autorisés : une variable d'env peut
 *  poser n'importe quoi, et un 400 en production sur un nom inattendu serait
 *  une panne pour un réglage de confort. */
function accepteEffort(modele: string): boolean {
  return !/haiku/i.test(modele)
}

/** Une image de capture arrive soit en data URL (juste après captureVisibleTab,
 *  avant tout envoi), soit en URL publique Supabase (note déjà synchronisée). */
function blocImage(image: string): Anthropic.ImageBlockParam | null {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i.exec(image.trim())
  if (m) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: m[1] as 'image/jpeg', data: m[2] },
    }
  }
  if (/^https:\/\//i.test(image.trim())) {
    return { type: 'image', source: { type: 'url', url: image.trim() } }
  }
  return null
}

export interface DemandeCapture {
  userId: string
  niveau: string
  famille: Famille
  temps: 'secretaire' | 'etude'
  /** texte de la page, déjà borné par l'appelant */
  contenu: string
  /** data URL ou URL publique du screenshot, si la famille le justifie */
  image?: string | null
  /** modèle imposé par l'appelant, DÉJÀ VALIDÉ contre le palier. Sert au
   *  sélecteur de l'écran « Configurer son IA ». Absent = modèle du produit. */
  modele?: string | null
}

export interface ResultatCapture<T> {
  sortie: T
  modele: string
  /** vrai si l'image a bien été jointe */
  avecImage: boolean
}

/** Plafond dur sur le texte envoyé. Une page monstrueuse ne doit jamais
 *  pouvoir manger une part disproportionnée du budget d'un membre en un appel.
 *  Les stratégies de l'extension envoient du contenu déjà trié : au-delà de
 *  cette taille, c'est que le tri a échoué, pas que la page est riche. */
export const MAX_CARACTERES_CONTENU = 12_000

export async function appelerCapture<T>(d: DemandeCapture): Promise<ResultatCapture<T>> {
  const secretaire = d.temps === 'secretaire'
  const produit: AiProduct = secretaire ? 'capture' : 'etude'
  const modele = d.modele ?? AI_MODEL[produit]
  const client = aiClient(produit)

  const bloc: Anthropic.ContentBlockParam[] = []
  const img = d.image ? blocImage(d.image) : null
  if (img) bloc.push(img)
  bloc.push({ type: 'text', text: d.contenu.slice(0, MAX_CARACTERES_CONTENU) })

  const output_config: Record<string, unknown> = {
    format: { type: 'json_schema', schema: secretaire ? SCHEMA_SECRETAIRE : SCHEMA_ETUDE },
  }
  // Extraction et lecture courte : de la profondeur de réflexion en plus ne
  // change pas la sortie, mais les jetons de réflexion sont facturés en sortie,
  // c'est-à-dire cinq fois le prix de l'entrée.
  if (accepteEffort(modele)) output_config.effort = 'low'

  const reponse = await client.messages.create({
    model: modele,
    max_tokens: secretaire ? 2000 : 4096,
    system: [
      // Le socle est identique d'un appel à l'autre : c'est lui qu'on met en
      // cache. Le cadre, qui varie par famille, passe APRÈS le point de cache.
      { type: 'text', text: secretaire ? SOCLE_SECRETAIRE : SOCLE_ETUDE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: cadrePour(d.famille, d.temps) },
    ],
    messages: [{ role: 'user', content: bloc }],
    output_config,
  } as Anthropic.MessageCreateParamsNonStreaming)

  await logAiUsage(d.userId, produit, modele, reponse.usage, d.niveau)

  const brut = textOf(reponse)
  if (!brut) throw new Error('Réponse vide du modèle.')
  return { sortie: JSON.parse(brut) as T, modele, avecImage: Boolean(img) }
}
