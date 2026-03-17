import Link from 'next/link'
import { NoteData } from '@/types'
import { stripHtml, truncateText, formatRelativeTime, extractImageSrc } from '@/lib/utils'

interface NoteCardProps {
  note: NoteData
}

export default function NoteCard({ note }: NoteCardProps) {
  const excerpt = truncateText(stripHtml(note.content), 120)
  const date = formatRelativeTime(new Date(note.updatedAt))
  const firstImage = note.content
    ? extractImageSrc(note.content.match(/<img[^>]*>/)?.[0] ?? '')
    : null

  return (
    <div className="group rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20 transition-all duration-200 overflow-hidden flex flex-col">
      {firstImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={firstImage} alt="" className="w-full h-32 object-cover" />
      )}
      <div className="p-4 pb-2 flex-1">
        <div className="flex items-start gap-2 mb-2">
          {note.favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={note.favicon} alt="" className="w-4 h-4 rounded mt-0.5 flex-shrink-0" />
          ) : (
            <span className="text-xs text-gray-600 mt-0.5 flex-shrink-0">📄</span>
          )}
          <h3 className="font-semibold text-sm text-white leading-tight line-clamp-2">{note.title}</h3>
        </div>
        {excerpt && (
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">{excerpt}</p>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 flex items-center justify-between">
        <span className="text-xs text-gray-600">{date}</span>
        <Link
          href={`/study/${note.id}`}
          className="px-3 py-1.5 rounded-lg bg-yellow-400/10 border border-yellow-400/20 text-yellow-300 text-xs font-medium hover:bg-yellow-400/20 transition-colors"
        >
          Étudier →
        </Link>
      </div>
    </div>
  )
}
