// Les gestes du compte que le site statique ne peut pas faire seul (Brice,
// 18/10/2026, page /mon-espace/parametres d'aoknowledge.com) : le RECU d'un
// paiement (il faut une cle Stripe) et la SUPPRESSION DU COMPTE (elle
// reprend l'effacement de niveau 3 du cockpit, effacement.ts).
//
// Le compte est TOUJOURS celui du jeton Bearer : aucune route n'accepte un
// identifiant, un email ou une cible venus du navigateur.
//
// - Recu : le paiement doit figurer dans ce que aok_compte_de(<uuid du
//   jeton>) rend au membre (migration 20261018233000_mon_espace_parametres.sql,
//   memes regles que la page) ; puis la charge est lue chez Stripe sur le
//   compte du paiement (aoknowledge pour le comptant, melanie pour le Live
//   Club) et seule son adresse receipt_url repart.
// - Suppression : la cible est l'email CONFIRME du compte du jeton, rien
//   d'autre. cockpit_effacement_cibles l'etend comme pour l'equipe (comptes,
//   fiches, Telegram). Memes refus que la carte du cockpit (compte de
//   l'equipe, formateur, tarif reserve, cible trop large), meme ordre
//   (Stripe, base, Telegram). L'equipe est prevenue par Agent AOK avec le
//   compte rendu, qui dit ce qui reste a faire a la main.
//
// Jamais un email, un jeton ni une cle dans un log.

import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { cleAgent, stripeGet, RefusAction, type ActionAgent } from '@/lib/stripe-actions'
import { cleStripeLecture } from '@/lib/liveclub/config'
import { messageErreur } from '@/lib/liveclub/pur'

/** Le compte du jeton Bearer : uuid et email confirme. null = refuse. Jette si Supabase Auth est injoignable. */
export async function compteCompletDuJeton(entete: string | null): Promise<{ id: string; email: string | null } | null> {
  const brut = entete ?? ''
  if (!brut.startsWith('Bearer ')) return null
  const jeton = brut.slice(7).trim()
  if (!jeton || jeton.length > 4096) return null
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data, error } = await supabase.auth.getUser(jeton)
  if (error) {
    if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) return null
    throw error
  }
  const u = data.user
  if (!u) return null
  return { id: u.id, email: u.email && u.email_confirmed_at ? u.email.toLowerCase() : null }
}

// ---------------------------------------------------------------- Recu

type Paiement = { paiement_id?: unknown; recu?: unknown }

/** Les paiements que la page montre au membre, avec reçu possible. */
async function paiementsAvecRecu(userId: string): Promise<Set<string>> {
  const l = await prisma.$queryRawUnsafe<{ c: string | null }[]>('select public.aok_compte_de($1::uuid)::text as c', userId)
  const o = JSON.parse(l[0]?.c ?? '{}') as { achats?: Paiement[]; live_club_dernier_paiement?: Paiement | null }
  const ids = new Set<string>()
  for (const p of [...(o.achats ?? []), ...(o.live_club_dernier_paiement ? [o.live_club_dernier_paiement] : [])]) {
    if (p.recu === true && typeof p.paiement_id === 'string') ids.add(p.paiement_id)
  }
  return ids
}

export type IssueRecu =
  | { ok: true; url: string }
  | { ok: false; erreur: 'paiement' | 'recu' | 'config' | 'indisponible' }

/** Le format des identifiants de paiement Stripe de cockpit_paiements. */
export const lireIdPaiement = (v: unknown): string | null =>
  typeof v === 'string' && /^stripe:(ch|py)_[A-Za-z0-9]{8,100}$/.test(v) ? v : null

export async function recuDuPaiement(userId: string, paiementId: string): Promise<IssueRecu> {
  let ids: Set<string>
  let compte: string | null = null
  try {
    ids = await paiementsAvecRecu(userId)
    if (!ids.has(paiementId)) return { ok: false, erreur: 'paiement' }
    const l = await prisma.$queryRawUnsafe<{ compte: string | null; source: string }[]>(
      'select compte, source from public.cockpit_paiements where paiement_id = $1', paiementId)
    if (l[0]?.source !== 'stripe') return { ok: false, erreur: 'recu' }
    compte = l[0].compte
  } catch (err) {
    console.warn(`[compte/recu] lecture impossible : ${messageErreur(err).slice(0, 160)}`)
    return { ok: false, erreur: 'indisponible' }
  }
  const cle = compte === 'aoknowledge' ? cleAgent('aoknowledge') : compte === 'melanie' ? cleStripeLecture() : null
  if (!cle) return { ok: false, erreur: 'config' }
  try {
    const charge = await stripeGet(cle, `/v1/charges/${encodeURIComponent(paiementId.slice('stripe:'.length))}`)
    const url = typeof charge.receipt_url === 'string' ? charge.receipt_url : null
    if (!url || !/^https:\/\/[a-z0-9.-]*stripe\.com\//.test(url)) return { ok: false, erreur: 'recu' }
    return { ok: true, url }
  } catch (err) {
    const m = messageErreur(err)
    if (/No such charge/i.test(m)) return { ok: false, erreur: 'recu' }
    console.warn(`[compte/recu] Stripe (${compte}) : ${m.slice(0, 160)}`)
    return { ok: false, erreur: 'indisponible' }
  }
}

// ---------------------------------------------------------------- Suppression

export const MOT_CONFIRMATION = 'SUPPRIMER'

export type IssueSuppression =
  | { ok: true; message: string | null }
  | { ok: false; erreur: 'refus' | 'panne' }

/** La photo du compte (bucket prive avatars-membres), retiree avec la cle de service. Ne jette pas. */
async function retirerPhoto(userId: string): Promise<void> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !cle) return
  try {
    const s = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
    await s.storage.from('avatars-membres').remove([`${userId}/avatar`])
  } catch (err) {
    console.warn(`[compte/supprimer] photo non retiree : ${messageErreur(err).slice(0, 120)}`)
  }
}

/** Le compte rendu a l'equipe, par Agent AOK. Ne jette pas. */
async function prevenirEquipe(texte: string): Promise<void> {
  try {
    const { tgCockpit } = await import('@/lib/agent-cockpit-telegram')
    const dest = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`
    for (const d of dest) {
      const chat = Number(d.telegram_id)
      if (Number.isSafeInteger(chat) && chat > 0) await tgCockpit('sendMessage', { chat_id: chat, text: texte.slice(0, 4000) })
    }
  } catch (err) {
    console.warn(`[compte/supprimer] equipe non prevenue : ${messageErreur(err).slice(0, 120)}`)
  }
}

/** Le recapitulatif pour la personne, tel que le compte rendu de l'effacement le porte. */
export function recapitulatifDuCompteRendu(compteRendu: string): string | null {
  const m = /À transmettre à la personne :\n« ([\s\S]+) »\s*$/.exec(compteRendu)
  return m ? m[1].trim() : null
}

/**
 * Niveau 3 pour le compte du jeton. Refus (equipe, formateur, tarif reserve,
 * cible trop large, rien a effacer) = rien n'est fait, le membre ecrit au
 * support ; panne = le message dit ce qui a deja ete fait, cote equipe.
 */
export async function supprimerCompte(compte: { id: string; email: string }): Promise<IssueSuppression> {
  const { executerActionEffacement } = await import('@/lib/effacement')
  const { lireCible } = await import('@/lib/effacement-pur')
  const cible = lireCible({ telegram: [], membres: [], archives: [], emails: [compte.email] })
  if (typeof cible === 'string') return { ok: false, erreur: 'refus' }
  const action: ActionAgent = {
    type: 'effacement', compte: 'cockpit',
    params: { niveau: 3, qui: 'compte du site (demande du membre)', cible },
  }
  let compteRendu: string
  try {
    compteRendu = await executerActionEffacement(action, 'membre:mon-espace')
  } catch (err) {
    const refus = err instanceof RefusAction
    console.warn(`[compte/supprimer] ${refus ? 'refus' : 'panne'} : ${messageErreur(err).slice(0, 200)}`)
    await prevenirEquipe(`Un membre a demandé la suppression de son compte depuis mon-espace : ${refus ? 'REFUSÉE' : 'EN PANNE'}.\n`
      + `${messageErreur(err).slice(0, 1500)}\nIl a été invité à écrire à support@aoknowledge.com.`)
    return { ok: false, erreur: refus ? 'refus' : 'panne' }
  }
  await retirerPhoto(compte.id)
  await prevenirEquipe(`Un membre a supprimé son compte depuis mon-espace (niveau 3, geste du membre).\n${compteRendu}`)
  return { ok: true, message: recapitulatifDuCompteRendu(compteRendu) }
}
