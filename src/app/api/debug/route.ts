import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    console.error('Debug API: Starting comprehensive database test...')
    
    // Test 1: Basic connectivity
    await prisma.$connect()
    console.error('Debug: ✅ Database connected')
    
    // Test 2: Raw SQL
    const rawResult = await prisma.$queryRaw`SELECT COUNT(*) as count FROM "Note"`
    console.error('Debug: Raw SQL result:', rawResult)
    
    // Test 3: All notes with basic fields
    const allNotes = await prisma.note.findMany({
      select: {
        id: true,
        title: true,
        canvasId: true,
        createdAt: true
      },
      take: 10
    })
    console.error('Debug: All notes (basic):', allNotes.length)
    
    // Test 4: Legacy canvas specifically
    const legacyNotes = await prisma.note.findMany({
      where: { canvasId: 'legacy' },
      select: {
        id: true,
        title: true,
        canvasId: true
      }
    })
    console.error('Debug: Legacy notes:', legacyNotes.length)
    
    // Test 5: Check if tables exist
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `
    console.error('Debug: Available tables:', tables)
    
    return NextResponse.json({
      status: 'debug_complete',
      results: {
        connected: true,
        rawCount: rawResult,
        allNotesCount: allNotes.length,
        legacyNotesCount: legacyNotes.length,
        sampleNotes: allNotes.slice(0, 3),
        legacyNotes: legacyNotes.slice(0, 3),
        tables: tables
      }
    })
    
  } catch (error) {
    console.error('Debug API ERROR:', {
      message: error instanceof Error ? error.message : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined
    })
    
    return NextResponse.json({
      status: 'debug_failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 })
  }
}