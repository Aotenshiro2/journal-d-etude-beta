// BASCULE (a) : le rattrapage des choix d'abonnement chez Kit (31/10/2026,
// decision de Brice). Pour chaque choix de src/lib/kit-choix.ts qui a une
// regle de rattrapage, pose son tag aux abonnes ACTIFS vises (tous, ou ceux
// qui portent deja le tag requis, par exemple « GDPR: Advertising Consent »
// pour les offres de partenaires) et qui ne l'ont pas encore.
//
// Idempotent : un abonne qui a deja le tag n'est pas retouche (un abonne qui
// a decoche un choix entre-temps n'est pas vise : le rattrapage ne se joue
// qu'une fois, a la bascule). ESSAI par defaut (lecture seule, chiffres).
//
//   node scripts/kit-bascule-rattrapage.mjs              # essai
//   node scripts/kit-bascule-rattrapage.mjs --appliquer  # sur GO de Brice
//
// Duree d'une application : environ 0,55 s par tag a poser (limite de Kit).

import {
  APPLIQUER, CHOIX_KIT, MODE, ciblesDuRattrapage, kit, ligne, nombreAppels, tagsDuCompte, tousLesIds,
} from './kit-bascule-commun.mjs'

console.log(`Rattrapage des choix Kit : ${MODE}\n`)

const noms = await tagsDuCompte()
const absents = CHOIX_KIT.filter(c => !noms.has(c.tag) || (c.rattrapage?.tagRequis && !noms.has(c.rattrapage.tagRequis)))
for (const c of CHOIX_KIT) ligne(`tag ${c.tag}`, noms.has(c.tag) ? `« ${noms.get(c.tag)} »` : 'ABSENT chez Kit', `(${c.cle})`)
if (absents.length) {
  console.error(`\nARRET : tag absent chez Kit pour ${absents.map(c => c.cle).join(', ')}. Rien n'est ecrit.`)
  process.exit(1)
}

const actifs = await tousLesIds('/subscribers?status=active')
console.log(`\nabonnes actifs : ${actifs.size}\n`)

const cache = new Map()
const plan = []
for (const c of CHOIX_KIT) {
  const cibles = await ciblesDuRattrapage(c, actifs, cache)
  if (!cibles) { plan.push({ c, cibles: null }); continue }
  const porteurs = await tousLesIds(`/tags/${c.tag}/subscribers?status=all`)
  const aPoser = [...cibles].filter(id => !porteurs.has(id)).sort((a, b) => a - b)
  plan.push({ c, cibles, deja: cibles.size - aPoser.length, aPoser })
}

ligne('choix'.padEnd(18), 'regle'.padEnd(26), 'cibles', 'deja', 'a poser')
for (const p of plan) {
  if (!p.cibles) { ligne(p.c.cle.padEnd(18), 'aucun rattrapage'); continue }
  const regle = p.c.rattrapage.tagRequis ? `actifs avec tag ${p.c.rattrapage.tagRequis}` : 'tous les actifs'
  ligne(p.c.cle.padEnd(18), regle.padEnd(26), String(p.cibles.size).padStart(6), String(p.deja).padStart(4), String(p.aPoser.length).padStart(7))
}
const total = plan.reduce((s, p) => s + (p.aPoser?.length ?? 0), 0)
console.log(`\ntags a poser : ${total} (environ ${Math.ceil(total * 0.55 / 60)} min)`)

if (!APPLIQUER) {
  console.log(`\nESSAI : rien n'est ecrit. ${nombreAppels()} appels de lecture.`)
  process.exit(0)
}

let poses = 0, deja = 0
const erreurs = new Map()
for (const p of plan) {
  for (const id of p.aPoser ?? []) {
    const r = await kit(`/tags/${p.c.tag}/subscribers/${id}`, { method: 'POST', body: '{}' })
    if (r.statut === 201) poses++
    else if (r.statut === 200) deja++
    else erreurs.set(r.statut, (erreurs.get(r.statut) ?? 0) + 1)
  }
  console.log(`  ${p.c.cle} : fait`)
}
console.log(`\nposes ${poses}, deja la ${deja}, erreurs ${[...erreurs].map(([s, k]) => `${k} x ${s}`).join(', ') || 0}`)

// Relecture : il ne doit plus manquer personne.
let manquants = 0
for (const p of plan) {
  if (!p.cibles) continue
  const porteurs = await tousLesIds(`/tags/${p.c.tag}/subscribers?status=all`)
  const m = [...p.cibles].filter(id => !porteurs.has(id)).length
  manquants += m
  ligne(`  relu ${p.c.cle}`.padEnd(22), `manquants ${m}`)
}
console.log(`\n${manquants ? 'A REPRENDRE' : 'OK'} : ${manquants} manquant(s). ${nombreAppels()} appels.`)
process.exit(manquants || erreurs.size ? 1 : 0)
