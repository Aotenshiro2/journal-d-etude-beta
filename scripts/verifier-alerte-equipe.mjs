// Tests de l'alerte « un membre demande un humain » par Agent AOK (src/lib/alerte-equipe-telegram-pur.ts, Brice 16/10).
// node scripts/verifier-alerte-equipe.mjs
import assert from 'node:assert/strict'
import { dernierMessageMembre, texteDemandeHumain } from '../src/lib/alerte-equipe-telegram-pur.ts'

const t = texteDemandeHumain({ origine: 'bot Live Club', qui: 'Jean Dufour @wrdxr2d2, jean@exemple.fr', dernierMessage: 'ou est la formation', reponseDans: 'Telegram' })
assert.ok(t.startsWith('Un membre demande un humain (bot Live Club).'))
assert.ok(t.includes('Qui : Jean Dufour @wrdxr2d2, jean@exemple.fr'))
assert.ok(t.includes('Son dernier message : « ou est la formation »'))
assert.ok(t.includes('https://cockpit.aoknowledge.com/?vue=support'))
assert.ok(t.includes('arrive dans Telegram'))
// Sans message ni nom : pas de ligne vide, « inconnu ».
const vide = texteDemandeHumain({ origine: 'support du site, app site', qui: null, dernierMessage: null, reponseDans: 'son chat' })
assert.ok(!vide.includes('Son dernier message'))
assert.ok(vide.includes('Qui : inconnu'))
// Message long : tronque a 300 caracteres.
const long = texteDemandeHumain({ origine: 'x', qui: 'y', dernierMessage: 'a'.repeat(500), reponseDans: 'son chat' })
assert.ok(long.includes(`« ${'a'.repeat(300)}... »`))
// Sobre : ni tiret long ni emoji.
for (const s of [t, vide, long]) {
  assert.ok(!/[—–]/.test(s), 'tiret long')
  assert.ok(!/\p{Extended_Pictographic}/u.test(s), 'emoji')
}
// Le dernier message du MEMBRE, pas celui de l'IA ni du bot.
assert.equal(dernierMessageMembre([
  { role: 'user', content: 'bonjour' }, { role: 'assistant', content: 'salut' },
  { role: 'user', content: 'je veux un humain' }, { role: 'system', content: '[systeme] x' },
]), 'je veux un humain')
assert.equal(dernierMessageMembre([{ role: 'assistant', content: 'x' }]), null)
assert.equal(dernierMessageMembre(null), null)

console.log('alerte a l equipe : tout est bon.')
