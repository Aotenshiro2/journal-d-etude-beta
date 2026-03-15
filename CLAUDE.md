# Journal d'Études — Instructions Claude

## Lire d'abord

`../../CLAUDE.md` — contexte écosystème complet, infrastructure partagée, contrat d'intégration avec l'extension.

## Cette app

Next.js 15 + React 19 + Prisma 6 + Supabase PostgreSQL
- URL: https://journal-d-etude-beta.vercel.app
- Repo: https://github.com/Aotenshiro2/journal-d-etude-beta

## Infrastructure (mars 2026 — à jour)

- **DB:** Supabase PostgreSQL (**PAS Railway** — abandonné oct 2025)
- **Auth:** Supabase SSR via `@supabase/ssr` (**PAS NextAuth**)
- **ORM:** Prisma 6 avec `directUrl` pour les migrations
- **Vars d'env:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, `DIRECT_URL`
- **`prisma db push` interdit sur Supabase** (erreur P4002 cross-schema) — utiliser `prisma generate` en local, migrations via Vercel

## Pattern Auth

- Server Components / API routes: `createClient()` depuis `@/lib/supabase/server`
- `middleware.ts`: valide la session sur chaque requête
- Extension → journal: Bearer token dans Authorization header → `supabase.auth.getUser(token)` dans `/api/notes`

## Commandes dev

```bash
npm run dev                 # serveur de développement
npm run build               # prisma generate s'exécute en premier
npm run db:push             # push schema vers Supabase (safe)
npm run db:generate         # après éditions du schema Prisma
npm run db:reset            # DESTRUCTIF — supprime toutes les données
```

## Points clés du schema Prisma

- `Note.sourceUrl` — clé d'upsert pour la sync extension (unique par userId+url)
- `Note.contentHash` — détecte les changements (flag `isDiverged` sur le canvas)
- `Message.order` — position entière dans la note
- `Tag.name` — unique par userId
- Canvas auto-créé au premier `GET /api/canvas?noteId=`

## API

- `POST /api/notes`: accepte Bearer token (extension) ET cookie SSR (navigateur)
- Logique upsert: si `sourceUrl` match pour ce `userId` → update, sinon create
- Messages envoyés en body sont insérés sans écraser les existants

## Pages implémentées

- `/` — liste des notes
- `/journal/[noteId]` — vue canvas d'une note
- `/concepts` — tags groupés avec leurs blocs message (implémenté)
- `/auth` + `/auth/callback` — Google OAuth PKCE
- `/market`, `/review`, `/study`, `/guide` — autres pages (statut variable)

## Pas de Task Master ici

Ne pas faire `task-master init`. Le suivi de tâches du journal est informel.
L'extension a Task Master dans `apps/academic-notes-extension/.taskmaster/`.

## Politique de commits

Ne jamais committer automatiquement. Toujours proposer et demander la permission.
Messages descriptifs expliquant le "pourquoi".
