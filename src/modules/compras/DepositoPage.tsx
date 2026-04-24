import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { DepositoForm } from './components/DepositoForm';
import { TrasladoPastasForm } from './components/TrasladoPastasForm';

type Tab = 'insumos' | 'traslado';

// Página mobile-friendly para escanear QR en el depósito
// URL: /deposito?local=vedia  o  /deposito?local=saavedra
// Dos flujos en el mismo QR físico:
//   1) Insumos — salidas del depósito (consumo producción, merma, etc.)
//   2) Traslado pastas — cámara de congelado → freezer del mostrador
export function DepositoPage() {
  const [params] = useSearchParams();
  const local = (params.get('local') === 'saavedra' ? 'saavedra' : 'vedia') as 'vedia' | 'saavedra';
  const [tab, setTab] = useState<Tab>('insumos');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-between bg-rodziny-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-rodziny-600 text-xs font-bold">
            R
          </div>
          <span className="text-sm font-semibold">Rodziny Depósito</span>
        </div>
        <span className="text-rodziny-200 text-xs">{local === 'vedia' ? 'Vedia' : 'Saavedra'}</span>
      </div>

      <div className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setTab('insumos')}
          className={cn(
            'flex-1 py-3 text-sm font-medium transition',
            tab === 'insumos'
              ? 'border-b-2 border-rodziny-600 text-rodziny-700'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          📦 Insumos
        </button>
        <button
          onClick={() => setTab('traslado')}
          className={cn(
            'flex-1 py-3 text-sm font-medium transition',
            tab === 'traslado'
              ? 'border-b-2 border-rodziny-600 text-rodziny-700'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          🍝 Traslado pastas
        </button>
      </div>

      {tab === 'insumos' ? (
        <DepositoForm local={local} />
      ) : (
        <TrasladoPastasForm local={local} />
      )}
    </div>
  );
}
