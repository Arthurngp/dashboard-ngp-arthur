'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import { comercialDigitalNav } from './comercial-digital-nav'
import { buildClientPortalNav } from '@/app/cliente/client-nav'
import styles from './comercial-digital.module.css'

interface ClienteCrm {
  id: string
  nome: string
  username: string
  email: string
  role: 'cliente'
  ativo: boolean
  created_at: string
  analytics_enabled: boolean
  reports_enabled: boolean
  crm_enabled: boolean
  crm_pipeline_count: number
  crm_pipeline_name?: string | null
}

export default function ComercialDigitalPage() {
  const router = useRouter()
  const listRef = useRef<HTMLElement | null>(null)
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [clientes, setClientes] = useState<ClienteCrm[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingClientCrm, setLoadingClientCrm] = useState(false)
  const [clientHasCrm, setClientHasCrm] = useState(false)
  const [clientAnalyticsEnabled, setClientAnalyticsEnabled] = useState(false)
  const [clientReportsEnabled, setClientReportsEnabled] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [selectionPrompt, setSelectionPrompt] = useState<string | null>(null)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (!['admin', 'ngp', 'cliente'].includes(s.role)) { router.replace('/login'); return }
    setSess(s)
  }, [router])

  const isAdmin = sess?.role === 'admin'
  const isClient = sess?.role === 'cliente'

  const loadClientes = useCallback(async () => {
    const s = getSession()
    if (!s?.session || s.role !== 'admin') { setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/admin-listar-clientes-central`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Erro ao carregar clientes.')
      setClientes((data.clientes || [])
        .filter((usuario: ClienteCrm) => usuario.crm_enabled)
        .sort((a: ClienteCrm, b: ClienteCrm) => a.nome.localeCompare(b.nome)))
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Erro ao carregar clientes.' })
    } finally {
      setLoading(false)
    }
  }, [])

  const loadClientCrmAccess = useCallback(async () => {
    const s = getSession()
    if (!s?.session || s.role !== 'cliente') return
    setLoadingClientCrm(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/cliente-portal-access`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Erro ao verificar o CRM do cliente.')
      setClientHasCrm(!!data.access?.crm_enabled)
      setClientAnalyticsEnabled(!!data.access?.analytics_enabled)
      setClientReportsEnabled(!!data.access?.reports_enabled)
    } catch {
      setClientHasCrm(false)
      setClientAnalyticsEnabled(false)
      setClientReportsEnabled(false)
    } finally {
      setLoadingClientCrm(false)
    }
  }, [])

  useEffect(() => {
    if (sess?.role === 'admin') loadClientes()
    if (sess?.role === 'cliente') loadClientCrmAccess()
    if (sess?.role !== 'admin') setLoading(false)
  }, [sess, loadClientes, loadClientCrmAccess])

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    window.setTimeout(() => setMsg(null), 5000)
  }

  if (!sess) return null

  const clientPortalNav = buildClientPortalNav({
    analyticsEnabled: clientAnalyticsEnabled,
    reportsEnabled: clientReportsEnabled,
    crmEnabled: clientHasCrm,
  })

  return (
    <div className={styles.layout}>
      <Sidebar
        minimal
        sectorNavTitle="COMERCIAL DIGITAL"
        sectorNav={isClient ? clientPortalNav : comercialDigitalNav}
        onTabChange={(tab) => {
          if (isClient) {
            if (tab === 'analytics') router.push('/cliente/relatorios')
            else if (tab === 'crm') router.push('/comercial-digital')
            return
          }

          if (tab === 'fields' || tab === 'kanban' || tab === 'new_pipeline') {
            const labels: Record<string, string> = {
              fields: 'Campos',
              kanban: 'Meu CRM',
              new_pipeline: 'Novo Funil',
            }
            setSelectionPrompt(labels[tab] || 'esta área')
            listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        }}
      />

      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.eyebrow}>Setor · Comercial Digital</div>
            <h1 className={styles.title}>CRM para clientes</h1>
            <p className={styles.subtitle}>
              Área dedicada para criar clientes, entregar acesso ao CRM e acompanhar pipelines digitais com separação por conta.
            </p>
          </header>

          {msg && (
            <div className={`${styles.msg} ${msg.type === 'ok' ? styles.msgOk : styles.msgErr}`}>
              {msg.text}
            </div>
          )}

          <section className={styles.heroGrid}>
            <article className={styles.heroCard}>
              <div className={styles.heroTag}>Setor novo</div>
              <h2>Comercial Digital</h2>
              <p>
                Estrutura separada do comercial interno da NGP, pensada para usar o mesmo login do cliente e liberar um CRM isolado por conta.
              </p>
              <div className={styles.heroActions}>
                {isClient ? (
                  <button
                    className={styles.primaryBtn}
                    onClick={() => router.push('/comercial-digital/pipeline')}
                    disabled={!clientHasCrm || loadingClientCrm}
                  >
                    {loadingClientCrm ? 'Verificando acesso...' : clientHasCrm ? 'Abrir meu CRM' : 'CRM aguardando liberação'}
                  </button>
                ) : (
                  <button
                    className={styles.primaryBtn}
                    onClick={() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    Selecionar cliente abaixo
                  </button>
                )}
              </div>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Acesso</span>
              <strong>{isClient ? 'Cliente final' : isAdmin ? 'Admin total' : 'Equipe NGP'}</strong>
              <p>
                {isClient
                  ? (clientHasCrm
                    ? 'Seu login atual já abre apenas o CRM vinculado à sua conta.'
                    : 'Seu login continua o mesmo. O CRM só aparece depois que a NGP liberar a sua conta.')
                  : 'O cliente usa o mesmo login que já acessa relatórios e só enxerga o CRM vinculado à própria conta.'}
              </p>
            </article>
          </section>

          {isAdmin && (
            <section className={styles.listCard} ref={listRef}>
              <div className={styles.listHeader}>
                <h3>Clientes com CRM liberado</h3>
                <span>{loading ? 'Carregando...' : `${clientes.length} cliente(s)`}</span>
              </div>

              {loading ? (
                <div className={styles.empty}>Carregando clientes...</div>
              ) : clientes.length === 0 ? (
                <div className={styles.empty}>Nenhum cliente com CRM liberado foi encontrado ainda.</div>
              ) : (
                <div className={styles.clientGrid}>
                  {clientes.map((cliente) => (
                    <button
                      key={cliente.id}
                      className={styles.clientCard}
                      onClick={() => router.push(`/comercial-digital/pipeline?cliente_id=${cliente.id}&cliente_nome=${encodeURIComponent(cliente.nome)}`)}
                    >
                      <div>
                        <strong>{cliente.nome}</strong>
                        <span>@{cliente.username} · {cliente.crm_pipeline_name || `${cliente.crm_pipeline_count} funil(is)`}</span>
                      </div>
                      <span className={styles.clientAction}>Abrir / configurar CRM →</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {selectionPrompt && (
        <div className={styles.modalOverlay} onClick={() => setSelectionPrompt(null)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalEyebrow}>Seleção necessária</div>
            <h3>Escolha um cliente antes de continuar</h3>
            <p>
              Selecione um cliente para poder acessar <strong>{selectionPrompt}</strong>. Assim o CRM digital abre no
              contexto correto e evita qualquer mistura entre contas.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setSelectionPrompt(null)}>Fechar</button>
              <button
                className={styles.primaryBtn}
                onClick={() => {
                  listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  setSelectionPrompt(null)
                }}
              >
                Selecionar cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
