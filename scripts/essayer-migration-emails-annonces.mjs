/**
 * ESSAI de la migration 20261113210000_academie_emails_annonces.sql (email a tous les membres depuis le
 * cockpit, 13/11/2026) contre la vraie base, dans un bloc DO qui se termine TOUJOURS par une exception :
 * tout est annule, quel que soit le client (rien ne reste, meme si la connexion validait d'elle-meme).
 *
 * Le bloc joue :
 *   1. la migration DEUX fois (rejouable), sans le notify ;
 *   2. SQL_DESTINATAIRES (la requete EXACTE de emails-annonces.ts) pour chaque groupe : compteurs ;
 *   3. un envoi reel en simulation : SQL_CREER_ENVOI, SQL_INSERER_DESTINATAIRES (groupe « tous »),
 *      SQL_A_ENVOYER (lot de 100), SQL_NOTER_LOT (un echec, le reste simule), SQL_COMPTES_ENVOI,
 *      SQL_FINIR_ENVOI, SQL_INSCRIRE_ANNONCE (une seule ligne, meme rejoue), SQL_DERNIER_REEL (garde) ;
 *   4. SQL_DESINSCRIRE puis SQL_DESTINATAIRES : l'adresse sort du compte a envoyer, rejouable ;
 *   5. les contraintes (mode inconnu, adresse en majuscules, lien hors aoknowledge.com, doublon, raison inconnue) ;
 *   6. SQL_HISTORIQUE, SQL_DETAIL_ECHECS, SQL_DETAIL_RAISONS, SQL_ADRESSES_ESSAI, SQL_DROITS lisibles ;
 *   7. (voie Broadcast, 13/11) un envoi reel « broadcast » au groupe comptes : SQL_NOTER_SYNCHRO,
 *      SQL_NOTER_BROADCAST (pose une fois, jamais remplace), SQL_CONFIER, comptes, garde Resend ;
 *      un Broadcast simule (SQL_SIMULER_TOUT) ; SQL_IMPORTER_DESINSCRITS (une reinscription de chez
 *      nous est annulee par Resend), SQL_NOTER_RESEND_LE, SQL_DESINSCRITS_BASE, SQL_BROADCASTS_PASSES ;
 *      contraintes (transport inconnu, id de Broadcast mal forme, source inconnue).
 * Le message de l'exception finale (« ESSAI_OK {...} ») porte des NOMBRES seulement, jamais une adresse.
 *
 * Deux usages :
 *   node scripts/essayer-migration-emails-annonces.mjs --imprimer <fichier.sql>   ecrit le bloc, ne se connecte pas
 *   node --env-file=.env.local scripts/essayer-migration-emails-annonces.mjs       le joue par Prisma (DIRECT_URL)
 * Le 13/11, le bloc a ete joue par l'outil SQL de Supabase (meme texte) : voir l'ETAT du journal.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import * as E from '../src/lib/academie/emails-annonces.ts'
import * as B from '../src/lib/academie/emails-broadcast.ts'

const NOM = 'sites/Aoknowledgecom/supabase/migrations/20261113210000_academie_emails_annonces.sql'
const candidats = [
  process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${NOM}`) : null,
  new URL(`../../../${NOM}`, import.meta.url),
  new URL(`../../email-a-tous/${NOM}`, import.meta.url),
].filter(Boolean)
const fichier = candidats.find((u) => existsSync(u))
if (!fichier) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${NOM})`)

const migration = readFileSync(fichier, 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--') && !/^notify /.test(l.trim())).join('\n').trim()

const q = (s) => {
  if (s.includes('$q$')) throw new Error('$q$ dans une requete')
  return `$q$${s}$q$`
}

export const BLOC = `do $essai$
declare
  v_g text;
  v_n int;
  v_res jsonb := '{}'::jsonb;
  v_envoi uuid;
  v_ids uuid[];
  v_statuts text[];
  v_rids text[];
  v_errs text[];
  v_c record;
  v_mail text;
  v_annonces int;
  v_dernier timestamptz;
  v_refus int := 0;
  v_avant int;
  v_apres int;
  v_bc uuid;
  v_sim uuid;
  v_mail2 text;
  v_dest text := ${q(E.SQL_DESTINATAIRES)};
begin
  -- 1. la migration, deux fois
  ${migration}
  ${migration}

  -- 2. les groupes
  foreach v_g in array array['tous', 'comptes', 'programmes', 'gratuits', 'sans_compte'] loop
    execute 'select count(*) filter (where not desinscrit) from (' || v_dest || ') t' into v_n using v_g;
    v_res := v_res || jsonb_build_object(v_g, v_n);
  end loop;

  -- 3. un envoi reel en simulation, groupe tous
  execute ${q(E.SQL_CREER_ENVOI)} into v_envoi
    using 'reel', 'simulation', 'tous', 'Essai de migration', 'Texte', 'https://aoknowledge.com/academie', null::uuid,
          (v_res ->> 'tous')::int, 0, false, null::uuid;
  execute 'select array_agg(email order by email) as e, array_agg(coalesce(user_id, '''') order by email) as u, array_agg(raison order by email) as r from ('
          || v_dest || ') t where not desinscrit' into v_c using 'tous';
  execute ${q(E.SQL_INSERER_DESTINATAIRES)} using v_envoi, v_c.e, v_c.u, v_c.r;
  execute ${q(E.SQL_INSERER_DESTINATAIRES)} using v_envoi, v_c.e, v_c.u, v_c.r;
  select count(*) into v_n from public.academie_emails_destinataires where envoi_id = v_envoi;
  v_res := v_res || jsonb_build_object('lignes_inserees_deux_fois', v_n);

  execute 'select array_agg(id::uuid), array_agg(case when rn = 1 then ''echec'' else ''simule'' end), array_agg(''''::text), array_agg(case when rn = 1 then ''refus essai'' else '''' end::text) from (select t.*, row_number() over () as rn from ('
          || ${q(E.SQL_A_ENVOYER)} || ') t) u' into v_ids, v_statuts, v_rids, v_errs using v_envoi, 100;
  v_res := v_res || jsonb_build_object('premier_lot', coalesce(array_length(v_ids, 1), 0));
  execute ${q(E.SQL_NOTER_LOT)} using v_ids, v_statuts, v_rids, v_errs;
  -- les lots suivants (plus de 100 adresses) : simules
  loop
    execute 'select array_agg(id::uuid) from (' || ${q(E.SQL_A_ENVOYER)} || ') t' into v_ids using v_envoi, 100;
    exit when v_ids is null;
    execute ${q(E.SQL_NOTER_LOT)}
      using v_ids, array_fill('simule'::text, array[array_length(v_ids, 1)]), array_fill(''::text, array[array_length(v_ids, 1)]),
            array_fill(''::text, array[array_length(v_ids, 1)]);
  end loop;
  execute ${q(E.SQL_COMPTES_ENVOI)} into v_c using v_envoi;
  v_res := v_res || jsonb_build_object('a_envoyer', v_c.a_envoyer, 'envoyes', v_c.envoyes, 'echecs', v_c.echecs);
  execute ${q(E.SQL_FINIR_ENVOI)} using v_envoi, v_c.envoyes, v_c.echecs, 'partiel', null::text;
  execute ${q(E.SQL_INSCRIRE_ANNONCE)} using v_envoi, 'Tous les membres : essai';
  execute ${q(E.SQL_INSCRIRE_ANNONCE)} using v_envoi, 'Tous les membres : essai';
  select count(*) into v_annonces from public.cockpit_annonces_envoyees where source = 'email-academie:' || v_envoi::text;
  v_res := v_res || jsonb_build_object('annonces_inscrites', v_annonces,
    'annonce_liee', (select annonce_id is not null from public.academie_emails_envois where id = v_envoi),
    'statut', (select statut from public.academie_emails_envois where id = v_envoi),
    'fini_le_pose', (select fini_le is not null from public.academie_emails_envois where id = v_envoi));
  execute ${q(E.SQL_DERNIER_REEL)} into v_dernier using array['simulation']::text[];
  v_res := v_res || jsonb_build_object('garde_voit_envoi', v_dernier is not null, 'garde_resend_vide',
    (select max(cree_le) is null from public.academie_emails_envois where mode = 'reel' and transport = 'resend'));

  -- 4. desinscription
  select email into v_mail from public.academie_emails_destinataires where envoi_id = v_envoi order by email limit 1;
  execute 'select count(*) filter (where not desinscrit) from (' || v_dest || ') t' into v_avant using 'tous';
  execute ${q(E.SQL_DESINSCRIRE)} using v_mail, 'lien', (select id from public.academie_emails_destinataires where envoi_id = v_envoi and email = v_mail);
  execute ${q(E.SQL_DESINSCRIRE)} using v_mail, 'un-clic', null::uuid;
  execute 'select count(*) filter (where not desinscrit) from (' || v_dest || ') t' into v_apres using 'tous';
  v_res := v_res || jsonb_build_object('desinscription_retire', v_avant - v_apres,
    'desinscription_source_gardee', (select source from public.academie_emails_desinscriptions where email = v_mail));
  update public.academie_emails_desinscriptions set reinscrit_le = now() where email = v_mail;
  execute 'select count(*) filter (where not desinscrit) from (' || v_dest || ') t' into v_apres using 'tous';
  v_res := v_res || jsonb_build_object('reinscription_rend', v_apres = v_avant);

  -- 5. contraintes
  begin insert into public.academie_emails_envois (mode, transport, groupe, objet, texte) values ('autre', 'simulation', 'tous', 'o', 't'); exception when check_violation then v_refus := v_refus + 1; end;
  begin insert into public.academie_emails_envois (mode, transport, groupe, objet, texte, lien) values ('reel', 'simulation', 'tous', 'o', 't', 'https://pirate.fr/'); exception when check_violation then v_refus := v_refus + 1; end;
  begin insert into public.academie_emails_destinataires (envoi_id, email, raison) values (v_envoi, 'Majuscule@Exemple.fr', 'gratuit'); exception when check_violation then v_refus := v_refus + 1; end;
  begin insert into public.academie_emails_destinataires (envoi_id, email, raison) values (v_envoi, 'x@exemple.fr', 'inconnue'); exception when check_violation then v_refus := v_refus + 1; end;
  begin insert into public.academie_emails_destinataires (envoi_id, email, raison) values (v_envoi, v_mail, 'gratuit'); exception when unique_violation then v_refus := v_refus + 1; end;
  v_res := v_res || jsonb_build_object('refus_contraintes', v_refus);

  -- 6. lectures du cockpit
  execute 'select count(*) from (' || ${q(E.SQL_HISTORIQUE)} || ') t' into v_n;
  v_res := v_res || jsonb_build_object('historique', v_n);
  execute 'select count(*) from (' || ${q(E.SQL_DETAIL_ECHECS)} || ') t' into v_n using v_envoi;
  v_res := v_res || jsonb_build_object('detail_echecs', v_n);
  execute 'select count(*) from (' || ${q(E.SQL_DETAIL_RAISONS)} || ') t' into v_n using v_envoi;
  v_res := v_res || jsonb_build_object('detail_raisons', v_n);
  execute 'select count(*) from (' || ${q(E.SQL_ADRESSES_ESSAI)} || ') t' into v_n
    using (select user_id from public.cockpit_allowlist where label = 'Brice' limit 1), 'equipe';
  v_res := v_res || jsonb_build_object('adresses_essai_equipe', v_n);
  execute 'select count(*) from (' || ${q(E.SQL_ADRESSES_ESSAI)} || ') t' into v_n
    using (select user_id from public.cockpit_allowlist where label = 'Brice' limit 1), 'moi';
  v_res := v_res || jsonb_build_object('adresses_essai_moi', v_n);
  execute 'select count(*) from (' || ${q(E.SQL_DROITS)} || ') t' into v_n using (select user_id from public.cockpit_allowlist where label = 'Brice' limit 1);
  v_res := v_res || jsonb_build_object('droits_lus', v_n);

  -- 7. voie Broadcast : envoi reel au groupe comptes
  execute ${q(E.SQL_DERNIER_REEL)} into v_dernier using array['resend', 'broadcast']::text[];
  v_res := v_res || jsonb_build_object('garde_resend_avant', v_dernier is null);
  execute ${q(E.SQL_CREER_ENVOI)} into v_bc
    using 'reel', 'broadcast', 'comptes', 'Essai Broadcast', 'Texte', null::text, null::uuid, (v_res ->> 'comptes')::int, 0, false, null::uuid;
  execute 'select array_agg(email order by email) as e, array_agg(coalesce(user_id, '''') order by email) as u, array_agg(raison order by email) as r from ('
          || v_dest || ') t where not desinscrit' into v_c using 'comptes';
  execute ${q(E.SQL_INSERER_DESTINATAIRES)} using v_bc, v_c.e, v_c.u, v_c.r;
  execute ${q(B.SQL_NOTER_SYNCHRO)} using v_bc, '{"mode":"reel","applique":true,"plan":{"creer":0}}'::text;
  execute ${q(B.SQL_NOTER_BROADCAST)} using v_bc, 'bc-essai-0001';
  execute ${q(B.SQL_NOTER_BROADCAST)} using v_bc, 'bc-essai-0002';
  execute ${q(B.SQL_CONFIER)} using v_bc, 'bc-essai-0001';
  execute ${q(E.SQL_COMPTES_ENVOI)} into v_c using v_bc;
  execute ${q(E.SQL_FINIR_ENVOI)} using v_bc, v_c.envoyes, v_c.echecs, 'fini', null::text;
  execute ${q(E.SQL_DERNIER_REEL)} into v_dernier using array['resend', 'broadcast']::text[];
  v_res := v_res || jsonb_build_object('broadcast_confies', v_c.envoyes, 'broadcast_a_envoyer', v_c.a_envoyer,
    'broadcast_id_garde', (select resend_broadcast_id = 'bc-essai-0001' from public.academie_emails_envois where id = v_bc),
    'broadcast_synchro_lue', (select (synchro ->> 'applique')::boolean from public.academie_emails_envois where id = v_bc),
    'garde_resend_voit_broadcast', v_dernier is not null);
  execute 'select count(*) from (' || ${q(B.SQL_BROADCASTS_PASSES)} || ') t' into v_n;
  v_res := v_res || jsonb_build_object('broadcasts_passes', v_n);

  -- Broadcast simule
  execute ${q(E.SQL_CREER_ENVOI)} into v_sim
    using 'reel', 'simulation', 'tous', 'Essai Broadcast simule', 'Texte', null::text, null::uuid, 2, 0, true, null::uuid;
  execute ${q(E.SQL_INSERER_DESTINATAIRES)} using v_sim, array['un@exemple.fr', 'deux@exemple.fr'], array['', ''], array['gratuit', 'gratuit'];
  execute ${q(B.SQL_SIMULER_TOUT)} using v_sim;
  execute ${q(E.SQL_COMPTES_ENVOI)} into v_c using v_sim;
  v_res := v_res || jsonb_build_object('broadcast_simule', v_c.envoyes);

  -- Desinscriptions lues chez Resend : jamais annulees par une reinscription de chez nous
  select email into v_mail2 from public.academie_emails_destinataires where envoi_id = v_bc order by email desc limit 1;
  execute 'select count(*) filter (where not desinscrit) from (' || v_dest || ') t' into v_avant using 'comptes';
  execute ${q(B.SQL_IMPORTER_DESINSCRITS)} using array[v_mail2, 'Pas Une Adresse'];
  execute ${q(B.SQL_IMPORTER_DESINSCRITS)} using array[v_mail2];
  execute 'select count(*) filter (where not desinscrit) from (' || v_dest || ') t' into v_apres using 'comptes';
  v_res := v_res || jsonb_build_object('resend_desinscription_retire', v_avant - v_apres,
    'resend_source', (select source from public.academie_emails_desinscriptions where email = v_mail2),
    'resend_le_pose', (select resend_le is not null from public.academie_emails_desinscriptions where email = v_mail2),
    'adresse_invalide_ignoree', (select count(*) = 0 from public.academie_emails_desinscriptions where email = 'pas une adresse'));
  update public.academie_emails_desinscriptions set reinscrit_le = now() where email = v_mail2;
  execute ${q(B.SQL_IMPORTER_DESINSCRITS)} using array[v_mail2];
  v_res := v_res || jsonb_build_object('resend_annule_reinscription', (select reinscrit_le is null from public.academie_emails_desinscriptions where email = v_mail2));
  execute ${q(E.SQL_DESINSCRIRE)} using 'nous@exemple.fr', 'equipe', null::uuid;
  execute 'select count(*) from (' || ${q(B.SQL_DESINSCRITS_BASE)} || ') t where resend_le is null' into v_n;
  v_res := v_res || jsonb_build_object('desinscrits_a_pousser', v_n);
  execute ${q(B.SQL_NOTER_RESEND_LE)} using array['nous@exemple.fr'];
  execute 'select count(*) from (' || ${q(B.SQL_DESINSCRITS_BASE)} || ') t where resend_le is null' into v_n;
  v_res := v_res || jsonb_build_object('desinscrits_a_pousser_apres', v_n);

  -- Contraintes de la voie Broadcast
  v_refus := 0;
  begin insert into public.academie_emails_envois (mode, transport, groupe, objet, texte) values ('reel', 'kit', 'tous', 'o', 't'); exception when check_violation then v_refus := v_refus + 1; end;
  begin update public.academie_emails_envois set resend_broadcast_id = 'x y z' where id = v_sim; exception when check_violation then v_refus := v_refus + 1; end;
  begin insert into public.academie_emails_desinscriptions (email, source) values ('z@exemple.fr', 'kit'); exception when check_violation then v_refus := v_refus + 1; end;
  v_res := v_res || jsonb_build_object('refus_contraintes_broadcast', v_refus);

  raise exception 'ESSAI_OK %', v_res::text;
end
$essai$;`

const i = process.argv.indexOf('--imprimer')
if (i >= 0) {
  writeFileSync(process.argv[i + 1], BLOC)
  console.log(`bloc ecrit (${BLOC.length} caracteres) : ${process.argv[i + 1]}`)
} else {
  const { PrismaClient } = await import('@prisma/client')
  const url = process.env.DIRECT_URL
  if (!url) throw new Error('DIRECT_URL absente (node --env-file=.env.local ...)')
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    await prisma.$executeRawUnsafe(BLOC)
    console.error('ANORMAL : le bloc n\'a pas leve ESSAI_OK')
    process.exitCode = 1
  } catch (err) {
    const m = String(err?.message ?? err)
    const ok = /ESSAI_OK (\{.*\})/.exec(m)
    if (ok) console.log(`ESSAI_OK ${ok[1]}`)
    else { console.error(m.replace(/[^\s@]+@[^\s@]+/g, '[email]').slice(0, 2000)); process.exitCode = 1 }
  } finally {
    const reste = await prisma.$queryRawUnsafe(`select to_regclass('public.academie_emails_envois') is null as absente`)
    console.log(`apres l'essai, table absente : ${reste[0]?.absente}`)
    await prisma.$disconnect()
  }
}
