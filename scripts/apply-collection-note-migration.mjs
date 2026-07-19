// Applique prisma/migrations-manual/2026-07-19b-collection-note.sql
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
await prisma.$executeRawUnsafe('ALTER TABLE "Canvas" ADD COLUMN IF NOT EXISTS "title" TEXT')
await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CollectionNote" (
  "canvasId" TEXT NOT NULL REFERENCES "Canvas"("id") ON DELETE CASCADE,
  "noteId"   TEXT NOT NULL REFERENCES "Note"("id")   ON DELETE CASCADE,
  PRIMARY KEY ("canvasId", "noteId")
)`)
console.log('migration collection-note OK')
await prisma.$disconnect()
