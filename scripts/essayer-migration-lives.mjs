/**
 * ESSAI de la migration 20261113200000_academie_lives.sql (le calendrier des
 * lives de l'academie, 13/11/2026) et des requetes EXACTES de
 * src/lib/academie/lives.ts, contre la vraie base, dans UNE transaction
 * TOUJOURS ANNULEE (lock_timeout 5 s, rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable) : RLS activee et forcee sur
 *      les deux tables, aucun droit pour anon, authenticated, service_role ;
 *      fonctions internes fermees ; la serie de Brice posee une seule fois ;
 *   2. le depliage des series : mardi et jeudi 20 h de Paris, passage a
 *      l'heure d'ete (28/03/2027 : 19:00Z puis 18:00Z), une semaine sur deux,
 *      debut et fin ;
 *   3. les gestes de l'equipe (role postgres, requetes de lives.ts) : coller un
 *      lien sur une date de serie, annuler, retablir, deplacer et revenir a
 *      l'horaire, texte d'une date, une date qui n'est pas de la serie (refus),
 *      creer, modifier, coller le lien, supprimer un ponctuel ; creer,
 *      modifier, arreter, supprimer une serie (exceptions effacees avec elle) ;
 *   4. ce que recoit un membre (vueMembre sur les vraies lignes) : visiteur,
 *      gratuit, programme, Live Club, avant la fenetre, dans la fenetre, apres ;
 *      le lien ne part que dans l'etat 'pret' ;
 *   5. LECTURES ET ECRITURES REJOUEES sous anon et authenticated (vrai sub) :
 *      tout refuse sur les tables et les fonctions ;
 *   6. les contraintes (lien http, javascript:, ponctuel incomplet, date sans
 *      serie, duree, jours).
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste. Aucun email ni identifiant complet n'est affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-lives.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import * as L from '../src/lib/academie/lives.ts'

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261113200000_academie_lives.sql'
const candidats = [
  process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${MIGRATION}`) : null,
  new URL(`../../../${MIGRATION}`, import.meta.url),
].filter(Boolean)
const fichier = candidats.find(u => existsSync(u))
if (!fichier) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${MIGRATION})`)

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
const ordres = decouper(readFileSync(fichier, 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n'))

class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const court = id => `${String(id).slice(0, 8)}...`
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|policy|violates|denied|row-level|check constraint|not-null|duplicate|unique/i.test(l))?.trim().slice(0, 110) ?? 'refus'
const big = v => JSON.parse(JSON.stringify(v, (k, x) => typeof x === 'bigint' ? Number(x) : x))
const iso = d => new Date(d).toISOString()

const etat = async c => big((await c.$queryRawUnsafe(`select
  to_regclass('public.academie_lives_series')::text as series,
  to_regclass('public.academie_lives')::text as lives,
  to_regprocedure('public.aok_lives_entre(timestamptz,timestamptz)')::text as entre,
  to_regprocedure('public.aok_lives_date_de_serie(uuid,date)')::text as date_de_serie`))[0])

const BRICE = 'b71ce000-0000-4000-8000-000000000001'
const PAR = 'cockpit:essai-lives'

const avant = await etat(prisma)
assert.deepEqual(avant, { series: null, lives: null, entre: null, date_de_serie: null }, 'la migration est deja appliquee : essai inutile')
ok(`avant : ni table ni fonction (${ordres.length} ordres a jouer)`)

// Deux comptes reels pour le sub des essais RLS (lus, jamais affiches en entier).
const comptes = big(await prisma.$queryRawUnsafe(`
  select p.id::text as id, public.aok_annuaire_acces(p.id) ->> 'statut' as statut
    from public.profiles p
   order by p.created_at desc nulls last
   limit 40`))
const gratuit = comptes.find(c => c.statut === 'communaute')
const membre = comptes.find(c => c.statut && c.statut !== 'communaute' && c.statut !== 'equipe')
assert.ok(gratuit, 'aucun compte communaute trouve')
ok(`comptes lus : un gratuit (${court(gratuit.id)})${membre ? `, un ${membre.statut} (${court(membre.id)})` : ''}`)

const debutEssai = Date.now()
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '20s'`)
    let n = 0
    const q = async (sql, ...p) => big(await tx.$queryRawUnsafe(sql, ...p))
    const un = async (sql, valeurs) => (await tx.$queryRawUnsafe(sql, ...valeurs))[0]?.id ?? null
    const entre = async (du, au) => (await tx.$queryRawUnsafe(L.SQL_ENTRE, new Date(du), new Date(au)))

    async function comme(role, sub, sql, ...params) {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      try {
        const claims = JSON.stringify(sub ? { sub, role, aud: 'authenticated' } : { role })
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, claims)
        await tx.$executeRawUnsafe(`set local role ${role}`)
        const lignes = big(await tx.$queryRawUnsafe(sql, ...params))
        return { ok: true, lignes }
      } catch (e) {
        return { ok: false, motif: motif(e) }
      } finally {
        await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`)
      }
    }
    async function doitEchouer(nom, sql, ...params) {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      let erreur = null
      try { await tx.$executeRawUnsafe(sql, ...params) } catch (err) { erreur = err }
      await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`)
      assert.ok(erreur, `${nom} : l'ordre aurait du etre refuse`)
      ok(`${nom} : refuse (${motif(erreur)})`)
    }

    // 1. La migration, deux fois.
    for (const tour of [1, 2]) {
      const t0 = Date.now()
      for (const o of ordres) await tx.$executeRawUnsafe(o)
      ok(`migration jouee (tour ${tour}, ${Date.now() - t0} ms)`)
    }
    const rls = await q(`select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('academie_lives_series', 'academie_lives') order by 1`)
    assert.deepEqual(rls.map(r => [r.relname, r.rls, r.force]), [['academie_lives', true, true], ['academie_lives_series', true, true]])
    ok('RLS activee et forcee sur les deux tables')
    const droits = await q(`select r.rolname, t.t,
        has_table_privilege(r.rolname, 'public.' || t.t, 'select') as s, has_table_privilege(r.rolname, 'public.' || t.t, 'insert') as i,
        has_table_privilege(r.rolname, 'public.' || t.t, 'update') as u, has_table_privilege(r.rolname, 'public.' || t.t, 'delete') as d
      from (values ('anon'), ('authenticated'), ('service_role')) r(rolname), (values ('academie_lives_series'), ('academie_lives')) t(t)`)
    assert.ok(droits.every(x => !x.s && !x.i && !x.u && !x.d), JSON.stringify(droits))
    const policies = await q(`select count(*)::int as n from pg_policies where schemaname = 'public' and tablename in ('academie_lives_series', 'academie_lives')`)
    assert.equal(policies[0].n, 0)
    ok('aucun droit de table pour anon, authenticated, service_role ; aucune policy')
    const fonctions = await q(`select r.rolname,
        has_function_privilege(r.rolname, 'public.aok_lives_entre(timestamptz,timestamptz)', 'execute') as entre,
        has_function_privilege(r.rolname, 'public.aok_lives_date_de_serie(uuid,date)', 'execute') as date_de_serie
      from (values ('anon'), ('authenticated'), ('service_role')) r(rolname)`)
    assert.ok(fonctions.every(f => !f.entre && !f.date_de_serie), JSON.stringify(fonctions))
    ok('fonctions internes fermees a anon, authenticated, service_role')
    const brice = await q(`select titre, genre, jours, to_char(heure, 'HH24:MI') as heure, duree_min, debut::text as debut, acces, lien from public.academie_lives_series`)
    assert.equal(brice.length, 1, 'la serie de Brice doit etre posee une seule fois (rejeu)')
    assert.deepEqual(brice[0], { titre: 'Live de Brice', genre: 'aok', jours: [2, 4], heure: '20:00', duree_min: 90, debut: '2026-11-16', acces: 'live_club', lien: null })
    ok('serie de Brice posee une fois : mardi et jeudi, 20:00, 90 min, live_club, sans lien, depuis le 16/11/2026')

    // 2. Le depliage.
    const nov = await entre('2026-11-13T00:00:00Z', '2026-11-27T00:00:00Z')
    assert.deepEqual(nov.map(l => iso(l.debut)), [
      '2026-11-17T19:00:00.000Z', '2026-11-19T19:00:00.000Z', '2026-11-24T19:00:00.000Z', '2026-11-26T19:00:00.000Z'])
    assert.ok(nov.every(l => l.cle.startsWith(`s:${BRICE}:`) && l.statut === 'prevu' && l.lien === null && l.lien_serie === false))
    ok('novembre : mardi 17, jeudi 19, mardi 24, jeudi 26 a 20:00 de Paris (19:00Z), rien avant le 16/11')
    const ete = await entre('2027-03-22T00:00:00Z', '2027-04-02T00:00:00Z')
    assert.deepEqual(ete.map(l => iso(l.debut)), [
      '2027-03-23T19:00:00.000Z', '2027-03-25T19:00:00.000Z', '2027-03-30T18:00:00.000Z', '2027-04-01T18:00:00.000Z'])
    ok("heure d'ete (28/03/2027) : 20:00 de Paris reste 20:00 (19:00Z puis 18:00Z)")
    const enCours = await entre('2026-11-17T20:00:00Z', '2026-11-17T20:10:00Z')
    assert.deepEqual(enCours.map(l => iso(l.debut)), ['2026-11-17T19:00:00.000Z'])
    ok('un live en cours (debut avant la fenetre, fin apres) est rendu')

    // 3. Les gestes de l'equipe sur une date de serie.
    const cible = { serie_id: BRICE, date_serie: '2026-11-17' }
    const geste = async (corps) => {
      const d = L.lireDemandeEquipe(corps, Date.parse('2026-11-13T12:00:00Z'))
      assert.ok(!('erreur' in d), `demande refusee : ${JSON.stringify(d)}`)
      const { sql, valeurs } = L.requeteDate(d, PAR)
      return un(sql, valeurs)
    }
    const date17 = async () => (await entre('2026-11-17T00:00:00Z', '2026-11-18T00:00:00Z'))[0]
    assert.ok(await geste({ action: 'lien', cible, lien: 'https://meet.google.com/abc-defg-hij' }))
    let l17 = await date17()
    assert.equal(l17.lien, 'https://meet.google.com/abc-defg-hij')
    assert.equal(l17.lien_serie, false)
    assert.ok(l17.lien_le && l17.live_id)
    const nbExceptions = async () => (await q(`select count(*)::int as n from public.academie_lives where serie_id = $1::uuid`, BRICE))[0].n
    assert.equal(await nbExceptions(), 1)
    ok('lien colle sur le mardi 17 : une exception creee, lien_le pose, la serie inchangee')
    assert.ok(await geste({ action: 'lien', cible, lien: 'https://meet.google.com/xyz-uvwx-rst' }))
    l17 = await date17()
    assert.equal(l17.lien, 'https://meet.google.com/xyz-uvwx-rst')
    assert.equal(await nbExceptions(), 1)
    ok('lien remplace : toujours une seule exception pour cette date')
    assert.ok(await geste({ action: 'annuler', cible }))
    l17 = await date17()
    assert.equal(l17.statut, 'annule')
    assert.equal(l17.lien, 'https://meet.google.com/xyz-uvwx-rst', 'annuler ne touche pas au lien')
    const autres = await entre('2026-11-18T00:00:00Z', '2026-11-27T00:00:00Z')
    assert.equal(autres.length, 3)
    assert.ok(autres.every(l => l.statut === 'prevu'))
    ok('mardi 17 annule : les trois dates suivantes restent prevues (la serie n est pas cassee)')
    assert.ok(await geste({ action: 'retablir', cible }))
    assert.equal((await date17()).statut, 'prevu')
    ok('mardi 17 retabli')
    assert.ok(await geste({ action: 'deplacer', cible, debut: '2026-11-18T18:30:00Z', duree_min: 60 }))
    const deplace = (await entre('2026-11-17T00:00:00Z', '2026-11-19T00:00:00Z'))
    assert.equal(deplace.length, 1)
    assert.equal(iso(deplace[0].debut), '2026-11-18T18:30:00.000Z')
    assert.equal(iso(deplace[0].debut_prevu), '2026-11-17T19:00:00.000Z')
    assert.equal(deplace[0].duree_min, 60)
    assert.equal((await entre('2026-11-17T00:00:00Z', '2026-11-18T00:00:00Z')).length, 0)
    const vueDep = L.vueLiveCockpit(deplace[0])
    assert.equal(vueDep.deplace, true)
    assert.equal(vueDep.date_serie, '2026-11-17')
    ok('mardi 17 deplace au mercredi 18 a 19:30 de Paris, 60 min : rendu le 18, plus le 17, debut_prevu garde')
    assert.ok(await geste({ action: 'deplacer', cible, debut: null, duree_min: null }))
    l17 = await date17()
    assert.equal(iso(l17.debut), '2026-11-17T19:00:00.000Z')
    assert.equal(l17.duree_min, 90)
    ok("retour a l'horaire de la serie (debut null) : mardi 17 a 20:00, 90 min")
    assert.ok(await geste({ action: 'texte_date', cible, titre: 'Live special NFP', description: 'Questions apres le NFP.' }))
    l17 = await date17()
    assert.equal(l17.titre, 'Live special NFP')
    assert.equal(l17.description, 'Questions apres le NFP.')
    const jeudi = (await entre('2026-11-19T00:00:00Z', '2026-11-20T00:00:00Z'))[0]
    assert.equal(jeudi.titre, 'Live de Brice')
    ok('titre et description du mardi 17 seulement ; le jeudi garde le titre de la serie')
    assert.equal(await geste({ action: 'lien', cible: { serie_id: BRICE, date_serie: '2026-11-18' }, lien: 'https://exemple.fr/x' }), null)
    assert.equal(await geste({ action: 'annuler', cible: { serie_id: BRICE, date_serie: '2026-11-10' } }), null)
    assert.equal(await nbExceptions(), 1)
    ok("un mercredi, ou un mardi avant le debut de la serie : refuse (rien d'ecrit, 404 pour la route)")
    assert.ok(await geste({ action: 'lien', cible, lien: null }))
    l17 = await date17()
    assert.equal(l17.lien, null)
    assert.equal(l17.lien_le, null)
    ok('lien retire : la date reprend le lien de la serie (aucun ici)')

    // Lien par defaut de la serie.
    const vS = L.lireDemandeEquipe({ action: 'modifier_serie', id: BRICE, serie: {
      titre: 'Live de Brice', animateur: 'Brice', genre: 'aok', jours: [2, 4], heure: '20:00', duree_min: 90, debut: '2026-11-16',
      acces: 'live_club', lien: 'https://meet.google.com/lien-fixe' } }, Date.parse('2026-11-13T12:00:00Z'))
    assert.ok(!('erreur' in vS))
    assert.ok(await un(L.SQL_MODIFIER_SERIE, [...L.valeursSerie(vS.serie, PAR), vS.id]))
    const avecDefaut = await entre('2026-11-17T00:00:00Z', '2026-11-20T00:00:00Z')
    assert.deepEqual(avecDefaut.map(l => [l.lien, l.lien_serie]), [['https://meet.google.com/lien-fixe', true], ['https://meet.google.com/lien-fixe', true]])
    ok('lien par defaut de la serie : repris par chaque date sans lien a elle (lien_serie)')

    // Ponctuels.
    const vL = L.lireDemandeEquipe({ action: 'creer_live', live: {
      titre: 'Live Fixing', animateur: 'Arnaud', genre: 'partenaire', debut: '2026-11-20T20:30:00Z', duree_min: 30, acces: 'tous', lien: null,
      description: 'Inscription sur la page du partenaire.' } }, Date.parse('2026-11-13T12:00:00Z'))
    assert.ok(!('erreur' in vL))
    const idP = await un(L.SQL_CREER_LIVE, L.valeursLive(vL.live, PAR))
    assert.ok(idP)
    let p = (await entre('2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z')).find(l => l.live_id === idP)
    assert.equal(p.cle, `p:${idP}`)
    assert.equal(p.serie_id, null)
    assert.equal(p.lien, null)
    ok('live partenaire ponctuel cree (vendredi 20 a 21:30 de Paris, niveau tous, sans lien)')
    const dP = L.lireDemandeEquipe({ action: 'lien', cible: { id: idP }, lien: 'https://us02web.zoom.us/j/123?pwd=abc' }, Date.parse('2026-11-13T12:00:00Z'))
    assert.ok(await un(L.requeteDate(dP, PAR).sql, L.requeteDate(dP, PAR).valeurs))
    p = (await entre('2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z')).find(l => l.live_id === idP)
    assert.equal(p.lien, 'https://us02web.zoom.us/j/123?pwd=abc')
    assert.ok(p.lien_le)
    ok('lien colle au dernier moment sur le ponctuel')
    const vM = L.lireDemandeEquipe({ action: 'modifier_live', id: idP, live: { ...vL.live, titre: 'Live Fixing du vendredi', lien: 'https://us02web.zoom.us/j/123?pwd=abc' } }, Date.parse('2026-11-13T12:00:00Z'))
    const lienLeAvant = iso(p.lien_le)
    assert.ok(await un(L.SQL_MODIFIER_LIVE, [...L.valeursLive(vM.live, PAR), vM.id]))
    p = (await entre('2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z')).find(l => l.live_id === idP)
    assert.equal(p.titre, 'Live Fixing du vendredi')
    assert.equal(iso(p.lien_le), lienLeAvant, 'lien_le ne bouge pas si le lien est le meme')
    ok('ponctuel modifie : titre change, lien_le garde (lien identique)')
    assert.equal(await un(L.SQL_SUPPRIMER_LIVE, [l17.live_id]), null, 'une exception de serie ne se supprime pas par supprimer_live')
    assert.ok(await un(L.SQL_SUPPRIMER_LIVE, [idP]))
    assert.equal((await entre('2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z')).filter(l => l.live_id === idP).length, 0)
    ok('ponctuel supprime ; une exception de serie refusee par supprimer_live')

    // Une serie une semaine sur deux, arretee puis supprimee.
    const vB = L.lireDemandeEquipe({ action: 'creer_serie', serie: {
      titre: 'BeatTheProp', animateur: 'Arnaud', genre: 'partenaire', jours: [5], heure: '16:00', duree_min: 60, toutes_les_semaines: 2,
      debut: '2026-11-20', acces: 'tous', lien: 'https://zoom.us/j/999' } }, Date.parse('2026-11-13T12:00:00Z'))
    assert.ok(!('erreur' in vB))
    const idB = await un(L.SQL_CREER_SERIE, L.valeursSerie(vB.serie, PAR))
    assert.ok(idB)
    const bp = (await entre('2026-11-16T00:00:00Z', '2026-12-20T00:00:00Z')).filter(l => l.serie_id === idB)
    assert.deepEqual(bp.map(l => iso(l.debut)), ['2026-11-20T15:00:00.000Z', '2026-12-04T15:00:00.000Z', '2026-12-18T15:00:00.000Z'])
    ok('serie un vendredi sur deux a 16:00 : 20/11, 04/12, 18/12 (pas le 27/11 ni le 11/12)')
    const r27 = await un(L.requeteDate({ action: 'annuler', cible: { serie_id: idB, date_serie: '2026-11-27' } }, PAR).sql,
      L.requeteDate({ action: 'annuler', cible: { serie_id: idB, date_serie: '2026-11-27' } }, PAR).valeurs)
    assert.equal(r27, null)
    ok('le vendredi 27/11 (semaine sautee) refuse comme date de cette serie')
    const dA = { action: 'annuler', cible: { serie_id: idB, date_serie: '2026-12-04' } }
    assert.ok(await un(L.requeteDate(dA, PAR).sql, L.requeteDate(dA, PAR).valeurs))
    assert.ok(await un(L.SQL_ARRETER_SERIE, [idB, '2026-12-10', PAR]))
    const bp2 = (await entre('2026-11-16T00:00:00Z', '2027-01-20T00:00:00Z')).filter(l => l.serie_id === idB)
    assert.deepEqual(bp2.map(l => [iso(l.debut), l.statut]), [['2026-11-20T15:00:00.000Z', 'prevu'], ['2026-12-04T15:00:00.000Z', 'annule']])
    ok('serie arretee au 10/12 : plus de date apres, le 04/12 annule reste visible')
    assert.ok(await un(L.SQL_SUPPRIMER_SERIE, [idB]))
    const restes = await q(`select count(*)::int as n from public.academie_lives where serie_id = $1::uuid`, idB)
    assert.equal(restes[0].n, 0)
    ok('serie supprimee : ses exceptions partent avec elle (cascade)')

    // 4. Ce que recoit un membre, sur les vraies lignes (lien colle sur le mardi 17).
    assert.ok(await geste({ action: 'lien', cible, lien: 'https://meet.google.com/abc-defg-hij' }))
    const ligne = await date17()
    const T = t => Date.parse(t)
    const visiteur = { connecte: false }
    const sansLc = L.lecteurDe({ equipe: false, admin: false, etm: false, vip: false, liveClub: 'non' }, 'communaute')
    const prog = L.lecteurDe({ equipe: false, admin: false, etm: false, vip: false, liveClub: 'non' }, 'club_10')
    const lc = L.lecteurDe({ equipe: false, admin: false, etm: false, vip: false, liveClub: 'oui' }, 'live_club')
    const etm = L.lecteurDe({ equipe: false, admin: false, etm: true, vip: false, liveClub: 'non_lu' }, 'eleve')
    const panne = L.lecteurDe({ equipe: false, admin: false, etm: false, vip: false, liveClub: 'inconnu' }, 'communaute')
    const cas = [
      ['visiteur dans la fenetre', visiteur, '2026-11-17T18:45:00Z', 'connexion'],
      ['gratuit dans la fenetre', sansLc, '2026-11-17T18:45:00Z', 'ferme'],
      ['10% Club dans la fenetre (niveau live_club)', prog, '2026-11-17T18:45:00Z', 'ferme'],
      ['Live Club la veille', lc, '2026-11-16T19:00:00Z', 'avant'],
      ['Live Club a 19:29 de Paris', lc, '2026-11-17T18:29:00Z', 'avant'],
      ['Live Club a 19:30 de Paris', lc, '2026-11-17T18:30:00Z', 'pret'],
      ['ETM pendant le live', etm, '2026-11-17T20:00:00Z', 'pret'],
      ['Live Club apres la fin', lc, '2026-11-17T20:30:00Z', 'fini'],
      ['Stripe illisible', panne, '2026-11-17T18:45:00Z', 'inconnu'],
    ]
    for (const [nom, lecteur, quand, attendu] of cas) {
      const v = L.vueMembre(ligne, lecteur, T(quand))
      assert.equal(v.etat, attendu, nom)
      assert.equal(v.lien, attendu === 'pret' ? 'https://meet.google.com/abc-defg-hij' : null, `${nom} : lien`)
      const cles = Object.keys(v).sort().join(',')
      assert.equal(cles, 'acces,animateur,cle,debut,deplace_de,description,duree_min,etat,fin,genre,lien,ouvre_le,statut,titre', nom)
    }
    ok(`vueMembre sur la vraie ligne : ${cas.length} cas (visiteur, gratuit, 10% Club, Live Club, ETM, Stripe illisible ; avant, fenetre, apres) ; le lien seulement dans l'etat pret ; champs prevus seulement`)
    assert.ok(await geste({ action: 'annuler', cible }))
    assert.equal(L.vueMembre(await date17(), lc, T('2026-11-17T18:45:00Z')).etat, 'annule')
    assert.equal(L.vueMembre(await date17(), lc, T('2026-11-17T18:45:00Z')).lien, null)
    ok('date annulee : etat annule, aucun lien, meme dans la fenetre')

    // 5. RLS rejouee sous anon et authenticated.
    const gestes = [
      ['lire les series', `select * from public.academie_lives_series`],
      ['lire les lives', `select * from public.academie_lives`],
      ['creer une serie', `insert into public.academie_lives_series (titre, genre, jours, heure, debut, acces, cree_par) values ('x', 'aok', '{2}', '20:00', '2026-11-16', 'tous', 'x')`],
      ['coller un lien', `update public.academie_lives_series set lien = 'https://exemple.fr/piege'`],
      ['supprimer une serie', `delete from public.academie_lives_series`],
      ['inserer un live', `insert into public.academie_lives (titre, genre, debut, duree_min, acces, cree_par) values ('x', 'aok', now(), 60, 'tous', 'x')`],
      ['appeler aok_lives_entre', `select * from public.aok_lives_entre(now(), now() + interval '30 days')`],
      ['appeler aok_lives_date_de_serie', `select public.aok_lives_date_de_serie('${BRICE}'::uuid, '2026-11-17'::date)`],
    ]
    let refus = 0
    for (const [role, sub] of [['anon', null], ['authenticated', gratuit.id], ...(membre ? [['authenticated', membre.id]] : [])]) {
      for (const [nom, sql] of gestes) {
        const r = await comme(role, sub, sql)
        assert.equal(r.ok, false, `${role} ${sub ? court(sub) : ''} : ${nom} aurait du etre refuse`)
        assert.match(r.motif, /permission denied/i, `${role} : ${nom} : ${r.motif}`)
        refus++
      }
    }
    ok(`${refus} gestes directs refuses (permission denied) a anon, a un gratuit${membre ? ' et a un membre' : ''} : lire, ecrire, appeler les fonctions`)

    // 6. Les contraintes.
    await doitEchouer('lien http', `update public.academie_lives_series set lien = 'http://exemple.fr/live' where id = $1::uuid`, BRICE)
    await doitEchouer('lien javascript', `update public.academie_lives_series set lien = 'javascript:alert(1)' where id = $1::uuid`, BRICE)
    await doitEchouer('lien avec espace', `update public.academie_lives_series set lien = 'https://exemple.fr/a b' where id = $1::uuid`, BRICE)
    await doitEchouer('ponctuel sans titre ni debut', `insert into public.academie_lives (genre, acces, cree_par) values ('aok', 'tous', 'x')`)
    await doitEchouer('date sans serie', `insert into public.academie_lives (date_serie, titre, genre, debut, duree_min, acces, cree_par) values ('2026-11-17', 'x', 'aok', now(), 60, 'tous', 'x')`)
    await doitEchouer('serie sans date', `insert into public.academie_lives (serie_id, cree_par) values ($1::uuid, 'x')`, BRICE)
    await doitEchouer('deux exceptions pour la meme date', `insert into public.academie_lives (serie_id, date_serie, cree_par) values ($1::uuid, '2026-11-19', 'x'), ($1::uuid, '2026-11-19', 'x')`, BRICE)
    await doitEchouer('duree de 5 minutes', `update public.academie_lives_series set duree_min = 5 where id = $1::uuid`, BRICE)
    await doitEchouer('jour 8', `update public.academie_lives_series set jours = '{2,8}' where id = $1::uuid`, BRICE)
    await doitEchouer('genre inconnu', `update public.academie_lives_series set genre = 'vip' where id = $1::uuid`, BRICE)
    await doitEchouer('acces inconnu', `update public.academie_lives_series set acces = 'vip' where id = $1::uuid`, BRICE)
    await doitEchouer('lien sans lien_le', `insert into public.academie_lives (titre, genre, debut, duree_min, acces, lien, cree_par) values ('x', 'aok', now(), 60, 'tous', 'https://exemple.fr/x', 'x')`)
    await doitEchouer('fin avant le debut', `update public.academie_lives_series set fin = '2026-11-01' where id = $1::uuid`, BRICE)

    throw new Annulation()
  }, { timeout: 120_000, maxWait: 10_000 })
} catch (err) {
  if (!(err instanceof Annulation)) throw err
}
const duree = Date.now() - debutEssai

const apres = await etat(prisma)
assert.deepEqual(apres, { series: null, lives: null, entre: null, date_de_serie: null })
ok(`transaction annulee (${(duree / 1000).toFixed(1)} s du begin au rollback) : ni table ni fonction ne sont restees`)
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
