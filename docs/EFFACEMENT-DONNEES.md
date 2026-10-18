# Effacement des données d'une personne : l'inventaire qui fait foi

Décision de Brice du 15/10/2026. Ce fichier dit ce qu'on détient sur une personne, où, et pour chaque
niveau d'effacement ce qui est effacé, gardé ou anonymisé, et pourquoi. Le code doit lui obéir : s'ils
divergent, c'est le code qu'on corrige, ou ce fichier, jamais en silence.

Code : `src/lib/effacement-pur.ts` (règles, carte, textes), `src/lib/effacement.ts` (serveur),
`sites/Aoknowledgecom/supabase/migrations/20261016090000_cockpit_effacement.sql` (fonctions et filtres),
`D:\6_Societe\Pilotage\Data-Performance\automations\push_membres_supabase.py` (la collecte ne recrée pas).
Vérifications : `scripts/verifier-effacement.mjs` (hors ligne), `scripts/apercu-effacement.mjs "<qui>"`
(lecture seule sur la vraie base), `tester_oublis_membres.py` (pipeline).

## 1. Les règles de Brice

- Trois niveaux, jamais automatiques. C'est l'équipe qui qualifie le niveau avec la personne, puis
  l'exécute (agent du cockpit, outil `proposer_effacement`, carte de confirmation).
- Le bot des membres ne PROPOSE jamais l'effacement et ne le met pas en avant. Si une personne le demande,
  il transmet à l'équipe (fil Support en attente d'un humain) avec une phrase neutre : « C'est noté, je
  transmets ta demande à l'équipe : elle revient vers toi ici pour voir avec toi ce que tu souhaites. »
  Pas de menu, pas de niveaux, rien de supprimé.
- Un paiement garde TOUJOURS le nom et l'email du payeur, même au niveau 3 : « je ne peux pas avoir un
  paiement sans nom ; si j'ai un contrôle, je dois pouvoir dire c'est cette personne qui a payé ».
  Stripe garde ses propres données : on n'y touche pas.
- Niveau 1 : la personne est PRÉVENUE de ce que ça change pour son suivi et ses outils.
- Les messages dans les groupes Telegram : c'est la personne qui les supprime elle-même.

## 2. Les trois niveaux

| Niveau | Nom | Ce qui part | Il reste membre ? |
|---|---|---|---|
| 1 | ne plus être suivi | ses messages relevés dans les groupes, ses noms (historique, registre), sa fiche d'archive d'avant le 30/08 ; plus rien n'est relevé ensuite | oui |
| 2 | effacer ses échanges avec nos bots | ses fils avec le bot des membres et le support, la mémoire du bot | oui |
| 3 | partir et tout effacer | niveaux 1 et 2, abonnement Live Club arrêté à la fin de la période payée, sortie du groupe sans ban, compte AOK dans toutes les apps (notes du Journal comprises), fiche membre, Live Club, site, masterclass, académie | non |

## 3. Le parcours

1. Le membre demande au bot : transmission neutre (règle et phrase dans `liveclub/prompt-membre.ts`,
   `TEXTE_DEMANDE_EFFACEMENT` ; evals EF01 et EF02 de `scripts/eval-fuites.mjs`).
2. L'équipe voit avec lui le niveau. L'agent du cockpit, s'il n'a pas le niveau, rappelle les trois et
   demande : il ne choisit jamais (`lireNiveau` refuse tout ce qui n'est pas 1, 2 ou 3).
3. `proposer_effacement(qui, niveau)` : la personne est retrouvée comme par `fiche_personne` (liens
   certains seulement ; plusieurs candidats = l'agent demande lequel), puis l'APERÇU compte, en
   transaction READ ONLY et par une fonction STABLE, ce que le niveau effacerait.
4. Avant la carte, le serveur ajoute le texte à dire à la personne (`TEXTES_PREVENIR`). La carte liste ce
   qui sera effacé app par app, ce qui reste, ce qui est fait hors base, ce qui reste à faire à la main,
   et l'irréversible.
5. Au clic, niveau 3 : Stripe d'abord (une panne Stripe arrête tout, rien n'est effacé), puis
   `cockpit_effacer` en une transaction (le payeur est figé en premier), puis la sortie du groupe.
6. Le résultat donne à l'équipe ce qui a été fait, ce qui reste à faire à la main et le récapitulatif à
   transmettre à la personne. Le geste est journalisé dans `cockpit_effacements` : des comptes, jamais
   un nom, un email ni un identifiant. La carte consommée est vidée (seul le niveau reste).

Refus avant la carte (niveau 3) : compte de l'équipe (`cockpit_allowlist`, `cockpit_telegram_comptes`),
formateur d'un cours (`courses.instructor_id`), tarif réservé en attente de paiement (son lien de paiement
est encore actif : le retirer d'abord), cible trop large (plus de 3 fiches ou comptes AOK, plus de 6
comptes Telegram). Tout niveau : rien à effacer.

## 3 bis. Suppression par le membre lui-même (site, 18/10/2026)

Décision de Brice du 18/10 (écran Paramètres de `/mon-espace`, rubrique Données) : le membre peut
supprimer SON compte lui-même. Ce n'est pas une exception aux règles de la section 1 : c'est la
personne qui choisit, explicitement, le niveau 3 (« Supprimer mon compte », puis écrire SUPPRIMER).
Le bot des membres, lui, ne propose toujours rien.

- Route : `POST /api/compte/supprimer` (`src/lib/compte-membre.ts`), jeton Bearer du site, corps
  `{ confirmation: 'SUPPRIMER' }`. La cible est l'email CONFIRMÉ du compte du jeton, rien d'autre
  (aucun identifiant, email ni cible venus du navigateur) ; `cockpit_effacement_cibles` l'étend comme
  pour l'équipe.
- Même exécution que la carte du cockpit (`executerActionEffacement`, niveau 3, acteur
  `membre:mon-espace`) : mêmes refus (équipe, formateur, tarif réservé, cible trop large), même ordre
  (Stripe, base, Telegram). Un refus ou une panne : rien de nouveau n'est fait, le membre est invité à
  écrire au support.
- La photo de profil (bucket privé `avatars-membres`, `<uuid>/avatar`) est retirée après l'effacement,
  avec la clé de service. Sur le chemin de l'équipe (carte du cockpit), elle reste à retirer à la main
  tant que `executerActionEffacement` ne le fait pas.
- L'équipe reçoit le compte rendu complet par Agent AOK (ce qui reste à faire à la main compris) ; le
  membre reçoit le récapitulatif « À transmettre à la personne ».
- Garde-fou statique : `scripts/verifier-effacement.mjs` (« suppression par le membre »).

## 4. Comment on retrouve tout ce qui est à elle

Le serveur part des liens certains de la fiche d'une personne (même compte, rattachement, numéro posé à
la main, exemption, archive rapprochée « certain » ; jamais un lien par le nom). La base complète
(`cockpit_effacement_cibles`) :
- ses comptes Telegram donnent les emails qui leur sont liés (rattachement actif, accès broker ouvert par
  son lien personnel, tarif réservé) ;
- ses emails ouvrent ses comptes AOK (email du compte, ou email VÉRIFIÉ de `profile_emails`), dont les
  emails ouvrent ses fiches membres ;
- ses fiches ouvrent ses comptes Telegram (rattachement actif, numéro posé à la main) ;
- ses comptes Telegram et ses fiches ouvrent ses fiches d'archive (`tg_ids`, rattachement posé à la main,
  rapprochement « certain »).

## 5. L'inventaire, table par table

E = effacé, G = gardé, A = gardé sans identité (anonymisé), . = pas touché. Le pourquoi de chaque G et A
est dans la dernière colonne.

### 5.1 Groupes Telegram et noms

| Donnée | Table | Clé | N1 | N2 | N3 | Pourquoi |
|---|---|---|---|---|---|---|
| Messages relevés chaque matin (depuis le 30/08) | `cockpit_telegram_messages` | telegram_id | E | . | E | |
| Historique des noms | `cockpit_telegram_noms` | telegram_id | E | . | E | |
| Registre du groupe Live Club (présence, statut, nom) | `cockpit_telegram_membres` | telegram_id | A | . | E | N1 : la gestion du groupe a besoin du compte et de sa présence, plus de son nom (un trigger le garde vide) |
| Liste des comptes oubliés | `cockpit_telegram_oublis` | telegram_id | G (ajout) | . | G (ajout) | sans elle, la collecte du matin, le webhook et le bot réécrivent tout dans les 24 heures |
| Messages des AUTRES qui la citent ou transfèrent ses messages | `cockpit_telegram_messages` (texte, transfere_de) | aucun lien fiable | . | . | . | propos de tiers, introuvables sans fouiller le texte : résidu connu (section 8) |

### 5.2 Archive d'avant le 30/08 (huit ans de conversations)

| Donnée | Table | Clé | N1 | N2 | N3 | Pourquoi |
|---|---|---|---|---|---|---|
| Fiche d'archive (nom, alias, comptes, avatar, stats) | `cockpit_arch_personnes` | personne_id | E | . | E | |
| Paroles citées | `cockpit_arch_paroles` | personne_id | E | . | E | |
| Extraits de vie (famille, santé, argent) | `cockpit_arch_vies` | personne_id | E | . | E | |
| Dossier rédigé | `cockpit_arch_dossiers` | personne_id | E | . | E | |
| Thèmes dont elle parle | `cockpit_arch_dits` | personne_id | E | . | E | |
| Profils postés | `cockpit_arch_reseaux` | personne_id | E | . | E | |
| Présences dans les salons | `cockpit_arch_presences` | personne_id | E | . | E | |
| Qui a parlé avec qui | `cockpit_arch_echanges` | a, b | E | . | E | |
| Notes de l'équipe sur elle | `cockpit_arch_notes` | personne_id | E | . | E | elles font partie de son suivi |
| Propositions d'enquête | `cockpit_arch_propositions` | personne_id | E | . | E | |
| Rattachement membre vers archive posé à la main | `cockpit_membre_fonds_manuel` | personne_id, membre_id | E | . | E | |
| Liste des fiches d'archive oubliées | `cockpit_arch_oublis` | personne_id | G (ajout) | . | G (ajout) | sans elle, `push_fonds_supabase.py` la recréerait |
| Compteurs des salons (`cockpit_arch_salons`, `cockpit_arch_themes`) | | | . | . | . | agrégats, sans personne |

### 5.3 Bots (bot des membres sur Telegram, support du site et des apps)

| Donnée | Table | Clé | N1 | N2 | N3 | Pourquoi |
|---|---|---|---|---|---|---|
| Fils de conversation (membre, IA, équipe, gestes) | `"SupportThread"` | telegramId, userId (compte AOK ou `telegram:<id>`), contactEmail, membreId | . | E | E | |
| Mémoire de l'agent du bot (historique, action en attente) | `cockpit_liveclub_conversations` | telegram_id | . | E | E | |
| Coût de l'IA de ses échanges | `"AiUsage"` | userId (`liveclub:u<id>`, compte AOK) | . | A | A | dépense de la société : le coût reste, `userId` devient `efface` |

### 5.4 Live Club

| Donnée | Table | Clé | N1 | N2 | N3 | Pourquoi |
|---|---|---|---|---|---|---|
| Rattachements compte Telegram et abonnement | `cockpit_liveclub_rattachements` | telegram_id, membre_id, email | . | . | E | |
| Exemptions | `cockpit_liveclub_exemptions` | telegram_id, membre_id | . | . | E | |
| Journal des gestes du bot | `cockpit_liveclub_gestes` | telegram_id, membre_id | . | . | E | une ligne sans compte ni fiche (pause posée par l'agent, liée au seul abonnement) reste, avec l'abonnement |
| Codes de vérification et compteurs | `cockpit_liveclub_codes`, `cockpit_liveclub_codes_adresses` | telegram_id, email | . | . | E | |
| Liens personnels (jetons) | `cockpit_liveclub_jetons` | telegram_id, email | . | . | E | |
| Tarifs réservés | `cockpit_liveclub_tarifs_reserves` | email, telegram_id | . | . | E | une réservation en attente de paiement bloque le niveau 3 (lien encore actif chez Stripe) |
| Accès broker | `cockpit_liveclub_acces` | email, telegram_id | . | . | E ou A | lié à une commission : gardé (pièce de la recette), sans compte Telegram ni note, clos |
| Commissions du broker | `cockpit_commissions` | acces_id, email, client | . | . | G | recette de la société : pièce comptable |

### 5.5 Fiche membre (cockpit) et paiements

| Donnée | Table | Clé | N1 | N2 | N3 | Pourquoi |
|---|---|---|---|---|---|---|
| Fiche (nom, prénom, entrée, tier Skool, pseudo déclaré) | `cockpit_membres` | membre_id | . | . | E | |
| Emails | `cockpit_membre_emails` | membre_id | . | . | E | |
| Notes de l'équipe, avatar, statut ETM, accès posé à la main, actions traitées, contact posé à la main | `cockpit_membre_notes`, `cockpit_avatar_manuel`, `cockpit_statut_etm`, `cockpit_acces_manuel`, `cockpit_actions_traitees`, `cockpit_contact_manuel` | membre_id | . | . | E | |
| PAIEMENTS | `cockpit_paiements` | membre_id, puis payeur_nom et payeur_email | . | . | G | règle de Brice et pièces comptables (10 ans, Code de commerce L123-22 ; le RGPD, art. 17, laisse garder ce qu'une obligation légale impose). Le nom et l'email sont FIGÉS sur le paiement avant que la fiche disparaisse, `membre_id` passe à vide |
| Abonnements (statut, montants, échéances, client Stripe) | `cockpit_abonnements` | membre_id, client_stripe | . | . | G | historique des encaissements ; la collecte le réécrit chaque jour depuis Stripe, sans fiche |
| Liste des emails oubliés, HACHÉS | `cockpit_oublis_emails` | sha256 de l'email | . | . | G (ajout) | sans elle, un paiement ancien recréerait la fiche à la collecte suivante |

Nom figé : le nom de la fiche, sinon le prénom, sinon le nom du compte AOK ; email : l'email principal de
la fiche (l'email exact de chaque paiement reste chez Stripe). Sans aucun nom connu, la carte le dit et
seul l'email est figé.

### 5.6 Journal d'Études (tables Prisma, `userId` = l'uuid du compte AOK en texte, sans clé étrangère)

| Donnée | Table | N3 |
|---|---|---|
| Notes, et leurs blocs, étiquettes de notes, canevas (nœuds, liens, collections), annotations | `"Note"`, `"Message"`, `"MessageTag"`, `"NoteTag"`, `"Canvas"`, `"CanvasNode"`, `"CanvasEdge"`, `"CollectionNote"`, `"Annotation"` | E (cascades des notes et des canevas) |
| Étiquettes, dossiers, patterns, rituels, jeu ABC | `"Tag"`, `"Folder"`, `"Pattern"`, `"Ritual"`, `"AbcGame"` | E |
| Trades importés (Tradovate) | `"TradeImport"` | E |
| Plans du mentor, activité par jour | `"MentoratPlan"`, `"ActiviteJour"` | E |
| Accès mentor accordé à la main | `"MentoratGrant"` (par email) | E |
| Vocabulaire partagé des concepts | `"ConceptFiche"` | . (sans personne) |

N1 et N2 ne touchent pas au Journal.

### 5.7 Compte AOK, site, masterclass, académie

| Donnée | Table | Clé | N3 | Pourquoi |
|---|---|---|---|---|
| Compte de connexion | `auth.users` et ses cascades (section 6) | id | E | |
| Profil (nom, numéro client, rôle), emails du compte | `profiles`, `profile_emails` | id, profile_id | E | |
| Miroir Skool du site | `skool_members` | email, user_id | E | revient tant qu'elle est dans l'export Skool : la retirer de Skool (à la main) |
| Inscriptions masterclass, réponses au quiz | `masterclass_leads`, `quiz_reponses` | email | E | |
| Tentatives de connexion, journaux et sessions du site | `auth_attempts`, `auth_security_logs`, `auth_sessions` | email, user_id | E | |
| Anciennes tables du site (objectifs, progression, leçons perso, comptes prop firm, recherches) | `user_objectives`, `user_progress`, `lessons` (et `notes`), `propfirm_accounts` (et `account_alerts`, `account_costs`, `payouts`), `user_searches` | user_id | E | |
| Académie : progression | `academie_progression` | user_id | E | |
| Académie : accès offerts ou gratuits | `academie_acces` | user_id, email | E | |
| Académie : accès payé, ou renonciation au droit de rétractation | `academie_acces` | user_id, email | A | preuve d'achat et de la renonciation (contenu numérique) : la ligne reste, close, avec l'email, sans le compte |
| Académie : journal de lecture | `academie_lectures` | user_id (sans clé étrangère), ip | G | journal de preuve, conçu pour survivre à un compte supprimé (droit de rétractation) ; durée de conservation à fixer (ETAT, académie) |
| Compteur anti-abus du quiz | `quiz_reponses_debit` | empreinte | . | empreinte, quelques heures |

### 5.8 Jamais touché par un effacement

- Les agrégats sans personne : `cockpit_kpis`, `cockpit_metrics_monthly`, `cockpit_top_items`,
  `cockpit_snapshots`, `cockpit_notes`, `cockpit_releves_audience`, `cockpit_pouls_*`, `cockpit_chantiers`,
  `cockpit_decisions`, `cockpit_catalogue`, `cockpit_coupons`, `cockpit_offres`, `cockpit_ontologie_*`
  (12 nœuds « personne », tous de l'équipe), `cockpit_liveclub_resumes` (comptes et statuts seulement).
- L'équipe : `cockpit_allowlist`, `cockpit_telegram_comptes`, `cockpit_agent_cartes` (hors la carte
  d'effacement, vidée), `cockpit_agent_conversations`, `cockpit_demandes`.
- Les vues (`cockpit_membres_etat`, `cockpit_support_threads`, `cockpit_ia_usage`,
  `cockpit_activite_journal`...) suivent leurs tables.

## 6. Supprimer le compte AOK : les cascades

Lu en lecture seule le 15/10/2026 (`pg_constraint`), à relire si une table s'ajoute.

- `auth.users` supprime EN CASCADE : `auth.identities`, `auth.sessions` (et `auth.refresh_tokens`,
  `auth.mfa_amr_claims`), `auth.mfa_factors` (et `auth.mfa_challenges`), `auth.mfa_recovery_code_sets` (et
  `auth.mfa_recovery_codes`), `auth.one_time_tokens`, `auth.oauth_authorizations`, `auth.oauth_consents`,
  `auth.webauthn_challenges`, `auth.webauthn_credentials` ; `public.profiles` (et `public.profile_emails`),
  `public.cockpit_allowlist`, `public.lessons` (et `public.notes`), `public.propfirm_accounts` (et
  `account_alerts`, `account_costs`, `payouts`), `public.user_searches`.
- Passent à VIDE : `auth.scim_users.user_id`, `public.skool_members.user_id` (la ligne resterait : elle est
  effacée par email).
- BLOQUENT la suppression s'il y a des lignes (pas de cascade) : `public.auth_sessions.user_id`,
  `public.auth_security_logs.user_id`, et par `profiles` : `public.user_objectives`, `public.user_progress`,
  `public.courses.instructor_id`. `cockpit_effacer` efface les quatre premières avant le compte, et refuse
  un formateur.
- SANS clé étrangère (effacées une par une, sinon elles resteraient) : toutes les tables Prisma du Journal
  et de l'IA (`userId` texte), `academie_*`, `"SupportThread"`.
- Stockage Supabase : aucun objet n'a de propriétaire (`public-asset` 318, `extension-images` 1 494, lu le
  15/10) : rien à faire.
- Suppression par SQL (rôle postgres, droit DELETE sur `auth.users` vérifié) : sessions et jetons de
  rafraîchissement disparaissent, un jeton d'accès déjà émis reste valable jusqu'à son expiration (une
  heure environ).

`cockpit_membres` : CASCADE vers `cockpit_membre_emails`, `cockpit_acces_manuel`,
`cockpit_actions_traitees`, `cockpit_contact_manuel`, `cockpit_membre_fonds_manuel` ; VIDE pour
`cockpit_paiements`, `cockpit_abonnements`, `cockpit_arch_personnes` ; aucune clé pour
`cockpit_avatar_manuel`, `cockpit_statut_etm`, `cockpit_membre_notes`, `cockpit_liveclub_*`,
`"SupportThread"."membreId"`. Un trigger (BEFORE DELETE) fige le payeur des paiements de toute fiche
supprimée, quel que soit le chemin (effacement, `cockpit_oublier_membre`, fusion, purge des fantômes).

`cockpit_arch_personnes` : CASCADE vers `dits`, `dossiers`, `echanges` (a et b), `notes`, `paroles`,
`presences`, `propositions`, `reseaux`, `vies`, `cockpit_membre_fonds_manuel`.

## 7. Ce qui vit hors de notre base

| Où | Ce qu'il y a | Niveau 3 |
|---|---|---|
| Stripe (comptes melanie et aoknowledge) | client, paiements, factures, abonnements | on n'y touche pas (Brice). L'abonnement Live Club est arrêté à la fin de la période payée (`programmerArret`), relu en direct. Un abonnement hors Live Club (compte aoknowledge) ou impayé (`unpaid`) : à arrêter au Dashboard, la carte le dit |
| Telegram | ses messages dans les groupes, sa conversation avec le bot | sortie du groupe sans ban (`retirerDuLiveClub`). Ses messages : c'est elle qui les supprime |
| Kit | abonné à la newsletter (masterclass, site) | à supprimer à la main (Brice ou Didier), la carte le rappelle |
| Skool | membre de la communauté | à retirer à la main (pas d'API) |
| PayPal | transactions | gardées chez PayPal ; l'export local reste la source comptable |
| Resend | historique des emails envoyés (destinataire) | durée de Resend, rien à faire chez nous |
| Vercel, Sentry | journaux techniques (identifiants tronqués, parfois un numéro Telegram) | rétention courte de l'hébergeur |
| Anthropic | les échanges envoyés au modèle | politique de rétention de l'API |
| Metricgram (ancien bot) | ses propres données sur le groupe | hors de notre main |
| Navigateur de la personne | Carnet du Trader (stockage local de l'extension), Pilotage (localStorage) | à elle de désinstaller ou vider ; le compte supprimé, l'extension ne synchronise plus |
| Disque de Brice | exports de collecte (Stripe, PayPal, Skool : `platforms/revenue/raw`, `community_members.csv`), export brut de l'archive Telegram (`platforms/telegram/exports/2026-08-31`, `Audit Communautaire/Aout/Telegram extraction`), `registre-identites.md` | sources des collectes : les filtres (section 9) empêchent le retour en base ; les fichiers eux-mêmes restent, à traiter à la main si la demande le couvre |

## 8. Résidus connus (on le sait, on le dit)

- Les conversations de l'équipe avec l'agent (`cockpit_agent_conversations`, la fenêtre du cockpit) :
  texte libre, peuvent contenir son nom et ce que `fiche_personne` a montré. Historique borné, non fouillé.
- `cockpit_demandes` : texte libre de l'équipe.
- Les messages et extraits d'archive d'AUTRES personnes qui la citent.
- Les résumés du matin déjà envoyés à l'équipe dans Agent AOK.
- Les listes d'oubli (numéros Telegram, fiches d'archive, emails hachés) : gardées exprès, sinon
  l'effacement serait défait par la collecte suivante.

## 9. Empêcher le retour (filtres en base, quel que soit l'écrivain)

| Filtre | Table | Effet |
|---|---|---|
| `cockpit_telegram_filtrer_oublis` (20261015200000) | `cockpit_telegram_messages`, `cockpit_telegram_noms` | aucune nouvelle ligne d'un compte oublié |
| `cockpit_telegram_membres_sans_nom` | `cockpit_telegram_membres` | le registre garde le compte, jamais son nom |
| `cockpit_arch_personnes_filtrer_oublis`, `cockpit_arch_filtrer_oublis` | `cockpit_arch_personnes`, `cockpit_arch_presences` | ni la fiche d'archive ni ses présences ne reviennent (`push_vies_supabase.py` ne pousse que pour les fiches en base) |
| `cockpit_membre_emails_filtrer_oublis` | `cockpit_membre_emails` | aucun email oublié ne se rattache |
| `push_membres_supabase.py` (lit `cockpit_oublis_emails`) | `cockpit_membres`, `cockpit_paiements`, `cockpit_abonnements` | aucune fiche recréée ; ses paiements partent sans fiche avec le payeur ; liste illisible = le passage s'arrête |
| `cockpit_paiements_garder_payeur` | `cockpit_paiements` | un payeur figé ne change plus |

Revenir sur un oubli (la personne revient et le demande) : supprimer sa ligne de `cockpit_telegram_oublis`,
`cockpit_arch_oublis` ou `cockpit_oublis_emails` (calcul du hache : `public.cockpit_hash_email(email)`).
Ce qui a été effacé ne revient pas tout seul. La collecte signale (en nombre) un paiement postérieur à un
effacement : la personne est peut-être revenue.

## 10. Fonctions (rôle postgres seulement, appelées par le serveur du journal)

- `cockpit_effacement_cibles(tg, membres, emails, archives)` : les cibles complètes.
- `cockpit_effacement_apercu(niveau, tg, membres, emails, archives)` : STABLE, compte ce que le niveau
  effacerait, plus le gardé, l'anonymisé, l'externe (abonnements, présence dans le groupe), les refus et
  les alertes. Mêmes clés que `cockpit_effacer` (vérifié par `scripts/verifier-effacement.mjs`).
- `cockpit_effacer(niveau, tg, membres, emails, archives, acteur)` : une transaction, journal dans
  `cockpit_effacements`, rend des comptes.
- `cockpit_figer_payeur(membres, comptes)`, `cockpit_oublier_membre(membre)` (corrigée : elle détachait
  les paiements sans nom), `cockpit_hash_email(email)`.

## 11. Aperçu sur une vraie personne (lecture seule, 15/10/2026)

Compte Telegram de test d'Adil, u8600818154 (`scripts/apercu-effacement.mjs`, migration pas appliquée :
SQL de la migration joué en ligne en transaction READ ONLY). Cibles : 1 compte Telegram, 1 email (par
son rattachement et son accès broker), aucune fiche membre, aucun compte AOK, aucune fiche d'archive.

- Niveau 1 : rien à effacer en messages ou noms (0 sur 13 tables), 1 nom du registre à vider.
- Niveau 2 : 1 mémoire du bot, 0 fil Support, 0 ligne de coût IA.
- Niveau 3 : 1 rattachement, 4 gestes du bot, 1 lien personnel, 1 accès broker, 1 ligne du registre,
  1 mémoire du bot ; 0 paiement, 0 abonnement, 0 commission ; pas dans le groupe ; aucun refus.
- Les 70 ordres d'écriture de `cockpit_effacer` passent EXPLAIN (jamais exécutés) contre la vraie base ;
  3 sautés (objets créés par la migration elle-même).
