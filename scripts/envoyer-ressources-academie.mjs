// Envoie les PDF d'un dossier local dans le bucket PRIVE des pieces jointes de l'academie
// (academie-ressources, migration 20261016140000_academie_ressources_protegees.sql).
//
//   node --env-file=.env.local scripts/envoyer-ressources-academie.mjs <dossier local> <prefixe> [--ecrire]
//
//   exemple : node --env-file=.env.local scripts/envoyer-ressources-academie.mjs \
//               "/mnt/d/3_Pedagogie/FORMATION Aok/Formation 2023/PDF" formation-complete
//
// - Les PDF du dossier (pas des sous-dossiers) partent sous <prefixe>/<nom propre> : nom sans accents, en
//   minuscules, autres caracteres remplaces par « - » (cheminDansBucket, src/lib/academie/pur.ts).
//   « Ep 01 - Pourquoi se lancer.pdf » -> « formation-complete/ep-01-pourquoi-se-lancer.pdf ».
// - A blanc par defaut : le plan seulement (a envoyer, a remplacer, deja la), rien n'est envoye. --ecrire
//   pour envoyer.
// - Idempotent : un fichier deja dans le bucket avec le meme contenu (MD5 = eTag, ou meme taille si
//   l'eTag n'est pas un MD5) est laisse ; un contenu different est remplace.
// - Un PDF de plus de 50 Mo (limite du bucket) est ignore et signale ; deux fichiers qui donneraient le
//   meme chemin, ou un nom illisible, arretent tout (a renommer).
// - A la fin : les lignes « ressources » a coller dans le fichier de donnees du module
//   ({ "titre", "fichier" } ; titre = nom du fichier, a retoucher).
//
// Cle de service (SUPABASE_SERVICE_ROLE_KEY, .env.local) : jamais affichee. Refuse d'envoyer si le bucket
// n'existe pas (appliquer la migration d'abord) ou s'il est public.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { BUCKET_RESSOURCES, cheminDansBucket, cheminFichierPropre } from '../src/lib/academie/pur.ts'

const LIMITE_OCTETS = 50 * 1024 * 1024 // file_size_limit du bucket

const args = process.argv.slice(2)
const ecrire = args.includes('--ecrire')
const [dossier, prefixeBrut] = args.filter(a => !a.startsWith('--'))
if (!dossier || !prefixeBrut) {
  console.error('Usage : node --env-file=.env.local scripts/envoyer-ressources-academie.mjs <dossier local> <prefixe> [--ecrire]')
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
let tropGros = 0
for (const nom of noms) {
  const local = join(dossier, nom)
  const chemin = cheminDansBucket(prefixe, nom)
  const taille = statSync(local).size
  if (!chemin) { console.error(`REFUSE  ${nom} : nom illisible`); refus++; continue }
  if (parChemin.has(chemin)) { console.error(`REFUSE  ${nom} : meme chemin que ${parChemin.get(chemin)} (${chemin})`); refus++; continue }
  parChemin.set(chemin, nom)
  if (taille > LIMITE_OCTETS) {
    // Pas un nom a corriger : le fichier est laisse de cote, le reste part.
    console.warn(`IGNORE  ${nom} : ${(taille / 1048576).toFixed(1)} Mo, plus que les 50 Mo du bucket (a compresser ou a couper)`)
    tropGros++
    continue
  }
  const md5 = createHash('md5').update(readFileSync(local)).digest('hex')
  fichiers.push({ nom, local, chemin, taille, md5 })
}
if (refus) {
  console.error(`${refus} fichier(s) refuse(s) : rien n'est envoye. Renommer, puis relancer.`)
  process.exit(1)
}

// 2. Le bucket.
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim()
const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
if (!url || !cle) {
  console.error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente (lancer avec --env-file=.env.local).')
  process.exit(1)
}
const supabase = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
const stockage = supabase.storage.from(BUCKET_RESSOURCES)

const { data: bucket, error: erreurBucket } = await supabase.storage.getBucket(BUCKET_RESSOURCES)
let bucketPret = true
if (erreurBucket || !bucket) {
  bucketPret = false
  console.warn(`Bucket ${BUCKET_RESSOURCES} absent ou illisible (${erreurBucket?.message ?? 'reponse vide'}) : appliquer la migration `
    + '20261016140000_academie_ressources_protegees.sql d\'abord. Plan ci-dessous comme si le bucket etait vide.')
} else if (bucket.public) {
  console.error(`REFUS : le bucket ${BUCKET_RESSOURCES} est PUBLIC. Les PDF payants n'y vont pas. Rejouer la migration (elle le remet en prive).`)
  process.exit(1)
}

// 3. Ce qui est deja la (dossier <prefixe>, 1000 fichiers au plus par page).
const existants = new Map()
if (bucketPret) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await stockage.list(prefixe, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) {
      console.error(`Liste du bucket illisible : ${error.message}`)
      process.exit(1)
    }
    for (const o of data ?? []) if (o.id) existants.set(`${prefixe}/${o.name}`, o.metadata ?? {})
    if (!data || data.length < 1000) break
  }
}

const identique = (f, meta) => {
  const etag = String(meta.eTag ?? '').replace(/"/g, '').toLowerCase()
  if (/^[0-9a-f]{32}$/.test(etag)) return etag === f.md5
  return Number(meta.size) === f.taille
}

for (const f of fichiers) {
  const meta = existants.get(f.chemin)
  f.action = !meta ? 'a envoyer' : identique(f, meta) ? 'deja la' : 'a remplacer'
}

const mo = (o) => `${(o / 1048576).toFixed(1)} Mo`
console.log(`Bucket ${BUCKET_RESSOURCES}, prefixe ${prefixe}, ${fichiers.length} PDF :`)
for (const f of fichiers) console.log(`  ${f.action.padEnd(12)} ${f.chemin}  (${mo(f.taille)}, depuis « ${f.nom} »)`)
const compte = (a) => fichiers.filter(f => f.action === a).length
console.log(`Plan : ${compte('a envoyer')} a envoyer, ${compte('a remplacer')} a remplacer, ${compte('deja la')} deja la`
  + `${tropGros ? `, ${tropGros} ignore(s) (plus de 50 Mo)` : ''}.`)

// 4. L'envoi.
if (!ecrire) {
  console.log('ESSAI A BLANC : rien n\'est envoye (--ecrire pour envoyer).')
} else if (!bucketPret) {
  console.error('Rien n\'est envoye : le bucket n\'existe pas.')
  process.exitCode = 1
} else {
  let envoyes = 0
  let echecs = 0
  for (const f of fichiers.filter(x => x.action !== 'deja la')) {
    const { error } = await stockage.upload(f.chemin, readFileSync(f.local), {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: f.action === 'a remplacer',
    })
    if (error) { echecs++; console.error(`ECHEC   ${f.chemin} : ${error.message}`) } else { envoyes++; console.log(`ENVOYE  ${f.chemin}`) }
  }
  console.log(`Envoi : ${envoyes} envoye(s), ${echecs} echec(s), ${compte('deja la')} deja la.`)
  if (echecs) process.exitCode = 1
}

// 5. Les lignes a coller dans le fichier de donnees du module.
console.log('\nA coller dans « ressources » des lecons (titres a retoucher) :')
for (const f of fichiers) {
  console.log(`  ${JSON.stringify({ titre: f.nom.replace(/\.pdf$/i, ''), fichier: f.chemin })}`)
}
