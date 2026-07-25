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
Règle SIMPLE (clarifiée par Brice le 17/07, pas de zone grise) :
- **Accueil (le premier canvas)** : on travaille sur la **note d'origine** —
  la même que celle de l'extension. Édition dans les deux sens (capture bar,
  corrections), sync bidirectionnelle avec l'extension à terme.
- **`/notes/[id]` (l'exploration — ex-`/study`)** : on travaille sur la
  **copie de travail**, point. Plus AUCUNE modification de la note d'origine
  depuis cet écran. (Le modèle le permet déjà : `CanvasNode.content` =
  surcharge locale, « l'original reste intact ».)

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

- [x] **« Le nom sert »** (17/07) : promouvoir un groupe (bouton `#`) crée le
      tag ET tague tout le contenu du groupe — les notes (accueil → `NoteTag`)
      ou les blocs (exploration → `MessageTag`). Le regroupement spatial
      devient de la donnée : /concepts compte, croise et note ces concepts.
      API : `POST /api/tags` accepte `noteIds[]` / `messageIds[]` (idempotent,
      ceinture d'appartenance). ⚠️ à vérifier à l'écran par Brice.
- [x] ~~Liens entre notes sur le canvas d'accueil~~ — existaient DÉJÀ (outil
      crayon `E` de la barre droite + persistance `/api/canvas/[id]/edges`).
      L'inventaire du 16/07 était faux sur ce point.
- [x] **Groupe VIVANT** (option A choisie par Brice le 17/07) : un groupe
      promu garde le lien vers son concept (`CanvasNode.tagId`, migration
      manuelle `2026-07-17-group-vivant-tagid.sql` APPLIQUÉE en base).
      Y déposer une note/un bloc applique le tag, l'en sortir retire CELUI du
      groupe (jamais les tags posés ailleurs). Effets de bord centralisés dans
      la route PATCH `/api/canvas/[id]/nodes/[nodeId]`. Badge « ◆ concept »
      permanent sur le groupe. ⚠️ à vérifier à l'écran par Brice.
- [ ] Sous-cas à observer à l'usage : la DISSOLUTION d'un groupe vivant
      détague ses membres (symétrie appliquée partout) — si à l'usage ça
      surprend, faire de la dissolution une exception qui préserve les tags.

### ✅ Bug relecture — DIAGNOSTIQUÉ et CORRIGÉ le 19/07

Diagnostic (repro avec vraies données + logs Vercel : aucun crash) : le mode
focus et la carte-document fonctionnaient. Le vrai trou : **`reviewedAt`
n'était JAMAIS remis à zéro en réorganisant** — une note relue une fois ne
revenait plus jamais dans « À relire », même retravaillée sur le canvas. La
réorganisation ne nourrissait plus la relecture (contraire à la vision
consignée ci-dessous). FIX : poser un bloc/groupe/texte sur un canvas
`note-study` ou `collection` déjà relu remet `reviewedAt=null` → la note
re-rentre dans la file (route POST `/api/canvas/[id]/nodes`).
Bonus : fix P2002 NoteTag à la resync (createMany+skipDuplicates).

**+ Bibliothèque (décision Brice 19/07, plan validé, LIVRÉ)** : dans /review,
la section « Bibliothèque — notes travaillées » remplace « Déjà relues » et
« Collections mappées » : l'inventaire PERMANENT de tout ce qui a un canvas
travaillé (notes relues OU non + collections), toujours visible, filtre texte,
badge d'état, « Revoir » (lecture document sans rien marquer — mode focus) et
accès canvas. La file « À relire » = à faire ; la bibliothèque = consulter à
volonté sans réorganiser pour retrouver. La recherche THÉMATIQUE viendra de
/concepts (0.2).

### 📌 VISION à consigner (Brice, 19/07) — la relecture EST la vue document

Rappel du sens profond de la fonctionnalité, à garder devant les yeux pour le
débug ci-dessus et pour le 0.3 :
- En cours, l'élève prend ses notes dans **l'ordre du professeur** — pensé pour
  transmettre, pas forcément pour apprendre.
- Le tri sur le canvas sert à construire **l'ordre de l'élève** : la version
  réorganisée qui suit la manière dont LUI a besoin de relire son cours.
- La **vue document** de ce tri = la « version améliorée » de la note (ou du
  groupe de notes) — et c'est CETTE version qu'on doit pouvoir relire dans
  Relire. La relecture n'est pas rouvrir la note brute : c'est relire la
  réorganisation. (Vaut pour une note unique ET pour une collection.)

### 🧠 À approfondir (Brice, 17/07) — connectique « second cerveau » du canvas

Le canvas est limité pour le mind map comparé à Miro/Obsidian. Pas copier,
mais répondre au même besoin : des interactions riches entre cards — types de
liens nommés/orientés, liens qui portent du sens (donnée, pas dessin), peut-être
transclusion de blocs. Le groupe vivant est la 1re brique (le rangement spatial
EST de la donnée) ; les liens (edges) devraient suivre la même logique.
À traiter après les tests du 0.1.x — nourrira aussi `SPEC-second-cerveau.md`.

Limite identifiée par Brice (17/07, après test du groupe vivant) : une card
peut être **à mi-chemin entre deux groupes / deux idées de concept** — le
modèle actuel (un seul `parentId`, appartenance exclusive) ne le permet pas.
À repenser avec les outils de connectique : appartenance multiple ? le lien
typé card↔concept plutôt que la boîte ? Le groupe vivant reste effectif en
attendant.

### 0.1.4 — Connectivité second cerveau (la saisie) ✅ LIVRÉ le 17/07/2026

- [x] **Syntaxe `[[concept]]`** (lot 2 de `SPEC-second-cerveau.md`) :
      - Capture bar : taper `[[` ouvre l'autocomplete sur la taxonomie
        (Entrée/Tab/clic insère, option « Créer le concept » à la volée).
      - Serveur : chaque `[[nom]]` relie le bloc au concept (`MessageTag`) —
        dans la route capture bar ET dans la sync (les `[[...]]` tapés dans
        l'extension marchent aussi). Concepts EXISTANTS uniquement (pas de
        tags-typos), utilitaire partagé `src/lib/wikilinks.ts`.
      - Rendu : pastille bleue cliquable dans les deux panneaux de lecture
        (→ `/concepts` en attendant les pages concept du 0.2).
      Vérifié à l'écran (menu + pastilles). ⚠️ à tester connecté par Brice.
- [x] **Fix doctrine au passage** : la sync ne supprime PLUS les blocs ajoutés
      depuis la capture bar du journal (ils n'ont pas d'extensionMessageId et
      le replace-all les effaçait en silence à chaque resync). Ils restent
      côté journal ; les pousser vers l'extension = chantier sync
      bidirectionnelle, plus tard.

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

### 🚨 Incident 19/07 — élèves bloqués par « Log in to Vercel » (RÉSOLU côté diagnostic)

Des élèves (ex. alex17310@gmail.com) tombaient sur un login VERCEL en ouvrant
`journal-d-etude-beta-aotenshiros-projects.vercel.app`, et Brice recevait des
mails « Access request ». Cause : Deployment Protection Vercel (« Vercel
Authentication », défaut « Standard ») protège les URLs GÉNÉRÉES du projet —
seuls `journal.aoknowledge.com` et `journal-d-etude-beta.vercel.app` sont
publics. Même symptôme sur `pilotage-trader` (pilotage.aoknowledge.com).
Fix (dashboard, Brice) : Settings → Deployment Protection → Vercel
Authentication → **Disabled** sur `journal-d-etude-beta` ET `pilotage-trader`.
**RÈGLE PERMANENTE : ne JAMAIS partager une URL contenant
`-aotenshiros-projects` — lien élève = journal.aoknowledge.com /
pilotage.aoknowledge.com.** Vérifier aussi Supabase → Auth → URL Configuration
(Site URL = domaine public).

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
### 0.1.5+ — Le canvas d'étude n'est PAS fini (recadrage Brice 19/07)

⚠️ Le 0.1 n'est pas terminé : 0.1.1 → 0.1.4 = la plomberie et la donnée, mais
le CŒUR visuel de « Étudier mes notes » (le canvas de mind map) reste immature.
**On reste en 0.1 tant que l'étude de notes n'est pas mûre — comportement ET
esthétique.** Un élève doit pouvoir la montrer sans s'excuser.

**Le modèle décidé (discussion Brice 19/07) — « C dehors, B dedans »** :
- Séparer deux objets aujourd'hui confondus dans le « groupe » :
  - **Collection** = conteneur qui embarque N notes et ouvre SON canvas de
    mapping multi-notes (une note peut être dans plusieurs collections). C'est
    le besoin « grouper mes 5 séances FVG pour mapper leurs blocs ensemble ».
  - **Concept** = transverse, une carte en porte plusieurs, vit dans /concepts
    (déjà branché : tags, groupe vivant, `[[ ]]`).
- La multi-appartenance ne se règle PAS par la boîte (parentId unique React
  Flow) mais par les **liens** à l'intérieur du canvas de mapping.

Découpage (ordre indicatif, le 0.1 ne ferme qu'à maturité) :
- [x] **0.1.5 — La collection** (LIVRÉ 19/07, à tester connecté) : sur
      l'accueil, grouper des notes → bouton « ⤢ Mapper » sur le groupe →
      `/collection/[groupId]` : canvas de mapping commun qui embarque les
      blocs de TOUTES les notes du groupe (réutilise `StudyCanvas` +
      `MessagePanel`). Modèle : `Canvas.sourceGroupId` (noteId reste null,
      migration `2026-07-19-canvas-collection.sql` APPLIQUÉE). Composants :
      `src/app/collection/[groupId]/page.tsx` + `CollectionLayout.tsx`.
- [x] **0.1.5b — Collection autonome et flexible** (LIVRÉ 19/07, plan validé) :
      - Table `CollectionNote` (canvasId, noteId) = LA vérité de la membership
        (une note peut être dans N collections ; le parentId spatial n'est
        qu'une boîte visuelle). `Canvas.title` persistant. Migration
        `2026-07-19b-collection-note.sql` APPLIQUÉE.
      - « Mapper » → `POST /api/collection/[groupId]/sync` (upsert ADDITIF des
        membres — on n'enlève jamais automatiquement).
      - **Dissolution d'un groupe avec mapping** (décision Brice) : avertit
        mais GARDE le travail — le canvas survit, retrouvable dans Relire.
      - UI : tiroir gauche « Notes de la collection », origine (titre de
        séance) sur chaque chip du panneau de blocs.
- [x] **0.1.5c — Relecture des collections** (LIVRÉ 19/07) : toggle vue
      canvas ⇄ document dans la collection (DocumentView réutilisé — la base
      de la note de relecture existe pour un groupe comme pour une note) ;
      section « Collections mappées » dans /review (survit à la dissolution).
      Reste pour 0.3 : gestion complète des relectures (supprimer orphelines,
      rebrancher à des concepts) — vision Brice consignée au plan.
- [x] **Geste #2 (lien « idée commune » sans retravail)** : existait déjà —
      l'outil crayon `E` de l'accueil relie deux notes (edge persisté). À
      rendre plus « parlant » (nommer le lien) dans une passe esthétique.
- [x] **0.1.6 — Connectique accueil → concepts** ✅ **VALIDÉ EN PROD PAR BRICE
      LE 24/07** (traits visibles + survivent au rechargement, double-clic =
      nommer, nœud-concept relié → note taguée dans /concepts). Module clos.
      - Nœud-concept posable sur l'accueil (bouton `#` barre droite, picker +
        création à la volée) : `CanvasNode kind='concept'` + `tagId`.
      - Relier une note au nœud (crayon `E`) → `NoteTag` ; délier / supprimer
        le nœud retire CE tag (symétrie). Nourrit /concepts, zéro impact /notes.
      - Liens nommables : double-clic sur un trait = nommer (vide = supprimer).
      - 🐛→✅ **Bug « traits invisibles » : CAUSE TROUVÉE le 24/07, fix poussé,
        à retester en prod.** Ce n'était NI xyflow, NI React 19, NI les
        handles, NI le z-index : c'était une **collision d'identifiants**.
        `initialNodes` donnait aux cartes de note l'id de la NOTE
        (`id: note.id`), alors que les groupes et les nœuds-concept portent
        l'id du `CanvasNode` DB — et un `CanvasEdge` référence TOUJOURS des
        ids de `CanvasNode`. Conséquences en cascade :
        · au chargement, `source`/`target` des edges ne désignaient aucun
          nœud → React Flow jetait l'edge SANS erreur console → aucun trait ;
        · à la création, `onConnect` postait `fromId: params.source` = un id
          de note → violation de la FK `CanvasEdge.from → CanvasNode` →
          `catch` → 409 « Edge already exists » → l'edge n'était même pas
          écrit en base (contrairement à ce qu'on croyait) ;
        · idem pour tout lien note↔concept, donc le `NoteTag` côté serveur
          n'était jamais posé.
        Preuve : en base, 5 `CanvasEdge` — toutes entre nœuds `kind='message'`
        (canvas d'étude, qui marche) ; ZÉRO edge touchant une note ou un
        concept, alors que 2 nœuds-concept existent.
        Fix : table de traduction `rfIdByDbId` pour `initialEdges`, helper
        `ensureDbNodeId()` (id RF → id CanvasNode, création à la volée) utilisé
        par `onConnect` et `handleNodeDragStop`, `fromHandle`/`toHandle`
        désormais transmis, handles nommés `tt/tl/sb/sr` sur les 4 côtés
        (convention StudyCanvas) et visibles au survol (`group`).
        NB : le nœud-concept ne se déplace pas avec l'outil crayon `E`, c'est
        normal (`nodesDraggable: false` en mode connexion) — le déplacer avec
        `V` (sélection).
      - Règle de travail actée (Brice) : PLUS de vérif locale du rendu — on
        pousse, Brice teste en ligne (Vercel = env de dev vivant).
      - Reste (plus tard, avec l'esthétique) : liens typés bloc↔concept DANS
        le canvas de mapping (esprit B/Obsidian, multi-appartenance).
### 📝 Relire — demandes Brice du 23/07

- [ ] **Bouton « Retravailler » sur la carte de relecture** : à côté de
      « J'ai relu », pouvoir choisir de RETRAVAILLER la note si on n'est pas
      satisfait de sa réorganisation → ouvre le canvas (`/notes/[id]`, ou la
      collection). La note reste « à relire » (on ne la marque pas relue).
- [ ] **(passe esthétique 0.1.8/9/10…, PAS maintenant mais AVANT le 0.2)** :
      revoir le positionnement des blocs « Verdict de la note » et « Trades
      notés » dans la carte de relecture — esthétiquement pas bon aujourd'hui.
      ⚠️ Ne pas passer aux concepts (0.2) sans l'avoir fait.

### 📋 File PRÉ-0.1.7 (demandé par Brice le 19/07 — « avant d'attaquer la 0.1.7 »)

À faire dans cet ordre logique AVANT la passe esthétique, pas dans l'immédiat :
- [x] **Écrans de première connexion** (onboarding) — **FAITS des deux côtés**
      (journal ET pilotage), confirmé par Brice le 25/07/2026.
- [x] **Connexion aux comptes AOK** — LIVRÉ en prod le 25/07/2026.
      Site `aoknowledge.com` : `/connexion` (Google + email/mot de passe), hub
      `/mon-espace` (n° de compte client, statut Skool, liens outils, portail
      LiveClub, liaison identités email↔Google, emails multiples) + bouton discret
      dans la Nav. Masterclass : compte gratuit obligatoire (remplace la capture
      email, garde Kit + lead), bouton « Se connecter » dans le header. Migration
      Supabase appliquée (`member_number_seq` @21214, table `profile_emails` + RLS,
      trigger `handle_new_user` étendu). Brice = compte n° 001 (admin).
      ⚠️ Fait dans le VRAI repo WSL — le clone `D:\...\Ao knowledge` était 150
      commits en retard (à renommer « backup », dossier verrouillé au moment du
      renommage). Détails cosmétiques à peaufiner plus tard. Chantiers consignés :
      unification Stripe (Mélanie/Brice → 1 seul ID), entitlements/catalogue,
      identités Discord/Telegram, vérification d'appartenance des emails secondaires.
- [x] **Requalifier « masterclass semble down »** — RÉSOLU le 24/07, validé en
      ligne. Le serveur répondait bien 200 : le bug était dans la page.
      `sites/Masterclass/src/lib/supabase.ts` appelait `createClient()` au
      niveau module avec `import.meta.env.VITE_SUPABASE_URL` / `_ANON_KEY`.
      Vite inline ces valeurs AU BUILD ; elles n'étaient pas configurées sur le
      projet Vercel `masterclass-aoknowledge`, donc `createClient` jetait
      « supabaseUrl is required. » avant le montage de React → `#root` vide,
      page entièrement noire, rien en console pour le visiteur. Preuve : zéro
      occurrence de `*.supabase.co` dans le bundle déployé.
      Écarté au passage : ni l'hébergement (tous les déploiements `READY`), ni
      le quota Supabase (le projet visé `ujdqrtjanmmwidnfhkxg` est
      `ACTIVE_HEALTHY`, et la page mourait avant tout appel réseau).
      Correctif : client Supabase nullable + `isSupabaseConfigured`, garde dans
      `EmailGate`, et filet de sécurité dans `index.html` (si `#root` est encore
      vide 5 s après le `load`, on affiche un message lisible et l'erreur réelle
      au lieu d'une page noire muette — vaut pour toute panne future).
      Variables posées sur Vercel par Brice + redéploiement : vérifié, l'URL et
      la clé anon sont bien inlinées, les leads repartent en base.
      ⚠️ Deux dettes découvertes pendant le diagnostic — **TRAITÉES le
      25/07/2026** :
      · ~~images mortes en prod, 9 fichiers~~ → **le constat était faux.**
        `aoknowledge.com` est servi par `sites/Aoknowledgecom/v3/`, pas par
        `src/` (le titre de la page servie correspond à `v3/index.html`, et
        seul `v3/` a un `.vercel/`). Le balayage des assets réellement servis
        ne trouvait **aucune** référence au projet en pause. Il en restait UNE,
        sur une route chargée à la demande : le 3ᵉ avatar du teaser équipe de
        `/a-propos` (`v3/src/pages/AboutPage.tsx`). Corrigée en pointant vers
        `public-asset/Jules.jpg` du projet ACTIF `ujdqrtjanmmwidnfhkxg` —
        l'URL que `TeamPage.tsx` utilise déjà, vérifiée HTTP 200.
        **Reste 17 références mortes dans `sites/Aoknowledgecom/src/`**, une app
        qui n'est PLUS déployée (v3 l'a remplacée) : à archiver dans `_legacy`
        comme les précédentes — décision de Brice.
      · clé API Kit en clair → la dette avait **survécu au refactor** :
        `EmailGate.tsx` a été supprimé le 25/07 mais la clé a suivi dans
        `AuthGate.tsx`. L'abonnement passe désormais par
        `sites/Masterclass/api/kit-subscribe.ts` (fonction Vercel, runtime
        edge) qui lit `KIT_API_KEY` côté serveur. Même endpoint, même corps,
        aucun changement de comportement ; absence de la clé vérifiée sur le
        bundle réellement produit. **Clé NON révoquée** — décision de Brice, le
        site n'avait pas été mis en avant publiquement.
        ⚠️ Requiert `KIT_API_KEY` dans les variables d'environnement du projet
        Vercel `masterclass-aoknowledge`.
      · ⏭️ Découvert au passage, non traité : l'edge function
        `sites/Aoknowledgecom/supabase/functions/subscribe-convertkit/index.ts`
        contient un `CONVERTKIT_API_SECRET` en clair — côté serveur donc absent
        du bundle, mais en clair dans git.
- [x] **Adapter le canvas à l'usage mobile** (journal) — **LIVRÉ le 25/07/2026**,
      testé par Brice sur son téléphone au fil des lots. Restent deux suites
      volontairement non faites, décrites en fin de section.

      **Besoin cadré par Brice (25/07)** — au téléphone, trois choses et pas une
      de plus : (1) consulter ses canvas pour voir les liens déjà créés (accueil
      ET étude d'une note) ; (2) faire des correctifs rapides en `tap → tap`
      (poser un bloc, tracer un trait) ; (3) relire ses notes, d'origine comme
      retravaillées. « L'objectif n'est pas la même profondeur d'usage que
      l'ordinateur, mais un accès à son travail dans une interface qui ne trahit
      pas l'expérience visible sur ordinateur. »
      **Hors périmètre explicite** : `/concepts`, `/analytics`, `/patterns`,
      `/game`, `/session`, `/journal`, `/market` — leur mobile se fera quand on
      retravaillera ces modules, si nécessaire.
      **Gestes retenus** : `tap → tap` pour poser un bloc ET pour tracer un lien
      (crayon actif : tap card de départ → tap card d'arrivée). Le crayon manque
      au canvas d'étude (`select | mark | pan`), on l'y ajoute. Le drag & drop
      souris reste intact au bureau.
      **Pas de nouvel écran liste** : `/notes` est déjà responsive
      (`grid-cols-1`), l'accueil mobile reste la carte.

  - [x] **Étape 0 — Fondations** (25/07) : `export const viewport` dans
        `layout.tsx` (sans ça le téléphone rendait la page à ~980 px et dézoomait
        tout — cause n°1) ; `src/hooks/useIsMobile.ts` (`matchMedia` 767 px, sûr
        au SSR) ; `100vh → 100dvh` (`CanvasShell`, `Landing`, `/auth`) ;
        `.touch-target` / `.safe-bottom*` dans `globals.css` ; halo curseur non
        monté sur mobile ; pill bas-droite (thème · Relire · Notes · Guide, qui
        débordait à 375 px) repliée derrière « ⋯ » avec le badge `dueCount`
        conservé sur le bouton. Build vert, `viewport` vérifiée dans le HTML
        servi. **À valider sur le téléphone de Brice.**
  - [x] **Étape 1a — Lire, et dégager l'écran** (25/07, validé par Brice sur
        son téléphone) : nouvel écran **`/notes/[id]/lecture`** (la note
        d'origine plein cadre, colonne 680 px, 16 px de texte, dans
        `CanvasShell` donc même décor) — le panneau de 300 px passait sur un
        grand iPhone, pas en dessous. Accueil mobile : tap sur une card = on
        ouvre la lecture (plus d'aperçu latéral ni de timer 220 ms), outil
        **main** actif d'entrée, titre retiré (le dropdown suffit), bulle
        « Notes » et **capture bar** retirées, pill de l'accueil repliée elle
        aussi derrière « ⋯ » (l'étape 0 n'avait replié que celle de
        `CanvasShell` — l'accueil a sa propre copie). Halo du curseur coupé sur
        mobile dans les DEUX canvas. `/notes` : **recherche** (titre, dossier,
        tags) via `NotesBrowser`, et **deux boutons** par card — « Lire » et
        « Étudier » (un seul obligeait à passer par l'exploration ; le bouton
        teinté se lisait comme un tag → fond plein). Entrée **« Canvas »** dans
        la pile : le retour à la carte manquait.
  - [x] **Étape 1b — Le geste `tap → tap`** (25/07) : **crayon** sur les deux
        canvas — il manquait au canvas d'étude (`select | mark | pan`). Tap sur
        le départ, tap sur l'arrivée ; halo `.link-armed` ; tap dans le vide
        annule ; pill d'état en bas (sans elle « il ne se passe rien »).
        Rebranche les `onConnect` existants, donc rien de réécrit côté
        persistance. **Poser un bloc** : tap sur un chip du tiroir (il s'arme,
        le tiroir se replie), tap sur le canvas (il se pose) — rebranche le
        `screenToFlowPosition` du `onDrop`. État `armedMessageId` porté par
        `StudyLayout` et `CollectionLayout`. Le drag & drop souris est intact.
        **À valider sur le téléphone de Brice.**
  - [x] **Étape 2 — Relire** (25/07) : boutons **A/B/C à 44 px** au téléphone
        (32 px suffisaient à la souris, pas au pouce) et causes descendues sur
        leur propre ligne — alignées, elles s'écrasaient sur 375 px. Champs de
        saisie à **16 px** : en dessous, iOS zoome tout seul à la mise au point.
        « J'ai relu » prend la largeur, rappels 7 j / 30 j devenus de vraies
        cibles. Lignes de la bibliothèque sur deux rangées (six éléments
        alignés ne tenaient pas). `DocumentView` : marge droite 48 → 14 px,
        décalage haut 76 → 20 px, et **lecture seule sur mobile** (son
        réordonnancement est du DnD HTML5). `globals.css` : le HTML capturé est
        borné (tableaux et blocs de code défilent dans leur boîte, images et
        iframes bornées) — sans ça une page capturée poussait tout l'écran en
        scroll horizontal.
  - [x] **Étape 3 — Ce que le survol cachait** (25/07, signalé par Brice après
        test). Un défaut de famille : **toute affordance en `opacity-0
        group-hover`, ou déclenchée au double-clic, est inatteignable au doigt.**
        - **Réordonner la vue document** en `tap → tap` (elle était passée en
          lecture seule au lot précédent) : on touche la poignée d'un bloc ou
          d'une section (visible sur mobile, elle était en `opacity-0`), les
          emplacements « Poser ici » apparaissent, on touche le bon. Réutilise
          `dropBlock`/`dropSection` tels quels — on remplit `dragRef` soi-même.
        - **Renommer un groupe** et **éditer un bloc** : les deux tenaient au
          `onDoubleClick`, que le navigateur mobile transforme en zoom. Bouton
          crayon dédié au téléphone.
        - **Actions de bloc** (rétablir ↺, agrandir ⤢, retirer ✕) et **barre du
          groupe** (couleurs, « Mapper ») : visibles à la **sélection** du nœud
          sur mobile, agrandies à 32 px. Pas en permanence — elles
          encombreraient chaque bloc du canvas.
  - [ ] **Demandé par Brice le 25/07, à traiter plus tard — corriger un texte
        depuis le téléphone.** « Je relis ma note, faire une modif de texte
        rapide depuis le tel donne envie d'être possible. » ⚠️ Ce n'est pas un
        ajustement mobile : ça touche la **doctrine note d'origine** (l'écran de
        lecture affiche la note d'origine, aujourd'hui volontairement en lecture
        seule) et il n'y a plus de capture bar sur mobile. À arbitrer avec Brice
        avant de coder : édition en place sur `/notes/[id]/lecture`, ou retour
        d'une capture bar sur cet écran ?
  - [ ] Pas fait, connu : **placer une note sur la carte au doigt** reste
        impossible (le drop de note vient d'un drag & drop HTML5). Piste
        évoquée : un bouton « Placer sur la carte » sur la card de `/notes`, qui
        renvoie à l'accueil avec la note armée.

- [ ] **0.1.7+ — Passe esthétique** (Brice : « n'imagine pas que le 0.1.6 soit
      la fin »). Revoir le look du canvas et de l'étude de notes jusqu'à
      maturité. À détailler le moment venu. **Après la file pré-0.1.7
      ci-dessus.**

Réf : `SPEC-second-cerveau.md` + section « connectique second cerveau » plus
haut (limite de la carte à mi-chemin entre deux concepts = résolue par les
liens du 0.1.6, pas par la boîte).

---
**Dernière mise à jour :** 25 juillet 2026
**Chantier terminé :** **canvas du journal au mobile** — LIVRÉ le 25/07/2026,
testé par Brice au fil des lots. Restent deux suites tracées et volontairement
non faites : **corriger un texte depuis le téléphone** (touche la doctrine note
d'origine, à arbitrer avec Brice) et **placer une note sur la carte au doigt**.
Les deux dettes de prod du 24/07 sont **traitées** (l'une reposait sur un
constat faux : une seule image morte, pas neuf — détail plus haut) et les
**écrans de première connexion sont faits des deux côtés**. La file pré-0.1.7
est donc vide : **prochain = 0.1.7, la passe esthétique**.
Connexion aux comptes AOK **LIVRÉE en prod le 25/07/2026**.
Restent dans la file pré-0.1.7 : écrans de première connexion (onboarding pilotage),
puis 0.1.7 esthétique (dont repositionnement Verdict/Trades notés — ⚠️ avant le 0.2).
**Chantier en cours :** 0.1.5 — la collection (canvas de mapping multi-notes).
Le 0.1 reste OUVERT jusqu'à maturité (fonctionnel 0.1.5/0.1.6 + esthétique
0.1.7+). Le 0.2 « Observer les concepts » attend la fin du 0.1.
