# 📚 Journal d'Études - AOKnowledge Ecosystem

> **Application de prise de notes interactive pour l'apprentissage moderne**  
> Première pierre de l'écosystème AOKnowledge multi-applications

## 🎯 Vision du Projet

**Journal d'Études** est une application de prise de notes révolutionnaire qui combine :
- **Canvas interactif** avec React Flow pour visualiser les connexions entre concepts
- **Éditeur riche** TipTap avec redimensionnement d'images par drag
- **Système de concepts ICT/Smart Money** intégré (30 concepts organisés)
- **Workflow professionnel** avec cours, formateurs, et métadonnées enrichies

## ✨ Fonctionnalités Principales

### 📝 **Système de Notes Avancé**
- ✅ **Notes visuelles** positionnables librement sur un canvas infini
- ✅ **Éditeur riche** avec support images, vidéos YouTube, liens
- ✅ **Redimensionnement drag** des images et notes par handles visuels
- ✅ **Auto-sauvegarde** en temps réel
- ✅ **Preview enrichi** avec tags, formation, formateur

### 🔗 **Système de Connexions**
- ✅ **Mode connexion** pour lier des notes entre elles
- ✅ **Edges customisables** (animés, temporaires, standard)
- ✅ **Navigation visuelle** entre concepts liés

### 🏷️ **Concepts ICT/Smart Money**
- ✅ **30 concepts professionnels** organisés en 5 catégories
- ✅ **Double mode sidebar** : vue d'ensemble + édition détaillée
- ✅ **Statistiques d'usage** et tendances simulées
- ✅ **Recherche intelligente** dans noms et définitions

### 📊 **Organisation & Métadonnées**
- ✅ **Système de cours** avec instructeurs
- ✅ **Modal propriétés** flottant moderne
- ✅ **Groupement de notes** par sélection multiple
- ✅ **Export** et outils collaboratifs

## 🛠️ Stack Technique

### **Core Framework**
- **Next.js 15.5.5** avec App Router et Turbopack
- **TypeScript** pour la sécurité des types
- **Tailwind CSS** pour le styling moderne

### **Base de Données & Backend**
- **Railway PostgreSQL** (5€/mois) pour la production
- **Prisma ORM** pour la gestion des données
- **API Routes** Next.js pour les endpoints

### **Édition & Interface**
- **TipTap** - Éditeur riche basé ProseMirror
- **React Flow** - Canvas interactif pour les notes
- **Lucide React** - Icônes modernes
- **Framer Motion** - Animations fluides

### **Déploiement**
- **Vercel** - Hébergement et CI/CD automatique
- **Git** - Contrôle de version avec GitHub

## 🚀 Démarrage Rapide

### Prérequis
- Node.js 18+ 
- npm/yarn/pnpm
- PostgreSQL (Railway configuré)

### Installation
```bash
# Clone du repository
git clone <repository-url>
cd journal-d-etude

# Installation des dépendances
npm install

# Configuration de la base de données
npm run db:push
npm run db:generate

# Démarrage du serveur de développement
npm run dev
```

### Commandes Utiles
```bash
npm run dev          # Serveur de développement
npm run build        # Build de production
npm run lint         # Vérification ESLint
npm run type-check   # Vérification TypeScript
npm run db:push      # Synchronisation schema Prisma
npm run db:generate  # Génération client Prisma
npm run db:reset     # Reset base de données
```

## 📱 Interface Utilisateur

### **Workspace Principal**
- **Canvas infini** avec zoom et pan fluides
- **Sidebar responsive** 80px → 320px selon le mode
- **Toolbar flottant** avec outils spécialisés

### **Modes Opérationnels**
- 🔗 **Mode Connexion** - Lier des notes visuellement
- 🎯 **Mode Groupement** - Sélection multiple avancée
- 💡 **Mode Concepts** - Tagging ICT/Smart Money
- ✏️ **Mode Édition** - Rédaction avec éditeur fullscreen

### **Responsive Design**
- **Desktop-first** avec support mobile prévu
- **Interface adaptive** selon la taille d'écran
- **Touches clavier** pour les power users

## 🔧 Architecture du Code

### **Structure des Dossiers**
```
src/
├── app/                 # App Router Next.js
│   ├── api/            # API Routes (notes, courses, instructors)
│   └── page.tsx        # Page principale
├── components/         # Composants React
│   ├── NoteNode.tsx    # Nœud de note sur canvas
│   ├── Sidebar.tsx     # Panneau latéral dual-mode
│   ├── ReactFlowCanvas.tsx
│   └── ...
├── lib/                # Utilitaires et configurations
│   ├── ict-concepts.ts # Base de données concepts ICT
│   ├── SimpleDragImage.ts # Extension TipTap
│   └── utils.ts        # Helpers généraux
├── types/              # Définitions TypeScript
└── prisma/             # Schema et migrations
```

### **Composants Clés**
- **NoteNode** - Composant canvas avec drag-resize
- **NoteContentEditor** - Éditeur fullscreen TipTap
- **Sidebar** - Interface dual-mode concepts/outils
- **ReactFlowCanvas** - Gestionnaire canvas principal

## 📊 État Actuel du Développement

### ✅ **Fonctionnalités Complétées**
- [x] Interface canvas React Flow opérationnelle
- [x] Système CRUD notes avec Railway PostgreSQL
- [x] Éditeur TipTap avec redimensionnement images
- [x] Drag-resize notes sur canvas avec handles
- [x] Sidebar concepts ICT double-mode (30 concepts)
- [x] Preview notes enrichi avec métadonnées
- [x] Modal propriétés flottant moderne
- [x] Système connexions entre notes
- [x] Organisation cours/instructeurs
- [x] Export et outils collaboratifs

### 🔄 **En Cours de Développement**
- [ ] Liaison concepts ↔ notes fonctionnelle (API)
- [ ] Tests complets toutes fonctionnalités
- [ ] Optimisations performance

### 📋 **Roadmap Future**
- [ ] Authentification utilisateurs
- [ ] Collaboration temps réel
- [ ] Mode mobile responsive
- [ ] Intégration écosystème AOKnowledge principal
- [ ] Migration infrastructure commune

## 🌐 Déploiement

### **Production Actuelle**
- **URL :** https://journal-d-etude-beta.vercel.app/
- **Status :** Beta opérationnelle
- **Performance :** Build time ~3.7s, optimisé

### **Infrastructure**
- **Frontend :** Vercel (fra1 region)
- **Base de données :** Railway PostgreSQL
- **CDN :** Vercel Edge Network
- **Monitoring :** Vercel Analytics

## 🤝 Contribution

### **Workflow Git**
```bash
git checkout -b feature/nouvelle-fonctionnalite
# Développement...
npm run build  # Test compilation
git commit -m "feat: description de la fonctionnalité"
git push origin feature/nouvelle-fonctionnalite
```

### **Standards de Code**
- **TypeScript strict** activé
- **ESLint** pour la qualité
- **Prettier** pour le formatage
- **Commits conventionnels** (feat, fix, docs, etc.)

## 📞 Support & Documentation

### **Liens Utiles**
- **ROADMAP.md** - Vision complète multi-applications
- **CLAUDE.md** - Instructions pour l'IA
- **Vercel Dashboard** - Monitoring déploiement
- **Railway Dashboard** - Gestion base de données

### **Contact**
- **Projet :** AOKnowledge Ecosystem
- **App :** Journal d'Études Beta
- **Maintenu par :** Claude + Équipe AOKnowledge

---

**Dernière mise à jour :** 15 octobre 2025  
**Version :** 1.0 Beta  
**Build Status :** ✅ Opérationnel