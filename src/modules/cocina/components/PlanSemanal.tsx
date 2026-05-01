import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type TipoPlan = 'relleno' | 'masa' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia';
type EstadoItem = 'pendiente' | 'en_produccion' | 'en_bandejas' | 'ciclo_completo' | 'fuera';

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

// Normaliza un nombre para matching: minúsculas y sin acentos.
function normNombre(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Nivel de estado para "el más avanzado". 'fuera' lo tratamos como ortogonal:
// no escala con el progreso del plan, así que cuando hay items planificados
// ignoramos los fuera para calcular el estado.
function nivelEstado(e: EstadoItem): number {
  switch (e) {
    case 'ciclo_completo':
      return 4;
    case 'en_bandejas':
      return 3;
    case 'en_produccion':
      return 2;
    case 'pendiente':
      return 1;
    case 'fuera':
      return 0;
  }
}

interface ItemPlanDetalle {
  origen: 'plan' | 'fuera';
  cantidad: number | null;
  estado: EstadoItem;
  turno?: 'mañana' | 'tarde' | null;
}

interface ItemAgrupado {
  key: string;
  tipo: TipoPlan;
  nombre: string;
  totalCantidad: number; // suma de cantidad_recetas (planificados + fuera)
  cuentaPlan: number; // cuántos items del plan
  hechosPlan: number; // cuántos del plan están en ciclo_completo
  cuentaFuera: number;
  estado: EstadoItem; // el más avanzado del grupo
  detalle: ItemPlanDetalle[];
}

interface LotePastaDetalle {
  porciones: number | null;
  bandejas: number | null;
  ubicacion: 'freezer_produccion' | 'camara_congelado';
}

interface PastaAgrupada {
  key: string;
  nombre: string;
  cantidadLotes: number;
  totalPorciones: number;
  totalBandejas: number;
  enCamaraPorc: number;
  enFreezerPorc: number;
  detalle: LotePastaDetalle[];
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

  // Set de keys expandidas: una key por card (item agrupado o pasta agrupada).
  // Click toggle. Las cards arrancan colapsadas.
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  function toggleExpandida(key: string) {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

  // Para cada fecha, agrupar items por (tipo, nombreNormalizado).
  // Los items planificados y los fuera-de-plan del mismo nombre se unen en una sola card,
  // con el desglose disponible al expandir.
  const itemsAgrupadosPorFecha = useMemo(() => {
    const map = new Map<string, ItemAgrupado[]>();
    for (const f of fechas) map.set(f, []);

    // Función que devuelve o crea el grupo para (fecha, tipo, nombre).
    function getGrupo(fecha: string, tipo: TipoPlan, nombre: string): ItemAgrupado | null {
      const arr = map.get(fecha);
      if (!arr) return null;
      const key = `${tipo}::${normNombre(nombre)}`;
      let g = arr.find((it) => it.key === key);
      if (!g) {
        g = {
          key,
          tipo,
          nombre,
          totalCantidad: 0,
          cuentaPlan: 0,
          hechosPlan: 0,
          cuentaFuera: 0,
          estado: 'pendiente',
          detalle: [],
        };
        arr.push(g);
      }
      return g;
    }

    // 1) Items del plan
    for (const it of items ?? []) {
      const nombre = it.receta?.nombre ?? it.texto_libre ?? '(sin receta)';
      const g = getGrupo(it.fecha_objetivo, it.tipo, nombre);
      if (!g) continue;
      const estado: EstadoItem = it.estado === 'cancelado' ? 'pendiente' : it.estado;
      g.totalCantidad += Number(it.cantidad_recetas ?? 0);
      g.cuentaPlan += 1;
      if (estado === 'ciclo_completo') g.hechosPlan += 1;
      g.detalle.push({
        origen: 'plan',
        cantidad: it.cantidad_recetas,
        estado,
        turno: it.turno,
      });
      if (nivelEstado(estado) > nivelEstado(g.estado)) g.estado = estado;
    }

    // 2) Lotes "fuera del plan": los que no están vinculados a un PlanItem.
    function pushFuera(
      tipo: TipoPlan,
      lote: { id: string; fecha: string; receta?: { nombre: string } | null; cantidad?: number | null },
      tabla: string,
    ) {
      if (lotesEnPlan.has(`${tabla}:${lote.id}`)) return;
      const nombre = lote.receta?.nombre ?? '(sin receta)';
      const g = getGrupo(lote.fecha, tipo, nombre);
      if (!g) return;
      g.totalCantidad += Number(lote.cantidad ?? 0);
      g.cuentaFuera += 1;
      g.detalle.push({ origen: 'fuera', cantidad: lote.cantidad ?? null, estado: 'fuera' });
      // Solo subimos a 'fuera' si no había nada del plan más avanzado:
      // 'fuera' tiene nivel 0 así que cualquier estado de plan le gana.
      if (g.cuentaPlan === 0 && g.estado === 'pendiente') g.estado = 'fuera';
    }

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

  // Agrupar pastas armadas por nombre. Un mismo producto puede tener varios lotes
  // (distintas tandas del día); los unimos en una card y dejamos el desglose
  // al expandir.
  const pastasAgrupadasPorFecha = useMemo(() => {
    const map = new Map<string, PastaAgrupada[]>();
    for (const f of fechas) map.set(f, []);
    for (const p of lotesPasta ?? []) {
      const arr = map.get(p.fecha);
      if (!arr) continue;
      const nombre = p.producto?.nombre ?? 'Pasta';
      const key = `pasta::${normNombre(nombre)}`;
      let g = arr.find((x) => x.key === key);
      if (!g) {
        g = {
          key,
          nombre,
          cantidadLotes: 0,
          totalPorciones: 0,
          totalBandejas: 0,
          enCamaraPorc: 0,
          enFreezerPorc: 0,
          detalle: [],
        };
        arr.push(g);
      }
      const porc = Number(p.porciones ?? 0);
      g.cantidadLotes += 1;
      g.totalPorciones += porc;
      g.totalBandejas += Number(p.cantidad_cajones ?? 0);
      if (p.ubicacion === 'camara_congelado') g.enCamaraPorc += porc;
      else g.enFreezerPorc += porc;
      g.detalle.push({
        porciones: p.porciones,
        bandejas: p.cantidad_cajones,
        ubicacion: p.ubicacion,
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
            const grupos = itemsAgrupadosPorFecha.get(fecha) ?? [];
            const pastas = pastasAgrupadasPorFecha.get(fecha) ?? [];
            const esHoy = fecha === fechaHoy;
            const esFechaActiva = fecha === fechaActiva;
            const vacio = grupos.length === 0 && pastas.length === 0;

            // Agrupar grupos por tipo para mostrar más ordenado
            const porTipo = new Map<TipoPlan, ItemAgrupado[]>();
            for (const g of grupos) {
              const arr = porTipo.get(g.tipo) ?? [];
              arr.push(g);
              porTipo.set(g.tipo, arr);
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
                          {lista.map((g) => (
                            <ItemAgrupadoCard
                              key={g.key}
                              grupo={g}
                              expandido={expandidas.has(g.key)}
                              onToggle={() => toggleExpandida(g.key)}
                            />
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
                          {pastas.map((g) => (
                            <PastaAgrupadaCard
                              key={g.key}
                              grupo={g}
                              expandido={expandidas.has(g.key)}
                              onToggle={() => toggleExpandida(g.key)}
                            />
                          ))}
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

// ── Card: item planificado agrupado ───────────────────────────────────────────

function ItemAgrupadoCard({
  grupo,
  expandido,
  onToggle,
}: {
  grupo: ItemAgrupado;
  expandido: boolean;
  onToggle: () => void;
}) {
  const cantidadLabel = grupo.totalCantidad > 0 ? grupo.totalCantidad : null;
  const colapsadoTachado = grupo.estado === 'ciclo_completo';

  return (
    <button
      onClick={onToggle}
      className={cn(
        'block w-full rounded border-l-2 bg-white px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-gray-50',
        grupo.estado === 'ciclo_completo' && 'border-green-400',
        grupo.estado === 'en_bandejas' && 'border-blue-400',
        grupo.estado === 'en_produccion' && 'border-amber-400',
        grupo.estado === 'pendiente' && 'border-gray-200',
        grupo.estado === 'fuera' && 'border-purple-400',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className={cn('flex-1 truncate', colapsadoTachado && 'text-gray-500 line-through')}
          title={grupo.nombre}
        >
          {grupo.nombre}
          {cantidadLabel != null && (
            <span className="ml-1 text-gray-400">×{cantidadLabel}</span>
          )}
        </span>
        <span className="text-[9px] text-gray-300">{expandido ? '▾' : '▸'}</span>
      </div>
      <div
        className={cn(
          'mt-0.5 text-[9px] font-semibold uppercase',
          grupo.estado === 'ciclo_completo' && 'text-green-700',
          grupo.estado === 'en_bandejas' && 'text-blue-700',
          grupo.estado === 'en_produccion' && 'text-amber-700',
          grupo.estado === 'pendiente' && 'text-gray-500',
          grupo.estado === 'fuera' && 'text-purple-700',
        )}
      >
        {grupo.estado === 'ciclo_completo' && '✅ Ciclo completo'}
        {grupo.estado === 'en_bandejas' && '🧊 En bandejas'}
        {grupo.estado === 'en_produccion' && '🥣 En producción'}
        {grupo.estado === 'pendiente' && '⏳ A terminar'}
        {grupo.estado === 'fuera' && '🆕 Fuera del plan'}
        {grupo.cuentaPlan > 1 && (
          <span className="ml-1 text-[9px] font-normal normal-case text-gray-400">
            · {grupo.hechosPlan}/{grupo.cuentaPlan}
          </span>
        )}
        {grupo.cuentaPlan > 0 && grupo.cuentaFuera > 0 && (
          <span className="ml-1 text-[9px] font-normal normal-case text-purple-600">
            +{grupo.cuentaFuera} extra
          </span>
        )}
      </div>

      {expandido && (
        <div className="mt-1 space-y-0.5 border-t border-gray-100 pt-1">
          {grupo.detalle.map((d, i) => (
            <div key={i} className="flex items-center justify-between text-[10px] text-gray-600">
              <span className="truncate">
                {d.origen === 'fuera' ? '🆕 ' : ''}
                {d.cantidad != null && <span className="text-gray-400">×{d.cantidad} </span>}
                <span
                  className={cn(
                    'font-medium',
                    d.estado === 'ciclo_completo' && 'text-green-700',
                    d.estado === 'en_bandejas' && 'text-blue-700',
                    d.estado === 'en_produccion' && 'text-amber-700',
                    d.estado === 'pendiente' && 'text-gray-500',
                    d.estado === 'fuera' && 'text-purple-700',
                  )}
                >
                  {d.estado === 'ciclo_completo' && 'completo'}
                  {d.estado === 'en_bandejas' && 'en bandejas'}
                  {d.estado === 'en_produccion' && 'en producción'}
                  {d.estado === 'pendiente' && 'pendiente'}
                  {d.estado === 'fuera' && 'fuera del plan'}
                </span>
              </span>
              {d.turno && (
                <span className="ml-1 text-[9px] text-gray-400">
                  {d.turno === 'mañana' ? '🌅' : '🌇'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Card: pasta armada agrupada ───────────────────────────────────────────────

function PastaAgrupadaCard({
  grupo,
  expandido,
  onToggle,
}: {
  grupo: PastaAgrupada;
  expandido: boolean;
  onToggle: () => void;
}) {
  const todoEnCamara = grupo.enFreezerPorc === 0 && grupo.enCamaraPorc > 0;
  const todoEnFreezer = grupo.enCamaraPorc === 0 && grupo.enFreezerPorc > 0;
  const mixto = grupo.enCamaraPorc > 0 && grupo.enFreezerPorc > 0;

  return (
    <button
      onClick={onToggle}
      className={cn(
        'block w-full rounded border-l-2 bg-white px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-gray-50',
        todoEnCamara && 'border-emerald-400',
        todoEnFreezer && 'border-blue-300',
        mixto && 'border-emerald-300',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="flex-1 truncate" title={grupo.nombre}>
          {grupo.nombre}
          {grupo.totalBandejas > 0 && (
            <span className="ml-1 text-gray-400">×{grupo.totalBandejas} band.</span>
          )}
        </span>
        <span className="text-[9px] text-gray-300">{expandido ? '▾' : '▸'}</span>
      </div>
      <div
        className={cn(
          'mt-0.5 text-[9px] font-semibold uppercase',
          todoEnCamara && 'text-emerald-700',
          todoEnFreezer && 'text-blue-700',
          mixto && 'text-emerald-700',
        )}
      >
        {todoEnCamara && `✅ En cámara · ${grupo.totalPorciones} porc.`}
        {todoEnFreezer && `🧊 En freezer · ${grupo.totalPorciones} porc.`}
        {mixto && (
          <>
            🧊 {grupo.enFreezerPorc} fresc. · ✅ {grupo.enCamaraPorc} cám.
          </>
        )}
        {grupo.cantidadLotes > 1 && (
          <span className="ml-1 text-[9px] font-normal normal-case text-gray-400">
            · {grupo.cantidadLotes} lotes
          </span>
        )}
      </div>

      {expandido && (
        <div className="mt-1 space-y-0.5 border-t border-gray-100 pt-1">
          {grupo.detalle.map((d, i) => (
            <div key={i} className="flex items-center justify-between text-[10px] text-gray-600">
              <span>
                {d.bandejas != null && <span className="text-gray-400">×{d.bandejas} band. </span>}
                <span className="font-medium">{d.porciones ?? 0} porc.</span>
              </span>
              <span
                className={cn(
                  'text-[9px] font-medium',
                  d.ubicacion === 'camara_congelado' ? 'text-emerald-700' : 'text-blue-700',
                )}
              >
                {d.ubicacion === 'camara_congelado' ? 'cámara' : 'freezer'}
              </span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}
