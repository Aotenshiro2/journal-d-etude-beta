import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    // Test simple de connectivité
    console.log('🏥 [HEALTH] Testing database connection...')
    
    // Test de connexion basique
    await prisma.$connect()
    console.log('✅ [HEALTH] Database connected successfully')
    
    // Test de requête simple
    const result = await prisma.$executeRaw`SELECT 1 as test`
    console.log('✅ [HEALTH] Database query successful:', result)
    
    // Compter les notes
    const noteCount = await prisma.note.count()
    console.log('📊 [HEALTH] Total notes in database:', noteCount)
    
    return NextResponse.json({
      status: 'healthy',
      database: 'connected',
      totalNotes: noteCount,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV
    })
    
  } catch (error) {
    console.error('🚨 [HEALTH] Database connection failed:', error)
    
    return NextResponse.json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      databaseUrl: process.env.DATABASE_URL ? 'configured' : 'missing'
    }, { status: 500 })
  }
}