#!/usr/bin/env node
//
// Rejoue le decoupage d'appliquer-migration.mjs sur un fichier, SANS rien
// executer, et dit combien d'ordres il produira et si l'un d'eux coupe une
// chaine litterale.
//
// POURQUOI CE SCRIPT EXISTE. `appliquer-migration.mjs` decoupe sur les
// points-virgules en respectant les blocs `$...$`, mais PAS les chaines entre
// apostrophes. Un `;` dans un `comment on ... is '...'` couperait l'ordre en
// deux et ferait echouer toute la migration — apres en avoir deja applique une
// partie. Verifier avant coute deux secondes.
//
//   node scripts/verifier-decoupage.mjs <fichier.sql>

import { readFileSync } from 'node:fs'

const fichier = process.argv[2]
if (!fichier) {
  console.error('usage : node scripts/verifier-decoupage.mjs <fichier.sql>')
  process.exit(2)
}

const sansCommentaires = readFileSync(fichier, 'utf8')
  .split('\n')
  .filter((ligne) => !ligne.trim().startsWith('--'))
  .join('\n')

// Copie EXACTE de la fonction d'appliquer-migration.mjs. Si celle-la change,
// celle-ci doit changer : c'est le prix d'un verificateur fidele.
function decouper(sql) {
  const ordres = []
  let courant = ''
  let tag = null
  let i = 0

  while (i < sql.length) {
    if (!tag) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (dollar) {
        tag = dollar[0]
        courant += tag
        i += tag.length
        continue
      }
      if (sql[i] === ';') {
        if (courant.trim()) ordres.push(courant.trim())
        courant = ''
        i += 1
        continue
      }
    } else if (sql.startsWith(tag, i)) {
      courant += tag
      i += tag.length
      tag = null
      continue
    }
    courant += sql[i]
    i += 1
  }

  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}

const ordres = decouper(sansCommentaires)
console.log(`${ordres.length} ordre(s) SQL`)

let casse = 0
ordres.forEach((o, k) => {
  // Une apostrophe doublee ('') est un echappement SQL, pas une bascule.
  const quotes = (o.replace(/''/g, '').match(/'/g) || []).length
  const impair = quotes % 2 !== 0
  if (impair) casse += 1
  const tete = o.split('\n')[0].slice(0, 70)
  console.log(`${impair ? 'X' : ' '} ${String(k + 1).padStart(2)}. ${tete}`)
})

if (casse) {
  console.error(`\nX ${casse} ordre(s) coupent une chaine litterale. NE PAS APPLIQUER.`)
  process.exit(1)
}
console.log('\nOK : aucun ordre ne coupe de chaine litterale.')
