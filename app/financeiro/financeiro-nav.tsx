import React from 'react'

const IcoList    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
const IcoUsers   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
const IcoTag     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
const IcoBank    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><rect x="3" y="10" width="18" height="11" rx="1"/><path d="M12 2L2 7h20L12 2z"/><line x1="12" y1="10" x2="12" y2="21"/><line x1="7" y1="10" x2="7" y2="21"/><line x1="17" y1="10" x2="17" y2="21"/></svg>
const IcoDre     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
const IcoIA      = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><path d="M12 2a4 4 0 00-4 4v1H7a4 4 0 00-4 4v3a4 4 0 004 4h1v1a4 4 0 004 4 4 4 0 004-4v-1h1a4 4 0 004-4v-3a4 4 0 00-4-4h-1V6a4 4 0 00-4-4z"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/></svg>
const IcoGrid    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
const IcoCard    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>

export const financeiroNav = [
  { icon: <IcoGrid  />, label: 'Dashboard',        href: '/financeiro/dashboard' },
  { icon: <IcoList  />, label: 'Transações',       href: '/financeiro' },
  { icon: <IcoBank  />, label: 'Bancos e Carteiras', href: '/financeiro?tab=contas' },
  { icon: <IcoCard  />, label: 'Cartões',          href: '/financeiro/cartoes' },
  { icon: <IcoDre   />, label: 'DRE',              href: '/financeiro/dre' },
  { icon: <IcoUsers />, label: 'Contatos',          href: '/financeiro?tab=contatos' },
  { icon: <IcoTag   />, label: 'Categorias',        href: '/financeiro?tab=categorias' },
  { icon: <IcoIA    />, label: 'IA Analista',       href: '/financeiro/analista' },
]
