'use client'

import { useEffect, useRef, useState } from 'react'
import {
  COPILOT_MODELS,
  DEFAULT_COPILOT_MODEL,
  getPreferredModel,
  setPreferredModel,
} from '@/lib/copilot/models'
import styles from './copilot.module.css'

export default function ModelPicker() {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState(DEFAULT_COPILOT_MODEL)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setModel(getPreferredModel())
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (typeof detail === 'string') setModel(detail)
    }
    window.addEventListener('ngp-copilot-model-changed', onChange)
    return () => window.removeEventListener('ngp-copilot-model-changed', onChange)
  }, [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const current = COPILOT_MODELS.find((m) => m.id === model) || COPILOT_MODELS[0]

  function pick(id: string) {
    setPreferredModel(id)
    setModel(id)
    setOpen(false)
  }

  return (
    <div className={styles.modelPickerWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.modelPickerBtn}
        onClick={() => setOpen((o) => !o)}
        title="Modelo de IA usado pelas conversas e propostas do Copilot"
      >
        <span className={styles.modelPickerLabel}>Modelo IA</span>
        <span className={styles.modelPickerValue}>
          {current.label}
          {current.isReasoning && <span className={styles.modelBadgeReason}>reasoning</span>}
        </span>
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`${styles.modelPickerCaret} ${open ? styles.modelPickerCaretOpen : ''}`}>
          <polyline points="3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>

      {open && (
        <div className={styles.modelPickerPop}>
          <div className={styles.modelPickerPopHead}>Escolha o modelo</div>
          {COPILOT_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pick(m.id)}
              className={`${styles.modelPickerItem} ${m.id === model ? styles.modelPickerItemActive : ''}`}
            >
              <div className={styles.modelPickerItemRow}>
                <span className={styles.modelPickerItemName}>{m.label}</span>
                <div className={styles.modelPickerTiers}>
                  <span className={styles.modelTier} title="Custo">{'$'.repeat(m.costTier)}</span>
                  <span className={styles.modelTier} title="Velocidade">{'⚡'.repeat(m.speedTier)}</span>
                </div>
              </div>
              <div className={styles.modelPickerItemHint}>{m.hint}</div>
            </button>
          ))}
          <div className={styles.modelPickerFoot}>Preferência salva neste navegador.</div>
        </div>
      )}
    </div>
  )
}
