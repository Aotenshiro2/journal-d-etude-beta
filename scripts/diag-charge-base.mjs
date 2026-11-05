// La charge de la base, EN LECTURE SEULE (05/11/2026, plan de migration
// Supabase, section 6 : « mesurer avant et apres »). Successeur du
// diag-disk-io.mjs du 22/10 (bloc-notes de session, perdu).
//
// - pg_stat_statements : top 10 par temps total, par appels, par lignes
//   rendues et par blocs lus (memoire + disque), depuis la derniere remise a
//   zero (pg_stat_statements_info.stats_reset).
// - La page d'accueil du journal : ce qu'un rafraichissement relit pour un
//   compte (notes et taille de leur contenu, noeuds et liens de la carte).
// - L'academie : signaux de suivi recus (academie_lectures) par jour.
//
// Tout passe dans une transaction SET TRANSACTION READ ONLY : rien ne peut
// etre ecrit. Sortie : des COMPTES et du SQL normalise (pg_stat_statements
// remplace les constantes par $1, $2...), jamais un nom, un email ou un
// identifiant.
//
// Lancement (Node 22, depuis apps/journal-d-etude) :
//   set -a && . ./.env && set +a && node scripts/diag-charge-base.mjs [--json] [--motif <texte du SQL>]

import { PrismaClient } from '@prisma/client'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL absente : charger le .env du journal (set -a && . ./.env && set +a).')
  process.exit(1)
}

const JSON_SEUL = process.argv.includes('--json')
const prisma = new PrismaClient()

const nombre = (v) => (typeof v === 'bigint' ? Number(v) : v === null || v === undefined ? null : Number(v))
const propre = (lignes) => lignes.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [
  k, typeof v === 'bigint' || (typeof v === 'object' && v !== null && v.constructor?.name === 'Decimal') ? nombre(v) : v,
])))
const sqlCourt = (q, max = 150) => String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

async function lire(f) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('set transaction read only')
    return f(tx)
  }, { timeout: 60_000 })
}

const resultat = {}
try {
  await lire(async (tx) => {
    const [ou] = await tx.$queryRawUnsafe(`select coalesce(
        to_regclass('extensions.pg_stat_statements')::text,
        to_regclass('public.pg_stat_statements')::text) as vue,
        to_regclass('extensions.pg_stat_statements_info')::text as info`)
    if (!ou?.vue) throw new Error('pg_stat_statements introuvable')
    const V = ou.vue
    if (ou.info) {
      const [i] = await tx.$queryRawUnsafe(`select stats_reset, dealloc from ${ou.info}`)
      resultat.remise_a_zero = i?.stats_reset ?? null
    }
    const [tot] = propre(await tx.$queryRawUnsafe(`select count(*) as requetes, sum(calls) as appels,
        round(sum(total_exec_time)::numeric / 1000, 1) as secondes, sum(rows) as lignes,
        sum(shared_blks_hit + shared_blks_read) as blocs, sum(shared_blks_read) as blocs_disque,
        sum(temp_blks_written) as blocs_temp from ${V}`))
    resultat.total = tot

    const colonnes = `calls as appels, round(total_exec_time::numeric / 1000, 2) as secondes,
        round(mean_exec_time::numeric, 2) as ms_moyen, rows as lignes,
        shared_blks_hit + shared_blks_read as blocs, shared_blks_read as blocs_disque,
        temp_blks_written as blocs_temp, query`
    const top = async (ordre) => propre(await tx.$queryRawUnsafe(
      `select ${colonnes} from ${V} where query not ilike '%pg_stat_statements%' order by ${ordre} desc nulls last limit 10`))
      .map((l) => ({ ...l, query: sqlCourt(l.query) }))
    resultat.par_temps = await top('total_exec_time')
    resultat.par_appels = await top('calls')
    resultat.par_lignes = await top('rows')
    resultat.par_blocs = await top('shared_blks_hit + shared_blks_read')

    // Les requetes de la page d'accueil du journal (Prisma : findMany sur Note
    // avec content, count sur Canvas, findFirst sur Canvas + noeuds + liens).
    resultat.accueil_journal = propre(await tx.$queryRawUnsafe(
      `select ${colonnes} from ${V}
        where (query ilike '%from "public"."Note"%' and query ilike '%"public"."Note"."content"%' and query ilike '%"deletedAt" is null%')
           or (query ilike '%count(%' and query ilike '%from "public"."Canvas"%' and query ilike '%"reviewedAt" is null%')
           or (query ilike '%from "public"."Canvas"%' and query ilike '%"type" = $%' and query ilike '%"noteId" is null%')
           or query ilike '%from "public"."CanvasNode" where "public"."CanvasNode"."canvasId" in%'
           or query ilike '%from "public"."CanvasEdge" where "public"."CanvasEdge"."canvasId" in%'
        order by calls desc limit 10`)).map((l) => ({ ...l, query: sqlCourt(l.query, 110) }))

    // Les deux ordres du suivi de l'academie (SQL_ETAT_SIGNAL, SQL_APPLIQUER_SIGNAL).
    resultat.suivi_academie = propre(await tx.$queryRawUnsafe(
      `select ${colonnes} from ${V}
        where query ilike '%from public.academie_progression p%join public.academie_lecons l%'
           or query ilike '%update public.academie_progression p set%'
        order by calls desc limit 5`)).map((l) => ({ ...l, query: sqlCourt(l.query, 110) }))

    // Le cockpit (appels PostgREST du navigateur sur les tables et vues cockpit_*).
    resultat.cockpit = propre(await tx.$queryRawUnsafe(
      `select ${colonnes} from ${V}
        where query ilike '%pgrst_source%' and query ilike '%cockpit_%'
        order by shared_blks_hit + shared_blks_read desc limit 12`)).map((l) => ({ ...l, query: sqlCourt(l.query, 130) }))

    // --motif <texte> : les requetes dont le SQL contient ce texte (ex. cockpit_membres_risque).
    const i = process.argv.indexOf('--motif')
    if (i > 0 && process.argv[i + 1]) {
      resultat.motif = propre(await tx.$queryRawUnsafe(
        `select ${colonnes} from ${V} where query ilike $1 and query not ilike '%pg_stat_statements%'
          order by total_exec_time desc limit 15`, `%${process.argv[i + 1]}%`)).map((l) => ({ ...l, query: sqlCourt(l.query, 130) }))
    }

    // Ce qu'un rafraichissement de l'accueil relit, par compte qui a des notes.
    const [notes] = propre(await tx.$queryRawUnsafe(`with par_compte as (
        select "userId", count(*) as notes, sum(octet_length(content)) as octets
          from public."Note" where "deletedAt" is null group by "userId")
      select count(*) as comptes, round(avg(notes), 1) as notes_moy, max(notes) as notes_max,
             round(avg(octets) / 1024, 1) as ko_moy, round(max(octets) / 1024, 1) as ko_max
        from par_compte`))
    const [carte] = propre(await tx.$queryRawUnsafe(`select count(*) as cartes,
        round(avg((select count(*) from public."CanvasNode" n where n."canvasId" = c.id)), 1) as noeuds_moy,
        max((select count(*) from public."CanvasNode" n where n."canvasId" = c.id)) as noeuds_max,
        round(avg((select count(*) from public."CanvasEdge" e where e."canvasId" = c.id)), 1) as liens_moy
      from public."Canvas" c where c.type = 'note-map' and c."noteId" is null`))
    resultat.charge_accueil = { ...notes, ...carte }

    // Les signaux de l'academie par jour (14 derniers jours).
    const academie = await tx.$queryRawUnsafe(`select to_regclass('public.academie_lectures')::text as t`)
    if (academie[0]?.t) {
      resultat.signaux_academie = propre(await tx.$queryRawUnsafe(`select to_char(date_trunc('day', cree_le), 'YYYY-MM-DD') as jour,
          count(*) filter (where evenement = 'lecture') as lecture, count(*) filter (where evenement = 'texte') as texte,
          count(*) filter (where evenement in ('pause', 'fin', 'texte_fin')) as ponctuels,
          count(distinct user_id) as comptes
        from public.academie_lectures where cree_le > now() - interval '14 days'
        group by 1 order by 1`))
    }
  })
} catch (err) {
  console.error(`Lecture impossible : ${err?.message ?? err}`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

if (JSON_SEUL) {
  console.log(JSON.stringify(resultat, null, 2))
} else {
  const t = (titre, lignes) => {
    if (!lignes) return
    console.log(`\n== ${titre}`)
    for (const l of lignes) {
      console.log(`${String(l.appels).padStart(8)} appels ${String(l.secondes).padStart(8)} s ${String(l.ms_moyen).padStart(8)} ms/appel ${String(l.lignes).padStart(9)} lignes ${String(l.blocs).padStart(10)} blocs (${l.blocs_disque} disque, ${l.blocs_temp} temp)  ${l.query}`)
    }
  }
  console.log(`Remise a zero des statistiques : ${resultat.remise_a_zero ?? 'inconnue'}`)
  console.log(`Total : ${JSON.stringify(resultat.total)}`)
  t('Top 10 par temps total', resultat.par_temps)
  t('Top 10 par appels', resultat.par_appels)
  t('Top 10 par lignes rendues', resultat.par_lignes)
  t('Top 10 par blocs lus', resultat.par_blocs)
  t('Accueil du journal (Prisma)', resultat.accueil_journal)
  t('Suivi de l academie', resultat.suivi_academie)
  t('Cockpit (PostgREST), par blocs lus', resultat.cockpit)
  t('Requetes du motif demande', resultat.motif)
  console.log(`\n== Ce que relit un rafraichissement de l'accueil : ${JSON.stringify(resultat.charge_accueil)}`)
  if (resultat.signaux_academie) {
    console.log('\n== Signaux de l academie par jour')
    for (const j of resultat.signaux_academie) console.log(`${j.jour}  lecture ${j.lecture}  texte ${j.texte}  ponctuels ${j.ponctuels}  comptes ${j.comptes}`)
  }
}
