import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Connexion — Trading Note | AOKnowledge',
  description: 'Accède à ton journal de trading intelligent. Prises de notes, suivi de sessions et analyse de performance.',
  robots: { index: true, follow: false },
  alternates: { canonical: 'https://journal.aoknowledge.com/auth' },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
