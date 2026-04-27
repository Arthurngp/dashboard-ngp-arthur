'use client'

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'
import { efHeaders, efCall } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import styles from './tarefas.module.css'
import {
  Task, TaskStatus, TaskPriority, TaskSetor,
  TaskAssignee, TaskCliente, TaskFilters,
  TaskCreatePayload,
  TASK_STATUS_META, TASK_PRIORITY_META, TASK_COLUMNS,
} from '@/types/tasks'

const Ico = ({
  children,
  fill = 'none',
  stroke = 'currentColor',
  strokeWidth = '2',
}: {
  children: React.ReactNode
  fill?: string
  stroke?: string
  strokeWidth?: string
}) => (
  <svg
    viewBox="0 0 24 24"
    fill={fill}
    stroke={stroke}
    strokeWidth={strokeWidth}
    width={15}
    height={15}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

function ListsGrid({ tasks, setores, onSelect, onAdd }: { tasks: Task[]; setores: TaskSetor[]; onSelect: (id: string) => void; onAdd: () => void }) {
  const statsBySetor = useMemo(() => {
    const map: Record<string, { total: number; pending: number; done: number }> = {}
    setores.forEach(s => { map[s.id] = { total: 0, pending: 0, done: 0 } })
    tasks.forEach(t => {
      if (!t.setor_id || !map[t.setor_id]) return
      map[t.setor_id].total++
      if (t.status === 'done') map[t.setor_id].done++
      else map[t.setor_id].pending++
    })
    return map
  }, [tasks, setores])

  return (
    <div className={styles.folderDashboard}>
      <div className={styles.folderGrid}>
        {setores.map(s => {
          const stats = statsBySetor[s.id] || { total: 0, pending: 0, done: 0 }
          return (
            <div key={s.id} className={styles.listCard} onClick={() => onSelect(s.id)}>
              <div className={styles.listCardHead}>
                <div style={{ background: s.cor, width: 12, height: 12, borderRadius: '50%' }} />
                <span className={styles.listCardTitle}>{s.nome}</span>
                <span className={styles.clientChevron}>›</span>
              </div>
              <div className={styles.listCardStats}>
                <div className={styles.listStat}>
                  <span className={styles.listStatLabel}>Total</span>
                  <span className={styles.listStatValue}>{stats.total}</span>
                </div>
                <div className={styles.listStat}>
                  <span className={styles.listStatLabel}>Pendentes</span>
                  <span className={styles.listStatValue} style={{ color: '#3b82f6' }}>{stats.pending}</span>
                </div>
                <div className={styles.listStat}>
                  <span className={styles.listStatLabel}>Concluídas</span>
                  <span className={styles.listStatValue} style={{ color: '#10b981' }}>{stats.done}</span>
                </div>
              </div>
            </div>
          )
        })}

        {/* Card de Adição de Lista */}
        <div className={styles.addListCard} onClick={onAdd}>
          <div className={styles.addListIcon}>+</div>
          <div className={styles.addListLabel}>Nova Lista</div>
        </div>
      </div>
    </div>
  )
}

function QuickSectorModal({ onClose, onSaved, clientId }: { onClose: () => void; onSaved: () => void; clientId?: string }) {
  const [nome, setNome] = useState('')
  const [cor, setCor] = useState('#3b82f6')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b']

  async function handleSave() {
    if (!nome.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`${SURL}/rest/v1/task_setores`, {
        method: 'POST',
        headers: { ...efHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({ 
          nome: nome.trim(), 
          cor: cor, 
          ordem: 99,
          ativo: true,
          client_id: clientId // Vincula a lista ao cliente atual
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message || 'Erro ao salvar setor.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div className={styles.modalTitle}>Configuração da Lista</div>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.modalSection}>
            <label className={styles.modalLabel}>Nome da Lista</label>
            <input
              autoFocus
              className={styles.modalInput}
              placeholder="Ex: Tráfego, Criativos, Atendimento..."
              value={nome}
              onChange={e => setNome(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>

          <div className={styles.modalSection}>
            <label className={styles.modalLabel}>Cor de Identificação</label>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setCor(c)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: c,
                    border: cor === c ? '3px solid #000' : 'none',
                    cursor: 'pointer',
                    transition: 'transform 0.2s',
                    transform: cor === c ? 'scale(1.1)' : 'scale(1)'
                  }}
                />
              ))}
            </div>
          </div>

          <p style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>
            Esta lista ficará disponível em todas as pastas de clientes para organização de tarefas.
          </p>
          
          {error && <div style={{ color: '#ef4444', fontSize: '14px', fontWeight: 600 }}>{error}</div>}
        </div>
        <div className={styles.modalFoot}>
          <button className={styles.modalBtnCancel} onClick={onClose}>Cancelar</button>
          <button className={styles.modalBtnSave} onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Criar Lista de Tarefas'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDueDate(iso: string | null): { label: string; overdue: boolean } {
  if (!iso) return { label: '', overdue: false }
  const d   = new Date(iso)
  const now = new Date()
  return {
    label:   d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    overdue: d < now,
  }
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority Badge
// ─────────────────────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const m = TASK_PRIORITY_META[priority]
  return (
    <span className={styles.priorityBadge} style={{ color: m.color, background: m.bg, borderColor: m.border }}>
      {m.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Clients Overview (Painel Global)
// ─────────────────────────────────────────────────────────────────────────────

function ClientsOverview({ clientes, allTasks, onSelect }: {
  clientes: TaskCliente[]
  allTasks: Task[]
  onSelect: (id: string) => void
}) {
  const statsByClient = useMemo(() => {
    const map: Record<string, { total: number; pending: number; overdue: number }> = {}
    
    // Inicializa mapa para garantir que todos os clientes apareçam
    clientes.forEach(c => map[c.id] = { total: 0, pending: 0, overdue: 0 })
    
    const now = new Date()
    allTasks.forEach(t => {
      if (!t.client_id || !map[t.client_id]) return
      const s = map[t.client_id]
      s.total++
      if (t.status !== 'done') {
        s.pending++
        if (t.due_date && new Date(t.due_date) < now) s.overdue++
      }
    })
    return map
  }, [clientes, allTasks])

  if (clientes.length === 0) {
    return <div className={styles.emptyState}>Nenhum cliente cadastrado no sistema.</div>
  }

  return (
    <div className={styles.clientsGrid}>
      {clientes.map(c => {
        const s = statsByClient[c.id] || { total: 0, pending: 0, overdue: 0 }
        return (
          <div key={c.id} className={styles.clientCard} onClick={() => onSelect(c.id)}>
            <div className={styles.clientCardHead}>
              <div className={styles.clientAvatar}>
                {c.foto_url ? <img src={c.foto_url} alt={c.nome} /> : initials(c.nome)}
              </div>
              <div className={styles.clientInfo}>
                <div className={styles.clientName}>{c.nome}</div>
                <div className={styles.clientUsername}>@{c.username}</div>
              </div>
              <div className={styles.clientChevron}>›</div>
            </div>
            
            <div className={styles.clientStats}>
              <div className={styles.clientStat}>
                <span className={styles.statLabel}>Total</span>
                <span className={styles.statValue}>{s.total}</span>
              </div>
              <div className={styles.clientStat}>
                <span className={styles.statLabel}>Pendentes</span>
                <span className={styles.statValue} style={{ color: '#3b82f6' }}>{s.pending}</span>
              </div>
              <div className={styles.clientStat}>
                <span className={styles.statLabel}>Atrasadas</span>
                <span className={styles.statValue} style={{ color: s.overdue > 0 ? '#dc2626' : '#94a3b8' }}>{s.overdue}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// List View
// ─────────────────────────────────────────────────────────────────────────────

function ListView({ tasks, onEdit, onAddClick, onDelete, colaboradores, onInlineSave }: { 
  tasks: Task[], 
  onEdit: (t: Task) => void, 
  onAddClick: (s: TaskStatus) => void,
  onDelete: (id: string) => void,
  colaboradores: TaskAssignee[],
  onInlineSave: (name: string, status: TaskStatus) => Promise<void>
}) {
  const [inlineAdding, setInlineAdding] = useState<TaskStatus | null>(null)
  const [inlineName, setInlineName] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent, status: TaskStatus) {
    e.preventDefault()
    if (!inlineName.trim() || saving) return
    setSaving(true)
    try {
      await onInlineSave(inlineName.trim(), status)
      setInlineName('')
      setInlineAdding(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.listView}>
      {TASK_COLUMNS.map((status) => {
        const statusTasks = tasks.filter((t) => t.status === status)
        const meta = TASK_STATUS_META[status]
        const color = COLUMN_DOT[status]

        return (
          <div key={status} className={styles.listGroup}>
            <div className={styles.listGroupHeader}>
              <span className={styles.listGroupToggle}>▾</span>
              <span className={styles.listGroupBadge} style={{ background: color }}>
                {meta.label.toUpperCase()}
              </span>
              <span className={styles.listGroupCount}>{statusTasks.length}</span>
            </div>

            <div className={styles.listTable}>
              <div className={styles.listTableHeader}>
                <div className={styles.colName}>NOME</div>
                <div className={styles.colStatus}>STATUS</div>
                <div className={styles.colUser}>RESPONSÁVEL</div>
                <div className={styles.colDate}>PRAZO</div>
                <div className={styles.colPriority}>PRIORIDADE</div>
              </div>

              {statusTasks.map((t) => {
                const { label, overdue } = formatDueDate(t.due_date)
                return (
                  <div key={t.id} className={styles.listRow} onClick={() => onEdit(t)}>
                    <div className={styles.colName}>
                      <div className={styles.listRowDot} style={{ background: color }} />
                      {t.title}
                    </div>
                    <div className={styles.colStatus}>
                      <span className={styles.miniStatus} style={{ background: meta.bg, color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                    <div className={styles.colUser}>
                      {t.assignee ? (
                        <div className={styles.miniUser}>
                          <div className={styles.miniAvatar}>
                            {t.assignee.foto_url ? <img src={t.assignee.foto_url} /> : initials(t.assignee.nome)}
                          </div>
                          {t.assignee.nome.split(' ')[0]}
                        </div>
                      ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </div>
                    <div className={`${styles.colDate} ${overdue ? styles.overdueText : ''}`}>
                      {label || '—'}
                    </div>
                    <div className={styles.colPriority}>
                      <PriorityBadge priority={t.priority} />
                    </div>
                    <button className={styles.rowDelete} onClick={(e) => { e.stopPropagation(); onDelete(t.id) }}>×</button>
                  </div>
                )
              })}

              {inlineAdding === status ? (
                <form className={`${styles.listRow} ${styles.listRowAdding}`} onSubmit={(e) => handleSubmit(e, status)}>
                  <div className={styles.colName}>
                    <div className={styles.listRowDot} style={{ background: color, opacity: 0.5 }} />
                    <input
                      autoFocus
                      className={styles.inlineInput}
                      placeholder="Nome da tarefa..."
                      value={inlineName}
                      onChange={e => setInlineName(e.target.value)}
                      onBlur={() => !inlineName && setInlineAdding(null)}
                      onKeyDown={e => e.key === 'Escape' && setInlineAdding(null)}
                      disabled={saving}
                    />
                  </div>
                  <div className={styles.colActions}>
                    <button type="button" className={styles.inlineCancel} onClick={() => setInlineAdding(null)}>Cancelar</button>
                    <button type="submit" className={styles.inlineSave} disabled={!inlineName.trim() || saving}>
                      {saving ? '...' : 'Salvar ↵'}
                    </button>
                  </div>
                </form>
              ) : (
                <button className={styles.listAddBtn} onClick={() => { setInlineAdding(status); setInlineName('') }}>
                  + Adicionar Tarefa
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Card
// ─────────────────────────────────────────────────────────────────────────────

function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const { label: dueDateLabel, overdue } = formatDueDate(task.due_date)

  return (
    <div className={styles.taskCard} onClick={onClick}>
      {/* setor badge */}
      {task.setor && (
        <div className={styles.taskSetorBadge} style={{ background: task.setor.cor + '18', color: task.setor.cor, borderColor: task.setor.cor + '40' }}>
          {task.setor.nome}
        </div>
      )}

      <div className={styles.taskTitle}>{task.title}</div>

      {/* cliente */}
      {task.cliente && (
        <div className={styles.taskCliente}>{task.cliente.nome}</div>
      )}

      <div className={styles.taskMeta}>
        <PriorityBadge priority={task.priority} />
      </div>

      <div className={styles.taskFooter}>
        {task.assignee ? (
          <div className={styles.assignee}>
            <div className={styles.avatar}>
              {task.assignee.foto_url
                ? <img src={task.assignee.foto_url} alt={task.assignee.nome} className={styles.avatarImg} />
                : initials(task.assignee.nome)}
            </div>
            <span className={styles.assigneeName}>{task.assignee.nome.split(' ')[0]}</span>
          </div>
        ) : (
          <span className={styles.assigneeName} style={{ color: '#cbd5e1' }}>Sem responsável</span>
        )}
        {dueDateLabel && (
          <span className={`${styles.dueDate} ${overdue ? styles.dueDateOverdue : ''}`}>
            {overdue ? '⚠ ' : ''}{dueDateLabel}
          </span>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Kanban Column
// ─────────────────────────────────────────────────────────────────────────────

const COLUMN_DOT: Record<TaskStatus, string> = {
  backlog: '#94a3b8', todo: '#0f172a', doing: '#3b82f6', review: '#7c3aed', done: '#16a34a',
}

function KanbanColumn({ status, tasks, onCardClick, onAddClick }: {
  status: TaskStatus; tasks: Task[]
  onCardClick: (t: Task) => void; onAddClick: (s: TaskStatus) => void
}) {
  const meta = TASK_STATUS_META[status]
  return (
    <div className={styles.column}>
      <div className={styles.columnHeader}>
        <span className={styles.columnDot} style={{ background: COLUMN_DOT[status] }} />
        <span className={styles.columnName}>{meta.label}</span>
        <span className={styles.columnCount}>{tasks.length}</span>
      </div>
      <div className={styles.columnBody}>
        {tasks.map((t) => <TaskCard key={t.id} task={t} onClick={() => onCardClick(t)} />)}
        <button className={styles.emptyColumn} onClick={() => onAddClick(status)}>+ Nova tarefa</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Cards
// ─────────────────────────────────────────────────────────────────────────────

function KpiCards({ tasks }: { tasks: Task[] }) {
  const now      = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const total    = tasks.length
  const overdue  = tasks.filter((t) => t.due_date && new Date(t.due_date) < now && t.status !== 'done').length
  const today    = tasks.filter((t) => t.due_date && t.due_date.slice(0, 10) === todayStr && t.status !== 'done').length
  const done     = tasks.filter((t) => t.status === 'done').length

  return (
    <div className={styles.kpiRow}>
      <div className={styles.kpiCard}>
        <span className={styles.kpiLabel}>Total</span>
        <span className={styles.kpiValue}>{total}</span>
        <span className={styles.kpiSub}>tarefas filtradas</span>
      </div>
      <div className={`${styles.kpiCard} ${styles.kpiCardAlert}`}>
        <span className={styles.kpiLabel}>Atrasadas</span>
        <span className={styles.kpiValue}>{overdue}</span>
        <span className={styles.kpiSub}>passaram do prazo</span>
      </div>
      <div className={`${styles.kpiCard} ${styles.kpiCardToday}`}>
        <span className={styles.kpiLabel}>Vencem hoje</span>
        <span className={styles.kpiValue}>{today}</span>
        <span className={styles.kpiSub}>entregáveis do dia</span>
      </div>
      <div className={`${styles.kpiCard} ${styles.kpiCardDone}`}>
        <span className={styles.kpiLabel}>Concluídas</span>
        <span className={styles.kpiValue}>{done}</span>
        <span className={styles.kpiSub}>de {total} tarefas</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter Bar
// ─────────────────────────────────────────────────────────────────────────────

function CustomSelect({ 
  label, 
  value, 
  options, 
  placeholder, 
  onChange 
}: { 
  label: string; 
  value: string; 
  options: { id: string; nome: string }[]; 
  placeholder: string;
  onChange: (val: string) => void 
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = options.find(o => o.id === value)

  return (
    <div className={styles.customSelectContainer} ref={containerRef}>
      <button 
        type="button" 
        className={styles.customSelectTrigger} 
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={styles.customSelectLabel}>{label}</span>
        <div className={styles.customSelectValueRow}>
          <span className={styles.customSelectValue}>{selectedOption ? selectedOption.nome : placeholder}</span>
          <span className={`${styles.customSelectChevron} ${isOpen ? styles.customSelectChevronOpen : ''}`}>
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
        </div>
      </button>

      {isOpen && (
        <div className={styles.customSelectDropdown}>
          <div 
            className={`${styles.customSelectItem} ${!value ? styles.customSelectItemActive : ''}`}
            onClick={() => { onChange(''); setIsOpen(false); }}
          >
            <span>{placeholder}</span>
            {!value && <span className={styles.customSelectCheck}>✓</span>}
          </div>
          {options.map(opt => (
            <div 
              key={opt.id}
              className={`${styles.customSelectItem} ${value === opt.id ? styles.customSelectItemActive : ''}`}
              onClick={() => { onChange(opt.id); setIsOpen(false); }}
            >
              <span>{opt.nome}</span>
              {value === opt.id && <span className={styles.customSelectCheck}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterBar({ filters, clientes, setores, colaboradores, onChange, onClear }: {
  filters: TaskFilters
  clientes: TaskCliente[]
  setores: TaskSetor[]
  colaboradores: TaskAssignee[]
  onChange: (f: Partial<TaskFilters>) => void
  onClear: () => void
}) {
  const hasActive = !!(filters.client_id || filters.setor_id || filters.assigned_to || filters.status || filters.search)

  return (
    <div className={styles.filterBar}>
      <div className={styles.filterLeft}>
        <div className={styles.searchInputWrapper}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input 
            className={styles.searchInput}
            placeholder="Buscar tarefa..."
            value={filters.search || ''}
            onChange={(e) => onChange({ search: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.filterRight}>
        {!filters.client_id && (
          <CustomSelect
            label="FILTRAR POR CLIENTE"
            placeholder="Todos os clientes"
            value={filters.client_id || ''}
            options={clientes.map(c => ({ id: c.id, nome: c.nome }))}
            onChange={(val) => onChange({ client_id: val || undefined })}
          />
        )}

        <CustomSelect
          label="FILTRAR POR SETOR"
          placeholder="Todos os setores"
          value={filters.setor_id || ''}
          options={setores.map(s => ({ id: s.id, nome: s.nome }))}
          onChange={(val) => onChange({ setor_id: val || undefined })}
        />

        <CustomSelect
          label="RESPONSÁVEL"
          placeholder="Todos os responsáveis"
          value={filters.assigned_to || ''}
          options={colaboradores.map(c => ({ id: c.id, nome: c.nome }))}
          onChange={(val) => onChange({ assigned_to: val || undefined })}
        />

        <CustomSelect
          label="STATUS"
          placeholder="Todos os status"
          value={filters.status || ''}
          options={TASK_COLUMNS.map(s => ({ id: s, nome: TASK_STATUS_META[s].label }))}
          onChange={(val) => onChange({ status: (val as TaskStatus) || undefined })}
        />

        {hasActive && (
          <button className={styles.clearBtn} onClick={onClear} title="Limpar filtros">
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal Criar / Editar
// ─────────────────────────────────────────────────────────────────────────────

function TaskModal({ initialStatus = 'todo', initialClientId, initialSetorId, editTask, colaboradores, clientes, setores, onClose, onSaved }: {
  initialStatus?: TaskStatus
  initialClientId?: string
  initialSetorId?: string
  editTask?: Task | null
  colaboradores: TaskAssignee[]
  clientes: TaskCliente[]
  setores: TaskSetor[]
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle]           = useState(editTask?.title ?? '')
  const [description, setDesc]      = useState(editTask?.description ?? '')
  const [status, setStatus]         = useState<TaskStatus>(editTask?.status ?? initialStatus)
  const [priority, setPriority]     = useState<TaskPriority>(editTask?.priority ?? 'medium')
  const [assignedTo, setAssignedTo] = useState(editTask?.assigned_to ?? '')
  const [clientId, setClientId]     = useState(editTask?.client_id ?? initialClientId ?? '')
  const [setorId, setSetorId]       = useState(editTask?.setor_id ?? initialSetorId ?? '')
  const [dueDate, setDueDate]       = useState(editTask?.due_date ? editTask.due_date.slice(0, 10) : '')
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  async function handleSave() {
    if (!title.trim()) { setError('O título é obrigatório.'); return }
    setSaving(true); setError('')
    const sess = getSession()
    if (!sess) { setError('Sessão expirada.'); setSaving(false); return }

    const payload: Record<string, unknown> = {
      title:       title.trim(),
      description: description.trim() || null,
      status, priority,
      assigned_to: assignedTo && assignedTo !== "" ? assignedTo : null,
      client_id:   clientId && clientId !== "" ? clientId : null,
      setor_id:    setorId && setorId !== "" ? setorId : null,
      due_date:    dueDate ? new Date(dueDate).toISOString() : null,
    }

    try {
      const method = editTask ? 'PATCH' : 'POST'
      const url    = editTask
        ? `${SURL}/rest/v1/tasks?id=eq.${editTask.id}`
        : `${SURL}/rest/v1/tasks`

      const res = await fetch(url, {
        method,
        headers: { ...efHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await res.text())
      onSaved(); onClose()
    } catch (e: any) {
      setError(e.message || 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editTask || !confirm('Excluir esta tarefa?')) return
    setSaving(true)
    try {
      const res = await fetch(`${SURL}/rest/v1/tasks?id=eq.${editTask.id}`, { method: 'DELETE', headers: efHeaders() })
      if (!res.ok) throw new Error(await res.text())
      onSaved(); onClose()
    } catch (e: any) {
      setError(e.message || 'Erro ao excluir.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>{editTask ? 'Editar tarefa' : 'Nova tarefa'}</h2>
        {error && <div className={styles.errorBar}>{error}</div>}

        <div className={styles.field}>
          <label>Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Preparar apresentação do cliente" autoFocus />
        </div>

        <div className={styles.field}>
          <label>Descrição</label>
          <textarea value={description} onChange={(e) => setDesc(e.target.value)} placeholder="Detalhes opcionais..." />
        </div>

        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label>Cliente</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Interno / sem cliente</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label>Setor</label>
            <select value={setorId} onChange={(e) => setSetorId(e.target.value)}>
              <option value="">Sem setor</option>
              {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {TASK_COLUMNS.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s].label}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label>Prioridade</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {(['low', 'medium', 'high'] as TaskPriority[]).map((p) => (
                <option key={p} value={p}>{TASK_PRIORITY_META[p].label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label>Responsável</label>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Sem responsável</option>
              {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label>Data de entrega</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: editTask ? 'space-between' : 'flex-end', gap: 10, marginTop: 4 }}>
          {editTask && (
            <button className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`} onClick={handleDelete} disabled={saving}>Excluir</button>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={onClose} disabled={saving}>Cancelar</button>
            <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`} onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : editTask ? 'Salvar' : 'Criar tarefa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

function TarefasContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const sess         = getSession()
  const isAdmin      = sess?.role === 'admin'

  const [allTasks, setAllTasks]           = useState<Task[]>([])
  const [colaboradores, setColaboradores] = useState<TaskAssignee[]>([])
  const [clientes, setClientes]           = useState<TaskCliente[]>([])
  const [setores, setSetores]             = useState<TaskSetor[]>([])
  const [loading, setLoading]             = useState(true)
  const [modalOpen, setModalOpen]         = useState(false)
  const [initialClientId, setInitialClientId] = useState<string | undefined>()
  const [initialSetorId, setInitialSetorId]   = useState<string | undefined>()
  const [initialStatus, setInitialStatus]     = useState<TaskStatus>('todo')
  const [editTask, setEditTask]           = useState<Task | null>(null)
  const [showQuickSector, setShowQuickSector] = useState(false)
  const [viewMode, setViewMode]           = useState<'kanban' | 'list'>('kanban')

  // filtros lidos da URL
  const [filters, setFilters] = useState<TaskFilters>({
    client_id:   searchParams.get('client_id')   || undefined,
    setor_id:    searchParams.get('setor_id')    || undefined,
    assigned_to: searchParams.get('assigned_to') || undefined,
    status:      (searchParams.get('status') as TaskStatus) || undefined,
    search:      searchParams.get('search')      || undefined,
  })

  // persiste filtros na URL
  function applyFilter(patch: Partial<TaskFilters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    const params = new URLSearchParams()
    if (next.client_id)   params.set('client_id',   next.client_id)
    if (next.setor_id)    params.set('setor_id',    next.setor_id)
    if (next.assigned_to) params.set('assigned_to', next.assigned_to)
    if (next.status)      params.set('status',      next.status)
    if (next.search)      params.set('search',      next.search)
    router.replace(`/tarefas${params.size ? '?' + params.toString() : ''}`)
  }

  function clearFilters() {
    setFilters({})
    router.replace('/tarefas')
  }

  const loadData = useCallback(async () => {
    const s = getSession()
    if (!s) return
    const h = efHeaders()

    const [tasksRes, colabRes, ngpData, setoresRes] = await Promise.all([
      fetch(
        `${SURL}/rest/v1/tasks?select=*,assignee:usuarios!tasks_assigned_to_fkey(id,nome,foto_url),cliente:usuarios!tasks_client_id_fkey(id,nome,username,foto_url),setor:task_setores(id,nome,cor,ordem,ativo)&order=created_at.desc`,
        { headers: h }
      ),
      fetch(`${SURL}/rest/v1/usuarios?select=id,nome,foto_url&order=nome.asc`, { headers: h }),
      efCall('get-ngp-data'),
      fetch(`${SURL}/rest/v1/task_setores?select=*&ativo=eq.true${filters.client_id ? `&client_id=eq.${filters.client_id}` : '&client_id=is.null'}&order=ordem.asc`, { headers: h }),
    ])

    if (tasksRes.ok) setAllTasks(await tasksRes.json())
    if (colabRes.ok) setColaboradores(await colabRes.json())
    if (ngpData?.clientes) setClientes(ngpData.clientes as any[])
    if (setoresRes.ok) setSetores(await setoresRes.json())
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // aplica filtros client-side (sem nova query)
  const filteredTasks = useMemo(() => {
    return allTasks.filter((t) => {
      if (filters.client_id   && t.client_id   !== filters.client_id)   return false
      if (filters.setor_id    && t.setor_id    !== filters.setor_id)    return false
      if (filters.assigned_to && t.assigned_to !== filters.assigned_to) return false
      if (filters.status      && t.status      !== filters.status)      return false
      if (filters.search      && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false
      return true
    })
  }, [allTasks, filters])

  const sectorNav = useMemo(() => setores.map(s => ({
    icon: <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.cor }} />,
    label: s.nome,
    href: `/tarefas?setor_id=${s.id}${filters.client_id ? `&client_id=${filters.client_id}` : ''}`
  })), [setores, filters.client_id])

  function openCreate(status: TaskStatus, setorId?: string) {
    setInitialStatus(status)
    setEditTask(null)
    setModalOpen(true)
    if (filters.client_id) setInitialClientId(filters.client_id)
    else setInitialClientId(undefined)
    if (setorId) setInitialSetorId(setorId)
    else if (filters.setor_id) setInitialSetorId(filters.setor_id)
    else setInitialSetorId(undefined)
  }
  function openEdit(task: Task) {
    setEditTask(task); setModalOpen(true)
  }

  const isFolderDashboard = !!filters.client_id && !filters.setor_id

  async function handleInlineSave(title: string, status: TaskStatus) {
    const payload = {
      title,
      status,
      client_id: filters.client_id || null,
      setor_id: filters.setor_id || null,
      priority: 'medium',
      ativo: true
    }

    try {
      const res = await fetch(`${SURL}/rest/v1/tasks`, {
        method: 'POST',
        headers: { ...efHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      })
      
      if (!res.ok) {
        const errText = await res.text()
        console.error('Erro DB:', errText)
        alert('Erro ao salvar no banco: ' + errText)
        return
      }
      
      await loadData()
    } catch (err) {
      console.error('Erro conexão:', err)
      alert('Erro de conexão ao salvar tarefa.')
    }
  }

  async function handleDeleteTask(id: string) {
    if (!confirm('Excluir tarefa?')) return
    await fetch(`${SURL}/rest/v1/tasks?id=eq.${id}`, { method: 'DELETE', headers: efHeaders() })
    await loadData()
  }

  if (loading) {
    return (
      <div className={styles.layout}>
        <Sidebar />
        <main className={styles.main}>
          <div className={styles.loadingWrap}><NGPLoading /></div>
        </main>
      </div>
    )
  }

  return (
    <div className={styles.layout}>
      <Sidebar 
        activeTab="tarefas" 
        sectorNav={sectorNav}
        sectorNavTitle="Listas de Tarefas"
      />

      <main className={styles.main}>
        <div className={styles.content}>

          {/* Header */}
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <span className={styles.eyebrow}>
                {filters.client_id ? `PASTA DO CLIENTE` : 'NGP Space'}
              </span>
              <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {filters.client_id ? (
                  <>
                    <span 
                      style={{ cursor: 'pointer', color: '#64748b' }} 
                      onClick={() => applyFilter({ setor_id: undefined })}
                    >
                      {clientes.find(c => c.id === filters.client_id)?.nome || 'Cliente'}
                    </span>
                    {filters.setor_id && (
                      <>
                        <span style={{ color: '#cbd5e1', fontSize: '20px' }}>/</span>
                        <span>{setores.find(s => s.id === filters.setor_id)?.nome || 'Lista'}</span>
                      </>
                    )}
                  </>
                ) : 'Gestão de Tarefas'}
              </h1>
            </div>
            <div className={styles.headerRight}>
              {isAdmin && (
                <button
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={() => router.push('/tarefas/config')}
                >
                  ⚙ Configurar setores
                </button>
              )}
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => openCreate('todo')}
              >
                + Nova tarefa
              </button>
            </div>
          </div>

          {/* Conteúdo Contextual */}
          {loading ? (
            <div className={styles.loadingWrap}><NGPLoading /></div>
          ) : !filters.client_id ? (
            <ClientsOverview 
              clientes={clientes} 
              allTasks={allTasks} 
              onSelect={(id) => applyFilter({ client_id: id })} 
            />
          ) : isFolderDashboard ? (
            <ListsGrid 
              tasks={filteredTasks} 
              setores={setores} 
              onSelect={(id) => applyFilter({ ...filters, setor_id: id })}
              onAdd={() => setShowQuickSector(true)}
            />
          ) : (
            <>
              {/* KPIs */}
              <KpiCards tasks={filteredTasks} />

              {/* View Switcher (ClickUp Style) */}
              <div className={styles.viewSwitcher}>
                <button 
                  className={`${styles.viewBtn} ${viewMode === 'kanban' ? styles.viewBtnActive : ''}`}
                  onClick={() => setViewMode('kanban')}
                >
                  <Ico><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></Ico>
                  Quadro (Kanban)
                </button>
                <button 
                  className={`${styles.viewBtn} ${viewMode === 'list' ? styles.viewBtnActive : ''}`}
                  onClick={() => setViewMode('list')}
                >
                  <Ico><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></Ico>
                  Lista
                </button>
              </div>

              {/* Filtros */}
              <FilterBar
                filters={filters}
                clientes={clientes}
                setores={setores}
                colaboradores={colaboradores}
                onChange={applyFilter}
                onClear={clearFilters}
              />

              {/* Quadro ou Lista */}
              {viewMode === 'kanban' ? (
                <div className={styles.board}>
                  {TASK_COLUMNS.map((col) => (
                    <KanbanColumn
                      key={col}
                      status={col}
                      tasks={filteredTasks.filter((t) => t.status === col)}
                      onCardClick={openEdit}
                      onAddClick={openCreate}
                    />
                  ))}
                </div>
              ) : (
                <ListView
                  tasks={filteredTasks}
                  onEdit={openEdit}
                  onAddClick={openCreate}
                  onDelete={handleDeleteTask}
                  colaboradores={colaboradores}
                  onInlineSave={handleInlineSave}
                />
              )}
            </>
          )}

        </div>
      </main>

      {modalOpen && (
        <TaskModal
          initialStatus={initialStatus}
          initialClientId={initialClientId}
          initialSetorId={initialSetorId}
          editTask={editTask}
          colaboradores={colaboradores}
          clientes={clientes}
          setores={setores}
          onClose={() => setModalOpen(false)}
          onSaved={loadData}
        />
      )}

      {showQuickSector && (
        <QuickSectorModal
          onClose={() => setShowQuickSector(false)}
          clientId={filters.client_id}
          onSaved={() => {
            loadData()
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

export default function TarefasPage() {
  return (
    <Suspense fallback={<NGPLoading />}>
      <TarefasContent />
    </Suspense>
  )
}