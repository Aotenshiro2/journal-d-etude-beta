'use client'

import { useEffect, useRef } from 'react'

interface UseKeepAliveOptions {
  interval?: number // en millisecondes, défaut: 30 secondes
  enabled?: boolean
}

export function useKeepAlive({ interval = 30000, enabled = true }: UseKeepAliveOptions = {}) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!enabled) return

    const keepAlive = async () => {
      try {
        // Ping simple vers l'API pour maintenir la connexion
        await fetch('/api/health', {
          method: 'GET',
          cache: 'no-cache',
        })
        console.log('Keep-alive ping sent')
      } catch (error) {
        console.warn('Keep-alive ping failed:', error)
      }
    }

    // Ping initial
    keepAlive()

    // Configurer l'intervalle
    intervalRef.current = setInterval(keepAlive, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [interval, enabled])

  return {
    isEnabled: enabled,
    interval,
  }
}