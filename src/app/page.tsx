'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { v4 as uuidv4 } from 'uuid'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // Générer un nouvel UUID pour le canvas et rediriger
    const newCanvasId = uuidv4()
    router.replace(`/canvas/${newCanvasId}`)
  }, [router])

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="text-lg font-semibold mb-2">Création de votre canvas personnel...</div>
        <div className="text-sm text-gray-600">Redirection en cours...</div>
        <div className="mt-4 w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
      </div>
    </div>
  )
}