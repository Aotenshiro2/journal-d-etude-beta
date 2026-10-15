// Verification des liens signes Bunny de l'academie (src/lib/academie/bunny.ts
// et essai.ts). Node 22 supprime les types tout seul : le .ts est importe tel
// quel, la fonction testee est celle de la route.
//
// 1. Hors ligne : formule du jeton (vecteur calcule a part, en Python), forme
//    de l'URL, expiration, configuration, liste d'essai.
// 2. En ligne (sauf --hors-ligne) : lit library_id et token_auth_key dans le
//    coffre, signe chaque video d'essai et demande le lecteur Bunny :
//      lien signe = 200, sans jeton = 403, jeton expire = 403, jeton faux = 403.
//    N'affiche JAMAIS la cle, ni le jeton, ni l'URL signee : seulement les
//    codes HTTP et le guid.
//
// Lancement (depuis apps/journal-d-etude) :
//   node scripts/verifier-academie-bunny.mjs [--hors-ligne] [chemin du coffre]
// Coffre par defaut :
//   /mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/bunny-stream.local.json

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { configBunny, jetonLecture, lienLecture, signerLecture, DUREE_LIEN_S } from '../src/lib/academie/bunny.ts'
import { VIDEOS_ESSAI, videoEssai } from '../src/lib/academie/essai.ts'

const args = process.argv.slice(2)
const horsLigne = args.includes('--hors-ligne')
const cheminCoffre = args.find(a => !a.startsWith('--'))
  ?? '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/bunny-stream.local.json'

let blocs = 0
function bloc(nom, fn) {
  fn()
  blocs++
  console.log(`ok  ${nom}`)
}

// ---------- 1. Hors ligne ----------

bloc('jeton = SHA256_HEX(cle + video + expiration)', () => {
  // python3 -c "import hashlib; print(hashlib.sha256(b'cle-de-test' + b'b03789d3-...' + b'1760000000').hexdigest())"
  assert.equal(
    jetonLecture('cle-de-test', 'b03789d3-f998-44ec-8c3c-5d8c5977008c', 1760000000),
    '75079a4b43ca3a3d508dce41add7efed2ff74f84ad86e9f3bd66b5e1445fce7e',
  )
})

bloc('forme du lien et expiration', () => {
  const config = { libraryId: '123456', cle: 'cle-de-test' }
  const l = lienLecture(config, 'b03789d3-f998-44ec-8c3c-5d8c5977008c', 1760000000)
  assert.equal(
    l.url,
    'https://player.mediadelivery.net/embed/123456/b03789d3-f998-44ec-8c3c-5d8c5977008c'
      + '?token=75079a4b43ca3a3d508dce41add7efed2ff74f84ad86e9f3bd66b5e1445fce7e&expires=1760000000',
  )
  assert.equal(l.expireLe, new Date(1760000000 * 1000).toISOString())
  assert.ok(!l.url.includes('cle-de-test'), 'la cle ne doit jamais apparaitre dans l URL')

  const maintenantMs = 1_760_000_000_500
  const s = signerLecture('abc', DUREE_LIEN_S, { config, maintenantMs })
  assert.equal(s.expiration, 1760000000 + 4 * 3600)
  // Duree absurde : retombe sur 4 h.
  assert.equal(signerLecture('abc', -5, { config, maintenantMs }).expiration, 1760000000 + DUREE_LIEN_S)
  // Sans configuration : null (la route repond 503).
  assert.equal(signerLecture('abc', DUREE_LIEN_S, { config: null }), null)
})

bloc('configuration lue dans l environnement', () => {
  assert.equal(configBunny({}), null)
  assert.equal(configBunny({ BUNNY_STREAM_LIBRARY_ID: '777217' }), null)
  assert.equal(configBunny({ BUNNY_STREAM_TOKEN_KEY: 'x' }), null)
  assert.equal(configBunny({ BUNNY_STREAM_LIBRARY_ID: 'abc', BUNNY_STREAM_TOKEN_KEY: 'x' }), null)
  assert.deepEqual(
    configBunny({ BUNNY_STREAM_LIBRARY_ID: ' 777217 ', BUNNY_STREAM_TOKEN_KEY: ' x ' }),
    { libraryId: '777217', cle: 'x' },
  )
})

bloc('liste d essai', () => {
  assert.equal(VIDEOS_ESSAI.length, 2)
  assert.equal(videoEssai('b03789d3-f998-44ec-8c3c-5d8c5977008c')?.dureeMin, 36)
  assert.equal(videoEssai(' C4413EF9-44D5-4DF6-8387-B633E7882769 ')?.id, 'c4413ef9-44d5-4df6-8387-b633e7882769')
  assert.equal(videoEssai('00000000-0000-0000-0000-000000000000'), null)
  assert.equal(videoEssai('../../autre'), null)
  assert.equal(videoEssai(42), null)
  assert.equal(videoEssai(undefined), null)
})

console.log(`${blocs} blocs hors ligne passes.`)
if (horsLigne) process.exit(0)

// ---------- 2. En ligne, contre le lecteur Bunny ----------

const coffre = JSON.parse(readFileSync(cheminCoffre, 'utf8'))
const config = configBunny({
  BUNNY_STREAM_LIBRARY_ID: String(coffre.library_id ?? ''),
  BUNNY_STREAM_TOKEN_KEY: String(coffre.token_auth_key ?? ''),
})
assert.ok(config, 'library_id ou token_auth_key absent du coffre')

// Depuis le 15/10, la bibliotheque n'accepte que les domaines autorises : le
// lecteur est demande avec le Referer du site, comme l'iframe de la page.
// (scripts/verifier-academie.mjs verifie aussi le refus sans Referer.)
async function statut(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Referer: 'https://aoknowledge.com/' } })
  await res.arrayBuffer().catch(() => null)
  return res.status
}

let echecs = 0
function attendu(nom, obtenu, voulu) {
  const ok = obtenu === voulu
  if (!ok) echecs++
  console.log(`${ok ? 'ok ' : 'KO '} ${nom} : HTTP ${obtenu} (attendu ${voulu})`)
}

const base = `https://player.mediadelivery.net/embed/${config.libraryId}`
for (const v of VIDEOS_ESSAI) {
  const signe = signerLecture(v.id, DUREE_LIEN_S, { config })
  attendu(`${v.id} lien signe 4 h`, await statut(signe.url), 200)
  attendu(`${v.id} sans jeton`, await statut(`${base}/${v.id}`), 403)
  const expire = signerLecture(v.id, 60, { config, maintenantMs: Date.now() - 3600 * 1000 })
  attendu(`${v.id} jeton expire depuis 59 min`, await statut(expire.url), 403)
  const faux = lienLecture({ ...config, cle: 'pas-la-bonne-cle' }, v.id, signe.expiration)
  attendu(`${v.id} jeton signe avec une autre cle`, await statut(faux.url), 403)
}

if (echecs) {
  console.log(`${echecs} verification(s) en ligne en echec.`)
  process.exit(1)
}
console.log('Toutes les verifications en ligne passent.')
