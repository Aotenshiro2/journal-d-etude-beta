# ETAT du journal d etudes

Etat vivant du projet (infra, securite, fils ouverts). Le suivi des taches
reste dans TODO.md.

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

## Impayes du Live Club (30/09/2026, NON commite, NON deploye)

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

## Bot Live Club : une exemption datee vaut sortie programmee (06/10/2026, NON commite, NON deploye)

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
- Cockpit (depot workspace, NON commite, NON deploye) : sous la date de fin du
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
