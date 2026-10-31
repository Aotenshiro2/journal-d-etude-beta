// BASCULE (b) : les newsletters du samedi deja programmees (S46 a S50,
// BROADCASTS_SAMEDI) passent de « tous les abonnes » au tag du choix
// « newsletter du samedi » (CLE_NEWSLETTER_HEBDO dans src/lib/kit-choix.ts),
// en meme temps que le rattrapage (kit-bascule-rattrapage.mjs).
//
// Pieges connus de Kit (memoire reference_kit-api-programmer-newsletters) :
// modifier un broadcast programme peut le repasser en brouillon (on repose
// alors son send_at, puis on relit) ; jamais de send_at passe (un broadcast
// qui part dans moins de 30 min n'est pas touche).
//
// Idempotent : un broadcast qui vise deja le tag n'est pas retouche. ESSAI par
// defaut (lecture seule).
//
//   node scripts/kit-bascule-broadcasts.mjs              # essai
//   node scripts/kit-bascule-broadcasts.mjs --appliquer  # sur GO de Brice

import {
  APPLIQUER, BROADCASTS_SAMEDI, CHOIX_KIT, CLE_NEWSLETTER_HEBDO, MODE,
  dansLeFutur, exiger, filtreTag, kit, ligne, nombreAppels, resumeFiltre, vise,
} from './kit-bascule-commun.mjs'

const TAG = CHOIX_KIT.find(c => c.cle === CLE_NEWSLETTER_HEBDO)?.tag
if (!TAG) { console.error(`ARRET : aucun choix ${CLE_NEWSLETTER_HEBDO} dans kit-choix.ts`); process.exit(1) }

console.log(`Reciblage des samedis sur le tag ${TAG} : ${MODE}\n`)

const lire = async id => (await exiger(`/broadcasts/${id}`))?.broadcast ?? {}
const memeDate = (a, b) => !!a && !!b && Date.parse(a) === Date.parse(b)
const etat = b => `${b.status ?? '?'}, send_at ${b.send_at ?? 'vide'}`

let aFaire = 0, faits = 0, deja = 0, bloques = 0
for (const { nom, id } of BROADCASTS_SAMEDI) {
  const b = await lire(id)
  const avant = { send_at: b.send_at, status: b.status }
  ligne(nom, id, `« ${b.description ?? ''} »`, etat(b), `filtre : ${resumeFiltre(b.subscriber_filter)}`)

  if (vise(b.subscriber_filter, TAG) && b.status === 'scheduled') { deja++; ligne('   deja cible : rien a faire'); continue }
  if (b.status !== 'scheduled') { bloques++; ligne(`   BLOQUE : statut ${b.status ?? '?'}, pas « scheduled »`); continue }
  if (!dansLeFutur(b.send_at, 30)) { bloques++; ligne('   BLOQUE : part dans moins de 30 min (ou deja parti)'); continue }
  aFaire++
  if (!APPLIQUER) { ligne(`   a recibler sur le tag ${TAG}, send_at garde`); continue }

  const r = await kit(`/broadcasts/${id}`, { method: 'PUT', body: JSON.stringify({ subscriber_filter: filtreTag(TAG), send_at: avant.send_at }) })
  if (r.statut < 200 || r.statut >= 300) { bloques++; ligne(`   ECHEC du PUT : ${r.statut}`); continue }
  let apres = await lire(id)
  if (apres.status !== 'scheduled' || !memeDate(apres.send_at, avant.send_at)) {
    // Repasse en brouillon : on repose le send_at d'origine (toujours dans le futur, verifie plus haut).
    await exiger(`/broadcasts/${id}`, { method: 'PUT', body: JSON.stringify({ send_at: avant.send_at }) })
    apres = await lire(id)
  }
  const bon = vise(apres.subscriber_filter, TAG) && apres.status === 'scheduled' && memeDate(apres.send_at, avant.send_at)
  if (bon) faits++
  else bloques++
  ligne(`   ${bon ? 'OK' : 'A VERIFIER A LA MAIN'} : ${etat(apres)}, filtre : ${resumeFiltre(apres.subscriber_filter)}`)
}

console.log(`\n${APPLIQUER ? `recibles ${faits}` : `a recibler ${aFaire}`}, deja cibles ${deja}, bloques ${bloques}. ${nombreAppels()} appels.`)
if (!APPLIQUER) console.log('ESSAI : rien n\'est ecrit.')
process.exit(bloques ? 1 : 0)
