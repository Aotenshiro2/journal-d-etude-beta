import { NextRequest, NextResponse } from 'next/server'
import { CORPS_MAX_OCTETS, executerAuto, jetonValide, lireCommandeAuto } from '@/lib/besoins/auto-pur'
import { depotsAuto } from '@/lib/besoins/auto'
import { erreurCourte } from '@/lib/besoins/pur'

// prevenir : un envoi par membre (Telegram, email), plus aucun ne commence apres BUDGET_MS.
export const maxDuration = 300
export const dynamic = 'force-dynamic'
const BUDGET_MS = 240_000

/**
 * POST /api/cockpit/besoins/auto (10/11/2026) : le tri automatique des besoins
 * des membres, de serveur a serveur (tache « tri-besoins-du-soir », script
 * automations/besoins_auto.py). Regles : src/lib/besoins/auto-pur.ts.
 *
 * Garde : Authorization: Bearer <BESOINS_AUTO_TOKEN>, compare en temps
 * constant ; sans la variable (ou trop courte), tout est refuse. Pas de
 * session, pas de CORS (aucun navigateur). Le middleware laisse passer un
 * Bearer, c'est ici qu'il est verifie.
 *
 * Corps : { action: lire | statut | fusionner | prevenir, essai?, ... }.
 * Reponses : 200 ; 400 (action inconnue, corps) ; 401 ; 413 ; 503 (base, ou
 * journal des gestes absent).
 */
export async function POST(req: NextRequest) {
  if (!jetonValide(req.headers.get('authorization'), process.env.BESOINS_AUTO_TOKEN)) {
    if (!process.env.BESOINS_AUTO_TOKEN?.trim()) console.warn('[cockpit/besoins/auto] BESOINS_AUTO_TOKEN absent : appel refuse.')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const texte = await req.text().catch(() => '')
  if (Buffer.byteLength(texte, 'utf8') > CORPS_MAX_OCTETS) return NextResponse.json({ error: 'Corps trop long.' }, { status: 413 })
  let brut: unknown = null
  try {
    brut = JSON.parse(texte)
  } catch {
    return NextResponse.json({ error: 'Corps JSON attendu.' }, { status: 400 })
  }
  const cmd = lireCommandeAuto(brut)
  if ('erreur' in cmd) return NextResponse.json({ error: cmd.erreur }, { status: cmd.status })
  try {
    const r = await executerAuto(cmd, depotsAuto(), BUDGET_MS)
    if (r.status === 200) console.log(`[cockpit/besoins/auto] ${cmd.action}${cmd.essai ? ' (essai)' : ''} : fait`)
    return NextResponse.json(r.corps, { status: r.status })
  } catch (err) {
    console.warn(`[cockpit/besoins/auto] ${cmd.action} en panne : ${erreurCourte(err)}`)
    return NextResponse.json({ error: 'Base illisible : réessaie dans un instant.' }, { status: 503 })
  }
}
