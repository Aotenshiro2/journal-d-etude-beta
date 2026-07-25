import Link from 'next/link'
import { BookOpen, Network } from 'lucide-react'
import { NoteData, AnnotationData, TradeSegmentData } from '@/types'
import { stripHtml, truncateText, formatRelativeTime, extractImageSrc } from '@/lib/utils'

interface NoteCardProps {
  note: NoteData
}

const GRADE_CLASS: Record<string, string> = {
  A: 'bg-green-400/10 text-green-500',
  B: 'bg-amber-400/10 text-amber-500',
  C: 'bg-red-400/10 text-red-500',
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
    <div
      className="group rounded-2xl transition-all duration-200 overflow-hidden flex flex-col"
      style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}
    >
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
            <span className="text-xs mt-0.5 flex-shrink-0" style={{ color: 'var(--node-meta)' }}>📄</span>
          )}
          <h3 className="flex-1 font-semibold text-sm leading-tight line-clamp-2" style={{ color: 'var(--node-title)' }}>{note.title}</h3>
          {annotation && (
            <span
              className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold flex-shrink-0 ${GRADE_CLASS[annotation.grade] ?? ''}`}
              title={annotation.phrase}
            >
              {annotation.grade}
            </span>
          )}
        </div>
        {annotation?.phrase && (
          <p className="text-[11px] italic line-clamp-1 mb-1.5" style={{ color: 'var(--node-meta)' }}>« {annotation.phrase} »</p>
        )}
        {excerpt && (
          <p className="text-xs leading-relaxed line-clamp-3" style={{ color: 'var(--node-preview)' }}>{excerpt}</p>
        )}
        {(tags.length > 0 || note.folderName) && (
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {note.folderName && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-400/10 text-amber-500">
                📁 {note.folderName}
              </span>
            )}
            {tags.slice(0, 3).map(tag => (
              <span
                key={tag.id}
                className="px-1.5 py-0.5 text-[10px] rounded-full"
                style={{ border: '1px solid var(--node-border)', color: 'var(--node-meta)' }}
              >
                #{tag.name}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-[10px]" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>+{tags.length - 3}</span>
            )}
          </div>
        )}
        {trades.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2" title={`${trades.length} trade${trades.length > 1 ? 's' : ''} dans cette séance`}>
            <span className="text-[10px] text-blue-500 font-medium">⌖ {trades.length} trade{trades.length > 1 ? 's' : ''}</span>
            <span className="flex items-center gap-1">
              {trades.slice(0, 6).map(trade => {
                const grade = tradeGrade(note, trade)
                return grade ? (
                  <span key={trade.id} className={`w-3.5 h-3.5 rounded-full text-[9px] font-semibold flex items-center justify-center ${GRADE_CLASS[grade] ?? ''}`}>
                    {grade}
                  </span>
                ) : (
                  <span
                    key={trade.id}
                    className={`w-1.5 h-1.5 rounded-full ${trade.outcome ? OUTCOME_DOT[trade.outcome] : ''}`}
                    style={trade.outcome ? undefined : { border: '1px solid var(--node-meta)' }}
                  />
                )
              })}
            </span>
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-2">
        <span className="text-xs" style={{ color: 'var(--node-meta)' }}>
          {date}
          {note.worked && <span className="ml-2 text-blue-500/70" title="Déjà travaillée sur le canvas">✎ travaillée</span>}
        </span>
        {/* Deux intentions, deux boutons — lire la note d'origine, ou la
            travailler. Un seul « Étudier » obligeait à passer par l'exploration
            pour arriver à la lecture (retour Brice, 25/07/2026).
            Fond plein plutôt que teinté : à côté des pastilles pâles de la card,
            un bouton pâle de plus se lisait comme un tag, pas comme cliquable. */}
        <div className="flex items-center gap-2 mt-2.5">
          <Link
            href={`/notes/${note.id}/lecture`}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)' }}
          >
            <BookOpen size={13} /> Lire
          </Link>
          <Link
            href={`/notes/${note.id}`}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors"
          >
            <Network size={13} /> Étudier
          </Link>
        </div>
      </div>
    </div>
  )
}
