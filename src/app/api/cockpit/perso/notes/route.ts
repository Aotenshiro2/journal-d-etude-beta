import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { lireNoteEntrante } from '@/lib/tab/notes-pur'
import { BRICE_USER_ID, creerNote, pingerTab, prevenirBrice } from '@/lib/tab/notes'

/**
 * POST /api/cockpit/perso/notes : ecrire une note de l'espace perso de Brice
 * (20/10/2026). cockpit_perso_notes est ecrite par le serveur SEULEMENT : c'est
 * ici que passe toute note qui n'arrive pas par l'API de Tab, pour que le ping
 * parte d'un seul endroit.
 *
 * Deux gardes :
 * - Bearer = la cle de service Supabase (SUPABASE_SERVICE_ROLE_KEY) : le script
 *   local de Claude Code (automations/notes_tab.py). Note vers_tab, auteur
 *   claude. Qui tient cette cle ecrit deja tout en base : rien de plus ouvert.
 *   `test: true` donne a l'email l'objet « Test du canal Claude → Tab ».
 * - Bearer = un jeton de session du cockpit, compte avec acces_perso
 *   (is_cockpit_perso) : l'ecran Perso. Brice ecrit pour Tab (vers_tab) ; le
 *   compte de Tab, lui, ecrirait pour Claude (vers_claude).
 *
 * Une note vers_tab envoie l'email qui reveille Tab ; une note vers_claude
 * previent Brice sur Telegram.
 */

export const dynamic = 'force-dynamic'

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

function estCleService(entete: string | null): boolean {
  const attendue = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const m = /^Bearer\s+(\S+)\s*$/i.exec(entete ?? '')
  if (!attendue || !m) return false
  const a = Buffer.from(attendue)
  const b = Buffer.from(m[1])
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = { ...corsHeaders(req), 'Cache-Control': 'no-store' }
  const corps = await req.json().catch(() => null) as Record<string, unknown> | null

  let qui: 'claude' | 'brice' | 'tab'
  if (estCleService(req.headers.get('authorization'))) {
    qui = 'claude'
  } else {
    const userId = await getUserId(req)
    if (!userId) return NextResponse.json({ ok: false, erreur: 'Non connecté.' }, { status: 401, headers })
    const perso = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid and acces_perso`
    if (perso.length === 0) return NextResponse.json({ ok: false, erreur: 'Réservé à l\'espace perso de Brice.' }, { status: 403, headers })
    qui = userId === BRICE_USER_ID ? 'brice' : 'tab'
  }

  const note = lireNoteEntrante(corps)
  if (typeof note === 'string') return NextResponse.json({ ok: false, erreur: note }, { status: 400, headers })

  try {
    if (qui === 'tab') {
      const creee = await creerNote('vers_claude', 'tab', note)
      const brice = await prevenirBrice(creee)
      return NextResponse.json({ ok: true, note: creee, ping: { telegram: brice } }, { status: 201, headers })
    }
    const creee = await creerNote('vers_tab', qui, note)
    const ping = await pingerTab(creee, qui === 'claude' && corps?.test === true)
    return NextResponse.json({ ok: true, note: { ...creee, ping_envoye_le: ping.envoye ? new Date().toISOString() : null }, ping }, { status: 201, headers })
  } catch (err) {
    console.error('[perso] note', err instanceof Error ? err.message.split('\n').pop() : err)
    return NextResponse.json({ ok: false, erreur: 'Note non enregistrée (erreur de la base).' }, { status: 502, headers })
  }
}
