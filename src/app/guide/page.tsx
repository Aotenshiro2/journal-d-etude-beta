import Link from 'next/link'

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="flex items-center px-6 py-4 border-b border-white/10">
        <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
          <span>←</span>
          <span className="text-sm">Retour</span>
        </Link>
      </header>
      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold mb-2">Guide d&apos;utilisation</h1>
        <p className="text-gray-400 mb-10">Comment tirer le maximum de l&apos;AOKnowledge Journal</p>

        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold mb-3 text-yellow-300">📘 Étudier mes notes</h2>
            <ol className="space-y-2 text-sm text-gray-300 list-decimal list-inside">
              <li>Installe l&apos;extension Chrome AOKnowledge et capture tes notes de cours.</li>
              <li>Tes notes apparaissent automatiquement dans <strong>Étudier mes notes</strong>.</li>
              <li>Clique sur <strong>Étudier</strong> pour ouvrir le mode d&apos;étude.</li>
              <li>Glisse les blocs du panneau bas sur le canvas pour organiser les idées.</li>
              <li>Connecte les blocs entre eux pour créer des liens conceptuels.</li>
              <li>Clique sur un bloc pour lui ajouter des tags/concepts.</li>
              <li>Utilise <strong>Lier les notes</strong> pour une carte inter-notes.</li>
            </ol>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3 text-blue-400">💡 Bonnes pratiques</h2>
            <ul className="space-y-2 text-sm text-gray-300 list-disc list-inside">
              <li>Capture immédiatement après lecture — la mémoire s&apos;étiole vite.</li>
              <li>1 canvas = 1 note : ne mélange pas plusieurs sources.</li>
              <li>Utilise des tags cohérents entre notes pour retrouver facilement.</li>
              <li>La page <strong>Concepts</strong> regroupe tous tes blocs taggés.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3 text-gray-400">🚀 À venir</h2>
            <ul className="space-y-2 text-sm text-gray-500 list-disc list-inside">
              <li>Observer le marché — flux + analyse technique</li>
              <li>Journal de trading — suivi émotionnel et stats</li>
              <li>Analyser mes données — edge identification</li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  )
}
