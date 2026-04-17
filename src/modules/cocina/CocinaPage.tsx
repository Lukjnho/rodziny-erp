import { useState } from 'react'
import { PageContainer } from '@/components/layout/PageContainer'
import { cn } from '@/lib/utils'
import { DashboardTab } from './DashboardTab'
import { ProduccionTab } from './ProduccionTab'
import { StockTab } from './StockTab'
import { TraspasosTab } from './TraspasosTab'
import { RecetasTab } from './RecetasTab'
import { ProductosTab } from './ProductosTab'

type Tab = 'dashboard' | 'produccion' | 'stock' | 'traspasos' | 'recetas' | 'productos' | 'historico'

const ayudaPorTab: Record<Tab, { titulo: string; pasos: string[] }> = {
  dashboard: {
    titulo: 'Dashboard de cocina',
    pasos: [
      'Muestra el stock actual de salsas y postres con semáforo de estado.',
      'Las ventas promedio se calculan automáticamente de Fudo (últimos 14 días).',
      'Indica cuántos días de stock te quedan y cuánto producir.',
      'Hacé click en "Cargar" o "Editar" para actualizar el stock (en kg para salsas, unidades para postres).',
    ],
  },
  produccion: {
    titulo: 'Producción del día',
    pasos: [
      'Registrá los lotes de relleno que se producen: receta, cantidad de recetas y peso total.',
      'Registrá los lotes de pasta: producto, relleno usado, masa, y porciones finales.',
      'El código de lote se genera automáticamente (ej: sor-1604).',
      'Usá las flechas de fecha para ver la producción de otros días.',
    ],
  },
  stock: {
    titulo: 'Stock en depósito',
    pasos: [
      'Muestra el stock actual de cada producto en el depósito de pastas.',
      'El stock se calcula automáticamente: producción - traspasos - merma.',
      'Los productos bajo mínimo aparecen en amarillo, sin stock en rojo.',
    ],
  },
  traspasos: {
    titulo: 'Traspasos y merma',
    pasos: [
      'Registrá los traspasos de depósito al freezer del mostrador.',
      'Estos números son los que se copian a Fudo.',
      'También podés registrar merma (rotura, vencimiento, etc.).',
    ],
  },
  recetas: {
    titulo: 'Recetas',
    pasos: [
      'Cargá las recetas de rellenos, masas y salsas.',
      'Indicá el rendimiento en kg y/o porciones por receta.',
      'Las recetas se usan al registrar producción.',
    ],
  },
  productos: {
    titulo: 'Productos',
    pasos: [
      'Cargá los productos que se fabrican: pastas, salsas, postres.',
      'El código (ej: sor, rav) se usa para generar el código de lote.',
      'El mínimo de producción indica cuánto producir como mínimo.',
    ],
  },
  historico: {
    titulo: 'Histórico',
    pasos: ['Próximamente: tendencias de producción, rendimientos y exportación.'],
  },
}

export function CocinaPage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [ayudaAbierta, setAyudaAbierta] = useState(false)

  return (
    <PageContainer title="Cocina" subtitle="Producción y stock — Rodziny S.A.S.">
      <div className="flex items-center gap-1 mb-6 border-b border-surface-border">
        <TabButton activo={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Dashboard</TabButton>
        <TabButton activo={tab === 'produccion'} onClick={() => setTab('produccion')}>Producción</TabButton>
        <TabButton activo={tab === 'stock'} onClick={() => setTab('stock')}>Stock depósito</TabButton>
        <TabButton activo={tab === 'traspasos'} onClick={() => setTab('traspasos')}>Traspasos</TabButton>
        <TabButton activo={tab === 'recetas'} onClick={() => setTab('recetas')}>Recetas</TabButton>
        <TabButton activo={tab === 'productos'} onClick={() => setTab('productos')}>Productos</TabButton>
        <TabButton activo={tab === 'historico'} onClick={() => setTab('historico')}>Histórico</TabButton>
        <button
          onClick={() => setAyudaAbierta(true)}
          className="ml-auto mb-2 w-8 h-8 rounded-full bg-rodziny-100 text-rodziny-700 hover:bg-rodziny-200 flex items-center justify-center text-sm font-bold transition-colors"
          title="Ayuda"
        >?</button>
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'produccion' && <ProduccionTab />}
      {tab === 'stock' && <StockTab />}
      {tab === 'traspasos' && <TraspasosTab />}
      {tab === 'recetas' && <RecetasTab />}
      {tab === 'productos' && <ProductosTab />}
      {tab === 'historico' && <HistoricoPlaceholder />}

      {ayudaAbierta && <AyudaPanel tab={tab} onClose={() => setAyudaAbierta(false)} />}
    </PageContainer>
  )
}

function TabButton({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
        activo
          ? 'border-rodziny-500 text-rodziny-700'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      )}
    >
      {children}
    </button>
  )
}

function HistoricoPlaceholder() {
  return (
    <div className="bg-white rounded-lg border border-surface-border p-12 text-center">
      <div className="text-4xl mb-3">📊</div>
      <h3 className="text-lg font-semibold text-gray-700 mb-1">Histórico de producción</h3>
      <p className="text-sm text-gray-500">Próximamente: tendencias, gráficos y exportación.</p>
    </div>
  )
}

function AyudaPanel({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const info = ayudaPorTab[tab]
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative w-96 h-full bg-white shadow-xl p-6 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-lg">✕</button>
        <h3 className="text-lg font-bold text-gray-800 mb-4">{info.titulo}</h3>
        <ol className="space-y-3">
          {info.pasos.map((p, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-600">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-rodziny-100 text-rodziny-700 flex items-center justify-center text-xs font-bold">
                {i + 1}
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
