import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { SQL_DESINSCRIRE, SQL_DESTINATAIRE, echapper, lireJetonDesinscription } from '@/lib/academie/emails-annonces'
import { configEnvoi } from '@/lib/academie/emails-annonces-serveur'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * /api/academie/emails/desinscription?j=<jeton> : le lien « Ne plus recevoir les annonces par email »
 * de chaque email envoye depuis le cockpit (13/11/2026 ; src/lib/academie/emails-annonces.ts).
 * Route PUBLIQUE (middleware.ts, chemin exact) : le jeton signe est la preuve. Il porte l'id de la
 * ligne du destinataire, jamais l'adresse.
 *
 * GET  : une page qui demande de confirmer (un antivirus de messagerie qui ouvre le lien ne
 *        desinscrit personne). HEAD : 204, rien.
 * POST : desinscrit l'adresse de la ligne (formulaire de la page, ou en-tete List-Unsubscribe-Post
 *        en un clic des messageries, RFC 8058). Rejouable. L'envoi suivant l'exclut.
 * Un lien d'un email d'ESSAI montre la page mais n'enregistre rien.
 * Jamais le jeton ni l'adresse dans un journal.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const ENTETES = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

function page(titre: string, corps: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${echapper(titre)}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<main style="max-width:520px;margin:48px auto;padding:0 16px">
<div style="background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:28px 24px;line-height:1.55">
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">Académie AO Knowledge</p>
<h1 style="margin:0 0 16px;font-size:20px">${echapper(titre)}</h1>
${corps}
</div></main></body></html>`
  return new NextResponse(html, { status, headers: ENTETES })
}

const sansAdresse = (err: unknown) => (relationAbsente(err) ? 'migration absente' : messageErreur(err).replace(/[^\s@]+@[^\s@]+/g, '[email]').slice(0, 200))

const INVALIDE = () => page('Lien invalide', '<p style="margin:0">Ce lien de désinscription n\'est pas reconnu. Pour ne plus recevoir nos annonces, réponds simplement à l\'email reçu ou écris à support@aoknowledge.com.</p>', 400)

async function ligneDuJeton(jeton: unknown): Promise<{ id: string; email: string; mode: string } | null> {
  const cfg = configEnvoi()
  if (!cfg.secret) return null
  const id = lireJetonDesinscription(cfg.secret, jeton)
  if (!id) return null
  const l = await prisma.$queryRawUnsafe<{ id: string; email: string; mode: string }[]>(SQL_DESTINATAIRE, id)
  return l[0] ?? null
}

export async function GET(req: NextRequest) {
  const jeton = req.nextUrl.searchParams.get('j')
  try {
    const ligne = await ligneDuJeton(jeton)
    if (!ligne) return INVALIDE()
    const action = `?j=${encodeURIComponent(jeton ?? '')}`
    return page('Ne plus recevoir les annonces par email ?', `
<p style="margin:0 0 16px">Tu ne recevras plus les annonces de l'académie par email. Ton compte, tes cours et la newsletter ne changent pas.</p>
${ligne.mode === 'essai' ? '<p style="margin:0 0 16px;font-size:13px;color:#92400e">Lien d\'un email d\'essai : rien ne sera enregistré.</p>' : ''}
<form method="post" action="${echapper(action)}" style="margin:0">
<button type="submit" style="background:#111827;color:#fff;border:0;border-radius:6px;padding:11px 18px;font-size:15px;font-weight:bold;cursor:pointer">Confirmer</button>
</form>`)
  } catch (err) {
    console.error(`[academie/emails/desinscription] GET : echec (${sansAdresse(err)})`)
    return page('Un instant', '<p style="margin:0">La page ne répond pas pour le moment. Réessaie dans quelques minutes, ou écris à support@aoknowledge.com.</p>', 503)
  }
}

export async function POST(req: NextRequest) {
  let jeton: string | null = req.nextUrl.searchParams.get('j')
  let unClic = false
  const type = req.headers.get('content-type') ?? ''
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const f = await req.formData().catch(() => null)
    if (f) {
      if (!jeton && typeof f.get('j') === 'string') jeton = f.get('j') as string
      unClic = f.get('List-Unsubscribe') === 'One-Click'
    }
  }
  try {
    const ligne = await ligneDuJeton(jeton)
    if (!ligne) return INVALIDE()
    if (ligne.mode !== 'essai') {
      await prisma.$executeRawUnsafe(SQL_DESINSCRIRE, ligne.email, unClic ? 'un-clic' : 'lien', ligne.id)
      console.info(`[academie/emails/desinscription] ${unClic ? 'un-clic' : 'lien'} ligne=${ligne.id.slice(0, 8)}`)
    }
    return page('C\'est fait', `<p style="margin:0">${ligne.mode === 'essai'
      ? 'Lien d\'essai : rien n\'a été enregistré.'
      : 'Tu ne recevras plus les annonces de l\'académie par email. Si c\'était une erreur, écris à support@aoknowledge.com et on te remet dans la liste.'}</p>`)
  } catch (err) {
    console.error(`[academie/emails/desinscription] POST : echec (${sansAdresse(err)})`)
    return page('Un instant', '<p style="margin:0">La désinscription n\'a pas pu être enregistrée. Réessaie dans quelques minutes, ou écris à support@aoknowledge.com.</p>', 503)
  }
}

export function HEAD() {
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
