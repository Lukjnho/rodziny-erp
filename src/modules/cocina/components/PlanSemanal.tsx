import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type TipoPlan = 'relleno' | 'masa' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia';

interface PlanItem {
  id: string;
  fecha_objetivo: string;
  local: string;
  turno: 'mañana' | 'tarde' | null;
  tipo: TipoPlan;
  receta_id: string | null;
  texto_libre: string | null;
  cantidad_recetas: number;
  cantidad_hecha: number | null;
  estado: 'pendiente' | 'en_produccion' | 'en_bandejas' | 'ciclo_completo' | 'cancelado';
  lote_tabla: string | null;
  lote_id: string | null;
  receta?: { nombre: string } | null;
}

interface LoteRelleno {
  id: string;
  fecha: string;
  receta_id: string | null;
  receta?: { nombre: string } | null;
  cantidad_recetas: number | null;
}

interface LoteMasa {
  id: string;
  fecha: string;
  receta_id: string | null;
  receta?: { nombre: string } | null;
  kg_producidos: number;
}

interface LoteProduccion {
  id: string;
  fecha: string;
  receta_id: string | null;
  categoria: string;
  receta?: { nombre: string } | null;
}

interface LotePastaSemana {
  id: string;
  fecha: string;
  ubicacion: 'freezer_produccion' | 'camara_congelado';
  porciones: number | null;
  cantidad_cajones: number | null;
  producto?: { nombre: string } | null;
}

const TIPO_LABEL: Record<TipoPlan, string> = {
  relleno: 'Rellenos',
  masa: 'Masas',
  salsa: 'Salsas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
};

const TIPO_EMOJI: Record<TipoPlan, string> = {
  relleno: '🥟',
  masa: '🍝',
  salsa: '🍅',
  postre: '🍰',
  pasteleria: '🥐',
  panaderia: '🍞',
};

const DIAS_CORTOS = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

function lunesDeLaSemana(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function fechasSemana(fechaActiva: string): string[] {
  const lun = lunesDeLaSemana(fechaActiva);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lun + 'T12:00:00');
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function diaCorto(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00');
  return DIAS_CORTOS[d.getDay()];
}

function ddmm(fecha: string): string {
  const [, mm, dd] = fecha.split('-');
  return `${dd}/${mm}`;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ItemRender {
  key: string;
  tipo: TipoPlan;
  nombre: string;
  cantidad: number | null;
  estado: 'pendiente' | 'en_produccion' | 'en_bandejas' | 'ciclo_completo' | 'fuera';
  turno?: 'mañana' | 'tarde' | null;
}

interface PastaRender {
  key: string;
  nombre: string;
  ubicacion: 'freezer_produccion' | 'camara_congelado';
  porciones: number | null;
  cantidad_cajones: number | null;
}

export function PlanSemanal({
  fechaActiva,
  local,
  onAbrirEditor,
}: {
  fechaActiva: string;
  local: 'vedia' | 'saavedra';
  onAbrirEditor: () => void;
}) {
  const fechas = useMemo(() => fechasSemana(fechaActiva), [fechaActiva]);
  const desde = fechas[0];
  const hasta = fechas[6];

  const { data: items, isLoading: cargandoPlan } = useQuery({
    queryKey: ['plan-semanal-pizarron', local, desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pizarron_items')
        .select(
          'id, fecha_objetivo, local, turno, tipo, receta_id, texto_libre, cantidad_recetas, cantidad_hecha, estado, lote_tabla, lote_id, receta:cocina_recetas(nombre)',
        )
        .eq('local', local)
        .gte('fecha_objetivo', desde)
        .lte('fecha_objetivo', hasta);
      if (error) throw error;
      return (data ?? []).filter((it) => it.estado !== 'cancelado') as unknown as PlanItem[];
    },
  });

  const { data: lotesRelleno } = useQuery({
    queryKey: ['plan-semanal-relleno', local, desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_relleno')
        .select('id, fecha, receta_id, cantidad_recetas, receta:cocina_recetas(nombre)')
        .eq('local', local)
        .gte('fecha', desde)
        .lte('fecha', hasta);
      if (error) throw error;
      return (data ?? []) as unknown as LoteRelleno[];
    },
  });

  const { data: lotesMasa } = useQuery({
    queryKey: ['plan-semanal-masa', local, desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_masa')
        .select('id, fecha, receta_id, kg_producidos, receta:cocina_recetas(nombre)')
        .eq('local', local)
        .gte('fecha', desde)
        .lte('fecha', hasta);
      if (error) throw error;
      return (data ?? []) as unknown as LoteMasa[];
    },
  });

  const { data: lotesProduccion } = useQuery({
    queryKey: ['plan-semanal-produccion', local, desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('id, fecha, receta_id, categoria, receta:cocina_recetas(nombre)')
        .eq('local', local)
        .gte('fecha', desde)
        .lte('fecha', hasta);
      if (error) throw error;
      return (data ?? []) as unknown as LoteProduccion[];
    },
  });

  const { data: lotesPasta } = useQuery({
    queryKey: ['plan-semanal-pasta', local, desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('id, fecha, ubicacion, porciones, cantidad_cajones, producto:cocina_productos(nombre)')
        .eq('local', local)
        .gte('fecha', desde)
        .lte('fecha', hasta);
      if (error) throw error;
      return (data ?? []) as unknown as LotePastaSemana[];
    },
  });

  // Set de lote_id ya vinculados al plan → lotes que NO estén acá son "fuera del plan".
  const lotesEnPlan = useMemo(() => {
    const set = new Set<string>();
    for (const it of items ?? []) {
      if (it.lote_id && it.lote_tabla) set.add(`${it.lote_tabla}:${it.lote_id}`);
    }
    return set;
  }, [items]);

  // Para cada fecha, armar la lista combinada de items del plan + fuera-de-plan + pastas.
  const itemsPorFecha = useMemo(() => {
    const map = new Map<string, ItemRender[]>();
    for (const f of fechas) map.set(f, []);

    for (const it of items ?? []) {
      const arr = map.get(it.fecha_objetivo);
      if (!arr) continue;
      const nombre = it.receta?.nombre ?? it.texto_libre ?? '(sin receta)';
      arr.push({
        key: `plan-${it.id}`,
        tipo: it.tipo,
        nombre,
        cantidad: it.cantidad_recetas,
        estado: it.estado === 'cancelado' ? 'pendiente' : it.estado,
        turno: it.turno,
      });
    }

    const pushFuera = (
      tipo: TipoPlan,
      lote: { id: string; fecha: string; receta?: { nombre: string } | null; cantidad?: number | null },
      tabla: string,
    ) => {
      if (lotesEnPlan.has(`${tabla}:${lote.id}`)) return;
      const arr = map.get(lote.fecha);
      if (!arr) return;
      arr.push({
        key: `fuera-${tabla}-${lote.id}`,
        tipo,
        nombre: lote.receta?.nombre ?? '(sin receta)',
        cantidad: lote.cantidad ?? null,
        estado: 'fuera',
      });
    };

    for (const l of lotesRelleno ?? []) {
      pushFuera('relleno', { ...l, cantidad: l.cantidad_recetas ?? null }, 'cocina_lotes_relleno');
    }
    for (const l of lotesMasa ?? []) {
      pushFuera('masa', { ...l, cantidad: null }, 'cocina_lotes_masa');
    }
    for (const l of lotesProduccion ?? []) {
      const tipo = l.categoria as TipoPlan;
      if (!(tipo in TIPO_LABEL)) continue;
      pushFuera(tipo, { ...l, cantidad: null }, 'cocina_lotes_produccion');
    }

    return map;
  }, [items, lotesRelleno, lotesMasa, lotesProduccion, lotesEnPlan, fechas]);

  // Pastas armadas por día (todas, sin tag fuera-de-plan).
  const pastasPorFecha = useMemo(() => {
    const map = new Map<string, PastaRender[]>();
    for (const f of fechas) map.set(f, []);
    for (const p of lotesPasta ?? []) {
      const arr = map.get(p.fecha);
      if (!arr) continue;
      arr.push({
        key: `pasta-${p.id}`,
        nombre: p.producto?.nombre ?? 'Pasta',
        ubicacion: p.ubicacion,
        porciones: p.porciones,
        cantidad_cajones: p.cantidad_cajones,
      });
    }
    return map;
  }, [lotesPasta, fechas]);

  // KPI semanal
  const kpi = useMemo(() => {
    let hechos = 0;
    let total = 0;
    for (const it of items ?? []) {
      total++;
      if (it.estado === 'ciclo_completo') hechos++;
    }
    return { hechos, total, pct: total === 0 ? 0 : Math.round((hechos / total) * 100) };
  }, [items]);

  const fechaHoy = hoy();

  return (
    <div className="rounded-lg border border-surface-border bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Plan semanal <span className="text-xs font-normal capitalize text-gray-500">· {local}</span>
          </h3>
          <p className="text-[11px] text-gray-500">
            Semana del {ddmm(desde)} al {ddmm(hasta)}
            {kpi.total > 0 && (
              <>
                {' · '}
                {kpi.hechos} de {kpi.total} cumplidos · {kpi.pct}%
              </>
            )}
          </p>
        </div>
        <button
          onClick={onAbrirEditor}
          className="rounded bg-rodziny-700 px-3 py-1.5 text-sm text-white hover:bg-rodziny-800"
        >
          Editar plan
        </button>
      </div>

      {kpi.total > 0 && (
        <div className="px-4 pt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${kpi.pct}%` }}
            />
          </div>
        </div>
      )}

      {cargandoPlan ? (
        <div className="px-4 py-6 text-center text-xs text-gray-400">Cargando…</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2 xl:grid-cols-7">
          {fechas.map((fecha) => {
            const its = itemsPorFecha.get(fecha) ?? [];
            const pastas = pastasPorFecha.get(fecha) ?? [];
            const esHoy = fecha === fechaHoy;
            const esFechaActiva = fecha === fechaActiva;
            const vacio = its.length === 0 && pastas.length === 0;

            // Agrupar items por tipo para mostrar más ordenado
            const porTipo = new Map<TipoPlan, ItemRender[]>();
            for (const it of its) {
              const arr = porTipo.get(it.tipo) ?? [];
              arr.push(it);
              porTipo.set(it.tipo, arr);
            }

            return (
              <div
                key={fecha}
                className={cn(
                  'rounded border p-2',
                  esHoy
                    ? 'border-rodziny-300 bg-rodziny-50/40'
                    : esFechaActiva
                      ? 'border-blue-200 bg-blue-50/30'
                      : 'border-gray-100 bg-gray-50',
                )}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span
                    className={cn(
                      'text-[11px] font-semibold uppercase',
                      esHoy ? 'text-rodziny-800' : 'text-gray-700',
                    )}
                  >
                    {diaCorto(fecha)} {ddmm(fecha)}
                    {esHoy && <span className="ml-1 text-[9px] text-rodziny-600">· hoy</span>}
                  </span>
                </div>

                {vacio ? (
                  <div className="rounded border border-dashed border-gray-200 px-2 py-3 text-center text-[10px] text-gray-400">
                    Sin plan
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {Array.from(porTipo.entries()).map(([tipo, lista]) => (
                      <div key={tipo}>
                        <div className="mb-0.5 text-[10px] font-medium text-gray-500">
                          {TIPO_EMOJI[tipo]} {TIPO_LABEL[tipo]}
                        </div>
                        <div className="space-y-0.5">
                          {lista.map((it) => (
                            <div
                              key={it.key}
                              className={cn(
                                'rounded border-l-2 bg-white px-1.5 py-1 text-[11px]',
                                it.estado === 'ciclo_completo' && 'border-green-400',
                                it.estado === 'en_bandejas' && 'border-blue-400',
                                it.estado === 'en_produccion' && 'border-amber-400',
                                it.estado === 'pendiente' && 'border-gray-200',
                                it.estado === 'fuera' && 'border-purple-400',
                              )}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <span
                                  className={cn(
                                    'flex-1 truncate',
                                    it.estado === 'ciclo_completo' && 'text-gray-500 line-through',
                                  )}
                                  title={it.nombre}
                                >
                                  {it.nombre}
                                  {it.cantidad != null && (
                                    <span className="ml-1 text-gray-400">×{it.cantidad}</span>
                                  )}
                                </span>
                                {it.turno && (
                                  <span className="text-[9px] text-gray-400">
                                    {it.turno === 'mañana' ? '🌅' : '🌇'}
                                  </span>
                                )}
                              </div>
                              <div
                                className={cn(
                                  'mt-0.5 text-[9px] font-semibold uppercase',
                                  it.estado === 'ciclo_completo' && 'text-green-700',
                                  it.estado === 'en_bandejas' && 'text-blue-700',
                                  it.estado === 'en_produccion' && 'text-amber-700',
                                  it.estado === 'pendiente' && 'text-gray-500',
                                  it.estado === 'fuera' && 'text-purple-700',
                                )}
                              >
                                {it.estado === 'ciclo_completo' && '✅ Ciclo completo'}
                                {it.estado === 'en_bandejas' && '🧊 En bandejas'}
                                {it.estado === 'en_produccion' && '🥣 En producción'}
                                {it.estado === 'pendiente' && '⏳ A terminar'}
                                {it.estado === 'fuera' && '🆕 Fuera del plan'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {pastas.length > 0 && (
                      <div>
                        <div className="mb-0.5 text-[10px] font-medium text-gray-500">
                          🍜 Pastas armadas
                        </div>
                        <div className="space-y-0.5">
                          {pastas.map((p) => {
                            const enCamara = p.ubicacion === 'camara_congelado';
                            return (
                              <div
                                key={p.key}
                                className={cn(
                                  'rounded border-l-2 bg-white px-1.5 py-1 text-[11px]',
                                  enCamara ? 'border-emerald-400' : 'border-blue-300',
                                )}
                              >
                                <div className="truncate" title={p.nombre}>
                                  {p.nombre}
                                  {p.cantidad_cajones && (
                                    <span className="ml-1 text-gray-400">
                                      ×{p.cantidad_cajones} band.
                                    </span>
                                  )}
                                </div>
                                <div
                                  className={cn(
                                    'mt-0.5 text-[9px] font-semibold uppercase',
                                    enCamara ? 'text-emerald-700' : 'text-blue-700',
                                  )}
                                >
                                  {enCamara
                                    ? `✅ En cámara${p.porciones ? ` · ${p.porciones} porc.` : ''}`
                                    : '🧊 En freezer'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
