/**
 * ESSAI de la migration des @handles des reseaux (20261113235500_cockpit_handles_sociaux.sql)
 * contre la vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, ordre par ordre (meme decoupage que appliquer-migration.mjs), jouee deux fois ;
 *   2. les contraintes refusent ce qu'elles doivent refuser (savepoints) ;
 *   3. RLS : anon et un compte connecte hors cockpit ne lisent rien et n'ecrivent rien, un membre
 *      du cockpit lit mais n'ecrit pas ;
 *   4. le VRAI serveur du lot (traiterLot de src/lib/tab/handles.ts) sur un faux lot : numero de
 *      membre, equipe, a identifier, refus ; le meme lot rejoue = inchange ; un « sur » pose a la
 *      main n'est pas retrograde.
 * Puis la transaction est annulee et on verifie que la table n'existe pas (avant application).
 *
 * Lancement (apps/journal-d-etude, .env charge) :
 *   node scripts/essayer-migration-handles-sociaux.mjs [chemin de la migration]
 * Par defaut la migration est lue dans ../../sites/... (checkout principal). N'affiche aucun email.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import './resoudre-ts.mjs'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { PrismaClient } = await import('@prisma/client')
const { traiterLot } = await import('../src/lib/tab/handles.ts')
const { lireLot } = await import('../src/lib/tab/handles-pur.ts')

const FICHIER = process.argv[2] ?? path.join(RACINE, '../../sites/Aoknowledgecom/supabase/migrations/20261113235500_cockpit_handles_sociaux.sql')
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
const ORDRES = decouper(readFileSync(FICHIER, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'))
  .filter((o) => !/^notify /i.test(o))

const p = new PrismaClient()
const ANNULER = new Error('annulation volontaire')
let ok = 0
const bloc = (t) => { ok++; console.log('ok ', t) }

async function refuse(tx, nom, sql, ...params) {
  await tx.$executeRawUnsafe('savepoint s')
  let refuse = false
  try { await tx.$executeRawUnsafe(sql, ...params) } catch { refuse = true }
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
async function essaiRole(tx, sql) {
  await tx.$executeRawUnsafe('savepoint e')
  try { const r = await tx.$queryRawUnsafe(sql); await tx.$executeRawUnsafe('release savepoint e'); return r }
  catch { await tx.$executeRawUnsafe('rollback to savepoint e'); return 'refus' }
}

const AUJ = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })
const [{ existe }] = await p.$queryRawUnsafe(`select to_regclass('public.cockpit_handles_sociaux') is not null as existe`)
if (existe) { console.error('La table existe deja : cet essai sert AVANT application.'); process.exit(2) }

try {
  await p.$transaction(async (tx) => {
    for (const passe of [1, 2]) for (const o of ORDRES) await tx.$executeRawUnsafe(o)
    bloc(`migration jouee deux fois (${ORDRES.length} ordres, idempotente)`)

    const [t] = await tx.$queryRawUnsafe(`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.cockpit_handles_sociaux'::regclass`)
    assert.equal(t.relrowsecurity, true); assert.equal(t.relforcerowsecurity, true)
    const grants = await tx.$queryRawUnsafe(`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cockpit_handles_sociaux' and grantee in ('anon', 'authenticated', 'public')`)
    assert.deepEqual(grants.map((g) => `${g.grantee}:${g.privilege_type}`), ['authenticated:SELECT'])
    const pol = await tx.$queryRawUnsafe(`select policyname, cmd, roles::text as roles, qual from pg_policies where tablename = 'cockpit_handles_sociaux'`)
    assert.equal(pol.length, 1); assert.equal(pol[0].cmd, 'SELECT'); assert.equal(pol[0].roles, '{authenticated}'); assert.match(pol[0].qual, /is_cockpit_member\(\)/)
    bloc('RLS activee et forcee, anon et public sans droit, authenticated en lecture seule sous is_cockpit_member()')

    const ins = (cols, vals) => `insert into public.cockpit_handles_sociaux (${cols}) values (${vals})`
    await refuse(tx, 'handle avec @', ins('plateforme, handle, pose_par', `'tiktok', '@abc', 'tab'`))
    await refuse(tx, 'handle en majuscules', ins('plateforme, handle, pose_par', `'tiktok', 'Abc', 'tab'`))
    await refuse(tx, 'plateforme invalide', ins('plateforme, handle, pose_par', `'Tik Tok', 'abc', 'tab'`))
    await refuse(tx, 'statut inconnu', ins('plateforme, handle, statut, equipe, pose_par', `'tiktok', 'abc', 'certain', 'Mel', 'tab'`))
    await refuse(tx, 'sur sans personne', ins('plateforme, handle, statut, pose_par', `'tiktok', 'abc', 'sur', 'tab'`))
    await refuse(tx, 'a_identifier avec une personne', ins('plateforme, handle, statut, equipe, pose_par', `'tiktok', 'abc', 'a_identifier', 'Mel', 'tab'`))
    await refuse(tx, 'pose_par inconnu', ins('plateforme, handle, pose_par', `'tiktok', 'abc', 'robot'`))
    await refuse(tx, 'preuve sur deux lignes', ins('plateforme, handle, preuve, pose_par', `'tiktok', 'abc', 'a' || chr(10) || 'b', 'tab'`))
    await refuse(tx, 'dates inversees', ins('plateforme, handle, premier_vu, dernier_vu, pose_par', `'tiktok', 'abc', '2026-11-10', '2026-11-01', 'tab'`))
    await refuse(tx, 'fiche inexistante', ins('plateforme, handle, statut, membre_id, pose_par', `'tiktok', 'abc', 'sur', '00000000-0000-4000-8000-000000000009', 'tab'`))
    await tx.$executeRawUnsafe(ins('plateforme, handle, pose_par', `'tiktok', 'essai.rls', 'main:Brice'`))
    await refuse(tx, 'doublon plateforme + handle', ins('plateforme, handle, pose_par', `'tiktok', 'essai.rls', 'tab'`))
    bloc('contraintes : handle normalise, statut, identite selon le statut, pose_par, preuve d une ligne, dates, fiche, unicite')

    const [brice] = await tx.$queryRawUnsafe(`select user_id::text as id from public.cockpit_allowlist where label = 'Brice'`)
    const [ordinaire] = await tx.$queryRawUnsafe(`select p.id::text as id from public.profiles p where p.client_number = 248 and not exists (select 1 from public.cockpit_allowlist a where a.user_id = p.id)`)
    assert.ok(brice?.id && ordinaire?.id, 'comptes d essai introuvables')
    const lire = `select count(*)::int as n from public.cockpit_handles_sociaux`
    const ecrire = [
      `insert into public.cockpit_handles_sociaux (plateforme, handle, pose_par) values ('tiktok', 'pirate', 'tab') returning 1`,
      `update public.cockpit_handles_sociaux set interactions = 99 returning 1`,
      `delete from public.cockpit_handles_sociaux returning 1`,
    ]
    for (const [qui, role, uid, doitLire] of [['anon', 'anon', null, false], ['compte inconnu', 'authenticated', '00000000-0000-4000-8000-000000000001', false],
      ['membre ordinaire (n 248)', 'authenticated', ordinaire.id, false], ['Brice (cockpit)', 'authenticated', brice.id, true]]) {
      const r = await commeRole(tx, role, uid, async () => {
        const l = await essaiRole(tx, lire)
        const e = []
        for (const s of ecrire) e.push(await essaiRole(tx, s))
        return { l, e }
      })
      if (doitLire) assert.ok(Array.isArray(r.l) && r.l[0].n === 1, `${qui} devait lire`)
      else assert.ok(r.l === 'refus' || r.l[0].n === 0, `${qui} ne devait rien lire`)
      for (const x of r.e) assert.ok(x === 'refus' || x.length === 0, `${qui} a pu ecrire`)
    }
    bloc('RLS : anon, un compte inconnu et un membre ordinaire ne lisent rien ; Brice lit ; personne n ecrit par le navigateur')

    // Le vrai serveur du lot, sur un faux lot.
    const lot = lireLot({
      lignes: [
        { plateforme: 'tiktok', handle: '@essai.alex', statut: 'sur', qui: '248', preuve: 'essai', source: 'essai', interactions: 5, dernier_echange: '2026-11-08' },
        { plateforme: 'tiktok', handle: 'essai.mel', statut: 'sur', qui: 'équipe : Mélanie', preuve: 'essai', source: 'essai', interactions: 4, dernier_echange: '2026-11-09' },
        { plateforme: 'tiktok', handle: 'essai.inconnu', statut: 'a_identifier', qui: '', preuve: 'essai', source: 'essai', interactions: 1 },
        { plateforme: 'tiktok', handle: 'essai.fiche', statut: 'probable', qui: 'membre:00000000-0000-4000-8000-000000000009', interactions: 1 },
        { plateforme: 'tiktok', handle: 'essai.numero', statut: 'probable', qui: '999999999', interactions: 1 },
        { plateforme: 'tiktok', handle: 'essai.email', statut: 'probable', qui: 'personne@exemple.fr' },
      ],
    }, AUJ)
    assert.equal(typeof lot, 'object')
    const a = await traiterLot(tx, lot, 'tab', AUJ)
    assert.deepEqual(a.resultats.map((r) => `${r.handle}:${r.action}:${r.statut}`), ['essai.alex:cree:sur', 'essai.mel:cree:sur', 'essai.inconnu:cree:a_identifier'])
    assert.match(a.resultats[0].rattache_a, /^fiche .+ · membre n° 248$/)
    assert.match(a.resultats[1].rattache_a, /équipe : Mélanie · fonds Mélanie/)
    assert.deepEqual(a.refusees.map((r) => r.rang), [4, 5, 6])
    assert.ok(!JSON.stringify(a).includes('@exemple.fr'))
    const lignes = await tx.$queryRawUnsafe(`select handle, statut, membre_id is not null as fiche, personne_id, numero_membre::int as numero, equipe, pose_par from public.cockpit_handles_sociaux where handle like 'essai.%' order by handle`)
    assert.deepEqual(lignes.map((l) => `${l.handle}|${l.fiche}|${l.personne_id}|${l.numero}|${l.equipe}|${l.pose_par}`),
      ['essai.alex|true|null|248|null|tab', 'essai.inconnu|false|null|null|null|tab', 'essai.mel|false|p-melanie|null|Mélanie|tab', 'essai.rls|false|null|null|null|main:Brice'])
    bloc('serveur du lot : numero -> fiche, equipe -> personne du fonds, a_identifier vide, refus (fiche, numero inconnus, email) sans email rendu')

    const b = await traiterLot(tx, lot, 'tab', AUJ)
    assert.deepEqual(b.resultats.map((r) => r.action), ['inchange', 'inchange', 'inchange'])
    const [{ n }] = await tx.$queryRawUnsafe(`select count(*)::int as n from public.cockpit_handles_sociaux where handle like 'essai.%'`)
    assert.equal(n, 4)
    bloc('idempotent : le meme lot rejoue = 3 inchanges, aucune ligne en plus')

    await tx.$executeRawUnsafe(`update public.cockpit_handles_sociaux set pose_par = 'main:Brice', preuve = 'vu par Brice' where handle = 'essai.alex'`)
    const c = await traiterLot(tx, lireLot({ lignes: [
      { plateforme: 'TikTok', handle: 'ESSAI.ALEX', statut: 'a_identifier', qui: '', interactions: 9, dernier_echange: '2026-11-12' },
      { plateforme: 'tiktok', handle: 'essai.mel', statut: 'probable', qui: 'équipe : Mélanie', interactions: 4, dernier_echange: '2026-11-09' },
    ] }, AUJ), 'tab', AUJ)
    const [alex] = await tx.$queryRawUnsafe(`select statut, membre_id is not null as fiche, preuve, pose_par, interactions, to_char(dernier_vu, 'YYYY-MM-DD') as dv from public.cockpit_handles_sociaux where handle = 'essai.alex'`)
    assert.deepEqual(alex, { statut: 'sur', fiche: true, preuve: 'vu par Brice', pose_par: 'main:Brice', interactions: 9, dv: '2026-11-12' })
    assert.equal(c.resultats[0].action, 'mis_a_jour')
    assert.ok(c.resultats[0].remarques.some((x) => /posé à la main/.test(x)))
    assert.equal(c.resultats[1].statut, 'probable')
    bloc('un « sur » pose a la main reste sur (personne, preuve, poseur), seules les observations suivent ; un « sur » de lot peut redescendre')

    throw ANNULER
  }, { timeout: 120000, maxWait: 10000 })
} catch (e) {
  if (e !== ANNULER) { console.error('ECHEC', e.message); await p.$disconnect(); process.exit(1) }
}
const [{ apres }] = await p.$queryRawUnsafe(`select to_regclass('public.cockpit_handles_sociaux') is not null as apres`)
assert.equal(apres, false)
bloc('transaction annulee : la table n existe pas')
await p.$disconnect()
console.log(`\nESSAI_OK ${ok} blocs`)
