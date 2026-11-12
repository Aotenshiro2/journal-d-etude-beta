/**
 * ESSAI de la migration 20261112210000_academie_chat.sql (le salon « Questions
 * de l'academie », 12/11/2026) et des requetes EXACTES de
 * src/lib/academie/chat-academie.ts, contre la vraie base, dans UNE
 * transaction TOUJOURS ANNULEE (lock_timeout 5 s, rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable) : RLS activee et forcee sur
 *      les trois tables, aucun droit pour anon, authenticated, service_role ;
 *      fonctions internes fermees ; policy de lecture du direct ;
 *   2. le direct : aok_chat_diffuser remplacee DANS LA TRANSACTION par une
 *      copie qui range ce qu'elle aurait envoye (realtime.messages n'a encore
 *      aucune partition, Realtime ne la cree qu'a la premiere connexion) ;
 *      l'envoi reel par realtime.send est appele une fois et ne casse rien ;
 *   3. les gestes du journal (role postgres) : envoyer, repondre, quota du jour
 *      de Paris (20 pour un gratuit, la 21e refusee avec sa phrase), le
 *      verrou (une seconde connexion ne peut pas prendre le verrou du compte
 *      tant que la premiere le tient), pouce, masquer, couper et rendre la
 *      parole, plus anciens, message supprime ;
 *   4. les noms : regle du classement (profil web pour tous, profil
 *      « membres » pour un lecteur avec programme, sinon le numero), jamais
 *      d'email ni d'identifiant de compte dans ce que recoit la page ;
 *   5. LECTURES ET ECRITURES REJOUEES sous anon et authenticated (vrai sub) :
 *      tout refuse sur les tables et les fonctions internes ; la policy du
 *      direct : gratuit pour tout compte, programme pour un compte avec
 *      programme seulement ; le texte d'un message masque illisible ;
 *   6. les contraintes.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste (tables, fonctions, policy). Les comptes sont lus en base ; aucun
 * email ni identifiant complet n'est affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-chat-academie.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import * as C from '../src/lib/academie/chat-academie.ts'
import { analyserTexte } from '../src/lib/securite/injection-pur.ts'

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261112210000_academie_chat.sql'
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
const autre = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const court = id => `${String(id).slice(0, 8)}...`
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|policy|violates|denied|row-level|check constraint|not-null/i.test(l))?.trim().slice(0, 110) ?? 'refus'
const big = v => JSON.parse(JSON.stringify(v, (k, x) => typeof x === 'bigint' ? Number(x) : x))

const etat = async c => big((await c.$queryRawUnsafe(`select
  to_regclass('public.aok_chat_messages')::text as messages,
  to_regclass('public.aok_chat_pouces')::text as pouces,
  to_regclass('public.aok_chat_sans_parole')::text as sans_parole,
  to_regprocedure('public.aok_chat_poser(uuid,text,text,integer,uuid,text)')::text as poser,
  (select count(*)::int from pg_policies where schemaname = 'realtime' and policyname = 'aok_chat_ecoute') as policy`))[0])
const avant = await etat(prisma)
if (avant.messages || avant.poser || avant.policy) throw new Error('Le salon existe DEJA en base : cet essai est fait pour la migration pas encore appliquee.')

const debut = Date.now()
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    let n = 0
    const q = async (sql, ...p) => big(await tx.$queryRawUnsafe(sql, ...p))

    /** Un ordre sous un role et un sub donnes, dans un savepoint toujours annule. */
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
    /** Tout le fil vu par un compte, page par page comme « Plus anciens ». */
    async function tous(userId, niveau, equipe) {
      const liste = []
      let avantId = null
      for (let i = 0; i < 20; i++) {
        const p = await C.lireMessages(tx, userId, niveau, avantId, equipe)
        liste.unshift(...p.messages)
        if (!p.plus_anciens || !p.messages.length) break
        avantId = p.messages[0].id
      }
      return liste
    }
    const trouver = async (userId, niveau, equipe, id) => (await tous(userId, niveau, equipe)).find(m => m.id === id) ?? null

    // 1. La migration, deux fois.
    const t0 = Date.now()
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const tMigration = Date.now() - t0
    const rls = await q(`select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force from pg_class c
      where c.oid in ('public.aok_chat_messages'::regclass, 'public.aok_chat_pouces'::regclass, 'public.aok_chat_sans_parole'::regclass) order by 1`)
    assert.equal(rls.length, 3)
    for (const t of rls) assert.deepEqual([t.rls, t.force], [true, true], t.relname)
    const droits = await q(`select t, r, has_table_privilege(r, t, 'select') as s, has_table_privilege(r, t, 'insert') as i,
        has_table_privilege(r, t, 'update') as u, has_table_privilege(r, t, 'delete') as d
      from unnest(array['public.aok_chat_messages', 'public.aok_chat_pouces', 'public.aok_chat_sans_parole']) t,
           unnest(array['anon', 'authenticated', 'service_role']) r`)
    for (const d of droits) assert.deepEqual([d.s, d.i, d.u, d.d], [false, false, false, false], `${d.r} sur ${d.t}`)
    const pols = await q(`select count(*)::int as n from pg_policies where schemaname = 'public' and tablename like 'aok_chat_%'`)
    assert.equal(pols[0].n, 0, 'aucune policy sur les tables : personne ne les lit hors du journal')
    const fonctions = await q(`select p.proname as nom, pg_get_function_identity_arguments(p.oid) as args,
        has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'aok_chat_%' order by 1`)
    assert.equal(fonctions.length, 9)
    for (const f of fonctions) {
      assert.equal(f.anon, false, `anon ne doit pas executer ${f.nom}`)
      assert.equal(f.auth, f.nom === 'aok_chat_lecteur_programme', `authenticated et ${f.nom}`)
    }
    const direct = await q(`select policyname, cmd, roles::text as roles from pg_policies where schemaname = 'realtime' and tablename = 'messages' order by 1`)
    assert.deepEqual(direct.map(p => [p.policyname, p.cmd, p.roles]), [['aok_chat_ecoute', 'SELECT', '{authenticated}']])
    const fk = await q(`select conname, confdeltype::text as d from pg_constraint
      where conrelid in ('public.aok_chat_messages'::regclass, 'public.aok_chat_pouces'::regclass, 'public.aok_chat_sans_parole'::regclass) and contype = 'f' order by 1`)
    assert.deepEqual(Object.fromEntries(fk.map(f => [f.conname, f.d])), {
      aok_chat_messages_reponse_a_fkey: 'n', aok_chat_messages_user_id_fkey: 'c',
      aok_chat_pouces_message_id_fkey: 'c', aok_chat_pouces_user_id_fkey: 'c', aok_chat_sans_parole_user_id_fkey: 'c',
    })
    ok(`migration jouee deux fois (${ordres.length} ordres, ${tMigration} ms) : RLS activee et forcee, aucun droit ni policy sur les 3 tables, `
      + '9 fonctions fermees a anon (seule aok_chat_lecteur_programme ouverte a authenticated), policy de lecture du direct, '
      + 'cascades depuis profiles et reponse_a en set null')

    // 2. Le direct. L'envoi reel ne casse rien (realtime.messages sans partition : avertissement seulement).
    await tx.$executeRawUnsafe(`select 1 from (select public.aok_chat_diffuser('essai', '{"id":"essai"}'::jsonb, null)) as x`)
    await tx.$executeRawUnsafe(`select 1 from (select public.aok_chat_effacer_du_direct(gen_random_uuid(), 'masque')) as x`)
    const parts = await q(`select count(*)::int as n from pg_inherits where inhparent = 'realtime.messages'::regclass`)
    await tx.$executeRawUnsafe(`create temp table chat_essai_direct (n serial, evenement text, sujet text, payload jsonb) on commit drop`)
    await tx.$executeRawUnsafe(`create or replace function public.aok_chat_diffuser(p_evenement text, p_programme jsonb, p_gratuit jsonb)
      returns void language plpgsql security definer set search_path = '' as $fn$
      begin
        if p_programme is not null then insert into pg_temp.chat_essai_direct (evenement, sujet, payload) values (p_evenement, 'academie-chat:programme', p_programme); end if;
        if p_gratuit is not null then insert into pg_temp.chat_essai_direct (evenement, sujet, payload) values (p_evenement, 'academie-chat:gratuit', p_gratuit); end if;
      end $fn$`)
    const diffuse = async (depuis) => q(`select n, evenement, sujet, payload from chat_essai_direct where n > $1 order by n`, depuis)
    const dernier = async () => (await q(`select coalesce(max(n), 0)::int as n from chat_essai_direct`))[0].n
    ok(`direct : realtime.send appele pour de vrai sans erreur (${parts[0].n} partition aujourd'hui dans realtime.messages) ; `
      + 'aok_chat_diffuser remplacee dans la transaction pour lire ce qui partirait')

    // Les comptes, lus en base (lecture seule) : deux gratuits, un avec programme, l'equipe.
    const gratuits = await q(`select p.id::text as id, p.client_number as numero from public.profiles p
       where p.role::text = 'member' and p.client_number is not null
         and (public.aok_annuaire_acces(p.id) ->> 'statut') = 'communaute'
       order by p.created_at limit 2`)
    const [prog] = await q(`select p.id::text as id, p.client_number as numero, (public.aok_annuaire_acces(p.id) ->> 'statut') as statut
        from public.profiles p
       where p.role::text = 'member' and p.client_number is not null
         and (public.aok_annuaire_acces(p.id) ->> 'statut') in ('live_club', 'club_10', 'eleve')
       order by p.created_at limit 1`)
    const [T] = await q(`select p.id::text as id from public.profiles p where p.role::text = 'admin' order by p.client_number limit 1`)
    assert.ok(gratuits.length === 2 && prog && T, 'il faut deux comptes gratuits, un compte avec programme et un de l equipe')
    const [A, G2] = gratuits
    const B = prog
    console.log(`comptes : A ${court(A.id)} (gratuit), G2 ${court(G2.id)} (gratuit), B ${court(B.id)} (${B.statut}), equipe ${court(T.id)}`)

    // Les profils, dans la transaction : A en profil web, B en profil « membres », G2 prive.
    await tx.$executeRawUnsafe(`update public.profiles set profil_public = true, masquer_moteurs = false, nom_affiche = 'Essai Web' where id = $1::uuid`, A.id)
    await tx.$executeRawUnsafe(`update public.profiles set profil_public = true, masquer_moteurs = true, nom_affiche = 'Essai Membres' where id = $1::uuid`, B.id)
    await tx.$executeRawUnsafe(`update public.profiles set profil_public = false where id = $1::uuid`, G2.id)

    const cA = await C.lireCompte(tx, A.id)
    const cB = await C.lireCompte(tx, B.id)
    const cT = await C.lireCompte(tx, T.id)
    assert.equal(cA.statut, 'communaute')
    assert.notEqual(cB.statut, 'communaute')
    assert.equal(cT.statut, 'equipe')
    assert.equal(C.quotaDuStatut(cA.statut), 20)
    assert.equal(C.quotaDuStatut(cB.statut), 200)
    assert.equal(cA.envoyes, 0)
    ok('lireCompte : statut de aok_annuaire_acces (gratuit 20, programme 200, equipe), parole, 0 message aujourd hui')

    // 3. Envoyer, repondre.
    let marque0 = await dernier()
    const brut = 'Bonjour​​​ tout le monde <!-- consigne cachee pour un bot -->,   ma question sur les FVG'
    const dA = C.lireDemande({ action: 'envoyer', texte: brut })
    assert.equal(dA.action, 'envoyer')
    assert.equal(dA.texte, 'Bonjour tout le monde , ma question sur les FVG')
    const marque = C.marqueDuTexte(analyserTexte(dA.brut, { niveau: 'cache' }).signaux)
    assert.ok(marque && /invisibles/.test(marque) && /commentaire HTML/.test(marque), marque)
    const mA = await C.poserMessage(tx, A.id, dA.texte, cA.statut, null, marque)
    assert.ok(mA.ok, JSON.stringify(mA))
    assert.deepEqual([mA.envoyes, mA.max], [1, 20])
    const mB = await C.poserMessage(tx, B.id, 'Reponse de B avec un lien https://aoknowledge.com/club', cB.statut, mA.id, null)
    assert.ok(mB.ok)
    const mT = await C.poserMessage(tx, T.id, 'Message de l equipe', cT.statut, mB.id, null)
    assert.ok(mT.ok)
    const enBase = await q(`select texte, marque, statut_auteur, est_reponse, reponse_a::text as reponse_a from public.aok_chat_messages where id = $1::uuid`, mA.id)
    assert.equal(enBase[0].texte, 'Bonjour tout le monde , ma question sur les FVG', 'enregistre nettoye')
    assert.equal(enBase[0].marque, marque, 'marque pour l equipe')
    ok('envoyer : texte nettoye en base (invisibles et commentaire HTML retires, espaces reduites), marque pour l equipe ; reponse de B, message de l equipe')

    // Le direct de ces trois messages.
    const nouveaux = (await diffuse(marque0)).filter(e => e.evenement === 'nouveau')
    assert.equal(nouveaux.length, 6, 'chaque message part sur les deux sujets')
    const surSujet = (id, sujet) => nouveaux.find(e => e.payload.id === id && e.sujet === sujet).payload
    const pA = surSujet(mA.id, 'academie-chat:gratuit')
    assert.deepEqual(Object.keys(pA).sort(), ['auteur', 'cree_le', 'id', 'liens', 'pouces', 'reponse_a', 'texte'])
    assert.deepEqual(Object.keys(pA.auteur).sort(), ['equipe', 'nom', 'numero', 'statut'])
    assert.equal(pA.auteur.nom, 'Essai Web', 'profil web : nom pour tous')
    assert.equal(pA.liens, false, 'un gratuit : liens en texte')
    const pBg = surSujet(mB.id, 'academie-chat:gratuit')
    const pBp = surSujet(mB.id, 'academie-chat:programme')
    assert.equal(pBg.auteur.nom, null, 'profil membres : pas de nom pour un gratuit')
    assert.equal(pBg.auteur.numero, B.numero, 'le numero a la place')
    assert.equal(pBp.auteur.nom, 'Essai Membres', 'profil membres : nom pour un programme')
    assert.equal(pBp.liens, true)
    assert.equal(pBp.reponse_a.etat, 'visible')
    assert.equal(pBp.reponse_a.extrait, enBase[0].texte)
    const pT = surSujet(mT.id, 'academie-chat:programme')
    assert.deepEqual(pT.auteur, { equipe: true, numero: null, nom: null, statut: 'equipe' })
    for (const e of nouveaux) {
      const s = JSON.stringify(e.payload)
      assert.ok(!s.includes(A.id) && !s.includes(B.id) && !s.includes(T.id), 'aucun identifiant de compte dans le direct')
      assert.ok(!/@/.test(s.replace(/https:\/\/[^\s"]+/g, '')), 'aucun email')
      assert.ok(!('marque' in e.payload), 'la marque ne part pas dans le direct')
    }
    ok('direct « nouveau » : deux sujets ; nom selon la regle du classement (web pour tous, membres pour un programme, sinon numero), '
      + 'Equipe AOK sans nom ni numero, liens selon l auteur, ni identifiant de compte, ni email, ni marque')

    // Le verrou : une seconde connexion ne peut pas prendre le verrou du compte A tant que cette transaction le tient.
    const pris = big(await autre.$queryRawUnsafe(`select pg_try_advisory_xact_lock(hashtextextended('aok_chat_poser:' || $1, 0)) as pris`, A.id))
    assert.equal(pris[0].pris, false, 'le verrou du compte est tenu jusqu a la fin de la transaction')
    const libre = big(await autre.$queryRawUnsafe(`select pg_try_advisory_xact_lock(hashtextextended('aok_chat_poser:' || $1, 0)) as pris`, G2.id))
    assert.equal(libre[0].pris, true, 'un autre compte n attend pas')
    ok('verrou : une seconde connexion ne peut pas prendre le verrou d envoi de A pendant son envoi (deux envois simultanes passent l un apres l autre) ; un autre compte n attend pas')

    // Le quota du jour de Paris : 20 pour A ; la 21e refusee ; un message d hier ne compte pas.
    for (let i = 2; i <= 20; i++) {
      const r = await C.poserMessage(tx, A.id, `Essai ${i}`, cA.statut, null, null)
      assert.ok(r.ok && r.envoyes === i, `envoi ${i}`)
    }
    const refus = await C.poserMessage(tx, A.id, 'Une de trop', cA.statut, null, null)
    assert.deepEqual(refus, { ok: false, refus: 'quota', envoyes: 20, max: 20 })
    assert.equal(C.messageRefus('quota', { max: 20, niveau: 'gratuit' }), "Tu as écrit tes 20 messages d'aujourd'hui. Les membres d'un programme en ont 200.")
    await tx.$executeRawUnsafe(`update public.aok_chat_messages set cree_le = ((date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris') - interval '1 minute'
      where id = (select id from public.aok_chat_messages where user_id = $1::uuid and texte = 'Essai 20')`, A.id)
    const apres = await C.poserMessage(tx, A.id, 'Le lendemain en somme', cA.statut, null, null)
    assert.ok(apres.ok && apres.envoyes === 20, 'le message passe a 23 h 59 hier ne compte plus')
    assert.equal((await C.lireCompte(tx, A.id)).envoyes, 20)
    ok('quota : 20 messages pour un gratuit, le 21e refuse avec sa phrase ; un message d avant minuit (Paris) ne compte pas')
    const p3 = []
    for (let i = 0; i < 4; i++) p3.push((await q(C.SQL_POSER, G2.id, `Petit quota ${i}`, 'communaute', 3, null, null))[0].r)
    assert.deepEqual(p3.map(r => r.refus ?? 'ok'), ['ok', 'ok', 'ok', 'quota'])
    ok('quota passe par le journal (p_max) : 3 envois puis refus')

    // Repondre a un message inconnu.
    const inconnu = await C.poserMessage(tx, B.id, 'Reponse a rien', cB.statut, '00000000-0000-4000-8000-000000000000', null)
    assert.deepEqual(inconnu, { ok: false, refus: 'reponse', envoyes: undefined, max: undefined })

    // 4. Lire : ce que voit chacun.
    const lA = await C.lireMessages(tx, A.id, 'gratuit', null, false)
    const lB = await C.lireMessages(tx, B.id, 'programme', null, false)
    const lT = await C.lireMessages(tx, T.id, 'programme', null, true)
    assert.ok(lA.messages.length >= 3)
    const vB_A = lA.messages.find(m => m.id === mB.id)
    const vB_B = lB.messages.find(m => m.id === mB.id)
    assert.equal(vB_A.auteur.nom, null)
    assert.equal(vB_B.auteur.nom, 'Essai Membres')
    for (const m of [...lA.messages, ...lB.messages]) {
      assert.ok(!('marque' in m) && !('auteur_sans_parole' in m), 'la marque et la parole des autres : equipe seulement')
      const s = JSON.stringify(m)
      assert.ok(!s.includes(A.id) && !s.includes(B.id) && !s.includes(T.id))
    }
    assert.equal(lT.messages.find(m => m.id === mA.id).marque, marque, 'l equipe voit la marque')
    const tri = lA.messages.map(m => m.cree_le + m.id)
    assert.deepEqual(tri, [...tri].sort(), 'du plus ancien au plus recent')
    ok('lire : chacun selon son niveau, la marque pour l equipe seulement, aucun identifiant de compte, ordre chronologique')

    // Plus anciens : 60 messages de B (programme), 50 puis le reste.
    for (let i = 0; i < 60; i++) await C.poserMessage(tx, B.id, `Fil ${i}`, cB.statut, null, null)
    const page1 = await C.lireMessages(tx, B.id, 'programme', null, false)
    assert.equal(page1.messages.length, 50)
    assert.equal(page1.plus_anciens, true)
    const page2 = await C.lireMessages(tx, B.id, 'programme', page1.messages[0].id, false)
    assert.ok(page2.messages.length > 0)
    const ids = new Set(page1.messages.map(m => m.id))
    assert.ok(page2.messages.every(m => !ids.has(m.id)), 'aucun doublon entre les pages')
    assert.ok(page2.messages.at(-1).cree_le <= page1.messages[0].cree_le)
    const plan = await q(`explain ${C.SQL_LIRE.replaceAll('$1::uuid', `'${B.id}'::uuid`).replaceAll('$2', `'programme'`).replaceAll('$3::uuid', 'null::uuid').replaceAll('$4::boolean', 'false').replaceAll('$5::int', '51')}`)
    const texte = plan.map(l => Object.values(l)[0]).join(' ')
    ok(`plus anciens : 50 derniers puis ${page2.messages.length} d avant, sans doublon (${/aok_chat_messages_fil_idx/.test(texte) ? 'index du fil utilise' : 'plan sans l index du fil (table encore petite)'})`)

    // Pouce.
    marque0 = await dernier()
    const p1 = await C.basculerPouce(tx, A.id, mB.id)
    assert.deepEqual(p1, { id: mB.id, pouces: 1, pouce_moi: true })
    const p2 = await C.basculerPouce(tx, G2.id, mB.id)
    assert.deepEqual(p2, { id: mB.id, pouces: 2, pouce_moi: true })
    const p1b = await C.basculerPouce(tx, A.id, mB.id)
    assert.deepEqual(p1b, { id: mB.id, pouces: 1, pouce_moi: false })
    const evPouces = (await diffuse(marque0)).filter(e => e.evenement === 'pouces').map(e => e.payload)
    assert.deepEqual(evPouces.filter((_, i) => i % 2 === 0).map(p => p.pouces), [1, 2, 1])
    assert.ok(evPouces.every(p => Object.keys(p).sort().join() === 'id,pouces'))
    const vuG2 = await trouver(G2.id, 'gratuit', false, mB.id)
    assert.deepEqual([vuG2.pouce_moi, vuG2.pouces], [true, 1])
    assert.equal((await trouver(A.id, 'gratuit', false, mB.id)).pouce_moi, false)
    ok('pouce : un par compte, un second clic l enleve, compte rendu ; direct « pouces » { id, pouces } seulement')

    // Masquer (equipe) : le message de B, que T citait.
    marque0 = await dernier()
    assert.equal(await C.masquerMessage(tx, mB.id, T.id), true)
    assert.equal(await C.masquerMessage(tx, mB.id, T.id), false, 'deja masque')
    const evMasque = (await diffuse(marque0))
    assert.deepEqual(evMasque.map(e => [e.evenement, e.sujet, Object.keys(e.payload).join()]), [
      ['masque', 'academie-chat:programme', 'id'], ['masque', 'academie-chat:gratuit', 'id'],
    ])
    assert.equal(await C.vueDe(tx, mB.id, 'programme'), null, 'la vue d un message masque est vide')
    const filA = await tous(A.id, 'gratuit', false)
    const filT = await tous(T.id, 'programme', true)
    assert.ok(filA.length > 80 && filA.length === filT.length, 'tout le fil, page par page')
    assert.ok(!filA.some(m => m.id === mB.id) && !filT.some(m => m.id === mB.id), 'il disparait de la lecture, equipe comprise')
    const citant = filA.find(m => m.id === mT.id)
    assert.deepEqual(citant.reponse_a, { etat: 'masque' }, 'la reponse qui le citait dit « message masque », sans texte')
    assert.ok(!JSON.stringify(filA).includes('Reponse de B') && !JSON.stringify(filT).includes('Reponse de B'), 'le texte masque ne sort nulle part')
    assert.equal(await C.basculerPouce(tx, A.id, mB.id), null, 'pas de pouce sur un message masque')
    const rMasque = await C.poserMessage(tx, T.id, 'Reponse a un masque', 'equipe', mB.id, null)
    assert.ok(rMasque.ok, 'repondre a un message masque entre-temps reste possible (citation masquee)')
    ok('masquer : equipe, une fois ; direct « masque » { id } seulement ; texte illisible par la lecture et les citations ; plus de pouce')

    // Couper et rendre la parole.
    assert.equal(await C.couperParole(tx, mA.id, T.id, 'Essai de coupure'), 'fait')
    assert.equal(await C.couperParole(tx, mA.id, T.id, null), 'deja')
    assert.equal(await C.couperParole(tx, mT.id, T.id, null), 'equipe', 'on ne coupe pas la parole a l equipe')
    assert.equal(await C.couperParole(tx, '00000000-0000-4000-8000-000000000000', T.id, null), 'introuvable')
    assert.deepEqual(await C.poserMessage(tx, A.id, 'Encore moi', 'communaute', null, null), { ok: false, refus: 'parole', envoyes: undefined, max: undefined })
    assert.equal((await C.lireCompte(tx, A.id)).sans_parole, true)
    const liste = await C.listeSansParole(tx)
    const ligne = liste.find(l => l.numero === A.numero)
    assert.ok(ligne && ligne.raison === 'Essai de coupure' && ligne.nom === 'Essai Web')
    assert.ok(liste.every(l => Object.keys(l).sort().join() === 'coupee_le,nom,numero,raison'), 'ni email ni identifiant')
    // Le message de A est loin derriere les 60 de B : on remonte le fil comme « Plus anciens ».
    assert.equal((await trouver(T.id, 'programme', true, mA.id)).auteur_sans_parole, true)
    assert.equal((await trouver(B.id, 'programme', false, mA.id)).auteur_sans_parole, undefined, 'un membre ne voit pas qui n a plus la parole')
    assert.equal(await C.rendreParole(tx, A.numero, T.id), true)
    assert.equal(await C.rendreParole(tx, A.numero, T.id), false)
    assert.equal((await C.lireCompte(tx, A.id)).sans_parole, false)
    const hist = await q(`select count(*)::int as n from public.aok_chat_sans_parole where user_id = $1::uuid and rendue_le is not null`, A.id)
    assert.equal(hist[0].n, 1, 'la ligne reste, rendue')
    ok('couper la parole (raison gardee, une fois, jamais a l equipe), envoi refuse, liste de l equipe sans email ; rendre, historique garde')

    // Message supprime (comme a la suppression d un compte, par cascade) : la reponse dit « message supprime ».
    marque0 = await dernier()
    const mX = await C.poserMessage(tx, B.id, 'Message qui va partir', cB.statut, null, null)
    const mY = await C.poserMessage(tx, T.id, 'Reponse au message qui va partir', 'equipe', mX.id, null)
    await C.basculerPouce(tx, A.id, mX.id)
    await tx.$executeRawUnsafe(`delete from public.aok_chat_messages where id = $1::uuid`, mX.id)
    const vY = await C.vueDe(tx, mY.id, 'gratuit')
    assert.deepEqual(vY.reponse_a, { etat: 'supprime' })
    const pouceRestant = await q(`select count(*)::int as n from public.aok_chat_pouces where message_id = $1::uuid`, mX.id)
    assert.equal(pouceRestant[0].n, 0, 'les pouces partent avec le message')
    const evSup = (await diffuse(marque0)).filter(e => e.evenement === 'supprime')
    assert.equal(evSup.length, 2)
    ok('message supprime : ses pouces partent, la reponse dit « message supprime », direct « supprime » { id } (cascade depuis profiles a la suppression du compte)')

    // 5. Rejoue sous anon et authenticated.
    const lecture = `select id::text, texte from public.aok_chat_messages`
    const sAnon = await comme('anon', null, lecture)
    assert.equal(sAnon.ok, false)
    const sA = await comme('authenticated', A.id, lecture)
    assert.equal(sA.ok, false)
    const sT = await comme('authenticated', T.id, lecture)
    assert.equal(sT.ok, false, 'meme l equipe ne lit pas la table en direct')
    const masqueDirect = await comme('authenticated', A.id, `select texte from public.aok_chat_messages where id = $1::uuid`, mB.id)
    assert.equal(masqueDirect.ok, false)
    ok(`anon, membre et equipe (vrai sub) : lecture des messages refusee, masque compris (${sAnon.motif} / ${sA.motif})`)

    const ecritures = [
      ['insert message', `insert into public.aok_chat_messages (user_id, texte, statut_auteur) values ($1::uuid, 'ecrit en direct', 'equipe') returning id`, A.id],
      ['update masque', `update public.aok_chat_messages set masque_le = now() where id = $1::uuid returning id`, mT.id],
      ['delete message', `delete from public.aok_chat_messages where id = $1::uuid returning id`, mT.id],
      ['insert pouce', `insert into public.aok_chat_pouces (message_id, user_id) values ($1::uuid, $2::uuid) returning 1`, mT.id, A.id],
      ['lire pouces', `select * from public.aok_chat_pouces`],
      ['lire sans parole', `select * from public.aok_chat_sans_parole`],
      ['rendre sa parole', `update public.aok_chat_sans_parole set rendue_le = now() returning id`],
      ['aok_chat_poser', `select public.aok_chat_poser($1::uuid, 'contourne le quota', 'equipe', 100000, null, null)`, A.id],
      ['aok_chat_vue', `select public.aok_chat_vue($1::uuid, 'programme')`, mB.id],
      ['aok_chat_pouce', `select public.aok_chat_pouce($1::uuid, $2::uuid)`, A.id, mT.id],
      ['aok_chat_auteur', `select public.aok_chat_auteur($1::uuid, 'communaute', 'programme')`, B.id],
      ['aok_chat_diffuser', `select 1 as un from (select public.aok_chat_diffuser('nouveau', '{"id":"faux"}'::jsonb, null)) as x`],
      ['aok_chat_effacer_du_direct', `select 1 as un from (select public.aok_chat_effacer_du_direct($1::uuid, 'masque')) as x`, mT.id],
    ]
    const motifs = []
    for (const [nom, sql, ...p] of ecritures) {
      for (const role of ['anon', 'authenticated']) {
        const r = await comme(role, role === 'anon' ? null : A.id, sql, ...p)
        assert.equal(r.ok, false, `${role} : ${nom} aurait du etre refuse`)
        assert.match(r.motif, /permission denied/, `${role} : ${nom} refuse pour une autre raison (${r.motif})`)
        motifs.push(r.motif.replace(/ for (table|function) \S+/, ''))
      }
    }
    ok(`anon et authenticated : ${ecritures.length} gestes directs refuses chacun (ecrire, masquer, supprimer, pouce, lire pouces et paroles, `
      + `fonctions internes dont aok_chat_poser qui contournerait le quota) : ${[...new Set(motifs)].join(' / ')}`)

    // La policy du direct, evaluee comme Realtime la lit (realtime.topic() pose, role authenticated).
    const peut = `select (realtime.topic() = 'academie-chat:gratuit' or (realtime.topic() = 'academie-chat:programme' and (select public.aok_chat_lecteur_programme()))) as peut`
    const exprPolicy = (await q(`select qual from pg_policies where schemaname = 'realtime' and policyname = 'aok_chat_ecoute'`))[0].qual
    assert.ok(/academie-chat:gratuit/.test(exprPolicy) && /academie-chat:programme/.test(exprPolicy) && /aok_chat_lecteur_programme/.test(exprPolicy))
    const sujet = async (role, sub, topic) => {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      try {
        await tx.$executeRawUnsafe(`select set_config('realtime.topic', $1, true)`, topic)
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, JSON.stringify(sub ? { sub, role } : { role }))
        await tx.$executeRawUnsafe(`set local role ${role}`)
        return big(await tx.$queryRawUnsafe(peut))[0].peut
      } catch (e) {
        return `refus (${motif(e)})`
      } finally {
        await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`)
      }
    }
    assert.equal(await sujet('authenticated', A.id, 'academie-chat:gratuit'), true)
    assert.equal(await sujet('authenticated', A.id, 'academie-chat:programme'), false)
    assert.equal(await sujet('authenticated', B.id, 'academie-chat:programme'), true)
    assert.equal(await sujet('authenticated', T.id, 'academie-chat:programme'), true)
    assert.equal(await sujet('authenticated', B.id, 'autre-sujet'), false)
    const lit = await comme('authenticated', A.id, `select public.aok_chat_lecteur_programme() as p`)
    assert.equal(lit.lignes[0].p, false)
    const litAnon = await comme('anon', null, `select public.aok_chat_lecteur_programme() as p`)
    assert.equal(litAnon.ok, false)
    ok('policy du direct (roles {authenticated} seulement : anon jamais) : un gratuit ecoute academie-chat:gratuit et pas '
      + 'academie-chat:programme, un programme et l equipe les deux, aucun autre sujet ; aucune policy d ecriture sur realtime.messages')

    // 6. Les contraintes.
    const INS = `insert into public.aok_chat_messages (user_id, texte, statut_auteur, est_reponse, reponse_a, masque_le, masque_par) values ($1::uuid, $2, $3, $4, $5::uuid, $6::timestamptz, $7::uuid)`
    await doitEchouer('texte vide', INS, A.id, '   ', 'communaute', false, null, null, null)
    await doitEchouer('texte de 2001 caracteres', INS, A.id, 'x'.repeat(2001), 'communaute', false, null, null, null)
    await doitEchouer('statut inconnu', INS, A.id, 'x', 'vip', false, null, null, null)
    await doitEchouer('reponse_a sans est_reponse', INS, A.id, 'x', 'communaute', false, mT.id, null, null)
    await doitEchouer('masque_par sans masque_le', INS, A.id, 'x', 'communaute', false, null, null, T.id)
    await doitEchouer('compte inconnu', INS, '00000000-0000-4000-8000-000000000000', 'x', 'communaute', false, null, null, null)
    await doitEchouer('deux paroles coupees actives pour un compte', `insert into public.aok_chat_sans_parole (user_id, coupee_par) values ($1::uuid, $2::uuid), ($1::uuid, $2::uuid)`, A.id, T.id)

    throw new Annulation()
  }, { timeout: 120_000 })
} catch (err) {
  if (!(err instanceof Annulation)) throw err
}
const duree = Date.now() - debut

const apres = await etat(prisma)
assert.deepEqual(apres, { messages: null, pouces: null, sans_parole: null, poser: null, policy: 0 })
ok(`transaction annulee (${(duree / 1000).toFixed(1)} s du begin au rollback) : ni table, ni fonction, ni policy ne sont restees`)
await prisma.$disconnect()
await autre.$disconnect()
console.log(`\n${etapes} etapes ok`)
