import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type TipoPlan = 'relleno' | 'masa' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia';
type EstadoItem =
  | 'pendiente'
  | 'en_produccion'
  | 'en_bandejas'
  | 'ciclo_completo'
  | 'en_mostrador_parcial'
  | 'en_mostrador';

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

interface LoteMasa {
  id: string;
  fecha: string;
  receta_id: string | null;
  receta?: { nombre: string } | null;
  kg_producidos: number;
}

interface LotePastaSemana {
  id: string;
  fecha: string;
  ubicacion: 'freezer_produccion' | 'camara_congelado';
  porciones: number | null;
  cantidad_cajones: number | null;
  producto_id: string;
  lote_relleno_id: string | null;
  lote_masa_id: string | null;
  producto?: { nombre: string } | null;
}

interface PastaRecetaMap {
  pasta_id: string;
  receta_id: string;
  receta?: { tipo: string } | null;
}

interface TrazabilidadRow {
  pizarron_id: string;
  pastas_total_iniciales: number;
  pastas_a_mostrador: number;
  pastas_saldo_camara: number;
  pastas_merma: number;
  pastas_cantidad_lotes: number;
  estado_trazabilidad: EstadoItem;
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

// Tipos a mostrar como categoría en el día. Las masas se omiten porque
// se hacen a demanda (no se planifican) y se ven dentro de la card del
// relleno con el que se usaron.
const TIPOS_VISIBLES: TipoPlan[] = ['relleno', 'salsa', 'postre', 'pasteleria', 'panaderia'];

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

function normNombre(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function nivelEstado(e: EstadoItem): number {
  switch (e) {
    case 'en_mostrador':
      return 6;
    case 'en_mostrador_parcial':
      return 5;
    case 'ciclo_completo':
      return 4;
    case 'en_bandejas':
      return 3;
    case 'en_produccion':
      return 2;
    case 'pendiente':
      return 1;
  }
}

interface ItemPlanDetalle {
  cantidad: number | null;
  estado: EstadoItem;
  turno?: 'mañana' | 'tarde' | null;
}

interface MasaUsada {
  loteMasaId: string;
  recetaId: string | null;
  nombre: string;
  kg: number;
  pastasCompartidas: number; // cuántas pastas distintas comparten esta masa según cocina_pasta_recetas
}

interface PastaArmada {
  loteId: string;
  pastaId: string;
  nombre: string;
  porciones: number;
  bandejas: number;
  ubicacion: 'freezer_produccion' | 'camara_congelado';
}

// Card "madre": un item del plan (relleno con flujo enriquecido o salsa/postre/etc).
// Para tipos sin flujo (salsa/postre/pasteleria/panaderia) los campos
// masasUsadas y pastasArmadas quedan vacíos.
interface ItemAgrupado {
  key: string;
  tipo: TipoPlan;
  nombre: string;
  recetaId: string | null;
  totalCantidad: number;
  cuentaPlan: number;
  hechosPlan: number;
  estado: EstadoItem;
  detalle: ItemPlanDetalle[];
  masasUsadas: MasaUsada[]; // solo para relleno
  pastasArmadas: PastaArmada[]; // solo para relleno
  // Trazabilidad agregada (solo relleno/masa): qué pasó con la pasta derivada.
  porcionesIniciales: number;
  porcionesAMostrador: number;
  porcionesSaldoCamara: number;
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

  const { data: lotesPasta } = useQuery({
    queryKey: ['plan-semanal-pasta', local, desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select(
          'id, fecha, ubicacion, porciones, cantidad_cajones, producto_id, lote_relleno_id, lote_masa_id, producto:cocina_productos(nombre)',
        )
        .eq('local', local)
        .gte('fecha', desde)
        .lte('fecha', hasta);
      if (error) throw error;
      return (data ?? []) as unknown as LotePastaSemana[];
    },
  });

  // Mapping pasta ↔ recetas (relleno + masa) según cocina_pasta_recetas.
  // Sirve para vincular un relleno con las pastas que se hacen con él.
  const { data: pastaRecetas } = useQuery({
    queryKey: ['plan-semanal-pasta-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pasta_recetas')
        .select('pasta_id, receta_id, receta:cocina_recetas(tipo)');
      if (error) throw error;
      return (data ?? []) as unknown as PastaRecetaMap[];
    },
    staleTime: 30 * 60 * 1000,
  });

  // Vista de trazabilidad: para cada item del plan con lote ya cargado, devuelve
  // cuántas porciones de pasta hay en cámara / mostrador y el estado_trazabilidad
  // extendido (en_mostrador_parcial / en_mostrador) que va más allá de ciclo_completo.
  const { data: trazabilidad } = useQuery({
    queryKey: ['plan-semanal-trazabilidad', local, desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cocina_pizarron_trazabilidad')
        .select(
          'pizarron_id, pastas_total_iniciales, pastas_a_mostrador, pastas_saldo_camara, pastas_merma, pastas_cantidad_lotes, estado_trazabilidad',
        )
        .eq('local', local)
        .gte('fecha_objetivo', desde)
        .lte('fecha_objetivo', hasta);
      if (error) throw error;
      const map = new Map<string, TrazabilidadRow>();
      for (const row of (data ?? []) as unknown as TrazabilidadRow[]) {
        map.set(row.pizarron_id, row);
      }
      return map;
    },
  });

  // Maps invertidos para acelerar lookups.
  const maps = useMemo(() => {
    const rellenoAPastas = new Map<string, Set<string>>(); // receta_id (relleno) → set pasta_id
    const masaAPastas = new Map<string, Set<string>>(); // receta_id (masa) → set pasta_id
    const pastaAReceta = new Map<string, { rellenos: Set<string>; masas: Set<string> }>();
    for (const r of pastaRecetas ?? []) {
      const tipo = r.receta?.tipo ?? null;
      const dest = tipo === 'relleno' ? rellenoAPastas : tipo === 'masa' ? masaAPastas : null;
      if (dest) {
        if (!dest.has(r.receta_id)) dest.set(r.receta_id, new Set());
        dest.get(r.receta_id)!.add(r.pasta_id);
      }
      if (!pastaAReceta.has(r.pasta_id)) {
        pastaAReceta.set(r.pasta_id, { rellenos: new Set(), masas: new Set() });
      }
      const e = pastaAReceta.get(r.pasta_id)!;
      if (tipo === 'relleno') e.rellenos.add(r.receta_id);
      else if (tipo === 'masa') e.masas.add(r.receta_id);
    }
    return { rellenoAPastas, masaAPastas, pastaAReceta };
  }, [pastaRecetas]);

  // Para cada fecha, agrupar items del plan por (tipo, receta) y, solo para
  // los rellenos planificados, enriquecer con masas usadas + pastas armadas
  // vinculadas vía cocina_pasta_recetas.
  const datosPorFecha = useMemo(() => {
    type DiaData = {
      grupos: ItemAgrupado[];
    };
    const map = new Map<string, DiaData>();
    for (const f of fechas) map.set(f, { grupos: [] });

    function getGrupo(
      fecha: string,
      tipo: TipoPlan,
      nombre: string,
      recetaId: string | null,
    ): ItemAgrupado | null {
      const data = map.get(fecha);
      if (!data) return null;
      const idKey = recetaId ?? `nombre:${normNombre(nombre)}`;
      const key = `${tipo}::${idKey}`;
      let g = data.grupos.find((it) => it.key === key);
      if (!g) {
        g = {
          key,
          tipo,
          nombre,
          recetaId,
          totalCantidad: 0,
          cuentaPlan: 0,
          hechosPlan: 0,
          estado: 'pendiente',
          detalle: [],
          masasUsadas: [],
          pastasArmadas: [],
          porcionesIniciales: 0,
          porcionesAMostrador: 0,
          porcionesSaldoCamara: 0,
        };
        data.grupos.push(g);
      }
      return g;
    }

    // 1) Items del plan (omitir tipo 'masa', no se planifican).
    //    El estado real del item se toma de la vista de trazabilidad si existe
    //    (extiende ciclo_completo → en_mostrador_parcial / en_mostrador). Si no
    //    hay registro en la vista (item pendiente o sin lote derivado todavía),
    //    se usa el estado del pizarrón.
    for (const it of items ?? []) {
      if (!TIPOS_VISIBLES.includes(it.tipo)) continue;
      const nombre = it.receta?.nombre ?? it.texto_libre ?? '(sin receta)';
      const g = getGrupo(it.fecha_objetivo, it.tipo, nombre, it.receta_id);
      if (!g) continue;
      const traza = trazabilidad?.get(it.id);
      const estadoBase: EstadoItem = it.estado === 'cancelado' ? 'pendiente' : it.estado;
      const estado: EstadoItem = (traza?.estado_trazabilidad as EstadoItem) ?? estadoBase;
      g.totalCantidad += Number(it.cantidad_recetas ?? 0);
      g.cuentaPlan += 1;
      if (estado === 'ciclo_completo' || estado === 'en_mostrador_parcial' || estado === 'en_mostrador') {
        g.hechosPlan += 1;
      }
      g.detalle.push({
        cantidad: it.cantidad_recetas,
        estado,
        turno: it.turno,
      });
      if (nivelEstado(estado) > nivelEstado(g.estado)) g.estado = estado;
      if (traza) {
        g.porcionesIniciales += Number(traza.pastas_total_iniciales ?? 0);
        g.porcionesAMostrador += Number(traza.pastas_a_mostrador ?? 0);
        g.porcionesSaldoCamara += Number(traza.pastas_saldo_camara ?? 0);
      }
    }

    // 2) Pastas armadas: solo se muestran si su relleno está planificado en el día.
    //    Las que no tengan card madre en el plan se descartan (no aparecen sueltas).
    for (const f of fechas) {
      const data = map.get(f)!;
      const lotesDelDia = (lotesPasta ?? []).filter((p) => p.fecha === f);

      for (const p of lotesDelDia) {
        const nombre = p.producto?.nombre ?? 'Pasta';
        const porc = Number(p.porciones ?? 0);
        const bandejas = Number(p.cantidad_cajones ?? 0);
        const armada: PastaArmada = {
          loteId: p.id,
          pastaId: p.producto_id,
          nombre,
          porciones: porc,
          bandejas,
          ubicacion: p.ubicacion,
        };

        const recetasDeLaPasta = maps.pastaAReceta.get(p.producto_id);
        const rellenosDeLaPasta = recetasDeLaPasta?.rellenos ?? new Set<string>();

        for (const g of data.grupos) {
          if (g.tipo !== 'relleno') continue;
          if (g.recetaId && rellenosDeLaPasta.has(g.recetaId)) {
            g.pastasArmadas.push(armada);
            break;
          }
        }
      }
    }

    // 3) Vincular lotes_masa: solo a rellenos planificados que comparten pastas
    //    con esa masa según cocina_pasta_recetas. Las masas sueltas se descartan.
    for (const f of fechas) {
      const data = map.get(f)!;
      const masasDelDia = (lotesMasa ?? []).filter((m) => m.fecha === f);

      for (const m of masasDelDia) {
        if (!m.receta_id) continue;
        const pastasQueUsanMasa = maps.masaAPastas.get(m.receta_id) ?? new Set<string>();
        if (pastasQueUsanMasa.size === 0) continue;

        const rellenosVinculados = data.grupos.filter(
          (g) =>
            g.tipo === 'relleno' &&
            g.recetaId &&
            (maps.rellenoAPastas.get(g.recetaId) ?? new Set()).size > 0 &&
            [...(maps.rellenoAPastas.get(g.recetaId) ?? new Set())].some((pid) =>
              pastasQueUsanMasa.has(pid),
            ),
        );

        for (const g of rellenosVinculados) {
          if (g.masasUsadas.some((mu) => mu.loteMasaId === m.id)) continue;
          g.masasUsadas.push({
            loteMasaId: m.id,
            recetaId: m.receta_id,
            nombre: m.receta?.nombre ?? '(masa sin receta)',
            kg: Number(m.kg_producidos ?? 0),
            pastasCompartidas: pastasQueUsanMasa.size,
          });
        }
      }
    }

    return map;
  }, [items, lotesMasa, lotesPasta, fechas, maps, trazabilidad]);

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
            const data = datosPorFecha.get(fecha) ?? { grupos: [] };
            const esHoy = fecha === fechaHoy;
            const esFechaActiva = fecha === fechaActiva;
            const vacio = data.grupos.length === 0;

            const porTipo = new Map<TipoPlan, ItemAgrupado[]>();
            for (const g of data.grupos) {
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
                    {TIPOS_VISIBLES.map((tipo) => {
                      const lista = porTipo.get(tipo);
                      if (!lista || lista.length === 0) return null;
                      return (
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
                      );
                    })}

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

// ── Card madre: relleno (con flujo) o salsa/postre/etc (sin flujo) ────────────

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
  const colapsadoTachado = grupo.estado === 'en_mostrador';
  const totalPorciones = grupo.pastasArmadas.reduce((s, p) => s + p.porciones, 0);
  const tieneFlujo = grupo.tipo === 'relleno';
  const hayTrazabilidad = grupo.porcionesIniciales > 0;
  const pctEnMostrador = hayTrazabilidad
    ? Math.min(100, Math.round((grupo.porcionesAMostrador / grupo.porcionesIniciales) * 100))
    : 0;

  return (
    <button
      onClick={onToggle}
      className={cn(
        'block w-full rounded border-l-2 bg-white px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-gray-50',
        grupo.estado === 'en_mostrador' && 'border-emerald-500',
        grupo.estado === 'en_mostrador_parcial' && 'border-emerald-400',
        grupo.estado === 'ciclo_completo' && 'border-green-400',
        grupo.estado === 'en_bandejas' && 'border-blue-400',
        grupo.estado === 'en_produccion' && 'border-amber-400',
        grupo.estado === 'pendiente' && 'border-gray-200',
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
          grupo.estado === 'en_mostrador' && 'text-emerald-700',
          grupo.estado === 'en_mostrador_parcial' && 'text-emerald-600',
          grupo.estado === 'ciclo_completo' && 'text-green-700',
          grupo.estado === 'en_bandejas' && 'text-blue-700',
          grupo.estado === 'en_produccion' && 'text-amber-700',
          grupo.estado === 'pendiente' && 'text-gray-500',
        )}
      >
        {grupo.estado === 'en_mostrador' && '🛒 En mostrador'}
        {grupo.estado === 'en_mostrador_parcial' && '🛒 Saliendo al mostrador'}
        {grupo.estado === 'ciclo_completo' && '✅ En cámara'}
        {grupo.estado === 'en_bandejas' && '🧊 En bandejas'}
        {grupo.estado === 'en_produccion' && '🥣 En producción'}
        {grupo.estado === 'pendiente' && '⏳ A terminar'}
        {grupo.cuentaPlan > 1 && (
          <span className="ml-1 text-[9px] font-normal normal-case text-gray-400">
            · {grupo.hechosPlan}/{grupo.cuentaPlan}
          </span>
        )}
        {tieneFlujo && totalPorciones > 0 && (
          <span className="ml-1 text-[9px] font-normal normal-case text-emerald-700">
            → {totalPorciones} porc.
          </span>
        )}
      </div>

      {hayTrazabilidad && grupo.porcionesAMostrador > 0 && (
        <div className="mt-1 space-y-0.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${pctEnMostrador}%` }}
            />
          </div>
          <div className="text-[9px] text-gray-500">
            {grupo.porcionesAMostrador} mostrador · {grupo.porcionesSaldoCamara} en cámara
          </div>
        </div>
      )}

      {expandido && (
        <div className="mt-1 space-y-1 border-t border-gray-100 pt-1">
          {grupo.detalle.length > 0 && (
            <div>
              <div className="text-[9px] font-medium uppercase text-gray-400">Relleno</div>
              {grupo.detalle.map((d, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-[10px] text-gray-600"
                >
                  <span className="truncate">
                    {d.cantidad != null && (
                      <span className="text-gray-400">×{d.cantidad} </span>
                    )}
                    <span
                      className={cn(
                        'font-medium',
                        d.estado === 'en_mostrador' && 'text-emerald-700',
                        d.estado === 'en_mostrador_parcial' && 'text-emerald-600',
                        d.estado === 'ciclo_completo' && 'text-green-700',
                        d.estado === 'en_bandejas' && 'text-blue-700',
                        d.estado === 'en_produccion' && 'text-amber-700',
                        d.estado === 'pendiente' && 'text-gray-500',
                      )}
                    >
                      {d.estado === 'en_mostrador' && 'en mostrador'}
                      {d.estado === 'en_mostrador_parcial' && 'saliendo al mostrador'}
                      {d.estado === 'ciclo_completo' && 'en cámara'}
                      {d.estado === 'en_bandejas' && 'en bandejas'}
                      {d.estado === 'en_produccion' && 'en producción'}
                      {d.estado === 'pendiente' && 'pendiente'}
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

          {grupo.masasUsadas.length > 0 && (
            <div>
              <div className="text-[9px] font-medium uppercase text-gray-400">Masa usada</div>
              {grupo.masasUsadas.map((m) => (
                <div
                  key={m.loteMasaId}
                  className="flex items-center justify-between text-[10px] text-gray-600"
                >
                  <span className="truncate" title={m.nombre}>
                    🍝 <span className="font-medium">{m.kg} kg</span>{' '}
                    <span className="text-gray-400">{m.nombre}</span>
                  </span>
                  {m.pastasCompartidas > 1 && (
                    <span className="ml-1 text-[9px] text-gray-400">
                      compart. {m.pastasCompartidas}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {grupo.pastasArmadas.length > 0 && (
            <div>
              <div className="text-[9px] font-medium uppercase text-gray-400">
                Pastas armadas
              </div>
              {grupo.pastasArmadas.map((p) => (
                <div
                  key={p.loteId}
                  className="flex items-center justify-between text-[10px] text-gray-600"
                >
                  <span className="truncate" title={p.nombre}>
                    {p.nombre}
                    {p.bandejas > 0 && (
                      <span className="ml-1 text-gray-400">×{p.bandejas} band.</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'ml-1 text-[9px] font-medium',
                      p.ubicacion === 'camara_congelado' ? 'text-emerald-700' : 'text-blue-700',
                    )}
                  >
                    {p.porciones} porc.{' '}
                    {p.ubicacion === 'camara_congelado' ? 'cám.' : 'fresc.'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tieneFlujo && grupo.masasUsadas.length === 0 && grupo.pastasArmadas.length === 0 && (
            <div className="text-[10px] italic text-gray-400">
              Sin masa ni pastas registradas todavía.
            </div>
          )}

          {hayTrazabilidad && (
            <div>
              <div className="text-[9px] font-medium uppercase text-gray-400">Recorrido</div>
              <div className="text-[10px] text-gray-600">
                {grupo.porcionesIniciales} porciones armadas
              </div>
              <div className="text-[10px] text-emerald-700">
                🛒 {grupo.porcionesAMostrador} ya en mostrador
              </div>
              <div className="text-[10px] text-blue-700">
                ❄️ {grupo.porcionesSaldoCamara} todavía en cámara
              </div>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

