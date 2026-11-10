/**
 * Rafraichit A LA MAIN la table des points par jour (aok_points_jours,
 * migration 20261109234000_aok_points_jours.sql). ECRIT EN BASE : a lancer
 * sur l'accord de Brice, comme une migration.
 *
 * Le passage quotidien du Live Club (cron Vercel, 7 h UTC) le fait chaque
 * matin. Ce script sert au PREMIER REMPLISSAGE, juste apres la migration (le
 * script d'application joue une migration dans une transaction Prisma limitee
 * a 5 s, trop courte pour un passage complet), ou a un recalcul complet.
 * Un seul ordre SQL, hors transaction interactive : pas de limite de 5 s.
 *
 *   node --env-file=.env.local scripts/rafraichir-points-jours.mjs             (incremental)
 *   node --env-file=.env.local scripts/rafraichir-points-jours.mjs --complet   (tous les comptes)
 *
 * Rend le bilan de aok_points_jours_rafraichir : des nombres seulement.
 */

import { PrismaClient } from '@prisma/client'

const complet = process.argv.includes('--complet')
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
try {
  const [f] = await prisma.$queryRawUnsafe(`select to_regprocedure('public.aok_points_jours_rafraichir(boolean,text)') is not null as ok`)
  if (!f?.ok) {
    console.error('aok_points_jours_rafraichir absente : appliquer d abord la migration 20261109234000_aok_points_jours.sql.')
    process.exitCode = 2
  } else {
    const [r] = await prisma.$queryRawUnsafe(`select public.aok_points_jours_rafraichir($1::boolean, $2::text) as r`, complet, 'manuel')
    console.log(JSON.stringify(r.r))
    if (!r.r?.fait) process.exitCode = 1
  }
} catch (e) {
  console.error(`echec : ${String(e?.message ?? e).split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300)}`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
