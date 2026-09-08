/**
 * Ouvre ou ferme l'acces au FONDS D'ARCHIVE pour un compte de l'allowlist.
 *
 * POURQUOI UN INTERRUPTEUR SEPARE. Le cockpit est garde par
 * `is_cockpit_member()`. Ce predicat a deja gagne un membre par migration :
 * tout ce qui s'y adosse s'etend AUTOMATIQUEMENT au prochain ajout. Or le fonds
 * ne porte pas les affaires de l'equipe, il porte huit ans de conversations
 * privees de 1 823 TIERS. Il a donc son propre portail, `is_cockpit_fonds()`,
 * adosse a la colonne `cockpit_allowlist.acces_fonds`, a `false` par defaut.
 *
 * Etre membre du cockpit ne donne PAS acces au fonds. C'est deux gestes.
 *
 *   node scripts/acces-fonds.mjs                      -> etat actuel
 *   node scripts/acces-fonds.mjs ouvrir <email>
 *   node scripts/acces-fonds.mjs fermer <email>
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const [action, email] = process.argv.slice(2)

async function etat() {
  const r = await prisma.$queryRawUnsafe(
    `select email, label, acces_fonds from public.cockpit_allowlist order by created_at`
  )
  console.log('acces au fonds d archive :\n')
  for (const x of r) {
    console.log(`  ${x.acces_fonds ? 'OUVERT ' : 'ferme  '} ${String(x.email).padEnd(36)} ${x.label || ''}`)
  }
  const n = r.filter((x) => x.acces_fonds).length
  console.log(`\n  ${n} compte(s) sur ${r.length} ont acces au fonds.`)
}

async function main() {
  if (!action) {
    await etat()
  } else if (action === 'ouvrir' || action === 'fermer') {
    if (!email) {
      console.error('usage : node scripts/acces-fonds.mjs ' + action + ' <email>')
      process.exit(2)
    }
    const n = await prisma.$executeRawUnsafe(
      `update public.cockpit_allowlist set acces_fonds = $1 where email = $2`,
      action === 'ouvrir',
      email
    )
    if (!n) {
      console.error(`Aucun compte avec l email ${email} dans l allowlist.`)
      process.exit(1)
    }
    console.log(`${email} : acces au fonds ${action === 'ouvrir' ? 'OUVERT' : 'FERME'}.\n`)
    await etat()
  } else {
    console.error('action inconnue. Attendu : ouvrir | fermer')
    process.exit(2)
  }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
