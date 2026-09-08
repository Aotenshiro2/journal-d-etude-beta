/**
 * Prouve que le fonds d'archive est FERME a un compte authentifie hors
 * allowlist — et ouvert a un compte qui a `acces_fonds`.
 *
 * POURQUOI CE SCRIPT EXISTE, ET POURQUOI audit-rls.mjs NE SUFFIT PAS.
 * `audit-rls.mjs` juge la CONFIGURATION : les policies, les grants, la
 * definition des vues. Il se connecte en proprietaire, donc il passe outre la
 * RLS et ne mesure jamais ce qu'un visiteur voit reellement. Une policy qu'on
 * n'a pas rejouee depuis un compte non autorise n'est pas une policy, c'est
 * une intention.
 *
 * COMMENT. On rejoue exactement ce que fait PostgREST : dans une transaction,
 * on prend le role `authenticated` et on pose un JWT dont le `sub` est un UUID
 * quelconque. La transaction est ANNULEE a la fin : ce script n'ecrit rien.
 *
 * Le projet Supabase est partage avec aoknowledge.com, a inscription publique.
 * N'importe qui peut donc devenir `authenticated` en trois clics. C'est
 * exactement le visiteur qu'on simule ici.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/verifier-fonds-rls.mjs
 *
 * Sort en code 1 des qu'une table du fonds laisse passer une lecture.
 */

import { PrismaClient } from '@prisma/client'

const TABLES = [
  'cockpit_arch_personnes',
  'cockpit_arch_salons',
  'cockpit_arch_presences',
]

// Un UUID qui n'est dans aucune allowlist. On ne cree AUCUN compte : on se
// contente d'affirmer une identite, ce qui suffit a la RLS pour trancher.
const INCONNU = '00000000-0000-4000-8000-000000000001'

const prisma = new PrismaClient()

async function lireCommeAuthentifie(uuid) {
  const resultats = {}
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `select set_config('request.jwt.claims', '{"sub":"${uuid}","role":"authenticated"}', true)`
      )
      await tx.$executeRawUnsafe(`set local role authenticated`)
      for (const t of TABLES) {
        try {
          const r = await tx.$queryRawUnsafe(
            `select count(*)::int as n from public.${t}`
          )
          resultats[t] = { lu: true, lignes: r[0].n }
        } catch (e) {
          resultats[t] = { lu: false, motif: String(e.message).split('\n')[0].slice(0, 90) }
        }
      }
      // On annule TOUT : ce script ne laisse aucune trace en base.
      throw new Error('__rollback__')
    })
    .catch((e) => {
      if (!String(e.message).includes('__rollback__')) throw e
    })
  return resultats
}

async function main() {
  console.log('Lecture depuis un compte AUTHENTIFIE mais HORS allowlist')
  console.log(`  identite simulee : ${INCONNU}\n`)

  const r = await lireCommeAuthentifie(INCONNU)
  let fuite = 0
  for (const t of TABLES) {
    const x = r[t]
    if (x.lu && x.lignes > 0) {
      fuite += 1
      console.log(`  X  ${t.padEnd(26)} ${x.lignes} ligne(s) LUES — FUITE`)
    } else if (x.lu) {
      console.log(`  ok ${t.padEnd(26)} 0 ligne — la RLS filtre`)
    } else {
      console.log(`  ok ${t.padEnd(26)} refuse — ${x.motif}`)
    }
  }

  // Contre-epreuve : le portail rend-il bien false pour cet inconnu ?
  const portail = await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `select set_config('request.jwt.claims', '{"sub":"${INCONNU}","role":"authenticated"}', true)`
      )
      await tx.$executeRawUnsafe(`set local role authenticated`)
      const q = await tx.$queryRawUnsafe(`select public.is_cockpit_fonds() as ok`)
      const v = q[0].ok
      throw Object.assign(new Error('__rollback__'), { valeur: v })
    })
    .catch((e) => {
      if (!String(e.message).includes('__rollback__')) throw e
      return e.valeur
    })
  console.log(`\n  is_cockpit_fonds() pour cet inconnu : ${portail}`)

  const total = await prisma.$queryRawUnsafe(
    `select count(*)::int as n from public.cockpit_allowlist where acces_fonds`
  )
  console.log(`  comptes avec acces_fonds : ${total[0].n}`)

  // CONTRE-EPREUVE. Prouver qu'une porte est fermee ne sert a rien si on n'a
  // pas prouve qu'elle s'OUVRE pour qui de droit : une policy qui refuse tout
  // le monde passerait le premier test avec les honneurs.
  let ouvert = null
  const [autorise] = await prisma.$queryRawUnsafe(
    `select user_id, email from public.cockpit_allowlist where acces_fonds limit 1`
  )
  if (autorise) {
    console.log(`\nContre-epreuve, avec un compte AUTORISE : ${autorise.email}`)
    ouvert = await lireCommeAuthentifie(autorise.user_id)
    for (const t of TABLES) {
      const x = ouvert[t]
      console.log(
        x.lu && x.lignes > 0
          ? `  ok ${t.padEnd(26)} ${x.lignes} ligne(s) — la porte s ouvre`
          : `  X  ${t.padEnd(26)} RIEN — la policy refuse meme les autorises`
      )
    }
  } else {
    console.log('\n(aucun compte n a acces_fonds : contre-epreuve impossible)')
  }

  await prisma.$disconnect()
  if (fuite || portail !== false) {
    console.error('\nX Le fonds n est PAS ferme. Ne rien charger dedans.')
    process.exit(1)
  }
  if (ouvert && TABLES.some((t) => !(ouvert[t].lu && ouvert[t].lignes > 0))) {
    console.error('\nX Ferme pour tous, y compris les autorises. La policy est trop stricte.')
    process.exit(1)
  }
  console.log('\nOK : ferme a un authentifie hors allowlist, ouvert a qui de droit.')
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(2)
})
