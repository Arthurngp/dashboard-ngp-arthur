import { useCallback, useRef, useState } from 'react'

export function useColResize(initialWidths: number[]) {
  const [widths, setWidths] = useState<number[]>(initialWidths)
  const dragging = useRef<{ colIdx: number; startX: number; startW: number } | null>(null)

  const onMouseDown = useCallback((colIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = { colIdx, startX: e.clientX, startW: widths[colIdx] }

    function onMove(ev: MouseEvent) {
      if (!dragging.current) return
      const delta = ev.clientX - dragging.current.startX
      const newW = Math.max(60, dragging.current.startW + delta)
      setWidths(prev => { const next = [...prev]; next[dragging.current!.colIdx] = newW; return next })
    }
    function onUp() {
      dragging.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [widths])

  return { widths, onMouseDown }
}
