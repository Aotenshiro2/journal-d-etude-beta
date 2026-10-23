// Controle EN LIGNE des liens signes des PDF de l'academie sur Bunny CDN (src/lib/academie/pdf-bunny.ts,
// 23/10/2026). Lecture seule : ne fait que des GET sur la Pull Zone (le corps est coupe apres le premier
// morceau, de quoi lire l'en-tete %PDF).
//
//   node scripts/verifier-pdf-bunny.mjs [<chemin du fichier>] [--coffre=<chemin>]
//
// Chemin par defaut : le premier PDF trouve dans la Storage Zone (liste par l'API Storage).
// Attendu : lien signe 5 min = 200 (application/pdf, commence par %PDF) ; sans jeton = 403 ;
// jeton expire = 403 ; jeton d'une autre cle = 403 ; jeton d'un autre fichier = 403.
// N'affiche JAMAIS la cle, le jeton ni l'URL signee : seulement les codes HTTP et le chemin.
import { configPdfBunny, signerPdf } from '../src/lib/academie/pdf-bunny.ts'
import { cheminCoffreBunny, listerBunny, lireCoffreBunny } from './bunny-stockage.mjs'

const args = process.argv.slice(2)
const coffre = lireCoffreBunny(cheminCoffreBunny(args))
const config = configPdfBunny({ BUNNY_PDF_HOTE: coffre.pullZone, BUNNY_PDF_CLE_JETON: coffre.cleJeton })
if (typeof config === 'string') {
  console.error(`Coffre : pull_zone_hostname ou token_auth_key ${config === 'absente' ? 'absents' : 'mal formes'}.`)
  process.exit(1)
}

let chemin = args.find(a => !a.startsWith('--'))
let autre = null
if (!chemin) {
  const pdf = [...(await listerBunny(coffre)).keys()].filter(c => c.endsWith('.pdf')).sort()
  if (!pdf.length) {
    console.error('Aucun PDF dans la Storage Zone : lancer d\'abord scripts/migrer-ressources-vers-bunny.mjs --ecrire.')
    process.exit(1)
  }
  chemin = pdf[0]
  autre = pdf[1] ?? null
}
console.log(`Fichier controle : ${chemin}`)

/** Code HTTP, type et 4 premiers octets, sans lire tout le fichier. */
async function demander(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'manual' })
  let debut = ''
  if (res.body) {
    const lecteur = res.body.getReader()
    const { value } = await lecteur.read()
    debut = value ? Buffer.from(value.subarray(0, 4)).toString('latin1') : ''
    await lecteur.cancel().catch(() => null)
  }
  return { code: res.status, type: res.headers.get('content-type') ?? '', debut }
}

let echecs = 0
function attendu(nom, obtenu, code) {
  const ok = obtenu === code
  if (!ok) echecs++
  console.log(`${ok ? 'ok  ' : 'ECHEC'} ${nom} : ${obtenu}${ok ? '' : ` (attendu ${code})`}`)
}

const signe = signerPdf(chemin, config)
if (!signe) {
  console.error(`Chemin mal forme : ${chemin}`)
  process.exit(1)
}
const r = await demander(signe.url)
attendu('lien signe 5 min', r.code, 200)
if (r.code === 200) {
  const pdf = r.debut === '%PDF'
  if (!pdf) echecs++
  console.log(`${pdf ? 'ok  ' : 'ECHEC'} contenu : ${r.type || 'type absent'}, ${pdf ? 'commence par %PDF' : 'ne commence PAS par %PDF'}`)
}
attendu('sans jeton', (await demander(`https://${config.hote}/${chemin}`)).code, 403)
const expire = signerPdf(chemin, config, { dureeSecondes: 60, maintenantMs: Date.now() - 3600 * 1000 })
attendu('jeton expire (il y a 59 min)', (await demander(expire.url)).code, 403)
const fausse = signerPdf(chemin, { ...config, cle: `${config.cle}x` })
attendu('jeton signe avec une autre cle', (await demander(fausse.url)).code, 403)
if (autre) {
  // Le jeton d'un fichier ne doit pas ouvrir un autre fichier.
  const jetonAutre = new URL(signerPdf(autre, config).url).search
  attendu(`jeton de ${autre} sur ce fichier`, (await demander(`https://${config.hote}/${chemin}${jetonAutre}`)).code, 403)
}

if (echecs) {
  console.log(`${echecs} controle(s) en echec.`)
  process.exit(1)
}
console.log('Tous les controles passent.')
