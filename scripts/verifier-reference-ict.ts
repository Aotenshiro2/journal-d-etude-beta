// La recherche dans la reference ICT (19/10/2026) : la demande de l'essai B
// (Mel, Explication charts., capture, sujet « biais du jour », relecture, NQ 4H)
// doit remonter au moins 2 pages ICT. Aucun appel au modele : choix des
// inspirations, requete anglaise, puis la meme requete SQL que generation.ts.
//   npx -y tsx scripts/verifier-reference-ict.ts
import { prisma } from '../src/lib/db'
import {
  axeCible, choisirFormes, lireDemandeGeneration, motsDeLaDemande, requeteAnglaise, termesAnglais, textesReference,
  type Inspiration,
} from '../src/lib/generation-pur'

async function main() {
  const d = lireDemandeGeneration({
    personne: 'mel', canal: 'Live club / Explication charts.', objectif: 'enseigner', sens: 'capture',
    image: { media_type: 'image/jpeg', data: 'AAAA' },
    reponses: { sujet: 'biais du jour', moment: 'relecture', actif: 'NQ 4H' },
  })
  if (typeof d === 'string') throw new Error(d)
  const toutes = await prisma.$queryRaw<Inspiration[]>`
    select id, personne, axe, role, format, format_cible, objectifs, canal, canal_registre, date_pub, source, texte,
           image, declencheur, pourquoi, refus, concepts
    from public.cockpit_inspirations`
  const formes = choisirFormes(toutes, d, axeCible(d.canal, d.sens), motsDeLaDemande(d))
  const requete = requeteAnglaise(termesAnglais(textesReference(d, formes)))
  console.log(`requete : ${requete}`)
  const pages = await prisma.$queryRaw<{ source: string; page: number }[]>`
    select m.source, m.page
    from public.cockpit_matiere_pages m, to_tsquery('english', ${requete}) q
    where m.reference and m.tsv_en @@ q and length(m.texte) > 200
    order by ts_rank(m.tsv_en, q) desc, m.source, m.page
    limit 2`
  for (const p of pages) console.log(`  ${p.source}, p. ${p.page}`)
  const ok = pages.length >= 2
  console.log(ok ? 'ok  au moins 2 pages ICT' : `KO  ${pages.length} page(s) ICT`)
  process.exitCode = ok ? 0 : 1
}

main().finally(() => prisma.$disconnect())
