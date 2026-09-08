/**
 * Verifie ce qu il faut savoir avant de changer un client_number :
 * contrainte d unicite, numeros bas deja pris, colonnes d autres tables qui
 * pourraient porter ce numero, sequence/valeur par defaut. LECTURE SEULE.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const q = (sql) => prisma.$queryRawUnsafe(sql)

console.log('-- colonne client_number :')
for (const r of await q(
  `select column_default, is_nullable, data_type
   from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'client_number'`
)) console.log('  ', r)

console.log('-- contraintes / index sur profiles mentionnant client_number :')
for (const r of await q(
  `select conname, pg_get_constraintdef(oid) as def from pg_constraint
   where conrelid = 'public.profiles'::regclass and pg_get_constraintdef(oid) ilike '%client_number%'`
)) console.log('  ', r.conname, ':', r.def)
for (const r of await q(
  `select indexname, indexdef from pg_indexes
   where schemaname = 'public' and tablename = 'profiles' and indexdef ilike '%client_number%'`
)) console.log('  ', r.indexname, ':', r.indexdef)

console.log('-- numeros < 100 deja pris :')
for (const r of await q(
  `select client_number, first_name, role from public.profiles
   where client_number < 100 order by client_number`
)) console.log('  ', r.client_number, r.first_name ?? '(sans nom)', r.role)

console.log('-- autres colonnes nommees *client_number* dans le schema public :')
for (const r of await q(
  `select table_name, column_name from information_schema.columns
   where table_schema = 'public' and column_name ilike '%client_number%' and table_name <> 'profiles'`
)) console.log('  ', r.table_name, '.', r.column_name)

console.log('-- triggers sur profiles :')
for (const r of await q(
  `select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal`
)) console.log('  ', r.tgname)

console.log('-- fonctions du schema public mentionnant client_number :')
for (const r of await q(
  `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%client_number%'`
)) console.log('  ', r.proname)

await prisma.$disconnect()
