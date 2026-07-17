'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { NoteData, MessageData, AnnotationData, TradeSegmentData } from '@/types'
import { extractImageSrc } from '@/lib/utils'
import ImageLightbox from './ImageLightbox'
import { useShowMeta } from '@/hooks/useShowMeta'

interface NoteReaderProps {
  note: NoteData
}

const GRADE_CLASS: Record<string, string> = {
  A: 'bg-green-400/10 text-green-500',
  B: 'bg-amber-400/10 text-amber-500',
  C: 'bg-red-400/10 text-red-500',
}

const OUTCOME_LABEL: Record<string, { label: string; cls: string }> = {
  gain: { label: 'Gain', cls: 'text-green-500' },
  perte: { label: 'Perte', cls: 'text-red-500' },
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
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const [showMeta, toggleShowMeta] = useShowMeta()
  const metaMessages = (note.messages ?? []).filter((m: MessageData) => m.type === 'meta')
  const annotations = note.annotations ?? []
  const noteAnnotation = latestBy(annotations, a => !a.messageRef && !a.tradeRef)
  const tags = (note.tags ?? []).map(t => t.tag)
  const trades: TradeSegmentData[] = [...(note.trades ?? [])].sort((a, b) => a.startedAt - b.startedAt)

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3 pb-3" style={{ borderBottom: '1px solid var(--float-border)' }}>
        {note.favicon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={note.favicon} alt="" className="w-4 h-4 rounded flex-shrink-0" />
        )}
        <h2 className="flex-1 text-sm font-semibold leading-tight" style={{ color: 'var(--node-title)' }}>{note.title}</h2>
        {metaMessages.length > 0 && (
          <button
            onClick={toggleShowMeta}
            title={showMeta ? 'Masquer les métadonnées de capture' : 'Afficher les métadonnées de capture (date, page, URL)'}
            className="flex items-center justify-center w-5 h-5 rounded flex-shrink-0 transition-colors"
            style={{ color: showMeta ? '#3b82f6' : 'var(--node-meta)', background: showMeta ? 'rgba(59,130,246,0.12)' : 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {showMeta ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        )}
        {noteAnnotation && (
          <span
            className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold flex-shrink-0 ${GRADE_CLASS[noteAnnotation.grade] ?? ''}`}
            title={noteAnnotation.phrase}
          >
            {noteAnnotation.grade}
          </span>
        )}
      </div>
      {noteAnnotation?.phrase && (
        <p className="text-[11px] italic mb-3" style={{ color: 'var(--node-meta)' }}>« {noteAnnotation.phrase} »</p>
      )}
      {(note.folderName || tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1 mb-3">
          {note.folderName && (
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-400/10 text-amber-500">
              📁 {note.folderName}
            </span>
          )}
          {tags.map(tag => (
            <span
              key={tag.id}
              className="px-1.5 py-0.5 text-[10px] rounded-full"
              style={{ border: '1px solid var(--node-border)', color: 'var(--node-meta)' }}
            >
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
              <div key={trade.id} className="rounded-lg border border-blue-400/20 bg-blue-400/5 px-2.5 py-1.5">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-blue-500 font-medium">⌖ Trade {i + 1}</span>
                  <span className="flex-1" />
                  {outcome && <span className={`font-medium ${outcome.cls}`}>{outcome.label}</span>}
                  {tradeAnnotation && (
                    <span className={`flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-semibold ${GRADE_CLASS[tradeAnnotation.grade] ?? ''}`}>
                      {tradeAnnotation.grade}
                    </span>
                  )}
                </div>
                {tradeAnnotation && (
                  <p className="text-[10px] italic mt-0.5" style={{ color: 'var(--node-meta)' }}>
                    {tradeAnnotation.causeCategory && (
                      <span className="not-italic text-red-500/90 mr-1">[{CAUSE_LABEL[tradeAnnotation.causeCategory] ?? tradeAnnotation.causeCategory}]</span>
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
          className="block text-xs mb-4 truncate transition-colors"
          style={{ color: '#3b82f6' }}
        >
          ↗ {note.sourceUrl}
        </a>
      )}
      {showMeta && metaMessages.length > 0 && (
        <div className="mb-3 space-y-1">
          {metaMessages.map((m: MessageData) => (
            <p key={m.id} className="text-[10px] italic break-all" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>
              {m.content}
            </p>
          ))}
        </div>
      )}
      <div
        className="note-preview-content text-sm leading-relaxed"
        style={{ color: 'var(--node-preview)' }}
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (target instanceof HTMLImageElement && target.src) setZoomSrc(target.src)
        }}
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
                  className="w-full rounded-lg"
                  style={{ border: '1px solid var(--node-border)', cursor: 'zoom-in' }}
                  loading="lazy"
                  onClick={() => setZoomSrc(src)}
                />
              ) : null
            })}
          </div>
        )
      })()}
      <ImageLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  )
}
