import Link from 'next/link'

interface ComingSoonProps {
  title: string
  icon: string
  description: string
}

export default function ComingSoon({ title, icon, description }: ComingSoonProps) {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center">
      <div className="text-6xl mb-6 opacity-30">{icon}</div>
      <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
      <p className="text-gray-400 text-sm mb-8 max-w-sm text-center">{description}</p>
      <span className="px-4 py-2 rounded-xl bg-yellow-400/10 text-yellow-300 text-sm border border-yellow-400/20 mb-8">
        Bientôt disponible
      </span>
      <Link href="/" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
        ← Retour à l&apos;accueil
      </Link>
    </div>
  )
}
