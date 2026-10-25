// Fait resoudre a Node 22 les imports sans extension du code TypeScript
// (« ./images-pur », « @/lib/... ») quand un script de verification charge un
// .ts directement. A importer AVANT tout import dynamique de src/ :
//
//   import './resoudre-ts.mjs'
//   const P = await import('../src/lib/mcp-gpt/pur.ts')
//
// (les imports statiques d'un meme fichier sont resolus avant que celui-ci
// tourne : ils ne profiteraient pas du crochet).
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
