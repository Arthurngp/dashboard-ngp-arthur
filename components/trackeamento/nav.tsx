import React from 'react'

const IcoGrid = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
)

const IcoPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
)

export const trackeamentoNav = [
  { icon: <IcoGrid />, label: 'Formulários', href: '/trackeamento' },
  { icon: <IcoPlus />, label: 'Novo formulário', href: '/trackeamento/builder?new=1' },
]
