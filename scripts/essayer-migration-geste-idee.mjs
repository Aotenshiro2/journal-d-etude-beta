/**
 * ESSAI de la migration 20261027150000_cockpit_creation_geste_idee.sql contre
 * la vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, ordre par ordre (meme decoupage que appliquer-migration.mjs), jouee deux fois (rejouable) ;
 *   2. le check accepte idee et idees, refuse un geste inconnu (lu dans pg_constraint) ;
 * puis la transaction est annulee et on relit le check tel qu'il est vraiment.
 *
 * Lancement (apps/journal-d-etude, .env.local charge) : node scripts/essayer-migration-geste-idee.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FICHIER = path.join(RACINE, '../../sites/Aoknowledgecom/supabase/migrations/20261027150000_cockpit_creation_geste_idee.sql')

function decouper(sql) {
  const ordres = []; let courant = ''; let tag = null; let i = 0
  while (i < sql.length) {
    if (!tag) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (dollar) { tag = dollar[0]; courant += tag; i += tag.length; continue }
      if (sql[i] === ';') { if (courant.trim()) ordres.push(courant.trim()); courant = ''; i += 1; continue }
    } else if (sql.startsWith(tag, i)) { courant += tag; i += tag.length; tag = null; continue }
    courant += sql[i]; i += 1
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}

const sql = readFileSync(FICHIER, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const ordres = decouper(sql)
console.log(`${ordres.length} ordres dans la migration`)

const prisma = new PrismaClient()
const lireCheck = (tx) => tx.$queryRawUnsafe(
  `select pg_get_constraintdef(oid) as def from pg_constraint
   where conname = 'cockpit_decoupage_propositions_geste_check'`)
const ANNULER = new Error('ANNULATION VOULUE')

try {
  console.log('Check avant :', (await lireCheck(prisma))[0]?.def ?? '(aucun)')
  try {
    await prisma.$transaction(async (tx) => {
      for (const passe of [1, 2]) {
        for (const o of ordres) await tx.$executeRawUnsafe(o)
        console.log(`ok   migration jouee (passe ${passe})`)
      }
      const def = (await lireCheck(tx))[0]?.def ?? ''
      console.log('Check dans la transaction :', def)
      for (const g of ['assiste', 'genere', 'titre', 'phrase', 'idee', 'idees']) {
        assert.ok(def.includes(`'${g}'`), `le check doit accepter ${g}`)
      }
      assert.ok(!def.includes("'inconnu'"))
      // Le check refuse un geste inconnu : on le prouve sur une valeur, sans ligne.
      const [r] = await tx.$queryRawUnsafe(
        `select ('idees' = any (array['assiste','genere','titre','phrase','idee','idees'])) as idees_ok,
                ('inconnu' = any (array['assiste','genere','titre','phrase','idee','idees'])) as inconnu_ok`)
      assert.equal(r.idees_ok, true)
      assert.equal(r.inconnu_ok, false)
      console.log('ok   idee et idees acceptes, les lignes existantes passent le nouveau check')
      throw ANNULER
    }, { timeout: 30_000 })
  } catch (err) {
    if (err !== ANNULER) throw err
    console.log('ok   transaction annulee')
  }
  console.log('Check apres annulation (inchange) :', (await lireCheck(prisma))[0]?.def ?? '(aucun)')
} finally {
  await prisma.$disconnect()
}
