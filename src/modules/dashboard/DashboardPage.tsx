import { PageContainer } from '@/components/layout/PageContainer';
import { ProximasEfemeridesCard } from '@/modules/cocina/components/ProximasEfemeridesCard';
import { AlertasOperativasCard } from './components/AlertasOperativasCard';

export function DashboardPage() {
  return (
    <PageContainer title="Dashboard" subtitle="Rodziny S.A.S. — panel principal">
      <div className="space-y-6">
        <AlertasOperativasCard />
        <ProximasEfemeridesCard diasAdelante={15} />
      </div>
    </PageContainer>
  );
}
