import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { FichaProductoTab } from './components/FichaProductoTab';
import { MenuTab } from './components/MenuTab';
import { InsumosTab } from './components/InsumosTab';
import { ConfiguracionTab } from './components/ConfiguracionTab';
import { MenuEngineeringTab } from './components/MenuEngineeringTab';
import { PriceEngineeringTab } from './components/PriceEngineeringTab';
import { PlanAccionTab } from './components/PlanAccionTab';
import { cn } from '@/lib/utils';

type Tab =
  | 'plan'
  | 'menu'
  | 'ficha'
  | 'menu_engineering'
  | 'price_engineering'
  | 'insumos'
  | 'configuracion';

interface TabDef {
  id: Tab;
  label: string;
  icon: string;
  subtitle: string;
}

const TABS: TabDef[] = [
  {
    id: 'plan',
    label: 'Plan de acción',
    icon: '🎯',
    subtitle: 'Movidas priorizadas por impacto en $ del mes',
  },
  {
    id: 'menu_engineering',
    label: 'Menu Engineering',
    icon: '⭐',
    subtitle: 'Matriz Estrella / Vaca / Puzzle / Perro por popularidad × rentabilidad',
  },
  {
    id: 'price_engineering',
    label: 'Price Engineering',
    icon: '📐',
    subtitle: 'Ley de Omnes: distribución, amplitud y RCP de la carta',
  },
  {
    id: 'menu',
    label: 'Menú',
    icon: '🍽️',
    subtitle: 'Productos vendibles: precio por canal, packaging, adicionales, margen y alta de productos',
  },
  {
    id: 'ficha',
    label: 'Costeo',
    icon: '🧮',
    subtitle: 'Recetas y subrecetas: armá ingredientes y mirá el costo (por kg / por porción)',
  },
  {
    id: 'insumos',
    label: 'Insumos',
    icon: '📦',
    subtitle: 'Materia prima comprada: costo unitario y merma',
  },
  {
    id: 'configuracion',
    label: 'Configuración',
    icon: '⚙️',
    subtitle: 'Markup, márgenes objetivo y comisión MP por medio de pago',
  },
];

export function ProductosPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as Tab | null;
  const tab: Tab = tabFromUrl && TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : 'plan';
  const setTab = (nuevo: Tab) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', nuevo);
    setSearchParams(sp, { replace: true });
  };

  const tabActual = useMemo(() => TABS.find((t) => t.id === tab) ?? TABS[0], [tab]);

  return (
    <PageContainer title="Productos" subtitle={tabActual.subtitle}>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
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

      {tab === 'plan' && <PlanAccionTab />}
      {tab === 'menu_engineering' && <MenuEngineeringTab />}
      {tab === 'price_engineering' && <PriceEngineeringTab />}
      {tab === 'menu' && <MenuTab />}
      {tab === 'ficha' && <FichaProductoTab />}
      {tab === 'insumos' && <InsumosTab />}
      {tab === 'configuracion' && <ConfiguracionTab />}
    </PageContainer>
  );
}
