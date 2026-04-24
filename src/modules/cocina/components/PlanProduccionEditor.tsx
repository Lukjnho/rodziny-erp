import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface Receta {
  id: string;
  nombre: string;
  tipo: string;
  local: string | null;
}

type TipoItem = 'relleno' | 'masa' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia';

interface PlanItem {
  id: string;
  tipo: TipoItem;
  receta_id: string | null;
  texto_libre: string | null;
  cantidad_recetas: number;
  turno: 'mañana' | 'tarde' | null;
  notas: string | null;
  estado?: 'pendiente' | 'hecho' | 'parcial' | 'cancelado';
}

// Las masas no se planifican acá — se hacen a demanda según producción.
const TIPOS_VEDIA: { tipo: TipoItem; label: string; emoji: string }[] = [
  { tipo: 'relleno', label: 'Rellenos', emoji: '🥟' },
  { tipo: 'salsa', label: 'Salsas', emoji: '🍅' },
  { tipo: 'postre', label: 'Postres', emoji: '🍰' },
];

const TIPOS_SAAVEDRA: { tipo: TipoItem; label: string; emoji: string }[] = [
  { tipo: 'relleno', label: 'Rellenos', emoji: '🥟' },
  { tipo: 'salsa', label: 'Salsas', emoji: '🍅' },
  { tipo: 'pasteleria', label: 'Pastelería', emoji: '🥐' },
  { tipo: 'panaderia', label: 'Panadería', emoji: '🍞' },
];

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function sumarDias(fecha: string, dias: number) {
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function formatFecha(fecha: string) {
  const d = new Date(fecha + 'T12:00:00');
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' });
}

function nuevoId() {
  return `tmp-${crypto.randomUUID()}`;
}

export function PlanProduccionEditor({
  local,
  onClose,
}: {
  local: 'vedia' | 'saavedra';
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fechas = useMemo(() => [hoy(), sumarDias(hoy(), 1), sumarDias(hoy(), 2)], []);
  const [fechaActiva, setFechaActiva] = useState(fechas[0]);

  const tipos = local === 'vedia' ? TIPOS_VEDIA : TIPOS_SAAVEDRA;

  // Catálogo de recetas activas del local
  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas-plan', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, local')
        .eq('activo', true)
        .or(`local.eq.${local},local.is.null`)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as Receta[];
    },
  });

  // Items existentes del plan (3 días)
  const { data: itemsExistentes } = useQuery({
    queryKey: ['cocina-pizarron-editor', local, fechas[0], fechas[2]],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pizarron_items')
        .select(
          'id, fecha_objetivo, local, turno, tipo, receta_id, texto_libre, cantidad_recetas, estado, notas',
        )
        .eq('local', local)
        .gte('fecha_objetivo', fechas[0])
        .lte('fecha_objetivo', fechas[2]);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Estado local: map fecha -> items
  const [items, setItems] = useState<Record<string, PlanItem[]>>({});

  // Hidratar estado cuando carga itemsExistentes
  useEffect(() => {
    if (!itemsExistentes) return;
    const porFecha: Record<string, PlanItem[]> = {
      [fechas[0]]: [],
      [fechas[1]]: [],
      [fechas[2]]: [],
    };
    for (const row of itemsExistentes) {
      const r = row as {
        id: string;
        fecha_objetivo: string;
        tipo: TipoItem;
        receta_id: string | null;
        texto_libre: string | null;
        cantidad_recetas: number;
        turno: 'mañana' | 'tarde' | null;
        notas: string | null;
        estado: 'pendiente' | 'hecho' | 'parcial' | 'cancelado';
      };
      if (!porFecha[r.fecha_objetivo]) porFecha[r.fecha_objetivo] = [];
      porFecha[r.fecha_objetivo].push({
        id: r.id,
        tipo: r.tipo,
        receta_id: r.receta_id,
        texto_libre: r.texto_libre,
        cantidad_recetas: r.cantidad_recetas,
        turno: r.turno,
        notas: r.notas,
        estado: r.estado,
      });
    }
    setItems(porFecha);
  }, [itemsExistentes, fechas]);

  function agregarItem(fecha: string, tipo: TipoItem) {
    setItems((prev) => ({
      ...prev,
      [fecha]: [
        ...(prev[fecha] ?? []),
        {
          id: nuevoId(),
          tipo,
          receta_id: null,
          texto_libre: null,
          cantidad_recetas: 1,
          turno: tipo === 'salsa' || tipo === 'postre' ? 'tarde' : 'mañana',
          notas: null,
        },
      ],
    }));
  }

  function actualizarItem(fecha: string, itemId: string, patch: Partial<PlanItem>) {
    setItems((prev) => ({
      ...prev,
      [fecha]: (prev[fecha] ?? []).map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
    }));
  }

  function eliminarItem(fecha: string, itemId: string) {
    setItems((prev) => ({
      ...prev,
      [fecha]: (prev[fecha] ?? []).filter((it) => it.id !== itemId),
    }));
  }

  // Guardar: para cada fecha del plan, borrar los 'pendiente' existentes y re-insertar
  // los que el chef dejó. Los 'hecho'/'parcial' no se tocan (son histórico).
  const guardar = useMutation({
    mutationFn: async () => {
      for (const fecha of fechas) {
        const itemsFecha = items[fecha] ?? [];

        // 1) Borrar pendientes/cancelados existentes de esta fecha+local
        await supabase
          .from('cocina_pizarron_items')
          .delete()
          .eq('fecha_objetivo', fecha)
          .eq('local', local)
          .in('estado', ['pendiente', 'cancelado']);

        // 2) Items editables (no 'hecho'/'parcial' — esos se mantienen intactos)
        const nuevos = itemsFecha
          .filter((it) => !it.estado || it.estado === 'pendiente' || it.estado === 'cancelado')
          .filter((it) => it.receta_id || (it.texto_libre && it.texto_libre.trim()))
          .map((it) => ({
            fecha_objetivo: fecha,
            local,
            turno: it.turno,
            tipo: it.tipo,
            receta_id: it.receta_id,
            texto_libre: it.texto_libre?.trim() || null,
            cantidad_recetas: it.cantidad_recetas,
            notas: it.notas?.trim() || null,
            estado: 'pendiente',
          }));

        if (nuevos.length > 0) {
          const { error } = await supabase.from('cocina_pizarron_items').insert(nuevos);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-pizarron-editor'] });
      qc.invalidateQueries({ queryKey: ['cocina-pizarron-hoy'] });
      qc.invalidateQueries({ queryKey: ['plan-semanal-pizarron'] });
      onClose();
    },
  });

  const itemsDelDia = items[fechaActiva] ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Definir plan de producción</h2>
            <p className="text-xs text-gray-500 capitalize">
              Local: {local} · Cargá lo que hay que hacer en los próximos 3 días
            </p>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        {/* Tabs por día */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          {fechas.map((f, i) => {
            const cant = (items[f] ?? []).length;
            return (
              <button
                key={f}
                onClick={() => setFechaActiva(f)}
                className={cn(
                  'flex-1 px-4 py-3 text-sm font-medium transition',
                  fechaActiva === f
                    ? 'border-b-2 border-rodziny-600 bg-white text-rodziny-700'
                    : 'text-gray-500 hover:text-gray-700',
                )}
              >
                <div className="capitalize">
                  {i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : 'Pasado'}
                </div>
                <div className="text-[10px] capitalize text-gray-400">{formatFecha(f)}</div>
                {cant > 0 && (
                  <span className="ml-1 inline-block rounded-full bg-rodziny-100 px-1.5 text-[10px] text-rodziny-700">
                    {cant}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body: secciones por tipo */}
        <div className="flex-1 overflow-y-auto p-6">
          {tipos.map(({ tipo, label, emoji }) => {
            const itemsTipo = itemsDelDia.filter((it) => it.tipo === tipo);
            const recetasTipo = (recetas ?? []).filter((r) => r.tipo === tipo);
            return (
              <section key={tipo} className="mb-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">
                    {emoji} {label}
                    {itemsTipo.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        ({itemsTipo.length})
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => agregarItem(fechaActiva, tipo)}
                    className="rounded border border-rodziny-300 bg-white px-2 py-1 text-xs text-rodziny-700 hover:bg-rodziny-50"
                  >
                    + Agregar
                  </button>
                </div>

                {itemsTipo.length === 0 ? (
                  <p className="rounded border border-dashed border-gray-200 py-3 text-center text-xs text-gray-400">
                    Sin items para {label.toLowerCase()}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {itemsTipo.map((it) => {
                      const bloqueado = it.estado === 'hecho' || it.estado === 'parcial';
                      return (
                        <div
                          key={it.id}
                          className={cn(
                            'grid grid-cols-12 items-center gap-2 rounded border px-2 py-2 text-sm',
                            bloqueado
                              ? 'border-green-200 bg-green-50'
                              : 'border-gray-200 bg-white',
                          )}
                        >
                          {/* Receta */}
                          <div className="col-span-5">
                            <select
                              value={it.receta_id ?? ''}
                              onChange={(e) =>
                                actualizarItem(fechaActiva, it.id, {
                                  receta_id: e.target.value || null,
                                })
                              }
                              disabled={bloqueado}
                              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm disabled:bg-gray-100"
                            >
                              <option value="">Elegí receta…</option>
                              {recetasTipo.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.nombre}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Cantidad */}
                          <div className="col-span-2">
                            <div className="flex items-center rounded border border-gray-300 bg-white">
                              <button
                                onClick={() =>
                                  actualizarItem(fechaActiva, it.id, {
                                    cantidad_recetas: Math.max(0.5, it.cantidad_recetas - 0.5),
                                  })
                                }
                                disabled={bloqueado}
                                className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                              >
                                −
                              </button>
                              <span className="flex-1 text-center text-sm font-semibold tabular-nums">
                                ×{it.cantidad_recetas}
                              </span>
                              <button
                                onClick={() =>
                                  actualizarItem(fechaActiva, it.id, {
                                    cantidad_recetas: it.cantidad_recetas + 0.5,
                                  })
                                }
                                disabled={bloqueado}
                                className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {/* Turno */}
                          <div className="col-span-2">
                            <select
                              value={it.turno ?? ''}
                              onChange={(e) =>
                                actualizarItem(fechaActiva, it.id, {
                                  turno: (e.target.value || null) as PlanItem['turno'],
                                })
                              }
                              disabled={bloqueado}
                              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:bg-gray-100"
                            >
                              <option value="">Sin turno</option>
                              <option value="mañana">🌅 Mañana</option>
                              <option value="tarde">🌇 Tarde</option>
                            </select>
                          </div>

                          {/* Estado + acciones */}
                          <div className="col-span-3 flex items-center justify-end gap-2">
                            {bloqueado ? (
                              <span className="rounded-full bg-green-200 px-2 py-0.5 text-[10px] font-semibold text-green-800">
                                ✓ Hecho
                              </span>
                            ) : (
                              <button
                                onClick={() => eliminarItem(fechaActiva, it.id)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                Eliminar
                              </button>
                            )}
                          </div>

                          {/* Notas opcionales */}
                          <div className="col-span-12">
                            <input
                              type="text"
                              placeholder="Notas (opcional): ej. para sábado, urgente…"
                              value={it.notas ?? ''}
                              onChange={(e) =>
                                actualizarItem(fechaActiva, it.id, { notas: e.target.value })
                              }
                              disabled={bloqueado}
                              className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs disabled:bg-gray-100"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
          {guardar.isError && (
            <span className="mr-auto text-xs text-red-600">
              Error: {(guardar.error as Error)?.message ?? 'desconocido'}
            </span>
          )}
          <button
            onClick={onClose}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => guardar.mutate()}
            disabled={guardar.isPending}
            className="rounded bg-rodziny-700 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-rodziny-800 disabled:opacity-50"
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
