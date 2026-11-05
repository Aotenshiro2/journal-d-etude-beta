import { NextRequest, NextResponse } from 'next/server'
import { journaliser } from '@/lib/tab/acces'
import { erreurRpc } from '@/lib/mcp-gpt/pur'
import { masquerSecrets, traiterPost, type SortieHttp } from '@/lib/mcp-alex/pur'
import { aujourdhuiParis, lecturesAlex, verifierCleAlex } from '@/lib/mcp-alex/serveur'

/**
 * LE CONNECTEUR MCP DE L'ASSISTANT D'ALEX (05/11/2026) : /api/mcp-alex/<secret>.
 *
 * Brice, 05/11 : « alex va demander a son tab [son assistant IA] de se
 * connecter a notre mcp, prevois ce qu'il faut ». L'assistant d'Alex l'ajoute
 * comme « connecteur MCP personnalise ». Trois outils en lecture seule (aide,
 * membres_indicateur, departs_indicateur), rien d'autre du cockpit. Le
 * protocole et les outils : src/lib/mcp-alex/pur.ts ; la cle et les lectures :
 * serveur.ts.
 *
 * MCP en HTTP SANS ETAT : POST JSON-RPC, reponse application/json (jamais de
 * flux SSE, pas de session). GET et DELETE : 405.
 *
 * Route publique pour le middleware (pas de session) : le secret du chemin
 * (empreinte en base, cockpit_tab_cles portee alex_indicateur) est verifie
 * ici. Sinon : la meme 404 neutre. Migration 20261105250000 pas encore passee :
 * 503. Chaque appel d'outil est journalise dans cockpit_tab_acces (route
 * mcp-alex/<outil>), jamais le secret. Le chemin est masque pour Sentry
 * (src/lib/sentry-masque.ts).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ENTETES = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

function ipDe(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ secret: string }> }) {
  const debut = Date.now()
  const { secret } = await ctx.params
  const ip = ipDe(req)
  let brut = ''
  try {
    brut = await req.text()
  } catch {
    brut = ''
  }

  let sortie: SortieHttp
  try {
    sortie = await traiterPost({
      secret: secret ?? '',
      typeContenu: req.headers.get('content-type'),
      versionProtocole: req.headers.get('mcp-protocol-version'),
      brut,
    }, { verifierCle: verifierCleAlex, lire: lecturesAlex, aujourdhui: aujourdhuiParis })
  } catch (err) {
    console.error('[mcp-alex]', err instanceof Error ? masquerSecrets(err.message.split('\n').filter(Boolean).pop() ?? '').slice(0, 200) : 'erreur')
    sortie = { status: 500, corps: erreurRpc(null, -32603, 'Erreur interne.'), journaux: [] }
  }

  const duree = Date.now() - debut
  for (const j of sortie.journaux) {
    await journaliser({ ...j, dureeMs: j.dureeMs ?? duree, ip })
  }
  if (sortie.corps === null) return new NextResponse(null, { status: sortie.status, headers: ENTETES })
  return NextResponse.json(sortie.corps, { status: sortie.status, headers: ENTETES })
}

function nonPermis() {
  return NextResponse.json(
    erreurRpc(null, -32000, 'Méthode non permise : ce serveur MCP est sans état et ne répond qu\'en POST.'),
    { status: 405, headers: { ...ENTETES, Allow: 'POST' } },
  )
}

export async function GET() {
  return nonPermis()
}

export async function DELETE() {
  return nonPermis()
}
