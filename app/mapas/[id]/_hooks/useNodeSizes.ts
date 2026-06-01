import { useCallback, useEffect, useRef, useState } from 'react'
import { NODE_H_DEFAULT, NODE_W_DEFAULT } from '../_lib/layout'
import type { Size } from '../_lib/types'

// Mede largura/altura real de cada nó via ResizeObserver.
// `bindRef(id)` retorna uma ref callback pra anexar no DOM do nó.
// `getSize(id)` retorna o tamanho medido ou um fallback.
export function useNodeSizes() {
  const [sizes, setSizes] = useState<Map<string, Size>>(new Map())
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map())
  const ro = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    ro.current = new ResizeObserver(entries => {
      setSizes(prev => {
        const next = new Map(prev)
        let changed = false
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.nodeId
          if (!id) continue
          const r = entry.target.getBoundingClientRect()
          const ant = next.get(id)
          if (!ant || Math.abs(ant.w - r.width) > 0.5 || Math.abs(ant.h - r.height) > 0.5) {
            next.set(id, { w: r.width, h: r.height })
            changed = true
          }
        }
        return changed ? next : prev
      })
    })
    return () => { ro.current?.disconnect(); ro.current = null }
  }, [])

  const bindRef = useCallback((id: string) => (el: HTMLElement | null) => {
    const prev = nodeRefs.current.get(id)
    if (prev && prev !== el && ro.current) ro.current.unobserve(prev)
    if (el) {
      nodeRefs.current.set(id, el)
      ro.current?.observe(el)
    } else {
      nodeRefs.current.delete(id)
    }
  }, [])

  const getSize = useCallback((id: string): Size =>
    sizes.get(id) || { w: NODE_W_DEFAULT, h: NODE_H_DEFAULT },
    [sizes]
  )

  return { sizes, bindRef, getSize }
}
