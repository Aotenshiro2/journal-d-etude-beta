import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  // scope 'local' : le defaut ('global') revoque les sessions de TOUS les
  // appareils et de toutes les apps AOK — cockpit et extension compris.
  await supabase.auth.signOut({ scope: 'local' })
  const { origin } = new URL(request.url)
  return NextResponse.redirect(`${origin}/auth`)
}
