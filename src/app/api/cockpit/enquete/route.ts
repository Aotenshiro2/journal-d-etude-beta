import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { aiClient, aiErrorMessage, AI_MODEL } from '@/lib/ai'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'

// CHERCHER EN LIGNE CE QU'ON SAIT D'UNE PERSONNE DU FONDS (07/09/2026).
//
// Brice : « même quand une personne n'est pas une personnalité publique,
// j'aimerais pouvoir faire une recherche sur lui/elle : ses réseaux, une
// société, une chaîne YouTube, un blog, LinkedIn, Insta, sa localisation. »
//
// CE QUE CETTE ROUTE FAIT, ET DANS QUEL ORDRE
// -------------------------------------------
//  1. Elle rassemble ce que le fonds sait DÉJÀ : nom, alias, pseudo, profils
//     postés, lieux cités, salons. C'est l'ANCRAGE — sans lui, chercher
//     « Guillaume » rend n'importe quel Guillaume. Aucun email, aucun numéro
//     de téléphone ne part vers le modèle ni vers le web.
//  2. Le modèle cherche sur le web (outil serveur web_search), avec des
//     domaines de courtiers de données bloqués et une consigne ferme : la
//     localisation s'arrête à la ville, jamais d'adresse ni de téléphone.
//  3. Un second appel met le compte rendu en PROPOSITIONS structurées, chacune
//     avec sa source, l'extrait qui la fonde, et POURQUOI on pense que c'est
//     bien cette personne.
//  4. Tout entre en `cockpit_arch_propositions` avec statut « proposee ».
//     Rien ne fusionne : l'humain décide dans le cockpit, ligne par ligne.
//
// Ce qui a déjà été refusé par un humain n'est pas reproposé.

export const maxDuration = 300

const BLOQUES = [
  // Courtiers de données et annuaires de personnes : ce qu'ils vendent n'est
  // ni public au sens utile, ni fiable, et c'est exactement ce qu'on ne veut
  // pas voir entrer dans une fiche.
  'spokeo.com', 'pipl.com', 'whitepages.com', 'truepeoplesearch.com',
  'beenverified.com', 'peoplefinders.com', 'fastpeoplesearch.com',
  '118000.fr', '118712.fr', 'pagesblanches.fr', 'annuaire.118712.fr',
]

type Ancrage = {
  personne_id: string
  nom: string
  alias: string | null
  telegram: string | null
  nature: string
  messages: number
  premier: string | null
  dernier: string | null
}

const SCHEMA_PROPOSITIONS = {
  type: 'object',
  additionalProperties: false,
  required: ['propositions', 'homonymes', 'resume'],
  properties: {
    resume: { type: 'string', description: 'Deux phrases : qui semble être cette personne en ligne, et le degré de certitude.' },
    homonymes: { type: 'string', description: 'Ce qui a été écarté et pourquoi (homonymes, pistes non ancrées). Vide si rien.' },
    propositions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['champ', 'valeur', 'source_url', 'extrait', 'pourquoi_lui', 'confiance'],
        properties: {
          champ: { type: 'string', enum: ['reseau', 'site', 'societe', 'localisation', 'activite', 'biographie', 'autre'] },
          reseau: { type: 'string', description: 'instagram, youtube, tiktok, linkedin, x, facebook, twitch… quand champ = reseau' },
          valeur: { type: 'string' },
          source_url: { type: 'string' },
          extrait: { type: 'string', description: 'La phrase ou le fragment de la page qui fonde la valeur, court.' },
          pourquoi_lui: { type: 'string', description: 'L’ancrage : ce qui relie cette page à CETTE personne du fonds (pseudo commun, ville, photo, salon, activité).' },
          confiance: { type: 'string', enum: ['haute', 'moyenne', 'faible'] },
        },
      },
    },
  },
} as const

type Proposition = {
  champ: string; reseau?: string; valeur: string; source_url: string
  extrait: string; pourquoi_lui: string; confiance: string
}

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
  const [personne] = await prisma.$queryRaw<Ancrage[]>`
    select personne_id, nom, alias, telegram, nature, messages,
           premier::text as premier, dernier::text as dernier
    from public.cockpit_arch_personnes where personne_id = ${personneId}`
  if (!personne) return NextResponse.json({ error: 'Personne inconnue du fonds' }, { status: 404, headers: cors })

  const reseaux = await prisma.$queryRaw<{ reseau: string; profil: string; fois: number }[]>`
    select reseau, profil, fois from public.cockpit_arch_reseaux
    where personne_id = ${personneId} and profil is not null order by fois desc limit 12`
  const lieux = await prisma.$queryRaw<{ extrait: string }[]>`
    select extrait from public.cockpit_arch_vies
    where personne_id = ${personneId} and rubrique in ('geo', 'metier', 'presentations') order by dit_le limit 8`
  const salons = await prisma.$queryRaw<{ nom: string }[]>`
    select s.nom from public.cockpit_arch_presences p join public.cockpit_arch_salons s using (salon_id)
    where p.personne_id = ${personneId} order by p.messages desc nulls last limit 5`
  const refusees = await prisma.$queryRaw<{ champ: string; valeur: string }[]>`
    select champ, valeur from public.cockpit_arch_propositions
    where personne_id = ${personneId} and statut = 'refusee'`
  const acceptees = await prisma.$queryRaw<{ champ: string; valeur: string }[]>`
    select champ, valeur from public.cockpit_arch_propositions
    where personne_id = ${personneId} and statut = 'acceptee'`

  const ancrage = [
    `Nom tel qu'il apparaît sur Telegram : ${personne.nom}`,
    personne.alias ? `Autres noms ou alias vus : ${personne.alias}` : null,
    personne.telegram ? `Pseudo Telegram : @${personne.telegram}` : null,
    `Contexte : membre d'une communauté francophone de trading (${personne.nature}), ${personne.messages} messages entre ${personne.premier ?? '?'} et ${personne.dernier ?? '?'}.`,
    salons.length ? `Salons fréquentés : ${salons.map((s) => s.nom).join(' · ')}` : null,
    reseaux.length
      ? `Profils qu'il ou elle a POSTÉS dans les conversations (l'ancrage le plus fort — vérifie qu'ils sont bien les siens) :\n${reseaux.map((r) => `  - ${r.reseau} : ${r.profil} (${r.fois} fois)`).join('\n')}`
      : null,
    lieux.length ? `Ce qu'il ou elle a dit de sa vie (extraits bruts) :\n${lieux.map((l) => `  - « ${l.extrait.slice(0, 200)} »`).join('\n')}` : null,
    acceptees.length ? `Déjà vérifié et accepté par un humain (ne pas reproposer) : ${acceptees.map((a) => `${a.champ}=${a.valeur}`).join(' ; ')}` : null,
    refusees.length ? `Déjà REFUSÉ par un humain (ne pas reproposer, c'était faux ou hors sujet) : ${refusees.map((a) => `${a.champ}=${a.valeur}`).join(' ; ')}` : null,
  ].filter(Boolean).join('\n')

  const consigne = [
    'Tu enquêtes sur une personne pour enrichir la fiche d’un CRM privé, à partir de sources publiques uniquement.',
    'Ce qu’on cherche : ses réseaux sociaux (Instagram, YouTube, TikTok, LinkedIn, X, Facebook, Twitch), un site ou blog, une société (nom, rôle, ville du siège — registres publics comme Pappers, societe.com, Infogreffe sont bienvenus), une chaîne ou un podcast, son activité professionnelle, sa ville ou région.',
    'RÈGLES FERMES :',
    '- La localisation s’arrête à la ville ou à la région. Jamais d’adresse postale, jamais de numéro de téléphone, jamais d’email, jamais de date de naissance complète, jamais d’information sur des mineurs.',
    '- Pas d’annuaires de personnes ni de courtiers de données. Pas de pages derrière une connexion.',
    '- L’ANCRAGE avant tout : pour chaque information, dis explicitement ce qui relie la page à CETTE personne (même pseudo que celui posté dans les salons, même ville que celle citée, même activité de trading, photo cohérente, lien depuis un profil déjà sûr). Une page qui ne peut pas être reliée n’est pas une trouvaille, c’est un homonyme : écarte-la et dis-le.',
    '- Cite la source de chaque affirmation et le fragment exact de la page qui la fonde.',
    '- Ne conclus rien sur la personnalité, la situation financière ou la vie privée. Tu rapportes des faits publics, tu ne juges pas.',
    'Commence par les profils déjà postés s’il y en a : ce sont les fils les plus sûrs. Sinon, cherche le nom exact avec « trading », puis les alias.',
    'Termine par un compte rendu : ce que tu as trouvé avec sources et ancrages, ce que tu as écarté et pourquoi.',
  ].join('\n')

  try {
    const client = aiClient('cockpit')
    const modele = AI_MODEL.cockpit

    // --- 2. La recherche, en boucle jusqu'à la fin du tour ------------------
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: `Voici ce que le fonds sait déjà de la personne :\n\n${ancrage}\n\nEnquête, puis rends ton compte rendu.` },
    ]
    let compteRendu = ''
    let sources: string[] = []
    for (let tour = 0; tour < 6; tour++) {
      const reponse = await client.messages.create({
        model: modele,
        max_tokens: 16000,
        system: consigne,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12, blocked_domains: BLOQUES }],
        messages,
      })
      // Un tour peut s'arrêter en pause quand la recherche est longue : on
      // rejoue la réponse telle quelle et on laisse le modèle continuer.
      if (reponse.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: reponse.content })
        continue
      }
      for (const bloc of reponse.content) {
        if (bloc.type === 'text') compteRendu += bloc.text + '\n'
        if (bloc.type === 'web_search_tool_result' && Array.isArray(bloc.content)) {
          for (const r of bloc.content) if (r.type === 'web_search_result') sources.push(r.url)
        }
      }
      break
    }
    sources = [...new Set(sources)]

    // --- 3. La mise en propositions -----------------------------------------
    const structure = await client.messages.create({
      model: modele,
      max_tokens: 8000,
      system: 'Tu transformes un compte rendu d’enquête en propositions structurées. Tu n’ajoutes rien qui ne soit dans le compte rendu. Chaque proposition garde sa source et son ancrage. Ce qui a été écarté comme homonyme va dans « homonymes », pas dans les propositions.',
      messages: [{ role: 'user', content: `Compte rendu :\n\n${compteRendu}\n\nURL consultées :\n${sources.join('\n')}` }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA_PROPOSITIONS } },
    })
    const texte = structure.content.find((b) => b.type === 'text')
    const json = texte && texte.type === 'text' ? JSON.parse(texte.text) : { propositions: [], homonymes: '', resume: '' }
    const propositions: Proposition[] = Array.isArray(json.propositions) ? json.propositions : []

    // --- 4. En base, en attente d'une décision humaine ----------------------
    const enqueteId = randomUUID()
    const dejaVues = new Set([...refusees, ...acceptees].map((a) => `${a.champ}|${a.valeur.toLowerCase()}`))
    let posees = 0
    for (const p of propositions) {
      if (!p.valeur || dejaVues.has(`${p.champ}|${p.valeur.toLowerCase()}`)) continue
      await prisma.$executeRaw`
        insert into public.cockpit_arch_propositions
          (enquete_id, personne_id, champ, reseau, valeur, source_url, extrait, pourquoi_lui, confiance)
        values (${enqueteId}::uuid, ${personneId}, ${p.champ}, ${p.reseau ?? null}, ${p.valeur.slice(0, 500)},
                ${(p.source_url ?? '').slice(0, 1000) || null}, ${(p.extrait ?? '').slice(0, 1000) || null},
                ${(p.pourquoi_lui ?? '').slice(0, 600) || null}, ${p.confiance ?? 'moyenne'})`
      posees += 1
    }

    return NextResponse.json({
      enquete_id: enqueteId,
      posees,
      resume: typeof json.resume === 'string' ? json.resume : '',
      homonymes: typeof json.homonymes === 'string' ? json.homonymes : '',
      sources: sources.length,
    }, { headers: cors })
  } catch (err) {
    console.error('[cockpit/enquete]', err)
    return NextResponse.json(
      { error: aiErrorMessage(err, 'ANTHROPIC_API_KEY_COCKPIT') },
      { status: 502, headers: cors },
    )
  }
}
