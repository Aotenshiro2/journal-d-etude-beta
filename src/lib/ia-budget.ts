// Budget IA par membre, en euros, sur fenêtre glissante de 30 jours.
//
// Pourquoi en euros et pas en nombre de captures (décision Brice, 30/08/2026) :
//  1. une capture d'article court et une capture d'écran de plateforme avec
//     screenshot ne coûtent pas la même chose, du simple au triple ;
//  2. un budget en euros survit au changement de modèle — « 1,40 € » veut dire
//     la même chose sur Opus, Sonnet ou Haiku, alors qu'un plafond en captures
//     doit être recalculé à chaque bascule.
//
// Pourquoi une fenêtre GLISSANTE et pas le mois calendaire : une remise à zéro
// le 1er crée un pic le 2 et une frustration le 30. Trente jours cale aussi sur
// le rythme auquel l'argent du Live Club rentre (virement mensuel de Mélanie),
// donc sur le cashflow réel plutôt que sur un calendrier.
//
// Le contrôle se fait AVANT l'appel, sur la dépense PASSÉE : on ne peut pas
// connaître le coût d'une capture avant de l'avoir faite. Dépassement maximal
// d'un appel, quelques millièmes d'euro, négligeable.
import { prisma } from './db'
import { formaterEuros } from './ia-prix'
import type { NiveauIA } from './ia-niveau'

const JOURS_FENETRE = 30

function euros(v: string | undefined, defaut: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) : Math.round(defaut * 1_000_000)
}

/** Budgets par palier, en micro-euros. Valeurs de configuration, pas
 *  constantes : Brice les change après les premiers relevés sans redéployer. */
export const BUDGET_MICROS: Record<Exclude<NiveauIA, 'aucun'>, number> = {
  club: euros(process.env.IA_BUDGET_CLUB, 4.0),
  premium: euros(process.env.IA_BUDGET_PREMIUM, 1.4),
  libre: euros(process.env.IA_BUDGET_LIBRE, 0.25),
}

/** Plafond global du niveau libre sur la même fenêtre. Au-delà, le gratuit
 *  repasse en heuristiques. C'est la protection qu'on ne construit jamais
 *  avant de s'être fait surprendre une fois. */
export const PLAFOND_GLOBAL_LIBRE_MICROS = euros(process.env.IA_PLAFOND_GLOBAL_LIBRE, 50)

/** Comptes maison, jamais plafonnés (décision Brice, 30/08/2026). C'est lui qui
 *  paie la facture : se faire couper par son propre garde-fou en plein test
 *  n'aurait aucun sens.
 *
 *  L'exemption porte UNIQUEMENT sur le blocage. La consommation reste
 *  intégralement enregistrée dans AiUsage : sans ça il perdrait de vue ce que
 *  son propre usage coûte, et c'est justement le chiffre qui sert à régler les
 *  budgets des autres.
 *
 *  Surchargeable par `IA_COMPTES_SANS_PLAFOND` (emails séparés par des
 *  virgules) sans redéployer. */
const SANS_PLAFOND: Set<string> = new Set(
  (process.env.IA_COMPTES_SANS_PLAFOND ?? 'brice.d@aoknowledge.com')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
)

export function estSansPlafond(email: string | null | undefined): boolean {
  return Boolean(email && SANS_PLAFOND.has(email.toLowerCase().trim()))
}

function debutFenetre(): Date {
  return new Date(Date.now() - JOURS_FENETRE * 24 * 3600 * 1000)
}

/** Dépense d'un membre sur la fenêtre, en micro-euros. */
export async function depenseMembreMicros(userId: string): Promise<number> {
  const r = await prisma.aiUsage.aggregate({
    _sum: { costMicros: true },
    where: { userId, createdAt: { gte: debutFenetre() } },
  })
  return r._sum.costMicros ?? 0
}

/** Dépense cumulée de tout le niveau libre sur la fenêtre. */
export async function depenseGlobaleLibreMicros(): Promise<number> {
  const r = await prisma.aiUsage.aggregate({
    _sum: { costMicros: true },
    where: { niveau: 'libre', createdAt: { gte: debutFenetre() } },
  })
  return r._sum.costMicros ?? 0
}

export interface EtatBudget {
  autorise: boolean
  /** motif de refus, exploitable par le client pour choisir son message */
  motif: 'ok' | 'budget_membre_epuise' | 'plafond_global_atteint'
  plafondMicros: number
  depenseMicros: number
  restantMicros: number
  /** part du budget déjà consommée, 0 à 1 — c'est ce qu'on montre à l'élève.
   *  Jamais d'euros dans l'interface : lui montrer le prix de son propre
   *  travail d'étude est le meilleur moyen de le faire arrêter de documenter. */
  part: number
  message: string | null
  /** compte maison : jamais bloqué, et l'interface n'a pas de jauge à montrer */
  sansPlafond: boolean
}

export async function verifierBudget(
  userId: string,
  niveau: NiveauIA,
  email?: string | null
): Promise<EtatBudget> {
  if (niveau === 'aucun') {
    return {
      autorise: false, motif: 'budget_membre_epuise',
      plafondMicros: 0, depenseMicros: 0, restantMicros: 0, part: 1,
      sansPlafond: false,
      message: 'Cet accès est réservé aux membres.',
    }
  }

  // Compte maison : on ne bloque jamais, mais on continue de tout enregistrer.
  if (estSansPlafond(email)) {
    const depense = await depenseMembreMicros(userId)
    return {
      autorise: true, motif: 'ok',
      plafondMicros: 0, depenseMicros: depense, restantMicros: Number.POSITIVE_INFINITY,
      part: 0, sansPlafond: true, message: null,
    }
  }

  const plafondMicros = BUDGET_MICROS[niveau]
  const depenseMicros = await depenseMembreMicros(userId)
  const restantMicros = Math.max(0, plafondMicros - depenseMicros)
  const part = plafondMicros > 0 ? Math.min(1, depenseMicros / plafondMicros) : 1

  if (depenseMicros >= plafondMicros) {
    return {
      autorise: false, motif: 'budget_membre_epuise',
      plafondMicros, depenseMicros, restantMicros, part, sansPlafond: false,
      message: 'Tu as atteint ton quota IA des 30 derniers jours. La capture continue de fonctionner sans IA, et ton quota se recharge au fil des jours.',
    }
  }

  // Le plafond global ne s'applique qu'au niveau libre : les payants ont déjà
  // payé, on ne les coupe pas parce que des gratuits ont beaucoup consommé.
  if (niveau === 'libre') {
    const global = await depenseGlobaleLibreMicros()
    if (global >= PLAFOND_GLOBAL_LIBRE_MICROS) {
      return {
        autorise: false, motif: 'plafond_global_atteint',
        plafondMicros, depenseMicros, restantMicros, part, sansPlafond: false,
        message: 'La capture IA offerte est momentanément saturée. Elle revient au fil des jours, et la capture classique fonctionne toujours.',
      }
    }
  }

  return {
    autorise: true, motif: 'ok',
    plafondMicros, depenseMicros, restantMicros, part, sansPlafond: false, message: null,
  }
}

/** Pour les journaux serveur uniquement — jamais renvoyé au client. */
export function resumeBudget(e: EtatBudget): string {
  if (e.sansPlafond) return `${formaterEuros(e.depenseMicros)} / sans plafond`
  return `${formaterEuros(e.depenseMicros)} / ${formaterEuros(e.plafondMicros)} (${Math.round(e.part * 100)} %)`
}
