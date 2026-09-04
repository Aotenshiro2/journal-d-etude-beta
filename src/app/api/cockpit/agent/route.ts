import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { aiErrorMessage } from '@/lib/ai'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { boucleAgent } from '@/lib/agent-cockpit'
import type Anthropic from '@anthropic-ai/sdk'

// Le canal WEB de l'agent cockpit : la fenetre flottante ✦. Le cerveau
// (prompt, outils, boucle) vit dans src/lib/agent-cockpit.ts, partage avec le
// bot Telegram — cette route ne garde que ce qui est propre au web :
// l'authentification Bearer + allowlist, et les pieces jointes.
//
// PIECES JOINTES (30/08) : on peut deposer un PDF, une capture ou un export.
// Meme moteur de lecture que /api/pilotage/releve — PDF et image en blocs
// natifs, tout le reste decode en texte — mais ici le document ne remplace
// pas la base, il s'y CONFRONTE : le cas d'usage est le releve d'Adil ou
// l'export Stripe qu'on veut rapprocher de cockpit_paiements.

export const maxDuration = 120

const MAX_HISTORY = 20
const MAX_MESSAGE_LEN = 4000

// Le corps d'une fonction Vercel est borne a 4,5 Mo, et le base64 pese un
// tiers de plus que le fichier sur le disque. On garde de la marge pour
// l'historique texte et les entetes.
const TYPES_IMAGE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_PIECE = 3_200_000
const MAX_PIECES_TOTAL = 3_600_000
const MAX_PIECES_PAR_MESSAGE = 4
const MAX_TEXTE_FICHIER = 200_000

type PieceEntrante = { nom?: unknown; type?: unknown; data?: unknown }
type MessageEntrant = { role?: unknown; content?: unknown; pieces?: unknown }

/**
 * Transforme une piece jointe du front en bloc pour l'API.
 *
 * LE FRONT N'ENVOIE JAMAIS DE BLOC TOUT FAIT : il envoie un nom, un type MIME
 * et du base64, et c'est ici qu'on decide de la forme. Un client bricole ne
 * peut donc pas fabriquer un bloc arbitraire, ni faire pointer une source vers
 * une URL distante.
 *
 * PDF et image partent en blocs natifs ; tout le reste est decode en texte, ce
 * qui couvre CSV, TSV, JSON, OFX, QIF et un simple copier-coller — meme regle
 * que /api/pilotage/releve, pour qu'il n'y ait qu'un seul comportement a
 * connaitre dans la maison.
 */
function blocDePiece(piece: PieceEntrante): Anthropic.ContentBlockParam | null {
  const nom = typeof piece?.nom === 'string' ? piece.nom.slice(0, 120) : 'document'
  const type = typeof piece?.type === 'string' ? piece.type : ''
  const data = typeof piece?.data === 'string' ? piece.data : ''
  if (!data || data.length > MAX_PIECE) return null
  // Base64 strict : un data: URL ou du binaire brut est refuse ici, pas plus loin.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null

  if (type === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
      title: nom,
    }
  }
  if (TYPES_IMAGE.includes(type)) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data,
      },
    }
  }
  const texte = Buffer.from(data, 'base64').toString('utf8').slice(0, MAX_TEXTE_FICHIER)
  if (!texte.trim()) return null
  return { type: 'text', text: `Contenu du fichier « ${nom} » :\n\n${texte}` }
}

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const cors: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  // Le garde réel : l'allowlist du cockpit, par UUID.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers: cors })
  }

  const body = await req.json().catch(() => ({}))
  const brut: MessageEntrant[] = Array.isArray(body.messages) ? body.messages : []

  // Poids cumulé des pièces de TOUTE la conversation : le front renvoie
  // l'historique complet à chaque tour, donc un deuxième PDF s'ajoute au
  // premier. On refuse tôt et en clair plutôt que de laisser Vercel couper la
  // requête avec une erreur illisible.
  let poids = 0
  for (const m of brut) {
    if (!Array.isArray(m?.pieces)) continue
    for (const p of m.pieces as PieceEntrante[]) {
      if (typeof p?.data === 'string') poids += p.data.length
    }
  }
  if (poids > MAX_PIECES_TOTAL) {
    return NextResponse.json(
      {
        error:
          'Trop de documents dans cette conversation. Recharge la page pour repartir propre, ou envoie-les un par un.',
      },
      { status: 413, headers: cors },
    )
  }

  const historique: Anthropic.MessageParam[] = []
  for (const m of brut.slice(-MAX_HISTORY)) {
    if (m?.role !== 'user' && m?.role !== 'assistant') continue
    const texte = typeof m.content === 'string' ? m.content.slice(0, MAX_MESSAGE_LEN).trim() : ''
    const pieces =
      m.role === 'user' && Array.isArray(m.pieces)
        ? (m.pieces as PieceEntrante[])
            .slice(0, MAX_PIECES_PAR_MESSAGE)
            .map(blocDePiece)
            .filter((b): b is Anthropic.ContentBlockParam => b !== null)
        : []

    if (pieces.length === 0) {
      if (!texte) continue
      historique.push({ role: m.role, content: texte })
      continue
    }
    // Le document d'abord, la question ensuite : le modèle lit mieux quand la
    // pièce précède la demande qui porte dessus.
    historique.push({
      role: 'user',
      content: [
        ...pieces,
        { type: 'text', text: texte || 'Regarde ce document et dis-moi ce que tu y vois.' },
      ],
    })
  }

  if (historique.length === 0 || historique[historique.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Message manquant' }, { status: 400, headers: cors })
  }

  // UN SEUL point de cache sur les pièces, posé sur la dernière. La boucle
  // d'outils rejoue la conversation entière jusqu'à 8 fois : sans ça, un PDF
  // de 5 pages est refacturé à chaque aller-retour avec la base. Une seule
  // borne, parce que l'API en compte 4 au total et que le prompt système en
  // prend déjà une.
  posePointDeCache: for (let i = historique.length - 1; i >= 0; i--) {
    const contenu = historique[i].content
    if (!Array.isArray(contenu)) continue
    for (let j = contenu.length - 1; j >= 0; j--) {
      const bloc = contenu[j]
      if (bloc.type === 'document' || bloc.type === 'image') {
        bloc.cache_control = { type: 'ephemeral' }
        break posePointDeCache
      }
    }
  }

  try {
    const reponse = await boucleAgent(historique, userId)
    return NextResponse.json(reponse, { headers: cors })
  } catch (err) {
    console.error('[cockpit/agent]', err)
    return NextResponse.json(
      { error: aiErrorMessage(err, 'ANTHROPIC_API_KEY_COCKPIT') },
      { status: 502, headers: cors },
    )
  }
}
