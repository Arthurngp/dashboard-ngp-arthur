'use client'

import { useParams } from 'next/navigation'
import { ResultsPage } from '@/components/trackeamento/results/ResultsPage'
import TrackeamentoShell from '@/components/trackeamento/TrackeamentoShell'
import { TRACKEAMENTO_BASE_PATH } from '@/lib/trackeamento/constants'

export default function TrackeamentoResultsRoute() {
  const params = useParams<{ id: string }>()

  return (
    <TrackeamentoShell loadingText="Carregando resultados...">
      <ResultsPage id={params.id} basePath={TRACKEAMENTO_BASE_PATH} />
    </TrackeamentoShell>
  )
}
