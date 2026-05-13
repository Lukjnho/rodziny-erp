import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { PRODUCTOS_COCINA, normNombre } from '../DashboardTab';

type TipoItem = 'relleno' | 'masa' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia';

interface PizarronItem {
  id: string;
  fecha_objetivo: string;
  tipo: TipoItem;
  receta_id: string | null;
  cantidad_recetas: number;
  estado: string;
}

interface ProductoBD {
  nombre: string;
  receta: {
    id: string;
    nombre: string;
    tipo: string | null;
    rendimiento_porciones: number | null;
    rendimiento_kg: number | null;
  } | null;
}

interface FudoResp {
  ranking: { nombre: string; cantidad: number }[];
  dias: number;
}

interface ResumenItem {
  recetaId: string;
  recetaNombre: string;
  productoNombre: string;
  tipo: TipoItem;
  totalRecetas: number;
  porcionesEstimadas: number;
  demandaSemanal: number;
  estado: 'cubre' | 'ajustado' | 'corto' | 'sobra' | 'sin_demanda';
}

const TIPO_EMOJI: Record<TipoItem, string> = {
  relleno: '🥟',
  masa: '🍝',
  salsa: '🍅',
  postre: '🍰',
  pasteleria: '🥐',
  panaderia: '🍞',
};

const ESTADO_LABEL: Record<
  ResumenItem['estado'],
  { texto: string; cls: string }
> = {
  cubre: { texto: '🟢 cubre', cls: 'bg-green-100 text-green-800 ring-green-200' },
  ajustado: { texto: '🟡 justo', cls: 'bg-amber-100 text-amber-800 ring-amber-200' },
  corto: { texto: '🔴 falta', cls: 'bg-red-100 text-red-800 ring-red-200' },
  sobra: { texto: '🟣 sobra', cls: 'bg-purple-100 text-purple-800 ring-purple-200' },
  sin_demanda: { texto: '⚪ s/ vta.', cls: 'bg-gray-100 text-gray-600 ring-gray-200' },
};

function lunesDeLaSemana(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function porcionesPorReceta(
  prod: (typeof PRODUCTOS_COCINA)[number],
  receta: { rendimiento_porciones: number | null; rendimiento_kg: number | null },
): number {
  if (receta.rendimiento_porciones && receta.rendimiento_porciones > 0) {
    return receta.rendimiento_porciones;
  }
  if (receta.rendimiento_kg && prod.tipo === 'salsa' && prod.gramosporcion > 0) {
    return (receta.rendimiento_kg * 1000) / prod.gramosporcion;
  }
  return 0;
}

export function ResumenSemanalCard({
  local,
  fechaReferencia,
}: {
  local: 'vedia' | 'saavedra';
  fechaReferencia: string;
}) {
  const [abierto, setAbierto] = useState(true);
  const fechas = useMemo(() => {
    const lunes = lunesDeLaSemana(fechaReferencia);
    return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  }, [fechaReferencia]);

  // Items planificados de la semana (todos los estados no cancelados — para
  // contar incluso los ya iniciados o cumplidos).
  const { data: items } = useQuery({
    queryKey: ['resumen-semanal-items', local, fechas[0], fechas[6]],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pizarron_items')
        .select('id, fecha_objetivo, tipo, receta_id, cantidad_recetas, estado')
        .eq('local', local)
        .gte('fecha_objetivo', fechas[0])
        .lte('fecha_objetivo', fechas[6])
        .neq('estado', 'cancelado');
      if (error) throw error;
      return (data ?? []) as unknown as PizarronItem[];
    },
  });

  // Catálogo de productos con su receta vinculada (= misma key que el editor
  // y el dashboard → cache compartida).
  const { data: productosBD } = useQuery({
    queryKey: ['cocina-productos-sugerencias-plan', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select(
          'nombre, receta:cocina_recetas(id, nombre, tipo, rendimiento_porciones, rendimiento_kg)',
        )
        .eq('local', local)
        .eq('activo', true);
      if (error) throw error;
      const m = new Map<string, ProductoBD>();
      for (const r of (data ?? []) as unknown as ProductoBD[]) m.set(normNombre(r.nombre), r);
      return m;
    },
  });

  // Ventas Fudo (14d) para estimar demanda semanal.
  const hace14 = useMemo(
    () => new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0],
    [],
  );
  const hoyStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  const { data: fudoData } = useQuery({
    queryKey: ['cocina-fudo-sugerencias-plan', local, hace14, hoyStr],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local, fechaDesde: hace14, fechaHasta: hoyStr },
      });
      if (error || !data?.ok) return null;
      return data.data as FudoResp;
    },
    staleTime: 10 * 60 * 1000,
  });

  const resumen = useMemo<ResumenItem[]>(() => {
    if (!items || !productosBD) return [];

    const recetaProductoMap = new Map<
      string,
      { prod: (typeof PRODUCTOS_COCINA)[number]; receta: NonNullable<ProductoBD['receta']> }
    >();
    for (const prod of PRODUCTOS_COCINA.filter((p) => !p.local || p.local === local)) {
      const prodDB = productosBD.get(normNombre(prod.nombre));
      if (prodDB?.receta) {
        recetaProductoMap.set(prodDB.receta.id, { prod, receta: prodDB.receta });
      }
    }

    function demandaDiariaDeProducto(prod: (typeof PRODUCTOS_COCINA)[number]): number {
      if (!fudoData) return 0;
      const nombres = prod.fudoNombres ?? [prod.nombre];
      let total = 0;
      for (const n of nombres) {
        const f = fudoData.ranking.find((r) => r.nombre.toLowerCase() === n.toLowerCase());
        if (f) total += f.cantidad;
      }
      return fudoData.dias > 0 ? total / fudoData.dias : 0;
    }

    const map = new Map<string, ResumenItem>();
    for (const it of items) {
      if (!it.receta_id) continue;
      const info = recetaProductoMap.get(it.receta_id);
      if (!info) continue;
      const ent = map.get(it.receta_id);
      if (ent) {
        ent.totalRecetas += Number(it.cantidad_recetas ?? 0);
      } else {
        map.set(it.receta_id, {
          recetaId: it.receta_id,
          recetaNombre: info.receta.nombre,
          productoNombre: info.prod.nombre,
          tipo: it.tipo,
          totalRecetas: Number(it.cantidad_recetas ?? 0),
          porcionesEstimadas: 0,
          demandaSemanal: demandaDiariaDeProducto(info.prod) * 7,
          estado: 'sin_demanda',
        });
      }
    }

    for (const [recetaId, ent] of map) {
      const info = recetaProductoMap.get(recetaId);
      if (!info) continue;
      const ppr = porcionesPorReceta(info.prod, info.receta);
      ent.porcionesEstimadas = ent.totalRecetas * ppr;

      if (ent.demandaSemanal <= 0) {
        ent.estado = 'sin_demanda';
      } else {
        const ratio = ent.porcionesEstimadas / ent.demandaSemanal;
        if (ratio < 0.8) ent.estado = 'corto';
        else if (ratio < 0.95) ent.estado = 'ajustado';
        else if (ratio <= 1.2) ent.estado = 'cubre';
        else ent.estado = 'sobra';
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const orden = { corto: 0, ajustado: 1, cubre: 2, sobra: 3, sin_demanda: 4 };
      if (orden[a.estado] !== orden[b.estado]) return orden[a.estado] - orden[b.estado];
      return b.porcionesEstimadas - a.porcionesEstimadas;
    });
  }, [items, productosBD, fudoData, local]);

  if (resumen.length === 0) return null;

  const totalRecetas = resumen.reduce((s, r) => s + r.totalRecetas, 0);
  const cortos = resumen.filter((r) => r.estado === 'corto').length;

  return (
    <div className="rounded-lg border border-blue-200 bg-white">
      <button
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            📊 Resumen semanal{' '}
            <span className="text-xs font-normal capitalize text-gray-500">· {local}</span>
          </h3>
          <p className="text-[11px] text-gray-500">
            {resumen.length} receta{resumen.length === 1 ? '' : 's'} · {totalRecetas} en total
            {cortos > 0 && (
              <span className="ml-1 font-medium text-red-700">
                · {cortos} corta{cortos === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </div>
        <span className="text-xs text-gray-500">{abierto ? '▾' : '▸'}</span>
      </button>

      {abierto && (
        <div className="border-t border-gray-100 px-4 py-3">
          <div className="space-y-1">
            {resumen.map((r) => {
              const lbl = ESTADO_LABEL[r.estado];
              const pct =
                r.demandaSemanal > 0
                  ? Math.round((r.porcionesEstimadas / r.demandaSemanal) * 100)
                  : null;
              return (
                <div
                  key={r.recetaId}
                  className="flex items-center justify-between rounded bg-gray-50/40 px-2 py-1 text-xs"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="text-sm">{TIPO_EMOJI[r.tipo]}</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-gray-900">{r.recetaNombre}</div>
                      <div className="text-[10px] text-gray-500">
                        {r.totalRecetas} rec → ~{Math.round(r.porcionesEstimadas)} porc.
                        {r.demandaSemanal > 0 && (
                          <>
                            {' · demanda ~'}
                            {Math.round(r.demandaSemanal)} (7d)
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="ml-2 flex items-center gap-1.5">
                    {pct !== null && <span className="text-[10px] text-gray-500">{pct}%</span>}
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
                        lbl.cls,
                      )}
                    >
                      {lbl.texto}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
