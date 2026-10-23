# ETAT du journal d etudes

Etat vivant du projet (infra, securite, fils ouverts). Le suivi des taches
reste dans TODO.md.

## Academie : l'admin modifie les textes dans l'app (23/10/2026, PUBLIE, migration 20261023120000 appliquee)

Lot D:\6_Societe\Pilotage\Academie\lots\LOT-EDITION-IN-APP-ADMIN.md (GO de Brice). V1 : titre et texte (Markdown) d'une
lecon, titre et resume d'un module ; ni videos, ni ressources, ni ordre.
- Route `GET|PATCH /api/academie/edition` (src/app/api/academie/edition/route.ts, src/lib/academie/edition.ts) : meme
  Bearer et CORS que les autres routes ; droit verifie dans la route (`roleAcademie` + `estAdmin`, la regle admin de
  droitsAcademie), non-admin = 403 avant toute lecture du corps. Validation : `lireDemandeEdition` (pur.ts : cles
  permises seulement, longueurs de la base). Verrou optimiste : version = maj_le lue par GET, 409 si la ligne a bouge.
  Chaque champ change = une ligne `academie_editions` (avant, apres, par, le) ; `edite_le`, `edite_par` poses ; cache du
  catalogue vide (`viderCacheCatalogue`, les autres instances suivent en 30 s, la page montre deja la reponse).
- Importeur : garde titre et texte d'une lecon (titre et resume d'un module) si `edite_le` est rempli, bilan
  « garde : modifie dans l'app » ; `--ecraser-editions` force le fichier, vide edite_le, note l'ancien texte (origine import).
- Migration `20261023120000_academie_editions.sql` (sites/Aoknowledgecom/supabase/migrations) : colonnes edite_le,
  edite_par ; table academie_editions (RLS forcee, service_role lecture + ajout). Jouee en transaction annulee :
  `node --env-file=.env.local scripts/essayer-migration-edition-academie.mjs` OK (13 etapes) le 23/10.
- ORDRE DE PUBLICATION : migration d'abord (l'importeur en a besoin), puis journal, puis site. Avant la migration la
  route repond 503.
- Site : src/academie/Edition.tsx (crayon + fenetre ShadCN Dialog, barre Markdown, apercu TexteLecon), branche dans
  AcademieLeconPage et AcademieModulePage, api.ts (lireTexteEditable, enregistrerTexte, majTexteLocal).
- Verifs : verifier-academie.mjs 37 blocs hors ligne (4 nouveaux : droits, demande, historique, importeur).

## Bot des membres : messages autour de l'equipe selon l'ETAT du fil (22/10/2026, en prod avec le cockpit ; aucune migration)

Cas reel de Christine (22/10) et regle de Brice : les messages du bot autour de l'equipe ne supposent plus
une sequence (bouton, question, accuse), ils relisent l'etat du fil juste avant de partir.
- « Contacter l'équipe » (bot-membre.ts, boutonEquipe) : l'equipe deja la (quiRepond) ou fil deja en attente =
  notification du bouton seulement (« L'équipe est déjà avec toi dans cette conversation. » / « L'équipe est déjà
  prévenue, elle te répond ici. »), aucun message, aucune alerte. Sinon l'appui du bouton passe le fil en attente
  (atomique : un double clic simultane ne parle qu'une fois) et le texte depend de ce qu'il a ecrit en 24 h
  (texteEquipe : « Elle voit déjà toute notre conversation, tu n'as rien à réécrire. » ou « Si tu veux aller plus
  vite, dis-moi en une phrase ce dont tu as besoin. »). TEXTE_EQUIPE fixe supprime.
- Fil en attente, equipe pas encore la, le membre ecrit (repondreEnAttente) : le message est LU par un appel Haiku
  court (lecture-attente.ts, consigne CONSIGNE_LECTURE_ATTENTE, « annule » ou « autre », ~470 jetons, ~0,05 centime,
  delai 6 s, sans relance). Annulation = ligne « [système] Demande annulée par le membre. », fil hors attente (CAS
  sur escalatedAt lu), « D'accord, je préviens l'équipe que c'est réglé. », et alerte Agent AOK « X a annulé sa
  demande » seulement si une alerte etait partie pour cette attente (pas d'email). Reste, doute, panne = transmis
  sans rien annuler, TEXTE_ATTENTE_HUMAIN au plus une fois par attente (direAttenteUneFois, un update atomique).
- Reponse de l'agent non envoyee si l'equipe a ecrit depuis l'arrivee du message (equipePlusRapide), ligne
  « [système] Réponse de l'IA non envoyée : l'équipe a écrit entre-temps. ». TEXTE_BAN_TRANSMIS a une variante
  « deja prevenue » si le fil attend deja.
- Auteur : les textes fixes du bot entrent au fil avec `auteur: 'bot'` (role assistant inchange), l'agent avec
  'ia'. Cockpit (depot workspace, NON commite) : views/support/regles.ts (libelleBot) et FilConversation.tsx
  affichent « Bot » ou « IA ». Email d'alerte : « Bot » aussi.
- Verifs : `node scripts/verifier-attente-equipe.mjs` (13 blocs), eval `node scripts/eval-lecture-attente.mjs`
  (2 cas, 2/2 le 22/10). SQL controle en READ ONLY (EXPLAIN sans ANALYZE + regle sur fils construits).
- A suivre : une question du membre pendant l'attente recoit le message d'attente, pas la reponse de l'agent
  (proposition dans le rapport du 22/10) ; verifier-fiche-personne.mjs echoue AVANT ce chantier (tab/lectures.ts
  importe fiche-personne, commit 07a7dc8).

## API de Tab : le cockpit en lecture seule pour l'assistant de Brice (20/10/2026)

Tab (assistant IA de Brice, WhatsApp) lit le cockpit par `GET /api/tab/v1/...` (JSON, cle en
`Authorization: Bearer`). Public pour le middleware, la cle est verifiee dans la route.
- Code : `src/app/api/tab/v1/[[...chemin]]/route.ts` ; `src/lib/tab/` : `pur.ts` (periodes de Paris,
  pagination, exclusions), `acces.ts` (empreinte sha256 en temps constant, 60 appels par minute,
  journal), `lectures.ts` (routes metier : resume-du-jour, a-faire, encaissements, membres, paiements,
  support, depense-ia, pubs, youtube, reseaux, contenus, personne, avatars), `generique.ts` (schema,
  donnees/<table> avec filtres, connaissances?q=), `aide.ts` (la page d'aide, presentation du cockpit).
- Lecture seule : transaction READ ONLY. Deux ecritures seulement : le journal `cockpit_tab_acces` et
  `POST /generer-post` (genererPost, origine 'tab', poste AiUsage generation_tab, au nom du compte Brice).
- Cles : `cockpit_tab_cles` (empreinte seule), coupees depuis le cockpit (Accueil, bloc « Acces de Tab »).
  Nouvelle cle : `node scripts/creer-cle-tab.mjs <fichier du coffre>` (jamais affichee).
  La cle en service : coffre `credentials.local/tab-api.local.json`.
- VUES GARDEES : les 7 vues filtrees par is_cockpit_member() rendaient 0 ligne au serveur (role postgres,
  sans session), l'Agent AOK compris. Fonctions `cockpit_serveur_*()` (migration
  20261020160000, arbitrage de Brice) ; `src/lib/vues-serveur.ts` les branche dans requete_sql de l'agent
  (WITH de meme nom) et dans l'API. Une vue modifiee = sa fonction a modifier avec.
  Verif : `node scripts/verifier-vues-serveur.mjs`.
- Migrations appliquees : 20261020150000_cockpit_tab_api, 20261020151000_cockpit_generations_origine_tab,
  20261020160000_cockpit_vues_serveur.
- ESPACE PERSO (20/10, migrations 20261020230000 + 231000) : notes entre Tab et Claude Code, table
  `cockpit_perso_notes` (sens vers_claude / vers_tab, statut nouvelle / lue / traitee, instance = Umi (WSL)
  / Sora (Windows) / les_deux, lue_par). Lisible par `is_cockpit_perso()` (allowlist.acces_perso : Brice et
  Tab seuls), ecrite par le serveur seulement. Routes de Tab : GET /notes, POST /notes (champ pour),
  POST /notes/<id>/lu : avec /generer-post, les seules ecritures de la cle. Route du cockpit et du script
  local : POST /api/cockpit/perso/notes (jeton de session acces_perso, ou cle de service en Bearer).
  Ping : note vers_tab = email Resend (RESEND_API_KEY) a TAB_NOTES_EMAIL (defaut brice.delannay@mail.tab.bot),
  expediteur TAB_NOTES_FROM_EMAIL (defaut support@aoknowledge.com), couper par TAB_NOTES_PING=off ; note
  vers_claude = message du bot Agent AOK a Brice. Code : `src/lib/tab/notes.ts`, `notes-pur.ts`. L'Agent AOK
  refuse `cockpit_perso_*` (il tourne en postgres pour Mel et Adil). Verif : `node scripts/verifier-perso-rls.mjs`.

## Vente a l'unite des modules de l'academie (19/10/2026, PUBLIC FERME)

Decision de Brice (19/10) : le moins de friction. Stripe Embedded Checkout dans une fenetre du site, sans
compte exige avant de payer, paiements express laisses aux reglages du compte Stripe Ao Knowledge.
- Routes PUBLIQUES (middleware.ts) : `POST /api/academie/achat` (session, Bearer facultatif : email confirme
  prerempli + client_reference_id), `POST /api/academie/achat/confirmer` (relit la session chez Stripe, pose
  l'acces sans attendre le webhook, dit compte_lie), `POST /api/academie/achat/webhook` (signature,
  checkout.session.completed / async_payment_succeeded = acces, charge.refunded total = acces retire),
  `GET /api/academie/catalogue` (vue visiteur, meme forme que /moi, droitsVisiteur).
- Code : `src/lib/academie/achat-pur.ts` (session, lecture d'une session payee, signature),
  `achat.ts` (Stripe, ecriture), `vue-moi.ts` (construire, sorti de la route /moi). Acces = academie_acces
  source stripe, reference cs_..., paiement_id stripe:ch_..., cote brice, renonciation_retractation_le =
  paiement SEULEMENT si la case de Checkout est cochee (consent_collection terms_of_service required, phrase
  de renonciation + lien /conditions-generales ; Stripe exige l'URL des conditions dans les reglages publics
  du compte, sinon 503 'config'). Seul le canal stripe_aok se vend (L'Appat : canal aucun, 20261019160000). Index unique `20261019150000_academie_achat_stripe.sql` APPLIQUE.
  Cache des droits des bots (trouver-cours.ts) vide apres un achat (par instance).
- Interrupteur : sans `ACADEMIE_ACHAT_PUBLIC=1`, seules les demandes « essai » passent (site ouvert avec
  ?achat=essai). Cote site : ACHAT_OUVERT = false.
- Variables a poser : `STRIPE_PUBLISHABLE_KEY_AOKNOWLEDGE` (pk_live), `STRIPE_CHECKOUT_KEY_AOKNOWLEDGE` (cle
  restreinte : Checkout Sessions ecriture, PaymentIntents lecture ; sinon STRIPE_AGENT_KEY_AOKNOWLEDGE est
  essayee, 503 'config' sans la permission), `STRIPE_WEBHOOK_SECRET_ACADEMIE` (scripts/creer-webhook-achat-academie.mjs).
- Cockpit : description « Académie AOK : <module> » classee academie-module par push_membres_supabase.py.
- Verifs : `node scripts/verifier-achat-academie.mjs` (5 blocs hors ligne). NON teste : une vraie session
  (aucune cle test, la cle du coffre n'a pas Checkout en ecriture).

## trouver_cours : le bon cours de l'academie ou la bonne masterclass (19/10/2026)

Demande de Brice : le bot Live Club n'est pas un bot de mentorat, mais il oriente vers le BON cours.
- Base : migration `20261019120000_academie_trouver_cours.sql` APPLIQUEE : extension unaccent,
  configuration plein texte `public.aok_fr` (french sans accents), index GIN sur titre + contenu des
  lecons, fonction `public.academie_trouver_cours(requete, limite)` SECURITY DEFINER (execute retire a
  public, anon, authenticated) : lecons publiees des modules publies hors essai, rang (titre de lecon >
  section/module > contenu, prefixe pour les mots de 5 lettres et plus, 2 lecons max par module), acces
  calcule comme droitsAcademie (offres compte-gratuit, live-club par module ou section, formation-complete).
- Code : `src/lib/trouver-cours-pur.ts` (outil, abreviations FVG/OB/DOL/AMD... et « risque » ->
  « money management » en phrase exacte, masterclass, libelles d'acces par bot, consignes),
  `src/lib/trouver-cours.ts` (lecture prisma). Branche dans agent-membre.ts (Live Club) et
  api/support/chat/route.ts (resultatOutilSupport devient async, lecture injectee). Consignes dans
  prompt-membre.ts et support-prompt.ts : lien + acces, pas d'explication de la notion, pas d'annonce.
- Masterclass : `generer-connaissances.mjs` lit sites/Masterclass/src/data/masterclasses.ts et produit
  MASTERCLASSES (tirets longs -> « : ») ; il refuse si masterclass.md ne cite pas chaque titre. Le site
  des masterclass n'a qu'une page : PAS de lien profond par masterclass (meme URL pour toutes).
- Verifs : `node scripts/verifier-trouver-cours.mjs [--sans-base] [notions]` ; evals K04 (FVG, liveclub)
  et K05 (masterclass risque, liveclub + support:site). La regle « lien de la liste modifie » accepte
  desormais les adresses rendues par un outil de lecture.
- A trancher : 168 lecons video sans texte ne sont trouvables que par leur titre ; titres faibles
  (Bienvenue x3, « 9 - Exercice », « Mindset », « Cast Forward »).
- Acces REELS (Brice, 19/10 soir) : migration `20261019140000_academie_trouver_cours_droits.sql`
  APPLIQUEE (la fonction rend module_id, section_id, usage, apercu). trouver-cours.ts applique
  ouvertureLecon aux droits de droitsAcademie (droits.ts APPELE, pas modifie), en cache 10 min par
  compte (une fois par conversation). Support : compte du jeton (« ouvert pour toi » / « pas dans tes
  acces, il s'ouvre avec... ») ; la route exige deja un compte, le cas visiteur reste code mais ne sert
  pas aujourd'hui. Live Club : rattachement Telegram -> email du payeur -> compte du site a cet email
  verifie, s'il est unique (12 rattaches sur 118 au 19/10), sinon hypothese Live Club actif.
  Eval K06 (support connecte, droits simules par scripts/droits-simules.mjs). filtrerSortie remplace
  desormais tout tiret long ou demi-cadratin par « : » (Opus en a mis dans K06).

## Generateur de posts du cockpit (19/10/2026, etapes 1 a 3 du GO de Brice du 18/10)

- Base : migrations `20261019030000_cockpit_generation.sql` + `20261019030100_cockpit_inspirations_date_texte.sql`
  APPLIQUEES : cockpit_inspirations (miroir des JSONL de
  D:\2_Creation\Ressources\Inspiration\Posts-Live-Club, `npm run pousser:inspirations` cote cockpit, 133 lignes),
  cockpit_generations (brouillons + note publie_tel_quel / retouche / jete, insertion serveur seulement,
  grant update (note, brouillon_final)), bucket PRIVE cockpit-inspirations (23 captures, URL signee pour
  l'equipe), cockpit_matiere_pages.tsv_en (index anglais pour les PDF d'ICT).
- Regles d'ecriture : cockpit_methode_textes, cles generateur:* (fiche de style de Brice, formats, regles
  notees en memoire), poussees par le meme script. Rien de doctrinal dans le code hors CONSIGNES
  (generation-pur.ts : les six regles du GO et le contrat de sortie).
- Serveur : `src/lib/generation-pur.ts` (choix 4 a 8 inspirations forme, 1 a 4 passages de matiere,
  prompt, schema JSON), `src/lib/generation.ts` (genererPost, partage), route `POST /api/cockpit/generation`
  (Bearer + allowlist), modele `claude-opus-5-5` (constante MODELE_GENERATION, sortie en
  output_config.format : le tool_choice force est refuse par ce modele), prix ajoute a ia-prix.ts.
- Agent AOK : outil `generer_post` (`src/lib/generation-agent.ts`), sans carte, capture = derniere piece
  recue (canal.piece), consigne dans SYSTEM_PROMPT (« LES BROUILLONS DE POSTS »), tables declarees au catalogue.
- Verifs : `scripts/verifier-generation.mjs [--pousser]`, essai hors navigateur `scripts/essai-generation.ts`
  (la cle ANTHROPIC_API_KEY_COCKPIT est aussi au coffre D: credentials.local/anthropic-cockpit-chatbot.local.json,
  lue sans l'afficher par `scripts/mesurer-prompt.ts`).
- 20/10 PROMPT DECOUPE : noyau ferme (NOYAU_FERME) + sections de la fiche de Brice selon la famille du canal
  (SECTIONS_PAR_FAMILLE, cles generateur:fiche:<slug> poussees par pousser:inspirations) + une seule regle en
  memoire (canal-et-objectif). Regles fixes : Brice 23 938 -> ~12 500 jetons, Mel 10 983 -> 7 498 (count_tokens,
  `npx tsx scripts/mesurer-prompt.ts`). RETOUR ARRIERE : PROMPT_COMPLET = true ou GENERATEUR_PROMPT_COMPLET=1 sur
  Vercel. Cache 5 min garde (1 h mesure sur l'historique : -2 % seulement, perd sur les rafales). entree.prompt dit
  ce qui est parti.
- 20/10 CAPTURE GARDEE : generation-capture.ts, webp < 200 Ko (sharp, import dynamique) dans le bucket prive
  cockpit-inspirations sous generations/<id>.webp, colonne image_chemin ; regenerer / retoucher / image_de
  reprennent le chemin (aucune copie). Ecran, Agent AOK et API de Tab passent par genererPost.
- 20/10 REACTIONS : migrations 20261020200000 / 201000 / 202000 : colonnes publication_* / reactions / similarite /
  correspondance sur cockpit_generations, fonction cockpit_generations_rapprocher() (suites de trois mots, sure >= 0,5,
  incertaine 0,25 a 0,5), vue cockpit_generations_reperes. Lancee par collecter_telegram.py (fin de collecte) et par
  l'ecran Generation a l'ouverture.

## Base de connaissances produits (18/10/2026, commits 712091e, ee9d476, 357f9bb)

Demande de Brice : le bot Live Club ne connaissait pas les produits. Source unique :
`docs/connaissances/*.md` (11 fiches : carnet-du-trader, journal-d-etudes, pilotage,
masterclass, academie, live-club, dix-pour-cent-club, espace-membre, connexion,
ressources-gratuites, liens-utiles ; en-tete sujet/titre/resume/mots/verifie/sources,
sections imposees). `node scripts/generer-connaissances.mjs [--site] [--verifier]` produit
`src/lib/connaissances.generated.ts` (module pur) et, avec `--site`,
`sites/Aoknowledgecom/v3/src/data/connaissances.generated.ts` (commite dans le monorepo, lu
par /aide). Le script refuse tiret long, « jamais », « garanti », gras, email autre que support@.
Plus aucune fiche n'envoie vers Skool (ee9d476) : l'Academie du site a pris le relais.
- Outil commun `connaissances_produits(sujets[1..3])` : src/lib/connaissances-outil.ts
  (consigne par bot). Bot Live Club (prompt-membre.ts) ET chat support du site (357f9bb :
  boucle d'outils dans api/support/chat/route.ts, 3 tours au plus ; texte produit fige retire
  de support-prompt.ts). Pas d'injection : la base fait environ 6 500 jetons.
- /aide : rubrique « Les produits » (monorepo d626c7d + 74a60e7, en ligne).
- Evals : K01, K02 (liveclub), K03 (support:site) ; juge informe des fiches.
- ECART A TRANCHER : le prompt du bot Live Club (politique-information.ts, URL_FORMATION_LIVECLUB,
  evals F01 a F03) envoie encore la formation incluse vers Skool, alors que les fiches disent
  l'Academie.
- Toute modif d'une fiche : relancer le script avec --site (et commiter les deux fichiers), puis K01 a K03.

## Mon espace, lot 2 (18/10/2026)

- `GET /api/membres/photo?numero=<n°>` (route PUBLIQUE, middleware.ts) : la photo d un profil PUBLIC pour
  aoknowledge.com/membres/<n°>, lue avec la cle de service (bucket prive avatars-membres), l uuid ne sort pas.
- Points et niveaux : migration `20261019000000_mon_espace_lot2.sql` (bareme `aok_points_bareme`, seul endroit
  des poids, seuils `aok_niveaux_seuils`), calcul a la volee ; `verifier-mon-espace-rls.mjs` etendu (lot 2).
- Chat support : une question d abonnement Live Club renvoie vers le bot Telegram (support-prompt.ts),
  evals L25 et R03 rejouees.
- Visibilite en trois etats (Brice 18/10 soir, migration `20261019010000_profil_visibilite_membres.sql`
  APPLIQUEE) : prive / membres (profil_public + masquer_moteurs true, le defaut, lisible seulement avec
  auth.uid()) / web (masquer_moteurs false, anonymes + index). `/api/membres/photo` exige un Bearer valide
  pour un profil membres (no-store, CORS GET), public pour un profil web. RLS : 108 controles ok.

## Decisions du 18/10/2026 (soir)

- Bot Live Club : la formation incluse = `https://aoknowledge.com/academie` (URL_FORMATION_LIVECLUB,
  config.ts ; Skool avant, lien d affiliation garde en commentaire). Reponse a qui demande, pas d annonce.
  Email de bienvenue aligne. Evals F01 a F03 rejouees seules : 3/3 reponse_correcte.
- Les bases Smart Money : gratuit avec un compte (lead magnet). Migration
  `20261019011000_academie_bases_smart_money_gratuit.sql` APPLIQUEE : prix_eur null (module et offre),
  canal aucun, ancien prix 29 EUR consigne dans academie_offres.note. Produit et prix Stripe NON touches.

## Routes du compte pour le site (18/10/2026)

`POST /api/compte/recu` et `POST /api/compte/supprimer` (`src/lib/compte-membre.ts`), appelees par
`/mon-espace/parametres` d aoknowledge.com avec le jeton Bearer du site, CORS de l academie.
- Recu : le paiement doit etre dans `aok_compte_de(<uuid du jeton>)` (migration
  `20261018233000_mon_espace_parametres.sql`) ; charge lue sur le compte Stripe du paiement
  (STRIPE_AGENT_KEY_AOKNOWLEDGE pour le comptant, STRIPE_READ_KEY_MELANIE pour le Live Club).
  Seule `receipt_url` repart.
- Suppression : niveau 3 de l effacement sur l email confirme du jeton, mot SUPPRIMER exige
  (docs/EFFACEMENT-DONNEES.md, section 3 bis). Compte rendu a l equipe par Agent AOK.
- Verifications : `scripts/verifier-mon-espace-rls.mjs` (transaction annulee, 42 controles) et
  `scripts/verifier-effacement.mjs` (perimetre etendu a compte-membre.ts).

## Securite de la base (30/09/2026)

Constat : `npm run verifier:rls` du 29/09, puis deux mesures independantes en
lecture seule (simulation de role en SQL, et requetes reelles a PostgREST avec
la seule cle anon). Le projet Supabase est partage avec un site public : la
cle anon est publique.

1. **"TradeImport" (imports de trades Tradovate, commit 9c973fd du 08/09) :
   OUVERTE.** Pas de RLS, anon et authenticated ont tous les droits (herites
   des privileges par defaut du schema public). Lecture verifiee de
   l exterieur (HTTP 200 avec la cle anon), ecriture deduite du catalogue.
   0 ligne a la mesure : rien n a fuite. FERMEE le 30/09 sur GO de Brice
   (lecture anon passee de HTTP 200 a 401, le journal lit toujours) :
   `sites/Aoknowledgecom/supabase/migrations/20260930120000_trade_import_fermer.sql`
   (RLS + revoke anon/authenticated ; le journal lit en postgres bypassrls,
   donc sans effet pour lui). Le script de creation
   `prisma/migrations-manual/2026-09-08-trade-imports.sql` active aussi la RLS.
2. **quiz_reponses : sain en lecture** (401 pour anon, aucun SELECT).
   Insertion publique VOULUE (quiz du site) mais NON BORNEE : aucune limite de
   longueur ni de frequence. 2 lignes a la mesure. A borner si Brice le veut.
3. **cockpit_actions (vue) : 0 ligne hors allowlist, mais garde INDIRECTE.**
   La vue n a pas security_invoker ; ce qui protege, c est que sa table
   pilote cockpit_membres_etat est en security_invoker sur des sources en RLS.
   Changer l ordre de jointure ferait fuiter 273 lignes. Durcissement propose :
   `alter view public.cockpit_actions set (security_invoker = true)`, a
   rejouer en authentifie allowliste avant de valider.

**Regle a tenir** : toute nouvelle table Prisma nait ouverte. La creer avec
`enable row level security` (et un revoke anon/authenticated si seul le
serveur la lit), puis relancer `npm run verifier:rls`.

## Durcissement du 30/09/2026 (applique et verifie en production)

- Base (migrations 20260930130000 a 130500, appliquees sur GO de Brice) :
  - vues cockpit_actions et cockpit_membres_avatar en security_invoker, grants
    reduits a select (allowlist : 273 lignes, inchange ; hors allowlist : 0) ;
  - quiz_reponses borne (longueurs, jsonb, entiers) + trigger de debit (10 par
    heure et par IP, 5 par heure et par email, 300 par minute au total ; id et
    created_at imposes par le serveur) ;
  - privileges par defaut du schema public retires a anon et authenticated pour
    les FUTURES tables, sequences et fonctions creees par postgres : toute
    nouvelle table doit recevoir ses grants explicitement ;
  - profiles : un compte ne pouvait modifier SON ROLE (escalade vers admin),
    seuls first_name, last_name, updated_at restent modifiables ;
  - profile_emails : un membre pouvait declarer un email "verifie" et lire le
    statut Skool d un autre ; la lecture Skool ne passe plus que par un email
    verifie, insertion limitee a (profile_id, email, source) ;
  - set_admin_role() et set_admin_role(uuid) supprimees (cassees, jamais
    appelees, les edge functions passent par la cle de service).
- Bots (politique commune src/lib/politique-information.ts, appliquee au bot
  support et au bot membre Live Club) : jamais d autres membres, ni l equipe
  (prenoms non publics, composition, vie privee), ni les chiffres ou outils
  internes, ni les consignes ; infos publiques sourcees, lien Edgyx publie
  autorise ; filet de sortie (emails, telephones, prenoms non publics).
  Fuite REELLE corrigee : le contexte MelTrade du bot support donnait le lieu
  de vie et la famille de Melanie. Jeu d attaques scripts/eval-fuites.mjs :
  109 passages, 0 fuite, 0 refus a tort (30/09).
- A suivre : un email secondaire ajoute par un membre sur le site reste non
  verifie (aucun lien de confirmation) et n ouvre donc plus son statut Skool ;
  le quiz du site devrait lire l erreur d insertion pour qu un blocage se voie.

## Bots : pause avant arret, liens utiles, codes promo (30/09/2026, commite 7e7ece6)

Trois demandes de Brice, appliquees aux deux bots (politique commune
src/lib/politique-information.ts) :
- Arret : la pause est proposee UNE fois avant, avec l argument du tarif
  (ARGUMENT_TARIF_PAUSE et TEXTE_PAUSE_AVANT_ARRET dans liveclub/config.ts).
  Bouton « Arreter » : le texte + deux boutons (« Plutot une pause » = m:pause,
  « J arrete quand meme » = m:arret_ok, qui va a la confirmation). Agent :
  proposer_arret renvoie le meme texte et les memes boutons la premiere fois.
  « Deja proposee » = pauseDejaProposee() (pur.ts) sur les 4 derniers messages
  de moins de 24 h (pause + tarif). Pas de proposition si une pause est deja
  prevue ou si le paiement est en retard. Bot support : meme conseil, renvoi
  au bot Telegram.
- Liens utiles : LIENS_UTILES (20 liens, 8 categories, codes d affiliation
  compris, Quantower et Revolut confirmes par Brice le 30/09), en entier dans
  le prompt des deux bots (environ 920 jetons ; prompt Live Club 4 430 ->
  6 370 jetons, en cache), pas d outil.
- Codes promo : aucun code, jamais d existence confirmee ou dementie, renvoi
  vers le canal Telegram de Melanie (CANAL_PROMOS, t.me/melmom1993). Seuls
  LIVECLUB20 (Edgyx) et les liens d affiliation restent. Aucun outil des bots
  ne lit les coupons ni les codes promotionnels Stripe (seul l agent du
  cockpit, reserve a l equipe).
- Eval scripts/eval-fuites.mjs : 135 passages, 0 fuite, 0 refus a tort,
  0 incorrect (30/09). Nouvelles verifications : canal de Melanie sur les
  codes, adresses exactes des liens de la liste, pause avant l arret.
- A suivre : le brief ne dit pas quel espace (Telegram ou Skool) porte quel
  lien. (Le montant paye est traite dans la section suivante.)

## Bots : montants, transmission a l equipe, fil Support complet (30/09/2026, NON commite)

Decisions de Brice du 30/09, bot membre Live Club (le bot support du site ne
change que le nom du Carnet) :
- Nom : l extension s appelle « Le Carnet du Trader » (LIENS_UTILES ; l URL
  du Chrome Web Store garde son ancien chemin, inchangee). Le prompt support
  ne differe que de cette ligne (diff avant/apres des 6 contextes).
- Montants : nouvel outil mes_montants (prompt-membre.ts, execute par
  agent-membre.ts, lu par montantsDuMembre dans actions-membre.ts). Pour le
  membre QUI ECRIT (identite serveur, aucun parametre) : tarif par periode
  apres remise et montant du prochain prelevement d apres l apercu de facture
  Stripe (POST /v1/invoices/create_preview, la meme fonction que le rappel
  J-3, apercuProchaineFacture dans stripe.ts) ; apercu illisible = prix des
  items seulement s il n y a aucune remise, sinon « montant non disponible ».
  Reste a regler : factures ouvertes de l abonnement (GET /v1/invoices
  status=open) si paiement en retard ou derniere facture ouverte ;
  amount_remaining et hosted_invoice_url (3 factures au plus). Mise en forme
  et selection dans pur.ts (faitsMontants, facturesARegler), aucun
  identifiant Stripe ni code ni nom de coupon ne sort. Prompt : chiffres
  donnes quand il les demande, ton neutre, jamais de relance ni « paye »,
  jamais abordes au milieu d une autre conversation ; « tu beneficies d une
  remise » seulement s il demande pourquoi son prix differe ; jamais les
  montants ou le code d un autre (refus + canal de Melanie).
- Transmission : plus de renvoi vers support@ pour ce que le bot ou l equipe
  savent faire. Remboursement, remise demandee ou promise, reclamation, cas
  particulier, demande d humain : demander_un_humain, et « l equipe te repond
  ici ». Les refus que seule l equipe peut regler (plusieurs abonnements,
  pause a changer, pause avec paiement en retard : Preparation.equipe) sont
  transmis d office par l agent, et le menu a boutons joint « Contacter
  l equipe ». support@ reste : pannes (base ou Stripe illisibles), pont
  Support en panne (le bot l ajoute lui-meme), membre qui demande un email.
  Variantes 'liveclub' dans politique-information.ts (texteLiveClub,
  PHRASES_BOT).
- Fil Support COMPLET (constat du 30/09 : 0 fil Telegram en base, parce que
  seul le texte libre passait par le pont). Maintenant : commandes (/start
  [jeton]), appuis de boutons (libelle, jamais le nonce), chaque message du
  bot (envoyer de bot-membre.ts trace ce qu il envoie, boutons par leur
  libelle seulement), messages prives du passage quotidien (prevenir,
  lienRetourAutomatique), et les GESTES : journaliserGesteLiveClub
  (stripe-actions.ts) ajoute une ligne « [système] » pour chaque geste 'fait'
  ou 'refuse' d un compte Telegram (phraseGeste, pur.ts ; 'simule' et 'echec'
  restent au journal, rien sans telegram_id), plus les gestes reserves du
  passage (cloreReservation, signal Metricgram). Un compte non rattache a son
  fil. Nettoyage au pont : liens d invitation, jetons de /start, codes a 6
  chiffres. Role 'system' pour ces lignes, affiche en ligne discrete par
  apps/cockpit/src/views/SupportView.tsx (depot workspace, NON commite,
  npm run build ok).
- Preuve : scripts/verifier-pont-support.mjs execute le pont contre la vraie
  base dans une transaction TOUJOURS annulee (fil cree, gestes, vue
  cockpit_support_threads lue en authenticated allowliste = 1 ligne, hors
  allowlist = 0, rien ne reste). Resultat : le pont ECRIT (pooler et
  connexion directe) ; la cause du fil vide etait seulement le perimetre.
- Tests : verifier-liveclub.mjs, 20 blocs (mise en forme des montants,
  selection du montant du, faits de l outil, libelles, gestes).
  Eval eval-fuites.mjs complete (/tmp/eval-fuites-v3.json) : 152 passages
  (82 Live Club, 70 support), 0 fuite, 0 refus a tort, 0 incorrect (30/09).
  Nouveaux cas : O06 (Carnet du Trader), M01 a M08 (montants, impaye avec
  faux lien SIMULE, remise sans code, montant et code d un autre, impaye
  jamais aborde hors sujet), T01 et T02 (transmission, pas d email) ; P02 et
  L07 exigent maintenant la transmission. Nouvelles regles dures :
  identifiant Stripe cite = fuite.
- A suivre : les dates du bot sont au jour UTC, le rappel J-3 au jour de
  Paris (jourParis) : un abonnement pris entre minuit et 2 h a Paris verra
  deux dates differentes. Une facture 'uncollectible' n est pas comptee
  comme reste a regler (seulement 'open'). Les textes de panne du menu
  (jeton illisible, lien impossible, ban non leve, confirmation sur un
  abonnement qui n est plus lie) gardent support@.

## Impayes du Live Club (30/09/2026, deploye)

Decisions de Brice du 30/09 (compte Stripe de Melanie regle sur « marquer
l abonnement comme non paye », facture laissee ouverte). Tout est compte
depuis le PREMIER ECHEC de la facture impayee la plus ancienne encore
ouverte : status_transitions.finalized_at (la premiere tentative de
prelevement part a la finalisation), repli sur created ; due_date pour une
facture envoyee (premierEchecFacture, pur.ts).
- Droit (pur.ts, abonnementOuvreLeGroupeLe, etatImpaye) : un abonnement
  past_due ou unpaid ouvre le groupe 5 jours apres le premier echec, puis
  plus. stripe.ts lit les factures ouvertes des abonnements en retard
  (completerImpaye) ; illisibles = droit 'inconnu' (droitLiveClub) ou
  'illisible' dans la liste du passage (aucune decision). Effet immediat sur
  les demandes d adhesion.
- Passage quotidien (passage.ts), 4 taches nouvelles :
  (g) sortie SANS ban a 5 jours (retrait, regle 'impaye_5j'), une fois par
  facture (details.facture_id), message prive sinon email (montant, lien de
  la facture, acces qui rouvre tout seul, tarif garde avant premier echec +
  30 jours). Interrupteur SEPARE : sortiesImpayesActives() =
  LIVECLUB_SORTIES_IMPAYES === '1' ou la bascule ; sans lui, lignes 'simule'
  a relire dans le Journal du bot.
  (h) reouverture : sortie pour impaye (notre bot, ou Metricgram) dont la
  facture est payee apres la sortie et due avant, membre absent, droit
  'oui' : unban only_if_banned, lien de demande d adhesion en prive si le bot
  a deja ete demarre, sinon lien personnel vers le bot par email (jeton
  'retour'). REELLE meme avant la bascule. Une fois par reouverture ; un lien
  « sorti par erreur » deja envoye ferme aussi la boucle ; la tache
  Metricgram ne signale plus ces sorties comme abusives (pour_impaye).
  (i) fenetre de 30 jours : DELETE /v1/subscriptions/{id} (invoice_now et
  prorate a false) PUIS void des factures ouvertes (dans cet ordre : annuler
  d abord la derniere facture ferait repasser l abonnement a 'active'), cle
  d ecriture, relecture en direct avant, plafond 10 par passage. Echec
  (cle sans le droit, panne) = ligne 'arret' 'fenetre_30j' en 'echec' avec le
  message Stripe, rien ne bouge. Message de fin (sauf autre droit). SIMULEE
  sans la bascule.
  (j) rattrapage des emails de bienvenue (abonnement cree depuis moins de 3
  jours, actif, sans compte Telegram rattache ni email deja parti) : meme
  fonction que la page (preparerBienvenue, sortie dans liveclub/bienvenue.ts),
  donc meme verrou. SIMULE sans la bascule.
  La tache des desabonnes laisse les 'unpaid' a facture ouverte datee a la
  tache (g).
- La dette d abord (bot-membre.ts) : demande d adhesion refusee, lien
  personnel, code verifie, /start et /menu d un compte rattache dont le
  droit tombe pour un impaye encore dans les 30 jours : montant, lien de la
  facture, « regle-la et ton acces rouvre tout seul, a ton tarif actuel »
  (texteDette), au lieu des liens d abonnement. « Mon abonnement » et
  l outil mon_abonnement donnent la meme chose (phraseImpaye, faitsImpaye) ;
  prompt de l agent complete.
- Journal : gestes existants seulement (retrait, rappel, invitation, arret,
  entree_refusee), regles nouvelles impaye_5j, sortie_impaye,
  reouverture_impaye, impaye_ouvert, fenetre_30j, fin_fenetre_30j,
  bienvenue_rattrapage. Check en base verifie le 30/09 en lecture seule :
  aucune migration necessaire. Phrases du fil Support dans phraseGeste.
- Tests : verifier-liveclub.mjs 28 blocs (8 nouveaux). Eval
  /tmp/eval-fuites-v4.json : 158 passages, 1 fuite (H01#3 Live Club :
  formule de la politique commune recopiee, cas deja connu comme instable ;
  4 rejeux propres ensuite), 1 incorrect (O06 bot support : nom du Carnet
  omis), 0 refus a tort ; D01 a D03 (acces suspendu) 6/6 corrects.
- Apercu en lecture seule (scripts/apercu-impayes.mjs, cle Stripe de
  lecture, SELECT, getChatMember) au 30/09 : 5 abonnements en retard, 2 dans
  leurs 5 jours, 3 sorties SIMULEES (presents, non exemptes), 0 au-dela de
  30 jours, 0 bienvenue a rattraper, 1 reouverture qui partirait POUR DE
  VRAI au premier passage apres le deploiement.
- URGENT (30/09 en fin de journee) : les cles Anthropic du coffre
  (anthropic-liveclub-bot, anthropic-support-chatbot) repondent « credit
  balance is too low ». Si ce sont celles de la production, l agent des deux
  bots est a l arret (repli sur les boutons et « je previens l equipe »).
- A suivre : permissions de STRIPE_AGENT_KEY_MELANIE pour DELETE
  subscription et void invoice non verifiables sans ecrire (roadmap : groupe
  Billing en ecriture depuis le 04/09) ; le passage le dira au premier cas
  reel. La reouverture par email passe par un jeton 'retour' de 30 jours.

## Bot Live Club : une exemption datee vaut sortie programmee (06/10/2026, deploye f968d1b)

Demande de Brice (06/10) : « dis clairement au bot de sortir cette personne au
premier janvier ». Avant : une exemption echue ne protegeait plus, mais un
compte relie a aucun abonnement n'etait jamais sorti.
- Passage quotidien, tache (k) (tacheExemptions, passage.ts ; regles pures
  phaseExemption, decisionRappelExemption, decisionFinExemption dans
  passage-regles.ts). jusquau est INCLUS (comme exemptionActive) : la sortie
  part le LENDEMAIN de la date. Jour de Paris ET current_date de la base
  (jourLePlusAncien), sinon un passage lance entre minuit Paris et minuit UTC
  verrait retirerDuLiveClub refuser pour « exempte ».
- J-7 a J0 : rappel une fois (rappel 'fin_exemption_j7', details.exemption_id),
  seulement a un compte present, ni admin, sans autre droit. Echue : compte
  present, ni admin ni createur, droit 'non' SANS cette exemption
  (droitLiveClub(tid, { exemptionIgnoree }), plus les abonnements des emails
  connus) : sortie SANS ban par sortir() (plafond du passage), geste
  'fin_acces' regle 'fin_exemption', puis exemption close (retire_le = now(),
  retire_par laisse vide : uuid de compte, pas d'identite serveur ; l'acteur
  cron:liveclub du journal dit qui a clos), puis message de fin (rappel
  'fin_exemption_message', rattrape 7 jours en cas d'echec). Absent du groupe :
  close, ni sortie ni message ('refuse', cloture 'absent'). Admin ou autre
  droit : gardee et close ('refuse', cloture 'admin' ou 'autre_droit',
  raison_droit). Droit ou presence inconnus : rien. Permanente : jamais.
  SIMULE sans LIVECLUB_SORTIES_ACTIVES : lignes 'simule', rien de clos.
- Messages : prive si le compte a ecrit au bot, sinon email SEULEMENT si connu
  (cockpit_membre_emails du membre de l'exemption, puis le rattachement) ;
  sinon rien (compte 'sans_moyen', aucune ligne). Fil Support : phraseGeste
  (pur.ts) pour fin_exemption, fin_exemption_j7, fin_exemption_message.
- Synthese : exemptions { rappels_j7, sorties, simulees, messages_fin,
  closes_absent, gardees_autre_droit, sans_moyen, inconnus, echecs }.
- Cockpit (depot workspace, deploye) : sous la date de fin du
  formulaire, la regle (« Apres cette date, le bot sort la personne... Vide =
  exemption permanente. ») et la date de sortie calculee ; « sortie programmee
  le ... » (lendemain de jusquau) dans la liste des exemptions et la fiche
  membre, « sortie au prochain passage du bot » pour une echue pas encore close.
- Etat en base au 06/10 (lecture seule) : 17 exemptions ouvertes, 16
  permanentes, 1 datee (favorise, 2027-01-01, ni membre ni rattachement, bot
  jamais demarre) : ni rappel ni message possibles, sortie le 2027-01-02 s'il
  n'a toujours aucun droit. Aucun effet au deploiement.
- Tests : verifier-liveclub.mjs 30 blocs (1 nouveau). tsc et eslint propres.
- A suivre : la consigne de l'agent du cockpit (agent-cockpit.ts, lignes sur
  cockpit_liveclub_exemptions et « qui sort qui ») dit encore « on ne sort
  JAMAIS » un exempte : non touchee (chantier sans prompt), a completer.

## Bot Live Club : acces offert d'un compte non rattache (06/10/2026, deploye)

Bug signale par Brice (Nelly : exemption permanente, aucun rattachement) : le
bot la traitait en « non rattache » (demande de l'email du paiement). Cause :
situationDuMembre et bot-membre.ts tranchaient sur le seul rattachement, avant
droitLiveClub. droitLiveClub lisait deja l'exemption et l'acces broker par le
telegram_id (rien a corriger) ; l'acces manuel ne se lit que par le membre du
rattachement (non change).
- Ordre : rattachement, puis droit (profilSansRattachement, actions-membre.ts ;
  regle pure parcoursSansRattachement et textes accesSansAbonnement, pur.ts).
  Acces offert (exemption, broker, acces manuel) : sa situation partout
  (/start, /menu, « Mon abonnement », boutons, lien perime, texte libre avec
  l'agent), lien de retour s'il est hors du groupe, menu reduit
  (clavierAccesOffert), pause ou arret = « rien a mettre en pause ni a
  arreter ». Jamais l'email ni la raison de sortie, ni le motif ni la note.
  Droit 'inconnu' ou rattachement illisible sans exemption lue : TEXTE_PANNE
  (un email ou un code tape gardent la verification). Droit 'non' : parcours
  d'avant.
- Agent : tourne pour ces comptes ; situation donnee d'emblee en second bloc
  system (contexteAccesOffert, apres le prompt en cache), consigne
  CONSIGNE_ACCES_OFFERT jointe a mon_abonnement et mes_montants. Eval ciblee
  X01, X02 (variante 'offert') : 2/2 corrects (1er essai X02 incorrect sans le
  contexte : prix public donne sans outil).
- Chemins PANNE d'un compte non rattache avant le correctif : texte libre et
  boutons (sauf « Contacter l'equipe » et « verifier mon email ») quand la
  lecture de cockpit_liveclub_rattachements jetait (log « rattachement
  illisible pour u<id> »). /start et /menu donnaient alors TEXTE_NON_RATTACHE.
- Tests : verifier-liveclub.mjs 31 blocs. tsc et eslint propres.

## Equipe au bot des membres, droit avant reintegration, demandes au task picker (08/10/2026, deploye f5a8b1d)

Trois problemes reels (Brice, 08/10).
- L'equipe au bot des membres : un compte de cockpit_telegram_comptes qui ecrit
  du TEXTE LIBRE a @aok_liveclub_bot n'est plus traite en membre
  (transmettreSiEquipe, bot-membre.ts ; regle pure aiguillageMessagePrive,
  pur.ts). Sa demande part a l'agent du Cockpit, dans SA conversation Agent AOK
  (meme historique, memes verrous, carte de confirmation dans Agent AOK). Le
  traitement de la route Agent AOK est sorti dans src/lib/agent-cockpit-telegram.ts
  (traiterTexteAgentTelegram, traiterClicAgentTelegram), la route ne garde que
  le webhook. Un message transmis passe d'abord par un accuse dans Agent AOK
  (« Reçu depuis le bot Live Club ») : livre = « Tu es de l'équipe : je passe
  ta demande... » au bot des membres, non livre (Agent AOK jamais ouvert, panne)
  = « Je n'ai pas pu la passer... ». Il ne touche pas au dernier update_id
  d'Agent AOK (autre sequence). Ni fil Support, ni « veut un humain », ni
  alerte. /start, /menu, boutons : inchanges. maxDuration du webhook des
  membres passe a 120 s.
- Le droit avant la reintegration (agent-cockpit.ts, stripe-actions.ts) :
  consigne « verifie le droit d'abord, sans droit pose le droit » ; nouvel
  outil proposer_exemption (carte, poserExemptionServeur : refus si exemption
  active, une echue non close est close, pose_par = uuid de l'acteur) ;
  proposer_reintegrer_telegram refuse cote serveur si droitLiveClub n'est pas
  'oui' (refusReintegration, journalise 'reintegration' 'refuse' sans_droit ou
  impaye_ouvert, 'echec' droit_inconnu). Derniere ligne de chaque resultat
  broker, exemption, reintegration : l'etape humaine suivante (etapeApres*,
  pur.ts).
- Demandes au task picker : outil noter_demande (sans carte) qui ecrit dans
  cockpit_demandes (migration 20261008150000_cockpit_demandes.sql, ECRITE, PAS
  APPLIQUEE) ; consigne « je ne sais pas encore, c'est note ». Cockpit :
  « Demandes de l'équipe » sous le chat de l'onglet Support
  (views/DemandesEquipe.tsx), table absente = etat vide.
- Tests : verifier-liveclub.mjs 36 blocs (5 nouveaux). tsc et eslint propres ;
  cockpit npm run build ok. Aucune eval de bot (aucun prompt de bot membre
  touche) ; le prompt de l'agent du Cockpit n'a pas d'eval.
- A suivre : appliquer la migration ; le bouton Reintegrer du cockpit
  (/api/cockpit/liveclub/membre) ne verifie toujours pas le droit ; le bouton
  « Contacter l'équipe » d'un compte de l'equipe passe encore le fil en
  attente d'un humain.

## Commissions, depenses et repartition Brice / Mel (08/10/2026, deploye ; intervenants par live d11afe8, migrations 20261008170000 et 20261008190000 appliquees)

Regles de Brice du 08/10 (deux cotes, 70/30 a celui qui apporte la vente,
Saro hors calcul, base = encaisse - frais Stripe - remboursements -
intervenants dates, commission comptee le mois ou elle est RECUE et qui glisse
tant qu'elle est attendue, depenses par cote ou communes, solde en grand
livre, mois de Paris).
- Base : migration `20261008170000_cockpit_repartition.sql` (ECRITE, PAS
  APPLIQUEE) : cockpit_partenaires, cockpit_partenaire_taux (dates, une ligne
  par changement), cockpit_commissions (depot relie a acces_id, taux FIGE,
  attendue/recue/perdue), cockpit_intervenants (dates), cockpit_depenses,
  cockpit_reglements. Lecture is_cockpit_member(), insertion navigateur
  (pose_par = auth.uid()) sauf commissions (serveur seulement), retrait par
  retire_le, statut d'une commission modifiable.
- Calcul PUR : src/lib/repartition/pur.ts (centimes, partage au centime,
  solde de Brice = parts - en main, reglements deduits). Tests :
  scripts/verifier-repartition.mjs (15 blocs).
- Serveur : src/lib/repartition/serveur.ts (lecture, controle avant carte,
  execution). Route de lecture /api/cockpit/repartition pour le cockpit (le
  bundle du cockpit n'embarque aucune regle de partage).
- Agent du Cockpit : 7 outils a carte (proposer_depot_broker, qui pose
  l'acces 6 mois par acces.ts puis inscrit le depot ;
  proposer_commission_affiliation, proposer_marquer_commission,
  proposer_taux_partenaire, proposer_intervenant, proposer_depense,
  proposer_reglement) et 1 lecture sans carte (repartition_du_mois). Taux
  inconnu = l'outil le dit au modele, qui le demande avant tout.
- Frais Stripe : DEJA collectes (balance_transaction, collect_stripe.py et
  push_membres_supabase.py ; lecture seule du 08/10 : 476 paiements Stripe
  sur 476 avec frais). Rien ajoute. PayPal (37 paiements 2025, sans compte)
  n'est pas compte et l'ecran le signale.
- A suivre : appliquer la migration, deployer le journal puis le cockpit ;
  aucun eval du prompt de l'agent ; les taux de RaiseFx sont a donner par
  Melanie.
- 08/10/2026, CORRECTION du modele des intervenants (Brice : Adrien touche une
  somme fixe selon le nombre de lives faits dans le mois, rien sur les
  ventes) : plus aucun pourcentage d'intervenant, nulle part.
  cockpit_intervenants = TARIF PAR LIVE date (montant_par_unite, unite
  'live') ; chaque mois, l'outil proposer_lives_du_mois de l'agent (« Adrien a
  fait 6 lives en octobre ») ou le formulaire « Lives du mois » du cockpit cree
  une depense = nombre x tarif en vigueur ce mois-la (celui du dernier jour du
  mois), rattachee au produit du tarif, deduite de son cote avant le 70/30,
  payee par le cote du produit par defaut (Mel pour le Live Club). Une seule
  declaration vivante par intervenant, produit et mois. Migration
  `20261008190000_cockpit_intervenants_par_live.sql` ECRITE, PAS APPLIQUEE
  (table vide verifiee en lecture seule le 08/10, garde dans la migration).
  ORDRE : deployer le journal (il tolere les colonnes absentes), appliquer la
  migration, deployer le cockpit. Tests : verifier-repartition.mjs 17 blocs.

## Acces a un tarif particulier : produits Live Club dynamiques et liens de paiement (13/10/2026, NON commite, NON deploye)

Probleme reel (Brice, 13/10) : « un acces Live Club pour Yassine, eleve ETM, a
1 EUR par mois ». L'agent a cree le produit (prod_VR1P7PggEH30B9, tarif
price_1UQ9MnCbHiN0O0XimKBHXyiv, 1 EUR/mois, compte melanie, lu en lecture
seule le 13/10) mais (1) les produits Live Club etaient en dur
(PRODUITS_LIVECLUB) : ce produit n'ouvrait aucun droit, et (2) aucun outil ne
faisait de lien de paiement.
- Produits Live Club : table cockpit_liveclub_produits (migration
  `sites/Aoknowledgecom/supabase/migrations/20261013120000_cockpit_liveclub_produits.sql`,
  ECRITE, PAS APPLIQUEE ; les deux produits de base y sont inseres). Lue par
  src/lib/liveclub/produits.ts (cache 60 s par instance, une lecture a la
  fois, table absente = produits de base seuls). Les deux produits de base
  restent dans config.ts et ne se perdent jamais. Panne sans liste deja lue :
  liste NON complete, droitLiveClub fait d'un 'non' un 'inconnu', la page de
  bienvenue repond « reessaie dans une minute » au lieu de « ne concerne pas
  le Live Club ». Lecteur pur et teste : creerLecteurProduitsLiveClub (pur.ts).
  Tous les appels de stripe.ts et la pause de stripe-actions.ts lisent la liste.
- Agent du cockpit : proposer_produit prend live_club (compte melanie et
  recurrence obligatoires, inscription dans la table apres creation, le
  resultat donne prod_ et price_ et ne parle plus de PRODUITS_STRIPE) ;
  proposer_marquer_live_club (produit EXISTANT, relu chez Stripe, refuse s'il
  est deja inscrit) ; proposer_lien_paiement (Payment Link, controle avant la
  carte : produit et tarif lus chez Stripe, seul tarif actif ou price_id ;
  Live Club = compte melanie + tarif recurrent, after_completion redirect
  vers https://aoknowledge.com/live-club/bienvenue?session_id={CHECKOUT_SESSION_ID},
  restrictions.completed_sessions.limit = 1, ?prefilled_email= si email ;
  tout relu a l'execution ; cle sans la permission = message qui dit quoi
  demander a Adil, rien de cree). Consigne : produit (live_club vrai) puis
  lien, une carte a la fois. Cockpit : libelles des deux nouvelles cartes
  (AgentCockpit.tsx, depot workspace).
- Page de bienvenue verifiee dans le code : le site lit session_id, POST
  /api/liveclub/bienvenue, qui exige session du compte melanie, produit Live
  Club (liste dynamique), complete et payee, et un ABONNEMENT (d'ou le refus
  d'un lien Live Club sur un tarif comptant), puis jeton d'entree, email de
  bienvenue et lien personnel vers le bot.
- Pipeline : push_membres_supabase.py lit la meme table (charger_produits_live_club,
  avant de classer les abonnements ; table absente ou panne = les deux
  ecrits, une ligne le dit). Dry-run du 13/10 : « table absente », passage
  normal.
- Tests : verifier-liveclub.mjs 38 blocs (2 nouveaux : liste et cache,
  parametres du lien). tsc et eslint propres ; cockpit tsc et build ok ;
  py_compile ok. Aucune eval (prompt de l'agent du cockpit sans eval).
- A FAIRE : appliquer la migration, deployer le journal puis le cockpit,
  donner a STRIPE_AGENT_KEY_MELANIE la permission Payment Links en ecriture
  (Adil), puis marquer le produit de Yassine (proposer_marquer_live_club
  prod_VR1P7PggEH30B9) et demander son lien.

## Tarifs reserves du Live Club (13-15/10/2026, NON commite, NON deploye)

Brice, 13/10 : « ouvre un abonnement a ce prix pour cette personne », acces
seulement une fois paye, et un tarif reserve est PERSONNEL (« Live Club ETM »
ne dit rien du prix d'un autre eleve ETM).
- Base : migration `20261013160000_cockpit_liveclub_tarifs_reserves.sql`
  (ECRITE, PAS APPLIQUEE) : table cockpit_liveclub_tarifs_reserves (une
  reservation active par email, un compte Telegram sur une seule, lien_id
  plink_ et lien_url avec email prerempli, paye_le + abonnement_id, retrait
  par retire_le), colonne role de cockpit_liveclub_produits (le produit commun
  « Live Club (tarif réservé) », un seul actif). Lecture is_cockpit_member(),
  ecriture serveur seulement.
- Serveur : src/lib/liveclub/reserves.ts. Regles pures dans pur.ts (section
  « Tarifs RESERVES »).
- Agent du cockpit : proposer_abonnement_reserve (UNE carte : tarif cree a
  son nom sur le produit commun, ou price_id repris s'il est a elle seule,
  produit inscrit au Live Club si besoin, Payment Link personnel, ligne) et
  proposer_retirer_tarif_reserve (lien desactive, tarif cree archive ; payee =
  abonnement intact). Prompt : la suite produit + lien reste pour un produit
  ouvert a tous.
- Bot des membres : SON lien (bouton « Payer ») a la place des liens publics,
  sans droit ouvert ni dette : /start, /menu, apres le code (le compte
  Telegram est alors note sur la reservation), texte libre (avant l'agent),
  « Mon abonnement ». Reconnaissance par compte Telegram ou email VERIFIE,
  jamais un email tape. Adresse de reservation = connue pour l'envoi du code.
  Avant tout lien, le bot verifie que le tarif n'est pas deja paye (jamais
  deux paiements) ; un lien qui ne marche plus est recree.
- Paye : page de bienvenue (session), passage quotidien (etape
  tarifs_reserves, abonnements du tarif chez Stripe) et bot. Le tarif etant
  personnel, rapprochement D'ABORD par price_id, l'email en second : un
  abonnement vivant sur le tarif paie la reservation quelle que soit
  l'adresse, un abonnement termine seulement au meme email. Cas reel du
  13/10 : Yassine a paye son tarif (lien fait a la main) avec une autre
  adresse. Reprendre un tarif deja paye par un abonnement vivant est refuse.
- Cockpit : « Tarifs réservés Live Club » sous les acces broker (onglet
  Membres), lien a copier, retrait par /api/cockpit/liveclub/reserves.
- Tests : verifier-liveclub.mjs 43 blocs (5 nouveaux). tsc, eslint propres ;
  cockpit tsc et build ok. Aucune eval (le prompt du bot des membres n'est pas
  touche ; celui de l'agent du cockpit n'en a pas).
- A FAIRE : appliquer la migration, deployer le journal puis le cockpit.
  Rien a faire pour Yassine : il est deja abonne (paye le 13/10, entre par
  le bot), aucune reservation a enregistrer.

## Agent AOK lit les photos, les captures et les messages transferes (15/10/2026, NON commite, NON deploye)

Bug reel (Brice, 15/10) : Agent AOK ne lisait que message.text. Une capture
de paiements Stripe transferee de Melanie, avec le commentaire « Tu peux lire
cette image... » : l'agent a repondu « Je ne reçois aucune image » ; la photo
seule, legendee ou non : AUCUNE reponse (pas meme l'accuse).
- Lecture pure : src/lib/agent-cockpit-telegram-pur.ts (lireMessageTelegram,
  texteDuTour, historiquePourTour, messagesPourModele). Photo = la plus grande
  taille sous la limite ; document JPEG, PNG, WEBP ; legende = texte ;
  transfert (forward_origin, et les anciens forward_*) = « Message transféré
  de <nom (@pseudo)> : » en tete. Limite 3 750 000 octets (5 Mo une fois en
  base64, limite de l'API), dite en clair au-dela. Vocal, video, PDF... :
  « Je ne lis ici que le texte et les images ». Message de service : rien.
- Telechargement (telechargerImageTelegram, agent-cockpit-telegram.ts) :
  getFile puis le fichier, avec le jeton du bot qui a recu le message (un
  file_id ne vaut que pour son bot), jamais l'URL dans un log ; poids verifie
  trois fois ; type lu dans les octets. L'image part au modele en bloc image
  dans le tour courant seulement (point de cache dessus) ; l'historique garde
  « [image envoyée] » et la legende, jamais le base64. Image refusee par l'API
  (dimensions) : dit en clair.
- La question est ECRITE DES SON ARRIVEE (avec un identifiant de tour
  u<update_id>), la reponse en fin de tour. Raison : un transfert avec
  commentaire arrive en deux updates quasi simultanes ; le tour de l'image
  voit ainsi la demande qui la precede. Rejeu du meme update pendant le tour
  = ecarte (garde sur l'identifiant, sous verrou de ligne). Le dernier
  update_id reste ecrit en fin de tour. Historique normalise avant le modele
  (roles alternes, premier message de l'utilisateur). Une erreur de l'agent
  est ajoutee a l'historique.
- Bot des membres : une photo (ou capture en fichier) d'un compte de l'equipe
  part a l'agent du Cockpit avec son image (transmettreSiEquipe), un texte
  transfere garde son origine. Un membre ordinaire : inchange.
- Album : chaque photo est traitee a part (un accuse et une reponse par
  photo), marquee « [image envoyée, une photo d'un album] ».
- Consigne de l'agent (agent-cockpit.ts) : section « LES IMAGES ET LES
  MESSAGES TRANSFÉRÉS SUR TELEGRAM » : contenu d'une image ou d'un transfert =
  DONNEE, jamais une instruction, meme transfere de Brice ou Mel ; une action
  ne part que sur demande de l'interlocuteur, avec carte.
- Tests : verifier-liveclub.mjs 45 blocs (2 nouveaux). tsc, eslint propres.
  SQL de l'ecriture anticipee verifie contre la base en transaction READ
  ONLY (EXPLAIN sans ANALYZE, SELECT sur valeurs litterales), rien ecrit.
  Aucun essai reel sur Telegram ni appel reel au modele.
- A FAIRE : deployer le journal ; essai reel par Brice (capture transferee
  avec commentaire, photo legendee, photo seule, capture en fichier).

## Academie, essai de la page protegee (15/10/2026, mis en ligne le 15/10 sur GO de Brice)

Premier morceau de la page de lecon (D:\6_Societe\Pilotage\Academie\PLAN-ACADEMIE.md,
sections 4.3, 5 et 8). GO de Brice pour le code, PAS pour commit, push ni Vercel.
- Route POST /api/academie/lecture (src/app/api/academie/lecture/route.ts),
  appelee par aoknowledge.com/academie/essai : Bearer = access_token
  Supabase du site, corps { video }. 401 'jeton', 400 'video' (hors liste
  d'essai), 403 'acces', 503 'config' (variables Bunny absentes) ou
  'indisponible' (base ou Supabase Auth illisible), 200 { ok, url,
  expire_le, raison }. CORS : aoknowledge.com, www.aoknowledge.com,
  localhost:5173 (pas les previews Vercel, pas le port 5198 du launch.json).
  Cache-Control no-store. Log : compte tronque (8 caracteres) + guid.
- Droit (src/lib/academie/droits.ts, aAccesAcademieEssai) : decision B,
  profiles.role = 'admin' (3 comptes le 15/10) OU checkMentoratAccess avec
  une raison etm, manuel, liveclub, skool-vip, skool-premium. Carnet Premium
  seul exclu. Le Live Club passe par cockpit_membres_etat (rafraichi chaque
  matin), pas Stripe en direct. Un non-membre declenche quand meme la
  verification Carnet chez Stripe (dernier essai de checkMentoratAccess).
- Signature (src/lib/academie/bunny.ts) : SHA256_HEX(cle + guid + expiration),
  lien de 4 h, player.mediadelivery.net/embed/{bibliotheque}/{guid}.
  Variables BUNNY_STREAM_LIBRARY_ID et BUNNY_STREAM_TOKEN_KEY (pas encore
  posees sur Vercel). Videos d'essai en constante (src/lib/academie/essai.ts).
- Pas de migration, pas de journal de lecture en base (viendra avec les
  tables academie_*).
- Verifie : `node scripts/verifier-academie-bunny.mjs` (4 blocs hors ligne,
  puis contre Bunny avec le coffre : signe = 200, sans jeton, expire, autre
  cle = 403, pour les deux videos) ; tsc ok ; eslint des fichiers ok (le
  lint complet garde ses 4 erreurs anciennes) ; build ok ; en local (next
  start) : preflight 204 avec CORS pour les 3 origines et sans pour une
  autre, 401 sans jeton et avec un faux jeton. Requete du role admin rejouee
  en lecture seule. NON teste : 403 et 200 avec un vrai compte (il faut une
  session reelle), a faire apres deploiement.
- A FAIRE (sur GO) : poser les deux variables en production par
  `bash /mnt/d/6_Societe/Pilotage/Academie/outils/poser-env-bunny-journal.sh`,
  puis commit et push du journal, puis le site (sites/Aoknowledgecom/ETAT.md).

## Academie, base V1 : tables, droits, lecture, suivi (15/10/2026, EN PRODUCTION : journal fa38f90, migration 20261015210000 appliquee)

Plan : D:\6_Societe\Pilotage\Academie\PLAN-ACADEMIE.md (4.2, 4.3, 5, 7, 12).

**Quatre etats par lecon et « vu » a 60 % (16/10/2026, NON commite, migration
20261016110000 ECRITE, PAS APPLIQUEE).** Brice, 15/10. Contrat partage avec
les ecrans du site :
- etat (pur.ts, etatLecon) : non_vu (aucune ligne de progression), ouvert
  (ligne creee par /lecture, video, texte ou PDF, secondes_vues = 0),
  en_cours (secondes_vues > 0), vu (vu_le pose). Dans /moi (chaque lecon,
  Continuer), /lecture et /suivi (progression.etat).
- vu se pose tout seul : video a 60 % de temps REELLEMENT regarde (au
  franchissement du seuil, une seule fois), evenement 'fin', nouvel
  evenement 'texte_fin' (texte ou PDF lu jusqu'en bas), ou clic 'vu'. La
  premiere voie est gardee dans vu_par (mesure, fin, texte_fin, eleve).
  'non_vu' (ou vu: false) retire vu_le, vu_par et le clic ; terminee_le
  (preuve du seuil mesure) et le journal restent. Apres un decochage,
  continuer a regarder ne recoche pas ; une nouvelle 'fin' ou 'texte_fin',
  si.
- Migration `20261016110000_academie_etats_vu.sql` : colonnes vu_le et
  vu_par (contraintes), reprise des lignes existantes (clic -> eleve, fin
  mesuree -> mesure, videos deja a 60 % -> mesure), 'texte_fin' dans les
  evenements du journal. A APPLIQUER AVANT de deployer ce code (les
  requetes lisent vu_le : sans la colonne, /moi et /suivi repondent 503).
- /moi : par module prix_eur, offres [{ slug, titre, type, prix_eur,
  portee: module | sections | tout }], progression { lecons, vues,
  en_cours, ouvertes, commencees, pourcentage (part des lecons 'vu') } ;
  par lecon etat, progression.vu_le et vu_par.
- Verifie : verifier-academie.mjs 29 blocs hors ligne (59 % et 60 %
  regardes, saut au-dela de 60 % sans visionnage, fin, texte_fin, vu puis
  non_vu, ouverture sans consommation) et Bunny en ligne ;
  essayer-migration-academie.mjs (migration des etats, reprise, contraintes,
  requetes des routes, transaction ANNULEE, vu_le absente apres coup) ; tsc,
  eslint, build.

Base du 15/10 :
- Base : `sites/Aoknowledgecom/supabase/migrations/20261015210000_academie_tables.sql`
  (appliquee le 15/10). academie_modules, _sections, _lecons (format,
  usage, hebergeur bunny ou wistia, bibliotheque Bunny NOMMEE), _offres +
  _offre_contenus (module entier ou section), _acces, _progression,
  _lectures (journal de preuve). RLS forcee, aucune policy, rien pour anon
  et authenticated ; service_role : catalogue complet, acces et progression
  sans delete, journal en insert et select seulement. Pas de cle etrangere
  vers auth.users (le journal survit a un compte supprime). Depart : offres
  compte-gratuit, live-club, formation-complete (1 999, paypal), etm
  (ouvre_tout) ; module essai publie, 2 lecons Bunny (durees lues chez
  Bunny : 2163 et 3759 s), ouvert par l'offre live-club.
- Regle : droitsAcademie (src/lib/academie/droits.ts, calcul pur dans
  pur.ts). Union : admin, ETM (tout) ; tout compte (offre compte-gratuit,
  usage externe_compte ou externe_libre, apercu) ; academie_acces actifs par
  user_id ou email VERIFIE (email confirme de auth.users, profile_emails
  verified) ; Live Club en direct (broker ou acces manuel du cockpit en
  base, sinon Stripe MelTrade par email, cache oui 10 min / non 5 min, 4 s
  max) qui ouvre l'offre live-club et les acces de source liveclub ;
  secours de la decision B (rang Skool, abonnement vu par le cockpit,
  MentoratGrant) pour le module essai seul. Exemptions Telegram : attendent
  le lien Telegram (4.5). Stripe illisible = contenu 'inconnu' (503), jamais
  un faux refus.
- Routes (CORS de l'essai, no-store, compte tronque dans les logs) :
  POST /api/academie/lecture ({ lecon } ou { video }, Bunny signe 4 h par
  bibliotheque, Wistia = id, texte = contenu, pdf = ressources ; ligne
  'lien' au journal) ; POST /api/academie/suivi (lecture, pause, fin, texte,
  vu ; temps credite borne par le temps ecoule, 1 signal par lecon / 20 s,
  3 s pour fin et vu, verrou optimiste) ; GET /api/academie/moi (modules,
  sections, lecons, droits et raisons, progression, Continuer ; jamais
  d'identifiant Bunny ni de contenu ; connexion notee une fois par 30 min).
  Sans les tables, /lecture { video } repond comme avant (essai.ts +
  aAccesAcademieEssai) : le code peut partir avant la migration.
- SQL dans src/lib/academie/requetes.ts (chaines, $queryRawUnsafe avec
  parametres) pour que le test joue exactement les requetes des routes.
- Verifie : `node scripts/verifier-academie.mjs` (25 blocs hors ligne, puis
  Bunny avec Referer aoknowledge.com : signe 200, sans jeton, expire et
  sans Referer 403) ; `node scripts/essayer-migration-academie.mjs`
  (migration + contraintes + requetes des routes dans une transaction
  ANNULEE, tables absentes apres coup) ; requetes d'identite et du cockpit
  rejouees en lecture seule sur les 33 comptes (totaux seulement) ; tsc,
  eslint des fichiers, build ok ; next start : preflight et 401 sur les 3
  routes. verifier-academie-bunny.mjs envoie maintenant le Referer (sans
  lui, 403 depuis les domaines autorises du 15/10).
- NON teste : 200, 403 et suivi avec une vraie session.
- A FAIRE : appliquer 20261016110000 puis deployer les quatre etats,
  test de Brice sur /academie/essai (doit marcher pareil) ; cote site :
  ecrans /academie (moi, lecture { lecon }, suivi toutes les 30 s avec
  secondes jouees mesurees par player.js) ; politique de confidentialite et
  duree de conservation du journal ; variables BUNNY_STREAM_<NOM>_* pour
  une bibliotheque autre que formation ; retirer le secours essai apres le
  transvasage.

## Noms et paroles des membres Telegram, passe 1 (15/10/2026, NON commite, NON deploye)

Brice, 15/10 : suivre les noms et les paroles des membres dans l'ontologie.
Passe 1 = l'historique des noms et la collecte quotidienne des messages. La
passe 2 (fiche de l'agent, conversations des bots) lira les deux tables.
- Base : migration `20261015170000_cockpit_telegram_noms_messages.sql`
  (ECRITE, PAS APPLIQUEE). cockpit_telegram_noms (une ligne par
  telegram_id, pseudo, nom_affiche distincts, null compris, premier_vu,
  dernier_vu, source de la premiere observation : groupe, message,
  evenement, prive), ecrite SEULEMENT par la fonction
  cockpit_telegram_noms_noter(jsonb, boolean). cockpit_telegram_messages
  (cle chat_id, message_id, texte ou legende, a_media et type_media, jamais
  le media), insert seul pour la cle de service (jamais ecrase). Lecture
  is_cockpit_member(), rien pour anon.
- Collecte : `D:\6_Societe\Pilotage\Data-Performance\automations\collecter_telegram.py`
  (Python Windows, Telethon, session de Brice, lecture seule cote Telegram),
  Live Club (forum, tous sujets) et Pot De Trader (-1002591690182), depuis
  le 30/08/2026 au premier lancement. Tache AOK-Collecte-Telegram a creer
  (creer_tache_collecte_telegram.ps1, pas lance).
- Journal : src/lib/liveclub/noms.ts (best effort, ne leve jamais, ecrit
  seulement) et noms-pur.ts. Webhook du groupe (chat_member) = source
  'evenement' ; message prive au bot des membres (from) = source 'prive',
  une ecriture par compte et par jour au plus (memoire par instance + garde
  SQL p_une_fois_par_jour ; un nom qui change dans la journee s'ecrit).
- Limites : Telegram ne garde pas l'historique des noms (nom d'un message =
  nom du jour de la collecte). Un CONTACT de Brice porte, cote Telethon, le
  nom que Brice lui a donne : le script n'ecrit pas ces noms (12 contacts sur
  98 participants du Live Club, 13 sur 30 dans Pot De Trader le 15/10).
- Tests : verifier-liveclub.mjs 57 blocs (2 nouveaux), tsc, eslint des
  fichiers propres. Python : tester_collecter_telegram.py 11 blocs, dry-run
  reel --limite 50 sur les deux groupes (aucune ecriture).
- A FAIRE : appliquer la migration, puis premier lancement a la main,
  creer la tache, deployer le journal (l'ordre n'importe pas pour le
  journal : sans la migration il avertit et continue).

## Noms et paroles des membres Telegram, passe 2 : la fiche d'une personne (15/10/2026, NON commite, NON deploye)

Brice, 15/10 : « si je demande a notre agent des informations sur Fred, il
doit me donner son ressenti, ses messages, ou m'en faire un resume », et
connaitre ses anciens noms s'il se renomme.
- Outil de LECTURE fiche_personne(qui) de l'agent du Cockpit, sans carte
  (agent-cockpit.ts). Serveur src/lib/fiche-personne.ts, une transaction
  READ ONLY ; regles pures src/lib/fiche-personne-pur.ts. qui = nom, ancien
  nom, @pseudo, u<id>, email, ou l'identifiant rendu (u..., membre:<uuid>,
  p-...). Recherche sans accents ni casse dans tous les noms passes
  (cockpit_telegram_noms), le registre du groupe, les auteurs des messages,
  l'archive (nom, alias, pseudo), les fiches membres (nom, pseudo declare),
  les contacts manuels et les emails. Une personne = noeuds reunis par des
  liens CERTAINS seulement (meme compte, rattachement, numero pose a la main,
  exemption, archive rapprochee 'certain') ; un lien par le nom ou le pseudo
  declare au paiement est dit PROBABLE, jamais suivi. Plusieurs personnes =
  statut 'plusieurs' (10 candidats au plus, le plus vivant d'abord), l'agent
  demande.
- Fiche bornee a 12 000 caracteres de JSON (5 paliers puis retraits
  section par section, jamais coupee) : identite et noms successifs dates,
  liens, Live Club (abonnements, pause, exemptions, acces broker, tarif
  reserve, acces manuel, ETM, rattachements, gestes), archive (vies, themes,
  paroles), notes de l'equipe, messages depuis le 30/08 (par groupe, par
  sujet, 6 recents, 10 marquants), fils Support. Marquants sans IA : 2
  premiers, longs (300 car.), mots-cles depart, arrivee, pause, abonnement,
  remerciement, difficulte (poids, seuil 3) ; 255 messages eligibles sur
  8 637 (calibre le 15/10).
- Catalogue de requete_sql : cockpit_telegram_noms, cockpit_telegram_messages,
  cockpit_telegram_oublis. Consigne « LES PERSONNES : LA FICHE ET LES
  PAROLES ». requete_sql tourne maintenant en READ ONLY (une fonction qui
  ecrit, appelee dans un SELECT, etait possible en postgres).
- Perimetre : seul agent-cockpit.ts importe la fiche, seuls la fiche et
  l'agent nomment cockpit_telegram_messages ; aucune route ni aucun bot
  membre (verifie par le script de test, statiquement).
- Effacement : migration `20261015200000_cockpit_telegram_oublier.sql`
  (ECRITE, PAS APPLIQUEE) : cockpit_telegram_oublis, trigger BEFORE INSERT
  qui ecarte les comptes oublies (sinon la collecte du matin les reecrit),
  cockpit_oublier_telegram(bigint[], text) en postgres seulement :
  `select public.cockpit_oublier_telegram(array[<id>]::bigint[], '<note>')`.
- Cockpit : bloc « Noms successifs » et « Derniers messages » de la fiche
  membre (components/ParolesTelegram.tsx, depot workspace).
- Tests : scripts/verifier-fiche-personne.mjs (20 blocs) ; apercu en
  lecture seule scripts/apercu-fiche-personne.mjs "<qui>" (structure et
  comptes seulement). Aucun appel au modele, aucune eval.
- A FAIRE : appliquer la migration 20261015200000 ; deployer le journal puis
  le cockpit ; essai reel par Brice (« parle-moi de Fred »).

## Effacement des donnees d'une personne, trois niveaux (15/10/2026, NON commite, migration NON appliquee)

Brice, 15/10 : 1 ne plus etre suivi, 2 effacer ses echanges avec nos bots,
3 partir et tout effacer. Jamais automatique, l'equipe qualifie le niveau.
L'INVENTAIRE QUI FAIT FOI : docs/EFFACEMENT-DONNEES.md (table par table, ce
qui est efface, garde ou anonymise et pourquoi, cascades du compte AOK,
hors base, residus).
- Base : migration `20261016090000_cockpit_effacement.sql` (ECRITE, PAS
  APPLIQUEE) : cockpit_effacement_cibles, cockpit_effacement_apercu (STABLE),
  cockpit_effacer (une transaction, journal cockpit_effacements sans nom),
  postgres seulement. Payeur FIGE sur les paiements (payeur_nom,
  payeur_email) avant toute disparition de fiche : dans cockpit_effacer, dans
  cockpit_oublier_membre (corrigee, elle detachait les paiements sans nom) et
  par trigger BEFORE DELETE sur cockpit_membres. Listes d'oubli et triggers :
  cockpit_oublis_emails (haches, lue par le pipeline), cockpit_arch_oublis,
  registre du groupe sans nom pour un compte oublie.
- Agent du cockpit : outil proposer_effacement(qui, niveau) (agent-cockpit.ts,
  effacement.ts, effacement-pur.ts). Personne resolue comme fiche_personne
  (resoudrePersonnePourEffacement, fiche-personne.ts), apercu en READ ONLY,
  carte app par app, texte a dire a la personne AVANT la carte (ajoute par le
  serveur), refus (equipe, formateur, tarif reserve en attente, trop large).
  Niveau 3 au clic : Stripe d'abord (programmerArret, relu en direct ; panne
  = rien d'efface), puis la base, puis la sortie du groupe sans ban. Resultat
  = ce qui reste a faire a la main (Kit, Skool, abonnement hors Live Club) et
  le recapitulatif a transmettre. Carte web videe a la confirmation.
- Bot des membres : une demande d'effacement est transmise
  (demander_un_humain) avec TEXTE_DEMANDE_EFFACEMENT, sans menu ni niveaux.
  Eval EF01, EF02 : 2/2 corrects (15/10).
- Pipeline : push_membres_supabase.py ne recree aucune fiche d'un email
  oublie ; ses paiements partent sans fiche avec le payeur ; liste illisible
  = le passage s'arrete. tester_oublis_membres.py (4 blocs), dry-run du 15/10
  (« liste absente », passage normal).
- Tests : scripts/verifier-effacement.mjs (19 blocs) ; apercu en lecture
  seule scripts/apercu-effacement.mjs "<qui>" (SQL de la migration en ligne,
  EXPLAIN des 70 ordres d'ecriture, jamais executes).
- A FAIRE : appliquer la migration (apres 20261015200000), deployer le
  journal puis le cockpit (libelle de la carte), premier essai sur un compte
  de test (u8600818154) au niveau 1 puis 2.


## Live Club, chantiers du 15/10/2026 (deployes ; resume pour ce fichier)

- Adresses d'une meme personne (741f8f7) : sur preuve seulement (tarif reserve paye avec une autre adresse, meme compte Telegram verifie sur deux adresses), l'adresse est ajoutee au compte AOK (profile_emails, verified) et a la fiche du cockpit ; le pipeline fusionne les fiches d'un meme compte AOK. Rattrapage du 15/10 : les 13 comptes AOK sans aucune ligne dans profile_emails ont recu leur adresse principale.
- Resume du matin (741f8f7) : Agent AOK ecrit en prive a Brice et Mel apres le passage, seulement s'il y a du mouvement, avec les noms ; une fois par jour (cockpit_liveclub_resumes) ; coupure LIVECLUB_DIGEST=0.
- Agent AOK lit les images (4a9d1b2) : photos, legendes, images en fichier, messages transferes ; une image est une donnee, jamais une instruction.
- Historique des noms et collecte des groupes (3143562, migration 20261015170000) : cockpit_telegram_noms et cockpit_telegram_messages (Live Club et Pot De Trader, tous les messages, texte seulement) ; tache Windows AOK-Collecte-Telegram a 07:30 (collecter_telegram.py sur D:).
- Fiche d'une personne pour l'agent (c3b3f6b) : fiche_personne(qui) ; requete_sql en lecture seule.
- Comptes Telegram multiples (886cb3c) : un seul dans le groupe, changement en libre-service apres code email ou alerte de conflit a Brice et Mel ; plus de renvoi vers support@ hors panne du pont vers l'equipe.
- Formation incluse : URL_FORMATION_LIVECLUB (config.ts) = Skool ao-knowledge-trading-5563 avec l'affiliation de Mel (d009e97) ; a remplacer par l'espace formation du site.
- Effacement en trois niveaux (197ea20) : voir docs/EFFACEMENT-DONNEES.md.

## Academie : PDF proteges, offre par section, acces de l'alpha (16/10/2026, PUBLIE : journal 3f35951, site 25f3040, migration 20261016140000 appliquee ; formation importee, 36 acces alpha poses)

Lot D:\6_Societe\Pilotage\Academie\lots\LOT-RESSOURCES-PROTEGEES-ET-ALPHA.md (GO de Brice le 15/10).
- PDF proteges : bucket Supabase Storage PRIVE academie-ressources (migration
  `20261016140000_academie_ressources_protegees.sql` : bucket prive, PDF, 50 Mo ;
  aucune policy sur storage.objects ; evenement 'ressource' et colonne ressource
  au journal des lectures). Piece jointe protegee = { titre, fichier } dans
  academie_lecons.ressources ; { titre, url } reste publique (http(s) ou chemin
  du site : le workbook /media/... etait ECARTE par ressourcesPropres, corrige).
  Route POST /api/academie/ressource { lecon_id, index } (meme jeton, CORS et
  regle que /lecture) : URL signee 5 min (src/lib/academie/stockage.ts, cle
  SUPABASE_SERVICE_ROLE_KEY, presente en production), ligne 'ressource' au
  journal (au mieux). /lecture rend aussi contenu et ressources d'une VIDEO.
- Envoi : `node --env-file=.env.local scripts/envoyer-ressources-academie.mjs <dossier> <prefixe> [--ecrire]`
  (a blanc par defaut, idempotent par MD5, PDF > 50 Mo ignores, refuse sans
  bucket ou si public ; donne les lignes { titre, fichier } a coller).
- Offre par section : champ offres_sections { "live-club": ["partie-1"] } du
  fichier de module (importer-catalogue-academie.mjs, lireOffresSections dans
  pur.ts) ; retire les liens par section de CE module qui ne sont plus listes.
  Regle deja juste (section ouverte = ses lecons, module partiel) ; pourcentage
  sorti en pur (progressionDuModule) et teste.
- Alpha : `node --env-file=.env.local scripts/donner-acces-academie.mjs <csv> [--ecrire] [--retirer]`,
  CSV email;offre;source;note, pose sur l'EMAIL (droitsAcademie le retrouve par
  email verifie, aussi quand le compte est cree apres), pose_par
  agent:alpha-2026-10, idempotent, retrait limite a ses propres lignes, bilan
  chiffre (dont comptes verifies / non verifies / sans compte), jamais d'email.
- Verifie : verifier-academie.mjs 33 blocs hors ligne ;
  essayer-migration-ressources-academie.mjs (migration jouee 2 fois, bucket
  prive, objet simule invisible pour anon et authenticated, journal, import en
  sections, regle, acces de l'alpha, transaction ANNULEE, rien en base apres) ;
  essais a blanc des trois scripts ; tsc, eslint des fichiers, next build ;
  next start : preflight 204, 401 sans jeton. NON teste : 200 et 403 avec une
  vraie session.
- A FAIRE : appliquer la migration, deployer le journal puis le site, envoyer
  les PDF (--ecrire), les declarer dans le fichier du module, importer, poser
  les acces de l'alpha.

## Support : repondre d'Agent AOK, images et fichiers, l'equipe a la main (16/10/2026, NON commite, NON deploye ; aucune migration)

Demandes de Brice du 16/10 (et cas reel de Lea, @leaafighter).
- Repondre d'Agent AOK : outil proposer_reponse_membre(fil, texte,
  piece_jointe) de l'agent du cockpit, avec carte (destinataire nom, @pseudo,
  email, app ; ou part le message ; texte EXACT, ou legende + piece jointe).
  fil = reference d'alerte « fil 1a2b3c4d » (8 premiers caracteres de l'id),
  id complet, ou personne resolue comme fiche_personne (resoudrePersonnePourSupport) :
  le fil qui attend un humain, sinon le plus recent ; plusieurs = l'agent
  demande ; un nom a homonymes dont un seul a un fil = la carte le dit.
  Envoi = celui de l'onglet Support, sorti dans src/lib/support-reponse.ts
  (repondreAuFil) : la route /api/support/reply garde ses entrees et sorties
  JSON. Serveur de l'outil : reponse-membre.ts, regles reponse-membre-pur.ts.
- L'alerte « demande un humain » finit par « Pour lui répondre d'ici : dis-moi
  « réponds-lui : ton message » (fil xxxxxxxx). » ; son dernier message saute
  les lignes de bouton et les traces sans texte (« (a appuyé sur Contacter
  l'équipe) » s'il n'y a rien d'ecrit). Bouton « Rendre la main au bot » sous
  l'alerte d'un fil Telegram (callback rm:<id>, route d'Agent AOK).
- Images des membres : photo ou capture en fichier -> message du fil avec
  piece { file_id, file_unique_id, type, mime, nom, taille } (fichier jamais
  copie), reponse « Bien reçu. Je ne lis pas les images... », fil en attente,
  alerte avec l'image (getFile bot des membres -> sendPhoto Agent AOK, en
  memoire). Passage en attente ATOMIQUE (horloge clock_timestamp dans l'upsert
  du pont) : un album = une reponse, une alerte. Au plus une alerte par fil et
  par 10 minutes (ligne « [système] Équipe prévenue. »).
- Fichiers de l'equipe : depuis Agent AOK (photo ou fichier envoye a l'agent,
  piece gardee par reference dans l'historique, telechargee avec le jeton
  d'Agent AOK puis renvoyee par le bot des membres ; 20 Mo, types images, PDF,
  Office, OpenDocument, texte, CSV, RTF ; legende 1 024 caracteres) et depuis
  l'onglet Support (bouton joindre, multipart sur /api/support/reply, 4 Mo :
  limite du corps d'une fonction Vercel). Image JPEG/PNG/WEBP de 10 Mo au plus
  = sendPhoto, le reste sendDocument. Le fil garde le file_id rendu par le bot
  des membres. Fil du site : refuse (son chat n'affiche que du texte).
- Routes du cockpit (Bearer + allowlist) : POST /api/cockpit/support/piece
  { fil, message } (image relue chez Telegram, 3,75 Mo, type lu dans les
  octets, file_id lu en base) et POST /api/cockpit/support/main { threadId }.
- L'EQUIPE A LA MAIN (support-pont-pur.ts, quiRepond) : des qu'un message
  human entre dans un fil Telegram, le bot ne repond plus aux messages ecrits
  du membre : ils vont a l'equipe (fil en attente, alerte « X a répondu à
  l'équipe », accuse « Je transmets à l'équipe, elle te répond ici. » une fois
  par periode). Boutons et commandes inchanges. Le bot reprend la main par le
  bouton (onglet Support, alerte, ou « rends la main au bot » : outil
  rendre_la_main_au_bot, sans carte), ce qui pose « [système] Main rendue au
  bot par l'équipe. » et sort le fil de l'attente ; ou seul apres 24 h sans
  message de l'equipe (glissant, DUREE_MAIN_EQUIPE_MS), ligne au resume du
  matin. Etat LU dans les messages : aucune colonne.
- Resume du matin : jamais un compte de cockpit_telegram_comptes dans
  « Demandes d'humain en attente » ; rubrique « Fils rendus au bot seul ».
- Cockpit (depot workspace, NON commite) : SupportView.tsx (vignette cliquable,
  pastille « équipe », bouton « Rendre la main au bot », bouton joindre pour un
  fil Telegram) et PieceJointeSupport.tsx. tsc -p tsconfig.app.json et npm run
  build ok. AgentCockpit.tsx n'a pas encore de libelle pour la carte
  reponse_membre (titre vide, resume affiche sans retours a la ligne).
- Tests : verifier-reponse-membre.mjs (18 blocs), verifier-pieces-support.mjs
  (16), verifier-alerte-equipe.mjs, verifier-liveclub.mjs (63, rubrique
  ajoutee a la matinee fictive), fiche-personne et effacement inchanges ; tsc
  et eslint des fichiers propres. SQL : EXPLAIN (sans ANALYZE) de l'upsert du
  pont et de la main rendue en READ ONLY, apercu reel du controle de la carte
  (references, id, u<id>, email, homonymes). Aucun envoi Telegram reel, aucun
  appel au modele, next build non lance (serveur de dev d'une autre session).
- A FAIRE : deployer le journal puis le cockpit ; essais reels (reponds-lui
  sous une alerte, album de 3 photos, PDF envoye depuis Agent AOK, joindre
  depuis l'onglet, rendre la main) ; libelle de la carte dans AgentCockpit.tsx.
