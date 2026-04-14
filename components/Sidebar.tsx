'use client'
import React, { useState, useEffect } from 'react'
import styles from './Sidebar.module.css'
import { useRouter, usePathname } from 'next/navigation'
import ProfileModal from './ProfileModal'
import { clearSession, getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'

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

interface NavItem { 
  icon: React.ReactNode; 
  label: string; 
  href: string; 
  tab?: string; 
  badge?: string;
  subItems?: NavItem[];
}

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

const cadastrarNav: NavItem[] = [
  { icon: <Ico><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></Ico>, label: 'Contas de Anúncio', href: '/admin/contas' },
  { icon: <Ico><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></Ico>, label: 'Usuários NGP Space', href: '/admin/usuarios' },
]

const setoresNav: NavItem[] = [
  { icon: <Ico><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Ico>, label: 'Relatórios e Dados', href: '/dashboard' },
  { icon: <Ico><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></Ico>, label: 'Financeiro', href: 'https://financeiro.grupongp.com.br' },
  { icon: <Ico><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></Ico>, label: 'Pessoas', href: '/pessoas' },
  { icon: <Ico><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></Ico>, label: 'Comercial', href: '/comercial' },
  { icon: <Ico><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Ico>, label: 'Trackeamento', href: '#' },
]

export default function Sidebar({ activeTab, onTabChange, onLogout, showDashboardNav = true, minimal = false, sectorNav, sectorNavTitle }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const sess     = getSession()
  const [setoresOpen, setSetoresOpen] = useState(!showDashboardNav)
  const [sectorNavOpen, setSectorNavOpen] = useState(true)
  const [mobileOpen, setMobileOpen]   = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    function handleClickOutside() { setShowConfigMenu(false) }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Fecha sidebar ao navegar
  const handleNav = (fn: () => void) => { fn(); setMobileOpen(false) }

  async function doLogout() {
    if (onLogout) { onLogout(); return }
    if (!confirm('Deseja sair?')) return
    const s = getSession()
    if (s?.session) {
      fetch(`${SURL}/functions/v1/logout`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ token: s.session }),
      }).catch(() => {})
    }
    clearSession()
    router.replace('/login')
  }

  const initials = (sess?.user || 'NG').slice(0, 2).toUpperCase()

  const renderNav = (nav: NavItem[], depth = 0) => nav.map(item => {
    const isTabItem = !!onTabChange && !!item.tab
    const isGroup   = !!item.subItems && item.subItems.length > 0
    const isExpanded = expandedGroups[item.label] || false
    
    const isActive  = isTabItem
      ? activeTab === item.tab
      : pathname === item.href.split('?')[0] && item.href !== '#'

    function handleClick() {
      if (isGroup) {
        setExpandedGroups(prev => ({ ...prev, [item.label]: !prev[item.label] }))
        return
      }
      if (isTabItem && item.tab) { handleNav(() => onTabChange(item.tab!)); return }
      if (item.href === '#') return
      if (item.href.startsWith('http')) { handleNav(() => window.open(item.href, '_blank', 'noopener,noreferrer')); return }
      handleNav(() => router.push(item.href))
    }

    return (
      <div key={item.href + item.label} style={{ display: 'flex', flexDirection: 'column' }}>
        <button
          className={`${styles.navItem} ${isActive ? styles.active : ''}`}
          onClick={handleClick}
          style={{ 
            cursor: (item.href === '#' && !isGroup && !isTabItem) ? 'default' : 'pointer', 
            opacity: (item.href === '#' && !isGroup && !isTabItem) ? 0.6 : 1,
            paddingLeft: depth > 0 ? (depth * 16) + 10 : 10
          }}
        >
          <span>{item.icon}</span>
          <span style={{ flex: 1 }}>{item.label}</span>
          {isGroup && (
            <span className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`} style={{ fontSize: 12 }}>›</span>
          )}
          {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
        </button>
        {isGroup && isExpanded && (
          <div className={styles.navGroupChildren}>
            {renderNav(item.subItems!, depth + 1)}
          </div>
        )}
      </div>
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
          </>
        )}
      </nav>

      <div className={styles.footer}>
        <div className={styles.configWrap}>
          <button 
            className={`${styles.navItem} ${styles.configBtn} ${showConfigMenu ? styles.active : ''}`}
            onClick={(e) => { e.stopPropagation(); setShowConfigMenu(!showConfigMenu) }}
          >
            <span>
              <Ico>
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </Ico>
            </span>
            Configurações
          </button>

          {showConfigMenu && (
            <div className={styles.configBubble} onClick={(e) => e.stopPropagation()}>
              <div className={styles.bubbleTitle}>CADASTRAR</div>
              {renderNav(cadastrarNav)}
            </div>
          )}
        </div>

        <div className={styles.userBlock} style={{ marginTop: '4px' }}>
          <div className={styles.userInfo} onClick={() => setProfileOpen(true)} style={{ cursor: 'pointer' }}>
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
    <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  )
}
