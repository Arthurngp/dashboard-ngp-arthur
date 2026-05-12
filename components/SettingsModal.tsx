'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getAdminNavigation } from '@/lib/admin-navigation'
import styles from './SettingsModal.module.css'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

const MASTER_USERNAMES = ['arthur', 'arthur.oliveira@sejangp.com.br']

const ITEM_ICON: Record<string, string> = {
  cadastros: '👥',
  contas: '💳',
  'clientes-arquivados': '📦',
  'setores-tarefas': '📋',
  integracoes: '🔗',
  feedback: '💬',
}

const ITEM_SECTION: Record<string, string> = {
  cadastros: 'CADASTROS',
  'clientes-arquivados': 'CADASTROS',
  contas: 'SISTEMA',
  'setores-tarefas': 'SISTEMA',
  integracoes: 'SISTEMA',
  feedback: 'SISTEMA',
}

const SECTION_ORDER = ['CADASTROS', 'SISTEMA']

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)

  useEffect(() => {
    setSess(getSession())
  }, [isOpen])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen || !sess) return null

  const isAdmin = sess.role === 'admin'
  const isMaster = isAdmin && MASTER_USERNAMES.includes(sess.username ?? '')

  function navigate(href: string) {
    onClose()
    router.push(href)
  }

  const visibleItems = getAdminNavigation(sess.role).map((item) => ({
    ...item,
    icon: ITEM_ICON[item.id] || '⚙',
    section: ITEM_SECTION[item.id] || 'SISTEMA',
  }))

  const grouped = SECTION_ORDER.map((section) => ({
    section,
    items: visibleItems.filter((item) => item.section === section),
  })).filter((g) => g.items.length > 0)

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.gearIcon}>⚙</div>
            <div>
              <div className={styles.title}>Configurações</div>
              <div className={styles.subtitle}>Gerencie o sistema NGP Space</div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className={styles.body}>
          {visibleItems.length === 0 ? (
            <div className={styles.empty}>Nenhuma configuração disponível para seu perfil.</div>
          ) : (
            grouped.map(({ section, items }) => (
              <div key={section} className={styles.section}>
                <div className={styles.sectionTitle}>{section}</div>
                <div className={styles.grid}>
                  {items.map(item => (
                    <button
                      key={item.id}
                      className={styles.card}
                      onClick={() => navigate(item.href)}
                    >
                      <div className={styles.cardIcon}>{item.icon}</div>
                      <div className={styles.cardContent}>
                        <div className={styles.cardLabel}>{item.label}</div>
                        <div className={styles.cardDesc}>{item.description}</div>
                      </div>
                      <div className={styles.cardArrow}>→</div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <div className={styles.footerInfo}>
            Logado como <strong>{sess.user}</strong> · {isMaster ? 'ADM Master' : isAdmin ? 'Administrador' : 'NGP'}
          </div>
        </div>
      </div>
    </div>
  )
}
