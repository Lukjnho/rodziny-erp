import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';
import { cn } from '@/lib/utils';
import { IngredientesGrilla, type IngredienteReal } from './components/IngredientesGrilla';

// ── Tipos ──────────────────────────────────────────────────────────────────────

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

const RECETA_UNIDAD_LABEL: Record<'kg' | 'l' | 'unidad', string> = {
  kg: 'kg',
  l: 'L',
  unidad: 'unid.',
};
function unidadReceta(r: { rendimiento_unidad: 'kg' | 'l' | 'unidad' | null }): string {
  return RECETA_UNIDAD_LABEL[r.rendimiento_unidad ?? 'kg'];
}
interface LoteRelleno {
  id: string;
  receta_id: string;
  peso_total_kg: number;
  local: string;
  fecha: string;
  receta?: { nombre: string } | null;
  // Campos calculados en memoria a partir de las pastas que consumieron este lote.
  consumido_kg?: number;
  disponible_kg?: number;
}
interface LoteMasa {
  id: string;
  receta_id: string | null;
  kg_producidos: number;
  kg_sobrante: number | null;
  destino_sobrante: string | null;
  fecha: string;
  receta?: { nombre: string } | null;
  consumido_kg?: number;
  disponible_kg?: number;
}
interface LotePastaFresco {
  id: string;
  producto_id: string;
  codigo_lote: string;
  porciones: number | null;
  cantidad_cajones: number | null;
  fecha: string;
  producto?: { nombre: string } | null;
}

interface SobrantePendiente {
  id: string;
  producto_id: string;
  codigo_lote: string;
  fecha: string;
  sobrante_gramos: number;
}

type Vista =
  | 'inicio'
  | 'relleno'
  | 'pasta'
  | 'porcionar-pasta'
  | 'masa'
  | 'cerrar-masa'
  | 'salsa'
  | 'postre'
  | 'pasteleria'
  | 'panaderia'
  | 'prueba'
  | 'exito';

type CategoriaGenerica = 'salsa' | 'postre' | 'pasteleria' | 'panaderia' | 'prueba';

// ── Helpers ────────────────────────────────────────────────────────────────────

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

// Ventana de días hacia atrás para buscar lotes de relleno/masa todavía abiertos.
// Los rellenos/masas pueden quedar parcialmente usados y guardados en heladera
// para terminarlos en días siguientes. 7 días es generoso y cubre el caso.
const DIAS_VENTANA_LOTES_ABIERTOS = 7;

function fechaHaceDias(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function formatDDMM(fecha: string) {
  const [, m, d] = fecha.split('-');
  return `${d}${m}`;
}

// ── Layout base ────────────────────────────────────────────────────────────────

function Pantalla({ local, children }: { local: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="flex items-center gap-2 bg-rodziny-800 px-4 py-3 text-white">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-rodziny-600 text-xs font-bold">
          R
        </div>
        <div className="flex-1">
          <span className="text-sm font-semibold">Rodziny · Producción</span>
          <span className="text-rodziny-200 ml-2 text-[10px] capitalize">{local}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 p-4">{children}</main>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export function ProduccionQRPage() {
  const [params] = useSearchParams();
  const local = (params.get('local') === 'saavedra' ? 'saavedra' : 'vedia') as 'vedia' | 'saavedra';

  const qc = useQueryClient();
  const [vista, setVista] = useState<Vista>('inicio');
  const [mensajeExito, setMensajeExito] = useState('');

  // Catálogos
  const { data: productos } = useQuery({
    queryKey: ['cocina-productos-qr'],
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
    queryKey: ['cocina-recetas-qr'],
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

  // Plan del día: items pendientes/parciales del pizarrón para hoy + local.
  // Se usa para ofrecer primero las recetas que el chef planificó.
  const { data: planHoy } = useQuery({
    queryKey: ['cocina-plan-hoy-qr', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pizarron_items')
        .select('tipo, receta_id, estado')
        .eq('local', local)
        .eq('fecha_objetivo', hoy())
        .in('estado', ['pendiente', 'parcial']);
      if (error) throw error;
      return data as Array<{
        tipo: 'relleno' | 'masa' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia';
        receta_id: string | null;
        estado: string;
      }>;
    },
  });

  // Lotes de relleno / masa: últimos N días (para poder seguir usando rellenos
  // y masas que quedaron parcialmente en heladera de días anteriores).
  const desdeLotes = fechaHaceDias(DIAS_VENTANA_LOTES_ABIERTOS);

  const { data: lotesRellenoHoy } = useQuery({
    queryKey: ['cocina-lotes-relleno-qr', desdeLotes, local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_relleno')
        .select('id, receta_id, peso_total_kg, fecha, local, receta:cocina_recetas(nombre)')
        .gte('fecha', desdeLotes)
        .eq('local', local)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as LoteRelleno[];
    },
  });

  const { data: lotesMasaHoy } = useQuery({
    queryKey: ['cocina-lotes-masa-qr', desdeLotes, local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_masa')
        .select(
          'id, receta_id, kg_producidos, kg_sobrante, destino_sobrante, fecha, receta:cocina_recetas(nombre)',
        )
        .gte('fecha', desdeLotes)
        .eq('local', local)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as LoteMasa[];
    },
  });

  // "Masas abiertas" en la home solo cuenta las de HOY sin cerrar — las de días
  // anteriores no deberían empujar al operario a cerrarlas desde este QR.
  const masasAbiertas = useMemo(
    () => (lotesMasaHoy ?? []).filter((m) => m.fecha === hoy() && m.kg_sobrante === null).length,
    [lotesMasaHoy],
  );

  // Pastas armadas que pueden haber consumido lotes abiertos.
  // Traemos el mismo rango para poder restar bien los kg ya usados.
  const { data: pastasConsumoHoy } = useQuery({
    queryKey: ['cocina-pastas-consumo-qr', desdeLotes, local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('id, lote_relleno_id, lote_masa_id, relleno_kg, masa_kg, fecha, local')
        .eq('local', local)
        .gte('fecha', desdeLotes);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        lote_relleno_id: string | null;
        lote_masa_id: string | null;
        relleno_kg: number | null;
        masa_kg: number | null;
        fecha: string;
        local: string;
      }[];
    },
  });

  // Sumas de consumo por lote
  const consumoPorRelleno = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pastasConsumoHoy ?? []) {
      if (p.lote_relleno_id && p.relleno_kg) {
        m.set(p.lote_relleno_id, (m.get(p.lote_relleno_id) ?? 0) + p.relleno_kg);
      }
    }
    return m;
  }, [pastasConsumoHoy]);

  const consumoPorMasa = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pastasConsumoHoy ?? []) {
      if (p.lote_masa_id && p.masa_kg) {
        m.set(p.lote_masa_id, (m.get(p.lote_masa_id) ?? 0) + p.masa_kg);
      }
    }
    return m;
  }, [pastasConsumoHoy]);

  // Enriquecer los lotes con consumido + disponible, y filtrar los que ya
  // quedaron en cero (no tiene sentido ofrecerlos para armar otra pasta).
  const rellenosDisponibles = useMemo<LoteRelleno[]>(() => {
    return (lotesRellenoHoy ?? [])
      .map((l) => {
        const consumido = consumoPorRelleno.get(l.id) ?? 0;
        return {
          ...l,
          consumido_kg: consumido,
          disponible_kg: +(l.peso_total_kg - consumido).toFixed(3),
        };
      })
      .filter((l) => (l.disponible_kg ?? 0) > 0.01);
  }, [lotesRellenoHoy, consumoPorRelleno]);

  const masasDisponibles = useMemo<LoteMasa[]>(() => {
    return (lotesMasaHoy ?? [])
      .map((l) => {
        const consumido = consumoPorMasa.get(l.id) ?? 0;
        return {
          ...l,
          consumido_kg: consumido,
          disponible_kg: +(l.kg_producidos - consumido).toFixed(3),
        };
      })
      .filter((l) => (l.disponible_kg ?? 0) > 0.01);
  }, [lotesMasaHoy, consumoPorMasa]);

  // Mapping pasta ↔ recetas (relleno/masa) predeterminadas. Sirve para autocompletar
  // la pasta al elegir relleno+masa disponibles en el formulario de armado.
  const { data: pastaRecetas } = useQuery({
    queryKey: ['cocina-pasta-recetas-qr'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pasta_recetas')
        .select('pasta_id, receta_id');
      if (error) throw error;
      return (data ?? []) as { pasta_id: string; receta_id: string }[];
    },
  });

  // Lotes de pasta "frescos" pendientes de porcionar (cualquier fecha, no solo hoy —
  // el armado suele ser el día anterior)
  const { data: lotesFrescos } = useQuery({
    queryKey: ['cocina-lotes-pasta-frescos-qr', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select(
          'id, producto_id, codigo_lote, porciones, cantidad_cajones, fecha, producto:cocina_productos(nombre)',
        )
        .eq('local', local)
        .eq('ubicacion', 'freezer_produccion')
        .order('fecha', { ascending: true });
      if (error) throw error;
      return data as unknown as LotePastaFresco[];
    },
  });

  // Sobrantes de porcionados anteriores que aún no fueron reutilizados.
  // Trae todos los lotes con sobrante > 0 y filtra los ya consumidos en JS
  // (un lote consumió un sobrante cuando otro lote lo apunta vía sobrante_origen_lote_id).
  const { data: sobrantesPendientes } = useQuery({
    queryKey: ['cocina-pasta-sobrantes-qr', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('id, producto_id, codigo_lote, fecha, sobrante_gramos, sobrante_origen_lote_id')
        .eq('local', local)
        .gt('sobrante_gramos', 0)
        .order('fecha', { ascending: false });
      if (error) throw error;
      const consumidos = new Set(
        (data ?? [])
          .map((r) => r.sobrante_origen_lote_id)
          .filter((v): v is string => typeof v === 'string'),
      );
      return (data ?? [])
        .filter((r) => !consumidos.has(r.id))
        .map((r) => ({
          id: r.id,
          producto_id: r.producto_id,
          codigo_lote: r.codigo_lote,
          fecha: r.fecha,
          sobrante_gramos: Number(r.sobrante_gramos),
        })) as SobrantePendiente[];
    },
  });

  const frescosPendientes = lotesFrescos?.length ?? 0;

  // Filtro estricto por local: solo muestra lo asignado explícitamente a este local.
  // Inlineamos el chequeo en cada useMemo para que no haya un closure intermedio
  // que oculte la dependencia real (local) del linter de hooks.
  const recetasRelleno = useMemo(
    () => (recetas ?? []).filter((r) => r.tipo === 'relleno' && r.local === local),
    [recetas, local],
  );
  const recetasMasa = useMemo(
    () => (recetas ?? []).filter((r) => r.tipo === 'masa' && r.local === local),
    [recetas, local],
  );
  const recetasSalsa = useMemo(
    () => (recetas ?? []).filter((r) => r.tipo === 'salsa' && r.local === local),
    [recetas, local],
  );
  const recetasPostre = useMemo(
    () => (recetas ?? []).filter((r) => r.tipo === 'postre' && r.local === local),
    [recetas, local],
  );
  const recetasPasteleria = useMemo(
    () => (recetas ?? []).filter((r) => r.tipo === 'pasteleria' && r.local === local),
    [recetas, local],
  );
  const recetasPanaderia = useMemo(
    () => (recetas ?? []).filter((r) => r.tipo === 'panaderia' && r.local === local),
    [recetas, local],
  );
  const recetasLocal = useMemo(
    () => (recetas ?? []).filter((r) => r.local === local),
    [recetas, local],
  );

  // Receta IDs planificados hoy, agrupados por tipo. Se usa para ofrecer por
  // default solo las recetas planificadas en el QR de los chicos.
  const planPorTipo = useMemo(() => {
    const m: Record<'relleno' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia', Set<string>> = {
      relleno: new Set(),
      salsa: new Set(),
      postre: new Set(),
      pasteleria: new Set(),
      panaderia: new Set(),
    };
    for (const it of planHoy ?? []) {
      if (!it.receta_id) continue;
      if (it.tipo in m) {
        m[it.tipo as keyof typeof m].add(it.receta_id);
      }
    }
    return m;
  }, [planHoy]);
  const productosPasta = useMemo(
    () => (productos ?? []).filter((p) => p.tipo === 'pasta' && p.local === local),
    [productos, local],
  );

  function onGuardado(msg: string) {
    setMensajeExito(msg);
    setVista('exito');
    // Refrescar lotes para que aparezcan al cargar pasta
    qc.invalidateQueries({ queryKey: ['cocina-lotes-relleno-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-lotes-masa-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-lotes-produccion-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta-frescos-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-pastas-consumo-qr'] });
  }

  return (
    <Pantalla local={local}>
      {vista === 'inicio' && (
        <Inicio
          local={local}
          onIr={(v) => setVista(v)}
          lotesHoy={(lotesRellenoHoy ?? []).filter((l) => l.fecha === hoy()).length}
          masasAbiertas={masasAbiertas}
          frescosPendientes={frescosPendientes}
        />
      )}

      {vista === 'relleno' && (
        <FormRelleno
          local={local}
          recetas={recetasRelleno}
          recetaIdsPlan={planPorTipo.relleno}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'pasta' && (
        <FormPasta
          local={local}
          productos={productosPasta}
          lotesRelleno={rellenosDisponibles}
          lotesMasa={masasDisponibles.filter((m) => m.kg_sobrante === null)}
          pastaRecetas={pastaRecetas ?? []}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'porcionar-pasta' && (
        <FormPorcionar
          local={local}
          lotesFrescos={lotesFrescos ?? []}
          sobrantesPendientes={sobrantesPendientes ?? []}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'masa' && (
        <FormMasa
          local={local}
          recetas={recetasMasa}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'cerrar-masa' && (
        <FormCerrarMasa
          lotesAbiertos={(lotesMasaHoy ?? []).filter(
            (m) => m.fecha === hoy() && m.kg_sobrante === null,
          )}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'salsa' && (
        <FormGenerico
          local={local}
          categoria="salsa"
          recetas={recetasSalsa}
          recetaIdsPlan={planPorTipo.salsa}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'postre' && (
        <FormGenerico
          local={local}
          categoria="postre"
          recetas={recetasPostre}
          recetaIdsPlan={planPorTipo.postre}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'pasteleria' && (
        <FormGenerico
          local={local}
          categoria="pasteleria"
          recetas={recetasPasteleria}
          recetaIdsPlan={planPorTipo.pasteleria}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'panaderia' && (
        <FormGenerico
          local={local}
          categoria="panaderia"
          recetas={recetasPanaderia}
          recetaIdsPlan={planPorTipo.panaderia}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'prueba' && (
        <FormGenerico
          local={local}
          categoria="prueba"
          recetas={recetasLocal}
          permitirLibre
          permitirLitros
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'exito' && <Exito mensaje={mensajeExito} onOtro={() => setVista('inicio')} />}
    </Pantalla>
  );
}

// ── Inicio ─────────────────────────────────────────────────────────────────────

function Inicio({
  local,
  onIr,
  lotesHoy,
  masasAbiertas,
  frescosPendientes,
}: {
  local: 'vedia' | 'saavedra';
  onIr: (v: Vista) => void;
  lotesHoy: number;
  masasAbiertas: number;
  frescosPendientes: number;
}) {
  const ahora = new Date();
  const fechaLabel = ahora.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const botones: { vista: Vista; label: string; color: string }[] = [
    { vista: 'relleno', label: 'Cargar Relleno', color: 'bg-green-600 hover:bg-green-700' },
    { vista: 'masa', label: 'Cargar Masa', color: 'bg-amber-500 hover:bg-amber-600' },
    {
      vista: 'pasta',
      label: 'Armar Pasta (bandejas)',
      color: 'bg-rodziny-700 hover:bg-rodziny-800',
    },
    {
      vista: 'porcionar-pasta',
      label: frescosPendientes > 0 ? `Porcionar Pasta (${frescosPendientes})` : 'Porcionar Pasta',
      color: 'bg-blue-600 hover:bg-blue-700',
    },
    { vista: 'salsa', label: 'Cargar Salsa', color: 'bg-orange-500 hover:bg-orange-600' },
  ];
  if (local === 'vedia') {
    botones.push({
      vista: 'postre',
      label: 'Cargar Postre',
      color: 'bg-pink-500 hover:bg-pink-600',
    });
    botones.push({
      vista: 'prueba',
      label: 'Cargar Prueba',
      color: 'bg-purple-500 hover:bg-purple-600',
    });
  } else {
    botones.push({
      vista: 'pasteleria',
      label: 'Cargar Pastelería Terminada',
      color: 'bg-pink-500 hover:bg-pink-600',
    });
    botones.push({
      vista: 'panaderia',
      label: 'Cargar Panadería Terminada',
      color: 'bg-yellow-600 hover:bg-yellow-700',
    });
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
        <p className="text-xs capitalize text-gray-500">{fechaLabel}</p>
        <p className="mt-1 text-sm text-gray-600">
          {lotesHoy > 0
            ? `${lotesHoy} lote${lotesHoy > 1 ? 's' : ''} de relleno registrado${lotesHoy > 1 ? 's' : ''} hoy`
            : 'Sin registros de relleno hoy'}
        </p>
        {masasAbiertas > 0 && (
          <p className="mt-1 text-sm text-amber-600">
            {masasAbiertas} masa{masasAbiertas > 1 ? 's' : ''} abierta{masasAbiertas > 1 ? 's' : ''}
          </p>
        )}
        {frescosPendientes > 0 && (
          <p className="mt-1 text-sm text-blue-600">
            {frescosPendientes} bandeja{frescosPendientes > 1 ? 's' : ''} pendiente
            {frescosPendientes > 1 ? 's' : ''} de porcionar
          </p>
        )}
      </div>

      {botones.map((b) => (
        <button
          key={b.vista}
          onClick={() => onIr(b.vista)}
          className={cn(
            'w-full rounded-lg py-4 text-base font-semibold text-white shadow transition-transform active:scale-[0.98]',
            b.color,
          )}
        >
          {b.label}
        </button>
      ))}

      {masasAbiertas > 0 && (
        <button
          onClick={() => onIr('cerrar-masa')}
          className="w-full rounded-lg border-2 border-amber-500 py-4 text-base font-semibold text-amber-700 transition-transform active:scale-[0.98]"
        >
          Cerrar Masa
        </button>
      )}

      <p className="mt-6 text-center text-[10px] text-gray-400">
        Rodziny ERP · Carga de producción
      </p>
    </div>
  );
}

// ── Formulario Relleno ─────────────────────────────────────────────────────────

function FormRelleno({
  local,
  recetas,
  recetaIdsPlan,
  onGuardado,
  onVolver,
}: {
  local: string;
  recetas: Receta[];
  recetaIdsPlan?: Set<string>;
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const hayPlan = (recetaIdsPlan?.size ?? 0) > 0;
  const [verTodas, setVerTodas] = useState(!hayPlan);
  const recetasVisibles = useMemo(() => {
    if (verTodas || !recetaIdsPlan || recetaIdsPlan.size === 0) return recetas;
    return recetas.filter((r) => recetaIdsPlan.has(r.id));
  }, [recetas, recetaIdsPlan, verTodas]);

  const [recetaId, setRecetaId] = useState(recetasVisibles[0]?.id ?? '');
  const [cantRecetas, setCantRecetas] = useState('1');
  const [pesoKg, setPesoKg] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Si el usuario cambia de filtrado (plan <-> todas) y la receta seleccionada
  // ya no está en la lista, resetea al primero disponible.
  useEffect(() => {
    if (recetaId && !recetasVisibles.some((r) => r.id === recetaId)) {
      setRecetaId(recetasVisibles[0]?.id ?? '');
    }
  }, [recetasVisibles, recetaId]);

  const recetaSel = recetas.find((r) => r.id === recetaId);
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), []);

  async function guardar() {
    if (!recetaId) {
      setError('Seleccioná una receta');
      return;
    }
    if (!pesoKg || Number(pesoKg) <= 0) {
      setError('Indicá el peso total');
      return;
    }
    setGuardando(true);
    setError('');

    const { error: err } = await supabase.from('cocina_lotes_relleno').insert({
      receta_id: recetaId,
      fecha: hoy(),
      cantidad_recetas: Number(cantRecetas) || 1,
      peso_total_kg: Number(pesoKg),
      responsable: responsable.trim() || null,
      local,
      notas: notas.trim() || null,
      ingredientes_reales: ingredientesReales.length > 0 ? ingredientesReales : null,
    });

    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onGuardado(`Relleno "${recetaSel?.nombre ?? ''}" — ${pesoKg} kg`);
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cargar Relleno</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {hayPlan && (
          <div className="flex items-center justify-between rounded border border-rodziny-200 bg-rodziny-50 px-2.5 py-1.5 text-[11px]">
            <span className="font-medium text-rodziny-800">
              📋 {verTodas ? 'Catálogo completo' : `Plan de hoy · ${recetaIdsPlan?.size ?? 0} receta${(recetaIdsPlan?.size ?? 0) === 1 ? '' : 's'}`}
            </span>
            <button
              onClick={() => setVerTodas((v) => !v)}
              className="text-[11px] text-rodziny-700 underline"
            >
              {verTodas ? 'Volver al plan' : '¿No está? Ver todas'}
            </button>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Receta de relleno</label>
          <select
            value={recetaId}
            onChange={(e) => setRecetaId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
          >
            {recetasVisibles.length === 0 && <option value="">No hay recetas cargadas</option>}
            {recetasVisibles.map((r) => (
              <option key={r.id} value={r.id}>
                {recetaIdsPlan?.has(r.id) ? '📋 ' : ''}
                {r.nombre}
                {r.rendimiento_kg ? ` (${r.rendimiento_kg} ${unidadReceta(r)}/receta)` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Cant. recetas</label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={cantRecetas}
              onChange={(e) => setCantRecetas(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Peso total (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={pesoKg}
              onChange={(e) => setPesoKg(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
              placeholder="5.0"
            />
          </div>
        </div>

        <IngredientesGrilla
          recetaId={recetaId || null}
          onChange={onGrillaChange}
          multiplicador={Number(cantRecetas) || 1}
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Responsable</label>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="Nombre"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Notas (opcional)</label>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="Ej: relleno más espeso"
          />
        </div>
      </div>

      {error && <div className="rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full rounded-lg bg-green-600 py-3.5 text-sm font-semibold text-white shadow transition-transform hover:bg-green-700 active:scale-[0.98] disabled:opacity-50"
      >
        {guardando ? 'Guardando...' : 'Sumar relleno al depósito'}
      </button>
    </div>
  );
}

// ── Formulario Pasta ───────────────────────────────────────────────────────────

// Códigos de pasta que llevan muzzarella extra al armar (ñoquis rellenos ambos locales).
const PASTAS_CON_MUZZARELLA = new Set(['noqr', 'noqrsg']);

function FormPasta({
  local,
  productos,
  lotesRelleno,
  lotesMasa,
  pastaRecetas,
  onGuardado,
  onVolver,
}: {
  local: string;
  productos: Producto[];
  lotesRelleno: LoteRelleno[];
  lotesMasa: LoteMasa[];
  pastaRecetas: { pasta_id: string; receta_id: string }[];
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const [loteRellenoId, setLoteRellenoId] = useState('');
  const [productoId, setProductoId] = useState('');
  const [loteMasaId, setLoteMasaId] = useState('');
  const [masaKg, setMasaKg] = useState('');
  const [rellenoKg, setRellenoKg] = useState('');
  const [muzzarellaGramos, setMuzzarellaGramos] = useState('');
  const [cantidadCajones, setCantidadCajones] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Mapping invertido: receta_id -> Set de pasta_id
  const pastasPorReceta = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const pr of pastaRecetas) {
      const s = m.get(pr.receta_id) ?? new Set<string>();
      s.add(pr.pasta_id);
      m.set(pr.receta_id, s);
    }
    return m;
  }, [pastaRecetas]);

  // Mapping: pasta_id -> Set de receta_id (masas candidatas, etc.)
  const recetasPorPasta = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const pr of pastaRecetas) {
      const s = m.get(pr.pasta_id) ?? new Set<string>();
      s.add(pr.receta_id);
      m.set(pr.pasta_id, s);
    }
    return m;
  }, [pastaRecetas]);

  // Pastas candidatas según el relleno elegido
  const pastasCandidatas = useMemo<Producto[]>(() => {
    if (!loteRellenoId) {
      // Sin relleno: pastas que no tengan ninguna receta tipo relleno mapeada
      // (básicamente spaghetti/tagliatelles/ñoquis comunes), o sea, pastas donde
      // el único mapping son masas. Aproximamos mostrando pastas sin relleno mapeado
      // en pastaRecetas → las que tienen mapping pero ninguna receta es relleno.
      // Simplificación: dejamos que el operario elija libre entre todas las del local.
      return productos;
    }
    const lote = lotesRelleno.find((l) => l.id === loteRellenoId);
    if (!lote) return productos;
    const pastaIds = pastasPorReceta.get(lote.receta_id);
    if (!pastaIds || pastaIds.size === 0) {
      // Relleno sin mapping → mostrar todas las pastas (fallback)
      return productos;
    }
    return productos.filter((p) => pastaIds.has(p.id));
  }, [loteRellenoId, lotesRelleno, pastasPorReceta, productos]);

  // Auto-seleccionar pasta cuando hay un único candidato; si la selección actual
  // ya no matchea con los candidatos, se resetea.
  useEffect(() => {
    if (pastasCandidatas.length === 1 && productoId !== pastasCandidatas[0].id) {
      setProductoId(pastasCandidatas[0].id);
    } else if (pastasCandidatas.length > 1 && !pastasCandidatas.some((p) => p.id === productoId)) {
      setProductoId('');
    } else if (pastasCandidatas.length === 0) {
      setProductoId('');
    }
  }, [pastasCandidatas, productoId]);

  // Masas candidatas según la pasta elegida
  const masasFiltradas = useMemo<LoteMasa[]>(() => {
    if (!productoId) return lotesMasa;
    const recetasOk = recetasPorPasta.get(productoId);
    if (!recetasOk || recetasOk.size === 0) {
      // Pasta sin mapping de masa (ej: tagliatelles mixtos) → mostrar todas
      return lotesMasa;
    }
    const filtradas = lotesMasa.filter((m) => m.receta_id && recetasOk.has(m.receta_id));
    return filtradas.length > 0 ? filtradas : lotesMasa;
  }, [productoId, lotesMasa, recetasPorPasta]);

  const prodSel = productos.find((p) => p.id === productoId);
  const codigoLote = prodSel ? `${prodSel.codigo}-${formatDDMM(hoy())}` : '';
  const esConMuzzarella = prodSel ? PASTAS_CON_MUZZARELLA.has(prodSel.codigo) : false;
  const rellenoSel = lotesRelleno.find((l) => l.id === loteRellenoId);

  async function guardar() {
    if (!productoId) {
      setError('Seleccioná qué pasta estás armando');
      return;
    }
    if (esConMuzzarella && (!muzzarellaGramos || Number(muzzarellaGramos) <= 0)) {
      setError('Cargá los gramos de muzzarella usados');
      return;
    }
    setGuardando(true);
    setError('');

    const { error: err } = await supabase.from('cocina_lotes_pasta').insert({
      producto_id: productoId,
      lote_relleno_id: loteRellenoId || null,
      lote_masa_id: loteMasaId || null,
      fecha: hoy(),
      codigo_lote: codigoLote,
      receta_masa_id: lotesMasa.find((m) => m.id === loteMasaId)?.receta_id ?? null,
      masa_kg: masaKg ? Number(masaKg) : null,
      relleno_kg: rellenoKg ? Number(rellenoKg) : null,
      muzzarella_gramos: esConMuzzarella && muzzarellaGramos ? Number(muzzarellaGramos) : null,
      porciones: null,
      cantidad_cajones: cantidadCajones ? Number(cantidadCajones) : null,
      ubicacion: 'freezer_produccion',
      responsable: responsable.trim() || null,
      local,
      notas: notas.trim() || null,
    });

    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onGuardado(
      `${prodSel?.nombre ?? 'Pasta'} armada — ${cantidadCajones || '?'} bandejas en freezer (${codigoLote})`,
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Armar Pasta</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        Las pastas armadas quedan en bandejas en el freezer de producción. Al día siguiente las
        porcionás en bolsitas de 200g y pasan a la cámara de congelado (cajones).
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {/* Paso 1 — Relleno disponible */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            1) Relleno disponible
          </label>
          <select
            value={loteRellenoId}
            onChange={(e) => {
              const id = e.target.value;
              setLoteRellenoId(id);
              const l = lotesRelleno.find((x) => x.id === id);
              if (l && l.disponible_kg != null) setRellenoKg(String(l.disponible_kg));
              else if (!id) setRellenoKg('');
            }}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
          >
            <option value="">Sin relleno (pasta simple)</option>
            {lotesRelleno.map((l) => {
              const esDeHoy = l.fecha === hoy();
              const fechaSufijo = esDeHoy ? '' : ` (${formatDDMM(l.fecha)})`;
              return (
                <option key={l.id} value={l.id}>
                  {l.receta?.nombre ?? 'Relleno'}
                  {fechaSufijo} — {l.disponible_kg ?? l.peso_total_kg} kg disponibles
                </option>
              );
            })}
          </select>
        </div>

        {/* Paso 2 — Pasta (auto o manual) */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            2) Pasta a armar
            {pastasCandidatas.length === 1 && (
              <span className="ml-1 text-[10px] font-normal text-green-600">
                · autocompletada
              </span>
            )}
          </label>
          <select
            value={productoId}
            onChange={(e) => setProductoId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
          >
            {pastasCandidatas.length === 0 && (
              <option value="">Sin pastas disponibles para este local</option>
            )}
            {pastasCandidatas.length > 1 && <option value="">Elegí la pasta…</option>}
            {pastasCandidatas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          {rellenoSel && pastasCandidatas.length === 0 && (
            <p className="mt-1 text-[10px] text-amber-600">
              No hay pastas mapeadas a "{rellenoSel.receta?.nombre}". Mostrando todas.
            </p>
          )}
        </div>

        {codigoLote && (
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-center">
            <span className="block text-[10px] text-gray-500">Código de lote</span>
            <span className="font-mono font-bold text-gray-900">{codigoLote}</span>
          </div>
        )}

        {/* Paso 3 — Masa */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            3) Masa disponible
          </label>
          <select
            value={loteMasaId}
            onChange={(e) => {
              const id = e.target.value;
              setLoteMasaId(id);
              const m = lotesMasa.find((x) => x.id === id);
              if (m && m.disponible_kg != null) setMasaKg(String(m.disponible_kg));
              else if (!id) setMasaKg('');
            }}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
          >
            <option value="">Sin lote de masa</option>
            {masasFiltradas.map((m) => {
              const esDeHoy = m.fecha === hoy();
              const fechaSufijo = esDeHoy ? '' : ` (${formatDDMM(m.fecha)})`;
              return (
                <option key={m.id} value={m.id}>
                  {m.receta?.nombre ?? 'Masa'}
                  {fechaSufijo} — {m.disponible_kg ?? m.kg_producidos} kg disponibles
                </option>
              );
            })}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Masa (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={masaKg}
              onChange={(e) => setMasaKg(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            />
            {(() => {
              const m = lotesMasa.find((x) => x.id === loteMasaId);
              const disp = m?.disponible_kg ?? null;
              const v = parseFloat(masaKg.replace(',', '.')) || 0;
              if (disp != null && v > disp + 0.01) {
                return (
                  <p className="mt-1 text-[10px] text-amber-600">
                    ⚠ Excede el disponible del lote ({disp} kg)
                  </p>
                );
              }
              return null;
            })()}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Relleno (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={rellenoKg}
              onChange={(e) => setRellenoKg(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
              disabled={!loteRellenoId}
            />
            {(() => {
              const r = lotesRelleno.find((x) => x.id === loteRellenoId);
              const disp = r?.disponible_kg ?? null;
              const v = parseFloat(rellenoKg.replace(',', '.')) || 0;
              if (disp != null && v > disp + 0.01) {
                return (
                  <p className="mt-1 text-[10px] text-amber-600">
                    ⚠ Excede el disponible del lote ({disp} kg)
                  </p>
                );
              }
              return null;
            })()}
          </div>
        </div>

        {esConMuzzarella && (
          <div className="rounded border border-yellow-200 bg-yellow-50 p-3">
            <label className="mb-1 block text-xs font-medium text-yellow-900">
              Muzzarella usada (gramos)
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={muzzarellaGramos}
              onChange={(e) => setMuzzarellaGramos(e.target.value)}
              className="w-full rounded border border-yellow-300 bg-white px-3 py-2.5 text-sm"
              placeholder="500"
            />
            {muzzarellaGramos && Number(muzzarellaGramos) > 0 && (
              <p className="mt-1 text-[10px] text-yellow-800">
                ≈ {(Number(muzzarellaGramos) / 1000).toFixed(2).replace('.', ',')} kg
              </p>
            )}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Bandejas armadas</label>
          <input
            type="number"
            inputMode="numeric"
            value={cantidadCajones}
            onChange={(e) => setCantidadCajones(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="3"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Las porciones finales se registran al porcionar las pastas al día siguiente.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Responsable</label>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="Nombre"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Notas (opcional)</label>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
          />
        </div>
      </div>

      {error && <div className="rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full rounded-lg bg-rodziny-700 py-3.5 text-sm font-semibold text-white shadow transition-transform hover:bg-rodziny-800 active:scale-[0.98] disabled:opacity-50"
      >
        {guardando ? 'Guardando...' : 'Registrar armado en freezer'}
      </button>
    </div>
  );
}

// ── Formulario Porcionar ───────────────────────────────────────────────────────

function FormPorcionar({
  local,
  lotesFrescos,
  sobrantesPendientes,
  onGuardado,
  onVolver,
}: {
  local: string;
  lotesFrescos: LotePastaFresco[];
  sobrantesPendientes: SobrantePendiente[];
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const [loteId, setLoteId] = useState(lotesFrescos[0]?.id ?? '');
  const [porcionesReales, setPorcionesReales] = useState('');
  const [sobranteGramos, setSobranteGramos] = useState('');
  const [usarSobranteId, setUsarSobranteId] = useState<string | null>(null);
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const loteSel = lotesFrescos.find((l) => l.id === loteId);
  const estimadas = loteSel?.porciones ?? null;
  const reales = Number(porcionesReales) || 0;
  const diferencia = estimadas != null ? reales - estimadas : null;

  // Sobrante disponible del producto que estoy porcionando hoy.
  // Solo muestro el más reciente (debería haber 1 por producto en condiciones normales).
  const sobranteDisponible = useMemo(() => {
    if (!loteSel) return null;
    return (
      sobrantesPendientes
        .filter((s) => s.producto_id === loteSel.producto_id && s.id !== loteSel.id)
        .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0] ?? null
    );
  }, [sobrantesPendientes, loteSel]);

  // Si cambio de lote y el sobrante ya no aplica, lo deselecciono.
  useEffect(() => {
    if (usarSobranteId && (!sobranteDisponible || sobranteDisponible.id !== usarSobranteId)) {
      setUsarSobranteId(null);
    }
  }, [sobranteDisponible, usarSobranteId]);

  async function guardar() {
    if (!loteId || !loteSel) {
      setError('Elegí un lote');
      return;
    }
    if (!porcionesReales || reales <= 0) {
      setError('Indicá las porciones reales obtenidas');
      return;
    }
    setGuardando(true);
    setError('');

    // El QR es público (anon) y RLS bloquea UPDATE directo a cocina_lotes_pasta.
    // El RPC SECURITY DEFINER es el único punto de entrada válido para porcionar.
    const merma = diferencia != null && diferencia < 0 ? Math.abs(diferencia) : 0;
    const sobrante = sobranteGramos ? Number(sobranteGramos) : null;
    const { error: err } = await supabase.rpc('porcionar_pasta_lote', {
      p_lote_id: loteId,
      p_porciones: reales,
      p_responsable: responsable.trim() || null,
      p_sobrante_gramos: sobrante && sobrante > 0 ? sobrante : null,
      p_sobrante_origen_lote_id: usarSobranteId,
      p_merma_porcionado: merma,
      p_notas: notas.trim() || null,
    });

    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }

    const nombre = loteSel.producto?.nombre ?? 'Pasta';
    const partes: string[] = [`${reales} porciones`];
    if (merma > 0) partes.push(`merma ${merma}`);
    else if (diferencia != null && diferencia > 0) partes.push(`+${diferencia} vs estimado`);
    if (sobrante && sobrante > 0) partes.push(`sobrante ${sobrante}g`);
    onGuardado(`${nombre} porcionada — ${partes.join(' · ')}`);
  }

  if (lotesFrescos.length === 0) {
    return (
      <div className="mt-2 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Porcionar Pasta</h2>
          <button onClick={onVolver} className="text-xs text-gray-500 underline">
            Volver
          </button>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No hay bandejas pendientes de porcionar en {local}.
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Porcionar Pasta</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        Porcioná las pastas en bolsitas de 200g y pasan a la cámara de congelado. Si hay diferencia
        con lo estimado queda registrado como merma automática.
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Lote a porcionar</label>
          <select
            value={loteId}
            onChange={(e) => setLoteId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
          >
            {lotesFrescos.map((l) => (
              <option key={l.id} value={l.id}>
                {l.codigo_lote} · {l.producto?.nombre ?? 'Pasta'}
                {l.cantidad_cajones ? ` · ${l.cantidad_cajones} band.` : ''}
              </option>
            ))}
          </select>
        </div>

        {loteSel && (
          <div className="space-y-0.5 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <div>Armado: {loteSel.fecha}</div>
            {loteSel.cantidad_cajones && <div>Bandejas: {loteSel.cantidad_cajones}</div>}
            {estimadas != null && (
              <div>
                Estimado: <span className="font-semibold">{estimadas}</span> porciones
              </div>
            )}
          </div>
        )}

        {sobranteDisponible && (
          <div className="flex items-start justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
            <div className="flex-1">
              <div className="font-semibold text-amber-900">
                💡 Sobrante del porcionado anterior
              </div>
              <div className="text-amber-800">
                Quedaron <span className="font-semibold">{sobranteDisponible.sobrante_gramos}g</span>{' '}
                del lote <span className="font-mono">{sobranteDisponible.codigo_lote}</span> (
                {formatDDMM(sobranteDisponible.fecha)})
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setUsarSobranteId(usarSobranteId === sobranteDisponible.id ? null : sobranteDisponible.id)
              }
              className={cn(
                'shrink-0 rounded px-2 py-1 text-[11px] font-medium',
                usarSobranteId === sobranteDisponible.id
                  ? 'bg-amber-600 text-white hover:bg-amber-700'
                  : 'border border-amber-300 bg-white text-amber-800 hover:bg-amber-100',
              )}
            >
              {usarSobranteId === sobranteDisponible.id ? '✓ Sumado' : 'Sumar'}
            </button>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Porciones totales (bolsitas 200g)
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={porcionesReales}
            onChange={(e) => setPorcionesReales(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
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
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Sobrante (g)
            <span className="ml-1 font-normal text-gray-400">— opcional</span>
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={sobranteGramos}
            onChange={(e) => setSobranteGramos(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="Ej: 70"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Gramos que no alcanzaron para una bolsita. Quedan reservados para el próximo
            porcionado de esta misma pasta.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Responsable</label>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="Nombre"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Notas (opcional)</label>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="Ej: hubo rotura de bolsas"
          />
        </div>
      </div>

      {error && <div className="rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full rounded-lg bg-blue-600 py-3.5 text-sm font-semibold text-white shadow transition-transform hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50"
      >
        {guardando ? 'Guardando...' : 'Mover a cámara de congelado'}
      </button>
    </div>
  );
}

// ── Formulario Masa ───────────────────────────────────────────────────────────

function FormMasa({
  local,
  recetas,
  onGuardado,
  onVolver,
}: {
  local: string;
  recetas: Receta[];
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const [recetaId, setRecetaId] = useState(recetas[0]?.id ?? '');
  const [cantRecetas, setCantRecetas] = useState('1');
  const [kgProducidos, setKgProducidos] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const recetaSel = recetas.find((r) => r.id === recetaId);
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), []);

  async function guardar() {
    if (!recetaId) {
      setError('Seleccioná una receta');
      return;
    }
    if (!kgProducidos || Number(kgProducidos) <= 0) {
      setError('Indicá los kg producidos');
      return;
    }
    setGuardando(true);
    setError('');

    const { error: err } = await supabase.from('cocina_lotes_masa').insert({
      receta_id: recetaId,
      fecha: hoy(),
      kg_producidos: Number(kgProducidos),
      responsable: responsable.trim() || null,
      local,
      notas: notas.trim() || null,
      ingredientes_reales: ingredientesReales.length > 0 ? ingredientesReales : null,
    });

    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onGuardado(`Masa "${recetaSel?.nombre ?? ''}" — ${kgProducidos} kg`);
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cargar Masa</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Receta de masa</label>
          <select
            value={recetaId}
            onChange={(e) => setRecetaId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
          >
            {recetas.length === 0 && <option value="">No hay recetas de masa cargadas</option>}
            {recetas.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
                {r.rendimiento_kg ? ` (${r.rendimiento_kg} ${unidadReceta(r)}/receta)` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Cant. recetas</label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={cantRecetas}
              onChange={(e) => setCantRecetas(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Kg producidos</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={kgProducidos}
              onChange={(e) => setKgProducidos(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
              placeholder="10.0"
            />
          </div>
        </div>

        <IngredientesGrilla
          recetaId={recetaId || null}
          onChange={onGrillaChange}
          multiplicador={Number(cantRecetas) || 1}
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Responsable</label>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="Nombre"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Notas (opcional)</label>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="Ej: masa más hidratada"
          />
        </div>
      </div>

      {error && <div className="rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full rounded-lg bg-amber-500 py-3.5 text-sm font-semibold text-white shadow transition-transform hover:bg-amber-600 active:scale-[0.98] disabled:opacity-50"
      >
        {guardando ? 'Guardando...' : 'Sumar masa al depósito'}
      </button>
    </div>
  );
}

// ── Formulario Cerrar Masa ────────────────────────────────────────────────────

function FormCerrarMasa({
  lotesAbiertos,
  onGuardado,
  onVolver,
}: {
  lotesAbiertos: LoteMasa[];
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const [selectedId, setSelectedId] = useState(lotesAbiertos[0]?.id ?? '');
  const [kgSobrante, setKgSobrante] = useState('');
  const [destinoSobrante, setDestinoSobrante] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const masaSel = lotesAbiertos.find((m) => m.id === selectedId);

  async function guardar() {
    if (!selectedId) {
      setError('Seleccioná una masa');
      return;
    }
    if (kgSobrante === '' || Number(kgSobrante) < 0) {
      setError('Indicá el kg sobrante (0 si no queda)');
      return;
    }
    if (Number(kgSobrante) > 0 && !destinoSobrante) {
      setError('Indicá el destino del sobrante');
      return;
    }
    setGuardando(true);
    setError('');

    const sobrante = Number(kgSobrante);
    const { error: err } = await supabase
      .from('cocina_lotes_masa')
      .update({
        kg_sobrante: sobrante,
        destino_sobrante: sobrante > 0 ? destinoSobrante : null,
      })
      .eq('id', selectedId);

    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onGuardado(`Masa "${masaSel?.receta?.nombre ?? ''}" cerrada — ${kgSobrante} kg sobrante`);
  }

  if (lotesAbiertos.length === 0) {
    return (
      <div className="mt-2 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Cerrar Masa</h2>
          <button onClick={onVolver} className="text-xs text-gray-500 underline">
            Volver
          </button>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-sm text-gray-600">No hay masas abiertas para cerrar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cerrar Masa</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {lotesAbiertos.length > 1 ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Masa a cerrar</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            >
              {lotesAbiertos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.receta?.nombre ?? 'Masa'} — {m.kg_producidos} kg
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-center">
            <span className="block text-[10px] text-amber-600">Masa a cerrar</span>
            <span className="text-sm font-semibold text-amber-900">
              {masaSel?.receta?.nombre ?? 'Masa'} — {masaSel?.kg_producidos} kg
            </span>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Kg sobrante</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0}
            value={kgSobrante}
            onChange={(e) => setKgSobrante(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="0"
          />
        </div>

        {Number(kgSobrante) > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Destino del sobrante
            </label>
            <select
              value={destinoSobrante}
              onChange={(e) => setDestinoSobrante(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            >
              <option value="">Seleccionar...</option>
              <option value="fideos">Fideos (reutilizar)</option>
              <option value="merma">Merma (descartar)</option>
              <option value="proxima_masa">Próxima masa</option>
            </select>
          </div>
        )}
      </div>

      {error && <div className="rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full rounded-lg bg-amber-500 py-3.5 text-sm font-semibold text-white shadow transition-transform hover:bg-amber-600 active:scale-[0.98] disabled:opacity-50"
      >
        {guardando ? 'Guardando...' : 'Cerrar masa'}
      </button>
    </div>
  );
}

// ── Pantalla de éxito ──────────────────────────────────────────────────────────

function Exito({ mensaje, onOtro }: { mensaje: string; onOtro: () => void }) {
  return (
    <div className="mt-8 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <span className="text-3xl text-green-600">✓</span>
      </div>
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Registrado</h2>
      <p className="mb-6 text-sm text-gray-600">{mensaje}</p>
      <button
        onClick={onOtro}
        className="w-full rounded-lg bg-rodziny-700 py-4 text-base font-semibold text-white shadow transition-transform hover:bg-rodziny-800 active:scale-[0.98]"
      >
        Cargar otro
      </button>
      <p className="mt-4 text-[10px] text-gray-400">
        {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  );
}

// ── FormGenerico (salsa/postre/pasteleria/panaderia/prueba) ────────────────────

const CATEGORIA_LABEL: Record<CategoriaGenerica, string> = {
  salsa: 'Salsa',
  postre: 'Postre',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  prueba: 'Prueba',
};

function unidadesDisponibles(
  categoria: CategoriaGenerica,
  permitirLitros?: boolean,
): { value: 'kg' | 'unid' | 'lt'; label: string }[] {
  const base: { value: 'kg' | 'unid' | 'lt'; label: string }[] = [
    { value: 'kg', label: 'kg' },
    { value: 'unid', label: 'unid' },
  ];
  if (permitirLitros || categoria === 'salsa' || categoria === 'prueba') {
    base.push({ value: 'lt', label: 'lt' });
  }
  return base;
}

function FormGenerico({
  local,
  categoria,
  recetas,
  recetaIdsPlan,
  permitirLibre,
  permitirLitros,
  onGuardado,
  onVolver,
}: {
  local: string;
  categoria: CategoriaGenerica;
  recetas: Receta[];
  recetaIdsPlan?: Set<string>;
  permitirLibre?: boolean;
  permitirLitros?: boolean;
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const hayPlan = (recetaIdsPlan?.size ?? 0) > 0;
  const [verTodas, setVerTodas] = useState(!hayPlan);
  const recetasVisibles = useMemo(() => {
    if (verTodas || !recetaIdsPlan || recetaIdsPlan.size === 0) return recetas;
    return recetas.filter((r) => recetaIdsPlan.has(r.id));
  }, [recetas, recetaIdsPlan, verTodas]);

  const [recetaId, setRecetaId] = useState('');

  useEffect(() => {
    if (recetaId && !recetasVisibles.some((r) => r.id === recetaId)) {
      setRecetaId('');
    }
  }, [recetasVisibles, recetaId]);
  const [nombreLibre, setNombreLibre] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [unidad, setUnidad] = useState<'kg' | 'unid' | 'lt'>(
    categoria === 'salsa'
      ? 'kg'
      : categoria === 'postre' || categoria === 'pasteleria' || categoria === 'panaderia'
        ? 'unid'
        : 'kg',
  );
  const [merma, setMerma] = useState('');
  const [mermaMotivo, setMermaMotivo] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([]);
  const [enStock, setEnStock] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), []);

  const recetaSel = recetas.find((r) => r.id === recetaId);
  const unidades = unidadesDisponibles(categoria, permitirLitros);
  const titulo = `Cargar ${CATEGORIA_LABEL[categoria]}`;

  async function guardar() {
    if (!recetaId && !(permitirLibre && nombreLibre.trim())) {
      setError('Seleccioná una receta o escribí el nombre');
      return;
    }
    if (!cantidad || Number(cantidad) <= 0) {
      setError('Indicá la cantidad producida');
      return;
    }
    setGuardando(true);
    setError('');

    const { error: err } = await supabase.from('cocina_lotes_produccion').insert({
      fecha: hoy(),
      local,
      categoria,
      receta_id: recetaId || null,
      nombre_libre: permitirLibre && !recetaId ? nombreLibre.trim() : null,
      cantidad_producida: Number(cantidad),
      unidad,
      merma_cantidad: merma ? Number(merma) : null,
      merma_motivo: mermaMotivo.trim() || null,
      responsable: responsable.trim() || null,
      notas: notas.trim() || null,
      ingredientes_reales: ingredientesReales.length > 0 ? ingredientesReales : null,
      en_stock: enStock,
    });

    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    const nombre = recetaSel?.nombre ?? nombreLibre.trim() ?? CATEGORIA_LABEL[categoria];
    onGuardado(`${CATEGORIA_LABEL[categoria]} "${nombre}" — ${cantidad} ${unidad}`);
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {recetas.length === 0 && !permitirLibre && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <p className="mb-1 font-semibold">
              No hay recetas disponibles para {CATEGORIA_LABEL[categoria]} en este local.
            </p>
            <p>
              Pedile al admin que asigne recetas con tipo adecuado y local ={' '}
              <span className="font-mono">{local}</span>.
            </p>
          </div>
        )}
        {hayPlan && (
          <div className="flex items-center justify-between rounded border border-rodziny-200 bg-rodziny-50 px-2.5 py-1.5 text-[11px]">
            <span className="font-medium text-rodziny-800">
              📋 {verTodas ? 'Catálogo completo' : `Plan de hoy · ${recetaIdsPlan?.size ?? 0} receta${(recetaIdsPlan?.size ?? 0) === 1 ? '' : 's'}`}
            </span>
            <button
              onClick={() => setVerTodas((v) => !v)}
              className="text-[11px] text-rodziny-700 underline"
            >
              {verTodas ? 'Volver al plan' : '¿No está? Ver todas'}
            </button>
          </div>
        )}
        {recetasVisibles.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Receta</label>
            <select
              value={recetaId}
              onChange={(e) => setRecetaId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            >
              <option value="">— Elegir receta —</option>
              {recetasVisibles.map((r) => (
                <option key={r.id} value={r.id}>
                  {recetaIdsPlan?.has(r.id) ? '📋 ' : ''}
                  {r.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        {permitirLibre && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              {recetaId ? 'O escribí un nombre libre (opcional)' : 'Nombre de la prueba'}
            </label>
            <input
              value={nombreLibre}
              onChange={(e) => setNombreLibre(e.target.value)}
              placeholder="Ej: ravioles de calabaza"
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
              disabled={!!recetaId}
            />
          </div>
        )}

        <IngredientesGrilla recetaId={recetaId || null} onChange={onGrillaChange} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Cantidad</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Unidad</label>
            <select
              value={unidad}
              onChange={(e) => setUnidad(e.target.value as 'kg' | 'unid' | 'lt')}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            >
              {unidades.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Merma (opcional)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              value={merma}
              onChange={(e) => setMerma(e.target.value)}
              placeholder={`0 ${unidad}`}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Motivo de merma</label>
            <input
              value={mermaMotivo}
              onChange={(e) => setMermaMotivo(e.target.value)}
              placeholder="Ej: se cortó"
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Responsable</label>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            placeholder="Nombre de quien produjo"
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Notas (opcional)</label>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <input
            type="checkbox"
            checked={enStock}
            onChange={(e) => setEnStock(e.target.checked)}
            className="h-4 w-4 accent-rodziny-700"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-800">Cargar a stock</p>
            <p className="text-[10px] text-gray-500">
              {enStock
                ? 'Este lote queda disponible para venta/servicio'
                : 'Solo se registra como producción, no cuenta para stock'}
            </p>
          </div>
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full rounded-lg bg-rodziny-700 py-3 text-sm font-semibold text-white hover:bg-rodziny-800 disabled:opacity-50"
        >
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
