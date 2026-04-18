import { useState } from 'react'
import { PageContainer } from '@/components/layout/PageContainer'
import { cn } from '@/lib/utils'
import { PedidosTab } from './PedidosTab'
import { CalendarioTab } from './CalendarioTab'
import { StockCongeladosTab } from './StockCongeladosTab'

type Tab = 'pedidos' | 'calendario' | 'stock'

const ayudaPorTab: Record<Tab, { titulo: string; pasos: string[] }> = {
  pedidos: {
    titulo: 'Pedidos del almacén',
    pasos: [
      'Cargá los pedidos que llegan por WhatsApp o en el local.',
      'Completá cliente, producto, cantidad, fecha de entrega y turno.',
      'Cambiá el estado del pedido con un click (pendiente → en preparación → listo → entregado).',
      'Filtrá por estado para ver solo los pendientes o los del día.',
    ],
  },
  calendario: {
    titulo: 'Calendario de producción',
    pasos: [
      'Vista semanal de lo que hay que producir cada día.',
      'Agrupado por producto y coloreado por estado.',
      'Útil para la pastelera, panadero y jefes de cocina.',
      'Navegá entre semanas con las flechas.',
    ],
  },
  stock: {
    titulo: 'Stock de congelados',
    pasos: [
      'Muestra el stock actual de productos congelados.',
      'El stock se calcula: producción - pedidos entregados - traspasos - merma.',
      'Los productos bajo mínimo aparecen en amarillo, sin stock en rojo.',
    ],
  },
}

export function AlmacenPage() {
  const [tab, setTab] = useState<Tab>('pedidos')
  const [ayudaAbierta, setAyudaAbierta] = useState(false)

  return (
    <PageContainer title="Almacén" subtitle="Pedidos, calendario y stock de congelados — Saavedra">
      <div className="flex items-center gap-1 mb-6 border-b border-surface-border">
        <TabButton activo={tab === 'pedidos'} onClick={() => setTab('pedidos')}>Pedidos</TabButton>
        <TabButton activo={tab === 'calendario'} onClick={() => setTab('calendario')}>Calendario</TabButton>
        <TabButton activo={tab === 'stock'} onClick={() => setTab('stock')}>Stock congelados</TabButton>
        <button
          onClick={() => setAyudaAbierta(true)}
          className="ml-auto mb-2 w-8 h-8 rounded-full bg-rodziny-100 text-rodziny-700 hover:bg-rodziny-200 flex items-center justify-center text-sm font-bold transition-colors"
          title="Ayuda"
        >?</button>
      </div>

      {tab === 'pedidos' && <PedidosTab />}
      {tab === 'calendario' && <CalendarioTab />}
      {tab === 'stock' && <StockCongeladosTab />}

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
