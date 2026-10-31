import { NextRequest, NextResponse, after } from 'next/server'
import { cheminAttendu, traiterWebhook } from '@/lib/kit-defauts'
import { idsDuWebhook, secretCorrespond } from '@/lib/kit-defauts-pur'

/**
 * POST /api/kit/webhook/<secret> : les webhooks Kit « subscriber.form_subscribe »
 * (un par formulaire actif, scripts/kit-webhook-creer.mjs, 31/10/2026). Kit
 * est sur le plan gratuit : pas de regle « formulaire, alors tags ». Cette
 * route pose les choix par defaut (src/lib/kit-choix.ts) a un nouvel inscrit
 * par formulaire. Regle et garde : src/lib/kit-defauts-pur.ts.
 *
 * Garde :
 * - le secret du chemin, derive de SUPABASE_SERVICE_ROLE_KEY (aucune variable
 *   de plus), compare a temps constant. Faux : 404, comme une route absente.
 *   Les webhooks historiques de Kit (/v4/webhooks) ne sont pas signes : le
 *   chemin est la seule preuve. Publique dans middleware.ts.
 * - du corps, seul l'id de l'abonne est lu. Tout le reste est relu chez Kit :
 *   choix poses seulement a un abonne ACTIF, sans AUCUN tag « Choix », et pas
 *   a un membre qui a regle ses choix dans Mon espace. Idempotent.
 *
 * Reponse rapide : 200 { ok, recus } tout de suite, le travail se fait apres
 * la reponse (after). Un echec ici n'est pas rejoue par Kit : le filet
 * quotidien (/api/cron/kit-defauts) rattrape.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CORPS_MAX = 64 * 1024

export async function POST(req: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const attendu = cheminAttendu()
  if (!attendu) {
    console.warn('[kit/webhook] SUPABASE_SERVICE_ROLE_KEY absente : livraison refusee')
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  const { secret } = await params
  if (!secretCorrespond(secret, attendu)) return NextResponse.json({ ok: false }, { status: 404 })

  const texte = await req.text().catch(() => '')
  let corps: unknown = null
  if (texte.length <= CORPS_MAX) {
    try { corps = JSON.parse(texte) } catch { corps = null }
  }
  const ids = idsDuWebhook(corps)
  if (ids.length) {
    after(async () => {
      try { await traiterWebhook(ids) } catch (err) {
        console.warn(`[kit/webhook] traitement interrompu : ${err instanceof Error ? err.name : 'erreur'}`)
      }
    })
  }
  return NextResponse.json({ ok: true, recus: ids.length }, { headers: { 'Cache-Control': 'no-store' } })
}
