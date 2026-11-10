// Verification HORS LIGNE (10/11/2026) de la ROUTE AUTOMATIQUE DU TRI DES
// BESOINS (POST /api/cockpit/besoins/auto) : le jeton (sans, mauvais, bon),
// les actions permises et rien d'autre, les limites (20 cartes, 30 messages),
// prevenir idempotent et le message de l'apercu, l'essai a blanc, la trace de
// chaque geste, puis le branchement relu dans le code (route, depots, cockpit,
// migration). Aucune base, aucun reseau : de faux depots.
// Lancement (Node 22, depuis apps/journal-d-etude) : node scripts/verifier-besoins-auto.mjs
// La migration est cherchee dans ../../sites (ou MIGRATIONS_DIR). Sort en code 1 au premier ecart.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import './resoudre-ts.mjs'

const A = await import('../src/lib/besoins/auto-pur.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lire = (chemin) => readFileSync(path.join(RACINE, chemin), 'utf8')
const uuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const SECRET = 'a'.repeat(20) + 'B'.repeat(23)

// ---------------------------------------------------------------------------
// Faux depots : des cartes, des membres a prevenir, les gestes comptes.
// ---------------------------------------------------------------------------

function fauxDepots(o = {}) {
  const appels = []
  const traces = []
  // carteId -> { statut, titre, membres: [{ id, canal, prevenu }] }
  const cartes = new Map(Object.entries(o.cartes ?? {}))
  let horloge = 0
  return {
    appels, traces, cartes,
    async tracesPresentes() { return o.tables ?? true },
    async tracer(g) {
      if (o.traceEnPanne) throw new Error('panne')
      traces.push(g)
    },
    async lire(max) { appels.push(['lire', max]); return { cartes: [], plus: false, notes: [] } },
    async etatCarte(id) {
      const c = cartes.get(id)
      if (c) return { statut: c.statut, fusionnee: !!c.fusionnee }
      return (o.inconnues ?? []).includes(id) ? null : { statut: 'a_trier', fusionnee: false }
    },
    async tentativesDuJour() { return o.duJour ?? 0 },
    async modifierNote(id, note) { appels.push(['modifierNote', id, note]); return cartes.has(id) || !o.cartes ? { status: 200, corps: { ok: true } } : { status: 404, corps: { error: 'Carte introuvable.' } } },
    async changerStatut(id, statut, raison) {
      appels.push(['changerStatut', id, statut, raison])
      return statut === 'planifie' ? { status: 200, corps: { ok: true, brief: '# brief' } } : { status: 200, corps: { ok: true } }
    },
    async fusionner(s, c) { appels.push(['fusionner', s, c]); return { status: 200, corps: { ok: true } } },
    async apercu(id) {
      appels.push(['apercu', id])
      const c = cartes.get(id)
      if (!c) return { status: 404, corps: { error: 'Carte introuvable.' } }
      if (c.statut !== 'livre' && c.statut !== 'refuse') return { status: 400, corps: { error: 'Seule une carte livrée ou refusée se prévient.' } }
      const a = c.membres.filter(m => !m.prevenu)
      return { status: 200, corps: { statut: c.statut, message: `MESSAGE-${id}`, destinataires: a.map(m => ({ demandeId: m.id, libelle: `Prenom ${m.id}`, canal: m.canal })), dejaPrevenus: c.membres.length - a.length } }
    },
    async prevenir(id, message, budgetMs, maxEnvois) {
      appels.push(['prevenir', id, message, maxEnvois])
      const c = cartes.get(id)
      let envoyes = 0, tentatives = 0, restants = 0
      const echecs = [], aLaMain = []
      for (const m of c.membres) {
        if (m.prevenu) continue // la reservation de prevenirMembres : un membre prevenu ne l'est pas deux fois
        if (m.canal !== 'a_la_main' && tentatives >= maxEnvois) { restants++; continue }
        m.prevenu = true
        if (m.canal === 'a_la_main') { aLaMain.push({ demandeId: m.id, libelle: `Prenom ${m.id}`, email: `${m.id}@exemple.fr` }); continue }
        tentatives++
        if (m.canal === 'panne') { m.prevenu = false; echecs.push({ demandeId: m.id, libelle: `Prenom ${m.id}`, canal: 'email', raison: 'Resend erreur' }); continue }
        envoyes++
      }
      return { status: 200, corps: { envoyes, echecs: echecs.length, aLaMain: aLaMain.length, restants, tentatives, details: { echecs, aLaMain } } }
    },
    maintenant() { return horloge += 10 },
  }
}

const membres = (prefixe, nb, canal = 'telegram') => Array.from({ length: nb }, (_, i) => ({ id: `${prefixe}-${i}`, canal, prevenu: false }))

// ---------------------------------------------------------------------------

await bloc('jeton : refuse sans en-tete, avec un mauvais jeton, sans variable ou variable courte ; accepte le bon', () => {
  assert.equal(A.jetonValide(null, SECRET), false)
  assert.equal(A.jetonValide('', SECRET), false)
  assert.equal(A.jetonValide(`Bearer ${SECRET}x`, SECRET), false)
  assert.equal(A.jetonValide(`Bearer ${SECRET.slice(0, -1)}`, SECRET), false)
  assert.equal(A.jetonValide(`bearer ${SECRET}`, SECRET), false)
  assert.equal(A.jetonValide(SECRET, SECRET), false)
  assert.equal(A.jetonValide(`Bearer ${SECRET}`, undefined), false)
  assert.equal(A.jetonValide('Bearer ', ''), false)
  assert.equal(A.jetonValide('Bearer court', 'court'), false)
  assert.equal(A.jetonValide(`Bearer ${'x'.repeat(31)}`, 'x'.repeat(31)), false)
  assert.equal(A.jetonValide(`Bearer ${SECRET}`, SECRET), true)
  assert.equal(A.jetonValide(`Bearer ${SECRET}`, `  ${SECRET}\n`), true)
})

await bloc('corps : quatre actions et rien d autre, cles inconnues refusees, uuid, doublons', () => {
  for (const action of [undefined, '', 'supprimer', 'ajouter', 'modifier', 'deplacer-demande', 'brief/envoyer', 'detail', 'LIRE', 'sql']) {
    const r = A.lireCommandeAuto({ action })
    assert.ok('erreur' in r && r.status === 400, `action ${action} refusee`)
  }
  for (const corps of [null, 'lire', ['lire'], 42]) assert.ok('erreur' in A.lireCommandeAuto(corps))
  assert.deepEqual(A.lireCommandeAuto({ action: 'lire' }), { action: 'lire', essai: false })
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'lire', sql: 'drop table' }), 'cle inconnue')
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'lire', essai: 'oui' }))
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'statut', cartes: [{ id: uuid(1), statut: 'a_trier' }] }), 'a_trier non permis')
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'statut', cartes: [{ id: uuid(1), statut: 'livre', raison_refus: 'x' }] }), 'raison seulement pour refuse')
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'statut', cartes: [{ id: uuid(1), statut: 'livre', titre: 'x' }] }), 'titre non permis')
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'statut', cartes: [{ id: uuid(1), statut: 'livre', note_equipe: '   ' }] }), 'note vide')
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'statut', cartes: [{ id: 'pas-un-uuid', statut: 'livre' }] }))
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'statut', cartes: [{ id: uuid(1), statut: 'livre' }, { id: uuid(1), statut: 'refuse' }] }), 'doublon')
  const s = A.lireCommandeAuto({ action: 'statut', essai: true, cartes: [{ id: uuid(1).toUpperCase(), statut: 'refuse', raison_refus: 'Pas prévu.', note_equipe: 'Vu au tri.' }] })
  assert.deepEqual(s, { action: 'statut', essai: true, cartes: [{ id: uuid(1), statut: 'refuse', noteEquipe: 'Vu au tri.', raison: 'Pas prévu.' }] })
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'fusionner', fusions: [{ sourceId: uuid(1), cibleId: uuid(1) }] }))
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'prevenir', ids: [uuid(1), uuid(1)] }))
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'prevenir', ids: [] }))
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'prevenir', id: uuid(1) }), 'cle id non permise (ids)')
})

await bloc('limites : 20 cartes par appel au plus (statut, fusionner, prevenir)', () => {
  const vingt = Array.from({ length: 20 }, (_, i) => uuid(i + 1))
  const vingtEtUne = [...vingt, uuid(99)]
  assert.equal(A.MAX_CARTES_AUTO, 20)
  assert.equal(A.MAX_MESSAGES_AUTO, 30)
  assert.ok(!('erreur' in A.lireCommandeAuto({ action: 'prevenir', ids: vingt })))
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'prevenir', ids: vingtEtUne }))
  assert.ok(!('erreur' in A.lireCommandeAuto({ action: 'statut', cartes: vingt.map(id => ({ id, statut: 'planifie' })) })))
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'statut', cartes: vingtEtUne.map(id => ({ id, statut: 'planifie' })) }))
  assert.ok('erreur' in A.lireCommandeAuto({ action: 'fusionner', fusions: vingtEtUne.map((id, i) => ({ sourceId: id, cibleId: uuid(500 + i) })) }))
})

await bloc('aucun geste sans trace : table absente = 503, rien appele', async () => {
  const d = fauxDepots({ tables: false })
  const r = await A.executerAuto({ action: 'statut', essai: false, cartes: [{ id: uuid(1), statut: 'livre', noteEquipe: null, raison: null }] }, d, 240_000)
  assert.equal(r.status, 503)
  assert.equal(d.appels.length, 0)
})

await bloc('statut : note puis statut (gestes du cockpit), brief rendu, chaque carte tracee sans texte', async () => {
  const d = fauxDepots()
  const r = await A.executerAuto({ action: 'statut', essai: false, cartes: [
    { id: uuid(1), statut: 'planifie', noteEquipe: 'Note secrete du tri', raison: null },
    { id: uuid(2), statut: 'refuse', noteEquipe: null, raison: 'Hors de notre offre' },
  ] }, d, 240_000)
  assert.equal(r.status, 200)
  assert.deepEqual(d.appels.map(a => a[0]), ['modifierNote', 'changerStatut', 'changerStatut'])
  assert.equal(r.corps.resultats[0].brief, '# brief')
  assert.equal(d.traces.length, 2)
  assert.ok(d.traces.every(t => t.action === 'statut' && t.resultat === 'fait'))
  assert.ok(!JSON.stringify(d.traces).includes('secrete') && !JSON.stringify(d.traces).includes('offre'), 'aucun texte dans la trace')
})

await bloc('essai a blanc : rien ecrit, rien envoye, gestes traces « simule », apercu de prevenir rendu', async () => {
  const d = fauxDepots({ cartes: { [uuid(1)]: { statut: 'livre', membres: membres('m', 3) } } })
  await A.executerAuto({ action: 'statut', essai: true, cartes: [{ id: uuid(5), statut: 'livre', noteEquipe: 'x', raison: null }] }, d, 240_000)
  await A.executerAuto({ action: 'fusionner', essai: true, fusions: [{ sourceId: uuid(5), cibleId: uuid(2) }] }, d, 240_000)
  const p = await A.executerAuto({ action: 'prevenir', essai: true, ids: [uuid(1)] }, d, 240_000)
  assert.deepEqual(d.appels.map(a => a[0]), ['apercu'])
  assert.ok(d.traces.length === 3 && d.traces.every(t => t.resultat === 'simule'))
  assert.equal(p.corps.resultats[0].destinataires, 3)
  assert.equal(p.corps.resultats[0].message, `MESSAGE-${uuid(1)}`)
  assert.ok(d.cartes.get(uuid(1)).membres.every(m => !m.prevenu))
})

await bloc('prevenir : le message de l apercu (celui du bouton), idempotent, aucun nom ni adresse rendus', async () => {
  const d = fauxDepots({ cartes: { [uuid(1)]: { statut: 'livre', membres: [...membres('m', 4), ...membres('main', 1, 'a_la_main')] } } })
  const r1 = await A.executerAuto({ action: 'prevenir', essai: false, ids: [uuid(1)] }, d, 240_000)
  const appel = d.appels.find(a => a[0] === 'prevenir')
  assert.equal(appel[2], `MESSAGE-${uuid(1)}`, 'le message est celui de l apercu, jamais un texte de l agent')
  assert.equal(r1.corps.resultats[0].envoyes, 4)
  assert.equal(r1.corps.resultats[0].aLaMain, 1)
  const texte = JSON.stringify(r1.corps)
  assert.ok(!texte.includes('Prenom') && !texte.includes('@exemple.fr'), 'ni libelle ni email dans la reponse')
  const avant = d.appels.filter(a => a[0] === 'prevenir').length
  const r2 = await A.executerAuto({ action: 'prevenir', essai: false, ids: [uuid(1)] }, d, 240_000)
  assert.equal(d.appels.filter(a => a[0] === 'prevenir').length, avant, 'deuxieme appel : aucun envoi')
  assert.equal(r2.corps.resultats[0].envoyes, 0)
  assert.equal(r2.corps.resultats[0].dejaPrevenus, 5)
  assert.ok(d.traces.every(t => t.action === 'prevenir'))
  assert.ok(!JSON.stringify(d.traces).includes('Prenom'))
})

await bloc('prevenir : 30 messages au plus pour tout l appel, la suite reprend au prochain appel', async () => {
  const d = fauxDepots({ cartes: {
    [uuid(1)]: { statut: 'livre', membres: membres('a', 25) },
    [uuid(2)]: { statut: 'refuse', membres: membres('b', 25) },
    [uuid(3)]: { statut: 'livre', membres: membres('c', 2) },
    [uuid(4)]: { statut: 'a_trier', membres: membres('d', 2) },
  } })
  const r = await A.executerAuto({ action: 'prevenir', essai: false, ids: [uuid(1), uuid(2), uuid(3), uuid(4)] }, d, 240_000)
  const envois = d.appels.filter(a => a[0] === 'prevenir')
  assert.deepEqual(envois.map(a => a[3]), [30, 5], 'le reste du plafond passe a la carte suivante')
  const [c1, c2, c3, c4] = r.corps.resultats
  assert.equal(c1.envoyes + c2.envoyes, 30)
  assert.equal(c2.restants, 20)
  assert.ok(c3.restante && c3.status === 429)
  assert.ok(c4.restante, 'plafond atteint : la carte suivante n est meme pas lue')
  assert.equal(r.corps.messagesRestants, 0)
  // Appel suivant : les 20 restants de la carte 2, puis la carte 3.
  const r2 = await A.executerAuto({ action: 'prevenir', essai: false, ids: [uuid(1), uuid(2), uuid(3)] }, d, 240_000)
  assert.deepEqual(r2.corps.resultats.map(x => x.envoyes), [0, 20, 2])
  // Une carte ni livree ni refusee : refusee par l apercu, rien envoye.
  const r3 = await A.executerAuto({ action: 'prevenir', essai: false, ids: [uuid(4)] }, d, 240_000)
  assert.equal(r3.corps.resultats[0].status, 400)
})

await bloc('passages vers l avant seulement ; fusion d une carte a trier seulement ; 404 trace sans carte', async () => {
  const d = fauxDepots({ inconnues: [uuid(9)], cartes: {
    [uuid(1)]: { statut: 'livre', membres: [] }, [uuid(2)]: { statut: 'planifie', membres: [] },
    [uuid(3)]: { statut: 'en_cours', membres: [] }, [uuid(4)]: { statut: 'a_trier', fusionnee: true, membres: [] },
  } })
  const it = (id, statut) => ({ id, statut, noteEquipe: 'note', raison: null })
  const r = await A.executerAuto({ action: 'statut', essai: false, cartes: [
    it(uuid(1), 'refuse'), it(uuid(2), 'planifie'), it(uuid(3), 'planifie'), it(uuid(4), 'livre'), it(uuid(9), 'livre'), it(uuid(2), 'livre'),
  ] }, d, 240_000)
  assert.deepEqual(r.corps.resultats.map(x => x.status), [409, 409, 409, 400, 404, 200])
  assert.deepEqual(d.appels.map(a => a[0]), ['modifierNote', 'changerStatut'], 'aucune note ecrite sur une carte refusee')
  assert.equal(d.traces[4].carteId, null)
  assert.ok(A.passagePermis('a_trier', 'planifie') && A.passagePermis('planifie', 'en_cours') && !A.passagePermis('refuse', 'livre') && !A.passagePermis('a_trier', 'a_trier'))
  const f = await A.executerAuto({ action: 'fusionner', essai: false, fusions: [{ sourceId: uuid(2), cibleId: uuid(5) }, { sourceId: uuid(6), cibleId: uuid(2) }] }, d, 240_000)
  assert.deepEqual(f.corps.resultats.map(x => x.status), [409, 200])
})

await bloc('raison_refus (envoyee aux membres) : 300 caracteres, ni lien, ni adresse, ni @, ni balise, ni gabarit', () => {
  const avec = (raison_refus) => A.lireCommandeAuto({ action: 'statut', cartes: [{ id: uuid(1), statut: 'refuse', raison_refus }] })
  assert.ok(!('erreur' in avec('Ce n est pas dans nos priorités pour cette année.')))
  for (const r of ['Va sur https://exemple.fr', 'voir www.site.com', 'ecris a moi@gmail.com', 'rejoins t.me/arnaque', 'contacte @admin', '<b>gras</b>', 'Ta demande {titre}', 'x'.repeat(301), 'bit.ly/abc']) {
    assert.ok('erreur' in avec(r), r)
  }
})

await bloc('prevenir : 100 envois tentes sur 24 h au plus pour la route', async () => {
  const d = fauxDepots({ duJour: 90, cartes: { [uuid(1)]: { statut: 'livre', membres: membres('a', 25) } } })
  const r = await A.executerAuto({ action: 'prevenir', essai: false, ids: [uuid(1)] }, d, 240_000)
  assert.equal(d.appels.find(a => a[0] === 'prevenir')[3], 10)
  assert.equal(r.corps.resultats[0].envoyes, 10)
  const d2 = fauxDepots({ duJour: 100, cartes: { [uuid(1)]: { statut: 'livre', membres: membres('a', 3) } } })
  const r2 = await A.executerAuto({ action: 'prevenir', essai: false, ids: [uuid(1)] }, d2, 240_000)
  assert.ok(r2.corps.resultats[0].status === 429 && /limite du jour/.test(r2.corps.resultats[0].error))
  assert.ok(!d2.appels.some(a => a[0] === 'prevenir' || a[0] === 'apercu'))
})

await bloc('trace en panne apres le geste : comptee dans la reponse, le geste n est pas defait', async () => {
  const d = fauxDepots({ traceEnPanne: true })
  const r = await A.executerAuto({ action: 'fusionner', essai: false, fusions: [{ sourceId: uuid(1), cibleId: uuid(2) }] }, d, 240_000)
  assert.equal(r.status, 200)
  assert.deepEqual(r.corps.traces, { ok: 0, echec: 1 })
})

await bloc('branchement : route POST seule, jeton avant tout, pas de session ni de CORS ; gestes du cockpit reutilises ; logs sans donnee', () => {
  const route = lire('src/app/api/cockpit/besoins/auto/route.ts')
  assert.deepEqual([...route.matchAll(/export (?:async )?function (\w+)/g)].map(m => m[1]), ['POST'])
  const corps = route.slice(route.indexOf('export async function POST'))
  assert.ok(corps.indexOf('jetonValide(') < corps.indexOf('req.text()'), 'le jeton est verifie avant de lire le corps')
  assert.match(route, /process\.env\.BESOINS_AUTO_TOKEN/)
  assert.ok(!/gardeCockpit|getUserId|corsHeaders|corsPreflight/.test(route))
  for (const m of route.matchAll(/console\.\w+\(`([^`]*)`\)/g)) {
    const vars = [...m[1].matchAll(/\$\{([^}]*)\}/g)].map(v => v[1].trim())
    assert.ok(vars.every(v => /^(cmd\.action|cmd\.essai \? ' \(essai\)' : ''|erreurCourte\(err\))$/.test(v)), `log : ${m[1]}`)
  }
  const pur = lire('src/lib/besoins/auto-pur.ts')
  const depots = lire('src/lib/besoins/auto.ts')
  assert.ok(!/console\./.test(pur) && !/console\./.test(depots), 'aucun log dans les regles ni les depots')
  assert.ok(!/@\/lib\/db|prisma/.test(pur), 'les regles n importent pas la base')
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const src of [code(pur), code(depots)]) assert.ok(!/envoyerTelegram|envoyerEmail|Resend|emails\.send|tracerMessageBot|messageParDefaut|GABARIT_/.test(src), 'aucun envoi ni gabarit recopie')
  for (const f of ['apercuPrevenir', 'prevenirMembres', 'changerStatut', 'modifierBesoin', 'fusionnerBesoins', 'besoinsTab']) assert.ok(depots.includes(f), f)
  assert.match(depots, /set transaction read only/)
  assert.match(depots, /insert into public\.besoin_geste \(par, action, carte_id, resultat, details\)/)
  const ck = lire('src/lib/besoins/cockpit.ts')
  assert.match(ck, /export async function prevenirMembres\(brut: unknown, budgetMs: number, maxEnvois = Number\.POSITIVE_INFINITY\)/)
  assert.equal([...ck.matchAll(/await envoyerTelegram\(|await envoyerEmail\(/g)].length, 2, 'toujours deux envois, dans prevenirMembres')
  assert.match(ck, /if \(!reserves\.length\) continue\n\s+if \(g\.canal !== 'a_la_main'\) tentatives\+\+/)
  // Une panne apres un envoi parti ne libere pas la reservation (pas de second envoi).
  assert.match(ck, /if \(parti\) \{\n\s+await marquer\(reserves, 'envoye, suite en panne'\)/)
  assert.match(ck, /parti = r\.ok\n\s+try \{\n\s+await tracerMessageBot/)
  // La route de Brice ne passe pas de plafond (infini).
  assert.match(lire('src/app/api/cockpit/besoins/prevenir/route.ts'), /prevenirMembres\(await req\.json\(\)\.catch\(\(\) => null\), BUDGET_MS\)/)
  for (const t of [route, pur, depots]) assert.ok(!/[–—]/.test(t), 'aucun tiret long')
})

await bloc('migration 20261110190000 : table fermee, actions et resultats bornes, details bornes, vue gardee, pas de point-virgule hors fin d ordre', () => {
  const dirs = [process.env.MIGRATIONS_DIR, path.join(RACINE, '../../sites/Aoknowledgecom/supabase/migrations')].filter(Boolean)
  const dir = dirs.find(x => existsSync(path.join(x, '20261110190000_besoins_gestes_auto.sql')))
  if (!dir) { console.log('    (migration introuvable ici : MIGRATIONS_DIR=<dossier> pour la relire)'); return }
  const sql = readFileSync(path.join(dir, '20261110190000_besoins_gestes_auto.sql'), 'utf8')
  assert.match(sql, /create table if not exists public\.besoin_geste/)
  assert.match(sql, /check \(action in \('lire', 'statut', 'fusionner', 'prevenir'\)\)/)
  assert.match(sql, /check \(resultat in \('fait', 'refuse', 'echec', 'simule'\)\)/)
  assert.match(sql, /octet_length\(details::text\) <= 2000/)
  assert.match(sql, /alter table public\.besoin_geste force row level security/)
  assert.match(sql, /revoke all on table public\.besoin_geste from anon, authenticated/)
  assert.match(sql, /where public\.is_cockpit_member\(\)/)
  for (const l of sql.split('\n')) {
    if (l.trim().startsWith('--')) assert.ok(!/[;']/.test(l), `commentaire : ${l}`)
    else if (l.includes(';')) assert.ok(l.trimEnd().endsWith(';') && l.indexOf(';') === l.length - 1, `point-virgule : ${l}`)
  }
  assert.ok(!/[–—]/.test(sql))
})

console.log(`\n${n} blocs ok`)
