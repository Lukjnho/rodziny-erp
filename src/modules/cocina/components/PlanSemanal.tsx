import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { TimelineModal } from './TimelineModal';

type TipoPlan =
  | 'relleno'
  | 'masa'
  | 'salsa'
  | 'postre'
  | 'pasteleria'
  | 'panaderia'
  | 'pasta_simple';
// Estados visibles en el pizarrón. en_mostrador_* viven solo en tab Stock.
type EstadoItem = 'pendiente' | 'en_produccion' | 'en_bandejas' | 'ciclo_completo';

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

const TIPO_LABEL: Record<TipoPlan, string> = {
  relleno: 'Rellenos',
  masa: 'Masas',
  salsa: 'Salsas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  pasta_simple: 'Pastas simples',
};

const TIPO_EMOJI: Record<TipoPlan, string> = {
  relleno: '🥟',
  masa: '🍝',
  salsa: '🍅',
  postre: '🍰',
  pasteleria: '🥐',
  panaderia: '🍞',
  pasta_simple: '🍝',
};

// Tipos a mostrar como categoría en el día. Las masas se omiten porque
// se hacen a demanda (no se planifican) y se ven dentro de la card del
// relleno con el que se usaron.
const TIPOS_VISIBLES: TipoPlan[] = [
  'relleno',
  'pasta_simple',
  'salsa',
  'postre',
  'pasteleria',
  'panaderia',
];

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

function diasDesde(fechaISO: string): number {
  const d = new Date(fechaISO + 'T00:00:00');
  const hoyDate = new Date(hoy() + 'T00:00:00');
  return Math.floor((hoyDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// Lista de etapas que faltan completar según tipo + estado actual.
// Devuelve null si el ciclo está completo.
function calcularFalta(tipo: TipoPlan, estado: EstadoItem, masasCargadas: boolean): string[] | null {
  if (estado === 'ciclo_completo') return null;
  // Tipos sin flujo de pasta: 2 etapas (pendiente → ciclo_completo)
  if (tipo !== 'relleno') {
    return ['cargar lote'];
  }
  // Tipo relleno: flujo enriquecido
  if (estado === 'pendiente') {
    return ['relleno', 'masa', 'armado', 'cámara'];
  }
  if (estado === 'en_produccion') {
    // Si la masa ya está cargada, solo falta armado + cámara.
    return masasCargadas ? ['armado', 'cámara'] : ['masa', 'armado', 'cámara'];
  }
  if (estado === 'en_bandejas') {
    return ['porcionar a cámara'];
  }
  return null;
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
export interface ItemAgrupado {
  key: string;
  tipo: TipoPlan;
  nombre: string;
  recetaId: string | null;
  fechaObjetivo: string;
  totalCantidad: number;
  cuentaPlan: number;
  hechosPlan: number;
  estado: EstadoItem;
  detalle: ItemPlanDetalle[];
  masasUsadas: MasaUsada[]; // solo para relleno
  pastasArmadas: PastaArmada[]; // solo para relleno
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

  const [itemAbierto, setItemAbierto] = useState<ItemAgrupado | null>(null);

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
          fechaObjetivo: fecha,
          totalCantidad: 0,
          cuentaPlan: 0,
          hechosPlan: 0,
          estado: 'pendiente',
          detalle: [],
          masasUsadas: [],
          pastasArmadas: [],
        };
        data.grupos.push(g);
      }
      return g;
    }

    // 1) Items del plan (omitir tipo 'masa', no se planifican).
    //    El pizarrón usa solo los 4 estados de cocina_pizarron_items (pendiente
    //    / en_produccion / en_bandejas / ciclo_completo). Lo que pasa después
    //    en mostrador se ve en tab Stock, no acá.
    for (const it of items ?? []) {
      if (!TIPOS_VISIBLES.includes(it.tipo)) continue;
      const nombre = it.receta?.nombre ?? it.texto_libre ?? '(sin receta)';
      const g = getGrupo(it.fecha_objetivo, it.tipo, nombre, it.receta_id);
      if (!g) continue;
      const estado: EstadoItem = it.estado === 'cancelado' ? 'pendiente' : it.estado;
      g.totalCantidad += Number(it.cantidad_recetas ?? 0);
      g.cuentaPlan += 1;
      if (estado === 'ciclo_completo') {
        g.hechosPlan += 1;
      }
      g.detalle.push({
        cantidad: it.cantidad_recetas,
        estado,
        turno: it.turno,
      });
      if (nivelEstado(estado) > nivelEstado(g.estado)) g.estado = estado;
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
  }, [items, lotesMasa, lotesPasta, fechas, maps]);

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
                                onAbrir={() => setItemAbierto(g)}
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
      {itemAbierto && (
        <TimelineModal grupo={itemAbierto} onClose={() => setItemAbierto(null)} />
      )}
    </div>
  );
}

// ── Card madre compacta: nombre + estado + qué falta. Click abre modal. ─────

function ItemAgrupadoCard({
  grupo,
  onAbrir,
}: {
  grupo: ItemAgrupado;
  onAbrir: () => void;
}) {
  const cantidadLabel = grupo.totalCantidad > 0 ? grupo.totalCantidad : null;
  const masasCargadas = grupo.masasUsadas.length > 0;
  const falta = calcularFalta(grupo.tipo, grupo.estado, masasCargadas);
  const completo = grupo.estado === 'ciclo_completo';

  // Alerta: planificado para hace más de 2 días y todavía sin completar.
  const diasRetraso = diasDesde(grupo.fechaObjetivo);
  const enAlerta = !completo && diasRetraso > 2;

  return (
    <button
      onClick={onAbrir}
      className={cn(
        'block w-full rounded border-l-2 bg-white px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-gray-50 cursor-pointer',
        enAlerta && 'border-red-500 bg-red-50/60 hover:bg-red-50',
        !enAlerta && grupo.estado === 'ciclo_completo' && 'border-green-400',
        !enAlerta && grupo.estado === 'en_bandejas' && 'border-blue-400',
        !enAlerta && grupo.estado === 'en_produccion' && 'border-amber-400',
        !enAlerta && grupo.estado === 'pendiente' && 'border-gray-200',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="flex-1 truncate" title={grupo.nombre}>
          {grupo.nombre}
          {cantidadLabel != null && (
            <span className="ml-1 text-gray-400">
              {grupo.tipo === 'pasta_simple'
                ? `${cantidadLabel} porc.`
                : `×${cantidadLabel}`}
            </span>
          )}
        </span>
      </div>
      <div
        className={cn(
          'mt-0.5 text-[9px] font-semibold uppercase',
          enAlerta && 'text-red-700',
          !enAlerta && grupo.estado === 'ciclo_completo' && 'text-green-700',
          !enAlerta && grupo.estado === 'en_bandejas' && 'text-blue-700',
          !enAlerta && grupo.estado === 'en_produccion' && 'text-amber-700',
          !enAlerta && grupo.estado === 'pendiente' && 'text-gray-500',
        )}
      >
        {enAlerta ? (
          <>⚠ Controlar</>
        ) : (
          <>
            {grupo.estado === 'ciclo_completo' && '✓ En cámara'}
            {grupo.estado === 'en_bandejas' && '🧊 En bandejas'}
            {grupo.estado === 'en_produccion' && '🥣 En producción'}
            {grupo.estado === 'pendiente' && '⏳ Pendiente'}
          </>
        )}
        {grupo.cuentaPlan > 1 && (
          <span className="ml-1 text-[9px] font-normal normal-case text-gray-400">
            · {grupo.hechosPlan}/{grupo.cuentaPlan}
          </span>
        )}
      </div>

      <div className="mt-0.5 text-[10px] text-gray-500">
        {enAlerta ? (
          <span className="text-red-600">Sin avance hace {diasRetraso} días</span>
        ) : completo ? (
          <span className="text-green-700">Disponible para venta</span>
        ) : falta && falta.length > 0 ? (
          <>→ Falta: {falta.join(', ')}</>
        ) : null}
      </div>
    </button>
  );
}

