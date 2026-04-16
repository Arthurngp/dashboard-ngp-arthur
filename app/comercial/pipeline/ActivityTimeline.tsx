'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { crmCall, CrmActivity, ACTIVITY_TYPE_LABELS } from '@/lib/crm-api'
import styles from './pipeline.module.css'

interface Props {
  leadId: string
}

export default function ActivityTimeline({ leadId }: Props) {
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await crmCall('crm-manage-activities', { action: 'list', lead_id: leadId, limit: 50 })
    if (!res.error) setActivities(res.activities || [])
    setLoading(false)
  }, [leadId])

  useEffect(() => { load() }, [load])

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Agora'
    if (mins < 60) return `${mins}min atrás`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h atrás`
    const days = Math.floor(hrs / 24)
    if (days < 7) return `${days}d atrás`
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  }

  if (loading) {
    return (
      <div className={styles.timelineEmpty}>
        <div className={styles.timelineSpinner} />
        Carregando timeline...
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className={styles.timelineEmpty}>
        <span style={{ fontSize: 32 }}>📋</span>
        <p>Nenhuma atividade registrada.</p>
        <p style={{ fontSize: 12, color: '#94a3b8' }}>Use o botão abaixo para registrar a primeira interação.</p>
      </div>
    )
  }

  return (
    <div className={styles.timeline}>
      {activities.map((act, idx) => {
        const meta = ACTIVITY_TYPE_LABELS[act.activity_type] || { label: act.activity_type, icon: '📌', color: '#64748b' }
        const isSystem = ['mudanca_etapa', 'mudanca_responsavel', 'edicao_campo', 'criacao_lead'].includes(act.activity_type)

        return (
          <div key={act.id} className={`${styles.timelineItem} ${isSystem ? styles.timelineItemSystem : ''}`}>
            {/* Linha vertical conectora */}
            {idx < activities.length - 1 && <div className={styles.timelineLine} />}

            {/* Ícone */}
            <div className={styles.timelineIcon} style={{ background: isSystem ? '#f1f5f9' : `${meta.color}15`, borderColor: meta.color }}>
              <span style={{ fontSize: 14 }}>{meta.icon}</span>
            </div>

            {/* Conteúdo */}
            <div className={styles.timelineContent}>
              <div className={styles.timelineHeader}>
                <span className={styles.timelineType} style={{ color: meta.color }}>{meta.label}</span>
                <span className={styles.timelineTime}>{fmtDate(act.created_at)}</span>
              </div>
              <p className={styles.timelineTitle}>{act.title}</p>
              {act.description && <p className={styles.timelineDesc}>{act.description}</p>}
              <div className={styles.timelineMeta}>
                {act.created_by_name && <span>por {act.created_by_name}</span>}
                {act.duration_minutes && <span>· {act.duration_minutes}min</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
