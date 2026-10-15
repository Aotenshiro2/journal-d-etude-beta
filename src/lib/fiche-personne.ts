// LA FICHE D'UNE PERSONNE, cote serveur (passe 2 du chantier « noms et
// paroles des membres », Brice 15/10/2026). Regles dans fiche-personne-pur.ts.
//
// Un seul appelant : l'outil de LECTURE fiche_personne de l'agent du Cockpit
// (agent-cockpit.ts), sans carte puisqu'il n'ecrit rien. L'agent n'est servi
// qu'a l'equipe : /api/cockpit/agent (Bearer + cockpit_allowlist), Agent AOK
// (cockpit_telegram_comptes) et les messages d'un compte de l'equipe au bot des
// membres (transmettreSiEquipe, meme table). AUCUNE route membre
// (/api/support/*, /api/mentorat/*, /api/liveclub/*) ni aucun outil d'un bot
// membre n'importe ce fichier : scripts/verifier-fiche-personne.mjs le
// verifie a chaque lancement.
//
// Tout se lit dans UNE transaction en lecture seule (SET TRANSACTION READ
// ONLY, delai de 8 s par requete) : meme une erreur de ce code ne peut rien
// ecrire. Les dates sont a l'heure de Paris.

import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import {
  ACCENTS, SANS_ACCENTS, BUDGET_FICHE,
  lireQui, grouper, idsDuGroupe, phrasesTrouvePar, phraseLien,
  fichePourAgent, ficheVide, lireMessagesJson, reponseAucun, reponseCandidats,
  type DonneesFiche, type FilSupport, type Groupe, type Ligne, type LienLu, type NomLu, type QuiLu,
  type StatsCandidats, type Touche,
} from '@/lib/fiche-personne-pur'

type Tx = Prisma.TransactionClient

/** Messages lus par fiche, au plus (les plus recents, plus les deux premiers). */
const MAX_MESSAGES_LUS = 3000
/** Tours d'elargissement par liens certains (compte -> fiche -> autre compte...). */
const TOURS_LIENS = 3

/** Normalisation SQL identique a normaliser() (meme table, $acc et $sans en parametres). */
const N = (col: string, acc: string, sans: string) => `translate(lower(${col}), ${acc}::text, ${sans}::text)`
/** Horodatage a l'heure de Paris. */
const H = (col: string) => `to_char(${col} at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI')`
/** Horodatage sans fuseau (colonnes Prisma, stockees en UTC) a l'heure de Paris. */
const HU = (col: string) => `to_char((${col} at time zone 'UTC') at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI')`
/** Une date. */
const J = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`

type LigneTouche = { genre: string; id: string; champ: string; valeur: string | null; exact: boolean }

function versTouches(l: LigneTouche[]): Touche[] {
  const r: Touche[] = []
  for (const x of l) {
    const genre = x.genre === 'tg' || x.genre === 'membre' || x.genre === 'archive' ? x.genre : null
    if (!genre || !x.id) continue
    r.push({ noeud: `${genre}:${x.id}`, champ: x.champ, valeur: x.valeur, exact: x.exact === true })
  }
  return r
}

/** Un nom, un pseudo, un ancien nom : partout ou un nom est ecrit, accents et casse ignores. */
async function chercherTexte(tx: Tx, motif: string, exact: string): Promise<Touche[]> {
  const n = (c: string) => N(c, '$3', '$4')
  const lignes = await tx.$queryRawUnsafe<LigneTouche[]>(`
    select genre, id, champ, valeur, exact from (
      select 'tg' as genre, n.telegram_id::text as id, 'nom Telegram' as champ, n.nom_affiche as valeur, ${n('n.nom_affiche')} = $2 as exact
        from public.cockpit_telegram_noms n where ${n('n.nom_affiche')} like $1
      union all
      select 'tg', n.telegram_id::text, 'pseudo Telegram', '@' || n.pseudo, ${n('n.pseudo')} = $2
        from public.cockpit_telegram_noms n where ${n('n.pseudo')} like $1
      union all
      select 'tg', g.telegram_id::text, 'registre du groupe', g.nom_affiche, ${n('g.nom_affiche')} = $2
        from public.cockpit_telegram_membres g where ${n('g.nom_affiche')} like $1
      union all
      select 'tg', g.telegram_id::text, 'registre du groupe', '@' || g.pseudo, ${n('g.pseudo')} = $2
        from public.cockpit_telegram_membres g where ${n('g.pseudo')} like $1
      union all
      select distinct 'tg', m.telegram_id::text, 'auteur de messages', m.nom_affiche, ${n('m.nom_affiche')} = $2
        from public.cockpit_telegram_messages m where ${n('m.nom_affiche')} like $1
      union all
      select distinct 'tg', m.telegram_id::text, 'auteur de messages', '@' || m.pseudo, ${n('m.pseudo')} = $2
        from public.cockpit_telegram_messages m where ${n('m.pseudo')} like $1
      union all
      select 'archive', a.personne_id, 'archive (nom)', a.nom, ${n('a.nom')} = $2
        from public.cockpit_arch_personnes a where ${n('a.nom')} like $1
      union all
      select 'archive', a.personne_id, 'archive (alias)', left(a.alias, 120),
             exists (select 1 from unnest(string_to_array(a.alias, ',')) as x(v) where ${n('btrim(x.v)')} = $2)
        from public.cockpit_arch_personnes a where ${n('a.alias')} like $1
      union all
      select 'archive', a.personne_id, 'archive (pseudo)', '@' || ltrim(a.telegram, '@'), ${n("ltrim(a.telegram, '@')")} = $2
        from public.cockpit_arch_personnes a where ${n('a.telegram')} like $1
      union all
      select 'membre', m.membre_id::text, 'fiche membre', m.nom, ${n('m.nom')} = $2
        from public.cockpit_membres m where ${n('m.nom')} like $1
      union all
      select 'membre', m.membre_id::text, 'pseudo déclaré au paiement', m.telegram, ${n("ltrim(m.telegram, '@')")} = $2
        from public.cockpit_membres m where ${n('m.telegram')} like $1
      union all
      select 'membre', c.membre_id::text, 'pseudo posé à la main', c.telegram, ${n("ltrim(c.telegram, '@')")} = $2
        from public.cockpit_contact_manuel c where ${n('c.telegram')} like $1
    ) h
    limit 300`, motif, exact, ACCENTS, SANS_ACCENTS)
  return versTouches(lignes)
}

/** Un email : exact, sans casse, partout ou un email relie quelqu'un. */
async function chercherEmail(tx: Tx, email: string): Promise<{ touches: Touche[]; indices: string[] }> {
  const lignes = await tx.$queryRawUnsafe<LigneTouche[]>(`
    select genre, id, champ, valeur, true as exact from (
      select 'membre' as genre, e.membre_id::text as id, 'email de la fiche membre' as champ, e.email as valeur
        from public.cockpit_membre_emails e where lower(e.email) = $1
      union all
      select 'tg', r.telegram_id::text, 'email du rattachement (' || r.source || ')', r.email
        from public.cockpit_liveclub_rattachements r where lower(r.email) = $1 and r.retire_le is null
      union all
      select 'membre', r.membre_id::text, 'email du rattachement (' || r.source || ')', r.email
        from public.cockpit_liveclub_rattachements r where lower(r.email) = $1 and r.retire_le is null and r.membre_id is not null
      union all
      select 'tg', r.telegram_id::text, 'email d''un ancien rattachement (' || r.source || ', retiré)', r.email
        from public.cockpit_liveclub_rattachements r where lower(r.email) = $1 and r.retire_le is not null
      union all
      select 'tg', a.telegram_id::text, 'email de l''accès broker', a.email
        from public.cockpit_liveclub_acces a where lower(a.email) = $1 and a.telegram_id is not null
      union all
      select 'tg', t.telegram_id::text, 'email du tarif réservé', t.email
        from public.cockpit_liveclub_tarifs_reserves t where lower(t.email) = $1 and t.telegram_id is not null
      union all
      select 'tg', s."telegramId"::text, 'email donné au bot des membres', s."contactEmail"
        from public."SupportThread" s where lower(s."contactEmail") = $1 and s."telegramId" is not null
    ) h
    limit 50`, email)
  const touches = versTouches(lignes)
  const indices: string[] = []
  if (touches.length === 0) {
    // L'email existe peut-etre sans compte Telegram ni fiche : on le dit.
    const [c] = await tx.$queryRawUnsafe<{ acces: number; reserves: number }[]>(`
      select (select count(*) from public.cockpit_liveclub_acces where lower(email) = $1)::int as acces,
             (select count(*) from public.cockpit_liveclub_tarifs_reserves where lower(email) = $1)::int as reserves`, email)
    if (c?.acces) indices.push('Cet email a un accès broker, sans compte Telegram relié pour l\'instant : voir cockpit_liveclub_acces.')
    if (c?.reserves) indices.push('Cet email a un tarif réservé, sans compte Telegram relié pour l\'instant : voir cockpit_liveclub_tarifs_reserves.')
  }
  return { touches, indices }
}

/**
 * Les liens qui touchent ces noeuds. certain = il reunit deux noeuds en une personne.
 *
 * (15/10, Brice) LES COMPTES TELEGRAM SUCCESSIFS d'une meme personne sont
 * les siens : un rattachement RETIRE reste un lien (« ancien rattachement »),
 * certain s'il venait d'une preuve de possession (source 'bot' : lien
 * personnel ou code email) ou d'un changement de compte fait par le
 * titulaire (retire_raison 'changement_compte'), probable sinon (Metricgram,
 * geste manuel : peut-etre une erreur corrigee). Un rattachement sans
 * membre_id (le cas des liens poses par le bot avant que la fiche existe) se
 * relie a la fiche par son email. Un changement de compte relie aussi les
 * deux comptes entre eux (remplace_par), fiche ou pas. retire_raison et
 * remplace_par (migration 20261015230000) sont lus par to_jsonb : la requete
 * marche avant la migration.
 */
async function lireLiens(tx: Tx, ids: { telegram: number[]; membres: string[]; archives: string[] }): Promise<LienLu[]> {
  const u = ids.telegram.map((x) => `u${x}`)
  const raison = `(to_jsonb(r) ->> 'retire_raison')`
  const remplacant = `(to_jsonb(r) ->> 'remplace_par')`
  const lignes = await tx.$queryRawUnsafe<LienLu[]>(`
    select a, b, nature, certain from (
      select 'tg:' || r.telegram_id as a, 'membre:' || r.membre_id as b, 'rattachement ' || r.source as nature, true as certain
        from public.cockpit_liveclub_rattachements r
        where r.retire_le is null and r.membre_id is not null
          and (r.telegram_id = any($1::bigint[]) or r.membre_id = any($2::uuid[]))
      union all
      select 'tg:' || r.telegram_id, 'membre:' || e.membre_id, 'rattachement ' || r.source || ' (par l''email de la fiche)', true
        from public.cockpit_liveclub_rattachements r
        join public.cockpit_membre_emails e on e.email = lower(r.email)
        where r.retire_le is null and r.membre_id is null
          and (r.telegram_id = any($1::bigint[]) or e.membre_id = any($2::uuid[]))
      union all
      select 'tg:' || r.telegram_id, 'membre:' || coalesce(r.membre_id, e.membre_id),
             'ancien rattachement ' || r.source || ' (retiré le ' || ${J("r.retire_le at time zone 'Europe/Paris'")}
               || case when ${raison} = 'changement_compte' then ', changement de compte Telegram par le titulaire' else '' end || ')',
             (r.source = 'bot' or ${raison} = 'changement_compte')
        from public.cockpit_liveclub_rattachements r
        left join public.cockpit_membre_emails e on r.membre_id is null and e.email = lower(r.email)
        where r.retire_le is not null and coalesce(r.membre_id, e.membre_id) is not null
          and (r.telegram_id = any($1::bigint[]) or coalesce(r.membre_id, e.membre_id) = any($2::uuid[]))
      union all
      select 'tg:' || r.telegram_id, 'tg:' || ${remplacant},
             'compte Telegram remplacé par le titulaire (changement de compte du ' || ${J("r.retire_le at time zone 'Europe/Paris'")} || ')', true
        from public.cockpit_liveclub_rattachements r
        where ${raison} = 'changement_compte' and ${remplacant} ~ '^[0-9]{5,15}$'
          and (r.telegram_id = any($1::bigint[]) or ${remplacant}::bigint = any($1::bigint[]))
      union all
      select 'tg:' || ltrim(lower(c.telegram_num), 'u'), 'membre:' || c.membre_id, 'numéro Telegram posé à la main', true
        from public.cockpit_contact_manuel c
        where c.telegram_num ~* '^u?[0-9]{5,15}$'
          and (c.membre_id = any($2::uuid[]) or ('u' || ltrim(lower(c.telegram_num), 'u')) = any($4::text[]))
      union all
      select 'tg:' || substr(x.v, 2), 'archive:' || a.personne_id, 'même compte Telegram dans l''archive', true
        from public.cockpit_arch_personnes a cross join lateral unnest(a.tg_ids) as x(v)
        where x.v ~ '^u[0-9]{5,15}$' and (a.personne_id = any($3::text[]) or a.tg_ids && $4::text[])
      union all
      select 'archive:' || v.personne_id, 'membre:' || v.membre_id,
             'archive rapprochée par ' || coalesce(v.membre_lie_par, '?'), coalesce(v.membre_confiance = 'certain', false)
        from public.cockpit_membre_telegram v
        where v.membre_id is not null and (v.personne_id = any($3::text[]) or v.membre_id = any($2::uuid[]))
      union all
      select 'tg:' || x.telegram_id, 'membre:' || x.membre_id, 'exemption Live Club', true
        from public.cockpit_liveclub_exemptions x
        where x.membre_id is not null and (x.telegram_id = any($1::bigint[]) or x.membre_id = any($2::uuid[]))
      union all
      select 'tg:' || g.telegram_id, 'membre:' || c.membre_id, 'pseudo posé à la main = pseudo du groupe', true
        from public.cockpit_contact_manuel c
        join public.cockpit_telegram_membres g on lower(g.pseudo) = lower(ltrim(c.telegram, '@'))
        where c.telegram is not null and (g.telegram_id = any($1::bigint[]) or c.membre_id = any($2::uuid[]))
      union all
      select 'tg:' || g.telegram_id, 'membre:' || m.membre_id, 'pseudo déclaré au paiement = pseudo du groupe', false
        from public.cockpit_membres m
        join public.cockpit_telegram_membres g on lower(g.pseudo) = lower(ltrim(m.telegram, '@'))
        where m.telegram is not null and (g.telegram_id = any($1::bigint[]) or m.membre_id = any($2::uuid[]))
      union all
      select 'tg:' || n.telegram_id, 'membre:' || m.membre_id, 'pseudo déclaré au paiement = pseudo Telegram', false
        from public.cockpit_membres m
        join public.cockpit_telegram_noms n on lower(n.pseudo) = lower(ltrim(m.telegram, '@'))
        where m.telegram is not null and (n.telegram_id = any($1::bigint[]) or m.membre_id = any($2::uuid[]))
    ) l
    limit 500`, ids.telegram, ids.membres, ids.archives, u)
  return lignes.map((l) => ({ a: l.a, b: l.b, nature: l.nature, certain: l.certain === true }))
}

/** De quoi choisir entre plusieurs personnes. */
async function lireStats(tx: Tx, ids: { telegram: number[]; membres: string[]; archives: string[] }): Promise<StatsCandidats> {
  const [r] = await tx.$queryRawUnsafe<{ s: Record<string, Record<string, Ligne>> }[]>(`
    select json_build_object(
      'messages', coalesce((select json_object_agg(x.telegram_id::text, json_build_object('n', x.n, 'dernier', x.dernier, 'nom', x.nom, 'pseudo', x.pseudo))
        from (select telegram_id, count(*)::int as n, ${J("max(dit_le) at time zone 'Europe/Paris'")} as dernier,
                     (array_agg(nom_affiche order by dit_le desc) filter (where nom_affiche is not null))[1] as nom,
                     (array_agg(pseudo order by dit_le desc) filter (where pseudo is not null))[1] as pseudo
                from public.cockpit_telegram_messages where telegram_id = any($1::bigint[]) group by telegram_id) x), '{}'::json),
      'present', coalesce((select json_object_agg(g.telegram_id::text, g.present)
        from public.cockpit_telegram_membres g where g.telegram_id = any($1::bigint[])), '{}'::json),
      'noms', coalesce((select json_object_agg(n.telegram_id::text, json_build_object('nom', n.nom_affiche, 'pseudo', n.pseudo))
        from (select distinct on (telegram_id) telegram_id, nom_affiche, pseudo from public.cockpit_telegram_noms
               where telegram_id = any($1::bigint[]) order by telegram_id, dernier_vu desc, premier_vu desc) n), '{}'::json),
      'registre', coalesce((select json_object_agg(g.telegram_id::text, json_build_object('nom', g.nom_affiche, 'pseudo', g.pseudo))
        from public.cockpit_telegram_membres g where g.telegram_id = any($1::bigint[])), '{}'::json),
      'membres', coalesce((select json_object_agg(m.membre_id::text, json_build_object('nom', m.nom,
          'abonnement_en_cours', m.abonnement_en_cours, 'dernier_paiement', ${J('m.dernier_paiement')}))
        from public.cockpit_membres_etat m where m.membre_id = any($2::uuid[])), '{}'::json),
      'archive', coalesce((select json_object_agg(a.personne_id, json_build_object('nom', a.nom, 'messages', a.messages,
          'premier', ${J('a.premier')}, 'dernier', ${J('a.dernier')}, 'nature', a.nature))
        from public.cockpit_arch_personnes a where a.personne_id = any($3::text[])), '{}'::json)
    ) as s`, ids.telegram, ids.membres, ids.archives)
  const s = r?.s ?? {}
  const txt = (v: unknown) => (typeof v === 'string' ? v : null)
  const noms: StatsCandidats['noms'] = {}
  const messages: StatsCandidats['messages'] = {}
  for (const [k, v] of Object.entries(s.messages ?? {})) messages[k] = { n: Number(v.n) || 0, dernier: txt(v.dernier) }
  // Le nom : l'historique d'abord, puis le registre du groupe, puis le dernier message.
  for (const id of ids.telegram) {
    const k = String(id)
    const h = s.noms?.[k]
    const g = s.registre?.[k]
    const m = s.messages?.[k]
    noms[k] = {
      nom: txt(h?.nom) ?? txt(g?.nom) ?? txt(m?.nom),
      pseudo: txt(h?.pseudo) ?? txt(g?.pseudo) ?? txt(m?.pseudo),
    }
  }
  const present: StatsCandidats['present'] = {}
  for (const [k, v] of Object.entries(s.present ?? {})) present[k] = typeof v === 'boolean' ? v : null
  const membres: StatsCandidats['membres'] = {}
  for (const [k, v] of Object.entries(s.membres ?? {})) {
    membres[k] = {
      nom: txt(v.nom),
      abonnement_en_cours: typeof v.abonnement_en_cours === 'boolean' ? v.abonnement_en_cours : null,
      dernier_paiement: txt(v.dernier_paiement),
    }
  }
  const archive: StatsCandidats['archive'] = {}
  for (const [k, v] of Object.entries(s.archive ?? {})) {
    archive[k] = {
      nom: txt(v.nom), messages: typeof v.messages === 'number' ? v.messages : null,
      premier: txt(v.premier), dernier: txt(v.dernier), nature: txt(v.nature),
    }
  }
  return { messages, present, noms, membres, archive }
}

/** Tout ce qu'on sait d'UNE personne, en une requete (plus les messages a part). */
async function lireFiche(tx: Tx, g: Groupe): Promise<DonneesFiche> {
  const ids = idsDuGroupe(g)
  const liste = (from: string, objet: string, ordre: string) =>
    `(select coalesce(json_agg(json_build_object(${objet}) order by ${ordre}), '[]'::json) from ${from})`
  const [r] = await tx.$queryRawUnsafe<{ f: Record<string, unknown> }[]>(`
    with em as (select distinct lower(email) as email from public.cockpit_membre_emails where membre_id = any($2::uuid[]))
    select json_strip_nulls(json_build_object(
      'noms', ${liste(
        `(select * from public.cockpit_telegram_noms where telegram_id = any($1::bigint[]) order by dernier_vu desc limit 60) n`,
        `'telegram_id', n.telegram_id, 'pseudo', n.pseudo, 'nom_affiche', n.nom_affiche, 'premier_vu', ${H('n.premier_vu')},
         'dernier_vu', ${H('n.dernier_vu')}, 'source', n.source`,
        'n.premier_vu')},
      'registre', ${liste(
        `public.cockpit_telegram_membres g where g.telegram_id = any($1::bigint[])`,
        `'compte', 'u' || g.telegram_id, 'nom', g.nom_affiche, 'pseudo', g.pseudo, 'present', g.present,
         'entre_le', ${H('g.entre_le')}, 'sorti_le', ${H('g.sorti_le')}, 'source', g.source, 'par_qui', g.par_qui,
         'statut_tg', g.statut_tg, 'maj_le', ${H('g.maj_le')}`,
        'g.telegram_id')},
      'membres', ${liste(
        `public.cockpit_membres_etat m where m.membre_id = any($2::uuid[])`,
        `'membre_id', m.membre_id, 'nom', m.nom, 'date_entree', ${J('m.date_entree')}, 'tier_skool', m.tier_skool,
         'source_entree', m.source_entree, 'total_paye', m.total_paye, 'nb_paiements', m.nb_paiements,
         'dernier_paiement', ${J('m.dernier_paiement')}, 'abonnement_en_cours', m.abonnement_en_cours,
         'a_achete_ponctuel', m.a_achete_ponctuel, 'fin_periode', ${J('m.fin_periode')}, 'origine_statut', m.origine_statut,
         'pseudo_declare_au_paiement', m.telegram`,
        'm.date_entree')},
      'emails', ${liste(
        `(select * from public.cockpit_membre_emails where membre_id = any($2::uuid[]) order by principal desc nulls last, email limit 8) e`,
        `'email', e.email, 'principal', e.principal, 'verifie', e.verifie`,
        'e.principal desc nulls last, e.email')},
      'archive', ${liste(
        `public.cockpit_arch_personnes a where a.personne_id = any($3::text[])`,
        `'personne_id', a.personne_id, 'nom', a.nom, 'alias', left(a.alias, 200), 'nature', a.nature, 'palier', a.palier,
         'connu_par', a.connu_par, 'messages', a.messages, 'premier', ${J('a.premier')}, 'dernier', ${J('a.dernier')},
         'a_parle_en_prive', a.a_parle_en_prive, 'avatar', a.avatar, 'pseudo', a.telegram`,
        'a.messages desc nulls last')},
      'abonnements', ${liste(
        `(select * from public.cockpit_abonnements where membre_id = any($2::uuid[]) order by debut desc nulls last limit 8) a`,
        `'abonnement_id', a.abonnement_id, 'compte', a.compte, 'offre_id', a.offre_id, 'produit', a.produit, 'statut', a.statut,
         'montant', a.montant, 'periodicite', a.periodicite, 'debut', ${J('a.debut')}, 'fin_periode', ${J('a.fin_periode')},
         'annule_le', ${J('a.annule_le')}, 'annule_a_la_fin', a.annule_a_la_fin, 'pause_jusquau', ${J('a.pause_jusquau')},
         'paye_jusquau_avant_pause', case when a.pause_jusquau is not null then (
            select gp.details ->> 'paye_jusquau' from public.cockpit_liveclub_gestes gp
            where gp.geste = 'pause' and gp.abonnement_id = replace(a.abonnement_id, 'stripe:', '')
            order by gp.fait_le desc limit 1) end,
         'impaye', a.impaye, 'nb_tentatives', a.nb_tentatives, 'prochaine_tentative', ${J('a.prochaine_tentative')}`,
        'a.debut desc nulls last')},
      'exemptions', ${liste(
        `(select * from public.cockpit_liveclub_exemptions where telegram_id = any($1::bigint[]) or membre_id = any($2::uuid[]) order by pose_le desc limit 6) x`,
        `'compte', 'u' || x.telegram_id, 'motif', x.motif, 'jusquau', ${J('x.jusquau')}, 'note', left(x.note, 150),
         'pose_le', ${H('x.pose_le')}, 'retire_le', ${H('x.retire_le')}`,
        'x.pose_le desc')},
      'acces_broker', ${liste(
        `(select * from public.cockpit_liveclub_acces where telegram_id = any($1::bigint[]) or lower(email) in (select email from em) order by pose_le desc limit 4) a`,
        `'motif', a.motif, 'source', a.source, 'debut', ${J('a.debut')}, 'jusquau', ${J('a.jusquau')},
         'invite_envoyee_le', ${H('a.invite_envoyee_le')}, 'compte', 'u' || a.telegram_id, 'sorti_le', ${H('a.sorti_le')},
         'retire_le', ${H('a.retire_le')}, 'note', left(a.note, 150)`,
        'a.pose_le desc')},
      'tarifs_reserves', ${liste(
        `(select * from public.cockpit_liveclub_tarifs_reserves where telegram_id = any($1::bigint[]) or lower(email) in (select email from em) order by cree_le desc limit 4) t`,
        `'qui', t.qui, 'montant', t.montant, 'devise', t.devise, 'recurrence', t.recurrence, 'cree_le', ${H('t.cree_le')},
         'paye_le', ${H('t.paye_le')}, 'retire_le', ${H('t.retire_le')}, 'note', left(t.note, 150)`,
        't.cree_le desc')},
      'acces_manuel', ${liste(
        `public.cockpit_acces_manuel a where a.membre_id = any($2::uuid[])`,
        `'acces_jusquau', ${J('a.acces_jusquau')}, 'note', left(a.note, 150), 'pose_le', ${H('a.pose_le')}`,
        'a.pose_le desc')},
      'etm', ${liste(
        `(select * from public.cockpit_statut_etm where membre_id = any($2::uuid[]) order by pose_le desc limit 3) s`,
        `'pose_le', ${H('s.pose_le')}, 'retire_le', ${H('s.retire_le')}, 'note', left(s.note, 150)`,
        's.pose_le desc')},
      'rattachements', ${liste(
        `(select * from public.cockpit_liveclub_rattachements where telegram_id = any($1::bigint[]) or membre_id = any($2::uuid[])
            or lower(email) in (select email from em) order by lie_le desc limit 8) r`,
        `'compte', 'u' || r.telegram_id, 'membre_id', r.membre_id, 'source', r.source, 'stripe', r.compte,
         'lie_le', ${H('r.lie_le')}, 'retire_le', ${H('r.retire_le')},
         'retire_raison', to_jsonb(r) ->> 'retire_raison',
         'remplace_par', case when (to_jsonb(r) ->> 'remplace_par') is not null then 'u' || (to_jsonb(r) ->> 'remplace_par') end`,
        'r.lie_le desc')},
      'gestes_total', (select count(*)::int from public.cockpit_liveclub_gestes
        where telegram_id = any($1::bigint[]) or membre_id = any($2::uuid[])),
      'gestes', ${liste(
        `(select * from public.cockpit_liveclub_gestes where telegram_id = any($1::bigint[]) or membre_id = any($2::uuid[]) order by fait_le desc limit 12) x`,
        `'le', ${H('x.fait_le')}, 'geste', x.geste, 'resultat', x.resultat, 'regle', x.regle,
         'par', split_part(x.acteur, ':', 1), 'details', left(x.details::text, 160)`,
        'x.fait_le desc')},
      'vies', ${liste(
        `(select * from public.cockpit_arch_vies where personne_id = any($3::text[]) order by dit_le desc nulls last limit 12) v`,
        `'rubrique', v.rubrique, 'qualificatif', v.qualificatif, 'dit_le', ${J('v.dit_le')}, 'extrait', left(v.extrait, 600)`,
        'v.dit_le desc nulls last')},
      'themes', ${liste(
        `(select t.libelle, t.famille, sum(d.mentions)::int as mentions from public.cockpit_arch_dits d
           join public.cockpit_arch_themes t using (theme_id)
           where d.personne_id = any($3::text[]) group by t.libelle, t.famille order by 3 desc limit 10) t`,
        `'theme', t.libelle, 'famille', t.famille, 'mentions', t.mentions`,
        't.mentions desc')},
      'paroles', ${liste(
        `(select * from (select p.*, row_number() over (partition by p.rang order by
              case when p.rang = 'premier' then p.dit_le end asc,
              case when p.rang = 'dernier' then p.dit_le end desc,
              case when p.rang = 'long' then length(p.texte) end desc) as r
            from public.cockpit_arch_paroles p
            where p.personne_id = any($3::text[]) and p.rang in ('premier', 'long', 'dernier')) q
          where (q.rang = 'premier' and q.r <= 2) or (q.rang = 'long' and q.r <= 4) or (q.rang = 'dernier' and q.r <= 2)) p`,
        `'rang', p.rang, 'salon', p.salon, 'dit_le', ${J('p.dit_le')}, 'texte', left(p.texte, 800)`,
        'p.dit_le')},
      'notes', ${liste(
        `(select * from (
            select 'archive' as sur, rubrique, left(texte, 600) as texte, ecrit_le, traite_le
              from public.cockpit_arch_notes where personne_id = any($3::text[])
            union all
            select 'membre', rubrique, left(texte, 600), ecrit_le, traite_le
              from public.cockpit_membre_notes where membre_id = any($2::uuid[])
          ) u order by ecrit_le desc limit 8) n`,
        `'sur', n.sur, 'rubrique', n.rubrique, 'texte', n.texte, 'ecrit_le', ${J("n.ecrit_le at time zone 'Europe/Paris'")},
         'traite_le', ${J("n.traite_le at time zone 'Europe/Paris'")}`,
        'n.ecrit_le desc')},
      'messages_total', (select count(*)::int from public.cockpit_telegram_messages where telegram_id = any($1::bigint[])),
      'par_groupe', ${liste(
        `(select groupe, count(*)::int as n, count(texte)::int as t, min(dit_le) as p, max(dit_le) as d
            from public.cockpit_telegram_messages where telegram_id = any($1::bigint[]) group by chat_id, groupe) x`,
        `'groupe', x.groupe, 'messages', x.n, 'avec_texte', x.t, 'premier', ${J("x.p at time zone 'Europe/Paris'")},
         'dernier', ${J("x.d at time zone 'Europe/Paris'")}`,
        'x.n desc')},
      'par_sujet', ${liste(
        `(select groupe, sujet, count(*)::int as n, max(dit_le) as d
            from public.cockpit_telegram_messages where telegram_id = any($1::bigint[])
            group by groupe, sujet order by 3 desc limit 12) x`,
        `'groupe', x.groupe, 'sujet', x.sujet, 'messages', x.n, 'dernier', ${J("x.d at time zone 'Europe/Paris'")}`,
        'x.n desc')},
      'support', ${liste(
        `(select * from public."SupportThread"
            where ("telegramId" = any($1::bigint[]) or "membreId" = any($2::uuid[]::text[]))
              and jsonb_typeof(messages) = 'array'
            order by "updatedAt" desc limit 3) s`,
        `'fil', s.id, 'app', s.app, 'nb_messages', jsonb_array_length(s.messages),
         'humain_demande_le', ${HU('s."escalatedAt"')}, 'cree_le', ${HU('s."createdAt"')}, 'maj_le', ${HU('s."updatedAt"')},
         'derniers', (select coalesce(json_agg(json_build_object(
              'role', e.m ->> 'role',
              'le', case when (e.m ->> 'at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then ${H("(e.m ->> 'at')::timestamptz")} end,
              'texte', left(e.m ->> 'content', 600)) order by e.o), '[]'::json)
            from jsonb_array_elements(s.messages) with ordinality as e(m, o)
            where e.o > jsonb_array_length(s.messages) - 10)`,
        's."updatedAt" desc')}
    )) as f`, ids.telegram, ids.membres, ids.archives)

  const [m] = await tx.$queryRawUnsafe<{ l: unknown }[]>(`
    select coalesce(json_agg(json_strip_nulls(json_build_object(
      'chat_id', m.chat_id, 'message_id', m.message_id, 'groupe', m.groupe, 'sujet', m.sujet,
      'le', ${H('m.dit_le')}, 't', (extract(epoch from m.dit_le) * 1000)::bigint,
      'texte', left(m.texte, 1500), 'longueur', coalesce(length(m.texte), 0),
      'a_media', m.a_media, 'type_media', m.type_media))), '[]'::json) as l
    from (
      (select * from public.cockpit_telegram_messages where telegram_id = any($1::bigint[])
        order by dit_le desc, message_id desc limit ${MAX_MESSAGES_LUS})
      union
      (select * from public.cockpit_telegram_messages where telegram_id = any($1::bigint[])
        order by dit_le asc, message_id asc limit 2)
    ) m`, ids.telegram)

  // Les effacements a la demande (migration 20261015200000) : lus seulement si
  // la table existe, sinon une erreur annulerait toute la transaction.
  let oublis: Ligne[] = []
  if (ids.telegram.length > 0) {
    const [t] = await tx.$queryRawUnsafe<{ ok: boolean }[]>(
      `select to_regclass('public.cockpit_telegram_oublis') is not null as ok`)
    if (t?.ok) {
      const [o] = await tx.$queryRawUnsafe<{ l: unknown }[]>(`
        select coalesce(json_agg(json_build_object('compte', 'u' || telegram_id, 'oublie_le', ${H('oublie_le')})
          order by oublie_le), '[]'::json) as l
        from public.cockpit_telegram_oublis where telegram_id = any($1::bigint[])`, ids.telegram)
      oublis = Array.isArray(o?.l) ? (o.l as Ligne[]) : []
    }
  }

  const f = r?.f ?? {}
  const l = (k: string): Ligne[] => (Array.isArray(f[k]) ? (f[k] as Ligne[]) : [])
  const noms: NomLu[] = l('noms').map((n) => ({
    telegram_id: Number(n.telegram_id),
    pseudo: typeof n.pseudo === 'string' ? n.pseudo : null,
    nom_affiche: typeof n.nom_affiche === 'string' ? n.nom_affiche : null,
    premier_vu: String(n.premier_vu ?? ''),
    dernier_vu: String(n.dernier_vu ?? ''),
    source: String(n.source ?? ''),
  }))
  const support: FilSupport[] = l('support').map((s) => ({
    fil: String(s.fil ?? ''),
    app: typeof s.app === 'string' ? s.app : null,
    nb_messages: Number(s.nb_messages) || 0,
    humain_demande_le: typeof s.humain_demande_le === 'string' ? s.humain_demande_le : null,
    cree_le: typeof s.cree_le === 'string' ? s.cree_le : null,
    maj_le: typeof s.maj_le === 'string' ? s.maj_le : null,
    derniers: (Array.isArray(s.derniers) ? (s.derniers as Ligne[]) : []).map((x) => ({
      role: typeof x.role === 'string' ? x.role : null,
      le: typeof x.le === 'string' ? x.le : null,
      texte: typeof x.texte === 'string' ? x.texte : null,
    })),
  }))
  return {
    trouvePar: phrasesTrouvePar(g.touches),
    telegram: ids.telegram,
    liens: g.certains.map(phraseLien),
    liensProbables: g.probables.slice(0, 5).map(phraseLien),
    identite: { noms, registre: l('registre'), membres: l('membres'), emails: l('emails'), archive: l('archive') },
    liveClub: {
      abonnements: l('abonnements'), exemptions: l('exemptions'), acces_broker: l('acces_broker'),
      tarifs_reserves: l('tarifs_reserves'), acces_manuel: l('acces_manuel'), etm: l('etm'),
      rattachements: l('rattachements'), gestes_total: Number(f.gestes_total) || 0, gestes: l('gestes'),
    },
    archive: { vies: l('vies'), themes: l('themes'), paroles: l('paroles') },
    notes: l('notes'),
    messages: {
      total: Number(f.messages_total) || 0,
      par_groupe: l('par_groupe'),
      par_sujet: l('par_sujet'),
      liste: lireMessagesJson(m?.l),
    },
    support,
    oublis,
  }
}

/** Les noeuds touches par « qui ». */
async function trouver(tx: Tx, qui: QuiLu): Promise<{ touches: Touche[]; indices: string[] }> {
  switch (qui.genre) {
    case 'telegram':
      return { touches: [{ noeud: `tg:${qui.id}`, champ: 'numéro Telegram demandé', valeur: `u${qui.id}`, exact: true }], indices: [] }
    case 'membre':
      return { touches: [{ noeud: `membre:${qui.id}`, champ: 'fiche membre demandée', valeur: qui.id, exact: true }], indices: [] }
    case 'archive':
      return { touches: [{ noeud: `archive:${qui.id}`, champ: 'fiche d\'archive demandée', valeur: qui.id, exact: true }], indices: [] }
    case 'email':
      return chercherEmail(tx, qui.email)
    case 'texte':
      return { touches: await chercherTexte(tx, qui.motif, qui.exact), indices: [] }
  }
}

/** Fiche, candidats ou rien : la reponse de l'outil, en JSON borne. */
export async function construireFiche(tx: Tx, qui: QuiLu, budget = BUDGET_FICHE): Promise<string> {
  const libelleQui = qui.genre === 'texte' ? qui.brut : qui.genre === 'email' ? qui.email : qui.genre === 'telegram' ? `u${qui.id}` : qui.id
  const { touches, indices } = await trouver(tx, qui)
  if (touches.length === 0) return reponseAucun(libelleQui, indices)

  // Elargir par les liens CERTAINS (un compte -> sa fiche -> son autre compte).
  const connus = new Set(touches.map((t) => t.noeud))
  let liens: LienLu[] = []
  for (let tour = 0; tour < TOURS_LIENS; tour++) {
    liens = await lireLiens(tx, idsDuGroupe({ noeuds: [...connus] }))
    const avant = connus.size
    for (const lien of liens) if (lien.certain) { connus.add(lien.a); connus.add(lien.b) }
    if (connus.size === avant) break
  }
  const groupes = grouper(touches, liens)
  if (groupes.length === 0) return reponseAucun(libelleQui, indices)
  if (groupes.length > 1) {
    const tous = idsDuGroupe({ noeuds: groupes.flatMap((g) => g.noeuds) })
    return reponseCandidats(libelleQui, groupes, await lireStats(tx, tous))
  }
  const donnees = await lireFiche(tx, groupes[0])
  if (ficheVide(donnees)) return reponseAucun(libelleQui, indices)
  return fichePourAgent(donnees, budget)
}

/**
 * L'outil fiche_personne de l'agent du Cockpit. Ne leve jamais : une erreur
 * revient au modele en JSON, sans donnee.
 */
export async function fichePersonnePourAgent(entree: unknown): Promise<string> {
  const qui = lireQui(entree)
  if ('erreur' in qui) return JSON.stringify({ statut: 'erreur', erreur: qui.erreur })
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('set transaction read only')
      await tx.$executeRawUnsafe(`set local statement_timeout = '8000ms'`)
      return construireFiche(tx, qui)
    }, { maxWait: 5000, timeout: 25000 })
  } catch (err) {
    const raison = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() ?? '' : String(err)
    console.error(`[cockpit/fiche] lecture impossible : ${raison.slice(0, 200)}`)
    return JSON.stringify({
      statut: 'erreur',
      erreur: `Lecture de la fiche impossible (${raison.slice(0, 160)}) : réessaie, ou passe par requete_sql.`,
    })
  }
}
