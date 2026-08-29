import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'

/**
 * POST /api/support/escalate — « je veux parler à un humain ».
 *
 * Marque le fil escaladé, puis prévient l'équipe par un VRAI email serveur
 * (Resend) : « connecte-toi au cockpit pour répondre ». Décision Brice du
 * 28/08 : notification à l'escalade seulement, à Brice ET Mélanie.
 *
 * Sans clé Resend, on retombe sur le comportement v1 : le client ouvre
 * un mailto avec la transcription. La réponse porte `notified` pour que le
 * client sache quel monde il habite.
 *
 * Env :
 * - RESEND_API_KEY_SUPPORT  la clé, scopée au périmètre support (convention
 *                           Brice : un produit = une clé = une variable dédiée,
 *                           pour tourner la clé sans rien casser d'autre ;
 *                           Resend permet plusieurs clés par compte).
 *                           RESEND_API_KEY accepté en secours.
 * - SUPPORT_ALERT_EMAILS    destinataires, séparés par des virgules.
 *                           Défaut : brice.delannay@gmail.com (seule adresse que
 *                           Resend accepte tant que le domaine n'est pas vérifié).
 * - SUPPORT_FROM_EMAIL      expéditeur. Défaut : onboarding@resend.dev (marche
 *                           sans vérification de domaine) ; passer à une adresse
 *                           @aoknowledge.com une fois le domaine vérifié.
 */

interface ThreadMessage {
  role: string
  content: string
  at?: string
}

const CONTACT_EMAIL = 'brice.d@aoknowledge.com'

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  const body = await req.json().catch(() => ({}))
  const threadId = typeof body.threadId === 'string' ? body.threadId : null
  // Visiteurs en session anonyme (MelTrade) : auth.users n'a pas d'email,
  // le widget demande une adresse de contact au moment de l'escalade.
  const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim().slice(0, 200) : null

  let thread = null
  if (threadId) {
    thread = await prisma.supportThread.findFirst({ where: { id: threadId, userId } })
    if (thread) {
      await prisma.supportThread.update({
        where: { id: thread.id },
        data: { escalatedAt: new Date() },
      })
    }
  }

  let notified = false
  const apiKey = process.env.RESEND_API_KEY_SUPPORT ?? process.env.RESEND_API_KEY
  if (apiKey) {
    try {
      // L'email du membre : le fil ne porte que le userId Supabase.
      const rows = await prisma.$queryRaw<{ email: string | null }[]>`
        select email from auth.users where id = ${userId}::uuid`
      const memberEmail = rows[0]?.email ?? contactEmail ?? `visiteur anonyme (${userId.slice(0, 8)}…)`

      const messages = (Array.isArray(thread?.messages) ? thread!.messages : []) as unknown as ThreadMessage[]
      const derniers = messages.slice(-6)
      const transcript = derniers.length
        ? derniers
            .map(m => `<p><strong>${m.role === 'user' ? 'Membre' : m.role === 'human' ? 'Équipe' : 'IA'}</strong> : ${
              String(m.content).replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 600)
            }</p>`)
            .join('\n')
        : '<p><em>Fil sans historique (escalade immédiate).</em></p>'

      const to = (process.env.SUPPORT_ALERT_EMAILS ?? 'brice.delannay@gmail.com')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)

      const resend = new Resend(apiKey)
      const { error } = await resend.emails.send({
        from: process.env.SUPPORT_FROM_EMAIL ?? 'AOK Support <onboarding@resend.dev>',
        to,
        subject: `Support : ${memberEmail} veut parler à un humain`,
        html: [
          `<p><strong>${memberEmail}</strong> a demandé un humain dans le support`,
          ` (app : ${thread?.app ?? 'inconnue'}).</p>`,
          contactEmail && rows[0]?.email && contactEmail !== rows[0].email
            ? `<p>Email de contact laissé dans le chat : ${contactEmail.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`
            : '',
          `<p><a href="https://cockpit.aoknowledge.com/?vue=support">Ouvrir l'onglet Support du cockpit</a> pour répondre.</p>`,
          '<hr />',
          '<p>Derniers échanges :</p>',
          transcript,
        ].join('\n'),
      })
      notified = !error
      if (error) console.error('[support/escalate] resend:', error)
    } catch (err) {
      // L'échec d'email ne doit jamais casser l'escalade elle-même.
      console.error('[support/escalate] envoi impossible:', err)
    }
  }

  // `email` reste pour les clients v1 (mailto de secours quand notified=false).
  return NextResponse.json({ email: CONTACT_EMAIL, notified }, { headers: cors })
}
