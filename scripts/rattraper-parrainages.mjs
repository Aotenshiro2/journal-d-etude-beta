/**
 * (05/11, Brice : « on les rattrape et on prévient les parrains ») Le
 * RATTRAPAGE du parrainage par code : les filleuls arrives depuis le 22/10
 * (date des codes BARBU17, SAUCISSON, 10kONEDAY), avant la mise en service.
 * C'est le filet du passage du matin (filetParrainages, liveclub/parrainage.ts)
 * avec une fenetre qui remonte au 22/10 au lieu de 7 jours : memes regles
 * (premier paiement, code de parrainage actif, une seule fois par abonnement),
 * memes textes. Un paiement d'un mois deja fini : « Thomas a rejoint le Live
 * Club le 25 octobre grâce à ton code BARBU17. Ta commission de 19,80 € (20 %
 * de son premier paiement) sera comptée avec les commissions d'octobre. »
 * Un filleul deja note ne fait rien : le script peut etre relance.
 *
 * A lancer UNE fois, APRES le deploiement du journal et les deux migrations
 * (20261105120000, 20261105190000), sur GO de Brice. De preference le jour
 * meme : la carte des commissions d'octobre arrive au passage suivant, avec
 * les filleuls rattrapes. (Lancee apres une declaration, la carte qui la
 * remplace suit d'elle-meme.)
 *
 * A BLANC par defaut : Stripe et la base sont LUS, rien n'est ecrit ni envoye ;
 * la liste dit chaque filleul (code, parrain, paiement, rang, commission) et le
 * message qui partirait. --oui pour noter et prevenir pour de vrai.
 *
 * Lancement (apps/journal-d-etude, Node 22, .env.local charge : set -a; . ./.env.local; set +a) :
 *   node scripts/rattraper-parrainages.mjs [--depuis 2026-10-22] [--oui]
 * Cles (Stripe du compte de Melanie, bots Telegram) lues dans l'environnement ou le coffre, jamais affichees.
 */
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = pathToFileURL(path.join(RACINE, 'src') + path.sep).href
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) } catch (err) {
    let base = null
    if (spec.startsWith('@/')) base = new URL(spec.slice(2), SRC).href
    else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL) base = new URL(spec, ctx.parentURL).href
    if (!base) throw err
    for (const c of [base + '.ts', base + '/index.ts']) { try { return await next(c, ctx) } catch {} }
    throw err
  }
}`))

const COFFRE = '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local'
const args = process.argv.slice(2)
const val = (nom) => {
  const i = args.indexOf(`--${nom}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
const EXECUTER = args.includes('--oui')
const DEPUIS = val('depuis') ?? '2026-10-22'
if (!/^\d{4}-\d{2}-\d{2}$/.test(DEPUIS)) {
  console.error('--depuis : AAAA-MM-JJ (par defaut 2026-10-22, la date des codes).')
  process.exit(2)
}

function coffre(fichier) {
  try { return JSON.parse(readFileSync(`${COFFRE}/${fichier}`, 'utf8')) } catch { return null }
}
if (!process.env.STRIPE_READ_KEY_MELANIE && !process.env.STRIPE_AGENT_KEY_MELANIE) {
  const cle = coffre('stripe-api.local.json')?.comptes?.find(c => c.libelle === 'melanie')?.secret_key
  if (!cle) { console.error('Cle Stripe du compte de Melanie introuvable (STRIPE_READ_KEY_MELANIE, STRIPE_AGENT_KEY_MELANIE ou coffre).'); process.exit(1) }
  process.env.STRIPE_AGENT_KEY_MELANIE = cle
}
if (!process.env.TELEGRAM_LIVECLUB_BOT_TOKEN) {
  const jeton = coffre('telegram-cockpit.local.json')?.liveclub_bot_token
  if (jeton) process.env.TELEGRAM_LIVECLUB_BOT_TOKEN = jeton
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL absente : charger .env.local (set -a; . ./.env.local; set +a).')
  process.exit(1)
}
if (EXECUTER && (!process.env.TELEGRAM_LIVECLUB_BOT_TOKEN || !process.env.TELEGRAM_BOT_TOKEN_COCKPIT)) {
  console.error('Pour --oui il faut le bot des membres (TELEGRAM_LIVECLUB_BOT_TOKEN) ET Agent AOK (TELEGRAM_BOT_TOKEN_COCKPIT) : '
    + 'sinon les parrains ou l\'equipe ne seraient pas prevenus. Rien n\'est lance.')
  process.exit(1)
}

const { prisma } = await import('../src/lib/db.ts')
const { filetParrainages } = await import('../src/lib/liveclub/parrainage.ts')

let code = 0
try {
  const journal = []
  console.log(`Rattrapage du parrainage depuis le ${DEPUIS} : ${EXECUTER ? 'POUR DE VRAI' : 'A BLANC (rien n\'est ecrit ni envoye)'}.\n`)
  const bilan = await filetParrainages(new Date(), { depuisJour: DEPUIS, aBlanc: !EXECUTER, journal })
  for (const l of journal) console.log(l)
  console.log(`\nBilan : ${JSON.stringify(bilan)}`)
  if (bilan.etat !== 'ok') {
    console.log(`Etat ${bilan.etat} : ${bilan.etat === 'table_absente' ? 'migration 20261105120000 pas appliquee' : bilan.etat === 'sans_code' ? 'aucun code de parrainage actif' : 'lecture impossible'}.`)
    code = 1
  } else if (!EXECUTER) {
    console.log(`\nA BLANC : ${bilan.notees} filleul(s) seraient notes. Relancer avec --oui pour noter et prevenir les parrains.`)
  } else {
    console.log(`\nFait : ${bilan.notees} filleul(s) notes, ${bilan.prevenus} parrain(s) prevenu(s) en prive, ${bilan.equipe} alerte(s) a l'equipe, ${bilan.a_reprendre} a reprendre par le filet.`)
  }
} catch (err) {
  console.error(`Echec : ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
  code = 1
} finally {
  await prisma.$disconnect().catch(() => {})
}
process.exit(code)
