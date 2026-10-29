// Les documents de Pilotage côté serveur (brief D1, 30/10/2026) : le texte des
// PDF, la lecture par l'IA, la limite du jour, le coffre des originaux. Les
// décisions sont dans les modules purs (documents-pilotage.ts,
// documents-pilotage-ia.ts) ; ici on lit et on écrit, TOUJOURS borné au userId
// du jeton.
//
// Le coffre : bucket PRIVÉ documents-pilotage (aucune policy : seul ce serveur
// y lit et y écrit, avec la clé de service ; le membre ouvre un original par
// une URL signée de 10 minutes), chemin <userId>/<id>-<nom nettoyé>, 200 Mo
// par membre ; la table DocumentPilotage est fermée (RLS + revoke), le journal
// y accède en postgres. Migration : 20261031090000_documents_pilotage.sql.

import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { aiClient, aiErrorMessage, AI_MODEL, logAiUsage } from '@/lib/ai'
import { appelsDuPosteDepuis, estSansPlafond } from '@/lib/ia-budget'
import {
  BUCKET_DOCUMENTS, MESSAGE_COFFRE_PLEIN, cheminDocument, coffreAccepte, debutJourParis, etatQuota, typeCoffre,
  type Lecture, type Preparation,
} from '@/lib/documents-pilotage'
import {
  DELAI_IA_MS, MAX_JETONS_IA, OUTIL_DOCUMENT, PROMPT_DOCUMENT, contenuPourIA, lectureDepuisIA,
} from '@/lib/documents-pilotage-ia'

type PreparationIA = Exclude<Preparation, { lecture: unknown }>

let client: SupabaseClient | null = null

function stockage(): SupabaseClient | null {
  if (client) return client
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !cle) return null
  client = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

// ── Lire ─────────────────────────────────────────────────────────────────────

/**
 * Le texte d'un PDF (unpdf : PDF.js sans worker ni dépendance native, fait
 * pour les fonctions serverless). Null si le PDF ne se lit pas (chiffré,
 * abîmé) : l'appelant le regardera alors comme une image.
 */
export async function extraireTextePdf(octets: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    // Une copie : PDF.js peut s'approprier le tampon, et l'original part ensuite au coffre.
    const pdf = await getDocumentProxy(new Uint8Array(octets))
    const { text } = await extractText(pdf, { mergePages: true })
    return typeof text === 'string' ? text : null
  } catch (err) {
    console.error('[pilotage/documents] texte du PDF illisible', err instanceof Error ? err.message : err)
    return null
  }
}

async function emailDuMembre(userId: string): Promise<string | null> {
  try {
    const lignes = await prisma.$queryRaw<{ email: string | null }[]>`
      select email from auth.users where id = ${userId}::uuid limit 1
    `
    return lignes[0]?.email?.toLowerCase() ?? null
  } catch {
    return null
  }
}

/** Les lectures par l'IA du membre aujourd'hui (Europe/Paris) et la limite ; l'équipe (estSansPlafond) n'en a pas. */
export async function quotaDuMembre(userId: string) {
  const [email, lus] = await Promise.all([
    emailDuMembre(userId),
    appelsDuPosteDepuis(userId, 'document', debutJourParis(new Date())),
  ])
  return etatQuota(lus, estSansPlafond(email))
}

/**
 * Une lecture par l'IA : un prompt, un outil forcé, le texte d'abord ou le
 * document en vision. Le coût est journalisé (AiUsage, poste 'document') : il
 * compte pour la limite du jour dès que l'appel a abouti.
 */
export async function lireParIA(
  userId: string, prep: PreparationIA, nom: string, data: string,
): Promise<{ lecture: Lecture } | { erreur: string; statut: number; indisponible?: boolean }> {
  let ia
  try {
    ia = aiClient('pilotage')
  } catch (err) {
    return { erreur: err instanceof Error ? err.message : 'Lecture indisponible', statut: 503, indisponible: true }
  }
  try {
    const model = AI_MODEL.pilotage
    const reponse = await ia.messages.create({
      model,
      max_tokens: MAX_JETONS_IA,
      system: [{ type: 'text', text: PROMPT_DOCUMENT, cache_control: { type: 'ephemeral' } }],
      tools: [OUTIL_DOCUMENT],
      // Forcé : une structure, pas une réponse rédigée à reparser.
      tool_choice: { type: 'tool', name: OUTIL_DOCUMENT.name },
      messages: [{ role: 'user', content: contenuPourIA(prep, nom, data) }],
    } as never, { timeout: DELAI_IA_MS, maxRetries: 0 })
    await logAiUsage(userId, 'pilotage', model, reponse.usage, null, { usage: 'document' })

    const outil = reponse.content.find((c: { type: string }) => c.type === 'tool_use') as { input?: unknown } | undefined
    const lecture = lectureDepuisIA(outil?.input, {
      methode: prep.ia, origine: prep.origine, coupe: prep.ia === 'texte' && prep.coupe,
    })
    if (reponse.stop_reason === 'max_tokens') {
      lecture.remarque = `Lecture coupée : le document est trop long pour une seule lecture. ${lecture.remarque}`.trim()
      lecture.confiance = Math.min(lecture.confiance, 0.5)
    }
    return { lecture }
  } catch (err) {
    console.error('[pilotage/documents/lire]', err)
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return { erreur: "Document trop long pour être lu d'un coup : découpe-le en quelques pages, ou dépose l'export CSV s'il existe.", statut: 504 }
    }
    return { erreur: aiErrorMessage(err, 'ANTHROPIC_API_KEY_PILOTAGE'), statut: 502 }
  }
}

// ── Le coffre ────────────────────────────────────────────────────────────────

export interface DocumentGarde { id: string; nom: string; taille: number; type: string }

const jourOuNul = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00.000Z`) : null)

/**
 * Garde l'original : 200 Mo par membre (refus clair au-delà), envoi dans le
 * bucket puis la ligne. Si la ligne ne s'écrit pas, l'objet est retiré : pas
 * d'original orphelin.
 */
export async function garderDocument(
  userId: string, o: { nom: string; mime: string; octets: Uint8Array; lecture: Lecture },
): Promise<{ document: DocumentGarde } | { erreur: string }> {
  const s = stockage()
  if (!s) {
    console.error('[pilotage/documents] coffre indisponible : SUPABASE_SERVICE_ROLE_KEY absente')
    return { erreur: "Le coffre est indisponible pour le moment : l'original n'a pas été gardé." }
  }
  const taille = o.octets.byteLength
  const deja = await prisma.documentPilotage.aggregate({ where: { userId }, _sum: { taille: true } })
  if (!coffreAccepte(deja._sum.taille ?? 0, taille)) return { erreur: MESSAGE_COFFRE_PLEIN }

  const id = randomUUID()
  const chemin = cheminDocument(userId, id, o.nom)
  const type = typeCoffre(o.mime)
  const { error } = await s.storage.from(BUCKET_DOCUMENTS).upload(chemin, Buffer.from(o.octets), { contentType: type, upsert: false })
  if (error) {
    console.error('[pilotage/documents] original non garde', error.message)
    return { erreur: "Le coffre n'a pas pris l'original : redépose-le plus tard." }
  }
  try {
    await prisma.documentPilotage.create({
      data: {
        id, userId, nom: o.nom, type, taille, chemin,
        lectureType: o.lecture.type,
        compteId: o.lecture.compteId,
        periodeDebut: jourOuNul(o.lecture.periode?.debut),
        periodeFin: jourOuNul(o.lecture.periode?.fin),
      },
    })
  } catch (err) {
    console.error('[pilotage/documents] ligne non ecrite, original retire', err)
    await s.storage.from(BUCKET_DOCUMENTS).remove([chemin]).catch(() => null)
    return { erreur: "Le coffre n'a pas pris l'original : redépose-le plus tard." }
  }
  return { document: { id, nom: o.nom, taille, type } }
}

const jour = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

/** Les originaux du membre, du plus récent au plus ancien, avec le total et les octets gardés. */
export async function listerDocuments(userId: string) {
  const [lignes, somme] = await Promise.all([
    prisma.documentPilotage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: { id: true, nom: true, type: true, taille: true, lectureType: true, compteId: true, periodeDebut: true, periodeFin: true, createdAt: true },
    }),
    prisma.documentPilotage.aggregate({ where: { userId }, _sum: { taille: true }, _count: { _all: true } }),
  ])
  return {
    documents: lignes.map(d => ({
      id: d.id,
      nom: d.nom,
      type: d.type,
      taille: d.taille,
      lectureType: d.lectureType,
      compteId: d.compteId,
      periode: d.periodeDebut || d.periodeFin ? { debut: jour(d.periodeDebut ?? d.periodeFin), fin: jour(d.periodeFin ?? d.periodeDebut) } : null,
      createdAt: d.createdAt.toISOString(),
    })),
    total: somme._count._all,
    octets: somme._sum.taille ?? 0,
  }
}

/** Une URL signée de 10 minutes vers l'original, seulement s'il est au membre. */
export async function lienDocument(userId: string, id: string): Promise<{ url: string } | { absent: true } | { erreur: string }> {
  const document = await prisma.documentPilotage.findFirst({ where: { id, userId }, select: { chemin: true } })
  if (!document) return { absent: true }
  const s = stockage()
  if (!s) return { erreur: 'Coffre indisponible pour le moment.' }
  const { data, error } = await s.storage.from(BUCKET_DOCUMENTS).createSignedUrl(document.chemin, 600)
  if (error || !data?.signedUrl) {
    console.error('[pilotage/documents] lien non signe', error?.message)
    return { erreur: "L'original ne s'ouvre pas pour le moment." }
  }
  return { url: data.signedUrl }
}

/** Retire l'original puis la ligne. Si le stockage refuse, la ligne reste (on peut réessayer). */
export async function supprimerDocument(userId: string, id: string): Promise<'supprime' | 'absent' | 'erreur'> {
  const document = await prisma.documentPilotage.findFirst({ where: { id, userId }, select: { chemin: true } })
  if (!document) return 'absent'
  const s = stockage()
  if (!s) return 'erreur'
  const { error } = await s.storage.from(BUCKET_DOCUMENTS).remove([document.chemin])
  if (error) {
    console.error('[pilotage/documents] original non retire', error.message)
    return 'erreur'
  }
  await prisma.documentPilotage.deleteMany({ where: { id, userId } })
  return 'supprime'
}
