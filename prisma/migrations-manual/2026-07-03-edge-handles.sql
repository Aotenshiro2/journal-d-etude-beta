-- Connexions 4 cotes (mindmap) : memorise le cote de depart/arrivee du trait — ADDITIF.
ALTER TABLE "CanvasEdge" ADD COLUMN IF NOT EXISTS "fromHandle" TEXT;
ALTER TABLE "CanvasEdge" ADD COLUMN IF NOT EXISTS "toHandle" TEXT;
