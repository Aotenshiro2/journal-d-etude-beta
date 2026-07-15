-- Niveaux DOL — Draw on Liquidity (extension v1.6.2) — changement ADDITIF uniquement.
-- Appliqué via : npx prisma db execute --file prisma/migrations-manual/2026-07-10-dols.sql --schema prisma/schema.prisma

-- Les niveaux DOL de la note [{id, price, bias, instrument?, comment?, status,
-- createdAt, updatedAt?}] — JSON, source de vérité extension (comme trades/warmups)
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "dols" JSONB;
