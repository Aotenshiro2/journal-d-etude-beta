-- Groupes nommés sur le canvas d'étude (PLAN-NOTATION.md lot 3.3) — ADDITIF.
-- Appliqué via : npx prisma db execute --file prisma/migrations-manual/2026-07-03-canvas-groups.sql --schema prisma/schema.prisma

-- kind : 'message' (bloc référencé) | 'group' (zone nommée) — 'text' viendra au lot 3.4
ALTER TABLE "CanvasNode" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'message';
-- Nom du groupe (proto-concept)
ALTER TABLE "CanvasNode" ADD COLUMN IF NOT EXISTS "label" TEXT;
-- Couleur du groupe (clé de palette : blue|green|amber|purple|pink)
ALTER TABLE "CanvasNode" ADD COLUMN IF NOT EXISTS "color" TEXT;
-- Appartenance à un groupe (position x/y alors RELATIVE au parent — convention React Flow)
ALTER TABLE "CanvasNode" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
-- Ordre manuel dans le groupe (utilisé par la projection document, lot 3.5)
ALTER TABLE "CanvasNode" ADD COLUMN IF NOT EXISTS "orderInParent" INTEGER;
CREATE INDEX IF NOT EXISTS "CanvasNode_parentId_idx" ON "CanvasNode"("parentId");
