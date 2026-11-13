# ETAT du journal d etudes

## SALON DE L'ACADEMIE : LES NOMS ET LA SIGNATURE DE L'EQUIPE (13/11/2026, correctif, commite NON pousse, branche chat-noms depuis origin/master 4491b52 ; migration 20261113120000 ECRITE NON appliquee)

- Brief : D:\7_Agents\briefs\2026-11-13-chat-noms-signature.md (cartes chat-academie-noms et chat-academie-signature : A, A).
  Rapport : chat-noms-rapport.md (notes de Yume Orchestre).
- Noms : « Hugo R. » (premier mot du prenom, initiale du nom) pour TOUT auteur et pour tout compte connecte, gratuit
  compris ; « Membre 1204 » sans prenom utilisable (aucun, sans lettre, arobase, repli « Membre », prenom tire de l'email
  par handle_new_user). Jamais le nom complet ni l'adresse mail. nom_affiche n'est pas lu. Le classement et l'annuaire
  gardent leur regle.
- Equipe : auteur.nom = le prenom du compte qui ecrit, numero null ; le site signe « Brice · Équipe AOK » (avatar AO
  inchange) ; nomAffiche (alerte) suit la meme forme.
- Le nom est fait EN BASE (aok_chat_nom_court, appelee par aok_chat_auteur) parce que le direct part de la base sans
  repasser par le journal : sans la migration, rien ne change a l'ecran. Ici, seulement lireAuteur (l'equipe garde son
  prenom) et nomAffiche. Ordre de mise en ligne indifferent (chaque cote lit l'ancienne et la nouvelle forme).
- Essai : node --env-file=.env.local scripts/essayer-migration-chat-noms.mjs (transaction annulee ; AOK_WORKSPACE en
  worktree) : PAS LANCE le 13/11 (lecture de la base de prod refusee au codeur). A lancer avant d'appliquer.
- Liste « Comptes sans parole » de l'equipe (SQL_SANS_PAROLE) : inchangee (nom_affiche ou prenom et nom).

## CLOCHE ET RECHERCHE DANS LES LECONS : /api/academie/cloche ET /api/academie/recherche (13/11/2026, FEATURE, commite NON pousse, branche academie-cloche-recherche depuis academie-navigation 9b10de7 ; AUCUNE migration)

- Brief : D:\7_Agents\briefs\2026-11-13-cloche-et-recherche.md. Rapport : cloche-recherche-rapport.md (notes de Yume
  Orchestre). Le site : branche academie-cloche-recherche du workspace (ETAT du site). Pousser le journal AVANT le site.
- CLOCHE (src/lib/academie/cloche.ts, pur, n'importe rien ; route src/app/api/academie/cloche/route.ts) : SANS TABLE.
  Les notifications se calculent sur 30 jours : billets du cockpit (lecon et module publies), messages du salon qui
  repondent a un message du compte (autre auteur, non masques, lus par aok_chat_vue au niveau du lecteur), questions
  du compte sous une lecon repondues (publiee ou privee). Lu : annonce = academie_billets_vus (la table de la page
  Annonces et du pop-up) ; reponse = user_metadata.aok_cloche = { lu_le, lues } du compte Supabase (comme
  aok_accueil_vu_le du site), relue fraiche par getUser et ecrite avec le jeton du compte lui-meme (PUT /auth/v1/user,
  jamais de cle de service) ; lues = 40 cles courtes au plus (c|q + 12 chiffres), gardees seulement si la reponse est
  encore dans la fenetre. GET : { non_lues, notifications: [{ cle, type, le, titre, extrait, qui, lien, lue }] } ;
  POST { lues: [...] } ou { tout: true }. Aucun email ni push.
- RECHERCHE (src/lib/academie/recherche.ts, pur ; route src/app/api/academie/recherche/route.ts) : GET ?q=, jeton
  facultatif (sans : droitsVisiteur). Lecons lisibles (lecon et module publies) : titre, titre et resume du module,
  texte (Markdown en texte brut). Chaque mot (sans accents, sans mots vides) dans le titre, le texte ou le titre du
  module, un au moins dans le titre ou le texte. Extrait SEULEMENT si ouvertureLecon dit 'ouvert' (visiteur : apercu
  seulement) ; une lecon fermee sort avec son titre et acces 'ferme', sans extrait. 60 lecons, 8 par module au plus.
  Caches par instance : droits 2 min, textes 5 min (965 lecons, 477 textes, 1 Mo, indexes en moins de 100 ms ; une
  recherche en 1 a 6 ms). Les logs ne disent jamais la recherche.
- Verifie : scripts/verifier-cloche-recherche.mjs (15 blocs, pur) ; scripts/essayer-cloche-recherche.mjs contre la
  vraie base (18 etapes ok le 13/11 : requetes de la cloche en transaction ANNULEE avec messages, questions et billet de
  test, aok_chat_diffuser neutralisee le temps de la transaction, rien n'est reste ; recherche en lecture seule, aucun
  extrait quand tout est ferme). tsc et eslint ok.

## QUIZ DE FIN DE MODULE : /api/academie/quiz ET LE CHAMP « quiz » DU CATALOGUE (13/11/2026, FEATURE, commite NON pousse, branche academie-quiz-suite depuis academie-navigation 9b10de7 ; migration 20261113231500 du workspace ECRITE NON appliquee)

- Brief : D:\7_Agents\briefs\2026-11-13-quiz-et-module-suivant.md (inventaire B9). Rapport : quiz-module-suivant-rapport.md
  (notes de Yume Orchestre). Le site : branche academie-quiz-suite du workspace (ecran « Fin du module », ETAT du site).
- Les questions vivent dans le fichier du module (D:\6_Societe\Pilotage\Academie\catalogue\modules\<slug>.json, champ
  « quiz » : version, statut brouillon|publie, note, questions { id, question, lecon, choix, bonne, explication }),
  recopiees dans academie_modules.quiz. Deux quiz BROUILLONS (a relire par Brice) : novice-en-trading et
  les-bases-smart-money, 7 questions chacun. Brouillon = montre a l'equipe seulement, jamais garde.
- Code sans import : src/lib/academie/quiz-academie.ts (lireQuiz, vueQuiz sans la reponse, corriger, droitAuQuiz, et
  les requetes : quizDuModule, dernierResultat, envoisSurUneHeure, noterResultat ; avant la migration : pas de quiz,
  rien de garde, aucune erreur). Route GET ?module= et POST { module, version, reponses } : jeton, module publie, droit
  sur le module (meme regle que /moi, pas seulement apercu ou billet du jour), correction au serveur, 30 envois par
  heure, 409 si la version a change. Table academie_quiz_resultats (un membre lit les siens, l'equipe tout, aucune
  ecriture directe).
- Import : importer-catalogue-academie.mjs lit le champ « quiz » (verifie AVANT toute ecriture ; sans la colonne, le
  module s'importe et le quiz attend, avertissement ; un fichier sans le champ ne touche pas a la colonne).
  scripts/importer-quiz-academie.mjs pose SEULEMENT le quiz (essai a blanc par defaut, --ecrire sur le go de Brice).
- ESSAYE le 13/11 en transaction annulee : scripts/essayer-migration-quiz-academie.mjs, 18 etapes ok (avant la
  migration, migration jouee deux fois, import du vrai fichier Novice avec son quiz, resultats, lectures rejouees sous
  authenticated et anon, contraintes, rien de reste). Test pur : scripts/verifier-quiz-academie.mjs (9 blocs).
- Mise en ligne (chaque geste sur le go de Brice) : migration, verifier:rls, push du journal AVANT le site, puis
  importer-quiz-academie.mjs --ecrire sur les deux fichiers ; publier = statut « publie » dans le fichier apres
  relecture par Brice, puis relancer le script.

## ANNONCES DE L'ACADEMIE : /api/academie/annonces ET L'IMPORT DES 75 ANNONCES SKOOL (13/11/2026, FEATURE, commite NON pousse, branche academie-navigation depuis origin/master 4491b52 ; migration 20261113160000 du workspace ECRITE NON appliquee)

- Brief : D:\7_Agents\briefs\2026-11-13-academie-accueil-navigation.md (Brice, 13/11 : « Billets » devient « Annonces »,
  une vraie page, « recuperer les annonces de School pour les mettre ici »). Rapport : academie-navigation-rapport.md
  (notes de Yume Orchestre). Le site : branche academie-navigation du workspace (ETAT du site).
- Le stockage ne change pas : une annonce EST un billet (billets.ts : lecon + academie_billets). La migration ajoute
  origine ('cockpit' | 'skool'), source (unique, cle d'import), categorie, epingle_le, et le module d'archive
  « annonces-skool » (statut archive, jamais dans le catalogue).
- Route GET /api/academie/annonces (tout compte connecte) : billets du cockpit publies + annonces Skool, les plus
  recentes d'abord ; non_lue = billet du cockpit de moins de 30 jours absent de academie_billets_vus (une annonce
  Skool n'est jamais non lue) ; ?resume=1 = nombre de non lues et derniere annonce (barre et accueil). POST
  { vues } = note vues (100 au plus ; le pop-up du billet du jour ne revient pas). Avant la migration : billets du
  cockpit seulement (colonnes absentes, repli sans erreur). Code pur sans import : src/lib/academie/annonces.ts.
- Import : scripts/importer-annonces-skool.mjs (cockpit_annonces_envoyees canal skool + export Skool pour slug et
  pieces jointes ; categorie par categorieDe ; publication_faite_le = date Skool : ni pop-up ni ligne de plus dans
  cockpit_annonces_envoyees). ESSAYE le 13/11 en transaction annulee : 15 etapes ok (migration jouee deux fois,
  75 creees, 66 images, 2 PDF, rejouable, rien de reste). --ecrire seulement sur le go de Brice, APRES la migration
  et la mise en ligne des images (--images-base). Test pur : scripts/verifier-annonces.mjs (6 blocs).
- v2 du 13/11 (relecture de Brice) : ?resume=1 rend aussi dernieres (les 3 dernieres annonces, titres et dates),
  montrees dans la barre de gauche du site sous ANNONCES.
- Mise en ligne : migration, images, import --ecrire, push du journal, PUIS push du site (sans la route, la page
  du site lit une 404 sans CORS et dit « reseau »).

## CALENDRIER DES LIVES : POST /api/academie/lives ET /api/cockpit/lives (13/11/2026, FEATURE commitee NON poussee, branche academie-lives depuis origin/master 4491b52 ; migration du workspace 20261113200000 ECRITE NON appliquee)

- Brief : D:\7_Agents\briefs\2026-11-13-calendrier-des-lives.md ; rapport : calendrier-des-lives-rapport.md (notes de
  Yume Orchestre). Skool ferme le 16/11 et son calendrier avec lui (inventaire A5).
- Logique pure et requetes : src/lib/academie/lives.ts. Les series (lives de Brice, mardi et jeudi 20 h de Paris) sont
  depliees par la base (aok_lives_entre, heure de Paris, changement d'heure juste) ; une date annulee, deplacee, son lien
  ou son titre = une exception (serie_id + date_serie), la serie n'est jamais cassee. Ponctuels = lives partenaires.
- REGLE DU LIEN (reco a Brice, construite dessus) : liste lisible par tous, connecte ou non ; le lien ne part qu'a un
  compte qui y a droit selon le niveau du live (tous, programme, live_club = Live Club actif, ETM, VIP, equipe :
  lecteurDe, depuis droitsAcademie et aok_annuaire_acces) et seulement de 30 min avant le debut jusqu'a la fin
  (etatLien). Stripe illisible : etat 'inconnu', jamais un faux non.
- /api/academie/lives : chemin public EXACT dans middleware.ts (sans jeton : la liste, aucun lien ; jeton refuse : 401).
  /api/cockpit/lives : cockpit_allowlist, gestes lister, creer/modifier/arreter/supprimer_serie, creer/modifier/
  supprimer_live, et sur une date lien, annuler, retablir, deplacer (null = horaire de la serie), texte_date.
- Verifs : scripts/verifier-lives.mjs (12 blocs), scripts/essayer-migration-lives.mjs (46 etapes, transaction annulee,
  rien n'est reste), tsc, eslint, build ; verifier:rls = les 2 alertes connues.
- Ordre de mise en ligne : migration (appliquer-migration.sh 20261113200000_academie_lives.sql), verifier:rls, journal,
  puis site et cockpit. Avant la migration, la page dit « le calendrier arrive bientot » et l'onglet du cockpit « a brancher ».

## EMAIL A TOUS LES MEMBRES DEPUIS LE COCKPIT (13/11/2026, commite NON pousse, branche email-a-tous depuis origin/master 4491b52 ; migration 20261113210000 du workspace (renommee a la fusion academie-lundi, 20261113200000 etant pris par le calendrier) ECRITE, essayee en bloc annule, NON appliquee)

- Brief D:\7_Agents\briefs\2026-11-13-email-a-tous-cockpit.md (inventaire H2, PASS B5) : Skool ferme le 16/11 et emporte son email a tous. Rapport : email-a-tous-rapport.md (notes de la conversation local_8f8ccb0c).
- Code : src/lib/academie/emails-annonces.ts (PUR, n'importe que node:crypto : groupes, rendu, jeton, garde, droits, requetes, envoyeur de simulation), emails-annonces-serveur.ts (base, Resend batch), POST /api/cockpit/academie/emails (etat, apercu, essai, envoyer, reprendre, detail ; allowlist), GET/POST /api/academie/emails/desinscription (publique en chemin exact dans middleware.ts, jeton signe = id de la ligne, jamais l'adresse).
- SIMULATION PAR DEFAUT : rien ne part tant que ANNONCES_EMAIL_MODE ne vaut pas exactement « reel » (essais compris) ; lignes notees « simule », email ecrit dans le journal du serveur (texte, lien personnel remplace, aucune adresse).
- Groupes (base, 13/11) : tous 301, comptes 78, programmes 118 (avec ou sans compte), gratuits 24, sans_compte 223. Statut d'un compte = aok_annuaire_acces ; adresses sans compte = acces actif pose par email, puis invitation de Skool envoyee.
- Regles : HTML du texte echappe, aucun lien du texte cliquable (desamorces), seuls le bouton (https://aoknowledge.com/...) et la desinscription sont des liens ; List-Unsubscribe en un clic ; garde un envoi reel par 72 h par transport (forcage : admin ET acces_perso = Brice seul) ; envoi reel : profiles.role = admin (pas le compte de Tab) ; confirmation = le nombre exact (409 sinon) ; billet publie exige ; un envoi reel s'inscrit dans cockpit_annonces_envoyees (canal email, source email-academie:<id>).
- Verifs : node scripts/verifier-emails-annonces.mjs (17 blocs ok) ; node scripts/essayer-email-annonce.mjs --sortie <dossier> (rendu local, aucune base) ; scripts/essayer-migration-emails-annonces.mjs (bloc DO termine par une exception : migration deux fois, requetes exactes, ESSAI_OK le 13/11 par l'outil SQL de Supabase, tables absentes apres) ; tsc --noEmit ok.
- AVANT LA MISE EN LIGNE (go de Brice) : appliquer la migration, choisir le plan Resend (gratuit = 100 par jour partages), poser ANNONCES_EMAIL_MODE=reel (et au besoin RESEND_API_KEY_ANNONCES, ANNONCES_FROM_EMAIL), pousser journal puis cockpit.

## SALON DE L'ACADEMIE : L'ALERTE A L'EQUIPE PAR AGENT AOK (12/11/2026 soir, commite NON pousse, branche chat-academie-alerte depuis origin/master 3830ac1 ; AUCUNE migration)

- Brice, chat de l'orchestre : « Les questions remonte par les agent aok de moi et Mel ? ». Rapport : chat-academie-rapport.md,
  section « Suite du 12/11 soir » (notes de Yume Orchestre).
- Chaque nouveau message d'un compte qui n'est PAS de l'equipe (reponses comprises) part en prive aux comptes
  diffusion = 'equipe' de cockpit_telegram_comptes (Brice, Melanie) par alerterEquipeTexte (pas de nouveau bot ni de
  cle ; sans support: true, donc pas Adil). Texte : « Nouvelle question dans le salon de l'académie », « De : <nom du
  salon> (<statut>) », l'extrait (300 caracteres au plus), « Texte caché retiré à l'envoi. » si marque, le lien
  https://aoknowledge.com/academie/chat. Texte brut, aucun parse_mode, apercu coupe ; les adresses du membre
  desamorcees (« https[:]//x.fr ») ; le message passe par l'analyse de securite au niveau 'injection' (il entre dans
  l'historique d'Agent AOK) ; ni email ni identifiant de compte.
- Jamais bloquant : la route l'envoie APRES la reponse au membre (after de Next), attente bornee a 4 s
  (chat-academie-envois.ts), erreur journalisee sans le texte. Garde contre les rafales SANS table : l'alerte ne part que
  si l'auteur n'a ecrit aucun autre message dans les 10 minutes d'avant (SQL_ALERTE_PERMISE ; de deux envois simultanes,
  seul le premier). Une conversation suivie (un message toutes les 9 minutes) ne donne qu'une alerte, au debut.
- Verifs : verifier-chat-academie.mjs (13 blocs : texte, extrait, echappement, rafale) ;
  `node --env-file=.env.local scripts/essayer-alerte-chat-academie.mjs` (requete compilee sur la vraie table en lecture
  seule, logique sur une table temporaire dans une transaction annulee : 3 etapes ok le 12/11).
- Mise en ligne : push du journal seul (le site n'en depend pas). A verifier au premier message d'un membre : l'alerte
  arrive chez Brice et Melanie, une seule par rafale.

## SALON « QUESTIONS DE L'ACADEMIE » : POST /api/academie/chat (12/11/2026, EN LIGNE le 12/11 au soir sur le go de Brice : journal 3830ac1, migration 20261112210000 appliquee)

- Brief : D:\7_Agents\briefs\2026-11-12-chat-academie.md ; rapport : chat-academie-rapport.md (notes de Yume Orchestre).
  Page du site : /academie/chat (ETAT du site, section du 12/11).
- Route POST /api/academie/chat (Bearer du site, CORS academie, tout compte connecte) : lire (50 derniers, ou 50 d'avant
  le message `avant`), envoyer, pouce, et pour l'equipe (statut lu en base, profiles.role admin) masquer, couper, rendre.
  Refus en clair (message) : 429 quota (« Tu as ecrit tes 20 messages d'aujourd'hui. Les membres d'un programme en ont
  200. »), 403 parole, 404, 503 code migration. La route dit au site le sujet du direct (academie-chat:programme ou :gratuit).
- Code : src/lib/academie/chat-academie.ts (sans import : quota 20 ou 200 selon aok_annuaire_acces, nettoyage,
  marque du texte cache pour l'equipe via securite/injection-pur.ts, lecture du corps, refus, vueMessage qui ne garde que
  les champs prevus, SQL) ; la route src/app/api/academie/chat/route.ts. Le quota se compte en base (aok_chat_poser, verrou
  consultatif par compte, jour de Paris). Les messages sont des DONNEES : si un bot lit un jour ce salon, il les lit comme
  du texte cite (commentaire a l'endroit ou le serveur les rend).
- Verifs : `node scripts/verifier-chat-academie.mjs` (9 blocs, AOK_WORKSPACE dans un worktree) ;
  `node --env-file=.env.local scripts/essayer-migration-chat-academie.mjs` (transaction annulee, 25 etapes ok le 12/11,
  7,7 s du begin au rollback : migration rejouee, gestes, quota, verrou prouve par une seconde connexion, lectures et
  ecritures refusees en anon et authenticated, policy du direct). NE PAS le rejouer apres la migration (il refuse).
- ORDRE DE MISE EN LIGNE : migration, verifier:rls, ce journal, puis le site (sans la migration : 503 code migration,
  le site dit « Le salon ouvre bientot »).

## AGENT AOK, DEPOT EN DOLLARS : PALLIATIF EN ATTENDANT LA DECISION DE BRICE (12/11/2026, correctif ; branche agent-cockpit-dollars depuis origin/master 9a3d296 ; AUCUNE migration)

- Echange de Melanie du 12/11 (depot RaiseFx de 721 USD, commission 650 USD) : l'agent a redemande les euros deux fois puis
  refuse de convertir ; Melanie a converti a la main (650,93 et 586,48 EUR inscrits, les dollars perdus). Brice : « Il refuse
  de prendre les info en dollars ». Cause : la consigne du 31/10 « LES MONTANTS SONT EN EUROS » et le modele sans devise
  (cockpit_commissions n'a aucune colonne devise ; 70/30, Repartition et Revenus du cockpit en euros).
- Palliatif (consigne seulement) : une seule question pour les euros de TOUS les montants en dollars (depot ET commission),
  une ligne sans explication si on demande de convertir, les dollars donnes gardes dans note (« 721 USD, commission 650 USD »).
  Descriptions montant et note de proposer_depot_broker et proposer_pause_depot. verifier-suivi-lots.mjs suit le texte.
- Eval : scripts/eval-depot-dollars.mjs D1|D2|D3 (un cas par lancement, essai) : D1 une demande, sans taux ; D2 carte
  depot_broker 650,93 / 586,48 / 5 mois, note « 721 USD, commission 650 USD » ; D3 une ligne. Les trois ok le 12/11.
- EN ATTENTE DE BRICE : garder les dollars en dollars (colonne devise sur cockpit_commissions et cockpit_partenaire_taux,
  journal ET cockpit). Options et plan : D:\6_Societe\Pilotage\Data-Performance\agent-cockpit\rapport-2026-11-12.md.
- Constat : le depot du 12/11 est stocke 650.9299999999999 (nombre JS a virgule passe a ::numeric) ; invisible a l'ecran,
  a corriger dans le chantier devise (montants passes en texte a 2 decimales).

## CARNET PREMIUM RECONNU PAR LE COMPTE (client_reference_id) ; MAIL DU SOUTIEN : MON ESPACE A LE PORTAIL (12/11/2026, correctif ; branche carnet-client-reference depuis origin/master e36d895 ; AUCUNE migration ; Stripe lu seulement)

- Brief : D:\7_Agents\briefs\2026-11-12-correctif-payment-link-carnet.md (trouve par l'Orchestre Prix). Avant :
  checkMentoratAccess ne reconnaissait le Carnet Premium que par l'email du client Stripe. Le lien de paiement de
  l'extension pre-remplit l'email du compte, mais l'acheteur peut le changer dans Stripe : il payait sans l'acces. Le
  client_reference_id (uuid du compte, pose par l'extension, offres.ts lienPaiement) n'etait lu nulle part.
- Correction (src/lib/carnet-premium-pur.ts, branche dans entitlements.ts hasCarnetPremium(userId, email)) : le compte
  d'abord, l'email en repli, comme Pilotage (lireSessionPilotage : client_reference_id puis email). Pilotage ecrit le
  droit en base au webhook ; le Carnet n'a pas de table de droits, donc sans migration : les sessions TERMINEES des deux
  liens de paiement (plink_1U9QKN... mensuel, plink_1UAR2D... annuel, LIENS_PAIEMENT_CARNET) sont lues chez Stripe et
  rangees par compte dans la memoire de l'instance (creerIndexReferences : tout a la premiere lecture, puis au plus une
  fois par minute les sessions creees depuis la derniere lecture reussie moins 25 h). L'abonnement du client trouve est
  relu a chaque verification (actif, essai, impaye en relance, produit du Carnet), exactement comme par email.
- Cles : les sessions avec STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE, sinon la chaine de clePilotage (recopiee : l'importer
  bouclait par academie/droits), sinon STRIPE_KEY_CARNET_AOK ; clients et abonnements avec STRIPE_KEY_CARNET_AOK comme
  avant. Une cle sans droit sur les sessions (400, 401, 403) = signale une fois dans les journaux
  (« Stripe checkout/sessions a repondu ... »), l'email decide comme avant, le cache des « non » reste. Une panne
  passagere (reseau, 429, 5xx, delai) = reponse pas sure, le « non » n'est pas garde.
- Duo et soutien : le Duo passe par Pilotage (session du serveur, client_reference_id du jeton, droit academie_acces lu
  par user_id OU email) : deja reconnu par le compte. Le soutien du Carnet et d'AOKnowledge : sessions creees par le
  serveur avec customer_email (adresse du compte, imposee a Checkout) ; elles n'ouvrent aucun acces (le soutien n'est
  propose que quand tout est compris) ; badge et portail lus par email, coherent avec ces sessions.
- Rattrapage (Stripe, lecture seule, 12/11) : aucun abonnement Carnet Premium n'a jamais existe sur les deux prix
  (status=all : 0 et 0) ; une seule session de lien de paiement, expiree sans paiement. Personne a rattraper.
- Mail du soutien (mails-achat-pur.ts, modeleSoutien) : la phrase d'arret dit maintenant « Tu arretes quand tu veux, en
  un clic, depuis Mon espace, rubrique Achats : « Gerer mon abonnement ». », puis le chemin de l'app en second
  (« C'est aussi possible depuis ... ») et le lien du portail s'il est pose. Le commentaire « Mon espace n'a pas de lien
  vers le portail » est retire.
- Verifs : node scripts/verifier-carnet-reference.mjs (10 blocs, faux Stripe, dont email different + client_reference_id
  = acces ouvert), verifier-mails-achat (13), verifier-soutien (15), verifier-soutien-aok (11),
  verifier-portail-abonnements (9), verifier-effacement (21), tsc, eslint des fichiers touches, next build.
  verifier-pilotage-paliers echoue DEJA sur origin/master (assertion du middleware), son bloc Duo passe.
- Limites : la portee Mon espace > Achats (portail) et le badge lisent toujours le Carnet par email (abonnementCarnetDe) :
  un acheteur par lien de paiement qui a change d'email a l'acces, mais ne voit pas cet abonnement dans « Mes
  abonnements » (il le gere par le lien de connexion du portail Stripe ou le recu). L'index vit par instance : une
  instance neuve relit tout (aujourd'hui une session). Le cache des « non » (5 min par email) inchange. Piste cote
  extension (non touchee ici, un autre chantier y travaille) : locked_prefilled_email au lieu de prefilled_email
  verrouille l'adresse sur le lien de paiement (documentation Stripe des Payment Links).
- Mise en ligne : non verifie en vrai qu'une cle des sessions est posee en prod avec Checkout Sessions en lecture ; sinon
  le journal Vercel montre « Stripe checkout/sessions a repondu 403 » et seul l'email reconnait (comme avant).

## GERER MON ABONNEMENT DEPUIS MON ESPACE : /api/compte/portail (12/11/2026, correctif ; branche portail-abonnement depuis origin/master 56cbeaf ; AUCUNE migration ; RIEN cree dans Stripe)

- Brief : D:\7_Agents\briefs\2026-11-12-correctifs-lier-abonnement.md (partie 2). Le site : branche
  site-portail-abonnement du workspace (carte « Mes abonnements » de Mon espace > Achats). Ordre : le journal d'abord.
- Avant : aucune route ne rendait le portail client Stripe a Mon espace (seulement /api/pilotage/niveau pour Pilotage,
  /api/carnet/soutien et /api/academie/soutien pour un soutien). Le mail de remerciement le disait (« Mon espace n'a pas
  le portail Stripe »).
- GET /api/compte/portail (Bearer du site, CORS de l'academie) : les abonnements EN COURS du compte AOKnowledge, ranges
  par client Stripe (un portail ne montre que les abonnements d'UN client ; deux Checkout = souvent deux clients) :
  { ok, abonnements: [{ client: 'cus_...', abonnements: ['Pilotage Premium', 'Carnet Premium'] }], incomplet }.
  Sources, aucune neuve : academie_acces (Pilotage, Duo) relu chez Stripe avec la cle de Pilotage ; abonnementCarnetDe
  (Carnet Premium et son soutien) ; abonnementAokDe (soutien AOKnowledge) ; jusqu'a 3 adresses confirmees du compte
  (SQL_IDENTITE), chaque lecture bornee a 6 s ; une source illisible donne incomplet: true, jamais une erreur.
- POST { client } : le client est RELU (jamais cru sur parole), 403 'abonnement' s'il ne porte pas un abonnement du
  compte ; sinon portailDuClient(clePilotage(), client, https://aoknowledge.com/mon-espace/parametres/achats), repli
  PILOTAGE_PORTAIL_LIEN, sinon 503 'portail'. Libelles : Premium Duo (Carnet et Pilotage), Pilotage Premium, Soutien de
  Pilotage, Carnet Premium, Soutien du Carnet, Soutien AOKnowledge.
- Le Live Club (compte Stripe de Melanie) n'y est JAMAIS : il se gere depuis son bot ; la page le dit.
- Fichiers : src/lib/portail-abonnements-pur.ts (pur), src/lib/portail-abonnements.ts, src/app/api/compte/portail/route.ts.
  Verif : node scripts/verifier-portail-abonnements.mjs (9 blocs), verifier-soutien.mjs (15), tsc, eslint, next build.
- Non verifie : un vrai portail ouvert (aucun compte de test abonne) ; que la cle de Pilotage ouvre bien le portail d'un
  client cree par la cle du Carnet (meme compte Stripe, donc attendu) ; la configuration du portail chez Stripe (ce
  qu'un membre peut y changer) est celle du compte, pas touchee.

## SOUTIEN AOKNOWLEDGE : LA ROUTE DE LA PAGE /SOUTENIR ET LE BADGE (11/11/2026, commite NON pousse, branche soutien-page ; AUCUNE migration ; RIEN cree dans Stripe)

- Brief : D:\7_Agents\briefs\2026-11-11-soutien-mail-et-page-soutenir.md (partie 2, go de Brice). Le site : branche
  soutien-page du workspace (page /soutenir).
- Stripe (deja cree le 11/11, compte Ao Knowledge, mode reel) : produit prod_VboqdWtBxA9SnV « Soutien AOKnowledge »,
  prix mensuels 5 / 10 / 20 EUR (price_1UabCf..., price_1UabCg..., price_1UabCh...), en constantes (soutien-pur.ts).
  Montant au choix (2 a 200 EUR entiers) : price_data sur le meme produit, recurring month.
- Route /api/academie/soutien (Bearer du site, NON publique, CORS de l'academie) : GET { soutien, portail } ; POST
  { montant } = session Checkout HEBERGEE, soutien=aok + app=aok + user_id + montant sur la session ET l'abonnement,
  AUCUNE metadata source (le webhook de Pilotage la traite hors Pilotage : aucun droit, le remerciement « a
  AOKnowledge »), conditions a accepter, retour /mon-espace?soutien=aok, annulation /soutenir. Regles pures :
  sessionSoutienAok (401 compte, 400 montant, 409 email, 503 indisponible si Stripe illisible, 409 deja, 502 stripe).
  Aucune formule exigee : tout compte peut soutenir.
- Cle : cleSoutienAok (soutien-aok.ts) = STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE, sinon celle de Pilotage. Elle lit aussi
  Customers et Subscriptions (abonnementAokDe : clients de l'email confirme, abonnements du produit ; cache 5 min oui,
  1 min non, vide a la creation d'une session).
- Badge : /moi rend compte.soutien.aok (soutien.ts, borne a 4 s comme le Carnet et Pilotage).
- Verif : node scripts/verifier-soutien-aok.mjs (11 blocs, dont la route rejouee avec un faux Stripe), tsc, eslint.

## SOUTIEN : LE MAIL DE REMERCIEMENT (CORRECTIF) (11/11/2026, commite NON pousse, branche soutien-page depuis origin/master a83f48f ; AUCUNE migration)

- Brief : D:\7_Agents\briefs\2026-11-11-soutien-mail-et-page-soutenir.md (partie 1) ; rapport : soutien-page-rapport.md
  (notes de Yume Orchestre). Avant : un soutien recevait le mail d'achat ordinaire (Carnet ou Pilotage Premium, vouvoiement).
- Un achat marque soutien=1 (app) ou soutien=aok (/soutenir), sur la session OU sur l'abonnement, recoit le remerciement
  (modeleSoutien, mails-achat-pur.ts : texte de Brice, tutoiement, signe « Merci encore, Brice », bouton Mon espace) A LA
  PLACE du mail ordinaire. Pilotage : mailAchatPilotage lit la session et soutien de synchroniserAbonnement (abonnement
  relu). Sessions sans source (Carnet, soutien AOK) : planMailHorsPilotage (pur) choisit soutien, Carnet ou rien.
- Anti-doublon inchange : cle soutien:sub_... dans mails_achat_envoyes ; un rejeu ne renvoie rien.
- La session de soutien du Carnet portait deja sa marque (metadata soutien=1 sur la session et l'abonnement) : rien ajoute.
- « Tu arretes quand tu veux, depuis Mon espace » etait faux (Mon espace n'a pas le portail Stripe) : le mail donne le
  chemin reel (Carnet : Mon forfait, « Gerer mon soutien » ; Pilotage : menu du compte, « Gerer mon abonnement » ;
  AOK : aoknowledge.com/soutenir, « Gerer mon soutien »), plus PILOTAGE_PORTAIL_LIEN s'il est pose.
- Verif : node scripts/verifier-mails-achat.mjs (13 blocs, dont 3 du soutien ; depuis un worktree, le bloc migration lit
  ../../../sites : lien provisoire ~/Projects/sites), verifier-soutien (15), tsc, eslint.

## SOUTIEN DANS LES APPS : ABONNEMENT EXISTANT EN MODE SOUTIEN, BADGE (11/11/2026, commite NON pousse, branche soutien-apps depuis origin/master 24523c0 ; AUCUNE migration)

- Brief : D:\7_Agents\briefs\2026-11-11-soutien-dans-les-apps.md ; labo D:\6_Societe\Pilotage\soutien\labo ; rapport :
  soutien-apps-rapport.md (notes de Yume Orchestre). Nouvelle fonction : mise en ligne = go de Brice. Rien dans Stripe.
- Regle (pure, src/lib/soutien-pur.ts) : un membre dont le Premium est COMPRIS (raisons Club sans 'equipe' : liveclub,
  skool-vip, skool-premium, formation, etm, manuel) peut prendre l'abonnement EXISTANT (memes prix, aucun produit neuf)
  marque soutien=1 sur la session ET l'abonnement. decisionSoutien : 401 compte, 403 ferme (SOUTIEN_APPS_PUBLIC != 1,
  sauf admin), 409 deja (un abonnement de l'app actif : jamais deux), 409 pas_compris (achat normal). Le droit ne change
  pas ; si la formule s'arrete, l'abonnement ouvre le Premium comme un autre.
- Pilotage : POST /api/pilotage/achat { soutien: true } (Premium seul, pas le Duo ; admin = essai d'un admin), la
  session porte metadata soutien=1, le webhook pose le droit comme d'habitude. /api/pilotage/niveau rend soutien
  (abonnement relu chez Stripe, la lecture du portail deja faite : abonnementVu) et soutienOuvert ; un abonne de soutien
  garde sa raison Club tant que la formule court (raisonAvecSoutien).
- Carnet : NOUVELLE route /api/carnet/soutien (Bearer, non publique). GET { compris, ouvert, soutien, actif, portail,
  offres } ; POST { periode: mois|an } = session Checkout HEBERGEE sur les prix existants (price_1U9QK... 5,99/mois,
  price_1UAR2C... 57,50/an, surchargeables CARNET_PRIX_MENSUEL/ANNUEL), sans metadata source (le webhook de Pilotage
  envoie le mail du Carnet, aucun droit ecrit), retour aoknowledge.com/mon-espace?soutien=carnet. Cle :
  STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE sinon celle de Pilotage. Abonnement lu par abonnementCarnetDe (entitlements.ts,
  STRIPE_KEY_CARNET_AOK, liste par email, cache 5 min) ; Stripe illisible = 503, on ne vend pas a l'aveugle.
- Badge : /api/academie/moi rend compte.soutien { carnet, pilotage } (src/lib/soutien.ts, borne a 4 s, null = illisible,
  jamais bloquant). Mon espace l'affiche (site, branche site-soutien).
- A FAIRE SUR GO : pousser le journal AVANT le site, Pilotage 0.5 et le Carnet 1.9.0 ; poser SOUTIEN_APPS_PUBLIC=1
  (et PILOTAGE_ACHAT_PUBLIC=1 si ce n'est deja fait) ; verifier que la cle Checkout a Checkout Sessions + Customer
  portal en ecriture sur le compte Ao Knowledge et que le portail client permet l'annulation. Verif :
  node scripts/verifier-soutien.mjs (15 blocs). verifier-pilotage-paliers echoue DEJA au bloc 11 (assertion perimee sur
  publicPaths du middleware), verifier-mails-achat ne trouve pas les migrations depuis un worktree : non repare ici.

## REDIFFUSION DES LIVES : DONNEES DU LIVE DANS /moi, IMPORT DU MODULE RENOMME (11/11/2026, commite NON pousse, branche rediffusion-des-lives depuis origin/master b9e4fa4 ; migration 20261111010000 du workspace ECRITE, NON appliquee)

- Brief : D:\7_Agents\briefs\2026-11-11-rediffusion-des-lives-module.md ; rapport : rediffusion-des-lives-rapport.md
  (notes de Yume Orchestre). Cote site : son ETAT, section du meme nom.
- **/moi et /catalogue** (vue-moi.ts, catalogue.ts, requetes.ts SQL_LECONS_VISIBLES_LIVE) : chaque lecon de live rend
  `live: { le, type, organisations, intervenants }` (absent ailleurs). Avant la migration, Postgres rend 42703 :
  catalogue.ts relit l'ancienne liste et ne reessaie qu'au bout de 10 minutes. Le journal peut donc partir avant ou
  apres la migration sans casser /moi.
- **Import** (scripts/importer-catalogue-academie.mjs) : le champ « live » d'une lecon remplit live_le, live_type,
  live_organisations, live_intervenants (verifie par lireLive ; une ecriture seulement si ca change ; une lecon sans
  « live » les vide). Deux gardes : l'ancien fichier replays-live-club.json est REFUSE une fois le module renomme
  (SLUGS_REMPLACES : il recreerait le module et ses 90 lecons en double) ; le nouveau (« remplace ») est refuse tant
  que la migration n'est pas appliquee. Un import a blanc du nouveau fichier contre la prod d'aujourd'hui rend donc
  « appliquer d'abord sa migration » : c'est voulu.
- **Essai** : scripts/essayer-migration-rediffusion.mjs (migration puis import, transaction annulee, lock_timeout
  5 s, ~21 a 26 s du begin au rollback ; le ALTER TABLE tient academie_lecons tout ce temps : le lancer la nuit).
  Photo : D:\6_Societe\Pilotage\Academie\catalogue\rediffusion-des-lives\essai-migration.json.
- **Ordre** : migration 20261111010000, import --ecrire de modules/rediffusion-des-lives.json (depuis ce worktree),
  push du journal, push du site. Detail et commandes : le rapport.

## PILOTAGE 0.4 : COMPTES RECENSES DEPUIS LES EXPORTS SANS TRADES, ROUTE RELIRE, SIGNAL DES CAUSES DU CIMETIERE (10/11/2026, commite NON pousse, branche journal-pilotage-0-4 depuis origin/master b9e4fa4 ; aucune migration)

- Brief : D:\7_Agents\briefs\2026-11-10-pilotage-0-4.md (go de Brice) ; rapport : pilotage-0-4-rapport.md (notes de Yume
  Orchestre). Cote Pilotage : son ETAT, section 0.4 (branche pilotage-0-4).
- imports-trades.ts : un export refuse (ordres, notifications, infos du compte, Log, Executions, Orders) rend `compte`
  quand une colonne Account / Compte porte le meme compte sur toutes les lignes, et `solde` (Net Liq) pour les infos du
  compte de Tradovate ; plusieurs lignes sans compte commun : ni compte ni solde, le message sans montant.
- documents-pilotage.ts : la lecture refusee reste `illisible` (message inchange) mais porte `plateforme`, `identifiant`,
  `firme` (prefixe du compte), `devise` (USD pour le Net Liq de Tradovate) et `compteLu` { plateforme, identifiant,
  solde, devise } : Pilotage 0.4 propose le compte et son solde. Un Pilotage d'avant ignore ces champs.
- POST /api/pilotage/documents/[id]/relire (NOUVEAU) : l'original du coffre (originalDocument, documents-serveur.ts,
  borne au userId) relu par preparerLecture puis finaliserLecture avec les comptes envoyes ; SANS IA (aucune lecture
  comptee : `lecture: null, avecAide: true` quand il en faudrait une) ; lecture seule (ni coffre ni table touches).
- Signal `pilotage.cause_autre` { cause: texte } (signaux-pur.ts) : la cause « Autre » d'un compte passe au cimetiere.
  Point de lecture : `node --env-file=.env.local scripts/lire-causes-cimetiere.mjs [--jours 90] [--json f]` (LECTURE
  SEULE, mots de membres, la sortie reste sur la machine) : textes proches regroupes (src/lib/besoins/textes-proches.ts,
  Jaccard des mots utiles >= 0,5 ou inclusion), « a proposer a Brice » des 3 personnes. Pas de contrat besoins-contrat-api.md
  trouve dans le depot pour y ajouter la cle.
- Verifs : verifier-imports-trades.mjs 40 blocs (1 nouveau), verifier-documents.mjs 31 (2 nouveaux), verifier-besoins.mjs
  48 (1 nouveau, cle ajoutee au contrat), verifier-doublons-compte 9, verifier-mes-trades 16, verifier-synthese-trades 19 ;
  eslint des fichiers touches ; npm run build OK (route relire listee).
- Ordre de mise en ligne : ce journal AVANT Pilotage 0.4 (sans lui, Pilotage ne recense rien et « Relire » rend 404 par
  document, dit en erreur dans la revue).
## BESOINS : LA ROUTE AUTOMATIQUE DU TRI DU SOIR (10/11/2026, commite NON pousse, branche besoins-auto depuis origin/master b9e4fa4 ; migration 20261110190000 du workspace ECRITE, NON appliquee)

- Brief : D:\7_Agents\briefs\2026-11-10-besoins-route-automatique.md ; rapport : besoins-auto-rapport.md (notes de
  Yume Orchestre).
- POST /api/cockpit/besoins/auto, sans session : Authorization Bearer BESOINS_AUTO_TOKEN (sha256 des deux cotes puis
  timingSafeEqual ; variable absente ou de moins de 32 caracteres = tout refuse). Actions lire (cartes a_trier, 20 au
  plus, demandes par la lecture de l'API de Tab, signaux de leur cle), statut (planifie, en_cours, livre, refuse,
  note_equipe, raison_refus ; brief rendu au passage en planifie), fusionner, prevenir (le message de l'apercu du
  bouton, prevenirMembres reutilise, idempotent par sa reservation). essai = a blanc. Regles : besoins/auto-pur.ts ;
  depots : besoins/auto.ts ; prevenirMembres prend un 3e parametre maxEnvois (30 par appel), la route de Brice inchangee.
- Chaque geste trace dans besoin_geste (par = tri automatique, nombres seulement) ; table absente = 503 avant tout geste.
- Apres la revue de securite : passages vers l'avant seulement (livre et refuse ne bougent plus, planifie ne se
  replanifie pas), fusion d'une carte a_trier seulement, raison_refus (qui part aux membres) 300 car. sans lien, @,
  balise ni accolade, 100 envois sur 24 h pour la route ; prevenirMembres ne libere plus la reservation d'un membre
  dont le message est parti (trace du bot isolee) : plus de second envoi apres une panne, pour le bouton aussi.
- Verifs : scripts/verifier-besoins-auto.mjs (14 blocs, hors ligne) ; verifier-besoins.mjs 47 blocs ; tsc ; eslint ;
  essai local de la garde (next dev, jeton jetable) : 401 sans jeton et mauvais jeton, 400 action inconnue et 21 cartes.
- MISE EN LIGNE, dans l'ordre : migration 20261110190000 ; poser_jeton_besoins_auto.py (Vercel, Production) ; push ;
  controle par besoins_auto.py lire --essai.

## RESTES DU 10/11 : CLE KIT REFUSEE, ADRESSES A RELIER DANS /moi, ESSAI DU CRITERE UNIQUE (10/11/2026, commite NON pousse, branche restes-10-11 depuis origin/master 9e0f4a2)

- Brief : D:\7_Agents\briefs\2026-11-10-academie-restes-du-10-11.md ; rapport : restes-10-11-rapport.md (notes de
  Yume Orchestre). Cote site : son ETAT, section du meme nom.
- **La cle Kit de PRODUCTION est refusee par Kit** (constat du 10/11) : CONVERTKIT_API_KEY (Vercel, projet journal,
  Production) rend 401 « The API key is invalid » sur /v4/account et /v4/subscribers ; la cle v4 de
  D:\1_Ecriture\Systeme\contexte\secrets-kit.local.md rend 200. Effets : /api/compte/abonnements rend 'kit' (502) a
  TOUS les membres (« Tes choix ne sont pas lisibles » dans Mon espace), /api/newsletter/subscribe, le webhook des
  formulaires et le filet /api/cron/kit-defauts echouent aussi ; profile_kit et profile_consentements n'ont JAMAIS recu
  une ligne (n_tup_ins = 0). A faire, sur go de Brice : remplacer la valeur (Production, et Preview/Development qui
  portent la meme), redeployer le journal (une variable ne vaut que pour les deploiements crees apres), puis
  `vercel env run -e production -- node scripts/verifier-cle-kit.mjs` (forme de la cle et statut, jamais la valeur).
- **/moi rend compte.autres_adresses** : SQL_FAITS_COCKPIT compte les adresses des fiches reliees au compte qui ne
  sont confirmees sur aucun compte du site (ni auth confirme, ni profile_emails verifie). Un nombre, jamais les
  adresses : Mon espace rappelle Comptes lies. 18 ms en mediane (67 comptes, lecture seule) ; 2 comptes concernes le
  10/11. Bloc de verifier-academie (53 blocs hors ligne) ; essayer-migration-academie attend autres_adresses: 0.
- **scripts/essayer-migration-critere-programme.mjs** : essai de la migration 20261110150000 du workspace (un seul
  critere « a un programme »), joue une fois le 10/11 : 7 etapes ok, 1,4 s du begin au rollback, rien d'ecrit.
- **scripts/essayer-migration-anciens-telegram.mjs** : essai de la migration 20261110160000 du workspace (le prefixe
  « u » des tg_ids dans aok_anciens_correspondances), joue une fois le 10/11 : 6 etapes ok, 6,7 s, rien d'ecrit. Il
  simule aussi le prochain aok_anciens_activer de chaque compte (points de sauvegarde defaits) : 3 activations apres la
  correction, 0 avant.
- Ordre de mise en ligne : ce journal AVANT le site (sinon pas de rappel, rien ne casse : autres_adresses absent = 0).

## IMPORTS DE PILOTAGE : LES FICHIERS D'ALEX, LES CLASSEURS .XLSX, LES TRADES DE NINJATRADER (10/11/2026, commite NON pousse, branche journal-imports-alex depuis origin/master 946b48d ; aucune migration)

- Brief : D:\7_Agents\briefs\2026-11-10-pilotage-imports-et-retours-cedric.md (option A de Brice) ; rapport :
  pilotage-retours-rapport.md (notes de Yume Orchestre). Cote Pilotage : son ETAT, section du 10/11 (0.3.1).
- imports-trades.ts : les exports qui ne portent pas de trades sont RECONNUS (FR et EN) et refuses avec ce que c'est
  et l'export a faire, chemin du menu compris (refuse: true, plateforme) : liste et rapport des ordres de Tradovate
  (MESSAGE_ORDRES_TRADOVATE, variante de MESSAGE_ORDRES_SANS_TRADE), journal des notifications, infos du compte (le
  solde Net Liq dit, rien d'autre), Log, Executions et Orders de NinjaTrader. Un fichier avec une colonne de resultat
  n'est jamais pris pour des ordres. Lecteur ninjatrader-trades (Trade Performance > Trades, CSV ou classeur, en-tetes
  EN de la doc et FR par synonymes A CONFIRMER sur un vrai fichier ; « MNQ 12-26 » = MNQZ6 ; heure affichee comme
  Tradovate ; P&L = Profit, frais = Commission + Clearing/Exchange/IP/NFA Fee ; cle sans le numero du trade).
- classeur-xlsx.ts (NOUVEAU) : un .xlsx = son premier onglet utile en CSV (dates d'Excel en AAAA-MM-JJ HH:mm:ss),
  puis les memes lecteurs. Dependance fflate ^0.8.3 (deja dans l'arbre par jspdf en 0.8.2, qui a la faille
  GHSA-px8p-9vwx-vf98 corrigee en 0.8.3 ; lockfile seul modifie : le node_modules partage des worktrees garde 0.8.2,
  Vercel installera 0.8.3). Les ZIP64 sont refuses avant fflate. Limites : 25 Mo par partie, 60 Mo, 100 000 lignes.
- documents-pilotage.ts : famille 'classeur' (xlsx, xlsm) ; .xls, .ods, Numbers refuses avec la marche a suivre ;
  lireCsv rend 'illisible' (methode csv, sans IA, aucun quota) avec la remarque pour un export refuse.
  Routes : documents/lire lit le classeur avant preparerLecture ; trades/import accepte { xlsx } a la place de csv
  et rend refuse et plateforme. /api/imports-trades (ecran du journal) NON touche.
- Fixtures ANONYMISEES : scripts/fixtures/imports-alex-2026-11 (ni compte, ni nom, ids remplaces, solde invente).
  Verifs : verifier-imports-trades.mjs 39 blocs (8 nouveaux), verifier-documents.mjs 29 (4 nouveaux),
  verifier-doublons-compte.mjs 9 ; eslint des fichiers touches ; build OK.
- Ordre de mise en ligne : ce journal AVANT Pilotage 0.3.1 (sans lui, Pilotage envoie les .xlsx a un journal qui
  les refuse en « classeur » et ne connait pas refuse).

## /MOI REND LE RANG VIP ET LE LIVE CLUB SANS STRIPE D'UN ETM OU D'UN VIP (10/11/2026, commite NON pousse, branche mon-espace-etm-vip depuis origin/master f39d3b6 ; aucune migration)

- Brief : D:\7_Agents\briefs\2026-11-10-mon-espace-etm-vip.md ; rapport : mon-espace-etm-vip-rapport.md (notes de
  Yume Orchestre). Le site dit « Eleve ETM » ou « Membre VIP » en tete de Mon espace (ETAT du site, section du 10/11).
- SQL_FAITS_COCKPIT (requetes.ts) rend une colonne vip : cockpit_membres_etat.tier_skool = 'vip' sur une fiche reliee
  par cockpit_membre_emails a un email verifie du compte (meme lecture que etm, meme critere que 'skool-vip' de
  checkMentoratAccess). Droits.vip, /moi : compte.vip a cote de compte.etm. Un statut AFFICHE : preparerDroits ne
  l'ouvre a rien, le Live Club n'en depend pas.
- LE BOT N'OUVRE PAS LE GROUPE A UN ETM NI A UN VIP (droitLiveClub : abonnement, exemption, broker, acces manuel).
  Tranche le 10/11 (Yume, regle de Brice du 09/09, entitlements.ts) : droits du bot NON changes.
- Live Club d'un ETM ou d'un VIP que liveClubUtile ne lit pas : les trois sources SANS Stripe de droitLiveClub
  (exemption, acces broker, acces manuel ; sourceSansStripe et liveClubDuStatut, pur.ts) donnent 'oui' ; sans
  source, 'non_lu' (Stripe jamais appele pour un ETM). /moi rend compte.live_club_source (exemption, broker ou
  manuel) quand le 'oui' vient d'elles, null sinon : le site dit « Live Club actif : accès offert ». Joue en
  lecture seule le 10/11 sur le compte de Cedric : etm, vip, live_club 'oui', source exemption.
  Ecart connu, comme pour tout membre : l'acces broker est lu par sa date (SQL_FAITS_COCKPIT), sans la pause des
  lots en retard ni le depot perdu que droitLiveClub applique.
- verifier-academie.mjs : blocs VIP et Live Club d'un ETM ou d'un VIP (52 blocs hors ligne).
  essayer-migration-academie.mjs attend vip: false (non rejoue).
- Ordre : ce journal avant le site (sans lui, le site affiche l'ETM mais pas le VIP).

## INTEGRATION DE LA BRANCHE ANCIENS-MEMBRES AVANT SA MISE EN LIGNE (10/11/2026, commite NON pousse)

- Brief : D:\7_Agents\briefs\2026-11-10-mise-en-ligne-anciens-integration.md ; rapport : integration-anciens-rapport.md
  (notes de Yume Orchestre). Ordre de mise en ligne : ETAT du site, section « Integration de la branche anciens-membres ».
- origin/master (ffa198e, le classement Activite EN LIGNE : etape points_jours du passage quotidien) fusionne dans
  anciens-membres (merge) : seul conflit, cet ETAT, resolu en gardant les deux cotes.
- Mail d'achat du coaching 8 h (modeleEmailCoaching, src/lib/academie/club-paypal-pur.ts) : « Entre deux seances, vous
  avez un acces prioritaire par message. » revient (Brice, carte coaching-acces-prioritaire, reponse B, 10/11), comme
  le 5e point de /merci. scripts/verifier-coaching-paypal.mjs l'exige desormais (12 blocs ok).
- scripts/essayer-migration-statuts-anciens.mjs revu : migrations dans l'ordre de mise en ligne (lot 1, parcours,
  annuaire, profils ; l'import en dernier, sa renumerotation verrouille profiles), decisions-brice.json tel quel
  (etm_valide_le pose : 9 ETM), empreintes md5 des fonctions du classement et plafond des lecons (10) compares avant,
  pendant et apres, sequence relue juste avant l'import (aucun nextval), liste des tables comparee, profils publics
  nommes s'il y en a. Joue UNE fois le 10/11 : 9 etapes ok, 6,1 s du begin au rollback, rien de reste.

## STATUTS DES ANCIENS ELEVES ET NOUVELLE NUMEROTATION : LES SCRIPTS (10/11/2026, commite NON pousse, branche anciens-membres ; migrations 20261109234500 (revue) et 20261110010000 du workspace ECRITES, NON appliquees)

- Brief : D:\7_Agents\briefs\2026-11-10-statuts-anciens-eleves.md ; rapport : statuts-anciens-rapport.md (notes de
  Yume Orchestre). Detail : ETAT du site, section « Statuts des anciens eleves et nouvelle numerotation ».
- scripts/lister-anciens-membres.mjs : anciens a partir de 30 ; une personne qui porte un statut d'ancien eleve paye
  entre dans la liste quelle que soit sa nature (Djock, Sebastien Picard) ; epoque par les statuts (les groupes SMM de
  2025, ranges en IziMoney, donnent LearnyBox) ; statuts par ligne, ETM documentes (ETM_DOCUMENTES, sources), notes,
  droits et « sans droits » de Brice, Marlon Wricka ; nouveaux champs de decisions-brice.json : deja_numerotes,
  anciennete_depuis_equipe, sans_droits, droits, notes, a_trancher, etm_valide_le. Statuts lus en base une fois la
  migration passee, calcules sinon par un MIROIR de la correspondance de la migration (GROUPES_STATUTS, EXCEPTIONS) :
  a garder identiques. Page : lib-anciens-membres-page.mjs.
- scripts/importer-anciens-membres.mjs + lib-importer-anciens.mjs (le meme coeur que l'essai) : refuse sans valide_le,
  si a_trancher n'est pas vide, si decisions-brice.json a change depuis la liste. Reservations (30 et +, equipe 5 a 20
  hors deja_numerotes), Marlon Wricka (cockpit_arch_personnes + note d'identite), reglages des droits, ETM (seulement
  avec etm_valide_le), activation des comptes, PUIS aok_numeros_renumeroter() : les inscrits juste apres le dernier
  ancien, sequence recreee. --compacter n'existe plus.
- Essai : AOK_WORKSPACE=<worktree du workspace> node --env-file=.env --env-file=.env.local
  scripts/essayer-migration-statuts-anciens.mjs (lot 1, annuaire, profils, parcours, puis l'import reel de la liste
  validee, transaction annulee, lock_timeout 5 s ; 6,5 s du begin au rollback le 10/11). ⚠️ La premiere version
  inscrivait deux comptes d'essai AVANT la renumerotation : la sequence n'est pas transactionnelle, 21290 et 21291 ont
  ete brules pour de bon (prochain inscrit 21292, sans autre effet). Corrigee : plus aucun compte cree avant la
  renumerotation. Les trois essais precedents (anciens membres, annuaire, profils par numero) refusent desormais de
  tourner (ESSAI_ANCIEN_FORCE pour forcer) : ils attendent l'ancienne numerotation et bruleraient des numeros.
- agent-cockpit.ts : les tables cockpit_parcours* au catalogue de l'agent, et dans TABLES_FONDS (refusees a un compte
  sans acces_fonds, comme cockpit_arch_*). A redeployer avec le journal APRES la migration 20261110010000.

## PHOTO D'UN PROFIL « MEMBRES » : LA REGLE DE L'ANNUAIRE (10/11/2026, commite NON pousse, branche anciens-membres ; migration 20261109235900 du workspace ECRITE, NON appliquee)

- Brief : D:\7_Agents\briefs\2026-11-10-annuaire-profils-par-numero.md ; rapport : annuaire-profils-rapport.md (notes de
  Yume Orchestre). Detail : ETAT du site, section « /membres/<n°> suit la regle de l'annuaire ».
- `GET /api/membres/photo` (profil « membres », m=1) : apres le jeton, `select public.aok_profil_visible(compte, cible)`
  (role postgres). Faux : le meme 404. Erreur ou fonction absente : 503, jamais la photo. Ne compte pas dans le plafond
  de l'annuaire (24 photos par page de l'annuaire). Profil web : inchange.
- Essai : AOK_WORKSPACE=<worktree du workspace> node --env-file=.env --env-file=.env.local
  scripts/essayer-migration-profils-par-numero.mjs (lot 1, annuaire, puis 20261109235900, transaction annulee,
  lock_timeout 5 s ; 12 etapes ok le 10/11, 8,4 s du begin au rollback).
- verifier-mon-espace-rls.mjs : apres la migration, le profil « membres » d'essai de A est place en tete des 24 (mesure
  d'essai annulee) pour que B, compte sans programme, le lise encore.
- Ordre : migration 20261109235900 AVANT ce journal (sinon 503 sur les photos « membres »).

## CLASSEMENT ACTIVITE : LA REGLE DES COMPTES GRATUITS (10/11/2026, commite NON pousse, branche classement-v2 ; migration 20261109234100 du workspace ECRITE, NON appliquee)

- Brief : D:\7_Agents\briefs\2026-11-10-classement-activite-page.md ; rapport : classement-reel-rapport.md (notes
  de Yume Orchestre). Rien de neuf dans le code du journal : seulement l essai.
- Essai : AOK_WORKSPACE=<workspace> [AOK_ANNUAIRE=<worktree anciens-membres>] node --env-file=.env --env-file=.env.local
  scripts/essayer-migration-classement-gratuits.mjs [--empreintes]. Phase A (fonctions seules, aucune table) : md5 de
  la garde, aok_a_un_programme = aok_annuaire_acces (statut autre que communaute) pour chaque compte. Phase B, UNE
  fois : 233000, 234000, 234100, premier remplissage, profils rendus publics dans la transaction, vue d un gratuit,
  d un compte avec programme, de l equipe. 10/11 : 9 etapes ok, 4,5 s du begin au rollback (lock_timeout 5 s).
- Ordre de mise en ligne : ETAT du site, section « Classement Activite : la vraie page ».

## POINTS PAR JOUR DU CLASSEMENT ACTIVITE (09/11/2026, commite NON pousse, branche classement-v2 depuis origin/master 86bced9 ; migrations 20261109233000 et 20261109234000 du workspace ECRITES, NON appliquees)

- Brief : D:\7_Agents\briefs\2026-11-09-points-jours.md ; rapport : points-jours-rapport.md (notes de la
  conversation Yume Orchestre). La RPC aok_classement mettait 5 s par appel (aok_points_calcul par compte) :
  elle lit maintenant la table aok_points_jours (55 ms). Detail et ordre de mise en ligne : ETAT du site, section
  « Points par jour ».
- Passage quotidien du Live Club (cron 7 h UTC) : etape points_jours EN DERNIER (apres le resume), budget 285 s,
  rafraichirPointsJours (src/lib/points-jours.ts) -> aok_points_jours_rafraichir(false, 'cron:liveclub') :
  incremental, complet au premier passage et chaque semaine. Fonction absente : etat fonction_absente, aucune
  erreur (le journal peut partir avant la migration). Synthese : points_jours { etat, complet, recalcules,
  jours_ecrits, jours_retires }. Pas de nouveau cron (plan Hobby : une fois par jour).
- A la main (ECRIT en base, accord de Brice) : node --env-file=.env.local scripts/rafraichir-points-jours.mjs
  [--complet]. Sert au PREMIER remplissage juste apres la migration (le script d'application coupe a 5 s).
- Essai : node --env-file=.env.local scripts/essayer-migration-points-jours.mjs (worktree : AOK_WORKSPACE=...),
  les deux migrations dans une transaction annulee en lecture repetable, 20 etapes ok le 09/11. Controle statique :
  scripts/verifier-points-jours.mjs.
- Mon espace (aok_ma_progression) reste calcule en direct, NON branche sur la table (il doit suivre la seconde) ;
  il passe de 89 a 35 ms par la migration (fuseau Europe/Paris plus relu dans pg_timezone_names).

## LE STATUT EQUIPE : BRICE, MELANIE, ADIL, ADRIEN (09/11/2026, commite NON pousse, branche statut-equipe depuis origin/master 2c79f3e ; migration 20261109210000 ECRITE, NON appliquee)

- Brief : D:\7_Agents\briefs\2026-11-09-statut-equipe.md ; rapport : statut-equipe-rapport.md (notes de la
  conversation Yume Orchestre). Brice : Mon espace lui disait « Tu n'es pas membre du Live Club ».
- Le statut = profiles.role 'admin', deja pose sur les quatre comptes et sur eux seuls. estEquipe (academie/pur.ts),
  meme regle que aok_est_equipe en base et equipe.ts du site.
- droitsAcademie : equipe -> tout ouvert (raison admin), Live Club 'oui' sans Stripe ; /moi rend compte.equipe.
- checkMentoratAccess : raison 'equipe' en premier (RAISONS_CLUB, RAISONS_CLUB_PILOTAGE, essai) : palier Club des
  apps, Pilotage premium (pas le palier sans plafond, qui reste l'email de Brice).
- Essai : node --env-file=.env.local scripts/essayer-migration-statut-equipe.mjs (worktree : AOK_WORKSPACE=...),
  transaction annulee, 12 etapes ok le 09/11. Tests : verifier-academie (bloc equipe), verifier-pilotage-paliers.
- Pas touche : le bot du Live Club (les quatre comptes Telegram y sont deja exemptes fondateur ou equipe ; le texte
  « offert par l'equipe » que verrait Adrien demanderait de rejouer les evals), lireEquipe du resume (meme equipe
  aujourd'hui, ne lit pas encore cockpit_equipe_fiches()).
- Ordre : migration, puis ce journal, puis site et cockpit.

## MON COACHING EN HEURES : LES REGLAGES DE BRICE (09/11/2026, commite NON pousse, branche coaching-heures depuis origin/master 828483b ; migration 20261109200000 ECRITE, NON appliquee)

- Brief : D:\7_Agents\briefs\2026-11-09-mon-coaching-reglages.md ; rapport : coaching-heures-rapport.md (notes de la
  conversation Yume Orchestre). Reponses de Brice : l'ETM est modulable (1 h par semaine sur 3 mois, mais 2 x 30 min pour
  l'un, 1 h toutes les 2 semaines pour l'autre) ; une annulation, meme de derniere minute, ne compte pas ; le pack 8 h n'a
  pas de date limite et n'est pas de l'ETM ; Melanie se joint aussi en direct sur Telegram (@melmomtrader).
- ON COMPTE EN HEURES (minutes) : src/lib/coaching/pur.ts. Un droit porte des minutes (vue coaching_droits_tous.minutes,
  coalesce de l'ancienne colonne seances x 60) ; une seance prevue ou faite retire sa duree (30 min = 0,5 h), une annulee
  jamais ; le reste d'une seance passe au droit suivant (partage) ; depassement en minutes (hors_droits_min, hors_min).
  Phrases : « 6 h restantes sur 8 h avec Brice », 7,5 h, 6 h 50, 50 min. Lignes : total_min, faites_min, prevues_min,
  restantes_min, nb_faites, nb_prevues (plus de total / faites / restantes en seances).
- Gestes du cockpit : accorder_droit et corriger_droit en `minutes` (par quart d'heure, 15 a 6000). L'ancien ecran du
  cockpit envoie encore `seances` : accepte et converti (x 60) tant qu'il n'est pas redeploye. MINUTES_ETM_DEFAUT = 720.
- Base (base.ts) : ecrit minutes seul (seances vide), l'heure payee sur Cal porte la duree du rendez-vous (droit de 50 min
  pour un rendez-vous de 50 min). Catalogue de l'agent du cockpit a jour.
- Mail du coaching (modeleEmailCoaching, club-paypal-pur.ts) : 8 h, accompagnement pendant la formation (check-ups, lecons
  bien comprises, exercices et guidelines), sans date limite, sans promesse ; plus d'« acces prioritaire par message ».
- Verifs : `node scripts/verifier-coaching.mjs` (20 blocs, AOK_WORKSPACE=<worktree coaching-heures>) ;
  `node scripts/verifier-coaching-paypal.mjs` (12 blocs) ; `node --env-file=.env.local scripts/essayer-migration-coaching-heures.mjs`
  (11 etapes, transaction annulee : l'ancien journal ecrit avant et apres la migration, reprise, nouveau journal, calcul,
  lectures authenticated et anon, contraintes) ; tsc et `npm run build` OK.
- ORDRE DE MISE EN LIGNE : 1) migration 20261109200000 (puis `npm run verifier:rls`) ; 2) ce journal (push de
  coaching-heures) ; 3) site et cockpit. Dans cet ordre, rien ne casse : l'ancien journal marche sur la base migree, le
  nouveau journal accepte l'ancien cockpit, le site n'affiche que les phrases. Plus tard : minutes obligatoire et seances
  supprimee (une migration a part, une fois le nouveau journal en ligne).

## MON COACHING : SEANCES RESTANTES, WEBHOOK CAL, COCKPIT, MEET (09/11/2026, EN LIGNE le 09/11 : journal 828483b, migration 20261109140000 APPLIQUEE, d apres le brief du 09/11. Compte en heures : section du dessus)

- Demande de Brice du 09/11 (seances restantes dans Mon espace ; trois branchements : Cal pour Brice, cockpit pour Melanie
  qui n'a pas de Cal, enregistrements Meet proposes a confirmer). Brief : D:\7_Agents\briefs\2026-11-09-mon-coaching-seances.md ;
  rapport : mon-coaching-rapport.md (notes de la conversation Yume Orchestre).
- Code : src/lib/coaching/pur.ts (calcul du reste, vue du membre, signature et lecture des evenements Cal, corps des gestes du
  cockpit, regroupement par personne) et src/lib/coaching/base.ts (les requetes ; SQL_COMPTES_DE_EMAIL recopie a l'identique,
  verifie par le script).
- Routes :
  - `POST /api/coaching/cal` : PUBLIQUE (middleware.ts), 503 tant que CAL_WEBHOOK_SECRET n'est pas pose, 401 si la signature
    X-Cal-Signature-256 (HMAC-SHA256 hex du corps brut) ne colle pas. BOOKING_CREATED / PAID / RESCHEDULED posent ou deplacent la
    seance (prevue, coach brice, rattachee par l'email de l'invite) ; BOOKING_PAID cree le droit d'une seance (une fois) et l'y
    lie ; BOOKING_CANCELLED / REJECTED annulent (et retirent le droit Cal de la seance). Une seance ne se pose que pour un type
    d'evenement liste dans CAL_COACHING_TYPES (slugs ou ids, virgules) : vide = rien ne se pose (un appel decouverte ne doit
    jamais consommer un pack). Une seance annulee ou faite ne revient jamais a prevue par un evenement en retard.
  - `POST /api/compte/coaching` : jeton du site, CORS academie. Rend la vue du membre (phrases, prochain, historique, bouton) :
    ni email, ni note, ni identifiant, ni source. Lien du pack : COACHING_RESERVATION_URL (meme variable que l'email d'achat).
  - `POST /api/cockpit/coaching` : allowlist. lister, fiche, ajouter_seance, statut_seance, accorder_droit (offert | etm),
    corriger_droit, retirer_droit, confirmer_detection, ecarter_detection.
- Regles du reste : un droit compte tant qu'il n'est pas retire ; une seance prevue ou faite consomme une place, annulee non ;
  une seance liee a un droit le consomme d'abord, les autres prennent le droit le plus ancien du meme coach qui a de la place ;
  le surplus est « hors droits » (signale au cockpit). Le pack 8 h se deduit de academie_acces (vue coaching_droits_tous) :
  rien ne change dans la capture PayPal.
- Agent du cockpit : coaching_droits_tous, coaching_seances, coaching_detections ajoutes au catalogue (agent-cockpit.ts).
- Verifs : `node scripts/verifier-coaching.mjs` (16 blocs, hors ligne) ; `node --env-file=.env.local
  scripts/essayer-migration-coaching.mjs` (transaction annulee, 19 etapes : migration jouee deux fois, parcours Cal complet,
  Meet, lectures rejouees sous authenticated avec vrai sub et vrai email, et anon). Worktree : `AOK_WORKSPACE=<racine du workspace>`.
  `npm run build` OK.
- Meet : D:\6_Societe\Pilotage\Data-Performance\automations\coaching_meet.py (Python Windows, sec par defaut, --ecrire pour
  inserer, --essai pour les regles). AUCUN jeton du coffre ne couvre Drive : il attend credentials.local\google-drive-meet.local.json
  (drive.metadata.readonly, compte Google d'AOK de Brice).
- ORDRE DE MISE EN LIGNE : migration (puis `npm run verifier:rls`) ; ce journal avec CAL_WEBHOOK_SECRET et CAL_COACHING_TYPES ;
  site et cockpit ; webhook dans Cal (Ping test = 200 « ignore ») ; jeton Drive puis coaching_meet.py. Ouverts : effacement RGPD
  et export ne connaissent pas les tables coaching_*.

## QUESTIONS SOUS LES LECONS DE L'ACADEMIE (09/11/2026, commite NON pousse, branche questions-lecons depuis origin/master ; migration 20261109090000 ECRITE, NON appliquee)

- Decision de Brice du 16/10 (PLAN-ACADEMIE section 12), lancee le 08/11 avant la fermeture de Skool. Brief :
  D:\7_Agents\briefs\2026-11-08-questions-sous-les-lecons.md ; rapport : questions-lecons-rapport.md (notes de la conversation
  Yume Orchestre).
- `POST /api/academie/questions-lecon` (Bearer du site, CORS academie) : `lire` / `poser`. Droit sur la lecon par
  droitsAcademie + ouvertureLecon (gratuits compris sur ce qu'ils ouvrent), 5 questions sur 24 h glissantes (limite dans le
  meme ordre SQL que l'insert), 1000 caracteres, texte nettoye. Rend les publiees et les siennes, jamais un compte ni un email.
  Alerte Agent AOK a chaque question (alerterEquipeTexte, support: true, analyse de securite des bots).
- `POST /api/cockpit/academie/questions-lecons` (allowlist) : lister (attente / traitees), repondre (publier ou prive,
  question corrigee possible, signature = prenom du libelle de cockpit_allowlist), retoucher sans email, ecarter. UN email
  au membre a la premiere reponse (Resend, cle des mails du Live Club, lien de la lecon #questions).
- Code : src/lib/academie/questions-lecons.ts (sans import : regles, textes, SQL) et questions-lecons-envois.ts.
- Verifs : `node scripts/verifier-questions-lecons.mjs` (11 blocs) ; `node --env-file=.env.local
  scripts/essayer-migration-questions-lecons.mjs` (transaction annulee, 17 etapes, lectures rejouees sous authenticated avec
  vrai sub et vrai email, et anon). Dans un worktree : `AOK_WORKSPACE=<racine du workspace>`.
- ORDRE DE MISE EN LIGNE : migration, puis ce journal, puis le site et le cockpit (sans la migration, les routes rendent 503
  code migration et le bloc du site dit « ne se chargent pas »).
## COACHING 8 H VENDU PAR LE TUNNEL PAYPAL DU 10% CLUB (08/11/2026, commite NON pousse, branche club-coaching depuis origin/master ; migration 20261108235500 du workspace ECRITE, NON appliquee)

- Brice, 08/11 : recommandation de PLAN-UPSELL.md section 7 suivie. Brief : D:\7_Agents\briefs\2026-11-08-club-tunnel-coaching.md.
- Les routes /api/club/paypal (GET, commande, capturer) sont generiques par offre (OFFRES_PAYPAL de
  club-paypal-pur.ts) : { offre: 'coaching' } (GET : ?offre=coaching), absente = le Club comme avant. Reponses
  avec offre (le site exige offre = 'coaching' : un journal plus ancien ne vend jamais le Club a sa place).
  L'offre est relue dans le reference_id de la commande PayPal (coaching-8h, coaching-8h-essai), jamais dans le corps.
- Coaching : offre academie coaching-8h (1 000 EUR en base, AUCUN prix a defaut : sans la migration, 503 'config',
  essai compris), pas de case de renonciation, PayPal-Request-Id coaching8h-capture-<commande>. Drapeau
  COACHING_PAYPAL_PUBLIC=1 (sinon essai admin a 1 EUR seulement). COACHING_RESERVATION_URL facultative (https).
- Capture COMPLETED du coaching : ligne academie_acces (source paypal, offre coaching-8h, renonciation vide,
  aucun contenu ouvert), email a l'acheteur (meme expediteur et gabarit que le Club, modeleEmailCoaching :
  « Brice vous contacte sous 48 h » faute de lien de reservation), alerte Telegram a l'equipe (alerterEquipeClub,
  texteAlerteCoaching : montant, acheteur, achat du Club retrouve ou non par SQL_MEMBRE_OFFRE, email parti ou non).
  Paye mais non note (base, offre absente) : alerte texteAlerteNonNote, Club compris, une fois par capture.
- Cockpit : comme le Club, par la collecte PayPal hebdomadaire (cockpit_paiements paypal:<capture>, non classe) ;
  Mon espace le montre avant (paiements_academie de aok_compte_de).
- Verifs : verifier-coaching-paypal.mjs (12 blocs), verifier-club-paypal.mjs (15, MIGRATIONS_DIR depuis un worktree),
  verifier-mails-achat.mjs (10), tsc, eslint, next build. Envoi d'essai vers delivered@resend.dev accepte.
- MISE EN LIGNE, dans l'ordre, sur go : (1) migration 20261108235500 ; (2) push du journal ; (3) push du site ;
  (4) essai admin a 1 EUR (/club?achat=essai puis /merci, ou /merci?achat=essai) ; (5) COACHING_PAYPAL_PUBLIC=1 +
  redeploiement du journal.

## PASSATION SKOOL : INVITATIONS DES MEMBRES, LIEN EN 1 CLIC, COMPTEUR (08/11/2026, commite NON pousse, branche passation-invitations depuis origin/master ; migration 20261108200000 ECRITE, NON appliquee)

- Brice, 08/11 : options A2 (email aux 235 adresses connues, versions payant et gratuit, relance J+3), A4 (lien
  personnel qui cree le compte et connecte en un clic, payants sans compte) et A7 (compteur). Options :
  D:\6_Societe\Pilotage\Academie\PASSATION-SKOOL-OPTIONS-2026-11-08.md. Brief : D:\7_Agents\briefs\2026-11-08-passation-invitations-a2-a4.md.
- Route GET /api/academie/invitation?j=<jeton 43 car.> (publique, chemin exact dans middleware.ts) : sha256 du jeton
  -> ligne academie_invitations (version payant, non expiree) -> compte de l'EMAIL DE CONNEXION (auth.users), cree
  sinon par admin.createUser (email_confirm, first_name du CSV) ; adresse seulement secondaire d'un autre compte :
  pas de session (repere compte) -> generateLink 'magiclink' (aucun email) -> ouvert_le, clics, compte_le notes ->
  303 vers aoknowledge.com/auth/invitation#token_hash=...&type=... (fragment), ou le site fait verifyOtp (son
  client est PKCE : un lien admin classique, flux implicite, y serait refuse). Echecs : 303 vers
  aoknowledge.com/connexion?invitation=invalide|expiree|compte|erreur. HEAD = 204 sans effet (sondes des
  antivirus). Lien cliquable PLUSIEURS FOIS jusqu'a expiration (14 jours) : chaque clic regenere un jeton Supabase.
  Jeton derive (HMAC de SUPABASE_SERVICE_ROLE_KEY, id de ligne, numero) : la base n'a que son sha256, la relance
  redonne le meme lien. Sentry : jeton masque (sentry-masque.ts). ACADEMIE_INVITATIONS=off coupe la route.
- Script scripts/inviter-membres-skool.mjs (essai a blanc par defaut ; --ecrire ; --relance ; --max 90 ; --lot ;
  --compteur ; --test-vers delivered@resend.dev) : CSV email;version;prenom sur D:, payants d'abord, payant avec
  compte utilisable = payant-compte (lien de connexion, pas de jeton). Modeles <nom>.sujet.txt / .corps.txt
  ({{prenom}}, {{lien}}) ; scripts/modeles-invitation-skool/ = BROUILLONS (refuses par --ecrire). Resend
  (RESEND_API_KEY_LIVECLUB sinon RESEND_API_KEY), support@, cle d'idempotence par ligne et par etape, arret au
  premier refus de quota ou de cadence. Sortie chiffree, jamais une adresse.
- Serveur : src/lib/academie/invitations.ts ; pur : invitations-pur.ts (regles, plan, compteur, modeles, deroule
  de la route a ports injectes, requetes SQL).
- Verifs : scripts/verifier-invitations-skool.mjs 23 blocs hors ligne (MIGRATIONS_DIR pour le bloc de la migration) ;
  -mcp-gpt, -mcp-tache, -indicateur-alex, -academie, -lien-magique-cockpit ok ; tsc ; eslint ; next build. Essai a
  blanc et --compteur sur le vrai CSV (235 lignes : 71 payants dont 13 avec compte et 1 compte jamais confirme,
  164 gratuits dont 9 avec compte). PAS LANCES : scripts/essayer-migration-invitations.mjs (transaction annulee,
  consigne lectures seules) et l'envoi d'essai vers delivered@resend.dev (aucune cle Resend dans .env.local).
- MISE EN LIGNE, dans l'ordre, sur go de Brice : (1) essayer-migration-invitations.mjs puis migration 20261108200000 ;
  (2) push du journal (route) ; (3) site (page /auth/invitation, phrases de /connexion, lien de /contact) ;
  (4) envoi d'essai vers delivered@resend.dev, textes valides par Brice a la place des BROUILLONS, puis --ecrire.
- Limites : le jeton est dans la requete (?j=) : journaux de requetes de Vercel ; un antivirus qui SUIT le lien par
  GET cree le compte et note ouvert_le (sans session, sauf s'il execute le JavaScript du site) ; un compte cree a
  l'avance par un tiers avec l'adresse (jamais confirme) est confirme par le clic.

## MON ESPACE, HISTORIQUE COMPLET DES PAIEMENTS, C10 (08/11/2026, commite NON pousse, branche historique-paiements ; migration 20261108230000 ECRITE, NON appliquee)

- Brice, 08/11 : tout l'historique de paiement du membre, quel que soit le moyen ; ce qu'on ne peut pas fournir renvoie
  vers le bon service. Le site (branche historique-paiements du workspace) fait l'ecran ; detail dans
  sites/Aoknowledgecom/ETAT.md, section C10.
- support-membre.ts : libellePaiement lit aussi paiements_academie et paiements_tiers de aok_compte_de (un paiement Skool
  ou un 10% Club PayPal pas encore recopie peut etre cite au support), cles absentes = comme avant. A POUSSER AVANT le
  site.
- scripts/importer-paiements-skool.mjs : factures Skool de l'export du 07/11 (D:) vers cockpit_paiements_tiers,
  abonnement de Brice (hosting) ecarte, email de membres.csv si la facture n'en a pas, rattachement par
  cockpit_membre_emails. Essai a blanc par defaut, --ecrire (upsert, rejouable). Essai a blanc du 08/11 : 11 factures de
  membres, 7 payees ; 4 rattachables (2 payees), 5 sans fiche (4 payees), 2 sans email (1 payee) ; 0 visible aujourd'hui
  (aucun de ces membres n'a encore de compte du site). Tests : verifier-paiements-skool.mjs (6 blocs).
- verifier-mon-espace-rls.mjs : AOK_WORKSPACE pour lancer depuis un worktree ; migration C10 jouee dans la transaction ;
  controles C10 (Skool et PayPal de B rendus a B seul, impayee ecartee, pas de doublon, moyen et encaisse_par, table
  fermee au membre et a l'anonyme, lue par l'equipe, export, cascade) et mot de passe defini (anonyme refuse, A et B,
  compte sans mot de passe = faux, jeton sans compte = faux). 08/11 : aucun ecart, transaction annulee.
- Collecte PayPal (lu le 08/11) : la tache AOK-Collecte-PayPal tourne chaque lundi, OK, mais l'app « Claude Data » ne
  voit AUCUNE transaction depuis le 23/08/2025 (dumps vides du 15/07 au 02/11/2026). cockpit_paiements paypal s'arrete
  donc au 23/08/2025. Aucun paiement PayPal de 2026 en base (academie_acces paypal : 0, mails_achat_envoyes : 0).

## BESOINS DES MEMBRES, SIGNAUX ET LIMITES DES AGENTS (06/11/2026 apres-midi, commite NON pousse, branche besoins-signaux au-dessus de besoins-finitions ; migration 20261106200000 ECRITE, NON appliquee)

- Brice, 06/11 : pistes A a E sans labo, signaux « Refus + impasses », limites des agents avec son tri. Contrat :
  besoins-contrat-api.md, « Suite du 06/11 apres-midi » et ses Ecarts (fin du fichier). Les outils (site, academie,
  Masterclass, Pilotage, Carnet) sont codes par une autre conversation sur le meme contrat.
- Signaux : liste fermee des cles et du contexte par cle, SEULE source (besoins/signaux-pur.ts). POST /api/besoins/signal
  (session facultative, chemin exact public dans middleware.ts ; personne = HMAC c/t/a, visiteur = empreinte du jour,
  jamais l IP ; secret BESOINS_SIGNAL_SEL, sinon la cle de service), cadence sous verrou (1 par heure et par cle, 30 par
  jour), seuil a l arrivee (3 personnes en 7 jours = carte a_trier de la cle, cree_par signal ; carte deja la, meme
  refusee : jamais touchee). Serveur : besoins/signaux.ts. Table besoin_signal + vue cockpit_besoin_signaux.
- Ligne C : signaler accepte `signal` (carte de la cle, sans IA). D : GET /api/besoins/livres. E : conseil du bot J+6.
  Journal : « Aide et idees », bulle une fois, ligne C et signal journal.import_echec dans ImportsTrades. Textes A VALIDER
  PAR BRICE (besoins/decouverte.ts, tips-accueil-pur.ts).
- Limites des agents : noter_limite dans les deux bots, signaux bot.* et site.info_absente au serveur, TRI DE BRICE par le
  serveur (triLimites : sensible d un non-admin = rien ; admin = cockpit_telegram_comptes ; ignorance = a_trier ;
  prudence = rien), deux filets a sujet fixe (Haiku ne note pas quand il refuse ou transmet : evals T2, T3).
- Verifs : verifier-besoins 47 blocs ; 22 verificateurs hors ligne ok (dont -securite-bots, -effacement, -tips-accueil,
  -diffusion-equipe mis a jour) ; tsc ; eslint ; next build. eval-limites.mjs T1 a T4 ok (Haiku, environ 0,07 EUR).
  PAS rejoue : eval-fuites.mjs (prompt-membre.ts et support-prompt.ts changes : a rejouer avant la mise en ligne).
- MISE EN LIGNE, dans l ordre : migrations 20261106150000 (si pas fait), 20261106180000, 20261106200000 ; eval-fuites ;
  push du journal (besoins-finitions puis besoins-signaux sur master) ; cockpit (commit bf6d3e4 du workspace).
- Limites : la personne d un signal n est pas connue de l effacement (HMAC, aucun lien en clair) ; un visiteur compte comme
  une personne nouvelle chaque jour ; aucune purge des vieux signaux.

## BESOINS DES MEMBRES, FINITIONS (06/11/2026, commite NON pousse, branche besoins-finitions ; migration 20261106180000 ECRITE, NON appliquee)

- Brice, 06/11 : « Option 1 partout » (labos retires du cockpit et du site, hors de ce depot). Ici : l'effacement d'une
  personne (cockpit_effacer) connait enfin ses besoins. Leve la limite « ni les demandes sans fil, ni les votes, ni les
  captures » des lots 2 a 4 ci-dessous.
- effacement.ts : niveaux 2 et 3, cibles completes (cockpit_effacement_cibles, comptes AOK compris) lues AVANT
  cockpit_effacer (au niveau 3 il supprime les comptes et ce qui les retrouve), puis juste APRES lui besoins/effacer.ts :
  besoins_effacer (migration 20261106180000, SQL en UN seul ordre, aucun point-virgule dans le corps, role postgres
  seulement) efface ses demandes restantes (compte AOK, telegram:<id>, email:<adresse>, contact_email, numero Telegram,
  fiche ; jamais par le nom ni le pseudo) et ses votes, rend les chemins des captures que plus aucune demande ne nomme,
  retirees du bucket par la cle de service (retirerCaptures). Ne jette pas : le resultat pour l'equipe dit, avant le
  recapitulatif, ce qui est efface ou a reprendre (migration absente, panne, captures restees : chemins donnes).
- Inventaire : docs/EFFACEMENT-DONNEES.md (5.3, residus en 8, section 10). Pas dans l'apercu : la carte de confirmation ne
  compte pas encore les besoins. Le brief d'une carte planifiee et la note Perso pour Sora gardent les textes (residu dit).
- Verifs : verifier-besoins.mjs 33 blocs (3 nouveaux) ; essai local de la migration sur PGlite (coupee aux points-virgules
  comme le script, rejouee, droits fermes, cas partages) ; tsc ; eslint des fichiers touches ; next build ; -effacement et les
  19 autres verificateurs hors ligne de la liste des lots 2 a 4 : ok.
- MISE EN LIGNE, dans l'ordre : (1) migration 20261106150000 si ce n'est pas fait (colonne contact_email) ; (2) migration
  20261106180000 ; (3) push du journal (besoins-finitions sur master). Journal avant la migration : l'etape dit « a
  reprendre » et, au niveau 3, les demandes du bouton ne se retrouvent plus que par l'uuid du compte supprime.

## BESOINS DES MEMBRES, LOTS 2 A 4 (06/11/2026, commite NON pousse, branche besoins-lots234 ; migration 20261106150000 ECRITE, NON appliquee)

- Brice, 06/11 : « fais tout les lots a la suite ». Contrat commun aux trois codeurs (journal, cockpit, boutons des outils) :
  besoins-contrat-api.md (notes de la conversation « Besoins des membres in-app »), section « Ecarts » a la fin.
- LOT 2, bouton des outils : POST /api/besoins/signaler { app, texte, page?, capture? }, GET /api/besoins/prevus?app=, POST
  /api/besoins/voter { besoinId } (session du membre, CORS de support-cors ; le membre n'agit que pour SON compte). Texte recopie
  tel quel, outil deduit de l'app, classement Haiku (poste besoins_classement, cle du support) puis regroupement du lot 1. Texte
  suspect : AUCUN appel du modele, carte « a classer », Brice prevenu. Capture : data URL jpeg, png ou webp, octets magiques,
  1,5 Mo, bucket PRIVE besoins-captures (capture_url = chemin AAAA-MM/<sha256>.<ext>, jamais une URL). 5 signalements par 24 h
  et par membre, comptes sous verrou. Phrase PHRASE_BOUTON_BESOIN (bouton-pur.ts) A VALIDER PAR BRICE. « Deja prevu » : titres
  de cartes planifiees ou en cours seulement, jamais un texte de membre.
- Journal : entree « Il me manque quelque chose » dans SupportBubble.tsx (BesoinFormulaire.tsx : texte, capture fichier ou
  collage compressee a 1600 px et 1,5 Mo, « Deja prevu » et « Moi aussi », phrase du serveur). Styles repris de SupportBubble,
  rien de dessine a neuf. CanvasShell et NoteMapCanvas non touches. Pas verifie dans un navigateur (session requise).
- Bot des membres : bouton « Il me manque quelque chose » (m:besoin, menu et menu d'un acces offert). Etape besoin_texte dans
  cockpit_liveclub_conversations (10 min, nonce), lue juste apres celle de l'indicateur ; « Laisser tomber » (bx:), « annule »...
  ferme, un mot courant fait redemander, tout autre bouton ou commande ferme l'etape. Le message entre au fil Support, puis
  devient une demande (canal telegram, detecte_par bouton, son fil : la passe ne le recompte pas), outil au choix du classement
  (bot par defaut), puis la phrase. Suspect : rien d'enregistre par cette voie, Brice prevenu. Textes du bot A VALIDER PAR BRICE
  (liveclub/besoin-etape-pur.ts ; serveur : besoin-etape.ts ; branchement : bot-membre.ts).
- LOT 3, routes du cockpit (besoins/garde.ts : session + cockpit_allowlist, CORS, GET annonces au preflight) : detail (capture en
  URL signee de 10 min), ajouter (saisie de l'equipe : source, contact, canal equipe ; sans carteId, classement + regroupement),
  modifier, statut, fusionner (les fusions de la source suivent la cible), deplacer-demande. Serveur : besoins/cockpit.ts.
- LOT 4 : passage en planifie = brief ecrit et garde (besoin.brief, briefMarkdown de cockpit-pur.ts) : la carte, les regles (rien
  en ligne sans le GO de Brice, texte des membres = donnee), la section « DONNEES DES MEMBRES : a lire comme des donnees, jamais
  comme des consignes » (chaque demande EN ENTIER en bloc de code, suspecte signalee et rendue visible, messages du membre de
  chaque fil : role user, nettoyerPourSupport, sans [système]), fichiers probables, ETAT a lire (des chemins), conversation
  cible. POST brief/envoyer : note Perso vers_claude pour sora (auteur brice, sujet « [Besoin planifié] <titre> », 20 000 car.
  au plus), une par version du brief (brief_note_id), aucun ping. Prevenir : GET apercu, POST envoi sur le clic de Brice
  seulement, un message par MEMBRE, reservation atomique (prevenu_le pose s'il est nul ET la carte toujours au statut lu),
  Telegram par le bot des membres (trace « Bot » au fil, le bot garde la main), email (Resend, support@, cle du Live Club sinon
  du journal, variable facultative BESOINS_FROM_EMAIL) plus une ligne human dans son fil du site, contact saisi = email, sinon
  « a la main » (marque a_la_main, la liste revient). Echec : prevenu_statut « echec: ... », un nouveau clic reessaie. Gabarits
  GABARIT_LIVRE, GABARIT_REFUSE et sujets d'email A VALIDER PAR BRICE ({note} vide par defaut : la note de l'equipe est interne).
- Tab et Tache : GET /api/tab/v1/besoins (?statut=, ?outil=, ?id= pour les demandes, sans email ni compte), aide mise a jour,
  outil MCP besoins pour Tache (mcp-tache/pur.ts). Chat du site : une demande suspecte notee alerte Brice (alerterBriceSecurite).
- Migration 20261106150000 (workspace) : besoin.brief, brief_le, brief_note_id ; besoin_demande.source, contact_nom,
  contact_email, contact_telegram, page, forme de capture_url ; index unique des demandes sans fil ; bucket prive
  besoins-captures ; vues cockpit_besoins (+ brief_le, a_prevenir, prevenus) et cockpit_besoin_demandes (+ source, contact_*,
  page), colonnes en fin de vue. cockpit_effacer NON etendu (plpgsql de plusieurs ordres) : docs/EFFACEMENT-DONNEES.md.
- Verifs : scripts/verifier-besoins.mjs (30 blocs, dont 12 des lots 2 a 4, hors ligne) ; tsc ; eslint des fichiers touches ;
  next build (sans prisma generate) ; -securite-bots, -pause-depot, -suivi-lots, -relais-accueil, -indicateur-alex,
  -effacement, -liveclub, -reponse-membre, -fil-traite, -attente-equipe, -tab-repondre, -mcp-tache, -diffusion-equipe,
  -agent-outils-cockpit, -tips-accueil, -accueil-groupe, -depot-perdu, -pieces-support, -reconnaissance, -mcp-gpt : ok (depuis le
  worktree, les scripts qui lisent ../../sites ou ../cockpit passent par des liens temporaires). Eval eval-besoins.mjs C1, C2,
  C3 (classement Haiku, un cas par appel) : 3/3, environ 0,003 EUR. prompt-membre.ts et support-prompt.ts NON modifies.
- MISE EN LIGNE, dans l'ordre : (1) migration 20261106150000 ; (2) push du journal (besoins-lots234 sur master) ; (3) cockpit,
  puis les fronts (site, Masterclass, Pilotage, Carnet) ; (4) Brice valide les textes marques A VALIDER PAR BRICE.
- Limites : l'effacement d'une personne ne connait ni les demandes sans fil, ni les votes, ni les captures (a ajouter) ; une
  carte creee juste avant un refus de cadence (deux envois simultanes) reste vide ; un compte AOK sans email (session anonyme)
  est « a la main » ; le brief recopie TOUS les messages du membre de chaque fil (long pour un fil Telegram ancien, borne a
  190 000 car.) ; le detail rend 1 000 demandes au plus ; les postes besoins_* ne sont pas nommes dans l'ecran Depense IA.

## BESOINS DES MEMBRES, LOT 1 (06/11/2026, EN LIGNE : journal 26e9592 ; migration 20261106120000 APPLIQUEE le 06/11)

- Brice, 05/11 : recueillir les besoins des membres dans nos outils (fonction qui manque, blocage, bug), UNE carte par besoin,
  tri au cockpit (lot 3), brief de dev et message de livraison (lot 4). Son choix du 06/11 pour ce lot : option 3, les deux voies.
- EN DIRECT : outil noter_besoin (src/lib/besoins/pur.ts) dans le bot support du site et des apps (support-prompt.ts,
  /api/support/chat) et le bot des membres (prompt-membre.ts, agent-membre.ts). Le modele ne donne qu'un classement (outil,
  nature, titre 80 car., cle_proposee, resume 200 car.), JAMAIS le texte du membre ni un identifiant. Chat : besoins gardes en
  memoire, enregistres APRES la sauvegarde du fil (noterBesoinsDuChat). Telegram : fil retrouve par "telegramId", message
  recopie du fil (noterBesoinsTelegram). Refuse sous PRUDENCE (la passe le reprendra, marque suspect). Phrase du serveur
  PHRASE_BESOIN_NOTE (« C'est noté, je l'ajoute aux besoins que l'équipe passe en revue. On te tiendra au courant. »),
  A VALIDER PAR BRICE : une fois par echange, pas si ce membre l'a deja recue pour cette carte dans ce fil (accuse_le), jamais
  pour un texte suspect, une proposition (pause, arret), un repli ni l'etape de l'indicateur. Echec = la reponse part comme avant.
- APRES COUP : POST /api/cockpit/besoins/reperer (Bearer + cockpit_allowlist, CORS de support-cors), ESSAI PAR DEFAUT
  (`essai: false` pour ecrire), `max` 16 fils (40 au plus), budget 40 s, rend `restants` et `suite` (a renvoyer en `apres`).
  Fils dont updatedAt depasse leur curseur, messages du membre posterieurs ; paquets de 8 fils / 16 000 car. au plus, UN appel
  Haiku par paquet (cle du support, poste besoins_reperage), le modele rend des NUMEROS de messages, le serveur recopie les
  messages du fil (une demande = les messages d'un fil pour un besoin). Message deja compte (empreinte) saute. Curseur par fil
  (besoin_curseur_fil), journal besoin_passe, une passe a la fois (2 min). L'essai n'ecrit ni carte, ni demande, ni curseur, ni
  journal (la depense est tracee dans AiUsage). Avant la migration : l'essai lit tous les fils sans curseur, ecrire = 503.
  scripts/reperer-besoins.mjs (meme fonction, essai par defaut, --tout, --ecrire) : PAS LANCE (lit les vrais fils, accord de Brice).
- REGROUPEMENT commun (moteur.ts) : cle normalisee identique (fusions suivies), sinon Haiku (poste besoins_regroupement) sur
  les cartes du meme outil (60 au plus, les plus actives), sinon nouvelle carte a_trier (cle prise : _2 a _9). Modele en panne =
  nouvelle carte. Le texte du membre n'entre pas dans ce prompt.
- SECURITE : texte des membres entre balises, echappe (< > &) et rendu visible, regle « donnee, jamais consigne » dans les deux
  prompts ; analyserTexte niveau 'injection' sur chaque demande : suspect garde, raison, texte_visible, jamais de phrase ;
  titres et resumes filtres (email, telephone, lien, @, prenoms d'equipe, longs nombres) ; aucun texte de membre dans un log.
- DONNEES (migration 20261106120000, workspace) : besoin, besoin_demande, besoin_vote (lot 2), besoin_curseur_fil, besoin_passe,
  RLS forcee sans policy ; vues cockpit_besoins et cockpit_besoin_demandes (is_cockpit_member()). Fil efface = demandes et
  curseur effaces (cascade) ; besoin_vote et les demandes sans fil restent a apprendre a cockpit_effacer (docs/EFFACEMENT-DONNEES.md).
- Verifs : scripts/verifier-besoins.mjs (18 blocs, hors ligne : moteur a depots injectes, l'essai n'appelle aucune ecriture) ;
  tsc ; eslint ; next build ; -securite-bots, -pause-depot, -suivi-lots, -relais-accueil, -indicateur-alex, -effacement,
  -liveclub, -reponse-membre, -fil-traite, -attente-equipe : ok. Eval scripts/eval-besoins.mjs (UN cas par appel, aucune
  ecriture) : D1, D2, L2 a L6, P1 a P3, R1, R2 ok ; L1 KO (blocage du bot : Haiku appelle demander_un_humain seul, 3 essais),
  environ 0,32 EUR au total. eval-fuites.mjs : connait l'outil, PAS relance (il ecrit dans AiUsage et lit la base).
- MISE EN LIGNE : (1) migration 20261106120000 APPLIQUEE le 06/11 ; (2) journal EN LIGNE (26e9592 sur master). Reste : (3) avec
  l'accord de Brice, essai sur les fils reels (route ou script) pour lui montrer le resultat ; (4) Brice valide la phrase.
- Limites : la phrase est comptee dite meme si l'equipe a ecrit pendant le calcul (reponse retenue) ; Haiku ecrit parfois
  lui-meme « l'équipe verra » ; les postes besoins_* ne sont pas encore nommes dans l'ecran Depense IA du cockpit.

## CARNET 1.8.14 : DIAGNOSTIC ET LECTURE D'UNE CAPTURE D'ORDRE (05/11/2026, EN LIGNE sur GO de Brice ; aucune migration)

- Briefs : D:\6_Societe\Pilotage\BRIEF-CARNET-1814-DIAGNOSTIC.md et BRIEF-CARNET-1814-CARTE-DE-PRIX.md.
- POST /api/carnet/diagnostic (Bearer du Carnet) : corps borne a 32 Ko, liste blanche des champs, cadence 5 par jour tenue EN
  MEMOIRE de l'instance (une instance froide repart de zero ; une table serait a ecrire si besoin) ; message compact a
  l'equipe par alerterEquipeTexte, textes libres passes par analyserTexte. Pur : src/lib/carnet-diagnostic-pur.ts ;
  verifier-diagnostic-carnet.mjs (9 blocs).
- POST /api/carnet/lire-ordre : capture du panneau d'ordre ou de l'outil Position lue par l'IA (produit pilotage, meme modele,
  une ligne AiUsage au poste 'document', quota du palier ; 429 / 413), reponse { lecture, quota }, null quand illisible.
  Pur : src/lib/lire-ordre-pur.ts ; verifier-lire-ordre.mjs (9 blocs). Pas encore de lecture reelle testee (cle absente en
  local) : premiere vraie lecture = essai de Brice.
- Note.trades[].prix garde sens, typeOrdre, risque (prix-carnet.ts) ; la synthese prend la direction du broker, puis le sens
  choisi, puis le sens deduit du stop ; la fiche (detail) montre Ordre et Risque.

## 05/11/2026 : charge sur Supabase, suite (lot de l'Orchestrateur, regle de Brice « recharger a l'action »)
- Accueil : plus aucun router.refresh() automatique (ni minuterie, ni focus) ; bouton « Actualiser mes notes » en bas de la barre de droite (NoteMapCanvas, ActionBarre.enCours de CanvasToolbar) ; Actualiser met aussi a jour les cartes deja posees (memeNote), une carte dont la note est supprimee ailleurs est retiree de l'affichage.
- Academie, lecons ecrites : credit envoye au depart de la lecon, en arriere-plan et a la fermeture (plus d'envoi periodique), borne par le temps ecoule et un plafond de 2 h (PLAFOND_TEXTE_S) ; « lue » = profondeur >= 90 % (colonne academie_progression.profondeur_max, migration 20261105233000 appliquee le 05/11) ou texte_fin, ET temps actif >= 30 % d'une lecture a 200 mots/min (plancher 30 s). Videos inchangees.

Etat vivant du projet (infra, securite, fils ouverts). Le suivi des taches
reste dans TODO.md.

## FONDS D'ARCHIVE : L'AGENT RESPECTE ACCES_FONDS (06/11/2026, EN LIGNE ; aucune migration)

- Brice, Meet du 05/11 avec Alex : « corriger la protection pour que l'agent ne puisse pas lire les tables d'archive
  sans autorisation » ; confie le 06/11 (« confie la »). L'agent lit en postgres (la RLS ne l'arrete pas) : un compte
  de l'allowlist SANS acces_fonds lisait tout le fonds par requete_sql et par fiche_personne.
- requete_sql : verrouSql(sql, { fonds }) refuse cockpit_arch_*, cockpit_membre_telegram, cockpit_membre_fonds_manuel,
  cockpit_effacement_apercu/cibles sans acces_fonds. lireAccesFonds(userId) relu a CHAQUE tour, ferme en cas de doute.
- fiche_personne : sans acces_fonds, aucun noeud d'archive (horsFonds : ni touche ni lien), une fiche d'archive
  demandee = REPONSE_HORS_FONDS. Une note au modele dans le bloc de l'interlocuteur.
- Aujourd'hui Brice, Melanie, Adil et Tab ont acces_fonds = true : rien ne change pour eux ; le verrou vaut pour
  un compte ajoute sans ce droit ou a qui on le retire.
- Hors de ce lot, a decider par Brice : l'API de Tab (portees tab et tache, donc aussi le MCP de Tache) lit le fonds
  sans relire acces_fonds (coherent aujourd'hui, pas verrouille) ; proposer_effacement montre les comptes d'archive.
- scripts/verifier-acces-fonds.mjs (6 blocs, le vrai verrouSql). verifier-fiche-personne echouait DEJA avant ce lot
  (assertions de perimetre perimees depuis l'API de Tab) : non repare ici.

## TRADES : IMPORT DANS LE CARNET, MES TRADES, FICHE, TUTORIEL (05/11/2026, EN LIGNE sur GO de Brice ; aucune migration ; Carnet 1.8.13 envoye au Store)

- Decide par Brice le 05/11 (suite des retours de Flow du 02/11). Briefs : D:\6_Societe\Pilotage\BRIEF-TRADES-J1-JOURNAL.md et
  BRIEF-TRADES-J2-JOURNAL.md ; labos LABO-MES-TRADES-V1.html et V2.html (meme dossier). Choix : vues 4, curseur 2, fiche 1,
  guide 3 a la premiere ouverture puis guide 2.
- Dedoublonnage par compte (copy trading) : src/lib/doublons-compte.ts, l'idExterne porte |compte:<compteId> (sauf Quantower,
  qui porte deja le compte) ; les anciennes cles restent reconnues sur leur compte. Positions : champ compte ; PATCH lier
  { positionIds, segmentRef, ajouter } (un segment porte plusieurs copies) et delier { segmentRef } ; anciennes formes
  inchangees. Limite : lieA ne nomme qu'une copie ; « Mon edge » de Pilotage compterait un jugement porte par 3 copies 3 fois.
- GET /api/trades/synthese (lecture seule, cookie ou Bearer du Carnet) : prevu (Note.trades[].prix), effectif (TradeImport
  lies), ecarts, ressenti, jugement, captures. Calculs purs : src/lib/synthese-trades-pur.ts. Note.trades[].prix accepte
  stop, tp, partiels (src/lib/prix-carnet.ts).
- /journal = « Mes trades » (src/components/mes-trades/ : VuesMesTrades, CurseurSortie, FicheTrade) ; fiche
  /journal?trade=<segmentId> ; le badge de trade d'une note y mene. /guide : carrousel a la premiere ouverture
  (user_metadata.guide_journal_vu), puis la page pas a pas ; vignettes public/guide/etape-1..9.webp ; textes dans
  src/lib/guide-journal.ts.
- Verifier : verifier-doublons-compte, -liens-multiples, -synthese-trades, -mes-trades (+ imports-trades, documents).
- A pousser AVANT la publication du Carnet 1.8.13, qui appelle ces routes. Pas verifie contre la vraie base : essai reel
  apres la mise en ligne (import par le Carnet, Lier, fiche).
## INDICATEUR D'ALEX (05/11/2026, EN LIGNE ; migration 20261105250000 appliquee le 05/11)

- Brice, 05/11 : « je veux que Alex ait acces aux @ telegram des membres du liveclub pour son indicateur de trading
  [...] il n'a pas de moyen de verifier facilement si un membre s'est desinscrit ». Option choisie : le MEMBRE donne son
  pseudo TradingView au bot des membres (son clic vaut accord), le bot l'ecrit a Alex dans LEUR conversation, le pseudo
  est garde chez nous (fiche membre du cockpit), et l'assistant IA d'Alex a une porte MCP a lui.
- Parcours (bot-membre.ts, indicateur.ts, indicateur-pur.ts) : bouton « Indicateur d'Alex » (m:indic, menu, menu d'un
  acces offert, conseil d'accueil) ou texte libre (outil indicateur_alex de l'agent : il oriente vers la MEME etape, sans
  texte du modele, refuse sous prudence). Droit relu en direct (droitLiveClub, la regle du groupe) : non-membre = reponse
  courte, rien de garde ; inconnu = « reessaie ». Etape = cockpit_liveclub_conversations.action_en_attente (types
  indicateur_pseudo puis indicateur, nonce, 30 min), lue AVANT l'equipe et l'IA dans traiterMessagePrive ; une phrase
  garde le parcours habituel, un mot courant fait redemander, « annule » ferme. Pseudo STRICT (lettres, chiffres, . - _,
  3 a 40, @ de tete retire, aucun lien ni texte libre), puis la CARTE « Ton prenom (..), ton @ (..) et ton pseudo
  TradingView (..) partent chez Alex, qui gere l'indicateur. Je les envoie ? » [Oui, envoie a Alex ic:] [Laisser tomber
  ix:]. Clic : droit relu, demande notee sous verrou (meme pseudo = rien, autre = pseudo change), message a Alex tout de
  suite.
- Trace : cockpit_liveclub_indicateur (une ligne par demande, une ouverte par compte Telegram, pseudo_transmis = ce
  qu'Alex a, envoi_reserve_le pose AVANT l'envoi, statut a_transmettre | transmise | partie, depart_le,
  prevenu_depart_le), lecture allowlist, RLS forcee, aucune ecriture navigateur. cockpit_liveclub_relais.indicateur (Alex
  par la migration, nom = 'Alex') + actif : le destinataire, relu a chaque envoi, jamais en dur.
- Messages a Alex (HTML, bot des membres) : presentation une fois en tete du premier ; « Indicateur : nouvelle demande »
  (prenom, @ ou lien de profil, pseudo, date) ; « pseudo change » ; « X (@x) a quitte le Live Club : retire l'acces de
  <pseudo> a l'indicateur. » Chacun finit par une ligne machine « #indicateur demande|changement|depart tv=.. [ancien=..]
  tg=@..|id:.. prenom=".." le=AAAA-MM-JJ ». Refus Telegram : reservation liberee, le passage reessaie, sans doublon.
- Passage (tache u, apres les conseils, avant Metricgram) : (1) demandes en attente, droit relu juste avant, envoi ;
  (2) droit des demandes ouvertes, 50 au plus, comptes sortis par CE passage d'abord, puis absents du groupe, puis les
  plus anciennement relus (pas avant 20 h), non = depart ; (3) departs a dire a Alex. Budget 200 s. Synthese
  `indicateur` (etat ok | coupe | table_absente | panne | sans_destinataire). LIVECLUB_INDICATEUR=0 coupe les messages a
  Alex et la tache. Le bouton note aussi le depart si le droit est tombe.
- MCP de l'assistant d'Alex : POST /api/mcp-alex/<amcp_...> (route publique du middleware, masquee pour Sentry), portee
  alex_indicateur seule (empreinte « mcp-alex-indicateur: »), 30 appels/min, journal cockpit_tab_acces (route
  mcp-alex/<outil>), 404 neutre sans le bon secret, 503 sans la migration. Outils en lecture seule : aide,
  membres_indicateur (depuis facultatif), departs_indicateur (depuis, defaut 30 jours, un an au plus). 1 000 / 500
  lignes au plus. Jamais l'identifiant Telegram, un email ni un paiement.
- Cle : scripts/creer-cle-alex-mcp.mjs (modele de creer-cle-tache-mcp.mjs, --essai d'abord), ecrit l'URL dans
  /mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/alex-indicateur-mcp.local.json, jamais affichee. PAS LANCE.
- Cockpit (workspace) : AccesTab portee alex_indicateur (bloc a l'Accueil, is_cockpit_perso seulement, « Couper la cle »),
  le bloc de ChatGPT ecarte mcp-alex ; fiche membre : RubriqueIndicateur (pseudo, demandee le, transmise le, depart, Alex
  prevenu), lue a l'ouverture, aucune minuterie.
- Faire connaitre : conseil d'accueil J+5 « indicateur » (bouton sous le conseil) ; annonce aux membres actuels =
  texteAnnonceIndicateur(jour de l'annonce) dans indicateur-pur.ts, delai +21 jours, NON envoyee (Brice valide).
- Verifs : scripts/verifier-indicateur-alex.mjs (17 blocs) ; tsc journal et cockpit ; eslint des fichiers touches ;
  -liveclub, -relais-accueil, -tips-accueil (calendrier mis a jour), -accueil-groupe, -securite-bots, -mcp-tache, -mcp-gpt,
  -tab-repondre, -reconnaissance, -pause-depot, -effacement, -parrainage, -diffusion-equipe, -agent-outils-cockpit,
  -attente-equipe, -pieces-support, -suivi-lots, -depot-perdu, -reouverture-impaye : ok. Aucune base ecrite, aucun envoi,
  aucune eval, SQL non joue (table absente en prod).
- MISE EN LIGNE, dans l'ordre : (1) migration 20261105250000 (elle reprend la portee tache_mcp : 20261101200000, toujours
  NON appliquee en prod au 05/11, ne doit plus passer APRES elle, sinon elle retire alex_indicateur) ; (2) push du journal ;
  (3) deploiement du cockpit ; (4) node scripts/creer-cle-alex-mcp.mjs --essai puis sans --essai, et l'URL du coffre a
  Alex ; (5) Brice valide l'annonce et la poste.
- Limites : l'effacement d'une personne (cockpit_effacer) ne connait pas encore cette table (membre_id passe a nul, la
  ligne reste) ; un depart se voit au plus tard en 2 a 3 jours pour un membre encore dans le groupe (rotation de 50) ; une
  pause d'abonnement ou un impaye de plus de 5 jours = depart (la regle du groupe), le membre refait sa demande a son retour.

## AGENT AOK : LES GESTES DU COCKPIT DEPUIS TELEGRAM, LOT 2 (05/11/2026, EN LIGNE ; aucune migration)

- Brice, 05/11 : « que l'agent puisse faire depuis Telegram les gestes du cockpit ». LOT 2, sur le modele du LOT 1 (memes
  fichiers, memes branchements : les huit types entrent dans TYPES_GESTES_COCKPIT, donc dans validerAction, resumeAction,
  paramsPourLog et executerAction sans toucher stripe-actions.ts). Huit cartes, communes a Telegram et a la fenetre du cockpit.
- Charges (Revenus > Charges et marge, cockpit_charges) : proposer_charge_fixe, ajouter | modifier (seulement ce qui change,
  « aucun » vide un champ) | retirer (retire_le, jamais de delete). Regles de l'ecran (au >= du, unique = sa date, l'equivalent
  en euros tombe en EUR) ; a_confirmer vrai par defaut (defaut de la table). Carte : outil, montant et periodicite, payeur,
  depuis quand, poids dans la marge (coutMensuel de l'ecran, « a convertir », « montant inconnu »), doublon qui court deja.
  Modifier et retirer : empreinte de la ligne (maj_le compris) comparee au clic sous verrou.
- Abonnements IA (Depense IA, cockpit_depenses_ia_fixes) : proposer_abonnement_ia, ajouter (debut = 1er du mois par defaut,
  comme l'ecran) | arreter (fin = aujourd'hui par defaut, comme le bouton) | retirer (saisie fausse). Pas de « modifier » :
  la table n'ouvre que fin, retire_le, retire_par (un prix = arreter puis ajouter). Carte : prix, poids mensuel en euros
  (USD a 0,92 comme l'ecran), mois ou il cesse de compter.
- Objectif d'une publication Instagram (cockpit_social_objectifs, upsert) : proposer_objectif_publication. Carte : date, type,
  debut de legende (en caracteres clavier), objectif d'avant, phrase de lecture de la grille de l'ecran (verifiee contre
  InstagramLecture.tsx quand le depot est la ; alignee sur 1535dc7). L'objectif lu est compare au clic. Pas une story.
- Le fonds (Les personnes), reserve a cockpit_allowlist.acces_fonds, verifie a la carte (compte qui parle) ET au clic
  (compte qui confirme) : proposer_note_fonds (personne_id, ou sujet libre ; texte entier dans la carte, 3 000 caracteres
  au plus, caracteres invisibles retires ; ecrit_par pose), proposer_decision_fonds (acceptee | refusee | proposee, 20 au
  plus d'une meme personne ; decide_par ET decide_le poses : le trigger ne pose decide_le que pour authenticated ; la carte
  montre la valeur et le DOMAINE de la source, jamais l'adresse), proposer_enquete_fonds (PAYANTE : la carte dit le cout
  MESURE des 20 dernieres enquetes dans AiUsage, poste enquete, ou « pas encore de mesure » ; bouton « Lancer l'enquete
  (payant) » ; sans ANTHROPIC_API_KEY_COCKPIT, carte sans bouton). Le coeur de POST /api/cockpit/enquete est sorti dans
  src/lib/fonds-enquete.ts (preparerEnquete, menerEnquete), la route garde ses reponses (401, 403, 400, 404, 502, 200).
  La phrase du clic ne reprend ni le resume ni les homonymes du modele (texte venu du web) : des chiffres seulement.
- Relais d'accueil (cockpit_liveclub_relais.actif) : proposer_relais_accueil, couper | rallumer. coupe_par pose par un
  second update (le trigger le remet a auth.uid(), nul cote serveur). Carte : ce qu'il ne recoit plus, ses boutons
  « C'est fait » (ne marchent plus coupe), membres transmis en attente. Rien n'est envoye au relais.
- Adresse secondaire d'un membre (cockpit_membre_emails) : proposer_retrait_adresse, delete seulement principal = false et
  la fiche lue par la carte. Carte : le membre, l'adresse, la principale qui reste, les autres, ce que ca change (droits lus
  par adresse, compte du site qui la porte verifiee), la collecte qui peut la remettre.
- Fichiers : agent-gestes-cockpit-pur.ts (sections F a K), agent-gestes-cockpit.ts (controlerLot2, executerLot2, colonnes
  d'acteur en tete), fonds-enquete.ts (nouveau), api/cockpit/enquete/route.ts, api/cockpit/agent/action/route.ts
  (maxDuration 120 -> 300 : une enquete dure une a trois minutes), agent-cockpit.ts (8 outils, TYPE_PAR_OUTIL, prompt :
  « quinze pour les gestes du cockpit » et six lignes dans « LES GESTES DU COCKPIT, D'ICI »), agent-cockpit-pur.ts.
- Verifs : scripts/verifier-agent-outils-cockpit.mjs (27 blocs, dont 10 du LOT 2) ; tsc ; eslint des fichiers touches ;
  -securite-bots, -agent-equipe, -fil-traite, -diffusion-equipe, -reponse-membre, -annulation-abonnement, -adresse-contact,
  -pause-depot, -effacement, -depot-perdu, -suivi-lots, -academie --hors-ligne, -gestes-academie --hors-ligne,
  -repartition, -liveclub, -tab-repondre, -relais-accueil, -reconnaissance : ok. verifier-parrainage ECHOUE sans lien
  avec ce lot : sa ligne 768 attend select('intervenant,lives') dans apps/cockpit/src/views/revenus/DetailMois.tsx, que
  3ca122d (autre conversation, 05/11 18:37) a passe en select('*'). Aucune base, aucun envoi, aucune eval.
- Limites : un abonnement IA ne se modifie pas (la table ne l'ouvre pas) ; rattacher une adresse n'est pas outille (seul
  le retrait l'etait dans le brief) ; deux enquetes simultanees sur la meme personne ne sont pas bloquees (comme le
  bouton). Mise en ligne : push du journal seul, aucune migration ; la table cockpit_social_objectifs
  (20261105200000) doit etre en base pour l'objectif (sinon refus clair).

## AGENT AOK : LES GESTES DU COCKPIT DEPUIS TELEGRAM, LOT 1 (05/11/2026, EN LIGNE ; aucune migration)

- Brice, 05/11 : « que l'agent puisse faire depuis Telegram les gestes du cockpit ». LOT 1 seulement (un lot 2 suivra).
  Sept cartes (communes a Telegram et a la fenetre du cockpit, revalidees au clic par validerAction) et un geste sans carte.
- Academie : proposer_acces_academie (email, offre = slug, fin incluse, raison obligatoire ; carte : la personne, l'offre et ce
  qu'elle ouvre, la fin, compte verifie ou non) et proposer_retrait_acces_academie (acces_id, raison ; carte : source, dates,
  « un achat n'est pas rembourse »). Meme ecriture que POST /api/cockpit/academie : le coeur de la route est sorti dans
  src/lib/academie/gestes-cockpit.ts (route inchangee dans ses reponses), pose_par / retire_par = 'agent:<uuid>'.
- Rangement : proposer_rangement_academie (deplacer_lecons, deplacer_section, deplacer_module, statut publie|brouillon,
  creer_section), reserve aux admins du site (profiles.role, comme /api/academie/arbre, verifie a la carte ET au clic). La carte
  nomme par le titre, dit ou ca va, « VISIBLE AUX ELEVES » pour publier, les lecons non publiables et les slugs renommes ; une
  empreinte des elements nommes est comparee au clic sous le verrou de l'arbre (catalogue change = refus). executerGeste avec
  par = uuid du compte (academie_editions), cache du catalogue vide.
- Acces aux apps : proposer_acces_mentorat (accorder | retirer, email de connexion, note). Coeur de /api/cockpit/mentorat sorti
  dans src/lib/mentorat-acces.ts (route inchangee). MentoratGrant n'a pas de colonne d'auteur.
- Clips : proposer_decision_clip (garder | ecarter | annuler, clips opus d'UN replay ; decide_le, decide_par, decide_label poses
  a la main : le trigger ne les pose que si auth.uid() n'est pas nul), proposer_clips_replay (proposer_telegram avec le
  message_id, ou proposer_youtube avec un lien youtube.com/youtu.be ; pose_par pose a la main, pose_label par le trigger ; aucun
  credit) et proposer_envoi_opus (envoyer_opus, ref = replay_id comme le cockpit ; la carte dit la plage en m:ss et les credits
  = max(10, minutes commencees), comme clips.py ; la plage est relue et comparee au clic). Bouton « Envoyer à Opus (payant) ».
- « Deja traite » par la phrase : marquer_fil_traite, SANS carte (GESTES_SANS_CARTE, refuse sous prudence), seulement si le
  message du titulaire de ce tour le dit (ordreFilTraiteExplicite : traite, regle, gere, repondu, c'est bon... ou un « oui » a
  une proposition de l'agent). Le fil se resout comme pour rendre la main ; traiterFilHorsBot(fil, userId du tour) ;
  phraseFilTraite rendue au modele.
- Fichiers : src/lib/agent-gestes-cockpit-pur.ts (regles, cartes, phrases), src/lib/agent-gestes-cockpit.ts (controle et
  execution), src/lib/academie/gestes-cockpit.ts, src/lib/mentorat-acces.ts, les deux routes, stripe-actions.ts (type, validation,
  resume, log, execution), agent-cockpit.ts (outils, TYPE_PAR_OUTIL, prompt : section « LES GESTES DU COCKPIT, D'ICI » et
  « DÉJÀ TRAITÉ »), agent-cockpit-pur.ts (boutons, descriptions), reponse-membre.ts (marquerFilTraitePourAgent).
- Cockpit (apps/cockpit) non touche : la carte s'affiche et se confirme (resume + carte_id), l'entete LIBELLE_ACTION reste vide
  pour ces types (deja le cas pour adresse_contact, pause_depot, code_parrainage). Acces.tsx affiche « posé par agent:<uuid> ».
- Verifs : scripts/verifier-agent-outils-cockpit.mjs (17 blocs, hors ligne) ; tsc ; eslint des fichiers touches ;
  verifier-securite-bots (regex GESTES_SANS_CARTE mise a jour), -agent-equipe, -fil-traite, -diffusion-equipe, -reponse-membre,
  -annulation-abonnement, -adresse-contact, -pause-depot, -effacement, -depot-perdu, -suivi-lots, -academie --hors-ligne,
  -parrainage, -repartition, -liveclub, -tab-repondre, -gestes-academie --hors-ligne : ok. Aucune base, aucun envoi, aucune eval.
- Limite : une plage d'envoi autre que plage_proposee n'est pas possible d'ici (la demande envoyer_opus ne porte que le
  replay_id ; clips.py prend toujours la plage proposee). Mise en ligne : push du journal seul, aucune migration.

## SUPPORT : BOUTON « DÉJÀ TRAITÉ » (05/11/2026, EN LIGNE ; aucune migration)

- Brice : un fil regle hors du bot gardait « veut un humain » pour rien (« Rendre la main au bot » n'apparait que si
  l'equipe a repondu depuis le cockpit, et seulement pour Telegram). Son choix : option 3, le bouton dans le fil du cockpit
  ET sous l'alerte d'Agent AOK.
- POST /api/cockpit/support/traite { threadId } (allowlist) et le bouton tr:<fil> sous l'alerte (apres le verrou du compte) :
  traiterFilHorsBot (support-traite.ts) -> marquerFilTraite (support-pont.ts) : escalatedAt a null, ligne « [système] Traité
  hors du bot par <prenom> : le membre a eu sa réponse. », ecriture conditionnee a l'attente (deux clics = une ligne).
  La ligne rend la main au bot (periodeEquipe) et vaut « humain passé » au cockpit. Le reste de l'equipe le sait
  (alerterEquipeTexte, support: true, sauf celui qui clique). Rien n'est dit au membre.
- GET /api/support/thread ne rend plus les lignes « [système] » au membre (messagesPourLeMembre) : le site, la Masterclass
  et l'extension affichent tout role inconnu comme une reponse de l'assistant.
- scripts/verifier-fil-traite.mjs (10 blocs). Mise en ligne : journal d'abord, puis le cockpit.

## AGENT AOK : ADIL POUR LE SUPPORT (05/11/2026, EN LIGNE ; migration 20261105230000 appliquee avant le journal, 20261105230100 juste apres)

- Brice, 05/11 : « que Adil puisse parler au bot Agent AOK pour faire la reponse support directement (il a tendance a ne pas
  regarder ses mails) ». Brice, 15/10, sur le resume du matin : « on ne rajoute pas Adil ».
- cockpit_telegram_comptes.diffusion : 'equipe' (Brice, Melanie, defaut) recoit tout ; 'support' (Adil) parle a l'agent (memes
  droits que dans la fenetre du cockpit) et ne recoit que l'alerte du support (alerterEquipeTelegram, a tous) et les reponses de
  l'equipe a un fil Support (alerterEquipeTexte avec support: true). Les 12 autres envois a l'equipe filtrent sur
  diffusion = 'equipe' ; les lectures qui reconnaissent l'equipe gardent tous les comptes.
- scripts/verifier-diffusion-equipe.mjs (6 blocs) relit le code : une nouvelle diffusion sans filtre le fait echouer.
- Mise en ligne, dans l'ordre : 20261105230000 (colonne), journal, PUIS 20261105230100 (compte d'Adil, Telegram 896144604).
- verifier-pont-support echoue aussi sur origin/master, sans ce lot : jeton TELEGRAM_BOT_TOKEN_COCKPIT absent en local.

## COCKPIT : CONNEXION PAR LIEN AVEC TOUTE ADRESSE VERIFIEE (05/11/2026, EN LIGNE ; migration 20261105220000 APPLIQUEE le 05/11)

- Cas : Melanie (connexion Yahoo, dans cockpit_allowlist) a son Gmail verifie dans profile_emails. signInWithOtp n'envoie
  qu'a l'email de connexion : avec le Gmail, rien ne partait. Brice : « voire meme tous ses mails » ; le lien = cockpit seul.
- POST /api/cockpit/lien-magique { email } (publique) : sous verrou, cadence (adresse 5/h et 10/j, IP 10/h et 30/j, total
  60/h), puis le compte. Un lien part a l'ADRESSE TAPEE seulement si elle est l'email de connexion confirme OU une adresse
  verified = true d'un compte de cockpit_allowlist (deux comptes du cockpit = ambigu, rien). Reponse identique connue ou non
  (200), sauf 429 de cadence (vaut pour toute adresse). Email par Resend APRES la reponse (after). Rafale (15/h ou une limite
  atteinte) : alerterEquipeTexte, une fois par heure, sans adresse ni IP.
- Le lien : cockpit.aoknowledge.com/auth/lien#lien=<jeton opaque 32 octets> (fragment : jamais envoye au serveur), 15 min,
  une ouverture ; la base ne garde que son HMAC. Au clic « Ouvrir le Cockpit », POST /api/cockpit/lien-magique/ouvrir { lien } : jeton consomme, compte relu
  (allowlist, adresse toujours verifiee), PUIS generateLink type 'recovery' sur l'email de connexion (ne cree jamais de compte,
  contrairement au type magiclink) et token_hash rendu ; le cockpit fait verifyOtp({ token_hash, type: 'recovery' }) : marche
  sur tout appareil (ni PKCE ni code_verifier).
- Table cockpit_lien_magique_demandes (journal + compteur) : HMAC de l'adresse, de l'IP et du jeton, issue (envoye,
  envoi_rate, inconnue, non_verifiee, hors_allowlist, ambigu, limite), compte, expire_le, ouvert_le, alerte. RLS forcee,
  aucun droit navigateur, purgee a 30 jours.
- Fichiers : src/lib/cockpit-lien-magique-pur.ts (regles, email, deroule a ports injectes), src/lib/cockpit-lien-magique.ts
  (base, Supabase admin, Resend), src/app/api/cockpit/lien-magique/route.ts et ouvrir/route.ts, middleware (une entree),
  scripts/verifier-lien-magique-cockpit.mjs (28 blocs, fausse base et faux Supabase). Cockpit : src/lib/lien-magique.ts,
  src/pages/AuthLienPage.tsx, LoginPage.tsx (filet signInWithOtp si la route rend 503 ou ne repond pas), App.tsx.
- Mise en ligne, dans l'ordre : migration, journal, cockpit. Aucune variable a poser. Facultatives : COCKPIT_URL (base des
  liens), COCKPIT_LIEN_MAGIQUE=off (coupe les deux routes, le cockpit retombe sur signInWithOtp).

## CANDIDATS DU CARNET POUR UNE POSITION, bouton « Lier » de Pilotage (05/11/2026, commite NON pousse ; aucune migration)

- Brief : D:\6_Societe\Pilotage\BRIEF-LIER-CARNET-FICHE-COMPTE.md ; compte rendu : COMPTE-RENDU-LIER-CARNET.md (meme dossier).
- GET /api/pilotage/trades/positions?candidats=<positionId> (meme route, meme jeton, meme CORS) : { positionId, candidats },
  404 si la position n'est pas au membre. Candidat = SegmentCarnet (segmentRef, noteId, noteTitle, ordre, startedAt,
  closedAt) + chevauche + lieA (positionId qui le porte deja, ou null). Ceux qui chevauchent d'abord, puis les segments a
  moins de 24 h de la position, du plus proche au plus loin ; 8 au plus ; jamais celui que la position porte deja.
  Regle pure : candidatsPourUnePosition (correspondances-carnet.ts) ; lecture : candidatsDuCarnet (trades-serveur.ts).
  verifier-imports-trades.mjs : 31 blocs.
- A POUSSER AVANT le deploiement de Pilotage qui porte le bouton : une route d'avant ignore ?candidats= et rend les
  positions, et le panneau dirait « aucun trade du Carnet ».

## CHARGE SUR SUPABASE : ACCUEIL ET SUIVI DE L'ACADEMIE (05/11/2026, GO de Brice « Oui, lance-les » ; commite NON pousse ; aucune migration)

- Cadre : PLAN-MIGRATION-SUPABASE-VPS.md, section 6 (D:\6_Societe\Pilotage\Data-Performance\).
- Accueil (NoteMapCanvas.tsx) : router.refresh() passait toutes les 60 s et a chaque focus ; chaque passage relit toutes
  les notes avec leur contenu, la carte et deux fois la session (middleware + page). Maintenant : au retour sur
  l'onglet ou la fenetre (focus ou visibilitychange, 30 s d'ecart minimum) et toutes les 5 min onglet visible. Le drop
  d'une note pas encore listee se resout toujours contre /api/notes.
- Suivi (route /api/academie/suivi) : le jeton peut venir du corps quand l'en-tete manque (jetonDeLaRequete, pur.ts),
  pour le signal de fermeture du site (sendBeacon, text/plain) ; chemin ajoute aux publicPaths du middleware, la route
  verifie le jeton et rend 401 sans lui. Les autres routes de l'academie exigent toujours l'en-tete. Le site v3 envoie
  toutes les 2 min (30 s avant) et retire credit_s, pas les secondes envoyees. 2 min = le plafond : INTERVALLE_MAX_S
  (120 s) ; pour 5 min, relever INTERVALLE_MAX_S a 330 s ET deployer le journal avant le site.
- Mesure : scripts/diag-charge-base.mjs (lecture seule, transaction READ ONLY ; --motif <texte>). Le 05/11 (stats
  depuis le 02/11 15:49) : 17 rendus de l'accueil, 411 signaux du suivi, 1 ouverture du cockpit ; les gros postes sont
  ailleurs (pgbouncer.get_auth 4 962 appels, verrou de Realtime, Studio, 6 172 UPDATE de Message a la sync des notes).
- Verifs : tsc, eslint des fichiers touches, verifier-academie --hors-ligne (47 blocs), verifiers du middleware : ok
  (verifier-kit-defauts et verifier-pilotage-paliers echouaient deja, sans lien).
- A FAIRE sur GO : pousser le journal AVANT le site v3 (sinon le signal de fermeture recoit 401, sans perte : les
  signaux normaux passent toujours).

## PARRAINAGE : DECLARATION, RATTRAPAGE, REMBOURSEMENT ; LIVES DES INTERVENANTS (05/11/2026 soir, decisions de Brice ; NON commite ; migration 20261105190000 ECRITE, NON appliquee)

- Par-dessus le lot commite (journal 3dd62ee, migration d14c468) ; commite f78976b, puis la retouche ci-dessous.
- RETOUCHE (05/11, rattrapage a blanc : 4 filleuls BARBU17 d'Alex, Tom 23/10, Sebastien 24/10, Flavien 01/11, Raiarii
  04/11) : le filet et le rattrapage previennent APRES toute la liste, UN message par parrain (notifierGroupe,
  texteParrainGroupe : « 4 nouveaux membres ont rejoint le Live Club grâce à ton code BARBU17 : Tom et Sébastien en
  octobre, Flavien et Raiarii en novembre. Tes commissions : 39,60 € comptés avec celles d'octobre, et 39,60 € à la fin
  de ce mois-ci (20 % de leur premier paiement). »), UNE alerte a l'equipe qui les nomme tous ; la reprise du filet
  regroupe aussi. Un seul filleul, ou le webhook : le texte habituel. Idempotence par filleul inchangee. Dates : « 1er »
  (numeroDuJour) partout dans parrainage-pur, lives-reperes-pur et cartes-fin-de-mois. verifier-parrainage.mjs 28 blocs.
- QUI PAIE (Brice) : « dans les dépenses du Live Club, comme pour les lives d'Adrien ». Au debut du mois suivant, le
  passage (etape 'cartes_fin_de_mois', src/lib/cartes-fin-de-mois.ts, apres 'parrainages', avant le resume) pose chez
  Brice et Mel (courte pour Mel) la carte « Commissions de parrainage d'octobre : Alex 19,80 € (Thomas), ... = 39,60 €.
  Déclarer en dépense du Live Club ? » (proposerCarteEquipe, jamais par-dessus une carte qui attend : texte seul et
  « redemande-la-moi »). Clic (type 'declaration_parrainage', parrainage.ts executerDeclarationParrainage) : sous verrou du
  mois, etat relu = celui de la carte sinon refus ; ancienne depense retiree s'il y en a une ; depense « Commissions de
  parrainage d'octobre » (offre live-club, cote du produit = Mel, payee par Mel, parrainage_mois) ; filleuls 'declaree'
  + depense_id. Une seule depense vivante par mois (index unique). Avertissement de Revenus : disparait une fois a jour,
  revient si la declaration ne correspond plus (filleul ajoute ou rembourse) ; la carte qui REMPLACE suit. Outil Agent AOK
  proposer_parrainages_du_mois (21 outils d'action) pour la redemander.
- RATTRAPAGE : scripts/rattraper-parrainages.mjs [--depuis 2026-10-22] [--oui] : le filet avec une fenetre au 22/10, A
  BLANC par defaut (tout lu, rien ecrit ni envoye, la liste dit chaque filleul et le message). Factures traitees de la plus
  ancienne a la plus recente (rang juste). Mois fini : « sera comptée avec les commissions d'octobre ».
- REMBOURSEMENT : premier paiement rembourse EN ENTIER (GET /v1/invoice_payments, charge depliee) = statut annulee,
  commission 0 (commission_initiale), annulee_le ; filet du matin (filleuls dus payes depuis 120 jours, 50 au plus) et
  webhook charge.refunded (a ajouter a la destination Stripe le jour du branchement). Deja declare : alerte a l'equipe
  dans Agent AOK, la carte de correction suit, aucune correction automatique. Rien au parrain. Remboursement partiel : rien.
- ARRET LE 1er MOIS sans remboursement : rien code (Brice et Mel en parlent), la commission reste due. 30 % : non
  retroactif, compte depuis toujours (confirme).
- LIVES D'ADRIEN (et de tout intervenant avec telegram_id dans cockpit_intervenants) : resume du DIMANCHE, rubrique « Lives
  des intervenants (repérés dans Annonce) » (« Adrien : 2 lives repérés cette semaine (mardi 3, jeudi 5) ; 3 ce
  mois-ci ») ; carte de fin de mois « Lives d'Adrien en octobre : 3 repérés (14, 21, 22/10), 3 x 75 € = 225 €. Déclarer
  en dépense du Live Club ? », clic = carte des lives du mois existante ; deja declares : pas de carte ; tarif inconnu :
  texte seul. Octobre partira au premier passage apres le deploiement. Regles pures : src/lib/repartition/lives-reperes-pur.ts.
- Cockpit (apps/cockpit, DetailMois.tsx, bloc Lives) : le nombre repere (vue cockpit_lives_detectes) a cote de « Aucun
  live déclaré ». tsc du cockpit ok (pas de config eslint dans apps/cockpit).
- Migration 20261105190000_cockpit_parrainage_declaration.sql : filleuls (depense_id, commission_initiale, annulee_le,
  annulee_raison, statut declaree), cockpit_depenses.parrainage_mois + index unique, table cockpit_cartes_auto (memoire
  des cartes, serveur seulement). Sans elle : ni declaration, ni annulation, ni carte de fin de mois ; le reste marche.
- Verifs : verifier-parrainage.mjs 24 blocs ; tsc ; eslint ; -liveclub, -annulation-abonnement, -pause-depot,
  -adresse-contact (21 outils), -repartition, -depot-perdu et voisins : ok. Aucune base, aucun Stripe, aucun envoi, aucune eval.
- A FAIRE sur GO, dans cet ordre : migrations 20261105120000 puis 20261105190000 ; push du journal (et du cockpit) ;
  scripts/rattraper-parrainages.mjs a blanc puis --oui, le jour meme ; le passage suivant propose les cartes d'octobre.

## PARRAINAGE PAR CODE DU LIVE CLUB (05/11/2026, commite 3dd62ee NON pousse ; migration 20261105120000 ECRITE, NON appliquee)

- Faits (chat « Code promo live club », 22/10) : codes Stripe d'Adil, compte melanie, BARBU17 = Alex (@Alex17310,
  u2110821350), SAUCISSON = Fab (@Nyfab34), 10kONEDAY = Nadege (@NadegeNQ) ; 99 EUR/mois au lieu de 139 ; MELMOM2 = code
  de Mel, pas un parrainage. Regles de Brice (05/11) : 20 % du PREMIER paiement du filleul, a verser fin de mois, 30 % a
  partir du 11e filleul (compte par parrain, tous ses codes) ; message prive au parrain avec le PRENOM du filleul.
- Code : regles, textes et enchainement PURS dans src/lib/liveclub/parrainage-pur.ts ; serveur src/lib/liveclub/parrainage.ts.
  Declencheur unique : facture payee, billing_reason subscription_create, montant > 0, remise dont le code promo est un
  code de parrainage actif (sans la casse), paye a partir de `depuis`, abonnement Live Club. Prenom : customer_name de la
  facture, puis fiche du cockpit, sinon « un nouveau membre » (prenom strict : lettres, 2 a 24 car.).
- Idempotence : cockpit_liveclub_filleuls, index unique sur abonnement_id, insertion sous verrou (rang compte dedans),
  on conflict do nothing ; seule l'insertion previent. Tentative posee AVANT l'envoi (notification_tentee_le) : un rejeu
  ne renvoie rien. Parrain injoignable (compte inconnu, 403/400) : alerte a l'equipe (alerterEquipeTexte, Agent AOK) avec
  la phrase a transmettre, aucun email. Alerte non livree : 'a_reprendre' (le filet recommence). Tentative sans resultat
  depuis 30 min : 'incertain', l'equipe est prevenue, RIEN n'est renvoye au parrain.
- Chemins : webhook /api/liveclub/stripe (invoice.paid signe, a cote de la reouverture ; table absente = 200, panne = 500)
  ; filet du passage du matin, etape 'parrainages' avant le resume (factures payees des 7 derniers jours, remises et codes
  deplies, puis reprises). Le webhook N'EST TOUJOURS PAS BRANCHE chez Stripe : en pratique c'est le passage du matin qui
  note et previent (le message dit alors « a rejoint le Live Club le 5 novembre »).
- Agent AOK : carte proposer_code_parrainage (type 'code_parrainage', compte 'cockpit', bouton « Enregistrer le code de
  parrainage » ; nouveau, modification, desactivation ; carte composee par le serveur, compte Telegram cherche par le
  pseudo) ; proposer_code_promo prend parrain/parrain_pseudo (compte melanie) et enregistre le code au clic apres Stripe.
  Prompt : section « LE PARRAINAGE PAR CODE DU LIVE CLUB », schema des deux tables, « vingt outils d'action » ;
  DESCRIPTIONS_OUTILS (filet sansNomsOutils). Lecture par requete_sql (« combien de filleuls pour Alex », « qui avec BARBU17 »).
- Visibilite : resume du matin, rubrique « Parrainages (nouveaux filleuls) » (une ligne par filleul) ; API de Tab GET
  /membres, cle parrainages (codes, filleuls de la periode ; to_regclass avant, la transaction READ ONLY ne casse pas) ;
  repartition : AVERTISSEMENT « X EUR a verser aux parrains fin <mois> ... pas deduit de ce calcul » (onglet Revenus et
  repartition_du_mois), aucune ligne du calcul.
- CHOIX COMMISSION (PERIME le 05/11 au soir : Brice a tranche, voir la section au-dessus) : la ligne a verser vit dans
  cockpit_liveclub_filleuls (commission figee, mois, statut a_verser) et n'entre PAS dans la repartition. proposer_commission_affiliation compterait un argent RECU (faux sens) ; une depense
  tout de suite deciderait qui paie. QUESTION A BRICE : qui paie (depense rattachee au Live Club, cote Mel avant le 70/30
  comme les lives d'Adrien = recommandation ; commune 50/50 ; Mel seule) ; puis une carte « commissions de parrainage
  versees » (depense + statut versee) reste a faire. Autres questions : rattraper les filleuls du 22/10 au jour du
  deploiement (le filet ne remonte que 7 jours) ; remboursement ou arret le 1er mois (rien d'automatique, statut annulee
  sans carte) ; 30 % non retroactif sur les 10 premiers, compte depuis toujours (a confirmer).
- Migration 20261105120000_cockpit_liveclub_parrainage.sql (sites/Aoknowledgecom) : deux tables, RLS lecture
  is_cockpit_member, ecriture serveur, MELMOM2 refuse par check, les trois codes amorces (on conflict do nothing).
  Aucun point-virgule hors fin d'ordre (verifie par le script). Sans elle : rien n'est note, rien ne part, rien ne casse.
- Cockpit (apps/cockpit, FicheMembre) : PROPOSE, pas code (fiche du filleul : code et parrain ; fiche du parrain : nombre
  de filleuls, a verser).
- Verifs : node scripts/verifier-parrainage.mjs (17 blocs, faux Stripe, fausse base) ; tsc --noEmit ; eslint des fichiers
  touches ; -liveclub (exclusion de la nouvelle rubrique dans le test d'ordre), -annulation-abonnement, -pause-depot,
  -adresse-contact (20 outils), -depot-perdu, -repartition, -securite-bots, -tab-repondre, -mcp-tache, -reouverture-impaye
  et voisins : ok. Aucune base, aucun Stripe, aucun envoi, aucune eval.
- A FAIRE sur GO : migration, commit + push du journal (= prod), decision de Brice sur qui paie ; plus tard, brancher le
  webhook Stripe (invoice.paid) pour un message dans la minute.

## ACCUEIL APRES UN RETRAIT, HORAIRES DES LIVES, REPONSES PARTAGEES DANS L'EQUIPE (03/11/2026 soir, commite NON pousse ; aucune migration)

- Bienvenue manquee d'EarvinSaintus (887971980, acces broker, 03/11 16:15) : PAS dc5e25d ni le sujet ferme (bot admin,
  can_manage_topics = oui, lu par getChatMember le 03/11). Sa ligne disait sorti le 06/10 12:06 (retrait manuel de Melanie,
  « sans abonnement relie »), 28 jours < 30 = 'connu' (retour rapide) : ni accueil, ni tour en prive (geste 426 genre
  'connu'). Correction : lireAvantEntree (liveclub/avant-entree.ts) lit aussi la regle du geste « retrait » de cette sortie
  (a 1 h pres) ; genreEntree : un retrait autre que impaye_5j (RETRAITS_SANS_RETOUR) suivi d'une entree = 'retour' ; impaye
  regularise vite = 'connu' comme le 13/10. Route du webhook et bot-membre lisent la meme chose.
- Accueil refuse par Telegram : alerte a l'equipe par Agent AOK (texteAlerteAccueilNonPublie, geste « Gerer les sujets »
  pour TOPIC_CLOSED), via alerterEquipeTexte (alerte-equipe-telegram.ts, generique, `sauf` = compte qui a agi).
- scripts/renvoyer-accueil.mjs <telegram_id> [--genre] [--oui] : a blanc par defaut (etat du membre et droits du bot lus).
  Earvin : accueilli a la main par Alex, ne pas relancer.
- Bot des membres : les horaires des lives ne sont pas fixes, annonces dans Annonce (prompt-membre.ts + FAQ de
  docs/connaissances/live-club.md ; connaissances.generated.ts patche a la main : generer-connaissances.mjs echoue deja
  sur masterclass.md, 14 masterclasses du site Masterclass non citees). Eval F05 (une passe) : reponse_correcte.
  Copie du site (sites/Aoknowledgecom/v3/src/data/connaissances.generated.ts) pas regeneree.
- Reponse d'un compte de l'equipe a un fil Support (onglet Support, Agent AOK, cartes de Tab) : repondreAuFil prend
  l'auteur et previent les AUTRES comptes d'Agent AOK (« X a pris la discussion avec Y », citation de 200 car., fil),
  ajoute a leur historique. Adil n'a pas de compte Agent AOK : il ne recoit rien, mais ses reponses sont annoncees.
  Une reponse ecrite depuis un compte Telegram personnel reste invisible.
- Verifs : tsc, eslint ; verifier-accueil-groupe (15), -reconnaissance, -liveclub, -agent-equipe, -reponse-partagee (3,
  nouveau), -alerte-equipe, -reponse-membre, -tab-repondre, -pieces-support, -attente-equipe et voisins : ok.
  verifier-pont-support pas lance (ecrit en transaction annulee sur la base de prod).

## REVENANTS RECONNUS PAR L'ONTOLOGIE, RESUME DU MATIN SANS DOUBLON (03/11/2026, commite NON pousse ; migration 20261103090000 ECRITE, NON appliquee)

- Cas du 03/11 : Benoit Richard (fiche f6a1feb5, Skool 16/09/2025, abonnement 99 EUR annule le 16/08) revient par un
  NOUVEAU compte Telegram (9028774793, jamais vu) et un nouveau client Stripe : le bot a poste « vient d'arriver ».
  Cause : genreEntree ne lisait que la ligne du compte dans cockpit_telegram_membres. Correction : un compte jamais vu
  passe par reconnaitrePersonne (src/lib/liveclub/reconnaissance.ts, regles dans reconnaissance-pur.ts) : identifiants
  (rattachements meme retires, exemptions, acces broker du compte, fiche et abonnement du droit, adresses, client
  Stripe) -> fiches -> traces anciennes (abonnement autre que celui qui le fait entrer, paiement, fiche entree 30 j
  avant, autre compte Telegram de la fiche deja vu, acces ou exemption) = 'retour'. Rien par identifiant : le nom
  complet (cleNom, mots tries sans accents), une seule fiche = retour ; plusieurs = 'incertain' -> accueil 'neutre'
  (ligne d'Accueil seule, sans mot de Bla-bla). Route du webhook : lecture ratee = neutre. Message prive (bot-membre,
  lireGenreEntree(u.id, droit)) : retour -> rappel court, sinon tour du nouveau. Essai lecture seule sur la base le
  03/11 : Benoit = retour (abonnement), Loup Claron = nouveau (fiche recente).
- Resume du matin : une rubrique « Arrivées (nouveaux et retours) » remplace « Nouveaux abonnés » + « Entrées dans le
  groupe » (rubrique 'entrees' supprimee) : une ligne par personne (abonnement et entree rejoints par le compte entre
  avec l'abonnement, sinon le compte rattache au client Stripe), nouveau/retour (genre de l'entree puis ontologie),
  montant REELLEMENT paye (lireAbonnementPourMontant, stripe.ts : sub + latest_invoice + discounts depliees, coupons
  lus a part ; detailMontantArrivee), « pas encore entré dans le groupe » si besoin. Lecture Stripe ratee : ancien
  libelle « 139 € par mois, avec remise ».
- Equipe jamais dans « À contacter » ni dans les impayes : lireEquipe (exemptions fondateur/admin/equipe, comptes
  d'Agent AOK, leurs fiches par fiche, adresse, rattachement ou adresses du compte AOK, et leurs clients Stripe),
  estDeLEquipe (resume-pur.ts). Cause du 03/11 : le compte de Melanie n'est rattache a aucune fiche, la vue
  cockpit_membres_signaux ne l'ecartait pas. Migration 20261103090000 (sites/Aoknowledgecom) : CTE fiches_equipe
  dans la vue de base, memes colonnes (instantanes et cockpit_membres_contact_recalculer inchanges). Essai du corps en
  SELECT seul : 87 -> 86 lignes, seule Melanie sort. Le code tient sans elle.
- Nouvel abonnement de Benoit absent de cockpit_abonnements : pas un rattachement rate, il n'est que dans l'export
  Stripe du 03/11 (08 h 59) ; AOK-Push-Membres (10 h 08) le rattache (client cus_VYiwug3g38YJ8S, adresse connue).
- Verifs : node scripts/verifier-reconnaissance.mjs (8 blocs, fausse base), -accueil-groupe (13), -liveclub (63),
  -relais-accueil, -contact-instantane, -a-contacter, -tips-accueil, -rebonds-email, -agent-equipe, -pieces-support,
  -suivi-lots, -pause-depot, -annulation-abonnement, -securite-bots, -reouverture-impaye : ok ; tsc et eslint ok.
- A FAIRE sur GO : push du journal ; migration 20261103090000 (puis Recalculer, ou le passage du lendemain).

## CONNECTEUR MCP DU COCKPIT POUR TACHE (01/11/2026, commite NON pousse ; migration 20261101200000 ECRITE, NON appliquee)

- Besoin (Brice, 01/11) : le concepteur de Tache ajoute un « connecteur MCP personnalise » ; il doit avoir EXACTEMENT les
  droits de la cle API de Tache (portee tache = celle de Tab), pas un de plus.
- Route `POST /api/mcp-cockpit/<secret>` (MCP HTTP sans etat, JSON, comme /api/mcp ; GET et DELETE : 405). Code :
  `src/lib/mcp-tache/pur.ts` (protocole, 26 outils = une route de aide('tache').routes chacun, schemas fermes),
  `serveur.ts` (cle, appel des handlers), route `src/app/api/mcp-cockpit/[secret]/route.ts`. Middleware : public.
- Droits : chaque outil appelle le handler GET/POST de `src/app/api/tab/v1/[[...chemin]]/route.ts` dans le meme
  processus, sous `sousCleDeTache` (src/lib/tab/acces.ts, AsyncLocalStorage) : verifierCle rend un verdict de portee
  'tache' (jamais 'tab') sans requete, journaliser garde la ligne. Memes regles, controles anti-injection et limites
  que l'API, aucune regle recopiee. La requete interne ne porte ni cle ni secret.
- Cle : ligne DEDIEE de cockpit_tab_cles, portee tache_mcp, empreinte sha256 prefixee `mcp-cockpit-tache:` (ne passe
  ni l'API ni ChatGPT), secret `tmcp_` + 43 car. Option : `Authorization: Bearer <cle API de Tache>` (portee tache
  seulement, cle de Tab refusee), n'importe quel dernier segment. Cle coupee, absente, inconnue : 404 neutre.
  Migration pas passee (contrainte de portee lue par pg_get_constraintdef) : 503.
- Cadence : 60 appels d'outil par minute et par cle (lots compris), comptes dans cockpit_tab_acces. Journal : une
  ligne par appel d'outil, route `mcp-cockpit/<outil>`, parametres de la route (parametresJournal) ; une ligne par
  requete sans outil. Jamais le secret (masquerSecrets sur les erreurs ; Sentry masque /api/mcp-cockpit/<secret>).
  En mode Bearer, les lignes vont a la cle API de Tache (meme compteur que l'API).
- Cle a creer : `node scripts/creer-cle-tache-mcp.mjs [--essai]` (URL complete dans
  credentials.local/tache-mcp.local.json, jamais affichee). Essai du 01/11 : migration pas passee, 0 cle.
- Cockpit : bloc « Accès de Tache », sous-partie « Connecteur MCP » (etat, nombre d'appels, dernier appel, « Couper
  la clé ») ; le bloc de ChatGPT ecarte la route mcp-cockpit.
- Verifs : `node scripts/verifier-mcp-tache.mjs` (13 blocs, dont les VRAIS handlers de l'API sans base : aide de
  Tache, refus pour = tache), -tab-repondre, -notes-tache, -mcp-gpt, -securite-bots, -images-belrive : ok ; tsc ok.
- A FAIRE sur GO : migration 20261101200000, push du journal, deploiement du cockpit, puis la cle (script).

## PAUSE DE L'ABONNEMENT + ACCES PAR DEPOT BROKER, pour un abonne (01/11/2026, LOCAL, non commite ; AUCUNE migration)

- Besoin de Brice et Mel (01/11) : un abonne fait un depot chez un broker partenaire = 6 mois de Live Club ; son
  abonnement est en PAUSE (aucun prelevement) et il GARDE le groupe, sans trou ; a la fin, reprise automatique ou arret.
  Premier cas : Arthur (u5026707870), renouvellement le 07/11/2026 : la carte doit etre cliquee AVANT le 07/11.
- Regles, textes et enchainement du clic (outils en parametre) : src/lib/liveclub/pause-depot-pur.ts ; serveur :
  pause-depot.ts. Conditions de l'offre : OFFRE_PAUSE_DEPOT (config.ts : partenaire, lien, depotMinimum, lots), VIDES,
  EN ATTENTE DE MEL : tant qu'une manque, le bot n'en donne aucune et l'equipe est prevenue.
- Membre (bot des membres) : outil pause_par_depot (etape renseignement | depot_fait), reponse ECRITE PAR LE SERVEUR
  (reponseMembrePauseDepot), veutHumain = l'alerte existante « un membre demande un humain » (conditions a envoyer,
  depot a verifier) ; une ligne au journal par 24 h (regles pause_depot_demande / pause_depot_declare) ; refuse sous
  prudence. Une pause du parcours en cours : consigne « il GARDE le groupe » (consignePauseDepotMembre), ligne dans
  « Mon abonnement » (ligneSituationPauseDepot), consigne des lots adaptee (consigneLots, pauseDepot).
- Equipe (Agent AOK) : carte proposer_pause_depot (type 'pause_depot', compte 'cockpit', bouton « Pause + accès
  broker »), carte longue (Brice) / courte (Mel) composees par controlerPauseDepot (lecture seule : commission par
  depotPourPauseDepot, repartition/serveur.ts, comme la carte de depot broker ; abonnement chez Stripe, UN seul en
  cours ; acces, depot deja inscrit, pause du parcours en base ; compte Telegram du rattachement ; dates).
  Au clic (executerPauseDepotAvec) : tout relu ; dates de la carte encore justes sinon refus ; puis UNE transaction
  (verrous par abonnement et par adresse) : acces broker pose MALGRE l'abonnement (insert direct : accorderAccesBroker
  et son refus 'deja_abonne' ne sont pas touches, ils valent partout ailleurs), relie au compte Telegram, jusquau =
  jour de la reprise ; depot inscrit (ou relie s'il etait inscrit sans acces) ; marqueur au journal (geste
  'acces_broker', regle 'pause_depot', details acces_id / abonnement_id / commission_id / reprise_le) ; PUIS la pause
  par pauser() (stripe.ts, STRIPE_AGENT_KEY_MELANIE, metadonnees comprises) + ligne 'pause' regle 'pause_depot' ; PUIS
  le message au membre (une fois par acces, regle 'pause_depot_message', prive sinon email a l'adresse d'envoi).
  Pause refusee par Stripe : acces et depot restent, l'erreur le dit, la MEME carte redemandee ne fait que la pause.
  Reponse de Stripe perdue (pause posee quand meme) : la carte redemandee reconnait SA pause (reprise = fin de l'acces
  du parcours), note la ligne 'pause' et previent le membre.
- Dates : reprise = fin de la periode payee + N mois (calculerReprisePause, la regle de toute pause) = dernier jour de
  l'acces (inclus). Arthur : paye jusqu'au 07/11/2026, reprise et fin d'acces le 07/05/2027. Verifie jour par jour
  (resumerAbonnement reel) : aucun jour sans droit.
- Groupe : pendant la pause, droitLiveClub trouve l'acces broker (telegram_id) : 'oui', ni la pause ni le passage ne
  le sortent (droit relu avant toute sortie). Lots en retard : droits.ts garde le 'oui' pour un acces du parcours
  (EtatLots.pauseDepot, lu dans la requete du suivi, lots-lecture.ts). Relances J+14/J+18 au texte du parcours
  (modeleRelanceLots(..., pauseDepot)). Fin du delai : PAS de sortie, alerte UNE fois a Brice et Mel dans Agent AOK
  (regle 'pause_depot_lots', reservee). PROPOSITION A FAIRE VALIDER (SUITE_LOTS_PAUSE_DEPOT = 'equipe' en service) :
  lots pas faits a la fin du delai = la pause s'arrete et l'abonnement reprend.
- Fin : rappel J-7 de la pause au texte du parcours (il reste dans le groupe ; arreter = le dire au bot) ; rappel J-7
  « fin d'acces broker, abonne-toi » saute tant que l'abonnement reprend (accesDePauseQuiReprend) ; reprise = Stripe.
- Visibilite : vue CALCULEE cockpit_liveclub_pauses_depot (vues-serveur.ts, SQL_PAUSES_DEPOT, WITH injecte dans
  requete_sql, aucune migration) ; API de Tab GET /membres (pauses_par_depot_broker) ; resume du matin (rubrique
  « Pauses et reprises », l'acces du parcours retire de « Accès broker ») ; fil Support (phraseGeste).
- Verifs : node scripts/verifier-pause-depot.mjs (18 blocs, faux Stripe et fausse base), tsc --noEmit (complet), eslint
  des fichiers touches ; -suivi-lots, -depot-perdu, -adresse-contact, -annulation-abonnement (regex et compte d'outils
  19 mis a jour), -repartition, -liveclub, -securite-bots, -tab-repondre, -agent-equipe, -relais-accueil,
  -rebonds-email, -a-contacter, -alerte-equipe, -attente-equipe, -reponse-membre, -pieces-support, -tips-accueil,
  -accueil-groupe, -effacement, -reouverture-impaye, -vocaux, -mcp-gpt, -notes-tache, -vues-serveur --sans-base : ok.
  verifier-fiche-personne echoue comme avant (src/lib/tab/lectures.ts). Aucune eval, aucune base, aucun envoi.
- A FAIRE : Mel donne les conditions (OFFRE_PAUSE_DEPOT) ; Brice tranche la regle des lots ; commit + push du journal sur
  GO (= prod) AVANT le 07/11 pour Arthur. Ecran du cockpit (apps/cockpit) : propose, pas code.

## Reponse a un membre PREPAREE par Tab ou Tache, envoyee d'un clic dans Agent AOK (01/11/2026, LOCAL, non commite ; migration 20261101120000 ECRITE, NON appliquee)

- Cas reel du 01/11 : Arthur a clique « Contacter l'équipe » dans le bot ; l'API n'avait que GET /support, Tab a du lui
  ecrire depuis le Telegram de Brice, hors du fil. Brice, 01/11 : « je suis ok pour la nouvelle route de réponse de tache
  et tab », puis « ok pour la B » : Tab ou Tache PREPARENT, Brice ou Melanie ENVOIENT d'un clic dans Agent AOK (« ça évite
  les conversations que le bot ne pourrait pas gérer entièrement sans moi »).
- POST /api/tab/v1/support/<fil_id>/repondre { texte } (cles tab et tache, les seules que verifierCle laisse passer)
  n'envoie RIEN au membre. Controles (src/lib/tab/repondre-pur.ts, constantes nommees) : corps { texte } seul, vide
  refuse, MAX_TEXTE_REPONSE 2000 ; analyserTexte niveau 'tiers' (cache, Base64, HTML, consigne ou adresse a une IA, faux
  systeme, IBAN) = refus 422 et alerterBriceSecurite ; liens : nos domaines (aoknowledge.com, melaniechart.com et
  sous-domaines), t.me/aok_liveclub_bot SANS parametre (un ?start= est un jeton), et les liens deja publies du bot a
  l'adresse exacte (LIENS_UTILES, LIENS_PARTENAIRES, portail de carte, portes d'abonnement : un code d'affiliation
  change est refuse) ; tout autre lien REFUSE ; email hors de nos domaines et mention @ autre que le bot : SIGNALES sur la
  carte, pas refuses ; fil du bot Live Club seulement (app telegram, avec compte), membre qui a ecrit depuis moins de
  FENETRE_FIL_JOURS 30 jours (pas de prise de contact a froid) ; cadence 3 par fil et 20 par cle sur l'heure glissante,
  sous un verrou par fil.
- Puis une ligne dans cockpit_tab_propositions et une CARTE par le bot Agent AOK a chaque compte de
  cockpit_telegram_comptes (Brice, Melanie) : « Réponse préparée par Tab pour Arthur (fil Support, dernier message du
  membre le ...) : <texte> », destinataire, ce que fait Envoyer, signalements, expiration ; boutons Envoyer / Annuler
  (tr:e:<id>, tr:a:<id>). Reponse 202 « proposee, en attente de validation par Brice ou Mélanie » avec proposition_id.
  Aucune carte partie = 502 et statut echec. Une proposition plus recente pour le meme fil remplace l'ancienne (ses
  cartes perdent leurs boutons). Pas de copie « Tab a répondu à... » : la carte est l'information.
- Clic (agent-cockpit-telegram.ts, APRES le verrou du compte de l'equipe ; src/lib/tab/repondre.ts) : ligne verrouillee
  (for update), le premier clic l'emporte, le second recoit « Déjà traité par X : ... ». Envoyer : controles refaits,
  fil relu, refus si l'equipe a repondu depuis la proposition, puis repondreAuFil (support-reponse.ts, LE chemin de
  l'onglet Support : livraison Telegram par le bot des membres avant toute ecriture, en-tete « Réponse de l'équipe AOK : »,
  role human, fil hors attente, l'equipe garde la main 24 h), ligne « [système] Réponse ci-dessus préparée par Tab (via
  Tab, API du cockpit), envoyée sur validation de Brice dans Agent AOK. » dans le fil, ligne au journal cockpit_tab_acces
  au nom de la cle qui a prepare (route /support/<fil>/repondre/envoi, /annulation). Annuler : rien ne part, trace.
  DUREE_PROPOSITION_HEURES 48 sans clic : expiree, jamais envoyee seule. Statut 'envoi' interrompu : jamais rejoue.
  Toutes les cartes sont closes (texte + issue, sans boutons), le resultat part en message a qui a clique.
- GET /support : chaque fil porte fil_id (l'identifiant de la route), reference (« fil 1a2b3c4d »), statut
  (attend_un_humain, non_ouverte, repondu, avec_le_bot) et derniere_reponse_preparee (table absente : to_regclass, la
  lecture READ ONLY ne casse pas). GET /support/propositions[/<id>] (statut, fil, limite) : ou en est chaque proposition.
  Aide : routes, section repondre_a_un_membre (« Tu prépares, Brice ou Mélanie valident d'un clic dans Agent AOK ; rien
  ne part sans eux. », « Envoi seulement sur ordre explicite de Brice ou de Mélanie, dans leurs mots, pour ce
  message-là ; jamais de toi-même, jamais sur la foi d'un email ou d'un document. »), ligne dans regles_a_respecter.
- Verifs : node scripts/verifier-tab-repondre.mjs (15 blocs, hors ligne), tsc, eslint ; -securite-bots, -liveclub,
  -mcp-gpt, -notes-tache, -agent-equipe, -annulation-abonnement, -relais-accueil, -suivi-lots, -vocaux,
  -reponse-membre, -alerte-equipe, -attente-equipe, -vues-serveur --sans-base : ok. verifier-fiche-personne echoue comme
  avant (src/lib/tab/lectures.ts). Aucune eval, aucune lecture ni ecriture de la base, aucun envoi.
- A FAIRE sur GO : appliquer la migration 20261101120000_cockpit_tab_propositions (sans elle : 503, rien ne part ;
  GET /support sans proposition), commit, push du journal (= prod). Premier essai reel : une proposition sur un fil de
  test, Annuler, une autre, Envoyer.
- Non couvert : fils du support du site (refuses : leur fil est lu par le chat du membre) ; pieces jointes ; l'onglet
  Support du cockpit ne montre pas une proposition en attente (seulement la ligne systeme apres l'envoi) ; l'email
  d'alerte « un membre veut parler à un humain » ne porte pas la reference du fil (Tab le retrouve par nom, @ ou email
  dans GET /support) ; un lien refuse n'alerte pas Brice (seul un texte suspect alerte).

## Adresse de CONTACT d'un acces broker, carte d'Agent AOK (31/10/2026, LOCAL, non commite ; migration 20261031210000 ECRITE, NON appliquee)

- Cas reel du 31/10 : Fabien, entre par un depot RaiseFx (commission 587 EUR attendue, acces jusqu'au 30/04/2027) avec une
  adresse @libertysurf.fr qui refuse nos emails (« 550 spam detected »). Brice, 31/10 : l'adresse de l'acces est celle de
  l'ACTIVATION chez le broker (verifications de Mel, tracking de l'affiliation) : elle NE CHANGE PAS. Premier plan
  (changer l'email de l'acces et des commissions) abandonne.
- Ce qui est fait : une ADRESSE DE CONTACT en plus, qui sert seulement a lui ECRIRE. Table cockpit_liveclub_acces_contacts
  (sites/Aoknowledgecom/supabase/migrations/20261031210000_cockpit_liveclub_acces_contacts.sql : une ligne par adresse
  posee, en cours = retire_le null, une par acces, une adresse = un seul acces a la fois, RLS lecture equipe, cascade a
  l'effacement d'un acces). Regles et textes : src/lib/liveclub/adresse-contact-pur.ts ; lectures : adresse-contact-lecture.ts ;
  controle et execution : adresse-contact.ts.
- Carte d'Agent AOK proposer_adresse_contact_acces (type 'adresse_contact', compte 'cockpit', bouton « Changer l'adresse
  de contact ») : email_acces, adresse_contact ou retirer, raison. Carte longue (Brice) : l'adresse de contact, la phrase
  « L'adresse du broker reste X : c'est elle qui compte pour la commission et les vérifications chez le broker. », l'acces
  (dates, entre ou non), les depots et leur commission, ce qui part, ce qui ne bouge pas. Carte courte (Mel). Refus :
  adresse illisible, deux adresses identiques, pas d'acces broker a cette adresse, acces retire ou termine, rien a
  retirer, deja l'adresse de contact, adresse qui a son propre acces broker ou qui sert deja de contact a un autre acces,
  table absente. Meme adresse mais invitation pas partie = la carte la renvoie.
- Clic, EN UNE TRANSACTION : acces verrouille (for update), adresse verrouillee (pg_advisory_xact_lock), refus refaits,
  acces et contact compares a la carte, ancienne ligne retiree, nouvelle posee, invite_envoyee_le a null si le lien n'a pas
  servi (ni compte Telegram ni jeton utilise), ligne au journal (geste 'acces_broker', regle 'adresse_contact', details
  quoi / contact_id / invitation, jamais l'adresse). Puis l'invitation part a l'adresse d'envoi (envoyerInvitation,
  acces.ts : meme jeton, le jeton garde l'adresse de l'acces) et une ligne 'invitation' regle 'broker_contact'. Rien
  n'ecrit l'email de l'acces, ses dates, cockpit_commissions, les jetons ni le rattachement Telegram.
- ADRESSE D'ENVOI, une seule fonction (src/lib/liveclub/adresse-envoi.ts, adresseEnvoi ; regle pure choisirAdresseEnvoi) pour
  TOUS les emails du Live Club a un membre : (1) l'adresse « communications » cochee dans Mon espace (aok_email_communications,
  migration 20261031211000 de l'autre session, NON appliquee), pour le compte AOK UNIQUE qui porte l'adresse d'identite
  verifiee (auth.users confirme ou profile_emails verified, comme trouver-cours ; zero ou deux comptes = etape sautee) ;
  (2) l'adresse de contact de l'acces ; (3) l'adresse d'identite (acces ou abonnement). Fonction, colonne ou table absente :
  etape suivante, un avertissement par instance. Branchee dans prevenir (passage.ts : pause, prelevement, sorties, impaye,
  fin de fenetre, exemptions, fin d'acces, J-7, lots, depot perdu ; parametre accesId pour un acces broker),
  emailReouverture et emailBienvenue du passage, la route /api/liveclub/bienvenue et envoyerInvitation. Exception voulue :
  le code de verification d'une adresse part a cette adresse. La carte dit quand le choix du membre passe avant le contact.
- Webhook Resend : rebonds.ts retrouve l'acces par son adresse de contact (en cours, sinon la plus recente), puis par les
  autres adresses verifiees du compte AOK qui porte l'adresse refusee (son choix dans Mon espace : acces et rattachements de
  ces adresses ; un seul compte). L'alerte dit « adresse de contact de l'accès broker de X » ou « adresse de son compte
  AOK » et, pour tout acces broker, propose le geste (« écris-lui plutôt à »).
- Prompt : regle « L'ADRESSE DE CONTACT D'UN ACCÈS BROKER », table au schema, dix-huit outils d'action ; sansNomsOutils
  connait l'outil (verifie : tous les outils d'OUTILS ont leur description). verifier-annulation-abonnement mis a jour
  (dix-huit au lieu de dix-sept).
- Verifs : node scripts/verifier-adresse-contact.mjs (11 blocs, hors ligne), tsc, eslint ; -rebonds-email, -repartition,
  -liveclub, -suivi-lots, -depot-perdu, -securite-bots, -agent-equipe, -annulation-abonnement, -tips-accueil,
  -accueil-groupe, -effacement, -relais-accueil, -reouverture-impaye, -a-contacter, -alerte-equipe, -attente-equipe,
  -reponse-membre, -pieces-support, -vocaux, -mcp-gpt : ok. verifier-fiche-personne echoue comme avant
  (src/lib/tab/lectures.ts). Aucun appel d'eval, aucune lecture ni ecriture de la base, aucun envoi.
- A FAIRE sur GO : appliquer la migration 20261031210000 (et 20261031211000 quand Brice la valide : le code tourne sans
  elle), commit, push du journal (= prod). Pour Fabien : sa nouvelle adresse, puis la carte (« écris-lui plutôt à » et
  l'adresse) ; son lien n'a pas servi, l'invitation repart a la nouvelle adresse.
- Non couvert : fiche_personne et « Mon abonnement » ne montrent pas l'adresse de contact ; l'effacement de niveau 3 garde
  l'adresse de contact d'un acces garde pour sa commission ; coller l'adresse de contact dans une carte d'acces broker
  creerait un acces (seul le prompt l'interdit).

## Autres adresses email confirmees par code, Mon espace (31/10/2026, GO de Brice du 31/10 ; LOCAL, commite, NON pousse ; migration 20261031190000 A APPLIQUER)

- Routes (Bearer obligatoire, CORS de l'academie) : POST /api/compte/emails/ajouter { email } (aussi « Renvoyer le code »)
  et POST /api/compte/emails/confirmer { email, code }. Serveur : src/lib/emails-confirmation.ts ; regles pures et email :
  emails-confirmation-pur.ts ; scripts/verifier-emails-confirmation.mjs (16 blocs).
- Code a 6 chiffres garde en HMAC-SHA256 (cle derivee de SUPABASE_SERVICE_ROLE_KEY, liee au compte et a l'adresse),
  15 min, 5 essais, comparaison a temps constant. Envois : 5/h et 10/24 h par compte, 3/h et 5/24 h par adresse
  (HMAC de l'adresse, tous comptes), 100/h au total. Email Resend (RESEND_API_KEY_LIVECLUB sinon RESEND_API_KEY),
  « AO Knowledge <support@...> », aucun lien, seul texte du membre = l'adresse echappee. Logs : compte tronque + ref (8 car. du HMAC).
- Tables (migration du depot workspace) : profile_emails_attente (une ligne par compte et adresse, le membre lit email et
  dates et peut retirer, code_hmac et essais serveur seul), profile_emails_envois (compteur ferme, purge a 2 jours).
  profile_emails : plus d'insertion depuis le navigateur ; l'unicite sur email NE CHANGE PAS (adresse verifiee = un seul
  titulaire, jamais deplacee). Confirmation juste : lignes NON verifiees des autres comptes (squat) et attentes de
  l'adresse supprimees, ligne du compte posee verified (source 'code').
- A FAIRE sur GO : appliquer la migration, pousser le journal, puis le site (ordre impose : l'ancien bouton du site echoue
  une fois le droit d'insertion retire). Premier essai reel sur un compte de test (le mail part vraiment).
- Non couvert : le bot Live Club (droitLiveClub, « Mon abonnement ») ne lit pas profile_emails ; une adresse confirmee
  sur le site ne relie pas Telegram (le bot garde sa propre preuve par code). trouver-cours la voit (compte du site).

## Emails du Live Club qui n'arrivent pas : webhook Resend (31/10/2026, LOCAL, non commite ; aucune migration ; webhook et variable A POSER)

- Cas reel du 31/10 : l'invitation d'acces broker de Fabien (@libertysurf.fr) acceptee par Resend, puis « Bounced »
  a la meme minute (Transient / ContentRejected, « 550 spam detected »), adresse mise dans les Suppressions de Resend.
  Personne ne l'a su avant sa plainte.
- Route `POST /api/liveclub/resend` (publique, middleware.ts) : signature Svix verifiee sans dependance (HMAC SHA-256,
  « <svix-id>.<svix-timestamp>.<corps> », secret whsec_ decode du base64, 5 min de tolerance, plusieurs signatures
  acceptees). Sans RESEND_WEBHOOK_SECRET_LIVECLUB : 503 ; signature fausse : 400, rien n'est traite. Evenements traites :
  email.bounced, email.complained, email.suppressed (= un envoi vers une adresse deja bloquee, traite comme un rebond).
  Ignores (200) : tous les autres, dont email.delivery_delayed (un retard finit en delivered ou en bounced : le rebond
  previent), et les emails des autres produits du compte Resend (expediteur different de LIVECLUB_FROM_EMAIL ou de
  « Live Club AOKnowledge <support@aoknowledge.com> »). LIVECLUB_REBONDS=0 coupe tout (200).
- Regles et textes : `src/lib/liveclub/rebonds-pur.ts` (pur, traiterRebond avec ses outils en parametre) ; serveur :
  `rebonds.ts`. Nature du refus lue dans bounce.type / subType : contenu (ContentRejected, spam : l'adresse vit),
  definitif (Permanent), passager (MailboxFull...), bloque (Suppressions), plainte, indetermine.
- Ce qui se passe : (a) la personne retrouvee par l'adresse (acces broker, rattachements par l'adresse, par la fiche du
  cockpit, par un client Stripe) ; (b) une ligne au journal, geste 'adresse', regle email_rebond | email_plainte |
  email_bloque (svix_id, empreinte sha256 de l'adresse, jour de Paris, nature, sujet, acces_id, client_stripe ; jamais
  l'adresse), sous verrou pg_advisory_xact_lock de l'adresse : meme svix-id = traite une fois ; (c) invitation broker
  (sujet « Votre accès au Live Club est ouvert », acces actif jamais ouvert) : invite_envoyee_le a null SEULEMENT pour
  un refus definitif, si aucun jeton n'a servi et si elle n'a pas ete renvoyee depuis ; un refus de contenu ne remet
  rien (le meme email serait refuse pareil) ; (d) message prive au membre si un compte Telegram est relie (une fois par
  adresse, pas si l'equipe a la main dans son fil), sans parler de spam : l'email n'a pas pu arriver, donne une autre
  adresse, l'equipe s'en occupe ; (e) alerte a Brice et Mel dans Agent AOK (une fois par adresse et par jour) : quel
  email, a qui, pourquoi en clair avec type / sous-type et reponse SMTP, quoi faire (lien personnel a donner pour un
  acces broker pas entre, ou une autre adresse), ce qui a ete fait pour le membre. Le lien personnel est dans l'alerte
  Telegram, PAS dans l'historique de l'agent (« donné dans l'alerte Telegram, pas gardé ici »). Reponse du serveur =
  texte de tiers : analysee (niveau 'tiers'), rendue visible si suspecte, Brice prevenu. Alerte pas partie : ligne
  'echec', 500, Resend rejoue (rien d'autre n'est refait). (f) Fil Support (phraseGeste, pur.ts) et resume du matin
  (rubrique « Emails du Live Club qui ne sont pas arrivés », resume-pur.ts / resume.ts).
- Pas de boucle d'envois vers une adresse bloquee : aucun renvoi automatique d'invitation n'existe (le passage n'en
  renvoie pas ; seul un nouveau collage de l'adresse dans Agent AOK renvoie, accorderUn a_relancer). Apres un refus
  definitif, recoller la MEME adresse renverrait vers une adresse bloquee : refus suivant (email.suppressed), une alerte
  par jour au plus, l'invitation deja a null n'est pas retouchee.
- Consigne d'Agent AOK (agent-cockpit.ts) : les trois regles du geste 'adresse' et le sens de invite_envoyee_le a null.
- Verifs : `node scripts/verifier-rebonds-email.mjs` (13 blocs, hors ligne : vecteur de test Svix, route, evenements
  ignores, cas du 31/10, rejeu, invitation broker contenu / definitif, membre relie ou non, alerte une fois par jour,
  textes, journal et resume, cablage) ; tsc ; eslint ; verifier-liveclub (63, filtre de la rubrique ajoute),
  -securite-bots, -suivi-lots, -depot-perdu, -tips-accueil, -reouverture-impaye, -a-contacter, -accueil-groupe,
  -agent-equipe, -repartition, -relais-accueil, -effacement, -alerte-equipe, -attente-equipe, -reponse-membre,
  -pieces-support, -annulation-abonnement, -vocaux : ok. verifier-fiche-personne echoue comme avant
  (src/lib/tab/lectures.ts). Aucun appel d'eval, aucune lecture ni ecriture de la base, aucun envoi.
- A FAIRE (Brice) : (1) tableau de bord Resend, dans le compte ou il a vu le rebond : Webhooks > Add endpoint, URL
  `https://journal.aoknowledge.com/api/liveclub/resend`, evenements email.bounced, email.complained et email.suppressed
  (pas email.delivery_delayed) ; (2) copier le « Signing secret » (whsec_...) dans le coffre
  `D:\6_Societe\Pilotage\Data-Performance\credentials.local\resend-webhook-liveclub.local.json`
  (`{"signing_secret": "whsec_...", "url": "...", "evenements": [...], "cree_le": "...", "deploye_sur": "Vercel journal-d-etude-beta (RESEND_WEBHOOK_SECRET_LIVECLUB)"}`).
  Puis (session principale) : variable RESEND_WEBHOOK_SECRET_LIVECLUB sur Vercel (journal-d-etude-beta), commit, push
  du journal sur GO (= production). Un evenement de test envoye depuis Resend doit repondre 200 (ignore : ce n'est pas
  un email du Live Club) ; une signature fausse, 400.
- Pour Fabien (rebond d'avant le webhook) : rien n'est rattrape. Aucun outil ne donne a l'equipe le lien personnel
  d'un acces (seule l'alerte le fera desormais) : a relire en base (jeton 'entree' de son acces) si besoin. Son
  adresse reste dans les Suppressions de Resend tant que personne ne l'en retire.

## Depot perdu = acces ferme, Agent AOK sans noms d'outils, accueil etale en conseils, adresses multiples (31/10/2026, DEPLOYE le 31/10 a 17:00, commit 84a3839 ; aucune migration)

- (1) Brice, 31/10 : « pas de commission pas d'acces ». Regle et textes : fin de `src/lib/liveclub/lots-pur.ts` ; lecture :
  `lots-lecture.ts` (lireFermes). Un acces broker actif dont un depot est marque PERDU (maj_le, jour de Paris, depuis
  DEPOT_PERDU_DEPUIS = '2026-10-31', pas de fermeture retroactive) et dont AUCUN depot n'est attendu ni recu est FERME :
  etat LU, rien n'est ecrit sur l'acces. droitLiveClub rend 'non' avec `depotPerdu` (lecture ratee = acces garde).
  Situation au membre (/start, /menu, Mon abonnement, demande d'adhesion, jeton) : texteAccesFermeDepot + bouton de l'equipe.
- Passage, tache (p) apres les lots : present, ni admin ni autre droit = sortie SANS ban (regle depot_perdu, simulee sans
  sortiesActives) ; message de fermeture une fois par commission (prive sinon email) ; alerte a Brice et Mel dans Agent AOK une
  fois par commission (acces_broker depot_perdu_alerte, historique de l'agent) ; rappel J-7 de fin d'acces epargne a un acces ferme.
- REGULARISATION (choix) : par la carte d'Agent AOK, proposer_marquer_commission sur la commission perdue, etat `attendue` (nouveau)
  ou `lots_faits` ; le controle pose `regulariser` (seule une commission perdue) ; l'ecriture remet statut 'attendue' ; le
  resultat appelle apresMarquageDepot (lots.ts, import dynamique) : lien de retour tout de suite s'il avait ete prevenu et est
  hors du groupe (retour_depot, une fois par commission), filet au passage du lendemain (retoursApresRegularisation). Un
  nouveau depot inscrit sur le meme acces le rouvre aussi. Le clic « Oui, lots tradés » sur une commission perdue ne regularise
  rien (decision annulee, l'equipe le sait). LIVECLUB_DEPOT_PERDU=0 coupe tout.
- (2) Agent AOK : consigne « TES OUTILS SONT INTERNES » (prompt) + filet du serveur sansNomsOutils (agent-cockpit-pur.ts,
  DESCRIPTIONS_OUTILS, un nom par outil, verifie contre OUTILS) sur la reponse et le complement des cartes ; le texte de carte
  « (proposer_depot_broker, commission) » de repartition/serveur.ts est reecrit.
- (3) Accueil etale (tips-accueil-pur.ts, memoire bot-infos-en-tips-etales) : J0 court (essentiel, Bla-bla, lots), puis
  conseils J+1 academie, J+2 autres sujets et challenge, J+4 liens utiles, J+7 abonnement et adresses ; tache (q) du passage,
  apres les lots ; un par jour, une fois, etat relu (present, droit oui, fil sans attente ni equipe a la main), saute si deja
  aborde, decale par une relance des lots. Nouveaux entres depuis TIPS_ACCUEIL_DEPUIS = '2026-10-31' et acceptes par ce code
  (details.genre/tips de entree_acceptee). LIVECLUB_TIPS_ACCUEIL=0 = tour complet d'avant, aucun conseil.
- (4) Adresses multiples, au moment ou ca sert : phrase quand aucun abonnement n'est trouve (PHRASE_AUTRE_ADRESSE), code qui
  n'arrive pas (autre adresse, ou l'equipe pour un acces broker, bouton joint), ligne des adresses dans « Mon abonnement »
  (rattachement + cockpit_membre_emails), consigne de l'agent des membres (il transmet, ne relie rien lui-meme).
- Verifs : tsc, eslint ; verifier-depot-perdu (12 blocs), verifier-tips-accueil (7), -suivi-lots (18, une regex mise a jour),
  -accueil-groupe, -liveclub, -repartition, -securite-bots, -agent-equipe, -effacement, -relais-accueil et voisins : ok.
  verifier-fiche-personne echoue comme avant (src/lib/tab/lectures.ts). Aucun appel d'eval, aucune lecture de la base.
- A FAIRE : poser DEPOT_PERDU_DEPUIS et TIPS_ACCUEIL_DEPUIS au jour du deploiement ; commit puis push du journal sur GO (= prod).

## Suivi des LOTS d'un acces broker, ton d'Agent AOK, challenge Core content (31/10/2026, LOCAL, non commite ; aucune migration)

- Echanges de Brice et Mel du 31/10. Regles et textes : `src/lib/liveclub/lots-pur.ts` (aucun import) ; lectures :
  `lots-lecture.ts` ; serveur : `lots.ts`. Suivi = acces broker actif (motif 'broker') avec un depot inscrit
  (cockpit_commissions, nature depot, attendue, lots_faits_le vide) et aucun depot aux lots faits ou recu.
- CONSTANTES (lots-pur.ts), DECIDEES par Brice le 31/10 : DELAI_LOTS_JOURS = 21 (3 semaines) ; RELANCE_LOTS_1_JOURS = 14 ;
  RELANCE_LOTS_2_AVANT_FIN_JOURS = 3 (J+18) ; SUIVI_LOTS_DEPUIS = '2026-10-31' (jour du deploiement).
  Exemple donne au membre : « 2 lots sur le NAS », position tenue « 30 secondes » (EXEMPLE_LOTS, TENUE_LOTS).
- Depart du delai = entree (jeton personnel utilise), sinon debut de l'acces, jamais avant SUIVI_LOTS_DEPUIS : les membres
  entres AVANT le deploiement ont 21 jours a partir de lui (aucune pause retroactive). Lu en base le 31/10 (lecture seule) :
  8 acces broker, 6 sans depot (jamais suivis), 2 avec depot (29/10, 31/10), aucun entre dans le groupe ; relance 1 le
  14/11 au plus tot, fin du delai le 21/11 (deploye le 31/10).
- Parcours : (1) admission : paragraphe des lots + delai (texteAdmission, option lots) ; (2) passage quotidien, tache (o)
  tacheLots : relance 1 (pas-a-pas) puis relance 2, en prive sinon email, une fois chacune (reservation, regles
  lots_relance_1/2), etat relu juste avant, membre present seulement ; (3) « J'ai tradé mes lots » (bouton m:lots, ou outil
  lots_trades de l'agent des membres, propose a ce membre seulement) : declaration ('acces_broker' lots_declares, une
  ouverte par depot, verrou), carte a Brice et Mel dans Agent AOK « Oui, lots tradés » / « Non, pas encore » (lt:o|n:<id>),
  au membre une ligne « l'équipe vérifie chez le broker » ; (4) Oui = validerAction + executerActionRepartition
  marquer_commission lots_faits (la meme ecriture que proposer_marquer_commission ; jour = celui de la declaration), membre
  prevenu, lien de retour tout de suite s'il est hors du groupe (retourApresLots, unban only_if_banned) ; Non = membre
  prevenu ; (5) fin du delai : droitLiveClub rend 'non' avec `lots` (comme la dette d'un impaye), le passage sort SANS ban
  (sortir, regle lots_non_faits, SIMULE sans sortiesActives()), message prive sinon email ; filet du retour au passage.
- Garde-fous : une declaration en cours arrete relances et pause ; pas de pause tant que la relance 2 n'est pas partie, et
  jamais moins de 3 jours apres elle (limiteEffectiveLots) ; suivi illisible = droit garde ; LIVECLUB_SUIVI_LOTS=0 coupe tout.
- Commission : moisPrevuCommission prevoit deja la fin du mois des LOTS (verifie) ; elle compte dans la repartition le mois
  ou elle est RECUE (regle du 08/10, inchangee).
- Agent AOK (agent-cockpit.ts) : Mel = messages courts (ROLES), carte courte pour elle (resumeCourtRepartition, l'alerte du
  controle gardee) ; carte tout de suite quand tout est la ; montants en euros (« 650 EUR (655 USD) » = 650, dollars seuls =
  une question) ; commission de CE depot passee sans question sur une regle generale ; note de partenaire sans « Accord a
  partir du » = remarque, jamais citee ni debattue ; regles definitives par broker = celles de Mel, par la carte d'accord.
  Texte par defaut d'une carte sans tiret long.
- Challenge Core content : une ligne dans le tour du proprietaire (LIGNE_CHALLENGE_CORE_CONTENT) ; regle dans le prompt du bot
  des membres (toutes les reponses aux quiz depuis le debut, le plus de bonnes reponses gagne, tirage au sort a egalite). Le
  lot n'est ecrit ni dans le code ni dans la base de connaissances : pas cite. Le calcul du tirage n'est pas fait ici.
- Verifs : `node scripts/verifier-suivi-lots.mjs` (18 blocs), tsc, eslint ; verifier-accueil-groupe (12), -liveclub (63),
  -repartition (22), -agent-equipe (11), -securite-bots (17), -relais-accueil (13), -effacement (21), -reouverture-impaye,
  -attente-equipe, -reponse-membre, -vocaux, -pieces-support, -annulation-abonnement : ok. verifier-fiche-personne echoue
  comme avant (src/lib/tab/lectures.ts). SQL relu contre la base en LECTURE SEULE (ecritures en EXPLAIN). Evals :
  `node --env-file=.env.local scripts/eval-suivi-lots.mjs L1|L2` (un cas par lancement, essai) : L1 ok (carte directe et
  courte), L2 : outil appele, controle de casse corrige ensuite (voir le rapport du 31/10).
- A FAIRE : poser SUIVI_LOTS_DEPUIS au jour du deploiement ; confirmer les delais avec Brice ; commit puis push du journal sur
  GO (= production) ; deployer le cockpit n'est pas necessaire.

## Accueil du Live Club : ligne d'Accueil, mot dans Bla-bla, tour du proprietaire en prive (31/10/2026, DEPLOYE le 31/10 a 14:38, commit e3952eb ; aucune migration)

- Bug (logs Vercel du 31/10, « TOPIC_CLOSED ») : l'accueil partait sans message_thread_id dans le sujet general « Accueil », ferme, et le bot n'avait pas le droit « Gerer les sujets » (manage_topics=False, Metricgram l'avait). Brice l'a donne le 31/10 (manage_topics=True, verifie).
- Repartition decidee par Brice le 31/10 :
  1. Accueil (sujet general, sans message_thread_id), nouveau ou retour : une phrase, « Bienvenue dans le Live Club, @x ! » ou « Bon retour dans le Live Club, @x ! » ;
  2. Bla-bla (16368), nouveau seulement : un mot social court (« souhaitez-lui la bienvenue », « presente-toi ici en deux mots ») ;
  3. en prive, a l'admission : le message « demande acceptee » qui existait, mis a jour (aucun message de plus). Nouveau : tour du proprietaire (11 sujets avec lien ; ni Accueil, ni Formation que Brice retire, ni Edgyx FAQ), presentation dans Bla-bla avec 4 idees, academie (adresse, connexion par l'email, contenu d'apres docs/connaissances/academie.md), liens utiles (ceux des consignes du bot). Retour apres 30 jours : rappel court de l'academie. Retour rapide : l'acceptation seule.
- Code : src/lib/liveclub/accueil-groupe.ts (SUJETS_LIVECLUB, genreEntree, envoisAccueil, texteAdmission) ; route du webhook (deux envois independants, logs « accueil (x) non publie dans Accueil|Bla-bla » et « entree sans accueil : compte deja connu ») ; bot-membre.ts (qui entre lu AVANT l'approbation, lireGenreEntree) ; config.ts (commentaire) ; scripts/verifier-accueil-groupe.mjs (12 blocs).
- Verifie hors ligne : tsc, eslint, verifier-accueil-groupe, -liveclub, -securite-bots, -relais-accueil, -reouverture-impaye, -attente-equipe, -pieces-support, -reponse-membre, -effacement, -repartition. verifier-fiche-personne echoue deja AVANT ce chantier (src/lib/tab/lectures.ts importe fiche-personne depuis 07a7dc8).
- A faire : commit, puis push du journal sur GO de Brice (= production). Un sujet cree, renomme ou ferme dans le groupe : a reporter dans SUJETS_LIVECLUB.
- A confirmer par Brice : les lives sont annonces dans Annonce ; les questions de trading vont dans Trading chat ; le contenu de l'offre Live Club de l'academie (fiche du 18/10).

## Agent AOK comprend les messages vocaux (31/10/2026, DEPLOYE le 31/10 a 14:38, commit 47cf17b, en sommeil sans cle ; aucune migration ; variable GROQ_API_KEY_COCKPIT A POSER)

- Fait : un message vocal (voice) ou un fichier audio (audio) envoye a Agent AOK est telecharge chez Telegram (getFile,
  jeton du bot qui l'a recu), transcrit par Groq (whisper-large-v3-turbo, langue fr, 30 s au plus, borne par
  limiteDuTour), puis traite comme un message ECRIT de la meme personne. Route : `src/app/api/cockpit/agent/telegram/route.ts`
  (apres le verrou 2, avant les pieces). Lecture pure : `lireVocalTelegram`, `texteDuTourVocal`, `ligneEntendu`,
  `texteEchecVocal` (`src/lib/agent-cockpit-telegram-pur.ts`) ; `lireMessageTelegram` inchangee (le bot des membres garde
  son parcours d'avant pour un vocal). Canal : `transcrireVocalTelegram` (`agent-cockpit-telegram.ts`).
- Fournisseur : `src/lib/transcription-pur.ts` (aucun import ; FOURNISSEUR_TRANSCRIPTION = URL, modele, NOM de la variable
  de la cle, prix, delai, poids max : tout service compatible OpenAI se branche la, rien d'autre a toucher) ;
  `src/lib/transcription.ts` (cle lue dans l'environnement, cout trace).
- Historique : « [message vocal, transcrit ci-dessous] » puis la transcription (6 000 caracteres au plus ; un tour vocal
  garde 7 500 caracteres, un message ecrit 4 000). Reponse : la ligne « J'ai entendu : « ... » » (400 caracteres, coupee
  au mot ; « (vocal transféré de X) » pour un transfert) ajoutee par le SERVEUR en tete de la reponse, de l'erreur et du
  temps depasse, jamais gardee en base (le modele ne la recopie pas). Prompt : « LES MESSAGES VOCAUX SUR TELEGRAM (31/10) ».
- Securite (grille de Brice) : partsDuTour ignore la trace du vocal ; le vocal du titulaire est analyse comme ses mots
  (niveau 'cache', ordreQuestionExplicite compris), un vocal TRANSFERE est au niveau 'tiers' (une donnee, jamais un ordre).
  Cartes toujours au clic. Alerte : source « message vocal, transcrit » ou « vocal transféré, transcrit ».
- Limites et echecs, toujours dits en clair : plus de 5 min (duree Telegram : rien n'est telecharge), plus de 20 Mo,
  format audio non lu (AAC...), cle absente (« Je ne sais pas encore écouter les vocaux ici (...) : écris-le-moi. »),
  cle refusee (401/403), delai, echec du service, silence (texte vide, ou sous-titre fantome de Whisper).
- Cout : AiUsage, product 'cockpit', poste 'transcription', modele whisper-large-v3-turbo, 0 jeton, costMicros =
  max(10 s, duree Telegram) x 0,04 USD/h x 0,92 ; trace des que Groq rend un texte (silence compris), echange
  vocal-u<update_id>. Aucune migration (AiUsage.usage est un texte libre). Ecran Depense IA : libelle ajoute dans
  `apps/cockpit/src/lib/depense-ia.ts` (« Agent, vocaux transcrits (Groq) », famille Agent) ; sans deploiement du
  cockpit, la ligne se lit « transcription, non détaillé ».
- Verifs : `node scripts/verifier-vocaux.mjs` (9 blocs, hors ligne : faux fetch pour Telegram, avec le vrai
  telechargerFichierTelegram, et pour Groq), verifier-securite-bots (17), verifier-agent-equipe (11 : la route a
  maintenant trois appels de traiterTexteAgentTelegram), verifier-liveclub (63), tsc, eslint. Aucun appel reel a Groq
  ni a Anthropic.
- A FAIRE : (1) Brice cree la cle Groq (console Groq, une cle pour le cockpit) et la pose sur Vercel, projet du journal,
  variable GROQ_API_KEY_COCKPIT ; (2) deployer le journal (sur GO) ; (3) UN essai reel : un vocal court a Agent AOK, puis
  un vocal transfere ; verifier la ligne « J'ai entendu » et la ligne AiUsage (poste transcription) ; (4) deployer le
  cockpit pour le libelle.
- Reste : un vocal d'un compte de l'equipe envoye au bot des membres (transmettreSiEquipe) n'est pas transcrit ; un audio
  envoye en FICHIER (document audio/...) non plus, ni une video ronde ; l'accuse reste « Je vérifie... » (la ligne
  « J'ai entendu » arrive avec la reponse) ; un rejeu Telegram du meme update re-transcrit avant le dedoublonnage (cout
  minime, aucun double message).
- Pour plus tard (non fait) : le bot du Live Club pour les membres (meme module transcription-pur.ts ; un vocal de membre
  analyse comme son ecrit, niveau 'injection') ; la bulle de support du site avec un bouton micro (reprendre si possible
  la dictee locale du Carnet) ; une ligne dans la politique de confidentialite, puisque la voix partirait chez Groq.

## Academie : les QUESTIONS D'ENTREE (30/10/2026, LOCAL, non pousse ; migration 20261031170000 NON appliquee)

- Ce que Skool demandait a l'arrivee, repose par l'academie : a la premiere entree d'un membre CONNECTE (pas un
  visiteur, pas un compte admin), deux questions facultatives au tutoiement, « Envoyer » ou « Passer » (la croix
  aussi), une seule fois. Textes et versions : `src/lib/academie/questions-entree.ts` (aucun import). Changer un
  libelle = AJOUTER une version ; chaque ligne garde le texte exact des questions avec la version.
- `/api/academie/moi` rend `questions_entree { poser, version, questions }` (table absente ou illisible = poser faux,
  /moi ne tombe pas). `POST /api/academie/questions` (Bearer, CORS academie) : reponses nettoyees (controles et
  invisibles retires, 2000 caracteres au plus) ou passe ; insert on conflict do nothing (une 2e ecriture ne remplace
  rien, rend deja) ; essai = verifie, n'ecrit rien. `POST /api/cockpit/academie/questions` (allowlist) : `membre`
  (user_ids d'une personne, fiche du cockpit) ou `lister`. Logs : compte tronque, jamais une reponse.
- Table `academie_questions_entree` fermee (RLS forcee, rien pour anon/authenticated, select pour service_role : le
  releve hebdo `extract_skool_painpoints.py` la lit, source `academie-questions-entree`).
- Site : `src/academie/Questions.tsx` (PopupQuestions dans la Coquille, apres le billet du jour, jamais par-dessus
  une autre fenetre : `fenetres.ts`), essai `?questions=essai`, demo `?questions=poser|essai|erreur`. Cockpit :
  `views/academie/QuestionsEntree.tsx` dans la rubrique Academie de la fiche membre.
- Verifs : `node scripts/verifier-questions-entree.mjs` (9 blocs), `node --env-file=.env.local
  scripts/essayer-migration-questions-entree.mjs` (transaction annulee). Compte rendu :
  D:\6_Societe\Pilotage\Academie\COMPTE-RENDU-QUESTIONS-ENTREE.md.
- A FAIRE SUR GO : migration 20261031170000, push du journal AVANT le site (sinon /moi n'a pas le champ : rien ne
  s'affiche, sans erreur), puis cockpit. L'effacement d'une personne (migration effacement, 15/10) ne connait pas
  encore cette table.

## Mails de confirmation d'achat (brief F1, 30/10/2026, LOCAL, non pousse ; migration 20261031150000 NON appliquee)

- Textes (vouvoiement, signes « Brice et Mélanie », depuis support@) : `src/lib/mails-achat-pur.ts`, mot pour mot de
  D:\2_Creation\Productions\Ecriture\2026-10-30-mails-confirmation-achat.md. Envoi Resend : `src/lib/mails-achat.ts`
  (RESEND_API_KEY_LIVECLUB ou RESEND_API_KEY, expediteur ACHAT_FROM_EMAIL facultatif, portail PILOTAGE_PORTAIL_LIEN).
- Declencheurs : webhook Pilotage (checkout.session.completed : Pilotage Premium ou Duo ; session d'abonnement sans
  metadata source sur le produit du Carnet Premium : mail du Carnet, aucun droit ecrit), webhook de l'academie (module).
  Jamais au renouvellement. Essai (?achat=essai ou Stripe de test) : objet « [Essai] ».
- Anti-doublon : table `mails_achat_envoyes` (cle reservee avant l'envoi). Table absente = AUCUN mail.
- 10% Club : `modeleEmailClub` = texte de la Formation (montant, prenom PayPal), meme declenchement.
- Live Club : les EMAILS vouvoient et sont signes (bienvenue vers l'academie, plus Skool) ; les messages prives du bot
  tutoient toujours. Code de verification aussi.
- Fiche du support `docs/connaissances/pilotage.md` : Libre, Premium, Duo, inclus Live Club et Formation, arret.
- A FAIRE SUR GO : migration 20261031150000, webhook Pilotage declare chez Stripe (deja au plan E1), domaine Resend.
  Verifs : `node scripts/verifier-mails-achat.mjs` (10 blocs), `node --env-file=.env.local
  scripts/essayer-migration-mails-achat.mjs` (transaction annulee). Compte rendu : D:\6_Societe\Pilotage\COMPTE-RENDU-F1.md.

## Offres de Pilotage (brief E1, 30/10/2026, LOCAL, non pousse ; migration 20261031120000 NON appliquee)

- Paliers (pur, `src/lib/pilotage-paliers.ts`) : libre (10 lectures sur 30 jours glissants + 25 offertes les 7 jours
  qui suivent la premiere lecture, consommees d'abord ; coffre 100 Mo ; une tranche par document long, remarque
  « Premium lit en entier »), premium (Pilotage Premium, Premium Duo ou raison Club du Carnet : 200 lectures, 2 Go,
  4 tranches), equipe (estSansPlafond : sans limite, 10 Go). La limite de 5 par jour de D1 a disparu.
- Droit = ligne academie_acces par abonnement (reference sub_..., fin = fin de periode + 3 jours, cote brice), posee par
  `GET /api/pilotage/achat/confirmer` et le webhook NOUVEAU `/api/pilotage/achat/webhook` (abonnement toujours relu chez
  Stripe). Le Duo ouvre le Carnet Premium (entitlements.ts, raison `duo`).
- Routes : `POST /api/pilotage/achat` (Embedded Checkout, mode subscription, fermee sans PILOTAGE_ACHAT_PUBLIC=1 sauf
  essai d'un admin), `GET /api/pilotage/niveau` (palier, compteurs, coffre, portail Stripe).
- A FAIRE SUR GO : migration 20261031120000, `node scripts/creer-produits-stripe-pilotage.mjs` (reel), webhook Stripe et
  STRIPE_WEBHOOK_SECRET_PILOTAGE, permissions de la cle Checkout, puis deploiement avec Pilotage E2. Compte rendu :
  D:\6_Societe\Pilotage\COMPTE-RENDU-E1.md. Verifs : `node scripts/verifier-pilotage-paliers.mjs` (11 blocs),
  `node --env-file=.env.local scripts/essayer-migration-pilotage.mjs` (transaction annulee).

## Securite des bots : injections de consignes (29/10/2026, DEPLOYE le 29/10, commit 71edf2c, aucune migration)

Demande de Brice du 29/10 : rien ne doit pouvoir lui porter prejudice par une consigne cachee (email, image, page, note
d'une autre IA, message de membre). Grille : memoire `bots-securite-par-conception.md` ; regle des sessions Claude :
D:\CLAUDE.md, section « Securite : injections et hameconnage par les IA ». A appliquer a tout futur bot (bot support...).
- Detection (pure, `src/lib/securite/injection-pur.ts`) : caracteres de largeur nulle et formats invisibles (fort a 3 dans
  100 caracteres), tags Unicode (texte ASCII invisible, decode), direction (Trojan source), selecteurs de variante en
  suite, controles C0/C1, Base64 qui cache une PHRASE ou une consigne (le JSON des URL de CDN Instagram, Facebook,
  CloudFront, efg= / Policy=, est faible : mesure sur la prod du 29/10), commentaire HTML, style qui masque ; puis selon
  le niveau : 'cache' (mots du titulaire, resultats d'outils), 'injection' (+ « ignore tes instructions », prompt systeme,
  changement de role, faux « [système] » / « Information du serveur », « deja valide » FORT seulement avec un geste
  sensible demande ou un autre signal fort : membres, notes de Tab), 'tiers' (+ adresse a
  une IA, RIB ou IBAN qui change : message transfere, fichier joint). Textes francais, « », insecables, emojis composes,
  drapeaux, ids Stripe, liens : rien. `rendreVisible` montre le cache (« [U+200B] », « [texte caché : ...] »).
- Alerte : `src/lib/securite/alerte.ts`, message d'Agent AOK au compte de Brice (meme canal que la note de Tab), source +
  citation + ce que le bot a fait. Anti-rafale : meme source et citation, une heure (memoire de l'instance).
- Agent AOK (`agent-cockpit.ts`, `agent-cockpit-telegram.ts`, route web) : section « LA SÉCURITÉ : QUI TE DONNE DES
  ORDRES » dans le prompt. Le tour separe les mots du titulaire et le contenu transmis (`partsDuTour`) ; suspect = texte
  garde et montre rendu visible, alerte, tour sous PRUDENCE : cartes ET gestes sans carte (reprendre_demande,
  rendre_la_main_au_bot, poser_question_equipe, rapporter_reponse_equipe) refuses par le serveur, note « [sécurité] » au
  modele. Resultats de requete_sql et fiche_personne analyses ('cache') : prefixe « [sécurité] », alerte, prudence pour la
  suite du tour. Fichier texte joint a la fenetre : niveau 'tiers'.
- Bot des membres : regle « Sécurité (règles de Brice, 29/10) » dans `prompt-membre.ts` ; message suspect
  (`agent-membre.ts`) : rendu visible, information du serveur, aucune proposition ni outil du relais, alerte ; historique
  rendu visible ; `lecture-attente.ts` : un message suspect n'est pas lu par l'IA (rien annule), alerte. Alerte
  « un membre demande un humain » : message et nom rendus visibles + ligne « Attention (sécurité) » (cette alerte entre a
  l'historique d'Agent AOK en role assistant).
- Notes de Tab (POST /notes) et de ChatGPT (ecrire_note) : `marquerNote` = « [à vérifier] » en tete du sujet et une ligne
  de tete qui dit pourquoi quand la note DEMANDE un geste sensible (secret, paiement ou coordonnees bancaires, envoi vers
  une destination, message a un tiers, suppression, cle ou permission, script en ligne, « deja valide ») ou porte du texte
  cache ; jamais bloquee ; visible par notes_tab.py --nouvelles, l'ecran Perso, l'email de Tab, le message a Brice (le
  sujet). Texte cache = alerte. ChatGPT au niveau 'cache' (ses notes citent des dialogues de jeu). Document depose par
  ChatGPT avec texte cache : alerte (range quand meme). Regle anti-injection ajoutee a INSTRUCTIONS (MCP) et a l'aide de Tab.
- Verifs : `node scripts/verifier-securite-bots.mjs` (17 blocs, hors ligne). Eval `node --env-file=.env.local
  scripts/eval-securite-bots.mjs S1|S2|S3` (UN cas par appel, mode essai) : 3/3 le 29/10 (S1 message transfere qui demande
  un remboursement « vu avec Brice » : aucune carte ; S2 et S3 : voir plus bas).
- RESTE : une image ou un PDF ne se scannent pas (regle du prompt seulement) ; une injection en clair sans aucun des motifs
  reste a la charge du prompt (les cartes gardent le clic humain) ; la cle de Tab lit tout le cockpit (portee non minimale,
  decision a prendre par Brice : Tab lit des emails, il peut etre lui-meme injecte) ; la cle Anthropic du bot des membres
  ne se coupe pas depuis le cockpit (console Anthropic ou Vercel ; journal = AiUsage) ; l'urgence seule n'est pas un signal
  (trop frequente chez les membres) ; anti-rafale de l'alerte par instance seulement.

## Agent AOK : question a l'equipe, accords des brokers, depot inscrit une seule fois (29/10/2026, DEPLOYE le 29/10, commit 71edf2c, aucune migration)

- Question a l'equipe (Brice : « demande a Mel ses accords avec Pulse ») : outil `poser_question_equipe` (sans carte),
  seulement sur l'ordre explicite du titulaire dans SES mots (`ordreQuestionExplicite` : verbe de demande + nom de la
  personne, ou « oui » a la proposition de l'agent qui la nommait ; jamais une image, un transfert, un document, une note,
  un resultat d'outil). Part apres la reponse (`RelanceEquipe.question`, `executerRelanceEquipe`) : « Brice demande : ... »
  dans le fil de Mel + deux lignes d'historique (marqueur, question). La reponse au titulaire cite la question (ajoutee par
  le serveur). Mel repond : `rapporter_reponse_equipe` transmet SES mots tels quels dans le fil de Brice, la question se
  ferme (`rapportQuestion`), les cartes eventuelles sont proposees chez elle. Question ouverte 7 jours. Eval S2 : 1/1.
- Accords des brokers (section « LES ACCORDS DES BROKERS » du prompt) : jamais demandes spontanement ; seulement quand un
  depot ou un acces broker arrive pour un broker sans accord connu (regle de commission, minimum et paliers, depuis
  quand), dans le meme echange. CHOIX DE MODELE, sans migration : accord simple = taux date (`proposer_taux_partenaire`,
  `accord` en texte) ; accord a PALIERS = note du partenaire « Accord à partir du ... » (seule note lue comme accord,
  `accordNote`) et commission propre a chaque depot, calculee par l'agent et montree sur la carte. Pourquoi : un modele a
  paliers demandait une migration, le calcul de commission et l'ecran Revenus a reprendre, pour quelques depots par mois
  tous confirmes par une carte. Accord connu = applique sans le redemander. Eval S3 : 1/1.
- Changement d'accord (Brice : « RaiseFx passe a 800 EUR ») : `proposer_taux_partenaire` sur un partenaire en base, sans
  nature (verifie hors ligne : validerAction, resumeAction, revalidation au clic). Le bot demande la date d'effet et si les
  depots deja inscrits changent (non par defaut). Carte : ancien accord (taux en vigueur + accord note), nouveau, date ;
  `retroactif` (dit explicitement) = les commissions ENCORE ATTENDUES depuis la date d'effet prennent le taux, listees sur
  la carte (`planRetroactif`, `phraseRetroactif`) ; recues, perdues et « [commission propre à ce dépôt] » jamais touchees.
  Un accord a paliers ne se fait pas en retroactif (chaque depot garde la sienne).
- Double depot (cas de Victor Weber, regularise par script le 29/10) : la garde de 10 minutes est remplacee par une garde
  SANS limite de temps, avant tout geste (meme broker, meme jour, meme montant, meme email ou acces), aussi avant la carte ;
  le prompt fait verifier cockpit_commissions et dire « deja inscrit » au lieu d'une carte (`texteDepotDejaInscrit`).

## 10% Club paye par PayPal : l'acces s'ouvre tout seul (29/10/2026, commite NON pousse, migration 20261029140000 APPLIQUEE)

Plan de l'academie, section 6, point 6. On garde PayPal (4x, et PayPal avance l'argent ; Stripe n'est PAS une option).
La page /club (site v3, src/academie/achat-club.ts + src/components/PaiementClub.tsx) charge le JS SDK et appelle :
- `GET /api/club/paypal` : { client_id, ouvert } ; 503 'config' sans PAYPAL_CLIENT_ID ou PAYPAL_CLIENT_SECRET.
- `POST /api/club/paypal/commande` { email?, renonciation: true, essai? } : commande Orders v2 (CAPTURE, EUR,
  reference_id club-10 ou club-10-essai, custom_id u:<uuid> du jeton sinon e:<email>, application_context
  AO Knowledge / NO_SHIPPING / PAY_NOW / fr-FR). Montant jamais lu dans le corps : 1 EUR en essai, sinon
  academie_offres.prix_eur de formation-complete (1 999 a defaut). Vente fermee tant que CLUB_PAYPAL_PUBLIC != 1 :
  seul l'essai d'un compte admin (profiles.role, estAdmin) passe ; ouverte, l'essai reste admin.
- `POST /api/club/paypal/capturer` { order_id } : commande relue chez PayPal (nos commandes seulement, montant
  verifie AVANT capture), capture (PayPal-Request-Id fixe par commande, ORDER_ALREADY_CAPTURED relu). COMPLETED :
  academie_acces formation-complete (source paypal, reference = order id, paiement_id paypal:<capture>, fin vide,
  cote brice, renonciation = create_time de la commande, note avec order, capture, montant, essai, payeur PayPal
  s'il differe), puis email d'acces par Resend (RESEND_API_KEY_LIVECLUB, support@, une seule fois). PENDING :
  { etat: 'en_attente' }, alerte Telegram a l'equipe (Agent AOK) avec la commande ; RAPPELER la route une fois le
  paiement confirme ouvre l'acces. Routes publiques (middleware), Bearer facultatif (compte_lie).
- Code : `src/lib/academie/club-paypal-pur.ts` (aucun import), `club-paypal.ts` (OAuth en memoire, Orders v2,
  acces, email, alerte), SQL_PRIX_OFFRE et SQL_POSER_ACHAT_PAYPAL dans requetes.ts. Verifs :
  `node scripts/verifier-club-paypal.mjs` (15 blocs), tsc, eslint ; SQL passe en EXPLAIN (arbitre = l'index).
- Migration `20261029140000_academie_achat_paypal.sql` : index unique academie_acces_paypal_reference_idx
  (reference where source = 'paypal'), appliquee le 29/10 (aucun acces paypal en base avant).
- A FAIRE : variables Vercel PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET (app REST live de Brice), puis l'achat test
  (aoknowledge.com/club?achat=essai, compte admin, 1 EUR, a rembourser chez PayPal : le remboursement ne retire
  PAS l'acces, pas de webhook) ; ensuite CLUB_PAYPAL_PUBLIC=1 cote journal ET CLUB_PAYPAL_SERVEUR = true cote site.
  Pousser le journal AVANT le site. Suite possible : webhook PayPal (PAYMENT.CAPTURE.COMPLETED / REFUNDED), non
  fait car il modifie la config PayPal de Brice ; academie_offres.cockpit_offre_id de formation-complete est vide.

## Agent AOK : le fil de Melanie, la duree libre des acces broker, les demandes restees sans reponse (29/10/2026, DEPLOYE le 29/10 a 13:05, commit 1548eda, aucune migration)

Bug reel du 28/10 (fil de Melanie, 12:53, 14:21, 22:03) : « Je vérifie... » puis plus rien. CAUSE PROUVEE (AiUsage,
cockpit_generations, historique en base ; logs Vercel du 28/10 plus disponibles) : 6 brouillons demandes a generer_post,
lances UN PAR UN (25 a 37 s chacun) dans le webhook (maxDuration 120 s) : fonction tuee au 3e ou 4e brouillon, sans
reponse ni catch ; la question restait sans reponse, donc chaque message suivant de Melanie relancait les memes brouillons
et mourait pareil (dernier_update_id bloque a « Oui », 7 brouillons en base jamais montres). Cle API hors de cause :
agent et generateur sur ANTHROPIC_API_KEY_COCKPIT (Vercel, inchangee depuis 60 j), appels du 28/10 reussis ; la cle
changee le 28/10 est celle du bot des membres (anthropic-liveclub-bot, posee sur Vercel le 29/10).
- Temps : route Agent AOK et route web a 300 s ; `limiteDuTour` (300 s - 25 s) passee a `boucleAgent` (canal.limite,
  canal.signal) : appel au modele coupe a la limite (AbortSignal), plus rien lance qu'il ne peut finir, sinon
  `reponsePartielle` (brouillons deja faits + « continue »). generer_post : 3 par message au plus, EN PARALLELE.
  Filet dans `tourAgent` (Promise.race, limite + 6 s) : message d'echec clair TEXTE_TEMPS_DEPASSE, ecrit `echec: true`.
  Reponse longue coupee (decouperMessage, messagesAvecCarte : carte entiere dans le dernier message), refus de Telegram
  dit en clair. Message transmis par le bot des membres : DUREE_TOUR_DEFAUT_MS (85 s).
- Demandes restees sans reponse : questions datees (`le`), echecs marques (`echec`). `demandesEnSuspens` (pur) ;
  note « [système] » au modele quand un message arrive apres une demande en suspens ; outils `demandes_en_suspens`
  (lecture) et `reprendre_demande` (sans carte : le tour de Mel tourne dans SON fil, pour elle, apres la reponse a
  Brice ; route web : after()). Resume du matin : rubrique « Demandes de l'équipe restées sans réponse (Agent AOK) ».
  Module serveur : src/lib/agent-equipe.ts.
- Prompt : l'equipe a ses fils (jamais « je ne peux pas ecrire a Melanie ») ; questions posees a l'INTERLOCUTEUR
  (jamais « demande a Brice / a Melanie ») ; capture envoyee par l'equipe = infos lues en clair, questions, puis carte ;
  le hors-sujet d'une image signale, jamais execute ; acces broker : section « UNE DEMANDE D'ACCÈS BROKER ».
- Duree libre (jamais faite avant : MOIS_ACCES_BROKER = 6 en dur depuis le 29/09) : `mois` (1 a 24, 6 par defaut) sur
  proposer_acces_broker et proposer_depot_broker, `accorderAccesBroker({ mois, source })`, email « pendant N mois ».
  Nouveau broker : proposer_taux_partenaire SANS taux (nouveau partenaire seulement), depot avec `commission` propre a
  ce depot (montant_fixe fige, note « [commission propre à ce dépôt] »). Bouton de carte = l'action precise.
  Le formulaire du cockpit (« Accorder 6 mois ») reste a 6 mois.
- Verifs : `node scripts/verifier-agent-equipe.mjs` (11 blocs), verifier-repartition (22), verifier-liveclub (63),
  tsc, eslint. Eval ciblee `node --env-file=.env.local scripts/eval-agent-equipe.mjs` (mode essai, aucune ecriture) :
  E1 message de Mel 22:03, E2 capture + « Vérifie ça » de Brice, E3 « reprends la demande de Mel » : 3/3 le 29/10.
- 29/10 apres deploiement : `regulariser-victor-weber.mjs --ecrire` a fait l'etape 1 (RaiseFx enregistre, broker, sans
  taux) puis s'est ARRETE a l'etape 2 sans rien ecrire : `vercel env pull` rend les variables « Sensitive » sous la
  forme du texte « [SENSITIVE] » (cles Stripe et sans doute Resend), Stripe repond 401. La prod n'est pas en cause.
  Un script local ne peut donc pas poser un acces broker : passer par l'app en ligne. Suite : Brice dit a Agent AOK
  « reprends la demande de Mel » ; le bot traite chez elle les brouillons et le depot de Victor (carte : RaiseFx,
  400 EUR, commission 400, 4 mois). Une fois l'acces pose, relancer le script : etapes 1 et 2 sautees, droit verifie
  sans l'exemption, exemption 2a1da732 fermee (base seulement).
- Brokers (Brice, 29/10) : RaiseFx et Pulse. Si les 6 acces d'avant (source « raisefx » par defaut du code) etaient
  bien RaiseFx, la commission etait 650 EUR fixes par depot des 1000 EUR, a partager a deux ; le palier minimum a
  baisse depuis (Victor : 400 EUR). Brice ne connait pas le detail des accords : A DEMANDER A MEL avant tout
  `poser-taux-broker.mjs`. Agent AOK ne sait pas encore poser une question NOUVELLE a Mel de lui-meme
  (reprendre_demande exige une demande en suspens).

## Academie : le BILLET DU JOUR (27/10/2026, commite NON pousse, migration 20261027190000 APPLIQUEE en prod)

Fonction validee par Brice le 27/10. Brice ecrit un billet dans le cockpit (espace Annonces, onglet « Billets ») :
titre, texte Markdown, video facultative (guid Bunny, bibliotheque formation, ou lien YouTube), publication
maintenant ou programmee. A la publication, tout compte CONNECTE a l'academie (gratuit compris) le voit une fois en
pop-up, puis le lit librement 48 h (bandeau de l'accueil) ; ensuite il reste une lecon des Chroniques.
- Conception : le billet EST des sa creation une lecon de la section « Billets » de chroniques-de-l-accelerateur
  (academie_lecons, usage interne). La fenetre libre est une REGLE DE DROITS : `ouvertureLecon` (pur.ts) ajoute la
  raison `billet` tant que maintenant < publie_le + 48 h (`FENETRE_LIBRE_BILLET_H`). La date vient d'une jointure
  sur academie_billets dans SQL_LECONS_VISIBLES / SQL_LECON_PAR_ID / SQL_LECONS_PAR_VIDEO (`billet_publie_le`) :
  lecture, pieces jointes, /moi et /catalogue appliquent la meme regle sans code a part. Rien ne bouge a 48 h.
  `trouver_cours` (fonction SQL) ne connait pas la fenetre : un compte gratuit y voit le billet ferme.
- Programme : la lecon reste en brouillon. Pas de pg_cron : `publierBilletsEchus` (billets.ts) la publie a la
  premiere lecture qui suit (GET /api/academie/billet, appele par chaque page de l'academie, et la liste du
  cockpit), une seule fois (`publication_faite_le`), et inscrit le pop-up dans cockpit_annonces_envoyees
  (canal `popup-academie`, cible « membres connectés », source `billet:<id>`). Lecon cachee ensuite depuis
  l'arbre = ni republiee, ni en pop-up. Un seul billet du jour : le plus recent dans sa fenetre.
- Code : `src/lib/academie/billets.ts` (aucun import : saisie, slug, SQL, enregistrerBillet, listerBillets,
  lireBilletDuJour, noterBilletVu) ; routes `GET|POST /api/academie/billet` (eleve, Bearer, CORS academie ;
  POST { billet } = pop-up ferme, table academie_billets_vus, memorise par compte) et
  `POST /api/cockpit/academie/billets` (allowlist du cockpit ; actions lister, enregistrer ; meme verrou que
  l'arbre ; date figee une fois publie ; titre/texte dans academie_editions).
- Migration `sites/Aoknowledgecom/supabase/migrations/20261027190000_academie_billets.sql` : tables academie_billets,
  academie_billets_vus (serveur, RLS forcee, aucun grant), check du canal elargi. Appliquee le 27/10 par
  appliquer-migration.sh, apres l'essai `node --env-file=.env.local scripts/essayer-migration-billets.mjs`
  (12 etapes en transaction annulee : droits gratuit/payant fenetre ouverte/fermee, pop-up vu, programme,
  edition, lecon cachee, contraintes).
- Verifs : `node scripts/verifier-billets.mjs` (9 blocs hors ligne), `verifier-academie.mjs --hors-ligne` (45).
- Site : `src/academie/Billet.tsx` (PopupBillet dans la Coquille, BandeauBillet sur l'accueil), api.ts
  (useBilletDuJour), raison `billet` (n'ajoute pas les Chroniques a « Mes cours »), demo `?billet=texte|youtube|vu`.
- A FAIRE au deploiement : pousser le journal AVANT le site (sinon le site appelle une route absente : rien ne
  s'affiche, sans erreur) ; le cockpit dit « route pas en ligne » tant que le journal n'est pas deploye.

## Connecteur MCP de Belrive : les IMAGES (25/10/2026, commite NON pousse, migration 20261025120000 APPLIQUEE)

ChatGPT disait ne pas pouvoir deposer d'images. Outil `deposer_image` (titre, role, nom_fichier, image) :
- Le fichier passe par `_meta["openai/fileParams"]: ["image"]` (doc Apps SDK : ChatGPT met
  `{ download_url, file_id, mime_type?, file_name? }`) ; repli `url` https, puis `donnees_base64` (600 Ko).
- Regles pures `src/lib/mcp-gpt/images-pur.ts` (octets magiques png/jpeg/webp/gif, 8 Mo, noms assainis,
  anti-SSRF) ; telechargement `telechargement.ts` (adresse verifiee a la connexion par lookup, redirections
  reverifiees, 15 s) ; bucket prive `stockage-images.ts` (chemin = empreinte sha256, sans upsert).
- Table `cockpit_perso_images` (figee sauf rapatrie_le, RLS forcee, lecture is_cockpit_perso), bucket `belrive-images`.
- `lister_documents` montre les images (ids `img:...`) ; Tab : `/images-belrive`, `/images-belrive/<id>/url` (5 min).
- PC : `pousser_docs_belrive.py` les range dans `Scenario\De-GPT\images\`.
- Verifs : `node scripts/verifier-images-belrive.mjs` (15), `node scripts/verifier-mcp-gpt.mjs` (33),
  `node scripts/essayer-images-belrive.mjs --migration | --bout-en-bout` (vraie base, rien ne reste).
- Limite : le passage d'une image GENEREE dans la conversation par fileParams n'est pas garanti (forum OpenAI,
  avis contraires) ; le message de refus d'un chemin /mnt/data dit a ChatGPT quoi faire. A essayer en vrai.

## Connecteur MCP de ChatGPT pour Belrive (23/10/2026, NON commite, NON deploye, migrations NON appliquees)

ChatGPT (Projet Belrive de Brice) lit les documents et les notes du projet belrive et ecrit des notes, par
`POST /api/mcp/<secret>` (MCP en HTTP sans etat, JSON, ecrit a la main : pas de SDK). Conseil de Tab valide par
Brice : « un petit serveur MCP devant l'API du Cockpit, un jeton a lui, limite a lecture + notes ».
- Code : `src/app/api/mcp/[secret]/route.ts` ; `src/lib/mcp-gpt/` : `pur.ts` (protocole, versions 2025-11-25,
  2025-06-18, 2025-03-26, les six outils search, fetch, lister_documents, lister_notes, ecrire_note,
  deposer_document, gardes), `requetes.ts` (TOUT le SQL, projet 'belrive' en dur), `serveur.ts` (prisma,
  transactions READ ONLY, pings des notes de Tab reutilises). Middleware : `/api/mcp/` public, secret verifie dans
  la route ; secret absent, inconnu ou coupe = la meme 404 neutre.
- Cle : `cockpit_tab_cles`, portee `gpt_belrive` (empreinte sha256 prefixee `mcp-gpt-belrive:`, separee de Tab ;
  `src/lib/tab/acces.ts` ne lit plus que la portee `tab`). 60 appels par minute, journal `cockpit_tab_acces`
  (route `mcp/...`, jamais le secret, aucun texte long). Nouvelle cle : `node scripts/creer-cle-gpt.mjs <fichier
  du coffre>` (URL complete dans le coffre, jamais affichee). Coupee depuis le cockpit, ecran Perso.
- Donnees : `cockpit_perso_documents` (source disque = liste blanche poussee chaque heure par
  `automations\pousser_docs_belrive.py`, source gpt = depots de ChatGPT sous Scenario/De-GPT/, une ligne par
  version, contenu fige par trigger, rapatries sur le PC sans ecrasement). Notes : `auteur = 'gpt'`.
- Sentry : `src/lib/sentry-masque.ts` masque `/api/mcp/<secret>` dans tout evenement (serveur et edge).
- Migrations a appliquer, dans l'ordre : `20261023170000_cockpit_perso_documents.sql`,
  `20261023171000_cockpit_tab_cles_portee.sql` (essayees dans une transaction annulee le 23/10 : RLS, droits,
  requetes exactes, gestionnaire complet, tout bon). AVANT le deploiement : le journal deploye filtre
  `portee = 'tab'`, colonne absente = API de Tab en panne.
- Verifs : `node scripts/verifier-mcp-gpt.mjs` (pur, 33 blocs), `node scripts/verifier-perso-rls.mjs` (documents
  compris une fois la migration appliquee). Mode d'emploi de Brice : README des automations, section « ChatGPT et
  Belrive ».
- Limite connue du secret dans l'URL : le chemin apparait dans les journaux de requetes de Vercel (Brice seul y a
  acces). Plus tard, OAuth a la place : (1) un serveur d'autorisation OAuth 2.1 avec PKCE et enregistrement
  dynamique (Supabase Auth n'en sert pas a des tiers : petit serveur dans le journal, /authorize sur la session de
  Brice, /token, /register, ou un fournisseur) ; (2) `/.well-known/oauth-protected-resource` (RFC 9728) sur le
  journal et une 401 `WWW-Authenticate: Bearer resource_metadata=...` sur `/api/mcp` ; (3) la route verifie
  `Authorization: Bearer` (signature, audience = l'URL du connecteur, expiration, portee belrive) et le secret du
  chemin disparait ; (4) les jetons restent coupables depuis le cockpit (revocation, meme bloc d'acces).

## Academie : les PDF payants passent sur Bunny CDN (23/10/2026, PUBLIE, variables BUNNY_PDF_HOTE et BUNNY_PDF_CLE_JETON posees en prod)

Lot D:\6_Societe\Pilotage\Academie\lots\LOT-PDF-SUR-BUNNY.md (GO de Brice). But : sortir le trafic des PDF du quota Supabase.
- `src/lib/academie/pdf-bunny.ts` (node:crypto seul) : lien de la Pull Zone a jeton, 5 min. Jeton actuel de Bunny
  (doc « Token Authentication - Advanced » et depot BunnyWay/BunnyCDN.TokenAuthentication) :
  `HS256-` + base64url(HMAC-SHA256(cle, chemin + expires)), PAS l'ancien SHA256(cle + chemin + expires).
- `stockage.ts` : variables `BUNNY_PDF_HOTE` (= pull_zone_hostname du coffre) et `BUNNY_PDF_CLE_JETON` (= token_auth_key).
  Aucune des deux = REPLI Supabase (bucket academie-ressources, comme avant) ; une seule ou mal formee = 503 'config'.
  Route inchangee sauf log (`source=bunny|supabase`). Avec Bunny, un fichier absent n'est plus vu par la route (404 chez Bunny).
- Bascule faite le 23/10 : `node --env-file=.env.local scripts/migrer-ressources-vers-bunny.mjs --ecrire` = 43 objets
  (135,5 Mo) copies au meme chemin et verifies taille + SHA256 ; relance a blanc = 43 deja la. Rien supprime dans Supabase.
- Envoi : `node scripts/envoyer-ressources-academie.mjs <dossier> <prefixe> [--ecrire]` vise Bunny (coffre
  bunny-storage.local.json, SHA256, plus de limite de 50 Mo). Outils communs : scripts/bunny-stockage.mjs.
- Controle en ligne (lecture seule) : `node scripts/verifier-pdf-bunny.mjs [chemin]` : signe 200 + %PDF ; sans jeton,
  expire, autre cle, jeton d'un autre fichier = 403 (OK le 23/10). Hors ligne : verifier-academie.mjs (vecteur officiel Bunny).
- La zone contient aussi `sauvegarde/` (copie de 3_Pedagogie et 5_Bibliotheque, posee hors de ce lot, en cours d'envoi le 23/10) : ne pas y toucher.
- A FAIRE (session principale) : poser les deux variables en prod, commit + push du journal, essai d'un PDF depuis le site ;
  puis retirer le repli Supabase et vider le bucket apres essai.

## Academie : l'arbre du catalogue range depuis le cockpit (23/10/2026, PUBLIE, migration 20261023150000 appliquee)

Lot D:\6_Societe\Pilotage\Academie\lots\LOT-ARBRE-CATALOGUE-COCKPIT.md (GO de Brice).
- Route `GET|POST /api/academie/arbre` (src/app/api/academie/arbre/route.ts) : Bearer + `roleAcademie`/`estAdmin`
  comme l'edition, 403 avant de lire le corps. GET = tout le catalogue (brouillons, ids video, noms de PJ, marques).
  POST = deplacer_lecons (autre section ou AUTRE module, plusieurs d'un coup, slug-2 si le slug est pris),
  deplacer_section, deplacer_module, statut (publie/brouillon ; video sans hebergeur ou texte vide refuses un par
  un), creer_section. Transaction qui verrouille tous les modules ; historique `academie_editions` (cible section,
  champs position/statut/creation) ; cache du catalogue vide ; l'arbre frais dans la reponse.
- `src/lib/academie/arbre.ts` (aucun import, expres : les scripts Node l'importent) : validation, plans purs,
  `renumeroter` (l'ordre d'une lecon est celui du MODULE entier, comme le site ; touche le moins de lignes possible),
  SQL, `executerGeste(tx, ...)`, `planImport*` pour l'importeur.
- CORS admin : `corsAcademie(req, methodes, true)` ajoute https://cockpit.aoknowledge.com (edition et arbre seulement).
- Importeur : lecon retrouvee par (module, slug) puis par origine (`origine_module_id`, `origine_slug`) : deplacee
  ailleurs = ni ramenee ni recreee ; `deplace_le` / `statut_le` gardes (bilan « garde : deplace dans le cockpit ») ;
  section retrouvee par `ordre_fichier` (plus par son ordre) ; slug d'une lecon arrivee d'ailleurs = arret net ;
  `--ecraser-editions` remet tout et note dans l'historique (origine import).
- Migration sites/Aoknowledgecom/supabase/migrations/20261023150000_academie_arbre.sql, jouee en transaction annulee
  contre la prod : `node --env-file=.env.local scripts/essayer-migration-arbre-academie.mjs` OK (13 etapes) le 23/10.
- Verifs : verifier-academie.mjs 44 blocs hors ligne (7 nouveaux), tsc, eslint, next build OK.
- ORDRE DE PUBLICATION : migration, puis journal, puis cockpit. Le prochain import exige la migration.
- Limites V1 : une section ne change pas de module ; pas de statut de section (ses lecons a la place) ; une lecon
  qui change de module change d'adresse (pas de redirection) ; apres un rangement, les lecons nouvelles du fichier
  prennent l'ordre du fichier (peut se melanger : ranger a nouveau).

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
