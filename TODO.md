# ✅ Todo List - Journal d'Études

## État des tâches au 15 octobre 2025

### 🎉 **Terminées (High Priority)**
- [x] Créer compte Railway avec GitHub
- [x] Déployer PostgreSQL sur Railway  
- [x] Configurer .env avec URL Railway
- [x] Tester connexion et push schema
- [x] Supprimer ancienne base SQLite et nettoyer
- [x] Vérifier que Railway fonctionne parfaitement
- [x] Démarrer app et tester création de données
- [x] Tester toutes les APIs principales

### 📋 **En cours/À faire**

#### **High Priority (Critique)**
- [ ] **Vérifier Railway après restructuration**
  - Tester `npm run dev` dans nouveau dossier
  - Vérifier que DATABASE_URL fonctionne
  - Valider APIs : Notes, Courses, Instructors

#### **Medium Priority (Important)**  
- [ ] **Initialiser Git avec structure propre**
  - `git init` dans `aoknowledge/apps/journal-d-etude/`
  - `git add .`
  - `git commit -m "Initial commit: Journal d'Études with Railway"`

- [ ] **Premier commit et push GitHub**
  - Créer repository `aoknowledge` sur GitHub
  - Ajouter remote origin
  - Push initial

- [ ] **Import Vercel avec bon nom de projet**
  - Créer compte Vercel + GitHub
  - Import repository `aoknowledge`
  - Root directory : `apps/journal-d-etude`

- [ ] **Configuration variables d'environnement production**
  - DATABASE_URL Railway
  - NEXTAUTH_SECRET généré
  - NEXTAUTH_URL avec domaine Vercel

#### **Low Priority (Finition)**
- [ ] **Premier déploiement et tests production**
  - Build Vercel
  - Tests APIs en production
  - Validation fonctionnement complet

## 🔧 **Configuration critique à préserver :**

### **Railway PostgreSQL :**
```
DATABASE_URL="postgresql://postgres:dFDBpuKRWmxiJMcdHKfayFxzfjRLbyMy@caboose.proxy.rlwy.net:14621/railway"
```

### **Variables d'environnement Vercel :**
```
DATABASE_URL = postgresql://postgres:dFDBpuKRWmxiJMcdHKfayFxzfjRLbyMy@caboose.proxy.rlwy.net:14621/railway
NEXTAUTH_SECRET = your-secret-key-here  
NEXTAUTH_URL = https://[VERCEL-URL]
```

## ⚠️ **Points d'attention :**
1. **Vérifier Railway** après déplacement fichiers
2. **Root directory Vercel** = `apps/journal-d-etude`
3. **DATABASE_URL** doit être exactement la même
4. **Tester APIs** avant et après chaque étape

## 📊 **Métriques de succès :**
- [ ] App démarre sans erreur
- [ ] APIs répondent correctement
- [ ] Déploiement Vercel réussi
- [ ] Tests en production passent

## 🆕 Mise à jour du 10 juillet 2026 — évolutions à venir

Ordre de priorité global validé par Brice (extension + journal confondus) :
1. fix warmup extension → **2. homogénéisation UI (ici)** → 3. DOL extension
→ **4. compteur de concepts (ici)**. Le pont Edgyx passe devant tout
(dossier envoyé, en attente du retour de Geoffrey).

### Concepts — compteur de journalisation (priorité 4)
- [ ] Afficher pour chaque concept le nombre de fois qu'il a été journalé
      (ex. « Breaker ×47 »), lisible d'un coup d'œil sur /concepts.
- But pédagogique : l'élève voit immédiatement où il en est sur chaque concept.
- (option) Rappeler ce compteur dans le picker de tags/concepts.

### Homogénéisation de l'esthétique (TERMINÉE — 2026-07-16)
Direction artistique (Brice) : quand on change de page, la page d'accueil doit
sembler « se métamorphoser » — pas de sensation de changer d'app. Le langage
commun : canvas en toile de fond, dropdown des espaces haut-gauche, actions
rapides bas-droite, capture bar centrale quand utile, lecteur de notes à gauche
si besoin. Pas d'animations de transition. Chaque page garde SES besoins.

DÉJÀ ALIGNÉES — NE PAS TOUCHER :
- `/` (accueil, `NoteMapCanvas.tsx`) → **la référence**
- `/study/*` (`StudyCanvas.tsx`) → l'écran où on relie les notes entre elles
- `/concepts` (utilise `CanvasShell`) — le doublon de titre a disparu avec le
  retrait du slot `title` (2026-07-16) ; son contenu n'a pas été touché.

Outil en place : `src/components/CanvasShell.tsx` (commit `6bb6aae`) reproduit le
langage de l'accueil (dot grid + top gradient, dropdown MODES identique,
UserMenu haut-droite, pill bas-droite thème/Relire+badge/Notes/Guide). Slots :
`dueCount`, `extraActions`, `children`. Le faire évoluer si un écran a besoin de
plus (barre centrale, lecteur de notes à gauche…).

DÉCIDÉ le 2026-07-16 (Brice) — **pas de titre hors accueil** : le dropdown dit à
lui seul où tu es ; le nom de l'app (« Journal d'Études ») ne vit que sur
l'accueil. Le slot `title` a donc été retiré du shell (il affichait par défaut le
label du mode → le même texte écrit deux fois à côté du dropdown, ce que faisait
`/concepts`). Corollaire pour chaque écran migré : le `<h1>` de la vue doit être
**éditorial** (ce que l'écran révèle), pas le nom de l'espace — cf. `/concepts`
(« Ce qui revient dans tes notes ») et `/analytics` (« Ce que tes jugements
révèlent »).

COMMENT VÉRIFIER À L'ÉCRAN sans session Supabase (débloqué le 2026-07-16 — avant,
la validation visuelle devait attendre un deploy) : le middleware laisse passer
tout chemin commençant par `/guide`, donc une page jetable
`src/app/guide-ui-preview/page.tsx` qui monte `CanvasShell` + la vue avec des
données bidon s'affiche sans login. `npx next dev -p 3007` dans WSL (⚠️ 3000 peut
être pris par Codex — et ne JAMAIS faire `pkill -f "next dev"`, ça tue son
serveur : tuer par port avec `fuser -k 3007/tcp`). Le port est joignable depuis
Windows. Penser à supprimer la page jetable + `rm -rf .next/types/app/<page>`
avant de committer.

FAIT — tous les écrans sont passés sur `CanvasShell`, `AppHeader.tsx` est
supprimé (ainsi que `ThemeToggle.tsx`, dont il était le seul consommateur) :
- [x] `/analytics` (`b6c6b63`) — les 3 lentilles inchangées dans le scroll central.
- [x] `/patterns` (`8bfb797`) — CTA + échelle d'escalade + tags inchangés.
- [x] `/game` (`e388449`) — les 3 colonnes A/B/C + « Mon chantier du moment ».
- [x] `/session` (`e388449`) — CTA + volets avant/après + curseur d'émotion.
- [x] `/review` (`400c9c6`) — deck + mode focus ; badge « Relire » recalculé
      depuis les canvas déjà chargés (pas de requête en plus).
- [x] `/notes` (`400c9c6`) — passait par `min-h-screen`, désormais dans la zone
      scrollable du shell.
- [x] `/guide` (`400c9c6`) — « Le parcours » était déjà éditorial.
- [x] `/journal` + `/market` (`400c9c6`) — `ComingSoon` thématisé (il était en
      `bg-gray-950` en dur, donc sombre même en mode clair).
- [x] `AppHeader.tsx` supprimé.

À SAVOIR pour la suite :
- **Écrans hors dropdown** : `OFF_MENU_PAGES` dans `CanvasShell`. Sans lui, le
  bouton retombait sur le 1er mode et affichait « Étudier mes notes » sur
  `/review` — faux. Tout nouvel écran hors dropdown doit y déclarer son libellé.
- **`/market` est orphelin** : aucun lien n'y mène, il n'est pas dans le
  dropdown. Migré seulement parce qu'il partage `ComingSoon`. À supprimer si
  l'écran « Observer le marché » n'est plus au programme.
- **Le shell ne reproduit pas encore tout l'accueil** : il manque la barre de
  capture centrale, le « Notes · N » en bas à gauche et la barre d'outils
  verticale à droite. Aucun des écrans migrés n'en avait besoin (lecture ou
  formulaire), mais un futur écran de saisie voudra probablement la barre de
  capture — c'est là que le slot central se justifiera.

> Côté extension, voir aussi `apps/carnet-du-trader-extension/TODO.md`
> (DOL — Draw on Liquidity, warmup multi-séances) — à faire avant le zip v1.6.0.

---
**Dernière mise à jour :** 10 juillet 2026
**Prochaine étape :** compteur de concepts + DOL/warmup côté extension