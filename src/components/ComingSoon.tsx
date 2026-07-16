interface ComingSoonProps {
  title: string
  icon: string
  description: string
}

// Écran « bientôt disponible » — posé au centre du canvas : le shell fournit déjà
// le fond, le dropdown (pour repartir ailleurs) et la pill. Plus de couleurs en
// dur : sans les variables de thème, l'écran restait sombre en mode clair.
export default function ComingSoon({ title, icon, description }: ComingSoonProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="text-6xl mb-6 opacity-30">{icon}</div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--node-title)' }}>{title}</h1>
      <p className="text-sm mb-8 max-w-sm text-center" style={{ color: 'var(--node-meta)' }}>{description}</p>
      <span
        className="px-4 py-2 rounded-xl text-sm"
        style={{ background: 'rgba(250, 204, 21, 0.1)', color: '#d97706', border: '1px solid rgba(250, 204, 21, 0.3)' }}
      >
        Bientôt disponible
      </span>
    </div>
  )
}
