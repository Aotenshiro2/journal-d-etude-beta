// Verification locale du connecteur MCP de ChatGPT pour Belrive (23/10/2026).
// Aucune base, aucun reseau : la partie pure (src/lib/mcp-gpt/pur.ts) tourne
// contre une base FACTICE en memoire, et le perimetre du SQL
// (src/lib/mcp-gpt/requetes.ts) est controle sur le texte des requetes.
// Node 22 retire les types : ce script importe les .ts directement.
//
//   node scripts/verifier-mcp-gpt.mjs
//
// Sort en code 1 au premier ecart.
//
// Le SQL lui-meme (migrations, RLS, requetes exactes, transaction annulee) est
// essaye contre la vraie base par un script a part, avant application.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// pur.ts importe ./images-pur sans extension (25/10/2026) : le crochet de resolution d'abord.
import './resoudre-ts.mjs'
const P = await import('../src/lib/mcp-gpt/pur.ts')
const R = await import('../src/lib/mcp-gpt/requetes.ts')
const { masquerSecretMcp } = await import('../src/lib/sentry-masque.ts')
const { emailPing, messageBrice } = await import('../src/lib/tab/notes-pur.ts')

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')
let n = 0
function cas(nom, f) {
  return Promise.resolve().then(f).then(() => { n += 1; console.log(`ok  ${nom}`) })
}

// ---------------------------------------------------------------------------
// La base factice
// ---------------------------------------------------------------------------

const DOCS = [
  { document_id: '11111111-1111-4111-8111-111111111111', titre: 'ETAT du jeu Belrive', chemin: 'ETAT.md', taille: 60, source: 'disque', version: 1, maj_le: '2026-10-23T10:00:00.000Z', contenu: 'Basile existe dans le code. La quête du chat unique est prévue (LOT 72).' },
  { document_id: '22222222-2222-4222-8222-222222222222', titre: 'Arc 06, histoire', chemin: 'Lots/ARC-06-HISTOIRE.md', taille: 5000, source: 'disque', version: 1, maj_le: '2026-10-22T10:00:00.000Z', contenu: 'x'.repeat(5000) },
]
const NOTES = [
  { note_id: '33333333-3333-4333-8333-333333333333', sens: 'vers_claude', auteur: 'tab', instance: 'toutes', sujet: 'Belrive : arc 7', texte: 'Idée pour l arc 7.', liens: ['https://exemple.invalid/a'], statut: 'nouvelle', cree_le: '2026-10-23T09:00:00.000Z' },
]

function baseFactice(journal = []) {
  return {
    journal,
    async chercher(r) {
      journal.push(['chercher', r])
      const t = [
        ...DOCS.filter((d) => !r.normalisee || P.sansAccents(d.contenu + ' ' + d.titre).includes(r.mots[0] ?? r.normalisee))
          .map((d) => ({ genre: 'doc', id: d.document_id, titre: d.titre, chemin: d.chemin, extrait: d.contenu.slice(0, 80), date: d.maj_le, score: 1 })),
        ...NOTES.filter((x) => !r.normalisee || P.sansAccents(x.sujet + ' ' + x.texte).includes(r.mots[0] ?? r.normalisee))
          .map((x) => ({ genre: 'note', id: x.note_id, titre: x.sujet, chemin: null, extrait: x.texte, date: x.cree_le, score: 0.5 })),
      ]
      return t.slice(0, r.limite)
    },
    async lireDocument(id) { journal.push(['lireDocument', id]); return DOCS.find((d) => d.document_id === id) ?? null },
    async lireDocumentParChemin(c) { journal.push(['lireDocumentParChemin', c]); return DOCS.find((d) => d.chemin === c) ?? null },
    async lireNote(id) { journal.push(['lireNote', id]); return NOTES.find((x) => x.note_id === id) ?? null },
    async listerDocuments() { return DOCS.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'contenu'))) },
    async listerNotes(statut, limite) { journal.push(['listerNotes', statut, limite]); return NOTES.filter((x) => statut === 'toutes' || x.statut === statut).slice(0, limite) },
    async ecrireNote(note) {
      journal.push(['ecrireNote', note])
      return {
        note: { note_id: '44444444-4444-4444-8444-444444444444', sens: note.destinataire.sens, auteur: 'gpt', instance: note.destinataire.instance, sujet: note.sujet, texte: note.texte, liens: note.liens, statut: 'nouvelle', cree_le: '2026-10-23T11:00:00.000Z' },
        prevenu: 'prevenu (factice)',
      }
    },
    async listerImages() { return [] },
    async telechargerImage() { return { ok: false, raison: 'pas de reseau (factice)' } },
    async enregistrerImage() { throw new Error('enregistrerImage : voir verifier-images-belrive.mjs') },
    async deposerDocument(d) {
      journal.push(['deposerDocument', d])
      return { document_id: '55555555-5555-4555-8555-555555555555', titre: d.titre, chemin: `Scenario/De-GPT/${d.famille}-v1.md`, taille: Buffer.byteLength(d.contenu), source: 'gpt', version: 1, maj_le: '2026-10-23T11:00:00.000Z' }
    },
  }
}

const SECRET_OK = `gpt_${'A'.repeat(43)}`
const SECRET_DEBIT = `gpt_${'B'.repeat(43)}`
const SECRET_INCONNU = `gpt_${'C'.repeat(43)}`
const SECRET_PANNE = `gpt_${'D'.repeat(43)}`
const CLES = [
  { cle_id: 'cle-ok', empreinte: P.empreinteCleGpt(SECRET_OK), appels: 3 },
  { cle_id: 'cle-debit', empreinte: P.empreinteCleGpt(SECRET_DEBIT), appels: P.DEBIT_PAR_MINUTE_GPT },
]

function deps(base = baseFactice()) {
  return {
    base,
    async verifierCle(secret) {
      if (secret === SECRET_PANNE) return { ok: false, raison: 'base', cleId: null }
      const c = P.choisirCle(CLES, secret)
      if (!c) return { ok: false, raison: 'inconnue', cleId: null }
      if (c.appels >= P.DEBIT_PAR_MINUTE_GPT) return { ok: false, raison: 'debit', cleId: c.cle_id }
      return { ok: true, cleId: c.cle_id }
    },
  }
}

const JSONH = 'application/json'
function post(corps, { secret = SECRET_OK, type = JSONH, version = null, d = deps() } = {}) {
  return P.traiterPost({ secret, typeContenu: type, versionProtocole: version, brut: typeof corps === 'string' ? corps : JSON.stringify(corps) }, d)
}
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
const appel = (id, name, args) => rpc(id, 'tools/call', { name, arguments: args })
const texteOutil = (s) => s.corps.result.content[0].text
const jsonOutil = (s) => JSON.parse(texteOutil(s))

// ---------------------------------------------------------------------------
// La cle : 404 neutre, debit, base
// ---------------------------------------------------------------------------

await cas('secret mal forme : 404 neutre, sans appel a la base ni journal', async () => {
  let appele = false
  const d = { ...deps(), verifierCle: async () => { appele = true; return { ok: true, cleId: 'x' } } }
  for (const s of ['', 'abc', 'gpt_court', `tab_${'A'.repeat(43)}`, `gpt_${'A'.repeat(42)}`, `gpt_${'A'.repeat(42)}/`, `gpt_${'A'.repeat(42)}%`]) {
    const r = await post(rpc(1, 'ping'), { secret: s, d })
    assert.equal(r.status, 404)
    assert.deepEqual(r.corps, P.INTROUVABLE)
    assert.equal(r.journal, null)
  }
  assert.equal(appele, false)
})

await cas('cle inconnue ou coupee : la meme 404 neutre, journalisee sans cle', async () => {
  const r = await post(rpc(1, 'initialize', { protocolVersion: '2025-06-18' }), { secret: SECRET_INCONNU })
  assert.equal(r.status, 404)
  assert.deepEqual(r.corps, P.INTROUVABLE)
  assert.equal(r.journal.cleId, null)
  assert.equal(r.journal.route, 'mcp')
  assert.ok(!JSON.stringify(r).includes(SECRET_INCONNU), 'le secret ne doit jamais etre journalise')
})

await cas('debit depasse : 429, journalise sur la cle', async () => {
  const r = await post(rpc(1, 'ping'), { secret: SECRET_DEBIT })
  assert.equal(r.status, 429)
  assert.equal(r.corps.error.code, -32000)
  assert.equal(r.journal.cleId, 'cle-debit')
})

await cas('base indisponible : 503 neutre', async () => {
  const r = await post(rpc(1, 'ping'), { secret: SECRET_PANNE })
  assert.equal(r.status, 503)
  assert.ok(!/prisma|postgres|ECONN|stack/i.test(JSON.stringify(r.corps)))
})

await cas('choisirCle : temps constant, empreinte separee de celle de Tab', async () => {
  assert.equal(P.choisirCle(CLES, SECRET_OK).cle_id, 'cle-ok')
  assert.equal(P.choisirCle(CLES, SECRET_INCONNU), null)
  // L'empreinte de Tab (sha256 nu) d'un secret de ChatGPT ne correspond jamais a son empreinte en base.
  const { createHash } = await import('node:crypto')
  const commeTab = createHash('sha256').update(SECRET_OK, 'utf8').digest('hex')
  assert.notEqual(commeTab, P.empreinteCleGpt(SECRET_OK))
  assert.equal(P.choisirCle([{ cle_id: 't', empreinte: commeTab }], SECRET_OK), null)
})

// ---------------------------------------------------------------------------
// HTTP et JSON-RPC
// ---------------------------------------------------------------------------

await cas('Content-Type autre que JSON : 415', async () => {
  const r = await post(rpc(1, 'ping'), { type: 'text/plain' })
  assert.equal(r.status, 415)
  assert.equal(r.journal.cleId, 'cle-ok')
  assert.equal((await post(rpc(1, 'ping'), { type: 'application/json; charset=utf-8' })).status, 200)
})

await cas('corps trop gros : 413', async () => {
  const r = await post(' '.repeat(P.CORPS_MAX + 1))
  assert.equal(r.status, 413)
})

await cas('en-tete MCP-Protocol-Version inconnu : 400, connu : accepte', async () => {
  assert.equal((await post(rpc(1, 'ping'), { version: '2099-01-01' })).status, 400)
  // (23/10, ChatGPT) initialize avec un en-tete plus recent que les notres : negocie, pas de 400.
  const initRecent = await post(rpc(1, 'initialize', { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'chatgpt', version: '1' } }), { version: '2026-07-28' })
  assert.equal(initRecent.status, 200)
  assert.equal(initRecent.corps.result.protocolVersion, P.VERSION_RECENTE)
  for (const v of ['2025-03-26', '2025-06-18', '2025-11-25']) assert.equal((await post(rpc(1, 'ping'), { version: v })).status, 200)
})

await cas('JSON illisible : 400 et -32700, id null', async () => {
  const r = await post('{"jsonrpc": "2.0", "id": 1, "method": ')
  assert.equal(r.status, 400)
  assert.equal(r.corps.error.code, -32700)
  assert.equal(r.corps.id, null)
})

await cas('requete invalide : 400 et -32600', async () => {
  for (const c of [{ id: 1, method: 'ping' }, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: null, method: 'ping' }, { jsonrpc: '2.0', id: 1 }, '"texte"', 42]) {
    const r = await post(c)
    assert.equal(r.status, 400, JSON.stringify(c))
    assert.equal(r.corps.error.code, -32600)
  }
})

await cas('initialize : negociation de version (2025-03-26, 2025-06-18, 2025-11-25, sinon la plus recente)', async () => {
  for (const v of ['2025-03-26', '2025-06-18', '2025-11-25']) {
    const r = await post(rpc('a', 'initialize', { protocolVersion: v, capabilities: {}, clientInfo: { name: 'essai', version: '1' } }))
    assert.equal(r.status, 200)
    assert.equal(r.corps.jsonrpc, '2.0')
    assert.equal(r.corps.id, 'a')
    assert.equal(r.corps.result.protocolVersion, v)
    assert.deepEqual(r.corps.result.capabilities, { tools: { listChanged: false } })
    assert.equal(r.corps.result.serverInfo.name, 'belrive-aok')
    assert.match(r.corps.result.instructions, /ETAT\.md/)
    assert.equal(r.journal.route, 'mcp/initialize')
  }
  for (const v of ['2024-11-05', '1999-01-01', undefined, 42]) {
    const r = await post(rpc(2, 'initialize', { protocolVersion: v }))
    assert.equal(r.corps.result.protocolVersion, P.VERSION_RECENTE)
  }
  assert.equal(P.VERSION_RECENTE, '2025-11-25')
})

await cas('notifications/initialized : 202 sans corps', async () => {
  const r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(r.status, 202)
  assert.equal(r.corps, null)
  assert.equal(r.journal.route, 'mcp/notifications/initialized')
})

await cas('reponse du client (result sans method) : 202', async () => {
  const r = await post({ jsonrpc: '2.0', id: 9, result: {} })
  assert.equal(r.status, 202)
})

await cas('ping : resultat vide', async () => {
  const r = await post(rpc(7, 'ping'))
  assert.deepEqual(r.corps, { jsonrpc: '2.0', id: 7, result: {} })
})

await cas('methode inconnue : -32601', async () => {
  const r = await post(rpc(3, 'sampling/createMessage'))
  assert.equal(r.status, 200)
  assert.equal(r.corps.error.code, -32601)
})

await cas('ressources et prompts : listes vides', async () => {
  assert.deepEqual((await post(rpc(1, 'resources/list'))).corps.result, { resources: [] })
  assert.deepEqual((await post(rpc(1, 'prompts/list'))).corps.result, { prompts: [] })
})

await cas('lot : reponses des requetes seulement, 202 si que des notifications, lot vide = 400', async () => {
  const r = await post([rpc(1, 'ping'), { jsonrpc: '2.0', method: 'notifications/initialized' }, rpc(2, 'tools/list')])
  assert.equal(r.status, 200)
  assert.equal(r.corps.length, 2)
  assert.deepEqual(r.corps.map((x) => x.id), [1, 2])
  assert.equal(r.journal.route, 'mcp/lot/3')
  assert.equal((await post([{ jsonrpc: '2.0', method: 'notifications/initialized' }])).status, 202)
  assert.equal((await post([])).status, 400)
  assert.equal((await post(Array.from({ length: P.LOT_MAX + 1 }, (_, i) => rpc(i, 'ping')))).status, 400)
})

// ---------------------------------------------------------------------------
// Les outils
// ---------------------------------------------------------------------------

await cas('tools/list : sept outils, descriptions en francais, annotations justes', async () => {
  const r = await post(rpc(1, 'tools/list'))
  const outils = r.corps.result.tools
  assert.deepEqual(outils.map((o) => o.name), ['search', 'fetch', 'lister_documents', 'lister_notes', 'ecrire_note', 'deposer_document', 'deposer_image'])
  for (const o of outils) {
    assert.equal(o.inputSchema.type, 'object')
    assert.ok(o.description.length > 80, `${o.name} : description trop courte`)
    assert.ok(/[éèàç]/.test(o.description), `${o.name} : description pas en francais ?`)
    assert.ok(!/[\u2014\u2013\u2026\u201c\u201d\u2018\u2019]/.test(JSON.stringify(o)), `${o.name} : caractere hors clavier`)
    assert.equal(o.annotations.openWorldHint, false)
  }
  const lecture = outils.filter((o) => o.annotations.readOnlyHint === true).map((o) => o.name)
  assert.deepEqual(lecture, ['search', 'fetch', 'lister_documents', 'lister_notes'])
  for (const o of outils.filter((x) => !x.annotations.readOnlyHint)) {
    assert.equal(o.annotations.destructiveHint, false, `${o.name} n ecrase rien`)
  }
  assert.deepEqual(outils.find((o) => o.name === 'search').inputSchema.required, ['query'])
  assert.deepEqual(outils.find((o) => o.name === 'fetch').inputSchema.required, ['id'])
  assert.deepEqual(outils.find((o) => o.name === 'ecrire_note').inputSchema.properties.pour.enum, ['sora', 'yume', 'sekai', 'toutes', 'tab'])
})

await cas('outil inconnu : -32602, arguments non objet : -32602', async () => {
  const r = await post(appel(1, 'donnees', {}))
  assert.equal(r.corps.error.code, -32602)
  assert.equal(r.journal.route, 'mcp/tools/call/donnees')
  const r2 = await post(rpc(2, 'tools/call', { name: 'search', arguments: 'texte' }))
  assert.equal(r2.corps.error.code, -32602)
})

await cas('search : ids doc:/note:, titre, extrait, url ; contenu JSON dans un bloc texte', async () => {
  const r = await post(appel(1, 'search', { query: 'Quête' }))
  assert.equal(r.status, 200)
  assert.equal(r.corps.result.isError, false)
  const { results } = jsonOutil(r)
  assert.ok(results.length >= 1)
  assert.match(results[0].id, /^doc:[0-9a-f-]{36}$/)
  assert.ok(results[0].title && results[0].url && typeof results[0].text === 'string')
  assert.equal(r.journal.route, 'mcp/tools/call/search')
  assert.equal(r.journal.lignes, results.length)
  assert.deepEqual(r.journal.parametres.args, { query: 'Quête' })
  const vide = jsonOutil(await post(appel(2, 'search', { query: '' })))
  assert.equal(vide.results.length, 3)
  assert.ok(vide.results.some((x) => x.id.startsWith('note:')))
})

await cas('preparerRecherche : sans accents, motif echappe, mots', async () => {
  const r = P.preparerRecherche('  Quête du Chœur 100% _arc_  ')
  assert.equal(r.normalisee, 'quete du choeur 100% _arc_')
  assert.equal(r.motif, '%quete du choeur 100\\% \\_arc\\_%')
  assert.deepEqual(r.mots, ['quete', 'choeur', '100', 'arc'])
  assert.deepEqual(P.preparerRecherche('personnages Westbridge').mots, ['personnag', 'westbrid'])
  assert.equal(P.preparerRecherche('x'.repeat(1000)).brute.length, P.REQUETE_MAX)
})

await cas('fetch : par id doc:, par uuid nu, par chemin, note, morceau, introuvable', async () => {
  const d = jsonOutil(await post(appel(1, 'fetch', { id: 'doc:11111111-1111-4111-8111-111111111111' })))
  assert.equal(d.title, 'ETAT du jeu Belrive')
  assert.match(d.text, /Basile/)
  assert.equal(d.metadata.suite, false)
  const nu = jsonOutil(await post(appel(2, 'fetch', { id: '11111111-1111-4111-8111-111111111111' })))
  assert.equal(nu.id, 'doc:11111111-1111-4111-8111-111111111111')
  for (const c of ['ETAT.md', './ETAT.md', 'D:\\8_Developpement\\Jeu\\Belrive\\ETAT.md', '/ETAT.md']) {
    const p = jsonOutil(await post(appel(3, 'fetch', { id: c })))
    assert.equal(p.metadata.chemin, 'ETAT.md', c)
  }
  const note = jsonOutil(await post(appel(4, 'fetch', { id: 'note:33333333-3333-4333-8333-333333333333' })))
  assert.equal(note.metadata.de, 'Tab')
  assert.equal(note.metadata.pour, 'Sora, Yume et Sekai')
  assert.match(note.text, /exemple\.invalid/)
  const m = jsonOutil(await post(appel(5, 'fetch', { id: 'Lots/ARC-06-HISTOIRE.md', debut: 1000, longueur: 300 })))
  assert.equal(m.text.length, 300)
  assert.equal(m.metadata.debut, 1000)
  assert.equal(m.metadata.fin, 1300)
  assert.equal(m.metadata.suite, true)
  for (const id of ['doc:pas-un-uuid', 'note:99999999-9999-4999-8999-999999999999', '../secrets-belrive.local.json', 'Inconnu.md']) {
    const r = await post(appel(6, 'fetch', { id }))
    assert.equal(r.corps.result.isError, true, id)
  }
  assert.equal((await post(appel(7, 'fetch', {}))).corps.result.isError, true)
  assert.equal((await post(appel(8, 'fetch', { id: 'ETAT.md', debut: -1 }))).corps.result.isError, true)
  assert.equal((await post(appel(9, 'fetch', { id: 'ETAT.md', debut: 999999 }))).corps.result.isError, true)
})

await cas('normaliserChemin : refuse .., lecteur, vide', async () => {
  assert.equal(P.normaliserChemin('Lots\\FILE-DES-LOTS.md'), 'Lots/FILE-DES-LOTS.md')
  assert.equal(P.normaliserChemin('/mnt/d/8_Developpement/Jeu/Belrive/Scenario/x.md'), 'Scenario/x.md')
  assert.equal(P.normaliserChemin('../x.md'), null)
  assert.equal(P.normaliserChemin('C:/Windows/x'), null)
  assert.equal(P.normaliserChemin('   '), null)
})

await cas('lister_documents et lister_notes', async () => {
  const docs = jsonOutil(await post(appel(1, 'lister_documents', {})))
  assert.equal(docs.documents.length, 2)
  assert.ok(!('contenu' in docs.documents[0]))
  assert.equal(docs.documents[0].taille_octets, 60)
  const base = baseFactice()
  const notes = jsonOutil(await post(appel(2, 'lister_notes', { statut: 'nouvelle', limite: 5 }), { d: deps(base) }))
  assert.equal(notes.notes[0].id, 'note:33333333-3333-4333-8333-333333333333')
  assert.deepEqual(base.journal.at(-1), ['listerNotes', 'nouvelle', 5])
  await post(appel(3, 'lister_notes', {}), { d: deps(base) })
  assert.deepEqual(base.journal.at(-1), ['listerNotes', 'toutes', 30])
  assert.equal((await post(appel(4, 'lister_notes', { statut: 'archivee' }))).corps.result.isError, true)
  assert.equal((await post(appel(5, 'lister_notes', { limite: 500 }))).corps.result.isError, true)
})

await cas('ecrire_note : pour sora, yume (umi), sekai, toutes, tab ; refus nets', async () => {
  const attendu = {
    sora: { sens: 'vers_claude', instance: 'sora' }, yume: { sens: 'vers_claude', instance: 'umi' }, Umi: { sens: 'vers_claude', instance: 'umi' },
    sekai: { sens: 'vers_claude', instance: 'sekai' }, toutes: { sens: 'vers_claude', instance: 'toutes' }, tab: { sens: 'vers_tab', instance: null },
  }
  for (const [pour, dest] of Object.entries(attendu)) {
    const base = baseFactice()
    const r = await post(appel(1, 'ecrire_note', { pour, sujet: '  Arc 7  ', texte: 'Décision : Basile part à Westbridge.', liens: ['https://exemple.invalid'] }), { d: deps(base) })
    assert.equal(r.corps.result.isError, false, pour)
    const [, note] = base.journal.find((x) => x[0] === 'ecrireNote')
    assert.deepEqual(note.destinataire, dest, pour)
    assert.equal(note.sujet, 'Arc 7')
    const sortie = JSON.parse(r.corps.result.content[0].text)
    assert.equal(sortie.de, 'ChatGPT')
    assert.match(sortie.id, /^note:/)
    assert.equal(r.journal.route, 'mcp/tools/call/ecrire_note')
  }
  const long = await post(appel(2, 'ecrire_note', { pour: 'sora', sujet: 'x', texte: 'y'.repeat(P.TEXTE_MAX + 1) }))
  assert.equal(long.corps.result.isError, true)
  assert.equal(long.journal.parametres.args.texte, `[${P.TEXTE_MAX + 1} caractères]`)
  for (const args of [{ pour: 'melanie', sujet: 's', texte: 't' }, { pour: 'sora', texte: 't' }, { pour: 'sora', sujet: 's' },
    { pour: 'sora', sujet: 's'.repeat(201), texte: 't' }, { pour: 'sora', sujet: 's', texte: 't', liens: [1] },
    { pour: 'sora', sujet: 's', texte: 't', liens: Array(21).fill('https://x.invalid') }]) {
    const r = await post(appel(3, 'ecrire_note', args))
    assert.equal(r.corps.result.isError, true, JSON.stringify(args).slice(0, 80))
  }
})

await cas('deposer_document : famille, empreinte, taille bornee', async () => {
  const base = baseFactice()
  const r = await post(appel(1, 'deposer_document', { titre: 'Belrive : l\'histoire, version 4 (complète)', contenu: '# Histoire\n\nTexte.' }), { d: deps(base) })
  assert.equal(r.corps.result.isError, false)
  const [, depot] = base.journal.find((x) => x[0] === 'deposerDocument')
  assert.equal(depot.famille, 'belrive-l-histoire-version-4-complete')
  assert.equal(depot.empreinte, P.empreinteContenu('# Histoire\n\nTexte.'))
  const s = jsonOutil(r)
  assert.match(s.chemin, /^Scenario\/De-GPT\/belrive-l-histoire-version-4-complete-v1\.md$/)
  assert.equal(P.familleDe('???'), 'document')
  assert.equal(P.familleDe('x'.repeat(100)).length, 60)
  const gros = await post(appel(2, 'deposer_document', { titre: 'Gros', contenu: 'é'.repeat(P.DEPOT_MAX_OCTETS / 2 + 1) }))
  assert.equal(gros.corps.result.isError, true)
  assert.match(texteOutil(gros), /octets au plus/)
  const cent = await post(appel(3, 'deposer_document', { titre: 'Cent kilo', contenu: 'a'.repeat(100_000) }))
  assert.equal(cent.corps.result.isError, false)
  assert.equal((await post(appel(4, 'deposer_document', { titre: '', contenu: 'x' }))).corps.result.isError, true)
  assert.equal((await post(appel(5, 'deposer_document', { titre: 'x', contenu: '   ' }))).corps.result.isError, true)
})

await cas('panne de la base pendant un outil : message neutre a ChatGPT, raison au journal seulement', async () => {
  const base = { ...baseFactice(), chercher: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:5432\nprisma:error relation "public.x" does not exist') } }
  const r = await post(appel(1, 'search', { query: 'basile' }), { d: deps(base) })
  assert.equal(r.status, 200)
  assert.equal(r.corps.result.isError, true)
  assert.equal(texteOutil(r), P.ERREUR_INTERNE)
  assert.ok(!/ECONNREFUSED|prisma|relation/.test(JSON.stringify(r.corps)))
  assert.match(r.journal.erreur, /relation/)
})

await cas('resumeArgs : rien de long au journal', async () => {
  assert.deepEqual(P.resumeArgs({ query: 'court', texte: 'x'.repeat(121), liens: ['a', 'b'], limite: 5, autre: { a: 1 } }),
    { query: 'court', texte: '[121 caractères]', liens: '[2 élément(s)]', limite: 5, autre: '[objet]' })
})

// ---------------------------------------------------------------------------
// Le perimetre : le texte du SQL, la route, le middleware, Sentry
// ---------------------------------------------------------------------------

await cas('perimetre du SQL : cinq tables, projet belrive en dur, aucun update ni delete', async () => {
  const source = lire('../src/lib/mcp-gpt/requetes.ts')
  const tables = new Set([...source.matchAll(/public\.([a-z_]+)/g)].map((m) => m[1]))
  assert.deepEqual([...tables].sort(), ['cockpit_perso_documents', 'cockpit_perso_images', 'cockpit_perso_notes', 'cockpit_tab_acces', 'cockpit_tab_cles'])
  const sql = Object.entries(R).filter(([k, v]) => k.startsWith('SQL_') && typeof v === 'string')
  assert.ok(sql.length >= 12)
  for (const [nom, texte] of sql) {
    assert.ok(!/\b(update|delete|truncate|drop|alter|grant)\b/i.test(texte), `${nom} : ecriture interdite`)
    if (/cockpit_perso_images/.test(texte)) {
      for (const m of texte.matchAll(/from public\.cockpit_perso_images (\w+)/g)) assert.ok(texte.includes(`${m[1]}.projet = 'belrive'`), `${nom} : images sans projet`)
    }
    if (/cockpit_perso_(documents|notes)/.test(texte)) {
      assert.ok(/projet = 'belrive'|'belrive'/.test(texte), `${nom} : projet belrive absent`)
      // Chaque lecture de ces tables filtre sur projet = 'belrive' (alias d0, d, x, n0, n).
      const lectures = [...texte.matchAll(/from public\.cockpit_perso_(?:documents|notes) (\w+)/g)].map((m) => m[1])
      for (const alias of lectures) assert.ok(texte.includes(`${alias}.projet = 'belrive'`), `${nom} : ${alias} sans projet = 'belrive'`)
      const jointures = [...texte.matchAll(/join public\.cockpit_perso_(?:documents|notes) (\w+) on [^\n]*/g)]
      for (const j of jointures) assert.ok(j[0].includes(`${j[1]}.projet = 'belrive'`), `${nom} : jointure sans projet`)
    }
    if (/insert into/i.test(texte)) assert.ok(/'belrive'/.test(texte), `${nom} : insertion hors belrive`)
  }
  assert.match(R.SQL_ECRIRE_NOTE, /values \(\$1::text, 'gpt', \$2::text, \$3::text, 'belrive'/)
  assert.match(R.SQL_DEPOSER_DOCUMENT, /'Scenario\/De-GPT\/'/)
  assert.match(R.SQL_DEPOSER_DOCUMENT, /, 'gpt', \$1::text, s\.v/)
  assert.match(R.SQL_CLES_GPT, /c\.portee = 'gpt_belrive' and c\.coupee_le is null/)
})

await cas('perimetre du code : aucun SQL hors requetes.ts, route publique, filtre de portee chez Tab', async () => {
  for (const f of ['../src/lib/mcp-gpt/pur.ts', '../src/lib/mcp-gpt/serveur.ts', '../src/app/api/mcp/[secret]/route.ts']) {
    const t = lire(f)
    assert.ok(!/public\.\w+/.test(t), `${f} : SQL hors requetes.ts`)
    assert.ok(!/\$queryRaw/.test(t), `${f} : requete brute hors requetes.ts`)
  }
  const serveur = lire('../src/lib/mcp-gpt/serveur.ts')
  const ordres = [...serveur.matchAll(/\$executeRawUnsafe\(([^)]*)\)/g)].map((m) => m[1])
  assert.deepEqual(ordres, ['\'set transaction read only\'', '`set local statement_timeout = \'8000ms\'`', '`set local statement_timeout = \'8000ms\'`'])
  const route = lire('../src/app/api/mcp/[secret]/route.ts')
  assert.match(route, /export async function GET\(\)/)
  assert.match(route, /export async function DELETE\(\)/)
  assert.match(route, /Allow: 'POST'/)
  assert.match(lire('../middleware.ts'), /'\/api\/mcp\/'/)
  assert.match(lire('../src/lib/tab/acces.ts'), /c\.coupee_le is null and c\.portee = 'tab'/)
  const agent = lire('../src/lib/agent-cockpit.ts')
  assert.match(agent, /TABLES_PERSO = \/\\bcockpit_perso_\\w\*\/i/, 'l Agent AOK doit refuser cockpit_perso_*, dont les documents')
})

await cas('migration : la colonne tsv et la recherche ont la meme forme sans accents ; pas de ; dans une chaine', async () => {
  const m = lire('../../../sites/Aoknowledgecom/supabase/migrations/20261023170000_cockpit_perso_documents.sql')
  assert.ok(m.includes(`'${R.ACCENTS_SQL}', '${R.SANS_ACCENTS_SQL}'`))
  assert.ok(m.includes(`replace(replace(lower(titre || ' ' || left(contenu, 600000)), 'œ', 'oe'), 'æ', 'ae')`))
  assert.equal(R.ACCENTS_SQL.length, R.SANS_ACCENTS_SQL.length)
  for (const [i, c] of [...R.ACCENTS_SQL].entries()) assert.equal(P.sansAccents(c), R.SANS_ACCENTS_SQL[i], c)
  for (const f of ['20261023170000_cockpit_perso_documents.sql', '20261023171000_cockpit_tab_cles_portee.sql']) {
    const sql = lire(`../../../sites/Aoknowledgecom/supabase/migrations/${f}`).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    const chaines = sql.replace(/\$fn\$[\s\S]*?\$fn\$/g, '').match(/'(?:[^']|'')*'/g) ?? []
    for (const c of chaines) assert.ok(!c.includes(';'), `${f} : ; dans ${c.slice(0, 40)}`)
  }
})

await cas('Sentry : le secret du chemin est masque partout dans un evenement', async () => {
  const e = {
    request: { url: `https://journal-d-etude-beta.vercel.app/api/mcp/${SECRET_OK}?x=1` },
    transaction: `POST /api/mcp/${SECRET_OK}`,
    breadcrumbs: [{ message: `fetch /api/mcp/${SECRET_OK}` }],
    contexts: { trace: { data: { 'http.target': `/api/mcp/${SECRET_OK}` } } },
  }
  const m = masquerSecretMcp(e)
  assert.ok(!JSON.stringify(m).includes(SECRET_OK))
  assert.equal(m.transaction, 'POST /api/mcp/[masque]')
  assert.equal(masquerSecretMcp('/api/tab/v1/aide'), '/api/tab/v1/aide')
})

await cas('pings : ChatGPT nomme dans l email a Tab et le message a Brice', async () => {
  const note = { note_id: 'n1', auteur: 'gpt', instance: null, sujet: 'Arc 7', texte: 'Texte', projet: 'belrive', liens: [] }
  const { objet, texte } = emailPing(note, 'https://x.invalid/api/tab/v1')
  assert.equal(objet, 'Note de ChatGPT : Arc 7')
  assert.match(texte, /projet = belrive/)
  assert.match(messageBrice('Arc 7', 'umi', 'gpt'), /^ChatGPT \(Belrive\) a laissé une note pour Yume : Arc 7/)
  assert.match(messageBrice('Arc 7', 'toutes'), /^Tab a laissé une note/)
})

console.log(`\n${n} verifications passees.`)
