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
