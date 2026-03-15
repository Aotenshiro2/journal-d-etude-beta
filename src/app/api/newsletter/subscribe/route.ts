import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { email, name } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const apiKey = process.env.CONVERTKIT_API_KEY
  if (!apiKey) {
    console.error('[Newsletter] CONVERTKIT_API_KEY not set')
    return NextResponse.json({ error: 'not configured' }, { status: 500 })
  }

  const res = await fetch('https://api.kit.com/v4/subscribers', {
    method: 'POST',
    headers: {
      'X-Kit-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email_address: email,
      first_name: name || undefined,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[Newsletter] Kit API error:', res.status, text)
    return NextResponse.json({ error: text }, { status: res.status })
  }

  return NextResponse.json({ ok: true })
}
