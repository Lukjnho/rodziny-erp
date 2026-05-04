import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatARS, cn } from '@/lib/utils';
import { previewReglas, ejecutarReglas, type Preview } from './aplicarReglas';

type Etapa = 'cargando' | 'preview' | 'ejecutando' | 'resultado' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AplicarReglasModal({ open, onClose, onSuccess }: Props) {
  const [etapa, setEtapa] = useState<Etapa>('cargando');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{
    creados: number;
    vinculados: number;
    errores: string[];
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setEtapa('cargando');
    setPreview(null);
    setError(null);
    setResultado(null);
    previewReglas(supabase)
      .then((p) => {
        setPreview(p);
        setEtapa('preview');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Error generando preview');
        setEtapa('error');
      });
  }, [open]);

  if (!open) return null;

  async function ejecutar() {
    if (!preview) return;
    setEtapa('ejecutando');
    try {
      const r = await ejecutarReglas(supabase, preview);
      setResultado(r);
      setEtapa('resultado');
      if (r.creados > 0) onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error ejecutando reglas');
      setEtapa('error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-800">🤖 Aplicar reglas automáticas</h3>
          <p className="mt-1 text-xs text-gray-500">
            El motor recorre los movimientos sin clasificar y los agrupa según las reglas activas.
            Genera un gasto por grupo (mensual o individual) y vincula los movimientos. Si ya existe
            un gasto auto del mismo período, se reemplaza.
          </p>
        </div>

        {etapa === 'cargando' && (
          <p className="py-8 text-center text-sm text-gray-400">⏳ Analizando movimientos...</p>
        )}

        {etapa === 'error' && (
          <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">❌ {error}</div>
        )}

        {etapa === 'preview' && preview && (
          <>
            <div className="mb-3 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Movimientos a clasificar</p>
                <p className="text-lg font-semibold text-gray-800">
                  {preview.movsClasificados.toLocaleString('es-AR')}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Gastos a generar</p>
                <p className="text-lg font-semibold text-gray-800">
                  {preview.totalGastos.toLocaleString('es-AR')}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Monto total</p>
                <p className="text-lg font-semibold text-gray-800">
                  {formatARS(preview.totalMonto)}
                </p>
              </div>
            </div>

            <p className="mb-2 text-xs text-gray-500">
              Quedarán <strong>{preview.movsSinRegla.toLocaleString('es-AR')}</strong> movimientos
              sin regla — los seguís clasificando vos a mano (transferencias internas, cheques,
              etc).
            </p>

            <div className="overflow-hidden rounded border border-gray-200">
              <table className="w-full text-xs">
                <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Período</th>
                    <th className="px-3 py-2 text-left">Regla / Proveedor</th>
                    <th className="px-3 py-2 text-center">Movs</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-center">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((it, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-600">
                        {it.periodo}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-800">{it.proveedor}</p>
                        <p className="text-[10px] text-gray-500">{it.reglaNombre}</p>
                      </td>
                      <td className="px-3 py-2 text-center text-gray-600">{it.cantidadMovs}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">
                        {formatARS(it.total)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-medium',
                            it.agrupacion === 'mensual'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-blue-100 text-blue-800',
                          )}
                        >
                          {it.agrupacion}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {preview.items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                        No hay movimientos pendientes que matcheen alguna regla.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={ejecutar}
                disabled={preview.items.length === 0}
                className="rounded-md bg-rodziny-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
              >
                Confirmar y aplicar
              </button>
            </div>
          </>
        )}

        {etapa === 'ejecutando' && (
          <p className="py-8 text-center text-sm text-blue-600 animate-pulse">
            ⏳ Generando gastos y vinculando movimientos...
          </p>
        )}

        {etapa === 'resultado' && resultado && (
          <>
            <div
              className={cn(
                'rounded-md p-4 text-sm',
                resultado.errores.length === 0
                  ? 'bg-green-50 text-green-800'
                  : 'bg-amber-50 text-amber-800',
              )}
            >
              ✅ {resultado.creados} gastos creados ·{' '}
              {resultado.vinculados.toLocaleString('es-AR')} movimientos vinculados
              {resultado.errores.length > 0 && (
                <div className="mt-2 text-red-700">
                  <p className="font-medium">Errores ({resultado.errores.length}):</p>
                  <ul className="mt-1 list-inside list-disc text-xs">
                    {resultado.errores.slice(0, 10).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md bg-rodziny-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800"
              >
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
