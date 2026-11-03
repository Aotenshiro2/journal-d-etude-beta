/**
 * (03/11, Brice) Renvoie l'accueil du Live Club d'un compte dans le groupe, quand
 * il n'est pas parti a son entree (cas d'EarvinSaintus, 03/11). Memes textes
 * que le webhook (envoisAccueil, accueil-groupe.ts) : la ligne d'Accueil (sujet
 * general, sans message_thread_id), plus le mot de Bla-bla pour un nouveau.
 *
 * A BLANC par defaut : affiche ce qui partirait, et l'etat du bot dans le groupe
 * (lecture seule : getMe, getChatMember, dont le droit « Gerer les sujets »
 * sans lequel le sujet ferme Accueil refuse le message). --oui pour envoyer.
 *
 * Le genre : --genre nouveau|retour|neutre ; sinon deduit du journal des
 * gestes (un retrait passe = retour, sinon nouveau). Refuse si le compte n'est
 * pas dans le groupe.
 *
 * Lancement (apps/journal-d-etude, Node 22, .env.local charge : set -a; . ./.env.local; set +a) :
 *   node scripts/renvoyer-accueil.mjs <telegram_id> [--genre retour] [--oui]
 * Jeton du bot lu dans l'environnement ou le coffre, jamais affiche.
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

const args = process.argv.slice(2)
const ENVOYER = args.includes('--oui')
const iGenre = args.indexOf('--genre')
const genreDemande = iGenre >= 0 ? args[iGenre + 1] : null
const telegramId = Number(args.find(a => /^\d+$/.test(a)))
if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
  console.error('Usage : node scripts/renvoyer-accueil.mjs <telegram_id> [--genre nouveau|retour|neutre] [--oui]')
  process.exit(2)
}
if (genreDemande && !['nouveau', 'retour', 'neutre'].includes(genreDemande)) {
  console.error('--genre : nouveau, retour ou neutre.')
  process.exit(2)
}

if (!process.env.TELEGRAM_LIVECLUB_BOT_TOKEN) {
  try {
    const coffre = JSON.parse(readFileSync('/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/telegram-cockpit.local.json', 'utf8'))
    process.env.TELEGRAM_LIVECLUB_BOT_TOKEN = coffre.liveclub_bot_token
  } catch {
    console.error('Jeton du bot du Live Club introuvable (TELEGRAM_LIVECLUB_BOT_TOKEN ou coffre).')
    process.exit(1)
  }
}

const { PrismaClient } = await import('@prisma/client')
const { envoisAccueil, nomPourAccueil } = await import('../src/lib/liveclub/accueil-groupe.ts')
const { appelTelegram } = await import('../src/lib/liveclub/telegram.ts')

// Le groupe Live Club (forum a sujets) : la variable de la prod, sinon l'identifiant releve le 31/10.
const CHAT = Number(process.env.TELEGRAM_LIVECLUB_CHAT_ID?.trim() || -1001930901866)

const db = new PrismaClient()
let code = 0
try {
  const lignes = await db.$queryRaw`
    select pseudo, nom_affiche, present, entre_le from public.cockpit_telegram_membres where telegram_id = ${telegramId}`
  const l = lignes[0]
  if (!l) throw new Error('compte inconnu dans cockpit_telegram_membres.')
  const retraits = await db.$queryRaw`
    select count(*)::int as n from public.cockpit_liveclub_gestes
    where telegram_id = ${telegramId} and geste = 'retrait' and resultat = 'fait'`
  const genre = genreDemande ?? (retraits[0]?.n > 0 ? 'retour' : 'nouveau')
  const prenom = (l.nom_affiche ?? '').split(/\s+/)[0] || null
  const envois = envoisAccueil(genre, nomPourAccueil(l.pseudo, prenom))

  // L'etat reel du membre et du bot dans le groupe (lecture seule).
  const membre = await appelTelegram('getChatMember', { chat_id: CHAT, user_id: telegramId })
  const statut = membre.ok ? membre.result?.status : null
  const moi = await appelTelegram('getMe', {})
  const bot = moi.ok ? await appelTelegram('getChatMember', { chat_id: CHAT, user_id: moi.result.id }) : moi
  const droits = bot.ok ? bot.result : null

  console.log(`Compte ${telegramId} : ${l.nom_affiche ?? '(sans nom)'}${l.pseudo ? ` @${l.pseudo}` : ''}, entre le ${l.entre_le?.toISOString?.() ?? '?'}, statut Telegram : ${statut ?? `illisible (${membre.erreur})`}.`)
  console.log(`Genre : ${genre}${genreDemande ? ' (demande)' : ` (deduit : ${retraits[0]?.n ?? 0} retrait(s) au journal)`}.`)
  console.log(`Bot dans le groupe : ${droits ? `${droits.status}, Gerer les sujets = ${droits.can_manage_topics === true ? 'oui' : 'NON'}` : `illisible (${bot.erreur})`}.`)
  for (const e of envois) console.log(`- ${e.ou}${e.sujet !== null ? ` (sujet ${e.sujet})` : ' (sujet general)'} : ${e.texte}`)

  if (!['member', 'administrator', 'creator', 'restricted'].includes(statut)) {
    throw new Error("le compte n'est pas dans le groupe (ou son statut est illisible) : rien a envoyer.")
  }
  if (!ENVOYER) {
    console.log('\nA BLANC : rien n\'est parti. Relancer avec --oui pour envoyer.')
  } else {
    for (const e of envois) {
      const r = await appelTelegram('sendMessage', { chat_id: CHAT, ...(e.sujet !== null ? { message_thread_id: e.sujet } : {}), text: e.texte })
      console.log(`${e.ou} : ${r.ok ? 'envoye' : `REFUSE (${r.erreur})`}`)
      if (!r.ok) code = 1
    }
  }
} catch (err) {
  console.error(`Arret : ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
  code = 1
} finally {
  await db.$disconnect()
}
process.exit(code)
