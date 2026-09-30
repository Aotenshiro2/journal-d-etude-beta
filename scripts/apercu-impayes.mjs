// APERCU EN LECTURE SEULE de ce que les nouvelles taches du passage quotidien
// (Brice, 30/09) decideraient aujourd'hui : sortie des impayes a 5 jours,
// reouverture, fenetre de 30 jours, rattrapage des emails de bienvenue.
//
// RIEN n'est ecrit, envoye ni modifie :
// - Stripe : la cle de LECTURE seule (STRIPE_READ_KEY_MELANIE, sinon le coffre
//   local stripe-api.local.json, compte « melanie ») ; la cle d'ecriture est
//   retiree de l'environnement avant tout import ;
// - base : des SELECT (rattachements, journal, jetons, exemptions) ;
// - Telegram : getChatMember seulement (presence, statut), jamais un message ;
// - emails : les cles Resend sont retirees de l'environnement.
// Les regles sont les VRAIES (pur.ts, passage-regles.ts, droitLiveClub) ; le
// rattachement compte Telegram -> client Stripe suit indexerParClient du
// passage, en plus simple (resolution par l'email bornee a 300 lectures).
//
// Sortie : des comptes, et pour chaque impaye de plus de 5 jours une ligne
// anonyme (jours depuis le premier echec, statut, rattache, present, exempte,
// decision). Aucun nom, email, identifiant Telegram ni Stripe.
//
// Lancement (Node 22, depuis apps/journal-d-etude) :
//   set -a && . ./.env && set +a && node scripts/apercu-impayes.mjs

import { register } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const COFFRE = process.env.COFFRE_CLES || '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local'
function lireCoffre(fichier) {
  const p = path.join(COFFRE, fichier)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

// Lecture seule, avant tout import : aucune cle d'ecriture, aucun email.
for (const v of ['STRIPE_AGENT_KEY_MELANIE', 'STRIPE_AGENT_KEY_AOKNOWLEDGE', 'RESEND_API_KEY', 'RESEND_API_KEY_LIVECLUB', 'RESEND_API_KEY_SUPPORT']) delete process.env[v]
if (!process.env.STRIPE_READ_KEY_MELANIE) {
  const compte = lireCoffre('stripe-api.local.json')?.comptes?.find(c => c.libelle === 'melanie')
  if (compte?.secret_key) process.env.STRIPE_READ_KEY_MELANIE = compte.secret_key
}
if (!process.env.TELEGRAM_LIVECLUB_BOT_TOKEN) {
  const tg = lireCoffre('telegram-cockpit.local.json')
  if (tg?.liveclub_bot_token) process.env.TELEGRAM_LIVECLUB_BOT_TOKEN = tg.liveclub_bot_token
}
// chat_id du groupe Live Club (COCKPIT-ROADMAP.md, 10/09), pas un secret.
process.env.TELEGRAM_LIVECLUB_CHAT_ID ||= '-1001930901866'
if (!process.env.STRIPE_READ_KEY_MELANIE || !process.env.DATABASE_URL) {
  console.error('Cle Stripe de lecture ou DATABASE_URL absente (charger le .env du journal).')
  process.exit(1)
}

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

const { PrismaClient } = await import('@prisma/client')
const stripe = await import('../src/lib/liveclub/stripe.ts')
const { droitLiveClub } = await import('../src/lib/liveclub/droits.ts')
const { exemptionActive } = await import('../src/lib/stripe-actions.ts')
const { appelTelegram } = await import('../src/lib/liveclub/telegram.ts')
const config = await import('../src/lib/liveclub/config.ts')
const pur = await import('../src/lib/liveclub/pur.ts')
const regles = await import('../src/lib/liveclub/passage-regles.ts')

// Les modules loggent parfois un numero Telegram (u123...) : on ne garde que le compte.
let avertissements = 0
console.warn = () => { avertissements++ }

const prisma = new PrismaClient()
const maintenant = new Date()
const maintenantMs = maintenant.getTime()

async function presence(telegramId) {
  const r = await appelTelegram('getChatMember', { chat_id: config.chatId(), user_id: telegramId })
  if (!r.ok) {
    if (r.code === 400 && /user not found|participant_id_invalid|member not found/i.test(r.erreur)) return { etat: 'non', statut: null }
    return { etat: 'inconnu', statut: null }
  }
  return regles.lirePresence(String(r.result?.status ?? '') || null, r.result?.is_member)
}

// Meme lecture que droitAvantSortie (passage.ts) : droitLiveClub, puis les abonnements des emails connus.
async function droitAvantSortie(telegramId, emails) {
  const d = await droitLiveClub(telegramId)
  if (d.statut !== 'non') return { statut: d.statut, raison: d.raison }
  for (const email of [...new Set(emails.map(pur.normaliserEmail).filter(Boolean))]) {
    try {
      if ((await stripe.abonnementsLiveClubParEmail(email)).some(pur.abonnementOuvreLeGroupe)) return { statut: 'oui', raison: 'abonnement_par_email' }
    } catch {
      return { statut: 'inconnu', raison: null }
    }
  }
  return { statut: 'non', raison: null }
}

const abonnements = await stripe.listerAbonnementsLiveClub({ statut: 'all' })
const rattaches = (await prisma.$queryRaw`
  select telegram_id, client_stripe, compte, email, membre_id
  from public.cockpit_liveclub_rattachements where retire_le is null`)
  .map(l => ({ telegramId: Number(l.telegram_id), clientStripe: l.client_stripe, compte: l.compte, email: l.email }))
  .filter(r => Number.isSafeInteger(r.telegramId))

// client Stripe -> comptes Telegram (comme indexerParClient).
const clientsLiveClub = new Set(abonnements.map(a => a.clientStripe).filter(Boolean))
const parClient = new Map()
const ajouter = (cus, r) => { const l = parClient.get(cus) ?? []; if (!l.some(x => x.telegramId === r.telegramId)) l.push(r); parClient.set(cus, l) }
let resolutions = 0
const parEmail = new Map()
for (const r of rattaches) {
  const clientMelanie = r.clientStripe && (r.compte == null || r.compte === 'melanie') ? r.clientStripe : null
  if (clientMelanie) { ajouter(clientMelanie, r); if (clientsLiveClub.has(clientMelanie)) continue }
  const email = pur.normaliserEmail(r.email)
  if (!email || resolutions >= 300) continue
  let clients = parEmail.get(email)
  if (!clients) {
    resolutions++
    try { clients = await stripe.clientsStripeParEmail(email) } catch { continue }
    parEmail.set(email, clients)
  }
  for (const cus of clients) ajouter(cus, r)
}

// ---------------------------------------------------------------------------
// (g) Impayes
// ---------------------------------------------------------------------------
const reelImpayes = config.sortiesImpayesActives()
const compte = { en_retard: 0, en_grace: 0, a_sortir: 0, illisibles: 0, sans_facture_datee: 0, sans_compte: 0, simules: 0, gardes: 0, absents: 0, inconnus: 0, deja_traites: 0 }
const cas = []
for (const a of abonnements) {
  if (!pur.enRetardDePaiement(a.statut)) continue
  compte.en_retard++
  const etat = pur.etatImpaye(a, maintenantMs)
  const decision = regles.decisionSortieImpaye(etat, reelImpayes)
  if (etat === 'sans_facture') { compte.sans_facture_datee++; continue }
  if (decision === 'grace') { compte.en_grace++; continue }
  if (decision === 'inconnu') { compte.illisibles++; continue }
  if (decision === 'rien') continue
  compte.a_sortir++
  const jours = pur.joursDepuisPremierEchec(a, maintenantMs)
  const siens = a.clientStripe ? parClient.get(a.clientStripe) ?? [] : []
  if (!siens.length) {
    compte.sans_compte++
    cas.push({ jours, statut: a.statut, etat, rattache: 'non', present: '-', exempte: '-', decision: 'aucun compte Telegram rattache : rien' })
    continue
  }
  for (const r of siens) {
    const deja = (await prisma.$queryRaw`
      select 1 as ok from public.cockpit_liveclub_gestes
      where geste = 'retrait' and regle = 'impaye_5j' and resultat = any(${reelImpayes ? ['fait'] : ['fait', 'simule']}::text[])
        and abonnement_id = ${a.id} and telegram_id = ${r.telegramId}::bigint
        and (${a.impaye?.factureId ?? null}::text is null or details->>'facture_id' = ${a.impaye?.factureId ?? null}::text)
      limit 1`).length > 0
    let exempte = 'inconnu'
    try { exempte = (await exemptionActive(r.telegramId)) ? 'oui' : 'non' } catch {}
    const p = await presence(r.telegramId)
    const ligne = { jours, statut: a.statut, etat, rattache: 'oui', present: p.etat, statut_tg: p.statut, exempte }
    if (deja) { compte.deja_traites++; cas.push({ ...ligne, decision: 'deja traite pour cette facture' }); continue }
    if (p.etat === 'inconnu') { compte.inconnus++; cas.push({ ...ligne, decision: 'presence inconnue : rien' }); continue }
    if (p.etat === 'non') { compte.absents++; cas.push({ ...ligne, decision: 'absent du groupe : rien' }); continue }
    if (regles.estIntouchable(p)) { compte.gardes++; cas.push({ ...ligne, decision: 'admin ou createur : garde' }); continue }
    const email = r.email ?? null
    const d = await droitAvantSortie(r.telegramId, [email])
    if (d.statut === 'inconnu') { compte.inconnus++; cas.push({ ...ligne, decision: 'droit inconnu : rien' }); continue }
    if (d.statut === 'oui') { compte.gardes++; cas.push({ ...ligne, decision: `garde (autre droit : ${d.raison})` }); continue }
    compte.simules++
    cas.push({ ...ligne, decision: decision === 'sortir' ? 'SORTIE REELLE' : 'sortie SIMULEE' })
  }
}

// ---------------------------------------------------------------------------
// (i) Fenetre de 30 jours, (j) bienvenue, (h) reouvertures : comptes seulement
// ---------------------------------------------------------------------------
const fenetre = abonnements.filter(a => pur.etatImpaye(a, maintenantMs) === 'fenetre_depassee').length

const candidats = abonnements.filter(a => regles.bienvenueARattraper(a, maintenant, { rattache: false, emailDejaEnvoye: false, dejaTraite: false }))
let bienvenue = { candidats: candidats.length, rattaches: 0, deja_envoyes: 0, a_rattraper: 0 }
if (candidats.length) {
  const ids = candidats.map(a => a.id)
  const servis = new Set((await prisma.$queryRaw`
    select distinct abonnement_id from public.cockpit_liveclub_jetons
    where abonnement_id = any(${ids}::text[]) and (email_envoye_le is not null or utilise_le is not null)`).map(l => l.abonnement_id))
  for (const a of candidats) {
    const rattache = (parClient.get(a.clientStripe) ?? []).length > 0
    if (rattache) bienvenue.rattaches++
    else if (servis.has(a.id)) bienvenue.deja_envoyes++
    else bienvenue.a_rattraper++
  }
}

const sortiesMetricgram = await prisma.$queryRaw`
  select telegram_id, sorti_le from public.cockpit_telegram_membres
  where present = false and sorti_le is not null and par_qui ilike '%metric%'
    and sorti_le > now() - interval '45 days'
  order by sorti_le desc`
const actifsParCompte = new Map()
for (const a of abonnements) {
  if ((a.statut !== 'active' && a.statut !== 'trialing') || a.pauseActive || !a.clientStripe) continue
  for (const r of parClient.get(a.clientStripe) ?? []) actifsParCompte.set(r.telegramId, [...actifsParCompte.get(r.telegramId) ?? [], a])
}
const derniereReouverture = new Map((await prisma.$queryRaw`
  select telegram_id, max(fait_le) as fait_le from public.cockpit_liveclub_gestes
  where geste = 'invitation' and telegram_id is not null
    and ((regle = 'reouverture_impaye' and resultat in ('fait', 'refuse')) or (regle = 'sortie_abusive_metricgram' and resultat = 'fait'))
  group by telegram_id`).map(f => [Number(f.telegram_id), f.fait_le.getTime()]))
const reouvertures = { sorties_metricgram_45j: sortiesMetricgram.length, avec_abonnement_actif: 0, deja_faites: 0, facture_reglee_apres_sortie: 0, a_envoyer: 0 }
const vus = new Set()
for (const l of sortiesMetricgram) {
  const tid = Number(l.telegram_id)
  if (vus.has(tid)) continue
  vus.add(tid)
  const actifs = actifsParCompte.get(tid)
  if (!actifs?.length) continue
  if ((derniereReouverture.get(tid) ?? 0) >= l.sorti_le.getTime()) { reouvertures.deja_faites++; continue }
  reouvertures.avec_abonnement_actif++
  let reglee = false
  for (const a of actifs) {
    try { if (regles.factureRegleeApresSortie(await stripe.facturesPayeesAbonnement(a.id), l.sorti_le)) { reglee = true; break } } catch {}
  }
  if (!reglee) continue
  reouvertures.facture_reglee_apres_sortie++
  const p = await presence(tid)
  const d = p.etat === 'non' ? (await droitLiveClub(tid)).statut : 'inconnu'
  if (regles.decisionReouverture(true, p.etat, d, false) === 'envoyer') reouvertures.a_envoyer++
}

await prisma.$disconnect()

console.log(`Apercu du ${maintenant.toISOString().slice(0, 16)} UTC (lecture seule). Interrupteurs : sorties impayes ${reelImpayes ? 'ACTIVES' : 'simulees'}, bascule ${config.sortiesActives() ? 'ACTIVE' : 'non'}.`)
console.log(`Abonnements Live Club lus : ${abonnements.length} ; comptes Telegram rattaches : ${rattaches.length}.`)
console.log('\n(g) IMPAYES :', JSON.stringify(compte))
cas.sort((x, y) => (y.jours ?? 0) - (x.jours ?? 0))
cas.forEach((c, i) => console.log(`  ${i + 1}. ${c.jours} j depuis le 1er echec, ${c.statut} (${c.etat}), rattache ${c.rattache}, present ${c.present}${c.statut_tg ? ` (${c.statut_tg})` : ''}, exempte ${c.exempte} -> ${c.decision}`))
console.log(`\n(i) FENETRE 30 JOURS : ${fenetre} abonnement(s) au-dela de 30 jours (resiliation ${config.sortiesActives() ? 'REELLE' : 'SIMULEE'}).`)
console.log('(j) BIENVENUE :', JSON.stringify(bienvenue), `(${config.sortiesActives() ? 'REEL' : 'SIMULE'})`)
console.log('(h) REOUVERTURES (reelles meme avant la bascule) :', JSON.stringify(reouvertures))
console.log(`\nAvertissements des modules (masques) : ${avertissements}.`)
