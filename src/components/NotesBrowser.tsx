'use client'

// La liste des notes, avec sa recherche. Extrait de `/notes` (composant serveur)
// parce que filtrer demande de l'état client — la page garde la requête Prisma.
//
// Au téléphone, c'est LE point d'entrée vers ses notes (la bulle de l'accueil y
// renvoie), donc la recherche est en haut et atteignable au pouce.

import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import NoteCard from './NoteCard'
import EmptyNotesState from './EmptyNotesState'
import { NoteData } from '@/types'

export default function NotesBrowser({ notes }: { notes: NoteData[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    // Titre, dossier et tags : ce qu'on a en tête quand on cherche une note.
    // Le contenu n'entre pas dans le filtre — il ramènerait tout.
    return notes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      (n.folderName?.toLowerCase().includes(q) ?? false) ||
      (n.tags ?? []).some(t => t.tag.name.toLowerCase().includes(q))
    )
  }, [notes, query])

  if (notes.length === 0) return <EmptyNotesState />

  return (
    <>
      <div className="relative mb-4">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--node-meta)' }}
        />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Rechercher une note, un dossier, un tag…"
          className="w-full rounded-xl pl-9 pr-3 py-3 text-sm outline-none"
          style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)' }}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-center py-10" style={{ color: 'var(--node-meta)' }}>
          Aucune note ne correspond à « {query} ».
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(note => (
            <NoteCard key={note.id} note={note} />
          ))}
        </div>
      )}
    </>
  )
}
