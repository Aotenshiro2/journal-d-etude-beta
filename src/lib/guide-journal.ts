// Le tutoriel du Journal (brief J2, 05/11/2026) : les neuf étapes du labo
// LABO-MES-TRADES-V1, en trois temps (noter, étudier, vérifier), dans UN module
// partagé par les deux présentations : GuideCarrousel (une étape par écran, à
// la première ouverture de /guide) et GuidePasAPas (les neuf sur une page).
// Puis « Aller plus loin » : ce que les neuf étapes ne couvrent pas (concepts,
// analyse, mental game, l'extension), repris de l'ancienne page « Le parcours ».
//
// Vignettes : public/guide/etape-N.png. Tant que l'image manque, la vignette
// affiche sa légende dans un cadre neutre (les vraies captures viendront après
// le labo 2).

export type Temps = 'noter' | 'etudier' | 'verifier'

export const TEMPS: Record<Temps, { libelle: string; teinte: string }> = {
  noter: { libelle: 'Noter, dans le Carnet', teinte: '#3b82f6' },
  etudier: { libelle: 'Étudier, dans le Journal', teinte: '#f59e0b' },
  verifier: { libelle: 'Vérifier, avec le broker', teinte: '#8b5cf6' },
}

export interface LienGuide { libelle: string; href: string; externe?: boolean }

export interface EtapeGuide {
  temps: Temps
  titre: string
  /** Deux lignes au plus. */
  texte: string
  /** La légende de la vignette, affichée tant que l'image manque. */
  vignette: string
  /** public/guide/etape-N.png */
  image: string
  /** L'étape des blocs montre chaque sorte de bloc. */
  blocs?: boolean
  lien?: LienGuide
}

/** Les sortes de blocs d'une note (étape 3). */
export const BLOCS_NOTE = ['Texte', 'Capture', 'Trade', 'Warmup', 'Cooldown', 'DOL']

const etapes: Omit<EtapeGuide, 'image'>[] = [
  {
    temps: 'noter', titre: 'Noter pendant la séance',
    texte: 'Dans le Carnet, ton analyse, tes captures, puis « Lancer un trade » au moment où tu entres. Tape ton entrée, ton stop et ton TP.',
    vignette: 'Carnet : une note avec un trade lancé',
  },
  {
    temps: 'etudier', titre: 'Ta note arrive dans le Journal',
    texte: 'Ouvre « Étudier mes notes » : chaque note du Carnet y devient une carte, avec ses blocs.',
    vignette: 'Journal : la carte des notes',
    lien: { libelle: 'Ouvrir la carte', href: '/' },
  },
  {
    temps: 'etudier', titre: "Les blocs d'une note",
    texte: "Chaque message, capture ou trade de la note est un bloc. Ils gardent l'ordre de ta séance.",
    vignette: 'Une note ouverte et ses blocs', blocs: true,
  },
  {
    temps: 'etudier', titre: 'Réorganiser',
    texte: "Trie les blocs en groupes, « ça va avec ça », puis passe en vue document. Ta note d'origine n'est jamais touchée.",
    vignette: 'Des blocs groupés',
  },
  {
    temps: 'etudier', titre: 'Juger A, B ou C',
    texte: 'Une lettre et une phrase par trade, sans regarder le résultat : un A peut être une perte bien jouée.',
    vignette: "Le jugement d'un trade",
  },
  {
    temps: 'etudier', titre: 'Relire',
    texte: 'La relecture te repropose tes notes et tes jugements pour les mémoriser.',
    vignette: "L'écran de relecture",
    lien: { libelle: 'Relecture', href: '/review' },
  },
  {
    temps: 'verifier', titre: "Importer l'export du broker",
    texte: 'Dans le Carnet, ouvre le menu de la roue, puis « Importer mes trades » : CSV, PDF ou capture. Les trades vont au même endroit que dans Pilotage.',
    vignette: "Carnet : la boîte d'import",
  },
  {
    temps: 'verifier', titre: 'Lier le trade de ta note',
    texte: '« Lier » propose les trades du broker du jour de ta note. Des comptes copiés se lient d\'un coup.',
    vignette: 'Carnet : Lier les 3',
  },
  {
    temps: 'verifier', titre: 'Prévu contre effectif',
    texte: 'Dans « Mes trades », compare ce que tu avais prévu à ce que le broker a exécuté, et vois où tu dévies.',
    vignette: "Journal : la fiche d'un trade",
    lien: { libelle: 'Mes trades', href: '/journal' },
  },
]

export const ETAPES_GUIDE: EtapeGuide[] = etapes.map((e, i) => ({ ...e, image: `/guide/etape-${i + 1}.png` }))

const CWS = 'https://chromewebstore.google.com/detail/trading-notes-by-aoknowle/phajegonlmgnjkkfdooedoddnmgpheic'
const PAGE_EXTENSION = 'https://aoknowledge.com/library/extension'

export interface ItemPlusLoin { titre: string; texte: string; liens: LienGuide[] }

/** Ce que les neuf étapes ne couvrent pas, repris de l'ancienne page « Le parcours ». */
export const ALLER_PLUS_LOIN: { titre: string; teinte: string; items: ItemPlusLoin[] }[] = [
  {
    titre: 'Comprendre', teinte: '#3b82f6',
    items: [
      { titre: 'Observer les concepts', texte: 'Les contextes et variantes qui reviennent dans tes notes émergent ici, avec leurs liens (« va avec »).', liens: [{ libelle: 'Concepts', href: '/concepts' }] },
      { titre: 'Analyser', texte: 'Où tu perds (causes), ta note face au résultat, ta progression. Le but : faire fondre tes C.', liens: [{ libelle: 'Analyse', href: '/analytics' }] },
    ],
  },
  {
    titre: 'Le mental game', teinte: '#a78bfa',
    items: [
      { titre: 'Rituel de séance', texte: "Un warmup avant (ton état, ton objectif du jour), un cooldown après (erreurs, leçon). Il cadre ta journée et décharge l'émotion.", liens: [{ libelle: 'Rituel de séance', href: '/session' }] },
      { titre: 'Pattern Maps', texte: "Cartographie tes problèmes récurrents (tilt, revenge, FOMO), du déclencheur à l'erreur, pour repérer ton point de bascule.", liens: [{ libelle: 'Pattern Maps', href: '/patterns' }] },
    ],
  },
  {
    titre: "L'extension", teinte: '#f59e0b',
    items: [
      {
        titre: 'Le Carnet du Trader', texte: 'Capture tes cours et tes séances sans friction, pendant que tu regardes ou que tu trades.',
        liens: [{ libelle: "Installer l'extension", href: CWS, externe: true }, { libelle: 'La page dédiée', href: PAGE_EXTENSION, externe: true }],
      },
    ],
  },
]
