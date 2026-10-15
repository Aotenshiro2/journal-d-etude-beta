// Verification locale des fonctions PURES du Live Club (src/lib/liveclub/pur.ts).
// Pas de lanceur de tests dans le journal : Node 22 supprime les types tout
// seul, donc ce script importe le .ts directement. Aucune base, aucun reseau.
// Lancement : node scripts/verifier-liveclub.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  premierEchecFacture, lireImpaye, etatImpaye, enRetardDePaiement, joursDepuisPremierEchec, finGraceImpaye,
  limiteFenetreImpaye, detteOuverte, texteDette, phraseImpaye, faitsImpaye, phraseARegler,
  JOURS_IMPAYE_SORTIE, JOURS_FENETRE_RETOUR,
  sortieAExpliquer, JOURS_RAISON_SORTIE, REGLE_RAISON_SORTIE,
  accesSansAbonnement, parcoursSansRattachement,
  lireTelegramId, COMMANDE_BOT_MEMBRE, aiguillageMessagePrive, TEXTE_TRANSMIS_AU_COCKPIT, TEXTE_NON_TRANSMIS_AU_COCKPIT,
  refusReintegration, etapeApresExemption, etapeApresReintegration, etapeApresAccesBroker,
  MOTIFS_EXEMPTION, lireParamsExemption, uuidDeActeur,
  fusionnerProduitsLiveClub, creerLecteurProduitsLiveClub, lireParamsMarquageLiveClub,
  lireParamsLienPaiement, lireTarifStripe, libelleTarif, choisirTarif, refusLienLiveClub, corpsLienPaiement,
  urlLienAvecEmail, etapeApresLienPaiement, phraseLienPaiementCree, masquerCleStripe, estRefusDePermission,
  permissionLienPaiementManquante, phraseProduitCree,
  lireParamsAbonnementReserve, lireParamsRetraitReserve, libelleTarifReserve, reservePourCompte, lireLienStripe,
  decisionLienReserve, abonnementAPaye, abonnementDeLaReserve, lireAbonnementPourReserve, texteTarifReserve,
  etapeApresAbonnementReserve, phraseAbonnementReserveCree, corpsTarifReserve, refusTarifRepris, ecartTarifDemande,
  refusTarifDejaPaye, META_RESERVE_POUR,
} from '../src/lib/liveclub/pur.ts'
import { lireDemande, auteurDemande, MAX_TEXTE_DEMANDE, MAX_CITATION_DEMANDE } from '../src/lib/agent-cockpit-pur.ts'
import {
  desabonneHorsGrace, finAbonnement,
  prelevementAPrevenir, montantAAnnoncer, clePrelevement, jourParis, RAPPEL_PRELEVEMENT_JOURS,
  sortieAbusiveASignaler, sortiParMetricgram, cleSortieAbusive,
  droitCouvraitLaSortie, retourARetenter, MAX_ESSAIS_RETOUR,
  decisionSortieImpaye, decisionFenetre, factureRegleeApresSortie, decisionReouverture,
  bienvenueARattraper, JOURS_RATTRAPAGE_BIENVENUE,
  phaseExemption, decisionRappelExemption, decisionFinExemption, jourLePlusAncien, RAPPEL_FIN_EXEMPTION_JOURS,
} from '../src/lib/liveclub/passage-regles.ts'
import {
  GRACE_JOURS, URLS_ABONNEMENT, URL_ABONNEMENT, URL_PORTAIL_CARTE, texteAbonnement,
  ARGUMENT_TARIF_PAUSE, TEXTE_PAUSE_AVANT_ARRET, sortiesActives, sortiesImpayesActives, PLAFOND_RESILIATIONS_PASSAGE,
  texteRaisonSortie, PRODUITS_LIVECLUB, URL_BIENVENUE_LIVECLUB, estProduitLiveClub,
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

  // Passage quotidien (cron 7 h UTC) : sortie a la fin de la periode payee
  // (GRACE_JOURS = 0, Brice 08/10), pas a ended_at. Fin payee le 07/10 a
  // 14 h : encore dedans le 07/10 a 7 h, sortie au passage du 08/10.
  assert.equal(GRACE_JOURS, 0)
  assert.equal(finAbonnement(r), '2026-10-07T14:00:00.000Z')
  for (const jour of ['2026-09-29', '2026-10-07']) {
    assert.ok(!desabonneHorsGrace(r, new Date(`${jour}T07:00:00Z`), GRACE_JOURS), jour)
  }
  assert.ok(desabonneHorsGrace(r, new Date('2026-10-08T07:00:00Z'), GRACE_JOURS))

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
  //    prolongation, sortie au premier passage apres ended_at.
  const le10 = sec('2026-09-10T10:00:00Z')
  const immediate = resumerAbonnement({
    ...brut, canceled_at: le10, ended_at: le10,
    latest_invoice: { ...facturePayee, status_transitions: { paid_at: debut } },
  }, PRODUITS)
  assert.equal(immediate.payeJusquau, null)
  assert.ok(!abonnementOuvreLeGroupeLe(immediate, ms('2026-09-11T07:00:00Z')))
  assert.equal(finAbonnement(immediate), '2026-09-10T10:00:00.000Z')
  assert.ok(!desabonneHorsGrace(immediate, new Date('2026-09-10T07:00:00Z'), GRACE_JOURS))
  assert.ok(desabonneHorsGrace(immediate, new Date('2026-09-11T07:00:00Z'), GRACE_JOURS))
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

// ---------------------------------------------------------------------------
// Impayes (Brice, 30/09) : sortie a 5 jours, reouverture, fenetre de 30 jours,
// la dette d'abord, rattrapage des emails de bienvenue.
// ---------------------------------------------------------------------------

const secI = iso => Math.floor(Date.parse(iso) / 1000)
const msI = iso => Date.parse(iso)
// Premier echec : finalisation de la facture, le 1er septembre 2026 a 10 h UTC.
const ECHEC = '2026-09-01T10:00:00.000Z'
const J = n => Date.parse(ECHEC) + n * 86_400_000
const LIEN_FACTURE = 'https://invoice.stripe.com/i/TEST_impaye'
const factureOuverte = (extra = {}) => ({
  id: 'in_TESTIMPAYE01', status: 'open', collection_method: 'charge_automatically', due_date: null,
  created: secI('2026-09-01T09:00:00Z'), status_transitions: { finalized_at: secI(ECHEC), paid_at: null },
  amount_remaining: 8900, currency: 'eur', hosted_invoice_url: LIEN_FACTURE, ...extra,
})
const enRetard = (statut, factures = [factureOuverte()], extra = {}) => ({
  ...resumerAbonnement(abo({ status: statut, latest_invoice: { status: 'open', status_transitions: {} }, ...extra }), PRODUITS),
  impaye: lireImpaye(factures),
})

test('impayes : date du premier echec (clover) et lecture des factures ouvertes', () => {
  // Prelevement automatique : la premiere tentative part a la finalisation.
  assert.equal(premierEchecFacture(factureOuverte()), secI(ECHEC))
  assert.equal(premierEchecFacture(factureOuverte({ status_transitions: {} })), secI('2026-09-01T09:00:00Z'))
  // Facture envoyee : l'echec, c'est l'echeance passee.
  assert.equal(premierEchecFacture(factureOuverte({ collection_method: 'send_invoice', due_date: secI('2026-09-15T00:00:00Z') })), secI('2026-09-15T00:00:00Z'))
  assert.equal(premierEchecFacture(factureOuverte({ collection_method: 'send_invoice', due_date: null })), secI(ECHEC))
  assert.equal(premierEchecFacture({}), null)
  assert.equal(premierEchecFacture(null), null)

  const i = lireImpaye([factureOuverte()])
  assert.equal(i.depuis, ECHEC)
  assert.equal(i.factureId, 'in_TESTIMPAYE01')
  assert.deepEqual(i.facturesOuvertes, ['in_TESTIMPAYE01'])
  assert.deepEqual(i.aRegler, [{ centimes: 8900, devise: 'eur', lien: LIEN_FACTURE, factureLe: '2026-09-01T09:00:00.000Z' }])
  // La plus ancienne facture ouverte date l'impaye ; un reste nul ne date rien
  // (mais reste a annuler) ; une facture payee n'est pas ouverte.
  const plusieurs = lireImpaye([
    factureOuverte({ id: 'in_TESTRECENTE1', created: secI('2026-10-01T09:00:00Z'), status_transitions: { finalized_at: secI('2026-10-01T10:00:00Z') } }),
    factureOuverte({ id: 'in_TESTZERO0001', created: secI('2026-08-01T09:00:00Z'), status_transitions: { finalized_at: secI('2026-08-01T10:00:00Z') }, amount_remaining: 0 }),
    factureOuverte(),
    factureOuverte({ id: 'in_TESTPAYEE001', status: 'paid', status_transitions: { finalized_at: secI('2026-07-01T10:00:00Z') } }),
  ])
  assert.equal(plusieurs.depuis, ECHEC)
  assert.equal(plusieurs.factureId, 'in_TESTIMPAYE01')
  assert.deepEqual(plusieurs.facturesOuvertes, ['in_TESTRECENTE1', 'in_TESTZERO0001', 'in_TESTIMPAYE01'])
  assert.equal(lireImpaye([]).depuis, null)
  assert.ok(enRetardDePaiement('past_due') && enRetardDePaiement('unpaid') && !enRetardDePaiement('active') && !enRetardDePaiement('canceled'))
})

test('impayes : droit a J+4 et J+6 d un past_due, droit d un unpaid', () => {
  assert.equal(JOURS_IMPAYE_SORTIE, 5)
  assert.equal(JOURS_FENETRE_RETOUR, 30)
  const pd = enRetard('past_due')
  // J+4 : carte expiree, decouvert passager, on laisse.
  assert.equal(etatImpaye(pd, J(4)), 'grace')
  assert.ok(abonnementOuvreLeGroupeLe(pd, J(4)))
  assert.equal(meilleurAbonnement([pd], J(4)).id, pd.id)
  assert.equal(finDuDroit(pd), '2026-09-06T10:00:00.000Z')
  assert.equal(finGraceImpaye(pd), '2026-09-06T10:00:00.000Z')
  // Pile 5 jours : encore 'oui' ; une minute de plus : 'non'.
  assert.ok(abonnementOuvreLeGroupeLe(pd, J(5)))
  assert.ok(!abonnementOuvreLeGroupeLe(pd, J(5) + 60_000))
  // J+6 : plus de droit, meme si Stripe relance encore.
  assert.equal(etatImpaye(pd, J(6)), 'suspendu')
  assert.ok(!abonnementOuvreLeGroupeLe(pd, J(6)))
  assert.equal(meilleurAbonnement([pd], J(6)), null)
  assert.equal(joursDepuisPremierEchec(pd, J(6) + 3_600_000), 6)
  // Un autre abonnement actif du meme payeur garde le droit.
  const actif = resumerAbonnement(abo({ id: 'sub_TESTACTIF001' }), PRODUITS)
  assert.equal(meilleurAbonnement([pd, actif], J(6)).id, 'sub_TESTACTIF001')

  // unpaid (relances epuisees, facture laissee ouverte) : pas de droit au-dela de 5 jours.
  const up = enRetard('unpaid')
  assert.equal(etatImpaye(up, J(20)), 'suspendu')
  assert.ok(!abonnementOuvreLeGroupeLe(up, J(20)))
  assert.equal(meilleurAbonnement([up], J(20)), null)
  // Dans les 5 jours (regle lue telle quelle : past_due OU unpaid) : 'oui'.
  assert.ok(abonnementOuvreLeGroupeLe(up, J(3)))

  // Factures pas lues ou sans facture ouverte datable : l'ancienne regle
  // (past_due garde, unpaid non). Illisibles : aucune decision de sortie.
  const nonLu = resumerAbonnement(abo({ status: 'past_due' }), PRODUITS)
  assert.equal(etatImpaye(nonLu, J(20)), 'non_lu')
  assert.ok(abonnementOuvreLeGroupeLe(nonLu, J(20)))
  assert.ok(!abonnementOuvreLeGroupeLe(resumerAbonnement(abo({ status: 'unpaid' }), PRODUITS), J(20)))
  assert.equal(etatImpaye(enRetard('past_due', []), J(20)), 'sans_facture')
  assert.ok(abonnementOuvreLeGroupeLe(enRetard('past_due', []), J(20)))
  const illisible = { ...nonLu, impaye: 'illisible' }
  assert.equal(etatImpaye(illisible, J(20)), 'illisible')
  assert.equal(decisionSortieImpaye(etatImpaye(illisible, J(20)), true), 'inconnu')
  assert.equal(decisionSortieImpaye('non_lu', true), 'inconnu')
  // Un abonnement a jour n'est jamais touche par la regle.
  assert.equal(etatImpaye(actif, J(20)), 'a_jour')
  assert.equal(decisionSortieImpaye('a_jour', true), 'rien')
  assert.equal(decisionSortieImpaye('grace', true), 'grace')
})

test('impayes : sortie simulee sans l interrupteur, reelle avec LIVECLUB_SORTIES_IMPAYES ou LIVECLUB_SORTIES_ACTIVES', () => {
  const avant = { actives: process.env.LIVECLUB_SORTIES_ACTIVES, impayes: process.env.LIVECLUB_SORTIES_IMPAYES }
  const poser = (actives, impayes) => {
    if (actives === undefined) delete process.env.LIVECLUB_SORTIES_ACTIVES
    else process.env.LIVECLUB_SORTIES_ACTIVES = actives
    if (impayes === undefined) delete process.env.LIVECLUB_SORTIES_IMPAYES
    else process.env.LIVECLUB_SORTIES_IMPAYES = impayes
  }
  const etat = etatImpaye(enRetard('past_due'), J(6))
  try {
    poser(undefined, undefined)
    assert.ok(!sortiesImpayesActives() && !sortiesActives())
    assert.equal(decisionSortieImpaye(etat, sortiesImpayesActives()), 'simuler')
    // Une valeur autre que '1' ne vaut rien.
    poser('oui', 'true')
    assert.ok(!sortiesImpayesActives())
    // L'interrupteur separe : la sortie des impayes seulement, pas la bascule.
    poser(undefined, '1')
    assert.ok(sortiesImpayesActives() && !sortiesActives())
    assert.equal(decisionSortieImpaye(etat, sortiesImpayesActives()), 'sortir')
    assert.equal(decisionFenetre(etatImpaye(enRetard('unpaid'), J(31)), sortiesActives(), false), 'simuler')
    // La bascule complete l'emporte aussi.
    poser('1', undefined)
    assert.ok(sortiesImpayesActives() && sortiesActives())
    assert.equal(decisionSortieImpaye(etat, sortiesImpayesActives()), 'sortir')
  } finally {
    poser(avant.actives, avant.impayes)
  }
  // Un abonnement dont la fenetre est depassee et pas encore resilie sort aussi.
  assert.equal(decisionSortieImpaye('fenetre_depassee', false), 'simuler')
})

test('fenetre de 30 jours : J+29 rien, J+31 resiliation simulee sans l interrupteur, reelle avec', () => {
  const up = enRetard('unpaid')
  assert.equal(limiteFenetreImpaye(up), '2026-10-01T10:00:00.000Z')
  assert.equal(etatImpaye(up, J(29)), 'suspendu')
  assert.equal(decisionFenetre(etatImpaye(up, J(29)), true, false), 'rien')
  assert.equal(decisionFenetre(etatImpaye(up, J(29)), false, false), 'rien')
  assert.equal(etatImpaye(up, J(31)), 'fenetre_depassee')
  assert.equal(decisionFenetre(etatImpaye(up, J(31)), false, false), 'simuler')
  assert.equal(decisionFenetre(etatImpaye(up, J(31)), true, false), 'resilier')
  // Une seule fois par abonnement.
  assert.equal(decisionFenetre('fenetre_depassee', true, true), 'deja_fait')
  // past_due depuis plus de 30 jours : pareil ; factures illisibles : rien.
  assert.equal(decisionFenetre(etatImpaye(enRetard('past_due'), J(31)), true, false), 'resilier')
  assert.equal(decisionFenetre('illisible', true, false), 'inconnu')
  assert.equal(decisionFenetre('a_jour', true, false), 'rien')
  assert.ok(PLAFOND_RESILIATIONS_PASSAGE >= 1 && PLAFOND_RESILIATIONS_PASSAGE <= 20)
  // Au-dela de 30 jours, plus de droit non plus.
  assert.ok(!abonnementOuvreLeGroupeLe(up, J(31)))
})

test('reouverture : facture reglee apres la sortie, detectee une seule fois', () => {
  const sortie = new Date('2026-09-07T07:00:00Z')
  const reglee = { payeeLe: '2026-09-10T12:00:00.000Z', dueLe: ECHEC }
  assert.ok(factureRegleeApresSortie([reglee], sortie))
  assert.ok(factureRegleeApresSortie([reglee], sortie.toISOString()))
  // Payee avant la sortie, ou nee apres (nouvel abonnement, cycle suivant) : pas celle de la sortie.
  assert.ok(!factureRegleeApresSortie([{ payeeLe: '2026-09-06T12:00:00.000Z', dueLe: ECHEC }], sortie))
  assert.ok(!factureRegleeApresSortie([{ payeeLe: '2026-09-10T12:00:00.000Z', dueLe: '2026-09-08T10:00:00.000Z' }], sortie))
  assert.ok(!factureRegleeApresSortie([{ payeeLe: null, dueLe: ECHEC }], sortie))
  assert.ok(!factureRegleeApresSortie([], sortie))

  assert.equal(decisionReouverture(true, 'non', 'oui', false), 'envoyer')
  assert.equal(decisionReouverture(false, 'non', 'oui', false), 'rien')
  assert.equal(decisionReouverture(true, 'oui', 'inconnu', false), 'deja_revenu')
  assert.equal(decisionReouverture(true, 'inconnu', 'oui', false), 'inconnu')
  assert.equal(decisionReouverture(true, 'non', 'inconnu', false), 'inconnu')
  assert.equal(decisionReouverture(true, 'non', 'non', false), 'sans_droit')

  // Une seule fois : le passage ferme la boucle par une ligne posterieure a
  // la sortie (derniere reouverture >= sortie), le suivant ne renvoie rien.
  const derniereReouverture = new Map()
  const tid = 123456789
  const passage = maintenant => {
    const deja = (derniereReouverture.get(tid) ?? 0) >= sortie.getTime()
    const d = decisionReouverture(factureRegleeApresSortie([reglee], sortie), 'non', 'oui', deja)
    if (d === 'envoyer') derniereReouverture.set(tid, maintenant)
    return d
  }
  assert.equal(passage(msI('2026-09-11T07:00:00Z')), 'envoyer')
  assert.equal(passage(msI('2026-09-12T07:00:00Z')), 'deja_faite')
  // Une nouvelle sortie plus tard (nouvel impaye) rouvre une boucle.
  assert.ok(!((derniereReouverture.get(tid) ?? 0) >= msI('2026-10-20T07:00:00Z')))
  // La cle de sortie (partagee avec la tache Metricgram) est stable.
  assert.equal(cleSortieAbusive(tid, sortie), cleSortieAbusive(tid, sortie.toISOString()))

  // La derniere facture d'un resume porte sa finalisation.
  const r = resumerAbonnement(abo({ latest_invoice: { status: 'paid', created: secI('2026-09-01T09:00:00Z'), status_transitions: { paid_at: secI('2026-09-10T12:00:00Z'), finalized_at: secI(ECHEC) } } }), PRODUITS)
  assert.equal(r.derniereFacture.finaliseeLe, ECHEC)
  assert.equal(resumerAbonnement(abo({ latest_invoice: { status: 'open', created: secI('2026-09-01T09:00:00Z'), status_transitions: {} } }), PRODUITS).derniereFacture.finaliseeLe, '2026-09-01T09:00:00.000Z')
})

test('la dette d abord : montant et lien de la facture, pas de nouvel abonnement dans les 30 jours', () => {
  const pd = enRetard('past_due')
  const d = detteOuverte([pd], J(10))
  assert.equal(d.depuis, ECHEC)
  assert.equal(d.limite, '2026-10-01T10:00:00.000Z')
  assert.equal(d.aRegler.length, 1)
  const t = texteDette(d)
  for (const attendu of ['89 €', LIEN_FACTURE, '1er octobre 2026', 'tarif actuel', 'rouvre tout seul', '/menu', 'facture du 1er septembre 2026']) {
    assert.ok(t.includes(attendu), attendu)
  }
  // Pas de liens d'abonnement tant que la facture se regle, ton neutre.
  for (const u of URLS_ABONNEMENT) assert.ok(!t.includes(u), u)
  const horsClavier = new RegExp(`[${[0x2013, 0x2014, 0x2026, 0x201c, 0x201d].map(c => String.fromCharCode(c)).join("")}]`)
  assert.ok(!horsClavier.test(t), "caracteres clavier")
  assert.ok(!/(?<!\p{L})paye(?!\p{L})|tu nous dois|urgent|rapidement/iu.test(t), t)
  // Dans les 5 jours : le droit tient, pas de dette ; au-dela de 30 jours : un nouvel abonnement.
  assert.equal(detteOuverte([pd], J(4)), null)
  assert.equal(detteOuverte([pd], J(31)), null)
  assert.ok(phraseImpaye(pd, J(31), URL_PORTAIL_CARTE).includes('nouvel abonnement'))
  // Le meme abonnement lu deux fois (client, puis email) : une seule ligne.
  assert.equal(detteOuverte([pd, pd], J(10)).aRegler.length, 1)
  // Un abonnement a jour ou sans facture lue : pas de dette.
  assert.equal(detteOuverte([resumerAbonnement(abo(), PRODUITS)], J(10)), null)
  // Deux factures ouvertes : une ligne par facture, liens compris.
  const deux = detteOuverte([enRetard('unpaid', [
    factureOuverte(),
    factureOuverte({ id: 'in_TESTIMPAYE02', created: secI('2026-10-01T09:00:00Z'), status_transitions: { finalized_at: secI('2026-10-01T10:00:00Z') }, hosted_invoice_url: 'https://invoice.stripe.com/i/TEST_deux' }),
  ])], J(10))
  const t2 = texteDette(deux)
  assert.ok(t2.includes('Règle-les') && t2.includes(LIEN_FACTURE) && t2.includes('https://invoice.stripe.com/i/TEST_deux'))
  assert.equal(phraseARegler([], { lienDansLeTexte: true }), '')

  // « Mon abonnement » et l'outil de l'agent : les memes chiffres.
  assert.equal(phraseImpaye(pd, J(10), URL_PORTAIL_CARTE), t)
  const grace = phraseImpaye(pd, J(2), URL_PORTAIL_CARTE)
  assert.ok(grace.includes(URL_PORTAIL_CARTE) && grace.includes("jusqu'au 6 septembre 2026"), grace)
  assert.equal(phraseImpaye(resumerAbonnement(abo(), PRODUITS), J(10), URL_PORTAIL_CARTE), null)
  assert.deepEqual(faitsImpaye(pd, J(10)), {
    paiement_en_retard: true, acces_au_groupe_suspendu: true,
    a_regler: [{ montant: '89 €', facture_du: '1er septembre 2026', lien: LIEN_FACTURE }],
    acces_rouvre_des_que_le_paiement_passe: true, tarif_actuel_garde_si_regle_avant: '1er octobre 2026',
  })
  const fm = faitsMontants([], [{ abonnement: pd, factures: [factureOuverte()] }], J(10))
  assert.ok(fm.acces_au_groupe_suspendu && fm.tarif_actuel_garde_si_regle_avant === '1er octobre 2026')
  assert.deepEqual(fm.a_regler, [{ montant: '89 €', facture_du: '1er septembre 2026', lien: LIEN_FACTURE }])
  // Aucun identifiant Stripe ne sort (factures, abonnement, client).
  for (const x of [t, t2, JSON.stringify(faitsImpaye(pd, J(10))), JSON.stringify(fm)]) {
    assert.ok(!/(?<![A-Za-z])(cus|sub|in|di)_[A-Za-z0-9]{4,}/.test(x), x)
  }
})

test('rattrapage des emails de bienvenue : une fois, jamais si rattache', () => {
  assert.equal(JOURS_RATTRAPAGE_BIENVENUE, 3)
  const maintenant = new Date('2026-10-07T07:00:00Z')
  const cree = iso => resumerAbonnement(abo({ created: secI(iso) }), PRODUITS)
  const libre = { rattache: false, emailDejaEnvoye: false, dejaTraite: false }
  const recent = cree('2026-10-05T12:00:00Z')
  assert.equal(recent.creeLe, '2026-10-05T12:00:00.000Z')
  assert.ok(bienvenueARattraper(recent, maintenant, libre))
  // Deja rattache a un compte Telegram, email deja parti (page ou passage), deja traite : rien.
  assert.ok(!bienvenueARattraper(recent, maintenant, { ...libre, rattache: true }))
  assert.ok(!bienvenueARattraper(recent, maintenant, { ...libre, emailDejaEnvoye: true }))
  assert.ok(!bienvenueARattraper(recent, maintenant, { ...libre, dejaTraite: true }))
  // Plus de 3 jours, pas actif, sans client : rien. En essai : oui.
  assert.ok(!bienvenueARattraper(cree('2026-10-03T12:00:00Z'), maintenant, libre))
  assert.ok(!bienvenueARattraper(resumerAbonnement(abo({ status: 'past_due', created: secI('2026-10-05T12:00:00Z') }), PRODUITS), maintenant, libre))
  assert.ok(!bienvenueARattraper(resumerAbonnement(abo({ status: 'canceled', created: secI('2026-10-05T12:00:00Z') }), PRODUITS), maintenant, libre))
  assert.ok(bienvenueARattraper(resumerAbonnement(abo({ status: 'trialing', created: secI('2026-10-05T12:00:00Z') }), PRODUITS), maintenant, libre))
  assert.ok(!bienvenueARattraper({ ...recent, clientStripe: null }, maintenant, libre))
  assert.ok(!bienvenueARattraper({ ...recent, creeLe: null }, maintenant, libre))
  // Une fois : apres le premier passage, l'abonnement est « deja traite ».
  const traites = new Set()
  const passer = () => {
    const ok = bienvenueARattraper(recent, maintenant, { ...libre, dejaTraite: traites.has(recent.id) })
    if (ok) traites.add(recent.id)
    return ok
  }
  assert.ok(passer())
  assert.ok(!passer())
})

test('fil Support : phrases des gestes des impayes (Brice 30/09)', () => {
  assert.equal(phraseGeste({ geste: 'retrait', resultat: 'fait', regle: 'impaye_5j' }), 'Sortie du groupe (paiement en retard depuis plus de 5 jours).')
  assert.equal(phraseGeste({ geste: 'retrait', resultat: 'simule', regle: 'impaye_5j' }), null)
  assert.equal(phraseGeste({ geste: 'rappel', resultat: 'fait', regle: 'sortie_impaye', details: { canal: 'email' } }),
    'Message de sortie pour paiement en retard envoyé par email (montant et lien de la facture).')
  assert.equal(phraseGeste({ geste: 'invitation', resultat: 'fait', regle: 'reouverture_impaye', details: { canal: 'prive' } }),
    'Paiement passé : accès réouvert, lien de retour envoyé.')
  assert.equal(phraseGeste({ geste: 'invitation', resultat: 'fait', regle: 'reouverture_impaye', details: { canal: 'email' } }),
    'Paiement passé : accès réouvert, lien de retour envoyé par email.')
  assert.equal(phraseGeste({ geste: 'invitation', resultat: 'refuse', regle: 'reouverture_impaye' }), 'Paiement passé : déjà revenu dans le groupe.')
  assert.equal(phraseGeste({ geste: 'invitation', resultat: 'refuse', regle: 'impaye_ouvert' }), 'Lien vers le groupe non envoyé : paiement en retard, facture à régler.')
  assert.equal(phraseGeste({ geste: 'entree_refusee', resultat: 'fait', regle: 'impaye_ouvert' }), 'Entrée dans le groupe refusée (paiement en retard, facture à régler).')
  assert.equal(phraseGeste({ geste: 'arret', resultat: 'fait', regle: 'fenetre_30j', details: { factures_non_annulees: 0 } }),
    'Abonnement arrêté : paiement en retard depuis plus de 30 jours, facture annulée.')
  assert.equal(phraseGeste({ geste: 'arret', resultat: 'fait', regle: 'fenetre_30j', details: { factures_non_annulees: 1 } }),
    'Abonnement arrêté : paiement en retard depuis plus de 30 jours, facture pas encore annulée.')
  assert.equal(phraseGeste({ geste: 'arret', resultat: 'simule', regle: 'fenetre_30j' }), null)
  assert.equal(phraseGeste({ geste: 'arret', resultat: 'echec', regle: 'fenetre_30j' }), null)
  assert.equal(phraseGeste({ geste: 'rappel', resultat: 'fait', regle: 'fin_fenetre_30j', details: { canal: 'prive' } }),
    "Message de fin d'abonnement (paiement en retard de plus de 30 jours) envoyé.")
  assert.equal(phraseGeste({ geste: 'invitation', resultat: 'fait', regle: 'bienvenue_rattrapage' }), 'Email de bienvenue envoyé (rattrapage du passage quotidien).')
  // L'arret programme par un membre ne change pas.
  assert.equal(phraseGeste({ geste: 'arret', resultat: 'fait', regle: 'demande_membre', details: { fin: '2026-10-07' } }), 'Arrêt programmé au 7 octobre 2026.')
})

test('raison de la sortie : non rattache sorti il y a moins de 60 jours, une fois par sortie (Brice 06/10)', () => {
  assert.equal(JOURS_RAISON_SORTIE, 60)
  assert.equal(REGLE_RAISON_SORTIE, 'raison_sortie')
  const maintenant = Date.parse('2026-10-16T09:00:00Z')
  const ilYa = jours => new Date(maintenant - jours * 86_400_000)
  const retrait = (jours, extra = {}) => ({ geste: 'retrait', resultat: 'fait', regle: 'manuel', fait_le: ilYa(jours), ...extra })
  const libre = { rattache: false }

  // Ce que fait le bot a chaque message : raison due = envoyee, puis le geste
  // 'rappel' de REGLE_RAISON_SORTIE entre au journal (fait_le = l'instant).
  const ecrire = (journal, quand, o = libre) => {
    const due = sortieAExpliquer(journal, quand, o)
    if (due) journal.push({ geste: 'rappel', resultat: 'fait', regle: REGLE_RAISON_SORTIE, fait_le: new Date(quand).toISOString() })
    return due
  }

  // Sorti depuis 10 jours (equipe, regle 'manuel'), non rattache : la raison
  // au premier message, plus aux suivants.
  const journal = [retrait(10)]
  assert.deepEqual(ecrire(journal, maintenant), { retraitLe: ilYa(10).toISOString() })
  assert.equal(ecrire(journal, maintenant + 60_000), null)
  assert.equal(ecrire(journal, maintenant + 86_400_000), null)
  assert.equal(journal.filter(g => g.geste === 'rappel').length, 1)
  // Une NOUVELLE sortie apres la raison : la raison revient, une fois.
  journal.push({ geste: 'retrait', resultat: 'fait', regle: 'manuel', fait_le: new Date(maintenant + 2 * 86_400_000) })
  assert.ok(ecrire(journal, maintenant + 3 * 86_400_000))
  assert.equal(ecrire(journal, maintenant + 3 * 86_400_000 + 60_000), null)

  // Sorti depuis 90 jours : pas de raison. Limite de 60 jours.
  assert.equal(sortieAExpliquer([retrait(90)], maintenant, libre), null)
  assert.ok(sortieAExpliquer([retrait(59)], maintenant, libre))
  assert.equal(sortieAExpliquer([retrait(61)], maintenant, libre), null)
  // Le DERNIER retrait compte : un ancien retrait a 90 jours, un recent a 10.
  assert.deepEqual(sortieAExpliquer([retrait(10), retrait(90)], maintenant, libre), { retraitLe: ilYa(10).toISOString() })
  assert.equal(sortieAExpliquer([], maintenant, libre), null)

  // Rattache : comportement inchange (aucune raison, rien au journal).
  const rattache = [retrait(10)]
  assert.equal(ecrire(rattache, maintenant, { rattache: true }), null)
  assert.equal(rattache.length, 1)

  // Quelle que soit la regle ou l'acteur, mais une sortie FAITE seulement.
  for (const regle of ['manuel', 'impaye_5j', 'desabonne', null]) assert.ok(sortieAExpliquer([retrait(10, { regle })], maintenant, libre), String(regle))
  for (const resultat of ['simule', 'echec', 'refuse']) assert.equal(sortieAExpliquer([retrait(10, { resultat })], maintenant, libre), null, resultat)
  // Revenu dans le groupe depuis : rien. Une entree en echec ne compte pas.
  assert.equal(sortieAExpliquer([retrait(10), { geste: 'entree_acceptee', resultat: 'fait', regle: 'abonnement', fait_le: ilYa(5) }], maintenant, libre), null)
  assert.equal(sortieAExpliquer([retrait(10), { geste: 'reintegration', resultat: 'fait', regle: 'manuel', fait_le: ilYa(5) }], maintenant, libre), null)
  assert.ok(sortieAExpliquer([retrait(10), { geste: 'entree_acceptee', resultat: 'echec', regle: 'telegram', fait_le: ilYa(5) }], maintenant, libre))
  // Un autre rappel apres la sortie, ou une raison donnee pour une sortie
  // PLUS ANCIENNE : la raison reste due.
  assert.ok(sortieAExpliquer([retrait(10), { geste: 'rappel', resultat: 'fait', regle: 'sortie_impaye', fait_le: ilYa(5) }], maintenant, libre))
  assert.ok(sortieAExpliquer([retrait(10), { geste: 'rappel', resultat: 'fait', regle: REGLE_RAISON_SORTIE, fait_le: ilYa(20) }, retrait(25)], maintenant, libre))
  // Dates en texte (ISO) comme en Date (Prisma), lignes dans le desordre, date illisible ignoree.
  assert.equal(sortieAExpliquer([
    { geste: 'rappel', resultat: 'fait', regle: REGLE_RAISON_SORTIE, fait_le: ilYa(3).toISOString() },
    { geste: 'retrait', resultat: 'fait', regle: 'manuel', fait_le: ilYa(10).toISOString() },
  ], maintenant, libre), null)
  assert.equal(sortieAExpliquer([retrait(10, { fait_le: 'pas une date' })], maintenant, libre), null)

  // Le fil Support : une ligne lisible pour la raison donnee.
  assert.equal(phraseGeste({ geste: 'rappel', resultat: 'fait', regle: REGLE_RAISON_SORTIE, details: { retrait_le: ilYa(10).toISOString() } }),
    'Raison de la sortie du groupe donnée (compte non relié à un abonnement actif).')

  // Le texte : la raison, la verification par code, les deux portes ;
  // caracteres clavier seulement (ni tiret long, ni apostrophe courbe, ni
  // points de suspension en un caractere, ni espace insecable).
  const t = texteRaisonSortie()
  assert.ok(t.startsWith('Tu as été sorti du groupe Live Club'), t)
  assert.ok(t.includes("l'email utilisé pour le paiement") && t.includes('code'), t)
  assert.ok(t.endsWith(URLS_ABONNEMENT[1]) && t.includes(URLS_ABONNEMENT[0]) && t.includes(texteAbonnement()), t)
  assert.ok(!/[\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u00A0\u202F]/.test(t), t)
})

test('exemption datee = sortie programmee : rappel J-7 une fois, sortie le lendemain de la date sans autre droit (Brice 06/10)', () => {
  assert.equal(RAPPEL_FIN_EXEMPTION_JOURS, 7)
  // Cas reel : favorise jusqu'au 1er janvier 2027, relie a aucun abonnement.
  const ex = { jusquau: '2027-01-01', retireLe: null }
  const present = { presence: 'oui', intouchable: false, droit: 'non' }

  // Phases. jusquau est INCLUS (comme exemptionActive) : le 1er janvier est
  // encore couvert, la sortie part le 2.
  assert.equal(phaseExemption(ex, '2026-12-24'), 'en_cours')
  assert.equal(phaseExemption(ex, '2026-12-25'), 'rappel_j7')
  assert.equal(phaseExemption(ex, '2027-01-01'), 'rappel_j7')
  assert.equal(phaseExemption(ex, '2027-01-02'), 'echue')
  assert.equal(phaseExemption(ex, '2027-06-30'), 'echue')
  assert.equal(phaseExemption({ ...ex, retireLe: '2026-12-01T10:00:00Z' }, '2027-01-02'), 'retiree')
  // Permanente : jamais concernee, ni rappel ni sortie, interrupteur ou pas.
  const permanente = phaseExemption({ jusquau: null, retireLe: null }, '2027-01-02')
  assert.equal(permanente, 'permanente')
  for (const reel of [true, false]) {
    assert.equal(decisionFinExemption(permanente, false, present, reel), 'rien')
    assert.equal(decisionRappelExemption(permanente, false, present, reel), 'rien')
  }

  // Echue + present + droit 'non' : sortie.
  const echue = phaseExemption(ex, '2027-01-02')
  assert.equal(decisionFinExemption(echue, false, present, true), 'sortir')
  // Autre droit (abonnement, broker, acces manuel) : gardee, et close.
  assert.equal(decisionFinExemption(echue, false, { ...present, droit: 'oui' }, true), 'clore_autre_droit')
  // Admin ou createur : jamais sorti (le droit n'est meme pas lu), close.
  assert.equal(decisionFinExemption(echue, false, { presence: 'oui', intouchable: true, droit: 'inconnu' }, true), 'clore_admin')
  // Plus dans le groupe a la date : close, sans sortie ni message.
  assert.equal(decisionFinExemption(echue, false, { presence: 'non', intouchable: false, droit: 'inconnu' }, true), 'clore_absent')
  // Droit ou presence inconnus : rien.
  assert.equal(decisionFinExemption(echue, false, { ...present, droit: 'inconnu' }, true), 'inconnu')
  assert.equal(decisionFinExemption(echue, false, { ...present, presence: 'inconnu' }, true), 'inconnu')
  // Pas encore echue : aucune sortie.
  assert.equal(decisionFinExemption('rappel_j7', false, present, true), 'rien')
  assert.equal(decisionFinExemption('en_cours', false, present, true), 'rien')

  // Rappel J-7 : seulement a quelqu'un qui sortira vraiment.
  const j7 = phaseExemption(ex, '2026-12-25')
  assert.equal(decisionRappelExemption(j7, false, present, true), 'envoyer')
  assert.equal(decisionRappelExemption(j7, false, { ...present, droit: 'oui' }, true), 'inutile')
  assert.equal(decisionRappelExemption(j7, false, { presence: 'oui', intouchable: true, droit: 'inconnu' }, true), 'inutile')
  assert.equal(decisionRappelExemption(j7, false, { presence: 'non', intouchable: false, droit: 'inconnu' }, true), 'inutile')
  assert.equal(decisionRappelExemption(j7, false, { ...present, droit: 'inconnu' }, true), 'inconnu')
  assert.equal(decisionRappelExemption(j7, false, { ...present, presence: 'inconnu' }, true), 'inconnu')
  assert.equal(decisionRappelExemption('en_cours', false, present, true), 'rien')
  assert.equal(decisionRappelExemption(echue, false, present, true), 'rien')

  // Une fois par exemption : le journal (details.exemption_id) dit deja fait.
  const journal = new Set()
  const passer = (jour, lecture = present, reel = true) => {
    const phase = phaseExemption(ex, jour)
    if (phase === 'rappel_j7') {
      const d = decisionRappelExemption(phase, journal.has('rappel'), lecture, reel)
      if (d === 'envoyer' || d === 'simuler') journal.add('rappel')
      return d
    }
    const d = decisionFinExemption(phase, journal.has('sortie'), lecture, reel)
    if (d === 'sortir' || d === 'simuler') journal.add('sortie')
    return d
  }
  assert.equal(passer('2026-12-25'), 'envoyer')
  assert.equal(passer('2026-12-26'), 'deja_fait')
  assert.equal(passer('2027-01-01'), 'deja_fait')
  assert.equal(passer('2027-01-02'), 'sortir')
  assert.equal(passer('2027-01-03'), 'deja_sortie')

  // Sans l'interrupteur : rappel et sortie SIMULES, une fois aussi.
  const avant = process.env.LIVECLUB_SORTIES_ACTIVES
  try {
    delete process.env.LIVECLUB_SORTIES_ACTIVES
    assert.equal(decisionFinExemption(echue, false, present, sortiesActives()), 'simuler')
    assert.equal(decisionRappelExemption(j7, false, present, sortiesActives()), 'simuler')
    journal.clear()
    assert.equal(passer('2027-01-02', present, sortiesActives()), 'simuler')
    assert.equal(passer('2027-01-03', present, sortiesActives()), 'deja_sortie')
    process.env.LIVECLUB_SORTIES_ACTIVES = '1'
    assert.equal(decisionFinExemption(echue, false, present, sortiesActives()), 'sortir')
  } finally {
    if (avant === undefined) delete process.env.LIVECLUB_SORTIES_ACTIVES
    else process.env.LIVECLUB_SORTIES_ACTIVES = avant
  }

  // Jour de Paris ET current_date de la base : echue seulement quand les deux
  // le disent (sinon retirerDuLiveClub refuserait pour \u00AB exempte \u00BB).
  assert.equal(jourLePlusAncien('2027-01-02', '2027-01-01'), '2027-01-01')
  assert.equal(jourLePlusAncien('2027-01-02', '2027-01-03'), '2027-01-02')
  assert.equal(jourLePlusAncien('2027-01-02', null), '2027-01-02')
  assert.equal(jourLePlusAncien('2027-01-02', 'illisible'), '2027-01-02')
  // 23 h 30 UTC le 1er janvier : deja le 2 a Paris, encore le 1er pour la base.
  assert.equal(phaseExemption(ex, jourLePlusAncien(jourParis('2027-01-01T23:30:00Z'), '2027-01-01')), 'rappel_j7')
  // Le cron de 7 h UTC le 2 janvier : echue.
  assert.equal(phaseExemption(ex, jourLePlusAncien(jourParis('2027-01-02T07:00:00Z'), '2027-01-02')), 'echue')

  // Fil Support.
  assert.equal(phraseGeste({ geste: 'fin_acces', resultat: 'fait', regle: 'fin_exemption' }), "Sortie du groupe (fin de l'acc\u00E8s offert).")
  assert.equal(phraseGeste({ geste: 'fin_acces', resultat: 'simule', regle: 'fin_exemption' }), null)
  assert.equal(phraseGeste({ geste: 'fin_acces', resultat: 'refuse', regle: 'fin_exemption', details: { cloture: 'absent' } }),
    "Fin de l'acc\u00E8s offert : d\u00E9j\u00E0 hors du groupe, exemption close.")
  assert.equal(phraseGeste({ geste: 'fin_acces', resultat: 'refuse', regle: 'fin_exemption', details: { cloture: 'autre_droit', raison_droit: 'abonnement' } }),
    "Fin de l'acc\u00E8s offert : gard\u00E9 dans le groupe (abonnement), exemption close.")
  assert.equal(phraseGeste({ geste: 'fin_acces', resultat: 'refuse', regle: 'fin_exemption', details: { cloture: 'autre_droit', raison_droit: 'acces_broker' } }),
    "Fin de l'acc\u00E8s offert : gard\u00E9 dans le groupe (acc\u00E8s broker), exemption close.")
  assert.equal(phraseGeste({ geste: 'fin_acces', resultat: 'refuse', regle: 'fin_exemption', details: { cloture: 'admin' } }),
    "Fin de l'acc\u00E8s offert : administrateur du groupe, gard\u00E9, exemption close.")
  // Un refus de retirerDuLiveClub garde sa regle, le motif dit d'ou il vient.
  assert.equal(phraseGeste({ geste: 'fin_acces', resultat: 'refuse', regle: 'plafond_passage', details: { motif: 'fin_exemption' } }),
    "Sortie de fin d'acc\u00E8s offert non faite (plafond du passage atteint, report\u00E9e).")
  assert.equal(phraseGeste({ geste: 'rappel', resultat: 'fait', regle: 'fin_exemption_j7', details: { canal: 'email' } }),
    "Rappel de fin d'acc\u00E8s offert envoy\u00E9 par email (J-7).")
  assert.equal(phraseGeste({ geste: 'rappel', resultat: 'fait', regle: 'fin_exemption_message', details: { canal: 'prive' } }),
    "Message de fin d'acc\u00E8s offert envoy\u00E9.")
  // L'acces broker ne change pas.
  assert.equal(phraseGeste({ geste: 'fin_acces', resultat: 'fait', regle: 'broker_fin' }), "Sortie du groupe (fin d'acc\u00E8s broker).")

  // Les deux textes (emails.ts, non importable sans compilateur) : presents,
  // avec les deux portes d'abonnement, en caracteres clavier.
  const source = readFileSync(new URL('../src/lib/liveclub/emails.ts', import.meta.url), 'utf8')
  for (const nom of ['modeleRappelFinExemption', 'modeleFinExemption']) {
    const debut = source.indexOf(`export function ${nom}(`)
    assert.ok(debut >= 0, nom)
    const corps = source.slice(debut, source.indexOf('\n}\n', debut))
    assert.ok(corps.includes('texteAbonnement()'), nom)
    assert.ok(!/[\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u00A0\u202F]/.test(corps), nom)
  }
})

test('acces offert sans abonnement, compte non rattache (Nelly, 06/10)', () => {
  const portes = texteAbonnement()
  const lire = droit => accesSansAbonnement(droit, { texteAbonnement: portes })
  // Ce qui ne doit jamais sortir : la demande d'email ou de code, la raison
  // d'une sortie, le motif interne d'une exemption, sa note.
  const interdits = ['email', 'code', 'sorti', 'favoris', 'fondateur', 'admin', 'NOTE_INTERNE']
  // Tirets longs, apostrophes et guillemets courbes, points de suspension,
  // espaces insecables (par leurs codes : ce fichier reste en caracteres clavier).
  const horsClavier = new RegExp(`[${[0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0xa0, 0x202f].map(c => String.fromCharCode(c)).join('')}]`)
  const propre = (texte, nom) => {
    for (const mot of interdits) assert.ok(!texte.toLowerCase().includes(mot.toLowerCase()), `${nom} : ${mot}`)
    assert.ok(!horsClavier.test(texte), `${nom} : caracteres clavier`)
  }

  // Non rattache + exemption permanente : le texte offert, sans date.
  const permanente = { statut: 'oui', raison: 'exemption', motif: 'favorise', note: 'NOTE_INTERNE' }
  assert.equal(parcoursSansRattachement('aucun', permanente), 'acces_offert')
  const p = lire(permanente)
  assert.equal(p.texte, "Ton accès au Live Club t'est offert par l'équipe : rien à payer ni à gérer ici. "
    + "Une question ? Écris-moi, et s'il faut un humain je transmets à l'équipe.")
  propre(p.texte, 'exemption permanente')
  assert.ok(!JSON.stringify(p.faits).includes('favoris') && !JSON.stringify(p.faits).includes('NOTE_INTERNE'))
  assert.equal(p.faits.jusquau, null)
  assert.equal(p.faits.sans_date_de_fin, true)
  // Pause, arret : rien a gerer, l'acces est offert.
  assert.ok(p.rienAGerer.includes('rien à mettre en pause ni à arrêter'))
  assert.ok(p.rienAGerer.includes('offert'))
  propre(p.rienAGerer, 'rien a gerer')

  // Exemption datee : la date de fin, incluse, en francais.
  const datee = lire({ statut: 'oui', raison: 'exemption', fin: '2027-01-01' })
  assert.equal(datee.texte, "Ton accès au Live Club t'est offert par l'équipe jusqu'au 1er janvier 2027 : rien à payer ni à gérer ici. "
    + "Une question ? Écris-moi, et s'il faut un humain je transmets à l'équipe.")
  assert.equal(datee.faits.jusquau, '1er janvier 2027')
  assert.equal(datee.faits.sans_date_de_fin, false)
  propre(datee.texte, 'exemption datee')

  // Acces broker (lie au telegram_id) : le texte d'avant, avec les deux portes.
  const broker = { statut: 'oui', raison: 'acces_broker', fin: '2027-03-15' }
  assert.equal(parcoursSansRattachement('aucun', broker), 'acces_offert')
  const b = lire(broker)
  assert.equal(b.texte, "Tu as un accès offert au Live Club jusqu'au 15 mars 2027, grâce à ton compte chez notre broker partenaire. "
    + `Il n'est pas renouvelable : pour rester après, il suffira de t'abonner.\n\n${portes}`)
  for (const url of URLS_ABONNEMENT) assert.ok(b.texte.includes(url))
  assert.deepEqual(b.faits, { acces: 'offert_broker', jusquau: '15 mars 2027', renouvelable: false, rien_a_payer: true })

  // Acces manuel : ouvert jusqu'a sa date, sans abonnement a gerer.
  const manuel = lire({ statut: 'oui', raison: 'acces_manuel', fin: '2026-12-31' })
  assert.ok(manuel.texte.startsWith("Ton accès au Live Club est ouvert jusqu'au 31 décembre 2026, sans abonnement à gérer ici."))
  propre(manuel.texte, 'acces manuel')

  // Non rattache SANS droit : le parcours d'avant (raison de sortie, code).
  const sans = { statut: 'non', raison: null }
  assert.equal(parcoursSansRattachement('aucun', sans), 'non_rattache')
  assert.equal(lire(sans), null)
  // Un impaye (dette) reste un 'non' : pas un acces offert.
  assert.equal(parcoursSansRattachement('aucun', { ...sans, dette: { depuis: 'x', limite: 'y', aRegler: [] } }), 'non_rattache')

  // Droit inconnu (une source illisible) : PANNE, ni email ni raison de sortie.
  const inconnu = { statut: 'inconnu', raison: null }
  assert.equal(parcoursSansRattachement('aucun', inconnu), 'panne')
  assert.equal(lire(inconnu), null)
  // Rattachement illisible : panne, SAUF si l'exemption a pu etre lue (elle se lit seule).
  assert.equal(parcoursSansRattachement('illisible', inconnu), 'panne')
  assert.equal(parcoursSansRattachement('illisible', sans), 'panne')
  assert.equal(parcoursSansRattachement('illisible', permanente), 'acces_offert')

  // Un droit ouvert par un abonnement n'est pas un acces offert (il passe par le rattachement).
  assert.equal(lire({ statut: 'oui', raison: 'abonnement', fin: '2026-11-01' }), null)
  assert.equal(parcoursSansRattachement('aucun', { statut: 'oui', raison: 'abonnement' }), 'non_rattache')
})

// Caracteres hors clavier (tirets longs, guillemets et apostrophes courbes,
// points de suspension, espaces insecables), par leurs codes.
const HORS_CLAVIER = new RegExp(`[${[0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0xa0, 0x202f].map(c => String.fromCharCode(c)).join('')}]`)

test("l'equipe qui ecrit au bot des membres part a l'agent du Cockpit (Melanie, 08/10)", () => {
  // Texte libre d'un compte de l'equipe : l'agent du Cockpit.
  assert.equal(aiguillageMessagePrive('Tu peux re integrer dans le groupe live club : x@y.fr', true), 'agent_cockpit')
  // Le meme texte d'un membre : le parcours d'un membre, inchange.
  assert.equal(aiguillageMessagePrive('Tu peux re integrer dans le groupe live club : x@y.fr', false), 'membre')
  // /start, /menu (avec jeton ou @nom_du_bot) restent au bot, meme pour l'equipe.
  for (const c of ['/start', '/menu', '/start abcdefghijklmnopqrstuvwx', '/START', '/menu@aok_liveclub_bot', ' /start ']) {
    assert.equal(aiguillageMessagePrive(c, true), 'commande', c)
    assert.equal(aiguillageMessagePrive(c, false), 'commande', c)
  }
  // Une autre commande n'est pas une commande du bot : texte libre.
  assert.equal(aiguillageMessagePrive('/reset', true), 'agent_cockpit')
  assert.equal(aiguillageMessagePrive('/start un deux', true), 'agent_cockpit')
  // Rien d'ecrit : ni l'agent ni le membre.
  assert.equal(aiguillageMessagePrive('   ', true), 'sans_texte')
  assert.equal(aiguillageMessagePrive('', false), 'sans_texte')
  // La regex est sans etat (pas de drapeau g) : deux tests de suite donnent le meme resultat.
  assert.ok(COMMANDE_BOT_MEMBRE.test('/menu') && COMMANDE_BOT_MEMBRE.test('/menu'))
  assert.equal(COMMANDE_BOT_MEMBRE.exec('/start JETON')[2], 'JETON')
  // Les deux phrases du bot, mot pour mot, en caracteres clavier.
  assert.equal(TEXTE_TRANSMIS_AU_COCKPIT, "Tu es de l'équipe : je passe ta demande à l'agent du Cockpit, sa réponse arrive dans Agent AOK.")
  assert.equal(TEXTE_NON_TRANSMIS_AU_COCKPIT, "Je n'ai pas pu la passer : écris-la directement à Agent AOK.")
  for (const t of [TEXTE_TRANSMIS_AU_COCKPIT, TEXTE_NON_TRANSMIS_AU_COCKPIT]) assert.ok(!HORS_CLAVIER.test(t), t)
})

test('reintegration par l agent du Cockpit : le droit d abord (08/10)', () => {
  // Droit ouvert : rien a refuser.
  assert.equal(refusReintegration({ statut: 'oui' }, 'Paul', 'aok_liveclub_bot'), null)
  // Aucun droit : refus, qui dit quel droit poser, et par ou la personne entre ensuite.
  const sans = refusReintegration({ statut: 'non' }, 'Paul', 'aok_liveclub_bot')
  assert.equal(sans.genre, 'refus')
  assert.equal(sans.regle, 'sans_droit')
  assert.ok(sans.message.startsWith("Paul n'a aucun droit ouvert au Live Club"))
  for (const mot of ['accès broker', 'dépôt', 'exemption', "geste de l'équipe", '@aok_liveclub_bot']) assert.ok(sans.message.includes(mot), mot)
  assert.ok(!HORS_CLAVIER.test(sans.message))
  // Impaye : pas de droit a poser, la facture rouvre l'acces.
  const impaye = refusReintegration({ statut: 'non', dette: { depuis: 'x' } }, 'Paul', 'aok_liveclub_bot')
  assert.equal(impaye.genre, 'refus')
  assert.equal(impaye.regle, 'impaye_ouvert')
  assert.ok(impaye.message.includes('facture'))
  // Droit illisible : une panne, rien n'est tente.
  const inconnu = refusReintegration({ statut: 'inconnu' }, 'Paul', 'aok_liveclub_bot')
  assert.equal(inconnu.genre, 'panne')
  assert.equal(inconnu.regle, 'droit_inconnu')
  // Au fil Support du compte : la ligne du refus dit pourquoi.
  assert.equal(phraseGeste({ geste: 'reintegration', resultat: 'refuse', regle: 'sans_droit' }), 'Réintégration non faite (aucun droit ouvert).')
  assert.equal(phraseGeste({ geste: 'reintegration', resultat: 'refuse', regle: 'impaye_ouvert' }), 'Réintégration non faite (paiement en retard).')
  assert.equal(phraseGeste({ geste: 'reintegration', resultat: 'echec', regle: 'droit_inconnu' }), null)
})

test('etape humaine suivante apres un geste de l agent du Cockpit (08/10)', () => {
  const bot = 'aok_liveclub_bot'
  // Exemption (ou droit pose sans email).
  assert.equal(etapeApresExemption('Paul', bot), "Dis à Paul d'ouvrir @aok_liveclub_bot et d'appuyer sur Démarrer : il gère son entrée tout seul.")
  // Reintegration : le lien.
  assert.equal(etapeApresReintegration('Paul', 'https://t.me/+abc'), 'Transmets ce lien à Paul : https://t.me/+abc')
  // Acces broker, email parti : rien a faire.
  assert.equal(etapeApresAccesBroker([{ email: 'a@x.fr', resultat: 'accorde', emailEnvoye: true }], bot),
    'Rien à faire : a@x.fr reçoit un email avec son lien vers le bot.')
  assert.equal(etapeApresAccesBroker([
    { email: 'a@x.fr', resultat: 'accorde', emailEnvoye: true },
    { email: 'b@x.fr', resultat: 'accorde', emailEnvoye: true, renvoi: true },
    { email: 'c@x.fr', resultat: 'deja_accorde' },
  ], bot), 'Rien à faire : chaque adresse accordée reçoit un email avec son lien vers le bot.')
  // Email pas parti : dire a la personne d'ouvrir le bot (une ligne, seulement celles-la).
  assert.equal(etapeApresAccesBroker([
    { email: 'a@x.fr', resultat: 'accorde', emailEnvoye: true },
    { email: 'b@x.fr', resultat: 'accorde', emailEnvoye: false },
  ], bot), "Dis à b@x.fr d'ouvrir @aok_liveclub_bot et d'appuyer sur Démarrer : il gère son entrée tout seul.")
  assert.equal(etapeApresAccesBroker([
    { email: 'a@x.fr', resultat: 'accorde', emailEnvoye: false },
    { email: 'b@x.fr', resultat: 'accorde' },
    { email: 'c@x.fr', resultat: 'accorde', emailEnvoye: false },
  ], bot), "Dis à a@x.fr, b@x.fr et c@x.fr d'ouvrir @aok_liveclub_bot et d'appuyer sur Démarrer : chacun gère son entrée tout seul.")
  // Rien d'accorde (deja eu, deja abonne, illisible, echec).
  assert.equal(etapeApresAccesBroker([
    { email: 'a@x.fr', resultat: 'deja_accorde' }, { email: 'b@x.fr', resultat: 'deja_abonne' },
  ], bot), "Rien d'autre à faire : aucun accès n'a été ouvert.")
  for (const t of [etapeApresExemption('P', bot), etapeApresAccesBroker([], bot)]) {
    assert.ok(!HORS_CLAVIER.test(t))
    assert.ok(!t.includes('\n'), 'une seule ligne')
  }
})

test('exemption proposee par l agent du Cockpit : parametres (08/10)', () => {
  const jour = '2026-10-08'
  assert.deepEqual(MOTIFS_EXEMPTION, ['fondateur', 'admin', 'equipe', 'favorise'])
  // Le cas nominal, motif accentue accepte, date incluse.
  assert.deepEqual(
    lireParamsExemption({ telegram_id: 'u123456789', motif: 'Équipe', jusquau: '2027-01-01', note: '  geste  ', qui: ' Paul ' }, jour),
    { telegram_id: 123456789, motif: 'equipe', jusquau: '2027-01-01', note: 'geste', qui: 'Paul' },
  )
  // Sans date : permanente ; aujourd'hui est accepte (inclus).
  assert.equal(lireParamsExemption({ telegram_id: 123456789, motif: 'favorisé', qui: 'P' }, jour).jusquau, null)
  assert.equal(lireParamsExemption({ telegram_id: 123456789, motif: 'favorise', jusquau: '', qui: 'P' }, jour).jusquau, null)
  assert.equal(lireParamsExemption({ telegram_id: 123456789, motif: 'admin', jusquau: jour, qui: 'P' }, jour).jusquau, jour)
  // Refus : pas de compte Telegram (on le demande, on ne le devine pas), motif inconnu, date passee ou illisible, qui absent.
  const refus = (p) => typeof lireParamsExemption(p, jour) === 'string'
  assert.ok(lireParamsExemption({ motif: 'admin', qui: 'P' }, jour).includes('demande le compte Telegram'))
  assert.ok(refus({ telegram_id: '@paul', motif: 'admin', qui: 'P' }))
  assert.ok(refus({ telegram_id: 123456789, motif: 'cadeau', qui: 'P' }))
  assert.ok(refus({ telegram_id: 123456789, motif: 'admin', jusquau: '2026-10-07', qui: 'P' }))
  assert.ok(refus({ telegram_id: 123456789, motif: 'admin', jusquau: '2026-02-30', qui: 'P' }))
  assert.ok(refus({ telegram_id: 123456789, motif: 'admin', jusquau: '01/01/2027', qui: 'P' }))
  assert.ok(refus({ telegram_id: 123456789, motif: 'admin' }))
  // Le numero Telegram : avec ou sans u, jamais un pseudo.
  assert.equal(lireTelegramId('u1899133088'), 1899133088)
  assert.equal(lireTelegramId(255151279), 255151279)
  assert.equal(lireTelegramId('melmom'), null)
  // pose_par : l'uuid de l'acteur, jamais un texte libre.
  assert.equal(uuidDeActeur('agent:0A1B2C3D-0000-4000-8000-000000000001'), '0a1b2c3d-0000-4000-8000-000000000001')
  assert.equal(uuidDeActeur('cockpit:0a1b2c3d-0000-4000-8000-000000000001'), '0a1b2c3d-0000-4000-8000-000000000001')
  assert.equal(uuidDeActeur('agent'), null)
  assert.equal(uuidDeActeur('agent:melanie'), null)
  assert.equal(uuidDeActeur('cron:liveclub'), null)
})

test('demandes de l equipe notees par l agent du Cockpit (08/10)', () => {
  // Texte ramene a une ligne, citation gardee telle quelle (bornee).
  assert.deepEqual(lireDemande({ texte: '  Pouvoir prolonger\n un accès broker  ', citation: ' tu peux prolonger ?\nmerci ' }),
    { texte: 'Pouvoir prolonger un accès broker', citation: 'tu peux prolonger ?\nmerci' })
  assert.equal(lireDemande({ texte: 'Un rapport mensuel des pauses', citation: '' }).citation, null)
  assert.equal(lireDemande({ texte: 'Un rapport mensuel des pauses', citation: 'x'.repeat(900) }).citation.length, MAX_CITATION_DEMANDE)
  // Refus rendus au modele : texte vide, trop court, trop long, entree illisible.
  assert.equal(typeof lireDemande({ texte: '', citation: 'x' }), 'string')
  assert.equal(typeof lireDemande({ texte: 'abc' }), 'string')
  assert.equal(typeof lireDemande({ texte: 'x'.repeat(MAX_TEXTE_DEMANDE + 1) }), 'string')
  assert.equal(typeof lireDemande({ texte: 'x'.repeat(MAX_TEXTE_DEMANDE) }), 'object')
  assert.equal(typeof lireDemande(null), 'string')
  // Auteur : le libelle du compte Telegram, sinon cockpit:<uuid>.
  assert.equal(auteurDemande({ libelle: 'melanie', userId: 'u-1' }), 'melanie')
  assert.equal(auteurDemande({ libelle: '  ', userId: 'u-1' }), 'cockpit:u-1')
  assert.equal(auteurDemande({ userId: 'u-1' }), 'cockpit:u-1')
})

// Blocs asynchrones (13/10) : le lecteur de la liste des produits est async.
const testAsync = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }

// Le produit de Yassine (compte melanie, lu en lecture seule chez Stripe le 13/10).
const PRODUIT_YASSINE = 'prod_VR1P7PggEH30B9'
const TARIF_YASSINE = 'price_1UQ9MnCbHiN0O0XimKBHXyiv'

await testAsync('produits Live Club : liste en base, cache court, repli sur les deux produits de base (Brice 13/10)', async () => {
  // Fusion : la base d'abord, puis la base de donnees, sans doublon ni identifiant douteux.
  assert.deepEqual(
    fusionnerProduitsLiveClub(PRODUITS_LIVECLUB, [PRODUIT_YASSINE, PRODUITS_LIVECLUB[0], 'price_123456', null, 42, ' prod_ABCDEF12 ']),
    [...PRODUITS_LIVECLUB, PRODUIT_YASSINE, 'prod_ABCDEF12'],
  )
  assert.deepEqual(fusionnerProduitsLiveClub(PRODUITS_LIVECLUB, []), [...PRODUITS_LIVECLUB])

  let t = 1_000_000
  let appels = 0
  let lecture = () => [PRODUIT_YASSINE]
  const pannes = []
  const lecteur = creerLecteurProduitsLiveClub(async () => { appels++; return lecture() }, {
    connus: PRODUITS_LIVECLUB, dureeMs: 60_000, retenterMs: 15_000, maintenant: () => t,
    estAbsente: relationAbsente, surPanne: e => pannes.push(e),
  })
  let l = await lecteur.lire()
  assert.deepEqual(l, { produits: [...PRODUITS_LIVECLUB, PRODUIT_YASSINE], complete: true, source: 'base' })
  // Reconnu avec la liste lue, pas avec la seule base du code (le bug du 13/10).
  assert.ok(estProduitLiveClub(PRODUIT_YASSINE, l.produits))
  assert.ok(!estProduitLiveClub(PRODUIT_YASSINE))
  assert.ok(estProduitLiveClub(PRODUITS_LIVECLUB[1]))
  // Un abonnement au produit de Yassine : un abonnement Live Club avec la liste, rien sans elle.
  const subYassine = { id: 'sub_YASSINE12345', status: 'active', customer: 'cus_YASSINE12345',
    items: { data: [{ price: { product: PRODUIT_YASSINE, unit_amount: 100, currency: 'eur', recurring: { interval: 'month', interval_count: 1 } } }] } }
  assert.equal(resumerAbonnement(subYassine, l.produits)?.produit, PRODUIT_YASSINE)
  assert.equal(resumerAbonnement(subYassine, PRODUITS_LIVECLUB), null)

  // Cache de 60 s : pas de relecture avant, relecture apres.
  t += 59_000
  await lecteur.lire()
  assert.equal(appels, 1)
  t += 2_000
  await lecteur.lire()
  assert.equal(appels, 2)

  // Panne APRES une lecture reussie : la derniere liste lue, toujours complete.
  lecture = () => { throw new Error('connexion refusee') }
  t += 61_000
  l = await lecteur.lire()
  assert.deepEqual(l, { produits: [...PRODUITS_LIVECLUB, PRODUIT_YASSINE], complete: true, source: 'cache_perime' })
  assert.equal(pannes.length, 1)
  // Pas de nouvel essai avant 15 s, puis un essai.
  t += 10_000
  await lecteur.lire()
  assert.equal(appels, 3)
  t += 6_000
  await lecteur.lire()
  assert.equal(appels, 4)
  // La base revient : relue tout de suite.
  lecture = () => [PRODUIT_YASSINE, 'prod_NOUVEAU123']
  t += 16_000
  assert.deepEqual((await lecteur.lire()).produits, [...PRODUITS_LIVECLUB, PRODUIT_YASSINE, 'prod_NOUVEAU123'])
  // oublier() (apres une inscription) : relecture immediate, sans attendre 60 s.
  const avant = appels
  lecture = () => [PRODUIT_YASSINE]
  lecteur.oublier()
  await lecteur.lire()
  assert.equal(appels, avant + 1)

  // Panne SANS aucune liste lue : les deux produits de base, jamais perdus, liste NON complete.
  const froid = creerLecteurProduitsLiveClub(async () => { throw new Error('base injoignable') }, {
    connus: PRODUITS_LIVECLUB, maintenant: () => t, estAbsente: relationAbsente, surPanne: () => {},
  })
  l = await froid.lire()
  assert.deepEqual(l, { produits: [...PRODUITS_LIVECLUB], complete: false, source: 'repli' })
  assert.ok(PRODUITS_LIVECLUB.every(p => estProduitLiveClub(p, l.produits)))

  // Table absente (migration pas appliquee) : pas une panne, aucun produit de plus, liste complete.
  const absente = creerLecteurProduitsLiveClub(async () => {
    throw new Error('relation "public.cockpit_liveclub_produits" does not exist')
  }, { connus: PRODUITS_LIVECLUB, maintenant: () => t, estAbsente: relationAbsente })
  assert.deepEqual(await absente.lire(), { produits: [...PRODUITS_LIVECLUB], complete: true, source: 'base_absente' })

  // Reponse illisible : la base du code seule, rien de douteux ne passe.
  const bizarre = creerLecteurProduitsLiveClub(async () => 'pas une liste', { connus: PRODUITS_LIVECLUB, maintenant: () => t })
  assert.deepEqual((await bizarre.lire()).produits, [...PRODUITS_LIVECLUB])

  // Appels simultanes : une seule lecture de la base.
  let simultanes = 0
  const lent = creerLecteurProduitsLiveClub(async () => { simultanes++; await new Promise(r => setTimeout(r, 5)); return [PRODUIT_YASSINE] },
    { connus: PRODUITS_LIVECLUB, maintenant: () => t })
  const [a, b] = await Promise.all([lent.lire(), lent.lire()])
  assert.equal(simultanes, 1)
  assert.deepEqual(a, b)

  // Marquer un produit existant : parametres.
  assert.deepEqual(lireParamsMarquageLiveClub({ produit_id: ` ${PRODUIT_YASSINE} `, note: ' Yassine, ETM ' }),
    { produit_id: PRODUIT_YASSINE, note: 'Yassine, ETM', produit_nom: null })
  assert.equal(typeof lireParamsMarquageLiveClub({ produit_id: TARIF_YASSINE }), 'string')
  assert.equal(typeof lireParamsMarquageLiveClub({}), 'string')
})

test('lien de paiement : parametres, un seul paiement, retour sur la page de bienvenue, email prerempli (Brice 13/10)', () => {
  // Parametres du modele.
  assert.deepEqual(lireParamsLienPaiement({ produit_id: PRODUIT_YASSINE, email: ' Yassine.T@Gmail.com ', qui: ' Yassine ' }), {
    produit_id: PRODUIT_YASSINE, price_id: null, email: 'yassine.t@gmail.com', qui: 'Yassine',
    produit_nom: null, montant_centimes: null, devise: null, recurrence: null, nb_intervalles: null, live_club: null,
  })
  assert.equal(lireParamsLienPaiement({ produit_id: PRODUIT_YASSINE, price_id: TARIF_YASSINE, qui: 'Yassine', email: '' }).email, null)
  assert.equal(typeof lireParamsLienPaiement({ produit_id: 'Live Club ETM', qui: 'Yassine' }), 'string')
  assert.equal(typeof lireParamsLienPaiement({ produit_id: PRODUIT_YASSINE, price_id: 'prod_ABCDEF12', qui: 'Yassine' }), 'string')
  assert.equal(typeof lireParamsLienPaiement({ produit_id: PRODUIT_YASSINE, email: 'yassine@', qui: 'Yassine' }), 'string')
  assert.equal(typeof lireParamsLienPaiement({ produit_id: PRODUIT_YASSINE }), 'string')
  // Champs du serveur (controle avant la carte) : gardes s'ils sont bien formes, sinon ignores.
  const controle = lireParamsLienPaiement({
    produit_id: PRODUIT_YASSINE, price_id: TARIF_YASSINE, qui: 'Yassine', produit_nom: 'Live Club ETM (tarif symbolique)',
    montant_centimes: 100, devise: 'EUR', recurrence: 'month', nb_intervalles: 1, live_club: true,
  })
  assert.equal(controle.montant_centimes, 100)
  assert.equal(controle.devise, 'eur')
  assert.equal(controle.live_club, true)
  const douteux = lireParamsLienPaiement({ produit_id: PRODUIT_YASSINE, qui: 'Y', montant_centimes: -5, recurrence: 'hourly', live_club: 'oui' })
  assert.equal(douteux.montant_centimes, null)
  assert.equal(douteux.recurrence, null)
  assert.equal(douteux.live_club, null)

  // Le corps du Payment Link : un seul paiement, retour sur la page de bienvenue.
  const corps = corpsLienPaiement({ priceId: TARIF_YASSINE, liveClub: true, urlBienvenue: URL_BIENVENUE_LIVECLUB, qui: 'Yassine' })
  assert.equal(corps['line_items[0][price]'], TARIF_YASSINE)
  assert.equal(corps['line_items[0][quantity]'], '1')
  assert.equal(corps['restrictions[completed_sessions][limit]'], '1')
  assert.equal(corps['after_completion[type]'], 'redirect')
  assert.equal(corps['after_completion[redirect][url]'], 'https://aoknowledge.com/live-club/bienvenue?session_id={CHECKOUT_SESSION_ID}')
  // Encode en form-urlencoded puis decode (ce que fait Stripe) : le gabarit arrive intact.
  assert.equal(new URLSearchParams(new URLSearchParams(corps).toString()).get('after_completion[redirect][url]'), URL_BIENVENUE_LIVECLUB)
  assert.equal(corps['metadata[pour]'], 'Yassine')
  // Hors Live Club : pas de redirection, toujours un seul paiement.
  const autre = corpsLienPaiement({ priceId: TARIF_YASSINE, liveClub: false, urlBienvenue: URL_BIENVENUE_LIVECLUB, qui: 'Paul' })
  assert.equal(autre['after_completion[type]'], undefined)
  assert.equal(autre['after_completion[redirect][url]'], undefined)
  assert.equal(autre['restrictions[completed_sessions][limit]'], '1')

  // Email prerempli.
  assert.equal(urlLienAvecEmail('https://buy.stripe.com/test_abc', 'yassine.t+lc@gmail.com'),
    'https://buy.stripe.com/test_abc?prefilled_email=yassine.t%2Blc%40gmail.com')
  assert.equal(urlLienAvecEmail('https://buy.stripe.com/abc?locale=fr', 'a@b.fr'), 'https://buy.stripe.com/abc?locale=fr&prefilled_email=a%40b.fr')
  assert.equal(urlLienAvecEmail('https://buy.stripe.com/abc', null), 'https://buy.stripe.com/abc')

  // Le tarif : le seul actif, ou celui demande ; sinon la raison, pour le modele.
  const mensuel = lireTarifStripe({ id: TARIF_YASSINE, object: 'price', product: PRODUIT_YASSINE, active: true, unit_amount: 100, currency: 'eur',
    recurring: { interval: 'month', interval_count: 1 } })
  assert.deepEqual(mensuel, { id: TARIF_YASSINE, produit: PRODUIT_YASSINE, actif: true, montant: 100, devise: 'eur', recurrence: 'month', nbIntervalles: 1 })
  assert.equal(libelleTarif(mensuel), '1 € par mois')
  const trimestre = lireTarifStripe({ id: 'price_TRIM123456', product: { id: PRODUIT_YASSINE }, active: true, unit_amount: 29700, currency: 'eur',
    recurring: { interval: 'month', interval_count: 3 } })
  assert.equal(libelleTarif(trimestre), '297 € tous les 3 mois')
  const comptant = lireTarifStripe({ id: 'price_COMPT12345', product: 'prod_AUTRE12345', active: true, unit_amount: 5050, currency: 'eur', recurring: null })
  assert.equal(libelleTarif(comptant), '50,50 € en une fois')
  assert.equal(lireTarifStripe({ id: 'pas_un_tarif' }), null)
  assert.equal(choisirTarif([mensuel], PRODUIT_YASSINE, null), mensuel)
  assert.equal(choisirTarif([mensuel, trimestre], PRODUIT_YASSINE, 'price_TRIM123456'), trimestre)
  assert.match(choisirTarif([mensuel, trimestre], PRODUIT_YASSINE, null), /2 tarifs actifs.*price_TRIM123456.*Demande lequel/)
  assert.match(choisirTarif([{ ...mensuel, actif: false }], PRODUIT_YASSINE, null), /aucun tarif actif/)
  assert.match(choisirTarif([{ ...mensuel, actif: false }], PRODUIT_YASSINE, TARIF_YASSINE), /archivé/)
  assert.match(choisirTarif([comptant], PRODUIT_YASSINE, 'price_COMPT12345'), /n'appartient pas/)
  assert.match(choisirTarif([{ ...mensuel, montant: null }], PRODUIT_YASSINE, null), /montant fixe/)
  // Un lien Live Club : compte melanie et abonnement seulement (la page de bienvenue cherche l'abonnement).
  assert.equal(refusLienLiveClub('melanie', mensuel), null)
  assert.match(refusLienLiveClub('aoknowledge', mensuel), /compte melanie/)
  assert.match(refusLienLiveClub('melanie', comptant), /abonnement/)

  // Le resultat : l'URL seule sur sa ligne (rien apres elle), puis l'etape suivante.
  const url = urlLienAvecEmail('https://buy.stripe.com/abc', 'yassine.t@gmail.com')
  const lignes = phraseLienPaiementCree({ qui: 'Yassine', produitNom: 'Live Club ETM (tarif symbolique)', tarif: '1 € par mois',
    liveClub: true, url, emailPrerempli: true }).split('\n')
  assert.equal(lignes.length, 3)
  assert.match(lignes[0], /Yassine.*Live Club ETM \(tarif symbolique\).*1 € par mois.*un seul paiement.*email prérempli/)
  assert.equal(lignes[1], 'https://buy.stripe.com/abc?prefilled_email=yassine.t%40gmail.com')
  assert.equal(lignes[2], 'Envoie ce lien à Yassine : une fois payé, il est guidé vers le bot, qui le fait entrer tout seul.')
  assert.equal(etapeApresLienPaiement('Paul', false), "Envoie ce lien à Paul : il ne sert qu'à un seul paiement.")

  // Cle d'ecriture sans la permission : la permission exacte a demander a Adil, la cle jamais citee.
  const refus = "The provided key 'rk_live_51AbC***********************XyZ9' does not have the required permissions for this endpoint "
    + "on account 'acct_1AbC'. Having the 'rak_payment_link_write' permission would allow this request to continue."
  assert.ok(estRefusDePermission(refus))
  assert.ok(!estRefusDePermission('No such price: price_123'))
  assert.ok(!masquerCleStripe(refus).includes('rk_live'))
  const message = permissionLienPaiementManquante('melanie', 'STRIPE_AGENT_KEY_MELANIE', masquerCleStripe(refus))
  assert.match(message, /^Rien n'a été créé/)
  assert.match(message, /Adil/)
  assert.match(message, /Payment Links » en écriture/)
  assert.match(message, /rak_payment_link_write/)
  assert.match(message, /STRIPE_AGENT_KEY_MELANIE/)

  // Produit cree par l'agent : ses identifiants, son statut Live Club, jamais « PRODUITS_STRIPE a la main ».
  const cree = phraseProduitCree({ nom: 'Live Club ETM (tarif symbolique)', compte: 'melanie', produitId: PRODUIT_YASSINE,
    priceId: TARIF_YASSINE, tarif: '1 € par mois', inscription: 'faite' })
  assert.ok(cree.includes(PRODUIT_YASSINE) && cree.includes(TARIF_YASSINE))
  assert.match(cree, /ouvre le Live Club/)
  assert.match(cree.split('\n').pop(), /^Étape suivante : demande-moi le lien de paiement/)
  for (const inscription of ['faite', 'deja', 'table_absente', 'echec', null]) {
    assert.ok(!/PRODUITS_STRIPE|push_membres/.test(phraseProduitCree({ nom: 'X', compte: 'melanie', produitId: PRODUIT_YASSINE,
      priceId: TARIF_YASSINE, tarif: '1 € par mois', inscription })), String(inscription))
  }
  assert.match(phraseProduitCree({ nom: 'X', compte: 'melanie', produitId: PRODUIT_YASSINE, priceId: TARIF_YASSINE,
    tarif: '1 € par mois', inscription: 'table_absente' }), /PAS encore le Live Club.*migration/)
})

// ---------------------------------------------------------------------------
// Tarifs reserves (Brice, 13/10) : un prix PERSONNEL, ouvert a une personne.
// ---------------------------------------------------------------------------

const EMAIL_YASSINE = 'zouariyassine01@gmail.com'
const reserve = (champs = {}) => ({
  reserve_id: '0a289e31-0000-4000-8000-000000000001', qui: 'Yassine', email: EMAIL_YASSINE, telegram_id: null,
  produit_id: PRODUIT_YASSINE, price_id: TARIF_YASSINE, montant: 1, devise: 'eur', recurrence: 'month',
  lien_id: 'plink_1AbCdEfGh', lien_url: 'https://buy.stripe.com/abc?prefilled_email=x', paye_le: null, retire_le: null,
  ...champs,
})

test('tarif reserve : parametres de l agent (une carte, email obligatoire, montant ou tarif repris) (Brice 13/10)', () => {
  const ok = lireParamsAbonnementReserve({ qui: ' Yassine ', email: 'ZouariYassine01@Gmail.com', montant: 1, recurrence: 'month' })
  assert.equal(typeof ok, 'object')
  assert.equal(ok.qui, 'Yassine')
  assert.equal(ok.email, EMAIL_YASSINE)
  assert.equal(ok.montant, 1)
  assert.equal(ok.recurrence, 'month')
  assert.equal(ok.price_id, null)
  assert.equal(ok.telegram_id, null)
  assert.equal(ok.inscrire_produit, false)
  // Le compte Telegram, avec ou sans le u.
  assert.equal(lireParamsAbonnementReserve({ qui: 'Y', email: EMAIL_YASSINE, montant: 1, recurrence: 'month', telegram_id: 'u730269740' }).telegram_id, 730269740)
  assert.match(lireParamsAbonnementReserve({ qui: 'Y', email: EMAIL_YASSINE, montant: 1, recurrence: 'month', telegram_id: 'abc' }), /telegram_id invalide/)
  // L'email est obligatoire, jamais invente.
  assert.match(lireParamsAbonnementReserve({ qui: 'Yassine', montant: 1, recurrence: 'month' }), /email.*obligatoire.*Demande-le/)
  assert.match(lireParamsAbonnementReserve({ qui: 'Yassine', email: 'pas-un-email', montant: 1, recurrence: 'month' }), /Email illisible/)
  assert.match(lireParamsAbonnementReserve({ email: EMAIL_YASSINE, montant: 1, recurrence: 'month' }), /QUI/)
  // Sans tarif repris : montant et recurrence obligatoires, payant, au centime.
  assert.match(lireParamsAbonnementReserve({ qui: 'Y', email: EMAIL_YASSINE, recurrence: 'month' }), /montant/)
  assert.match(lireParamsAbonnementReserve({ qui: 'Y', email: EMAIL_YASSINE, montant: 1 }), /récurrence/)
  assert.match(lireParamsAbonnementReserve({ qui: 'Y', email: EMAIL_YASSINE, montant: 0, recurrence: 'month' }), /exemption/)
  assert.match(lireParamsAbonnementReserve({ qui: 'Y', email: EMAIL_YASSINE, montant: 0.3, recurrence: 'month' }), /0,50/)
  assert.match(lireParamsAbonnementReserve({ qui: 'Y', email: EMAIL_YASSINE, montant: 1.005, recurrence: 'month' }), /centime/)
  assert.match(lireParamsAbonnementReserve({ qui: 'Y', email: EMAIL_YASSINE, montant: 1, recurrence: 'week' }), /month.*year/)
  assert.equal(lireParamsAbonnementReserve({ qui: 'Y', email: EMAIL_YASSINE, montant: 29.9, recurrence: 'year' }).montant, 29.9)
  // Avec un tarif repris : montant et recurrence facultatifs (compares au tarif lu).
  const repris = lireParamsAbonnementReserve({ qui: 'Yassine', email: EMAIL_YASSINE, price_id: TARIF_YASSINE })
  assert.equal(repris.price_id, TARIF_YASSINE)
  assert.equal(repris.montant, null)
  assert.match(lireParamsAbonnementReserve({ qui: 'Y', email: EMAIL_YASSINE, price_id: 'prod_123456' }), /price_id invalide/)
  // Les champs du serveur (controle avant la carte) survivent a la revalidation de l'execution.
  const carte = lireParamsAbonnementReserve({ ...repris, montant_centimes: 100, devise: 'EUR', produit_id: PRODUIT_YASSINE,
    produit_nom: 'Live Club ETM (tarif symbolique)', inscrire_produit: true })
  assert.equal(carte.montant_centimes, 100)
  assert.equal(carte.devise, 'eur')
  assert.equal(carte.produit_id, PRODUIT_YASSINE)
  assert.equal(carte.inscrire_produit, true)
  // Le retrait : l'email de la reservation.
  const retrait = lireParamsRetraitReserve({ email: EMAIL_YASSINE.toUpperCase() })
  assert.equal(retrait.email, EMAIL_YASSINE)
  assert.equal(retrait.reserve_id, null)
  assert.equal(retrait.payee, false)
  assert.match(lireParamsRetraitReserve({ qui: 'Yassine' }), /email/)
  assert.equal(lireParamsRetraitReserve({ email: EMAIL_YASSINE, reserve_id: 'pas-un-uuid' }).reserve_id, null)
})

test('tarif reserve : personnel, jamais donne a un autre email ni a un email non verifie (Brice 13/10)', () => {
  const r = reserve()
  // L'email verifie de Yassine : sa reservation.
  assert.equal(reservePourCompte([r], { telegramId: 111111111, emailVerifie: 'ZOUARIYASSINE01@gmail.com' }), r)
  // Un autre eleve (ETM ou pas), un autre email : rien. Le nom du produit ne dit rien de son prix.
  assert.equal(reservePourCompte([r], { telegramId: 111111111, emailVerifie: 'autre.eleve.etm@gmail.com' }), null)
  // Aucun email verifie (compte non rattache qui n'a rien prouve) : rien.
  assert.equal(reservePourCompte([r], { telegramId: 111111111, emailVerifie: null }), null)
  // Son compte Telegram, pose par l'equipe : sa reservation, des Demarrer.
  const avecTg = reserve({ telegram_id: 730269740n })
  assert.equal(reservePourCompte([avecTg], { telegramId: 730269740, emailVerifie: null }), avecTg)
  assert.equal(reservePourCompte([avecTg], { telegramId: 730269741, emailVerifie: null }), null)
  // Payee ou retiree : plus de lien a donner.
  assert.equal(reservePourCompte([reserve({ paye_le: '2026-10-14T10:00:00Z' })], { telegramId: 1, emailVerifie: EMAIL_YASSINE }), null)
  assert.equal(reservePourCompte([reserve({ retire_le: '2026-10-14T10:00:00Z' })], { telegramId: 1, emailVerifie: EMAIL_YASSINE }), null)
  // L'email verifie passe avant le compte Telegram.
  const autre = reserve({ reserve_id: 'autre', email: 'paul@exemple.fr', telegram_id: 1234567 })
  assert.equal(reservePourCompte([autre, r], { telegramId: 1234567, emailVerifie: EMAIL_YASSINE }), r)
  // Le message du bot : son tarif, le bouton Payer, et l'entree une fois paye.
  assert.equal(libelleTarifReserve(r), '1 € par mois')
  assert.equal(libelleTarifReserve({ montant: '29.90', devise: 'eur', recurrence: 'year' }), '29,90 € par an')
  assert.equal(texteTarifReserve('1 € par mois'),
    'Ton abonnement Live Club à 1 € par mois est prêt : appuie sur « Payer ». Une fois payé, tu entres dans le groupe tout seul.')
})

test('tarif reserve : lien reutilise s il marche, recree sinon (apres verification du paiement) (Brice 13/10)', () => {
  const r = reserve()
  const lu = (actif, completees, limite) => lireLienStripe({ id: 'plink_1AbCdEfGh', active: actif,
    restrictions: { completed_sessions: { count: completees, limit: limite } } })
  assert.deepEqual(lu(true, 0, 1), { etat: 'lu', actif: true, completees: 0, limite: 1 })
  assert.deepEqual(lireLienStripe({ id: 'x' }), { etat: 'illisible' })
  assert.equal(decisionLienReserve(r, lu(true, 0, 1)), 'reutiliser')
  // Desactive, ou deja paye une fois alors que paye_le est vide : recreer (l'appelant cherche d'abord le paiement).
  assert.equal(decisionLienReserve(r, lu(false, 0, 1)), 'recreer')
  assert.equal(decisionLienReserve(r, lu(true, 1, 1)), 'recreer')
  assert.equal(decisionLienReserve(r, { etat: 'introuvable' }), 'recreer')
  // Pas relu (cle ou panne) : on donne ce qu'on a.
  assert.equal(decisionLienReserve(r, { etat: 'illisible' }), 'reutiliser')
  assert.equal(decisionLienReserve(r, null), 'reutiliser')
  // Aucun lien enregistre : en creer un.
  assert.equal(decisionLienReserve(reserve({ lien_id: null, lien_url: null }), null), 'recreer')
})

test('tarif reserve : rapprochement apres paiement, par le tarif d abord, l email en second (cas reel Yassine, 13/10)', () => {
  const r = reserve()
  const sub = (id, statut, email, prix) => ({ id, statut, email, prix })
  // L'abonnement de Yassine sur son tarif, a son email : la reservation est payee.
  const sien = sub('sub_YASSINE123', 'active', 'ZouariYassine01@gmail.com', [TARIF_YASSINE])
  assert.equal(abonnementDeLaReserve(r, [sien]), sien)
  // CAS REEL du 13/10 : Yassine a paye SON tarif (lien fait a la main) avec une AUTRE adresse.
  // Le tarif est personnel : un abonnement vivant sur ce tarif paie la reservation.
  const autreAdresse = sub('sub_YASSINE_AUTRE', 'active', 'yassine.autre@outlook.fr', [TARIF_YASSINE])
  assert.equal(abonnementDeLaReserve(r, [autreAdresse]), autreAdresse)
  assert.equal(abonnementDeLaReserve(r, [sub('sub_RETARD1234', 'past_due', 'yassine.autre@outlook.fr', [TARIF_YASSINE])]).id, 'sub_RETARD1234')
  // Le meme email passe d'abord quand deux abonnements vivants sont sur le tarif.
  assert.equal(abonnementDeLaReserve(r, [autreAdresse, sien]), sien)
  // Un abonnement TERMINE sur le tarif ne compte qu'au meme email.
  const fini = sub('sub_FINI123456', 'canceled', EMAIL_YASSINE, [TARIF_YASSINE])
  assert.equal(abonnementDeLaReserve(r, [fini]), fini)
  assert.equal(abonnementDeLaReserve(r, [sub('sub_FINIAUTRE12', 'canceled', 'autre@exemple.fr', [TARIF_YASSINE])]), null)
  // Un vivant passe avant un termine.
  assert.equal(abonnementDeLaReserve(r, [fini, sien]), sien)
  assert.equal(abonnementDeLaReserve(r, [fini, autreAdresse]), autreAdresse)
  // Son email sur un autre tarif (le prix public) : ce n'est pas cette reservation.
  assert.equal(abonnementDeLaReserve(r, [sub('sub_PUBLIC1234', 'active', EMAIL_YASSINE, ['price_PUBLIC123456'])]), null)
  // Premier paiement pas passe : rien, quelle que soit l'adresse.
  assert.equal(abonnementDeLaReserve(r, [sub('sub_INCOMPL123', 'incomplete', EMAIL_YASSINE, [TARIF_YASSINE])]), null)
  assert.equal(abonnementDeLaReserve(r, [sub('sub_ESSAI12345', 'trialing', 'autre@exemple.fr', [TARIF_YASSINE])]), null)
  assert.ok(!abonnementAPaye('incomplete_expired') && !abonnementAPaye('trialing') && !abonnementAPaye(''))
  assert.ok(abonnementAPaye('active') && abonnementAPaye('past_due') && abonnementAPaye('canceled'))
  // Reprendre un tarif deja paye par un abonnement vivant : rien a reserver (Yassine est deja abonne).
  assert.match(refusTarifDejaPaye(TARIF_YASSINE, [autreAdresse]), /déjà payé par un abonnement actif \(sub_YASSINE_AUTRE\).*rien à réserver/)
  assert.equal(refusTarifDejaPaye(TARIF_YASSINE, [fini]), null)
  assert.equal(refusTarifDejaPaye(TARIF_YASSINE, [sub('sub_PUBLIC1234', 'active', EMAIL_YASSINE, ['price_PUBLIC123456'])]), null)
  // Lecture d'un abonnement Stripe (customer expand) et d'une session de la page de bienvenue.
  const lu = lireAbonnementPourReserve({ id: 'sub_YASSINE123', status: 'active', customer: { id: 'cus_X', email: 'ZouariYassine01@gmail.com' },
    items: { data: [{ price: { id: TARIF_YASSINE } }] } })
  assert.deepEqual(lu, { id: 'sub_YASSINE123', statut: 'active', email: EMAIL_YASSINE, prix: [TARIF_YASSINE] })
  assert.equal(lireAbonnementPourReserve({ id: 'pas_un_abonnement' }), null)
  assert.equal(abonnementDeLaReserve(r, [lu]).id, 'sub_YASSINE123')
})

test('tarif reserve : tarif repris personnel, jamais celui d un autre, ni un prix public (Brice 13/10)', () => {
  const mensuel = lireTarifStripe({ id: TARIF_YASSINE, product: PRODUIT_YASSINE, active: true, unit_amount: 100, currency: 'eur',
    recurring: { interval: 'month', interval_count: 1 } })
  const base = { email: EMAIL_YASSINE, tarif: mensuel, reservePour: null, produitDeBase: false, produitActif: true, autresReserves: [] }
  assert.equal(refusTarifRepris(base), null)
  assert.equal(refusTarifRepris({ ...base, reservePour: EMAIL_YASSINE, autresReserves: [{ email: EMAIL_YASSINE }] }), null)
  // Le tarif d'une autre personne : refuse, par la metadonnee comme par une reservation (meme retiree).
  assert.match(refusTarifRepris({ ...base, reservePour: 'autre.eleve@gmail.com' }), /réservé à une autre personne/)
  assert.match(refusTarifRepris({ ...base, autresReserves: [{ email: 'autre.eleve@gmail.com' }] }), /réservé à une autre personne/)
  // Le prix public du Live Club n'est pas un tarif reserve.
  assert.match(refusTarifRepris({ ...base, produitDeBase: true }), /prix public/)
  assert.match(refusTarifRepris({ ...base, tarif: { ...mensuel, actif: false } }), /archivé/)
  assert.match(refusTarifRepris({ ...base, produitActif: false }), /archivé/)
  assert.match(refusTarifRepris({ ...base, tarif: { ...mensuel, nbIntervalles: 3 } }), /par mois ou par an/)
  assert.match(refusTarifRepris({ ...base, tarif: { ...mensuel, recurrence: null } }), /par mois ou par an/)
  // Le montant ou la recurrence demandes doivent etre ceux du tarif repris.
  assert.equal(ecartTarifDemande({ montant: 1, recurrence: 'month' }, mensuel), null)
  assert.equal(ecartTarifDemande({ montant: null, recurrence: null }, mensuel), null)
  assert.match(ecartTarifDemande({ montant: 2, recurrence: null }, mensuel), /coûte 1 €, pas 2 €/)
  assert.match(ecartTarifDemande({ montant: null, recurrence: 'year' }, mensuel), /mensuel/)
  // Un tarif cree pour une personne : son nom en nickname, son email en metadonnee.
  const corps = corpsTarifReserve({ produitId: 'prod_COMMUN1234', montantCentimes: 100, devise: 'eur', recurrence: 'month',
    qui: 'Yassine', email: EMAIL_YASSINE })
  assert.equal(corps.product, 'prod_COMMUN1234')
  assert.equal(corps.unit_amount, '100')
  assert.equal(corps['recurring[interval]'], 'month')
  assert.equal(corps.nickname, 'Yassine (tarif réservé)')
  assert.equal(corps[`metadata[${META_RESERVE_POUR}]`], EMAIL_YASSINE)
  // Le resultat : l'URL seule sur sa ligne, puis l'etape suivante de Brice.
  const lignes = phraseAbonnementReserveCree({ qui: 'Yassine', email: EMAIL_YASSINE, tarif: '1 € par mois',
    url: 'https://buy.stripe.com/abc?prefilled_email=x', bot: 'aok_liveclub_bot', avecTelegram: false, priceRepris: TARIF_YASSINE,
    produitInscrit: true }).split('\n')
  assert.equal(lignes.length, 3)
  assert.match(lignes[0], /Yassine.*1 € par mois.*repris.*un seul paiement.*ouvre maintenant le Live Club/)
  assert.equal(lignes[1], 'https://buy.stripe.com/abc?prefilled_email=x')
  assert.equal(lignes[2], "Envoie ce lien à Yassine, ou dis-lui d'écrire à @aok_liveclub_bot : après vérification de son email, "
    + 'le bot lui donne ce même lien. Il entre dans le groupe une fois payé.')
  assert.match(etapeApresAbonnementReserve('Yassine', 'aok_liveclub_bot', true), /reconnaît son compte Telegram/)
})

console.log(`\n${n} blocs verifies, tout est bon.`)
