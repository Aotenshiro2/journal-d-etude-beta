import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import {
  SQL_NOTER_MAIL, ecarterQuestion, lienLecon, lireDemandeEquipe, listerPourEquipe, premiereReponse, repondreQuestion, signatureDuCompte,
} from '@/lib/academie/questions-lecons'
import { envoyerMailReponse } from '@/lib/academie/questions-lecons-envois'
import { relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/cockpit/academie/questions-lecons : LA BOITE des questions posees
 * sous les lecons (09/11/2026, src/lib/academie/questions-lecons.ts,
 * migration 20261109090000_academie_questions_lecons.sql). Ecran : cockpit,
 * espace Support, onglet « Questions des leçons ».
 *
 * Reservee a cockpit_allowlist (projet Supabase partage avec un site public),
 * jeton de session du cockpit en Bearer, comme /api/cockpit/academie/questions.
 *
 * { action: 'lister', vue?: 'attente' | 'traitees' }
 *   200 { ok: true, questions: [...avec lecon, module, email de l'auteur], attente }
 * { action: 'repondre', id, reponse, question?, mode: 'publier' | 'prive' }
 *   publier : la reponse (et la question, corrigee si `question` differe) sous la lecon ;
 *   prive : seul l'auteur lit la reponse. La PREMIERE reponse envoie UN email a l'auteur
 *   (lien de la lecon) ; une retouche n'envoie rien.
 *   200 { ok: true, statut, mail: 'envoye' | 'echec' | 'sans_email' | 'aucun' }
 * { action: 'ecarter', id }   une question en attente, traitee sans reponse
 *   200 { ok: true }
 * 400 { error } ; 401 ; 403 hors allowlist ; 404 question inconnue (ou plus en attente pour ecarter) ;
 * 503 { error, code: 'migration' } table absente, ou { error } base indisponible.
 *
 * Logs : action, identifiant tronque, issue du mail. Jamais un texte, un email ni un identifiant complet.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = { ...corsHeaders(req), 'Cache-Control': 'no-store' }
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  // Le garde reel : l'allowlist du cockpit.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })

  const corps: unknown = await req.json().catch(() => ({}))
  const d = lireDemandeEquipe(corps)
  if ('erreur' in d) return NextResponse.json({ error: d.erreur }, { status: 400, headers })

  try {
    if (d.action === 'lister') {
      const r = await listerPourEquipe(prisma, d.vue)
      console.info(`[cockpit/questions-lecons] lister ${d.vue} : ${r.questions.length} ligne(s), ${r.attente} en attente`)
      return NextResponse.json({ ok: true, ...r }, { headers })
    }

    if (d.action === 'ecarter') {
      const fait = await ecarterQuestion(prisma, d.id, userId)
      console.info(`[cockpit/questions-lecons] ecarter ${d.id.slice(0, 8)} : ${fait ? 'fait' : 'introuvable ou deja traitee'}`)
      if (!fait) return NextResponse.json({ error: "Cette question n'est plus en attente." }, { status: 404, headers })
      return NextResponse.json({ ok: true }, { headers })
    }

    const signature = await signatureDuCompte(prisma, userId)
    const r = await repondreQuestion(prisma, d, userId, signature)
    if (!r) return NextResponse.json({ error: 'Question introuvable.' }, { status: 404, headers })

    // Un email a la premiere reponse seulement, jamais a une retouche. Un par reponse, jamais en lot.
    let mail: 'envoye' | 'echec' | 'sans_email' | 'aucun' = 'aucun'
    if (premiereReponse(r.avant)) {
      const envoi = await envoyerMailReponse(r.email, {
        moduleTitre: r.module_titre,
        leconTitre: r.lecon_titre,
        lien: lienLecon(r.module_slug, r.lecon_slug),
        mode: d.mode,
        signature: r.signature,
      })
      mail = envoi.issue
      await prisma.$executeRawUnsafe(SQL_NOTER_MAIL, r.id, envoi.issue).catch(() => 0)
      if (envoi.raison) console.warn(`[cockpit/questions-lecons] mail NON envoye ${r.id.slice(0, 8)} : ${envoi.raison}`)
    }
    const geste = premiereReponse(r.avant) ? 'premiere' : 'retouche'
    console.info(`[cockpit/questions-lecons] repondre (${geste}) ${r.id.slice(0, 8)} : ${r.statut}, mail ${mail}`)
    return NextResponse.json({ ok: true, statut: r.statut, mail }, { headers })
  } catch (err) {
    if (relationAbsente(err)) {
      return NextResponse.json(
        { error: 'Migration des questions sous les leçons pas encore appliquée (20261109090000).', code: 'migration' },
        { status: 503, headers },
      )
    }
    // Jamais le message brut : il peut reprendre le texte d'une question ou d'une reponse.
    console.error(`[cockpit/questions-lecons] ${d.action} : echec (${err instanceof Error ? err.name : 'erreur'})`)
    return NextResponse.json({ error: 'La base est illisible pour le moment.' }, { status: 503, headers })
  }
}
