// APERCU EN LECTURE SEULE de l'effacement des donnees d'une personne (Brice,
// 15/10/2026), sur la vraie base, pour les trois niveaux.
//
// - La personne est resolue par le VRAI code (resoudrePersonnePourEffacement,
//   fiche-personne.ts, transaction READ ONLY), comme le fait l'agent.
// - L'apercu est le SQL EXACT de la migration
//   20261016090000_cockpit_effacement.sql (corps de cockpit_effacement_cibles
//   et de cockpit_effacement_apercu, mis en ligne avec des parametres), joue en
//   transaction READ ONLY : la migration n'a pas besoin d'etre appliquee, et
//   rien ne peut etre ecrit. Si la fonction existe deja en base, elle est
//   appelee telle quelle.
// - Chaque ordre d'ecriture de cockpit_effacer est passe a EXPLAIN (sans
//   ANALYZE, donc jamais execute) en transaction READ ONLY : tables, colonnes
//   et types sont verifies contre la vraie base. Les ordres qui touchent un
//   objet cree par la migration elle-meme sont sautes (et comptes).
//
// Sortie : des COMPTES seulement. Aucun nom, aucun email, aucun identifiant.
//
// Lancement (Node 22, depuis apps/journal-d-etude) :
//   set -a && . ./.env && set +a && node scripts/apercu-effacement.mjs "u8600818154"

import { register } from 'node:module'
import { readFileSync } from 'node:fs'
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

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL absente : charger le .env du journal (set -a && . ./.env && set +a).')
  process.exit(1)
}
const qui = process.argv[2]
if (!qui) {
  console.error('Usage : node scripts/apercu-effacement.mjs "<qui>"')
  process.exit(2)
}

const { resoudrePersonnePourEffacement } = await import('../src/lib/fiche-personne.ts')
const E = await import('../src/lib/effacement-pur.ts')
const { prisma } = await import('../src/lib/db.ts')

const MIGRATION = path.join(RACINE, '../../sites/Aoknowledgecom/supabase/migrations/20261016090000_cockpit_effacement.sql')
const SQL = readFileSync(MIGRATION, 'utf8')
function corps(tag) {
  const debut = SQL.indexOf(`as $${tag}$`)
  const fin = SQL.indexOf(`$${tag}$`, debut + tag.length + 5)
  if (debut < 0 || fin < 0) throw new Error(`corps ${tag} introuvable`)
  return SQL.slice(debut + tag.length + 5, fin).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
}

/** Une lecture en transaction READ ONLY : rien ne peut etre ecrit. */
async function lire(sql, ...params) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('set transaction read only')
    await tx.$executeRawUnsafe(`set local statement_timeout = '20000ms'`)
    return tx.$queryRawUnsafe(sql, ...params)
  }, { maxWait: 5000, timeout: 30000 })
}

const PARAMS = [['p_niveau', 'int'], ['p_telegram_ids', 'bigint[]'], ['p_membre_ids', 'uuid[]'], ['p_emails', 'text[]'], ['p_personne_ids', 'text[]']]
function enLigne(texte) {
  let t = texte
  PARAMS.forEach(([nom, type], i) => { t = t.replace(new RegExp(`\\b${nom}\\b`, 'g'), `$${i + 1}::${type}`) })
  return t
}

try {
  // 1. La personne, comme l'agent la trouve.
  const r = await resoudrePersonnePourEffacement(qui)
  if (r.statut !== 'un' && !(r.statut === 'aucun' && r.email)) {
    console.log(JSON.stringify({ qui_resolu: r.statut }, null, 1))
    if (r.statut !== 'aucun') process.exit(0)
  }
  const ids = r.statut === 'un' ? r.ids : { telegram: [], membres: [], archives: [] }
  const cible = E.lireCible({ ...ids, emails: r.email ? [r.email] : [] })
  if (typeof cible === 'string') throw new Error(cible)
  console.log(`personne : ${r.statut}, ${cible.telegram.length} compte(s) Telegram, ${cible.membres.length} fiche(s) membre, `
    + `${cible.archives.length} fiche(s) d'archive, ${cible.emails.length} email(s) donne(s)`)

  // 2. La fonction est-elle deja en base ? Les colonnes de la migration ?
  const [etat] = await lire(`select
      to_regprocedure('public.cockpit_effacement_apercu(integer,bigint[],uuid[],text[],text[])') is not null as fonction,
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cockpit_paiements'
              and column_name = 'payeur_nom') as colonne_payeur`)
  console.log(`migration en base : fonction ${etat.fonction ? 'oui' : 'non'}, colonnes du payeur ${etat.colonne_payeur ? 'oui' : 'non'}`)

  // 3. Les cibles completes (SQL de la migration en ligne).
  const cibles = corps('cibles')
  const appel = 'public.cockpit_effacement_cibles(p_telegram_ids, p_membre_ids, p_emails, p_personne_ids)'
  const ciblesEnLigne = `(${cibles}) as cibles_en_ligne(telegram_ids, membre_ids, emails, user_ids, personne_ids)`
  const valeurs = [cible.telegram, cible.membres, cible.emails, cible.archives]
  // Seule, la fonction des cibles prend 4 parametres ($1 a $4) : on decale ceux de l'apercu.
  const ciblesSeules = enLigne(cibles).replace(/\$([2-5])::/g, (_m, k) => `$${Number(k) - 1}::`)
  const [c] = await lire(
    `select to_jsonb(x)::text as c from (${ciblesSeules}) as x(telegram_ids, membre_ids, emails, user_ids, personne_ids)`,
    ...valeurs)
  const completes = JSON.parse(c.c)
  console.log(`cibles completes : ${completes.telegram_ids.length} compte(s) Telegram, ${completes.membre_ids.length} fiche(s) membre, `
    + `${completes.emails.length} email(s), ${completes.user_ids.length} compte(s) AOK, ${completes.personne_ids.length} fiche(s) d'archive`)

  // 4. L'apercu des trois niveaux.
  let apercuSql = corps('apercu')
  if (!apercuSql.includes(appel)) throw new Error("l'apercu n'appelle plus cockpit_effacement_cibles comme attendu")
  // Remplacement par une fonction : le corps contient « $' » (une expression
  // reguliere SQL), qu'un remplacement en texte interpreterait.
  apercuSql = apercuSql.replace(appel, () => ciblesEnLigne)
  if (!etat.colonne_payeur) apercuSql = apercuSql.replace('x.payeur_nom is null', 'true')
  for (const niveau of [1, 2, 3]) {
    const [l] = etat.fonction
      ? await lire('select public.cockpit_effacement_apercu($1::int, $2::bigint[], $3::uuid[], $4::text[], $5::text[])::text as a', niveau, ...valeurs)
      : await lire(`select (${enLigne(apercuSql)})::text as a`, niveau, ...valeurs)
    const a = E.lireApercu(l.a)
    const non0 = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0))
    console.log(`\n== NIVEAU ${niveau} (${E.NOMS_NIVEAUX[niveau]})`)
    console.log(JSON.stringify({
      efface_non_nul: non0(a.efface), efface_tables_a_zero: Object.values(a.efface).filter((v) => v === 0).length,
      anonymise: a.anonymise, garde: a.garde, externe: a.externe, bloquants: a.bloquants, alertes: a.alertes,
      total_touche: E.totalTouche(a), refus: E.refusApercu(a) ? 'oui' : 'non',
    }))
  }

  // 5. EXPLAIN (jamais execute) de chaque ordre d'ecriture de cockpit_effacer.
  const VARS = [
    ['v_us_txt', 'text[]'], ['v_mb_txt', 'text[]'], ['v_fils_tg', 'text[]'], ['v_usage_tg', 'text[]'],
    ['v_tg', 'bigint[]'], ['v_mb', 'uuid[]'], ['v_em', 'text[]'], ['v_us', 'uuid[]'], ['v_ar', 'text[]'],
  ]
  const VAL = {
    v_tg: completes.telegram_ids, v_mb: completes.membre_ids, v_em: completes.emails, v_us: completes.user_ids,
    v_ar: completes.personne_ids, v_us_txt: completes.user_ids.map(String), v_mb_txt: completes.membre_ids.map(String),
    v_fils_tg: completes.telegram_ids.map((x) => `telegram:${x}`), v_usage_tg: completes.telegram_ids.map((x) => `liveclub:u${x}`),
  }
  const NOUVEAUX = /cockpit_oublis_emails|cockpit_arch_oublis|cockpit_effacements|cockpit_hash_email|payeur_/
  const morceaux = corps('effacer').split(';')
  let ok = 0
  let sautes = 0
  const erreurs = []
  for (const m of morceaux) {
    const i = m.search(/\b(delete from|update public|insert into|select count\(\*\) into)\b/)
    if (i < 0) continue
    let ordre = m.slice(i).trim()
    if (NOUVEAUX.test(ordre)) { sautes++; continue }
    ordre = ordre.replace(/select count\(\*\) into v_[a-z]+ from/, 'select count(*) from')
      .replace(/\bp_niveau\b/g, '3').replace(/\bp_acteur\b/g, "'apercu'")
    const params = []
    for (const [nom, type] of VARS) {
      if (!new RegExp(`\\b${nom}\\b`).test(ordre)) continue
      params.push(VAL[nom])
      const k = params.length
      ordre = ordre.replace(new RegExp(`\\b${nom}\\[1\\]`, 'g'), `($${k}::${type})[1]`)
        .replace(new RegExp(`\\b${nom}\\b`, 'g'), `$${k}::${type}`)
    }
    try {
      await lire(`explain ${ordre}`, ...params)
      ok++
    } catch (err) {
      erreurs.push(`${ordre.replace(/\s+/g, ' ').slice(0, 90)} :: ${String(err.message).split('\n').filter(Boolean).pop()?.slice(0, 160)}`)
    }
  }
  console.log(`\n== EXPLAIN des ordres de cockpit_effacer (READ ONLY, jamais executes) : ${ok} ok, ${sautes} saute(s) `
    + `(objets crees par la migration), ${erreurs.length} erreur(s)`)
  for (const e of erreurs) console.log(`ERREUR ${e}`)
  process.exitCode = erreurs.length ? 1 : 0
} catch (err) {
  console.error('ERREUR', String(err?.message ?? err).split('\n').slice(0, 4).join(' | '))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
