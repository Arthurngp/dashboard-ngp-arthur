'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import styles from './contas.module.css'

interface MetaAccount { id: string; name: string; account_status: number; currency: string }
interface Cliente { id: string; username: string; nome: string; meta_account_id: string | null; foto_url: string | null }


const IcoAd = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
  </svg>
)
const IcoUsers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
  </svg>
)

export default function ContasPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [accounts, setAccounts] = useState<MetaAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'admin') { router.replace('/setores'); return }
    setSess(s)
  }, [router])

  const loadData = useCallback(async () => {
    const s = getSession()
    if (!s?.session) return
    setLoading(true)
    try {
      const [cr, ar] = await Promise.all([
        fetch(`${SURL}/functions/v1/get-ngp-data`, { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session }) }),
        fetch(`${SURL}/functions/v1/discover-meta-accounts`, { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session }) }),
      ])
      const cd = await cr.json(); const ad = await ar.json()
      if (cd.clientes) setClientes(cd.clientes)
      if (ad.accounts) setAccounts(ad.accounts)
      setError('')
    } catch { setError('Erro ao carregar dados.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (sess) loadData() }, [sess, loadData])

  async function linkAccount(clienteId: string, metaAccountId: string) {
    const s = getSession(); if (!s?.session) return
    setLinking(clienteId)
    try {
      const res = await fetch(`${SURL}/functions/v1/link-client-account`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, cliente_id: clienteId, meta_account_id: metaAccountId }),
      })
      if (res.ok) setClientes(prev => prev.map(c => c.id === clienteId ? { ...c, meta_account_id: metaAccountId } : c))
      else { const d = await res.json(); setError(d.error || 'Erro ao vincular.') }
    } catch { setError('Erro de conexão.') }
    finally { setLinking(null) }
  }

  if (!sess) return null

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal />
      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <button className={styles.btnBack} onClick={() => router.push('/setores')}>← Setores</button>
            <div className={styles.eyebrow}>Admin · Cadastrar</div>
            <h1 className={styles.title}>Contas de Anúncio</h1>
            <p className={styles.subtitle}>Vincule contas Meta aos clientes do NGP Space.</p>
          </header>

          {error && <div className={styles.msgErr}>{error}</div>}

          {loading ? (
            <div className={styles.empty}>Carregando...</div>
          ) : (
            <div className={styles.grid}>
              {clientes.length === 0 && <div className={styles.empty}>Nenhum cliente encontrado.</div>}
              {clientes.map(cliente => (
                <div key={cliente.id} className={styles.card}>
                  <div className={styles.clienteInfo}>
                    {cliente.foto_url
                      ? <img src={cliente.foto_url} alt={cliente.nome} className={styles.avatar} />
                      : <div className={styles.avatarFallback}>{cliente.nome.slice(0,2).toUpperCase()}</div>
                    }
                    <div>
                      <div className={styles.clienteNome}>{cliente.nome}</div>
                      <div className={styles.clienteUser}>@{cliente.username}</div>
                      {cliente.meta_account_id && (
                        <div className={styles.linked}>✓ Vinculado: {cliente.meta_account_id}</div>
                      )}
                    </div>
                  </div>
                  {!cliente.meta_account_id && accounts.length > 0 && (
                    <div className={styles.accountList}>
                      <div className={styles.accountLabel}>Selecione uma conta Meta:</div>
                      {accounts.map(acc => (
                        <button key={acc.id} className={styles.accountBtn}
                          onClick={() => linkAccount(cliente.id, acc.id)}
                          disabled={linking === cliente.id}>
                          {acc.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
