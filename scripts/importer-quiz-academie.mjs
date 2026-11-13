// Pose SEULEMENT le quiz de fin de module d'un fichier du catalogue (13/11/2026), sans reimporter le module.
//
//   node --env-file=.env.local scripts/importer-quiz-academie.mjs <module.json> [<module.json> ...] [--ecrire]
//
// Le fichier : D:\6_Societe\Pilotage\Academie\catalogue\modules\<slug>.json, champ « quiz » (format dans
// src/lib/academie/quiz-academie.ts). Le module se retrouve par son slug ; il doit deja etre en base. Rien d'autre du
// module n'est touche (titre, lecons, offres, statut). Un fichier sans champ « quiz » est ignore ; « quiz »: null
// retire le quiz.
//
// Sans --ecrire : tout est joue dans une transaction puis ANNULE (essai a blanc), et le script dit ce qu'il aurait
// fait. LA MIGRATION 20261113231500 DOIT ETRE APPLIQUEE avant d'ecrire.
//
// Brouillon et publication : un quiz « brouillon » n'est montre qu'a l'equipe (relecture par Brice). Une fois relu,
// passer « statut » a « publie » dans le fichier (et monter « version » si des questions ont change), puis relancer.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { colonneQuizExiste, lireQuizDuFichier, poserQuiz } from './importer-catalogue-academie.mjs'

const args = process.argv.slice(2)
const inconnues = args.filter(a => a.startsWith('--') && a !== '--ecrire')
const fichiers = args.filter(a => !a.startsWith('--'))
if (!fichiers.length || inconnues.length) {
  if (inconnues.length) console.error(`Option inconnue : ${inconnues.join(' ')}`)
  console.error('Usage : node --env-file=.env.local scripts/importer-quiz-academie.mjs <module.json> [...] [--ecrire]')
  process.exit(2)
}
const ecrire = args.includes('--ecrire')

class Annulation extends Error {}
const prisma = new PrismaClient()
const bilan = []
try {
  await prisma.$transaction(async tx => {
    if (!(await colonneQuizExiste(tx))) throw new Error('colonne academie_modules.quiz absente : appliquer d\'abord la migration 20261113231500')
    for (const f of fichiers) {
      const donnees = JSON.parse(readFileSync(resolve(f), 'utf8'))
      const slug = donnees.module?.slug
      const lu = lireQuizDuFichier(donnees)
      if (!lu.present) { bilan.push(`${slug} : pas de champ quiz, ignore`); continue }
      const [m] = await tx.$queryRawUnsafe(`select id::text as id from public.academie_modules where slug = $1 for update`, slug)
      if (!m) throw new Error(`module ${slug} absent de la base : l'importer d'abord (importer-catalogue-academie.mjs)`)
      bilan.push(`${slug} : ${await poserQuiz(tx, m.id, lu.quiz)}`)
    }
    if (!ecrire) throw new Annulation()
  }, { timeout: 60_000, maxWait: 20_000 })
  console.log('ECRIT :')
  for (const b of bilan) console.log(`  ${b}`)
} catch (e) {
  if (e instanceof Annulation) {
    console.log('ESSAI A BLANC (rien ecrit) :')
    for (const b of bilan) console.log(`  ${b}`)
  } else {
    console.error('ECHEC, rien ecrit :', e.message)
    process.exitCode = 1
  }
} finally {
  await prisma.$disconnect()
}
