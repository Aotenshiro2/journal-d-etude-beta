import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { journaliser, parametresJournal, verifierCle } from '@/lib/tab/acces'
import { aide } from '@/lib/tab/aide'
import { connaissances, donnees, schema } from '@/lib/tab/generique'
import {
  aFaire, avatars, contenus, depenseIA, encaissements, membres, paiements, personne, pubs, reseaux, resumeDuJour, support, youtube,
  type Ctx, type Sortie,
} from '@/lib/tab/lectures'
import { heureParisLisible, jourParis, lirePagination, lirePeriode, type DefautPeriode } from '@/lib/tab/pur'
import { lireDemandeGeneration } from '@/lib/generation-pur'
import { genererPost } from '@/lib/generation'
import { estUuid, lireFiltreStatut, lireNoteEntrante } from '@/lib/tab/notes-pur'
import { creerNote, listerNotes, marquerLueParTab, prevenirBrice } from '@/lib/tab/notes'
import { marquerNote } from '@/lib/securite/injection-pur'
import { alerterBriceSecurite } from '@/lib/securite/alerte'
import { lireImage as lireImageBelrive, listerImages as listerImagesBelrive, type Executeur } from '@/lib/mcp-gpt/requetes'
import { urlSigneeImage } from '@/lib/mcp-gpt/stockage-images'

/**
 * L'API DE TAB (20/10/2026) : /api/tab/v1/... , JSON, LECTURE SEULE.
 *
 * Tab est l'assistant IA personnel de Brice (il lui parle par WhatsApp) : il
 * lit le cockpit ici, avec une cle dediee (Authorization: Bearer). La cle,
 * la limite de debit et le journal d'acces : src/lib/tab/acces.ts. Les
 * lectures metier : src/lib/tab/lectures.ts ; la lecture generique (schema,
 * donnees/<table>, connaissances) : src/lib/tab/generique.ts ; l'aide :
 * src/lib/tab/aide.ts.
 *
 * Toute lecture tourne dans UNE transaction READ ONLY (delai de 8 s par
 * requete) : rien ne peut ecrire, meme par erreur. Les deux seules ecritures
 * sont le journal d'acces (cockpit_tab_acces) et POST /generer-post (le
 * generateur de posts du cockpit, origine 'tab', poste generation_tab).
 *
 * Route publique pour le middleware (pas de session) : la cle est verifiee ici.
 */

export const maxDuration = 300
export const dynamic = 'force-dynamic'

type Lecture = { f: (c: Ctx) => Promise<Sortie>; defaut: DefautPeriode }

const LECTURES: Record<string, Lecture> = {
  'resume-du-jour': { f: resumeDuJour, defaut: 'jour' },
  'a-faire': { f: aFaire, defaut: 'jour' },
  encaissements: { f: encaissements, defaut: 'mois' },
  membres: { f: membres, defaut: '7j' },
  paiements: { f: paiements, defaut: '30j' },
  support: { f: support, defaut: '30j' },
  'depense-ia': { f: depenseIA, defaut: 'mois' },
  pubs: { f: pubs, defaut: 'mois' },
  youtube: { f: youtube, defaut: '7j' },
  reseaux: { f: reseaux, defaut: '7j' },
  contenus: { f: contenus, defaut: 'semaine' },
  personne: { f: personne, defaut: 'tout' },
  avatars: { f: avatars, defaut: 'tout' },
  connaissances: { f: connaissances, defaut: 'tout' },
  schema: { f: schema, defaut: 'tout' },
}

const ENTETES = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

function ipDe(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
}

async function cheminDe(ctx: { params: Promise<{ chemin?: string[] }> }): Promise<string[]> {
  const p = await ctx.params
  return (p.chemin ?? []).map((s) => decodeURIComponent(s)).filter(Boolean)
}

function repondre(corps: Record<string, unknown>, status: number) {
  return NextResponse.json(corps, { status, headers: ENTETES })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ chemin?: string[] }> }) {
  const debut = Date.now()
  const url = new URL(req.url)
  const chemin = await cheminDe(ctx)
  const route = `/${chemin.join('/')}`
  const parametres = parametresJournal(url)
  const ip = ipDe(req)

  const verdict = await verifierCle(req.headers.get('authorization'))
  if (!verdict.ok) {
    await journaliser({ cleId: verdict.cleId, route, parametres, statut: verdict.status, dureeMs: Date.now() - debut, lignes: null, ip, erreur: verdict.erreur })
    return repondre({ ok: false, erreur: verdict.erreur, aide: `${url.origin}/api/tab/v1/aide` }, verdict.status)
  }
  const fin = async (corps: Record<string, unknown>, statut: number, lignes: number | null, erreur?: string) => {
    const duree = Date.now() - debut
    await journaliser({ cleId: verdict.cleId, route, parametres, statut, dureeMs: duree, lignes, ip, erreur })
    return repondre({ ...corps, duree_ms: duree }, statut)
  }

  const genereLe = new Date()
  const enTete = { route, genere_le: genereLe.toISOString(), genere_le_paris: heureParisLisible(genereLe) }

  if (chemin.length === 0 || chemin[0] === 'aide') {
    return fin({ ok: true, ...enTete, ...aide() }, 200, null)
  }

  const nom = chemin[0]
  // L'espace perso (20/10/2026) : les notes de Claude (ou de Brice) pour Tab.
  if (nom === 'notes') {
    if (chemin.length !== 1) return fin({ ok: false, ...enTete, erreur: 'Marquer lue se demande en POST /notes/<id>/lu.' }, 405, null)
    const statut = lireFiltreStatut(url.searchParams.get('statut'))
    if (statut !== 'toutes' && !['nouvelle', 'lue', 'traitee'].includes(statut)) return fin({ ok: false, ...enTete, erreur: statut }, 400, null, statut)
    const limite = Math.min(Math.max(Number(url.searchParams.get('limite')) || 50, 1), 200)
    try {
      const notes = await listerNotes('vers_tab', statut as 'nouvelle', limite)
      return fin({
        ok: true, ...enTete,
        libelle: `Notes pour Tab (${statut === 'toutes' ? 'toutes' : statut})`,
        donnees: { notes },
        notes: ['Une note lue : POST /notes/<note_id>/lu. Pour écrire à Claude : POST /notes { sujet, texte, projet }.'],
      }, 200, notes.length)
    } catch (err) {
      const raison = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() ?? '' : String(err)
      return fin({ ok: false, ...enTete, erreur: 'Lecture des notes impossible pour l\'instant.' }, 502, null, raison)
    }
  }
  // Les images de Belrive deposees par ChatGPT (25/10/2026) : la liste, et une URL signee de 5 minutes.
  if (nom === 'images-belrive') {
    const id = chemin[1]?.replace(/^img:/i, '').toLowerCase()
    if (!(chemin.length === 1 || (chemin.length === 3 && chemin[2] === 'url' && id && estUuid(id)))) {
      return fin({ ok: false, ...enTete, erreur: 'Routes : /images-belrive (la liste) ou /images-belrive/<image_id>/url (une URL signée de 5 minutes).' }, 404, null, 'route inconnue')
    }
    const lire = <T,>(f: (db: Executeur) => Promise<T>) => prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('set transaction read only')
      await tx.$executeRawUnsafe(`set local statement_timeout = '8000ms'`)
      return f(tx)
    }, { maxWait: 8000, timeout: 20000 })
    try {
      if (chemin.length === 1) {
        const limite = Math.min(Math.max(Number(url.searchParams.get('limite')) || 50, 1), 200)
        const images = await lire((db) => listerImagesBelrive(db, limite))
        return fin({
          ok: true, ...enTete,
          libelle: 'Images de Belrive déposées par ChatGPT (les plus récentes d\'abord)',
          sources: ['cockpit_perso_images (bucket privé belrive-images)'],
          donnees: {
            images: images.map((i) => ({
              id: `img:${i.image_id}`, titre: i.titre, role: i.role, nom_fichier: i.nom_fichier, type: i.mime,
              taille_octets: i.taille, origine: i.origine, depose_le: i.depose_le,
            })),
          },
          notes: ['Pour voir une image : GET /images-belrive/<image_id>/url (URL signée, 5 minutes). ChatGPT cite ces ids (img:...) dans ses notes du projet belrive.'],
        }, 200, images.length)
      }
      const image = await lire((db) => lireImageBelrive(db, id!))
      if (!image) return fin({ ok: false, ...enTete, erreur: 'Image introuvable.' }, 404, null, 'image introuvable')
      const signee = await urlSigneeImage(image.chemin, image.nom_fichier)
      if (!signee) return fin({ ok: false, ...enTete, erreur: 'Fichier introuvable dans le stockage.' }, 404, null, 'objet absent')
      return fin({
        ok: true, ...enTete,
        libelle: `Image : ${image.titre}`,
        donnees: {
          id: `img:${image.image_id}`, titre: image.titre, role: image.role, nom_fichier: image.nom_fichier, type: image.mime,
          taille_octets: image.taille, depose_le: image.depose_le, url: signee.url, expire_le: signee.expire_le,
        },
        notes: ['L\'URL expire dans 5 minutes : redemande-la plutôt que de la garder.'],
      }, 200, 1)
    } catch (err) {
      const raison = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() ?? '' : String(err)
      return fin({ ok: false, ...enTete, erreur: 'Lecture des images impossible pour l\'instant.' }, 502, null, raison.slice(0, 300))
    }
  }
  if (nom === 'generer-post') {
    return fin({ ok: false, ...enTete, erreur: 'generer-post se demande en POST.' }, 405, null)
  }
  const lecture = nom === 'donnees' ? { f: null, defaut: 'tout' as DefautPeriode } : LECTURES[nom]
  if (!lecture || (nom === 'donnees' && chemin.length !== 2) || (nom !== 'donnees' && chemin.length !== 1)) {
    return fin({ ok: false, ...enTete, erreur: `Route inconnue : ${route}. La liste : /api/tab/v1/aide.` }, 404, null, 'route inconnue')
  }

  const aujourdhui = jourParis()
  const periode = lirePeriode(url.searchParams, lecture.defaut, aujourdhui)
  if (typeof periode === 'string') return fin({ ok: false, ...enTete, erreur: periode }, 400, null, periode)
  const pag = lirePagination(url.searchParams)
  if (typeof pag === 'string') return fin({ ok: false, ...enTete, erreur: pag }, 400, null, pag)

  try {
    const sortie = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('set transaction read only')
      await tx.$executeRawUnsafe(`set local statement_timeout = '8000ms'`)
      const c: Ctx = { tx, periode, pag, aujourdhui, params: url.searchParams }
      return nom === 'donnees' ? donnees(c, chemin[1]) : lecture.f!(c)
    }, { maxWait: 8000, timeout: 45000 })
    const statut = sortie.statut ?? 200
    const corps = {
      ok: statut === 200,
      ...enTete,
      libelle: sortie.libelle,
      ...(lecture.defaut === 'tout' && !url.searchParams.get('du') && !url.searchParams.get('au') ? {} : { periode }),
      sources: sortie.sources,
      donnees: sortie.donnees,
      ...(sortie.pagination ? { pagination: sortie.pagination } : {}),
      ...(sortie.notes?.length ? { notes: sortie.notes } : {}),
    }
    return fin(corps, statut, sortie.lignes, statut === 200 ? undefined : String((sortie.donnees as { erreur?: string }).erreur ?? ''))
  } catch (err) {
    const raison = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() ?? '' : String(err)
    console.error(`[tab] ${route}`, raison.slice(0, 300))
    const delai = /statement timeout|canceling statement/i.test(raison)
    return fin({
      ok: false, ...enTete,
      erreur: delai ? 'Lecture trop longue (plus de 8 secondes) : resserre la période ou les filtres.' : 'Lecture impossible pour l\'instant (erreur de la base). Réessaie dans un instant.',
      detail: raison.slice(0, 200),
    }, delai ? 504 : 502, null, raison)
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ chemin?: string[] }> }) {
  const debut = Date.now()
  const url = new URL(req.url)
  const chemin = await cheminDe(ctx)
  const route = `/${chemin.join('/')}`
  const ip = ipDe(req)
  const corps = await req.json().catch(() => null) as Record<string, unknown> | null
  const parametres = parametresJournal(url, corps)

  const verdict = await verifierCle(req.headers.get('authorization'))
  if (!verdict.ok) {
    await journaliser({ cleId: verdict.cleId, route, parametres, statut: verdict.status, dureeMs: Date.now() - debut, lignes: null, ip, erreur: verdict.erreur })
    return repondre({ ok: false, erreur: verdict.erreur }, verdict.status)
  }
  const fin = async (c: Record<string, unknown>, statut: number, lignes: number | null, erreur?: string) => {
    const duree = Date.now() - debut
    await journaliser({ cleId: verdict.cleId, route, parametres, statut, dureeMs: duree, lignes, ip, erreur })
    return repondre({ ...c, route, genere_le: new Date().toISOString(), duree_ms: duree }, statut)
  }
  // L'espace perso (20/10/2026) : Tab ecrit une note pour Claude, ou marque lue une note de Claude.
  if (route === '/notes') {
    const note = lireNoteEntrante(corps)
    if (typeof note === 'string') return fin({ ok: false, erreur: note, aide: `${url.origin}/api/tab/v1/aide` }, 400, null, note)
    // (29/10, securite des bots) Une note qui demande un geste sensible, ou qui
    // porte du texte cache, est marquee « à vérifier » (sujet et premiere
    // ligne), jamais bloquee ; le texte cache y est rendu visible, et Brice est
    // prevenu avec la citation. Claude ne fait jamais un geste sensible sur la
    // foi d'une note (D:\CLAUDE.md, section securite).
    const marquee = marquerNote({ sujet: note.sujet, texte: note.texte })
    try {
      const creee = await creerNote('vers_claude', 'tab', { ...note, sujet: marquee.sujet, texte: marquee.texte })
      const brice = await prevenirBrice(creee)
      if (marquee.analyse.suspect) {
        await alerterBriceSecurite({
          source: 'API de Tab, note pour Claude', qui: `note ${creee.note_id.slice(0, 8)}`, analyse: marquee.analyse,
          suite: 'La note est enregistrée, marquée « à vérifier », le texte caché rendu visible.',
        })
      }
      return fin({
        ok: true, libelle: 'Note pour Claude enregistrée', donnees: { note: creee },
        notes: [brice ? 'Brice est prévenu sur Telegram.' : 'Brice n\'a pas pu être prévenu sur Telegram (la note est bien enregistrée).',
          'Claude la lit au démarrage de sa prochaine session.',
          ...(marquee.aVerifier ? ['Elle est marquée « à vérifier » : elle demande un geste sensible ou porte du texte caché. Claude ne fera ce geste qu\'avec l\'accord de Brice.'] : [])],
      }, 201, 1)
    } catch (err) {
      const raison = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() ?? '' : String(err)
      return fin({ ok: false, erreur: 'Note non enregistrée (erreur de la base). Réessaie dans un instant.' }, 502, null, raison)
    }
  }
  if (chemin.length === 3 && chemin[0] === 'notes' && chemin[2] === 'lu') {
    if (!estUuid(chemin[1])) return fin({ ok: false, erreur: 'Identifiant de note invalide (uuid attendu).' }, 400, null, 'id invalide')
    try {
      const note = await marquerLueParTab(chemin[1])
      if (!note) return fin({ ok: false, erreur: 'Note introuvable parmi les notes pour Tab.' }, 404, null, 'note introuvable')
      return fin({ ok: true, libelle: 'Note marquée lue', donnees: { note } }, 200, 1)
    } catch (err) {
      const raison = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() ?? '' : String(err)
      return fin({ ok: false, erreur: 'Écriture impossible pour l\'instant.' }, 502, null, raison)
    }
  }
  if (route !== '/generer-post') return fin({ ok: false, erreur: `${route} : seules /generer-post, /notes et /notes/<id>/lu acceptent POST. Les lectures sont en GET.` }, 405, null)

  const demande = lireDemandeGeneration(corps)
  if (typeof demande === 'string') return fin({ ok: false, erreur: demande, aide: `${url.origin}/api/tab/v1/aide` }, 400, null, demande)

  // Les brouillons de Tab sont ranges au nom de Brice (son compte de l'allowlist du cockpit).
  const brice = await prisma.$queryRaw<{ user_id: string }[]>`
    select user_id::text as user_id from public.cockpit_allowlist where label = 'Brice' limit 1`
  if (!brice[0]) return fin({ ok: false, erreur: 'Compte de Brice introuvable dans le cockpit.' }, 503, null)

  const r = await genererPost(demande, brice[0].user_id, 'tab')
  if (!r.ok) return fin({ ok: false, erreur: r.erreur }, r.status, null, r.erreur)
  return fin({
    ok: true,
    libelle: 'Brouillon de post (rien n\'est publié)',
    id: r.id,
    contenu: r.contenu,
    envoyees: r.envoyees,
    cout_euros: Math.round(r.cout_micros / 10_000) / 100,
    notes: [
      'Le brouillon est rangé dans le cockpit (onglet Création > Génération) : Brice peut le noter (publié tel quel, retouché, jeté).',
      'Refaire : même corps avec parent_id = id. Retoucher : parent_id + consigne.',
    ],
  }, 200, 1)
}
