// Verifie la connexion par adresse (14/11/2026) : /api/connexion/adresse et
// /api/connexion/envoi, HORS LIGNE. La partie pure (CORS en liste blanche,
// origine du lien, HMAC, lecture des reponses de la base, l'email, le deroule
// avec une fausse base, un faux Supabase et un faux Resend), puis les routes,
// le serveur et le middleware relus pour les garde-fous qui ne tiennent pas
// dans une fonction pure. Aucun appel reseau, aucune base, aucun email.
//
//   node scripts/verifier-connexion-adresse.mjs
//
// Node 22 retire les types tout seul : les .ts sont importes tels quels.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ORIGINES, ORIGINE_DEFAUT, PLANCHER_MS, SUJET, EXPEDITEUR,
  baseDuLien, cheminRetourSur, enTetesCors, envoyer, hmacAdresse, hmacIp, lireEnvoiSql, lireJetonSupabase,
  lireReconnaissanceSql, modeleEmailConnexion, origineAutorisee, plancher, reconnaitre, urlDuLien,
} from '../src/lib/connexion-adresse-pur.ts'
import { normaliserEmail } from '../src/lib/emails-confirmation-pur.ts'

const lire = chemin => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const INTERDITS = new RegExp(`[${[0x2014, 0x2013, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0x200b].map(x => String.fromCharCode(x)).join('')}]`)

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }

const SECRET = 'secret-factice-du-serveur-'.padEnd(48, 'x')
const EMAIL = normaliserEmail(' Marie.Dupont@Exemple.fr ')
const IP = '203.0.113.7'
const PERSO = [/marie/i, /dupont/i, /203\.0\.113\.7/, /482913/, /aaaaaaaa/]

function fauxJournal() {
  const lignes = []
  return { lignes, journal: l => lignes.push(l), propre() { for (const l of lignes) for (const p of PERSO) assert.ok(!p.test(l), `log : ${l}`) } }
}
const codeErreur = e => (e && e.code) || 'erreur'

// ------------------------------------------------------------------ CORS et lien

await bloc('CORS : liste blanche stricte, toute autre origine refusee (null : 403 sans en-tete)', () => {
  for (const o of ['https://aoknowledge.com', 'https://www.aoknowledge.com', 'https://academie.melaniechart.com']) {
    const h = enTetesCors(o)
    assert.equal(h['Access-Control-Allow-Origin'], o)
    assert.equal(h['Access-Control-Allow-Methods'], 'POST, OPTIONS')
    assert.equal(h['Access-Control-Allow-Headers'], 'Content-Type')
    assert.equal(h.Vary, 'Origin')
  }
  for (const o of [null, undefined, '', 'null', 'https://evil.example', 'https://aoknowledge.com.evil.example', 'http://aoknowledge.com',
    'https://aoknowledge.com/', 'https://journal.aoknowledge.com', 'https://masterclass.aoknowledge.com', 'http://localhost:5173', 'constructor', 'toString']) {
    assert.equal(enTetesCors(o), null, String(o))
    assert.equal(origineAutorisee(o), false, String(o))
  }
  assert.deepEqual(Object.keys(ORIGINES).sort(), ['https://academie.melaniechart.com', 'https://aoknowledge.com', 'https://www.aoknowledge.com'])
})

await bloc('origine du lien : celle demandee si autorisee, sinon celle de la requete, sinon aoknowledge.com', () => {
  assert.equal(baseDuLien('https://academie.melaniechart.com', 'https://aoknowledge.com'), 'https://academie.melaniechart.com/auth/lien')
  assert.equal(baseDuLien('https://evil.example', 'https://www.aoknowledge.com'), 'https://www.aoknowledge.com/auth/lien')
  assert.equal(baseDuLien(undefined, 'https://evil.example'), 'https://aoknowledge.com/auth/lien')
  assert.equal(baseDuLien(42, null), `${ORIGINE_DEFAUT}/auth/lien`)
  assert.equal(cheminRetourSur('/academie/la-formation'), '/academie/la-formation')
  for (const v of ['//evil.example', 'https://evil.example', '/\\evil', '/a\tb', '', 'x'.repeat(301), 12, null]) assert.equal(cheminRetourSur(v), null, String(v))
  assert.equal(urlDuLien('https://aoknowledge.com/auth/lien', '/academie', 'abc_DEF-123', 'signup'),
    'https://aoknowledge.com/auth/lien?retour=%2Facademie#token_hash=abc_DEF-123&type=signup')
  assert.equal(urlDuLien('https://aoknowledge.com/auth/lien', null, 'abc', 'magiclink'), 'https://aoknowledge.com/auth/lien#token_hash=abc&type=magiclink')
})

await bloc('HMAC : 64 hexadecimaux, une cle par usage, jamais la valeur en clair', () => {
  const a = hmacAdresse(SECRET, EMAIL), i = hmacIp(SECRET, IP)
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.match(i, /^[0-9a-f]{64}$/)
  assert.notEqual(hmacAdresse(SECRET, IP), hmacIp(SECRET, IP), 'usages differents')
  assert.notEqual(hmacAdresse('autre-secret-'.padEnd(48, 'y'), EMAIL), a)
  assert.match(hmacIp(SECRET, null), /^[0-9a-f]{64}$/)
})

await bloc('reponses de la base ramenees au contrat', () => {
  for (const r of ['google', 'connue', 'inconnue', 'rattachee']) assert.equal(lireReconnaissanceSql(r), r)
  for (const r of ['limite', 'invalide', 'admin', null, 3]) assert.equal(lireReconnaissanceSql(r), 'simple')
  assert.deepEqual(lireEnvoiSql('ok'), { issue: 'ok' })
  assert.deepEqual(lireEnvoiSql('delai:42'), { issue: 'delai', secondes: 42 })
  assert.deepEqual(lireEnvoiSql('delai:0'), { issue: 'delai', secondes: 1 })
  for (const r of ['limite', 'plafond', 'rattachee', 'inconnue', 'invalide']) assert.deepEqual(lireEnvoiSql(r), { issue: r })
  for (const r of ['delai:', 'delai:abc', 'ok ', 'indisponible', null]) assert.equal(lireEnvoiSql(r), null, String(r))
  assert.deepEqual(lireJetonSupabase({ email_otp: '482913', hashed_token: 'a'.repeat(56), verification_type: 'signup' }), { code: '482913', jeton: 'a'.repeat(56), type: 'signup' })
  assert.equal(lireJetonSupabase({ email_otp: '482913', hashed_token: 'a'.repeat(56), verification_type: 'bizarre' }).type, 'magiclink')
  for (const p of [null, {}, { email_otp: '12', hashed_token: 'a'.repeat(56) }, { email_otp: '482913', hashed_token: 'a b' }]) assert.equal(lireJetonSupabase(p), null)
})

await bloc('l email : objet fixe (cite par la page du site), code, bouton, HTML echappe', () => {
  const url = 'https://aoknowledge.com/auth/lien?retour=%2Facademie#token_hash=abc&type=magiclink'
  const m = modeleEmailConnexion({ code: '482913', url })
  assert.equal(SUJET, 'Ton code de connexion AO Knowledge')
  assert.equal(m.sujet, SUJET)
  assert.equal(EXPEDITEUR, 'AO Knowledge <support@aoknowledge.com>')
  assert.ok(m.html.includes('482913') && m.texte.includes('482913'))
  assert.ok(m.html.includes('href="https://aoknowledge.com/auth/lien?retour=%2Facademie#token_hash=abc&amp;type=magiclink"'))
  assert.ok(m.texte.includes(url))
  assert.match(m.texte, /seul le dernier email reçu fonctionne/)
  const piege = modeleEmailConnexion({ code: '<b>1', url: 'https://x"onload="y' })
  assert.ok(!piege.html.includes('<b>1') && !piege.html.includes('"onload="'))
  assert.ok(!INTERDITS.test(m.html) && !INTERDITS.test(m.texte))
})

// ------------------------------------------------------------------ reconnaitre

await bloc('reconnaitre : une reponse, adresse et IP en HMAC, simple quand rien ne repond, rien de personnel au journal', async () => {
  const j = fauxJournal()
  const appels = []
  const r = await reconnaitre({ email: EMAIL, ip: IP, secret: SECRET }, {
    rpc: async (...a) => { appels.push(a); return 'google' }, journal: j.journal, codeErreur,
  })
  assert.deepEqual(r, { reponse: 'google' })
  assert.equal(appels.length, 1)
  assert.equal(appels[0][0], 'marie.dupont@exemple.fr')
  assert.equal(appels[0][1], hmacIp(SECRET, IP))
  assert.equal(appels[0][2], hmacAdresse(SECRET, EMAIL))
  for (const [rendu, attendu] of [['limite', 'simple'], ['connue', 'connue'], ['rattachee', 'rattachee']]) {
    assert.deepEqual(await reconnaitre({ email: EMAIL, ip: IP, secret: SECRET }, { rpc: async () => rendu, journal: j.journal, codeErreur }), { reponse: attendu })
  }
  const panne = await reconnaitre({ email: EMAIL, ip: IP, secret: SECRET }, {
    rpc: async () => { throw Object.assign(new Error('marie.dupont@exemple.fr introuvable'), { code: 'PGRST202' }) }, journal: j.journal, codeErreur,
  })
  assert.deepEqual(panne, { reponse: 'simple' })
  assert.ok(j.lignes.some(l => l.includes('PGRST202')))
  let appele = false
  const rpc = async () => { appele = true; return 'connue' }
  assert.deepEqual(await reconnaitre({ email: null, ip: IP, secret: SECRET }, { rpc, journal: j.journal, codeErreur }), { reponse: 'simple' })
  assert.deepEqual(await reconnaitre({ email: EMAIL, ip: IP, secret: null }, { rpc, journal: j.journal, codeErreur }), { reponse: 'simple' })
  assert.equal(appele, false, 'sans adresse lisible ni secret : aucun appel a la base')
  assert.equal(normaliserEmail('pas une adresse'), null)
  j.propre()
})

// ------------------------------------------------------------------ envoyer

const JETON = { email_otp: '482913', hashed_token: 'a'.repeat(56), verification_type: 'signup' }
function monde(decision, { jeton = JETON, panneSupabase = false, panneResend = false } = {}) {
  const m = { ordre: [], rpc: [], liens: [], emails: [] }
  const j = fauxJournal()
  m.j = j
  m.deps = {
    rpc: async (...a) => { m.ordre.push('rpc'); m.rpc.push(a); return decision },
    genererLien: async (email, donnees) => { m.ordre.push('lien'); m.liens.push({ email, donnees }); if (panneSupabase) throw Object.assign(new Error('x'), { code: 'unexpected_failure' }); return jeton },
    envoyerEmail: async (email, mail) => { m.ordre.push('email'); m.emails.push({ email, mail }); if (panneResend) throw Object.assign(new Error('x'), { code: 'validation_error' }) },
    journal: j.journal,
    codeErreur,
  }
  return m
}
const entree = (x = {}) => ({ email: EMAIL, ip: IP, secret: SECRET, resend: true, creer: false, newsletter: false, retour: '/academie/la-formation', base: 'https://academie.melaniechart.com/auth/lien', ...x })

await bloc('envoyer : la base decide, puis generateLink magiclink, puis Resend (code et lien sans PKCE)', async () => {
  const m = monde('ok')
  assert.deepEqual(await envoyer(entree({ creer: true, newsletter: true }), m.deps), { envoi: 'ok' })
  assert.deepEqual(m.ordre, ['rpc', 'lien', 'email'])
  assert.equal(m.rpc[0][3], true, 'p_creer')
  assert.deepEqual(m.liens[0], { email: 'marie.dupont@exemple.fr', donnees: { newsletter_subscribed: true } })
  const { mail } = m.emails[0]
  assert.equal(m.emails[0].email, 'marie.dupont@exemple.fr')
  assert.equal(mail.sujet, SUJET)
  assert.ok(mail.texte.includes(`https://academie.melaniechart.com/auth/lien?retour=%2Facademie%2Fla-formation#token_hash=${'a'.repeat(56)}&type=signup`))
  m.j.propre()
  const sans = monde('ok')
  await envoyer(entree({ creer: false, newsletter: true }), sans.deps)
  assert.equal(sans.liens[0].donnees, null, 'la case ne compte que pour un compte cree')
})

await bloc('envoyer : un refus de la base n appelle ni generateLink ni Resend (pas de second compte)', async () => {
  for (const [rendu, attendu] of [
    ['delai:42', { envoi: 'delai', secondes: 42 }], ['rattachee', { envoi: 'rattachee' }], ['inconnue', { envoi: 'inconnue' }],
    ['plafond', { envoi: 'plafond' }], ['limite', { envoi: 'limite' }], ['invalide', { envoi: 'invalide' }], ['bizarre', { envoi: 'indisponible' }],
  ]) {
    const m = monde(rendu)
    assert.deepEqual(await envoyer(entree({ creer: true }), m.deps), attendu, rendu)
    assert.deepEqual(m.ordre, ['rpc'], `${rendu} : la base seule`)
    m.j.propre()
  }
})

await bloc('envoyer : pannes et configuration incomplete : indisponible (la page passe au repli)', async () => {
  let m = monde('ok', { panneSupabase: true })
  assert.deepEqual(await envoyer(entree(), m.deps), { envoi: 'indisponible' })
  assert.deepEqual(m.ordre, ['rpc', 'lien'])
  m = monde('ok', { jeton: { email_otp: '', hashed_token: '' } })
  assert.deepEqual(await envoyer(entree(), m.deps), { envoi: 'indisponible' })
  assert.equal(m.emails.length, 0)
  m = monde('ok', { panneResend: true })
  assert.deepEqual(await envoyer(entree(), m.deps), { envoi: 'indisponible' })
  assert.ok(m.j.lignes.some(l => l.includes('resend validation_error')))
  m.j.propre()
  for (const x of [{ resend: false }, { secret: null }]) {
    m = monde('ok')
    assert.deepEqual(await envoyer(entree(x), m.deps), { envoi: 'indisponible' })
    assert.equal(m.ordre.length, 0, 'aucun appel sans configuration')
  }
  m = monde('ok')
  assert.deepEqual(await envoyer(entree({ email: null }), m.deps), { envoi: 'invalide' })
  assert.equal(m.ordre.length, 0)
  m = monde('ok')
  m.deps.rpc = async () => { throw Object.assign(new Error('x'), { code: 'PGRST202' }) }
  assert.deepEqual(await envoyer(entree(), m.deps), { envoi: 'indisponible' })
})

await bloc('meme delai minimal : plancher', async () => {
  assert.equal(PLANCHER_MS, 700)
  const t = Date.now()
  await plancher(t, 60)
  assert.ok(Date.now() - t >= 55)
  const t2 = Date.now()
  await plancher(t2 - 1000, 60)
  assert.ok(Date.now() - t2 < 30, 'deja passe : pas d attente')
})

// ------------------------------------------------------------------ relectures

await bloc('routes : origine hors liste = 403 sans en-tete (preflight compris), corps lu, plancher, 200', () => {
  for (const f of ['src/app/api/connexion/adresse/route.ts', 'src/app/api/connexion/envoi/route.ts']) {
    const s = lire(f)
    assert.match(s, /export function OPTIONS\(req: NextRequest\) \{\n  const cors = enTetesCors\(req\.headers\.get\('origin'\)\)\n  return new NextResponse\(null, \{ status: cors \? 204 : 403, headers: cors \?\? \{\} \}\)/)
    assert.match(s, /if \(!cors\) return new NextResponse\(null, \{ status: 403 \}\)/)
    assert.match(s, /await plancher\(debut\)/)
    assert.match(s, /ipDuClient\(req\.headers\.get\('x-forwarded-for'\), req\.headers\.get\('x-real-ip'\)\)/)
    assert.match(s, /normaliserEmail\(corps\?\.email\)/)
    assert.ok(!/console\./.test(s), 'aucun log dans la route')
    assert.ok(!INTERDITS.test(s), f)
  }
  assert.match(lire('src/app/api/connexion/envoi/route.ts'), /base: baseDuLien\(corps\?\.origine, origin\)/)
})

await bloc('serveur : fonctions SQL par la cle de service, generateLink magiclink, Resend LIVECLUB puis RESEND_API_KEY', () => {
  const s = lire('src/lib/connexion-adresse.ts')
  assert.match(s, /rpc\('aok_connexion_reconnaitre', \{ p_email: e, p_cle_ip: cleIp, p_cle_email: cleEmail \}\)/)
  assert.match(s, /rpc\('aok_connexion_envoi', \{ p_email: e, p_cle_ip: cleIp, p_cle_email: cleEmail, p_creer: creer \}\)/)
  assert.match(s, /type: 'magiclink'/)
  assert.equal((s.match(/generateLink\(/g) ?? []).length, 1)
  assert.match(s, /process\.env\.RESEND_API_KEY_LIVECLUB\?\.trim\(\) \|\| process\.env\.RESEND_API_KEY\?\.trim\(\)/)
  assert.ok(!/console\.(log|warn|error)/.test(s), 'un seul journal, console.info, par le pur')
  assert.ok(!INTERDITS.test(s))
  const p = lire('src/lib/connexion-adresse-pur.ts')
  assert.ok(!/from '\.|from "\./.test(p), 'aucun import relatif dans le pur')
  assert.ok(!INTERDITS.test(p))
})

await bloc('middleware : les deux routes publiques, en chemin EXACT', () => {
  const m = lire('middleware.ts')
  assert.match(m, /pathname === '\/api\/connexion\/adresse' \|\| pathname === '\/api\/connexion\/envoi'/)
  assert.ok(!m.includes("'/api/connexion'"), 'pas de prefixe ouvert')
})

console.log(`\n${n} blocs ok`)
