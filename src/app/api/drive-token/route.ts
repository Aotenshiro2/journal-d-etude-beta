import { NextRequest, NextResponse } from 'next/server'

// Proxy d'échange OAuth Google Drive : l'extension fait le consentement
// (launchWebAuthFlow + PKCE, cross-navigateur) et nous envoie le code ;
// l'échange code→token se fait ICI avec le client_secret (env Vercel), pour
// qu'aucun secret ne vive dans le bundle de l'extension.
//
// Variables d'env attendues (Vercel, projet journal) :
//   GOOGLE_DRIVE_CLIENT_ID     (optionnel, défaut ci-dessous — c'est un id public)
//   GOOGLE_DRIVE_CLIENT_SECRET (requis)

const DEFAULT_CLIENT_ID = '963294596205-jvg0o7mi11ngfvqcq6thncmboemnalmq.apps.googleusercontent.com'

export async function POST(req: NextRequest) {
  try {
    const { code, codeVerifier, redirectUri } = await req.json()

    if (!code || !codeVerifier || !redirectUri) {
      return NextResponse.json(
        { error: 'Paramètres manquants (code, codeVerifier, redirectUri)' },
        { status: 400 },
      )
    }

    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || DEFAULT_CLIENT_ID
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
    if (!clientSecret) {
      return NextResponse.json(
        { error: 'GOOGLE_DRIVE_CLIENT_SECRET absent côté serveur' },
        { status: 500 },
      )
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    })

    const data = await tokenRes.json().catch(() => null)
    if (!tokenRes.ok || !data?.access_token) {
      return NextResponse.json(
        { error: 'Échange token Google échoué', detail: data ?? null },
        { status: 502 },
      )
    }

    // Ne renvoyer que l'access_token (le refresh_token reste côté serveur, inutile à l'extension)
    return NextResponse.json({ access_token: data.access_token })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erreur serveur' },
      { status: 500 },
    )
  }
}
