// Applique prisma/migrations-manual/2026-07-19-canvas-collection.sql
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
await prisma.$executeRawUnsafe('ALTER TABLE "Canvas" ADD COLUMN IF NOT EXISTS "sourceGroupId" TEXT')
await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Canvas_sourceGroupId_key" ON "Canvas" ("sourceGroupId")')
console.log('migration collection OK')
await prisma.$disconnect()
