import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { UploadFudo } from './components/UploadFudo';
import { CierreCaja } from './components/CierreCaja';
import { FlujoCaja } from './components/FlujoCaja';
import { ProyeccionFlujo } from './components/ProyeccionFlujo';
import { GastosPage } from '@/modules/gastos/GastosPage';
import { EstadoResultados } from './edr/EstadoResultados';
import { AmortizacionesPage } from './amortizaciones/AmortizacionesPage';
import { ChecklistPagos } from './components/ChecklistPagos';
import { CierreMesPanel } from './components/CierreMesPanel';
import { useAuth, type Modulo } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Tab =
  | 'compras'
  | 'edr'
  | 'flujo'
  | 'proyeccion'
  | 'cierre_mes'
  | 'amortizaciones'
  | 'checklist'
  | 'cierres'
  | 'importar';

interface TabDef {
  id: Tab;
  label: string;
  icon: string;
  subtitle: string;
  modulo: Modulo;
}

const TABS: TabDef[] = [
  {
    id: 'compras',
    label: 'Resumen de Egresos',
    icon: '🧾',
    subtitle: 'Todo lo que salió, por rubro y mes (base devengada)',
    modulo: 'gastos',
  },
  {
    id: 'edr',
    label: 'EdR',
    icon: '📋',
    subtitle: 'Estado de Resultados mensual por local',
    modulo: 'edr',
  },
  {
    id: 'flujo',
    label: 'Flujo de caja',
    icon: '💰',
    subtitle: 'Movimientos bancarios y efectivo',
    modulo: 'flujo_caja',
  },
  {
    id: 'proyeccion',
    label: 'Proyección',
    icon: '📊',
    subtitle: 'Flujo de caja proyectado a 12 meses · caja operativa vs reserva',
    modulo: 'flujo_caja',
  },
  {
    id: 'cierre_mes',
    label: 'Cierre de mes',
    icon: '🗓️',
    subtitle: 'Checklist de control: que toda entrada y salida del mes esté cargada',
    modulo: 'finanzas',
  },
  {
    id: 'checklist',
    label: 'Pagos Fijos',
    icon: '✅',
    subtitle: 'Checklist mensual de gastos fijos',
    modulo: 'finanzas',
  },
  {
    id: 'amortizaciones',
    label: 'Amortizaciones',
    icon: '📉',
    subtitle: 'Inversiones y depreciación mensual',
    modulo: 'amortizaciones',
  },
  {
    id: 'cierres',
    label: 'Cierres de caja',
    icon: '📦',
    subtitle: 'Cierres diarios por local',
    modulo: 'finanzas',
  },
  {
    id: 'importar',
    label: 'Importar datos',
    icon: '📂',
    subtitle: 'Importar exports de Fudo / bancos',
    modulo: 'finanzas',
  },
];

export function FinanzasPage() {
  const { tienePermiso } = useAuth();

  const tabsVisibles = useMemo(() => TABS.filter((t) => tienePermiso(t.modulo)), [tienePermiso]);

  // Sincronizamos el tab activo con el query param ?tab=... para que las alertas
  // del dashboard puedan linkear directo al tab correcto (checklist, flujo, etc.).
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as Tab | null;
  const tab: Tab =
    tabFromUrl && tabsVisibles.some((t) => t.id === tabFromUrl)
      ? tabFromUrl
      : (tabsVisibles[0]?.id ?? 'flujo');
  const setTab = (nuevo: Tab) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', nuevo);
    setSearchParams(sp, { replace: true });
  };

  const tabActual = tabsVisibles.find((t) => t.id === tab) ?? tabsVisibles[0];

  if (!tabActual) {
    return (
      <PageContainer title="Finanzas">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No tenés acceso a ninguna sección de Finanzas.
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer title="Finanzas" subtitle={tabActual.subtitle}>
      {/* Tabs */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
        {tabsVisibles.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.id
                ? 'border-rodziny-600 text-rodziny-800'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            <span className="mr-1">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'compras' && <GastosPage embedded />}
      {tab === 'edr' && <EstadoResultados embedded />}
      {tab === 'flujo' && <FlujoCaja onNavigateToTab={(t) => setTab(t as Tab)} />}
      {tab === 'proyeccion' && <ProyeccionFlujo />}
      {tab === 'cierre_mes' && (
        <CierreMesPanel onNavigateToTab={(t) => setTab(t as Tab)} />
      )}
      {tab === 'checklist' && <ChecklistPagos />}
      {tab === 'amortizaciones' && <AmortizacionesPage embedded />}
      {tab === 'cierres' && <CierreCaja />}
      {tab === 'importar' && <UploadFudo />}
    </PageContainer>
  );
}
