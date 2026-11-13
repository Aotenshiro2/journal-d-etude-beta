/**
 * ESSAI de la migration 20261113120000_academie_chat_noms.sql (les noms du
 * salon « Questions de l'academie », 13/11/2026) contre la vraie base, dans
 * UNE transaction TOUJOURS ANNULEE (lock_timeout 5 s, rien ne reste) :
 *   1. avant : combien d'auteurs du salon sortent en « Membre N » aujourd'hui ;
 *   2. la migration, jouee deux fois (rejouable) ;
 *   3. aok_chat_nom_court sur des cas ecrits (prenom et nom, minuscules,
 *      majuscules, nom complet tape dans le prenom, prenom seul, repli
 *      « Membre », prenom tire de l'email, arobase, invisibles, equipe) ;
 *   4. sur TOUS les comptes : aucune erreur, jamais d'arobase, jamais le nom
 *      de famille entier, la forme « Prenom I. » ou « Prenom » ;
 *   5. l'equipe : le prenom de chaque compte de l'equipe (la signature) ;
 *   6. la lecture telle que la route la rend (lireMessages de chat-academie.ts,
 *      requete EXACTE) : le meme nom pour un lecteur gratuit et un lecteur avec
 *      programme ;
 *   7. le direct : un message d'un membre puis une reponse de l'equipe, poses
 *      par aok_chat_poser ; ce que le declencheur diffuse sur les deux sujets
 *      (aok_chat_diffuser remplacee DANS LA TRANSACTION par une copie qui range
 *      ce qu'elle aurait envoye) : meme nom des deux cotes, « Prenom I. »,
 *      prenom de l'equipe, ni email ni identifiant de compte ;
 *   8. droits : anon et authenticated n'appellent ni aok_chat_nom_court ni
 *      aok_chat_auteur.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste. Affiche des comptes et des formes ; aucun email, aucun
 * identifiant complet, aucun nom de membre. Seuls les prenoms de l'equipe
 * sortent (c'est la signature a verifier).
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-chat-noms.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import * as C from '../src/lib/academie/chat-academie.ts'

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261113120000_academie_chat_noms.sql'
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
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|denied/i.test(l))?.trim().slice(0, 110) ?? 'refus'
const big = v => JSON.parse(JSON.stringify(v, (k, x) => typeof x === 'bigint' ? Number(x) : x))
const FORME = /^[^\s@]{1,30}( [^\s@]\.)?$/u

const etat = async c => big((await c.$queryRawUnsafe(`select
  to_regprocedure('public.aok_chat_nom_court(text,text,text,boolean)')::text as nom_court,
  pg_get_functiondef('public.aok_chat_auteur(uuid,text,text)'::regprocedure) as auteur`))[0])
const avant = await etat(prisma)
if (avant.nom_court) console.log('note : aok_chat_nom_court existe deja en base (migration appliquee ?) : l essai rejoue quand meme, puis annule.')

const debut = Date.now()
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    let n = 0
    const q = async (sql, ...p) => big(await tx.$queryRawUnsafe(sql, ...p))
    const nomCourt = async (prenom, nom, email, equipe) =>
      (await q(`select public.aok_chat_nom_court($1::text, $2::text, $3::text, $4::boolean) as n`, prenom, nom, email, equipe))[0].n

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

    // 1. Avant : les auteurs du salon, nommes ou numerotes, pour un lecteur gratuit et un lecteur avec programme.
    const SQL_AUTEURS = `
      select count(*)::int as auteurs,
             count(*) filter (where public.aok_chat_auteur(a.user_id, a.statut_auteur, 'gratuit') ->> 'nom' is null and a.statut_auteur <> 'equipe')::int as numeros_gratuit,
             count(*) filter (where public.aok_chat_auteur(a.user_id, a.statut_auteur, 'programme') ->> 'nom' is null and a.statut_auteur <> 'equipe')::int as numeros_programme,
             count(*) filter (where a.statut_auteur = 'equipe' and public.aok_chat_auteur(a.user_id, a.statut_auteur, 'gratuit') ->> 'nom' is not null)::int as equipe_signee
        from (select distinct m.user_id, m.statut_auteur from public.aok_chat_messages m) a`
    const auteursAvant = (await q(SQL_AUTEURS))[0]
    ok(`avant : ${auteursAvant.auteurs} auteur(s) dans le salon, ${auteursAvant.numeros_gratuit} en « Membre N » pour un lecteur gratuit, ${auteursAvant.numeros_programme} pour un lecteur avec programme, ${auteursAvant.equipe_signee} signature d equipe`)

    // 2. La migration, deux fois.
    for (let tour = 1; tour <= 2; tour++) {
      for (const o of ordres) await tx.$executeRawUnsafe(o)
    }
    ok(`migration jouee deux fois (${ordres.length} ordres), rejouable`)

    // 3. Le nom court, cas ecrits.
    const cas = [
      [['Hugo', 'Romain', 'h.romain@exemple.fr', false], 'Hugo R.', 'prenom et nom'],
      [['hugo', 'romain', null, false], 'Hugo R.', 'tout en minuscules'],
      [['HUGO', 'ROMAIN', null, false], 'Hugo R.', 'tout en majuscules'],
      [['Jean-pierre', 'de Souza', null, false], 'Jean-pierre D.', 'casse mixte gardee, initiale de la premiere lettre du nom'],
      [['jean-pierre', 'dupont', null, false], 'Jean-Pierre D.', 'prenom compose'],
      [['Hugo Romain', '', null, false], 'Hugo R.', 'nom complet tape dans le prenom : jamais le nom entier'],
      [['  Hugo   ', '  Romain ', null, false], 'Hugo R.', 'espaces'],
      [['Élodie', 'Émeraude', null, false], 'Élodie É.', 'accents'],
      [['Zoé', '', 'zoe.martin@exemple.fr', false], 'Zoé', 'prenom seul (pas tire de l email : accent)'],
      [['Jdupont', '', 'jdupont93@exemple.fr', false], null, 'prenom tire de l email par handle_new_user : numero'],
      [['Contact', '', 'contact+trading@exemple.fr', false], null, 'prenom tire de l email (suffixe +) : numero'],
      [['Membre', '', 'x@exemple.fr', false], null, 'repli Membre de handle_new_user : numero'],
      [['', 'Romain', null, false], null, 'nom sans prenom : numero'],
      [['', '', null, false], null, 'ni prenom ni nom : numero'],
      [[null, null, null, false], null, 'colonnes nulles : numero'],
      [['hugo@exemple.fr', '', null, false], null, 'une adresse dans le prenom : jamais'],
      [['1234', 'Romain', null, false], null, 'prenom sans lettre : numero'],
      [[`Hu${String.fromCodePoint(0x200b)}go${String.fromCodePoint(0x202e)}`, `${String.fromCodePoint(0x200d)}Romain`, null, false], 'Hugo R.', 'invisibles et direction retires'],
      [['Hugo\nRomain', '', null, false], 'Hugo R.', 'controle remplace par une espace'],
      [['A'.repeat(50), 'B', null, false], `${'A'.repeat(1)}${'a'.repeat(29)} B.`, 'prenom borne a 30 caracteres'],
      [['Brice', 'Martin', null, true], 'Brice', 'equipe : le prenom seul'],
      [['Mélanie', 'X', null, true], 'Mélanie', 'equipe : accent garde'],
      [['brice', '', 'brice@exemple.fr', true], 'Brice', 'equipe : pas de garde de l email'],
      [['', '', null, true], null, 'equipe sans prenom : « Équipe AOK » seul'],
    ]
    for (const [args, attendu, nom] of cas) assert.equal(await nomCourt(...args), attendu, nom)
    ok(`nom court : ${cas.length} cas ecrits (casse, nom complet dans le prenom, prenom tire de l email, repli Membre, arobase, invisibles, equipe)`)

    // 4. Tous les comptes : aucune erreur, aucune arobase, jamais le nom de famille entier, la forme attendue.
    const tous = (await q(`
      with n as (
        select p.first_name, p.last_name, public.aok_chat_nom_court(p.first_name, p.last_name, u.email, false) as nom
          from public.profiles p left join auth.users u on u.id = p.id
      )
      select count(*)::int as comptes,
             count(nom)::int as nommes,
             count(*) filter (where nom ~ '@')::int as arobase,
             coalesce(max(char_length(nom)), 0)::int as plus_long,
             count(*) filter (where nom is not null and char_length(btrim(last_name)) > 1
                                and strpos(lower(nom), lower(btrim(last_name))) > 0
                                and strpos(lower(split_part(btrim(first_name), ' ', 1)), lower(btrim(last_name))) = 0)::int as nom_entier,
             array_remove(array_agg(distinct case when nom is not null and nom !~ '^[^ @]{1,30}( [[:alpha:]]\\.)?$' then char_length(nom) end), null) as hors_forme
        from n`))[0]
    assert.equal(tous.arobase, 0, 'jamais une arobase')
    assert.equal(tous.nom_entier, 0, 'jamais le nom de famille entier')
    assert.ok(tous.plus_long <= 33, `33 caracteres au plus (${tous.plus_long})`)
    assert.deepEqual(tous.hors_forme, [], 'la forme « Prenom I. » ou « Prenom »')
    ok(`tous les comptes : ${tous.nommes} nomme(s) sur ${tous.comptes}, aucune arobase, jamais le nom entier, ${tous.plus_long} caracteres au plus`)

    // 5. L'equipe : le prenom de chaque compte (c'est la signature du salon).
    const equipe = await q(`
      select p.id::text as id, p.client_number as numero, public.aok_chat_auteur(p.id, 'equipe', 'gratuit') as a
        from public.profiles p where public.aok_est_equipe(p.id) order by p.client_number`)
    assert.ok(equipe.length > 0, 'au moins un compte de l equipe')
    for (const e of equipe) {
      const a = C.lireAuteur(e.a)
      assert.equal(a.equipe, true)
      assert.equal(a.numero, null)
      console.log(`    equipe n° ${e.numero} : « ${C.nomAffiche(a)} »`)
    }
    ok(`equipe : ${equipe.length} compte(s), signature « Prenom · Équipe AOK » (ou « Équipe AOK » sans prenom), jamais de numero`)

    // 6 et 7. Le direct et la lecture : un message d'un membre, une reponse de l'equipe.
    await tx.$executeRawUnsafe(`create temp table essai_direct (evenement text, sujet text, payload jsonb) on commit drop`)
    await tx.$executeRawUnsafe(`
      create or replace function public.aok_chat_diffuser(p_evenement text, p_programme jsonb, p_gratuit jsonb)
      returns void language plpgsql volatile security definer set search_path = '' as $fn$
      begin
        insert into pg_temp.essai_direct values (p_evenement, 'programme', p_programme), (p_evenement, 'gratuit', p_gratuit);
      end
      $fn$`)
    const membre = (await q(`
      select p.id::text as id from public.profiles p join auth.users u on u.id = p.id
       where nullif(btrim(p.first_name), '') is not null and nullif(btrim(p.last_name), '') is not null
         and lower(btrim(p.first_name)) <> 'membre' and not public.aok_est_equipe(p.id)
         and public.aok_chat_nom_court(p.first_name, p.last_name, u.email, false) is not null
       order by p.client_number limit 1`))[0]
    assert.ok(membre, 'un membre avec prenom et nom')
    const unEquipe = equipe[0]
    const pose = await C.poserMessage(tx, membre.id, 'Essai des noms (transaction annulee)', 'communaute', null, null)
    assert.ok(pose.ok, `message du membre pose (${pose.refus ?? ''})`)
    const reponse = await C.poserMessage(tx, unEquipe.id, 'Reponse de l equipe (essai annule)', 'equipe', pose.id, null)
    assert.ok(reponse.ok, `reponse de l equipe posee (${reponse.refus ?? ''})`)

    const direct = await q(`select evenement, sujet, payload from pg_temp.essai_direct where evenement = 'nouveau'`)
    assert.equal(direct.length, 4, 'deux messages, deux sujets chacun')
    const surSujet = (id, sujet) => direct.find(d => d.payload?.id === id && d.sujet === sujet)?.payload
    for (const id of [pose.id, reponse.id]) {
      const p = surSujet(id, 'programme'), g = surSujet(id, 'gratuit')
      assert.ok(p && g, 'diffuse sur les deux sujets')
      assert.deepEqual(p.auteur, g.auteur, 'le meme auteur sur les deux sujets')
      assert.deepEqual(Object.keys(p.auteur).sort(), ['equipe', 'nom', 'numero', 'statut'])
      const brut = JSON.stringify([p, g])
      assert.ok(!brut.includes('@'), 'aucun email dans le direct')
      assert.ok(!brut.includes(membre.id) && !brut.includes(unEquipe.id), 'aucun identifiant de compte dans le direct')
    }
    const auteurMembre = surSujet(pose.id, 'gratuit').auteur
    assert.equal(auteurMembre.equipe, false)
    assert.match(auteurMembre.nom, FORME, 'le membre : « Prenom I. »')
    assert.ok(Number.isSafeInteger(auteurMembre.numero))
    const auteurEquipe = surSujet(reponse.id, 'gratuit').auteur
    assert.deepEqual({ ...auteurEquipe, nom: undefined }, { equipe: true, numero: null, nom: undefined, statut: 'equipe' })
    assert.equal(auteurEquipe.nom, C.lireAuteur(unEquipe.a).nom, 'l equipe : le prenom du compte qui ecrit')
    const cite = surSujet(reponse.id, 'gratuit').reponse_a
    assert.equal(cite.etat, 'visible')
    assert.deepEqual(cite.auteur, auteurMembre, 'la citation porte le meme nom')
    ok(`direct : meme auteur sur les deux sujets, membre « Prenom I. », equipe « ${C.nomAffiche(C.lireAuteur(auteurEquipe))} », ni email ni identifiant`)

    const gratuit = await C.lireMessages(tx, membre.id, 'gratuit', null, false)
    const programme = await C.lireMessages(tx, membre.id, 'programme', null, false)
    const vu = (l, id) => l.messages.find(m => m.id === id)
    for (const id of [pose.id, reponse.id]) {
      assert.ok(vu(gratuit, id) && vu(programme, id), 'les deux messages dans la lecture')
      assert.deepEqual(vu(gratuit, id).auteur, vu(programme, id).auteur, 'le meme nom pour un lecteur gratuit et un lecteur avec programme')
    }
    assert.equal(C.nomAffiche(vu(gratuit, pose.id).auteur), auteurMembre.nom, 'la lecture et le direct disent le meme nom')
    assert.equal(C.nomAffiche(vu(gratuit, reponse.id).auteur), C.nomAffiche(C.lireAuteur(auteurEquipe)))
    assert.ok(!JSON.stringify([gratuit, programme]).includes('@'), 'aucun email dans la lecture')
    ok('lecture (requete exacte de la route) : meme nom pour un lecteur gratuit et un lecteur avec programme, le meme que le direct')

    const apres = (await q(SQL_AUTEURS))[0]
    ok(`apres : ${apres.numeros_gratuit} auteur(s) en « Membre N » (avant : ${auteursAvant.numeros_gratuit} pour un lecteur gratuit), ${apres.equipe_signee} signature(s) d equipe avec prenom (essai compris)`)

    // 8. Droits : rien pour le navigateur.
    const sub = membre.id
    for (const [role, s] of [['anon', null], ['authenticated', sub]]) {
      for (const sql of [`select public.aok_chat_nom_court('Hugo', 'Romain', null, false)`, `select public.aok_chat_auteur('${sub}'::uuid, 'communaute', 'gratuit')`]) {
        const r = await comme(role, s, sql)
        assert.equal(r.ok, false, `${role} : ${sql.slice(0, 60)}`)
      }
    }
    ok('droits : anon et authenticated ne peuvent appeler ni aok_chat_nom_court ni aok_chat_auteur')

    throw new Annulation()
  }, { timeout: 60_000, maxWait: 10_000 })
} catch (e) {
  if (!(e instanceof Annulation)) throw e
}
console.log(`transaction annulee apres ${((Date.now() - debut) / 1000).toFixed(1)} s`)

const fin = await etat(prisma)
assert.equal(fin.nom_court, avant.nom_court, 'aok_chat_nom_court : comme avant l essai')
assert.equal(fin.auteur, avant.auteur, 'aok_chat_auteur : inchangee')
ok('rien n est reste : aok_chat_nom_court et aok_chat_auteur comme avant l essai')
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
