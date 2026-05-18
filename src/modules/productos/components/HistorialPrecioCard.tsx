import { formatARS, cn } from '@/lib/utils';
import { useHistorialPrecio } from '../hooks/useHistorialPrecio';

export function HistorialPrecioCard({ cocinaProductoId }: { cocinaProductoId: string }) {
  const { data: historial, isLoading } = useHistorialPrecio(cocinaProductoId);

  if (isLoading) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-400">
        Cargando histórico de precios…
      </section>
    );
  }

  if (!historial || historial.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        📈 Sin cambios de precio registrados todavía. Cualquier ajuste en el precio de venta queda
        registrado automáticamente desde acá en adelante.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-gray-800">📈 Histórico de precio</h3>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2 text-right">De</th>
              <th className="px-3 py-2 text-right">A</th>
              <th className="px-3 py-2 text-right">Variación</th>
              <th className="px-3 py-2">Quién</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {historial.map((h) => {
              const sube = (h.variacion_pct ?? 0) > 0;
              return (
                <tr key={h.id} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 text-[11px]">
                    {new Date(h.fecha).toLocaleDateString('es-AR', {
                      day: '2-digit',
                      month: 'short',
                      year: '2-digit',
                    })}
                    <div className="text-[9px] text-gray-400">
                      {new Date(h.fecha).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                    {h.precio_anterior != null ? formatARS(h.precio_anterior) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                    {h.precio_nuevo != null ? formatARS(h.precio_nuevo) : '—'}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-1.5 text-right tabular-nums font-medium',
                      sube ? 'text-green-700' : 'text-red-700',
                    )}
                  >
                    {h.variacion_pct != null
                      ? `${sube ? '↑' : '↓'} ${(Math.abs(h.variacion_pct) * 100).toFixed(1)}%`
                      : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-[11px] text-gray-600">
                    {h.usuario ?? <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
