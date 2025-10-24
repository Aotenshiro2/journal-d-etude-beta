# Instructions pour Claude

## Contexte Projet AOKnowledge
- **Vision globale :** Écosystème multi-applications accessible via https://journal.aoknowledge.com/
- **Stratégie actuelle :** Reconstruction app par app pour efficacité maximum
- **Cette app :** "Journal d'Études" - Première pierre de l'écosystème
- **Architecture cible :** Base de données commune, auth centralisée, navigation seamless
- **Phase actuelle :** Développement beta isolé, intégration future dans écosystème principal

## Politique de commits
- Après chaque modification de feature ou implémentation significative, proposer explicitement un commit à l'utilisateur
- Ne jamais committer automatiquement, toujours demander la permission
- Utiliser des messages de commit descriptifs qui expliquent la nature du changement

## Configuration Infrastructure Beta
- **Base de données :** Supabase PostgreSQL (gratuit, migration Railway si egress dépassé)
- **Hébergement :** Vercel (gratuit puis payant si nécessaire)
- **Domaine beta :** À configurer (journal-beta.aoknowledge.com ou similaire)
- **Migration future :** Vers infrastructure commune AOKnowledge

## Commandes utiles
- `npm run dev` : Lancer le serveur de développement
- `npm run build` : Construire le projet
- `npm run lint` : Vérifier le code avec ESLint
- `npm run type-check` : Vérifier les types TypeScript (si disponible)
- `npm run db:push` : Pusher le schema Prisma vers la base
- `npm run db:generate` : Générer le client Prisma
- `npm run db:reset` : Reset de la base de données

## Structure du projet
- Projet Next.js 15.5.5 avec TypeScript
- Utilise Turbopack pour les performances
- Tailwind CSS pour le styling + ShadCN UI pour les thèmes
- ESLint pour la qualité du code
- Prisma ORM pour PostgreSQL
- React Flow pour le canvas interactif
- BlockNote pour l'éditeur de notes modulaire (remplace TipTap)
- System de design moderne avec variables CSS et thèmes sombre/clair

## Roadmap et Documentation
- **ROADMAP.md :** Vision complète multi-applications et stratégie
- **APIs à compléter :** Concepts, connexions notes, upload images
- **Sécurité à ajouter :** Auth, validation, rate limiting
- **Tests à implémenter :** Unitaires, intégration, e2e

## Notes pour futures sessions
- **État actuel :** Railway PostgreSQL configuré et validé ✅
- **Prochaine étape :** Git + Vercel + déploiement production
- **Infrastructure :** Railway (5€/mois) - Performance excellente
- **Base de données :** PostgreSQL vierge, prête pour production
- **APIs testées :** Notes, Courses, Instructors (100% fonctionnelles)
- **Objectif final :** Intégration dans écosystème AOKnowledge principal

## État de la session actuelle (23 oct 2025)
- **Railway :** ✅ Configuré, testé, validé
- **Schema Prisma :** ✅ Migré SQLite → PostgreSQL  
- **APIs :** ✅ Toutes testées et fonctionnelles
- **Restructuration :** ✅ Terminée (vers aoknowledge/apps/journal-d-etude/)
- **Git + Vercel :** ✅ Déployé en production
- **URL Production :** https://journal-d-etude-beta.vercel.app
- **GitHub Repository :** https://github.com/Aotenshiro2/journal-d-etude-beta
- **Sentry Monitoring :** ✅ SDK installé, configuré, et intégré
- **MCP Sentry :** ✅ Configuration créée pour Claude Code

### Intégration Sentry complète (23 oct 2025)
- **✅ SDK @sentry/nextjs :** Installation et configuration complète
- **✅ Error Boundaries :** Globaux et spécifiques aux composants
- **✅ Monitoring Canvas :** Capture erreurs + breadcrumbs interactions
- **✅ Performance Tracking :** Transactions et spans personnalisés
- **✅ MCP Configuration :** Setup pour intégration Claude Code
- **✅ Page de Test :** /test-sentry pour validation complète
- **✅ Utilitaires personnalisés :** Contexte spécifique app Journal d'Études

### Améliorations interface récentes (17 oct 2025)
- **✅ Interface Canvas :** Notification modernisée avec thèmes ShadCN UI
- **✅ Interface Éditeur :** Transparent corrigé, fond modal amélioré  
- **✅ Sélection texte :** Personnalisée jaune (#fcdf3e) avec texte noir global dans globals.css
- **✅ Interface utilisateur :** Zone de saisie en bas + raccourci Ctrl+Entrée
- **✅ Drag & Drop :** Handles améliorés, interactions fluides
- **✅ Images persistantes :** Correction critique parseHTMLToBlocks pour base64
- **✅ Visibilité blocs :** Hiérarchie normal/hover/focus avec backgrounds distincts
- **✅ UX Interactions :** Hover=grab, double-clic=édition, phase capture événements

### Détails techniques sélection jaune
```css
/* globals.css - Sélection personnalisée jaune */
*::selection {
  background-color: #fcdf3e !important;
  color: #000000 !important;
}
/* + sélecteurs spécifiques pour BlockNote, textarea, contenteditable */
```

## Commande de test Railway
```bash
DATABASE_URL="postgresql://postgres:dFDBpuKRWmxiJMcdHKfayFxzfjRLbyMy@caboose.proxy.rlwy.net:14621/railway" npm run dev
```