// Des DROITS SIMULES sur l'academie, pour essayer trouver_cours « connecte »
// sans vrai compte ni Stripe (19/10/2026) : les lignes 'base' de SQL_ACCES
// (offres compte gratuit et Live Club, lues en base), passees a la VRAIE
// preparerDroits (src/lib/academie/pur.ts) avec le Live Club au choix.
// Utilise par scripts/eval-fuites.mjs (cas K06) et scripts/verifier-trouver-cours.mjs.
// Les modules .ts doivent etre importables (crochet de resolution de l'appelant).

const COMPTE_FICTIF = '00000000-0000-0000-0000-000000000000'

/** liveClub : 'oui' (membre Live Club actif) ou 'non' (compte gratuit seul). */
export async function droitsSimules(liveClub = 'oui') {
  const { prisma } = await import('../src/lib/db.ts')
  const { SQL_ACCES } = await import('../src/lib/academie/requetes.ts')
  const { preparerDroits } = await import('../src/lib/academie/pur.ts')
  const lignes = (await prisma.$queryRawUnsafe(SQL_ACCES, COMPTE_FICTIF, []))
    .filter(l => l.origine === 'base')
    .map(l => ({ origine: l.origine, source: l.source, slug: l.slug, ouvreTout: l.ouvre_tout === true, moduleId: l.module_id, sectionId: l.section_id }))
  return preparerDroits({ admin: false, etm: false, liveClub, secoursEssai: false, lignes })
}
