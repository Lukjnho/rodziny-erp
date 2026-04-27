import { useState } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';
import { DashboardTab } from './DashboardTab';
import { ProduccionTab } from './ProduccionTab';
import { StockTab } from './StockTab';
import { TraspasosTab } from './TraspasosTab';
import { RecetasTab } from './RecetasTab';
import { AnalisisTab } from './AnalisisTab';
import { CalendarioTab } from './CalendarioTab';

type Tab =
  | 'dashboard'
  | 'produccion'
  | 'stock'
  | 'traspasos'
  | 'recetas'
  | 'analisis'
  | 'calendario';

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
    titulo: 'Stock',
    pasos: [
      'Muestra el stock actual por producto en sus tres ubicaciones: Pastas en produ (frescas sin porcionar), En cámara (depósito), En mostrador (listas para venta).',
      'El stock en cámara se calcula como: producción en cámara − traspasos históricos − merma.',
      'El stock en mostrador se calcula como: traspasos de hoy − ventas Fudo de hoy − merma de hoy. Solo Vedia tiene ventas automáticas desde Fudo.',
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
  analisis: {
    titulo: 'Análisis',
    pasos: [
      'Rendimiento real vs. teórico: compara lo que rindió cada receta contra lo que tendría que rendir según la ficha.',
      'Desvíos >10% en rojo sugieren actualizar la receta o revisar el proceso.',
      'Merma por producto: muestra qué se descarta más y por qué. Lo que aparece en rojo requiere atención.',
      'Cambiá el período (7/30/90 días) para ver tendencias más o menos recientes.',
    ],
  },
  calendario: {
    titulo: 'Calendario de efemérides',
    pasos: [
      'Listado de fechas gastronómicas relevantes (Día de la Pasta, San Valentín, Día del Ñoqui, etc.) para planificar menú, promos y contenido de redes.',
      'El dashboard muestra automáticamente las próximas 15 días — usalo como guía de planificación.',
      'Podés filtrar por mes, categoría y estado (activa/inactiva).',
      'Cargá tu propia idea de plato o acción en cada fecha — queda guardada para el año siguiente.',
      'Las "recurrentes mensuales" (ej. Día del Ñoqui 29) aparecen en cada mes sin tener que duplicar.',
    ],
  },
};

export function CocinaPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [ayudaAbierta, setAyudaAbierta] = useState(false);

  return (
    <PageContainer title="Cocina" subtitle="Producción y stock — Rodziny S.A.S.">
      <div className="mb-6 flex items-center gap-1 border-b border-surface-border">
        <TabButton activo={tab === 'dashboard'} onClick={() => setTab('dashboard')}>
          Dashboard
        </TabButton>
        <TabButton activo={tab === 'produccion'} onClick={() => setTab('produccion')}>
          Producción
        </TabButton>
        <TabButton activo={tab === 'stock'} onClick={() => setTab('stock')}>
          Stock
        </TabButton>
        <TabButton activo={tab === 'traspasos'} onClick={() => setTab('traspasos')}>
          Traspasos
        </TabButton>
        <TabButton activo={tab === 'recetas'} onClick={() => setTab('recetas')}>
          Recetas
        </TabButton>
        <TabButton activo={tab === 'analisis'} onClick={() => setTab('analisis')}>
          Análisis
        </TabButton>
        <TabButton activo={tab === 'calendario'} onClick={() => setTab('calendario')}>
          Calendario
        </TabButton>
        <button
          onClick={() => setAyudaAbierta(true)}
          className="hover:bg-rodziny-200 mb-2 ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-rodziny-100 text-sm font-bold text-rodziny-700 transition-colors"
          title="Ayuda"
        >
          ?
        </button>
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'produccion' && <ProduccionTab />}
      {tab === 'stock' && <StockTab />}
      {tab === 'traspasos' && <TraspasosTab />}
      {tab === 'recetas' && <RecetasTab />}
      {tab === 'analisis' && <AnalisisTab />}
      {tab === 'calendario' && <CalendarioTab />}

      {ayudaAbierta && <AyudaPanel tab={tab} onClose={() => setAyudaAbierta(false)} />}
    </PageContainer>
  );
}

function TabButton({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
        activo
          ? 'border-rodziny-500 text-rodziny-700'
          : 'border-transparent text-gray-500 hover:text-gray-700',
      )}
    >
      {children}
    </button>
  );
}

function AyudaPanel({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const info = ayudaPorTab[tab];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative h-full w-96 overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-lg text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
        <h3 className="mb-4 text-lg font-bold text-gray-800">{info.titulo}</h3>
        <ol className="space-y-3">
          {info.pasos.map((p, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-600">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rodziny-100 text-xs font-bold text-rodziny-700">
                {i + 1}
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
