// Tests (03/11, Brice) : quand Brice, Melanie ou Adil repond a un membre (onglet
// Support du cockpit, Agent AOK « reponds-lui », carte d'une reponse preparee
// par Tab), les AUTRES comptes de l'equipe le savent par Agent AOK : « X a pris
// la discussion avec Y », la reponse en citation courte. Celui qui a repondu
// ne recoit rien.
// Aucune base, aucun reseau, aucun appel au modele.
// node scripts/verifier-reponse-partagee.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  texteReponsePartagee, destinataireInfoEquipe, userIdActeur, entreesHistoriqueInfoEquipe, MARQUEUR_INFO_EQUIPE,
} from '../src/lib/alerte-equipe-telegram-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

const FIL = 'e735b1a4-2600-4106-adfe-3ca8d474ab33'
const BRICE = '0636a40b-13a4-4fe8-af11-d060e2810767'
const MEL = '9d7424e5-8de6-42b5-9c95-2b8d7702a880'

bloc('le texte : qui a pris la discussion, avec qui, la reponse en citation courte, le fil', () => {
  const t = texteReponsePartagee({ auteur: 'Brice', qui: 'Loup Claron', fil: FIL, texte: 'Salut Loup, les lives ne sont pas a heure fixe : regarde le sujet Annonce.', canal: 'telegram' })
  assert.ok(t.startsWith('Brice a pris la discussion avec Loup Claron (bot du Live Club).'))
  assert.ok(t.includes('Sa réponse : « Salut Loup, les lives ne sont pas a heure fixe : regarde le sujet Annonce. »'))
  assert.ok(t.includes('(fil e735b1a4)'))
  assert.ok(t.includes('https://cockpit.aoknowledge.com/?vue=support'))
  const long = texteReponsePartagee({ auteur: 'Mélanie', qui: null, fil: null, texte: 'a'.repeat(500), canal: 'site' })
  assert.ok(long.startsWith('Mélanie a pris la discussion avec un membre (chat du site).'))
  assert.ok(long.includes(`« ${'a'.repeat(200)}... »`) && !long.includes('a'.repeat(201)))
  const anonyme = texteReponsePartagee({ auteur: null, qui: 'Léa', fil: FIL, texte: '', piece: true, canal: 'telegram' })
  assert.ok(anonyme.startsWith("Quelqu'un de l'équipe a pris la discussion avec Léa"))
  assert.ok(anonyme.includes('Avec une pièce jointe.') && !anonyme.includes('Sa réponse'))
  for (const x of [t, long, anonyme]) assert.ok(!/[—–…“”‘’•]/.test(x), 'caracteres clavier seulement')
})

bloc("pas de doublon pour celui qui a repondu ; tout le monde si l'auteur est inconnu (Adil n'a pas de compte Agent AOK)", () => {
  assert.equal(destinataireInfoEquipe(BRICE, BRICE), false)
  assert.equal(destinataireInfoEquipe(BRICE.toUpperCase(), BRICE), false)
  assert.equal(destinataireInfoEquipe(MEL, BRICE), true)
  assert.equal(destinataireInfoEquipe(MEL, null), true)
  assert.equal(userIdActeur(`agent:${BRICE}`), BRICE)
  assert.equal(userIdActeur(MEL.toUpperCase()), MEL)
  assert.equal(userIdActeur('agent'), null)
  assert.equal(userIdActeur(null), null)
  const h = entreesHistoriqueInfoEquipe('texte', 'info-1')
  assert.deepEqual(h.map(e => e.role), ['user', 'assistant'])
  assert.equal(h[0].content, MARQUEUR_INFO_EQUIPE)
})

bloc("le code : les trois portes passent par repondreAuFil, qui partage apres l'envoi, avec l'auteur", () => {
  const rep = lire('src/lib/support-reponse.ts')
  const tete = rep.slice(rep.indexOf('export async function repondreAuFil('), rep.indexOf('async function nomDuCompte('))
  assert.match(tete, /auteur: string \| null = null/)
  assert.ok(tete.indexOf('await repondreAuFilSansPartage(') < tete.indexOf('await partagerReponseAvecLEquipe('))
  assert.match(tete, /if \(issue\.ok \|\| issue\.raison === 'livre_non_enregistre'\)/)
  assert.match(rep, /\{ sauf: userId, journal: /)
  // L'onglet Support : l'utilisateur du cockpit ; Agent AOK (fenetre et Telegram, cartes de Tab comprises) : l'acteur agent:<uuid>.
  assert.match(lire('src/app/api/support/reply/route.ts'), /repondreAuFil\(threadId, message, '\[support\/reply\]', piece, userId\)/)
  assert.match(lire('src/lib/stripe-actions.ts'), /return executerReponseMembre\(a, acteur\)/)
  assert.match(lire('src/lib/reponse-membre.ts'), /repondreAuFil\(p\.fil_id, p\.texte, '\[cockpit\/reponse-membre\]', fichier, acteur\)/)
  // Aucun autre appelant qui oublierait l'auteur.
  const alerte = lire('src/lib/alerte-equipe-telegram.ts')
  assert.match(alerte, /export async function alerterEquipeTexte\(/)
  assert.match(alerte, /if \(!destinataireInfoEquipe\(dest\.user_id, o\.sauf\)\) continue/)
})

console.log(`\nreponse partagee avec l'equipe : ${n} blocs verifies, tout est bon.`)
