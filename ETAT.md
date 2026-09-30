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

## Bots : pause avant arret, liens utiles, codes promo (30/09/2026, NON commite)

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
- A suivre : mon_abonnement ne donne pas le MONTANT paye (le membre ne peut
  pas connaitre son tarif par le bot, il est renvoye a support@) ; le brief ne
  dit pas quel espace (Telegram ou Skool) porte quel lien.
