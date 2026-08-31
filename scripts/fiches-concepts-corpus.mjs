/**
 * 0.2 lot 5 — dépose les fiches de concept issues du CORPUS.
 *
 *   Blanc :    node scripts/fiches-concepts-corpus.mjs
 *   Écriture : node scripts/fiches-concepts-corpus.mjs --appliquer
 *
 * ── Pourquoi les fiches sont ÉCRITES ICI et pas générées par un appel modèle ──
 * Deux raisons, mesurées le 31/08 et non supposées :
 *
 * 1. Le corpus texte accessible ne couvre presque pas les concepts que les
 *    membres taguent. Le `Glossaire V3` de la formation est un glossaire
 *    DÉBUTANT (0 occurrence de macro breaker, ffvg, nro, ote, hrlr, quadrants,
 *    modèle 2022…). Les chroniques n'en portent que quelques-uns : fvg 8,
 *    amd 9, mss 8, accumulation 9. Tout le reste vit dans les 147 PDF et les
 *    419 vidéos de la formation — inaccessibles sans chaîne d'extraction.
 * 2. Il n'y a aucune clé Anthropic en local (`vercel env pull` vide les clés
 *    sensibles), donc aucune génération automatisée depuis cette machine.
 *
 * Conséquence assumée : ce fichier ne contient que ce qui est RÉELLEMENT LU dans
 * le corpus, avec son repérage. Aucune fiche n'est écrite de mémoire. C'est ce
 * que veut dire « sans mentir » : un tip sans source est un tip qu'on n'écrit
 * pas. Les concepts non couverts n'ont pas de fiche, et c'est le comportement
 * correct — mieux vaut rien qu'une définition plausible et fausse.
 *
 * ── La correction prime ──────────────────────────────────────────────────────
 * Une fiche dont `corrigee` est vrai n'est JAMAIS réécrite. Patron repris de
 * `cockpit_avatar_manuel` : le calcul est une déduction, celui qui sait doit
 * pouvoir la corriger, et sa correction survit au recalcul.
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const appliquer = process.argv.includes('--appliquer')

const CHRONIQUES = 'Chroniques de l\'accélérateur — module Skool (module-chronique-accelerateur.md)'

const FICHES = [
  {
    nomNormalise: 'amd',
    origine: 'corpus',
    definition:
      'Accumulation, Manipulation, Distribution. Le marché attire les traders dans de faux mouvements avant de les piéger : il joue sur leur psychologie, comme au bonneteau. Comprendre l\'AMD, c\'est comprendre comment la Smart Money manipule les traders individuels.',
    tips: [
      {
        angle: 'geste',
        texte:
          'Vérifie l\'orderflow sur les hautes temporalités et donne-toi un biais clair avant d\'entrer. Trader sans vue d\'ensemble, ou contre le Draw On Liquidity HTF, revient à vouloir battre un croupier qui connaît déjà l\'issue.',
        source: 'Chronique AMD — « Comment l\'AMD piège les traders »',
      },
      {
        angle: 'friction',
        texte:
          'L\'erreur classique : prendre la récupération d\'une liquidité pour un retournement. Ce n\'est souvent qu\'une pause, une réinitialisation du mouvement. Reste fidèle à ton analyse HTF et attends que les structures cassent réellement.',
        source: 'Chronique AMD — « Le Purge and Reverse et l\'AMD »',
      },
      {
        angle: 'geste',
        texte:
          'Exercice : passe plusieurs séances sans prendre une seule position. Observe comment les premiers mouvements piègent, et attends la Distribution avant même de penser à entrer. C\'est ce qui installe la patience que le concept exige.',
        source: 'Chronique AMD — exercice d\'observation',
      },
    ],
    sources: [{ oeuvre: CHRONIQUES, reperage: 'chapitre AMD (le bonneteau, le Purge and Reverse)' }],
  },
  {
    nomNormalise: 'mss',
    origine: 'corpus',
    definition:
      'Market Structure Shift. Le marché brise un niveau clé de support ou de résistance, ce qui signale un changement de direction possible. À distinguer du Break of Structure (BOS) : les deux servent à repérer les retournements et à fixer des objectifs plus lointains.',
    tips: [
      {
        angle: 'geste',
        texte:
          'Trois temps, dans cet ordre : repérer le niveau de support ou de résistance brisé, confirmer la rupture sur une unité de temps inférieure, puis seulement ajuster la stratégie.',
        source: 'Chronique structures de marché — « Identifier / Confirmer / Utiliser le MSS »',
      },
      {
        angle: 'geste',
        texte:
          'Le MSS se lit avec les swings court, moyen et long terme : c\'est leur interaction qui dit si le retournement compte, pas la cassure seule.',
        source: 'Chronique structures de marché — swings STH / ITH / LTH',
      },
    ],
    sources: [{ oeuvre: CHRONIQUES, reperage: 'chapitre structures de marché (MSS et BOS)' }],
  },
]

console.log(`\n${appliquer ? '── ÉCRITURE ──' : '── BLANC (rien ne sera écrit) ──'}\n`)

for (const f of FICHES) {
  const existante = await prisma.conceptFiche.findUnique({ where: { nomNormalise: f.nomNormalise } })

  if (existante?.corrigee) {
    console.log(`« ${f.nomNormalise} » : CORRIGÉE À LA MAIN — laissée intacte.`)
    continue
  }

  const action = existante ? 'mise à jour' : 'créée'
  console.log(`« ${f.nomNormalise} » : ${action} — ${f.tips.length} tip(s), ${f.tips.filter(t => t.source).length} sourcé(s).`)
  for (const t of f.tips) console.log(`    [${t.angle}] ${t.texte.slice(0, 76)}…`)

  if (!appliquer) continue

  // Un tip sans source ne part pas. La règle n'est pas cosmétique : c'est elle
  // qui rend « sans mentir » vérifiable par quelqu'un d'autre que son auteur.
  const sansSource = f.tips.filter(t => !t.source)
  if (sansSource.length) {
    console.log(`    ⚠️ ${sansSource.length} tip(s) sans source — fiche REFUSÉE.`)
    continue
  }

  await prisma.conceptFiche.upsert({
    where: { nomNormalise: f.nomNormalise },
    create: { ...f, statut: 'propose' },
    update: { definition: f.definition, tips: f.tips, sources: f.sources, origine: f.origine, calculeeLe: new Date() },
  })
}

const total = await prisma.conceptFiche.count()
console.log(`\n${total} fiche(s) en base.`)
if (!appliquer) console.log('Relancer avec --appliquer pour écrire.')

await prisma.$disconnect()
