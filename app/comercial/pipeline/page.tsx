'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { crmCall, CrmPipeline, CrmStage, CrmLead } from '@/lib/crm-api'
import Sidebar from '@/components/Sidebar'
import styles from './pipeline.module.css'
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  DragOverlay, PointerSensor, useSensor, useSensors,
  rectIntersection,
} from '@dnd-kit/core'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

// ─── Sidebar nav ─────────────────────────────────────────────────────────────
const IcoGrid = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
const IcoPipe = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
const IcoDoc  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
const IcoSign = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><path d="M20 14.66V20a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg>
const IcoKpi  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>

const comercialNav = [
  { icon: <IcoGrid />, label: 'Gestão',      href: '/comercial/gestao' },
  { icon: <IcoPipe />, label: 'Pipeline',    href: '/comercial/pipeline' },
  { icon: <IcoDoc  />, label: 'Propostas',   href: '/comercial/propostas' },
  { icon: <IcoSign />, label: 'Contratos',   href: '/comercial/contratos' },
  { icon: <IcoKpi  />, label: 'Metas e KPIs', href: '/comercial/kpis' },
]

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

// ─── Page ────────────────────────────────────────────────────────────────────
export default function PipelinePage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)

  // Data
  const [pipelines, setPipelines]               = useState<CrmPipeline[]>([])
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null)
  const [stages, setStages]                     = useState<CrmStage[]>([])
  const [leads, setLeads]                       = useState<CrmLead[]>([])
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
  const [fLead, setFLead] = useState({ company_name: '', contact_name: '', email: '', phone: '', estimated_value: '', stage_id: '', notes: '', source: '' })
  const [editLead, setEditLead] = useState<CrmLead | null>(null)
  const [stageEdits, setStageEdits] = useState<{ id: string; name: string; color: string }[]>([])
  const [newStageName, setNewStageName] = useState('')
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
      const [sData, lData] = await Promise.all([
        crmCall('crm-manage-stages', { action: 'list', pipeline_id: pipelineId }),
        crmCall('crm-manage-leads',  { action: 'list', pipeline_id: pipelineId }),
      ])
      if (sData.error) { setError(sData.error); return }
      if (lData.error) { setError(lData.error); return }
      setStages(sData.stages || [])
      setLeads(lData.leads   || [])
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

  // ── Helpers ───────────────────────────────────────────────────────────────
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500) }
  function showErr(msg: string)   { setError(msg);  setTimeout(() => setError(''), 5000) }

  function openManageStages() {
    setStageEdits(stages.map(s => ({ id: s.id, name: s.name, color: s.color })))
    setNewStageName('')
    setShowManageStages(true)
  }

  function openEditLead(lead: CrmLead) {
    setEditLead(lead)
    setShowEditLead(true)
  }

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
    setSaving(true)
    const data = await crmCall('crm-manage-leads', {
      action: 'create', pipeline_id: activePipelineId,
      stage_id: fLead.stage_id, company_name: fLead.company_name,
      contact_name: fLead.contact_name, email: fLead.email, phone: fLead.phone,
      estimated_value: parseFloat(fLead.estimated_value) || 0,
      notes: fLead.notes, source: fLead.source,
    })
    setSaving(false)
    if (data.error) { showErr(data.error); return }
    setLeads(prev => [...prev, data.lead])
    setFLead({ company_name: '', contact_name: '', email: '', phone: '', estimated_value: '', stage_id: stages[0]?.id || '', notes: '', source: '' })
    setShowNewLead(false)
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
      notes: editLead.notes, source: editLead.source,
    })
    setSaving(false)
    if (data.error) { showErr(data.error); return }
    setLeads(prev => prev.map(l => l.id === data.lead.id ? data.lead : l))
    setShowEditLead(false)
    showToast('Lead atualizado!')
  }

  async function deleteLead() {
    if (!editLead || !confirm(`Excluir "${editLead.company_name}"?`)) return
    setSaving(true)
    const data = await crmCall('crm-manage-leads', { action: 'delete', lead_id: editLead.id })
    setSaving(false)
    if (data.error) { showErr(data.error); return }
    setLeads(prev => prev.filter(l => l.id !== editLead.id))
    setShowEditLead(false)
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
      <Sidebar minimal sectorNav={comercialNav} sectorNavTitle="COMERCIAL" />

      <main className={styles.main}>
        <div className={styles.content}>

          {/* Header */}
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <div>
                <div className={styles.eyebrow}>Setor Comercial</div>
                <h1 className={styles.title}>Pipeline de Vendas</h1>
              </div>

              {pipelines.length > 0 && (
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
              {activePipeline && (
                <>
                  <button className={`${styles.btn} ${styles.btnGhost}`} onClick={openManageStages}>⚙ Etapas</button>
                  <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnIcon}`} title="Excluir funil" onClick={() => setShowDeletePipeline(true)}>🗑</button>
                </>
              )}
              <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setShowNewPipeline(true)}>+ Novo Funil</button>
              {activePipeline && (
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => { setFLead(f => ({ ...f, stage_id: stages[0]?.id || '' })); setShowNewLead(true) }}
                >
                  + Novo Lead
                </button>
              )}
            </div>
          </header>

          {error && <div className={styles.errorBar}>{error}</div>}
          {toast && <div className={styles.successBar}>{toast}</div>}

          {/* Board */}
          {loading ? (
            <div className={styles.loadingWrap}><span className={styles.loadingText}>Carregando pipeline...</span></div>
          ) : pipelines.length === 0 ? (
            <div className={styles.loadingWrap}>
              <div style={{ textAlign: 'center' }}>
                <div className={styles.loadingText} style={{ marginBottom: 16 }}>Nenhum funil criado ainda.</div>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setShowNewPipeline(true)}>+ Criar primeiro funil</button>
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
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label>Contato</label>
                <input placeholder="Nome do contato" value={fLead.contact_name} onChange={e => setFLead(f => ({ ...f, contact_name: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Etapa</label>
                <select value={fLead.stage_id} onChange={e => setFLead(f => ({ ...f, stage_id: e.target.value }))}>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label>E-mail</label>
                <input type="email" placeholder="email@empresa.com" value={fLead.email} onChange={e => setFLead(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Telefone</label>
                <input placeholder="(00) 00000-0000" value={fLead.phone} onChange={e => setFLead(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label>Valor Estimado (R$)</label>
                <input type="number" min="0" step="0.01" placeholder="0,00" value={fLead.estimated_value} onChange={e => setFLead(f => ({ ...f, estimated_value: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Origem</label>
                <input placeholder="Ex: Indicação, LinkedIn" value={fLead.source} onChange={e => setFLead(f => ({ ...f, source: e.target.value }))} />
              </div>
            </div>
            <div className={styles.field}>
              <label>Observações</label>
              <textarea placeholder="Notas sobre este lead..." value={fLead.notes} onChange={e => setFLead(f => ({ ...f, notes: e.target.value }))} />
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
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label>Contato</label>
                <input value={editLead.contact_name || ''} onChange={e => setEditLead(l => l ? { ...l, contact_name: e.target.value } : l)} />
              </div>
              <div className={styles.field}>
                <label>Etapa</label>
                <select value={editLead.stage_id} onChange={e => setEditLead(l => l ? { ...l, stage_id: e.target.value } : l)}>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label>E-mail</label>
                <input type="email" value={editLead.email || ''} onChange={e => setEditLead(l => l ? { ...l, email: e.target.value } : l)} />
              </div>
              <div className={styles.field}>
                <label>Telefone</label>
                <input value={editLead.phone || ''} onChange={e => setEditLead(l => l ? { ...l, phone: e.target.value } : l)} />
              </div>
            </div>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label>Valor Estimado (R$)</label>
                <input type="number" min="0" step="0.01" value={editLead.estimated_value} onChange={e => setEditLead(l => l ? { ...l, estimated_value: parseFloat(e.target.value) || 0 } : l)} />
              </div>
              <div className={styles.field}>
                <label>Origem</label>
                <input value={editLead.source || ''} onChange={e => setEditLead(l => l ? { ...l, source: e.target.value } : l)} />
              </div>
            </div>
            <div className={styles.field}>
              <label>Observações</label>
              <textarea value={editLead.notes || ''} onChange={e => setEditLead(l => l ? { ...l, notes: e.target.value } : l)} />
            </div>
            <div className={styles.modalActionsSpread}>
              <button className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`} onClick={deleteLead} disabled={saving}>Excluir</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setShowEditLead(false)}>Cancelar</button>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={updateLead} disabled={saving || !editLead.company_name.trim()}>
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
              {stageEdits.map(se => {
                const leadsCount = leads.filter(l => l.stage_id === se.id).length
                return (
                  <div key={se.id} className={styles.stageRow}>
                    <input
                      type="color"
                      className={styles.stageColorInput}
                      value={se.color}
                      onChange={e => setStageEdits(prev => prev.map(s => s.id === se.id ? { ...s, color: e.target.value } : s))}
                    />
                    <input
                      className={styles.stageNameInput}
                      value={se.name}
                      onChange={e => setStageEdits(prev => prev.map(s => s.id === se.id ? { ...s, name: e.target.value } : s))}
                    />
                    <span className={styles.stageLeadCount}>{leadsCount} lead{leadsCount !== 1 ? 's' : ''}</span>
                    <button
                      className={styles.stageDeleteBtn}
                      onClick={() => deleteStage(se.id)}
                      disabled={leadsCount > 0}
                      title={leadsCount > 0 ? 'Mova os leads antes de excluir' : 'Excluir etapa'}
                    >×</button>
                  </div>
                )
              })}
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
