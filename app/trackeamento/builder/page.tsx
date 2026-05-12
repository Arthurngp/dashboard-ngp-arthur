'use client'

import { BuilderPage } from '@/components/trackeamento/builder/BuilderPage'
import TrackeamentoShell from '@/components/trackeamento/TrackeamentoShell'
import { TRACKEAMENTO_BASE_PATH } from '@/lib/trackeamento/constants'

export default function TrackeamentoBuilderRoute() {
  return (
    <TrackeamentoShell loadingText="Carregando builder...">
      <BuilderPage basePath={TRACKEAMENTO_BASE_PATH} />
    </TrackeamentoShell>
  )
}
