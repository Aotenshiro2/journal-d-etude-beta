// Applique prisma/migrations-manual/2026-07-17-group-vivant-tagid.sql
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const r = await prisma.$executeRawUnsafe('ALTER TABLE "CanvasNode" ADD COLUMN IF NOT EXISTS "tagId" TEXT')
console.log('migration OK', r)
await prisma.$disconnect()
