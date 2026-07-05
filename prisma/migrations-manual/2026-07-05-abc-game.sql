-- Carte A/B/C-game (Tendler) : réflexion de l'élève sur ses niveaux de jeu.
-- 1 ligne par user ; `focus` = le chantier du moment (C-game à remonter).
-- prisma db push impossible sur ce projet → DDL manuelle appliquée via MCP execute_sql.
CREATE TABLE IF NOT EXISTS "AbcGame" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "aGame" TEXT NOT NULL DEFAULT '',
  "bGame" TEXT NOT NULL DEFAULT '',
  "cGame" TEXT NOT NULL DEFAULT '',
  "focus" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "AbcGame_userId_key" ON "AbcGame"("userId");
