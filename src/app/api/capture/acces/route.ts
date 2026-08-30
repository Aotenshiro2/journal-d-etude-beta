// GET /api/capture/acces — ce que l'extension a le droit de faire, et où en
// est la jauge. Sert à AFFICHER : bouton « Étudier la note » actif ou
// verrouillé, jauge de quota. Les routes /api/capture et /api/capture/analyse
// re-vérifient tout côté serveur : un client bidouillé ne contourne rien.
//
// On renvoie une PART consommée (0 à 1), jamais un montant en euros. Montrer à
// un élève le prix de son propre travail d'étude est le meilleur moyen de le
// faire arrêter de documenter, et c'est exactement l'inverse du but.
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { resoudreNiveauIA } from '@/lib/ia-niveau'
import { verifierBudget } from '@/lib/ia-budget'
import { catalogueAffiche, modeleParDefaut, resoudreModeleEtude } from '@/lib/ia-modeles'

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // La préférence de modèle voyage en paramètre : le client la connaît (elle
  // vit dans son stockage local), le serveur dit seulement si elle tient.
  const prefere = req.nextUrl.searchParams.get('modele')

  const acces = await resoudreNiveauIA(userId)
  if (acces.niveau === 'aucun') {
    return NextResponse.json({
      niveau: 'aucun', capture: false, etude: false, part: 1, autorise: false,
      // Le catalogue est renvoyé même aux non-membres : c'est ce qui rend les
      // cadenas parlants au lieu d'afficher un écran vide.
      modeles: catalogueAffiche('aucun', 0, false),
      modeleActif: null,
    })
  }

  const budget = await verifierBudget(userId, acces.niveau, acces.email)
  return NextResponse.json({
    niveau: acces.niveau,
    raison: acces.raison,
    capture: acces.capture,
    etude: acces.etude,
    autorise: budget.autorise,
    motif: budget.motif,
    message: budget.message,
    part: budget.part,
    sansPlafond: budget.sansPlafond,
    modeles: catalogueAffiche(acces.niveau, budget.restantMicros, budget.sansPlafond),
    modeleActif: acces.etude ? resoudreModeleEtude(prefere, acces.niveau) : null,
    modeleDefaut: modeleParDefaut(acces.niveau),
  })
}
