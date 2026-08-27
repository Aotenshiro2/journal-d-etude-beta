-- Sous-dossiers, 1 niveau max (demande élève, 28/08/2026).
-- null = dossier racine. Pas de FK (couplage lâche, ids venant de l'extension) ;
-- la profondeur est bornée à l'écriture (API /api/notes + UI extension).
ALTER TABLE "Folder" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
