-- 0.1.5 « collection » (Brice 19/07/2026) : un groupe de notes de l'accueil peut
-- s'ouvrir dans un canvas de mapping commun qui embarque les blocs de PLUSIEURS
-- notes. Ce canvas a noteId=null (comme le canvas d'accueil) et pointe vers le
-- groupe source via sourceGroupId. Un seul canvas de collection par groupe.
ALTER TABLE "Canvas" ADD COLUMN IF NOT EXISTS "sourceGroupId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Canvas_sourceGroupId_key" ON "Canvas" ("sourceGroupId");
