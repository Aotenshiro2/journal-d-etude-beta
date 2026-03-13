import Link from 'next/link'
import { stripHtml, truncateText } from '@/lib/utils'

interface ConceptGroupProps {
  tag: {
    id: string
    name: string
    color: string
    category?: string | null
    messages: {
      message: {
        id: string
        content: string
        type: string
        note: { id: string; title: string; favicon?: string | null }
      }
    }[]
  }
}

export default function ConceptGroup({ tag }: ConceptGroupProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: tag.color }}
        />
        <h2 className="font-semibold text-white">{tag.name}</h2>
        {tag.category && (
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
            {tag.category}
          </span>
        )}
        <span className="text-xs text-gray-600 ml-auto">
          {tag.messages.length} bloc{tag.messages.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tag.messages.map(({ message }) => (
          <div
            key={message.id}
            className="p-3 rounded-xl border border-white/10 bg-white/[0.02] text-xs"
          >
            {message.type === 'image' ? (
              <span className="text-gray-500">🖼 Image</span>
            ) : (
              <p className="text-gray-300 leading-relaxed line-clamp-3">
                {truncateText(stripHtml(message.content), 150)}
              </p>
            )}
            <Link
              href={`/study/${message.note.id}`}
              className="flex items-center gap-1.5 mt-2 text-gray-500 hover:text-gray-300 transition-colors"
            >
              {message.note.favicon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={message.note.favicon} alt="" className="w-3 h-3 rounded flex-shrink-0" />
              )}
              <span className="truncate">{message.note.title}</span>
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
