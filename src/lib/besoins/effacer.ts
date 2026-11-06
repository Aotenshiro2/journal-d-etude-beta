// L'EFFACEMENT D'UNE PERSONNE, cote besoins des membres : le serveur
// (finitions du 06/11/2026). Regles pures : effacer-pur.ts. Inventaire qui
// fait foi : docs/EFFACEMENT-DONNEES.md (section 5.3).
//
// Appele par effacement.ts (executerActionEffacement), niveaux 2 et 3, juste
// APRES cockpit_effacer, avec les cibles lues AVANT lui. besoins_effacer
// (migration 20261106180000, role postgres seulement) efface ses demandes
// restantes et ses votes, et rend les chemins des captures que plus aucune
// demande ne nomme ; ils sont retires du bucket prive par la cle de service.
// Ne jette pas : l'issue dit ce qui a ete fait ou ce qui reste a reprendre.
// Jamais un nom, un email, un identifiant ni un chemin dans un log.

import { prisma } from '@/lib/db'
import { messageErreur } from '@/lib/liveclub/pur'
import { retirerCaptures } from './captures'
import { cibleBesoinsVide, fonctionBesoinsAbsente, lireBesoinsEffaces, type CiblesBesoins, type IssueBesoins } from './effacer-pur'

export async function effacerBesoinsDeLaPersonne(c: CiblesBesoins): Promise<IssueBesoins> {
  if (cibleBesoinsVide(c)) return { etat: 'fait', demandes: 0, votes: 0, captures: 0, capturesRestees: [] }
  let brut: string | undefined
  try {
    const lignes = await prisma.$queryRawUnsafe<{ r: string }[]>(
      'select public.besoins_effacer($1::bigint[], $2::uuid[], $3::text[], $4::uuid[])::text as r',
      c.telegram, c.comptes, c.emails, c.membres)
    brut = lignes[0]?.r
  } catch (err) {
    // Le message entier pour reconnaitre l'absence (Prisma met le code plus bas), sa premiere ligne seulement au log.
    if (fonctionBesoinsAbsente(err instanceof Error ? err.message : String(err))) return { etat: 'absente' }
    console.error(`[cockpit/effacement] besoins non effaces : ${messageErreur(err).slice(0, 160)}`)
    return { etat: 'panne' }
  }
  const r = lireBesoinsEffaces(brut)
  if (!r) {
    console.error('[cockpit/effacement] besoins : compte rendu de besoins_effacer illisible')
    return { etat: 'panne' }
  }
  const restees = r.captures.length ? await retirerCaptures(r.captures) : []
  const issue: IssueBesoins = { etat: 'fait', demandes: r.demandes, votes: r.votes, captures: r.captures.length - restees.length, capturesRestees: restees }
  console.log(`[cockpit/effacement] besoins : ${issue.demandes} demande(s), ${issue.votes} vote(s), ${issue.captures} capture(s) effacee(s)`
    + `${restees.length ? `, ${restees.length} capture(s) a retirer a la main` : ''}`)
  return issue
}
