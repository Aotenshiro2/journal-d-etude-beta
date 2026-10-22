// Reouverture apres un impaye, sans webhook (Brice, 22/10/2026, cas de
// Christine : sortie a 09:13, facture payee a 09:23, rien jusqu'au passage du
// lendemain). Verifie :
// - les textes des modeles de emails.ts et emails-verification.ts : aucun
//   renvoi vers support@ dans un message prive (Telegram), la porte
//   « Une question ? Écris-moi ici. » en prive, « Réponds à cet email » par
//   email ; seuls les modeles qui ne partent QUE par email gardent support@ ;
// - le message de sortie pour impaye : la phrase de Brice, le bouton
//   « J'ai réglé : revenir dans le groupe » en prive, jamais dans l'email ;
// - la decision du clic (paye : lien ; pas paye : dette) et ses textes ;
// - un controle statique du branchement (bot-membre.ts, passage.ts) ;
// - le webhook invoice.paid PRET mais pas branche (reouverture-stripe-pur.ts,
//   route /api/liveclub/stripe).
// Aucune base, aucun reseau, aucun envoi. Lancement (Node 22) :
// node scripts/verifier-reouverture-impaye.mjs

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_URL = pathToFileURL(path.join(RACINE, 'src') + path.sep).href
// emails.ts importe './config' et './pur' sans extension : meme crochet que verifier-effacement.mjs.
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC_URL)};
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) } catch (err) {
    let base = null
    if (spec.startsWith('@/')) base = new URL(spec.slice(2), SRC).href
    else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL) base = new URL(spec, ctx.parentURL).href
    if (!base) throw err
    for (const c of [base + '.ts', base + '/index.ts']) { try { return await next(c, ctx) } catch {} }
    throw err
  }
}`))

const E = await import('../src/lib/liveclub/emails.ts')
const V = await import('../src/lib/liveclub/emails-verification.ts')
const P = await import('../src/lib/liveclub/pur.ts')
const C = await import('../src/lib/liveclub/config.ts')
const W = await import('../src/lib/liveclub/reouverture-stripe-pur.ts')
const A = await import('../src/lib/academie/achat-pur.ts')

let n = 0
const test = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

const CARACTERES_INTERDITS = new RegExp(`[${[0x2014, 0x2013, 0x2022, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0x00a0, 0x202f].map(c => String.fromCharCode(c)).join('')}]`)
const SUPPORT_RE = /support@|@aoknowledge|\b[\w.-]+@[\w-]+\.[a-z]{2,}/i
/** Tout le texte visible d'un modele en message prive : paragraphes et libelles des boutons (et leurs adresses). */
const visible = (m) => [m.sujet, ...m.paragraphes, ...(m.bouton ? [m.bouton.texte, m.bouton.url] : []), ...(m.boutonBot ? [m.boutonBot.texte] : [])].join('\n')

const LIEN_FACTURE = 'https://invoice.stripe.com/i/acct_test/test_facture_1'
const UNE = [{ centimes: 4900, devise: 'eur', lien: LIEN_FACTURE, factureLe: '2026-10-17T07:00:00Z' }]
const DEUX = [
  { centimes: 4900, devise: 'eur', lien: 'https://invoice.stripe.com/i/acct_test/test_facture_2', factureLe: '2026-10-17T07:00:00Z' },
  { centimes: 4900, devise: 'eur', lien: LIEN_FACTURE, factureLe: '2026-09-17T07:00:00Z' },
]
const LIMITE = '2026-11-16T07:00:00Z'
const LIEN_BOT = C.lienBotAccueil()
const PHRASE_TELEGRAM = "Dès que c'est réglé, appuie sur « J'ai réglé : revenir dans le groupe » (ou écris-moi) : je te redonne ton lien tout de suite. Sinon, je te le renvoie demain matin."
const PHRASE_EMAIL = `Dès que c'est réglé, écris au bot du Live Club (${LIEN_BOT}) : il te redonne ton lien tout de suite. Sinon, on te le renvoie demain matin.`

// Les modeles qui partent des deux cotes (prevenir du passage : prive d'abord,
// email sinon), en prive et par email. Le dernier argument est le canal.
const DOUBLES = {
  modeleRappelPause_debut: (c) => E.modeleRappelPause('2026-12-01', 'debut', c),
  modeleRappelPause_j7: (c) => E.modeleRappelPause('2026-12-01', 'j7', c),
  modeleDebutPauseSansReprise: (c) => E.modeleDebutPauseSansReprise(c),
  modeleRetour: (c) => E.modeleRetour('https://t.me/aok_liveclub_bot?start=jeton', c),
  modeleRappelFinBroker: (c) => E.modeleRappelFinBroker('2026-12-01', c),
  modeleFinBroker: (c) => E.modeleFinBroker(c),
  modeleRappelFinExemption: (c) => E.modeleRappelFinExemption('2026-12-01', c),
  modeleFinExemption: (c) => E.modeleFinExemption(c),
  modeleSortieDesabonne: (c) => E.modeleSortieDesabonne(c),
  modeleSortieImpaye: (c) => E.modeleSortieImpaye(UNE, LIMITE, c),
  modeleSortieImpaye_deux: (c) => E.modeleSortieImpaye(DEUX, LIMITE, c),
  modeleReouverture: (c) => E.modeleReouverture('https://t.me/+lien', c === 'telegram' ? 'prive' : 'email'),
  modeleFinFenetre_annulee: (c) => E.modeleFinFenetre(true, c),
  modeleFinFenetre: (c) => E.modeleFinFenetre(false, c),
  modeleRappelPrelevement: (c) => E.modeleRappelPrelevement('2026-11-01', { centimes: 4900, devise: 'eur' }, c === 'email' ? LIEN_BOT : undefined),
}

test('messages prives : aucun renvoi vers support@, la porte est le bot (« Écris-moi ici. »)', () => {
  for (const [nom, f] of Object.entries(DOUBLES)) {
    const m = f('telegram')
    const t = visible(m)
    assert.ok(!SUPPORT_RE.test(t), `${nom} : adresse email en prive : ${t}`)
    assert.ok(!/Réponds à cet email|écris-nous/i.test(t), `${nom} : porte email en prive`)
    assert.ok(/Écris-moi ici|écris-moi ici|écris-moi\)/.test(t), `${nom} : pas de porte vers le bot`)
    assert.ok(!CARACTERES_INTERDITS.test(t), `${nom} : caractere interdit`)
  }
  // Le lien de retour apres une sortie a tort (prive seulement).
  const abusive = visible(E.modeleRetourSortieAbusive('https://t.me/+lien'))
  assert.ok(!SUPPORT_RE.test(abusive) && abusive.includes('Un souci ? Écris-moi ici.'))
})

test('emails : « Réponds à cet email » (la reponse arrive a l equipe), jamais « Écris-moi ici »', () => {
  for (const [nom, f] of Object.entries(DOUBLES)) {
    const t = visible(f('email'))
    assert.ok(!/Écris-moi ici|écris-moi ici/.test(t), `${nom} : « écris-moi ici » dans un email`)
    if (nom === 'modeleRappelPrelevement') {
      assert.ok(t.includes(`Écris au bot du Live Club : ${LIEN_BOT}`), nom)
      continue
    }
    if (nom.startsWith('modeleSortieImpaye')) assert.ok(t.includes(LIEN_BOT), `${nom} : lien du bot`)
    assert.ok(/Réponds à cet email|réponds à cet email/.test(t), `${nom} : pas de « Réponds à cet email »`)
    assert.ok(!SUPPORT_RE.test(t.replace(LIEN_BOT, '')), `${nom} : adresse email`)
    assert.ok(!CARACTERES_INTERDITS.test(t), `${nom} : caractere interdit`)
  }
})

test('modeles email seulement : bienvenue, acces broker, code de verification (support@ garde)', () => {
  assert.ok(visible(E.modeleBienvenue(LIEN_BOT)).includes(C.SUPPORT))
  assert.ok(visible(E.modeleAccesBroker(LIEN_BOT, '2027-01-01')).includes(C.SUPPORT))
  assert.ok(visible(V.modeleCodeVerification('123456')).includes(C.SUPPORT))
  // Jamais envoyes en prive : ni le passage ni le bot ne les rendent en message.
  const lire = (f) => readFileSync(path.join(RACINE, 'src/lib/liveclub', f), 'utf8')
  for (const f of ['passage.ts', 'bot-membre.ts', 'actions-membre.ts', 'verification.ts', 'acces.ts', 'bienvenue.ts']) {
    const s = lire(f)
    assert.ok(!/modeleBienvenue|modeleAccesBroker|modeleCodeVerification/.test(s), `${f} rend un modele email seulement`)
  }
  // Dans emails.ts, ${SUPPORT} n'apparait plus que dans ces deux modeles.
  const emails = lire('emails.ts')
  const corps = (nom) => emails.slice(emails.indexOf(`export function ${nom}(`), emails.indexOf('\n}\n', emails.indexOf(`export function ${nom}(`)))
  const hors = emails.replace(corps('modeleBienvenue'), '').replace(corps('modeleAccesBroker'), '')
  assert.ok(!hors.includes('${SUPPORT}'), '${SUPPORT} hors des modeles email seulement')
})

test('sortie pour impaye, en prive : la phrase de Brice et le bouton « J\'ai réglé : revenir dans le groupe »', () => {
  const m = E.modeleSortieImpaye(UNE, LIMITE)
  assert.ok(m.paragraphes.includes(PHRASE_TELEGRAM), m.paragraphes.join('\n'))
  assert.ok(!m.paragraphes.some(p => /rouvre tout seul/.test(p)), 'plus de promesse « rouvre tout seul »')
  assert.ok(m.paragraphes.includes('Il reste 49 € à régler sur ta facture du 17 octobre 2026.'))
  assert.ok(m.paragraphes.includes('Ton tarif actuel est gardé si tu règles dans les 30 jours, donc avant le 16 novembre 2026.'))
  assert.equal(m.paragraphes.at(-1), 'Une question ? Écris-moi ici.')
  assert.deepEqual(m.boutonBot, { texte: "J'ai réglé : revenir dans le groupe", data: 'm:regle' })
  assert.deepEqual(m.boutonBot, { ...P.BOUTON_REGLE })
  assert.ok(P.callbackDataValide(m.boutonBot.data))
  // Une facture : son bouton, puis celui qui revient au bot.
  assert.deepEqual(E.boutonsTelegram(m), [
    [{ texte: 'Régler ma facture', url: LIEN_FACTURE }],
    [{ texte: "J'ai réglé : revenir dans le groupe", data: 'm:regle' }],
  ])
  // Plusieurs factures : les liens dans le texte, le seul bouton est celui du bot.
  const d = E.modeleSortieImpaye(DEUX, LIMITE)
  assert.equal(d.bouton, undefined)
  assert.ok(d.paragraphes.some(p => p.includes(LIEN_FACTURE)))
  assert.deepEqual(E.boutonsTelegram(d), [[{ texte: "J'ai réglé : revenir dans le groupe", data: 'm:regle' }]])
  // Le libelle au fil Support.
  assert.equal(P.libelleBouton('m:regle'), "J'ai réglé : revenir dans le groupe")
  // Les autres modeles n'ont pas ce bouton.
  for (const [nom, f] of Object.entries(DOUBLES)) {
    if (!nom.startsWith('modeleSortieImpaye')) assert.equal(f('telegram').boutonBot, undefined, nom)
  }
})

test('sortie pour impaye, par email : le lien du bot, aucun bouton du bot dans l email', () => {
  const m = E.modeleSortieImpaye(UNE, LIMITE, 'email')
  assert.ok(m.paragraphes.includes(PHRASE_EMAIL), m.paragraphes.join('\n'))
  assert.equal(m.boutonBot, undefined)
  assert.deepEqual(m.bouton, { texte: 'Régler ma facture', url: LIEN_FACTURE })
  assert.equal(m.paragraphes.at(-1), 'Une question ? Réponds à cet email.')
  const html = E.htmlEmail(m)
  const texte = E.texteTelegram(m)
  for (const t of [html, texte]) {
    assert.ok(!t.includes('m:regle') && !t.includes("J'ai réglé") && !t.includes('J&#39;ai réglé'), 'bouton du bot dans l email')
    assert.ok(!/support@/.test(t))
  }
  // Le lien du bot devient un lien dans l'email, sans la parenthese fermante.
  assert.ok(html.includes(`(<a href="${LIEN_BOT}" style="color:#111827">${LIEN_BOT}</a>) : il te redonne`), html)
  // Meme un modele en prive passe dans htmlEmail ne montre pas le bouton du bot.
  assert.ok(!E.htmlEmail(E.modeleSortieImpaye(UNE, LIMITE)).includes('m:regle'))
})

test('decision du clic : paye = lien, pas paye = dette, sinon une phrase claire', () => {
  const d = (presence, droit, dette = false, lienRecent = false) => P.decisionBoutonRegle({ presence, droit, dette, lienRecent })
  // Christine a 09:23 : facture payee, abonnement actif, hors du groupe.
  assert.equal(d('non', 'oui'), 'lien')
  assert.equal(d('non', 'oui', false, true), 'lien_recent')
  // Pas encore paye : la dette d'abord.
  assert.equal(d('non', 'non', true), 'pas_encore_paye')
  assert.equal(d('inconnu', 'non', true), 'pas_encore_paye')
  // Plus d'abonnement (fenetre de 30 jours passee) : les portes d'abonnement.
  assert.equal(d('non', 'non', false), 'sans_droit')
  // Deja revenu : rien a faire, quel que soit le droit.
  for (const droit of ['oui', 'non', 'inconnu']) assert.equal(d('oui', droit, true), 'deja_dans_le_groupe')
  // Illisible : pas de lien.
  assert.equal(d('non', 'inconnu'), 'inconnu')
  assert.equal(d('inconnu', 'oui'), 'inconnu')
  assert.equal(d('inconnu', 'inconnu'), 'inconnu')
})

test('textes du clic : montant et lien de la facture, sans support@', () => {
  const dette = { depuis: '2026-10-17T07:00:00Z', limite: LIMITE, aRegler: UNE }
  const une = P.texteReglementPasVu(dette)
  assert.ok(une.startsWith('Je ne vois pas encore ton paiement : ta facture est toujours ouverte'))
  assert.ok(une.includes(`Il reste 49 € à régler sur ta facture du 17 octobre 2026. Tu peux la régler ici : ${LIEN_FACTURE}`))
  assert.ok(une.includes(`réappuie sur « J'ai réglé : revenir dans le groupe »`))
  const deux = P.texteReglementPasVu({ ...dette, aRegler: DEUX })
  assert.ok(deux.includes('tes factures sont toujours ouvertes') && deux.includes(LIEN_FACTURE))
  const sans = P.texteReglementSansAbonnement(C.texteAbonnement())
  assert.ok(sans.includes(C.texteAbonnement()))
  for (const t of [une, deux, sans, P.TEXTE_LIEN_DEJA_DONNE]) {
    assert.ok(!SUPPORT_RE.test(t), t)
    assert.ok(!CARACTERES_INTERDITS.test(t), t)
  }
  assert.equal(P.phraseQuestion('telegram'), 'Une question ? Écris-moi ici.')
  assert.equal(P.phraseQuestion('email', 'Un souci ?'), 'Un souci ? Réponds à cet email.')
})

test('branchement : le bouton dans le bot, les boutons du passage, le lien sur un message ecrit', () => {
  const lire = (f) => readFileSync(path.join(RACINE, 'src/lib/liveclub', f), 'utf8')
  const bot = lire('bot-membre.ts')
  // Le clic : relecture en direct du droit, puis le lien par proposerRetourAuGroupe.
  const clic = bot.slice(bot.indexOf('if (data === BOUTON_REGLE.data) {'), bot.indexOf('const retour = () =>'))
  assert.match(clic, /await repondreBouton\(bouton\.id\)\s+await revenirApresReglement\(chat, u, r, updateId\)/)
  const fn = bot.slice(bot.indexOf('async function revenirApresReglement('), bot.indexOf('// Tarif reserve (Brice, 13/10)'))
  assert.match(fn, /await droitLiveClub\(u\.id\)/)
  assert.match(fn, /decisionBoutonRegle\(/)
  assert.match(fn, /proposerRetourAuGroupe\(chat, u, updateId, \{ declencheur: 'regle'/)
  assert.match(fn, /texteReglementPasVu\(droit\.dette\)/)
  // Le clic est traite apres le bloc des comptes non rattaches (r est un rattachement).
  assert.ok(bot.indexOf("if (r === 'illisible' || !r) {", bot.indexOf('export async function traiterBouton')) < bot.indexOf('if (data === BOUTON_REGLE.data) {'))
  // Un message ecrit : le lien, meme si l'equipe a la main.
  const texteLibre = bot.slice(bot.indexOf('async function traiterTexteLibre('), bot.indexOf('async function versEquipeSiElleALaMain('))
  assert.match(texteLibre, /if \(await versEquipeSiElleALaMain\(chat, u, r, texte\)\) \{\s+(\/\/.*\s+)*if \(r && r !== 'illisible'\) \{\s+await proposerRetourAuGroupe\(chat, u, updateId, \{ declencheur: 'texte'/)
  // Le passage envoie les deux boutons (adresse, puis retour au bot).
  const passage = lire('passage.ts')
  const prevenir = passage.slice(passage.indexOf('async function prevenir('), passage.indexOf('async function sortir('))
  assert.match(prevenir, /const boutons = boutonsTelegram\(m\)/)
  assert.match(passage, /modeleSortieImpaye\(impaye\.aRegler, limite\),\s+e => emailSortieImpaye\(e, impaye\.aRegler, limite\)\)/)
  // Pas de support@ dans le bot des membres (hors commentaires).
  assert.ok(!/\$\{SUPPORT\}|support@aoknowledge|\bSUPPORT\b/.test(bot.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '')))
})

test('webhook invoice.paid (pret, pas branche) : lecture de l evenement, signature, branchement', () => {
  const evt = (objet, type = 'invoice.paid') => ({ type, data: { object: { object: 'invoice', status: 'paid', customer: 'cus_TestChristine1', customer_email: 'Christine@Exemple.fr', ...objet } } })
  // Version d'API recente : l'abonnement dans parent.subscription_details.
  assert.deepEqual(W.lireFacturePayee(evt({ parent: { subscription_details: { subscription: 'sub_TestAbo12345' } } })),
    { client: 'cus_TestChristine1', email: 'christine@exemple.fr', abonnement: 'sub_TestAbo12345' })
  // Ancienne version : invoice.subscription.
  assert.equal(W.lireFacturePayee(evt({ subscription: 'sub_TestAbo12345' })).abonnement, 'sub_TestAbo12345')
  // Rien a faire : autre evenement, facture non payee, hors abonnement, client illisible.
  assert.equal(W.lireFacturePayee(evt({ subscription: 'sub_TestAbo12345' }, 'invoice.payment_failed')), null)
  assert.equal(W.lireFacturePayee(evt({ subscription: 'sub_TestAbo12345', status: 'open' })), null)
  assert.equal(W.lireFacturePayee(evt({})), null)
  assert.equal(W.lireFacturePayee(evt({ subscription: 'sub_TestAbo12345', customer: { id: 'cus_x' } })), null)
  assert.equal(W.lireFacturePayee(null), null)
  assert.equal(W.lireFacturePayee({ type: 'invoice.paid' }), null)

  // La signature : la meme fonction que le webhook de l'academie.
  const corps = JSON.stringify(evt({ subscription: 'sub_TestAbo12345' }))
  const t = 1_800_000_000
  const sig = createHmac('sha256', 'whsec_essai').update(`${t}.${corps}`, 'utf8').digest('hex')
  assert.ok(A.verifierSignature(corps, `t=${t},v1=${sig}`, 'whsec_essai', t + 10))
  assert.ok(!A.verifierSignature(corps, `t=${t},v1=${sig}`, 'whsec_autre', t + 10))
  assert.ok(!A.verifierSignature(corps + ' ', `t=${t},v1=${sig}`, 'whsec_essai', t + 10))
  assert.ok(!A.verifierSignature(corps, `t=${t},v1=${sig}`, 'whsec_essai', t + 400))

  const lire = (f) => readFileSync(path.join(RACINE, f), 'utf8')
  const route = lire('src/app/api/liveclub/stripe/route.ts')
  assert.match(route, /process\.env\.STRIPE_WEBHOOK_SECRET_LIVECLUB/)
  assert.match(route, /status: 503/)
  assert.match(route, /verifierSignature\(corps, req\.headers\.get\('stripe-signature'\), secret\)/)
  assert.match(route, /reouvertureApresPaiement\(facture\.client, facture\.email\)/)
  assert.match(lire('middleware.ts'), /'\/api\/liveclub\/stripe'\]/)
  // La meme reouverture que le passage, sur les seuls comptes de ce client.
  const passage = lire('src/lib/liveclub/passage.ts')
  const fn = passage.slice(passage.indexOf('export async function reouvertureApresPaiement('), passage.indexOf('export async function passageQuotidien('))
  assert.match(fn, /await tacheReouvertures\(ctx, abonnements, new Map\(\[\[clientStripe, siens\]\]\)\)/)
  assert.match(fn, /abonnementsLiveClubDuClient\(clientStripe\)/)
  assert.match(passage, /export async function passageQuotidien\(maintenant: Date = new Date\(\)\): Promise<SynthesePassage> \{\n  const ctx = nouveauContexte\(maintenant\)/)
})

console.log(`\n${n} blocs verifies, tout est bon.`)
