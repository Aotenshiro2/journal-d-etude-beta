// EVAL CIBLEE du 12/11 (echange de Melanie du 12/11 : un depot RaiseFx en
// dollars). Brice : « Il refuse de prendre les info en dollars ». En attendant
// sa decision sur une colonne devise (migration, 70/30), la consigne est un
// palliatif : UNE question pour les euros de TOUS les montants en dollars, pas
// d'explication sur les taux, et les dollars gardes dans note.
// UN cas par lancement (les evals consomment le credit), en mode essai (la
// vraie boucle boucleAgent, aucune ecriture, le SQL en lecture seule) :
// - D1 : Melanie donne un depot RaiseFx en dollars seulement, avec la
//   commission en dollars. Attendu : pas de carte, UNE question courte qui
//   demande les euros du depot ET de la commission, sans parler de taux.
// - D2 : la suite de l'echange reel, Melanie donne les euros (« 721$ =
//   650.93€, 650$ = 586.48€, ajoute au live club pour 5 mois »). Attendu : la
//   carte depot_broker tout de suite (650,93, commission 586,48, 5 mois) et les
//   dollars dans note.
// - D3 : « Fais la conversion ». Attendu : une ligne, sans explication sur les
//   taux, qui redemande les euros du releve.
// Cle : ANTHROPIC_API_KEY_COCKPIT, sinon le coffre (COFFRE_CLES, fichier
// anthropic-cockpit-chatbot.local.json, champ api_key). Jamais affichee.
// Lancement (Node 22, depuis apps/journal-d-etude) :
//   node --env-file=.env.local scripts/eval-depot-dollars.mjs D1|D2|D3

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
if (!['D1', 'D2', 'D3'].includes(cas)) {
  console.error('Un cas par lancement : D1 (dollars seulement), D2 (les euros arrivent) ou D3 (« Fais la conversion »).')
  process.exit(1)
}

const verifier = (nom, conditions) => {
  const ko = conditions.filter(([, ok]) => !ok).map(([n]) => n)
  console.log(ko.length ? `KO  ${nom} : ${ko.join(' ; ')}` : `ok  ${nom}`)
  return ko.length === 0
}

const MEL = { userId: '9d7424e5-8de6-42b5-9c95-2b8d7702a880', auteur: 'melanie' }
const EMAIL_TEST = 'eval.dollars.test@exemple.fr'

// L'echange reel du 12/11 (capture remplacee par ce que l'agent y avait lu).
const M1 = `Dépôt RaiseFx de 721 USD aujourd'hui, ${EMAIL_TEST}, on prend 650$ de commission, accès 5 mois. Ajoute le`
const R1 = "Combien en euros sur ton relevé : le dépôt de 721 $ et la commission de 650 $ ?"
const M2 = 'Fais la conversion'
const R2 = 'Je ne convertis pas encore moi-même : donne-moi les euros de ton relevé et je lance la carte.'
const M3 = '721$ = 650.93€ \n650$ = 586.48€ \n\nAjoute au live club pour 5mois'

const historiques = {
  D1: [{ role: 'user', content: M1 }],
  D2: [
    { role: 'user', content: M1 }, { role: 'assistant', content: R1 },
    { role: 'user', content: M2 }, { role: 'assistant', content: R2 },
    { role: 'user', content: M3 },
  ],
  D3: [{ role: 'user', content: M1 }, { role: 'assistant', content: R1 }, { role: 'user', content: M2 }],
}

const k = cle('ANTHROPIC_API_KEY_COCKPIT', 'anthropic-cockpit-chatbot.local.json')
if (!k) {
  console.log('KO  cle absente (ni ANTHROPIC_API_KEY_COCKPIT, ni le fichier du coffre).')
  process.exit(1)
}
process.env.ANTHROPIC_API_KEY_COCKPIT = k

let ok = false
const { prisma } = await import('../src/lib/db.ts')
try {
  const { boucleAgent } = await import('../src/lib/agent-cockpit.ts')
  const msgs = historiques[cas]
  const r = await boucleAgent(msgs, MEL.userId, {
    source: 'agent_telegram', auteur: MEL.auteur, limite: Date.now() + 270_000, essai: true,
  })
  console.log(`\n===== ${cas} (Melanie) : « ${msgs[msgs.length - 1].content.replace(/\n+/g, ' / ')} »`)
  console.log(`[requetes SQL : ${r.etapes.length}]${r.inacheve ? ' [INACHEVE]' : ''}`)
  console.log(r.reply)
  if (r.action) console.log(`\n[CARTE ${r.action.type}] ${r.action.resume}`)
  const p = r.action?.params ?? {}
  if (r.action) console.log(`[params] montant=${p.montant} commission=${p.commission} mois=${p.mois} note=${JSON.stringify(p.note ?? null)}`)
  const texte = r.reply ?? ''
  const lignes = texte.split('\n').filter(l => l.trim()).length
  const sansTaux = !/taux|fiable|fig[ée]e?|cours du/i.test(texte)
  if (cas === 'D1') {
    ok = verifier('D1', [
      ['pas de carte (les euros manquent)', !r.action],
      // Une demande a l'imperatif (« donne-moi les euros ») vaut une question.
      ['une seule demande (au plus un point d interrogation)', (texte.match(/\?/g) ?? []).length <= 1],
      ['demande les euros du depot ET de la commission', /euro|€/i.test(texte) && /721/.test(texte) && /650|commission/i.test(texte)],
      ['aucune explication sur les taux', sansTaux],
      ['courte (3 lignes, 300 caracteres au plus)', lignes <= 3 && texte.length <= 300],
    ])
  } else if (cas === 'D2') {
    ok = verifier('D2', [
      ['carte depot_broker tout de suite', r.action?.type === 'depot_broker'],
      ['montant 650,93', Number(p.montant) === 650.93],
      ['commission 586,48', Number(p.commission) === 586.48],
      ['5 mois, adresse de test', Number(p.mois) === 5 && p.email === EMAIL_TEST],
      ['les dollars gardes dans note', /721/.test(String(p.note ?? '')) && /650/.test(String(p.note ?? '')) && /USD|\$/i.test(String(p.note ?? ''))],
      ['aucune question', !/\?/.test(texte)],
    ])
  } else {
    ok = verifier('D3', [
      ['pas de carte', !r.action],
      ['une ou deux lignes', lignes <= 2 && texte.length <= 220],
      ['aucune explication sur les taux', sansTaux],
      ['redemande les euros', /euro|€/i.test(texte)],
    ])
  }
} catch (err) {
  console.log(`KO  ${cas} : ${err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : err}`)
} finally {
  await prisma.$disconnect()
}
process.exit(ok ? 0 : 1)
