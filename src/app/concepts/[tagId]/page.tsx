import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import CanvasShell from '@/components/CanvasShell'
import ConceptStudy, { type DonneesConcept } from '@/components/ConceptStudy'
import { parseBlockContent } from '@/lib/utils'

// Toujours frais : un tag posé il y a dix secondes doit apparaître ici.
export const dynamic = 'force-dynamic'

/** Formaté côté serveur : même chaîne rendue au serveur et au client, donc pas
 *  d'écart d'hydratation selon la locale du navigateur. */
function jour(d: Date | null): string | null {
  if (!d) return null
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * 0.2 — « Étudier un concept ». Un élève arrive ici depuis `/concepts` et veut
 * trois choses (demande de Brice, 31/08) : toutes ses notes sur ce concept, tous
 * ses screenshots de séance, et des stats sur le résultat d'usage et la notation.
 *
 * Deux sources de liens, à réunir sans privilégier l'une : `NoteTag` (la note
 * entière porte le concept) et `MessageTag` (un bloc le porte). Ce n'est pas un
 * détail d'implémentation : mesuré le 31/08, les deux membres qui taguent le plus
 * ont des habitudes OPPOSÉES — l'un tague 89 blocs et 4 notes, l'autre 51 notes et
 * 26 blocs. Ne lire qu'une des deux tables viderait l'écran pour l'un des deux.
 */
export default async function PageConcept({ params }: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  const userId = user.id

  // ⚠️ Doctrine sécurité du journal : tout résolveur est borné au userId de la
  // session. Le tag d'un autre membre rend 404, jamais ses données.
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, userId },
    include: {
      notes: { select: { noteId: true } },
      messages: {
        select: {
          message: {
            select: { id: true, noteId: true, type: true, content: true, tradeRef: true, order: true },
          },
        },
      },
    },
  })
  if (!tag) notFound()

  const notesDirectes = new Set(tag.notes.map(n => n.noteId))
  const blocs = tag.messages.map(m => m.message)
  const idsSeances = new Set<string>([...notesDirectes, ...blocs.map(b => b.noteId)])

  // Les notes supprimées sont exclues ici — et leurs blocs le sont donc aussi
  // plus bas, sinon la galerie afficherait des captures d'une séance effacée.
  const seancesBrutes = await prisma.note.findMany({
    where: { id: { in: [...idsSeances] }, userId, deletedAt: null },
    select: { id: true, title: true, favicon: true, createdAt: true, firstSyncAt: true, trades: true },
  })
  const seanceParId = new Map(seancesBrutes.map(n => [n.id, n]))

  const annotations = await prisma.annotation.findMany({
    where: { userId, noteId: { in: [...seanceParId.keys()] } },
    select: { noteId: true, grade: true, causeCategory: true },
  })

  // ── Les chiffres ──────────────────────────────────────────────────────────
  // Le résultat est lu dans `Note.trades`, du JSON (source de vérité extension) :
  // pas de jointure SQL possible, on lit et on agrège ici. Et l'attribution se
  // fait à la SÉANCE, pas au trade : mesuré le 31/08, l'intersection entre les
  // blocs tagués et les blocs rattachés à un trade est exactement 0. Dire par
  // quel chemin le chiffre est calculé est donc une obligation, pas une nuance —
  // c'est le rôle du libellé côté composant.
  const resultats = { gain: 0, perte: 0, be: 0 }
  for (const n of seancesBrutes) {
    const segments = Array.isArray(n.trades) ? n.trades : []
    for (const s of segments) {
      if (!s || typeof s !== 'object') continue
      const outcome = (s as { outcome?: string }).outcome
      if (outcome === 'gain') resultats.gain++
      else if (outcome === 'perte') resultats.perte++
      else if (outcome === 'be') resultats.be++
    }
  }

  const notation = { A: 0, B: 0, C: 0 } as Record<string, number>
  const causes = { technique: 0, connaissance: 0, emotionnel: 0 } as Record<string, number>
  const gradesParSeance = new Map<string, string[]>()
  for (const a of annotations) {
    if (notation[a.grade] !== undefined) notation[a.grade]++
    if (a.causeCategory && causes[a.causeCategory] !== undefined) causes[a.causeCategory]++
    if (a.noteId) {
      if (!gradesParSeance.has(a.noteId)) gradesParSeance.set(a.noteId, [])
      gradesParSeance.get(a.noteId)!.push(a.grade)
    }
  }

  // ── Galerie et références ────────────────────────────────────────────────
  const captures: DonneesConcept['captures'] = []
  const blocsTexteParSeance = new Map<string, { id: string; texte: string; tradeRef: string | null }[]>()
  for (const b of blocs.sort((x, y) => x.order - y.order)) {
    const seance = seanceParId.get(b.noteId)
    if (!seance) continue
    const { imgSrc, text } = parseBlockContent(b.content, b.type)
    if (imgSrc) {
      captures.push({
        id: b.id, src: imgSrc, legende: text.slice(0, 120),
        seanceId: seance.id, seanceTitre: seance.title, date: jour(seance.createdAt ?? seance.firstSyncAt),
      })
      continue
    }
    if (!text.trim()) continue // un bloc vide n'apprend rien
    if (!blocsTexteParSeance.has(b.noteId)) blocsTexteParSeance.set(b.noteId, [])
    blocsTexteParSeance.get(b.noteId)!.push({ id: b.id, texte: text, tradeRef: b.tradeRef })
  }

  const seances: DonneesConcept['seances'] = [...seanceParId.values()]
    .map(n => ({
      id: n.id,
      titre: n.title,
      favicon: n.favicon,
      date: jour(n.createdAt ?? n.firstSyncAt),
      horodatage: (n.createdAt ?? n.firstSyncAt).getTime(),
      porteLeConcept: notesDirectes.has(n.id),
      grades: gradesParSeance.get(n.id) ?? [],
      blocsTexte: blocsTexteParSeance.get(n.id) ?? [],
    }))
    // Antichronologique : la séance la plus récente d'abord.
    .sort((a, b) => b.horodatage - a.horodatage)

  // ── Les concepts voisins ─────────────────────────────────────────────────
  // Même calcul que `/concepts/page.tsx` : les autres concepts qui partagent une
  // séance avec celui-ci. Volume de la taxonomie mesuré à 129 étiquettes, donc un
  // balayage complet reste sans conséquence.
  const autres = await prisma.tag.findMany({
    where: { userId, id: { not: tagId } },
    select: {
      id: true, name: true, color: true,
      notes: { select: { noteId: true } },
      messages: { select: { message: { select: { noteId: true } } } },
    },
  })
  const voisins = autres
    .map(t => {
      const ses = new Set<string>(t.notes.map(n => n.noteId))
      for (const m of t.messages) ses.add(m.message.noteId)
      let partagees = 0
      for (const id of ses) if (seanceParId.has(id)) partagees++
      return { id: t.id, name: t.name, color: t.color, partagees }
    })
    .filter(v => v.partagees > 0)
    .sort((a, b) => b.partagees - a.partagees)
    .slice(0, 8)

  // ── « Dans la base » — la seule lecture inter-membres de l'app ───────────
  // ⚠️ EXCEPTION DÉLIBÉRÉE à la doctrine « tout résolveur borné au userId de la
  // session ». Elle est tenue dans un cadre strict, à ne pas élargir sans y
  // repenser : il ne remonte d'ici que des NOMBRES. Jamais un nom, jamais un
  // titre de note, jamais un verbatim, jamais un userId. Rien de ce qui sort de
  // ce bloc ne permet de savoir QUI a écrit quoi.
  //
  // Deux seuils, et le premier argument n'est pas la vie privée mais la QUALITÉ :
  // une note posée par une seule personne n'est pas une tendance, c'est une
  // anecdote — la servir comme un enseignement transformerait la mauvaise journée
  // de quelqu'un en vérité générale. Que ça protège aussi l'anonymat vient après.
  const SEUIL_MEMBRES = 2   // en dessous, on ne dit même pas combien ils sont
  const SEUIL_NOTATION = 3  // en dessous, pas de répartition A/B/C collective

  // Le vocabulaire est partagé, la taxonomie ne l'est pas : chaque membre a sa
  // propre ligne `Tag`. La clé de rapprochement est donc le NOM, insensible à la
  // casse (`tp` et `TP` coexistaient encore ce matin).
  const memeConcept = await prisma.tag.findMany({
    where: { name: { equals: tag.name, mode: 'insensitive' } },
    select: {
      userId: true,
      notes: { select: { noteId: true } },
      messages: { select: { message: { select: { noteId: true } } } },
    },
  })
  const membres = new Set(memeConcept.map(t => t.userId))
  let notationCollective: { A: number; B: number; C: number } | null = null
  if (membres.size >= SEUIL_NOTATION) {
    const seancesCollectives = new Set<string>()
    for (const t of memeConcept) {
      for (const n of t.notes) seancesCollectives.add(n.noteId)
      for (const m of t.messages) seancesCollectives.add(m.message.noteId)
    }
    const annosCollectives = await prisma.annotation.findMany({
      where: { noteId: { in: [...seancesCollectives] }, note: { deletedAt: null } },
      select: { grade: true }, // ← rien d'autre ne doit jamais être sélectionné ici
    })
    const c = { A: 0, B: 0, C: 0 } as Record<string, number>
    for (const a of annosCollectives) if (c[a.grade] !== undefined) c[a.grade]++
    notationCollective = { A: c.A, B: c.B, C: c.C }
  }

  // ── La fiche du concept (lot 5) ──────────────────────────────────────────
  // Clé = le nom normalisé, pas le tagId : la fiche vaut pour tous ceux qui
  // emploient le mot, alors que chaque membre a sa propre ligne `Tag`.
  const ficheBrute = await prisma.conceptFiche.findUnique({
    where: { nomNormalise: tag.name.trim().toLowerCase() },
  })

  type Tip = { angle: string; texte: string; source: string }
  let fiche: DonneesConcept['fiche'] = null
  if (ficheBrute && ficheBrute.statut !== 'rejete') {
    const tips = (Array.isArray(ficheBrute.tips) ? ficheBrute.tips : []) as unknown as Tip[]
    // PERSONNALISATION (SPEC §11.7b) : la fiche est la même pour tout le monde —
    // c'est ce qui la rend relisable par Brice — mais l'ORDRE des tips dépend de
    // ce que CE membre a posé. Qui collectionne les C sur ce concept voit d'abord
    // l'erreur fréquente ; qui aligne les A voit d'abord le geste juste.
    const enPeine = notation.C > notation.A
    const ordonnes = [...tips].sort((a, b) => {
      const poids = (t: Tip) => (enPeine ? (t.angle === 'friction' ? 0 : 1) : (t.angle === 'geste' ? 0 : 1))
      return poids(a) - poids(b)
    })
    fiche = {
      definition: ficheBrute.definition,
      tips: ordonnes.filter(t => t.source), // un tip sans source ne s'affiche pas
      sources: (Array.isArray(ficheBrute.sources) ? ficheBrute.sources : []) as unknown as { oeuvre: string; reperage: string }[],
      corrigee: ficheBrute.corrigee,
      cadre: enPeine ? 'friction' : 'geste',
    }
  }

  const donnees: DonneesConcept = {
    fiche,
    collectif: {
      membres: membres.size >= SEUIL_MEMBRES ? membres.size : null,
      notation: notationCollective,
    },
    tag: { id: tag.id, name: tag.name, color: tag.color, category: tag.category },
    seances,
    captures,
    voisins,
    stats: {
      seances: seances.length,
      blocs: [...blocsTexteParSeance.values()].reduce((n, l) => n + l.length, 0),
      captures: captures.length,
      resultats,
      notation: { A: notation.A, B: notation.B, C: notation.C },
      causes: { technique: causes.technique, connaissance: causes.connaissance, emotionnel: causes.emotionnel },
    },
  }

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}>
      <ConceptStudy donnees={donnees} />
    </CanvasShell>
  )
}
