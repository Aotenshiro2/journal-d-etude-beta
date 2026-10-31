import { NextRequest, NextResponse } from 'next/server'
import { ErreurKit, cleKit, clientKit } from '@/lib/kit'
import { CHOIX_KIT } from '@/lib/kit-choix'
import { tagsInscription } from '@/lib/kit-abonnements-pur'

// Inscription a la newsletter (journal, extension Carnet). Depuis le
// 31/10/2026 (decision de Brice), un NOUVEL abonne recoit d'office les choix
// marques « inscription » dans src/lib/kit-choix.ts (tous sauf les offres de
// partenaires, qui demandent un accord explicite). Un abonne qui existait deja garde ses choix : on ne recoche pas ce
// qu'il a decoche. Cle : CONVERTKIT_API_KEY (sinon KIT_API_KEY).

export async function POST(req: NextRequest) {
  const { email, name } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const apiKey = cleKit()
  if (!apiKey) {
    console.error('[Newsletter] CONVERTKIT_API_KEY not set')
    return NextResponse.json({ error: 'not configured' }, { status: 500 })
  }

  const kit = clientKit(apiKey)
  try {
    const { abonne, cree } = await kit.creerAbonne(String(email).trim(), typeof name === 'string' && name.trim() ? name.trim() : null)
    if (cree) {
      for (const tag of tagsInscription(CHOIX_KIT)) await kit.poserTag(tag, abonne.id)
    }
  } catch (err) {
    const statut = err instanceof ErreurKit ? err.statut : 502
    console.error('[Newsletter] Kit API error:', statut)
    return NextResponse.json({ error: 'kit' }, { status: statut >= 400 && statut < 600 ? statut : 502 })
  }

  return NextResponse.json({ ok: true })
}
