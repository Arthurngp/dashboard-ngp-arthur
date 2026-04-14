'use client'
import React from 'react'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import styles from '../comercial.module.css'
import { getSession } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { comercialNav } from '../comercial-nav'

export default function KpisPage() {
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
            <h1 className={styles.title}>Metas e KPIs</h1>
            <p className={styles.subtitle}>Indicadores de performance e metas de vendas.</p>
          </header>
          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>Dashboard de Metas</h3>
                <p className={styles.cardDesc}>Visualize a porcentagem de atingimento das metas.</p>
              </div>
              <div className={styles.cardArrow}>→</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
