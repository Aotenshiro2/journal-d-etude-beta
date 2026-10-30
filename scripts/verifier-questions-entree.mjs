// Verification HORS LIGNE des questions d'entree de l'academie (30/10/2026) :
// les questions mot pour mot, le nettoyage d'une reponse (caracteres de controle
// et invisibles, longueur), la lecture du corps de la route eleve et de celle du
// cockpit, la regle « une seule fois », ce que /moi dit au site, la migration,
// et la lecture du code des routes (aucune reponse dans les journaux).
// Fonctions pures et lecture de fichiers : aucune base, aucun reseau.
//
// Lancement (depuis apps/journal-d-etude) : node scripts/verifier-questions-entree.mjs
// Contre la base (transaction annulee) : scripts/essayer-migration-questions-entree.mjs.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import * as Q from '../src/lib/academie/questions-entree.ts'

let blocs = 0
async function bloc(nom, fn) {
  await fn()
  blocs++
  console.log(`ok  ${nom}`)
}
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const Q1 = "Qu'est-ce qui t'empêche aujourd'hui de progresser en trading ?"
const Q2 = "Qu'est-ce qui t'a fait douter un instant avant de t'inscrire au 10% Club ou au Live Club ?"
// Tiret demi-cadratin et cadratin, guillemets courbes, points de suspension en un caractere, espaces insecables.
const INTERDITS = /[–—‘’“”…  ]/
const c = String.fromCharCode
const UUID_A = 'a0000000-0000-4000-8000-00000000000a'
const UUID_B = 'b0000000-0000-4000-8000-00000000000b'

await bloc('questions : version 1 mot pour mot (GO du 30/10), typographie clavier, sans le mot IA ; version actuelle = la derniere', () => {
  assert.equal(Q.VERSIONS_QUESTIONS[0].version, 1)
  assert.deepEqual([...Q.VERSIONS_QUESTIONS[0].questions], [Q1, Q2])
  assert.equal(Q.QUESTIONS_ACTUELLES, Q.VERSIONS_QUESTIONS[Q.VERSIONS_QUESTIONS.length - 1])
  const numeros = Q.VERSIONS_QUESTIONS.map(v => v.version)
  assert.deepEqual(numeros, [...numeros].sort((a, b) => a - b))
  assert.equal(new Set(numeros).size, numeros.length)
  for (const v of Q.VERSIONS_QUESTIONS) {
    assert.equal(v.questions.length, 2)
    for (const t of v.questions) {
      assert.doesNotMatch(t, INTERDITS, t)
      assert.doesNotMatch(t, /\bIA\b/, t)
      assert.ok(t.length >= 1 && t.length <= 300, 'longueur bornee par la migration (300)')
    }
  }
  assert.equal(Q.questionsDeVersion(1)?.version, 1)
  for (const x of [0, 99, '1', 1.5, null, undefined]) assert.equal(Q.questionsDeVersion(x), null, String(x))
})

await bloc('nettoyerReponse : controles et invisibles retires, fins de ligne, espaces, lignes vides, vide = null, bornes', () => {
  assert.equal(Q.nettoyerReponse(null), null)
  assert.equal(Q.nettoyerReponse(undefined), null)
  assert.equal(Q.nettoyerReponse('   \n\t '), null)
  assert.equal(Q.nettoyerReponse(42), 'invalide')
  assert.equal(Q.nettoyerReponse({ t: 'x' }), 'invalide')
  // Controles C0 et C1, echappement ANSI, zero largeur, inversions de sens, BOM.
  const sale = `Je${c(0)} perds${c(7)} ${c(0x1b)}[31mpatience${c(0x85)} ${c(0x200b)}vite${c(0x202e)}${c(0x2066)}${c(0xfeff)}`
  assert.equal(Q.nettoyerReponse(sale), 'Je perds [31mpatience vite')
  assert.equal(Q.nettoyerReponse('  Ligne 1\r\nLigne\t2  \rLigne 3  '), 'Ligne 1\nLigne 2\nLigne 3')
  assert.equal(Q.nettoyerReponse('a\n\n\n\n\nb'), 'a\n\nb')
  assert.equal(Q.nettoyerReponse('trop    d   espaces'), 'trop d espaces')
  // NFC : un e suivi de l'accent combinant devient le caractere compose.
  assert.equal(Q.nettoyerReponse(`e${c(0x301)}tape`), `${c(0xe9)}tape`)
  assert.equal(Q.nettoyerReponse('x'.repeat(Q.LONGUEUR_MAX_REPONSE)), 'x'.repeat(Q.LONGUEUR_MAX_REPONSE))
  assert.equal(Q.nettoyerReponse('x'.repeat(Q.LONGUEUR_MAX_REPONSE + 1)), 'trop_long')
  // Les invisibles ne comptent pas dans la longueur.
  assert.equal(Q.nettoyerReponse('x'.repeat(Q.LONGUEUR_MAX_REPONSE) + c(0x200b).repeat(50)), 'x'.repeat(Q.LONGUEUR_MAX_REPONSE))
  assert.equal(Q.LONGUEUR_MAX_REPONSE, 2000)
})

await bloc('saisie eleve : reponses facultatives (au moins une), passe, essai, version connue seulement', () => {
  const r = Q.lireSaisieQuestions({ version: 1, reponse_1: '  Le temps ', reponse_2: '' })
  assert.deepEqual(r, { version: 1, questions: Q.VERSIONS_QUESTIONS[0].questions, passe: false, reponses: ['Le temps', null], essai: false })
  assert.deepEqual(Q.lireSaisieQuestions({ version: 1, reponse_2: 'Le prix' }).reponses, [null, 'Le prix'])
  const p = Q.lireSaisieQuestions({ version: 1, passe: true, reponse_1: 'ignoree' })
  assert.equal(p.passe, true)
  assert.deepEqual(p.reponses, [null, null])
  assert.equal(Q.lireSaisieQuestions({ version: 1, passe: true, essai: true }).essai, true)
  assert.equal(Q.lireSaisieQuestions({ version: 1, reponse_1: 'x', essai: 'oui' }).essai, false)
  assert.deepEqual(Q.lireSaisieQuestions({ version: 1 }), { erreur: 'vide' })
  assert.deepEqual(Q.lireSaisieQuestions({ version: 1, reponse_1: ` ${c(0x200b)} ` }), { erreur: 'vide' })
  assert.deepEqual(Q.lireSaisieQuestions({ version: 1, passe: 'true', reponse_1: '' }), { erreur: 'vide' })
  assert.deepEqual(Q.lireSaisieQuestions({ version: 1, reponse_1: ['x'] }), { erreur: 'reponse' })
  assert.deepEqual(Q.lireSaisieQuestions({ version: 1, reponse_1: 'x'.repeat(2001) }), { erreur: 'longueur' })
  assert.deepEqual(Q.lireSaisieQuestions({ version: 2, reponse_1: 'x' }), { erreur: 'version' })
  assert.deepEqual(Q.lireSaisieQuestions({ reponse_1: 'x' }), { erreur: 'version' })
  assert.deepEqual(Q.lireSaisieQuestions(null), { erreur: 'version' })
  assert.ok(Q.CORPS_MAX > 2 * Q.LONGUEUR_MAX_REPONSE * 4, 'le plafond du corps laisse passer deux reponses pleines, meme echappees')
})

await bloc('/moi : poser seulement pour un compte non admin sans reponse ; les questions actuelles toujours rendues', () => {
  const actuelles = { version: Q.QUESTIONS_ACTUELLES.version, questions: Q.QUESTIONS_ACTUELLES.questions }
  assert.deepEqual(Q.vueQuestions('a_poser', false), { poser: true, ...actuelles })
  assert.deepEqual(Q.vueQuestions('a_poser', true), { poser: false, ...actuelles })
  assert.deepEqual(Q.vueQuestions('faites', false), { poser: false, ...actuelles })
  assert.deepEqual(Q.vueQuestions('indisponible', false), { poser: false, ...actuelles })
})

await bloc('cockpit : membre (1 a 20 uuid, dedoublonnes), lister (depuis, limite 1..1000), le reste refuse', () => {
  assert.deepEqual(Q.lireDemandeCockpit({ action: 'membre', user_ids: [UUID_A.toUpperCase(), UUID_A, ` ${UUID_B} `] }),
    { action: 'membre', userIds: [UUID_A, UUID_B] })
  for (const ids of [[], ['pas-un-uuid'], 'x', null, Array.from({ length: 21 }, (_, i) => `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`)]) {
    assert.ok('erreur' in Q.lireDemandeCockpit({ action: 'membre', user_ids: ids }), JSON.stringify(ids)?.slice(0, 40))
  }
  assert.deepEqual(Q.lireDemandeCockpit({ action: 'lister' }), { action: 'lister', depuis: null, limite: Q.MAX_LISTE })
  assert.deepEqual(Q.lireDemandeCockpit({ action: 'lister', depuis: '2026-10-26T00:00:00Z', limite: 50 }),
    { action: 'lister', depuis: new Date('2026-10-26T00:00:00Z'), limite: 50 })
  assert.ok('erreur' in Q.lireDemandeCockpit({ action: 'lister', depuis: 'lundi' }))
  for (const l of [0, 1001, 2.5, '10']) assert.ok('erreur' in Q.lireDemandeCockpit({ action: 'lister', limite: l }), String(l))
  assert.ok('erreur' in Q.lireDemandeCockpit({ action: 'effacer' }))
  assert.ok('erreur' in Q.lireDemandeCockpit(null))
})

await bloc('une seule fois : insert on conflict do nothing, la seconde ecriture rend « deja » ; parametres dans l ordre des colonnes', async () => {
  assert.match(Q.SQL_ENREGISTRER_QUESTIONS, /on conflict \(user_id\) do nothing\s+returning repondu_le/)
  assert.doesNotMatch(Q.SQL_ENREGISTRER_QUESTIONS, /do update/i)
  const appels = []
  const client = rendu => ({
    async $queryRawUnsafe(sql, ...v) { appels.push({ sql, v }); return rendu },
    async $executeRawUnsafe() { throw new Error('pas attendu') },
  })
  const s = Q.lireSaisieQuestions({ version: 1, reponse_1: 'Le temps', reponse_2: null })
  assert.equal(await Q.enregistrerQuestions(client([{ repondu_le: new Date() }]), UUID_A, s), 'enregistre')
  assert.deepEqual(appels[0].v, [UUID_A, 1, Q1, 'Le temps', Q2, null, false])
  assert.equal(await Q.enregistrerQuestions(client([]), UUID_A, s), 'deja')
  assert.equal(await Q.etatQuestions(client([{ passe: true }]), UUID_A), 'faites')
  assert.equal(await Q.etatQuestions(client([]), UUID_A), 'a_poser')
  const ligne = { user_id: UUID_A, version: 1, question_1: Q1, reponse_1: 'a', question_2: Q2, reponse_2: null, passe: false, repondu_le: new Date('2026-10-30T10:00:00Z') }
  assert.deepEqual(await Q.questionsDesComptes(client([ligne]), [UUID_A]), [{
    user_id: UUID_A, version: 1, questions: [Q1, Q2], reponses: ['a', null], passe: false, repondu_le: '2026-10-30T10:00:00.000Z',
  }])
  await Q.listerQuestions(client([]), null, 10)
  assert.deepEqual(appels.at(-1).v, [null, 10])
  await Q.listerQuestions(client([]), new Date('2026-10-26T00:00:00Z'), 10)
  assert.deepEqual(appels.at(-1).v, ['2026-10-26T00:00:00.000Z', 10])
})

await bloc('migration : table fermee (RLS forcee, revoke anon et authenticated), coherence passe/reponses, bornes, aucun point-virgule en commentaire', () => {
  const sql = lire('../../../sites/Aoknowledgecom/supabase/migrations/20261031170000_academie_questions_entree.sql')
  assert.match(sql, /create table if not exists public\.academie_questions_entree/)
  assert.match(sql, /user_id\s+uuid primary key/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /force row level security/)
  assert.match(sql, /revoke all on public\.academie_questions_entree from anon, authenticated/)
  assert.doesNotMatch(sql, /create policy/i)
  assert.doesNotMatch(sql, /grant [^\n]* to (anon|authenticated)/i)
  assert.match(sql, /grant select on public\.academie_questions_entree to service_role/)
  assert.match(sql, /\(passe and reponse_1 is null and reponse_2 is null\)/)
  assert.match(sql, /char_length\(reponse_1\) between 1 and 2000/)
  assert.match(sql, /char_length\(reponse_2\) between 1 and 2000/)
  for (const l of sql.split('\n').filter(x => x.trim().startsWith('--'))) assert.ok(!l.includes(';'), `point-virgule en commentaire : ${l}`)
})

await bloc('routes : aucune reponse ni message brut dans les journaux, Bearer et allowlist, /moi ne tombe pas pour les questions', () => {
  const eleve = lire('../src/app/api/academie/questions/route.ts')
  const cockpit = lire('../src/app/api/cockpit/academie/questions/route.ts')
  const moi = lire('../src/app/api/academie/moi/route.ts')
  const logs = t => t.split('\n').filter(l => /console\.(log|info|warn|error)/.test(l))
  for (const [nom, t] of [['eleve', eleve], ['cockpit', cockpit]]) {
    const lignes = logs(t)
    assert.ok(lignes.length > 0, nom)
    for (const l of lignes) {
      assert.doesNotMatch(l, /reponses\[|reponse_|\bbrut\b|\bcorps\b|\.message|messageErreur|email|JSON\.stringify/, `${nom} : ${l.trim()}`)
    }
  }
  assert.match(eleve, /compteDuJeton\(req\)/)
  assert.match(eleve, /tronquer\(userId\)/)
  assert.match(eleve, /if \(saisie\.essai\)[\s\S]{0,300}essai: true/)
  assert.match(cockpit, /cockpit_allowlist/)
  assert.match(cockpit, /'Cache-Control': 'no-store'/)
  assert.match(moi, /questions_entree: vueQuestions\(await questions, droits\.admin\)/)
  assert.match(moi, /etatQuestions\(prisma, userId\)\.catch\(/)
})

await bloc('site : la demo reprend les questions mot pour mot', () => {
  const chemin = new URL('../../../sites/Aoknowledgecom/v3/src/academie/demo.ts', import.meta.url)
  if (!existsSync(chemin)) { console.log('    (site absent : bloc saute)'); return }
  const demo = readFileSync(chemin, 'utf8')
  assert.ok(demo.includes(JSON.stringify(Q1).slice(1, -1)) || demo.includes(Q1), 'question 1')
  assert.ok(demo.includes(Q2), 'question 2')
})

console.log(`\n${blocs} blocs, tout passe.`)
