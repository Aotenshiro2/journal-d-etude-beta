# SPEC — Couche « second cerveau » (backlinks à la Logseq)

> **Statut : backlog, non priorisé.** Rédigée le 17/07/2026 après analyse de Logseq
> (https://github.com/logseq/logseq). Objectif : emprunter les mécanismes de connexion
> de Logseq (liens `[[concept]]`, backlinks, références non liées, graphe global)
> sans adopter l'outil lui-même (stack Clojure, licence AGPL, fichiers locaux).

## 1. Objectif

Transformer la taxonomie de concepts (tags ICT) en mémoire vivante : depuis la page
d'un concept, voir **tous les blocs de toutes les séances** qui le mentionnent, avec
contexte et date — et à l'écriture, lier un concept aussi naturellement qu'on tape
du texte.

## 2. Ce qui existe déjà (à réutiliser, pas à recréer)

- **Blocs atomiques** : `Message` (ordonnés dans une `Note`, avec `tradeRef`).
- **Lien bloc ↔ concept** : la table `MessageTag` existe déjà dans
  `prisma/schema.prisma`. C'est la table de backlinks — rien à créer côté modèle
  pour le lot 1.
- **Page concepts** : `src/app/concepts/page.tsx` calcule déjà par tag les
  noteCount/blockCount, les grades A/B/C et les co-occurrences (top 4 `related`).
  UI : `src/components/ConceptsEmergence.tsx`.
- **Saisie** : `textarea` simple dans `src/components/CaptureBar.tsx`
  (⚠️ TipTap est dans `package.json` mais **non branché** dans `src/` — ne pas
  supposer un éditeur riche).
- **Concepts auto-extraits** : `Note.concepts[]` (smart capture extension) — base
  des « références non liées ».
- **Canvas React Flow** : `NoteMapCanvas` / `StudyCanvas` — support du graphe global.

## 3. Chantiers (4 lots indépendants, ordre = valeur décroissante)

### Lot 1 — Page concept avec backlinks (le cœur)

Chaque tag devient une vraie page : `/concepts/[tagId]`.

- **Section « Références »** : tous les `Message` liés via `MessageTag`, groupés par
  `Note` (titre + date de séance), triés antichronologiquement. Chaque bloc affiche
  son contenu, son `tradeRef` éventuel et le grade A/B/C de la note (via
  `Annotation`). Clic → ouvre la note à ce bloc.
- **En-tête** : stats existantes de `ConceptStat` (récurrence, tendance A/B/C,
  concepts co-occurrents cliquables → navigation entre pages concepts).
- **API** : `GET /api/tags/[id]/references` → `{ notes: [{ id, title, date, grade,
  messages: [{ id, content, tradeRef }] }] }`. Paginer par note (20 notes/page).
- `ConceptsEmergence` : chaque carte concept devient un lien vers sa page.

### Lot 2 — Syntaxe `[[concept]]` à la saisie

- Dans `CaptureBar` : taper `[[` ouvre un autocomplete (dropdown positionné sous le
  caret) sur les tags de l'utilisateur ; `Entrée` insère `[[Nom du concept]]` ;
  option « créer "xyz" » si aucun match (POST `/api/tags`).
- **Au submit** : parser le texte (`/\[\[([^\]]+)\]\]/g`), résoudre chaque nom en
  `Tag` (insensible à la casse), créer les `MessageTag` manquants. Le parsing vit
  côté serveur dans la route de création de message (source de vérité), le client
  ne fait que l'autocomplete.
- **Au rendu** des blocs (`MessagePanel`, `NoteReader`, `DocumentView`) : `[[X]]`
  s'affiche comme une pastille colorée (couleur du tag) cliquable → page concept.
  Un seul utilitaire partagé `renderWikiLinks(content)` dans `src/lib/`.
- **Édition/suppression** d'un bloc : re-parser et resynchroniser les `MessageTag`
  d'origine wikilink (voir §4).
- Sync extension : les messages poussés par l'extension passent par la même route →
  les `[[...]]` tapés dans l'extension marchent gratuitement. (Autocomplete côté
  extension = hors périmètre, chantier extension séparé.)

### Lot 3 — Références non liées (suggestions)

- Sur la page concept, section « Mentions non liées » : blocs dont le contenu
  contient le nom du tag (ou un alias) **sans** `MessageTag` associé.
- Recherche : `ILIKE` sur `Message.content` (index trigram si lent — migration
  manuelle dans `prisma/migrations-manual/`, cf. convention du repo). Croiser aussi
  `Note.concepts[]` (smart capture) pour les suggestions au niveau note.
- Bouton « Lier » par bloc (crée le `MessageTag`) + « Tout lier ».
- Prérequis modèle : champ `aliases String[] @default([])` sur `Tag`
  (« FVG » ↔ « fair value gap »).

### Lot 4 — Graphe global (la vue seconde-cerveau)

- Page `/concepts/graph` : un React Flow **en lecture seule** réutilisant le style
  du canvas existant. Nœuds = tags (taille ∝ blockCount, couleur du tag) ; arêtes =
  co-occurrence (le calcul de `/concepts/page.tsx` généralisé, seuil ≥ 2 notes
  partagées, épaisseur ∝ poids). Clic nœud → page concept.
- Layout automatique force-directed (d3-force au montage, positions non
  persistées — pas de nouveau modèle Prisma).
- Filtres : par catégorie de tag, par période, par grade dominant.

## 4. Modèle de données — seul ajout

```prisma
model MessageTag {
  // champs existants inchangés…
  source String @default("manual") // 'manual' | 'wikilink' | 'suggested'
}
```

`source` permet : (a) resynchroniser les liens `wikilink` à l'édition d'un bloc sans
écraser les liens posés à la main ; (b) distinguer les liens confirmés des liens
« Tout lier ». Migration manuelle SQL (convention du repo), défaut `'manual'` pour
l'existant. Lot 3 ajoute `Tag.aliases`.

## 5. Hors périmètre (assumé)

- Transclusion vivante des blocs sur le canvas (remplacer la copie
  `CanvasNode.content` par un embed synchronisé) — chantier canvas séparé.
- Références de blocs `((id))` à la Logseq — le couple wikilink + backlinks suffit
  pour l'usage journal de trading.
- Requêtes avancées (« blocs [[FVG]] en trade perdant ») — attendre que les données
  de liens existent ; les filtres du lot 4 en sont la première marche.
- Autocomplete `[[` dans l'extension Chrome.

## 6. Estimation grossière

| Lot | Taille | Dépend de |
|---|---|---|
| 1 Backlinks | ~2-3 sessions | rien (données déjà là) |
| 2 Wikilinks | ~2 sessions | rien (mieux après 1) |
| 3 Non liées | ~1-2 sessions | 1 (UI page concept) |
| 4 Graphe | ~2 sessions | idéalement 2 (plus de liens = graphe plus riche) |

Le lot 1 seul apporte déjà de la valeur avec les tags existants, sans rien changer
à la saisie.
