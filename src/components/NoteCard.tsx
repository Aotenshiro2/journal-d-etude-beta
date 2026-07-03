import Link from 'next/link'
import { NoteData, AnnotationData, TradeSegmentData } from '@/types'
import { stripHtml, truncateText, formatRelativeTime, extractImageSrc } from '@/lib/utils'

interface NoteCardProps {
  note: NoteData
}

const GRADE_CLASS: Record<string, string> = {
  A: 'bg-green-400/10 text-green-400',
  B: 'bg-amber-400/10 text-amber-400',
  C: 'bg-red-400/10 text-red-400',
}

const OUTCOME_DOT: Record<string, string> = {
  gain: 'bg-green-400',
  perte: 'bg-red-400',
  be: 'bg-gray-500',
}

/** Annotation de la note entière (ni message, ni trade), la plus récente. */
function noteAnnotation(note: NoteData): AnnotationData | undefined {
  return (note.annotations ?? [])
    .filter(a => !a.messageRef && !a.tradeRef)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
}

function tradeGrade(note: NoteData, trade: TradeSegmentData): string | undefined {
  return (note.annotations ?? [])
    .filter(a => a.tradeRef === trade.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]?.grade
}

export default function NoteCard({ note }: NoteCardProps) {
  const excerpt = truncateText(stripHtml(note.content), 120)
  const date = formatRelativeTime(new Date(note.lastModifiedAt))
  const firstImageFromMessages = note.messages?.[0]?.content
    ? extractImageSrc(note.messages[0].content)
    : null
  const firstImageFromContent = note.content
    ? extractImageSrc(note.content.match(/<img[^>]*>/)?.[0] ?? '')
    : null
  const firstImage = firstImageFromMessages ?? firstImageFromContent

  const annotation = noteAnnotation(note)
  const tags = (note.tags ?? []).map(t => t.tag)
  const trades = [...(note.trades ?? [])].sort((a, b) => a.startedAt - b.startedAt)

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
          <h3 className="flex-1 font-semibold text-sm text-white leading-tight line-clamp-2">{note.title}</h3>
          {annotation && (
            <span
              className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold flex-shrink-0 ${GRADE_CLASS[annotation.grade] ?? 'bg-white/10 text-gray-300'}`}
              title={annotation.phrase}
            >
              {annotation.grade}
            </span>
          )}
        </div>
        {annotation?.phrase && (
          <p className="text-[11px] text-gray-400 italic line-clamp-1 mb-1.5">« {annotation.phrase} »</p>
        )}
        {excerpt && (
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">{excerpt}</p>
        )}
        {(tags.length > 0 || note.folderName) && (
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {note.folderName && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-yellow-400/10 text-yellow-300/80">
                📁 {note.folderName}
              </span>
            )}
            {tags.slice(0, 3).map(tag => (
              <span key={tag.id} className="px-1.5 py-0.5 text-[10px] rounded-full bg-white/5 text-gray-400 border border-white/10">
                #{tag.name}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-[10px] text-gray-600">+{tags.length - 3}</span>
            )}
          </div>
        )}
        {trades.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2" title={`${trades.length} trade${trades.length > 1 ? 's' : ''} dans cette séance`}>
            <span className="text-[10px] text-blue-400/80 font-medium">⌖ {trades.length} trade{trades.length > 1 ? 's' : ''}</span>
            <span className="flex items-center gap-1">
              {trades.slice(0, 6).map(trade => {
                const grade = tradeGrade(note, trade)
                return grade ? (
                  <span key={trade.id} className={`w-3.5 h-3.5 rounded-full text-[9px] font-semibold flex items-center justify-center ${GRADE_CLASS[grade] ?? 'bg-white/10 text-gray-300'}`}>
                    {grade}
                  </span>
                ) : (
                  <span
                    key={trade.id}
                    className={`w-1.5 h-1.5 rounded-full ${trade.outcome ? OUTCOME_DOT[trade.outcome] : 'border border-gray-600'}`}
                  />
                )
              })}
            </span>
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 flex items-center justify-between">
        <span className="text-xs text-gray-600">
          {date}
          {note.worked && <span className="ml-2 text-yellow-300/60" title="Déjà travaillée sur le canvas">✎ travaillée</span>}
        </span>
        <Link
          href={`/notes/${note.id}`}
          className="px-3 py-1.5 rounded-lg bg-yellow-400/10 border border-yellow-400/20 text-yellow-300 text-xs font-medium hover:bg-yellow-400/20 transition-colors"
        >
          Étudier →
        </Link>
      </div>
    </div>
  )
}
