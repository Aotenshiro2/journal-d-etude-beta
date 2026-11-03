// Tests de la reconnaissance des revenants par l'ontologie et du resume du
// matin (03/11, Brice) :
// - un revenant par un autre compte Telegram ou une autre adresse est un
//   'retour' (cas de Benoit Richard, 03/11) ; un nom ambigu reste prudent ;
// - le resume : une personne = une ligne dans « Arrivées », nouveau ou retour,
//   le montant REELLEMENT paye ; l'equipe jamais dans « À contacter » ni dans
//   les impayes (cas de Melanie, 03/11).
// Aucune base (une fausse base repond aux requetes marquees /* reco:... */),
// aucun reseau, aucun appel au modele.
// node scripts/verifier-reconnaissance.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const P = await import('../src/lib/liveclub/reconnaissance-pur.ts')
const R = await import('../src/lib/liveclub/resume-pur.ts')
// reconnaissance.ts importe '@/lib/db' : un client Prisma est construit, jamais appele (fausse base passee en parametre).
const S = await import('../src/lib/liveclub/reconnaissance.ts')

let n = 0
const blocs = []
const bloc = (nom, f) => blocs.push([nom, f])
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// Les donnees du 03/11 (lues en base le 03/11, lecture seule), reduites a ce qui sert
// ---------------------------------------------------------------------------
const BENOIT = {
  telegram: 9028774793, fiche: 'f6a1feb5-c86f-412d-995f-5821d9764607', email: 'joker33maya187@gmail.com',
  ancienClient: 'cus_UdUAg1MR7Mn0Bx', nouveauClient: 'cus_VYiwug3g38YJ8S', nouvelAbonnement: 'sub_1UXbUVCbHiN0O0XigWevjGNl',
}
const BASE = {
  rattachements: [{ telegram_id: BENOIT.telegram, membre_id: BENOIT.fiche, client_stripe: BENOIT.nouveauClient, email: BENOIT.email }],
  emails: [{ email: BENOIT.email, membre_id: BENOIT.fiche }, { email: 'loup.claron@gmail.com', membre_id: '95917e7d-9724-4d73-b1a9-58139f706bda' }],
  abonnements: [
    // L'ancien abonnement de Benoit, annule le 16/08/2026. Le nouveau n'est pas encore collecte (export du 03/11, push a 10 h 08).
    { abonnement_id: 'stripe:sub_1TeDClCbHiN0O0XiewAfpB6O', membre_id: BENOIT.fiche, client_stripe: BENOIT.ancienClient, statut: 'canceled', debut: '2026-06-03' },
  ],
  fiches: [
    { membre_id: BENOIT.fiche, nom: 'Benoit Richard', date_entree: '2025-09-16' },
    { membre_id: '11111111-1111-4111-8111-111111111111', nom: 'Brice Delannay', date_entree: '2025-01-01' },
    { membre_id: '22222222-2222-4222-8222-222222222222', nom: 'DELANNAY Brice', date_entree: '2025-02-01' },
  ],
}

/** Une fausse base : elle repond selon le marqueur de la requete et ses parametres. */
function fausseBase(base = BASE, journal = []) {
  return {
    async $queryRaw(chaines, ...valeurs) {
      const texte = chaines.join('?')
      const marque = /\/\* reco:(\w+) \*\//.exec(texte)?.[1]
      journal.push(marque)
      if (marque === 'identifiants') {
        const tid = Number(valeurs[0])
        return base.rattachements.filter(r => r.telegram_id === tid).map(r => ({ membre_id: r.membre_id, client_stripe: r.client_stripe, email: r.email }))
      }
      if (marque === 'fiches') {
        const [emails, clients] = valeurs
        const parEmail = base.emails.filter(e => emails.includes(e.email)).map(e => e.membre_id)
        const parClient = base.abonnements.filter(a => clients.includes(a.client_stripe) && a.membre_id).map(a => a.membre_id)
        return [...new Set([...parEmail, ...parClient])].map(membre_id => ({ membre_id }))
      }
      if (marque === 'traces') {
        const [fiches, clients, exclus, seuil, , , seuilFiche] = valeurs
        const abonnements = base.abonnements.filter(a => (fiches.includes(a.membre_id) || clients.includes(a.client_stripe))
          && !exclus.includes(a.abonnement_id) && !['incomplete', 'incomplete_expired'].includes(a.statut)
          && Date.parse(a.debut) < seuil.getTime()).length
        const vieilles = base.fiches.filter(f => fiches.includes(f.membre_id))
        return [{
          abonnements, paiements: 0, autres_comptes: 0, acces: 0,
          fiche_ancienne: vieilles.length ? vieilles.some(f => Date.parse(f.date_entree) < seuilFiche.getTime()) : null,
        }]
      }
      if (marque === 'noms') return base.fiches.map(f => ({ membre_id: f.membre_id, nom: f.nom }))
      if (marque === 'equipe') return base.equipe ?? []
      throw new Error(`requete inattendue : ${marque}`)
    },
  }
}

const ARRIVEE = new Date('2026-11-03T06:47:07Z')

bloc("(03/11) Benoit Richard : nouveau compte Telegram, ancien abonnement annule = retour (casse sans la correction : l'accueil ne lisait que le compte)", async () => {
  // Ce que le webhook sait a l'entree : le compte Telegram seul.
  const journal = []
  const r = await S.reconnaitrePersonne({ telegramId: BENOIT.telegram, nom: 'Beniboy', quand: ARRIVEE }, fausseBase(BASE, journal))
  assert.deepEqual(r, { verdict: 'retour', indice: 'abonnement' })
  // Les identifiants d'abord, le nom jamais (une fiche est trouvee).
  assert.deepEqual(journal, ['identifiants', 'fiches', 'traces'])
  // Ce que le bot sait a l'admission : la fiche et le nouvel abonnement du droit.
  const a = await S.reconnaitrePersonne({ telegramId: BENOIT.telegram, membreId: BENOIT.fiche, abonnementId: BENOIT.nouvelAbonnement, clientStripe: BENOIT.nouveauClient, quand: ARRIVEE }, fausseBase())
  assert.equal(a.verdict, 'retour')
  // Sans l'ancien abonnement, la fiche entree le 16/09/2025 suffit.
  const sansAbo = { ...BASE, abonnements: [] }
  assert.deepEqual(await S.reconnaitrePersonne({ telegramId: BENOIT.telegram, quand: ARRIVEE }, fausseBase(sansAbo)), { verdict: 'retour', indice: 'fiche_ancienne' })
  // L'abonnement qui le fait entrer n'est jamais une trace du passe.
  const seulNouveau = { ...BASE, abonnements: [{ abonnement_id: `stripe:${BENOIT.nouvelAbonnement}`, membre_id: BENOIT.fiche, client_stripe: BENOIT.nouveauClient, statut: 'active', debut: '2026-11-02' }],
    fiches: [{ membre_id: BENOIT.fiche, nom: 'Benoit Richard', date_entree: '2026-11-02' }] }
  assert.deepEqual(await S.reconnaitrePersonne({ telegramId: BENOIT.telegram, abonnementId: BENOIT.nouvelAbonnement, quand: ARRIVEE }, fausseBase(seulNouveau)), { verdict: 'nouveau', indice: 'fiche_recente' })
})

bloc('rien par un identifiant : le nom complet, sans ambiguite seulement', async () => {
  // Un compte inconnu, une adresse inconnue : le nom de la fiche, accents et ordre des mots ignores.
  assert.deepEqual(await S.reconnaitrePersonne({ telegramId: 1, nom: 'RICHARD Benoît', quand: ARRIVEE }, fausseBase()), { verdict: 'retour', indice: 'nom' })
  // Deux fiches du meme nom : incertain (jamais « bon retour » sur une homonymie).
  assert.deepEqual(await S.reconnaitrePersonne({ telegramId: 1, nom: 'Brice Delannay', quand: ARRIVEE }, fausseBase()), { verdict: 'incertain', indice: 'nom_ambigu' })
  // Un prenom seul, un pseudo : rien a comparer.
  assert.deepEqual(await S.reconnaitrePersonne({ telegramId: 1, nom: 'Beniboy', quand: ARRIVEE }, fausseBase()), { verdict: 'nouveau', indice: 'rien' })
  assert.equal(P.cleNom('Benoît RICHARD'), P.cleNom('richard benoit'))
  assert.equal(P.cleNom('Beniboy'), null)
  assert.equal(P.cleNom('B. Richard'), null)
  assert.equal(P.cleNom(null), null)
})

bloc('verdict pur : un identifiant passe avant le nom, une fiche recente est un nouveau', () => {
  const t = (o = {}) => ({ ...P.AUCUNE_TRACE, ...o })
  assert.deepEqual(P.reconnaitre({ fiches: 1, traces: t({ abonnementsAnciens: 1 }) }), { verdict: 'retour', indice: 'abonnement' })
  assert.deepEqual(P.reconnaitre({ fiches: 1, traces: t({ paiementsAnciens: 2 }) }), { verdict: 'retour', indice: 'paiement' })
  assert.deepEqual(P.reconnaitre({ fiches: 1, traces: t({ autresComptesVus: 1 }) }), { verdict: 'retour', indice: 'autre_compte_telegram' })
  assert.deepEqual(P.reconnaitre({ fiches: 0, traces: t({ accesAnciens: 1 }) }), { verdict: 'retour', indice: 'acces' })
  assert.deepEqual(P.reconnaitre({ fiches: 1, traces: t() }), { verdict: 'nouveau', indice: 'fiche_recente' })
  // Une fiche trouvee par identifiant : le nom n'est pas regarde, meme ambigu.
  assert.deepEqual(P.reconnaitre({ fiches: 1, traces: t(), homonymes: { fiches: 3, traces: t() } }), { verdict: 'nouveau', indice: 'fiche_recente' })
  assert.deepEqual(P.reconnaitre({ fiches: 0, traces: t(), homonymes: { fiches: 1, traces: t() } }), { verdict: 'nouveau', indice: 'rien' })
  assert.equal(P.JOURS_FICHE_ANCIENNE, 30)
  assert.equal(P.JOURS_TRACE_ANCIENNE, 2)
})

bloc("l'equipe par l'ontologie : fiches, comptes et clients (cas de Melanie, 03/11)", async () => {
  const MEL = '3dba91e5-f42a-4253-9285-6ff4f5d91630'
  const base = { ...BASE, equipe: [
    { membre_id: null, telegram_id: 1899133088n, client_stripe: null },
    { membre_id: MEL, telegram_id: null, client_stripe: null },
    { membre_id: null, telegram_id: null, client_stripe: 'cus_UcgbmMjC4VCdN1' },
  ] }
  const e = await S.lireEquipe(fausseBase(base))
  assert.ok(e.fiches.has(MEL) && e.telegrams.has(1899133088) && e.clients.has('cus_UcgbmMjC4VCdN1'))
  assert.ok(R.estDeLEquipe({ membreId: MEL }, e))
  assert.ok(R.estDeLEquipe({ telegramId: 1899133088 }, e))
  assert.ok(R.estDeLEquipe({ clientStripe: 'cus_UcgbmMjC4VCdN1' }, e))
  assert.ok(!R.estDeLEquipe({ membreId: BENOIT.fiche, telegramId: BENOIT.telegram, clientStripe: BENOIT.nouveauClient }, e))
  assert.deepEqual([...S.MOTIFS_EQUIPE], ['fondateur', 'admin', 'equipe'])
  // La requete lit les quatre chemins : fiche de l'exemption, son adresse, les rattachements, le compte AOK d'Agent AOK.
  const source = lire('src/lib/liveclub/reconnaissance.ts')
  const req = source.slice(source.indexOf('/* reco:equipe */'))
  for (const t of ['c.membre_id is not null', 'cockpit_membre_emails e on lower(e.email) = c.email', 'cockpit_liveclub_rattachements r on r.telegram_id = c.telegram_id', 'profile_emails pe on pe.profile_id = c.user_id']) {
    assert.ok(req.includes(t), `lireEquipe : ${t}`)
  }
})

// ---------------------------------------------------------------------------
// Le resume : ce qui est REELLEMENT paye
// ---------------------------------------------------------------------------

/** L'abonnement de Benoit tel que Stripe le rend (export du 03/11), discounts deplies. */
const subBenoit = (coupon) => ({
  id: BENOIT.nouvelAbonnement, discounts: [{ id: 'di_1UXbUBCbHiN0O0XiUt6pp6eB', end: null, source: { type: 'coupon', coupon } }],
  items: { data: [{ price: { unit_amount: 13900, currency: 'eur' }, discounts: [] }] },
  latest_invoice: { status: 'paid', amount_paid: 9900, total: 9900, subtotal: 13900, currency: 'eur' },
})
const MELMOM2 = { id: 'XFNC8pFN', name: 'MELMOM2', amount_off: 4000, duration: 'forever', duration_in_months: null }

bloc('montant reel : facture payee et remise, pas le prix catalogue', () => {
  const cat = { centimes: 13900, devise: 'eur' }
  // Benoit : coupon MELMOM2 (40 € sans fin), coupon deplie ou lu a part.
  const remise = R.remiseDeStripe(subBenoit(MELMOM2))
  assert.deepEqual(remise, { duree: 'forever', mois: null, fin: null })
  assert.deepEqual(R.remiseDeStripe(subBenoit('XFNC8pFN'), new Map([['XFNC8pFN', MELMOM2]])), remise)
  const f = R.factureDeStripe(subBenoit(MELMOM2))
  assert.deepEqual(f, { statut: 'paid', payeCentimes: 9900, totalCentimes: 9900, devise: 'eur' })
  assert.equal(R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: true, remise, facture: f }),
    '99 € par mois (remise sur 139 €, sans limite de durée)')
  // L'exemple de Brice : une remise de 3 mois.
  assert.equal(R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: true, remise: { duree: 'repeating', mois: 3, fin: null }, facture: f }),
    '99 € par mois (remise sur 139 €, pendant 3 mois)')
  assert.equal(R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: true, remise: { duree: 'repeating', mois: null, fin: '2027-02-02T21:00:00Z' }, facture: f }),
    "99 € par mois (remise sur 139 €, jusqu'au 2 février 2027)")
  assert.equal(R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: true, remise: { duree: 'once', mois: null, fin: null }, facture: f }),
    '99 € le premier paiement (remise unique sur 139 €), puis 139 € par mois')
  assert.equal(R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: true, remise: { duree: null, mois: null, fin: null }, facture: f }),
    '99 € par mois (remise sur 139 €, durée de la remise non lue)')
  // Remise posee, identifiants seuls (non deplies) : durée non lue, mais posee.
  assert.deepEqual(R.remiseDeStripe({ discounts: ['di_1'] }), { duree: null, mois: null, fin: null })
  assert.equal(R.remiseDeStripe({ discounts: [], items: { data: [{ discounts: [] }] } }), null)
  // Loup : pas de remise, facture payee au prix.
  assert.equal(R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: false, remise: null, facture: { statut: 'paid', payeCentimes: 13900, totalCentimes: 13900, devise: 'eur' } }), '139 € par mois')
  // Premier paiement different (solde, prorata) : dit.
  assert.equal(R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: false, remise: null, facture: { statut: 'paid', payeCentimes: 6950, totalCentimes: 6950, devise: 'eur' } }), '139 € par mois (premier paiement : 69,50 €)')
  // Pas encore encaisse : engage, dit comme tel.
  assert.equal(R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: true, remise, facture: { statut: 'open', payeCentimes: 0, totalCentimes: 9900, devise: 'eur' } }),
    '99 € par mois (remise sur 139 €, sans limite de durée), premier paiement pas encore encaissé')
  // Facture pas lue : l'ancien libelle.
  assert.equal(R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: true, remise: null, facture: null }), '139 € par mois, avec remise')
})

bloc("(03/11) le resume de ce matin : une ligne par personne, nouveau ou retour, ce qui est paye, et Melanie absente", () => {
  const DEPUIS = '2026-11-02T07:13:42.520Z'
  const JUSQUA = '2026-11-03T07:13:36.520Z'
  const cat = { centimes: 13900, devise: 'eur' }
  const evenements = [
    { rubrique: 'nouveaux', qui: 't1257757953', quand: '2026-11-02T17:40:00Z', detail: R.detailArrivee({
      genre: 'nouveau', entree: { regle: 'abonnement' },
      abonnement: { montant: R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: false, remise: null, facture: { statut: 'paid', payeCentimes: 13900, totalCentimes: 13900, devise: 'eur' } }), tarifReserve: false, statut: 'active' },
    }) },
    { rubrique: 'nouveaux', qui: `t${BENOIT.telegram}`, quand: '2026-11-02T21:26:23Z', detail: R.detailArrivee({
      genre: 'retour', entree: { regle: 'abonnement' },
      abonnement: { montant: R.detailMontantArrivee({ catalogue: cat, periodicite: 'mois', aRemise: true, remise: R.remiseDeStripe(subBenoit(MELMOM2)), facture: R.factureDeStripe(subBenoit(MELMOM2)) }), tarifReserve: false, statut: 'active' },
    }) },
    { rubrique: 'impayes', qui: 't6000000001', quand: '2026-11-03T07:00:00Z', detail: 'abonnement arrêté : paiement en retard depuis plus de 30 jours' },
  ]
  // Melanie : ecartee AVANT la composition (estDeLEquipe sur sa fiche, resume.ts).
  const equipe = { fiches: new Set(['3dba91e5-f42a-4253-9285-6ff4f5d91630']), telegrams: new Set([1899133088]), clients: new Set() }
  const contacter = [{ membreId: '3dba91e5-f42a-4253-9285-6ff4f5d91630', detail: 'paiement en échec, nouvelle tentative le 3 novembre 2026' }]
  for (const c of contacter) if (!R.estDeLEquipe({ membreId: c.membreId }, equipe)) evenements.push({ rubrique: 'contacter', qui: `m${c.membreId}`, quand: JUSQUA, detail: c.detail })
  const personnes = new Map([
    ['t1257757953', { nom: 'Loup Claron', email: 'loup.claron@gmail.com', pseudo: null, telegramId: 1257757953 }],
    [`t${BENOIT.telegram}`, { nom: 'Benoit Richard', email: BENOIT.email, pseudo: 'joker33187', telegramId: BENOIT.telegram }],
    ['t6000000001', { nom: 'Victor faye', email: 'vicfaye062@gmail.com', pseudo: 'Vishitrader', telegramId: 6000000001 }],
  ])
  const texte = R.composerResume(evenements, personnes, { depuis: DEPUIS, jusqua: JUSQUA })
  assert.equal(texte, [
    'Live Club, ce qui a bougé depuis hier',
    '',
    'Arrivées (nouveaux et retours)',
    '- Loup Claron, loup.claron@gmail.com : nouveau ; abonnement 139 € par mois ; entré dans le groupe',
    '- Benoit Richard, joker33maya187@gmail.com, @joker33187 : retour (déjà membre par le passé) ; abonnement 99 € par mois (remise sur 139 €, sans limite de durée) ; entré dans le groupe',
    '',
    'Impayés',
    '- Victor faye, vicfaye062@gmail.com, @Vishitrader : abonnement arrêté : paiement en retard depuis plus de 30 jours',
  ].join('\n'))
  assert.ok(!/Mélanie|Entrées dans le groupe|Nouveaux abonnés|À contacter/.test(texte))
  if (process.env.MONTRER_RESUME === '1') console.log(`\n----- resume du 03/11, nouvelle forme -----\n${texte}\n----- fin -----\n`)
})

bloc("arrivee : un abonne pas encore entre, une entree sans nouvel abonnement, un nom ambigu", () => {
  assert.equal(R.detailArrivee({ genre: 'nouveau', abonnement: { montant: '139 € par mois', tarifReserve: false, statut: 'active' }, entree: null }),
    'nouveau ; abonnement 139 € par mois ; pas encore entré dans le groupe')
  assert.equal(R.detailArrivee({ genre: 'retour', abonnement: null, entree: { regle: 'acces_broker' } }),
    'retour (déjà membre par le passé) ; entré dans le groupe (accès broker)')
  assert.equal(R.detailArrivee({ genre: 'incertain', abonnement: null, entree: { regle: 'abonnement' } }),
    'nouveau ou retour, à vérifier (même nom que plusieurs fiches) ; entré dans le groupe')
  assert.equal(R.detailArrivee({ genre: null, abonnement: { montant: null, tarifReserve: true, statut: 'canceled' }, entree: null }),
    'abonnement (tarif réservé), déjà arrêté')
  // Plus de rubrique « Entrées » : une entree seule tombe dans « Arrivées ».
  assert.ok(!R.RUBRIQUES_RESUME.some(r => r.cle === 'entrees'))
  assert.equal(R.RUBRIQUES_RESUME[0].titre, 'Arrivées (nouveaux et retours)')
})

bloc("le code du resume : arrivees fusionnees, equipe ecartee des impayes et d'« À contacter »", () => {
  const source = lire('src/lib/liveclub/resume.ts')
  assert.match(source, /if \(g\.geste === 'entree_acceptee'\) \{\s+if \(g\.resultat === 'fait'\) entreesLues\.push\(g\)\s+continue/)
  assert.match(source, /if \(ev && ev\.rubrique === 'impayes' && deLEquipe\(/)
  assert.match(source, /if \(estDeLEquipe\(\{ membreId: m\.membreId \}, equipeOnto\)\) continue/)
  assert.match(source, /await ajouterArrivees\(/)
  assert.ok(!/detailNouvelAbonnement\(/.test(source), "l'ancien libelle du nouvel abonnement n'est plus compose")
  // Le montant reel : lecture Stripe a part, l'ancien libelle si elle echoue.
  assert.match(source, /lireAbonnementPourMontant\(a\.id\)/)
  assert.match(source, /if \(a\.aRemise && montant\) montant = `\$\{montant\}, avec remise`/)
})

for (const [nom, f] of blocs) {
  await f()
  n++
  console.log(`ok  ${nom}`)
}
console.log(`\nreconnaissance et resume : ${n} blocs verifies, tout est bon.`)
