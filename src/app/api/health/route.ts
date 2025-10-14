import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Simple check de santé
    const timestamp = new Date().toISOString()
    
    return NextResponse.json({
      status: 'ok',
      timestamp,
      message: 'Server is running'
    }, { status: 200 })
  } catch (error) {
    console.error('Health check failed:', error)
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      message: 'Server error'
    }, { status: 500 })
  }
}