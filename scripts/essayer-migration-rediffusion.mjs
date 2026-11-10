/**
 * ESSAI de la migration 20261111010000_academie_rediffusion_des_lives.sql (le module « Rediffusion des Lives »,
 * 11/11/2026) PUIS de l'import de son fichier (catalogue/modules/rediffusion-des-lives.json), contre la vraie base.
 * Rien n'est jamais valide : transaction TOUJOURS annulee, lock_timeout 5 s, chronometre du begin au rollback.
 *
 * Dans la transaction :
 *   1. AVANT : le module replays-live-club, ses sections, ses lecons (id, slug, section), la progression, le journal
 *      des lectures, les billets et les questions accroches a ses lecons, l'empreinte des AUTRES modules, et ce que
 *      chaque profil ouvre (regle du journal, pur.ts : preparerDroits puis ouvertureLecon) :
 *      gratuit, live-club, 10% Club (premium-skool, formation-complete), VIP (vip-skool), achat de l'offre du module.
 *   2. La migration, puis rejouee (elle ne refait que les colonnes).
 *   3. APRES LA MIGRATION : memes id de module et de lecons, memes slugs, rien de perdu (progression, lectures,
 *      billets, questions), autres modules identiques, et les MEMES ACCES pour chaque lecon et chaque profil
 *      (l'offre d'achat du module, que personne n'a, est montree a part).
 *   4. L'ancien fichier (replays-live-club.json) : refuse par l'import une fois le module renomme.
 *   5. L'IMPORT du nouveau fichier (importerModule, le meme code que --ecrire), puis rejoue (rien de cree).
 *   6. APRES L'IMPORT : les 90 lecons gardent leur id, les nouvelles sont creees, la progression est intacte, chaque
 *      lecon a sa date de live, et les acces suivent la regle de Brice du 05/11 partie par partie. Ce qui change pour
 *      les lecons deja en ligne est compte, profil par profil.
 * Hors transaction ensuite : le module s'appelle toujours replays-live-club (rien n'est reste).
 * Aucun nom, email ni identifiant de compte affiche : des comptages. La photo (comptages, slugs) va dans
 * catalogue/rediffusion-des-lives/essai-migration.json.
 *
 * Lancement (depuis apps/journal-d-etude, ou son worktree) :
 *   AOK_WORKSPACE=<racine du workspace> node --env-file=.env --env-file=.env.local scripts/essayer-migration-rediffusion.mjs
 *   MODULE_JSON=<chemin> pour un autre fichier (defaut : /mnt/d/.../catalogue/modules/rediffusion-des-lives.json)
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { importerModule } from './importer-catalogue-academie.mjs'
import { ouvertureLecon, preparerDroits } from '../src/lib/academie/pur.ts'

const DOSSIER = 'sites/Aoknowledgecom/supabase/migrations'
const MIGRATION = '20261111010000_academie_rediffusion_des_lives.sql'
const CATALOGUE = process.env.AOK_CATALOGUE || '/mnt/d/6_Societe/Pilotage/Academie/catalogue'
const MODULE_JSON = process.env.MODULE_JSON || `${CATALOGUE}/modules/rediffusion-des-lives.json`
const ANCIEN_JSON = `${CATALOGUE}/modules/replays-live-club.json`
const PHOTO = `${CATALOGUE}/rediffusion-des-lives/essai-migration.json`
const ANCIEN = 'replays-live-club'
const NOUVEAU = 'rediffusion-des-lives'

function fichier(nom) {
  const candidats = [
    process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${DOSSIER}/${nom}`) : null,
    new URL(`../../../${DOSSIER}/${nom}`, import.meta.url),
  ].filter(Boolean)
  const u = candidats.find(x => existsSync(x))
  if (!u) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${nom})`)
  return readFileSync(u, 'utf8')
}

/** Le decoupage de scripts/appliquer-migration.mjs : sur les points-virgules, blocs $...$ intacts. */
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
    } else if (sql.startsWith(tag, i)) { courant += tag; i += tag.length; tag = null; continue }
    courant += sql[i]
    i += 1
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}
const sansCommentaires = s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

const texte = fichier(MIGRATION)
for (const ligne of texte.split('\n').filter(l => l.trim().startsWith('--'))) {
  assert.ok(!ligne.includes(';'), `point-virgule dans un commentaire : ${ligne.trim()}`)
}
for (const m of texte.matchAll(/comment on [^']+'([^']*)'/g)) assert.ok(!m[1].includes(';'), m[1])
assert.ok(!/\u2014/.test(texte), 'pas de tiret cadratin')
const ordres = decouper(sansCommentaires(texte))
const donnees = JSON.parse(readFileSync(MODULE_JSON, 'utf8'))
assert.equal(donnees.module.slug, NOUVEAU)
assert.equal(donnees.remplace, ANCIEN)
const dossierJson = dirname(resolve(MODULE_JSON))

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const photo = { lancee_le: new Date().toISOString(), migration: MIGRATION, fichier: MODULE_JSON }

// Les profils : ce qu'ils ont, comme droitsAcademie le lit (academie_acces + offres de base), sans compte reel.
const PROFILS = {
  gratuit: { offres: [], liveClub: 'non' },
  'live-club': { offres: [], liveClub: 'oui' },
  'premium-skool (10% Club)': { offres: [['premium-skool', 'migration_skool']], liveClub: 'non' },
  'formation-complete (10% Club)': { offres: [['formation-complete', 'paypal']], liveClub: 'non' },
  'vip-skool (VIP)': { offres: [['vip-skool', 'migration_skool']], liveClub: 'non' },
}

async function droitsDe(tx, p) {
  const slugs = [...p.offres.map(o => o[0]), 'compte-gratuit', 'live-club']
  const rangees = await tx.$queryRawUnsafe(
    `select o.slug, o.ouvre_tout, c.module_id::text as module_id, c.section_id::text as section_id
       from public.academie_offres o left join public.academie_offre_contenus c on c.offre_id = o.id
      where o.slug = any($1::text[])`, slugs)
  const source = new Map(p.offres)
  const lignes = rangees.map(r => ({
    origine: source.has(r.slug) ? 'acces' : 'base', source: source.get(r.slug) ?? null, slug: r.slug,
    ouvreTout: r.ouvre_tout === true, moduleId: r.module_id, sectionId: r.section_id,
  }))
  return preparerDroits({ admin: false, etm: false, secoursEssai: false, liveClub: p.liveClub, lignes })
}

const LECONS = `select l.id::text as id, l.slug, l.section_id::text as section_id, l.module_id::text as module_id, l.usage,
  l.apercu, l.statut, s.ordre_fichier, b.publie_le as billet_publie_le
  from public.academie_lecons l
  left join public.academie_sections s on s.id = l.section_id
  left join public.academie_billets b on b.lecon_id = l.id and b.retire_le is null
  where l.module_id = $1::uuid order by l.ordre, l.slug`

/** Pour chaque profil : lecon -> 'ouvert' | 'ferme' | 'inconnu'. */
async function matrice(tx, lecons, offreAchat) {
  const res = {}
  const profils = { ...PROFILS, [`achat (${offreAchat})`]: { offres: [[offreAchat, 'stripe']], liveClub: 'non' } }
  for (const [nom, p] of Object.entries(profils)) {
    const d = await droitsDe(tx, p)
    res[nom] = new Map(lecons.map(l => [l.id, ouvertureLecon(d, {
      moduleId: l.module_id, sectionId: l.section_id, usage: l.usage, apercu: l.apercu, billetPublieLe: l.billet_publie_le,
    }).acces]))
  }
  return res
}

const accroches = async (tx, ids) => (await tx.$queryRawUnsafe(`
  select (select count(*) from public.academie_progression where lecon_id = any($1::uuid[]))::int as progression,
         (select count(distinct user_id) from public.academie_progression where lecon_id = any($1::uuid[]))::int as comptes,
         (select coalesce(sum(secondes_vues), 0) from public.academie_progression where lecon_id = any($1::uuid[]))::bigint::text as secondes,
         (select count(*) from public.academie_progression where lecon_id = any($1::uuid[]) and (terminee_le is not null or marquee_vue_le is not null))::int as vues,
         (select count(*) from public.academie_lectures where lecon_id = any($1::uuid[]))::int as lectures,
         (select count(*) from public.academie_billets where lecon_id = any($1::uuid[]))::int as billets,
         (select count(*) from public.academie_questions_lecons where lecon_id = any($1::uuid[]))::int as questions`, ids))[0]

const autresModules = async (tx, moduleId) => (await tx.$queryRawUnsafe(`
  select count(*)::int as n, md5(string_agg(l.id::text || l.module_id || coalesce(l.section_id::text, '') || l.slug || l.ordre
           || l.statut || l.titre, ',' order by l.id)) as empreinte
    from public.academie_lecons l where l.module_id <> $1::uuid`, moduleId))[0]

const compter = (m, ids) => ids.filter(id => m.get(id) === 'ouvert').length

let debut = 0
try {
  await prisma.$transaction(async tx => {
    debut = performance.now()
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '60s'`)

    // 1. Avant.
    const [mod] = await tx.$queryRawUnsafe(`select id::text as id, slug, titre from public.academie_modules where slug = $1`, ANCIEN)
    assert.ok(mod, `module ${ANCIEN} en base (la migration n'est pas deja appliquee)`)
    const leconsAvant = await tx.$queryRawUnsafe(LECONS, mod.id)
    const idsAvant = leconsAvant.map(l => l.id)
    const sectionsAvant = await tx.$queryRawUnsafe(
      `select ordre_fichier, titre, (select count(*) from public.academie_lecons l where l.section_id = s.id)::int as n
         from public.academie_sections s where module_id = $1::uuid order by ordre`, mod.id)
    const accAvant = await accroches(tx, idsAvant)
    const autresAvant = await autresModules(tx, mod.id)
    const offresAvant = await tx.$queryRawUnsafe(
      `select o.slug, c.section_id is not null as par_section from public.academie_offre_contenus c
         join public.academie_offres o on o.id = c.offre_id where c.module_id = $1::uuid order by 1`, mod.id)
    const matAvant = await matrice(tx, leconsAvant, 'module-replays-live-club')
    photo.avant = {
      module: { slug: mod.slug, titre: mod.titre }, lecons: leconsAvant.length,
      sections: sectionsAvant, accroches: accAvant, autres_modules: autresAvant, offres: offresAvant,
      ouvertes_par_profil: Object.fromEntries(Object.entries(matAvant).map(([k, m]) => [k, compter(m, idsAvant)])),
    }
    ok(`avant : ${leconsAvant.length} lecons en ${sectionsAvant.length} sections ; accroches ${JSON.stringify(accAvant)} ; `
      + `ouvertes par profil ${JSON.stringify(photo.avant.ouvertes_par_profil)}`)

    // 2. La migration, puis rejouee.
    const t1 = performance.now()
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const msMigration = Math.round(performance.now() - t1)
    const sectionsMig = await tx.$queryRawUnsafe(
      `select id::text as id, ordre, ordre_fichier, titre from public.academie_sections where module_id = $1::uuid order by ordre`, mod.id)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const sectionsRejeu = await tx.$queryRawUnsafe(
      `select id::text as id, ordre, ordre_fichier, titre from public.academie_sections where module_id = $1::uuid order by ordre`, mod.id)
    assert.deepEqual(sectionsRejeu, sectionsMig, 'le rejeu ne touche pas aux parties')
    ok(`migration appliquee (${msMigration} ms) puis rejouee : rien ne bouge au rejeu`)

    // 3. Apres la migration.
    const [modApres] = await tx.$queryRawUnsafe(`select id::text as id, slug, titre, image, prix_eur from public.academie_modules where id = $1::uuid`, mod.id)
    assert.equal(modApres.slug, NOUVEAU)
    assert.equal(modApres.titre, 'Rediffusion des Lives')
    assert.equal((await tx.$queryRawUnsafe(`select 1 from public.academie_modules where slug = $1`, ANCIEN)).length, 0)
    assert.deepEqual(sectionsMig.map(s => [s.ordre, s.ordre_fichier, s.titre]),
      [[1, 1, "Lives de l'académie"], [2, 2, 'Replays du Live Club'], [3, 3, 'Archives des lives']])
    const leconsMig = await tx.$queryRawUnsafe(LECONS, mod.id)
    assert.deepEqual(leconsMig.map(l => l.id).sort(), [...idsAvant].sort(), 'memes lecons (id) dans le module')
    const slugAvant = new Map(leconsAvant.map(l => [l.id, l.slug]))
    for (const l of leconsMig) assert.equal(l.slug, slugAvant.get(l.id), `slug inchange : ${l.slug}`)
    const parPartie = {}
    for (const l of leconsMig) parPartie[l.ordre_fichier] = (parPartie[l.ordre_fichier] ?? 0) + 1
    assert.deepEqual(await accroches(tx, idsAvant), accAvant, 'progression, lectures, billets, questions intacts')
    assert.deepEqual(await autresModules(tx, mod.id), autresAvant, 'les autres modules ne bougent pas')
    const [colonnes] = await tx.$queryRawUnsafe(`select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'academie_lecons' and column_name like 'live\\_%'`)
    assert.equal(colonnes.n, 4, 'les 4 colonnes du live')
    const offreAchat = (await tx.$queryRawUnsafe(`select o.slug, o.type, o.canal, o.prix_eur::float8 as prix, o.stripe_price_id,
        (select count(*) from public.academie_acces a where a.offre_id = o.id and a.retire_le is null)::int as acces,
        (select string_agg(coalesce(s.titre, 'module entier'), ', ') from public.academie_offre_contenus c
           left join public.academie_sections s on s.id = c.section_id where c.offre_id = o.id) as ouvre
      from public.academie_offres o where o.slug = 'module-rediffusion-des-lives'`))[0]
    assert.ok(offreAchat && offreAchat.prix === 19 && offreAchat.stripe_price_id === null && offreAchat.acces === 0)
    assert.equal(offreAchat.ouvre, "Lives de l'académie")
    assert.equal((await tx.$queryRawUnsafe(`select 1 from public.academie_offres where slug = 'module-replays-live-club'`)).length, 0)
    const matMig = await matrice(tx, leconsMig, 'module-rediffusion-des-lives')
    let changes = 0
    for (const nom of Object.keys(PROFILS)) {
      for (const id of idsAvant) if (matMig[nom].get(id) !== matAvant[nom].get(id)) changes++
    }
    assert.equal(changes, 0, 'memes acces pour chaque lecon existante et chaque profil')
    const achatAvant = compter(matAvant['achat (module-replays-live-club)'], idsAvant)
    const achatApres = compter(matMig['achat (module-rediffusion-des-lives)'], idsAvant)
    photo.apres_migration = {
      module: { slug: modApres.slug, titre: modApres.titre, image: modApres.image, prix_eur: modApres.prix_eur },
      sections: sectionsMig.map(s => ({ ordre: s.ordre, titre: s.titre, lecons: parPartie[s.ordre_fichier] ?? 0 })),
      offre_achat: offreAchat, changements_d_acces: changes,
      achat_offre_du_module: { avant: achatAvant, apres: achatApres, detenteurs: 0 },
      ouvertes_par_profil: Object.fromEntries(Object.entries(matMig).map(([k, m]) => [k, compter(m, idsAvant)])),
    }
    ok(`apres migration : meme module (id), ${leconsMig.length} lecons aux memes id et slugs, parties ${JSON.stringify(parPartie)} ; `
      + `rien de perdu ; autres modules identiques (${autresAvant.n} lecons) ; 0 changement d'acces sur 5 profils x ${idsAvant.length} lecons ; `
      + `offre a 19 EUR sans prix Stripe, 0 detenteur, ouvre « ${offreAchat.ouvre} » (${achatAvant} -> ${achatApres} lecons existantes)`)

    // 4. L'ancien fichier est refuse.
    if (existsSync(ANCIEN_JSON)) {
      const ancien = JSON.parse(readFileSync(ANCIEN_JSON, 'utf8'))
      await assert.rejects(() => importerModule(tx, ancien, dirname(ANCIEN_JSON)), /s'appelle maintenant rediffusion-des-lives/)
      ok('import de l\'ancien fichier replays-live-club.json refuse (il recreerait le module en double)')
    }

    // 5. L'import du nouveau fichier, puis rejoue.
    const t2 = performance.now()
    const bilan = await importerModule(tx, donnees, dossierJson)
    const msImport = Math.round(performance.now() - t2)
    const t3 = performance.now()
    const bilan2 = await importerModule(tx, donnees, dossierJson)
    const msRejeu = Math.round(performance.now() - t3)
    assert.equal(bilan2.lecons_creees ?? 0, 0, 'le rejeu ne cree rien')
    assert.equal(bilan2.lives_ecrits ?? 0, 0, 'le rejeu n\'ecrit aucune donnee de live')
    photo.import = { ms: msImport, bilan: { ...bilan, gardees: bilan.gardees, places_gardees: bilan.places_gardees }, rejeu_ms: msRejeu,
      rejeu: { lecons_creees: bilan2.lecons_creees ?? 0, lives_ecrits: bilan2.lives_ecrits ?? 0 } }
    ok(`import (${msImport} ms) : ${bilan.lecons} lecons dont ${bilan.lecons_creees ?? 0} creees, ${bilan.lives_ecrits ?? 0} donnees de live, `
      + `${bilan.sections} parties, offres ${JSON.stringify(bilan.offres)} ${JSON.stringify(bilan.offres_sections)}, `
      + `retirees ${bilan.offres_retirees} (module) et ${bilan.offres_sections_retirees} (parties) ; rejeu ${msRejeu} ms, rien de cree`)
    for (const g of [...bilan.gardees, ...bilan.places_gardees, ...bilan.statuts_gardes, ...bilan.avertissements]) console.log(`    note de l'import : ${g}`)

    // 6. Apres l'import.
    const leconsImp = await tx.$queryRawUnsafe(LECONS, mod.id)
    assert.equal(leconsImp.length, donnees.lecons.length, 'toutes les lecons du fichier sont dans le module')
    const parSlug = new Map(leconsImp.map(l => [l.slug, l]))
    for (const l of leconsAvant) assert.equal(parSlug.get(l.slug)?.id, l.id, `lecon gardee (meme id) : ${l.slug}`)
    assert.deepEqual(await accroches(tx, idsAvant), accAvant, 'progression, lectures, billets, questions toujours intacts')
    assert.deepEqual(await autresModules(tx, mod.id), autresAvant, 'les autres modules ne bougent toujours pas')
    const [sansDate] = await tx.$queryRawUnsafe(`select count(*)::int as n from public.academie_lecons where module_id = $1::uuid and live_le is null`, mod.id)
    assert.equal(sansDate.n, 0, 'chaque lecon a sa date de live')
    const partieDe = new Map(leconsImp.map(l => [l.id, l.ordre_fichier]))
    const ids = leconsImp.filter(l => l.statut === 'publie').map(l => l.id)
    const matImp = await matrice(tx, leconsImp, 'module-rediffusion-des-lives')
    const parties = { 1: 'academie', 2: 'live-club', 3: 'archives' }
    const tableau = {}
    for (const [nom, m] of Object.entries(matImp)) {
      tableau[nom] = {}
      for (const [n, cle] of Object.entries(parties)) {
        const dansPartie = ids.filter(id => String(partieDe.get(id)) === n)
        tableau[nom][cle] = `${compter(m, dansPartie)}/${dansPartie.length}`
      }
    }
    // La regle de Brice (05/11) : partie par partie.
    const attendu = {
      gratuit: [false, false, false],
      'live-club': [false, true, false],
      'premium-skool (10% Club)': [true, false, true],
      'formation-complete (10% Club)': [true, false, true],
      'vip-skool (VIP)': [true, true, true],
      'achat (module-rediffusion-des-lives)': [true, false, false],
    }
    for (const [nom, att] of Object.entries(attendu)) {
      for (const [i, n] of ['1', '2', '3'].entries()) {
        const dansPartie = ids.filter(id => String(partieDe.get(id)) === n)
        assert.equal(compter(matImp[nom], dansPartie), att[i] ? dansPartie.length : 0, `${nom}, partie ${parties[n]}`)
      }
    }
    const changementsExistantes = {}
    for (const nom of Object.keys(PROFILS)) {
      let perd = 0
      let gagne = 0
      for (const id of idsAvant) {
        const a = matAvant[nom].get(id) === 'ouvert'
        const b = matImp[nom].get(id) === 'ouvert'
        if (a && !b) perd++
        if (!a && b) gagne++
      }
      changementsExistantes[nom] = { perd, gagne }
    }
    photo.apres_import = {
      lecons: leconsImp.length, publiees: ids.length,
      par_partie: Object.fromEntries(Object.entries(parties).map(([n, cle]) => [cle, leconsImp.filter(l => String(l.ordre_fichier) === n).length])),
      ouvertes_par_profil_et_partie: tableau,
      lecons_deja_en_ligne_qui_changent: changementsExistantes,
    }
    ok(`apres import : ${leconsImp.length} lecons (${ids.length} publiees), les ${idsAvant.length} d'avant aux memes id, rien de perdu, `
      + `chaque lecon datee ; acces = regle de Brice partie par partie ${JSON.stringify(tableau)}`)
    ok(`lecons deja en ligne dont l'acces change a l'import : ${JSON.stringify(changementsExistantes)}`)
    throw new Annulation()
  }, { timeout: 240_000, maxWait: 15_000 })
} catch (e) {
  if (!(e instanceof Annulation)) {
    await prisma.$disconnect()
    throw e
  }
}
const duree = Math.round(performance.now() - debut)
const [reste] = await prisma.$queryRawUnsafe(`select
    (select count(*) from public.academie_modules where slug = $1)::int as ancien,
    (select count(*) from public.academie_modules where slug = $2)::int as nouveau`, ANCIEN, NOUVEAU)
await prisma.$disconnect()
assert.deepEqual(reste, { ancien: 1, nouveau: 0 }, 'rien n est reste apres l annulation')
photo.duree_ms = duree
photo.apres_annulation = reste
writeFileSync(PHOTO, `${JSON.stringify(photo, null, 1)}\n`)
console.log(`ok  annule : le module s'appelle toujours ${ANCIEN} (${etapes + 1} etapes, ${duree} ms du begin au rollback). Photo : ${PHOTO}`)
