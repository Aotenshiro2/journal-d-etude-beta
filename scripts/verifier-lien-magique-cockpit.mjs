// Verifie la connexion au cockpit par lien avec toute adresse verifiee (05/11),
// HORS LIGNE : une fausse base (comptes, profile_emails, allowlist, journal des
// demandes) et un faux Supabase (generateLink qui se comporte comme GoTrue :
// 'magiclink' sur une adresse inconnue CREE un compte, 'recovery' refuse).
// Aucun appel reseau, aucune base, aucun email, aucun appel d'eval.
// Relit aussi les routes, le serveur, le middleware, la migration et les pages
// du cockpit pour les garde-fous qui ne tiennent pas dans une fonction pure.
//
//   node scripts/verifier-lien-magique-cockpit.mjs
//
// Node 22 retire les types tout seul : les .ts sont importes tels quels.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ALERTE_INTERVALLE_MINUTES, CHEMIN_LIEN, DEMANDES_ADRESSE_HEURE, DEMANDES_ADRESSE_JOUR, DEMANDES_IP_HEURE, DEMANDES_IP_JOUR,
  DEMANDES_TOTAL_HEURE, EXPEDITEUR, LIEN_VALIDITE_MINUTES, MESSAGE_NEUTRE, RAFALE_HEURE, TYPE_JETON_SUPABASE, URL_COCKPIT_DEFAUT,
  baseCockpit, decisionAlerte, decisionCompte, genererJeton, hmacAdresse, hmacIp, hmacLien, htmlEmailLien, limiteAtteinte,
  lireJeton, memeHmac, modeleEmailLien, momentParis, ouvrirLien, texteAlerte, texteEmailLien, traiterDemande, urlDuLien,
} from '../src/lib/cockpit-lien-magique-pur.ts'
import { lireCorps, normaliserEmail } from '../src/lib/emails-confirmation-pur.ts'

let n = 0
const blocs = []
const bloc = (nom, f) => blocs.push([nom, f])

const lire = chemin => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
// Tirets longs, points de suspension, guillemets courbes, espace insecable,
// espace de largeur nulle : ecrits par leur numero (aucun dans ce fichier).
const INTERDITS = new RegExp(`[${[0x2014, 0x2013, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0xa0, 0x200b].map(x => String.fromCharCode(x)).join('')}]`)
/** Le jeton d'un lien d'email : dans le fragment (#lien=), comme le lit AuthLienPage. */
const lienDe = url => new URLSearchParams(url.hash.replace(/^#/, '')).get('lien')
const SECRET = 'secret-de-test-assez-long-pour-le-serveur-0123456789'
const MEL = '11111111-2222-3333-4444-555555555555'
const BRICE = '22222222-3333-4444-5555-666666666666'
const VIDE = '33333333-4444-5555-6666-777777777777' // le compte vide cree par Google le 05/11
const MEMBRE = '44444444-5555-6666-7777-888888888888' // un membre du site, hors allowlist
const YAHOO = 'melaniesommer93@yahoo.com'
const GMAIL = 'sommermelanie1993@gmail.com'
const AUTRE_MEL = 'mel.ancienne@exemple.fr' // ajoutee sans preuve
const BRICE_MAIL = 'brice.d@aoknowledge.com'
const MEMBRE_MAIL = 'eleve.demo@exemple.fr'
const MEMBRE_SECOND = 'eleve.second@exemple.fr'
const IP = '203.0.113.7'

// ---------------------------------------------------------------------------
// La fausse base et le faux Supabase
// ---------------------------------------------------------------------------

function monde() {
  const m = {
    maintenant: new Date('2026-11-05T13:32:00Z'),
    users: [
      { id: MEL, email: YAHOO, confirme: true },
      { id: BRICE, email: BRICE_MAIL, confirme: true },
      { id: MEMBRE, email: MEMBRE_MAIL, confirme: true },
    ],
    profileEmails: [
      { profile_id: MEL, email: YAHOO, verified: true },
      { profile_id: MEL, email: GMAIL, verified: true },
      { profile_id: MEL, email: AUTRE_MEL, verified: false },
      { profile_id: BRICE, email: BRICE_MAIL, verified: true },
      { profile_id: MEMBRE, email: MEMBRE_MAIL, verified: true },
      { profile_id: MEMBRE, email: MEMBRE_SECOND, verified: true },
    ],
    allowlist: new Set([MEL, BRICE]),
    demandes: [],
    emails: [],
    alertes: [],
    logs: [],
    generateLink: [],
    panne: { email: false, base: false, generation: null },
  }
  const avant = ms => new Date(m.maintenant.getTime() - ms)
  const tick = () => new Promise(r => setTimeout(r, 0))
  let verrou = Promise.resolve()

  const tx = {
    async compter(emailHmac, ipHmac) {
      await tick()
      if (m.panne.base) throw Object.assign(new Error(`relation absente pour ${GMAIL}`), { code: 'P2010', meta: { code: '42P01' } })
      const jour = m.demandes.filter(d => d.cree_le > avant(86_400_000))
      const heure = jour.filter(d => d.cree_le > avant(3_600_000))
      const comptees = l => l.filter(d => d.issue !== 'limite')
      return {
        adresseHeure: comptees(heure).filter(d => d.email_hmac === emailHmac).length,
        adresseJour: comptees(jour).filter(d => d.email_hmac === emailHmac).length,
        ipHeure: comptees(heure).filter(d => d.ip_hmac === ipHmac).length,
        ipJour: comptees(jour).filter(d => d.ip_hmac === ipHmac).length,
        totalHeure: comptees(heure).length,
        toutesHeure: heure.length,
        limitesHeure: heure.filter(d => d.issue === 'limite').length,
        envoyesHeure: heure.filter(d => d.issue === 'envoye').length,
        alerteRecente: heure.some(d => d.alerte && d.cree_le > avant(ALERTE_INTERVALLE_MINUTES * 60_000)),
      }
    },
    async candidats(email) {
      await tick()
      const ids = new Set([
        ...m.users.filter(u => u.email.toLowerCase() === email).map(u => u.id),
        ...m.profileEmails.filter(p => p.email === email).map(p => p.profile_id),
      ])
      return m.users.filter(u => ids.has(u.id)).map(u => ({
        userId: u.id,
        autorise: m.allowlist.has(u.id),
        lien: u.email.toLowerCase() === email ? 'connexion'
          : m.profileEmails.some(p => p.profile_id === u.id && p.email === email && p.verified) ? 'verifiee' : 'non_verifiee',
        connexionConfirmee: u.confirme,
      }))
    },
    async consigner(l) {
      await tick()
      m.demandes.push({
        cree_le: new Date(m.maintenant), email_hmac: l.emailHmac, ip_hmac: l.ipHmac, issue: l.issue, user_id: l.userId,
        par_connexion: l.parConnexion, lien_hmac: l.lienHmac,
        expire_le: l.validiteMinutes === null ? null : new Date(m.maintenant.getTime() + l.validiteMinutes * 60_000),
        ouvert_le: null, alerte: l.alerte,
      })
    },
  }

  // Le faux Supabase : le comportement de GoTrue pour generateLink.
  const supabase = {
    generateLink({ type, email }) {
      m.generateLink.push({ type, email })
      const u = m.users.find(x => x.email.toLowerCase() === email.toLowerCase())
      if (!u) {
        if (type === 'magiclink' || type === 'signup') {
          const cree = { id: `cree-${m.users.length}`, email, confirme: false }
          m.users.push(cree)
          return { data: { user: { id: cree.id }, properties: { hashed_token: 'h-cree', verification_type: 'signup' } }, error: null }
        }
        return { data: { user: null, properties: null }, error: { status: 404, code: 'user_not_found' } }
      }
      return { data: { user: { id: u.id }, properties: { hashed_token: `th-${u.id}-${m.generateLink.length}`, verification_type: type } }, error: null }
    },
  }

  m.portsDemande = {
    secret: SECRET,
    urlCockpit: URL_COCKPIT_DEFAUT,
    maintenant: () => new Date(m.maintenant),
    jeton: genererJeton,
    dansVerrou: f => {
      const r = verrou.then(() => f(tx))
      verrou = r.catch(() => undefined)
      return r
    },
    async envoyerEmail(destinataire, modele) {
      await tick()
      if (m.panne.email) return { ok: false, erreur: 'Resend : rate_limit_exceeded' }
      m.emails.push({ destinataire, modele })
      return { ok: true }
    },
    async envoiRate(lienHmac) {
      for (const d of m.demandes) if (d.lien_hmac === lienHmac && d.issue === 'envoye') { d.issue = 'envoi_rate'; d.lien_hmac = null }
    },
    async alerter(texte) { m.alertes.push(texte) },
    journal: ligne => m.logs.push(ligne),
    codeErreur: err => (err?.meta?.code ? String(err.meta.code) : 'erreur'),
  }

  m.portsOuverture = {
    secret: SECRET,
    async consommer(lienHmac) {
      await tick()
      const d = m.demandes.find(x => x.lien_hmac === lienHmac)
      if (!d) return { etat: 'inconnu' }
      if (d.issue === 'envoye' && !d.ouvert_le && d.expire_le > m.maintenant && d.user_id) {
        d.ouvert_le = new Date(m.maintenant)
        return { etat: 'ok', userId: d.user_id, emailHmac: d.email_hmac }
      }
      return { etat: d.ouvert_le ? 'utilise' : 'expire' }
    },
    async compte(userId) {
      const u = m.users.find(x => x.id === userId)
      if (!u) return null
      return {
        autorise: m.allowlist.has(u.id), emailConnexion: u.email, connexionConfirmee: u.confirme,
        verifiees: m.profileEmails.filter(p => p.profile_id === u.id && p.verified).map(p => p.email),
      }
    },
    async genererJeton(emailConnexion) {
      if (m.panne.generation) return m.panne.generation
      // La meme forme d'appel que cockpit-lien-magique.ts (verifiee plus bas sur le source).
      const { data, error } = supabase.generateLink({ type: TYPE_JETON_SUPABASE, email: emailConnexion })
      if (error || !data?.user || !data.properties?.hashed_token) return { ok: false, erreur: `supabase ${error?.status ?? ''} ${error?.code ?? ''}`.trim() }
      return { ok: true, userId: data.user.id, tokenHash: data.properties.hashed_token, type: data.properties.verification_type }
    },
    journal: ligne => m.logs.push(ligne),
    codeErreur: () => 'erreur',
  }

  /** Une demande comme la route la fait : corps lu, adresse normalisee, puis after(). */
  m.demander = async (brut, ip = IP) => {
    const email = normaliserEmail(lireCorps(JSON.stringify({ email: brut }))?.email)
    if (!email) return { status: 400, corps: { ok: false, erreur: 'email' }, emailsAvantApres: m.emails.length }
    const r = await traiterDemande({ email, ip }, m.portsDemande)
    const emailsAvantApres = m.emails.length
    if (r.apres) await r.apres()
    return { ...r.reponse, issue: r.issue, emailsAvantApres }
  }
  m.ouvrir = brut => ouvrirLien(brut, m.portsOuverture)
  m.jetonDu = email => {
    const e = [...m.emails].reverse().find(x => x.destinataire === email)
    if (!e) return null
    const url = new URL(e.modele.bouton.url)
    return lienDe(url)
  }
  m.nbComptes = () => m.users.length
  m.supabase = supabase
  return m
}

const derniere = m => m.demandes[m.demandes.length - 1]

// ---------------------------------------------------------------------------
// Les cas du brief
// ---------------------------------------------------------------------------

bloc('adresse principale : le lien part a l email de connexion, et ouvre le compte', async () => {
  const m = monde()
  const comptes = m.nbComptes()
  const r = await m.demander('  MelanieSommer93@Yahoo.com ')
  assert.equal(r.status, 200)
  assert.deepEqual(r.corps, { ok: true, message: MESSAGE_NEUTRE, minutes: LIEN_VALIDITE_MINUTES })
  assert.equal(r.emailsAvantApres, 0, "l'email part APRES la reponse (after)")
  assert.equal(m.emails.length, 1)
  assert.equal(m.emails[0].destinataire, YAHOO)
  const d = derniere(m)
  assert.equal(d.issue, 'envoye')
  assert.equal(d.user_id, MEL)
  assert.equal(d.par_connexion, true)
  assert.equal(m.generateLink.length, 0, 'aucun jeton Supabase a la demande')

  const jeton = m.jetonDu(YAHOO)
  assert.ok(lireJeton(jeton))
  assert.equal(d.lien_hmac, hmacLien(SECRET, jeton), 'la base ne garde que le HMAC du jeton')
  const o = await m.ouvrir(jeton)
  assert.equal(o.status, 200)
  assert.equal(o.corps.ok, true)
  assert.equal(o.corps.type, 'recovery')
  assert.match(o.corps.token_hash, new RegExp(`^th-${MEL}-`))
  assert.deepEqual(m.generateLink, [{ type: 'recovery', email: YAHOO }])
  assert.equal(m.nbComptes(), comptes, 'aucun compte cree')
})

bloc('adresse verifiee (le Gmail de Melanie) : le lien part AU GMAIL et ouvre SON compte', async () => {
  const m = monde()
  const comptes = m.nbComptes()
  const r = await m.demander(GMAIL)
  assert.equal(r.status, 200)
  assert.deepEqual(r.corps, { ok: true, message: MESSAGE_NEUTRE, minutes: LIEN_VALIDITE_MINUTES })
  assert.equal(m.emails.length, 1)
  assert.equal(m.emails[0].destinataire, GMAIL, "a l'adresse tapee, pas a l'email de connexion")
  assert.ok(!m.emails.some(e => e.destinataire === YAHOO))
  const d = derniere(m)
  assert.equal(d.issue, 'envoye')
  assert.equal(d.user_id, MEL)
  assert.equal(d.par_connexion, false)
  const o = await m.ouvrir(m.jetonDu(GMAIL))
  assert.equal(o.status, 200)
  assert.deepEqual(m.generateLink, [{ type: 'recovery', email: YAHOO }], 'le jeton Supabase vise l email de connexion du compte')
  assert.match(o.corps.token_hash, new RegExp(`^th-${MEL}-`))
  assert.equal(m.nbComptes(), comptes, 'aucun compte cree pour le Gmail')
})

bloc('cas du 05/11 : le Gmail est AUSSI l email de connexion du compte vide cree par Google', async () => {
  const m = monde()
  m.users.push({ id: VIDE, email: GMAIL, confirme: true }) // hors allowlist
  const r = await m.demander(GMAIL)
  assert.equal(r.status, 200)
  assert.equal(derniere(m).user_id, MEL, 'le compte du cockpit, pas le compte vide')
  const o = await m.ouvrir(m.jetonDu(GMAIL))
  assert.equal(o.status, 200)
  assert.deepEqual(m.generateLink, [{ type: 'recovery', email: YAHOO }])
})

bloc('adresse non verifiee : rien ne part, meme reponse', async () => {
  const m = monde()
  const r = await m.demander(AUTRE_MEL)
  assert.equal(r.status, 200)
  assert.deepEqual(r.corps, { ok: true, message: MESSAGE_NEUTRE, minutes: LIEN_VALIDITE_MINUTES })
  assert.equal(m.emails.length, 0)
  assert.equal(derniere(m).issue, 'non_verifiee')
  assert.equal(derniere(m).user_id, null)
  assert.equal(derniere(m).lien_hmac, null)
  // Un email de connexion jamais confirme ne prouve rien non plus.
  const m2 = monde()
  m2.users.find(u => u.id === BRICE).confirme = false
  m2.profileEmails.find(p => p.email === BRICE_MAIL).verified = false
  await m2.demander(BRICE_MAIL)
  assert.equal(m2.emails.length, 0)
  assert.equal(derniere(m2).issue, 'non_verifiee')
})

bloc('compte hors allowlist : rien ne part, ni par sa connexion ni par son adresse verifiee', async () => {
  const m = monde()
  for (const a of [MEMBRE_MAIL, MEMBRE_SECOND]) {
    const r = await m.demander(a)
    assert.equal(r.status, 200)
    assert.deepEqual(r.corps, { ok: true, message: MESSAGE_NEUTRE, minutes: LIEN_VALIDITE_MINUTES })
    assert.equal(derniere(m).issue, 'hors_allowlist')
  }
  assert.equal(m.emails.length, 0)
  assert.equal(m.generateLink.length, 0)
})

bloc('adresse inconnue : meme statut, meme corps, aucun envoi, aucun compte', async () => {
  const m = monde()
  const comptes = m.nbComptes()
  const connue = await m.demander(GMAIL)
  const inconnue = await m.demander('personne.inconnue@exemple.fr')
  assert.equal(inconnue.status, connue.status)
  assert.deepEqual(inconnue.corps, connue.corps)
  assert.equal(inconnue.emailsAvantApres, 1, 'aucun email de plus')
  assert.equal(m.emails.length, 1)
  assert.equal(derniere(m).issue, 'inconnue')
  assert.equal(m.nbComptes(), comptes)
})

bloc('cadence par adresse : 5 par heure, puis 429 (connue ou non), 10 par jour', async () => {
  for (const adresse of [GMAIL, 'personne.inconnue@exemple.fr']) {
    const m = monde()
    for (let i = 0; i < DEMANDES_ADRESSE_HEURE; i++) {
      m.maintenant = new Date(m.maintenant.getTime() + 1000)
      const r = await m.demander(adresse, `198.51.100.${i}`)
      assert.equal(r.status, 200, `demande ${i + 1}`)
    }
    const r = await m.demander(adresse, '198.51.100.99')
    assert.equal(r.status, 429, 'meme une autre IP ne passe pas')
    assert.equal(r.corps.erreur, 'limite')
    assert.equal(derniere(m).issue, 'limite')
    // Une heure plus tard, la cadence repart, jusqu'au plafond du jour.
    let refus = 0
    for (let h = 1; h <= 4; h++) {
      m.maintenant = new Date(m.maintenant.getTime() + 3_600_000)
      for (let i = 0; i < DEMANDES_ADRESSE_HEURE; i++) {
        const x = await m.demander(adresse, `192.0.2.${h * 10 + i}`)
        if (x.status === 429) refus++
      }
    }
    const passees = m.demandes.filter(d => d.issue !== 'limite' && d.cree_le > new Date(m.maintenant.getTime() - 86_400_000)).length
    assert.equal(passees, DEMANDES_ADRESSE_JOUR, 'jamais plus de 10 par 24 heures')
    assert.ok(refus > 0)
  }
})

bloc('cadence par IP : 10 par heure, 30 par jour, toutes adresses confondues', async () => {
  const m = monde()
  for (let i = 0; i < DEMANDES_IP_HEURE; i++) assert.equal((await m.demander(`inconnu${i}@exemple.fr`)).status, 200)
  assert.equal((await m.demander('encore.un@exemple.fr')).status, 429)
  assert.equal((await m.demander(GMAIL)).status, 429, 'meme une adresse du cockpit, depuis cette IP')
  assert.equal(m.emails.length, 0)
  assert.equal((await m.demander(GMAIL, '198.51.100.1')).status, 200, 'une autre IP passe')
  // 30 par jour.
  const m2 = monde()
  let ok = 0
  for (let h = 0; h < 5; h++) {
    for (let i = 0; i < DEMANDES_IP_HEURE; i++) if ((await m2.demander(`j${h}-${i}@exemple.fr`)).status === 200) ok++
    m2.maintenant = new Date(m2.maintenant.getTime() + 3_600_000 + 1000)
  }
  assert.equal(ok, DEMANDES_IP_JOUR)
})

bloc('cadence : deux rafales simultanees ne passent pas sous le plafond ensemble (verrou)', async () => {
  const m = monde()
  const r = await Promise.all(Array.from({ length: 12 }, () => m.demander(GMAIL)))
  assert.equal(r.filter(x => x.status === 200).length, DEMANDES_ADRESSE_HEURE)
  assert.equal(r.filter(x => x.status === 429).length, 12 - DEMANDES_ADRESSE_HEURE)
  assert.equal(m.emails.length, DEMANDES_ADRESSE_HEURE)
})

bloc('plafond global : 60 par heure', async () => {
  const m = monde()
  let ok = 0
  for (let i = 0; i < DEMANDES_TOTAL_HEURE + 5; i++) if ((await m.demander(`g${i}@exemple.fr`, `10.0.${Math.floor(i / 5)}.${i}`)).status === 200) ok++
  assert.equal(ok, DEMANDES_TOTAL_HEURE)
})

bloc('rafale : l equipe est alertee, une fois par heure, sans adresse ni IP', async () => {
  const m = monde()
  for (let i = 0; i < RAFALE_HEURE - 1; i++) await m.demander(`r${i}@exemple.fr`, `10.1.0.${i}`)
  assert.equal(m.alertes.length, 0)
  await m.demander('r-derniere@exemple.fr', '10.1.1.1')
  assert.equal(m.alertes.length, 1, `alerte a ${RAFALE_HEURE} demandes`)
  for (let i = 0; i < 10; i++) await m.demander(`s${i}@exemple.fr`, `10.2.0.${i}`)
  assert.equal(m.alertes.length, 1, 'une seule par heure')
  m.maintenant = new Date(m.maintenant.getTime() + 61 * 60_000)
  for (let i = 0; i < RAFALE_HEURE; i++) await m.demander(`t${i}@exemple.fr`, `10.3.0.${i}`)
  assert.equal(m.alertes.length, 2, 'une nouvelle heure, une nouvelle alerte')
  for (const a of m.alertes) {
    assert.ok(!/@/.test(a), "aucune adresse dans l'alerte")
    assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(a), "aucune IP dans l'alerte")
    assert.ok(!INTERDITS.test(a))
  }
  // Une limite atteinte alerte aussi, meme sans rafale globale.
  const m2 = monde()
  for (let i = 0; i <= DEMANDES_ADRESSE_HEURE; i++) await m2.demander(GMAIL)
  assert.equal(m2.alertes.length, 1)
  assert.match(m2.alertes[0], /bloquée/)
})

bloc('jamais de creation de compte : aucune demande ni ouverture ne cree un compte', async () => {
  const m = monde()
  const comptes = m.nbComptes()
  const adresses = [YAHOO, GMAIL, AUTRE_MEL, MEMBRE_MAIL, MEMBRE_SECOND, BRICE_MAIL, 'inconnu@exemple.fr', 'x@y.fr']
  for (const a of adresses) await m.demander(a, `10.9.0.${adresses.indexOf(a)}`)
  for (const e of [...m.emails]) await m.ouvrir(lienDe(new URL(e.modele.bouton.url)))
  await m.ouvrir(genererJeton())
  assert.equal(m.nbComptes(), comptes)
  assert.ok(m.generateLink.length > 0)
  assert.ok(m.generateLink.every(g => g.type === 'recovery'), "generateLink n'est jamais appele qu'en 'recovery'")
  assert.ok(m.generateLink.every(g => m.users.some(u => u.email === g.email)), 'seulement sur un email de connexion existant')
  // Temoin : le faux Supabase cree bien un compte en 'magiclink' sur une
  // adresse inconnue (comme GoTrue), et pas en 'recovery'. Le test ci-dessus
  // attraperait donc un appel en 'magiclink'.
  const temoin = monde()
  const avant = temoin.nbComptes()
  assert.ok(temoin.supabase.generateLink({ type: 'recovery', email: 'inconnu@exemple.fr' }).error)
  assert.equal(temoin.nbComptes(), avant)
  temoin.supabase.generateLink({ type: 'magiclink', email: 'inconnu@exemple.fr' })
  assert.equal(temoin.nbComptes(), avant + 1, "le temoin cree un compte en 'magiclink'")
  // Et 'recovery' sur une adresse inconnue rend une erreur : l'ouverture refuse.
  const m3 = monde()
  await m3.demander(GMAIL)
  const jeton = m3.jetonDu(GMAIL)
  m3.users.find(u => u.id === MEL).email = 'changee@exemple.fr' // l'email de connexion change entre-temps
  m3.portsOuverture.compte = async () => ({ autorise: true, emailConnexion: 'ancienne@exemple.fr', connexionConfirmee: true, verifiees: [GMAIL] })
  const comptes3 = m3.nbComptes()
  const o = await m3.ouvrir(jeton)
  assert.equal(o.status, 502)
  assert.equal(m3.nbComptes(), comptes3, "'recovery' sur une adresse inconnue : erreur, pas de compte")
})

bloc('ouverture : une seule fois, 15 minutes, jeton illisible ou inconnu', async () => {
  const m = monde()
  await m.demander(GMAIL)
  const jeton = m.jetonDu(GMAIL)
  assert.equal((await m.ouvrir(jeton)).status, 200)
  const deux = await m.ouvrir(jeton)
  assert.equal(deux.status, 410)
  assert.equal(deux.corps.erreur, 'utilise')
  assert.equal(m.generateLink.length, 1, 'un seul jeton Supabase genere')

  await m.demander(YAHOO)
  const j2 = m.jetonDu(YAHOO)
  m.maintenant = new Date(m.maintenant.getTime() + (LIEN_VALIDITE_MINUTES * 60 + 1) * 1000)
  const tard = await m.ouvrir(j2)
  assert.equal(tard.status, 410)
  assert.equal(tard.corps.erreur, 'expire')

  assert.equal((await m.ouvrir(genererJeton())).status, 404)
  for (const x of ['', 'court', `${jeton}x`, `${jeton.slice(0, 42)}!`, null, 3, {}, [jeton]]) {
    assert.equal((await m.ouvrir(x)).status, 400, JSON.stringify(x))
  }
  // Deux clics simultanes : une seule ouverture.
  const m2 = monde()
  await m2.demander(GMAIL)
  const j3 = m2.jetonDu(GMAIL)
  const r = await Promise.all([m2.ouvrir(j3), m2.ouvrir(j3), m2.ouvrir(j3)])
  assert.equal(r.filter(x => x.status === 200).length, 1)
  assert.equal(m2.generateLink.length, 1)
})

bloc('ouverture : compte sorti de l allowlist ou adresse plus verifiee entre-temps = refus', async () => {
  const m = monde()
  await m.demander(GMAIL)
  const j = m.jetonDu(GMAIL)
  m.allowlist.delete(MEL)
  const r = await m.ouvrir(j)
  assert.equal(r.status, 403)
  assert.equal(r.corps.erreur, 'refuse')
  assert.equal(m.generateLink.length, 0)

  const m2 = monde()
  await m2.demander(GMAIL)
  const j2 = m2.jetonDu(GMAIL)
  m2.profileEmails = m2.profileEmails.filter(p => p.email !== GMAIL) // retiree de Mon espace
  assert.equal((await m2.ouvrir(j2)).status, 403)
  assert.equal(m2.generateLink.length, 0)
})

bloc('ouverture : un jeton Supabase pour un AUTRE compte, ou d un autre type, n est jamais rendu', async () => {
  for (const panne of [
    { ok: true, userId: BRICE, tokenHash: 'th-brice', type: 'recovery' },
    { ok: true, userId: MEL, tokenHash: 'th-mel', type: 'signup' },
    { ok: true, userId: MEL, tokenHash: '', type: 'recovery' },
    { ok: false, erreur: 'supabase 500' },
  ]) {
    const m = monde()
    await m.demander(GMAIL)
    m.panne.generation = panne
    const r = await m.ouvrir(m.jetonDu(GMAIL))
    assert.equal(r.status, 502, JSON.stringify(panne))
    assert.equal(r.corps.token_hash, undefined)
  }
})

bloc('deux comptes du cockpit pour la meme adresse : ambigu, rien ne part', async () => {
  const m = monde()
  m.users.push({ id: VIDE, email: GMAIL, confirme: true })
  m.allowlist.add(VIDE)
  const r = await m.demander(GMAIL)
  assert.equal(r.status, 200)
  assert.equal(derniere(m).issue, 'ambigu')
  assert.equal(m.emails.length, 0)
})

bloc('email non parti : le lien est rendu inutilisable, la reponse ne change pas', async () => {
  const m = monde()
  m.panne.email = true
  const r = await m.demander(GMAIL)
  assert.equal(r.status, 200)
  assert.deepEqual(r.corps, { ok: true, message: MESSAGE_NEUTRE, minutes: LIEN_VALIDITE_MINUTES })
  assert.equal(derniere(m).issue, 'envoi_rate')
  assert.equal(derniere(m).lien_hmac, null)
  assert.ok(m.logs.some(l => /email NON parti/.test(l)))
})

bloc('base indisponible : 503 (le cockpit retombe sur signInWithOtp), rien ne part', async () => {
  const m = monde()
  m.panne.base = true
  const r = await m.demander(GMAIL)
  assert.equal(r.status, 503)
  assert.equal(r.corps.erreur, 'indisponible')
  assert.equal(m.emails.length, 0)
})

bloc('journal et logs : jamais l adresse, l IP, le jeton ni le token_hash', async () => {
  const m = monde()
  await m.demander(GMAIL)
  await m.demander('personne.inconnue@exemple.fr')
  const o = await m.ouvrir(m.jetonDu(GMAIL))
  const jeton = lienDe(new URL(m.emails[0].modele.bouton.url))
  const tout = JSON.stringify(m.demandes) + m.logs.join('\n')
  for (const secret of [GMAIL, 'personne.inconnue@exemple.fr', IP, jeton, o.corps.token_hash, YAHOO]) {
    assert.ok(!tout.includes(secret), `fuite : ${secret.slice(0, 6)}...`)
  }
  assert.equal(m.demandes[0].email_hmac, hmacAdresse(SECRET, GMAIL))
  assert.equal(m.demandes[0].ip_hmac, hmacIp(SECRET, IP))
  assert.ok(m.logs.some(l => /ref=[0-9a-f]{8} ip=[0-9a-f]{8} : envoye compte=11111111$/.test(l)))
})

// ---------------------------------------------------------------------------
// Regles pures
// ---------------------------------------------------------------------------

bloc('decisionCompte : connexion confirmee ou verifiee, allowlist seulement', () => {
  const c = (userId, autorise, lien, connexionConfirmee = true) => ({ userId, autorise, lien, connexionConfirmee })
  assert.deepEqual(decisionCompte([c(MEL, true, 'connexion')]), { action: 'envoyer', userId: MEL, parConnexion: true })
  assert.deepEqual(decisionCompte([c(MEL, true, 'verifiee')]), { action: 'envoyer', userId: MEL, parConnexion: false })
  assert.deepEqual(decisionCompte([c(MEL, true, 'connexion', false)]), { action: 'ignorer', issue: 'non_verifiee' })
  assert.deepEqual(decisionCompte([c(MEL, true, 'non_verifiee')]), { action: 'ignorer', issue: 'non_verifiee' })
  assert.deepEqual(decisionCompte([c(MEMBRE, false, 'connexion')]), { action: 'ignorer', issue: 'hors_allowlist' })
  assert.deepEqual(decisionCompte([]), { action: 'ignorer', issue: 'inconnue' })
  assert.deepEqual(decisionCompte([c(VIDE, false, 'connexion'), c(MEL, true, 'verifiee')]), { action: 'envoyer', userId: MEL, parConnexion: false })
  assert.deepEqual(decisionCompte([c(VIDE, true, 'connexion'), c(MEL, true, 'verifiee')]), { action: 'ignorer', issue: 'ambigu' })
})

bloc('limites et alerte : bornes exactes', () => {
  const z = { adresseHeure: 0, adresseJour: 0, ipHeure: 0, ipJour: 0, totalHeure: 0, toutesHeure: 0, limitesHeure: 0, envoyesHeure: 0, alerteRecente: false }
  assert.equal(limiteAtteinte(z), false)
  assert.equal(limiteAtteinte({ ...z, adresseHeure: DEMANDES_ADRESSE_HEURE - 1 }), false)
  assert.equal(limiteAtteinte({ ...z, adresseHeure: DEMANDES_ADRESSE_HEURE }), true)
  assert.equal(limiteAtteinte({ ...z, adresseJour: DEMANDES_ADRESSE_JOUR }), true)
  assert.equal(limiteAtteinte({ ...z, ipHeure: DEMANDES_IP_HEURE }), true)
  assert.equal(limiteAtteinte({ ...z, ipJour: DEMANDES_IP_JOUR }), true)
  assert.equal(limiteAtteinte({ ...z, totalHeure: DEMANDES_TOTAL_HEURE }), true)
  assert.equal(decisionAlerte({ limite: false, toutesHeure: RAFALE_HEURE - 1, alerteRecente: false }), false)
  assert.equal(decisionAlerte({ limite: false, toutesHeure: RAFALE_HEURE, alerteRecente: false }), true)
  assert.equal(decisionAlerte({ limite: true, toutesHeure: 1, alerteRecente: false }), true)
  assert.equal(decisionAlerte({ limite: true, toutesHeure: 99, alerteRecente: true }), false)
  assert.match(texteAlerte({ toutesHeure: 1, limitesHeure: 0, envoyesHeure: 1 }), /1 demande, dont 0 bloquée .* 1 lien envoyé\./)
})

bloc('jetons, HMAC et adresses du lien', () => {
  const j = genererJeton()
  assert.equal(j.length, 43)
  assert.equal(lireJeton(j), j)
  assert.notEqual(genererJeton(), j)
  assert.equal(lireJeton(`${j} `), null)
  assert.equal(hmacAdresse(SECRET, GMAIL).length, 64)
  assert.notEqual(hmacAdresse(SECRET, GMAIL), hmacLien(SECRET, GMAIL), 'une cle par usage')
  assert.notEqual(hmacIp(SECRET, null), hmacIp(SECRET, IP))
  assert.equal(memeHmac(hmacAdresse(SECRET, GMAIL), hmacAdresse(SECRET, GMAIL)), true)
  assert.equal(memeHmac(hmacAdresse(SECRET, GMAIL), hmacAdresse(SECRET, YAHOO)), false)
  assert.equal(memeHmac('zz', 'zz'), false)
  assert.equal(urlDuLien('https://cockpit.aoknowledge.com/', j), `https://cockpit.aoknowledge.com${CHEMIN_LIEN}#lien=${j}`)
  assert.equal(baseCockpit(undefined), URL_COCKPIT_DEFAUT)
  assert.equal(baseCockpit('http://localhost:5173/'), 'http://localhost:5173')
  assert.equal(baseCockpit('https://cockpit.aoknowledge.com'), 'https://cockpit.aoknowledge.com')
  for (const mauvaise of ['https://evil.com', 'https://aoknowledge.com.evil.com', 'http://cockpit.aoknowledge.com', 'javascript:alert(1)', 'https://cockpit.aoknowledge.com@evil.com']) {
    assert.equal(baseCockpit(mauvaise), URL_COCKPIT_DEFAUT, mauvaise)
  }
})

bloc('entree : adresse illisible = 400 avant toute base', async () => {
  const m = monde()
  for (const x of ['', 'pas-un-email', 'a@b.fr\nBcc: x@y.fr', `a${String.fromCharCode(0x200b)}@b.fr`, 3, null, ['a@b.fr']]) {
    const r = await m.demander(x)
    assert.equal(r.status, 400, JSON.stringify(x))
  }
  assert.equal(m.demandes.length, 0)
  assert.equal(lireCorps('x'.repeat(2001)), null)
})

bloc('l email : court, sobre, a notre nom, le lien et sa duree, aucune urgence', () => {
  const url = urlDuLien(URL_COCKPIT_DEFAUT, 'A'.repeat(43))
  assert.equal(new URL(url).search, '', 'le jeton dans le fragment, jamais dans la query')
  assert.equal(lienDe(new URL(url)), 'A'.repeat(43))
  const m = modeleEmailLien(GMAIL, url, new Date('2026-11-05T13:32:00Z'))
  assert.equal(m.sujet, 'Votre lien de connexion au Cockpit')
  assert.match(EXPEDITEUR, /<support@aoknowledge\.com>$/)
  const texte = texteEmailLien(m)
  const html = htmlEmailLien(m)
  assert.match(texte, /le 5 novembre à 14:32 \(heure de Paris\)/)
  assert.match(texte, new RegExp(`${LIEN_VALIDITE_MINUTES} minutes et une seule fois`))
  assert.ok(texte.includes(url))
  assert.ok(html.includes(`href="${url}"`))
  assert.ok(texte.includes(GMAIL))
  assert.ok(!/urgent|immédiatement|dernier délai|suspendu|bloqué|mot de passe|vérifiez votre compte/i.test(texte), 'aucune urgence ni demande de secret')
  assert.ok(!INTERDITS.test(texte + html + EXPEDITEUR), 'caracteres clavier simples')
  assert.ok(texte.split(/\s+/).length < 110, 'court')
  assert.equal(momentParis(new Date('2026-12-01T07:05:00Z')), 'le 1er décembre à 08:05')
  // L'adresse est echappee dans le HTML.
  const m2 = modeleEmailLien("o'neil@exemple.fr", url, new Date())
  assert.ok(htmlEmailLien(m2).includes('o&#39;neil@exemple.fr'))
})

// ---------------------------------------------------------------------------
// Relecture des sources
// ---------------------------------------------------------------------------

bloc('serveur : generateLink en recovery seulement, aucune creation de compte, aucun secret dans un log', () => {
  const s = lire('src/lib/cockpit-lien-magique.ts')
  assert.equal(TYPE_JETON_SUPABASE, 'recovery')
  assert.match(s, /generateLink\(\{ type: TYPE_JETON_SUPABASE, email: emailConnexion \}\)/)
  assert.equal((s.match(/generateLink\(/g) ?? []).length, 1)
  for (const interdit of [/'magiclink'/, /createUser/, /inviteUserByEmail/, /signUp\(/, /signInWithOtp/, /shouldCreateUser: true/]) {
    assert.ok(!interdit.test(s), `interdit : ${interdit}`)
  }
  assert.ok(!/console\.\w+\([^)]*(email|token|jeton|hashed)/i.test(s), 'aucun log avec une adresse ou un jeton')
  assert.match(s, /pg_advisory_xact_lock/)
  // L'interrupteur coupe les deux routes avant tout travail.
  assert.match(s, /demanderLienCockpit\(email: string, ip: string \| null\): Promise<IssueDemande> \{\n  if \(coupe\(\)\)/)
  assert.match(s, /ouvrirLienCockpit\(brut: unknown\): Promise<Reponse> \{\n  if \(coupe\(\)\)/)
  assert.match(s, /expire_le > now\(\)/)
  assert.match(s, /ouvert_le is null/)
  const p = lire('src/lib/cockpit-lien-magique-pur.ts')
  assert.ok(!/from '\.\.?\//.test(p), 'aucun import relatif dans le pur')
})

bloc('routes : publiques par le middleware, email apres la reponse, no-store', () => {
  const mw = lire('middleware.ts')
  assert.match(mw, /const publicPaths = \[[^\]]*'\/api\/cockpit\/lien-magique'[,\]]/)
  assert.ok(!/'\/api\/cockpit\/'[,\]]/.test(mw), 'le reste de /api/cockpit reste protege')
  const r = lire('src/app/api/cockpit/lien-magique/route.ts')
  assert.match(r, /after\(r\.apres\)/)
  assert.match(r, /normaliserEmail\(corps\?\.email\)/)
  assert.match(r, /'Cache-Control': 'no-store'/)
  const o = lire('src/app/api/cockpit/lien-magique/ouvrir/route.ts')
  assert.match(o, /'Cache-Control': 'no-store'/)
  assert.match(o, /ouvrirLienCockpit\(corps\?\.lien\)/)
})

bloc('migration : table fermee, HMAC seulement, aucun point-virgule hors fin d ordre', () => {
  const sql = lire('../../sites/Aoknowledgecom/supabase/migrations/20261105220000_cockpit_lien_magique.sql')
  const commentaires = sql.split('\n').filter(l => l.trim().startsWith('--'))
  assert.equal(commentaires.filter(l => l.includes(';')).length, 0, 'point-virgule dans un commentaire')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  for (const chaine of code.match(/'[^']*'/g) ?? []) assert.ok(!chaine.includes(';'), `point-virgule dans ${chaine}`)
  for (const ligne of code.split('\n')) {
    const i = ligne.indexOf(';')
    if (i >= 0) assert.equal(i, ligne.trimEnd().length - 1, `point-virgule en milieu de ligne : ${ligne}`)
  }
  assert.match(code, /create table if not exists public\.cockpit_lien_magique_demandes/)
  assert.match(code, /enable row level security/)
  assert.match(code, /force row level security/)
  assert.match(code, /revoke all on table public\.cockpit_lien_magique_demandes from anon, authenticated/)
  assert.ok(!/grant /.test(code), 'aucun droit pour le navigateur')
  assert.ok(!/create policy/.test(code), 'aucune policy')
  assert.ok(!/\bemail\s+text\b/.test(code) && !/\bip\s+text\b/.test(code), "ni l'adresse ni l'IP en clair")
  for (const issue of ['envoye', 'envoi_rate', 'inconnue', 'non_verifiee', 'hors_allowlist', 'ambigu', 'limite']) assert.ok(code.includes(`'${issue}'`))
})

bloc('cockpit : la page de connexion appelle la route, le retour verifie par token_hash', () => {
  let login, page, lib, app
  try {
    login = readFileSync(new URL('../../cockpit/src/pages/LoginPage.tsx', import.meta.url), 'utf8')
    page = readFileSync(new URL('../../cockpit/src/pages/AuthLienPage.tsx', import.meta.url), 'utf8')
    lib = readFileSync(new URL('../../cockpit/src/lib/lien-magique.ts', import.meta.url), 'utf8')
    app = readFileSync(new URL('../../cockpit/src/App.tsx', import.meta.url), 'utf8')
  } catch {
    console.log('    (cockpit absent a cote : bloc saute)')
    return
  }
  assert.match(login, /demanderLien\(adresse\)/)
  assert.match(login, /shouldCreateUser: false/, 'le filet ne cree pas de compte non plus')
  assert.ok(!/shouldCreateUser: true/.test(login))
  assert.match(page, /verifyOtp\(\{ token_hash: r\.tokenHash, type: r\.type \}\)/)
  assert.match(page, /onClick=\{ouvrir\}/, 'ouverture au clic, pas au chargement')
  assert.match(page, /history\.replaceState/)
  assert.match(page, /window\.location\.hash\.replace\(\/\^#\/, ''\)\)\.get\('lien'\)/, 'le jeton lu dans le fragment')
  assert.match(lib, /\/api\/cockpit\/lien-magique\/ouvrir/)
  assert.ok(!/service_role|SERVICE_ROLE/i.test(lib + page + login))
  assert.match(app, /path="\/auth\/lien" element=\{<AuthLienPage \/>\}/)
})

for (const [nom, f] of blocs) {
  await f()
  n++
  console.log(`ok  ${nom}`)
}
console.log(`\n${n} blocs ok`)
