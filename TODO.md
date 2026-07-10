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

### Concepts — compteur de journalisation
- [ ] Afficher pour chaque concept le nombre de fois qu'il a été journalé
      (ex. « Breaker ×47 »), lisible d'un coup d'œil sur /concepts.
- But pédagogique : l'élève voit immédiatement où il en est sur chaque concept.
- (option) Rappeler ce compteur dans le picker de tags/concepts.

### Homogénéisation de l'esthétique (à noter — pas à faire tout de suite)
- [ ] /concepts (et les autres écrans) doivent donner l'impression d'être la
      même application que l'accueil : même shell — canvas, dropdown de
      navigation en haut à gauche, même header. Aujourd'hui, cliquer sur
      Concepts donne l'impression de changer d'application.
- [ ] Audit de tous les écrans (concepts, patterns, analytics, review, game…)
      pour aligner header + navigation sur l'accueil.

> Côté extension, voir aussi `apps/carnet-du-trader-extension/TODO.md`
> (DOL — Draw on Liquidity, warmup multi-séances) — à faire avant le zip v1.6.0.

---
**Dernière mise à jour :** 10 juillet 2026
**Prochaine étape :** compteur de concepts + DOL/warmup côté extension