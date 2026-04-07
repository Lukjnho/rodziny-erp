import { useSearchParams } from 'react-router-dom'
import { DepositoForm } from './components/DepositoForm'

// Página mobile-friendly para escanear QR en el depósito
// URL: /deposito?local=vedia  o  /deposito?local=saavedra
export function DepositoPage() {
  const [params] = useSearchParams()
  const local = (params.get('local') === 'saavedra' ? 'saavedra' : 'vedia') as 'vedia' | 'saavedra'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header simple mobile */}
      <div className="bg-rodziny-800 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold bg-rodziny-600">R</div>
          <span className="font-semibold text-sm">Rodziny Depósito</span>
        </div>
        <span className="text-xs text-rodziny-200">{local === 'vedia' ? 'Vedia' : 'Saavedra'}</span>
      </div>

      <DepositoForm local={local} />
    </div>
  )
}
