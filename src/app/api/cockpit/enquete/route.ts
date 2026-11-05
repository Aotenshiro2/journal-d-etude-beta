import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { aiErrorMessage } from '@/lib/ai'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { menerEnquete, preparerEnquete } from '@/lib/fonds-enquete'

// CHERCHER EN LIGNE CE QU'ON SAIT D'UNE PERSONNE DU FONDS (07/09/2026).
//
// Brice : « même quand une personne n'est pas une personnalité publique,
// j'aimerais pouvoir faire une recherche sur lui/elle : ses réseaux, une
// société, une chaîne YouTube, un blog, LinkedIn, Insta, sa localisation. »
//
// Le coeur (ancrage, recherche web, mise en propositions, ecriture en
// `cockpit_arch_propositions` avec statut « proposee ») vit dans
// src/lib/fonds-enquete.ts depuis le 05/11/2026 : la carte d'Agent AOK
// (LOT 2, Brice : « que l'agent puisse faire depuis Telegram les gestes du
// cockpit ») appelle les memes fonctions. Ici : le droit (acces_fonds),
// l'identifiant, et les memes reponses qu'avant.
//
// Ce qui a déjà été refusé par un humain n'est pas reproposé.

export const maxDuration = 300

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  // Le fonds a son propre portail : il faut acces_fonds, pas seulement être du cockpit.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid and acces_fonds`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé aux comptes qui voient le fonds' }, { status: 403, headers: cors })
  }

  const body = await req.json().catch(() => ({}))
  const personneId = typeof body.personne_id === 'string' ? body.personne_id.slice(0, 200) : ''
  if (!/^p-[a-z0-9-]+$/i.test(personneId)) {
    return NextResponse.json({ error: 'personne_id manquant' }, { status: 400, headers: cors })
  }

  // --- 1. L'ancrage : ce que le fonds sait déjà ----------------------------
  const prep = await preparerEnquete(personneId)
  if (!prep) return NextResponse.json({ error: 'Personne inconnue du fonds' }, { status: 404, headers: cors })

  try {
    // --- 2 a 4. La recherche, les propositions, la base ---------------------
    const r = await menerEnquete(userId, prep)
    return NextResponse.json({
      enquete_id: r.enquete_id,
      posees: r.posees,
      resume: r.resume,
      homonymes: r.homonymes,
      sources: r.sources,
    }, { headers: cors })
  } catch (err) {
    console.error('[cockpit/enquete]', err)
    return NextResponse.json(
      { error: aiErrorMessage(err, 'ANTHROPIC_API_KEY_COCKPIT') },
      { status: 502, headers: cors },
    )
  }
}
