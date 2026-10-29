// Les requetes SQL des abonnements de Pilotage (brief E1, 30/10/2026), en
// texte, parametres positionnels passes a prisma.$queryRawUnsafe (lies par le
// pilote : jamais de valeur collee dans le texte). Aucun import, comme
// academie/requetes.ts : scripts/essayer-migration-pilotage.mjs joue EXACTEMENT
// ces requetes contre la vraie base, dans une transaction toujours annulee.
// Tables : academie_offres et academie_acces (20261015210000, 20261018220000),
// offres de Pilotage : 20261031120000_pilotage_offres.sql.

/** $1 = slugs. Les prix Stripe des offres de Pilotage (vides tant que le script de creation n'a pas tourne). */
export const SQL_PRIX = `
select o.slug, o.stripe_price_id
  from public.academie_offres o
 where o.slug = any($1::text[]) and o.type = 'abonnement' and o.canal = 'stripe_aok'
`

/**
 * L'acces d'un abonnement, une ligne par abonnement (index unique
 * academie_acces_stripe_reference_idx). Seconde ecriture = mise a jour de
 * l'offre (changement par le portail) et de la fin, sauf ligne retiree.
 * $1 = user_id ou null, $2 = email ou null, $3 = slug, $4 = sub_..., $5 =
 * montant EUR, $6 = fin, $7 = renonciation, $8 = note, $9 = paiement_id ou null.
 */
export const SQL_POSER_ABONNEMENT = `
with o as (
  select id from public.academie_offres where slug = $3::text and type = 'abonnement'
),
ins as (
  insert into public.academie_acces (user_id, email, offre_id, source, reference, montant_eur, debut, fin,
                                     renonciation_retractation_le, pose_par, note, paiement_id, cote)
  select $1::uuid, $2::text, o.id, 'stripe', $4::text, $5::numeric, now(), $6::timestamptz, $7::timestamptz,
         'stripe', $8::text, $9::text, 'brice'
    from o
  on conflict (reference) where source = 'stripe' and reference is not null do update set
    offre_id = excluded.offre_id,
    fin = excluded.fin,
    montant_eur = excluded.montant_eur,
    user_id = coalesce(academie_acces.user_id, excluded.user_id),
    email = coalesce(academie_acces.email, excluded.email),
    paiement_id = coalesce(academie_acces.paiement_id, excluded.paiement_id),
    renonciation_retractation_le = coalesce(academie_acces.renonciation_retractation_le, excluded.renonciation_retractation_le)
  where academie_acces.retire_le is null and academie_acces.debut < excluded.fin
  returning (xmax = 0) as cree
)
select (select count(*)::int from o) as offre_connue,
       (select count(*)::int from ins where cree) as cree,
       (select count(*)::int from ins) as ecrit
`

/** Abonnement impaye ou en pause : le droit se ferme (fin = maintenant), la ligne reste et se rouvre au paiement. $1 = sub_... */
export const SQL_FERMER_ABONNEMENT = `
update public.academie_acces set fin = now()
 where source = 'stripe' and reference = $1::text and retire_le is null
   and debut < now() and (fin is null or fin > now())
`

/** Abonnement termine (canceled) : le droit se retire, rien ne s'efface. $1 = sub_... */
export const SQL_RETIRER_ABONNEMENT = `
with r as (
  update public.academie_acces a set
    retire_le = now(),
    retire_par = 'stripe:abonnement-termine',
    note = left(coalesce(nullif(a.note, '') || ' | ', '') || 'Abonnement termine chez Stripe', 1000)
   where a.source = 'stripe' and a.reference = $1::text and a.retire_le is null
  returning a.id
)
select count(*)::int as retires from r
`

/**
 * $1 = uuid du compte, $2 = emails verifies (text[]), $3 = slugs. Les
 * abonnements ACTIFS du membre, le plus long d'abord.
 */
export const SQL_ABONNEMENTS_DU_MEMBRE = `
select o.slug, a.reference
  from public.academie_acces a
  join public.academie_offres o on o.id = a.offre_id
 where o.slug = any($3::text[])
   and a.retire_le is null and a.debut <= now() and (a.fin is null or a.fin > now())
   and (a.user_id = $1::uuid or a.email = any($2::text[]))
 order by a.fin desc nulls first
`

