import { NextRequest, NextResponse } from 'next/server'
import { decisionWebhook } from '@/lib/liveclub/rebonds-pur'
import { expediteursLiveClub, rebondsCoupes, traiterRebondServeur } from '@/lib/liveclub/rebonds'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/liveclub/resend : webhook Resend du Live Club (31/10/2026). Un
 * email du Live Club refuse par la boite du destinataire (email.bounced),
 * marque comme spam (email.complained) ou bloque par Resend (email.suppressed) :
 * l'equipe est prevenue dans Agent AOK (une fois par adresse et par jour), le
 * membre en prive s'il a un compte Telegram relie au bot (une fois par
 * adresse), l'invitation d'un acces broker repasse « pas envoyee » pour une
 * adresse morte, et le journal du bot garde une ligne (resume du matin).
 * Regles et textes : src/lib/liveclub/rebonds-pur.ts ; serveur : rebonds.ts.
 *
 * Route PUBLIQUE (middleware.ts). Signature Svix verifiee ici
 * (RESEND_WEBHOOK_SECRET_LIVECLUB, « whsec_... », 5 min de tolerance), sans
 * dependance. Sans la variable : 503, rien n'est lu. Signature absente ou
 * fausse : 400, rien n'est traite. Tout autre evenement, ou un email d'un
 * autre produit du compte Resend : 200 et rien. Meme svix-id : traite une
 * fois. 500 = Resend rejoue plus tard (base indisponible, ou alerte pas
 * partie). LIVECLUB_REBONDS=0 coupe tout (200). Jamais d'adresse ni de texte
 * dans un log.
 */

export const dynamic = 'force-dynamic'
// Une lecture Stripe, quelques requetes, un message prive et l'alerte.
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET_LIVECLUB?.trim()
  if (!secret) {
    console.warn('[liveclub/resend] RESEND_WEBHOOK_SECRET_LIVECLUB absent : webhook non branche')
    return NextResponse.json({ ok: false, erreur: 'config' }, { status: 503 })
  }
  const corps = await req.text()
  const d = decisionWebhook({
    secret,
    corps,
    entetes: {
      id: req.headers.get('svix-id'),
      horodatage: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    maintenantS: Math.floor(Date.now() / 1000),
    expediteurs: expediteursLiveClub(),
    coupe: rebondsCoupes(),
  })
  if (d.statut === 503 || d.statut === 400) {
    return NextResponse.json({ ok: false, erreur: d.erreur }, { status: d.statut })
  }
  if (d.statut === 200) return NextResponse.json({ ok: true, ignore: d.ignore })

  try {
    const b = await traiterRebondServeur(d.evenement, d.svixId)
    if (b.etat === 'deja') return NextResponse.json({ ok: true, deja: true })
    if (b.aRejouer) return NextResponse.json({ ok: false, erreur: 'alerte_non_envoyee' }, { status: 500 })
    return NextResponse.json({ ok: true, alerte: b.alerte, membre: b.membre })
  } catch (err) {
    console.warn(`[liveclub/resend] evenement NON traite : ${messageErreur(err).split('\n')[0].slice(0, 160)}`)
    return NextResponse.json({ ok: false, erreur: 'indisponible' }, { status: 500 })
  }
}
