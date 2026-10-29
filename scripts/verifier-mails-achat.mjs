// Les mails de confirmation d'achat (brief F1, 30/10/2026) : chaque modele
// rendu sans trou, mot pour mot le fichier des textes, l'objet et le prefixe
// d'essai, le choix du modele selon le prix ou le produit, l'anti-doublon
// (deux fois le meme evenement = un mail), aucun mail au renouvellement, le
// 10% Club aligne sur la Formation, et le vouvoiement des mails du Live Club.
// Fonctions pures et lecture du code : aucune base, aucun reseau, aucun mail.
//
//   node scripts/verifier-mails-achat.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const M = await import('../src/lib/mails-achat-pur.ts')
const C = await import('../src/lib/academie/club-paypal-pur.ts')
const E = await import('../src/lib/liveclub/emails.ts')
const V = await import('../src/lib/liveclub/emails-verification.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const PORTAIL = 'https://billing.stripe.com/p/login/test_portail_exemple'
const PLEIN = {
  prenom: 'Camille', offre: 'Pilotage Premium (mensuel)', montant: '5,99 euros', prochaineEcheance: '30 novembre 2026',
  lienPortail: PORTAIL, titreModule: 'Plan de Trading en 21 jours', lienModule: 'https://aoknowledge.com/academie/plan-21-jours',
  email: 'eleve@exemple.fr', essai: false,
}
const VIDE = { prenom: null, offre: null, montant: null, prochaineEcheance: null, lienPortail: null, titreModule: null, lienModule: null, email: 'eleve@exemple.fr', essai: false }
const PRODUITS = ['pilotage-premium', 'premium-duo', 'carnet-premium', 'module', 'formation']
const OBJETS = {
  'pilotage-premium': 'Pilotage Premium est ouvert',
  'premium-duo': 'Votre Duo est ouvert',
  'carnet-premium': 'Carnet Premium est actif',
  module: 'Le module Plan de Trading en 21 jours est ouvert',
  formation: 'Votre accès au 10% Club est ouvert',
}
const INTERDITS = /[\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u00A0\u202F]/
// Un mot de tutoiement, entier (bornes Unicode : « êtes » n'est pas « tes »).
const TUTOIEMENT = /(?<![\p{L}'])(?:(tu|ton|ta|tes|toi|te|salut)(?![\p{L}])|t')/iu
const TROUS = /\{\{|\}\}|undefined|null|NaN|\s:\s*\.|\s,|\(\s*\)|  /

// ── Les modeles ──────────────────────────────────────────────────────────────

await bloc('chaque modele : objet, aucune variable vide, signature Brice et Melanie, typographie clavier, vouvoiement', () => {
  for (const p of PRODUITS) {
    for (const v of [PLEIN, VIDE]) {
      const r = M.rendreMail(p, v)
      if (v === PLEIN) assert.equal(r.objet, OBJETS[p], p)
      for (const t of [r.objet, r.texte, ...r.modele.paragraphes]) {
        assert.doesNotMatch(t, TROUS, `${p} : trou dans « ${t.slice(0, 120)} »`)
        assert.doesNotMatch(t, INTERDITS, `${p} : typographie`)
        assert.doesNotMatch(t, TUTOIEMENT, `${p} : tutoiement`)
        assert.doesNotMatch(t, /\bIA\b/, `${p} : le mot IA`)
      }
      assert.ok(r.texte.endsWith('À bientôt sur les marchés,\nBrice et Mélanie'), p)
      assert.ok(r.html.includes('À bientôt sur les marchés,<br>Brice et Mélanie'), p)
      assert.ok(r.html.includes(r.modele.preheader.replace(/'/g, '&#39;')), `${p} : preheader`)
      assert.ok(r.texte.includes(`${r.modele.bouton.texte} : ${r.modele.bouton.url}`), `${p} : bouton en texte`)
      assert.ok(r.texte.includes('eleve@exemple.fr') || !['premium-duo', 'carnet-premium', 'module', 'formation'].includes(p), `${p} : email`)
    }
    assert.ok(M.rendreMail(p, VIDE).modele.paragraphes[0] === 'Bonjour,', `${p} : Bonjour, sans prenom`)
    assert.ok(M.rendreMail(p, PLEIN).modele.paragraphes[0] === 'Bonjour Camille,', `${p} : prenom`)
  }
  // Repli sans portail ni echeance : la phrase change, rien ne manque.
  assert.match(M.rendreMail('pilotage-premium', VIDE).texte, /Côté abonnement, pour changer de carte, de rythme ou arrêter : le bouton « Gérer mon abonnement » de pilotage\.aoknowledge\.com\/offres\. Si vous arrêtez/)
  assert.match(M.rendreMail('carnet-premium', VIDE).texte, /arrêter : le lien est dans le reçu que Stripe vous envoie\./)
  assert.match(M.rendreMail('premium-duo', VIDE).texte, /Un seul prélèvement pour les deux\. Pour changer/)
  assert.match(M.rendreMail('module', { ...VIDE, titreModule: 'X' }).texte, /Merci, votre paiement est bien passé pour le module « X »\./)
  assert.equal(M.rendreMail('module', VIDE).objet, 'Votre module est ouvert')
})

await bloc('mot pour mot : les cinq textes du fichier des mails (D:\\2_Creation\\...\\2026-10-30-mails-confirmation-achat.md)', () => {
  const chemin = '/mnt/d/2_Creation/Productions/Ecriture/2026-10-30-mails-confirmation-achat.md'
  if (!existsSync(chemin)) { console.log('    (fichier des textes absent de cette machine : comparaison sautee)'); return }
  const md = readFileSync(chemin, 'utf8')
  const sections = { 1: 'pilotage-premium', 2: 'premium-duo', 3: 'carnet-premium', 4: 'module', 5: 'formation' }
  const valeurs = {
    prenom: PLEIN.prenom, offre: PLEIN.offre, montant: PLEIN.montant, prochaine_echeance: PLEIN.prochaineEcheance,
    lien_portail: PORTAIL, titre_module: PLEIN.titreModule, lien_module: PLEIN.lienModule, email: PLEIN.email,
  }
  for (const [num, produit] of Object.entries(sections)) {
    const debut = md.indexOf(`\n## ${num}. `)
    const fin = md.indexOf('\n## ', debut + 5)
    const s = md.slice(debut, fin)
    const objet = /\*\*Objet\*\* : (.+)/.exec(s)[1].replace(/\{\{(\w+)\}\}/g, (_t, k) => valeurs[k])
    const preheader = /\*\*Préheader\*\* : (.+)/.exec(s)[1]
    const corps = s.slice(s.indexOf('**Corps**') + '**Corps**'.length, s.indexOf('**Bouton**')).trim()
      .replace(/\{\{(\w+)\}\}/g, (_t, k) => valeurs[k])
    const bouton = /\*\*Bouton\*\* : (.+?) : (\S+)/.exec(s)
    const r = M.rendreMail(produit, PLEIN)
    assert.equal(r.objet, objet, `${produit} : objet`)
    assert.equal(r.modele.preheader, preheader, `${produit} : preheader`)
    assert.equal([...r.modele.paragraphes, M.SIGNATURE].join('\n\n'), corps, `${produit} : corps`)
    assert.equal(r.modele.bouton.texte, bouton[1], `${produit} : bouton`)
    assert.equal(r.modele.bouton.url, bouton[2].replace(/\{\{(\w+)\}\}/g, (_t, k) => valeurs[k]), `${produit} : lien du bouton`)
  }
})

await bloc('essai : objet prefixe [Essai] pour chaque produit ; session Stripe de test = essai', () => {
  for (const p of PRODUITS) {
    const r = M.rendreMail(p, { ...PLEIN, essai: true })
    assert.equal(r.objet, `[Essai] ${OBJETS[p]}`, p)
  }
  const s = { id: 'cs_test_abcdefghijkl', status: 'complete', payment_status: 'paid', livemode: false, customer_details: { email: 'A@B.fr', name: 'jean-pierre DUPONT' }, amount_total: 599, subscription: 'sub_ABCDEF123' }
  const l = M.lireSessionPayee(s)
  assert.deepEqual(l, { sessionId: 'cs_test_abcdefghijkl', abonnementId: 'sub_ABCDEF123', email: 'a@b.fr', prenom: 'Jean-Pierre', centimes: 599, test: true })
  assert.equal(M.lireSessionPayee({ ...s, livemode: true }).test, false)
  assert.equal(M.lireSessionPayee({ ...s, payment_status: 'unpaid' }), null)
  assert.equal(M.lireSessionPayee({ ...s, status: 'open' }), null)
  assert.equal(M.lireSessionPayee({ ...s, id: 'pas_une_session' }), null)
})

await bloc('choix du modele : offre de Pilotage, Duo, produit du Carnet Premium (et rien d autre)', () => {
  assert.equal(M.produitDeOffrePilotage('pilotage-premium-mensuel'), 'pilotage-premium')
  assert.equal(M.produitDeOffrePilotage('pilotage-premium-annuel'), 'pilotage-premium')
  assert.equal(M.produitDeOffrePilotage('premium-duo-mensuel'), 'premium-duo')
  assert.equal(M.produitDeOffrePilotage('premium-duo-annuel'), 'premium-duo')
  for (const x of ['formation-complete', 'module-x', '', null, undefined]) assert.equal(M.produitDeOffrePilotage(x), null)

  const ab = (produit, interval, champ = 'item') => ({
    id: 'sub_CARNET1234', current_period_end: champ === 'racine' ? 1767225600 : undefined,
    items: { data: [{ price: { id: 'price_x', product: produit, recurring: { interval } }, current_period_end: champ === 'item' ? 1767225600 : undefined }] },
  })
  const lu = M.lireAbonnementCarnet(ab(M.PRODUIT_STRIPE_CARNET_PREMIUM, 'month'))
  assert.deepEqual(lu, { id: 'sub_CARNET1234', rythme: 'month', finPeriode: new Date(1767225600 * 1000) })
  assert.equal(M.lireAbonnementCarnet(ab({ id: M.PRODUIT_STRIPE_CARNET_PREMIUM }, 'year', 'racine')).rythme, 'year')
  assert.equal(M.lireAbonnementCarnet(ab('prod_AUTRE', 'month')), null, 'un autre produit : pas de mail')
  assert.equal(M.lireAbonnementCarnet({ id: 'x', items: { data: [] } }), null)
  assert.equal(M.offreCarnet('month'), 'Carnet Premium (mensuel)')
  assert.equal(M.offreCarnet('year'), 'Carnet Premium (annuel)')
  assert.equal(M.offreCarnet(null), 'Carnet Premium')
  // Le meme produit que celui qui ouvre le droit (entitlements.ts).
  assert.match(lire('../src/lib/entitlements.ts'), new RegExp(`CARNET_PREMIUM_PRODUCT = '${M.PRODUIT_STRIPE_CARNET_PREMIUM}'`))
})

await bloc('aucun mail au renouvellement : seul le paiement d un achat envoie', () => {
  assert.equal(M.evenementEnvoieMail('checkout.session.completed'), true)
  assert.equal(M.evenementEnvoieMail('checkout.session.async_payment_succeeded'), true)
  for (const t of ['invoice.paid', 'invoice.payment_succeeded', 'customer.subscription.updated', 'customer.subscription.deleted', 'charge.refunded', undefined]) {
    assert.equal(M.evenementEnvoieMail(t), false, String(t))
  }
  // Le webhook de Pilotage : le mail seulement sous evenementEnvoieMail(type) et avec la session du checkout.
  const w = lire('../src/app/api/pilotage/achat/webhook/route.ts')
  assert.match(w, /if \(r\.etat === 'ouvert' && session && evenementEnvoieMail\(type\)\) \{\n\s+const mail = await mailAchatPilotage\(/)
  assert.equal((w.match(/session = await lireSessionCheckout/g) ?? []).length, 1)
  assert.ok(w.indexOf('session = await lireSessionCheckout') < w.indexOf("} else if (type === 'invoice.paid')"), 'la session n est lue que pour checkout.session.completed')
  assert.equal((w.match(/mailAchat(Pilotage|Carnet)\(/g) ?? []).length, 2)
  // Le Carnet : une session d'abonnement SANS source (liens de paiement), aucun droit ecrit.
  assert.match(w, /if \(objet\.mode !== 'subscription' \|\| meta\.source\) return NextResponse\.json\(\{ ok: true, ignore: true \}\)\n\s+const mail = await mailAchatCarnet\(cle, await lireSessionCheckout\(cle, objet\.id\)\)\n\s+return NextResponse\.json/)
  // L'academie : apres l'acces, pour les deux evenements de paiement seulement.
  const a = lire('../src/app/api/academie/achat/webhook/route.ts')
  assert.equal((a.match(/mailAchatModule\(/g) ?? []).length, 1)
  assert.ok(a.indexOf('mailAchatModule(') < a.indexOf("evenement.type === 'charge.refunded'"))
})

await bloc('anti-doublon : deux fois le meme evenement (meme en meme temps) = un mail ; envoi rate = on peut reessayer ; table absente = aucun mail', async () => {
  const base = new Set()
  const envoyes = []
  const deps = (cle, { echoue = false } = {}) => ({
    reserver: async () => { await null; if (base.has(cle)) return false; base.add(cle); return true },
    envoyer: async () => (echoue ? { ok: false, erreur: 'Resend : test' } : (envoyes.push(cle), { ok: true, id: 'id-test' })),
    liberer: async () => { base.delete(cle) },
    noter: async () => {},
  })
  const cle = M.cleMailAchat('pilotage-premium', 'sub_ABC123456')
  assert.equal(cle, 'pilotage-premium:sub_ABC123456')
  assert.equal(await M.envoyerUneFois(deps(cle)), 'envoye')
  assert.equal(await M.envoyerUneFois(deps(cle)), 'deja_envoye')
  const deux = await Promise.all([M.envoyerUneFois(deps('module:cs_x')), M.envoyerUneFois(deps('module:cs_x'))])
  assert.deepEqual(deux.sort(), ['deja_envoye', 'envoye'])
  assert.deepEqual(envoyes, [cle, 'module:cs_x'])
  // Rate puis rejoue : la reservation a saute, le second essai part.
  assert.equal(await M.envoyerUneFois(deps('carnet-premium:sub_Z', { echoue: true })), 'echec')
  assert.equal(base.has('carnet-premium:sub_Z'), false)
  assert.equal(await M.envoyerUneFois(deps('carnet-premium:sub_Z')), 'envoye')
  // Migration absente ou base en panne : aucun envoi.
  let parti = false
  const sansTable = { ...deps('x'), reserver: async () => 'sans_table', envoyer: async () => { parti = true; return { ok: true, id: null } } }
  assert.equal(await M.envoyerUneFois(sansTable), 'sans_table')
  assert.equal(await M.envoyerUneFois({ ...sansTable, reserver: async () => { throw new Error('panne') } }), 'echec')
  assert.equal(parti, false)
  // Les SQL : reservation par on conflict do nothing, liberation seulement si rien n'est parti.
  assert.match(M.SQL_RESERVER_MAIL, /insert into public\.mails_achat_envoyes \(cle, produit\)\s+values \(\$1::text, \$2::text\)\s+on conflict \(cle\) do nothing\s+returning cle/)
  assert.match(M.SQL_LIBERER_MAIL, /where cle = \$1::text and resend_id is null/)
  // La cle : une par abonnement (sub_) pour Pilotage, Duo et Carnet, une par session (cs_) pour un module.
  const s = lire('../src/lib/mails-achat.ts')
  assert.match(s, /envoyerMailAchat\(produit, p\.abonnementId, \{/)
  assert.match(s, /envoyerMailAchat\('carnet-premium', ab\.id, \{/)
  assert.match(s, /envoyerMailAchat\('module', p\.sessionId, \{/)
})

await bloc('migration : la table de l anti-doublon, fermee, sans point-virgule dans les commentaires', () => {
  const sql = lire('../../../sites/Aoknowledgecom/supabase/migrations/20261031150000_mails_achat_envoyes.sql')
  assert.match(sql, /create table if not exists public\.mails_achat_envoyes \(\n\s+cle text primary key,\n\s+produit text not null,\n\s+resend_id text,\n\s+envoye_le timestamptz not null default now\(\)\n\);/)
  assert.match(sql, /alter table public\.mails_achat_envoyes enable row level security;/)
  assert.match(sql, /revoke all on table public\.mails_achat_envoyes from anon, authenticated;/)
  const commentaires = sql.split('\n').filter(l => l.trim().startsWith('--'))
  assert.ok(commentaires.every(l => !l.includes(';')), 'point-virgule dans un commentaire')
  const ordres = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').split(';').filter(x => x.trim())
  assert.equal(ordres.length, 4)
})

await bloc('mise en forme : prenom, montant, date, portail, liens du HTML', () => {
  assert.equal(M.prenomDe('camille martin'), 'Camille')
  assert.equal(M.prenomDe("  MARIE-ÉLISE d'Arc"), 'Marie-Élise')
  for (const x of ['', '   ', 'X', '123 rue', 'a@b.fr', null, 42]) {
    assert.equal(M.prenomDe(x), null, String(x))
  }
  assert.equal(M.formaterEuros(599), '5,99 euros')
  assert.equal(M.formaterEuros(5700), '57 euros')
  assert.equal(M.formaterEuros(199900), '1 999 euros')
  assert.equal(M.formaterEuros(5750), '57,50 euros')
  assert.equal(M.formaterEuros(0), null)
  assert.equal(M.formaterEuros(null), null)
  assert.equal(M.formaterDateLongue(new Date('2026-11-30T12:00:00Z')), '30 novembre 2026')
  assert.equal(M.formaterDateLongue(new Date('2026-11-30T23:30:00Z')), '1er décembre 2026', 'heure de Paris')
  assert.equal(M.formaterDateLongue(null), null)
  assert.equal(M.lienPortailPropre(` ${PORTAIL} `), PORTAIL)
  for (const x of ['https://exemple.fr/p/login/x', 'http://billing.stripe.com/p/login/x', 'https://billing.stripe.com/p/login/x"><script>', '', null]) {
    assert.equal(M.lienPortailPropre(x), null, String(x))
  }
  const h = M.paragrapheHtml('Pas encore installé ? aoknowledge.com/library/extension. Écrivez à support@aoknowledge.com : ok (nos conditions : aoknowledge.com/conditions-generales).')
  assert.ok(h.includes('<a href="https://aoknowledge.com/library/extension" style="color:#111827">aoknowledge.com/library/extension</a>.'))
  assert.ok(h.includes('<a href="mailto:support@aoknowledge.com"'))
  assert.ok(h.includes('<a href="https://aoknowledge.com/conditions-generales" style="color:#111827">aoknowledge.com/conditions-generales</a>).'))
  assert.ok(!M.paragrapheHtml('avec moi@aoknowledge.com, ok').includes('href="https://aoknowledge.com'), 'pas de lien au milieu d un email')
  assert.ok(M.paragrapheHtml('a\nb').includes('a<br>b'))
  const piege = M.rendreMail('carnet-premium', { ...PLEIN, email: '<script>@x.fr', prenom: null }).html
  assert.doesNotMatch(piege, /<script>/)
})

// ── Le 10% Club (PayPal) : le texte valide de la Formation ───────────────────

await bloc('10% Club : modeleEmailClub dit mot pour mot le texte de la Formation, meme objet, meme signature', () => {
  for (const v of [PLEIN, VIDE, { ...PLEIN, essai: true }]) {
    const club = C.modeleEmailClub({ email: v.email, essai: v.essai, montant: v.montant, prenom: v.prenom })
    const formation = M.modeleFormation(v)
    assert.equal(club.sujet, formation.objet)
    assert.deepEqual(club.paragraphes.map(p => p.replace(/\{lien:[^|}]+\|([^}]+)\}/g, '$1')), formation.paragraphes)
    assert.deepEqual(club.bouton, formation.bouton)
  }
  const m = C.modeleEmailClub({ email: 'eleve@exemple.fr', essai: false, montant: '1 999 euros', prenom: 'Camille' })
  assert.ok(C.texteEmailClub(m).endsWith('À bientôt sur les marchés,\nBrice et Mélanie'))
  assert.ok(C.htmlEmailClub(m).includes('À bientôt sur les marchés,<br>Brice et Mélanie'))
  assert.ok(!C.htmlEmailClub(m).includes('>AO Knowledge<'))
  // L'envoi passe le montant et le prenom, sans changer son declenchement (acces cree, email connu).
  const r = lire('../src/app/api/club/paypal/capturer/route.ts')
  assert.match(r, /if \(r\.cree\) \{[\s\S]{0,400}if \(email\) \{\n\s+const envoi = await envoyerEmailClub\(email, c\.essai, \{\n\s+montant: formaterEuros\(c\.capture\.centimes \?\? c\.centimes\),\n\s+prenom: prenomDe\(c\.payeurPrenom\),/)
  const lu = C.lireCommande({
    id: '5O190127TN364715T', status: 'APPROVED', payer: { email_address: 'p@x.fr', name: { given_name: ' Camille ' } },
    purchase_units: [{ reference_id: 'club-10', custom_id: 'e:eleve@exemple.fr', amount: { currency_code: 'EUR', value: '1999.00' } }],
  })
  assert.equal(lu.commande.payeurPrenom, 'Camille')
})

// ── Le Live Club : les emails vouvoient, les messages prives tutoient ────────

await bloc('Live Club : chaque email au vouvoiement et signe Brice et Melanie ; le prive garde le tutoiement du bot', () => {
  const LIEN = 'https://t.me/aok_liveclub_bot?start=jeton'
  const UNE = [{ centimes: 4900, devise: 'eur', lien: 'https://invoice.stripe.com/i/acct_test/f1', factureLe: '2026-10-17T07:00:00Z' }]
  const emails = {
    bienvenue: E.modeleBienvenue(LIEN),
    accesBroker: E.modeleAccesBroker(LIEN, '2027-01-01', 3),
    pauseDebut: E.modeleRappelPause('2026-12-01', 'debut', 'email'),
    pauseJ7: E.modeleRappelPause('2026-12-01', 'j7', 'email'),
    pauseSansReprise: E.modeleDebutPauseSansReprise('email'),
    retour: E.modeleRetour(LIEN, 'email'),
    rappelFinBroker: E.modeleRappelFinBroker('2026-12-01', 'email'),
    finBroker: E.modeleFinBroker('email'),
    rappelFinExemption: E.modeleRappelFinExemption('2026-12-01', 'email'),
    finExemption: E.modeleFinExemption('email'),
    sortieDesabonne: E.modeleSortieDesabonne('email'),
    rappelPrelevement: E.modeleRappelPrelevement('2026-11-01', { centimes: 13900, devise: 'eur' }, LIEN),
    sortieImpaye: E.modeleSortieImpaye(UNE, '2026-11-16T07:00:00Z', 'email'),
    sortieImpayeDeux: E.modeleSortieImpaye([...UNE, UNE[0]], '2026-11-16T07:00:00Z', 'email'),
    reouverture: E.modeleReouverture(LIEN, 'email'),
    finFenetre: E.modeleFinFenetre(true, 'email'),
    codeVerification: V.modeleCodeVerification('123456'),
  }
  for (const [nom, m] of Object.entries(emails)) {
    for (const t of [m.sujet, ...m.paragraphes]) {
      assert.doesNotMatch(t, TUTOIEMENT, `${nom} : « ${t} »`)
      assert.doesNotMatch(t, INTERDITS, nom)
    }
    assert.ok(E.texteEmail(m).endsWith('\n\nBrice et Mélanie'), nom)
    const html = E.htmlEmail(m)
    assert.ok(html.includes('>Brice et Mélanie</p>') && !html.includes('Le Live Club AOKnowledge'), nom)
    if (m.bouton) assert.ok(html.includes('Si le bouton ne marche pas, copiez ce lien'), nom)
  }
  // La bienvenue : la formation incluse est sur l'academie du site, plus sur Skool.
  const b = E.texteTelegram(emails.bienvenue)
  assert.ok(b.includes('https://aoknowledge.com/academie') && !b.includes('skool.com'), b)
  // Les messages prives (canal par defaut) ne changent pas de ton.
  assert.equal(E.modeleRappelPause('2026-12-01').paragraphes[0], 'Salut !')
  assert.match(E.modeleRetour(LIEN).paragraphes[1], /^Ton abonnement a repris\. Pour revenir dans le groupe Telegram, ouvre notre bot/)
  assert.equal(E.modeleRappelPrelevement('2026-11-01', null).paragraphes.at(-1), 'Une question ? Écris-moi ici.')
  assert.match(E.modeleSortieImpaye(UNE, '2026-11-16T07:00:00Z').paragraphes[2], /sur ta facture du/)
  // Les envois par email passent bien le canal 'email' et le texte signe.
  const src = lire('../src/lib/liveclub/emails.ts')
  assert.match(src, /html: htmlEmail\(m\),\n\s+text: texteEmail\(m\),/)
  assert.match(lire('../src/lib/liveclub/emails-verification.ts'), /text: texteEmail\(m\),/)
})

console.log(`\n${n} blocs verifies, tout est bon.`)
