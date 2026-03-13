'use client'

import Link from 'next/link'

interface Workspace {
  id: string
  icon: string
  title: string
  description: string
  href: string
  available: boolean
}

export default function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  if (!workspace.available) {
    return (
      <div className="relative p-5 rounded-2xl border border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed">
        <div className="text-2xl mb-3">{workspace.icon}</div>
        <h3 className="font-semibold text-white text-sm mb-1">{workspace.title}</h3>
        <p className="text-xs text-gray-500 leading-relaxed">{workspace.description}</p>
        <span className="absolute top-3 right-3 text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">
          Bientôt
        </span>
      </div>
    )
  }

  return (
    <Link
      href={workspace.href}
      className="group p-5 rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/20 transition-all duration-200 block"
    >
      <div className="text-2xl mb-3">{workspace.icon}</div>
      <h3 className="font-semibold text-white text-sm mb-1 group-hover:text-yellow-300 transition-colors">
        {workspace.title}
      </h3>
      <p className="text-xs text-gray-400 leading-relaxed">{workspace.description}</p>
    </Link>
  )
}
