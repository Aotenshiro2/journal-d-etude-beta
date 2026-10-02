import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { ecrireActivite } from '@/lib/activite-jour'

/**
 * POST /api/activite — compteurs d'activité d'un membre, jour par jour
 * (02/10/2026). Envoyés par le Carnet du Trader (1.8.10) quand le membre est
 * connecté et n'a pas coupé la sync : les mêmes nombres que son panneau
 * « Ton activité », AUCUN contenu. La tuyauterie pour savoir ce que font nos
 * membres en général ; rien ne l'affiche encore (le cockpit viendra plus tard).
 *
 * Body : { appareil: string, app?: 'carnet', jours: [{ jour: 'AAAA-MM-JJ',
 *          ecrits, mentor, trades, jugements, consultees }] }
 *
 * Chaque jour reçu REMPLACE la ligne (membre, app, appareil, jour) : c'est un
 * miroir des compteurs de l'appareil, pas un cumul. Renvoyer deux fois le même
 * lot ne change rien. Un jour revenu à zéro (note supprimée) se renvoie à zéro.
 */

const APPS = new Set(['carnet'])
const APPAREIL = /^[A-Za-z0-9-]{8,64}$/
const JOUR = /^\d{4}-\d{2}-\d{2}$/
const MAX_JOURS = 450
const MAX_COMPTEUR = 100_000
const COMPTEURS = ['ecrits', 'mentor', 'trades', 'jugements', 'consultees'] as const
const JOUR_MS = 86_400_000

function compteur(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COMPTEUR ? v : null
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const appareil = typeof body?.appareil === 'string' ? body.appareil : ''
    const app = typeof body?.app === 'string' ? body.app : 'carnet'
    const jours: unknown[] = Array.isArray(body?.jours) ? body.jours : []
    if (!APPAREIL.test(appareil)) return NextResponse.json({ error: 'appareil invalide' }, { status: 400 })
    if (!APPS.has(app)) return NextResponse.json({ error: 'app inconnue' }, { status: 400 })
    if (jours.length === 0) return NextResponse.json({ ok: true, enregistres: 0 })
    if (jours.length > MAX_JOURS) return NextResponse.json({ error: `${MAX_JOURS} jours maximum par envoi` }, { status: 400 })

    // Fenêtre acceptée : treize mois et demi en arrière, deux jours en avant
    // (fuseaux horaires). Au-delà, c'est une horloge fausse ou un envoi forgé.
    const maintenant = Date.now()
    const plusTot = maintenant - 410 * JOUR_MS
    const plusTard = maintenant + 2 * JOUR_MS

    const lignes: { jour: string; valeurs: number[] }[] = []
    const vus = new Set<string>()
    for (const brut of jours) {
      const j = brut as Record<string, unknown>
      const jour = typeof j?.jour === 'string' ? j.jour : ''
      if (!JOUR.test(jour)) return NextResponse.json({ error: `jour invalide : ${String(j?.jour).slice(0, 20)}` }, { status: 400 })
      const ts = Date.parse(`${jour}T00:00:00Z`)
      if (Number.isNaN(ts) || ts < plusTot || ts > plusTard) {
        return NextResponse.json({ error: `jour hors fenêtre : ${jour}` }, { status: 400 })
      }
      if (vus.has(jour)) return NextResponse.json({ error: `jour en double : ${jour}` }, { status: 400 })
      vus.add(jour)
      const valeurs = COMPTEURS.map(c => compteur(j[c] ?? 0))
      if (valeurs.some(v => v === null)) return NextResponse.json({ error: `compteur invalide le ${jour}` }, { status: 400 })
      lignes.push({ jour, valeurs: valeurs as number[] })
    }

    await ecrireActivite(prisma, userId, app, appareil, lignes.map(l => ({
      jour: l.jour,
      ecrits: l.valeurs[0], mentor: l.valeurs[1], trades: l.valeurs[2], jugements: l.valeurs[3], consultees: l.valeurs[4],
    })))

    return NextResponse.json({ ok: true, enregistres: lignes.length })
  } catch (error) {
    console.error('[api/activite]', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
