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
- ~~Requêtes avancées (« blocs [[FVG]] en trade perdant »)~~ → **REMONTÉ DANS LE
  PÉRIMÈTRE le 31/08/2026, sur demande de Brice** : les stats de résultat par
  concept sont l'une des trois choses qu'il attend de l'écran. Voir §7 et §8. La
  raison d'origine (« attendre que les données de liens existent ») reste juste,
  et c'est précisément ce que §8 traite en priorité.
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

---

# ADDENDUM 31/08/2026 — ce que le 0.2 doit faire, et ce que la base permet

> Cette partie étend la spec plutôt que de créer un fichier : `SPEC-second-cerveau.md`
> fait déjà autorité sur la page concept. Elle est écrite après la demande de Brice
> du 31/08 et **après avoir compté la base** — la partie 1-6 ci-dessus a été rédigée
> le 17/07 sur des hypothèses, pas sur des mesures.

## 7. La demande de Brice, mot pour mot

Permettre à un élève d'**étudier en fonction des concepts, stratégies, étiquettes**
posés dans l'extension ou dans le journal. L'écran concept doit donner, pour un
concept donné :

1. **toutes les notes** prises sur ce concept ;
2. **tous les screenshots** pris pendant les séances de trading où il est en jeu ;
3. **des stats** sur le résultat d'usage du concept et sur sa notation.

Le point 2 n'était pas dans la spec du 17/07. Le point 3 y était explicitement
hors périmètre (§5). Les deux entrent maintenant.

## 8. Ce que la base contient VRAIMENT (mesuré le 31/08)

Scripts rejouables : `scripts/inventaire-concepts-0.2.mjs`, `-bis.mjs`,
`-par-membre.mjs`, `scripts/lister-etiquettes.mjs`.

**Les liens existent, et ils portent déjà des images.** 129 étiquettes, 78 liens
`NoteTag`, 122 liens `MessageTag` — dont **43 sur des blocs `image` et 11 sur des
`screenshot`**. Le mécanisme de la galerie fonctionne donc déjà ; il est juste peu
utilisé (54 captures liées sur ~930 blocs image). 3 étiquettes orphelines
seulement. Mais le volume par concept est minuscule : le mieux fourni en a 8.

**La taxonomie vient de six membres, pas d'une personne.** `brice.d` porte 52
étiquettes sur 129 (40 %), `fdb811` 50, `digital4web3` 17, puis 5, 3, 2. **Et deux
styles d'usage OPPOSÉS coexistent** : `fdb811` tague les blocs et les images (89
liens bloc, dont 42 captures, contre 4 liens note) ; `brice.d` tague au niveau de
la note (51 liens note, 26 liens bloc). L'écran doit réunir les deux sources sans
privilégier l'une — ce que `/concepts/page.tsx` fait déjà par union.
**Corollaire à ne pas oublier : trois membres actifs ont des notes et ZÉRO
étiquette** (`cedri98` va jusqu'à poser 3 notations sans jamais taguer). Compter
sur le tag manuel, c'est ignorer un tiers des membres qui utilisent l'app.

**La chaîne précise vers le résultat est cassée, et pas par hasard.** 72 blocs
portent un `tradeRef`, 122 blocs sont tagués, **l'intersection est exactement 0**.
Ce sont deux populations disjointes : on tague les blocs d'explication, on rattache
au trade les blocs de séance. Donc « ce concept en trade perdant » au niveau du
bloc est impossible aujourd'hui, et le restera tant que ce nombre ne montera pas.

**Le chemin de repli fonctionne, à petite échelle.** En attribuant le résultat à la
SÉANCE et non au bloc : 20 concepts sur 129 ont au moins un chiffre. Exemples
réels : `macro breaker` 6 séances / 1 gain / A1 B1 ; `50:10` 1 gain 2 pertes / A1
B1 ; `50% DRT` 1 gain 1 BE / C1. C'est vrai et calculable ; ce n'est pas une base
statistique.

**Un gisement s'ouvre.** `Note.concepts[]` (concepts auto-extraits) n'est rempli
que sur 1 note / 200 — mais la brique IA de la capture est entrée en production le
31/08. Ce champ va se remplir tout seul. C'est le carburant des suggestions, et il
n'existait pas quand la partie 1-6 a été écrite.

**Conclusion : l'écran n'est pas le goulot, la production des liens l'est.** On
peut dessiner la plus belle page concept possible : avec 54 captures liées sur 930
et 20 concepts ayant un chiffre, elle sera honnête et vide.

## 9. Les lots du 0.2

### Lot 0 — Classer la taxonomie (préalable, court)

`Tag.category` était vide sur les 129. Sans classement, l'écran de sélection mêle
concepts ICT, instruments, plateformes, jours de la semaine et bruit de test.

Neuf catégories, posées par `scripts/classer-etiquettes-0.2.mjs` (blanc par
défaut, `--appliquer` pour écrire) : `concept` 32, `moment` 23, `source` 22,
`a-trier` 19, `instrument` 9, `activite` 8, `execution` 7, `evenement` 5,
`mental` 4.

Trois partis pris :
- **le classement se fait par NOM**, pas par (nom, membre) : deux membres qui
  écrivent « macro breaker » parlent de la même chose. La catégorie est un
  vocabulaire partagé, la taxonomie reste privée à chacun ;
- **on ne fusionne rien.** Les 10 « doublons » apparents appartiennent à des
  membres différents (`Tag` est unique par `(name, userId)`) : les fusionner
  détruirait la taxonomie de quelqu'un. Un seul vrai doublon existe, `tp`/`TP`
  chez `brice.d` ;
- **`a-trier` est un panier assumé**, pas un fourre-tout d'échec : abréviations
  indécidables de l'extérieur (`ker`, `qlys`, `blc`, `bb`, `hrlr`, `std`,
  `shadow`), raccourcis personnels (`race`, `ferrari`, `the futur`), ambiguïtés
  réelles (`eth` = Ethereum ou Electronic Trading Hours ?) et bruit de test.
  Les deviner remplirait de bruit le champ censé en retirer.

⚠️ `Tag.category` est un `String?`, **pas un enum** : d'autres catégories
émergeront avec les élèves (Brice, 31/08). En ajouter une ne demande ni migration
ni changement de modèle, seulement une ligne dans le script. L'écran ne doit donc
jamais coder la liste en dur — il affiche les catégories qui ont du contenu.

### Lot 1 — La page concept `/concepts/[tagId]`

Quatre zones, dans cet ordre :
- **en-tête** : nom, catégorie, récurrence, nombre de séances, et les chiffres du
  lot 2 ;
- **galerie de captures** : les blocs `image` et `screenshot` liés au concept, en
  grille, cliquables en grand (`ImageLightbox` existe), avec séance et date sous
  chacun. C'est le point 2 de la demande, et la moitié de l'usage du membre le
  plus assidu ;
- **références** : les blocs texte groupés par séance, antichronologiques, chacun
  avec son grade et son trade éventuel. Clic → la note à ce bloc ;
- **concepts voisins**, cliquables (le calcul de co-occurrence existe déjà dans
  `/concepts/page.tsx`).

`ConceptsEmergence` : chaque carte devient un lien vers sa page, et les cartes se
filtrent par catégorie.

### Lot 2 — Les stats d'usage, avec une règle d'honnêteté

Répartition gain / perte / BE, répartition A/B/C, et les causes (technique /
connaissance / émotionnel — 14 des 20 annotations en portent une).

**Deux règles non négociables, imposées par les mesures du §8 :**
1. **dire par quel chemin un chiffre est calculé.** « Résultat de la séance où ce
   concept apparaît » n'est pas « résultat du trade où ce concept était en jeu ».
   Confondre les deux fabrique une certitude fausse ;
2. **jamais de pourcentage sous un seuil.** Afficher « 33 % de réussite » sur trois
   trades installe une croyance sur un concept, ce qui est l'inverse du but de
   l'écran. En dessous du seuil : les nombres bruts, et rien d'autre.

### Lot 3 — Faire monter les liens (le vrai chantier)

**Demande explicite de Brice du 31/08 : que ça s'ajoute NATURELLEMENT.** « Tous
les élèves ne pensent pas à mettre des tags, donc une lecture soft de leurs notes
ou screenshots sera aussi utile pour faire cela sans rajouter une corvée de plus. »
Les chiffres le confirment : trois membres actifs ne taguent jamais.

- **Lecture douce par l'IA** — la voie principale, pas un complément. Elle propose
  des liens concept ↔ note / bloc / capture à partir du texte ET des images, en
  réutilisant l'infrastructure déjà en production (`lib/ia-prix.ts`,
  `ia-niveau.ts`, `ia-budget.ts`, `capture-prompts.ts`, journalisation `AiUsage`).
  ⚠️ Ne pas inventer un second circuit IA : le budget, les paliers et le coût par
  membre sont déjà tenus par celui-là. L'élève **confirme**, il ne saisit pas.
- **Récolte de `Note.concepts[]`** que la capture IA remplit désormais → « cette
  note mentionne *dealing range*, la lier ? ».
- **Tag au moment de la notation** : quand l'élève juge un trade A/B/C, il dit
  quels concepts étaient en jeu. C'est là — et seulement là — que les deux
  populations disjointes du §8 se rejoignent, et donc que les stats de résultat
  deviennent exactes plutôt qu'approchées. Le geste existe déjà (le rituel de
  jugement) : les stats deviennent un produit dérivé, pas une corvée de plus.
- **Modèle** : un lien explicite concept ↔ segment de trade est nécessaire (rien ne
  relie les deux aujourd'hui). Table à part, **sans clé étrangère sur le segment** —
  `Note.trades` est du JSON, même convention qu'`Annotation.tradeRef`.

### Lot 4 — Le graphe global

Inchangé (§3, lot 4). Après, et il réutilisera la grammaire des traits posée en
0.1.7 (`CanvasEdge.tsx`) : appartenance, filiation, association.

## 10. Ordre et dépendances

| Lot | Dépend de | Pourquoi cet ordre |
|---|---|---|
| 0 Classer | rien | sans lui l'écran de sélection est illisible ; c'est court |
| 1 La page | 0 (pour le filtre) | marche avec les données actuelles, sera maigre |
| 2 Les stats | 1 | les chiffres se lisent dans l'en-tête de la page |
| 3 Les liens | 1 (l'UI de confirmation) | c'est lui qui remplit tout le reste |
| 4 Le graphe | 3 | plus de liens = graphe qui vaut quelque chose |

Le lot 3 est celui qui décide si le 0.2 sert à quelque chose. Les lots 1 et 2 sont
la vitrine ; le lot 3 est le stock.

## 11. La fiche du concept — lot 5

**Demande de Brice, 31/08/2026**, en lisant la page du lot 1 : sous « Va avec »,
une petite aide sur le concept lui-même. Précisée le même jour, et la précision
change tout : *« le concept en tant que tel est largement documenté en ligne, donc
trouver des tips n'est pas le plus compliqué. Ce qui compte, c'est que la notation
A/B/C de nos membres permette de piocher dans ce qui marche, comparé à la
documentation externe — et on a plein de PDF, de notes de cours et de formation
sur la machine. Servir de petits tips. Sans mentir, sans nommer, car ce n'est pas
le but : c'est juste une aide sur le concept. »*

**Conséquence de conception, majeure : le contenu du conseil ne vient PAS des
notes des autres membres, il vient du CORPUS.** Toute la difficulté d'anonymat
d'une première version envisagée tombe : la notation collective n'est plus une
source, c'est un **signal de priorité**. Un signal agrégé n'identifie personne.

### 11.1 Le corpus existe déjà, et il est de taille tenable

Inventorié le 31/08 sur `D:\3_Pedagogie` :

- **`FORMATION Aok\`** — 152 fichiers texte (formations 2022, 2023, Deep Knowledge,
  Secrets des MM, Module Psycho, `Maitrise des Marché 2026.pdf`). **La parole de
  Brice.**
- **`Skool-Classroom-Export\`** — `module-chronique-accelerateur.md` (429 Ko,
  66 chroniques) et `module-journaling.md` (116 Ko). Sa voix écrite, déjà réutilisée
  telle quelle dans la communauté.
- **`Autres académies\ICT\`** — une vingtaine de PDF texte dont
  `Glossary of ICT Terms.pdf`, `Inner Circle Trader - SMT Concepts.pdf`,
  `Market Structure and Powerful Setup.pdf` et les notes des 12 mois de mentorship.
  **La source canonique du vocabulaire.**
- **`PDF - workbook\`** — les workbooks AOK.
- ⚠️ Les 27 Go du dossier ICT sont de la **vidéo** : hors périmètre. Les
  transcrire est un chantier à part.

### 11.2 Pas de RAG en direct — une fiche curée par concept

Le premier réflexe (indexer le corpus et interroger à l'affichage) est le mauvais :
il faudrait embarquer 243 PDF côté serveur, monter un index vectoriel, et payer un
appel par vue. Or il n'y a que ~36 concepts réels.

**On génère une FICHE par concept, une fois, hors ligne, et Brice la valide.**

- **Génération sur la machine de Brice**, là où le corpus vit, exactement comme
  l'ontologie du cockpit : un script produit, la base est un **miroir** qu'on
  régénère (`npm run pousser:ontologie` est le précédent à copier — ne jamais
  éditer la table à la main).
- **Table `ConceptFiche`** : nom normalisé de l'étiquette (clé — le vocabulaire est
  partagé, chaque membre a sa propre ligne `Tag`), définition courte, 1 à 3 tips,
  **sources** (module, chronique, page du PDF), statut `propose` / `valide` /
  `rejete`, date. Le statut est repris de `MentoratPlan`, même esprit : l'IA
  propose, Brice tranche.
- **Rien ne s'affiche tant que `valide`.** C'est ce qui répond à « sans mentir » :
  aucune fiche ne part sans avoir été lue par le professeur.

### 11.3 L'ordre des sources — à confirmer par Brice

Proposition, et elle n'est pas neutre pour son positionnement :

1. **La matière AOK d'abord.** Pour ses élèves, dans son produit, sa parole fait
   foi. Si ICT dit X et que Brice enseigne Y, servir X à l'intérieur de son propre
   outil le contredirait devant ses élèves.
2. **La source ICT ensuite**, pour le vocabulaire canonique (le glossaire sert à
   définir, pas à conseiller).
3. **Le web en dernier**, et seulement s'il ne contredit pas les deux premiers.

⚠️ À ne pas confondre avec la règle inverse de `D:\CLAUDE.md` (« pour une
recherche trading de Brice, ne PAS puiser dans le blog AOK en priorité, ça
fausserait sa lecture de son positionnement ») : celle-là vaut quand **Brice**
cherche, celle-ci quand on sert **un élève**. Les deux coexistent sans se
contredire.

**Chaque tip porte sa source.** Une fiche sans provenance est invérifiable, donc
inacceptable — c'est la règle d'extraction de `D:\CLAUDE.md` appliquée ici.

### 11.4 Ce que la notation collective apporte vraiment

Elle ne fournit aucun contenu. Elle sert à deux choses, et les deux sont des
agrégats :

- **la priorité** : quels concepts méritent une fiche en premier (ceux que les
  membres travaillent et notent le plus) ;
- **l'angle** : un concept qui collecte surtout des **C** appelle un tip
  « l'erreur fréquente » ; un concept qui collecte des **A** appelle un tip
  « ce qui le rend propre ». C'est exactement le « piocher dans ce qui marche »
  demandé, sans qu'aucun contenu d'élève ne circule.

Ces deux usages restent des compteurs. Aucun seuil d'anonymat n'est nécessaire
pour eux, et **la doctrine de cloisonnement n'a pas besoin d'être rompue** : la
fiche est la même pour tout le monde, et les compteurs ne nomment personne.

### 11.5 Ce qui reste vrai de l'analyse précédente

- **Ne pas écrire « ce qui marche » à partir des données membres.** 20 annotations
  sur 5 membres, zéro intersection entre blocs tagués et blocs de trade : la
  statistique n'existe pas. La fiche affirme depuis le CORPUS, pas depuis la base.
- **Brice doit pouvoir corriger.** C'est le sens du statut `valide`.
- **Réutiliser l'infrastructure IA en production** (`ia-prix`, `ia-niveau`,
  `ia-budget`, `AiUsage` avec `product: 'etude'`) pour la génération. Pas de
  second circuit.

### 11.6 Ce qui peut s'afficher tout de suite, sans rien construire

Sous « Va avec », deux choses vraies et sans risque :
- **combien d'autres membres travaillent ce concept** (un `count` distinct, aucun
  nom) — « je ne suis pas seul à creuser ça » ;
- la fiche dès qu'elle existe et qu'elle est validée.

### 11.7 Trois compléments de Brice (31/08), et ce qu'ils impliquent

**a) Pondérer les notations selon l'élève.** Idée : les meilleurs élèves, ou ceux
qui ont les meilleurs résultats, ou ceux qui documentent le plus, pèsent davantage
dans la notation d'un concept. Juste sur le fond — un A posé par quelqu'un qui
sait vaut plus qu'un A posé au hasard.

⚠️ Deux réserves à lever avant de coder :
- **C'est prématuré au volume actuel.** 20 annotations sur 5 membres. Pondérer,
  c'est régler finement un signal qui n'existe pas encore ; le résultat serait
  dominé par le bruit, et invérifiable. À rouvrir quand la notation aura du corps.
- **Le poids ne doit PAS être inventé ici.** Un classement par membre existe déjà :
  l'**avatar** du cockpit (`cockpit_membres_avatar`, corrigeable à la main via
  `cockpit_avatar_manuel`). Mais attention — relevé du 30/08 : sur 255 membres, 3
  seulement ont une trace d'étude dans le journal, donc **l'avatar s'appuie
  aujourd'hui surtout sur l'achat et l'ancienneté**. C'est un classement
  COMMERCIAL, pas une mesure de compétence : l'utiliser tel quel comme poids
  pédagogique ferait peser le plus gros acheteur, pas le meilleur trader. Il
  faudra soit une composante « étude » dans l'avatar, soit un poids distinct.
- Troisième critère cité, « le plus de documentation » : celui-là, lui, est déjà
  mesurable aujourd'hui (liens, captures, blocs par membre) et ne dépend de rien.
  C'est le plus honnête des trois pour commencer.

**b) Une fiche générée pour le membre qui ouvre son concept.** Tension réelle avec
le §11.2, et voici la résolution proposée :
- **la fiche reste PARTAGÉE et validée** — c'est elle qui porte les affirmations,
  et c'est ce qui rend la validation par Brice possible. Une génération par membre
  et par vue rendrait la relecture impossible, le coût imprévisible, et « sans
  mentir » invérifiable ;
- **ce qui est personnalisé, c'est le CADRAGE** : quel tip remonte en premier,
  selon les A/B/C que CE membre a posés sur CE concept. Le membre qui collectionne
  les C sur `macro breaker` voit d'abord le tip « l'erreur fréquente » ; celui qui
  aligne les A voit « ce qui le rend propre ». Personnalisation réelle, zéro texte
  neuf à valider, zéro appel au modèle à l'affichage.

**c) Les bases externes, ictindex.io par exemple.** Utile — mais à traiter comme
une **référence de vérification**, pas comme un corpus à recopier.
- ⚠️ **Question de droits, à trancher avant tout ingest.** Servir du contenu tiers
  substantiel à l'intérieur d'un produit payant expose Brice. Le corpus AOK, lui,
  lui appartient : c'est la source sûre pour le texte SERVI.
- Usage propre : s'en servir pour **vérifier** qu'une définition ne dit pas de
  bêtise et que le vocabulaire est le bon, puis écrire la fiche depuis la matière
  maison. La source citée dans la fiche reste alors la matière maison.
- Ça ne change rien à l'ordre du §11.3 : AOK d'abord, ICT canonique ensuite, web
  en dernier et jamais en contradiction avec les deux premiers.
