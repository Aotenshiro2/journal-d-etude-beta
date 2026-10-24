/**
 * Lance a la main l'envoi du jour du relais d'accueil (relaisDuMatin, le meme code que le passage du matin),
 * sur demande de Brice. Garde une fois par jour et par episode : relance sans danger.
 * Jeton du bot lu dans le coffre, jamais affiche.
 * Lancement (apps/journal-d-etude, .env.local charge) : node scripts/relais-envoyer-maintenant.mjs
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

if (!process.env.TELEGRAM_LIVECLUB_BOT_TOKEN) {
  const coffre = JSON.parse(readFileSync('/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/telegram-cockpit.local.json', 'utf8'))
  process.env.TELEGRAM_LIVECLUB_BOT_TOKEN = coffre.liveclub_bot_token
}
const { relaisDuMatin } = await import('../src/lib/liveclub/relais.ts')
const b = await relaisDuMatin()
console.log(JSON.stringify(b))
process.exit(0)
