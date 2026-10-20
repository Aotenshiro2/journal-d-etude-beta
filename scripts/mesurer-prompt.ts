// Mesure du prompt du generateur de posts (20/10/2026) : jetons d'entree AVANT
// (fiche entiere et toutes les regles, PROMPT_COMPLET) et APRES (noyau + sections
// utiles au canal), par l'API count_tokens (gratuite, rien n'est genere).
//
//   npx -y tsx scripts/mesurer-prompt.ts            les 6 demandes types
//   ... --vrai <n>                                  + generation reelle de la demande n (coute ~0,08 a 0,15 EUR)
//
// Cle : ANTHROPIC_API_KEY_COCKPIT dans l'environnement, ou lue (sans l'afficher) dans
// D:\6_Societe\Pilotage\Data-Performance\credentials.local\anthropic-cockpit-chatbot.local.json.
import { existsSync, readFileSync } from 'node:fs'
import { prisma } from '../src/lib/db'
import { aiClient } from '../src/lib/ai'
import { genererPost, parametresAppel, preparerGeneration } from '../src/lib/generation'
import { lireDemandeGeneration } from '../src/lib/generation-pur'

const COFFRE = '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/anthropic-cockpit-chatbot.local.json'
if (!process.env.ANTHROPIC_API_KEY_COCKPIT && existsSync(COFFRE)) {
  process.env.ANTHROPIC_API_KEY_COCKPIT = JSON.parse(readFileSync(COFFRE, 'utf8')).api_key
}

const IMAGE = process.env.MESURE_IMAGE ?? null

export const DEMANDES: Array<{ nom: string; brut: Record<string, unknown> }> = [
  {
    nom: 'Brice Mindset recadrer',
    brut: {
      personne: 'brice', canal: 'Live club / Mindset', objectif: 'recadrer',
      idee: 'Le revenge trading : après une perte, on reprend une position tout de suite pour se refaire, souvent plus grosse. Je veux recadrer ce réflexe.',
      reponses: { sujet: 'revenge trading' },
    },
  },
  {
    nom: 'Brice Explication charts enseigner',
    brut: {
      personne: 'brice', canal: 'Live club / Explication charts.', objectif: 'enseigner',
      idee: "Attendre la prise de liquidité avant d'entrer : beaucoup entrent sur la cassure du plus haut d'Asie alors que c'est souvent là que le prix va chercher les stops avant de repartir dans l'autre sens.",
      reponses: { sujet: 'prise de liquidité' },
    },
  },
  {
    nom: 'Mel Explication charts enseigner',
    brut: {
      personne: 'mel', canal: 'Live club / Explication charts.', objectif: 'enseigner',
      idee: "Le FVG H1 qui a tenu ce matin sur le NQ : expliquer pourquoi on attend la réaction dans le FVG plutôt que d'entrer au premier contact.",
      reponses: { sujet: 'fair value gap' },
    },
  },
  {
    nom: 'MELMOM convertir',
    brut: {
      personne: 'mel', canal: 'MELMOM | ICT Trading', objectif: 'convertir',
      idee: 'Rappeler que le Live Club ouvre ses portes : les lives du matin, les explications de charts, la communauté. Donner envie de rejoindre.',
      reponses: { sujet: 'Live Club' },
    },
  },
  {
    nom: 'Brice Newsletter creer_du_lien',
    brut: {
      personne: 'brice', canal: 'Newsletter (Kit)', objectif: 'creer_du_lien',
      idee: "Ce que trois ans de journal de trading m'ont appris sur moi, plus que sur le marché.",
      reponses: { sujet: 'journal de trading' },
    },
  },
  {
    nom: 'Brice Reseau social acquerir',
    brut: {
      personne: 'brice', canal: 'Réseau social', objectif: 'acquerir',
      idee: "La plupart des traders cherchent la stratégie parfaite alors que le problème, c'est la personne qui l'exécute.",
      reponses: { sujet: 'discipline' },
    },
  },
]

async function compter(params: ReturnType<typeof parametresAppel>, systemeSeul = false): Promise<number> {
  const r = await aiClient('cockpit').messages.countTokens({
    model: params.model,
    system: params.system,
    messages: systemeSeul ? [{ role: 'user', content: '.' }] : params.messages,
  })
  return r.input_tokens
}

async function main() {
  const iVrai = process.argv.indexOf('--vrai')
  const lignes: Array<Record<string, unknown>> = []
  if (iVrai > 0) {
    const n = Number(process.argv[iVrai + 1])
    const brut = { ...DEMANDES[n].brut }
    if (IMAGE) brut.image = { media_type: 'image/jpeg', data: readFileSync(IMAGE).toString('base64') }
    if (process.env.MESURE_IDEE !== undefined) brut.idee = process.env.MESURE_IDEE || null
    if (process.env.MESURE_REPONSES) brut.reponses = JSON.parse(process.env.MESURE_REPONSES)
    const d = lireDemandeGeneration(brut)
    if (typeof d === 'string') throw new Error(d)
    const [brice] = await prisma.$queryRaw<{ user_id: string }[]>`
      select user_id::text as user_id from public.cockpit_allowlist where label = 'Brice' limit 1`
    const r = await genererPost(d, brice.user_id, 'cockpit')
    console.log(JSON.stringify({ demande: DEMANDES[n].nom, ...r }, null, 2))
    return
  }
  for (const { nom, brut } of DEMANDES) {
    const d = lireDemandeGeneration(brut)
    if (typeof d === 'string') throw new Error(`${nom} : ${d}`)
    const ligne: Record<string, unknown> = { nom }
    for (const complet of [true, false]) {
      const prep = await preparerGeneration(d, { complet })
      if (!prep.ok) throw new Error(`${nom} : ${prep.erreur}`)
      const params = parametresAppel(prep.p)
      const total = await compter(params)
      const fixe = await compter(params, true)
      ligne[complet ? 'avant' : 'apres'] = { total, fixe, variable: total - fixe, blocs: prep.p.systeme.length }
      if (!complet) ligne.cles = prep.p.clesPrompt.map((c) => c.replace(/^generateur:(fiche:|regle:)?/, ''))
    }
    lignes.push(ligne)
    console.log(JSON.stringify(ligne))
  }
}

main().finally(() => prisma.$disconnect())
