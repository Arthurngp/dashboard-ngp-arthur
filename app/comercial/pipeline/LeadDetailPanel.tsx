'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { crmCall, CrmLead, CrmStage, CrmPipelineField, CrmTask } from '@/lib/crm-api'
import ActivityTimeline from './ActivityTimeline'
import TaskList from './TaskList'
import RegisterActivityForm from './RegisterActivityForm'
import styles from './pipeline.module.css'

type Tab = 'dados' | 'timeline' | 'tarefas'

interface Props {
  lead: CrmLead
  stages: CrmStage[]
  pipelineFields: CrmPipelineField[]
  initialTab?: Tab
  open: boolean
  onClose: () => void
  onUpdate: (lead: CrmLead) => void
  onDelete: (leadId: string) => void
}

const getBaseType = (type: string) => type.split(':')[0]
const getFieldWidth = (type: string): 'full' | 'half' => type.includes(':half') ? 'half' : 'full'
const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)

const CurrencyInput = ({ value, onChange, className }: { value: number | string; onChange: (v: number) => void; className?: string }) => {
  const displayVal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
  return (
    <input 
      type="text" 
      className={className}
      value={displayVal} 
      onChange={(e) => {
        const numericStr = e.target.value.replace(/\D/g, '')
        const floatValue = numericStr ? parseInt(numericStr, 10) / 100 : 0
        onChange(floatValue)
      }} 
    />
  )
}

export default function LeadDetailPanel({ lead, stages, pipelineFields, initialTab, open, onClose, onUpdate, onDelete }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab || 'dados')
  const [editLead, setEditLead] = useState<CrmLead>(lead)
  const [customFields, setCustomFields] = useState<Record<string, any>>(lead.custom_data || {})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [taskCount, setTaskCount] = useState<{ pending: number; overdue: number }>({ pending: 0, overdue: 0 })
  const [timelineKey, setTimelineKey] = useState(0)

  // Sync when lead changes (e.g. after drag-drop)
  useEffect(() => {
    setEditLead(lead)
    setCustomFields(lead.custom_data || {})
  }, [lead])

  // Load task counts for badges
  const loadTaskCounts = useCallback(async () => {
    const res = await crmCall('crm-manage-tasks', { action: 'list', lead_id: lead.id })
    if (!res.error && res.tasks) {
      const tasks = res.tasks as CrmTask[]
      const today = new Date().toDateString()
      const pending = tasks.filter((t: CrmTask) => t.status === 'pendente').length
      const overdue = tasks.filter((t: CrmTask) => t.status === 'pendente' && new Date(t.due_date) < new Date(today)).length
      setTaskCount({ pending, overdue })
    }
  }, [lead.id])

  useEffect(() => {
    if (open) {
      if (initialTab) setTab(initialTab)
      loadTaskCounts()
    }
  }, [open, initialTab, loadTaskCounts])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const saveLead = async () => {
    if (saving) return
    setSaving(true)
    const res = await crmCall('crm-manage-leads', {
      action: 'update', lead_id: editLead.id,
      company_name: editLead.company_name, contact_name: editLead.contact_name,
      email: editLead.email, phone: editLead.phone,
      estimated_value: editLead.estimated_value,
      notes: editLead.notes, source: editLead.source, custom_data: customFields,
    })
    setSaving(false)
    if (res.error) { showToast(`Erro: ${res.error}`); return }
    onUpdate(res.lead as CrmLead)
    showToast('Lead atualizado!')
  }

  const deleteLead = async () => {
    if (!confirm(`Excluir "${editLead.company_name}"?`)) return
    const res = await crmCall('crm-manage-leads', { action: 'delete', lead_id: editLead.id })
    if (res.error) { showToast(`Erro: ${res.error}`); return }
    onDelete(editLead.id)
    onClose()
  }

  const currentStage = stages.find(s => s.id === editLead.stage_id)

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className={styles.drawerBackdrop} onClick={onClose} />

      {/* Drawer */}
      <div className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}>
        {/* Header */}
        <div className={styles.drawerHeader}>
          <div>
            <div className={styles.drawerCompany}>{editLead.company_name}</div>
            <div className={styles.drawerMeta}>
              {currentStage && (
                <span className={styles.drawerStageBadge} style={{ background: `${currentStage.color}18`, color: currentStage.color, borderColor: `${currentStage.color}40` }}>
                  {currentStage.name}
                </span>
              )}
              <span className={styles.drawerValue}>{fmt(editLead.estimated_value)}</span>
            </div>
          </div>
          <button className={styles.drawerCloseBtn} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Toast */}
        {toast && <div className={styles.drawerToast}>{toast}</div>}

        {/* Tabs */}
        <div className={styles.drawerTabs}>
          <button className={`${styles.drawerTab} ${tab === 'dados' ? styles.drawerTabActive : ''}`} onClick={() => setTab('dados')}>
            📋 Dados
          </button>
          <button className={`${styles.drawerTab} ${tab === 'timeline' ? styles.drawerTabActive : ''}`} onClick={() => setTab('timeline')}>
            📊 Timeline
          </button>
          <button className={`${styles.drawerTab} ${tab === 'tarefas' ? styles.drawerTabActive : ''}`} onClick={() => setTab('tarefas')}>
            ✅ Tarefas
            {taskCount.overdue > 0 && <span className={styles.drawerBadgeRed}>{taskCount.overdue}</span>}
            {taskCount.overdue === 0 && taskCount.pending > 0 && <span className={styles.drawerBadgeBlue}>{taskCount.pending}</span>}
          </button>
        </div>

        {/* Tab Content */}
        <div className={styles.drawerBody}>
          {/* ─── Tab: Dados ────────────────────────────────────────────── */}
          {tab === 'dados' && (
            <div className={styles.drawerForm}>
              <div className={styles.field}>
                <label>Empresa *</label>
                <input value={editLead.company_name} onChange={e => setEditLead(l => ({ ...l, company_name: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Etapa</label>
                <select value={editLead.stage_id} onChange={e => setEditLead(l => ({ ...l, stage_id: e.target.value }))}>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 12px' }}>
                {pipelineFields.filter(f => getBaseType(f.type) !== 'system_stage_id').map(field => {
                  const bType = getBaseType(field.type)
                  const isHalf = getFieldWidth(field.type) === 'half' && bType !== 'longtext' && bType !== 'system_notes'
                  const isSys = bType.startsWith('system_')
                  const sysKey = isSys ? bType.replace('system_', '') : ''
                  const val = isSys ? (editLead as any)[sysKey] : (customFields[field.name] || '')

                  const setVal = (v: any) => {
                    const finalVal = (sysKey === 'estimated_value') ? (parseFloat(v) || 0) : v
                    if (isSys) {
                      setEditLead(l => ({ ...l, [sysKey]: finalVal }))
                    } else {
                      setCustomFields(f => ({ ...f, [field.name]: v }))
                    }
                  }

                  return (
                    <div key={field.id} className={styles.field} style={{ flex: isHalf ? '0 0 calc(50% - 6px)' : '0 0 100%' }}>
                      <label>{field.name}</label>
                      {bType === 'longtext' || bType === 'system_notes' ? (
                        <textarea value={val || ''} onChange={e => setVal(e.target.value)} />
                      ) : bType === 'select' ? (
                        <select value={val || ''} onChange={e => setVal(e.target.value)}>
                          <option value="">Selecione...</option>
                          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : bType === 'currency' || bType === 'system_estimated_value' ? (
                        <CurrencyInput
                          value={val}
                          onChange={v => {
                            if (isSys) setEditLead(l => ({ ...l, [sysKey]: v }))
                            else setCustomFields(f => ({ ...f, [field.name]: v }))
                          }}
                        />
                      ) : (
                        <input
                          type={bType === 'number' ? 'number' : bType === 'date' ? 'date' : bType === 'email' ? 'email' : 'text'}
                          value={val || ''}
                          onChange={e => setVal(e.target.value)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Actions */}
              <div className={styles.drawerFormActions}>
                <button className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`} onClick={deleteLead}>
                  Excluir Lead
                </button>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={saveLead} disabled={saving || !editLead.company_name.trim()}>
                  {saving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </div>
          )}

          {/* ─── Tab: Timeline ─────────────────────────────────────────── */}
          {tab === 'timeline' && (
            <div className={styles.drawerTimelineWrap}>
              <ActivityTimeline leadId={lead.id} key={timelineKey} />
              <div className={styles.drawerTimelineFooter}>
                <RegisterActivityForm
                  leadId={lead.id}
                  onCreated={() => setTimelineKey(k => k + 1)}
                />
              </div>
            </div>
          )}

          {/* ─── Tab: Tarefas ──────────────────────────────────────────── */}
          {tab === 'tarefas' && (
            <TaskList leadId={lead.id} />
          )}
        </div>
      </div>
    </>
  )
}
