// POST /api/capture — 1er temps : le SECRÉTAIRE.
//
// Extrait et trie ce que la page dit vraiment. Aucun avis, aucun chiffre
// inventé. Ouvert à tous les paliers, y compris le niveau libre : la capture
// n'est pas ce qui se vend, c'est ce qui doit enfin marcher.
//
// L'extension appelle cette route quand elle le peut et RETOMBE sur ses
// heuristiques dès qu'on répond autre chose que 200. Un refus n'est donc jamais
// une panne pour l'élève, seulement une capture moins bonne. C'est pour ça que
// les codes de refus sont explicites : le client choisit son message.
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { aiErrorMessage } from '@/lib/ai'
import { resoudreNiveauIA } from '@/lib/ia-niveau'
import { verifierBudget } from '@/lib/ia-budget'
import { appelerCapture, MAX_CARACTERES_CONTENU } from '@/lib/capture-appel'
import { familleDeLUrl, FAMILLES_AVEC_IMAGE, type SortieSecretaire } from '@/lib/capture-prompts'
import { resoudreCanvasJournal } from '@/lib/journal-canvas'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const acces = await resoudreNiveauIA(userId)
  if (!acces.capture) {
    return NextResponse.json(
      { error: 'membre_requis', message: 'La capture IA est réservée aux membres Ao Knowledge.' },
      { status: 403 }
    )
  }

  const budget = await verifierBudget(userId, acces.niveau, acces.email)
  if (!budget.autorise) {
    // 429 et non 403 : ce n'est pas un refus de droit, c'est un quota. Le
    // client sait qu'il doit basculer sur ses heuristiques sans rien dire de
    // dramatique à l'élève.
    return NextResponse.json(
      { error: budget.motif, message: budget.message, part: budget.part },
      { status: 429 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const url: string | null = typeof body.url === 'string' ? body.url : null
  const contenu: string = typeof body.contenu === 'string' ? body.contenu : ''
  const image: string | null = typeof body.image === 'string' ? body.image : null

  if (contenu.trim().length < 40 && !image) {
    return NextResponse.json(
      { error: 'contenu_insuffisant', message: 'Rien d’exploitable dans cette page.' },
      { status: 422 }
    )
  }

  const famille = familleDeLUrl(url)
  // L'image ne part que là où elle apporte quelque chose : sur un graphique ou
  // une plateforme, elle contient ce que le DOM n'a pas. Sur un article, elle
  // coûte ~1 200 jetons pour redire le texte qu'on envoie déjà.
  const imageUtile = FAMILLES_AVEC_IMAGE.includes(famille) ? image : null

  // Canvas du journal : la maison LIT ses propres notes. L'extension envoie
  // les ids des cartes visibles, on les résout en contenu réel — de CE compte
  // uniquement (le where userId est la cloison). Le texte d'écran passe en
  // secondaire : il ne portait que des titres tronqués.
  let contenuFinal = contenu
  const journalNoteIds: string[] = Array.isArray(body.journalNoteIds)
    ? body.journalNoteIds.filter((x: unknown): x is string => typeof x === 'string').slice(0, 40)
    : []
  const journalLiens: [string, string][] = Array.isArray(body.journalLiens)
    ? body.journalLiens.filter((l: unknown): l is [string, string] =>
        Array.isArray(l) && l.length === 2 && typeof l[0] === 'string' && typeof l[1] === 'string')
    : []
  if (famille === 'maison' && journalNoteIds.length > 0) {
    try {
      const resolu = await resoudreCanvasJournal(userId, journalNoteIds, journalLiens)
      if (resolu) {
        contenuFinal = `${resolu}\n\n--- Texte visible à l'écran (secondaire, souvent tronqué) ---\n${contenu.slice(0, 2000)}`
      }
    } catch (err) {
      console.error('[capture] résolution canvas journal:', err)
      // On continue avec le texte d'écran : moins bon, jamais bloquant
    }
  }

  try {
    const r = await appelerCapture<SortieSecretaire>({
      userId,
      niveau: acces.niveau,
      famille,
      temps: 'secretaire',
      contenu: contenuFinal,
      langue: typeof body.langue === 'string' ? body.langue : null,
      image: imageUtile,
    })
    return NextResponse.json({
      ...r.sortie,
      famille,
      avecImage: r.avecImage,
      tronque: contenu.length > MAX_CARACTERES_CONTENU,
      // Jauge pour l'élève : une part, jamais un montant. Lui montrer le prix
      // de son propre travail d'étude le ferait arrêter de documenter.
      budget: { part: budget.part, sansPlafond: budget.sansPlafond, niveau: acces.niveau, etude: acces.etude },
    })
  } catch (err) {
    console.error('[capture]', err)
    return NextResponse.json(
      { error: 'ia_indisponible', message: aiErrorMessage(err, 'ANTHROPIC_API_KEY_CARNET') },
      { status: 502 }
    )
  }
}
