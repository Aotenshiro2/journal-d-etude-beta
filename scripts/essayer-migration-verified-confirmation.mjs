/**
 * ESSAI de la migration 20261031200000_profile_emails_verified_a_la_confirmation.sql
 * contre la vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable) ;
 *   2. handle_new_user pose verified selon email_confirmed_at, le trigger existe ;
 *   3. le rattrapage : plus aucune adresse de connexion « verifiee » d'un compte
 *      jamais confirme ;
 *   4. un compte jamais confirme que l'on confirme (dans la transaction) voit
 *      son adresse passer a verified = true, et seulement la sienne.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste (pas de trigger, fonction d'origine). Aucune donnee affichee.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env scripts/essayer-migration-verified-confirmation.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const MIGRATION = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261031200000_profile_emails_verified_a_la_confirmation.sql', import.meta.url)

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
class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }

const SQL_DEF = `select pg_get_functiondef('public.handle_new_user()'::regprocedure) as def`
const SQL_TRIGGER = `select count(*)::int as n from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_email_confirmed'`
const SQL_FAUX_VERIFIES = `select count(*)::int as n from public.profile_emails pe join auth.users u on u.id = pe.profile_id
  where u.email_confirmed_at is null and pe.verified and lower(pe.email) = lower(u.email)`

const defAvant = (await prisma.$queryRawUnsafe(SQL_DEF))[0].def
const triggerAvant = (await prisma.$queryRawUnsafe(SQL_TRIGGER))[0].n
console.log(`avant : trigger ${triggerAvant}, adresses verifiees de comptes non confirmes ${(await prisma.$queryRawUnsafe(SQL_FAUX_VERIFIES))[0].n}, ${ordres.length} ordres`)

try {
  await prisma.$transaction(async tx => {
    for (let passe = 1; passe <= 2; passe++) {
      for (const o of ordres) await tx.$executeRawUnsafe(o)
    }
    ok('migration jouee deux fois')

    const def = (await tx.$queryRawUnsafe(SQL_DEF))[0].def
    assert.match(def, /NEW\.email_confirmed_at is not null, 'user'/)
    ok('handle_new_user pose verified selon email_confirmed_at')
    assert.equal((await tx.$queryRawUnsafe(SQL_TRIGGER))[0].n, 1)
    ok('trigger on_auth_user_email_confirmed en place')
    assert.equal((await tx.$queryRawUnsafe(SQL_FAUX_VERIFIES))[0].n, 0)
    ok('rattrapage : aucune adresse verifiee d un compte non confirme')

    const cible = (await tx.$queryRawUnsafe(`select u.id::text as id from auth.users u
      where u.email_confirmed_at is null and u.email is not null
        and exists (select 1 from public.profile_emails pe where pe.profile_id = u.id and lower(pe.email) = lower(u.email))
      limit 1`))[0]
    if (cible) {
      const autresAvant = (await tx.$queryRawUnsafe(`select count(*)::int as n from public.profile_emails where verified and profile_id <> $1::uuid`, cible.id))[0].n
      await tx.$executeRawUnsafe(`update auth.users set email_confirmed_at = now() where id = $1::uuid`, cible.id)
      const v = (await tx.$queryRawUnsafe(`select bool_and(pe.verified) as v from public.profile_emails pe join auth.users u on u.id = pe.profile_id
        where u.id = $1::uuid and lower(pe.email) = lower(u.email)`, cible.id))[0].v
      assert.equal(v, true)
      const autresApres = (await tx.$queryRawUnsafe(`select count(*)::int as n from public.profile_emails where verified and profile_id <> $1::uuid`, cible.id))[0].n
      assert.equal(autresApres, autresAvant)
      ok('confirmation : l adresse du compte passe a verified, aucune autre ligne touchee')
    } else {
      console.log('--  aucun compte non confirme avec adresse : essai du trigger saute')
    }
    throw new Annulation()
  }, { timeout: 30000 })
} catch (e) {
  if (!(e instanceof Annulation)) { console.error('ECHEC :', e.message); await prisma.$disconnect(); process.exit(1) }
}

assert.equal((await prisma.$queryRawUnsafe(SQL_TRIGGER))[0].n, triggerAvant)
assert.equal((await prisma.$queryRawUnsafe(SQL_DEF))[0].def, defAvant)
ok('transaction annulee : base inchangee')
console.log(`\n${etapes} etapes ok`)
await prisma.$disconnect()
