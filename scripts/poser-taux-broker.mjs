// LE TAUX D'UN BROKER PARTENAIRE, par le meme chemin que la carte de l'agent
// (validerAction puis executerAction, taux_partenaire). Ecrit pour la regle
// donnee par Brice le 29/10/2026 sur le broker qu'il dit « deja en base » :
// « peu importe le montant on prend 650 qu'on se redivise elle et moi », soit
// 650 EUR fixes par client. Le partage n'est PAS 50/50 : une commission broker
// est du cote de Mel, 70 % Mel et 30 % Brice (repartition/pur.ts,
// partsCommission), et c'est la repartition du mois qui le calcule.
//
// AU 29/10, AUCUN broker n'est en base (cockpit_partenaires est vide) : le nom
// de ce broker est a donner (les acces broker d'avant le 29/10 portent tous
// source 'raisefx', valeur par defaut du code, ce qui ne prouve rien).
//
//   node --env-file=.env.local scripts/poser-taux-broker.mjs --partenaire "<Nom>" --montant-fixe 650 --depuis AAAA-MM-JJ
//   ... --ecrire        (ecrit ; sans lui, lecture seule)
// Options : --taux-pct <n> au lieu de --montant-fixe ; --nature broker|affiliation
// (obligatoire pour un nouveau partenaire, broker par defaut) ; --note "...".

import './resoudre-ts.mjs'

const arg = (nom) => {
  const i = process.argv.indexOf(`--${nom}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const ECRIRE = process.argv.includes('--ecrire')
const BRICE = '0636a40b-13a4-4fe8-af11-d060e2810767'
const params = {
  partenaire: arg('partenaire'),
  nature: arg('nature') ?? 'broker',
  ...(arg('montant-fixe') !== undefined ? { montant_fixe: arg('montant-fixe') } : {}),
  ...(arg('taux-pct') !== undefined ? { taux_pct: arg('taux-pct') } : {}),
  a_partir_du: arg('depuis'),
  note: arg('note') ?? 'Règle de Brice du 29/10/2026 : 650 EUR par client, peu importe le montant, partagés entre Brice et Mel (70/30, côté Mel).',
}
if (!params.partenaire || !params.a_partir_du) {
  console.error('Il faut --partenaire "<Nom>" et --depuis AAAA-MM-JJ (et --montant-fixe ou --taux-pct).')
  process.exit(1)
}

const { prisma } = await import('../src/lib/db.ts')
const { validerAction, executerAction, resumeAction } = await import('../src/lib/stripe-actions.ts')
const { controlerActionRepartition } = await import('../src/lib/repartition/serveur.ts')

const action = validerAction({ type: 'taux_partenaire', compte: 'cockpit', params })
if (typeof action === 'string') {
  console.error(`Refuse : ${action}`)
  await prisma.$disconnect()
  process.exit(1)
}
const lu = await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('set transaction read only')
  return {
    partenaire: (await tx.$queryRawUnsafe('select partenaire_id, nom, nature, note from public.cockpit_partenaires where partenaire_id = $1', action.params.partenaire))[0] ?? null,
    taux: await tx.$queryRawUnsafe('select a_partir_du::text, taux_pct, montant_fixe, note from public.cockpit_partenaire_taux where partenaire_id = $1 order by a_partir_du', action.params.partenaire),
  }
})
console.log(`Mode : ${ECRIRE ? 'ECRITURE' : 'lecture seule'}`)
console.log(`En base : ${JSON.stringify(lu)}`)
const controle = await controlerActionRepartition(action)
if ('erreur' in controle) {
  console.error(`Refuse avant la carte : ${controle.erreur}`)
  await prisma.$disconnect()
  process.exit(1)
}
console.log(`Carte : ${resumeAction(action)} ${controle.complement ?? ''}`)
if (!ECRIRE) {
  console.log("Lecture seule : rien n'a ete ecrit. Relancer avec --ecrire pour appliquer.")
} else {
  console.log(await executerAction(action, `cockpit:${BRICE}`))
}
await prisma.$disconnect()
