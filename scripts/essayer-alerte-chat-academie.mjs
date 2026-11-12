/**
 * ESSAI de la garde contre les rafales de l'alerte du salon (12/11/2026 soir,
 * SQL_ALERTE_PERMISE de src/lib/academie/chat-academie.ts) : au plus une alerte
 * par auteur toutes les 10 minutes.
 *   1. Contre la VRAIE table, en lecture seule : la requete se compile sur le
 *      schema en ligne, un message inconnu ne donne pas d'alerte.
 *   2. Sa logique, sur une table TEMPORAIRE de meme forme (pg_temp), dans une
 *      transaction toujours annulee : aucune ligne de la base n'est ecrite.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/essayer-alerte-chat-academie.mjs
 */

import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { FENETRE_ALERTE_MIN, SQL_ALERTE_PERMISE } from '../src/lib/academie/chat-academie.ts'

class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }

// 1. La vraie table, en lecture seule.
try {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('set transaction read only')
    const r = await tx.$queryRawUnsafe(SQL_ALERTE_PERMISE, '00000000-0000-4000-8000-000000000000', FENETRE_ALERTE_MIN)
    assert.equal(r[0].permise, false)
    throw new Annulation()
  })
} catch (e) { if (!(e instanceof Annulation)) throw e }
ok('vraie table (lecture seule) : la requete se compile, un message inconnu ne donne pas d alerte')

// 2. La logique, sur une table temporaire.
const SQL = SQL_ALERTE_PERMISE.replaceAll('public.aok_chat_messages', 'pg_temp.essai_chat')
assert.ok(!SQL.includes('public.'), 'aucune table de la base dans la version d essai')
const U1 = 'a0000000-0000-4000-8000-000000000001'
const U2 = 'a0000000-0000-4000-8000-000000000002'
const id = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
try {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`create temp table essai_chat (id uuid primary key, user_id uuid not null, cree_le timestamptz not null) on commit drop`)
    const poser = (n, u, minutes) => tx.$executeRawUnsafe(
      `insert into pg_temp.essai_chat values ($1::uuid, $2::uuid, timestamptz '2026-11-12 20:00:00+00' + make_interval(mins => $3::int))`, id(n), u, minutes)
    const permise = async n => (await tx.$queryRawUnsafe(SQL, id(n), FENETRE_ALERTE_MIN))[0].permise
    await poser(1, U1, 0)
    await poser(2, U1, 5)
    await poser(3, U1, 16)
    await poser(4, U1, 26)
    await poser(5, U2, 3)
    // Deux envois au meme instant (cree_le = debut de la transaction) : seul le premier dans l'ordre (cree_le, id).
    await poser(6, U2, 40)
    await poser(7, U2, 40)
    // Une conversation suivie (un message toutes les 9 minutes) : une seule alerte, au debut.
    const U3 = 'a0000000-0000-4000-8000-000000000003'
    await poser(8, U3, 0)
    await poser(9, U3, 9)
    await poser(10, U3, 18)
    assert.equal(await permise(1), true, 'premier message : alerte')
    assert.equal(await permise(2), false, '5 minutes apres : pas de relance')
    assert.equal(await permise(3), true, '11 minutes apres le precedent (16 apres l alerte) : alerte')
    assert.equal(await permise(4), true, '10 minutes pleines apres le precedent : alerte')
    assert.equal(await permise(5), true, 'un autre auteur n est pas retenu')
    assert.equal(await permise(6), true, 'envois simultanes : le premier alerte')
    assert.equal(await permise(7), false, 'envois simultanes : le second non')
    assert.deepEqual([await permise(8), await permise(9), await permise(10)], [true, false, false], 'conversation suivie : une alerte')
    assert.equal(await permise(99), false, 'message inconnu : pas d alerte')
    ok('table temporaire : premier message alerte, la suite dans les 10 minutes non, apres 10 minutes de silence oui, un autre auteur oui, de deux envois simultanes un seul, une conversation suivie une seule fois, inconnu non')
    throw new Annulation()
  })
} catch (e) { if (!(e instanceof Annulation)) throw e }
ok('transaction annulee : la table temporaire est partie avec elle')
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
