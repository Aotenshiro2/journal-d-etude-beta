import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { annulerSeanceCal, poserSeanceCal } from '@/lib/coaching/base'
import { lireEvenementCal, lireTypesSuivis, verifierSignatureCal } from '@/lib/coaching/pur'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/coaching/cal : le webhook du compte Cal de Brice (Mon coaching,
 * 09/11/2026, src/lib/coaching/). Route PUBLIQUE (middleware.ts), signature
 * verifiee ici : en-tete X-Cal-Signature-256 = HMAC-SHA256 hexadecimal du corps
 * brut avec CAL_WEBHOOK_SECRET.
 *
 * Variables du journal :
 *   CAL_WEBHOOK_SECRET   le secret du webhook, pose dans Cal. ABSENT = la route
 *                        refuse tout (503), aucune lecture du corps.
 *   CAL_COACHING_TYPES   les types d'evenement Cal qui sont des seances de
 *                        coaching (slugs ou ids, separes par des virgules). Vide =
 *                        aucune seance ne se pose (un appel decouverte ne doit
 *                        jamais consommer un pack) ; les annulations passent.
 *
 * Evenements suivis :
 *   BOOKING_CREATED, BOOKING_PAID, BOOKING_RESCHEDULED : la seance (prevue) est
 *     creee ou mise a jour, rattachee au membre par l'email de l'invite (memes
 *     regles que SQL_COMPTES_DE_EMAIL) ; un report deplace la seance d'origine.
 *     Une heure payee chez Cal (BOOKING_PAID) cree aussi son droit d'une seance.
 *   BOOKING_CANCELLED, BOOKING_REJECTED : la seance passe annulee (et le droit
 *     ne de son paiement Cal est retire).
 *   Tout le reste (PING compris) : 200 { ok: true, ignore }.
 *
 * Reponses : 200 { ok, ... } ; 401 signature ; 400 corps ; 503 config ou
 * migration ; 500 base (a rejouer depuis Cal). Logs : declencheur, issue,
 * identifiants tronques. Jamais un email, un nom ni le corps.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_CORPS = 256 * 1024

export async function POST(req: NextRequest) {
  const secret = process.env.CAL_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.warn('[coaching/cal] CAL_WEBHOOK_SECRET absent : tout est refuse')
    return NextResponse.json({ ok: false, erreur: 'config' }, { status: 503 })
  }
  const corps = await req.text()
  if (corps.length > MAX_CORPS || !verifierSignatureCal(corps, req.headers.get('x-cal-signature-256'), secret)) {
    console.warn('[coaching/cal] signature refusee')
    return NextResponse.json({ ok: false, erreur: 'signature' }, { status: 401 })
  }
  let brut: unknown
  try { brut = JSON.parse(corps) } catch { return NextResponse.json({ ok: false, erreur: 'corps' }, { status: 400 }) }

  const ev = lireEvenementCal(brut, lireTypesSuivis(process.env.CAL_COACHING_TYPES))
  try {
    if (ev.geste === 'ignorer') {
      console.info(`[coaching/cal] ${ev.declencheur ?? '?'} ignore (${ev.raison})`)
      return NextResponse.json({ ok: true, ignore: ev.raison })
    }
    if (ev.geste === 'annuler') {
      const r = await annulerSeanceCal(prisma, ev.uid)
      console.info(`[coaching/cal] ${ev.declencheur} ${ev.uid.slice(0, 6)} : ${r.annulee ? 'annulee' : 'inconnue ou deja traitee'}${r.droit_retire ? ', droit Cal retire' : ''}`)
      return NextResponse.json({ ok: true, ...r })
    }
    const r = await prisma.$transaction(tx => poserSeanceCal(tx, ev), { timeout: 20_000 })
    console.info(`[coaching/cal] ${ev.declencheur} ${ev.uid.slice(0, 6)} : seance ${r.seance.slice(0, 8)} ${r.etat}, droit ${r.droit}${ev.ancienUid ? ' (report)' : ''}`)
    return NextResponse.json({ ok: true, etat: r.etat, droit: r.droit })
  } catch (err) {
    if (relationAbsente(err)) return NextResponse.json({ ok: false, erreur: 'migration' }, { status: 503 })
    console.error(`[coaching/cal] ${ev.declencheur ?? '?'} : echec (${messageErreur(err).slice(0, 80)})`)
    return NextResponse.json({ ok: false, erreur: 'base' }, { status: 500 })
  }
}
