import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { aiClient, AI_MODEL, logAiUsage, textOf, aiErrorMessage } from '@/lib/ai'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import type Anthropic from '@anthropic-ai/sdk'

// L'agent du cockpit (decision Brice du 29/08) : un assistant prive pour
// Brice et Melanie, qui repond aux questions de pilotage en INTERROGEANT la
// base (outil SQL en lecture seule). V1 sans action : marquer traite,
// repondre au support etc. viendront apres cadrage — l'agent le dit quand on
// le lui demande.
//
// Garde : la meme allowlist que tout le cockpit, verifiee cote serveur.

export const maxDuration = 120

const MAX_HISTORY = 20
const MAX_MESSAGE_LEN = 4000
const MAX_TOURS = 8
const MAX_RESULTAT = 14000

const SYSTEM_PROMPT = `Tu es l'agent privé du Cockpit AOK, au service exclusif de Brice (fondateur) et Mélanie (gère le Stripe du récurrent et la compta). Tu réponds en français, en tutoyant, court et chiffré. N'utilise jamais de tiret cadratin.

Ton rôle : répondre à leurs questions de pilotage en interrogeant la base via l'outil requete_sql (lecture seule). Ne réponds JAMAIS un chiffre de mémoire : chaque chiffre vient d'une requête exécutée. Si une requête échoue, adapte-la (commence par un select * ... limit 3 pour découvrir les colonnes).

Les tables et vues du cockpit (schéma public, PostgreSQL) :
- cockpit_membres_etat (vue, 1 ligne par membre) : membre_id, nom, prenom, date_entree, tier_skool (standard|premium|vip), source_entree, email_principal, nb_emails, total_paye, nb_paiements, dernier_paiement, abonnement_en_cours (bool), a_achete_ponctuel (bool), nb_abonnements, fin_periode, origine_statut (declare|deduit|aucun)
- cockpit_paiements : paiement_id, source (stripe|paypal|skool|virement|autre), date_paiement (date), montant, devise, libelle_source, membre_id, offre_id, rembourse (bool). Un remboursement = paiement négatif.
- cockpit_abonnements : abonnement_id, compte (melanie|aoknowledge), membre_id, offre_id, statut (active|trialing|past_due|unpaid|incomplete|canceled|ended), montant, periodicite (month|quarter|year), debut, fin_periode, annule_le, annule_a_la_fin (bool)
- cockpit_offres : offre_id, nom, nature, recurrence, actif
- cockpit_actions (vue, ce qui demande un geste) : membre_id, nom, email_principal, tier_skool, produits, fin_proche, annule_le, total_paye, dernier_paiement, motif (retirer_live_club|paiement_en_echec|resiliation_demandee|echeance_proche|acces_sans_paiement), urgence, acces_conserves, acces_offert, prochaine_tentative, nb_tentatives, telegram
- cockpit_actions_traitees : membre_id, motif, traite_le, traite_par, note (ce que Brice/Mélanie ont marqué fait depuis le cockpit)
- cockpit_kpis : snapshot_date, key, value_num, value_text (agrégats hebdo : audience_cumul, audience_indice, ns1_kit_cumul, ns2_skool_cumul…)
- cockpit_metrics_monthly : month (YYYY-MM), source, metric, value (séries mensuelles toutes plateformes)
- cockpit_snapshots : snapshot_date, generated_at, source_export_dates (json), missing (json)
- cockpit_support_threads (vue) : id, user_id, email, app, messages (jsonb, [{role,content,at}]), escalated_at, created_at, updated_at
- "AiUsage" (guillemets obligatoires, colonnes camelCase entre guillemets) : "userId", product, model, "inputTokens", "outputTokens", "createdAt"
- cockpit_releves_audience : relevés d'audience par compte (colonnes à découvrir au besoin)

Le modèle métier, à ne pas réinventer :
- DEUX comptes Stripe : aoknowledge = le comptant (formations, VIP), melanie = TOUT le récurrent (Live Club). Le chiffre complet demande les deux.
- Le Live Club est une communauté : résilier ne retire pas les achats comptants (acces_conserves les liste).
- Le tier Skool ne décide pas des révocations : un vip a payé comptant.
- Les montants sont en euros. total_paye et montant sont des numeric.

Règles :
- LECTURE SEULE. Si on te demande d'agir (marquer traité, répondre à un membre, envoyer un email), réponds que les actions arrivent dans une prochaine version et indique où le faire à la main dans le cockpit.
- Ne montre le SQL que si on te le demande.
- Si une question est ambiguë (quel mois ? quel compte ?), pose la question plutôt que de choisir en silence.`

// L'outil unique : du SQL en lecture seule, borne par le code (pas par le
// prompt). Denylist assumee plutot qu'allowlist : les seuls utilisateurs sont
// Brice et Melanie, deja admins de ces donnees ; le verrou empeche l'ecriture
// et les schemas sensibles, pas la lecture de leurs propres tables.
const SQL_INTERDIT = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|vacuum|copy|call|do|into|listen|notify|set|reset|begin|commit|rollback)\b/i
const SCHEMAS_INTERDITS = /\b(auth|storage|vault|extensions|pgsodium|graphql[a-z_]*|realtime|supabase_[a-z_]*)\s*\.|pg_|information_schema/i

function verrouSql(sql: string): string | null {
  const s = sql.trim()
  if (!/^(select|with)\b/i.test(s)) return 'Seul un SELECT (ou WITH … SELECT) est accepté.'
  if (s.includes(';')) return 'Une seule requête, sans point-virgule.'
  if (SQL_INTERDIT.test(s)) return 'Requête refusée : lecture seule.'
  if (SCHEMAS_INTERDITS.test(s)) return 'Requête refusée : uniquement les tables du cockpit (schéma public).'
  return null
}

async function executerSql(sql: string): Promise<string> {
  const refus = verrouSql(sql)
  if (refus) return JSON.stringify({ erreur: refus })
  try {
    const lignes = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local statement_timeout = '8000ms'`)
      // Enveloppe : borne dure sur le volume, quelle que soit la requête.
      return tx.$queryRawUnsafe(`select * from (${sql}) sous_requete limit 200`)
    })
    const json = JSON.stringify(lignes, (_k, v) => {
      if (typeof v === 'bigint') return Number(v)
      return v
    })
    return json.length > MAX_RESULTAT
      ? `${json.slice(0, MAX_RESULTAT)}… [résultat tronqué, affine la requête]`
      : json
  } catch (err) {
    return JSON.stringify({
      erreur: err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : 'échec de la requête',
    })
  }
}

const OUTILS: Anthropic.Tool[] = [
  {
    name: 'requete_sql',
    description:
      'Exécute une requête SQL en LECTURE SEULE (SELECT ou WITH) sur les tables du cockpit (schéma public, PostgreSQL). Le résultat est plafonné à 200 lignes : agrège plutôt que de lister.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'La requête SELECT à exécuter.' },
      },
      required: ['sql'],
    },
  },
]

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const cors: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  // Le garde réel : l'allowlist du cockpit, par UUID.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers: cors })
  }

  const body = await req.json().catch(() => ({}))
  const brut = Array.isArray(body.messages) ? body.messages : []
  const historique = brut
    .filter((m: { role?: string; content?: string }) =>
      (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m: { role: 'user' | 'assistant'; content: string }) => ({
      role: m.role,
      content: m.content.slice(0, MAX_MESSAGE_LEN),
    }))
  if (historique.length === 0 || historique[historique.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Message manquant' }, { status: 400, headers: cors })
  }

  let client
  try {
    client = aiClient('cockpit')
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Clé API absente' },
      { status: 503, headers: cors },
    )
  }

  const model = AI_MODEL.cockpit
  const messages: Anthropic.MessageParam[] = [...historique]
  const etapes: { sql: string; resultat_tronque: boolean }[] = []

  try {
    for (let tour = 0; tour < MAX_TOURS; tour++) {
      const response = await client.messages.create({
        model,
        max_tokens: 3000,
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: OUTILS,
        messages,
      })
      await logAiUsage(userId, 'cockpit', model, response.usage)

      if (response.stop_reason !== 'tool_use') {
        return NextResponse.json(
          { reply: textOf(response) || 'Je n’ai pas de réponse.', etapes },
          { headers: cors },
        )
      }

      messages.push({ role: 'assistant', content: response.content })
      const resultats: Anthropic.ToolResultBlockParam[] = []
      for (const bloc of response.content) {
        if (bloc.type !== 'tool_use') continue
        const sql = String((bloc.input as { sql?: string })?.sql ?? '')
        const resultat = await executerSql(sql)
        etapes.push({ sql, resultat_tronque: resultat.endsWith(']') === false })
        resultats.push({ type: 'tool_result', tool_use_id: bloc.id, content: resultat })
      }
      messages.push({ role: 'user', content: resultats })
    }
    return NextResponse.json(
      { reply: 'Trop d’allers-retours avec la base pour cette question : découpe-la en plus petit.', etapes },
      { headers: cors },
    )
  } catch (err) {
    console.error('[cockpit/agent]', err)
    return NextResponse.json(
      { error: aiErrorMessage(err, 'ANTHROPIC_API_KEY_COCKPIT') },
      { status: 502, headers: cors },
    )
  }
}
