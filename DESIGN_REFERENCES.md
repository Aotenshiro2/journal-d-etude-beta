# Design References - Journal d'Études

## Bases de Design Approuvées

### 🎨 **ShadCN UI** - Système de Design Principal
**URL:** https://ui.shadcn.com/docs/components

**Utilisation:**
- Système de couleurs (zinc, slate, neutral avec échelles 50-950)
- Composants de base (Button, Card, Input, Dialog, Accordion, etc.)
- Typography scale et spacing system
- Dark/Light mode natif
- Variables CSS et design tokens

**Composants prioritaires à adopter:**
- Button variants (default, destructive, outline, secondary, ghost, link)
- Card avec shadow system
- Input avec focus rings
- Dialog/Modal animations
- Accordion pour sections expandables

### 🚀 **Hero UI** - Animations et Interactions
**URL:** https://www.heroui.com/docs/components/accordion

**Utilisation:**
- Animations fluides et spring-based
- Micro-interactions sophistiquées
- Hover states élégants
- Transitions naturelles
- Accordion avec indicateurs animés

**Principes clés à intégrer:**
- Smooth animations (spring physics)
- Progressive disclosure
- Accessible interactions
- Motion design cohérent

### 🤖 **AI SDK Elements** - Workflow et Architecture
**URL:** https://ai-sdk.dev/elements/overview

**Utilisation:**
- Architecture workflow interactive inspirée de notre canvas
- Patterns de drag-and-drop sophistiqués
- Gestion d'état pour éléments connectés
- Interactions multi-modales (souris + tactile)
- Flow de données entre composants

**Concepts appliqués dans notre app:**
- Canvas interactif avec React Flow
- Sidebar d'éléments draggables
- Connexions visuelles entre notes
- États de sélection et groupement
- Workflow de création/édition fluide

## Guidelines d'Implémentation

### Palette de Couleurs
```css
/* Adopter le système ShadCN */
--zinc-50: #fafafa;
--zinc-100: #f4f4f5;
--zinc-200: #e4e4e7;
/* ... jusqu'à zinc-950 */

--primary: var(--zinc-900);
--secondary: var(--zinc-100);
--accent: var(--blue-600);
```

### Typography Scale
```css
/* Suivre le système ShadCN */
text-xs: 0.75rem;    /* 12px */
text-sm: 0.875rem;   /* 14px */
text-base: 1rem;     /* 16px */
text-lg: 1.125rem;   /* 18px */
text-xl: 1.25rem;    /* 20px */
```

### Spacing System
```css
/* Utiliser la progression Tailwind */
0.5: 0.125rem;  /* 2px */
1: 0.25rem;     /* 4px */
1.5: 0.375rem;  /* 6px */
2: 0.5rem;      /* 8px */
3: 0.75rem;     /* 12px */
4: 1rem;        /* 16px */
6: 1.5rem;      /* 24px */
8: 2rem;        /* 32px */
```

## Composants de l'App à Moderniser

### Priorité 1 - Core UI
- [x] **Sidebar**: Design ShadCN Card + Hero UI animations
- [x] **NoteNode**: Card style avec shadows subtiles
- [x] **Canvas**: Background et contrôles modernisés

### Priorité 2 - Interactions
- [x] **Modals**: Animations Hero UI (scale, fade)
- [x] **Forms**: Input states ShadCN style
- [ ] **Notifications**: Toast system moderne

### Priorité 3 - Polish
- [x] **Dark Mode**: Transitions fluides
- [x] **Micro-interactions**: Hover states partout
- [ ] **Loading States**: Skeletons cohérents

## Notes de Mise à Jour

**Date:** 17 octobre 2025
**Version:** v2.0 - Refonte interface complète + ajout AI SDK Elements
**Dernières réalisations:** 
- ✅ Canvas nettoyé et Panel top-right avec toggle dark/light
- ✅ Sidebar réorganisée (Notes → Concepts → Groupement)
- ✅ Icônes Lucide modernes + export PDF déplacé
- ✅ Design system ShadCN UI pleinement intégré
**Prochaines étapes:** Workflow AI Elements + animations avancées

---

⚠️ **Important:** Toujours consulter ces références avant d'ajouter de nouveaux composants UI pour maintenir la cohérence visuelle.