// FICHIER GENERE par apps/journal-d-etude/scripts/generer-connaissances.mjs
// depuis apps/journal-d-etude/docs/connaissances/*.md. Ne pas modifier a la
// main : corriger le doc, puis relancer le script.
//
// Module PUR (aucun import) : la base de connaissances produits d'AOKnowledge,
// lue par les bots et par le site.

export type SujetConnaissance = "academie" | "carnet-du-trader" | "connexion" | "dix-pour-cent-club" | "espace-membre" | "journal-d-etudes" | "liens-utiles" | "live-club" | "masterclass" | "pilotage" | "ressources-gratuites"

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

export const SUJETS_CONNAISSANCES: readonly SujetConnaissance[] = ["academie", "carnet-du-trader", "connexion", "dix-pour-cent-club", "espace-membre", "journal-d-etudes", "liens-utiles", "live-club", "masterclass", "pilotage", "ressources-gratuites"]

export const CONNAISSANCES: readonly DocConnaissance[] = [
  {
    "sujet": "academie",
    "titre": "L'académie",
    "resume": "Les cours vidéo et écrits d'AOKnowledge sur aoknowledge.com/academie, avec ta progression. Des cours gratuits avec un compte, une partie ouverte par le Live Club, tout avec la formation complète.",
    "motsCles": [
      "académie",
      "cours",
      "modules",
      "formation",
      "leçons",
      "vidéos",
      "progression",
      "parcours",
      "prix",
      "unité",
      "gratuit"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "L'académie, sur le site, rassemble les cours d'AOKnowledge, en vidéo ou en lecture. Ton accueil montre tes cours avec leur progression et un bouton Continuer pour reprendre où tu t'es arrêté.\n\nLe parcours : Bienvenue, Novice en trading, Les bases Smart Money, La Formation complète, Plan de Trading en 21 jours, Macros : Les Archives Privées.\nLes cours écrits : Psychologie et émotions, Chroniques de l'Accélérateur, Journaling : la clé de ta progression, Sérénité Financière.\nÀ part : L'Appât du Grand Public."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour tous les élèves : du débutant complet (Novice en trading commence de zéro) au trader qui veut reprendre une partie précise."
      },
      {
        "titre": "Prix et accès",
        "texte": "- Connexion obligatoire avec ton compte AOKnowledge.\n- Gratuit avec un compte : Bienvenue, Novice en trading et Les bases Smart Money.\n- Inclus dans le Live Club, tant que l'abonnement est actif : Bienvenue, Novice en trading, Les bases Smart Money, la partie 1 de La Formation complète (épisodes 0 à 19), Plan de Trading en 21 jours, Psychologie et émotions. L'académie les retrouve par l'email de ton abonnement.\n- Tout le catalogue avec la formation complète du 10% Club (1 999 €).\n- Prix affichés à l'unité : Plan de Trading en 21 jours 39 €, Psychologie et émotions 49 €, Journaling 49 €, Chroniques de l'Accélérateur 79 €, Sérénité Financière 99 €, Macros : Les Archives Privées 399 €. La vente à l'unité n'est pas encore ouverte : le bouton d'achat est grisé pour l'instant.\n- L'Appât du Grand Public se débloquera avec ta participation, quand les points de l'académie seront en place. Si tu l'avais déjà, tu le gardes."
      },
      {
        "titre": "Comment y aller",
        "texte": "- https://aoknowledge.com/academie (une fois connecté, le bouton du compte en haut du site y mène)"
      }
    ],
    "questions": [
      {
        "q": "Un cours que j'ai payé n'apparaît pas.",
        "r": "Tes accès se retrouvent par l'email vérifié de ton compte. Si tu as payé avec une autre adresse, écris au support en précisant cette adresse : l'équipe fait le lien."
      },
      {
        "q": "Je suis au Live Club, où est la formation ?",
        "r": "Sur l'académie du site, https://aoknowledge.com/academie : connecte-toi avec l'email de ton abonnement, et les cours inclus dans le Live Club s'ouvrent."
      },
      {
        "q": "Je peux acheter un seul module ?",
        "r": "Pas encore : les prix à l'unité sont affichés, mais l'achat n'est pas encore ouvert. La formation complète, elle, est disponible avec le 10% Club."
      }
    ],
    "texte": "L'académie. Les cours vidéo et écrits d'AOKnowledge sur aoknowledge.com/academie, avec ta progression. Des cours gratuits avec un compte, une partie ouverte par le Live Club, tout avec la formation complète.\n\nCe que c'est :\nL'académie, sur le site, rassemble les cours d'AOKnowledge, en vidéo ou en lecture. Ton accueil montre tes cours avec leur progression et un bouton Continuer pour reprendre où tu t'es arrêté.\n\nLe parcours : Bienvenue, Novice en trading, Les bases Smart Money, La Formation complète, Plan de Trading en 21 jours, Macros : Les Archives Privées.\nLes cours écrits : Psychologie et émotions, Chroniques de l'Accélérateur, Journaling : la clé de ta progression, Sérénité Financière.\nÀ part : L'Appât du Grand Public.\n\nPour qui :\nPour tous les élèves : du débutant complet (Novice en trading commence de zéro) au trader qui veut reprendre une partie précise.\n\nPrix et accès :\n- Connexion obligatoire avec ton compte AOKnowledge.\n- Gratuit avec un compte : Bienvenue, Novice en trading et Les bases Smart Money.\n- Inclus dans le Live Club, tant que l'abonnement est actif : Bienvenue, Novice en trading, Les bases Smart Money, la partie 1 de La Formation complète (épisodes 0 à 19), Plan de Trading en 21 jours, Psychologie et émotions. L'académie les retrouve par l'email de ton abonnement.\n- Tout le catalogue avec la formation complète du 10% Club (1 999 €).\n- Prix affichés à l'unité : Plan de Trading en 21 jours 39 €, Psychologie et émotions 49 €, Journaling 49 €, Chroniques de l'Accélérateur 79 €, Sérénité Financière 99 €, Macros : Les Archives Privées 399 €. La vente à l'unité n'est pas encore ouverte : le bouton d'achat est grisé pour l'instant.\n- L'Appât du Grand Public se débloquera avec ta participation, quand les points de l'académie seront en place. Si tu l'avais déjà, tu le gardes.\n\nComment y aller :\n- https://aoknowledge.com/academie (une fois connecté, le bouton du compte en haut du site y mène)\n\nQuestions fréquentes :\nQ : Un cours que j'ai payé n'apparaît pas.\nR : Tes accès se retrouvent par l'email vérifié de ton compte. Si tu as payé avec une autre adresse, écris au support en précisant cette adresse : l'équipe fait le lien.\nQ : Je suis au Live Club, où est la formation ?\nR : Sur l'académie du site, https://aoknowledge.com/academie : connecte-toi avec l'email de ton abonnement, et les cours inclus dans le Live Club s'ouvrent.\nQ : Je peux acheter un seul module ?\nR : Pas encore : les prix à l'unité sont affichés, mais l'achat n'est pas encore ouvert. La formation complète, elle, est disponible avec le 10% Club."
  },
  {
    "sujet": "carnet-du-trader",
    "titre": "Le Carnet du Trader",
    "resume": "L'extension de navigateur pour noter ses trades pendant la séance, gratuite, avec un Premium à 5,99 € par mois inclus pour les membres.",
    "motsCles": [
      "extension",
      "carnet",
      "chrome",
      "navigateur",
      "premium",
      "capture",
      "dictée",
      "notes",
      "panneau",
      "forfait"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "Le Carnet du Trader est l'extension de navigateur d'AOKnowledge. Elle s'ouvre dans un panneau latéral, à côté de ton graphique : tu notes ta séance sans changer d'onglet.\n- Notes, captures d'écran, trades avec un jugement A, B ou C sur la qualité de la décision (pas sur le résultat), warmups, DOL, dossiers.\n- Capture de la page : sur TradingView, le graphique, le ticker et l'unité de temps ; sur YouTube, le titre et la transcription ; sur Forex Factory, les événements du calendrier ; ailleurs, ce que tu sélectionnes.\n- Dictée vocale transcrite sur ta machine : la voix ne part sur aucun serveur.\n- Exports en PDF, en DOCX ou vers Google Drive, et synchronisation vers le Journal d'Études.\n- Raccourcis : Ctrl + Maj + A ouvre le panneau, Alt + Maj + C capture la page."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour tout trader qui veut garder une trace fiable de ses séances. Le carnet gratuit est complet. Le Premium ajoute l'IA dans le Carnet."
      },
      {
        "titre": "Prix et accès",
        "texte": "- Le Carnet gratuit : sans moyen de paiement, sans limite de durée. Un bouton « Analyser avec une IA » envoie ta note dans ton propre assistant IA, celui où tu as déjà un compte, avec la consigne déjà écrite.\n- Le Carnet Premium : 5,99 € par mois, ou 57,50 € par an (4,79 € par mois), sans engagement. Il ajoute la capture lue par l'IA, tes graphiques lus à l'image, tes notes approfondies et le mentorat qui te répond, selon la méthode de l'académie.\n- Le Premium est inclus, sans rien payer en plus, pour les membres du Live Club et du 10% Club : il suffit de se connecter dans l'extension avec son compte AOKnowledge.\n- L'abonnement Premium se prend depuis l'extension, onglet « Mon forfait », pour qu'il soit rattaché à la bonne adresse."
      },
      {
        "titre": "Comment y aller",
        "texte": "- L'installer : https://chromewebstore.google.com/detail/trading-notes-by-aoknowle/phajegonlmgnjkkfdooedoddnmgpheic?hl=fr&utm_source=ext_sidebar\n- La présentation : https://aoknowledge.com/library/extension\n- Navigateurs : Chrome, Brave, Opera et Edge."
      }
    ],
    "questions": [
      {
        "q": "Je suis membre du Live Club, je dois payer le Premium ?",
        "r": "Non. Le Premium est inclus. Connecte-toi dans l'extension avec le même email que ton compte AOKnowledge : l'écran « Mon forfait » doit afficher que tout est déjà ouvert. Si ce n'est pas le cas, l'équipe regarde."
      },
      {
        "q": "La dictée vocale ne marche pas.",
        "r": "Au premier usage, le navigateur demande l'autorisation du micro, puis le modèle de dictée, environ 170 Mo, se télécharge une fois. Le choix du micro se fait dans les Paramètres de l'extension, section Dictée vocale."
      },
      {
        "q": "Mes notes n'arrivent pas dans le Journal.",
        "r": "L'état de la synchronisation est affiché en bas du panneau. Si tu es déconnecté, reconnecte-toi depuis l'icône du compte, puis utilise « Tout renvoyer » dans Compte si besoin."
      },
      {
        "q": "Comment créer un sous-dossier ?",
        "r": "Survole un dossier dans l'historique et clique sur l'icône dossier avec un plus. Les sous-dossiers ont un niveau de profondeur."
      },
      {
        "q": "Le jugement A, B, C, c'est quoi ?",
        "r": "Il note la qualité de ta décision, pas le résultat du trade. Un trade perdant peut mériter un A."
      }
    ],
    "texte": "Le Carnet du Trader. L'extension de navigateur pour noter ses trades pendant la séance, gratuite, avec un Premium à 5,99 € par mois inclus pour les membres.\n\nCe que c'est :\nLe Carnet du Trader est l'extension de navigateur d'AOKnowledge. Elle s'ouvre dans un panneau latéral, à côté de ton graphique : tu notes ta séance sans changer d'onglet.\n- Notes, captures d'écran, trades avec un jugement A, B ou C sur la qualité de la décision (pas sur le résultat), warmups, DOL, dossiers.\n- Capture de la page : sur TradingView, le graphique, le ticker et l'unité de temps ; sur YouTube, le titre et la transcription ; sur Forex Factory, les événements du calendrier ; ailleurs, ce que tu sélectionnes.\n- Dictée vocale transcrite sur ta machine : la voix ne part sur aucun serveur.\n- Exports en PDF, en DOCX ou vers Google Drive, et synchronisation vers le Journal d'Études.\n- Raccourcis : Ctrl + Maj + A ouvre le panneau, Alt + Maj + C capture la page.\n\nPour qui :\nPour tout trader qui veut garder une trace fiable de ses séances. Le carnet gratuit est complet. Le Premium ajoute l'IA dans le Carnet.\n\nPrix et accès :\n- Le Carnet gratuit : sans moyen de paiement, sans limite de durée. Un bouton « Analyser avec une IA » envoie ta note dans ton propre assistant IA, celui où tu as déjà un compte, avec la consigne déjà écrite.\n- Le Carnet Premium : 5,99 € par mois, ou 57,50 € par an (4,79 € par mois), sans engagement. Il ajoute la capture lue par l'IA, tes graphiques lus à l'image, tes notes approfondies et le mentorat qui te répond, selon la méthode de l'académie.\n- Le Premium est inclus, sans rien payer en plus, pour les membres du Live Club et du 10% Club : il suffit de se connecter dans l'extension avec son compte AOKnowledge.\n- L'abonnement Premium se prend depuis l'extension, onglet « Mon forfait », pour qu'il soit rattaché à la bonne adresse.\n\nComment y aller :\n- L'installer : https://chromewebstore.google.com/detail/trading-notes-by-aoknowle/phajegonlmgnjkkfdooedoddnmgpheic?hl=fr&utm_source=ext_sidebar\n- La présentation : https://aoknowledge.com/library/extension\n- Navigateurs : Chrome, Brave, Opera et Edge.\n\nQuestions fréquentes :\nQ : Je suis membre du Live Club, je dois payer le Premium ?\nR : Non. Le Premium est inclus. Connecte-toi dans l'extension avec le même email que ton compte AOKnowledge : l'écran « Mon forfait » doit afficher que tout est déjà ouvert. Si ce n'est pas le cas, l'équipe regarde.\nQ : La dictée vocale ne marche pas.\nR : Au premier usage, le navigateur demande l'autorisation du micro, puis le modèle de dictée, environ 170 Mo, se télécharge une fois. Le choix du micro se fait dans les Paramètres de l'extension, section Dictée vocale.\nQ : Mes notes n'arrivent pas dans le Journal.\nR : L'état de la synchronisation est affiché en bas du panneau. Si tu es déconnecté, reconnecte-toi depuis l'icône du compte, puis utilise « Tout renvoyer » dans Compte si besoin.\nQ : Comment créer un sous-dossier ?\nR : Survole un dossier dans l'historique et clique sur l'icône dossier avec un plus. Les sous-dossiers ont un niveau de profondeur.\nQ : Le jugement A, B, C, c'est quoi ?\nR : Il note la qualité de ta décision, pas le résultat du trade. Un trade perdant peut mériter un A."
  },
  {
    "sujet": "connexion",
    "titre": "La connexion et le compte AOKnowledge",
    "resume": "Un seul compte AOKnowledge pour le site, l'académie, le Carnet, le Journal, Pilotage et les masterclass : Google, lien par email ou mot de passe.",
    "motsCles": [
      "connexion",
      "compte",
      "mot de passe",
      "google",
      "lien magique",
      "email",
      "se connecter",
      "oublié",
      "sessions",
      "déconnexion"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "Ton compte AOKnowledge est le même partout : le site et Mon espace, l'académie, l'extension Le Carnet du Trader, le Journal d'Études, Pilotage et les masterclass. Utilise le même email partout, c'est lui qui relie tes accès."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour toute personne qui utilise un service AOKnowledge."
      },
      {
        "titre": "Prix et accès",
        "texte": "Trois façons de se connecter :\n- avec Google ;\n- avec un lien de connexion reçu par email ;\n- avec ton email et un mot de passe.\n\nCréer un compte est gratuit."
      },
      {
        "titre": "Comment y aller",
        "texte": "- Se connecter sur le site : https://aoknowledge.com/connexion\n- Connexion et sécurité : https://aoknowledge.com/mon-espace/parametres/securite"
      }
    ],
    "questions": [
      {
        "q": "J'ai oublié mon mot de passe.",
        "r": "Sur la page de connexion, clique sur Mot de passe oublié et suis le lien reçu par email. Il t'amène dans Connexion et sécurité, où tu choisis le nouveau mot de passe, 8 caractères au moins. Compte créé avec Google : tu peux aussi y définir un mot de passe."
      },
      {
        "q": "Comment voir les appareils connectés ?",
        "r": "Connexion et sécurité liste tes sessions ouvertes. Tu peux en fermer une, ou tout déconnecter : le site, le Journal, l'extension et Pilotage te redemandent alors de te connecter."
      },
      {
        "q": "Je ne retrouve pas mes accès après connexion.",
        "r": "Vérifie que tu t'es connecté avec le même email que celui de ton achat ou de ton abonnement. Sinon, l'équipe fait le lien."
      }
    ],
    "texte": "La connexion et le compte AOKnowledge. Un seul compte AOKnowledge pour le site, l'académie, le Carnet, le Journal, Pilotage et les masterclass : Google, lien par email ou mot de passe.\n\nCe que c'est :\nTon compte AOKnowledge est le même partout : le site et Mon espace, l'académie, l'extension Le Carnet du Trader, le Journal d'Études, Pilotage et les masterclass. Utilise le même email partout, c'est lui qui relie tes accès.\n\nPour qui :\nPour toute personne qui utilise un service AOKnowledge.\n\nPrix et accès :\nTrois façons de se connecter :\n- avec Google ;\n- avec un lien de connexion reçu par email ;\n- avec ton email et un mot de passe.\n\nCréer un compte est gratuit.\n\nComment y aller :\n- Se connecter sur le site : https://aoknowledge.com/connexion\n- Connexion et sécurité : https://aoknowledge.com/mon-espace/parametres/securite\n\nQuestions fréquentes :\nQ : J'ai oublié mon mot de passe.\nR : Sur la page de connexion, clique sur Mot de passe oublié et suis le lien reçu par email. Il t'amène dans Connexion et sécurité, où tu choisis le nouveau mot de passe, 8 caractères au moins. Compte créé avec Google : tu peux aussi y définir un mot de passe.\nQ : Comment voir les appareils connectés ?\nR : Connexion et sécurité liste tes sessions ouvertes. Tu peux en fermer une, ou tout déconnecter : le site, le Journal, l'extension et Pilotage te redemandent alors de te connecter.\nQ : Je ne retrouve pas mes accès après connexion.\nR : Vérifie que tu t'es connecté avec le même email que celui de ton achat ou de ton abonnement. Sinon, l'équipe fait le lien."
  },
  {
    "sujet": "dix-pour-cent-club",
    "titre": "Le 10% Club",
    "resume": "La formation complète d'AOKnowledge, en vidéo sur l'Académie du site : 1 999 € en une fois, accès à vie, avec le Carnet Premium, le Journal d'Études et Pilotage.",
    "motsCles": [
      "10% club",
      "dix pour cent",
      "formation complète",
      "académie",
      "smart money",
      "paypal",
      "accès à vie",
      "club"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "Le 10% Club est la formation complète d'AOKnowledge : la lecture Smart Money du marché, le process et la psychologie du trader, en vidéo sur l'Académie du site (https://aoknowledge.com/academie). Tu avances à ton rythme.\n\nElle ouvre tout le catalogue de l'académie : Bienvenue, Novice en trading, Les bases Smart Money, La Formation complète (la logique du prix et du temps, puis les stratégies Breakers, Gaps, IOF), Plan de Trading en 21 jours, Macros : Les Archives Privées, Psychologie et émotions, Chroniques de l'Accélérateur, Journaling, Sérénité Financière et L'Appât du Grand Public."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour ceux qui veulent comprendre pourquoi le prix bouge plutôt que suivre la lecture de quelqu'un d'autre. Tu pars de zéro ? La formation commence par le module Novice en trading."
      },
      {
        "titre": "Prix et accès",
        "texte": "- 1 999 € en un seul paiement, accès à vie.\n- Ou en 4 fois sans frais avec PayPal, sous réserve d'éligibilité selon les critères de PayPal.\n- Les accès sont fournis sous 24 heures.\n- Inclus en plus du programme : le Carnet du Trader Premium, le Journal d'Études et Pilotage.\n- Le Live Club est un abonnement séparé, sans engagement, à 139 € par mois.\n- Droit de rétractation de 14 jours, qui cesse dès que la fourniture des contenus numériques a commencé avec ton accord."
      },
      {
        "titre": "Comment y aller",
        "texte": "- https://aoknowledge.com/club"
      }
    ],
    "questions": [
      {
        "q": "Le Live Club est compris dans le 10% Club ?",
        "r": "Non. Le 10% Club est la formation, le Live Club est l'entraînement en live : deux offres séparées, qui se cumulent."
      },
      {
        "q": "J'ai payé, je n'ai pas encore mes accès.",
        "r": "Les accès sont fournis sous 24 heures. Au-delà, l'équipe regarde."
      }
    ],
    "texte": "Le 10% Club. La formation complète d'AOKnowledge, en vidéo sur l'Académie du site : 1 999 € en une fois, accès à vie, avec le Carnet Premium, le Journal d'Études et Pilotage.\n\nCe que c'est :\nLe 10% Club est la formation complète d'AOKnowledge : la lecture Smart Money du marché, le process et la psychologie du trader, en vidéo sur l'Académie du site (https://aoknowledge.com/academie). Tu avances à ton rythme.\n\nElle ouvre tout le catalogue de l'académie : Bienvenue, Novice en trading, Les bases Smart Money, La Formation complète (la logique du prix et du temps, puis les stratégies Breakers, Gaps, IOF), Plan de Trading en 21 jours, Macros : Les Archives Privées, Psychologie et émotions, Chroniques de l'Accélérateur, Journaling, Sérénité Financière et L'Appât du Grand Public.\n\nPour qui :\nPour ceux qui veulent comprendre pourquoi le prix bouge plutôt que suivre la lecture de quelqu'un d'autre. Tu pars de zéro ? La formation commence par le module Novice en trading.\n\nPrix et accès :\n- 1 999 € en un seul paiement, accès à vie.\n- Ou en 4 fois sans frais avec PayPal, sous réserve d'éligibilité selon les critères de PayPal.\n- Les accès sont fournis sous 24 heures.\n- Inclus en plus du programme : le Carnet du Trader Premium, le Journal d'Études et Pilotage.\n- Le Live Club est un abonnement séparé, sans engagement, à 139 € par mois.\n- Droit de rétractation de 14 jours, qui cesse dès que la fourniture des contenus numériques a commencé avec ton accord.\n\nComment y aller :\n- https://aoknowledge.com/club\n\nQuestions fréquentes :\nQ : Le Live Club est compris dans le 10% Club ?\nR : Non. Le 10% Club est la formation, le Live Club est l'entraînement en live : deux offres séparées, qui se cumulent.\nQ : J'ai payé, je n'ai pas encore mes accès.\nR : Les accès sont fournis sous 24 heures. Au-delà, l'équipe regarde."
  },
  {
    "sujet": "espace-membre",
    "titre": "Mon espace",
    "resume": "La page de membre sur aoknowledge.com/mon-espace : cours, Live Club, achats, apps, Paramètres, Support et centre d'aide.",
    "motsCles": [
      "mon espace",
      "compte",
      "paramètres",
      "profil",
      "achats",
      "reçu",
      "données",
      "export",
      "suppression",
      "support",
      "aide",
      "apps"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "Mon espace est ta page de membre sur le site. Tu y retrouves tes cours avec leur progression, ton Live Club (statut et dernier paiement), tes achats et tes apps.\n- Mes apps : une carte par app (le Carnet du Trader, le Journal d'Études, Pilotage, les masterclass, le bot Live Club), avec ce qui est inclus pour toi.\n- Paramètres, par ton avatar en haut à droite : Profil, Connexion et sécurité, Langue et fuseau, Comptes liés, Achats, Données.\n- Support : écrire à l'équipe, avec des captures d'écran.\n- Le centre d'aide : les réponses aux questions courantes."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour toute personne qui a un compte AOKnowledge."
      },
      {
        "titre": "Prix et accès",
        "texte": "- Gratuit, avec ton compte AOKnowledge.\n- Ton profil est privé au départ : personne d'autre ne le voit. Visible des membres, ta page (aoknowledge.com/membres/ton numéro) se montre aux seuls membres connectés : ton nom, ta photo, ta présentation, ton niveau, ton activité et les espaces que tu as choisi de montrer. Ouverte au web (réglage à part, dans Paramètres, rubrique Profil), elle se voit aussi sans compte et sur les moteurs de recherche.\n- Achats : l'historique de tes paiements, achats et Live Club, avec un bouton Reçu. Un paiement PayPal n'a pas de reçu en ligne : écris au support.\n- Données : le bouton Exporter télécharge un fichier avec ton compte, ton profil, tes achats, ton Live Club, ta progression, tes demandes au support et tes notes du Journal.\n- Supprimer son compte : rubrique Données, Demander la suppression. La demande part à l'équipe, qui revient vers toi pour voir ce que tu souhaites. Rien n'est supprimé sans ton accord, et les factures restent archivées, c'est une obligation comptable."
      },
      {
        "titre": "Comment y aller",
        "texte": "- Mon espace : https://aoknowledge.com/mon-espace\n- Mes apps : https://aoknowledge.com/mon-espace/apps\n- Paramètres : https://aoknowledge.com/mon-espace/parametres\n- Support : https://aoknowledge.com/mon-espace/support\n- Centre d'aide : https://aoknowledge.com/aide"
      }
    ],
    "questions": [
      {
        "q": "Mon cours ou mon Live Club ne s'affiche pas.",
        "r": "Ton espace retrouve tes accès par l'email vérifié de ton compte. Si tu as payé avec une autre adresse, écris au support en précisant cette adresse : l'équipe fait le lien."
      },
      {
        "q": "Comment ajouter une autre adresse email ?",
        "r": "Paramètres, rubrique Comptes liés : ajoute l'adresse. Ton adresse de connexion reste la principale. Pour qu'un achat fait avec cette autre adresse soit rattaché, écris au support."
      },
      {
        "q": "Comment parler à quelqu'un de l'équipe depuis le site ?",
        "r": "Connecté, tu as le chat Support en bas à droite du site : l'IA répond d'abord, le bouton Parler à un humain prévient l'équipe. Tu peux aussi passer par la page Support."
      }
    ],
    "texte": "Mon espace. La page de membre sur aoknowledge.com/mon-espace : cours, Live Club, achats, apps, Paramètres, Support et centre d'aide.\n\nCe que c'est :\nMon espace est ta page de membre sur le site. Tu y retrouves tes cours avec leur progression, ton Live Club (statut et dernier paiement), tes achats et tes apps.\n- Mes apps : une carte par app (le Carnet du Trader, le Journal d'Études, Pilotage, les masterclass, le bot Live Club), avec ce qui est inclus pour toi.\n- Paramètres, par ton avatar en haut à droite : Profil, Connexion et sécurité, Langue et fuseau, Comptes liés, Achats, Données.\n- Support : écrire à l'équipe, avec des captures d'écran.\n- Le centre d'aide : les réponses aux questions courantes.\n\nPour qui :\nPour toute personne qui a un compte AOKnowledge.\n\nPrix et accès :\n- Gratuit, avec ton compte AOKnowledge.\n- Ton profil est privé au départ : personne d'autre ne le voit. Visible des membres, ta page (aoknowledge.com/membres/ton numéro) se montre aux seuls membres connectés : ton nom, ta photo, ta présentation, ton niveau, ton activité et les espaces que tu as choisi de montrer. Ouverte au web (réglage à part, dans Paramètres, rubrique Profil), elle se voit aussi sans compte et sur les moteurs de recherche.\n- Achats : l'historique de tes paiements, achats et Live Club, avec un bouton Reçu. Un paiement PayPal n'a pas de reçu en ligne : écris au support.\n- Données : le bouton Exporter télécharge un fichier avec ton compte, ton profil, tes achats, ton Live Club, ta progression, tes demandes au support et tes notes du Journal.\n- Supprimer son compte : rubrique Données, Demander la suppression. La demande part à l'équipe, qui revient vers toi pour voir ce que tu souhaites. Rien n'est supprimé sans ton accord, et les factures restent archivées, c'est une obligation comptable.\n\nComment y aller :\n- Mon espace : https://aoknowledge.com/mon-espace\n- Mes apps : https://aoknowledge.com/mon-espace/apps\n- Paramètres : https://aoknowledge.com/mon-espace/parametres\n- Support : https://aoknowledge.com/mon-espace/support\n- Centre d'aide : https://aoknowledge.com/aide\n\nQuestions fréquentes :\nQ : Mon cours ou mon Live Club ne s'affiche pas.\nR : Ton espace retrouve tes accès par l'email vérifié de ton compte. Si tu as payé avec une autre adresse, écris au support en précisant cette adresse : l'équipe fait le lien.\nQ : Comment ajouter une autre adresse email ?\nR : Paramètres, rubrique Comptes liés : ajoute l'adresse. Ton adresse de connexion reste la principale. Pour qu'un achat fait avec cette autre adresse soit rattaché, écris au support.\nQ : Comment parler à quelqu'un de l'équipe depuis le site ?\nR : Connecté, tu as le chat Support en bas à droite du site : l'IA répond d'abord, le bouton Parler à un humain prévient l'équipe. Tu peux aussi passer par la page Support."
  },
  {
    "sujet": "journal-d-etudes",
    "titre": "Le Journal d'Études",
    "resume": "L'app web qui relie les notes du Carnet en une carte, fait ressortir les concepts qui reviennent et analyse les jugements A, B, C. En pré-alpha, gratuite pour les membres.",
    "motsCles": [
      "journal",
      "études",
      "notes",
      "carte",
      "canvas",
      "concepts",
      "analyse",
      "relecture",
      "pré-alpha"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "Le Journal d'Études est l'endroit où tu reviens sur tes notes. Ce que tu captures avec le Carnet du Trader y arrive par la synchronisation.\n- Une note s'étudie en carte : tu déplaces ses blocs, tu les regroupes par thème et tu traces les liens entre tes observations. La note écrite en séance, elle, reste telle quelle.\n- Les concepts qui reviennent le plus dans tes notes, et ce avec quoi ils vont.\n- Le parcours : capturer, réorganiser, relire, observer les concepts, noter tes trades A, B ou C, analyser. Le guide te dit où tu en es."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour les traders qui utilisent le Carnet et veulent étudier ce qu'ils ont capturé, pas seulement le stocker."
      },
      {
        "titre": "Prix et accès",
        "texte": "- Gratuit pour les membres du Live Club et du 10% Club.\n- Il est en pré-alpha : il évolue chaque semaine, et certains écrans existent en première version. Les retours des membres décident de la suite.\n- Il s'ouvre avec ton compte AOKnowledge, depuis le Carnet ou depuis Mon espace."
      },
      {
        "titre": "Comment y aller",
        "texte": "- L'app : https://journal.aoknowledge.com\n- La présentation : https://aoknowledge.com/library/journal"
      }
    ],
    "questions": [
      {
        "q": "Mes notes du Carnet n'apparaissent pas dans le Journal.",
        "r": "Vérifie en bas du panneau du Carnet que la synchronisation est faite, et que tu es connecté avec le même compte des deux côtés. Si tu es déconnecté, reconnecte-toi depuis l'icône du compte du Carnet, puis « Tout renvoyer » dans Compte si besoin."
      },
      {
        "q": "Qu'est-ce qui est déjà disponible ?",
        "r": "La version 0.1 « Étudier mes notes » est faite, la 0.2 « Observer les concepts » est en cours. La relecture, l'analyse des données, les pattern maps, les cartes A, B, C, le rituel de séance et la documentation des trades sont prévus ensuite, sans date annoncée."
      }
    ],
    "texte": "Le Journal d'Études. L'app web qui relie les notes du Carnet en une carte, fait ressortir les concepts qui reviennent et analyse les jugements A, B, C. En pré-alpha, gratuite pour les membres.\n\nCe que c'est :\nLe Journal d'Études est l'endroit où tu reviens sur tes notes. Ce que tu captures avec le Carnet du Trader y arrive par la synchronisation.\n- Une note s'étudie en carte : tu déplaces ses blocs, tu les regroupes par thème et tu traces les liens entre tes observations. La note écrite en séance, elle, reste telle quelle.\n- Les concepts qui reviennent le plus dans tes notes, et ce avec quoi ils vont.\n- Le parcours : capturer, réorganiser, relire, observer les concepts, noter tes trades A, B ou C, analyser. Le guide te dit où tu en es.\n\nPour qui :\nPour les traders qui utilisent le Carnet et veulent étudier ce qu'ils ont capturé, pas seulement le stocker.\n\nPrix et accès :\n- Gratuit pour les membres du Live Club et du 10% Club.\n- Il est en pré-alpha : il évolue chaque semaine, et certains écrans existent en première version. Les retours des membres décident de la suite.\n- Il s'ouvre avec ton compte AOKnowledge, depuis le Carnet ou depuis Mon espace.\n\nComment y aller :\n- L'app : https://journal.aoknowledge.com\n- La présentation : https://aoknowledge.com/library/journal\n\nQuestions fréquentes :\nQ : Mes notes du Carnet n'apparaissent pas dans le Journal.\nR : Vérifie en bas du panneau du Carnet que la synchronisation est faite, et que tu es connecté avec le même compte des deux côtés. Si tu es déconnecté, reconnecte-toi depuis l'icône du compte du Carnet, puis « Tout renvoyer » dans Compte si besoin.\nQ : Qu'est-ce qui est déjà disponible ?\nR : La version 0.1 « Étudier mes notes » est faite, la 0.2 « Observer les concepts » est en cours. La relecture, l'analyse des données, les pattern maps, les cartes A, B, C, le rituel de séance et la documentation des trades sont prévus ensuite, sans date annoncée."
  },
  {
    "sujet": "liens-utiles",
    "titre": "Les liens utiles et partenaires",
    "resume": "Les liens publiés par Brice et Mélanie (prop firms, brokers, plateformes, outils), le partenaire Edgyx et la règle des codes promo.",
    "motsCles": [
      "liens",
      "partenaires",
      "affiliation",
      "prop firm",
      "broker",
      "tradingview",
      "edgyx",
      "code",
      "promo",
      "réduction"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "Brice et Mélanie publient pour les membres une liste de liens utiles, rangés par catégorie : prop firms, brokers pour fonds propres, analyse et graphiques, réception des paiements, comptabilité, calendrier économique, journal et suivi de performance, suivi de portefeuille. Les adresses se donnent telles qu'elles sont publiées, en entier. Plusieurs sont des liens d'affiliation de Brice ou de Mélanie : c'est voulu, et tu es libre de passer directement par le site.\n\nSeuls les liens de cette liste se donnent. Un outil qui n'y est pas : il n'y a pas d'info dessus. Donner ces liens n'est pas un conseil de trading."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour les membres qui cherchent un outil, une plateforme, une prop firm ou un broker."
      },
      {
        "titre": "Prix et accès",
        "texte": "- Edgyx, le journal de trading recommandé par AOKnowledge, est un abonnement à part, pas compris dans le Live Club. Avec le lien partenaire et le code LIVECLUB20, 20 % de réduction sur l'abonnement Edgyx.\n- Codes promo et réductions sur les offres AOKnowledge : aucun code n'est donné ici. Les promos du moment, que Mélanie lance de temps en temps, sont annoncées sur son canal Telegram « MELMOM | ICT Trading » : https://t.me/melmom1993"
      },
      {
        "titre": "Comment y aller",
        "texte": "- Edgyx : https://www.edgyx.ai/fr/partnercampaign/liveclub (code LIVECLUB20)\n- La page Edgyx du site : https://aoknowledge.com/decouvrir-edgyx\n- Le reste de la liste : demande la catégorie qui t'intéresse."
      }
    ],
    "questions": [
      {
        "q": "Il y a un code promo pour le Live Club ?",
        "r": "Aucun code n'est donné ici. Les promos du moment sont annoncées sur le canal Telegram de Mélanie : https://t.me/melmom1993"
      }
    ],
    "texte": "Les liens utiles et partenaires. Les liens publiés par Brice et Mélanie (prop firms, brokers, plateformes, outils), le partenaire Edgyx et la règle des codes promo.\n\nCe que c'est :\nBrice et Mélanie publient pour les membres une liste de liens utiles, rangés par catégorie : prop firms, brokers pour fonds propres, analyse et graphiques, réception des paiements, comptabilité, calendrier économique, journal et suivi de performance, suivi de portefeuille. Les adresses se donnent telles qu'elles sont publiées, en entier. Plusieurs sont des liens d'affiliation de Brice ou de Mélanie : c'est voulu, et tu es libre de passer directement par le site.\n\nSeuls les liens de cette liste se donnent. Un outil qui n'y est pas : il n'y a pas d'info dessus. Donner ces liens n'est pas un conseil de trading.\n\nPour qui :\nPour les membres qui cherchent un outil, une plateforme, une prop firm ou un broker.\n\nPrix et accès :\n- Edgyx, le journal de trading recommandé par AOKnowledge, est un abonnement à part, pas compris dans le Live Club. Avec le lien partenaire et le code LIVECLUB20, 20 % de réduction sur l'abonnement Edgyx.\n- Codes promo et réductions sur les offres AOKnowledge : aucun code n'est donné ici. Les promos du moment, que Mélanie lance de temps en temps, sont annoncées sur son canal Telegram « MELMOM | ICT Trading » : https://t.me/melmom1993\n\nComment y aller :\n- Edgyx : https://www.edgyx.ai/fr/partnercampaign/liveclub (code LIVECLUB20)\n- La page Edgyx du site : https://aoknowledge.com/decouvrir-edgyx\n- Le reste de la liste : demande la catégorie qui t'intéresse.\n\nQuestions fréquentes :\nQ : Il y a un code promo pour le Live Club ?\nR : Aucun code n'est donné ici. Les promos du moment sont annoncées sur le canal Telegram de Mélanie : https://t.me/melmom1993"
  },
  {
    "sujet": "live-club",
    "titre": "Le Live Club",
    "resume": "L'abonnement de lives éducatifs animés par Mélanie et Brice, avec le groupe Telegram, les replays, les modules de formation et le Carnet Premium. 139 € par mois, sans engagement.",
    "motsCles": [
      "live club",
      "lives",
      "abonnement",
      "telegram",
      "groupe",
      "replays",
      "académie",
      "pause",
      "arrêt",
      "bot",
      "prix"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "Le Live Club, c'est l'entraînement sur le marché réel, animé par Mélanie et Brice.\n- Deux à trois lives éducatifs chaque semaine, sur le marché en temps réel ou autour d'un thème, avec un temps de questions à la fin.\n- Les replays : chaque live est rangé dans le Telegram du Live Club, dans le sujet Replay, à revoir quand tu veux.\n- Les modules de l'Académie inclus : https://aoknowledge.com/academie (connecte-toi avec l'email de ton abonnement).\n- Le groupe Telegram du Live Club : l'entraide entre membres, les explications de charts, les projections hebdomadaires Nasdaq et S&P 500. Les messages épinglés du groupe expliquent comment il marche.\n- Le Carnet du Trader Premium inclus, et le Journal d'Études et Pilotage gratuits."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour les traders qui ont déjà les bases et veulent les mettre à l'épreuve du marché du jour. Les lives supposent que les bases soient là."
      },
      {
        "titre": "Prix et accès",
        "texte": "- 139 € par mois, sans engagement, reconduit chaque mois jusqu'à l'arrêt.\n- L'arrêt prend effet à la fin de la période payée : le groupe reste ouvert jusque-là, puis plus rien n'est prélevé.\n- Une pause de 1 à 6 mois est possible : elle démarre à la fin de la période déjà payée et l'abonnement reprend tout seul ensuite.\n- L'abonnement se gère avec le bot Telegram du Live Club : pause, arrêt, accès au groupe, situation de l'abonnement.\n- Edgyx, le journal de trading recommandé, est un abonnement à part, pas compris dans le Live Club.\n- Les conditions : https://aoknowledge.com/live-club/conditions"
      },
      {
        "titre": "Comment y aller",
        "texte": "- S'abonner : https://aoknowledge.com/live-club ou https://melaniechart.com (deux portes pour la même offre)\n- Le bot qui gère l'abonnement : https://t.me/aok_liveclub_bot\n- Changer sa carte bancaire : https://billing.stripe.com/p/login/bJecN48kK4Vc4vr70Sbsc00 (connexion avec l'email du paiement)"
      }
    ],
    "questions": [
      {
        "q": "MelTrade et le Live Club, c'est différent ?",
        "r": "Non. melaniechart.com (MelTrade) est le site de Mélanie : c'est une autre porte vers le même Live Club."
      },
      {
        "q": "Les replays, je les trouve où ?",
        "r": "Dans le Telegram du Live Club, dans le sujet Replay."
      },
      {
        "q": "Edgyx est compris dans l'abonnement ?",
        "r": "Non, c'est un abonnement à part. Le lien partenaire et le code LIVECLUB20 donnent 20 % de réduction sur Edgyx."
      }
    ],
    "texte": "Le Live Club. L'abonnement de lives éducatifs animés par Mélanie et Brice, avec le groupe Telegram, les replays, les modules de formation et le Carnet Premium. 139 € par mois, sans engagement.\n\nCe que c'est :\nLe Live Club, c'est l'entraînement sur le marché réel, animé par Mélanie et Brice.\n- Deux à trois lives éducatifs chaque semaine, sur le marché en temps réel ou autour d'un thème, avec un temps de questions à la fin.\n- Les replays : chaque live est rangé dans le Telegram du Live Club, dans le sujet Replay, à revoir quand tu veux.\n- Les modules de l'Académie inclus : https://aoknowledge.com/academie (connecte-toi avec l'email de ton abonnement).\n- Le groupe Telegram du Live Club : l'entraide entre membres, les explications de charts, les projections hebdomadaires Nasdaq et S&P 500. Les messages épinglés du groupe expliquent comment il marche.\n- Le Carnet du Trader Premium inclus, et le Journal d'Études et Pilotage gratuits.\n\nPour qui :\nPour les traders qui ont déjà les bases et veulent les mettre à l'épreuve du marché du jour. Les lives supposent que les bases soient là.\n\nPrix et accès :\n- 139 € par mois, sans engagement, reconduit chaque mois jusqu'à l'arrêt.\n- L'arrêt prend effet à la fin de la période payée : le groupe reste ouvert jusque-là, puis plus rien n'est prélevé.\n- Une pause de 1 à 6 mois est possible : elle démarre à la fin de la période déjà payée et l'abonnement reprend tout seul ensuite.\n- L'abonnement se gère avec le bot Telegram du Live Club : pause, arrêt, accès au groupe, situation de l'abonnement.\n- Edgyx, le journal de trading recommandé, est un abonnement à part, pas compris dans le Live Club.\n- Les conditions : https://aoknowledge.com/live-club/conditions\n\nComment y aller :\n- S'abonner : https://aoknowledge.com/live-club ou https://melaniechart.com (deux portes pour la même offre)\n- Le bot qui gère l'abonnement : https://t.me/aok_liveclub_bot\n- Changer sa carte bancaire : https://billing.stripe.com/p/login/bJecN48kK4Vc4vr70Sbsc00 (connexion avec l'email du paiement)\n\nQuestions fréquentes :\nQ : MelTrade et le Live Club, c'est différent ?\nR : Non. melaniechart.com (MelTrade) est le site de Mélanie : c'est une autre porte vers le même Live Club.\nQ : Les replays, je les trouve où ?\nR : Dans le Telegram du Live Club, dans le sujet Replay.\nQ : Edgyx est compris dans l'abonnement ?\nR : Non, c'est un abonnement à part. Le lien partenaire et le code LIVECLUB20 donnent 20 % de réduction sur Edgyx."
  },
  {
    "sujet": "masterclass",
    "titre": "Les masterclass",
    "resume": "Des replays gratuits de masterclass sur la psychologie et l'exécution, sur masterclass.aoknowledge.com, avec un compte AOKnowledge.",
    "motsCles": [
      "masterclass",
      "replay",
      "vidéo",
      "psychologie",
      "perte",
      "stop-loss",
      "risque",
      "gratuit"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "Les masterclass sont des sessions complètes, en replay, sur la psychologie et l'exécution du trader. Par exemple : ta dernière perte comme outil de progression, le stop-loss vu comme un signal, le piège du trader compétent, la gestion des risques, la préparation de tes objectifs."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour tout trader, membre ou non."
      },
      {
        "titre": "Prix et accès",
        "texte": "- Accès libre et gratuit.\n- Pour regarder un replay, tu te connectes ou tu crées ton compte AOKnowledge sur le site des masterclass. C'est le même compte que sur aoknowledge.com : utilise le même email."
      },
      {
        "titre": "Comment y aller",
        "texte": "- https://masterclass.aoknowledge.com"
      }
    ],
    "questions": [
      {
        "q": "Je n'arrive pas à ouvrir un replay.",
        "r": "Le plus souvent, c'est un autre email que celui de ton compte AOKnowledge. Connecte-toi avec le même email que sur le site. Si ça coince encore, l'équipe regarde."
      }
    ],
    "texte": "Les masterclass. Des replays gratuits de masterclass sur la psychologie et l'exécution, sur masterclass.aoknowledge.com, avec un compte AOKnowledge.\n\nCe que c'est :\nLes masterclass sont des sessions complètes, en replay, sur la psychologie et l'exécution du trader. Par exemple : ta dernière perte comme outil de progression, le stop-loss vu comme un signal, le piège du trader compétent, la gestion des risques, la préparation de tes objectifs.\n\nPour qui :\nPour tout trader, membre ou non.\n\nPrix et accès :\n- Accès libre et gratuit.\n- Pour regarder un replay, tu te connectes ou tu crées ton compte AOKnowledge sur le site des masterclass. C'est le même compte que sur aoknowledge.com : utilise le même email.\n\nComment y aller :\n- https://masterclass.aoknowledge.com\n\nQuestions fréquentes :\nQ : Je n'arrive pas à ouvrir un replay.\nR : Le plus souvent, c'est un autre email que celui de ton compte AOKnowledge. Connecte-toi avec le même email que sur le site. Si ça coince encore, l'équipe regarde."
  },
  {
    "sujet": "pilotage",
    "titre": "Pilotage",
    "resume": "L'app de pilotage financier du trader, qui suit ce que coûtent les comptes de trading et le relie aux finances du mois. En pré-alpha, gratuite pour les membres.",
    "motsCles": [
      "pilotage",
      "finances",
      "budget",
      "prop firm",
      "comptes",
      "challenge",
      "renouvellement",
      "payout",
      "relevés",
      "baromètre"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "Pilotage regarde tes finances liées au trading comme une entreprise regarde les siennes : ce que tu dépenses, ce que tu engages et ce que tu peux te permettre. Il remplace la feuille de calcul AOKnowledge donnée aux élèves. Deux axes :\n- Tes comptes : prop firm ou compte propre, phase de challenge ou de performance, coût d'achat, coût mensuel, prochain renouvellement, activation à prévoir, payouts reçus et résultat net de chaque compte. Une alerte quand les challenges du mois dépassent ton enveloppe trading. En compte propre : capital, risque maximal par trade et par jour, journées notées, part à mettre de côté chaque semaine.\n- Ton baromètre financier : revenus et charges du mois, impôts estimés à mettre de côté, répartition entre vie quotidienne et investissement, et l'import de tes relevés de compte en CSV ou en PDF. Chaque opération lue t'est proposée : rien n'est écrit sans toi.\n\nLes montants par jour de trading que Pilotage affiche sont des repères de pilotage, pas une promesse de résultat."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour le trader qui veut savoir ce que le trading lui coûte vraiment, prop firms, outils et formations compris, et ce qu'il peut engager chaque mois."
      },
      {
        "titre": "Prix et accès",
        "texte": "- Gratuit pour les membres du Live Club et du 10% Club.\n- En pré-alpha : il évolue, et plusieurs modules sont annoncés à venir, sans date promise.\n- Connexion avec ton compte AOKnowledge.\n- Tes données restent pour l'instant dans le navigateur où tu les saisis : changer de navigateur ou vider le cache les fait disparaître. Ton profil qui te suit d'un appareil à l'autre fait partie de ce qui est à venir."
      },
      {
        "titre": "Comment y aller",
        "texte": "- L'app : https://pilotage.aoknowledge.com\n- La présentation : https://aoknowledge.com/library/pilotage"
      }
    ],
    "questions": [
      {
        "q": "Mes chiffres ont disparu.",
        "r": "Pilotage garde tes données dans ton navigateur. Si tu as changé de navigateur ou d'appareil, ou vidé le cache, elles ne sont plus là. Reviens sur le navigateur habituel ; sinon, l'équipe ne peut pas les retrouver sur ses serveurs, puisqu'elles n'y sont pas."
      },
      {
        "q": "Qu'est-ce qui arrive ensuite ?",
        "r": "La circulation de ton argent sur un écran dédié, le tableau de projection de ton budget, ton profil sur plusieurs appareils, et les règles du compte propre (lots par jour, limite de perte par semaine, capital semaine après semaine). Sans date promise : chaque module entre quand il est prêt."
      }
    ],
    "texte": "Pilotage. L'app de pilotage financier du trader, qui suit ce que coûtent les comptes de trading et le relie aux finances du mois. En pré-alpha, gratuite pour les membres.\n\nCe que c'est :\nPilotage regarde tes finances liées au trading comme une entreprise regarde les siennes : ce que tu dépenses, ce que tu engages et ce que tu peux te permettre. Il remplace la feuille de calcul AOKnowledge donnée aux élèves. Deux axes :\n- Tes comptes : prop firm ou compte propre, phase de challenge ou de performance, coût d'achat, coût mensuel, prochain renouvellement, activation à prévoir, payouts reçus et résultat net de chaque compte. Une alerte quand les challenges du mois dépassent ton enveloppe trading. En compte propre : capital, risque maximal par trade et par jour, journées notées, part à mettre de côté chaque semaine.\n- Ton baromètre financier : revenus et charges du mois, impôts estimés à mettre de côté, répartition entre vie quotidienne et investissement, et l'import de tes relevés de compte en CSV ou en PDF. Chaque opération lue t'est proposée : rien n'est écrit sans toi.\n\nLes montants par jour de trading que Pilotage affiche sont des repères de pilotage, pas une promesse de résultat.\n\nPour qui :\nPour le trader qui veut savoir ce que le trading lui coûte vraiment, prop firms, outils et formations compris, et ce qu'il peut engager chaque mois.\n\nPrix et accès :\n- Gratuit pour les membres du Live Club et du 10% Club.\n- En pré-alpha : il évolue, et plusieurs modules sont annoncés à venir, sans date promise.\n- Connexion avec ton compte AOKnowledge.\n- Tes données restent pour l'instant dans le navigateur où tu les saisis : changer de navigateur ou vider le cache les fait disparaître. Ton profil qui te suit d'un appareil à l'autre fait partie de ce qui est à venir.\n\nComment y aller :\n- L'app : https://pilotage.aoknowledge.com\n- La présentation : https://aoknowledge.com/library/pilotage\n\nQuestions fréquentes :\nQ : Mes chiffres ont disparu.\nR : Pilotage garde tes données dans ton navigateur. Si tu as changé de navigateur ou d'appareil, ou vidé le cache, elles ne sont plus là. Reviens sur le navigateur habituel ; sinon, l'équipe ne peut pas les retrouver sur ses serveurs, puisqu'elles n'y sont pas.\nQ : Qu'est-ce qui arrive ensuite ?\nR : La circulation de ton argent sur un écran dédié, le tableau de projection de ton budget, ton profil sur plusieurs appareils, et les règles du compte propre (lots par jour, limite de perte par semaine, capital semaine après semaine). Sans date promise : chaque module entre quand il est prêt."
  },
  {
    "sujet": "ressources-gratuites",
    "titre": "Les ressources gratuites",
    "resume": "La bibliothèque, le workbook de 83 pages, le blog, la newsletter, le podcast Trading Edge Club, la chaîne YouTube et les masterclass.",
    "motsCles": [
      "gratuit",
      "bibliothèque",
      "workbook",
      "pdf",
      "blog",
      "articles",
      "newsletter",
      "podcast",
      "trading edge club",
      "youtube",
      "quiz"
    ],
    "verifieLe": "2026-10-18",
    "sections": [
      {
        "titre": "Ce que c'est",
        "texte": "Ce qu'AOKnowledge met à disposition gratuitement :\n- La bibliothèque : les outils et les ressources, au même endroit.\n- Le workbook « De la compréhension à l'exécution » : un PDF de 83 pages en huit étapes, des bases du marché à la gestion du risque, avec des exercices. Il s'envoie par email.\n- Le blog : des articles Smart Money et ICT, de psychologie et de discipline du trading.\n- La newsletter AOKnowledge.\n- Le podcast Trading Edge Club, sur Spotify et Apple Podcasts.\n- La chaîne YouTube de Brice.\n- Les masterclass en replay, avec un compte."
      },
      {
        "titre": "Pour qui",
        "texte": "Pour tout trader, et pour qui veut découvrir la façon de travailler d'AOKnowledge avant de s'engager."
      },
      {
        "titre": "Prix et accès",
        "texte": "Gratuit. Le workbook demande ton email pour te l'envoyer ; les masterclass demandent un compte AOKnowledge."
      },
      {
        "titre": "Comment y aller",
        "texte": "- La bibliothèque : https://aoknowledge.com/library\n- Le workbook : https://aoknowledge.com/library/workbooks\n- Le blog : https://aoknowledge.com/blog\n- La newsletter : https://aoknowledge.com/newsletter\n- Le podcast : https://aoknowledge.com/podcast, sur Spotify https://open.spotify.com/show/033uUTFunwByY1Dl1ppng4 et sur Apple Podcasts https://podcasts.apple.com/fr/podcast/trading-edge-club/id1896899847\n- YouTube : https://youtube.com/@BriceDlb\n- Les masterclass : https://masterclass.aoknowledge.com"
      }
    ],
    "questions": [
      {
        "q": "Par où commencer si je débute ?",
        "r": "Le workbook gratuit donne les huit étapes, et le blog et le podcast montrent la façon de travailler d'AOKnowledge. Sur l'académie, Novice en trading est gratuit avec un compte."
      }
    ],
    "texte": "Les ressources gratuites. La bibliothèque, le workbook de 83 pages, le blog, la newsletter, le podcast Trading Edge Club, la chaîne YouTube et les masterclass.\n\nCe que c'est :\nCe qu'AOKnowledge met à disposition gratuitement :\n- La bibliothèque : les outils et les ressources, au même endroit.\n- Le workbook « De la compréhension à l'exécution » : un PDF de 83 pages en huit étapes, des bases du marché à la gestion du risque, avec des exercices. Il s'envoie par email.\n- Le blog : des articles Smart Money et ICT, de psychologie et de discipline du trading.\n- La newsletter AOKnowledge.\n- Le podcast Trading Edge Club, sur Spotify et Apple Podcasts.\n- La chaîne YouTube de Brice.\n- Les masterclass en replay, avec un compte.\n\nPour qui :\nPour tout trader, et pour qui veut découvrir la façon de travailler d'AOKnowledge avant de s'engager.\n\nPrix et accès :\nGratuit. Le workbook demande ton email pour te l'envoyer ; les masterclass demandent un compte AOKnowledge.\n\nComment y aller :\n- La bibliothèque : https://aoknowledge.com/library\n- Le workbook : https://aoknowledge.com/library/workbooks\n- Le blog : https://aoknowledge.com/blog\n- La newsletter : https://aoknowledge.com/newsletter\n- Le podcast : https://aoknowledge.com/podcast, sur Spotify https://open.spotify.com/show/033uUTFunwByY1Dl1ppng4 et sur Apple Podcasts https://podcasts.apple.com/fr/podcast/trading-edge-club/id1896899847\n- YouTube : https://youtube.com/@BriceDlb\n- Les masterclass : https://masterclass.aoknowledge.com\n\nQuestions fréquentes :\nQ : Par où commencer si je débute ?\nR : Le workbook gratuit donne les huit étapes, et le blog et le podcast montrent la façon de travailler d'AOKnowledge. Sur l'académie, Novice en trading est gratuit avec un compte."
  }
]
