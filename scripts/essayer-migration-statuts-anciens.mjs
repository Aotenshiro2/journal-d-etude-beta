/**
 * ESSAI de la migration 20261110010000_cockpit_parcours_anciens.sql (les
 * statuts des anciens eleves) ET de la nouvelle numerotation du lot 1
 * (20261109234500, version du 10/11 : anciens a partir de 30, inscrits juste
 * apres le dernier ancien, renumerotation a l'import), contre la vraie base,
 * dans UNE transaction TOUJOURS ANNULEE (rien ne reste). Le lot 1, l'annuaire
 * (20261109235500) et les profils par numero (20261109235900) ne sont pas
 * appliques : l'essai les joue d'abord, dans la meme transaction.
 *
 * COURTE A DESSEIN : la renumerotation de l'import prend un verrou exclusif
 * sur profiles (il bloque aussi les lectures du site en ligne) jusqu'a
 * l'annulation : elle passe en DERNIER. Tout ce qui peut se preparer se
 * prepare AVANT le begin (lectures, audit d'avant, liste et decisions de
 * Brice), lock_timeout 5 s, ecritures groupees, et la duree entre le begin et
 * le rollback est mesuree.
 *
 * Ce qui est verifie :
 *   1. les quatre migrations passent, les ordres de donnees du parcours se
 *      rejouent sans rien ajouter , le lot 1 ne renumerote plus rien (comptes
 *      et sequence intacts apres lui) ,
 *   2. les statuts calcules par la base = ceux de la liste (miroir du script),
 *      personne par personne , formateurs exclus, Marco « paiement non
 *      termine » , droits proposes avant les decisions de Brice ,
 *   3. les gestes du fonds (poser et retirer un ETM sans fiche, exclure d'un
 *      groupe et annuler, corriger un groupe, VIP) , RLS : un membre du
 *      cockpit sans le fonds lit le parcours de SA fiche seulement, un compte
 *      ordinaire et l'anonyme rien, fonctions internes fermees , les controles
 *      de verifier:rls rejoues dans la transaction : rien de neuf ,
 *   4. l'IMPORT REEL (lib-importer-anciens.mjs, la liste validee, ETM
 *      compris) : reservations, Marlon Wricka, reglages, ETM, activation,
 *      renumerotation juste apres le dernier ancien, sequence recreee, un
 *      nouvel inscrit prend le numero suivant , rejouable , refus : profil
 *      public, numero de destination pris, aucun ancien, equipe au-dela de 20,
 *      table deja remplie autrement ,
 *   5. le parcours apres l'import (droits de Brice, sans droits, ETM de la
 *      fiche et du registre, paiement non termine, exceptions).
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste. Aucun email ni identifiant complet affiche.
 *
 * 10/11, integration (classement Activite en ligne, plafond des lecons a 10) :
 * les migrations dans l'ordre de mise en ligne (lot 1, parcours, annuaire,
 * profils ; l'import reste en dernier, sa renumerotation verrouille profiles),
 * l'import avec les decisions telles quelles (etm_valide_le pose par Brice),
 * et les empreintes des fonctions du classement, le plafond des lecons, les
 * tables et la sequence compares avant, pendant (aucune migration de la
 * branche ne les touche, aucun nextval avant la renumerotation) et apres.
 *
 * Lancement (depuis le worktree du journal) :
 *   AOK_WORKSPACE=<racine du workspace> node --env-file=.env --env-file=.env.local scripts/essayer-migration-statuts-anciens.mjs
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { appliquer, preparer } from './lib-importer-anciens.mjs'

const LOT1 = '20261109234500_anciens_membres_numeros.sql'
const ANNUAIRE = '20261109235500_aok_annuaire.sql'
const PROFILS = '20261109235900_aok_profils_par_numero.sql'
const PARCOURS = '20261110010000_cockpit_parcours_anciens.sql'
const DOSSIER = 'sites/Aoknowledgecom/supabase/migrations'
const LISTE = '/mnt/d/6_Societe/Pilotage/Academie/anciens-membres/liste-anciens-membres.json'
const DECISIONS = '/mnt/d/6_Societe/Pilotage/Academie/anciens-membres/decisions-brice.json'
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
// Le vrai script d'application coupe AUSSI dans les commentaires : aucun point-virgule n'y est permis.
for (const nom of [LOT1, PARCOURS]) {
  const fautifs = fichier(nom).split('\n').filter(l => l.trim().startsWith('--') && l.includes(';'))
  assert.deepEqual(fautifs, [], `point-virgule dans un commentaire de ${nom}`)
}
const ordres1 = decouper(sansCommentaires(fichier(LOT1)))
const ordres2 = decouper(sansCommentaires(fichier(ANNUAIRE)))
const ordres3 = decouper(sansCommentaires(fichier(PROFILS)))
const ordres = decouper(sansCommentaires(fichier(PARCOURS)))
for (const o of [...ordres1, ...ordres]) assert.match(o, /^(do|create|comment|alter|revoke|grant|drop|notify|insert|select)\b/i, `ordre suspect (point-virgule mal place ?) : ${o.slice(0, 60)}`)
assert.ok(!ordres1.some(o => /aok_numeros_renumeroter\(\)\s*$/.test(o) && /^select/i.test(o)), 'le lot 1 ne doit plus renumeroter')

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
  .find(l => /permission|policy|violates|denied|row-level|does not exist|Refus|Reserve|exception|introuvable|connexion|lock|timeout|differente/i.test(l))?.slice(0, 160) ?? 'refus'
const num = v => (v === null || v === undefined ? null : Number(v))
const json = x => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? Number(v) : v)))
const statutsDe = r => (r?.statuts ?? []).map(s => s.statut).sort()

// --- Avant le begin : tout ce qui se lit et se prepare ---------------------------
const existe = async sig => (await prisma.$queryRawUnsafe(`select to_regprocedure($1) is not null as la`, sig))[0].la
for (const [sig, quoi] of [['public.aok_anciens_activer(uuid)', 'le lot 1'], ['public.aok_annuaire(text, jsonb, integer)', 'l annuaire'],
  ['public.aok_annuaire_gratuits()', 'les profils par numero'], ['public.cockpit_parcours_de(text, uuid)', 'cette migration']]) {
  if (await existe(sig)) throw new Error(`${sig} existe DEJA : ${quoi} est applique, cet essai le rejouerait. Adapter l essai.`)
}
// Les fonctions du classement Activite (en ligne le 10/11) : signature et md5 de leur definition.
const FONCTIONS_CLASSEMENT = ['aok_classement(text, text, integer)', 'aok_points_calcul(uuid, boolean)', 'aok_activite_par_jour(uuid, text)',
  'aok_points_du_jour(integer, integer, integer, integer[])', 'aok_points_bareme_tableau()', 'aok_niveau_de(integer)', 'aok_niveaux_seuils()',
  'aok_telegram_du_compte(uuid)', 'aok_a_un_programme(uuid)', 'aok_points_jours_rafraichir(boolean, text)']
const CLASSEMENT = `select string_agg(f || '=' || coalesce(md5(pg_get_functiondef(to_regprocedure('public.' || f))), 'absente'), ' ' order by f)
  from unnest(array[${FONCTIONS_CLASSEMENT.map(f => `'${f}'`).join(', ')}]) as f`
const ETAT = `select (select last_value from public.member_number_seq) as seq, (select is_called from public.member_number_seq) as appele,
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'client_number') as defaut,
  (select count(*) from public.profiles) as comptes, (select max(client_number) from public.profiles) as maxi,
  (select count(*) from public.profiles where profil_public) as publics,
  (select md5(string_agg(id::text || ':' || client_number::text || ':' || profil_public::text || ':' || coalesce(role::text, ''), ',' order by id)) from public.profiles) as empreinte,
  (select md5(string_agg(id::text || ':' || client_number::text, ',' order by id)) from public.profiles where role::text <> 'admin') as hors_equipe,
  (select md5(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace) as fonctions,
  (select nom || '|' || coalesce(alias, '') from public.cockpit_arch_personnes where personne_id = 'p-marlon') as marlon,
  (select count(*) from public.cockpit_arch_notes) as notes,
  (select count(*) from public.cockpit_statut_etm) as etm,
  (select count(*) from public.cockpit_allowlist) as allowlist,
  to_regclass('public.cockpit_parcours') is not null as parcours_la, to_regclass('public.aok_anciens_membres') is not null as lot1_la,
  (${CLASSEMENT}) as classement,
  (select plafond_jour from public.aok_points_bareme where source = 'lecon_terminee') as plafond_lecons,
  (select md5(string_agg(c.relname::text || ':' || c.relkind::text, ',' order by c.relname)) from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S')) as tables`
const avantHors = (await prisma.$queryRawUnsafe(ETAT))[0]
if (num(avantHors.publics) !== 0) {
  const lesquels = (await prisma.$queryRawUnsafe(`select client_number from public.profiles where profil_public order by client_number`)).map(r => num(r.client_number))
  throw new Error(`${avantHors.publics} profil(s) public(s) (n° ${lesquels.join(', ')}) : la garde du lot 1 refusera, l essai ne peut pas passer`)
}
// Le classement est en ligne (10/11) : ses fonctions et le plafond des lecons ne doivent bouger ni pendant ni apres.
assert.ok(avantHors.classement && !avantHors.classement.includes('absente'), `fonctions du classement : ${avantHors.classement}`)
assert.equal(num(avantHors.plafond_lecons), 10, 'plafond des lecons attendu a 10 (20261110021000)')
const auditAvant = await auditer(prisma)
const brice = (await prisma.$queryRawUnsafe(`select a.user_id::text as id from public.cockpit_allowlist a join public.profiles p on p.id = a.user_id
    where a.acces_fonds and p.client_number = 1 and p.role::text = 'admin'`))[0]?.id
assert.ok(brice, 'compte du fonds (Brice, n 1) introuvable')
const membreSimon = (await prisma.$queryRawUnsafe(`select membre_id::text as m from public.cockpit_membre_telegram where personne_id = 'p-simon-huilier'`))[0]?.m
assert.ok(membreSimon, 'fiche client reliee a p-simon-huilier introuvable')

const liste = JSON.parse(readFileSync(LISTE, 'utf8'))
const decisions = JSON.parse(readFileSync(DECISIONS, 'utf8'))
// Les decisions telles quelles : Brice a valide la liste ETM le 10/11 (etm_valide_le), l'import les pose.
const prep = preparer(liste, decisions)
assert.deepEqual(prep.erreurs, [], `la liste ne passe pas les controles de l import : ${prep.erreurs.join(' | ')}`)
assert.ok(prep.etmValideLe, 'etm_valide_le absent de decisions-brice.json : les ETM ne seraient pas poses')
assert.equal(prep.etm.length, 9, 'les 9 ETM documentes')
const refusTrancher = preparer(liste, { ...decisions, a_trancher: { 'p-essai': '10 ou 3' } })
assert.ok(refusTrancher.erreurs.some(e => /trancher/.test(e)), 'a_trancher non vide doit bloquer l import')
const refusValide = preparer({ ...liste, valide_le: null }, { ...decisions, valide_le: null })
assert.ok(refusValide.erreurs.some(e => /valide_le/.test(e)), 'sans valide_le l import refuse')
ok(`controles avant connexion : la liste validee passe (${prep.reservations.length} reservations, anciens ${prep.anciens.premier} a ${prep.anciens.dernier}), « a_trancher » non vide et liste non validee refusent l import ; aucun point-virgule dans les commentaires`)

// Les statuts attendus : ceux de la liste (calcules par le script, miroir de la migration).
const attendus = new Map()
for (const g of ['anciens', 'a_confirmer', 'epoque_a_confirmer', 'sans_nom', 'equipe', 'exclus']) {
  for (const l of liste[g] ?? []) {
    const sts = (l.statuts ?? []).map(s => s.statut).filter(s => s !== 'etm').sort()
    if (sts.length) attendus.set(l.personne_id, sts)
  }
}
const reserves = new Set(prep.reservations.map(r => r.personne_id))
const lignesAvecCompte = [...liste.anciens, ...liste.equipe]
  .filter(l => reserves.has(l.personne_id) && l.compte_du_site && ['email', 'telegram'].includes(l.compte_du_site.lien))

const SUFFIXE = randomUUID().slice(0, 8)
// Un seul compte d essai, inscrit APRES la renumerotation (la sequence est
// alors celle, recreee, de la transaction : rien ne se consomme pour de bon).
const uInscrit = { id: randomUUID(), email: `essai-statuts-inscrit-${SUFFIXE}@exemple.invalid` }
// Un vrai membre du cockpit autre que Brice (prive du fonds dans la transaction)
// et un vrai compte hors allowlist : lus seulement.
const uEquipe = { id: (await prisma.$queryRawUnsafe(`select a.user_id::text as id from public.cockpit_allowlist a
    where a.user_id <> $1::uuid order by a.created_at limit 1`, brice))[0]?.id }
const uOrdinaire = { id: (await prisma.$queryRawUnsafe(`select p.id::text as id from public.profiles p
    where p.role::text <> 'admin' and not exists (select 1 from public.cockpit_allowlist a where a.user_id = p.id)
    order by p.created_at limit 1`))[0]?.id }
assert.ok(uEquipe.id && uOrdinaire.id, 'comptes de lecture introuvables')

let tBegin = 0
let tRollback = 0
let tMigrations = 0
let tImport = 0
try {
  tBegin = Date.now()
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)
    let n = 0
    const sql = (s, ...p) => tx.$queryRawUnsafe(s, ...p)
    const exec = (s, ...p) => tx.$executeRawUnsafe(s, ...p)
    async function comme(role, uid, s, ...p) {
      await exec(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        JSON.stringify(uid ? { sub: uid, role, aud: 'authenticated' } : { role }), uid ?? '')
      await exec(`set local role ${role}`)
      const r = await sql(s, ...p)
      await exec(`reset role`)
      return json(r)
    }
    /** Doit echouer (savepoint annule). */
    async function refuse(fn) {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      try { await fn(); return { ok: false, motif: 'accepte' } } catch (e) { return { ok: true, motif: motif(e) } } finally {
        await exec(`rollback to savepoint ${sp}`)
        await exec(`reset role`)
      }
    }
    const un = async (s, ...p) => json(await sql(s, ...p))[0]

    // --- 1. Les quatre migrations ---------------------------------------------------
    const tm = Date.now()
    for (const o of ordres1) await exec(o)
    const apresLot1 = await un(`select (select last_value from public.member_number_seq) as seq,
        (select md5(string_agg(id::text || ':' || client_number::text, ',' order by id)) from public.profiles where role::text <> 'admin') as hors_equipe,
        (select array_agg(client_number order by client_number) from public.profiles where role::text = 'admin') as admins`)
    // L'ordre de mise en ligne : lot 1, parcours, annuaire, profils.
    for (const o of ordres) await exec(o)
    for (const o of ordres2) await exec(o)
    for (const o of ordres3) await exec(o)
    tMigrations = Date.now() - tm
    const pendant = await un(`select (${CLASSEMENT}) as classement,
        (select plafond_jour from public.aok_points_bareme where source = 'lecon_terminee') as plafond_lecons,
        (select last_value from public.member_number_seq) as seq, (select is_called from public.member_number_seq) as appele`)
    assert.equal(pendant.classement, avantHors.classement, 'les migrations de la branche ne touchent aucune fonction du classement')
    assert.equal(num(pendant.plafond_lecons), num(avantHors.plafond_lecons), 'plafond des lecons intact')
    assert.deepEqual([num(pendant.seq), pendant.appele], [num(avantHors.seq), avantHors.appele], 'aucun nextval apres les migrations')
    // Rejouable : les ordres de definition sont « if not exists » ou « or replace » ,
    // on rejoue ceux qui ecrivent des donnees (referentiel, groupes, exceptions, calcul).
    const lignesAvant = (await un(`select (select count(*) from public.cockpit_parcours)::int as p, (select count(*) from public.cockpit_parcours_groupes)::int as g`))
    const rejeu = ordres.filter(o => /^(insert|select)\b/i.test(o))
    for (const o of rejeu) await exec(o)
    const lignesApres = (await un(`select (select count(*) from public.cockpit_parcours)::int as p, (select count(*) from public.cockpit_parcours_groupes)::int as g`))
    assert.deepEqual(lignesApres, lignesAvant, 'le rejeu n ajoute rien')
    assert.equal(apresLot1.hors_equipe, avantHors.hors_equipe, 'le lot 1 ne renumerote plus les comptes hors equipe')
    assert.equal(num(apresLot1.seq), num(avantHors.seq), 'le lot 1 ne touche plus la sequence')
    assert.deepEqual(apresLot1.admins, [1, 2, 3, 4], 'Adil 3 et Adrien 4')
    ok(`lot 1 (${ordres1.length} ordres), parcours (${ordres.length}), annuaire (${ordres2.length}), profils (${ordres3.length}) en ${tMigrations} ms ; les ${rejeu.length} ordres de donnees du parcours rejoues sans rien ajouter ; apres le lot 1 : equipe 1, 2, 3, 4, les autres comptes et la sequence intacts (pas de renumerotation dans la migration) ; fonctions du classement a la meme empreinte, plafond des lecons a ${num(pendant.plafond_lecons)}, sequence non appelee`)

    // --- 2. Les statuts calcules = ceux de la liste ---------------------------------
    const parBase = new Map(json(await sql(`select personne_id, array_agg(distinct statut order by statut) as s from public.cockpit_parcours
        where retire_le is null and source = 'archives' group by personne_id`)).map(r => [r.personne_id, r.s]))
    assert.deepEqual([...parBase.keys()].sort(), [...attendus.keys()].sort(), 'memes personnes que la liste')
    for (const [pid, s] of attendus) assert.deepEqual(parBase.get(pid), s, `statuts de ${pid}`)
    const compte1 = Object.fromEntries(json(await sql(`select statut, count(distinct personne_id)::int as n from public.cockpit_parcours
        where retire_le is null group by statut`)).map(r => [r.statut, r.n]))
    assert.deepEqual(compte1, liste.comptes.personnes_par_statut)
    const exc = await un(`select
        (select count(*) from public.cockpit_parcours where personne_id = 'p-mehdi-chergui' and retire_le is null)::int as mehdi,
        (select count(*) from public.cockpit_parcours where personne_id = 'p-adrien-pacheco' and statut = 'kofm' and retire_le is null)::int as adrien_kofm,
        (select bool_and(paiement_incomplet) from public.cockpit_parcours where personne_id = 'p-marco' and retire_le is null) as marco,
        (select count(*) from public.cockpit_parcours_groupes where effet = 'statut' and retire_le is null)::int as groupes,
        public.cockpit_parcours_droits('p-arcade') as arcade, public.cockpit_parcours_droits('p-marco') as d_marco,
        public.cockpit_parcours_droits('p-sami-benguerar') as sami, public.cockpit_parcours_droits('p-boris-fchrt') as boris`)
    assert.deepEqual([exc.mehdi, exc.adrien_kofm, exc.marco, exc.groupes], [0, 0, true, 29])
    assert.equal(exc.arcade.acces, 'formation-complete')
    assert.equal(exc.arcade.regle, 'calcul')
    assert.equal(exc.d_marco.acces, null)
    assert.equal(exc.d_marco.a_decider.length, 1)
    assert.equal(exc.sami.acces, 'formation-complete', 'avant les decisions de Brice, Sami (Deep Knowledge) aurait le 10% Club')
    assert.ok(exc.sami.raisons.some(r => /10% Club au minimum, VIP au cas par cas/.test(r)))
    assert.equal(exc.boris.acces, 'etm', 'Boris : ETM de sa fiche client, par la personne reliee')
    ok(`statuts de la base = statuts de la liste, personne par personne (${attendus.size} personnes : ${Object.entries(compte1).map(([k, v]) => `${k} ${v}`).join(', ')}) ; 29 groupes ; Elgin sans statut de formation, Adrien sans KOFM, Marco « paiement non termine » ; droits avant Brice : Arcade 10% Club (calcul), Marco a decider, Sami 10% Club (mention Deep Knowledge), Boris ETM par sa fiche`)

    // --- 3. Gestes du fonds et RLS (AVANT l import : la renumerotation verrouille profiles) ---
    // AUCUN compte cree ici : la sequence des numeros n est pas transactionnelle,
    // un compte d essai inscrit avant la renumerotation (qui la recree dans la
    // transaction) consommerait pour de bon un numero de la vraie sequence (vu
    // le 10/11 : 21290 et 21291 brules par la premiere version de cet essai).
    // Le membre du cockpit sans le fonds est un vrai compte de l allowlist, prive
    // du fonds le temps de la transaction , le compte ordinaire, un vrai compte
    // hors allowlist, lu seulement.
    await exec(`update public.cockpit_allowlist set acces_fonds = false where user_id = $1::uuid`, uEquipe.id)
    // Une requete par geste : une fonction stable appelee dans la meme requete ne verrait pas l ecriture.
    const g = (await comme('authenticated', brice, `select public.cockpit_parcours_poser('p-djib', 'etm', '2024-01-01'::date, 'essai') as pose`))[0].pose
    const etmPose = g.statuts.find(s => s.statut === 'etm')?.sources.find(s => s.source === 'cockpit')
    assert.ok(etmPose, 'ETM pose sans fiche client')
    assert.equal(g.droits.acces, 'etm')
    assert.equal(g.ecriture, true)
    const g2 = (await comme('authenticated', brice, `select public.cockpit_parcours_retirer($1::uuid, 'essai') as r`, etmPose.id))[0].r
    assert.ok(!statutsDe(g2).includes('etm'))
    const g3 = (await comme('authenticated', brice, `select public.cockpit_parcours_exception('p-djib', 'deep-knowledge', '1675620238', 'exclure', 'essai') as r`))[0].r
    assert.ok(!statutsDe(g3).includes('deep-knowledge'))
    const g4 = (await comme('authenticated', brice, `select public.cockpit_parcours_exception_retirer($1::uuid) as r`, g3.exceptions[0].id))[0].r
    assert.ok(statutsDe(g4).includes('deep-knowledge'))
    const lireMarie = async () => (await comme('authenticated', brice, `select public.cockpit_parcours_de('p-marie-sainte-fabrice') as m`))[0].m
    const g5 = (await comme('authenticated', brice, `select public.cockpit_parcours_groupe('4039668188', 'kofm', 'essai') as r`))[0].r
    assert.ok(g5.ajoutes >= 1)
    assert.ok(statutsDe(await lireMarie()).includes('kofm'))
    await comme('authenticated', brice, `select public.cockpit_parcours_groupe('4039668188', null) as r`)
    assert.ok(!statutsDe(await lireMarie()).includes('kofm'))
    const g6 = (await comme('authenticated', brice, `select public.cockpit_parcours_vip('p-djib', null, true) as v`))[0].v
    assert.equal(g6.droits.acces, 'vip-skool')
    const smmMarco = (await comme('authenticated', brice, `select public.cockpit_parcours_de('p-marco') as m`))[0].m.statuts.find(s => s.statut === 'smm')
    const rArchives = await refuse(() => comme('authenticated', brice, `select public.cockpit_parcours_retirer($1::uuid) as r`, smmMarco.sources[0].id))
    assert.equal(rArchives.ok, true)
    ok(`gestes du fonds : ETM pose sans fiche client puis retire, exclusion d un groupe puis annulee, « Call Formation ict » mis en KOFM puis retire (recalcul), VIP coche ; un statut venu des groupes ne se retire pas a la main (${rArchives.motif.slice(0, 50)})`)

    const eq = (await comme('authenticated', uEquipe.id, `select public.cockpit_parcours_de(null, $1::uuid) as r,
        (select count(*) from public.cockpit_parcours)::int as parcours, (select count(*) from public.cockpit_parcours_statuts)::int as statuts,
        (select count(*) from public.cockpit_parcours_groupes)::int as groupes, (select count(*) from public.cockpit_parcours_reglages)::int as reglages`, membreSimon))[0]
    for (const s of ['deep-knowledge', 'formation-izitrade', 'mentore-izitrade']) assert.ok(statutsDe(eq.r).includes(s), `Simon : ${s}`)
    assert.equal(eq.r.ecriture, false)
    assert.deepEqual([eq.parcours, eq.statuts, eq.groupes, eq.reglages], [0, 6, 0, 0])
    const vipFiche = (await comme('authenticated', uEquipe.id, `select public.cockpit_parcours_vip(null, $1::uuid, true) as r`, membreSimon))[0].r
    assert.equal(vipFiche.droits.acces, 'vip-skool')
    const rEqPersonne = await refuse(() => comme('authenticated', uEquipe.id, `select public.cockpit_parcours_de('p-simon-huilier') as r`))
    const rEqPoser = await refuse(() => comme('authenticated', uEquipe.id, `select public.cockpit_parcours_poser('p-simon-huilier', 'etm') as r`))
    const rOrd = await refuse(() => comme('authenticated', uOrdinaire.id, `select public.cockpit_parcours_de(null, $1::uuid) as r`, membreSimon))
    const ord = (await comme('authenticated', uOrdinaire.id, `select (select count(*) from public.cockpit_parcours)::int as a, (select count(*) from public.cockpit_parcours_statuts)::int as b,
        (select count(*) from public.cockpit_parcours_groupes)::int as c, (select count(*) from public.cockpit_parcours_reglages)::int as d`))[0]
    const rAnon = await refuse(() => comme('anon', null, `select public.cockpit_parcours_de('p-marlon') as r`))
    const droitsFn = await un(`select
        has_function_privilege('anon', 'public.cockpit_parcours_de(text, uuid)', 'execute') as anon_de,
        has_function_privilege('anon', 'public.cockpit_parcours_vip(text, uuid, boolean)', 'execute') as anon_vip,
        has_function_privilege('authenticated', 'public.cockpit_parcours_calcul()', 'execute') as a1,
        has_function_privilege('authenticated', 'public.cockpit_parcours_recalculer()', 'execute') as a2,
        has_function_privilege('authenticated', 'public.cockpit_parcours_lire(text[])', 'execute') as a3,
        has_function_privilege('authenticated', 'public.cockpit_parcours_droits(text)', 'execute') as a4,
        has_function_privilege('authenticated', 'public.cockpit_parcours_droits_de(text[])', 'execute') as a5,
        has_function_privilege('authenticated', 'public.cockpit_parcours_personnes_du_membre(uuid)', 'execute') as a6,
        has_function_privilege('authenticated', 'public.aok_numeros_renumeroter()', 'execute') as a7,
        has_table_privilege('authenticated', 'public.cockpit_parcours', 'insert') as ecrire`)
    for (const [r, quoi] of [[rEqPersonne, /Reserve|permission/], [rEqPoser, /Reserve|permission/], [rOrd, /Reserve|permission/], [rAnon, /permission|denied/]]) {
      assert.equal(r.ok, true)
      assert.match(r.motif, quoi)
    }
    assert.deepEqual(ord, { a: 0, b: 0, c: 0, d: 0 })
    assert.deepEqual(Object.values(droitsFn), Array(10).fill(false))
    ok(`RLS : un membre du cockpit sans le fonds lit le parcours de SA fiche (Simon : formation, mentore, Deep Knowledge) et coche le VIP, ne lit aucune table du fonds (le referentiel seulement), ne lit pas une personne par son identifiant et ne pose rien ; un compte ordinaire et l anonyme : rien ; fonctions internes et renumerotation fermees, aucune ecriture directe`)

    const auditApres = await auditer(tx)
    const nouvelles = auditApres.filter(a => !auditAvant.includes(a))
    assert.deepEqual(nouvelles, [], `alertes nouvelles : ${nouvelles.join(' | ')}`)
    ok(`controles de verifier:rls rejoues apres les quatre migrations : ${auditApres.length} alerte(s), toutes deja la avant (${auditApres.join(' | ') || 'aucune'}), aucune nouvelle`)

    // --- 4. L'import reel, puis la renumerotation ------------------------------------
    // Juste avant : la vraie sequence n a toujours pas ete appelee (rien ne se consomme pour de bon).
    const avantImport = await un(`select (select last_value from public.member_number_seq) as seq, (select is_called from public.member_number_seq) as appele`)
    assert.deepEqual([num(avantImport.seq), avantImport.appele], [num(avantHors.seq), avantHors.appele], 'aucun nextval avant la renumerotation')
    const ti = Date.now()
    const bilan = await appliquer(tx, prep, { ecrire: true })
    tImport = Date.now() - ti
    const ap = await un(`select (select count(*) from public.aok_anciens_membres)::int as reservations,
        (select count(*) from public.aok_anciens_membres where profile_id is not null)::int as actives,
        (select bool_and(p.client_number = a.numero) from public.aok_anciens_membres a join public.profiles p on p.id = a.profile_id) as actives_ok,
        (select nom || '|' || alias from public.cockpit_arch_personnes where personne_id = 'p-marlon') as marlon,
        (select count(*) from public.cockpit_arch_notes where personne_id = 'p-marlon' and rubrique = 'identite' and texte like '%Wricka%')::int as note_marlon,
        (select count(*) from public.cockpit_parcours_reglages)::int as reglages,
        (select count(*) from public.cockpit_parcours where statut = 'etm' and source = 'registre' and retire_le is null)::int as etm,
        (select array_agg(client_number order by client_number) from public.profiles where role::text = 'admin') as admins,
        (select max(client_number) from public.profiles) as maxi,
        (select bool_and(x.client_number = $1::int - 1 + x.rn) from (select client_number, row_number() over (order by created_at, id) as rn
           from public.profiles p where p.role::text <> 'admin'
            and not exists (select 1 from public.aok_anciens_membres a where a.profile_id = p.id)) x) as suite,
        (select last_value from public.member_number_seq) as seq, (select is_called from public.member_number_seq) as appele,
        has_sequence_privilege('authenticated', 'public.member_number_seq', 'usage') as seq_droits,
        (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'client_number') as defaut`,
      prep.anciens.dernier + 1)
    assert.equal(ap.reservations, prep.reservations.length)
    assert.equal(bilan.reservations, prep.reservations.length)
    assert.equal(ap.actives, bilan.actives)
    assert.equal(ap.actives_ok, ap.actives ? true : null)
    assert.ok(ap.marlon.startsWith('Marlon Wricka|') && ap.marlon.split('|')[1].split(',').includes('Wricka'), `Marlon : ${ap.marlon.split('|')[0]}`)
    assert.equal(ap.note_marlon, 1)
    // Les reglages : ceux de Brice, plus le VIP coche sur p-djib et sur la personne de la fiche de Simon pendant l essai.
    assert.ok(ap.reglages >= prep.reglages.length)
    assert.equal(ap.etm, prep.etm.length)
    assert.deepEqual(ap.admins, [1, 2, 3, 4])
    assert.equal(bilan.renumerotation.premier, prep.anciens.dernier + 1, 'les inscrits juste apres le dernier ancien')
    assert.equal(ap.suite, true, 'comptes hors equipe a la suite, dans l ordre d inscription')
    assert.equal(num(ap.maxi), bilan.renumerotation.dernier)
    assert.deepEqual([num(ap.seq), ap.appele, ap.seq_droits, ap.defaut], [bilan.renumerotation.prochain, false, true, "nextval('member_number_seq'::regclass)"])
    // Un nouvel inscrit prend le numero suivant, puis la renumerotation est rejouable sans effet.
    await exec(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
      values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(),
              '{"full_name":"Essai Statuts"}'::jsonb, '{"provider":"google","providers":["google"]}'::jsonb, now(), now())`, uInscrit.id, uInscrit.email)
    const nouveau = num((await un(`select client_number from public.profiles where id = $1::uuid`, uInscrit.id)).client_number)
    assert.equal(nouveau, bilan.renumerotation.prochain, 'un nouvel inscrit prend le numero suivant')
    const rejeu2 = (await un(`select public.aok_numeros_renumeroter() as r`)).r
    assert.equal(rejeu2.renumerotes, 0)
    // Les refus de la renumerotation, puis de l import.
    const rPublic = await refuse(async () => {
      await exec(`update public.profiles set profil_public = true where id = $1::uuid`, uInscrit.id)
      await sql(`select public.aok_numeros_renumeroter()`)
    })
    const rDestination = await refuse(async () => {
      await exec(`update public.profiles set role = 'admin' where client_number = $1::bigint`, bilan.renumerotation.premier + 3)
      await sql(`select public.aok_numeros_renumeroter()`)
    })
    const rAucun = await refuse(async () => {
      await exec(`delete from public.aok_anciens_membres where not equipe`)
      await sql(`select public.aok_numeros_renumeroter()`)
    })
    const rEquipe = await refuse(async () => {
      await exec(`update public.profiles set client_number = 21252 where client_number = 3 and role::text = 'admin'`)
      await sql(`select public.aok_numeros_renumeroter()`)
    })
    const rImport = await refuse(() => appliquer(tx, { ...prep, reservations: prep.reservations.slice(1) }, { ecrire: true }))
    for (const [r, quoi] of [[rPublic, /public/], [rDestination, /destination/], [rAucun, /aucun ancien/], [rEquipe, /au-dela de 20/], [rImport, /differente/]]) {
      assert.equal(r.ok, true, `refus attendu : ${quoi}`)
      assert.match(r.motif, quoi)
    }
    const rejeuImport = await appliquer(tx, prep, { ecrire: true })
    assert.equal(rejeuImport.reservations, 0)
    assert.equal(rejeuImport.renumerotation?.renumerotes ?? 0, 0)
    ok(`import reel en ${tImport} ms : ${ap.reservations} reservations (anciens ${prep.anciens.premier} a ${prep.anciens.dernier}, equipe 5 a 20), ${ap.actives} compte(s) active(s) sur son numero d ancien (la liste en annoncait ${lignesAvecCompte.length} par email ou Telegram), ${bilan.propositions} proposition(s) ; Marlon Wricka (nom, alias, note d identite) ; reglages de Brice ; ${ap.etm} ETM poses ; ${bilan.renumerotation.renumerotes} comptes renumerotes de ${bilan.renumerotation.premier} a ${bilan.renumerotation.dernier}, a la suite, dans l ordre d inscription ; sequence recreee (prochain ${bilan.renumerotation.prochain}, memes droits, meme defaut), un nouvel inscrit prend ${nouveau} ; renumerotation et import rejouables sans effet ; refus : profil public, destination prise, aucun ancien, equipe au-dela de 20, table remplie autrement`)

    // --- 5. Le parcours apres l import, lu par le fonds -----------------------------------
    const lu = (await comme('authenticated', brice, `select public.cockpit_parcours_de('p-loup-claron') as loup, public.cockpit_parcours_de('p-corentin') as corentin,
        public.cockpit_parcours_de('p-sami-benguerar') as sami, public.cockpit_parcours_de('p-boris-fchrt') as boris,
        public.cockpit_parcours_de('p-marco') as marco, public.cockpit_parcours_de('p-mehdi-chergui') as mehdi,
        public.cockpit_parcours_de('p-olivier-blanc') as olivier`))[0]
    assert.equal(lu.loup.droits.regle, 'brice')
    assert.equal(lu.loup.droits.acces, 'vip-skool')
    assert.ok(lu.loup.droits.droits.some(d => d.slug === 'live-club'))
    assert.equal(lu.loup.reglages.vip, true)
    assert.equal(lu.loup.statuts.find(s => s.statut === 'deep-knowledge')?.mention, '10% Club au minimum, VIP au cas par cas')
    assert.ok(statutsDe(lu.corentin).includes('etm'))
    assert.equal(lu.corentin.droits.acces, 'etm')
    assert.ok(lu.corentin.droits.droits.some(d => d.slug === 'formation-complete'), 'Corentin : ETM et 10% Club')
    assert.equal(lu.sami.droits.regle, 'sans_droits')
    assert.equal(lu.sami.droits.acces, null)
    assert.ok(statutsDe(lu.sami).includes('deep-knowledge'))
    assert.equal(lu.olivier.droits.regle, 'sans_droits')
    assert.deepEqual(lu.boris.statuts.find(s => s.statut === 'etm').sources.map(s => s.source).sort(), ['fiche', 'registre'])
    assert.equal(lu.marco.droits.a_decider.length, 1)
    assert.equal(lu.marco.statuts.find(s => s.statut === 'smm').sources[0].paiement_incomplet, true)
    assert.ok(!statutsDe(lu.mehdi).includes('formation-izitrade'))
    assert.equal(lu.mehdi.exceptions.length, 2)
    ok(`apres l import : Loup VIP + Live Club (droits de Brice) et la mention Deep Knowledge ; Corentin ETM et 10% Club ; Sami et Olivier sans droits ; Boris ETM de sa fiche ET du registre ; Marco a decider ; Elgin exclu (2 exceptions)`)

    throw new Annulation()
  }, { timeout: 60000, maxWait: 10000 })
} catch (e) {
  if (!(e instanceof Annulation)) { console.error('ECHEC :', motif(e), '\n', String(e?.stack ?? e).split('\n').slice(0, 8).join('\n')); process.exitCode = 1 }
}
tRollback = Date.now()
console.log(`\nduree du begin au rollback : ${tRollback - tBegin} ms (dont les quatre migrations : ${tMigrations} ms, l import : ${tImport} ms)`)

// --- Hors transaction : rien n est reste -------------------------------------------------
const apresHors = (await prisma.$queryRawUnsafe(ETAT))[0]
assert.deepEqual(json(apresHors), json(avantHors), 'etat de la base identique')
for (const sig of ['public.cockpit_parcours_de(text, uuid)', 'public.aok_numeros_renumeroter()', 'public.aok_annuaire(text, jsonb, integer)',
  'public.aok_anciens_activer(uuid)']) assert.equal(await existe(sig), false, sig)
const restes = num((await prisma.$queryRawUnsafe(`select count(*) as n from auth.users where email like 'essai-statuts-%@exemple.invalid'`))[0].n)
assert.equal(restes, 0)
assert.equal(num(apresHors.plafond_lecons), 10)
for (const t of ['aok_anciens_membres', 'aok_anciens_propositions', 'aok_badges', 'aok_annuaire_appels', 'aok_annuaire_mesures',
  'cockpit_parcours', 'cockpit_parcours_statuts', 'cockpit_parcours_groupes', 'cockpit_parcours_reglages']) {
  assert.equal((await prisma.$queryRawUnsafe(`select to_regclass($1) is null as absente`, `public.${t}`))[0].absente, true, `table restee : ${t}`)
}
ok(`annule : aucune table ni fonction restee (lot 1, annuaire, profils, parcours ; liste des tables identique), ${avantHors.comptes} comptes aux memes numeros, ${avantHors.publics} public, sequence intacte (last_value ${avantHors.seq}, is_called ${avantHors.appele}, meme defaut), fonctions du classement a la meme empreinte, plafond des lecons a ${apresHors.plafond_lecons}, Marlon inchange, notes, statuts ETM et allowlist intacts, aucun compte d essai`)
await prisma.$disconnect()
console.log(`\n${etapes} etapes, ${process.exitCode ? 'ECHEC' : 'tout est bon'}.`)
