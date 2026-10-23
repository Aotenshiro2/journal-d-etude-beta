// Bascule des PDF proteges de l'academie : copie chaque objet du bucket Supabase PRIVE academie-ressources
// vers la Storage Zone Bunny (« aok-academie-pdfs »), AU MEME CHEMIN (academie_lecons.ressources ne change
// pas). Lot D:\6_Societe\Pilotage\Academie\lots\LOT-PDF-SUR-BUNNY.md, 23/10/2026.
//
//   node --env-file=.env.local scripts/migrer-ressources-vers-bunny.mjs [--ecrire] [--verifier-sommes] [--coffre=<chemin>]
//
// - A blanc par defaut : liste les deux cotes, donne le plan (a copier, a remplacer, deja la), ne telecharge
//   rien et n'ecrit rien. --ecrire pour copier.
// - Copie : telecharge l'objet (cle de service), controle sa taille contre celle du bucket, calcule sa somme
//   SHA256, l'envoie a Bunny avec cette somme (Bunny refuse un contenu abime), puis relit la liste Bunny et
//   verifie taille + somme de chaque copie.
// - « deja la » sans telechargement = meme taille sur Bunny (le bucket ne donne qu'un MD5, pas de SHA256).
//   --verifier-sommes telecharge aussi ceux-la et compare la somme (un contenu different est recopie avec
//   --ecrire, signale sinon).
// - Ne supprime RIEN, ni dans Supabase ni chez Bunny (le bucket sera vide plus tard, apres essai).
// - Bilan chiffre a la fin ; code de sortie 1 au moindre echec.
//
// Cles : SUPABASE_SERVICE_ROLE_KEY (.env.local) et mot de passe de la Storage Zone (coffre) ; jamais affichees.
import { createClient } from '@supabase/supabase-js'
import { BUCKET_RESSOURCES } from '../src/lib/academie/pur.ts'
import { cheminCoffreBunny, envoyerBunny, identiqueSurBunny, listerBunny, lireCoffreBunny, mo, sha256 } from './bunny-stockage.mjs'

const args = process.argv.slice(2)
const ecrire = args.includes('--ecrire')
const verifierSommes = args.includes('--verifier-sommes')

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim()
const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
if (!url || !cle) {
  console.error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente (lancer avec --env-file=.env.local).')
  process.exit(1)
}
const stockage = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(BUCKET_RESSOURCES)
const coffre = lireCoffreBunny(cheminCoffreBunny(args))

// 1. Le bucket Supabase, recursif (un element sans id est un dossier).
async function listerSupabase(dossier = '') {
  const objets = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await stockage.list(dossier, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`liste du bucket ${dossier || '/'} : ${error.message}`)
    for (const o of data ?? []) {
      const chemin = dossier ? `${dossier}/${o.name}` : o.name
      if (!o.id) objets.push(...await listerSupabase(chemin))
      else objets.push({ chemin, taille: Number(o.metadata?.size ?? -1) })
    }
    if (!data || data.length < 1000) break
  }
  return objets
}

let source
let bunny
try {
  source = await listerSupabase()
  bunny = await listerBunny(coffre)
} catch (err) {
  console.error(`Lecture impossible : ${err.message}`)
  process.exit(1)
}

for (const o of source) {
  const d = bunny.get(o.chemin)
  o.action = !d ? 'a copier' : d.taille === o.taille ? 'deja la' : 'a remplacer'
}
const compte = (a) => source.filter(o => o.action === a).length
const total = source.reduce((s, o) => s + Math.max(o.taille, 0), 0)
console.log(`Bucket ${BUCKET_RESSOURCES} : ${source.length} objet(s), ${mo(total)}. Bunny ${coffre.zone} : ${bunny.size} fichier(s) avant.`)
for (const o of source) console.log(`  ${o.action.padEnd(12)} ${o.chemin}  (${mo(o.taille)})`)
console.log(`Plan : ${compte('a copier')} a copier, ${compte('a remplacer')} a remplacer, ${compte('deja la')} deja la (meme taille).`)

if (!ecrire && !verifierSommes) {
  console.log('ESSAI A BLANC : rien n\'est telecharge ni copie (--ecrire pour copier, --verifier-sommes pour controler les « deja la »).')
  process.exit(0)
}

// 2. Telechargement, somme, copie.
let copies = 0
let identiques = 0
let differents = 0
let echecs = 0
const partis = []
for (const o of source) {
  const aCopier = o.action !== 'deja la'
  if (!aCopier && !verifierSommes) continue
  if (aCopier && !ecrire) continue
  const { data, error } = await stockage.download(o.chemin)
  if (error || !data) { echecs++; console.error(`ECHEC   ${o.chemin} : telechargement (${error?.message ?? 'vide'})`); continue }
  const contenu = Buffer.from(await data.arrayBuffer())
  if (o.taille >= 0 && contenu.length !== o.taille) { echecs++; console.error(`ECHEC   ${o.chemin} : ${contenu.length} octets recus, ${o.taille} annonces`); continue }
  o.taille = contenu.length
  o.somme = sha256(contenu)
  if (!aCopier) {
    if (identiqueSurBunny(bunny.get(o.chemin), contenu.length, o.somme)) { identiques++; continue }
    differents++
    console.warn(`DIFFERENT ${o.chemin} : meme taille, somme differente sur Bunny`)
    if (!ecrire) continue
  }
  let code
  try {
    code = await envoyerBunny(coffre, o.chemin, contenu, o.somme)
  } catch (err) {
    code = err.name
  }
  if (code === 201 || code === 200) { partis.push(o); console.log(`COPIE   ${o.chemin}  (${mo(contenu.length)})`) } else { echecs++; console.error(`ECHEC   ${o.chemin} : envoi Bunny ${code}`) }
}

// 3. Verification sur la liste Bunny relue.
if (partis.length) {
  const apres = await listerBunny(coffre)
  for (const o of partis) {
    if (identiqueSurBunny(apres.get(o.chemin), o.taille, o.somme)) copies++
    else { echecs++; console.error(`NON VERIFIE ${o.chemin} : taille ou somme differente sur Bunny`) }
  }
}

console.log(`Bilan : ${source.length} objet(s) dans le bucket ; ${copies} copie(s) et verifiee(s) (taille + somme) ; `
  + `${compte('deja la')} deja la (meme taille)${verifierSommes ? `, dont ${identiques} somme identique et ${differents} differente(s)` : ''} ; `
  + `${echecs} echec(s). Rien n'est supprime.`)
if (echecs) process.exitCode = 1
