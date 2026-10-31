import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ErreurKit, cleKit, clientKit } from '@/lib/kit'
import { CHOIX_KIT } from '@/lib/kit-choix'
import { tagsInscription } from '@/lib/kit-abonnements-pur'
import { depotPrisma } from '@/lib/kit-abonnements-depot'
import { normaliserEmail } from '@/lib/emails-confirmation-pur'
import { compteDuJeton, tronquer } from '@/lib/academie/http'
import { decisionInscription, type CompteInscription } from '@/lib/newsletter-inscription-pur'

// Inscription a la newsletter (journal /auth, extension Carnet), juste apres la
// creation d'un compte. Route PUBLIQUE depuis le 31/10/2026 (middleware) : ces
// deux appels n'ont pas encore de session, et recevaient un 401. La garde est
// dans newsletter-inscription-pur.ts : sans session, seulement l'adresse d'un
// compte cree depuis moins de 24 h qui a coche « newsletter », une seule fois.
// Une demande ecartee recoit la meme reponse qu'une demande servie.
//
// Rien du corps n'est transmis a Kit, sauf l'adresse normalisee : le prenom
// vient du profil. Un NOUVEL abonne recoit d'office les choix marques
// « inscription » dans src/lib/kit-choix.ts (tous sauf les offres de
// partenaires), et ces accords sont notes dans profile_consentements. Un abonne
// qui existait deja garde ses choix. Cle : CONVERTKIT_API_KEY (sinon KIT_API_KEY).
// Logs : compte tronque et statut, jamais l'adresse.

export const dynamic = 'force-dynamic'

const servie = () => NextResponse.json({ ok: true })

export async function POST(req: NextRequest) {
  let corps: Record<string, unknown>
  try { corps = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'email required' }, { status: 400 }) }
  const email = normaliserEmail(corps?.email)
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const cle = cleKit()
  if (!cle) {
    console.error('[Newsletter] CONVERTKIT_API_KEY not set')
    return NextResponse.json({ error: 'not configured' }, { status: 500 })
  }

  let connecte: string | null = null
  try { connecte = await compteDuJeton(req) } catch { connecte = null }

  let adressesDuConnecte: string[] = []
  let compte: CompteInscription | null = null
  try {
    if (connecte) {
      const r = await prisma.$queryRawUnsafe<{ e: string | null }[]>(
        `select lower(btrim(u.email)) as e from auth.users u where u.id = $1::uuid
         union
         select lower(btrim(pe.email)) from public.profile_emails pe where pe.profile_id = $1::uuid and pe.verified`, connecte)
      adressesDuConnecte = r.map(x => x.e).filter((x): x is string => !!x)
    } else {
      const r = await prisma.$queryRawUnsafe<{ id: string; cree: Date; nl: boolean; deja: boolean }[]>(
        `select u.id::text as id, u.created_at as cree,
                coalesce(u.raw_user_meta_data->>'newsletter_subscribed', '') = 'true' as nl,
                exists (select 1 from public.profile_consentements c
                         where c.profile_id = u.id and c.source = 'inscription') as deja
           from auth.users u where lower(btrim(u.email)) = $1 limit 1`, email)
      compte = r[0] ? { id: r[0].id, creeLe: new Date(r[0].cree), newsletter: r[0].nl, dejaInscrit: r[0].deja } : null
    }
  } catch (err) {
    console.error('[Newsletter] base illisible :', err instanceof Error ? err.name : 'erreur')
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }

  const d = decisionInscription({ connecte, adressesDuConnecte, compte, email, maintenant: new Date() })
  if (d.action === 'ignorer') {
    console.info(`[Newsletter] demande ecartee (${d.raison})`)
    return servie()
  }

  const depot = depotPrisma(prisma)
  const kit = clientKit(cle)
  try {
    const prenom = await depot.prenom(d.profileId)
    const { abonne, cree } = await kit.creerAbonne(email, prenom)
    if (cree) {
      const tags = tagsInscription(CHOIX_KIT)
      for (const tag of tags) await kit.poserTag(tag, abonne.id)
      await depot.lier(d.profileId, abonne.id)
      await depot.consentir(d.profileId, CHOIX_KIT.filter(c => tags.includes(c.tag)).map(c => ({
        type: c.cle, tag: c.tag, valeur: true, source: 'inscription' as const, kitId: abonne.id,
      })))
    }
    console.info(`[Newsletter] compte=${tronquer(d.profileId)} ${cree ? 'abonne cree' : 'abonne deja present'}`)
  } catch (err) {
    const statut = err instanceof ErreurKit ? err.statut : 502
    console.error('[Newsletter] Kit ou base :', err instanceof ErreurKit ? `kit ${statut}` : (err instanceof Error ? err.name : 'erreur'))
    return NextResponse.json({ error: 'kit' }, { status: statut >= 400 && statut < 600 ? statut : 502 })
  }

  return servie()
}
