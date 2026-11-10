// LES BESOINS DES MEMBRES, LA ROUTE AUTOMATIQUE DU TRI (10/11/2026) : les
// vrais depots de executerAuto (auto-pur.ts). Rien n'est recopie : les gestes
// sont ceux du cockpit (cockpit.ts), la lecture est celle de l'API de Tab
// (tab.ts, dans une transaction READ ONLY comme la route de Tab), la trace
// va dans besoin_geste (migration 20261110190000).

import { prisma } from '@/lib/db'
import type { Ctx } from '@/lib/tab/lectures'
import { besoinsTab } from './tab'
import { apercuPrevenir, changerStatut, fusionnerBesoins, modifierBesoin, prevenirMembres } from './cockpit'
import { estTableAbsente } from './pur'
import { ACTEUR_AUTO, DEMANDES_PAR_CARTE, type DepotsAuto } from './auto-pur'

const PERIODE: Ctx['periode'] = { du: '', au: '', fuseau: 'Europe/Paris', libelle: '', par_defaut: true }

export function depotsAuto(): DepotsAuto {
  return {
    async tracesPresentes() {
      try {
        await prisma.$queryRaw`select 1 from public.besoin_geste limit 0`
        return true
      } catch (err) {
        if (estTableAbsente(err)) return false
        throw err
      }
    },

    async tracer(g) {
      await prisma.$executeRaw`
        insert into public.besoin_geste (par, action, carte_id, resultat, details)
        values (${ACTEUR_AUTO}, ${g.action}, ${g.carteId}::uuid, ${g.resultat}, ${JSON.stringify(g.details)}::jsonb)`
    },

    async lire(max) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('set transaction read only')
        await tx.$executeRawUnsafe(`set local statement_timeout = '8000ms'`)
        const ctx = (q: string): Ctx => ({ tx, periode: PERIODE, pag: { limite: max, decalage: 0 }, aujourdhui: '', params: new URLSearchParams(q) })
        const l = await besoinsTab(ctx('statut=a_trier'))
        if (l.statut && l.statut !== 200) throw new Error(`lecture des cartes : statut ${l.statut}`)
        const cartes = (Array.isArray(l.donnees.cartes) ? l.donnees.cartes : []) as Record<string, unknown>[]
        const sig = cartes.length ? await besoinsTab(ctx('vue=signaux')) : null
        const signaux = (Array.isArray(sig?.donnees.signaux) ? sig.donnees.signaux : []) as Record<string, unknown>[]
        const sortie: Record<string, unknown>[] = []
        for (const c of cartes) {
          const s = await besoinsTab(ctx(`id=${encodeURIComponent(String(c.id))}`))
          const demandes = Array.isArray(s.donnees.demandes) ? s.donnees.demandes : []
          sortie.push({
            ...c,
            demandes: demandes.slice(0, DEMANDES_PAR_CARTE),
            demandes_non_rendues: Math.max(0, demandes.length - DEMANDES_PAR_CARTE),
            signaux: signaux.filter(x => x.carte_id === c.id),
          })
        }
        const pagination = l.pagination as { curseur_suivant?: unknown } | undefined
        return { cartes: sortie, plus: Boolean(pagination?.curseur_suivant), notes: l.notes ?? [] }
      }, { maxWait: 8000, timeout: 30000 })
    },

    async etatCarte(id) {
      const l = await prisma.$queryRaw<{ statut: string; fusionnee: boolean }[]>`
        select statut, (fusionne_dans is not null) as fusionnee from public.besoin where id = ${id}::uuid`
      return l[0] ?? null
    },

    async tentativesDuJour() {
      const l = await prisma.$queryRaw<{ n: number }[]>`
        select coalesce(sum(case when details->>'tentatives' ~ '^[0-9]{1,6}$' then (details->>'tentatives')::int else 0 end), 0)::int as n
        from public.besoin_geste
        where par = ${ACTEUR_AUTO} and action = 'prevenir' and fait_le > now() - interval '24 hours'`
      return Number(l[0]?.n ?? 0)
    },

    modifierNote: (id, note) => modifierBesoin({ id, noteEquipe: note }),
    changerStatut: (id, statut, raison) => changerStatut(raison === null ? { id, statut } : { id, statut, raison }),
    fusionner: (sourceId, cibleId) => fusionnerBesoins({ sourceId, cibleId }),
    apercu: (id) => apercuPrevenir(id),
    prevenir: (id, message, budgetMs, maxEnvois) => prevenirMembres({ id, message }, budgetMs, maxEnvois),
    maintenant: () => Date.now(),
  }
}
