// Verification HORS LIGNE (06/11/2026) : l'agent ne lit pas le fonds d'archive
// sans autorisation. Brice, 05/11 (Meet avec Alex) : « corriger la protection
// pour que l'agent ne puisse pas lire les tables d'archive sans autorisation »,
// confie le 06/11. L'autorisation : cockpit_allowlist.acces_fonds (migration
// 20260901120000), relue a chaque tour (lireAccesFonds, fermee en cas de doute).
// Teste le VRAI verrou (verrouSql exporte d'agent-cockpit.ts) et le filtre de
// la fiche (horsFonds), puis relit le branchement. Aucune base, aucun reseau.
// Lancement (Node 22, depuis apps/journal-d-etude) : node scripts/verifier-acces-fonds.mjs
// Sort en code 1 au premier ecart.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const { verrouSql } = await import('../src/lib/agent-cockpit.ts')
const P = await import('../src/lib/fiche-personne-pur.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const SANS = { fonds: false }
const AVEC = { fonds: true }

const DU_FONDS = [
  'select * from public.cockpit_arch_personnes limit 5',
  'select count(*) from cockpit_arch_paroles',
  'with x as (select * from public."cockpit_arch_vies") select * from x',
  'SELECT nom FROM PUBLIC.COCKPIT_ARCH_DOSSIERS',
  'select p.nom from public.cockpit_membres m join public.cockpit_arch_personnes p on p.membre_id = m.membre_id',
  'select * from public.cockpit_membre_telegram',
  'select * from public.cockpit_membre_fonds_manuel',
  "select public.cockpit_effacement_apercu(3, '{}'::bigint[], '{}'::uuid[], '{}'::text[], '{}'::text[])",
  "select * from public.cockpit_effacement_cibles('x')",
]

bloc('sans acces au fonds : toute lecture du fonds est refusee', () => {
  for (const sql of DU_FONDS) {
    const refus = verrouSql(sql, SANS)
    assert.ok(refus && /fonds d'archive/.test(refus), `devait etre refuse : ${sql}`)
  }
})

bloc('avec acces au fonds : les memes lectures passent', () => {
  for (const sql of DU_FONDS) assert.equal(verrouSql(sql, AVEC), null, `devait passer : ${sql}`)
})

bloc('le reste du cockpit passe toujours, avec ou sans acces au fonds', () => {
  for (const sql of [
    'select count(*) from public.cockpit_membres',
    'select * from public.cockpit_telegram_messages limit 3',
    'select telegram_id from public.cockpit_telegram_membres',
    'select * from public.cockpit_paiements where montant > 0',
  ]) {
    assert.equal(verrouSql(sql, SANS), null, sql)
    assert.equal(verrouSql(sql, AVEC), null, sql)
  }
})

bloc('les autres verrous tiennent, quel que soit l acces au fonds', () => {
  for (const o of [SANS, AVEC]) {
    assert.match(verrouSql('delete from public.cockpit_arch_personnes', o), /SELECT/)
    assert.match(verrouSql('select * from public.cockpit_perso_notes', o), /espace personnel/)
    assert.match(verrouSql('select * from public.cockpit_liveclub_codes', o), /serveur du bot/)
    assert.match(verrouSql('select query_to_xml(\'select 1\', true, true, \'\')', o), /SQL dynamique/)
    assert.match(verrouSql('select * from auth.users', o), /schéma public/)
  }
  // Un nom fabrique (identifiant echappe ou SQL dynamique) reste refuse, meme avec acces.
  assert.ok(verrouSql('select * from U&"cockpit\\005farch_personnes"', SANS))
})

bloc('la fiche sans acces au fonds : aucun noeud d archive, ni touche ni lien', () => {
  const touches = [
    { noeud: 'tg:42', champ: 'nom', valeur: 'X', exact: true },
    { noeud: 'archive:p7', champ: 'nom', valeur: 'X', exact: true },
    { noeud: 'membre:m1', champ: 'email', valeur: 'x@y.z', exact: true },
  ]
  const liens = [
    { a: 'tg:42', b: 'membre:m1', nature: 'rattachement', certain: true },
    { a: 'tg:42', b: 'archive:p7', nature: 'compte', certain: true },
    { a: 'archive:p7', b: 'membre:m9', nature: 'fiche', certain: true },
  ]
  const r = P.horsFonds(touches, liens)
  assert.deepEqual(r.touches.map((t) => t.noeud), ['tg:42', 'membre:m1'])
  assert.deepEqual(r.liens.map((l) => `${l.a}>${l.b}`), ['tg:42>membre:m1'])
  assert.match(P.REPONSE_HORS_FONDS, /pas ouvert à ce compte/)
})

bloc('le branchement : relu a chaque tour, ferme en cas de doute, passe aux deux outils', () => {
  const agent = lire('src/lib/agent-cockpit.ts')
  assert.match(agent, /const accesFonds = await lireAccesFonds\(userId\)/)
  assert.match(agent, /executerSql\(sql, accesFonds\)/)
  assert.match(agent, /fichePersonnePourAgent\(bloc\.input, \{ fonds: accesFonds \}\)/)
  assert.match(agent, /select acces_fonds from public\.cockpit_allowlist where user_id = \$\{userId\}::uuid/)
  const lireAcces = agent.slice(agent.indexOf('export async function lireAccesFonds'), agent.indexOf('async function executerSql'))
  assert.match(lireAcces, /return l\[0\]\?\.acces_fonds === true/, 'seul un vrai « true » ouvre')
  assert.match(lireAcces, /catch[\s\S]*return false/, 'une panne ferme')
  assert.equal((agent.match(/executerSql\(/g) ?? []).length, 2, 'une definition et un seul appel')
  const fiche = lire('src/lib/fiche-personne.ts')
  assert.match(fiche, /if \(!fonds && qui\.genre === 'archive'\) return \{ statut: 'aucun', reponse: REPONSE_HORS_FONDS, libelle \}/)
  assert.match(fiche, /const touches = fonds \? trouve\.touches : horsFonds\(trouve\.touches, \[\]\)\.touches/)
  assert.match(fiche, /if \(!fonds\) liens = horsFonds\(\[\], liens\)\.liens/)
  assert.match(fiche, /construireFiche\(tx, qui, BUDGET_FICHE, \{ fonds: o\.fonds \}\)/)
})

console.log(`\n${n} blocs ok`)
process.exit(0)
