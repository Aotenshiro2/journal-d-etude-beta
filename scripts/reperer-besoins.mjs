// La PASSE DE REPERAGE des besoins des membres (lot 1, 06/11/2026), lancee a la
// main : la meme fonction que POST /api/cockpit/besoins/reperer
// (repererBesoinsServeur, src/lib/besoins/serveur.ts), sans le cockpit.
//
// ESSAI PAR DEFAUT : lit et classe, n'ecrit ni carte, ni demande, ni curseur, ni
// journal des passes (la depense IA est tracee dans AiUsage, par = 'script').
// --ecrire pour enregistrer (il faut la migration 20261106120000). --tout
// enchaine les paquets jusqu'au bout (suite -> apres). --max N fils par paquet
// (16 par defaut, 40 au plus).
// LIT LES VRAIS FILS DES MEMBRES : a lancer seulement avec l'accord de Brice.
// Affiche les besoins (mots du membre compris) : la sortie reste sur la machine.
//
// Cle du support : ANTHROPIC_API_KEY_SUPPORT, sinon le coffre
// (anthropic-support-chatbot.local.json). Jamais affichee.
// Lancement (Node 22, depuis apps/journal-d-etude, .env.local charge) :
//   node --env-file=.env.local scripts/reperer-besoins.mjs [--tout] [--max 16] [--ecrire] [--json sortie.json]

import './resoudre-ts.mjs'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const arg = nom => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null }
const ecrire = args.includes('--ecrire')
const tout = args.includes('--tout')
const max = Number(arg('--max')) || undefined
const sortie = arg('--json')

const COFFRE = process.env.COFFRE_CLES || '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local'
if (!process.env.ANTHROPIC_API_KEY_SUPPORT?.trim()) {
  const p = path.join(COFFRE, 'anthropic-support-chatbot.local.json')
  const cle = existsSync(p) ? (() => { try { return JSON.parse(readFileSync(p, 'utf8')).api_key?.trim() } catch { return null } })() : null
  if (!cle) {
    console.error('Cle absente (ni ANTHROPIC_API_KEY_SUPPORT, ni le fichier du coffre).')
    process.exit(1)
  }
  process.env.ANTHROPIC_API_KEY_SUPPORT = cle
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL absente : lancer avec --env-file=.env.local.')
  process.exit(1)
}

const { lireCorpsReperage } = await import('../src/lib/besoins/pur.ts')
const { repererBesoinsServeur } = await import('../src/lib/besoins/serveur.ts')
const { prisma } = await import('../src/lib/db.ts')

const corps = lireCorpsReperage({ essai: !ecrire, ...(max ? { max } : {}) })
const tous = []
let apres = null
let total = { fils: 0, appels: 0, micros: 0, demandes: 0, cartes: 0, suspects: 0, erreurs: 0 }
let code = 0
try {
  do {
    const r = await repererBesoinsServeur({ ...corps, apres, par: 'script', budgetMs: 40_000 })
    tous.push(...r.besoins)
    total = {
      fils: total.fils + r.fils_lus, appels: total.appels + r.appels_ia, micros: total.micros + r.cout_micros,
      demandes: total.demandes + r.demandes_creees, cartes: total.cartes + r.cartes_creees, suspects: total.suspects + r.suspects, erreurs: total.erreurs + r.erreurs,
    }
    console.log(`[paquet] ${r.fils_lus} fil(s), ${r.besoins.length} besoin(s), ${r.erreurs} erreur(s), restants ${r.restants}${r.sans_tables ? ' (sans tables : sans curseur ni carte)' : ''}`)
    if (!r.suite || (r.fils_lus === 0 && !r.coupe)) break
    apres = r.suite
    if (r.restants === 0) break
  } while (tout)
} catch (err) {
  console.error(`Passe en echec : ${err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : err}`)
  code = 1
}

for (const b of tous) {
  console.log(`\n- ${b.carte.cle}${b.carte.nouvelle ? ' (nouvelle)' : ''} [${b.outil}/${b.nature}] « ${b.titre} »${b.suspect ? ` SUSPECT (${b.suspect_raison})` : ''}${b.deja ? ' (deja compte)' : ''}`)
  console.log(`  fil ${b.fil_id} (${b.app}) : ${b.texte_membre.replace(/\s+/g, ' ').slice(0, 300)}`)
}
console.log(`\n${ecrire ? 'ECRIT' : 'ESSAI (rien d ecrit)'} : ${total.fils} fil(s) lus, ${tous.length} besoin(s), ${total.cartes} carte(s) ${ecrire ? 'creees' : 'prevues'}, `
  + `${total.demandes} demande(s) creees, ${total.suspects} suspect(s), ${total.erreurs} erreur(s), ${total.appels} appel(s) du modele, ${(total.micros / 1e6).toFixed(4)} EUR`)
if (sortie) writeFileSync(sortie, JSON.stringify({ total, besoins: tous }, null, 2))
await prisma.$disconnect()
process.exit(code)
