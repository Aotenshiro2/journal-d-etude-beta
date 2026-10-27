import { NextRequest, NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { aiClient, AI_MODEL, logAiUsage, aiErrorMessage } from '@/lib/ai'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import {
  MAX_REFERENCE,
  OUTILS,
  choisirPages,
  entreesPrompt1,
  entreesPrompt2,
  estBrice,
  lireDemande,
  lireNoeuds,
  motsDuDecoupage,
  requeteTsquery,
  texteMatiere,
  texteMatierePdf,
  texteReference,
  texteSysteme,
  tiersReference,
  validerAssiste,
  validerGenere,
  validerPhrase,
  validerTitre,
  type ContenuAssiste,
  type ContenuGenere,
  type ContenuPhrase,
  type ContenuTitre,
  type LigneDecoupage,
  type PageMatiere,
  type PageReference,
} from '@/lib/creation-pur'

/**
 * POST /api/cockpit/creation : les trois gestes d'IA de l'onglet Création du
 * cockpit (16/10/2026), sur la méthode 5 x 5 de
 * D:\1_Ecriture\Systeme\methode-structuration-sujet.md.
 *
 * - assiste : juge les pièces de l'auteur sous une cible (garder, remplacer,
 *   déplacer, ajouter) et rend les questions des trous. Prompt 1.
 * - genere  : trois découpages de la cible, page blanche sous elle. Prompt 1.
 * - titre   : cherche dans tous les découpages les feuilles qui tiennent la
 *   promesse d'un titre déjà choisi. Prompt 2.
 * - phrase  : (27/10/2026) trois phrases au plus qui expliquent UN nœud, au
 *   choix de l'auteur, rangée ensuite SUR le nœud par l'écran. Prompt 1, même
 *   matière que les deux premiers, appel court. Tant que la migration
 *   20261027140000 (le geste dans le check de la table) n'est pas appliquée,
 *   la proposition n'est pas gardée en base mais la réponse part quand même.
 *
 * Les prompts et la matière ne sont pas dans le code : ils viennent de
 * cockpit_methode_textes (npm run pousser:methodes, apps/cockpit), et pour
 * les PDF d'un auteur, de cockpit_matiere_pages (texte page par page, extrait
 * par extraire_matiere_pdf.py côté pilotage). La même table porte la
 * RÉFÉRENCE commune (reference = true : les PDF d'ICT), cherchée pour tout
 * découpage et envoyée dans un bloc à part : ce n'est la matière de personne. La sortie
 * est forcée par un outil unique au schéma du `contenu` du contrat commun
 * écran / serveur, validée ici (creation-pur.ts), puis rangée dans
 * cockpit_decoupage_propositions en « proposee ». Rien ne touche le
 * découpage lui-même : c'est l'écran qui applique ce que l'humain garde.
 *
 * Garde : jeton Supabase en Bearer + allowlist du cockpit par UUID, comme
 * /api/cockpit/mentorat. Être authentifié ne prouve rien.
 */

export const maxDuration = 300

const PAS_DE_METHODE = "La méthode n'est pas encore en base : lancer npm run pousser:methodes."
const MATIERES = ['MANIFESTE.md', 'idees-du-moment.md', 'banque-contenus.md']
/** Pages lues au plus, dans l'ordre du ts_rank, avant que choisirPages n'en garde environ 40 000 caractères. */
const MAX_PAGES_LUES = 400
/**
 * Pages de la référence lues au plus, avant que choisirPages n'en garde
 * environ MAX_REFERENCE caractères. Les notes du mentorship ICT sont des
 * diapositives : ~200 caractères par page en moyenne (mesure du 16/10).
 */
const MAX_PAGES_REFERENCE_LUES = 200

type Ligne = {
  id: string
  auteur_label: string | null
  titre: string
  phrase: string | null
  usage: string
  parent_idee: string | null
  noeuds: unknown
  retire_le: Date | null
  allow_label: string | null
  allow_email: string | null
}

/** Table absente (migration pas encore appliquée) : on le dit comme une méthode absente. */
function tableAbsente(err: unknown): boolean {
  return /42P01|does not exist|n'existe pas/i.test(err instanceof Error ? err.message : String(err))
}

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  // Le garde réel : l'allowlist du cockpit, par UUID. Le projet Supabase est
  // partagé avec un site public.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })
  }

  const demande = lireDemande(await req.json().catch(() => null))
  if (typeof demande === 'string') {
    return NextResponse.json({ error: demande }, { status: 400, headers })
  }
  const geste = demande.geste
  const outil = OUTILS[geste]

  // --- 1. Le prompt (et la matière) depuis le miroir de la méthode ----------
  const cles = geste === 'titre' ? ['prompt2'] : ['prompt1', ...MATIERES.map((m) => `matiere:${m}`)]
  let textes: Map<string, string>
  try {
    const lignes = await prisma.$queryRaw<{ cle: string; contenu: string }[]>`
      select cle, contenu from public.cockpit_methode_textes where cle = any(${cles}::text[])`
    textes = new Map(lignes.map((l) => [l.cle, l.contenu]))
  } catch (err) {
    console.error('[cockpit/creation] lecture de la méthode', err)
    return NextResponse.json(
      { error: tableAbsente(err) ? PAS_DE_METHODE : 'Base indisponible, réessaie dans un instant.' },
      { status: 503, headers },
    )
  }
  const prompt = textes.get(geste === 'titre' ? 'prompt2' : 'prompt1')
  if (!prompt?.trim()) return NextResponse.json({ error: PAS_DE_METHODE }, { status: 503, headers })

  // --- 2. Les entrées du prompt ----------------------------------------------
  const cache = { type: 'ephemeral' as const }
  let systeme: Anthropic.TextBlockParam[]
  let entree: string
  let decoupageId: string | null = null
  let cible: string | null = null
  let arbresTitre: LigneDecoupage[] = []
  let noeudsDecoupage: LigneDecoupage['noeuds'] = []
  let stockee: Record<string, unknown>

  if (demande.geste === 'titre') {
    let lignes: Ligne[]
    try {
      lignes = await prisma.$queryRaw<Ligne[]>`
        select id::text as id, titre, phrase, usage, noeuds
        from public.cockpit_decoupages
        where retire_le is null
        order by cree_le`
    } catch (err) {
      console.error('[cockpit/creation] lecture des découpages', err)
      return NextResponse.json({ error: 'Base indisponible, réessaie dans un instant.' }, { status: 503, headers })
    }
    arbresTitre = lignes.map((l) => ({
      id: l.id, titre: l.titre, phrase: l.phrase, usage: l.usage, noeuds: lireNoeuds(l.noeuds),
    }))
    systeme = [{ type: 'text', text: texteSysteme(prompt, 'titre'), cache_control: cache }]
    entree = entreesPrompt2(demande.titre, arbresTitre, outil.name)
    stockee = { geste, titre: demande.titre, decoupages_lus: arbresTitre.length }
  } else {
    let lignes: Ligne[]
    try {
      lignes = await prisma.$queryRaw<Ligne[]>`
        select d.id::text as id, d.auteur_label, d.titre, d.phrase, d.usage, d.parent_idee,
               d.noeuds, d.retire_le, a.label as allow_label, a.email as allow_email
        from public.cockpit_decoupages d
        left join public.cockpit_allowlist a on a.user_id = d.auteur
        where d.id = ${demande.decoupage_id}::uuid`
    } catch (err) {
      console.error('[cockpit/creation] lecture du découpage', err)
      return NextResponse.json({ error: 'Base indisponible, réessaie dans un instant.' }, { status: 503, headers })
    }
    const ligne = lignes[0]
    if (!ligne || ligne.retire_le) {
      return NextResponse.json({ error: 'Découpage introuvable ou retiré.' }, { status: 404, headers })
    }
    const noeuds = lireNoeuds(ligne.noeuds)
    if (demande.cible && !noeuds.some((n) => n.id === demande.cible)) {
      return NextResponse.json({ error: 'Cible inconnue dans ce découpage.' }, { status: 400, headers })
    }
    decoupageId = ligne.id
    cible = demande.cible
    noeudsDecoupage = noeuds

    // La matière de Brice ne part que pour un découpage de Brice. La matière
    // collée part dans les deux cas.
    const matieres = estBrice(ligne.auteur_label, ligne.allow_label, ligne.allow_email)
      ? MATIERES
          .map((nom) => ({ nom, contenu: textes.get(`matiere:${nom}`) ?? '' }))
          .filter((m) => m.contenu.trim())
      : []
    const matiereCollee = demande.matiere_collee?.trim() ? demande.matiere_collee : null

    // La matière des PDF : pour tout découpage, les pages de SON auteur
    // (libellé de l'allowlist) qui parlent du titre, de la phrase, de la cible
    // et de ses ancêtres, jamais une page de référence. Rien trouvé : rien
    // envoyé.
    // La référence commune (reference = true, les PDF d'ICT) : la même
    // requête, pour tout auteur, gardée à part jusqu'à environ MAX_REFERENCE
    // caractères. Ce n'est la matière de personne.
    // Les deux recherches partent ensemble. La matière comme la référence
    // sont un plus : une panne de l'une ne bloque ni l'autre ni le geste, on
    // continue sans elle (la liste des pages envoyées reste vide). Table ou
    // colonne absente (migrations 20261016160000 et 20261016170000 pas encore
    // appliquées) : pareil.
    const labelAuteur = ligne.auteur_label?.trim() || ligne.allow_label?.trim() || ''
    const mots = motsDuDecoupage(ligne.titre, ligne.phrase, noeuds, cible)
    const requete = requeteTsquery(mots)
    const panneMatiere = (quoi: string, err: unknown) => {
      if (tableAbsente(err)) {
        console.warn(`[cockpit/creation] ${quoi} : cockpit_matiere_pages ou sa colonne reference absente `
          + '(migrations 20261016160000 et 20261016170000), on continue sans')
      } else {
        console.error(`[cockpit/creation] ${quoi}, on continue sans`, err)
      }
    }
    const chercherPdfAuteur = async (): Promise<PageMatiere[]> => {
      if (!labelAuteur || !requete) return []
      try {
        const trouvees = await prisma.$queryRaw<PageMatiere[]>`
          select m.source, m.page, m.texte
          from public.cockpit_matiere_pages m, to_tsquery('french', ${requete}) q
          where lower(m.auteur) = lower(${labelAuteur}) and m.reference = false and m.tsv @@ q
          order by ts_rank(m.tsv, q) desc, m.source, m.page
          limit ${MAX_PAGES_LUES}`
        return choisirPages(trouvees)
      } catch (err) {
        panneMatiere('lecture de la matière des PDF', err)
        return []
      }
    }
    const chercherReference = async (): Promise<PageReference[]> => {
      if (!requete) return []
      try {
        const trouvees = await prisma.$queryRaw<PageReference[]>`
          select m.auteur, m.source, m.page, m.texte
          from public.cockpit_matiere_pages m, to_tsquery('french', ${requete}) q
          where m.reference and m.tsv @@ q
          order by ts_rank(m.tsv, q) desc, m.source, m.page
          limit ${MAX_PAGES_REFERENCE_LUES}`
        return choisirPages(trouvees, MAX_REFERENCE)
      } catch (err) {
        panneMatiere('lecture de la référence', err)
        return []
      }
    }
    const [pagesPdf, pagesReference] = await Promise.all([chercherPdfAuteur(), chercherReference()])

    // Quatre blocs au plus avec cache_control (la limite de l'API) : le
    // prompt, la matière de Brice, les PDF de l'auteur, la référence. Un bloc
    // de plus devra se passer de cache_control.
    systeme = [{ type: 'text', text: texteSysteme(prompt, demande.geste), cache_control: cache }]
    if (matieres.length) systeme.push({ type: 'text', text: texteMatiere(matieres), cache_control: cache })
    if (pagesPdf.length) systeme.push({ type: 'text', text: texteMatierePdf(pagesPdf), cache_control: cache })
    if (pagesReference.length) {
      systeme.push({ type: 'text', text: texteReference(pagesReference), cache_control: cache })
    }
    entree = entreesPrompt1({
      geste: demande.geste,
      auteur: ligne.auteur_label?.trim() || ligne.allow_label?.trim() || ligne.allow_email || 'auteur inconnu',
      ligne: {
        id: ligne.id, titre: ligne.titre, phrase: ligne.phrase, usage: ligne.usage,
        parent_idee: ligne.parent_idee, noeuds,
      },
      cible,
      matiereAuteur: matieres.length > 0,
      matiereCollee,
      pagesPdf: pagesPdf.length,
      reference: { pages: pagesReference.length, tiers: tiersReference(pagesReference) },
      outil: outil.name,
    })
    stockee = {
      geste,
      cible,
      matiere_auteur: matieres.map((m) => m.nom),
      matiere_pdf: pagesPdf.map((p) => ({ source: p.source, page: p.page })),
      matiere_pdf_mots: mots,
      reference_pdf: pagesReference.map((p) => ({ auteur: p.auteur, source: p.source, page: p.page })),
      matiere_collee: matiereCollee ? matiereCollee.slice(0, 2000) : null,
      matiere_collee_car: matiereCollee ? matiereCollee.length : 0,
      noeuds_lus: noeuds.length,
    }
  }

  // --- 3. L'appel, sortie forcée par l'outil unique ---------------------------
  const model = AI_MODEL.cockpit
  let reponse: Anthropic.Message
  try {
    const client = aiClient('cockpit')
    reponse = await client.messages.create({
      model,
      // Le geste phrase est un appel court : trois phrases.
      max_tokens: geste === 'phrase' ? 1500 : 16000,
      system: systeme,
      tools: [outil],
      tool_choice: { type: 'tool', name: outil.name },
      messages: [{ role: 'user', content: entree }],
    })
  } catch (err) {
    console.error('[cockpit/creation]', err)
    return NextResponse.json(
      { error: aiErrorMessage(err, 'ANTHROPIC_API_KEY_COCKPIT') },
      { status: 502, headers },
    )
  }
  await logAiUsage(userId, 'cockpit', model, reponse.usage, null, { usage: `creation_${geste}` })

  const bloc = reponse.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!bloc || reponse.stop_reason === 'max_tokens') {
    console.error(`[cockpit/creation] sortie inexploitable (stop_reason ${reponse.stop_reason})`)
    return NextResponse.json(
      {
        error: reponse.stop_reason === 'max_tokens'
          ? 'Réponse trop longue, coupée en route : réessaie sur une cible plus petite.'
          : "L'IA n'a rien rendu d'exploitable, réessaie.",
      },
      { status: 502, headers },
    )
  }

  // --- 4. Validation, puis en base en attente d'une décision humaine ---------
  let contenu: ContenuAssiste | ContenuGenere | ContenuTitre | ContenuPhrase
  if (geste === 'assiste') contenu = validerAssiste(bloc.input, noeudsDecoupage)
  else if (geste === 'genere') contenu = validerGenere(bloc.input)
  else if (geste === 'phrase') contenu = validerPhrase(bloc.input)
  else contenu = validerTitre(bloc.input, arbresTitre)
  if (geste === 'phrase' && (contenu as ContenuPhrase).phrases.length === 0) {
    return NextResponse.json({ error: "L'IA n'a rendu aucune phrase exploitable, réessaie." }, { status: 502, headers })
  }

  stockee.modele = model
  let propositionId: string
  try {
    const [ligne] = await prisma.$queryRaw<{ id: string }[]>`
      insert into public.cockpit_decoupage_propositions
        (decoupage_id, geste, cible, demande, contenu, cree_par)
      values (${decoupageId}::uuid, ${geste}, ${cible}, ${JSON.stringify(stockee)}::jsonb,
              ${JSON.stringify(contenu)}::jsonb, ${userId}::uuid)
      returning id::text as id`
    propositionId = ligne.id
  } catch (err) {
    // Geste phrase et check de la table pas encore etendu (migration
    // 20261027140000 non appliquee) : les phrases partent quand meme, l'ecran
    // les range sur le noeud ; seule la trace en base manque.
    if (geste === 'phrase' && /23514|check constraint|geste_check/i.test(err instanceof Error ? err.message : String(err))) {
      console.warn('[cockpit/creation] geste phrase non garde en base (migration 20261027140000 a appliquer)')
      return NextResponse.json({ ok: true, proposition_id: null, contenu }, { headers })
    }
    console.error('[cockpit/creation] proposition non enregistrée', err)
    return NextResponse.json(
      { error: "La proposition est faite mais n'a pas pu être enregistrée, réessaie." },
      { status: 503, headers },
    )
  }

  return NextResponse.json({ ok: true, proposition_id: propositionId, contenu }, { headers })
}
