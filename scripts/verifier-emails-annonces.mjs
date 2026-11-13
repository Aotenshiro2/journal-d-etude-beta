// Verification HORS LIGNE de l'email a tous les membres depuis le cockpit (13/11/2026) :
// le RENDU (HTML echappe, aucun lien du texte cliquable, seuls le bouton et la
// desinscription sont des liens), le JETON de desinscription (signe, opaque,
// falsification refusee), la GARDE de 72 h, les DROITS (envoi reel admin, forcage
// Brice seul, jamais le compte de Tab), les GROUPES, les LOTS et leur cle
// d'idempotence, la SIMULATION par defaut (rien ne part tant que
// ANNONCES_EMAIL_MODE ne vaut pas « reel »), l'envoyeur de simulation (aucune
// adresse ni lien personnel dans le journal), et le code (migration, routes).
// Fonctions pures et lecture de fichiers : aucune base, aucun reseau.
//
// Lancement (depuis apps/journal-d-etude, apres nvm) : node scripts/verifier-emails-annonces.mjs

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import * as E from '../src/lib/academie/emails-annonces.ts'

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

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261113200000_academie_emails_annonces.sql'
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
})

bloc('saisie : objet et texte obligatoires, groupe exige a l\'envoi, billet en uuid', () => {
  assert.ok('erreur' in E.lireSaisieEmail({ objet: '', texte: 'x' }, false))
  assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x', texte: '   ' }, false))
  assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x', texte: 'y' }, true))
  assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x', texte: 'y', groupe: 'tout_le_monde' }, true))
  assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x', texte: 'y', groupe: 'tous', billet_id: 'abc' }, true))
  assert.ok('erreur' in E.lireSaisieEmail({ objet: 'x'.repeat(201), texte: 'y' }, false))
  const s = E.lireSaisieEmail({ objet: ' Le  live\nde jeudi ', texte: 'a\r\nb​', groupe: 'gratuits', billet_id: ID.toUpperCase() }, true)
  assert.deepEqual(s, { objet: 'Le live de jeudi', texte: 'a\nb', groupe: 'gratuits', billetId: ID })
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
})

console.log(`\n${blocs} blocs ok`)
