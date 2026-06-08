import { useState } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';
import { MedicionTab } from './MedicionTab';
import { ConveniosTab } from './ConveniosTab';

type Tab = 'medicion' | 'convenios';

export function ConveniosPage() {
  const [tab, setTab] = useState<Tab>('medicion');

  return (
    <PageContainer
      title="Convenios"
      subtitle="Marcas e instituciones con descuento — medí quién te beneficia"
    >
      <div className="mb-6 flex items-center gap-1 border-b border-surface-border">
        <TabButton activo={tab === 'medicion'} onClick={() => setTab('medicion')}>
          📊 Medición
        </TabButton>
        <TabButton activo={tab === 'convenios'} onClick={() => setTab('convenios')}>
          🤝 Convenios
        </TabButton>
      </div>

      {tab === 'medicion' && <MedicionTab />}
      {tab === 'convenios' && <ConveniosTab />}
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
