// Les CORRECTIONS DE @ proposees par un relais d'accueil (Brice, 24/10 :
// « Alex peut aussi recevoir les ecarts, comme ca il nous les remonte plus
// rapidement et pourra proposer le correctif apres avoir contacte le
// membre »). Regles pures dans relais-pur.ts, tables et trigger dans la
// migration 20261024150000_cockpit_liveclub_pseudos.sql.
//
// 1. L'outil proposer_correction_pseudo de l'agent des membres (relais actif
//    seulement) : le membre doit etre parmi ceux transmis a CE relais
//    (episode ou ecart parti), le @ au bon format. La proposition est
//    ENREGISTREE, jamais appliquee : la fiche ne change qu'a la validation.
//    Couvre aussi le @ manquant d'un membre transmis sans @.
// 2. Aussitot, chaque compte de l'equipe (cockpit_telegram_comptes) la recoit
//    par Agent AOK avec Valider et Refuser (ps:v:<id>, ps:r:<id>).
// 3. Le clic (agent-cockpit-telegram.ts, apres le verrou du compte de
//    l'equipe) : Valider = la fiche prend ce @, protege du push des
//    paiements par le trigger cockpit_membres_pseudo_corrige. Aucun
//    rattachement n'est change : si le compte rattache porte un autre @, le
//    message le dit. Refuser = marquee refusee. Un second clic, ou le clic
//    d'un autre membre de l'equipe : deja traite.
//
// Jamais de nom, de pseudo ni d'identifiant dans un log : des comptes seulement.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { tgCockpit, type ClicAgentTelegram, type CompteCockpitTelegram } from '@/lib/agent-cockpit-telegram'
import { messageErreur, relationAbsente } from './pur'
import { estRelaisActif } from './relais'
import {
  clavierCorrection, decisionBoutonCorrection, MAX_PROPOSITIONS_EN_ATTENTE, pseudoPropre, REPONSE_PROPOSITION_DEJA,
  REPONSE_PROPOSITION_TRANSMISE, texteApresDecision, texteDejaTraite, texteProposition, trouverMembreTransmis,
  type MembreTransmis, type VerbeCorrection,
} from './relais-pur'

type Client = Prisma.TransactionClient | typeof prisma

type MembreTransmisLu = MembreTransmis & { aUnCompte: boolean }

/** Les membres transmis a ce relais (episodes ou ecarts partis), avec leurs deux @. */
async function membresTransmis(db: Client, relaisId: number): Promise<MembreTransmisLu[]> {
  const fiches = await db.$queryRaw<{ membre_id: string; nom: string | null; telegram: string | null }[]>`
    with t as (
      select membre_id from public.cockpit_liveclub_relais_episodes where relais_id = ${relaisId} and envoye_le is not null
      union
      select membre_id from public.cockpit_liveclub_relais_ecarts where relais_id = ${relaisId} and envoye_le is not null
    )
    select m.membre_id::text as membre_id, m.nom, m.telegram
    from t join public.cockpit_membres m on m.membre_id = t.membre_id`
  if (fiches.length === 0) return []
  // Le compte principal : present dans le groupe d'abord, puis le plus recent.
  const comptes = await db.$queryRaw<{ membre_id: string; pseudo: string | null; nom_affiche: string | null }[]>`
    select distinct on (r.membre_id) r.membre_id::text as membre_id, tm.pseudo, tm.nom_affiche
    from public.cockpit_liveclub_rattachements r
    left join public.cockpit_telegram_membres tm on tm.telegram_id = r.telegram_id
    where r.retire_le is null and r.membre_id::text = any(${fiches.map(f => f.membre_id)}::text[])
    order by r.membre_id, tm.present desc nulls last, r.lie_le desc`
  const compteDe = new Map(comptes.map(c => [c.membre_id, c]))
  return fiches.map(f => {
    const c = compteDe.get(f.membre_id)
    return {
      membreId: f.membre_id,
      nom: f.nom,
      nomTelegram: c?.nom_affiche ?? null,
      pseudoFiche: pseudoPropre(f.telegram),
      pseudoCompte: pseudoPropre(c?.pseudo),
      aUnCompte: !!c,
    }
  })
}

/**
 * L'outil proposer_correction_pseudo { membre, pseudo }, pour un relais
 * actif. Enregistre la proposition et la transmet a l'equipe. Ne jette pas.
 * `envoyer` (defaut : vrai) : faux dans un essai, rien ne part a Telegram.
 */
export async function proposerCorrectionPseudo(
  relaisId: number, entree: unknown, db: Client = prisma, o: { envoyer?: boolean } = {},
): Promise<Record<string, unknown>> {
  const brut = (entree ?? {}) as { membre?: unknown; pseudo?: unknown }
  try {
    if (!(await estRelaisActif(relaisId, db))) return { erreur: "Tu n'es pas relais d'accueil : je ne peux rien noter sur un autre membre." }
    const pseudo = pseudoPropre(brut.pseudo)
    if (!pseudo) return { erreur: "Ce @ n'a pas le format Telegram (5 à 32 caractères, lettres, chiffres et _, commence par une lettre). Redemande-le au membre." }
    const liste = await membresTransmis(db, relaisId)
    const trouve = trouverMembreTransmis(liste, brut.membre)
    if (trouve.genre === 'aucun') return { erreur: "Ce membre n'est pas dans ta liste : je ne peux noter un @ que pour les membres qu'on t'a transmis." }
    if (trouve.genre === 'plusieurs') return { erreur: 'Plusieurs membres de ta liste correspondent : précise le nom complet.', membres_possibles: trouve.noms }
    const m = trouve.membre as MembreTransmisLu

    const [attente] = await db.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from public.cockpit_liveclub_corrections_pseudo
      where membre_id = ${m.membreId}::uuid and statut = 'proposee'`
    const inseres = (attente?.n ?? 0) >= MAX_PROPOSITIONS_EN_ATTENTE ? [] : await db.$queryRaw<{ correction_id: bigint }[]>`
      insert into public.cockpit_liveclub_corrections_pseudo (membre_id, pseudo, pseudo_fiche_avant, pseudo_compte, propose_par_telegram)
      values (${m.membreId}::uuid, ${pseudo}, ${m.pseudoFiche}, ${m.pseudoCompte}, ${relaisId})
      on conflict (membre_id, lower(pseudo)) where statut = 'proposee' do nothing
      returning correction_id`
    if (inseres.length === 0) return { resultat: REPONSE_PROPOSITION_DEJA }
    const id = Number(inseres[0].correction_id)

    if (o.envoyer !== false) {
      const [relais] = await db.$queryRaw<{ nom: string }[]>`select nom from public.cockpit_liveclub_relais where telegram_id = ${relaisId}`
      const texte = texteProposition({ relais: relais?.nom ?? 'Le relais', nom: m.nom, pseudo, pseudoFiche: m.pseudoFiche, pseudoCompte: m.pseudoCompte, aUnCompte: m.aUnCompte })
      const equipe = await db.$queryRaw<{ telegram_id: bigint }[]>`select telegram_id from public.cockpit_telegram_comptes order by cree_le`
      let livres = 0
      for (const d of equipe) {
        const chat = Number(d.telegram_id)
        if (!Number.isSafeInteger(chat) || chat <= 0) continue
        if (await tgCockpit('sendMessage', { chat_id: chat, text: texte, reply_markup: { inline_keyboard: clavierCorrection(id) } })) livres++
      }
      if (livres === 0) console.warn('[liveclub/corrections] proposition enregistree, aucun compte de l equipe ne l a recue')
    }
    console.log('[liveclub/corrections] proposition enregistree')
    return { resultat: REPONSE_PROPOSITION_TRANSMISE }
  } catch (err) {
    console.warn(`[liveclub/corrections] proposition non enregistree : ${messageErreur(err).slice(0, 160)}`)
    return { erreur: relationAbsente(err) ? "Cette fonction n'est pas encore en place." : "Souci technique, rien n'a été noté : réessaie plus tard." }
  }
}

type IssueDecision =
  | { genre: 'deja' | 'introuvable'; statut: string | null }
  | { genre: VerbeCorrection; texte: string }

/**
 * La decision dans UNE transaction, la ligne verrouillee : deux clics
 * simultanes (ou Brice et Melanie en meme temps) ne decident qu'une fois.
 * Exportee pour l'essai de migration (transaction annulee).
 */
export async function deciderCorrection(
  tx: Prisma.TransactionClient, id: number, verbe: VerbeCorrection, compte: { telegramId: number; userId: string | null; libelle: string | null },
): Promise<IssueDecision> {
  const [l] = await tx.$queryRaw<{ membre_id: string; pseudo: string; statut: string; pseudo_fiche_avant: string | null; nom: string | null }[]>`
    select c.membre_id::text as membre_id, c.pseudo, c.statut, c.pseudo_fiche_avant, m.nom
    from public.cockpit_liveclub_corrections_pseudo c
    join public.cockpit_membres m on m.membre_id = c.membre_id
    where c.correction_id = ${id}
    for update of c`
  const d = decisionBoutonCorrection(l?.statut, verbe)
  if (d === 'introuvable' || d === 'deja' || !l) return { genre: d === 'deja' ? 'deja' : 'introuvable', statut: l?.statut ?? null }
  const userId = compte.userId && /^[0-9a-f-]{36}$/i.test(compte.userId) ? compte.userId : null
  if (d === 'valider') {
    await tx.$executeRaw`
      update public.cockpit_liveclub_corrections_pseudo set statut = 'remplacee', decide_le = coalesce(decide_le, now())
      where membre_id = ${l.membre_id}::uuid and statut = 'validee' and correction_id <> ${id}`
    await tx.$executeRaw`
      update public.cockpit_liveclub_corrections_pseudo
      set statut = 'validee', decide_le = now(), decide_par = ${userId}::uuid, decide_par_telegram = ${compte.telegramId}
      where correction_id = ${id}`
    // Le trigger reimpose de toute facon la correction validee : cet update la pose tout de suite.
    await tx.$executeRaw`
      update public.cockpit_membres set telegram = ${`@${l.pseudo}`}, updated_at = now() where membre_id = ${l.membre_id}::uuid`
  } else {
    await tx.$executeRaw`
      update public.cockpit_liveclub_corrections_pseudo
      set statut = 'refusee', decide_le = now(), decide_par = ${userId}::uuid, decide_par_telegram = ${compte.telegramId}
      where correction_id = ${id}`
  }
  // Le @ du compte rattache, relu maintenant (il a pu changer depuis la proposition).
  const [c] = await tx.$queryRaw<{ pseudo: string | null }[]>`
    select tm.pseudo from public.cockpit_liveclub_rattachements r
    left join public.cockpit_telegram_membres tm on tm.telegram_id = r.telegram_id
    where r.retire_le is null and r.membre_id = ${l.membre_id}::uuid
    order by tm.present desc nulls last, r.lie_le desc limit 1`
  return {
    genre: d,
    texte: texteApresDecision({
      verbe: d, par: compte.libelle, nom: l.nom, pseudo: l.pseudo, pseudoFicheAvant: l.pseudo_fiche_avant, pseudoCompte: pseudoPropre(c?.pseudo),
    }),
  }
}

/**
 * Un clic Valider ou Refuser sous une proposition, dans Agent AOK. Appele
 * par traiterClicAgentTelegram APRES le verrou du compte de l'equipe.
 * Toujours answerCallbackQuery. Ne jette pas.
 */
export async function traiterBoutonCorrection(
  cq: ClicAgentTelegram, chatId: number, telegramId: number, compte: CompteCockpitTelegram, bouton: { id: number; verbe: VerbeCorrection },
): Promise<void> {
  let issue: IssueDecision
  try {
    issue = await prisma.$transaction(tx => deciderCorrection(tx, bouton.id, bouton.verbe, { telegramId, userId: compte.user_id, libelle: compte.libelle }))
  } catch (err) {
    console.warn(`[liveclub/corrections] clic non traite : ${messageErreur(err).slice(0, 160)}`)
    await tgCockpit('answerCallbackQuery', { callback_query_id: cq.id, text: "Souci technique, rien n'a été fait. Réessaie dans un moment." })
    return
  }
  const messageId = Number(cq.message?.message_id)
  const retirerBoutons = () => Number.isSafeInteger(messageId) && messageId > 0
    ? tgCockpit('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
    : Promise.resolve(false)
  if (!('texte' in issue)) {
    await tgCockpit('answerCallbackQuery', { callback_query_id: cq.id, text: texteDejaTraite(issue.statut) })
    await retirerBoutons()
    return
  }
  console.log(`[liveclub/corrections] proposition ${issue.genre === 'valider' ? 'validee' : 'refusee'}`)
  await tgCockpit('answerCallbackQuery', { callback_query_id: cq.id })
  await retirerBoutons()
  await tgCockpit('sendMessage', { chat_id: chatId, text: issue.texte })
}
