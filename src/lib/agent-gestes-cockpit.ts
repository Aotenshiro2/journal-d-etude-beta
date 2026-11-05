// LES GESTES DU COCKPIT, DEPUIS AGENT AOK (05/11/2026, LOT 1), cote serveur.
// Brice, 05/11 : « que l'agent puisse faire depuis Telegram les gestes du
// cockpit ». Regles, cartes et phrases : agent-gestes-cockpit-pur.ts.
//
// Deux temps, comme les autres cartes :
// - controlerGesteCockpit (AVANT la carte, lecture seule) : relit en base ce
//   que la carte va nommer (la personne, l'offre et ce qu'elle ouvre, les
//   titres des lecons, des modules et des clips, la plage et ses credits),
//   refuse ce qui ne changerait rien ou ne passerait pas, et compose la carte ;
// - executerGesteCockpit (AU CLIC, apres validerAction) : relit, revalide, puis
//   fait la MEME ecriture que l'ecran du cockpit (memes fonctions pour
//   l'academie et le mentorat, memes tables et memes champs pour les clips).
//
// LES COLONNES D'ACTEUR (le cockpit ecrit avec le jeton de la personne, ici on
// ecrit en role postgres : auth.uid() est NULL) :
// - academie_acces : pose_par / retire_par = 'agent:<uuid>' (texte, aucun default) ;
// - academie_editions : par = uuid du compte qui confirme (executerGeste) ;
// - cockpit_clips : decide_le, decide_par, decide_label poses ICI (le trigger
//   cockpit_clips_maj ne les pose que si auth.uid() n'est pas nul ; il les
//   efface toujours quand la decision revient a null) ;
// - cockpit_clips_demandes : pose_par (not null default auth.uid()) pose ICI ;
//   pose_label suit par le trigger cockpit_clips_demandes_label (il le lit
//   dans cockpit_allowlist a partir de pose_par) ;
// - MentoratGrant : aucune colonne d'auteur.
//
// LOT 2 (05/11, meme phrase de Brice) : charges, abonnements IA, objectif
// d'une publication Instagram, le fonds (notes, decisions, enquete en ligne),
// relais d'accueil, adresse secondaire d'un membre. Colonnes d'acteur, posees
// ICI pour la meme raison :
// - cockpit_charges : pose_par a l'ajout (default auth.uid(), nullable : il
//   resterait vide en silence ; le trigger cockpit_charges_maj le fige
//   ensuite), retire_par au retrait (l'ecran le pose aussi) ;
// - cockpit_depenses_ia_fixes : pose_par (not null default auth.uid() : sans
//   lui l'ajout serait refuse), retire_par au retrait ;
// - cockpit_social_objectifs : pose_par et pose_le, comme l'upsert de l'ecran ;
// - cockpit_arch_notes : ecrit_par (not null default auth.uid()) ;
// - cockpit_arch_propositions : decide_par ET decide_le (le trigger
//   cockpit_arch_propositions_figer ne pose decide_le que pour le role
//   authenticated) ;
// - cockpit_liveclub_relais : coupe_par (le trigger cockpit_liveclub_relais_maj
//   le pose a auth.uid(), donc a null, quand actif passe a false : un second
//   update, qui ne touche pas a actif, pose le compte qui confirme) ;
// - cockpit_membre_emails : aucune colonne d'auteur (delete des lignes
//   principal = false seulement, comme la policy de l'ecran) ;
// - l'enquete en ligne : AiUsage.userId = le compte qui confirme.
// Le fonds (notes, propositions, enquete) est reserve aux comptes qui le
// voient (cockpit_allowlist.acces_fonds, is_cockpit_fonds() de la RLS) :
// verifie a la carte (le compte qui parle) ET au clic (le compte qui confirme).

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { aiErrorMessage, aiKeyFor } from '@/lib/ai'
import { RefusAction, type ActionAgent } from '@/lib/stripe-actions'
import { messageErreur, relationAbsente, uuidDeActeur } from '@/lib/liveclub/pur'
import { executerGeste, lireArbre, planGeste, SQL_ARBRE_VERROU, type IssueGeste, type PlanArbre } from '@/lib/academie/arbre'
import { accorderAccesAcademieServeur, retirerAccesAcademieServeur } from '@/lib/academie/gestes-cockpit'
import { jourParis } from '@/lib/academie/gestes-cockpit-pur'
import { accorderMentorat, grantMentoratActif, retirerMentorat } from '@/lib/mentorat-acces'
import {
  carteAccesAcademie, carteClipsReplay, carteDecisionClip, carteEnvoiOpus, carteMentorat, carteRangement, carteRetraitAcademie,
  creditsOpus, empreinteRangement, estTypeGesteCockpit, gesteDeRangement, horaire, jourFr,
  lireParamsAccesAcademie, lireParamsClipsReplay, lireParamsDecisionClip, lireParamsEnvoiOpus, lireParamsMentorat,
  lireParamsRangement, lireParamsRetraitAcademie, personneReplayTelegram, phraseClipsReplayPose, phraseRangementFait,
  refusClipsReplay, refusDecisionClip, refusEnvoiOpus, rienNeChange,
  type ClipLu, type OffreLue, type ReplayLu, type ReplayTelegramLu,
  // (05/11, LOT 2)
  abonnementAAjouter, appliquerCharge, carteAbonnementIA, carteCharge, carteDecisionFonds, carteEnqueteFonds, carteNoteFonds,
  carteObjectif, carteRelais, carteRetraitAdresse, chargeAAjouter, CLES_CHARGE, empreinteLigne,
  lireParamsAbonnementIA, lireParamsCharge, lireParamsDecisionFonds, lireParamsEnqueteFonds, lireParamsNoteFonds,
  lireParamsObjectif, lireParamsRelais, lireParamsRetraitAdresse,
  phraseAbonnementFait, phraseAdresseRetiree, phraseChargeFaite, phraseDecisionFondsFaite, phraseEnqueteFaite,
  phraseNoteFondsEcrite, phraseObjectifPose, phraseRelaisFait,
  refusAbonnementIA, refusCharge, refusDecisionFonds, refusObjectif, refusRelais, refusRetraitAdresse, regleCharge,
  type AbonnementLu, type AdresseLue, type ChampsCharge, type CoutEnquetes, type EtatEnquetes, type ObjectifPublication,
  type PersonneFondsLue, type PropositionLue, type PublicationLue, type RelaisLu,
} from '@/lib/agent-gestes-cockpit-pur'

type Db = Prisma.TransactionClient

export type ControleGesteCockpit = { action: ActionAgent; carte: string; manque: string | null } | { erreur: string }

const RIEN = "Rien n'a été proposé."
const CLIPS_ABSENTS = "La chaîne clips n'est pas encore en base (migration 20261020210000 pas appliquée)."

// ---------------------------------------------------------------------------
// Lectures communes
// ---------------------------------------------------------------------------

/** Le nom d'une fiche membre par l'un de ses emails (cockpit_membre_emails), ou null. */
async function nomParEmail(email: string | null): Promise<string | null> {
  if (!email) return null
  const l = await prisma.$queryRaw<{ qui: string | null }[]>`
    select nullif(btrim(case when m.prenom is not null and m.nom ilike m.prenom || '%' then m.nom
                             else concat_ws(' ', m.prenom, m.nom) end), '') as qui
    from public.cockpit_membre_emails e
    join public.cockpit_membres m on m.membre_id = e.membre_id
    where lower(e.email) = ${email.toLowerCase()}
    limit 1`
  return l[0]?.qui?.slice(0, 120) ?? null
}

/** Un compte du site porte-t-il cet email VERIFIE (la regle de droitsAcademie) ? */
async function compteVerifie(email: string): Promise<boolean> {
  const l = await prisma.$queryRaw<{ ok: boolean }[]>`
    select (exists (select 1 from auth.users u
                    where lower(btrim(u.email)) = ${email} and u.email_confirmed_at is not null)
         or exists (select 1 from public.profile_emails pe
                    where lower(btrim(pe.email)) = ${email} and pe.verified = true)) as ok`
  return l[0]?.ok === true
}

/** Le libelle du compte qui confirme (comme les triggers : label, sinon email). */
async function libelleCompte(userId: string): Promise<string | null> {
  const l = await prisma.$queryRaw<{ label: string | null }[]>`
    select coalesce(nullif(btrim(a.label), ''), a.email) as label
    from public.cockpit_allowlist a where a.user_id = ${userId}::uuid`
  return l[0]?.label ?? null
}

/** L'offre (titre, ce qu'elle ouvre), par son slug ou son id. */
async function lireOffre(o: { slug?: string; id?: string }): Promise<OffreLue | null> {
  const lignes = o.slug
    ? await prisma.$queryRaw<{ id: string; slug: string; titre: string; ouvre_tout: boolean }[]>`
        select id::text as id, slug, titre, ouvre_tout from public.academie_offres where slug = ${o.slug} limit 1`
    : await prisma.$queryRaw<{ id: string; slug: string; titre: string; ouvre_tout: boolean }[]>`
        select id::text as id, slug, titre, ouvre_tout from public.academie_offres where id = ${o.id}::uuid limit 1`
  const offre = lignes[0]
  if (!offre) return null
  const contenus = await prisma.$queryRaw<{ module: string; entier: boolean; sections: number }[]>`
    select m.titre as module, bool_or(c.section_id is null) as entier, count(c.section_id)::int as sections
    from public.academie_offre_contenus c
    join public.academie_modules m on m.id = c.module_id
    where c.offre_id = ${offre.id}::uuid
    group by m.id, m.titre, m.ordre
    order by m.ordre, m.titre`
  return {
    slug: offre.slug, titre: offre.titre, ouvreTout: offre.ouvre_tout,
    contenus: contenus.map(c => ({ module: c.module, entier: c.entier, sections: Number(c.sections) })),
  }
}

function plage(brut: unknown): ReplayLu['plage'] {
  if (!brut || typeof brut !== 'object') return null
  const p = brut as { debut_s?: unknown; fin_s?: unknown; passages?: unknown }
  const debut = Number(p.debut_s)
  const fin = Number(p.fin_s)
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) return null
  return { debut_s: debut, fin_s: fin, passages: Array.isArray(p.passages) ? p.passages.length : 0 }
}

async function lireReplay(db: Db, replayId: string): Promise<ReplayLu | null> {
  const l = await db.$queryRaw<{
    replay_id: string; titre: string | null; personne: string; date_live: string | null; etat: string
    plage_proposee: unknown; credits_depenses: number | null
  }[]>`
    select replay_id::text as replay_id, titre, personne, to_char(date_live, 'YYYY-MM-DD') as date_live, etat,
           plage_proposee, credits_depenses
    from public.cockpit_clips_replays where replay_id = ${replayId}::uuid`
  const r = l[0]
  if (!r) return null
  return {
    replayId: r.replay_id, titre: r.titre, personne: r.personne, dateLive: r.date_live, etat: r.etat,
    plage: plage(r.plage_proposee), creditsDepenses: Number(r.credits_depenses ?? 0),
  }
}

async function lireClips(db: Db, ids: string[], verrou = false): Promise<ClipLu[]> {
  const l = verrou
    ? await db.$queryRaw<{ clip_id: string; replay_id: string; origine: string; titre: string | null; notre_note: number | null; decision: string | null }[]>`
        select clip_id::text as clip_id, replay_id::text as replay_id, origine, titre, notre_note, decision
        from public.cockpit_clips where clip_id::text = any(${ids}::text[]) for update`
    : await db.$queryRaw<{ clip_id: string; replay_id: string; origine: string; titre: string | null; notre_note: number | null; decision: string | null }[]>`
        select clip_id::text as clip_id, replay_id::text as replay_id, origine, titre, notre_note, decision
        from public.cockpit_clips where clip_id::text = any(${ids}::text[])`
  return l.map(c => ({
    clipId: c.clip_id, replayId: c.replay_id, origine: c.origine, titre: c.titre,
    notreNote: c.notre_note === null ? null : Number(c.notre_note), decision: c.decision,
  }))
}

async function lireReplayTelegram(db: Db, messageId: number): Promise<ReplayTelegramLu | null> {
  const l = await db.$queryRaw<{
    message_id: bigint | number; legende: string | null; poste_le: Date | null; auteur: string | null
    personne: string | null; duree_s: number | null; replay_id: string | null
  }[]>`
    select message_id, legende, poste_le, auteur, personne, duree_s, replay_id::text as replay_id
    from public.cockpit_clips_telegram where message_id = ${messageId}::bigint`
  const r = l[0]
  if (!r) return null
  return {
    messageId: Number(r.message_id), legende: r.legende, posteLe: r.poste_le ? jourParis(r.poste_le) : null,
    auteur: r.auteur, personne: r.personne, dureeS: r.duree_s === null ? null : Number(r.duree_s), replayId: r.replay_id,
  }
}

/** La demande deja posee pour ce geste (action + ref), dans les etats donnes, ou null. */
async function demandeClips(db: Db, action: string, ref: string, etats: string[]): Promise<{ etat: string; poseLabel: string | null } | null> {
  const l = await db.$queryRaw<{ etat: string; pose_label: string | null }[]>`
    select etat, pose_label from public.cockpit_clips_demandes
    where action = ${action} and ref = ${ref} and etat = any(${etats}::text[])
    order by pose_le desc limit 1`
  return l[0] ? { etat: l[0].etat, poseLabel: l[0].pose_label } : null
}

async function replayDejaPrepare(db: Db, source: 'telegram' | 'youtube', ref: string): Promise<boolean> {
  const l = await db.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_clips_replays where source = ${source} and source_ref = ${ref} limit 1`
  return l.length > 0
}

/** L'etat d'une proposition de clips, lu dans la base (carte et clic). */
async function lireEtatClipsReplay(db: Db, p: { source: 'telegram' | 'youtube'; ref: string }) {
  const telegram = p.source === 'telegram' ? await lireReplayTelegram(db, Number(p.ref)) : null
  const replayExistant = await replayDejaPrepare(db, p.source, p.ref)
  const demandeEnCours = await demandeClips(db, p.source === 'telegram' ? 'proposer_telegram' : 'proposer_youtube', p.ref, ['a_faire', 'en_cours'])
  return { telegram, replayExistant, demandeEnCours }
}

// ---------------------------------------------------------------------------
// Avant la carte
// ---------------------------------------------------------------------------

/**
 * Le controle avant la carte (lecture seule). `userId` = le compte qui parle
 * dans ce tour (le rangement est reserve aux admins du site, comme la route).
 * Ne jette pas : une panne revient au modele.
 */
export async function controlerGesteCockpit(action: ActionAgent, userId: string): Promise<ControleGesteCockpit> {
  if (!estTypeGesteCockpit(action.type)) return { erreur: 'Type de geste inconnu.' }
  try {
    return await controler(action, userId)
  } catch (err) {
    if (relationAbsente(err) && (action.type === 'decision_clip' || action.type === 'clips_replay' || action.type === 'envoi_opus')) {
      return { erreur: `${CLIPS_ABSENTS} ${RIEN}` }
    }
    if (relationAbsente(err) && TABLES_LOT2[action.type]) {
      return { erreur: `La table ${TABLES_LOT2[action.type]} n'est pas encore en base. ${RIEN}` }
    }
    return { erreur: `Lecture impossible avant la carte (${messageErreur(err).slice(0, 160)}) : réessaie dans un instant.` }
  }
}

async function controler(action: ActionAgent, userId: string): Promise<ControleGesteCockpit> {
  const carte = (params: Record<string, unknown>, texte: string): ControleGesteCockpit => ({
    action: { type: action.type, compte: 'cockpit', params }, carte: texte, manque: null,
  })

  // (05/11, LOT 2) Charges, abonnements IA, objectif, fonds, relais, adresse.
  if (TABLES_LOT2[action.type]) return controlerLot2(action, userId, carte)

  if (action.type === 'acces_academie') {
    const p = lireParamsAccesAcademie(action.params, jourParis(new Date()))
    if (typeof p === 'string') return { erreur: p }
    const offre = await lireOffre({ slug: p.offre })
    if (!offre) return { erreur: `Offre inconnue : « ${p.offre} ». Lis academie_offres (slug, titre, type) et repropose. ${RIEN}` }
    const deja = await prisma.$queryRaw<{ debut: string | null; fin: string | null }[]>`
      select to_char(a.debut at time zone 'Europe/Paris', 'YYYY-MM-DD') as debut,
             case when a.fin is null then null
                  else to_char(((a.fin at time zone 'Europe/Paris') - interval '1 second')::date, 'YYYY-MM-DD') end as fin
      from public.academie_acces a
      join public.academie_offres o on o.id = a.offre_id and o.slug = ${p.offre}
      where a.retire_le is null and (a.fin is null or a.fin > now())
        and (a.email = ${p.email} or a.user_id in (
          select u.id from auth.users u where lower(btrim(u.email)) = ${p.email} and u.email_confirmed_at is not null
          union
          select pe.profile_id from public.profile_emails pe where lower(btrim(pe.email)) = ${p.email} and pe.verified = true))
      limit 1`
    if (deja[0]) {
      return { erreur: `${p.email} a déjà un accès actif à « ${offre.titre} » (depuis le ${jourFr(deja[0].debut)}, `
        + `${deja[0].fin ? `jusqu'au ${jourFr(deja[0].fin)}` : 'à vie'}) : rien à accorder. ${RIEN}` }
    }
    const [qui, verifie] = await Promise.all([nomParEmail(p.email), compteVerifie(p.email)])
    return carte({ ...p }, carteAccesAcademie({ p, qui, offre, compteVerifie: verifie }))
  }

  if (action.type === 'retrait_acces_academie') {
    const p = lireParamsRetraitAcademie(action.params)
    if (typeof p === 'string') return { erreur: p }
    const l = await prisma.$queryRaw<{
      email: string | null; email_compte: string | null; source: string; offre_id: string
      debut: string | null; fin: string | null; retire_le: string | null
    }[]>`
      select a.email, (select lower(btrim(u.email)) from auth.users u where u.id = a.user_id) as email_compte,
             a.source, a.offre_id::text as offre_id,
             to_char(a.debut at time zone 'Europe/Paris', 'YYYY-MM-DD') as debut,
             case when a.fin is null then null
                  else to_char(((a.fin at time zone 'Europe/Paris') - interval '1 second')::date, 'YYYY-MM-DD') end as fin,
             to_char(a.retire_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as retire_le
      from public.academie_acces a where a.id = ${p.acces_id}::uuid`
    const a = l[0]
    if (!a) return { erreur: `Aucun accès ${p.acces_id} dans academie_acces : relis l'identifiant. ${RIEN}` }
    if (a.retire_le) return { erreur: `Cet accès est déjà retiré (le ${jourFr(a.retire_le)}). ${RIEN}` }
    const offre = await lireOffre({ id: a.offre_id })
    if (!offre) return { erreur: `L'offre de cet accès est introuvable. ${RIEN}` }
    const email = a.email ?? a.email_compte
    const qui = await nomParEmail(email)
    return carte({ ...p }, carteRetraitAcademie({
      p, acces: { accesId: p.acces_id, email, qui, offre, source: a.source, debut: a.debut, fin: a.fin },
    }))
  }

  if (action.type === 'rangement_academie') {
    const p = lireParamsRangement(action.params)
    if (typeof p === 'string') return { erreur: p }
    const { roleAcademie } = await import('@/lib/academie/droits')
    const { estAdmin } = await import('@/lib/academie/pur')
    if (!estAdmin(await roleAcademie(userId))) {
      return { erreur: `Le rangement de l'académie est réservé aux administrateurs du site (profiles.role admin), comme dans le cockpit : ton interlocuteur ne l'est pas. ${RIEN}` }
    }
    const arbre = await lireArbre(prisma)
    const g = gesteDeRangement(p)
    let plan: PlanArbre | null = null
    if (g.action === 'creer_section') {
      if (!arbre.modules.some(m => m.id === g.module)) return { erreur: `Module introuvable : relis academie_modules (id). ${RIEN}` }
    } else {
      const r = planGeste(arbre, g)
      if (!r.ok) {
        return { erreur: r.erreur === 'introuvable'
          ? `Leçon, section ou module introuvable : relis academie_lecons, academie_sections et academie_modules (id). ${RIEN}`
          : `Place impossible : la section choisie n'est pas dans ce module, ou l'élément « avant » n'est pas au même endroit. ${RIEN}` }
      }
      plan = r.plan
      const rien = rienNeChange(g, plan)
      if (rien) return { erreur: rien }
    }
    return carte({ ...p, empreinte: empreinteRangement(arbre, g) }, carteRangement(arbre, g, plan))
  }

  if (action.type === 'acces_mentorat') {
    const p = lireParamsMentorat(action.params)
    if (typeof p === 'string') return { erreur: p }
    const actif = await grantMentoratActif(p.email)
    if (p.quoi === 'accorder' && actif) {
      return { erreur: `${p.email} a déjà l'accès aux apps accordé à la main (le ${jourFr(actif.createdAt.toISOString())}) : rien à accorder. ${RIEN}` }
    }
    if (p.quoi === 'retirer' && !actif) {
      return { erreur: `Aucun accès aux apps accordé à la main pour ${p.email} (cockpit_mentorat_acces) : rien à retirer. `
        + `Un droit automatique (statut ETM, Live Club actif, tier Skool premium ou vip, Carnet Premium) ne se retire pas d'ici. ${RIEN}` }
    }
    const compte = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from auth.users u where lower(btrim(u.email)) = ${p.email} limit 1`
    const qui = await nomParEmail(p.email)
    return carte({ ...p }, carteMentorat({
      p, qui, compteExiste: compte.length > 0,
      accordeLe: actif ? actif.createdAt.toISOString() : null, noteActuelle: actif?.note ?? null,
    }))
  }

  if (action.type === 'decision_clip') {
    const p = lireParamsDecisionClip(action.params)
    if (typeof p === 'string') return { erreur: p }
    const clips = await lireClips(prisma, p.clip_ids)
    const refus = refusDecisionClip(p, clips)
    if (refus) return { erreur: refus }
    const replay = await lireReplay(prisma, clips[0].replayId)
    if (!replay) return { erreur: `Le replay de ces clips est introuvable. ${RIEN}` }
    return carte({ ...p, replay_id: replay.replayId }, carteDecisionClip({ p, clips, replay }))
  }

  if (action.type === 'clips_replay') {
    const p = lireParamsClipsReplay(action.params)
    if (typeof p === 'string') return { erreur: p }
    const etat = await lireEtatClipsReplay(prisma, p)
    const refus = refusClipsReplay({ p, ...etat })
    if (refus) return { erreur: refus }
    const complet = { ...p, personne: p.personne ?? personneReplayTelegram(etat.telegram as ReplayTelegramLu) }
    return carte({ ...complet }, carteClipsReplay({ p: complet, telegram: etat.telegram }))
  }

  // envoi_opus
  const p = lireParamsEnvoiOpus(action.params)
  if (typeof p === 'string') return { erreur: p }
  const replay = await lireReplay(prisma, p.replay_id)
  const demandeEnCours = await demandeClips(prisma, 'envoyer_opus', p.replay_id, ['a_faire', 'en_cours', 'faite'])
  const refus = refusEnvoiOpus({ replay, demandeEnCours })
  if (refus || !replay?.plage) return { erreur: refus ?? `Pas de plage proposée. ${RIEN}` }
  return carte({
    replay_id: p.replay_id, debut_s: replay.plage.debut_s, fin_s: replay.plage.fin_s,
    credits: creditsOpus(replay.plage.debut_s, replay.plage.fin_s),
  }, carteEnvoiOpus(replay))
}

// ---------------------------------------------------------------------------
// Au clic
// ---------------------------------------------------------------------------

function auteur(acteur: string): string {
  const uid = uuidDeActeur(acteur)
  if (!uid) throw new Error("Auteur de l'action illisible : rien n'a été fait.")
  return uid
}

/** Le clic d'une carte du LOT 1. Jette RefusAction si une regle bloque (rien n'est fait), Error sur une panne. */
export async function executerGesteCockpit(a: ActionAgent, acteur: string): Promise<string> {
  try {
    return await executer(a, acteur)
  } catch (err) {
    if (err instanceof RefusAction) throw err
    if (relationAbsente(err) && (a.type === 'decision_clip' || a.type === 'clips_replay' || a.type === 'envoi_opus')) {
      throw new RefusAction(`${CLIPS_ABSENTS} Rien n'a été fait.`)
    }
    if (TABLES_LOT2[a.type]) {
      if (relationAbsente(err)) throw new RefusAction(`La table ${TABLES_LOT2[a.type]} n'est pas encore en base : rien n'a été fait.`)
      // Une contrainte de la table (check, cle, lien) : l'ecriture est annulee en bloc.
      if (/\b23(505|514|503|502)\b|check constraint|unique constraint|foreign key|violates/i.test(messageErreur(err))) {
        throw new RefusAction("La base a refusé cette écriture (contrainte de la table) : rien n'a changé.")
      }
    }
    console.error(`[cockpit/agent/geste] ${a.type} : ${messageErreur(err)}`)
    throw new Error(`La base n'a pas répondu (${messageErreur(err).slice(0, 120)}) : rien n'a été fait. Réessaie dans un instant.`)
  }
}

async function executer(a: ActionAgent, acteur: string): Promise<string> {
  // (05/11, LOT 2) Charges, abonnements IA, objectif, fonds, relais, adresse.
  if (TABLES_LOT2[a.type]) return executerLot2(a, acteur)

  if (a.type === 'acces_academie') {
    const p = lireParamsAccesAcademie(a.params, jourParis(new Date()))
    if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a été fait.`)
    auteur(acteur)
    const r = await accorderAccesAcademieServeur({ action: 'accorder', ...p }, acteur)
    if (r.issue === 'offre_inconnue') throw new RefusAction(`L'offre « ${p.offre} » n'existe plus : rien n'a été accordé.`)
    if (r.issue === 'deja') throw new RefusAction(`${p.email} avait déjà un accès actif à cette offre : rien n'a été ajouté.`)
    const offre = await lireOffre({ slug: p.offre }).catch(() => null)
    return `Accès accordé : ${p.email} a l'offre « ${offre?.titre ?? p.offre} » de l'académie, ${p.fin ? `jusqu'au ${jourFr(p.fin)} inclus` : 'à vie'}. `
      + "Il s'ouvre dès qu'il se connecte avec cette adresse vérifiée."
  }

  if (a.type === 'retrait_acces_academie') {
    const p = lireParamsRetraitAcademie(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a été fait.`)
    auteur(acteur)
    const r = await retirerAccesAcademieServeur({ action: 'retirer', accesId: p.acces_id, raison: p.raison }, acteur)
    if (r.issue === 'inconnu') throw new RefusAction("Cet accès est inconnu ou déjà retiré : rien n'a changé.")
    return "Accès retiré à l'académie : la raison est notée sur l'accès. Ce qu'il a par un autre droit reste ouvert."
  }

  if (a.type === 'rangement_academie') {
    const p = lireParamsRangement(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a changé.`)
    if (!p.empreinte) throw new RefusAction("Carte incomplète (catalogue pas relu) : rien n'a changé, redemande la carte.")
    const uid = auteur(acteur)
    const { roleAcademie } = await import('@/lib/academie/droits')
    const { estAdmin } = await import('@/lib/academie/pur')
    if (!estAdmin(await roleAcademie(uid))) throw new RefusAction("Le rangement de l'académie est réservé aux administrateurs du site : rien n'a changé.")
    const g = gesteDeRangement(p)
    let issue: IssueGeste | { issue: 'change' }
    try {
      issue = await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(SQL_ARBRE_VERROU)
        // Ce qui s'execute est ce qui a ete lu : la carte nommait ces elements tels quels.
        if (empreinteRangement(await lireArbre(tx), g) !== p.empreinte) return { issue: 'change' as const }
        return executerGeste(tx, uid, g)
      }, { timeout: 15_000, maxWait: 5_000 })
    } catch (err) {
      if (/\b23(505|514|503)\b|check constraint|unique constraint|foreign key/i.test(messageErreur(err))) {
        throw new RefusAction("La base a refusé ce rangement (contrainte du catalogue) : rien n'a changé.")
      }
      throw err
    }
    if (issue.issue === 'change') throw new RefusAction("Le catalogue a changé depuis la carte (titre, place ou statut) : rien n'a changé, redemande la carte.")
    if (issue.issue === 'introuvable') throw new RefusAction("Une leçon, une section ou un module de la carte n'existe plus : rien n'a changé.")
    if (issue.issue === 'cible') throw new RefusAction("La place demandée n'existe plus (section ou élément « avant » déplacé) : rien n'a changé.")
    if (issue.modifies > 0) {
      const { viderCacheCatalogue } = await import('@/lib/academie/catalogue')
      viderCacheCatalogue()
    }
    console.info(`[cockpit/agent/geste] rangement ${g.action} modifies=${issue.modifies} refusees=${issue.refusees.length}`)
    return phraseRangementFait(g, issue)
  }

  if (a.type === 'acces_mentorat') {
    const p = lireParamsMentorat(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a été fait.`)
    auteur(acteur)
    if (p.quoi === 'accorder') {
      const { deja } = await accorderMentorat(p.email, p.note)
      if (deja) throw new RefusAction(`${p.email} avait déjà l'accès aux apps accordé à la main : rien n'a été ajouté.`)
      return `Accès aux apps accordé à ${p.email} : il s'ouvre quand il se connecte au journal ou à l'extension avec cette adresse.`
    }
    const n = await retirerMentorat(p.email)
    if (n === 0) throw new RefusAction(`Aucun accès aux apps accordé à la main pour ${p.email} : rien n'a été retiré.`)
    return `Accès aux apps retiré à ${p.email}. Un droit automatique (ETM, Live Club actif, tier Skool, Carnet Premium) reste ouvert s'il en a un.`
  }

  if (a.type === 'decision_clip') {
    const p = lireParamsDecisionClip(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a changé.`)
    if (!p.replay_id) throw new RefusAction("Carte incomplète (replay non relu) : rien n'a changé, redemande la carte.")
    const uid = auteur(acteur)
    const label = await libelleCompte(uid)
    const cible = p.decision === 'annuler' ? null : p.decision
    const r = await prisma.$transaction(async (tx) => {
      const clips = await lireClips(tx, p.clip_ids, true)
      if (clips.length !== p.clip_ids.length || clips.some(c => c.replayId !== p.replay_id || c.origine !== 'opus')) {
        return { refus: "Les clips de la carte ont changé (supprimés, ou d'un autre replay) : rien n'a changé, redemande la carte." }
      }
      const changent = clips.filter(c => c.decision !== cible)
      if (!changent.length) return { refus: "Ces clips sont déjà dans cet état : rien n'a changé." }
      const ids = changent.map(c => c.clipId)
      if (cible === null) {
        // Le trigger cockpit_clips_maj efface decide_le, decide_par et decide_label.
        await tx.$executeRaw`update public.cockpit_clips set decision = null
          where clip_id::text = any(${ids}::text[]) and decision is not null`
      } else {
        // auth.uid() est nul ici : le trigger ne pose rien, l'auteur est pose explicitement.
        await tx.$executeRaw`update public.cockpit_clips
          set decision = ${cible}::text, decision_note = coalesce(${p.note}::text, decision_note),
              decide_le = now(), decide_par = ${uid}::uuid, decide_label = ${label}::text
          where clip_id::text = any(${ids}::text[]) and decision is distinct from ${cible}::text`
      }
      return { faits: changent }
    })
    if ('refus' in r) throw new RefusAction(r.refus as string)
    const n = r.faits.length
    const etat = cible === 'garder' ? (n > 1 ? 'gardés' : 'gardé') : cible === 'ecarter' ? (n > 1 ? 'écartés' : 'écarté') : 'remis à trancher'
    const titres = r.faits.slice(0, 6).map(c => `« ${c.titre?.trim() || 'clip sans titre'} »`).join(', ') + (n > 6 ? ` et ${n - 6} autres` : '')
    return `C'est noté : ${n} ${n > 1 ? 'clips' : 'clip'} ${etat} (${titres}).`
  }

  if (a.type === 'clips_replay') {
    const p = lireParamsClipsReplay(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a été demandé.`)
    if (!p.personne) throw new RefusAction("Carte incomplète (le live de qui ?) : rien n'a été demandé, redemande la carte.")
    const uid = auteur(acteur)
    const actionDemande = p.source === 'telegram' ? 'proposer_telegram' : 'proposer_youtube'
    const r = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`clips:demande:${actionDemande}:${p.ref}`}::text, 0))) as verrou`
      const etat = await lireEtatClipsReplay(tx, p)
      const refus = refusClipsReplay({ p, ...etat })
      if (refus) return { refus: refus.replace(RIEN, "Rien n'a été demandé.") }
      await tx.$executeRaw`insert into public.cockpit_clips_demandes (action, ref, personne, pose_par)
        values (${actionDemande}, ${p.ref}, ${p.personne}, ${uid}::uuid)`
      return { titre: etat.telegram ? ((etat.telegram.legende ?? '').split('\n')[0].trim() || null) : null }
    })
    if ('refus' in r) throw new RefusAction(r.refus as string)
    return phraseClipsReplayPose({ p, titre: r.titre })
  }

  if (a.type === 'envoi_opus') {
    const p = lireParamsEnvoiOpus(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} Rien n'est parti.`)
    if (p.debut_s === null || p.fin_s === null || p.credits === null) {
      throw new RefusAction("Carte incomplète (plage non relue) : rien n'est parti, redemande la carte.")
    }
    const uid = auteur(acteur)
    const r = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`clips:envoi:${p.replay_id}`}::text, 0))) as verrou`
      const replay = await lireReplay(tx, p.replay_id)
      const demandeEnCours = await demandeClips(tx, 'envoyer_opus', p.replay_id, ['a_faire', 'en_cours', 'faite'])
      const refus = refusEnvoiOpus({ replay, demandeEnCours })
      if (refus || !replay?.plage) return { refus: (refus ?? 'Pas de plage proposée.').replace(RIEN, "Rien n'est parti.") }
      const pl = replay.plage
      // Ce qui part est ce que la carte a dit : la plage et ses credits.
      if (Math.abs(pl.debut_s - p.debut_s!) > 0.5 || Math.abs(pl.fin_s - p.fin_s!) > 0.5 || creditsOpus(pl.debut_s, pl.fin_s) !== p.credits) {
        return { refus: `La plage proposée a changé depuis la carte (maintenant ${horaire(pl.debut_s)} à ${horaire(pl.fin_s)}, `
          + `${creditsOpus(pl.debut_s, pl.fin_s)} crédits) : rien n'est parti, redemande la carte.` }
      }
      await tx.$executeRaw`insert into public.cockpit_clips_demandes (action, ref, personne, pose_par)
        values ('envoyer_opus', ${p.replay_id}, ${replay.personne}, ${uid}::uuid)`
      return { titre: replay.titre }
    })
    if ('refus' in r) throw new RefusAction(r.refus as string)
    return `Demande d'envoi posée : la plage ${horaire(p.debut_s)} à ${horaire(p.fin_s)} de « ${r.titre?.trim() || 'ce replay'} » `
      + `part chez Opus au prochain passage du script (${p.credits} crédits Opus). Agent AOK te prévient quand c'est parti, puis quand les clips arrivent.`
  }

  throw new RefusAction(`Geste inconnu (${String(a.type)}) : rien n'a été fait.`)
}

// ===========================================================================
// LOT 2 (05/11/2026). Brice, 05/11 : « que l'agent puisse faire depuis
// Telegram les gestes du cockpit ». Les ecritures de l'ecran du cockpit
// (navigateur, jeton de la personne, RLS), refaites ici en role postgres avec
// les colonnes d'acteur posees a la main (voir l'en-tete du fichier).
// ===========================================================================

/** Les types du LOT 2 et leur table (pour dire une migration pas appliquee). */
const TABLES_LOT2: Readonly<Record<string, string>> = {
  charge_fixe: 'cockpit_charges (migration 20261018201000)',
  abonnement_ia: 'cockpit_depenses_ia_fixes (migration 20261019200000)',
  objectif_publication: 'cockpit_social_objectifs (migration 20261105200000)',
  note_fonds: 'cockpit_arch_notes (migration 20260901220000)',
  decision_fonds: 'cockpit_arch_propositions (migration 20260907170000)',
  enquete_fonds: 'cockpit_arch_propositions (migration 20260907170000)',
  relais_accueil: 'cockpit_liveclub_relais (migration 20261024120000)',
  retrait_adresse: 'cockpit_membre_emails',
}

const REFUS_FONDS = "Le fonds (Les personnes) est réservé aux comptes qui le voient (accès au fonds dans cockpit_allowlist), comme dans le cockpit."
const CHANGE = "Rien n'a changé."

// ---------------------------------------------------------------------------
// Lectures du LOT 2
// ---------------------------------------------------------------------------

type LigneCharge = {
  outil: string; categorie: string | null; montant: number | null; devise: string; montant_eur: number | null
  periodicite: string; payeur: string | null; du: string | null; au: string | null; a_confirmer: boolean
  note: string | null; maj_le: string
}

/** Une charge non retiree et son empreinte (maj_le compris : tout changement depuis la carte la change), ou null. */
async function lireCharge(db: Db, id: string, verrou = false): Promise<{ champs: ChampsCharge; empreinte: string } | null> {
  const requete = Prisma.sql`
    select outil, categorie, montant::float8 as montant, devise, montant_eur::float8 as montant_eur, periodicite, payeur,
           to_char(du, 'YYYY-MM-DD') as du, to_char(au, 'YYYY-MM-DD') as au, a_confirmer, note, maj_le::text as maj_le
    from public.cockpit_charges where charge_id = ${id}::uuid and retire_le is null`
  const l = await db.$queryRaw<LigneCharge[]>(verrou ? Prisma.sql`${requete} for update` : requete)
  const r = l[0]
  if (!r) return null
  const champs: ChampsCharge = {
    outil: r.outil, categorie: r.categorie, montant: r.montant === null ? null : Number(r.montant),
    devise: r.devise as ChampsCharge['devise'], montant_eur: r.montant_eur === null ? null : Number(r.montant_eur),
    periodicite: r.periodicite as ChampsCharge['periodicite'], payeur: r.payeur as ChampsCharge['payeur'],
    du: r.du, au: r.au, a_confirmer: r.a_confirmer, note: r.note,
  }
  return { champs, empreinte: empreinteLigne([...CLES_CHARGE.map(k => champs[k]), r.maj_le]) }
}

/** Une charge du meme nom qui court encore (au vide ou a venir), pour prevenir d'un doublon. */
async function chargeQuiCourt(outil: string, aujourdhui: string): Promise<ChampsCharge | null> {
  const l = await prisma.$queryRaw<{ charge_id: string }[]>`
    select charge_id::text as charge_id from public.cockpit_charges
    where retire_le is null and lower(outil) = lower(${outil}) and (au is null or au >= ${aujourdhui}::date)
    order by du desc nulls last limit 1`
  if (!l[0]) return null
  return (await lireCharge(prisma, l[0].charge_id))?.champs ?? null
}

/** Un abonnement IA non retire et son empreinte, ou null. */
async function lireAbonnementIA(db: Db, id: string, verrou = false): Promise<{ lu: AbonnementLu; empreinte: string } | null> {
  const requete = Prisma.sql`
    select libelle, fournisseur, montant::float8 as montant, devise, periodicite,
           to_char(debut, 'YYYY-MM-DD') as debut, to_char(fin, 'YYYY-MM-DD') as fin, note
    from public.cockpit_depenses_ia_fixes where fixe_id = ${id}::uuid and retire_le is null`
  const l = await db.$queryRaw<(Omit<AbonnementLu, 'montant'> & { montant: number })[]>(verrou ? Prisma.sql`${requete} for update` : requete)
  const r = l[0]
  if (!r) return null
  const lu: AbonnementLu = { ...r, montant: Number(r.montant) }
  return { lu, empreinte: empreinteLigne([lu.libelle, lu.fournisseur, lu.montant, lu.devise, lu.periodicite, lu.debut, lu.fin, lu.note]) }
}

/** Une publication Instagram (cockpit_social_publications), ou null. */
async function lirePublication(db: Db, id: string): Promise<PublicationLue | null> {
  const l = await db.$queryRaw<{ publication_id: string; publie_le: string | null; type: string | null; legende: string | null }[]>`
    select publication_id, to_char(publie_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as publie_le, type, legende
    from public.cockpit_social_publications where plateforme = 'instagram' and publication_id = ${id} limit 1`
  const r = l[0]
  return r ? { publicationId: r.publication_id, publieLe: r.publie_le, type: r.type, legende: r.legende } : null
}

async function objectifActuel(db: Db, id: string, verrou = false): Promise<ObjectifPublication | null> {
  const requete = Prisma.sql`
    select objectif from public.cockpit_social_objectifs where plateforme = 'instagram' and publication_id = ${id}`
  const l = await db.$queryRaw<{ objectif: ObjectifPublication }[]>(verrou ? Prisma.sql`${requete} for update` : requete)
  return l[0]?.objectif ?? null
}

/** Le compte voit-il le fonds (cockpit_allowlist.acces_fonds, comme is_cockpit_fonds() et la route de l'enquete) ? */
async function voitLeFonds(userId: string): Promise<boolean> {
  const l = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid and acces_fonds`
  return l.length > 0
}

async function lirePersonneFonds(db: Db, id: string): Promise<PersonneFondsLue | null> {
  const l = await db.$queryRaw<{ personne_id: string; nom: string; nature: string | null; messages: number }[]>`
    select personne_id, nom, nature, messages::int as messages from public.cockpit_arch_personnes where personne_id = ${id}`
  const r = l[0]
  return r ? { personneId: r.personne_id, nom: r.nom, nature: r.nature, messages: Number(r.messages) } : null
}

async function lirePropositions(db: Db, ids: string[], verrou = false): Promise<PropositionLue[]> {
  const requete = Prisma.sql`
    select proposition_id::text as proposition_id, personne_id, champ, reseau, valeur, source_url, confiance, statut
    from public.cockpit_arch_propositions where proposition_id::text = any(${ids}::text[])`
  const l = await db.$queryRaw<{
    proposition_id: string; personne_id: string; champ: string; reseau: string | null; valeur: string
    source_url: string | null; confiance: string; statut: string
  }[]>(verrou ? Prisma.sql`${requete} for update` : requete)
  return l.map(x => ({
    propositionId: x.proposition_id, personneId: x.personne_id, champ: x.champ, reseau: x.reseau, valeur: x.valeur,
    sourceUrl: x.source_url, confiance: x.confiance, statut: x.statut,
  }))
}

/** Ce que les enquetes deja faites ont propose sur la personne. */
async function etatEnquetes(personneId: string): Promise<EtatEnquetes> {
  const l = await prisma.$queryRaw<{ attente: number; acceptees: number; refusees: number; derniere: string | null }[]>`
    select count(*) filter (where statut = 'proposee')::int as attente,
           count(*) filter (where statut = 'acceptee')::int as acceptees,
           count(*) filter (where statut = 'refusee')::int as refusees,
           to_char(max(cree_le) at time zone 'Europe/Paris', 'YYYY-MM-DD') as derniere
    from public.cockpit_arch_propositions where personne_id = ${personneId}`
  const r = l[0]
  return { attente: Number(r?.attente ?? 0), acceptees: Number(r?.acceptees ?? 0), refusees: Number(r?.refusees ?? 0), derniere: r?.derniere ?? null }
}

/**
 * Le cout MESURE des 20 dernieres enquetes (AiUsage, poste « enquete », une
 * enquete = un echange, cout fige a l'ecriture), en euros. null = aucune
 * mesure (ou lecture impossible) : la carte le dit, sans inventer de chiffre.
 */
async function coutEnquetes(): Promise<CoutEnquetes> {
  try {
    const l = await prisma.$queryRaw<{ n: number; moyenne: number | null; plus: number | null }[]>`
      select count(*)::int as n, avg(c)::float8 as moyenne, max(c)::float8 as plus
      from (
        select sum("costMicros")::float8 / 1000000 as c
        from public."AiUsage"
        where "usage" = 'enquete' and "echange" is not null
        group by "echange"
        order by max("createdAt") desc
        limit 20
      ) x`
    const r = l[0]
    if (!r || !Number(r.n)) return null
    return { n: Number(r.n), moyenneEur: Number(r.moyenne ?? 0), maxEur: Number(r.plus ?? 0) }
  } catch (err) {
    console.warn(`[cockpit/agent/geste] cout des enquetes illisible : ${messageErreur(err)}`)
    return null
  }
}

async function lireRelais(db: Db, telegramId: number, verrou = false): Promise<RelaisLu | null> {
  const requete = Prisma.sql`
    select r.telegram_id::text as telegram_id, r.nom, r.actif, r.motifs,
           to_char(r.coupe_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as coupe_le,
           (select count(*)::int from public.cockpit_liveclub_relais_episodes e
             where e.relais_id = r.telegram_id and e.envoye_le is not null and e.fait_le is null) as en_cours
    from public.cockpit_liveclub_relais r where r.telegram_id = ${String(telegramId)}::bigint`
  const l = await db.$queryRaw<{ telegram_id: string; nom: string; actif: boolean; motifs: string[] | null; coupe_le: string | null; en_cours: number }[]>(
    verrou ? Prisma.sql`${requete} for update of r` : requete)
  const r = l[0]
  return r ? {
    telegramId: Number(r.telegram_id), nom: r.nom, actif: r.actif, motifs: r.motifs ?? [], enCours: Number(r.en_cours), coupeLe: r.coupe_le,
  } : null
}

/** Une adresse de cockpit_membre_emails, sa fiche et ses voisines. compteSite n'est lu qu'avant la carte. */
async function lireAdresse(db: Db, email: string, verrou = false): Promise<AdresseLue | null> {
  const requete = Prisma.sql`
    select e.email, e.membre_id::text as membre_id, e.principal, e.verifie,
           nullif(btrim(case when m.prenom is not null and m.nom ilike m.prenom || '%' then m.nom
                             else concat_ws(' ', m.prenom, m.nom) end), '') as qui
    from public.cockpit_membre_emails e
    join public.cockpit_membres m on m.membre_id = e.membre_id
    where e.email = ${email}`
  const l = await db.$queryRaw<{ email: string; membre_id: string; principal: boolean; verifie: boolean; qui: string | null }[]>(
    verrou ? Prisma.sql`${requete} for update of e` : requete)
  const r = l[0]
  if (!r) return null
  const voisines = await db.$queryRaw<{ email: string; principal: boolean }[]>`
    select email, principal from public.cockpit_membre_emails
    where membre_id = ${r.membre_id}::uuid and email <> ${email} order by principal desc, email`
  return {
    email: r.email, membreId: r.membre_id, principal: r.principal, verifie: r.verifie, nom: r.qui?.slice(0, 120) ?? null,
    principales: voisines.filter(v => v.principal).map(v => v.email),
    autres: voisines.filter(v => !v.principal).length,
    compteSite: false,
  }
}

// ---------------------------------------------------------------------------
// Avant la carte (LOT 2)
// ---------------------------------------------------------------------------

async function controlerLot2(
  action: ActionAgent, userId: string,
  carte: (params: Record<string, unknown>, texte: string) => ControleGesteCockpit,
): Promise<ControleGesteCockpit> {
  const aujourdhui = jourParis(new Date())

  if (action.type === 'charge_fixe') {
    const p = lireParamsCharge(action.params)
    if (typeof p === 'string') return { erreur: p }
    if (p.quoi === 'ajouter') {
      const doublon = await chargeQuiCourt(chargeAAjouter(p).outil, aujourdhui)
      return carte({ ...p }, carteCharge({ p, lue: null, doublon }))
    }
    const lue = await lireCharge(prisma, p.charge_id as string)
    const refus = refusCharge(p, lue?.champs ?? null)
    if (refus || !lue) return { erreur: refus ?? RIEN }
    return carte({ ...p, empreinte: lue.empreinte }, carteCharge({ p, lue: lue.champs }))
  }

  if (action.type === 'abonnement_ia') {
    const p = lireParamsAbonnementIA(action.params, aujourdhui)
    if (typeof p === 'string') return { erreur: p }
    if (p.quoi === 'ajouter') return carte({ ...p }, carteAbonnementIA({ p, lu: null }))
    const lu = await lireAbonnementIA(prisma, p.fixe_id as string)
    const refus = refusAbonnementIA(p, lu?.lu ?? null)
    if (refus || !lu) return { erreur: refus ?? RIEN }
    return carte({ ...p, empreinte: lu.empreinte }, carteAbonnementIA({ p, lu: lu.lu }))
  }

  if (action.type === 'objectif_publication') {
    const p = lireParamsObjectif(action.params)
    if (typeof p === 'string') return { erreur: p }
    const pub = await lirePublication(prisma, p.publication_id)
    const actuel = pub ? await objectifActuel(prisma, p.publication_id) : null
    const refus = refusObjectif(p, pub, actuel)
    if (refus || !pub) return { erreur: refus ?? RIEN }
    return carte({ ...p, avant: actuel ?? 'sans' }, carteObjectif({ p, pub, actuel }))
  }

  if (action.type === 'note_fonds' || action.type === 'decision_fonds' || action.type === 'enquete_fonds') {
    if (!(await voitLeFonds(userId))) return { erreur: `${REFUS_FONDS} Ton interlocuteur ne l'a pas. ${RIEN}` }
  }

  if (action.type === 'note_fonds') {
    const p = lireParamsNoteFonds(action.params)
    if (typeof p === 'string') return { erreur: p }
    let personne: PersonneFondsLue | null = null
    if (p.personne_id) {
      personne = await lirePersonneFonds(prisma, p.personne_id)
      if (!personne) return { erreur: `Personne inconnue du fonds (cockpit_arch_personnes) : relis l'identifiant, ou passe un sujet si elle n'y est pas. ${RIEN}` }
    }
    return carte({ ...p }, carteNoteFonds({ p, personne }))
  }

  if (action.type === 'decision_fonds') {
    const p = lireParamsDecisionFonds(action.params)
    if (typeof p === 'string') return { erreur: p }
    const props = await lirePropositions(prisma, p.proposition_ids)
    const refus = refusDecisionFonds(p, props)
    if (refus) return { erreur: refus }
    const personne = await lirePersonneFonds(prisma, props[0].personneId)
    return carte({ ...p, personne_id: props[0].personneId }, carteDecisionFonds({ p, props, personne }))
  }

  if (action.type === 'enquete_fonds') {
    const p = lireParamsEnqueteFonds(action.params)
    if (typeof p === 'string') return { erreur: p }
    const personne = await lirePersonneFonds(prisma, p.personne_id)
    if (!personne) return { erreur: `Personne inconnue du fonds (cockpit_arch_personnes) : relis l'identifiant. ${RIEN}` }
    const [etat, cout] = await Promise.all([etatEnquetes(p.personne_id), coutEnquetes()])
    const c = carte({ ...p }, carteEnqueteFonds({ personne, etat, cout }))
    if ('erreur' in c) return c
    // Sans la cle du modele du cockpit, la carte s'affiche sans bouton (comme une cle Stripe absente).
    return aiKeyFor('cockpit') ? c : { ...c, manque: "La clé du modèle du cockpit (ANTHROPIC_API_KEY_COCKPIT) n'est pas posée sur le projet journal : rien ne peut être lancé." }
  }

  if (action.type === 'relais_accueil') {
    const p = lireParamsRelais(action.params)
    if (typeof p === 'string') return { erreur: p }
    const r = await lireRelais(prisma, p.telegram_id)
    const refus = refusRelais(p, r)
    if (refus || !r) return { erreur: refus ?? RIEN }
    return carte({ ...p }, carteRelais({ p, r }))
  }

  // retrait_adresse
  const p = lireParamsRetraitAdresse(action.params)
  if (typeof p === 'string') return { erreur: p }
  const lue = await lireAdresse(prisma, p.email)
  const refus = refusRetraitAdresse(p, lue)
  if (refus || !lue) return { erreur: refus ?? RIEN }
  const adresse = { ...lue, compteSite: await compteVerifie(p.email) }
  return carte({ ...p, membre_id: lue.membreId }, carteRetraitAdresse(adresse))
}

// ---------------------------------------------------------------------------
// Au clic (LOT 2)
// ---------------------------------------------------------------------------

async function executerLot2(a: ActionAgent, acteur: string): Promise<string> {
  if (a.type === 'charge_fixe') {
    const p = lireParamsCharge(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} ${CHANGE}`)
    const uid = auteur(acteur)
    if (p.quoi === 'ajouter') {
      const c = chargeAAjouter(p)
      const regle = regleCharge(c)
      if (regle) throw new RefusAction(`${regle} Rien n'a été ajouté.`)
      // pose_par : default auth.uid(), nul ici. Pose a la main (le trigger le fige ensuite).
      await prisma.$executeRaw`insert into public.cockpit_charges
        (outil, categorie, montant, devise, montant_eur, periodicite, payeur, du, au, a_confirmer, note, pose_par)
        values (${c.outil}, ${c.categorie}::text, ${c.montant}::numeric, ${c.devise}, ${c.montant_eur}::numeric, ${c.periodicite},
                ${c.payeur}::text, ${c.du}::date, ${c.au}::date, ${c.a_confirmer}, ${c.note}::text, ${uid}::uuid)`
      return phraseChargeFaite(p, null, c)
    }
    if (!p.empreinte) throw new RefusAction(`Carte incomplète (charge non relue) : ${CHANGE.toLowerCase()} Redemande la carte.`)
    const r = await prisma.$transaction(async (tx) => {
      const lue = await lireCharge(tx, p.charge_id as string, true)
      const refus = refusCharge(p, lue?.champs ?? null)
      if (refus || !lue) return { refus: (refus ?? '').replace(RIEN, CHANGE) }
      // Ce qui s'ecrit est ce que la carte a lu : la ligne n'a pas bouge depuis.
      if (lue.empreinte !== p.empreinte) return { refus: `La charge a changé depuis la carte : ${CHANGE.toLowerCase()} Redemande la carte.` }
      if (p.quoi === 'retirer') {
        // retire_par : le compte qui confirme (l'ecran pose celui de la session).
        await tx.$executeRaw`update public.cockpit_charges set retire_le = now(), retire_par = ${uid}::uuid
          where charge_id = ${p.charge_id}::uuid and retire_le is null`
        return { avant: lue.champs, apres: lue.champs }
      }
      const c = appliquerCharge(lue.champs, p)
      await tx.$executeRaw`update public.cockpit_charges
        set outil = ${c.outil}, categorie = ${c.categorie}::text, montant = ${c.montant}::numeric, devise = ${c.devise},
            montant_eur = ${c.montant_eur}::numeric, periodicite = ${c.periodicite}, payeur = ${c.payeur}::text,
            du = ${c.du}::date, au = ${c.au}::date, a_confirmer = ${c.a_confirmer}, note = ${c.note}::text
        where charge_id = ${p.charge_id}::uuid and retire_le is null`
      return { avant: lue.champs, apres: c }
    })
    if ('refus' in r) throw new RefusAction(r.refus as string)
    return phraseChargeFaite(p, r.avant, r.apres)
  }

  if (a.type === 'abonnement_ia') {
    const p = lireParamsAbonnementIA(a.params, jourParis(new Date()))
    if (typeof p === 'string') throw new RefusAction(`${p} ${CHANGE}`)
    const uid = auteur(acteur)
    if (p.quoi === 'ajouter') {
      const ab = abonnementAAjouter(p)
      // pose_par : not null default auth.uid(), nul ici. Pose a la main, sinon l'ajout serait refuse.
      await prisma.$executeRaw`insert into public.cockpit_depenses_ia_fixes
        (libelle, fournisseur, montant, devise, periodicite, debut, note, pose_par)
        values (${ab.libelle}, ${ab.fournisseur}::text, ${ab.montant}::numeric, ${ab.devise}, ${ab.periodicite}, ${ab.debut}::date,
                ${ab.note}::text, ${uid}::uuid)`
      return phraseAbonnementFait(p, ab)
    }
    if (!p.empreinte) throw new RefusAction(`Carte incomplète (abonnement non relu) : ${CHANGE.toLowerCase()} Redemande la carte.`)
    const r = await prisma.$transaction(async (tx) => {
      const lu = await lireAbonnementIA(tx, p.fixe_id as string, true)
      const refus = refusAbonnementIA(p, lu?.lu ?? null)
      if (refus || !lu) return { refus: (refus ?? '').replace(RIEN, CHANGE) }
      if (lu.empreinte !== p.empreinte) return { refus: `L'abonnement a changé depuis la carte : ${CHANGE.toLowerCase()} Redemande la carte.` }
      if (p.quoi === 'arreter') {
        await tx.$executeRaw`update public.cockpit_depenses_ia_fixes set fin = ${p.fin}::date
          where fixe_id = ${p.fixe_id}::uuid and retire_le is null and fin is null`
      } else {
        await tx.$executeRaw`update public.cockpit_depenses_ia_fixes set retire_le = now(), retire_par = ${uid}::uuid
          where fixe_id = ${p.fixe_id}::uuid and retire_le is null`
      }
      return { lu: lu.lu }
    })
    if ('refus' in r) throw new RefusAction(r.refus as string)
    return phraseAbonnementFait(p, r.lu)
  }

  if (a.type === 'objectif_publication') {
    const p = lireParamsObjectif(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} ${CHANGE}`)
    if (!p.avant) throw new RefusAction(`Carte incomplète (objectif non relu) : ${CHANGE.toLowerCase()} Redemande la carte.`)
    const uid = auteur(acteur)
    const r = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`objectif:instagram:${p.publication_id}`}::text, 0))) as verrou`
      const pub = await lirePublication(tx, p.publication_id)
      const actuel = pub ? await objectifActuel(tx, p.publication_id, true) : null
      if (pub && (actuel ?? 'sans') !== p.avant) return { refus: `L'objectif de cette publication a changé depuis la carte : ${CHANGE.toLowerCase()} Redemande la carte.` }
      const refus = refusObjectif(p, pub, actuel)
      if (refus || !pub) return { refus: (refus ?? '').replace(RIEN, CHANGE) }
      // pose_par et pose_le : comme l'upsert de l'ecran (le dernier choix gagne, signe).
      await tx.$executeRaw`insert into public.cockpit_social_objectifs (plateforme, publication_id, objectif, pose_par, pose_le)
        values ('instagram', ${p.publication_id}, ${p.objectif}, ${uid}::uuid, now())
        on conflict (plateforme, publication_id)
        do update set objectif = excluded.objectif, pose_par = excluded.pose_par, pose_le = excluded.pose_le`
      return { pub }
    })
    if ('refus' in r) throw new RefusAction(r.refus as string)
    return phraseObjectifPose(p, r.pub)
  }

  if (a.type === 'note_fonds') {
    const p = lireParamsNoteFonds(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a été écrit.`)
    const uid = auteur(acteur)
    if (!(await voitLeFonds(uid))) throw new RefusAction(`${REFUS_FONDS} Ce compte ne l'a pas : rien n'a été écrit.`)
    let personne: PersonneFondsLue | null = null
    if (p.personne_id) {
      personne = await lirePersonneFonds(prisma, p.personne_id)
      if (!personne) throw new RefusAction("Cette personne n'est plus dans le fonds : rien n'a été écrit.")
    }
    // ecrit_par : not null default auth.uid(), nul ici. Le compte qui confirme signe la note.
    await prisma.$executeRaw`insert into public.cockpit_arch_notes (personne_id, sujet, rubrique, texte, ecrit_par)
      values (${p.personne_id}::text, ${p.sujet}::text, ${p.rubrique}, ${p.texte}, ${uid}::uuid)`
    return phraseNoteFondsEcrite(p, personne)
  }

  if (a.type === 'decision_fonds') {
    const p = lireParamsDecisionFonds(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} ${CHANGE}`)
    if (!p.personne_id) throw new RefusAction(`Carte incomplète (propositions non relues) : ${CHANGE.toLowerCase()} Redemande la carte.`)
    const uid = auteur(acteur)
    if (!(await voitLeFonds(uid))) throw new RefusAction(`${REFUS_FONDS} Ce compte ne l'a pas : ${CHANGE.toLowerCase()}`)
    const r = await prisma.$transaction(async (tx) => {
      const props = await lirePropositions(tx, p.proposition_ids, true)
      if (props.length !== p.proposition_ids.length || props.some(x => x.personneId !== p.personne_id)) {
        return { refus: `Les propositions de la carte ont changé (supprimées, ou d'une autre personne) : ${CHANGE.toLowerCase()} Redemande la carte.` }
      }
      const changent = props.filter(x => x.statut !== p.statut).map(x => x.propositionId)
      if (!changent.length) return { refus: `Ces propositions sont déjà dans cet état : ${CHANGE.toLowerCase()}` }
      // decide_le : le trigger cockpit_arch_propositions_figer ne le pose que pour le role authenticated.
      await tx.$executeRaw`update public.cockpit_arch_propositions
        set statut = ${p.statut}, decide_par = ${uid}::uuid, decide_le = now()
        where proposition_id::text = any(${changent}::text[]) and statut is distinct from ${p.statut}`
      return { n: changent.length }
    })
    if ('refus' in r) throw new RefusAction(r.refus as string)
    const personne = await lirePersonneFonds(prisma, p.personne_id).catch(() => null)
    return phraseDecisionFondsFaite(p, r.n, personne)
  }

  if (a.type === 'enquete_fonds') {
    const p = lireParamsEnqueteFonds(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a été lancé.`)
    const uid = auteur(acteur)
    if (!(await voitLeFonds(uid))) throw new RefusAction(`${REFUS_FONDS} Ce compte ne l'a pas : rien n'a été lancé.`)
    // La meme enquete que le bouton du cockpit (POST /api/cockpit/enquete) : fonds-enquete.ts.
    const { menerEnquete, preparerEnquete } = await import('@/lib/fonds-enquete')
    const prep = await preparerEnquete(p.personne_id)
    if (!prep) throw new RefusAction("Cette personne n'est plus dans le fonds : rien n'a été lancé.")
    let issue: Awaited<ReturnType<typeof menerEnquete>>
    try {
      issue = await menerEnquete(uid, prep)
    } catch (err) {
      console.error(`[cockpit/agent/geste] enquete : ${messageErreur(err)}`)
      throw new RefusAction(`L'enquête n'a pas abouti (${aiErrorMessage(err, 'ANTHROPIC_API_KEY_COCKPIT')}). Les appels déjà faits au modèle sont comptés dans Dépense IA.`)
    }
    console.info(`[cockpit/agent/geste] enquete posees=${issue.posees} sources=${issue.sources}`)
    // Ni le resume ni les homonymes du modele (texte venu du web) dans la phrase : des chiffres seulement.
    return phraseEnqueteFaite({ nom: prep.nom, posees: issue.posees, sources: issue.sources })
  }

  if (a.type === 'relais_accueil') {
    const p = lireParamsRelais(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} ${CHANGE}`)
    const uid = auteur(acteur)
    const r = await prisma.$transaction(async (tx) => {
      const lu = await lireRelais(tx, p.telegram_id, true)
      const refus = refusRelais(p, lu)
      if (refus || !lu) return { refus: (refus ?? '').replace(RIEN, CHANGE) }
      await tx.$executeRaw`update public.cockpit_liveclub_relais set actif = ${p.quoi === 'rallumer'}
        where telegram_id = ${String(p.telegram_id)}::bigint`
      if (p.quoi === 'couper') {
        // Le trigger vient de poser coupe_par = auth.uid(), nul ici : le compte qui confirme, sans toucher a actif.
        await tx.$executeRaw`update public.cockpit_liveclub_relais set coupe_par = ${uid}::uuid
          where telegram_id = ${String(p.telegram_id)}::bigint and not actif`
      }
      return { nom: lu.nom }
    })
    if ('refus' in r) throw new RefusAction(r.refus as string)
    return phraseRelaisFait(p, r.nom)
  }

  if (a.type === 'retrait_adresse') {
    const p = lireParamsRetraitAdresse(a.params)
    if (typeof p === 'string') throw new RefusAction(`${p} ${CHANGE}`)
    if (!p.membre_id) throw new RefusAction(`Carte incomplète (adresse non relue) : ${CHANGE.toLowerCase()} Redemande la carte.`)
    auteur(acteur)
    const r = await prisma.$transaction(async (tx) => {
      const lue = await lireAdresse(tx, p.email, true)
      const refus = refusRetraitAdresse(p, lue)
      if (refus || !lue) return { refus: (refus ?? '').replace(RIEN, CHANGE) }
      // Comme la policy de l'ecran : seulement une ligne principal = false, de la fiche lue par la carte.
      const n = await tx.$executeRaw`delete from public.cockpit_membre_emails
        where email = ${p.email} and principal = false and membre_id = ${p.membre_id}::uuid`
      if (n !== 1) return { refus: `Retrait refusé : l'adresse est principale ou n'existe plus. ${CHANGE}` }
      return { adresse: lue }
    })
    if ('refus' in r) throw new RefusAction(r.refus as string)
    return phraseAdresseRetiree(r.adresse)
  }

  throw new RefusAction(`Geste inconnu (${String(a.type)}) : rien n'a été fait.`)
}
