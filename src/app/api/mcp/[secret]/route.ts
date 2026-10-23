import { NextRequest, NextResponse } from 'next/server'
import { journaliser } from '@/lib/tab/acces'
import { erreurRpc, traiterPost, type SortieHttp } from '@/lib/mcp-gpt/pur'
import { base, verifierCleGpt } from '@/lib/mcp-gpt/serveur'

/**
 * LE CONNECTEUR MCP DE CHATGPT POUR BELRIVE (23/10/2026) : /api/mcp/<secret>.
 *
 * ChatGPT (le Projet Belrive de Brice, connecteur en mode developpeur, « aucune
 * authentification ») lit les documents et les notes du projet belrive, ecrit
 * des notes pour Sora, Yume, Sekai ou Tab, et depose ses propres documents.
 * Rien d'autre du cockpit. Le protocole, les outils et leurs gardes :
 * src/lib/mcp-gpt/pur.ts ; le SQL : requetes.ts ; la base et les pings :
 * serveur.ts.
 *
 * MCP en HTTP SANS ETAT : POST JSON-RPC, reponse application/json (jamais de
 * flux SSE, pas de session). GET et DELETE : 405.
 *
 * Route publique pour le middleware (pas de session) : le secret du chemin est
 * verifie ici (empreinte en base, cockpit_tab_cles portee gpt_belrive). Secret
 * absent, inconnu ou coupe : la meme 404 neutre. Chaque appel authentifie est
 * journalise dans cockpit_tab_acces (route mcp/...), jamais le secret. Aucune
 * erreur interne n'est rendue a ChatGPT.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ENTETES = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

function ipDe(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ secret: string }> }) {
  const debut = Date.now()
  const { secret } = await ctx.params
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
    }, { verifierCle: verifierCleGpt, base })
  } catch (err) {
    console.error('[mcp-gpt]', err instanceof Error ? (err.message.split('\n').filter(Boolean).pop() ?? '').slice(0, 200) : 'erreur')
    sortie = { status: 500, corps: erreurRpc(null, -32603, 'Erreur interne.'), journal: null }
  }

  if (sortie.journal) {
    await journaliser({ ...sortie.journal, statut: sortie.status, dureeMs: Date.now() - debut, ip: ipDe(req) })
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
