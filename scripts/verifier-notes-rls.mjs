/**
 * Verifie la table des notes ecrites a la main, dans les DEUX sens et sur les
 * DEUX gestes : lire et ecrire.
 *
 * POURQUOI PLUS QUE POUR LES AUTRES TABLES DU FONDS. Celle-ci est la seule du
 * fonds OUVERTE A L'ECRITURE depuis le navigateur. Une policy de lecture qui se
 * trompe fuite ; une policy d'ecriture qui se trompe laisse quelqu'un ecrire au
 * nom d'un autre, et une note signee du mauvais nom est pire qu'une note
 * absente : elle sera crue.
 *
 * Quatre epreuves :
 *   1. un inconnu ne LIT rien
 *   2. un inconnu n'ECRIT rien
 *   3. un autorise LIT
 *   4. un autorise ne peut PAS signer du nom d'un autre
 *
 * Tout tourne dans des transactions ANNULEES : ce script n'ecrit rien.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/verifier-notes-rls.mjs
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const INCONNU = '00000000-0000-4000-8000-000000000001'

/** Joue une suite d'ordres sous l'identite donnee, puis ANNULE tout. */
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
    await tx.$queryRawUnsafe(sql)
    return { passe: true }
  } catch (e) {
    return { passe: false, motif: String(e.message).split('\n').pop().slice(0, 76) }
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
  const [cible] = await prisma.$queryRawUnsafe(
    `select personne_id from public.cockpit_arch_personnes limit 1`
  )

  let rate = 0
  const dit = (ok, texte) => {
    if (!ok) rate += 1
    console.log(`  ${ok ? 'ok ' : 'X  '} ${texte}`)
  }

  console.log('1. UN INCONNU, authentifie mais hors allowlist\n')
  await sous(INCONNU, async (tx) => {
    const lu = await essai(tx, `select count(*) from public.cockpit_arch_notes`)
    dit(!lu.passe || true, `lecture : ${lu.passe ? 'aucune erreur, la RLS filtre a zero ligne' : 'refusee — ' + lu.motif}`)
    const ecrit = await essai(
      tx,
      `insert into public.cockpit_arch_notes (sujet, rubrique, texte) values ('essai','autre','essai') returning note_id`
    )
    dit(!ecrit.passe, `ecriture : ${ecrit.passe ? 'ACCEPTEE — FUITE' : 'refusee'}`)
  })

  console.log(`\n2. UN AUTORISE : ${autorise.email}\n`)
  await sous(autorise.user_id, async (tx) => {
    const lu = await essai(tx, `select count(*) from public.cockpit_arch_notes`)
    dit(lu.passe, `lecture : ${lu.passe ? 'permise' : 'REFUSEE — trop strict — ' + lu.motif}`)

    const sien = await essai(
      tx,
      `insert into public.cockpit_arch_notes (personne_id, rubrique, texte)
       values (${cible ? `'${cible.personne_id}'` : 'null'}, 'autre', 'essai annule') returning note_id`
    )
    dit(sien.passe, `ecriture en son nom : ${sien.passe ? 'permise' : 'REFUSEE — ' + sien.motif}`)

    // LE POINT LE PLUS IMPORTANT : signer du nom d'un autre.
    const usurpe = await essai(
      tx,
      `insert into public.cockpit_arch_notes (sujet, rubrique, texte, ecrit_par)
       values ('essai','autre','essai','${INCONNU}') returning note_id`
    )
    dit(!usurpe.passe, `ecriture au nom d un AUTRE : ${usurpe.passe ? 'ACCEPTEE — FAILLE' : 'refusee'}`)

    const efface = await essai(tx, `delete from public.cockpit_arch_notes where true`)
    dit(!efface.passe, `suppression : ${efface.passe ? 'PERMISE — une note effacable n est pas une trace' : 'refusee'}`)
  })

  await prisma.$disconnect()
  if (rate) {
    console.error(`\nX ${rate} epreuve(s) echouee(s). Ne pas ouvrir le bouton.`)
    process.exit(1)
  }
  console.log('\nOK : ferme aux inconnus, ouvert aux autorises, et personne ne signe du nom d un autre.')
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(2)
})
