import { useState } from 'react';
import { abrirVentanaAparte } from '@/lib/ventanaPantalla';
import { NOMBRE_VENTANA_PIZARRON, RUTA_PIZARRON_CAMARA } from '@/lib/ventanaPizarron';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';
import { DashboardTab } from './DashboardTab';
import { ProduccionTab } from './ProduccionTab';
import { StockTab } from './StockTab';
import { TraspasosTab } from './TraspasosTab';
import { CalendarioTab } from './CalendarioTab';
import { CierresTab } from './CierresTab';
import { CalculadoraTab } from './CalculadoraTab';

type Tab =
  | 'dashboard'
  | 'produccion'
  | 'stock'
  | 'cierres'
  | 'traspasos'
  | 'calendario'
  | 'calculadora';

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
      'Muestra el stock por producto en sus tres lugares: A porcionar (bandejas armadas en el freezer de la sala, todavía sin cortar), En cámara (depósito, ya en porciones) y En mostrador (listas para venta).',
      'El número de cámara sale de la cuenta única de la base: arranca del último conteo físico y le suma el porcionado posterior, menos traspasos y merma. Ninguna pantalla lo recalcula por su cuenta.',
      'La columna "A porcionar" muestra BANDEJAS, y abajo la estimación en porciones con ~ (dice "?" cuando no hay histórico para estimarla).',
      'El stock en mostrador se calcula como: traspasos de hoy − ventas Fudo de hoy − merma de hoy. Solo Vedia tiene ventas automáticas desde Fudo.',
      'Los productos bajo mínimo aparecen en amarillo, sin stock en rojo.',
    ],
  },
  cierres: {
    titulo: 'Cierres de turno',
    pasos: [
      'Cada turno termina con un cierre obligatorio: pastas (mediodía y noche), salsas (fin de día) y postres (fin de día).',
      'El mostrador carga el cierre desde el QR /mostrador?local=vedia con la cantidad real que quedó.',
      'Lo mostrado acá es solo lectura para el chef: estado del día (✓ o ✗), historial y responsable de cada cierre.',
      'Si falta un cierre, el dashboard avisa con un banner rojo.',
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
  calculadora: {
    titulo: 'Calculadora de recetas',
    pasos: [
      'Herramienta de referencia: elegí una subreceta y un multiplicador ×N para ver cuánta materia prima necesitás.',
      'El multiplicador escala toda la receta: ×2 es el doble de cada insumo.',
      'Si una subreceta usa otra (ej. Pomodoro dentro de Amatriciana), muestra "N kg de Pomodoro Base" y debajo los insumos para esa cantidad.',
      'Al final arma la lista de compra consolidada sumando todas las materias primas.',
      'No toca stock ni guarda nada: es solo para calcular y planificar compras.',
    ],
  },
};

export function CocinaPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [ayudaAbierta, setAyudaAbierta] = useState(false);

  return (
    <PageContainer title="Cocina" subtitle="Producción y stock — Empresa">
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
        <TabButton activo={tab === 'cierres'} onClick={() => setTab('cierres')}>
          Cierres
        </TabButton>
        <TabButton activo={tab === 'traspasos'} onClick={() => setTab('traspasos')}>
          Traspasos
        </TabButton>
        <TabButton activo={tab === 'calendario'} onClick={() => setTab('calendario')}>
          Calendario
        </TabButton>
        <TabButton activo={tab === 'calculadora'} onClick={() => setTab('calculadora')}>
          Calculadora
        </TabButton>
        {/* ⚠️ El click TIENE que salir de acá: si se abriera desde un efecto o
            después de un await, el navegador lo bloquea como ventana emergente
            y sin avisar. Ver src/lib/ventanaPantalla.ts */}
        <button
          onClick={() => {
            const abierta = abrirVentanaAparte({
              nombre: NOMBRE_VENTANA_PIZARRON,
              ruta: RUTA_PIZARRON_CAMARA,
              ancho: 1280,
              alto: 900,
            });
            // Plan B si el navegador bloqueó la ventana: se abre en una pestaña.
            if (!abierta) window.open(RUTA_PIZARRON_CAMARA, '_blank');
          }}
          className="mb-2 ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700"
          title="Pantalla para la tablet del depósito: stock de cámara y conteo físico"
        >
          🧊 Pizarrón del depósito
        </button>
        <button
          onClick={() => setAyudaAbierta(true)}
          className="hover:bg-rodziny-200 mb-2 ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-rodziny-100 text-sm font-bold text-rodziny-700 transition-colors"
          title="Ayuda"
        >
          ?
        </button>
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'produccion' && <ProduccionTab />}
      {tab === 'stock' && <StockTab />}
      {tab === 'cierres' && <CierresTab />}
      {tab === 'traspasos' && <TraspasosTab />}
      {tab === 'calendario' && <CalendarioTab />}
      {tab === 'calculadora' && <CalculadoraTab />}

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
