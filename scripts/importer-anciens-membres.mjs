/**
 * IMPORT des anciens membres dans aok_anciens_membres (09/11/2026), APRES la
 * validation de Brice et APRES la migration 20261109234500_anciens_membres_numeros.sql.
 *
 * Entree : la liste produite par lister-anciens-membres.mjs
 * (liste-anciens-membres.json), regeneree avec decisions-brice.json, qui doit
 * porter "valide_le" : sans validation de Brice, ce script refuse d'ecrire.
 *
 * Ce qu'il fait, dans UNE transaction :
 *   1. verifie que la migration est en place et que la table est vide (ou
 *      porte deja exactement ces lignes : rejouable) ;
 *   2. insere les reservations : les anciens numerotes (21 et suivants) et
 *      l'equipe a qui Brice a donne un numero de 5 a 20. Les comptes Telegram
 *      (tg_ids) sont relus dans l'ontologie au moment de l'import ;
 *   3. passe chaque compte existant hors equipe a aok_anciens_activer :
 *      activation sur un identifiant fort, proposition sur le nom ;
 *   4. avec --compacter seulement : aok_numeros_renumeroter(), pour refermer
 *      les trous laisses dans 301 et + par les comptes actives. A ne faire que
 *      le jour de la migration, avant que les membres voient leur nouveau
 *      numero (la fonction refuse de toute facon si un profil est public).
 *
 * Par defaut : ESSAI A BLANC (lecture, rien d'ecrit, la transaction est
 * annulee). --ecrire pour valider la transaction.
 *
 *   node --env-file=.env.local scripts/importer-anciens-membres.mjs [--fichier <json>] [--ecrire] [--compacter]
 *
 * Aucun email affiche.
 */

import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const args = process.argv.slice(2)
const val = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const FICHIER = val('--fichier', '/mnt/d/6_Societe/Pilotage/Academie/anciens-membres/liste-anciens-membres.json')
const ECRIRE = args.includes('--ecrire')
const COMPACTER = args.includes('--compacter')

const liste = JSON.parse(readFileSync(FICHIER, 'utf8'))
const lignes = [
  ...liste.anciens.map(l => ({ ...l, equipe: false })),
  ...liste.equipe.filter(l => l.numero != null && l.numero >= 5 && l.numero <= 20).map(l => ({ ...l, equipe: true })),
]

// --- Controles sur le fichier, avant toute connexion ---------------------------
const erreurs = []
if (!liste.valide_le) erreurs.push('la liste ne porte pas "valide_le" : Brice ne l a pas validee (decisions-brice.json), rien ne sera ecrit')
const vus = new Set()
for (const l of lignes) {
  if (vus.has(l.numero)) erreurs.push(`numero en double : ${l.numero}`)
  vus.add(l.numero)
  if (!l.equipe && !(l.numero >= 21 && l.numero <= 300)) erreurs.push(`numero hors de 21-300 : ${l.numero}`)
  if (!l.equipe && !['izitrade', 'learnybox'].includes(l.epoque)) erreurs.push(`epoque manquante : ${l.numero}`)
  if (!l.nom || !String(l.nom).trim()) erreurs.push(`nom vide : ${l.numero}`)
}
const ids = lignes.map(l => l.personne_id)
if (new Set(ids).size !== ids.length) erreurs.push('une personne apparait deux fois')
console.log(`${FICHIER}\n${lignes.length} reservations (${liste.anciens.length} anciens, ${lignes.length - liste.anciens.length} equipe), liste du ${liste.genere_le?.slice(0, 10)}, validee le ${liste.valide_le ?? 'JAMAIS'}`)
if (erreurs.length && ECRIRE) {
  for (const e of erreurs) console.error(`  - ${e}`)
  console.error('Refus : rien ecrit.')
  process.exit(1)
}
for (const e of erreurs) console.log(`  attention : ${e}`)

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
try {
  await prisma.$transaction(async tx => {
    if (!ECRIRE) await tx.$executeRawUnsafe(`set transaction read only`)
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    const q = (s, ...p) => tx.$queryRawUnsafe(s, ...p)

    const enPlace = (await q(`select to_regclass('public.aok_anciens_membres') is not null as t,
        to_regprocedure('public.aok_anciens_activer(uuid)') is not null as f`))[0]
    if (!enPlace.t || !enPlace.f) {
      console.log('La migration 20261109234500 n est pas appliquee : essai a blanc arrete ici (rien a lire de plus).')
      throw new Annulation()
    }
    const deja = await q(`select numero::int as numero, personne_id from public.aok_anciens_membres order by numero`)
    if (deja.length) {
      const memes = deja.length === lignes.length && deja.every(d => lignes.some(l => l.numero === d.numero && l.personne_id === d.personne_id))
      if (!memes) throw new Error(`la table porte deja ${deja.length} ligne(s) differente(s) de la liste : refus`)
      console.log(`deja importe (${deja.length} lignes identiques) : on ne reinsere rien`)
    } else if (ECRIRE) {
      for (const l of lignes) {
        await tx.$executeRawUnsafe(`insert into public.aok_anciens_membres (numero, equipe, personne_id, nom, telegram, tg_ids, epoque, premiere_activite)
          values ($1::bigint, $2, $3, $4, $5,
                  coalesce((select p.tg_ids from public.cockpit_arch_personnes p where p.personne_id = $3), '{}'::text[]),
                  $6, $7::date)`,
          l.numero, l.equipe, l.personne_id, String(l.nom).trim().slice(0, 120), l.telegram ?? null,
          l.equipe ? (l.epoque ?? null) : l.epoque, l.premiere_activite ?? null)
      }
      console.log(`insere : ${lignes.length} reservations`)
    } else {
      console.log(`essai a blanc : ${lignes.length} reservations seraient inserees`)
    }

    if (ECRIRE) {
      const res = await q(`select p.client_number::int as avant, public.aok_anciens_activer(p.id) as r
          from public.profiles p where p.role::text <> 'admin' order by p.created_at`)
      const actives = res.filter(x => x.r?.active != null)
      const props = res.reduce((s, x) => s + Number(x.r?.propositions ?? 0), 0)
      console.log(`comptes existants : ${res.length} relus, ${actives.length} active(s) (${actives.map(x => `${x.avant} -> ${x.r.active}`).join(', ') || 'aucun'}), ${props} proposition(s) a confirmer dans le cockpit`)
      if (COMPACTER) {
        const n = (await q(`select public.aok_numeros_renumeroter() as n`))[0].n
        console.log(`compactage : ${n} compte(s) renumerote(s) dans 301 et +`)
      }
      const seq = (await q(`select last_value::int as v from public.member_number_seq`))[0].v
      console.log(`sequence : prochain inscrit ${seq + 1}`)
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
