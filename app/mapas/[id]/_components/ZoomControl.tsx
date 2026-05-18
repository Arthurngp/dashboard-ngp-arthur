'use client'

import styles from '../editor.module.css'

interface Props {
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
}

export function ZoomControl({ scale, onZoomIn, onZoomOut, onFit }: Props) {
  return (
    <div className={styles.zoomCtrl}>
      <button className={styles.zoomBtn} onClick={onZoomOut} title="Afastar">−</button>
      <div className={styles.zoomLabel}>{Math.round(scale * 100)}%</div>
      <button className={styles.zoomBtn} onClick={onZoomIn} title="Aproximar">+</button>
      <button className={styles.zoomBtn} onClick={onFit} title="Centralizar (F)">⊡</button>
    </div>
  )
}
