/**
 * Verifie la garde de /api/newsletter/subscribe (src/lib/newsletter-inscription-pur.ts) :
 * qui peut inscrire quelle adresse, avec et sans session. Aucun appel reseau.
 *
 *   node scripts/verifier-newsletter-inscription.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FENETRE_INSCRIPTION_H, decisionInscription } from '../src/lib/newsletter-inscription-pur.ts'

let blocs = 0
const ok = m => { blocs++; console.log(`ok  ${m}`) }
const maintenant = new Date('2026-10-31T20:00:00Z')
const ilYa = h => new Date(maintenant.getTime() - h * 3600_000)
const compte = (x = {}) => ({ id: 'u-1', creeLe: ilYa(1), newsletter: true, dejaInscrit: false, ...x })
const sans = (c, email = 'a@exemple.invalid') => decisionInscription({ connecte: null, adressesDuConnecte: [], compte: c, email, maintenant })

assert.deepEqual(sans(compte()), { action: 'inscrire', profileId: 'u-1' })
ok('sans session : compte cree il y a 1 h, newsletter cochee -> inscrit')

assert.deepEqual(sans(null), { action: 'ignorer', raison: 'sans_compte' })
ok('sans session : adresse sans compte -> ecartee (personne ne peut inscrire l adresse d un autre)')

assert.deepEqual(sans(compte({ newsletter: false })), { action: 'ignorer', raison: 'sans_accord' })
ok('sans session : newsletter non cochee a l inscription -> ecartee')

assert.deepEqual(sans(compte({ creeLe: ilYa(FENETRE_INSCRIPTION_H + 1) })), { action: 'ignorer', raison: 'trop_tard' })
assert.deepEqual(sans(compte({ creeLe: ilYa(FENETRE_INSCRIPTION_H - 1) })).action, 'inscrire')
ok(`sans session : fenetre de ${FENETRE_INSCRIPTION_H} h respectee`)

assert.deepEqual(sans(compte({ dejaInscrit: true })), { action: 'ignorer', raison: 'deja_inscrit' })
ok('sans session : une seule fois par compte')

const avec = (adresses, email) => decisionInscription({ connecte: 'u-2', adressesDuConnecte: adresses, compte: null, email, maintenant })
assert.deepEqual(avec(['moi@exemple.invalid', 'autre@exemple.invalid'], 'autre@exemple.invalid'), { action: 'inscrire', profileId: 'u-2' })
ok('connecte : une adresse du compte -> inscrite, sans fenetre ni case')

assert.deepEqual(avec(['moi@exemple.invalid'], 'victime@exemple.invalid'), { action: 'ignorer', raison: 'autre_adresse' })
ok('connecte : l adresse d un autre -> ecartee')

const mw = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8')
assert.match(mw, /'\/api\/newsletter\/subscribe'/)
ok('middleware : la route est publique (la garde est dans la route)')

const route = readFileSync(new URL('../src/app/api/newsletter/subscribe/route.ts', import.meta.url), 'utf8')
assert.doesNotMatch(route, /corps(\?)?\.name/)
ok('route : le prenom vient du profil, jamais du corps de la demande')

console.log(`\n${blocs} blocs ok`)
