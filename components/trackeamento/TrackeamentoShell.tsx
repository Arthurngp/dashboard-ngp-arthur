'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import NGPLoading from '@/components/NGPLoading'
import WorkspaceTopbar from '@/components/WorkspaceTopbar'
import { getSession } from '@/lib/auth'
import styles from '@/components/trackeamento/TrackeamentoShell.module.css'

export default function TrackeamentoShell({
  children,
  loadingText = 'Carregando NGP Forms...',
}: {
  children: React.ReactNode
  loadingText?: string
}) {
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    const sess = getSession()
    if (!sess || sess.auth !== '1') {
      router.replace('/login')
      return
    }
    if (sess.role !== 'ngp' && sess.role !== 'admin') {
      router.replace('/cliente')
      return
    }
    setAuthorized(true)
  }, [router])

  if (!authorized) {
    return <NGPLoading loading loadingText={loadingText} />
  }

  return (
    <div className={styles.layout}>
      <WorkspaceTopbar
        subtitle="NGP Forms"
        activeId="trackeamento"
        brandHref="/setores"
      />
      <main className={`${styles.main} trackeamento-theme`}>{children}</main>
    </div>
  )
}
