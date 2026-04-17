import { PageContainer } from '@/components/layout/PageContainer'
import { FudoLiveTab } from './components/FudoLiveTab'

export function VentasPage({ embedded = false }: { embedded?: boolean } = {}) {
  const inner = <FudoLiveTab />

  if (embedded) return inner
  return (
    <PageContainer title="Ventas" subtitle="Análisis de ventas en tiempo real desde Fudo">
      {inner}
    </PageContainer>
  )
}
