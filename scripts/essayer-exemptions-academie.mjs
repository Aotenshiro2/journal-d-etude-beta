/**
 * ESSAI des exemptions du Live Club dans les droits de l'academie (26/10/2026,
 * migration 20261026100000_cockpit_liveclub_exemptions_email.sql, deja
 * appliquee) contre la vraie base, dans UNE transaction TOUJOURS ANNULEE
 * (rien ne reste).
 *
 * Joue la requete EXACTE de droitsAcademie (SQL_FAITS_COCKPIT,
 * src/lib/academie/requetes.ts) sur des exemptions de test (emails en
 * exemple.invalid, telegram_id tires au hasard) :
 *   - active par la colonne email : oui (majuscules comprises) ;
 *   - retiree, expiree : non ;
 *   - par membre_id : non tant que l'email n'est pas celui du membre, oui
 *     ensuite (un membre reel sans exemption, un email de test ajoute).
 *
 * Lancement (depuis apps/journal-d-etude, avec le .env charge) :
 *   node scripts/essayer-exemptions-academie.mjs
 * N'affiche aucun email ni aucune cle.
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import * as R from '../src/lib/academie/requetes.ts'

const p = new PrismaClient()
const ANNULER = new Error('annulation volontaire')
let etapes = 0
const ok = (nom) => { etapes++; console.log(`ok  ${nom}`) }
const MARQUE = randomUUID().slice(0, 8)
const E = (n) => `exempte-${n}-${MARQUE}@exemple.invalid`

try {
  await p.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    const exempte = async (email) => (await tx.$queryRawUnsafe(R.SQL_FAITS_COCKPIT, [email]))[0].exempte
    const tg = () => 9_000_000_000_000 + Math.floor(Math.random() * 1e9)
    const poser = (email, membreId, jusquau, retire) => tx.$executeRawUnsafe(`
      insert into public.cockpit_liveclub_exemptions (telegram_id, membre_id, email, motif, jusquau, pose_par, retire_le)
      values ($1::bigint, $2::uuid, $3::text, 'favorise', $4::date, $5::uuid, $6::timestamptz)`,
      tg(), membreId, email, jusquau, randomUUID(), retire ? new Date() : null)

    assert.equal(await exempte(E('inconnu')), false)
    ok('email sans exemption : non')

    await poser(E('active'), null, null, false)
    await poser(E('majuscules').toUpperCase(), null, '2999-12-31', false)
    assert.equal(await exempte(E('active')), true)
    assert.equal(await exempte(E('majuscules')), true)
    ok('exemption active par la colonne email (permanente, ou datee) : oui, majuscules comprises')

    await poser(E('retiree'), null, null, true)
    await poser(E('expiree'), null, '2000-01-01', false)
    assert.equal(await exempte(E('retiree')), false)
    assert.equal(await exempte(E('expiree')), false)
    ok('exemption retiree ou expiree : non')

    const membre = (await tx.$queryRawUnsafe(`
      select m.membre_id::text as id from public.cockpit_membres m
       where not exists (select 1 from public.cockpit_liveclub_exemptions x where x.membre_id = m.membre_id)
       limit 1`))[0]?.id
    assert.ok(membre, 'aucun membre sans exemption pour l essai')
    await tx.$executeRawUnsafe(`insert into public.cockpit_membre_emails (email, membre_id) values ($1::text, $2::uuid)`, E('membre'), membre)
    assert.equal(await exempte(E('membre')), false)
    await poser(null, membre, null, false)
    assert.equal(await exempte(E('membre')), true)
    assert.equal(await exempte(E('autre')), false)
    ok('exemption par membre_id : oui par un email du membre, non sinon')

    throw ANNULER
  }, { timeout: 30000 })
} catch (err) {
  if (err !== ANNULER) { await p.$disconnect(); throw err }
}

const restes = await p.$queryRawUnsafe(
  `select count(*)::int as n from public.cockpit_liveclub_exemptions where email like $1`, `%-${MARQUE}@exemple.invalid`)
assert.equal(restes[0].n, 0)
ok('transaction annulee : aucune exemption de test ne reste')
await p.$disconnect()
console.log(`\n${etapes} etapes OK`)
