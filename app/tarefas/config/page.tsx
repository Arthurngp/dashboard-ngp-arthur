'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { efCall } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import { TaskSetor, TaskSetorPayload } from '@/types/tasks'
import styles from './config.module.css'

const PRESET_COLORS = [
  '#3b82f6', '#0ea5e9', '#06b6d4', '#059669', '#84cc16',
  '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6',
  '#7c3aed', '#64748b',
]

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className={styles.colorPicker}>
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`${styles.colorDot} ${value === c ? styles.colorDotActive : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          title={c}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={styles.colorInput}
        title="Cor personalizada"
      />
    </div>
  )
}

// ── Linha de setor ────────────────────────────────────────────────────────────

function SetorRow({ setor, onSaved, onDeleted }: {
  setor: TaskSetor
  onSaved: () => void
  onDeleted: () => void
}) {
  const [nome, setNome]   = useState(setor.nome)
  const [cor, setCor]     = useState(setor.cor)
  const [ativo, setAtivo] = useState(setor.ativo)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty]   = useState(false)

  function markDirty() { setDirty(true) }

  async function save() {
    setSaving(true)
    try {
      const data = await efCall('tarefas-manage', {
        op: 'setor_update',
        id: setor.id,
        payload: { nome, cor, ativo },
      })
      if (data?.error) throw new Error(String(data.error))
      setDirty(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm(`Excluir o setor "${setor.nome}"? Tarefas vinculadas ficarão sem setor.`)) return
    setSaving(true)
    try {
      const data = await efCall('tarefas-manage', {
        op: 'setor_delete',
        id: setor.id,
      })
      if (data?.error) throw new Error(String(data.error))
      onDeleted()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.setorRow}>
      <div className={styles.setorPreview} style={{ background: cor }} />

      <input
        className={styles.setorNameInput}
        value={nome}
        onChange={(e) => { setNome(e.target.value); markDirty() }}
        placeholder="Nome do setor"
      />

      <ColorPicker value={cor} onChange={(c) => { setCor(c); markDirty() }} />

      <label className={styles.setorToggle}>
        <input
          type="checkbox"
          checked={ativo}
          onChange={(e) => { setAtivo(e.target.checked); markDirty() }}
        />
        <span>{ativo ? 'Ativo' : 'Oculto'}</span>
      </label>

      {dirty && (
        <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`} onClick={save} disabled={saving}>
          {saving ? '...' : 'Salvar'}
        </button>
      )}

      <button className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm} ${styles.btnIcon}`} onClick={remove} disabled={saving} title="Excluir setor">
        ✕
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function TarefasConfigPage() {
  const router = useRouter()
  const sess   = getSession()

  const [setores, setSetores]   = useState<TaskSetor[]>([])
  const [loading, setLoading]   = useState(true)
  const [newNome, setNewNome]   = useState('')
  const [newCor, setNewCor]     = useState('#3b82f6')
  const [adding, setAdding]     = useState(false)
  const [error, setError]       = useState('')

  // guarda admin antes de qualquer render
  useEffect(() => {
    if (!sess || sess.role !== 'admin') {
      router.replace('/tarefas')
    }
  }, [])

  const load = useCallback(async () => {
    const data = await efCall('tarefas-manage', { op: 'setores_list_all' }, { silent: true })
    if (Array.isArray(data?.setores)) setSetores(data.setores as TaskSetor[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function addSetor() {
    if (!newNome.trim()) { setError('Informe um nome.'); return }
    setAdding(true); setError('')
    const maxOrdem = setores.length ? Math.max(...setores.map((s) => s.ordem)) + 1 : 1
    try {
      const data = await efCall('tarefas-manage', {
        op: 'setor_create',
        payload: { nome: newNome.trim(), cor: newCor, ordem: maxOrdem, ativo: true },
      })
      if (data?.error) throw new Error(String(data.error))
      setNewNome(''); setNewCor('#3b82f6')
      await load()
    } catch (e: any) {
      setError(e.message || 'Erro ao adicionar.')
    } finally {
      setAdding(false)
    }
  }

  if (!sess || sess.role !== 'admin') return null

  if (loading) {
    return (
      <div className={styles.layout}>
        <Sidebar showDashboardNav={false} minimal />
        <main className={styles.main}>
          <div className={styles.loadingWrap}><NGPLoading /></div>
        </main>
      </div>
    )
  }

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal />

      <main className={styles.main}>
        <div className={styles.content}>

          {/* Header */}
          <header className={styles.header}>
            <button className={styles.btnBack} onClick={() => router.push('/tarefas')}>← Gestão de Tarefas</button>
            <div className={styles.eyebrow}>Configurações · Gestão de Tarefas</div>
            <h1 className={styles.title}>Cadastro de Setores</h1>
            <p className={styles.subtitle}>
              Gerencie os setores disponíveis para categorização de tarefas. Defina cores exclusivas para facilitar a identificação visual no Kanban.
            </p>
          </header>

          {/* Lista de setores */}
          <div className={styles.configCard}>
            <div className={styles.configCardTitle}>Setores cadastrados</div>
            <p className={styles.configCardDesc}>
              Edite nome e cor diretamente. Setores ocultos não aparecerão nos filtros ou na criação de novas tarefas.
            </p>

            {setores.length === 0 ? (
              <div className={styles.emptyConfig}>Nenhum setor cadastrado ainda.</div>
            ) : (
              <div className={styles.setorList}>
                {setores.map((s) => (
                  <SetorRow key={s.id} setor={s} onSaved={load} onDeleted={load} />
                ))}
              </div>
            )}
          </div>

          {/* Adicionar novo */}
          <div className={styles.configCard}>
            <div className={styles.configCardTitle}>Adicionar novo setor</div>

            {error && <div className={styles.errorBar}>{error}</div>}

            <div className={styles.addSetorRow}>
              <div className={styles.setorPreview} style={{ background: newCor }} />
              <input
                className={styles.setorNameInput}
                value={newNome}
                onChange={(e) => setNewNome(e.target.value)}
                placeholder="Ex: Tráfego Pago, Design, Social Media..."
                onKeyDown={(e) => e.key === 'Enter' && addSetor()}
              />
              <ColorPicker value={newCor} onChange={setNewCor} />
              <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`} onClick={addSetor} disabled={adding}>
                {adding ? 'Adicionando...' : '+ Adicionar Setor'}
              </button>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
