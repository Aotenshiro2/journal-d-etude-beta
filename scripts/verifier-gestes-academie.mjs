// Verification des gestes du cockpit sur l'academie (18/10/2026) : route
// /api/cockpit/academie (accorder / retirer un acces).
//
// 1. Hors ligne : lecture des corps de requete (src/lib/academie/
//    gestes-cockpit-pur.ts), dates, raisons, emails.
// 2. En base (sauf --hors-ligne), dans une transaction TOUJOURS ANNULEE :
//    SQL_GESTE_ACCORDER pose un acces offert sur un email de test, SQL_ACCES
//    (la requete de droitsAcademie) le rend bien comme 'acces' source
//    'offert' avec les contenus de l'offre, un deuxieme accord ne le double
//    pas, une offre inconnue ne pose rien, la fin tombe a minuit (Paris) du
//    lendemain du dernier jour, SQL_GESTE_RETIRER le retire (note gardee,
//    raison ajoutee), SQL_ACCES ne le rend plus, un deuxieme retrait ne
//    trouve rien. Rien n'est ecrit.
//
// Lancement (depuis apps/journal-d-etude) :
//   node scripts/verifier-gestes-academie.mjs --hors-ligne
//   set -a && . ./.env && set +a && node scripts/verifier-gestes-academie.mjs

import assert from 'node:assert/strict'
import {
  acteurCockpit, ajoutRetrait, jourParis, jourValide, lireGeste, noteAccorder, MAX_RAISON,
} from '../src/lib/academie/gestes-cockpit-pur.ts'
import { SQL_ACCES, SQL_GESTE_ACCORDER, SQL_GESTE_RETIRER } from '../src/lib/academie/requetes.ts'

const horsLigne = process.argv.includes('--hors-ligne')
let blocs = 0
function bloc(nom, fn) {
  fn()
  blocs++
  console.log(`ok  ${nom}`)
}

const AUJ = '2026-10-18'

bloc('jours civils', () => {
  assert.equal(jourValide('2026-10-18'), true)
  assert.equal(jourValide('2028-02-29'), true)
  assert.equal(jourValide('2026-02-29'), false)
  assert.equal(jourValide('2026-13-01'), false)
  assert.equal(jourValide('18/10/2026'), false)
  assert.equal(jourParis(new Date('2026-10-18T22:30:00Z')), '2026-10-19')
  assert.equal(jourParis(new Date('2026-10-18T21:30:00Z')), '2026-10-18')
})

bloc('accorder : corps valide, email en minuscules, fin facultative', () => {
  assert.deepEqual(
    lireGeste({ action: 'accorder', email: ' Eleve@Exemple.FR ', offre: 'module-journaling', raison: ' geste ' }, AUJ),
    { action: 'accorder', email: 'eleve@exemple.fr', offre: 'module-journaling', fin: null, raison: 'geste' },
  )
  const g = lireGeste({ action: 'accorder', email: 'a@b.fr', offre: 'formation-complete', fin: '2026-12-31', raison: 'x' }, AUJ)
  assert.equal(g.fin, '2026-12-31')
  assert.equal(lireGeste({ action: 'accorder', email: 'a@b.fr', offre: 'x', fin: '', raison: 'x' }, AUJ).fin, null)
  assert.equal(lireGeste({ action: 'accorder', email: 'a@b.fr', offre: 'x', fin: AUJ, raison: 'x' }, AUJ).fin, AUJ)
})

bloc('accorder : refus', () => {
  const base = { action: 'accorder', email: 'a@b.fr', offre: 'module-journaling', raison: 'x' }
  assert.ok('erreur' in lireGeste({ ...base, raison: '  ' }, AUJ))
  assert.ok('erreur' in lireGeste({ ...base, raison: 'r'.repeat(MAX_RAISON + 1) }, AUJ))
  assert.ok('erreur' in lireGeste({ ...base, email: 'pas-un-email' }, AUJ))
  assert.ok('erreur' in lireGeste({ ...base, offre: 'Module Journaling' }, AUJ))
  assert.ok('erreur' in lireGeste({ ...base, fin: '2026-10-17' }, AUJ))
  assert.ok('erreur' in lireGeste({ ...base, fin: '2026-02-30' }, AUJ))
  assert.ok('erreur' in lireGeste({ ...base, action: 'supprimer' }, AUJ))
  assert.ok('erreur' in lireGeste(null, AUJ))
})

bloc('retirer : corps valide et refus', () => {
  const id = '0F8FAD5B-D9CB-469F-A165-70867728950E'
  assert.deepEqual(lireGeste({ action: 'retirer', acces_id: id, raison: 'rembourse' }, AUJ),
    { action: 'retirer', accesId: id.toLowerCase(), raison: 'rembourse' })
  assert.ok('erreur' in lireGeste({ action: 'retirer', acces_id: 'abc', raison: 'x' }, AUJ))
  assert.ok('erreur' in lireGeste({ action: 'retirer', acces_id: id }, AUJ))
})

bloc('acteur et notes', () => {
  assert.equal(acteurCockpit('u1'), 'cockpit:u1')
  assert.equal(noteAccorder('n'.repeat(1200)).length, 1000)
  assert.equal(ajoutRetrait('rembourse'), 'Retrait : rembourse')
})

if (horsLigne) {
  console.log(`\n${blocs} blocs hors ligne : tout passe.`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// En base, dans une transaction annulee
// ---------------------------------------------------------------------------

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
const EMAIL = `verif-gestes-${Date.now()}@exemple.invalid`
const COMPTE = '00000000-0000-4000-8000-0000000000aa'
const ACTEUR = 'cockpit:00000000-0000-4000-8000-0000000000bb'

class Annuler extends Error {}

try {
  await prisma.$transaction(async (tx) => {
    const offre = (await tx.$queryRawUnsafe(
      `select o.slug, o.id::text as id, count(c.id)::int as n from public.academie_offres o
         left join public.academie_offre_contenus c on c.offre_id = o.id
        where o.type = 'module' group by o.id order by o.slug limit 1`))[0]
    assert.ok(offre, 'aucune offre de type module en base')

    const accesDuCompte = async () => (await tx.$queryRawUnsafe(SQL_ACCES, COMPTE, [EMAIL]))
      .filter((l) => l.origine === 'acces')

    assert.equal((await accesDuCompte()).length, 0)

    const [pose] = await tx.$queryRawUnsafe(SQL_GESTE_ACCORDER, EMAIL, offre.slug, '2026-12-31', ACTEUR, 'raison de test')
    assert.equal(pose.offre_connue, 1)
    assert.equal(pose.deja_id, null)
    assert.ok(pose.acces_id)
    assert.equal(new Date(pose.fin).toISOString(), '2026-12-31T23:00:00.000Z', 'fin = minuit de Paris apres le dernier jour')
    bloc('accorder : acces pose, fin a minuit (Paris)', () => {})

    const lignes = await accesDuCompte()
    assert.equal(lignes.length, offre.n, 'une ligne par contenu de l offre')
    assert.ok(lignes.every((l) => l.source === 'offert' && l.slug === offre.slug))
    bloc('droitsAcademie (SQL_ACCES) lit le geste du cockpit', () => {})

    const [deja] = await tx.$queryRawUnsafe(SQL_GESTE_ACCORDER, EMAIL, offre.slug, null, ACTEUR, 'encore')
    assert.equal(deja.deja_id, pose.acces_id)
    assert.equal(deja.acces_id, null)
    const [inconnue] = await tx.$queryRawUnsafe(SQL_GESTE_ACCORDER, EMAIL, 'offre-qui-n-existe-pas', null, ACTEUR, 'x')
    assert.equal(inconnue.offre_connue, 0)
    assert.equal(inconnue.acces_id, null)
    bloc('accorder : idempotent, offre inconnue sans effet', () => {})

    const retrait = await tx.$queryRawUnsafe(SQL_GESTE_RETIRER, pose.acces_id, ACTEUR, ajoutRetrait('fin du test'))
    assert.equal(retrait.length, 1)
    const [ligne] = await tx.$queryRawUnsafe(
      `select note, retire_par, retire_le is not null as retire from public.academie_acces where id = $1::uuid`, pose.acces_id)
    assert.equal(ligne.note, 'raison de test | Retrait : fin du test')
    assert.equal(ligne.retire_par, ACTEUR)
    assert.equal(ligne.retire, true)
    assert.equal((await accesDuCompte()).length, 0)
    assert.equal((await tx.$queryRawUnsafe(SQL_GESTE_RETIRER, pose.acces_id, ACTEUR, 'x')).length, 0)
    bloc('retirer : trace gardee, droits fermes, pas de double retrait', () => {})

    // Le meme geste sans fin : a vie.
    const [vie] = await tx.$queryRawUnsafe(SQL_GESTE_ACCORDER, EMAIL, offre.slug, null, ACTEUR, 'a vie')
    assert.ok(vie.acces_id)
    assert.equal(vie.fin, null)
    bloc('accorder sans fin : a vie', () => {})

    throw new Annuler()
  })
} catch (err) {
  if (!(err instanceof Annuler)) {
    console.error(err)
    process.exitCode = 1
  }
} finally {
  await prisma.$disconnect()
}

if (!process.exitCode) console.log(`\n${blocs} blocs : tout passe (transaction annulee, rien n'est ecrit).`)
