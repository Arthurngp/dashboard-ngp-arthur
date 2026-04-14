'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { crmCall, CrmPipeline, CrmStage, CrmLead, CrmPipelineField } from '@/lib/crm-api'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import { comercialNav } from '../comercial-nav'
import styles from './pipeline.module.css'
import { Suspense } from 'react'
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  DragOverlay, PointerSensor, useSensor, useSensors,
  rectIntersection, useDroppable,
} from '@dnd-kit/core'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ─── Sidebar nav ─────────────────────────────────────────────────────────────
// Removida definição local para usar comercial-nav.tsx

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)

// ─── Lead Card (sortable) ─────────────────────────────────────────────────────
function LeadCard({ lead, onEdit, overlay }: { lead: CrmLead; onEdit: (l: CrmLead) => void; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div
      ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`${styles.leadCard} ${isDragging ? styles.leadCardDragging : ''} ${overlay ? styles.leadCardOverlay : ''}`}
    >
      <div className={styles.leadCompany}>{lead.company_name}</div>
      {lead.contact_name && <div className={styles.leadContact}>{lead.contact_name}</div>}
      <div className={styles.leadValue}>{fmt(lead.estimated_value)}</div>
      <div className={styles.leadFooter}>
        <span className={styles.leadContact} style={{ fontSize: 11 }}>{lead.source || ''}</span>
        <button className={styles.leadEditBtn} onClick={e => { e.stopPropagation(); onEdit(lead) }}>editar ✎</button>
      </div>
    </div>
  )
}

// ─── Droppable Column ─────────────────────────────────────────────────────────
function KanbanColumn({ stage, leads, onEdit }: { stage: CrmStage; leads: CrmLead[]; onEdit: (l: CrmLead) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  return (
    <div className={`${styles.column} ${isOver ? styles.columnOver : ''}`}>
      <div className={styles.columnHeader}>
        <div className={styles.columnDot} style={{ background: stage.color }} />
        <span className={styles.columnName}>{stage.name}</span>
        <span className={styles.columnCount}>{leads.length}</span>
      </div>
      <div ref={setNodeRef} className={styles.columnBody}>
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map(lead => <LeadCard key={lead.id} lead={lead} onEdit={onEdit} />)}
        </SortableContext>
        {leads.length === 0 && <div className={styles.emptyColumn}>Nenhum lead</div>}
      </div>
    </div>
  )
}

// ─── Sortable Stage Row ─────────────────────────────────────────────────────
function SortableStageRow({ se, leadsCount, onDelete, onChangeName, onChangeColor, saving }: { se: any, leadsCount: number, onDelete: () => void, onChangeName: (v: string) => void, onChangeColor: (v: string) => void, saving: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: se.id })
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : 1, position: 'relative' as any }
  return (
    <div ref={setNodeRef} style={style} className={styles.stageRow}>
      <button 
        type="button" 
        style={{ background: 'transparent', border: 'none', color: '#6B7280', cursor: isDragging ? 'grabbing' : 'grab', padding: '4px', display: 'flex', alignItems: 'center' }} 
        {...attributes} 
        {...listeners} 
        disabled={saving}
        title="Arraste para reordenar"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
      </button>
      <input type="color" className={styles.stageColorInput} value={se.color} onChange={e => onChangeColor(e.target.value)} disabled={saving} />
      <input className={styles.stageNameInput} value={se.name} onChange={e => onChangeName(e.target.value)} disabled={saving} />
      <span className={styles.stageLeadCount}>{leadsCount} lead{leadsCount !== 1 ? 's' : ''}</span>
      <div className={styles.stageActions}>
        <button className={styles.stageDeleteBtn} onClick={onDelete} disabled={leadsCount > 0 || saving} title={leadsCount > 0 ? 'Mova os leads antes de excluir' : 'Excluir etapa'}>×</button>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getBaseType = (type: string) => type.split(':')[0]
const getFieldWidth = (type: string): 'full' | 'half' => type.includes(':half') ? 'half' : 'full'

// ─── Sortable Field Row ─────────────────────────────────────────────────────
function SortableFieldRow({ 
  field, onDelete, onChangeName, onChangeType, onChangeOptions, saving 
}: { 
  field: CrmPipelineField, 
  onDelete: () => void, 
  onChangeName: (v: string) => void, 
  onChangeType: (v: string) => void, 
  onChangeOptions: (v: string[]) => void, 
  saving: boolean 
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const baseType = getBaseType(field.type)
  const isHalf = getFieldWidth(field.type) === 'half'
  
  const style = { 
    transform: CSS.Transform.toString(transform), 
    transition, 
    zIndex: isDragging ? 20 : 1, 
    position: 'relative' as any, 
    display: 'flex', 
    flexDirection: 'column' as any,
    gap: 8, 
    padding: '16px',
    background: '#ffffff',
    border: isDragging ? '1px solid #3b82f6' : '1px solid #e2e8f0',
    borderRadius: 8,
    marginBottom: 12,
    boxShadow: isDragging ? '0 10px 20px rgba(59, 130, 246, 0.1)' : 'none'
  }

  const toggleWidth = () => {
    const newType = isHalf ? baseType : `${baseType}:half`
    onChangeType(newType)
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button type="button" style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: isDragging ? 'grabbing' : 'grab', padding: '4px' }} {...attributes} {...listeners} disabled={saving}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={16} height={16}>
            <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
            <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
          </svg>
        </button>

        <input 
          className={styles.stageNameInput} 
          style={{ flex: 1, fontWeight: 600, border: 'none', paddingLeft: 0, borderBottom: '1px solid transparent' }} 
          value={field.name} 
          onChange={e => onChangeName(e.target.value)} 
          disabled={saving} 
          placeholder="Nome do campo"
        />

        <select 
          className={styles.stageNameInput} 
          style={{ width: 150, padding: '4px 8px', fontSize: 13, border: '1px solid #e2e8f0' }} 
          value={baseType} 
          onChange={e => onChangeType(isHalf ? `${e.target.value}:half` : e.target.value)} 
          disabled={saving}
        >
          <optgroup label="Padrão">
            <option value="system_stage_id">Etapa</option>
            <option value="system_contact_name">Contato</option>
            <option value="system_source">Origem</option>
            <option value="system_phone">Telefone</option>
            <option value="system_email">Email</option>
            <option value="system_estimated_value">Valor</option>
            <option value="system_notes">Obs</option>
          </optgroup>
          <optgroup label="Customizado">
            <option value="text">Texto Curto</option>
            <option value="longtext">Texto Longo</option>
            <option value="number">Número</option>
            <option value="currency">Moeda</option>
            <option value="cnpj">CNPJ/CPF</option>
            <option value="date">Data</option>
            <option value="select">Múltipla Escolha</option>
          </optgroup>
        </select>

        <button 
          className={styles.btn} 
          title="Alternar largura entre Pequeno (50%) e Grande (100%)"
          style={{ width: 85, fontSize: 11, background: isHalf ? '#eff6ff' : '#f8fafc', color: isHalf ? '#2563eb' : '#64748b', border: isHalf ? '1px solid #bfdbfe' : '1px solid #e2e8f0' }}
          onClick={toggleWidth}
          disabled={baseType === 'longtext' || baseType === 'system_notes' || saving}
        >
          {isHalf ? 'Pequeno' : 'Grande'}
        </button>

        <button className={styles.stageDeleteBtn} style={{ color: '#ef4444' }} onClick={onDelete} disabled={saving}>×</button>
      </div>

      {baseType === 'select' && (
        <div style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 28 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Opções da Lista</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(field.options || []).map((opt, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 4px' }}>
                <input 
                  style={{ border: 'none', background: 'transparent', fontSize: 12, padding: 2, width: 80 }}
                  value={opt}
                  onChange={e => {
                    const newOpts = [...(field.options || [])]
                    newOpts[idx] = e.target.value
                    onChangeOptions(newOpts)
                  }}
                  disabled={saving}
                />
                <button 
                  style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: '0 4px', fontSize: 14 }}
                  onClick={() => onChangeOptions((field.options || []).filter((_, i) => i !== idx))}
                  disabled={saving}
                >
                  ×
                </button>
              </div>
            ))}
            <button 
              className={styles.btnSm}
              style={{ background: '#fff', border: '1px dashed #cbd5e1', color: '#3b82f6', fontSize: 12 }}
              onClick={() => onChangeOptions([...(field.options || []), 'Nova opção'])}
              disabled={saving}
            >
              + Opção
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SortablePreviewField({ field }: { field: CrmPipelineField }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const baseType = getBaseType(field.type)
  const isHalf = getFieldWidth(field.type) === 'half' && baseType !== 'longtext' && baseType !== 'system_notes'
  
  const style = { 
    transform: CSS.Transform.toString(transform), 
    transition, 
    zIndex: isDragging ? 2 : 1, 
    opacity: isDragging ? 0.5 : 1,
    flex: isHalf ? '0 0 calc(50% - 6px)' : '0 0 100%'
  }

  return (
    <div ref={setNodeRef} style={style} className={styles.field}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <label style={{ cursor: 'grab', display: 'flex', alignItems: 'center', gap: 6 }} {...attributes} {...listeners}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#adb5bd" strokeWidth="2" width={12} height={12}>
            <circle cx="9" cy="9" r="1"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="15" cy="15" r="1"/>
          </svg>
          {field.name}
        </label>
      </div>
      {baseType === 'longtext' || baseType === 'system_notes' ? (
        <textarea disabled placeholder="..." style={{ background: '#ffffff', height: 60, border: '1px solid #e2e8f0' }} />
      ) : (baseType === 'select' || baseType === 'system_stage_id') ? (
        <select disabled style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
          <option>Selecione...</option>
          {baseType === 'select' 
            ? (field.options || []).map(o => <option key={o}>{o}</option>)
            : <option>Opções do Pipeline</option>
          }
        </select>
      ) : (
        <input disabled placeholder="..." style={{ background: '#ffffff', border: '1px solid #e2e8f0' }} />
      )}
    </div>
  )
}


// ─── Page ────────────────────────────────────────────────────────────────────
// ─── Pipeline Content (com suporte a SearchParams/Suspense) ─────────────────
function PipelineContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)

  const tabParam = searchParams.get('tab')
  const actionParam = searchParams.get('action')

  // Data
  const [pipelines, setPipelines]               = useState<CrmPipeline[]>([])
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null)
  const [viewMode, setViewMode]                 = useState<'kanban' | 'fields'>('kanban')
  const [stages, setStages]                     = useState<CrmStage[]>([])
  const [leads, setLeads]                       = useState<CrmLead[]>([])
  const [pipelineFields, setPipelineFields]     = useState<CrmPipelineField[]>([])
  const [loading, setLoading]                   = useState(true)
  const [error, setError]                       = useState('')
  const [toast, setToast]                       = useState('')

  // DnD
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)
  const activeLead = leads.find(l => l.id === activeLeadId) || null

  // Modals
  const [showNewPipeline,   setShowNewPipeline]   = useState(false)
  const [showNewLead,       setShowNewLead]       = useState(false)
  const [showManageStages,  setShowManageStages]  = useState(false)
  const [showEditLead,      setShowEditLead]      = useState(false)
  const [showDeletePipeline,setShowDeletePipeline]= useState(false)

  // Forms
  const [fPipelineName, setFPipelineName] = useState('')
  const [fPipelineDesc, setFPipelineDesc] = useState('')
  const [fLead, setFLead] = useState({ company_name: '', contact_name: '', email: '', phone: '', estimated_value: '', stage_id: '', notes: '', source: '', custom_data: {} as Record<string, any> })
  const [editLead, setEditLead] = useState<CrmLead | null>(null)
  const [editLeadCustomFields, setEditLeadCustomFields] = useState<Record<string, any>>({})
  const [stageEdits, setStageEdits] = useState<{ id: string; name: string; color: string }[]>([])
  const [fieldEdits, setFieldEdits] = useState<CrmPipelineField[]>([])
  const [newStageName, setNewStageName] = useState('')
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState('text')
  const [newFieldOptions, setNewFieldOptions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    setSess(s)
  }, [router])

  // ── Load pipelines ────────────────────────────────────────────────────────
  const loadPipelines = useCallback(async () => {
    const data = await crmCall('crm-manage-pipeline', { action: 'list' })
    if (data.error) { setError(data.error); return [] }
    setPipelines(data.pipelines || [])
    return data.pipelines || []
  }, [])

  // ── Load stages + leads for active pipeline ───────────────────────────────
  const loadPipelineData = useCallback(async (pipelineId: string) => {
    setLoading(true)
    try {
      const [sData, lData, fData] = await Promise.all([
        crmCall('crm-manage-stages', { action: 'list', pipeline_id: pipelineId }),
        crmCall('crm-manage-leads',  { action: 'list', pipeline_id: pipelineId }),
        crmCall('crm-manage-fields', { action: 'list', pipeline_id: pipelineId })
      ])
      if (sData.error) { setError(sData.error); return }
      if (lData.error) { setError(lData.error); return }
      if (fData.error) { setError(fData.error); return }
      setStages(sData.stages || [])
      setLeads(lData.leads   || [])
      setPipelineFields(fData.fields || [])
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sess) return
    loadPipelines().then(pls => {
      if (pls.length > 0) {
        setActivePipelineId(pls[0].id)
      } else {
        setLoading(false)
      }
    })
  }, [sess, loadPipelines])

  useEffect(() => {
    if (activePipelineId) loadPipelineData(activePipelineId)
  }, [activePipelineId, loadPipelineData])

  // Keep fieldEdits in sync when pipelineFields reload (e.g. after saving)
  useEffect(() => {
    if (viewMode === 'fields') setFieldEdits([...pipelineFields])
  }, [pipelineFields, viewMode])

  // ── Helpers ───────────────────────────────────────────────────────────────
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500) }
  function showErr(msg: string)   { setError(msg);  setTimeout(() => setError(''), 5000) }

  function openManageStages() {
    setStageEdits(stages.map(s => ({ id: s.id, name: s.name, color: s.color })))
    setNewStageName('')
    setShowManageStages(true)
  }

  function openManageFields() {
    setFieldEdits([...pipelineFields])
    setNewFieldName('')
    setNewFieldType('text')
    setNewFieldOptions([])
    setViewMode('fields')
  }

  function openEditLead(lead: CrmLead) {
    setEditLead(lead)
    setEditLeadCustomFields(lead.custom_data || {})
    setShowEditLead(true)
  }

  // ── Sync URL Params ───────────────────────────────────────────────────────
  useEffect(() => {
    if (tabParam === 'fields') setViewMode('fields')
    if (tabParam === 'kanban') setViewMode('kanban')
    if (actionParam === 'new_pipeline') setShowNewPipeline(true)
  }, [tabParam, actionParam])

  // ── Actions: Pipeline ─────────────────────────────────────────────────────
  async function createPipeline() {
    if (!fPipelineName.trim()) return
    setSaving(true)
    const data = await crmCall('crm-manage-pipeline', { action: 'create', name: fPipelineName, description: fPipelineDesc })
    setSaving(false)
    if (data.error) { showErr(data.error); return }
    setPipelines(prev => [...prev, data.pipeline])
    setActivePipelineId(data.pipeline.id)
    setStages(data.stages)
    setLeads([])
    setFPipelineName(''); setFPipelineDesc('')
    setShowNewPipeline(false)
    showToast(`Funil "${data.pipeline.name}" criado!`)
  }

  async function deletePipeline() {
    if (!activePipelineId) return
    setSaving(true)
    const data = await crmCall('crm-manage-pipeline', { action: 'delete', pipeline_id: activePipelineId })
    setSaving(false)
    if (data.error) { showErr(data.error); setShowDeletePipeline(false); return }
    const remaining = pipelines.filter(p => p.id !== activePipelineId)
    setPipelines(remaining)
    setShowDeletePipeline(false)
    if (remaining.length > 0) {
      setActivePipelineId(remaining[0].id)
    } else {
      setActivePipelineId(null); setStages([]); setLeads([])
    }
    showToast('Funil excluído.')
  }

  // ── Actions: Lead ─────────────────────────────────────────────────────────
  async function createLead() {
    if (!fLead.company_name.trim() || !fLead.stage_id || !activePipelineId) return
    
    // Update Otimista
    const tempId = 'temp-' + Date.now()
    const optimisticLead: CrmLead = {
      id: tempId,
      pipeline_id: activePipelineId,
      stage_id: fLead.stage_id,
      company_name: fLead.company_name,
      contact_name: fLead.contact_name,
      email: fLead.email,
      phone: fLead.phone,
      estimated_value: parseFloat(fLead.estimated_value) || 0,
      position: 0, // Novo lead sempre no topo
      notes: fLead.notes,
      source: fLead.source,
      status: 'active',
      custom_data: fLead.custom_data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    
    setLeads(prev => [
      ...prev.map(l => l.stage_id === fLead.stage_id ? { ...l, position: l.position + 1 } : l),
      optimisticLead
    ])
    setShowNewLead(false)
    const resetForm = () => setFLead({ company_name: '', contact_name: '', email: '', phone: '', estimated_value: '', stage_id: stages[0]?.id || '', notes: '', source: '', custom_data: {} })
    resetForm()

    const data = await crmCall('crm-manage-leads', {
      action: 'create', pipeline_id: activePipelineId,
      stage_id: optimisticLead.stage_id, company_name: optimisticLead.company_name,
      contact_name: optimisticLead.contact_name, email: optimisticLead.email, phone: optimisticLead.phone,
      estimated_value: optimisticLead.estimated_value,
      notes: optimisticLead.notes, source: optimisticLead.source, custom_data: optimisticLead.custom_data
    })
    
    if (data.error) {
      showErr(data.error)
      setLeads(prev => prev.filter(l => l.id !== tempId))
      return
    }
    
    // Substitui o lead otimista pelo real vindo do banco
    setLeads(prev => prev.map(l => l.id === tempId ? data.lead : l))
    showToast('Lead criado!')
  }

  async function updateLead() {
    if (!editLead) return
    setSaving(true)
    const data = await crmCall('crm-manage-leads', {
      action: 'update', lead_id: editLead.id,
      company_name: editLead.company_name, contact_name: editLead.contact_name,
      email: editLead.email, phone: editLead.phone,
      estimated_value: editLead.estimated_value,
      notes: editLead.notes, source: editLead.source, custom_data: editLeadCustomFields
    })
    setSaving(false)
    if (data.error) { showErr(data.error); return }
    setLeads(prev => prev.map(l => l.id === data.lead.id ? data.lead : l))
    setShowEditLead(false)
    showToast('Lead atualizado!')
  }

  async function deleteLead() {
    if (!editLead || !confirm(`Excluir "${editLead.company_name}"?`)) return
    
    // Update Otimista
    const leadToDelete = editLead
    setLeads(prev => prev.filter(l => l.id !== leadToDelete.id))
    setShowEditLead(false)

    const data = await crmCall('crm-manage-leads', { action: 'delete', lead_id: leadToDelete.id })
    if (data.error) {
      showErr(data.error)
      setLeads(prev => [...prev, leadToDelete]) // Rollback
      return
    }
    showToast('Lead excluído.')
  }

  // ── Actions: Stages ───────────────────────────────────────────────────────
  async function saveStages() {
    if (!activePipelineId) return
    setSaving(true)
    try {
      // Adicionar nova etapa se preenchida
      if (newStageName.trim()) {
        const data = await crmCall('crm-manage-stages', { action: 'create', pipeline_id: activePipelineId, name: newStageName })
        if (data.error) { showErr(data.error); return }
      }
      // Aplicar renomes e cores
      for (const se of stageEdits) {
        const orig = stages.find(s => s.id === se.id)
        if (orig && (orig.name !== se.name || orig.color !== se.color)) {
          if (orig.name !== se.name)   await crmCall('crm-manage-stages', { action: 'rename',       stage_id: se.id, name: se.name })
          if (orig.color !== se.color) await crmCall('crm-manage-stages', { action: 'update_color', stage_id: se.id, color: se.color })
        }
      }
      // Reordenar
      await crmCall('crm-manage-stages', { action: 'reorder', pipeline_id: activePipelineId, ordered_ids: stageEdits.map(s => s.id) })
    } finally {
      setSaving(false)
    }
    await loadPipelineData(activePipelineId)
    setShowManageStages(false)
    showToast('Etapas atualizadas!')
  }

  async function deleteStage(stageId: string) {
    const leadsInStage = leads.filter(l => l.stage_id === stageId).length
    if (leadsInStage > 0) { showErr(`Esta etapa tem ${leadsInStage} lead(s). Mova-os antes de excluir.`); return }
    if (!confirm('Excluir esta etapa?')) return
    const data = await crmCall('crm-manage-stages', { action: 'delete', stage_id: stageId })
    if (data.error) { showErr(data.error); return }
    setStageEdits(prev => prev.filter(s => s.id !== stageId))
    if (activePipelineId) loadPipelineData(activePipelineId)
    showToast('Etapa excluída.')
  }

  function moveStage(index: number, direction: 'up' | 'down') {
    const newEdits = [...stageEdits]
    if (direction === 'up' && index > 0) {
      const temp = newEdits[index - 1]
      newEdits[index - 1] = newEdits[index]
      newEdits[index] = temp
      setStageEdits(newEdits)
    } else if (direction === 'down' && index < newEdits.length - 1) {
      const temp = newEdits[index + 1]
      newEdits[index + 1] = newEdits[index]
      newEdits[index] = temp
      setStageEdits(newEdits)
    }
  }

  function handleFieldDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setFieldEdits(items => {
        const oldIndex = items.findIndex(i => i.id === active.id)
        const newIndex = items.findIndex(i => i.id === over.id)
        const newItems = [...items]
        const [moved] = newItems.splice(oldIndex, 1)
        newItems.splice(newIndex, 0, moved)
        return newItems
      })
    }
  }

  function handleStageDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setStageEdits(items => {
        const oldIndex = items.findIndex(i => i.id === active.id)
        const newIndex = items.findIndex(i => i.id === over.id)
        const newItems = [...items]
        const [moved] = newItems.splice(oldIndex, 1)
        newItems.splice(newIndex, 0, moved)
        return newItems
      })
    }
  }

  // ── Actions: Fields ───────────────────────────────────────────────────────
  async function saveFields() {
    if (!activePipelineId) return
    setSaving(true)
    try {
      if (newFieldName.trim()) {
        const type = newFieldType
        const options = newFieldOptions.filter(o => o.trim())
        const data = await crmCall('crm-manage-fields', { action: 'create', pipeline_id: activePipelineId, name: newFieldName, type, options })
        if (data.error) { showErr(data.error); return }
        setNewFieldName('')
        setNewFieldOptions([])
      }
      for (const fe of fieldEdits) {
        const orig = pipelineFields.find(f => f.id === fe.id)
        if (orig && (orig.name !== fe.name || orig.type !== fe.type || JSON.stringify(orig.options) !== JSON.stringify(fe.options))) {
          await crmCall('crm-manage-fields', { action: 'update', field_id: fe.id, name: fe.name, type: fe.type, options: fe.options })
        }
      }
      await crmCall('crm-manage-fields', { action: 'reorder', pipeline_id: activePipelineId, ordered_ids: fieldEdits.map(f => f.id) })
    } finally {
      setSaving(false)
    }
    await loadPipelineData(activePipelineId)
    showToast('Arquitetura salva com sucesso!')
  }

  async function deleteField(fieldId: string) {
    if (!confirm('Excluir este campo? Ele sumirá de todos os leads!')) return
    const data = await crmCall('crm-manage-fields', { action: 'delete', field_id: fieldId })
    if (data.error) { showErr(data.error); return }
    setFieldEdits(prev => prev.filter(f => f.id !== fieldId))
    if (activePipelineId) loadPipelineData(activePipelineId)
    showToast('Campo excluído.')
  }

  // ── Drag and Drop ─────────────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    setActiveLeadId(event.active.id as string)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = active.id as string
    const overId   = over.id as string

    const activeLead = leads.find(l => l.id === activeId)
    if (!activeLead) return

    // over é uma stage (coluna)
    const overStage = stages.find(s => s.id === overId)
    if (overStage && activeLead.stage_id !== overStage.id) {
      setLeads(prev => prev.map(l => l.id === activeId ? { ...l, stage_id: overStage.id } : l))
      return
    }

    // over é um lead em outra coluna
    const overLead = leads.find(l => l.id === overId)
    if (overLead && overLead.stage_id !== activeLead.stage_id) {
      setLeads(prev => prev.map(l => l.id === activeId ? { ...l, stage_id: overLead.stage_id } : l))
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveLeadId(null)
    if (!over) return

    const leadId  = active.id as string
    const lead    = leads.find(l => l.id === leadId)
    if (!lead) return

    // Determina stage de destino
    let targetStageId = lead.stage_id
    const overStage   = stages.find(s => s.id === over.id)
    const overLead    = leads.find(l => l.id === over.id)
    if (overStage) targetStageId = overStage.id
    else if (overLead) targetStageId = overLead.stage_id

    const leadsInTarget = leads.filter(l => l.stage_id === targetStageId && l.id !== leadId)
    let newPosition = leadsInTarget.length

    if (overLead && overLead.stage_id === targetStageId) {
      newPosition = overLead.position
    }

    // Chama a Edge Function para persistir (já atualizou otimisticamente no handleDragOver)
    const data = await crmCall('crm-manage-leads', {
      action: 'move', lead_id: leadId,
      new_stage_id: targetStageId, new_position: newPosition,
    })
    if (data.error) {
      showErr(data.error)
      // Reverte recarregando do servidor
      if (activePipelineId) loadPipelineData(activePipelineId)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!sess) return null

  const activePipeline = pipelines.find(p => p.id === activePipelineId)

  return (
    <div className={styles.layout}>
      <Sidebar 
        minimal 
        sectorNav={comercialNav} 
        sectorNavTitle="COMERCIAL" 
        activeTab={viewMode}
        onTabChange={(tab) => {
          if (tab === 'new_pipeline') setShowNewPipeline(true)
          else if (tab === 'fields') openManageFields()
          else setViewMode(tab as any)
        }}
      />
      <NGPLoading loading={loading && pipelines.length === 0} />

      <main className={styles.main}>
        <div className={styles.content}>

          {/* Header */}
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <div>
                <span className={styles.eyebrow}>SETOR COMERCIAL</span>
                <h1 className={styles.title}>Pipeline de Vendas</h1>
              </div>
              {viewMode === 'kanban' && activePipeline && pipelines.length > 0 && (
                <select
                  className={styles.pipelineSelect}
                  value={activePipelineId || ''}
                  onChange={e => setActivePipelineId(e.target.value)}
                >
                  {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>

            <div className={styles.headerRight}>
              {activePipeline && viewMode === 'kanban' && (
                <>
                  <button className={`${styles.btn} ${styles.btnGhost}`} onClick={openManageStages}>⚙ Etapas</button>
                  <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnIcon}`} title="Excluir funil" onClick={() => setShowDeletePipeline(true)}>🗑</button>
                </>
              )}
              {activePipeline && viewMode === 'kanban' && (
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => { setFLead({ company_name: '', contact_name: '', email: '', phone: '', estimated_value: '', stage_id: stages[0]?.id || '', notes: '', source: '', custom_data: {} }); setShowNewLead(true) }}
                >
                  + Novo Lead
                </button>
              )}
            </div>
          </header>

          {error && <div className={styles.errorBar}>{error}</div>}
          {toast && <div className={styles.successBar}>{toast}</div>}

          {/* Board */}
          {loading && pipelines.length === 0 ? (
            <div className={styles.loadingWrap}></div>
          ) : pipelines.length === 0 ? (
            <div className={styles.loadingWrap}>
              <div style={{ textAlign: 'center' }}>
                <div className={styles.loadingText} style={{ marginBottom: 16 }}>Nenhum funil criado ainda.</div>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setShowNewPipeline(true)}>+ Criar primeiro funil</button>
              </div>
            </div>
          ) : viewMode === 'fields' ? (
            <div style={{ flex: 1, padding: '24px 32px', width: '100%', display: 'flex', gap: 32, overflow: 'hidden' }}>
              {/* Coluna 1: Editor Técnico */}
              <div style={{ flex: '0 0 420px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>Cadastrar Campos</h2>
                    <p style={{ fontSize: 13, color: '#64748b' }}>Configure arquitetura de dados e ordem.</p>
                  </div>
                  <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setViewMode('kanban')}>← Sair</button>
                </div>

                <div className={styles.stagesList} style={{ maxHeight: 'calc(100vh - 280px)', background: '#ffffff', border: '1px solid #e2e8f0', padding: 16, borderRadius: 12, overflowY: 'auto' }}>
                  <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={handleFieldDragEnd}>
                        <SortableContext items={fieldEdits.map(s => s.id)} strategy={verticalListSortingStrategy}>
                          {fieldEdits.map(fe => (
                            <SortableFieldRow
                              key={fe.id}
                              field={fe}
                              saving={saving}
                              onDelete={() => deleteField(fe.id)}
                              onChangeName={(val) => setFieldEdits(prev => prev.map(f => f.id === fe.id ? { ...f, name: val } : f))}
                              onChangeType={(val) => setFieldEdits(prev => prev.map(f => f.id === fe.id ? { ...f, type: val } : f))}
                              onChangeOptions={(val) => setFieldEdits(prev => prev.map(f => f.id === fe.id ? { ...f, options: val } : f))}
                            />
                          ))}
                        </SortableContext>
                  </DndContext>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, padding: '16px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className={styles.addStageInput} style={{ flex: 1, background: '#fff' }} placeholder="+ Nome do novo campo" value={newFieldName} onChange={e => setNewFieldName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveFields()} />
                      <select className={styles.addStageInput} style={{ width: 150, background: '#fff' }} value={newFieldType} onChange={e => setNewFieldType(e.target.value)}>
                        <optgroup label="Padrão">
                          <option value="system_stage_id">Etapa</option>
                          <option value="system_contact_name">Contato</option><option value="system_source">Origem</option>
                          <option value="system_phone">Telefone</option><option value="system_email">E-mail</option>
                          <option value="system_estimated_value">Valor</option><option value="system_notes">Obs</option>
                        </optgroup>
                        <optgroup label="Customizado">
                          <option value="text">Texto Curto</option><option value="longtext">Texto Longo</option>
                          <option value="number">Número</option><option value="currency">Moeda</option>
                          <option value="phone">Telefone</option><option value="email">Email</option>
                          <option value="cnpj">CNPJ/CPF</option><option value="date">Data</option>
                          <option value="select">Múltipla Escolha</option>
                        </optgroup>
                      </select>
                    </div>
                    {newFieldType === 'select' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {(newFieldOptions || []).map((opt, idx) => (
                           <div key={idx} style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 4px' }}>
                             <input 
                               style={{ border: 'none', background: 'transparent', fontSize: 12, padding: 2, width: 80 }}
                               value={opt}
                               onChange={e => {
                                 const next = [...newFieldOptions]
                                 next[idx] = e.target.value
                                 setNewFieldOptions(next)
                               }}
                             />
                             <button onClick={() => setNewFieldOptions(prev => prev.filter((_, i) => i !== idx))} style={{ border: 'none', background: 'transparent', color: '#94a3b8', fontSize: 14 }}>×</button>
                           </div>
                        ))}
                        <button className={styles.btnSm} style={{ background: '#fff', border: '1px dashed #cbd5e1', color: '#3b82f6' }} onClick={() => setNewFieldOptions(prev => [...prev, 'Opção'])}>+ Opção</button>
                      </div>
                    )}
                  </div>
                </div>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={saveFields} disabled={saving} style={{ padding: '12px 24px', width: '100%' }}>
                  {saving ? 'Salvando...' : 'Salvar Arquitetura'}
                </button>
              </div>

              {/* Coluna 2: Live Preview (Simulador do Modal) */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <p style={{ fontSize: 13, color: '#64748b' }}>Simulação do formulário de abertura de lead.</p>
                </div>
                
                <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16, padding: 32, overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
                  <div className={styles.modal} style={{ position: 'relative', width: '100%', maxWidth: 500, height: 'fit-content', boxShadow: '0 20px 50px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', cursor: 'default' }} onClick={e => e.stopPropagation()}>
                    <h2 className={styles.modalTitle}>Novo Lead (Simulação)</h2>
                    <div className={styles.field} style={{ opacity: 0.5 }}>
                      <label>Empresa *</label>
                      <input placeholder="Nome da empresa" disabled />
                    </div>
                    {/* Aqui renderizamos os itens sortáveis no preview também */}
                    <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={handleFieldDragEnd}>
                      <SortableContext items={fieldEdits.map(s => s.id)} strategy={verticalListSortingStrategy}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 12px' }}>
                          {fieldEdits.map(fe => (
                            <SortablePreviewField key={fe.id} field={fe} />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                    <div className={styles.modalActions} style={{ opacity: 0.5, borderTop: '1px solid #f1f5f9', paddingTop: 16, marginTop: 12 }}>
                      <button className={`${styles.btn} ${styles.btnGhost}`} disabled>Cancelar</button>
                      <button className={`${styles.btn} ${styles.btnPrimary}`} disabled>Criar Lead</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={rectIntersection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <div className={styles.board}>
                {stages.map(stage => (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    leads={leads.filter(l => l.stage_id === stage.id).sort((a, b) => a.position - b.position)}
                    onEdit={openEditLead}
                  />
                ))}
              </div>

              <DragOverlay>
                {activeLead && <LeadCard lead={activeLead} onEdit={() => {}} overlay />}
              </DragOverlay>
            </DndContext>
          )}

          <div className={styles.footer}>
            <span className={styles.footerDot} />
            Conectado ao Supabase · {sess?.user}
          </div>

        </div>
      </main>

      {/* ── Modal: Novo Funil ────────────────────────────────────────────── */}
      {showNewPipeline && (
        <div className={styles.overlay} onClick={() => setShowNewPipeline(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Novo Funil</h2>
            <div className={styles.field}>
              <label>Nome do funil *</label>
              <input placeholder="Ex: Vendas B2B" value={fPipelineName} onChange={e => setFPipelineName(e.target.value)} autoFocus />
            </div>
            <div className={styles.field}>
              <label>Descrição</label>
              <input placeholder="Descrição opcional" value={fPipelineDesc} onChange={e => setFPipelineDesc(e.target.value)} />
            </div>
            <p style={{ fontSize: 12, color: '#4a5168', margin: 0 }}>Será criado com 5 etapas padrão que você pode personalizar depois.</p>
            <div className={styles.modalActions}>
              <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setShowNewPipeline(false)}>Cancelar</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={createPipeline} disabled={saving || !fPipelineName.trim()}>
                {saving ? 'Criando...' : 'Criar Funil'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Novo Lead ─────────────────────────────────────────────── */}
      {showNewLead && (
        <div className={styles.overlay} onClick={() => setShowNewLead(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Novo Lead</h2>
            <div className={styles.field}>
              <label>Empresa *</label>
              <input placeholder="Nome da empresa" value={fLead.company_name} onChange={e => setFLead(f => ({ ...f, company_name: e.target.value }))} autoFocus />
            </div>
            <div className={styles.field}>
              <label>Etapa</label>
              <select value={fLead.stage_id} onChange={e => setFLead(f => ({ ...f, stage_id: e.target.value }))}>
                <option value="">Selecione...</option>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 12px' }}>
              {/* Campos Dinâmicos (exceto Etapa que já está no topo) */}
              {pipelineFields.filter(f => getBaseType(f.type) !== 'system_stage_id').map(field => {
                const bType = getBaseType(field.type)
                const isHalf = getFieldWidth(field.type) === 'half' && bType !== 'longtext' && bType !== 'system_notes'
                const isSys = bType.startsWith('system_')
                const sysKey = isSys ? bType.replace('system_', '') : ''
                const val = isSys ? (fLead as any)[sysKey] : (fLead.custom_data[field.name] || '')

                const setVal = (v: any) => {
                  if (isSys) {
                    setFLead(f => ({ ...f, [sysKey]: v }))
                  } else {
                    setFLead(f => ({ ...f, custom_data: { ...f.custom_data, [field.name]: v } }))
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
                    ) : (
                      <input 
                        type={(bType === 'number' || bType === 'currency' || bType === 'system_estimated_value') ? 'number' : bType === 'date' ? 'date' : bType === 'email' ? 'email' : 'text'} 
                        value={val || ''} 
                        onChange={e => setVal(e.target.value)} 
                      />
                    )}
                  </div>
                )
              })}
            </div>

            <div className={styles.modalActions}>
              <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setShowNewLead(false)}>Cancelar</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={createLead} disabled={saving || !fLead.company_name.trim()}>
                {saving ? 'Salvando...' : 'Criar Lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Editar Lead ───────────────────────────────────────────── */}
      {showEditLead && editLead && (
        <div className={styles.overlay} onClick={() => setShowEditLead(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Editar Lead</h2>
            <div className={styles.field}>
              <label>Empresa *</label>
              <input value={editLead.company_name} onChange={e => setEditLead(l => l ? { ...l, company_name: e.target.value } : l)} />
            </div>
            <div className={styles.field}>
              <label>Etapa</label>
              <select value={editLead.stage_id} onChange={e => setEditLead(l => l ? { ...l, stage_id: e.target.value } : l)}>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 12px' }}>
              {/* Campos Dinâmicos (exceto Etapa que já está no topo) */}
              {pipelineFields.filter(f => getBaseType(f.type) !== 'system_stage_id').map(field => {
                const bType = getBaseType(field.type)
                const isHalf = getFieldWidth(field.type) === 'half' && bType !== 'longtext' && bType !== 'system_notes'
                const isSys = bType.startsWith('system_')
                const sysKey = isSys ? bType.replace('system_', '') : ''
                const val = isSys ? (editLead as any)[sysKey] : (editLeadCustomFields[field.name] || '')

                const setVal = (v: any) => {
                  const finalVal = (sysKey === 'estimated_value') ? (parseFloat(v) || 0) : v
                  if (isSys) {
                    setEditLead(l => l ? { ...l, [sysKey]: finalVal } : l)
                  } else {
                    setEditLeadCustomFields(f => ({ ...f, [field.name]: v }))
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
                    ) : (
                      <input 
                        type={(bType === 'number' || bType === 'currency' || bType === 'system_estimated_value') ? 'number' : bType === 'date' ? 'date' : bType === 'email' ? 'email' : 'text'} 
                        value={val || ''} 
                        onChange={e => setVal(e.target.value)} 
                      />
                    )}
                  </div>
                )
              })}

              {!pipelineFields.some(f => getBaseType(f.type) === 'system_stage_id') && (
                <div className={styles.field} style={{ flex: '0 0 calc(50% - 6px)' }}>
                  {/* Etapa removida do meio se não existir campo sistema configurado */}
                </div>
              )}
            </div>

            <div className={styles.modalActionsSpread}>
              <button className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`} onClick={deleteLead} disabled={saving}>Excluir</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setShowEditLead(false)}>Cancelar</button>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={updateLead} disabled={saving || !editLead?.company_name.trim()}>
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Gerenciar Etapas ──────────────────────────────────────── */}
      {showManageStages && (
        <div className={styles.overlay} onClick={() => setShowManageStages(false)}>
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Gerenciar Etapas</h2>
            <p style={{ fontSize: 12, color: '#4a5168', margin: '-8px 0 0' }}>
              Edite nome e cor de cada etapa. Etapas com leads não podem ser excluídas.
            </p>
            <div className={styles.stagesList}>
              <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={handleStageDragEnd}>
                <SortableContext items={stageEdits.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  {stageEdits.map((se) => {
                    const leadsCount = leads.filter(l => l.stage_id === se.id).length
                    return (
                      <SortableStageRow
                        key={se.id}
                        se={se}
                        leadsCount={leadsCount}
                        saving={saving}
                        onDelete={() => deleteStage(se.id)}
                        onChangeName={(val) => setStageEdits(prev => prev.map(s => s.id === se.id ? { ...s, name: val } : s))}
                        onChangeColor={(val) => setStageEdits(prev => prev.map(s => s.id === se.id ? { ...s, color: val } : s))}
                      />
                    )
                  })}
                </SortableContext>
              </DndContext>
            </div>
            <div className={styles.addStageRow}>
              <input
                className={styles.addStageInput}
                placeholder="+ Nome da nova etapa"
                value={newStageName}
                onChange={e => setNewStageName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveStages()}
              />
            </div>
            <div className={styles.modalActions}>
              <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setShowManageStages(false)}>Cancelar</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={saveStages} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Confirmar Delete Funil ────────────────────────────────── */}
      {showDeletePipeline && (
        <div className={styles.overlay} onClick={() => setShowDeletePipeline(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Excluir Funil</h2>
            <p style={{ fontSize: 14, color: '#a1a1aa', margin: 0 }}>
              Tem certeza que quer excluir o funil <strong style={{ color: '#f0f2f5' }}>"{activePipeline?.name}"</strong>?
              <br /><br />
              <span style={{ color: '#f87171' }}>⚠ Esta ação é irreversível. Todos os leads e etapas serão excluídos.</span>
            </p>
            <div className={styles.modalActions}>
              <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setShowDeletePipeline(false)}>Cancelar</button>
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={deletePipeline} disabled={saving}>
                {saving ? 'Excluindo...' : 'Sim, excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PipelinePage() {
  return (
    <Suspense fallback={<NGPLoading loading={true} />}>
      <PipelineContent />
    </Suspense>
  )
}
