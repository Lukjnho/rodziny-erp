import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { KPICard } from '@/components/ui/KPICard';
import { formatARS, cn } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
  ComposedChart,
} from 'recharts';

const COLORES = [
  '#4f8828',
  '#65a832',
  '#82c44e',
  '#a3d96e',
  '#c5ef97',
  '#2D5016',
  '#1b3b0d',
  '#f59e0b',
];
const DIAS_LABEL: Record<number, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
};

function pct(v: number, total: number) {
  return total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '0%';
}

interface ProductoRanking {
  productId: string;
  nombre: string;
  categoria: string;
  categoriaId: string;
  precio: number;
  costo: number | null;
  cantidad: number;
  facturacion: number;
  tickets: number;
}

interface CategoriaResumen {
  nombre: string;
  cantidad: number;
  facturacion: number;
  productos: number;
}

interface FudoProductosData {
  local: string;
  fechaDesde: string;
  fechaHasta: string;
  dias: number;
  totalVentas: number;
  cantidadTickets: number;
  ticketPromedio: number;
  totalItems: number;
  productosUnicos: number;
  itemsPorTicket: number;
  ventasDiarias: number;
  ticketsDiarios: number;
  ranking: ProductoRanking[];
  porCategoria: CategoriaResumen[];
  porHora: Record<number, { tickets: number; total: number }>;
  porDiaSemana: Record<number, { tickets: number; total: number }>;
}

type Seccion = 'ranking' | 'categorias' | 'horario' | 'tendencia' | 'subebaja';
type OrdenRanking = 'facturacion' | 'cantidad' | 'margen';

interface MesData {
  mes: string;
  totalVentas: number;
  cantidadTickets: number;
  ticketPromedio: number;
}

const MESES_ABREV = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function mesLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MESES_ABREV[Number(m) - 1]} ${y.slice(2)}`;
}

function diasEntre(desde: string, hasta: string): number {
  const d1 = new Date(desde + 'T12:00:00Z').getTime();
  const d2 = new Date(hasta + 'T12:00:00Z').getTime();
  return Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
}

function periodoAnterior(desde: string, hasta: string): { d: string; h: string } {
  const dias = diasEntre(desde, hasta);
  const dHasta = new Date(desde + 'T12:00:00Z');
  dHasta.setUTCDate(dHasta.getUTCDate() - 1);
  const dDesde = new Date(dHasta.getTime());
  dDesde.setUTCDate(dDesde.getUTCDate() - (dias - 1));
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { d: fmt(dDesde), h: fmt(dHasta) };
}

function delta(actual: number, anterior: number): { pct: number; signo: 'up' | 'down' | 'flat' } {
  if (anterior === 0) return { pct: actual > 0 ? 100 : 0, signo: actual > 0 ? 'up' : 'flat' };
  const pct = ((actual - anterior) / anterior) * 100;
  return { pct, signo: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat' };
}

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function FudoLiveTab() {
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia');
  const ahora = new Date();
  const hoy = ymd(ahora);
  const hace7 = ymd(new Date(Date.now() - 7 * 86400000));
  const hace30 = ymd(new Date(Date.now() - 30 * 86400000));
  const primerDelMes = ymd(new Date(ahora.getFullYear(), ahora.getMonth(), 1));
  const primerMesAnt = ymd(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1));
  const ultimoMesAnt = ymd(new Date(ahora.getFullYear(), ahora.getMonth(), 0));
  const [fechaDesde, setFechaDesde] = useState(primerDelMes);
  const [fechaHasta, setFechaHasta] = useState(hoy);
  const [seccion, setSeccion] = useState<Seccion>('ranking');
  const [ordenRanking, setOrdenRanking] = useState<OrdenRanking>('facturacion');
  const [catFiltro, setCatFiltro] = useState<string>('todas');
  const [limite, setLimite] = useState(20);

  const { data, isLoading, error } = useQuery({
    queryKey: ['fudo-productos', local, fechaDesde, fechaHasta],
    queryFn: async () => {
      const { data: resp, error: err } = await supabase.functions.invoke('fudo-productos', {
        body: { local, fechaDesde, fechaHasta },
      });
      if (err) throw new Error(`Edge Function: ${err.message}`);
      if (!resp?.ok) throw new Error(resp?.error ?? 'Error desconocido');
      return resp.data as FudoProductosData;
    },
    staleTime: 5 * 60 * 1000, // cache 5 min
  });

  // Período anterior (mismo nro de días, justo antes del actual) — para Δ% y sube/baja
  const periodoAnt = useMemo(() => periodoAnterior(fechaDesde, fechaHasta), [fechaDesde, fechaHasta]);
  const { data: dataAnt, isLoading: loadingAnt } = useQuery({
    queryKey: ['fudo-productos', local, periodoAnt.d, periodoAnt.h],
    queryFn: async () => {
      const { data: resp, error: err } = await supabase.functions.invoke('fudo-productos', {
        body: { local, fechaDesde: periodoAnt.d, fechaHasta: periodoAnt.h },
      });
      if (err) throw new Error(`Edge Function: ${err.message}`);
      if (!resp?.ok) throw new Error(resp?.error ?? 'Error desconocido');
      return resp.data as FudoProductosData;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Tendencia mensual (12 meses) — sólo depende del local
  const { data: dataMensual, isLoading: loadingMensual } = useQuery({
    queryKey: ['fudo-mensuales', local],
    queryFn: async () => {
      const { data: resp, error: err } = await supabase.functions.invoke('fudo-mensuales', {
        body: { local, meses: 12 },
      });
      if (err) throw new Error(`Edge Function: ${err.message}`);
      if (!resp?.ok) throw new Error(resp?.error ?? 'Error desconocido');
      return resp.data as { local: string; meses: MesData[] };
    },
    staleTime: 30 * 60 * 1000, // 30 min — los meses anteriores no cambian seguido
  });

  // Deltas vs período anterior
  const deltaVentas = useMemo(() => {
    if (!data || !dataAnt) return null;
    return delta(data.totalVentas, dataAnt.totalVentas);
  }, [data, dataAnt]);
  const deltaTickets = useMemo(() => {
    if (!data || !dataAnt) return null;
    return delta(data.cantidadTickets, dataAnt.cantidadTickets);
  }, [data, dataAnt]);
  const deltaTicketProm = useMemo(() => {
    if (!data || !dataAnt) return null;
    return delta(data.ticketPromedio, dataAnt.ticketPromedio);
  }, [data, dataAnt]);

  // Sube/baja de productos (Δ unidades vs período anterior)
  const subeBaja = useMemo(() => {
    if (!data || !dataAnt) return null;
    const antMap = new Map(dataAnt.ranking.map((p) => [p.productId, p]));
    const actMap = new Map(data.ranking.map((p) => [p.productId, p]));
    const ids = new Set([...antMap.keys(), ...actMap.keys()]);
    const items: {
      productId: string;
      nombre: string;
      categoria: string;
      cantAct: number;
      cantAnt: number;
      deltaUds: number;
      deltaPct: number;
      factAct: number;
      factAnt: number;
      esNuevo: boolean;
      desaparecio: boolean;
    }[] = [];
    for (const id of ids) {
      const a = actMap.get(id);
      const b = antMap.get(id);
      const cantAct = a?.cantidad ?? 0;
      const cantAnt = b?.cantidad ?? 0;
      const deltaUds = cantAct - cantAnt;
      const deltaPct = cantAnt > 0 ? (deltaUds / cantAnt) * 100 : cantAct > 0 ? 100 : 0;
      items.push({
        productId: id,
        nombre: a?.nombre ?? b?.nombre ?? `Producto ${id}`,
        categoria: a?.categoria ?? b?.categoria ?? 'Sin categoría',
        cantAct,
        cantAnt,
        deltaUds,
        deltaPct,
        factAct: a?.facturacion ?? 0,
        factAnt: b?.facturacion ?? 0,
        esNuevo: !b && cantAct > 0,
        desaparecio: !a && cantAnt > 0,
      });
    }
    // Filtrar productos con muy pocas unidades en ambos períodos (ruido)
    const significativos = items.filter((p) => Math.max(p.cantAct, p.cantAnt) >= 5);
    const sube = [...significativos].sort((a, b) => b.deltaUds - a.deltaUds).slice(0, 10);
    const baja = [...significativos].sort((a, b) => a.deltaUds - b.deltaUds).slice(0, 10);
    return { sube, baja };
  }, [data, dataAnt]);

  // Datos de tendencia mensual para gráfico
  const tendenciaData = useMemo(() => {
    if (!dataMensual?.meses) return [];
    return dataMensual.meses.map((m) => ({
      mes: mesLabel(m.mes),
      mesRaw: m.mes,
      venta: m.totalVentas,
      tickets: m.cantidadTickets,
      ticketProm: m.ticketPromedio,
    }));
  }, [dataMensual]);

  // Categorías únicas para filtro
  const categorias = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.ranking.map((p) => p.categoria))].sort();
  }, [data]);

  // Ranking filtrado y ordenado
  const rankingFiltrado = useMemo(() => {
    if (!data) return [];
    let items = data.ranking;
    if (catFiltro !== 'todas') items = items.filter((p) => p.categoria === catFiltro);
    if (ordenRanking === 'cantidad') items = [...items].sort((a, b) => b.cantidad - a.cantidad);
    else if (ordenRanking === 'margen') {
      items = [...items]
        .filter((p) => p.costo !== null && p.costo > 0)
        .sort((a, b) => {
          const mA = a.precio > 0 && a.costo ? ((a.precio - a.costo) / a.precio) * 100 : 0;
          const mB = b.precio > 0 && b.costo ? ((b.precio - b.costo) / b.precio) * 100 : 0;
          return mB - mA;
        });
    }
    // facturacion ya viene ordenado por default
    return items.slice(0, limite);
  }, [data, catFiltro, ordenRanking, limite]);

  // Datos por hora
  const horaData = useMemo(() => {
    if (!data?.porHora) return [];
    return Array.from({ length: 24 }, (_, i) => ({
      hora: `${String(i).padStart(2, '0')}hs`,
      tickets: data.porHora[i]?.tickets ?? 0,
      total: data.porHora[i]?.total ?? 0,
    })).filter((h) => h.tickets > 0);
  }, [data]);

  // Datos por día de semana
  const diaData = useMemo(() => {
    if (!data?.porDiaSemana) return [];
    return [1, 2, 3, 4, 5, 6, 0].map((d) => ({
      dia: DIAS_LABEL[d],
      tickets: data.porDiaSemana[d]?.tickets ?? 0,
      total: data.porDiaSemana[d]?.total ?? 0,
    }));
  }, [data]);

  // Pie data categorías
  const catPieData = useMemo(() => {
    if (!data) return [];
    return data.porCategoria.map((c) => ({ name: c.nombre, value: c.facturacion }));
  }, [data]);

  const totalCatFact = data?.porCategoria.reduce((s, c) => s + c.facturacion, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-border bg-white p-3">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'vedia' | 'saavedra')} />
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Desde</label>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Hasta</label>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        {/* Presets rápidos */}
        <div className="ml-2 flex flex-wrap gap-1">
          {[
            { label: 'Hoy', d: hoy, h: hoy },
            { label: 'Semana', d: hace7, h: hoy },
            { label: 'Mes', d: primerDelMes, h: hoy },
            { label: 'Mes anterior', d: primerMesAnt, h: ultimoMesAnt },
            { label: '30 días', d: hace30, h: hoy },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => {
                setFechaDesde(p.d);
                setFechaHasta(p.h);
              }}
              className={cn(
                'rounded px-2 py-1 text-xs',
                fechaDesde === p.d && fechaHasta === p.h
                  ? 'bg-rodziny-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {isLoading && (
          <span className="ml-auto animate-pulse text-xs text-gray-400">Consultando Fudo...</span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{(error as Error).message}</p>
        </div>
      )}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <KPICard
              label="Tickets"
              value={data.cantidadTickets.toLocaleString('es-AR')}
              color="blue"
              change={deltaTickets?.pct}
            />
            <KPICard
              label="Venta total"
              value={formatARS(data.totalVentas)}
              color="green"
              change={deltaVentas?.pct}
            />
            <KPICard
              label="Ticket promedio"
              value={formatARS(data.ticketPromedio)}
              color="yellow"
              change={deltaTicketProm?.pct}
            />
            <KPICard
              label="Productos vendidos"
              value={data.totalItems.toLocaleString('es-AR')}
              color="neutral"
            />
            <KPICard label="Items / ticket" value={String(data.itemsPorTicket)} color="neutral" />
            <KPICard
              label="Productos únicos"
              value={String(data.productosUnicos)}
              color="neutral"
            />
          </div>

          {(dataAnt || loadingAnt) && (
            <p className="text-xs text-gray-400">
              {loadingAnt
                ? 'Calculando comparativo con período anterior...'
                : `Δ vs período anterior: ${periodoAnt.d} → ${periodoAnt.h}`}
            </p>
          )}

          {data.dias > 1 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
              <KPICard
                label="Venta diaria promedio"
                value={formatARS(data.ventasDiarias)}
                color="green"
              />
              <KPICard
                label="Tickets diarios promedio"
                value={String(data.ticketsDiarios)}
                color="blue"
              />
            </div>
          )}

          {/* Sub-tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
            {(
              [
                ['ranking', 'Ranking de productos'],
                ['tendencia', 'Tendencia 12 meses'],
                ['subebaja', 'Sube / Baja'],
                ['categorias', 'Categorías'],
                ['horario', 'Por hora / día'],
              ] as [Seccion, string][]
            ).map(([s, label]) => (
              <button
                key={s}
                onClick={() => setSeccion(s)}
                className={cn(
                  'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                  seccion === s
                    ? 'border-rodziny-600 text-rodziny-800'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── RANKING ── */}
          {seccion === 'ranking' && (
            <div className="space-y-3">
              {/* Controles */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex overflow-hidden rounded-md border border-gray-300">
                  {(
                    [
                      ['facturacion', 'Facturación'],
                      ['cantidad', 'Unidades'],
                      ['margen', 'Margen'],
                    ] as [OrdenRanking, string][]
                  ).map(([o, label]) => (
                    <button
                      key={o}
                      onClick={() => setOrdenRanking(o)}
                      className={cn(
                        'px-3 py-1.5 text-xs font-medium transition-colors',
                        ordenRanking === o
                          ? 'bg-rodziny-800 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <select
                  value={catFiltro}
                  onChange={(e) => setCatFiltro(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-xs"
                >
                  <option value="todas">Todas las categorías</option>
                  {categorias.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <select
                  value={limite}
                  onChange={(e) => setLimite(Number(e.target.value))}
                  className="rounded border border-gray-300 px-2 py-1.5 text-xs"
                >
                  <option value={10}>Top 10</option>
                  <option value={20}>Top 20</option>
                  <option value={50}>Top 50</option>
                  <option value={999}>Todos</option>
                </select>
              </div>

              {/* Tabla ranking */}
              <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-200 bg-gray-50">
                      <tr className="text-[10px] uppercase text-gray-500">
                        <th className="w-8 px-3 py-2.5 text-left">#</th>
                        <th className="px-3 py-2.5 text-left">Producto</th>
                        <th className="px-3 py-2.5 text-left">Categoría</th>
                        <th className="px-3 py-2.5 text-right">Uds</th>
                        <th className="px-3 py-2.5 text-right">Facturación</th>
                        <th className="px-3 py-2.5 text-right">% ventas</th>
                        <th className="px-3 py-2.5 text-right">Precio</th>
                        <th className="px-3 py-2.5 text-right">Costo</th>
                        <th className="px-3 py-2.5 text-right">Margen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rankingFiltrado.map((p, i) => {
                        const margen =
                          p.costo && p.precio > 0 ? ((p.precio - p.costo) / p.precio) * 100 : null;
                        return (
                          <tr key={p.productId} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                            <td className="max-w-[200px] truncate px-3 py-2 font-medium text-gray-900">
                              {p.nombre}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-500">{p.categoria}</td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">
                              {p.cantidad.toLocaleString('es-AR')}
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums text-green-700">
                              {formatARS(p.facturacion)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-gray-500">
                              {pct(p.facturacion, data.totalVentas)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums">
                              {formatARS(p.precio)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-gray-400">
                              {p.costo ? formatARS(p.costo) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {margen !== null ? (
                                <span
                                  className={cn(
                                    'text-xs font-medium',
                                    margen >= 60
                                      ? 'text-green-700'
                                      : margen >= 40
                                        ? 'text-amber-700'
                                        : 'text-red-700',
                                  )}
                                >
                                  {margen.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-xs text-gray-300">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {rankingFiltrado.length === 0 && (
                  <div className="p-8 text-center text-sm text-gray-400">
                    {ordenRanking === 'margen'
                      ? 'No hay productos con costo cargado en Fudo'
                      : 'Sin datos para el período seleccionado'}
                  </div>
                )}
              </div>

              {/* Gráfico top 10 barras */}
              {rankingFiltrado.length > 0 && (
                <div className="rounded-lg border border-surface-border bg-white p-5">
                  <h3 className="mb-4 text-sm font-semibold text-gray-700">
                    Top {Math.min(10, rankingFiltrado.length)} por{' '}
                    {ordenRanking === 'cantidad' ? 'unidades' : 'facturación'}
                  </h3>
                  <ResponsiveContainer
                    width="100%"
                    height={Math.min(10, rankingFiltrado.length) * 36 + 40}
                  >
                    <BarChart
                      data={rankingFiltrado.slice(0, 10).map((p) => ({
                        nombre: p.nombre.length > 25 ? p.nombre.substring(0, 22) + '...' : p.nombre,
                        valor: ordenRanking === 'cantidad' ? p.cantidad : p.facturacion,
                      }))}
                      layout="vertical"
                      margin={{ left: 10, right: 20 }}
                    >
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) =>
                          ordenRanking === 'cantidad' ? String(v) : `$${(v / 1000).toFixed(0)}k`
                        }
                      />
                      <YAxis type="category" dataKey="nombre" width={160} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(v) =>
                          ordenRanking === 'cantidad'
                            ? [Number(v).toLocaleString('es-AR'), 'Unidades']
                            : [formatARS(Number(v)), 'Facturación']
                        }
                      />
                      <Bar dataKey="valor" fill="#4f8828" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* ── CATEGORÍAS ── */}
          {seccion === 'categorias' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Pie chart */}
              <div className="rounded-lg border border-surface-border bg-white p-5">
                <h3 className="mb-4 text-sm font-semibold text-gray-700">
                  Mix de ventas por categoría
                </h3>
                {catPieData.length > 0 && (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={catPieData}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        dataKey="value"
                        label={({ name, value }) =>
                          `${name as string} ${pct(Number(value), totalCatFact)}`
                        }
                        labelLine={false}
                      >
                        {catPieData.map((_, i) => (
                          <Cell key={i} fill={COLORES[i % COLORES.length]} />
                        ))}
                      </Pie>
                      <Legend />
                      <Tooltip formatter={(v) => formatARS(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Tabla categorías */}
              <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
                <div className="border-b border-gray-100 px-5 py-3">
                  <h3 className="text-sm font-semibold text-gray-700">Detalle por categoría</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                        Categoría
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        Productos
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        Uds
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        Facturación
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        %
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.porCategoria.map((c, i) => (
                      <tr key={c.nombre} className="hover:bg-gray-50">
                        <td className="flex items-center gap-2 px-4 py-2.5">
                          <div
                            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ background: COLORES[i % COLORES.length] }}
                          />
                          <span className="font-medium text-gray-700">{c.nombre}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{c.productos}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">
                          {c.cantidad.toLocaleString('es-AR')}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-800">
                          {formatARS(c.facturacion)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-rodziny-700">
                          {pct(c.facturacion, totalCatFact)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── POR HORA / DÍA ── */}
          {seccion === 'horario' && (
            <div className="space-y-6">
              {/* Por hora */}
              <div className="rounded-lg border border-surface-border bg-white p-5">
                <h3 className="mb-4 text-sm font-semibold text-gray-700">
                  Tickets por hora del día
                </h3>
                {horaData.length > 0 && (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={horaData}>
                      <XAxis dataKey="hora" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Tickets']} />
                      <Bar dataKey="tickets" fill="#4f8828" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Por día de semana */}
              {data.dias > 1 && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className="rounded-lg border border-surface-border bg-white p-5">
                    <h3 className="mb-4 text-sm font-semibold text-gray-700">
                      Tickets por día de semana
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={diaData}>
                        <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Tickets']}
                        />
                        <Bar dataKey="tickets" fill="#4f8828" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-lg border border-surface-border bg-white p-5">
                    <h3 className="mb-4 text-sm font-semibold text-gray-700">
                      Facturación por día de semana
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={diaData}>
                        <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                        />
                        <Tooltip formatter={(v) => [formatARS(Number(v)), 'Facturación']} />
                        <Bar dataKey="total" fill="#82c44e" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Tabla resumen por hora */}
              <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
                <div className="border-b border-gray-100 px-5 py-3">
                  <h3 className="text-sm font-semibold text-gray-700">Detalle por hora</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                        Hora
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        Tickets
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        Facturación
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        Ticket prom.
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        % del total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {horaData.map((h) => (
                      <tr key={h.hora} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-700">{h.hora}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">
                          {h.tickets.toLocaleString('es-AR')}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-800">
                          {formatARS(h.total)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">
                          {h.tickets > 0 ? formatARS(h.total / h.tickets) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-rodziny-700">
                          {pct(h.total, data.totalVentas)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── TENDENCIA 12 MESES ── */}
          {seccion === 'tendencia' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-surface-border bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Venta mensual — últimos 12 meses
                  </h3>
                  {loadingMensual && (
                    <span className="animate-pulse text-xs text-gray-400">
                      Cargando histórico...
                    </span>
                  )}
                </div>
                {tendenciaData.length > 0 && (
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={tendenciaData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(v, n) => {
                          const num = Number(v) || 0;
                          if (n === 'Venta') return [formatARS(num), 'Venta'];
                          if (n === 'Tickets') return [num.toLocaleString('es-AR'), 'Tickets'];
                          return [String(v), String(n)];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        yAxisId="left"
                        dataKey="venta"
                        name="Venta"
                        fill="#82c44e"
                        radius={[3, 3, 0, 0]}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="tickets"
                        name="Tickets"
                        stroke="#1b3b0d"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="rounded-lg border border-surface-border bg-white p-5">
                <h3 className="mb-4 text-sm font-semibold text-gray-700">
                  Ticket promedio mensual
                </h3>
                {tendenciaData.length > 0 && (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={tendenciaData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip formatter={(v) => [formatARS(Number(v) || 0), 'Ticket prom.']} />
                      <Line
                        type="monotone"
                        dataKey="ticketProm"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Tabla resumen */}
              <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                        Mes
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        Venta
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        Tickets
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        Ticket prom.
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">
                        Δ vs mes anterior
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tendenciaData.map((m, i) => {
                      const prev = i > 0 ? tendenciaData[i - 1] : null;
                      const d = prev ? delta(m.venta, prev.venta) : null;
                      return (
                        <tr key={m.mesRaw} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-gray-700">{m.mes}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-gray-800">
                            {formatARS(m.venta)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-600">
                            {m.tickets.toLocaleString('es-AR')}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-600">
                            {formatARS(m.ticketProm)}
                          </td>
                          <td
                            className={cn(
                              'px-4 py-2.5 text-right text-xs font-medium',
                              d?.signo === 'up' && 'text-emerald-600',
                              d?.signo === 'down' && 'text-red-600',
                              d?.signo === 'flat' && 'text-gray-400',
                            )}
                          >
                            {d ? `${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── SUBE / BAJA ── */}
          {seccion === 'subebaja' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Compara <strong>{fechaDesde} → {fechaHasta}</strong> ({diasEntre(fechaDesde, fechaHasta)} días)
                vs período anterior <strong>{periodoAnt.d} → {periodoAnt.h}</strong>.
                Se incluyen sólo productos con ≥5 unidades en alguno de los dos períodos.
              </div>

              {loadingAnt && (
                <div className="rounded-lg border border-surface-border bg-white p-8 text-center text-sm text-gray-400">
                  Cargando período anterior...
                </div>
              )}

              {subeBaja && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {/* SUBE */}
                  <div className="overflow-hidden rounded-lg border border-emerald-200 bg-white">
                    <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2.5">
                      <h3 className="text-sm font-semibold text-emerald-800">
                        ▲ Top 10 que más subieron
                      </h3>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                            Producto
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                            Antes
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                            Ahora
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                            Δ uds
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                            Δ %
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {subeBaja.sube.map((p) => (
                          <tr key={p.productId} className="hover:bg-emerald-50/50">
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-800">
                                {p.nombre}
                                {p.esNuevo && (
                                  <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                    nuevo
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-400">{p.categoria}</div>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-500">{p.cantAnt}</td>
                            <td className="px-3 py-2 text-right font-medium text-gray-800">
                              {p.cantAct}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-600">
                              +{p.deltaUds}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-medium text-emerald-600">
                              {p.cantAnt === 0 ? '∞' : `+${p.deltaPct.toFixed(0)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* BAJA */}
                  <div className="overflow-hidden rounded-lg border border-red-200 bg-white">
                    <div className="border-b border-red-100 bg-red-50 px-4 py-2.5">
                      <h3 className="text-sm font-semibold text-red-800">
                        ▼ Top 10 que más cayeron
                      </h3>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                            Producto
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                            Antes
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                            Ahora
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                            Δ uds
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                            Δ %
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {subeBaja.baja.map((p) => (
                          <tr key={p.productId} className="hover:bg-red-50/50">
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-800">
                                {p.nombre}
                                {p.desaparecio && (
                                  <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                                    sin ventas
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-400">{p.categoria}</div>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-500">{p.cantAnt}</td>
                            <td className="px-3 py-2 text-right font-medium text-gray-800">
                              {p.cantAct}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-red-600">
                              {p.deltaUds}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-medium text-red-600">
                              {p.cantAnt === 0 ? '—' : `${p.deltaPct.toFixed(0)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!data && !isLoading && !error && (
        <div className="rounded-lg border border-surface-border bg-white p-12 text-center">
          <p className="text-sm text-gray-400">
            Seleccioná un rango de fechas y hacé click para consultar Fudo
          </p>
        </div>
      )}
    </div>
  );
}
