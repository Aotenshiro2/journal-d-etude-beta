import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { passerFilet } from '@/lib/kit-defauts'

/**
 * GET /api/cron/kit-defauts : le filet quotidien des choix par defaut Kit
 * (31/10/2026), lance par le cron Vercel (vercel.json, 05:00 UTC). Les
 * abonnes actifs crees dans les 72 dernieres heures sans AUCUN tag « Choix »
 * recoivent les choix par defaut (src/lib/kit-choix.ts), sauf un membre qui a
 * regle ses choix dans Mon espace. Rattrape un webhook perdu
 * (/api/kit/webhook/[secret]) : les webhooks historiques de Kit ne sont pas
 * rejoues.
 *
 * 05:00 UTC, pas 07:00 avec le passage du Live Club : les newsletters du
 * samedi partent a 07:00 UTC, et sur le plan Hobby de Vercel un cron part a
 * n'importe quel moment de son heure. A 05:00, le filet est passe avant.
 *
 * Garde : Authorization: Bearer <CRON_SECRET>, comme /api/cron/liveclub.
 * Reponse : des nombres seulement.
 */

export const maxDuration = 120
export const dynamic = 'force-dynamic'

function autorise(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    console.warn('[cron/kit-defauts] CRON_SECRET absent du projet journal : passage refuse.')
    return false
  }
  const recu = Buffer.from(req.headers.get('authorization') ?? '')
  const attendu = Buffer.from(`Bearer ${secret}`)
  return recu.length === attendu.length && timingSafeEqual(recu, attendu)
}

export async function GET(req: NextRequest) {
  if (!autorise(req)) return NextResponse.json({ ok: false, erreur: 'Unauthorized' }, { status: 401 })
  const r = await passerFilet()
  return NextResponse.json(r, { status: r.ok ? 200 : 502 })
}
