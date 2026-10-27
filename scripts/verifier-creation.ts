// L'onglet Creation du cockpit, partie PURE (src/lib/creation-pur.ts), 27/10/2026.
// Aucun appel au modele, aucune base : la consigne envoyee, les schemas des
// outils et la lecture de sorties SIMULEES. Verifie la regle de Brice du 27/10 :
// un noeud = une idee, un concept ou une raison, toujours nomme ; on le creuse
// tant qu'il passe le TEST DES CINQ ENFANTS (cinq enfants vraiment distincts),
// sinon c'est une fondation ; aucune punchline generee ; la phrase se demande a
// part, noeud par noeud (geste « phrase »), et ne ferme rien.
//   npx -y tsx scripts/verifier-creation.ts
// Sort en code 1 s'il y a un ecart.
import {
  MAX_LOT_IDEES, MAX_NOMS,
  OUTILS, consigneNiveau, entreesPrompt1, lireDemande, lireNom, lireNoeuds, noeudsSansNom, profondeurDe, serialiserArbre, texteSysteme,
  validerGenere, validerIdee, validerIdees, validerPhrase,
  type LigneDecoupage,
} from '../src/lib/creation-pur'

let ecarts = 0
function verifier(nom: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'ECART'} ${nom}${!ok && detail ? ` : ${detail}` : ''}`)
  if (!ok) ecarts++
}

// --- 1. La consigne du geste genere -------------------------------------------
const systeme = texteSysteme('PROMPT 1 DE LA METHODE', 'genere')
verifier('du general au particulier, en concepts', systeme.includes('DU GÉNÉRAL AU PARTICULIER, EN CONCEPTS'))
verifier('un noeud = une idee, un concept ou une raison', /une idée, un concept ou une raison/.test(systeme))
verifier('le test des cinq enfants est demande', systeme.includes('LE TEST DES CINQ ENFANTS') && /cinq enfants réellement distincts/.test(systeme))
verifier('reformulations = fondation (mure)', /tournures différentes de la même phrase, c'est une FONDATION/.test(systeme) && systeme.includes('`mure` = true'))
verifier('« tient en une phrase » ne decide pas l\'arret', systeme.includes('« ça tient en une phrase » ne décide jamais de l\'arrêt'))
verifier('aucune punchline par defaut', systeme.includes('AUCUNE PUNCHLINE, nulle part'))
verifier('ancienne regle « la phrase au plus petit concept » retiree', !/au plus petit concept/.test(systeme))
verifier('cinq par defaut, jamais de piece inventee', systeme.includes('cinq par défaut, jamais une pièce inventée'))
for (const idee of ['La conscience du corps', 'La nature des comptes', 'Le détachement', 'La technique et les routines', 'Les données']) {
  verifier(`exemple de reference : « ${idee} »`, systeme.includes(`« ${idee} »`))
}
verifier('exemple de chaine : le tilt, ses raisons, le FOMO', systeme.includes('« Le tilt » est une raison') && systeme.includes('« Le FOMO » se creuse encore'))
verifier('exemple : la punchline donnee comme MAUVAIS premier niveau', /Mauvais premier niveau : « Tu ne crames pas un compte sur un trade/.test(systeme))
verifier('exemple de forme, pas de contenu', systeme.includes('pas de contenu à recopier'))
for (const e of ['Gestion du risque', 'Psychologie', 'Discipline', 'Résultats']) {
  verifier(`etiquette de programme citee : « ${e} »`, systeme.includes(`« ${e} »`))
}
verifier('etiquettes de l\'objet = premiere base du niveau 1', /elles sont la première base du niveau 1/.test(systeme))
verifier('le geste assiste ne recoit pas cette consigne', !texteSysteme('P', 'assiste').includes('DU GÉNÉRAL AU PARTICULIER'))

// --- 2. Le schema de l'outil genere -----------------------------------------
type Proprietes = Record<string, { type?: unknown; items?: { properties: Record<string, unknown> } }>
const piece = (OUTILS.genere.input_schema.properties.decoupages as { items: { properties: { pieces: { items: { properties: Proprietes; required: string[] } } } } })
  .items.properties.pieces.items
verifier('schema : idee obligatoire et non nulle', piece.required.includes('idee') && piece.properties.idee?.type === 'string')
verifier('schema : mure (fondation) obligatoire', piece.required.includes('mure') && piece.properties.mure?.type === 'boolean')
verifier('schema : les enfants ont idee et mure', ['idee', 'mure'].every((k) => k in (piece.properties.enfants?.items?.properties ?? {})))

// --- 3. Le niveau et les entrees -----------------------------------------------
const noeuds = lireNoeuds([
  { id: 'aaaaaaaa', parent: null, ordre: 0, texte: 'ce qui se passe dans la tete', idee: 'La psychologie' },
  { id: 'bbbbbbbb', parent: 'aaaaaaaa', ordre: 0, texte: 'une raison de pourquoi ca arrive', idee: 'Le tilt', phrase: 'Le tilt, c\'est quand tu trades pour faire baisser la tension.' },
  { id: 'cccccccc', parent: 'bbbbbbbb', ordre: 0, texte: 'la peur de rater le mouvement', idee: 'Le FOMO' },
  { id: 'dddddddd', parent: null, ordre: 1, texte: 'Une piece ancienne, sans idee.' },
])
verifier('lecture : idee gardee', noeuds[0].idee === 'La psychologie')
verifier('lecture : phrase gardee', noeuds[1].phrase?.startsWith('Le tilt, c\'est') === true)
verifier('lecture : noeud ancien sans idee ni phrase', noeuds[3].idee === undefined && noeuds[3].phrase === undefined)
verifier('profondeurs 0/1/2/3', [profondeurDe(noeuds, null), profondeurDe(noeuds, 'aaaaaaaa'), profondeurDe(noeuds, 'bbbbbbbb'), profondeurDe(noeuds, 'cccccccc')].join() === '0,1,2,3')
verifier('tableau : « idee : texte »', serialiserArbre(noeuds).includes('La psychologie : ce qui se passe dans la tete'))
verifier('tableau : la phrase choisie suit le noeud', serialiserArbre(noeuds).includes('(phrase : « Le tilt, c\'est quand'))
verifier('niveau 1 : idees, concepts ou raisons, une raison est un bon noeud', consigneNiveau(1).includes('des IDÉES, des CONCEPTS ou des RAISONS') && consigneNiveau(1).includes('« Le tilt »'))
verifier('niveau 2 et 3 : test des cinq enfants, la profondeur ne decide rien', [2, 3].every((p) => consigneNiveau(p).includes('test des cinq enfants') && consigneNiveau(p).includes('La profondeur ne décide rien')))
verifier('aucun niveau ne demande de phrase', [1, 2, 3, 4].every((p) => consigneNiveau(p).includes('Jamais de phrase punchline')))

const ligne: LigneDecoupage = { id: '00000000-0000-4000-8000-000000000001', titre: 'Pourquoi tu crames tes comptes et comment arrêter ?', phrase: null, usage: 'savoir', noeuds }
const entree = (geste: 'genere' | 'assiste' | 'phrase', cible: string | null) =>
  entreesPrompt1({ geste, auteur: 'Brice', ligne, cible, matiereAuteur: false, matiereCollee: null, outil: OUTILS[geste].name })
const entree2 = (geste: 'idee', cible: string) =>
  entreesPrompt1({ geste, auteur: 'Brice', ligne, cible, matiereAuteur: false, matiereCollee: null, outil: OUTILS[geste].name })
verifier('genere, cible = aieul : profondeur 1', entree('genere', null).includes('- NIVEAU DES PIÈCES À RENDRE : profondeur 1'))
verifier('genere, cible = le tilt : profondeur 3', entree('genere', 'bbbbbbbb').includes('profondeur 3'))
verifier('assiste : pas de ligne de niveau', !entree('assiste', null).includes('NIVEAU DES PIÈCES'))

// --- 4. Le geste phrase ----------------------------------------------------------
const sysPhrase = texteSysteme('PROMPT 1 DE LA METHODE', 'phrase')
verifier('phrase : consigne propre au geste', sysPhrase.includes('UNE PHRASE POUR EXPLIQUER LE NŒUD CIBLE') && !sysPhrase.includes('DU GÉNÉRAL AU PARTICULIER'))
verifier('phrase : trois au plus, angles differents', /trois phrases au plus/.test(sysPhrase) && /jamais trois tournures de la même/.test(sysPhrase))
verifier('phrase : voix de l\'auteur (tutoiement, aucun tiret long)', /tutoiement, phrases courtes, mots simples, aucun tiret long/.test(sysPhrase))
verifier('phrase : ne ferme rien, le noeud se creuse encore', /La phrase ne ferme rien/.test(sysPhrase))
verifier('phrase : outil rendre_phrases, 3 au plus', OUTILS.phrase.name === 'rendre_phrases'
  && (OUTILS.phrase.input_schema.properties.phrases as { maxItems?: number }).maxItems === 3)
const ePhrase = entree('phrase', 'cccccccc')
verifier('phrase : la lignee est dite du plus large au noeud', ePhrase.includes('- LIGNÉE DU NŒUD (du plus large au nœud) : Pourquoi tu crames') && /La psychologie : .* > Le tilt : .* > Le FOMO : la peur de rater le mouvement/.test(ePhrase))
verifier('phrase : MODE phrase et outil nomme', ePhrase.includes('- MODE : phrase') && ePhrase.includes('rendre_phrases'))
verifier('phrase : pas de page blanche (le noeud et ses enfants restent)', ePhrase.includes('Le tilt : une raison'))
const dem = lireDemande({ geste: 'phrase', decoupage_id: ligne.id, cible: 'cccccccc' })
verifier('demande phrase lue', typeof dem !== 'string' && dem.geste === 'phrase' && dem.cible === 'cccccccc')
verifier('demande phrase sans cible refusee', lireDemande({ geste: 'phrase', decoupage_id: ligne.id }) === 'cible requise pour une phrase.')
const ph = validerPhrase({ phrases: ['  Le FOMO, c’est trader pour ne pas rater.  ', 'Le FOMO, c’est trader pour ne pas rater.', '', 'Tu entres parce que les autres gagnent — pas parce que ton plan le dit.', 'Trois.', 'Quatre.'] })
verifier('sortie phrase : doublon et vide tombent, 3 au plus', ph.phrases.length === 3, JSON.stringify(ph))
verifier('sortie phrase : aucun tiret long', !JSON.stringify(ph).includes('—'))
verifier('sortie phrase illisible = aucune phrase', validerPhrase(null).phrases.length === 0)

// --- 5. La lecture d'une sortie genere simulee ---------------------------------
const sortie = validerGenere({
  decoupages: [
    {
      nom: 'Par les raisons', angle: 'Ce qui fait cramer un compte.',
      pieces: [
        {
          idee: 'Le tilt. ', texte: 'une raison de pourquoi ça arrive', mure: false, marque: 'v', source: null,
          enfants: [
            { idee: 'Le FOMO', texte: 'la peur de rater le mouvement', mure: false, marque: null, source: null },
            { idee: 'La revanche', texte: 'vouloir reprendre ce que le marché a pris — tout de suite', mure: true, marque: null, source: null },
          ],
        },
        { idee: 'Le détachement', texte: 'les gains latents qui poussent à forcer', mure: true, marque: 'q', source: null, question: 'Un cas vécu ?' },
        { idee: 'Les données', texte: 'exporter avant de réinitialiser', mure: true, marque: null, source: null, enfants: [{ idee: 'L\'export', texte: 'garder l\'historique', mure: true, marque: null, source: null }] },
        { idee: 'Vide', texte: '', marque: null, source: null },
      ],
    },
  ],
})
const d = sortie.decoupages[0]
verifier('sortie : un decoupage, trois pieces (la vide tombe)', sortie.decoupages.length === 1 && d.pieces.length === 3)
verifier('sortie : idee lue sans point final', d.pieces[0].idee === 'Le tilt', JSON.stringify(d.pieces[0].idee))
verifier('sortie : fondation lue', d.pieces[1].mure === true && d.pieces[0].enfants?.[1].mure === true)
verifier('sortie : un noeud a creuser n\'est pas mure', d.pieces[0].mure === undefined && d.pieces[0].enfants?.[0].mure === undefined)
verifier('sortie : « fondation » avec enfants = se creuse', d.pieces[2].mure === undefined && d.pieces[2].enfants?.length === 1)
verifier('sortie : aucun tiret long', !JSON.stringify(sortie).includes('—'))
verifier('sortie : le trou garde sa question', d.pieces[1].marque === 'q' && d.pieces[1].question === 'Un cas vécu ?')

// --- 6. Le geste idee (la grande idee d'une bulle) et le lot idees -------------
const sysIdee = texteSysteme('PROMPT 1 DE LA METHODE', 'idee')
verifier('idee : consigne propre au geste', sysIdee.includes('LE NOM DU NŒUD CIBLE') && !sysIdee.includes('DU GÉNÉRAL AU PARTICULIER') && !sysIdee.includes('UNE PHRASE POUR EXPLIQUER'))
verifier('idee : un nom, pas une phrase (1 a 5 mots, pas de verbe conjugue, pas de point final)', sysIdee.includes('UN NOM, PAS UNE PHRASE') && /1 à 5 mots/.test(sysIdee) && /jamais un verbe conjugué, pas de point final/.test(sysIdee))
verifier('idee : nommer ce que la phrase ILLUSTRE, pas la resumer', /ILLUSTRE, pas ce qu'il raconte/.test(sysIdee) && /tu ne la résumes pas mot à mot/.test(sysIdee))
verifier('idee : l\'exemple de Brice (Florent, Non-respect de la prop firm)', sysIdee.includes('« Non-respect de la prop firm »') && sysIdee.includes('Florent prenait sur la prop firm'))
verifier('idee : le texte du noeud ne change jamais', /Ne touche jamais au texte du nœud/.test(sysIdee))
verifier('idee : trois noms au plus, angles differents', /trois noms au plus/.test(sysIdee) && /jamais trois tournures du même/.test(sysIdee))
verifier('idee : outil rendre_noms, 3 au plus', OUTILS.idee.name === 'rendre_noms'
  && (OUTILS.idee.input_schema.properties.noms as { maxItems?: number }).maxItems === MAX_NOMS && MAX_NOMS === 3)
verifier('idee : le schema du nom dit « jamais une phrase »', /Jamais une phrase/.test(JSON.stringify(OUTILS.idee.input_schema)))
const eIdee = entree2('idee', 'cccccccc')
verifier('idee : lignee dite et MODE idee', eIdee.includes('- MODE : idee') && eIdee.includes('- LIGNÉE DU NŒUD') && eIdee.includes('rendre_noms'))
const demIdee = lireDemande({ geste: 'idee', decoupage_id: ligne.id, cible: 'cccccccc' })
verifier('demande idee lue', typeof demIdee !== 'string' && demIdee.geste === 'idee' && demIdee.cible === 'cccccccc')
verifier('demande idee sans cible refusee', lireDemande({ geste: 'idee', decoupage_id: ligne.id }) === 'cible requise pour un nom.')
const nomsIdee = validerIdee({ noms: ['  Non-respect de la prop firm.  ', 'non-respect de la prop firm', '« Le compte des autres »', 'Florent prenait des trades qu\'il n\'aurait jamais pris', 'La revanche — tout de suite', 'Quatrième'] })
verifier('sortie idee : point final, guillemets, doublon et phrase tombent, 3 au plus', JSON.stringify(nomsIdee.noms) === JSON.stringify(['Non-respect de la prop firm', 'Le compte des autres', 'La revanche - tout de suite']), JSON.stringify(nomsIdee))
verifier('sortie idee : plus de 5 mots = une phrase, refusee', lireNom('Florent prenait sur la prop firm des trades') === null && lireNom('Non-respect de la prop firm') === 'Non-respect de la prop firm')
verifier('sortie idee illisible = aucun nom', validerIdee(null).noms.length === 0)

// Le lot : les noeuds sans nom, en un appel.
const noeudsLot = lireNoeuds([
  { id: 'n1', parent: null, ordre: 0, texte: 'ce qui se passe dans la tete', idee: 'La psychologie' },
  { id: 'n2', parent: 'n1', ordre: 0, texte: 'Florent prenait sur la prop firm des trades qu\'il n\'aurait jamais pris sur son compte propre' },
  { id: 'n3', parent: 'n1', ordre: 1, texte: 'Tu coupes tes gains trop tot parce que tu as peur de les rendre.' },
  { id: 'n4', parent: null, ordre: 1, texte: '   ' },
  { id: 'n5', parent: null, ordre: 2, texte: 'Tu rejoues le trade perdu pour te refaire.' },
])
const sansNom = noeudsSansNom(noeudsLot).map((n) => n.id)
verifier('lot : les noeuds sans nom, dans l\'ordre de l\'arbre (nomme et vide exclus)', sansNom.join() === 'n2,n3,n5', sansNom.join())
const beaucoup = lireNoeuds(Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, parent: null, ordre: i, texte: `Bulle ${i}` })))
verifier('lot : plafond de 40 noeuds', noeudsSansNom(beaucoup).length === MAX_LOT_IDEES && MAX_LOT_IDEES === 40)
const ligneLot: LigneDecoupage = { ...ligne, noeuds: noeudsLot }
const eLot = entreesPrompt1({ geste: 'idees', auteur: 'Brice', ligne: ligneLot, cible: null, matiereAuteur: false, matiereCollee: null, outil: OUTILS.idees.name })
verifier('lot : la liste NŒUDS À NOMMER donne les refs et la lignee', eLot.includes('- NŒUDS À NOMMER (3,') && eLot.includes('ref n2 (num 1.1)') && /ref n2 .*La psychologie : .* > Florent prenait/.test(eLot) && !eLot.includes('ref n1 (num'))
verifier('lot : MODE idees et outil nomme', eLot.includes('- MODE : idees') && eLot.includes('rendre_noms_du_lot'))
const sysLot = texteSysteme('PROMPT 1 DE LA METHODE', 'idees')
verifier('lot : consigne propre, meme regle du nom', sysLot.includes('LES NOMS DES NŒUDS À NOMMER') && sysLot.includes('UN NOM, PAS UNE PHRASE') && /Deux nœuds frères ne reçoivent pas le même nom/.test(sysLot))
const schemaLot = OUTILS.idees.input_schema.properties.noeuds as { maxItems?: number; items: { required: string[]; properties: { noms: { maxItems?: number } } } }
verifier('lot : schema (ref + 3 noms, 40 noeuds au plus)', OUTILS.idees.name === 'rendre_noms_du_lot' && schemaLot.maxItems === 40 && schemaLot.items.required.join() === 'ref,noms' && schemaLot.items.properties.noms.maxItems === 3)
const demLot = lireDemande({ geste: 'idees', decoupage_id: ligne.id, cible: 'n2' })
verifier('demande idees lue, cible ignoree', typeof demLot !== 'string' && demLot.geste === 'idees' && demLot.cible === null)
const lot = validerIdees({
  noeuds: [
    { ref: 'n5', noms: ['La revanche', 'Se refaire.'] },
    { ref: 'n2', noms: ['Non-respect de la prop firm', 'Le compte des autres'] },
    { ref: 'n2', noms: ['Doublon de ref'] },
    { ref: 'n1', noms: ['Deja nomme, pas demande'] },
    { ref: 'inconnu', noms: ['Hors arbre'] },
    { ref: '1.2', noms: ['Couper trop tot'] },
    { ref: 'n4', noms: ['Pas demande'] },
  ],
}, noeudsLot, sansNom)
verifier('sortie lot : seuls les noeuds demandes, une fois, dans l\'ordre de l\'arbre', lot.noeuds.map((x) => x.ref).join() === 'n2,n3,n5', JSON.stringify(lot))
verifier('sortie lot : un num rendu a la place d\'une ref est ramene a sa ref', lot.noeuds[1]?.noms[0] === 'Couper trop tot')
verifier('sortie lot : les noms sont nettoyes (point final)', lot.noeuds[2]?.noms.join('|') === 'La revanche|Se refaire')
verifier('sortie lot illisible = aucun noeud', validerIdees(null, noeudsLot, sansNom).noeuds.length === 0)

console.log(ecarts ? `\n${ecarts} ecart(s)` : '\nTout est conforme.')
process.exit(ecarts ? 1 : 0)
