/**
 * Liste les comptes de l equipe (admins) et les profils dont le nom ressemble a Melanie,
 * pour retrouver un numero de compte. LECTURE SEULE, en proprietaire (passe outre la RLS).
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/lister-equipe.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const rows = await prisma.$queryRawUnsafe(
  `select p.client_number, p.first_name, p.last_name, p.role,
          regexp_replace(u.email, '^(.).*@', '\\1***@') as email_masque
   from public.profiles p
   left join auth.users u on u.id = p.id
   where p.role = 'admin' or p.first_name ilike '%lanie%' or p.last_name ilike '%lanie%'
   order by p.client_number nulls last`
)
for (const r of rows) {
  console.log(
    String(r.client_number ?? '-').padStart(5), '|',
    [r.first_name, r.last_name].filter(Boolean).join(' ') || '(sans nom)', '|',
    r.role, '|', r.email_masque,
  )
}
await prisma.$disconnect()
