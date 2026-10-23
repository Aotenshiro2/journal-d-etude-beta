// Les pieces jointes PROTEGEES de l'academie : PDF des modules payants.
//
// Depuis le 23/10/2026 (lot LOT-PDF-SUR-BUNNY) : Storage Zone Bunny
// « aok-academie-pdfs », servie par la Pull Zone a jeton (src/lib/academie/pdf-bunny.ts,
// variables BUNNY_PDF_HOTE et BUNNY_PDF_CLE_JETON ; envoi par
// scripts/envoyer-ressources-academie.mjs, bascule par
// scripts/migrer-ressources-vers-bunny.mjs). Memes chemins qu'avant.
//
// REPLI pendant la bascule (a retirer une fois les variables posees en prod et
// le bucket vide) : sans aucune variable BUNNY_PDF_*, l'URL est signee comme
// avant par Supabase Storage, bucket PRIVE « academie-ressources » (migration
// 20261016140000_academie_ressources_protegees.sql, aucune policy sur
// storage.objects, cle de service SUPABASE_SERVICE_ROLE_KEY).
//
// L'eleve ne recoit qu'une URL de 5 minutes, APRES le droit (route
// /api/academie/ressource). Une URL qui circule meurt donc vite. Les cles ne
// quittent jamais le serveur : ni dans une reponse, ni dans un log.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { BUCKET_RESSOURCES } from './pur'
import { configPdfBunny, signerPdf, DUREE_URL_PDF_S } from './pdf-bunny'

/** Duree d'une URL signee : 5 minutes, de quoi ouvrir le document (le telechargement commence avant). */
export const DUREE_URL_RESSOURCE_S = DUREE_URL_PDF_S

export type UrlRessource =
  | { ok: true; url: string; expireLe: string; source: 'bunny' | 'supabase' }
  | { ok: false; erreur: 'config' | 'introuvable' | 'indisponible'; detail?: string }

let client: SupabaseClient | null = null

function clientStockage(): SupabaseClient | null {
  if (client) return client
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !cle) return null
  client = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

/** Un « objet absent » de Storage (400 avec statusCode 404 dans le corps, ou 404). */
function estIntrouvable(err: unknown): boolean {
  const e = (err ?? {}) as { status?: unknown; statusCode?: unknown; message?: unknown }
  return e.status === 404 || e.statusCode === '404' || e.statusCode === 404
    || /not.?found/i.test(String(e.message ?? ''))
}

/**
 * L'URL signee d'un PDF protege, valable DUREE_URL_RESSOURCE_S.
 * Ne verifie PAS le droit : c'est le travail de la route, avant cet appel.
 * - Bunny (variables BUNNY_PDF_* posees) : signature locale, sans appel
 *   reseau ; un fichier absent de la Storage Zone n'est pas detecte ici (Bunny
 *   repond 404 a l'eleve). 'introuvable' seulement pour un chemin mal forme.
 * - Supabase (aucune variable BUNNY_PDF_*, repli) : comme avant, 'introuvable'
 *   si le fichier n'est pas dans le bucket.
 * 'config' : BUNNY_PDF_* a moitie posees ou mal formees, ou (repli) URL de
 * Supabase ou cle de service absente ; 'indisponible' : Storage en panne.
 * detail : un message court pour le log, jamais une cle.
 */
export async function urlSigneeRessource(fichier: string, maintenantMs: number = Date.now()): Promise<UrlRessource> {
  const bunny = configPdfBunny()
  if (bunny === 'mal_posee') {
    return { ok: false, erreur: 'config', detail: 'BUNNY_PDF_HOTE ou BUNNY_PDF_CLE_JETON absente ou mal formee (l autre est posee)' }
  }
  if (bunny !== 'absente') {
    const lien = signerPdf(fichier, bunny, { dureeSecondes: DUREE_URL_RESSOURCE_S, maintenantMs })
    if (!lien) return { ok: false, erreur: 'introuvable', detail: 'chemin mal forme' }
    return { ok: true, url: lien.url, expireLe: lien.expireLe, source: 'bunny' }
  }

  // Repli : Supabase Storage (bascule en cours).
  const s = clientStockage()
  if (!s) {
    return { ok: false, erreur: 'config', detail: 'ni BUNNY_PDF_HOTE et BUNNY_PDF_CLE_JETON, ni NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY' }
  }
  try {
    const { data, error } = await s.storage.from(BUCKET_RESSOURCES).createSignedUrl(fichier, DUREE_URL_RESSOURCE_S)
    if (error || !data?.signedUrl) {
      if (estIntrouvable(error)) return { ok: false, erreur: 'introuvable' }
      return { ok: false, erreur: 'indisponible', detail: error?.name ?? 'reponse vide' }
    }
    return {
      ok: true,
      url: data.signedUrl,
      expireLe: new Date(maintenantMs + DUREE_URL_RESSOURCE_S * 1000).toISOString(),
      source: 'supabase',
    }
  } catch (err) {
    return { ok: false, erreur: 'indisponible', detail: err instanceof Error ? err.name : 'erreur' }
  }
}
