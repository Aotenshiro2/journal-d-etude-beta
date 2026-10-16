// Tests de l'alerte « un membre demande un humain » par Agent AOK (src/lib/alerte-equipe-telegram-pur.ts, Brice 16/10).
// node scripts/verifier-alerte-equipe.mjs
import assert from 'node:assert/strict'
import {
  dernierMessageMembre, texteDemandeHumain, referenceFil, entreesHistoriqueDemandeHumain, MARQUEUR_DEMANDE_HUMAIN,
} from '../src/lib/alerte-equipe-telegram-pur.ts'
import { lireFil } from '../src/lib/reponse-membre-pur.ts'

const FIL = '3f2a9c1b-7d4e-4a1b-9c2d-0e5f6a7b8c9d'

// Sans fil connu : le texte d'avant (renvoi a l'onglet Support).
const t = texteDemandeHumain({ origine: 'bot Live Club', qui: 'Jean Dufour @wrdxr2d2, jean@exemple.fr', dernierMessage: 'ou est la formation', reponseDans: 'Telegram' })
assert.ok(t.startsWith('Un membre demande un humain (bot Live Club).'))
assert.ok(t.includes('Qui : Jean Dufour @wrdxr2d2, jean@exemple.fr'))
assert.ok(t.includes('Son dernier message : « ou est la formation »'))
assert.ok(t.includes('https://cockpit.aoknowledge.com/?vue=support'))
assert.ok(t.includes('arrive dans Telegram'))
assert.ok(!t.includes("Pour lui répondre d'ici"))
// Sans message ni nom : pas de ligne vide, « inconnu ».
const vide = texteDemandeHumain({ origine: 'support du site, app site', qui: null, dernierMessage: null, reponseDans: 'son chat' })
assert.ok(!vide.includes('Son dernier message'))
assert.ok(vide.includes('Qui : inconnu'))
// Message long : tronque a 300 caracteres.
const long = texteDemandeHumain({ origine: 'x', qui: 'y', dernierMessage: 'a'.repeat(500), reponseDans: 'son chat' })
assert.ok(long.includes(`« ${'a'.repeat(300)}... »`))

// (16/10) La reference du fil : « fil » + les 8 premiers caracteres de l'uuid.
assert.equal(referenceFil(FIL), 'fil 3f2a9c1b')
assert.equal(referenceFil(FIL.toUpperCase()), 'fil 3f2a9c1b')
assert.equal(referenceFil('telegram:123'), null)
assert.equal(referenceFil(null), null)

// Avec le fil : l'alerte FINIT par la ligne d'aide, reference comprise.
const avecFil = texteDemandeHumain({
  origine: 'bot Live Club', qui: 'Jean Dufour @wrdxr2d2', dernierMessage: 'je veux un humain', reponseDans: 'Telegram', fil: FIL,
})
const lignes = avecFil.split('\n')
assert.equal(lignes.at(-1), "Pour lui répondre d'ici : dis-moi « réponds-lui : ton message » (fil 3f2a9c1b).")
assert.ok(avecFil.includes('https://cockpit.aoknowledge.com/?vue=support'), "l'onglet Support reste cite")
assert.ok(avecFil.includes('arrive dans Telegram'))
assert.ok(!avecFil.includes('Réponds-lui depuis'), "pas deux invitations a repondre")
const site = texteDemandeHumain({ origine: 'support du site, app site', qui: 'a@b.fr', dernierMessage: null, reponseDans: 'son chat', fil: FIL })
assert.ok(site.includes('arrive dans son chat'))
assert.ok(site.endsWith('(fil 3f2a9c1b).'))
// Un fil illisible : pas de reference inventee, le texte d'avant.
assert.ok(!texteDemandeHumain({ origine: 'x', qui: 'y', dernierMessage: null, reponseDans: 'son chat', fil: 'pas-un-uuid' }).includes('fil '))

// La reference de l'alerte, relue par l'outil de l'agent (proposer_reponse_membre) : le meme fil.
const ref = /\((fil [0-9a-f]{8})\)\.$/.exec(avecFil)?.[1]
assert.equal(ref, 'fil 3f2a9c1b')
assert.deepEqual(lireFil(ref), { genre: 'prefixe', prefixe: '3f2a9c1b' })
assert.ok(FIL.startsWith(lireFil(ref).prefixe))

// Sobre : ni tiret long ni emoji.
for (const s of [t, vide, long, avecFil, site]) {
  assert.ok(!/[—–]/.test(s), 'tiret long')
  assert.ok(!/\p{Extended_Pictographic}/u.test(s), 'emoji')
}

// L'historique d'Agent AOK : un marqueur systeme (pas une question de l'equipe), puis l'alerte.
assert.deepEqual(entreesHistoriqueDemandeHumain('x', 'humain-abc'), [
  { role: 'user', content: MARQUEUR_DEMANDE_HUMAIN, id: 'humain-abc' },
  { role: 'assistant', content: 'x', id: 'humain-abc-texte' },
])
assert.ok(MARQUEUR_DEMANDE_HUMAIN.startsWith('[système] '))
assert.ok(MARQUEUR_DEMANDE_HUMAIN.includes("ce n'est pas une question de l'équipe"))

// Le dernier message du MEMBRE, pas celui de l'IA ni du bot.
assert.equal(dernierMessageMembre([
  { role: 'user', content: 'bonjour' }, { role: 'assistant', content: 'salut' },
  { role: 'user', content: 'je veux un humain' }, { role: 'system', content: '[systeme] x' },
]), 'je veux un humain')
assert.equal(dernierMessageMembre([{ role: 'assistant', content: 'x' }]), null)
assert.equal(dernierMessageMembre(null), null)

// (16/10, cas de Lea) Le dernier VRAI message ecrit : ni ligne de bouton, ni trace sans texte, ni commande.
const BOUTON_EQUIPE = "[bouton] Contacter l'équipe"
assert.equal(dernierMessageMembre([
  { role: 'user', content: '/start [jeton]' }, { role: 'user', content: 'je ne trouve pas le replay' },
  { role: 'assistant', content: 'menu' }, { role: 'user', content: BOUTON_EQUIPE }, { role: 'user', content: '[message sans texte]' },
]), 'je ne trouve pas le replay')
// Aucun vrai message : le geste le plus recent, entre parentheses.
assert.equal(dernierMessageMembre([{ role: 'user', content: '/menu' }, { role: 'user', content: BOUTON_EQUIPE }]), "(a appuyé sur Contacter l'équipe)")
assert.equal(dernierMessageMembre([{ role: 'user', content: BOUTON_EQUIPE }, { role: 'user', content: '[image]', piece: { file_id: 'x' } }]), '(a envoyé une image)')
assert.equal(dernierMessageMembre([{ role: 'user', content: '[message sans texte]' }]), '(a envoyé un message sans texte)')
// Seulement depuis la derniere reponse de l'equipe : un vieux message deja traite ne revient pas.
assert.equal(dernierMessageMembre([
  { role: 'user', content: 'vieille question' }, { role: 'human', content: 'reponse' }, { role: 'user', content: BOUTON_EQUIPE },
]), "(a appuyé sur Contacter l'équipe)")
// Dans l'alerte : un geste sans guillemets.
const geste = texteDemandeHumain({ origine: 'bot Live Club', qui: 'Léa', dernierMessage: "(a appuyé sur Contacter l'équipe)", reponseDans: 'Telegram', fil: FIL })
assert.ok(geste.includes("Son dernier message : (a appuyé sur Contacter l'équipe)"))
assert.ok(!geste.includes('[bouton]'))

console.log('alerte a l equipe : tout est bon.')
