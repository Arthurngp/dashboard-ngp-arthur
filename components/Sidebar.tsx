'use client'
import React, { useState } from 'react'
import styles from './Sidebar.module.css'
import { useRouter, usePathname } from 'next/navigation'
import { clearSession, getSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'

const LogoIcon = () => (
  <svg viewBox="0 0 24 24" fill="white" width={18} height={18}>
    <path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm14 3a4 4 0 110-8 4 4 0 010 8z"/>
  </svg>
)

interface Props {
  /** Quando passado, os itens de VISÃO GERAL viram tabs de estado (sem navegação de rota) */
  activeTab?: string
  onTabChange?: (tab: string) => void
  /** Override do logout (ex: dashboard usa sua própria lógica) */
  onLogout?: () => void
  /** Oculta a seção de navegação do dashboard (usado na página de setores) */
  showDashboardNav?: boolean
  /** Modo minimal: oculta SISTEMA e ADMINISTRAÇÃO, SETORES fechado por padrão.
   *  Use em setores como Pessoas para ter nav própria abaixo. */
  minimal?: boolean
  /** Itens de navegação próprios do setor (aparece abaixo de SETORES no minimal mode) */
  sectorNav?: NavItem[]
  /** Título da seção de nav do setor */
  sectorNavTitle?: string
}

interface NavItem { icon: React.ReactNode; label: string; href: string; tab?: string; badge?: string }

const Ico = ({ children, fill = 'none', stroke = 'currentColor', strokeWidth = '2' }: {
  children: React.ReactNode; fill?: string; stroke?: string; strokeWidth?: string
}) => (
  <svg viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={strokeWidth} width={15} height={15} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const ngpNav: NavItem[] = [
  { tab: 'resumo',      icon: <Ico><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Ico>, label: 'Resumo',     href: '/dashboard' },
  { tab: 'plataformas', icon: <Ico fill="#1877f2" stroke="none"><circle cx="12" cy="12" r="10"/><path d="M16 8h-2a2 2 0 00-2 2v2h4l-.5 4H12v8h-4v-8H6v-4h2v-2a6 6 0 016-6h2v4z" fill="#fff"/></Ico>, label: 'Plataformas', href: '/dashboard' },
  { tab: 'campanhas',   icon: <Ico><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></Ico>, label: 'Campanhas',  href: '/dashboard' },
  { tab: 'graficos',    icon: <Ico><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></Ico>, label: 'Gráficos',   href: '/dashboard' },
  { tab: 'relatorios',  icon: <Ico><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></Ico>, label: 'Relatórios',  href: '/relatorio?novo=1' },
  { tab: 'notificacoes', icon: <Ico><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></Ico>, label: 'Notificações', href: '/dashboard' },
]

const sistemaNav: NavItem[] = [
  { icon: <Ico><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></Ico>, label: 'UTM Builder', href: '/utm-builder' },
  { icon: <Ico><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></Ico>, label: 'Análise IA',  href: '/ia-analise' },
]

const adminNav: NavItem[] = [
  { icon: <Ico><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></Ico>, label: 'Vincular Contas', href: '/admin/contas' },
]

const setoresNav: NavItem[] = [
  { icon: <Ico><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Ico>, label: 'Relatórios e Dados', href: '/dashboard' },
  { icon: <Ico><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></Ico>, label: 'Financeiro', href: 'https://financeiro.grupongp.com.br' },
  { icon: <Ico><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></Ico>, label: 'Comercial', href: '/comercial' },
  { icon: <Ico><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Ico>, label: 'Trackeamento', href: '#' },
]

export default function Sidebar({ activeTab, onTabChange, onLogout, showDashboardNav = true, minimal = false, sectorNav, sectorNavTitle }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const sess     = getSession()
  const [setoresOpen, setSetoresOpen] = useState(!showDashboardNav && !minimal)
  const [sectorNavOpen, setSectorNavOpen] = useState(true)
  const [mobileOpen, setMobileOpen]   = useState(false)

  // Fecha sidebar ao navegar
  const handleNav = (fn: () => void) => { fn(); setMobileOpen(false) }

  async function doLogout() {
    if (onLogout) { onLogout(); return }
    if (!confirm('Deseja sair?')) return
    const s = getSession()
    if (s?.session) {
      fetch(`${SURL}/functions/v1/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON },
        body: JSON.stringify({ token: s.session }),
      }).catch(() => {})
    }
    clearSession()
    router.replace('/login')
  }

  const initials = (sess?.user || 'NG').slice(0, 2).toUpperCase()

  const renderNav = (nav: NavItem[]) => nav.map(item => {
    const isTabItem = !!onTabChange && !!item.tab
    const isActive  = isTabItem
      ? activeTab === item.tab
      : pathname === item.href.split('?')[0] && item.href !== '#'

    function handleClick() {
      if (item.href === '#') return
      if (item.href.startsWith('http')) { handleNav(() => window.open(item.href, '_blank', 'noopener,noreferrer')); return }
      if (isTabItem && item.tab) { handleNav(() => onTabChange(item.tab!)); return }
      handleNav(() => router.push(item.href))
    }

    return (
      <button
        key={item.href + item.label}
        className={`${styles.navItem} ${isActive ? styles.active : ''}`}
        onClick={handleClick}
        style={{ cursor: item.href === '#' ? 'default' : 'pointer', opacity: item.href === '#' ? 0.6 : 1 }}
      >
        <span>{item.icon}</span>
        {item.label}
        {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
      </button>
    )
  })

  return (
    <>
      {/* Hamburguer — só aparece em mobile via CSS */}
      <button className={styles.hamburger} onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width={18} height={18}>
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>

      {/* Overlay escuro */}
      <div
        className={`${styles.overlay} ${mobileOpen ? styles.overlayVisible : ''}`}
        onClick={() => setMobileOpen(false)}
      />

    <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}>
      <button className={styles.logoBtn} onClick={() => handleNav(() => router.push('/setores'))}>
        <div className={styles.logoMark}><LogoIcon /></div>
        <div>
          <div className={styles.logoText}>NGP <span>Space</span></div>
          <div className={styles.roleLabel}>Sistema Geral</div>
        </div>
      </button>

      <nav className={styles.nav}>
        <button
          className={styles.navLabelBtn}
          style={{ marginTop: 0 }}
          onClick={() => setSetoresOpen(o => !o)}
        >
          <span>SETORES</span>
          <span className={`${styles.chevron} ${setoresOpen ? styles.chevronOpen : ''}`}>›</span>
        </button>
        {setoresOpen && renderNav(setoresNav)}

        {/* Nav própria do setor (minimal mode) */}
        {minimal && sectorNav && sectorNav.length > 0 && (
          <>
            <button className={styles.navLabelBtn} style={{ marginTop: 12 }} onClick={() => setSectorNavOpen(o => !o)}>
              <span>{sectorNavTitle || 'MENU'}</span>
              <span className={`${styles.chevron} ${sectorNavOpen ? styles.chevronOpen : ''}`}>›</span>
            </button>
            {sectorNavOpen && renderNav(sectorNav)}
          </>
        )}

        {!minimal && (
          <>
            <div className={styles.navLabel} style={{ marginTop: 12 }}>SISTEMA</div>
            {renderNav(sistemaNav)}
            <div className={styles.navLabel} style={{ marginTop: 12 }}>ADMINISTRAÇÃO</div>
            {renderNav(adminNav)}
          </>
        )}
        {minimal && sectorNavTitle !== 'ADMINISTRAÇÃO' && sectorNavTitle !== 'CADASTRAR' && (
          <>
            <div className={styles.navLabel} style={{ marginTop: 24 }}>ADMINISTRAÇÃO</div>
            {renderNav(adminNav)}
          </>
        )}
      </nav>

      <div className={styles.footer}>
        <div className={styles.userBlock}>
          <div className={styles.userInfo} onClick={() => router.push('/perfil')} style={{ cursor: 'pointer' }}>
            <div className={styles.avatar}>{initials}</div>
            <div>
              <div className={styles.userName}>{sess?.user || 'NGP'}</div>
              <div className={styles.userRole}>Acesso total</div>
            </div>
          </div>
          <button className={styles.btnLogout} onClick={doLogout} title="Sair">⏻</button>
        </div>
      </div>
    </aside>
    </>
  )
}
