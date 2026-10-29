// Les paliers de Pilotage (brief E1, 30/10/2026) : le palier selon la raison,
// le compteur des lectures sur 30 jours glissants, les 25 offertes de la
// premiere semaine consommees d'abord, le 429 au-dela, l'equipe sans limite,
// le coffre et les tranches par palier, le Duo qui ouvre le Carnet, l'achat
// (session d'abonnement, retour, abonnement relu), puis le bornage au userId
// et le CORS des nouvelles routes. Fonctions pures et lecture du code : aucune
// base, aucun reseau.
// node scripts/verifier-pilotage-paliers.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const P = await import('../src/lib/pilotage-paliers.ts')
const IA = await import('../src/lib/documents-pilotage-ia.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')
const J = 24 * 3600 * 1000
const MAINTENANT = new Date('2026-11-20T12:00:00.000Z')
const il = jours => new Date(MAINTENANT.getTime() - jours * J)
const serie = (nombre, depuisJours, pasJours = 0.01) => Array.from({ length: nombre }, (_, k) => il(depuisJours - k * pasJours))

// ── Le palier ────────────────────────────────────────────────────────────────

bloc('palier : equipe, Duo, Pilotage Premium, raisons Club du Carnet ; Carnet Premium seul et rien = libre', () => {
  const r = (o) => P.resoudrePalier({ sansPlafond: false, produits: [], raisonCarnet: null, ...o })
  assert.deepEqual(r({ sansPlafond: true, produits: ['premium-duo'] }), { palier: 'equipe', raison: 'equipe' })
  assert.deepEqual(r({ produits: ['pilotage-premium', 'premium-duo'] }), { palier: 'premium', raison: 'premium-duo' })
  assert.deepEqual(r({ produits: ['pilotage-premium'], raisonCarnet: 'liveclub' }), { palier: 'premium', raison: 'pilotage-premium' })
  for (const raison of ['etm', 'manuel', 'liveclub', 'skool-vip', 'skool-premium', 'formation']) {
    assert.deepEqual(r({ raisonCarnet: raison }), { palier: 'premium', raison }, raison)
  }
  assert.deepEqual(r({ raisonCarnet: 'carnet-premium' }), { palier: 'libre', raison: null })
  assert.deepEqual(r({ raisonCarnet: 'duo' }), { palier: 'libre', raison: null }) // le Duo se lit par l'abonnement, pas par le Carnet
  assert.deepEqual(r({}), { palier: 'libre', raison: null })
  // La liste recopiee est celle de ia-niveau.ts (ce module pur n'importe rien).
  const club = /export const RAISONS_CLUB: MentoratReason\[\] = \[([^\]]+)\]/.exec(lire('../src/lib/ia-niveau.ts'))[1]
  assert.deepEqual(club.split(',').map(s => s.trim().replace(/'/g, '')), [...P.RAISONS_CLUB_PILOTAGE])
  // Les offres demandees par Pilotage (brief E2) et les slugs en base.
  assert.equal(P.offreDemandee('premium-mensuel'), 'pilotage-premium-mensuel')
  assert.equal(P.offreDemandee('duo-annuel'), 'premium-duo-annuel')
  assert.equal(P.offreDemandee('premium-duo-mensuel'), 'premium-duo-mensuel')
  for (const x of ['premium', 'module-x', '', null, 3, 'toString', '__proto__']) assert.equal(P.offreDemandee(x), null, String(x))
  assert.deepEqual(P.TARIFS, { premiumMensuel: 5.99, premiumAnnuel: 57, duoMensuel: 8.99, duoAnnuel: 79 })
  assert.deepEqual(Object.values(P.CATALOGUE).map(c => [c.centimes, c.rythme]), [[599, 'month'], [5700, 'year'], [899, 'month'], [7900, 'year']])
})

// ── Les lectures ─────────────────────────────────────────────────────────────

bloc('compteur : 30 jours glissants, premium 200, la 201e refusee, la plus ancienne sort de la fenetre', () => {
  const c = (dates, palier = 'premium') => P.compterLectures({ palier, dates, premiere: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null, maintenant: MAINTENANT })
  const vieilles = serie(5, 40) // hors fenetre
  const r = c([...vieilles, ...serie(3, 20)])
  assert.deepEqual(r.lectures, { utilisees: 3, limite: 200, offertes: 0, jusquAu: new Date(il(20).getTime() + 30 * J).toISOString() })
  assert.equal(r.autorise, true)
  assert.equal(c(serie(199, 25, 0.1)).autorise, true)
  const pleine = c(serie(200, 25, 0.1))
  assert.equal(pleine.autorise, false)
  assert.equal(pleine.lectures.utilisees, 200)
  // jusquAu = le jour ou la plus ancienne lecture comptee sort : une lecture se libere.
  assert.equal(pleine.lectures.jusquAu, new Date(il(25).getTime() + 30 * J).toISOString())
  assert.equal(c([]).lectures.jusquAu, null)
  // La fenetre : 30 jours pile.
  assert.equal(c([il(30.001)]).lectures.utilisees, 0)
  assert.equal(c([il(29.999)]).lectures.utilisees, 1)
})

bloc('offertes : 25 la premiere semaine, consommees avant les 10, valables 7 jours depuis la premiere lecture', () => {
  const libre = (dates, premiere = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null) =>
    P.compterLectures({ palier: 'libre', dates, premiere, maintenant: MAINTENANT })
  // Rien lu : les 25 devant soi, la semaine commencera a la premiere lecture.
  const neuf = libre([])
  assert.deepEqual(neuf.lectures, { utilisees: 0, limite: 10, offertes: 25, jusquAu: new Date(MAINTENANT.getTime() + 7 * J).toISOString() })
  assert.equal(neuf.autorise, true)
  // 3 lues depuis 2 jours : 22 offertes jusqu'au 7e jour, rien de compte dans les 10.
  const debut = libre(serie(3, 2))
  assert.deepEqual(debut.lectures, { utilisees: 0, limite: 10, offertes: 22, jusquAu: new Date(il(2).getTime() + 7 * J).toISOString() })
  // 30 lues dans la semaine : 25 offertes, 5 comptees ; il reste 5 sur 10.
  const trente = libre(serie(30, 3, 0.05))
  assert.equal(trente.lectures.offertes, 0)
  assert.equal(trente.lectures.utilisees, 5)
  assert.equal(trente.autorise, true)
  // Les 10 comptees en plus des 25 offertes : epuise.
  const epuise = libre(serie(35, 3, 0.05))
  assert.equal(epuise.lectures.utilisees, 10)
  assert.equal(epuise.autorise, false)
  // Semaine passee : les offertes restantes tombent, les lectures offertes ne comptent jamais dans les 10.
  const apres = libre(serie(4, 12))
  assert.deepEqual(apres.lectures, { utilisees: 0, limite: 10, offertes: 0, jusquAu: null })
  const apres2 = libre([...serie(4, 12), ...serie(9, 2)])
  assert.equal(apres2.lectures.utilisees, 9)
  assert.equal(apres2.autorise, true)
  assert.equal(libre([...serie(4, 12), ...serie(10, 2)]).autorise, false)
  // Premiere lecture il y a 35 jours (hors fenetre) : sa semaine est loin, tout compte.
  assert.equal(libre(serie(10, 20), il(35)).autorise, false)
  // Premium : pas d'offertes.
  assert.equal(P.compterLectures({ palier: 'premium', dates: serie(3, 2), premiere: il(2), maintenant: MAINTENANT }).lectures.offertes, 0)
  // Depuis quand lire : la premiere lecture si sa semaine touche la fenetre.
  assert.equal(P.debutDesLectures(il(33), MAINTENANT).getTime(), il(33).getTime())
  assert.equal(P.debutDesLectures(il(40), MAINTENANT).getTime(), il(30).getTime())
  assert.equal(P.debutDesLectures(il(3), MAINTENANT).getTime(), il(30).getTime())
  assert.equal(P.debutDesLectures(null, MAINTENANT).getTime(), il(30).getTime())
  // Apres une lecture : le compteur rendu avec la lecture.
  const apresLecture = P.apresUneLecture({ palier: 'libre', dates: [], premiere: null, maintenant: MAINTENANT })
  assert.equal(apresLecture.lectures.offertes, 24)
  assert.equal(apresLecture.lectures.jusquAu, new Date(MAINTENANT.getTime() + 7 * J).toISOString())
})

bloc('429 au-dela : message, quota { utilisees, limite, offertes, jusquAu, palier } ; la route refuse apres la lecture sans IA', () => {
  const c = P.compterLectures({ palier: 'libre', dates: [...serie(4, 12), ...serie(10, 2)], premiere: il(12), maintenant: MAINTENANT })
  assert.equal(c.autorise, false)
  assert.deepEqual(Object.keys(P.quotaDe(c, 'libre')), ['utilisees', 'limite', 'offertes', 'jusquAu', 'palier'])
  assert.equal(P.quotaDe(c, 'libre').palier, 'libre')
  assert.equal(P.MESSAGE_LECTURES_EPUISEES, 'Tes lectures du mois sont épuisées.')
  const route = lire('../src/app/api/pilotage/documents/lire/route.ts')
  assert.match(route, /if \(!etat\.autorise\) return NextResponse\.json\(\{ error: MESSAGE_LECTURES_EPUISEES, quota \}, \{ status: 429, headers: cors \}\)/)
  assert.ok(route.indexOf("if ('lecture' in prep)") < route.indexOf('if (!etat.autorise)'))
  assert.match(route, /quota = quotaDe\(apresUneLecture\(\{ \.\.\.etat\.entree, maintenant: new Date\(\) \}\), etat\.palier\)/)
  assert.match(route, /lireParIA\(userId, prep, nom, data, etat\.palier\)/)
  assert.match(route, /garderDocument\(userId, \{ nom, mime: nature\.mime, octets, lecture: fin\.lecture \}, etat\.palier\)/)
  assert.ok(!route.includes('MESSAGE_LIMITE') && !route.includes('lusParIaAujourdhui'))
})

bloc('equipe : sans limite, jamais refusee, comptee quand meme', () => {
  const e = P.compterLectures({ palier: 'equipe', dates: serie(1000, 20, 0.01), premiere: il(20), maintenant: MAINTENANT })
  assert.deepEqual(e, { autorise: true, lectures: { utilisees: 1000, limite: null, offertes: 0, jusquAu: null } })
})

// ── Le coffre et les tranches ───────────────────────────────────────────────

bloc('coffre par palier : 100 Mo, 2 Go, 10 Go ; message selon le palier', () => {
  const MO = 1024 * 1024
  assert.deepEqual(P.COFFRE_PAR_PALIER, { libre: 100 * MO, premium: 2048 * MO, equipe: 10240 * MO })
  assert.equal(P.coffrePlein('libre', 100 * MO - 10, 10), false)
  assert.equal(P.coffrePlein('libre', 100 * MO - 10, 11), true)
  assert.equal(P.coffrePlein('premium', 100 * MO, 50 * MO), false)
  assert.equal(P.coffrePlein('premium', 2048 * MO, 1), true)
  assert.equal(P.coffrePlein('equipe', 5000 * MO, 1), false)
  assert.match(P.messageCoffrePlein('libre'), /\(100 Mo\).*Premium garde 2 Go\./)
  assert.match(P.messageCoffrePlein('premium'), /\(2 Go\)/)
  assert.ok(!P.messageCoffrePlein('premium').includes('Premium garde'))
})

bloc('tranches par palier : une en libre (le debut, « Premium lit en entier »), 4 en premium et equipe', () => {
  assert.deepEqual(P.TRANCHES_PAR_PALIER, { libre: 1, premium: 4, equipe: 4 })
  const entete = ['Releve du compte ESSAI-001', 'Date;Symbole;Resultat']
  const lignes = k => Array.from({ length: k }, (_, i) => `2026-10-${String((i % 28) + 1).padStart(2, '0')};NQ;${i}`)
  const texte = [...entete, ...lignes(60)].join('\n')
  const libre = IA.tranchesDuTexte(texte, { appelsMax: P.TRANCHES_PAR_PALIER.libre })
  assert.equal(libre.tranches.length, 1)
  assert.equal(libre.coupe, true)
  assert.ok(libre.tranches[0].texte.length < texte.length)
  const premium = IA.tranchesDuTexte(texte, { appelsMax: P.TRANCHES_PAR_PALIER.premium })
  assert.equal(premium.tranches.length, 3)
  assert.equal(premium.coupe, false)
  // Le serveur : la tranche seule part a l'IA en libre, la remarque est ajoutee.
  const serveur = lire('../src/lib/documents-serveur.ts')
  assert.match(serveur, /const tranchesMax = TRANCHES_PAR_PALIER\[palier\]/)
  assert.match(serveur, /\? \{ \.\.\.prepIA, texte: decoupe\.tranches\[0\]\.texte, coupe: true \}/)
  assert.match(serveur, /const enPartie = !!decoupe\?\.coupe && tranchesMax < TRANCHES_PAR_PALIER\.premium/)
  assert.match(serveur, /if \(enPartie\) lecture\.remarque = `\$\{lecture\.remarque\} \$\{REMARQUE_LU_EN_PARTIE\}`/)
  assert.equal(P.REMARQUE_LU_EN_PARTIE, 'Lu en partie : Premium lit les documents longs en entier.')
})

// ── Le Duo ouvre le Carnet ──────────────────────────────────────────────────

bloc('Duo : raison duo dans entitlements (meme palier que carnet-premium), pas une raison Club, pas l essai de l academie', () => {
  const ent = lire('../src/lib/entitlements.ts')
  assert.match(ent, /export type MentoratReason = [^\n]*'duo'/)
  assert.match(ent, /where o\.slug in \('premium-duo-mensuel', 'premium-duo-annuel'\)\s*and a\.retire_le is null and a\.debut <= now\(\) and \(a\.fin is null or a\.fin > now\(\)\)\s*and \(a\.user_id = \$\{userId\}::uuid or a\.email = \$\{email\}\)/)
  assert.match(ent, /if \(duo\.length > 0\) return \{ entitled: true, reason: 'duo', email \}/)
  // Lu avant la verification Stripe en direct du Carnet Premium.
  assert.ok(ent.indexOf("reason: 'duo'") < ent.indexOf("reason: 'carnet-premium'"))
  assert.deepEqual([...P.SLUGS_DUO], ['premium-duo-mensuel', 'premium-duo-annuel'])
  // ia-niveau : hors RAISONS_CLUB, donc palier premium du Carnet (comme carnet-premium).
  const niv = lire('../src/lib/ia-niveau.ts')
  assert.match(niv, /const niveau: NiveauIA = RAISONS_CLUB\.includes\(acces\.reason\) \? 'club' : 'premium'/)
  assert.ok(!/RAISONS_CLUB[^\n]*'duo'/.test(niv))
  assert.match(lire('../src/lib/academie/droits.ts'), /Exclude<MentoratReason, 'carnet-premium' \| 'duo'>/)
})

// ── L'achat ─────────────────────────────────────────────────────────────────

bloc('achat : retour sur /offres de Pilotage seulement, session en mode abonnement, compte pose par le serveur', () => {
  assert.equal(P.retourPilotage('/offres', 'https://pilotage.aoknowledge.com'), 'https://pilotage.aoknowledge.com/offres?session_id={CHECKOUT_SESSION_ID}')
  assert.equal(P.retourPilotage('/offres', 'http://localhost:3210'), 'http://localhost:3210/offres?session_id={CHECKOUT_SESSION_ID}')
  assert.equal(P.retourPilotage('/offres', 'https://pirate.example'), 'https://pilotage.aoknowledge.com/offres?session_id={CHECKOUT_SESSION_ID}')
  assert.equal(P.retourPilotage(undefined, null), 'https://pilotage.aoknowledge.com/offres?session_id={CHECKOUT_SESSION_ID}')
  for (const x of ['//pirate.example', '/offres/x', 'https://pirate.example/offres', '/academie/x', 3]) assert.equal(P.retourPilotage(x, null), null, String(x))
  const c = P.corpsSessionAbonnement({ slug: 'premium-duo-annuel', prix: 'price_123', retourUrl: 'https://pilotage.aoknowledge.com/offres?session_id={CHECKOUT_SESSION_ID}', userId: 'u1', email: 'a@b.fr', essai: true })
  assert.equal(c.get('mode'), 'subscription')
  assert.equal(c.get('ui_mode'), 'embedded')
  assert.equal(c.get('line_items[0][price]'), 'price_123')
  assert.equal(c.get('client_reference_id'), 'u1')
  assert.equal(c.get('customer_email'), 'a@b.fr')
  assert.equal(c.get('metadata[source]'), 'pilotage')
  assert.equal(c.get('subscription_data[metadata][pilotage_offre]'), 'premium-duo-annuel')
  assert.equal(c.get('subscription_data[metadata][user_id]'), 'u1')
  assert.equal(c.get('subscription_data[metadata][essai]'), '1')
  assert.equal(c.get('subscription_data[description]'), 'Premium Duo (Carnet + Pilotage)')
  assert.equal(c.get('consent_collection[terms_of_service]'), 'required')
  assert.match(c.get('custom_text[terms_of_service_acceptance][message]'), /accès immédiat à Premium Duo/)
  assert.equal(c.get('customer_creation'), null) // refuse par Stripe en mode abonnement
  const anonyme = P.corpsSessionAbonnement({ slug: 'pilotage-premium-mensuel', prix: 'price_1', retourUrl: 'x', userId: null, email: null, essai: false })
  assert.equal(anonyme.get('client_reference_id'), null)
  assert.equal(anonyme.get('customer_email'), null)
  assert.equal(anonyme.get('subscription_data[metadata][essai]'), '0')
})

bloc('achat : session relue, abonnement relu (fin + 3 jours, offre par metadata ou par prix), facture, charge', () => {
  const uid = '11111111-2222-3333-4444-555555555555'
  const session = {
    id: 'cs_test_a1b2c3d4e5f6', mode: 'subscription', status: 'complete', payment_status: 'paid', subscription: 'sub_ABC123def',
    client_reference_id: uid.toUpperCase(), customer_details: { email: ' Acheteur@Exemple.fr ' }, created: 1793000000,
    consent: { terms_of_service: 'accepted' }, metadata: { source: 'pilotage', pilotage_offre: 'pilotage-premium-annuel', essai: '1' },
  }
  const lu = P.lireSessionPilotage(session)
  assert.deepEqual(lu, {
    ok: true, sessionId: session.id, abonnementId: 'sub_ABC123def', offre: 'pilotage-premium-annuel', userId: uid,
    email: 'acheteur@exemple.fr', essai: true, renonciationLe: new Date(1793000000 * 1000),
  })
  assert.deepEqual(P.lireSessionPilotage({ ...session, metadata: { source: 'academie' } }), { ok: false, raison: 'pas_pilotage' })
  assert.deepEqual(P.lireSessionPilotage({ ...session, mode: 'payment' }), { ok: false, raison: 'pas_pilotage' })
  assert.deepEqual(P.lireSessionPilotage({ ...session, status: 'open' }), { ok: false, raison: 'incomplet' })
  assert.deepEqual(P.lireSessionPilotage({ ...session, payment_status: 'unpaid' }), { ok: false, raison: 'en_attente' })
  assert.deepEqual(P.lireSessionPilotage({ ...session, subscription: { id: 'sub_ABC123def' } }).abonnementId, 'sub_ABC123def')
  assert.equal(P.lireSessionPilotage({ ...session, consent: null }).renonciationLe, null)

  const fin = 1795000000
  const ab = {
    id: 'sub_ABC123def', status: 'active', metadata: { pilotage_offre: 'premium-duo-mensuel', user_id: uid },
    customer: { id: 'cus_X1', email: 'Client@Exemple.fr' }, latest_invoice: 'in_123456',
    items: { data: [{ price: { id: 'price_duo' }, current_period_end: fin }] },
  }
  const a = P.lireAbonnement(ab)
  assert.equal(a.actif, true)
  assert.equal(a.offre, 'premium-duo-mensuel')
  assert.equal(a.fin.getTime(), (fin + 3 * 86400) * 1000)
  assert.equal(a.clientId, 'cus_X1')
  assert.equal(a.clientEmail, 'client@exemple.fr')
  assert.equal(a.userId, uid)
  assert.equal(a.facture, 'in_123456')
  // Sans metadata : l'offre par le prix ; prix inconnu : pas Pilotage.
  const sansMeta = { ...ab, metadata: {} }
  assert.equal(P.lireAbonnement(sansMeta, p => (p === 'price_duo' ? 'premium-duo-annuel' : null)).offre, 'premium-duo-annuel')
  assert.equal(P.lireAbonnement(sansMeta).offre, null)
  // L'ancien emplacement de current_period_end ; les statuts.
  assert.equal(P.lireAbonnement({ ...ab, current_period_end: fin, items: { data: [{ price: 'price_duo' }] } }).fin.getTime(), (fin + 3 * 86400) * 1000)
  for (const s of ['active', 'trialing', 'past_due']) assert.equal(P.lireAbonnement({ ...ab, status: s }).actif, true, s)
  for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) assert.equal(P.lireAbonnement({ ...ab, status: s }).actif, false, s)
  assert.equal(P.lireAbonnement({ id: 'pas-un-abonnement' }), null)
  // La facture (clover puis ancien champ), la charge (payment.charge ou payment_intent deplie).
  assert.equal(P.abonnementDeFacture({ parent: { subscription_details: { subscription: 'sub_ABC123def' } } }), 'sub_ABC123def')
  assert.equal(P.abonnementDeFacture({ subscription: 'sub_ABC123def' }), 'sub_ABC123def')
  assert.equal(P.abonnementDeFacture({}), null)
  assert.equal(P.chargeDesPaiements([{ status: 'open', payment: { charge: 'ch_000000a' } }, { status: 'paid', payment: { payment_intent: { latest_charge: 'ch_123456b' } } }]), 'ch_123456b')
  assert.equal(P.chargeDesPaiements([{ status: 'paid', payment: { charge: 'ch_999999c' } }]), 'ch_999999c')
  assert.equal(P.chargeDesPaiements(null), null)
  // Le libelle du paiement, lu par la collecte du cockpit (MOTIFS_OFFRES de push_membres_supabase.py).
  assert.match(P.CATALOGUE['pilotage-premium-mensuel'].libellePaiement, /^Pilotage Premium/)
  assert.match(P.CATALOGUE['premium-duo-annuel'].libellePaiement, /^Premium Duo/)
})

// ── Le bornage et le CORS ───────────────────────────────────────────────────

bloc('controle statique : lectures et abonnements bornes au userId du jeton ; routes CORS de Pilotage ; webhook signe ; achat public', () => {
  const niveau = lire('../src/lib/pilotage-niveau.ts')
  const lectures = niveau.match(/prisma\.aiUsage\.\w+\(\{[\s\S]*?\}\)/g) ?? []
  assert.equal(lectures.length, 2)
  for (const l of lectures) assert.match(l, /where: \{ userId, usage: 'document'/, l.slice(0, 80))
  assert.match(niveau, /\$queryRawUnsafe<[^>]+>\(SQL_IDENTITE, userId\)/)
  const req = lire('../src/lib/pilotage-requetes.ts')
  assert.ok(!/^import /m.test(req), 'pilotage-requetes.ts n importe rien')
  assert.match(req, /and \(a\.user_id = \$1::uuid or a\.email = any\(\$2::text\[\]\)\)/)
  assert.ok(!/^import /m.test(lire('../src/lib/pilotage-paliers.ts')), 'pilotage-paliers.ts n importe rien')
  // Les emails : les verifies du compte (SQL_IDENTITE), jamais un email du corps de la requete.
  assert.match(niveau, /abonnementsDuMembre\(userId, emails\)/)

  const routes = {
    '../src/app/api/pilotage/niveau/route.ts': 'GET, OPTIONS',
    '../src/app/api/pilotage/achat/route.ts': 'POST, OPTIONS',
    '../src/app/api/pilotage/achat/confirmer/route.ts': 'GET, OPTIONS',
  }
  for (const [f, methodes] of Object.entries(routes)) {
    const source = lire(f)
    assert.ok(source.includes(`const METHODES = '${methodes}'`), f)
    assert.match(source, /export async function OPTIONS\(req: NextRequest\) \{\s*return corsPreflight\(req, METHODES\)/, f)
    assert.ok(!source.includes('prisma.'), `${f} : la base passe par les modules`)
    for (const reponse of source.match(/NextResponse\.json\([\s\S]*?\{ (status: \w+, )?headers[^}]*\}/g) ?? []) {
      assert.ok(/headers(: (cors|\{ \.\.\.cors))?/.test(reponse), reponse.slice(0, 80))
    }
  }
  const niv = lire('../src/app/api/pilotage/niveau/route.ts')
  assert.match(niv, /const cors = corsHeaders\(req, METHODES\)\s*const userId = await getUserId\(req\)\s*if \(!userId\) return NextResponse\.json\(\{ error: 'Non connecté\.' \}, \{ status: 401, headers: cors \}\)/)
  assert.match(niv, /const niveau = await niveauDuMembre\(userId\)/)
  // L'achat : le compte vient du jeton, jamais du corps ; vente fermee = essai d'un admin.
  const achat = lire('../src/app/api/pilotage/achat/route.ts')
  assert.match(achat, /userId = await compteDuJeton\(req\)/)
  assert.ok(!/corps\.(user|email|compte)/.test(achat))
  assert.match(achat, /if \(!ventePubliquePilotage\(\)\) \{\s*if \(!essai \|\| !userId\) return refus\('ferme', 403\)/)
  assert.match(achat, /if \(!admin\) return refus\('ferme', 403\)/)
  // Le webhook : signature verifiee avant toute lecture du corps.
  const wh = lire('../src/app/api/pilotage/achat/webhook/route.ts')
  assert.ok(wh.indexOf('verifierSignature(corps') < wh.indexOf('JSON.parse(corps)'))
  for (const ev of ['checkout.session.completed', 'invoice.paid', 'customer.subscription.updated', 'customer.subscription.deleted']) assert.ok(wh.includes(`'${ev}'`), ev)
  // Le middleware : les trois routes d'achat sont publiques, pas niveau.
  const mw = lire('../middleware.ts')
  assert.match(mw, /'\/api\/pilotage\/achat'\]/)
  assert.ok(!mw.includes("'/api/pilotage/niveau'"))
  // La migration : aucun point-virgule dans les commentaires ni dans les chaines (appliquer-migration.sh decoupe dessus).
  const sql = lire('../../../sites/Aoknowledgecom/supabase/migrations/20261031120000_pilotage_offres.sql')
  for (const ligne of sql.split('\n').filter(l => l.trim().startsWith('--'))) assert.ok(!ligne.includes(';'), ligne)
  for (const chaine of sql.match(/'[^']*'/g) ?? []) assert.ok(!chaine.includes(';'), chaine)
  for (const slug of P.SLUGS_OFFRES_PILOTAGE) assert.ok(sql.includes(`'${slug}'`), slug)
})

console.log(`\n${n} blocs verifies, tout est bon.`)
