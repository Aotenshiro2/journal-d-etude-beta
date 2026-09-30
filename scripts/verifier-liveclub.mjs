// Verification locale des fonctions PURES du Live Club (src/lib/liveclub/pur.ts).
// Pas de lanceur de tests dans le journal : Node 22 supprime les types tout
// seul, donc ce script importe le .ts directement. Aucune base, aucun reseau.
// Lancement : node scripts/verifier-liveclub.mjs

import assert from 'node:assert/strict'
import {
  dateIso, ajouterJours, joursEntre, formaterDateFr,
  finPeriodeAbonnement, calculerReprisePause, nbMoisPauseValide,
  statutDonneDroit, statutTermine, resumerAbonnement, abonnementOuvreLeGroupe,
  abonnementOuvreLeGroupeLe, finPayeeTerminee, finDuDroit,
  meilleurAbonnement, memePayeur, metadonneesPause, preparerPoseDePause, metadonneesAdoption,
  effacementMetadonneesPause,
  genererJeton, jetonBienForme, normaliserEmail, decouperEmails, requeteRechercheEmail,
  nomLienInvitation, callbackDataValide, echapperHtml, relationAbsente,
  montantPeriodeAbonnement, abonnementARemise, formaterMontant, pauseDejaProposee,
  lireMontant, montantsDeLaPeriode, remiseAppliquee, parPeriode, periodiciteAbonnement,
  facturesARegler, peutAvoirUnImpaye, faitsMontants, MONTANT_NON_DISPONIBLE, LIEN_NON_DISPONIBLE,
  libelleBouton, phraseGeste, expurgerLiensInvitation,
} from '../src/lib/liveclub/pur.ts'
import {
  desabonneHorsGrace, finAbonnement,
  prelevementAPrevenir, montantAAnnoncer, clePrelevement, jourParis, RAPPEL_PRELEVEMENT_JOURS,
  sortieAbusiveASignaler, sortiParMetricgram, cleSortieAbusive,
  droitCouvraitLaSortie, retourARetenter, MAX_ESSAIS_RETOUR,
} from '../src/lib/liveclub/passage-regles.ts'
import {
  GRACE_JOURS, URLS_ABONNEMENT, URL_ABONNEMENT, URL_PORTAIL_CARTE, texteAbonnement,
  ARGUMENT_TARIF_PAUSE, TEXTE_PAUSE_AVANT_ARRET,
} from '../src/lib/liveclub/config.ts'

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

  // Termine, derniere facture impayee : plus de droit (le cas « payee apres
  // la resiliation » a son propre bloc plus bas).
  const fini = resumerAbonnement(abo({
    status: 'canceled', ended_at: 1_780_000_000,
    latest_invoice: { status: 'open', status_transitions: {} },
  }), PRODUITS)
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
  const c = resumerAbonnement(abo({ id: 'sub_C', status: 'canceled', latest_invoice: { status: 'open', status_transitions: {} } }), PRODUITS)
  assert.equal(meilleurAbonnement([a, b, c]).id, 'sub_B')
  assert.equal(meilleurAbonnement([c]), null)
  assert.equal(meilleurAbonnement([]), null)
})

test('cas reel 29/09 : resilie par Stripe le 21/09, paye en retard le 28/09 pour la periode 07/09 -> 07/10', () => {
  const sec = iso => Date.parse(iso) / 1000
  const ms = iso => Date.parse(iso)
  const debut = sec('2026-09-07T14:00:00Z')
  const fin = sec('2026-10-07T14:00:00Z')
  const resilie = sec('2026-09-21T14:05:00Z')
  const facturePayee = {
    status: 'paid',
    amount_paid: 4900,
    post_payment_credit_notes_amount: 0,
    status_transitions: { paid_at: sec('2026-09-28T19:30:00Z') },
    lines: { data: [{ amount: 4900, period: { start: debut, end: fin } }] },
  }
  const brut = abo({
    id: 'sub_REEL12345678', status: 'canceled', canceled_at: resilie, ended_at: resilie,
    items: { data: [{ current_period_end: fin, price: { product: PRODUITS[1] } }] },
    latest_invoice: facturePayee,
  })
  const r = resumerAbonnement(brut, PRODUITS)
  assert.equal(r.termineLe, '2026-09-21T14:05:00.000Z')
  assert.equal(r.payeJusquau, '2026-10-07T14:00:00.000Z')
  assert.equal(finDuDroit(r), '2026-10-07T14:00:00.000Z')

  // Droit 'oui' le 29/09 (raison abonnement, fin = fin payee), 'non' apres le 07/10.
  assert.ok(abonnementOuvreLeGroupeLe(r, ms('2026-09-29T07:00:00Z')))
  assert.equal(meilleurAbonnement([r], ms('2026-09-29T07:00:00Z')).id, 'sub_REEL12345678')
  assert.ok(abonnementOuvreLeGroupeLe(r, ms('2026-10-07T13:59:00Z')))
  assert.ok(!abonnementOuvreLeGroupeLe(r, ms('2026-10-07T14:00:00Z')))
  assert.ok(!abonnementOuvreLeGroupeLe(r, ms('2026-10-08T07:00:00Z')))
  assert.equal(meilleurAbonnement([r], ms('2026-10-08T07:00:00Z')), null)

  // Passage quotidien (cron 7 h UTC) : grace de 7 jours depuis la fin payee,
  // pas depuis ended_at. Simulation de sortie seulement apres le 14/10.
  assert.equal(GRACE_JOURS, 7)
  assert.equal(finAbonnement(r), '2026-10-07T14:00:00.000Z')
  for (const jour of ['2026-09-29', '2026-10-07', '2026-10-08', '2026-10-14']) {
    assert.ok(!desabonneHorsGrace(r, new Date(`${jour}T07:00:00Z`), GRACE_JOURS), jour)
  }
  assert.ok(desabonneHorsGrace(r, new Date('2026-10-15T07:00:00Z'), GRACE_JOURS))

  // Meme abonnement SANS le paiement du 28/09 (derniere facture impayee) :
  // l'ancien comportement reste, droit 'non' et grace depuis ended_at (sortie
  // simulee des le 29/09). On ne prolonge jamais sur une facture impayee.
  for (const statut of ['open', 'uncollectible', 'void', 'draft']) {
    const impaye = resumerAbonnement({ ...brut, latest_invoice: { ...facturePayee, status: statut, status_transitions: {} } }, PRODUITS)
    assert.equal(impaye.payeJusquau, null, statut)
    assert.ok(!abonnementOuvreLeGroupeLe(impaye, ms('2026-09-29T07:00:00Z')), statut)
    assert.equal(finAbonnement(impaye), '2026-09-21T14:05:00.000Z', statut)
    assert.ok(desabonneHorsGrace(impaye, new Date('2026-09-29T07:00:00Z'), GRACE_JOURS), statut)
  }
  assert.equal(resumerAbonnement({ ...brut, latest_invoice: 'in_TEST' }, PRODUITS).payeJusquau, null)

  // Facture payee sans ses lignes : repli sur items.data[].current_period_end.
  const sansLignes = { ...brut, latest_invoice: { status: 'paid', amount_paid: 4900, status_transitions: facturePayee.status_transitions } }
  assert.equal(finPayeeTerminee(sansLignes), fin)
  // Lignes presentes mais aucune positive (avoir de prorata, ligne a zero) : rien de paye.
  assert.equal(finPayeeTerminee({ ...brut, latest_invoice: { ...facturePayee, lines: { data: [
    { amount: -1200, period: { start: resilie, end: fin } }, { amount: 0, period: { start: resilie, end: fin } },
  ] } } }), null)
  // La plus lointaine des lignes positives.
  assert.equal(finPayeeTerminee({ ...brut, latest_invoice: { ...facturePayee, lines: { data: [
    { amount: 4900, period: { start: debut, end: fin } }, { amount: 300, period: { start: debut, end: fin + 86400 } },
  ] } } }), fin + 86400)
  // Fin de l'abonnement posterieure au paiement : pas un paiement en retard,
  // rien a prolonger, la grace part de ended_at.
  const vieux = resumerAbonnement({ ...brut, ended_at: sec('2026-10-20T00:00:00Z') }, PRODUITS)
  assert.equal(vieux.payeJusquau, null)
  assert.equal(finAbonnement(vieux), '2026-10-20T00:00:00.000Z')

  // Constat relecteur 29/09 : seule une facture payee APRES la resiliation prolonge.
  // a) Resiliation immediate par l'admin le 10/09 avec remboursement : la
  //    facture reste 'paid' (payee le 07/09, avant la resiliation). Pas de
  //    prolongation, sortie a ended_at + 7 jours comme avant.
  const le10 = sec('2026-09-10T10:00:00Z')
  const immediate = resumerAbonnement({
    ...brut, canceled_at: le10, ended_at: le10,
    latest_invoice: { ...facturePayee, status_transitions: { paid_at: debut } },
  }, PRODUITS)
  assert.equal(immediate.payeJusquau, null)
  assert.ok(!abonnementOuvreLeGroupeLe(immediate, ms('2026-09-11T07:00:00Z')))
  assert.equal(finAbonnement(immediate), '2026-09-10T10:00:00.000Z')
  assert.ok(!desabonneHorsGrace(immediate, new Date('2026-09-17T07:00:00Z'), GRACE_JOURS))
  assert.ok(desabonneHorsGrace(immediate, new Date('2026-09-18T07:00:00Z'), GRACE_JOURS))
  // b) Facture a 0 payee apres la resiliation (coupon a 100 %, solde crediteur) : rien d'encaisse.
  assert.equal(finPayeeTerminee({ ...brut, latest_invoice: { ...facturePayee, amount_paid: 0 } }), null)
  const factureSansMontant = { ...facturePayee }
  delete factureSansMontant.amount_paid
  assert.equal(finPayeeTerminee({ ...brut, latest_invoice: factureSansMontant }), null)
  // c) Paiement en retard puis avoir (remboursement total ou partiel) : pas de prolongation.
  assert.equal(finPayeeTerminee({ ...brut, latest_invoice: { ...facturePayee, post_payment_credit_notes_amount: 4900 } }), null)
  assert.equal(finPayeeTerminee({ ...brut, latest_invoice: { ...facturePayee, post_payment_credit_notes_amount: 100 } }), null)
  // d) Date de paiement absente, ou pile a la resiliation : pas de prolongation.
  assert.equal(finPayeeTerminee({ ...brut, latest_invoice: { ...facturePayee, status_transitions: {} } }), null)
  assert.equal(finPayeeTerminee({ ...brut, latest_invoice: { ...facturePayee, status_transitions: { paid_at: resilie } } }), null)
  // e) Aucune date de fin (ni canceled_at ni ended_at) : pas de prolongation.
  assert.equal(finPayeeTerminee({ ...brut, status: 'unpaid', canceled_at: null, ended_at: null }), null)
  // f) Resiliation en fin de periode demandee le 15/09, facture payee le 07/09 :
  //    payeJusquau null, rien de perdu, la fin reste ended_at = 07/10.
  const finDePeriode = resumerAbonnement({
    ...brut, canceled_at: sec('2026-09-15T09:00:00Z'), ended_at: fin,
    latest_invoice: { ...facturePayee, status_transitions: { paid_at: debut } },
  }, PRODUITS)
  assert.equal(finDePeriode.payeJusquau, null)
  assert.equal(finAbonnement(finDePeriode), '2026-10-07T14:00:00.000Z')
  // g) Paiement apres canceled_at mais avant ended_at : la borne est la plus tardive des deux.
  assert.equal(finPayeeTerminee({
    ...brut, canceled_at: sec('2026-09-15T09:00:00Z'), ended_at: sec('2026-09-30T00:00:00Z'),
  }), null)

  // 'unpaid' et 'incomplete_expired' suivent la meme regle ; un abonnement
  // vivant n'a pas de payeJusquau (son droit vient de son statut).
  const unpaid = resumerAbonnement({ ...brut, status: 'unpaid', ended_at: null }, PRODUITS)
  assert.equal(unpaid.payeJusquau, '2026-10-07T14:00:00.000Z')
  assert.ok(abonnementOuvreLeGroupeLe(unpaid, ms('2026-09-29T07:00:00Z')))
  assert.equal(finAbonnement(unpaid, '2026-09-07T14:00:00.000Z'), '2026-10-07T14:00:00.000Z')
  assert.equal(finAbonnement(unpaid, null), null)
  assert.equal(resumerAbonnement({ ...brut, status: 'incomplete_expired' }, PRODUITS).payeJusquau, '2026-10-07T14:00:00.000Z')
  assert.equal(resumerAbonnement({ ...brut, status: 'active', canceled_at: null, ended_at: null }, PRODUITS).payeJusquau, null)
  assert.equal(finPayeeTerminee({ ...brut, status: 'past_due' }), null)

  // Le callback a un parametre ne prend pas l'index du tableau pour une date.
  assert.equal([r].some(abonnementOuvreLeGroupe), Date.now() < ms('2026-10-07T14:00:00Z'))
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

test('deux portes d abonnement et portail carte (Brice 29/09)', () => {
  assert.deepEqual([...URLS_ABONNEMENT], ['https://aoknowledge.com/live-club', 'https://melaniechart.com'])
  assert.equal(URL_ABONNEMENT, URLS_ABONNEMENT[0])
  const t = texteAbonnement()
  for (const u of URLS_ABONNEMENT) assert.ok(t.includes(u), u)
  // Pas de ponctuation collee a la derniere adresse (elle entrerait dans le lien).
  assert.ok(t.endsWith(URLS_ABONNEMENT[1]))
  assert.ok(/^[\x20-\x7eÀ-ÿ]+$/.test(t), 'caracteres clavier seulement')
  assert.ok(URL_PORTAIL_CARTE.startsWith('https://billing.stripe.com/p/login/'))
})

test('pause proposee une fois avant l arret (Brice 30/09)', () => {
  // Le texte porte l'argument du tarif, en caracteres clavier.
  assert.ok(TEXTE_PAUSE_AVANT_ARRET.includes(ARGUMENT_TARIF_PAUSE))
  assert.ok(/1 à 6 mois/.test(TEXTE_PAUSE_AVANT_ARRET) && /fin de ta période déjà payée/.test(TEXTE_PAUSE_AVANT_ARRET))
  for (const ligne of TEXTE_PAUSE_AVANT_ARRET.split('\n')) assert.ok(/^[\x20-\x7eÀ-ÿ]*$/.test(ligne), ligne)
  assert.ok(callbackDataValide('m:arret_ok'))

  const maintenant = Date.parse('2026-09-30T12:00:00Z')
  const il = h => new Date(maintenant - h * 3_600_000).toISOString()
  const echange = (reponse, at) => [
    { role: 'user', content: 'Je veux arrêter.', at },
    { role: 'assistant', content: reponse, at },
  ]
  // Proposee juste avant (texte du serveur, ou argument redit par l'agent) : oui.
  assert.ok(pauseDejaProposee(echange(TEXTE_PAUSE_AVANT_ARRET, il(0.1)), maintenant))
  assert.ok(pauseDejaProposee(echange('Tu peux aussi faire une pause : elle garde ton tarif actuel.', il(1)), maintenant))
  // Sans horodatage (eval, vieux historiques) : compte aussi.
  assert.ok(pauseDejaProposee([{ role: 'assistant', content: TEXTE_PAUSE_AVANT_ARRET }], maintenant))
  // Rien, un autre sujet, un message du membre, trop vieux, ou trop loin dans le fil : non.
  assert.ok(!pauseDejaProposee([], maintenant))
  assert.ok(!pauseDejaProposee(echange('Ton abonnement est actif.', il(0.1)), maintenant))
  assert.ok(!pauseDejaProposee(echange('Une pause de combien de mois ?', il(0.1)), maintenant))
  assert.ok(!pauseDejaProposee([{ role: 'user', content: 'pause ou tarif ?', at: il(0.1) }], maintenant))
  assert.ok(!pauseDejaProposee(echange(TEXTE_PAUSE_AVANT_ARRET, il(25)), maintenant))
  assert.ok(!pauseDejaProposee([
    ...echange(TEXTE_PAUSE_AVANT_ARRET, il(2)),
    ...echange('Ton abonnement est actif.', il(1)),
    ...echange('Avec plaisir !', il(0.5)),
  ], maintenant))
})

test('montant d une periode et remises', () => {
  const sub = (items, extra = {}) => ({ items: { data: items }, ...extra })
  assert.deepEqual(montantPeriodeAbonnement(sub([{ quantity: 1, price: { unit_amount: 4900, currency: 'eur' } }])), { centimes: 4900, devise: 'eur' })
  assert.deepEqual(montantPeriodeAbonnement(sub([
    { quantity: 2, price: { unit_amount: 1000, currency: 'EUR' } }, { price: { unit_amount: 500, currency: 'eur' } },
  ])), { centimes: 2500, devise: 'eur' })
  assert.equal(montantPeriodeAbonnement(sub([{ price: { unit_amount: null, currency: 'eur' } }])), null)
  assert.equal(montantPeriodeAbonnement(sub([
    { price: { unit_amount: 100, currency: 'eur' } }, { price: { unit_amount: 100, currency: 'usd' } },
  ])), null)
  assert.equal(montantPeriodeAbonnement(sub([])), null)
  assert.ok(!abonnementARemise(sub([], { discounts: [], discount: null })))
  assert.ok(abonnementARemise(sub([], { discounts: ['di_1'] })))
  assert.ok(abonnementARemise(sub([], { discount: { id: 'di_1' } })))
  assert.ok(abonnementARemise(sub([{ discounts: ['di_2'] }])))
  assert.equal(formaterMontant(4900, 'eur'), '49 €')
  assert.equal(formaterMontant(4990, 'eur'), '49,90 €')
  assert.equal(formaterMontant(9900, 'usd'), '99 USD')
})

test('rappel J-3 avant prelevement', () => {
  const maintenant = new Date('2026-10-01T07:00:00Z')
  const sec = iso => Math.floor(Date.parse(iso) / 1000)
  const brut = (finIso, extra = {}) => abo({
    items: { data: [{ current_period_end: sec(finIso), quantity: 1, price: { product: PRODUITS[1], unit_amount: 9900, currency: 'eur' } }] },
    discounts: [],
    collection_method: 'charge_automatically',
    ...extra,
  })
  const r = (finIso, extra) => resumerAbonnement(brut(finIso, extra), PRODUITS)
  assert.equal(RAPPEL_PRELEVEMENT_JOURS, 3)

  // Actif, prochain prelevement dans 3 jours : rappel, echeance du jour.
  const a = r('2026-10-04T14:00:00Z')
  assert.equal(a.prelevementAuto, true)
  assert.deepEqual(a.montantPeriode, { centimes: 9900, devise: 'eur' })
  assert.equal(prelevementAPrevenir(a, maintenant), '2026-10-04')
  // Rattrapage a J-2 et J-1, rien a J-4, J0 ni apres.
  assert.equal(prelevementAPrevenir(r('2026-10-03T14:00:00Z'), maintenant), '2026-10-03')
  assert.equal(prelevementAPrevenir(r('2026-10-02T14:00:00Z'), maintenant), '2026-10-02')
  assert.equal(prelevementAPrevenir(r('2026-10-05T14:00:00Z'), maintenant), null)
  assert.equal(prelevementAPrevenir(r('2026-10-01T14:00:00Z'), maintenant), null)
  assert.equal(prelevementAPrevenir(r('2026-09-30T14:00:00Z'), maintenant), null)

  // Deja envoye pour cette echeance : rien. Autre echeance du meme abonnement : rappel.
  assert.equal(prelevementAPrevenir(a, maintenant, new Set([clePrelevement(a.id, '2026-10-04')])), null)
  assert.equal(prelevementAPrevenir(a, maintenant, new Set([clePrelevement(a.id, '2026-09-04')])), '2026-10-04')
  assert.equal(clePrelevement('sub_X', '2026-10-04T14:00:00.000Z'), 'sub_X:2026-10-04')

  // En pause (programmee ou en cours) : aucun prelevement a annoncer.
  const programmee = r('2026-10-04T14:00:00Z', { pause_collection: { behavior: 'void', resumes_at: sec('2027-01-04T14:00:00Z') } })
  assert.ok(programmee.pauseActive)
  assert.equal(prelevementAPrevenir(programmee, maintenant), null)
  // Arret programme (fin de periode ou date) : rien.
  assert.equal(prelevementAPrevenir(r('2026-10-04T14:00:00Z', { cancel_at_period_end: true }), maintenant), null)
  assert.equal(prelevementAPrevenir(r('2026-10-04T14:00:00Z', { cancel_at: sec('2026-10-04T14:00:00Z') }), maintenant), null)
  // Facture envoyee (pas de prelevement), past_due, termine : rien.
  assert.equal(prelevementAPrevenir(r('2026-10-04T14:00:00Z', { collection_method: 'send_invoice' }), maintenant), null)
  assert.equal(prelevementAPrevenir(r('2026-10-04T14:00:00Z', { status: 'past_due' }), maintenant), null)
  assert.equal(prelevementAPrevenir(r('2026-10-04T14:00:00Z', { status: 'canceled' }), maintenant), null)
  // Essai gratuit qui se termine : le premier prelevement est annonce.
  assert.equal(prelevementAPrevenir(r('2026-10-04T14:00:00Z', { status: 'trialing' }), maintenant), '2026-10-04')
  // Prix a zero sans remise : rien a prelever.
  const gratuit = resumerAbonnement(brut('2026-10-04T14:00:00Z', {
    items: { data: [{ current_period_end: sec('2026-10-04T14:00:00Z'), price: { product: PRODUITS[1], unit_amount: 0, currency: 'eur' } }] },
  }), PRODUITS)
  assert.equal(prelevementAPrevenir(gratuit, maintenant), null)

  // Montant : seulement l'apercu Stripe (apres remise, taxe, solde). Sans
  // apercu lisible, inconnu (date seule) : jamais le prix des items, qui
  // ignore taxe, avoir et remise client.
  assert.deepEqual(montantAAnnoncer({ amount_due: 7900, currency: 'EUR' }), { centimes: 7900, devise: 'eur' })
  assert.equal(montantAAnnoncer(null), null)
  const avecRemise = r('2026-10-04T14:00:00Z', { discounts: ['di_TEST'] })
  assert.ok(avecRemise.aRemise)
  assert.deepEqual(montantAAnnoncer({ amount_due: 0, currency: 'eur' }), { centimes: 0, devise: 'eur' })
  assert.equal(montantAAnnoncer({ amount_due: 'x', currency: 'eur' }), null)
  assert.equal(montantAAnnoncer({ amount_due: 4900 }), null)

  // Jour annonce : celui de Paris. Periode qui finit a 22 h 30 UTC le 1er
  // octobre = 0 h 30 le 2 octobre a Paris.
  assert.equal(jourParis('2026-10-01T22:30:00Z'), '2026-10-02')
  assert.equal(jourParis('2026-10-01T14:00:00Z'), '2026-10-01')
  // Hiver (UTC+1) : 23 h 30 UTC le 15 decembre = 16 decembre a Paris.
  assert.equal(jourParis('2026-12-15T23:30:00Z'), '2026-12-16')
  assert.equal(jourParis('2026-12-15T22:30:00Z'), '2026-12-15')
})

test('montants du membre : mise en forme (Brice 30/09)', () => {
  // Mise en forme : euros sans decimales inutiles, virgule sinon, autre devise en code.
  assert.equal(formaterMontant(8900, 'eur'), '89 €')
  assert.equal(formaterMontant(8950, 'EUR'), '89,50 €')
  assert.equal(formaterMontant(0, 'eur'), '0 €')
  assert.equal(formaterMontant(13905, 'usd'), '139,05 USD')
  // Lecture d'un montant Stripe : entier >= 0 et devise, sinon null.
  assert.deepEqual(lireMontant(8900, 'EUR'), { centimes: 8900, devise: 'eur' })
  assert.deepEqual(lireMontant(0, 'eur'), { centimes: 0, devise: 'eur' })
  for (const [c, d] of [[-1, 'eur'], [89.5, 'eur'], ['8900', 'eur'], [8900, ''], [8900, null], [null, 'eur']]) {
    assert.equal(lireMontant(c, d), null, `${c} ${d}`)
  }
  // Periode du prix (price.recurring) et sa tournure.
  const avecPrix = recurring => ({ items: { data: [{ price: { recurring } }] } })
  assert.equal(periodiciteAbonnement(avecPrix({ interval: 'month', interval_count: 1 })), 'mois')
  assert.equal(periodiciteAbonnement(avecPrix({ interval: 'month', interval_count: 3 })), '3 mois')
  assert.equal(periodiciteAbonnement(avecPrix({ interval: 'year' })), 'an')
  assert.equal(periodiciteAbonnement(avecPrix({ interval: 'week', interval_count: 2 })), '2 semaines')
  assert.equal(periodiciteAbonnement(avecPrix(null)), null)
  assert.equal(periodiciteAbonnement({}), null)
  assert.equal(parPeriode('mois'), 'par mois')
  assert.equal(parPeriode('an'), 'par an')
  assert.equal(parPeriode('3 mois'), 'tous les 3 mois')
  assert.equal(parPeriode('2 semaines'), 'toutes les 2 semaines')
  assert.equal(parPeriode(null), '')

  // Tarif apres remise et prochain prelevement : l'apercu d'abord (total pour
  // le tarif, amount_due pour le prelevement : un solde crediteur baisse le
  // prelevement, pas le tarif).
  const futurSec = Math.floor(Date.parse('2099-10-15T10:00:00Z') / 1000)
  const brut = (extra = {}) => abo({
    items: { data: [{ current_period_end: futurSec, quantity: 1, price: { product: PRODUITS[1], unit_amount: 13900, currency: 'eur', recurring: { interval: 'month', interval_count: 1 } } }] },
    collection_method: 'charge_automatically',
    ...extra,
  })
  const sansRemise = resumerAbonnement(brut(), PRODUITS)
  const avecRemise = resumerAbonnement(brut({ discounts: ['di_TEST0000'] }), PRODUITS)
  assert.equal(sansRemise.periodicite, 'mois')
  assert.deepEqual(montantsDeLaPeriode(avecRemise, { total: 8900, amount_due: 8900, currency: 'eur' }),
    { tarif: { centimes: 8900, devise: 'eur' }, prelevement: { centimes: 8900, devise: 'eur' } })
  assert.deepEqual(montantsDeLaPeriode(sansRemise, { total: 13900, amount_due: 3900, currency: 'eur' }),
    { tarif: { centimes: 13900, devise: 'eur' }, prelevement: { centimes: 3900, devise: 'eur' } })
  // Apercu illisible : le prix des items SEULEMENT sans remise, sinon rien.
  assert.deepEqual(montantsDeLaPeriode(sansRemise, null).tarif, { centimes: 13900, devise: 'eur' })
  assert.deepEqual(montantsDeLaPeriode(avecRemise, null), { tarif: null, prelevement: null })
  assert.deepEqual(montantsDeLaPeriode(avecRemise, { total: 'x', currency: 'eur' }), { tarif: null, prelevement: null })
  // Remise : posee sur l'abonnement, ou visible dans l'apercu (remise client).
  assert.ok(remiseAppliquee(avecRemise, null))
  assert.ok(!remiseAppliquee(sansRemise, null))
  assert.ok(remiseAppliquee(sansRemise, { total_discount_amounts: [{ amount: 5000, discount: 'di_X' }] }))
  assert.ok(!remiseAppliquee(sansRemise, { total_discount_amounts: [{ amount: 0 }] }))
})

test('montants du membre : selection du montant du et faits de l outil (Brice 30/09)', () => {
  const sec = iso => Math.floor(Date.parse(iso) / 1000)
  const facture = (extra = {}) => ({
    id: 'in_TEST000000', status: 'open', amount_due: 8900, amount_remaining: 8900, currency: 'eur',
    created: sec('2099-09-07T10:00:00Z'), hosted_invoice_url: 'https://invoice.stripe.com/i/TEST_facture', ...extra,
  })
  // Seules les factures ouvertes avec un reste positif ; amount_remaining, pas amount_due (paiement partiel).
  assert.deepEqual(facturesARegler([facture()]), [{ centimes: 8900, devise: 'eur', lien: 'https://invoice.stripe.com/i/TEST_facture', factureLe: '2099-09-07T10:00:00.000Z' }])
  assert.equal(facturesARegler([facture({ amount_remaining: 3900 })])[0].centimes, 3900)
  for (const autre of [{ status: 'paid' }, { status: 'draft' }, { status: 'void' }, { status: 'uncollectible' }, { amount_remaining: 0 }, { amount_remaining: null }, { currency: null }]) {
    assert.deepEqual(facturesARegler([facture(autre)]), [], JSON.stringify(autre))
  }
  assert.deepEqual(facturesARegler([null, 'in_X', 42]), [])
  // La plus recente d'abord, 3 au plus ; lien seulement en https.
  const plusieurs = facturesARegler([
    facture({ created: sec('2099-07-07T10:00:00Z'), amount_remaining: 100 }),
    facture({ created: sec('2099-09-07T10:00:00Z'), amount_remaining: 300 }),
    facture({ created: sec('2099-08-07T10:00:00Z'), amount_remaining: 200, hosted_invoice_url: 'http://pas-https.example' }),
    facture({ created: sec('2099-06-07T10:00:00Z'), amount_remaining: 50 }),
  ])
  assert.deepEqual(plusieurs.map(f => f.centimes), [300, 200, 100])
  assert.equal(plusieurs[1].lien, null)
  // Aucun identifiant de facture ne sort.
  assert.ok(!JSON.stringify(plusieurs).includes('in_TEST'))

  // Ou chercher un reste a regler.
  const futurSec = sec('2099-10-15T10:00:00Z')
  const brut = (extra = {}) => abo({
    items: { data: [{ current_period_end: futurSec, quantity: 1, price: { product: PRODUITS[1], unit_amount: 13900, currency: 'eur', recurring: { interval: 'month' } } }] },
    collection_method: 'charge_automatically', ...extra,
  })
  const r = extra => resumerAbonnement(brut(extra), PRODUITS)
  assert.ok(!peutAvoirUnImpaye(r()))
  assert.ok(peutAvoirUnImpaye(r({ status: 'past_due' })))
  assert.ok(peutAvoirUnImpaye(r({ status: 'unpaid' })))
  assert.ok(peutAvoirUnImpaye(r({ latest_invoice: { status: 'open', status_transitions: {} } })))

  // Les faits de l'outil : abonnement actif avec remise, rien a regler.
  const actif = r({ discounts: ['di_TEST0000'] })
  const f1 = faitsMontants([{ abonnement: actif, apercu: { total: 8900, amount_due: 8900, currency: 'eur' } }], [])
  assert.deepEqual(f1, {
    abonnements: [{ statut: 'actif', tarif: '89 € par mois', remise: true, prochain_prelevement: { date: '15 octobre 2099', montant: '89 €' } }],
    a_regler: [], rien_a_regler: true,
  })
  // Paiement en retard : le montant du et le lien de la facture.
  const retard = r({ status: 'past_due', latest_invoice: { status: 'open', status_transitions: {} } })
  const f2 = faitsMontants([{ abonnement: retard, apercu: null }], [{ abonnement: retard, factures: [facture()] }])
  assert.equal(f2.abonnements[0].statut, 'paiement_en_retard')
  assert.equal(f2.abonnements[0].tarif, '139 € par mois')
  assert.deepEqual(f2.a_regler, [{ montant: '89 €', facture_du: '7 septembre 2099', lien: 'https://invoice.stripe.com/i/TEST_facture' }])
  assert.equal(f2.rien_a_regler, undefined)
  // Factures illisibles, ou en retard sans facture ouverte lisible : « non disponible », jamais « rien a regler ».
  const f3 = faitsMontants([], [{ abonnement: retard, factures: 'illisible' }])
  assert.ok(f3.a_regler_non_disponible && !f3.rien_a_regler && f3.aucun_abonnement_en_cours)
  assert.ok(faitsMontants([], [{ abonnement: retard, factures: [] }]).a_regler_non_disponible)
  // Derniere facture ouverte payee entre-temps (liste vide, abonnement actif) : rien a regler.
  assert.ok(faitsMontants([], [{ abonnement: r({ latest_invoice: { status: 'open' } }), factures: [] }]).rien_a_regler)
  // Lien absent : dit tel quel, le montant reste.
  assert.equal(faitsMontants([], [{ abonnement: retard, factures: [facture({ hosted_invoice_url: null })] }]).a_regler[0].lien, LIEN_NON_DISPONIBLE)
  // Remise et apercu illisible : « montant non disponible », jamais le prix affiche.
  const f4 = faitsMontants([{ abonnement: actif, apercu: null }], [])
  assert.equal(f4.abonnements[0].tarif, MONTANT_NON_DISPONIBLE)
  assert.equal(f4.abonnements[0].prochain_prelevement.montant, MONTANT_NON_DISPONIBLE)
  // Arret programme, pause : pas de prochain prelevement, et pourquoi.
  const arret = faitsMontants([{ abonnement: r({ cancel_at_period_end: true }), apercu: null }], []).abonnements[0]
  assert.ok(arret.statut === 'arret_programme' && arret.prochain_prelevement === null && /arrêt programmé/.test(arret.sans_prelevement))
  const pause = faitsMontants([{ abonnement: r({ pause_collection: { behavior: 'void', resumes_at: futurSec + 90 * 86400 } }), apercu: null }], []).abonnements[0]
  assert.ok(pause.statut === 'pause_prevue' && pause.prochain_prelevement === null)
  const facturee = faitsMontants([{ abonnement: r({ collection_method: 'send_invoice' }), apercu: null }], []).abonnements[0]
  assert.ok(facturee.prochain_prelevement === null && /pas de prélèvement automatique/.test(facturee.sans_prelevement))
  // Rien qui identifie chez Stripe (client, abonnement, facture, remise).
  for (const f of [f1, f2, f3, f4]) assert.ok(!/(?<![A-Za-z])(cus|sub|in|di|promo)_[A-Za-z0-9]{4,}/.test(JSON.stringify(f)), JSON.stringify(f))
})

test('fil Support : libelles des boutons et gestes (Brice 30/09)', () => {
  assert.equal(libelleBouton('m:abo'), 'Mon abonnement')
  assert.equal(libelleBouton('m:equipe'), "Contacter l'équipe")
  assert.equal(libelleBouton('m:arret_ok'), "J'arrête quand même")
  assert.equal(libelleBouton('p:3'), 'Pause de 3 mois')
  // Jamais le nonce d'une confirmation.
  assert.equal(libelleBouton('c:AbCdEf123456'), 'Oui, je confirme')
  assert.equal(libelleBouton('x:AbCdEf123456'), 'Non, laisse tomber')
  assert.equal(libelleBouton('zz:inconnu'), 'bouton inconnu')

  assert.equal(expurgerLiensInvitation('va sur https://t.me/+AbCd123 ou https://t.me/joinchat/XyZ'), 'va sur [lien transmis] ou [lien transmis]')
  assert.equal(expurgerLiensInvitation('https://t.me/aok_liveclub_bot'), 'https://t.me/aok_liveclub_bot')

  // Les gestes 'fait' et 'refuse' ont une ligne ; 'simule' et 'echec' restent au journal.
  assert.equal(phraseGeste({ geste: 'retrait', resultat: 'simule', regle: 'desabonne' }), null)
  assert.equal(phraseGeste({ geste: 'invitation', resultat: 'echec', regle: 'telegram' }), null)
  assert.equal(phraseGeste({ geste: 'entree_acceptee', resultat: 'fait', regle: 'abonnement' }), 'Entrée dans le groupe acceptée (abonnement).')
  assert.equal(phraseGeste({ geste: 'refus', resultat: 'fait', regle: 'sortie_abusive_metricgram' }), 'Sortie par Metricgram repérée (droit ouvert).')
  assert.equal(phraseGeste({ geste: 'invitation', resultat: 'fait', regle: 'sortie_abusive_metricgram', details: { sorti_le: '2026-09-27T10:15:00.000Z' } }), 'Bannissement levé, lien de retour envoyé.')
  assert.equal(phraseGeste({ geste: 'pause', resultat: 'fait', regle: 'demande_membre', details: { paye_jusquau: '2026-10-15', reprise_le: '2026-12-15' } }),
    "Pause programmée, groupe gardé jusqu'au 15 octobre 2026, reprise le 15 décembre 2026.")
  assert.equal(phraseGeste({ geste: 'arret', resultat: 'fait', regle: 'demande_membre', details: { fin: '2026-10-07' } }), 'Arrêt programmé au 7 octobre 2026.')
  assert.equal(phraseGeste({ geste: 'rappel', resultat: 'fait', regle: 'prelevement_j3', details: { jour_annonce: '2026-10-04', canal: 'prive' } }), 'Rappel J-3 envoyé (prélèvement du 4 octobre 2026).')
  assert.equal(phraseGeste({ geste: 'rappel', resultat: 'fait', regle: 'sortie_desabonne', details: { canal: 'email' } }), "Message de fin d'abonnement envoyé par email.")
  assert.equal(phraseGeste({ geste: 'fin_acces', resultat: 'fait', regle: 'broker_fin' }), "Sortie du groupe (fin d'accès broker).")
  assert.equal(phraseGeste({ geste: 'retrait', resultat: 'refuse', regle: 'exempte' }), 'Sortie du groupe non faite (membre exempté).')
  assert.equal(phraseGeste({ geste: 'pause', resultat: 'fait', regle: 'pause_effective' }), 'Sortie du groupe (début de la pause).')
  // Un detail inattendu (lien, email) n'entre jamais dans la ligne : seules des dates sont lues.
  const piege = phraseGeste({ geste: 'invitation', resultat: 'fait', regle: 'abonnement', details: { lien: 'https://t.me/+SECRET', email: 'x@y.fr' } })
  assert.ok(!/t\.me|@/.test(piege), piege)
  assert.equal(phraseGeste({ geste: 'geste_futur', resultat: 'fait', regle: 'x' }), 'Geste du bot fait.')
})

test('sorties abusives de Metricgram (transition)', () => {
  const sortie = { telegramId: 123456789, sortiLe: new Date('2026-09-27T10:15:00Z'), parQui: '@MetricgramBot' }
  assert.ok(sortiParMetricgram('@MetricgramBot') && sortiParMetricgram('metricgram_bot'))
  assert.ok(!sortiParMetricgram('lui-même') && !sortiParMetricgram('@aok_liveclub_bot') && !sortiParMetricgram(null))

  // Droit oui, deja la le jour de la sortie, absent du groupe : signale une fois.
  assert.ok(sortieAbusiveASignaler(sortie, 'non', 'oui', 'oui'))
  const deja = new Set([cleSortieAbusive(sortie.telegramId, sortie.sortiLe)])
  assert.ok(!sortieAbusiveASignaler(sortie, 'non', 'oui', 'oui', deja))
  // La cle relue du journal (texte ISO) est la meme que celle de la sortie.
  assert.equal(cleSortieAbusive(123456789, '2026-09-27T10:15:00.000Z'), cleSortieAbusive(123456789, sortie.sortiLe))
  // Nouvelle sortie du meme compte (banni a nouveau) : signalee a son tour
  // (le passage ne renvoie pas de second lien, voir rebanni_metricgram).
  assert.ok(sortieAbusiveASignaler({ ...sortie, sortiLe: new Date('2026-09-29T08:00:00Z') }, 'non', 'oui', 'oui', deja))

  // Droit inconnu ou non : rien. Revenu ou presence inconnue : rien.
  assert.ok(!sortieAbusiveASignaler(sortie, 'non', 'inconnu', 'inconnu'))
  assert.ok(!sortieAbusiveASignaler(sortie, 'non', 'non', 'inconnu'))
  assert.ok(!sortieAbusiveASignaler(sortie, 'oui', 'oui', 'oui'))
  assert.ok(!sortieAbusiveASignaler(sortie, 'inconnu', 'oui', 'oui'))
  // Sortie qui ne vient pas de Metricgram (depart volontaire, notre bot, un admin) : rien.
  assert.ok(!sortieAbusiveASignaler({ ...sortie, parQui: 'lui-même' }, 'non', 'oui', 'oui'))
  assert.ok(!sortieAbusiveASignaler({ ...sortie, parQui: null }, 'non', 'oui', 'oui'))

  // Droit d'aujourd'hui pris APRES la sortie (desabonne sorti a juste titre
  // le 15/09, reabonne le 28/09) : pas une sortie abusive. Couverture
  // inconnue (date illisible) : rien non plus.
  const juste = { ...sortie, sortiLe: new Date('2026-09-15T09:00:00Z') }
  assert.equal(droitCouvraitLaSortie('2026-09-28T18:00:00.000Z', juste.sortiLe), 'non')
  assert.ok(!sortieAbusiveASignaler(juste, 'non', 'oui', droitCouvraitLaSortie('2026-09-28T18:00:00.000Z', juste.sortiLe)))
  assert.ok(!sortieAbusiveASignaler(sortie, 'non', 'oui', 'inconnu'))
  assert.ok(!sortieAbusiveASignaler(sortie, 'non', 'oui', 'non'))
  // Abonnement pris avant la sortie (le cas des deux abonnements) : couvre.
  assert.equal(droitCouvraitLaSortie('2026-08-26T12:00:00.000Z', sortie.sortiLe), 'oui')
  assert.equal(droitCouvraitLaSortie('2026-09-27T10:15:00.000Z', sortie.sortiLe), 'oui')
  // Acces broker date au jour : le jour meme de la sortie couvre, le lendemain non.
  assert.equal(droitCouvraitLaSortie('2026-09-27', sortie.sortiLe), 'oui')
  assert.equal(droitCouvraitLaSortie('2026-09-28', sortie.sortiLe), 'non')
  assert.equal(droitCouvraitLaSortie(null, sortie.sortiLe), 'inconnu')
  assert.equal(droitCouvraitLaSortie('n importe quoi', sortie.sortiLe), 'inconnu')
  assert.equal(droitCouvraitLaSortie('2026-08-26T12:00:00.000Z', '2026-09-27T10:15:00.000Z'), 'oui')
  // Debut d'un abonnement : start_date, sinon created, sinon inconnu.
  const debutSec = Date.parse('2026-08-26T12:00:00Z') / 1000
  assert.equal(resumerAbonnement(abo({ start_date: debutSec, created: debutSec + 60 }), PRODUITS).debutLe, '2026-08-26T12:00:00.000Z')
  assert.equal(resumerAbonnement(abo({ created: debutSec }), PRODUITS).debutLe, '2026-08-26T12:00:00.000Z')
  assert.equal(resumerAbonnement(abo(), PRODUITS).debutLe, null)

  // Lien de retour retente : seulement apres une panne passagere, 2 fois au plus.
  assert.equal(MAX_ESSAIS_RETOUR, 2)
  for (const r of ['echec_levee_ban', 'echec_lien', 'echec_envoi', 'conversations_illisibles', 'config']) {
    assert.ok(retourARetenter(r, null), r)
    assert.ok(retourARetenter(r, '1'), r)
    assert.ok(!retourARetenter(r, '2'), r)
  }
  for (const r of ['envoye', 'bot_jamais_demarre', 'bot_bloque', 'droit_vu_par_email_seul', 'rebanni_metricgram', 'en_cours', null]) {
    assert.ok(!retourARetenter(r, 0), String(r))
  }
})

console.log(`\n${n} blocs verifies, tout est bon.`)
