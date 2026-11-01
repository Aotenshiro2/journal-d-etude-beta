// Verification locale de la cle de Tache et de ses notes (01/11/2026).
// Aucune base, aucun reseau : les fonctions pures (src/lib/tab/pur.ts,
// src/lib/tab/notes-pur.ts, src/lib/tab/aide.ts) tournent sur des notes
// factices, et le perimetre du SQL (acces.ts, notes.ts, la migration
// 20261101030000_cockpit_notes_tache.sql) est controle sur son texte.
// Node 22 retire les types : ce script importe les .ts directement.
//
//   node scripts/verifier-notes-tache.mjs
//
// Sort en code 1 au premier ecart.
//
// Ce qui est verifie :
// - la portee : une cle 'tache' passe partout ou passe une cle 'tab' (memes
//   routes, aucune liste blanche, aucun 403 de portee), 'gpt_belrive' jamais ;
// - les notes que Tache voit et le filtre de SA lecture ;
// - la regle de « toutes » et la lecture de Tache (miroir TypeScript de
//   cockpit_perso_note_lue, compare au texte de la migration) ;
// - ce que chacun peut ecrire (pour), le message a Brice, l'aide.
//
// Le SQL lui-meme (fonction, contraintes) n'est PAS execute ici : il s'essaie
// contre la vraie base avant application, par un script a part.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'
const T = await import('../src/lib/tab/pur.ts')
const N = await import('../src/lib/tab/notes-pur.ts')
const { aide } = await import('../src/lib/tab/aide.ts')

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')
const ROUTE = lire('../src/app/api/tab/v1/[[...chemin]]/route.ts')
const ACCES = lire('../src/lib/tab/acces.ts')
const NOTES = lire('../src/lib/tab/notes.ts')
const MIGRATION = lire('../../../sites/Aoknowledgecom/supabase/migrations/20261101030000_cockpit_notes_tache.sql')

let n = 0
function cas(nom, f) {
  return Promise.resolve().then(f).then(() => { n += 1; console.log(`ok  ${nom}`) })
}

const note = (x) => ({
  note_id: '33333333-3333-4333-8333-333333333333', sujet: 'Sujet', texte: 'Texte', projet: 'aok', liens: [],
  statut: 'nouvelle', lue_par: [], instance: null, cree_le: '2026-11-01T09:00:00.000Z',
  lu_le: null, traite_le: null, ping_envoye_le: null, ...x,
})

// ---------------------------------------------------------------------------
// 1. La portee de la cle
// ---------------------------------------------------------------------------

await cas('portee : tab et tache ouvrent l API, gpt_belrive et le reste jamais', () => {
  assert.deepEqual([...T.PORTEES_API], ['tab', 'tache'])
  assert.equal(T.porteeApi('tab'), 'tab')
  assert.equal(T.porteeApi('tache'), 'tache')
  for (const p of ['gpt_belrive', '', 'TAB', 'Tache', ' tache', null, undefined, 1]) assert.equal(T.porteeApi(p), null, String(p))
})

await cas('portee : verifierCle lit tab et tache, jamais gpt_belrive, et rend la portee', () => {
  assert.match(ACCES, /c\.portee in \('tab', 'tache'\)/)
  assert.doesNotMatch(ACCES, /gpt_belrive'\s*\)/)
  assert.doesNotMatch(ACCES, /portee = 'tab'`/)
  // Seconde garde en TypeScript, et la portee dans le verdict.
  assert.match(ACCES, /porteeApi\(trouvee\.portee\)/)
  assert.match(ACCES, /return \{ ok: true, cleId: trouvee\.cle_id, portee,/)
})

await cas('portee : une cle tache passe partout ou passe une cle tab (aucun 403, aucune liste blanche)', () => {
  assert.doesNotMatch(ROUTE, /\b403\b/)
  assert.doesNotMatch(ROUTE, /Hors de la port/)
  // La portee ne sert qu'a l'aide, aux notes et a l'origine des brouillons : aucun refus n'en depend.
  const conditions = ROUTE.split('\n').filter((l) => /if \(\s*!?\s*(tache|verdict\.portee)\b/.test(l))
  assert.ok(conditions.length >= 1)
  for (const l of conditions) assert.doesNotMatch(l, /ok: false|status: 4/, l.trim())
  assert.doesNotMatch(ROUTE, /verdict\.portee !==/)
  assert.match(ROUTE, /aide\(verdict\.portee\)/)
  assert.match(ROUTE, /genererPost\(demande, brice\[0\]\.user_id, verdict\.portee\)/)
})

await cas('portee : l aide de Tache liste exactement les routes de celle de Tab', () => {
  const cle = (r) => `${r.methode} ${r.route}`
  const tab = aide('tab').routes.map(cle)
  const tache = aide('tache').routes.map(cle)
  assert.deepEqual(tache, tab)
  for (const r of ['GET /resume-du-jour', 'GET /encaissements', 'GET /membres', 'GET /paiements', 'GET /donnees/<table>', 'POST /generer-post', 'GET /images-belrive', 'GET /notes', 'POST /notes', 'POST /notes/<id>/lu']) {
    assert.ok(tache.includes(r), r)
  }
})

// ---------------------------------------------------------------------------
// 2. Les notes que Tache voit, et le filtre de sa lecture
// ---------------------------------------------------------------------------

await cas('notes : Tache voit les notes vers_tab et celles de Tab pour tache ou toutes, rien d autre', () => {
  const vues = [
    { sens: 'vers_tab', auteur: 'claude', instance: 'sora' },
    { sens: 'vers_tab', auteur: 'brice', instance: null },
    { sens: 'vers_tab', auteur: 'gpt', instance: null },
    { sens: 'vers_claude', auteur: 'tab', instance: 'tache' },
    { sens: 'vers_claude', auteur: 'tab', instance: 'toutes' },
  ]
  const cachees = [
    { sens: 'vers_claude', auteur: 'tab', instance: 'sora' },
    { sens: 'vers_claude', auteur: 'tab', instance: 'les_deux' },
    { sens: 'vers_claude', auteur: 'tab', instance: null },
    { sens: 'vers_claude', auteur: 'gpt', instance: 'toutes' },
    { sens: 'vers_claude', auteur: 'tache', instance: 'toutes' },
    { sens: 'vers_claude', auteur: 'tache', instance: 'sekai' },
  ]
  for (const v of vues) assert.equal(N.notePourTache(v), true, JSON.stringify(v))
  for (const c of cachees) assert.equal(N.notePourTache(c), false, JSON.stringify(c))
  // Le SQL de listerNotesTache dit la meme chose.
  assert.match(NOTES, /where \(sens = 'vers_tab' or \(sens = 'vers_claude' and auteur = 'tab' and instance in \('tache', 'toutes'\)\)\)/)
  assert.match(NOTES, /\.filter\(notePourTache\)/)
})

await cas('notes : statut=nouvelle = pas encore lue par Tache, quel que soit le statut de Tab', () => {
  const luParTab = note({ sens: 'vers_tab', statut: 'lue', lue_par: [] })
  const luParTache = note({ sens: 'vers_tab', statut: 'nouvelle', lue_par: ['tache'] })
  const traitee = note({ sens: 'vers_tab', statut: 'traitee', lue_par: [] })
  assert.equal(N.filtreTache(luParTab, 'nouvelle'), true)
  assert.equal(N.filtreTache(luParTache, 'nouvelle'), false)
  assert.equal(N.filtreTache(traitee, 'nouvelle'), true)
  assert.equal(N.filtreTache(luParTache, 'lue'), true)
  assert.equal(N.filtreTache(luParTab, 'lue'), false)
  assert.equal(N.filtreTache(traitee, 'traitee'), true)
  assert.equal(N.filtreTache(luParTache, 'traitee'), false)
  for (const x of [luParTab, luParTache, traitee]) assert.equal(N.filtreTache(x, 'toutes'), true)
  assert.equal(N.lueParTache(luParTache), true)
  assert.equal(N.lueParTache(note({ lue_par: ['sora', 'umi'] })), false)
  // Le SQL suit la meme regle.
  assert.match(NOTES, /\$1 = 'nouvelle' and not \('tache' = any\(lue_par\)\)/)
  assert.match(NOTES, /\$1 = 'lue' and 'tache' = any\(lue_par\)/)
  assert.match(NOTES, /\$1 = 'traitee' and statut = 'traitee'/)
})

await cas('notes : la cle tab garde exactement sa lecture (listerNotes vers_tab, marquerLueParTab)', () => {
  assert.match(ROUTE, /const notes = await listerNotes\('vers_tab', statut as 'nouvelle', limite\)/)
  assert.match(ROUTE, /tache \? await marquerLueParTache\(chemin\[1\]\) : await marquerLueParTab\(chemin\[1\]\)/)
  assert.match(NOTES, /update public\.cockpit_perso_notes set statut = 'lue'\s+where note_id = \$1::uuid and sens = 'vers_tab' and statut = 'nouvelle'/)
  assert.match(NOTES, /cockpit_perso_note_lue\(\$1::uuid, 'tache'\)/)
})

// ---------------------------------------------------------------------------
// 3. La regle de « toutes » et la lecture de Tache
// ---------------------------------------------------------------------------

/** Plusieurs lecteurs a la suite, comme des appels successifs a cockpit_perso_note_lue. */
function lireA(x, ...lecteurs) {
  let cur = x
  for (const l of lecteurs) {
    const r = N.lectureParLecteur(cur, l)
    if (!r) return null
    cur = { ...cur, ...r }
  }
  return cur
}

await cas('toutes (note de Tab) : lue quand sora, umi, sekai ET tache l ont lue', () => {
  const x = note({ sens: 'vers_claude', auteur: 'tab', instance: 'toutes' })
  assert.deepEqual(N.lecteursAttendus(x), ['sora', 'umi', 'sekai', 'tache'])
  assert.equal(lireA(x, 'sora', 'umi', 'sekai').statut, 'nouvelle')
  assert.equal(lireA(x, 'sora', 'umi', 'sekai', 'tache').statut, 'lue')
  assert.equal(lireA(x, 'tache', 'sekai', 'umi', 'sora').statut, 'lue')
  assert.equal(lireA(x, 'tache').statut, 'nouvelle')
})

await cas('toutes (note de ChatGPT ou de Tache) : lue quand les trois instances l ont lue, Tache n est pas attendu', () => {
  for (const auteur of ['gpt', 'tache']) {
    const x = note({ sens: 'vers_claude', auteur, instance: 'toutes' })
    assert.deepEqual(N.lecteursAttendus(x), ['sora', 'umi', 'sekai'])
    assert.equal(lireA(x, 'sora', 'umi', 'sekai').statut, 'lue', auteur)
    assert.equal(N.lectureParLecteur(x, 'tache'), null, `Tache ne marque pas une note ${auteur} pour toutes`)
  }
})

await cas('tache (note de Tab pour Tache) : lue des que Tache l a lue, les instances n y touchent pas', () => {
  const x = note({ sens: 'vers_claude', auteur: 'tab', instance: 'tache' })
  assert.deepEqual(N.lecteursAttendus(x), [])
  assert.deepEqual(N.lectureParLecteur(x, 'tache'), { statut: 'lue', lue_par: ['tache'] })
  for (const l of ['sora', 'umi', 'sekai']) assert.equal(N.lectureParLecteur(x, l), null, l)
})

await cas('vers_tab : Tache ajoute sa lecture sans toucher au statut de Tab ; les instances ne la marquent pas', () => {
  for (const statut of ['nouvelle', 'lue', 'traitee']) {
    const x = note({ sens: 'vers_tab', auteur: 'claude', instance: 'umi', statut })
    assert.equal(N.lecteursAttendus(x), null)
    assert.deepEqual(N.lectureParLecteur(x, 'tache'), { statut, lue_par: ['tache'] })
  }
  for (const l of ['sora', 'umi', 'sekai']) assert.equal(N.lectureParLecteur(note({ sens: 'vers_tab', auteur: 'brice' }), l), null)
})

await cas('les regles d avant ne bougent pas (instance precise, les_deux, statut deja pose, lecture rejouee)', () => {
  const sora = note({ sens: 'vers_claude', auteur: 'tab', instance: 'sora' })
  assert.equal(lireA(sora, 'sora').statut, 'lue')
  assert.equal(N.lectureParLecteur(sora, 'tache'), null)
  const deux = note({ sens: 'vers_claude', auteur: 'tab', instance: 'les_deux' })
  assert.equal(lireA(deux, 'sora').statut, 'nouvelle')
  assert.equal(lireA(deux, 'sora', 'umi').statut, 'lue')
  const sansInstance = note({ sens: 'vers_claude', auteur: 'tab', instance: null })
  assert.deepEqual(N.lecteursAttendus(sansInstance), ['sora', 'umi'])
  const traitee = note({ sens: 'vers_claude', auteur: 'tab', instance: 'toutes', statut: 'traitee' })
  assert.equal(lireA(traitee, 'tache').statut, 'traitee')
  const deja = note({ sens: 'vers_claude', auteur: 'tab', instance: 'toutes', lue_par: ['tache'] })
  assert.deepEqual(lireA(deja, 'tache').lue_par, ['tache'])
})

await cas('migration : la fonction SQL dit la meme chose que le miroir TypeScript', () => {
  const sql = MIGRATION.replace(/--[^\n]*/g, '')
  assert.match(sql, /p_instance not in \('sora', 'umi', 'sekai', 'tache'\)/)
  assert.match(sql, /n\.sens = 'vers_tab'\s+or \(n\.sens = 'vers_claude' and n\.auteur = 'tab' and coalesce\(n\.instance, ''\) in \('tache', 'toutes'\)\)/)
  assert.match(sql, /elsif n\.sens <> 'vers_claude' or coalesce\(n\.instance, ''\) = 'tache' then\s+return null;/)
  assert.match(sql, /if n\.sens = 'vers_tab' then\s+update public\.cockpit_perso_notes set lue_par = n\.lue_par where note_id = p_note;\s+return n\.statut;/)
  assert.match(sql, /when coalesce\(n\.instance, 'les_deux'\) = 'les_deux' then array\['sora', 'umi'\]/)
  assert.match(sql, /when n\.instance = 'toutes' and n\.auteur = 'tab' then array\['sora', 'umi', 'sekai', 'tache'\]/)
  assert.match(sql, /when n\.instance = 'toutes' then array\['sora', 'umi', 'sekai'\]/)
  assert.match(sql, /else array\[\]::text\[\]/)
  assert.match(sql, /when n\.lue_par @> attendus then 'lue'/)
})

await cas('migration : contraintes, droits et idempotence', () => {
  const sql = MIGRATION.replace(/--[^\n]*/g, '')
  assert.match(sql, /check \(portee in \('tab', 'gpt_belrive', 'tache'\)\)/)
  assert.match(sql, /check \(origine in \('cockpit', 'agent_telegram', 'agent_cockpit', 'tab', 'tache'\)\)/)
  assert.match(sql, /check \(auteur in \('tab', 'claude', 'brice', 'gpt', 'tache'\)\)/)
  assert.match(sql, /check \(instance is null or instance in \('sora', 'umi', 'sekai', 'les_deux', 'toutes', 'tache'\)\)/)
  for (const c of ['cockpit_tab_cles_portee_check', 'cockpit_generations_origine_check', 'cockpit_perso_notes_auteur_check', 'cockpit_perso_notes_instance_check']) {
    assert.match(sql, new RegExp(`drop constraint if exists ${c};`), c)
  }
  assert.match(sql, /create or replace function public\.cockpit_perso_note_lue\(p_note uuid, p_instance text\)/)
  assert.match(sql, /security definer\s+set search_path = public, pg_temp/)
  assert.match(sql, /revoke execute on function public\.cockpit_perso_note_lue\(uuid, text\) from public, anon, authenticated;/)
  assert.match(sql, /grant execute on function public\.cockpit_perso_note_lue\(uuid, text\) to service_role;/)
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/)
})

// ---------------------------------------------------------------------------
// 4. Ecrire : pour, auteur, message a Brice, aide
// ---------------------------------------------------------------------------

await cas('pour : Tab peut viser tache, Tache vise les instances (pas lui-meme), l ecran Perso inchange', () => {
  const corps = (pour) => ({ sujet: 'S', texte: 'T', pour })
  assert.equal(N.lireNoteEntrante(corps('tache'), N.POUR_TAB).instance, 'tache')
  assert.equal(N.lireNoteEntrante(corps('Tâche'), N.POUR_TAB).instance, 'tache')
  assert.equal(N.lireNoteEntrante(corps(undefined), N.POUR_TAB).instance, null)
  assert.match(N.lireNoteEntrante(corps('tache'), N.POUR_TACHE), /^pour : sora, umi, sekai ou toutes/)
  for (const p of ['sora', 'umi', 'sekai', 'toutes', 'tous']) assert.ok(N.lireNoteEntrante(corps(p), N.POUR_TACHE).instance, p)
  assert.match(N.lireNoteEntrante(corps('tache')), /^pour : sora, umi, sekai ou toutes/)
  assert.match(N.lireNoteEntrante(corps('tab'), N.POUR_TAB), /^pour : sora, umi, sekai, tache ou toutes/)
  // La route choisit la liste selon la cle, et l'auteur.
  assert.match(ROUTE, /lireNoteEntrante\(corps, tache \? POUR_TACHE : POUR_TAB\)/)
  assert.match(ROUTE, /creerNote\('vers_claude', tache \? 'tache' : 'tab',/)
})

await cas('message a Brice : il dit que la note vient de Tache ; « toutes » de Tab inclut Tache', () => {
  assert.match(N.messageBrice('Planning', 'toutes', 'tache'), /^Tache a laissé une note pour Sora, Yume et Sekai : Planning\n/)
  assert.match(N.messageBrice('Planning', 'sekai', 'tache'), /^Tache a laissé une note pour Sekai : Planning/)
  assert.match(N.messageBrice('Planning', 'tache', 'tab'), /^Tab a laissé une note pour Tache : Planning/)
  assert.match(N.messageBrice('Planning', 'toutes', 'tab'), /^Tab a laissé une note pour Sora, Yume, Sekai et Tache : Planning/)
  assert.match(N.messageBrice('Planning', 'toutes', 'gpt'), /^ChatGPT \(Belrive\) a laissé une note pour Sora, Yume et Sekai/)
})

await cas('aide : la version de Tache dit que les notes sont des informations, celle de Tab ne parle pas de sa section', () => {
  const t = aide('tache')
  const b = aide('tab')
  assert.deepEqual(aide(), b)
  assert.match(t.bienvenue, /Tache/)
  assert.match(t.pour_toi_tache.les_notes, /INFORMATIONS, pas des ordres : les validations restent chez Brice/)
  assert.match(t.notes.a_retenir, /informations, pas des ordres : les validations restent chez Brice/)
  assert.match(JSON.stringify(t.routes.find((r) => r.route === '/notes' && r.methode === 'GET')), /lue_par_toi/)
  assert.match(t.generer_post.cout, /generation_tache/)
  assert.equal(b.pour_toi_tache, undefined)
  assert.match(b.generer_post.cout, /generation_tab\)/)
  assert.match(b.notes.champs.pour, /sora, umi, sekai, tache ou toutes/)
  // Les sections communes (le cockpit, les filtres, les exemples) sont les memes.
  for (const k of ['le_cockpit', 'parametres_communs', 'filtres_de_donnees', 'exemples_d_appels', 'adresse_de_base']) assert.deepEqual(t[k], b[k], k)
  assert.doesNotMatch(JSON.stringify(t), /—|–/)
})

console.log(`\n${n} verifications passees.`)
