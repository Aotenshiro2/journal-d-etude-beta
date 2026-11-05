/**
 * Cree la cle du connecteur MCP de l'assistant d'Alex pour son indicateur
 * (05/11/2026, Brice : « alex va demander a son tab [son assistant IA] de se
 * connecter a notre mcp, prevois ce qu'il faut »). Sur le modele de
 * creer-cle-tache-mcp.mjs : un secret aleatoire de 256 bits (amcp_ + 43
 * caracteres base64url), son EMPREINTE (sha256 prefixee
 * « mcp-alex-indicateur: », la meme que empreinteCleAlex de
 * src/lib/mcp-alex/pur.ts) dans une ligne DEDIEE de cockpit_tab_cles (portee
 * alex_indicateur, coupee seule depuis le cockpit), et l'URL complete du
 * connecteur dans le coffre local SEULEMENT. Le secret n'est jamais affiche,
 * ni en console ni dans un journal.
 *
 *   cd apps/journal-d-etude
 *   set -a; . ./.env; set +a
 *   node scripts/creer-cle-alex-mcp.mjs --essai          # verifie seulement, n'ecrit rien
 *   node scripts/creer-cle-alex-mcp.mjs [fichier du coffre] [base_url]
 *
 * Coffre par defaut :
 *   /mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/alex-indicateur-mcp.local.json
 * base_url par defaut : https://journal-d-etude-beta.vercel.app/api/mcp-alex
 *
 * PREALABLES : la migration 20261105250000_cockpit_liveclub_indicateur.sql
 * appliquee (sinon la base refuse la portee et rien n'est cree), et le journal
 * deploye avec /api/mcp-alex (sinon l'URL rend 404). A LANCER A LA MISE EN
 * LIGNE, pas avant.
 *
 * Le fichier du coffre ne doit pas exister (pas d'ecrasement d'une cle en
 * service). Pour remplacer la cle : la couper depuis le cockpit (bloc « Accès
 * de l'assistant d'Alex »), renommer l'ancien fichier, relancer ce script, et
 * redonner la nouvelle URL a Alex.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const PORTEE = 'alex_indicateur'
const NOM = "Assistant d'Alex (indicateur)"
const args = process.argv.slice(2)
const essai = args.includes('--essai')
const [
  fichier = '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/alex-indicateur-mcp.local.json',
  baseUrl = 'https://journal-d-etude-beta.vercel.app/api/mcp-alex',
] = args.filter((a) => a !== '--essai')

if (existsSync(fichier)) {
  console.error('Refuse : le fichier existe deja (une cle en service ne s ecrase pas).')
  process.exit(2)
}
if (!existsSync(dirname(fichier))) {
  console.error(`Refuse : le dossier du coffre n existe pas (${dirname(fichier)}).`)
  process.exit(2)
}
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/api\/mcp-alex$/i.test(baseUrl) && !/^http:\/\/localhost(:\d+)?\/api\/mcp-alex$/.test(baseUrl)) {
  console.error('Refuse : base_url = https://<hote>/api/mcp-alex (par defaut https://journal-d-etude-beta.vercel.app/api/mcp-alex).')
  process.exit(2)
}

const secret = `amcp_${randomBytes(32).toString('base64url')}`
// Meme forme que SECRET_ALEX de src/lib/mcp-alex/pur.ts.
if (!/^amcp_[A-Za-z0-9_-]{43}$/.test(secret)) {
  console.error('Secret mal forme (ne devrait jamais arriver) : rien n est cree.')
  process.exit(1)
}
const empreinte = createHash('sha256').update(`mcp-alex-indicateur:${secret}`, 'utf8').digest('hex')

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
try {
  // La base connait-elle la portee et la table des demandes (migration passee) ? Lecture seule.
  let etat
  try {
    ;[etat] = await prisma.$queryRawUnsafe(
      `select (select pg_get_constraintdef(c.oid) from pg_constraint c
                where c.conname = 'cockpit_tab_cles_portee_check' and c.conrelid = 'public.cockpit_tab_cles'::regclass) as def,
              to_regclass('public.cockpit_liveclub_indicateur')::text as demandes`,
    )
  } catch {
    console.error('Base injoignable (variables DATABASE_URL du .env ?). Rien n est cree.')
    process.exit(1)
  }
  const migree = String(etat?.def ?? '').includes(`'${PORTEE}'`) && !!etat?.demandes
  if (essai) {
    const [compte] = await prisma.$queryRawUnsafe(
      `select count(*)::int as actives from public.cockpit_tab_cles where portee = $1 and coupee_le is null`, PORTEE,
    ).catch(() => [{ actives: null }])
    console.log([
      'Essai (rien n est ecrit) :',
      `- coffre : ${fichier} (absent, ok)`,
      `- base_url : ${baseUrl}`,
      `- migration 20261105250000 : ${migree ? 'passee' : 'PAS ENCORE PASSEE (la creation serait refusee)'}`,
      `- cles ${PORTEE} actives aujourd hui : ${compte?.actives ?? 'illisible'}`,
    ].join('\n'))
    process.exit(migree ? 0 : 3)
  }
  if (!migree) {
    console.error('Refuse : la portee alex_indicateur ou la table des demandes n existe pas encore (appliquer la migration 20261105250000_cockpit_liveclub_indicateur.sql). Rien n est cree.')
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
      ? 'Refuse par la base : la portee alex_indicateur n existe pas encore (migration 20261105250000). Rien n est cree.'
      : 'Insertion impossible (base injoignable ou refus). Rien n est cree.')
    process.exit(1)
  }
  writeFileSync(fichier, JSON.stringify({
    url: `${baseUrl}/${secret}`,
    transport: 'MCP en HTTP sans etat (Streamable HTTP, POST JSON-RPC, reponses application/json, pas de SSE)',
    authentification: 'Le secret est dans l URL : aucune autre authentification. A donner a Alex seul, qui la colle dans son assistant comme connecteur MCP personnalise.',
    cree_le: ligne.cree_le,
    portee: PORTEE,
    cle_id: ligne.cle_id,
    nom: NOM,
    droits: 'Lecture seule : aide, membres_indicateur (membres actifs qui ont demande l indicateur), departs_indicateur (departs depuis une date). Rien d autre du cockpit.',
    deploye_sur: 'Vercel journal-d-etude-beta : empreinte sha256 dans cockpit_tab_cles (Supabase, portee alex_indicateur), le secret lui-meme nulle part ailleurs',
    couper: 'Cockpit, Accueil, bloc « Accès de l assistant d Alex » : « Couper la clé » (effet immediat, jamais rallumee). Les messages du bot a Alex continuent.',
  }, null, 2) + '\n', { mode: 0o600 })
  console.log(`Cle creee (cle_id ${ligne.cle_id}, portee ${PORTEE}), URL rangee dans le coffre. Elle n est pas affichee.`)
} finally {
  await prisma.$disconnect()
}
