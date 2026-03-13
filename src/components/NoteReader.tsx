import { NoteData } from '@/types'

interface NoteReaderProps {
  note: NoteData
}

export default function NoteReader({ note }: NoteReaderProps) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
        {note.favicon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={note.favicon} alt="" className="w-4 h-4 rounded flex-shrink-0" />
        )}
        <h2 className="text-sm font-semibold text-white leading-tight">{note.title}</h2>
      </div>
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
        className="text-gray-300 text-xs leading-relaxed"
        dangerouslySetInnerHTML={{ __html: note.content }}
      />
    </div>
  )
}
