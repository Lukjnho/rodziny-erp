import { PageContainer } from '@/components/layout/PageContainer';
import { ProximasEfemeridesCard } from '@/modules/cocina/components/ProximasEfemeridesCard';
import { AlertasOperativasCard } from './components/AlertasOperativasCard';
import { ExtractosAlerta } from '@/modules/finanzas/components/ExtractosAlerta';

export function DashboardPage() {
  return (
    <PageContainer title="Dashboard" subtitle="Rodziny S.A.S. — panel principal">
      <div className="space-y-6">
        <AlertasOperativasCard />
        <ExtractosAlerta variant="card" />
        <ProximasEfemeridesCard diasAdelante={15} />
      </div>
    </PageContainer>
  );
}
