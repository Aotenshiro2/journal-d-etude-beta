/**
 * ESSAI de la migration 20261031120000_pilotage_offres.sql (les offres de
 * Pilotage, brief E1, 30/10/2026) et des requetes EXACTES des abonnements
 * (src/lib/pilotage-requetes.ts), contre la vraie base, dans UNE transaction
 * TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable) : quatre offres abonnement
 *      dans academie_offres, deux cases cockpit_offres ;
 *   2. SQL_PRIX : les quatre offres, prix vides tant que le script Stripe n'a
 *      pas tourne ;
 *   3. SQL_POSER_ABONNEMENT : un abonnement pose (cree), reecrit (meme ligne,
 *      offre changee pour le Duo, fin avancee, paiement garde) ;
 *   4. SQL_ABONNEMENTS_DU_MEMBRE par compte et par email verifie ; la requete
 *      du Duo d'entitlements.ts (recopiee) ;
 *   5. SQL_FERMER_ABONNEMENT (impaye) puis reouverture ; SQL_RETIRER_ABONNEMENT
 *      (termine) : la ligne retiree ne se rouvre plus.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/essayer-migration-pilotage.mjs
 * N'affiche aucun email ni aucune cle (donnees de test en exemple.invalid).
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import * as R from '../src/lib/pilotage-requetes.ts'
import { SLUGS_OFFRES_PILOTAGE } from '../src/lib/pilotage-paliers.ts'

const MIGRATION = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261031120000_pilotage_offres.sql', import.meta.url)

// --- Decoupage : copie de appliquer-migration.mjs -------------------------
function decouper(sql) {
  const ordres = []
  let courant = ''
  let tag = null
  let i = 0
  while (i < sql.length) {
    if (!tag) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (dollar) { tag = dollar[0]; courant += tag; i += tag.length; continue }
      if (sql[i] === ';') { if (courant.trim()) ordres.push(courant.trim()); courant = ''; i += 1; continue }
    } else if (sql.startsWith(tag, i)) {
      courant += tag; i += tag.length; tag = null; continue
    }
    courant += sql[i]
    i += 1
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}
const ordres = decouper(readFileSync(MIGRATION, 'utf8')
  .split('\n')
  .filter((ligne) => !ligne.trim().startsWith('--'))
  .join('\n'))

// La requete du Duo d'entitlements.ts (gabarit $queryRaw la-bas), en parametres positionnels ici.
const SQL_DUO = `
select 1 as un
from academie_acces a
join academie_offres o on o.id = a.offre_id
where o.slug in ('premium-duo-mensuel', 'premium-duo-annuel')
  and a.retire_le is null and a.debut <= now() and (a.fin is null or a.fin > now())
  and (a.user_id = $1::uuid or a.email = $2)
limit 1
`

class Annulation extends Error {}
let etapes = 0
const ok = (nom) => { etapes++; console.log(`ok  ${nom}`) }
const prisma = new PrismaClient()

const compter = async (c) => (await c.$queryRawUnsafe(`
  select (select count(*)::int from public.academie_offres where slug = any($1::text[])) as offres,
         (select count(*)::int from public.cockpit_offres where offre_id in ('pilotage-premium', 'premium-duo')) as cockpit`,
  [...SLUGS_OFFRES_PILOTAGE]))[0]

const avant = await compter(prisma)
if (avant.offres || avant.cockpit) console.log('La migration est DEJA appliquee (au moins en partie) : l essai joue sur les lignes en place.')

const COMPTE = randomUUID()
const EMAIL = `essai-${COMPTE.slice(0, 8)}@exemple.invalid`
const SUB = `sub_essai${COMPTE.replace(/-/g, '').slice(0, 16)}`
const J = 24 * 3600 * 1000

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const n = await compter(tx)
    assert.equal(n.offres, 4)
    assert.equal(n.cockpit, 2)
    const types = await tx.$queryRawUnsafe(`select slug, type, canal, prix_eur::text as prix, cockpit_offre_id from public.academie_offres where slug = any($1::text[]) order by slug`, [...SLUGS_OFFRES_PILOTAGE])
    assert.ok(types.every(t => t.type === 'abonnement' && t.canal === 'stripe_aok'))
    assert.deepEqual(types.map(t => [t.slug, t.prix, t.cockpit_offre_id]), [
      ['pilotage-premium-annuel', '57.00', 'pilotage-premium'],
      ['pilotage-premium-mensuel', '5.99', 'pilotage-premium'],
      ['premium-duo-annuel', '79.00', 'premium-duo'],
      ['premium-duo-mensuel', '8.99', 'premium-duo'],
    ])
    ok(`migration jouee deux fois (${ordres.length} ordres) : 4 offres abonnement stripe_aok, 2 cases du cockpit`)

    const prix = await tx.$queryRawUnsafe(R.SQL_PRIX, [...SLUGS_OFFRES_PILOTAGE])
    assert.equal(prix.length, 4)
    ok(`SQL_PRIX : 4 offres, ${prix.filter(p => p.stripe_price_id).length} prix pose(s)`)

    const [t0] = await tx.$queryRawUnsafe(`select now() as n`)
    const maintenant = new Date(t0.n)
    const fin1 = new Date(maintenant.getTime() + 33 * J)
    let [r] = await tx.$queryRawUnsafe(R.SQL_POSER_ABONNEMENT, COMPTE, EMAIL, 'pilotage-premium-mensuel', SUB, 5.99, fin1, maintenant, 'essai', 'stripe:ch_essai000001')
    assert.deepEqual(r, { offre_connue: 1, cree: 1, ecrit: 1 })
    const fin2 = new Date(maintenant.getTime() + 63 * J)
    ;[r] = await tx.$queryRawUnsafe(R.SQL_POSER_ABONNEMENT, null, EMAIL, 'premium-duo-mensuel', SUB, 8.99, fin2, null, null, 'stripe:ch_essai000002')
    assert.deepEqual(r, { offre_connue: 1, cree: 0, ecrit: 1 })
    const [ligne] = await tx.$queryRawUnsafe(`select a.user_id::text as u, a.paiement_id, a.fin, a.cote, a.montant_eur::text as m, a.renonciation_retractation_le as ren, o.slug
      from public.academie_acces a join public.academie_offres o on o.id = a.offre_id where a.source = 'stripe' and a.reference = $1`, SUB)
    assert.equal(ligne.u, COMPTE)
    assert.equal(ligne.paiement_id, 'stripe:ch_essai000001')
    assert.equal(ligne.slug, 'premium-duo-mensuel')
    assert.equal(ligne.cote, 'brice')
    assert.equal(ligne.m, '8.99')
    assert.ok(ligne.ren)
    assert.equal(new Date(ligne.fin).getTime(), fin2.getTime())
    ;[r] = await tx.$queryRawUnsafe(R.SQL_POSER_ABONNEMENT, null, EMAIL, 'offre-qui-n-existe-pas', SUB, 1, fin2, null, null, null)
    assert.equal(r.offre_connue, 0)
    ok('SQL_POSER_ABONNEMENT : pose (cree), reecrit la meme ligne (offre Duo, fin avancee, compte, paiement et renonciation gardes, cote brice), offre inconnue dite')

    const slugs = [...SLUGS_OFFRES_PILOTAGE]
    const parCompte = await tx.$queryRawUnsafe(R.SQL_ABONNEMENTS_DU_MEMBRE, COMPTE, [], slugs)
    const parEmail = await tx.$queryRawUnsafe(R.SQL_ABONNEMENTS_DU_MEMBRE, randomUUID(), [EMAIL], slugs)
    const personne = await tx.$queryRawUnsafe(R.SQL_ABONNEMENTS_DU_MEMBRE, randomUUID(), ['autre@exemple.invalid'], slugs)
    assert.deepEqual(parCompte.map(l => [l.slug, l.reference]), [['premium-duo-mensuel', SUB]])
    assert.equal(parEmail.length, 1)
    assert.equal(personne.length, 0)
    assert.equal((await tx.$queryRawUnsafe(SQL_DUO, COMPTE, 'x@exemple.invalid')).length, 1)
    assert.equal((await tx.$queryRawUnsafe(SQL_DUO, randomUUID(), EMAIL)).length, 1)
    ok('SQL_ABONNEMENTS_DU_MEMBRE par compte et par email ; le Duo ouvre le Carnet (requete d entitlements)')

    // now() est fige dans la transaction : la ligne posee « maintenant » est vieillie d'un jour pour que fin = now() > debut.
    await tx.$executeRawUnsafe(`update public.academie_acces set debut = now() - interval '1 day' where source = 'stripe' and reference = $1`, SUB)
    assert.equal(await tx.$executeRawUnsafe(R.SQL_FERMER_ABONNEMENT, SUB), 1)
    assert.equal((await tx.$queryRawUnsafe(R.SQL_ABONNEMENTS_DU_MEMBRE, COMPTE, [], slugs)).length, 0)
    assert.equal((await tx.$queryRawUnsafe(SQL_DUO, COMPTE, EMAIL)).length, 0)
    ;[r] = await tx.$queryRawUnsafe(R.SQL_POSER_ABONNEMENT, null, EMAIL, 'premium-duo-mensuel', SUB, 8.99, fin2, null, null, null)
    assert.equal(r.ecrit, 1)
    assert.equal((await tx.$queryRawUnsafe(R.SQL_ABONNEMENTS_DU_MEMBRE, COMPTE, [], slugs)).length, 1)
    ok('SQL_FERMER_ABONNEMENT : droit ferme (impaye), puis rouvert par le paiement')

    const [ret] = await tx.$queryRawUnsafe(R.SQL_RETIRER_ABONNEMENT, SUB)
    assert.equal(ret.retires, 1)
    ;[r] = await tx.$queryRawUnsafe(R.SQL_POSER_ABONNEMENT, null, EMAIL, 'premium-duo-mensuel', SUB, 8.99, fin2, null, null, null)
    assert.deepEqual(r, { offre_connue: 1, cree: 0, ecrit: 0 })
    assert.equal((await tx.$queryRawUnsafe(R.SQL_ABONNEMENTS_DU_MEMBRE, COMPTE, [EMAIL], slugs)).length, 0)
    const [retire] = await tx.$queryRawUnsafe(`select retire_par, note from public.academie_acces where source = 'stripe' and reference = $1`, SUB)
    assert.equal(retire.retire_par, 'stripe:abonnement-termine')
    assert.match(retire.note, /Abonnement termine chez Stripe/)
    ok('SQL_RETIRER_ABONNEMENT : droit retire (retire_par, note), la ligne retiree ne se rouvre pas')

    throw new Annulation()
  }, { timeout: 30_000 })
} catch (err) {
  if (!(err instanceof Annulation)) throw err
}

const apres = await compter(prisma)
assert.deepEqual(apres, avant)
const reste = await prisma.$queryRawUnsafe(`select count(*)::int as n from public.academie_acces where reference = $1`, SUB)
assert.equal(reste[0].n, 0)
ok('transaction annulee : rien n est reste')
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
