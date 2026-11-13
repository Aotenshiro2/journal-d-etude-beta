// LES @HANDLES DES RESEAUX (13/11/2026) : le serveur du lot de Tab et sa
// lecture. Regles pures : src/lib/tab/handles-pur.ts. Table
// cockpit_handles_sociaux (migration 20261113235500 du workspace), ecrite ICI
// seulement (role postgres), lue par l'equipe du cockpit (is_cockpit_member()).
// INTERNE : aucune route de l'espace membre ni du site n'importe ce fichier.
//
// POST /api/tab/v1/handles { lignes: [...], a_blanc?: true } (cles tab et
// tache) : chaque ligne lisible est rapprochee (« qui » -> fiche, personne du
// fonds, numero, equipe), puis ecrite sous verrou dans UNE transaction.
// a_blanc = tout est calcule et rendu, puis la transaction est annulee : rien
// n'est ecrit. GET /api/tab/v1/handles : la liste (statut, plateforme, membre).
//
// Jamais d'email : ni dans le lot (refuse), ni dans la reponse (prenom et nom
// de la fiche, nom du fonds), ni dans le journal d'acces (masquerEmails).

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { Ctx, Sortie } from '@/lib/tab/lectures'
import { paginer } from '@/lib/tab/pur'
import {
  decider, libelleIdentite, lireLot, NATURES_EQUIPE, personneEquipe, STATUTS,
  type Decision, type EtatHandle, type Identite, type LigneLot, type LigneRefusee, type Lot, type Qui, type Resolution, type Statut,
} from '@/lib/tab/handles-pur'

type Tx = Prisma.TransactionClient

async function q<T = Record<string, unknown>>(tx: Tx, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await tx.$queryRawUnsafe<T[]>(sql, ...params)
  return JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))) as T[]
}

function tableAbsente(err: unknown): boolean {
  return /42P01|does not exist|n'existe pas/i.test(err instanceof Error ? err.message : String(err))
}

type Noms = { fiche: string | null; personne: string | null }

/** Le nom d'une fiche du cockpit : nom complet (« Alex Auger »), sinon prenom et nom. Jamais l'email. */
const NOM_FICHE = (t: string) => `nullif(trim(case when coalesce(${t}nom, '') ilike coalesce(${t}prenom, '') || '%' then coalesce(${t}nom, '')
  else concat_ws(' ', ${t}prenom, ${t}nom) end), '')`
type Rapproche = { resolution: Resolution; noms: Noms } | { refus: string }

const SANS_PLAFOND: Statut = 'sur'
const identite = (i: Partial<Identite>): Identite => ({ membreId: null, personneId: null, numeroMembre: null, equipe: null, ...i })

/**
 * La fiche d'une personne du fonds, seulement sur un lien CERTAIN : pose a la
 * main (cockpit_membre_fonds_manuel) ou marque certain dans le fonds. Un lien
 * par le nom (probable) n'est jamais une preuve. Une seule fiche, sinon aucune.
 */
async function ficheCertaine(tx: Tx, personneId: string): Promise<string | null> {
  const r = await q<{ membre_id: string }>(tx, `
    select membre_id::text as membre_id from public.cockpit_membre_fonds_manuel where personne_id = $1 and membre_id is not null
    union
    select membre_id::text from public.cockpit_arch_personnes where personne_id = $1 and membre_confiance = 'certain' and membre_id is not null`, personneId)
  return r.length === 1 ? r[0].membre_id : null
}

async function nomFiche(tx: Tx, membreId: string): Promise<string | null> {
  const r = await q<{ nom: string | null }>(tx, `
    select ${NOM_FICHE('')} as nom from public.cockpit_membres where membre_id = $1::uuid`, membreId)
  return r[0]?.nom ?? null
}

/** Le « qui » d'une ligne -> l'identite en base. Lecture seule. */
async function rapprocher(tx: Tx, qui: Qui): Promise<Rapproche> {
  if (qui.type === 'vide') return { resolution: { identite: identite({}), statutMax: SANS_PLAFOND, note: null }, noms: { fiche: null, personne: null } }

  if (qui.type === 'membre') {
    const r = await q<{ membre_id: string }>(tx, `select membre_id::text as membre_id from public.cockpit_membres where membre_id = $1::uuid`, qui.membreId)
    if (!r[0]) return { refus: 'qui : aucune fiche du cockpit avec cet identifiant (membre:<uuid>).' }
    return { resolution: { identite: identite({ membreId: r[0].membre_id }), statutMax: SANS_PLAFOND, note: null }, noms: { fiche: await nomFiche(tx, r[0].membre_id), personne: null } }
  }

  if (qui.type === 'personne') {
    const r = await q<{ personne_id: string; nom: string | null }>(tx, `
      select personne_id, nom from public.cockpit_arch_personnes where personne_id = $1`, qui.personneId)
    if (!r[0]) return { refus: 'qui : aucune personne du fonds avec cet identifiant (p-...).' }
    // La fiche ne suit que sur un lien certain : un lien par le nom n'est jamais une preuve.
    const membreId = await ficheCertaine(tx, r[0].personne_id)
    return {
      resolution: { identite: identite({ personneId: r[0].personne_id, membreId }), statutMax: SANS_PLAFOND, note: null },
      noms: { fiche: membreId ? await nomFiche(tx, membreId) : null, personne: r[0].nom },
    }
  }

  if (qui.type === 'equipe') {
    const candidats = await q<{ personne_id: string; nom: string | null; alias: string | null }>(tx, `
      select personne_id, nom, alias from public.cockpit_arch_personnes where nature = any($1::text[])`, [...NATURES_EQUIPE])
    const t = personneEquipe(qui.prenom, candidats)
    if (!t.trouvee) {
      return {
        resolution: {
          identite: identite({ equipe: qui.prenom }), statutMax: SANS_PLAFOND,
          note: t.nombre === 0 ? `Équipe : aucune personne du fonds ne s'appelle ${qui.prenom}.` : `Équipe : ${t.nombre} personnes du fonds s'appellent ${qui.prenom}, aucune n'est choisie.`,
        },
        noms: { fiche: null, personne: null },
      }
    }
    const p = candidats.find((c) => c.personne_id === t.trouvee)!
    const membreId = await ficheCertaine(tx, p.personne_id)
    return {
      resolution: { identite: identite({ equipe: qui.prenom, personneId: p.personne_id, membreId }), statutMax: SANS_PLAFOND, note: null },
      noms: { fiche: membreId ? await nomFiche(tx, membreId) : null, personne: p.nom },
    }
  }

  // Le numero de membre : le compte du site (profiles.client_number), puis la
  // fiche par ses adresses VERIFIEES (le meme pont que aok_badges_fiche), sinon
  // le numero reserve d'un ancien membre (aok_anciens_membres).
  const compte = await q<{ id: string }>(tx, `select id::text as id from public.profiles where client_number = $1::bigint`, qui.numero)
  if (compte[0]) {
    const fiches = await q<{ membre_id: string }>(tx, `
      select distinct me.membre_id::text as membre_id
      from public.cockpit_membre_emails me
      where lower(me.email) in (
        select lower(u.email) from auth.users u where u.id = $1::uuid and u.email_confirmed_at is not null and u.email is not null
        union
        select lower(pe.email) from public.profile_emails pe where pe.profile_id = $1::uuid and pe.verified)`, compte[0].id)
    if (fiches.length === 1) {
      return {
        resolution: { identite: identite({ numeroMembre: qui.numero, membreId: fiches[0].membre_id }), statutMax: SANS_PLAFOND, note: null },
        noms: { fiche: await nomFiche(tx, fiches[0].membre_id), personne: null },
      }
    }
    return {
      resolution: {
        identite: identite({ numeroMembre: qui.numero }),
        statutMax: fiches.length > 1 ? 'probable' : SANS_PLAFOND,
        note: fiches.length > 1
          ? `Le compte n° ${qui.numero} est relié à ${fiches.length} fiches du cockpit : aucune n'est choisie, à trancher dans le cockpit.`
          : `Le compte n° ${qui.numero} n'a pas de fiche du cockpit (aucune adresse vérifiée commune).`,
      },
      noms: { fiche: null, personne: null },
    }
  }
  const ancien = await q<{ personne_id: string | null; nom: string | null }>(tx, `
    select a.personne_id, p.nom from public.aok_anciens_membres a
    left join public.cockpit_arch_personnes p on p.personne_id = a.personne_id
    where a.numero = $1::bigint`, qui.numero)
  if (ancien[0]) {
    return {
      resolution: { identite: identite({ numeroMembre: qui.numero, personneId: ancien[0].personne_id }), statutMax: SANS_PLAFOND, note: `Numéro réservé d'un ancien membre (n° ${qui.numero}), pas encore de compte.` },
      noms: { fiche: null, personne: ancien[0].nom },
    }
  }
  return { refus: `qui : numéro de membre inconnu (n° ${qui.numero}).` }
}

type LigneBase = {
  handle_id: string; membre_id: string | null; personne_id: string | null; numero_membre: number | null; equipe: string | null
  statut: Statut; preuve: string | null; source: string | null; note: string | null; interactions: number
  premier_vu: string | null; dernier_vu: string | null; pose_par: string
}

const versEtat = (l: LigneBase): EtatHandle => ({
  membreId: l.membre_id, personneId: l.personne_id, numeroMembre: l.numero_membre === null ? null : Number(l.numero_membre), equipe: l.equipe,
  statut: l.statut, preuve: l.preuve, source: l.source, note: l.note, interactions: Number(l.interactions),
  premierVu: l.premier_vu, dernierVu: l.dernier_vu, posePar: l.pose_par,
})

const VALEURS = (e: EtatHandle) => [
  e.membreId, e.personneId, e.numeroMembre, e.equipe, e.statut, e.preuve, e.source, e.note, e.interactions, e.premierVu, e.dernierVu, e.posePar,
]

export type ResultatLigne = {
  rang: number; plateforme: string; handle: string; action: Decision['action']; statut: Statut
  rattache_a: string | null; remarques: string[]
}

class AnnulationABlanc extends Error {
  constructor() { super('a blanc') }
}

/**
 * Traite les lignes lisibles d'un lot dans la transaction donnee : rapprocher
 * chaque « qui », puis ecrire sous verrou. N'annule rien lui-meme (le script
 * d'essai l'appelle dans une transaction qu'il annule).
 */
export async function traiterLot(
  tx: Tx, lot: Lot, posePar: 'tab' | 'tache' | 'claude', aujourdhui: string,
): Promise<{ resultats: ResultatLigne[]; refusees: LigneRefusee[] }> {
  const resultats: ResultatLigne[] = []
  const refus: LigneRefusee[] = []
  const cache = new Map<string, Rapproche>()
  for (const l of lot.lignes) {
    const cle = JSON.stringify(l.qui)
    let r = cache.get(cle)
    if (!r) { r = await rapprocher(tx, l.qui); cache.set(cle, r) }
    if ('refus' in r) { refus.push({ rang: l.rang, plateforme: l.plateforme, handle: l.handle, erreur: r.refus }); continue }
    resultats.push(await ecrireLigne(tx, l, r, posePar, aujourdhui))
  }
  return { resultats, refusees: [...lot.refusees, ...refus].sort((a, b) => a.rang - b.rang) }
}

/**
 * Recoit un lot. posePar : 'tab' ou 'tache' (la cle), 'claude' pour un lot
 * pose par Claude Code. Rend le corps de la reponse et son statut HTTP.
 */
export async function recevoirLot(
  corps: unknown, opts: { posePar: 'tab' | 'tache' | 'claude'; aujourdhui: string; aBlancForce?: boolean },
): Promise<{ status: number; corps: Record<string, unknown>; lignes: number | null; erreur?: string }> {
  const lot = lireLot(corps, opts.aujourdhui)
  if (typeof lot === 'string') return { status: 400, corps: { ok: false, erreur: lot }, lignes: null, erreur: lot }
  const aBlanc = lot.aBlanc || !!opts.aBlancForce

  let resultats: ResultatLigne[] = []
  let refusees: LigneRefusee[] = [...lot.refusees]
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local statement_timeout = '15000ms'`)
      const t = await traiterLot(tx, lot, opts.posePar, opts.aujourdhui)
      resultats = t.resultats
      refusees = t.refusees
      if (aBlanc) throw new AnnulationABlanc()
    }, { maxWait: 8000, timeout: 30000 })
  } catch (err) {
    if (!(err instanceof AnnulationABlanc)) {
      const raison = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() ?? '' : String(err)
      console.error('[tab] handles', raison.slice(0, 300))
      const absente = tableAbsente(err)
      return {
        status: absente ? 503 : 502,
        corps: { ok: false, erreur: absente ? 'La table des handles n\'est pas encore en place : rien n\'est écrit.' : 'Lot non enregistré (erreur de la base) : rien n\'est écrit. Réessaie dans un instant.' },
        lignes: null, erreur: raison.slice(0, 300),
      }
    }
  }

  const compte = (a: Decision['action']) => resultats.filter((r) => r.action === a).length
  const status = resultats.length === 0 && refusees.length > 0 ? 400 : 200
  return {
    status,
    lignes: resultats.length,
    ...(status === 400 ? { erreur: `${refusees.length} ligne(s) refusée(s), aucune écrite` } : {}),
    corps: {
      ok: status === 200,
      libelle: aBlanc
        ? 'Lot de handles À BLANC : tout est calculé, rien n\'est écrit'
        : `Lot de handles reçu : ${compte('cree')} créé(s), ${compte('mis_a_jour')} mis à jour, ${compte('inchange')} inchangé(s), ${refusees.length} refusé(s)`,
      donnees: {
        a_blanc: aBlanc,
        resume: { crees: compte('cree'), mis_a_jour: compte('mis_a_jour'), inchanges: compte('inchange'), refusees: refusees.length },
        lignes: resultats,
        refusees,
      },
      notes: [
        'Information INTERNE : le membre ne voit jamais qu\'on a son handle (aucune page du site ni de son espace ne lit cette table).',
        'Renvoyer le même handle met à jour sa ligne, jamais une deuxième. Un statut « sûr » posé à la main n\'est jamais changé par un lot, et une ligne sans « qui » n\'efface jamais un rapprochement déjà posé.',
        ...(aBlanc ? ['À blanc : renvoie le même lot sans a_blanc pour l\'écrire.'] : []),
      ],
    },
  }
}

async function ecrireLigne(tx: Tx, l: LigneLot, r: Extract<Rapproche, { resolution: Resolution }>, posePar: string, aujourdhui: string): Promise<ResultatLigne> {
  const lues = await q<LigneBase>(tx, `
    select handle_id::text as handle_id, membre_id::text as membre_id, personne_id, numero_membre, equipe, statut, preuve, source, note,
      interactions, to_char(premier_vu, 'YYYY-MM-DD') as premier_vu, to_char(dernier_vu, 'YYYY-MM-DD') as dernier_vu, pose_par
    from public.cockpit_handles_sociaux where plateforme = $1 and handle = $2 for update`, l.plateforme, l.handle)
  const existant = lues[0] ? versEtat(lues[0]) : null
  const d = decider(existant, l, r.resolution, posePar, aujourdhui)
  // Les noms affiches : ceux du rapprochement, ou ceux de l'identite gardee (statut fige, ligne sans « qui »).
  const gardee = d.etat.membreId !== r.resolution.identite.membreId || d.etat.personneId !== r.resolution.identite.personneId
  const noms = gardee ? await nomsDe(tx, d.etat) : r.noms
  const resultat = (action: Decision['action'], remarques = d.remarques): ResultatLigne => ({
    rang: l.rang, plateforme: l.plateforme, handle: l.handle, action, statut: d.etat.statut,
    rattache_a: libelleIdentite(d.etat, noms), remarques,
  })
  if (d.action === 'inchange') return resultat('inchange')
  if (!existant) {
    const ins = await q<{ handle_id: string }>(tx, `
      insert into public.cockpit_handles_sociaux
        (plateforme, handle, membre_id, personne_id, numero_membre, equipe, statut, preuve, source, note, interactions, premier_vu, dernier_vu, pose_par)
      values ($1, $2, $3::uuid, $4, $5::bigint, $6, $7, $8, $9, $10, $11::int, $12::date, $13::date, $14)
      on conflict (plateforme, handle) do nothing
      returning handle_id::text as handle_id`, l.plateforme, l.handle, ...VALEURS(d.etat))
    if (!ins[0]) return resultat('inchange', ['Écrit au même instant par un autre appel : renvoie cette ligne pour la mettre à jour.'])
    return resultat('cree')
  }
  await tx.$executeRawUnsafe(`
    update public.cockpit_handles_sociaux set
      membre_id = $2::uuid, personne_id = $3, numero_membre = $4::bigint, equipe = $5, statut = $6, preuve = $7, source = $8, note = $9,
      interactions = $10::int, premier_vu = $11::date, dernier_vu = $12::date, pose_par = $13, maj_le = now()
    where handle_id = $1::uuid`, lues[0].handle_id, ...VALEURS(d.etat))
  return resultat('mis_a_jour')
}

async function nomsDe(tx: Tx, e: Identite): Promise<Noms> {
  const fiche = e.membreId ? await nomFiche(tx, e.membreId) : null
  const p = e.personneId ? await q<{ nom: string | null }>(tx, `select nom from public.cockpit_arch_personnes where personne_id = $1`, e.personneId) : []
  return { fiche, personne: p[0]?.nom ?? null }
}

/**
 * GET /handles : la liste, la plus utile d'abord (a identifier, puis
 * probable, puis sur ; le dernier vu d'abord). Filtres : statut (liste),
 * plateforme, membre (uuid). Lecture seule, dans la transaction de la route.
 */
export async function handlesTab(c: Ctx): Promise<Sortie> {
  const statuts = (c.params.get('statut') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const inconnu = statuts.find((s) => !(STATUTS as readonly string[]).includes(s))
  if (inconnu) return { libelle: 'Handles des réseaux', sources: [], donnees: { erreur: `statut : sur, probable ou a_identifier (liste séparée par des virgules).` }, lignes: 0, statut: 400 }
  const plateforme = c.params.get('plateforme')?.trim().toLowerCase() || null
  const membre = c.params.get('membre')?.trim().replace(/^membre:/i, '').toLowerCase() || null
  if (membre && !/^[0-9a-f-]{36}$/.test(membre)) return { libelle: 'Handles des réseaux', sources: [], donnees: { erreur: 'membre : l\'identifiant de fiche (uuid, avec ou sans membre:).' }, lignes: 0, statut: 400 }
  try {
    const lignes = await q<Record<string, unknown>>(c.tx, `
      select h.plateforme, h.handle, h.statut,
        case when h.membre_id is null then null else 'membre:' || h.membre_id::text end as membre,
        ${NOM_FICHE('m.')} as fiche,
        h.numero_membre, h.equipe, h.personne_id, p.nom as personne,
        h.preuve, h.source, h.note, h.interactions, to_char(h.premier_vu, 'YYYY-MM-DD') as premier_vu, to_char(h.dernier_vu, 'YYYY-MM-DD') as dernier_vu,
        h.pose_par, to_char(h.maj_le at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI') as maj_le
      from public.cockpit_handles_sociaux h
      left join public.cockpit_membres m on m.membre_id = h.membre_id
      left join public.cockpit_arch_personnes p on p.personne_id = h.personne_id
      where ($1::text[] is null or h.statut = any($1::text[]))
        and ($2::text is null or h.plateforme = $2)
        and ($3::uuid is null or h.membre_id = $3::uuid)
      order by case h.statut when 'a_identifier' then 0 when 'probable' then 1 else 2 end, h.dernier_vu desc nulls last, h.plateforme, h.handle
      limit $4 offset $5`, statuts.length ? statuts : null, plateforme, membre, c.pag.limite + 1, c.pag.decalage)
    const { page, pagination } = paginer(lignes, c.pag)
    return {
      libelle: 'Handles des réseaux rapprochés des fiches (interne)',
      sources: ['cockpit_handles_sociaux (lots de Tab, POST /handles)'],
      donnees: { handles: page },
      lignes: page.length,
      pagination,
      notes: ['Information interne : le membre ne voit jamais qu\'on a son handle.', 'Un rapprochement « probable » n\'est pas une preuve.'],
    }
  } catch (err) {
    if (tableAbsente(err)) return { libelle: 'Handles des réseaux', sources: [], donnees: { erreur: 'La table des handles n\'est pas encore en place.' }, lignes: 0, statut: 503 }
    throw err
  }
}
