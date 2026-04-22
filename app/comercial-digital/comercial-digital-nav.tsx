import React from 'react'

const IcoGrid = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
const IcoPipe = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>

export const comercialDigitalNav = [
  { icon: <IcoGrid />, label: 'Gestão', href: '/comercial-digital' },
  {
    icon: <IcoPipe />,
    label: 'Pipeline',
    href: '/comercial-digital/pipeline',
    subItems: [
      { icon: <div style={{ width: 14 }} />, label: 'Meu CRM', href: '/comercial-digital/pipeline', tab: 'kanban' },
      { icon: <div style={{ width: 14 }} />, label: 'Funil', href: '/comercial-digital/pipeline', tab: 'funil' },
      { icon: <div style={{ width: 14 }} />, label: 'Campos', href: '/comercial-digital/pipeline', tab: 'fields' },
      { icon: <div style={{ width: 14 }} />, label: 'Novo Funil', href: '/comercial-digital/pipeline', tab: 'new_pipeline' },
    ],
  },
]
