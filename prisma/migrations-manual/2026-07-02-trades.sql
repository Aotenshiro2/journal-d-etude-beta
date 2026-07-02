-- Segments de trade (PLAN-NOTATION.md lot 2.5) — changements ADDITIFS uniquement.
-- Appliqué via : npx prisma db execute --file prisma/migrations-manual/2026-07-02-trades.sql --schema prisma/schema.prisma

-- Rattachement d'un bloc/message à un segment de trade (réassignable — les blocs se déplacent)
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "tradeRef" TEXT;

-- Les segments de trade de la séance (id, startedAt, closedAt, outcome) — JSON, source de vérité extension
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "trades" JSONB;

-- Jugement d'un trade (vision A/B/C + cause du SL si perte)
ALTER TABLE "Annotation" ADD COLUMN IF NOT EXISTS "tradeRef" TEXT;
CREATE INDEX IF NOT EXISTS "Annotation_tradeRef_idx" ON "Annotation"("tradeRef");
