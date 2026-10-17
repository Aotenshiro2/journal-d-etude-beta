import { createHash } from 'node:crypto'

/**
 * Conversions API de Meta (18/10/2026, chantier ACQUISITION du cockpit) :
 * signaler un ACHAT a Meta depuis le serveur, plus fiable que le pixel seul
 * (bloqueurs, Safari, onglet ferme avant la fin). GRATUIT.
 *
 * INACTIF tant que les deux variables d'environnement du projet Vercel du
 * journal ne sont pas posees :
 *   META_PIXEL_ID     l'identifiant du pixel (meme valeur que VITE_META_PIXEL_ID du site)
 *   META_CAPI_TOKEN   le jeton Conversions API (Gestionnaire d'evenements > le pixel >
 *                     Parametres > Conversions API > Generer un jeton d'acces)
 * Facultatif : META_CAPI_TEST_CODE (code de test du Gestionnaire d'evenements,
 * pour voir les evenements arriver dans l'onglet « Tester les evenements »).
 *
 * CONSENTEMENT : l'appelant ne l'envoie que si la personne a accepte la
 * PUBLICITE dans le bandeau du site (le site le dit dans sa requete). L'email
 * part en empreinte SHA-256 (exigence de Meta), jamais en clair. L'identifiant
 * de l'evenement est l'empreinte du session_id Stripe, la meme que celle que
 * calcule la page : Meta dedoublonne le pixel et le serveur.
 *
 * Ne jette jamais : un echec est journalise sans aucune donnee personnelle, et
 * le parcours du membre n'attend pas plus de 3 secondes.
 */

const VERSION = 'v23.0'

export function capiActive(): boolean {
  return /^\d{6,20}$/.test(process.env.META_PIXEL_ID ?? '') && (process.env.META_CAPI_TOKEN ?? '').length > 20
}

export function empreinte(texte: string): string {
  return createHash('sha256').update(texte).digest('hex')
}

export async function signalerAchatMeta(achat: {
  sessionId: string
  email: string | null
  clientStripe: string | null
  valeur: number | null
  devise: string | null
  ip: string | null
  userAgent: string | null
  url: string
  contenu: string
}): Promise<void> {
  if (!capiActive()) return
  const pixel = process.env.META_PIXEL_ID as string
  const jeton = process.env.META_CAPI_TOKEN as string
  const userData: Record<string, unknown> = {}
  if (achat.email) userData.em = [empreinte(achat.email.trim().toLowerCase())]
  if (achat.clientStripe) userData.external_id = [empreinte(achat.clientStripe)]
  if (achat.ip) userData.client_ip_address = achat.ip
  if (achat.userAgent) userData.client_user_agent = achat.userAgent.slice(0, 500)
  const evenement = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: empreinte(achat.sessionId),
    action_source: 'website',
    event_source_url: achat.url,
    user_data: userData,
    custom_data: {
      content_name: achat.contenu,
      ...(achat.valeur !== null && achat.devise ? { value: achat.valeur, currency: achat.devise } : {}),
    },
  }
  const corps: Record<string, unknown> = { data: [evenement] }
  if (process.env.META_CAPI_TEST_CODE) corps.test_event_code = process.env.META_CAPI_TEST_CODE

  const arret = new AbortController()
  const minuterie = setTimeout(() => arret.abort(), 3000)
  try {
    const res = await fetch(
      `https://graph.facebook.com/${VERSION}/${pixel}/events?access_token=${encodeURIComponent(jeton)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps), signal: arret.signal },
    )
    if (!res.ok) {
      const texte = (await res.text().catch(() => '')).slice(0, 300)
      console.warn(`[meta-capi] refuse HTTP ${res.status} : ${texte}`)
    }
  } catch (err) {
    console.warn(`[meta-capi] envoi impossible : ${err instanceof Error ? err.name : 'erreur'}`)
  } finally {
    clearTimeout(minuterie)
  }
}
