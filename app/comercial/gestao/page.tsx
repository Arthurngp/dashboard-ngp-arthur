'use client'
import React, { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import { getSession } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { crmCall, CrmTask, TASK_TYPE_LABELS, TASK_PRIORITY_LABELS } from '@/lib/crm-api'
import { comercialNav } from '../comercial-nav'
import styles from './gestao.module.css'

export default function GestaoPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<CrmTask[]>([])
  const [allTasks, setAllTasks] = useState<CrmTask[]>([])
  const [filter, setFilter] = useState<'todas' | 'pendente' | 'atrasada' | 'concluida'>('pendente')

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    setSess(s)
  }, [router])

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const allRes = await crmCall('crm-manage-tasks', { action: 'list_team', status: 'todas' })
      const all = (!allRes.error && allRes.tasks) ? allRes.tasks as CrmTask[] : []
      setAllTasks(all)

      let result = all
      if (filter === 'pendente') {
        result = all.filter(t => t.status === 'pendente')
      } else if (filter === 'concluida') {
        result = all.filter(t => t.status === 'concluida')
      } else if (filter === 'atrasada') {
        const today = new Date().toDateString()
        result = all.filter(t => t.status === 'pendente' && new Date(t.due_date) < new Date(today))
      }
      setTasks(result)
    } catch (e) {
      console.error('[gestao] loadTasks error:', e)
      setTasks([])
      setAllTasks([])
    }
    setLoading(false)
  }, [filter])

  useEffect(() => { if (sess) loadTasks() }, [sess, loadTasks])

  const completeTask = async (taskId: string) => {
    const res = await crmCall('crm-manage-tasks', { action: 'complete', task_id: taskId })
    if (!res.error) {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'concluida', completed_at: new Date().toISOString() } : t))
      setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'concluida', completed_at: new Date().toISOString() } : t))
    }
  }

  const isOverdue = (task: CrmTask) => {
    if (task.status === 'concluida') return false
    return new Date(task.due_date) < new Date(new Date().toDateString())
  }

  const isToday = (task: CrmTask) => new Date(task.due_date).toDateString() === new Date().toDateString()

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    const today = new Date()
    if (d.toDateString() === today.toDateString()) return 'Hoje'
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    if (d.toDateString() === tomorrow.toDateString()) return 'Amanhã'
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  // Stats
  const pendingCount = allTasks.filter(t => t.status === 'pendente').length
  const overdueCount = allTasks.filter(t => isOverdue(t)).length
  const todayCount = allTasks.filter(t => isToday(t) && t.status === 'pendente').length
  const doneCount = allTasks.filter(t => t.status === 'concluida').length

  if (!sess) return null

  return (
    <div className={styles.layout}>
      <Sidebar
        minimal={true}
        sectorNavTitle="COMERCIAL"
        sectorNav={comercialNav}
        onTabChange={(tab) => {
          if (tab === 'fields') router.push('/comercial/pipeline?tab=fields')
          else if (tab === 'kanban') router.push('/comercial/pipeline?tab=kanban')
          else if (tab === 'new_pipeline') router.push('/comercial/pipeline?action=new_pipeline')
        }}
      />
      <main className={styles.main}>
        <div className={styles.content}>
          <div className={styles.eyebrow}>SETOR · COMERCIAL</div>
          <h1 className={styles.title}>Gestão de CRM</h1>
          <p className={styles.subtitle}>Visão geral de tarefas e atividades do time comercial.</p>

          {/* Stats Card */}
          <div className={styles.statsCard}>
            <div className={styles.statItem}>
              <div className={styles.statNumber}>{todayCount}</div>
              <div className={styles.statLabel}>PARA HOJE</div>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statItem}>
              <div className={`${styles.statNumber} ${overdueCount > 0 ? styles.statDanger : ''}`}>{overdueCount}</div>
              <div className={styles.statLabel}>ATRASADAS</div>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statItem}>
              <div className={styles.statNumber}>{pendingCount}</div>
              <div className={styles.statLabel}>PENDENTES</div>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statItem}>
              <div className={`${styles.statNumber} ${styles.statSuccess}`}>{doneCount}</div>
              <div className={styles.statLabel}>CONCLUÍDAS</div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className={styles.filterRow}>
            {[
              { key: 'pendente', label: 'Pendentes' },
              { key: 'atrasada', label: 'Atrasadas' },
              { key: 'concluida', label: 'Concluídas' },
              { key: 'todas', label: 'Todas' },
            ].map(f => (
              <button
                key={f.key}
                className={`${styles.filterBtn} ${filter === f.key ? styles.filterBtnActive : ''}`}
                onClick={() => setFilter(f.key as any)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Task List */}
          <div className={styles.taskListWrap}>
            {loading ? (
              <div className={styles.emptyState}>
                <div className={styles.spinner} />
                <p>Carregando tarefas...</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className={styles.emptyState}>
                <p className={styles.emptyTitle}>Nenhuma tarefa encontrada</p>
                <p className={styles.emptyDesc}>Crie tarefas nos leads do pipeline para vê-las aqui.</p>
              </div>
            ) : (
              tasks.map(task => {
                const typeMeta = TASK_TYPE_LABELS[task.task_type] || { label: task.task_type, icon: '' }
                const prioMeta = TASK_PRIORITY_LABELS[task.priority] || TASK_PRIORITY_LABELS.normal
                const overdue = isOverdue(task)
                const today = isToday(task)
                const done = task.status === 'concluida'

                return (
                  <div key={task.id} className={`${styles.taskItem} ${overdue ? styles.taskOverdue : ''} ${done ? styles.taskDone : ''}`}>
                    <button
                      className={`${styles.taskCheckbox} ${done ? styles.taskCheckboxDone : ''}`}
                      onClick={() => !done && completeTask(task.id)}
                      title={done ? 'Concluída' : 'Marcar como concluída'}
                    >
                      {done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                    </button>
                    <div className={styles.taskBody}>
                      <div className={styles.taskTitleRow}>
                        <span className={styles.taskTitle} style={{ textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.45 : 1 }}>
                          {task.title}
                        </span>
                        {task.lead_company_name && (
                          <span className={styles.taskLeadBadge}>{task.lead_company_name}</span>
                        )}
                      </div>
                      <div className={styles.taskMetaRow}>
                        <span className={styles.taskType}>{typeMeta.label}</span>
                        <span className={styles.taskDot}>·</span>
                        <span className={styles.taskDate} style={{ color: overdue ? '#dc2626' : today ? '#d97706' : '#6B7280' }}>
                          {overdue ? 'Atrasada · ' : ''}{fmtDate(task.due_date)}{task.due_time ? ` às ${task.due_time}` : ''}
                        </span>
                        <span className={styles.taskDot}>·</span>
                        <span className={styles.taskPrio} style={{ color: prioMeta.color }}>
                          {prioMeta.label}
                        </span>
                        {task.assigned_to_name && (
                          <>
                            <span className={styles.taskDot}>·</span>
                            <span className={styles.taskAssignee}>{task.assigned_to_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
