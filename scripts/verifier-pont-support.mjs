// PREUVE que le pont Support du bot Live Club ECRIT reellement (30/09).
//
// Constat : l'ecran Support du cockpit ne montrait aucun fil Telegram
// ("SupportThread" avec "telegramId" : 0 ligne). Ce script execute les
// fonctions du pont (src/lib/liveclub/support-pont.ts) CONTRE LA VRAIE BASE,
// dans une transaction TOUJOURS ANNULEE (exception finale) : rien ne reste.
// Il verifie, dans la transaction :
// 1. qu'une ligne "SupportThread" avec ce telegramId apparait (app
//    'telegram', userId 'telegram:<id>'), avec les messages dans l'ordre ;
// 2. qu'aucun lien d'invitation, jeton ni code n'y entre en clair ;
// 3. qu'une demande d'humain allume escalatedAt ;
// 4. qu'un GESTE journalise (journaliserGesteLiveClub, stripe-actions.ts)
//    'fait' ajoute sa ligne « [système] » au fil, qu'un geste 'simule' n'en
//    ajoute pas, et qu'un geste sans telegram_id ne cree aucun fil ;
// 5. que la vue du cockpit (cockpit_support_threads) la montre a un compte de
//    l'allowlist (role authenticated simule, comme PostgREST), et pas a un
//    compte hors allowlist ;
// puis, apres l'annulation, qu'il ne reste aucune ligne (fil ni geste).
//
// Aucun email : les cles Resend sont retirees de l'environnement avant tout
// import (l'alerte d'equipe d'une demande d'humain ne part donc pas).
// Compte Telegram FICTIF (9 000 000 000 001, hors des id reels), aucune
// donnee de membre lue ni affichee.
//
// Lancement (Node 22, depuis apps/journal-d-etude) :
//   set -a && . ./.env && set +a && node scripts/verifier-pont-support.mjs

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

delete process.env.RESEND_API_KEY
delete process.env.RESEND_API_KEY_SUPPORT

// Meme crochet de resolution que scripts/eval-fuites.mjs : alias '@/...' et
// imports sans extension ramenes au .ts, charge par Node 22 sans les types.
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
const pont = await import('../src/lib/liveclub/support-pont.ts')
const { journaliserGesteLiveClub } = await import('../src/lib/stripe-actions.ts')
const ACTEUR_TEST = 'test:verifier-pont-support'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL absente : charger le .env du journal (set -a && . ./.env && set +a).')
  process.exit(1)
}
// Connexion directe si elle existe (une transaction interactive y est plus sure que par le pooler).
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasources: { db: { url: process.env.DIRECT_URL } } } : undefined)

const FAUX = 9_000_000_000_001
const LIEN_INVITATION = 'https://t.me/+FAUXLIENINVITATION42'
class Annulation extends Error {}

// Le pont ne jette jamais : une ecriture ratee ne se voit que dans son log.
const erreursPont = []
const consoleError = console.error
console.error = (...a) => { erreursPont.push(a.map(String).join(' ')); consoleError(...a) }

const avant = await prisma.$queryRaw`select count(*)::int as n from public."SupportThread" where "telegramId" = ${FAUX}::bigint`
assert.equal(avant[0].n, 0, 'le compte fictif a deja un fil : rien n est lance')

let constats = null
try {
  await prisma.$transaction(async tx => {
    await pont.enregistrerEchangeSupport({ telegramId: FAUX, role: 'membre', texte: '/start [jeton]' }, tx)
    await pont.tracerEtape(FAUX, "Demande d'adhésion au groupe reçue", {}, tx)
    await pont.tracerMessageBot(FAUX, `Voilà ton lien : ${LIEN_INVITATION} et ton code 482 913. Rouvre https://t.me/aok_liveclub_bot?start=AbCdEfGhIjKlMnOpQrStUvWx`, {
      boutons: [[{ texte: 'Rejoindre le groupe', url: LIEN_INVITATION }], [{ texte: 'Mon abonnement', data: 'm:abo' }]],
    }, tx)
    await pont.enregistrerEchangeSupport({ telegramId: FAUX, role: 'membre', texte: '[bouton] Contacter l\'équipe', veutHumain: true }, tx)
    await pont.tracerMessageBot(FAUX, 'Message refusé par Telegram.', { livre: false }, tx)
    // Un groupe (id negatif) n'a jamais de fil.
    await pont.enregistrerEchangeSupport({ telegramId: -1001234567890, role: 'ia', texte: 'groupe' }, tx)

    // Les gestes, par le vrai journal : 'fait' -> une ligne ; 'simule' -> rien ;
    // sans telegram_id -> ni fil ni ligne.
    const ecrit = await journaliserGesteLiveClub(
      { geste: 'pause', resultat: 'fait', regle: 'demande_membre', details: { etape: 'pause_programmee', nb_mois: 2, paye_jusquau: '2099-10-15', reprise_le: '2099-12-15' } },
      { telegramId: FAUX, acteur: ACTEUR_TEST, updateId: null }, tx)
    assert.equal(ecrit, 'ecrit', 'le geste est journalise')
    await journaliserGesteLiveClub(
      { geste: 'retrait', resultat: 'simule', regle: 'desabonne', details: {} },
      { telegramId: FAUX, acteur: ACTEUR_TEST, updateId: null }, tx)
    await journaliserGesteLiveClub(
      { geste: 'rappel', resultat: 'fait', regle: 'prelevement_j3', details: {} },
      { telegramId: null, acteur: ACTEUR_TEST, updateId: null }, tx)

    assert.deepEqual(erreursPont, [], 'le pont a journalise une erreur d ecriture')

    const fils = await tx.$queryRaw`
      select id, "userId" as user_id, app, messages, "escalatedAt" as escalated_at, "membreId" as membre_id
      from public."SupportThread" where "telegramId" = ${FAUX}::bigint`
    assert.equal(fils.length, 1, 'une ligne SupportThread pour ce telegramId')
    const f = fils[0]
    assert.equal(f.app, 'telegram')
    assert.equal(f.user_id, `telegram:${FAUX}`)
    assert.equal(f.membre_id, null, 'compte non rattache : pas de membre')
    assert.ok(f.escalated_at instanceof Date, 'la demande d humain allume escalatedAt')
    const messages = f.messages
    assert.equal(messages.length, 6)
    assert.deepEqual(messages.map(m => m.role), ['user', 'system', 'assistant', 'user', 'assistant', 'system'])
    assert.equal(messages[1].content, "[système] Demande d'adhésion au groupe reçue")
    assert.equal(messages[5].content, "[système] Pause programmée, groupe gardé jusqu'au 15 octobre 2099, reprise le 15 décembre 2099.")
    const gestes = await tx.$queryRaw`select count(*)::int as n from public.cockpit_liveclub_gestes where acteur = ${ACTEUR_TEST}`
    assert.equal(gestes[0].n, 3, 'les trois gestes sont dans le journal (le simule et celui sans compte compris)')
    const sansCompte = await tx.$queryRaw`select count(*)::int as n from public."SupportThread" where "telegramId" is null and app = 'telegram'`
    assert.equal(sansCompte[0].n, 0, 'aucun fil pour un geste sans telegram_id')
    const tout = JSON.stringify(messages)
    assert.ok(!tout.includes('FAUXLIENINVITATION42'), 'lien d invitation en clair')
    assert.ok(!tout.includes('482 913'), 'code en clair')
    assert.ok(!tout.includes('AbCdEfGhIjKlMnOpQrStUvWx'), 'jeton en clair')
    assert.ok(messages[2].content.includes('[boutons : Rejoindre le groupe | Mon abonnement]'))
    assert.ok(messages[4].content.startsWith('[non délivré] '))
    const groupe = await tx.$queryRaw`select count(*)::int as n from public."SupportThread" where "telegramId" < 0`
    assert.equal(groupe[0].n, 0, 'aucun fil pour un groupe')

    // La vue du cockpit, lue comme PostgREST la lit : role authenticated et
    // claims du jeton. Un compte de l'allowlist voit le fil, un autre non.
    const allow = await tx.$queryRaw`select user_id::text as id from public.cockpit_allowlist limit 1`
    assert.equal(allow.length, 1, 'allowlist vide : la vue ne peut pas etre verifiee')
    await tx.$executeRawUnsafe('set local role authenticated')
    const voir = async sub => {
      await tx.$queryRaw`select set_config('request.jwt.claims', ${JSON.stringify({ sub, role: 'authenticated' })}, true)`
      return tx.$queryRaw`select app, telegram_id, jsonb_array_length(messages)::int as n from public.cockpit_support_threads where telegram_id = ${FAUX}::bigint`
    }
    const vu = await voir(allow[0].id)
    assert.equal(vu.length, 1, 'la vue cockpit_support_threads montre le fil a l allowlist')
    assert.equal(vu[0].app, 'telegram')
    assert.equal(vu[0].n, 6)
    const horsAllowlist = await voir('00000000-0000-4000-8000-000000000000')
    assert.equal(horsAllowlist.length, 0, 'hors allowlist : rien')

    constats = { messages: messages.length, vue: vu.length, horsAllowlist: horsAllowlist.length }
    throw new Annulation('transaction annulee expres')
  }, { timeout: 30_000, maxWait: 10_000 })
} catch (err) {
  if (!(err instanceof Annulation)) {
    console.error = consoleError
    console.error(`ECHEC : ${String(err?.message ?? err).split('\n').slice(-4).join(' ')}`)
    await prisma.$disconnect()
    process.exit(1)
  }
}
console.error = consoleError

const apres = await prisma.$queryRaw`select count(*)::int as n from public."SupportThread" where "telegramId" = ${FAUX}::bigint`
const gestesApres = await prisma.$queryRaw`select count(*)::int as n from public.cockpit_liveclub_gestes where acteur = ${ACTEUR_TEST}`
await prisma.$disconnect()
assert.equal(apres[0].n, 0, 'la transaction n a pas ete annulee (fil)')
assert.equal(gestesApres[0].n, 0, 'la transaction n a pas ete annulee (gestes)')
console.log(`ok  le pont ecrit : fil Telegram cree (${constats.messages} messages : commande, etape systeme, message du bot avec boutons, demande d'humain, non delivre, geste), rien en clair`)
console.log("ok  gestes : 'fait' ajoute sa ligne au fil, 'simule' non, sans telegram_id aucun fil")
console.log(`ok  la vue cockpit_support_threads le montre a l'allowlist (${constats.vue} ligne), pas hors allowlist (${constats.horsAllowlist})`)
console.log('ok  transaction annulee : aucune ligne restee en base (fil et gestes)')
