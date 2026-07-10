-- Warmups de séance multi-séances (extension v1.6.1) — changement ADDITIF uniquement.
-- Appliqué via : npx prisma db execute --file prisma/migrations-manual/2026-07-10-warmups.sql --schema prisma/schema.prisma

-- Les warmups de la note [{id, startedAt, physical?, emotional?, dominantThought?,
-- objective?, emotionLevel?, doneAt?}] — JSON, source de vérité extension (comme trades)
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "warmups" JSONB;
