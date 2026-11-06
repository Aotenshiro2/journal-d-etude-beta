// LES BESOINS DES MEMBRES, LOT 2 (06/11/2026) : le serveur du bouton
// « Il me manque quelque chose » (nos outils et l'entree du bot des membres)
// et le classement commun aux voies sans fil de discussion (bouton, bot,
// saisie de l'equipe du lot 3).
//
// Regles (pourquoi : bouton-pur.ts) :
// - le membre ne signale et ne vote que pour LUI : membre_ref = le compte de
//   la session (ou le compte Telegram qui ecrit au bot), jamais un champ du
//   corps ;
// - classement Haiku (besoins_classement), sauf texte suspect ou modele en
//   panne : carte « a classer » sans IA ; puis le regroupement du lot 1 ;
// - 5 signalements par 24 heures et par membre, compte sous verrou au moment
//   d'ecrire (deux envois simultanes ne passent pas la limite) ;
// - texte suspect : garde, marque, Brice prevenu (alerterBriceSecurite,
//   anti-rafale existante) ;
// - « deja prevu » ne rend que des TITRES de cartes planifiees ou en cours
//   (valides par Brice en planifiant), jamais un texte de membre.
// Jamais de texte de membre dans un log (erreurCourte).

import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { alerterBriceSecurite } from '@/lib/securite/alerte'
import { analyserTexte } from '@/lib/securite/injection-pur'
import {
  analyseDemande, cleSuffixee, empreinteTexte, erreurCourte, estTableAbsente, normaliserCle,
  type BesoinPropose, type CanalBesoin, type DetectePar, type NatureBesoin, type OutilBesoin,
} from './pur'
import { contexteRegroupement, regrouper, type Depots } from './moteur'
import { depotsServeur } from './serveur'
import {
  OUTIL_DE_APP, PHRASE_BOUTON_BESOIN, PREVUS_MAX, SIGNALEMENTS_PAR_JOUR,
  besoinARanger, cartePrevue, cheminCapture, lireApp, lireCapture, lireCorpsSignaler, lireCorpsVoter, lireReponseClassement,
  requeteClassement, type CaptureLue, type CartePrevue,
} from './bouton-pur'
import { rangerCapture } from './captures'

export type ReponseRoute = { status: number; corps: Record<string, unknown> }

const erreur = (status: number, message: string): ReponseRoute => ({ status, corps: { error: message } })

function colonneAbsente(err: unknown): boolean {
  return /42703|column .* does not exist/i.test(err instanceof Error ? err.message : String(err))
}

// ---------------------------------------------------------------------------
// Le classement et la carte (bouton, bot, saisie de l'equipe)
// ---------------------------------------------------------------------------

export type CarteSignalement = { id: string; cle: string; titre: string; nouvelle: boolean }

export type OptionsCarte = {
  texte: string
  empreinte: string
  /** L'outil impose (app du bouton, choix de l'equipe) ; null = au choix du modele. */
  outilImpose: OutilBesoin | null
  /** L'outil d'une carte « a classer » quand le modele n'a rien rendu. */
  outilDefaut: OutilBesoin
  page?: string | null
  /** Texte suspect : AUCUN appel du modele, carte « a classer ». */
  prudence: boolean
  origine: 'bouton' | 'bot' | 'equipe'
  creePar: string
  qui: string
  /** Ce que l'equipe a deja choisi (lot 3) : remplace le classement. */
  fixe?: { nature?: NatureBesoin | null; titre?: string | null }
}

/**
 * Le classement (un petit appel Haiku), puis la carte : regroupement du lot 1
 * (cle exacte, sinon le modele parmi les cartes du meme outil, sinon une
 * nouvelle carte a trier). Sans classement (prudence, modele en panne, reponse
 * illisible) : une carte « a classer » propre a ce texte, sans aucun appel.
 */
export async function carteDuSignalement(o: OptionsCarte, depots: Depots): Promise<{ carte: CarteSignalement; besoin: BesoinPropose; aRanger: boolean }> {
  let besoin: BesoinPropose | null = null
  const titreFixe = o.fixe?.titre?.trim() || null
  if (titreFixe && o.outilImpose && o.fixe?.nature) {
    // Tout est choisi par l'equipe : pas de classement.
    besoin = { outil: o.outilImpose, nature: o.fixe.nature, titre: titreFixe, cle: normaliserCle('', o.outilImpose, titreFixe), resume: titreFixe }
  } else if (!o.prudence) {
    try {
      const r = await depots.appelIA(requeteClassement(o.texte, { outil: o.outilImpose, page: o.page ?? null }), 'besoins_classement', o.qui)
      besoin = lireReponseClassement(r.texte, o.outilImpose)
      if (!besoin) depots.journal('classement illisible : carte a classer')
    } catch (err) {
      depots.journal(`classement indisponible, carte a classer : ${erreurCourte(err)}`)
    }
  }
  if (besoin && (o.fixe?.nature || titreFixe)) {
    const titre = titreFixe ?? besoin.titre
    besoin = { ...besoin, nature: o.fixe?.nature ?? besoin.nature, titre, cle: titreFixe ? normaliserCle('', besoin.outil, titreFixe) : besoin.cle }
  }
  if (!besoin) {
    const b = besoinARanger(o.outilImpose ?? o.outilDefaut, o.empreinte, o.origine)
    const aRanger = o.fixe?.nature || titreFixe ? { ...b, nature: o.fixe?.nature ?? b.nature, titre: titreFixe ?? b.titre } : b
    for (let n = 1; n <= 9; n++) {
      const cle = n === 1 ? aRanger.cle : cleSuffixee(aRanger.cle, n)
      const c = await depots.creerCarte(aRanger, cle, o.creePar)
      if (c) return { carte: { id: c.id, cle: c.cle, titre: c.titre, nouvelle: true }, besoin: aRanger, aRanger: true }
      // Meme texte deja range : la meme carte « a classer ».
      const deja = await depots.carteParCle(cle)
      if (deja) return { carte: { id: deja.id, cle: deja.cle, titre: deja.titre, nouvelle: false }, besoin: aRanger, aRanger: true }
    }
    throw new Error('aucune cle libre pour la carte a classer')
  }
  const ctx = contexteRegroupement(depots, { essai: false, creePar: o.creePar, qui: o.qui })
  const carte = await regrouper(besoin, ctx)
  if (!carte.id) throw new Error('carte non creee')
  return { carte: { id: carte.id, cle: carte.cle, titre: carte.titre, nouvelle: carte.creee }, besoin, aRanger: false }
}

// ---------------------------------------------------------------------------
// L'ecriture d'une demande des lots 2 et 3
// ---------------------------------------------------------------------------

export type DemandeLot2 = {
  besoinId: string
  canal: CanalBesoin
  app: string | null
  filId: string | null
  membreRef: string
  membreId: string | null
  texte: string
  empreinte: string
  resume: string
  detectePar: DetectePar
  suspect: boolean
  suspectRaison: string | null
  texteVisible: string | null
  /** La phrase du serveur a ete dite au membre. */
  accuse: boolean
  source?: string | null
  contact?: { nom: string | null; email: string | null; telegram: string | null } | null
  page?: string | null
  capture?: string | null
}

/**
 * Insere une demande. null = deja la (meme carte, meme fil ou meme membre sans
 * fil, meme texte). Avant la migration 20261106150000 : une demande sans
 * source, contact ni capture s'ecrit quand meme (sans sa page) ; les autres
 * jettent (la route rend 503).
 */
async function insererDemande(d: DemandeLot2, db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma): Promise<string | null> {
  const accuse = d.accuse ? new Date() : null
  try {
    const l = await db.$queryRaw<{ id: string }[]>`
      insert into public.besoin_demande
        (besoin_id, canal, app, fil_id, membre_ref, membre_id, texte_membre, empreinte, empreintes_messages,
         resume, detecte_par, suspect, suspect_raison, texte_visible, accuse_le,
         source, contact_nom, contact_email, contact_telegram, page, capture_url)
      values (
        ${d.besoinId}::uuid, ${d.canal}, ${d.app}, ${d.filId}, ${d.membreRef.slice(0, 100)}, ${d.membreId},
        ${d.texte}, ${d.empreinte}, ${[d.empreinte]}::text[],
        ${d.resume}, ${d.detectePar}, ${d.suspect}, ${d.suspectRaison}, ${d.texteVisible}, ${accuse}::timestamptz,
        ${d.source ?? null}, ${d.contact?.nom ?? null}, ${d.contact?.email ?? null}, ${d.contact?.telegram ?? null},
        ${d.page ?? null}, ${d.capture ?? null}
      )
      on conflict do nothing
      returning id::text as id`
    return l[0]?.id ?? null
  } catch (err) {
    const simple = !d.source && !d.contact && !d.capture
    if (!colonneAbsente(err) || !simple) throw err
    const l = await db.$queryRaw<{ id: string }[]>`
      insert into public.besoin_demande
        (besoin_id, canal, app, fil_id, membre_ref, membre_id, texte_membre, empreinte, empreintes_messages,
         resume, detecte_par, suspect, suspect_raison, texte_visible, accuse_le)
      values (
        ${d.besoinId}::uuid, ${d.canal}, ${d.app}, ${d.filId}, ${d.membreRef.slice(0, 100)}, ${d.membreId},
        ${d.texte}, ${d.empreinte}, ${[d.empreinte]}::text[],
        ${d.resume}, ${d.detectePar}, ${d.suspect}, ${d.suspectRaison}, ${d.texteVisible}, ${accuse}::timestamptz
      )
      on conflict do nothing
      returning id::text as id`
    return l[0]?.id ?? null
  }
}

/** La demande d'une saisie de l'equipe (lot 3) : pas de cadence. */
export async function insererDemandeEquipe(d: DemandeLot2): Promise<string | null> {
  return insererDemande(d)
}

/** Les signalements de ce membre (bouton et bot) sur 24 heures glissantes. */
export async function compterSignalements(membreRef: string): Promise<number> {
  const l = await prisma.$queryRaw<{ n: number }[]>`
    select count(*)::int as n from public.besoin_demande
    where membre_ref = ${membreRef} and detecte_par = 'bouton' and created_at > now() - interval '24 hours'`
  return Number(l[0]?.n ?? 0)
}

/**
 * Insere une demande du bouton sous la cadence : verrou par membre, compte,
 * puis ecriture, dans une transaction. 'quota' = la limite est atteinte (rien
 * n'est ecrit) ; null = deja la.
 */
async function insererSousCadence(d: DemandeLot2, max: number): Promise<string | null | 'quota'> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`besoins:signalement:${d.membreRef}`}::text, 0))) as verrou`
    const l = await tx.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from public.besoin_demande
      where membre_ref = ${d.membreRef} and detecte_par = 'bouton' and created_at > now() - interval '24 hours'`
    if (Number(l[0]?.n ?? 0) >= max) return 'quota' as const
    return insererDemande(d, tx)
  })
}

// ---------------------------------------------------------------------------
// POST /api/besoins/signaler
// ---------------------------------------------------------------------------

/** Le signalement d'un membre connecte (userId = sa session). */
export async function signalerBesoin(userId: string, brut: unknown): Promise<ReponseRoute> {
  const c = lireCorpsSignaler(brut)
  if ('erreur' in c) return erreur(c.status, c.erreur)
  let capture: CaptureLue | null = null
  if (c.capture) {
    const l = lireCapture(c.capture)
    if ('erreur' in l) return erreur(l.status, l.erreur)
    capture = l
  }

  try {
    if (await compterSignalements(userId) >= SIGNALEMENTS_PAR_JOUR) {
      return erreur(429, "Tu as déjà signalé plusieurs besoins aujourd'hui : réessaie demain.")
    }
  } catch (err) {
    console.warn(`[besoins/signaler] cadence illisible : ${erreurCourte(err)}`)
    return erreur(503, 'Indisponible pour le moment, réessaie dans un instant.')
  }

  const empreinte = empreinteTexte(c.texte)
  const analyse = analyseDemande(c.texte)
  if (analyse.suspect) {
    await alerterBriceSecurite({
      source: `bouton « Il me manque quelque chose » (${c.app})`, qui: `compte ${userId.slice(0, 8)}`,
      analyse: analyserTexte(c.texte, { niveau: 'injection' }),
      suite: "Le texte est gardé dans les besoins, marqué suspect, sans passer par l'IA. Rien d'autre n'a été fait.",
    })
  }

  // La capture d'abord : capture_url ne nomme qu'un objet qui existe.
  let chemin: string | null = null
  if (capture) {
    chemin = cheminCapture(capture, new Date())
    try {
      await rangerCapture(chemin, capture.octets, capture.mime)
    } catch (err) {
      console.warn(`[besoins/signaler] capture non rangee : ${erreurCourte(err)}`)
      return erreur(503, "La capture n'a pas pu être enregistrée : réessaie dans un instant (ou envoie sans capture).")
    }
  }

  try {
    const depots = depotsServeur()
    const { carte, besoin } = await carteDuSignalement({
      texte: c.texte, empreinte, outilImpose: c.outil, outilDefaut: c.outil, page: c.page, prudence: analyse.suspect,
      origine: 'bouton', creePar: 'bouton', qui: userId,
    }, depots)
    const r = await insererSousCadence({
      besoinId: carte.id, canal: 'bouton', app: c.app, filId: null, membreRef: userId, membreId: null,
      texte: c.texte, empreinte, resume: besoin.resume, detectePar: 'bouton',
      suspect: analyse.suspect, suspectRaison: analyse.raison, texteVisible: analyse.visible,
      accuse: !analyse.suspect, page: c.page, capture: chemin,
    }, SIGNALEMENTS_PAR_JOUR)
    if (r === 'quota') return erreur(429, "Tu as déjà signalé plusieurs besoins aujourd'hui : réessaie demain.")
    // Meme phrase quelle que soit l'issue (enregistre, deja la, suspect) : rien
    // ne dit a l'auteur d'un texte suspect qu'il a ete repere.
    return { status: 200, corps: { ok: true, phrase: PHRASE_BOUTON_BESOIN } }
  } catch (err) {
    console.warn(`[besoins/signaler] non enregistre : ${erreurCourte(err)}`)
    return erreur(503, 'Indisponible pour le moment, réessaie dans un instant.')
  }
}

// ---------------------------------------------------------------------------
// L'entree du bot des membres (liveclub/besoin-etape.ts)
// ---------------------------------------------------------------------------

export type IssueBot = 'ok' | 'quota' | 'panne'

/**
 * Le texte que le membre vient d'ecrire au bot pendant l'etape, deja ecrit a
 * son fil Support (filId, texte tel qu'au fil). L'appelant a refuse un texte
 * suspect avant. L'outil est choisi par le classement (le bot couvre tous les
 * outils), bot par defaut. Ne jette pas.
 */
export async function signalerDepuisBot(o: { telegramId: number; filId: string | null; membreId: string | null; texte: string }): Promise<IssueBot> {
  const membreRef = `telegram:${o.telegramId}`
  try {
    if (await compterSignalements(membreRef) >= SIGNALEMENTS_PAR_JOUR) return 'quota'
    const empreinte = empreinteTexte(o.texte)
    const analyse = analyseDemande(o.texte)
    const { carte, besoin } = await carteDuSignalement({
      texte: o.texte, empreinte, outilImpose: null, outilDefaut: OUTIL_DE_APP.telegram, prudence: analyse.suspect,
      origine: 'bot', creePar: 'bouton', qui: `liveclub:u${o.telegramId}`,
    }, depotsServeur())
    const r = await insererSousCadence({
      besoinId: carte.id, canal: 'telegram', app: 'telegram', filId: o.filId, membreRef, membreId: o.membreId,
      texte: o.texte, empreinte, resume: besoin.resume, detectePar: 'bouton',
      suspect: analyse.suspect, suspectRaison: analyse.raison, texteVisible: analyse.visible, accuse: !analyse.suspect,
    }, SIGNALEMENTS_PAR_JOUR)
    return r === 'quota' ? 'quota' : 'ok'
  } catch (err) {
    console.warn(`[besoins/bot] non enregistre : ${erreurCourte(err)}`)
    return 'panne'
  }
}

// ---------------------------------------------------------------------------
// GET /api/besoins/prevus et POST /api/besoins/voter
// ---------------------------------------------------------------------------

/** Les cartes planifiees ou en cours de l'outil de cette app (8 au plus), avec les votes et le vote de ce membre. */
export async function prevusPourMembre(userId: string, appBrute: unknown): Promise<ReponseRoute> {
  const app = lireApp(appBrute)
  if (!app) return erreur(400, 'app inconnue.')
  const outil = OUTIL_DE_APP[app]
  try {
    const l = await prisma.$queryRaw<{ id: string; titre: string; statut: string; votes: number; a_vote: boolean }[]>`
      with recursive cartes as (
        select b.id, b.titre, b.statut, b.statut_change_le from public.besoin b
        where b.outil = ${outil} and b.fusionne_dans is null and b.statut in ('planifie', 'en_cours')
      ),
      racine (id, racine_id, profondeur) as (
        select c.id, c.id, 0 from cartes c
        union all
        select b.id, r.racine_id, r.profondeur + 1 from public.besoin b join racine r on b.fusionne_dans = r.id
        where r.profondeur < 10
      ),
      v as (
        select r.racine_id, count(distinct v.membre_ref)::int as votes, bool_or(v.membre_ref = ${userId}) as a_vote
        from public.besoin_vote v join racine r on r.id = v.besoin_id group by r.racine_id
      ),
      p as (
        select r.racine_id, count(distinct d.membre_ref)::int as personnes
        from public.besoin_demande d join racine r on r.id = d.besoin_id group by r.racine_id
      )
      select c.id::text as id, c.titre, c.statut, coalesce(v.votes, 0)::int as votes, coalesce(v.a_vote, false) as a_vote
      from cartes c
      left join v on v.racine_id = c.id
      left join p on p.racine_id = c.id
      order by coalesce(v.votes, 0) + coalesce(p.personnes, 0) desc, c.statut_change_le desc
      limit ${PREVUS_MAX}`
    const besoins = l.map(cartePrevue).filter((x): x is CartePrevue => x !== null)
    return { status: 200, corps: { besoins } }
  } catch (err) {
    if (estTableAbsente(err)) return { status: 200, corps: { besoins: [] } }
    console.warn(`[besoins/prevus] illisible : ${erreurCourte(err)}`)
    return erreur(503, 'Indisponible pour le moment.')
  }
}

/** Un vote par membre et par carte (planifiee ou en cours, non fusionnee), idempotent. */
export async function voterPourBesoin(userId: string, brut: unknown): Promise<ReponseRoute> {
  const c = lireCorpsVoter(brut)
  if ('erreur' in c) return erreur(c.status, c.erreur)
  try {
    // L'eligibilite et l'ecriture en un ordre : une carte qui change de statut entre-temps n'est pas votee.
    await prisma.$queryRaw`
      insert into public.besoin_vote (besoin_id, membre_ref, canal)
      select b.id, ${userId}, 'bouton' from public.besoin b
      where b.id = ${c.besoinId}::uuid and b.fusionne_dans is null and b.statut in ('planifie', 'en_cours')
      on conflict (besoin_id, membre_ref) do nothing
      returning besoin_id`
    const l = await prisma.$queryRaw<{ eligible: boolean; votes: number }[]>`
      with recursive racine (id, profondeur) as (
        select b.id, 0 from public.besoin b where b.id = ${c.besoinId}::uuid
        union all
        select b.id, r.profondeur + 1 from public.besoin b join racine r on b.fusionne_dans = r.id where r.profondeur < 10
      )
      select
        exists (select 1 from public.besoin b where b.id = ${c.besoinId}::uuid and b.fusionne_dans is null
                and b.statut in ('planifie', 'en_cours')) as eligible,
        (select count(distinct v.membre_ref)::int from public.besoin_vote v where v.besoin_id in (select id from racine)) as votes`
    if (!l[0]?.eligible) return erreur(404, "Cette carte n'est pas ouverte aux votes.")
    return { status: 200, corps: { ok: true, votes: Number(l[0].votes ?? 0) } }
  } catch (err) {
    if (estTableAbsente(err)) return erreur(503, 'Indisponible pour le moment.')
    console.warn(`[besoins/voter] illisible : ${erreurCourte(err)}`)
    return erreur(503, 'Indisponible pour le moment.')
  }
}

/** Pour les saisies de l'equipe sans contact : une reference propre a la saisie. */
export const referenceAleatoire = (): string => randomUUID()
