import { useState, useMemo } from 'react'
import { PageContainer } from '@/components/layout/PageContainer'
import { UploadFudo } from './components/UploadFudo'
import { CierreCaja } from './components/CierreCaja'
import { FlujoCaja } from './components/FlujoCaja'
import { VentasPage } from '@/modules/ventas/VentasPage'
import { GastosPage } from '@/modules/gastos/GastosPage'
import { EstadoResultados } from './edr/EstadoResultados'
import { AmortizacionesPage } from './amortizaciones/AmortizacionesPage'
import { ConciliacionBancaria } from './conciliacion/ConciliacionBancaria'
import { useAuth, type Modulo } from '@/lib/auth'
import { cn } from '@/lib/utils'

type Tab =
  | 'ventas'
  | 'compras'
  | 'edr'
  | 'flujo'
  | 'amortizaciones'
  | 'conciliacion'
  | 'cierres'
  | 'importar'

interface TabDef {
  id: Tab
  label: string
  icon: string
  subtitle: string
  modulo: Modulo
}

const TABS: TabDef[] = [
  { id: 'ventas',         label: 'Resumen de Ventas',  icon: '📈', subtitle: 'Análisis de ventas por período',           modulo: 'ventas' },
  { id: 'compras',        label: 'Resumen de Compras', icon: '🧾', subtitle: 'Gastos, proveedores y análisis',           modulo: 'gastos' },
  { id: 'edr',            label: 'EdR',                icon: '📋', subtitle: 'Estado de Resultados mensual por local',   modulo: 'edr' },
  { id: 'flujo',          label: 'Flujo de caja',      icon: '💰', subtitle: 'Movimientos bancarios y efectivo',         modulo: 'finanzas' },
  { id: 'amortizaciones', label: 'Amortizaciones',     icon: '📉', subtitle: 'Inversiones y depreciación mensual',       modulo: 'amortizaciones' },
  { id: 'conciliacion',   label: 'Conciliación',       icon: '🏦', subtitle: 'Conciliación bancaria con MercadoPago',    modulo: 'finanzas' },
  { id: 'cierres',        label: 'Cierres de caja',    icon: '📦', subtitle: 'Cierres diarios por local',                modulo: 'finanzas' },
  { id: 'importar',       label: 'Importar datos',     icon: '📂', subtitle: 'Importar exports de Fudo / bancos',        modulo: 'finanzas' },
]

export function FinanzasPage() {
  const { tienePermiso } = useAuth()

  const tabsVisibles = useMemo(
    () => TABS.filter((t) => tienePermiso(t.modulo)),
    [tienePermiso]
  )

  const [tab, setTab] = useState<Tab>(tabsVisibles[0]?.id ?? 'flujo')

  const tabActual = tabsVisibles.find((t) => t.id === tab) ?? tabsVisibles[0]

  if (!tabActual) {
    return (
      <PageContainer title="Finanzas">
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          No tenés acceso a ninguna sección de Finanzas.
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer title="Finanzas" subtitle={tabActual.subtitle}>
      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {tabsVisibles.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              tab === t.id
                ? 'border-rodziny-600 text-rodziny-800'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            <span className="mr-1">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'ventas'         && <VentasPage embedded />}
      {tab === 'compras'        && <GastosPage embedded />}
      {tab === 'edr'            && <EstadoResultados embedded />}
      {tab === 'flujo'          && <FlujoCaja />}
      {tab === 'amortizaciones' && <AmortizacionesPage embedded />}
      {tab === 'conciliacion'   && <ConciliacionBancaria />}
      {tab === 'cierres'        && <CierreCaja />}
      {tab === 'importar'       && <UploadFudo />}
    </PageContainer>
  )
}
