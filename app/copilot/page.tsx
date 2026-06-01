'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession, clearSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import type { Cliente } from '@/types'
import ModelPicker from './ModelPicker'
import styles from './copilot.module.css'

export default function CopilotIndexPage() {
  const router = useRouter()
  const [sess] = useState(getSession)
  const [mounted, setMounted] = useState(false)
  const [clients, setClients] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setMounted(true)
    if (!sess || sess.auth !== '1') { router.replace('/login'); return }
    if (sess.role !== 'admin' && sess.role !== 'ngp') { router.replace('/cliente'); return }
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/get-ngp-data`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: sess?.session }),
      })
      const data = await res.json()
      const list = (data.clientes || []) as Cliente[]
      // Ordena por nome
      list.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
      setClients(list)
    } catch (e) {
      console.error('[copilot] loadClients', e)
    } finally {
      setLoading(false)
    }
  }

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => (c.nome || '').toLowerCase().includes(q) || (c.username || '').toLowerCase().includes(q))
  }, [clients, search])

  if (!sess || !mounted) return <NGPLoading loading loadingText="Carregando NGP Copilot..." />

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.backBtn} onClick={() => router.push('/setores')}>← Setores</button>
            <div>
              <div className={styles.eyebrow}>NGP Copilot</div>
              <h1 className={styles.title}>Agente de tráfego com memória persistente</h1>
            </div>
          </div>
          <div className={styles.topbarRight}>
            <ModelPicker />
            <button className={styles.userPill} onClick={() => router.push('/profile')} type="button">
              <div className={styles.userDot}>{(sess.user || 'NG').slice(0, 2).toUpperCase()}</div>
              <span className={styles.userName}>{sess.user}</span>
            </button>
            <button className={styles.btnLogout} onClick={logout}>Sair</button>
          </div>
        </header>

        <main className={styles.content}>
          <div className={styles.hero}>
            <h2>Selecione um cliente para conversar</h2>
            <p>O Copilot mantém memória persistente por cliente: cada conversa soma ao perfil. Aprove o que ele aprende, edite quando precisar.</p>
            <input
              type="text"
              className={styles.search}
              placeholder="Buscar cliente por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading && <div className={styles.loadingMsg}>Carregando clientes…</div>}

          {!loading && filtered.length === 0 && (
            <div className={styles.empty}>
              <h3>{search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}</h3>
              <p>{search ? 'Tente outra busca.' : 'Cadastre clientes em /admin/clientes para começar.'}</p>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className={styles.grid}>
              {filtered.map((c) => (
                <button
                  key={c.id}
                  className={styles.clientCard}
                  onClick={() => router.push(`/copilot/${c.id}`)}
                >
                  <div className={styles.clientAvatar}>
                    {c.foto_url
                      ? <img src={c.foto_url} alt={c.nome} />
                      : <span>{(c.nome || '?').slice(0, 2).toUpperCase()}</span>}
                  </div>
                  <div className={styles.clientBody}>
                    <div className={styles.clientName}>{c.nome}</div>
                    <div className={styles.clientMeta}>{c.username || '—'}</div>
                  </div>
                  <span className={styles.clientArrow}>→</span>
                </button>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
