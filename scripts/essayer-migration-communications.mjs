/**
 * ESSAI de la migration 20261031211000_profile_emails_communications.sql
 * contre la vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable), structure et droits ;
 *   2. le choix par le membre (aok_choisir_email_communications, en se faisant
 *      passer pour authenticated) : adresse verifiee acceptee, non verifiee,
 *      inconnue ou d'un autre compte refusee, sans session refusee ;
 *   3. la contrainte et l'index refusent ce qu'ils doivent refuser ;
 *   4. le garde : une adresse cochee qui perd verified perd le choix, sans
 *      faire echouer la mise a jour, et 20261031200000 se rejoue apres ;
 *   5. la lecture serveur (aok_email_communications) : cochee, sinon
 *      principale, sinon adresse de connexion, refusee a anon et authenticated ;
 *   6. une ligne retiree emporte son choix.
 * Les adresses de l'essai sont fictives (exemple.invalid), posees dans la
 * transaction. Puis la transaction est annulee, et on verifie hors transaction
 * que rien n'est reste. Aucune adresse reelle affichee.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env scripts/essayer-migration-communications.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const MIGRATION = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261031211000_profile_emails_communications.sql', import.meta.url)
const MIGRATION_VERIFIED = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261031200000_profile_emails_verified_a_la_confirmation.sql', import.meta.url)

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

const ordres = decouper(readFileSync(MIGRATION, 'utf8'))
const ordresVerified = decouper(readFileSync(MIGRATION_VERIFIED, 'utf8'))
class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const un = async (tx, sql, ...p) => (await tx.$queryRawUnsafe(sql, ...p))[0]

const A = 'essai-communications-a@exemple.invalid'
const B = 'essai-communications-b@exemple.invalid'

/** Un ordre qui DOIT echouer, dans un savepoint. */
async function refuse(tx, nom, sql, ...p) {
  await tx.$executeRawUnsafe('savepoint essai')
  let refuse = false
  try { await tx.$executeRawUnsafe(sql, ...p) } catch { refuse = true }
  await tx.$executeRawUnsafe('rollback to savepoint essai')
  assert.ok(refuse, `devait etre refuse : ${nom}`)
}

/** Joue fn sous un role et un jeton simules. Ce que fn ecrit RESTE dans la transaction. */
async function commeRole(tx, role, uid, fn) {
  await tx.$executeRawUnsafe('savepoint role')
  await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, JSON.stringify(uid ? { sub: uid, role } : { role }))
  await tx.$executeRawUnsafe(`select set_config('request.jwt.claim.sub', $1, true)`, uid ?? '')
  await tx.$executeRawUnsafe(`set local role ${role}`)
  try {
    const r = await fn()
    await tx.$executeRawUnsafe('reset role')
    await tx.$executeRawUnsafe('release savepoint role')
    return r
  } catch (e) {
    await tx.$executeRawUnsafe('rollback to savepoint role')
    await tx.$executeRawUnsafe('reset role')
    throw e
  }
}

/** Un appel qui DOIT etre refuse sous ce role (droit d'execution). */
async function refuseSousRole(tx, role, uid, nom, sql, ...p) {
  let refuse = false
  try { await commeRole(tx, role, uid, () => tx.$queryRawUnsafe(sql, ...p)) } catch { refuse = true }
  assert.ok(refuse, `devait etre refuse a ${role} : ${nom}`)
}

const SQL_COLONNE = `select count(*)::int as n from information_schema.columns
  where table_schema = 'public' and table_name = 'profile_emails' and column_name = 'communications'`
const SQL_FONCTIONS = `select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname in ('aok_choisir_email_communications', 'aok_email_communications', 'profile_emails_communications_garde')`
const SQL_TRIGGER = `select count(*)::int as n from pg_trigger where tgrelid = 'public.profile_emails'::regclass and tgname = 'profile_emails_communications_garde'`
const SQL_LIGNES = `select count(*)::int as n, count(*) filter (where verified)::int as v from public.profile_emails`

const avant = {
  colonne: (await un(prisma, SQL_COLONNE)).n,
  fonctions: (await un(prisma, SQL_FONCTIONS)).n,
  trigger: (await un(prisma, SQL_TRIGGER)).n,
  lignes: await un(prisma, SQL_LIGNES),
}
console.log(`avant : colonne ${avant.colonne}, fonctions ${avant.fonctions}, garde ${avant.trigger}, ${avant.lignes.n} lignes (${avant.lignes.v} verifiees), ${ordres.length} ordres`)

try {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    for (let passe = 1; passe <= 2; passe++) {
      for (const o of ordres) await tx.$executeRawUnsafe(o)
    }
    ok('migration jouee deux fois')

    // -- 1. structure et droits
    const col = await un(tx, `select is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'profile_emails' and column_name = 'communications'`)
    assert.equal(col.is_nullable, 'NO')
    assert.equal(col.column_default, 'false')
    assert.equal((await un(tx, `select count(*)::int as n from pg_indexes where schemaname = 'public' and tablename = 'profile_emails'
      and indexname = 'profile_emails_communications_un' and indexdef ilike '%unique%where communications%'`)).n, 1)
    assert.equal((await un(tx, `select count(*)::int as n from pg_constraint where conrelid = 'public.profile_emails'::regclass
      and conname = 'profile_emails_communications_verifiee_ck'`)).n, 1)
    assert.equal((await un(tx, SQL_TRIGGER)).n, 1)
    assert.equal((await un(tx, `select count(*)::int as n from public.profile_emails where communications`)).n, 0)
    ok('colonne not null default false, index unique partiel, check, garde, aucune ligne cochee')

    const droits = await un(tx, `select
      has_function_privilege('anon', 'public.aok_choisir_email_communications(text)', 'execute') as choisir_anon,
      has_function_privilege('authenticated', 'public.aok_choisir_email_communications(text)', 'execute') as choisir_auth,
      has_function_privilege('anon', 'public.aok_email_communications(uuid)', 'execute') as lire_anon,
      has_function_privilege('authenticated', 'public.aok_email_communications(uuid)', 'execute') as lire_auth,
      has_function_privilege('service_role', 'public.aok_email_communications(uuid)', 'execute') as lire_service,
      has_column_privilege('authenticated', 'public.profile_emails', 'communications', 'UPDATE') as maj_auth,
      has_column_privilege('authenticated', 'public.profile_emails', 'communications', 'INSERT') as ins_auth,
      has_column_privilege('authenticated', 'public.profile_emails', 'communications', 'SELECT') as lit_auth,
      has_column_privilege('anon', 'public.profile_emails', 'communications', 'SELECT') as lit_anon`)
    assert.deepEqual(droits, {
      choisir_anon: false, choisir_auth: true, lire_anon: false, lire_auth: false, lire_service: true,
      maj_auth: false, ins_auth: false, lit_auth: true, lit_anon: false,
    })
    ok('droits : choix a authenticated, lecture serveur seulement, aucune ecriture directe, colonne lisible par le membre')

    // -- 2. le choix par le membre
    const p = await un(tx, `select pe.profile_id::text as id from public.profile_emails pe
      where pe.is_primary and pe.verified order by pe.created_at limit 1`)
    assert.ok(p, 'aucun compte avec une adresse principale verifiee')
    const autre = await un(tx, `select pe.email from public.profile_emails pe
      where pe.profile_id <> $1::uuid and pe.verified limit 1`, p.id)
    await tx.$executeRawUnsafe(`insert into public.profile_emails (profile_id, email, is_primary, verified, source)
      values ($1::uuid, $2, false, true, 'essai'), ($1::uuid, $3, false, false, 'essai')`, p.id, A, B)
    const idA = (await un(tx, `select id::text as id from public.profile_emails where email = $1`, A)).id
    const lecture = async () => (await un(tx, `select public.aok_email_communications($1::uuid) as e`, p.id)).e
    const principale = (await un(tx, `select email from public.profile_emails where profile_id = $1::uuid and is_primary`, p.id)).email
    assert.equal(await lecture(), principale)
    ok('lecture : sans choix, l adresse principale')

    const choisir = (email, uid = p.id) => commeRole(tx, 'authenticated', uid,
      async () => (await un(tx, `select public.aok_choisir_email_communications($1) as r`, email)).r)
    assert.equal(await choisir(A), true)
    assert.equal(await lecture(), A)
    ok('choix d une adresse verifiee : accepte, la lecture la rend')
    assert.equal(await choisir(B), false)
    ok('choix d une adresse non verifiee : refuse')
    assert.equal(await choisir('inconnue-communications@exemple.invalid'), false)
    ok('choix d une adresse inconnue du compte : refuse')
    if (autre) {
      assert.equal(await choisir(autre.email), false)
      ok('choix d une adresse verifiee d un autre compte : refuse')
    }
    assert.equal(await choisir(A, null), false)
    ok('choix sans session (auth.uid() nul) : refuse')
    await refuseSousRole(tx, 'anon', null, 'choisir', `select public.aok_choisir_email_communications($1)`, A)
    ok('choix par anon : refuse (droit d execution)')
    assert.equal(await lecture(), A)
    assert.equal(await choisir(`  ${A.toUpperCase()} `), true)
    const vues = await commeRole(tx, 'authenticated', p.id, () => tx.$queryRawUnsafe(
      `select email, communications from public.profile_emails where profile_id = auth.uid()`))
    assert.equal(vues.filter(v => v.communications).length, 1)
    assert.ok(vues.find(v => v.email === A)?.communications)
    ok('casse et espaces ignores, une seule ligne cochee, lisible par le membre sous RLS')

    // -- 3. contrainte et index
    await refuse(tx, 'cocher une adresse non verifiee', `update public.profile_emails set communications = true where email = $1`, B)
    await refuse(tx, 'deux adresses cochees', `update public.profile_emails set communications = true where profile_id = $1::uuid and is_primary`, p.id)
    ok('check (non verifiee) et index unique partiel (deux cochees) refusent')

    // -- 4. le garde
    await tx.$executeRawUnsafe(`update public.profile_emails set verified = false where id = $1::uuid`, idA)
    assert.equal((await un(tx, `select communications from public.profile_emails where id = $1::uuid`, idA)).communications, false)
    assert.equal(await lecture(), principale)
    ok('verified qui tombe : le choix s efface, la mise a jour passe, la lecture revient a la principale')
    await tx.$executeRawUnsafe(`update public.profile_emails set verified = true where id = $1::uuid`, idA)
    assert.equal(await choisir(A), true)
    for (const o of ordresVerified) await tx.$executeRawUnsafe(o)
    assert.equal((await un(tx, `select count(*)::int as n from public.profile_emails where communications and not verified`)).n, 0)
    ok('20261031200000 rejouee par-dessus : aucun echec, aucune ligne cochee non verifiee')

    const nonConfirme = await un(tx, `select u.id::text as id from auth.users u
      where u.email_confirmed_at is null and u.email is not null limit 1`)
    if (nonConfirme) {
      await tx.$executeRawUnsafe(`update auth.users set email_confirmed_at = now() where id = $1::uuid`, nonConfirme.id)
      ok('handle_user_email_confirmed : la confirmation d un compte passe toujours')
    } else {
      console.log('--  aucun compte non confirme : essai de handle_user_email_confirmed saute')
    }

    // -- 5. lecture serveur : droits et repli
    await refuseSousRole(tx, 'authenticated', p.id, 'lire', `select public.aok_email_communications($1::uuid)`, p.id)
    await refuseSousRole(tx, 'anon', null, 'lire', `select public.aok_email_communications($1::uuid)`, p.id)
    const parService = await commeRole(tx, 'service_role', null,
      async () => (await un(tx, `select public.aok_email_communications($1::uuid) as e`, p.id)).e)
    assert.equal(parService, A)
    ok('lecture : refusee a authenticated et anon, ouverte a service_role')
    const sansPrincipale = await un(tx, `select count(*)::int as n,
      count(*) filter (where public.aok_email_communications(u.id) is not distinct from u.email)::int as bons
      from auth.users u where not exists (select 1 from public.profile_emails pe where pe.profile_id = u.id and pe.is_primary)`)
    assert.equal(sansPrincipale.bons, sansPrincipale.n)
    ok(`lecture : compte sans ligne principale, l adresse de connexion (${sansPrincipale.n} compte(s))`)

    // -- 6. retour a la principale, ligne retiree
    assert.equal(await choisir(principale), true)
    assert.equal((await un(tx, `select count(*)::int as n from public.profile_emails where profile_id = $1::uuid and communications`, p.id)).n, 0)
    assert.equal(await lecture(), principale)
    ok('choisir la principale : tout se decoche')
    assert.equal(await choisir(A), true)
    await commeRole(tx, 'authenticated', p.id, () => tx.$executeRawUnsafe(`delete from public.profile_emails where id = $1::uuid`, idA))
    assert.equal((await un(tx, `select count(*)::int as n from public.profile_emails where id = $1::uuid`, idA)).n, 0)
    assert.equal(await lecture(), principale)
    ok('adresse cochee retiree par le membre : la lecture revient a la principale')

    throw new Annulation()
  }, { timeout: 60000 })
} catch (e) {
  // Le message d'un echec peut citer une adresse (assertion, erreur de la base) : on la masque.
  const masquer = t => String(t).replace(/[^\s@'"()<>=,]+@[^\s@'"()<>=,]+/g, '<adresse>')
  if (!(e instanceof Annulation)) { console.error('ECHEC :', masquer(e.message)); await prisma.$disconnect(); process.exit(1) }
}

assert.equal((await un(prisma, SQL_COLONNE)).n, avant.colonne)
assert.equal((await un(prisma, SQL_FONCTIONS)).n, avant.fonctions)
assert.equal((await un(prisma, SQL_TRIGGER)).n, avant.trigger)
assert.deepEqual(await un(prisma, SQL_LIGNES), avant.lignes)
assert.equal((await un(prisma, `select count(*)::int as n from public.profile_emails where email like '%@exemple.invalid'`)).n, 0)
ok('transaction annulee : base inchangee')
console.log(`\n${etapes} etapes ok`)
await prisma.$disconnect()
