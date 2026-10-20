// LE GENERATEUR DE POSTS DU COCKPIT : la partie SERVEUR (19/10/2026).
// Partagee par la route /api/cockpit/generation (ecran Generation de l'onglet
// Creation) et l'outil generer_post de l'Agent AOK : lectures en base,
// appel du modele, rangement du brouillon dans cockpit_generations. Le calcul
// pur (choix, prompt, validation) est dans generation-pur.ts.
//
// Rien n'est publie ni envoye a personne : le brouillon se copie-colle.
// L'image d'une capture part au modele ; depuis le 20/10 elle est aussi GARDEE,
// reduite, avec le brouillon (generation-capture.ts), pour pouvoir le reprendre.

import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { aiClient, logAiUsage, aiErrorMessage } from '@/lib/ai'
import { coutMicroEuros } from '@/lib/ia-prix'
import { requeteTsquery } from '@/lib/creation-pur'
import {
  MAX_PASSAGE, MODELE_GENERATION, PROMPT_COMPLET, SCHEMA_SORTIE,
  assemblerPassages, axeCible, choisirBanque, choisirFormes, choisirMatiereInspirations, depart,
  entreeGeneration, motsDeLaDemande, registreDuCanal, requeteAnglaise, systemeGeneration, termesAnglais, textesReference,
  validerSortie,
  type ContenuGeneration, type DemandeGeneration, type Inspiration, type Parent, type Passage,
} from '@/lib/generation-pur'
import { garderCapture, lireCapture } from '@/lib/generation-capture'

export type OrigineGeneration = 'cockpit' | 'agent_telegram' | 'agent_cockpit' | 'tab'

export type ResultatGeneration =
  | {
      ok: true
      id: string
      contenu: ContenuGeneration
      /** Ce qui a ete envoye (affiche, cliquable a l'ecran). */
      envoyees: { inspirations: string[]; sources: Array<{ type: Passage['type']; libelle: string; ref: string }> }
      cout_micros: number
      /** La capture gardee (bucket prive cockpit-inspirations), ou null. */
      image_chemin: string | null
    }
  | { ok: false; status: number; erreur: string }

const MAX_PAGES = 2
/** L'auteur des PDF d'une personne dans cockpit_matiere_pages (libelle de l'allowlist). */
const AUTEUR_PDF: Record<DemandeGeneration['personne'], string> = { brice: 'Brice', mel: 'Mélanie' }

function tableAbsente(err: unknown): boolean {
  return /42P01|42703|does not exist|n'existe pas/i.test(err instanceof Error ? err.message : String(err))
}

type LignePage = { auteur: string; source: string; page: number; texte: string }

function passagePage(p: LignePage, type: 'pdf' | 'reference'): Passage {
  const fichier = p.source.replace(/\.pdf$/i, '').trim()
  return {
    type,
    ref: `${p.source}#${p.page}`,
    libelle: type === 'reference' ? `${p.auteur}, ${fichier}, p. ${p.page}` : `PDF ${fichier}, p. ${p.page}`,
    texte: p.texte.trim().slice(0, MAX_PASSAGE),
  }
}

/**
 * Duree du cache des regles fixes. Mesure du 20/10 (scripts/mesurer-prompt.ts,
 * rapport dans ETAT.md) : voir CACHE_TTL_RAISON. '5m' = ecriture 1,25x,
 * '1h' = ecriture 2x ; une lecture coute 0,1x dans les deux cas.
 */
export const CACHE_TTL: '5m' | '1h' = '5m'

/** Le retour arriere sans code : GENERATEUR_PROMPT_COMPLET=1 sur Vercel renvoie la fiche entiere. */
function promptComplet(): boolean {
  return PROMPT_COMPLET || process.env.GENERATEUR_PROMPT_COMPLET === '1'
}

export type Preparation = {
  d: DemandeGeneration
  axe: ReturnType<typeof axeCible>
  mots: string[]
  requeteEn: string
  formes: ReturnType<typeof choisirFormes>
  passages: Passage[]
  systeme: Anthropic.TextBlockParam[]
  clesPrompt: string[]
  complet: boolean
  contenuUtilisateur: Anthropic.ContentBlockParam[]
  /** La capture gardee reutilisee (parent ou image_de) : aucun nouvel envoi au bucket. */
  imageChemin: string | null
}

/**
 * Lectures, choix et prompt, sans appel au modele : partage par genererPost
 * et par la mesure des jetons (scripts/mesurer-prompt.ts, count_tokens).
 */
export async function preparerGeneration(
  d0: DemandeGeneration,
  options: { complet?: boolean } = {},
): Promise<{ ok: true; p: Preparation } | { ok: false; status: number; erreur: string }> {
  let d = d0
  // --- 1. Les textes de regles et les inspirations ----------------------------
  let regles: Map<string, string>
  let toutes: Inspiration[]
  let parent: Parent | null = null
  let imageChemin: string | null = null
  try {
    // La capture d'origine : celle du parent (regenerer, retoucher) ou d'un brouillon rouvert (image_de).
    const source = d.image ? null : (d.image_de ?? d.parent_id)
    const [lignesRegles, lignesInsp, lignesParent, lignesImage] = await Promise.all([
      prisma.$queryRaw<{ cle: string; contenu: string }[]>`
        select cle, contenu from public.cockpit_methode_textes
        where cle like 'generateur:%' or cle = 'matiere:banque-contenus.md'`,
      prisma.$queryRaw<Inspiration[]>`
        select id, personne, axe, role, format, format_cible, objectifs, canal, canal_registre, date_pub, source,
               texte, image, declencheur, pourquoi, refus, concepts
        from public.cockpit_inspirations`,
      d.parent_id
        ? prisma.$queryRaw<{ brouillon: string }[]>`
            select brouillon from public.cockpit_generations where id = ${d.parent_id}::uuid`
        : Promise.resolve([] as { brouillon: string }[]),
      source
        ? prisma.$queryRaw<{ image_chemin: string | null }[]>`
            select image_chemin from public.cockpit_generations where id = ${source}::uuid`
            .catch(() => [] as { image_chemin: string | null }[])
        : Promise.resolve([] as { image_chemin: string | null }[]),
    ])
    regles = new Map(lignesRegles.map((l) => [l.cle, l.contenu]))
    toutes = lignesInsp
    if (d.parent_id) {
      if (!lignesParent[0]) return { ok: false, status: 404, erreur: 'Brouillon d\'origine introuvable.' }
      parent = { brouillon: lignesParent[0].brouillon, consigne: d.consigne }
    }
    const chemin = lignesImage[0]?.image_chemin ?? null
    if (chemin) {
      const image = await lireCapture(chemin)
      if (image) {
        d = { ...d, image, sens: 'capture' }
        imageChemin = chemin
      } else if (d.image_de) {
        return { ok: false, status: 404, erreur: 'La capture gardée de ce brouillon est illisible : recolle-la.' }
      }
    } else if (d.image_de) {
      return { ok: false, status: 404, erreur: 'Ce brouillon n\'a pas de capture gardée : recolle-la.' }
    }
  } catch (err) {
    console.error('[generation] lecture', err)
    return {
      ok: false, status: 503,
      erreur: tableAbsente(err)
        ? 'Les tables du générateur ne sont pas en base (migration 20261019030000).'
        : 'Base indisponible, réessaie dans un instant.',
    }
  }
  if (!toutes.length || !regles.has('generateur:formats')) {
    return { ok: false, status: 503, erreur: 'La base d\'inspirations est vide : lancer npm run pousser:inspirations (apps/cockpit).' }
  }

  // --- 2. Le choix : formes, puis matiere -------------------------------------
  const axe = axeCible(d.canal, d.sens, d.idee)
  const mots = motsDeLaDemande(d)
  const formes = choisirFormes(toutes, d, axe, mots)
  if (!formes.length) {
    return { ok: false, status: 422, erreur: 'Aucune inspiration « forme » pour cette personne dans la base.' }
  }
  const requete = requeteTsquery(mots)
  // La reference ICT est en anglais : sa requete a elle (19/10), sans appel IA.
  const requeteEn = requeteAnglaise(termesAnglais(textesReference(d, formes)))
  const chercher = async (reference: boolean): Promise<Passage[]> => {
    if (!(reference ? requeteEn : requete)) return []
    try {
      const pages = reference
        ? await prisma.$queryRaw<LignePage[]>`
            select m.auteur, m.source, m.page, m.texte
            from public.cockpit_matiere_pages m, to_tsquery('english', ${requeteEn}) q
            where m.reference and m.tsv_en @@ q and length(m.texte) > 200
            order by ts_rank(m.tsv_en, q) desc, m.source, m.page
            limit ${MAX_PAGES}`
        : await prisma.$queryRaw<LignePage[]>`
            select m.auteur, m.source, m.page, m.texte
            from public.cockpit_matiere_pages m, to_tsquery('french', ${requete}) q
            where lower(m.auteur) = lower(${AUTEUR_PDF[d.personne]}) and m.reference = false and m.tsv @@ q
            order by ts_rank(m.tsv, q) desc, m.source, m.page
            limit ${MAX_PAGES}`
      return pages.map((p) => passagePage(p, reference ? 'reference' : 'pdf'))
    } catch (err) {
      // La matiere est un plus : une panne ne bloque pas le geste.
      console.error(`[generation] recherche ${reference ? 'reference' : 'pdf'}, on continue sans`, err)
      return []
    }
  }
  const [pdf, reference] = await Promise.all([
    chercher(false),
    axe === 'mindset' ? Promise.resolve([] as Passage[]) : chercher(true),
  ])
  const passages = assemblerPassages(axe, {
    inspirations: choisirMatiereInspirations(toutes, d.personne, axe, mots),
    banque: d.personne === 'brice' ? choisirBanque(regles.get('matiere:banque-contenus.md') ?? null, mots) : [],
    pdf,
    reference,
  })

  // --- 3. Le prompt -------------------------------------------------------------
  // Deux blocs dans l'ordre du cache : le commun (tout le monde), puis la fiche
  // de Brice decoupee pour la famille du canal (generation-pur.ts, systemeGeneration).
  const complet = options.complet ?? promptComplet()
  const cache = CACHE_TTL === '1h' ? { type: 'ephemeral' as const, ttl: '1h' as const } : { type: 'ephemeral' as const }
  const blocs = systemeGeneration(regles, d, complet)
  const systeme: Anthropic.TextBlockParam[] = blocs.map((b) => ({ type: 'text', cache_control: cache, text: b.texte }))
  const texte = entreeGeneration({ d, registre: registreDuCanal(toutes, d.canal), formes, passages, parent })
  const contenuUtilisateur: Anthropic.ContentBlockParam[] = []
  if (d.image) {
    contenuUtilisateur.push({ type: 'image', source: { type: 'base64', media_type: d.image.media_type, data: d.image.data } })
  }
  contenuUtilisateur.push({ type: 'text', text: texte })
  return {
    ok: true,
    p: {
      d, axe, mots, requeteEn, formes, passages, systeme, complet, contenuUtilisateur, imageChemin,
      clesPrompt: blocs.flatMap((b) => b.cles),
    },
  }
}

/** Les parametres de l'appel (partages avec count_tokens). */
export function parametresAppel(p: Preparation) {
  return {
    model: MODELE_GENERATION,
    system: p.systeme,
    messages: [{ role: 'user' as const, content: p.contenuUtilisateur }],
  }
}

/** Genere un brouillon et le range. Ne jette pas : une erreur rend { ok: false, status, erreur }. */
export async function genererPost(d0: DemandeGeneration, userId: string, origine: OrigineGeneration): Promise<ResultatGeneration> {
  const prep = await preparerGeneration(d0)
  if (!prep.ok) return prep
  const { d, axe, mots, requeteEn, formes, passages, clesPrompt, complet, imageChemin } = prep.p

  // --- 4. L'appel ---------------------------------------------------------------
  let reponse: Anthropic.Message
  try {
    reponse = await aiClient('cockpit').messages.create({
      ...parametresAppel(prep.p),
      max_tokens: 16000,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA_SORTIE } },
    })
  } catch (err) {
    console.error('[generation] appel', err)
    return { ok: false, status: 502, erreur: aiErrorMessage(err, 'ANTHROPIC_API_KEY_COCKPIT') }
  }
  await logAiUsage(userId, 'cockpit', MODELE_GENERATION, reponse.usage, null, {
    usage: origine === 'cockpit' ? 'generation_ecran' : `generation_${origine}`,
  })
  const cout = coutMicroEuros(MODELE_GENERATION, reponse.usage)

  if (reponse.stop_reason === 'refusal') {
    return { ok: false, status: 502, erreur: 'Le modèle a refusé cette demande. Reformule l\'idée.' }
  }
  if (reponse.stop_reason === 'max_tokens') {
    return { ok: false, status: 502, erreur: 'Réponse coupée en route : réessaie avec une idée plus courte.' }
  }
  const sortie = reponse.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  const contenu = validerSortie(sortie, formes.map((f) => f.inspiration.id), passages.map((p) => p.libelle))
  if (!contenu) {
    console.error(`[generation] sortie inexploitable (stop_reason ${reponse.stop_reason})`)
    return { ok: false, status: 502, erreur: 'L\'IA n\'a rien rendu d\'exploitable, réessaie.' }
  }

  // --- 5. Le rangement ------------------------------------------------------------
  const envoyees = {
    inspirations: formes.map((f) => f.inspiration.id),
    sources: passages.map((p) => ({ type: p.type, libelle: p.libelle, ref: p.ref })),
  }
  const entree = {
    depart: depart(d),
    idee: d.idee,
    reponses: d.reponses,
    image: d.image ? { media_type: d.image.media_type, octets_b64: d.image.data.length } : null,
    axe,
    mots,
    requete_reference: requeteEn,
    envoyees,
    // Ce qui est parti dans le prompt systeme (20/10) : les cles, et si c'etait la fiche entiere.
    prompt: { complet, cles: clesPrompt, cache: CACHE_TTL },
  }
  let id: string
  try {
    const [ligne] = await prisma.$queryRaw<{ id: string }[]>`
      insert into public.cockpit_generations
        (cree_par, origine, personne, canal, objectif, sens, parent_id, consigne, entree, inspirations, sources,
         brouillon, contenu, modele, cout_micros, image_chemin)
      values (${userId}::uuid, ${origine}, ${d.personne}, ${d.canal}, ${d.objectif}, ${d.sens},
              ${d.parent_id}::uuid, ${d.consigne}, ${JSON.stringify(entree)}::jsonb, ${contenu.inspirations}::text[],
              ${JSON.stringify(contenu.sources)}::jsonb, ${contenu.brouillon}, ${JSON.stringify(contenu)}::jsonb,
              ${MODELE_GENERATION}, ${cout}, ${imageChemin})
      returning id::text as id`
    id = ligne.id
  } catch (err) {
    console.error('[generation] rangement', err)
    return { ok: false, status: 503, erreur: 'Le brouillon est écrit mais n\'a pas pu être rangé, réessaie.' }
  }

  // --- 6. La capture gardee (20/10) : une NOUVELLE image seulement ; une reprise garde le chemin d'origine.
  let image_chemin = imageChemin
  if (d.image && !imageChemin) {
    image_chemin = await garderCapture(id, d.image)
    if (image_chemin) {
      await prisma.$executeRaw`update public.cockpit_generations set image_chemin = ${image_chemin} where id = ${id}::uuid`
        .catch((err) => console.error('[generation] chemin de la capture non range', err))
    }
  }
  return { ok: true, id, contenu, envoyees, cout_micros: cout, image_chemin }
}
