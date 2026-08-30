/**
 * Applique une migration SQL du projet Supabase partagé, dans une transaction :
 * tout passe, ou rien ne passe.
 *
 * Pourquoi ce script plutôt que `prisma db execute` : il découpe le fichier en
 * ordres et les joue dans UNE transaction, donc une migration qui casse au
 * huitième ordre ne laisse pas la base à moitié modifiée. Le découpage respecte
 * les blocs délimités par dollars ($$, $fn$…) — sans ça, un point-virgule à
 * l'intérieur du corps d'une fonction coupe l'ordre en deux et rien ne compile.
 *
 * Ne pas l'appeler directement : passer par `scripts/appliquer-migration.sh`,
 * qui charge l'environnement et vérifie que le fichier est bien une migration.
 *
 * Après application, `npm run verifier:rls` dit si le schéma est resté sain.
 */

import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const fichier = process.argv[2]
if (!fichier) {
  console.error('Usage : node scripts/appliquer-migration.mjs <fichier.sql>')
  process.exit(2)
}

const sansCommentaires = readFileSync(fichier, 'utf8')
  .split('\n')
  .filter((ligne) => !ligne.trim().startsWith('--'))
  .join('\n')

/** Découpe sur les points-virgules, en laissant intacts les blocs $...$. */
function decouper(sql) {
  const ordres = []
  let courant = ''
  let tag = null
  let i = 0

  while (i < sql.length) {
    if (!tag) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (dollar) {
        tag = dollar[0]
        courant += tag
        i += tag.length
        continue
      }
      if (sql[i] === ';') {
        if (courant.trim()) ordres.push(courant.trim())
        courant = ''
        i += 1
        continue
      }
    } else if (sql.startsWith(tag, i)) {
      courant += tag
      i += tag.length
      tag = null
      continue
    }
    courant += sql[i]
    i += 1
  }

  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}

const ordres = decouper(sansCommentaires)
if (!ordres.length) {
  console.error('Aucun ordre SQL dans ce fichier.')
  process.exit(2)
}

console.log(`${fichier}\n${ordres.length} ordre(s) à appliquer.\n`)

const prisma = new PrismaClient()
try {
  await prisma.$transaction(async (tx) => {
    for (const [index, ordre] of ordres.entries()) {
      await tx.$executeRawUnsafe(ordre)
      console.log(`  ok  ${String(index + 1).padStart(2)}. ${ordre.replace(/\s+/g, ' ').slice(0, 74)}`)
    }
  })
  console.log('\nAppliqué.')
} catch (erreur) {
  console.error('\nECHEC, rien appliqué :', erreur.message?.split('\n').slice(-6).join('\n'))
  process.exitCode = 1
}
await prisma.$disconnect()
