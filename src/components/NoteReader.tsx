import { NoteData, MessageData, AnnotationData, TradeSegmentData } from '@/types'
import { extractImageSrc } from '@/lib/utils'

interface NoteReaderProps {
  note: NoteData
}

const GRADE_CLASS: Record<string, string> = {
  A: 'bg-green-400/10 text-green-400',
  B: 'bg-amber-400/10 text-amber-400',
  C: 'bg-red-400/10 text-red-400',
}

const OUTCOME_LABEL: Record<string, { label: string; cls: string }> = {
  gain: { label: 'Gain', cls: 'text-green-400' },
  perte: { label: 'Perte', cls: 'text-red-400' },
  be: { label: 'BE', cls: 'text-gray-400' },
}

const CAUSE_LABEL: Record<string, string> = {
  technique: 'technique',
  connaissance: 'connaissance',
  emotionnel: 'émotionnel',
}

function latestBy(annotations: AnnotationData[], predicate: (a: AnnotationData) => boolean): AnnotationData | undefined {
  return annotations
    .filter(predicate)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
}

export default function NoteReader({ note }: NoteReaderProps) {
  const annotations = note.annotations ?? []
  const noteAnnotation = latestBy(annotations, a => !a.messageRef && !a.tradeRef)
  const tags = (note.tags ?? []).map(t => t.tag)
  const trades: TradeSegmentData[] = [...(note.trades ?? [])].sort((a, b) => a.startedAt - b.startedAt)

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
        {note.favicon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={note.favicon} alt="" className="w-4 h-4 rounded flex-shrink-0" />
        )}
        <h2 className="flex-1 text-sm font-semibold text-white leading-tight">{note.title}</h2>
        {noteAnnotation && (
          <span
            className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold flex-shrink-0 ${GRADE_CLASS[noteAnnotation.grade] ?? 'bg-white/10 text-gray-300'}`}
            title={noteAnnotation.phrase}
          >
            {noteAnnotation.grade}
          </span>
        )}
      </div>
      {noteAnnotation?.phrase && (
        <p className="text-[11px] text-gray-400 italic mb-3">« {noteAnnotation.phrase} »</p>
      )}
      {(note.folderName || tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1 mb-3">
          {note.folderName && (
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-yellow-400/10 text-yellow-300/80">
              📁 {note.folderName}
            </span>
          )}
          {tags.map(tag => (
            <span key={tag.id} className="px-1.5 py-0.5 text-[10px] rounded-full bg-white/5 text-gray-400 border border-white/10">
              #{tag.name}
            </span>
          ))}
        </div>
      )}
      {trades.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {trades.map((trade, i) => {
            const tradeAnnotation = latestBy(annotations, a => a.tradeRef === trade.id)
            const outcome = trade.outcome ? OUTCOME_LABEL[trade.outcome] : null
            return (
              <div key={trade.id} className="rounded-lg border border-blue-400/15 bg-blue-400/5 px-2.5 py-1.5">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-blue-400/90 font-medium">⌖ Trade {i + 1}</span>
                  <span className="flex-1" />
                  {outcome && <span className={`font-medium ${outcome.cls}`}>{outcome.label}</span>}
                  {tradeAnnotation && (
                    <span className={`flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-semibold ${GRADE_CLASS[tradeAnnotation.grade] ?? 'bg-white/10 text-gray-300'}`}>
                      {tradeAnnotation.grade}
                    </span>
                  )}
                </div>
                {tradeAnnotation && (
                  <p className="text-[10px] text-gray-400 italic mt-0.5">
                    {tradeAnnotation.causeCategory && (
                      <span className="not-italic text-red-400/80 mr-1">[{CAUSE_LABEL[tradeAnnotation.causeCategory] ?? tradeAnnotation.causeCategory}]</span>
                    )}
                    « {tradeAnnotation.phrase} »
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
      {note.sourceUrl && (
        <a
          href={note.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-blue-400 hover:text-blue-300 mb-4 truncate transition-colors"
        >
          {note.sourceUrl}
        </a>
      )}
      <div
        className="note-content text-gray-300 text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: note.content }}
      />
      {(() => {
        const imageMessages = (note.messages ?? []).filter(
          (m: MessageData) => m.type === 'image'
        )
        if (imageMessages.length === 0) return null
        return (
          <div className="mt-4 space-y-3">
            {imageMessages.map((m: MessageData) => {
              const src = extractImageSrc(m.content)
              return src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={m.id}
                  src={src}
                  alt=""
                  className="w-full rounded-lg border border-white/10"
                  loading="lazy"
                />
              ) : null
            })}
          </div>
        )
      })()}
    </div>
  )
}
