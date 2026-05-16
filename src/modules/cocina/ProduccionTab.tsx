import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { KPICard } from '@/components/ui/KPICard';
import { StockProduccionSection } from './components/StockProduccionSection';
import { PlanProduccionEditor } from './components/PlanProduccionEditor';
import { PlanSemanal } from './components/PlanSemanal';
import { ResumenSemanalCard } from './components/ResumenSemanalCard';
import { EditarLoteModal } from './components/EditarLoteModal';
import { cn, fmtCantidad } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

// Badge que muestra si un lote tiene ingredientes reales guardados y un popover con el detalle
function IngredientesRealesBadge({ ingredientes }: { ingredientes: IngredienteRealRow[] | null }) {
  const [abierto, setAbierto] = useState(false);
  if (!ingredientes || ingredientes.length === 0) {
    return <span className="text-[10px] text-gray-300">—</span>;
  }
  const ajustados = ingredientes.filter(
    (i) => Math.abs(i.cantidad_real - i.cantidad_receta) > 0.001,
  );
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setAbierto((v) => !v)}
        className={
          'rounded-full px-2 py-0.5 text-[10px] ' +
          (ajustados.length > 0
            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
        }
      >
        {ajustados.length > 0
          ? `${ajustados.length} ajustado${ajustados.length > 1 ? 's' : ''}`
          : `${ingredientes.length} ok`}
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAbierto(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-gray-200 bg-white p-2 text-xs shadow-lg">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="font-semibold text-gray-700">Ingredientes reales</span>
              <button
                onClick={() => setAbierto(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {ingredientes.map((i, idx) => {
                const diff = i.cantidad_real - i.cantidad_receta;
                const pct = i.cantidad_receta > 0 ? (diff / i.cantidad_receta) * 100 : 0;
                const ajustado = Math.abs(diff) > 0.001;
                return (
                  <div
                    key={idx}
                    className={
                      'flex items-center justify-between px-1 py-0.5 ' +
                      (ajustado ? 'text-amber-700' : 'text-gray-600')
                    }
                  >
                    <span className="flex-1 truncate">{i.nombre}</span>
                    <span className="ml-2 tabular-nums">
                      {i.cantidad_real} {i.unidad}
                      {ajustado && (
                        <span className="ml-1 text-[10px] text-gray-400">
                          ({i.cantidad_receta} · {pct >= 0 ? '+' : ''}
                          {Math.round(pct)}%)
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Producto {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  local: string;
}
interface Receta {
  id: string;
  nombre: string;
  tipo: string;
  rendimiento_kg: number | null;
  rendimiento_unidad: 'kg' | 'l' | 'unidad' | null;
  local: string | null;
}
interface IngredienteRealRow {
  ing_id: string;
  nombre: string;
  cantidad_receta: number;
  cantidad_real: number;
  unidad: string;
  producto_id: string | null;
}

interface LoteRelleno {
  id: string;
  receta_id: string;
  fecha: string;
  cantidad_recetas: number;
  peso_total_kg: number;
  responsable: string | null;
  local: string;
  notas: string | null;
  created_at: string;
  ingredientes_reales: IngredienteRealRow[] | null;
  receta?: { nombre: string } | null;
  consumido_kg?: number;
  disponible_kg?: number;
}
interface LotePasta {
  id: string;
  producto_id: string;
  lote_relleno_id: string | null;
  lote_masa_id: string | null;
  fecha: string;
  codigo_lote: string;
  receta_masa_id: string | null;
  masa_kg: number | null;
  relleno_kg: number | null;
  porciones: number | null;
  responsable: string | null;
  local: string;
  notas: string | null;
  created_at: string;
  ubicacion: 'freezer_produccion' | 'camara_congelado';
  cantidad_cajones: number | null;
  fecha_porcionado: string | null;
  responsable_porcionado: string | null;
  merma_porcionado: number;
  sobrante_gramos: number | null;
  producto?: { nombre: string; codigo: string } | null;
  lote_relleno?: { receta?: { nombre: string } | null; peso_total_kg: number } | null;
  receta_masa?: { nombre: string } | null;
}

interface LoteMasa {
  id: string;
  receta_id: string | null;
  fecha: string;
  kg_producidos: number;
  kg_sobrante: number | null;
  destino_sobrante: string | null;
  responsable: string | null;
  local: string;
  notas: string | null;
  created_at: string;
  ingredientes_reales: IngredienteRealRow[] | null;
  receta?: { nombre: string } | null;
  consumido_kg?: number;
  disponible_kg?: number;
}

interface LoteProduccion {
  id: string;
  fecha: string;
  local: string;
  categoria: 'salsa' | 'postre' | 'pasteleria' | 'panaderia' | 'prueba';
  receta_id: string | null;
  nombre_libre: string | null;
  cantidad_producida: number;
  unidad: 'kg' | 'unid' | 'lt';
  merma_cantidad: number | null;
  merma_motivo: string | null;
  responsable: string | null;
  notas: string | null;
  created_at: string;
  ingredientes_reales: IngredienteRealRow[] | null;
  receta?: { nombre: string } | null;
}

type TipoLote = 'relleno' | 'masa' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia' | 'prueba';

const TIPO_LOTE_ORDEN: TipoLote[] = [
  'relleno',
  'masa',
  'salsa',
  'postre',
  'pasteleria',
  'panaderia',
  'prueba',
];

const TIPO_LOTE_LABEL: Record<TipoLote, string> = {
  relleno: 'Rellenos',
  masa: 'Masas',
  salsa: 'Salsas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  prueba: 'Pruebas',
};

const TIPO_LOTE_COLOR: Record<TipoLote, string> = {
  relleno: 'bg-green-100 text-green-700',
  masa: 'bg-amber-100 text-amber-700',
  salsa: 'bg-orange-100 text-orange-700',
  postre: 'bg-pink-100 text-pink-700',
  pasteleria: 'bg-rose-100 text-rose-700',
  panaderia: 'bg-yellow-100 text-yellow-700',
  prueba: 'bg-purple-100 text-purple-700',
};

interface LoteUnificado {
  id: string;
  tipo: TipoLote;
  tabla: 'cocina_lotes_relleno' | 'cocina_lotes_masa' | 'cocina_lotes_produccion';
  nombre: string;
  cantidadStr: string;
  detalleExtra: string | null;
  local: string;
  responsable: string | null;
  hora: string;
  notas: string | null;
  ingredientes: IngredienteRealRow[] | null;
  masaRow?: LoteMasa;
}

// ── Tipos para vista semanal ───────────────────────────────────────────────────

type TipoLoteSemanal = TipoLote | 'pasta';

interface LoteDetalleSemana {
  id: string;
  tabla: 'cocina_lotes_relleno' | 'cocina_lotes_masa' | 'cocina_lotes_produccion' | 'cocina_lotes_pasta';
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:mm
  local: string;
  responsable: string | null;
  cantidadStr: string;
  detalleExtra: string | null;
  notas: string | null;
  ingredientes: IngredienteRealRow[] | null;
  pastaRow?: LotePasta;
  masaRow?: LoteMasa;
}

interface LoteSemanalGrupo {
  tipo: TipoLoteSemanal;
  nombre: string;
  lotes: LoteDetalleSemana[];
  lotesCount: number;
  recetasTotal: number;
  kgTotal: number;
  unidadesTotal: number;
  ltTotal: number;
  porcionesTotal: number;
}

const TIPO_LOTE_SEMANAL_ORDEN: TipoLoteSemanal[] = [
  'pasta',
  'relleno',
  'masa',
  'salsa',
  'postre',
  'pasteleria',
  'panaderia',
  'prueba',
];

const TIPO_LOTE_SEMANAL_LABEL: Record<TipoLoteSemanal, string> = {
  ...TIPO_LOTE_LABEL,
  pasta: 'Pastas',
};

const TIPO_LOTE_SEMANAL_COLOR: Record<TipoLoteSemanal, string> = {
  ...TIPO_LOTE_COLOR,
  pasta: 'bg-blue-100 text-blue-700',
};

type FiltroLocal = 'todos' | 'vedia' | 'saavedra';
type VistaLotes = 'dia' | 'semana';

function matchLocal(itemLocal: string | null, filtro: string): boolean {
  if (filtro === 'todos' || !itemLocal) return true;
  return itemLocal === filtro;
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function formatDDMM(fecha: string) {
  const [, m, d] = fecha.split('-');
  return `${d}${m}`;
}

// Lunes a domingo calendario de la fecha activa. Si la fecha cae domingo, devuelve la semana
// que TERMINA ese domingo (no la siguiente que arranca el lunes posterior).
function rangoSemana(fechaIso: string): { desde: string; hasta: string } {
  const d = new Date(fechaIso + 'T12:00:00');
  const dow = d.getDay(); // 0=dom, 1=lun, ..., 6=sab
  const offsetLunes = dow === 0 ? -6 : 1 - dow;
  const lun = new Date(d);
  lun.setDate(d.getDate() + offsetLunes);
  const dom = new Date(lun);
  dom.setDate(lun.getDate() + 6);
  return {
    desde: lun.toISOString().slice(0, 10),
    hasta: dom.toISOString().slice(0, 10),
  };
}

function formatRangoLabel(desde: string, hasta: string): string {
  const [, mD, dD] = desde.split('-');
  const [, mH, dH] = hasta.split('-');
  return `${dD}/${mD} al ${dH}/${mH}`;
}

const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function diaCorto(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00');
  return DIA_CORTO[d.getDay()];
}

// ── Componente principal ──────────────────────────────────────────────────────

export function ProduccionTab() {
  const { perfil } = useAuth();
  const localRestringido = perfil?.local_restringido ?? null;
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(hoy());
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>(localRestringido ?? 'todos');
  useEffect(() => {
    if (localRestringido && filtroLocal !== localRestringido) setFiltroLocal(localRestringido);
  }, [localRestringido, filtroLocal]);
  const [filtroPastaEstado, setFiltroPastaEstado] = useState<'todos' | 'fresco' | 'camara'>(
    'todos',
  );
  const [filtroTipoLote, setFiltroTipoLote] = useState<'todos' | TipoLote>('todos');
  const [filtroTipoSemanal, setFiltroTipoSemanal] = useState<'todos' | TipoLoteSemanal>('todos');
  const [vistaLotes, setVistaLotes] = useState<VistaLotes>(() => {
    if (typeof window === 'undefined') return 'dia';
    const guardado = localStorage.getItem('cocina-vista-lotes');
    return guardado === 'semana' ? 'semana' : 'dia';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('cocina-vista-lotes', vistaLotes);
  }, [vistaLotes]);
  const semana = useMemo(() => rangoSemana(fecha), [fecha]);

  // Modales
  const [modalCerrarMasa, setModalCerrarMasa] = useState<LoteMasa | null>(null);
  const [modalPorcionar, setModalPorcionar] = useState<LotePasta | null>(null);
  const [editorPlan, setEditorPlan] = useState<{
    local: 'vedia' | 'saavedra';
    semanaRef: string;
  } | null>(null);
  const [modalEditarLote, setModalEditarLote] = useState<{
    id: string;
    tabla:
      | 'cocina_lotes_relleno'
      | 'cocina_lotes_masa'
      | 'cocina_lotes_produccion'
      | 'cocina_lotes_pasta';
    nombre: string;
  } | null>(null);

  // Catálogos
  const { data: productos } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, tipo, local')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as Producto[];
    },
  });

  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, rendimiento_kg, rendimiento_unidad, local')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as Receta[];
    },
  });

  // Lotes del día
  const { data: lotesRelleno, isLoading: cargandoR } = useQuery({
    queryKey: ['cocina-lotes-relleno', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_relleno')
        .select('*, receta:cocina_recetas(nombre)')
        .eq('fecha', fecha)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as LoteRelleno[];
    },
  });

  const { data: lotesMasa, isLoading: cargandoM } = useQuery({
    queryKey: ['cocina-lotes-masa', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_masa')
        .select('*, receta:cocina_recetas(nombre)')
        .eq('fecha', fecha)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as LoteMasa[];
    },
  });

  const { data: lotesPasta, isLoading: cargandoP } = useQuery({
    queryKey: ['cocina-lotes-pasta', fecha],
    queryFn: async () => {
      // Traemos lotes que ARMARON ese día O que PORCIONARON ese día.
      // Así un lote armado ayer y porcionado hoy aparece en ambos días, con su info de ciclo completo.
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select(
          '*, producto:cocina_productos(nombre, codigo), lote_relleno:cocina_lotes_relleno(peso_total_kg, receta:cocina_recetas(nombre)), receta_masa:cocina_recetas(nombre)',
        )
        .or(`fecha.eq.${fecha},fecha_porcionado.eq.${fecha}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as LotePasta[];
    },
  });

  // Lotes frescos pendientes de porcionar (cualquier fecha) — para acción desde el admin
  const { data: lotesFrescosPendientes } = useQuery({
    queryKey: ['cocina-lotes-pasta-frescos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('*, producto:cocina_productos(nombre, codigo)')
        .eq('ubicacion', 'freezer_produccion')
        .order('fecha', { ascending: true });
      if (error) throw error;
      return data as LotePasta[];
    },
  });

  const { data: lotesProduccion, isLoading: cargandoProd } = useQuery({
    queryKey: ['cocina-lotes-produccion', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('*, receta:cocina_recetas(nombre)')
        .eq('fecha', fecha)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as LoteProduccion[];
    },
  });

  // ── Queries semanales (solo se ejecutan cuando la vista es 'semana') ────────
  const semanaEnabled = vistaLotes === 'semana';

  const { data: lotesRellenoSemana, isLoading: cargandoRSemana } = useQuery({
    queryKey: ['cocina-lotes-relleno-semana', semana.desde, semana.hasta],
    enabled: semanaEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_relleno')
        .select('*, receta:cocina_recetas(nombre)')
        .gte('fecha', semana.desde)
        .lte('fecha', semana.hasta)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as LoteRelleno[];
    },
  });

  const { data: lotesMasaSemana, isLoading: cargandoMSemana } = useQuery({
    queryKey: ['cocina-lotes-masa-semana', semana.desde, semana.hasta],
    enabled: semanaEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_masa')
        .select('*, receta:cocina_recetas(nombre)')
        .gte('fecha', semana.desde)
        .lte('fecha', semana.hasta)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as LoteMasa[];
    },
  });

  const { data: lotesProduccionSemana, isLoading: cargandoProdSemana } = useQuery({
    queryKey: ['cocina-lotes-produccion-semana', semana.desde, semana.hasta],
    enabled: semanaEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('*, receta:cocina_recetas(nombre)')
        .gte('fecha', semana.desde)
        .lte('fecha', semana.hasta)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as LoteProduccion[];
    },
  });

  // Lotes de pasta ARMADOS en la semana (para contar lotes/recetas).
  const { data: lotesPastaSemana, isLoading: cargandoPSemana } = useQuery({
    queryKey: ['cocina-lotes-pasta-semana', semana.desde, semana.hasta],
    enabled: semanaEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select(
          '*, producto:cocina_productos(nombre, codigo), lote_relleno:cocina_lotes_relleno(peso_total_kg, receta:cocina_recetas(nombre)), receta_masa:cocina_recetas(nombre)',
        )
        .gte('fecha', semana.desde)
        .lte('fecha', semana.hasta)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as LotePasta[];
    },
  });

  // Lotes de pasta PORCIONADOS en la semana — fuente única de "porciones por relleno".
  // Puede solapar con lotesPastaSemana (armado y porcionado en la misma semana) pero
  // también incluir lotes armados en semanas previas que se porcionaron esta semana.
  const { data: lotesPastaPorcionadosSemana, isLoading: cargandoPPSemana } = useQuery({
    queryKey: ['cocina-lotes-pasta-porcionados-semana', semana.desde, semana.hasta],
    enabled: semanaEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select(
          '*, producto:cocina_productos(nombre, codigo), lote_relleno:cocina_lotes_relleno(peso_total_kg, receta:cocina_recetas(nombre)), receta_masa:cocina_recetas(nombre)',
        )
        .gte('fecha_porcionado', semana.desde)
        .lte('fecha_porcionado', semana.hasta)
        .not('porciones', 'is', null);
      if (error) throw error;
      return data as LotePasta[];
    },
  });

  // Cálculo de consumo de masa: sumar cuánto se usó de cada lote tomando las
  // pastas armadas del día. Sirve para mostrar disponible vs usado en la tabla.
  const consumoPorMasaAdm = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of lotesPasta ?? []) {
      if (p.lote_masa_id && p.masa_kg) {
        m.set(p.lote_masa_id, (m.get(p.lote_masa_id) ?? 0) + p.masa_kg);
      }
    }
    return m;
  }, [lotesPasta]);

  // Filtrar por local
  const pastasFiltradas = useMemo(() => {
    let lista = lotesPasta ?? [];
    if (filtroLocal !== 'todos') lista = lista.filter((l) => l.local === filtroLocal);
    if (filtroPastaEstado === 'fresco')
      lista = lista.filter((l) => l.ubicacion === 'freezer_produccion');
    else if (filtroPastaEstado === 'camara')
      lista = lista.filter((l) => l.ubicacion === 'camara_congelado');
    return lista;
  }, [lotesPasta, filtroLocal, filtroPastaEstado]);

  const kpiPasta = useMemo(
    () => ({
      lotes: pastasFiltradas.length,
      porcionesTotal: pastasFiltradas.reduce((s, l) => s + (l.porciones ?? 0), 0),
      tiposDistintos: new Set(pastasFiltradas.map((l) => l.producto_id)).size,
    }),
    [pastasFiltradas],
  );

  // Vista unificada de lotes (relleno + masa + producción adicional). La pasta queda
  // aparte porque tiene ciclo propio (armado→porcionado→cámara). Mantiene datos
  // específicos por tipo en `detalleExtra` y deja la masa pendiente de cerrar
  // accesible para abrir el modal correspondiente.
  const lotesUnificados = useMemo<LoteUnificado[]>(() => {
    const fmtHora = (iso: string | null | undefined) => {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    };
    const fmtUnidad = (u: string | null | undefined) =>
      u === 'l' || u === 'lt' ? 'L' : u === 'unidad' || u === 'unid' ? 'unid' : 'kg';

    const out: LoteUnificado[] = [];

    for (const l of lotesRelleno ?? []) {
      const detalle = l.cantidad_recetas > 1 ? `${l.cantidad_recetas} recetas` : null;
      out.push({
        id: l.id,
        tipo: 'relleno',
        tabla: 'cocina_lotes_relleno',
        nombre: l.receta?.nombre ?? '—',
        cantidadStr: `${fmtCantidad(l.peso_total_kg)} kg`,
        detalleExtra: detalle,
        local: l.local,
        responsable: l.responsable,
        hora: fmtHora(l.created_at),
        notas: l.notas,
        ingredientes: l.ingredientes_reales,
      });
    }

    for (const l of lotesMasa ?? []) {
      const usado = consumoPorMasaAdm.get(l.id) ?? 0;
      const disp = Math.max(0, +(l.kg_producidos - usado).toFixed(3));
      const partes: string[] = [];
      if (l.kg_sobrante == null) {
        partes.push(`${fmtCantidad(disp)} kg disp · ${fmtCantidad(usado)} kg usados`);
      } else {
        const destino =
          l.destino_sobrante === 'fideos'
            ? 'fideos (reutilizar)'
            : l.destino_sobrante === 'merma'
              ? 'merma (descartar)'
              : 'próxima masa';
        partes.push(`Sobrante ${fmtCantidad(l.kg_sobrante)} kg → ${destino}`);
      }
      out.push({
        id: l.id,
        tipo: 'masa',
        tabla: 'cocina_lotes_masa',
        nombre: l.receta?.nombre ?? '—',
        cantidadStr: `${fmtCantidad(l.kg_producidos)} kg`,
        detalleExtra: partes.join(' · '),
        local: l.local,
        responsable: l.responsable,
        hora: fmtHora(l.created_at),
        notas: l.notas,
        ingredientes: l.ingredientes_reales,
        masaRow: l,
      });
    }

    for (const l of lotesProduccion ?? []) {
      const u = fmtUnidad(l.unidad);
      const esEntero = l.unidad === 'unid';
      const merma =
        l.merma_cantidad && l.merma_cantidad > 0
          ? `Merma ${fmtCantidad(l.merma_cantidad, esEntero ? 0 : 2)} ${u}${l.merma_motivo ? ` · ${l.merma_motivo}` : ''}`
          : null;
      out.push({
        id: l.id,
        tipo: l.categoria,
        tabla: 'cocina_lotes_produccion',
        nombre: l.receta?.nombre ?? l.nombre_libre ?? '—',
        cantidadStr: `${fmtCantidad(l.cantidad_producida, esEntero ? 0 : 2)} ${u}`,
        detalleExtra: merma,
        local: l.local,
        responsable: l.responsable,
        hora: fmtHora(l.created_at),
        notas: l.notas,
        ingredientes: l.ingredientes_reales,
      });
    }

    out.sort((a, b) => (a.hora < b.hora ? 1 : a.hora > b.hora ? -1 : 0));
    return out;
  }, [lotesRelleno, lotesMasa, lotesProduccion, consumoPorMasaAdm]);

  const lotesUnificadosFiltrados = useMemo(() => {
    return lotesUnificados.filter((l) => {
      if (filtroLocal !== 'todos' && l.local !== filtroLocal) return false;
      if (filtroTipoLote !== 'todos' && l.tipo !== filtroTipoLote) return false;
      return true;
    });
  }, [lotesUnificados, filtroLocal, filtroTipoLote]);

  const conteoPorTipo = useMemo(() => {
    const base = lotesUnificados.filter(
      (l) => filtroLocal === 'todos' || l.local === filtroLocal,
    );
    const m: Record<TipoLote, number> = {
      relleno: 0,
      masa: 0,
      salsa: 0,
      postre: 0,
      pasteleria: 0,
      panaderia: 0,
      prueba: 0,
    };
    for (const l of base) m[l.tipo]++;
    return { total: base.length, porTipo: m };
  }, [lotesUnificados, filtroLocal]);

  // ── Agrupamiento semanal: una fila por (tipo, nombre) ───────────────────────
  // Suma kg/recetas/lotes desde lotes_relleno/masa/produccion/pasta de la semana.
  // Las porciones del relleno SOLO se cuentan desde lotes_pasta porcionados en la
  // semana (única fuente de verdad), agrupadas por nombre de receta de relleno.
  const lotesSemanalesAgrupados = useMemo<LoteSemanalGrupo[]>(() => {
    if (vistaLotes !== 'semana') return [];

    const fmtHora = (iso: string | null | undefined) => {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    };
    const fmtUnidad = (u: string | null | undefined) =>
      u === 'l' || u === 'lt' ? 'L' : u === 'unidad' || u === 'unid' ? 'unid' : 'kg';

    const gruposMap = new Map<string, LoteSemanalGrupo>();
    const getGrupo = (tipo: TipoLoteSemanal, nombre: string): LoteSemanalGrupo => {
      const key = `${tipo}::${nombre}`;
      let g = gruposMap.get(key);
      if (!g) {
        g = {
          tipo,
          nombre,
          lotes: [],
          lotesCount: 0,
          recetasTotal: 0,
          kgTotal: 0,
          unidadesTotal: 0,
          ltTotal: 0,
          porcionesTotal: 0,
        };
        gruposMap.set(key, g);
      }
      return g;
    };

    // Rellenos
    for (const l of lotesRellenoSemana ?? []) {
      if (!matchLocal(l.local, filtroLocal)) continue;
      const nombre = l.receta?.nombre ?? 'Sin nombre';
      const g = getGrupo('relleno', nombre);
      g.lotesCount++;
      g.recetasTotal += l.cantidad_recetas ?? 0;
      g.kgTotal += l.peso_total_kg ?? 0;
      const cantPartes: string[] = [`${fmtCantidad(l.peso_total_kg)} kg`];
      if (l.cantidad_recetas > 1) cantPartes.push(`${l.cantidad_recetas} recetas`);
      g.lotes.push({
        id: l.id,
        tabla: 'cocina_lotes_relleno',
        fecha: l.fecha,
        hora: fmtHora(l.created_at),
        local: l.local,
        responsable: l.responsable,
        cantidadStr: cantPartes.join(' · '),
        detalleExtra: null,
        notas: l.notas,
        ingredientes: l.ingredientes_reales,
      });
    }

    // Masas
    for (const l of lotesMasaSemana ?? []) {
      if (!matchLocal(l.local, filtroLocal)) continue;
      const nombre = l.receta?.nombre ?? 'Sin nombre';
      const g = getGrupo('masa', nombre);
      g.lotesCount++;
      g.kgTotal += l.kg_producidos ?? 0;
      const detalle =
        l.kg_sobrante == null
          ? 'pendiente cerrar'
          : `sobrante ${fmtCantidad(l.kg_sobrante)}kg → ${l.destino_sobrante ?? 'fideos'}`;
      g.lotes.push({
        id: l.id,
        tabla: 'cocina_lotes_masa',
        fecha: l.fecha,
        hora: fmtHora(l.created_at),
        local: l.local,
        responsable: l.responsable,
        cantidadStr: `${fmtCantidad(l.kg_producidos)} kg`,
        detalleExtra: detalle,
        notas: l.notas,
        ingredientes: l.ingredientes_reales,
        masaRow: l,
      });
    }

    // Producción (salsa/postre/pasteleria/panaderia/prueba)
    for (const l of lotesProduccionSemana ?? []) {
      if (!matchLocal(l.local, filtroLocal)) continue;
      const nombre = l.receta?.nombre ?? l.nombre_libre ?? 'Sin nombre';
      const g = getGrupo(l.categoria as TipoLoteSemanal, nombre);
      g.lotesCount++;
      const u = fmtUnidad(l.unidad);
      if (u === 'kg') g.kgTotal += l.cantidad_producida ?? 0;
      else if (u === 'unid') g.unidadesTotal += l.cantidad_producida ?? 0;
      else g.ltTotal += l.cantidad_producida ?? 0;
      const esEntero = l.unidad === 'unid';
      const merma =
        l.merma_cantidad && l.merma_cantidad > 0
          ? `merma ${fmtCantidad(l.merma_cantidad, esEntero ? 0 : 2)} ${u}`
          : null;
      g.lotes.push({
        id: l.id,
        tabla: 'cocina_lotes_produccion',
        fecha: l.fecha,
        hora: fmtHora(l.created_at),
        local: l.local,
        responsable: l.responsable,
        cantidadStr: `${fmtCantidad(l.cantidad_producida, esEntero ? 0 : 2)} ${u}`,
        detalleExtra: merma,
        notas: l.notas,
        ingredientes: l.ingredientes_reales,
      });
    }

    // Pastas: unión de armadas en la semana + porcionadas en la semana (dedup por id)
    const pastasUnidas = new Map<string, LotePasta>();
    for (const l of lotesPastaSemana ?? []) pastasUnidas.set(l.id, l);
    for (const l of lotesPastaPorcionadosSemana ?? []) {
      if (!pastasUnidas.has(l.id)) pastasUnidas.set(l.id, l);
    }
    for (const l of pastasUnidas.values()) {
      if (!matchLocal(l.local, filtroLocal)) continue;
      const nombre = l.producto?.nombre ?? 'Pasta';
      const g = getGrupo('pasta', nombre);
      g.lotesCount++;
      const porcionadoEnSemana =
        l.fecha_porcionado != null &&
        l.fecha_porcionado >= semana.desde &&
        l.fecha_porcionado <= semana.hasta;
      if (porcionadoEnSemana && l.porciones != null) g.porcionesTotal += l.porciones;
      const detallePartes: string[] = [];
      if (l.codigo_lote) detallePartes.push(`lote ${l.codigo_lote}`);
      if (l.lote_relleno?.receta?.nombre) detallePartes.push(`relleno: ${l.lote_relleno.receta.nombre}`);
      if (l.receta_masa?.nombre) detallePartes.push(`masa: ${l.receta_masa.nombre}`);
      if (l.cantidad_cajones) detallePartes.push(`${l.cantidad_cajones} band.`);
      if (l.ubicacion === 'freezer_produccion') detallePartes.push('⏳ fresco');
      g.lotes.push({
        id: l.id,
        tabla: 'cocina_lotes_pasta',
        fecha: l.fecha,
        hora: fmtHora(l.created_at),
        local: l.local,
        responsable: l.responsable,
        cantidadStr: l.porciones != null ? `${l.porciones} porc.` : 'pendiente porcionar',
        detalleExtra: detallePartes.length > 0 ? detallePartes.join(' · ') : null,
        notas: l.notas,
        ingredientes: null,
        pastaRow: l,
      });
    }

    // Porciones por nombre de relleno (única fuente: lote_pasta porcionados en la semana)
    for (const l of lotesPastaPorcionadosSemana ?? []) {
      if (!matchLocal(l.local, filtroLocal)) continue;
      const nombreRelleno = l.lote_relleno?.receta?.nombre;
      if (!nombreRelleno) continue;
      const g = getGrupo('relleno', nombreRelleno);
      g.porcionesTotal += l.porciones ?? 0;
    }

    // Ordenar lotes dentro de cada grupo por fecha+hora descendente
    for (const g of gruposMap.values()) {
      g.lotes.sort((a, b) => {
        if (a.fecha !== b.fecha) return a.fecha > b.fecha ? -1 : 1;
        return a.hora < b.hora ? 1 : a.hora > b.hora ? -1 : 0;
      });
    }

    const ordenTipo: Record<TipoLoteSemanal, number> = {
      pasta: 0,
      relleno: 1,
      masa: 2,
      salsa: 3,
      postre: 4,
      pasteleria: 5,
      panaderia: 6,
      prueba: 7,
    };
    return Array.from(gruposMap.values()).sort((a, b) => {
      if (a.tipo !== b.tipo) return ordenTipo[a.tipo] - ordenTipo[b.tipo];
      return a.nombre.localeCompare(b.nombre);
    });
  }, [
    vistaLotes,
    filtroLocal,
    semana.desde,
    semana.hasta,
    lotesRellenoSemana,
    lotesMasaSemana,
    lotesProduccionSemana,
    lotesPastaSemana,
    lotesPastaPorcionadosSemana,
  ]);

  const conteoSemanalPorTipo = useMemo(() => {
    const m: Record<TipoLoteSemanal, number> = {
      pasta: 0,
      relleno: 0,
      masa: 0,
      salsa: 0,
      postre: 0,
      pasteleria: 0,
      panaderia: 0,
      prueba: 0,
    };
    for (const g of lotesSemanalesAgrupados) m[g.tipo] += g.lotesCount;
    const total = lotesSemanalesAgrupados.reduce((s, g) => s + g.lotesCount, 0);
    return { total, porTipo: m };
  }, [lotesSemanalesAgrupados]);

  const cargandoSemana =
    cargandoRSemana ||
    cargandoMSemana ||
    cargandoProdSemana ||
    cargandoPSemana ||
    cargandoPPSemana;

  // Frescos pendientes de OTRAS fechas (las del día seleccionado ya aparecen en la tabla principal).
  // Solo se muestran acá para no perder de vista bandejas armadas días anteriores que siguen en freezer.
  const frescosFiltrados = useMemo(() => {
    let lista = (lotesFrescosPendientes ?? []).filter((l) => l.fecha !== fecha);
    if (filtroLocal !== 'todos') lista = lista.filter((l) => l.local === filtroLocal);
    return lista;
  }, [lotesFrescosPendientes, filtroLocal, fecha]);

  // KPI de frescos: cuenta TODOS los pendientes del local (incluyendo el día seleccionado).
  const frescosKpiCount = useMemo(() => {
    const lista = lotesFrescosPendientes ?? [];
    if (filtroLocal === 'todos') return lista.length;
    return lista.filter((l) => l.local === filtroLocal).length;
  }, [lotesFrescosPendientes, filtroLocal]);

  // Navegación de fecha
  const cambiarFecha = (delta: number) => {
    const d = new Date(fecha + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setFecha(d.toISOString().slice(0, 10));
  };

  // Eliminar
  const eliminarRelleno = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_lotes_relleno').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-lotes-relleno', fecha] }),
  });

  const eliminarMasa = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_lotes_masa').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-lotes-masa', fecha] }),
  });

  const eliminarPasta = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_lotes_pasta').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta', fecha] });
      qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta-frescos'] });
      qc.invalidateQueries({ queryKey: ['cocina-stock'] });
    },
  });

  const eliminarProduccion = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_lotes_produccion').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-lotes-produccion', fecha] }),
  });

  const fechaLabel = new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-white p-3">
        <button
          onClick={() => cambiarFecha(-1)}
          className="rounded px-2 py-1 text-lg hover:bg-gray-100"
        >
          ‹
        </button>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => cambiarFecha(1)}
          className="rounded px-2 py-1 text-lg hover:bg-gray-100"
        >
          ›
        </button>
        <span className="text-sm capitalize text-gray-500">{fechaLabel}</span>
        {fecha !== hoy() && (
          <button
            onClick={() => setFecha(hoy())}
            className="text-xs text-rodziny-700 hover:underline"
          >
            Hoy
          </button>
        )}
        {!localRestringido && (
          <select
            value={filtroLocal}
            onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
            className="ml-auto rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="todos">Todos los locales</option>
            <option value="vedia">Vedia</option>
            <option value="saavedra">Saavedra</option>
          </select>
        )}
      </div>

      {/* ── Sección: Plan semanal ─────────────────────────────────────────────
          Vista lunes-domingo de la semana de la fecha seleccionada. Muestra el
          plan del chef, completados (cliclo completo), pendientes (a terminar),
          lotes registrados sin estar planeados (fuera del plan) y pastas armadas. */}
      <div className="space-y-3">
        {(filtroLocal === 'todos' || filtroLocal === 'vedia') && (
          <>
            <PlanSemanal
              fechaActiva={fecha}
              local="vedia"
              onAbrirEditor={() => setEditorPlan({ local: 'vedia', semanaRef: fecha })}
            />
            <ResumenSemanalCard local="vedia" fechaReferencia={fecha} />
          </>
        )}
        {(filtroLocal === 'todos' || filtroLocal === 'saavedra') && (
          <>
            <PlanSemanal
              fechaActiva={fecha}
              local="saavedra"
              onAbrirEditor={() => setEditorPlan({ local: 'saavedra', semanaRef: fecha })}
            />
            <ResumenSemanalCard local="saavedra" fechaReferencia={fecha} />
          </>
        )}
      </div>

      {/* ── Sección: Lotes registrados (toggle Día / Semana) ──────────────────── */}
      <div>
        <div className="mb-3 flex justify-end">
          <div className="inline-flex overflow-hidden rounded-md border border-gray-200">
            <button
              onClick={() => setVistaLotes('dia')}
              className={cn(
                'px-3 py-1 text-xs font-medium transition-colors',
                vistaLotes === 'dia'
                  ? 'bg-rodziny-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              Día
            </button>
            <button
              onClick={() => setVistaLotes('semana')}
              className={cn(
                'border-l border-gray-200 px-3 py-1 text-xs font-medium transition-colors',
                vistaLotes === 'semana'
                  ? 'bg-rodziny-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              Semana
            </button>
          </div>
        </div>
        {vistaLotes === 'dia' ? (
          <LotesRegistradosSection
            lotes={lotesUnificadosFiltrados}
            conteo={conteoPorTipo}
            fechaLabel={fechaLabel}
            fecha={fecha}
            filtroLocal={filtroLocal}
            filtroTipoLote={filtroTipoLote}
            setFiltroTipoLote={setFiltroTipoLote}
            cargando={cargandoR || cargandoM || cargandoProd}
            onCerrarMasa={(m) => setModalCerrarMasa(m)}
            onEditar={(l) =>
              setModalEditarLote({ id: l.id, tabla: l.tabla, nombre: l.nombre })
            }
            onEliminar={(l) => {
              if (!window.confirm('¿Eliminar este lote?')) return;
              if (l.tabla === 'cocina_lotes_relleno') eliminarRelleno.mutate(l.id);
              else if (l.tabla === 'cocina_lotes_masa') eliminarMasa.mutate(l.id);
              else eliminarProduccion.mutate(l.id);
            }}
          />
        ) : (
          <LotesSemanalesSection
            grupos={lotesSemanalesAgrupados}
            conteo={conteoSemanalPorTipo}
            semana={semana}
            filtroLocal={filtroLocal}
            filtroTipoSemanal={filtroTipoSemanal}
            setFiltroTipoSemanal={setFiltroTipoSemanal}
            cargando={cargandoSemana}
            onCerrarMasa={(m) => setModalCerrarMasa(m)}
            onPorcionarPasta={(p) => setModalPorcionar(p)}
            onEditar={(l, nombre) =>
              setModalEditarLote({ id: l.id, tabla: l.tabla, nombre })
            }
            onEliminar={(l) => {
              if (!window.confirm('¿Eliminar este lote?')) return;
              if (l.tabla === 'cocina_lotes_relleno') eliminarRelleno.mutate(l.id);
              else if (l.tabla === 'cocina_lotes_masa') eliminarMasa.mutate(l.id);
              else if (l.tabla === 'cocina_lotes_pasta') eliminarPasta.mutate(l.id);
              else eliminarProduccion.mutate(l.id);
            }}
          />
        )}
      </div>


      {/* ── Sección: Pastas del día ──────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">Pastas del día</h3>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPICard
            label="Lotes de pasta"
            value={String(kpiPasta.lotes)}
            color="green"
            loading={cargandoP}
          />
          <KPICard
            label="Total porciones"
            value={String(kpiPasta.porcionesTotal)}
            color="blue"
            loading={cargandoP}
          />
          <KPICard
            label="Tipos distintos"
            value={String(kpiPasta.tiposDistintos)}
            color="neutral"
            loading={cargandoP}
          />
          <KPICard
            label="Frescos por porcionar"
            value={String(frescosKpiCount)}
            color={frescosKpiCount > 0 ? 'yellow' : 'neutral'}
            loading={cargandoP}
            active={filtroPastaEstado === 'fresco'}
            onClick={() =>
              setFiltroPastaEstado(filtroPastaEstado === 'fresco' ? 'todos' : 'fresco')
            }
          />
        </div>

        {frescosFiltrados.length > 0 && (
          <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="mb-2 text-sm font-medium text-blue-900">
              {frescosFiltrados.length} bandeja{frescosFiltrados.length > 1 ? 's' : ''} pendiente
              {frescosFiltrados.length > 1 ? 's' : ''} de porcionar (otras fechas)
            </p>
            <div className="space-y-1">
              {frescosFiltrados.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between rounded border border-blue-100 bg-white px-2 py-1.5 text-xs"
                >
                  <span>
                    <span className="font-mono">{l.codigo_lote}</span> ·{' '}
                    {l.producto?.nombre ?? 'Pasta'} · {l.fecha}
                    {l.cantidad_cajones && <> · {l.cantidad_cajones} bandejas</>}
                    {l.porciones != null && <> · {l.porciones} porc. est.</>}
                  </span>
                  <button
                    onClick={() => setModalPorcionar(l)}
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
                    title="Corregir — usar solo si hay error de tipeo o no se cargó desde el QR"
                  >
                    Corregir
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-gray-50 text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-2">Código lote</th>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Relleno</th>
                <th className="px-4 py-2">Masa</th>
                <th className="px-4 py-2">Porciones</th>
                <th className="px-4 py-2">Local</th>
                <th className="px-4 py-2">Responsable</th>
                <th className="px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pastasFiltradas.map((l) => {
                const esFresco = l.ubicacion === 'freezer_produccion';
                const fechaArmado = formatDDMM(l.fecha);
                const fechaPorc = l.fecha_porcionado ? formatDDMM(l.fecha_porcionado) : null;
                const diasCiclo =
                  l.fecha && l.fecha_porcionado
                    ? Math.max(
                        0,
                        Math.round(
                          (new Date(l.fecha_porcionado + 'T00:00:00').getTime() -
                            new Date(l.fecha + 'T00:00:00').getTime()) /
                            86400000,
                        ),
                      )
                    : null;
                const rinde =
                  l.porciones != null && l.cantidad_cajones && l.cantidad_cajones > 0
                    ? Math.round((l.porciones / l.cantidad_cajones) * 10) / 10
                    : null;
                return (
                  <tr
                    key={l.id}
                    className={cn(
                      'border-b border-surface-border hover:bg-gray-50',
                      esFresco && 'bg-blue-50/40',
                    )}
                  >
                    <td className="px-4 py-2 font-mono text-xs font-medium">{l.codigo_lote}</td>
                    <td className="px-4 py-2 font-medium">{l.producto?.nombre ?? '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-0.5">
                        {esFresco ? (
                          <span className="inline-block w-fit rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                            Fresco {l.cantidad_cajones ? `· ${l.cantidad_cajones} band.` : ''}
                          </span>
                        ) : (
                          <span className="inline-block w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            En cámara{l.cantidad_cajones ? ` · ${l.cantidad_cajones} band.` : ''}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-500">
                          Armado {fechaArmado}
                          {fechaPorc && (
                            <>
                              {' '}· Porcionado {fechaPorc}
                              {diasCiclo != null && diasCiclo > 0 && (
                                <span className="text-gray-400"> ({diasCiclo}d)</span>
                              )}
                            </>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {l.lote_relleno?.receta?.nombre
                        ? `${l.lote_relleno.receta.nombre} (${l.relleno_kg ?? '?'} kg)`
                        : 'Sin relleno'}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {l.receta_masa?.nombre
                        ? `${l.receta_masa.nombre} (${l.masa_kg ?? '?'} kg)`
                        : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold">
                          {l.porciones ?? '—'}
                          {l.merma_porcionado > 0 && (
                            <span className="ml-1 text-[10px] text-red-500">
                              (-{l.merma_porcionado})
                            </span>
                          )}
                        </span>
                        {rinde != null && (
                          <span className="text-[10px] text-gray-500">
                            {rinde} porc/band.
                          </span>
                        )}
                        {l.sobrante_gramos != null && l.sobrante_gramos > 0 && (
                          <span className="text-[10px] text-amber-600">
                            +{l.sobrante_gramos}g sobrante
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 capitalize">{l.local}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span>
                          <span className="text-gray-400">Armó:</span>{' '}
                          {l.responsable || '—'}
                        </span>
                        {l.responsable_porcionado && (
                          <span>
                            <span className="text-gray-400">Porcionó:</span>{' '}
                            {l.responsable_porcionado}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="space-x-2 px-4 py-2">
                      {esFresco && (
                        <button
                          onClick={() => setModalPorcionar(l)}
                          className="text-xs text-gray-600 hover:text-gray-800"
                          title="Corregir — usar solo si hay error de tipeo o no se cargó desde el QR"
                        >
                          Corregir
                        </button>
                      )}
                      <button
                        onClick={() =>
                          setModalEditarLote({
                            id: l.id,
                            tabla: 'cocina_lotes_pasta',
                            nombre: `${l.producto?.nombre ?? 'Pasta'} · ${l.codigo_lote}`,
                          })
                        }
                        className="text-xs text-rodziny-600 hover:text-rodziny-800"
                        title="Editar kg, porciones, merma, etc."
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('¿Eliminar este lote de pasta?'))
                            eliminarPasta.mutate(l.id);
                        }}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
              {pastasFiltradas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-gray-400">
                    {cargandoP ? 'Cargando...' : 'No hay pastas registradas hoy'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Sección: Proyección de producción (salsas/postres en stock con FIFO + Fudo) ─── */}
      <StockProduccionSection filtroLocal={filtroLocal} />

      {/* Modales */}
      {modalCerrarMasa && (
        <ModalCerrarMasa
          lote={modalCerrarMasa}
          onClose={() => setModalCerrarMasa(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-lotes-masa', fecha] });
            setModalCerrarMasa(null);
          }}
        />
      )}
      {modalPorcionar && (
        <ModalPorcionar
          lote={modalPorcionar}
          onClose={() => setModalPorcionar(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta', fecha] });
            qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta-frescos'] });
            qc.invalidateQueries({ queryKey: ['cocina-stock'] });
            setModalPorcionar(null);
          }}
        />
      )}
      {editorPlan && (
        <PlanProduccionEditor
          local={editorPlan.local}
          semanaRef={editorPlan.semanaRef}
          onClose={() => setEditorPlan(null)}
        />
      )}
      {modalEditarLote && (
        <EditarLoteModal
          id={modalEditarLote.id}
          tabla={modalEditarLote.tabla}
          nombre={modalEditarLote.nombre}
          onClose={() => setModalEditarLote(null)}
        />
      )}
    </div>
  );
}

// ── Modal: Porcionar pasta fresca ──────────────────────────────────────────────

function ModalPorcionar({
  lote,
  onClose,
  onSaved,
}: {
  lote: LotePasta;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [porcionesReales, setPorcionesReales] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const estimadas: number | null = lote.porciones;
  const reales = Number(porcionesReales) || 0;
  const diferencia = estimadas != null ? reales - estimadas : null;

  async function guardar() {
    if (!porcionesReales || reales <= 0) {
      setError('Indicá las porciones reales');
      return;
    }
    setGuardando(true);
    setError('');
    const merma = diferencia != null && diferencia < 0 ? Math.abs(diferencia) : 0;
    const { error: err } = await supabase.rpc('porcionar_pasta_lote', {
      p_lote_id: lote.id,
      p_porciones: reales,
      p_responsable: responsable.trim() || null,
      p_merma_porcionado: merma,
      p_notas: notas.trim() || null,
    });
    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Porcionar lote</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="space-y-0.5 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
          <div>
            <span className="text-gray-500">Lote:</span>{' '}
            <span className="font-mono font-semibold">{lote.codigo_lote}</span>
          </div>
          <div>
            <span className="text-gray-500">Producto:</span> {lote.producto?.nombre ?? '—'}
          </div>
          <div>
            <span className="text-gray-500">Armado:</span> {lote.fecha}
            {lote.cantidad_cajones ? ` · ${lote.cantidad_cajones} bandejas` : ''}
          </div>
          {estimadas != null && (
            <div>
              <span className="text-gray-500">Estimado:</span>{' '}
              <span className="font-semibold">{estimadas}</span> porciones
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Porciones totales (bolsitas 200g)
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={porcionesReales}
            onChange={(e) => setPorcionesReales(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder={estimadas != null ? String(estimadas) : 'Ej: 120'}
          />
          {reales > 0 && diferencia != null && diferencia !== 0 && (
            <p
              className={cn(
                'mt-1 text-[11px]',
                diferencia < 0 ? 'text-red-600' : 'text-emerald-600',
              )}
            >
              {diferencia < 0
                ? `${Math.abs(diferencia)} porciones de merma`
                : `+${diferencia} porciones vs estimado`}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Responsable</label>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Nombre"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Notas (opcional)</label>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <div className="rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Mover a cámara'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Cerrar masa (registrar sobrante) ──────────────────────────────────

function ModalCerrarMasa({
  lote,
  onClose,
  onSaved,
}: {
  lote: LoteMasa;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kgSobrante, setKgSobrante] = useState('');
  const [destino, setDestino] = useState<'fideos' | 'merma' | 'proxima_masa'>('fideos');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const guardar = async () => {
    if (kgSobrante === '') {
      setError('Kg sobrante es obligatorio (puede ser 0)');
      return;
    }
    setGuardando(true);
    setError('');
    const { error: err } = await supabase
      .from('cocina_lotes_masa')
      .update({
        kg_sobrante: Number(kgSobrante),
        destino_sobrante: Number(kgSobrante) === 0 ? null : destino,
      })
      .eq('id', lote.id);
    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-bold text-gray-800">Cerrar lote de masa</h3>
        <div className="mb-4 text-sm text-gray-600">
          <span className="font-medium">{lote.receta?.nombre ?? 'Masa'}</span> —{' '}
          {fmtCantidad(lote.kg_producidos)} kg producidos
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Kg sobrante</label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={kgSobrante}
              onChange={(e) => setKgSobrante(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              placeholder="0.0"
            />
          </div>
          {kgSobrante !== '' && Number(kgSobrante) > 0 && (
            <div>
              <label className="mb-1 block text-xs text-gray-500">Destino del sobrante</label>
              <select
                value={destino}
                onChange={(e) => setDestino(e.target.value as 'fideos' | 'merma' | 'proxima_masa')}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="fideos">Fideos (reutilizar)</option>
                <option value="merma">Merma (descartar)</option>
                <option value="proxima_masa">Próxima masa</option>
              </select>
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded bg-rodziny-700 px-4 py-1.5 text-sm text-white hover:bg-rodziny-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Cerrar lote'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sección de Lotes registrados ──────────────────────────────────────────────
// Agrupada por tipo, solo muestra secciones con lotes (sin cards de 0). Filtro
// por pills compactas en lugar de KPI grid. Cada fila tiene jerarquía visual
// (receta+cantidad grandes, responsable/detalle gris chico) y muestra
// tiempo relativo si la fecha activa es hoy.

interface LotesRegistradosSectionProps {
  lotes: LoteUnificado[];
  conteo: { total: number; porTipo: Record<TipoLote, number> };
  fechaLabel: string;
  fecha: string;
  filtroLocal: FiltroLocal;
  filtroTipoLote: 'todos' | TipoLote;
  setFiltroTipoLote: (t: 'todos' | TipoLote) => void;
  cargando: boolean;
  onCerrarMasa: (m: LoteMasa) => void;
  onEditar: (l: LoteUnificado) => void;
  onEliminar: (l: LoteUnificado) => void;
}

function LotesRegistradosSection({
  lotes,
  conteo,
  fechaLabel,
  fecha,
  filtroLocal,
  filtroTipoLote,
  setFiltroTipoLote,
  cargando,
  onCerrarMasa,
  onEditar,
  onEliminar,
}: LotesRegistradosSectionProps) {
  const tiposConDatos = TIPO_LOTE_ORDEN.filter((t) => conteo.porTipo[t] > 0);
  const esHoy = fecha === hoy();

  // Tiempo relativo solo para hoy (no rota para fechas pasadas).
  function tiempoRelativo(hora: string): string | null {
    if (!esHoy || hora === '—') return null;
    const [h, m] = hora.split(':').map(Number);
    const ahora = new Date();
    const minutosLote = h * 60 + m;
    const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
    const diff = minutosAhora - minutosLote;
    if (diff < 1) return 'recién';
    if (diff < 60) return `hace ${diff} min`;
    const horas = Math.floor(diff / 60);
    return `hace ${horas}h`;
  }

  const localLabel =
    filtroLocal === 'todos' ? 'ambos locales' : filtroLocal === 'vedia' ? 'Vedia' : 'Saavedra';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Lotes registrados</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            <span className="capitalize">{fechaLabel}</span> · {localLabel} · {conteo.total}{' '}
            {conteo.total === 1 ? 'lote' : 'lotes'}
          </p>
        </div>
        {tiposConDatos.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <PillBtn
              active={filtroTipoLote === 'todos'}
              onClick={() => setFiltroTipoLote('todos')}
            >
              Todos · {conteo.total}
            </PillBtn>
            {tiposConDatos.map((t) => (
              <PillBtn
                key={t}
                active={filtroTipoLote === t}
                onClick={() => setFiltroTipoLote(filtroTipoLote === t ? 'todos' : t)}
              >
                {TIPO_LOTE_LABEL[t]} · {conteo.porTipo[t]}
              </PillBtn>
            ))}
          </div>
        )}
      </div>

      {lotes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
          {cargando ? 'Cargando...' : 'No hay lotes registrados este día'}
        </div>
      ) : (
        <div className="space-y-4">
          {tiposConDatos
            .filter((t) => filtroTipoLote === 'todos' || filtroTipoLote === t)
            .map((tipo) => {
              const lotesDelTipo = lotes.filter((l) => l.tipo === tipo);
              if (lotesDelTipo.length === 0) return null;
              return (
                <section key={tipo}>
                  <h4
                    className={cn(
                      'mb-2 inline-flex items-center gap-2 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                      TIPO_LOTE_COLOR[tipo],
                    )}
                  >
                    {TIPO_LOTE_LABEL[tipo]}
                    <span className="font-normal opacity-70">· {lotesDelTipo.length}</span>
                  </h4>
                  <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-white">
                    {lotesDelTipo.map((l) => {
                      const rel = tiempoRelativo(l.hora);
                      const masaPendiente = l.tipo === 'masa' && l.masaRow?.kg_sobrante == null;
                      return (
                        <div
                          key={`${l.tabla}-${l.id}`}
                          className="flex flex-wrap items-start gap-3 px-4 py-3 hover:bg-gray-50"
                        >
                          <div className="min-w-[64px] tabular-nums">
                            <p className="text-sm font-medium text-gray-700">{l.hora}</p>
                            {rel && <p className="text-[10px] text-gray-400">{rel}</p>}
                          </div>
                          <div className="min-w-[200px] flex-1">
                            <p className="text-sm font-semibold text-gray-900">
                              {l.nombre}
                              <span className="ml-2 font-medium tabular-nums text-gray-700">
                                {l.cantidadStr}
                              </span>
                            </p>
                            <p className="mt-0.5 text-[11px] text-gray-500">
                              {l.responsable || 'Sin responsable'}
                              {filtroLocal === 'todos' && (
                                <>
                                  {' · '}
                                  <span className="capitalize">{l.local}</span>
                                </>
                              )}
                              {l.detalleExtra && <> · {l.detalleExtra}</>}
                            </p>
                            {l.notas && (
                              <p className="mt-0.5 text-[11px] italic text-gray-400">"{l.notas}"</p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 self-center">
                            <IngredientesRealesBadge ingredientes={l.ingredientes} />
                            {masaPendiente && l.masaRow && (
                              <button
                                onClick={() => onCerrarMasa(l.masaRow!)}
                                className="text-xs font-medium text-blue-600 hover:text-blue-800"
                              >
                                Cerrar
                              </button>
                            )}
                            <button
                              onClick={() => onEditar(l)}
                              className="text-xs text-rodziny-600 hover:text-rodziny-800"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => onEliminar(l)}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ── Vista semanal: agrupada por nombre de receta ──────────────────────────────

interface LotesSemanalesSectionProps {
  grupos: LoteSemanalGrupo[];
  conteo: { total: number; porTipo: Record<TipoLoteSemanal, number> };
  semana: { desde: string; hasta: string };
  filtroLocal: FiltroLocal;
  filtroTipoSemanal: 'todos' | TipoLoteSemanal;
  setFiltroTipoSemanal: (t: 'todos' | TipoLoteSemanal) => void;
  cargando: boolean;
  onCerrarMasa: (m: LoteMasa) => void;
  onPorcionarPasta: (p: LotePasta) => void;
  onEditar: (l: LoteDetalleSemana, nombre: string) => void;
  onEliminar: (l: LoteDetalleSemana) => void;
}

function metricasGrupo(g: LoteSemanalGrupo): string[] {
  const partes: string[] = [];
  if (g.tipo === 'relleno') {
    if (g.recetasTotal > 0) partes.push(`${g.recetasTotal} receta${g.recetasTotal === 1 ? '' : 's'}`);
    if (g.kgTotal > 0) partes.push(`${fmtCantidad(g.kgTotal)} kg`);
    partes.push(`${g.lotesCount} lote${g.lotesCount === 1 ? '' : 's'}`);
    if (g.porcionesTotal > 0)
      partes.push(`${g.porcionesTotal} porción${g.porcionesTotal === 1 ? '' : 'es'}`);
  } else if (g.tipo === 'pasta') {
    partes.push(`${g.lotesCount} lote${g.lotesCount === 1 ? '' : 's'}`);
    partes.push(`${g.porcionesTotal} porción${g.porcionesTotal === 1 ? '' : 'es'}`);
  } else if (g.tipo === 'masa') {
    partes.push(`${fmtCantidad(g.kgTotal)} kg`);
    partes.push(`${g.lotesCount} lote${g.lotesCount === 1 ? '' : 's'}`);
  } else {
    // salsa / postre / pasteleria / panaderia / prueba
    if (g.kgTotal > 0) partes.push(`${fmtCantidad(g.kgTotal)} kg`);
    if (g.unidadesTotal > 0) partes.push(`${g.unidadesTotal} unid`);
    if (g.ltTotal > 0) partes.push(`${fmtCantidad(g.ltTotal)} L`);
    partes.push(`${g.lotesCount} lote${g.lotesCount === 1 ? '' : 's'}`);
  }
  return partes;
}

function LotesSemanalesSection({
  grupos,
  conteo,
  semana,
  filtroLocal,
  filtroTipoSemanal,
  setFiltroTipoSemanal,
  cargando,
  onCerrarMasa,
  onPorcionarPasta,
  onEditar,
  onEliminar,
}: LotesSemanalesSectionProps) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const tiposConDatos = TIPO_LOTE_SEMANAL_ORDEN.filter((t) => conteo.porTipo[t] > 0);
  const localLabel =
    filtroLocal === 'todos' ? 'ambos locales' : filtroLocal === 'vedia' ? 'Vedia' : 'Saavedra';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Lotes registrados</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Semana del {formatRangoLabel(semana.desde, semana.hasta)} · {localLabel} · {conteo.total}{' '}
            {conteo.total === 1 ? 'lote' : 'lotes'}
          </p>
        </div>
        {tiposConDatos.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <PillBtn
              active={filtroTipoSemanal === 'todos'}
              onClick={() => setFiltroTipoSemanal('todos')}
            >
              Todos · {conteo.total}
            </PillBtn>
            {tiposConDatos.map((t) => (
              <PillBtn
                key={t}
                active={filtroTipoSemanal === t}
                onClick={() => setFiltroTipoSemanal(filtroTipoSemanal === t ? 'todos' : t)}
              >
                {TIPO_LOTE_SEMANAL_LABEL[t]} · {conteo.porTipo[t]}
              </PillBtn>
            ))}
          </div>
        )}
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
          {cargando ? 'Cargando...' : 'No hay lotes registrados esta semana'}
        </div>
      ) : (
        <div className="space-y-4">
          {tiposConDatos
            .filter((t) => filtroTipoSemanal === 'todos' || filtroTipoSemanal === t)
            .map((tipo) => {
              const gruposDelTipo = grupos.filter((g) => g.tipo === tipo);
              if (gruposDelTipo.length === 0) return null;
              return (
                <section key={tipo}>
                  <h4
                    className={cn(
                      'mb-2 inline-flex items-center gap-2 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                      TIPO_LOTE_SEMANAL_COLOR[tipo],
                    )}
                  >
                    {TIPO_LOTE_SEMANAL_LABEL[tipo]}
                    <span className="font-normal opacity-70">· {conteo.porTipo[tipo]}</span>
                  </h4>
                  <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-white">
                    {gruposDelTipo.map((g) => {
                      const key = `${g.tipo}::${g.nombre}`;
                      const abierto = expandidos.has(key);
                      const metricas = metricasGrupo(g);
                      return (
                        <div key={key}>
                          <button
                            type="button"
                            onClick={() => toggleExpand(key)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'inline-block text-gray-400 transition-transform',
                                  abierto && 'rotate-90',
                                )}
                              >
                                ▸
                              </span>
                              <span className="text-sm font-semibold text-gray-900">
                                {g.nombre}
                              </span>
                            </div>
                            <span className="text-xs tabular-nums text-gray-600">
                              {metricas.join(' · ')}
                            </span>
                          </button>
                          {abierto && (
                            <div className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/40">
                              {g.lotes.map((l) => {
                                const masaPendiente =
                                  l.tabla === 'cocina_lotes_masa' &&
                                  l.masaRow != null &&
                                  l.masaRow.kg_sobrante == null;
                                const pastaFresca =
                                  l.tabla === 'cocina_lotes_pasta' &&
                                  l.pastaRow?.ubicacion === 'freezer_produccion';
                                return (
                                  <div
                                    key={`${l.tabla}-${l.id}`}
                                    className="flex flex-wrap items-start gap-3 px-4 py-2.5"
                                  >
                                    <div className="min-w-[88px] tabular-nums">
                                      <p className="text-xs font-medium text-gray-700">
                                        {diaCorto(l.fecha)} {formatDDMM(l.fecha)} · {l.hora}
                                      </p>
                                    </div>
                                    <div className="min-w-[160px] flex-1">
                                      <p className="text-sm text-gray-800">
                                        <span className="font-medium tabular-nums">
                                          {l.cantidadStr}
                                        </span>
                                        {l.detalleExtra && (
                                          <span className="text-gray-500"> · {l.detalleExtra}</span>
                                        )}
                                      </p>
                                      <p className="mt-0.5 text-[11px] text-gray-500">
                                        {l.responsable || 'Sin responsable'}
                                        {filtroLocal === 'todos' && (
                                          <>
                                            {' · '}
                                            <span className="capitalize">{l.local}</span>
                                          </>
                                        )}
                                      </p>
                                      {l.notas && (
                                        <p className="mt-0.5 text-[11px] italic text-gray-400">
                                          "{l.notas}"
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 self-center">
                                      <IngredientesRealesBadge ingredientes={l.ingredientes} />
                                      {masaPendiente && l.masaRow && (
                                        <button
                                          onClick={() => onCerrarMasa(l.masaRow!)}
                                          className="text-xs font-medium text-blue-600 hover:text-blue-800"
                                        >
                                          Cerrar
                                        </button>
                                      )}
                                      {pastaFresca && l.pastaRow && (
                                        <button
                                          onClick={() => onPorcionarPasta(l.pastaRow!)}
                                          className="text-xs text-gray-600 hover:text-gray-800"
                                          title="Corregir porciones"
                                        >
                                          Corregir
                                        </button>
                                      )}
                                      <button
                                        onClick={() => onEditar(l, g.nombre)}
                                        className="text-xs text-rodziny-600 hover:text-rodziny-800"
                                      >
                                        Editar
                                      </button>
                                      <button
                                        onClick={() => onEliminar(l)}
                                        className="text-xs text-red-500 hover:text-red-700"
                                      >
                                        Eliminar
                                      </button>
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
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}

function PillBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-rodziny-600 bg-rodziny-50 font-medium text-rodziny-700'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  );
}
