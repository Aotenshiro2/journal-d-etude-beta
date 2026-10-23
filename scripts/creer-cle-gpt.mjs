/**
 * Cree la cle du connecteur MCP de ChatGPT pour Belrive (23/10/2026) : un
 * secret aleatoire de 256 bits, son EMPREINTE en base (cockpit_tab_cles,
 * portee gpt_belrive, empreinte separee de celles de Tab : empreinteCleGpt de
 * src/lib/mcp-gpt/pur.ts), et l'URL COMPLETE du connecteur dans le coffre
 * local SEULEMENT. Ni le secret ni l'URL ne sont affiches.
 *
 *   cd apps/journal-d-etude
 *   set -a; . ./.env; set +a
 *   node scripts/creer-cle-gpt.mjs "<fichier du coffre>" [base_url]
 *
 * Coffre conseille :
 *   /mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/chatgpt-mcp-belrive.local.json
 *
 * PREALABLES : les migrations 20261023170000_cockpit_perso_documents.sql et
 * 20261023171000_cockpit_tab_cles_portee.sql appliquees, et le journal
 * deploye avec /api/mcp (sinon l'URL rend 404).
 *
 * Le fichier du coffre ne doit pas exister (pas d'ecrasement d'une cle en
 * service). Pour remplacer la cle : la couper dans le cockpit (ecran Perso,
 * bloc « Accès de ChatGPT »), renommer l'ancien fichier, relancer ce script,
 * puis coller la nouvelle URL dans le connecteur de ChatGPT.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { empreinteCleGpt, SECRET_GPT, PORTEE_GPT } from '../src/lib/mcp-gpt/pur.ts'

const [fichier, baseUrl = 'https://journal-d-etude-beta.vercel.app'] = process.argv.slice(2)
if (!fichier) {
  console.error('Usage : node scripts/creer-cle-gpt.mjs <fichier du coffre> [base_url]')
  process.exit(2)
}
if (existsSync(fichier)) {
  console.error('Refuse : le fichier existe deja (une cle en service ne s ecrase pas).')
  process.exit(2)
}
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(baseUrl) && !/^http:\/\/localhost(:\d+)?$/.test(baseUrl)) {
  console.error('Refuse : base_url = https://<hote> sans chemin (par defaut https://journal-d-etude-beta.vercel.app).')
  process.exit(2)
}

const secret = `gpt_${randomBytes(32).toString('base64url')}`
if (!SECRET_GPT.test(secret)) {
  console.error('Secret mal forme (ne devrait jamais arriver) : rien n est cree.')
  process.exit(1)
}
const nom = 'ChatGPT (Projet Belrive, connecteur MCP)'

const prisma = new PrismaClient()
try {
  const [ligne] = await prisma.$queryRawUnsafe(
    `insert into public.cockpit_tab_cles (nom, empreinte, portee) values ($1, $2, $3)
     returning cle_id::text as cle_id, to_char(cree_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as cree_le`,
    nom, empreinteCleGpt(secret), PORTEE_GPT,
  )
  writeFileSync(fichier, JSON.stringify({
    url_connecteur: `${baseUrl}/api/mcp/${secret}`,
    a_coller_dans: 'ChatGPT > Réglages > Apps (Applications et connecteurs) > Paramètres avancés > Mode développeur, puis Créer : URL du serveur MCP, authentification « Aucune ».',
    cle_id: ligne.cle_id,
    nom,
    portee: PORTEE_GPT,
    cree_le: ligne.cree_le,
    deploye_sur: 'Vercel journal-d-etude-beta, route /api/mcp/<secret> : empreinte (sha256 prefixe mcp-gpt-belrive:) dans cockpit_tab_cles (Supabase), le secret lui-meme nulle part ailleurs',
    couper: 'Cockpit, ecran Perso, bloc « Accès de ChatGPT (Belrive) » : Couper la clé (effet immediat, sans redeploiement)',
  }, null, 2) + '\n', { mode: 0o600 })
  console.log(`Cle creee (cle_id ${ligne.cle_id}, portee ${PORTEE_GPT}), URL rangee dans le coffre. Elle n est pas affichee.`)
} finally {
  await prisma.$disconnect()
}
