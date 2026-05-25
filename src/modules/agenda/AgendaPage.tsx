import { useState } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';
import { ListaTab } from './ListaTab';
import { CalendarioTab } from './CalendarioTab';

type Tab = 'lista' | 'calendario';

const ayuda: Record<Tab, { titulo: string; pasos: string[] }> = {
  lista: {
    titulo: 'Vista lista',
    pasos: [
      'Tareas, eventos y recordatorios agrupados por fecha.',
      'Atrasadas aparecen en rojo arriba de todo.',
      'Marcá el checkbox para tildarlos como hechos.',
      'Click en el título para editar; click en la X para eliminar.',
      'Las hechas se ocultan en una sección colapsable abajo.',
    ],
  },
  calendario: {
    titulo: 'Vista calendario',
    pasos: [
      'Mes completo con todos tus items.',
      'Click en un día para ver el detalle en el panel derecho.',
      'Click en + Nuevo para crear un item en el día seleccionado.',
      'Los puntos de color indican prioridad: rojo (alta), ámbar (media), azul (baja).',
    ],
  },
};

export function AgendaPage() {
  const [tab, setTab] = useState<Tab>('lista');
  const [ayudaAbierta, setAyudaAbierta] = useState(false);

  return (
    <PageContainer
      title="Agenda"
      subtitle="Tareas, eventos y recordatorios personales"
    >
      <div className="mb-6 flex items-center gap-1 border-b border-surface-border">
        <TabButton activo={tab === 'lista'} onClick={() => setTab('lista')}>
          Lista
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

      {tab === 'lista' && <ListaTab />}
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
  const info = ayuda[tab];
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
