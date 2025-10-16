# 📝 Journal des Commits - Réflexions & Décisions Techniques

## Format
Chaque commit documenté avec :
- **Contexte** : Pourquoi ce changement ?
- **Décision** : Quelle solution choisie ?
- **Impact** : Conséquences techniques
- **Réflexions** : Alternatives considérées

---

## 🗓️ Session 16 Octobre 2025

### ⏸️ COMMIT PRÉVU - EN ATTENTE : Isolation Utilisateurs (Schema Prisma)

**Contexte :**
- Audit complet révélé : base de données globale partagée = SÉCURITÉ CRITIQUE
- Tous les utilisateurs voient les notes de tous les autres
- Besoin isolation des données par utilisateur

**Décision technique :**
```sql
-- Ajout modèle User + relations userId sur tous modèles
model User { id, email, name, avatar }
Note.userId -> User.id (required)
Course.userId -> User.id (required) 
Instructor.userId -> User.id (required)
Concept.userId -> User.id (required, unique par [name, userId])
```

**Impact :**
- ✅ Isolation complète des données
- ❌ Migration destructive (données test perdues)
- ❌ Besoin auth pour continuer dev

**Réflexion :**
**DÉCISION REPORTÉE** pour garder dev flow fluide.
Phase dev = priorité aux features core (liaison concepts-notes).
Auth/isolation = post-V1 pour ne pas bloquer les tests.

**Alternative retenue :**
Continuer sans isolation pour V1 dev, implémenter post-V1.

---

### ✅ COMMIT : Système complet liaison concepts-notes fonctionnel

**Contexte :**
- Vraie lacune identifiée : APIs concepts manquantes (handlers en TODO)
- TaggingModal sophistiqué existait mais non connecté à la base
- Simulation concepts vs système réel persistant requis pour V1

**Décision technique :**
```
APIs créées:
- /api/concepts (GET/POST) : Liste + création avec stats fréquence
- /api/notes/[id]/concepts (POST/DELETE) : Liaison bidirectionnelle

Connexions handlers:
- handleAddConcept : fetch POST → refresh notes → UI update
- handleRemoveConcept : fetch DELETE → refresh notes → UI update

Affichage visuel:
- NoteNode.concepts : note.concepts.map(nc => nc.concept.name)
- TaggingModal : useEffect chargement concepts existants
```

**Impact :**
- ✅ Système complet concepts-notes fonctionnel 
- ✅ Persistence base de données PostgreSQL
- ✅ Interface visuelle badges + modal connectée
- ✅ Auto-création concepts + gestion fréquence

**Réflexions :**
Feature critique V1 terminée. Remplace simulation par système réel.
Prêt pour tests utilisateurs avec vraie valeur ajoutée.

---

### ✅ COMMIT : Système dark mode cohérent complet

**Contexte :**
- Problème critique UX : Mix incohérent canvas dark + éditeurs light
- Cahier des charges spécifiait dark mode comme feature requise
- Nécessité d'un système de thème uniforme pour toute l'interface

**Décision technique :**
```
Architecture thème:
- ThemeProvider React Context + variables CSS
- Toggle persistant localStorage + détection système
- Variables AOKnowledge: --editor-bg, --text-primary, --modal-bg, etc.

Composants thémés:
- Toolbar: Toggle soleil/lune + boutons adaptés
- Canvas: Background + grille + minimap responsive
- NoteContentEditor: Modal + toolbar + TipTap styles complets
- TaggingModal: Overlay + interface concepts
- Sidebar: Background + bordures + éléments

TipTap integration:
- Styles JSX dynamiques avec variables CSS
- Couleurs texte/background/selection adaptatives
- Handles resize images + outline selon thème
```

**Impact :**
- ✅ Cohérence visuelle totale dark/light
- ✅ UX sans rupture entre canvas et éditeurs  
- ✅ Persistance préférence utilisateur
- ✅ Palette AOKnowledge respectée

**Réflexions :**
Feature critique résolue. Interface professionnelle cohérente.
Priorité utilisateur satisfaite : plus de mix thème incohérent.

---

### ✅ COMMIT PRÉVU : Mise à jour ROADMAP - État Réel Post-Audit

**Contexte :**
- Erreurs d'analyse initiale (suppositions vs réalité)
- Features déjà implémentées non identifiées : YouTube, PDF export, éditeur fullscreen

**Décision :**
Audit complet + mise à jour ROADMAP avec état RÉEL :
- ✅ YouTube intégration (TipTap extension)
- ✅ Export PDF fonctionnel  
- ✅ Éditeur enrichi complet
- ❌ APIs concepts manquantes (vraie lacune)

**Impact :**
- Guideline claire pour dev
- Priorités réajustées selon réalité
- Focus sur vraies lacunes vs suppositions

**Réflexions :**
Importance de l'audit avant modifications = économie temps/efforts.

---

## 🗓️ Sessions Précédentes

### Session 15 Octobre 2025
- ✅ Infrastructure Railway PostgreSQL
- ✅ Features UX majeures (drag-resize, concepts ICT, modal)
- ✅ Build production stable

---

**Dernière mise à jour :** 16 octobre 2025  
**Maintenu par :** Équipe AOKnowledge + Claude