import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { buildMentoratBrief } from '@/lib/mentorat-brief'
import { aiClient, AI_MODEL, logAiUsage, textOf } from '@/lib/ai'

// La génération réfléchit : bien au-delà des 10 s par défaut de Vercel
export const maxDuration = 60

// Cadre du plan d'évolution — version dogfooding. La doctrine ETM payante
// (question 3, à trancher avec Brice) remplacera ce cadrage générique ; le
// contrat, lui, ne changera pas : l'IA PROPOSE (statut proposed), Brice
// VALIDE avant que l'élève ne voie quoi que ce soit.
const SYSTEM_PROMPT = `Tu es l'assistant pédagogique d'Ao Knowledge (école de trading de Brice, méthode Elite Trader Mentorship). Tu rédiges une PROPOSITION de plan d'évolution pour un élève, à partir de son brief chiffré. Un mentor humain validera ou corrigera ta proposition avant qu'elle n'atteigne l'élève : propose, ne décrète jamais.

Le cadre de lecture :
- A/B/C note la qualité de la DÉCISION, jamais le résultat. Un A perdant est une bonne nouvelle (process solide), un C gagnant est un danger (le hasard récompense une erreur).
- Les causes d'erreur ont trois familles : technique et exécution, connaissance, mental et émotionnel. La famille dominante dicte le type de travail.
- Le progrès se mesure au PLANCHER : réduire les C (méthode inchworm), pas seulement empiler des A.
- La relecture à deux semaines est le mécanisme d'ancrage : un retard de relecture est un chantier en soi.

Format de sortie, en français, tutoiement, sans tiret cadratin :
1. « Où tu en es » : 2 ou 3 phrases factuelles tirées du brief, sans complaisance ni dramatisation.
2. « Le chantier prioritaire » : UN seul axe de travail, celui qui débloquera le reste, justifié par les chiffres du brief.
3. « Le plan des 2 prochaines semaines » : 3 actions maximum, concrètes, vérifiables dans le carnet (ex. « note tes trades dans l'heure », pas « sois plus discipliné »).
4. « Le signal de passage » : à quoi on verra dans les chiffres que c'est acquis.

Interdits : conseil financier personnalisé, promesse de gains, jargon inutile, invention de données absentes du brief. Si le brief est trop maigre pour un plan honnête, dis-le et propose d'abord d'enrichir la documentation (plus de trades notés, causes posées).`

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const raw = Number(body.days)
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(7, Math.round(raw))) : 90

  let client
  try {
    client = aiClient('mentorat')
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Clé API absente' }, { status: 503 })
  }

  try {
    const brief = await buildMentoratBrief(userId, days)
    const model = AI_MODEL.mentorat
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Voici le brief de l'élève :\n\n${brief.text}` }],
    })
    const plan = textOf(response)
    if (!plan) return NextResponse.json({ error: 'Génération vide, réessaie.' }, { status: 502 })
    await logAiUsage(userId, 'mentorat', model, response.usage)

    const saved = await prisma.mentoratPlan.create({
      data: {
        userId,
        periodDays: days,
        brief: brief as unknown as object,
        plan,
        status: 'proposed',
      },
    })
    return NextResponse.json({ planId: saved.id, status: saved.status, plan, brief: brief.text })
  } catch (err) {
    console.error('[mentorat/plan]', err)
    return NextResponse.json({ error: 'Plan indisponible, réessaie.' }, { status: 502 })
  }
}

/** GET /api/mentorat/plan — le dernier plan proposé/validé de l'élève */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const last = await prisma.mentoratPlan.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, periodDays: true, plan: true, status: true, createdAt: true },
  })
  return NextResponse.json({ plan: last })
}
