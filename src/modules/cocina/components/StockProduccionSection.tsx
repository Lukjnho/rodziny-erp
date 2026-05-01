import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface LoteStock {
  id: string;
  fecha: string;
  local: string;
  categoria: string;
  receta_id: string | null;
  nombre_libre: string | null;
  cantidad_producida: number;
  unidad: 'kg' | 'unid' | 'lt';
  merma_cantidad: number | null;
  cantidad_restante_manual: number | null;
  en_stock: boolean;
  created_at: string;
  receta?: {
    id: string;
    nombre: string;
    tipo: string;
    gramos_por_porcion: number | null;
    fudo_productos: string[] | null;
  } | null;
}

interface FudoProductoRank {
  nombre: string;
  cantidad: number;
}

interface FudoDataResp {
  ranking?: FudoProductoRank[];
}

const CAT_LABEL: Record<string, string> = {
  salsa: 'Salsa',
  postre: 'Postre',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  prueba: 'Prueba',
};
const CAT_COLOR: Record<string, string> = {
  salsa: 'bg-orange-100 text-orange-700',
  postre: 'bg-pink-100 text-pink-700',
  pasteleria: 'bg-pink-100 text-pink-700',
  panaderia: 'bg-yellow-100 text-yellow-700',
  prueba: 'bg-purple-100 text-purple-700',
};

export function StockProduccionSection({
  filtroLocal,
}: {
  filtroLocal: 'todos' | 'vedia' | 'saavedra';
}) {
  const qc = useQueryClient();

  const { data: lotes, isLoading } = useQuery({
    queryKey: ['stock-produccion-lotes', filtroLocal],
    queryFn: async () => {
      let q = supabase
        .from('cocina_lotes_produccion')
        .select('*, receta:cocina_recetas(id, nombre, tipo, gramos_por_porcion, fudo_productos)')
        .eq('en_stock', true)
        .order('receta_id')
        .order('created_at');
      if (filtroLocal !== 'todos') q = q.eq('local', filtroLocal);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as LoteStock[];
    },
  });

  const fechaMin = useMemo(() => {
    if (!lotes || lotes.length === 0) return null;
    return lotes.reduce((min, l) => (l.fecha < min ? l.fecha : min), lotes[0].fecha);
  }, [lotes]);

  const { data: fudoResp } = useQuery({
    queryKey: ['stock-produccion-fudo', filtroLocal, fechaMin],
    queryFn: async () => {
      if (!fechaMin || filtroLocal === 'todos') return null;
      const hoy = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local: filtroLocal, fechaDesde: fechaMin, fechaHasta: hoy },
      });
      if (error) return null;
      if (!data?.ok) return null;
      return data.data as FudoDataResp;
    },
    enabled: !!fechaMin && filtroLocal !== 'todos',
    staleTime: 5 * 60 * 1000,
  });

  // Agrupar por receta y aplicar FIFO
  const grupos = useMemo(() => {
    if (!lotes) return [];
    const porReceta = new Map<string, LoteStock[]>();
    for (const l of lotes) {
      const key = l.receta_id ?? `libre:${l.nombre_libre ?? '—'}`;
      if (!porReceta.has(key)) porReceta.set(key, []);
      porReceta.get(key)!.push(l);
    }

    const rankingByNombre = new Map<string, number>();
    for (const p of fudoResp?.ranking ?? [])
      rankingByNombre.set(p.nombre.toLowerCase(), p.cantidad);
    const productosFudoList = fudoResp?.ranking ?? [];

    return Array.from(porReceta.entries())
      .map(([key, batches]) => {
        const receta = batches[0].receta;
        const gramosPorcion = receta?.gramos_por_porcion ?? null;
        const nombreReceta = (receta?.nombre ?? batches[0].nombre_libre ?? '').toLowerCase().trim();

        // Resolver productos Fudo asociados:
        //   - Si la receta tiene fudo_productos manuales → usarlos (override)
        //   - Si no → auto-match: productos Fudo cuyo nombre contiene el nombre de la receta
        const fudoManual = receta?.fudo_productos ?? [];
        let fudoNombres: string[] = [];
        let fuenteMatch: 'manual' | 'auto' | 'ninguno' = 'ninguno';
        if (fudoManual.length > 0) {
          fudoNombres = fudoManual;
          fuenteMatch = 'manual';
        } else if (nombreReceta.length >= 3) {
          // Palabra "Scarparo" matchea "Spaghetti Scarparo", "Ñoquis Scarparo", etc.
          fudoNombres = productosFudoList
            .filter((p) => p.nombre.toLowerCase().includes(nombreReceta))
            .map((p) => p.nombre);
          if (fudoNombres.length > 0) fuenteMatch = 'auto';
        }

        // Consumo total en la misma unidad que los batches
        let consumoTotalEnUnidad = 0;
        const unidadBatch = batches[0].unidad;
        let ventasAsociadas = 0;
        for (const nombre of fudoNombres) {
          const c = rankingByNombre.get(nombre.toLowerCase()) ?? 0;
          ventasAsociadas += c;
        }
        if (gramosPorcion && unidadBatch === 'kg') {
          consumoTotalEnUnidad = (ventasAsociadas * gramosPorcion) / 1000;
        } else {
          // unidad o lt: consumo = 1 x venta (o gramos/1000 si lt y gramos_por_porcion)
          consumoTotalEnUnidad =
            gramosPorcion && unidadBatch === 'lt'
              ? (ventasAsociadas * gramosPorcion) / 1000
              : ventasAsociadas;
        }

        // FIFO: descontar consumo del más viejo al más nuevo
        let consumoRestante = consumoTotalEnUnidad;
        const batchesFifo = batches.map((b) => {
          const disponibleBruto = b.cantidad_producida - (b.merma_cantidad ?? 0);
          const consumidoFifo = Math.min(Math.max(0, consumoRestante), disponibleBruto);
          consumoRestante = Math.max(0, consumoRestante - consumidoFifo);
          const restanteCalc = Math.max(0, disponibleBruto - consumidoFifo);
          const restanteReal =
            b.cantidad_restante_manual != null ? b.cantidad_restante_manual : restanteCalc;
          return { ...b, disponibleBruto, consumidoFifo, restanteCalc, restanteReal };
        });

        const totalProducido = batches.reduce((s, b) => s + b.cantidad_producida, 0);
        const totalRestante = batchesFifo.reduce((s, b) => s + b.restanteReal, 0);

        return {
          key,
          nombre: receta?.nombre ?? batches[0].nombre_libre ?? '—',
          tipo: batches[0].categoria,
          unidadBatch,
          gramosPorcion,
          fudoNombres,
          fuenteMatch,
          ventasAsociadas,
          consumoTotalEnUnidad,
          totalProducido,
          totalRestante,
          batches: batchesFifo,
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [lotes, fudoResp]);

  const editarRestante = useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: number | null }) => {
      const { error } = await supabase
        .from('cocina_lotes_produccion')
        .update({ cantidad_restante_manual: valor })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-produccion-lotes'] });
      // El Dashboard también deriva su stock de salsas/postres de la misma tabla
      qc.invalidateQueries({ queryKey: ['cocina_stock_salsas_postres'] });
    },
  });

  const agotar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('cocina_lotes_produccion')
        .update({ en_stock: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-produccion-lotes'] });
      qc.invalidateQueries({ queryKey: ['cocina-lotes-produccion'] });
      qc.invalidateQueries({ queryKey: ['cocina_stock_salsas_postres'] });
    },
  });

  // Estado de cards expandidas: se persiste sólo en memoria.
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  function toggleExpandida(key: string) {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Recetas sin productos Fudo asociados — para el banner único arriba.
  const sinFudo = useMemo(
    () => grupos.filter((g) => g.fudoNombres.length === 0).map((g) => g.nombre),
    [grupos],
  );

  if (filtroLocal === 'todos') {
    return (
      <div>
        <h3 className="mb-2 text-base font-semibold text-gray-800">
          Proyección de producción (salsas, postres, etc.)
        </h3>
        <div className="rounded-lg border border-surface-border bg-white p-4 text-center text-sm text-gray-400">
          Seleccioná un local (Vedia o Saavedra) para ver la proyección de consumo con Fudo.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-800">Proyección de producción</h3>
        <span className="text-[10px] text-gray-500">
          Consumo estimado = ventas Fudo × g/porción · FIFO por fecha · override manual si se pesó
          la batea
        </span>
      </div>

      {isLoading && <p className="text-xs text-gray-400">Cargando stock…</p>}

      {!isLoading && grupos.length === 0 && (
        <div className="rounded-lg border border-surface-border bg-white p-4 text-center text-sm text-gray-400">
          No hay lotes activos en stock. Cuando el equipo cargue una salsa/postre con "Cargar a
          stock" ON, aparecerá acá.
        </div>
      )}

      {sinFudo.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          <p className="font-semibold">
            {sinFudo.length} receta{sinFudo.length > 1 ? 's' : ''} sin productos Fudo asociados
          </p>
          <p className="mt-0.5 text-amber-600">
            Sin proyección automática de consumo: {sinFudo.join(' · ')}. Configurá productos en
            Recetas → Editar → General para que se descuenten al vender.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {grupos.map((g) => {
          const expandido = expandidas.has(g.key);
          const semaforo =
            g.totalRestante <= 0
              ? 'text-red-600'
              : g.totalRestante < g.totalProducido * 0.2
                ? 'text-amber-600'
                : 'text-green-700';
          const sinFudoCard = g.fudoNombres.length === 0;

          return (
            <div
              key={g.key}
              className="overflow-hidden rounded-lg border border-surface-border bg-white"
            >
              {/* Header colapsado: clickeable para expandir */}
              <button
                onClick={() => toggleExpandida(g.key)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gray-50"
              >
                <span
                  className={
                    'rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                    (CAT_COLOR[g.tipo] ?? 'bg-gray-100 text-gray-600')
                  }
                >
                  {CAT_LABEL[g.tipo] ?? g.tipo}
                </span>
                <span className="text-sm font-semibold text-gray-800">{g.nombre}</span>
                <span className="text-[11px] text-gray-500">
                  {g.batches.length} batch{g.batches.length > 1 ? 'es' : ''}
                </span>
                {sinFudoCard && (
                  <span className="rounded bg-amber-100 px-1.5 py-0 text-[9px] font-semibold text-amber-700">
                    sin Fudo
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2 text-xs">
                  <span className={cn('font-bold', semaforo)}>
                    {g.totalRestante.toFixed(2)} {g.unidadBatch}
                  </span>
                  <span className="text-[10px] text-gray-300">{expandido ? '▾' : '▸'}</span>
                </span>
              </button>

              {/* Detalle expandido */}
              {expandido && (
                <div className="border-t border-gray-100">
                  {sinFudoCard ? (
                    <p className="bg-amber-50 px-4 py-2 text-[11px] text-amber-700">
                      No hay productos Fudo asociados — proyección manual. Configurá productos en
                      Recetas → Editar → General.
                    </p>
                  ) : (
                    <p className="border-b border-gray-50 px-4 py-1.5 text-[11px] text-gray-500">
                      <span
                        className={
                          'mr-1.5 inline-block rounded px-1.5 py-0 text-[9px] font-semibold ' +
                          (g.fuenteMatch === 'manual'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-green-100 text-green-700')
                        }
                      >
                        {g.fuenteMatch === 'manual' ? 'MANUAL' : 'AUTO'}
                      </span>
                      Ventas Fudo asociadas:{' '}
                      <strong className="text-gray-700">{g.ventasAsociadas} porciones</strong>
                      {g.gramosPorcion &&
                        ` × ${g.gramosPorcion}g = ${g.consumoTotalEnUnidad.toFixed(2)} ${g.unidadBatch}`}
                      · Productos: {g.fudoNombres.join(', ')}
                    </p>
                  )}

                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50/50 text-[10px] uppercase text-gray-500">
                        <th className="px-4 py-1.5 text-left">Fecha</th>
                        <th className="px-4 py-1.5 text-right">Producido</th>
                        <th className="px-4 py-1.5 text-right">Consumido (FIFO)</th>
                        <th className="px-4 py-1.5 text-right">Restante calc.</th>
                        <th className="px-4 py-1.5 text-right">Restante real</th>
                        <th className="px-4 py-1.5 text-left">Local</th>
                        <th className="px-4 py-1.5 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.batches.map((b) => {
                        const fechaLabel = new Date(b.created_at).toLocaleString('es-AR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                        const esManual = b.cantidad_restante_manual != null;
                        const agotadoVirt = b.restanteReal <= 0.001;
                        return (
                          <tr
                            key={b.id}
                            className={
                              'border-t border-gray-50 ' + (agotadoVirt ? 'bg-red-50/30' : '')
                            }
                          >
                            <td className="px-4 py-1.5 text-gray-600">{fechaLabel}</td>
                            <td className="px-4 py-1.5 text-right tabular-nums">
                              {b.cantidad_producida} {b.unidad}
                            </td>
                            <td className="px-4 py-1.5 text-right tabular-nums text-gray-600">
                              {b.consumidoFifo.toFixed(2)}
                            </td>
                            <td className="px-4 py-1.5 text-right tabular-nums text-gray-600">
                              {b.restanteCalc.toFixed(2)}
                            </td>
                            <td className="px-4 py-1.5 text-right tabular-nums">
                              <span className={esManual ? 'font-semibold text-blue-700' : ''}>
                                {b.restanteReal.toFixed(2)} {b.unidad}
                              </span>
                              {esManual && (
                                <span className="ml-1 text-[9px] text-blue-500">manual</span>
                              )}
                            </td>
                            <td className="px-4 py-1.5 capitalize text-gray-600">{b.local}</td>
                            <td className="px-4 py-1.5 text-center">
                              <div className="inline-flex gap-1.5">
                                <button
                                  onClick={() => {
                                    const raw = window.prompt(
                                      `Pesaste la batea de "${g.nombre}"?\nCantidad real restante (en ${b.unidad}):\n\nDejá vacío para volver al cálculo FIFO.`,
                                      esManual ? String(b.cantidad_restante_manual) : '',
                                    );
                                    if (raw === null) return;
                                    if (raw.trim() === '') {
                                      editarRestante.mutate({ id: b.id, valor: null });
                                    } else {
                                      const n = Number(raw.replace(',', '.'));
                                      if (!Number.isNaN(n) && n >= 0)
                                        editarRestante.mutate({ id: b.id, valor: n });
                                    }
                                  }}
                                  className="text-blue-600 hover:text-blue-800"
                                >
                                  Editar restante
                                </button>
                                <button
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `¿Agotar este batch de "${g.nombre}"? (sale del stock)`,
                                      )
                                    )
                                      agotar.mutate(b.id);
                                  }}
                                  className="text-red-500 hover:text-red-700"
                                >
                                  Agotar
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
