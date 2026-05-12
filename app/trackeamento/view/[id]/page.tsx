import { Suspense } from 'react'
import { FormViewerPage } from '@/components/trackeamento/viewer/FormViewerPage'

export default async function TrackeamentoViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="trackeamento-theme">
      <Suspense>
        <FormViewerPage id={id} />
      </Suspense>
    </div>
  )
}
