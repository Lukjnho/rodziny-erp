import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, cn } from '@/lib/utils';

const MESES_LABEL = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

function totalMes(porMes: Map<string, number>, meses: string[]): number {
  return meses.reduce((s, m) => s + (porMes.get(m) ?? 0), 0);
}

function formatCell(v: number): string {
  return v !== 0 ? formatARS(v) : '—';
}

interface SubcatData {
  nombre: string;
  porMes: Map<string, number>;
}
interface CatData {
  nombre: string;
  subcats: Map<string, SubcatData>;
  porMes: Map<string, number>;
}

interface Props {
  local: 'vedia' | 'saavedra' | 'ambos';
}

export function AnalisisGastos({ local }: Props) {
  const localActivo = local === 'ambos' ? null : local;
  const [año, setAño] = useState(() => String(new Date().getFullYear()));
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const { data: rawGastos, isLoading } = useQuery({
    queryKey: ['gastos_vista', año, local],
    queryFn: async () => {
      let q = supabase
        .from('gastos')
        .select('categoria, subcategoria, periodo, importe_total, importe_neto')
        .gte('periodo', `${año}-01`)
        .lte('periodo', `${año}-12`)
        .neq('cancelado', true);
      if (localActivo) q = q.eq('local', localActivo);
      const { data } = await q;
      return data ?? [];
    },
  });

  // Ventas del año para ratio gastos/ventas
  const { data: ventasAnio } = useQuery({
    queryKey: ['ventas_para_ratio_gastos', año, local],
    queryFn: async () => {
      const PAGE = 1000;
      const allRows: { fecha: string; total_bruto: number; medio_pago: string | null }[] = [];
      let from = 0;
      while (true) {
        let q = supabase
          .from('ventas_tickets')
          .select('fecha, total_bruto, medio_pago')
          .gte('fecha', `${año}-01-01`)
          .lte('fecha', `${año}-12-31`)
          .neq('estado', 'Cancelada')
          .neq('estado', 'Eliminada')
          .or('es_dividendo.is.null,es_dividendo.eq.false')
          .range(from, from + PAGE - 1);
        if (localActivo) q = q.eq('local', localActivo);
        const { data } = await q;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return allRows;
    },
  });

  const { categorias, mesesConDatos } = useMemo(() => {
    const cats = new Map<string, CatData>();
    const mesesSet = new Set<string>();

    for (const g of rawGastos ?? []) {
      const cat = g.categoria || 'Sin categoría';
      const sub = g.subcategoria || cat;
      const mes = g.periodo;
      const monto = Number(g.importe_neto ?? g.importe_total) || 0;
      if (!monto) continue;

      mesesSet.add(mes);

      if (!cats.has(cat)) cats.set(cat, { nombre: cat, subcats: new Map(), porMes: new Map() });
      const catObj = cats.get(cat)!;
      catObj.porMes.set(mes, (catObj.porMes.get(mes) ?? 0) + monto);

      if (!catObj.subcats.has(sub)) catObj.subcats.set(sub, { nombre: sub, porMes: new Map() });
      const subObj = catObj.subcats.get(sub)!;
      subObj.porMes.set(mes, (subObj.porMes.get(mes) ?? 0) + monto);
    }

    return {
      categorias: cats,
      mesesConDatos: Array.from(mesesSet).sort(),
    };
  }, [rawGastos]);

  const totalGeneral = useMemo(() => {
    const map = new Map<string, number>();
    for (const [, cat] of categorias) {
      for (const [mes, v] of cat.porMes) {
        map.set(mes, (map.get(mes) ?? 0) + v);
      }
    }
    return map;
  }, [categorias]);

  const meses = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${año}-${String(i + 1).padStart(2, '0')}`),
    [año],
  );

  function toggleCat(cat: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function expandirTodo() {
    setExpandidos(new Set(categorias.keys()));
  }
  function colapsarTodo() {
    setExpandidos(new Set());
  }

  const totalAcum = totalMes(totalGeneral, meses);

  // ── KPIs: top categoría del año, último mes y variación ───────────────────
  const mesesOrdenados = meses.filter((m) => (totalGeneral.get(m) ?? 0) > 0);
  const ultimoMes = mesesOrdenados[mesesOrdenados.length - 1];
  const mesAnterior = mesesOrdenados[mesesOrdenados.length - 2];
  const gastoUltimo = ultimoMes ? (totalGeneral.get(ultimoMes) ?? 0) : 0;
  const gastoAnterior = mesAnterior ? (totalGeneral.get(mesAnterior) ?? 0) : 0;
  const variacionPct =
    gastoAnterior > 0 ? ((gastoUltimo - gastoAnterior) / gastoAnterior) * 100 : null;

  const topCategoria = (() => {
    let best: { nombre: string; total: number } | null = null;
    for (const [, cat] of categorias) {
      const t = totalMes(cat.porMes, meses);
      if (!best || t > best.total) best = { nombre: cat.nombre, total: t };
    }
    return best;
  })();
  const topPct = totalAcum > 0 && topCategoria ? (topCategoria.total / totalAcum) * 100 : 0;

  // Ratio gastos/ventas (anual) — los dividendos ya se filtran en la query
  const ventasTotalesAnio = (ventasAnio ?? []).reduce((s, t) => s + Number(t.total_bruto), 0);
  const ratioGastosVentas = ventasTotalesAnio > 0 ? (totalAcum / ventasTotalesAnio) * 100 : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Año</label>
          <input
            type="number"
            min="2020"
            max="2099"
            value={año}
            onChange={(e) => setAño(e.target.value)}
            className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
          />
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={expandirTodo} className="text-xs text-rodziny-700 hover:underline">
            Expandir todo
          </button>
          <span className="text-gray-300">|</span>
          <button onClick={colapsarTodo} className="text-xs text-gray-500 hover:underline">
            Colapsar todo
          </button>
        </div>
      </div>

      {/* KPIs del año */}
      {!isLoading && categorias.size > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">Gasto total del año</div>
            <div className="text-lg font-semibold tabular-nums text-gray-900">
              {formatARS(totalAcum)}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              {mesesOrdenados.length} {mesesOrdenados.length === 1 ? 'mes' : 'meses'} con datos
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">Variación último mes</div>
            <div className="text-lg font-semibold tabular-nums">
              {variacionPct === null ? (
                <span className="text-gray-400">—</span>
              ) : (
                <span
                  className={
                    variacionPct > 5
                      ? 'text-red-700'
                      : variacionPct < -5
                        ? 'text-green-700'
                        : 'text-gray-900'
                  }
                >
                  {variacionPct >= 0 ? '+' : ''}
                  {variacionPct.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              {ultimoMes && mesAnterior
                ? `${MESES_LABEL[parseInt(ultimoMes.substring(5, 7)) - 1]} vs ${MESES_LABEL[parseInt(mesAnterior.substring(5, 7)) - 1]}`
                : 'necesita ≥2 meses cargados'}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">Categoría #1</div>
            <div
              className="truncate text-lg font-semibold text-gray-900"
              title={topCategoria?.nombre ?? ''}
            >
              {topCategoria?.nombre ?? '—'}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              {topCategoria
                ? `${formatARS(topCategoria.total)} · ${topPct.toFixed(1)}% del total`
                : ''}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">Gastos / Ventas</div>
            <div className="text-lg font-semibold tabular-nums">
              {ratioGastosVentas === null ? (
                <span className="text-gray-400">—</span>
              ) : (
                <span
                  className={
                    ratioGastosVentas > 90
                      ? 'text-red-700'
                      : ratioGastosVentas > 75
                        ? 'text-amber-700'
                        : 'text-green-700'
                  }
                >
                  {ratioGastosVentas.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              {ventasTotalesAnio > 0
                ? `Ventas ${formatARS(ventasTotalesAnio)}`
                : 'sin ventas cargadas'}
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-sm text-gray-400">
          Cargando...
        </div>
      ) : categorias.size === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-gray-400">
          <span>Sin datos para {año}.</span>
          <span className="text-xs">
            Cargá gastos en el tab "Listado" o importá desde Finanzas → Importar datos.
          </span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-900 text-white">
                  <th className="sticky left-0 z-10 min-w-[220px] bg-gray-900 px-4 py-3 text-left font-semibold">
                    CONCEPTO
                  </th>
                  {meses.map((mes) => (
                    <th
                      key={mes}
                      className={cn(
                        'min-w-[100px] px-3 py-3 text-right font-semibold',
                        mesesConDatos.includes(mes) ? 'text-white' : 'text-gray-500',
                      )}
                    >
                      {MESES_LABEL[parseInt(mes.substring(5, 7)) - 1]}
                    </th>
                  ))}
                  <th className="min-w-[115px] border-l border-gray-700 px-3 py-3 text-right font-semibold text-yellow-300">
                    ACUM
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b-2 border-rodziny-600 bg-rodziny-800 text-white">
                  <td className="sticky left-0 z-10 bg-rodziny-800 px-4 py-2.5 font-bold">
                    RODZINY {localActivo ? `· ${localActivo.toUpperCase()}` : '(CONSOLIDADO)'}
                  </td>
                  {meses.map((mes) => (
                    <td key={mes} className="px-3 py-2.5 text-right font-semibold">
                      {formatCell(totalGeneral.get(mes) ?? 0)}
                    </td>
                  ))}
                  <td className="border-l border-rodziny-600 px-3 py-2.5 text-right font-bold text-yellow-300">
                    {formatCell(totalAcum)}
                  </td>
                </tr>

                {Array.from(categorias.values()).map((cat) => {
                  const isOpen = expandidos.has(cat.nombre);
                  const acumCat = totalMes(cat.porMes, meses);

                  return [
                    <tr
                      key={`cat-${cat.nombre}`}
                      className="cursor-pointer border-b border-gray-700 bg-gray-800 text-white transition-colors hover:bg-gray-700"
                      onClick={() => toggleCat(cat.nombre)}
                    >
                      <td className="sticky left-0 z-10 bg-gray-800 px-4 py-2 font-semibold hover:bg-gray-700">
                        <span className="mr-2 text-gray-400">{isOpen ? '▾' : '▸'}</span>
                        {cat.nombre}
                      </td>
                      {meses.map((mes) => (
                        <td key={mes} className="px-3 py-2 text-right font-medium">
                          {formatCell(cat.porMes.get(mes) ?? 0)}
                        </td>
                      ))}
                      <td className="border-l border-gray-700 px-3 py-2 text-right font-semibold text-yellow-300">
                        {formatCell(acumCat)}
                      </td>
                    </tr>,

                    ...(isOpen
                      ? Array.from(cat.subcats.values())
                          .map((sub) => {
                            const acumSub = totalMes(sub.porMes, meses);
                            if (sub.nombre === cat.nombre && cat.subcats.size === 1) return null;
                            return (
                              <tr
                                key={`sub-${cat.nombre}-${sub.nombre}`}
                                className="border-b border-gray-50 bg-white hover:bg-gray-50"
                              >
                                <td className="sticky left-0 z-10 bg-white px-4 py-1.5 pl-10 text-gray-700 hover:bg-gray-50">
                                  {sub.nombre}
                                </td>
                                {meses.map((mes) => (
                                  <td key={mes} className="px-3 py-1.5 text-right text-gray-600">
                                    {formatCell(sub.porMes.get(mes) ?? 0)}
                                  </td>
                                ))}
                                <td className="border-l border-gray-100 px-3 py-1.5 text-right font-medium text-gray-700">
                                  {formatCell(acumSub)}
                                </td>
                              </tr>
                            );
                          })
                          .filter(Boolean)
                      : []),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
