// LES BESOINS DES MEMBRES, LOT 1 (06/11/2026) : le branchement du moteur
// (moteur.ts) sur la base et sur Anthropic.
//
// Tables de la migration 20261106120000 (besoin, besoin_demande, besoin_vote,
// besoin_curseur_fil, besoin_passe), en SQL brut HORS du schema Prisma : un
// deploiement du journal avant la migration ne casse rien, la note en direct
// echoue en silence (log court) et le chat comme le bot repondent comme avant.
//
// Modele : Haiku (MODELE_BESOINS), cle du support (aiClient('support')), chaque
// appel trace dans AiUsage (postes besoins_reperage et besoins_regroupement),
// essai compris : le mode essai n'ecrit aucune donnee de besoin, mais la
// depense reste visible dans l'ecran Depense IA.
//
// Jamais de texte de membre dans un log : les erreurs passent par erreurCourte
// (la premiere ligne du message Prisma, sans les valeurs).

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { aiClient, logAiUsage, textOf } from '@/lib/ai'
import { coutMicroEuros } from '@/lib/ia-prix'
import {
  type BesoinPropose, type OutilBesoin, type SuitePasse,
  erreurCourte, estTableAbsente, normaliserTexteMembre,
} from './pur'
import {
  type CarteLue, type Depots, type FilLu, type IssueDirecte, type OptionsPasse, type ResultatPasse,
  noterEnDirect, repererBesoins,
} from './moteur'

/** Le plafond de texte_membre (contrainte de la migration). */
const MAX_TEXTE_DEMANDE = 20_000

class TablesAbsentes extends Error {
  constructor() {
    super('tables des besoins absentes (migration 20261106120000 non appliquee)')
  }
}

/** Une erreur SQL : « table absente » reconnue, le reste tel quel (jamais de valeur dans le message garde). */
function relancer(err: unknown): never {
  if (estTableAbsente(err)) throw new TablesAbsentes()
  throw err
}

/** Grille de prix : un id date de Haiku 4.5 est facture comme claude-haiku-4-5. */
function modeleGrille(modele: string): string {
  return modele.startsWith('claude-haiku-4-5') ? 'claude-haiku-4-5' : modele
}

const OUTILS_CONNUS = new Set<string>(['carnet', 'pilotage', 'journal', 'academie', 'site', 'bot', 'autre'])

function carte(l: { id: string; cle: string; titre: string; outil: string }): CarteLue {
  return { id: l.id, cle: l.cle, titre: l.titre, outil: (OUTILS_CONNUS.has(l.outil) ? l.outil : 'autre') as OutilBesoin }
}

/** Les depots reels. `echange` regroupe les appels du modele d'une meme operation (ecran Depense IA). */
export function depotsServeur(o: { echange?: string } = {}): Depots {
  const echange = o.echange ?? randomUUID()
  // Lu une fois par operation : avant la migration, un essai lit sans curseur ni carte.
  let tables: boolean | null = null

  const depots: Depots = {
    async tablesPresentes() {
      const l = await prisma.$queryRaw<{ ok: boolean }[]>`
        select (to_regclass('public.besoin_demande') is not null
          and to_regclass('public.besoin_curseur_fil') is not null) as ok`
      tables = l[0]?.ok === true
      return tables
    },

    async lireFils({ max, apres, avecCurseurs }) {
      const borne = apres ? Prisma.sql`and (t."updatedAt", t.id) > (${apres.maj}::timestamp(3), ${apres.id})` : Prisma.empty
      try {
        const lignes = avecCurseurs
          ? await prisma.$queryRaw<{ id: string; app: string | null; user_id: string; membre_id: string | null; messages: unknown; maj: Date; messages_lus: number | null; dernier_at: Date | null }[]>`
              select t.id, t.app, t."userId" as user_id, t."membreId" as membre_id, t.messages, t."updatedAt" as maj,
                c.messages_lus, c.dernier_at
              from public."SupportThread" t
              left join public.besoin_curseur_fil c on c.fil_id = t.id
              where (c.fil_id is null or t."updatedAt" > c.fil_maj_le) ${borne}
              order by t."updatedAt", t.id
              limit ${max}`
          : await prisma.$queryRaw<{ id: string; app: string | null; user_id: string; membre_id: string | null; messages: unknown; maj: Date; messages_lus: number | null; dernier_at: Date | null }[]>`
              select t.id, t.app, t."userId" as user_id, t."membreId" as membre_id, t.messages, t."updatedAt" as maj,
                null::int as messages_lus, null::timestamptz as dernier_at
              from public."SupportThread" t
              where true ${borne}
              order by t."updatedAt", t.id
              limit ${max}`
        return lignes.map((l): FilLu => ({
          id: l.id,
          app: l.app ?? 'extension',
          userId: l.user_id,
          membreId: l.membre_id,
          messages: l.messages,
          maj: new Date(l.maj).toISOString(),
          curseur: l.messages_lus === null ? null : { messagesLus: l.messages_lus, dernierAt: l.dernier_at ? new Date(l.dernier_at).toISOString() : null },
        }))
      } catch (err) {
        return relancer(err)
      }
    },

    async compterRestants({ apres, avecCurseurs }) {
      const borne = apres ? Prisma.sql`and (t."updatedAt", t.id) > (${apres.maj}::timestamp(3), ${apres.id})` : Prisma.empty
      try {
        const l = avecCurseurs
          ? await prisma.$queryRaw<{ n: number }[]>`
              select count(*)::int as n
              from public."SupportThread" t
              left join public.besoin_curseur_fil c on c.fil_id = t.id
              where (c.fil_id is null or t."updatedAt" > c.fil_maj_le) ${borne}`
          : await prisma.$queryRaw<{ n: number }[]>`
              select count(*)::int as n from public."SupportThread" t where true ${borne}`
        return Number(l[0]?.n ?? 0)
      } catch (err) {
        return relancer(err)
      }
    },

    async empreintesConnues(filIds) {
      const sortie = new Map<string, Set<string>>()
      if (!filIds.length || tables === false) return sortie
      try {
        const lignes = await prisma.$queryRaw<{ fil_id: string; e: string }[]>`
          select d.fil_id, unnest(d.empreintes_messages) as e
          from public.besoin_demande d
          where d.fil_id = any(${filIds}::text[])`
        for (const l of lignes) {
          const s = sortie.get(l.fil_id) ?? new Set<string>()
          s.add(l.e)
          sortie.set(l.fil_id, s)
        }
        return sortie
      } catch (err) {
        return relancer(err)
      }
    },

    async carteParCle(cle) {
      if (tables === false) return null
      try {
        const l = await prisma.$queryRaw<{ id: string; cle: string; titre: string; outil: string }[]>`
          with recursive chaine as (
            select b.id, b.cle, b.titre, b.outil, b.fusionne_dans, 0 as n from public.besoin b where b.cle = ${cle}
            union all
            select b.id, b.cle, b.titre, b.outil, b.fusionne_dans, c.n + 1
            from public.besoin b join chaine c on b.id = c.fusionne_dans
            where c.n < 10
          )
          select id::text as id, cle, titre, outil from chaine where fusionne_dans is null order by n desc limit 1`
        return l[0] ? carte(l[0]) : null
      } catch (err) {
        return relancer(err)
      }
    },

    async cartesDeLOutil(outil, max) {
      if (tables === false) return []
      try {
        const l = await prisma.$queryRaw<{ id: string; cle: string; titre: string; outil: string }[]>`
          select b.id::text as id, b.cle, b.titre, b.outil
          from public.besoin b
          left join lateral (
            select count(*) as n, max(d.created_at) as derniere
            from public.besoin_demande d where d.besoin_id = b.id
          ) d on true
          where b.outil = ${outil} and b.fusionne_dans is null
          order by d.n desc nulls last, d.derniere desc nulls last, b.created_at desc
          limit ${max}`
        return l.map(carte)
      } catch (err) {
        return relancer(err)
      }
    },

    async accuseDejaDit(carteId, filId) {
      try {
        const l = await prisma.$queryRaw<{ ok: number }[]>`
          select 1 as ok from public.besoin_demande
          where besoin_id = ${carteId}::uuid and fil_id = ${filId} and accuse_le is not null
          limit 1`
        return l.length > 0
      } catch (err) {
        return relancer(err)
      }
    },

    async creerCarte(b: BesoinPropose, cle: string, creePar: string) {
      try {
        const l = await prisma.$queryRaw<{ id: string; cle: string; titre: string; outil: string }[]>`
          insert into public.besoin (cle, titre, outil, nature, cree_par)
          values (${cle}, ${b.titre}, ${b.outil}, ${b.nature}, ${creePar})
          on conflict (cle) do nothing
          returning id::text as id, cle, titre, outil`
        return l[0] ? carte(l[0]) : null
      } catch (err) {
        return relancer(err)
      }
    },

    async insererDemande(d) {
      const texte = d.texte.length > MAX_TEXTE_DEMANDE ? d.texte.slice(0, MAX_TEXTE_DEMANDE) : d.texte
      if (texte !== d.texte) console.warn('[besoins] texte de demande coupe a 20 000 caracteres')
      try {
        const l = await prisma.$queryRaw<{ id: string }[]>`
          insert into public.besoin_demande
            (besoin_id, canal, app, fil_id, membre_ref, membre_id, texte_membre, empreinte, empreintes_messages,
             resume, detecte_par, suspect, suspect_raison, texte_visible)
          values (
            ${d.besoinId}::uuid, ${d.canal}, ${d.app}, ${d.filId}, ${d.membreRef.slice(0, 100)}, ${d.membreId},
            ${texte}, ${d.empreinte}, ${d.empreintesMessages}::text[],
            ${d.resume}, ${d.detectePar}, ${d.suspect}, ${d.suspectRaison}, ${d.texteVisible}
          )
          on conflict on constraint besoin_demande_unique do nothing
          returning id::text as id`
        return l[0]?.id ?? null
      } catch (err) {
        return relancer(err)
      }
    },

    async marquerAccuse(demandeId) {
      try {
        await prisma.$executeRaw`
          update public.besoin_demande set accuse_le = now()
          where id = ${demandeId}::uuid and accuse_le is null`
      } catch (err) {
        relancer(err)
      }
    },

    async avancerCurseur(c) {
      try {
        await prisma.$executeRaw`
          insert into public.besoin_curseur_fil (fil_id, fil_maj_le, messages_lus, dernier_at, passe_id, analyse_le)
          values (${c.filId}, ${c.maj}::timestamp(3), ${c.messagesLus}, ${c.dernierAt}::timestamptz, ${c.passeId}::uuid, now())
          on conflict (fil_id) do update set
            fil_maj_le = excluded.fil_maj_le,
            messages_lus = excluded.messages_lus,
            dernier_at = coalesce(excluded.dernier_at, public.besoin_curseur_fil.dernier_at),
            passe_id = excluded.passe_id,
            analyse_le = now()`
      } catch (err) {
        relancer(err)
      }
    },

    async ouvrirPasse(par) {
      try {
        const l = await prisma.$queryRaw<{ id: string }[]>`
          insert into public.besoin_passe (par)
          select ${par.slice(0, 80)}
          where not exists (
            select 1 from public.besoin_passe where fin is null and debut > now() - interval '2 minutes'
          )
          returning id::text as id`
        return l[0]?.id ?? null
      } catch (err) {
        return relancer(err)
      }
    },

    async fermerPasse(id, b) {
      try {
        await prisma.$executeRaw`
          update public.besoin_passe set
            fin = now(), fils_lus = ${b.fils_lus}, messages_lus = ${b.messages_lus}, besoins_trouves = ${b.besoins_trouves},
            demandes_creees = ${b.demandes_creees}, cartes_creees = ${b.cartes_creees}, suspects = ${b.suspects},
            erreurs = ${b.erreurs}, restants = ${b.restants}, erreur = ${b.erreur}
          where id = ${id}::uuid`
      } catch (err) {
        relancer(err)
      }
    },

    async appelIA(requete, usage, qui) {
      const client = aiClient('support')
      const r = await client.messages.create(requete)
      await logAiUsage(qui, 'support', modeleGrille(requete.model), r.usage, null, { usage, echange })
      return { texte: textOf(r), coutMicros: coutMicroEuros(modeleGrille(requete.model), r.usage) }
    },

    maintenant: () => Date.now(),

    // Les lignes du moteur : constantes et erreurCourte seulement (verifier-besoins.mjs).
    journal(ligne) {
      console.warn(`[besoins] ${ligne}`)
    },
  }
  return depots
}

// ---------------------------------------------------------------------------
// Les entrees des bots et de la route
// ---------------------------------------------------------------------------

const SANS_NOTE: IssueDirecte = { phrase: false, enregistres: 0, suspects: 0 }

/**
 * Le chat support du site et des apps (/api/support/chat) : les besoins notes
 * pendant l'echange, apres la sauvegarde du fil. Ne jette jamais.
 */
export async function noterBesoinsDuChat(o: {
  userId: string
  app: string
  filId: string
  /** Le message du membre, tel qu'il vient d'etre ecrit au fil. */
  texte: string
  besoins: readonly BesoinPropose[]
  peutDire: boolean
}): Promise<IssueDirecte> {
  if (!o.besoins.length) return SANS_NOTE
  return noterEnDirect({
    canal: 'chat', detectePar: 'ia_chat', app: o.app, filId: o.filId, membreRef: o.userId, membreId: null,
    texte: o.texte, besoins: o.besoins, peutDire: o.peutDire, qui: o.userId,
  }, depotsServeur())
}

/**
 * Le bot des membres du Live Club (agent-membre.ts) : le fil du compte
 * Telegram existe deja (le message du membre y est ecrit avant l'agent). Le
 * texte garde est le message du membre tel qu'il est dans le fil (le plus
 * recent qui correspond a `texteFil`, la forme nettoyee que le pont ecrit).
 * Ne jette jamais.
 */
export async function noterBesoinsTelegram(o: {
  telegramId: number
  texteFil: string
  besoins: readonly BesoinPropose[]
  peutDire: boolean
}): Promise<IssueDirecte> {
  if (!o.besoins.length || !Number.isSafeInteger(o.telegramId) || o.telegramId <= 0) return SANS_NOTE
  try {
    const l = await prisma.$queryRaw<{ id: string; membre_id: string | null; messages: unknown }[]>`
      select id, "membreId" as membre_id, messages from public."SupportThread" where "telegramId" = ${o.telegramId} limit 1`
    const fil = l[0]
    if (!fil) {
      console.warn('[besoins] fil Telegram introuvable : besoin non note')
      return SANS_NOTE
    }
    const attendu = normaliserTexteMembre(o.texteFil)
    const messages = Array.isArray(fil.messages) ? (fil.messages as { role?: unknown; content?: unknown }[]) : []
    const recents = messages.slice(-12).reverse()
    const trouve = recents.find(m => m?.role === 'user' && typeof m.content === 'string' && normaliserTexteMembre(m.content) === attendu)
    const texte = typeof trouve?.content === 'string' ? trouve.content : o.texteFil
    return await noterEnDirect({
      canal: 'telegram', detectePar: 'ia_bot', app: 'telegram', filId: fil.id, membreRef: `telegram:${o.telegramId}`,
      membreId: fil.membre_id, texte, besoins: o.besoins, peutDire: o.peutDire, qui: `liveclub:u${o.telegramId}`,
    }, depotsServeur())
  } catch (err) {
    console.warn(`[besoins] note du bot en panne : ${erreurCourte(err)}`)
    return SANS_NOTE
  }
}

/** La passe de reperage (route du cockpit, script local). Jette ErreurPasse (table absente, deja en cours). */
export async function repererBesoinsServeur(o: OptionsPasse): Promise<ResultatPasse> {
  return repererBesoins(o, depotsServeur())
}

export type { SuitePasse }
