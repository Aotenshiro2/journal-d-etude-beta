// « DÉJÀ TRAITÉ » (Brice, 05/11/2026) : « quand une conversation a été traitée
// en dehors du bot, je veux pouvoir cliquer sur un bouton pour signaler qu'un
// humain est déjà passé ou que le membre a eu sa réponse, sinon le
// signalement reste levé pour rien ». Choix de Brice : le bouton dans le fil
// de l'onglet Support du cockpit ET sous l'alerte d'Agent AOK.
//
// Un seul geste pour les deux portes :
// - le fil sort de l'attente, ligne « [système] Traité hors du bot par <nom> :
//   le membre a eu sa réponse. » (marquerFilTraite, support-pont.ts), qui rend
//   aussi la main au bot et vaut « humain passé » dans le cockpit ;
// - rien n'est envoye au membre (et GET /api/support/thread ne lui rend pas
//   les lignes « [système] ») ;
// - le reste de l'equipe le sait par Agent AOK (alerterEquipeTexte, support:
//   true : Adil compris), pour que personne ne lui reponde une deuxieme fois.
// L'appelant a deja verifie le compte (allowlist du cockpit, ou compte
// d'Agent AOK). Jette si la base ne repond pas.

import { prisma } from '@/lib/db'
import { marquerFilTraite } from '@/lib/liveclub/support-pont'
import { alerterEquipeTexte, nomTelegram } from '@/lib/alerte-equipe-telegram'
import { texteFilTraiteEquipe } from '@/lib/alerte-equipe-telegram-pur'

export type IssueFilTraite =
  | { ok: true; dejaTraite: boolean; telegram: boolean; prevenus: number; messages: unknown; escalatedAt: null }
  | { ok: false; raison: 'introuvable' }

/** Le prenom du compte du cockpit (libelle de l'allowlist : Brice, Mélanie, Adil), ou null. */
async function prenomDuCompte(userId: string): Promise<string | null> {
  try {
    const l = await prisma.$queryRaw<{ label: string | null }[]>`
      select label from public.cockpit_allowlist where user_id = ${userId}::uuid`
    return l[0]?.label?.trim() || null
  } catch {
    return null
  }
}

export async function traiterFilHorsBot(threadId: string, userId: string, journal: string): Promise<IssueFilTraite> {
  const prenom = await prenomDuCompte(userId)
  const issue = await marquerFilTraite(threadId, prenom)
  if (!issue.ok) return issue
  const telegram = issue.app === 'telegram'
  if (issue.dejaTraite) {
    return { ok: true, dejaTraite: true, telegram, prevenus: 0, messages: issue.messages, escalatedAt: null }
  }
  const nomTg = telegram && issue.telegramId ? await nomTelegram(issue.telegramId) : null
  const prevenus = await alerterEquipeTexte(
    texteFilTraiteEquipe({ auteur: prenom, qui: nomTg ?? issue.email, fil: threadId }),
    { sauf: userId, support: true, journal: `${journal} equipe prevenue` },
  )
  console.log(`${journal} fil ${threadId.slice(0, 8)} marque traite hors du bot (${prevenus} compte(s) prevenu(s))`)
  return { ok: true, dejaTraite: false, telegram, prevenus, messages: issue.messages, escalatedAt: null }
}
