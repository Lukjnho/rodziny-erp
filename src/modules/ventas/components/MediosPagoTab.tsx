import { useMemo, useState } from 'react';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { formatARS, cn } from '@/lib/utils';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  useVentasResumen,
  periodoAnterior,
  type LocalVentas,
} from '../hooks/useVentasResumen';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function mesLabel(periodo: string): string {
  const [y, m] = periodo.split('-');
  return `${MESES[Number(m) - 1]} ${y}`;
}

function periodosDisponibles(): string[] {
  const hoy = new Date();
  const out: string[] = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// color estable por medio de pago
const COLOR_MEDIO: Record<string, string> = {
  Efectivo: '#4f8828',
  QR: '#3b82f6',
  Transferencia: '#8b5cf6',
  'Tarjeta débito': '#f59e0b',
  'Tarjeta crédito': '#ef4444',
  Mixto: '#14b8a6',
  MercadoPago: '#06b6d4',
  'Sin especificar': '#9ca3af',
};
const COLOR_FALLBACK = '#6b7280';

export function MediosPagoTab() {
  const periodos = useMemo(periodosDisponibles, []);
  const [local, setLocal] = useState<LocalVentas>('consolidado');
  const [periodo, setPeriodo] = useState<string>(periodos[1] ?? periodos[0]);

  const { data: actual, isLoading, error } = useVentasResumen(local, periodo);
  const { data: previo } = useVentasResumen(local, periodoAnterior(periodo));

  // share % anterior por medio para calcular el Δ de participación
  const sharePrevio = useMemo(() => {
    const map = new Map<string, number>();
    if (!previo || previo.ventaTotal === 0) return map;
    for (const m of previo.porMedio) map.set(m.medio, (m.venta / previo.ventaTotal) * 100);
    return map;
  }, [previo]);

  const pieData = useMemo(
    () => (actual?.porMedio ?? []).map((m) => ({ name: m.medio, value: m.venta })),
    [actual],
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-border bg-white p-3">
        <LocalSelector
          value={local}
          onChange={(v) => setLocal(v as LocalVentas)}
          options={['consolidado', 'vedia', 'saavedra']}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Mes</label>
          <select
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {periodos.map((p) => (
              <option key={p} value={p}>
                {mesLabel(p)}
              </option>
            ))}
          </select>
        </div>
        {isLoading && (
          <span className="ml-auto animate-pulse text-xs text-gray-400">Calculando…</span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      {actual && actual.tickets > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Pie */}
          <div className="rounded-lg border border-surface-border bg-white p-5">
            <h3 className="mb-4 text-sm font-semibold text-gray-700">
              Mix de cobros — {mesLabel(periodo)}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  dataKey="value"
                  label={({ name, value }) =>
                    `${name as string} ${
                      actual.ventaTotal > 0
                        ? ((Number(value) / actual.ventaTotal) * 100).toFixed(0)
                        : 0
                    }%`
                  }
                  labelLine={false}
                >
                  {pieData.map((d) => (
                    <Cell key={d.name} fill={COLOR_MEDIO[d.name] ?? COLOR_FALLBACK} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip formatter={(v) => formatARS(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Tabla con Δ share */}
          <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
            <div className="border-b border-gray-100 px-5 py-3">
              <h3 className="text-sm font-semibold text-gray-700">Detalle por medio de pago</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 text-left">Medio</th>
                  <th className="px-4 py-2.5 text-right">Cobrado</th>
                  <th className="px-4 py-2.5 text-right">Tickets</th>
                  <th className="px-4 py-2.5 text-right">% mix</th>
                  <th className="px-4 py-2.5 text-right">Δ vs mes ant.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {actual.porMedio.map((m) => {
                  const share = actual.ventaTotal > 0 ? (m.venta / actual.ventaTotal) * 100 : 0;
                  const sharePrev = sharePrevio.get(m.medio);
                  const dShare = sharePrev !== undefined ? share - sharePrev : undefined;
                  return (
                    <tr key={m.medio} className="hover:bg-gray-50">
                      <td className="flex items-center gap-2 px-4 py-2.5 font-medium text-gray-800">
                        <span
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ background: COLOR_MEDIO[m.medio] ?? COLOR_FALLBACK }}
                        />
                        {m.medio}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatARS(m.venta)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                        {m.tickets.toLocaleString('es-AR')}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-rodziny-700">
                        {share.toFixed(1)}%
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2.5 text-right text-xs font-medium tabular-nums',
                          dShare === undefined && 'text-gray-300',
                          dShare !== undefined && dShare > 0.1 && 'text-emerald-600',
                          dShare !== undefined && dShare < -0.1 && 'text-red-600',
                          dShare !== undefined && Math.abs(dShare) <= 0.1 && 'text-gray-400',
                        )}
                      >
                        {dShare === undefined
                          ? '—'
                          : `${dShare >= 0 ? '+' : ''}${dShare.toFixed(1)} pp`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-4 py-3 text-[11px] text-gray-400">
              "pp" = puntos porcentuales de cambio en la participación vs{' '}
              {mesLabel(periodoAnterior(periodo))}. Útil para ver cuánto se mueve la venta hacia
              medios con comisión (QR / tarjeta).
            </p>
          </div>
        </div>
      )}

      {actual && actual.tickets === 0 && !isLoading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No hay ventas cargadas para <strong>{mesLabel(periodo)}</strong>.
        </div>
      )}
    </div>
  );
}
