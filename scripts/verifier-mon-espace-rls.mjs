/**
 * Prouve que les reglages du compte (/mon-espace/parametres du site,
 * migration 20261018233000_mon_espace_parametres.sql) ne laissent un compte
 * ni voir ni toucher ce qui est a un autre : sessions, profil prive, photo,
 * achats, export.
 *
 * Methode des autres verifier-*-rls.mjs : UNE transaction TOUJOURS ANNULEE.
 * Deux vrais comptes membres (A et B, ni admin ni equipe) servent de sujets ;
 * les donnees d'essai (sessions, paiements, objets de stockage) sont posees
 * dans la transaction et disparaissent avec elle. Chaque essai prend le role
 * `authenticated` (ou `anon`) avec un `sub` choisi, dans un savepoint.
 * Si la migration n'est pas encore appliquee, elle est jouee dans la
 * transaction (meme decoupage que appliquer-migration.mjs) : l'essai vaut
 * alors repetition generale.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/verifier-mon-espace-rls.mjs
 *
 * Sort en code 1 au premier ecart. N'affiche ni email ni identifiant.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATION = path.join(RACINE, '../../sites/Aoknowledgecom/supabase/migrations/20261018233000_mon_espace_parametres.sql')
const prisma = new PrismaClient()

let ecarts = 0
function attendre(nom, ok, detail) {
  console.log(`${ok ? 'ok ' : 'KO '} ${nom}${detail ? ` (${detail})` : ''}`)
  if (!ok) ecarts++
}

/** Meme decoupage que appliquer-migration.mjs. */
function decouper(sql) {
  const texte = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  const ordres = []
  let courant = ''
  let tag = null
  for (let i = 0; i < texte.length;) {
    if (!tag) {
      const d = /^\$[A-Za-z_]*\$/.exec(texte.slice(i))
      if (d) { tag = d[0]; courant += tag; i += tag.length; continue }
      if (texte[i] === ';') { if (courant.trim()) ordres.push(courant.trim()); courant = ''; i++; continue }
    } else if (texte.startsWith(tag, i)) { courant += tag; i += tag.length; tag = null; continue }
    courant += texte[i]
    i++
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}

const motif = (e) => String(e?.message ?? e).split('\n').find((l) => /permission|policy|violates|denied|row-level/i.test(l))?.trim().slice(0, 120) ?? 'refus'

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    let n = 0
    /** Une requete sous un role et un sub donnes, dans un savepoint toujours annule. */
    async function comme(role, uid, sql, ...params) {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      try {
        const claims = JSON.stringify(uid ? { sub: uid, role, session_id: sessions[uid] ?? null } : { role })
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, claims)
        await tx.$executeRawUnsafe(`set local role ${role}`)
        // Plusieurs ordres : un tableau, chacun dans son propre instantane
        // (une fonction STABLE ne voit pas ce que le meme ordre vient d'ecrire).
        let lignes = []
        const res = []
        for (const s of Array.isArray(sql) ? sql : [sql]) { lignes = await tx.$queryRawUnsafe(s, ...params); res.push(lignes) }
        return { ok: true, lignes, res }
      } catch (e) {
        return { ok: false, motif: motif(e) }
      } finally {
        await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`)
      }
    }

    const deja = Number((await tx.$queryRawUnsafe(
      `select count(*)::int as n from pg_proc where proname = 'aok_mon_compte' and pronamespace = 'public'::regnamespace`))[0].n)
    if (!deja) {
      const ordres = decouper(readFileSync(MIGRATION, 'utf8'))
      for (const o of ordres) await tx.$executeRawUnsafe(o)
      console.log(`migration absente : jouee dans la transaction (${ordres.length} ordres, annulee a la fin)`)
    } else {
      console.log('migration presente en base')
    }

    const comptes = await tx.$queryRawUnsafe(`
      select u.id::text as id, lower(u.email) as email from auth.users u
        join public.profiles p on p.id = u.id
       where p.role::text = 'member' and u.email is not null and u.email_confirmed_at is not null
         and not exists (select 1 from public.cockpit_allowlist c where c.user_id = u.id)
       order by u.created_at limit 2`)
    if (comptes.length < 2) throw new Error('il faut deux comptes membres')
    const [A, B] = comptes

    // Une session d'essai par compte (annulee avec la transaction).
    const sessions = {}
    for (const c of comptes) {
      sessions[c.id] = randomUUID()
      await tx.$executeRawUnsafe(
        `insert into auth.sessions (id, user_id, created_at, updated_at, user_agent)
         values ($1::uuid, $2::uuid, now(), now(), 'Mozilla/5.0 (essai verifier-mon-espace-rls)')`,
        sessions[c.id], c.id)
    }

    // --- Sessions ---------------------------------------------------------------
    const vraiA = Number((await tx.$queryRawUnsafe(
      `select count(*)::int as n from auth.sessions where user_id = $1::uuid and (not_after is null or not_after > now())`, A.id))[0].n)
    const sA = await comme('authenticated', A.id, 'select id::text, courante from public.aok_mes_sessions()')
    attendre('sessions : A voit toutes les siennes', sA.ok && sA.lignes.length === vraiA, sA.ok ? `${sA.lignes.length}/${vraiA}` : sA.motif)
    attendre('sessions : la session du jeton est marquee courante',
      sA.ok && sA.lignes.some((l) => l.id === sessions[A.id] && l.courante) && sA.lignes.filter((l) => l.courante).length === 1)
    attendre('sessions : aucune session de B chez A', sA.ok && !sA.lignes.some((l) => l.id === sessions[B.id]))
    const rB = await comme('authenticated', A.id, 'select public.aok_revoquer_session($1::uuid) as r', sessions[B.id])
    const encoreB = Number((await tx.$queryRawUnsafe('select count(*)::int as n from auth.sessions where id = $1::uuid', sessions[B.id]))[0].n)
    attendre('sessions : A ne revoque pas une session de B', rB.ok && rB.lignes[0].r === false && encoreB === 1, rB.ok ? '' : rB.motif)
    const rA = await comme('authenticated', A.id, [
      'select public.aok_revoquer_session($1::uuid) as r',
      'select count(*)::int as reste from public.aok_mes_sessions() where id = $1::uuid'], sessions[A.id])
    attendre('sessions : A revoque la sienne', rA.ok && rA.res[0][0].r === true && rA.res[1][0].reste === 0, rA.ok ? '' : rA.motif)
    const direct = await comme('authenticated', A.id, 'select count(*)::int as n from auth.sessions')
    attendre('sessions : auth.sessions fermee en lecture directe', !direct.ok, direct.motif)
    const supprDirect = await comme('authenticated', A.id, 'delete from auth.sessions where id = $1::uuid returning 1', sessions[B.id])
    attendre('sessions : auth.sessions fermee en suppression directe', !supprDirect.ok, supprDirect.motif)

    // --- Profil -------------------------------------------------------------------
    await tx.$executeRawUnsafe(`update public.profiles set profil_public = false, nom_affiche = 'Essai B' where id = $1::uuid`, B.id)
    const voitB = await comme('authenticated', A.id, 'select count(*)::int as n from public.profiles where id = $1::uuid', B.id)
    attendre('profil : A ne lit pas la ligne de B', voitB.ok && voitB.lignes[0].n === 0, voitB.ok ? `${voitB.lignes[0].n}` : voitB.motif)
    const prive = await comme('authenticated', A.id, 'select count(*)::int as n from public.aok_profils_publics(array[$1::uuid])', B.id)
    attendre('profil : profil PRIVE de B invisible pour A', prive.ok && prive.lignes[0].n === 0, prive.ok ? '' : prive.motif)
    await tx.$executeRawUnsafe('update public.profiles set profil_public = true where id = $1::uuid', B.id)
    const pub = await comme('authenticated', A.id, 'select nom_affiche from public.aok_profils_publics(array[$1::uuid])', B.id)
    attendre('profil : profil PUBLIC de B visible (nom affiche seulement)', pub.ok && pub.lignes.length === 1 && pub.lignes[0].nom_affiche === 'Essai B')
    const pubAnon = await comme('anon', null, 'select count(*)::int as n from public.aok_profils_publics(array[$1::uuid])', B.id)
    attendre('profil : profils publics fermes a l\'anonyme', !pubAnon.ok, pubAnon.motif)
    const ecritB = await comme('authenticated', A.id, `update public.profiles set nom_affiche = 'pirate' where id = $1::uuid returning 1`, B.id)
    attendre('profil : A ne modifie pas le profil de B', ecritB.ok && ecritB.lignes.length === 0, ecritB.ok ? '' : ecritB.motif)
    const ecritA = await comme('authenticated', A.id,
      `update public.profiles set nom_affiche = 'Essai A', profil_public = true, avatar_maj_le = now() where id = $1::uuid returning 1`, A.id)
    attendre('profil : A modifie ses trois colonnes', ecritA.ok && ecritA.lignes.length === 1, ecritA.ok ? '' : ecritA.motif)
    for (const [col, val] of [['role', `'admin'`], ['client_number', '1'], ['first_name', `'x'`]]) {
      const r = await comme('authenticated', A.id, `update public.profiles set ${col} = ${val}${col === 'first_name' ? ', nom_affiche = nom_affiche' : ''} where id = $1::uuid returning 1`, A.id)
      if (col === 'first_name') attendre('profil : prenom toujours modifiable (droit d\'avant)', r.ok && r.lignes.length === 1, r.ok ? '' : r.motif)
      else attendre(`profil : ${col} non modifiable par le membre`, !r.ok, r.motif)
    }
    const trop = await comme('authenticated', A.id, `update public.profiles set nom_affiche = repeat('x', 61) where id = $1::uuid returning 1`, A.id)
    attendre('profil : nom affiche de plus de 60 caracteres refuse', !trop.ok)

    // --- Photo (storage.objects, bucket prive) ----------------------------------
    const bucket = (await tx.$queryRawUnsafe(`select public, file_size_limit from storage.buckets where id = 'avatars-membres'`))[0]
    attendre('photo : bucket prive, 64 Ko', bucket && bucket.public === false && Number(bucket.file_size_limit) === 65536)
    const envoi = (nom) => comme('authenticated', A.id,
      `insert into storage.objects (bucket_id, name, owner_id) values ('avatars-membres', $1, $2) returning 1`, nom, A.id)
    const chezB = await envoi(`${B.id}/avatar`)
    attendre('photo : A n\'ecrit pas dans le dossier de B', !chezB.ok, chezB.motif)
    const autreNom = await envoi(`${A.id}/autre.png`)
    attendre('photo : A n\'ecrit qu\'un seul nom (avatar)', !autreNom.ok, autreNom.motif)
    const chezA = await envoi(`${A.id}/avatar`)
    attendre('photo : A ecrit sa photo', chezA.ok, chezA.ok ? '' : chezA.motif)
    await tx.$executeRawUnsafe(`insert into storage.objects (bucket_id, name) values ('avatars-membres', $1)`, `${B.id}/avatar`)
    const lire = () => comme('authenticated', A.id,
      `select count(*)::int as n from storage.objects where bucket_id = 'avatars-membres' and name = $1`, `${B.id}/avatar`)
    await tx.$executeRawUnsafe('update public.profiles set profil_public = false where id = $1::uuid', B.id)
    const lPrive = await lire()
    attendre('photo : photo de B (profil prive) illisible pour A', lPrive.ok && lPrive.lignes[0].n === 0, lPrive.ok ? '' : lPrive.motif)
    await tx.$executeRawUnsafe('update public.profiles set profil_public = true where id = $1::uuid', B.id)
    const lPublic = await lire()
    attendre('photo : photo de B (profil public) lisible par A connecte', lPublic.ok && lPublic.lignes[0].n === 1)
    const lAnon = await comme('anon', null,
      `select count(*)::int as n from storage.objects where bucket_id = 'avatars-membres'`)
    attendre('photo : rien pour l\'anonyme', !lAnon.ok || lAnon.lignes[0].n === 0, lAnon.ok ? `${lAnon.lignes[0].n}` : lAnon.motif)
    const majB = await comme('authenticated', A.id,
      `update storage.objects set name = name where bucket_id = 'avatars-membres' and name = $1 returning 1`, `${B.id}/avatar`)
    attendre('photo : A ne remplace pas la photo de B', majB.ok && majB.lignes.length === 0, majB.ok ? '' : majB.motif)
    await tx.$executeRawUnsafe('update public.profiles set profil_public = false where id = $1::uuid', B.id)

    // --- Achats et Live Club -------------------------------------------------------
    const idAchat = `stripe:ch_essai${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const idLive = `stripe:ch_essai${randomUUID().replace(/-/g, '').slice(0, 16)}`
    await tx.$executeRawUnsafe(
      `insert into public.cockpit_paiements (paiement_id, source, date_paiement, montant, devise, offre_id, compte, payeur_email)
       values ($1, 'stripe', current_date, 1, 'EUR', 'acquisition-express', 'aoknowledge', $3),
              ($2, 'stripe', current_date + 1, 1, 'EUR', 'live-club', 'melanie', $3)`,
      idAchat, idLive, B.email)
    const compte = (uid) => comme('authenticated', uid, 'select public.aok_mon_compte()::text as c')
    const cB = await compte(B.id)
    const jB = cB.ok ? JSON.parse(cB.lignes[0].c) : null
    attendre('achats : B voit son achat (avec reçu possible)', jB && jB.achats.some((a) => a.paiement_id === idAchat && a.recu === true), cB.ok ? '' : cB.motif)
    attendre('achats : B voit son dernier paiement Live Club', jB && jB.live_club_dernier_paiement?.paiement_id === idLive)
    const cA = await compte(A.id)
    const tA = cA.ok ? cA.lignes[0].c : ''
    attendre('achats : A ne voit ni l\'achat ni le paiement Live Club de B', cA.ok && !tA.includes(idAchat) && !tA.includes(idLive), cA.ok ? '' : cA.motif)
    const deAutrui = await comme('authenticated', A.id, 'select public.aok_compte_de($1::uuid)::text as c', B.id)
    attendre('achats : aok_compte_de(uuid) fermee au navigateur', !deAutrui.ok, deAutrui.motif)
    const anonCompte = await comme('anon', null, 'select public.aok_mon_compte()::text as c')
    attendre('achats : aok_mon_compte fermee a l\'anonyme', !anonCompte.ok, anonCompte.motif)
    const paiementsDirect = await comme('authenticated', A.id, 'select count(*)::int as n from public.cockpit_paiements where paiement_id = $1', idAchat)
    attendre('achats : cockpit_paiements ne rend rien au membre en direct',
      !paiementsDirect.ok || paiementsDirect.lignes[0].n === 0, paiementsDirect.ok ? `${paiementsDirect.lignes[0].n}` : paiementsDirect.motif)

    // --- Export ---------------------------------------------------------------------
    const eA = await comme('authenticated', A.id, 'select public.aok_exporter_mes_donnees()::text as e')
    const texteA = eA.ok ? eA.lignes[0].e : ''
    attendre('export : A exporte ses donnees', eA.ok && texteA.includes(A.email) && JSON.parse(texteA).profil != null, eA.ok ? `${texteA.length} caracteres` : eA.motif)
    attendre('export : rien de B dans l\'export de A', eA.ok && !texteA.includes(B.email) && !texteA.includes(idAchat) && !texteA.includes('Essai B'))
    const eAnon = await comme('anon', null, 'select public.aok_exporter_mes_donnees()::text as e')
    attendre('export : ferme a l\'anonyme', !eAnon.ok, eAnon.motif)

    // --- Fonctions : search_path fixe, security definer --------------------------------
    const fns = await tx.$queryRawUnsafe(`
      select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as conf
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'aok\\_%'`)
    const attendues = ['aok_avatar_lisible', 'aok_mes_sessions', 'aok_revoquer_session', 'aok_emails_verifies', 'aok_compte_de',
      'aok_mon_compte', 'aok_exporter_mes_donnees', 'aok_profils_publics']
    for (const nom of attendues) {
      const f = fns.find((x) => x.proname === nom)
      attendre(`fonction ${nom} : security definer, search_path vide`, f && f.prosecdef && /search_path=("")?$|search_path=""/.test(f.conf), f ? f.conf : 'absente')
    }

    throw new Error('__rollback__')
  }, { timeout: 60000, maxWait: 10000 }).catch((e) => {
    if (!String(e.message).includes('__rollback__')) throw e
  })
  console.log(ecarts ? `\n${ecarts} ecart(s).` : '\nAucun ecart. Transaction annulee : rien n\'est reste.')
  process.exitCode = ecarts ? 1 : 0
}

main().catch((e) => {
  console.error('ECHEC :', String(e.message).split('\n').slice(-4).join(' '))
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
