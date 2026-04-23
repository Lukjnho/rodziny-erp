import { formatARS } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { Empleado } from '../RRHHPage';

export interface CierreCajaError {
  id: string;
  fecha: string;
  turno: string;
  caja: string | null;
  diferencia: number;
  monto_contado: number;
  monto_esperado: number | null;
  cajero_nombre: string | null;
  nota: string | null;
}

interface Props {
  empleado: Empleado;
  periodo: string;
  errores: CierreCajaError[];
  onClose: () => void;
}

export function PanelErroresCaja({ empleado, periodo, errores, onClose }: Props) {
  const totalFaltante = errores
    .filter((e) => e.diferencia < 0)
    .reduce((s, e) => s + e.diferencia, 0);
  const totalSobrante = errores
    .filter((e) => e.diferencia > 0)
    .reduce((s, e) => s + e.diferencia, 0);
  const neto = errores.reduce((s, e) => s + e.diferencia, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30" onClick={onClose}>
      <div
        className="mt-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Errores de caja</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {empleado.apellido}, {empleado.nombre} — {periodo}
            </p>
          </div>
          <button onClick={onClose} className="text-lg text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Resumen */}
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-red-50 p-3 text-center">
              <p className="text-[10px] font-medium uppercase text-red-500">Faltantes</p>
              <p className="text-sm font-bold text-red-700">{formatARS(totalFaltante)}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3 text-center">
              <p className="text-[10px] font-medium uppercase text-blue-500">Sobrantes</p>
              <p className="text-sm font-bold text-blue-700">{formatARS(totalSobrante)}</p>
            </div>
            <div
              className={cn(
                'rounded-lg p-3 text-center',
                neto === 0 ? 'bg-green-50' : neto < 0 ? 'bg-red-50' : 'bg-blue-50',
              )}
            >
              <p
                className={cn(
                  'text-[10px] font-medium uppercase',
                  neto === 0 ? 'text-green-500' : neto < 0 ? 'text-red-500' : 'text-blue-500',
                )}
              >
                Neto
              </p>
              <p
                className={cn(
                  'text-sm font-bold',
                  neto === 0 ? 'text-green-700' : neto < 0 ? 'text-red-700' : 'text-blue-700',
                )}
              >
                {formatARS(neto)}
              </p>
            </div>
          </div>

          <p className="mb-3 text-xs text-gray-500">
            {errores.length} cierre{errores.length !== 1 ? 's' : ''} con diferencia en esta quincena
          </p>

          {/* Lista de errores */}
          <div className="space-y-2">
            {errores.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">
                Sin errores de caja en este período
              </p>
            ) : (
              errores.map((e) => (
                <div
                  key={e.id}
                  className={cn(
                    'rounded-lg border p-3',
                    e.diferencia < 0
                      ? 'border-red-200 bg-red-50/50'
                      : 'border-blue-200 bg-blue-50/50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs">
                      <span className="font-medium text-gray-800">
                        {new Date(e.fecha + 'T12:00:00').toLocaleDateString('es-AR', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                      <span className="ml-2 text-gray-500">{e.turno}</span>
                      {e.caja && <span className="ml-2 text-gray-400">{e.caja}</span>}
                    </div>
                    <span
                      className={cn(
                        'text-sm font-bold',
                        e.diferencia < 0 ? 'text-red-700' : 'text-blue-700',
                      )}
                    >
                      {formatARS(e.diferencia)}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-gray-500">
                    Contado: {formatARS(e.monto_contado)}
                    {e.monto_esperado != null && ` · Esperado: ${formatARS(e.monto_esperado)}`}
                  </div>
                  {e.nota && <p className="mt-1 text-[10px] italic text-gray-400">{e.nota}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
