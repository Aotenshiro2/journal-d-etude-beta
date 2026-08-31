# 🗺️ Roadmap — Journal d'Études

> Réécrit le 17/07/2026 (Brice + Claude). L'ancien roadmap (octobre 2025) décrivait
> un état du code qui n'existe plus — archivé dans l'historique git.

## Le principe de versionnage (décidé le 17/07/2026)

Le numéro de version suit **les espaces du journal** (le dropdown), pas des jalons
abstraits. On travaille un module jusqu'à ce qu'il soit exploitable — « je le montre
à un élève sans m'excuser » — avant de passer au suivant. Chaque patch (0.1.1 →
0.1.2) = une tâche finie et visible à l'écran. Les allers-retours sont permis ;
le numéro affiché correspond au module le plus avancé considéré exploitable.

| Version | Espace | Contenu |
|---|---|---|
| **0.1.x** | Étudier mes notes | ✅ **CLOS le 31/08/2026** — le poste de travail note, jusqu'à la passe esthétique (grammaire des traits, carte de relecture) |
| **0.2.x** | Observer les concepts | ← **EN COURS** depuis le 31/08/2026 — étudier PAR concept : ses notes, ses captures de séance, ses chiffres, et une fiche sourcée. Plan et mesures : `SPEC-second-cerveau.md` §7 à §11, état des lots en tête de `TODO.md` |
| **0.3.x** | Relire | Le deck + la note de relecture auto (le résultat de l'étude de notes — on y jugera l'utilité réelle du mode document) |
| **0.4.x** | Analyser mes données | Les 3 lentilles, affinées avec de vraies données accumulées |
| **0.5.x** | Pattern maps | |
| **0.6.x** | Cartes ABC | |
| **0.7.x** | Rituel de séance | |
| **0.8.x** | Documenter les trades — **phase ALPHA** | Quelques élèves de confiance, feedback réel |
| **0.9.x** | **BÊTA publique** | Onboarding, guide à jour, robustesse multi-utilisateurs |
| **1.0** | **Pricing en place** | Paiement branché — le journal devient un produit |

**Critère de sortie de bêta** : un élève fait le parcours complet — capturer une
séance, la retravailler, la relire, explorer un concept — sans Brice à côté.

## L'état d'esprit de la phase actuelle

La base est solide (« un très beau moteur ») : capture extension → sync →
canvas → concepts → relecture, le tout déployé sur
https://journal-d-etude-beta.vercel.app/. Mais l'exploitabilité n'y est pas :
on est en ~0.1/0.2 dans le nouveau versionnage. La discipline de cette phase :
**pas de nouvelle base avant la bêta** — on branche le moteur aux roues, on
n'ajoute pas de moteur.

Exception assumée : **le pont Edgyx** (logiciel de Geoffrey, hors écosystème).
Événementiel — on avance quand Geoffrey répond. D'abord extension ↔ Edgyx,
éventuellement journal ↔ Edgyx dans un second temps.

⚠️ **Ce que le 0.2 a révélé et qui vaut pour toute la suite (31/08/2026).** Le
moteur tourne, mais **il tourne à vide** : 6 membres taguent, 54 captures sont
reliées sur ~930, 20 notations existent en tout, et 3 membres actifs ne taguent
jamais. Chaque écran qu'on branche est donc honnête et maigre. La conséquence
pour le versionnage : la priorité n'est plus d'ajouter des vues, c'est de faire
monter la MATIÈRE — que les liens se posent sans corvée (lot 3 du
`SPEC-second-cerveau.md`). Un écran de plus sur un stock vide ne rapproche pas
de la bêta.

## Vision long terme (inchangée, condensée)

AOKnowledge = écosystème d'apps éducatives (journal, extension Carnet du Trader,
futurs modules) avec auth centralisée (Supabase) et navigation commune. Le
journal est la première brique ; l'intégration écosystème vient après la 1.0.

## Documents liés

- `TODO.md` — le chantier en cours (0.2.x) et les tâches
- `SPEC-second-cerveau.md` — la page concept et le second cerveau. §1-6 = la spec
  d'origine (17/07, écrite sur hypothèses) ; **§7-11 = le plan du 0.2, écrit après
  avoir compté la base le 31/08**. En cas de contradiction entre les deux, §7-11
  fait foi : lui seul repose sur des mesures.
- `apps/carnet-du-trader-extension/TODO.md` — côté extension (Edgyx, mode mentorat, doctrine)

---
**Dernière mise à jour :** 31 août 2026
