// Tests du message d'accueil du groupe Live Club (src/lib/liveclub/accueil-groupe.ts, Brice 13/10).
// node scripts/verifier-accueil-groupe.mjs
import assert from 'node:assert/strict'
import { JOURS_ABSENCE_RETOUR, accueilAPublier, nomPourAccueil, texteAccueil } from '../src/lib/liveclub/accueil-groupe.ts'

const maintenant = new Date('2026-10-13T12:00:00Z')
const ilYa = (jours) => new Date(maintenant.getTime() - jours * 86_400_000)

// Jamais vu : nouveau.
assert.equal(accueilAPublier(null, 'left', true, maintenant), 'nouveau')
assert.equal(accueilAPublier(null, undefined, true, maintenant), 'nouveau')
// Retour rapide (impaye, sorti il y a 5 jours) : rien.
assert.equal(accueilAPublier({ present: false, sortiLe: ilYa(5) }, 'left', true, maintenant), null)
assert.equal(accueilAPublier({ present: false, sortiLe: ilYa(JOURS_ABSENCE_RETOUR - 1) }, 'left', true, maintenant), null)
// Parti depuis un mois ou plus : retour.
assert.equal(accueilAPublier({ present: false, sortiLe: ilYa(JOURS_ABSENCE_RETOUR) }, 'left', true, maintenant), 'retour')
assert.equal(accueilAPublier({ present: false, sortiLe: ilYa(90) }, 'kicked', true, maintenant), 'retour')
// Deja present (rejeu de l'update, ou changement de droits) : rien.
assert.equal(accueilAPublier({ present: true, sortiLe: null }, 'left', true, maintenant), null)
assert.equal(accueilAPublier(null, 'member', true, maintenant), null)
assert.equal(accueilAPublier({ present: false, sortiLe: ilYa(90) }, 'restricted', true, maintenant), null)
// Une sortie : rien.
assert.equal(accueilAPublier(null, 'member', false, maintenant), null)
// Connu sans date de sortie (historique Metricgram) : rien.
assert.equal(accueilAPublier({ present: false, sortiLe: null }, 'left', true, maintenant), null)

// Nom : @pseudo, sinon prenom, sinon rien.
assert.equal(nomPourAccueil('Julien_Rb', 'Julien'), '@Julien_Rb')
assert.equal(nomPourAccueil('@Nyfab34', null), '@Nyfab34')
assert.equal(nomPourAccueil(null, 'Nelly'), 'Nelly')
assert.equal(nomPourAccueil('', '  '), null)

// Textes : sobres, sans tiret long ni emoji.
const nouveau = texteAccueil('nouveau', '@Nyfab34')
const retour = texteAccueil('retour', 'Nelly')
assert.ok(nouveau.startsWith('Bienvenue dans le Live Club, @Nyfab34.'))
assert.ok(retour.startsWith('Bon retour dans le Live Club, Nelly.'))
assert.equal(texteAccueil('nouveau', null).startsWith('Bienvenue dans le Live Club.'), true)
for (const t of [nouveau, retour]) {
  assert.ok(!/[—–]/.test(t), 'tiret long')
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), 'emoji')
}

console.log('accueil du groupe : tout est bon.')
