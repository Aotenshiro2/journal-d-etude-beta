'use client'

interface ZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
}

export default function ZoomControls({ zoom, onZoomIn, onZoomOut, onResetZoom }: ZoomControlsProps) {
  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border border-gray-200 p-2 flex flex-col space-y-1 z-30">
      <button
        onClick={onZoomIn}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 transition-colors text-gray-600 font-semibold"
        title="Zoom avant"
      >
        +
      </button>
      
      <div className="px-2 py-1 text-xs text-gray-500 text-center min-w-12">
        {Math.round(zoom * 100)}%
      </div>
      
      <button
        onClick={onZoomOut}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 transition-colors text-gray-600 font-semibold"
        title="Zoom arrière"
      >
        −
      </button>
      
      <button
        onClick={onResetZoom}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 transition-colors text-gray-600 text-xs"
        title="Réinitialiser le zoom"
      >
        ⌂
      </button>
    </div>
  )
}