// Le rappel avant prelevement PREVIENT, il ne propose rien (Brice 16/10) : ni pause, ni arret, ni renvoi vers support@.
// Controle statique du modele (emails.ts importe ses voisins sans extension, node ne le charge pas seul).
// node scripts/verifier-rappel-prelevement.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/lib/liveclub/emails.ts', import.meta.url), 'utf8')
const debut = source.indexOf('export function modeleRappelPrelevement')
assert.ok(debut > 0, 'modele introuvable')
const fin = source.indexOf('\nexport function', debut + 10)
// Le corps seulement (apres la signature), sans les commentaires.
const corps = source.slice(debut, fin > 0 ? fin : undefined).replace(/\/\/.*$/gm, '')
assert.ok(!/pause|arr[eê]t/i.test(corps), "le rappel ne propose ni pause ni arret")
assert.ok(!/SUPPORT|support@/.test(corps), 'le rappel ne renvoie pas vers support@')
assert.ok(corps.includes('Mettre à jour ma carte'), 'le bouton de carte reste')
assert.ok(corps.includes('Une question ?'), 'une seule porte : ecrire au bot')
console.log('rappel avant prelevement : tout est bon.')
