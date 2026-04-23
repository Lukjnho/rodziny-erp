import { useState } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';
import { ListadoGastos } from './ListadoGastos';
import { PagosPanel } from './PagosPanel';
import { AnalisisGastos } from './AnalisisGastos';
import { CategoriasPanel } from './CategoriasPanel';

type Tab = 'listado' | 'pagos' | 'analisis' | 'categorias';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'listado', label: 'Listado', icon: '📋' },
  { id: 'pagos', label: 'Pagos', icon: '💳' },
  { id: 'analisis', label: 'Análisis', icon: '📊' },
  { id: 'categorias', label: 'Categorías', icon: '🏷' },
];

export function GastosPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<Tab>('listado');

  const inner = (
    <>
      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.id
                ? 'border-rodziny-700 text-rodziny-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            <span className="mr-1">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'listado' && <ListadoGastos />}
      {tab === 'pagos' && <PagosPanel />}
      {tab === 'analisis' && <AnalisisGastos />}
      {tab === 'categorias' && <CategoriasPanel />}
    </>
  );

  if (embedded) return inner;
  return (
    <PageContainer title="Gastos" subtitle="Compras, pagos y análisis">
      {inner}
    </PageContainer>
  );
}
