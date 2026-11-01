/**
 * Cree la cle de Tache pour l'API de Tab (01/11/2026). Tache est un autre
 * assistant de Brice (WhatsApp) : une cle a lui, separee de celle de Tab,
 * portee 'tache', qui ouvre les MEMES routes (/api/tab/v1/..., PORTEES_API de
 * src/lib/tab/pur.ts) et se coupe seule. Une cle aleatoire de 256 bits, son
 * EMPREINTE (sha256, la meme que empreinteCle de src/lib/tab/acces.ts) en base
 * dans cockpit_tab_cles, la cle elle-meme dans le coffre local SEULEMENT. La
 * cle n'est jamais affichee.
 *
 *   cd apps/journal-d-etude
 *   set -a; . ./.env; set +a
 *   node scripts/creer-cle-tache.mjs [fichier du coffre] [base_url]
 *
 * Coffre par defaut :
 *   /mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/tache-api.local.json
 *
 * PREALABLES : la migration 20261101030000_cockpit_notes_tache.sql appliquee
 * (sinon la base refuse la portee 'tache' et rien n'est cree), et le journal
 * deploye avec la portee tache dans src/lib/tab/acces.ts (sinon la cle rend 401).
 *
 * Le fichier du coffre ne doit pas exister (pas d'ecrasement d'une cle en
 * service). Pour remplacer la cle : la couper (cockpit_tab_cles.coupee_le),
 * renommer l'ancien fichier, relancer ce script.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { PrismaClient } from '@prisma/client'

const PORTEE = 'tache'
const NOM = 'Tache (assistant WhatsApp)'
const [
  fichier = '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/tache-api.local.json',
  baseUrl = 'https://journal-d-etude-beta.vercel.app/api/tab/v1',
] = process.argv.slice(2)

if (existsSync(fichier)) {
  console.error('Refuse : le fichier existe deja (une cle en service ne s ecrase pas).')
  process.exit(2)
}
if (!existsSync(dirname(fichier))) {
  console.error(`Refuse : le dossier du coffre n existe pas (${dirname(fichier)}).`)
  process.exit(2)
}
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/api\/tab\/v1$/i.test(baseUrl) && !/^http:\/\/localhost(:\d+)?\/api\/tab\/v1$/.test(baseUrl)) {
  console.error('Refuse : base_url = https://<hote>/api/tab/v1 (par defaut https://journal-d-etude-beta.vercel.app/api/tab/v1).')
  process.exit(2)
}

const cle = `tache_${randomBytes(32).toString('base64url')}`
// Meme forme que celle qu'accepte verifierCle (Bearer suivi de 20 a 200 caracteres sans espace).
if (!/^\S{20,200}$/.test(cle)) {
  console.error('Cle mal formee (ne devrait jamais arriver) : rien n est cree.')
  process.exit(1)
}
const empreinte = createHash('sha256').update(cle, 'utf8').digest('hex')

const prisma = new PrismaClient()
try {
  let ligne
  try {
    ;[ligne] = await prisma.$queryRawUnsafe(
      `insert into public.cockpit_tab_cles (nom, empreinte, portee) values ($1, $2, $3)
       returning cle_id::text as cle_id, to_char(cree_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as cree_le`,
      NOM, empreinte, PORTEE,
    )
  } catch (err) {
    // Jamais le detail de l'erreur : il pourrait citer la ligne refusee.
    const contrainte = /portee_check/.test(String(err?.message ?? ''))
    console.error(contrainte
      ? 'Refuse par la base : la portee tache n existe pas encore (appliquer la migration 20261101030000_cockpit_notes_tache.sql). Rien n est cree.'
      : 'Insertion impossible (base injoignable ou refus). Rien n est cree.')
    process.exit(1)
  }
  writeFileSync(fichier, JSON.stringify({
    cle,
    base_url: baseUrl,
    en_tete: 'Authorization: Bearer <cle>',
    cree_le: ligne.cree_le,
    portee: PORTEE,
    cle_id: ligne.cle_id,
    nom: NOM,
    aide: `${baseUrl}/aide`,
    deploye_sur: 'Vercel journal-d-etude-beta : empreinte sha256 dans la table cockpit_tab_cles (Supabase, portee tache), la cle elle-meme nulle part ailleurs',
    couper: 'Mettre coupee_le sur sa ligne de cockpit_tab_cles (effet immediat, sans redeploiement, jamais rallumee). Le bloc « Accès de Tab » du cockpit ne liste pas encore la portee tache.',
  }, null, 2) + '\n', { mode: 0o600 })
  console.log(`Cle creee (cle_id ${ligne.cle_id}, portee ${PORTEE}), rangee dans le coffre. Elle n est pas affichee.`)
} finally {
  await prisma.$disconnect()
}
