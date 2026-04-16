'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { crmCall, CrmTask, TASK_TYPE_LABELS, TASK_PRIORITY_LABELS } from '@/lib/crm-api'
import styles from './pipeline.module.css'

interface Props {
  leadId: string
}

export default function TaskList({ leadId }: Props) {
  const [tasks, setTasks] = useState<CrmTask[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedTasks, setSelectedTasks] = useState<string[]>([])
  const [form, setForm] = useState({
    title: '',
    task_type: 'follow_up',
    due_date: new Date().toISOString().split('T')[0],
    due_time: '',
    priority: 'normal',
    description: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    const res = await crmCall('crm-manage-tasks', { action: 'list', lead_id: leadId })
    if (!res.error) setTasks(res.tasks || [])
    setLoading(false)
  }, [leadId])

  useEffect(() => { load() }, [load])

  const createTask = async () => {
    if (!form.title.trim() || saving) return
    setSaving(true)
    const res = await crmCall('crm-manage-tasks', {
      action: 'create',
      lead_id: leadId,
      title: form.title,
      task_type: form.task_type,
      due_date: form.due_date,
      due_time: form.due_time || null,
      priority: form.priority,
      description: form.description || null,
    })
    setSaving(false)
    if (!res.error && res.task) {
      setTasks(prev => [...prev, res.task])
      setForm({ title: '', task_type: 'follow_up', due_date: new Date().toISOString().split('T')[0], due_time: '', priority: 'normal', description: '' })
      setShowForm(false)
    }
  }

  const toggleComplete = async (task: CrmTask) => {
    const action = task.status === 'concluida' ? 'reopen' : 'complete'
    const res = await crmCall('crm-manage-tasks', { action, task_id: task.id })
    if (!res.error && res.task) {
      setTasks(prev => prev.map(t => t.id === res.task.id ? res.task : t))
    }
  }

  const deleteTask = async (taskId: string) => {
    if (!confirm('Excluir esta tarefa?')) return
    const res = await crmCall('crm-manage-tasks', { action: 'delete', task_id: taskId })
    if (!res.error) {
      setTasks(prev => prev.filter(t => t.id !== taskId))
      setSelectedTasks(prev => prev.filter(tid => tid !== taskId))
    }
  }

  const toggleSelect = (taskId: string) => {
    setSelectedTasks(prev => prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId])
  }

  const completeSelected = async () => {
    for (const taskId of selectedTasks) {
      const task = tasks.find(t => t.id === taskId)
      if (task && task.status !== 'concluida') {
        const res = await crmCall('crm-manage-tasks', { action: 'complete', task_id: taskId })
        if (!res.error && res.task) setTasks(prev => prev.map(t => t.id === res.task?.id ? res.task! : t))
      }
    }
    setSelectedTasks([])
  }

  const deleteSelected = async () => {
    if (!confirm(`Excluir as ${selectedTasks.length} tarefas selecionadas?`)) return
    for (const taskId of selectedTasks) {
      const res = await crmCall('crm-manage-tasks', { action: 'delete', task_id: taskId })
      if (!res.error) setTasks(prev => prev.filter(t => t.id !== taskId))
    }
    setSelectedTasks([])
  }

  const isOverdue = (task: CrmTask) => {
    if (task.status === 'concluida') return false
    return new Date(task.due_date) < new Date(new Date().toDateString())
  }

  const isToday = (task: CrmTask) => {
    return new Date(task.due_date).toDateString() === new Date().toDateString()
  }

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    const today = new Date()
    if (d.toDateString() === today.toDateString()) return 'Hoje'
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (d.toDateString() === tomorrow.toDateString()) return 'Amanhã'
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  // Sort: overdue first, then by date
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.status === 'concluida' && b.status !== 'concluida') return 1
    if (a.status !== 'concluida' && b.status === 'concluida') return -1
    if (isOverdue(a) && !isOverdue(b)) return -1
    if (!isOverdue(a) && isOverdue(b)) return 1
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
  })

  if (loading) {
    return (
      <div className={styles.timelineEmpty}>
        <div className={styles.timelineSpinner} />
        Carregando tarefas...
      </div>
    )
  }

  return (
    <div className={styles.taskListWrap}>
      {/* Task List */}
      {sortedTasks.length === 0 && !showForm ? (
        <div className={styles.timelineEmpty}>
          <span style={{ fontSize: 32 }}>✅</span>
          <p>Nenhuma tarefa para este lead.</p>
        </div>
      ) : (
        <div className={styles.taskList}>
          {selectedTasks.length > 0 && (
            <div className={styles.bulkActions}>
              <span className={styles.bulkActionsText}>{selectedTasks.length} selecionada{selectedTasks.length > 1 ? 's' : ''}</span>
              <button className={styles.bulkActionBtn} onClick={completeSelected}>Finalizar</button>
              <button className={`${styles.bulkActionBtn} ${styles.bulkActionBtnDanger}`} onClick={deleteSelected}>Excluir</button>
            </div>
          )}
          {sortedTasks.map(task => {
            const typeMeta = TASK_TYPE_LABELS[task.task_type] || { label: task.task_type, icon: '📌' }
            const prioMeta = TASK_PRIORITY_LABELS[task.priority] || TASK_PRIORITY_LABELS.normal
            const overdue = isOverdue(task)
            const today = isToday(task)
            const done = task.status === 'concluida'

            return (
              <div key={task.id} className={`${styles.taskItem} ${overdue ? styles.taskOverdue : ''} ${done ? styles.taskDone : ''}`}>
                <input
                  type="checkbox"
                  className={styles.taskCheckbox}
                  checked={selectedTasks.includes(task.id)}
                  onChange={() => toggleSelect(task.id)}
                  style={{ width: 18, height: 18, cursor: 'pointer', borderRadius: 4 }}
                />
                <div className={styles.taskBody}>
                  <div className={styles.taskTitleRow}>
                    <span className={styles.taskTitle} style={{ textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.5 : 1 }}>
                      {typeMeta.icon} {task.title}
                    </span>
                  </div>
                  <div className={styles.taskMetaRow}>
                    <span className={styles.taskDate} style={{ color: overdue ? '#ef4444' : today ? '#f59e0b' : '#64748b' }}>
                      {overdue ? '⚠ ' : ''}{fmtDate(task.due_date)}{task.due_time ? ` ${task.due_time}` : ''}
                    </span>
                    <span className={styles.taskPrioBadge} style={{ background: `${prioMeta.color}18`, color: prioMeta.color, borderColor: `${prioMeta.color}30` }}>
                      {prioMeta.label}
                    </span>
                    {task.assigned_to_name && (
                      <span className={styles.taskAssignee}>👤 {task.assigned_to_name}</span>
                    )}
                  </div>
                  {task.description && <p className={styles.taskDescription}>{task.description}</p>}
                </div>
                <div className={styles.taskActionsRight}>
                  {!done ? (
                    <button className={styles.taskBtnDone} onClick={() => toggleComplete(task)}>Concluído</button>
                  ) : (
                    <button className={styles.taskBtnReopen} onClick={() => toggleComplete(task)}>Reabrir</button>
                  )}
                  <button className={styles.taskBtnDelete} onClick={() => deleteTask(task.id)}>Excluir</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* New Task Form */}
      {showForm ? (
        <div className={styles.taskForm}>
          <div className={styles.taskFormHeader}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Nova Tarefa</span>
            <button className={styles.taskDeleteBtn} onClick={() => setShowForm(false)}>×</button>
          </div>
          <input
            className={styles.taskFormInput}
            placeholder="O que precisa ser feito?"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            autoFocus
            onKeyDown={e => e.key === 'Enter' && createTask()}
          />
          <div className={styles.taskFormRow}>
            <select className={styles.taskFormSelect} value={form.task_type} onChange={e => setForm(f => ({ ...f, task_type: e.target.value }))}>
              {Object.entries(TASK_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
            <select className={styles.taskFormSelect} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              {Object.entries(TASK_PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.taskFormRow}>
            <input type="date" className={styles.taskFormInput} value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            <input type="time" className={styles.taskFormInput} value={form.due_time} onChange={e => setForm(f => ({ ...f, due_time: e.target.value }))} placeholder="Hora" />
          </div>
          <textarea
            className={styles.taskFormTextarea}
            placeholder="Observação (opcional)"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={2}
          />
          <div className={styles.taskFormActions}>
            <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => setShowForm(false)}>Cancelar</button>
            <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`} onClick={createTask} disabled={saving || !form.title.trim()}>
              {saving ? 'Salvando...' : 'Criar Tarefa'}
            </button>
          </div>
        </div>
      ) : (
        <button className={styles.taskAddBtn} onClick={() => setShowForm(true)}>
          + Nova Tarefa
        </button>
      )}
    </div>
  )
}
