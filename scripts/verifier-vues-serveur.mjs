// Les vues gardees relues par leurs fonctions serveur (20/10/2026) : la
// reecriture de avecVuesServeur (pure), puis, si la base est joignable, le
// meme chemin que requete_sql de l'Agent AOK (transaction READ ONLY,
// enveloppe limit 200) : la vue directe rend 0, la requete reecrite rend les lignes.
// set -a; . ./.env; set +a ; node scripts/verifier-vues-serveur.mjs [--sans-base]
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { avecVuesServeur, sourceLecture, VUES_GARDEES } from '../src/lib/vues-serveur.ts'

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }

await bloc('une requete sans vue gardee revient intacte', () => {
  const sql = 'select count(*) from cockpit_paiements'
  assert.equal(avecVuesServeur(sql), sql)
})
await bloc('une vue citee devient un WITH de meme nom, public. retire', () => {
  const r = avecVuesServeur('select count(*) from public.cockpit_support_threads t where t.app = \'telegram\'')
  assert.equal(r, 'with cockpit_support_threads as (select * from public.cockpit_serveur_support_threads()) select count(*) from cockpit_support_threads t where t.app = \'telegram\'')
})
await bloc('un WITH de la requete est fusionne', () => {
  const r = avecVuesServeur('WITH x as (select poste from cockpit_ia_depense_jour) select * from x')
  assert.ok(r.startsWith('with cockpit_ia_depense_jour as (select * from public.cockpit_serveur_ia_depense_jour()), x as ('))
})
await bloc('sourceLecture : fonction pour une vue gardee, table sinon', () => {
  assert.equal(sourceLecture('cockpit_membres_avatar'), 'public.cockpit_serveur_membres_avatar()')
  assert.equal(sourceLecture('AiUsage'), 'public."AiUsage"')
})

if (!process.argv.includes('--sans-base')) {
  const prisma = new PrismaClient()
  try {
    for (const v of VUES_GARDEES) {
      await bloc(`base : ${v}`, async () => {
        const lire = (sql) => prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('set transaction read only')
          return tx.$queryRawUnsafe(`select * from (${sql}) sous_requete limit 200`)
        })
        const direct = await lire(`select count(*)::int as n from ${v}`)
        const reecrit = await lire(avecVuesServeur(`select count(*)::int as n from ${v}`))
        console.log(`    vue directe ${direct[0].n}, par la fonction serveur ${reecrit[0].n}`)
        assert.equal(direct[0].n, 0)
        assert.ok(reecrit[0].n > 0)
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}
console.log(`\n${n} blocs ok`)
