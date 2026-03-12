'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import { LogIn, LogOut, ChevronDown, ExternalLink } from 'lucide-react'

const EXTENSION_CANVAS = 'notes-extension-academic'

export default function UserMenu({ canvasId }: { canvasId?: string }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Fermer le dropdown en cliquant ailleurs
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = async () => {
    setOpen(false)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth')
  }

  const initials = user?.user_metadata?.full_name
    ? (user.user_metadata.full_name as string).split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.charAt(0).toUpperCase() ?? '?'

  if (loading) return null

  if (!user) {
    return (
      <a
        href="/auth"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
          bg-white/90 border border-gray-200 shadow-sm
          text-sm text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <LogIn className="w-3.5 h-3.5" />
        Connexion
      </a>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg
          bg-white/90 border border-gray-200 shadow-sm
          text-sm text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-blue-500/15 border border-blue-500/30
          flex items-center justify-center text-blue-600 text-xs font-semibold">
          {initials}
        </div>
        <span className="max-w-[120px] truncate hidden sm:block">
          {user.user_metadata?.full_name ?? user.email}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-white border border-gray-200 shadow-xl z-50 overflow-hidden">
          {/* User info */}
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user.user_metadata?.full_name ?? 'Utilisateur'}
            </p>
            <p className="text-xs text-gray-500 truncate mt-0.5">{user.email}</p>
          </div>

          {/* Canvas extension (si on n'y est pas déjà) */}
          {canvasId !== EXTENSION_CANVAS && (
            <a
              href={`/canvas/${EXTENSION_CANVAS}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5
                text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4 text-blue-500 flex-shrink-0" />
              Notes de l'extension
            </a>
          )}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-4 py-2.5
              text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  )
}
