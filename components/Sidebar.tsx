'use client'

import React, { Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'
import { efHeaders, efCall } from '@/lib/api'
import WorkspaceTopbar from './WorkspaceTopbar'
import styles from './Sidebar.module.css'
import { TaskCliente, TaskSetor } from '@/types/tasks'

interface Props {
  activeTab?: string
  onTabChange?: (tab: string) => void
  onLogout?: () => void
  showDashboardNav?: boolean
  minimal?: boolean
  sectorNav?: NavItem[]
  sectorNavTitle?: string
  setoresOnlyOpen?: boolean
  allowDesktopCollapse?: boolean
  collapseStorageKey?: string
}

interface NavItem {
  icon: React.ReactNode
  label: string
  href: string
  tab?: string
  badge?: string
  subItems?: NavItem[]
  action?: {
    icon: React.ReactNode
    onClick: () => void
  }
}

function QuickSectorModal({ onClose, onSaved, clientId }: { onClose: () => void; onSaved: () => void; clientId?: string }) {
  const [nome, setNome] = useState('')
  const [cor, setCor] = useState('#3b82f6')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b']

  async function handleSave() {
    if (!nome.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`${SURL}/rest/v1/task_setores`, {
        method: 'POST',
        headers: { ...efHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({ 
          nome: nome.trim(), 
          cor: cor, 
          client_id: clientId || null,
          ordem: 99,
          ativo: true 
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message || 'Erro ao salvar setor.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div className={styles.modalTitle}>Configuração da Lista</div>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.modalSection}>
            <label className={styles.modalLabel}>Nome da Lista</label>
            <input
              autoFocus
              className={styles.modalInput}
              placeholder="Ex: Tráfego, Criativos, Atendimento..."
              value={nome}
              onChange={e => setNome(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>

          <div className={styles.modalSection}>
            <label className={styles.modalLabel}>Cor de Identificação</label>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setCor(c)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: c,
                    border: cor === c ? '3px solid #000' : 'none',
                    cursor: 'pointer',
                    transition: 'transform 0.2s',
                    transform: cor === c ? 'scale(1.1)' : 'scale(1)'
                  }}
                />
              ))}
            </div>
          </div>

          <p style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>
            Esta lista ficará disponível em todas as pastas de clientes para organização de tarefas.
          </p>
          
          {error && <div style={{ color: '#ef4444', fontSize: '14px', fontWeight: 600 }}>{error}</div>}
        </div>
        <div className={styles.modalFoot}>
          <button className={styles.modalBtnCancel} onClick={onClose}>Cancelar</button>
          <button className={styles.modalBtnSave} onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Criar Lista de Tarefas'}
          </button>
        </div>
      </div>
    </div>
  )
}

const Ico = ({
  children,
  fill = 'none',
  stroke = 'currentColor',
  strokeWidth = '2',
}: {
  children: React.ReactNode
  fill?: string
  stroke?: string
  strokeWidth?: string
}) => (
  <svg
    viewBox="0 0 24 24"
    fill={fill}
    stroke={stroke}
    strokeWidth={strokeWidth}
    width={15}
    height={15}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

const cadastrarNav: NavItem[] = [
  {
    icon: <Ico><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="3" x2="8" y2="21" /></Ico>,
    label: 'Cadastros',
    href: '/admin/usuarios?tab=clientes',
  },
  {
    icon: <Ico><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></Ico>,
    label: 'Contas de Anúncio',
    href: '/admin/contas',
  },
  {
    icon: <Ico><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></Ico>,
    label: 'Clientes Arquivados',
    href: '/admin/clientes-arquivados',
  },
  {
    icon: <Ico><path d="M12 20h9" /><path d="M12 4h9" /><path d="M4 9h16" /><path d="M4 15h16" /><path d="M8 4v16" /></Ico>,
    label: 'Setores de Tarefas',
    href: '/tarefas/config',
  },
]

function getSetoresNavItems(): NavItem[] {
  return [
    {
      icon: <Ico><path d="M4 19h16" /><path d="M7 16V9" /><path d="M12 16V5" /><path d="M17 16v-3" /><circle cx="7" cy="9" r="1.5" /><circle cx="12" cy="5" r="1.5" /><circle cx="17" cy="13" r="1.5" /></Ico>,
      label: 'Análise de Dados e Relatórios',
      href: '/dashboard',
    },
    {
      icon: <Ico><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M7 20h10" /><path d="M9 8h6" /><path d="M7 12h10" /></Ico>,
      label: 'Gestão de anúncios',
      href: '#',
      badge: 'breve',
    },
    {
      icon: <Ico><path d="M12 2v20" /><path d="M17 6.5c0-1.9-2.2-3.5-5-3.5s-5 1.6-5 3.5 2.2 3.5 5 3.5 5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5" /></Ico>,
      label: 'Financeiro',
      href: '/financeiro',
    },
    {
      icon: <Ico><circle cx="9" cy="8" r="3" /><path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="18" cy="9" r="2.5" /><path d="M15.5 19c.3-2.1 2.1-3.8 4.3-4.1" /></Ico>,
      label: 'Pessoas',
      href: '/pessoas',
    },
    {
      icon: <Ico><path d="M4 6h10" /><path d="M4 12h7" /><path d="M4 18h4" /><path d="M16 5l4 4-4 4" /><path d="M13 9h7" /></Ico>,
      label: 'Comercial',
      href: '/comercial',
    },
    {
      icon: <Ico><path d="M4 7h7" /><path d="M4 12h11" /><path d="M4 17h5" /><circle cx="18" cy="7" r="3" /><path d="M16 18l2-2 2 2 3-3" /></Ico>,
      label: 'Comercial Digital',
      href: '/comercial-digital',
    },
    {
      icon: <Ico><path d="M12 3v3" /><path d="M21 12h-3" /><path d="M12 21v-3" /><path d="M3 12h3" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.5" /></Ico>,
      label: 'NGP Forms',
      href: '/trackeamento',
    },
    {
      icon: <Ico><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" /></Ico>,
      label: 'Gestão de Tarefas',
      href: '/tarefas',
    },
  ]
}

function getReportsSectorNav(): NavItem[] {
  return [
    {
      icon: <Ico><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></Ico>,
      label: 'Painel geral',
      href: '/dashboard',
    },
    {
      icon: <Ico><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></Ico>,
      label: 'Relatórios',
      href: '/relatorio?novo=1',
    },
    {
      icon: <Ico><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></Ico>,
      label: 'UTM Builder',
      href: '/utm-builder',
    },
    {
      icon: <Ico><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></Ico>,
      label: 'Análise IA',
      href: '/ia-analise',
    },
  ]
}

function getAutoSectorNav(pathname: string, role?: string): { title: string; nav: NavItem[] } | null {
  if (pathname === '/setores') {
    return {
      title: 'SETORES',
      nav: getSetoresNavItems(),
    }
  }

  if (
    pathname.startsWith('/dashboard')
    || pathname.startsWith('/relatorio')
    || pathname.startsWith('/utm-builder')
    || pathname.startsWith('/ia-analise')
  ) {
    return {
      title: 'RELATÓRIOS & DADOS',
      nav: getReportsSectorNav(),
    }
  }

  if (pathname.startsWith('/admin')) {
    return {
      title: 'ADMINISTRAÇÃO',
      nav: cadastrarNav,
    }
  }

  if (pathname.startsWith('/comercial-digital')) {
    return {
      title: 'COMERCIAL DIGITAL',
      nav: [
        {
          icon: <Ico><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></Ico>,
          label: 'Gestão',
          href: '/comercial-digital',
        },
        {
          icon: <Ico><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></Ico>,
          label: 'Pipeline',
          href: '/comercial-digital/pipeline',
          subItems: [
            { icon: <span style={{ width: 15 }} />, label: 'Meu CRM', href: '/comercial-digital/pipeline?tab=kanban' },
            { icon: <span style={{ width: 15 }} />, label: 'Campos', href: '/comercial-digital/pipeline?tab=fields' },
            { icon: <span style={{ width: 15 }} />, label: 'Novo Funil', href: '/comercial-digital/pipeline?action=new_pipeline' },
          ],
        },
      ],
    }
  }

  if (pathname.startsWith('/comercial')) {
    return {
      title: 'COMERCIAL',
      nav: [
        {
          icon: <Ico><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></Ico>,
          label: 'Gestão',
          href: '/comercial/gestao',
        },
        {
          icon: <Ico><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></Ico>,
          label: 'Pipeline',
          href: '/comercial/pipeline',
          subItems: [
            { icon: <span style={{ width: 15 }} />, label: 'Meus Funis', href: '/comercial/pipeline?tab=kanban' },
            { icon: <span style={{ width: 15 }} />, label: 'Cadastrar Campos', href: '/comercial/pipeline?tab=fields' },
            { icon: <span style={{ width: 15 }} />, label: 'Novo Funil', href: '/comercial/pipeline?action=new_pipeline' },
          ],
        },
        {
          icon: <Ico><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></Ico>,
          label: 'Propostas',
          href: '/comercial/propostas',
        },
        {
          icon: <Ico><path d="M20 14.66V20a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h5.34" /><polygon points="18 2 22 6 12 16 8 16 8 12 18 2" /></Ico>,
          label: 'Contratos',
          href: '/comercial/contratos',
        },
        {
          icon: <Ico><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></Ico>,
          label: 'Metas e KPIs',
          href: '/comercial/kpis',
        },
      ],
    }
  }

  if (pathname.startsWith('/tarefas')) {
    return {
      title: 'GESTÃO DE TAREFAS',
      nav: [
        {
          icon: <Ico><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /></Ico>,
          label: 'Visão Geral (Tudo)',
          href: '/tarefas',
        },
      ],
    }
  }

  if (pathname.startsWith('/pessoas')) {
    return {
      title: 'PESSOAS',
      nav: [
        {
          icon: <Ico><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Ico>,
          label: 'Dashboard',
          href: '/pessoas',
        },
        {
          icon: <Ico><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /></Ico>,
          label: 'Registros de Ponto',
          href: '/pessoas/registros',
        },
        {
          icon: <Ico><path d="M12 20h9" /><path d="M12 4h9" /><path d="M4 9h16" /><path d="M4 15h16" /><path d="M8 4v16" /></Ico>,
          label: 'Colaboradores',
          href: '/pessoas/carreira',
        },
        ...(role === 'admin'
          ? [{
              icon: <Ico><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /></Ico>,
              label: 'Cadastros',
              href: '/pessoas/cadastros',
            }]
          : []),
        ...(role === 'admin'
          ? [{
              icon: <Ico><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" /></Ico>,
              label: 'Lixeira',
              href: '/pessoas/lixeira',
            }]
          : []),
      ],
    }
  }

  return null
}

function getTopbarActiveId(pathname: string): 'pessoas' | 'comercial' | 'comercial-digital' | 'reports' | 'financeiro' | 'trackeamento' | 'gestao-anuncios' | 'tarefas' | undefined {
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/relatorio') || pathname.startsWith('/utm-builder') || pathname.startsWith('/ia-analise')) return 'reports'
  if (pathname.startsWith('/tarefas')) return 'tarefas'
  if (pathname.startsWith('/pessoas')) return 'pessoas'
  if (pathname.startsWith('/financeiro')) return 'financeiro'
  if (pathname.startsWith('/trackeamento')) return 'trackeamento'
  if (pathname.startsWith('/comercial-digital')) return 'comercial-digital'
  if (pathname.startsWith('/comercial')) return 'comercial'
  return undefined
}

function getTopbarSubtitle(pathname: string, sectorTitle?: string, isClient?: boolean, setoresOnlyOpen?: boolean) {
  if (isClient) return 'Área do cliente'
  if (setoresOnlyOpen) return 'Setores e administração'
  if (sectorTitle === 'ADMINISTRAÇÃO' || pathname.startsWith('/admin')) return 'Administração e estrutura'
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/relatorio') || pathname.startsWith('/utm-builder') || pathname.startsWith('/ia-analise')) {
    return 'Relatórios e análise de dados'
  }
  if (pathname.startsWith('/tarefas')) return 'Gestão de Tarefas'
  if (pathname.startsWith('/pessoas')) return 'Pessoas'
  if (pathname.startsWith('/financeiro')) return 'Financeiro'
  if (pathname.startsWith('/trackeamento')) return 'NGP Forms'
  if (pathname.startsWith('/comercial-digital')) return 'Comercial digital'
  if (pathname.startsWith('/comercial')) return 'Comercial'
  return 'Operação e setores'
}

function getContextDescription(pathname: string, title: string, isClient: boolean, setoresOnlyOpen: boolean) {
  if (setoresOnlyOpen) return 'Acesse os módulos principais do Space e avance para a área que faz sentido agora.'
  if (isClient) return 'Navegação contextual da área liberada para o cliente, sem misturar com a operação interna.'
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/relatorio') || pathname.startsWith('/utm-builder') || pathname.startsWith('/ia-analise')) {
    return 'Ferramentas, rotas e ações do setor de dados concentradas em um único contexto.'
  }
  if (pathname.startsWith('/tarefas')) return 'Gerencie tarefas da equipe em um Kanban visual com prioridades e responsáveis.'
  if (pathname.startsWith('/pessoas')) return 'Acompanhe registros, cadastros e operações da equipe neste contexto.'
  if (pathname.startsWith('/financeiro')) return 'Controle entradas, saídas, contas e cadastros financeiros no novo módulo interno.'
  if (pathname.startsWith('/trackeamento')) return 'Crie formulários, acompanhe respostas e leia a jornada de conversão em um único módulo.'
  if (pathname.startsWith('/comercial-digital')) return 'Fluxo do CRM digital, pipelines e gestão entregue aos clientes.'
  if (pathname.startsWith('/comercial')) return 'Rotas de pipeline, propostas, contratos e operação comercial da NGP.'
  if (pathname.startsWith('/admin')) return 'Acesso administrativo para cadastros, vínculos e estrutura operacional.'
  return `Navegação contextual do setor ${title.toLowerCase()}.`
}

function getClientTopNav(pathname: string, router: ReturnType<typeof useRouter>) {
  return [
    {
      id: 'client-home',
      label: 'Área do cliente',
      active: pathname === '/cliente',
      href: '/cliente',
    },
    {
      id: 'client-reports',
      label: 'Relatórios & Dados',
      active: pathname.startsWith('/cliente/relatorios'),
      href: '/cliente/relatorios',
    },
    {
      id: 'client-crm',
      label: 'CRM Digital',
      active: pathname.startsWith('/comercial-digital'),
      href: '/comercial-digital',
    },
  ]
}

function SidebarInner({
  activeTab,
  onTabChange,
  onLogout,
  sectorNav,
  sectorNavTitle,
  setoresOnlyOpen = false,
  allowDesktopCollapse = false,
  collapseStorageKey,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [mounted, setMounted]               = useState(false)
  const [mobileOpen, setMobileOpen]         = useState(false)
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [bubblePos, setBubblePos]           = useState({ left: 0, bottom: 0 })
  const [isDesktop, setIsDesktop]           = useState(true)
  const [clients, setClients]               = useState<TaskCliente[]>([])
  const [setores, setSetores]               = useState<TaskSetor[]>([])
  const [loading, setLoading]               = useState(false)
  const [showQuickSector, setShowQuickSector] = useState(false)
  const [quickSectorClientId, setQuickSectorClientId] = useState<string | undefined>(undefined)
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const configWrapRef = useRef<HTMLDivElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)

  const refreshTasksData = () => {
    setLoading(true)
    const h = efHeaders()
    Promise.all([
      efCall('get-ngp-data').then(data => data.clientes || []),
      fetch(`${SURL}/rest/v1/task_setores?select=id,nome,cor,client_id&ativo=eq.true&order=ordem.asc`, { headers: h })
        .then(res => res.json())
        .catch(() => [])
    ]).then(([c, s]) => {
      setClients(Array.isArray(c) ? c : [])
      setSetores(Array.isArray(s) ? s : [])
    }).finally(() => setLoading(false))
  }

  useEffect(() => { 
    setMounted(true)
    setIsDesktop(window.innerWidth > 768)
    const handleResize = () => setIsDesktop(window.innerWidth > 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!allowDesktopCollapse || !collapseStorageKey) return
    try {
      const stored = window.localStorage.getItem(collapseStorageKey)
      setDesktopCollapsed(stored === '1')
    } catch {
      setDesktopCollapsed(false)
    }
  }, [allowDesktopCollapse, collapseStorageKey])

  useEffect(() => {
    if (!allowDesktopCollapse || !collapseStorageKey) return
    try {
      window.localStorage.setItem(collapseStorageKey, desktopCollapsed ? '1' : '0')
    } catch {
      // silencioso
    }
  }, [allowDesktopCollapse, collapseStorageKey, desktopCollapsed])

  useEffect(() => {
    if (!mounted || !pathname.startsWith('/tarefas')) return
    refreshTasksData()
  }, [pathname, mounted])

  const sess = mounted ? getSession() : null
  const isClient = sess?.role === 'cliente'
  const autoSector = getAutoSectorNav(pathname, sess?.role)
  let resolvedSectorNav = setoresOnlyOpen ? getSetoresNavItems() : sectorNav || autoSector?.nav || []
  const resolvedSectorTitle = setoresOnlyOpen ? 'SETORES' : sectorNavTitle || autoSector?.title || 'NAVEGAÇÃO'

  // Injetar pastas de clientes se estiver no setor de tarefas (Estilo ClickUp)
  if (pathname.startsWith('/tarefas') && clients.length > 0) {
    const clientsFolder: NavItem = {
      icon: <Ico><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></Ico>,
      label: 'Pastas de Clientes',
      href: '#',
      subItems: clients.map(c => ({
        icon: <Ico><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></Ico>,
        label: c.nome,
        href: `/tarefas?client_id=${c.id}`,
        subItems: [
          ...(setores || []).filter(s => s.client_id === c.id).map(s => ({
            icon: <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.cor }} />,
            label: s.nome,
            href: `/tarefas?client_id=${c.id}&setor_id=${s.id}`,
          }))
        ],
        action: {
          icon: <Ico strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Ico>,
          onClick: () => {
            setQuickSectorClientId(c.id)
            setShowQuickSector(true)
          }
        },
      }))
    }
    resolvedSectorNav = [...resolvedSectorNav, clientsFolder]
  }

  const topbarSubtitle = getTopbarSubtitle(pathname, sectorNavTitle, isClient, setoresOnlyOpen)
  const contextDescription = getContextDescription(pathname, resolvedSectorTitle, isClient, setoresOnlyOpen)
  const topbarNavItems = isClient ? getClientTopNav(pathname, router) : undefined

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node | null
      if (configWrapRef.current && target && configWrapRef.current.contains(target)) return
      if (bubbleRef.current && target && bubbleRef.current.contains(target)) return
      setShowConfigMenu(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (showConfigMenu && configWrapRef.current) {
      const rect = configWrapRef.current.getBoundingClientRect()
      setBubblePos({
        left: rect.right + 14,
        bottom: window.innerHeight - rect.bottom
      })
    }
  }, [showConfigMenu, isDesktop])

  useEffect(() => {
    const parent = shellRef.current?.parentElement
    if (!parent) return

    const prevFlexWrap = parent.style.flexWrap
    const prevAlignContent = parent.style.alignContent
    parent.style.flexWrap = 'wrap'
    parent.style.alignContent = 'flex-start'

    return () => {
      parent.style.flexWrap = prevFlexWrap
      parent.style.alignContent = prevAlignContent
    }
  }, [])

  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev }
      let changed = false
      resolvedSectorNav.forEach((item) => {
        if (!item.subItems) return
        const isMatch = pathname === item.href.split('?')[0] || item.subItems.some((sub) => pathname === sub.href.split('?')[0])
        if (isMatch && next[item.label] === undefined) {
          next[item.label] = true
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [pathname, resolvedSectorNav])

  const handleNav = (fn: () => void) => {
    fn()
    setMobileOpen(false)
  }

  const canCollapseDesktop = allowDesktopCollapse && isDesktop

  const renderNav = (nav: NavItem[], depth = 0): React.ReactNode => nav.map((item) => {
    const isTabItem = !!onTabChange && !!item.tab
    const isGroup = !!item.subItems?.length
    const isExpanded = expandedGroups[item.label] || false

    let isActive = false
    if (isTabItem) {
      isActive = activeTab === item.tab
    } else {
      const [hrefPath, hrefQuery = ''] = item.href.split('?')
      if (pathname === hrefPath && item.href !== '#') {
        if (!hrefQuery) {
          isActive = !searchParams.get('tab') && !searchParams.get('action')
        } else {
          const query = new URLSearchParams(hrefQuery)
          let match = true
          query.forEach((value, key) => {
            if (searchParams.get(key) !== value) {
              if (!(key === 'tab' && value === 'kanban' && !searchParams.get('tab') && !searchParams.get('action'))) {
                match = false
              }
            }
          })
          isActive = match
        }
      }

      if (!isActive && hrefPath === '/comercial-digital' && pathname.startsWith('/comercial-digital')) {
        isActive = true
      }
      if (!isActive && hrefPath === '/cliente/relatorios' && pathname.startsWith('/cliente/relatorios')) {
        isActive = true
      }
    }

    function handleClick() {
      if (isGroup) {
        setExpandedGroups((prev) => ({ ...prev, [item.label]: !prev[item.label] }))
        if (item.href === '#') return
      }
      if (isTabItem && item.tab) {
        handleNav(() => onTabChange(item.tab!))
        return
      }
      if (item.href === '#') return
      if (item.href.startsWith('http')) {
        handleNav(() => window.open(item.href, '_blank', 'noopener,noreferrer'))
        return
      }
      handleNav(() => router.push(item.href))
    }

    return (
      <div key={item.href + item.label} className={styles.navNode}>
        <button
          type="button"
          className={`${styles.navItem} ${isActive ? styles.navItemActive : ''} ${item.href === '#' && !isGroup && !isTabItem ? styles.navItemMuted : ''}`}
          onClick={handleClick}
          style={{ paddingLeft: depth > 0 ? 18 + depth * 16 : 14 }}
        >
          <span className={styles.navIcon}>{item.icon}</span>
          <span className={styles.navCopy}>{item.label}</span>
          {item.action && (
            <div
              className={styles.navAction}
              onClick={(e) => { e.stopPropagation(); item.action!.onClick(); }}
              title="Criar nova lista/setor"
            >
              {item.action.icon}
            </div>
          )}
          {isGroup && <span className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}>›</span>}
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
      <WorkspaceTopbar
        subtitle={topbarSubtitle}
        activeId={getTopbarActiveId(pathname)}
        navItems={topbarNavItems}
        brandHref={isClient ? '/cliente' : '/setores'}
        onMenuClick={() => setMobileOpen(true)}
        onLogout={onLogout}
      />

      <div className={`${styles.shell} ${canCollapseDesktop && desktopCollapsed ? styles.shellCollapsed : ''}`} ref={shellRef}>
        <div
          className={`${styles.overlay} ${mobileOpen ? styles.overlayVisible : ''}`}
          onClick={() => setMobileOpen(false)}
        />

        {allowDesktopCollapse && (
          <button
            type="button"
            className={`${styles.collapseToggle} ${canCollapseDesktop && desktopCollapsed ? styles.collapseToggleCollapsed : ''}`}
            onClick={() => {
              setDesktopCollapsed((prev) => !prev)
              setShowConfigMenu(false)
            }}
            aria-label={desktopCollapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            title={desktopCollapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          >
            <span className={`${styles.collapseToggleChevron} ${canCollapseDesktop && desktopCollapsed ? styles.collapseToggleChevronCollapsed : ''}`}>‹</span>
          </button>
        )}

        <aside
          className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''} ${canCollapseDesktop && desktopCollapsed ? styles.sidebarCollapsed : ''}`}
          aria-hidden={canCollapseDesktop && desktopCollapsed}
        >
          <div className={styles.sidebarHead}>
            <div className={styles.sidebarEyebrow}>{isClient ? 'Área' : 'Setor'}</div>
            <div className={styles.sidebarTitle}>{resolvedSectorTitle}</div>
            <p className={styles.sidebarText}>{contextDescription}</p>
          </div>

          <div className={styles.navSection}>
            <div className={styles.navLabel}>Navegação contextual</div>
            <div className={styles.navList}>
              {renderNav(resolvedSectorNav)}
            </div>
          </div>

          {!isClient && (
            <div className={styles.footer}>
              <div className={styles.configWrap} ref={configWrapRef}>
                <button
                  type="button"
                  className={`${styles.footerButton} ${showConfigMenu ? styles.footerButtonActive : ''}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setShowConfigMenu((prev) => !prev)
                  }}
                >
                  <span className={styles.footerButtonIcon}>
                    <Ico><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></Ico>
                  </span>
                  <span>Configurações</span>
                </button>

                {showConfigMenu && (
                  isDesktop ? createPortal(
                    <div
                      className={styles.configBubble}
                      ref={bubbleRef}
                      style={{ position: 'fixed', left: bubblePos.left, bottom: bubblePos.bottom }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className={styles.configBubbleTitle}>Administração</div>
                      <div className={styles.configBubbleList}>
                        {renderNav(cadastrarNav)}
                      </div>
                    </div>,
                    document.body
                  ) : (
                    <div
                      className={styles.configBubble}
                      ref={bubbleRef}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className={styles.configBubbleTitle}>Administração</div>
                      <div className={styles.configBubbleList}>
                        {renderNav(cadastrarNav)}
                      </div>
                    </div>
                  )
                )}
              </div>

              <div className={styles.footerCard}>
                <span className={styles.footerCardLabel}>Operação</span>
                <strong className={styles.footerCardValue}>{sess?.user || 'NGP'}</strong>
                <span className={styles.footerCardMeta}>{sess?.role === 'admin' ? 'Acesso administrativo' : 'Acesso interno'}</span>
              </div>
            </div>
          )}
        </aside>

        {showQuickSector && (
          <QuickSectorModal
            onClose={() => {
              setShowQuickSector(false)
              setQuickSectorClientId(undefined)
            }}
            clientId={quickSectorClientId}
            onSaved={refreshTasksData}
          />
        )}
      </div>
    </>
  )
}

const MemoSidebar = React.memo(SidebarInner)

export default function Sidebar(props: Props) {
  return (
    <Suspense fallback={null}>
      <MemoSidebar {...props} />
    </Suspense>
  )
}
