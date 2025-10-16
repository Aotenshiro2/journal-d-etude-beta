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
- [ ] **Sidebar**: Design ShadCN Card + Hero UI animations
- [ ] **NoteNode**: Card style avec shadows subtiles
- [ ] **Canvas**: Background et contrôles modernisés

### Priorité 2 - Interactions
- [ ] **Modals**: Animations Hero UI (scale, fade)
- [ ] **Forms**: Input states ShadCN style
- [ ] **Notifications**: Toast system moderne

### Priorité 3 - Polish
- [ ] **Dark Mode**: Transitions fluides
- [ ] **Micro-interactions**: Hover states partout
- [ ] **Loading States**: Skeletons cohérents

## Notes de Mise à Jour

**Date:** 16 octobre 2025
**Version:** v1.0 - Setup initial des références
**Prochaines étapes:** Configuration Tailwind avec tokens ShadCN

---

⚠️ **Important:** Toujours consulter ces références avant d'ajouter de nouveaux composants UI pour maintenir la cohérence visuelle.