// LA CLOCHE DE L'ACADEMIE (13/11/2026, FEATURE, branche academie-cloche-recherche ;
// brief D:\7_Agents\briefs\2026-11-13-cloche-et-recherche.md).
//
// Une cloche dans le bandeau du haut du site (et dans la barre du bas au telephone),
// un compteur et un panneau « tout marquer lu ». Deux sortes de notifications pour
// lundi 16/11 :
// - une nouvelle annonce (billet ecrit dans le cockpit) ;
// - une reponse a une de MES questions : dans le salon Questions (un message qui
//   repond au mien) et sous une lecon (ma question a recu sa reponse).
// Aucun email ni push : la cloche seulement (preferences par type et par canal
// ecartees par Brice, inventaire C8).
//
// SANS TABLE NI MIGRATION. Les notifications se CALCULENT a partir de ce qui existe,
// sur JOURS_CLOCHE jours :
// - annonces : academie_billets (lecon et module publies, comme le billet du jour) ;
// - salon : aok_chat_messages (reponse_a = un de mes messages, auteur autre que moi,
//   message non masque), lu par aok_chat_vue comme le salon le montre ;
// - lecons : academie_questions_lecons (ma question, publiee ou privee, avec sa reponse).
// Ce qui est LU :
// - une annonce : academie_billets_vus, la table de la page Annonces et du pop-up
//   (lue ici = lue la-bas, et l'inverse) ;
// - une reponse : une marque dans les metadonnees du compte Supabase
//   (user_metadata.aok_cloche = { lu_le, lues }), comme la marque d'accueil du site
//   (aok_accueil_vu_le, 13/11). « Tout marquer lu » pose lu_le (tout ce qui est plus
//   ancien est lu) ; un clic ajoute la cle courte de la reponse a lues (MAX_LUES au
//   plus, seulement des reponses encore dans la fenetre et plus recentes que lu_le).
//   Elle suit le compte sur tous ses appareils et ne dit rien d'autre.
//
// CE FICHIER N'IMPORTE RIEN, expres (comme annonces.ts) :
// scripts/verifier-cloche-recherche.mjs et scripts/essayer-cloche-recherche.mjs
// l'importent tel quel sous Node 22. Les messages du salon sont du texte de membre :
// ils sortent ici en extrait de texte brut, jamais interpretes, jamais dans un journal.

/** La fenetre de la cloche, en jours (comme le « non lu » des annonces). */
export const JOURS_CLOCHE = 30
/** Notifications rendues au plus (les plus recentes). */
export const MAX_NOTIFICATIONS = 30
/** Lignes lues au plus par source. */
export const MAX_PAR_SOURCE = 30
/** Cles courtes gardees au plus dans la marque du compte. */
export const MAX_LUES = 40
/** Cles au plus dans un POST { lues }. */
export const MAX_CLES = 50
/** Longueur d'un extrait (points de code). */
export const MAX_EXTRAIT = 140
/** La cle des metadonnees du compte Supabase. */
export const CLE_META = 'aok_cloche'

export type TypeNotif = 'annonce' | 'reponse_salon' | 'reponse_lecon'

/**
 * Ce que recoit le site, rien d'autre : ni identifiant de compte, ni email.
 * cle : 'a:<id du billet>', 'c:<id du message qui repond>', 'q:<id de la question>'.
 * titre : le titre de l'annonce ou de la lecon (null pour le salon).
 * qui : qui a repondu, tel que le salon ou la lecon l'affiche (null pour une annonce).
 */
export type Notification = {
  cle: string
  type: TypeNotif
  le: string
  titre: string | null
  extrait: string | null
  qui: string | null
  lien: string
  lue: boolean
}

export type MarqueCloche = { lu_le: string | null; lues: string[] }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const CLE_RE = new RegExp(`^([acq]):(${UUID})$`)
const COURTE_RE = /^[cq][0-9a-f]{12}$/

const iso = (d: unknown): string | null => {
  const t = d instanceof Date ? d.getTime() : typeof d === 'string' ? Date.parse(d) : NaN
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

// ---------------------------------------------------------------------------
// La marque du compte
// ---------------------------------------------------------------------------

/** La marque lue dans user_metadata[CLE_META] ; tout ce qui n'a pas la bonne forme est ignore. */
export function lireMarque(brut: unknown): MarqueCloche {
  const o = (brut && typeof brut === 'object' && !Array.isArray(brut) ? brut : {}) as Record<string, unknown>
  const lu_le = typeof o.lu_le === 'string' ? iso(o.lu_le) : null
  const lues = Array.isArray(o.lues)
    ? [...new Set(o.lues.filter((x): x is string => typeof x === 'string' && COURTE_RE.test(x)))].slice(0, MAX_LUES)
    : []
  return { lu_le, lues }
}

/** 'c:1a2b3c4d-5e6f-...' -> 'c1a2b3c4d5e6f' (13 caracteres : la marque reste petite dans le jeton du compte). */
export function cleCourte(cle: string): string | null {
  const m = CLE_RE.exec(cle)
  if (!m || m[1] === 'a') return null
  return `${m[1]}${m[2].replace(/-/g, '').slice(0, 12)}`
}

/** Une reponse est lue si elle est plus ancienne que « tout marquer lu », ou si on a cliqué dessus. */
export function reponseLue(cle: string, le: string, marque: MarqueCloche): boolean {
  if (marque.lu_le && le <= marque.lu_le) return true
  const c = cleCourte(cle)
  return c !== null && marque.lues.includes(c)
}

// ---------------------------------------------------------------------------
// Les lignes de la base en notifications
// ---------------------------------------------------------------------------

/** Sur une ligne, MAX_EXTRAIT points de code au plus, coupe sur un mot, « … » si coupe. */
export function extraitDe(texte: string | null | undefined, max = MAX_EXTRAIT): string | null {
  const ligne = (texte ?? '').replace(/\s+/g, ' ').trim()
  if (!ligne) return null
  const cps = Array.from(ligne)
  if (cps.length <= max) return ligne
  const coupe = cps.slice(0, max).join('')
  const espace = coupe.lastIndexOf(' ')
  return `${(espace > max * 0.6 ? coupe.slice(0, espace) : coupe).replace(/[\s,;:.!?-]+$/, '')}…`
}

export type LigneAnnonceCloche = { id: string; publie_le: Date | string; titre: string; vue: boolean }
export type LigneReponseSalon = { id: string; cree_le: Date | string; texte: string; qui: string }
export type LigneReponseLecon = {
  id: string; traitee_le: Date | string; signature: string | null; reponse: string | null
  lecon_titre: string; lecon_slug: string; module_slug: string
}

export function notifAnnonce(l: LigneAnnonceCloche): Notification | null {
  const le = iso(l.publie_le)
  if (!le || !new RegExp(`^${UUID}$`).test(l.id)) return null
  return {
    cle: `a:${l.id}`, type: 'annonce', le, titre: l.titre, extrait: null, qui: null,
    lien: `/academie/annonces#annonce-${l.id}`, lue: l.vue === true,
  }
}

export function notifSalon(l: LigneReponseSalon, marque: MarqueCloche): Notification | null {
  const le = iso(l.cree_le)
  if (!le || !new RegExp(`^${UUID}$`).test(l.id)) return null
  const cle = `c:${l.id}`
  return {
    cle, type: 'reponse_salon', le, titre: null, extrait: extraitDe(l.texte), qui: l.qui.slice(0, 80),
    lien: `/academie/chat#m-${l.id}`, lue: reponseLue(cle, le, marque),
  }
}

export function notifLecon(l: LigneReponseLecon, marque: MarqueCloche): Notification | null {
  const le = iso(l.traitee_le)
  if (!le || !new RegExp(`^${UUID}$`).test(l.id)) return null
  const cle = `q:${l.id}`
  return {
    cle, type: 'reponse_lecon', le, titre: l.lecon_titre, extrait: extraitDe(l.reponse),
    qui: l.signature?.trim().slice(0, 60) || "L'équipe",
    lien: `/academie/${l.module_slug}/${l.lecon_slug}#questions`, lue: reponseLue(cle, le, marque),
  }
}

/** Les trois sources en une liste, la plus recente d'abord, MAX_NOTIFICATIONS au plus, et le compteur. */
export function assembler(listes: (Notification | null)[][]): { notifications: Notification[]; non_lues: number } {
  const toutes = listes.flat().filter((n): n is Notification => n !== null)
    .sort((a, b) => b.le.localeCompare(a.le) || a.cle.localeCompare(b.cle))
    .slice(0, MAX_NOTIFICATIONS)
  return { notifications: toutes, non_lues: toutes.filter(n => !n.lue).length }
}

// ---------------------------------------------------------------------------
// Le corps du POST, et la marque qui en sort
// ---------------------------------------------------------------------------

export type DemandeCloche = { tout: true } | { lues: string[] }

/**
 * POST { tout: true } : tout marquer lu. POST { lues: [cle, ...] } : ces notifications
 * (cles rendues par le GET, MAX_CLES au plus). null = refus.
 */
export function lireDemandeCloche(corps: unknown): DemandeCloche | null {
  const c = (corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : {}) as Record<string, unknown>
  if (c.tout === true) return { tout: true }
  if (!Array.isArray(c.lues) || c.lues.length === 0 || c.lues.length > MAX_CLES) return null
  const cles = new Set<string>()
  for (const v of c.lues) {
    const k = typeof v === 'string' ? v.trim().toLowerCase() : ''
    if (!CLE_RE.test(k)) return null
    cles.add(k)
  }
  return { lues: [...cles] }
}

/** Les billets d'une demande { lues } (a marquer dans academie_billets_vus). */
export function annoncesDe(d: DemandeCloche): string[] {
  return 'lues' in d ? d.lues.filter(k => k.startsWith('a:')).map(k => k.slice(2)) : []
}

/** La demande touche-t-elle la marque du compte (reponses, ou tout marquer lu) ? */
export const toucheLaMarque = (d: DemandeCloche) => 'tout' in d || d.lues.some(k => !k.startsWith('a:'))

/**
 * La marque apres la demande. tout : lu_le = maintenant, plus aucune cle. lues : les cles
 * courtes des reponses cliquees, plus les anciennes, gardees seulement si la reponse est
 * encore dans la fenetre et pas deja couverte par lu_le (courantes = les reponses du GET).
 */
export function nouvelleMarque(marque: MarqueCloche, d: DemandeCloche, courantes: Notification[], maintenant: string): MarqueCloche {
  if ('tout' in d) return { lu_le: maintenant, lues: [] }
  const vivantes = new Set(
    courantes
      .filter(n => n.type !== 'annonce' && !(marque.lu_le && n.le <= marque.lu_le))
      .map(n => cleCourte(n.cle))
      .filter((k): k is string => k !== null),
  )
  const nouvelles = d.lues.map(cleCourte).filter((k): k is string => k !== null)
  const lues = [...new Set([...nouvelles, ...marque.lues])].filter(k => vivantes.has(k)).slice(0, MAX_LUES)
  return { lu_le: marque.lu_le, lues }
}

// ---------------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------------

export type ClientSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

/**
 * $1 = compte, $2 = jours, $3 = plafond. Les billets du cockpit des $2 derniers jours (lecon et
 * module publies, heure passee, pas retires), vus ou non. Avant comme apres la migration du 13/11 :
 * une annonce reprise de Skool vit dans un module d'archive, jamais publie, et n'y entre pas.
 */
export const SQL_ANNONCES_CLOCHE = `
select b.id::text as id, b.publie_le, l.titre,
       exists (select 1 from public.academie_billets_vus v where v.billet_id = b.id and v.user_id = $1::uuid) as vue
  from public.academie_billets b
  join public.academie_lecons l on l.id = b.lecon_id
  join public.academie_modules m on m.id = l.module_id
 where b.retire_le is null and b.publie_le <= now()
   and b.publie_le > now() - make_interval(days => $2::int)
   and l.statut = 'publie' and m.statut = 'publie'
 order by b.publie_le desc
 limit $3::int
`

/**
 * $1 = compte, $2 = niveau du lecteur ('programme' | 'gratuit', regle des noms du salon),
 * $3 = jours, $4 = plafond. Les messages qui repondent a un message du compte, ecrits par un
 * autre, non masques, des $3 derniers jours ; chacun tel que le salon le montre (aok_chat_vue).
 */
export const SQL_REPONSES_SALON = `
select r.id::text as id, r.cree_le, public.aok_chat_vue(r.id, $2) as vue
  from public.aok_chat_messages q
  join public.aok_chat_messages r on r.reponse_a = q.id
 where q.user_id = $1::uuid
   and r.user_id <> $1::uuid
   and r.masque_le is null
   and r.cree_le > now() - make_interval(days => $3::int)
 order by r.cree_le desc, r.id desc
 limit $4::int
`

/** Le statut du compte dans l'annuaire (le niveau des noms du salon). */
export const SQL_ACCES_ANNUAIRE = `select public.aok_annuaire_acces($1::uuid) as acces`

/**
 * $1 = compte, $2 = jours, $3 = plafond. Les questions du compte sous une lecon qui ont recu
 * leur reponse (publiee ou privee) dans les $2 derniers jours, lecon et module publies.
 */
export const SQL_REPONSES_LECONS = `
select q.id::text as id, q.traitee_le, q.signature, q.reponse,
       l.titre as lecon_titre, l.slug as lecon_slug, m.slug as module_slug
  from public.academie_questions_lecons q
  join public.academie_lecons l on l.id = q.lecon_id
  join public.academie_modules m on m.id = l.module_id
 where q.user_id = $1::uuid
   and q.statut in ('publiee', 'privee')
   and q.reponse is not null and q.traitee_le is not null
   and q.traitee_le > now() - make_interval(days => $2::int)
   and l.statut = 'publie' and m.statut = 'publie'
 order by q.traitee_le desc, q.id desc
 limit $3::int
`

/**
 * « Tout marquer lu », cote annonces : $1 = compte, $2 = jours. Les billets de la fenetre pas
 * encore vus sont notes vus (comme la page Annonces). Rend le nombre de lignes ajoutees.
 */
export const SQL_ANNONCES_TOUTES_VUES = `
insert into public.academie_billets_vus (billet_id, user_id)
select b.id, $1::uuid
  from public.academie_billets b
  join public.academie_lecons l on l.id = b.lecon_id
  join public.academie_modules m on m.id = l.module_id
 where b.retire_le is null and b.publie_le <= now()
   and b.publie_le > now() - make_interval(days => $2::int)
   and l.statut = 'publie' and m.statut = 'publie'
on conflict (billet_id, user_id) do nothing
`
