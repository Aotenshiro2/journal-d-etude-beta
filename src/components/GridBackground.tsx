'use client'

interface GridBackgroundProps {
  width: number
  height: number
  zoom?: number
}

export default function GridBackground({ width, height, zoom = 1 }: GridBackgroundProps) {
  const gridSize = 20 * zoom
  const dotSize = 1.5
  
  return (
    <div 
      className="absolute inset-0 pointer-events-none"
      style={{
        width: width,
        height: height,
        backgroundImage: `radial-gradient(circle, #d1d5db ${dotSize}px, transparent ${dotSize}px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundColor: '#fafafa'
      }}
    />
  )
}