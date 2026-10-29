// LES FILS DE L'EQUIPE AVEC AGENT AOK (29/10/2026).
//
// Brice, 28/10 : l'agent lui a repondu « chaque conversation est isolee » et
// « je ne peux pas ecrire a Melanie, elle n'est pas un membre ». Faux : chaque
// fil d'Agent AOK est garde en base (cockpit_agent_conversations, un par
// compte de cockpit_telegram_comptes), et l'agent ecrit dans le fil de Mel
// des qu'il lui repond. Ce module donne a l'agent :
// - demandes_en_suspens (lecture, sans carte) : ce qui est reste sans
//   reponse dans les fils de l'equipe ;
// - reprendre_demande (sans carte, comme rendre_la_main_au_bot) : relancer
//   la demande restee sans reponse d'un membre de l'equipe DANS SON fil. Le
//   tour relance tourne pour LUI (son compte, ses cartes, sa conversation),
//   apres la reponse a celui qui l'a demande (agent-cockpit-telegram.ts,
//   reprendreDemandeEquipe). Aucune action ne part sans la carte habituelle.
// Regles pures (ce qui est en suspens, qui est designe) :
// agent-cockpit-telegram-pur.ts.

import { prisma } from '@/lib/db'
import {
  demandesEnSuspens, extraitCourt, quandParis, resoudreMembreEquipe,
  type CompteEquipe, type DemandesEnSuspens,
} from '@/lib/agent-cockpit-telegram-pur'

/** Une demande a relancer dans le fil d'un membre de l'equipe, apres la reponse du tour en cours. */
export type RelanceEquipe = { chatId: number; qui: string; par: string }

/** Le nom a dire : le libelle du cockpit (Brice, Mélanie), sinon celui du compte Telegram. */
export function nomEquipe(c: CompteEquipe): string {
  return c.label?.trim() || c.libelle?.trim() || `u${c.telegram_id}`
}

export async function lireComptesEquipe(): Promise<CompteEquipe[]> {
  const lignes = await prisma.$queryRaw<{ telegram_id: bigint; user_id: string; libelle: string | null; label: string | null }[]>`
    select c.telegram_id, c.user_id::text as user_id, c.libelle, a.label
    from public.cockpit_telegram_comptes c
    left join public.cockpit_allowlist a on a.user_id = c.user_id
    order by c.cree_le`
  return lignes.map(l => ({ telegram_id: Number(l.telegram_id), user_id: l.user_id, libelle: l.libelle, label: l.label }))
}

export type SuspensEquipe = { compte: CompteEquipe; suspens: DemandesEnSuspens }

/** Les demandes en suspens de chaque fil de l'equipe (en prive, chat_id = telegram_id). */
export async function lireSuspensEquipe(maintenant: number = Date.now()): Promise<SuspensEquipe[]> {
  const comptes = await lireComptesEquipe()
  if (comptes.length === 0) return []
  const ids = comptes.map(c => c.telegram_id)
  const fils = await prisma.$queryRaw<{ chat_id: bigint; messages: unknown }[]>`
    select chat_id, messages from public.cockpit_agent_conversations
    where chat_id = any(${ids}::bigint[])`
  const sortie: SuspensEquipe[] = []
  for (const f of fils) {
    const compte = comptes.find(c => c.telegram_id === Number(f.chat_id))
    if (!compte) continue
    const suspens = demandesEnSuspens(f.messages, { maintenant })
    if (suspens) sortie.push({ compte, suspens })
  }
  return sortie
}

function versAgent(s: SuspensEquipe) {
  return {
    qui: nomEquipe(s.compte),
    depuis: quandParis(s.suspens.depuis) || 'date inconnue (avant le 29/10)',
    etat: s.suspens.inachevee ? 'inachevée (le tour s\'est arrêté avant la fin)' : 'sans réponse',
    messages: s.suspens.messages.map(m => extraitCourt(m.texte, 600)),
    derniere_reponse_avant: s.suspens.contexte ? extraitCourt(s.suspens.contexte, 600) : null,
  }
}

/** demandes_en_suspens : JSON pour le modele. Ne jette pas. */
export async function demandesEnSuspensPourAgent(entree: unknown): Promise<string> {
  const e = (entree && typeof entree === 'object' ? entree : {}) as { qui?: unknown }
  try {
    let liste = await lireSuspensEquipe()
    if (e.qui !== undefined && e.qui !== null && String(e.qui).trim()) {
      const cible = resoudreMembreEquipe(e.qui, liste.map(s => s.compte))
      if (cible === 'plusieurs') return JSON.stringify({ erreur: `« ${String(e.qui).slice(0, 40)} » désigne plusieurs comptes de l'équipe : précise.` })
      liste = cible ? liste.filter(s => s.compte.telegram_id === cible.telegram_id) : []
    }
    return JSON.stringify({
      demandes: liste.map(versAgent),
      note: liste.length === 0
        ? "Aucune demande de l'équipe sans réponse dans les fils d'Agent AOK."
        : "Pour en relancer une dans le fil de son auteur : reprendre_demande avec son nom. Dans le fil de ton interlocuteur lui-même, traite-la directement.",
    })
  } catch (err) {
    const raison = err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : '?'
    return JSON.stringify({ erreur: `Lecture des fils de l'équipe impossible (${raison}) : réessaie dans un instant.` })
  }
}

/**
 * reprendre_demande : verifie qu'il y a bien une demande en suspens chez ce
 * membre de l'equipe, et rend la relance a faire apres la reponse du tour.
 * Rien n'est envoye ici. Ne jette pas.
 */
export async function preparerRelancePourAgent(
  entree: unknown, userIdCourant: string, par: string,
): Promise<{ contenu: string; erreur: boolean; relance?: RelanceEquipe }> {
  const e = (entree && typeof entree === 'object' ? entree : {}) as { qui?: unknown }
  const erreur = (texte: string) => ({ contenu: JSON.stringify({ erreur: texte }), erreur: true })
  try {
    const comptes = await lireComptesEquipe()
    const cible = resoudreMembreEquipe(e.qui, comptes)
    if (cible === 'plusieurs') return erreur(`« ${String(e.qui ?? '').slice(0, 40)} » désigne plusieurs comptes de l'équipe : précise lequel.`)
    if (!cible) {
      return erreur(`« ${String(e.qui ?? '').slice(0, 40)} » n'est pas un compte de l'équipe sur Agent AOK (${comptes.map(nomEquipe).join(', ') || 'aucun'}). `
        + "Pour un membre du Live Club, c'est proposer_reponse_membre.")
    }
    const nom = nomEquipe(cible)
    if (cible.user_id === userIdCourant) {
      return erreur(`C'est le fil de ton interlocuteur lui-même : traite sa demande restée sans réponse directement, ici.`)
    }
    const [fil] = await prisma.$queryRaw<{ messages: unknown }[]>`
      select messages from public.cockpit_agent_conversations where chat_id = ${cible.telegram_id}`
    const suspens = demandesEnSuspens(fil?.messages ?? [], { maintenant: Date.now() })
    if (!suspens) {
      return erreur(`Aucune demande de ${nom} n'est restée sans réponse dans son fil : rien à reprendre. Si une demande précise t'intéresse, demande-la à ${nom} ou relis son fil avec demandes_en_suspens.`)
    }
    return {
      contenu: JSON.stringify({
        relancee: true,
        qui: nom,
        demande: suspens.messages.map(m => extraitCourt(m.texte, 300)),
        a_dire: `Dis en une phrase que la demande de ${nom} est relancée dans son fil : la réponse (et les cartes éventuelles) arrivent chez ${nom}, juste après ce message.`,
      }),
      erreur: false,
      relance: { chatId: cible.telegram_id, qui: nom, par },
    }
  } catch (err) {
    const raison = err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : '?'
    return erreur(`Lecture des fils de l'équipe impossible (${raison}) : rien n'est relancé, réessaie dans un instant.`)
  }
}
