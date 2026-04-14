'use client'
import React from 'react'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import styles from '../comercial.module.css'
import { getSession } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { comercialNav } from '../comercial-nav'

export default function ContratosPage() {
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
            <h1 className={styles.title}>Contratos</h1>
            <p className={styles.subtitle}>Gestão de contratos assinados e vigentes.</p>
          </header>
          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>Repositório de Contratos</h3>
                <p className={styles.cardDesc}>Acesse todos os contratos arquivados por cliente.</p>
              </div>
              <div className={styles.cardArrow}>→</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
