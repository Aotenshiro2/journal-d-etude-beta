import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { droitsAcademie, droitsVisiteur, type DroitsAcademie } from '@/lib/academie/droits'
import { lireCatalogue, type Catalogue, type LeconCatalogue } from '@/lib/academie/catalogue'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { ouvertureLecon } from '@/lib/academie/pur'
import {
  chercher, indexer, MAX_Q, SQL_TEXTES_LECONS, termesDe, texteBrut, type LeconCherchable, type ModuleCherchable,
  type Ouverture, type TexteIndexe,
} from '@/lib/academie/recherche'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * GET /api/academie/recherche?q=... : la RECHERCHE DANS TOUTES LES LECONS (13/11/2026,
 * FEATURE ; src/lib/academie/recherche.ts).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>, ou sans en-tete (visiteur :
 * les droits du catalogue public, droitsVisiteur). Un en-tete present mais refuse : 401.
 *
 * 200 { ok: true, q, termes, total, modules: [{ slug, titre, resume, correspond, n,
 *   lecons: [{ slug, titre, type, duree_s, section, acces, ou: ['titre' | 'texte'], extrait }] }] }
 *   modules dans l'ordre de pertinence ; extrait = un passage du texte, SEULEMENT pour une lecon
 *   ouverte a ce compte (visiteur : lecon d'apercu seulement), null sinon : une lecon fermee sort
 *   avec son titre et son cadenas, sans son contenu.
 * 400 'q' (moins de 2 caracteres utiles) ; 401 'jeton' ; 503 'indisponible'.
 *
 * Caches par instance : les droits d'un compte 2 min (Stripe peut etre lu pour le Live Club),
 * les textes des lecons 5 min (le catalogue garde son cache de 30 s). Un achat ou une edition se
 * voit donc dans la recherche en 5 min au plus ; la lecture, elle, decide toujours a frais.
 *
 * Logs : compte tronque, longueur de la recherche, nombre de resultats. JAMAIS la recherche.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const METHODES = 'GET, OPTIONS'
const DUREE_DROITS_MS = 2 * 60_000
const DUREE_TEXTES_MS = 5 * 60_000
const MAX_DROITS_EN_CACHE = 500

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

// ---------------------------------------------------------------------------
// Les caches
// ---------------------------------------------------------------------------

const droitsEnCache = new Map<string, { droits: Promise<DroitsAcademie>; expire: number }>()

function droitsDe(userId: string | null): Promise<DroitsAcademie> {
  const cle = userId ?? 'visiteur'
  const deja = droitsEnCache.get(cle)
  if (deja && deja.expire > Date.now()) return deja.droits
  if (droitsEnCache.size >= MAX_DROITS_EN_CACHE) {
    for (const [k, v] of droitsEnCache) if (v.expire <= Date.now()) droitsEnCache.delete(k)
    if (droitsEnCache.size >= MAX_DROITS_EN_CACHE) droitsEnCache.delete(droitsEnCache.keys().next().value as string)
  }
  const droits = userId ? droitsAcademie(userId) : droitsVisiteur()
  droitsEnCache.set(cle, { droits, expire: Date.now() + DUREE_DROITS_MS })
  droits.catch(() => droitsEnCache.delete(cle))
  return droits
}

let textesEnCache: { textes: Promise<Map<string, TexteIndexe>>; expire: number } | null = null

function textes(): Promise<Map<string, TexteIndexe>> {
  if (textesEnCache && textesEnCache.expire > Date.now()) return textesEnCache.textes
  const t = prisma.$queryRawUnsafe<{ id: string; contenu: string | null }[]>(SQL_TEXTES_LECONS).then(l => {
    const m = new Map<string, TexteIndexe>()
    for (const x of l) {
      const brut = texteBrut(x.contenu)
      if (brut) m.set(x.id, indexer(brut))
    }
    return m
  })
  const entree = { textes: t, expire: Date.now() + DUREE_TEXTES_MS }
  textesEnCache = entree
  t.catch(() => { if (textesEnCache === entree) textesEnCache = null })
  return t
}

// ---------------------------------------------------------------------------
// La route
// ---------------------------------------------------------------------------

function cherchables(c: Catalogue): { modules: ModuleCherchable[]; lecons: { l: LeconCherchable; source: LeconCatalogue }[] } {
  const publies = c.modules.filter(m => m.statut === 'publie')
  const ids = new Set(publies.map(m => m.id))
  const sections = new Map(c.sections.map(s => [s.id, s.titre]))
  return {
    modules: publies.map(m => ({ id: m.id, slug: m.slug, titre: m.titre, resume: m.resume, ordre: m.ordre, lienExterne: m.lienExterne })),
    lecons: c.lecons
      .filter(l => l.statut === 'publie' && ids.has(l.moduleId))
      .map(l => ({
        source: l,
        l: {
          id: l.id, moduleId: l.moduleId, slug: l.slug, titre: l.titre, type: l.type, dureeS: l.dureeS, ordre: l.ordre,
          section: l.sectionId ? sections.get(l.sectionId) ?? null : null,
        },
      })),
  }
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, MAX_Q)
  if (!termesDe(q).length) return refus('q', 400)

  // Le compte : avec un en-tete, il doit etre valide ; sans, un visiteur.
  let userId: string | null = null
  if (req.headers.get('authorization')) {
    try {
      userId = await compteDuJeton(req)
    } catch (err) {
      console.warn(`[academie/recherche] verification du jeton impossible : ${messageErreur(err)}`)
      return refus('indisponible', 503)
    }
    if (!userId) return refus('jeton', 401)
  }

  try {
    const [droits, catalogue, index] = await Promise.all([droitsDe(userId), lireCatalogue(), textes()])
    const { modules, lecons } = cherchables(catalogue)
    const sources = new Map(lecons.map(x => [x.l.id, x.source]))
    const visiteur = userId === null
    const res = chercher({
      q,
      modules,
      lecons: lecons.map(x => x.l),
      textes: index,
      ouverture: (l): Ouverture => {
        const src = sources.get(l.id)
        return src ? ouvertureLecon(droits, src) : { acces: 'ferme', raisons: [] }
      },
      extraitPermis: o => !visiteur || o.raisons.includes('apercu'),
    })
    return NextResponse.json({ ok: true, q, ...res }, { headers })
  } catch (err) {
    console.warn(`[academie/recherche] recherche impossible compte=${userId ? tronquer(userId) : 'visiteur'} longueur=${q.length} : ${
      relationAbsente(err) ? 'tables academie absentes' : messageErreur(err)}`)
    return refus('indisponible', 503)
  }
}
