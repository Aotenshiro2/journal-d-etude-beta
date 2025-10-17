'use client'

import { useState, useEffect } from 'react'
import { Share2, Bookmark, Copy, Check, AlertTriangle } from 'lucide-react'

interface CanvasNotificationProps {
  canvasId: string
}

export default function CanvasNotification({ canvasId }: CanvasNotificationProps) {
  const [showNotification, setShowNotification] = useState(false)
  const [copied, setCopied] = useState(false)
  const [currentUrl, setCurrentUrl] = useState('')

  useEffect(() => {
    // Afficher la notification lors du premier chargement
    const hasSeenNotification = localStorage.getItem(`canvas-notification-${canvasId}`)
    if (!hasSeenNotification) {
      setShowNotification(true)
    }

    // Définir l'URL actuelle
    setCurrentUrl(window.location.href)
  }, [canvasId])

  const dismissNotification = () => {
    setShowNotification(false)
    localStorage.setItem(`canvas-notification-${canvasId}`, 'seen')
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const addToBookmarks = () => {
    // Proposer l'ajout aux favoris (ne fonctionne que sur certains navigateurs)
    if ('addToFavorites' in window) {
      // @ts-ignore - API non standard
      window.addToFavorites(currentUrl, `Canvas - ${canvasId.slice(0, 8)}`)
    } else {
      // Fallback : copier l'URL et afficher un message
      copyToClipboard()
      alert('URL copiée ! Ajoutez cette page à vos favoris pour retrouver votre travail.')
    }
  }

  const shareCanvas = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Mon Canvas d'Études`,
          text: 'Découvrez mon canvas de notes et de concepts',
          url: currentUrl
        })
      } catch (err) {
        console.error('Erreur lors du partage:', err)
        copyToClipboard()
      }
    } else {
      copyToClipboard()
    }
  }

  return (
    <>
      {/* Notification d'onboarding */}
      {showNotification && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-60 max-w-md">
          <div 
            className="rounded-xl shadow-2xl p-4 theme-transition"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--card-foreground))'
            }}
          >
            <div className="flex items-start space-x-3">
              <AlertTriangle 
                className="w-5 h-5 mt-0.5" 
                style={{ color: 'hsl(var(--ao-blue))' }}
              />
              <div className="flex-1">
                <h4 
                  className="font-semibold text-sm mb-1"
                  style={{ color: 'hsl(var(--foreground))' }}
                >
                  Canvas Personnel Créé !
                </h4>
                <p 
                  className="text-xs mb-3"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Votre URL unique : <code 
                    className="px-1 rounded text-xs"
                    style={{ 
                      backgroundColor: 'hsl(var(--muted))', 
                      color: 'hsl(var(--muted-foreground))'
                    }}
                  >
                    .../{canvasId.slice(0, 8)}
                  </code>
                </p>
                <p 
                  className="text-xs mb-3"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  ⚠️ <strong>Important :</strong> Sauvegardez cette page en favori pour retrouver votre travail !
                </p>
                <div className="flex space-x-2">
                  <button
                    onClick={addToBookmarks}
                    className="flex items-center space-x-1 px-3 py-1 rounded-lg text-xs transition-all"
                    style={{
                      backgroundColor: 'hsl(var(--ao-blue))',
                      color: 'hsl(var(--primary-foreground))'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                    onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                  >
                    <Bookmark className="w-3 h-3" />
                    <span>Sauvegarder</span>
                  </button>
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center space-x-1 px-3 py-1 rounded-lg text-xs transition-all"
                    style={{
                      backgroundColor: 'hsl(var(--secondary))',
                      color: 'hsl(var(--secondary-foreground))'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--secondary) / 0.8)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--secondary))'}
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copié !' : 'Copier URL'}</span>
                  </button>
                  <button
                    onClick={dismissNotification}
                    className="px-3 py-1 rounded-lg text-xs transition-all"
                    style={{
                      backgroundColor: 'hsl(var(--muted))',
                      color: 'hsl(var(--muted-foreground))'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.backgroundColor = 'hsl(var(--ao-red))'
                      e.currentTarget.style.color = 'hsl(var(--primary-foreground))'
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.backgroundColor = 'hsl(var(--muted))'
                      e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Boutons de partage permanents */}
      <div className="fixed top-4 right-4 z-50 flex flex-col space-y-2">
        <button
          onClick={shareCanvas}
          className="p-3 rounded-full shadow-lg hover:scale-110 transition-all duration-200 group"
          style={{
            backgroundColor: 'hsl(var(--ao-blue))',
            color: 'hsl(var(--primary-foreground))'
          }}
          title="Partager ce canvas"
          onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
          onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
        >
          <Share2 className="w-4 h-4" />
          <span 
            className="absolute right-full mr-2 top-1/2 transform -translate-y-1/2 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
            style={{
              backgroundColor: 'hsl(var(--popover))',
              color: 'hsl(var(--popover-foreground))',
              border: '1px solid hsl(var(--border))'
            }}
          >
            Partager
          </span>
        </button>
        
        <button
          onClick={copyToClipboard}
          className="p-3 rounded-full shadow-lg hover:scale-110 transition-all duration-200 group"
          style={{
            backgroundColor: 'hsl(var(--secondary))',
            color: 'hsl(var(--secondary-foreground))'
          }}
          title="Copier l'URL du canvas"
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--secondary) / 0.8)'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--secondary))'}
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          <span 
            className="absolute right-full mr-2 top-1/2 transform -translate-y-1/2 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
            style={{
              backgroundColor: 'hsl(var(--popover))',
              color: 'hsl(var(--popover-foreground))',
              border: '1px solid hsl(var(--border))'
            }}
          >
            {copied ? 'Copié !' : 'Copier URL'}
          </span>
        </button>
      </div>
    </>
  )
}