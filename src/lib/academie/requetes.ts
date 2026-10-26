// Les requetes SQL de l'academie (15/10/2026), en texte, avec des parametres
// positionnels ($1, $2...) passes a prisma.$queryRawUnsafe / $executeRawUnsafe
// (parametres lies par le pilote : jamais de valeur collee dans le texte).
//
// Pourquoi des chaines plutot que des gabarits $queryRaw`...` : ce module n'a
// aucun import, et scripts/essayer-migration-academie.mjs joue EXACTEMENT ces
// requetes contre la vraie base, dans une transaction toujours annulee, juste
// apres la migration 20261015210000. Ce que le test valide est donc ce que
// les routes executent.
//
// Tables : sites/Aoknowledgecom/supabase/migrations/20261015210000_academie_tables.sql,
// etats et « vu » a 60 % : 20261016110000_academie_etats_vu.sql (vu_le, vu_par,
// evenement texte_fin). Ces requetes demandent les deux migrations ;
// SQL_NOTER_RESSOURCE demande aussi 20261016140000_academie_ressources_protegees.sql.
// Toutes les colonnes uuid sortent en ::text, les compteurs en ::int.

// ---------------------------------------------------------------------------
// Droits (droits.ts)
// ---------------------------------------------------------------------------

/**
 * $1 = uuid du compte. Le role metier (profiles.role) et les emails VERIFIES
 * du compte, en minuscules : l'email de auth.users s'il est confirme, et ceux
 * de profile_emails marques verified (seul handle_new_user les pose,
 * migration 20260930130400).
 */
export const SQL_IDENTITE = `
select
  (select p.role::text from public.profiles p where p.id = $1::uuid) as role,
  coalesce(array(
    select distinct x.e from (
      select lower(btrim(u.email)) as e
        from auth.users u
       where u.id = $1::uuid and u.email is not null and u.email_confirmed_at is not null
      union
      select lower(btrim(pe.email))
        from public.profile_emails pe
       where pe.profile_id = $1::uuid and pe.verified = true and pe.email is not null
    ) x
    where x.e <> ''
  ), '{}'::text[]) as emails
`

/**
 * $1 = emails verifies (text[]). Ce que le cockpit sait de ces emails :
 * - etm : statut ETM actif (cockpit_statut_etm) ;
 * - broker_jusquau : acces broker actif au Live Club (cockpit_liveclub_acces,
 *   meme filtre que droitLiveClub) ;
 * - manuel_jusquau : date d'acces posee a la main sur le membre
 *   (cockpit_acces_manuel), que droitLiveClub compte aussi comme Live Club ;
 * - exempte : exemption ACTIVE du Live Club (cockpit_liveclub_exemptions,
 *   retire_le vide, jusquau vide ou pas depasse) rattachee a un de ces emails,
 *   par sa colonne email ou par l'email d'un membre (membre_id), migration
 *   20261026100000. Compte comme Live Club actif, comme broker et manuel ;
 * - secours_essai : la decision B de la page d'essai sans Stripe (rang Skool
 *   vip ou premium, abonnement en cours vu par le cockpit, acces mentorat
 *   manuel MentoratGrant).
 */
export const SQL_FAITS_COCKPIT = `
select
  exists (
    select 1 from public.cockpit_statut_etm s
      join public.cockpit_membre_emails me on me.membre_id = s.membre_id
     where s.retire_le is null and lower(me.email) = any($1::text[])
  ) as etm,
  (
    select max(a.jusquau)::text from public.cockpit_liveclub_acces a
     where a.retire_le is null and a.sorti_le is null and a.jusquau >= current_date
       and lower(a.email) = any($1::text[])
  ) as broker_jusquau,
  (
    select max(am.acces_jusquau)::text from public.cockpit_acces_manuel am
      join public.cockpit_membre_emails me on me.membre_id = am.membre_id
     where am.acces_jusquau >= current_date and lower(me.email) = any($1::text[])
  ) as manuel_jusquau,
  exists (
    select 1 from public.cockpit_liveclub_exemptions x
     where x.retire_le is null and (x.jusquau is null or x.jusquau >= current_date)
       and (
         lower(x.email) = any($1::text[])
         or exists (
           select 1 from public.cockpit_membre_emails me
            where me.membre_id = x.membre_id and lower(me.email) = any($1::text[])
         )
       )
  ) as exempte,
  (
    exists (
      select 1 from public.cockpit_membre_emails me
        join public.cockpit_membres_etat e on e.membre_id = me.membre_id
       where lower(me.email) = any($1::text[])
         and (e.tier_skool::text in ('vip', 'premium') or e.abonnement_en_cours is true)
    )
    or exists (
      select 1 from public."MentoratGrant" g
       where g."revokedAt" is null and lower(btrim(g.email)) = any($1::text[])
    )
  ) as secours_essai
`

/**
 * $1 = uuid du compte, $2 = emails verifies (text[]). Une ligne par contenu :
 * - 'acces' : les acces ACTIFS du compte (user_id ou email verifie), avec les
 *   contenus de leur offre (module_id vide = offre sans contenu) ;
 * - 'base' : les contenus des offres compte gratuit et Live Club ;
 * - 'essai' : le module d'essai, pour le secours de la decision B.
 */
export const SQL_ACCES = `
select 'acces'::text as origine, a.source, o.slug, o.ouvre_tout,
       c.module_id::text as module_id, c.section_id::text as section_id
  from public.academie_acces a
  join public.academie_offres o on o.id = a.offre_id
  left join public.academie_offre_contenus c on c.offre_id = o.id
 where a.retire_le is null and a.debut <= now() and (a.fin is null or a.fin > now())
   and (a.user_id = $1::uuid or a.email = any($2::text[]))
union all
select 'base'::text, null::text, o.slug, o.ouvre_tout,
       c.module_id::text, c.section_id::text
  from public.academie_offres o
  left join public.academie_offre_contenus c on c.offre_id = o.id
 where o.slug in ('compte-gratuit', 'live-club')
union all
select 'essai'::text, null::text, m.slug, false, m.id::text, null::text
  from public.academie_modules m
 where m.slug = 'essai'
`

// ---------------------------------------------------------------------------
// Catalogue (catalogue.ts)
// ---------------------------------------------------------------------------

/** Les modules visibles (publies ou a venir), dans l'ordre. prix_eur vide = pas vendu seul. */
export const SQL_MODULES_VISIBLES = `
select m.id::text as id, m.slug, m.titre, m.resume, m.ordre, m.parcours, m.statut, m.auteur, m.image,
       m.prix_eur::float8 as prix_eur
  from public.academie_modules m
 where m.statut in ('publie', 'a_venir')
 order by m.ordre, m.titre
`

/**
 * Les offres qui ouvrent quelque chose de chaque module (pour le cadenas des
 * ecrans : « ce module s'obtient avec... ») : portee 'module' (le module
 * entier), 'sections' (une partie seulement) ; et, module_id vide, les offres
 * qui ouvrent tout (portee 'tout', ETM).
 */
export const SQL_OFFRES_DES_MODULES = `
select c.module_id::text as module_id, o.slug, o.titre, o.type, o.prix_eur::float8 as prix_eur,
       case when bool_or(c.section_id is null) then 'module' else 'sections' end as portee
  from public.academie_offre_contenus c
  join public.academie_offres o on o.id = c.offre_id
 group by c.module_id, o.id
union all
select null::text, o.slug, o.titre, o.type, o.prix_eur::float8, 'tout'
  from public.academie_offres o
 where o.ouvre_tout
 order by 1, 2
`

/** Les sections des modules visibles. */
export const SQL_SECTIONS_VISIBLES = `
select s.id::text as id, s.module_id::text as module_id, s.ordre, s.titre
  from public.academie_sections s
  join public.academie_modules m on m.id = s.module_id
 where m.statut in ('publie', 'a_venir')
 order by s.module_id, s.ordre, s.titre
`

/** Les lecons visibles (publiees ou a venir) des modules visibles. Sans identifiant d'hebergeur ni contenu. */
export const SQL_LECONS_VISIBLES = `
select l.id::text as id, l.module_id::text as module_id, l.section_id::text as section_id,
       l.slug, l.ordre, l.titre, l.type, l.format, l.usage, l.duree_s, l.apercu, l.statut
  from public.academie_lecons l
  join public.academie_modules m on m.id = l.module_id
 where m.statut in ('publie', 'a_venir') and l.statut in ('publie', 'a_venir')
 order by l.module_id, l.ordre, l.titre
`

const COLONNES_LECON = `
  l.id::text as id, l.module_id::text as module_id, l.section_id::text as section_id,
  l.slug, l.ordre, l.titre, l.type, l.format, l.usage, l.hebergeur, l.bunny_bibliotheque, l.bunny_video_id,
  l.wistia_id, l.duree_s, l.contenu, l.ressources, l.apercu, l.statut,
  m.statut as module_statut, m.slug as module_slug, m.titre as module_titre`

/** $1 = id de la lecon. Toute la lecon (identifiants d'hebergeur et contenu compris), quel que soit son statut. */
export const SQL_LECON_PAR_ID = `
select ${COLONNES_LECON}
  from public.academie_lecons l
  join public.academie_modules m on m.id = l.module_id
 where l.id = $1::uuid
`

/** $1 = guid Bunny. Les lecons PUBLIEES (module publie) qui portent cette video. */
export const SQL_LECONS_PAR_VIDEO = `
select ${COLONNES_LECON}
  from public.academie_lecons l
  join public.academie_modules m on m.id = l.module_id
 where l.bunny_video_id = $1 and l.statut = 'publie' and m.statut = 'publie'
 order by m.ordre, l.ordre
`

// ---------------------------------------------------------------------------
// Suivi (suivi.ts)
// ---------------------------------------------------------------------------

/**
 * $1 = compte, $2 = lecon, $3 = ip (texte ou null), $4 = appareil (ou null).
 * Un lien vient d'etre delivre : la progression est creee ou rafraichie
 * (derniere_vue_le ; une nouvelle session si la precedente date de plus de 30
 * minutes) et le journal note l'evenement 'lien'. Rend la progression.
 */
export const SQL_NOTER_LIEN = `
with prog as (
  insert into public.academie_progression as p (user_id, lecon_id, derniere_vue_le, nb_sessions)
  values ($1::uuid, $2::uuid, now(), 1)
  on conflict (user_id, lecon_id) do update set
    nb_sessions = p.nb_sessions
      + case when p.derniere_vue_le < now() - interval '30 minutes' then 1 else 0 end,
    derniere_vue_le = now()
  returning p.derniere_position_s, p.position_max_s, p.secondes_vues, p.pourcentage,
            p.terminee_le, p.marquee_vue_le, p.vu_le, p.vu_par
), journal as (
  insert into public.academie_lectures (user_id, lecon_id, evenement, ip, appareil)
  values ($1::uuid, $2::uuid, 'lien', $3::inet, $4::text)
  returning 1
)
select prog.*, (select count(*)::int from journal) as journalise from prog
`

/**
 * $1 = compte, $2 = lecon, $3 = chemin du fichier dans le bucket prive, $4 = ip
 * (texte ou null), $5 = appareil (ou null). Une piece jointe PROTEGEE vient
 * d'etre delivree (URL signee de 5 min) : ligne 'ressource' au journal, avec
 * le fichier (preuve « tel document a ete ouvert »). La progression n'est pas
 * touchee (l'ouverture de la lecon l'a deja creee).
 * Demande la migration 20261016140000_academie_ressources_protegees.sql
 * (evenement 'ressource', colonne ressource).
 */
export const SQL_NOTER_RESSOURCE = `
insert into public.academie_lectures (user_id, lecon_id, evenement, ressource, ip, appareil)
values ($1::uuid, $2::uuid, 'ressource', $3::text, $4::inet, $5::text)
`

/** $1 = compte, $2 = lecon. L'etat d'une progression pour appliquer un signal, avec l'heure de la base. */
export const SQL_ETAT_SIGNAL = `
select p.position_max_s, p.derniere_position_s, p.secondes_vues, p.pourcentage, p.terminee_le,
       p.marquee_vue_le, p.vu_le, p.derniere_vue_le, p.dernier_signal_le, p.nb_signaux,
       l.type, l.duree_s, l.statut, now() as maintenant
  from public.academie_progression p
  join public.academie_lecons l on l.id = p.lecon_id
 where p.user_id = $1::uuid and p.lecon_id = $2::uuid
`

/**
 * Applique un signal accepte, en UN ordre (mise a jour + journal) :
 * $1 compte, $2 lecon, $3 nb_signaux lu (verrou optimiste : un signal
 * concurrent ne met rien a jour), $4 position_max_s, $5 derniere_position_s,
 * $6 secondes_vues, $7 pourcentage (ou null), $8 terminer (bool),
 * $9 marque ('poser', 'retirer' ou null), $10 evenement du journal,
 * $11 secondes creditees (ou null), $12 position (ou null), $13 ip,
 * $14 appareil, $15 vu ('poser', 'retirer' ou null), $16 vu_par (la voie,
 * gardee seulement si la lecon n'etait pas deja vue). Aucune ligne rendue =
 * le signal a perdu la course.
 */
export const SQL_APPLIQUER_SIGNAL = `
with maj as (
  update public.academie_progression p set
    position_max_s = $4::int,
    derniere_position_s = $5::int,
    secondes_vues = $6::int,
    pourcentage = $7::smallint,
    terminee_le = case when p.terminee_le is null and $8::boolean then now() else p.terminee_le end,
    marquee_vue_le = case $9::text
      when 'poser' then coalesce(p.marquee_vue_le, now())
      when 'retirer' then null
      else p.marquee_vue_le end,
    vu_le = case $15::text
      when 'poser' then coalesce(p.vu_le, now())
      when 'retirer' then null
      else p.vu_le end,
    vu_par = case $15::text
      when 'poser' then case when p.vu_le is null then $16::text else p.vu_par end
      when 'retirer' then null
      else p.vu_par end,
    dernier_signal_le = now(),
    nb_signaux = p.nb_signaux + 1
  where p.user_id = $1::uuid and p.lecon_id = $2::uuid and p.nb_signaux = $3::int
  returning p.position_max_s, p.derniere_position_s, p.secondes_vues, p.pourcentage,
            p.terminee_le, p.marquee_vue_le, p.vu_le, p.vu_par
), journal as (
  insert into public.academie_lectures (user_id, lecon_id, evenement, secondes, position_s, ip, appareil)
  select $1::uuid, $2::uuid, $10::text, $11::int, $12::int, $13::inet, $14::text from maj
  returning 1
)
select maj.*, (select count(*)::int from journal) as journalise from maj
`

/**
 * $1 = compte, $2 = ip, $3 = appareil. Une connexion a l'academie, notee au
 * plus une fois par 30 minutes (deux appels simultanes peuvent en noter deux :
 * sans consequence).
 */
export const SQL_NOTER_CONNEXION = `
insert into public.academie_lectures (user_id, evenement, ip, appareil)
select $1::uuid, 'connexion', $2::inet, $3::text
 where not exists (
   select 1 from public.academie_lectures
    where user_id = $1::uuid and evenement = 'connexion' and cree_le > now() - interval '30 minutes'
 )
`

/** $1 = compte. Toute la progression du compte. */
export const SQL_PROGRESSION_COMPTE = `
select p.lecon_id::text as lecon_id, p.position_max_s, p.derniere_position_s, p.secondes_vues,
       p.pourcentage, p.terminee_le, p.marquee_vue_le, p.vu_le, p.vu_par, p.derniere_vue_le
  from public.academie_progression p
 where p.user_id = $1::uuid
`

// ---------------------------------------------------------------------------
// Gestes du cockpit (route /api/cockpit/academie, 18/10/2026)
// ---------------------------------------------------------------------------

/**
 * Accorder une offre a un email (source 'offert'). $1 = email (minuscules),
 * $2 = slug de l'offre, $3 = dernier jour d'acces 'YYYY-MM-DD' (ou null = a
 * vie : l'acces court jusqu'a minuit, heure de Paris, de ce jour-la),
 * $4 = pose_par (cockpit:<uuid>), $5 = note (la raison).
 * Idempotent : un acces ACTIF de cette offre deja pose sur l'email, ou sur un
 * compte qui a cet email verifie, n'est pas double (deja_id le rend).
 * offre_connue = 0 : slug inconnu, rien n'est pose.
 */
export const SQL_GESTE_ACCORDER = `
with o as (
  select id from public.academie_offres where slug = $2::text
), deja as (
  select a.id from public.academie_acces a
    join o on o.id = a.offre_id
   where a.retire_le is null and (a.fin is null or a.fin > now())
     and (a.email = $1::text or a.user_id in (
       select u.id from auth.users u
        where lower(btrim(u.email)) = $1::text and u.email_confirmed_at is not null
       union
       select pe.profile_id from public.profile_emails pe
        where lower(btrim(pe.email)) = $1::text and pe.verified = true))
   limit 1
), ins as (
  insert into public.academie_acces (email, offre_id, source, fin, pose_par, note)
  select $1::text, o.id, 'offert',
         case when $3::date is null then null
              else (($3::date + 1)::timestamp at time zone 'Europe/Paris') end,
         $4::text, $5::text
    from o
   where not exists (select 1 from deja)
  returning id, debut, fin
)
select (select count(*)::int from o) as offre_connue,
       (select id::text from deja) as deja_id,
       ins.id::text as acces_id, ins.debut, ins.fin
  from (select 1) x left join ins on true
`

/**
 * Retirer un acces. $1 = id de l'acces, $2 = retire_par (cockpit:<uuid>),
 * $3 = ajout a la note ('Retrait : <raison>'). L'ancienne note est gardee
 * devant, tronquee pour que l'ajout tienne dans les 1 000 caracteres. Aucune
 * ligne rendue = acces inconnu ou deja retire.
 */
export const SQL_GESTE_RETIRER = `
update public.academie_acces a set
  retire_le = now(),
  retire_par = $2::text,
  note = case when a.note is null or a.note = '' then $3::text
              else left(left(a.note, greatest(0, 997 - length($3::text))) || ' | ' || $3::text, 1000) end
 where a.id = $1::uuid and a.retire_le is null
returning a.id::text as acces_id, a.retire_le
`

// ---------------------------------------------------------------------------
// Vente a l'unite (achat.ts, 19/10/2026 ; index 20261019150000)
// ---------------------------------------------------------------------------

/**
 * $1 = slug du module. L'offre « module-<slug> » si le module se vend seul
 * chez Stripe Ao Knowledge : module publie, offre de type module, canal
 * stripe_aok, prix et stripe_price_id poses. Aucune ligne = pas en vente.
 */
export const SQL_OFFRE_EN_VENTE = `
select m.slug as module_slug, m.titre as module_titre, o.slug as offre_slug, o.stripe_price_id
  from public.academie_modules m
  join public.academie_offres o on o.slug = 'module-' || m.slug
 where m.slug = $1::text and m.statut = 'publie'
   and o.type = 'module' and o.canal = 'stripe_aok'
   and o.prix_eur is not null and o.prix_eur > 0 and o.stripe_price_id is not null
 limit 1
`

/** $1 = uuid du compte. Son email s'il est confirme (prerempli dans Checkout). */
export const SQL_EMAIL_CONFIRME = `
select lower(btrim(u.email)) as email
  from auth.users u
 where u.id = $1::uuid and u.email is not null and u.email_confirmed_at is not null
`

/**
 * L'acces d'un achat Stripe, une seule fois par session Checkout (index
 * academie_acces_stripe_reference_idx). $1 = user_id ou null, $2 = email ou
 * null, $3 = slug de l'offre, $4 = id de session (cs_...), $5 = montant EUR,
 * $6 = renonciation a la retractation (moment du paiement si la case de
 * Checkout est cochee, sinon null), $7 = note, $8 = paiement_id (stripe:ch_...) ou null.
 * Rend { offre_connue, cree } : cree = false si la session etait deja notee.
 */
export const SQL_POSER_ACHAT = `
with o as (
  select id from public.academie_offres where slug = $3::text and type = 'module'
),
ins as (
  insert into public.academie_acces (user_id, email, offre_id, source, reference, montant_eur, debut,
                                     renonciation_retractation_le, pose_par, note, paiement_id, cote)
  select $1::uuid, $2::text, o.id, 'stripe', $4::text, $5::numeric, now(), $6::timestamptz, 'stripe', $7::text, $8::text, 'brice'
    from o
  on conflict (reference) where source = 'stripe' and reference is not null do nothing
  returning id
)
select (select count(*)::int from o) as offre_connue, (select count(*)::int from ins) as cree
`

/** Complete le paiement d'un acces deja pose sans lui. $1 = cs_..., $2 = stripe:ch_... */
export const SQL_COMPLETER_PAIEMENT = `
update public.academie_acces set paiement_id = $2::text
 where source = 'stripe' and reference = $1::text and paiement_id is null
`

/**
 * Remboursement total : l'acces se retire (rien ne s'efface). $1 =
 * stripe:ch_..., $2 = liste des sessions Checkout du paiement (cs_..., pour
 * un acces pose sans paiement_id). Rend le nombre d'acces retires.
 */
export const SQL_RETIRER_REMBOURSE = `
with r as (
  update public.academie_acces a set
    retire_le = now(),
    retire_par = 'stripe:remboursement',
    note = left(coalesce(nullif(a.note, '') || ' | ', '') || 'Rembourse chez Stripe', 1000)
   where a.source = 'stripe' and a.retire_le is null
     and (a.paiement_id = $1::text or a.reference = any($2::text[]))
  returning a.id
)
select count(*)::int as retires from r
`

/** $1 = email (minuscules). Les comptes du site qui portent cet email VERIFIE (memes regles que SQL_IDENTITE). */
export const SQL_COMPTES_DE_EMAIL = `
select u.id::text as id from auth.users u
 where lower(btrim(u.email)) = $1::text and u.email_confirmed_at is not null
union
select pe.profile_id::text from public.profile_emails pe
 where lower(btrim(pe.email)) = $1::text and pe.verified = true
`

// ---------------------------------------------------------------------------
// Edition dans l'app par l'admin (edition.ts, route /api/academie/edition ;
// migration 20261023120000_academie_editions.sql, 23/10/2026)
// ---------------------------------------------------------------------------
//
// version = maj_le en texte : le verrou optimiste. L'ecriture ne passe que si
// la ligne n'a pas bouge depuis la lecture (importeur, autre onglet) ; sinon
// elle ne rend aucune ligne et la route repond 409.

/** $1 = id de la lecon. Ce que l'editeur modifie, et sa version. */
export const SQL_EDITION_LIRE_LECON = `
select l.id::text as id, l.titre, l.contenu, l.type, l.statut, l.edite_le, l.maj_le::text as version
  from public.academie_lecons l
 where l.id = $1::uuid
`

/** $1 = id du module. Ce que l'editeur modifie, et sa version. */
export const SQL_EDITION_LIRE_MODULE = `
select m.id::text as id, m.titre, m.resume, m.edite_le, m.maj_le::text as version
  from public.academie_modules m
 where m.id = $1::uuid
`

/**
 * $1 = id de la lecon, $2 = version lue, $3 = titre, $4 = contenu (ou null),
 * $5 = compte admin, $6 = historique (jsonb : [{ champ, avant, apres }], les
 * champs qui changent). Une ligne (la lecon a jour, historique = lignes
 * ecrites), ou aucune si la lecon a change depuis la lecture.
 */
export const SQL_EDITION_ECRIRE_LECON = `
with maj as (
  update public.academie_lecons l
     set titre = $3::text, contenu = $4::text, edite_le = now(), edite_par = $5::uuid
   where l.id = $1::uuid and l.maj_le = $2::timestamptz
  returning l.id, l.titre, l.contenu, l.edite_le, l.maj_le
), historique as (
  insert into public.academie_editions (cible, cible_id, champ, avant, apres, par, origine)
  select 'lecon', m.id, h.champ, h.avant, h.apres, $5::uuid, 'app'
    from maj m
   cross join jsonb_to_recordset($6::jsonb) as h(champ text, avant text, apres text)
  returning 1
)
select m.id::text as id, m.titre, m.contenu, m.edite_le, m.maj_le::text as version,
       (select count(*)::int from historique) as historique
  from maj m
`

/** Comme SQL_EDITION_ECRIRE_LECON, pour un module : $3 = titre, $4 = resume (ou null). */
export const SQL_EDITION_ECRIRE_MODULE = `
with maj as (
  update public.academie_modules m
     set titre = $3::text, resume = $4::text, edite_le = now(), edite_par = $5::uuid
   where m.id = $1::uuid and m.maj_le = $2::timestamptz
  returning m.id, m.titre, m.resume, m.edite_le, m.maj_le
), historique as (
  insert into public.academie_editions (cible, cible_id, champ, avant, apres, par, origine)
  select 'module', x.id, h.champ, h.avant, h.apres, $5::uuid, 'app'
    from maj x
   cross join jsonb_to_recordset($6::jsonb) as h(champ text, avant text, apres text)
  returning 1
)
select x.id::text as id, x.titre, x.resume, x.edite_le, x.maj_le::text as version,
       (select count(*)::int from historique) as historique
  from maj x
`

/**
 * L'importeur force (--ecraser-editions) : $1 = cible, $2 = id, $3 = historique
 * (jsonb, comme ci-dessus). origine 'import', sans auteur.
 */
export const SQL_EDITION_HISTORIQUE_IMPORT = `
insert into public.academie_editions (cible, cible_id, champ, avant, apres, par, origine)
select $1::text, $2::uuid, h.champ, h.avant, h.apres, null, 'import'
  from jsonb_to_recordset($3::jsonb) as h(champ text, avant text, apres text)
`
