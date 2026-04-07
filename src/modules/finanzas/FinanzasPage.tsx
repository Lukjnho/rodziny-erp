import { useState } from 'react'
import { PageContainer } from '@/components/layout/PageContainer'
import { UploadFudo } from './components/UploadFudo'
import { CierreCaja } from './components/CierreCaja'
import { FlujoCaja } from './components/FlujoCaja'
import { cn } from '@/lib/utils'

type Tab = 'flujo' | 'importar' | 'cierres'

export function FinanzasPage() {
  const [tab, setTab] = useState<Tab>('flujo')

  return (
    <PageContainer title="Finanzas" subtitle="Flujo de caja · Extractos bancarios · Cierres">
      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([['flujo', '💰 Flujo de caja'], ['cierres', '📦 Cierres de caja'], ['importar', '📂 Importar datos']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              tab === t ? 'border-rodziny-600 text-rodziny-800' : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'flujo'    && <FlujoCaja />}
      {tab === 'cierres'  && <CierreCaja />}
      {tab === 'importar' && <UploadFudo />}
    </PageContainer>
  )
}
