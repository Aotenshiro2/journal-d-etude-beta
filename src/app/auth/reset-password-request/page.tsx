'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordRequestPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
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
          <h1 className="text-xl font-semibold text-white">Mot de passe oublié</h1>
          <p className="text-sm text-gray-400 mt-1">Un lien de réinitialisation te sera envoyé</p>
        </div>

        {success ? (
          <div className="text-center space-y-3">
            <p className="text-green-400 text-sm">Email envoyé ! Vérifie ta boite mail.</p>
            <a href="/auth" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              Retour à la connexion
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="email"
              placeholder="Ton adresse email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleSubmit}
              disabled={loading || !email}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl
                bg-yellow-400 text-gray-900 font-medium text-sm
                hover:bg-yellow-300 transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading && <span className="w-4 h-4 border-2 border-gray-700 border-t-transparent rounded-full animate-spin" />}
              Envoyer le lien
            </button>
            <p className="text-center text-xs text-gray-600">
              <a href="/auth" className="hover:text-gray-400 transition-colors">
                Retour à la connexion
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
