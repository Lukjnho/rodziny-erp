import { useState } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';
import { FudoLiveTab } from './components/FudoLiveTab';
import { ResumenTab } from './components/ResumenTab';
import { MediosPagoTab } from './components/MediosPagoTab';
import { InteranualTab } from './components/InteranualTab';

type Tab = 'resumen' | 'envivo' | 'medios' | 'interanual';

const TABS: [Tab, string][] = [
  ['resumen', 'Resumen'],
  ['envivo', 'En vivo (Fudo)'],
  ['medios', 'Medios de pago'],
  ['interanual', 'Interanual'],
];

export function VentasPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<Tab>('resumen');

  const inner = (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t
                ? 'border-rodziny-600 text-rodziny-800'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <ResumenTab />}
      {tab === 'envivo' && <FudoLiveTab />}
      {tab === 'medios' && <MediosPagoTab />}
      {tab === 'interanual' && <InteranualTab />}
    </div>
  );

  if (embedded) return inner;
  return (
    <PageContainer title="Ventas" subtitle="Resumen, estadísticas y KPIs de ventas">
      {inner}
    </PageContainer>
  );
}
