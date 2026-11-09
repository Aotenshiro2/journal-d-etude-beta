/**
 * IMPORT des anciens membres (09/11/2026, revu le 10/11), APRES la validation
 * de Brice et APRES les migrations 20261109234500_anciens_membres_numeros.sql
 * (version du 10/11) et 20261110010000_cockpit_parcours_anciens.sql.
 *
 * Entree : la liste produite par lister-anciens-membres.mjs
 * (liste-anciens-membres.json), regeneree avec decisions-brice.json (lu a cote
 * de la liste), qui doit porter "valide_le" ET un "a_trancher" vide : sinon ce
 * script refuse d'ecrire.
 *
 * Ce qu'il fait, dans UNE transaction (lock_timeout 5 s), par
 * lib-importer-anciens.mjs (le meme code que l'essai annule) :
 *   1. les reservations : les anciens (30 et suivants, sans trou) et l'equipe a
 *      qui Brice a donne un numero de 5 a 20 (pas ceux dont le compte garde son
 *      numero : Melanie 2, Adil 3, Adrien 4). Refus si la table porte d'autres
 *      lignes, ou si un compte porte deja un numero reserve. Les comptes
 *      Telegram (tg_ids) sont relus dans l'ontologie ;
 *   2. les corrections dites par Brice : « Marlon Wricka » (nom et alias dans
 *      cockpit_arch_personnes, note d'identite dans cockpit_arch_notes) ;
 *   3. les reglages des droits (cockpit_parcours_reglages) : sans_droits,
 *      droits dits par Brice (« 10% Club » -> formation-complete, « VIP » ->
 *      vip-skool, « Live Club » -> live-club), sa note ;
 *   4. les ETM documentes (cockpit_parcours, source registre) SEULEMENT si
 *      "etm_valide_le" est pose dans decisions-brice.json ;
 *   5. chaque compte existant hors equipe passe par aok_anciens_activer :
 *      activation sur un identifiant fort, proposition sur le nom ;
 *   6. aok_numeros_renumeroter() : les comptes restants hors equipe prennent
 *      les numeros juste apres le dernier ancien, dans l'ordre d'inscription,
 *      et la sequence est recreee pour repartir apres eux. A faire AVANT que
 *      les membres voient leur numero : la fonction refuse si un profil est
 *      public.
 *
 * Par defaut : ESSAI A BLANC (lecture, rien d'ecrit, la transaction est
 * annulee). --ecrire pour valider la transaction (go de Brice).
 *
 *   node --env-file=.env.local scripts/importer-anciens-membres.mjs [--fichier <json>] [--ecrire]
 *
 * Aucun email affiche.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { appliquer, preparer } from './lib-importer-anciens.mjs'

const args = process.argv.slice(2)
const val = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const FICHIER = val('--fichier', '/mnt/d/6_Societe/Pilotage/Academie/anciens-membres/liste-anciens-membres.json')
const ECRIRE = args.includes('--ecrire')
if (args.includes('--compacter')) {
  console.error('--compacter n existe plus (10/11/2026) : la renumerotation fait partie de l import.')
  process.exit(1)
}

const liste = JSON.parse(readFileSync(FICHIER, 'utf8'))
const FICHIER_DECISIONS = join(dirname(FICHIER), 'decisions-brice.json')
const decisions = existsSync(FICHIER_DECISIONS) ? JSON.parse(readFileSync(FICHIER_DECISIONS, 'utf8')) : {}
const prep = preparer(liste, decisions)

console.log(`${FICHIER}\n${prep.reservations.length} reservations (${prep.anciens.nombre} anciens, n° ${prep.anciens.premier} a ${prep.anciens.dernier}, ${prep.reservations.length - prep.anciens.nombre} equipe), liste du ${liste.genere_le?.slice(0, 10)}, validee le ${liste.valide_le ?? 'JAMAIS'}`)
console.log(`${prep.reglages.length} reglage(s) de droits, ${prep.etm.length} ETM documente(s) ${prep.etmValideLe ? `(valides le ${prep.etmValideLe})` : '(EN ATTENTE de "etm_valide_le" : pas poses)'}, ${prep.corrections.length} correction(s) de nom`)
if (prep.erreurs.length && ECRIRE) {
  for (const e of prep.erreurs) console.error(`  - ${e}`)
  console.error('Refus : rien ecrit.')
  process.exit(1)
}
for (const e of prep.erreurs) console.log(`  attention : ${e}`)

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
try {
  await prisma.$transaction(async tx => {
    if (!ECRIRE) await tx.$executeRawUnsafe(`set transaction read only`)
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    const enPlace = (await tx.$queryRawUnsafe(`select to_regclass('public.aok_anciens_membres') is not null as t,
        to_regclass('public.cockpit_parcours_reglages') is not null as p,
        (select pg_get_function_result(to_regprocedure('public.aok_numeros_renumeroter()'))) as r`))[0]
    if (!enPlace.t || !enPlace.p || enPlace.r !== 'jsonb') {
      console.log('Les migrations 20261109234500 (version du 10/11) et 20261110010000 ne sont pas appliquees : essai a blanc arrete ici (rien a lire de plus).')
      throw new Annulation()
    }
    await appliquer(tx, prep, { ecrire: ECRIRE, log: m => console.log(m) })
    if (ECRIRE) {
      const seq = (await tx.$queryRawUnsafe(`select last_value::int as v, is_called from public.member_number_seq`))[0]
      console.log(`sequence : prochain inscrit ${seq.is_called ? seq.v + 1 : seq.v}`)
    }
    if (!ECRIRE) throw new Annulation()
  }, { timeout: 120000, maxWait: 20000 })
  console.log(ECRIRE ? 'Ecrit.' : 'Essai a blanc : rien ecrit.')
} catch (e) {
  if (!(e instanceof Annulation)) { console.error('ECHEC, rien ecrit :', String(e?.message ?? e).split('\n').slice(-3).join(' ')); process.exitCode = 1 }
  else console.log('Essai a blanc : rien ecrit.')
} finally {
  await prisma.$disconnect()
}
