/**
 * ESSAI de la migration 20261031223000_kit_abonnements.sql contre la vraie
 * base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. 20261031211000 (communications, non appliquee a ce jour) puis la
 *      migration, jouee deux fois (rejouable) ;
 *   2. structure : RLS active et forcee, aucune policy, aucun droit pour anon
 *      ni authenticated (et un select sous authenticated est refuse) ;
 *   3. le VRAI depot du journal (src/lib/kit-abonnements-depot.ts) joue sur
 *      la transaction : adresse des communications, lien, relien, abonne deja
 *      lie a un autre compte refuse sans erreur, journal des consentements ;
 *   4. les contraintes refusent ce qu'elles doivent refuser (savepoints).
 * Ids Kit fictifs (99000000000x). Puis la transaction est annulee, et on
 * verifie hors transaction que rien n'est reste. Aucune adresse affichee.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env scripts/essayer-migration-kit-abonnements.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { depotPrisma } from '../src/lib/kit-abonnements-depot.ts'

const DOSSIER = '../../../sites/Aoknowledgecom/supabase/migrations/'
const COMMUNICATIONS = new URL(DOSSIER + '20261031211000_profile_emails_communications.sql', import.meta.url)
const MIGRATION = new URL(DOSSIER + '20261031223000_kit_abonnements.sql', import.meta.url)

/** Decoupe sur les points-virgules, hors blocs $tag$ ... $tag$ (corps de fonctions). */
function decouper(sql) {
  const texte = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  const ordres = []
  let courant = ''
  let tag = null
  for (let i = 0; i < texte.length; i++) {
    if (tag) {
      if (texte.startsWith(tag, i)) { courant += tag; i += tag.length - 1; tag = null; continue }
      courant += texte[i]
      continue
    }
    const d = /^\$[A-Za-z_]*\$/.exec(texte.slice(i))
    if (d) { tag = d[0]; courant += tag; i += tag.length - 1; continue }
    if (texte[i] === ';') { if (courant.trim()) ordres.push(courant.trim()); courant = ''; continue }
    courant += texte[i]
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}

const ordresCommunications = decouper(readFileSync(COMMUNICATIONS, 'utf8'))
const ordres = decouper(readFileSync(MIGRATION, 'utf8'))
class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const un = async (tx, sql, ...p) => (await tx.$queryRawUnsafe(sql, ...p))[0]
const K1 = 990000000001, K2 = 990000000002, K3 = 990000000003

async function refuse(tx, nom, sql, ...p) {
  await tx.$executeRawUnsafe('savepoint essai')
  let refuse = false
  try { await tx.$executeRawUnsafe(sql, ...p) } catch { refuse = true }
  await tx.$executeRawUnsafe('rollback to savepoint essai')
  assert.ok(refuse, `devait etre refuse : ${nom}`)
}

async function refuseSousRole(tx, role, nom, sql) {
  await tx.$executeRawUnsafe('savepoint role')
  await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, JSON.stringify({ role }))
  await tx.$executeRawUnsafe(`set local role ${role}`)
  let refuse = false
  try { await tx.$queryRawUnsafe(sql) } catch { refuse = true }
  await tx.$executeRawUnsafe('rollback to savepoint role')
  await tx.$executeRawUnsafe('reset role')
  assert.ok(refuse, `devait etre refuse a ${role} : ${nom}`)
}

const SQL_TABLES = `select count(to_regclass('public.profile_kit'))::int + count(to_regclass('public.profile_consentements'))::int as n`
const avant = (await un(prisma, SQL_TABLES)).n
console.log(`avant : ${avant} table(s) sur 2, ${ordres.length} ordres (+ ${ordresCommunications.length} de 20261031211000)`)

try {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    for (const o of ordresCommunications) await tx.$executeRawUnsafe(o)
    for (let passe = 1; passe <= 2; passe++) {
      for (const o of ordres) await tx.$executeRawUnsafe(o)
    }
    ok('20261031211000 puis la migration, jouee deux fois')

    // -- structure et droits
    const rls = await tx.$queryRawUnsafe(`select relname::text as t, relrowsecurity as r, relforcerowsecurity as f
      from pg_class where oid in ('public.profile_kit'::regclass, 'public.profile_consentements'::regclass) order by 1`)
    assert.deepEqual(rls, [{ t: 'profile_consentements', r: true, f: true }, { t: 'profile_kit', r: true, f: true }])
    assert.equal((await un(tx, `select count(*)::int as n from pg_policies where schemaname = 'public'
      and tablename in ('profile_kit', 'profile_consentements')`)).n, 0)
    const droits = await un(tx, `select bool_or(has_table_privilege(r, t, p)) as un_droit
      from unnest(array['anon', 'authenticated']) r,
           unnest(array['public.profile_kit', 'public.profile_consentements']) t,
           unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p`)
    assert.equal(droits.un_droit, false)
    await refuseSousRole(tx, 'authenticated', 'lire profile_kit', 'select * from public.profile_kit')
    await refuseSousRole(tx, 'anon', 'lire profile_consentements', 'select * from public.profile_consentements')
    const cascades = await un(tx, `select count(*)::int as n from pg_constraint
      where contype = 'f' and confdeltype = 'c' and confrelid = 'public.profiles'::regclass
        and conrelid in ('public.profile_kit'::regclass, 'public.profile_consentements'::regclass)`)
    assert.equal(cascades.n, 2)
    ok('RLS active et forcee, aucune policy, aucun droit anon ni authenticated, cascade depuis profiles')

    // -- le vrai depot du journal, sur la transaction
    const depot = depotPrisma(tx)
    const p = (await un(tx, `select pe.profile_id::text as id from public.profile_emails pe
      where pe.is_primary and pe.verified order by pe.created_at limit 1`)).id
    const q = (await un(tx, `select pe.profile_id::text as id from public.profile_emails pe
      where pe.is_primary and pe.verified and pe.profile_id <> $1::uuid order by pe.created_at limit 1`, p)).id
    const principale = (await un(tx, `select email from public.profile_emails where profile_id = $1::uuid and is_primary`, p)).email
    assert.ok((await depot.adresse(p)) === principale, 'adresse des communications : la principale attendue')
    const prenom = await depot.prenom(p)
    assert.ok(prenom === null || typeof prenom === 'string')
    ok('depot : adresse des communications (aok_email_communications) et prenom')

    assert.equal(await depot.lien(p), null)
    assert.equal(await depot.lier(p, K1), true)
    assert.equal(await depot.lien(p), K1)
    assert.equal(await depot.lier(p, K2), true)
    assert.equal(await depot.lien(p), K2)
    assert.equal((await un(tx, `select count(*)::int as n from public.profile_kit where profile_id = $1::uuid`, p)).n, 1)
    ok('depot : lier puis relier (un seul lien par compte)')
    assert.equal(await depot.lier(q, K2), false)
    assert.equal(await depot.lien(q), null)
    assert.equal(await depot.lier(q, K3), true)
    ok('depot : un abonne deja lie a un autre compte est refuse, sans erreur ni effet')

    await depot.consentir(p, [
      { type: 'newsletter_hebdo', tag: 25238321, valeur: true, source: 'mon_espace', kitId: K2 },
      { type: 'partenaires', tag: 25238324, valeur: false, source: 'changement_adresse', kitId: K2 },
    ])
    const lignes = await tx.$queryRawUnsafe(`select type, kit_tag_id::text as tag, valeur, source, kit_abonne_id::text as k
      from public.profile_consentements where profile_id = $1::uuid order by id`, p)
    assert.deepEqual(lignes, [
      { type: 'newsletter_hebdo', tag: '25238321', valeur: true, source: 'mon_espace', k: String(K2) },
      { type: 'partenaires', tag: '25238324', valeur: false, source: 'changement_adresse', k: String(K2) },
    ])
    ok('depot : journal des consentements (type, tag, valeur, source, abonne)')

    await depot.delier(p)
    assert.equal(await depot.lien(p), null)
    ok('depot : delier')

    // -- contraintes
    await refuse(tx, 'id Kit nul ou negatif', `insert into public.profile_kit (profile_id, kit_abonne_id) values ($1::uuid, 0)`, p)
    await refuse(tx, 'meme abonne sur deux comptes', `insert into public.profile_kit (profile_id, kit_abonne_id) values ($1::uuid, $2)`, p, K3)
    await refuse(tx, 'type illisible', `insert into public.profile_consentements (profile_id, type, valeur, source) values ($1::uuid, 'Promo !', true, 'mon_espace')`, p)
    await refuse(tx, 'source inconnue', `insert into public.profile_consentements (profile_id, type, valeur, source) values ($1::uuid, 'partenaires', true, 'formulaire')`, p)
    await tx.$executeRawUnsafe(`insert into public.profile_consentements (profile_id, type, valeur, source) values ($1::uuid, 'essai_choix', true, 'bascule')`, p)
    ok('contraintes : id Kit, unicite, type, source refusent ; un choix de plus passe sans migration')

    throw new Annulation()
  }, { timeout: 60000 })
} catch (e) {
  const masquer = t => String(t).replace(/[^\s@'"()<>=,]+@[^\s@'"()<>=,]+/g, '<adresse>')
  if (!(e instanceof Annulation)) { console.error('ECHEC :', masquer(e.message)); await prisma.$disconnect(); process.exit(1) }
}

assert.equal((await un(prisma, SQL_TABLES)).n, avant)
assert.equal((await un(prisma, `select count(*)::int as n from information_schema.columns
  where table_schema = 'public' and table_name = 'profile_emails' and column_name = 'communications'`)).n, 0)
ok('transaction annulee : base inchangee (ni tables, ni colonne communications)')
console.log(`\n${etapes} etapes ok`)
await prisma.$disconnect()
