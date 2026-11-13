// Verification locale du connecteur MCP du cockpit pour Tache (01/11/2026).
// Aucune base, aucun reseau, aucun modele, aucun message : la partie pure
// (src/lib/mcp-tache/pur.ts) tourne contre une cle et une API FACTICES, puis
// le cote serveur (serveur.ts) appelle les VRAIS handlers de l'API de Tab
// pour des routes qui repondent sans base (aide, refus de validation), sous
// le verdict de Tache. Le reste (SQL, migration, route, cockpit) est controle
// sur le texte. Node 22 retire les types : ce script importe les .ts.
//
//   node scripts/verifier-mcp-tache.mjs
//
// Sort en code 1 au premier ecart.
//
// Ce qui est verifie :
// - droits identiques a la cle de Tache : un outil par route de l'aide de
//   Tache, aucun en plus ; chaque outil appelle le handler de l'API avec un
//   verdict de portee 'tache' (jamais 'tab'), sans requete en base pour la cle ;
// - refus hors portee : Bearer de Tab ou de ChatGPT refuse, champs hors schema
//   refuses, empreintes separees (API, ChatGPT, connecteur) ;
// - cle coupee = refus (404 neutre), migration absente = 503 ;
// - limite de cadence : 60 appels d'outil par minute, lots compris ;
// - le secret n'apparait jamais dans un journal, une reponse, Sentry ou la console.

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import './resoudre-ts.mjs'
// Les handlers de Next importent « next/server » sans extension : la version .js pour Node.
register('data:text/javascript,' + encodeURIComponent('export async function resolve(s, c, n) { if (s === "next/server") return n("next/server.js", c); return n(s, c) }'))

const P = await import('../src/lib/mcp-tache/pur.ts')
const G = await import('../src/lib/mcp-gpt/pur.ts')
const { masquerSecretMcp } = await import('../src/lib/sentry-masque.ts')
const { aide } = await import('../src/lib/tab/aide.ts')

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')
const ROUTE = lire('../src/app/api/mcp-cockpit/[secret]/route.ts')
const SERVEUR = lire('../src/lib/mcp-tache/serveur.ts')
const PUR = lire('../src/lib/mcp-tache/pur.ts')
const ACCES = lire('../src/lib/tab/acces.ts')
const MIGRATION = lire('../../../sites/Aoknowledgecom/supabase/migrations/20261101200000_cockpit_tab_cles_tache_mcp.sql')
const SCRIPT = lire('./creer-cle-tache-mcp.mjs')
const COCKPIT = lire('../../cockpit/src/views/machine/AccesTab.tsx')

let n = 0
function cas(nom, f) {
  return Promise.resolve().then(f).then(() => { n += 1; console.log(`ok  ${nom}`) })
}

const SECRET = `tmcp_${randomBytes(32).toString('base64url')}`
const CLE_ID = '44444444-4444-4444-8444-444444444444'
const CLE_TACHE = '55555555-5555-4555-8555-555555555555'
const BEARER_TACHE = 'Bearer tache_cle-de-tache-factice-0000000000'
const BEARER_TAB = 'Bearer tab_cle-de-tab-factice-00000000000000'

// La cle factice : comme serveur.ts (empreinte, coupure, cadence), le Bearer comme verifierCle.
function cleFactice({ coupee = false, appels = 0, enService = true, appelsBearer = 0 } = {}) {
  const lignes = [{ cle_id: CLE_ID, empreinte: P.empreinteCleTacheMcp(SECRET), appels, coupee }]
  const bearers = { [BEARER_TACHE]: { cleId: CLE_TACHE, portee: 'tache' }, [BEARER_TAB]: { cleId: 'tab', portee: 'tab' } }
  return async (secret, entete) => {
    if (!enService) return { ok: false, raison: 'pas_en_service', cleId: null }
    const actives = lignes.filter((l) => !l.coupee)
    const c = P.SECRET_TACHE_MCP.test(secret) ? P.choisirCleTache(actives, secret) : null
    if (c) return c.appels >= P.DEBIT_PAR_MINUTE_TACHE_MCP ? { ok: false, raison: 'debit', cleId: c.cle_id } : { ok: true, cleId: c.cle_id, appelsMinute: c.appels, mode: 'secret' }
    const b = bearers[entete ?? '']
    if (b && P.bearerAccepte(b.portee)) {
      return appelsBearer >= 60 ? { ok: false, raison: 'debit', cleId: b.cleId } : { ok: true, cleId: b.cleId, appelsMinute: appelsBearer, mode: 'bearer' }
    }
    return { ok: false, raison: 'inconnue', cleId: null }
  }
}

// L'API factice : elle note chaque appel et rend une reponse de la forme de l'API.
function apiFactice(appels = [], status = 200) {
  return async (appel, cle) => {
    appels.push({ appel, cle })
    return { status, corps: { ok: status < 400, route: `/${appel.chemin.join('/')}` }, journal: { route: `/${appel.chemin.join('/')}`, parametres: { q: 'x' }, lignes: 3, erreur: status < 400 ? null : 'refus' }, dureeMs: 12 }
  }
}

const rpc = (method, params, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params })
const post = (brut, o = {}) => ({ secret: SECRET, entete: null, typeContenu: 'application/json', versionProtocole: null, brut, ...o })
const sansSecret = (x) => assert.ok(!JSON.stringify(x).includes(SECRET.slice(5)), 'le secret apparait')

// ---------------------------------------------------------------------------
// 1. Droits identiques a la cle de Tache
// ---------------------------------------------------------------------------

await cas('droits : un outil par route de l aide de Tache, aucun en plus', () => {
  const routes = aide('tache').routes.map((r) => `${r.methode} ${r.route}`).sort()
  const outils = P.ROUTES_DES_OUTILS.map((r) => `${r.methode} ${r.route}`).sort()
  assert.deepEqual(outils, routes)
  assert.equal(new Set(P.ROUTES_DES_OUTILS.map((r) => r.outil)).size, P.ROUTES_DES_OUTILS.length)
  const liste = P.outils()
  assert.equal(liste.length, routes.length)
  for (const o of liste) {
    assert.ok(o.description.length > 40, `${o.name} : description vide`)
    assert.equal(o.inputSchema.additionalProperties, false, `${o.name} : champs libres`)
  }
  // Les seules ecritures sont celles de la cle (notes, lu, reponse preparee, brouillon, lot de handles du 13/11).
  const ecritures = liste.filter((o) => !o.annotations.readOnlyHint).map((o) => o.name).sort()
  assert.deepEqual(ecritures, ['ecrire_note', 'generer_post', 'marquer_note_lue', 'pousser_handles', 'preparer_reponse_membre'])
  const posts = P.ROUTES_DES_OUTILS.filter((r) => r.methode === 'POST').map((r) => r.outil).sort()
  assert.deepEqual(posts, ecritures)
})

await cas('droits : chaque outil se traduit en sa route de l API, avec ses parametres', () => {
  const ok = (nom, a, methode, chemin, query = []) => {
    const r = P.appelDeOutil(nom, a)
    assert.equal(typeof r, 'object', `${nom} : ${r}`)
    assert.equal(r.methode, methode, nom)
    assert.deepEqual(r.chemin, chemin, nom)
    assert.deepEqual(r.query, query, nom)
    return r
  }
  ok('aide', {}, 'GET', ['aide'])
  ok('resume_du_jour', {}, 'GET', ['resume-du-jour'])
  ok('encaissements', { du: '2026-10-01', au: '2026-10-31', limite: 20 }, 'GET', ['encaissements'], [['du', '2026-10-01'], ['au', '2026-10-31'], ['limite', '20']])
  ok('personne', { q: '@arthur' }, 'GET', ['personne'], [['q', '@arthur']])
  ok('donnees', { table: 'cockpit_abonnements', filtres: { 'dans.statut': 'past_due,unpaid', colonnes: 'membre_id,montant' } }, 'GET', ['donnees', 'cockpit_abonnements'], [['dans.statut', 'past_due,unpaid'], ['colonnes', 'membre_id,montant']])
  ok('propositions_support', { statut: 'proposee' }, 'GET', ['support', 'propositions'], [['statut', 'proposee']])
  ok('proposition_support', { proposition_id: 'abc-123' }, 'GET', ['support', 'propositions', 'abc-123'])
  ok('url_image_belrive', { image_id: 'img:66666666-6666-4666-8666-666666666666' }, 'GET', ['images-belrive', 'img:66666666-6666-4666-8666-666666666666', 'url'])
  ok('lire_notes', { statut: 'nouvelle' }, 'GET', ['notes'], [['statut', 'nouvelle']])
  const note = ok('ecrire_note', { sujet: 'S', texte: 'T', pour: 'sora' }, 'POST', ['notes'])
  assert.deepEqual(note.corps, { sujet: 'S', texte: 'T', pour: 'sora' })
  ok('marquer_note_lue', { note_id: '33333333-3333-4333-8333-333333333333' }, 'POST', ['notes', '33333333-3333-4333-8333-333333333333', 'lu'])
  const rep = ok('preparer_reponse_membre', { fil_id: '77777777-7777-4777-8777-777777777777', texte: 'Bonjour' }, 'POST', ['support', '77777777-7777-4777-8777-777777777777', 'repondre'])
  assert.deepEqual(rep.corps, { texte: 'Bonjour' })
  const gen = ok('generer_post', { personne: 'brice', canal: 'Live Club', objectif: 'enseigner', idee: 'DOL' }, 'POST', ['generer-post'])
  assert.deepEqual(gen.corps, { personne: 'brice', canal: 'Live Club', objectif: 'enseigner', idee: 'DOL' })
})

await cas('droits : le serveur appelle les handlers de l API sous le verdict de Tache (jamais tab), sans base pour la cle', () => {
  assert.match(SERVEUR, /import \{ GET as getApiTab, POST as postApiTab \} from '@\/app\/api\/tab\/v1\/\[\[\.\.\.chemin\]\]\/route'/)
  assert.match(SERVEUR, /sousCleDeTache\(cle\.cleId, cle\.appelsMinute, \(\) => \(appel\.methode === 'GET' \? getApiTab\(req, ctx\) : postApiTab\(req, ctx\)\)\)/)
  assert.match(ACCES, /verdict: \{ ok: true, cleId, portee: 'tache', appelsMinute \}/)
  assert.match(ACCES, /const mcp = appelMcpTache\.getStore\(\)\n  if \(mcp\) return mcp\.verdict/)
  assert.match(ACCES, /if \(mcp\) \{ mcp\.journaux\.push\(l\); return \}/)
  // Le filtre de l'API ne bouge pas : tab et tache, jamais tache_mcp ni gpt_belrive.
  assert.match(ACCES, /c\.coupee_le is null and c\.portee in \('tab', 'tache'\)/)
  // La requete interne ne porte ni cle ni secret.
  const appel = SERVEUR.slice(SERVEUR.indexOf('export function appelerApiTache'))
  assert.doesNotMatch(appel, /authorization/i)
  assert.doesNotMatch(appel, /secret/i)
})

await cas('droits : les VRAIS handlers de l API repondent sous le verdict de Tache (aide de Tache, refus de validation), journal garde', async () => {
  const { appelerApiTache } = await import('../src/lib/mcp-tache/serveur.ts')
  const appeler = appelerApiTache('https://journal.invalid', '203.0.113.9')
  const cle = { cleId: CLE_ID, appelsMinute: 0 }
  const a = await appeler(P.appelDeOutil('aide', {}), cle)
  assert.equal(a.status, 200)
  assert.ok(a.corps.pour_toi_tache, 'l aide rendue n est pas celle de Tache')
  assert.match(a.corps.bienvenue, /pour Tache/)
  assert.equal(a.journal.route, '/aide')
  // Validation de l'API elle-meme : rien n'atteint la base.
  // La regle de Tache, pas celle de Tab : Tab peut ecrire pour = tache, Tache non (POUR_TACHE).
  const note = await appeler(P.appelDeOutil('ecrire_note', { sujet: 'S', texte: 'T', pour: 'tache' }), cle)
  assert.equal(note.status, 400)
  assert.equal(note.corps.ok, false)
  assert.match(note.corps.erreur, /^pour : sora, umi, sekai ou toutes/)
  assert.equal(note.journal.route, '/notes')
  const fil = await appeler(P.appelDeOutil('preparer_reponse_membre', { fil_id: 'pas-un-uuid', texte: 'Bonjour' }), cle)
  assert.equal(fil.status, 400)
  assert.match(fil.corps.erreur, /Identifiant de fil invalide/)
  const gen = await appeler(P.appelDeOutil('generer_post', { personne: 'personne', canal: 'x', objectif: 'enseigner' }), cle)
  assert.equal(gen.status, 400)
  assert.match(gen.corps.erreur, /personne attendue/)
  const segment = await appeler({ methode: 'GET', chemin: ['support', 'propositions', 'a/b'], query: [], corps: null }, cle)
  assert.ok(segment.status >= 400)
})

// ---------------------------------------------------------------------------
// 2. Refus hors portee
// ---------------------------------------------------------------------------

await cas('hors portee : le Bearer n ouvre qu avec la cle de Tache (jamais Tab, jamais ChatGPT)', async () => {
  assert.equal(P.bearerAccepte('tache'), true)
  for (const p of ['tab', 'gpt_belrive', 'tache_mcp', '', null, undefined, 'TACHE']) assert.equal(P.bearerAccepte(p), false, String(p))
  const d = { verifierCle: cleFactice(), appelerApi: apiFactice() }
  const tab = await P.traiterPost(post(rpc('tools/list'), { secret: 'tache', entete: BEARER_TAB }), d)
  assert.equal(tab.status, 404)
  const tache = await P.traiterPost(post(rpc('tools/list'), { secret: 'tache', entete: BEARER_TACHE }), d)
  assert.equal(tache.status, 200)
  assert.equal(tache.journaux[0].cleId, CLE_TACHE)
  assert.equal(tache.journaux[0].parametres.entree, 'bearer')
  assert.match(SERVEUR, /if \(v\.ok && bearerAccepte\(v\.portee\)\) return/)
})

await cas('hors portee : champs hors schema, outil inconnu, chemins forges refuses avant l API', async () => {
  assert.match(P.appelDeOutil('aide', { route: '/donnees/x' }), /champ inconnu/)
  assert.match(P.appelDeOutil('donnees', { table: '../notes' }), /table/)
  assert.match(P.appelDeOutil('donnees', { table: 'x', filtres: { 'a b': 1 } }), /nom de paramètre invalide/)
  assert.match(P.appelDeOutil('donnees', { table: 'x', filtres: 'eq.a=1' }), /objet/)
  assert.match(P.appelDeOutil('marquer_note_lue', { note_id: '1' }), /uuid/)
  assert.match(P.appelDeOutil('preparer_reponse_membre', { fil_id: 'x/y', texte: 't' }), /fil_id/)
  assert.match(P.appelDeOutil('personne', {}), /q : champ requis/)
  assert.match(P.appelDeOutil('supprimer_tout', {}), /Outil inconnu/)
  const vus = []
  const d = { verifierCle: cleFactice(), appelerApi: apiFactice(vus) }
  const r = await P.traiterPost(post(rpc('tools/call', { name: 'executer_sql', arguments: {} })), d)
  assert.equal(r.corps.error.code, -32602)
  const r2 = await P.traiterPost(post(rpc('tools/call', { name: 'aide', arguments: { x: 1 } })), d)
  assert.equal(r2.corps.result.isError, true)
  assert.equal(vus.length, 0, 'l API a ete appelee pour un refus')
})

await cas('hors portee : empreintes separees (API de Tab, ChatGPT, connecteur de Tache)', () => {
  const s = SECRET
  const api = createHash('sha256').update(s, 'utf8').digest('hex')
  assert.notEqual(P.empreinteCleTacheMcp(s), api)
  assert.notEqual(P.empreinteCleTacheMcp(s), G.empreinteCleGpt(s))
  assert.equal(P.choisirCleTache([{ empreinte: api }, { empreinte: G.empreinteCleGpt(s) }], s), null)
  assert.ok(P.choisirCleTache([{ empreinte: P.empreinteCleTacheMcp(s) }], s))
  assert.equal(P.SECRET_TACHE_MCP.test(s), true)
  assert.equal(G.SECRET_GPT.test(s), false)
  // Le script de creation calcule la meme empreinte.
  assert.match(SCRIPT, /update\(`mcp-cockpit-tache:\$\{secret\}`, 'utf8'\)/)
  assert.match(PUR, /update\(`mcp-cockpit-tache:\$\{secret\}`, 'utf8'\)/)
})

// ---------------------------------------------------------------------------
// 3. Cle coupee, migration absente
// ---------------------------------------------------------------------------

await cas('cle coupee = 404 neutre, secret absent ou mal forme = 404 sans rien lire, migration absente = 503', async () => {
  const appels = []
  const coupee = await P.traiterPost(post(rpc('tools/list')), { verifierCle: cleFactice({ coupee: true }), appelerApi: apiFactice(appels) })
  assert.equal(coupee.status, 404)
  assert.deepEqual(coupee.corps, P.INTROUVABLE)
  assert.equal(coupee.journaux[0].cleId, null)
  let lu = 0
  const espion = async () => { lu += 1; return { ok: false, raison: 'inconnue', cleId: null } }
  const mal = await P.traiterPost(post(rpc('tools/list'), { secret: 'gpt_xxx' }), { verifierCle: espion, appelerApi: apiFactice() })
  assert.equal(mal.status, 404)
  assert.equal(lu, 0)
  assert.equal(mal.journaux.length, 0)
  const autre = await P.traiterPost(post(rpc('tools/list'), { secret: `tmcp_${randomBytes(32).toString('base64url')}` }), { verifierCle: cleFactice(), appelerApi: apiFactice() })
  assert.equal(autre.status, 404)
  const pas = await P.traiterPost(post(rpc('tools/list')), { verifierCle: cleFactice({ enService: false }), appelerApi: apiFactice() })
  assert.equal(pas.status, 503)
  assert.equal(appels.length, 0)
  // Le SQL du serveur : seulement les cles tache_mcp non coupees, et la contrainte lue avant.
  assert.match(SERVEUR, /where c\.portee = 'tache_mcp' and c\.coupee_le is null/)
  assert.match(SERVEUR, /if \(!\(await enService\(\)\)\) return \{ ok: false, raison: 'pas_en_service', cleId: null \}/)
  assert.match(SERVEUR, /pg_get_constraintdef/)
})

await cas('migration : portees completes, idempotente, pas de ; dans les commentaires ni dans une chaine', () => {
  assert.match(MIGRATION, /check \(portee in \('tab', 'gpt_belrive', 'tache', 'tache_mcp'\)\)/)
  assert.match(MIGRATION, /drop constraint if exists cockpit_tab_cles_portee_check/)
  for (const l of MIGRATION.split('\n').filter((x) => x.trim().startsWith('--'))) assert.ok(!l.includes(';'), `; dans un commentaire : ${l}`)
  const sql = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  for (const c of sql.match(/'(?:[^']|'')*'/g) ?? []) assert.ok(!c.includes(';'), `; dans ${c.slice(0, 40)}`)
  assert.equal(P.PORTEE_TACHE_MCP, 'tache_mcp')
})

// ---------------------------------------------------------------------------
// 4. Cadence
// ---------------------------------------------------------------------------

await cas('cadence : 60 appels d outil par minute, compte par outil, lots compris', async () => {
  const plein = await P.traiterPost(post(rpc('tools/list')), { verifierCle: cleFactice({ appels: 60 }), appelerApi: apiFactice() })
  assert.equal(plein.status, 429)
  assert.equal(plein.journaux[0].statut, 429)
  const vus = []
  const lot = JSON.stringify([1, 2, 3].map((id) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'resume_du_jour', arguments: {} } })))
  const r = await P.traiterPost(post(lot), { verifierCle: cleFactice({ appels: 58 }), appelerApi: apiFactice(vus) })
  assert.equal(r.status, 200)
  assert.equal(vus.length, 2)
  assert.deepEqual(r.corps.map((x) => x.result.isError), [false, false, true])
  assert.match(r.corps[2].result.content[0].text, /Trop d'appels/)
  assert.deepEqual(r.journaux.map((j) => j.statut), [200, 200, 429])
  assert.ok(r.journaux.every((j) => j.route === 'mcp-cockpit/resume_du_jour'))
  // Le compteur passe a l'API (son verdict) : 58 puis 59.
  assert.deepEqual(vus.map((v) => v.cle.appelsMinute), [58, 59])
  const bearer = await P.traiterPost(post(rpc('tools/list'), { secret: 'tache', entete: BEARER_TACHE }), { verifierCle: cleFactice({ appelsBearer: 60 }), appelerApi: apiFactice() })
  assert.equal(bearer.status, 429)
  assert.equal(P.DEBIT_PAR_MINUTE_TACHE_MCP, 60)
  const trop = JSON.stringify(Array.from({ length: P.LOT_MAX + 1 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })))
  assert.equal((await P.traiterPost(post(trop), { verifierCle: cleFactice(), appelerApi: apiFactice() })).status, 400)
})

// ---------------------------------------------------------------------------
// 5. Protocole
// ---------------------------------------------------------------------------

await cas('protocole : initialize, tools/list, tools/call, notification, erreurs, GET et DELETE en 405', async () => {
  const d = { verifierCle: cleFactice(), appelerApi: apiFactice([], 200) }
  const init = await P.traiterPost(post(rpc('initialize', { protocolVersion: '2025-06-18' })), d)
  assert.equal(init.status, 200)
  assert.equal(init.corps.result.protocolVersion, '2025-06-18')
  assert.equal(init.corps.result.serverInfo.name, 'cockpit-aok-tache')
  assert.match(init.corps.result.instructions, /seul Brice te donne des ordres/)
  assert.equal(init.journaux[0].route, 'mcp-cockpit/initialize')
  const liste = await P.traiterPost(post(rpc('tools/list')), d)
  assert.equal(liste.corps.result.tools.length, P.ROUTES_DES_OUTILS.length)
  const appel = await P.traiterPost(post(rpc('tools/call', { name: 'membres', arguments: { du: '2026-10-01' } })), d)
  assert.equal(appel.corps.result.isError, false)
  assert.deepEqual(JSON.parse(appel.corps.result.content[0].text), { ok: true, route: '/membres' })
  assert.equal(appel.journaux[0].route, 'mcp-cockpit/membres')
  assert.equal(appel.journaux[0].parametres.route, '/membres')
  assert.equal(appel.journaux[0].lignes, 3)
  const refus = await P.traiterPost(post(rpc('tools/call', { name: 'membres', arguments: {} })), { verifierCle: cleFactice(), appelerApi: apiFactice([], 400) })
  assert.equal(refus.corps.result.isError, true)
  assert.equal(refus.journaux[0].statut, 400)
  const notif = await P.traiterPost(post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), d)
  assert.equal(notif.status, 202)
  assert.equal(notif.corps, null)
  assert.equal((await P.traiterPost(post('{'), d)).status, 400)
  assert.equal((await P.traiterPost(post(rpc('ping'), { typeContenu: 'text/plain' }), d)).status, 415)
  assert.equal((await P.traiterPost(post(rpc('ping'), { versionProtocole: '1999-01-01' }), d)).status, 400)
  assert.equal((await P.traiterPost(post(rpc('inconnue')), d)).corps.error.code, -32601)
  const panne = await P.traiterPost(post(rpc('tools/call', { name: 'aide' })), { verifierCle: cleFactice(), appelerApi: async () => { throw new Error(`boom ${SECRET}`) } })
  assert.equal(panne.corps.result.content[0].text, P.ERREUR_INTERNE)
  assert.match(ROUTE, /export async function GET\(\)/)
  assert.match(ROUTE, /export async function DELETE\(\)/)
  assert.match(ROUTE, /Allow: 'POST'/)
  assert.match(lire('../middleware.ts'), /'\/api\/mcp-cockpit\/'/)
})

// ---------------------------------------------------------------------------
// 6. Le secret, jamais nulle part
// ---------------------------------------------------------------------------

await cas('secret : jamais dans un journal ni une reponse, masque pour Sentry, jamais en console', async () => {
  const d = { verifierCle: cleFactice(), appelerApi: apiFactice() }
  const sorties = [
    await P.traiterPost(post(rpc('initialize', {})), d),
    await P.traiterPost(post(rpc('tools/call', { name: 'personne', arguments: { q: 'x' } })), d),
    await P.traiterPost(post('{'), d),
    await P.traiterPost(post(rpc('tools/list')), { verifierCle: cleFactice({ coupee: true }), appelerApi: apiFactice() }),
    await P.traiterPost(post(rpc('tools/list')), { verifierCle: cleFactice({ appels: 99 }), appelerApi: apiFactice() }),
    await P.traiterPost(post(rpc('tools/call', { name: 'aide' })), { verifierCle: cleFactice(), appelerApi: async () => { throw new Error(`boom ${SECRET}`) } }),
  ]
  for (const s of sorties) { sansSecret(s.journaux); sansSecret(s.corps) }
  // Une erreur interne qui citerait le secret (elle ne devrait pas : aucun handler ne le recoit) est masquee.
  assert.equal(P.masquerSecrets(`x ${SECRET} y`), 'x tmcp_[masque] y')
  assert.match(ROUTE, /masquerSecrets\(err\.message/)
  assert.doesNotMatch(SERVEUR.slice(SERVEUR.indexOf('export function appelerApiTache')), /secret/i)
  const e = {
    request: { url: `https://journal-d-etude-beta.vercel.app/api/mcp-cockpit/${SECRET}?x=1` },
    transaction: `POST /api/mcp-cockpit/${SECRET}`,
    breadcrumbs: [{ message: `fetch /api/mcp-cockpit/${SECRET}` }],
  }
  const m = masquerSecretMcp(e)
  assert.ok(!JSON.stringify(m).includes(SECRET))
  assert.equal(m.transaction, 'POST /api/mcp-cockpit/[masque]')
  assert.equal(masquerSecretMcp('POST /api/mcp/gpt_abc'), 'POST /api/mcp/[masque]')
  // La console de la route et du serveur ne cite jamais le secret ; le script de creation non plus.
  for (const t of [ROUTE, SERVEUR]) {
    for (const l of t.split('\n').filter((x) => /console\./.test(x))) assert.doesNotMatch(l, /\bsecret\b|\bentete\b|authorization/i, l)
  }
  for (const l of SCRIPT.split('\n').filter((x) => /console\./.test(x))) assert.doesNotMatch(l, /\$\{secret\}|\$\{empreinte\}|url:/, l)
  assert.match(SCRIPT, /\{ mode: 0o600 \}/)
  assert.match(SCRIPT, /Elle n est pas affichee/)
})

await cas('cockpit : la cle MCP dans le bloc de Tache, ChatGPT ne voit pas ses appels', () => {
  assert.match(COCKPIT, /\.eq\('portee', 'tache_mcp'\)/)
  assert.match(COCKPIT, /requeteAppels\.like\('route', 'mcp%'\)\.not\('route', 'like', 'mcp-cockpit%'\)/)
  assert.match(COCKPIT, /route\.like\.mcp-cockpit\*/)
  assert.match(COCKPIT, /couper\(c, true\)/)
})

console.log(`\n${n} verifications passees.`)
