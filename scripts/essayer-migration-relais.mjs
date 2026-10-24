/**
 * ESSAI de la migration du relais d'accueil (20261024120000_cockpit_liveclub_relais.sql)
 * contre la vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, ordre par ordre (meme decoupage que appliquer-migration.mjs), jouee deux fois (rejouable) ;
 *   2. les contraintes refusent ce qu'elles doivent refuser (savepoints) ;
 *   3. RLS : anon et un compte connecte hors cockpit ne voient rien, un membre du cockpit lit,
 *      peut couper (actif, trigger) mais pas renommer, et ne peut pas poser une marque au nom d'un relais ;
 *   4. l'APERCU exact de ce qu'Alex recevrait aujourd'hui (apercuRelais, donnees reelles,
 *      statut en direct par getChatMember : une lecture, aucun message).
 * Puis la transaction est annulee et on verifie que la table n'existe pas.
 *
 * Lancement (apps/journal-d-etude, .env.local charge) : node scripts/essayer-migration-relais.mjs
 * N'affiche aucun email ni aucune cle.
 */
import assert from 'node:assert/strict'
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

const { PrismaClient } = await import('@prisma/client')
const { apercuRelais, ficheMembrePourRelais } = await import('../src/lib/liveclub/relais.ts')

const FICHIER = path.join(RACINE, '../../sites/Aoknowledgecom/supabase/migrations/20261024120000_cockpit_liveclub_relais.sql')
function decouper(sql) {
  const ordres = []; let courant = ''; let tag = null; let i = 0
  while (i < sql.length) {
    if (!tag) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (dollar) { tag = dollar[0]; courant += tag; i += tag.length; continue }
      if (sql[i] === ';') { if (courant.trim()) ordres.push(courant.trim()); courant = ''; i += 1; continue }
    } else if (sql.startsWith(tag, i)) { courant += tag; i += tag.length; tag = null; continue }
    courant += sql[i]; i += 1
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}
const ORDRES = decouper(readFileSync(FICHIER, 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n'))
  .filter(o => !/^notify /i.test(o))

const p = new PrismaClient()
const ANNULER = new Error('annulation volontaire')
let ok = 0
const bloc = (t) => { ok++; console.log('ok ', t) }

async function refuse(tx, nom, sql) {
  await tx.$executeRawUnsafe('savepoint s')
  let refuse = false
  try { await tx.$executeRawUnsafe(sql) } catch { refuse = true }
  await tx.$executeRawUnsafe('rollback to savepoint s')
  assert.ok(refuse, `devait etre refuse : ${nom}`)
}
async function commeRole(tx, role, uid, fn) {
  await tx.$executeRawUnsafe('savepoint r')
  await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid ?? '', role })}', true)`)
  await tx.$executeRawUnsafe(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', true)`)
  await tx.$executeRawUnsafe(`set local role ${role}`)
  let r, erreur = null
  try { r = await fn() } catch (e) { erreur = e }
  await tx.$executeRawUnsafe('rollback to savepoint r')
  await tx.$executeRawUnsafe('reset role')
  if (erreur) throw erreur
  return r
}

let apercu = null
let fiche = null, liste = null
try {
  await p.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    for (let passe = 0; passe < 2; passe++) for (const o of ORDRES) await tx.$executeRawUnsafe(o)
    bloc(`migration jouee deux fois (${ORDRES.length} ordres), rejouable`)

    const [a] = await tx.$queryRawUnsafe(`select nom, motifs::text as motifs, actif from public.cockpit_liveclub_relais where telegram_id = 2110821350`)
    assert.equal(a?.nom, 'Alex'); assert.equal(a?.motifs, '{accueil,silence}'); assert.equal(a?.actif, true)
    bloc('Alex est le premier relais, motifs accueil et silence, actif')

    await refuse(tx, 'motif echec', `insert into public.cockpit_liveclub_relais (telegram_id, nom, motifs) values (11, 'X', array['echec'])`)
    await refuse(tx, 'motif prelevement', `insert into public.cockpit_liveclub_relais (telegram_id, nom, motifs) values (12, 'X', array['accueil','prelevement'])`)
    await refuse(tx, 'episode echec', `insert into public.cockpit_liveclub_relais_episodes (relais_id, membre_id, cle_episode, motif)
      select 2110821350, membre_id, 'a_risque:echec:x', 'echec' from public.cockpit_membres limit 1`)
    await refuse(tx, 'cle et motif differents', `insert into public.cockpit_liveclub_relais_episodes (relais_id, membre_id, cle_episode, motif)
      select 2110821350, membre_id, 'a_risque:silence:x', 'accueil' from public.cockpit_membres limit 1`)
    await refuse(tx, 'marque sans auteur', `insert into public.cockpit_actions_traitees (membre_id, motif, traite_par, traite_par_telegram)
      select membre_id, 'a_risque:silence:essai', null, null from public.cockpit_membres limit 1`)
    bloc('contraintes : echec et prelevement refuses, cle et motif coherents, une marque a toujours un auteur')

    const pols = await tx.$queryRawUnsafe(`select policyname, cmd from pg_policies where tablename = 'cockpit_actions_traitees' and cmd in ('INSERT','ALL')`)
    assert.deepEqual(pols.map(x => x.policyname), ['cockpit_actions_traitees_insert'])
    bloc('une seule politique d insertion sur cockpit_actions_traitees (la nouvelle)')

    const [membre] = await tx.$queryRawUnsafe(`select user_id::text as uid from public.cockpit_allowlist where label = 'Brice' limit 1`)
    const inconnu = '11111111-2222-3333-4444-555555555555'
    const vuAnon = await commeRole(tx, 'anon', null, () => tx.$queryRawUnsafe(`select count(*)::int n from public.cockpit_liveclub_relais`).then(r => r[0].n).catch(() => 'refuse'))
    const vuInconnu = await commeRole(tx, 'authenticated', inconnu, () => tx.$queryRawUnsafe(`select count(*)::int n from public.cockpit_liveclub_relais`).then(r => r[0].n))
    assert.ok(vuAnon === 'refuse' || vuAnon === 0); assert.equal(vuInconnu, 0)
    const coupe = await commeRole(tx, 'authenticated', membre.uid, async () => {
      const n = (await tx.$queryRawUnsafe(`select count(*)::int n from public.cockpit_liveclub_relais`))[0].n
      await tx.$executeRawUnsafe(`update public.cockpit_liveclub_relais set actif = false where telegram_id = 2110821350`)
      const [r] = await tx.$queryRawUnsafe(`select actif, coupe_le is not null as date, coupe_par::text as par from public.cockpit_liveclub_relais where telegram_id = 2110821350`)
      let renomme = true
      await tx.$executeRawUnsafe('savepoint n')
      try { await tx.$executeRawUnsafe(`update public.cockpit_liveclub_relais set nom = 'Autre' where telegram_id = 2110821350`) } catch { renomme = false }
      await tx.$executeRawUnsafe('rollback to savepoint n')
      let marqueRelais = true
      await tx.$executeRawUnsafe('savepoint m')
      try {
        await tx.$executeRawUnsafe(`insert into public.cockpit_actions_traitees (membre_id, motif, traite_par, traite_par_telegram)
          select membre_id, 'a_risque:silence:essai', '${membre.uid}'::uuid, 2110821350 from public.cockpit_membres limit 1`)
      } catch { marqueRelais = false }
      await tx.$executeRawUnsafe('rollback to savepoint m')
      return { n, r, renomme, marqueRelais }
    })
    assert.equal(coupe.n, 1); assert.equal(coupe.r.actif, false); assert.equal(coupe.r.date, true); assert.equal(coupe.r.par, membre.uid)
    assert.equal(coupe.renomme, false); assert.equal(coupe.marqueRelais, false)
    bloc('RLS : anon et hors cockpit 0 ligne, un membre du cockpit lit et coupe (trigger : date et auteur), ne renomme pas, ne marque pas au nom du relais')

    apercu = await apercuRelais(tx, { enDirect: true })
    assert.equal(apercu.etat, 'apercu')
    const texte = JSON.stringify(apercu)
    assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(texte), 'aucun email')
    assert.ok(!/\d+[.,]?\d*\s?(€|eur)/i.test(texte), 'aucun montant')
    assert.ok(!/(echec|prelev|paiement|abonnement)/i.test(texte), 'aucune info de paiement')
    bloc(`apercu sur les donnees reelles : ${apercu.lignes} membre(s), ${apercu.messages} message(s), sans email ni montant ni paiement`)
    // Les questions d'Alex a l'agent (24/10) : on simule l'envoi des episodes silence, puis on demande une fiche.
    await tx.$executeRawUnsafe(`insert into public.cockpit_liveclub_relais_episodes (relais_id, membre_id, cle_episode, motif, envoye_le)
      select 2110821350, membre_id, cle_episode, motif, now() from public.cockpit_membres_risque where motif = 'silence'
      on conflict do nothing`)
    liste = await ficheMembrePourRelais(2110821350, { recherche: '' }, tx)
    assert.ok(Array.isArray(liste.membres_transmis) && liste.membres_transmis.length > 0)
    fiche = await ficheMembrePourRelais(2110821350, { recherche: '@lcmalone' }, tx)
    assert.ok(Array.isArray(fiche.membres) && fiche.membres.length === 1, JSON.stringify(fiche).slice(0, 300))
    const refus = await ficheMembrePourRelais(123456, { recherche: 'lcmalone' }, tx)
    assert.ok(refus.erreur && !refus.membres)
    const hors = await ficheMembrePourRelais(2110821350, { recherche: 'personne-inexistante-xyz' }, tx)
    assert.ok(!hors.membres)
    const t = JSON.stringify(fiche.membres)
    assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(t) && !/(echec|prelev|paiement|abonnement|stripe)/i.test(t), 'fiche sans email ni paiement')
    bloc('fiche du relais : liste des transmis, fiche par @pseudo, refus pour un non-relais et hors liste, sans email ni paiement')
    throw ANNULER
  }, { timeout: 120_000, maxWait: 20_000 })
} catch (e) {
  if (e !== ANNULER) { console.error('ECHEC :', e.message); await p.$disconnect(); process.exit(1) }
}
const [reste] = await p.$queryRawUnsafe(`select to_regclass('public.cockpit_liveclub_relais') is null as absente`)
assert.equal(reste.absente, true)
bloc('transaction annulee : rien n est reste en base')
await p.$disconnect()

console.log('\nFICHE (question d Alex sur @lcmalone) :', JSON.stringify(fiche, null, 1))
console.log(`\n${ok} blocs verifies, tout est bon.\n\nAPERCU (ce qu'Alex recevrait aujourd'hui, rien n'est envoye) :`)
for (const a of apercu?.apercus ?? []) for (const [i, m] of a.messages.entries()) {
  console.log(`\n--- message ${i + 1} a ${a.relais} ---\n${m.texte}\n[boutons] ${m.boutons.join(' | ')}`)
}
