// POST /api/capture/analyse — 2e temps : l'ÉTUDE.
//
// Relit la note dans le cadre de l'académie et écrit la lecture DANS la note.
// Réservée aux paliers payants, et déclenchée par un geste explicite de
// l'élève (bouton « Étudier la note »), jamais automatiquement.
//
// Trois raisons à ce découpage, décidé avec Brice le 30/08/2026 :
//  - la lecture n'est voulue qu'une fois sur cinq, la payer sur chaque capture
//    reviendrait à brûler du budget pour du bruit ;
//  - la capture reste instantanée en séance, l'attente se déplace sur un geste
//    choisi ;
//  - l'étude peut être demandée DEUX SEMAINES PLUS TARD, au moment de la
//    relecture, qui est justement le moment où elle vaut le plus.
//
// Elle relit le contenu BRUT stocké dans la note, pas le résumé du secrétaire :
// au banc, la meilleure trouvaille d'Opus venait de la lecture du tableau brut,
// qu'un résumé aurait lissée.
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { aiErrorMessage } from '@/lib/ai'
import { resoudreNiveauIA } from '@/lib/ia-niveau'
import { verifierBudget } from '@/lib/ia-budget'
import { appelerCapture, MAX_CARACTERES_CONTENU } from '@/lib/capture-appel'
import { familleDeLUrl, FAMILLES_AVEC_IMAGE, type SortieEtude } from '@/lib/capture-prompts'
import { resoudreModeleEtude } from '@/lib/ia-modeles'

// L'étude réfléchit : bien au-delà des 10 s par défaut de Vercel.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const acces = await resoudreNiveauIA(userId)
  if (!acces.etude) {
    // Le niveau libre voit le bouton et reçoit ce message : verrouillé, avec
    // la raison. Plus honnête qu'un lien commercial glissé dans une note.
    return NextResponse.json(
      {
        error: 'etude_reservee',
        niveau: acces.niveau,
        message:
          acces.niveau === 'libre'
            ? 'L’étude de tes notes fait partie du Carnet Premium. La capture, elle, reste à toi.'
            : 'L’étude est réservée aux membres Ao Knowledge.',
      },
      { status: 403 }
    )
  }

  const budget = await verifierBudget(userId, acces.niveau, acces.email)
  if (!budget.autorise) {
    return NextResponse.json(
      { error: budget.motif, message: budget.message, part: budget.part },
      { status: 429 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const url: string | null = typeof body.url === 'string' ? body.url : null
  const contenu: string = typeof body.contenu === 'string' ? body.contenu : ''
  const image: string | null = typeof body.image === 'string' ? body.image : null
  const noteId: string | null = typeof body.noteId === 'string' ? body.noteId : null

  if (contenu.trim().length < 40 && !image) {
    return NextResponse.json(
      { error: 'contenu_insuffisant', message: 'Cette note est trop maigre pour être étudiée.' },
      { status: 422 }
    )
  }

  const famille = familleDeLUrl(url)
  const imageUtile = FAMILLES_AVEC_IMAGE.includes(famille) ? image : null

  // Le client PROPOSE un modèle (choix du sélecteur), le serveur DISPOSE : une
  // préférence que le palier ne couvre pas retombe sur le défaut du palier.
  const modele = resoudreModeleEtude(
    typeof body.modele === 'string' ? body.modele : null,
    acces.niveau
  )

  try {
    const r = await appelerCapture<SortieEtude>({
      userId,
      niveau: acces.niveau,
      famille,
      temps: 'etude',
      contenu,
      langue: typeof body.langue === 'string' ? body.langue : null,
      image: imageUtile,
      modele,
    })
    return NextResponse.json({
      ...r.sortie,
      noteId,
      famille,
      avecImage: r.avecImage,
      modele: r.modele,
      tronque: contenu.length > MAX_CARACTERES_CONTENU,
      budget: { part: budget.part, sansPlafond: budget.sansPlafond, niveau: acces.niveau, etude: true },
    })
  } catch (err) {
    console.error('[capture/analyse]', err)
    return NextResponse.json(
      { error: 'ia_indisponible', message: aiErrorMessage(err, 'ANTHROPIC_API_KEY_CARNET') },
      { status: 502 }
    )
  }
}
