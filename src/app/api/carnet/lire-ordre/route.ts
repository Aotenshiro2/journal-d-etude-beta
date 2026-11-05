import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { quotaDuMembre } from '@/lib/pilotage-niveau'
import { MESSAGE_LECTURES_EPUISEES, apresUneLecture, quotaDe } from '@/lib/pilotage-paliers'
import { OCTETS_MAX_CORPS_ORDRE, lireImageOrdre, reponseLireOrdre } from '@/lib/lire-ordre-pur'
import { lireOrdreParIA } from '@/lib/lire-ordre-serveur'

// Une image lue par l'IA : quelques secondes, au-delà des 10 s par défaut par prudence.
export const maxDuration = 60

/**
 * POST /api/carnet/lire-ordre : « Lire une capture » du Carnet du Trader
 * (1.8.14, brief C5 du 05/11/2026). Le membre dépose une capture de son
 * ticket d'ordre (panneau d'ordre de TradingView, outil Position) ; l'IA en
 * lit le sens, le type d'ordre, l'entrée, le stop, le TP, la taille, le
 * risque, les partiels et l'instrument ; le Carnet remplit la carte et le
 * membre enregistre. Rien n'est écrit ici, et la capture n'est pas gardée.
 *
 * Route DÉDIÉE plutôt qu'un type de plus dans /api/pilotage/documents/lire :
 * celle-là est le dépôt de Pilotage (lecteurs sans IA d'abord, 8 types de
 * documents, empreintes, rapprochement des comptes, coffre), et une saisie du
 * Carnet ne doit jamais devenir un fait de Pilotage. Ici : une consigne et un
 * outil propres au ticket, une réponse à la forme de la carte, et le MÊME
 * moteur (lire-ordre-serveur.ts : produit 'pilotage', même modèle) et le MÊME
 * compteur (une ligne AiUsage au poste 'document', quotaDuMembre).
 *
 * Authentification et CORS comme les autres routes du Carnet (getUserId,
 * Bearer). POST { image: data URL } (ou { data, type }) rend
 * { lecture: { sens, typeOrdre, entree, stop, tp, taille, risque, partiels,
 * instrument, confiance, remarque }, quota }, chaque champ null s'il n'est pas
 * lisible. 401 ; 400 (pas une image) ; 413 (trop lourde) ; 429 { error, quota }
 * quand les lectures du palier sont épuisées ; 502, 503, 504 si l'IA ne répond
 * pas (rien n'est compté).
 */

const METHODES = 'POST, OPTIONS'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Non connecté.' }, { status: 401, headers: cors })

  const trop = NextResponse.json(
    { error: "Capture trop lourde (4,4 Mo au plus) : réduis-la, ou recadre-la sur le panneau d'ordre." },
    { status: 413, headers: cors },
  )
  if (Number(req.headers.get('content-length') ?? 0) > OCTETS_MAX_CORPS_ORDRE) return trop
  const body = await req.json().catch(() => null)
  const image = lireImageOrdre(body)
  if (!image.ok) return image.statut === 413 ? trop : NextResponse.json({ error: image.erreur }, { status: image.statut, headers: cors })

  try {
    const etat = await quotaDuMembre(userId)
    if (!etat.autorise) return NextResponse.json({ error: MESSAGE_LECTURES_EPUISEES, quota: etat.quota }, { status: 429, headers: cors })
    const lu = await lireOrdreParIA(userId, image.media, image.data)
    if ('erreur' in lu) {
      return NextResponse.json(
        { error: lu.erreur, quota: etat.quota, ...(lu.indisponible ? { indisponible: true } : {}) },
        { status: lu.statut, headers: cors },
      )
    }
    const quota = quotaDe(apresUneLecture({ ...etat.entree, maintenant: new Date() }), etat.palier)
    console.log(`[carnet/lire-ordre] ${etat.palier}, confiance ${lu.lecture.confiance}`)
    return NextResponse.json(reponseLireOrdre(lu.lecture, quota), { headers: cors })
  } catch (err) {
    console.error('[carnet/lire-ordre]', err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : err)
    return NextResponse.json({ error: 'Lecture impossible pour le moment, réessaie.' }, { status: 500, headers: cors })
  }
}
