// Rattrapage ponctuel des choix par defaut Kit (31/10/2026) : les abonnes
// ACTIFS crees depuis une date (par defaut le 31/10/2026, debut des envois
// par tag) qui n'ont AUCUN tag « Choix », hors membres qui ont regle leurs
// choix dans Mon espace. Meme regle que le webhook et le filet quotidien
// (src/lib/kit-defauts-pur.ts) : le code est le meme.
//
// ESSAI par defaut : Kit et la base sont lus, rien n'est ecrit (« pose » =
// a poser). --appliquer pose les tags, sur GO.
//
//   node --env-file=.env scripts/kit-defauts-rattrapage.mjs                     # essai, depuis le 31/10
//   node --env-file=.env scripts/kit-defauts-rattrapage.mjs --depuis=2026-10-31
//   node --env-file=.env scripts/kit-defauts-rattrapage.mjs --heures=72         # la fenetre du filet
//   node --env-file=.env scripts/kit-defauts-rattrapage.mjs --appliquer

import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { clientKit } from '../src/lib/kit.ts'
import { CHOIX_KIT } from '../src/lib/kit-choix.ts'
import { gardePrisma } from '../src/lib/kit-abonnements-depot.ts'
import { debutDuFilet, filetDefauts } from '../src/lib/kit-defauts-pur.ts'

const APPLIQUER = process.argv.includes('--appliquer')
const arg = nom => process.argv.find(a => a.startsWith(`--${nom}=`))?.split('=')[1]

function lireCle() {
  const env = (process.env.KIT_API_KEY || process.env.CONVERTKIT_API_KEY || '').trim()
  if (env) return env
  let texte = ''
  try { texte = readFileSync('/mnt/d/1_Ecriture/Systeme/contexte/secrets-kit.local.md', 'utf8') } catch { /* absent */ }
  const m = /KIT_API_KEY[\s*]*[:=][\s*`]*([A-Za-z0-9_-]+)/.exec(texte)
  if (!m) throw new Error('Cle Kit introuvable')
  return m[1]
}

const depuis = arg('heures') ? debutDuFilet(new Date(), Number(arg('heures'))) : new Date(`${arg('depuis') ?? '2026-10-31'}T00:00:00Z`)
if (Number.isNaN(depuis.getTime())) { console.error('ARRET : date illisible'); process.exit(1) }

const vrai = clientKit(lireCle())
let aPoser = 0
// En essai, le client ne pose rien : il compte.
const kit = APPLIQUER ? vrai : { ...vrai, async poserTag() { aPoser++ } }
const prisma = new PrismaClient()

console.log(`Rattrapage des choix par defaut : ${APPLIQUER ? 'APPLIQUER (ecriture chez Kit)' : 'ESSAI (lecture seule)'}`)
console.log(`abonnes actifs crees depuis ${depuis.toISOString()}\n`)
try {
  const s = await filetDefauts({ kit, garde: gardePrisma(prisma), choix: CHOIX_KIT }, depuis)
  console.log(`vus ${s.vus}`)
  console.log(`${APPLIQUER ? 'choix poses' : 'a qui poser les choix'} ${s.pose}${APPLIQUER ? '' : ` (${aPoser} tags)`}`)
  console.log(`deja un choix ${s.deja_choisi}, membres ecartes ${s.membre}, inactifs ${s.inactif}, absents ${s.absent}, erreurs ${s.erreurs}`)
  if (!APPLIQUER) console.log('\nESSAI : rien n\'est ecrit.')
  process.exitCode = s.erreurs ? 1 : 0
} finally {
  await prisma.$disconnect()
}
