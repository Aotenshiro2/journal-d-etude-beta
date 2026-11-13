// ESSAI LOCAL de l'email a tous les membres (13/11/2026), en SIMULATION : aucune base,
// aucun reseau, aucun email. Ecrit dans un dossier l'email tel qu'un membre le recevra
// (HTML et texte), sa version d'essai, et ce que le journal du serveur ecrirait en
// simulation pour un lot de 3 adresses inventees.
//
//   node scripts/essayer-email-annonce.mjs --sortie <dossier> [--texte <fichier.txt>] [--objet "..."]
//
// Sans --texte : une annonce d'exemple (texte invente, avec un lien et du Markdown pour voir
// le desamorcage). Le jeton de desinscription est signe avec un secret factice.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as E from '../src/lib/academie/emails-annonces.ts'

const args = process.argv.slice(2)
const val = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : undefined }
const sortie = val('--sortie')
if (!sortie) {
  console.error('usage : node scripts/essayer-email-annonce.mjs --sortie <dossier> [--texte <fichier>] [--objet "..."]')
  process.exit(1)
}

const OBJET = val('--objet') ?? 'Exemple : la nouvelle maison de la communauté est ouverte'
const TEXTE = val('--texte') ? readFileSync(resolve(val('--texte')), 'utf8') : [
  'Salut,',
  '',
  'Texte inventé pour l\'essai de l\'email à tous : il ne part à personne.',
  '',
  '## Ce qui change lundi',
  '',
  '- les cours, les replays et les billets sont sur l\'académie ;',
  '- les questions se posent sous chaque leçon et dans le salon ;',
  '- **ton compte** est le même partout.',
  '',
  'Un lien collé dans le texte ne devient jamais cliquable : https://exemple.com/piege ou www.exemple.fr.',
  'Le seul bouton de l\'email mène à l\'académie.',
  '',
  'À tout de suite,',
  'Brice',
].join('\n')

const secret = E.deriverSecret('secret-factice-pour-essai-local-seulement-0123456789')
const ids = ['3f1d2c4b-1a2b-4c3d-8e9f-0a1b2c3d4e5f', '4a2e3d5c-2b3c-4d4e-9f0a-1b2c3d4e5f60', '5b3f4e6d-3c4d-4e5f-8a1b-2c3d4e5f6071']
const lienBillet = 'https://aoknowledge.com/academie/chroniques-de-l-accelerateur/exemple-de-billet'

mkdirSync(sortie, { recursive: true })
const lien = E.lienDesinscription(E.ROUTE_DESINSCRIPTION_DEFAUT, E.jetonDesinscription(secret, ids[0]))
const membre = E.construireEmail({ objet: OBJET, texte: TEXTE, lien: lienBillet, lienDesinscription: lien, essai: false })
const essai = E.construireEmail({ objet: OBJET, texte: TEXTE, lien: lienBillet, lienDesinscription: lien, essai: true })
writeFileSync(join(sortie, 'email-membre.html'), membre.html)
writeFileSync(join(sortie, 'email-membre.txt'), `Sujet : ${membre.sujet}\n\n${membre.texte}\n`)
writeFileSync(join(sortie, 'email-essai.html'), essai.html)

const journal = []
const envoyeur = E.envoyeurSimulation((l) => journal.push(l))
const lot = ids.map((id, i) => {
  const l = E.lienDesinscription(E.ROUTE_DESINSCRIPTION_DEFAUT, E.jetonDesinscription(secret, id))
  return { id, email: `membre${i + 1}@exemple.fr`, lien: l, pret: E.construireEmail({ objet: OBJET, texte: TEXTE, lien: lienBillet, lienDesinscription: l, essai: false }) }
})
const res = await envoyeur(lot, E.cleLot(ids[0], ids), ids[0].slice(0, 8))
writeFileSync(join(sortie, 'journal-simulation.txt'), `${journal.join('\n')}\n\nResultat : ${res.map((r) => r.statut).join(', ')}\n`)

console.log(`ecrit dans ${resolve(sortie)} : email-membre.html, email-membre.txt, email-essai.html, journal-simulation.txt`)
console.log(`liens cliquables de l'email : ${[...membre.html.matchAll(/href="([^"]*)"/g)].length} (bouton + desinscription)`)
