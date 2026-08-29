import { NextRequest, NextResponse } from 'next/server'

// Origines web autorisées à appeler /api/support/* depuis un navigateur.
// Le CORS n'est PAS la barrière de sécurité (getUserId l'est) : il autorise
// seulement les frontends AOK à parler au backend depuis leur propre domaine.
// L'extension Chrome n'en a pas besoin (les fetch d'extension MV3 passent outre).
const ALLOWED_ORIGINS = [
  /^https:\/\/(www\.)?aoknowledge\.com$/,
  /^https:\/\/[a-z0-9-]+\.aoknowledge\.com$/, // journal., masterclass., pilotage., futurs sous-domaines
  /^https:\/\/(www\.)?melaniechart\.com$/, // MelTrade, le site de Mélanie (intégré par Adil)
  /^https:\/\/[a-z0-9-]+-aotenshiros-projects\.vercel\.app$/, // previews Vercel
  /^http:\/\/localhost(:\d+)?$/, // dev local
]

export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin')
  if (!origin || !ALLOWED_ORIGINS.some(re => re.test(origin))) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

// Réponse au préflight (le middleware laisse passer les OPTIONS sur /api/).
export function corsPreflight(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}
