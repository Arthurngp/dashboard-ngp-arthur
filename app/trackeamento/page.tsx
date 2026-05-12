'use client'

import { DashboardPage } from '@/components/trackeamento/dashboard/DashboardPage'
import TrackeamentoShell from '@/components/trackeamento/TrackeamentoShell'
import { TRACKEAMENTO_BASE_PATH } from '@/lib/trackeamento/constants'

export default function TrackeamentoPage() {
  return (
    <TrackeamentoShell loadingText="Carregando formulários...">
      <DashboardPage basePath={TRACKEAMENTO_BASE_PATH} showNavbar={false} />
    </TrackeamentoShell>
  )
}
