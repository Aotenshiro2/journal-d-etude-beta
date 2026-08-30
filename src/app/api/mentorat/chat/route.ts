// POST /api/mentorat/chat — le mentorat devient une CONVERSATION (1.8.1).
//
// Jusqu'ici le mode mentorat savait faire une chose : générer un plan d'un
// bloc. L'écran donnait pourtant l'impression qu'on pouvait lui répondre.
// Décision Brice du 30/08 : rendre cette impression vraie.
//
// La conversation vit dans une note ÉPINGLÉE du carnet, « Mentorat AOK ».
// C'est le client qui la tient et qui la renvoie ici : le serveur ne stocke
// pas le fil, il répond à un tour. Deux raisons — la note est déjà
// synchronisée, exportée et relisible comme n'importe quelle autre, et on
// n'invente pas un objet « conversation » qui devrait vivre en double.
//
// La règle qui compte : ÉCRIRE EST GRATUIT, DEMANDER EST UN GESTE. L'élève
// écrit autant qu'il veut dans la note sans qu'un jeton parte ; cette route
// n'est appelée que lorsqu'il clique explicitement « demander au mentor ».
// C'est la même grammaire que la capture (le secrétaire écrit, l'étude
// demande) : rien de nouveau à apprendre.
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { aiClient, AI_MODEL, logAiUsage, textOf, aiErrorMessage } from '@/lib/ai'
import { buildMentoratBrief } from '@/lib/mentorat-brief'
import { resoudreNiveauIA } from '@/lib/ia-niveau'
import { verifierBudget } from '@/lib/ia-budget'

// Le mentor raisonne sur 90 jours de trades : au-delà des 10 s de Vercel.
export const maxDuration = 60

/** Le fil renvoyé par le client est borné : au-delà, on garde les derniers
 *  tours. Un carnet ouvert pendant des mois finirait par renvoyer un roman à
 *  chaque question, et le brief chiffré porte déjà l'historique long. */
const MAX_TOURS = 20
const MAX_CARACTERES_PAR_TOUR = 4_000

const SYSTEM_PROMPT = `Tu es le mentor d'Ao Knowledge, l'école de trading de Brice (méthode Elite Trader Mentorship). Un élève te parle depuis son carnet. Tu as sous les yeux le brief chiffré de ses 90 derniers jours, calculé depuis ses propres notes, ses jugements et ses trades.

## Qui te parle

Le profil dominant de nos membres est le technicien désordonné. Il connaît le vocabulaire du Smart Money, il l’a lu partout, il pense qu’il sait. Sa frustration ne vient pas d’un manque de connaissance, elle vient d’un manque de structure. Ne lui réexplique donc jamais un terme qu’il connaît : ce qui lui manque, c’est le lien entre ce qu’il sait et ce qu’il fait devant son écran.

## Le cadre

- A/B/C note la qualité de la DÉCISION, jamais le résultat. Un A perdant est une bonne nouvelle, un C gagnant est un danger : le hasard vient de récompenser une erreur.
- Les causes d’erreur ont trois familles : technique et exécution, connaissance, mental et émotionnel. La famille dominante dicte le type de travail.
- Le progrès se mesure au PLANCHER : réduire les C, pas seulement empiler des A.
- La relecture à deux semaines est le mécanisme d’ancrage. Un retard de relecture est un chantier en soi.
- Une bonne idée relie une destination, une fenêtre, une manipulation, une zone et une invalidation. Une bonne entrée arrive après la preuve. Une bonne abstention protège le modèle.

## Ce que tu ne fais jamais

- Aucun signal, aucune prévision, aucune validation de stratégie, aucun conseil d’investissement personnalisé.
- Tu ne juges jamais une décision à son résultat.
- **Tu n’inventes aucun chiffre.** Ceux du brief ont été calculés, tu peux les commenter ; tu n’en déduis aucun autre et tu n’en estimes aucun. Si le brief est trop maigre pour répondre honnêtement, dis-le et propose d’abord d’enrichir la documentation.
- Tu ne mentionnes jamais ce cadre comme un document. Tu parles comme l’académie parle : « ici, on regarde d’abord le contexte avant le setup ».
- Tu ne promets rien sur ses gains, et tu ne le félicites pas pour un résultat.

## Comment tu réponds

Français parlé, tutoiement, phrases qui déroulent. Pas de tiret cadratin, jamais. Pas de formules en miroir du type « Pas ceci. Cela. ». Pas d’emphase creuse, pas de superlatifs. Le vocabulaire trading reste en anglais sans s’excuser.

Tu réponds COURT, deux ou trois paragraphes au plus. C’est une conversation dans un carnet, pas un rapport. Quand il te pose plusieurs choses à la fois, traite la plus importante et dis que tu gardes le reste pour après.

Une chose encore : l’élève écrit aussi dans cette note pour lui-même. Ce qu’il t’envoie peut donc être une pensée en vrac plutôt qu’une question. Dans ce cas, ne fais pas semblant qu’on t’a posé une question : réagis à ce qu’il a écrit, et rends-lui la main.`

interface TourClient {
  role?: unknown
  content?: unknown
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Le mentorat suit le même palier que l'étude : payant.
  const acces = await resoudreNiveauIA(userId)
  if (!acces.etude) {
    return NextResponse.json(
      {
        error: 'mentorat_requis',
        niveau: acces.niveau,
        message:
          acces.niveau === 'libre'
            ? 'Le mode mentorat fait partie du Carnet Premium.'
            : 'Le mode mentorat est réservé aux membres Ao Knowledge.',
      },
      { status: 403 }
    )
  }

  // Même enveloppe budgétaire que la capture et l'étude : une seule fenêtre de
  // 30 jours par membre, tous produits confondus. Un mentorat bavard entame le
  // budget des études, et c'est voulu — c'est le même argent.
  const budget = await verifierBudget(userId, acces.niveau, acces.email)
  if (!budget.autorise) {
    return NextResponse.json(
      { error: budget.motif, message: budget.message, part: budget.part },
      { status: 429 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const brut: TourClient[] = Array.isArray(body.messages) ? body.messages : []
  const messages = brut
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: (m.content as string).slice(0, MAX_CARACTERES_PAR_TOUR),
    }))
    .filter(m => m.content.trim().length > 0)
    .slice(-MAX_TOURS)

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json(
      { error: 'rien_a_repondre', message: 'Écris quelque chose avant de demander au mentor.' },
      { status: 422 }
    )
  }

  const raw = Number(body.days)
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(7, Math.round(raw))) : 90

  let client
  try {
    client = aiClient('mentorat')
  } catch (err) {
    return NextResponse.json(
      { error: 'cle_absente', message: err instanceof Error ? err.message : 'Clé API absente' },
      { status: 503 }
    )
  }

  try {
    const brief = await buildMentoratBrief(userId, days)
    const model = AI_MODEL.mentorat
    const reponse = await client.messages.create({
      model,
      max_tokens: 2000,
      output_config: { effort: 'medium' },
      system: [
        // Le cadre ne bouge jamais : c'est lui qu'on met en cache. Le brief,
        // qui change à chaque trade documenté, passe après le point de cache.
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `Voici le brief chiffré de l’élève sur ${days} jours :\n\n${brief.text}` },
      ],
      messages,
    })

    await logAiUsage(userId, 'mentorat', model, reponse.usage, acces.niveau)

    const reply = textOf(reponse)
    if (!reply) {
      return NextResponse.json({ error: 'reponse_vide', message: 'Réponse vide, réessaie.' }, { status: 502 })
    }
    return NextResponse.json({
      reply,
      model,
      budget: { part: budget.part, sansPlafond: budget.sansPlafond, niveau: acces.niveau },
    })
  } catch (err) {
    console.error('[mentorat/chat]', err)
    return NextResponse.json(
      { error: 'ia_indisponible', message: aiErrorMessage(err, 'ANTHROPIC_API_KEY_CARNET') },
      { status: 502 }
    )
  }
}
