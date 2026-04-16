'use client'
import React, { useState } from 'react'
import { crmCall, ACTIVITY_TYPE_LABELS } from '@/lib/crm-api'
import styles from './pipeline.module.css'

interface Props {
  leadId: string
  onCreated: () => void
}

const MANUAL_TYPES = ['ligacao', 'email', 'reuniao', 'whatsapp', 'visita', 'nota_interna'] as const

export default function RegisterActivityForm({ leadId, onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    activity_type: 'ligacao' as string,
    title: '',
    description: '',
    duration_minutes: '',
  })

  const create = async () => {
    if (!form.title.trim() || saving) return
    setSaving(true)
    const res = await crmCall('crm-manage-activities', {
      action: 'create',
      lead_id: leadId,
      activity_type: form.activity_type,
      title: form.title.trim(),
      description: form.description.trim() || null,
      duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
    })
    setSaving(false)
    if (!res.error) {
      setForm({ activity_type: 'ligacao', title: '', description: '', duration_minutes: '' })
      setOpen(false)
      onCreated()
    }
  }

  if (!open) {
    return (
      <button className={styles.regActivityBtn} onClick={() => setOpen(true)}>
        📝 Registrar Atividade
      </button>
    )
  }

  const showDuration = ['ligacao', 'reuniao', 'visita'].includes(form.activity_type)

  return (
    <div className={styles.regActivityForm}>
      <div className={styles.regActivityHeader}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Registrar Atividade</span>
        <button className={styles.taskDeleteBtn} onClick={() => setOpen(false)}>×</button>
      </div>

      {/* Type selector buttons */}
      <div className={styles.regActivityTypes}>
        {MANUAL_TYPES.map(type => {
          const meta = ACTIVITY_TYPE_LABELS[type]
          const isActive = form.activity_type === type
          return (
            <button
              key={type}
              className={`${styles.regActivityTypeBtn} ${isActive ? styles.regActivityTypeBtnActive : ''}`}
              style={isActive ? { borderColor: meta.color, background: `${meta.color}10`, color: meta.color } : {}}
              onClick={() => setForm(f => ({ ...f, activity_type: type }))}
            >
              {meta.icon} {meta.label}
            </button>
          )
        })}
      </div>

      <input
        className={styles.taskFormInput}
        placeholder="Resumo da atividade..."
        value={form.title}
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        autoFocus
        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && create()}
      />

      <div className={styles.taskFormRow}>
        <textarea
          className={styles.taskFormTextarea}
          placeholder="Detalhes (opcional)"
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          rows={2}
          style={{ flex: 1 }}
        />
        {showDuration && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 90 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Duração</label>
            <input
              type="number"
              className={styles.taskFormInput}
              placeholder="min"
              value={form.duration_minutes}
              onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))}
              min={1}
              style={{ width: 90 }}
            />
          </div>
        )}
      </div>

      <div className={styles.taskFormActions}>
        <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => setOpen(false)}>Cancelar</button>
        <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`} onClick={create} disabled={saving || !form.title.trim()}>
          {saving ? 'Salvando...' : 'Registrar'}
        </button>
      </div>
    </div>
  )
}
