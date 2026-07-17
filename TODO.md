# ✅ TODO — Journal d'Études

> Nettoyé le 17/07/2026 : sections d'octobre 2025 retirées (setup fait — l'app
> est en prod sur journal-d-etude-beta.vercel.app), `NEXT_STEPS.md` et
> `RESUME.md` supprimés (obsolètes). **Décisions Brice du 17/07** :
> - Le secret Railway dans l'historique git est **assumé jusqu'à la
>   pré-publication** — pas de chantier maintenant. → inscrit dans la
>   checklist pré-bêta ci-dessous.
> - **Supabase = données de compte uniquement** (auth). Tout le reste vit hors
>   Supabase (Railway PostgreSQL via Prisma) — éviter les goulots inter-apps.
> - **Une conversation Claude par version** (0.1, 0.2…) pour économiser le
>   contexte : ROADMAP.md + TODO.md + la mémoire persistante de Claude sont la
>   source de continuité. Tenir ce TODO à jour à chaque tâche finie.

**Versionnage et carte des modules : voir `ROADMAP.md`** (un module du dropdown =
une version mineure ; patch = une tâche finie et visible à l'écran).

---

## 🔨 CHANTIER EN COURS — 0.1.x « Étudier mes notes »

Objectif : le poste de travail note devient exploitable — « je le montre à un
élève sans m'excuser ». Le panneau de gauche est LA surface de travail ; le
canvas sert à organiser.

### 0.1.1 — Le poste de travail note ✅ LIVRÉ le 17/07/2026 (non commité)

- [x] **Double-clic sur une card de l'accueil → OUVRE la note** (`/notes/[id]`,
      le vrai poste de travail — `/study/[id]` n'est qu'une redirection).
      L'ancien dépliage sur place (`isExpanded`, 260×152 → 400×580) est
      supprimé de `NoteMapCanvas.tsx`. Le simple clic (preview, timer 220 ms)
      est inchangé. Vérifié à l'écran (page jetable, port 3007).
- [x] **Images cliquables** : `ImageLightbox` branché sur les DEUX panneaux
      gauches — `NotePreviewPanel` (accueil, via prop `onImageClick` de
      `NoteContentRenderer`) et `NoteReader` (/notes/[id], liste d'images +
      délégation sur le HTML de `note.content`). Curseur `zoom-in`
      (globals.css), fermeture clic ou Escape. Vérifié à l'écran.
- [x] **Édition via la capture bar** : EXISTAIT DÉJÀ sur l'accueil et
      c'est le bon endroit selon la doctrine — `CaptureBar` écrit texte
      et images dans la note sélectionnée (`POST /api/notes/[id]/messages`),
      le panneau gauche se rafraîchit (`refreshTrigger`). Sur `/notes/[id]`
      (exploration), PAS de capture bar : la note d'origine y est figée
      (doctrine ci-dessous). Rien à coder.

#### ⚖️ Doctrine « note d'origine vs copie de travail » (Brice, 17/07/2026)

La note d'origine = ce que l'élève a écrit pendant sa séance. Elle est
**précieuse et ne doit pas être polluée par le travail d'exploration**.
- **Accueil** : la note affichée EST la note d'origine → l'édition peut aller
  dans les deux sens (corrections de fautes, etc.), sync bidirectionnelle
  envisageable avec l'extension.
- **Dès que le travail d'exploration commence** (`/study`, mapping, groupes) :
  on travaille sur la **copie de travail** — plus AUCUNE modification de la
  note d'origine. (Le modèle le permet déjà : `CanvasNode.content` = surcharge
  locale, « l'original reste intact ».)
- Zone grise à trancher en codant : les corrections type orthographe faites
  depuis le journal avant/hors exploration peuvent remonter ; jamais celles
  issues du travail d'exploration.

### 0.1.2 — Le contrat de données extension → journal ✅ LIVRÉ le 17/07/2026

Contrat acté : **une métadonnée n'est jamais du contenu** — c'est un bloc
type `meta`, l'info est toujours en base mais masquée par défaut.

- [x] Audit fait (`scripts/audit-messages-0.1.2.mjs`) : 1031 blocs, 59 vides
      (supprimés — `scripts/cleanup-empty-messages-0.1.2.mjs`), bruit
      identifié (titres d'onglet, « Prix : », « RPNL : », « 💬 53 »).
- [x] **Type de bloc `meta`** (extension v1.6.7 + journal) : screenshot avec
      note ouverte → image + bloc meta directement dans la note (la capture
      bar de l'extension reste propre) ; jamais recopié dans `content` ;
      exclu des « Blocs disponibles » du canvas.
- [x] **Toggle œil** « afficher les métadonnées » dans les deux visualisateurs
      (`useShowMeta`, localStorage, masqué par défaut).
- [x] **Blocs texte vides** : filtrés à la sync, refusés par l'API
      (`POST /api/notes/[id]/messages`), purgés en base.
- [x] Bonus extension : 🐛 popup de suppression image/texte replié réparé
      (ConfirmDialog manquant hors branche texte).
- ⏭️ Reporté au chantier « capture intelligente » (TODO extension) : les
      métadonnées que la smart capture injecte encore dans le contenu.

### 0.1.3 — Groupes et liens : finir le geste

- [ ] Le geste complet : sélectionner des notes → grouper (« ces notes
      expriment une même idée ») → nommer le groupe → **le nom sert** :
      c'est un proto-concept (`CanvasNode.label` existe déjà). Définir ce qui
      se passe après le regroupement (promotion en concept ? filtre ?).
- [ ] Liens entre notes sur le canvas d'accueil (aujourd'hui le mode connexion
      n'existe que dans `/study`).

### 0.1.4 — Connectivité second cerveau (la saisie)

- [ ] Syntaxe `[[concept]]` dans la barre de capture + rendu pastille cliquable
      — **lot 2 de `SPEC-second-cerveau.md`** (le lot 1, page concept avec
      références, part en 0.2).

---

## 📦 File d'attente (ne pas ouvrir avant la fin du 0.1.x)

- **0.2.x Observer les concepts** : compteur de journalisation (« Breaker ×47 »)
  MAIS avec l'usage derrière — tuile cliquable → exploration du concept (notes,
  blocs, screenshots, grades). = lot 1 de `SPEC-second-cerveau.md`. La même
  donnée nourrit l'agrégation du mode mentorat de l'extension (moins cosmétique
  qu'il n'y paraît).
- **Pont Edgyx** : événementiel, en attente du retour de Geoffrey (dossier
  envoyé). Hors numérotation — extension d'abord, journal peut-être ensuite.
- `/market` est orphelin (aucun lien n'y mène) — supprimer si « Observer le
  marché » n'est plus au programme.

### 🔐 Checklist pré-bêta (à faire AVANT d'ouvrir au public, 0.9)

- [ ] **Roter le mot de passe Railway** (exposé en clair dans l'historique git
      du repo GitHub — anciens TODO/NEXT_STEPS/RESUME) ou fermer le service
      s'il ne sert plus. Décision Brice 17/07 : assumé d'ici là, rien à faire
      avant.
- [ ] Purge/vérification générale des secrets dans l'historique avant toute
      distribution.

---

## 📚 Acquis récents (référence, ne pas retoucher)

### Homogénéisation UI (TERMINÉE — 2026-07-16)

Direction artistique (Brice) : changer de page = la page d'accueil « se
métamorphose », pas de sensation de changer d'app. Outil : `CanvasShell.tsx`
(commit `6bb6aae`) — dot grid + top gradient, dropdown MODES, UserMenu,
pill bas-droite. Tous les écrans migrés (`/analytics`, `/patterns`, `/game`,
`/session`, `/review`, `/notes`, `/guide`, `/journal`, `/market`) ;
`AppHeader.tsx` et `ThemeToggle.tsx` supprimés.

À SAVOIR pour la suite :
- **Pas de titre hors accueil** (décision Brice 16/07) : le dropdown dit où tu
  es ; le `<h1>` de chaque vue est **éditorial** (« Ce qui revient dans tes
  notes »), jamais le nom de l'espace.
- **Écrans hors dropdown** : les déclarer dans `OFF_MENU_PAGES` de
  `CanvasShell`, sinon le bouton affiche un libellé faux.
- **Le shell ne reproduit pas tout l'accueil** : il manque la barre de capture
  centrale, « Notes · N » bas-gauche, la barre d'outils verticale droite — à
  ajouter en slots quand un écran en aura besoin.
- **Vérifier à l'écran sans session Supabase** : page jetable sous `/guide-*`
  (le middleware laisse passer `/guide`), `npx next dev -p 3007` dans WSL
  (⚠️ ne JAMAIS `pkill -f "next dev"` — ça tue le serveur de Codex ; tuer par
  port : `fuser -k 3007/tcp`). Supprimer la page jetable +
  `rm -rf .next/types/app/<page>` avant de committer.

### 🧠 Backlog — couche « second cerveau »

Spec complète : `SPEC-second-cerveau.md` (backlinks à la Logseq). Répartie dans
le versionnage : lot 2 (wikilinks) → 0.1.4 ; lot 1 (page concept + références)
→ 0.2 ; lots 3-4 (mentions non liées, graphe global) → 0.2+.

> Côté extension, voir `apps/carnet-du-trader-extension/TODO.md`
> (Edgyx, prompts IA, doctrine, mode mentorat).

---
**Dernière mise à jour :** 17 juillet 2026
**Chantier en cours :** 0.1.3 — groupes et liens : finir le geste
(0.1.1 et 0.1.2 livrés le 17/07 ; extension v1.6.7 zippée)
