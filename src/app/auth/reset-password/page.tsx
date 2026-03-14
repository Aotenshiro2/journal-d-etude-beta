'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    // Supabase JS v2 automatically reads the token from the URL hash on load
    // and fires an INITIAL_SESSION or PASSWORD_RECOVERY event
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setSessionReady(true)
      }
    })
    // Also check if session already present (token processed synchronously)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleReset = async () => {
    if (password !== passwordConfirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    if (password.length < 6) {
      setError('Le mot de passe doit faire au moins 6 caractères.')
      return
    }
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
      setTimeout(() => router.push('/'), 2500)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm p-8 rounded-2xl border border-white/10 bg-gray-900 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-yellow-400/10 border border-yellow-400/20 mb-4">
            <span className="text-2xl">📚</span>
          </div>
          <h1 className="text-xl font-semibold text-white">Nouveau mot de passe</h1>
          <p className="text-sm text-gray-400 mt-1">Choisis un nouveau mot de passe pour ton compte</p>
        </div>

        {success ? (
          <div className="text-center space-y-2">
            <p className="text-green-400 text-sm">Mot de passe mis à jour !</p>
            <p className="text-xs text-gray-500">Redirection en cours…</p>
          </div>
        ) : !sessionReady ? (
          <div className="text-center">
            <span className="inline-block w-5 h-5 border-2 border-yellow-400/40 border-t-yellow-400 rounded-full animate-spin" />
            <p className="text-xs text-gray-500 mt-2">Vérification du lien…</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Nouveau mot de passe"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 rounded-lg bg-gray-800 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                )}
              </button>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Confirmer le mot de passe"
              value={passwordConfirm}
              onChange={e => setPasswordConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleReset()}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleReset}
              disabled={loading || !password || !passwordConfirm}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl
                bg-yellow-400 text-gray-900 font-medium text-sm
                hover:bg-yellow-300 transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading && <span className="w-4 h-4 border-2 border-gray-700 border-t-transparent rounded-full animate-spin" />}
              Changer le mot de passe
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
