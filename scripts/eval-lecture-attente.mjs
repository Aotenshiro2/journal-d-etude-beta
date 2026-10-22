// EVAL de la lecture d'un message ecrit pendant l'attente d'un humain (Brice,
// 22/10/2026 ; src/lib/liveclub/lecture-attente.ts). Deux cas cibles, sur la
// VRAIE requete (requeteLectureAttente, support-pont-pur.ts) et le meme modele
// que le bot des membres (MODELE_LIVECLUB, lu dans prompt-membre.ts) :
// - L01 : le cas reel de Christine, « Tout est good, c'était un accident »
//   apres « Contacter l'équipe » : annule ;
// - L02 : un « c'est bon » qui ouvre une precision : autre (rien n'est annule).
// Appel reel a l'API (environ 0,1 centime pour les deux), aucune base, aucun
// Telegram. Cle : ANTHROPIC_API_KEY_LIVECLUB, sinon le coffre local
// (COFFRE_CLES, fichier anthropic-liveclub-bot.local.json, champ api_key).
// Aucune cle n'est jamais affichee.
// Lancement (Node 22, depuis apps/journal-d-etude) : node scripts/eval-lecture-attente.mjs

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import * as S from '../src/lib/liveclub/support-pont-pur.ts'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prompt = readFileSync(path.join(RACINE, 'src/lib/liveclub/prompt-membre.ts'), 'utf8')
const MODELE = process.env.AI_MODEL_LIVECLUB?.trim()
  || /export const MODELE_LIVECLUB = process\.env\.AI_MODEL_LIVECLUB\?\.trim\(\) \|\| '([^']+)'/.exec(prompt)?.[1]
if (!MODELE) {
  console.error('Modele du bot des membres introuvable dans prompt-membre.ts.')
  process.exit(1)
}

const COFFRE = process.env.COFFRE_CLES || '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local'
function cle() {
  const env = process.env.ANTHROPIC_API_KEY_LIVECLUB?.trim()
  if (env) return env
  const p = path.join(COFFRE, 'anthropic-liveclub-bot.local.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')).api_key?.trim() || null
  } catch {
    return null
  }
}
const apiKey = cle()
if (!apiKey) {
  console.error("Cle absente (ni variable d'env, ni fichier du coffre).")
  process.exit(1)
}
const client = new Anthropic({ apiKey, timeout: 20000, maxRetries: 1 })

const T0 = Date.UTC(2026, 9, 22, 9, 17)
const at = (ms) => new Date(ms).toISOString()
const avant = [
  { role: 'user', content: '/start', at: at(T0 - 30 * 60000) },
  { role: 'user', content: "[bouton] Contacter l'équipe", at: at(T0) },
  { role: 'assistant', content: S.TEXTE_EQUIPE_SANS_ECRIT, at: at(T0 + 500), auteur: 'bot' },
]
const CAS = [
  { id: 'L01', texte: "Tout est good, c'était un accident", attendu: 'annule' },
  { id: 'L02', texte: "c'est bon, en fait mon souci c'est que je ne vois plus le groupe depuis ce matin", attendu: 'autre' },
]

let echecs = 0
for (const c of CAS) {
  const fil = [...avant, { role: 'user', content: c.texte, at: at(T0 + 8 * 60000) }]
  const r = await client.messages.create(S.requeteLectureAttente(MODELE, fil, c.texte))
  const brut = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  const sens = S.lireSensEnAttente(brut)
  const decision = S.decisionEnAttente(sens)
  const bon = sens === c.attendu
  if (!bon) echecs++
  console.log(`${bon ? 'ok ' : 'KO '} ${c.id} : sortie « ${brut.slice(0, 20)} », sens ${sens}, decision ${decision} (attendu ${c.attendu}) ; jetons ${r.usage.input_tokens} + ${r.usage.output_tokens}`)
}
console.log(`\n${CAS.length - echecs}/${CAS.length} cas corrects (modele ${MODELE}).`)
process.exit(echecs ? 1 : 0)
