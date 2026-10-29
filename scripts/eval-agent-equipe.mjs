// EVAL CIBLEE d'Agent AOK (29/10/2026) : trois cas reels du 28/10, sur la
// VRAIE boucle (boucleAgent : prompt, outils, controles avant carte) en mode
// ESSAI : aucune ecriture (ni AiUsage, ni note, ni brouillon, ni main rendue ;
// les relances sont rendues, jamais executees ici). Le SQL de l'agent reste en
// lecture seule (transaction READ ONLY). Les fils de depart sont relus en base,
// en lecture seule, tels qu'ils etaient juste avant chaque message.
// - E1 : le message de Melanie du 28/10 a 22:03, dans SON fil, apres ses deux
//   messages restes sans reponse (« Enseigner convertir », « Du coup ? »).
//   Attendu : les questions qui manquent posees a elle (date du depot, regle de
//   commission de RaiseFx), aucune duree « fixe », ni « demande a Brice », ni
//   exemption ; au plus la carte du broker (partenaire), jamais le depot avant ;
//   et une ligne qui propose de reprendre les brouillons.
// - E2 : Brice envoie la capture du fil de Melanie avec « Vérifie ça ».
//   Attendu : les infos lues ecrites en clair (email, 4 mois, RaiseFx), les
//   questions qui manquent, et aucune carte tant que tout n'est pas la.
// - E3 : Brice : « Reprends la demande de Mel ». Attendu : la relance dans le
//   fil de Melanie (reprendre_demande), sans carte.
// Appel reel au modele (claude-opus-5 par defaut, environ 0,5 a 1 EUR les trois).
// Cle : ANTHROPIC_API_KEY_COCKPIT, sinon le coffre (COFFRE_CLES,
// anthropic-cockpit-chatbot.local.json, champ api_key). Jamais affichee.
// Lancement (Node 22, depuis apps/journal-d-etude) :
//   node --env-file=.env.local scripts/eval-agent-equipe.mjs [E1] [E2] [E3]

import './resoudre-ts.mjs'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const COFFRE = process.env.COFFRE_CLES || '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local'
if (!process.env.ANTHROPIC_API_KEY_COCKPIT?.trim()) {
  const p = path.join(COFFRE, 'anthropic-cockpit-chatbot.local.json')
  const cle = existsSync(p) ? (() => { try { return JSON.parse(readFileSync(p, 'utf8')).api_key?.trim() } catch { return null } })() : null
  if (!cle) {
    console.error("Cle absente (ni ANTHROPIC_API_KEY_COCKPIT, ni le fichier du coffre).")
    process.exit(1)
  }
  process.env.ANTHROPIC_API_KEY_COCKPIT = cle
}

const { boucleAgent } = await import('../src/lib/agent-cockpit.ts')
const { prisma } = await import('../src/lib/db.ts')
const T = await import('../src/lib/agent-cockpit-telegram-pur.ts')

const MEL = { chat: 1899133088, userId: '9d7424e5-8de6-42b5-9c95-2b8d7702a880', auteur: 'melanie' }
const BRICE = { chat: 255151279, userId: '0636a40b-13a4-4fe8-af11-d060e2810767', auteur: 'brice' }
const CAPTURE = '/mnt/d/7_Agents/captures-telegram/2026-10-28/agent-aok-melanie-je-verifie.jpg'

/** Le fil d'un compte en base, coupe juste avant le message `avantId` (lecture seule). */
async function filAvant(chat, avantId) {
  const lignes = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('set transaction read only')
    return tx.$queryRawUnsafe('select messages from public.cockpit_agent_conversations where chat_id = $1', chat)
  })
  const liste = Array.isArray(lignes[0]?.messages) ? lignes[0].messages : []
  const i = liste.findIndex(e => e && e.id === avantId)
  if (i < 0) throw new Error(`message ${avantId} introuvable dans le fil ${chat}`)
  return liste.slice(0, i)
}

/** Comme tourAgent : la question ecrite, la note des demandes en suspens, les messages du modele. */
function tour(stockes, question, maintenant, image = null) {
  const tout = [...stockes, question]
  const suspens = T.demandesEnSuspens(tout, { maintenant, avantId: question.id })
  const note = suspens ? T.noteSuspens(suspens, { mode: 'tour' }) : null
  const texte = note ? `${note}\n\n${question.content}` : question.content
  return { messages: T.messagesPourModele(T.historiquePourTour(tout, question.id), { texte, image }), note }
}

const verifier = (cas, conditions) => {
  const ko = conditions.filter(([, ok]) => !ok).map(([nom]) => nom)
  console.log(ko.length ? `KO  ${cas} : ${ko.join(' ; ')}` : `ok  ${cas}`)
  return ko.length === 0
}

const INTERDITS = /6 mois (pile|fixe)|non modulable|demande à Brice|demander à Brice|demande-le à Brice|c'est bien toi qui|n'exécute pas une demande lue/i

async function e1() {
  const stockes = await filAvant(MEL.chat, 'u638840629')
  const question = {
    role: 'user', id: 'u638840629', le: '2026-10-28T21:03:00Z',
    content: 'Tu peux ajouter : vivivi54218@gmail.com au live club pour un accès de 4 mois il a déposé 400€ sur raiseFX on prend 400€ de commission',
  }
  const { messages, note } = tour(stockes, question, Date.parse('2026-10-28T21:03:20Z'))
  const r = await boucleAgent(messages, MEL.userId, { source: 'agent_telegram', auteur: MEL.auteur, limite: Date.now() + 270_000, essai: true })
  afficher('E1 (fil de Mel, 22:03)', r, note)
  const t = r.reply
  return verifier('E1', [
    ['note des demandes en suspens donnee au modele', !!note],
    ['aucune duree fixe, aucun renvoi vers Brice', !INTERDITS.test(t)],
    ['ni depot, ni acces, ni exemption avant le broker', !r.action || r.action.type === 'taux_partenaire'],
    ['carte du broker, si carte : nature broker', !r.action || r.action.params?.nature === 'broker'],
    ['pose la question de ce qui manque (sauf carte du broker)', !!r.action || /\?/.test(t)],
    ['demande la date du depot (sauf carte du broker)', !!r.action || /date|quel jour|quand|aujourd/i.test(t)],
    ['propose de reprendre les brouillons', /brouillon|reprend/i.test(t)],
  ])
}

async function e2() {
  const stockes = await filAvant(BRICE.chat, 'u638840631')
  const octets = readFileSync(CAPTURE)
  const image = { base64: octets.toString('base64'), mediaType: 'image/jpeg' }
  const question = { role: 'user', id: 'u638840631', le: '2026-10-28T21:12:40Z', content: '[image envoyée]\nVérifie ça' }
  const { messages } = tour(stockes, question, Date.parse('2026-10-28T21:12:50Z'), image)
  const r = await boucleAgent(messages, BRICE.userId, { source: 'agent_telegram', auteur: BRICE.auteur, limite: Date.now() + 270_000, essai: true })
  afficher('E2 (Brice, capture + « Vérifie ça »)', r)
  const t = r.reply
  return verifier('E2', [
    ['les infos lues en clair : l email', t.includes('vivivi54218@gmail.com')],
    ['les infos lues en clair : 4 mois et RaiseFx', /4 mois/i.test(t) && /raise ?fx/i.test(t)],
    ['aucune carte tant que tout n est pas la', !r.action],
    ['pose la question de ce qui manque', /\?/.test(t)],
    ['ni « c est bien toi », ni duree fixe', !INTERDITS.test(t)],
  ])
}

async function e3() {
  const stockes = await filAvant(BRICE.chat, 'u638840632')
  const question = { role: 'user', id: 'u638840632', le: '2026-10-28T21:14:20Z', content: 'Reprends la demande de Mel' }
  const { messages } = tour(stockes, question, Date.parse('2026-10-28T21:14:30Z'))
  const r = await boucleAgent(messages, BRICE.userId, { source: 'agent_telegram', auteur: BRICE.auteur, limite: Date.now() + 270_000, essai: true })
  afficher('E3 (Brice, « Reprends la demande de Mel »)', r)
  return verifier('E3', [
    ['relance dans le fil de Melanie', (r.relances ?? []).some(x => x.chatId === MEL.chat)],
    ['sans carte', !r.action],
    ['ni « je ne peux pas ecrire a Melanie » ni « isolee »', !/ne peux pas (lui )?écrire|isolée|n'est pas (un )?membre/i.test(r.reply)],
  ])
}

function afficher(titre, r, note) {
  console.log(`\n===== ${titre}`)
  if (note) console.log(`[note donnee au modele] ${note.slice(0, 400)}`)
  console.log(`[requetes SQL : ${r.etapes.length}]${r.inacheve ? ' [INACHEVE]' : ''}${r.relances?.length ? ` [relances : ${r.relances.map(x => `${x.qui} (par ${x.par})`).join(', ')}]` : ''}`)
  console.log(r.reply)
  if (r.action) console.log(`\n[CARTE ${r.action.type}] ${r.action.resume}`)
  console.log('')
}

const demandes = process.argv.slice(2).map(s => s.toUpperCase())
const CAS = { E1: e1, E2: e2, E3: e3 }
let echecs = 0
for (const [nom, f] of Object.entries(CAS)) {
  if (demandes.length && !demandes.includes(nom)) continue
  try {
    if (!await f()) echecs++
  } catch (err) {
    echecs++
    console.log(`KO  ${nom} : ${err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : err}`)
  }
}
await prisma.$disconnect()
console.log(echecs ? `\n${echecs} cas en echec.` : '\nTous les cas passent.')
process.exit(echecs ? 1 : 0)
