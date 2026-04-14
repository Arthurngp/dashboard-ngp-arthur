import React from 'react'

const IcoGrid = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
const IcoPipe = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
const IcoDoc  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
const IcoSign = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><path d="M20 14.66V20a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg>
const IcoKpi  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>

export const comercialNav = [
  { icon: <IcoGrid />, label: 'Gestão',      href: '/comercial/gestao' },
  { 
    icon: <IcoPipe />, 
    label: 'Pipeline',    
    href: '/comercial/pipeline',
    subItems: [
      { icon: <div style={{width: 14}}/>, label: 'Meus Funis', href: '/comercial/pipeline', tab: 'kanban' },
      { icon: <div style={{width: 14}}/>, label: 'Cadastrar Campos', href: '/comercial/pipeline', tab: 'fields' },
      { icon: <div style={{width: 14}}/>, label: 'Novo Funil', href: '/comercial/pipeline', tab: 'new_pipeline' },
    ]
  },
  { icon: <IcoDoc  />, label: 'Propostas',   href: '/comercial/propostas' },
  { icon: <IcoSign />, label: 'Contratos',   href: '/comercial/contratos' },
  { icon: <IcoKpi  />, label: 'Metas e KPIs', href: '/comercial/kpis' },
]
