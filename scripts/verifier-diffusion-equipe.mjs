// Verification HORS LIGNE (05/11/2026) : qui recoit ce qui part « a l'equipe »
// par Agent AOK. Brice, 05/11 : Adil parle a Agent AOK pour repondre au
// support ; Brice, 15/10, sur le resume du matin : « on ne rajoute pas Adil ».
// Son compte a diffusion = 'support' (migration 20261105230000). Ce script
// relit le code : toute lecture de cockpit_telegram_comptes qui ENVOIE a
// l'equipe doit filtrer sur diffusion, sauf les lectures listees ici (elles
// reconnaissent l'equipe, ou sont l'alerte du support, qui part a tous).
// Une nouvelle diffusion qui oublie le filtre fait echouer ce script.
// Aucune base, aucun reseau.
// Lancement (Node 22, depuis apps/journal-d-etude) : node scripts/verifier-diffusion-equipe.mjs
// Sort en code 1 au premier ecart.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = fileURLToPath(new URL('..', import.meta.url))
let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8')

function fichiers(dossier) {
  const sortie = []
  for (const nom of readdirSync(join(RACINE, dossier))) {
    const chemin = join(dossier, nom)
    if (statSync(join(RACINE, chemin)).isDirectory()) sortie.push(...fichiers(chemin))
    else if (/\.(ts|tsx)$/.test(nom)) sortie.push(chemin.split('\\').join('/'))
  }
  return sortie
}

/** Chaque lecture de la table : le texte de la requete, du « from » au backtick suivant. */
function lectures() {
  const sortie = []
  for (const f of fichiers('src')) {
    const texte = lire(f)
    let i = texte.indexOf('from public.cockpit_telegram_comptes')
    while (i !== -1) {
      const fin = texte.indexOf('`', i)
      sortie.push({ fichier: f, requete: texte.slice(i, fin === -1 ? i + 300 : fin) })
      i = texte.indexOf('from public.cockpit_telegram_comptes', i + 1)
    }
  }
  return sortie
}

// Les lectures SANS filtre permises, par fichier (nombre exact), et pourquoi.
const SANS_FILTRE = {
  'src/lib/alerte-equipe-telegram.ts': 1,        // alerterEquipeTelegram : l'alerte du SUPPORT, a tous (Adil compris)
  'src/lib/agent-cockpit-telegram.ts': 1,        // verrou 2 : qui peut parler a l'agent
  'src/lib/agent-equipe.ts': 1,                  // les fils de l'equipe (questions entre membres, demandes en suspens)
  'src/lib/liveclub/reconnaissance.ts': 2,       // reconnaitre l'equipe (exclue des membres)
  'src/lib/liveclub/resume.ts': 1,               // exclure l'equipe des faits du resume (l'ENVOI, lui, filtre)
  'src/lib/liveclub/relais.ts': 1,               // exclure l'equipe des silences du groupe
  'src/lib/tab/notes.ts': 1,                     // le compte de Brice seul
  'src/lib/securite/alerte.ts': 1,               // le compte de Brice seul
}

const toutes = lectures()

bloc('chaque lecture qui diffuse a l equipe filtre sur diffusion', () => {
  const sans = {}
  for (const l of toutes) if (!l.requete.includes('diffusion')) sans[l.fichier] = (sans[l.fichier] ?? 0) + 1
  for (const [f, k] of Object.entries(sans)) {
    assert.ok(f in SANS_FILTRE, `${f} lit cockpit_telegram_comptes sans filtre diffusion (diffusion a l equipe ? ajouter « where diffusion = 'equipe' »)`)
    assert.equal(k, SANS_FILTRE[f], `${f} : ${k} lecture(s) sans filtre, ${SANS_FILTRE[f]} attendue(s)`)
  }
  for (const f of Object.keys(SANS_FILTRE)) assert.ok(f in sans, `${f} n a plus de lecture sans filtre : mettre SANS_FILTRE a jour`)
})

bloc('les diffusions a l equipe filtrees : resume, cartes, alertes hors support', () => {
  const filtrees = new Set(toutes.filter(l => l.requete.includes("diffusion = 'equipe'")).map(l => l.fichier))
  for (const f of ['src/lib/liveclub/resume.ts', 'src/lib/cartes-fin-de-mois.ts', 'src/lib/tab/repondre.ts', 'src/lib/liveclub/lots.ts',
    'src/lib/liveclub/pause-depot.ts', 'src/lib/liveclub/rebonds.ts', 'src/lib/liveclub/comptes-telegram.ts', 'src/lib/liveclub/corrections-pseudo.ts',
    'src/lib/academie/club-paypal.ts', 'src/lib/compte-membre.ts', 'src/lib/alerte-equipe-telegram.ts']) {
    assert.ok(filtrees.has(f), `${f} : diffusion a l equipe non filtree`)
  }
  const resume = lire('src/lib/liveclub/resume.ts')
  assert.equal((resume.match(/where diffusion = 'equipe'/g) ?? []).length, 1, 'resume du matin : un seul envoi, filtre')
})

bloc('alerterEquipeTexte : l equipe seule, le support avec support: true', () => {
  const a = lire('src/lib/alerte-equipe-telegram.ts')
  assert.match(a, /support\?: boolean/)
  assert.match(a, /where diffusion = 'equipe' or \$\{o\.support === true\}::boolean/)
  const r = lire('src/lib/support-reponse.ts')
  assert.match(r, /reponse partagee avec l'equipe`, support: true \}/, 'la reponse de l equipe a un fil Support part aussi a Adil')
  for (const f of ['src/lib/liveclub/parrainage.ts', 'src/lib/cockpit-lien-magique.ts', 'src/app/api/cockpit/liveclub/telegram/route.ts']) {
    assert.doesNotMatch(lire(f), /support: true/, `${f} : alerte hors support, pas pour Adil`)
  }
})

bloc('l alerte du support (demande d humain) part a tous les comptes', () => {
  const a = lire('src/lib/alerte-equipe-telegram.ts')
  const debut = a.indexOf('export async function alerterEquipeTelegram')
  const corps = a.slice(debut, a.indexOf('export type OptionsTexteEquipe'))
  assert.match(corps, /select telegram_id from public\.cockpit_telegram_comptes order by cree_le/)
  assert.doesNotMatch(corps, /diffusion/)
})

bloc('migrations : la colonne d abord, le compte d Adil (support) ensuite', () => {
  const dossier = '../../sites/Aoknowledgecom/supabase/migrations/'
  const colonne = `${dossier}20261105230000_agent_aok_adil_support.sql`
  const compte = `${dossier}20261105230100_agent_aok_compte_adil.sql`
  if (!existsSync(join(RACINE, colonne))) { console.log('    (migrations hors de ce dossier : non relues)'); return }
  const a = lire(colonne)
  const b = lire(compte)
  assert.match(a, /add column if not exists diffusion text not null default 'equipe'/)
  assert.match(a, /check \(diffusion in \('equipe', 'support'\)\)/)
  assert.doesNotMatch(a, /insert into/, 'la 1re migration ne relie personne (le code qui filtre doit etre en ligne avant)')
  assert.match(b, /select 896144604, a\.user_id, 'adil', 'support'/)
  assert.match(b, /join auth\.users u on u\.id = a\.user_id/, 'Adil seulement s il est dans cockpit_allowlist')
  for (const sql of [a, b]) {
    for (const ligne of sql.split('\n')) if (ligne.trim().startsWith('--')) assert.ok(!ligne.includes(';'), `point-virgule dans un commentaire : ${ligne}`)
  }
})

bloc('l agent sait qu Adil est sur Agent AOK pour le support', () => {
  const p = lire('src/lib/agent-cockpit.ts')
  assert.doesNotMatch(p, /Il n'est pas sur le bot Telegram/)
  assert.match(p, /le titulaire de ce fil \(Brice, Mélanie ou Adil\)/)
  assert.match(p, /Depuis le 05\/11 il est aussi sur Agent AOK/)
})

console.log(`\n${n} blocs ok (${toutes.length} lectures de cockpit_telegram_comptes relues)`)
process.exit(0)
