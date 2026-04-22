import React from 'react'

type ClientNavOptions = {
  analyticsEnabled: boolean
  reportsEnabled: boolean
  crmEnabled: boolean
}

type ClientNavItem = {
  icon: React.ReactNode
  label: string
  href: string
  tab?: string
  subItems?: ClientNavItem[]
}

const IcoAnalytics = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
    <path d="M4 19h16" />
    <path d="M7 16V9" />
    <path d="M12 16V5" />
    <path d="M17 16v-3" />
    <circle cx="7" cy="9" r="1.5" />
    <circle cx="12" cy="5" r="1.5" />
    <circle cx="17" cy="13" r="1.5" />
  </svg>
)

const IcoCrm = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)

export function buildClientPortalNav({ analyticsEnabled, reportsEnabled, crmEnabled }: ClientNavOptions) {
  const nav: ClientNavItem[] = []

  if (analyticsEnabled || reportsEnabled) {
    nav.push({
      icon: <IcoAnalytics />,
      label: 'Análise de Dados e Relatórios',
      href: '/cliente/relatorios',
    })
  }

  if (crmEnabled) {
    nav.push({
      icon: <IcoCrm />,
      label: 'Comercial Digital',
      href: '/comercial-digital',
      subItems: [
        { icon: <div style={{ width: 14 }} />, label: 'Meu CRM', href: '/comercial-digital/pipeline', tab: 'kanban' },
        { icon: <div style={{ width: 14 }} />, label: 'Funil', href: '/comercial-digital/pipeline', tab: 'funil' },
        { icon: <div style={{ width: 14 }} />, label: 'Campos', href: '/comercial-digital/pipeline', tab: 'fields' },
        { icon: <div style={{ width: 14 }} />, label: 'Novo Funil', href: '/comercial-digital/pipeline', tab: 'new_pipeline' },
      ],
    })
  }

  return nav
}
