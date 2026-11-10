// LES BESOINS DES MEMBRES, LOTS 3 ET 4 (06/11/2026) : le serveur des gestes
// du cockpit (detail, ajouter, modifier, statut, fusionner, deplacer-demande),
// du brief de dev (ecrit au passage en « planifie », depose en note Perso pour
// Sora) et des messages aux membres (apercu, puis envoi sur le clic de Brice).
//
// Les routes (src/app/api/cockpit/besoins/*) verifient la session et
// cockpit_allowlist AVANT d'appeler ces fonctions (garde.ts). Les tables sont
// lues en SQL brut (les vues du cockpit filtrent par is_cockpit_member() et ne
// rendent rien au serveur).
//
// PREVENIR : un message par MEMBRE (pas par demande), carte livre ou refuse
// seulement, jamais automatiquement (seule la route POST prevenir envoie, sur
// le clic de Brice). Chaque membre est RESERVE avant l'envoi (prevenu_le pose
// seulement s'il est nul, et seulement si la carte a toujours le statut lu) :
// un double clic n'envoie pas deux fois. Un echec libere la reservation et se
// lit dans prevenu_statut. Canaux : Telegram par le bot des membres pour un
// compte Telegram (trace au fil Support, le bot garde la main) ; email pour un
// compte AOK (plus une ligne « human » dans son fil du support s'il en a un) ;
// email pour un contact saisi par l'equipe ; sinon « a la main » (rien
// d'envoye, la liste revient a Brice).
//
// Jamais de texte de membre dans un log (erreurCourte, des comptes seulement).

import { Prisma } from '@prisma/client'
import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { alerterBriceSecurite } from '@/lib/securite/alerte'
import { analyserTexte } from '@/lib/securite/injection-pur'
import { envoyer as envoyerTelegram } from '@/lib/liveclub/telegram'
import { nettoyerPourSupport, tracerMessageBot } from '@/lib/liveclub/support-pont'
import { creerNote } from '@/lib/tab/notes'
import { analyseDemande, empreinteTexte, erreurCourte, estTableAbsente, type NatureBesoin, type OutilBesoin } from './pur'
import { depotsServeur } from './serveur'
import { carteDuSignalement, insererDemandeEquipe, referenceAleatoire, type ReponseRoute } from './membres'
import { cheminCaptureValide } from './bouton-pur'
import { urlSigneeCapture } from './captures'
import {
  PREVENU_RESERVE, RESERVATION_PERIMEE_MIN,
  briefMarkdown, grouperParMembre, lireCorpsAjouter, lireCorpsDeplacer, lireCorpsFusionner, lireCorpsModifier,
  lireCorpsPrevenir, lireCorpsStatut, membreAffiche, membreRefEquipe, messageParDefaut, messagesMembreDuFil,
  remplirMessage, statutEchec, sujetEmail, sujetNoteBrief, texteNoteBrief,
  type CarteBrief, type DemandeAPrevenir, type DemandeBrief, type GroupeMembre,
} from './cockpit-pur'

const MIGRATION = '20261106150000'

const erreur = (status: number, message: string): ReponseRoute => ({ status, corps: { error: message } })

function colonneAbsente(err: unknown): boolean {
  return /42703|column .* does not exist/i.test(err instanceof Error ? err.message : String(err))
}

/** Une panne de base, dite au cockpit sans valeur de membre. */
function panne(ou: string, err: unknown): ReponseRoute {
  if (estTableAbsente(err) || colonneAbsente(err)) {
    return erreur(503, `Les tables des besoins ne sont pas à jour (migration ${MIGRATION} à appliquer).`)
  }
  console.warn(`[cockpit/besoins/${ou}] ${erreurCourte(err)}`)
  return erreur(503, 'Base illisible : réessaie dans un instant.')
}

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null)

/**
 * Le client SQL : le global, ou la transaction en cours. Jamais le client
 * global DANS une transaction : le pool du journal n'a qu'une connexion
 * (connection_limit), il attendrait la transaction elle-meme.
 */
type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw' | '$queryRawUnsafe'>

// ---------------------------------------------------------------------------
// Lectures communes
// ---------------------------------------------------------------------------

type CarteLue = {
  id: string; cle: string; titre: string; outil: string; nature: string; statut: string
  note_equipe: string | null; raison_refus: string | null; created_at: Date; statut_change_le: Date | null
  brief: string | null; brief_le: Date | null; brief_note_id: string | null; fusionne_dans: string | null
  personnes: number; demandes: number; votes: number; canaux: string[] | null
}

/** La carte et ses compteurs (elle et les cartes fusionnees dedans). null = introuvable. */
async function lireCarte(id: string, db: Db = prisma): Promise<CarteLue | null> {
  const l = await db.$queryRaw<CarteLue[]>`
    with recursive famille (id, profondeur) as (
      select b.id, 0 from public.besoin b where b.id = ${id}::uuid
      union all
      select b.id, f.profondeur + 1 from public.besoin b join famille f on b.fusionne_dans = f.id where f.profondeur < 10
    )
    select b.id::text as id, b.cle, b.titre, b.outil, b.nature, b.statut, b.note_equipe, b.raison_refus, b.created_at,
      b.statut_change_le, b.brief, b.brief_le, b.brief_note_id::text as brief_note_id, b.fusionne_dans::text as fusionne_dans,
      (select count(distinct d.membre_ref)::int from public.besoin_demande d where d.besoin_id in (select id from famille)) as personnes,
      (select count(*)::int from public.besoin_demande d where d.besoin_id in (select id from famille)) as demandes,
      (select count(distinct v.membre_ref)::int from public.besoin_vote v where v.besoin_id in (select id from famille)) as votes,
      (select array_agg(distinct d.canal) from public.besoin_demande d where d.besoin_id in (select id from famille)) as canaux
    from public.besoin b where b.id = ${id}::uuid`
  return l[0] ?? null
}

type DemandeLue = DemandeAPrevenir & {
  canal: string; app: string | null; source: string | null; membre_id: string | null
  texte_membre: string; texte_visible: string | null; suspect: boolean; suspect_raison: string | null
  resume: string | null; capture_url: string | null; page: string | null
}

/** Les demandes de la carte (et des cartes fusionnees dedans), les plus recentes d'abord, avec de quoi nommer le membre. */
async function lireDemandes(id: string, db: Db = prisma): Promise<DemandeLue[]> {
  const l = await db.$queryRaw<(Omit<DemandeLue, 'created_at' | 'prevenu_le'> & { created_at: Date; prevenu_le: Date | null })[]>`
    with recursive famille (id, profondeur) as (
      select b.id, 0 from public.besoin b where b.id = ${id}::uuid
      union all
      select b.id, f.profondeur + 1 from public.besoin b join famille f on b.fusionne_dans = f.id where f.profondeur < 10
    )
    select d.id::text as id, d.canal, d.app, d.source, d.membre_ref, d.membre_id, d.texte_membre, d.texte_visible,
      d.suspect, d.suspect_raison, d.resume, d.capture_url, d.fil_id, d.page, d.created_at, d.prevenu_le, d.prevenu_statut,
      d.contact_nom, d.contact_email, d.contact_telegram,
      u.email::text as compte_email, nullif(btrim(p.first_name), '') as prenom_compte,
      t."contactEmail" as fil_email,
      nullif(btrim(m.prenom), '') as prenom_membre, tm.pseudo, tm.nom_affiche
    from public.besoin_demande d
    left join auth.users u on u.id::text = d.membre_ref
    left join public.profiles p on p.id::text = d.membre_ref
    left join public."SupportThread" t on t.id = d.fil_id
    left join public.cockpit_membres m on m.membre_id::text = d.membre_id
    left join public.cockpit_telegram_membres tm
      on tm.telegram_id = case when d.membre_ref ~ '^telegram:[0-9]{1,15}$' then substr(d.membre_ref, 10)::bigint end
    where d.besoin_id in (select id from famille)
    order by d.created_at desc
    limit 1000`
  return l.map(d => ({ ...d, created_at: new Date(d.created_at).toISOString(), prevenu_le: iso(d.prevenu_le) }))
}

/** La carte non fusionnee qui compte pour celle-ci (elle-meme, ou celle ou elle a ete fusionnee). */
async function racineDe(db: Pick<Prisma.TransactionClient, '$queryRaw'>, id: string): Promise<string | null> {
  const l = await db.$queryRaw<{ id: string }[]>`
    with recursive chaine as (
      select b.id, b.fusionne_dans, 0 as n from public.besoin b where b.id = ${id}::uuid
      union all
      select b.id, b.fusionne_dans, c.n + 1 from public.besoin b join chaine c on b.id = c.fusionne_dans where c.n < 10
    )
    select id::text as id from chaine where fusionne_dans is null order by n desc limit 1`
  return l[0]?.id ?? null
}

// ---------------------------------------------------------------------------
// GET /api/cockpit/besoins/detail?id=
// ---------------------------------------------------------------------------

export async function detailBesoin(id: string): Promise<ReponseRoute> {
  try {
    const c = await lireCarte(id)
    if (!c) return erreur(404, 'Carte introuvable.')
    const demandes = await lireDemandes(id)
    const captures = await Promise.all(demandes.map(d => (cheminCaptureValide(d.capture_url) ? urlSigneeCapture(d.capture_url) : Promise.resolve(null))))
    return {
      status: 200,
      corps: {
        carte: {
          id: c.id, cle: c.cle, titre: c.titre, outil: c.outil, nature: c.nature, statut: c.statut,
          personnes: c.personnes, demandes: c.demandes, votes: c.votes, canaux: c.canaux ?? [],
          note_equipe: c.note_equipe, raison_refus: c.raison_refus, created_at: iso(c.created_at), statut_change_le: iso(c.statut_change_le),
          ...(c.fusionne_dans ? { fusionne_dans: c.fusionne_dans } : {}),
        },
        demandes: demandes.map((d, i) => ({
          id: d.id, canal: d.canal, app: d.app, source: d.source, membre: membreAffiche(d),
          texte_membre: d.texte_membre, texte_visible: d.texte_visible, suspect: d.suspect, suspect_raison: d.suspect_raison,
          resume: d.resume, capture: captures[i], fil_id: d.fil_id, page: d.page, created_at: d.created_at,
          prevenu_le: d.prevenu_le, prevenu_statut: d.prevenu_statut,
        })),
        brief: c.brief,
        brief_le: iso(c.brief_le),
      },
    }
  } catch (err) {
    return panne('detail', err)
  }
}

// ---------------------------------------------------------------------------
// POST /api/cockpit/besoins/ajouter
// ---------------------------------------------------------------------------

/**
 * Une demande dite hors de nos outils (WhatsApp, appel, email, live), saisie
 * par l'equipe : canal equipe, detecte_par equipe. Avec carteId : rattachee a
 * cette carte (ou a celle ou elle a ete fusionnee). Sans : classement IA (sauf
 * texte suspect) et regroupement du lot 1.
 */
export async function ajouterBesoin(userId: string, brut: unknown): Promise<ReponseRoute> {
  const c = lireCorpsAjouter(brut)
  if ('erreur' in c) return erreur(c.status, c.erreur)
  const empreinte = empreinteTexte(c.texte)
  const analyse = analyseDemande(c.texte)
  if (analyse.suspect) {
    await alerterBriceSecurite({
      source: 'cockpit, besoin saisi par l\'équipe', qui: `compte ${userId.slice(0, 8)}`,
      analyse: analyserTexte(c.texte, { niveau: 'injection' }),
      suite: "Le texte est gardé, marqué suspect, sans passer par l'IA. Rien d'autre n'a été fait.",
    })
  }
  try {
    let carte: { id: string; cle: string; titre: string; nouvelle: boolean }
    let resume: string
    if (c.carteId) {
      const racine = await racineDe(prisma, c.carteId)
      const lue = racine ? await lireCarte(racine) : null
      if (!lue) return erreur(404, 'Carte introuvable.')
      carte = { id: lue.id, cle: lue.cle, titre: lue.titre, nouvelle: false }
      resume = lue.titre
    } else {
      const r = await carteDuSignalement({
        texte: c.texte, empreinte, outilImpose: c.outil, outilDefaut: c.outil ?? 'autre', prudence: analyse.suspect,
        origine: 'equipe', creePar: `equipe:${userId}`.slice(0, 80), qui: userId,
        fixe: { nature: c.nature, titre: c.titre },
      }, depotsServeur())
      carte = r.carte
      resume = r.besoin.resume
    }
    await insererDemandeEquipe({
      besoinId: carte.id, canal: 'equipe', app: null, filId: null, membreRef: membreRefEquipe(c.contact, referenceAleatoire()),
      membreId: null, texte: c.texte, empreinte, resume, detectePar: 'equipe',
      suspect: analyse.suspect, suspectRaison: analyse.raison, texteVisible: analyse.visible, accuse: false,
      source: c.source, contact: c.contact,
    })
    return { status: 200, corps: { ok: true, carte } }
  } catch (err) {
    return panne('ajouter', err)
  }
}

// ---------------------------------------------------------------------------
// POST /api/cockpit/besoins/modifier
// ---------------------------------------------------------------------------

export async function modifierBesoin(brut: unknown): Promise<ReponseRoute> {
  const m = lireCorpsModifier(brut)
  if ('erreur' in m) return erreur(m.status, m.erreur)
  try {
    const n = await prisma.$executeRaw`
      update public.besoin set
        titre = coalesce(${m.titre ?? null}, titre),
        outil = coalesce(${m.outil ?? null}, outil),
        nature = coalesce(${m.nature ?? null}, nature),
        note_equipe = case when ${m.noteEquipe !== undefined}::boolean then ${m.noteEquipe ?? null} else note_equipe end,
        updated_at = now()
      where id = ${m.id}::uuid`
    return n > 0 ? { status: 200, corps: { ok: true } } : erreur(404, 'Carte introuvable.')
  } catch (err) {
    return panne('modifier', err)
  }
}

// ---------------------------------------------------------------------------
// Le brief (lot 4)
// ---------------------------------------------------------------------------

const OUTILS = new Set<string>(['carnet', 'pilotage', 'journal', 'academie', 'site', 'bot', 'autre'])
const NATURES = new Set<string>(['fonction', 'blocage', 'bug'])

/** Le brief de cette carte, ecrit a partir de la base (la carte, ses demandes en entier, les messages du membre de chaque fil). */
async function ecrireBrief(c: CarteLue, db: Db = prisma): Promise<string> {
  const demandes = await lireDemandes(c.id, db)
  const filIds = [...new Set(demandes.map(d => d.fil_id).filter((x): x is string => !!x))].slice(0, 100)
  const fils = new Map<string, string[]>()
  if (filIds.length) {
    const l = await db.$queryRaw<{ id: string; messages: unknown }[]>`
      select id, messages from public."SupportThread" where id = any(${filIds}::text[])`
    for (const f of l) fils.set(f.id, messagesMembreDuFil(f.messages, nettoyerPourSupport))
  }
  const carte: CarteBrief = {
    id: c.id, cle: c.cle, titre: c.titre,
    outil: (OUTILS.has(c.outil) ? c.outil : 'autre') as OutilBesoin,
    nature: (NATURES.has(c.nature) ? c.nature : 'fonction') as NatureBesoin,
    note_equipe: c.note_equipe, personnes: c.personnes, demandes: c.demandes, votes: c.votes, canaux: c.canaux ?? [],
  }
  // Dans l'ordre d'arrivee (la plus ancienne d'abord).
  const brief: DemandeBrief[] = [...demandes].reverse().map(d => ({
    id: d.id, canal: d.canal, app: d.app, source: d.source, created_at: d.created_at, texte_membre: d.texte_membre,
    texte_visible: d.texte_visible, suspect: d.suspect, suspect_raison: d.suspect_raison, resume: d.resume,
    fil_id: d.fil_id, page: d.page, capture: !!d.capture_url,
  }))
  return briefMarkdown(carte, brief, fils, new Date())
}

// ---------------------------------------------------------------------------
// POST /api/cockpit/besoins/statut
// ---------------------------------------------------------------------------

/**
 * Le statut. planifie : le serveur ecrit le brief, le garde (brief, brief_le,
 * brief_note_id remis a nul) et le rend. livre, refuse : le statut SEULEMENT
 * (raison = raison_refus pour refuse) ; RIEN n'est envoye aux membres ici.
 */
export async function changerStatut(brut: unknown): Promise<ReponseRoute> {
  const s = lireCorpsStatut(brut)
  if ('erreur' in s) return erreur(s.status, s.erreur)
  try {
    const c = await lireCarte(s.id)
    if (!c) return erreur(404, 'Carte introuvable.')
    if (c.fusionne_dans) return erreur(400, 'Cette carte est fusionnée dans une autre : change le statut de la carte qui la remplace.')
    if (s.statut === 'planifie') {
      const brief = await ecrireBrief(c)
      await prisma.$executeRaw`
        update public.besoin set
          statut = 'planifie',
          statut_change_le = case when statut <> 'planifie' then now() else statut_change_le end,
          brief = ${brief}, brief_le = now(), brief_note_id = null, updated_at = now()
        where id = ${s.id}::uuid`
      return { status: 200, corps: { ok: true, brief } }
    }
    await prisma.$executeRaw`
      update public.besoin set
        statut = ${s.statut},
        statut_change_le = case when statut <> ${s.statut} then now() else statut_change_le end,
        raison_refus = case when ${s.statut} = 'refuse' then coalesce(${s.raison}, raison_refus) else raison_refus end,
        updated_at = now()
      where id = ${s.id}::uuid`
    return { status: 200, corps: { ok: true } }
  } catch (err) {
    return panne('statut', err)
  }
}

// ---------------------------------------------------------------------------
// POST /api/cockpit/besoins/fusionner et deplacer-demande
// ---------------------------------------------------------------------------

/** La source prend fusionne_dans = la carte qui compte pour la cible ; ses propres fusions suivent (chaine courte). */
export async function fusionnerBesoins(brut: unknown): Promise<ReponseRoute> {
  const f = lireCorpsFusionner(brut)
  if ('erreur' in f) return erreur(f.status, f.erreur)
  try {
    return await prisma.$transaction(async (tx) => {
      const l = await tx.$queryRaw<{ id: string; fusionne_dans: string | null }[]>`
        select id::text as id, fusionne_dans::text as fusionne_dans from public.besoin
        where id in (${f.sourceId}::uuid, ${f.cibleId}::uuid) for update`
      const source = l.find(x => x.id === f.sourceId)
      if (!source || !l.find(x => x.id === f.cibleId)) return erreur(404, 'Carte introuvable.')
      if (source.fusionne_dans) return erreur(400, 'La carte source est déjà fusionnée dans une autre.')
      const cible = await racineDe(tx, f.cibleId)
      if (!cible) return erreur(404, 'Carte introuvable.')
      if (cible === f.sourceId) return erreur(400, 'La cible est déjà fusionnée dans la source.')
      await tx.$executeRaw`update public.besoin set fusionne_dans = ${cible}::uuid, updated_at = now() where id = ${f.sourceId}::uuid`
      await tx.$executeRaw`update public.besoin set fusionne_dans = ${cible}::uuid, updated_at = now() where fusionne_dans = ${f.sourceId}::uuid`
      return { status: 200, corps: { ok: true } }
    })
  } catch (err) {
    return panne('fusionner', err)
  }
}

/** La demande passe sur la carte (ou celle qui la remplace). */
export async function deplacerDemande(brut: unknown): Promise<ReponseRoute> {
  const d = lireCorpsDeplacer(brut)
  if ('erreur' in d) return erreur(d.status, d.erreur)
  try {
    const racine = await racineDe(prisma, d.carteId)
    if (!racine) return erreur(404, 'Carte introuvable.')
    const n = await prisma.$executeRaw`update public.besoin_demande set besoin_id = ${racine}::uuid where id = ${d.demandeId}::uuid`
    return n > 0 ? { status: 200, corps: { ok: true } } : erreur(404, 'Demande introuvable.')
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && /23505|unique/i.test(`${err.code} ${err.message}`)) {
      return erreur(400, 'Cette demande est déjà sur la carte cible.')
    }
    if (/23505|duplicate key/i.test(err instanceof Error ? err.message : '')) return erreur(400, 'Cette demande est déjà sur la carte cible.')
    return panne('deplacer-demande', err)
  }
}

// ---------------------------------------------------------------------------
// POST /api/cockpit/besoins/brief/envoyer
// ---------------------------------------------------------------------------

/**
 * Depose le brief en note Perso pour Sora (l'Orchestrateur), qui le confie a
 * la bonne conversation : aucun codeur ne part seul, aucun ping. Une note par
 * version du brief (brief_note_id, sous verrou) : un double clic rend la meme.
 */
export async function envoyerBrief(brut: unknown): Promise<ReponseRoute> {
  const c0 = brut && typeof brut === 'object' ? (brut as Record<string, unknown>) : {}
  const id = typeof c0.id === 'string' && /^[0-9a-f-]{36}$/i.test(c0.id) ? c0.id.toLowerCase() : null
  if (!id) return erreur(400, 'id requis (uuid).')
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`besoins:brief:${id}`}::text, 0))) as verrou`
      const c = await lireCarte(id, tx)
      if (!c) return erreur(404, 'Carte introuvable.')
      if (c.brief_note_id) return { status: 200, corps: { ok: true, noteId: c.brief_note_id, deja: true } }
      let brief = c.brief
      if (!brief) {
        if (c.statut !== 'planifie' && c.statut !== 'en_cours') return erreur(400, "Pas de brief : planifie d'abord la carte.")
        brief = await ecrireBrief(c, tx)
        await tx.$executeRaw`update public.besoin set brief = ${brief}, brief_le = now() where id = ${id}::uuid`
      }
      const note = await creerNote('vers_claude', 'brice', {
        sujet: sujetNoteBrief(c.titre), texte: texteNoteBrief(brief, c.id), projet: 'aok', liens: [], instance: 'sora',
      }, tx)
      await tx.$executeRaw`update public.besoin set brief_note_id = ${note.note_id}::uuid where id = ${id}::uuid`
      return { status: 200, corps: { ok: true, noteId: note.note_id } }
    }, { timeout: 20_000 })
  } catch (err) {
    return panne('brief/envoyer', err)
  }
}

// ---------------------------------------------------------------------------
// Prevenir les membres (lot 4)
// ---------------------------------------------------------------------------

type CartePrevenir = { carte: CarteLue; statut: 'livre' | 'refuse'; groupes: GroupeMembre[] }

async function lireCartePrevenir(id: string): Promise<CartePrevenir | ReponseRoute> {
  const c = await lireCarte(id)
  if (!c) return erreur(404, 'Carte introuvable.')
  if (c.statut !== 'livre' && c.statut !== 'refuse') return erreur(400, 'Seule une carte livrée ou refusée se prévient.')
  if (c.fusionne_dans) return erreur(400, 'Cette carte est fusionnée dans une autre : préviens depuis la carte qui la remplace.')
  return { carte: c, statut: c.statut, groupes: grouperParMembre(await lireDemandes(id)) }
}

/** GET : l'apercu. Le message propose, un destinataire par membre pas encore prevenu, le nombre deja prevenus. Rien n'est envoye. */
export async function apercuPrevenir(id: string): Promise<ReponseRoute> {
  try {
    const p = await lireCartePrevenir(id)
    if ('status' in p) return p
    const aPrevenir = p.groupes.filter(g => g.aPrevenir.length > 0)
    return {
      status: 200,
      corps: {
        statut: p.statut,
        message: messageParDefaut(p.statut, p.carte.titre, p.carte.raison_refus),
        destinataires: aPrevenir.map(g => ({ demandeId: g.demandeId, libelle: g.libelle, canal: g.canal })),
        dejaPrevenus: p.groupes.length - aPrevenir.length,
      },
    }
  } catch (err) {
    return panne('prevenir', err)
  }
}

/** Reserve les demandes de ce membre (une seule reservation gagne), seulement si la carte a toujours ce statut. */
async function reserver(carteId: string, statut: string, ids: string[]): Promise<string[]> {
  const l = await prisma.$queryRaw<{ id: string }[]>`
    update public.besoin_demande set prevenu_le = now(), prevenu_statut = ${PREVENU_RESERVE}
    where id = any(${ids}::uuid[])
      and (prevenu_le is null
           or (prevenu_statut = ${PREVENU_RESERVE} and prevenu_le < now() - make_interval(mins => ${RESERVATION_PERIMEE_MIN}::int)))
      and exists (select 1 from public.besoin b where b.id = ${carteId}::uuid and b.statut = ${statut} and b.fusionne_dans is null)
    returning id::text as id`
  return l.map(x => x.id)
}

async function marquer(ids: string[], statut: string): Promise<void> {
  await prisma.$executeRaw`
    update public.besoin_demande set prevenu_statut = ${statut}
    where id = any(${ids}::uuid[]) and prevenu_statut = ${PREVENU_RESERVE}`
}

async function liberer(ids: string[], statut: string): Promise<void> {
  await prisma.$executeRaw`
    update public.besoin_demande set prevenu_le = null, prevenu_statut = ${statut}
    where id = any(${ids}::uuid[]) and prevenu_statut = ${PREVENU_RESERVE}`
}

function echapperHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** L'email au membre (meme expediteur que nos emails : support@aoknowledge.com, cle Resend du Live Club ou du journal). */
async function envoyerEmail(destinataire: string, sujet: string, texte: string): Promise<string | null> {
  const cle = process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim()
  if (!cle) return 'cle Resend absente'
  try {
    const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#ffffff;color:#111827;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px"><div style="max-width:560px;margin:0 auto">${
      texte.split(/\n{2,}/).map(p => `<p style="margin:0 0 16px;line-height:1.5">${echapperHtml(p).replace(/\n/g, '<br>')}</p>`).join('')}</div></body></html>`
    const { error } = await new Resend(cle).emails.send({
      from: process.env.BESOINS_FROM_EMAIL?.trim() || 'AO Knowledge <support@aoknowledge.com>',
      to: destinataire,
      replyTo: 'support@aoknowledge.com',
      subject: sujet,
      text: texte,
      html,
    })
    return error ? `Resend ${String(error.name ?? 'erreur').slice(0, 60)}` : null
  } catch (err) {
    return `Resend ${erreurCourte(err).slice(0, 60)}`
  }
}

/** La ligne de l'equipe dans le fil du support (site, apps) de ce compte : celui de la demande, sinon son plus recent. */
async function ligneDansLeFil(membreRef: string, filId: string | null, app: string | null, texte: string): Promise<boolean> {
  const message = JSON.stringify([{ role: 'human', content: texte, at: new Date().toISOString() }])
  const n = await prisma.$executeRaw`
    update public."SupportThread" set messages = coalesce(messages, '[]'::jsonb) || ${message}::jsonb, "updatedAt" = timezone('utc', now())
    where "telegramId" is null and "userId" = ${membreRef}
      and id = coalesce(${filId}, (
        select t.id from public."SupportThread" t where t."userId" = ${membreRef} and t."telegramId" is null
        order by coalesce(t.app = ${app ?? ''}, false) desc, t."updatedAt" desc limit 1))`
  return n > 0
}

export type EchecPrevenir = { demandeId: string; libelle: string; canal: string; raison: string }

/**
 * POST : l'envoi, sur le clic de Brice. Etat relu (la carte, ses membres),
 * puis membre par membre : reservation, envoi, statut. Budget de temps : au-dela,
 * plus aucun envoi ne commence (restants).
 * (10/11) maxEnvois : au plus ce nombre d'envois tentes (Telegram ou email),
 * les membres suivants restent a prevenir (restants, repris au prochain appel :
 * un membre prevenu ne l'est pas deux fois). La route automatique du tri
 * (auto-pur.ts) s'en sert pour sa limite de messages par appel ; le clic de
 * Brice garde l'infini. tentatives = les envois tentes, rendus dans la reponse.
 */
export async function prevenirMembres(brut: unknown, budgetMs: number, maxEnvois = Number.POSITIVE_INFINITY): Promise<ReponseRoute> {
  const debut = Date.now()
  const b = lireCorpsPrevenir(brut)
  if ('erreur' in b) return erreur(b.status, b.erreur)
  let p: CartePrevenir
  try {
    const lu = await lireCartePrevenir(b.id)
    if ('status' in lu) return lu
    p = lu
  } catch (err) {
    return panne('prevenir', err)
  }
  const message = remplirMessage(b.message, { titre: p.carte.titre, raison: p.statut === 'refuse' ? p.carte.raison_refus : null })
  const sujet = sujetEmail(p.statut, p.carte.titre)
  let envoyes = 0
  let restants = 0
  let tentatives = 0
  const echecs: EchecPrevenir[] = []
  const aLaMain: { demandeId: string; libelle: string; email?: string; telegram?: string }[] = []

  for (const g of p.groupes) {
    if (!g.aPrevenir.length) continue
    if (Date.now() - debut > budgetMs || (g.canal !== 'a_la_main' && tentatives >= maxEnvois)) {
      restants++
      continue
    }
    let reserves: string[]
    try {
      reserves = await reserver(p.carte.id, p.statut, g.aPrevenir)
    } catch (err) {
      echecs.push({ demandeId: g.demandeId, libelle: g.libelle, canal: g.canal, raison: 'base illisible' })
      console.warn(`[cockpit/besoins/prevenir] reservation impossible : ${erreurCourte(err)}`)
      continue
    }
    // Deja reserve par un autre clic, ou la carte a change de statut : rien ici.
    if (!reserves.length) continue
    if (g.canal !== 'a_la_main') tentatives++
    // (10/11) parti : le message est sorti. Une panne APRES ne libere plus la
    // reservation (sinon le membre serait prevenu deux fois au clic suivant).
    let parti = false
    try {
      if (g.canal === 'a_la_main') {
        await marquer(reserves, 'a_la_main')
        aLaMain.push({ demandeId: g.demandeId, libelle: g.libelle, ...(g.email ? { email: g.email } : {}), ...(g.telegram ? { telegram: g.telegram } : {}) })
        continue
      }
      if (g.canal === 'telegram' && g.telegramId) {
        const r = await envoyerTelegram(g.telegramId, message)
        parti = r.ok
        try {
          await tracerMessageBot(g.telegramId, message, { livre: r.ok })
        } catch (err) {
          console.warn(`[cockpit/besoins/prevenir] trace du bot non ecrite : ${erreurCourte(err)}`)
        }
        if (!r.ok) {
          const raison = `telegram ${r.code ?? 'refus'}`
          await liberer(reserves, statutEchec(raison))
          echecs.push({ demandeId: g.demandeId, libelle: g.libelle, canal: g.canal, raison })
          continue
        }
        await marquer(reserves, 'telegram')
        envoyes++
        continue
      }
      if (g.canal === 'email' && g.email) {
        const raison = await envoyerEmail(g.email, sujet, message)
        if (raison) {
          await liberer(reserves, statutEchec(raison))
          echecs.push({ demandeId: g.demandeId, libelle: g.libelle, canal: g.canal, raison })
          continue
        }
        parti = true
        let fil = false
        if (/^[0-9a-f-]{36}$/i.test(g.membre_ref)) {
          try {
            fil = await ligneDansLeFil(g.membre_ref, g.filId, g.app, message)
          } catch (err) {
            console.warn(`[cockpit/besoins/prevenir] ligne du fil non ecrite : ${erreurCourte(err)}`)
          }
        }
        await marquer(reserves, fil ? 'email et fil' : 'email')
        envoyes++
        continue
      }
      await liberer(reserves, statutEchec('aucun canal'))
      echecs.push({ demandeId: g.demandeId, libelle: g.libelle, canal: g.canal, raison: 'aucun canal' })
    } catch (err) {
      console.warn(`[cockpit/besoins/prevenir] envoi en panne : ${erreurCourte(err)}`)
      if (parti) {
        await marquer(reserves, 'envoye, suite en panne').catch(() => {})
        envoyes++
        continue
      }
      await liberer(reserves, statutEchec('panne')).catch(() => {})
      echecs.push({ demandeId: g.demandeId, libelle: g.libelle, canal: g.canal, raison: 'panne' })
    }
  }
  console.log(`[cockpit/besoins/prevenir] ${envoyes} envoye(s), ${echecs.length} echec(s), ${aLaMain.length} a la main, ${restants} restant(s)`)
  return { status: 200, corps: { envoyes, echecs: echecs.length, aLaMain: aLaMain.length, restants, tentatives, details: { echecs, aLaMain } } }
}
