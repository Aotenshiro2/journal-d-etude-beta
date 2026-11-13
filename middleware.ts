import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // Public routes. NB : '/' est public en exact-match uniquement (surtout PAS via
  // startsWith, sinon toute l'app deviendrait publique) — l'accueil anonyme affiche
  // la landing, et page.tsx branche vers l'app dès qu'un user est présent.
  // /api/membres/photo : photo d'un profil PUBLIC pour aoknowledge.com/membres/<n°> (lot 2, 18/10/2026).
  // /api/academie/achat (+ /confirmer, /webhook) et /api/academie/catalogue : vente a l'unite sans compte (19/10/2026).
  // /api/tab/ : l'API de Tab, cle dediee verifiee dans la route (20/10/2026).
  // /api/liveclub/stripe : webhook Stripe du Live Club, signature verifiee dans la route, 503 sans son secret (22/10/2026).
  // /api/mcp/ : le connecteur MCP de ChatGPT pour Belrive, secret du chemin verifie dans la route (23/10/2026).
  // /api/club/paypal (+ /commande, /capturer) : le 10% Club paye par PayPal sans compte, commande relue chez PayPal (29/10/2026).
  // /api/pilotage/achat (+ /confirmer, /webhook) : abonnements de Pilotage sans compte exige, session et abonnement relus chez Stripe (30/10/2026).
  // /api/liveclub/resend : webhook Resend du Live Club (emails refuses), signature Svix verifiee dans la route, 503 sans son secret (31/10/2026).
  // /api/newsletter/subscribe : inscription juste apres la creation d'un compte (journal, extension Carnet), sans session ; garde dans newsletter-inscription-pur.ts (31/10/2026).
  // /api/kit/webhook/ : webhooks Kit des inscriptions par formulaire, secret du chemin verifie dans la route (31/10/2026).
  // /api/mcp-cockpit/ : le connecteur MCP du cockpit pour Tache, secret du chemin (ou Bearer de Tache) verifie dans la route (01/11/2026).
  // /api/academie/suivi : le signal de fermeture de page (sendBeacon) n'a pas d'en-tete Authorization, son jeton est dans le corps ; la route verifie le jeton (en-tete ou corps) et rend 401 sans lui (05/11/2026).
  // /api/cockpit/lien-magique (+ /ouvrir) : connexion au cockpit par lien avec toute adresse verifiee, sans session ; allowlist, adresse verifiee et cadence verifiees dans la route (05/11/2026).
  // /api/mcp-alex/ : le connecteur MCP de l'assistant d'Alex (indicateur), secret du chemin verifie dans la route (05/11/2026).
  // /api/coaching/cal : webhook du compte Cal de Brice (Mon coaching), signature X-Cal-Signature-256 verifiee dans la route, 503 sans son secret (09/11/2026).
  const publicPaths = ['/auth', '/api/health', '/guide', '/api/membres/photo', '/api/academie/achat', '/api/academie/catalogue', '/api/academie/suivi', '/api/tab/', '/api/liveclub/stripe', '/api/liveclub/resend', '/api/mcp/', '/api/club/paypal', '/api/pilotage/achat', '/api/newsletter/subscribe', '/api/kit/webhook/', '/api/mcp-cockpit/', '/api/cockpit/lien-magique', '/api/mcp-alex/', '/api/coaching/cal']
  // /api/besoins/signal : un signal de friction de nos outils, session facultative (empreinte du jour sans session) ; chemin EXACT, /api/besoins/signaler garde sa session (06/11/2026).
  // /api/academie/invitation : le lien personnel de l'email d'invitation des payants de Skool, sans session ; le jeton est verifie dans la route ; chemin EXACT (08/11/2026).
  // /api/academie/emails/desinscription : le lien de desinscription des emails aux membres envoyes depuis le cockpit, sans session ; le jeton signe est verifie dans la route ; chemin EXACT (13/11/2026).
  const isPublic = pathname === '/' || pathname === '/api/besoins/signal' || pathname === '/api/academie/invitation' || pathname === '/api/academie/emails/desinscription' || publicPaths.some(p => pathname.startsWith(p))
  if (isPublic) return supabaseResponse

  // API routes — allow Bearer token through (handled in route handlers)
  if (pathname.startsWith('/api/')) {
    // Préflight CORS (support depuis les frontends web) : sans cookies ni
    // Authorization par construction — le laisser passer, la route répond.
    if (request.method === 'OPTIONS') return supabaseResponse
    if (!user) {
      const authHeader = request.headers.get('authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
    return supabaseResponse
  }

  // Protected pages
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
