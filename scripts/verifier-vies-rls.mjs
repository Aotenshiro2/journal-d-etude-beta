/**
 * Verifie les trois tables posees le 01/09 : `cockpit_arch_themes`,
 * `cockpit_arch_dits`, `cockpit_arch_vies`.
 *
 * POURQUOI CELLE DES VIES MERITE SA PROPRE EPREUVE. Elle porte des phrases
 * entieres que des tiers ont ecrites sur leur famille, leur argent et leur
 * sante. C'est la table la plus sensible du fonds ; une policy trop large
 * n'expose pas un chiffre, elle expose une confidence.
 *
 * Quatre epreuves par table :
 *   1. un inconnu authentifie ne LIT rien
 *   2. un autorise LIT
 *   3. personne n'ECRIT (ce sont des tables de donnees : le fichier decide)
 *   4. personne n'EFFACE
 *
 * Tout tourne dans des transactions ANNULEES : ce script n'ecrit rien.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/verifier-vies-rls.mjs
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const INCONNU = '00000000-0000-4000-8000-000000000001'
const TABLES = ['cockpit_arch_themes', 'cockpit_arch_dits', 'cockpit_arch_vies']

async function sous(uuid, travail) {
  let sortie
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `select set_config('request.jwt.claims', '{"sub":"${uuid}","role":"authenticated"}', true)`
      )
      await tx.$executeRawUnsafe(`set local role authenticated`)
      sortie = await travail(tx)
      throw new Error('__rb__')
    })
    .catch((e) => {
      if (!String(e.message).includes('__rb__')) throw e
    })
  return sortie
}

const essai = async (tx, sql) => {
  try {
    const r = await tx.$queryRawUnsafe(sql)
    return { passe: true, r }
  } catch (e) {
    return { passe: false, motif: String(e.message).split('\n').pop().slice(0, 70) }
  }
}

async function main() {
  const [autorise] = await prisma.$queryRawUnsafe(
    `select user_id, email from public.cockpit_allowlist where acces_fonds limit 1`
  )
  if (!autorise) {
    console.error('Aucun compte avec acces_fonds : rien a verifier.')
    process.exit(1)
  }

  // Le volume vu par le proprietaire, pour comparer avec ce que la RLS laisse
  // passer. Sans ce point de reference, « 0 ligne » ne prouve rien : ca peut
  // vouloir dire que la table est vide.
  const reel = {}
  for (const t of TABLES) {
    const [{ n }] = await prisma.$queryRawUnsafe(`select count(*)::int as n from public.${t}`)
    reel[t] = n
  }
  console.log('Contenu reel (role proprietaire, hors RLS) :')
  for (const t of TABLES) console.log(`   ${t.padEnd(24)} ${reel[t]} lignes`)
  if (Object.values(reel).some((n) => n === 0)) {
    console.error('\nX Une table est vide : lancer push_vies_supabase.py avant de verifier.')
    process.exit(1)
  }

  let rate = 0
  const dit = (ok, texte) => {
    if (!ok) rate += 1
    console.log(`  ${ok ? 'ok ' : 'X  '} ${texte}`)
  }

  console.log('\n1. UN INCONNU, authentifie mais hors allowlist\n')
  await sous(INCONNU, async (tx) => {
    for (const t of TABLES) {
      const lu = await essai(tx, `select count(*)::int as n from public.${t}`)
      const vu = lu.passe ? Number(lu.r[0].n) : -1
      dit(!lu.passe || vu === 0,
        `${t.padEnd(24)} lecture : ${lu.passe ? `${vu} ligne(s) vues sur ${reel[t]}` : 'refusee'}`)
    }
  })

  console.log(`\n2. UN AUTORISE : ${autorise.email}\n`)
  await sous(autorise.user_id, async (tx) => {
    for (const t of TABLES) {
      const lu = await essai(tx, `select count(*)::int as n from public.${t}`)
      const vu = lu.passe ? Number(lu.r[0].n) : -1
      dit(lu.passe && vu === reel[t],
        `${t.padEnd(24)} lecture : ${lu.passe ? `${vu} / ${reel[t]}` : 'REFUSEE — trop strict'}`)
    }
  })

  console.log('\n3. PERSONNE N ECRIT — ce sont des tables de donnees\n')
  for (const [qui, uuid] of [['inconnu', INCONNU], ['autorise', autorise.user_id]]) {
    await sous(uuid, async (tx) => {
      const ins = await essai(
        tx,
        `insert into public.cockpit_arch_themes (theme_id, famille, libelle)
         values ('essai-rls','concept','essai') returning theme_id`
      )
      dit(!ins.passe, `${qui.padEnd(9)} insert themes : ${ins.passe ? 'ACCEPTE — FUITE' : 'refuse'}`)
      const maj = await essai(tx, `update public.cockpit_arch_vies set extrait = 'x' where true`)
      dit(!maj.passe, `${qui.padEnd(9)} update vies   : ${maj.passe ? 'ACCEPTE — FUITE' : 'refuse'}`)
      const del = await essai(tx, `delete from public.cockpit_arch_vies where true`)
      dit(!del.passe, `${qui.padEnd(9)} delete vies   : ${del.passe ? 'ACCEPTE — FUITE' : 'refuse'}`)
    })
  }

  await prisma.$disconnect()
  if (rate) {
    console.error(`\nX ${rate} epreuve(s) echouee(s). Ne pas brancher l'ecran.`)
    process.exit(1)
  }
  console.log('\nOK : ferme aux inconnus, ouvert aux autorises, et en lecture seule pour tous.')
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(2)
})
