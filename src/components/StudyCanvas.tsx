'use client'

import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  NodeProps,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { MessageData, CanvasNodeData, CanvasEdgeData } from '@/types'
import { stripHtml, truncateText } from '@/lib/utils'

interface StudyCanvasProps {
  canvasId: string
  nodes: CanvasNodeData[]
  edges: CanvasEdgeData[]
  messages: MessageData[]
  onDropMessage: (messageId: string, x: number, y: number) => void
  onMoveNode: (nodeId: string, x: number, y: number) => void
  onRemoveNode: (nodeId: string) => void
  onConnect: (fromId: string, toId: string) => void
  onDeleteEdge: (edgeId: string) => void
}

function MessageNode({ data }: NodeProps) {
  const d = data as { content: string; type: string; onRemove: () => void }
  const text = truncateText(stripHtml(d.content), 150)

  return (
    <div className="relative bg-gray-800 border border-white/20 rounded-xl p-3 w-full h-full text-xs text-gray-200 group shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-yellow-400" />
      <Handle type="source" position={Position.Bottom} className="!bg-yellow-400" />
      {d.type === 'image' ? (
        (() => {
          const src = d.content.match(/src=["']([^"']+)["']/)?.[1]
          return src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="w-full h-full object-cover rounded-lg" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
              Image non disponible
            </div>
          )
        })()
      ) : (
        <p className="leading-relaxed overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
          {text}
        </p>
      )}
      <button
        onClick={d.onRemove}
        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-red-500/0 hover:bg-red-500/80 text-white/0 hover:text-white transition-all flex items-center justify-center text-xs opacity-0 group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  )
}

const nodeTypes = { message: MessageNode }

export default function StudyCanvas({
  nodes: initialNodes,
  edges: initialEdges,
  messages,
  onDropMessage,
  onMoveNode,
  onRemoveNode,
  onConnect: onConnectCallback,
  onDeleteEdge,
}: StudyCanvasProps) {
  const messageMap = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages]
  )

  const rfNodes: Node[] = useMemo(
    () =>
      initialNodes
        .filter((n) => n.messageId)
        .map((n) => {
          const msg = messageMap.get(n.messageId!)
          return {
            id: n.id,
            type: 'message',
            position: { x: n.x, y: n.y },
            style: { width: n.width, height: n.height },
            data: {
              content: msg?.content ?? '',
              type: msg?.type ?? 'text',
              onRemove: () => onRemoveNode(n.id),
            },
          }
        }),
    [initialNodes, messageMap, onRemoveNode]
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      initialEdges.map((e) => ({
        id: e.id,
        source: e.fromId,
        target: e.toId,
        label: e.label ?? undefined,
        type: 'smoothstep',
        style: { stroke: '#facc15', strokeWidth: 1.5 },
        labelStyle: { fill: '#d1d5db', fontSize: 10 },
      })),
    [initialEdges]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges)

  // Sync React Flow internal state when nodes/edges are added/removed externally
  useEffect(() => {
    setNodes((prev) => {
      const existingIds = new Set(prev.map((n) => n.id))
      const newNodes = rfNodes.filter((n) => !existingIds.has(n.id))
      if (newNodes.length === 0) return prev
      return [...prev, ...newNodes]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfNodes])

  useEffect(() => {
    setEdges(rfEdges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfEdges])

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, type: 'smoothstep', style: { stroke: '#facc15', strokeWidth: 1.5 } }, eds))
      if (params.source && params.target) {
        onConnectCallback(params.source, params.target)
      }
    },
    [setEdges, onConnectCallback]
  )

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onMoveNode(node.id, node.position.x, node.position.y)
    },
    [onMoveNode]
  )

  const onEdgeDoubleClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      onDeleteEdge(edge.id)
      setEdges((eds) => eds.filter((e) => e.id !== edge.id))
    },
    [onDeleteEdge, setEdges]
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const messageId = event.dataTransfer.getData('messageId')
      if (!messageId) return

      const reactFlowBounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const x = event.clientX - reactFlowBounds.left - 140
      const y = event.clientY - reactFlowBounds.top - 60

      onDropMessage(messageId, x, y)
    },
    [onDropMessage]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onEdgeDoubleClick={onEdgeDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        className="bg-gray-900"
      >
        <Background color="#374151" gap={24} />
        <Controls className="[&>button]:bg-gray-800 [&>button]:border-white/20 [&>button]:text-white" />
        <MiniMap className="!bg-gray-900 [&_.react-flow__minimap-mask]:fill-gray-800" nodeColor="#374151" />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-4xl mb-3 opacity-30">🎯</div>
            <p className="text-sm text-gray-600">Glisse des blocs depuis le panneau bas</p>
          </div>
        </div>
      )}
    </div>
  )
}
