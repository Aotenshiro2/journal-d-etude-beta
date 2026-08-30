/**
 * Audit des lectures ouvertes du schema public (projet Supabase partage).
 *
 * Pourquoi ce script existe : la cle anon est PUBLIQUE par conception, elle vit
 * dans chaque bundle JS livre. Une policy `using (true)` pour le role `public`
 * ou `anon` veut donc dire « lisible par n'importe qui sur Internet ». Et le
 * projet accepte les inscriptions publiques : etre `authenticated` ne prouve
 * rien non plus, d'ou le garde `is_cockpit_member()` cote cockpit.
 *
 * Deux migrations ont deja colmate des fuites de ce type (20260828170000 pour
 * les tables Prisma nees sans RLS, 20260830060000 pour skool_members, profiles
 * et propfirm_accounts). Ce script sert a ne pas avoir a les redecouvrir : une
 * table Prisma neuve nait ouverte, et une vue oubliee contourne la RLS.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/audit-rls.mjs
 *
 * Sort en code 1 des qu'une lecture ouverte est trouvee.
 *
 * ATTENTION a la lecture des resultats : ce script se connecte en proprietaire
 * des tables, donc il passe outre la RLS. Il juge la CONFIGURATION (policies,
 * grants, definition des vues), il ne mesure pas ce qu'un visiteur voit.
 */

import { PrismaClient } from "@prisma/client";

/**
 * Tables dont la lecture publique est VOULUE. Toute entree ajoutee ici doit
 * dire pourquoi : c'est la seule chose qui empeche cette liste de devenir le
 * tapis sous lequel on pousse les fuites.
 */
const LECTURE_PUBLIQUE_ASSUMEE = new Map([
  ["courses", "catalogue de formations, affiche avant connexion"],
  ["modules", "catalogue, meme raison"],
  ["lessons", "catalogue, meme raison"],
  ["upcoming_sessions", "agenda public des sessions"],
  ["learnybox_articles", "articles migres, contenu editorial public"],
  ["sync_status", "temoin technique, ne porte aucune donnee personnelle"],
]);

/**
 * Tables ou l'insertion par un visiteur non connecte est VOULUE. Meme regle :
 * on dit pourquoi.
 */
const ECRITURE_ANONYME_ASSUMEE = new Map([
  ["masterclass_leads", "capture de lead avant creation de compte, sans lecture en retour"],
]);

const p = new PrismaClient();
const alertes = [];
const remarques = [];

// --- 1. Tables sans RLS ------------------------------------------------------
const sansRls = await p.$queryRawUnsafe(`
  select c.relname as tbl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  order by 1
`);
for (const t of sansRls) {
  alertes.push(`table sans RLS : ${t.tbl}`);
}

// --- 2. Policies de lecture ouvertes a tous ---------------------------------
// `roles = {public}` couvre anon ; une qual `true` ne filtre rien.
const ouvertes = await p.$queryRawUnsafe(`
  select tablename, policyname, cmd, roles::text as roles
  from pg_policies
  where schemaname = 'public'
    and cmd in ('SELECT', 'ALL', 'UPDATE', 'DELETE')
    and coalesce(qual, 'true') = 'true'
    and (roles::text like '%public%' or roles::text like '%anon%')
  order by tablename, policyname
`);
for (const o of ouvertes) {
  const ligne = `${o.tablename} -> "${o.policyname}" (${o.cmd}, ${o.roles})`;
  if (LECTURE_PUBLIQUE_ASSUMEE.has(o.tablename) && o.cmd === "SELECT") {
    remarques.push(`public assume : ${ligne} — ${LECTURE_PUBLIQUE_ASSUMEE.get(o.tablename)}`);
  } else {
    alertes.push(`acces ouvert : ${ligne}`);
  }
}

// --- 2 bis. Ecritures ouvertes a tous ---------------------------------------
// Une policy INSERT ne se juge pas sur `qual` (toujours nul) mais sur
// `with_check`. Sans ce controle, un visiteur peut inserer des lignes.
const ecrituresOuvertes = await p.$queryRawUnsafe(`
  select tablename, policyname, roles::text as roles
  from pg_policies
  where schemaname = 'public'
    and cmd = 'INSERT'
    and coalesce(with_check, 'true') = 'true'
    and (roles::text like '%public%' or roles::text like '%anon%')
  order by tablename, policyname
`);
for (const e of ecrituresOuvertes) {
  const ligne = `${e.tablename} -> "${e.policyname}" (INSERT, ${e.roles})`;
  if (ECRITURE_ANONYME_ASSUMEE.has(e.tablename)) {
    remarques.push(`ecriture anonyme assumee : ${ligne} — ${ECRITURE_ANONYME_ASSUMEE.get(e.tablename)}`);
  } else {
    alertes.push(`ecriture ouverte : ${ligne}`);
  }
}

// --- 3. Vues sans garde ------------------------------------------------------
// Une vue s'execute avec les droits de son proprietaire tant qu'elle n'est pas
// en security_invoker : elle contourne alors la RLS des tables qu'elle lit. Il
// lui faut donc soit security_invoker, soit un garde dans sa definition.
const vues = await p.$queryRawUnsafe(`
  select c.relname as vue,
         coalesce(array_to_string(c.reloptions, ','), '') as options,
         pg_get_viewdef(c.oid, true) as def,
         has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
         has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
  order by c.relname
`);
for (const v of vues) {
  if (!v.anon_select && !v.auth_select) continue;
  const invoker = v.options.includes("security_invoker=true");
  const garde = /is_cockpit_member\(\)|auth\.uid\(\)|auth\.jwt\(\)/.test(v.def);
  if (!invoker && !garde) {
    alertes.push(`vue sans garde : ${v.vue} (ni security_invoker, ni filtre sur l'identite)`);
  }
}

// --- 4. Grants anon superflus (remarque, pas alerte) ------------------------
// Une table en CamelCase vient de Prisma : aucun front ne la lit via PostgREST,
// donc le grant anon ne sert jamais. La RLS reste la vraie protection, d'ou une
// remarque et non une alerte.
const grantsInutiles = await p.$queryRawUnsafe(`
  select c.relname as tbl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname ~ '^[A-Z]'
    and has_table_privilege('anon', c.oid, 'SELECT')
  order by 1
`);
for (const t of grantsInutiles) {
  remarques.push(`grant anon inutile sur la table Prisma ${t.tbl} (la RLS protege, le grant ne sert a rien)`);
}

if (remarques.length) {
  console.log("Remarques :\n");
  for (const r of remarques) console.log(`  · ${r}`);
  console.log("");
}

if (alertes.length === 0) {
  console.log("Aucun acces ouvert non assume. Schema public sain.");
} else {
  console.log(`${alertes.length} point(s) a corriger :\n`);
  for (const a of alertes) console.log(`  - ${a}`);
  process.exitCode = 1;
}

await p.$disconnect();
