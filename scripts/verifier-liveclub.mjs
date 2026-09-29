// Verification locale des fonctions PURES du Live Club (src/lib/liveclub/pur.ts).
// Pas de lanceur de tests dans le journal : Node 22 supprime les types tout
// seul, donc ce script importe le .ts directement. Aucune base, aucun reseau.
// Lancement : node scripts/verifier-liveclub.mjs

import assert from 'node:assert/strict'
import {
  dateIso, ajouterJours, joursEntre, formaterDateFr,
  finPeriodeAbonnement, calculerReprisePause, nbMoisPauseValide,
  statutDonneDroit, statutTermine, resumerAbonnement, abonnementOuvreLeGroupe,
  meilleurAbonnement, memePayeur, metadonneesPause, preparerPoseDePause, metadonneesAdoption,
  effacementMetadonneesPause,
  genererJeton, jetonBienForme, normaliserEmail, decouperEmails, requeteRechercheEmail,
  nomLienInvitation, callbackDataValide, echapperHtml, relationAbsente,
} from '../src/lib/liveclub/pur.ts'

const PRODUITS = ['prod_UcOraPncQlbrW4', 'prod_UynMpOvBtGTsIw']
let n = 0
const test = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

test('dates', () => {
  assert.equal(dateIso(new Date('2026-09-29T23:30:00Z')), '2026-09-29')
  assert.equal(dateIso(ajouterJours(new Date('2026-09-29T00:00:00Z'), 7)), '2026-10-06')
  assert.equal(joursEntre('2026-09-29', '2026-10-06'), 7)
  assert.equal(joursEntre('2026-10-06', '2026-09-29T12:00:00Z'), -7)
  assert.equal(formaterDateFr('2026-10-12'), '12 octobre 2026')
  assert.equal(formaterDateFr('2026-08-01T10:00:00Z'), '1er août 2026')
})

test('regle de la pause (clover : items d abord)', () => {
  const fin = Date.parse('2026-10-15T08:00:00Z') / 1000
  assert.equal(finPeriodeAbonnement({ items: { data: [{ current_period_end: fin }] }, current_period_end: 1 }), fin)
  assert.equal(finPeriodeAbonnement({ current_period_end: fin }), fin)
  assert.equal(finPeriodeAbonnement({}), null)
  assert.equal(calculerReprisePause(fin, 3).toISOString(), '2027-01-15T08:00:00.000Z')
  // Comportement d'origine conserve : le 31 + 1 mois deborde.
  assert.equal(dateIso(calculerReprisePause(Date.parse('2026-01-31T00:00:00Z') / 1000, 1)), '2026-03-03')
  assert.ok(nbMoisPauseValide(1) && nbMoisPauseValide(6))
  assert.ok(!nbMoisPauseValide(0) && !nbMoisPauseValide(7) && !nbMoisPauseValide(2.5) && !nbMoisPauseValide('3'))
})

test('classement des statuts', () => {
  for (const s of ['active', 'trialing', 'past_due']) assert.ok(statutDonneDroit(s), s)
  for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '']) assert.ok(!statutDonneDroit(s), s)
  for (const s of ['canceled', 'unpaid', 'incomplete_expired']) assert.ok(statutTermine(s), s)
  for (const s of ['active', 'past_due', 'incomplete']) assert.ok(!statutTermine(s), s)
})

const futur = Math.floor(Date.now() / 1000) + 60 * 86400
const abo = (extra = {}) => ({
  id: 'sub_TEST12345678', status: 'active', customer: 'cus_TEST12345678',
  items: { data: [{ current_period_end: futur, price: { product: PRODUITS[1] } }] },
  cancel_at_period_end: false, cancel_at: null, pause_collection: null,
  latest_invoice: { status: 'paid', status_transitions: { paid_at: 1_780_000_000 } },
  ...extra,
})

test('resume d un abonnement', () => {
  assert.equal(resumerAbonnement(abo({ items: { data: [{ price: { product: 'prod_AUTRE' } }] } }), PRODUITS), null)
  const r = resumerAbonnement(abo(), PRODUITS)
  assert.equal(r.produit, PRODUITS[1])
  assert.equal(r.clientStripe, 'cus_TEST12345678')
  assert.equal(r.finPeriode, new Date(futur * 1000).toISOString())
  assert.equal(r.arretPrevu, false)
  assert.equal(r.pauseActive, false)
  assert.equal(r.derniereFacture.statut, 'paid')
  assert.ok(abonnementOuvreLeGroupe(r))
  assert.ok(resumerAbonnement(abo({ cancel_at_period_end: true }), PRODUITS).arretPrevu)
  assert.ok(resumerAbonnement(abo({ customer: { id: 'cus_X' }, items: { data: [{ price: { product: { id: PRODUITS[0] } } }] } }), PRODUITS))

  // Pause programmee (periode payee pas finie) : acces garde.
  const programmee = resumerAbonnement(abo({ pause_collection: { behavior: 'void', resumes_at: futur + 90 * 86400 } }), PRODUITS)
  assert.ok(programmee.pauseActive && !programmee.pauseEffective)
  assert.ok(abonnementOuvreLeGroupe(programmee))
  // Pause en cours (periode payee notee a la pose, et finie) : statut
  // 'active' mais plus d'acces.
  const reprise = futur + 90 * 86400
  const passe = Math.floor(Date.now() / 1000) - 86400
  const meta = (finSec, repriseSec) => Object.fromEntries(
    Object.entries(metadonneesPause(finSec, new Date(repriseSec * 1000))).map(([k, v]) => [k.slice(9, -1), v]))
  assert.deepEqual(Object.keys(metadonneesPause(passe, new Date(reprise * 1000))),
    ['metadata[liveclub_paye_jusquau]', 'metadata[liveclub_pause_reprise]'])
  const effective = resumerAbonnement(abo({
    pause_collection: { behavior: 'void', resumes_at: reprise },
    metadata: meta(passe, reprise),
  }), PRODUITS)
  assert.ok(effective.pauseEffective)
  assert.equal(effective.pausePayeJusquau, new Date(passe * 1000).toISOString())
  assert.ok(!abonnementOuvreLeGroupe(effective))
  // Periode payee notee mais pas finie : acces garde, meme si la derniere
  // facture est annulee (correction manuelle AVANT la pose, constat relecteur).
  const payeeEncore = resumerAbonnement(abo({
    pause_collection: { behavior: 'void', resumes_at: reprise },
    metadata: meta(futur, reprise),
    latest_invoice: { status: 'void', status_transitions: {} },
  }), PRODUITS)
  assert.ok(payeeEncore.pauseActive && !payeeEncore.pauseEffective)
  assert.ok(abonnementOuvreLeGroupe(payeeEncore))
  // Pause posee sans nos metadonnees (Dashboard) + facture annulee : on ne
  // sait pas quand elle commence, personne ne sort.
  const sansMeta = resumerAbonnement(abo({
    pause_collection: { behavior: 'void', resumes_at: reprise },
    latest_invoice: { status: 'void', status_transitions: {} },
  }), PRODUITS)
  assert.ok(sansMeta.pauseActive && !sansMeta.pauseEffective && sansMeta.pausePayeJusquau === null)
  // Sceau different (reprise modifiee au Dashboard) sans paiement apres la fin
  // notee : c'est la meme pause, la fin notee tient, a re-sceller.
  const modifiee = resumerAbonnement(abo({
    pause_collection: { behavior: 'void', resumes_at: reprise },
    metadata: meta(passe, reprise - 30 * 86400),
  }), PRODUITS)
  assert.ok(modifiee.pauseEffective && modifiee.pauseADater)
  // Metadonnees d'une ANCIENNE pause, dementies par une facture payee apres
  // la fin notee : ignorees, pause a dater, personne ne sort.
  const perimee = resumerAbonnement(abo({
    pause_collection: { behavior: 'void', resumes_at: reprise },
    metadata: meta(passe, reprise - 30 * 86400),
    latest_invoice: { status: 'paid', status_transitions: { paid_at: Math.floor(Date.now() / 1000) } },
  }), PRODUITS)
  assert.ok(!perimee.pauseEffective && perimee.pauseADater && perimee.pausePayeJusquau === null)
  // Plus de pause du tout : metadonnees restantes sans effet, mais a effacer.
  const levee = resumerAbonnement(abo({ metadata: meta(passe, reprise) }), PRODUITS)
  assert.ok(!levee.pauseEffective && !levee.pauseADater && levee.metaPauseRestante)
  assert.ok(!resumerAbonnement(abo(), PRODUITS).metaPauseRestante)
  assert.ok(!resumerAbonnement(abo({ metadata: { liveclub_paye_jusquau: '', liveclub_pause_reprise: '' } }), PRODUITS).metaPauseRestante)
  assert.ok(!effective.metaPauseRestante)
  // Arret par date (cancel_at, Dashboard) : compte comme arret prevu.
  assert.ok(resumerAbonnement(abo({ cancel_at: futur }), PRODUITS).arretPrevu)

  const fini = resumerAbonnement(abo({ status: 'canceled', ended_at: 1_780_000_000 }), PRODUITS)
  assert.equal(fini.termineLe, new Date(1_780_000_000 * 1000).toISOString())
  assert.ok(!abonnementOuvreLeGroupe(fini))
})

test('pose de pause (bot et agent du cockpit) et adoption (passage quotidien)', () => {
  const metaDe = corps => Object.fromEntries(
    Object.entries(corps).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]))

  // Pose : pause_collection + les deux metadonnees, dans le meme corps.
  const pose = preparerPoseDePause(abo(), 2)
  assert.equal(pose.finPeriodeSec, futur)
  assert.equal(pose.corps['pause_collection[behavior]'], 'void')
  assert.equal(pose.corps['pause_collection[resumes_at]'], String(Math.floor(pose.reprise.getTime() / 1000)))
  assert.deepEqual(metaDe(pose.corps), {
    liveclub_paye_jusquau: String(futur),
    liveclub_pause_reprise: String(Math.floor(pose.reprise.getTime() / 1000)),
  })
  // La pose vaut pour resumerAbonnement : datee, pas encore effective.
  const posee = resumerAbonnement(abo({
    pause_collection: { behavior: 'void', resumes_at: Math.floor(pose.reprise.getTime() / 1000) },
    metadata: metaDe(pose.corps),
  }), PRODUITS)
  assert.ok(posee.pauseActive && !posee.pauseEffective && !posee.pauseADater)
  assert.throws(() => preparerPoseDePause(abo(), 7))
  assert.throws(() => preparerPoseDePause(abo({ pause_collection: { behavior: 'void', resumes_at: futur + 86400 } }), 1))
  assert.throws(() => preparerPoseDePause(abo({ items: { data: [{ price: { product: PRODUITS[1] } }] } }), 1))

  // Adoption d'une pause du Dashboard, avec reprise.
  const reprise = futur + 90 * 86400
  const dashboard = abo({ pause_collection: { behavior: 'void', resumes_at: reprise } })
  assert.ok(resumerAbonnement(dashboard, PRODUITS).pauseADater)
  const adoption = metadonneesAdoption(dashboard)
  assert.equal(adoption.finPeriodeSec, futur)
  assert.equal(adoption.repriseSec, reprise)
  const adoptee = resumerAbonnement({ ...dashboard, metadata: metaDe(adoption.corps) }, PRODUITS)
  assert.ok(adoptee.pauseActive && !adoptee.pauseEffective && !adoptee.pauseADater)
  assert.equal(adoptee.pausePayeJusquau, new Date(futur * 1000).toISOString())
  assert.equal(metadonneesAdoption({ ...dashboard, metadata: metaDe(adoption.corps) }), null)
  assert.equal(adoption.finGardee, false)
  // Sceau different : a re-sceller, fin notee gardee.
  const resceau = metadonneesAdoption({ ...dashboard, metadata: metaDe(metadonneesPause(futur, new Date((reprise - 86400) * 1000))) })
  assert.ok(resceau && resceau.finGardee && resceau.finPeriodeSec === futur)

  // Adoption d'une pause sans reprise (« indefiniment ») : sceau 'sans'.
  const indefinie = abo({ pause_collection: { behavior: 'void', resumes_at: null } })
  const a2 = metadonneesAdoption(indefinie)
  assert.equal(a2.repriseSec, null)
  assert.equal(metaDe(a2.corps).liveclub_pause_reprise, 'sans')
  const passe = Math.floor(Date.now() / 1000) - 86400
  const indefinieEffective = resumerAbonnement({ ...indefinie, metadata: metaDe(metadonneesPause(passe, null)) }, PRODUITS)
  assert.ok(indefinieEffective.pauseEffective && !indefinieEffective.pauseADater)
  // Pause « indefiniment » datee plus tard au Dashboard : meme pause, la fin
  // notee reste (effective), seul le sceau est a refaire.
  const datee = resumerAbonnement({ ...dashboard, metadata: metaDe(metadonneesPause(passe, null)) }, PRODUITS)
  assert.ok(datee.pauseEffective && datee.pauseADater)

  // Rien a adopter : pas de pause, ou pause dont la reprise est passee.
  assert.equal(metadonneesAdoption(abo()), null)
  assert.equal(metadonneesAdoption(abo({ pause_collection: { behavior: 'void', resumes_at: passe } })), null)
})

test('levee de pause et metadonnees (constats relecteur 29/09)', () => {
  const metaDe = corps => Object.fromEntries(
    Object.entries(corps).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]))
  const maintenant = Math.floor(Date.now() / 1000)
  const passe = maintenant - 60 * 86400

  // L'effacement vide les deux cles (valeur vide = cle supprimee chez Stripe).
  assert.deepEqual(effacementMetadonneesPause(), {
    'metadata[liveclub_paye_jusquau]': '', 'metadata[liveclub_pause_reprise]': '',
  })

  // Constat 1 : metadonnees 'sans' d'une ancienne pause levee sans effacement,
  // le membre a repaye, nouvelle pause « indefiniment » : pas de sortie
  // immediate, pause a dater avec la fin de periode en cours.
  const repaye = abo({
    pause_collection: { behavior: 'void', resumes_at: null },
    metadata: metaDe(metadonneesPause(passe, null)),
    latest_invoice: { status: 'paid', status_transitions: { paid_at: maintenant - 86400 } },
  })
  const r1 = resumerAbonnement(repaye, PRODUITS)
  assert.ok(r1.pauseADater && !r1.pauseEffective && r1.pausePayeJusquau === null)
  const a1 = metadonneesAdoption(repaye)
  assert.ok(a1 && !a1.finGardee && a1.finPeriodeSec === futur)
  assert.equal(metaDe(a1.corps).liveclub_pause_reprise, 'sans')

  // Constat 2 : pause posee par le bot (fin F0 passee, membre sorti), puis
  // reprise prolongee au Dashboard. Stripe a fait avancer current_period_end
  // (futur) et la facture du cycle suivant est annulee. La pause reste
  // effective avec F0, et l'adoption garde F0 en changeant le sceau.
  const r0 = passe + 90 * 86400
  const r1Sec = r0 + 30 * 86400
  const prolongee = abo({
    pause_collection: { behavior: 'void', resumes_at: r1Sec },
    metadata: metaDe(metadonneesPause(passe, new Date(r0 * 1000))),
    latest_invoice: { status: 'void', status_transitions: {} },
  })
  const p = resumerAbonnement(prolongee, PRODUITS)
  assert.ok(p.pauseEffective && p.pauseADater && !abonnementOuvreLeGroupe(p))
  assert.equal(p.pausePayeJusquau, new Date(passe * 1000).toISOString())
  const a2 = metadonneesAdoption(prolongee)
  assert.ok(a2 && a2.finGardee && a2.finPeriodeSec === passe && a2.repriseSec === r1Sec)
  assert.equal(metaDe(a2.corps).liveclub_pause_reprise, String(r1Sec))
  const rescellee = resumerAbonnement({ ...prolongee, metadata: metaDe(a2.corps) }, PRODUITS)
  assert.ok(rescellee.pauseEffective && !rescellee.pauseADater)
  assert.equal(metadonneesAdoption({ ...prolongee, metadata: metaDe(a2.corps) }), null)
})

test('meilleur abonnement', () => {
  const a = resumerAbonnement(abo({ id: 'sub_A' }), PRODUITS)
  const b = resumerAbonnement(abo({ id: 'sub_B', items: { data: [{ current_period_end: futur + 86400, price: { product: PRODUITS[0] } }] } }), PRODUITS)
  const c = resumerAbonnement(abo({ id: 'sub_C', status: 'canceled' }), PRODUITS)
  assert.equal(meilleurAbonnement([a, b, c]).id, 'sub_B')
  assert.equal(meilleurAbonnement([c]), null)
  assert.equal(meilleurAbonnement([]), null)
})

test('meme payeur', () => {
  const ancien = { client_stripe: 'cus_1', email: 'a@b.fr', membre_id: 'm1' }
  assert.ok(memePayeur(ancien, { clientStripe: 'cus_1', email: null, membreId: null }))
  assert.ok(!memePayeur(ancien, { clientStripe: 'cus_2', email: 'a@b.fr', membreId: null }))
  assert.ok(memePayeur(ancien, { clientStripe: null, email: 'a@b.fr', membreId: null }))
  assert.ok(!memePayeur(ancien, { clientStripe: null, email: 'z@b.fr', membreId: 'm1' }))
  assert.ok(memePayeur(ancien, { clientStripe: null, email: null, membreId: 'm1' }))
  assert.ok(!memePayeur(ancien, { clientStripe: null, email: null, membreId: null }))
})

test('jetons', () => {
  const vus = new Set()
  for (let i = 0; i < 500; i++) {
    const j = genererJeton()
    assert.equal(j.length, 24)
    assert.ok(/^[A-Za-z0-9_-]{24}$/.test(j), j)
    assert.ok(jetonBienForme(j))
    vus.add(j)
  }
  assert.equal(vus.size, 500)
  // Tient dans un param de /start (<= 64 caracteres [A-Za-z0-9_-]).
  assert.ok(!jetonBienForme('court') && !jetonBienForme('a'.repeat(25)) && !jetonBienForme('a'.repeat(23) + '!') && !jetonBienForme(null))
})

test('emails', () => {
  assert.equal(normaliserEmail('  Jean.Dupont+lc@Example.COM '), 'jean.dupont+lc@example.com')
  for (const e of ['', 'pas un email', 'a@b', '@b.fr', 'a b@c.fr', 'a@b.c', 'x'.repeat(250) + '@b.fr']) {
    assert.equal(normaliserEmail(e), null, e)
  }
  assert.deepEqual(decouperEmails('a@b.fr\nc@d.fr, e@f.fr;g@h.fr  \n\n'), ['a@b.fr', 'c@d.fr', 'e@f.fr', 'g@h.fr'])
  // Recherche Stripe (insensible a la casse) : valeur entre guillemets, echappee.
  assert.equal(requeteRechercheEmail('jean.dupont@example.com'), 'email:"jean.dupont@example.com"')
  assert.equal(requeteRechercheEmail('a\\b@c.fr'), 'email:"a\\\\b@c.fr"')
})

test('telegram', () => {
  assert.equal(nomLienInvitation('x'.repeat(40)).length, 32)
  assert.equal(nomLienInvitation('   '), 'Live Club')
  assert.ok(callbackDataValide('m:abo') && callbackDataValide('c:' + 'a'.repeat(62)))
  assert.ok(!callbackDataValide('') && !callbackDataValide('c:' + 'a'.repeat(63)))
  assert.ok(!callbackDataValide('é'.repeat(33)))
  assert.equal(echapperHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  assert.ok(relationAbsente(new Error('relation "public.cockpit_liveclub_jetons" does not exist')))
  assert.ok(relationAbsente(new Error('code: 42P01')))
  assert.ok(!relationAbsente(new Error('duplicate key')))
})

console.log(`\n${n} blocs verifies, tout est bon.`)
