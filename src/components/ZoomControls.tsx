'use client'

interface ZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
}

export default function ZoomControls({ zoom, onZoomIn, onZoomOut, onResetZoom }: ZoomControlsProps) {
  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-xl border border-gray-200 p-2 flex flex-col space-y-1 z-30">
      <button
        onClick={onZoomIn}
        disabled={zoom >= 3}
        className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors text-gray-600 font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        title="Zoom avant (Ctrl + molette)"
      >
        +
      </button>
      
      <div className="px-2 py-2 text-xs text-gray-600 text-center min-w-14 font-medium bg-gray-50 rounded">
        {Math.round(zoom * 100)}%
      </div>
      
      <button
        onClick={onZoomOut}
        disabled={zoom <= 0.1}
        className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors text-gray-600 font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        title="Zoom arrière (Ctrl + molette)"
      >
        −
      </button>
      
      <button
        onClick={onResetZoom}
        className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors text-gray-600 text-sm"
        title="Centrer et réinitialiser (100%)"
      >
        🏠
      </button>
    </div>
  )
}