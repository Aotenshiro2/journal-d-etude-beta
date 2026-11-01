/**
 * Cree la cle du connecteur MCP du cockpit pour Tache (01/11/2026). Un secret
 * aleatoire de 256 bits (tmcp_ + 43 caracteres base64url), son EMPREINTE
 * (sha256 prefixee « mcp-cockpit-tache: », la meme que empreinteCleTacheMcp de
 * src/lib/mcp-tache/pur.ts) dans une ligne DEDIEE de cockpit_tab_cles (portee
 * tache_mcp, coupee seule, sans toucher la cle API de Tache), et l'URL
 * complete du connecteur dans le coffre local SEULEMENT. Le secret n'est
 * jamais affiche, ni en console ni dans un journal.
 *
 *   cd apps/journal-d-etude
 *   set -a; . ./.env; set +a
 *   node scripts/creer-cle-tache-mcp.mjs --essai          # verifie seulement, n'ecrit rien
 *   node scripts/creer-cle-tache-mcp.mjs [fichier du coffre] [base_url]
 *
 * Coffre par defaut :
 *   /mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/tache-mcp.local.json
 * base_url par defaut : https://journal-d-etude-beta.vercel.app/api/mcp-cockpit
 *
 * PREALABLES : la migration 20261101200000_cockpit_tab_cles_tache_mcp.sql
 * appliquee (sinon la base refuse la portee et rien n'est cree), et le journal
 * deploye avec /api/mcp-cockpit (sinon l'URL rend 404).
 *
 * Le fichier du coffre ne doit pas exister (pas d'ecrasement d'une cle en
 * service). Pour remplacer la cle : la couper depuis le cockpit (bloc « Accès
 * de Tache », clé MCP), renommer l'ancien fichier, relancer ce script, et
 * redonner la nouvelle URL au concepteur de Tache.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const PORTEE = 'tache_mcp'
const NOM = 'Tache (connecteur MCP)'
const args = process.argv.slice(2)
const essai = args.includes('--essai')
const [
  fichier = '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/tache-mcp.local.json',
  baseUrl = 'https://journal-d-etude-beta.vercel.app/api/mcp-cockpit',
] = args.filter((a) => a !== '--essai')

if (existsSync(fichier)) {
  console.error('Refuse : le fichier existe deja (une cle en service ne s ecrase pas).')
  process.exit(2)
}
if (!existsSync(dirname(fichier))) {
  console.error(`Refuse : le dossier du coffre n existe pas (${dirname(fichier)}).`)
  process.exit(2)
}
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/api\/mcp-cockpit$/i.test(baseUrl) && !/^http:\/\/localhost(:\d+)?\/api\/mcp-cockpit$/.test(baseUrl)) {
  console.error('Refuse : base_url = https://<hote>/api/mcp-cockpit (par defaut https://journal-d-etude-beta.vercel.app/api/mcp-cockpit).')
  process.exit(2)
}

const secret = `tmcp_${randomBytes(32).toString('base64url')}`
// Meme forme que SECRET_TACHE_MCP de src/lib/mcp-tache/pur.ts.
if (!/^tmcp_[A-Za-z0-9_-]{43}$/.test(secret)) {
  console.error('Secret mal forme (ne devrait jamais arriver) : rien n est cree.')
  process.exit(1)
}
const empreinte = createHash('sha256').update(`mcp-cockpit-tache:${secret}`, 'utf8').digest('hex')

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
try {
  // La base connait-elle la portee (migration passee) ? Lecture seule.
  let def
  try {
    ;[def] = await prisma.$queryRawUnsafe(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       where c.conname = 'cockpit_tab_cles_portee_check' and c.conrelid = 'public.cockpit_tab_cles'::regclass`,
    )
  } catch {
    console.error('Base injoignable (variables DATABASE_URL du .env ?). Rien n est cree.')
    process.exit(1)
  }
  const migree = String(def?.def ?? '').includes(`'${PORTEE}'`)
  if (essai) {
    const [compte] = await prisma.$queryRawUnsafe(
      `select count(*)::int as actives from public.cockpit_tab_cles where portee = $1 and coupee_le is null`, PORTEE,
    ).catch(() => [{ actives: null }])
    console.log([
      'Essai (rien n est ecrit) :',
      `- coffre : ${fichier} (absent, ok)`,
      `- base_url : ${baseUrl}`,
      `- migration 20261101200000 : ${migree ? 'passee' : 'PAS ENCORE PASSEE (la creation serait refusee)'}`,
      `- cles ${PORTEE} actives aujourd hui : ${compte?.actives ?? 'illisible'}`,
    ].join('\n'))
    process.exit(migree ? 0 : 3)
  }
  if (!migree) {
    console.error('Refuse : la portee tache_mcp n existe pas encore (appliquer la migration 20261101200000_cockpit_tab_cles_tache_mcp.sql). Rien n est cree.')
    process.exit(1)
  }
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
      ? 'Refuse par la base : la portee tache_mcp n existe pas encore (migration 20261101200000). Rien n est cree.'
      : 'Insertion impossible (base injoignable ou refus). Rien n est cree.')
    process.exit(1)
  }
  writeFileSync(fichier, JSON.stringify({
    url: `${baseUrl}/${secret}`,
    transport: 'MCP en HTTP sans etat (Streamable HTTP, POST JSON-RPC, reponses application/json, pas de SSE)',
    authentification: 'Le secret est dans l URL : aucune autre authentification. En option, l en-tete Authorization: Bearer <cle API de Tache> ouvre le meme connecteur.',
    cree_le: ligne.cree_le,
    portee: PORTEE,
    cle_id: ligne.cle_id,
    nom: NOM,
    droits: 'Exactement ceux de la cle API de Tache (portee tache, memes routes que Tab) : chaque outil appelle une route de /api/tab/v1.',
    deploye_sur: 'Vercel journal-d-etude-beta : empreinte sha256 dans cockpit_tab_cles (Supabase, portee tache_mcp), le secret lui-meme nulle part ailleurs',
    couper: 'Cockpit, Accueil, bloc « Accès de Tache », clé MCP : « Couper la clé » (effet immediat, jamais rallumee). La cle API de Tache reste active.',
  }, null, 2) + '\n', { mode: 0o600 })
  console.log(`Cle creee (cle_id ${ligne.cle_id}, portee ${PORTEE}), URL rangee dans le coffre. Elle n est pas affichee.`)
} finally {
  await prisma.$disconnect()
}
