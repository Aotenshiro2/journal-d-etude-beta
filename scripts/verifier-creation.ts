// L'onglet Creation du cockpit, partie PURE (src/lib/creation-pur.ts), 27/10/2026.
// Aucun appel au modele, aucune base : la consigne envoyee pour le geste genere
// et la lecture d'une sortie SIMULEE. Verifie surtout le retour de Brice du
// 27/10 : le premier niveau genere = des GRANDES IDEES (un nom court + ce
// qu'elle couvre), puis des concepts tant qu'un concept en contient plusieurs ; la phrase seulement au plus petit concept (Brice, 27/10).
//   npx -y tsx scripts/verifier-creation.ts
// Sort en code 1 au premier ecart.
import {
  OUTILS, consigneNiveau, entreesPrompt1, lireNoeuds, profondeurDe, serialiserArbre, texteSysteme, validerGenere,
  type LigneDecoupage,
} from '../src/lib/creation-pur'

let ecarts = 0
function verifier(nom: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'ECART'} ${nom}${!ok && detail ? ` : ${detail}` : ''}`)
  if (!ok) ecarts++
}

// --- 1. La consigne du geste genere -------------------------------------------
const systeme = texteSysteme('PROMPT 1 DE LA METHODE', 'genere')
verifier('la consigne demande du general au particulier', systeme.includes('DU GÉNÉRAL AU PARTICULIER'))
verifier('le premier niveau = des categories de 1 a 4 mots', /catégorie d.un à quatre mots/.test(systeme))
verifier('la phrase seulement au plus petit concept, pas de saut direct', /au plus petit concept/.test(systeme) && /Ne pas sauter d'un concept large directement à une phrase/.test(systeme))
verifier('cinq par defaut, jamais de piece inventee', systeme.includes('cinq par défaut, jamais une pièce inventée'))
verifier('ancienne regle « un niveau si pas en une phrase » retiree', !systeme.includes('si une pièce ne tient pas en une phrase.'))
// L'exemple de reference : le decoupage reel de Brice en live, ses cinq noms courts.
for (const idee of ['La conscience du corps', 'La nature des comptes', 'Le détachement', 'La technique et les routines', 'Les données']) {
  verifier(`exemple de reference : « ${idee} »`, systeme.includes(`« ${idee} »`))
}
verifier('exemple : la punchline est donnee comme MAUVAIS premier niveau', /Mauvais premier niveau : « Tu ne crames pas un compte sur un trade/.test(systeme))
verifier('exemple de forme, pas de contenu', systeme.includes('pas de contenu à recopier'))
// Les etiquettes du programme de la semaine (Melanie) : la forme visee, et la premiere base si l'objet en porte.
for (const e of ['Gestion du risque', 'Psychologie', 'Discipline', 'Résultats']) {
  verifier(`etiquette de programme citee : « ${e} »`, systeme.includes(`« ${e} »`))
}
verifier('etiquettes de l\'objet = premiere base du niveau 1', /elles sont la première base du niveau 1/.test(systeme))
verifier('les autres gestes ne recoivent pas cette consigne', !texteSysteme('P', 'assiste').includes('DU GÉNÉRAL AU PARTICULIER'))

// --- 2. Le schema de l'outil -------------------------------------------------
const pieces = (OUTILS.genere.input_schema.properties.decoupages as { items: { properties: { pieces: { items: Record<string, unknown> } } } })
  .items.properties.pieces.items as { properties: Record<string, { type?: unknown; items?: { properties: Record<string, unknown> } }> }
verifier('schema : la piece a un champ idee', 'idee' in pieces.properties)
verifier('schema : idee nullable', JSON.stringify(pieces.properties.idee?.type) === '["string","null"]')
verifier('schema : les enfants ont un champ idee', 'idee' in (pieces.properties.enfants?.items?.properties ?? {}))

// --- 3. Le niveau selon la profondeur de la cible -----------------------------
const noeuds = lireNoeuds([
  { id: 'aaaaaaaa', parent: null, ordre: 0, texte: 'ce qui se passe dans la tete', idee: 'La psychologie' },
  { id: 'bbbbbbbb', parent: 'aaaaaaaa', ordre: 0, texte: 'le tilt se sent avant de se voir', idee: 'Le corps' },
  { id: 'cccccccc', parent: 'bbbbbbbb', ordre: 0, texte: 'Ton corps sait avant toi que tu vas forcer.' },
  { id: 'dddddddd', parent: null, ordre: 1, texte: 'Une piece ancienne, sans idee.' },
])
verifier('lecture : idee gardee', noeuds[0].idee === 'La psychologie')
verifier('lecture : noeud ancien sans idee', noeuds[3].idee === undefined)
verifier('profondeurs 0/1/2/3', [profondeurDe(noeuds, null), profondeurDe(noeuds, 'aaaaaaaa'), profondeurDe(noeuds, 'bbbbbbbb'), profondeurDe(noeuds, 'cccccccc')].join() === '0,1,2,3')
verifier('tableau : « idee : texte »', serialiserArbre(noeuds).includes('La psychologie : ce qui se passe dans la tete'))
verifier('niveau 1 = GRANDES IDÉES', consigneNiveau(1).includes('GRANDES IDÉES'))
verifier('niveau 2 = CONCEPTS, avec le test de divisibilite', consigneNiveau(2).includes('CONCEPTS') && consigneNiveau(2).includes('au moins deux concepts distincts'))
verifier('niveau 3 : la profondeur ne force pas la phrase', consigneNiveau(3).includes('CONCEPTS') && consigneNiveau(3).includes('La profondeur ne décide rien') && !consigneNiveau(3).includes('FEUILLES'))

const ligne: LigneDecoupage = { id: '00000000-0000-4000-8000-000000000001', titre: 'Pourquoi tu crames tes comptes et comment arrêter ?', phrase: null, usage: 'savoir', noeuds }
const entree = (cible: string | null) => entreesPrompt1({ geste: 'genere', auteur: 'Brice', ligne, cible, matiereAuteur: false, matiereCollee: null, outil: 'rendre_decoupages' })
verifier('entree, cible = aieul : grandes idees demandees', entree(null).includes('- NIVEAU DES PIÈCES À RENDRE : profondeur 1') && entree(null).includes('GRANDES IDÉES'))
verifier('entree, cible = une grande idee : sous-idees', entree('aaaaaaaa').includes('profondeur 2') && entree('aaaaaaaa').includes('CONCEPTS'))
verifier('entree, cible = une sous-idee : feuilles', entree('bbbbbbbb').includes('profondeur 3'))
verifier('entree, cible affichee avec son idee', entree('aaaaaaaa').includes('« La psychologie : ce qui se passe dans la tete »'))
verifier('geste assiste : pas de ligne de niveau', !entreesPrompt1({ geste: 'assiste', auteur: 'Brice', ligne, cible: null, matiereAuteur: false, matiereCollee: null, outil: 'x' }).includes('NIVEAU DES PIÈCES'))

// --- 4. La lecture d'une sortie simulee --------------------------------------
const sortie = validerGenere({
  decoupages: [
    {
      nom: 'Par les branches du live', angle: 'Du corps aux données.',
      pieces: [
        {
          idee: 'La conscience du corps. ', texte: 'le tilt se sent avant de se voir', marque: 'v', source: null,
          enfants: [
            { idee: 'Les signaux physiques', texte: 'ce que le corps dit avant le tilt', marque: null, source: null },
            { idee: null, texte: 'Tu ne crames pas un compte sur un trade — tu le crames sur une tension.', marque: 'v', source: null },
          ],
        },
        { idee: 'Le détachement', texte: 'les gains latents qui poussent à forcer', marque: 'q', source: null, question: 'Un cas vécu ?' },
        { texte: 'Une pièce sans idee (sortie ancienne)', marque: null, source: null },
        { idee: 'Vide', texte: '', marque: null, source: null },
      ],
    },
  ],
})
const d = sortie.decoupages[0]
verifier('sortie : un decoupage, trois pieces (la vide tombe)', sortie.decoupages.length === 1 && d.pieces.length === 3)
verifier('sortie : idee lue sans point final', d.pieces[0].idee === 'La conscience du corps', JSON.stringify(d.pieces[0].idee))
verifier('sortie : idee des enfants lue', d.pieces[0].enfants?.[0].idee === 'Les signaux physiques')
verifier('sortie : feuille sans idee', d.pieces[0].enfants?.[1].idee === undefined)
verifier('sortie : aucun tiret long', !JSON.stringify(sortie).includes('—'))
verifier('sortie : piece sans idee toleree', d.pieces[2].idee === undefined && d.pieces[2].texte.startsWith('Une pièce'))
verifier('sortie : le trou garde sa question', d.pieces[1].marque === 'q' && d.pieces[1].question === 'Un cas vécu ?')

console.log(ecarts ? `\n${ecarts} ecart(s)` : '\nTout est conforme.')
process.exit(ecarts ? 1 : 0)
