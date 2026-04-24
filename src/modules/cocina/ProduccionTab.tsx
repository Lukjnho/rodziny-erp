import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { KPICard } from '@/components/ui/KPICard';
import { StockProduccionSection } from './components/StockProduccionSection';
import { PlanProduccionEditor } from './components/PlanProduccionEditor';
import { PlanSemanal } from './components/PlanSemanal';
import { cn } from '@/lib/utils';

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

type FiltroLocal = 'todos' | 'vedia' | 'saavedra';

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

// ── Componente principal ──────────────────────────────────────────────────────

export function ProduccionTab() {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(hoy());
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos');
  const [filtroPastaEstado, setFiltroPastaEstado] = useState<'todos' | 'fresco' | 'camara'>(
    'todos',
  );
  const [filtroTipoLote, setFiltroTipoLote] = useState<'todos' | TipoLote>('todos');

  // Modales
  const [modalCerrarMasa, setModalCerrarMasa] = useState<LoteMasa | null>(null);
  const [modalPorcionar, setModalPorcionar] = useState<LotePasta | null>(null);
  const [editorPlanLocal, setEditorPlanLocal] = useState<'vedia' | 'saavedra' | null>(null);

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
        cantidadStr: `${l.peso_total_kg} kg`,
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
        partes.push(`${disp} kg disp · ${+usado.toFixed(3)} kg usados`);
      } else {
        const destino =
          l.destino_sobrante === 'fideos'
            ? 'fideos (reutilizar)'
            : l.destino_sobrante === 'merma'
              ? 'merma (descartar)'
              : 'próxima masa';
        partes.push(`Sobrante ${l.kg_sobrante} kg → ${destino}`);
      }
      out.push({
        id: l.id,
        tipo: 'masa',
        tabla: 'cocina_lotes_masa',
        nombre: l.receta?.nombre ?? '—',
        cantidadStr: `${l.kg_producidos} kg`,
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
      const merma =
        l.merma_cantidad && l.merma_cantidad > 0
          ? `Merma ${l.merma_cantidad} ${u}${l.merma_motivo ? ` · ${l.merma_motivo}` : ''}`
          : null;
      out.push({
        id: l.id,
        tipo: l.categoria,
        tabla: 'cocina_lotes_produccion',
        nombre: l.receta?.nombre ?? l.nombre_libre ?? '—',
        cantidadStr: `${l.cantidad_producida} ${u}`,
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
        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
          className="ml-auto rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
      </div>

      {/* ── Sección: Plan semanal ─────────────────────────────────────────────
          Vista lunes-domingo de la semana de la fecha seleccionada. Muestra el
          plan del chef, completados (cliclo completo), pendientes (a terminar),
          lotes registrados sin estar planeados (fuera del plan) y pastas armadas. */}
      <div className="space-y-3">
        {(filtroLocal === 'todos' || filtroLocal === 'vedia') && (
          <PlanSemanal
            fechaActiva={fecha}
            local="vedia"
            onAbrirEditor={() => setEditorPlanLocal('vedia')}
          />
        )}
        {(filtroLocal === 'todos' || filtroLocal === 'saavedra') && (
          <PlanSemanal
            fechaActiva={fecha}
            local="saavedra"
            onAbrirEditor={() => setEditorPlanLocal('saavedra')}
          />
        )}
      </div>

      {/* ── Sección: Lotes registrados (relleno + masa + producción adicional) ── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">Lotes registrados</h3>
          <span className="text-xs text-gray-500">Cargados desde el QR por el equipo</span>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <KPICard
            label="Total"
            value={String(conteoPorTipo.total)}
            color="green"
            loading={cargandoR || cargandoM || cargandoProd}
            active={filtroTipoLote === 'todos'}
            onClick={() => setFiltroTipoLote('todos')}
          />
          {TIPO_LOTE_ORDEN.map((t) => (
            <KPICard
              key={t}
              label={TIPO_LOTE_LABEL[t]}
              value={String(conteoPorTipo.porTipo[t])}
              color="neutral"
              active={filtroTipoLote === t}
              onClick={() => setFiltroTipoLote(filtroTipoLote === t ? 'todos' : t)}
            />
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-gray-50 text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-2">Hora</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Receta</th>
                <th className="px-4 py-2">Cantidad</th>
                <th className="px-4 py-2">Detalle</th>
                <th className="px-4 py-2">Ing.</th>
                <th className="px-4 py-2">Local</th>
                <th className="px-4 py-2">Responsable</th>
                <th className="px-4 py-2">Notas</th>
                <th className="px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lotesUnificadosFiltrados.map((l) => {
                const masaPendiente = l.tipo === 'masa' && l.masaRow?.kg_sobrante == null;
                return (
                  <tr key={`${l.tabla}-${l.id}`} className="border-b border-surface-border hover:bg-gray-50">
                    <td className="px-4 py-2 tabular-nums text-xs text-gray-500">{l.hora}</td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium',
                          TIPO_LOTE_COLOR[l.tipo],
                        )}
                      >
                        {TIPO_LOTE_LABEL[l.tipo].replace(/s$/, '')}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-medium">{l.nombre}</td>
                    <td className="px-4 py-2 tabular-nums">{l.cantidadStr}</td>
                    <td className="px-4 py-2 text-[11px] text-gray-500">
                      {l.detalleExtra ?? '—'}
                    </td>
                    <td className="px-4 py-2">
                      <IngredientesRealesBadge ingredientes={l.ingredientes} />
                    </td>
                    <td className="px-4 py-2 capitalize">{l.local}</td>
                    <td className="px-4 py-2">{l.responsable || '—'}</td>
                    <td className="max-w-xs truncate px-4 py-2 text-gray-500">{l.notas || '—'}</td>
                    <td className="space-x-2 px-4 py-2">
                      {masaPendiente && l.masaRow && (
                        <button
                          onClick={() => setModalCerrarMasa(l.masaRow!)}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          Cerrar
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (!window.confirm('¿Eliminar este lote?')) return;
                          if (l.tabla === 'cocina_lotes_relleno') eliminarRelleno.mutate(l.id);
                          else if (l.tabla === 'cocina_lotes_masa') eliminarMasa.mutate(l.id);
                          else eliminarProduccion.mutate(l.id);
                        }}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
              {lotesUnificadosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-gray-400">
                    {cargandoR || cargandoM || cargandoProd
                      ? 'Cargando...'
                      : 'No hay lotes registrados'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
      {editorPlanLocal && (
        <PlanProduccionEditor
          local={editorPlanLocal}
          onClose={() => setEditorPlanLocal(null)}
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
          {lote.kg_producidos} kg producidos
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
