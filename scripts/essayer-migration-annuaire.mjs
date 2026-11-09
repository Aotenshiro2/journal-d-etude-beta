/**
 * ESSAI de la migration 20261109235500_aok_annuaire.sql (annuaire des membres,
 * badges Alumni, 09/11/2026) contre la vraie base, dans UNE transaction
 * TOUJOURS ANNULEE (rien ne reste, lock_timeout 5 s). La migration du lot 1
 * (20261109234500_anciens_membres_numeros.sql) n est pas appliquee : l essai
 * la joue d abord, puis celle de l annuaire, dans la meme transaction.
 *
 * Ce qui est verifie :
 *   0. la garde refuse le fichier si le lot 1 n est pas passe ;
 *   1. lot 1 puis annuaire passent, l annuaire est rejouable ;
 *   2. avec des comptes d essai (adresses en .invalid) rendus publics :
 *      - statut principal : equipe, Live Club (abonnement), 10% Club (Skool
 *        ou acces premium-skool), eleve (module, ETM), communaute ; un membre
 *        Live Club et 10% Club apparait sous Live Club et dans les deux filtres ;
 *      - un compte gratuit voit 24 membres, toujours les memes, et la
 *        recherche ne trouve PAS un membre hors de ses 24 (coupe avant les
 *        filtres) ; un eleve voit tout, pages de 24 ;
 *      - recherche sans accents, filtres recents, statut, niveau ;
 *      - profil prive absent ;
 *      - badges : Alumni pose depuis le cockpit sur une fiche, anciennete par
 *        une reservation du lot 1 ;
 *   3. plafond d appels : 60 par compte et par heure, 5 000 pour le site ;
 *   4. RLS et droits : anon, membre ordinaire, compte du cockpit ;
 *   5. durees : tous les profils reels rendus publics le temps d une mesure ;
 *   6. les controles de verifier:rls (audit-rls.mjs) rejoues DANS la
 *      transaction : aucune alerte nouvelle apres les deux migrations.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n est reste. Aucun email, nom ni identifiant complet affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-annuaire.mjs
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const LOT1 = '20261109234500_anciens_membres_numeros.sql'
const NOM_MIGRATION = '20261109235500_aok_annuaire.sql'
const DOSSIER = 'sites/Aoknowledgecom/supabase/migrations'
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
const ordres1 = decouper(sansCommentaires(fichier(LOT1)))
const ordres = decouper(sansCommentaires(fichier(NOM_MIGRATION)))
const garde = ordres.find(o => /^do \$garde\$/.test(o))
assert.ok(garde, 'bloc de garde introuvable')
// Aucun point-virgule hors fin d ordre : chaque ordre commence par un mot-cle connu.
for (const o of ordres) assert.match(o, /^(do|create|comment|alter|revoke|grant|drop)\b/i, `ordre suspect (point-virgule mal place ?) : ${o.slice(0, 60)}`)

/** Les controles de scripts/audit-rls.mjs (verifier:rls), memes requetes, pour les rejouer DANS la transaction. */
const LECTURE_PUBLIQUE_ASSUMEE = new Set(['courses', 'modules', 'lessons', 'upcoming_sessions', 'learnybox_articles', 'sync_status'])
const ECRITURE_ANONYME_ASSUMEE = new Set(['masterclass_leads'])
async function auditer(c) {
  const alertes = []
  for (const t of await c.$queryRawUnsafe(`select c.relname as tbl from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)) alertes.push(`table sans RLS : ${t.tbl}`)
  for (const o of await c.$queryRawUnsafe(`select tablename, policyname, cmd, roles::text as roles from pg_policies
      where schemaname = 'public' and cmd in ('SELECT', 'ALL', 'UPDATE', 'DELETE') and coalesce(qual, 'true') = 'true'
        and (roles::text like '%public%' or roles::text like '%anon%')`)) {
    if (!(LECTURE_PUBLIQUE_ASSUMEE.has(o.tablename) && o.cmd === 'SELECT')) alertes.push(`acces ouvert : ${o.tablename} -> "${o.policyname}" (${o.cmd})`)
  }
  for (const e of await c.$queryRawUnsafe(`select tablename, policyname from pg_policies where schemaname = 'public' and cmd = 'INSERT'
      and coalesce(with_check, 'true') = 'true' and (roles::text like '%public%' or roles::text like '%anon%')`)) {
    if (!ECRITURE_ANONYME_ASSUMEE.has(e.tablename)) alertes.push(`ecriture ouverte : ${e.tablename} -> "${e.policyname}"`)
  }
  for (const v of await c.$queryRawUnsafe(`select c.relname as vue, coalesce(array_to_string(c.reloptions, ','), '') as options,
      pg_get_viewdef(c.oid, true) as def, has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
      has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v', 'm')`)) {
    if (!v.anon_select && !v.auth_select) continue
    if (!v.options.includes('security_invoker=true') && !/is_cockpit_member\(\)|auth\.uid\(\)|auth\.jwt\(\)/.test(v.def)) alertes.push(`vue sans garde : ${v.vue}`)
  }
  return alertes.sort()
}

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const motif = e => String(e?.meta?.message ?? e?.message ?? e).split('\n').map(l => l.trim()).filter(Boolean)
  .find(l => /permission|policy|violates|denied|row-level|does not exist|Refus|Reserve|exception|introuvable|connexion/i.test(l))?.slice(0, 160) ?? 'refus'
const num = v => (v === null || v === undefined ? null : Number(v))
const json = x => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? Number(v) : v)))

const existe = async (c, sig) => (await c.$queryRawUnsafe(`select to_regprocedure($1) is not null as la`, sig))[0].la
if (await existe(prisma, 'public.aok_anciens_activer(uuid)')) {
  throw new Error('aok_anciens_activer existe DEJA : le lot 1 est applique, cet essai le rejouerait. Adapter l essai.')
}
if (await existe(prisma, 'public.aok_annuaire(text, jsonb, integer)')) {
  throw new Error('aok_annuaire existe DEJA : cet essai est fait pour la migration pas encore appliquee.')
}
const ETAT = `select (select last_value from public.member_number_seq) as seq, (select is_called from public.member_number_seq) as appele,
  (select count(*) from public.profiles) as comptes, (select max(client_number) from public.profiles) as maxi,
  (select count(*) from public.profiles where profil_public) as publics,
  (select md5(string_agg(id::text || ':' || client_number::text || ':' || profil_public::text, ',' order by id)) from public.profiles) as empreinte,
  to_regclass('public.aok_badges') is not null as badges_la, to_regclass('public.aok_annuaire_appels') is not null as appels_la, to_regclass('public.aok_annuaire_mesures') is not null as mesures_la,
  to_regclass('public.aok_anciens_membres') is not null as lot1_la`
const avantHors = (await prisma.$queryRawUnsafe(ETAT))[0]

const SUFFIXE = randomUUID().slice(0, 8)
const adresse = n => `essai-annuaire-${n}-${SUFFIXE}@exemple.invalid`

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '120s'`)
    let n = 0
    const sql = (s, ...p) => tx.$queryRawUnsafe(s, ...p)
    const exec = (s, ...p) => tx.$executeRawUnsafe(s, ...p)
    async function poser(role, compte) {
      const claims = JSON.stringify(compte ? { sub: compte.id, role, email: compte.email, aud: 'authenticated' } : { role })
      await exec(`select set_config('request.jwt.claims', $1, true)`, claims)
      await exec(`select set_config('request.jwt.claim.sub', $1, true)`, compte ? compte.id : '')
      await exec(`set local role ${role}`)
    }
    async function lever() {
      await exec(`reset role`)
      await exec(`select set_config('request.jwt.claims', '', true)`)
      await exec(`select set_config('request.jwt.claim.sub', '', true)`)
    }
    /** Lit sous un role, puis annule ce qu il a fait (savepoint). */
    async function comme(role, compte, s, ...params) {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      try {
        await poser(role, compte)
        return { ok: true, lignes: json(await sql(s, ...params)) }
      } catch (e) {
        return { ok: false, motif: motif(e) }
      } finally {
        await exec(`rollback to savepoint ${sp}`)
        await lever()
      }
    }
    /** Doit echouer (savepoint annule). */
    async function refuse(s, attendu) {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      try {
        await exec(s)
        return { ok: true }
      } catch (e) {
        const m = motif(e)
        if (attendu) assert.match(m, attendu)
        return { ok: false, motif: m }
      } finally {
        await exec(`rollback to savepoint ${sp}`)
      }
    }
    /** L annuaire vu par un compte (le compteur d appels est annule avec le savepoint). */
    async function annuaire(compte, q = null, filtres = {}, page = 1) {
      const r = await comme('authenticated', compte, `select public.aok_annuaire($1, $2::jsonb, $3::int) as r`, q, JSON.stringify(filtres), page)
      assert.equal(r.ok, true, r.motif)
      return r.lignes[0].r
    }
    const numeros = a => a.membres.map(m => m.numero)

    // --- 0. La garde : le lot 1 d abord ---------------------------------------
    const auditAvant = await auditer(tx)
    const g = await refuse(garde, /Refus/)
    assert.equal(g.ok, false)
    ok(`garde : refuse tant que le lot 1 n est pas passe (« ${g.motif.slice(0, 50)}... »)`)

    // --- 1. Lot 1 puis annuaire ------------------------------------------------
    for (const o of ordres1) await exec(o)
    for (const o of ordres) await exec(o)
    ok(`lot 1 joue (${ordres1.length} ordres), puis l annuaire (${ordres.length} ordres)`)
    for (const o of ordres) await exec(o)
    ok(`annuaire rejouable : ${ordres.length} ordres rejoues sans erreur`)

    // --- 2. Les comptes d essai -------------------------------------------------
    async function inscrire(cle, nomComplet) {
      const id = randomUUID()
      const email = adresse(cle)
      await exec(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
        values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(),
                jsonb_build_object('full_name', $3::text), '{"provider":"google","providers":["google"]}'::jsonb, now(), now())`, id, email, nomComplet)
      const p = (await sql(`select client_number::bigint as n from public.profiles where id = $1::uuid`, id))[0]
      assert.ok(p, 'profil cree par le declencheur')
      return { id, email, numero: num(p.n) }
    }
    async function rendrePublic(c, { nom, bio = null, ville = null, web = false } = {}) {
      await exec(`update public.profiles set profil_public = true, masquer_moteurs = $2, nom_affiche = $3, bio = $4, localisation = $5 where id = $1::uuid`,
        c.id, !web, nom, bio, ville)
    }
    const fiche = async (c, nom) => {
      const id = (await sql(`insert into public.cockpit_membres (nom, prenom, source_entree) values ($1, $2, 'essai') returning membre_id::text as id`, nom, nom.split(' ')[0]))[0].id
      if (c) await exec(`insert into public.cockpit_membre_emails (email, membre_id, principal, verifie) values ($1, $2::uuid, true, true)`, c.email, id)
      return id
    }
    const offre = async slug => (await sql(`select id::text as id from public.academie_offres where slug = $1`, slug))[0].id

    const cockpit = (await sql(`select a.user_id::text as id, lower(u.email) as email from public.cockpit_allowlist a join auth.users u on u.id = a.user_id
        join public.profiles p on p.id = a.user_id where p.role::text = 'admin' order by p.client_number limit 1`))[0]
    assert.ok(cockpit, 'un compte du cockpit')

    const membres = []
    for (let i = 1; i <= 30; i++) membres.push(await inscrire(`m${String(i).padStart(2, '0')}`, `Essai Annuaire ${String(i).padStart(2, '0')}`))
    const [mEquipe, mLive, mSkool, mPremium, mModule, mEtm, mLiveClub10, mGeneve, mAncienInscrit, mAlumni, mAncien] = membres
    const mPrive = membres[28]
    const mDernier = membres[29]
    for (const [i, c] of membres.entries()) {
      if (c === mPrive) continue
      await rendrePublic(c, { nom: `Essai Annuaire ${String(i + 1).padStart(2, '0')}`, bio: 'Membre d essai de l annuaire.', ville: 'Lyon' })
    }
    await rendrePublic(mGeneve, { nom: 'Essai Annuaire 08', bio: 'Scalping sur l or.', ville: 'Genève' })
    await rendrePublic(mDernier, { nom: 'Essai Annuaire 30', bio: 'Le mot zorglub n existe que chez moi.', ville: 'Lille' })
    await exec(`update public.profiles set role = 'admin' where id = $1::uuid`, mEquipe.id)
    // Live Club : une fiche, son adresse, un abonnement actif.
    const fLive = await fiche(mLive, 'Essai Live')
    await exec(`insert into public.cockpit_abonnements (abonnement_id, source, membre_id, offre_id, statut) values ($1, 'stripe', $2::uuid, 'live-club', 'active')`, `essai-annuaire-live-${SUFFIXE}`, fLive)
    const fLive10 = await fiche(mLiveClub10, 'Essai Live Dix')
    await exec(`insert into public.cockpit_abonnements (abonnement_id, source, membre_id, offre_id, statut) values ($1, 'stripe', $2::uuid, 'live-club', 'trialing')`, `essai-annuaire-live10-${SUFFIXE}`, fLive10)
    await exec(`insert into public.skool_members (email, name) values ($1, 'Essai')`, mLiveClub10.email)
    // 10% Club : Skool, ou un acces premium-skool.
    await exec(`insert into public.skool_members (email, name) values ($1, 'Essai')`, mSkool.email)
    await exec(`insert into public.academie_acces (email, offre_id, source, pose_par) values ($1, $2::uuid, 'migration_skool', 'essai')`, mPremium.email, await offre('premium-skool'))
    // Eleve : un module achete, ou le statut ETM.
    await exec(`insert into public.academie_acces (user_id, offre_id, source, pose_par) values ($1::uuid, $2::uuid, 'stripe', 'essai')`, mModule.id, await offre('module-journaling'))
    const fEtm = await fiche(mEtm, 'Essai Etm')
    await exec(`insert into public.cockpit_statut_etm (membre_id, note, pose_par) values ($1::uuid, 'essai', $2::uuid)`, fEtm, cockpit.id)
    // Inscrit il y a 60 jours : hors « recemment inscrits ».
    await exec(`update public.profiles set created_at = now() - interval '60 days' where id = $1::uuid`, mAncienInscrit.id)
    // Anciennete : une reservation du lot 1, posee sur un compte d essai.
    await exec(`insert into public.aok_anciens_membres (numero, personne_id, nom, epoque, premiere_activite) values (21, $1, 'Essai Ancien', 'izitrade', '2018-06-02')`, `p-essai-annuaire-${SUFFIXE}`)
    await exec(`select public.aok_anciens_poser(21, $1::uuid, 'confirmation', null)`, mAncien.id)
    mAncien.numero = 21
    // Les visiteurs : un gratuit et un eleve, profils prives.
    const vGratuit = await inscrire('vg', 'Visiteur Gratuit')
    const vEleve = await inscrire('ve', 'Visiteur Eleve')
    await exec(`insert into public.academie_acces (user_id, offre_id, source, pose_par) values ($1::uuid, $2::uuid, 'stripe', 'essai')`, vEleve.id, await offre('module-psychologie-et-emotions'))
    const nbPublics = membres.length - 1
    ok(`comptes d essai : ${membres.length} membres (${nbPublics} publics, 1 prive), equipe, Live Club, 10% Club (Skool, premium-skool), eleve (module, ETM), ancien n 21, 2 visiteurs prives`)

    // Alumni : pose depuis le cockpit, sur une fiche reliee au compte d essai par son adresse.
    const fAlumni = await fiche(mAlumni, 'Essai Alumni')
    await poser('authenticated', cockpit)
    const pose = json((await sql(`select public.aok_badge_poser($1::uuid, 'alumni', 'essai') as r`, fAlumni))[0].r)
    const repose = json((await sql(`select public.aok_badge_poser($1::uuid, 'alumni', null) as r`, fAlumni))[0].r)
    await lever()
    assert.ok(pose.alumni && pose.alumni.pose_le, 'alumni pose')
    assert.equal(pose.comptes.length, 1)
    assert.equal(pose.comptes[0].numero, mAlumni.numero)
    assert.equal(pose.comptes[0].public, true)
    assert.deepEqual(pose.comptes[0].badges.map(b => b.badge), ['alumni'])
    assert.equal(num((await sql(`select count(*) as n from public.aok_badges where membre_id = $1::uuid`, fAlumni))[0].n), 1)
    assert.equal(repose.alumni_retires, 0)
    ok(`cockpit : « Poser le badge Alumni » sur la fiche, le compte relie (1, public) le porte ; un second clic ne double pas la ligne`)

    // --- 3. L annuaire : statuts, gratuit, eleve -------------------------------
    const eleve = await annuaire(vEleve)
    assert.equal(eleve.vue, 'complete')
    assert.equal(eleve.limite, null)
    assert.equal(eleve.total, nbPublics)
    assert.equal(eleve.vus, nbPublics)
    assert.equal(eleve.trouves, nbPublics)
    assert.equal(eleve.membres.length, 24)
    assert.equal(eleve.suivante, true)
    assert.equal(eleve.moi_public, false)
    assert.ok(!numeros(eleve).includes(mPrive.numero), 'profil prive absent')
    const statutDe = (a, c) => a.membres.find(m => m.numero === c.numero)?.statut
    assert.equal(eleve.membres[0].numero, mEquipe.numero, 'l equipe en tete')
    assert.equal(eleve.membres[1].numero, 21, 'puis l ancien n 21 (plus petit numero, aucune activite le mois dernier)')
    assert.equal(statutDe(eleve, mEquipe), 'equipe')
    assert.equal(statutDe(eleve, mLive), 'live_club')
    assert.equal(statutDe(eleve, mLiveClub10), 'live_club')
    assert.equal(statutDe(eleve, mSkool), 'club_10')
    assert.equal(statutDe(eleve, mPremium), 'club_10')
    assert.equal(statutDe(eleve, mModule), 'eleve')
    assert.equal(statutDe(eleve, mEtm), 'eleve')
    assert.equal(statutDe(eleve, mGeneve), 'communaute')
    const cle = eleve.membres.find(m => m.numero === mGeneve.numero)
    assert.deepEqual(Object.keys(cle).sort(), ['badges', 'bio', 'localisation', 'masquer_moteurs', 'moi', 'niveau', 'nom', 'numero', 'photo', 'progres', 'statut'])
    assert.ok(!JSON.stringify(eleve).includes('@'), 'aucune adresse dans la reponse')
    assert.ok(!JSON.stringify(eleve).includes(mGeneve.id), 'aucun uuid dans la reponse')
    const page2 = await annuaire(vEleve, null, {}, 2)
    assert.equal(page2.membres.length, nbPublics - 24)
    assert.equal(page2.suivante, false)
    assert.ok(numeros(page2).includes(mDernier.numero))
    ok(`eleve (module) : vue complete, ${eleve.total} publics, page 1 = 24, page 2 = ${page2.membres.length}, prive absent, equipe puis n 21 en tete ; statuts equipe, Live Club (actif et essai), 10% Club (Skool, premium-skool), eleve (module, ETM), communaute ; ni adresse ni uuid`)

    const badgesDe = (a, c) => (a.membres.find(m => m.numero === c.numero)?.badges ?? []).map(b => b.libelle)
    assert.deepEqual(badgesDe(eleve, mAlumni), ['Alumni'])
    assert.deepEqual(badgesDe(eleve, mAncien), ['Depuis IziTrade'])
    assert.deepEqual(badgesDe(eleve, mModule), [])
    ok(`badges dans l annuaire : Alumni (pose au cockpit), « Depuis IziTrade » (reservation du lot 1), rien ailleurs`)

    const gratuit = await annuaire(vGratuit)
    assert.equal(gratuit.vue, 'limitee')
    assert.equal(gratuit.limite, 24)
    assert.equal(gratuit.total, nbPublics)
    assert.equal(gratuit.vus, 24)
    assert.equal(gratuit.membres.length, 24)
    assert.equal(gratuit.suivante, false)
    assert.deepEqual(numeros(gratuit), numeros(eleve), 'les 24 du gratuit = les 24 premiers de l ordre fixe')
    const gratuit2 = await annuaire(vGratuit)
    assert.deepEqual(numeros(gratuit2), numeros(gratuit), 'toujours les memes')
    const autreGratuit = await annuaire(mGeneve)
    assert.deepEqual(numeros(autreGratuit), numeros(gratuit), 'les memes pour un autre compte gratuit')
    assert.ok(!numeros(gratuit).includes(mDernier.numero))
    // La coupe AVANT les filtres : chercher le membre hors des 24 ne le trouve pas.
    const cherche = await annuaire(vGratuit, 'zorglub')
    assert.equal(cherche.trouves, 0)
    assert.equal(cherche.membres.length, 0)
    const page2g = await annuaire(vGratuit, null, {}, 2)
    assert.equal(page2g.membres.length, 0)
    const elevesG = await annuaire(vGratuit, null, { statuts: ['communaute', 'eleve', 'club_10', 'live_club'], recents: true, niveaux: ['1-3', '4-6', '7-9'] })
    assert.ok(elevesG.trouves <= 24)
    for (const m of elevesG.membres) assert.ok(numeros(gratuit).includes(m.numero))
    const chercheEleve = await annuaire(vEleve, 'zorglub')
    assert.deepEqual(numeros(chercheEleve), [mDernier.numero])
    ok(`gratuit : vue limitee, 24 sur ${gratuit.total}, les memes a chaque appel et pour un autre gratuit ; « zorglub » (membre hors des 24) : 0 pour lui, 1 pour l eleve ; page 2 vide ; aucun filtre ne sort des 24`)

    // --- Recherche et filtres (vue complete) ---------------------------------------
    assert.deepEqual(numeros(await annuaire(vEleve, 'geneve')), [mGeneve.numero])
    assert.deepEqual(numeros(await annuaire(vEleve, 'GENÈVE')), [mGeneve.numero])
    assert.deepEqual(numeros(await annuaire(vEleve, 'scalping')), [mGeneve.numero])
    assert.equal((await annuaire(vEleve, '%')).trouves, 0, 'le % est un caractere, pas un joker')
    assert.equal((await annuaire(vEleve, '_')).trouves, 0, 'le _ est un caractere, pas un joker')
    assert.equal((await annuaire(vEleve, 'Essai Annuaire 1')).trouves, 10, 'nom : 10 a 19')
    const recents = await annuaire(vEleve, null, { recents: true })
    assert.equal(recents.trouves, nbPublics - 1)
    assert.ok(!numeros(recents).includes(mAncienInscrit.numero) && !numeros((await annuaire(vEleve, null, { recents: true }, 2))).includes(mAncienInscrit.numero))
    const fLiveClub = await annuaire(vEleve, null, { statuts: ['live_club'] })
    assert.deepEqual(numeros(fLiveClub).sort((a, b) => a - b), [mLive.numero, mLiveClub10.numero].sort((a, b) => a - b))
    const fClub = await annuaire(vEleve, null, { statuts: ['club_10'] })
    assert.deepEqual(numeros(fClub).sort((a, b) => a - b), [mSkool.numero, mPremium.numero, mLiveClub10.numero].sort((a, b) => a - b))
    const fEleve = await annuaire(vEleve, null, { statuts: ['eleve'] })
    assert.deepEqual(numeros(fEleve).sort((a, b) => a - b), [mModule.numero, mEtm.numero].sort((a, b) => a - b))
    const fComm = await annuaire(vEleve, null, { statuts: ['communaute'] })
    assert.equal(fComm.trouves, nbPublics - 7, 'tous sauf equipe, 2 Live Club, 2 10% Club, 2 eleves')
    assert.equal((await annuaire(vEleve, null, { statuts: ['equipe'] })).trouves, nbPublics, 'equipe : valeur ignoree, pas de filtre')
    assert.equal((await annuaire(vEleve, null, { niveaux: ['4-6'] })).trouves, 0)
    assert.equal((await annuaire(vEleve, null, { niveaux: ['1-3'] })).trouves, nbPublics)
    assert.equal((await annuaire(vEleve, null, { statuts: ['live_club', 'eleve'] })).trouves, 4)
    const bizarre = await annuaire(vEleve, `${'x'.repeat(200)}`, { statuts: 'tout', niveaux: [1, null, { a: 1 }], recents: 'oui' }, 9999)
    assert.equal(bizarre.page, 40)
    assert.equal(bizarre.trouves, 0)
    ok(`recherche sans accents ni casse (geneve, GENÈVE), dans la bio, % et _ litteraux ; recents (60 jours exclu), statut Live Club (2), 10% Club (3, dont le Live Club), eleve (2), communaute, niveau ; entrees farfelues bornees (page 40, filtres ignores)`)

    // --- Le badge sur /membres/<n> et dans Mon espace ---------------------------------
    let r = await comme('anon', null, `select numero, badges from public.aok_badges_membres(array[21, $1::bigint]::bigint[])`, mAlumni.numero)
    assert.equal(r.ok, true); assert.equal(r.lignes.length, 0)
    r = await comme('authenticated', vGratuit, `select numero, badges from public.aok_badges_membres(array[21, $1::bigint, $2::bigint]::bigint[])`, mAlumni.numero, mPrive.numero)
    assert.equal(r.ok, true)
    assert.deepEqual(r.lignes.map(x => x.numero).sort((a, b) => a - b), [21, mAlumni.numero].sort((a, b) => a - b))
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await exec(`update public.profiles set masquer_moteurs = false where id = $1::uuid`, mAncien.id)
      r = await comme('anon', null, `select numero, badges from public.aok_badges_membres(array[21, $1::bigint]::bigint[])`, mAlumni.numero)
      assert.equal(r.lignes.length, 1); assert.equal(r.lignes[0].badges[0].libelle, 'Depuis IziTrade')
      await exec(`rollback to savepoint ${sp}`)
    }
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await exec(`update public.profiles set profil_public = false where id = $1::uuid`, mAlumni.id)
      r = await comme('authenticated', mAlumni, `select numero, badges from public.aok_badges_membres(array[$1::bigint]::bigint[])`, mAlumni.numero)
      assert.equal(r.lignes.length, 1); assert.equal(r.lignes[0].badges[0].libelle, 'Alumni')
      r = await comme('authenticated', vGratuit, `select numero from public.aok_badges_membres(array[$1::bigint]::bigint[])`, mAlumni.numero)
      assert.equal(r.lignes.length, 0)
      await exec(`rollback to savepoint ${sp}`)
    }
    r = await comme('authenticated', vGratuit, `select count(*)::int as n from public.aok_badges_membres(array(select generate_series(1, 2000))::bigint[])`)
    assert.ok(r.lignes[0].n <= 48)
    ok(`aok_badges_membres : anon ne voit qu un profil « web », un connecte voit les profils publics, soi meme prive voit son badge, un prive ne sort pas pour les autres, 48 numeros au plus`)

    // --- 4. Le plafond d appels ---------------------------------------------------------
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await poser('authenticated', vGratuit)
      await sql(`select public.aok_annuaire(null, '{}'::jsonb, 1)`)
      await sql(`select public.aok_annuaire('lyon', '{}'::jsonb, 1)`)
      await lever()
      const compteur = num((await sql(`select n from public.aok_annuaire_appels where user_id = $1::uuid and heure = date_trunc('hour', now())`, vGratuit.id))[0].n)
      assert.equal(compteur, 2)
      await exec(`update public.aok_annuaire_appels set n = 60 where user_id = $1::uuid`, vGratuit.id)
      await poser('authenticated', vGratuit)
      const coupe = json((await sql(`select public.aok_annuaire(null, '{}'::jsonb, 1) as r`))[0].r)
      await lever()
      assert.equal(coupe.plafond, 'compte')
      assert.equal(coupe.membres, undefined)
      const autre = await annuaire(vEleve)
      assert.equal(autre.vue, 'complete')
      await exec(`insert into public.aok_annuaire_appels (user_id, heure, n) values ($1::uuid, date_trunc('hour', now()), 5000)
        on conflict (user_id, heure) do update set n = 5000`, mEquipe.id)
      const site = await annuaire(vEleve)
      assert.equal(site.plafond, 'site')
      // Le menage : une ligne de plus de deux jours part au premier appel d une heure.
      await exec(`insert into public.aok_annuaire_appels (user_id, heure, n) values ($1::uuid, date_trunc('hour', now()) - interval '3 days', 4)`, mModule.id)
      await poser('authenticated', mModule)
      await sql(`select public.aok_annuaire(null, '{}'::jsonb, 1)`)
      await lever()
      assert.equal(num((await sql(`select count(*) as n from public.aok_annuaire_appels where heure < now() - interval '2 days'`))[0].n), 0)
      await exec(`rollback to savepoint ${sp}`)
    }
    ok(`plafond : le compteur suit chaque appel (2), au 61e appel de l heure « plafond compte » sans aucun membre, un autre compte passe, 5 000 appels du site : « plafond site » ; lignes de plus de 2 jours effacees`)

    // --- 5. RLS et droits ------------------------------------------------------------------
    r = await comme('anon', null, `select public.aok_annuaire(null, '{}'::jsonb, 1)`)
    assert.equal(r.ok, false)
    for (const f of [`public.aok_badges_fiche('${fAlumni}'::uuid)`, `public.aok_badge_poser('${fAlumni}'::uuid, 'alumni', null)`,
      `public.aok_badge_retirer('${fAlumni}'::uuid, 'alumni')`, `public.aok_annuaire_acces('${vGratuit.id}'::uuid)`, `public.aok_badges_de('${vGratuit.id}'::uuid)`]) {
      r = await comme('anon', null, `select ${f}`)
      assert.equal(r.ok, false, f)
    }
    r = await comme('anon', null, `select count(*) from public.aok_badges`)
    assert.equal(r.ok, false)
    r = await comme('anon', null, `select count(*) from public.aok_annuaire_appels`)
    assert.equal(r.ok, false)
    ok(`anon : ni l annuaire, ni les fonctions du cockpit, ni les fonctions internes, ni les deux tables (permission refusee)`)

    r = await comme('authenticated', vGratuit, `select count(*)::int as n from public.aok_badges`)
    assert.equal(r.ok, true); assert.equal(r.lignes[0].n, 0)
    r = await comme('authenticated', vGratuit, `select count(*)::int as n from public.aok_annuaire_appels`)
    assert.equal(r.ok, false)
    r = await comme('authenticated', vGratuit, `insert into public.aok_badges (membre_id, badge) values ('${fAlumni}'::uuid, 'alumni')`)
    assert.equal(r.ok, false)
    for (const f of [`public.aok_badges_fiche('${fAlumni}'::uuid)`, `public.aok_badge_poser('${fAlumni}'::uuid, 'alumni', null)`,
      `public.aok_badge_retirer('${fAlumni}'::uuid, 'alumni')`]) {
      r = await comme('authenticated', vGratuit, `select ${f}`)
      assert.equal(r.ok, false, f)
      assert.match(r.motif, /Reserve/)
    }
    for (const f of [`public.aok_annuaire_acces('${vGratuit.id}'::uuid)`, `public.aok_badges_de('${vGratuit.id}'::uuid)`]) {
      r = await comme('authenticated', vGratuit, `select ${f}`)
      assert.equal(r.ok, false, f)
    }
    ok(`membre ordinaire : aok_badges 0 ligne et aucune ecriture, compteur illisible, fiche/poser/retirer refuses (« Reserve... »), fonctions internes refusees`)

    r = await comme('authenticated', cockpit, `select count(*)::int as n from public.aok_badges`)
    assert.equal(r.ok, true); assert.equal(r.lignes[0].n, 1)
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await poser('authenticated', cockpit)
      const retire = json((await sql(`select public.aok_badge_retirer($1::uuid, 'alumni') as r`, fAlumni))[0].r)
      assert.equal(retire.alumni, null)
      assert.equal(retire.alumni_retires, 1)
      assert.deepEqual(retire.comptes[0].badges, [])
      const encore = json((await sql(`select public.aok_badge_poser($1::uuid, 'alumni', null) as r`, fAlumni))[0].r)
      assert.ok(encore.alumni)
      assert.equal(encore.alumni_retires, 1)
      const sans = json((await sql(`select public.aok_badges_fiche($1::uuid) as r`, fLive))[0].r)
      assert.equal(sans.alumni, null)
      assert.equal(sans.comptes[0].numero, mLive.numero)
      await lever()
      r = await comme('authenticated', cockpit, `select public.aok_badge_poser('${fAlumni}'::uuid, 'rentable', null)`)
      assert.equal(r.ok, false)
      await exec(`rollback to savepoint ${sp}`)
    }
    ok(`compte du cockpit : lit les badges, retire (la ligne reste, retiree), repose, fiche sans badge lue, badge inconnu refuse`)

    // --- 6. Les mesures gardees, et les durees : tous les profils reels publics le temps d une mesure ---
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      const appel = async (compte, q = null, filtres = {}) => {
        await poser('authenticated', compte)
        const t = Date.now()
        const x = json((await sql(`select public.aok_annuaire($1, $2::jsonb, 1) as r`, q, JSON.stringify(filtres)))[0].r)
        const d = Date.now() - t
        await lever()
        return { x, d }
      }
      const nbMesures = async () => num((await sql(`select count(*) as n from public.aok_annuaire_mesures`))[0].n)
      await appel(vEleve)
      assert.equal(await nbMesures(), 8)
      await appel(vEleve)
      assert.equal(await nbMesures(), 16)
      await exec(`update public.profiles set profil_public = false where id = $1::uuid`, mEquipe.id)
      await appel(vEleve)
      assert.equal(num((await sql(`select count(*) as n from public.aok_annuaire_mesures where profile_id = $1::uuid`, mEquipe.id))[0].n), 0)
      await exec(`update public.profiles set profil_public = true where id = $1::uuid`, mEquipe.id)
      r = await comme('authenticated', vEleve, `select count(*) from public.aok_annuaire_mesures`)
      assert.equal(r.ok, false)
      ok(`mesures gardees : 8 calculees par appel (8, puis 16), un profil redevenu prive perd la sienne, illisibles depuis le navigateur`)

      await exec(`delete from public.aok_annuaire_mesures`)
      await exec(`update public.profiles set profil_public = true`)
      const tous = num((await sql(`select count(*) as n from public.profiles`))[0].n)
      const froid = await appel(vEleve)
      let appels = 1
      while ((await nbMesures()) < tous && appels < 30) { await appel(vEleve); appels++ }
      assert.equal(await nbMesures(), tous)
      const chaud = await appel(vEleve)
      const limitee = await appel(vGratuit)
      const filtre = await appel(vEleve, 'lyon', { statuts: ['communaute'], niveaux: ['1-3'] })
      assert.equal(chaud.x.total, tous)
      assert.equal(limitee.x.vus, 24)
      await exec(`rollback to savepoint ${sp}`)
      ok(`durees avec ${tous} profils publics (reels + essai) : premier appel (8 mesures) ${froid.d} ms, toutes mesurees en ${appels} appels, puis vue complete ${chaud.d} ms, vue limitee ${limitee.d} ms, recherche et filtres ${filtre.d} ms`)
    }

    // --- 7. verifier:rls dans la transaction ---------------------------------------------------
    const auditApres = await auditer(tx)
    const nouvelles = auditApres.filter(a => !auditAvant.includes(a))
    assert.deepEqual(nouvelles, [], `alertes nouvelles : ${nouvelles.join(' | ')}`)
    ok(`controles de verifier:rls rejoues apres les deux migrations : ${auditApres.length} alerte(s), toutes deja la avant (${auditApres.join(' | ') || 'aucune'}), aucune nouvelle`)

    throw new Annulation()
  }, { timeout: 300000, maxWait: 20000 })
} catch (e) {
  if (!(e instanceof Annulation)) { console.error('ECHEC :', motif(e), '\n', String(e?.stack ?? e).split('\n').slice(0, 8).join('\n')); process.exitCode = 1 }
}

// --- Hors transaction : rien n est reste ---------------------------------------
const apresHors = (await prisma.$queryRawUnsafe(ETAT))[0]
assert.equal(await existe(prisma, 'public.aok_annuaire(text, jsonb, integer)'), false)
assert.equal(await existe(prisma, 'public.aok_anciens_activer(uuid)'), false)
assert.equal(apresHors.badges_la, false)
assert.equal(apresHors.appels_la, false)
assert.equal(apresHors.mesures_la, false)
assert.equal(apresHors.lot1_la, false)
assert.equal(String(apresHors.seq), String(avantHors.seq))
assert.equal(apresHors.appele, avantHors.appele)
assert.equal(String(apresHors.comptes), String(avantHors.comptes))
assert.equal(String(apresHors.publics), String(avantHors.publics))
assert.equal(apresHors.empreinte, avantHors.empreinte)
const restes = num((await prisma.$queryRawUnsafe(`select count(*) as n from auth.users where email like 'essai-annuaire-%@exemple.invalid'`))[0].n)
assert.equal(restes, 0)
ok(`annule : aucune table ni fonction restee (lot 1 compris), ${avantHors.comptes} comptes aux memes numeros et visibilites (max ${avantHors.maxi}, ${avantHors.publics} public), sequence intacte (last_value ${avantHors.seq}), aucun compte d essai`)
await prisma.$disconnect()
console.log(`\n${etapes} etapes, ${process.exitCode ? 'ECHEC' : 'tout est bon'}.`)
