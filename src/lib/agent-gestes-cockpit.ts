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

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
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
    return { erreur: `Lecture impossible avant la carte (${messageErreur(err).slice(0, 160)}) : réessaie dans un instant.` }
  }
}

async function controler(action: ActionAgent, userId: string): Promise<ControleGesteCockpit> {
  const carte = (params: Record<string, unknown>, texte: string): ControleGesteCockpit => ({
    action: { type: action.type, compte: 'cockpit', params }, carte: texte, manque: null,
  })

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
    console.error(`[cockpit/agent/geste] ${a.type} : ${messageErreur(err)}`)
    throw new Error(`La base n'a pas répondu (${messageErreur(err).slice(0, 120)}) : rien n'a été fait. Réessaie dans un instant.`)
  }
}

async function executer(a: ActionAgent, acteur: string): Promise<string> {
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
