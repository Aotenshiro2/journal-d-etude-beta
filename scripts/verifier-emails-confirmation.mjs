// Verifie les regles pures de l'ajout d'une adresse email sur preuve par code
// (src/lib/emails-confirmation-pur.ts, 31/10/2026), hors ligne, sans base ni
// Resend. Relit aussi les routes, le serveur et la migration pour les
// garde-fous qui ne tiennent pas dans une fonction pure.
//
//   node scripts/verifier-emails-confirmation.mjs
//
// Node 22 retire les types tout seul : le .ts est importe tel quel.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CODE_ESSAIS_MAX, CODE_VALIDITE_MINUTES, CORPS_MAX, EMAIL_MAX, ENVOIS_ADRESSE_HEURE, ENVOIS_ADRESSE_JOUR,
  ENVOIS_COMPTE_HEURE, ENVOIS_COMPTE_JOUR, ENVOIS_TOTAL_HEURE, EXPEDITEUR, SIGNATURE,
  codeCorrespond, decisionAjout, decisionConfirmation, echapper, essaisRestants, etatEssai, genererCode, hmacAdresse,
  hmacCode, htmlEmailCode, limiteAtteinte, lireCode, lireCorps, modeleEmailCode, normaliserEmail, refAdresse,
  texteEmailCode,
} from '../src/lib/emails-confirmation-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

const SECRET = 'secret-de-test-assez-long-pour-le-serveur-0123456789'
const U = '11111111-2222-3333-4444-555555555555'
const V = '99999999-8888-7777-6666-555555555555'
const lire = chemin => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const c = n => String.fromCharCode(n)

bloc('normalisation : trim + minuscules', () => {
  assert.equal(normaliserEmail('  Eleve.Demo@Exemple.FR '), 'eleve.demo@exemple.fr')
  assert.equal(normaliserEmail('a+tag@sous.domaine.co.uk'), 'a+tag@sous.domaine.co.uk')
  assert.equal(normaliserEmail("o'neil@exemple.fr"), "o'neil@exemple.fr")
  assert.equal(normaliserEmail('jean_d-x@xn--caf-dma.fr'), 'jean_d-x@xn--caf-dma.fr')
  assert.equal(normaliserEmail('a@exemple.xn--p1ai'), 'a@exemple.xn--p1ai')
  assert.equal(normaliserEmail('a@b.fr\n'), 'a@b.fr', 'retour a la ligne en bord : retire par le trim')
})

bloc('validation stricte : formats, caracteres de controle et invisibles refuses', () => {
  const refuses = [
    '', '   ', 'pas-un-email', '@exemple.fr', 'a@', 'a@b', 'a@b.c', 'a@@b.fr', 'a@b@c.fr', 'a b@c.fr', 'a@b .fr',
    'a\n@b.fr', 'a@b.fr\nBcc: x@y.fr', 'a\r\n@b.fr', 'a\t@b.fr', 'a\u0000@b.fr', 'a\u0007@b.fr', 'a\u007f@b.fr',
    // Invisibles et non-ASCII, ecrits par leur numero (aucun caractere invisible dans ce fichier) :
    // espace de largeur nulle, inversion droite-gauche, e accent, signe Kelvin, espace insecable.
    `a${c(0x200b)}@b.fr`, `a@b${c(0x200b)}.fr`, `${c(0x202e)}a@b.fr`, `${c(0xe9)}@b.fr`, `a@caf${c(0xe9)}.fr`,
    `a@${c(0x212a)}elvin.fr`, `a@b.fr${c(0xa0)}x`, `a${c(0xfeff)}@b.fr`, `a@b.fr${c(0x2028)}x`,
    '.a@b.fr', 'a.@b.fr', 'a..b@c.fr', 'a@-b.fr', 'a@b-.fr', 'a@b..fr', 'a@.b.fr', 'a@b.f1', 'a@b.123',
    '<a@b.fr>', '"a"@b.fr', 'a(b)@c.fr', 'a,b@c.fr', 'a;b@c.fr', 'a@b.fr;c', 'a@[127.0.0.1]', 'a@localhost',
    'javascript:a@b.fr', 'a/b@c.fr', 'a<script>@b.fr',
    3, null, undefined, {}, ['a@b.fr'],
  ]
  for (const x of refuses) assert.equal(normaliserEmail(x), null, JSON.stringify(x))
})

bloc('longueurs : 254 au plus, partie locale 64 au plus, entree 320 au plus', () => {
  const domaine = `${'d'.repeat(62)}.${'e'.repeat(62)}.${'f'.repeat(62)}.fr`
  const local = 'a'.repeat(254 - 1 - domaine.length)
  assert.ok(local.length <= 64)
  assert.equal(normaliserEmail(`${local}@${domaine}`)?.length, EMAIL_MAX)
  assert.equal(normaliserEmail(`${local}a@${domaine}`), null, '255 caracteres')
  assert.equal(normaliserEmail(`${'a'.repeat(64)}@b.fr`), `${'a'.repeat(64)}@b.fr`)
  assert.equal(normaliserEmail(`${'a'.repeat(65)}@b.fr`), null, 'partie locale de 65')
  assert.equal(normaliserEmail(`${' '.repeat(314)}a@b.fr`), 'a@b.fr', '320 caracteres : lue')
  assert.equal(normaliserEmail(`${' '.repeat(315)}a@b.fr`), null, 'entree de plus de 320 caracteres non lue')
  assert.equal(normaliserEmail(`a@${'b'.repeat(64)}.fr`), null, 'etiquette de 64')
})

bloc('code tape : 6 chiffres, espace ou tiret au milieu tolere', () => {
  assert.equal(lireCode('123456'), '123456')
  assert.equal(lireCode(' 012 345 '), '012345')
  assert.equal(lireCode('012-345'), '012345')
  for (const x of ['', '12345', '1234567', '12a456', '12 34 56', [0x661, 0x662, 0x663, 0x664, 0x665, 0x666].map(c).join(''), '123\n456', 123456, null, '123456'.repeat(4)]) {
    assert.equal(lireCode(x), null, JSON.stringify(x))
  }
})

bloc('corps : objet JSON de 2 000 caracteres au plus', () => {
  assert.deepEqual(lireCorps('{"email":"a@b.fr"}'), { email: 'a@b.fr' })
  assert.deepEqual(lireCorps(''), {})
  for (const x of ['[1]', 'null', '"x"', '42', '{', `{"email":"${'a'.repeat(CORPS_MAX)}"}`]) assert.equal(lireCorps(x), null, x.slice(0, 20))
})

bloc('code genere : 6 chiffres, zeros de tete, tirage varie', () => {
  const vus = new Set()
  for (let i = 0; i < 2000; i++) {
    const c = genererCode()
    assert.match(c, /^[0-9]{6}$/)
    vus.add(c)
  }
  assert.ok(vus.size > 1900, 'pas de tirage fige')
})

bloc('HMAC du code : jamais le code en clair, lie au compte, a l adresse et au secret', () => {
  const h = hmacCode(SECRET, U, 'a@b.fr', '123456')
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.ok(!h.includes('123456'))
  assert.equal(hmacCode(SECRET, U.toUpperCase(), 'a@b.fr', '123456'), h, 'uuid insensible a la casse')
  assert.notEqual(hmacCode(SECRET, V, 'a@b.fr', '123456'), h, 'autre compte')
  assert.notEqual(hmacCode(SECRET, U, 'c@b.fr', '123456'), h, 'autre adresse')
  assert.notEqual(hmacCode(SECRET, U, 'a@b.fr', '123457'), h, 'autre code')
  assert.notEqual(hmacCode(`${SECRET}x`, U, 'a@b.fr', '123456'), h, 'autre secret')
  assert.notEqual(hmacAdresse(SECRET, 'a@b.fr'), hmacCode(SECRET, U, 'a@b.fr', ''), 'cles derivees par usage')
  assert.match(hmacAdresse(SECRET, 'a@b.fr'), /^[0-9a-f]{64}$/)
  assert.equal(refAdresse(hmacAdresse(SECRET, 'a@b.fr')).length, 8)
})

bloc('comparaison a temps constant : juste, faux, HMAC absent ou mal forme', () => {
  const h = hmacCode(SECRET, U, 'a@b.fr', '000123')
  assert.equal(codeCorrespond(SECRET, U, 'a@b.fr', '000123', h), true)
  assert.equal(codeCorrespond(SECRET, U, 'a@b.fr', '000124', h), false)
  assert.equal(codeCorrespond(SECRET, V, 'a@b.fr', '000123', h), false, 'le code d un compte ne sert pas a un autre')
  assert.equal(codeCorrespond(SECRET, U, 'x@b.fr', '000123', h), false, 'ni pour une autre adresse')
  for (const x of [null, '', 'zz', h.slice(0, 62), h.toUpperCase(), `${h}00`]) {
    assert.equal(codeCorrespond(SECRET, U, 'a@b.fr', '000123', x), false, String(x).slice(0, 10))
  }
  const src = lire('src/lib/emails-confirmation-pur.ts')
  assert.match(src, /timingSafeEqual\(a, c\)/, 'timingSafeEqual sur les octets')
})

const AUCUN_ENVOI = { compteHeure: 0, compteJour: 0, adresseHeure: 0, adresseJour: 0, totalHeure: 0 }
const etat = (o = {}) => ({
  email: 'autre@b.fr', emailConnexion: 'moi@b.fr', verifieeIci: false, verifieeAilleurs: false, connexionAilleurs: false,
  envois: AUCUN_ENVOI, ...o,
})

bloc('plafonds : 5 et 10 par compte, 3 et 5 par adresse, 100 au total', () => {
  assert.deepEqual(
    [ENVOIS_COMPTE_HEURE, ENVOIS_COMPTE_JOUR, ENVOIS_ADRESSE_HEURE, ENVOIS_ADRESSE_JOUR, ENVOIS_TOTAL_HEURE],
    [5, 10, 3, 5, 100])
  assert.equal(limiteAtteinte(AUCUN_ENVOI), false)
  assert.equal(limiteAtteinte({ ...AUCUN_ENVOI, compteHeure: 4, compteJour: 9, adresseHeure: 2, adresseJour: 4, totalHeure: 99 }), false, 'juste sous chaque plafond')
  for (const [k, v] of [['compteHeure', 5], ['compteJour', 10], ['adresseHeure', 3], ['adresseJour', 5], ['totalHeure', 100]]) {
    assert.equal(limiteAtteinte({ ...AUCUN_ENVOI, [k]: v }), true, k)
  }
})

bloc('decision d ajout : connexion, deja verifiee, autre compte, plafond, sinon code', () => {
  assert.equal(decisionAjout(etat()), 'ok')
  assert.equal(decisionAjout(etat({ email: 'moi@b.fr' })), 'connexion')
  assert.equal(decisionAjout(etat({ email: 'moi@b.fr', emailConnexion: ' Moi@B.fr ' })), 'connexion')
  assert.equal(decisionAjout(etat({ verifieeIci: true })), 'deja_verifiee')
  assert.equal(decisionAjout(etat({ verifieeAilleurs: true })), 'rattachee')
  assert.equal(decisionAjout(etat({ connexionAilleurs: true })), 'rattachee', 'meme refus : on ne dit pas lequel')
  assert.equal(decisionAjout(etat({ envois: { ...AUCUN_ENVOI, adresseHeure: 3 } })), 'limite')
  assert.equal(decisionAjout(etat({ emailConnexion: null })), 'ok', 'compte sans email lisible')
  // L'ordre : un refus de fond passe avant le plafond (le plafond ne masque pas un « deja rattache »).
  assert.equal(decisionAjout(etat({ verifieeAilleurs: true, envois: { ...AUCUN_ENVOI, compteHeure: 9 } })), 'rattachee')
})

bloc('essais : 5 par code, expire, aucun code en cours', () => {
  assert.equal(CODE_ESSAIS_MAX, 5)
  assert.equal(CODE_VALIDITE_MINUTES, 15)
  const h = 'a'.repeat(64)
  assert.equal(etatEssai(null), 'aucun')
  assert.equal(etatEssai({ codeHmac: null, expire: false, essais: 0 }), 'aucun', 'envoi rate ou code efface')
  assert.equal(etatEssai({ codeHmac: h, expire: false, essais: 0 }), 'essai')
  assert.equal(etatEssai({ codeHmac: h, expire: false, essais: 4 }), 'essai')
  assert.equal(etatEssai({ codeHmac: h, expire: false, essais: 5 }), 'epuise')
  assert.equal(etatEssai({ codeHmac: h, expire: true, essais: 5 }), 'epuise', 'epuise passe avant expire')
  assert.equal(etatEssai({ codeHmac: h, expire: true, essais: 0 }), 'expire')
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(essaisRestants), [4, 3, 2, 1, 0, 0])
})

bloc('confirmation : une adresse verifiee ou de connexion d un autre compte ne bouge jamais', () => {
  assert.equal(decisionConfirmation({ verifieeAilleurs: false, connexionAilleurs: false }), 'ok')
  assert.equal(decisionConfirmation({ verifieeAilleurs: true, connexionAilleurs: false }), 'rattachee')
  assert.equal(decisionConfirmation({ verifieeAilleurs: false, connexionAilleurs: true }), 'rattachee')
})

bloc('email : seul texte du membre = l adresse echappee, aucun lien, vouvoiement et signature', () => {
  const m = modeleEmailCode('a@b.fr', '042913')
  assert.equal(m.code, '042913')
  assert.match(m.sujet, /042913/)
  const html = htmlEmailCode(m)
  const texte = texteEmailCode(m)
  assert.ok(!/<a\b|href=|https?:\/\//i.test(html), 'aucun lien dans le HTML')
  assert.ok(!/https?:\/\//i.test(texte), 'aucune adresse web dans le texte')
  assert.match(html, /042913/)
  assert.match(texte, /042913/)
  assert.match(texte, /a@b\.fr/)
  assert.match(texte, /Vous n'avez rien demandé/)
  assert.ok(texte.endsWith(SIGNATURE.join('\n')))
  assert.equal(EXPEDITEUR, 'AO Knowledge <support@aoknowledge.com>')
  // Une adresse qui contient une apostrophe (valide) sort echappee.
  const h2 = htmlEmailCode(modeleEmailCode("o'neil@b.fr", '000000'))
  assert.match(h2, /o&#39;neil@b\.fr/)
  assert.ok(!h2.includes("o'neil"))
  assert.equal(echapper('<b>"&\''), '&lt;b&gt;&quot;&amp;&#39;')
  // Typographie : ni tiret long, ni points de suspension en un caractere, ni espace insecable.
  const interdits = [0x2013, 0x2014, 0x2026, 0xa0, 0x202f, 0x2019, 0x200b].map(c)
  for (const t of [m.sujet, ...m.avant, ...m.apres]) assert.ok(!interdits.some(x => t.includes(x)), t)
})

bloc('routes : jeton obligatoire, compte du jeton, aucun email ni code dans les logs', () => {
  for (const r of ['src/app/api/compte/emails/ajouter/route.ts', 'src/app/api/compte/emails/confirmer/route.ts']) {
    const src = lire(r)
    assert.match(src, /compteDuJeton\(req\)/, r)
    assert.match(src, /refus\('jeton', 401\)/, r)
    assert.match(src, /lireCorps\(/, r)
    assert.match(src, /normaliserEmail\(corps\?\.email\)/, r)
    assert.ok(!/console\.[a-z]+\([^)]*\$\{email\}/.test(src), `${r} : email dans un log`)
    assert.ok(!/console\.[a-z]+\([^)]*\$\{code\}/.test(src), `${r} : code dans un log`)
  }
  const serveur = lire('src/lib/emails-confirmation.ts')
  for (const ligne of serveur.split('\n').filter(l => /console\.(log|info|warn|error)/.test(l))) {
    assert.ok(!/\$\{email\}|\$\{code\}|messageErreur|err\.message/.test(ligne), ligne.trim())
  }
  assert.match(serveur, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(serveur, /RESEND_API_KEY_LIVECLUB\?\.trim\(\) \|\| process\.env\.RESEND_API_KEY/)
  assert.match(serveur, /on conflict \(email\) do update set verified = true\s+where profile_emails\.profile_id = excluded\.profile_id/,
    'le upsert ne modifie qu une ligne du compte')
  assert.match(serveur, /profile_id <> \$\{userId\}::uuid and verified = false/, 'seules les lignes NON verifiees des autres comptes partent')
  assert.match(serveur, /oublierDroitsDuCompte\(userId\)/)
})

bloc('migration : tables, droits explicites, plus d insertion depuis le navigateur, aucun point-virgule en commentaire', () => {
  const sql = readFileSync(new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261031190000_profile_emails_confirmation.sql', import.meta.url), 'utf8')
  const commentaires = sql.split('\n').filter(l => l.trim().startsWith('--'))
  assert.equal(commentaires.filter(l => l.includes(';')).length, 0, 'point-virgule dans un commentaire')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  for (const chaine of code.match(/'[^']*'/g) ?? []) assert.ok(!chaine.includes(';'), `point-virgule dans ${chaine}`)
  assert.match(code, /create table if not exists public\.profile_emails_attente/)
  assert.match(code, /create table if not exists public\.profile_emails_envois/)
  assert.match(code, /revoke all on table public\.profile_emails_attente from anon, authenticated/)
  assert.match(code, /grant select \(profile_id, email, envoye_le, expire_le, cree_le\) on public\.profile_emails_attente to authenticated/)
  assert.ok(!/grant select[^;]*code_hmac/.test(code), 'code_hmac jamais lisible par authenticated')
  assert.ok(!/grant (insert|update)[^;]*profile_emails_attente/.test(code), 'authenticated n ecrit pas d attente')
  assert.match(code, /revoke all on table public\.profile_emails_envois from anon, authenticated/)
  assert.ok(!/grant [^;]*profile_emails_envois/.test(code), 'compteur ferme')
  assert.match(code, /drop policy if exists "own emails insert" on public\.profile_emails/)
  assert.match(code, /revoke insert on public\.profile_emails from authenticated/)
  assert.ok(!/profile_emails_email_key/.test(code), 'la contrainte unique sur email ne change pas')
  assert.ok(!/handle_new_user/.test(code), 'handle_new_user ne change pas')
})

bloc('site : plus aucune insertion directe dans profile_emails', () => {
  let src
  try {
    src = readFileSync(new URL('../../../sites/Aoknowledgecom/v3/src/espace/Blocs.tsx', import.meta.url), 'utf8')
  } catch {
    console.log('    (site absent a cote : bloc saute)')
    return
  }
  assert.ok(!/from\('profile_emails'\)\.insert/.test(src))
})

console.log(`\n${n} blocs ok`)
