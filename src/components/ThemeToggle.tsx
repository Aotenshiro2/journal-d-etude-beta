'use client'

import { useTheme } from '@/contexts/ThemeContext'
import { Sun, Moon } from 'lucide-react'

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg transition-all duration-200 hover:scale-105 theme-transition"
      style={{
        backgroundColor: 'var(--hover)',
        border: '1px solid var(--border)',
        color: 'var(--text-primary)'
      }}
      title={theme === 'dark' ? 'Basculer en mode clair' : 'Basculer en mode sombre'}
    >
      {theme === 'dark' ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  )
}