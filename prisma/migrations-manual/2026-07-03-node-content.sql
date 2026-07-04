-- Lot 3.4 : travailler les blocs (PLAN-NOTATION.md) — ADDITIF.
-- Appliqué via : npx prisma db execute --file prisma/migrations-manual/2026-07-03-node-content.sql --schema prisma/schema.prisma

-- Contenu propre au node du canvas :
--   . kind='message' : SURCHARGE locale (copie de travail éditée/fusionnée) — le Message d'origine n'est JAMAIS modifié
--   . kind='text'    : contenu du bloc de texte libre
ALTER TABLE "CanvasNode" ADD COLUMN IF NOT EXISTS "content" TEXT;
