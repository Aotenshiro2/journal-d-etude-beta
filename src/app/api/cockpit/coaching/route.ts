import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import {
  SQL_FICHES_DES_EMAILS, SQL_TOUS_DROITS, SQL_TOUTES_SEANCES, accorderDroit, ajouterSeance, changerStatutSeance, confirmerDetection,
  corrigerDroit, droitsDesEmails, ecarterDetection, libellesEquipe, listerDetections, retirerDroit, seancesDesEmails,
  type DroitLu, type SeanceLue,
} from '@/lib/coaching/base'
import { TEXTE_ERREUR, lireDemandeCockpit, regrouperParPersonne, resumerCoaching, type FicheEmail } from '@/lib/coaching/pur'
import { relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/cockpit/coaching : Mon coaching cote equipe (09/11/2026,
 * src/lib/coaching/, migration 20261109140000_coaching_seances.sql). Ecrans :
 * la rubrique « Coaching » de la fiche membre et l'onglet Coaching de l'espace
 * Academie du cockpit. C'est le branchement de Melanie (elle n'a pas de Cal).
 *
 * Reservee a cockpit_allowlist (projet Supabase partage avec un site public),
 * jeton de session du cockpit en Bearer, comme /api/cockpit/academie.
 *
 *   { action: 'lister' }   la vue Coaching : detections Meet a confirmer, prochaines
 *                          seances, chaque personne avec son reste
 *   { action: 'fiche', emails }   les droits, seances et le reste des emails d'une fiche
 *   { action: 'ajouter_seance', email, coach, debut, duree_min, statut?, note? }
 *   { action: 'statut_seance', id, statut: 'prevue' | 'faite' | 'annulee' }
 *   { action: 'accorder_droit', email, coach, seances, source: 'offert' | 'etm', depuis?, note? }
 *   { action: 'corriger_droit', id, seances, note? }   (pas un pack : un pack se complete par un droit offert)
 *   { action: 'retirer_droit', id }                    (retire_le, rien ne s'efface)
 *   { action: 'confirmer_detection', id, email, coach?, duree_min? }   cree la seance (faite, source meet)
 *   { action: 'ecarter_detection', id }
 * Les gestes rendent { ok: true } : l'ecran relit (« recharger a l'action »).
 * 400 { error } ; 401 ; 403 hors allowlist ; 404 introuvable ;
 * 503 { error, code: 'migration' } tables absentes, ou { error } base indisponible.
 *
 * Logs : action et identifiants tronques. Jamais un email, une note ni un nom.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

const nettoyerDroit = (d: DroitLu, libelles: Map<string, string>) => ({
  ...d, pose_par_libelle: d.pose_par ? libelles.get(d.pose_par) ?? (d.pose_par.startsWith('cockpit:') ? 'équipe' : d.pose_par) : null,
})
const nettoyerSeance = (x: SeanceLue, libelles: Map<string, string>) => ({
  ...x, pose_par_libelle: libelles.get(x.pose_par) ?? (x.pose_par.startsWith('cockpit:') ? 'équipe' : x.pose_par),
})

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = { ...corsHeaders(req), 'Cache-Control': 'no-store' }
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })

  const corps: unknown = await req.json().catch(() => ({}))
  const d = lireDemandeCockpit(corps)
  if ('erreur' in d) return NextResponse.json({ error: TEXTE_ERREUR[d.erreur] }, { status: 400, headers })
  const par = `cockpit:${userId}`
  const introuvable = (m: string) => NextResponse.json({ error: m }, { status: 404, headers })

  try {
    switch (d.action) {
      case 'lister': {
        const [droits, seances, detections, libelles] = await Promise.all([
          prisma.$queryRawUnsafe<DroitLu[]>(SQL_TOUS_DROITS),
          prisma.$queryRawUnsafe<SeanceLue[]>(SQL_TOUTES_SEANCES),
          listerDetections(prisma),
          libellesEquipe(prisma),
        ])
        const emails = [...new Set([...droits, ...seances].map(x => x.email).filter((e): e is string => Boolean(e)))]
        const fiches = emails.length ? await prisma.$queryRawUnsafe<FicheEmail[]>(SQL_FICHES_DES_EMAILS, emails) : []
        const personnes = regrouperParPersonne(droits, seances, fiches)
        const ficheDe = new Map(fiches.map(f => [f.email, f]))
        const maintenant = Date.now()
        const prochaines = seances
          .filter(x => x.statut === 'prevue' && new Date(x.debut).getTime() >= maintenant - 3_600_000)
          .sort((a, b) => new Date(a.debut).getTime() - new Date(b.debut).getTime())
          .slice(0, 30)
          .map(x => ({ ...nettoyerSeance(x, libelles), nom: x.email ? ficheDe.get(x.email)?.nom ?? null : null }))
        console.info(`[cockpit/coaching] lister : ${personnes.length} personne(s), ${detections.filter(x => x.statut === 'a_confirmer').length} detection(s) a confirmer`)
        return NextResponse.json({ ok: true, personnes, prochaines, detections }, { headers })
      }
      case 'fiche': {
        const [droits, seances, libelles] = await Promise.all([
          droitsDesEmails(prisma, d.emails), seancesDesEmails(prisma, d.emails), libellesEquipe(prisma),
        ])
        const resume = resumerCoaching(droits, seances)
        return NextResponse.json({
          ok: true, resume,
          droits: droits.map(x => nettoyerDroit(x, libelles)),
          seances: seances.map(x => nettoyerSeance(x, libelles)),
        }, { headers })
      }
      case 'ajouter_seance': {
        const s = await ajouterSeance(prisma, d, par)
        console.info(`[cockpit/coaching] seance ${s.id.slice(0, 8)} ajoutee (${d.coach}, ${d.statut})`)
        return NextResponse.json({ ok: true, id: s.id }, { headers })
      }
      case 'statut_seance': {
        const s = await changerStatutSeance(prisma, d.id, d.statut, par)
        if (!s) return introuvable('Séance introuvable.')
        console.info(`[cockpit/coaching] seance ${d.id.slice(0, 8)} -> ${d.statut}`)
        return NextResponse.json({ ok: true }, { headers })
      }
      case 'accorder_droit': {
        const r = await accorderDroit(prisma, d, par)
        console.info(`[cockpit/coaching] droit ${r.id.slice(0, 8)} accorde (${d.coach}, ${d.source}, ${d.seances})`)
        return NextResponse.json({ ok: true, id: r.id }, { headers })
      }
      case 'corriger_droit': {
        const r = await corrigerDroit(prisma, d.id, d.seances, d.note)
        if (!r) return introuvable("Droit introuvable ou retiré (un pack se complète par un droit offert).")
        console.info(`[cockpit/coaching] droit ${d.id.slice(0, 8)} corrige (${d.seances})`)
        return NextResponse.json({ ok: true }, { headers })
      }
      case 'retirer_droit': {
        const fait = await retirerDroit(prisma, d.id, par)
        if (!fait) return introuvable("Droit introuvable ou déjà retiré (un pack se retire par l'accès de l'académie).")
        console.info(`[cockpit/coaching] droit ${d.id.slice(0, 8)} retire`)
        return NextResponse.json({ ok: true }, { headers })
      }
      case 'confirmer_detection': {
        const s = await prisma.$transaction(tx => confirmerDetection(tx, d, par), { timeout: 20_000 })
        if (!s) return introuvable("Cet enregistrement n'est plus à confirmer.")
        console.info(`[cockpit/coaching] detection ${d.id.slice(0, 8)} confirmee : seance ${s.id.slice(0, 8)}`)
        return NextResponse.json({ ok: true, id: s.id }, { headers })
      }
      case 'ecarter_detection': {
        const fait = await ecarterDetection(prisma, d.id, par)
        if (!fait) return introuvable("Cet enregistrement n'est plus à confirmer.")
        console.info(`[cockpit/coaching] detection ${d.id.slice(0, 8)} ecartee`)
        return NextResponse.json({ ok: true }, { headers })
      }
    }
  } catch (err) {
    if (relationAbsente(err)) {
      return NextResponse.json(
        { error: 'Migration Mon coaching pas encore appliquée (20261109140000).', code: 'migration' },
        { status: 503, headers },
      )
    }
    console.error(`[cockpit/coaching] ${d.action} : echec (${err instanceof Error ? err.name : 'erreur'})`)
    return NextResponse.json({ error: 'La base est illisible pour le moment.' }, { status: 503, headers })
  }
}
