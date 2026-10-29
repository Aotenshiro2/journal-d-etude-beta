// L'ALERTE SECURITE A BRICE (29/10/2026) : texte cache ou consigne adressee a
// une IA reperes dans ce qui entre dans un bot (injection-pur.ts). Le canal
// est celui qui existe deja pour lui parler : un message du bot Agent AOK a
// SON compte (cockpit_telegram_comptes, compte du cockpit « Brice »), comme
// la note de Tab (tab/notes.ts, prevenirBrice) ; aucun nouveau bot.
//
// L'alerte cite le passage (rendu visible, coupe) et dit d'ou il vient. Elle
// n'entre pas a l'historique d'Agent AOK : ce n'est pas une question.
// Ne jette jamais : une alerte ratee ne casse pas le bot.
//
// Anti-rafale : la meme source et la meme citation ne repartent pas avant une
// heure. Memoire de l'instance seulement (une fonction Vercel neuve peut
// renvoyer la meme alerte) ; le bot des membres plafonne de toute facon ses
// messages a l'IA (PLAFOND_MESSAGES_IA_JOUR).
// tgCockpit est importe a l'appel : agent-cockpit-telegram.ts importe ce module.

import { prisma } from '@/lib/db'
import { citationAnalyse, texteAlerteSecurite, type Analyse } from '@/lib/securite/injection-pur'

const DELAI_MEME_ALERTE_MS = 60 * 60_000
const dejaEnvoyees = new Map<string, number>()

function cleAlerte(source: string, analyse: Analyse): string {
  return `${source}|${citationAnalyse(analyse, 120)}`
}

/** Le compte Telegram de Brice sur Agent AOK, ou null. */
async function telegramDeBrice(): Promise<number | null> {
  const lignes = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
    select c.telegram_id from public.cockpit_telegram_comptes c
    join public.cockpit_allowlist a on a.user_id = c.user_id
    where a.label = 'Brice' limit 1`
  const id = lignes[0] ? Number(lignes[0].telegram_id) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export type AlerteSecurite = {
  /** D'ou vient le texte : « Agent AOK, fil de Mélanie, message transféré », « bot Live Club »... */
  source: string
  /** Qui l'a ecrit ou transmis, quand on le sait (nom, @pseudo, u123...). */
  qui?: string | null
  analyse: Analyse
  /** Ce que le bot a fait (ou pas) : une phrase. */
  suite: string
}

/** Previent Brice. true = parti. Ne jette jamais. */
export async function alerterBriceSecurite(a: AlerteSecurite): Promise<boolean> {
  if (!a.analyse.suspect) return false
  const cle = cleAlerte(a.source + (a.qui ?? ''), a.analyse)
  const maintenant = Date.now()
  const avant = dejaEnvoyees.get(cle)
  if (avant && maintenant - avant < DELAI_MEME_ALERTE_MS) return false
  dejaEnvoyees.set(cle, maintenant)
  if (dejaEnvoyees.size > 500) {
    for (const [k, t] of dejaEnvoyees) if (maintenant - t >= DELAI_MEME_ALERTE_MS) dejaEnvoyees.delete(k)
  }
  try {
    const chat = await telegramDeBrice()
    if (!chat) {
      console.warn('[securite] alerte non envoyee : compte Telegram de Brice introuvable')
      return false
    }
    const { tgCockpit } = await import('@/lib/agent-cockpit-telegram')
    const ok = await tgCockpit('sendMessage', {
      chat_id: chat, text: texteAlerteSecurite(a).slice(0, 4000), link_preview_options: { is_disabled: true },
    })
    // Jamais le texte dans un log : la source et le genre seulement.
    console.warn(`[securite] texte suspect (${a.source}) : ${a.analyse.signaux.filter(s => s.fort).map(s => s.genre).join(', ')} ; alerte ${ok ? 'envoyee' : 'NON envoyee'}`)
    return ok
  } catch (err) {
    console.warn('[securite] alerte non envoyee', err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : '?')
    return false
  }
}
