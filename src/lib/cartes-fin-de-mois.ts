// LES CARTES DE FIN DE MOIS (05/11/2026, GO de Brice) : au debut du mois
// suivant, le passage du matin propose de lui-meme a Brice et Melanie, dans
// Agent AOK, des cartes PRE-REMPLIES pour declarer en depense du Live Club :
// - les commissions de parrainage du mois (liveclub/parrainage.ts,
//   carteDeclaration) : « Commissions de parrainage d'octobre : Alex 19,80 €
//   (Thomas), Fab 19,80 € (Lucie) = 39,60 €. Déclarer en dépense du Live
//   Club ? » ; une declaration qui ne correspond plus (filleul ajoute ou
//   rembourse apres coup) donne la carte qui la remplace ;
// - les lives de chaque intervenant qui a un compte Telegram dans
//   cockpit_intervenants (repartition/lives-reperes-pur.ts) : « Lives d'Adrien
//   en octobre : 3 repérés (14, 21, 22/10), 3 x 75 € = 225 €. Déclarer en
//   dépense du Live Club ? ». Le clic suit le chemin de la carte des lives du
//   mois (une seule declaration vivante par intervenant, produit et mois).
//   Deja declares : pas de carte.
// RIEN ne s'ecrit sans le clic. Une carte par etat (memoire cockpit_cartes_auto,
// migration 20261105190000) : elle n'est pas reproposee chaque matin. Une
// conversation qui a deja une carte en attente n'est jamais ecrasee : le texte
// part seul, avec « redemande-la-moi ». Personne n'a rien recu : la memoire est
// liberee, le passage suivant reessaie. Table absente : rien, sans erreur.
//
// Aussi ici : les jours reperes des lives (le resume du dimanche les lit).

import { prisma } from '@/lib/db'
import { validerAction, type ActionAgent } from '@/lib/stripe-actions'
import { estMelanie, sansNomsOutils } from '@/lib/agent-cockpit-pur'
import { OFFRE_LIVE_CLUB, TYPE_DECLARATION_PARRAINAGE, carteDeclaration, cleCarteDeclaration, deNom, jourParisDe, numeroDuJour } from '@/lib/liveclub/parrainage-pur'
import { bornesMois } from '@/lib/repartition/pur'
import { moisADeclarer } from '@/lib/liveclub/parrainage'
import { carteLives, cleCarteLives, moisPrecedent, nomMoisLives } from '@/lib/repartition/lives-reperes-pur'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

export const MARQUEUR_CARTE_FIN_DE_MOIS = "[système] Carte de fin de mois (commissions de parrainage ou lives d'un intervenant), proposée automatiquement par le passage du matin (ce n'est pas une question de l'équipe)."

export type BilanCartes = { etat: string; parrainage: number; lives: number; alertes: number; erreurs: number }

type Destinataire = { chat: number; court: boolean }

// ---------------------------------------------------------------------------
// Les jours reperes des lives (meme regle que la vue cockpit_lives_detectes)
// ---------------------------------------------------------------------------

export type LivesReperes = { intervenant: string; offreId: string; jours: string[] }

/**
 * Les jours (heure de Paris) ou chaque intervenant qui a un compte Telegram a
 * poste un lien Zoom dans le sujet Annonce, entre deux jours inclus. Jette
 * (le resume en fait une lecture facultative).
 */
export async function joursLivesReperes(du: string, au: string): Promise<LivesReperes[]> {
  const lignes = await prisma.$queryRaw<{ intervenant: string; offre_id: string; jours: string[] }[]>`
    select i.intervenant, i.offre_id,
      array_agg(distinct to_char((m.dit_le at time zone 'Europe/Paris')::date, 'YYYY-MM-DD')) as jours
    from (select distinct intervenant, offre_id, telegram_id from public.cockpit_intervenants where telegram_id is not null) i
    join public.cockpit_telegram_messages m on m.telegram_id = i.telegram_id
    where m.texte ilike '%zoom.us%' and m.sujet ilike 'annonce%'
      and (m.dit_le at time zone 'Europe/Paris')::date between ${du}::date and ${au}::date
    group by i.intervenant, i.offre_id
    order by i.intervenant`
  return lignes.map(l => ({ intervenant: l.intervenant, offreId: l.offre_id, jours: [...(l.jours ?? [])].sort() }))
}

// ---------------------------------------------------------------------------
// La memoire et la pose des cartes
// ---------------------------------------------------------------------------

async function reserver(cle: string): Promise<boolean> {
  const l = await prisma.$queryRaw<{ n: number }[]>`
    insert into public.cockpit_cartes_auto (cle) values (${cle}) on conflict (cle) do nothing returning 1 as n`
  return l.length > 0
}

async function liberer(cle: string): Promise<void> {
  await prisma.$executeRaw`delete from public.cockpit_cartes_auto where cle = ${cle}`
}

async function noter(cle: string, cartes: number, livres: number): Promise<void> {
  await prisma.$executeRaw`update public.cockpit_cartes_auto set cartes = ${cartes}::int, livres = ${livres}::int where cle = ${cle}`
}

async function lireEquipe(): Promise<Destinataire[]> {
  const lignes = await prisma.$queryRaw<{ telegram_id: bigint; libelle: string | null }[]>`
    select telegram_id, libelle from public.cockpit_telegram_comptes where diffusion = 'equipe' order by cree_le`
  return lignes.map(l => ({ chat: Number(l.telegram_id), court: estMelanie(l.libelle) }))
    .filter(l => Number.isSafeInteger(l.chat) && l.chat > 0)
}

/** La carte chez chaque compte (courte pour Mel) ; une carte deja en attente : le texte seul. */
async function poserPartout(equipe: Destinataire[], action: ActionAgent, t: { carte: string; court: string }, cle: string): Promise<{ cartes: number; livres: number }> {
  const { proposerCarteEquipe, tgCockpit, ajouterAHistoriqueAgent } = await import('@/lib/agent-cockpit-telegram')
  const id = `fin-de-mois-${cle}`.slice(0, 120)
  const entrees = (texte: string) => [
    { role: 'user' as const, content: MARQUEUR_CARTE_FIN_DE_MOIS, id },
    { role: 'assistant' as const, content: texte, id: `${id}-texte` },
  ]
  let cartes = 0
  let livres = 0
  for (const dest of equipe) {
    const texte = dest.court ? t.court : t.carte
    try {
      const issue = await proposerCarteEquipe(dest.chat, action as unknown as Record<string, unknown>, texte, entrees(texte))
      if (issue === 'posee') { cartes++; livres++; continue }
      if (issue === 'refusee') continue
      const seul = `${texte}\n\n(Une autre carte attend déjà ta réponse : réponds-y d'abord, puis redemande-moi celle-ci.)`
      if (await tgCockpit('sendMessage', { chat_id: dest.chat, text: seul.slice(0, 4000), link_preview_options: { is_disabled: true } })) {
        livres++
        await ajouterAHistoriqueAgent(dest.chat, dest.chat, entrees(seul)).catch(() => false)
      }
    } catch (err) {
      console.warn(`[cartes-fin-de-mois] carte non posee : ${messageErreur(err).slice(0, 160)}`)
    }
  }
  return { cartes, livres }
}

/** Un texte seul (sans carte) a chaque compte : une carte impossible, et pourquoi. */
async function envoyerPartout(equipe: Destinataire[], texte: string, cle: string): Promise<number> {
  const { tgCockpit, ajouterAHistoriqueAgent } = await import('@/lib/agent-cockpit-telegram')
  const id = `fin-de-mois-${cle}`.slice(0, 120)
  let livres = 0
  for (const dest of equipe) {
    try {
      if (!await tgCockpit('sendMessage', { chat_id: dest.chat, text: texte.slice(0, 4000), link_preview_options: { is_disabled: true } })) continue
      livres++
      await ajouterAHistoriqueAgent(dest.chat, dest.chat, [
        { role: 'user', content: MARQUEUR_CARTE_FIN_DE_MOIS, id },
        { role: 'assistant', content: texte, id: `${id}-texte` },
      ]).catch(() => false)
    } catch {
      // Un compte en panne n'empeche pas les autres.
    }
  }
  return livres
}

async function livesDejaDeclares(intervenant: string, offreId: string, mois: string): Promise<boolean> {
  const l = await prisma.$queryRaw<{ n: number }[]>`
    select count(*)::int as n from public.cockpit_depenses
    where lower(intervenant) = lower(${intervenant}) and offre_id = ${offreId} and mois = ${mois} and retire_le is null`
  return (l[0]?.n ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Le passage du matin
// ---------------------------------------------------------------------------

/**
 * Les cartes de fin de mois (passage.ts, etape 'cartes_fin_de_mois', apres le
 * filet du parrainage et avant le resume). Ne jette pas.
 */
export async function cartesFinDeMois(maintenant: Date = new Date()): Promise<BilanCartes> {
  const b: BilanCartes = { etat: 'ok', parrainage: 0, lives: 0, alertes: 0, erreurs: 0 }
  const moisCourant = jourParisDe(maintenant.toISOString()).slice(0, 7)
  let equipe: Destinataire[]
  try {
    await prisma.$queryRaw`select 1 as n from public.cockpit_cartes_auto limit 1`
    equipe = await lireEquipe()
  } catch (err) {
    if (relationAbsente(err)) return { ...b, etat: 'table_absente' }
    console.warn(`[cartes-fin-de-mois] base illisible : ${messageErreur(err).slice(0, 160)}`)
    return { ...b, etat: 'base_illisible', erreurs: 1 }
  }
  if (equipe.length === 0) return { ...b, etat: 'sans_equipe' }
  const { controlerActionRepartition, nomOffre } = await import('@/lib/repartition/serveur')

  // 1. Les commissions de parrainage des mois finis qui ne sont pas a jour.
  for (const { mois, etat } of await moisADeclarer(moisCourant)) {
    try {
      const produit = (await nomOffre(OFFRE_LIVE_CLUB).catch(() => null)) ?? 'Live Club'
      const c = carteDeclaration(mois, etat, { produit })
      if (!c) continue
      const cle = cleCarteDeclaration(mois, etat)
      if (!await reserver(cle)) continue
      const action = validerAction({
        type: TYPE_DECLARATION_PARRAINAGE, compte: 'cockpit',
        params: { mois, du: etat.du, remplace: etat.depense?.depenseId ?? null },
      })
      if (typeof action === 'string') { await liberer(cle); b.erreurs++; continue }
      const r = await poserPartout(equipe, action, c, cle)
      if (r.livres === 0) { await liberer(cle); continue }
      await noter(cle, r.cartes, r.livres)
      b.parrainage++
    } catch (err) {
      console.warn(`[cartes-fin-de-mois] parrainage : ${messageErreur(err).slice(0, 160)}`)
      b.erreurs++
    }
  }

  // 2. Les lives du mois precedent, par intervenant et produit.
  const mois = moisPrecedent(moisCourant)
  let reperes: LivesReperes[] = []
  try {
    const bornes = bornesMois(mois)
    reperes = await joursLivesReperes(bornes.debut, bornes.fin)
  } catch (err) {
    if (!relationAbsente(err)) {
      console.warn(`[cartes-fin-de-mois] lives illisibles : ${messageErreur(err).slice(0, 160)}`)
      b.erreurs++
    }
  }
  for (const l of reperes) {
    try {
      if (l.jours.length === 0 || await livesDejaDeclares(l.intervenant, l.offreId, mois)) continue
      const cle = cleCarteLives(l.intervenant, l.offreId, mois, l.jours.length)
      if (!await reserver(cle)) continue
      const tete = `Lives ${deNom(l.intervenant)} en ${nomMoisLives(mois)} : ${l.jours.length} repéré${l.jours.length > 1 ? 's' : ''} `
        + `(${l.jours.map(numeroDuJour).join(', ')}/${mois.slice(5, 7)}).`
      const action = validerAction({
        type: 'lives_du_mois', compte: 'cockpit',
        params: { intervenant: l.intervenant, mois, nombre: l.jours.length, offre_id: l.offreId },
      })
      const controle = typeof action === 'string' ? { erreur: action } : await controlerActionRepartition(action)
      if ('erreur' in controle) {
        const raison = /Aucun tarif connu/i.test(controle.erreur)
          ? `aucun tarif par live connu pour ${l.intervenant} en ${nomMoisLives(mois)}. Donne-moi son tarif (combien par live, depuis quand), puis demande-moi ses lives ${nomMoisLives(mois)}.`
          : sansNomsOutils(controle.erreur)
        if (await envoyerPartout(equipe, `${tete} Pas de carte : ${raison}`, cle) === 0) await liberer(cle)
        else b.alertes++
        continue
      }
      const prix = Math.round(Number(controle.action.params.prix_unitaire) * 100)
      const produit = (await nomOffre(l.offreId).catch(() => null)) ?? l.offreId
      const t = carteLives({ intervenant: l.intervenant, mois, jours: l.jours, prixUnitaire: prix, produit, complement: controle.complement ? sansNomsOutils(controle.complement) : null })
      const r = await poserPartout(equipe, controle.action, t, cle)
      if (r.livres === 0) { await liberer(cle); continue }
      await noter(cle, r.cartes, r.livres)
      b.lives++
    } catch (err) {
      console.warn(`[cartes-fin-de-mois] lives : ${messageErreur(err).slice(0, 160)}`)
      b.erreurs++
    }
  }
  console.log(`[cartes-fin-de-mois] ${JSON.stringify(b)}`)
  return b
}
