// Les webhooks Kit des inscriptions par formulaire (31/10/2026). Kit est sur
// le plan gratuit : pas de regle « formulaire, alors tags ». Un webhook
// « subscriber.form_subscribe » par formulaire ACTIF pointe vers
// /api/kit/webhook/<secret> du journal, qui pose les choix par defaut
// (src/lib/kit-defauts-pur.ts).
//
// API retenue : les webhooks historiques (POST /v4/webhooks, un evenement et
// un formulaire par webhook). Les « webhook endpoints » (signes, rejoues,
// tous formulaires) repondent 401 a la cle API de ce compte (lu le 31/10).
//
// Le secret du chemin est derive de SUPABASE_SERVICE_ROLE_KEY (.env.local) : il
// n'est jamais affiche en entier. Idempotent : relit /v4/webhooks avant de
// creer, ne cree que ce qui manque, ne supprime rien (un ancien webhook vers
// un autre chemin du journal est signale).
//
//   node --env-file=.env.local scripts/kit-webhook-creer.mjs              # essai
//   node --env-file=.env.local scripts/kit-webhook-creer.mjs --appliquer  # sur GO
//   node --env-file=.env.local scripts/kit-webhook-creer.mjs --tester     # apres deploiement : POST {} sur la route (attendu 200, recus 0)
//   --base=https://... pour un autre domaine que journal.aoknowledge.com

import { APPLIQUER, MODE, exiger, kit, ligne, nombreAppels } from './kit-bascule-commun.mjs'
import { cheminSecret } from '../src/lib/kit-defauts-pur.ts'

const BASE = (process.argv.find(a => a.startsWith('--base='))?.slice(7) || 'https://journal.aoknowledge.com').replace(/\/+$/, '')
const PREFIXE = `${BASE}/api/kit/webhook/`
const cle = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!cle || cle.length < 32) { console.error('ARRET : SUPABASE_SERVICE_ROLE_KEY absente (lancer avec --env-file=.env.local)'); process.exit(1) }
const secret = cheminSecret(cle)
const CIBLE = PREFIXE + secret
const masque = url => url.startsWith(PREFIXE) ? `${PREFIXE}${url.slice(PREFIXE.length, PREFIXE.length + 4)}...` : '(autre adresse)'

if (process.argv.includes('--tester')) {
  const r = await fetch(CIBLE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  const j = await r.json().catch(() => null)
  console.log(`POST ${masque(CIBLE)} -> ${r.status} ${JSON.stringify(j)}`)
  const faux = await fetch(PREFIXE + '0'.repeat(40), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  console.log(`POST avec un faux secret -> ${faux.status} (attendu 404)`)
  process.exit(r.status === 200 && faux.status === 404 ? 0 : 1)
}

console.log(`Webhooks Kit des formulaires : ${MODE}\ncible : ${masque(CIBLE)}\n`)

async function tous(chemin, cleListe) {
  const liste = []
  let apres = null
  for (let page = 0; page < 20; page++) {
    const sep = chemin.includes('?') ? '&' : '?'
    const j = await exiger(`${chemin}${sep}per_page=1000${apres ? `&after=${encodeURIComponent(apres)}` : ''}`)
    liste.push(...(j?.[cleListe] ?? []))
    if (!j?.pagination?.has_next_page || !j.pagination.end_cursor) break
    apres = j.pagination.end_cursor
  }
  return liste
}

const estFormSubscribe = w => /form_subscribe$/.test(String(w?.event?.name ?? ''))
const formulaires = (await tous('/forms?status=active', 'forms')).filter(f => !f.archived).sort((a, b) => a.id - b.id)
const lireWebhooks = () => tous('/webhooks', 'webhooks')
const existants = await lireWebhooks()

let aCreer = 0, deja = 0
for (const f of formulaires) {
  const ok = existants.some(w => estFormSubscribe(w) && Number(w.event?.form_id) === f.id && w.target_url === CIBLE)
  if (ok) deja++
  else aCreer++
  ligne(String(f.id).padEnd(9), `« ${f.name} »`.padEnd(28), ok ? 'deja en place' : 'a creer')
}
const anciens = existants.filter(w => typeof w.target_url === 'string' && w.target_url.startsWith(PREFIXE) && w.target_url !== CIBLE)
const autres = existants.filter(w => !(typeof w.target_url === 'string' && w.target_url.startsWith(PREFIXE)))
console.log(`\nformulaires actifs ${formulaires.length} : deja en place ${deja}, a creer ${aCreer}`)
console.log(`webhooks existants ${existants.length} (dont ${anciens.length} vers un ancien chemin du journal, ${autres.length} vers ailleurs : non touches)`)

if (!APPLIQUER) {
  console.log(`\nESSAI : rien n'est cree. ${nombreAppels()} appels de lecture.`)
  process.exit(0)
}

let crees = 0, echecs = 0
for (const f of formulaires) {
  if (existants.some(w => estFormSubscribe(w) && Number(w.event?.form_id) === f.id && w.target_url === CIBLE)) continue
  const r = await kit('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ target_url: CIBLE, event: { name: 'subscriber.form_subscribe', form_id: f.id } }),
  })
  if (r.statut === 200 || r.statut === 201) crees++
  else { echecs++; ligne(`   ${f.id} : echec ${r.statut}`) }
}
const relus = await lireWebhooks()
const manquants = formulaires.filter(f => !relus.some(w => estFormSubscribe(w) && Number(w.event?.form_id) === f.id && w.target_url === CIBLE))
console.log(`\ncrees ${crees}, echecs ${echecs}, manquants a la relecture ${manquants.length}. ${nombreAppels()} appels.`)
process.exit(manquants.length || echecs ? 1 : 0)
