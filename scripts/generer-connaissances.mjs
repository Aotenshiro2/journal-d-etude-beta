// LA BASE DE CONNAISSANCES PRODUITS (18/10/2026, demande de Brice : « le bot
// Live Club devrait aussi avoir les infos sur les produits »).
//
// Source unique : docs/connaissances/*.md, un fichier par produit ou sujet,
// ecrit d'apres ce que le code et les pages du site font VRAIMENT (chaque
// fichier cite ses sources et sa date de verification). Ce script les lit et
// produit :
//   - src/lib/connaissances.generated.ts (module PUR, sans import), lu par le
//     bot Live Club (outil connaissances_produits, src/lib/liveclub/prompt-membre.ts)
//     et, plus tard, par le chat support du site ;
//   - avec --site, le meme module pour le site :
//     ../../sites/Aoknowledgecom/v3/src/data/connaissances.generated.ts, que
//     /aide pourra lire.
// Avec --verifier, il n'ecrit rien et sort en erreur si un fichier genere
// n'est plus a jour (a lancer avant un commit qui touche les docs).
//
// FORMAT D'UN DOC
//   ---
//   sujet: identifiant-en-minuscules (unique, sert d'argument a l'outil)
//   titre: Le nom affiche
//   resume: une phrase, reprise dans la description de l'outil
//   mots: mots-cles, separes, par, des, virgules
//   verifie: AAAA-MM-JJ
//   sources: fichiers et pages relus (jamais envoyes aux bots)
//   ---
//   ## Ce que c'est / ## Pour qui / ## Prix et accès / ## Comment y aller /
//   ## Questions fréquentes (dans cet ordre), la derniere faite de
//   « ### question » suivies de leur reponse.
//
// REGLES CONTROLEES (le script refuse le doc sinon) : pas de tiret long ni
// demi-cadratin, pas de « jamais » (une promesse ne s'ecrit pas ainsi), pas
// de « garanti », pas de markdown gras, pas d'email autre que support@.
//
// Lancement (depuis apps/journal-d-etude) :
//   node scripts/generer-connaissances.mjs [--site] [--verifier]

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOSSIER = path.join(RACINE, 'docs', 'connaissances')
const SORTIE_JOURNAL = path.join(RACINE, 'src', 'lib', 'connaissances.generated.ts')
const SORTIE_SITE = path.resolve(RACINE, '..', '..', 'sites', 'Aoknowledgecom', 'v3', 'src', 'data', 'connaissances.generated.ts')

const args = process.argv.slice(2)
const AVEC_SITE = args.includes('--site')
const VERIFIER = args.includes('--verifier')

const SECTIONS = ["Ce que c'est", 'Pour qui', 'Prix et accès', 'Comment y aller', 'Questions fréquentes']
const CHAMPS = ['sujet', 'titre', 'resume', 'mots', 'verifie', 'sources']

const INTERDITS = [
  { re: /[—–]/, raison: 'tiret long ou demi-cadratin' },
  { re: /(?<!\p{L})jamais(?!\p{L})/iu, raison: '« jamais »' },
  { re: /(?<!\p{L})garanti/iu, raison: '« garanti »' },
  { re: /\*\*/, raison: 'markdown gras' },
]
const RE_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

function erreur(fichier, message) {
  throw new Error(`${fichier} : ${message}`)
}

function lireDoc(fichier) {
  const brut = readFileSync(path.join(DOSSIER, fichier), 'utf8').replace(/\r\n/g, '\n')
  const m = brut.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) erreur(fichier, 'en-tete --- absent')
  const meta = {}
  for (const ligne of m[1].split('\n')) {
    const i = ligne.indexOf(':')
    if (i < 0) continue
    meta[ligne.slice(0, i).trim()] = ligne.slice(i + 1).trim()
  }
  for (const c of CHAMPS) if (!meta[c]) erreur(fichier, `champ « ${c} » absent`)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.sujet)) erreur(fichier, `sujet invalide : ${meta.sujet}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.verifie)) erreur(fichier, `date de verification invalide : ${meta.verifie}`)

  const corps = m[2]
  // Les controles portent sur ce qui part aux bots et au site (pas sur les sources).
  const controle = [meta.titre, meta.resume, corps].join('\n')
  for (const { re, raison } of INTERDITS) {
    const t = controle.match(re)
    if (t) erreur(fichier, `${raison} interdit (« ${controle.slice(Math.max(0, t.index - 30), t.index + 30).replace(/\n/g, ' ')} »)`)
  }
  for (const e of controle.match(RE_EMAIL) ?? []) {
    if (e.toLowerCase() !== 'support@aoknowledge.com') erreur(fichier, `email non autorise : ${e}`)
  }

  // Decoupage en sections ## et questions ###.
  const blocs = corps.split(/^## /m).slice(1)
  const titres = blocs.map(b => b.split('\n')[0].trim())
  if (titres.join('|') !== SECTIONS.join('|')) {
    erreur(fichier, `sections attendues dans l'ordre : ${SECTIONS.join(', ')} ; trouvees : ${titres.join(', ')}`)
  }
  const sections = []
  let questions = []
  for (const b of blocs) {
    const [tete, ...reste] = b.split('\n')
    const titre = tete.trim()
    const texte = reste.join('\n').trim()
    if (titre === 'Questions fréquentes') {
      questions = texte.split(/^### /m).slice(1).map(q => {
        const [qt, ...r] = q.split('\n')
        return { q: qt.trim(), r: r.join('\n').trim() }
      })
      if (!questions.length || questions.some(q => !q.q || !q.r)) erreur(fichier, 'Questions fréquentes : au moins une « ### question » avec sa reponse')
    } else {
      if (!texte) erreur(fichier, `section « ${titre} » vide`)
      sections.push({ titre, texte })
    }
  }

  // Le texte a plat, tel qu'il part aux bots : sans marque markdown.
  const aPlat = [
    `${meta.titre}. ${meta.resume}`,
    ...sections.map(s => `${s.titre} :\n${s.texte}`),
    `Questions fréquentes :\n${questions.map(q => `Q : ${q.q}\nR : ${q.r}`).join('\n')}`,
  ].join('\n\n')

  return {
    sujet: meta.sujet,
    titre: meta.titre,
    resume: meta.resume,
    motsCles: meta.mots.split(',').map(s => s.trim()).filter(Boolean),
    verifieLe: meta.verifie,
    sections,
    questions,
    texte: aPlat,
  }
}

function generer() {
  const fichiers = readdirSync(DOSSIER).filter(f => f.endsWith('.md')).sort()
  if (!fichiers.length) throw new Error(`aucun doc dans ${DOSSIER}`)
  const docs = fichiers.map(lireDoc)
  const vus = new Set()
  for (const d of docs) {
    if (vus.has(d.sujet)) throw new Error(`sujet en double : ${d.sujet}`)
    vus.add(d.sujet)
  }
  const sujets = docs.map(d => JSON.stringify(d.sujet))
  return `// FICHIER GENERE par apps/journal-d-etude/scripts/generer-connaissances.mjs
// depuis apps/journal-d-etude/docs/connaissances/*.md. Ne pas modifier a la
// main : corriger le doc, puis relancer le script.
//
// Module PUR (aucun import) : la base de connaissances produits d'AOKnowledge,
// lue par les bots et par le site.

export type SujetConnaissance = ${sujets.join(' | ')}

export type DocConnaissance = {
  sujet: SujetConnaissance
  titre: string
  /** Une phrase : ce que c'est. */
  resume: string
  motsCles: readonly string[]
  /** Date de verification dans le code et les pages (AAAA-MM-JJ). */
  verifieLe: string
  /** Ce que c'est, Pour qui, Prix et acces, Comment y aller. */
  sections: readonly { titre: string; texte: string }[]
  questions: readonly { q: string; r: string }[]
  /** Le doc entier a plat, tel qu'il part aux bots. */
  texte: string
}

export const SUJETS_CONNAISSANCES: readonly SujetConnaissance[] = [${sujets.join(', ')}]

export const CONNAISSANCES: readonly DocConnaissance[] = ${JSON.stringify(docs, null, 2)}
`
}

const contenu = generer()
const cibles = [SORTIE_JOURNAL, ...(AVEC_SITE ? [SORTIE_SITE] : [])]
let perime = false
for (const cible of cibles) {
  const actuel = existsSync(cible) ? readFileSync(cible, 'utf8') : null
  if (VERIFIER) {
    if (actuel !== contenu) {
      perime = true
      console.error(`PERIME : ${path.relative(RACINE, cible)} (relancer node scripts/generer-connaissances.mjs${AVEC_SITE ? ' --site' : ''})`)
    } else console.log(`a jour : ${path.relative(RACINE, cible)}`)
    continue
  }
  if (actuel === contenu) {
    console.log(`inchange : ${path.relative(RACINE, cible)}`)
    continue
  }
  writeFileSync(cible, contenu)
  console.log(`ecrit : ${path.relative(RACINE, cible)} (${contenu.length} caracteres)`)
}
if (perime) process.exit(1)
