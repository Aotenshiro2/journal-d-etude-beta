/**
 * (04/11, Brice) Execute le parcours « pause de l'abonnement + acces par depot
 * broker » d'un abonne, EXACTEMENT comme le clic de la carte d'Agent AOK
 * (proposer_pause_depot) : controlerPauseDepot compose la carte (lecture seule :
 * commission, abonnement Stripe, base, dates), puis executerPauseDepot (le
 * clic, executerPauseDepotAvec) : depot inscrit, acces broker pose jusqu'a la
 * reprise, marqueur au journal, pause Stripe (reprise = fin de periode payee +
 * 6 mois), message au membre (une fois par acces). Rien n'est refait qui
 * existe deja : le parcours relit la base et Stripe (etapes 'garder').
 *
 * Premier cas : Arthur (u5026707870), dont la declaration « depot fait » du
 * 01/11 n'a jamais donne de carte a valider.
 *
 * A BLANC par defaut : la carte telle que Brice et Mel la liraient, et l'etat
 * reel (Stripe, base). --oui pour executer. --verifier : relit seulement
 * l'etat (apres l'execution).
 *
 * Lancement (apps/journal-d-etude, Node 22, .env.local charge : set -a; . ./.env.local; set +a) :
 *   node scripts/executer-pause-depot.mjs --email <adresse> --montant <euros> --le <AAAA-MM-JJ>
 *     [--client "Nom"] [--partenaire raisefx] [--commission 650] [--mois 6] [--acteur <uuid>] [--oui | --verifier]
 * Montant et date : ceux que le membre a declares, jamais devines (aucune valeur par defaut).
 * Cle Stripe (compte de Melanie) et jeton du bot lus dans l'environnement ou le coffre, jamais affiches.
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
// Brice (cockpit_telegram_comptes, libelle brice) : c'est lui qui confirme le depot.
const ACTEUR_BRICE = '0636a40b-13a4-4fe8-af11-d060e2810767'

const args = process.argv.slice(2)
const val = (nom) => {
  const i = args.indexOf(`--${nom}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
const EXECUTER = args.includes('--oui')
const VERIFIER = args.includes('--verifier')
const email = val('email')?.trim().toLowerCase() ?? null
const montant = val('montant')
const le = val('le')
const client = val('client')
const partenaire = val('partenaire') ?? 'raisefx'
const commission = val('commission') ?? '650'
const mois = val('mois') ?? '6'
const acteurUuid = (val('acteur') ?? ACTEUR_BRICE).toLowerCase()

if (!email) {
  console.error('Usage : node scripts/executer-pause-depot.mjs --email <adresse> --montant <euros> --le <AAAA-MM-JJ> [--client "Nom"] [--oui | --verifier]')
  process.exit(2)
}
if (!VERIFIER && (!montant || !le)) {
  console.error('Montant et date du depot obligatoires (--montant, --le) : ceux que le membre a declares. Rien n\'est lance.')
  process.exit(2)
}

function coffre(fichier) {
  try { return JSON.parse(readFileSync(`${COFFRE}/${fichier}`, 'utf8')) } catch { return null }
}
if (!process.env.STRIPE_AGENT_KEY_MELANIE) {
  const cle = coffre('stripe-api.local.json')?.comptes?.find(c => c.libelle === 'melanie')?.secret_key
  if (!cle) { console.error('Cle Stripe du compte de Melanie introuvable (STRIPE_AGENT_KEY_MELANIE ou coffre).'); process.exit(1) }
  process.env.STRIPE_AGENT_KEY_MELANIE = cle
}
if (!process.env.TELEGRAM_LIVECLUB_BOT_TOKEN) {
  const jeton = coffre('telegram-cockpit.local.json')?.liveclub_bot_token
  if (jeton) process.env.TELEGRAM_LIVECLUB_BOT_TOKEN = jeton
}

const { prisma } = await import('../src/lib/db.ts')
const { controlerPauseDepot, executerPauseDepot } = await import('../src/lib/liveclub/pause-depot.ts')
const { abonnementsLiveClubParEmail } = await import('../src/lib/liveclub/stripe.ts')

const stripeKey = process.env.STRIPE_AGENT_KEY_MELANIE
async function lireSubStripe(id) {
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${id}`, { headers: { Authorization: `Bearer ${stripeKey}` } })
  if (!r.ok) throw new Error(`Stripe ${r.status} sur la lecture de l'abonnement`)
  return r.json()
}
const jour = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : null)

/** L'etat reel : Stripe (pause), base (acces, depot, marqueur). Lecture seule. */
async function etat() {
  const subs = await abonnementsLiveClubParEmail(email)
  for (const a of subs) {
    const s = await lireSubStripe(a.id)
    const item = s.items?.data?.[0]
    console.log(`Stripe ${a.id} : statut ${s.status}, periode payee jusqu'au ${jour(item?.current_period_end ?? s.current_period_end)}, `
      + `pause_collection = ${s.pause_collection ? `${s.pause_collection.behavior}, reprise ${jour(s.pause_collection.resumes_at)}` : 'aucune'}, `
      + `arret prevu = ${s.cancel_at_period_end ? 'oui' : 'non'}`)
  }
  const acces = await prisma.$queryRaw`
    select acces_id::text as acces_id, motif, source, debut, jusquau, telegram_id from public.cockpit_liveclub_acces where lower(email) = ${email}`
  for (const a of acces) console.log(`Acces : ${a.motif} ${a.source}, du ${a.debut?.toISOString?.().slice(0, 10)} au ${a.jusquau?.toISOString?.().slice(0, 10)}, telegram ${a.telegram_id ?? '-'} (${a.acces_id})`)
  if (!acces.length) console.log('Acces : aucun.')
  const ids = acces.map(a => a.acces_id)
  const depots = ids.length ? await prisma.$queryRaw`
    select commission_id::text as id, partenaire_id, le, montant_base::text as base, commission_attendue::text as attendue, statut
    from public.cockpit_commissions where acces_id::text = any(${ids})` : []
  for (const d of depots) console.log(`Depot : ${d.partenaire_id} ${d.base} € le ${d.le?.toISOString?.().slice(0, 10)}, commission attendue ${d.attendue} €, ${d.statut} (${d.id})`)
  if (!depots.length) console.log('Depot : aucun relie a un acces.')
  const gestes = await prisma.$queryRaw`
    select fait_le, geste, resultat, regle, details from public.cockpit_liveclub_gestes
    where regle in ('pause_depot', 'pause_depot_message') and (details->>'acces_id' = any(${ids}) or abonnement_id = any(${subs.map(a => a.id)}))
    order by fait_le`
  for (const g of gestes) console.log(`Journal : ${g.fait_le.toISOString()} ${g.geste} ${g.resultat} ${g.regle}${g.details?.canal ? ` (${g.details.canal})` : ''}${g.details?.reprise_le ? ` reprise ${g.details.reprise_le}` : ''}`)
}

let code = 0
try {
  console.log('--- Etat avant ---')
  await etat()
  if (!VERIFIER) {
    const action = {
      type: 'pause_depot', compte: 'cockpit',
      params: { partenaire, email, client, montant: Number(montant), le, mois: Number(mois), commission: Number(commission) },
    }
    const c = await controlerPauseDepot(action)
    if ('erreur' in c) throw new Error(`refus du controle : ${c.erreur}`)
    console.log('\n--- Carte (version de Brice) ---\n' + c.carte)
    console.log('\n--- Carte (version de Mel) ---\n' + c.court)
    if (c.manque) throw new Error(c.manque)
    if (!EXECUTER) {
      console.log('\nA BLANC : rien n\'est fait. Relancer avec --oui pour executer (le clic de la carte).')
    } else {
      console.log('\n--- Execution (le clic) ---')
      const r = await executerPauseDepot(c.action, `agent:${acteurUuid}`)
      console.log(r)
      console.log('\n--- Etat apres ---')
      await etat()
    }
  }
} catch (err) {
  console.error(`Arret : ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
  code = 1
} finally {
  await prisma.$disconnect()
}
process.exit(code)
