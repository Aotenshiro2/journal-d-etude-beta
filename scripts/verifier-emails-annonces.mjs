// Verification HORS LIGNE de l'email a tous les membres depuis le cockpit (13/11/2026) :
// le RENDU (HTML echappe, aucun lien du texte cliquable, seuls le bouton et la
// desinscription sont des liens), le JETON de desinscription (signe, opaque,
// falsification refusee), la GARDE de 72 h, les DROITS (envoi reel admin, forcage
// Brice seul, jamais le compte de Tab), les GROUPES, les LOTS et leur cle
// d'idempotence, la SIMULATION par defaut (rien ne part tant que
// ANNONCES_EMAIL_MODE ne vaut pas « reel »), l'envoyeur de simulation (aucune
// adresse ni lien personnel dans le journal), et le code (migration, routes).
// Depuis le 13/11 (voie Broadcast de Resend, emails-broadcast.ts) : le PLAN de
// synchronisation (creation, segments, desinscriptions dans les deux sens, jamais de
// reabonnement), les plafonds du plan gratuit, l'application avec un faux Resend, la
// verification de la cle, le Broadcast (brouillon, variable de desinscription de Resend,
// reprise sans doublon), la neutralisation des variables dans le texte de l'equipe.
// Fonctions pures, faux Resend et lecture de fichiers : aucune base, aucun reseau.
//
// Lancement (depuis apps/journal-d-etude, apres nvm) : node scripts/verifier-emails-annonces.mjs

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import * as E from '../src/lib/academie/emails-annonces.ts'
import * as B from '../src/lib/academie/emails-broadcast.ts'

let blocs = 0
function bloc(nom, fn) {
  fn()
  blocs++
  console.log(`ok  ${nom}`)
}
async function blocAsync(nom, fn) {
  await fn()
  blocs++
  console.log(`ok  ${nom}`)
}
const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261113210000_academie_emails_annonces.sql'
function texteMigration() {
  const candidats = [
    process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${MIGRATION}`) : null,
    new URL(`../../../${MIGRATION}`, import.meta.url),
    new URL(`../../email-a-tous/${MIGRATION}`, import.meta.url),
  ].filter(Boolean)
  const trouve = candidats.find((u) => existsSync(u))
  if (!trouve) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${MIGRATION})`)
  return readFileSync(trouve, 'utf8')
}

// Tiret demi-cadratin et cadratin, guillemets courbes, points de suspension en un caractere.
const INTERDITS = new RegExp(`[${[0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026].map((x) => String.fromCharCode(x)).join('')}]`)
const liens = (html) => [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1])

const SECRET = E.deriverSecret('x'.repeat(40))
const ID = '0b6c3c1e-5d1a-4f3e-9a51-2b7f1c0d9e88'

bloc('transport : simulation par defaut, resend seulement pour « reel »', () => {
  assert.equal(E.transportDepuis(undefined), 'simulation')
  assert.equal(E.transportDepuis(''), 'simulation')
  assert.equal(E.transportDepuis('REEL'), 'simulation')
  assert.equal(E.transportDepuis('vrai'), 'simulation')
  assert.equal(E.transportDepuis('reel'), 'resend')
  assert.equal(E.transportDepuis(' reel '), 'resend')
  assert.equal(E.transportEnvoi('reel', 'simulation'), 'simulation')
  assert.equal(E.transportEnvoi('essai', 'simulation'), 'simulation')
  assert.equal(E.transportEnvoi('essai', 'resend'), 'resend')
  assert.equal(E.transportEnvoi('reel', 'resend'), 'broadcast')
  assert.deepEqual(E.transportsGarde('simulation'), ['simulation'])
  assert.deepEqual(E.transportsGarde('resend'), ['resend', 'broadcast'])
})

bloc('saisie : objet et texte obligatoires, groupe exige a l\'envoi (tous ou comptes), billet en uuid', () => {
  assert.ok('erreur' in E.lireSaisieEmail({ objet: '', texte: 'x' }, false))
  assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x', texte: '   ' }, false))
  assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x', texte: 'y' }, true))
  assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x', texte: 'y', groupe: 'tout_le_monde' }, true))
  for (const g of ['programmes', 'gratuits', 'sans_compte']) assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x', texte: 'y', groupe: g }, true), `groupe sans segment accepte : ${g}`)
  assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x', texte: 'y', groupe: 'tous', billet_id: 'abc' }, true))
  assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x'.repeat(201), texte: 'y' }, false))
  const s = E.lireSaisieEmail({ objet: ' Le  live\nde jeudi ', texte: 'a\r\nb​', groupe: 'comptes', billet_id: ID.toUpperCase() }, true)
  assert.deepEqual(s, { objet: 'Le live de jeudi', texte: 'a\nb', groupe: 'comptes', billetId: ID })
  assert.deepEqual([...E.GROUPES_ENVOI], B.SEGMENTS_CLES)
})

bloc('rendu : les variables de Resend ne viennent que de notre gabarit', () => {
  assert.equal(E.neutraliserVariables('{{{RESEND_UNSUBSCRIBE_URL}}}'), '{ { {RESEND_UNSUBSCRIBE_URL} } }')
  assert.equal(E.neutraliserVariables('{{contact.email}} {a} }'), '{ {contact.email} } {a} }')
  const e = E.construireEmail({ objet: 'Salut {{{contact.first_name}}}', texte: 'Clique {{{RESEND_UNSUBSCRIBE_URL}}} et {{{contact.email}}}', lien: null, lienDesinscription: B.VARIABLE_DESINSCRIPTION, essai: false })
  assert.equal(e.html.split(B.VARIABLE_DESINSCRIPTION).length - 1, 1, 'une seule variable de desinscription, celle du pied')
  assert.equal(e.texte.split(B.VARIABLE_DESINSCRIPTION).length - 1, 1)
  assert.ok(!/\{\{/.test(e.sujet) && !/\{\{\{contact/.test(e.html) && !/\{\{\{contact/.test(e.texte))
  assert.ok(B.payloadBroadcast({ segmentId: 's', sujetId: 't', expediteur: 'x', repondreA: 'y', sujet: e.sujet, html: e.html, texte: e.texte, nom: 'n' }))
})

bloc('rendu : tout le HTML du texte est echappe', () => {
  const e = E.construireEmail({
    objet: '<img src=x onerror=alert(1)>', texte: 'Salut <b>toi</b> & <script>alert(1)</script>\n<a href="https://pirate.fr">clic</a>',
    lien: null, lienDesinscription: 'https://journal.aoknowledge.com/api/academie/emails/desinscription?j=abc', essai: false,
  })
  assert.ok(!/<script/i.test(e.html))
  assert.ok(!/<b>toi/.test(e.html))
  assert.ok(!/<img/i.test(e.html))
  assert.ok(e.html.includes('&lt;script&gt;'))
  assert.ok(e.html.includes('&amp;'))
})

bloc('rendu : aucun lien du texte n\'est cliquable, ni par balise ni par auto-lien', () => {
  const texte = [
    'Le replay : https://youtu.be/abc et http://evil.example/x',
    'Va sur www.phishing.fr ou pirate.com/connexion, ou ecris a quelqu1@gmail.com',
    '[clique ici](https://pirate.fr/vol) et **gras** et t.me/piege',
  ].join('\n')
  const e = E.construireEmail({ objet: 'Voir https://pirate.fr', texte, lien: 'https://aoknowledge.com/academie/x/y', lienDesinscription: 'https://journal.aoknowledge.com/api/academie/emails/desinscription?j=abc', essai: false })
  assert.deepEqual(liens(e.html), ['https://aoknowledge.com/academie/x/y', 'https://journal.aoknowledge.com/api/academie/emails/desinscription?j=abc'])
  for (const brut of ['https://youtu.be', 'http://evil', 'www.phishing', 'pirate.com/', 'gmail.com', 'https://pirate.fr']) {
    assert.ok(!e.html.includes(brut), `adresse cliquable restee : ${brut}`)
    const corpsTexte = e.texte.split('Ouvrir l\'académie :')[0]
    assert.ok(!corpsTexte.includes(brut), `adresse restee dans le texte brut : ${brut}`)
  }
  assert.ok(e.html.includes('https[:]//youtu[.]be/abc'))
  assert.ok(e.html.includes('www[.]phishing[.]fr'))
  assert.ok(e.html.includes('clique ici (https[:]//pirate[.]fr/vol)'))
  assert.ok(e.html.includes('<strong>gras</strong>'))
})

bloc('rendu : le bouton ne pointe que vers aoknowledge.com', () => {
  assert.equal(E.lienBouton('https://aoknowledge.com/academie/a/b'), 'https://aoknowledge.com/academie/a/b')
  assert.equal(E.lienBouton('https://aoknowledge.com.pirate.fr/x'), E.URL_ACADEMIE)
  assert.equal(E.lienBouton('https://pirate.fr'), E.URL_ACADEMIE)
  assert.equal(E.lienBouton('https://aoknowledge.com/a" onclick="x'), E.URL_ACADEMIE)
  assert.equal(E.lienBouton(null), E.URL_ACADEMIE)
})

bloc('rendu : Markdown leger (intertitre, liste, paragraphes) et essai marque', () => {
  const b = E.blocs('## Le titre\n\nUn paragraphe\nsur deux lignes\n\n- un\n- deux\n> cite')
  assert.deepEqual(b.map((x) => x.genre), ['titre', 'paragraphe', 'liste', 'paragraphe'])
  const e = E.construireEmail({ objet: 'Objet', texte: 'Texte', lien: null, lienDesinscription: null, essai: true })
  assert.equal(e.sujet, '[Essai] Objet')
  assert.ok(e.html.includes('Email d\'essai'))
  assert.ok(e.html.includes('#desinscription'))
  const r = E.construireEmail({ objet: 'Objet', texte: 'Texte', lien: null, lienDesinscription: 'https://j.x/d?j=1', essai: false })
  assert.equal(r.sujet, 'Objet')
  assert.ok(r.texte.includes('Ne plus recevoir les annonces par email : https://j.x/d?j=1'))
  assert.ok(r.html.includes('Ne plus recevoir les annonces par email'))
})

bloc('rendu : aucun tiret long ni guillemet courbe dans les textes fixes de l\'email', () => {
  const e = E.construireEmail({ objet: 'O', texte: 'T', lien: null, lienDesinscription: 'https://j.x/d?j=1', essai: true })
  assert.ok(!INTERDITS.test(e.html), 'caractere interdit dans le HTML')
  assert.ok(!INTERDITS.test(e.texte), 'caractere interdit dans le texte')
  for (const l of Object.values(E.LIBELLE_GROUPE)) assert.ok(!INTERDITS.test(l))
})

bloc('jeton : signe, opaque, falsification et autre secret refuses', () => {
  const j = E.jetonDesinscription(SECRET, ID)
  assert.ok(!j.includes('@'))
  assert.equal(E.lireJetonDesinscription(SECRET, j), ID)
  assert.equal(E.lireJetonDesinscription(SECRET, j.slice(0, -1) + (j.endsWith('A') ? 'B' : 'A')), null)
  assert.equal(E.lireJetonDesinscription(SECRET, j.replace(ID.slice(0, 8), '11111111')), null)
  assert.equal(E.lireJetonDesinscription(E.deriverSecret('y'.repeat(40)), j), null)
  assert.equal(E.lireJetonDesinscription(SECRET, null), null)
  assert.equal(E.lireJetonDesinscription(SECRET, 'x'.repeat(500)), null)
  assert.throws(() => E.deriverSecret('court'))
  const lien = E.lienDesinscription(E.ROUTE_DESINSCRIPTION_DEFAUT, j)
  assert.ok(lien.startsWith('https://journal.aoknowledge.com/api/academie/emails/desinscription?j='))
  assert.deepEqual(E.entetesDesinscription(lien), { 'List-Unsubscribe': `<${lien}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
  assert.equal(E.baseDesinscription('http://x.fr/d'), E.ROUTE_DESINSCRIPTION_DEFAUT)
  assert.equal(E.baseDesinscription('https://journal.aoknowledge.com/api/academie/emails/desinscription/'), 'https://journal.aoknowledge.com/api/academie/emails/desinscription')
})

bloc('garde : 72 h apres le dernier envoi reel', () => {
  const t0 = new Date('2026-11-16T09:00:00Z')
  assert.deepEqual(E.etatGarde(null, t0), { bloque: false, dernier_reel: null, libre_le: null })
  const g = E.etatGarde(t0, new Date('2026-11-18T09:00:00Z'))
  assert.equal(g.bloque, true)
  assert.equal(g.libre_le, '2026-11-19T09:00:00.000Z')
  assert.equal(E.etatGarde(t0, new Date('2026-11-19T09:00:01Z')).bloque, false)
})

bloc('droits : envoi reel admin, forcage Brice seul, jamais le compte de Tab', () => {
  assert.deepEqual(E.droitsDe({ label: 'Brice', acces_perso: true, role: 'admin' }), { envoyer_reel: true, forcer: true })
  assert.deepEqual(E.droitsDe({ label: 'Mélanie', acces_perso: false, role: 'admin' }), { envoyer_reel: true, forcer: false })
  assert.deepEqual(E.droitsDe({ label: 'Tab (agent IA de Brice)', acces_perso: true, role: 'member' }), { envoyer_reel: false, forcer: false })
  assert.deepEqual(E.droitsDe(null), { envoyer_reel: false, forcer: false })
})

bloc('groupes : compteurs, desinscrits exclus du compte a envoyer', () => {
  const l = [
    { email: 'a@x.fr', user_id: 'u1', raison: 'equipe', desinscrit: false },
    { email: 'b@x.fr', user_id: 'u2', raison: 'programme', desinscrit: false },
    { email: 'c@x.fr', user_id: 'u3', raison: 'gratuit', desinscrit: true },
    { email: 'd@x.fr', user_id: null, raison: 'programme_sans_compte', desinscrit: false },
    { email: 'e@x.fr', user_id: null, raison: 'invite_sans_compte', desinscrit: false },
  ]
  const c = E.compterGroupes(l)
  assert.deepEqual(c.tous, { total: 5, desinscrits: 1, a_envoyer: 4 })
  assert.deepEqual(c.comptes, { total: 3, desinscrits: 1, a_envoyer: 2 })
  assert.deepEqual(c.programmes, { total: 3, desinscrits: 0, a_envoyer: 3 })
  assert.deepEqual(c.gratuits, { total: 1, desinscrits: 1, a_envoyer: 0 })
  assert.deepEqual(c.sans_compte, { total: 2, desinscrits: 0, a_envoyer: 2 })
})

bloc('requete des destinataires : meme regle que dansGroupe, desinscrits lus, adresses connues ecartees', () => {
  const sql = E.SQL_DESTINATAIRES
  assert.ok(/aok_annuaire_acces/.test(sql) && /aok_emails_verifies/.test(sql))
  assert.ok(/academie_emails_desinscriptions/.test(sql) && /reinscrit_le is null/.test(sql))
  assert.ok(/not in \(select email from connues\)/.test(sql))
  assert.ok(/email_confirmed_at is not null/.test(sql) && /deleted_at is null/.test(sql))
  for (const g of E.GROUPES) assert.ok(sql.includes(`when '${g}'`), `groupe absent de la requete : ${g}`)
})

bloc('lots : 100 au plus, cle d\'idempotence stable pour les memes lignes', () => {
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`)
  assert.deepEqual(E.lots(ids).map((x) => x.length), [100, 100, 50])
  assert.equal(E.cleLot(ID, ['b', 'a']), E.cleLot(ID, ['a', 'b']))
  assert.notEqual(E.cleLot(ID, ['a']), E.cleLot(ID, ['b']))
  assert.ok(E.cleLot(ID, ['a']).length <= 256)
})

bloc('statut final et erreurs sans adresse', () => {
  assert.equal(E.statutFinal({ a_envoyer: 1, envoyes: 5, echecs: 0 }), 'en_cours')
  assert.equal(E.statutFinal({ a_envoyer: 0, envoyes: 5, echecs: 0 }), 'fini')
  assert.equal(E.statutFinal({ a_envoyer: 0, envoyes: 5, echecs: 1 }), 'partiel')
  assert.equal(E.statutFinal({ a_envoyer: 0, envoyes: 0, echecs: 3 }), 'echec')
  assert.ok(!E.masquerEmails('refus pour jean.dupont@gmail.com').includes('@gmail'))
})

await blocAsync('envoyeur de simulation : rien ne part, ni adresse ni lien personnel dans le journal', async () => {
  const journal = []
  const env = E.envoyeurSimulation((l) => journal.push(l))
  const lien = E.lienDesinscription(E.ROUTE_DESINSCRIPTION_DEFAUT, E.jetonDesinscription(SECRET, ID))
  const pret = E.construireEmail({ objet: 'Objet', texte: 'Texte', lien: null, lienDesinscription: lien, essai: false })
  const res = await env([{ id: ID, email: 'membre@exemple.fr', pret, lien }], 'cle', ID.slice(0, 8))
  assert.deepEqual(res, [{ id: ID, statut: 'simule', resend_id: null, erreur: null }])
  assert.equal(journal.length, 1)
  assert.ok(!journal[0].includes('membre@exemple.fr'))
  assert.ok(!journal[0].includes(lien))
  assert.ok(journal[0].includes('[lien personnel de desinscription]'))
})

bloc('code : routes et serveur (simulation par defaut, garde, confirmation, droits, aucune adresse journalisee)', () => {
  const route = lire('../src/app/api/cockpit/academie/emails/route.ts')
  assert.ok(/cockpit_allowlist/.test(route), 'allowlist verifiee')
  assert.ok(/droits\.envoyer_reel/.test(route) && /droits\.forcer/.test(route))
  assert.ok(/confirmation/.test(route) && /issue === 'garde'/.test(route))
  assert.ok(/b\.publie/.test(route), 'billet publie exige')
  const serveur = lire('../src/lib/academie/emails-annonces-serveur.ts')
  assert.ok(/transportDepuis\(env\.ANNONCES_EMAIL_MODE\)/.test(serveur))
  assert.ok(/batchValidation: 'permissive'/.test(serveur) && /idempotencyKey/.test(serveur))
  assert.ok(/List-Unsubscribe|entetesDesinscription/.test(serveur))
  for (const [nom, code] of [['route', route], ['serveur', serveur]]) {
    for (const m of code.matchAll(/console\.(info|error|warn)\(([^\n]*)/g)) {
      assert.ok(!/\.email\b|\bemail\}/.test(m[2]), `${nom} : une adresse pourrait partir dans un journal : ${m[2].slice(0, 80)}`)
    }
  }
  const desinscription = lire('../src/app/api/academie/emails/desinscription/route.ts')
  assert.ok(/export async function GET/.test(desinscription) && /method="post"/.test(desinscription), 'GET demande confirmation')
  assert.ok(/mode !== 'essai'/.test(desinscription), 'un lien d\'essai n\'enregistre rien')
  assert.ok(/One-Click/.test(desinscription))
  const mw = lire('../middleware.ts')
  assert.ok(mw.includes("pathname === '/api/academie/emails/desinscription'"), 'route publique en chemin exact')
})

bloc('code : la voie Broadcast (simulation sans ecriture chez Resend, garde avant synchro, Broadcast seulement en mode reel)', () => {
  const route = lire('../src/app/api/cockpit/academie/emails/route.ts')
  const serveur = lire('../src/lib/academie/emails-annonces-serveur.ts')
  // L'ecrivain Resend n'apparait que dans synchroniser (apres « if (!reel) return ») et envoyerParBroadcast (qui refuse la simulation).
  const ecrits = [...serveur.matchAll(/ecrivainDepuisSdk\(/g)].length
  assert.equal(ecrits, 2, 'ecrivainDepuisSdk appele ailleurs que dans synchroniser et envoyerParBroadcast')
  const synchro = serveur.slice(serveur.indexOf('export async function synchroniser'), serveur.indexOf('// L\'ENVOI AUX MEMBRES'))
  assert.ok(synchro.indexOf('if (!reel)') > 0 && synchro.indexOf('if (!reel)') < synchro.indexOf('ecrivainDepuisSdk('), 'la simulation sort avant toute ecriture')
  assert.ok(/const reel = o\.appliquer && cfg\.transport === 'resend'/.test(synchro))
  const parBroadcast = serveur.slice(serveur.indexOf('export async function envoyerParBroadcast'))
  assert.ok(parBroadcast.indexOf("if (cfg.transport !== 'resend') throw") < parBroadcast.indexOf('ecrivainDepuisSdk('))
  assert.ok(parBroadcast.indexOf('SQL_NOTER_BROADCAST') < parBroadcast.indexOf('w.envoyerBroadcast'), 'l\'id du brouillon est garde avant l\'envoi')
  assert.ok(/trouverBroadcast\(broadcasts, envoiId\)/.test(parBroadcast), 'reprise : brouillon retrouve, jamais deux')
  const envoyer = route.slice(route.indexOf("// action === 'envoyer'"))
  assert.ok(envoyer.indexOf('lireGarde(') < envoyer.indexOf('synchroniser('), 'garde lue avant la synchronisation')
  assert.ok(envoyer.indexOf('synchroniser(') < envoyer.indexOf('preparerEnvoi'), 'synchronisation avant la confirmation du nombre')
  assert.ok(/cfg\.transport === 'resend'\s*\?\s*await envoyerParBroadcast/.test(envoyer) && /: await simulerBroadcast/.test(envoyer))
  assert.ok(/appliquer: cfg\.transport === 'resend'/.test(envoyer))
  assert.ok(/action === 'synchro'/.test(route) && /droits\.envoyer_reel/.test(route.slice(route.indexOf("action === 'synchro'"))))
  // Le script de simulation ne peut pas ecrire chez Resend.
  const simu = lire('./simuler-synchro-resend.mjs')
  assert.ok(!/B\.(ecrivainDepuisSdk|appliquerPlan)/.test(simu), 'le script de simulation utilise une ecriture')
  assert.ok(/set transaction read only/.test(simu), 'la base lue en transaction read only')
  // Aucune cle dans un journal.
  for (const code of [route, serveur]) {
    for (const m of code.matchAll(/console\.(info|error|warn)\(([^\n]*)/g)) assert.ok(!/cfg\.cle|\bcle\b\)/.test(m[2]), `une cle pourrait partir dans un journal : ${m[2].slice(0, 80)}`)
  }
})

bloc('migration : tables serveur, RLS forcee, aucun grant, academie_billets intacte, aucun ; dans une chaine', () => {
  const m = texteMigration()
  for (const t of ['academie_emails_envois', 'academie_emails_destinataires', 'academie_emails_desinscriptions']) {
    assert.ok(m.includes(`create table if not exists public.${t}`))
    assert.ok(m.includes(`alter table public.${t} force row level security`))
    assert.ok(m.includes(`revoke all on public.${t} from anon, authenticated`))
  }
  assert.ok(!/\bgrant\b/i.test(m.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')))
  assert.ok(!/alter table public\.academie_billets/.test(m), 'academie_billets ne change pas')
  for (const chaine of m.matchAll(/'([^']*)'/g)) assert.ok(!chaine[1].includes(';'), `point-virgule dans une chaine : ${chaine[1].slice(0, 60)}`)
  assert.ok(!INTERDITS.test(m))
  // Voie Broadcast
  assert.ok(m.includes("check (transport in ('simulation', 'resend', 'broadcast'))"))
  assert.ok(m.includes("'a_envoyer', 'envoye', 'simule', 'confie', 'echec'"))
  assert.ok(m.includes("check (source in ('lien', 'un-clic', 'equipe', 'resend'))"))
  assert.ok(/resend_broadcast_id text/.test(m) && /synchro\s+jsonb/.test(m) && /resend_le\s+timestamptz/.test(m))
})

// ---------------------------------------------------------------------------
// La voie Broadcast (emails-broadcast.ts)
// ---------------------------------------------------------------------------

const etatVide = () => ({ segments: [], sujet: null, contacts: [], membres: { tous: [], comptes: [] }, importsEnCours: 0, desinscritsBroadcasts: [] })
const SEG = { tous: 'seg-tous', comptes: 'seg-comptes' }
const etatPlein = (contacts, membres = { tous: [], comptes: [] }) => ({
  segments: [{ id: 'gen', name: 'General' }, { id: SEG.tous, name: B.SEGMENTS_RESEND.tous }, { id: SEG.comptes, name: B.SEGMENTS_RESEND.comptes }],
  sujet: { id: 'sujet-1', name: B.SUJET_RESEND.nom }, contacts, membres, importsEnCours: 0, desinscritsBroadcasts: [],
})

bloc('plan : Resend vide, tout est cree (opt_in, opt_out pour nos desinscrits), segments et sujet a creer', () => {
  const cible = [{ email: 'A@x.fr', compte: true }, { email: 'b@x.fr', compte: false }, { email: 'c@x.fr', compte: false }]
  const p = B.planifierSynchro(cible, [{ email: 'c@x.fr', resend_le: null }], etatVide())
  assert.deepEqual(p.segments_a_creer, ['tous', 'comptes'])
  assert.equal(p.sujet_a_creer, true)
  assert.deepEqual(p.creer, [
    { email: 'a@x.fr', segments: ['tous', 'comptes'], sujet: 'opt_in' },
    { email: 'b@x.fr', segments: ['tous'], sujet: 'opt_in' },
    { email: 'c@x.fr', segments: ['tous'], sujet: 'opt_out' },
  ])
  assert.deepEqual(p.bloquants, [])
  const r = B.resumePlan(p)
  assert.equal(r.creer, 3); assert.equal(r.creer_desinscrits, 1); assert.equal(r.creer_comptes, 1); assert.equal(r.voie_creation, 'un_par_un')
  assert.ok(!JSON.stringify(r).includes('@'), 'le resume ne porte aucune adresse')
})

bloc('plan : un desinscrit chez Resend n\'est JAMAIS reabonne, et entre dans notre table', () => {
  const contacts = [
    { id: 'k1', email: 'glob@x.fr', unsubscribed: true },
    { id: 'k2', email: 'clic@x.fr', unsubscribed: false },
    { id: 'k3', email: 'ok@x.fr', unsubscribed: false },
  ]
  const etat = { ...etatPlein(contacts, { tous: ['k1', 'k2', 'k3'], comptes: [] }), desinscritsBroadcasts: ['CLIC@x.fr'] }
  // Chez nous : glob@ a ete « reinscrit » par l'equipe (absent de la liste active) ; clic@ inconnu.
  const p = B.planifierSynchro([{ email: 'glob@x.fr', compte: false }, { email: 'clic@x.fr', compte: false }, { email: 'ok@x.fr', compte: false }], [], etat)
  assert.deepEqual(p.importer_desinscriptions, ['clic@x.fr', 'glob@x.fr'])
  assert.deepEqual(p.creer, [])
  assert.deepEqual(p.pousser_desinscriptions, [])
  assert.ok(planVideSauf(p), 'aucune ecriture chez Resend pour des contacts deja en place')
  // Un contact existant n'est jamais cree a nouveau (donc jamais remis en opt_in).
  for (const c of contacts) assert.ok(!p.creer.some((x) => x.email === c.email))
})
function planVideSauf(p) { return B.planVide(p) }

bloc('plan : nos desinscrits sont pousses en opt_out une fois, segments ajoutes et retires', () => {
  const contacts = [
    { id: 'k1', email: 'a@x.fr', unsubscribed: false },  // compte, absent de « comptes »
    { id: 'k2', email: 'b@x.fr', unsubscribed: false },  // plus de compte, encore dans « comptes »
    { id: 'k3', email: 'parti@x.fr', unsubscribed: false },  // plus membre
    { id: 'k4', email: 'd@x.fr', unsubscribed: false },  // desinscrit chez nous, pas encore pousse
    { id: 'k5', email: 'e@x.fr', unsubscribed: false },  // desinscrit chez nous, deja pousse
  ]
  const etat = etatPlein(contacts, { tous: ['k1', 'k2', 'k3', 'k4', 'k5'], comptes: ['k2'] })
  const cible = [{ email: 'a@x.fr', compte: true }, { email: 'b@x.fr', compte: false }, { email: 'd@x.fr', compte: false }, { email: 'e@x.fr', compte: false }, { email: 'neuf@x.fr', compte: false }]
  const base = [{ email: 'd@x.fr', resend_le: null }, { email: 'e@x.fr', resend_le: '2026-11-20T00:00:00Z' }]
  const p = B.planifierSynchro(cible, base, etat)
  assert.deepEqual(p.segments_a_creer, []); assert.equal(p.sujet_a_creer, false)
  assert.deepEqual(p.creer, [{ email: 'neuf@x.fr', segments: ['tous'], sujet: 'opt_in' }])
  assert.deepEqual(p.ajouter, [{ contactId: 'k1', segment: 'comptes' }])
  assert.deepEqual(p.retirer, [{ contactId: 'k3', segment: 'tous' }, { contactId: 'k2', segment: 'comptes' }])
  assert.deepEqual(p.pousser_desinscriptions, [{ contactId: 'k4', email: 'd@x.fr' }])
  assert.deepEqual(p.importer_desinscriptions, [])
})

bloc('plan : plafonds du plan gratuit (1 000 contacts, 3 segments) et import en cours bloquent', () => {
  const beaucoup = Array.from({ length: 1001 }, (_, i) => ({ email: `m${i}@x.fr`, compte: false }))
  assert.ok(B.planifierSynchro(beaucoup, [], etatVide()).bloquants.some((b) => /1000 au plus/.test(b)))
  const huit = Array.from({ length: 850 }, (_, i) => ({ email: `m${i}@x.fr`, compte: false }))
  assert.ok(B.planifierSynchro(huit, [], etatVide()).avertissements.some((a) => /plafond/.test(a)))
  const pleins = { ...etatVide(), segments: [{ id: '1', name: 'General' }, { id: '2', name: 'Autre' }] }
  assert.ok(B.planifierSynchro([{ email: 'a@x.fr', compte: false }], [], pleins).bloquants.some((b) => /3 segments au plus/.test(b) && /General/.test(b)))
  const general = { ...etatVide(), segments: [{ id: '1', name: 'General' }] }
  assert.ok(B.planifierSynchro([{ email: 'a@x.fr', compte: false }], [], general).avertissements.some((a) => /General/.test(a)))
  assert.ok(B.planifierSynchro([], [], { ...etatVide(), importsEnCours: 1 }).bloquants.some((b) => /import/.test(b)))
})

bloc('import en lot : un CSV par combinaison, une colonne email, au-dela du seuil seulement', () => {
  const creer = Array.from({ length: 25 }, (_, i) => ({ email: `m${i}@x.fr`, segments: i < 5 ? ['tous', 'comptes'] : ['tous'], sujet: i === 7 ? 'opt_out' : 'opt_in' }))
  const lots = B.lotsImport(creer)
  assert.deepEqual(lots.map((l) => [l.segments.join('+'), l.sujet, l.n]), [['tous+comptes', 'opt_in', 5], ['tous', 'opt_in', 19], ['tous', 'opt_out', 1]])
  assert.ok(lots.every((l) => l.csv.startsWith('email\n') && l.csv.trim().split('\n').length === l.n + 1))
  assert.equal(B.resumePlan({ ...B.planifierSynchro([], [], etatVide()), creer }).voie_creation, 'import')
})

// Un faux SDK Resend qui note chaque appel.
function fauxSdk(reponses = {}) {
  const appels = []
  const ok = (data) => Promise.resolve({ data, error: null })
  const note = (nom, rep) => (...args) => { appels.push([nom, ...args]); return rep ? rep(...args) : ok({ id: `${nom}-${appels.length}` }) }
  const page = (data) => ok({ object: 'list', data, has_more: false })
  const sdk = {
    domains: { list: note('domains.list', reponses.domaines ?? (() => page([{ name: 'aoknowledge.com', status: 'verified' }]))) },
    segments: { list: note('segments.list', () => page(reponses.segments ?? [])), create: note('segments.create') },
    topics: { list: note('topics.list', () => ok({ data: reponses.sujets ?? [] })), create: note('topics.create') },
    contacts: {
      list: note('contacts.list', (o) => page((reponses.contacts ?? []).filter((c) => !o?.segmentId || (reponses.membres?.[o.segmentId] ?? []).includes(c.id)))),
      create: note('contacts.create'),
      imports: { list: note('imports.list', () => page([])), create: note('imports.create') },
      segments: { add: note('segments.add'), remove: note('segments.remove') },
      topics: { update: note('topics.update') },
    },
    broadcasts: {
      list: note('broadcasts.list', () => page(reponses.broadcasts ?? [])), recipients: note('broadcasts.recipients', () => page([])),
      create: note('broadcasts.create'), send: note('broadcasts.send'),
    },
  }
  return { sdk, appels }
}

await blocAsync('cle : Full access lue par la liste des domaines, Sending access reconnue, absente dite', async () => {
  const bon = await B.verifierCle(B.lecteurDepuisSdk(fauxSdk().sdk))
  assert.equal(bon.acces, 'complet'); assert.equal(bon.domaine_verifie, true)
  const restreinte = fauxSdk({ domaines: () => Promise.resolve({ data: null, error: { name: 'restricted_api_key', message: 'This API key is restricted to only send emails', statusCode: 401 } }) })
  const r = await B.verifierCle(B.lecteurDepuisSdk(restreinte.sdk))
  assert.equal(r.acces, 'envoi_seulement')
  assert.equal((await B.verifierCle(null)).acces, 'absente')
  const autre = fauxSdk({ domaines: () => Promise.resolve({ data: { data: [{ name: 'autre.fr', status: 'verified' }] }, error: null }) })
  const a = await B.verifierCle(B.lecteurDepuisSdk(autre.sdk))
  assert.equal(a.acces, 'complet'); assert.equal(a.domaine_verifie, false)
  assert.ok(!B.messageResend({ name: 'x', message: 'cle re_AbC123_xyz refusee pour a@b.fr' }).includes('re_AbC'))
  assert.ok(!B.messageResend({ name: 'x', message: 'refus pour a@b.fr' }).includes('a@b.fr'))
})

await blocAsync('lecture de Resend : pages suivies, membres des segments, aucune ecriture', async () => {
  const contacts = [{ id: 'k1', email: 'A@x.fr', unsubscribed: false }, { id: 'k2', email: 'b@x.fr', unsubscribed: true }]
  const f = fauxSdk({ segments: [{ id: SEG.tous, name: B.SEGMENTS_RESEND.tous }], sujets: [{ id: 's', name: B.SUJET_RESEND.nom }], contacts, membres: { [SEG.tous]: ['k1'] } })
  const etat = await B.lireEtatResend(B.lecteurDepuisSdk(f.sdk), ['bc-1'], async () => {})
  assert.deepEqual(etat.membres, { tous: ['k1'], comptes: [] })
  assert.equal(etat.contacts[0].email, 'a@x.fr')
  assert.equal(etat.sujet?.id, 's')
  assert.ok(f.appels.every(([nom]) => /\.(list|recipients)$/.test(nom)), `ecriture pendant une lecture : ${f.appels.map((a) => a[0]).join(', ')}`)
})

await blocAsync('appliquer : import en on_conflict skip, opt_out seulement pour un existant, refus si bloquant', async () => {
  const f = fauxSdk()
  const w = B.ecrivainDepuisSdk(f.sdk)
  const cible = Array.from({ length: 30 }, (_, i) => ({ email: `m${i}@x.fr`, compte: i < 10 }))
  const etat = { ...etatVide(), segments: [{ id: 'gen', name: 'General' }] }
  const plan = B.planifierSynchro(cible, [{ email: 'm29@x.fr', resend_le: null }], etat)
  const res = await B.appliquerPlan(w, etat, plan, async () => {})
  assert.deepEqual(res.erreurs, [])
  assert.equal(res.imports_lances, 3); assert.equal(res.importes, 30); assert.deepEqual(res.emails_connus_de_resend, ['m29@x.fr'])
  const imports = f.appels.filter(([n]) => n === 'imports.create').map(([, o]) => o)
  assert.ok(imports.every((o) => o.onConflict === 'skip' && o.columnMap.email === 'email' && o.file instanceof Blob))
  assert.ok(f.appels.some(([n, o]) => n === 'topics.create' && o.defaultSubscription === 'opt_in' && o.name === B.SUJET_RESEND.nom))
  assert.equal(f.appels.filter(([n]) => n === 'segments.create').length, 2)
  assert.equal(f.appels.filter(([n]) => n === 'contacts.create').length, 0)
  // Un existant desinscrit chez nous : opt_out, jamais autre chose.
  const g = fauxSdk()
  const etat2 = etatPlein([{ id: 'k1', email: 'd@x.fr', unsubscribed: false }], { tous: ['k1'], comptes: [] })
  const plan2 = B.planifierSynchro([{ email: 'd@x.fr', compte: false }], [{ email: 'd@x.fr', resend_le: null }], etat2)
  const res2 = await B.appliquerPlan(B.ecrivainDepuisSdk(g.sdk), etat2, plan2, async () => {})
  assert.equal(res2.pousses, 1)
  const maj = g.appels.filter(([n]) => n === 'topics.update').map(([, o]) => o)
  assert.deepEqual(maj, [{ id: 'k1', topics: [{ id: 'sujet-1', subscription: 'opt_out' }] }])
  assert.ok(!g.appels.some(([n, o]) => n === 'contacts.create' || (o && JSON.stringify(o).includes('opt_in'))), 'un opt_in sur un existant')
  // Bloquant : rien n'est ecrit.
  const h = fauxSdk()
  const res3 = await B.appliquerPlan(B.ecrivainDepuisSdk(h.sdk), { ...etatVide(), importsEnCours: 1 }, B.planifierSynchro(cible, [], { ...etatVide(), importsEnCours: 1 }), async () => {})
  assert.equal(h.appels.length, 0); assert.ok(res3.erreurs.length > 0)
})

bloc('Broadcast : brouillon (send false), sujet et segment, variable de desinscription exigee, retrouve par l\'id de l\'envoi', () => {
  const e = E.construireEmail({ objet: 'O', texte: 'T', lien: null, lienDesinscription: B.VARIABLE_DESINSCRIPTION, essai: false })
  const p = B.payloadBroadcast({ segmentId: 'seg', sujetId: 'suj', expediteur: E.EXPEDITEUR_DEFAUT, repondreA: E.REPONSE_A, sujet: e.sujet, html: e.html, texte: e.texte, nom: B.nomBroadcast(ID, new Date('2026-11-19T08:00:00Z')) })
  assert.equal(p.send, false); assert.equal(p.topicId, 'suj'); assert.equal(p.segmentId, 'seg')
  assert.equal(p.name, `Annonce académie 2026-11-19 [${ID}]`)
  assert.ok(liens(p.html).includes(B.VARIABLE_DESINSCRIPTION))
  const sans = E.construireEmail({ objet: 'O', texte: 'T', lien: null, lienDesinscription: 'https://j.x/d?j=1', essai: false })
  assert.throws(() => B.payloadBroadcast({ segmentId: 's', sujetId: 't', expediteur: 'x', repondreA: 'y', sujet: sans.sujet, html: sans.html, texte: sans.texte, nom: 'n' }))
  assert.equal(B.trouverBroadcast([{ id: 'a', name: 'autre' }, { id: 'b', name: p.name }], ID)?.id, 'b')
  assert.equal(B.trouverBroadcast([{ id: 'a', name: null }], ID), null)
})

bloc('requetes de la voie Broadcast : desinscription Resend jamais annulee, aucun ; dans une chaine', () => {
  assert.ok(/reinscrit_le = null/.test(B.SQL_IMPORTER_DESINSCRITS) && /'resend'/.test(B.SQL_IMPORTER_DESINSCRITS))
  assert.ok(/statut = 'a_envoyer'/.test(B.SQL_CONFIER) && /statut = 'a_envoyer'/.test(B.SQL_SIMULER_TOUT))
  assert.ok(/resend_broadcast_id is null/.test(B.SQL_NOTER_BROADCAST), 'un id de Broadcast ne se remplace pas')
  assert.ok(/'confie'/.test(E.SQL_COMPTES_ENVOI) && /any\(\$1::text\[\]\)/.test(E.SQL_DERNIER_REEL))
  for (const [nom, sql] of Object.entries(B).filter(([k]) => k.startsWith('SQL_'))) {
    for (const chaine of sql.matchAll(/'([^']*)'/g)) assert.ok(!chaine[1].includes(';'), `${nom} : point-virgule dans une chaine`)
  }
  for (const t of [B.SUJET_RESEND.nom, B.SUJET_RESEND.description, ...Object.values(B.SEGMENTS_RESEND)]) assert.ok(!INTERDITS.test(t))
})

console.log(`\n${blocs} blocs ok`)
