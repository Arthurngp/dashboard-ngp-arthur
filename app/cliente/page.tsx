'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProfileModal from '@/components/ProfileModal'
import Sidebar from '@/components/Sidebar'
import { clearSession, getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import { buildClientPortalNav } from './client-nav'
import styles from './cliente.module.css'

export default function ClienteToolsPage() {
  const router = useRouter()
  const [sess] = useState(getSession)
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [reportsEnabled, setReportsEnabled] = useState(false)
  const [crmEnabled, setCrmEnabled] = useState(false)
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    if (!sess || sess.auth !== '1') { router.replace('/login'); return }
    if (sess.role !== 'cliente') { router.replace('/dashboard'); return }
    loadAccess()
  }, [])

  async function loadAccess() {
    const s = getSession()
    if (!s) return
    setCheckingAccess(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/cliente-portal-access`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (res.ok && !data.error) {
        setAnalyticsEnabled(!!data.access?.analytics_enabled)
        setReportsEnabled(!!data.access?.reports_enabled)
        setCrmEnabled(!!data.access?.crm_enabled)
      }
    } catch {
      setAnalyticsEnabled(false)
      setReportsEnabled(false)
      setCrmEnabled(false)
    } finally {
      setCheckingAccess(false)
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

  if (!sess) return null

  const analyticsAreaEnabled = analyticsEnabled || reportsEnabled
  const clientNav = buildClientPortalNav({
    analyticsEnabled,
    reportsEnabled,
    crmEnabled,
  })

  return (
    <div className={styles.portalShell} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", background: '#f4f6fa', minHeight: '100vh' }}>
      <Sidebar minimal sectorNav={clientNav} sectorNavTitle="ÁREA DO CLIENTE" />

      <div className={styles.portalMain}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.logo}>NGP <span>Dashboard</span></div>
            <div className={styles.clienteBadge}>👤 Área do Cliente</div>
          </div>
          <div className={styles.headerRight}>
            <button className={styles.userPill} onClick={() => setProfileOpen(true)} type="button">
              <div className={styles.userDot}>{(sess.user || 'CL').slice(0, 2).toUpperCase()}</div>
              <span className={styles.userName}>{sess.user}</span>
            </button>
            <button className={styles.btnLogout} onClick={logout}>Sair</button>
          </div>
        </header>

        <main className={styles.toolsPage}>
        <div className={styles.toolsHero}>
          <div className={styles.toolsEyebrow}>Bem-vindo</div>
          <h1>Escolha a área que deseja acessar</h1>
          <p>
            Centralize tudo em um só lugar: abra seus relatórios e análises, ou entre no CRM digital da sua empresa.
          </p>
        </div>

        <div className={styles.toolsGrid}>
          <button
            className={`${styles.accessCard} ${!analyticsAreaEnabled ? styles.accessCardDisabled : ''}`}
            onClick={() => analyticsAreaEnabled && router.push('/cliente/relatorios')}
            disabled={!analyticsAreaEnabled}
          >
            <div className={`${styles.accessIcon} ${styles.analyticsIcon}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19h16" />
                <path d="M7 16V9" />
                <path d="M12 16V5" />
                <path d="M17 16v-3" />
                <circle cx="7" cy="9" r="1.5" />
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="17" cy="13" r="1.5" />
              </svg>
            </div>
            <div className={styles.accessLabel}>Ferramenta</div>
            <h2>Análise de Dados e Relatórios</h2>
            <p>Veja campanhas, resultados, relatórios publicados e seus indicadores de mídia em uma visão executiva.</p>
            <span className={styles.accessStatus}>
              {checkingAccess
                ? 'Verificando liberação...'
                : analyticsAreaEnabled
                  ? 'Acesso liberado'
                  : 'Aguardando liberação'}
            </span>
            <span className={styles.accessAction}>{analyticsAreaEnabled ? 'Abrir área →' : 'Área ainda não liberada'}</span>
          </button>

          <button
            className={`${styles.accessCard} ${!crmEnabled ? styles.accessCardDisabled : ''}`}
            onClick={() => crmEnabled && router.push('/comercial-digital')}
            disabled={!crmEnabled}
          >
            <div className={`${styles.accessIcon} ${styles.crmIcon}`}>CRM</div>
            <div className={styles.accessLabel}>Ferramenta</div>
            <h2>Comercial Digital</h2>
            <p>
              Acompanhe pipeline, oportunidades e sua operação comercial em um CRM isolado da operação interna da NGP.
            </p>
            <span className={styles.accessStatus}>
              {checkingAccess ? 'Verificando liberação...' : crmEnabled ? 'Acesso liberado' : 'Aguardando liberação'}
            </span>
            <span className={styles.accessAction}>{crmEnabled ? 'Abrir CRM →' : 'CRM ainda não liberado'}</span>
          </button>
        </div>
        </main>
      </div>

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  )
}
