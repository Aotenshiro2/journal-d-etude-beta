---
sujet: carnet-du-trader
titre: Le Carnet du Trader
resume: L'extension de navigateur pour noter ses trades pendant la séance, gratuite, avec un Premium à 5,99 € par mois inclus pour les membres.
mots: extension, carnet, chrome, navigateur, premium, capture, dictée, notes, panneau, forfait
verifie: 2026-10-18
sources: apps/carnet-du-trader-extension (public/manifest.json v1.8.10, src/lib/offres.ts, src/lib/i18n.ts « forfait », src/components/PlansView.tsx) ; sites/Aoknowledgecom/v3/src/pages/ExtensionPage.tsx ; apps/journal-d-etude/src/lib/entitlements.ts ; apps/journal-d-etude/src/lib/support-prompt.ts (problèmes fréquents)
---

## Ce que c'est

Le Carnet du Trader est l'extension de navigateur d'AOKnowledge. Elle s'ouvre dans un panneau latéral, à côté de ton graphique : tu notes ta séance sans changer d'onglet.
- Notes, captures d'écran, trades avec un jugement A, B ou C sur la qualité de la décision (pas sur le résultat), warmups, DOL, dossiers.
- Capture de la page : sur TradingView, le graphique, le ticker et l'unité de temps ; sur YouTube, le titre et la transcription ; sur Forex Factory, les événements du calendrier ; ailleurs, ce que tu sélectionnes.
- Dictée vocale transcrite sur ta machine : la voix ne part sur aucun serveur.
- Exports en PDF, en DOCX ou vers Google Drive, et synchronisation vers le Journal d'Études.
- Raccourcis : Ctrl + Maj + A ouvre le panneau, Alt + Maj + C capture la page.

## Pour qui

Pour tout trader qui veut garder une trace fiable de ses séances. Le carnet gratuit est complet. Le Premium ajoute l'IA dans le Carnet.

## Prix et accès

- Le Carnet gratuit : sans moyen de paiement, sans limite de durée. Un bouton « Analyser avec une IA » envoie ta note dans ton propre assistant IA, celui où tu as déjà un compte, avec la consigne déjà écrite.
- Le Carnet Premium : 5,99 € par mois, ou 57,50 € par an (4,79 € par mois), sans engagement. Il ajoute la capture lue par l'IA, tes graphiques lus à l'image, tes notes approfondies et le mentorat qui te répond, selon la méthode de l'académie.
- Le Premium est inclus, sans rien payer en plus, pour les membres du Live Club et du 10% Club : il suffit de se connecter dans l'extension avec son compte AOKnowledge.
- L'abonnement Premium se prend depuis l'extension, onglet « Mon forfait », pour qu'il soit rattaché à la bonne adresse.

## Comment y aller

- L'installer : https://chromewebstore.google.com/detail/trading-notes-by-aoknowle/phajegonlmgnjkkfdooedoddnmgpheic?hl=fr&utm_source=ext_sidebar
- La présentation : https://aoknowledge.com/library/extension
- Navigateurs : Chrome, Brave, Opera et Edge.

## Questions fréquentes

### Je suis membre du Live Club, je dois payer le Premium ?
Non. Le Premium est inclus. Connecte-toi dans l'extension avec le même email que ton compte AOKnowledge : l'écran « Mon forfait » doit afficher que tout est déjà ouvert. Si ce n'est pas le cas, l'équipe regarde.

### La dictée vocale ne marche pas.
Au premier usage, le navigateur demande l'autorisation du micro, puis le modèle de dictée se télécharge une fois. Le choix du micro se fait dans les Paramètres de l'extension, section Dictée vocale.

### Mes notes n'arrivent pas dans le Journal.
L'état de la synchronisation est affiché en bas du panneau. Si tu es déconnecté, reconnecte-toi depuis l'icône du compte, puis utilise « Tout renvoyer » dans Compte si besoin.

### Le jugement A, B, C, c'est quoi ?
Il note la qualité de ta décision, pas le résultat du trade. Un trade perdant peut mériter un A.
