import { Prisma, type PrismaClient } from '@prisma/client'

/** Une journée de compteurs, déjà validée par l'appelant. */
export interface LigneActivite {
  jour: string // 'AAAA-MM-JJ'
  ecrits: number
  mentor: number
  trades: number
  jugements: number
  consultees: number
}

/**
 * Écrit les compteurs d'activité d'un appareil (table "ActiviteJour").
 * Une seule requête pour tout le lot (le premier envoi porte jusqu'à un an de
 * jours) : tableaux dépliés par unnest, upsert sur (userId, app, appareil,
 * jour). Chaque jour REMPLACE la ligne : miroir, pas cumul. Prend le client en
 * paramètre pour pouvoir tourner dans une transaction (essai annulé).
 */
export async function ecrireActivite(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  app: string,
  appareil: string,
  lignes: LigneActivite[]
): Promise<number> {
  if (lignes.length === 0) return 0
  return db.$executeRaw(Prisma.sql`
    INSERT INTO "ActiviteJour" ("userId", "app", "appareil", "jour", "ecrits", "mentor", "trades", "jugements", "consultees", "majLe")
    SELECT ${userId}, ${app}, ${appareil}, x.jour::date, x.ecrits, x.mentor, x.trades, x.jugements, x.consultees, CURRENT_TIMESTAMP
    FROM unnest(
      ${lignes.map(l => l.jour)}::text[],
      ${lignes.map(l => l.ecrits)}::int[],
      ${lignes.map(l => l.mentor)}::int[],
      ${lignes.map(l => l.trades)}::int[],
      ${lignes.map(l => l.jugements)}::int[],
      ${lignes.map(l => l.consultees)}::int[]
    ) AS x(jour, ecrits, mentor, trades, jugements, consultees)
    ON CONFLICT ("userId", "app", "appareil", "jour") DO UPDATE SET
      "ecrits" = EXCLUDED."ecrits",
      "mentor" = EXCLUDED."mentor",
      "trades" = EXCLUDED."trades",
      "jugements" = EXCLUDED."jugements",
      "consultees" = EXCLUDED."consultees",
      "majLe" = CURRENT_TIMESTAMP
  `)
}
