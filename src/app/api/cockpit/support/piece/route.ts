import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { telechargerImageTelegram } from '@/lib/agent-cockpit-telegram'
import { estImage, lirePieceSupport } from '@/lib/liveclub/support-pont-pur'
import { lireCapture } from '@/lib/support-membre'
import { cheminCapture } from '@/lib/support-membre-pur'

/**
 * POST /api/cockpit/support/piece : l'IMAGE d'une piece jointe d'un fil
 * Support (Brice, 16/10), pour la vignette de l'onglet Support.
 *
 * Corps : { fil: <id du fil>, message: <indice du message dans le fil> }. Le
 * file_id vient de la BASE (le message du fil), jamais du navigateur : on ne
 * peut lire que ce qu'un fil porte. Les pieces des fils sont des fichiers du
 * bot des MEMBRES (images des membres, et fichiers que l'equipe leur a
 * envoyes) : getFile avec TELEGRAM_LIVECLUB_BOT_TOKEN, poids borne (3,75 Mo,
 * sous la limite d'une reponse Vercel), type lu dans les octets (JPEG, PNG,
 * WEBP). Jamais l'URL du fichier dans un log : elle porte le jeton du bot.
 * Aucune copie : l'image est relue chez Telegram a chaque demande (le
 * navigateur la garde 10 minutes).
 *
 * Meme garde que les autres routes du cockpit : Bearer Supabase +
 * cockpit_allowlist, CORS des origines AOK (POST, comme les autres).
 * Reponses : 200 image ; 400 corps ; 401 ; 403 ; 404 fil ou piece introuvable ;
 * 413 trop lourde pour l'apercu ; 415 pas une image ; 502 illisible chez Telegram.
 */

export const maxDuration = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const erreur = (error: string, status: number) => NextResponse.json({ error }, { status, headers })
  const userId = await getUserId(req)
  if (!userId) return erreur('Unauthorized', 401)
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return erreur('Réservé au cockpit', 403)

  const body = await req.json().catch(() => ({}))
  const fil = typeof body?.fil === 'string' && UUID.test(body.fil) ? body.fil.toLowerCase() : null
  const indice = Number(body?.message)
  if (!fil || !Number.isSafeInteger(indice) || indice < 0 || indice > 100_000) return erreur('fil et message requis', 400)

  const lignes = await prisma.$queryRaw<{ piece: unknown }[]>`
    select messages -> ${indice}::int -> 'piece' as piece from public."SupportThread" where id = ${fil} limit 1`
  if (lignes.length === 0) return erreur('Fil introuvable', 404)
  const piece = lirePieceSupport(lignes[0].piece)
  if (!piece) return erreur('Pièce jointe introuvable', 404)
  if (!estImage(piece)) return erreur("Ce fichier n'est pas une image : pas d'aperçu.", 415)

  // (18/10) Une capture de la page Support du site : bucket prive
  // support-captures (file_id « stockage:<chemin> »), lue avec la cle de service.
  if (piece.file_id.startsWith('stockage:')) {
    const chemin = cheminCapture(piece.file_id)
    const lu = chemin ? await lireCapture(chemin) : null
    if (!lu || !lu.ok) return erreur('Capture illisible pour le moment.', 502)
    return new NextResponse(new Uint8Array(lu.octets), {
      status: 200,
      headers: { ...headers, 'Content-Type': lu.mime, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' },
    })
  }

  const issue = await telechargerImageTelegram('liveclub', {
    fileId: piece.file_id, source: piece.type, typeAnnonce: null, taille: piece.taille,
  })
  if (!issue.ok) {
    if (issue.raison === 'trop_gros') return erreur("Image trop lourde pour l'aperçu.", 413)
    if (issue.raison === 'pas_une_image') return erreur("Ce fichier n'est pas une image lisible.", 415)
    return erreur("Image illisible chez Telegram pour le moment.", 502)
  }
  const octets = Buffer.from(issue.image.base64, 'base64')
  return new NextResponse(new Uint8Array(octets), {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': issue.image.mediaType,
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
