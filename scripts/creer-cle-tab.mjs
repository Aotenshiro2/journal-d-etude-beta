/**
 * Cree une cle de l'API de Tab (20/10/2026) : une cle aleatoire de 256 bits,
 * son EMPREINTE (sha256) en base dans cockpit_tab_cles, la cle elle-meme
 * dans le coffre local SEULEMENT. La cle n'est jamais affichee.
 *
 *   set -a; . ./.env; set +a
 *   node scripts/creer-cle-tab.mjs "<chemin du fichier du coffre>" [nom] [base_url]
 *
 * Le fichier du coffre ne doit pas exister (pas d'ecrasement d'une cle en
 * service). Pour remplacer une cle : la couper dans le cockpit (vue Machine,
 * « Acces de Tab »), renommer l'ancien fichier, relancer ce script.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const [fichier, nom = 'Tab (assistant de Brice)', baseUrl = 'https://journal-d-etude-beta.vercel.app/api/tab/v1'] = process.argv.slice(2)
if (!fichier) {
  console.error('Usage : node scripts/creer-cle-tab.mjs <fichier du coffre> [nom] [base_url]')
  process.exit(2)
}
if (existsSync(fichier)) {
  console.error('Refuse : le fichier existe deja (une cle en service ne s ecrase pas).')
  process.exit(2)
}

const cle = `tab_${randomBytes(32).toString('base64url')}`
const empreinte = createHash('sha256').update(cle, 'utf8').digest('hex')

const prisma = new PrismaClient()
try {
  const [ligne] = await prisma.$queryRaw`
    insert into public.cockpit_tab_cles (nom, empreinte) values (${nom}, ${empreinte})
    returning cle_id::text as cle_id, to_char(cree_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as cree_le`
  writeFileSync(fichier, JSON.stringify({
    api_key: cle,
    base_url: baseUrl,
    en_tete: 'Authorization: Bearer <api_key>',
    cle_id: ligne.cle_id,
    nom,
    cree_le: ligne.cree_le,
    deploye_sur: 'Vercel journal-d-etude-beta : empreinte sha256 dans la table cockpit_tab_cles (Supabase), la cle elle-meme nulle part ailleurs',
  }, null, 2) + '\n', { mode: 0o600 })
  console.log(`Cle creee (cle_id ${ligne.cle_id}), rangee dans le coffre. Elle n est pas affichee.`)
} finally {
  await prisma.$disconnect()
}
