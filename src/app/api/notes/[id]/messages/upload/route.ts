import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createBrowserClient } from '@supabase/supabase-js'

async function getUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7))
    return user?.id ?? null
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { imageDataUrl, path: imagePath } = body

  if (!imageDataUrl?.startsWith('data:') || !imagePath) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const [header, b64] = imageDataUrl.split(',')
  const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg'
  const bytes = Buffer.from(b64, 'base64')

  if (bytes.length > 8_000_000) {
    return NextResponse.json({ error: 'Image too large (max 8MB)' }, { status: 413 })
  }

  const filename = imagePath.split('/').pop()
  const securePath = `${userId}/images/${filename}`

  const supabaseAdmin = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await supabaseAdmin.storage
    .from('extension-images')
    .upload(securePath, bytes, { upsert: true, contentType: mime })

  if (error) {
    console.error('[messages/upload]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/extension-images/${securePath}`
  return NextResponse.json({ url })
}
