'use client'
import React from 'react'
import Sidebar from '@/components/Sidebar'
import styles from './comercial.module.css'
import { getSession } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { comercialNav } from './comercial-nav'

// Helper for icons to avoid repetition
const Ico = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    {children}
  </svg>
)

export default function ComercialPage() {

  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    setSess(s)
  }, [router])

  if (!sess) return null

  return (
    <div className={styles.layout}>
      <Sidebar
        minimal={true}
        sectorNavTitle="COMERCIAL"
        sectorNav={comercialNav}
        onTabChange={(tab) => {
          if (tab === 'fields') router.push('/comercial/pipeline?tab=fields')
          else if (tab === 'kanban') router.push('/comercial/pipeline?tab=kanban')
          else if (tab === 'new_pipeline') router.push('/comercial/pipeline?action=new_pipeline')
        }}
      />
      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.eyebrow}>Setor Comercial</div>
            <h1 className={styles.title}>Gestão Comercial</h1>
            <p className={styles.subtitle}>CRM, pipeline de vendas e gestão de oportunidades da NGP Space.</p>
          </header>

          <section className={styles.grid}>
            <button className={styles.card} onClick={() => router.push('/comercial/pipeline')}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>Pipeline de Vendas</h3>
                <p className={styles.cardDesc}>Acompanhe a jornada dos leads desde o primeiro contato até o fechamento.</p>
              </div>
              <div className={styles.cardArrow}>→</div>
            </button>
            <button className={styles.card} onClick={() => router.push('/comercial/gestao')}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>Gestão de CRM</h3>
                <p className={styles.cardDesc}>Base de dados de clientes, históricos de interação e contatos.</p>
              </div>
              <div className={styles.cardArrow}>→</div>
            </button>
            <button className={styles.card} onClick={() => router.push('/comercial/propostas')}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>Propostas e Contratos</h3>
                <p className={styles.cardDesc}>Criação e controle de propostas comerciais enviadas aos clientes.</p>
              </div>
              <div className={styles.cardArrow}>→</div>
            </button>
            <button className={styles.card} onClick={() => router.push('/comercial/kpis')}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>Metas e KPIs</h3>
                <p className={styles.cardDesc}>Análise de performance de vendas e atingimento de metas mensais.</p>
              </div>
              <div className={styles.cardArrow}>→</div>
            </button>
          </section>

          <footer className={styles.footer}>
            <span className={styles.footerDot} />
            Conectado ao Supabase · {sess.user}
          </footer>
        </div>
      </main>
    </div>
  )
}
