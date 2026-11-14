// Versions et feuille de route du Journal d'Études.
//
// Même rôle que l'écran « Versions » du Guide du Carnet du Trader : l'archive
// exhaustive de ce qui a changé, mise à jour à chaque palier, pour qu'un membre
// n'ait jamais à retrouver un post pour savoir ce qui a bougé.
// Sources internes : ROADMAP.md (le principe de versionnage par module),
// TODO.md et ETAT.md (les paliers), le git log de master (ce qui est en ligne).
// Ne rien annoncer ici qui ne soit pas livré : aucune date, aucune fonction à
// venir décrite (consigne du 13/11/2026). La feuille de route ne dit que l'ordre
// des modules, déjà décidé le 17/07/2026.
//
// Le numéro affiché suit les espaces du menu : 0.1 Étudier mes notes (clos le
// 31/08/2026), 0.2 Observer les concepts (en cours). À bumper quand Brice juge
// un module exploitable. Tout ce qui sort entre-temps est daté dans l'entrée 0.2,
// même quand ça touche un autre espace (« Mes trades », le 05/11/2026).
//
// À chaque palier livré : une ligne datée en tête de l'entrée en cours, et
// MISE_A_JOUR à la date du jour. Les versions du Carnet vivent dans son Guide :
// ici, seulement la version publiée sur le Chrome Web Store (lue par
// publier_carnet_store.py --etat).
export const VERSION_JOURNAL = '0.2'
export const MISE_A_JOUR = '13 novembre 2026'

export type EntreeFeuilleDeRoute = { titre: string; detail: string }
export type EntreeVersion = { version: string; titre: string; quand: string; items: string[] }
export type AppLiee = { titre: string; paragraphes: string[]; lien: { href: string; libelle: string } }

export const FEUILLE_DE_ROUTE: EntreeFeuilleDeRoute[] = [
  {
    titre: 'Un module à la fois, dans l\'ordre du menu',
    detail: 'Après Observer les concepts viennent Relire, Analyser mes données, Pattern Maps, la carte A/B/C-game, le Rituel de séance, puis Documenter mes trades. Ces écrans existent déjà : un module se ferme quand il est assez solide pour être montré à un élève sans s\'excuser.',
  },
  {
    titre: 'Tes retours font bouger l\'ordre',
    detail: 'Ce qui te manque passe devant. Dis-le dans « Aide et idées », en bas à droite, puis « Il me manque quelque chose ».',
  },
]

export const APPS_LIEES: AppLiee[] = [
  {
    titre: 'Le Carnet du Trader',
    paragraphes: [
      'L\'extension où tu écris pendant ta séance : ton analyse, tes captures, tes trades et ton jugement A/B/C. Chaque note du Carnet arrive ici, dans « Étudier mes notes », et c\'est ici que tu l\'étudies.',
      'C\'est aussi dans le Carnet que tu importes l\'export de ton broker, depuis la 1.8.13 : menu de la roue, puis « Importer mes trades ». Ces trades nourrissent « Mes trades ».',
      'Le Carnet a son propre numéro et son propre historique, dans l\'écran Versions de son Guide. Au 13 novembre 2026, la version publiée sur le Chrome Web Store est la 1.10.0.',
    ],
    lien: {
      href: 'https://chromewebstore.google.com/detail/trading-notes-by-aoknowle/phajegonlmgnjkkfdooedoddnmgpheic',
      libelle: 'Le Carnet sur le Chrome Web Store',
    },
  },
  {
    titre: 'Pilotage',
    paragraphes: [
      'L\'app de pilotage financier du trader : ce que te coûtent tes comptes de trading, relié à tes finances du mois. Les trades que tu importes dans le Carnet y vont aussi, au même endroit.',
      'Pilotage a sa propre page de versions et de feuille de route.',
    ],
    lien: {
      href: 'https://pilotage.aoknowledge.com/versions',
      libelle: 'Les versions de Pilotage',
    },
  },
]

export const HISTORIQUE: EntreeVersion[] = [
  {
    version: '0.2',
    titre: 'Observer les concepts',
    quand: 'en cours depuis le 31 août 2026',
    items: [
      '13 novembre : le Journal retrouve sa police. Depuis mars, hors de l\'accueil, il s\'affichait dans la police de secours du navigateur au lieu de la sienne.',
      '6 novembre : la bouée du support s\'appelle désormais « Aide et idées ». Dedans, « Il me manque quelque chose » : dis-nous ce qui te manque ou ce qui coince, avec une capture si tu veux, et ajoute un « Moi aussi » à ce qui est déjà prévu.',
      '6 novembre : quand l\'import d\'un fichier de trades échoue, ou que ton fichier n\'est pas reconnu, le Journal te propose de le dire à l\'équipe. La phrase est déjà écrite, tu la complètes, et rien ne part sans ton « Envoyer ».',
      '5 novembre : « Mes trades », dans « Documenter mes trades ». Tes trades notés dans le Carnet, croisés avec ceux de ton broker : un calendrier du mois, les trades du jour que tu choisis, et pour chacun le chemin de ton stop à ton TP en R, avec ton entrée et tes sorties réelles. Les écarts se lisent en mots : « mieux que prévu », « avant ton TP », « stop dépassé ».',
      '5 novembre : chaque trade a sa fiche, avec « Ouvrir la note » en haut, près de ton grade. Le badge de trade d\'une note mène à sa fiche.',
      '5 novembre : le Guide devient un tutoriel en neuf étapes, en trois temps : noter dans le Carnet, étudier dans le Journal, vérifier avec le broker. À ta première visite, il s\'ouvre en carrousel ; ensuite, il se lit pas à pas, et « Revoir pas à pas » relance le carrousel.',
      '5 novembre : « Actualiser mes notes », en bas de la barre de droite de l\'accueil. La carte ne se recharge plus toute seule pendant que tu travailles : tes nouvelles notes arrivent quand tu cliques, et les cartes déjà posées se mettent à jour avec.',
      '25 septembre : la connexion propose d\'abord un lien reçu par e-mail. Si ton compte a été créé avec Google, il n\'a pas de mot de passe : l\'écran te le dit et te montre le bon chemin, et une inscription avec une adresse déjà connue te renvoie vers la connexion.',
      '24 septembre : la note D. Si tu l\'actives dans le Carnet, un trade noté D (D+, D ou D-) compte partout dans le Journal : relecture, analyse, concepts et brief du mentor. Elle n\'apparaît que si tu l\'utilises. Corrigé au passage : la carte A/B/C-game range aussi les nuances (B+, B-) dans leur lettre.',
      '18 septembre : les « tags auto » du carnet posent aussi des concepts, qui arrivent ici sans que tu aies rien à saisir.',
      '8 septembre : « Importer mes trades », dans Analyser mes données. Dépose l\'export Performance de Tradovate : aperçu, confirmation, zéro doublon si tu redéposes le même fichier, retrait possible. Le brief du mentor lit ces trades en ratios (profit factor en tête, win rate, payoff, par instrument), jamais en montants.',
      '8 septembre : le brief du mentor s\'enrichit. Résultats en R (total, gagnant et perdant moyens, win rate d\'équilibre, R par grade), répartition par jour et par heure d\'entrée, part de A mois par mois, et tes cinq derniers jugements B ou C dans tes mots.',
      '8 septembre : la file de relecture accepte les nuances A+, A-, B+, B-, C+, C-, comme le carnet. Les statistiques comptent toujours par lettre.',
      '3 septembre : te déconnecter ne coupe plus que l\'appareil où tu cliques, et plus toutes tes sessions.',
      '31 août et 1er septembre : « Dans la base », la première marche de la fiche du concept, et deux premières fiches sourcées.',
      '31 août : les 129 étiquettes sont classées en 9 catégories, et chaque concept a sa page : la galerie de tes captures, tes références séance par séance, les concepts voisins. Règle d\'honnêteté des chiffres : jamais de pourcentage sous un seuil, les nombres bruts à la place.',
    ],
  },
  {
    version: '0.1.7',
    titre: 'La passe esthétique',
    quand: '31 août 2026, elle clôt le 0.1',
    items: [
      'La grammaire des traits du canvas : appartenance, filiation et association se lisent d\'un coup d\'oeil.',
      'La carte de relecture passe en deux colonnes, le graphique d\'un côté, ce que tu en avais tiré de l\'autre, avec le bouton « Retravailler ».',
      'Ménage des pages de laboratoire qui ont servi à trancher ces choix.',
    ],
  },
  {
    version: '0.1.6 vers 0.1.7',
    titre: 'L\'entre-deux de l\'été',
    quand: 'juillet et août 2026',
    items: [
      'La bouée du support AOK dans le journal : une IA qui connaît l\'outil répond, et « Parler à un humain » transmet le fil complet (29 août).',
      'Retirer un jugement A/B/C posé par erreur (29 août).',
      'Les sous-dossiers du carnet sont reconnus, sur un niveau de profondeur (28 août).',
      'Le canvas : des traits en courbes animés au survol, huit poignées d\'accroche, une connexion aimantée, changer le côté d\'accroche d\'un trait sans le refaire, et les concepts qui arrivent sur le canvas d\'une note (du 26 juillet au 1er août).',
      'Le journal au téléphone : un écran de lecture dédié, la relecture au pouce, poser un bloc et relier au doigt, la recherche dans les notes (25 juillet).',
      'La connexion au compte Ao Knowledge, le même que sur le site et dans l\'extension (25 juillet).',
      'Un accueil avant connexion, un onboarding en surcouche et un écran de connexion refait (24 juillet).',
    ],
  },
  {
    version: '0.1.6',
    titre: 'La connectique de l\'accueil vers les concepts',
    quand: '23 et 24 juillet 2026',
    items: [
      'Un noeud-concept se pose sur la carte de l\'accueil, et relier une note à ce noeud la tague. Les traits restent visibles après rechargement, un double-clic les nomme.',
    ],
  },
  {
    version: '0.1.5',
    titre: 'Les collections',
    quand: '19 juillet 2026',
    items: [
      'Grouper des notes sur l\'accueil, puis « Mapper » le groupe : un canvas commun qui embarque les blocs de toutes ces notes.',
      'Une note peut vivre dans plusieurs collections ; la collection a son titre et son tiroir de notes.',
      'La relecture des collections, en vue canvas ou en vue document, et la Bibliothèque : l\'inventaire permanent des notes travaillées.',
    ],
  },
  {
    version: '0.1.4',
    titre: 'La syntaxe [[concept]]',
    quand: '18 juillet 2026',
    items: [
      'Dans la barre de saisie, taper [[ ouvre la liste de tes concepts ; chaque [[nom]] relie le bloc au concept, et tu peux créer le concept à la volée.',
    ],
  },
  {
    version: '0.1.3',
    titre: 'Groupes et liens',
    quand: '18 juillet 2026',
    items: [
      'Promouvoir un groupe (le bouton #) crée le concept et tague tout son contenu ; le groupe reste vivant, ce qui y entre ensuite prend le concept.',
    ],
  },
  {
    version: '0.1.2',
    titre: 'Le contrat de données entre le carnet et le journal',
    quand: '17 juillet 2026',
    items: [
      'Une métadonnée n\'est jamais du contenu : elle reste en base mais masquée par défaut. Plus de blocs vides, et le dépôt d\'une note depuis l\'extension ne meurt plus en silence.',
    ],
  },
  {
    version: '0.1.1',
    titre: 'Le poste de travail note',
    quand: '17 juillet 2026',
    items: [
      'Un double-clic sur une carte de l\'accueil ouvre la note, le vrai poste de travail. Les images se zooment dans les panneaux.',
    ],
  },
  {
    version: 'Avant le 0.1',
    titre: 'Les fondations',
    quand: 'd\'octobre 2025 à juillet 2026',
    items: [
      'La capture depuis l\'extension, la synchronisation, le canvas de notes reliées, les concepts, la relecture : le moteur du journal, en bêta ouverte depuis l\'automne 2025.',
      'Le 16 juillet 2026, tous les écrans passent sur le même langage que l\'accueil, et le versionnage par module démarre le lendemain.',
    ],
  },
]
