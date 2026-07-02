-- Sync des dossiers de l'extension (suite incident perte de notes du 02/07) — ADDITIF.
-- Appliqué via : npx prisma db execute --file prisma/migrations-manual/2026-07-03-folders.sql --schema prisma/schema.prisma

-- Dossiers de l'extension (id = uuid extension, source de vérité extension)
CREATE TABLE IF NOT EXISTS "Folder" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Folder_userId_idx" ON "Folder"("userId");

-- Appartenance d'une note à un dossier (pas de FK — couplage lâche, dossiers gérés par l'extension)
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "folderId" TEXT;
