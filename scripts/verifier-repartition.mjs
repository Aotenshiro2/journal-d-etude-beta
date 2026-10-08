// Verification locale des fonctions PURES de la repartition Brice / Melanie
// (src/lib/repartition/pur.ts, 08/10/2026). Meme regime que
// verifier-liveclub.mjs : Node 22 supprime les types tout seul, aucune base,
// aucun reseau, aucun lanceur de tests.
// Lancement : node scripts/verifier-repartition.mjs

import assert from 'node:assert/strict'
import {
  euros, centimes, partager, arrondi, pourcent, partBriceDuCote, coteDuCompte, lireCote,
  jourParis, moisParis, jourDuPaiement, moisSuivant, moisPrecedent, bornesMois, libelleMois, libelleJour,
  intervenantsEnVigueur, tauxEnVigueur, commissionDuTaux, libelleTaux, calculerVente, venteDePaiement,
  moisPrevuCommission, glissementCommission, moisDeLaCommission, partsCommission,
  repartitionDuMois, phraseSolde, soldeDesLignes, slugPartenaire,
  TYPES_REPARTITION, estTypeRepartition, lireParamsRepartition, resumeRepartition,
  etapeApresDepot, etapeApresMarquage,
} from '../src/lib/repartition/pur.ts'

let n = 0
const test = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
// Tirets longs, guillemets courbes, points de suspension, espaces insecables :
// aucun texte lu par un humain ne doit en porter.
const HORS_CLAVIER = new RegExp(`[${[0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0xa0, 0x202f].map(c => String.fromCharCode(c)).join('')}]`)

// Le jeu du mois d'octobre 2026, repris par plusieurs blocs.
const MOIS = '2026-10'
const INTERVENANTS = [
  // Adrien : 5 % du Live Club depuis septembre, 10 % depuis le 1er octobre.
  { intervenant: 'Adrien', offreId: 'live-club', pourcentage: 5, aPartirDu: '2026-09-01', poseLe: '2026-09-01T10:00:00Z' },
  { intervenant: 'Adrien', offreId: 'live-club', pourcentage: 10, aPartirDu: '2026-10-01', poseLe: '2026-10-01T10:00:00Z' },
  // Sur un autre produit, il ne compte pas pour le Live Club.
  { intervenant: 'Adrien', offreId: 'masterclass', pourcentage: 40, aPartirDu: '2026-01-01', poseLe: '2026-01-01T10:00:00Z' },
  // Un intervenant arrete (0 %) ne prend plus rien.
  { intervenant: 'Lea', offreId: 'live-club', pourcentage: 8, aPartirDu: '2026-08-01', poseLe: '2026-08-01T10:00:00Z' },
  { intervenant: 'Léa', offreId: 'live-club', pourcentage: 0, aPartirDu: '2026-09-15', poseLe: '2026-09-15T10:00:00Z' },
]
// Une vente cote Mel : 100 € encaisses, 20 € rembourses, 3 € de frais, Adrien a 10 %.
const VENTE_MEL = { id: 'stripe:ch_mel', cote: 'mel', offreId: 'live-club', jour: '2026-10-05', encaisse: 10000, rembourse: 2000, frais: 300 }
// Une vente cote Brice : 500 € encaisses, 10 € de frais, aucun intervenant.
const VENTE_BRICE = { id: 'stripe:ch_brice', cote: 'brice', offreId: 'formation-3000', jour: '2026-10-12', encaisse: 50000, rembourse: 0, frais: 1000 }
// Une depense commune de 60 €, payee par Brice.
const DEPENSE_COMMUNE = { id: 'd1', libelle: 'Canva', montant: 6000, mois: MOIS, payeePar: 'brice', cote: null, offreId: null, partBricePct: null }
const COMMISSIONS = [
  // Depot de septembre, lots pas faits : attendue, elle a glisse en octobre.
  { id: 'c1', partenaire: 'RaiseFx', client: 'Jean', le: '2026-09-20', lotsFaitsLe: null, statut: 'attendue', attendue: 25000, recue: null, recueLe: null, encaissePar: 'mel' },
  // Depot de septembre, recue le 30 octobre : elle compte en OCTOBRE.
  { id: 'c2', partenaire: 'RaiseFx', client: 'Paul', le: '2026-09-02', lotsFaitsLe: '2026-09-25', statut: 'recue', attendue: 25000, recue: 24000, recueLe: '2026-10-30', encaissePar: 'mel' },
  // Recue fin septembre : ne compte pas en octobre.
  { id: 'c3', partenaire: 'RaiseFx', client: 'Ali', le: '2026-08-10', lotsFaitsLe: '2026-08-20', statut: 'recue', attendue: 10000, recue: 10000, recueLe: '2026-09-30', encaissePar: 'mel' },
  // Perdue : nulle part.
  { id: 'c4', partenaire: 'RaiseFx', client: 'Zoe', le: '2026-07-10', lotsFaitsLe: null, statut: 'perdue', attendue: 5000, recue: null, recueLe: null, encaissePar: 'mel' },
]

test('montants en centimes, euros lisibles sans espace insecable', () => {
  assert.equal(centimes(49.9), 4990)
  assert.equal(centimes('49,90'), 4990)
  assert.equal(centimes('1 250.5'), 125050)
  assert.equal(centimes(0.1 + 0.2), 30)
  assert.equal(centimes('abc'), null)
  assert.equal(centimes(null), null)
  assert.equal(euros(125050), '1 250,50 €')
  assert.equal(euros(25000), '250 €')
  assert.equal(euros(-9900), '-99 €')
  assert.equal(euros(5), '0,05 €')
  assert.equal(euros(123456789), '1 234 567,89 €')
  assert.ok(!HORS_CLAVIER.test(euros(123456789)))
  assert.equal(pourcent(12.5), '12,5 %')
  assert.equal(arrondi(-2.5), -3)
  assert.equal(arrondi(2.5), 3)
})

test('partage 70/30 au centime pres, les deux parts font le tout', () => {
  assert.equal(partBriceDuCote('brice'), 70)
  assert.equal(partBriceDuCote('mel'), 30)
  assert.deepEqual(partager(1001, 30), { brice: 300, mel: 701 })
  assert.deepEqual(partager(-6000, 50), { brice: -3000, mel: -3000 })
  assert.deepEqual(partager(5, 50), { brice: 3, mel: 2 })
  for (const m of [1, 7, 99, 12345, -777]) {
    for (const p of [0, 30, 50, 70, 100, 33.33]) {
      const r = partager(m, p)
      assert.equal(r.brice + r.mel, m)
    }
  }
  assert.deepEqual(partsCommission(25000), { brice: 7500, mel: 17500 })
})

test('cotes et comptes Stripe', () => {
  assert.equal(coteDuCompte('melanie'), 'mel')
  assert.equal(coteDuCompte('aoknowledge'), 'brice')
  assert.equal(coteDuCompte(null), null)
  assert.equal(coteDuCompte('paypal'), null)
  assert.equal(lireCote('Mélanie'), 'mel')
  assert.equal(lireCote(' MEL '), 'mel')
  assert.equal(lireCote('Brice'), 'brice')
  assert.equal(lireCote('saro'), null)
})

test('mois de Paris, pas de UTC', () => {
  // 30/09 a 22 h 30 UTC = 1er octobre 0 h 30 a Paris.
  assert.equal(jourParis(new Date('2026-09-30T22:30:00Z')), '2026-10-01')
  assert.equal(moisParis(new Date('2026-09-30T22:30:00Z')), '2026-10')
  // L'hiver : 31/12 a 23 h 30 UTC = 1er janvier a Paris.
  assert.equal(moisParis(new Date('2026-12-31T23:30:00Z')), '2027-01')
  assert.equal(jourDuPaiement({ horodatage: '2026-09-30T22:30:00Z', date_paiement: '2026-09-30' }), '2026-10-01')
  assert.equal(jourDuPaiement({ horodatage: null, date_paiement: '2026-09-30' }), '2026-09-30')
  assert.equal(jourDuPaiement({ date_paiement: new Date('2026-10-02T00:00:00Z') }), '2026-10-02')
  assert.equal(moisSuivant('2026-12'), '2027-01')
  assert.equal(moisPrecedent('2026-01'), '2025-12')
  assert.deepEqual(bornesMois('2028-02'), { debut: '2028-02-01', fin: '2028-02-29' })
  assert.equal(libelleMois('2026-10'), 'octobre 2026')
  assert.equal(libelleJour('2026-10-01'), '1er octobre 2026')
})

test('intervenants dates : le % en vigueur au jour de la vente', () => {
  assert.deepEqual(intervenantsEnVigueur(INTERVENANTS, 'live-club', '2026-10-05'), [{ intervenant: 'Adrien', pourcentage: 10 }])
  // Au 10 septembre : Adrien a 5 %, Lea encore a 8 % (arretee le 15).
  assert.deepEqual(intervenantsEnVigueur(INTERVENANTS, 'live-club', '2026-09-10'),
    [{ intervenant: 'Adrien', pourcentage: 5 }, { intervenant: 'Lea', pourcentage: 8 }])
  // Avant tout intervenant, et sans produit : personne.
  assert.deepEqual(intervenantsEnVigueur(INTERVENANTS, 'live-club', '2026-07-01'), [])
  assert.deepEqual(intervenantsEnVigueur(INTERVENANTS, null, '2026-10-05'), [])
  assert.deepEqual(intervenantsEnVigueur(INTERVENANTS, 'formation-3000', '2026-10-05'), [])
  // Deux lignes le meme jour : la derniere posee l'emporte.
  const corrige = [...INTERVENANTS, { intervenant: 'Adrien', offreId: 'live-club', pourcentage: 12, aPartirDu: '2026-10-01', poseLe: '2026-10-02T09:00:00Z' }]
  assert.deepEqual(intervenantsEnVigueur(corrige, 'live-club', '2026-10-05'), [{ intervenant: 'Adrien', pourcentage: 12 }])
})

test('taux dates des partenaires : un depot fige le taux de sa date', () => {
  const taux = [
    { partenaireId: 'raisefx', aPartirDu: '2026-09-01', tauxPct: 40, montantFixe: null, poseLe: '2026-09-01T00:00:00Z' },
    { partenaireId: 'raisefx', aPartirDu: '2026-10-01', tauxPct: 50, montantFixe: null, poseLe: '2026-10-01T00:00:00Z' },
    { partenaireId: 'raisefx', aPartirDu: '2026-10-01', tauxPct: 100, montantFixe: null, poseLe: '2026-10-03T00:00:00Z' },
    { partenaireId: 'autre', aPartirDu: '2026-01-01', tauxPct: null, montantFixe: 3000, poseLe: '2026-01-01T00:00:00Z' },
  ]
  assert.equal(tauxEnVigueur(taux, 'raisefx', '2026-09-15').tauxPct, 40)
  assert.equal(tauxEnVigueur(taux, 'raisefx', '2026-10-08').tauxPct, 100)
  assert.equal(tauxEnVigueur(taux, 'raisefx', '2026-08-31'), null)
  assert.equal(tauxEnVigueur(taux, 'inconnu', '2026-10-08'), null)
  assert.equal(commissionDuTaux({ tauxPct: 50, montantFixe: null }, 50000), 25000)
  assert.equal(commissionDuTaux({ tauxPct: 100, montantFixe: null }, 50000), 50000)
  assert.equal(commissionDuTaux({ tauxPct: null, montantFixe: 3000 }, null), 3000)
  assert.equal(commissionDuTaux({ tauxPct: 50, montantFixe: null }, null), null)
  assert.equal(libelleTaux({ tauxPct: 50, montantFixe: null }), '50 % du dépôt')
  assert.equal(libelleTaux({ tauxPct: null, montantFixe: 3000 }), '30 € par client')
})

test('une vente cote Mel avec frais, remboursement et intervenant', () => {
  const v = calculerVente(VENTE_MEL, INTERVENANTS)
  // Assiette de l'intervenant : 100 - 20 = 80 €, avant frais. Adrien : 10 % = 8 €.
  assert.deepEqual(v.intervenants, [{ intervenant: 'Adrien', pourcentage: 10, montant: 800 }])
  // Net : 80 - 3 - 8 = 69 €, partage 30 Brice / 70 Mel.
  assert.equal(v.net, 6900)
  const r = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [VENTE_MEL], intervenants: INTERVENANTS,
    commissions: [], depenses: [], reglements: [], nomsOffres: { 'live-club': 'Live Club' },
  })
  assert.equal(r.lignes.length, 1)
  assert.equal(r.lignes[0].libelle, 'Live Club (Stripe de Mel)')
  assert.deepEqual(r.lignes[0].enMain, { brice: 0, mel: 6900 })
  assert.deepEqual(r.lignes[0].parts, { brice: 2070, mel: 4830 })
  assert.equal(r.cotes.mel.encaisse, 10000)
  assert.equal(r.cotes.mel.rembourse, 2000)
  assert.equal(r.cotes.mel.frais, 300)
  assert.equal(r.cotes.mel.intervenants, 800)
  assert.equal(r.cotes.mel.base, 6900)
  assert.deepEqual(r.intervenants, [{ intervenant: 'Adrien', offreId: 'live-club', payePar: 'mel', montant: 800 }])
  // Mel a tout en main, Brice a droit a 30 % : Mel lui doit 20,70 €.
  assert.equal(r.solde, 2070)
  assert.equal(r.phrase, 'Mel doit 20,70 € à Brice')
})

test('une vente cote Brice, sans intervenant', () => {
  const r = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [VENTE_BRICE], intervenants: INTERVENANTS,
    commissions: [], depenses: [], reglements: [],
  })
  // Net 490 €, 70 % Brice, 30 % Mel, tout en main de Brice.
  assert.deepEqual(r.lignes[0].parts, { brice: 34300, mel: 14700 })
  assert.deepEqual(r.enMain, { brice: 49000, mel: 0 })
  assert.equal(r.solde, -14700)
  assert.equal(r.phrase, 'Brice doit 147 € à Mel')
  assert.deepEqual(r.intervenants, [])
})

test('une depense commune payee par Brice', () => {
  const r = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [], intervenants: [],
    commissions: [], depenses: [DEPENSE_COMMUNE], reglements: [],
  })
  assert.deepEqual(r.lignes[0].enMain, { brice: -6000, mel: 0 })
  assert.deepEqual(r.lignes[0].parts, { brice: -3000, mel: -3000 })
  assert.deepEqual(r.communes, { total: 6000, parts: { brice: 3000, mel: 3000 } })
  // Brice a avance 60 €, la moitie est a Mel : elle lui doit 30 €.
  assert.equal(r.solde, 3000)
  assert.equal(r.phrase, 'Mel doit 30 € à Brice')
  // Une repartition donnee (« sauf indication contraire ») : 20 % Brice.
  const r2 = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [], intervenants: [], commissions: [], reglements: [],
    depenses: [{ ...DEPENSE_COMMUNE, partBricePct: 20 }],
  })
  assert.equal(r2.solde, 4800)
  // Une depense rattachee au cote Mel, payee par Brice : deduite du cote Mel avant son 70/30.
  const r3 = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [], intervenants: [], commissions: [], reglements: [],
    depenses: [{ ...DEPENSE_COMMUNE, cote: 'mel', offreId: 'live-club' }],
  })
  assert.deepEqual(r3.lignes[0].parts, { brice: -1800, mel: -4200 })
  assert.equal(r3.cotes.mel.depenses, 6000)
  assert.equal(r3.cotes.mel.base, -6000)
  assert.equal(r3.solde, 4200)
  // Une depense d'un autre mois ne compte pas.
  const r4 = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [], intervenants: [], commissions: [], reglements: [],
    depenses: [{ ...DEPENSE_COMMUNE, mois: '2026-09' }],
  })
  assert.equal(r4.lignes.length, 0)
  assert.equal(r4.phrase, 'Personne ne doit rien à personne')
})

test('une commission non recue glisse au mois suivant, une recue compte dans son mois', () => {
  const attendue = COMMISSIONS[0]
  // Deposee en septembre, lots pas faits : en septembre, prevue fin septembre.
  assert.equal(moisPrevuCommission(attendue, '2026-09'), '2026-09')
  assert.equal(glissementCommission(attendue, '2026-09'), null)
  // En octobre, toujours pas payee : elle glisse en octobre, faute de lots.
  assert.equal(moisPrevuCommission(attendue, '2026-10'), '2026-10')
  assert.equal(glissementCommission(attendue, '2026-10'), 'lots')
  // Puis en novembre, et ainsi de suite.
  assert.equal(moisPrevuCommission(attendue, '2026-11'), '2026-11')
  // Lots faits fin septembre, pas payee en octobre : glissee, faute de paiement.
  const lots = { ...attendue, lotsFaitsLe: '2026-09-28' }
  assert.equal(glissementCommission(lots, '2026-10'), 'paiement')
  // Lots faits en octobre pour un depot de septembre : prevue fin octobre, dans son mois.
  const lotsOctobre = { ...attendue, lotsFaitsLe: '2026-10-03' }
  assert.equal(moisPrevuCommission(lotsOctobre, '2026-10'), '2026-10')
  assert.equal(glissementCommission(lotsOctobre, '2026-10'), null)
  // Recue ou perdue : plus attendue.
  assert.equal(moisPrevuCommission(COMMISSIONS[1], '2026-10'), null)
  assert.equal(moisPrevuCommission(COMMISSIONS[3], '2026-10'), null)
  assert.equal(moisDeLaCommission(COMMISSIONS[1]), '2026-10')
  assert.equal(moisDeLaCommission(attendue), null)

  const r = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [], intervenants: [], depenses: [], reglements: [],
    commissions: COMMISSIONS,
  })
  // Seule la commission recue en octobre compte : 240 €, en main de Mel, 30 % a Brice.
  assert.equal(r.lignes.length, 1)
  assert.equal(r.lignes[0].genre, 'commission')
  assert.deepEqual(r.lignes[0].enMain, { brice: 0, mel: 24000 })
  assert.deepEqual(r.lignes[0].parts, { brice: 7200, mel: 16800 })
  assert.deepEqual(r.commissions, { recues: { nb: 1, montant: 24000 }, attendues: { nb: 1, montant: 25000, glissees: 1 } })
  assert.equal(r.cotes.mel.commissions, 24000)
  assert.equal(r.solde, 7200)
  // En septembre, la commission recue fin septembre compte, celle d'octobre non.
  const s = repartitionDuMois({
    mois: '2026-09', moisCourant: MOIS, ventes: [], intervenants: [], depenses: [], reglements: [],
    commissions: COMMISSIONS,
  })
  assert.equal(s.commissions.recues.montant, 10000)
  // Encaissee par Brice (« sauf indication ») : en main de Brice, memes parts.
  const parBrice = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [], intervenants: [], depenses: [], reglements: [],
    commissions: [{ ...COMMISSIONS[1], encaissePar: 'brice' }],
  })
  assert.deepEqual(parBrice.lignes[0].enMain, { brice: 24000, mel: 0 })
  assert.equal(parBrice.solde, 7200 - 24000)
})

test('le mois complet, puis un reglement qui se deduit du solde', () => {
  const entree = {
    mois: MOIS, moisCourant: MOIS, ventes: [VENTE_MEL, VENTE_BRICE], intervenants: INTERVENANTS,
    commissions: COMMISSIONS, depenses: [DEPENSE_COMMUNE], reglements: [],
  }
  const r = repartitionDuMois(entree)
  // Parts de Brice : 20,70 (Live Club) + 343 (formation) + 72 (commission) - 30 (Canva) = 405,70 €.
  assert.equal(r.parts.brice, 2070 + 34300 + 7200 - 3000)
  // En main de Brice : 490 (formation) - 60 (Canva payee) = 430 €.
  assert.equal(r.enMain.brice, 49000 - 6000)
  // Solde = 405,70 - 430 = -24,30 : Brice doit 24,30 € a Mel.
  assert.equal(r.soldeAvantReglements, -2430)
  assert.equal(r.solde, -2430)
  assert.equal(r.phrase, 'Brice doit 24,30 € à Mel')
  // Le solde de Mel est exactement l'oppose (toutes les lignes se partagent au centime).
  const soldeMel = r.parts.mel - r.enMain.mel
  assert.equal(soldeMel, 2430)
  assert.equal(soldeDesLignes(r.lignes), r.solde)
  assert.equal(r.cotes.brice.base + r.cotes.mel.base - r.communes.total, r.parts.brice + r.parts.mel)

  // Brice regle 20 € a Mel : il reste 4,30 €.
  const avecReglement = repartitionDuMois({
    ...entree,
    reglements: [{ id: 'r1', de: 'brice', a: 'mel', montant: 2000, regleLe: '2026-10-31', mois: MOIS }],
  })
  assert.equal(avecReglement.soldeAvantReglements, -2430)
  assert.deepEqual(avecReglement.reglements, { melVersBrice: 0, briceVersMel: 2000 })
  assert.equal(avecReglement.solde, -430)
  assert.equal(avecReglement.phrase, 'Brice doit 4,30 € à Mel')
  const ligne = avecReglement.lignes.find(l => l.genre === 'reglement')
  assert.deepEqual(ligne.enMain, { brice: -2000, mel: 2000 })
  assert.deepEqual(ligne.parts, { brice: 0, mel: 0 })
  // Tout regle : personne ne doit rien. Un reglement d'un autre mois ne compte pas.
  const solde = repartitionDuMois({
    ...entree,
    reglements: [
      { id: 'r1', de: 'brice', a: 'mel', montant: 2430, regleLe: '2026-11-02', mois: MOIS },
      { id: 'r2', de: 'mel', a: 'brice', montant: 99999, regleLe: '2026-11-02', mois: '2026-09' },
    ],
  })
  assert.equal(solde.solde, 0)
  assert.equal(solde.phrase, 'Personne ne doit rien à personne')
  for (const l of r.lignes) assert.ok(!HORS_CLAVIER.test(`${l.libelle} ${l.detail ?? ''}`), l.libelle)
})

test('ventes collectees : compte, remboursement, frais inconnus, hors Stripe', () => {
  assert.deepEqual(venteDePaiement({
    paiement_id: 'stripe:ch_1', compte: 'melanie', montant: '99.00', frais: '2.94',
    offre_id: 'live-club', date_paiement: '2026-09-30', horodatage: '2026-09-30T22:30:00Z',
  }), { id: 'stripe:ch_1', cote: 'mel', offreId: 'live-club', jour: '2026-10-01', encaisse: 9900, rembourse: 0, frais: 294 })
  // Un paiement negatif est un remboursement.
  const neg = venteDePaiement({ paiement_id: 'x', compte: 'aoknowledge', montant: -20.5, frais: null, offre_id: null, date_paiement: '2026-10-03' })
  assert.equal(neg.rembourse, 2050)
  assert.equal(neg.encaisse, 0)
  assert.equal(neg.frais, null)
  // Hors Stripe (PayPal, virement) : pas de cote, pas compte.
  assert.equal(venteDePaiement({ paiement_id: 'paypal:1', compte: null, montant: 500, frais: null, offre_id: null, date_paiement: '2026-10-03' }), null)
  // Frais inconnus et hors Stripe sont dits a cote du chiffre.
  const r = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [{ ...VENTE_BRICE, frais: null }], intervenants: [],
    commissions: [], depenses: [], reglements: [], horsStripe: { nb: 2, montant: 100000 },
  })
  assert.equal(r.cotes.brice.fraisInconnus, 1)
  assert.equal(r.cotes.brice.netVentes, 50000)
  assert.ok(r.avertissements.some(a => a.startsWith('Frais Stripe non comptés sur 1 vente')))
  assert.ok(r.avertissements.some(a => a.includes('2 paiements hors Stripe') && a.includes('1 000 €')))
  // Une vente d'un autre mois (jour de Paris) n'entre pas.
  const autre = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [{ ...VENTE_MEL, jour: '2026-09-30' }], intervenants: [],
    commissions: [], depenses: [], reglements: [],
  })
  assert.equal(autre.lignes.length, 0)
  // Intervenants au-dela de 100 % : signale.
  const trop = repartitionDuMois({
    mois: MOIS, moisCourant: MOIS, ventes: [VENTE_MEL], commissions: [], depenses: [], reglements: [],
    intervenants: [...INTERVENANTS, { intervenant: 'Max', offreId: 'live-club', pourcentage: 95, aPartirDu: '2026-01-01' }],
  })
  assert.ok(trop.avertissements.some(a => a.includes('dépassent 100 %')))
})

test('phrase du solde', () => {
  assert.equal(phraseSolde(12050), 'Mel doit 120,50 € à Brice')
  assert.equal(phraseSolde(-8000), 'Brice doit 80 € à Mel')
  assert.equal(phraseSolde(0), 'Personne ne doit rien à personne')
})

test('outils de l agent : parametres valides, refus clairs, validation idempotente', () => {
  const ctx = { aujourdhui: '2026-10-08', moisCourant: '2026-10' }
  assert.deepEqual([...TYPES_REPARTITION], ['depot_broker', 'commission_affiliation', 'marquer_commission', 'taux_partenaire', 'intervenant', 'depense', 'reglement'])
  assert.ok(estTypeRepartition('depense'))
  assert.ok(!estTypeRepartition('remboursement'))
  assert.equal(slugPartenaire('Raise FX'), 'raisefx')
  assert.equal(slugPartenaire('RaiseFx'), 'raisefx')
  assert.equal(slugPartenaire('é'), null)

  // Depot : l'email est obligatoire (on le demande, on ne l'invente pas).
  const depot = lireParamsRepartition('depot_broker', { partenaire: 'RaiseFx', email: ' Jean@Exemple.fr ', client: 'Jean', montant: '500' }, ctx)
  assert.deepEqual(depot, { partenaire: 'raisefx', partenaire_nom: 'RaiseFx', email: 'jean@exemple.fr', client: 'Jean', montant: 500, le: '2026-10-08', note: null })
  assert.ok(lireParamsRepartition('depot_broker', { partenaire: 'RaiseFx', montant: 500 }, ctx).includes('demande-la'))
  assert.equal(typeof lireParamsRepartition('depot_broker', { partenaire: 'RaiseFx', email: 'a@b.fr', montant: 0 }, ctx), 'string')
  assert.equal(typeof lireParamsRepartition('depot_broker', { partenaire: 'RaiseFx', email: 'a@b.fr', montant: 500, le: '2026-10-09' }, ctx), 'string')

  // Marquage : recue demande un montant, encaisse_par Mel par defaut.
  const id = '0a1b2c3d-0000-4000-8000-000000000001'
  assert.deepEqual(lireParamsRepartition('marquer_commission', { commission_id: id, etat: 'recue', montant: '240', le: '2026-10-07' }, ctx),
    { commission_id: id, etat: 'recue', montant: 240, le: '2026-10-07', encaisse_par: 'mel', qui: null, note: null })
  assert.ok(lireParamsRepartition('marquer_commission', { commission_id: id, etat: 'recue' }, ctx).includes('Demande le montant'))
  assert.equal(typeof lireParamsRepartition('marquer_commission', { commission_id: 'c1', etat: 'perdue' }, ctx), 'string')
  assert.equal(typeof lireParamsRepartition('marquer_commission', { commission_id: id, etat: 'payee' }, ctx), 'string')

  // Taux : exactement un de taux_pct et montant_fixe.
  assert.deepEqual(lireParamsRepartition('taux_partenaire', { partenaire: 'RaiseFx', nature: 'broker', taux_pct: '50 %' }, ctx),
    { partenaire: 'raisefx', partenaire_nom: 'RaiseFx', nature: 'broker', taux_pct: 50, montant_fixe: null, a_partir_du: '2026-10-08', note: null })
  assert.equal(typeof lireParamsRepartition('taux_partenaire', { partenaire: 'RaiseFx', taux_pct: 50, montant_fixe: 30 }, ctx), 'string')
  assert.equal(typeof lireParamsRepartition('taux_partenaire', { partenaire: 'RaiseFx' }, ctx), 'string')
  // Un taux peut partir d'une date passee (pour un depot deja fait).
  assert.equal(lireParamsRepartition('taux_partenaire', { partenaire: 'RaiseFx', taux_pct: 50, a_partir_du: '2026-09-01' }, ctx).a_partir_du, '2026-09-01')

  // Intervenant : 0 = arret, au-dela de 100 = refus.
  assert.equal(lireParamsRepartition('intervenant', { intervenant: 'Adrien', offre_id: 'live-club', pourcentage: 0 }, ctx).pourcentage, 0)
  assert.equal(typeof lireParamsRepartition('intervenant', { intervenant: 'Adrien', offre_id: 'live-club', pourcentage: 120 }, ctx), 'string')
  assert.equal(typeof lireParamsRepartition('intervenant', { intervenant: 'Adrien', offre_id: 'live club', pourcentage: 10 }, ctx), 'string')

  // Depense : mois en cours par defaut, payeur obligatoire, commune par defaut.
  const dep = lireParamsRepartition('depense', { libelle: 'Canva', montant: 12, payee_par: 'Brice' }, ctx)
  assert.deepEqual(dep, { libelle: 'Canva', montant: 12, mois: '2026-10', payee_par: 'brice', rattachement: 'commune', cote: null, offre_id: null, part_brice_pct: null, note: null })
  assert.ok(lireParamsRepartition('depense', { libelle: 'Canva', montant: 12 }, ctx).includes('demande qui a payé'))
  assert.equal(lireParamsRepartition('depense', { libelle: 'Pub', montant: 50, payee_par: 'mel', rattachement: 'Mélanie' }, ctx).cote, 'mel')
  assert.equal(lireParamsRepartition('depense', { libelle: 'Pub', montant: 50, payee_par: 'mel', rattachement: 'produit', offre_id: 'live-club' }, ctx).cote, null)
  assert.equal(typeof lireParamsRepartition('depense', { libelle: 'Pub', montant: 50, payee_par: 'mel', rattachement: 'produit' }, ctx), 'string')
  assert.equal(typeof lireParamsRepartition('depense', { libelle: 'Pub', montant: 50, payee_par: 'mel', mois: '2026-13' }, ctx), 'string')

  // Reglement : deux personnes differentes, date pas dans le futur.
  assert.deepEqual(lireParamsRepartition('reglement', { de: 'mel', a: 'brice', montant: 500, le: '2026-10-08', mois: '2026-09' }, ctx),
    { de: 'mel', a: 'brice', montant: 500, le: '2026-10-08', mois: '2026-09', note: null })
  assert.equal(typeof lireParamsRepartition('reglement', { de: 'mel', a: 'mel', montant: 500 }, ctx), 'string')
  assert.equal(typeof lireParamsRepartition('reglement', { de: 'mel', a: 'brice', montant: 500, le: '2026-10-20' }, ctx), 'string')

  // La carte memorisee est revalidee a l'execution : relire le resultat ne change rien.
  const exemples = {
    depot_broker: depot,
    commission_affiliation: lireParamsRepartition('commission_affiliation', { partenaire: 'Edgyx', client: 'Paul', montant: 139 }, ctx),
    marquer_commission: lireParamsRepartition('marquer_commission', { commission_id: id, etat: 'lots_faits', qui: 'Jean' }, ctx),
    taux_partenaire: lireParamsRepartition('taux_partenaire', { partenaire: 'Raise FX', montant_fixe: '30' }, ctx),
    intervenant: lireParamsRepartition('intervenant', { intervenant: 'Adrien', offre_id: 'live-club', pourcentage: '10' }, ctx),
    depense: lireParamsRepartition('depense', { libelle: 'Pub', montant: 50, payee_par: 'mel', rattachement: 'produit', offre_id: 'live-club', cote: 'mel' }, ctx),
    reglement: lireParamsRepartition('reglement', { de: 'brice', a: 'mel', montant: 24.3 }, ctx),
  }
  for (const [type, params] of Object.entries(exemples)) {
    assert.equal(typeof params, 'object', type)
    assert.deepEqual(lireParamsRepartition(type, params, ctx), params, `${type} idempotent`)
    const texte = resumeRepartition(type, params)
    assert.ok(texte.length > 20, type)
    assert.ok(!HORS_CLAVIER.test(texte), `${type} : caracteres clavier`)
    assert.ok(!texte.includes('undefined') && !texte.includes('null'), `${type} : ${texte}`)
  }
  assert.ok(resumeRepartition('reglement', exemples.reglement).includes('Brice a versé 24,30 € à Mel'))
  assert.ok(resumeRepartition('taux_partenaire', exemples.taux_partenaire).includes('30 € par client'))
})

test('etape humaine suivante, une ligne', () => {
  const textes = [
    etapeApresDepot({ acces: 'email_parti', qui: 'Jean', partenaire: 'RaiseFx', bot: 'aok_liveclub_bot' }),
    etapeApresDepot({ acces: 'email_pas_parti', qui: 'Jean', partenaire: 'RaiseFx', bot: 'aok_liveclub_bot' }),
    etapeApresDepot({ acces: 'existant', qui: 'Jean', partenaire: 'RaiseFx', bot: 'aok_liveclub_bot' }),
    etapeApresDepot({ acces: 'abonne', qui: 'Jean', partenaire: 'RaiseFx', bot: 'aok_liveclub_bot' }),
    etapeApresMarquage('lots_faits', 'RaiseFx'),
    etapeApresMarquage('recue', 'RaiseFx', '2026-10'),
    etapeApresMarquage('perdue', 'RaiseFx'),
  ]
  assert.ok(textes[1].includes('@aok_liveclub_bot'))
  assert.ok(textes[5].includes('octobre 2026'))
  for (const t of textes) {
    assert.ok(!t.includes('\n'), 'une seule ligne')
    assert.ok(!HORS_CLAVIER.test(t))
  }
})

console.log(`\n${n} blocs verifies, tout est bon.`)
