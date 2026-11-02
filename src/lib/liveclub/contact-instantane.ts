// LES MEMBRES A CONTACTER, CALCULES UNE FOIS PAR JOUR (02/11/2026) : cote
// serveur. La regle et le pourquoi : contact-instantane-pur.ts. La migration :
// 20261102150000_cockpit_membres_contact_instantane.sql.
//
// - sourcesAContacter(db) : le suffixe a coller a cockpit_membres_risque et a
//   cockpit_membres_a_venir, '_instantane' si l'instantane est la et frais,
//   '' (la vue en direct) sinon. Deux petites lectures, sans jamais toucher
//   une relation absente (to_regclass d'abord) : sur une transaction, une
//   erreur annulerait tout le reste.
// - recalculerAContacter(db, par) : refait l'instantane (passage quotidien du
//   Live Club, juste avant le relais et le resume). Fonction absente (migration
//   pas encore passee) : rien, sans erreur.

import type { Prisma } from '@prisma/client'
import { suffixeSource, SUFFIXE_INSTANTANE } from './contact-instantane-pur'

type Lecteur = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>

export type SourcesAContacter = {
  risque: '' | typeof SUFFIXE_INSTANTANE
  aVenir: '' | typeof SUFFIXE_INSTANTANE
}

const VUES = ['cockpit_membres_risque', 'cockpit_membres_a_venir'] as const

export async function sourcesAContacter(db: Lecteur, maintenant: number = Date.now()): Promise<SourcesAContacter> {
  const direct: SourcesAContacter = { risque: '', aVenir: '' }
  try {
    const [t] = await db.$queryRawUnsafe<{ meta: boolean; risque: boolean; a_venir: boolean }[]>(`
      select to_regclass('public.cockpit_instantanes') is not null as meta,
        to_regclass('public.cockpit_membres_risque_instantane') is not null as risque,
        to_regclass('public.cockpit_membres_a_venir_instantane') is not null as a_venir`)
    if (!t?.meta) return direct
    const lignes = await db.$queryRawUnsafe<{ nom: string; calcule_le: Date }[]>(
      `select nom, calcule_le from public.cockpit_instantanes where nom = any($1::text[])`, [...VUES])
    const quand = new Map(lignes.map(l => [l.nom, l.calcule_le]))
    return {
      risque: suffixeSource({ existe: t.risque, calculeLe: quand.get('cockpit_membres_risque') ?? null }, maintenant),
      aVenir: suffixeSource({ existe: t.a_venir, calculeLe: quand.get('cockpit_membres_a_venir') ?? null }, maintenant),
    }
  } catch (err) {
    console.warn(`[liveclub/contact-instantane] etat illisible, vues en direct : ${(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 160)}`)
    return direct
  }
}

export type BilanRecalcul = { etat: 'fait' | 'recent' | 'en_cours' | 'fonction_absente'; risque: number; a_venir: number }

export async function recalculerAContacter(db: Lecteur, par: string): Promise<BilanRecalcul> {
  const [f] = await db.$queryRawUnsafe<{ ok: boolean }[]>(
    `select to_regprocedure('public.cockpit_membres_contact_recalculer(text)') is not null as ok`)
  if (!f?.ok) return { etat: 'fonction_absente', risque: 0, a_venir: 0 }
  const [r] = await db.$queryRawUnsafe<{ r: { recalcule?: boolean; raison?: string; risque?: number; a_venir?: number } | null }[]>(
    `select public.cockpit_membres_contact_recalculer($1::text) as r`, par)
  const b = r?.r ?? {}
  if (!b.recalcule) return { etat: b.raison === 'en_cours' ? 'en_cours' : 'recent', risque: 0, a_venir: 0 }
  return { etat: 'fait', risque: Number(b.risque ?? 0), a_venir: Number(b.a_venir ?? 0) }
}
