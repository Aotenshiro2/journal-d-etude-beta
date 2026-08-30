import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { aiClient, AI_MODEL, logAiUsage, aiErrorMessage } from '@/lib/ai'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'

// Un relevé de 3 pages met plus que les 10 s par défaut d'une fonction Vercel.
export const maxDuration = 60

/**
 * Lecture d'un document de compte pour Pilotage.
 *
 * UN document par appel, volontairement : le corps d'une fonction Vercel est
 * borné à 4,5 Mo, et un PDF encodé en base64 pèse un tiers de plus que sur le
 * disque. Le front boucle sur les fichiers et fusionne, ce qui donne en prime
 * une progression visible plutôt qu'une longue attente muette.
 *
 * Ce qui sort d'ici, ce sont des OPÉRATIONS BRUTES, rien d'autre. Le
 * rapprochement (hors-mois, doublons, salaire déjà déclaré) reste côté
 * Pilotage, dans `src/domain/statement-reconcile.ts`, où il est testé et où la
 * doctrine du mois est écrite. La lecture change de moteur, pas les règles.
 */

const SYSTEM_PROMPT = `Tu lis un document bancaire ou comptable et tu en extrais les opérations, une par ligne. Le document peut être un relevé de compte, un export CSV, une facture, un récapitulatif, une capture d'écran d'application bancaire, en français ou en anglais, propre ou mal scanné.

Ce que tu retiens :
- chaque opération réelle du compte, avec sa date, son libellé et son montant ;
- le montant est SIGNÉ : négatif pour ce qui sort du compte (achat, prélèvement, retrait, débit), positif pour ce qui entre (virement reçu, salaire, remboursement, dépôt, crédit).

Ce que tu ne retiens jamais :
- les lignes de solde, de total, de sous-total, de report, les en-têtes et les pieds de page ;
- les opérations d'un compte qui n'est pas celui du document ;
- une ligne dont tu ne peux pas lire la date OU le montant avec certitude. Tu la signales dans "ignorees" plutôt que de deviner.

Règles de lecture :
- une date se rend toujours en AAAA-MM-JJ. Si l'année manque sur la ligne, prends celle de la période du document.
- si le document sépare débit et crédit en deux colonnes, la colonne débit donne un montant négatif.
- garde le libellé tel qu'il est écrit, en retirant seulement les numéros de carte, de contrat ou de référence qui n'aident pas à reconnaître l'opération.
- un même document peut couvrir plusieurs mois : tu rends tout, le tri se fait ailleurs.

Tu n'inventes jamais une opération. Si le document n'en contient aucune, tu rends une liste vide et tu dis pourquoi dans "remarque".`

const OUTIL = {
  name: 'enregistrer_operations',
  description: "Enregistre les opérations lues dans le document.",
  input_schema: {
    type: 'object' as const,
    properties: {
      operations: {
        type: 'array',
        description: 'Les opérations du compte, dans leur ordre d\'apparition.',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Date de l\'opération, au format AAAA-MM-JJ.' },
            libelle: { type: 'string', description: 'Le libellé tel qu\'écrit dans le document.' },
            montant: {
              type: 'number',
              description: 'Montant signé : négatif si l\'argent sort du compte, positif s\'il entre.',
            },
          },
          required: ['date', 'libelle', 'montant'],
        },
      },
      ignorees: {
        type: 'array',
        description: 'Lignes qui ressemblaient à des opérations mais que tu n\'as pas pu lire.',
        items: {
          type: 'object',
          properties: {
            texte: { type: 'string' },
            raison: { type: 'string' },
          },
          required: ['texte', 'raison'],
        },
      },
      remarque: {
        type: 'string',
        description: "Une phrase sur ce qu'est ce document, ou sur ce qui a posé problème. Vide si tout est net.",
      },
    },
    required: ['operations'],
  },
}

const TYPES_IMAGE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const TAILLE_MAX = 4_000_000 // base64, en deçà de la limite de corps de Vercel

type Operation = { date: string; libelle: string; montant: number }

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  const body = await req.json().catch(() => ({}))
  const nom = typeof body.nom === 'string' ? body.nom.slice(0, 120) : 'document'
  const type = typeof body.type === 'string' ? body.type : ''
  const data = typeof body.data === 'string' ? body.data : ''

  if (!data) {
    return NextResponse.json({ error: 'Document manquant.' }, { status: 400, headers: cors })
  }
  if (data.length > TAILLE_MAX) {
    return NextResponse.json(
      { error: 'Document trop lourd. Envoie-le page par page, ou en plusieurs fichiers.' },
      { status: 413, headers: cors },
    )
  }

  let client
  try {
    client = aiClient('pilotage')
  } catch (err) {
    // 503 explicite : le front sait alors qu'il peut retomber sur sa propre
    // lecture des CSV plutôt que de laisser l'utilisateur sans rien.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Lecture indisponible', indisponible: true },
      { status: 503, headers: cors },
    )
  }

  // Le PDF et l'image partent en blocs natifs ; tout le reste part en texte,
  // ce qui couvre CSV, TSV, OFX, QIF et un copier-coller de relevé.
  let bloc: unknown
  if (type === 'application/pdf') {
    bloc = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
  } else if (TYPES_IMAGE.includes(type)) {
    bloc = { type: 'image', source: { type: 'base64', media_type: type, data } }
  } else {
    const texte = Buffer.from(data, 'base64').toString('utf8').slice(0, 200_000)
    bloc = { type: 'text', text: `Contenu du fichier « ${nom} » :\n\n${texte}` }
  }

  try {
    const model = AI_MODEL.pilotage
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [OUTIL],
      // Forcé : on veut une structure, pas une réponse rédigée à reparser.
      tool_choice: { type: 'tool', name: OUTIL.name },
      messages: [
        {
          role: 'user',
          content: [
            bloc,
            { type: 'text', text: `Extrais les opérations de ce document (« ${nom} »).` },
          ],
        },
      ],
    } as never)

    await logAiUsage(userId, 'pilotage', model, response.usage)

    const bloc_outil = response.content.find(
      (c: { type: string }) => c.type === 'tool_use',
    ) as { input?: { operations?: unknown; ignorees?: unknown; remarque?: unknown } } | undefined

    if (!bloc_outil?.input) {
      return NextResponse.json(
        { error: 'Document illisible, rien n\'a pu en être tiré.' },
        { status: 502, headers: cors },
      )
    }

    // Ceinture : on ne fait pas confiance à la forme, on la vérifie.
    const brutes = Array.isArray(bloc_outil.input.operations) ? bloc_outil.input.operations : []
    const operations: Operation[] = []
    for (const op of brutes as Array<Record<string, unknown>>) {
      const date = String(op?.date ?? '')
      const montant = Number(op?.montant)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      if (!Number.isFinite(montant) || montant === 0) continue
      operations.push({
        date,
        libelle: String(op?.libelle ?? '').slice(0, 200) || 'Opération sans libellé',
        montant: Math.round((montant + Number.EPSILON) * 100) / 100,
      })
    }

    return NextResponse.json(
      {
        operations,
        ignorees: Array.isArray(bloc_outil.input.ignorees) ? bloc_outil.input.ignorees.slice(0, 20) : [],
        remarque: typeof bloc_outil.input.remarque === 'string' ? bloc_outil.input.remarque : '',
      },
      { headers: cors },
    )
  } catch (err) {
    console.error('[pilotage/releve]', err)
    return NextResponse.json(
      { error: aiErrorMessage(err, 'ANTHROPIC_API_KEY_PILOTAGE') },
      { status: 502, headers: cors },
    )
  }
}
