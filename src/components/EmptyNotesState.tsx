'use client'

import { useEffect, useState } from 'react'

export default function EmptyNotesState() {
  const [extensionInstalled, setExtensionInstalled] = useState<boolean | null>(null)

  useEffect(() => {
    // Vérifie si le content script de l'extension a injecté le flag
    setExtensionInstalled(
      document.documentElement.getAttribute('data-aok-installed') === '1'
    )
  }, [])

  const handleOpenExtension = () => {
    document.dispatchEvent(new CustomEvent('aok:open-panel'))
  }

  // En attente de détection
  if (extensionInstalled === null) return null

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-5xl mb-5">📭</div>
      <h2 className="text-lg font-semibold text-white mb-2">Aucune note pour l&apos;instant</h2>
      <p className="text-sm text-gray-500 max-w-sm mb-8">
        Capture des pages web avec l&apos;extension AOKnowledge — elles apparaissent ici automatiquement.
      </p>

      {extensionInstalled ? (
        <button
          onClick={handleOpenExtension}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-300 text-sm font-medium hover:bg-yellow-400/20 transition-colors"
        >
          <span>📌</span>
          Ouvrir l&apos;extension
        </button>
      ) : (
        <a
          href="https://chromewebstore.google.com/detail/aoknowledge/YOUR_EXTENSION_ID"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 text-sm font-medium hover:bg-white/10 transition-colors"
        >
          <span>🧩</span>
          Télécharger l&apos;extension Chrome
        </a>
      )}
    </div>
  )
}
