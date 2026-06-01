import { useCallback, useEffect, useRef, useState } from 'react'
import { computeLayout } from '../_lib/layout'
import type { NoDB, Point, Size } from '../_lib/types'

interface UseViewportArgs {
  canvasRef: React.RefObject<HTMLDivElement | null>
  nos: NoDB[]
  hiddenSet: Set<string>
  dragPositions: Map<string, Point>
  getSize: (id: string) => Size
}

// Centraliza viewport state (pan + zoom) + utilitários: clientToWorld, fitView, wheel.
// viewBusy é true brevemente após cada interação de pan/zoom (120ms) — usado pelo CSS
// pra desligar transições e fazer botões flutuantes seguirem instantaneamente.
export function useViewport({ canvasRef, nos, hiddenSet, dragPositions, getSize }: UseViewportArgs) {
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [scale, setScale] = useState(1)
  const [panning, setPanning] = useState(false)
  const [viewBusy, setViewBusy] = useState(false)

  const viewBusyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markViewBusy = useCallback(() => {
    setViewBusy(true)
    if (viewBusyTimer.current) clearTimeout(viewBusyTimer.current)
    viewBusyTimer.current = setTimeout(() => setViewBusy(false), 120)
  }, [])

  const panStateRef = useRef<{ active: boolean; startX: number; startY: number; startTx: number; startTy: number }>({
    active: false, startX: 0, startY: 0, startTx: 0, startTy: 0,
  })

  const clientToWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (clientX - rect.left - tx) / scale,
      y: (clientY - rect.top - ty) / scale,
    }
  }, [canvasRef, tx, ty, scale])

  const fitView = useCallback((listaOverride?: NoDB[]) => {
    const list = listaOverride || nos
    if (list.length === 0) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const tmp = computeLayout(list, getSize)
    let minCx = Infinity, maxCx = -Infinity, minCy = Infinity, maxCy = -Infinity
    let maxHalfW = 0, maxHalfH = 0
    for (const n of list) {
      if (hiddenSet.has(n.id)) continue
      const drag = dragPositions.get(n.id)
      const p = drag || (n.posicao_x !== null && n.posicao_y !== null
        ? { x: n.posicao_x, y: n.posicao_y }
        : tmp.get(n.id))
      if (!p) continue
      minCx = Math.min(minCx, p.x); maxCx = Math.max(maxCx, p.x)
      minCy = Math.min(minCy, p.y); maxCy = Math.max(maxCy, p.y)
      const s = getSize(n.id)
      maxHalfW = Math.max(maxHalfW, s.w / 2)
      maxHalfH = Math.max(maxHalfH, s.h / 2)
    }
    if (!isFinite(minCx)) return
    const wWorld = maxCx - minCx
    const hWorld = maxCy - minCy
    const pad = 60
    const availW = Math.max(1, rect.width - 2 * maxHalfW - 2 * pad)
    const availH = Math.max(1, rect.height - 2 * maxHalfH - 2 * pad)
    const sX = wWorld > 0 ? availW / wWorld : 1
    const sY = hWorld > 0 ? availH / hWorld : 1
    const novo = Math.min(1.2, Math.max(0.1, Math.min(sX, sY)))
    const cx = (minCx + maxCx) / 2
    const cy = (minCy + maxCy) / 2
    setScale(novo)
    setTx(rect.width / 2 - cx * novo)
    setTy(rect.height / 2 - cy * novo)
  }, [nos, canvasRef, getSize, hiddenSet, dragPositions])

  // Pan via mousedown no fundo do canvas
  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-node-id]') || target.closest('button')) return false
    panStateRef.current = {
      active: true, startX: e.clientX, startY: e.clientY, startTx: tx, startTy: ty,
    }
    setPanning(true)
    return true
  }, [tx, ty])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!panStateRef.current.active) return
      const dx = e.clientX - panStateRef.current.startX
      const dy = e.clientY - panStateRef.current.startY
      setTx(panStateRef.current.startTx + dx)
      setTy(panStateRef.current.startTy + dy)
    }
    function onUp() {
      if (panStateRef.current.active) {
        panStateRef.current.active = false
        setPanning(false)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Wheel registrado manualmente — React >= 17 marca onWheel como passive,
  // e preventDefault() em listener passive é ignorado (causa scroll da página).
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    function handler(e: WheelEvent) {
      e.preventDefault()
      markViewBusy()
      if (e.ctrlKey || e.metaKey) {
        const rect = el!.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top
        const delta = -e.deltaY * 0.01
        const novo = Math.max(0.1, Math.min(4, scale * (1 + delta)))
        const wx = (mouseX - tx) / scale
        const wy = (mouseY - ty) / scale
        setScale(novo)
        setTx(mouseX - wx * novo)
        setTy(mouseY - wy * novo)
      } else {
        setTx(t => t - e.deltaX)
        setTy(t => t - e.deltaY)
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [canvasRef, scale, tx, ty, markViewBusy])

  const zoomBy = useCallback((factor: number) => {
    setScale(s => Math.max(0.1, Math.min(4, s * factor)))
  }, [])

  return {
    tx, ty, scale, panning, viewBusy,
    setTx, setTy, setScale,
    markViewBusy,
    clientToWorld,
    fitView,
    onCanvasMouseDown,
    zoomBy,
  }
}
