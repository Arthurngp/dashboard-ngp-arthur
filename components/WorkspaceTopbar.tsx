'use client'
import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ProfileModal from './ProfileModal'
import SettingsModal from './SettingsModal'
import styles from './WorkspaceTopbar.module.css'
import { clearSession, getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'

interface WorkspaceTopbarNavItem {
  id: string
  label: string
  active?: boolean
  href?: string
  external?: boolean
  onClick?: () => void
  disabled?: boolean
}

interface ClientChipData {
  title: string
  meta: string
  avatarText: string
  avatarImage?: string
}

interface WorkspaceTopbarProps {
  subtitle: string
  activeId?: 'pessoas' | 'comercial' | 'comercial-digital' | 'reports' | 'financeiro' | 'trackeamento' | 'gestao-anuncios' | 'tarefas'
  navItems?: WorkspaceTopbarNavItem[]
  clientChip?: ClientChipData | null
  brandHref?: string
  onProfileClick?: () => void
  onMenuClick?: () => void
  onLogout?: () => void
}

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" fill="white" width={16} height={16}>
      <path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm14 3a4 4 0 110-8 4 4 0 010 8z" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={18} height={18}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

export default function WorkspaceTopbar({
  subtitle,
  activeId,
  navItems,
  clientChip,
  brandHref = '/setores',
  onProfileClick,
  onMenuClick,
  onLogout,
}: WorkspaceTopbarProps) {
  const router = useRouter()
  const [profileOpen, setProfileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const sess = mounted ? getSession() : null
  const sessionUser = sess?.user || 'NGP'
  const sessionInitials = (typeof sessionUser === 'string' ? sessionUser : 'NG').slice(0, 2).toUpperCase()

  const resolvedNavItems = useMemo<WorkspaceTopbarNavItem[]>(() => {
    if (navItems?.length) return navItems
    return [
      { id: 'reports', label: 'Relatórios & Dados', active: activeId === 'reports', href: '/dashboard' },
      { id: 'pessoas', label: 'Pessoas', active: activeId === 'pessoas', href: '/pessoas' },
      { id: 'comercial', label: 'Comercial', active: activeId === 'comercial', href: '/comercial' },
      { id: 'comercial-digital', label: 'Comercial Digital', active: activeId === 'comercial-digital', href: '/comercial-digital' },
      { id: 'tarefas', label: 'Gestão de Tarefas', active: activeId === 'tarefas', href: '/tarefas' },
      { id: 'financeiro', label: 'Financeiro', active: activeId === 'financeiro', href: '/financeiro' },
      { id: 'trackeamento', label: 'NGP Forms', active: activeId === 'trackeamento', href: '/trackeamento' },
      { id: 'gestao-anuncios', label: 'Gestão de anúncios', active: activeId === 'gestao-anuncios', disabled: true },
    ]
  }, [activeId, navItems, router])

  async function doLogout() {
    if (onLogout) {
      onLogout()
      return
    }

    if (!confirm('Deseja sair?')) return
    if (sess?.session) {
      fetch(`${SURL}/functions/v1/logout`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ token: sess.session }),
      }).catch(() => {})
    }
    clearSession()
    router.replace('/login')
  }

  return (
    <div className={styles.topbarHost}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          {onMenuClick && (
            <button type="button" className={styles.menuButton} onClick={onMenuClick} aria-label="Abrir navegação">
              <MenuIcon />
            </button>
          )}

          <Link href={brandHref} className={styles.brand}>
            <div className={styles.brandImageWrapper}>
              <img src="/logos/logo-vertical.png" alt="NGP Space" className={styles.brandLogo} />
            </div>
            <div className={styles.brandCopy}>
              <div className={styles.brandMeta}>{subtitle}</div>
            </div>
          </Link>
        </div>

        <nav className={styles.topnav}>
          {resolvedNavItems.map((item) => (
            item.href && !item.disabled ? (
              item.external ? (
                <a
                  key={item.id}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${styles.topnavItem} ${item.active ? styles.topnavItemActive : ''} ${styles.topnavItemExternal}`}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`${styles.topnavItem} ${item.active ? styles.topnavItemActive : ''}`}
                >
                  {item.label}
                </Link>
              )
            ) : (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                disabled={item.disabled}
                className={`${styles.topnavItem} ${item.active ? styles.topnavItemActive : ''} ${item.disabled ? styles.topnavItemDisabled : ''}`}
              >
                {item.label}
              </button>
            )
          ))}
        </nav>

        <div className={styles.topbarRight}>
          {clientChip && (
            <div className={styles.clientChip}>
              <div className={styles.clientAvatar}>
                {clientChip.avatarImage
                  ? <img src={clientChip.avatarImage} alt={clientChip.title} onError={(e) => (e.currentTarget.style.display = 'none')} />
                  : clientChip.avatarText}
              </div>
              <div>
                <div className={styles.clientTitle}>{clientChip.title}</div>
                <div className={styles.clientMeta}>{clientChip.meta}</div>
              </div>
            </div>
          )}

          <button
            type="button"
            className={styles.profileButton}
            onClick={() => {
              if (onProfileClick) {
                onProfileClick()
                return
              }
              setProfileOpen(true)
            }}
          >
            <div className={styles.profileAvatar}>{sessionInitials}</div>
            <span>{sessionUser}</span>
          </button>

          <button
            type="button"
            className={styles.settingsButton}
            onClick={() => setSettingsOpen(true)}
            aria-label="Configurações"
            title="Configurações"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          <button type="button" className={styles.logoutButton} onClick={doLogout}>Sair</button>
        </div>
      </header>

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
