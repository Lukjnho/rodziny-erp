import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { KPICard } from '@/components/ui/KPICard';
import { formatARS, cn } from '@/lib/utils';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  useVentasResumen,
  periodoAnterior,
  type LocalVentas,
} from '../hooks/useVentasResumen';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function mesLabel(periodo: string): string {
  const [y, m] = periodo.split('-');
  return `${MESES[Number(m) - 1]} ${y}`;
}

function deltaPct(actual: number, anterior: number): number | undefined {
  if (!anterior) return undefined;
  return ((actual - anterior) / anterior) * 100;
}

/** Lista de los últimos 18 meses hasta el actual, como opciones 'YYYY-MM'. */
function periodosDisponibles(): string[] {
  const hoy = new Date();
  const out: string[] = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

interface MensualRow {
  local: string;
  periodo: string;
  total_bruto: number | null;
}

/** Tendencia de venta de los últimos 12 meses desde ventas_mensuales_historico (pre-agregada). */
function useTendenciaMensual(local: LocalVentas) {
  return useQuery({
    queryKey: ['ventas-tendencia-historico', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas_mensuales_historico')
        .select('local, periodo, total_bruto')
        .order('periodo', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as MensualRow[];
      const map = new Map<string, number>();
      for (const r of rows) {
        if (local !== 'consolidado' && r.local !== local) continue;
        map.set(r.periodo, (map.get(r.periodo) ?? 0) + (Number(r.total_bruto) || 0));
      }
      return [...map.entries()]
        .map(([periodo, venta]) => ({ periodo, venta }))
        .sort((a, b) => a.periodo.localeCompare(b.periodo))
        .slice(-12);
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function ResumenTab() {
  const periodos = useMemo(periodosDisponibles, []);
  const [local, setLocal] = useState<LocalVentas>('consolidado');
  const [periodo, setPeriodo] = useState<string>(periodos[1] ?? periodos[0]); // arranca en mes cerrado anterior

  const { data: actual, isLoading, error } = useVentasResumen(local, periodo);
  const { data: previo, isLoading: loadingPrevio } = useVentasResumen(local, periodoAnterior(periodo));
  const { data: tendencia } = useTendenciaMensual(local);

  const tendenciaData = useMemo(
    () => (tendencia ?? []).map((m) => ({ mes: mesLabel(m.periodo), venta: m.venta })),
    [tendencia],
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
        {(isLoading || loadingPrevio) && (
          <span className="ml-auto animate-pulse text-xs text-gray-400">Calculando…</span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      {actual && actual.tickets === 0 && !isLoading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No hay ventas cargadas para <strong>{mesLabel(periodo)}</strong>
          {local !== 'consolidado' ? ` en ${local}` : ''}. Subí el export de Fudo de ese mes en
          Finanzas → Importar Fudo.
        </div>
      )}

      {actual && actual.tickets > 0 && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KPICard
              label="Venta total"
              value={formatARS(actual.ventaTotal)}
              color="green"
              change={previo ? deltaPct(actual.ventaTotal, previo.ventaTotal) : undefined}
            />
            <KPICard
              label="Tickets"
              value={actual.tickets.toLocaleString('es-AR')}
              color="blue"
              change={previo ? deltaPct(actual.tickets, previo.tickets) : undefined}
            />
            <KPICard
              label="Ticket promedio"
              value={formatARS(actual.ticketPromedio)}
              color="yellow"
              change={previo ? deltaPct(actual.ticketPromedio, previo.ticketPromedio) : undefined}
            />
            <KPICard
              label="Venta diaria promedio"
              value={formatARS(actual.ventaDiaria)}
              color="neutral"
              change={previo ? deltaPct(actual.ventaDiaria, previo.ventaDiaria) : undefined}
            />
          </div>

          {/* Chips de pico */}
          <div className="flex flex-wrap gap-2 text-xs">
            {actual.horaPico && (
              <span className="rounded-full bg-rodziny-50 px-3 py-1 font-medium text-rodziny-800">
                🕐 Hora pico: {String(actual.horaPico.hora).padStart(2, '0')}hs ·{' '}
                {actual.horaPico.tickets.toLocaleString('es-AR')} tickets
              </span>
            )}
            {actual.diaPico && (
              <span className="rounded-full bg-rodziny-50 px-3 py-1 font-medium text-rodziny-800">
                📅 Día más fuerte: {DIAS[actual.diaPico.dia]} ·{' '}
                {actual.diaPico.tickets.toLocaleString('es-AR')} tickets
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-500">
              Comparado vs {mesLabel(periodoAnterior(periodo))} · sin dividendos
            </span>
          </div>

          {/* Desglose por local (consolidado) */}
          {local === 'consolidado' && (
            <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
              <div className="border-b border-gray-100 px-5 py-3">
                <h3 className="text-sm font-semibold text-gray-700">Desglose por local</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Local</th>
                    <th className="px-4 py-2.5 text-right">Venta</th>
                    <th className="px-4 py-2.5 text-right">Tickets</th>
                    <th className="px-4 py-2.5 text-right">Ticket prom.</th>
                    <th className="px-4 py-2.5 text-right">% venta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(['vedia', 'saavedra'] as const).map((l) => {
                    const d = actual.porLocal[l];
                    const tp = d.tickets > 0 ? d.venta / d.tickets : 0;
                    return (
                      <tr key={l} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium capitalize text-gray-800">
                          Rodziny {l}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatARS(d.venta)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                          {d.tickets.toLocaleString('es-AR')}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                          {formatARS(tp)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium text-rodziny-700">
                          {actual.ventaTotal > 0
                            ? ((d.venta / actual.ventaTotal) * 100).toFixed(1) + '%'
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                    <td className="px-4 py-2.5 text-gray-900">Total empresa</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatARS(actual.ventaTotal)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {actual.tickets.toLocaleString('es-AR')}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatARS(actual.ticketPromedio)}
                    </td>
                    <td className="px-4 py-2.5 text-right">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Tendencia 12 meses */}
          {tendenciaData.length > 0 && (
            <div className="rounded-lg border border-surface-border bg-white p-5">
              <h3 className="mb-4 text-sm font-semibold text-gray-700">
                Venta mensual — últimos 12 meses
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={tendenciaData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `$${(v / 1_000_000).toFixed(0)}M`}
                  />
                  <Tooltip formatter={(v) => [formatARS(Number(v) || 0), 'Venta']} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="venta" name="Venta" fill="#82c44e" radius={[3, 3, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="venta"
                    name="Tendencia"
                    stroke="#1b3b0d"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="mt-2 text-[11px] text-gray-400">
                Fuente: histórico mensual de Fudo. {local === 'saavedra' && 'Saavedra desde jul-2025.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
