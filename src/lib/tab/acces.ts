// L'API DE TAB : la cle, la limite de debit et le journal d'acces (20/10/2026).
//
// La cle arrive en en-tete (Authorization: Bearer <cle>). Seule son EMPREINTE
// (sha256) est en base, dans cockpit_tab_cles ; une cle est active tant que
// coupee_le est vide (le bouton « Couper la clé » du cockpit, vue Machine, la
// coupe sans redeploiement). La comparaison se fait en temps constant sur
// toutes les cles actives. La limite de debit compte les appels de la cle
// dans le journal (cockpit_tab_acces) sur la derniere minute.
// Seules les cles de portee 'tab' ouvrent cette API (23/10/2026) : les cles
// 'gpt_belrive' sont celles du connecteur MCP de ChatGPT (src/lib/mcp-gpt/),
// avec une empreinte a part (empreinteCleGpt) qui ne passerait pas ici non plus.

import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'
import { DEBIT_PAR_MINUTE } from '@/lib/tab/pur'

export type VerdictCle =
  | { ok: true; cleId: string; appelsMinute: number }
  | { ok: false; status: 401 | 429 | 503; erreur: string; cleId: string | null }

export function empreinteCle(cle: string): string {
  return createHash('sha256').update(cle, 'utf8').digest('hex')
}

export async function verifierCle(entete: string | null): Promise<VerdictCle> {
  const m = /^Bearer\s+(\S{20,200})\s*$/i.exec(entete ?? '')
  if (!m) return { ok: false, status: 401, erreur: 'Clé absente : en-tête Authorization: Bearer <clé>.', cleId: null }
  const recue = Buffer.from(empreinteCle(m[1]), 'hex')
  let cles: { cle_id: string; empreinte: string; appels: number }[]
  try {
    cles = await prisma.$queryRaw<{ cle_id: string; empreinte: string; appels: number }[]>`
      select c.cle_id::text as cle_id, c.empreinte,
        (select count(*)::int from public.cockpit_tab_acces a
          where a.cle_id = c.cle_id and a.appele_le > now() - interval '1 minute') as appels
      from public.cockpit_tab_cles c
      where c.coupee_le is null and c.portee = 'tab'`
  } catch (err) {
    console.error('[tab] cles illisibles', err instanceof Error ? err.message.split('\n').pop() : err)
    return { ok: false, status: 503, erreur: 'Base indisponible, réessaie dans un instant.', cleId: null }
  }
  // Temps constant : chaque cle active est comparee, sans sortie anticipee.
  let trouvee: { cle_id: string; appels: number } | null = null
  for (const c of cles) {
    const attendue = Buffer.from(c.empreinte, 'hex')
    if (attendue.length === recue.length && timingSafeEqual(attendue, recue) && !trouvee) trouvee = c
  }
  if (!trouvee) return { ok: false, status: 401, erreur: 'Clé inconnue ou coupée.', cleId: null }
  if (trouvee.appels >= DEBIT_PAR_MINUTE) {
    return { ok: false, status: 429, erreur: `Trop d'appels : ${DEBIT_PAR_MINUTE} par minute au plus. Réessaie dans une minute.`, cleId: trouvee.cle_id }
  }
  return { ok: true, cleId: trouvee.cle_id, appelsMinute: trouvee.appels }
}

/** Les parametres a journaliser : la requete, sans rien de secret (aucune cle n'y passe jamais). */
export function parametresJournal(url: URL, corps?: Record<string, unknown> | null): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  for (const [k, v] of url.searchParams) p[k] = v.slice(0, 200)
  if (corps) {
    // Le generateur : on garde la demande, jamais l'image elle-meme.
    const { image, ...reste } = corps as { image?: unknown }
    // Les textes longs (une note de 20 000 caracteres) sont coupes : le journal garde la trace, pas le contenu.
    const coupe = Object.fromEntries(Object.entries(reste).map(([k, v]) => [k, typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)} [...]` : v]))
    p.corps = { ...coupe, ...(image ? { image: '[image]' } : {}) }
  }
  return p
}

/** Ecrit une ligne du journal d'acces. Ne jette jamais : un journal en panne ne casse pas la reponse. */
export async function journaliser(l: {
  cleId: string | null; route: string; parametres: Record<string, unknown>; statut: number
  dureeMs: number; lignes: number | null; ip: string | null; erreur?: string | null
}): Promise<void> {
  try {
    await prisma.$executeRaw`
      insert into public.cockpit_tab_acces (cle_id, route, parametres, statut, duree_ms, lignes, ip, erreur)
      values (${l.cleId}::uuid, ${l.route.slice(0, 120)}, ${JSON.stringify(l.parametres)}::jsonb, ${l.statut},
              ${Math.round(l.dureeMs)}, ${l.lignes}, ${l.ip ? l.ip.slice(0, 80) : null}, ${l.erreur ? l.erreur.slice(0, 300) : null})`
  } catch (err) {
    console.error('[tab] journal d acces', err instanceof Error ? err.message.split('\n').pop() : err)
  }
}
