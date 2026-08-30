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
// PIECES JOINTES (30/08) : on peut lui deposer un PDF, une capture ou un
// export. Meme moteur de lecture que /api/pilotage/releve — PDF et image en
// blocs natifs, tout le reste decode en texte — mais ici le document ne
// remplace pas la base, il s'y CONFRONTE : le cas d'usage est le releve
// d'Adil ou l'export Stripe qu'on veut rapprocher de cockpit_paiements.
//
// Garde : la meme allowlist que tout le cockpit, verifiee cote serveur.

export const maxDuration = 120

const MAX_HISTORY = 20
const MAX_MESSAGE_LEN = 4000
const MAX_TOURS = 8
const MAX_RESULTAT = 14000

// Le corps d'une fonction Vercel est borne a 4,5 Mo, et le base64 pese un
// tiers de plus que le fichier sur le disque. On garde de la marge pour
// l'historique texte et les entetes.
const TYPES_IMAGE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_PIECE = 3_200_000
const MAX_PIECES_TOTAL = 3_600_000
const MAX_PIECES_PAR_MESSAGE = 4
const MAX_TEXTE_FICHIER = 200_000

const SYSTEM_PROMPT = `Tu es l'agent privé du Cockpit AOK, au service exclusif de Brice (fondateur), Mélanie (gère le Stripe du récurrent) et Adil (la compta côté Mélanie et ses accès Stripe). Tu réponds en français, en tutoyant, court et chiffré. N'utilise jamais de tiret cadratin.

Ton rôle : répondre à leurs questions de pilotage en interrogeant la base via l'outil requete_sql (lecture seule). Ne réponds JAMAIS un chiffre de mémoire : chaque chiffre vient d'une requête exécutée. Si une requête échoue, adapte-la (commence par un select * ... limit 3 pour découvrir les colonnes).

Les tables et vues du cockpit (schéma public, PostgreSQL) :
- cockpit_membres_etat (vue, 1 ligne par membre) : membre_id, nom, prenom, date_entree, tier_skool (standard|premium|vip), source_entree, email_principal, nb_emails, total_paye, nb_paiements, dernier_paiement, abonnement_en_cours (bool), a_achete_ponctuel (bool), nb_abonnements, fin_periode, origine_statut (declare|deduit|aucun)
- cockpit_paiements : paiement_id, source (stripe|paypal|skool|virement|autre), date_paiement (date), montant, devise, libelle_source, membre_id, offre_id, rembourse (bool). Un remboursement = paiement négatif.
- cockpit_abonnements : abonnement_id, compte (melanie|aoknowledge), membre_id, offre_id, statut (active|trialing|past_due|unpaid|incomplete|canceled|ended), montant, periodicite (month|quarter|year), debut, fin_periode, annule_le, annule_a_la_fin (bool)
- cockpit_offres : offre_id, nom, nature, recurrence, actif
- cockpit_actions (vue, ce qui demande un geste) : membre_id, nom, email_principal, tier_skool, produits, fin_proche, annule_le, total_paye, dernier_paiement, motif (retirer_live_club|paiement_en_echec|resiliation_demandee|echeance_proche|acces_sans_paiement), urgence, acces_conserves, acces_offert, prochaine_tentative, nb_tentatives, telegram
- cockpit_actions_traitees : membre_id, motif, traite_le, traite_par, note (ce que Brice/Mélanie ont marqué fait depuis le cockpit)
⚠️ « retirer_live_club » est une SUGGESTION À VÉRIFIER, jamais un ordre. Un accès peut être ouvert par GESTE COMMERCIAL, décidé à la main et daté nulle part en base : un tier Skool premium ou vip sans abonnement actif en face n'est donc pas forcément une anomalie, et le tier de l'export peut être en retard sur ce qui a été accordé depuis. Avant de dire « à révoquer », regarde cockpit_actions_traitees — la personne a peut-être déjà été traitée, et « note » porte la raison. Présente toujours cette liste comme des gestes à confirmer par Brice ou Mélanie, jamais comme des révocations à exécuter : couper quelqu'un à qui un geste a été fait coûte plus cher que de laisser un accès ouvert une semaine de trop.
- cockpit_kpis : snapshot_date, key, value_num, value_text (agrégats hebdo : audience_cumul, audience_indice, ns1_kit_cumul, ns2_skool_cumul…)
- cockpit_metrics_monthly : month (YYYY-MM), source, metric, value (séries mensuelles toutes plateformes)
- cockpit_snapshots : snapshot_date, generated_at, source_export_dates (json), missing (json)
- cockpit_support_threads (vue) : id, user_id, email, app, messages (jsonb, [{role,content,at}]), escalated_at, created_at, updated_at
- "AiUsage" (guillemets obligatoires, colonnes camelCase entre guillemets) : "userId", product, model, "inputTokens", "outputTokens", "createdAt"
- cockpit_releves_audience : relevés d'audience par compte (colonnes à découvrir au besoin)
- cockpit_top_items : snapshot_date, kind, rank, label, sublabel, metrics (jsonb). kind = youtube_top_watchtime | youtube_traffic_sources | gsc_top_queries | kit_broadcasts | stripe_by_product | audience_par_compte. TOUJOURS filtrer sur le dernier snapshot_date, sinon la même vidéo revient une fois par semaine collectée.
- cockpit_ia_usage (vue) : user_id, email, produit, appels, tokens_entree, tokens_sortie, dernier_appel, appels_30j. Le coût de l'IA PAR MEMBRE, que la console Anthropic ne donne pas.
- cockpit_concepts_journal (vue) : concept, occurrences, eleves, depuis_capture, depuis_tags. Ce que les élèves travaillent dans le journal, AGRÉGÉ SANS IDENTITÉ. Un concept qui revient et qu'aucun contenu ne couvre est un trou de contenu.
- cockpit_activite_journal (vue) : user_id, email, notes, notes_30j, derniere_activite, premiere_note, trades, dols, annotations, grade_a, relectures_dues. dols = niveaux Draw on Liquidity posés.
- cockpit_mentorat_acces (vue) : id, email, note, accorde_le, retire_le, actif. Les accès mentorat posés à la main. Les droits automatiques (Live Club actif, Skool premium/vip) ne sont PAS là, ils se déduisent des vues membres.
- cockpit_membre_emails : email, membre_id, principal, verifie. LE PONT entre le monde des comptes (auth.users, journal, support, IA — rangés par email) et le monde des paiements (rangé par membre_id). Un membre a souvent plusieurs emails : passe TOUJOURS par cette table, jamais par email_principal seul, sinon tu perds ceux qui ont payé avec une adresse et se sont inscrits avec une autre.

⚠️ QUI MANQUE DANS cockpit_membres, ET POURQUOI. La table ne porte que les membres Skool dont l'export a une ADRESSE EMAIL, plus tous ceux qui ont un paiement. L'export d'août 2026 compte 329 membres Skool dont 162 SANS email : l'ancien formulaire d'inscription ne demandait pas l'adresse, et la colonne Email de l'export est la réponse au formulaire, pas l'adresse du compte Skool. Ils sont concentrés entre octobre 2025 et janvier 2026 — sur novembre, décembre et janvier, AUCUN n'a d'email. Ces gens existent sur Skool et n'existent pas ici.
Deux erreurs à ne pas commettre à partir de là. (1) Quand on ne retrouve pas un membre, ou quand tu vois peu d'entrées sur ces mois-là, NE CONCLUS PAS à un trou de collecte et ne propose pas de rejouer l'export : l'email manque à la source, rejouer ne ramènerait rien. Dis que la personne est probablement dans les 162 sans email, et que le seul correctif est en amont, dans Skool. (2) Ne suggère pas de les importer quand même sans email : ça a été essayé, ça a produit 92 lignes fantômes qui gonflaient tous les compteurs de 40 %, et le script les supprime désormais exprès.

L'ONTOLOGIE (le graphe du business, deux tables) :
- cockpit_ontologie_noeuds : id, type, nom, detail, note. type = offre | offre_morte | acces | canal | entree | compte | personne | client | chantier | decision | avatar | concept | ressource | contenu | source | outil | document | methode | rituel | livre | categorie
- cockpit_ontologie_liens : de, vers, type, note. type = alimente | convertit | donne_acces | inclut | encaisse | gere | anime | remplace | contient | concerne | cible | vise | traite | enseigne | publie_sur | derive_de | mesure | outille | fait_foi | applique | cadence | inspire | classe_comme | contraint | ecrit_dans
C'est le SENS que les autres tables n'ont pas : qui vise quel avatar, quel livre a nourri quelle méthode, quel fichier fait foi sur quel sujet, de quoi telle app dépend. Les chiffres n'y sont jamais — ils vivent dans les tables ci-dessus. Pour une question de sens, joins les deux tables ; pour une question de chiffres, va aux tables métier. Le graphe est un miroir du fichier apps/cockpit/src/data/ontologie.ts : s'il paraît périmé, c'est que le script de poussée n'a pas retourné.

LES CHANTIERS, LES DÉCISIONS, LE POULS (collectés depuis les fichiers de Brice) :
- cockpit_chantiers : id, nom, statut (actif|pause|bloque|livre|resolu|perime|consigne|reflexion|inconnu), statut_brut, concerne (text[]), doc, resume, source. Collectés depuis ETAT.md, les chantier-*.md et les TODO.md. « statut_brut » porte la formulation d'origine, qui dit souvent plus que le statut normalisé. « source » dit quel fichier fait foi — le détail des tâches n'est PAS en base.
- cockpit_decisions : id, enonce, le (date), concerne (text[]), parce_que, doc, source. Les arbitrages datés. Une décision est un choix qui aurait pu aller autrement ; « parce_que » est la partie qui évite de re-débattre. Quand on te demande pourquoi quelque chose est fait ainsi, CHERCHE ICI avant de raisonner.
- cockpit_pouls_mesures : releve_le, mesure, valeur, detail. Des relevés horodatés (membres, recurrent_mensuel, abonnements_actifs, paiements_en_echec, a_traiter, encaisse_du_mois, chantiers_ouverts, fils_support_en_attente, noeuds_du_graphe, eleves_actifs_journal). ⚠️ Une mesure n'est reposée QUE quand elle change : pour comparer, prends la dernière valeur et la dernière AVANT la date qui t'intéresse, jamais les deux derniers relevés.
- cockpit_pouls_faits : vu_le, objet, objet_id, quoi, avant, apres, libelle. Les changements qualitatifs (un chantier qui change de statut).
⚠️ Le pouls ne garde que ce qu'il a vu. S'il n'a pas tourné, il n'y a pas de passé : dis-le plutôt que de conclure « rien n'a bougé ».

LES AVATARS CLIENTS :
- cockpit_membres_avatar (vue) : membre_id, nom, email_principal, avatar (monday | zumadog | tucker | bob), avatar_calcule, avatar_manuel, note_manuelle, confiance, pourquoi, intensite_etude, a_signal_etude, total_paye, abonnement_en_cours, tier_skool, anciennete_jours, natures, notes, notes_30j, dols, trades, annotations, relectures_dues.
  L'avatar est DÉDUIT DU COMPORTEMENT OBSERVÉ (ce qui a été payé, l'ancienneté, l'étude), jamais d'un niveau auto-déclaré — la règle vient de voix-client.md : un client s'est classé « intermédiaire » en fonctionnant comme un débutant. « pourquoi » explique chaque classement en clair, « confiance » dit ce qu'on sait.
  ⚠️ À DIRE quand tu t'en sers : le signal d'ÉTUDE ne couvre presque personne (le journal est peu adopté), donc la classification s'appuie surtout sur l'achat et l'ancienneté. Regarde « a_signal_etude » et « confiance » avant d'affirmer.
  Les cinq stades de voix-client.md : monday = le curieux sans structure · zumadog = le technicien désordonné · tucker = l'intermédiaire en transition · bob = le rentable qui veut professionnaliser · visionnaire = le mentor en devenir, jamais attribué automatiquement (c'est du relationnel, il se pose à la main).
- cockpit_avatar_manuel : membre_id, avatar, note, pose_le, pose_par. L'avatar posé à la main depuis le cockpit ; il prime sur le calcul.

Le modèle métier, à ne pas réinventer :
- DEUX comptes Stripe : aoknowledge = le comptant (formations, VIP), melanie = TOUT le récurrent (Live Club). Le chiffre complet demande les deux.
- Le Live Club est une communauté : résilier ne retire pas les achats comptants (acces_conserves les liste).
- Le tier Skool ne décide pas des révocations : un vip a payé comptant.
- Les montants sont en euros. total_paye et montant sont des numeric.

LES DOCUMENTS QU'ON TE DÉPOSE :
On peut joindre un PDF, une capture d'écran, un export CSV, un relevé bancaire, une facture. Quand il y en a un :
- dis en une ligne ce que tu as reçu et sur quelle période il porte, AVANT de conclure quoi que ce soit ;
- un chiffre du document n'est jamais un chiffre de la base. Ce sont deux sources, et l'intérêt est de les CONFRONTER : si on te demande un rapprochement, requête la base sur la même période et rends les écarts ligne par ligne, avec le montant de chaque côté ;
- pour rattacher une ligne de paiement à quelqu'un, passe par cockpit_membre_emails, jamais par le nom : les libellés d'export ne sont pas nos noms ;
- rappelle-toi qu'un remboursement est un paiement négatif chez nous, et que tout le récurrent est sur le Stripe de Mélanie ;
- si le document est illisible, tronqué, ou sans rapport avec ce qu'on te demande, dis-le au lieu de deviner. Tu n'inventes jamais une ligne que tu n'as pas lue.

Règles :
- Réponds en TEXTE BRUT : l'écran n'interprète pas le markdown. Jamais de **, de tableaux avec |, de titres #. Pour aligner des données, fais des lignes simples : « Tristan Gautier · 6 tentatives · prochaine le 29/08 ».
- LECTURE SEULE. Si on te demande d'agir (marquer traité, répondre à un membre, envoyer un email), réponds que les actions arrivent dans une prochaine version et indique où le faire à la main dans le cockpit.
- Ne montre le SQL que si on te le demande.
- Si une question est ambiguë (quel mois ? quel compte ?), pose la question plutôt que de choisir en silence.`

// L'outil unique : du SQL en lecture seule, borne par le code (pas par le
// prompt). Denylist assumee plutot qu'allowlist : les seuls utilisateurs sont
// Brice, Melanie et Adil, deja admins de ces donnees ; le verrou empeche
// l'ecriture et les schemas sensibles, pas la lecture de leurs propres tables.
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

type PieceEntrante = { nom?: unknown; type?: unknown; data?: unknown }
type MessageEntrant = { role?: unknown; content?: unknown; pieces?: unknown }

/**
 * Transforme une piece jointe du front en bloc pour l'API.
 *
 * LE FRONT N'ENVOIE JAMAIS DE BLOC TOUT FAIT : il envoie un nom, un type MIME
 * et du base64, et c'est ici qu'on decide de la forme. Un client bricole ne
 * peut donc pas fabriquer un bloc arbitraire, ni faire pointer une source vers
 * une URL distante.
 *
 * PDF et image partent en blocs natifs ; tout le reste est decode en texte, ce
 * qui couvre CSV, TSV, JSON, OFX, QIF et un simple copier-coller — meme regle
 * que /api/pilotage/releve, pour qu'il n'y ait qu'un seul comportement a
 * connaitre dans la maison.
 */
function blocDePiece(piece: PieceEntrante): Anthropic.ContentBlockParam | null {
  const nom = typeof piece?.nom === 'string' ? piece.nom.slice(0, 120) : 'document'
  const type = typeof piece?.type === 'string' ? piece.type : ''
  const data = typeof piece?.data === 'string' ? piece.data : ''
  if (!data || data.length > MAX_PIECE) return null
  // Base64 strict : un data: URL ou du binaire brut est refuse ici, pas plus loin.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null

  if (type === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
      title: nom,
    }
  }
  if (TYPES_IMAGE.includes(type)) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data,
      },
    }
  }
  const texte = Buffer.from(data, 'base64').toString('utf8').slice(0, MAX_TEXTE_FICHIER)
  if (!texte.trim()) return null
  return { type: 'text', text: `Contenu du fichier « ${nom} » :\n\n${texte}` }
}

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
  const brut: MessageEntrant[] = Array.isArray(body.messages) ? body.messages : []

  // Poids cumulé des pièces de TOUTE la conversation : le front renvoie
  // l'historique complet à chaque tour, donc un deuxième PDF s'ajoute au
  // premier. On refuse tôt et en clair plutôt que de laisser Vercel couper la
  // requête avec une erreur illisible.
  let poids = 0
  for (const m of brut) {
    if (!Array.isArray(m?.pieces)) continue
    for (const p of m.pieces as PieceEntrante[]) {
      if (typeof p?.data === 'string') poids += p.data.length
    }
  }
  if (poids > MAX_PIECES_TOTAL) {
    return NextResponse.json(
      {
        error:
          'Trop de documents dans cette conversation. Recharge la page pour repartir propre, ou envoie-les un par un.',
      },
      { status: 413, headers: cors },
    )
  }

  const historique: Anthropic.MessageParam[] = []
  for (const m of brut.slice(-MAX_HISTORY)) {
    if (m?.role !== 'user' && m?.role !== 'assistant') continue
    const texte = typeof m.content === 'string' ? m.content.slice(0, MAX_MESSAGE_LEN).trim() : ''
    const pieces =
      m.role === 'user' && Array.isArray(m.pieces)
        ? (m.pieces as PieceEntrante[])
            .slice(0, MAX_PIECES_PAR_MESSAGE)
            .map(blocDePiece)
            .filter((b): b is Anthropic.ContentBlockParam => b !== null)
        : []

    if (pieces.length === 0) {
      if (!texte) continue
      historique.push({ role: m.role, content: texte })
      continue
    }
    // Le document d'abord, la question ensuite : le modèle lit mieux quand la
    // pièce précède la demande qui porte dessus.
    historique.push({
      role: 'user',
      content: [
        ...pieces,
        { type: 'text', text: texte || 'Regarde ce document et dis-moi ce que tu y vois.' },
      ],
    })
  }

  if (historique.length === 0 || historique[historique.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Message manquant' }, { status: 400, headers: cors })
  }

  // UN SEUL point de cache sur les pièces, posé sur la dernière. La boucle
  // d'outils rejoue la conversation entière jusqu'à 8 fois : sans ça, un PDF
  // de 5 pages est refacturé à chaque aller-retour avec la base. Une seule
  // borne, parce que l'API en compte 4 au total et que le prompt système en
  // prend déjà une.
  posePointDeCache: for (let i = historique.length - 1; i >= 0; i--) {
    const contenu = historique[i].content
    if (!Array.isArray(contenu)) continue
    for (let j = contenu.length - 1; j >= 0; j--) {
      const bloc = contenu[j]
      if (bloc.type === 'document' || bloc.type === 'image') {
        bloc.cache_control = { type: 'ephemeral' }
        break posePointDeCache
      }
    }
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
