/**
 * ESSAI COMMUN des 4 migrations de l'academie pour la mise en ligne du lundi 16/11/2026 (fusion academie-lundi),
 * jouees ENSEMBLE, dans l'ordre, dans UNE transaction TOUJOURS ANNULEE, avec l'import des 75 annonces Skool et
 * la pose des 2 quiz en brouillon dans la meme transaction.
 *
 *   20261113160000_academie_annonces.sql        (navigation, page Annonces)
 *   20261113200000_academie_lives.sql           (calendrier des lives)
 *   20261113210000_academie_emails_annonces.sql (email a tous ; renommee a la fusion, 200000 etant pris)
 *   20261113231500_academie_quiz.sql            (quiz de fin de module)
 *
 * Chaque migration est jouee DEUX fois (rejouable). Puis : l'import des 75 annonces (meme code que
 * importer-annonces-skool.mjs), les 2 quiz du catalogue en brouillon (poserQuiz), des controles (tables, RLS,
 * droits d'anon et d'authenticated, serie des lives, quiz jamais lisible par un membre), et l'annulation. Hors
 * transaction, on verifie que rien n'est reste.
 *
 * Lancement (depuis le journal, worktree ou checkout principal) :
 *   AOK_WORKSPACE=~/Projects/_worktrees/academie-lundi node --env-file=.env.local scripts/essayer-migrations-academie-lundi.mjs
 * Options : --export <brice-annonces.json>, --catalogue <dossier des modules>, --images-base <url>.
 * --etat : lecture seule, dit seulement quelles migrations sont deja appliquees (rien n'est joue).
 * --bloc-email <fichier> : le bloc d'essai de l'email (voie Resend Broadcasts), ecrit SANS connexion par
 *   `node scripts/essayer-migration-emails-annonces.mjs --imprimer <fichier>` ; il est joue dans la meme
 *   transaction, apres les imports, sous un point de sauvegarde (il finit toujours par ESSAI_OK, nombres seuls).
 * N'ecrit rien. N'affiche ni email, ni cle, ni texte d'annonce.
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  categorieDe, lireAnnonces, MODULE_ARCHIVE_SKOOL, texteAnnonceSkool,
} from '../src/lib/academie/annonces.ts'
import { publierBilletsEchus } from '../src/lib/academie/billets.ts'
import { lireQuizDuFichier, poserQuiz } from './importer-catalogue-academie.mjs'

const args = process.argv.slice(2)
const option = (nom, defaut) => {
  const i = args.indexOf(nom)
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut
}
const EXPORT = option('--export', '/mnt/d/6_Societe/Pilotage/Data-Performance/platforms/skool/exports/2026-11-07/posts/brice-annonces.json')
const CATALOGUE = option('--catalogue', '/mnt/d/6_Societe/Pilotage/Academie/catalogue/modules')
const BASE_IMAGES = option('--images-base', '/media/academie/annonces')
const QUIZ = ['novice-en-trading', 'les-bases-smart-money']
const BLOC_EMAIL = option('--bloc-email', null)

const DOSSIER = 'sites/Aoknowledgecom/supabase/migrations'
const MIGRATIONS = [
  '20261113160000_academie_annonces.sql',
  '20261113200000_academie_lives.sql',
  '20261113210000_academie_emails_annonces.sql',
  '20261113231500_academie_quiz.sql',
]
const racines = [
  process.env.AOK_WORKSPACE ? `file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/` : null,
  new URL('../../../', import.meta.url).href,
].filter(Boolean)
const racine = racines.find(r => MIGRATIONS.every(m => existsSync(new URL(`${DOSSIER}/${m}`, r))))
if (!racine) throw new Error('les 4 migrations sont introuvables : poser AOK_WORKSPACE (worktree academie-lundi)')

// --- Decoupage : copie de appliquer-migration.mjs -------------------------
function decouper(sql) {
  const ordres = []
  let courant = ''
  let tag = null
  let i = 0
  while (i < sql.length) {
    if (!tag) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (dollar) { tag = dollar[0]; courant += tag; i += tag.length; continue }
      if (sql[i] === ';') { if (courant.trim()) ordres.push(courant.trim()); courant = ''; i += 1; continue }
    } else if (sql.startsWith(tag, i)) { courant += tag; i += tag.length; tag = null; continue }
    courant += sql[i]
    i += 1
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}
const ordresDe = m => decouper(readFileSync(new URL(`${DOSSIER}/${m}`, racine), 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n'))

class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const big = v => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? Number(x) : x)))
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|policy|violates|denied|row-level/i.test(l))?.trim().slice(0, 100) ?? 'refus'

const NOUVELLES_TABLES = [
  'academie_lives_series', 'academie_lives',
  'academie_emails_envois', 'academie_emails_destinataires', 'academie_emails_desinscriptions',
  'academie_quiz_resultats',
]

/** Ce qui dit qu'une migration est deja appliquee (une seule ligne, lisible hors transaction). */
const SQL_ETAT = `select
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'academie_billets'
     and column_name in ('origine', 'source', 'categorie', 'epingle_le')) as annonces_colonnes,
  (select count(*)::int from public.academie_modules where slug = '${MODULE_ARCHIVE_SKOOL}') as annonces_module,
  to_regclass('public.academie_lives_series')::text as lives,
  to_regclass('public.academie_emails_envois')::text as emails,
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'academie_modules'
     and column_name = 'quiz') as quiz_colonne,
  to_regclass('public.academie_quiz_resultats')::text as quiz_table,
  (select count(*)::int from public.academie_billets) as billets,
  (select count(*)::int from public.academie_lecons) as lecons,
  (select count(*)::int from public.cockpit_annonces_envoyees) as annonces_envoyees`

function appliquees(e) {
  return {
    '20261113160000_academie_annonces.sql': e.annonces_colonnes === 4 && e.annonces_module === 1,
    '20261113200000_academie_lives.sql': e.lives !== null,
    '20261113210000_academie_emails_annonces.sql': e.emails !== null,
    '20261113231500_academie_quiz.sql': e.quiz_colonne === 1 && e.quiz_table !== null,
  }
}

// --- L'import des annonces : memes requetes que importer-annonces-skool.mjs ------------
const SQL_MODULE = `select id::text as id, statut from public.academie_modules where slug = $1`
const SQL_SKOOL = `
select source, titre, contenu, envoye_le from public.cockpit_annonces_envoyees
 where canal = 'skool' and source like 'skool:%' order by envoye_le, source`
const SQL_SOURCES = `select source from public.academie_billets where source is not null`
const SQL_SLUGS = `select slug from public.academie_lecons where module_id = $1::uuid`
const SQL_CREER_LECON = `
insert into public.academie_lecons
  (module_id, section_id, slug, ordre, titre, type, format, usage, contenu, ressources, statut, statut_le)
values ($1::uuid, null, $2, $3, $4, 'texte', 'cours', 'interne', $5, $6::jsonb, 'archive', now())
returning id::text as id`
const SQL_CREER_BILLET = `
insert into public.academie_billets (lecon_id, publie_le, publication_faite_le, origine, source, categorie)
values ($1::uuid, $2::timestamptz, $2::timestamptz, 'skool', $3, $4)
on conflict (source) do nothing
returning id::text as id`
const slugPropre = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120).replace(/-+$/, '') || 'annonce'

function lireExport() {
  assert.ok(existsSync(EXPORT), `export introuvable : ${EXPORT}`)
  const posts = JSON.parse(readFileSync(EXPORT, 'utf8'))
  const parId = new Map()
  for (const p of posts) parId.set(`skool:${p.id}`, p)
  return parId
}

async function importerAnnonces(tx, parId) {
  await tx.$queryRawUnsafe('select id from public.academie_modules order by id for update')
  const [mod] = await tx.$queryRawUnsafe(SQL_MODULE, MODULE_ARCHIVE_SKOOL)
  assert.ok(mod, `module ${MODULE_ARCHIVE_SKOOL} absent`)
  assert.equal(mod.statut, 'archive')
  const annonces = await tx.$queryRawUnsafe(SQL_SKOOL)
  const deja = new Set((await tx.$queryRawUnsafe(SQL_SOURCES)).map(r => r.source))
  const pris = new Set((await tx.$queryRawUnsafe(SQL_SLUGS, mod.id)).map(r => r.slug))
  let crees = 0, sautees = 0, images = 0, pdf = 0, ordre = pris.size
  for (const a of annonces) {
    if (deja.has(a.source)) { sautees++; continue }
    const post = parId.get(a.source)
    const slugBase = slugPropre(post?.slug || a.titre)
    let slug = slugBase
    for (let n = 2; pris.has(slug); n++) slug = `${slugBase.slice(0, 115).replace(/-+$/, '')}-${n}`
    pris.add(slug)
    const t = texteAnnonceSkool(a.contenu ?? '', slugBase, Array.isArray(post?.pieces_jointes) ? post.pieces_jointes : [], BASE_IMAGES)
    const [lecon] = await tx.$queryRawUnsafe(SQL_CREER_LECON, mod.id, slug, ++ordre, a.titre.slice(0, 300), t.contenu || a.titre, JSON.stringify(t.ressources))
    const billet = await tx.$queryRawUnsafe(SQL_CREER_BILLET, lecon.id, new Date(a.envoye_le).toISOString(), a.source, categorieDe(a.titre))
    assert.equal(billet.length, 1)
    crees++; images += t.images; pdf += t.ressources.length
  }
  return { total: annonces.length, crees, sautees, images, pdf }
}

async function main() {
  const avant = big((await prisma.$queryRawUnsafe(SQL_ETAT))[0])
  const deja = appliquees(avant)
  // --etat : lecture seule, une ligne par migration (mode « verifier » du script de mise en ligne).
  if (args.includes('--etat')) {
    for (const m of MIGRATIONS) console.log(`${deja[m] ? 'APPLIQUEE' : 'ABSENTE'} ${m}`)
    console.log(`BILLETS ${avant.billets} ; module annonces-skool ${avant.annonces_module}`)
    return
  }
  for (const m of MIGRATIONS) console.log(`    ${m} : ${deja[m] ? 'DEJA APPLIQUEE (sautee)' : 'non appliquee'}`)
  const aJouer = MIGRATIONS.filter(m => !deja[m])
  ok(`avant : ${aJouer.length} migration(s) a jouer sur 4 ; ${avant.billets} billets, ${avant.lecons} lecons, ${avant.annonces_envoyees} annonces envoyees`)
  const parId = lireExport()

  const debut = Date.now()
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
      await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)
      const q = async (sql, ...p) => big(await tx.$queryRawUnsafe(sql, ...p))
      let n = 0
      async function comme(role, sub, sql, ...params) {
        const sp = `sp${++n}`
        await tx.$executeRawUnsafe(`savepoint ${sp}`)
        try {
          const claims = JSON.stringify(sub ? { sub, role, aud: 'authenticated' } : { role })
          await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, claims)
          await tx.$executeRawUnsafe(`set local role ${role}`)
          return { ok: true, lignes: big(await tx.$queryRawUnsafe(sql, ...params)) }
        } catch (e) {
          return { ok: false, motif: motif(e) }
        } finally {
          await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`)
        }
      }

      // 1. Les 4 migrations, dans l'ordre, chacune deux fois.
      for (const m of aJouer) {
        const ordres = ordresDe(m)
        for (let passe = 1; passe <= 2; passe++) for (const o of ordres) await tx.$executeRawUnsafe(o)
        ok(`${m} jouee deux fois (${ordres.length} ordres)`)
      }
      const e = await q(SQL_ETAT)
      assert.deepEqual(Object.values(appliquees(e[0])), [true, true, true, true])
      ok('apres les 4 : colonnes des annonces, module d archive, tables des lives et des emails, colonne et table du quiz')
      // La voie Resend Broadcasts (migration de l'email completee le 13/11) : ses 3 colonnes.
      const [cb] = await q(`select count(*)::int as n from information_schema.columns where table_schema = 'public'
        and ((table_name = 'academie_emails_envois' and column_name in ('resend_broadcast_id', 'synchro'))
          or (table_name = 'academie_emails_desinscriptions' and column_name = 'resend_le'))`)
      assert.equal(cb.n, 3, 'colonnes de la voie Broadcast')
      ok('email, voie Broadcast : resend_broadcast_id, synchro, resend_le presentes')

      // 2. RLS et droits des tables nouvelles.
      const rls = await q(`
        select c.relname as t, c.relrowsecurity as rls, c.relforcerowsecurity as forcee,
               has_table_privilege('anon', c.oid, 'select') as anon_lit,
               has_table_privilege('anon', c.oid, 'insert') as anon_ecrit,
               has_table_privilege('authenticated', c.oid, 'select') as auth_lit,
               has_table_privilege('authenticated', c.oid, 'insert') as auth_ecrit
          from pg_class c join pg_namespace s on s.oid = c.relnamespace
         where s.nspname = 'public' and c.relname = any($1::text[]) order by c.relname`, NOUVELLES_TABLES)
      assert.equal(rls.length, NOUVELLES_TABLES.length)
      for (const r of rls) {
        assert.ok(r.rls && r.forcee, `${r.t} : RLS non forcee`)
        assert.ok(!r.anon_lit && !r.anon_ecrit && !r.auth_ecrit, `${r.t} : droit inattendu`)
        assert.equal(r.auth_lit, r.t === 'academie_quiz_resultats', `${r.t} : lecture authenticated inattendue`)
      }
      ok(`RLS forcee sur les ${rls.length} tables nouvelles ; anon rien ; authenticated lit seulement academie_quiz_resultats (ses lignes, policy)`)

      // 3. Le calendrier : la serie de Brice, mardi 17 et jeudi 19 novembre.
      const [s] = await q(`select count(*)::int as n from public.academie_lives_series where id = 'b71ce000-0000-4000-8000-000000000001'`)
      assert.equal(s.n, 1)
      const sem = await q(`select debut from public.aok_lives_entre('2026-11-16T00:00:00Z'::timestamptz, '2026-11-23T00:00:00Z'::timestamptz) order by debut`)
      assert.equal(sem.length, 2, `2 lives attendus la semaine du 16/11, ${sem.length} lus`)
      ok(`lives : la serie de Brice posee une fois ; semaine du 16/11 = ${sem.map(x => new Date(x.debut).toISOString().slice(5, 16)).join(', ')} (UTC)`)

      // 4. L'import des 75 annonces.
      const r = await importerAnnonces(tx, parId)
      assert.equal(r.total, 75)
      assert.equal(r.crees + r.sautees, 75)
      ok(`annonces : ${r.crees} creees, ${r.sautees} deja la ; ${r.images} images, ${r.pdf} PDF`)
      const apresImport = await q(SQL_ETAT)
      assert.equal(apresImport[0].annonces_envoyees, avant.annonces_envoyees)
      assert.equal(await publierBilletsEchus(tx), 0)
      ok('cockpit_annonces_envoyees inchange, aucun billet a publier (ni pop-up ni envoi)')
      const compte = randomUUID()
      const liste = await lireAnnonces(tx, compte)
      assert.equal(liste.filter(a => a.origine === 'skool').length, 75)
      ok(`route Annonces : 75 annonces Skool rendues (${liste.length} en tout)`)
      const r2 = await importerAnnonces(tx, parId)
      assert.equal(r2.crees, 0)
      ok('second import : 0 nouveau (rejouable)')

      // 5. Les 2 quiz en brouillon.
      for (const slug of QUIZ) {
        const donnees = JSON.parse(readFileSync(`${CATALOGUE}/${slug}.json`, 'utf8'))
        const lu = lireQuizDuFichier(donnees)
        assert.ok(lu.present && lu.quiz, `${slug} : pas de quiz dans le fichier`)
        assert.equal(lu.quiz.statut, 'brouillon', `${slug} : le quiz doit rester en brouillon`)
        const [m] = await q(`select id::text as id from public.academie_modules where slug = $1 for update`, slug)
        assert.ok(m, `${slug} absent de la base`)
        ok(`quiz ${slug} : ${await poserQuiz(tx, m.id, lu.quiz)}`)
      }
      const membre = randomUUID()
      const lu = await comme('authenticated', membre, `select count(*)::int as n from public.academie_quiz_resultats`)
      assert.ok(lu.ok && lu.lignes[0].n === 0, `lecture des resultats par un membre : ${lu.motif ?? lu.lignes?.[0]?.n}`)
      const quizLu = await comme('authenticated', membre, `select quiz from public.academie_modules where slug = $1`, QUIZ[0])
      // academie_modules reste fermee aux membres (politique de l'equipe seulement) : 0 ligne ou un refus.
      assert.ok(!quizLu.ok || quizLu.lignes.length === 0, 'un membre ne doit pas lire le quiz en base (la bonne reponse y est)')
      const anon = await comme('anon', null, `select count(*)::int as n from public.academie_lives_series`)
      assert.ok(!anon.ok)
      ok(`droits : un membre lit 0 resultat et pas le quiz en base (${quizLu.ok ? '0 ligne' : quizLu.motif}) ; anon refuse sur les lives (${anon.motif})`)

      // 6. Le bloc d'essai de l'email (voie Broadcast), dans la meme transaction, sous un point de sauvegarde.
      if (BLOC_EMAIL) {
        const bloc = readFileSync(BLOC_EMAIL, 'utf8')
        await tx.$executeRawUnsafe(`set local statement_timeout = '120s'`)
        await tx.$executeRawUnsafe('savepoint sp_email')
        let res = null, autre = null
        try { await tx.$executeRawUnsafe(bloc) } catch (e) {
          const m = String(e?.message ?? e)
          const r = /ESSAI_OK (\{.*\})/.exec(m)
          if (r) res = JSON.parse(r[1]); else autre = m.replace(/[^\s@]+@[^\s@]+/g, '[email]').split('\n').slice(0, 4).join(' ').slice(0, 400)
        }
        await tx.$executeRawUnsafe('rollback to savepoint sp_email')
        assert.ok(res, `bloc de l'email : ${autre ?? 'ESSAI_OK attendu'}`)
        ok(`email : bloc de essayer-migration-emails-annonces.mjs joue dans la meme transaction, ESSAI_OK ${JSON.stringify(res)}`)
      }

      throw new Annulation()
    }, { timeout: 180_000, maxWait: 20_000 })
  } catch (err) {
    if (!(err instanceof Annulation)) throw err
  }
  const fin = big((await prisma.$queryRawUnsafe(SQL_ETAT))[0])
  assert.deepEqual(fin, avant, 'rien ne doit rester apres l annulation')
  ok(`transaction annulee (${((Date.now() - debut) / 1000).toFixed(1)} s) : base identique a l avant (aucune table, colonne, ligne)`)
  console.log(`\n${etapes} etapes ok. Transaction annulee, base inchangee.`)
}

main()
  .catch((err) => { console.error(`ECHEC : ${String(err?.message ?? err).split('\n').slice(0, 3).join(' ')}`); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
