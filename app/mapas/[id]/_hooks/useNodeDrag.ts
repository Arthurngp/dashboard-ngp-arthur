import { useCallback, useEffect, useRef, useState } from 'react'
import { descendentesDe } from '../_lib/layout'
import type { NoDB, Point, Size } from '../_lib/types'

interface UseNodeDragArgs {
  nos: NoDB[]
  filhosPorPai: Map<string, NoDB[]>
  hiddenSet: Set<string>
  scale: number
  getSize: (id: string) => Size
  getPosicao: (n: NoDB) => Point
  clientToWorld: (x: number, y: number) => Point
  onCommitDrop: (filhoId: string, novoPaiId: string) => void
  onCommitMove: (filhoId: string, pos: Point) => void
  onCommitEdit: () => void
  onSelect: (id: string) => void
}

// Drag state machine pra nós:
// - mousedown registra origem; só vira "drag visual" depois de 4px (filtra clique fantasma)
// - mousemove atualiza dragPositions + checa drop target via containment (não proximidade)
// - mouseup ou solta no drop ou salva nova posição manual
export function useNodeDrag(args: UseNodeDragArgs) {
  const { nos, filhosPorPai, hiddenSet, scale, getSize, getPosicao, clientToWorld, onCommitDrop, onCommitMove, onCommitEdit, onSelect } = args

  const [draggingNoId, setDraggingNoId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dragPositions, setDragPositions] = useState<Map<string, Point>>(new Map())

  const nodeDragRef = useRef<{
    active: boolean; noId: string | null
    startClientX: number; startClientY: number
    offX: number; offY: number
  }>({ active: false, noId: null, startClientX: 0, startClientY: 0, offX: 0, offY: 0 })

  // Stable refs pros callbacks usados no listener global (evita re-criar listener a cada render)
  const refs = useRef({ nos, filhosPorPai, hiddenSet, scale, getSize, getPosicao, clientToWorld, onCommitDrop, onCommitMove })
  useEffect(() => {
    refs.current = { nos, filhosPorPai, hiddenSet, scale, getSize, getPosicao, clientToWorld, onCommitDrop, onCommitMove }
  })

  const onNodeMouseDown = useCallback((e: React.MouseEvent, no: NoDB) => {
    e.stopPropagation()
    if (no.parent_id === null) {
      onSelect(no.id)
      return
    }
    onCommitEdit()
    const pos = getPosicao(no)
    const world = clientToWorld(e.clientX, e.clientY)
    nodeDragRef.current = {
      active: true, noId: no.id,
      startClientX: e.clientX, startClientY: e.clientY,
      offX: world.x - pos.x, offY: world.y - pos.y,
    }
    onSelect(no.id)
  }, [getPosicao, clientToWorld, onSelect, onCommitEdit])

  // Listeners globais — mount uma vez. Lê tudo via refs.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!nodeDragRef.current.active || !nodeDragRef.current.noId) return
      const id = nodeDragRef.current.noId
      const dx = e.clientX - nodeDragRef.current.startClientX
      const dy = e.clientY - nodeDragRef.current.startClientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 4 && !draggingNoIdRef.current) return
      if (!draggingNoIdRef.current) {
        draggingNoIdRef.current = id
        setDraggingNoId(id)
      }

      const { clientToWorld, nos, hiddenSet, filhosPorPai, getSize, scale } = refs.current
      const world = clientToWorld(e.clientX, e.clientY)
      const novaPos = { x: world.x - nodeDragRef.current.offX, y: world.y - nodeDragRef.current.offY }
      setDragPositions(prev => {
        const n = new Map(prev)
        n.set(id, novaPos)
        return n
      })

      // Drop target: containment em world coords (sz é pixels → divide por scale).
      const proibidos = descendentesDe(id, filhosPorPai)
      let alvo: string | null = null
      for (const outro of nos) {
        if (proibidos.has(outro.id) || hiddenSet.has(outro.id) || outro.id === id) continue
        const p = refs.current.getPosicao(outro)
        const sz = getSize(outro.id)
        const halfW = (sz.w / 2) / scale
        const halfH = (sz.h / 2) / scale
        if (world.x >= p.x - halfW && world.x <= p.x + halfW &&
            world.y >= p.y - halfH && world.y <= p.y + halfH) {
          alvo = outro.id
          break
        }
      }
      dropTargetIdRef.current = alvo
      setDropTargetId(alvo)
    }

    function onUp() {
      if (!nodeDragRef.current.active) return
      const id = nodeDragRef.current.noId
      const wasDragging = draggingNoIdRef.current
      nodeDragRef.current.active = false
      nodeDragRef.current.noId = null
      if (!id || !wasDragging) return

      const alvo = dropTargetIdRef.current
      if (alvo) {
        setDragPositions(prev => { const n = new Map(prev); n.delete(id); return n })
        dropTargetIdRef.current = null
        setDropTargetId(null)
        refs.current.onCommitDrop(id, alvo)
      } else {
        const finalPos = dragPositionsRef.current.get(id)
        if (finalPos) refs.current.onCommitMove(id, finalPos)
        setDragPositions(prev => { const n = new Map(prev); n.delete(id); return n })
      }
      draggingNoIdRef.current = null
      setDraggingNoId(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Espelha state em refs pros listeners (que não dependem do state diretamente)
  const draggingNoIdRef = useRef<string | null>(null)
  const dropTargetIdRef = useRef<string | null>(null)
  const dragPositionsRef = useRef<Map<string, Point>>(new Map())
  useEffect(() => { draggingNoIdRef.current = draggingNoId }, [draggingNoId])
  useEffect(() => { dropTargetIdRef.current = dropTargetId }, [dropTargetId])
  useEffect(() => { dragPositionsRef.current = dragPositions }, [dragPositions])

  return { draggingNoId, dropTargetId, dragPositions, onNodeMouseDown }
}
