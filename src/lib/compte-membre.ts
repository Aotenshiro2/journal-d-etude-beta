// Les gestes du compte que le site statique ne peut pas faire seul (Brice,
// 18/10/2026, page /mon-espace/parametres d'aoknowledge.com) : le RECU d'un
// paiement (il faut une cle Stripe) et la DEMANDE DE SUPPRESSION du compte
// (transmise a l'equipe, rien n'est efface depuis le site).
//
// Le compte est TOUJOURS celui du jeton Bearer : aucune route n'accepte un
// identifiant, un email ou une cible venus du navigateur.
//
// - Recu : le paiement doit figurer dans ce que aok_compte_de(<uuid du
//   jeton>) rend au membre (migration 20261018233000_mon_espace_parametres.sql,
//   memes regles que la page) ; puis la charge est lue chez Stripe sur le
//   compte du paiement (aoknowledge pour le comptant, melanie pour le Live
//   Club) et seule son adresse receipt_url repart.
// - Demande de suppression (Brice, 18/10/2026 : « une demande via l'equipe
//   est mieux, ca evite les decisions impulsives ») : le site ne supprime
//   rien. L'equipe est prevenue par Agent AOK avec l'email confirme du compte
//   du jeton ; elle voit avec la personne le niveau (1, 2 ou 3) puis
//   l'execute depuis le cockpit (proposer_effacement), comme une demande
//   transmise par le bot (docs/EFFACEMENT-DONNEES.md, section 3 bis).
//
// Jamais un email, un jeton ni une cle dans un log.

import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { cleAgent, stripeGet } from '@/lib/stripe-actions'
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
  const o = JSON.parse(l[0]?.c ?? '{}') as { achats?: Paiement[]; live_club_dernier_paiement?: Paiement | null; live_club_paiements?: Paiement[] }
  const ids = new Set<string>()
  // (18/10, lot 1) live_club_paiements : l'historique des paiements de la page Achats.
  for (const p of [...(o.achats ?? []), ...(o.live_club_dernier_paiement ? [o.live_club_dernier_paiement] : []), ...(o.live_club_paiements ?? [])]) {
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

// ---------------------------------------------------------------- Demande de suppression

export type IssueDemandeSuppression = { ok: true } | { ok: false; erreur: 'panne' }

/** Le message a l'equipe, par Agent AOK. Vrai si au moins un compte de l'equipe l'a recu. */
async function prevenirEquipe(texte: string): Promise<boolean> {
  let recu = false
  try {
    const { tgCockpit } = await import('@/lib/agent-cockpit-telegram')
    const dest = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`
    for (const d of dest) {
      const chat = Number(d.telegram_id)
      if (!Number.isSafeInteger(chat) || chat <= 0) continue
      try {
        await tgCockpit('sendMessage', { chat_id: chat, text: texte.slice(0, 4000) })
        recu = true
      } catch (err) {
        console.warn(`[compte/supprimer] un compte de l'equipe non prevenu : ${messageErreur(err).slice(0, 120)}`)
      }
    }
  } catch (err) {
    console.warn(`[compte/supprimer] equipe non prevenue : ${messageErreur(err).slice(0, 120)}`)
  }
  return recu
}

/**
 * Transmet a l'equipe la demande de suppression du compte du jeton. Rien
 * n'est efface ici : l'equipe qualifie le niveau avec la personne puis
 * l'execute depuis le cockpit. Panne = personne de l'equipe n'a recu le
 * message : le membre est invite a ecrire au support.
 */
export async function transmettreDemandeSuppression(compte: { id: string; email: string }): Promise<IssueDemandeSuppression> {
  const recu = await prevenirEquipe(
    `Demande de suppression de compte, depuis mon-espace (site).
`
    + `Compte : ${compte.email}
`
    + `Rien n'a été supprimé. À voir avec la personne (par email) : ce qu'elle souhaite vraiment, niveau 1, 2 ou 3, `
    + `puis l'effacement depuis le cockpit (« efface ${compte.email}, niveau … »).`,
  )
  return recu ? { ok: true } : { ok: false, erreur: 'panne' }
}
