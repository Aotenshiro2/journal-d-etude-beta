// Envoie les PDF d'un dossier local dans la Storage Zone Bunny des pieces jointes protegees de l'academie
// (« aok-academie-pdfs », servie par la Pull Zone a jeton ; src/lib/academie/pdf-bunny.ts). Jusqu'au
// 23/10/2026 : le bucket Supabase academie-ressources (voir scripts/migrer-ressources-vers-bunny.mjs).
//
//   node scripts/envoyer-ressources-academie.mjs <dossier local> <prefixe> [--ecrire] [--coffre=<chemin>]
//
//   exemple : node scripts/envoyer-ressources-academie.mjs \
//               "/mnt/d/3_Pedagogie/FORMATION Aok/Formation 2023/PDF" formation-complete
//
// - Les PDF du dossier (pas des sous-dossiers) partent sous <prefixe>/<nom propre> : nom sans accents, en
//   minuscules, autres caracteres remplaces par « - » (cheminDansBucket, src/lib/academie/pur.ts).
//   « Ep 01 - Pourquoi se lancer.pdf » -> « formation-complete/ep-01-pourquoi-se-lancer.pdf ».
// - A blanc par defaut : le plan seulement (a envoyer, a remplacer, deja la), rien n'est envoye. --ecrire
//   pour envoyer.
// - Idempotent : un fichier deja sur Bunny avec la meme taille et la meme somme SHA256 (Checksum de la liste
//   Bunny) est laisse ; un contenu different (ou sans somme connue) est remplace. Chaque envoi porte sa somme :
//   Bunny refuse un contenu abime. Apres l'envoi, la liste est relue et chaque fichier verifie (taille + somme).
// - Pas de limite de taille (celle des 50 Mo etait celle du bucket Supabase).
// - Deux fichiers qui donneraient le meme chemin, ou un nom illisible, arretent tout (a renommer).
// - A la fin : les lignes « ressources » a coller dans le fichier de donnees du module
//   ({ "titre", "fichier" } ; titre = nom du fichier, a retoucher).
//
// Mot de passe de la Storage Zone : lu dans le coffre (bunny-stockage.mjs), jamais affiche.
// ATTENTION pendant la bascule : tant que BUNNY_PDF_HOTE et BUNNY_PDF_CLE_JETON ne sont pas posees en prod,
// la route sert encore le bucket Supabase, qui n'a PAS les PDF envoyes ici apres le 23/10.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cheminDansBucket, cheminFichierPropre } from '../src/lib/academie/pur.ts'
import { cheminCoffreBunny, envoyerBunny, identiqueSurBunny, listerBunny, lireCoffreBunny, mo, sha256 } from './bunny-stockage.mjs'

const args = process.argv.slice(2)
const ecrire = args.includes('--ecrire')
const [dossier, prefixeBrut] = args.filter(a => !a.startsWith('--'))
if (!dossier || !prefixeBrut) {
  console.error('Usage : node scripts/envoyer-ressources-academie.mjs <dossier local> <prefixe> [--ecrire] [--coffre=<chemin>]')
  process.exit(2)
}
const prefixe = prefixeBrut.trim().replace(/^\/+|\/+$/g, '')
if (!cheminFichierPropre(prefixe)) {
  console.error(`Prefixe refuse : « ${prefixeBrut} » (lettres, chiffres, . _ - et / seulement, sans .. ni / au debut).`)
  process.exit(2)
}

// 1. Les fichiers locaux.
let noms
try {
  noms = readdirSync(dossier).filter(n => /\.pdf$/i.test(n) && statSync(join(dossier, n)).isFile()).sort()
} catch (err) {
  console.error(`Dossier illisible : ${dossier} (${err.code ?? err.message})`)
  process.exit(1)
}
if (!noms.length) {
  console.error(`Aucun PDF dans ${dossier}.`)
  process.exit(1)
}

const fichiers = []
const parChemin = new Map()
let refus = 0
for (const nom of noms) {
  const local = join(dossier, nom)
  const chemin = cheminDansBucket(prefixe, nom)
  if (!chemin) { console.error(`REFUSE  ${nom} : nom illisible`); refus++; continue }
  if (parChemin.has(chemin)) { console.error(`REFUSE  ${nom} : meme chemin que ${parChemin.get(chemin)} (${chemin})`); refus++; continue }
  parChemin.set(chemin, nom)
  fichiers.push({ nom, local, chemin, taille: statSync(local).size, somme: sha256(readFileSync(local)) })
}
if (refus) {
  console.error(`${refus} fichier(s) refuse(s) : rien n'est envoye. Renommer, puis relancer.`)
  process.exit(1)
}

// 2. Ce qui est deja sur Bunny sous <prefixe>.
const coffre = lireCoffreBunny(cheminCoffreBunny(args))
let existants
try {
  existants = await listerBunny(coffre, prefixe)
} catch (err) {
  console.error(`Liste Bunny illisible : ${err.message}`)
  process.exit(1)
}
for (const f of fichiers) {
  const d = existants.get(f.chemin)
  f.action = !d ? 'a envoyer' : identiqueSurBunny(d, f.taille, f.somme) ? 'deja la' : 'a remplacer'
}

console.log(`Bunny ${coffre.zone}, prefixe ${prefixe}, ${fichiers.length} PDF :`)
for (const f of fichiers) console.log(`  ${f.action.padEnd(12)} ${f.chemin}  (${mo(f.taille)}, depuis « ${f.nom} »)`)
const compte = (a) => fichiers.filter(f => f.action === a).length
console.log(`Plan : ${compte('a envoyer')} a envoyer, ${compte('a remplacer')} a remplacer, ${compte('deja la')} deja la.`)

// 3. L'envoi, puis la verification sur la liste relue.
if (!ecrire) {
  console.log('ESSAI A BLANC : rien n\'est envoye (--ecrire pour envoyer).')
} else {
  let envoyes = 0
  let echecs = 0
  const partis = []
  for (const f of fichiers.filter(x => x.action !== 'deja la')) {
    let code
    try {
      code = await envoyerBunny(coffre, f.chemin, readFileSync(f.local), f.somme)
    } catch (err) {
      code = err.name
    }
    if (code === 201 || code === 200) { envoyes++; partis.push(f); console.log(`ENVOYE  ${f.chemin}`) } else { echecs++; console.error(`ECHEC   ${f.chemin} : ${code}`) }
  }
  let verifies = 0
  if (partis.length) {
    const apres = await listerBunny(coffre, prefixe)
    for (const f of partis) {
      if (identiqueSurBunny(apres.get(f.chemin), f.taille, f.somme)) verifies++
      else { echecs++; console.error(`NON VERIFIE ${f.chemin} : taille ou somme differente sur Bunny`) }
    }
  }
  console.log(`Envoi : ${envoyes} envoye(s), ${verifies} verifie(s) (taille + somme), ${echecs} echec(s), ${compte('deja la')} deja la.`)
  if (echecs) process.exitCode = 1
}

// 4. Les lignes a coller dans le fichier de donnees du module.
console.log('\nA coller dans « ressources » des lecons (titres a retoucher) :')
for (const f of fichiers) {
  console.log(`  ${JSON.stringify({ titre: f.nom.replace(/\.pdf$/i, ''), fichier: f.chemin })}`)
}
