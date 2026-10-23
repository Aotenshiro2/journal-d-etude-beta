// Verification de l'academie (15/10/2026) : la regle d'acces, le calcul du
// suivi, la lecture des corps de requete (src/lib/academie/pur.ts), et les
// liens signes Bunny par bibliotheque (src/lib/academie/bunny.ts). Node 22
// supprime les types tout seul : les .ts sont importes tels quels, les
// fonctions testees sont celles des routes.
//
// 1. Hors ligne : cas construits (admin, compte gratuit, acheteur, Live Club
//    actif, Live Club arrete avec paquet d'entree, Live Club illisible, ETM,
//    secours de l'essai, acces non transmis faute d'email verifie...), suivi
//    (avance rapide, debit, texte) et les quatre etats d'une lecon (vu a 59 %
//    et 60 % reellement regardes, saut sans visionnage, fin, texte_fin, vu
//    puis non_vu, ouverture sans consommation), signature.
// 2. En ligne (sauf --hors-ligne) : signe les videos du module « essai »
//    (memes guid que la migration 20261015210000) avec la bibliotheque
//    « formation » du coffre et demande le lecteur Bunny avec le Referer du
//    site : signe = 200, sans jeton = 403, expire = 403 ; signe SANS Referer
//    = 403 (domaines autorises). N'affiche JAMAIS la cle, ni le jeton, ni
//    l'URL signee.
//
// L'email non verifie se juge en SQL (SQL_IDENTITE ne rend que les emails
// verifies, SQL_ACCES ne rend que leurs acces) : c'est
// scripts/essayer-migration-academie.mjs qui le verifie contre la base.
//
// Lancement (depuis apps/journal-d-etude) :
//   node scripts/verifier-academie.mjs [--hors-ligne] [chemin du coffre]

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CacheCourt, appareilCourt, appliquerSignal, cheminDansBucket, cheminFichierPropre, conclureLiveClub, etatLecon, ipDuClient,
  leconVue, lireCsvAcces, lireDemandeLecture, lireDemandeRessource, lireOffresSections, lireSignal, lireUuid, liveClubUtile,
  ouvertureLecon, ouvertureModule, ouvertureSection, preparerDroits, progressionDuModule, ressourcesPropres, trierRaisons,
  ECART_MIN_S, MAX_RESSOURCES, SEUIL_VU,
  autoriserEdition, champsModifies, estAdmin, fusionImport, lireCibleEdition, lireDemandeEdition, planEdition, LIMITES_EDITION,
} from '../src/lib/academie/pur.ts'
import { configBibliotheque, configBunny, jetonLecture, lienLecture, signerLecture, DUREE_LIEN_S } from '../src/lib/academie/bunny.ts'

const args = process.argv.slice(2)
const horsLigne = args.includes('--hors-ligne')
const cheminCoffre = args.find(a => !a.startsWith('--'))
  ?? '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/bunny-stream.local.json'

let blocs = 0
function bloc(nom, fn) {
  fn()
  blocs++
  console.log(`ok  ${nom}`)
}

// ---------------------------------------------------------------------------
// Catalogue de test
// ---------------------------------------------------------------------------
// F : la formation en un seul module, S1 (partie 1, ouverte par le Live
//     Club), S2 (partie 2) ; L1 dans S1, L2 et L3 (apercu) dans S2, L4 sans
//     section, d'usage externe_compte.
// N : Novice (offre compte gratuit). E : l'essai (offre Live Club).

const F = 'f0000000-0000-4000-8000-000000000000'
const S1 = 'f1000000-0000-4000-8000-000000000000'
const S2 = 'f2000000-0000-4000-8000-000000000000'
const N = 'a0000000-0000-4000-8000-000000000000'
const E = 'e0000000-0000-4000-8000-000000000000'

const L1 = { id: 'l1', moduleId: F, sectionId: S1, usage: 'interne', apercu: false }
const L2 = { id: 'l2', moduleId: F, sectionId: S2, usage: 'interne', apercu: false }
const L3 = { id: 'l3', moduleId: F, sectionId: S2, usage: 'interne', apercu: true }
const L4 = { id: 'l4', moduleId: F, sectionId: null, usage: 'externe_compte', apercu: false }
const N1 = { id: 'n1', moduleId: N, sectionId: null, usage: 'interne', apercu: false }
const E1 = { id: 'e1', moduleId: E, sectionId: null, usage: 'interne', apercu: false }
const LECONS_F = [L1, L2, L3, L4]

const BASE = [
  { origine: 'base', source: null, slug: 'compte-gratuit', ouvreTout: false, moduleId: N, sectionId: null },
  { origine: 'base', source: null, slug: 'live-club', ouvreTout: false, moduleId: F, sectionId: S1 },
  { origine: 'base', source: null, slug: 'live-club', ouvreTout: false, moduleId: E, sectionId: null },
  { origine: 'base', source: null, slug: 'etm', ouvreTout: true, moduleId: null, sectionId: null },
  { origine: 'essai', source: null, slug: 'essai', ouvreTout: false, moduleId: E, sectionId: null },
]

function droitsDe(o = {}) {
  return preparerDroits({
    admin: false, etm: false, liveClub: 'non', secoursEssai: false,
    ...o,
    lignes: [...BASE, ...(o.lignes ?? [])],
  })
}
const acces = (l, d) => ouvertureLecon(d, l).acces
const juger = (d, moduleId, lecons) => ouvertureModule(d, moduleId, lecons.map(l => ouvertureLecon(d, l)))

// ---------------------------------------------------------------------------
// 1. La regle d'acces
// ---------------------------------------------------------------------------

bloc('admin : tout, raison admin', () => {
  const d = droitsDe({ admin: true })
  for (const l of [L1, L2, L3, L4, N1, E1]) assert.equal(acces(l, d), 'ouvert')
  assert.equal(ouvertureLecon(d, L2).raisons[0], 'admin')
  assert.deepEqual(juger(d, F, LECONS_F), { acces: 'entier', raisons: ['admin'] })
  assert.equal(liveClubUtile({ admin: true, etm: false, secoursEssai: false, lignes: BASE }), false)
})

bloc('ETM : tout, raison etm', () => {
  const d = droitsDe({ etm: true })
  for (const l of [L1, L2, L3, L4, N1, E1]) assert.equal(acces(l, d), 'ouvert')
  assert.deepEqual(ouvertureSection(d, { id: S2, moduleId: F }), { acces: 'ouvert', raisons: ['etm'] })
  assert.equal(liveClubUtile({ admin: false, etm: true, secoursEssai: false, lignes: BASE }), false)
})

bloc('compte gratuit : offre gratuite, usage externe_compte, apercu ; le reste ferme', () => {
  const d = droitsDe()
  assert.deepEqual(ouvertureLecon(d, N1), { acces: 'ouvert', raisons: ['compte'] })
  assert.deepEqual(ouvertureLecon(d, L4), { acces: 'ouvert', raisons: ['compte'] })
  assert.deepEqual(ouvertureLecon(d, L3), { acces: 'ouvert', raisons: ['apercu'] })
  assert.deepEqual(ouvertureLecon(d, L1), { acces: 'ferme', raisons: [] })
  assert.equal(acces(L2, d), 'ferme')
  assert.equal(acces(E1, d), 'ferme')
  assert.deepEqual(juger(d, N, [N1]), { acces: 'entier', raisons: ['compte'] })
  assert.deepEqual(juger(d, F, LECONS_F), { acces: 'partiel', raisons: ['compte', 'apercu'] })
  assert.deepEqual(juger(d, E, [E1]), { acces: 'ferme', raisons: [] })
  assert.equal(ouvertureSection(d, { id: S1, moduleId: F }).acces, 'ferme')
  // externe_libre ouvre aussi a tout compte ; externe_payant, non.
  assert.equal(acces({ ...L1, usage: 'externe_libre' }, d), 'ouvert')
  assert.equal(acces({ ...L1, usage: 'externe_payant' }, d), 'ferme')
})

bloc('acheteur : la formation entiere, raison achat', () => {
  const d = droitsDe({ lignes: [{ origine: 'acces', source: 'paypal', slug: 'formation-complete', ouvreTout: false, moduleId: F, sectionId: null }] })
  for (const l of LECONS_F) assert.equal(acces(l, d), 'ouvert')
  assert.deepEqual(juger(d, F, LECONS_F), { acces: 'entier', raisons: ['achat'] })
  assert.deepEqual(ouvertureLecon(d, L3).raisons, ['achat', 'apercu'])
  assert.equal(acces(E1, d), 'ferme')
  // Un acheteur sans paquet Live Club : Stripe a quand meme un sens (offre Live Club garnie).
  assert.equal(liveClubUtile({ admin: false, etm: false, secoursEssai: false, lignes: BASE }), true)
})

bloc('acces par section : la partie 1 seule (formation en un seul morceau)', () => {
  const d = droitsDe({ lignes: [{ origine: 'acces', source: 'migration_skool', slug: 'partie-1', ouvreTout: false, moduleId: F, sectionId: S1 }] })
  assert.deepEqual(ouvertureLecon(d, L1), { acces: 'ouvert', raisons: ['skool'] })
  assert.equal(acces(L2, d), 'ferme')
  assert.deepEqual(ouvertureSection(d, { id: S1, moduleId: F }), { acces: 'ouvert', raisons: ['skool'] })
  assert.equal(ouvertureSection(d, { id: S2, moduleId: F }).acces, 'ferme')
  // Une section ouverte n'ouvre pas le module entier.
  assert.equal(juger(d, F, LECONS_F).acces, 'partiel')
  // Une section d'un AUTRE module (meme id par erreur) n'ouvre rien ici.
  const autre = droitsDe({ lignes: [{ origine: 'acces', source: 'offert', slug: 'x', ouvreTout: false, moduleId: N, sectionId: S1 }] })
  assert.equal(acces(L1, autre), 'ferme')
})

bloc('Live Club actif : paquet du moment (partie 1, essai), la partie 2 reste fermee', () => {
  const d = droitsDe({ liveClub: 'oui' })
  assert.deepEqual(ouvertureLecon(d, L1), { acces: 'ouvert', raisons: ['liveclub'] })
  assert.equal(acces(L2, d), 'ferme')
  assert.deepEqual(juger(d, E, [E1]), { acces: 'entier', raisons: ['liveclub'] })
  assert.equal(juger(d, F, LECONS_F).acces, 'partiel')
  assert.equal(d.incomplet, false)
})

bloc('Live Club arrete : le paquet d entree (source liveclub) est suspendu, pas supprime', () => {
  const paquet = [{ origine: 'acces', source: 'liveclub', slug: 'live-club-2025', ouvreTout: false, moduleId: F, sectionId: null }]
  const arrete = droitsDe({ liveClub: 'non', lignes: paquet })
  assert.equal(acces(L1, arrete), 'ferme')
  assert.equal(acces(L2, arrete), 'ferme')
  assert.equal(acces(E1, arrete), 'ferme')
  // Il garde ce qui ne depend pas du Live Club (apercu, usage externe).
  assert.equal(acces(L3, arrete), 'ouvert')
  assert.equal(juger(arrete, F, LECONS_F).acces, 'partiel')
  // Il revient : le meme paquet rouvre tout le module.
  const revenu = droitsDe({ liveClub: 'oui', lignes: paquet })
  assert.deepEqual(juger(revenu, F, LECONS_F), { acces: 'entier', raisons: ['liveclub'] })
  assert.equal(liveClubUtile({ admin: false, etm: false, secoursEssai: false, lignes: paquet }), true)
  // Un achat, lui, reste quand le Live Club s'arrete.
  const achatEtPaquet = droitsDe({ liveClub: 'non', lignes: [...paquet, { origine: 'acces', source: 'stripe', slug: 'module-f', ouvreTout: false, moduleId: F, sectionId: null }] })
  assert.deepEqual(ouvertureLecon(achatEtPaquet, L2), { acces: 'ouvert', raisons: ['achat'] })
})

bloc('Live Club illisible : inconnu (jamais un faux refus), droits incomplets', () => {
  const d = droitsDe({ liveClub: 'inconnu' })
  assert.deepEqual(ouvertureLecon(d, L1), { acces: 'inconnu', raisons: ['liveclub'] })
  assert.equal(acces(L2, d), 'ferme') // le Live Club n'ouvre pas la partie 2 : refus sur
  assert.equal(acces(N1, d), 'ouvert')
  assert.equal(juger(d, E, [E1]).acces, 'inconnu')
  assert.equal(d.incomplet, true)
  // Sans contenu Live Club, un Stripe illisible ne rend rien incomplet.
  const sansLiveClub = preparerDroits({ admin: false, etm: false, liveClub: 'inconnu', secoursEssai: false, lignes: [] })
  assert.equal(sansLiveClub.incomplet, false)
})

bloc('secours de l essai (decision B) : le module essai seul', () => {
  const d = droitsDe({ secoursEssai: true })
  assert.deepEqual(ouvertureLecon(d, E1), { acces: 'ouvert', raisons: ['essai'] })
  assert.equal(acces(L1, d), 'ferme')
  assert.equal(acces(L2, d), 'ferme')
  // Le secours ne vaut que pour la ligne 'essai', pas pour une offre « tout ».
  const sansLigneEssai = preparerDroits({ admin: false, etm: false, liveClub: 'non', secoursEssai: true, lignes: [] })
  assert.equal(sansLigneEssai.ouvertures.length, 0)
})

bloc('offre qui ouvre tout (VIP au transvasage) et sources inconnues', () => {
  const vip = droitsDe({ lignes: [{ origine: 'acces', source: 'migration_skool', slug: 'vip', ouvreTout: true, moduleId: null, sectionId: null }] })
  for (const l of [L1, L2, N1, E1]) assert.equal(acces(l, vip), 'ouvert')
  assert.equal(ouvertureLecon(vip, L2).raisons[0], 'skool')
  // Source inconnue : ignoree. Offre sans contenu : n'ouvre rien.
  const bizarre = droitsDe({ lignes: [
    { origine: 'acces', source: 'pirate', slug: 'x', ouvreTout: true, moduleId: null, sectionId: null },
    { origine: 'acces', source: 'offert', slug: 'vide', ouvreTout: false, moduleId: null, sectionId: null },
  ] })
  assert.equal(acces(L2, bizarre), 'ferme')
  // Les lignes 'base' d'une autre offre (etm ouvre_tout) n'ouvrent rien sans le statut.
  assert.equal(acces(L2, droitsDe()), 'ferme')
})

bloc('acces non transmis (email non verifie) : rien de plus qu un compte gratuit', () => {
  // SQL_ACCES ne rend pas l'acces pose sur un email non verifie : la regle
  // recoit donc les seules lignes de base.
  const d = droitsDe({ lignes: [] })
  assert.equal(acces(L1, d), 'ferme')
  assert.equal(acces(L2, d), 'ferme')
  assert.equal(acces(N1, d), 'ouvert')
})

bloc('offre limitee a une section (offres_sections) : Live Club = partie 1, formation complete = tout, pourcentage', () => {
  // Ce que l'importeur pose pour { "live-club": ["partie-1"] } et « offres » : ["formation-complete"].
  const formation = [{ origine: 'acces', source: 'offert', slug: 'formation-complete', ouvreTout: false, moduleId: F, sectionId: null }]
  const lc = droitsDe({ liveClub: 'oui' })
  const fc = droitsDe({ liveClub: 'non', lignes: formation })
  const lcEtFc = droitsDe({ liveClub: 'oui', lignes: formation })
  const etats = { l1: 'vu', l2: 'non_vu', l3: 'non_vu', l4: 'vu' }
  const suivi = (d) => progressionDuModule(LECONS_F.map(l => ({ acces: acces(l, d), etat: etats[l.id] })))
  // Live Club : L1 (partie 1), L3 (apercu), L4 (externe_compte) ouvertes ; L2 (partie 2) fermee, cadenas.
  assert.deepEqual(LECONS_F.map(l => acces(l, lc)), ['ouvert', 'ferme', 'ouvert', 'ouvert'])
  assert.equal(ouvertureSection(lc, { id: S2, moduleId: F }).acces, 'ferme')
  assert.equal(juger(lc, F, LECONS_F).acces, 'partiel')
  // Pourcentage sur les lecons accessibles : 2 vues sur 3 accessibles.
  assert.deepEqual(suivi(lc), { lecons: 4, vues: 2, en_cours: 0, ouvertes: 0, commencees: 2, accessibles: 3, pourcentage: 67 })
  // Formation complete : tout, et le pourcentage se compte sur les 4.
  assert.deepEqual(LECONS_F.map(l => acces(l, fc)), ['ouvert', 'ouvert', 'ouvert', 'ouvert'])
  assert.deepEqual(juger(fc, F, LECONS_F), { acces: 'entier', raisons: ['offert'] })
  assert.equal(suivi(fc).pourcentage, 50)
  // Les deux : la partie 2 ouverte par la formation, la partie 1 par les deux.
  assert.deepEqual(ouvertureLecon(lcEtFc, L1).raisons, ['offert', 'liveclub'])
  assert.deepEqual(ouvertureLecon(lcEtFc, L2).raisons, ['offert'])
  // Rien d'accessible : le pourcentage se compte sur toutes les publiees ; module vide = 0.
  assert.equal(progressionDuModule([{ acces: 'ferme', etat: 'vu' }, { acces: 'ferme', etat: 'non_vu' }]).pourcentage, 50)
  assert.equal(progressionDuModule([]).pourcentage, 0)
  // Etats comptes sur les publiees.
  const p = progressionDuModule([{ acces: 'ouvert', etat: 'en_cours' }, { acces: 'ouvert', etat: 'ouvert' }, { acces: 'inconnu', etat: 'non_vu' }])
  assert.deepEqual(p, { lecons: 3, vues: 0, en_cours: 1, ouvertes: 1, commencees: 2, accessibles: 2, pourcentage: 0 })
})

bloc('offres_sections du fichier de module : paires, doublons, erreurs', () => {
  const cles = new Set(['partie-1', 'partie-2'])
  assert.deepEqual(lireOffresSections(undefined, cles), [])
  assert.deepEqual(lireOffresSections(null, cles), [])
  assert.deepEqual(lireOffresSections({ 'live-club': ['partie-1', 'partie-1'], 'formation-complete': [] }, cles),
    [{ offre: 'live-club', cle: 'partie-1' }])
  assert.deepEqual(lireOffresSections({ 'live-club': ['partie-1'], autre: ['partie-2'] }, cles),
    [{ offre: 'live-club', cle: 'partie-1' }, { offre: 'autre', cle: 'partie-2' }])
  assert.throws(() => lireOffresSections({ 'live-club': ['partie-3'] }, cles), /section inconnue/)
  assert.throws(() => lireOffresSections({ 'live-club': 'partie-1' }, cles), /liste/)
  assert.throws(() => lireOffresSections(['live-club'], cles), /objet/)
  assert.throws(() => lireOffresSections({ 'Live Club': ['partie-1'] }, cles), /mal formee/)
})

bloc('CSV des acces de l alpha : lecture, defauts, doublons, erreurs sans email', () => {
  const csv = [
    '﻿email;offre;source;note',
    ' Eleve.Un@Exemple.fr ; formation-complete ; offert ; alpha du 17/10',
    'eleve2@exemple.fr;formation-complete;;',
    '# commentaire',
    '',
    'eleve.un@exemple.fr;formation-complete;paypal;doublon de la ligne 2',
    'eleve3@exemple.fr;live-club;liveclub;note; avec un point-virgule',
    'pas-un-email;formation-complete;offert;',
    'eleve4@exemple.fr;Formation Complete;offert;',
    'eleve5@exemple.fr;formation-complete;cadeau;',
  ].join('\r\n')
  const r = lireCsvAcces(csv)
  assert.deepEqual(r.lignes, [
    { numero: 2, email: 'eleve.un@exemple.fr', offre: 'formation-complete', source: 'offert', note: 'alpha du 17/10' },
    { numero: 3, email: 'eleve2@exemple.fr', offre: 'formation-complete', source: 'offert', note: null },
    { numero: 7, email: 'eleve3@exemple.fr', offre: 'live-club', source: 'liveclub', note: 'note; avec un point-virgule' },
  ])
  assert.equal(r.doublons, 1)
  assert.deepEqual(r.erreurs, [
    { numero: 8, motif: 'email illisible' },
    { numero: 9, motif: 'offre mal formee' },
    { numero: 10, motif: 'source inconnue (cadeau)' },
  ])
  // Aucun motif ne reprend l'email.
  assert.ok(r.erreurs.every(e => !e.motif.includes('@')))
  assert.deepEqual(lireCsvAcces('').lignes, [])
})

bloc('conclureLiveClub et ordre des raisons', () => {
  assert.equal(conclureLiveClub({ brokerOuManuel: true, stripe: ['inconnu'] }), 'oui')
  assert.equal(conclureLiveClub({ brokerOuManuel: false, stripe: ['non', 'oui'] }), 'oui')
  assert.equal(conclureLiveClub({ brokerOuManuel: false, stripe: ['non', 'inconnu'] }), 'inconnu')
  assert.equal(conclureLiveClub({ brokerOuManuel: false, stripe: ['non'] }), 'non')
  assert.equal(conclureLiveClub({ brokerOuManuel: false, stripe: [] }), 'non')
  assert.deepEqual(trierRaisons(['apercu', 'liveclub', 'admin', 'liveclub']), ['admin', 'liveclub', 'apercu'])
  assert.equal(liveClubUtile({ admin: false, etm: false, secoursEssai: false, lignes: [] }), false)
})

// ---------------------------------------------------------------------------
// 2. Le suivi
// ---------------------------------------------------------------------------

const T0 = new Date('2026-10-15T10:00:00Z')
const plus = (s) => new Date(T0.getTime() + s * 1000)
function etat(o = {}) {
  return {
    type: 'video', dureeS: 1000, positionMaxS: 100, dernierePositionS: 100, secondesVues: 100,
    pourcentage: 10, termineeLe: null, vuLe: null, derniereVueLe: T0, dernierSignalLe: plus(60), nbSignaux: 3,
    maintenant: plus(90), ...o,
  }
}
const signal = (o) => ({ evenement: 'lecture', positionS: null, secondes: null, vu: true, ...o })

bloc('lecture normale : 30 s jouees en 30 s, position et pourcentage', () => {
  const r = appliquerSignal(etat(), signal({ positionS: 130, secondes: 30 }))
  assert.equal(r.credit, 30)
  assert.equal(r.maj.secondesVues, 130)
  assert.equal(r.maj.positionMaxS, 130)
  assert.equal(r.maj.dernierePositionS, 130)
  assert.equal(r.maj.pourcentage, 13)
  assert.equal(r.maj.terminer, false)
  assert.deepEqual(r.maj.journal, { evenement: 'lecture', secondes: 30, positionS: 130 })
})

bloc('avance rapide : un saut ne compte pas comme du visionnage', () => {
  // Sans « secondes », l'avance de la position est bornee par le temps ecoule (30 s x 2 + 5).
  const saut = appliquerSignal(etat(), signal({ positionS: 700 }))
  assert.equal(saut.credit, 65)
  assert.equal(saut.maj.positionMaxS, 700) // la position, elle, est gardee (reprendre)
  // Une page qui ment (600 s declarees en 20 s) est bornee aussi.
  const menteuse = appliquerSignal(etat({ maintenant: plus(80) }), signal({ positionS: 700, secondes: 600 }))
  assert.equal(menteuse.credit, 45)
  // Un retour en arriere ne credite rien et ne baisse pas la position max.
  const arriere = appliquerSignal(etat(), signal({ positionS: 20 }))
  assert.equal(arriere.credit, 0)
  assert.equal(arriere.maj.positionMaxS, 100)
  assert.equal(arriere.maj.dernierePositionS, 20)
  // Position au-dela de la duree : bornee a la duree.
  assert.equal(appliquerSignal(etat(), signal({ positionS: 5000, secondes: 10 })).maj.positionMaxS, 1000)
})

bloc('debit : un signal par lecon toutes les 20 s, 3 s pour fin et vu', () => {
  const trop = appliquerSignal(etat({ maintenant: plus(70) }), signal({ positionS: 110, secondes: 10 }))
  assert.deepEqual(trop, { refus: 'debit', reessayerDansS: 10 })
  assert.equal(ECART_MIN_S.lecture, 20)
  assert.equal(appliquerSignal(etat({ maintenant: plus(62) }), signal({ evenement: 'fin', positionS: 102 })).refus, 'debit')
  assert.ok('maj' in appliquerSignal(etat({ maintenant: plus(64) }), signal({ evenement: 'fin', positionS: 104 })))
  assert.ok('maj' in appliquerSignal(etat({ maintenant: plus(64) }), signal({ evenement: 'vu' })))
  // Premier signal apres le lien : pas d'ecart a respecter, credit borne depuis le lien.
  const premier = appliquerSignal(etat({ dernierSignalLe: null, maintenant: plus(30) }), signal({ positionS: 130, secondes: 30 }))
  assert.equal(premier.credit, 30)
})

bloc('lien trop ancien (24 h) : signal refuse, sauf la marque vu', () => {
  const vieux = etat({ dernierSignalLe: null, maintenant: plus(25 * 3600) })
  assert.deepEqual(appliquerSignal(vieux, signal({ positionS: 130, secondes: 30 })), { refus: 'lien' })
  assert.equal(appliquerSignal(vieux, signal({ evenement: 'vu' })).maj.marque, 'poser')
  // Une longue pause : l'ecart compte au plus 120 s.
  const pause = appliquerSignal(etat({ maintenant: plus(3600) }), signal({ positionS: 700 }))
  assert.equal(pause.credit, 245)
})

bloc('type : texte sur une video, lecture sur un texte = refus', () => {
  assert.deepEqual(appliquerSignal(etat(), signal({ evenement: 'texte', secondes: 30 })), { refus: 'type' })
  assert.deepEqual(appliquerSignal(etat({ type: 'texte' }), signal({ positionS: 10 })), { refus: 'type' })
  assert.deepEqual(appliquerSignal(etat({ type: 'pdf' }), signal({ evenement: 'fin' })), { refus: 'type' })
})

bloc('vu a 60 % de temps reellement regarde : 59 % non, 60 % oui (voie mesure)', () => {
  assert.equal(SEUIL_VU, 0.6)
  const a59 = appliquerSignal(etat({ secondesVues: 560 }), signal({ positionS: 590, secondes: 30 }))
  assert.equal(a59.maj.secondesVues, 590)
  assert.equal(a59.maj.pourcentage, 59)
  assert.equal(a59.maj.vu, null)
  assert.equal(a59.maj.terminer, false)
  assert.equal(etatLecon({ secondesVues: 590, vuLe: null }), 'en_cours')
  const a60 = appliquerSignal(etat({ secondesVues: 570 }), signal({ positionS: 600, secondes: 30 }))
  assert.equal(a60.maj.secondesVues, 600)
  assert.equal(a60.maj.pourcentage, 60)
  assert.equal(a60.maj.vu, 'poser')
  assert.equal(a60.maj.vuPar, 'mesure')
  assert.equal(a60.maj.terminer, true) // preuve terminee_le, au meme seuil
  // Deja vue (par le clic) : la mesure ne repose rien, mais la preuve est notee.
  const dejaVue = appliquerSignal(etat({ secondesVues: 570, vuLe: T0 }), signal({ positionS: 600, secondes: 30 }))
  assert.equal(dejaVue.maj.vu, null)
  assert.equal(dejaVue.maj.terminer, true)
  // Duree inconnue : pas de pourcentage, pas de vu mesure.
  const sansDuree = appliquerSignal(etat({ dureeS: null, pourcentage: null }), signal({ positionS: 130, secondes: 30 }))
  assert.equal(sansDuree.maj.pourcentage, null)
  assert.equal(sansDuree.maj.vu, null)
  assert.equal(sansDuree.maj.terminer, false)
  // Plafond de 100 % quand on revoit.
  assert.equal(appliquerSignal(etat({ secondesVues: 1990, termineeLe: T0, vuLe: T0 }), signal({ secondes: 30 })).maj.pourcentage, 100)
})

bloc('saut au-dela de 60 % sans visionnage : pas vu', () => {
  // La page dit 0 s jouees (saut) : rien n'est credite, la position est gardee.
  const saut = appliquerSignal(etat(), signal({ positionS: 900, secondes: 0 }))
  assert.equal(saut.credit, 0)
  assert.equal(saut.maj.positionMaxS, 900)
  assert.equal(saut.maj.vu, null)
  assert.equal(saut.maj.terminer, false)
  // Sans « secondes », l'avance est bornee (30 s x 2 + 5) : 165 s, loin des 600.
  const sansSecondes = appliquerSignal(etat(), signal({ positionS: 900 }))
  assert.equal(sansSecondes.maj.secondesVues, 165)
  assert.equal(sansSecondes.maj.vu, null)
})

bloc('fin : la video arrivee au bout passe vue (voie fin)', () => {
  const fin = appliquerSignal(etat({ maintenant: plus(65) }), signal({ evenement: 'fin', positionS: 1000 }))
  assert.equal(fin.maj.vu, 'poser')
  assert.equal(fin.maj.vuPar, 'fin')
  assert.equal(fin.credit, 15) // le temps credite reste borne : la preuve ne dit pas « 60 % regardes »
  assert.equal(fin.maj.terminer, false)
  assert.deepEqual(fin.maj.journal, { evenement: 'fin', secondes: 15, positionS: 1000 })
  assert.equal(appliquerSignal(etat({ maintenant: plus(65), vuLe: T0 }), signal({ evenement: 'fin', positionS: 1000 })).maj.vu, null)
})

bloc('texte_fin : un texte lu jusqu en bas passe vu (voie texte_fin), texte et pdf seulement', () => {
  const t = etat({ type: 'texte', dureeS: 300, secondesVues: 0, pourcentage: 0, positionMaxS: 0, dernierePositionS: 0 })
  const r = appliquerSignal(t, signal({ evenement: 'texte_fin', secondes: 20 }))
  assert.equal(r.credit, 20)
  assert.equal(r.maj.vu, 'poser')
  assert.equal(r.maj.vuPar, 'texte_fin')
  assert.equal(r.maj.journal.evenement, 'texte_fin')
  assert.equal(appliquerSignal({ ...t, type: 'pdf' }, signal({ evenement: 'texte_fin' })).maj.vuPar, 'texte_fin')
  assert.deepEqual(appliquerSignal(etat(), signal({ evenement: 'texte_fin' })), { refus: 'type' })
  // Le temps passe sur un texte ne le rend pas vu tout seul, meme au-dela de sa duree.
  const long = appliquerSignal({ ...t, secondesVues: 280 }, signal({ evenement: 'texte', secondes: 30 }))
  assert.equal(long.maj.vu, null)
  assert.equal(ECART_MIN_S.texte_fin, 3)
})

bloc('vu puis non_vu : retour a en_cours ou ouvert, journal garde', () => {
  const pose = appliquerSignal(etat(), signal({ evenement: 'vu', vu: true }))
  assert.equal(pose.credit, 0)
  assert.equal(pose.maj.marque, 'poser')
  assert.equal(pose.maj.vu, 'poser')
  assert.equal(pose.maj.vuPar, 'eleve')
  assert.deepEqual(pose.maj.journal, { evenement: 'vu', secondes: null, positionS: null })
  assert.equal(pose.maj.secondesVues, 100)
  // Deja vue par la mesure : le clic garde la voie d'origine.
  const surMesure = appliquerSignal(etat({ vuLe: T0 }), signal({ evenement: 'vu' }))
  assert.equal(surMesure.maj.vu, null)
  assert.equal(surMesure.maj.marque, 'poser')
  // Decochage : vu et clic retires, rien d'autre ; le journal recoit 'non_vu'.
  const retrait = appliquerSignal(etat({ vuLe: T0, termineeLe: T0, secondesVues: 700 }), signal({ evenement: 'vu', vu: false }))
  assert.equal(retrait.maj.vu, 'retirer')
  assert.equal(retrait.maj.vuPar, null)
  assert.equal(retrait.maj.marque, 'retirer')
  assert.equal(retrait.maj.secondesVues, 700)
  assert.equal(retrait.maj.journal.evenement, 'non_vu')
  assert.equal(etatLecon({ secondesVues: 700, vuLe: null }), 'en_cours')
  assert.equal(etatLecon({ secondesVues: 0, vuLe: null }), 'ouvert')
  // Apres le decochage, continuer a regarder ne recoche pas (le seuil est deja franchi)...
  const ensuite = appliquerSignal(etat({ secondesVues: 700, termineeLe: T0 }), signal({ positionS: 730, secondes: 30 }))
  assert.equal(ensuite.maj.vu, null)
  // ... mais la fin de la video, si.
  assert.equal(appliquerSignal(etat({ secondesVues: 700, termineeLe: T0, maintenant: plus(65) }), signal({ evenement: 'fin', positionS: 1000 })).maj.vu, 'poser')
})

bloc('quatre etats : non_vu, ouvert (ouverture sans consommation), en_cours, vu', () => {
  assert.equal(etatLecon(undefined), 'non_vu')
  assert.equal(etatLecon(null), 'non_vu')
  // La route de lecture cree la ligne (secondes_vues = 0) : ouvert.
  assert.equal(etatLecon({ secondesVues: 0, vuLe: null }), 'ouvert')
  assert.equal(etatLecon({ secondesVues: 1, vuLe: null }), 'en_cours')
  assert.equal(etatLecon({ secondesVues: 0, vuLe: T0 }), 'vu')
  assert.equal(leconVue({ secondesVues: 0, vuLe: T0 }), true)
  assert.equal(leconVue({ secondesVues: 900, vuLe: null }), false)
  assert.equal(leconVue(undefined), false)
  // Une pause sans temps joue laisse la lecon ouverte.
  const pause = appliquerSignal(etat({ secondesVues: 0, dernierePositionS: 0, positionMaxS: 0 }), signal({ evenement: 'pause', positionS: 0, secondes: 0 }))
  assert.equal(pause.maj.secondesVues, 0)
  assert.equal(etatLecon({ secondesVues: pause.maj.secondesVues, vuLe: null }), 'ouvert')
})

bloc('texte : le temps visible, borne au temps ecoule (1x + 5 s)', () => {
  const t = etat({ type: 'texte', dureeS: 300, secondesVues: 0, pourcentage: 0, positionMaxS: 0, dernierePositionS: 0 })
  const r = appliquerSignal(t, signal({ evenement: 'texte', secondes: 30 }))
  assert.equal(r.credit, 30)
  assert.equal(r.maj.pourcentage, 10)
  assert.equal(appliquerSignal(t, signal({ evenement: 'texte', secondes: 500 })).credit, 35)
  assert.equal(r.maj.journal.positionS, null)
})

// ---------------------------------------------------------------------------
// 3. Corps de requete et utilitaires
// ---------------------------------------------------------------------------

bloc('corps de requete : lecon, video, signal', () => {
  const id = 'B03789D3-F998-44EC-8C3C-5D8C5977008C'
  assert.deepEqual(lireDemandeLecture({ video: ` ${id} ` }), { video: id.toLowerCase() })
  assert.deepEqual(lireDemandeLecture({ lecon: id, video: 'x' }), { lecon: id.toLowerCase() })
  assert.equal(lireDemandeLecture({ lecon: '../x' }), null)
  assert.equal(lireDemandeLecture({}), null)
  assert.equal(lireDemandeLecture(null), null)
  assert.equal(lireUuid(42), null)
  assert.deepEqual(lireSignal({ lecon: id, evenement: 'lecture', position_s: 12.7, secondes: 30 }), {
    lecon: id.toLowerCase(), signal: { evenement: 'lecture', positionS: 12, secondes: 30, vu: true },
  })
  assert.equal(lireSignal({ lecon: id, evenement: 'avance' }), null)
  assert.equal(lireSignal({ lecon: id, evenement: 'lecture', position_s: -5 }).signal.positionS, null)
  assert.equal(lireSignal({ lecon: id, evenement: 'lecture', secondes: 'beaucoup' }).signal.secondes, null)
  assert.equal(lireSignal({ lecon: id, evenement: 'lecture', position_s: 1e9 }).signal.positionS, 86400)
  assert.equal(lireSignal({ lecon: id, evenement: 'vu', vu: false }).signal.vu, false)
  // 'non_vu' (decochage) = vu: false ; 'texte_fin' accepte.
  assert.deepEqual(lireSignal({ lecon: id, evenement: 'non_vu' }).signal, { evenement: 'vu', positionS: null, secondes: null, vu: false })
  assert.equal(lireSignal({ lecon: id, evenement: 'texte_fin', secondes: 12 }).signal.evenement, 'texte_fin')
})

bloc('ressources, IP, appareil', () => {
  assert.deepEqual(ressourcesPropres([
    { titre: ' PDF ', url: 'https://exemple.fr/a.pdf' },
    { titre: 'js', url: 'javascript:alert(1)' },
    { titre: 1, url: 'https://x' },
    'texte',
  ]), [{ titre: 'PDF', url: 'https://exemple.fr/a.pdf' }])
  assert.deepEqual(ressourcesPropres({ pas: 'une liste' }), [])
  // Pieces jointes protegees ({ fichier }) et chemins du site (le workbook gratuit, /media/...).
  assert.deepEqual(ressourcesPropres([
    { titre: 'Workbook', url: '/media/academie/ressources/workbook-psychologie-v2.pdf' },
    { titre: 'Support ep 01', fichier: 'formation-complete/ep-01-pourquoi-se-lancer.pdf' },
    { titre: 'Les deux', url: 'https://exemple.fr/a.pdf', fichier: 'formation-complete/b.pdf' },
    { titre: 'Remontee', fichier: '../secret.pdf' },
    { titre: 'Absolu', fichier: '/formation-complete/a.pdf' },
    { titre: 'Mal forme', fichier: 'formation-complete/../a.pdf', url: 'https://exemple.fr/repli.pdf' },
    { titre: 'Autre domaine', url: '//evil.example/a.pdf' },
    { titre: 'Antislash', url: '/\\evil.example/a.pdf' },
    { titre: 'Espace', url: '/media/a b.pdf' },
    { titre: '   ', url: 'https://exemple.fr/sans-titre.pdf' },
  ]), [
    { titre: 'Workbook', url: '/media/academie/ressources/workbook-psychologie-v2.pdf' },
    { titre: 'Support ep 01', fichier: 'formation-complete/ep-01-pourquoi-se-lancer.pdf' },
    { titre: 'Les deux', fichier: 'formation-complete/b.pdf' },
  ])
  assert.equal(ressourcesPropres(Array.from({ length: 80 }, (_, i) => ({ titre: `r${i}`, fichier: `p/r${i}.pdf` }))).length, MAX_RESSOURCES)
  assert.equal(ipDuClient('203.0.113.7, 10.0.0.1', null), '203.0.113.7')
  assert.equal(ipDuClient(null, '2001:db8::1'), '2001:db8::1')
  assert.equal(ipDuClient('pas-une-ip', null), null)
  assert.equal(ipDuClient(null, null), null)
  assert.equal(appareilCourt('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'mobile ios safari')
  assert.equal(appareilCourt('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0'), 'ordinateur windows edge')
  assert.equal(appareilCourt('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36'), 'mobile android chrome')
  assert.equal(appareilCourt(null), null)
})

bloc('pieces jointes protegees : chemin du bucket, demande de la route', () => {
  assert.equal(cheminFichierPropre(' formation-complete/ep-01.pdf '), 'formation-complete/ep-01.pdf')
  for (const mauvais of ['', '/a.pdf', 'a//b.pdf', '../a.pdf', 'a/../b.pdf', 'a/.cache/b.pdf', 'a b.pdf', 'a\\b.pdf', 'x'.repeat(301), 42, null]) {
    assert.equal(cheminFichierPropre(mauvais), null, String(mauvais).slice(0, 20))
  }
  assert.equal(cheminDansBucket('formation-complete', 'Épisode 01 - Pourquoi se lancer ?.PDF'), 'formation-complete/episode-01-pourquoi-se-lancer.pdf')
  assert.equal(cheminDansBucket('/formation-complete/', "L'IPDA & le temps.pdf"), 'formation-complete/l-ipda-le-temps.pdf')
  assert.equal(cheminDansBucket('a/b', 'Ep.01.pdf'), 'a/b/ep-01.pdf')
  assert.equal(cheminDansBucket('formation-complete', '!!!.pdf'), null)
  assert.equal(cheminDansBucket('../x', 'a.pdf'), null)
  assert.equal(cheminDansBucket('', 'a.pdf'), null)
  // Ce que le script envoie, la route l'accepte.
  assert.equal(cheminFichierPropre(cheminDansBucket('formation-complete', 'Ep 07 - Le Plan (v2).pdf')), 'formation-complete/ep-07-le-plan-v2.pdf')
  const id = 'B03789D3-F998-44EC-8C3C-5D8C5977008C'
  assert.deepEqual(lireDemandeRessource({ lecon_id: id, index: 0 }), { lecon: id.toLowerCase(), index: 0 })
  assert.deepEqual(lireDemandeRessource({ lecon: id, index: 3 }), { lecon: id.toLowerCase(), index: 3 })
  for (const mauvais of [{ lecon_id: id }, { lecon_id: id, index: -1 }, { lecon_id: id, index: 1.5 }, { lecon_id: id, index: '0' },
    { lecon_id: id, index: MAX_RESSOURCES }, { lecon_id: 'x', index: 0 }, null]) {
    assert.equal(lireDemandeRessource(mauvais), null)
  }
})

bloc('cache court : duree, plafond', () => {
  let t = 0
  const c = new CacheCourt(2, () => t)
  c.ecrire('a', true, 100)
  assert.equal(c.lire('a'), true)
  t = 100
  assert.equal(c.lire('a'), undefined)
  c.ecrire('a', 1, 50); c.ecrire('b', 2, 50); c.ecrire('c', 3, 50)
  assert.equal(c.taille, 2)
  assert.equal(c.lire('a'), undefined) // la plus ancienne est sortie
  assert.equal(c.lire('c'), 3)
})

// ---------------------------------------------------------------------------
// 4. Signature Bunny (repris de verifier-academie-bunny.mjs) et bibliotheques
// ---------------------------------------------------------------------------

bloc('jeton = SHA256_HEX(cle + video + expiration), forme du lien', () => {
  assert.equal(
    jetonLecture('cle-de-test', 'b03789d3-f998-44ec-8c3c-5d8c5977008c', 1760000000),
    '75079a4b43ca3a3d508dce41add7efed2ff74f84ad86e9f3bd66b5e1445fce7e',
  )
  const config = { libraryId: '123456', cle: 'cle-de-test' }
  const l = lienLecture(config, 'b03789d3-f998-44ec-8c3c-5d8c5977008c', 1760000000)
  assert.equal(
    l.url,
    'https://player.mediadelivery.net/embed/123456/b03789d3-f998-44ec-8c3c-5d8c5977008c'
      + '?token=75079a4b43ca3a3d508dce41add7efed2ff74f84ad86e9f3bd66b5e1445fce7e&expires=1760000000',
  )
  assert.ok(!l.url.includes('cle-de-test'))
  const s = signerLecture('abc', DUREE_LIEN_S, { config, maintenantMs: 1_760_000_000_500 })
  assert.equal(s.expiration, 1760000000 + 4 * 3600)
  assert.equal(signerLecture('abc', DUREE_LIEN_S, { config: null }), null)
})

bloc('bibliotheques : formation = variables de l essai, les autres par leur nom', () => {
  const env = {
    BUNNY_STREAM_LIBRARY_ID: '111', BUNNY_STREAM_TOKEN_KEY: 'k1',
    BUNNY_STREAM_PROMO_LIBRARY_ID: '222', BUNNY_STREAM_PROMO_TOKEN_KEY: 'k2',
    BUNNY_STREAM_REPLAYS_LIBRARY_ID: '333',
  }
  assert.deepEqual(configBibliotheque('formation', env), { libraryId: '111', cle: 'k1' })
  assert.deepEqual(configBibliotheque('formation', env), configBunny(env))
  assert.deepEqual(configBibliotheque(' Promo ', env), { libraryId: '222', cle: 'k2' })
  assert.equal(configBibliotheque('replays', env), null) // cle absente : jamais de lien non signe
  assert.equal(configBibliotheque('inconnue', env), null)
  assert.equal(configBibliotheque('../x', env), null)
  assert.equal(configBibliotheque(null, env), null)
})

// ---------------------------------------------------------------------------
// 5. Edition des textes dans l'app par l'admin (23/10/2026, route
//    /api/academie/edition, importeur). Le SQL (historique ecrit, verrou de
//    version, importeur contre la base) : scripts/essayer-migration-edition-academie.mjs.
// ---------------------------------------------------------------------------

const LECON_ED = 'B03789D3-F998-44EC-8C3C-5D8C5977008C'
const VERSION_ED = '2026-10-23 08:12:45.123456+00'

bloc('edition, droits : seul l admin passe, le refus vient avant la lecture de la demande', () => {
  const bonne = { cible: 'lecon', id: LECON_ED, titre: 'Nouveau titre' }
  for (const role of [null, undefined, '', 'member', 'membre', 'equipe', 'Admin', 'ADMIN', ' admin']) {
    assert.deepEqual(autoriserEdition(role, bonne), { ok: false, status: 403, erreur: 'droit' }, `role ${JSON.stringify(role)}`)
    // Une demande illisible d'un non-admin : 403 aussi (rien n'est dit de ce qui manque).
    assert.deepEqual(autoriserEdition(role, { n: 1 }), { ok: false, status: 403, erreur: 'droit' })
  }
  assert.equal(estAdmin('admin'), true)
  // La meme regle que droitsAcademie (preparerDroits ouvre tout a l'admin).
  assert.equal(preparerDroits({ admin: estAdmin('admin'), etm: false, liveClub: 'non_lu', secoursEssai: false, lignes: [] }).admin, true)
  const ok = autoriserEdition('admin', bonne)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.demande, { cible: 'lecon', id: LECON_ED.toLowerCase(), version: null, champs: { titre: 'Nouveau titre' } })
  assert.deepEqual(autoriserEdition('admin', { cible: 'lecon', id: LECON_ED }), { ok: false, status: 400, erreur: 'vide' })
})

bloc('edition, demande : champs permis, longueurs, normalisation, version', () => {
  const lire = (c) => lireDemandeEdition(c)
  // Lecon : titre sur une ligne, texte sans \r, texte blanc = null.
  const l = lire({ cible: 'lecon', id: LECON_ED, version: VERSION_ED, titre: '  Le  plan\n du jour ', contenu: '# Titre\r\n\r\nTexte **gras**.\r\n' })
  assert.deepEqual(l, { ok: true, demande: {
    cible: 'lecon', id: LECON_ED.toLowerCase(), version: VERSION_ED,
    champs: { titre: 'Le plan du jour', contenu: '# Titre\n\nTexte **gras**.\n' },
  } })
  assert.deepEqual(lire({ cible: 'lecon', id: LECON_ED, contenu: ' \n\t ' }).demande.champs, { contenu: null })
  assert.deepEqual(lire({ cible: 'lecon', id: LECON_ED, contenu: null }).demande.champs, { contenu: null })
  // Module : titre et resume.
  assert.deepEqual(lire({ cible: 'module', id: LECON_ED, resume: 'Un resume.' }).demande.champs, { resume: 'Un resume.' })
  // Refus : cle inconnue ou d'une autre cible (V1 : ni video, ni ressources, ni ordre), cible, id, version.
  for (const [nom, c, erreur] of [
    ['resume sur une lecon', { cible: 'lecon', id: LECON_ED, resume: 'x' }, 'demande'],
    ['contenu sur un module', { cible: 'module', id: LECON_ED, contenu: 'x' }, 'demande'],
    ['video', { cible: 'lecon', id: LECON_ED, titre: 'x', bunny_video_id: 'y' }, 'demande'],
    ['ordre', { cible: 'lecon', id: LECON_ED, titre: 'x', ordre: 3 }, 'demande'],
    ['ressources', { cible: 'lecon', id: LECON_ED, ressources: [] }, 'demande'],
    ['statut', { cible: 'module', id: LECON_ED, statut: 'publie' }, 'demande'],
    ['cible inconnue', { cible: 'section', id: LECON_ED, titre: 'x' }, 'demande'],
    ['id', { cible: 'lecon', id: 'l1', titre: 'x' }, 'demande'],
    ['version libre', { cible: 'lecon', id: LECON_ED, titre: 'x', version: 'now()' }, 'demande'],
    ['version nombre', { cible: 'lecon', id: LECON_ED, titre: 'x', version: 12 }, 'demande'],
    ['tableau', [], 'demande'],
    ['rien', null, 'demande'],
    ['titre vide', { cible: 'lecon', id: LECON_ED, titre: ' \n ' }, 'titre'],
    ['titre nombre', { cible: 'lecon', id: LECON_ED, titre: 3 }, 'titre'],
    ['titre de lecon trop long', { cible: 'lecon', id: LECON_ED, titre: 'a'.repeat(LIMITES_EDITION.lecon.titre + 1) }, 'titre'],
    ['titre de module trop long', { cible: 'module', id: LECON_ED, titre: 'a'.repeat(LIMITES_EDITION.module.titre + 1) }, 'titre'],
    ['contenu trop long', { cible: 'lecon', id: LECON_ED, contenu: 'a'.repeat(LIMITES_EDITION.lecon.contenu + 1) }, 'contenu'],
    ['contenu objet', { cible: 'lecon', id: LECON_ED, contenu: { a: 1 } }, 'contenu'],
    ['resume trop long', { cible: 'module', id: LECON_ED, resume: 'a'.repeat(LIMITES_EDITION.module.resume + 1) }, 'resume'],
    ['sans champ', { cible: 'module', id: LECON_ED, version: VERSION_ED }, 'vide'],
  ]) {
    assert.deepEqual(lire(c), { ok: false, erreur }, nom)
  }
  // Aux limites : ca passe.
  assert.equal(lire({ cible: 'lecon', id: LECON_ED, titre: 'a'.repeat(LIMITES_EDITION.lecon.titre) }).ok, true)
  assert.equal(lire({ cible: 'module', id: LECON_ED, resume: 'a'.repeat(LIMITES_EDITION.module.resume) }).ok, true)
  assert.deepEqual(lireCibleEdition('module', LECON_ED), { cible: 'module', id: LECON_ED.toLowerCase() })
  assert.equal(lireCibleEdition('lecons', LECON_ED), null)
  assert.equal(lireCibleEdition('lecon', null), null)
})

bloc('edition, historique : une ligne par champ qui change, avant et apres', () => {
  const actuel = { textes: { titre: 'Ancien titre', contenu: 'Ancien texte.' }, type: 'texte', statut: 'publie' }
  const p = planEdition(actuel, { champs: { titre: 'Nouveau titre', contenu: 'Ancien texte.' } })
  assert.deepEqual(p, {
    ok: true,
    valeurs: { titre: 'Nouveau titre', contenu: 'Ancien texte.' },
    historique: [{ champ: 'titre', avant: 'Ancien titre', apres: 'Nouveau titre' }],
  })
  // Seul le texte envoye : le titre reste celui de la base.
  const q = planEdition(actuel, { champs: { contenu: 'Texte neuf.' } })
  assert.deepEqual(q.valeurs, { titre: 'Ancien titre', contenu: 'Texte neuf.' })
  assert.deepEqual(q.historique, [{ champ: 'contenu', avant: 'Ancien texte.', apres: 'Texte neuf.' }])
  // Rien ne change : pas d'historique (la route n'ecrit rien).
  assert.deepEqual(planEdition(actuel, { champs: { titre: 'Ancien titre' } }).historique, [])
  // Une lecon ecrite publiee ne se vide pas ; une video, si (son texte sous le lecteur).
  assert.deepEqual(planEdition(actuel, { champs: { contenu: null } }), { ok: false, erreur: 'contenu' })
  const video = planEdition({ textes: { titre: 'V', contenu: 'Consignes.' }, type: 'video', statut: 'publie' }, { champs: { contenu: null } })
  assert.deepEqual(video.historique, [{ champ: 'contenu', avant: 'Consignes.', apres: null }])
  // Module : le resume vide passe a null, l'ancien est garde.
  const m = planEdition({ textes: { titre: 'Module', resume: 'Resume.' } }, { champs: { resume: null, titre: 'Module 2' } })
  assert.deepEqual(m.historique, [
    { champ: 'titre', avant: 'Module', apres: 'Module 2' }, { champ: 'resume', avant: 'Resume.', apres: null },
  ])
  // Un champ d'une autre cible n'entre pas dans les valeurs.
  assert.deepEqual(planEdition({ textes: { titre: 'M', resume: null } }, { champs: { contenu: 'x' } }).valeurs, { titre: 'M', resume: null })
  assert.deepEqual(champsModifies({ resume: null }, { resume: undefined }), [])
})

bloc('importeur : une edition de l app est gardee, --ecraser-editions la remplace et la note', () => {
  const fichier = { titre: 'Titre du fichier', contenu: 'Texte du fichier.' }
  const base = { titre: 'Titre corrige dans l app', contenu: 'Texte corrige.' }
  // Lecon nouvelle, ou jamais modifiee dans l'app : le fichier fait foi, sans historique.
  assert.deepEqual(fusionImport(null, fichier, false), { valeurs: fichier, garde: false, effacerEdition: false, historique: [] })
  assert.deepEqual(fusionImport({ edite: false, textes: base }, fichier, false),
    { valeurs: fichier, garde: false, effacerEdition: false, historique: [] })
  // Modifiee dans l'app : la base est gardee (bilan « garde : modifie dans l'app »).
  assert.deepEqual(fusionImport({ edite: true, textes: base }, fichier, false),
    { valeurs: base, garde: true, effacerEdition: false, historique: [] })
  // Forcee : le fichier l'emporte, edite_le repasse a vide, l'ancienne version va a l'historique.
  assert.deepEqual(fusionImport({ edite: true, textes: base }, fichier, true), {
    valeurs: fichier, garde: false, effacerEdition: true,
    historique: [
      { champ: 'titre', avant: base.titre, apres: fichier.titre }, { champ: 'contenu', avant: base.contenu, apres: fichier.contenu },
    ],
  })
  // Forcee sans edition : rien a effacer.
  assert.equal(fusionImport({ edite: false, textes: base }, fichier, true).effacerEdition, false)
})

console.log(`${blocs} blocs hors ligne passes.`)
if (horsLigne) process.exit(0)

// ---------- En ligne, contre le lecteur Bunny ----------

const coffre = JSON.parse(readFileSync(cheminCoffre, 'utf8'))
const config = configBibliotheque('formation', {
  BUNNY_STREAM_LIBRARY_ID: String(coffre.library_id ?? ''),
  BUNNY_STREAM_TOKEN_KEY: String(coffre.token_auth_key ?? ''),
})
assert.ok(config, 'library_id ou token_auth_key absent du coffre')

// Les guid du module « essai » (migration 20261015210000).
const VIDEOS_MODULE_ESSAI = ['b03789d3-f998-44ec-8c3c-5d8c5977008c', 'c4413ef9-44d5-4df6-8387-b633e7882769']

// Depuis le 15/10, la bibliotheque n'accepte que les domaines autorises
// (aoknowledge.com, *.aoknowledge.com) : le lecteur est demande comme l'iframe
// de la page le fait, avec le Referer du site. Sans Referer, un lien pourtant
// bien signe est refuse (403) : c'est la protection par domaine.
const REFERER_SITE = 'https://aoknowledge.com/'

async function statut(url, referer = REFERER_SITE) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: referer ? { Referer: referer } : {},
  })
  await res.arrayBuffer().catch(() => null)
  return res.status
}

let echecs = 0
function attendu(nom, obtenu, voulu) {
  const ok = obtenu === voulu
  if (!ok) echecs++
  console.log(`${ok ? 'ok ' : 'KO '} ${nom} : HTTP ${obtenu} (attendu ${voulu})`)
}

for (const id of VIDEOS_MODULE_ESSAI) {
  const signe = signerLecture(id, DUREE_LIEN_S, { config })
  attendu(`${id} lien signe 4 h, depuis aoknowledge.com`, await statut(signe.url), 200)
  attendu(`${id} sans jeton, depuis aoknowledge.com`, await statut(`https://player.mediadelivery.net/embed/${config.libraryId}/${id}`), 403)
  const expire = signerLecture(id, 60, { config, maintenantMs: Date.now() - 3600 * 1000 })
  attendu(`${id} jeton expire, depuis aoknowledge.com`, await statut(expire.url), 403)
  attendu(`${id} lien signe, sans Referer (domaine non autorise)`, await statut(signe.url, null), 403)
}

if (echecs) {
  console.log(`${echecs} verification(s) en ligne en echec.`)
  process.exit(1)
}
console.log('Toutes les verifications en ligne passent.')
