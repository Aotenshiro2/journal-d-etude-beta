// BASCULE (c) : la relecture finale (31/10/2026). Lecture seule, toujours.
// Dit, chiffres a l'appui, si la bascule des choix d'abonnement est complete :
//   - chaque tag de src/lib/kit-choix.ts existe chez Kit (nom relu) ;
//   - chaque choix a rattraper : cibles, porteurs actifs, manquants (doit
//     etre 0 apres la bascule), porteurs hors cibles (inscriptions et choix
//     faits depuis, pour information) ;
//   - S46 a S50 : statut, send_at, filtre (doit viser le tag du samedi).
// Avant la bascule, il est normal que tout soit « a faire ».
//
//   node scripts/kit-bascule-relecture.mjs

import {
  BROADCASTS_SAMEDI, CHOIX_KIT, CLE_NEWSLETTER_HEBDO, TAG_CONSENTEMENT_PUB,
  ciblesDuRattrapage, dansLeFutur, exiger, ligne, nombreAppels, resumeFiltre, tagsDuCompte, tousLesIds, vise,
} from './kit-bascule-commun.mjs'

const TAG_SAMEDI = CHOIX_KIT.find(c => c.cle === CLE_NEWSLETTER_HEBDO)?.tag
let ecarts = 0

console.log('Relecture de la bascule des choix Kit (lecture seule)\n')

const noms = await tagsDuCompte()
for (const t of [...CHOIX_KIT.map(c => c.tag), TAG_CONSENTEMENT_PUB]) {
  const ok = noms.has(t)
  if (!ok) ecarts++
  ligne(`tag ${t}`, ok ? `« ${noms.get(t)} »` : 'ABSENT chez Kit')
}

const actifs = await tousLesIds('/subscribers?status=active')
console.log(`\nabonnes actifs : ${actifs.size}\n`)
ligne('choix'.padEnd(18), 'cibles', 'porteurs actifs', 'manquants', 'hors cibles')
const cache = new Map()
for (const c of CHOIX_KIT) {
  const cibles = await ciblesDuRattrapage(c, actifs, cache)
  const porteurs = await tousLesIds(`/tags/${c.tag}/subscribers?status=active`)
  if (!cibles) { ligne(c.cle.padEnd(18), '-'.padStart(6), String(porteurs.size).padStart(15), '-'.padStart(9), '-'.padStart(11)); continue }
  const manquants = [...cibles].filter(id => !porteurs.has(id)).length
  const horsCibles = [...porteurs].filter(id => !cibles.has(id)).length
  if (manquants) ecarts++
  ligne(c.cle.padEnd(18), String(cibles.size).padStart(6), String(porteurs.size).padStart(15), String(manquants).padStart(9), String(horsCibles).padStart(11))
}

console.log(`\nnewsletters du samedi (doivent viser le tag ${TAG_SAMEDI}) :`)
for (const { nom, id } of BROADCASTS_SAMEDI) {
  const b = (await exiger(`/broadcasts/${id}`))?.broadcast ?? {}
  const bon = b.status === 'scheduled' && dansLeFutur(b.send_at, 0) && vise(b.subscriber_filter, TAG_SAMEDI)
  if (!bon) ecarts++
  ligne(nom, id, bon ? 'OK' : 'A FAIRE', `${b.status ?? '?'}, send_at ${b.send_at ?? 'vide'}`, `filtre : ${resumeFiltre(b.subscriber_filter)}`)
}

console.log(`\n${ecarts ? `${ecarts} point(s) a faire ou a reprendre` : 'Bascule complete'}. ${nombreAppels()} appels de lecture.`)
process.exit(ecarts ? 1 : 0)
