/**
 * ESSAI de la migration 20261027190000_academie_billets.sql (le billet du jour de l'academie,
 * 27/10/2026) et des droits de la fenetre libre, contre la vraie base, dans UNE transaction TOUJOURS
 * ANNULEE (rien ne reste) :
 *   1. la migration (rejouee deux fois : rejouable) ;
 *   2. un billet « maintenant » cree par enregistrerBillet (le code de la route du cockpit) : lecon
 *      creee en brouillon dans la section Billets des Chroniques, publiee par publierBilletsEchus,
 *      pop-up inscrit dans cockpit_annonces_envoyees (canal popup-academie, cible membres connectes) ;
 *   3. les DROITS, lecon relue par SQL_LECON_PAR_ID et SQL_LECONS_VISIBLES (les requetes de la lecture
 *      et du catalogue), regle ouvertureLecon : compte gratuit (offres de base lues par SQL_ACCES) ouvert
 *      dans la fenetre, ferme quand la fenetre est passee (publie_le recule de 49 h) ; compte payant
 *      (module achete) ouvert dans les deux cas ;
 *   4. le billet du jour d'un compte : rendu, pop-up ferme (vu), idempotent ; plus rendu hors fenetre ;
 *   5. un billet programme : lecon en brouillon, absente du catalogue, pas publiee avant l'heure ;
 *      l'heure passee, il est publie et devient LE billet du jour (un seul a la fois) ;
 *   6. modifier : titre du pop-up inscrit suivi ; la date d'un billet publie refusee ; une lecon cachee
 *      depuis l'arbre n'est ni republiee ni montree en pop-up ;
 *   7. les contraintes (canal inconnu refuse, youtube_id mal forme, deux billets sur une lecon).
 * Puis la transaction est annulee, et on verifie hors transaction que rien n'est reste.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/essayer-migration-billets.mjs
 * N'affiche aucun email ni aucune cle.
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  enregistrerBillet, lireBilletDuJour, lireSaisieBillet, listerBillets, noterBilletVu, publierBilletsEchus,
} from '../src/lib/academie/billets.ts'
import { FENETRE_LIBRE_BILLET_H, ouvertureLecon, preparerDroits } from '../src/lib/academie/pur.ts'
import { SQL_ACCES, SQL_LECON_PAR_ID, SQL_LECONS_VISIBLES } from '../src/lib/academie/requetes.ts'

const MIGRATION = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261027190000_academie_billets.sql', import.meta.url)

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

class Annulation extends Error {}
let etapes = 0
const ok = (nom) => { etapes++; console.log(`ok  ${nom}`) }
const prisma = new PrismaClient()

async function doitEchouer(tx, nom, sql, ...params) {
  await tx.$executeRawUnsafe('savepoint essai')
  let erreur = null
  try { await tx.$executeRawUnsafe(sql, ...params) } catch (err) { erreur = err }
  await tx.$executeRawUnsafe('rollback to savepoint essai')
  assert.ok(erreur, `${nom} : l'ordre aurait du etre refuse`)
  const code = /\b(23\d{3})\b/.exec(String(erreur.message ?? erreur))?.[1] ?? 'refuse'
  ok(`${nom} : refuse (${code})`)
}

const tableBillets = async (c) => (await c.$queryRawUnsafe(
  `select (to_regclass('public.academie_billets') is not null) as a, (to_regclass('public.academie_billets_vus') is not null) as b`))[0]

const avant = await tableBillets(prisma)
if (avant.a || avant.b) {
  console.log('La migration des billets est DEJA appliquee : l essai joue alors sur les tables en place (rien ne reste non plus).')
}
const annoncesAvant = (await prisma.$queryRawUnsafe(`select count(*)::int as n from public.cockpit_annonces_envoyees`))[0].n

const BRICE = randomUUID()
const ELEVE = randomUUID()
const H = 3600 * 1000
const FENETRE_MS = FENETRE_LIBRE_BILLET_H * H

const lecon = async (tx, id) => {
  const [l] = await tx.$queryRawUnsafe(SQL_LECON_PAR_ID, id)
  return { moduleId: l.module_id, sectionId: l.section_id, usage: l.usage, apercu: l.apercu, billetPublieLe: l.billet_publie_le, statut: l.statut }
}
const droitsGratuit = async (tx) => {
  const lignes = (await tx.$queryRawUnsafe(SQL_ACCES, '00000000-0000-0000-0000-000000000000', [])).map(l => ({
    origine: l.origine, source: l.source, slug: l.slug, ouvreTout: l.ouvre_tout === true, moduleId: l.module_id, sectionId: l.section_id,
  }))
  return preparerDroits({ admin: false, etm: false, secoursEssai: false, liveClub: 'non', lignes })
}

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const t = await tableBillets(tx)
    assert.ok(t.a && t.b)
    ok(`migration jouee deux fois (${ordres.length} ordres) : tables academie_billets et academie_billets_vus`)

    // 2. Un billet « maintenant ».
    const maintenant = new Date((await tx.$queryRawUnsafe(`select now() as n`))[0].n)
    const s1 = lireSaisieBillet({ titre: 'Essai billet du jour', contenu: 'Le **texte** du billet.', video: 'https://youtu.be/dQw4w9WgXcQ' })
    const i1 = await enregistrerBillet(tx, BRICE, s1, maintenant)
    assert.equal(i1.issue, 'ok')
    let l1 = await lecon(tx, i1.leconId)
    assert.equal(l1.statut, 'brouillon')
    const [chro] = await tx.$queryRawUnsafe(`select m.slug, s.titre, l.slug as lecon_slug, l.type, l.ressources::text as r, l.usage
      from public.academie_lecons l join public.academie_modules m on m.id = l.module_id join public.academie_sections s on s.id = l.section_id where l.id = $1::uuid`, i1.leconId)
    assert.equal(chro.slug, 'chroniques-de-l-accelerateur')
    assert.equal(chro.titre, 'Billets')
    assert.equal(chro.type, 'texte')
    assert.match(chro.r, /youtube\.com\/watch\?v=dQw4w9WgXcQ/)
    assert.match(chro.lecon_slug, /^essai-billet-du-jour-\d{2}-\d{2}-\d{4}$/)
    ok(`billet cree : lecon en brouillon dans Chroniques > Billets (${chro.lecon_slug}), texte + lien YouTube en piece jointe`)

    assert.equal(await publierBilletsEchus(tx), 1)
    l1 = await lecon(tx, i1.leconId)
    assert.equal(l1.statut, 'publie')
    const annonces = await tx.$queryRawUnsafe(`select canal, cible, titre, lien, pose_par::text as pose_par from public.cockpit_annonces_envoyees where source = $1`, `billet:${i1.id}`)
    assert.equal(annonces.length, 1)
    assert.equal(annonces[0].canal, 'popup-academie')
    assert.equal(annonces[0].cible, 'membres connectés')
    assert.equal(annonces[0].pose_par, BRICE)
    assert.equal(annonces[0].lien, `https://aoknowledge.com/academie/chroniques-de-l-accelerateur/${chro.lecon_slug}`)
    assert.equal(await publierBilletsEchus(tx), 0)
    ok('publie a la lecture suivante : lecon publiee, pop-up inscrit une fois (canal popup-academie, cible membres connectes, lien de la lecon)')

    // 3. Les droits.
    const gratuit = await droitsGratuit(tx)
    const payant = preparerDroits({
      admin: false, etm: false, secoursEssai: false, liveClub: 'non',
      lignes: [{ origine: 'acces', source: 'stripe', slug: 'module-chroniques-de-l-accelerateur', ouvreTout: false, moduleId: l1.moduleId, sectionId: null }],
    })
    const nowMs = maintenant.getTime()
    assert.deepEqual(ouvertureLecon(gratuit, l1, nowMs + 60_000), { acces: 'ouvert', raisons: ['billet'] })
    assert.deepEqual(ouvertureLecon(payant, l1, nowMs + 60_000), { acces: 'ouvert', raisons: ['achat', 'billet'] })
    const visible = (await tx.$queryRawUnsafe(SQL_LECONS_VISIBLES)).find(l => l.id === i1.leconId)
    assert.ok(visible && visible.billet_publie_le)
    ok('fenetre OUVERTE : compte gratuit ouvert (raison billet), compte payant ouvert (achat) ; le catalogue porte la date du billet')

    await tx.$executeRawUnsafe(`update public.academie_billets set publie_le = now() - interval '49 hours' where id = $1::uuid`, i1.id)
    l1 = await lecon(tx, i1.leconId)
    assert.deepEqual(ouvertureLecon(gratuit, l1, nowMs + 60_000), { acces: 'ferme', raisons: [] })
    assert.deepEqual(ouvertureLecon(payant, l1, nowMs + 60_000), { acces: 'ouvert', raisons: ['achat'] })
    const autre = (await tx.$queryRawUnsafe(SQL_LECONS_VISIBLES)).find(l => l.section_id === l1.sectionId && l.id !== i1.leconId)
    assert.deepEqual(ouvertureLecon(gratuit, { moduleId: autre.module_id, sectionId: autre.section_id, usage: autre.usage, apercu: autre.apercu, billetPublieLe: autre.billet_publie_le }, nowMs),
      { acces: 'ferme', raisons: [] })
    ok('fenetre FERMEE (49 h) : compte gratuit ferme, compte payant ouvert ; un ancien billet importe reste ferme au compte gratuit')

    // 4. Le billet du jour d'un compte.
    assert.equal(await lireBilletDuJour(tx, ELEVE, FENETRE_LIBRE_BILLET_H), null)
    await tx.$executeRawUnsafe(`update public.academie_billets set publie_le = now() - interval '1 hour' where id = $1::uuid`, i1.id)
    let bj = await lireBilletDuJour(tx, ELEVE, FENETRE_LIBRE_BILLET_H)
    assert.equal(bj.id, i1.id)
    assert.equal(bj.vu, false)
    assert.equal(bj.youtube_id, 'dQw4w9WgXcQ')
    assert.equal(await noterBilletVu(tx, i1.id, ELEVE), true)
    assert.equal(await noterBilletVu(tx, i1.id, ELEVE), true)
    assert.equal(await noterBilletVu(tx, randomUUID(), ELEVE), false)
    bj = await lireBilletDuJour(tx, ELEVE, FENETRE_LIBRE_BILLET_H)
    assert.equal(bj.vu, true)
    assert.equal((await lireBilletDuJour(tx, randomUUID(), FENETRE_LIBRE_BILLET_H)).vu, false)
    ok('billet du jour : rendu au compte, pop-up ferme = vu pour CE compte seulement, idempotent ; aucun hors fenetre')

    // 5. Un billet programme.
    const dans2h = new Date(nowMs + 2 * H)
    const i2 = await enregistrerBillet(tx, BRICE, lireSaisieBillet({ titre: 'Essai programme', contenu: 'Plus tard.', publie_le: dans2h.toISOString(), video: '0d8f1b2c-3a4b-4c5d-8e6f-7a8b9c0d1e2f' }), maintenant)
    assert.equal(i2.issue, 'ok')
    assert.equal(await publierBilletsEchus(tx), 0)
    assert.equal((await lecon(tx, i2.leconId)).statut, 'brouillon')
    assert.ok(!(await tx.$queryRawUnsafe(SQL_LECONS_VISIBLES)).some(l => l.id === i2.leconId))
    assert.equal((await lireBilletDuJour(tx, ELEVE, FENETRE_LIBRE_BILLET_H)).id, i1.id)
    const [v2] = await tx.$queryRawUnsafe(`select type, hebergeur, bunny_bibliotheque from public.academie_lecons where id = $1::uuid`, i2.leconId)
    assert.deepEqual(v2, { type: 'video', hebergeur: 'bunny', bunny_bibliotheque: 'formation' })
    await tx.$executeRawUnsafe(`update public.academie_billets set publie_le = now() - interval '1 minute' where id = $1::uuid`, i2.id)
    assert.equal(await publierBilletsEchus(tx), 1)
    assert.equal((await lecon(tx, i2.leconId)).statut, 'publie')
    assert.equal((await lireBilletDuJour(tx, ELEVE, FENETRE_LIBRE_BILLET_H)).id, i2.id)
    ok('billet programme : brouillon, hors catalogue, pas publie avant l heure ; l heure passee, publie et seul billet du jour (le plus recent)')

    // 6. Modifier.
    const i3 = await enregistrerBillet(tx, BRICE, { ...lireSaisieBillet({ titre: 'Essai billet, titre corrige', contenu: 'Texte corrige.' }), id: i1.id }, maintenant)
    assert.equal(i3.issue, 'ok')
    const [a1] = await tx.$queryRawUnsafe(`select titre, contenu from public.cockpit_annonces_envoyees where source = $1`, `billet:${i1.id}`)
    assert.deepEqual(a1, { titre: 'Essai billet, titre corrige', contenu: 'Texte corrige.' })
    const h = await tx.$queryRawUnsafe(`select champ from public.academie_editions where cible_id = $1::uuid order by champ`, i1.leconId)
    assert.deepEqual(h.map(x => x.champ), ['contenu', 'titre'])
    const fige = await enregistrerBillet(tx, BRICE, { ...lireSaisieBillet({ titre: 'x', contenu: 'y', publie_le: new Date(nowMs + 5 * H).toISOString() }), id: i1.id }, maintenant)
    assert.equal(fige.issue, 'date_figee')
    ok('modifier : le pop-up inscrit suit le titre et le texte, historique dans academie_editions ; la date d un billet publie est figee')

    await tx.$executeRawUnsafe(`update public.academie_lecons set statut = 'brouillon' where id = $1::uuid`, i2.leconId)
    assert.equal(await publierBilletsEchus(tx), 0)
    assert.equal((await lecon(tx, i2.leconId)).statut, 'brouillon')
    assert.equal((await lireBilletDuJour(tx, ELEVE, FENETRE_LIBRE_BILLET_H)).id, i1.id)
    const liste = await listerBillets(tx, Date.now(), FENETRE_MS)
    const e = Object.fromEntries(liste.filter(b => b.id === i1.id || b.id === i2.id).map(b => [b.id, b.etat]))
    assert.deepEqual(e, { [i1.id]: 'fenetre', [i2.id]: 'cache' })
    assert.equal(liste.find(b => b.id === i1.id).vus, 1)
    ok('lecon cachee depuis l arbre : ni republiee, ni en pop-up (le billet precedent reprend) ; liste du cockpit : fenetre, cache, 1 vu')

    // 7. Contraintes.
    await doitEchouer(tx, 'canal inconnu dans cockpit_annonces_envoyees',
      `insert into public.cockpit_annonces_envoyees (canal, titre) values ('pigeon', 'x')`)
    await doitEchouer(tx, 'youtube_id mal forme',
      `update public.academie_billets set youtube_id = 'court' where id = $1::uuid`, i1.id)
    await doitEchouer(tx, 'deux billets sur la meme lecon',
      `insert into public.academie_billets (lecon_id, publie_le) values ($1::uuid, now())`, i1.leconId)

    throw new Annulation()
  }, { timeout: 120_000, maxWait: 20_000 })
} catch (err) {
  if (!(err instanceof Annulation)) {
    console.error('\nECHEC (transaction annulee, rien n est reste) :', String(err?.message ?? err).split('\n').slice(-12).join('\n'))
    process.exitCode = 1
  }
}

try {
  const apres = await tableBillets(prisma)
  assert.deepEqual(apres, avant)
  const [{ n }] = await prisma.$queryRawUnsafe(`select count(*)::int as n from public.cockpit_annonces_envoyees`)
  assert.equal(n, annoncesAvant)
  const [{ m }] = await prisma.$queryRawUnsafe(`select count(*)::int as m from public.academie_lecons where slug like 'essai-billet%' or slug like 'essai-programme%'`)
  assert.equal(m, 0)
  console.log(`\nTransaction ANNULEE : tables comme avant, ni lecon ni annonce d essai en base (verifie apres coup). ${etapes} etapes.`)
} catch (err) {
  console.error('ATTENTION : verification apres annulation en echec :', String(err?.message ?? err))
  process.exitCode = 1
}
await prisma.$disconnect()
