-- 0.1.3 « groupe vivant » (décision Brice 17/07/2026, option A) :
-- un groupe promu en concept garde le lien vers son tag. Déposer une note/un
-- bloc dans le groupe applique le tag ; l'en sortir retire celui du groupe.
-- Couplage lâche (pas de FK) — même convention que Note.folderId.
ALTER TABLE "CanvasNode" ADD COLUMN IF NOT EXISTS "tagId" TEXT;
