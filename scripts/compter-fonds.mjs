/**
 * Compte ce que le fonds contient VRAIMENT, en base, apres chargement.
 *
 * Se connecte en proprietaire, donc passe outre la RLS : ce script mesure le
 * CONTENU, pas ce qu'un visiteur voit. Pour ca, c'est verifier-fonds-rls.mjs.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/compter-fonds.mjs
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const q = (sql) => prisma.$queryRawUnsafe(sql)

  const [p] = await q('select count(*)::int as n from public.cockpit_arch_personnes')
  const [s] = await q('select count(*)::int as n from public.cockpit_arch_salons')
  const [pr] = await q('select count(*)::int as n from public.cockpit_arch_presences')
  console.log(`${p.n} personnes · ${s.n} salons · ${pr.n} presences\n`)

  console.log('par palier :')
  for (const r of await q(
    `select palier, count(*)::int as n from public.cockpit_arch_personnes
     group by palier order by n desc`
  )) console.log(`  ${String(r.n).padStart(5)}  ${r.palier}`)

  console.log('\npar nature, les dix premieres :')
  for (const r of await q(
    `select nature, count(*)::int as n from public.cockpit_arch_personnes
     group by nature order by n desc limit 10`
  )) console.log(`  ${String(r.n).padStart(5)}  ${r.nature}`)

  console.log('\npar ecosysteme :')
  for (const r of await q(
    `select coalesce(s.ecosysteme, '(non classe)') as eco,
            count(distinct pr.personne_id)::int as gens,
            count(distinct s.salon_id)::int as salons
     from public.cockpit_arch_salons s
     join public.cockpit_arch_presences pr on pr.salon_id = s.salon_id
     group by 1 order by gens desc`
  )) console.log(`  ${String(r.gens).padStart(5)} personnes  ${String(r.salons).padStart(3)} salon(s)  ${r.eco}`)

  console.log('\nla source des dates :')
  for (const r of await q(
    `select entree_source, count(*)::int as n from public.cockpit_arch_presences
     group by entree_source order by n desc`
  )) console.log(`  ${String(r.n).padStart(5)}  ${r.entree_source}`)

  // La question de Brice : cliquer une personne, voir son parcours.
  console.log('\nexemple de parcours — Adil Belka :')
  for (const r of await q(
    `select s.nom, coalesce(s.ecosysteme,'?') as eco, pr.entree, pr.messages
     from public.cockpit_arch_presences pr
     join public.cockpit_arch_salons s on s.salon_id = pr.salon_id
     where pr.personne_id = 'p-adil-belka'
     order by coalesce(pr.entree, '9999-12-31')`
  )) console.log(`  ${(r.entree || '(date inconnue)').toString().slice(0, 10)}  ${r.eco.padEnd(16)} ${r.nom}`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
