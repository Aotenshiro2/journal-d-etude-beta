'use client'

import { useMemo, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { MessageData, CanvasNodeData } from '@/types'
import { parseBlockContent } from '@/lib/utils'
import { GROUP_COLORS, TradeBadge, TradeMeta } from './StudyCanvas'
import ImageLightbox from './ImageLightbox'
import { useIsMobile } from '@/hooks/useIsMobile'

// La vue document — l'AUTRE projection du même modèle : les groupes du canvas
// deviennent des sections, les blocs une liste réordonnable. Rien de nouveau
// n'est stocké : l'ordre manuel vit dans CanvasNode.orderInParent.
//
// Mode `readOnly` + `embedded` : la MÊME projection, sans drag ni persistance,
// posée dans un flux normal. Réutilisée telle quelle par la relecture — on relit
// sa réorganisation (structure, blocs modifiés, images cliquables en grand).

interface DocumentViewProps {
  nodes: CanvasNodeData[]
  messages: MessageData[]
  insetLeft?: number
  readOnly?: boolean
  embedded?: boolean
  tradeMeta?: Record<string, TradeMeta>
  onUpdateNode?: (nodeId: string, patch: Partial<Pick<CanvasNodeData, 'x' | 'y' | 'parentId' | 'orderInParent'>>) => Promise<void> | void
}

const FREE = '__free__'

// Ordre de projection : ordre manuel s'il existe, sinon la position spatiale (haut → bas)
const byOrder = (a: CanvasNodeData, b: CanvasNodeData) =>
  ((a.orderInParent ?? 1e9) - (b.orderInParent ?? 1e9)) || (a.y - b.y) || (a.x - b.x)

export default function DocumentView({ nodes, messages, insetLeft = 0, readOnly = false, embedded = false, tradeMeta, onUpdateNode }: DocumentViewProps) {
  const isMobile = useIsMobile()
  const interactive = !readOnly
  const update = onUpdateNode ?? (() => {})
  const messageMap = useMemo(() => new Map(messages.map(m => [m.id, m])), [messages])
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const [zoom, setZoom] = useState<string | null>(null)

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

  // ── Réordonner au doigt : le même tap → tap que sur les canvas ──────────────
  // Le glisser-déposer d'ici est du HTML5, qui ne se déclenche jamais en
  // tactile. On touche la poignée d'un bloc (il s'arme), les emplacements
  // possibles apparaissent, on touche celui qu'on veut. Les fonctions de dépôt
  // sont réutilisées telles quelles : on ne fait que remplir `dragRef` nous-mêmes.
  const [armed, setArmed] = useState<{ type: 'block' | 'section'; id: string } | null>(null)

  const toggleArm = (type: 'block' | 'section', id: string) =>
    setArmed(a => (a?.id === id && a.type === type ? null : { type, id }))

  const placeArmed = (run: () => void) => {
    if (!armed) return
    dragRef.current = armed
    setArmed(null)
    run()
  }

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
      update(id, patch)
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
    arr.forEach((id, i) => update(id, { orderInParent: i }))
  }

  const allowDrop = (hint: string) => (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropHint(hint)
  }

  /** Emplacement d'insertion tactile — n'existe que pendant qu'un bloc est armé. */
  const TapSlot = ({ listKey, index }: { listKey: string; index: number }) => {
    if (!interactive || armed?.type !== 'block') return null
    return (
      <button
        onClick={() => placeArmed(() => dropBlock(listKey, index))}
        aria-label="Poser le bloc ici"
        style={{
          display: 'block', width: '100%', height: 34, marginTop: 6,
          border: '1px dashed rgba(59,130,246,0.55)', borderRadius: 8,
          background: 'rgba(59,130,246,0.07)', color: '#3b82f6',
          fontSize: 11, cursor: 'pointer',
        }}
      >
        Poser ici
      </button>
    )
  }

  /** Idem, entre deux sections, quand c'est une section qui est armée. */
  const SectionSlot = ({ index }: { index: number }) => {
    if (!interactive || armed?.type !== 'section') return null
    return (
      <button
        onClick={() => placeArmed(() => dropSection(index))}
        aria-label="Déplacer la section ici"
        style={{
          display: 'block', width: '100%', height: 34, marginTop: 12,
          border: '1px dashed rgba(59,130,246,0.55)', borderRadius: 8,
          background: 'rgba(59,130,246,0.07)', color: '#3b82f6',
          fontSize: 11, cursor: 'pointer',
        }}
      >
        Déplacer la section ici
      </button>
    )
  }

  const BlockRow = ({ id, listKey, index }: { id: string; listKey: string; index: number }) => {
    const node = nodeById.get(id)
    if (!node) return null
    const msg = node.messageId ? messageMap.get(node.messageId) : undefined
    const content = node.content ?? msg?.content ?? ''
    const { imgSrc, text } = parseBlockContent(content, msg?.type ?? 'text')
    const trade = msg?.tradeRef ? tradeMeta?.[msg.tradeRef] : undefined
    const hintKey = `${listKey}:${index}`
    return (
      <div
        draggable={interactive}
        onDragStart={interactive ? (e) => { dragRef.current = { type: 'block', id }; e.dataTransfer.effectAllowed = 'move' } : undefined}
        onDragOver={interactive ? allowDrop(hintKey) : undefined}
        onDrop={interactive ? (e) => { e.preventDefault(); e.stopPropagation(); dropBlock(listKey, index) } : undefined}
        className="group/row relative flex gap-2.5 rounded-xl"
        style={{
          background: 'var(--node-bg)',
          border: '1px solid var(--node-border)',
          boxShadow: 'var(--node-shadow)',
          padding: interactive ? '12px 14px 12px 8px' : '13px 16px',
          marginTop: 10,
          cursor: interactive ? 'grab' : 'default',
          outline: dropHint === hintKey || armed?.id === id ? '2px solid rgba(59,130,246,0.7)' : 'none',
          outlineOffset: 2,
        }}
      >
        {interactive && (
          // La poignée était en `opacity-0` révélée au survol : au doigt, elle
          // n'apparaissait jamais. Sur mobile elle est visible et c'est ELLE
          // qu'on touche pour armer le bloc.
          <button
            onClick={(e) => { e.stopPropagation(); toggleArm('block', id) }}
            aria-label={armed?.id === id ? 'Annuler le déplacement' : 'Déplacer ce bloc'}
            title={isMobile ? 'Toucher, puis choisir le nouvel emplacement' : 'Glisser pour réordonner'}
            className={`flex-shrink-0 mt-0.5 transition-opacity ${isMobile ? 'opacity-70' : 'opacity-0 group-hover/row:opacity-60'}`}
            style={{ background: 'none', border: 'none', padding: isMobile ? '4px 2px' : 0, cursor: 'pointer', color: armed?.id === id ? '#3b82f6' : 'var(--node-meta)' }}
          >
            <GripVertical size={isMobile ? 18 : 14} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          {trade && <div className="mb-2"><TradeBadge meta={trade} /></div>}
          {imgSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt=""
              className="rounded-lg object-contain"
              style={{ maxHeight: 340, maxWidth: '100%', marginBottom: text ? 8 : 0, cursor: 'zoom-in' }}
              draggable={false}
              title="Cliquer pour agrandir"
              onClick={(e) => { e.stopPropagation(); setZoom(imgSrc) }}
            />
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
          draggable={interactive}
          onDragStart={interactive ? (e) => { dragRef.current = { type: 'section', id: sid }; e.dataTransfer.effectAllowed = 'move' } : undefined}
          onDragOver={interactive ? allowDrop(headerHint) : undefined}
          onDrop={interactive ? (e) => {
            e.preventDefault(); e.stopPropagation()
            if (dragRef.current?.type === 'section') dropSection(index)
            else dropBlock(sid, 0)
          } : undefined}
          className="group/sec flex items-center gap-2.5"
          style={{
            cursor: interactive ? 'grab' : 'default',
            paddingBottom: 8,
            borderBottom: `1px solid ${palette.border}40`,
            outline: dropHint === headerHint ? '2px solid rgba(59,130,246,0.7)' : 'none',
            outlineOffset: 4,
            borderRadius: 4,
          }}
          title={interactive ? 'Glisser pour réordonner les sections' : undefined}
        >
          {interactive && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleArm('section', sid) }}
              aria-label={armed?.id === sid ? 'Annuler le déplacement' : 'Déplacer cette section'}
              className={`transition-opacity ${isMobile ? 'opacity-70' : 'opacity-0 group-hover/sec:opacity-60'}`}
              style={{ background: 'none', border: 'none', padding: isMobile ? '4px 2px' : 0, cursor: 'pointer', color: armed?.id === sid ? '#3b82f6' : 'var(--node-meta)' }}
            >
              <GripVertical size={isMobile ? 18 : 13} />
            </button>
          )}
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: palette.border }} />
          <h2 className="text-sm font-semibold truncate" style={{ color: palette.text }}>{g.label || 'Groupe'}</h2>
          <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--node-meta)' }}>{ids.length} bloc{ids.length > 1 ? 's' : ''}</span>
        </header>
        <SectionSlot index={index} />
        {ids.map((bid, bi) => (
          <div key={bid}>
            <TapSlot listKey={sid} index={bi} />
            <BlockRow id={bid} listKey={sid} index={bi} />
          </div>
        ))}
        <TapSlot listKey={sid} index={ids.length} />
        {interactive ? (
          /* Zone de dépôt en fin de section (aussi utile quand la section est vide) */
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
        ) : (
          ids.length === 0 && <p className="text-[10px] mt-1.5" style={{ color: 'var(--node-meta)', opacity: 0.6 }}>(section vide)</p>
        )}
      </section>
    )
  }

  const freeIds = lists[FREE] ?? []
  const isEmpty = sectionIds.length === 0 && freeIds.length === 0

  // Au téléphone, la marge droite de 48 px (pensée pour laisser respirer à côté
  // des panneaux du bureau) mangeait un huitième de l'écran, et le décalage
  // haut de 76 px poussait le texte sous la ligne de flottaison.
  const outerStyle: React.CSSProperties = embedded
    ? { position: 'relative', width: '100%' }
    : { position: 'absolute', inset: 0, overflowY: 'auto', paddingLeft: insetLeft, paddingRight: isMobile ? 14 : 48 }
  const innerStyle: React.CSSProperties = embedded
    ? { width: '100%' }
    : { maxWidth: 700, margin: '0 auto', padding: isMobile ? '20px 0 140px' : '76px 0 160px' }

  return (
    <div style={outerStyle}>
      <div style={innerStyle}>
        {isEmpty ? (
          <div className="text-center" style={{ paddingTop: embedded ? 24 : 120 }}>
            <div className="text-4xl mb-3 opacity-30">📄</div>
            <p className="text-sm" style={{ color: 'var(--node-meta)' }}>{embedded ? 'Cette note n\'a pas encore été réorganisée' : 'Le document reflète ton canvas'}</p>
            {!embedded && <p className="text-xs mt-1" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>Place des blocs et groupe-les : chaque groupe devient une section</p>}
          </div>
        ) : (
          <>
            {sectionIds.map((sid, si) => <Section key={sid} sid={sid} index={si} />)}
            <SectionSlot index={sectionIds.length} />
            {freeIds.length > 0 && (
              <section style={{ marginTop: sectionIds.length === 0 ? 0 : 40 }}>
                <header className="flex items-center gap-2.5" style={{ paddingBottom: 8, borderBottom: '1px solid var(--float-border)' }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--node-meta)', opacity: 0.5 }} />
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--node-meta)' }}>À trier</h2>
                  <span className="text-[10px]" style={{ color: 'var(--node-meta)' }}>{freeIds.length} bloc{freeIds.length > 1 ? 's' : ''}</span>
                </header>
                {freeIds.map((bid, bi) => (
                  <div key={bid}>
                    <TapSlot listKey={FREE} index={bi} />
                    <BlockRow id={bid} listKey={FREE} index={bi} />
                  </div>
                ))}
                <TapSlot listKey={FREE} index={freeIds.length} />
                {interactive && (
                  <div
                    onDragOver={allowDrop(`${FREE}:${freeIds.length}`)}
                    onDrop={(e) => { e.preventDefault(); dropBlock(FREE, freeIds.length) }}
                    style={{ height: 18, outline: dropHint === `${FREE}:${freeIds.length}` ? '2px solid rgba(59,130,246,0.7)' : 'none', borderRadius: 8, marginTop: 6 }}
                  />
                )}
              </section>
            )}
          </>
        )}
      </div>
      {/* L'état du geste, comme sur les canvas : sans lui, on touche une
          poignée et rien ne dit ce qu'on attend de nous. */}
      {armed && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 60 }}>
          <div className="canvas-float-pill" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 12, color: 'var(--node-title)' }}>
            Choisis le nouvel emplacement
            <button onClick={() => setArmed(null)} style={{ background: 'none', border: 'none', color: 'var(--node-meta)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      <ImageLightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  )
}
