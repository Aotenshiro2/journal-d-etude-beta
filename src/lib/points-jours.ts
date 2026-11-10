// LES POINTS PAR JOUR, RAFRAICHIS UNE FOIS PAR JOUR (09/11/2026) : cote
// serveur. La migration : 20261109234000_aok_points_jours.sql du workspace.
//
// La table aok_points_jours garde l'activite de chaque compte jour par jour
// (lecons, notes, messages, en nombres bruts), lue par le classement Activite
// de l'academie (aok_classement) : 50 ms par appel au lieu de 5 s.
// aok_points_jours_rafraichir la remplit avec la regle de Mon espace
// (aok_activite_par_jour) : seulement les comptes touches depuis le dernier
// passage, et seulement leurs jours changes ; complet au premier passage et une
// fois par semaine.
//
// - rafraichirPointsJours(db, par, complet) : appele par le passage quotidien
//   du Live Club (cron Vercel, 7 h UTC), comme l'instantane des membres a
//   contacter. Fonction absente (migration pas encore passee) : rien, sans
//   erreur. Un passage deja en cours : 'en_cours', rien d'autre.
// Recalcul complet a la main : scripts/rafraichir-points-jours.mjs --complet.
// Le bilan ne porte que des nombres.

import type { Prisma } from '@prisma/client'

type Lecteur = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>

export type BilanPointsJours = {
  etat: 'fait' | 'en_cours' | 'fonction_absente'
  complet: boolean
  /** incremental, premier, hebdomadaire ou demande. */
  raison: string | null
  comptes: number
  recalcules: number
  jours_ecrits: number
  jours_retires: number
  duree_ms: number
}

type Retour = {
  fait?: boolean; complet?: boolean; raison?: string; comptes?: number; recalcules?: number
  jours_ecrits?: number; jours_retires?: number; duree_ms?: number
}

export async function rafraichirPointsJours(db: Lecteur, par: string, complet = false): Promise<BilanPointsJours> {
  const rien = { complet: false, raison: null, comptes: 0, recalcules: 0, jours_ecrits: 0, jours_retires: 0, duree_ms: 0 }
  const [f] = await db.$queryRawUnsafe<{ ok: boolean }[]>(
    `select to_regprocedure('public.aok_points_jours_rafraichir(boolean,text)') is not null as ok`)
  if (!f?.ok) return { etat: 'fonction_absente', ...rien }
  const [r] = await db.$queryRawUnsafe<{ r: Retour | null }[]>(
    `select public.aok_points_jours_rafraichir($1::boolean, $2::text) as r`, complet, par)
  const b = r?.r ?? {}
  if (!b.fait) return { etat: 'en_cours', ...rien }
  return {
    etat: 'fait',
    complet: Boolean(b.complet),
    raison: b.raison ?? null,
    comptes: Number(b.comptes ?? 0),
    recalcules: Number(b.recalcules ?? 0),
    jours_ecrits: Number(b.jours_ecrits ?? 0),
    jours_retires: Number(b.jours_retires ?? 0),
    duree_ms: Number(b.duree_ms ?? 0),
  }
}
