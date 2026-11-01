// LE CONNECTEUR MCP DU COCKPIT POUR TACHE (01/11/2026) : le cote serveur.
//
// 1. La cle : la ligne dediee de cockpit_tab_cles (portee tache_mcp, empreinte
//    prefixee, temps constant, 60 appels par minute comptes dans
//    cockpit_tab_acces), ou en option le Bearer de la cle API de Tache, verifie
//    par verifierCle de l'API elle-meme (portee tache seulement).
//    Tant que la migration 20261101200000 n'est pas passee (la contrainte de
//    portee ne connait pas tache_mcp), le connecteur rend 503 et ne lit rien
//    d'autre.
// 2. Les outils : le handler GET ou POST de l'API de Tab
//    (src/app/api/tab/v1/[[...chemin]]/route.ts), appele dans le meme
//    processus sous sousCleDeTache (verdict de portee 'tache', jamais 'tab') :
//    exactement les regles de la cle de Tache. La requete interne ne porte
//    aucune cle ni aucun secret.

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { journaliser, sousCleDeTache, verifierCle, type LigneJournal } from '@/lib/tab/acces'
import { GET as getApiTab, POST as postApiTab } from '@/app/api/tab/v1/[[...chemin]]/route'
import { bearerAccepte, choisirCleTache, DEBIT_PAR_MINUTE_TACHE_MCP, PORTEE_TACHE_MCP, SECRET_TACHE_MCP, type AppelApi, type ReponseApi, type VerdictCleTache } from '@/lib/mcp-tache/pur'

function raison(err: unknown): string {
  return err instanceof Error ? (err.message.split('\n').filter(Boolean).pop() ?? '') : String(err)
}

type LigneCle = { cle_id: string; empreinte: string; appels: number }

/** La contrainte de portee connait tache_mcp : la migration 20261101200000 est passee. */
async function enService(): Promise<boolean> {
  const r = await prisma.$queryRaw<{ def: string | null }[]>`
    select pg_get_constraintdef(c.oid) as def from pg_constraint c
    where c.conname = 'cockpit_tab_cles_portee_check' and c.conrelid = 'public.cockpit_tab_cles'::regclass`
  return (r[0]?.def ?? '').includes(`'${PORTEE_TACHE_MCP}'`)
}

export async function verifierCleTacheMcp(secret: string, entete: string | null): Promise<VerdictCleTache> {
  let cles: LigneCle[]
  try {
    if (!(await enService())) return { ok: false, raison: 'pas_en_service', cleId: null }
    cles = SECRET_TACHE_MCP.test(secret)
      ? await prisma.$queryRaw<LigneCle[]>`
          select c.cle_id::text as cle_id, c.empreinte,
            (select count(*)::int from public.cockpit_tab_acces a
              where a.cle_id = c.cle_id and a.appele_le > now() - interval '1 minute') as appels
          from public.cockpit_tab_cles c
          where c.portee = 'tache_mcp' and c.coupee_le is null`
      : []
  } catch (err) {
    console.error('[mcp-tache] cles illisibles', raison(err).slice(0, 200))
    return { ok: false, raison: 'base', cleId: null }
  }
  const c = cles.length ? choisirCleTache(cles, secret) : null
  if (c) {
    if (c.appels >= DEBIT_PAR_MINUTE_TACHE_MCP) return { ok: false, raison: 'debit', cleId: c.cle_id }
    return { ok: true, cleId: c.cle_id, appelsMinute: c.appels, mode: 'secret' }
  }
  // L'option : le Bearer de la cle API de Tache, verifie par l'API elle-meme (empreinte, coupure, cadence).
  if (/^Bearer\s+\S/i.test(entete ?? '')) {
    const v = await verifierCle(entete)
    if (v.ok && bearerAccepte(v.portee)) return { ok: true, cleId: v.cleId, appelsMinute: v.appelsMinute, mode: 'bearer' }
    if (!v.ok && v.status === 429 && v.cleId) return { ok: false, raison: 'debit', cleId: v.cleId }
    if (!v.ok && v.status === 503) return { ok: false, raison: 'base', cleId: null }
  }
  return { ok: false, raison: 'inconnue', cleId: null }
}

/** Appelle le handler de l'API de Tab, sous le verdict de Tache, et rend sa reponse et sa ligne de journal. */
export function appelerApiTache(origine: string, ip: string | null) {
  return async (appel: AppelApi, cle: { cleId: string; appelsMinute: number }): Promise<ReponseApi> => {
    const debut = Date.now()
    const url = new URL(`${origine}/api/tab/v1/${appel.chemin.map(encodeURIComponent).join('/')}`)
    for (const [k, v] of appel.query) url.searchParams.append(k, v)
    const entetes: Record<string, string> = { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) }
    const req = new NextRequest(url, {
      method: appel.methode,
      headers: entetes,
      ...(appel.methode === 'POST' ? { body: JSON.stringify(appel.corps ?? {}) } : {}),
    })
    // cheminDe() de la route decode chaque segment : on les passe encodes, comme dans une vraie URL.
    const ctx = { params: Promise.resolve({ chemin: appel.chemin.map(encodeURIComponent) }) }
    const { valeur: res, journaux } = await sousCleDeTache(cle.cleId, cle.appelsMinute, () => (appel.methode === 'GET' ? getApiTab(req, ctx) : postApiTab(req, ctx)))
    // Les lignes ecrites pendant l'appel AVANT celle de la route (aucune aujourd'hui) partent telles quelles.
    for (const l of journaux.slice(0, -1)) await journaliser(l)
    const derniere: LigneJournal | undefined = journaux[journaux.length - 1]
    let corps: unknown = null
    try {
      corps = await res.json()
    } catch {
      corps = { ok: false, erreur: 'Réponse illisible.' }
    }
    return {
      status: res.status,
      corps,
      journal: derniere ? { route: derniere.route, parametres: derniere.parametres, lignes: derniere.lignes, erreur: derniere.erreur ?? null } : null,
      dureeMs: Date.now() - debut,
    }
  }
}
