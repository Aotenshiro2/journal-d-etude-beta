-- 0.1.5b (Brice 19/07/2026) : membership des collections + titre persistant.
-- Une note peut appartenir à N collections ; le mapping survit à la dissolution
-- du groupe de l'accueil (le parentId spatial n'est plus la vérité).
ALTER TABLE "Canvas" ADD COLUMN IF NOT EXISTS "title" TEXT;
CREATE TABLE IF NOT EXISTS "CollectionNote" (
  "canvasId" TEXT NOT NULL REFERENCES "Canvas"("id") ON DELETE CASCADE,
  "noteId"   TEXT NOT NULL REFERENCES "Note"("id")   ON DELETE CASCADE,
  PRIMARY KEY ("canvasId", "noteId")
);
