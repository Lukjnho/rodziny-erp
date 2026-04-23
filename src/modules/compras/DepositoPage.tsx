import { useSearchParams } from 'react-router-dom';
import { DepositoForm } from './components/DepositoForm';

// Página mobile-friendly para escanear QR en el depósito
// URL: /deposito?local=vedia  o  /deposito?local=saavedra
export function DepositoPage() {
  const [params] = useSearchParams();
  const local = (params.get('local') === 'saavedra' ? 'saavedra' : 'vedia') as 'vedia' | 'saavedra';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header simple mobile */}
      <div className="flex items-center justify-between bg-rodziny-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-rodziny-600 text-xs font-bold">
            R
          </div>
          <span className="text-sm font-semibold">Rodziny Depósito</span>
        </div>
        <span className="text-rodziny-200 text-xs">{local === 'vedia' ? 'Vedia' : 'Saavedra'}</span>
      </div>

      <DepositoForm local={local} />
    </div>
  );
}
