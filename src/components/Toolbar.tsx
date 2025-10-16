'use client'

import { CourseData } from '@/types'
import ThemeToggle from './ThemeToggle'

interface ToolbarProps {
  courses: CourseData[]
  selectedCourse?: string
  onCourseSelect: (courseId: string) => void
  onNewCourse: () => void
  onExport: () => void
}

export default function Toolbar({ 
  courses, 
  selectedCourse, 
  onCourseSelect, 
  onNewCourse,
  onExport 
}: ToolbarProps) {
  return (
    <div 
      className="fixed top-0 left-0 right-0 h-16 z-40 flex items-center px-4 space-x-4 theme-transition"
      style={{
        backgroundColor: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        color: 'var(--text-primary)'
      }}
    >
      <div className="flex items-center space-x-2">
        <h1 
          className="text-xl font-bold"
          style={{ color: 'var(--text-primary)' }}
        >
          Journal d&apos;Études
        </h1>
      </div>

      <div className="flex-1 flex items-center space-x-4">
        <select
          value={selectedCourse || ''}
          onChange={(e) => onCourseSelect(e.target.value)}
          className="px-3 py-1 rounded-md text-sm theme-transition focus-ring"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)'
          }}
        >
          <option value="">Tous les cours</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>

        <button
          onClick={onNewCourse}
          className="px-3 py-1 rounded-md text-sm transition-colors"
          style={{
            backgroundColor: 'var(--ao-green)',
            color: 'var(--text-inverse)'
          }}
          onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
          onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
        >
          + Nouveau cours
        </button>
      </div>

      <div className="flex items-center space-x-2">
        <button
          onClick={onExport}
          className="px-3 py-1 rounded-md text-sm transition-colors"
          style={{
            backgroundColor: 'var(--ao-blue)',
            color: 'var(--text-inverse)'
          }}
          onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
          onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
        >
          Exporter PDF
        </button>
        
        <ThemeToggle />
      </div>
    </div>
  )
}