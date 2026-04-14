'use client'
import React from 'react'
import Sidebar from '@/components/Sidebar'
import styles from './comercial.module.css'
import { getSession } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

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
        sectorNav={[
          {
            icon: <Ico><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Ico>,
            label: 'Gestão',
            href: '/comercial/gestao'
          },
          {
            icon: <Ico><path d="M22 11.5C22 15.5 18.5 18 14 18c-4.5 0-8-2.5-8-6.5 0-1.5.5-3 1.5-4l.5-1c.5-.5 1-1 1.5-1s1 .5 1.5 1l.5 1c1 1 1.5 2.5 1.5 4z"/><path d="M12 2v20"/><path d="M12 12h10"/></Ico>,
            label: 'Pipeline',
            href: '/comercial/pipeline'
          },
          {
            icon: <Ico><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></Ico>,
            label: 'Propostas',
            href: '/comercial/propostas'
          },
          {
            icon: <Ico><path d="M16 2C16 2 12 6 12 6s-4-4-4-4"/><path d="M20 2C20 2 16 6 16 6s-4-4-4-4"/><path d="M12 18C12 18 8 22 8 22s-4-4-4-4"/><path d="M16 18C16 18 12 22 12 22s-4-4-4-4"/><path d="M12 6v12"/></Ico>,
            label: 'Contratos',
            href: '/comercial/contratos'
          },
          {
            icon: <Ico><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></Ico>,
            label: 'Metas e KPIs',
            href: '/comercial/kpis'
          },
        ]}
      />
      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.eyebrow}>Setor Comercial</div>
            <h1 className={styles.title}>Gestão Comercial</h1>
            <p className={styles.subtitle}>CRM, pipeline de vendas e gestão de oportunidades da NGP Space.</p>
          </header>

          <section className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>Pipeline de Vendas</h3>
                <p className={styles.cardDesc}>Acompanhe a jornada dos leads desde o primeiro contato até o fechamento.</p>
              </div>
              <div className={styles.cardArrow}>→</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>Gestão de CRM</h3>
                <p className={styles.cardDesc}>Base de dados de clientes, históricos de interação e contatos.</p>
              </div>
              <div className={styles.cardArrow}>→</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>Propostas e Contratos</h3>
                <p className={styles.cardDesc}>Criação e controle de propostas comerciais enviadas aos clientes.</p>
              </div>
              <div className={styles.cardArrow}>→</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>Metas e KPIs</h3>
                <p className={styles.cardDesc}>Análise de performance de vendas e atingimento de metas mensais.</p>
              </div>
              <div className={styles.cardArrow}>→</div>
            </div>
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
