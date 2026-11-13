/**
 * Verifie la partie pure du QUIZ DE FIN DE MODULE (13/11/2026, src/lib/academie/quiz-academie.ts) : le format du
 * champ « quiz » (et les deux quiz brouillons du catalogue), la vue de la page sans les reponses, le corps du POST,
 * la correction, le droit sur le module, et ce que la route laisse sortir. Sans base, sans reseau.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node scripts/verifier-quiz-academie.mjs [--catalogue <dossier des modules>]
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  CORPS_QUIZ_MAX, LIMITES_QUIZ, MAX_QUIZ_HEURE, corriger, droitAuQuiz, lireDemandeQuiz, lireQuiz, lireSlug, quizVisible, vueQuiz,
} from '../src/lib/academie/quiz-academie.ts'

let blocs = 0
const bloc = (nom, f) => { f(); blocs++; console.log(`ok  ${nom}`) }
const args = process.argv.slice(2)
const i = args.indexOf('--catalogue')
const CATALOGUE = i >= 0 ? args[i + 1] : '/mnt/d/6_Societe/Pilotage/Academie/catalogue/modules'
const lire = f => readFileSync(new URL(f, import.meta.url), 'utf8')

const question = (id, extra = {}) => ({
  id, question: `Question ${id} ?`, lecon: 'une-lecon', bonne: 'b', explication: 'Parce que.',
  choix: [{ id: 'a', texte: 'Non' }, { id: 'b', texte: 'Oui' }, { id: 'c', texte: 'Peut-etre' }], ...extra,
})
const quiz = (extra = {}) => ({ version: 2, statut: 'publie', questions: [question('q1'), question('q2', { bonne: 'a' })], ...extra })
const erreur = brut => { const r = lireQuiz(brut); assert.equal(r.ok, false, JSON.stringify(brut).slice(0, 80)); return r.erreur }

bloc('lireQuiz : un quiz juste, remis en forme', () => {
  const r = lireQuiz(quiz({ note: '  a   relire  ' }))
  assert.equal(r.ok, true)
  assert.equal(r.quiz.version, 2)
  assert.equal(r.quiz.statut, 'publie')
  assert.equal(r.quiz.note, 'a relire')
  assert.equal(r.quiz.questions.length, 2)
  assert.deepEqual(r.quiz.questions[1], { ...question('q2', { bonne: 'a' }) })
  // Statut absent : brouillon (jamais publie par defaut). Lecon absente : null.
  const b = lireQuiz({ version: 1, questions: [question('q1', { lecon: undefined })] })
  assert.equal(b.quiz.statut, 'brouillon')
  assert.equal(b.quiz.questions[0].lecon, null)
  // Caracteres invisibles et de controle retires, espaces resserres.
  const c = lireQuiz(quiz({ questions: [question('q1', { question: 'Que​  vaut\u0007 un pip ?' })] }))
  assert.equal(c.quiz.questions[0].question, 'Que vaut un pip ?')
})

bloc('lireQuiz : les fautes arretent l import', () => {
  assert.match(erreur(null), /objet/)
  assert.match(erreur([]), /objet/)
  assert.match(erreur(quiz({ version: 0 })), /version/)
  assert.match(erreur(quiz({ version: 1.5 })), /version/)
  assert.match(erreur(quiz({ statut: 'visible' })), /statut/)
  assert.match(erreur(quiz({ note: '' })), /note/)
  assert.match(erreur(quiz({ questions: [] })), /questions/)
  assert.match(erreur(quiz({ questions: Array.from({ length: LIMITES_QUIZ.questions + 1 }, (_, k) => question(`q${k}`)) })), /questions/)
  assert.match(erreur(quiz({ questions: [question('Q1')] })), /question 1 : id/)
  assert.match(erreur(quiz({ questions: [question('q1'), question('q1')] })), /en double/)
  assert.match(erreur(quiz({ questions: [question('q1', { question: '   ' })] })), /texte de la question/)
  assert.match(erreur(quiz({ questions: [question('q1', { question: 'x'.repeat(LIMITES_QUIZ.question + 1) })] })), /texte de la question/)
  assert.match(erreur(quiz({ questions: [question('q1', { choix: [{ id: 'a', texte: 'Seul' }] })] })), /choix \(2 a 5\)/)
  assert.match(erreur(quiz({ questions: [question('q1', { choix: [{ id: 'a', texte: 'x' }, { id: 'a', texte: 'y' }] })] })), /en double/)
  assert.match(erreur(quiz({ questions: [question('q1', { choix: [{ id: 'a', texte: '' }, { id: 'b', texte: 'y' }] })] })), /choix 1/)
  assert.match(erreur(quiz({ questions: [question('q1', { bonne: 'z' })] })), /bonne/)
  assert.match(erreur(quiz({ questions: [question('q1', { explication: '' })] })), /explication/)
  assert.match(erreur(quiz({ questions: [question('q1', { lecon: 'Une Lecon' })] })), /lecon/)
})

bloc('vueQuiz : la page ne recoit ni la bonne reponse, ni l explication, ni la note', () => {
  const q = lireQuiz(quiz({ statut: 'brouillon', note: 'Note interne' })).quiz
  const v = vueQuiz(q)
  const texte = JSON.stringify(v)
  for (const interdit of ['"bonne"', 'explication', 'Parce que', 'Note interne', '"note"', '"statut"']) {
    assert.equal(texte.includes(interdit), false, interdit)
  }
  assert.equal(v.brouillon, true)
  assert.equal(v.version, 2)
  assert.deepEqual(Object.keys(v.questions[0]).sort(), ['choix', 'id', 'lecon', 'question'])
  assert.equal(vueQuiz({ ...q, statut: 'publie' }).brouillon, false)
})

bloc('quizVisible : publie pour tous, brouillon pour l equipe seulement', () => {
  const membre = { admin: false, equipe: false }
  assert.equal(quizVisible({ statut: 'publie' }, membre), true)
  assert.equal(quizVisible({ statut: 'brouillon' }, membre), false)
  assert.equal(quizVisible({ statut: 'brouillon' }, { admin: true, equipe: false }), true)
  assert.equal(quizVisible({ statut: 'brouillon' }, { admin: false, equipe: true }), true)
})

bloc('lireDemandeQuiz : le corps du POST', () => {
  const ok = lireDemandeQuiz({ module: 'novice-en-trading', version: 1, reponses: { q1: 'a', q2: 'c' } })
  assert.deepEqual(ok, { ok: true, demande: { module: 'novice-en-trading', version: 1, reponses: { q1: 'a', q2: 'c' } } })
  assert.deepEqual(lireDemandeQuiz({ module: '../x', version: 1, reponses: { q1: 'a' } }), { ok: false, erreur: 'module' })
  assert.deepEqual(lireDemandeQuiz({ module: 'm', version: '1', reponses: { q1: 'a' } }), { ok: false, erreur: 'version' })
  assert.deepEqual(lireDemandeQuiz({ module: 'm', version: 1, reponses: [] }), { ok: false, erreur: 'reponses' })
  assert.deepEqual(lireDemandeQuiz({ module: 'm', version: 1, reponses: {} }), { ok: false, erreur: 'reponses' })
  assert.deepEqual(lireDemandeQuiz({ module: 'm', version: 1, reponses: { q1: 1 } }), { ok: false, erreur: 'reponses' })
  assert.deepEqual(lireDemandeQuiz({ module: 'm', version: 1, reponses: { 'q1;drop': 'a' } }), { ok: false, erreur: 'reponses' })
  const trop = Object.fromEntries(Array.from({ length: LIMITES_QUIZ.questions + 1 }, (_, k) => [`q${k}`, 'a']))
  assert.deepEqual(lireDemandeQuiz({ module: 'm', version: 1, reponses: trop }), { ok: false, erreur: 'reponses' })
  assert.deepEqual(lireDemandeQuiz(null), { ok: false, erreur: 'module' })
  assert.equal(lireSlug('les-bases-smart-money'), 'les-bases-smart-money')
  assert.equal(lireSlug('x'.repeat(81)), null)
  // Le plus gros corps possible tient dans la limite de la route.
  const plein = JSON.stringify({ module: 'x'.repeat(80), version: 9999, reponses: Object.fromEntries(Array.from({ length: 15 }, (_, k) => [`q${k}-${'x'.repeat(15)}`, 'y'.repeat(20)])) })
  assert.ok(plein.length < CORPS_QUIZ_MAX, `${plein.length}`)
  assert.equal(MAX_QUIZ_HEURE, 30)
})

bloc('corriger : score, bonne reponse et explication, ou refus', () => {
  const q = lireQuiz(quiz()).quiz
  const juste = corriger(q, { q1: 'b', q2: 'a' })
  assert.equal(juste.bonnes, 2)
  assert.equal(juste.total, 2)
  const unFaux = corriger(q, { q1: 'c', q2: 'a' })
  assert.equal(unFaux.bonnes, 1)
  assert.deepEqual(unFaux.corrections[0], { question: 'q1', choisie: 'c', bonne: 'b', juste: false, explication: 'Parce que.', lecon: 'une-lecon' })
  assert.equal(corriger(q, { q1: 'b' }), null, 'une question sans reponse')
  assert.equal(corriger(q, { q1: 'b', q2: 'a', q3: 'a' }), null, 'une question inconnue')
  assert.equal(corriger(q, { q1: 'z', q2: 'a' }), null, 'un choix inconnu')
})

bloc('droitAuQuiz : la regle de « Mes cours » (pas un apercu ni le billet du jour seuls)', () => {
  assert.equal(droitAuQuiz({ acces: 'entier', raisons: ['compte'] }), 'oui')
  assert.equal(droitAuQuiz({ acces: 'partiel', raisons: ['liveclub'] }), 'oui')
  assert.equal(droitAuQuiz({ acces: 'entier', raisons: ['admin'] }), 'oui')
  assert.equal(droitAuQuiz({ acces: 'partiel', raisons: ['apercu'] }), 'non')
  assert.equal(droitAuQuiz({ acces: 'partiel', raisons: ['billet', 'apercu'] }), 'non')
  assert.equal(droitAuQuiz({ acces: 'partiel', raisons: ['apercu', 'achat'] }), 'oui')
  assert.equal(droitAuQuiz({ acces: 'ferme', raisons: [] }), 'non')
  assert.equal(droitAuQuiz({ acces: 'inconnu', raisons: ['liveclub'] }), 'inconnu')
})

bloc('route : GET ne rend que vueQuiz, un brouillon reste a l equipe et n est pas garde', () => {
  const route = lire('../src/app/api/academie/quiz/route.ts')
  assert.match(route, /quiz: vueQuiz\(quiz\)/)
  assert.equal(/NextResponse\.json\(\{[^}]*quiz: quiz[,\s}]/.test(route), false, 'jamais le quiz brut')
  assert.match(route, /quizVisible\(quiz, droits\)/)
  assert.match(route, /if \(quiz\.statut === 'publie'\) \{/)
  assert.match(route, /droitAuQuiz\(accesAuModule\(catalogue, droits, mod\.id\)\)/)
  assert.match(route, /refus\('version', 409\)/)
  assert.match(route, /refus\('limite', 429\)/)
  // Les logs ne disent jamais les reponses.
  assert.equal(/console\.[a-z]+\([^)]*reponses/.test(route), false)
})

bloc('catalogue : les quiz du fichier de chaque module se lisent, chaque question vise une lecon du module', () => {
  if (!existsSync(CATALOGUE)) { console.log(`    (dossier ${CATALOGUE} absent : bloc saute)`); return }
  let n = 0
  for (const slug of ['novice-en-trading', 'les-bases-smart-money']) {
    const d = JSON.parse(readFileSync(`${CATALOGUE}/${slug}.json`, 'utf8'))
    const r = lireQuiz(d.quiz)
    assert.equal(r.ok, true, `${slug} : ${r.erreur}`)
    assert.equal(r.quiz.statut, 'brouillon', `${slug} : brouillon tant que Brice n a pas relu`)
    const slugs = new Set(d.lecons.map(l => l.slug))
    for (const q of r.quiz.questions) {
      assert.ok(slugs.has(q.lecon), `${slug} ${q.id} : lecon ${q.lecon}`)
      assert.equal(/[–—]/.test(JSON.stringify(q)), false, `${slug} ${q.id} : tiret long`)
    }
    // Les bonnes reponses ne sont pas toutes au meme rang.
    assert.ok(new Set(r.quiz.questions.map(q => q.bonne)).size >= 2, `${slug} : bonnes reponses variees`)
    n += r.quiz.questions.length
    console.log(`    ${slug} : ${r.quiz.questions.length} questions, v${r.quiz.version} ${r.quiz.statut}`)
  }
  assert.ok(n >= 10)
})

console.log(`\n${blocs} blocs ok`)
