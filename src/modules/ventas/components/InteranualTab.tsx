import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { formatARS, cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { type LocalVentas } from '../hooks/useVentasResumen';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const LINEAS = ['#9ca3af', '#82c44e', '#1b3b0d', '#f59e0b'];

interface MensualRow {
  local: string;
  periodo: string;
  total_bruto: number | null;
}

function useHistorico(local: LocalVentas) {
  return useQuery({
    queryKey: ['ventas-interanual', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas_mensuales_historico')
        .select('local, periodo, total_bruto')
        .order('periodo', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as MensualRow[];
      // map[año][mes 0-11] = venta
      const porAño = new Map<number, number[]>();
      for (const r of rows) {
        if (local !== 'consolidado' && r.local !== local) continue;
        const [y, m] = r.periodo.split('-').map(Number);
        if (!porAño.has(y)) porAño.set(y, new Array(12).fill(null));
        const arr = porAño.get(y)!;
        arr[m - 1] = (arr[m - 1] ?? 0) + (Number(r.total_bruto) || 0);
      }
      return porAño;
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function InteranualTab() {
  const [local, setLocal] = useState<LocalVentas>('consolidado');
  const { data: porAño, isLoading, error } = useHistorico(local);

  const años = useMemo(
    () => (porAño ? [...porAño.keys()].sort((a, b) => a - b) : []),
    [porAño],
  );

  // datos para el gráfico: una serie por año, eje X = mes
  const chartData = useMemo(() => {
    if (!porAño) return [];
    return MESES.map((mes, i) => {
      const fila: Record<string, number | string | null> = { mes };
      for (const y of años) fila[String(y)] = porAño.get(y)![i];
      return fila;
    });
  }, [porAño, años]);

  // tabla comparativa: últimos 2 años con Δ% interanual por mes
  const comparativa = useMemo(() => {
    if (años.length < 2) return null;
    const yA = años[años.length - 2];
    const yB = años[años.length - 1];
    const a = porAño!.get(yA)!;
    const b = porAño!.get(yB)!;
    const filas = MESES.map((mes, i) => {
      const va = a[i];
      const vb = b[i];
      const delta = va && vb ? ((vb - va) / va) * 100 : null;
      return { mes, va, vb, delta };
    }).filter((f) => f.va !== null || f.vb !== null);
    return { yA, yB, filas };
  }, [años, porAño]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-border bg-white p-3">
        <LocalSelector
          value={local}
          onChange={(v) => setLocal(v as LocalVentas)}
          options={['consolidado', 'vedia', 'saavedra']}
        />
        {isLoading && (
          <span className="ml-auto animate-pulse text-xs text-gray-400">Cargando…</span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      {local !== 'vedia' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          El histórico de <strong>Saavedra</strong> arranca en <strong>jul-2025</strong>, así que el
          comparativo interanual completo de ese local recién aplica desde julio.
        </div>
      )}

      {/* Gráfico líneas por año */}
      {chartData.length > 0 && años.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">
            Venta mensual por año {local !== 'consolidado' ? `— ${local}` : ''}
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `$${(v / 1_000_000).toFixed(0)}M`}
              />
              <Tooltip formatter={(v) => [formatARS(Number(v) || 0), '']} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {años.map((y, i) => (
                <Line
                  key={y}
                  type="monotone"
                  dataKey={String(y)}
                  name={String(y)}
                  stroke={LINEAS[i % LINEAS.length]}
                  strokeWidth={y === años[años.length - 1] ? 2.5 : 1.5}
                  dot={{ r: 2 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabla comparativa interanual */}
      {comparativa && (
        <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
          <div className="border-b border-gray-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-gray-700">
              {comparativa.yB} vs {comparativa.yA} — variación interanual
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 text-left">Mes</th>
                <th className="px-4 py-2.5 text-right">{comparativa.yA}</th>
                <th className="px-4 py-2.5 text-right">{comparativa.yB}</th>
                <th className="px-4 py-2.5 text-right">Δ interanual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {comparativa.filas.map((f) => (
                <tr key={f.mes} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-700">{f.mes}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                    {f.va !== null ? formatARS(f.va) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">
                    {f.vb !== null ? formatARS(f.vb) : '—'}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right text-xs font-semibold tabular-nums',
                      f.delta === null && 'text-gray-300',
                      f.delta !== null && f.delta >= 0 && 'text-emerald-600',
                      f.delta !== null && f.delta < 0 && 'text-red-600',
                    )}
                  >
                    {f.delta === null
                      ? '—'
                      : `${f.delta >= 0 ? '▲ +' : '▼ '}${f.delta.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-[11px] text-gray-400">
            Valores nominales (sin ajustar por inflación) — la caída real es mayor a la que muestra
            el %.
          </p>
        </div>
      )}

      {!isLoading && años.length < 2 && (
        <div className="rounded-lg border border-surface-border bg-white p-8 text-center text-sm text-gray-400">
          Todavía no hay dos años de histórico cargado para comparar.
        </div>
      )}
    </div>
  );
}
