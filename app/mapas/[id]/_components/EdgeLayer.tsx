'use client'

import styles from '../editor.module.css'
import type { NoDB, Point, Size } from '../_lib/types'

interface Props {
  nosVisiveis: NoDB[]
  todosNos: NoDB[]
  hiddenSet: Set<string>
  branchColors: Map<string, string>
  getPosicao: (n: NoDB) => Point
  getSize: (id: string) => Size
  scale: number
  tx: number
  ty: number
}

// SVG só com edges. Nós são divs absolutos na camada de cima.
// Curva Bezier horizontal entre o lado direito do pai e o lado esquerdo do filho
// (ou ao contrário se o filho está à esquerda do pai depois de drag manual).
export function EdgeLayer({ nosVisiveis, todosNos, hiddenSet, branchColors, getPosicao, getSize, scale, tx, ty }: Props) {
  const edges = nosVisiveis
    .filter(n => n.parent_id && !hiddenSet.has(n.parent_id))
    .map(n => {
      const paiNo = todosNos.find(x => x.id === n.parent_id)!
      const from = getPosicao(paiNo)
      const to = getPosicao(n)
      const cor = branchColors.get(n.id) || '#94a3b8'
      const halfFrom = (getSize(paiNo.id).w / 2) / scale
      const halfTo = (getSize(n.id).w / 2) / scale
      const direita = to.x >= from.x
      const x1 = direita ? from.x + halfFrom : from.x - halfFrom
      const x2 = direita ? to.x - halfTo : to.x + halfTo
      const cx = (x1 + x2) / 2
      const d = `M ${x1} ${from.y} C ${cx} ${from.y}, ${cx} ${to.y}, ${x2} ${to.y}`
      return { id: n.id, d, cor }
    })

  return (
    <svg className={styles.svg}>
      <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
        {edges.map(e => (
          <path
            key={`e-${e.id}`}
            d={e.d}
            fill="none"
            stroke={e.cor}
            strokeWidth={2.5}
            opacity={0.65}
          />
        ))}
      </g>
    </svg>
  )
}
