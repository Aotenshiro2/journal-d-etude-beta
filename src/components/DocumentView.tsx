'use client'

import { useMemo, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { MessageData, CanvasNodeData } from '@/types'
import { parseBlockContent, GROUP_COLORS } from './StudyCanvas'

// La vue document — l'AUTRE projection du même modèle : les groupes du canvas
// deviennent des sections, les blocs une liste réordonnable. Rien de nouveau
// n'est stocké : l'ordre manuel vit dans CanvasNode.orderInParent.

interface DocumentViewProps {
  nodes: CanvasNodeData[]
  messages: MessageData[]
  insetLeft: number
  onUpdateNode: (nodeId: string, patch: Partial<Pick<CanvasNodeData, 'x' | 'y' | 'parentId' | 'orderInParent'>>) => Promise<void> | void
}

const FREE = '__free__'

// Ordre de projection : ordre manuel s'il existe, sinon la position spatiale (haut → bas)
const byOrder = (a: CanvasNodeData, b: CanvasNodeData) =>
  ((a.orderInParent ?? 1e9) - (b.orderInParent ?? 1e9)) || (a.y - b.y) || (a.x - b.x)

export default function DocumentView({ nodes, messages, insetLeft, onUpdateNode }: DocumentViewProps) {
  const messageMap = useMemo(() => new Map(messages.map(m => [m.id, m])), [messages])
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])

  // Ordre local, instancié à l'ouverture de la vue (le composant est remonté à chaque bascule)
  const [sectionIds, setSectionIds] = useState<string[]>(() =>
    nodes.filter(n => n.kind === 'group').sort(byOrder).map(g => g.id)
  )
  const [lists, setLists] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = { [FREE]: [] }
    for (const n of nodes) if (n.kind === 'group') out[n.id] = []
    const blocks = nodes.filter(n => n.kind !== 'group' && (n.messageId || n.kind === 'text')).sort(byOrder)
    for (const b of blocks) {
      const key = b.parentId && out[b.parentId] ? b.parentId : FREE
      out[key].push(b.id)
    }
    return out
  })

  const dragRef = useRef<{ type: 'block' | 'section'; id: string } | null>(null)
  const [dropHint, setDropHint] = useState<string | null>(null)

  // Persistance : on réécrit orderInParent des listes touchées ; si le bloc change
  // de section, parentId + une position en cascade dans le groupe (le canvas suit)
  const persistList = (key: string, ids: string[], moved?: string) => {
    ids.forEach((id, idx) => {
      const patch: Partial<Pick<CanvasNodeData, 'x' | 'y' | 'parentId' | 'orderInParent'>> = { orderInParent: idx }
      if (moved === id) {
        if (key === FREE) {
          const n = nodeById.get(id)
          const oldParent = n?.parentId ? nodeById.get(n.parentId) : undefined
          patch.parentId = null
          if (n && oldParent) { patch.x = oldParent.x + n.x; patch.y = oldParent.y + n.y }
        } else {
          patch.parentId = key
          patch.x = 24
          patch.y = 48 + idx * 44
        }
      }
      onUpdateNode(id, patch)
    })
  }

  const dropBlock = (targetKey: string, targetIdx: number) => {
    const drag = dragRef.current
    dragRef.current = null
    setDropHint(null)
    if (!drag || drag.type !== 'block') return
    const fromKey = Object.keys(lists).find(k => lists[k].includes(drag.id))
    if (!fromKey) return
    const fromArr = lists[fromKey].filter(id => id !== drag.id)
    const oldIdx = lists[fromKey].indexOf(drag.id)
    let insertIdx = targetIdx
    if (fromKey === targetKey && oldIdx < targetIdx) insertIdx--
    const toArr = fromKey === targetKey ? [...fromArr] : [...lists[targetKey]]
    toArr.splice(Math.max(0, Math.min(insertIdx, toArr.length)), 0, drag.id)
    if (fromKey === targetKey) {
      if (toArr.join() === lists[targetKey].join()) return
      setLists({ ...lists, [targetKey]: toArr })
      persistList(targetKey, toArr)
    } else {
      setLists({ ...lists, [fromKey]: fromArr, [targetKey]: toArr })
      persistList(fromKey, fromArr)
      persistList(targetKey, toArr, drag.id)
    }
  }

  const dropSection = (targetIdx: number) => {
    const drag = dragRef.current
    dragRef.current = null
    setDropHint(null)
    if (!drag || drag.type !== 'section') return
    const oldIdx = sectionIds.indexOf(drag.id)
    if (oldIdx === -1) return
    const arr = sectionIds.filter(id => id !== drag.id)
    let idx = targetIdx
    if (oldIdx < targetIdx) idx--
    arr.splice(Math.max(0, Math.min(idx, arr.length)), 0, drag.id)
    if (arr.join() === sectionIds.join()) return
    setSectionIds(arr)
    arr.forEach((id, i) => onUpdateNode(id, { orderInParent: i }))
  }

  const allowDrop = (hint: string) => (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropHint(hint)
  }

  const BlockRow = ({ id, listKey, index }: { id: string; listKey: string; index: number }) => {
    const node = nodeById.get(id)
    if (!node) return null
    const msg = node.messageId ? messageMap.get(node.messageId) : undefined
    const content = node.content ?? msg?.content ?? ''
    const { imgSrc, text } = parseBlockContent(content, msg?.type ?? 'text')
    const hintKey = `${listKey}:${index}`
    return (
      <div
        draggable
        onDragStart={(e) => { dragRef.current = { type: 'block', id }; e.dataTransfer.effectAllowed = 'move' }}
        onDragOver={allowDrop(hintKey)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropBlock(listKey, index) }}
        className="group/row relative flex gap-2.5 rounded-xl"
        style={{
          background: 'var(--node-bg)',
          border: '1px solid var(--node-border)',
          boxShadow: 'var(--node-shadow)',
          padding: '12px 14px 12px 8px',
          marginTop: 10,
          cursor: 'grab',
          outline: dropHint === hintKey ? '2px solid rgba(59,130,246,0.7)' : 'none',
          outlineOffset: 2,
        }}
      >
        <GripVertical size={14} className="flex-shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-60 transition-opacity" style={{ color: 'var(--node-meta)' }} />
        <div className="flex-1 min-w-0">
          {imgSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgSrc} alt="" className="rounded-lg object-contain" style={{ maxHeight: 340, maxWidth: '100%', marginBottom: text ? 8 : 0 }} draggable={false} />
          )}
          {text && (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--node-preview)' }}>{text}</p>
          )}
          {!imgSrc && !text && (
            <p className="text-xs italic" style={{ color: 'var(--node-meta)' }}>(bloc vide)</p>
          )}
        </div>
        {node.content != null && !!msg && (
          <span className="absolute bottom-1.5 right-2 text-[9px]" style={{ color: '#3b82f6', opacity: 0.75 }} title="Copie de travail — la note d'origine est intacte">✎</span>
        )}
      </div>
    )
  }

  const Section = ({ sid, index }: { sid: string; index: number }) => {
    const g = nodeById.get(sid)
    if (!g) return null
    const palette = GROUP_COLORS[g.color ?? 'blue'] ?? GROUP_COLORS.blue
    const ids = lists[sid] ?? []
    const headerHint = `section:${index}`
    return (
      <section style={{ marginTop: index === 0 ? 0 : 36 }}>
        <header
          draggable
          onDragStart={(e) => { dragRef.current = { type: 'section', id: sid }; e.dataTransfer.effectAllowed = 'move' }}
          onDragOver={allowDrop(headerHint)}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation()
            if (dragRef.current?.type === 'section') dropSection(index)
            else dropBlock(sid, 0)
          }}
          className="group/sec flex items-center gap-2.5"
          style={{
            cursor: 'grab',
            paddingBottom: 8,
            borderBottom: `1px solid ${palette.border}40`,
            outline: dropHint === headerHint ? '2px solid rgba(59,130,246,0.7)' : 'none',
            outlineOffset: 4,
            borderRadius: 4,
          }}
          title="Glisser pour réordonner les sections"
        >
          <GripVertical size={13} className="opacity-0 group-hover/sec:opacity-60 transition-opacity" style={{ color: 'var(--node-meta)' }} />
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: palette.border }} />
          <h2 className="text-sm font-semibold truncate" style={{ color: palette.text }}>{g.label || 'Groupe'}</h2>
          <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--node-meta)' }}>{ids.length} bloc{ids.length > 1 ? 's' : ''}</span>
        </header>
        {ids.map((bid, bi) => <BlockRow key={bid} id={bid} listKey={sid} index={bi} />)}
        {/* Zone de dépôt en fin de section (aussi utile quand la section est vide) */}
        <div
          onDragOver={allowDrop(`${sid}:${ids.length}`)}
          onDrop={(e) => { e.preventDefault(); dropBlock(sid, ids.length) }}
          style={{
            height: ids.length === 0 ? 44 : 18,
            borderRadius: 8,
            marginTop: 6,
            border: ids.length === 0 ? `1px dashed ${palette.border}50` : 'none',
            outline: dropHint === `${sid}:${ids.length}` ? '2px solid rgba(59,130,246,0.7)' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {ids.length === 0 && <span className="text-[10px]" style={{ color: 'var(--node-meta)' }}>Dépose un bloc ici</span>}
        </div>
      </section>
    )
  }

  const freeIds = lists[FREE] ?? []
  const isEmpty = sectionIds.length === 0 && freeIds.length === 0

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingLeft: insetLeft, paddingRight: 48 }}>
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '76px 0 160px' }}>
        {isEmpty ? (
          <div className="text-center" style={{ paddingTop: 120 }}>
            <div className="text-4xl mb-3 opacity-30">📄</div>
            <p className="text-sm" style={{ color: 'var(--node-meta)' }}>Le document reflète ton canvas</p>
            <p className="text-xs mt-1" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>Place des blocs et groupe-les : chaque groupe devient une section</p>
          </div>
        ) : (
          <>
            {sectionIds.map((sid, si) => <Section key={sid} sid={sid} index={si} />)}
            {freeIds.length > 0 && (
              <section style={{ marginTop: sectionIds.length === 0 ? 0 : 40 }}>
                <header className="flex items-center gap-2.5" style={{ paddingBottom: 8, borderBottom: '1px solid var(--float-border)' }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--node-meta)', opacity: 0.5 }} />
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--node-meta)' }}>À trier</h2>
                  <span className="text-[10px]" style={{ color: 'var(--node-meta)' }}>{freeIds.length} bloc{freeIds.length > 1 ? 's' : ''}</span>
                </header>
                {freeIds.map((bid, bi) => <BlockRow key={bid} id={bid} listKey={FREE} index={bi} />)}
                <div
                  onDragOver={allowDrop(`${FREE}:${freeIds.length}`)}
                  onDrop={(e) => { e.preventDefault(); dropBlock(FREE, freeIds.length) }}
                  style={{ height: 18, outline: dropHint === `${FREE}:${freeIds.length}` ? '2px solid rgba(59,130,246,0.7)' : 'none', borderRadius: 8, marginTop: 6 }}
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
