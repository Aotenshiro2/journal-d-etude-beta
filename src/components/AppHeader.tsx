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
    <header
      className="flex items-center justify-between px-5 py-3 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--float-border)', background: 'var(--canvas-bg)' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Link href="/" className="flex items-center gap-2 transition-colors flex-shrink-0" style={{ color: 'var(--node-meta)' }}>
          <span>📚</span>
          <span className="text-sm font-medium hidden sm:block">AOKnowledge</span>
        </Link>
        {backHref && (
          <>
            <span className="flex-shrink-0" style={{ color: 'var(--node-meta)', opacity: 0.5 }}>/</span>
            <Link href={backHref} className="text-sm transition-colors flex-shrink-0" style={{ color: 'var(--node-meta)' }}>
              {backLabel}
            </Link>
          </>
        )}
        {title && (
          <>
            <span className="flex-shrink-0" style={{ color: 'var(--node-meta)', opacity: 0.5 }}>/</span>
            <span className="text-sm font-medium truncate" style={{ color: 'var(--node-title)' }}>{title}</span>
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
