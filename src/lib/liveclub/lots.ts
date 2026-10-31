// Le SUIVI DES LOTS, cote serveur (31/10, regles et textes dans lots-pur.ts,
// lectures dans lots-lecture.ts) :
// - declarerLots : le membre dit « c'est bon, j'ai trade mes lots » (outil
//   lots_trades de l'agent des membres, ou bouton BOUTON_LOTS). Une
//   declaration au journal ('acces_broker', regle lots_declares, UNE seule
//   ouverte par depot, verrou), puis une carte a chaque compte de l'equipe
//   (Agent AOK, comme l'alerte « un membre demande un humain ») avec « Oui,
//   lots tradés » / « Non, pas encore ». Au membre, une ligne : l'equipe
//   verifie chez le broker. Aucune carte livree : la declaration passe en
//   'echec' (il peut redire) et le membre l'apprend.
// - traiterBoutonLots : le clic de l'equipe, apres le verrou du compte (Agent
//   AOK). Une seule decision par declaration (ligne verrouillee : Brice et Mel
//   en meme temps ne decident qu'une fois). Oui = la MEME ecriture que la
//   carte proposer_marquer_commission, etat lots_faits (validerAction puis
//   executerActionRepartition : la commission est prevue a la fin du mois des
//   lots, moisPrevuCommission), puis le membre prevenu, et s'il est hors du
//   groupe (acces en pause), son lien de retour tout de suite. Non = le membre
//   prevenu que l'equipe ne les voit pas encore.
// - retourApresLots : le lien de retour apres des lots notes faits, une fois
//   par depot (reserve), aussi appele par le filet du passage quotidien.
//
// Securite (grille de Brice, 29/10) : le membre n'agit que sur SON acces
// (identite = son telegram_id) ; il ne peut rien ecrire d'autre qu'une
// declaration ; toute ecriture de l'equipe passe par le clic de la carte.
// Le nom Telegram (choisi par le membre) entre dans la carte rendu visible.
// Jamais de nom, d'email ni d'identifiant dans un log : des comptes seulement.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  ajouterAHistoriqueAgent, tgCockpit, type ClicAgentTelegram, type CompteCockpitTelegram,
} from '@/lib/agent-cockpit-telegram'
import { nomTelegram } from '@/lib/alerte-equipe-telegram'
import { RefusAction, journaliserGesteLiveClub, validerAction } from '@/lib/stripe-actions'
import { executerActionRepartition } from '@/lib/repartition/serveur'
import { centimes, euros } from '@/lib/repartition/pur'
import { rendreVisible } from '@/lib/securite/injection-pur'
import { chatId, fermetureDepotPerduActive, suiviLotsActif } from './config'
import { droitLiveClub } from './droits'
import { rattachementActif } from './rattacher'
import { appelTelegram, envoyer, estDansLeGroupe, lienDemandeAdhesion, type Bouton } from './telegram'
import { tracerGeste, tracerMessageBot } from './support-pont'
import { accesDeCommission, lotsDejaFaits, suivisLotsDuCompte, type LigneDepotPerdu, type LigneSuiviLots } from './lots-lecture'
import {
  BOUTON_LOTS, MARQUEUR_ALERTE_DEPOT, MARQUEUR_CARTE_LOTS, PHRASE_CARTE_PERTE_FERME,
  TEXTE_DEPOT_REGULARISE_RETOUR, TEXTE_DEPOT_REGULARISE_SANS_LIEN,
  TEXTE_LOTS_CONFIRMES, TEXTE_LOTS_CONFIRMES_RETOUR, TEXTE_LOTS_CONFIRMES_SANS_LIEN,
  clavierCarteLots, decisionDeclarationLots, etatLots, lotsEnRetard, phraseApresRegularisation, texteAlerteDepotPerdu,
  texteCarteLots, texteDeclarationLots, texteLotsDejaDecides, texteLotsPasVus,
  type EtatLots, type IssueDeclarationLots, type IssueFermetureDepot, type VerbeLots,
} from './lots-pur'
import { jourParis } from './passage-regles'
import { messageErreur, relationAbsente } from './pur'

const BOUTON_RETOUR = 'Revenir dans le groupe'

/** L'email du rattachement (pour retrouver un acces broker pose a cet email). null sur panne ou sans rattachement. */
async function emailRattache(telegramId: number): Promise<string | null> {
  try {
    return (await rattachementActif(telegramId))?.email ?? null
  } catch {
    return null
  }
}

/** Le suivi en cours de ce membre (son acces broker dont les lots sont attendus), ou null. Jette sur une panne. */
async function suiviDuMembre(telegramId: number): Promise<{ ligne: LigneSuiviLots | null; email: string | null }> {
  const email = await emailRattache(telegramId)
  const lignes = await suivisLotsDuCompte(telegramId, email)
  // L'acces porte par ce compte d'abord, puis celui de son email.
  const ligne = lignes.find(l => l.telegramId === telegramId) ?? lignes[0] ?? null
  return { ligne, email }
}

/**
 * (31/10) Pour l'agent des membres : ses lots sont-ils attendus, et ou en
 * est-il ? null = rien a suivre (pas d'acces broker avec depot, lots faits,
 * suivi coupe, ou lecture ratee). Ne jette jamais.
 */
export async function etatLotsDuMembre(telegramId: number, maintenant: Date = new Date()): Promise<EtatLots | null> {
  if (!suiviLotsActif()) return null
  try {
    const { ligne } = await suiviDuMembre(telegramId)
    return ligne ? etatLots(ligne.suivi, jourParis(maintenant.toISOString())) : null
  } catch (err) {
    console.warn(`[liveclub/lots] etat des lots illisible : ${relationAbsente(err) ? 'table absente' : messageErreur(err).slice(0, 160)}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// La declaration du membre
// ---------------------------------------------------------------------------

export type DeclarationLots = { issue: IssueDeclarationLots; texte: string }

/**
 * Le membre dit avoir trade ses lots. L'etat est relu ICI, juste avant :
 * rien a verifier, lots deja notes, declaration deja en cours, ou une
 * nouvelle (reservee sous verrou, puis la carte a l'equipe). Ne jette pas.
 */
export async function declarerLots(telegramId: number, o: { origine: 'agent' | 'bouton' }, maintenant: Date = new Date()): Promise<DeclarationLots> {
  const rendre = (issue: IssueDeclarationLots, enPause = false): DeclarationLots => ({ issue, texte: texteDeclarationLots(issue, { enPause }) })
  if (!suiviLotsActif()) return rendre('rien')
  const aujourdhui = jourParis(maintenant.toISOString())
  let ligne: LigneSuiviLots | null
  let email: string | null
  try {
    ({ ligne, email } = await suiviDuMembre(telegramId))
    if (!ligne) {
      const faits = await lotsDejaFaits(telegramId, email)
      return rendre(decisionDeclarationLots({ enAttente: false, dejaFaits: faits, declarationEnCours: false }))
    }
  } catch (err) {
    console.warn(`[liveclub/lots] declaration illisible : ${messageErreur(err).slice(0, 160)}`)
    return rendre('panne')
  }
  const enPause = lotsEnRetard(ligne.suivi, aujourdhui)
  if (ligne.declarationId !== null) return rendre('deja_declare', enPause)

  let id: number | null
  try {
    id = await reserverDeclaration(ligne, telegramId, { origine: o.origine, lotsLe: aujourdhui, enPause })
  } catch (err) {
    console.warn(`[liveclub/lots] declaration non reservee : ${messageErreur(err).slice(0, 160)}`)
    return rendre('panne')
  }
  if (id === null) return rendre('deja_declare', enPause)

  const livres = await envoyerCarteLots(id, ligne, telegramId, { enPause, lotsLe: aujourdhui })
  if (livres === 0) {
    // Personne ne l'a recue : la declaration ne compte pas (il peut redire), et il le sait.
    await prisma.$executeRaw`
      update public.cockpit_liveclub_gestes set resultat = 'echec' where geste_id = ${id}`
      .catch(err => console.warn(`[liveclub/lots] declaration non fermee : ${messageErreur(err).slice(0, 160)}`))
    console.warn('[liveclub/lots] declaration enregistree, aucun compte de l equipe ne l a recue')
    return rendre('panne')
  }
  await tracerGeste(telegramId, {
    geste: 'acces_broker', resultat: 'fait', regle: 'lots_declares',
    details: { acces_id: ligne.accesId, commission_id: ligne.commissionId },
  })
  console.log(`[liveclub/lots] lots declares (${o.origine}), carte livree a ${livres} compte(s)`)
  return rendre('declare', enPause)
}

/**
 * Reserve la declaration sous verrou (une seule ouverte par depot : sans
 * decision de l'equipe apres elle). null = une autre est deja ouverte.
 */
async function reserverDeclaration(
  ligne: LigneSuiviLots, telegramId: number, d: { origine: string; lotsLe: string; enPause: boolean },
): Promise<number | null> {
  const details = { acces_id: ligne.accesId, commission_id: ligne.commissionId, lots_le: d.lotsLe, origine: d.origine, en_pause: d.enPause }
  const lignes = await prisma.$transaction(async tx => {
    await tx.$queryRaw`
      select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`liveclub:lots_declares:${ligne.commissionId}`}::text, 0))) as verrou`
    return tx.$queryRaw<{ geste_id: bigint }[]>`
      insert into public.cockpit_liveclub_gestes (telegram_id, geste, resultat, acteur, regle, details)
      select ${telegramId}::bigint, 'acces_broker', 'fait', 'bot:membre', 'lots_declares', ${JSON.stringify(details)}::jsonb
      where not exists (
        select 1 from public.cockpit_liveclub_gestes d
        where d.geste = 'acces_broker' and d.regle = 'lots_declares' and d.resultat = 'fait'
          and d.details->>'commission_id' = ${ligne.commissionId}::text
          and not exists (
            select 1 from public.cockpit_liveclub_gestes e
            where e.geste = 'acces_broker' and e.regle in ('lots_confirmes', 'lots_pas_vus') and e.resultat = 'fait'
              and e.details->>'declaration' = d.geste_id::text))
      returning geste_id`
  })
  return lignes[0] ? Number(lignes[0].geste_id) : null
}

/** La carte a chaque compte de l'equipe (Agent AOK), et dans son historique. Le nombre de comptes qui l'ont recue. */
async function envoyerCarteLots(
  id: number, ligne: LigneSuiviLots, telegramId: number, o: { enPause: boolean; lotsLe: string },
): Promise<number> {
  try {
    const nom = ligne.client ?? (await nomTelegram(telegramId))
    const texte = texteCarteLots({
      qui: rendreVisible(nom ?? ligne.email),
      email: ligne.email,
      partenaire: ligne.partenaire,
      depot: ligne.montantBase === null ? null : euros(centimes(ligne.montantBase) ?? 0),
      depotLe: ligne.depotLe,
      commission: euros(centimes(ligne.commissionAttendue) ?? 0),
      enPause: o.enPause,
      lotsLe: o.lotsLe,
    })
    const equipe = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`
    let livres = 0
    for (const dest of equipe) {
      const chat = Number(dest.telegram_id)
      if (!Number.isSafeInteger(chat) || chat <= 0) continue
      if (!await tgCockpit('sendMessage', { chat_id: chat, text: texte, reply_markup: { inline_keyboard: clavierCarteLots(id) } })) continue
      livres++
      await ajouterAHistoriqueAgent(chat, chat, [
        { role: 'user', content: MARQUEUR_CARTE_LOTS, id: `lots-${id}` },
        { role: 'assistant', content: texte, id: `lots-${id}-texte` },
      ]).catch(() => false)
    }
    return livres
  } catch (err) {
    console.warn(`[liveclub/lots] carte non envoyee : ${messageErreur(err).slice(0, 160)}`)
    return 0
  }
}

// ---------------------------------------------------------------------------
// La decision de l'equipe (clic dans Agent AOK)
// ---------------------------------------------------------------------------

type Decision =
  | { genre: 'introuvable' | 'deja'; regle: string | null; par: string | null }
  | {
    genre: VerbeLots; declaration: number; decisionId: number; membre: number | null
    commissionId: string; accesId: string | null; lotsLe: string
  }

/**
 * La decision dans UNE transaction, la declaration verrouillee : deux clics
 * simultanes ne decident qu'une fois. Exportee pour un essai (transaction
 * annulee).
 */
export async function deciderLots(
  tx: Prisma.TransactionClient, id: number, verbe: VerbeLots, compte: { userId: string; libelle: string | null },
): Promise<Decision> {
  const [d] = await tx.$queryRaw<{ telegram_id: bigint | null; details: Record<string, unknown> | null; fait_le: Date }[]>`
    select telegram_id, details, fait_le from public.cockpit_liveclub_gestes
    where geste_id = ${id} and geste = 'acces_broker' and regle = 'lots_declares' and resultat = 'fait'
    for update`
  if (!d) return { genre: 'introuvable', regle: null, par: null }
  const [deja] = await tx.$queryRaw<{ regle: string; par: string | null }[]>`
    select regle, details->>'par' as par from public.cockpit_liveclub_gestes
    where geste = 'acces_broker' and regle in ('lots_confirmes', 'lots_pas_vus') and resultat = 'fait'
      and details->>'declaration' = ${String(id)}
    limit 1`
  if (deja) return { genre: 'deja', regle: deja.regle, par: deja.par }
  const details = d.details ?? {}
  const commissionId = typeof details.commission_id === 'string' ? details.commission_id : ''
  const accesId = typeof details.acces_id === 'string' ? details.acces_id : null
  const lotsLe = typeof details.lots_le === 'string' ? details.lots_le : jourParis(d.fait_le.toISOString())
  const par = compte.libelle?.trim().slice(0, 60) || null
  const [ligne] = await tx.$queryRaw<{ geste_id: bigint }[]>`
    insert into public.cockpit_liveclub_gestes (telegram_id, geste, resultat, acteur, regle, details)
    values (${d.telegram_id}, 'acces_broker', 'fait', ${`agent:${compte.userId}`}, ${verbe === 'oui' ? 'lots_confirmes' : 'lots_pas_vus'},
            ${JSON.stringify({ declaration: String(id), commission_id: commissionId, acces_id: accesId, lots_le: lotsLe, par })}::jsonb)
    returning geste_id`
  return {
    genre: verbe, declaration: id, decisionId: Number(ligne.geste_id),
    membre: d.telegram_id === null ? null : Number(d.telegram_id), commissionId, accesId, lotsLe,
  }
}

/**
 * Un clic « Oui, lots tradés » / « Non, pas encore » sous une carte, dans
 * Agent AOK. Appele par traiterClicAgentTelegram APRES le verrou du compte
 * de l'equipe. Toujours answerCallbackQuery. Ne jette pas.
 */
export async function traiterBoutonLots(
  cq: ClicAgentTelegram, chatIdEquipe: number, telegramIdEquipe: number, compte: CompteCockpitTelegram,
  bouton: { id: number; verbe: VerbeLots },
): Promise<void> {
  const acquitter = (texte?: string) => tgCockpit('answerCallbackQuery', { callback_query_id: cq.id, ...(texte ? { text: texte } : {}) })
  const messageId = Number(cq.message?.message_id)
  const retirerBoutons = () => Number.isSafeInteger(messageId) && messageId > 0
    ? tgCockpit('editMessageReplyMarkup', { chat_id: chatIdEquipe, message_id: messageId, reply_markup: { inline_keyboard: [] } })
    : Promise.resolve(false)

  let d: Decision
  try {
    d = await prisma.$transaction(tx => deciderLots(tx, bouton.id, bouton.verbe, { userId: compte.user_id, libelle: compte.libelle }))
  } catch (err) {
    console.warn(`[liveclub/lots] clic non traite : ${messageErreur(err).slice(0, 160)}`)
    await acquitter("Souci technique, rien n'a été fait. Réessaie dans un moment.")
    return
  }
  if (d.genre === 'introuvable' || d.genre === 'deja') {
    await acquitter(texteLotsDejaDecides(d.regle, d.par))
    await retirerBoutons()
    return
  }
  const prise = d as Extract<Decision, { declaration: number }>
  await acquitter()

  const texte = prise.genre === 'oui' ? await apresOui(prise, compte) : await apresNon(prise)
  if (texte.ok) {
    await retirerBoutons()
    // Au fil Support du membre : la decision de l'equipe, en une ligne (phraseGeste).
    await tracerGeste(prise.membre, {
      geste: 'acces_broker', resultat: 'fait', regle: prise.genre === 'oui' ? 'lots_confirmes' : 'lots_pas_vus',
      details: { commission_id: prise.commissionId },
    })
  }
  console.log(`[liveclub/lots] decision ${prise.genre}${texte.ok ? '' : ' en echec'}`)
  await tgCockpit('sendMessage', { chat_id: chatIdEquipe, text: texte.texte })
  await ajouterAHistoriqueAgent(chatIdEquipe, telegramIdEquipe, [
    { role: 'assistant', content: texte.texte, id: `lots-${prise.declaration}-decision-${prise.decisionId}` },
  ]).catch(() => false)
}

/** La decision n'a pas abouti : elle ne compte pas, la carte (et celle de l'autre) peut resservir. */
async function annulerDecision(decisionId: number): Promise<void> {
  await prisma.$executeRaw`
    update public.cockpit_liveclub_gestes set resultat = 'echec' where geste_id = ${decisionId}`
    .catch(err => console.warn(`[liveclub/lots] decision non annulee : ${messageErreur(err).slice(0, 160)}`))
}

async function apresOui(d: Extract<Decision, { genre: VerbeLots }>, compte: CompteCockpitTelegram): Promise<{ ok: boolean; texte: string }> {
  // (31/10) Une commission marquee PERDUE depuis la declaration : « lots
  // tradés » ne la regularise pas (ce clic ne passe pas par la carte de
  // regularisation) et ne dit rien au membre : son acces reste ferme. La
  // decision ne compte pas, la carte reste valable.
  try {
    const [c] = await prisma.$queryRaw<{ statut: string }[]>`
      select statut from public.cockpit_commissions where commission_id = ${d.commissionId}::uuid`
    if (c?.statut === 'perdue') {
      await annulerDecision(d.decisionId)
      return {
        ok: false,
        texte: "Sa commission est marquée perdue : rien n'a été noté et je ne l'ai pas prévenu (son accès broker est fermé). "
          + "S'il a régularisé, dis-le-moi : je remets sa commission en attendue ou en lots faits.",
      }
    }
  } catch (err) {
    await annulerDecision(d.decisionId)
    return { ok: false, texte: `Rien n'a été noté (${messageErreur(err).slice(0, 200)}). Réessaie dans un instant : la carte reste valable.` }
  }
  // La MEME ecriture que la carte proposer_marquer_commission (etat lots_faits).
  const action = validerAction({
    type: 'marquer_commission', compte: 'cockpit',
    params: { commission_id: d.commissionId, etat: 'lots_faits', le: d.lotsLe },
  })
  if (typeof action === 'string') {
    await annulerDecision(d.decisionId)
    return { ok: false, texte: `Rien n'a été noté : ${action}` }
  }
  let resultat: string
  try {
    resultat = await executerActionRepartition(action, `agent:${compte.user_id}`)
  } catch (err) {
    if (!(err instanceof RefusAction)) {
      await annulerDecision(d.decisionId)
      return { ok: false, texte: `Rien n'a été noté (${messageErreur(err).slice(0, 200)}). Réessaie dans un instant : la carte reste valable.` }
    }
    // Plus attendue (deja recue ; perdue est traitee plus haut) : rien a marquer, ses lots sont bien vus.
    resultat = err.message
  }
  if (d.membre === null) return { ok: true, texte: `${resultat}\nJe n'ai pas pu le prévenir : compte Telegram inconnu.` }
  return { ok: true, texte: `${resultat}\n${await prevenirLotsVus(d.membre, d.commissionId, `agent:${compte.user_id}`)}` }
}

async function apresNon(d: Extract<Decision, { genre: VerbeLots }>): Promise<{ ok: boolean; texte: string }> {
  if (d.membre === null) return { ok: true, texte: "Noté : lots pas encore vus. Je n'ai pas pu le prévenir : compte Telegram inconnu." }
  const parti = await direAuMembre(d.membre, texteLotsPasVus(), [[{ texte: BOUTON_LOTS.texte, data: BOUTON_LOTS.data }]])
  return {
    ok: true,
    texte: parti
      ? "Noté : je lui ai dit que tu ne vois pas encore ses lots. Il peut le redire quand c'est fait."
      : "Noté : lots pas encore vus. Je n'ai pas pu le prévenir en privé (bot bloqué ou jamais ouvert).",
  }
}

/** Un message prive du bot des membres, trace au fil Support. true = parti. */
async function direAuMembre(telegramId: number, texte: string, boutons?: Bouton[][]): Promise<boolean> {
  const r = await envoyer(telegramId, texte, boutons)
  await tracerMessageBot(telegramId, texte, { boutons, livre: r.ok })
  return r.ok
}

/** Apres le « Oui » : le membre prevenu, et son lien de retour s'il est hors du groupe. La phrase pour l'equipe. */
async function prevenirLotsVus(telegramId: number, commissionId: string, acteur: string): Promise<string> {
  const presence = await estDansLeGroupe(telegramId)
  if (presence === 'non') {
    const droit = await droitLiveClub(telegramId)
    if (droit.statut === 'oui') {
      const r = await retourApresLots(telegramId, { commissionId, acteur })
      if (r === 'envoye') return 'Je l\'ai prévenu, et je lui ai redonné son lien vers le groupe.'
      if (r === 'deja') return 'Son lien de retour vers le groupe était déjà parti.'
    }
    const parti = await direAuMembre(telegramId, TEXTE_LOTS_CONFIRMES_SANS_LIEN)
    return parti ? "Je l'ai prévenu ; il aura son lien vers le groupe avec /menu." : "Je n'ai pas pu le prévenir en privé (bot bloqué ou jamais ouvert)."
  }
  const parti = await direAuMembre(telegramId, TEXTE_LOTS_CONFIRMES)
  return parti ? "Je l'ai prévenu." : "Je n'ai pas pu le prévenir en privé (bot bloqué ou jamais ouvert)."
}

/**
 * Le lien de retour apres des lots notes faits (acces broker qui etait en
 * pause), UNE fois par depot : reserve sous verrou (geste 'invitation', regle
 * retour_lots), ban leve s'il y en a un (only_if_banned : nous ne bannissons
 * pas, Metricgram a pu), puis un lien de demande d'adhesion en prive.
 * 'deja' : deja envoye (ou deja revenu) ; 'echec' : rien n'est parti, la
 * reservation est rendue (le passage du lendemain reessaie). Ne jette pas.
 */
export function retourApresLots(telegramId: number, o: { commissionId: string; acteur: string }): Promise<'envoye' | 'deja' | 'echec'> {
  return retourAuGroupe(telegramId, { ...o, regle: 'retour_lots', texte: TEXTE_LOTS_CONFIRMES_RETOUR })
}

/**
 * (31/10) Le meme lien de retour apres la REGULARISATION d'un depot perdu
 * (acces broker qui etait ferme), une fois par commission (regle retour_depot).
 */
export function retourApresRegularisation(telegramId: number, o: { commissionId: string; acteur: string }): Promise<'envoye' | 'deja' | 'echec'> {
  return retourAuGroupe(telegramId, { ...o, regle: 'retour_depot', texte: TEXTE_DEPOT_REGULARISE_RETOUR })
}

/** Le lien de retour, une fois par commission et par regle (retourApresLots, retourApresRegularisation). */
async function retourAuGroupe(
  telegramId: number, o: { commissionId: string; acteur: string; regle: 'retour_lots' | 'retour_depot'; texte: string },
): Promise<'envoye' | 'deja' | 'echec'> {
  let reserve: bigint | null
  try {
    const lignes = await prisma.$transaction(async tx => {
      await tx.$queryRaw`
        select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`liveclub:${o.regle}:${o.commissionId}`}::text, 0))) as verrou`
      return tx.$queryRaw<{ geste_id: bigint }[]>`
        insert into public.cockpit_liveclub_gestes (telegram_id, geste, resultat, acteur, regle, details)
        select ${telegramId}::bigint, 'invitation', 'fait', ${o.acteur}, ${o.regle}, ${JSON.stringify({ commission_id: o.commissionId })}::jsonb
        where not exists (
          select 1 from public.cockpit_liveclub_gestes r
          where r.geste = 'invitation' and r.regle = ${o.regle} and r.resultat in ('fait', 'refuse')
            and r.details->>'commission_id' = ${o.commissionId}::text)
        returning geste_id`
    })
    reserve = lignes[0]?.geste_id ?? null
  } catch (err) {
    console.warn(`[liveclub/lots] retour non reserve : ${messageErreur(err).slice(0, 160)}`)
    return 'echec'
  }
  if (reserve === null) return 'deja'

  const rendre = async () => {
    await prisma.$executeRaw`update public.cockpit_liveclub_gestes set resultat = 'echec' where geste_id = ${reserve}`
      .catch(err => console.warn(`[liveclub/lots] reservation de retour non rendue : ${messageErreur(err).slice(0, 160)}`))
    return 'echec' as const
  }
  const groupe = chatId()
  if (!groupe) return rendre()
  const leve = await appelTelegram('unbanChatMember', { chat_id: groupe, user_id: telegramId, only_if_banned: true })
  if (!leve.ok) return rendre()
  let lien: string
  try {
    lien = await lienDemandeAdhesion(`${o.regle === 'retour_lots' ? 'retour lots' : 'retour depot'} u${telegramId}`)
  } catch {
    return rendre()
  }
  const boutons: Bouton[][] = [[{ texte: BOUTON_RETOUR, url: lien }]]
  const r = await envoyer(telegramId, o.texte, boutons)
  if (!r.ok) return rendre()
  // Au fil Support : le texte et le libelle du bouton, jamais le lien.
  await tracerMessageBot(telegramId, o.texte, { boutons })
  await tracerGeste(telegramId, { geste: 'invitation', resultat: 'fait', regle: o.regle, details: { commission_id: o.commissionId } })
  return 'envoye'
}

/**
 * Pour le passage quotidien : le retour est inutile (deja dans le groupe).
 * La boucle se ferme une fois ('invitation' 'refuse' retour_lots, ou
 * retour_depot pour une regularisation). Ne jette pas.
 */
export async function fermerRetourLots(
  telegramId: number, commissionId: string, acteur: string, regle: 'retour_lots' | 'retour_depot' = 'retour_lots',
): Promise<void> {
  await journaliserGesteLiveClub(
    { geste: 'invitation', resultat: 'refuse', regle, details: { commission_id: commissionId, motif: 'deja_dans_le_groupe' } },
    { telegramId, acteur },
  )
}

// ---------------------------------------------------------------------------
// (31/10) LE DEPOT PERDU (lots-pur.ts) : « pas de commission, pas d'acces »
// ---------------------------------------------------------------------------

/**
 * L'alerte a Brice et Melanie dans Agent AOK (comptes de
 * cockpit_telegram_comptes, comme l'alerte « un membre demande un humain » et
 * celle des comptes Telegram), ajoutee a l'historique de leur conversation
 * avec l'agent (« il a regularise » juste en dessous s'y rapporte). Le nombre
 * de comptes qui l'ont recue. Ne jette pas.
 */
export async function alerterEquipeDepotPerdu(texte: string, id: string): Promise<number> {
  try {
    const equipe = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`
    let livres = 0
    for (const dest of equipe) {
      const chat = Number(dest.telegram_id)
      if (!Number.isSafeInteger(chat) || chat <= 0) continue
      if (!await tgCockpit('sendMessage', { chat_id: chat, text: texte.slice(0, 4000), link_preview_options: { is_disabled: true } })) continue
      livres++
      await ajouterAHistoriqueAgent(chat, chat, [
        { role: 'user', content: MARQUEUR_ALERTE_DEPOT, id },
        { role: 'assistant', content: texte, id: `${id}-texte` },
      ]).catch(() => false)
    }
    console.log(`[liveclub/lots] alerte depot perdu : ${livres}/${equipe.length} destinataire(s)`)
    return livres
  } catch (err) {
    console.warn(`[liveclub/lots] alerte depot perdu non envoyee : ${messageErreur(err).slice(0, 160)}`)
    return 0
  }
}

/** Le texte de l'alerte pour un acces ferme (nom et montant mis en forme ici). Ne jette pas. */
export async function texteAlerteDepot(
  l: LigneDepotPerdu, o: { issue: IssueFermetureDepot; message: 'prive' | 'email' | null },
): Promise<string> {
  const nom = l.client ?? (l.telegramId !== null ? await nomTelegram(l.telegramId).catch(() => null) : null)
  return texteAlerteDepotPerdu({
    qui: rendreVisible(nom ?? l.email),
    email: l.email,
    partenaire: l.partenaire,
    depot: l.montantBase === null ? null : euros(centimes(l.montantBase) ?? 0),
    depotLe: l.depotLe,
    issue: o.issue,
    message: o.message,
  })
}

/**
 * (31/10) Apres le clic d'une carte proposer_marquer_commission
 * (executerActionRepartition), la ligne du resultat qui dit ce que devient
 * l'acces broker. Appelee par import dynamique (repartition/serveur.ts est
 * importe par ce module). Ne jette pas ; null = rien a dire (pas d'acces
 * broker, regle coupee).
 * - 'perdue' : l'acces se ferme (le passage du matin le sort et ecrit) ;
 * - 'regularisee' : l'acces rouvre ; s'il avait ete prevenu de la fermeture
 *   et qu'il est hors du groupe, son lien de retour part TOUT DE SUITE (le
 *   passage du lendemain sert de filet), comme apres le « Oui » des lots.
 */
export async function apresMarquageDepot(commissionId: string, etat: 'perdue' | 'regularisee', acteur: string): Promise<string | null> {
  if (!fermetureDepotPerduActive()) return null
  let acces: Awaited<ReturnType<typeof accesDeCommission>>
  try {
    acces = await accesDeCommission(commissionId)
  } catch (err) {
    console.warn(`[liveclub/lots] acces de la commission illisible : ${messageErreur(err).slice(0, 160)}`)
    return etat === 'perdue' ? null : phraseApresRegularisation('panne')
  }
  if (!acces) return null
  if (etat === 'perdue') {
    return acces.ferme ? PHRASE_CARTE_PERTE_FERME : "Son accès broker reste ouvert : un autre dépôt de son accès est encore attendu ou reçu."
  }
  if (acces.ferme) return phraseApresRegularisation('encore_ferme')
  const tid = acces.telegramId
  if (tid === null) return phraseApresRegularisation('pas_prevenu')
  let prevenu: boolean
  try {
    const lignes = await prisma.$queryRaw<{ n: number }[]>`
      select 1 as n from public.cockpit_liveclub_gestes
      where telegram_id = ${tid}::bigint and resultat = 'fait'
        and ((geste = 'retrait' and regle = 'depot_perdu') or (geste = 'rappel' and regle = 'depot_perdu_message'))
        and details->>'commission_id' = ${commissionId}::text
      limit 1`
    prevenu = lignes.length > 0
  } catch {
    return phraseApresRegularisation('panne')
  }
  if (!prevenu) return phraseApresRegularisation('pas_prevenu')
  const presence = await estDansLeGroupe(tid)
  if (presence === 'oui') {
    await fermerRetourLots(tid, commissionId, acteur, 'retour_depot')
    return phraseApresRegularisation('dans_le_groupe')
  }
  if (presence !== 'non') return phraseApresRegularisation('sans_lien')
  const droit = await droitLiveClub(tid)
  if (droit.statut === 'non' && droit.lots?.etat === 'en_retard') return phraseApresRegularisation('en_pause_lots')
  if (droit.statut !== 'oui') return phraseApresRegularisation('sans_lien')
  const r = await retourApresRegularisation(tid, { commissionId, acteur })
  if (r === 'envoye') return phraseApresRegularisation('lien')
  if (r === 'deja') return phraseApresRegularisation('lien_deja')
  const parti = await direAuMembre(tid, TEXTE_DEPOT_REGULARISE_SANS_LIEN)
  return parti ? "Son accès broker au Live Club est rouvert : je l'ai prévenu, il aura son lien vers le groupe avec /menu." : phraseApresRegularisation('sans_lien')
}
