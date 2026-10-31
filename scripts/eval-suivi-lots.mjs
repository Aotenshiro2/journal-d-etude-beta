// EVAL CIBLEE du 31/10 (suivi des lots d'un acces broker, ton d'Agent AOK) :
// DEUX cas, UN par lancement (Brice : les tests ne doivent pas vider son
// credit), en mode essai, sans relance automatique, sans generer_post.
// - L1, Agent AOK : la VRAIE boucle (boucleAgent, essai : aucune ecriture ;
//   le SQL de l'agent en lecture seule ; les controles avant carte lisent la
//   base). Melanie donne un depot RaiseFx complet, « 650 EUR (655 USD),
//   commission 587 », pour une adresse de TEST. Attendu : la carte
//   depot_broker tout de suite (650, commission 587), une reponse courte, ni
//   question, ni debat sur une regle generale ou la note « a confirmer » de
//   RaiseFx, et la carte courte de Melanie.
// - L2, bot des membres : UNE requete Haiku, la requete exacte de la prod
//   (requeteAgentMembre avec l'etat des lots du membre). Un membre ecrit
//   « c'est bon j'ai trade mes lots ». Attendu : l'outil lots_trades, sans
//   texte (ou une ligne) ; la reponse au membre est alors celle du serveur
//   (texteDeclarationLots), montree ici, rien n'est ecrit.
// Cles : ANTHROPIC_API_KEY_COCKPIT (L1) et ANTHROPIC_API_KEY_LIVECLUB (L2),
// sinon le coffre (COFFRE_CLES, fichiers anthropic-cockpit-chatbot.local.json
// et anthropic-liveclub-bot.local.json, champ api_key). Jamais affichees.
// Lancement (Node 22, depuis apps/journal-d-etude) :
//   node --env-file=.env.local scripts/eval-suivi-lots.mjs L1
//   node --env-file=.env.local scripts/eval-suivi-lots.mjs L2

import './resoudre-ts.mjs'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const COFFRE = process.env.COFFRE_CLES || '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local'
function cle(envVar, fichier) {
  const env = process.env[envVar]?.trim()
  if (env) return env
  const p = path.join(COFFRE, fichier)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')).api_key?.trim() || null
  } catch {
    return null
  }
}

const cas = (process.argv[2] ?? '').toUpperCase()
if (cas !== 'L1' && cas !== 'L2') {
  console.error('Un cas par lancement : L1 (Agent AOK, depot RaiseFx de Melanie) ou L2 (membre, lots trades).')
  process.exit(1)
}

const verifier = (nom, conditions) => {
  const ko = conditions.filter(([, ok]) => !ok).map(([n]) => n)
  console.log(ko.length ? `KO  ${nom} : ${ko.join(' ; ')}` : `ok  ${nom}`)
  return ko.length === 0
}

const MEL = { userId: '9d7424e5-8de6-42b5-9c95-2b8d7702a880', auteur: 'melanie' }
const EMAIL_TEST = 'eval.lots.test@exemple.fr'

async function l1() {
  const k = cle('ANTHROPIC_API_KEY_COCKPIT', 'anthropic-cockpit-chatbot.local.json')
  if (!k) throw new Error('Cle absente (ni ANTHROPIC_API_KEY_COCKPIT, ni le fichier du coffre).')
  process.env.ANTHROPIC_API_KEY_COCKPIT = k
  const { boucleAgent } = await import('../src/lib/agent-cockpit.ts')
  const { prisma } = await import('../src/lib/db.ts')
  const { jourParis } = await import('../src/lib/repartition/pur.ts')
  const texte = `Ajoute ${EMAIL_TEST} au Live Club pour 6 mois : dépôt RaiseFx de 650 EUR (655 USD) aujourd'hui, commission 587`
  try {
    const r = await boucleAgent([{ role: 'user', content: texte }], MEL.userId, {
      source: 'agent_telegram', auteur: MEL.auteur, limite: Date.now() + 270_000, essai: true,
    })
    console.log(`\n===== L1 (Melanie) : « ${texte} »`)
    console.log(`[requetes SQL : ${r.etapes.length}, soit ${r.etapes.length + 1} appel(s) au modele environ]${r.inacheve ? ' [INACHEVE]' : ''}`)
    console.log(r.reply)
    if (r.action) console.log(`\n[CARTE ${r.action.type}] ${r.action.resume}${r.action.cle_presente === false ? ` [non executable ici : ${r.action.cle_manquante}]` : ''}`)
    const p = r.action?.params ?? {}
    const lignes = r.reply.split('\n').filter(l => l.trim()).length
    return verifier('L1', [
      ['carte depot_broker tout de suite', r.action?.type === 'depot_broker'],
      ['montant en euros : 650', Number(p.montant) === 650],
      ['commission de CE depot : 587', Number(p.commission) === 587],
      ['6 mois, adresse et jour du depot', (p.mois === undefined || Number(p.mois) === 6) && p.email === EMAIL_TEST && p.le === jourParis(new Date())],
      ['aucune question', !/\?/.test(r.reply)],
      ['reponse courte (4 lignes, 400 caracteres au plus)', lignes <= 4 && r.reply.length <= 400],
      ['ni debat sur une regle generale, ni note « a confirmer », ni Pulse', !/à confirmer|tous ses (clients|dépôts)|règle générale|seulement pour ce dépôt|Pulse/i.test(r.reply)],
      ['carte courte de Melanie', /^Dépôt RaiseFx de 650 € le \d{2}\/\d{2} pour /.test(r.action?.resume ?? '')],
    ])
  } finally {
    await prisma.$disconnect()
  }
}

async function l2() {
  const k = cle('ANTHROPIC_API_KEY_LIVECLUB', 'anthropic-liveclub-bot.local.json')
  if (!k) throw new Error('Cle absente (ni ANTHROPIC_API_KEY_LIVECLUB, ni le fichier du coffre).')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const M = await import('../src/lib/liveclub/prompt-membre.ts')
  const L = await import('../src/lib/liveclub/lots-pur.ts')
  // Un membre entre le 05/11, lots attendus d'ici le 05/12 (dans le delai).
  const etat = { etat: 'a_faire', limite: '2026-12-05', declare: false }
  const question = "c'est bon j'ai trade mes lots"
  const requete = M.requeteAgentMembre([{ role: 'user', content: question }], undefined, { lots: etat })
  const reponse = await new Anthropic({ apiKey: k }).messages.create(requete)
  const textes = reponse.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
  const outils = reponse.content.filter(b => b.type === 'tool_use').map(b => b.name)
  const serveur = outils.includes(M.NOM_OUTIL_LOTS) ? L.texteDeclarationLots('declare') : null
  console.log(`\n===== L2 (membre) : « ${question} »  [1 appel, ${reponse.usage?.input_tokens ?? '?'} jetons en entree]`)
  console.log(`[outils appeles : ${outils.join(', ') || 'aucun'}]`)
  if (textes) console.log(`[texte du modele] ${textes}`)
  if (serveur) console.log(`[reponse envoyee au membre, ecrite par le serveur] ${serveur}`)
  return verifier('L2', [
    ['appelle lots_trades', outils.includes(M.NOM_OUTIL_LOTS)],
    ['aucun autre outil', outils.every(o => o === M.NOM_OUTIL_LOTS)],
    ['sans texte, ou une ligne au plus', !textes || (!textes.includes('\n') && textes.length <= 160)],
    ['la ligne au membre : l equipe verifie chez le broker', !!serveur && /l'équipe vérifie chez le broker/i.test(serveur)],
  ])
}

let ok = false
try {
  ok = cas === 'L1' ? await l1() : await l2()
} catch (err) {
  console.log(`KO  ${cas} : ${err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : err}`)
}
process.exit(ok ? 0 : 1)
