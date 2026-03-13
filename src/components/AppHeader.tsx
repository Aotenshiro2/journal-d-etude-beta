import Link from 'next/link'
import ThemeToggle from './ThemeToggle'
import UserMenu from './UserMenu'

interface AppHeaderProps {
  user: { email: string; name: string }
  backHref?: string
  backLabel?: string
  title?: string
}

export default function AppHeader({ user, backHref, backLabel, title }: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-gray-950 flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors flex-shrink-0">
          <span>📚</span>
          <span className="text-sm font-medium hidden sm:block">AOKnowledge</span>
        </Link>
        {backHref && (
          <>
            <span className="text-gray-700 flex-shrink-0">/</span>
            <Link href={backHref} className="text-sm text-gray-400 hover:text-white transition-colors flex-shrink-0">
              {backLabel}
            </Link>
          </>
        )}
        {title && (
          <>
            <span className="text-gray-700 flex-shrink-0">/</span>
            <span className="text-sm text-white font-medium truncate">{title}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  )
}
