'use client'

import { CourseData } from '@/types'

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
    <div className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 z-40 flex items-center px-4 space-x-4">
      <div className="flex items-center space-x-2">
        <h1 className="text-xl font-bold text-gray-800">Journal d&apos;Études</h1>
      </div>

      <div className="flex-1 flex items-center space-x-4">
        <select
          value={selectedCourse || ''}
          onChange={(e) => onCourseSelect(e.target.value)}
          className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          className="px-3 py-1 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 transition-colors"
        >
          + Nouveau cours
        </button>
      </div>

      <div className="flex items-center space-x-2">
        <button
          onClick={onExport}
          className="px-3 py-1 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
        >
          Exporter PDF
        </button>
      </div>
    </div>
  )
}