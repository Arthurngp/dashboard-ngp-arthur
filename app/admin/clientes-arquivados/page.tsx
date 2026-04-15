'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import styles from '../contas/contas.module.css'

interface ArchivedClient {
  id: string
  username: string
  nome: string
  meta_account_id: string | null
  foto_url: string | null
  archived_at: string | null
}

function fmtDate(value?: string | null) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

export default function ClientesArquivadosPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [clientes, setClientes] = useState<ArchivedClient[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'admin' && s.role !== 'ngp') { router.replace('/setores'); return }
    setSess(s)
  }, [router])

  const loadData = useCallback(async () => {
    const s = getSession()
    if (!s?.session) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${SURL}/functions/v1/list-archived-clientes`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar clientes arquivados.')
      setClientes(data.clientes || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar clientes arquivados.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (sess) loadData() }, [sess, loadData])

  async function restoreClient(id: string) {
    const s = getSession()
    if (!s?.session) return
    if (!confirm('Restaurar este cliente para a lista principal?')) return
    setSaving(id)
    setError('')
    try {
      const res = await fetch(`${SURL}/functions/v1/archive-cliente`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, action: 'restore', id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao restaurar cliente.')
      setClientes(prev => prev.filter(c => c.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao restaurar cliente.')
    } finally {
      setSaving(null)
    }
  }

  if (!sess) return null

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal />
      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <button className={styles.btnBack} onClick={() => router.push('/setores')}>← Setores</button>
            <div className={styles.eyebrow}>Admin · Configurações</div>
            <h1 className={styles.title}>Clientes Arquivados</h1>
            <p className={styles.subtitle}>Clientes arquivados ficam fora da seleção principal, mas continuam preservados.</p>
          </header>

          {error && <div className={styles.msgErr}>{error}</div>}

          {loading ? (
            <div className={styles.empty}>Carregando...</div>
          ) : clientes.length === 0 ? (
            <div className={styles.empty}>Nenhum cliente arquivado.</div>
          ) : (
            <div className={styles.grid}>
              {clientes.map(cliente => (
                <div key={cliente.id} className={styles.card}>
                  <div className={styles.clienteInfo}>
                    {cliente.foto_url
                      ? <img src={cliente.foto_url} alt={cliente.nome} className={styles.avatar} />
                      : <div className={styles.avatarFallback}>{cliente.nome.slice(0, 2).toUpperCase()}</div>
                    }
                    <div>
                      <div className={styles.clienteNome}>{cliente.nome}</div>
                      <div className={styles.clienteUser}>@{cliente.username}</div>
                      {cliente.meta_account_id && <div className={styles.linked}>Conta: {cliente.meta_account_id}</div>}
                      <div className={styles.clienteUser}>Arquivado em {fmtDate(cliente.archived_at)}</div>
                    </div>
                  </div>
                  <button
                    className={styles.accountBtn}
                    onClick={() => restoreClient(cliente.id)}
                    disabled={saving === cliente.id}
                  >
                    {saving === cliente.id ? 'Restaurando...' : 'Restaurar cliente'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
