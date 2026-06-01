'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { getSession, clearSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import type { Cliente } from '@/types'
import ModelPicker from '../ModelPicker'
import styles from '../copilot.module.css'

const CopilotTab = dynamic(() => import('@/app/dashboard/components/CopilotTab'), { ssr: false })

export default function CopilotClientePage() {
  const router = useRouter()
  const params = useParams()
  const clienteId = (params?.clienteId as string) || null
  const [sess] = useState(getSession)
  const [mounted, setMounted] = useState(false)
  const [clients, setClients] = useState<Cliente[]>([])
  const [loadingClients, setLoadingClients] = useState(true)

  useEffect(() => {
    setMounted(true)
    if (!sess || sess.auth !== '1') { router.replace('/login'); return }
    if (sess.role !== 'admin' && sess.role !== 'ngp') { router.replace('/cliente'); return }
    loadClients()
  }, [])

  async function loadClients() {
    setLoadingClients(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/get-ngp-data`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: sess?.session }),
      })
      const data = await res.json()
      const list = (data.clientes || []) as Cliente[]
      list.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
      setClients(list)
    } catch (e) {
      console.error('[copilot] loadClients', e)
    } finally {
      setLoadingClients(false)
    }
  }

  const currentClient = useMemo(
    () => clients.find((c) => c.id === clienteId) || null,
    [clients, clienteId]
  )

  function logout() {
    const s = getSession()
    fetch(`${SURL}/functions/v1/logout`, {
      method: 'POST',
      headers: efHeaders(),
      body: JSON.stringify({ token: s?.session }),
    }).catch(() => {})
    clearSession()
    router.replace('/login')
  }

  if (!sess || !mounted) return <NGPLoading loading loadingText="Carregando Copilot..." />

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.backBtn} onClick={() => router.push('/copilot')}>← Clientes</button>
            <div>
              <div className={styles.eyebrow}>NGP Copilot</div>
              <h1 className={styles.titleSmall}>{currentClient?.nome || (loadingClients ? 'Carregando...' : 'Cliente')}</h1>
            </div>
          </div>
          <div className={styles.topbarRight}>
            <ModelPicker />
            <ClientSwitcher
              clients={clients}
              currentId={clienteId}
              onPick={(id) => router.push(`/copilot/${id}`)}
            />
            <button className={styles.btnLogout} onClick={logout}>Sair</button>
          </div>
        </header>

        <main className={styles.contentFull}>
          {!clienteId ? (
            <div className={styles.empty}>
              <h3>Selecione um cliente</h3>
              <p>Volte e escolha um cliente pra começar.</p>
            </div>
          ) : (
            <CopilotTab clientId={clienteId} clientName={currentClient?.nome || null} />
          )}
        </main>
      </div>
    </div>
  )
}

function ClientSwitcher({
  clients,
  currentId,
  onPick,
}: {
  clients: Cliente[]
  currentId: string | null
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => (c.nome || '').toLowerCase().includes(q))
  }, [clients, filter])
  const current = clients.find((c) => c.id === currentId)
  return (
    <div className={styles.switcherWrap}>
      <button className={styles.switcherBtn} onClick={() => setOpen((o) => !o)}>
        Trocar cliente
        <span className={styles.switcherCurrent}>{current?.nome || '—'}</span>
      </button>
      {open && (
        <div className={styles.switcherPop}>
          <input
            type="text"
            className={styles.switcherSearch}
            placeholder="Buscar..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          <div className={styles.switcherList}>
            {filtered.map((c) => (
              <button
                key={c.id}
                className={`${styles.switcherItem} ${c.id === currentId ? styles.switcherItemActive : ''}`}
                onClick={() => { onPick(c.id); setOpen(false) }}
              >
                {c.nome}
              </button>
            ))}
            {filtered.length === 0 && <div className={styles.switcherEmpty}>Nenhum encontrado</div>}
          </div>
        </div>
      )}
    </div>
  )
}
