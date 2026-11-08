// Verifie, hors base, la lecture de l'export Skool par importer-paiements-skool.mjs
// (C10, 08/11/2026) : CSV avec guillemets et retours a la ligne, factures de
// l'abonnement de Brice ecartees, statuts, email repris de membres.csv.
// Lancement : node scripts/verifier-paiements-skool.mjs

import assert from 'node:assert/strict'

const I = await import('./importer-paiements-skool.mjs')

let n = 0
const test = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

test('csv : BOM, guillemets, virgule et retour a la ligne dans un champ, lignes vides', () => {
  const l = I.lireCsv('﻿a,b,c\r\n1,"deux, et ""trois""","sur\ndeux lignes"\n\n4,5,6\n')
  assert.equal(l.length, 2)
  assert.deepEqual(l[0], { a: '1', b: 'deux, et "trois"', c: 'sur\ndeux lignes' })
  assert.deepEqual(l[1], { a: '4', b: '5', c: '6' })
})

const base = {
  date: '2026-03-06 18:01:14', montant: '160.0', devise: 'usd', statut: 'paid', rembourse: 'False', produit: '',
  email: 'Membre@Exemple.fr', facture: 'KF9G2FLK-0001', invoice_id: 'in_1T8abcdef', member_id: 'm1',
}

test('facture : payee, montant, devise, date UTC, identifiant skool:<invoice>, email en minuscules', () => {
  const f = I.factureSkool(base, new Map())
  assert.deepEqual(f, {
    paiement_id: 'skool:in_1T8abcdef', date_paiement: '2026-03-06T18:01:14Z', montant: 160, devise: 'USD',
    produit: '10% Club sur Skool', statut: 'paye', facture: 'KF9G2FLK-0001', email: 'membre@exemple.fr',
  })
})

test('facture : abonnement Skool de Brice (hosting) ecarte', () => {
  assert.equal(I.factureSkool({ ...base, produit: 'hosting' }, new Map()), null)
})

test('facture : impayee, remboursee, cours', () => {
  assert.equal(I.factureSkool({ ...base, statut: 'uncollectible' }, new Map()).statut, 'impaye')
  assert.equal(I.factureSkool({ ...base, rembourse: 'True' }, new Map()).statut, 'rembourse')
  assert.equal(I.factureSkool({ ...base, statut: 'inconnu' }, new Map()).statut, 'impaye')
  assert.equal(I.factureSkool({ ...base, produit: 'course' }, new Map()).produit, 'Cours sur Skool')
})

test('facture : email repris de membres.csv par member_id, sinon null', () => {
  assert.equal(I.factureSkool({ ...base, email: '' }, new Map([['m1', 'Autre@Exemple.fr']])).email, 'autre@exemple.fr')
  assert.equal(I.factureSkool({ ...base, email: '' }, new Map()).email, null)
})

test('facture : lignes illisibles ecartees', () => {
  for (const casse of [{ invoice_id: '' }, { invoice_id: 'in 1' }, { date: '06/03/2026' }, { montant: 'abc' }, { montant: '-1' }, { devise: 'dollars' }]) {
    assert.equal(I.factureSkool({ ...base, ...casse }, new Map()), null, JSON.stringify(casse))
  }
})

console.log(`\n${n} blocs ok`)
