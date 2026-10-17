// Tests des arrivees et departs des chats traces (src/lib/liveclub/mouvements-pur.ts, Brice 17/10).
// node scripts/verifier-mouvements.mjs
import assert from 'node:assert/strict'
import {
  chatDeLUpdate, chatsTraces, estDedans, masquerLien, modeDuChangement, mouvementDepuisUpdate, nomDe, sensDuChangement,
} from '../src/lib/liveclub/mouvements-pur.ts'

const CANAL = -1001651103428
const NAS = -1003191036223
const LIVECLUB = '-1001930901866'

// Liste des chats traces : entiers seulement, jamais le Live Club.
assert.deepEqual([...chatsTraces(`${CANAL},${NAS}`, LIVECLUB)], [String(CANAL), String(NAS)])
assert.deepEqual([...chatsTraces(` ${CANAL} ; ${NAS} ,, abc`, LIVECLUB)], [String(CANAL), String(NAS)])
assert.deepEqual([...chatsTraces(`${CANAL},${LIVECLUB}`, LIVECLUB)], [String(CANAL)])
assert.equal(chatsTraces(undefined, LIVECLUB).size, 0)
assert.equal(chatsTraces('', null).size, 0)

// Chat de l'update.
assert.equal(chatDeLUpdate({ chat_member: { chat: { id: CANAL } } }), String(CANAL))
assert.equal(chatDeLUpdate({ my_chat_member: { chat: { id: NAS } } }), String(NAS))
assert.equal(chatDeLUpdate({ chat_join_request: { chat: { id: NAS } } }), String(NAS))
assert.equal(chatDeLUpdate({ message: { chat: { id: NAS } } }), null)
assert.equal(chatDeLUpdate({}), null)

// Dedans / dehors, sens.
assert.equal(estDedans({ status: 'member' }), true)
assert.equal(estDedans({ status: 'restricted', is_member: true }), true)
assert.equal(estDedans({ status: 'restricted', is_member: false }), false)
assert.equal(estDedans({ status: 'left' }), false)
assert.equal(estDedans({ status: 'bizarre' }), null)
assert.equal(sensDuChangement({ status: 'left' }, { status: 'member' }), 'arrivee')
assert.equal(sensDuChangement({ status: 'kicked' }, { status: 'member' }), 'arrivee')
assert.equal(sensDuChangement({ status: 'member' }, { status: 'left' }), 'depart')
assert.equal(sensDuChangement({ status: 'member' }, { status: 'kicked' }), 'depart')
assert.equal(sensDuChangement({ status: 'member' }, { status: 'administrator' }), 'autre')
assert.equal(sensDuChangement({ status: 'restricted', is_member: false }, { status: 'member' }), 'arrivee')
assert.equal(sensDuChangement(undefined, { status: 'member' }), 'arrivee')

// Url masquee : jamais un lien utilisable.
assert.equal(masquerLien('https://t.me/+AbCdEfGh…'), 'https://t.me/+AbCdEfGh…')
assert.equal(masquerLien('https://t.me/+AbCdEfGhIjKlMnOp'), 'https://t.me/+AbCdEf…')
assert.equal(masquerLien('https://t.me/joinchat/AAAAAEvLx3hkS2'), 'https://t.me/joinchat/AAAAAE…')
assert.equal(masquerLien('https://exemple.org/secret/chemin'), 'https://exemple.org/…')
assert.equal(masquerLien(''), null)
assert.equal(masquerLien(null), null)

// Noms.
assert.equal(nomDe({ id: 1, username: 'melmom' }), '@melmom')
assert.equal(nomDe({ id: 1, first_name: 'Mel', last_name: 'Mom' }), 'Mel Mom')
assert.equal(nomDe(undefined), null)

// Un vrai chat_member d'arrivee par un lien nomme, dans le canal.
const membre = { id: 123456789, is_bot: false, first_name: 'Julie', username: 'julie_tr' }
const melanie = { id: 555000111, is_bot: false, first_name: 'Melanie', username: 'melmom' }
const arrivee = {
  chat: { id: CANAL, title: 'MELMOM | ICT Trading', type: 'channel' },
  from: membre,
  date: 1760700000,
  old_chat_member: { status: 'left', user: membre },
  new_chat_member: { status: 'member', user: membre },
  invite_link: { invite_link: 'https://t.me/+XyZ12…', name: 'Bio Instagram', creator: melanie, is_primary: false, creates_join_request: false, is_revoked: false },
}
const l = mouvementDepuisUpdate(42, arrivee)
assert.equal(l.updateId, 42)
assert.equal(l.chatId, CANAL)
assert.equal(l.groupe, 'MELMOM | ICT Trading')
assert.equal(l.typeChat, 'channel')
assert.equal(l.telegramId, 123456789)
assert.equal(l.pseudo, 'julie_tr')
assert.equal(l.nomAffiche, 'Julie')
assert.equal(l.ancienStatut, 'left')
assert.equal(l.nouveauStatut, 'member')
assert.equal(l.sens, 'arrivee')
assert.equal(l.mode, 'lien')
assert.equal(l.parId, 123456789)
assert.equal(l.parQui, '@julie_tr')
assert.equal(l.inviteLienNom, 'Bio Instagram')
assert.equal(l.inviteLienUrl, 'https://t.me/+XyZ12…')
assert.equal(l.inviteCreePar, '@melmom')
assert.equal(l.inviteCreeParId, 555000111)
assert.equal(l.invitePrincipal, false)
assert.equal(l.inviteSurDemande, false)
assert.equal(l.invitePrixEtoiles, null)
assert.equal(l.viaDemande, false)
assert.equal(l.survenuLe.toISOString(), new Date(1760700000 * 1000).toISOString())

// Modes d'arrivee.
const base = { chat: { id: NAS, type: 'supergroup' }, old_chat_member: { status: 'left', user: membre }, new_chat_member: { status: 'member', user: membre } }
assert.equal(modeDuChangement({ ...base, from: membre, via_join_request: true, invite_link: { name: 'x' } }, 'arrivee'), 'demande')
assert.equal(modeDuChangement({ ...base, from: membre, via_chat_folder_invite_link: true }, 'arrivee'), 'dossier')
assert.equal(modeDuChangement({ ...base, from: melanie }, 'arrivee'), 'ajout')
assert.equal(modeDuChangement({ ...base, from: membre }, 'arrivee'), 'direct')
// Demande approuvee par un admin : from = l'admin, via_join_request = vrai.
const demande = mouvementDepuisUpdate(43, { ...base, from: melanie, via_join_request: true, invite_link: { name: 'Lien VIP', creator: melanie, creates_join_request: true, subscription_price: 250 } })
assert.equal(demande.mode, 'demande')
assert.equal(demande.viaDemande, true)
assert.equal(demande.inviteSurDemande, true)
assert.equal(demande.invitePrixEtoiles, 250)
assert.equal(demande.inviteLienUrl, null)
assert.equal(demande.parQui, '@melmom')

// Departs.
const depart = { chat: { id: NAS, type: 'supergroup' }, old_chat_member: { status: 'member', user: membre }, new_chat_member: { status: 'left', user: membre } }
assert.equal(mouvementDepuisUpdate(44, { ...depart, from: membre }).mode, 'volontaire')
assert.equal(mouvementDepuisUpdate(45, { ...depart, from: melanie, new_chat_member: { status: 'kicked', user: membre } }).mode, 'retire')
assert.equal(mouvementDepuisUpdate(46, { ...depart, from: membre }).sens, 'depart')
// Promotion : autre, pas de mode.
const promo = mouvementDepuisUpdate(47, { ...depart, from: melanie, new_chat_member: { status: 'administrator', user: membre } })
assert.equal(promo.sens, 'autre')
assert.equal(promo.mode, null)

// Rien a ecrire : bot, identifiants illisibles.
assert.equal(mouvementDepuisUpdate(48, { ...base, new_chat_member: { status: 'member', user: { id: 9, is_bot: true } } }), null)
assert.equal(mouvementDepuisUpdate(Number.NaN, arrivee), null)
assert.equal(mouvementDepuisUpdate(49, { ...arrivee, chat: {} }), null)
assert.equal(mouvementDepuisUpdate(50, null), null)
// Date absente : l'heure de reception.
const recu = new Date('2026-10-17T20:00:00Z')
assert.equal(mouvementDepuisUpdate(51, { ...arrivee, date: undefined }, recu).survenuLe, recu)

console.log('verifier-mouvements : tout passe.')
