'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface UserMenuProps {
  user: { email: string; name: string }
}

export default function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth')
    router.refresh()
  }

  const initials = user.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : user.email?.[0]?.toUpperCase() ?? 'U'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-full bg-yellow-400/20 border border-yellow-400/30 text-yellow-300 text-xs font-semibold flex items-center justify-center hover:bg-yellow-400/30 transition-colors"
      >
        {initials}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 w-56 rounded-xl border border-white/10 bg-gray-900 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              {user.name && <p className="text-sm font-medium text-white truncate">{user.name}</p>}
              <p className="text-xs text-gray-400 truncate">{user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-white/5 transition-colors"
            >
              Se déconnecter
            </button>
          </div>
        </>
      )}
    </div>
  )
}
