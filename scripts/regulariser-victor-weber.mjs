// VICTOR WEBER : son exemption « favorise » devient un VRAI acces broker de 4
// mois (GO de Brice du 29/10/2026, transmis par la session principale).
//
// Le 28/10 a 22:03, Melanie a demande a Agent AOK « vivivi54218@gmail.com au
// Live Club pour 4 mois, il a depose 400 EUR sur RaiseFx, on prend 400 EUR de
// commission » ; le bot ne lui a jamais repondu (tour tue a 120 s). A 22:19,
// Brice a fait poser une exemption « favorise » jusqu'au 28/02/2027
// (exemption 2a1da732), faute de duree libre. Ce script, PAR LE MEME CHEMIN
// QUE LES CARTES DU BOT (validerAction puis executerAction, stripe-actions.ts) :
//   1. enregistre RaiseFx comme broker, SANS taux general (Brice : pas encore
//      de regle pour les futurs clients, « a demander au prochain client ») ;
//   2. inscrit le depot de 400 EUR du 28/10 (date SUPPOSEE par Brice, a
//      confirmer par Mel) avec SA commission de 400 EUR, et pose l'acces
//      broker de 4 mois (email d'invitation vers le bot compris) ;
//   3. verifie que le droit tient SANS l'exemption (droitLiveClub, exemption
//      ignoree), en reliant au besoin l'acces a son compte Telegram ;
//   4. ferme l'exemption (comme le bouton du cockpit : retire_le, retire_par).
// Chaque etape deja faite est sautee (relancer le script ne refait rien).
//
// A LANCER APRES le deploiement de la duree libre (journal du 29/10), avec les
// variables de prod (base, Resend, lecture Stripe du compte melanie), par
// exemple : vercel env pull .env.prod.local (fichier hors git, a effacer apres).
//   node --env-file=.env.prod.local scripts/regulariser-victor-weber.mjs           (lecture seule)
//   node --env-file=.env.prod.local scripts/regulariser-victor-weber.mjs --ecrire  (ecrit)
// Fin de l'acces : jour du lancement + 4 mois (lance du 28 au 31/10 : le
// 28/02/2027, comme l'exemption ; plus tard : quelques jours de plus).

import './resoudre-ts.mjs'

const ECRIRE = process.argv.includes('--ecrire')
const BRICE = '0636a40b-13a4-4fe8-af11-d060e2810767'
const ACTEUR = `cockpit:${BRICE}`
const EMAIL = 'vivivi54218@gmail.com'
const TELEGRAM = 1130067577
const EXEMPTION = '2a1da732-88c9-4580-877c-91bf71f70689'
const DEPOT = { partenaire: 'RaiseFx', email: EMAIL, client: 'Victor Weber', montant: 400, le: '2026-10-28', mois: 4, commission: 400,
  note: 'Date du dépôt supposée (28/10, Brice), à confirmer par Mel. Demande de Mel du 28/10 22:03 ; remplace l\'exemption favorisé du 28/10.' }
const PARTENAIRE = { partenaire: 'RaiseFx', nature: 'broker', a_partir_du: '2026-10-28',
  note: 'Si les accès d\'avant étaient RaiseFx (et non Pulse) : 650 EUR fixes par dépôt dès 1000 EUR (Brice, 29/10) ; palier minimum abaissé depuis. Accord à confirmer par Mel.' }

const { prisma } = await import('../src/lib/db.ts')
const { validerAction, executerAction, resumeAction } = await import('../src/lib/stripe-actions.ts')
const { prerequisAccesBroker } = await import('../src/lib/liveclub/acces.ts')

const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x))
const etat = async () => prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('set transaction read only')
  const q = (sql, ...p) => tx.$queryRawUnsafe(sql, ...p)
  return {
    exemption: (await q(`select exemption_id::text, motif, jusquau::text, retire_le from public.cockpit_liveclub_exemptions where exemption_id = $1::uuid`, EXEMPTION))[0] ?? null,
    acces: (await q(`select acces_id::text, source, debut::text, jusquau::text, telegram_id, invite_envoyee_le, retire_le, sorti_le from public.cockpit_liveclub_acces where lower(email) = $1 and motif = 'broker'`, EMAIL))[0] ?? null,
    partenaire: (await q(`select partenaire_id, nom, nature, note from public.cockpit_partenaires where partenaire_id = 'raisefx'`))[0] ?? null,
    taux: await q(`select a_partir_du::text, taux_pct, montant_fixe from public.cockpit_partenaire_taux where partenaire_id = 'raisefx'`),
    commissions: await q(`select c.commission_id::text, c.le::text, c.montant_base, c.montant_fixe, c.commission_attendue, c.statut from public.cockpit_commissions c left join public.cockpit_liveclub_acces a on a.acces_id = c.acces_id where lower(coalesce(c.email, a.email)) = $1`, EMAIL),
    rattachement: (await q(`select lower(email) as email from public.cockpit_liveclub_rattachements where telegram_id = $1 and retire_le is null`, TELEGRAM))[0] ?? null,
    fin: (await q(`select (current_date + make_interval(months => 4))::date::text as fin`))[0].fin,
  }
})

function carte(type, params) {
  const a = validerAction({ type, compte: 'cockpit', params })
  if (typeof a === 'string') throw new Error(`${type} refuse a la validation : ${a}`)
  return a
}

const avant = await etat()
console.log(`Mode : ${ECRIRE ? 'ECRITURE' : 'lecture seule'}`)
console.log(`Exemption ${EXEMPTION.slice(0, 8)} : ${json(avant.exemption)}`)
console.log(`Acces broker de ${EMAIL} : ${json(avant.acces)}`)
console.log(`RaiseFx en base : ${json(avant.partenaire)} ; taux : ${json(avant.taux)}`)
console.log(`Commissions de ${EMAIL} : ${json(avant.commissions)}`)
console.log(`Compte Telegram u${TELEGRAM} rattache a : ${json(avant.rattachement)}`)
console.log(`Un acces pose aujourd'hui finirait le ${avant.fin}`)
const manque = prerequisAccesBroker()
console.log(`Prerequis de l'acces (Resend, lecture Stripe) : ${manque ?? 'presents'}`)

const cartePartenaire = carte('taux_partenaire', PARTENAIRE)
const carteDepot = carte('depot_broker', DEPOT)
console.log(`\nCarte 1 : ${resumeAction(cartePartenaire)}`)
console.log(`Carte 2 : ${resumeAction(carteDepot)}`)
console.log('Puis : droit verifie sans l\'exemption, et exemption fermee.')

if (!ECRIRE) {
  console.log('\nLecture seule : rien n\'a ete ecrit. Relancer avec --ecrire pour appliquer.')
  await prisma.$disconnect()
  process.exit(0)
}

if (manque) {
  console.error(`\nArret : ${manque}`)
  await prisma.$disconnect()
  process.exit(1)
}
if (!avant.exemption || avant.exemption.retire_le) {
  console.log("\nL'exemption est deja fermee : seules les etapes manquantes sont faites.")
}

// 1. Le broker.
if (avant.partenaire) {
  if (avant.partenaire.nature !== 'broker') throw new Error(`raisefx existe mais n'est pas un broker (${avant.partenaire.nature}) : arret.`)
  console.log('\n1. RaiseFx deja enregistre : saute.')
} else {
  console.log(`\n1. ${await executerAction(cartePartenaire, ACTEUR)}`)
}

// 2. Le depot, sa commission et l'acces de 4 mois.
if (avant.commissions.length > 0) {
  console.log('2. Depot deja inscrit : saute.')
} else {
  console.log(`2. ${await executerAction(carte('depot_broker', DEPOT), ACTEUR)}`)
}

// 3. Le droit sans l'exemption. Sans rattachement de cette adresse a son
// compte Telegram, l'acces est relie a u1130067577 (comme les acces poses a
// la main le 06/10), sinon le passage quotidien ne le verrait pas.
const apres = await etat()
if (!apres.acces || apres.acces.retire_le || apres.acces.sorti_le) throw new Error('Acces absent ou ferme apres le depot : exemption gardee, arret.')
if (apres.acces.telegram_id === null && apres.rattachement?.email !== EMAIL) {
  const n = await prisma.$executeRawUnsafe(
    `update public.cockpit_liveclub_acces set telegram_id = $1 where acces_id = $2::uuid and telegram_id is null`, TELEGRAM, apres.acces.acces_id)
  console.log(`3. Acces relie au compte Telegram u${TELEGRAM} (${n} ligne).`)
}
const { droitLiveClub } = await import('../src/lib/liveclub/droits.ts')
const droit = await droitLiveClub(TELEGRAM, { exemptionIgnoree: EXEMPTION })
console.log(`3. Droit sans l'exemption : ${droit.statut} (${droit.raison ?? '?'}${droit.fin ? `, jusqu'au ${droit.fin}` : ''})`)
if (droit.statut !== 'oui' || droit.raison !== 'acces_broker') {
  console.error('Le droit ne tient pas sans l\'exemption : elle est GARDEE. A regarder a la main.')
  await prisma.$disconnect()
  process.exit(1)
}

// 4. L'exemption, fermee comme le bouton du cockpit.
const fermees = await prisma.$executeRawUnsafe(
  `update public.cockpit_liveclub_exemptions set retire_le = now(), retire_par = $1::uuid where exemption_id = $2::uuid and retire_le is null`, BRICE, EXEMPTION)
console.log(`4. Exemption ${EXEMPTION.slice(0, 8)} fermee (${fermees} ligne).`)
console.log(`\nFait. A dire a Mel : la date du depot (28/10) est supposee ; si elle est autre, corriger la commission dans le cockpit (onglet Revenus).`)
await prisma.$disconnect()
