/**
 * Prouve que cockpit_litiges (20261017233000) se lit par l'equipe du cockpit
 * et par personne d'autre, et que son paiement_id retombe sur cockpit_paiements.
 *
 * Meme methode que verifier-fonds-rls.mjs : dans une transaction ANNULEE, on
 * prend le role `authenticated` (ou `anon`) avec un `sub` choisi. Rien n'est ecrit.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/verifier-litiges-rls.mjs
 *
 * Sort en code 1 au premier ecart.
 */

import { PrismaClient } from '@prisma/client'

const INCONNU = '00000000-0000-4000-8000-000000000001'
const prisma = new PrismaClient()

async function lireComme(role, uuid) {
  let resultat
  await prisma
    .$transaction(async (tx) => {
      const claims = JSON.stringify(uuid ? { sub: uuid, role } : { role })
      await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', '${claims}', true)`)
      await tx.$executeRawUnsafe(`set local role ${role}`)
      try {
        const r = await tx.$queryRawUnsafe('select count(*)::int as n from public.cockpit_litiges')
        resultat = { lu: true, lignes: r[0].n }
      } catch (e) {
        resultat = { lu: false, motif: String(e.message).split('\n').find((l) => l.includes('permission')) ?? 'refus' }
      }
      throw new Error('__rollback__')
    })
    .catch((e) => {
      if (!String(e.message).includes('__rollback__')) throw e
    })
  return resultat
}

async function main() {
  let ecarts = 0
  const total = (await prisma.$queryRawUnsafe('select count(*)::int as n from public.cockpit_litiges'))[0].n
  const parCompte = await prisma.$queryRawUnsafe(
    'select compte, count(*)::int as n from public.cockpit_litiges group by compte order by compte')
  console.log(`En base (proprietaire) : ${total} litige(s)`, parCompte.map((r) => `${r.compte}=${r.n}`).join(' '))

  const orphelins = await prisma.$queryRawUnsafe(
    `select l.litige_id from public.cockpit_litiges l
     left join public.cockpit_paiements p on p.paiement_id = l.paiement_id
     where p.paiement_id is null`)
  const exemple = await prisma.$queryRawUnsafe(
    `select left(paiement_id, 10) as debut from public.cockpit_paiements where source = 'stripe' limit 1`)
  console.log(`Format cockpit_paiements.paiement_id (Stripe) : ${exemple[0]?.debut}...`)
  if (orphelins.length) {
    ecarts += 1
    console.log(`  X  ${orphelins.length} litige(s) sans paiement correspondant dans cockpit_paiements`)
  } else {
    console.log('  ok chaque litige retombe sur un paiement de cockpit_paiements')
  }

  const membre = (await prisma.$queryRawUnsafe('select user_id::text as id from public.cockpit_allowlist limit 1'))[0]
  const m = await lireComme('authenticated', membre.id)
  if (m.lu && m.lignes === total) console.log(`  ok membre du cockpit : ${m.lignes} ligne(s) lues`)
  else { ecarts += 1; console.log('  X  membre du cockpit :', m) }

  const i = await lireComme('authenticated', INCONNU)
  if (!i.lu || i.lignes === 0) console.log(`  ok authentifie hors allowlist : ${i.lu ? '0 ligne (RLS)' : i.motif}`)
  else { ecarts += 1; console.log(`  X  authentifie hors allowlist : ${i.lignes} ligne(s) LUES - FUITE`) }

  const a = await lireComme('anon', null)
  if (!a.lu) console.log(`  ok anon : refuse (${a.motif.trim().slice(0, 80)})`)
  else { ecarts += 1; console.log(`  X  anon : ${a.lignes} ligne(s) lisibles`) }

  await prisma.$disconnect()
  process.exit(ecarts ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
