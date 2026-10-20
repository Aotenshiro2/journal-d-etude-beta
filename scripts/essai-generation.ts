// Essai du generateur de posts (19/10/2026), hors navigateur.
//   npx -y tsx scripts/essai-generation.ts idee              apercu du choix (aucun appel au modele)
//   npx -y tsx scripts/essai-generation.ts capture <image>   apercu du choix pour une capture
//   ... --vrai                                               appel reel (coute), brouillon range en base
// Les entrees de l'essai sont ci-dessous. Chaque appel --vrai est facture : en lancer peu.
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/db'
import {
  assemblerPassages, axeCible, choisirBanque, choisirFormes, choisirMatiereInspirations, entreeGeneration,
  lireDemandeGeneration, motsDeLaDemande, registreDuCanal, type Inspiration,
} from '../src/lib/generation-pur'
import { genererPost } from '../src/lib/generation'

async function main() {
  const sens = process.argv[2] === 'capture' ? 'capture' : 'idee'
  const vrai = process.argv.includes('--vrai')
  const image = sens === 'capture'
    ? { media_type: 'image/jpeg', data: readFileSync(process.argv[3]).toString('base64') }
    : null
  const brut = sens === 'idee'
    ? {
        personne: 'brice', canal: 'Live club / Mindset', objectif: 'recadrer', sens,
        idee: "Le revenge trading : après une perte, on reprend une position tout de suite pour se refaire, souvent plus grosse. Je veux recadrer ce réflexe.",
        reponses: { sujet: 'revenge trading' },
      }
    : {
        personne: 'mel', canal: 'Live club / Explication charts.', objectif: 'enseigner', sens, image,
        reponses: { sujet: 'biais du jour', moment: 'relecture' },
      }
  const d = lireDemandeGeneration(brut)
  if (typeof d === 'string') throw new Error(d)

  const [brice] = await prisma.$queryRaw<{ user_id: string }[]>`
    select user_id::text as user_id from public.cockpit_allowlist where label = 'Brice' limit 1`

  if (!vrai) {
    const toutes = await prisma.$queryRaw<Inspiration[]>`select id, personne, axe, role, format, format_cible, objectifs, canal, canal_registre, date_pub, source, texte, image, declencheur, pourquoi, refus, concepts from public.cockpit_inspirations`
    const [banque] = await prisma.$queryRaw<{ contenu: string }[]>`
      select contenu from public.cockpit_methode_textes where cle = 'matiere:banque-contenus.md'`
    const axe = axeCible(d.canal, d.sens, d.idee)
    const mots = motsDeLaDemande(d)
    const formes = choisirFormes(toutes, d, axe, mots)
    const passages = assemblerPassages(axe, {
      inspirations: choisirMatiereInspirations(toutes, d.personne, axe, mots),
      banque: d.personne === 'brice' ? choisirBanque(banque?.contenu ?? null, mots) : [],
      pdf: [], reference: [],
    })
    console.log({ axe, mots })
    console.log('formes :', formes.map((f) => `${f.inspiration.id} ${f.inspiration.canal}${f.memeCanal ? '' : ' (autre)'}`))
    console.log('passages (sans les PDF ni la reference, cherches en base au vrai appel) :', passages.map((p) => p.libelle))
    const t = entreeGeneration({ d, registre: registreDuCanal(toutes, d.canal), formes, passages, parent: null })
    console.log(`entree : ${t.length} caracteres`)
    return
  }
  const r = await genererPost(d, brice.user_id, 'cockpit')
  console.log(JSON.stringify(r, null, 2))
}

main().finally(() => prisma.$disconnect())
