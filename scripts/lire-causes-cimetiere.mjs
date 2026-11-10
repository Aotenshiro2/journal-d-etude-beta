// Le point de lecture des causes « Autre » du cimetière des comptes de Pilotage
// (0.4, 10/11/2026). Quand un membre passe un compte en inactif et choisit
// « Autre », Pilotage envoie ses mots (60 caractères, normalisés : minuscules,
// sans accents, ni email, ni lien, ni long nombre) en signal
// `pilotage.cause_autre`. Ce script les compte, regroupe les textes proches
// (src/lib/besoins/textes-proches.ts) et dit ceux qui reviennent : une
// proposition portée par plusieurs personnes peut rejoindre la liste des
// causes de Pilotage (CAUSES_FERMETURE, src/domain/account-cemetery.ts).
//
// LECTURE SEULE. Les textes sont des mots de membres : la sortie reste sur la
// machine. Lancement (Node 22, depuis apps/journal-d-etude) :
//   node --env-file=.env.local scripts/lire-causes-cimetiere.mjs [--jours 90] [--json sortie.json]

import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { regrouperTextes } from '../src/lib/besoins/textes-proches.ts'

const args = process.argv.slice(2)
const arg = nom => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null }
const jours = Math.max(1, Math.min(3650, Number(arg('--jours')) || 90))
const sortie = arg('--json')

if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
  console.error('DATABASE_URL absente : lancer avec --env-file=.env.local.')
  process.exit(1)
}

const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
try {
  const lignes = await prisma.$queryRaw`
    select s.contexte->>'cause' as texte, count(distinct s.personne)::int as personnes, count(*)::int as fois
    from public.besoin_signal s
    where s.cle = 'pilotage.cause_autre' and s.contexte ? 'cause'
      and s.created_at > now() - make_interval(days => ${jours}::int)
    group by 1`
  const groupes = regrouperTextes(lignes)
  console.log(`Causes « Autre » du cimetière, ${jours} derniers jours : ${lignes.length} texte(s), ${groupes.length} groupe(s).`)
  for (const g of groupes) {
    const plus = g.variantes.length ? ` (aussi : ${g.variantes.slice(0, 4).join(' ; ')}${g.variantes.length > 4 ? ' ...' : ''})` : ''
    console.log(`${String(g.personnes).padStart(3)} pers. ${String(g.fois).padStart(3)} fois  ${g.texte}${plus}`)
  }
  const aAjouter = groupes.filter(g => g.personnes >= 3)
  console.log(aAjouter.length
    ? `\nÀ proposer à Brice pour la liste (3 personnes ou plus) : ${aAjouter.map(g => `« ${g.texte} »`).join(', ')}.`
    : '\nAucune cause ne revient encore chez 3 personnes.')
  if (sortie) writeFileSync(sortie, JSON.stringify({ jours, groupes }, null, 2))
} finally {
  await prisma.$disconnect()
}
