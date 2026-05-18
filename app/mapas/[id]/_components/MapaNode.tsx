'use client'

import styles from '../editor.module.css'
import type { NoDB, Point } from '../_lib/types'

interface Props {
  no: NoDB
  pos: Point
  scale: number
  tx: number
  ty: number
  isRoot: boolean
  isSelected: boolean
  isDropTarget: boolean
  isDragging: boolean
  isEditing: boolean
  isNowrap: boolean
  cor: string
  hasChildren: boolean
  editingText: string
  bindRef: (el: HTMLElement | null) => void
  onMouseDown: (e: React.MouseEvent) => void
  onClick: () => void
  onDoubleClick: () => void
  onEditChange: (v: string) => void
  onEditBlur: () => void
  onEditEnter: () => void
  onEditEscape: () => void
}

export function MapaNode(props: Props) {
  const {
    no, pos, scale, tx, ty,
    isRoot, isSelected, isDropTarget, isDragging, isEditing, isNowrap,
    cor, hasChildren, editingText, bindRef,
    onMouseDown, onClick, onDoubleClick,
    onEditChange, onEditBlur, onEditEnter, onEditEscape,
  } = props

  const screenX = pos.x * scale + tx
  const screenY = pos.y * scale + ty

  return (
    <div
      ref={bindRef}
      data-node-id={no.id}
      className={[
        styles.node,
        isRoot ? styles.root : '',
        isSelected ? styles.selected : '',
        isDropTarget ? styles.dropTarget : '',
        isDragging ? styles.dragging : '',
        isNowrap ? styles.nowrap : '',
      ].filter(Boolean).join(' ')}
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, -50%)',
        ...(isRoot ? {} : { borderBottomColor: cor }),
      }}
      onMouseDown={onMouseDown}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick() }}
    >
      {isEditing ? (
        <input
          autoFocus
          className={styles.nodeInput}
          value={editingText}
          onChange={e => onEditChange(e.target.value)}
          onBlur={onEditBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onEditEnter() }
            if (e.key === 'Escape') onEditEscape()
          }}
          onMouseDown={e => e.stopPropagation()}
        />
      ) : (
        <span>
          {no.texto || <span className={styles.nodeEmpty}>vazio</span>}
          {no.collapsed && hasChildren && <span className={styles.collapseBadge}>+</span>}
        </span>
      )}
    </div>
  )
}
