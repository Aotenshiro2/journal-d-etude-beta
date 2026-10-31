// Les choix d'abonnement aux emails (31/10/2026, decision de Brice) : UNE
// liste, la seule. La lisent :
// - les routes /api/compte/abonnements (la carte « Mes emails » du site recoit
//   les libelles par la route, elle n'a pas sa propre liste) ;
// - l'inscription /api/newsletter/subscribe (choix poses d'office) ;
// - les scripts de bascule (scripts/kit-bascule-*.mjs : rattrapage, reciblage,
//   relecture).
// Ajouter un choix = une ligne ici, avec l'id d'un tag qui EXISTE deja chez
// Kit (on n'en cree jamais depuis le code). Rien d'autre a retoucher.
//
// Champs :
//   cle         stable : elle nomme le choix dans le journal des
//               consentements (profile_consentements.type). Ne pas la changer
//               quand le libelle change.
//   tag         id du tag Kit qui porte le choix.
//   libelle     titre de l'interrupteur (tutoiement de Mon espace).
//   detail      la ligne sous le titre.
//   inscription pose d'office a l'inscription (true) ou laisse decoche.
//   rattrapage  a la bascule, parmi les abonnes ACTIFS : { tagRequis: null }
//               = tous, { tagRequis: n } = seulement ceux qui ont le tag n,
//               null = personne.
//
// Ce fichier n'importe rien et n'a que des types effacables : les scripts
// Node l'importent tel quel (../src/lib/kit-choix.ts).

export type ChoixKit = {
  cle: string
  tag: number
  libelle: string
  detail: string
  inscription: boolean
  rattrapage: { tagRequis: number | null } | null
}

/** « GDPR: Advertising Consent » : le consentement explicite aux promos, avant la bascule. */
export const TAG_CONSENTEMENT_PUB = 11576519

export const CHOIX_KIT: readonly ChoixKit[] = [
  {
    cle: 'newsletter_hebdo',
    tag: 25238321, // « Choix - Newsletter hebdo »
    libelle: 'La newsletter du samedi',
    detail: 'Chaque samedi matin.',
    inscription: true,
    rattrapage: { tagRequis: null },
  },
  {
    cle: 'monthly_news',
    tag: 25238322, // « Choix - Monthly news »
    libelle: "Les Échos de l'Académie",
    detail: 'Les nouvelles du mois.',
    inscription: true,
    rattrapage: { tagRequis: null },
  },
  {
    cle: 'conseils_semaine',
    tag: 25238323, // « Choix - Conseils de la semaine »
    libelle: 'Les conseils de la semaine',
    detail: 'AOK Minute : un conseil court, au fil de la semaine.',
    inscription: true,
    rattrapage: { tagRequis: null },
  },
  {
    cle: 'nos_offres',
    tag: 25238607, // « Choix - Nos offres » (promos et nouveautes de NOS produits et licences)
    libelle: 'Nos offres',
    detail: 'Promos et nouveautés de nos formations, du Live Club et de nos apps.',
    inscription: true,
    rattrapage: { tagRequis: null },
  },
  {
    // Accord explicite : decochee a l'inscription, rattrapage aux seuls consentants.
    cle: 'partenaires',
    tag: 25238324, // « Choix - Offres partenaires » (ex « Promos et partenaires »)
    libelle: 'Offres de nos partenaires',
    detail: "Des bons plans que nous relayons. Ton adresse n'est pas transmise : c'est nous qui t'écrivons.",
    inscription: false,
    rattrapage: { tagRequis: TAG_CONSENTEMENT_PUB },
  },
]

/** Le choix que visent les newsletters du samedi (reciblage S46 a S50 a la bascule). */
export const CLE_NEWSLETTER_HEBDO = 'newsletter_hebdo'
