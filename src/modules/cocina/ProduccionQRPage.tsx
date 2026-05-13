import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';
import { cn } from '@/lib/utils';
import { IngredientesGrilla, type IngredienteReal } from './components/IngredientesGrilla';
import { TrasladoPastasForm } from '@/modules/compras/components/TrasladoPastasForm';
import { useCierresFaltantes } from './hooks/useCierresFaltantes';

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

// Parse decimal aceptando coma o punto como separador. Devuelve 0 si vacío/inválido.
// Necesario porque type="text" + pattern permite ambos separadores y los teclados de
// algunos Android en español sólo muestran ",".
function parseDecimal(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Normaliza el input que tipea el operario: cualquier "." se transforma en "," al
// instante, deja solo una coma decimal y descarta caracteres no numéricos. El
// cocinero ve siempre formato es-AR ("8,9") aunque haya tipeado "8.9" con teclado
// internacional — elimina la ambigüedad punto-decimal / punto-de-miles.
function normalizarDecimal(v: string): string {
  let s = v.replace(/\./g, ',').replace(/[^0-9,]/g, '');
  const i = s.indexOf(',');
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/,/g, '');
  return s;
}

const NUM_FMT = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
function formatNum(n: number): string {
  return NUM_FMT.format(n);
}

// Equivalente "humano" para kg: "8,9 kg = 8 kilos 900 g". Útil como sanity check
// visual cuando el operario tipea con decimales — si quiso 8,9 y puso 8,993, el
// "= 8 kilos 993 g" hace evidente el typo antes de guardar.
function equivalenteKgGramos(n: number): string | null {
  if (!isFinite(n) || n <= 0) return null;
  const totalG = Math.round(n * 1000);
  const kilos = Math.floor(totalG / 1000);
  const gramos = totalG - kilos * 1000;
  if (kilos === 0) return `${gramos} g`;
  if (gramos === 0) return `${kilos} ${kilos === 1 ? 'kilo' : 'kilos'} justos`;
  return `${kilos} ${kilos === 1 ? 'kilo' : 'kilos'} ${gramos} g`;
}
interface LoteRelleno {
  id: string;
  receta_id: string;
  peso_total_kg: number;
  local: string;
  fecha: string;
  receta?: {
    nombre: string;
    g_semolin_por_kg: number | null;
    g_huevo_por_kg: number | null;
  } | null;
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
  | 'merma'
  | 'traslado'
  | 'exito';

type CategoriaGenerica = 'salsa' | 'postre' | 'pasteleria' | 'panaderia';

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

  // Plan del día: items vigentes del pizarrón para hoy + local (incluye hechos
  // así el QR sigue priorizando lo planificado aunque ya esté cumplido).
  // Además trae carry-overs de días previos que quedaron sin cerrar (estado
  // pendiente / en_produccion) — caso típico: se planifica relleno para hoy
  // pero se lo termina mañana, y mañana el cocinero necesita verlo en el QR
  // para registrar el lote contra ese plan.
  const { data: planHoy } = useQuery({
    queryKey: ['cocina-plan-hoy-qr', local, hoy()],
    queryFn: async () => {
      const fHoy = hoy();
      const fDesde = fechaHaceDias(DIAS_VENTANA_LOTES_ABIERTOS);
      const { data, error } = await supabase
        .from('cocina_pizarron_items')
        .select('tipo, receta_id, cantidad_recetas, estado, fecha_objetivo')
        .eq('local', local)
        .gte('fecha_objetivo', fDesde)
        .lte('fecha_objetivo', fHoy)
        .neq('estado', 'cancelado');
      if (error) throw error;
      const rows = data as Array<{
        tipo: 'relleno' | 'masa' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia';
        receta_id: string | null;
        cantidad_recetas: number | null;
        estado: string;
        fecha_objetivo: string;
      }>;
      // Hoy: cualquier estado != cancelado. Días previos: solo si todavía
      // está abierto (pendiente / en_produccion). Los ciclo_completo y
      // en_bandejas ya dejaron lote en DB y no necesitan re-aparecer.
      return rows.filter(
        (it) =>
          it.fecha_objetivo === fHoy ||
          it.estado === 'pendiente' ||
          it.estado === 'en_produccion',
      );
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
        .select(
          'id, receta_id, peso_total_kg, fecha, local, receta:cocina_recetas(nombre, g_semolin_por_kg, g_huevo_por_kg)',
        )
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
        .select('pasta_id, receta_id, receta:cocina_recetas(tipo)');
      if (error) throw error;
      return (data ?? []) as unknown as {
        pasta_id: string;
        receta_id: string;
        receta: { tipo: string } | { tipo: string }[] | null;
      }[];
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

  // Plan del día: por receta acumulamos cuántas recetas pidió el chef
  // (si hay varios items para la misma receta, se suman). Se usa para
  // filtrar el dropdown y mostrar "N recetas planificadas" en cada opción.
  const planPorTipo = useMemo(() => {
    const m: Record<'relleno' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia', Map<string, number>> = {
      relleno: new Map(),
      salsa: new Map(),
      postre: new Map(),
      pasteleria: new Map(),
      panaderia: new Map(),
    };
    for (const it of planHoy ?? []) {
      if (!it.receta_id) continue;
      if (it.tipo in m) {
        const map = m[it.tipo as keyof typeof m];
        const cant = Number(it.cantidad_recetas) || 1;
        map.set(it.receta_id, (map.get(it.receta_id) ?? 0) + cant);
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
    // Invalidar el stock derivado del Dashboard del chef para que se actualice
    // sin esperar al refetch periódico cuando QR y Dashboard están en la misma pestaña.
    qc.invalidateQueries({ queryKey: ['cocina_stock_pastas'] });
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

      {vista === 'merma' && (
        <FormMerma
          local={local}
          productos={productos ?? []}
          recetas={recetas ?? []}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'traslado' && (
        <TrasladoPastasForm
          local={local}
          onGuardado={(msg) => onGuardado(msg)}
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
  const { faltantes: cierresFaltantes } = useCierresFaltantes(local, supabase);

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
      {cierresFaltantes.length > 0 && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 p-3">
          <p className="text-sm font-bold text-red-800">⚠️ Falta cierre de turno</p>
          <ul className="mt-1 ml-1 text-xs text-red-700">
            {cierresFaltantes.map((c, i) => (
              <li key={i}>· {c.label}</li>
            ))}
          </ul>
          <a
            href={`/mostrador?local=${local}`}
            className="mt-2 block w-full rounded bg-red-600 py-2 text-center text-sm font-semibold text-white hover:bg-red-700"
          >
            Ir al cierre →
          </a>
        </div>
      )}

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

      <div className="pt-2">
        <button
          onClick={() => onIr('traslado')}
          className="w-full rounded-lg border-2 border-blue-700 bg-blue-600 py-3 text-sm font-semibold text-white transition-transform active:scale-[0.98]"
        >
          🚚 Trasladar a mostrador
        </button>
      </div>

      <div className="pt-2">
        <a
          href={`/mostrador?local=${local}`}
          className="block w-full rounded-lg border-2 border-gray-700 bg-gray-800 py-3 text-center text-sm font-semibold text-white transition-transform active:scale-[0.98]"
        >
          🧾 Cierre de turno
        </a>
      </div>

      <div className="pt-2">
        <button
          onClick={() => onIr('merma')}
          className="w-full rounded-lg border-2 border-red-300 bg-red-50 py-3 text-sm font-semibold text-red-700 transition-transform active:scale-[0.98]"
        >
          Registrar Merma
        </button>
      </div>

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
  recetaIdsPlan?: Map<string, number>;
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
  const [cantRecetas, setCantRecetas] = useState(() => {
    const id = recetasVisibles[0]?.id;
    const planeada = id ? recetaIdsPlan?.get(id) : undefined;
    return planeada ? String(planeada) : '1';
  });
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

  // Al cambiar de receta, si está en el plan auto-rellena cantRecetas con la
  // cantidad que pidió el chef (ej. si planeó 2 recetas, arranca con 2).
  useEffect(() => {
    if (!recetaId) return;
    const planeada = recetaIdsPlan?.get(recetaId);
    if (planeada) setCantRecetas(String(planeada));
  }, [recetaId, recetaIdsPlan]);

  const recetaSel = recetas.find((r) => r.id === recetaId);
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), []);

  async function guardar() {
    if (!recetaId) {
      setError('Seleccioná una receta');
      return;
    }
    if (!pesoKg || parseDecimal(pesoKg) <= 0) {
      setError('Indicá el peso total');
      return;
    }
    if (!responsable.trim()) {
      setError('Indicá tu nombre (responsable)');
      return;
    }
    setGuardando(true);
    setError('');

    const { error: err } = await supabase.from('cocina_lotes_relleno').insert({
      receta_id: recetaId,
      fecha: hoy(),
      cantidad_recetas: Number(cantRecetas) || 1,
      peso_total_kg: parseDecimal(pesoKg),
      responsable: responsable.trim(),
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
        {hayPlan ? (
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
        ) : (
          <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
            ⚠️ Sin plan cargado para hoy · mostrando catálogo completo
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
            {recetasVisibles.map((r) => {
              const planeada = recetaIdsPlan?.get(r.id);
              return (
                <option key={r.id} value={r.id}>
                  {planeada ? '📋 ' : ''}
                  {r.nombre}
                  {planeada
                    ? ` · ${planeada} receta${planeada === 1 ? '' : 's'} planificada${planeada === 1 ? '' : 's'}`
                    : r.rendimiento_kg
                      ? ` (${r.rendimiento_kg} ${unidadReceta(r)}/receta)`
                      : ''}
                </option>
              );
            })}
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
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              value={pesoKg}
              onChange={(e) => setPesoKg(normalizarDecimal(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
              placeholder="Ej: 5,2"
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
  pastaRecetas: {
    pasta_id: string;
    receta_id: string;
    receta: { tipo: string } | { tipo: string }[] | null;
  }[];
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const [loteRellenoId, setLoteRellenoId] = useState('');
  const [productoId, setProductoId] = useState('');
  const [loteMasaId, setLoteMasaId] = useState('');
  const [masaKg, setMasaKg] = useState('');
  const [rellenoKg, setRellenoKg] = useState('');
  const [muzzarellaGramos, setMuzzarellaGramos] = useState('');
  const [semolinGramos, setSemolinGramos] = useState('');
  const [huevoGramos, setHuevoGramos] = useState('');
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

  // Pastas que admiten relleno: tienen al menos una receta tipo='relleno' mapeada.
  // Las demás (tagliatelles, fettuccine, spaghetti) son fideos y NO permiten elegir
  // relleno — al seleccionarlas se resetea el dropdown.
  const pastasConRelleno = useMemo(() => {
    const s = new Set<string>();
    for (const pr of pastaRecetas) {
      // Supabase devuelve el join como objeto o array según la cardinalidad detectada
      const r = Array.isArray(pr.receta) ? pr.receta[0] : pr.receta;
      if (r?.tipo === 'relleno') s.add(pr.pasta_id);
    }
    return s;
  }, [pastaRecetas]);

  const productoSel = productos.find((p) => p.id === productoId);
  const productoAdmiteRelleno = productoSel ? pastasConRelleno.has(productoSel.id) : true;

  // Si elegí una pasta que NO admite relleno, limpiar el relleno seleccionado.
  useEffect(() => {
    if (productoId && !pastasConRelleno.has(productoId) && loteRellenoId) {
      setLoteRellenoId('');
    }
  }, [productoId, pastasConRelleno, loteRellenoId]);

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
  // Pastas sin relleno (tagliatelles, fettuccine, spaghetti...) no llevan
  // paso de porcionado posterior — el equipo arma y guarda en bolsitas en una
  // sola pasada. Entra directo a cámara con porciones cargadas.
  const esPastaSinRelleno = !loteRellenoId;

  // Si la receta del relleno define ratios (ej: puré de papa para ñoquis →
  // 350g semolín + 180g huevo por kg), sugerir los gramos a partir del
  // relleno_kg cargado. El operario puede sobreescribir.
  const ratioSemolinPorKg = rellenoSel?.receta?.g_semolin_por_kg ?? null;
  const ratioHuevoPorKg = rellenoSel?.receta?.g_huevo_por_kg ?? null;
  const requiereSemolinHuevo = ratioSemolinPorKg != null && ratioHuevoPorKg != null;

  useEffect(() => {
    if (!requiereSemolinHuevo) {
      setSemolinGramos('');
      setHuevoGramos('');
      return;
    }
    const kg = parseDecimal(rellenoKg);
    if (kg <= 0) {
      setSemolinGramos('');
      setHuevoGramos('');
      return;
    }
    setSemolinGramos(String(Math.round(kg * (ratioSemolinPorKg ?? 0))));
    setHuevoGramos(String(Math.round(kg * (ratioHuevoPorKg ?? 0))));
  }, [requiereSemolinHuevo, rellenoKg, ratioSemolinPorKg, ratioHuevoPorKg]);

  async function guardar() {
    if (!productoId) {
      setError('Seleccioná qué pasta estás armando');
      return;
    }
    if (requiereSemolinHuevo) {
      if (!semolinGramos || Number(semolinGramos) <= 0) {
        setError('Cargá los gramos de semolín agregados al puré');
        return;
      }
      if (!huevoGramos || Number(huevoGramos) <= 0) {
        setError('Cargá los gramos de huevo agregados al puré');
        return;
      }
    }
    if (!responsable.trim()) {
      setError('Indicá tu nombre (responsable)');
      return;
    }
    setGuardando(true);
    setError('');

    const cantidad = cantidadCajones ? Number(cantidadCajones) : null;
    const { error: err } = await supabase.from('cocina_lotes_pasta').insert({
      producto_id: productoId,
      lote_relleno_id: loteRellenoId || null,
      lote_masa_id: loteMasaId || null,
      fecha: hoy(),
      codigo_lote: codigoLote,
      receta_masa_id: lotesMasa.find((m) => m.id === loteMasaId)?.receta_id ?? null,
      masa_kg: masaKg ? parseDecimal(masaKg) : null,
      relleno_kg: rellenoKg ? parseDecimal(rellenoKg) : null,
      muzzarella_gramos: esConMuzzarella && muzzarellaGramos ? Number(muzzarellaGramos) : null,
      semolin_gramos: requiereSemolinHuevo && semolinGramos ? Number(semolinGramos) : null,
      huevo_gramos: requiereSemolinHuevo && huevoGramos ? Number(huevoGramos) : null,
      // Sin relleno (fideos): el campo ingresado son porciones (bolsitas 140g)
      // y va directo a cámara. Con relleno: el campo son bandejas pendientes
      // de porcionar al día siguiente (bolsitas 200g).
      porciones: esPastaSinRelleno ? cantidad : null,
      cantidad_cajones: esPastaSinRelleno ? null : cantidad,
      ubicacion: esPastaSinRelleno ? 'camara_congelado' : 'freezer_produccion',
      fecha_porcionado: esPastaSinRelleno ? hoy() : null,
      responsable_porcionado: esPastaSinRelleno ? responsable.trim() : null,
      responsable: responsable.trim(),
      local,
      notas: notas.trim() || null,
    });

    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onGuardado(
      esPastaSinRelleno
        ? `${prodSel?.nombre ?? 'Pasta'} — ${cantidadCajones || '?'} porciones en cámara (${codigoLote})`
        : `${prodSel?.nombre ?? 'Pasta'} armada — ${cantidadCajones || '?'} bandejas en freezer (${codigoLote})`,
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
        {esPastaSinRelleno
          ? 'Fideos (sin relleno): cargá las porciones (bolsitas 140g) que armaste. Van directo a la cámara de congelado.'
          : 'Las pastas armadas quedan en bandejas en el freezer de producción. Al día siguiente las porcionás en bolsitas de 200g y pasan a la cámara de congelado (cajones).'}
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {/* Paso 1 — Relleno disponible */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            1) Relleno disponible
          </label>
          <select
            value={loteRellenoId}
            disabled={!productoAdmiteRelleno}
            onChange={(e) => {
              const id = e.target.value;
              setLoteRellenoId(id);
              const l = lotesRelleno.find((x) => x.id === id);
              // Si la receta lleva semolín/huevo (puré de papa), no autocompletar:
              // el operario divide el puré entre los productos que va a armar y
              // tipea cuántos kg usa para esta bandeja específica.
              const llevaRatio =
                l?.receta?.g_semolin_por_kg != null && l?.receta?.g_huevo_por_kg != null;
              if (l && l.disponible_kg != null && !llevaRatio) {
                setRellenoKg(String(l.disponible_kg));
              } else if (!id || llevaRatio) {
                setRellenoKg('');
              }
            }}
            className={cn(
              'w-full rounded border border-gray-300 px-3 py-2.5 text-sm',
              !productoAdmiteRelleno && 'cursor-not-allowed bg-gray-100 text-gray-400',
            )}
          >
            <option value="">
              {productoAdmiteRelleno ? 'Sin relleno (pasta simple)' : 'No aplica para fideos'}
            </option>
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

        {/* Paso 3 — Masa (oculto cuando el relleno es puré: los ñoquis no llevan masa) */}
        {!requiereSemolinHuevo && (
          <>
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
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  value={masaKg}
                  onChange={(e) => setMasaKg(normalizarDecimal(e.target.value))}
                  className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
                />
                {(() => {
                  const m = lotesMasa.find((x) => x.id === loteMasaId);
                  const disp = m?.disponible_kg ?? null;
                  const v = parseDecimal(masaKg);
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
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Relleno (kg)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  value={rellenoKg}
                  onChange={(e) => setRellenoKg(normalizarDecimal(e.target.value))}
                  className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
                  disabled={!loteRellenoId}
                />
                {(() => {
                  const r = lotesRelleno.find((x) => x.id === loteRellenoId);
                  const disp = r?.disponible_kg ?? null;
                  const v = parseDecimal(rellenoKg);
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
          </>
        )}

        {/* Para ñoquis: un único campo "Puré a usar". El semolín y huevo se calculan
            sobre este valor (ver panel ámbar más abajo). */}
        {requiereSemolinHuevo && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Puré a usar (kg)
            </label>
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              value={rellenoKg}
              onChange={(e) => setRellenoKg(normalizarDecimal(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
              placeholder={
                rellenoSel?.disponible_kg != null
                  ? `Disponibles: ${rellenoSel.disponible_kg} kg`
                  : 'Cantidad de puré para esta bandeja'
              }
            />
            {(() => {
              const disp = rellenoSel?.disponible_kg ?? null;
              const v = parseDecimal(rellenoKg);
              if (disp != null && v > disp + 0.01) {
                return (
                  <p className="mt-1 text-[10px] text-amber-600">
                    ⚠ Excede el puré disponible ({disp} kg)
                  </p>
                );
              }
              if (disp != null && v > 0) {
                return (
                  <p className="mt-1 text-[10px] text-gray-500">
                    Disponibles: {disp} kg · usás {v} kg → quedan {(disp - v).toFixed(1)} kg
                  </p>
                );
              }
              return null;
            })()}
          </div>
        )}

        {requiereSemolinHuevo && (() => {
          const pureKg = parseDecimal(rellenoKg);
          const tienePure = pureKg > 0;
          const semolinSug =
            tienePure && ratioSemolinPorKg ? Math.round(pureKg * ratioSemolinPorKg) : null;
          const huevoSug =
            tienePure && ratioHuevoPorKg ? Math.round(pureKg * ratioHuevoPorKg) : null;
          const semolinReal = Number(semolinGramos);
          const huevoReal = Number(huevoGramos);
          const desvSem =
            semolinSug && semolinReal > 0 ? Math.abs(semolinReal - semolinSug) / semolinSug : 0;
          const desvHue =
            huevoSug && huevoReal > 0 ? Math.abs(huevoReal - huevoSug) / huevoSug : 0;
          const fueraDeRango = desvSem > 0.1 || desvHue > 0.1;
          return (
            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <p className="mb-2 text-[11px] text-amber-900">
                El puré lleva semolín y huevo: sugerencia automática a partir del puré usado
                ({ratioSemolinPorKg}g semolín + {ratioHuevoPorKg}g huevo por kg). Editable.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-amber-900">
                    Semolín (g)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={semolinGramos}
                    onChange={(e) => setSemolinGramos(e.target.value)}
                    className="w-full rounded border border-amber-300 bg-white px-3 py-2.5 text-sm"
                    placeholder="0"
                  />
                  {semolinSug != null && semolinReal > 0 && desvSem > 0.1 && (
                    <p className="mt-1 text-[10px] text-amber-700">
                      ⚠ Sugerido ~{semolinSug}g (±{Math.round(desvSem * 100)}%)
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-amber-900">
                    Huevo (g)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={huevoGramos}
                    onChange={(e) => setHuevoGramos(e.target.value)}
                    className="w-full rounded border border-amber-300 bg-white px-3 py-2.5 text-sm"
                    placeholder="0"
                  />
                  {huevoSug != null && huevoReal > 0 && desvHue > 0.1 && (
                    <p className="mt-1 text-[10px] text-amber-700">
                      ⚠ Sugerido ~{huevoSug}g (±{Math.round(desvHue * 100)}%)
                    </p>
                  )}
                </div>
              </div>
              {fueraDeRango && (
                <p className="mt-2 text-[11px] font-medium text-amber-800">
                  Los valores cargados se alejan más de 10% del ratio teórico. Confirmá que es
                  intencional antes de guardar.
                </p>
              )}
            </div>
          );
        })()}

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
            {muzzarellaGramos && Number(muzzarellaGramos) > 0 ? (
              <p className="mt-1 text-[10px] text-yellow-800">
                ≈ {(Number(muzzarellaGramos) / 1000).toFixed(2).replace('.', ',')} kg
              </p>
            ) : (
              <p className="mt-1 text-[11px] font-medium text-yellow-800">
                ⚠ Los ñoquis rellenos llevan muzzarella. Cargá los gramos antes de guardar.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {esPastaSinRelleno ? 'Porciones (bolsitas 140g)' : 'Bandejas armadas'}
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={cantidadCajones}
            onChange={(e) => setCantidadCajones(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder={esPastaSinRelleno ? '60' : '3'}
          />
          <p className="mt-1 text-[11px] text-gray-500">
            {esPastaSinRelleno
              ? 'Va directo a la cámara — no requiere porcionado posterior.'
              : 'Las porciones finales se registran al porcionar las pastas al día siguiente.'}
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
        {guardando
          ? 'Guardando...'
          : esPastaSinRelleno
            ? 'Registrar en cámara'
            : 'Registrar armado en freezer'}
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
    if (!responsable.trim()) {
      setError('Indicá tu nombre (responsable)');
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
      p_responsable: responsable.trim(),
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
    if (!kgProducidos || parseDecimal(kgProducidos) <= 0) {
      setError('Indicá los kg producidos');
      return;
    }
    if (!responsable.trim()) {
      setError('Indicá tu nombre (responsable)');
      return;
    }
    setGuardando(true);
    setError('');

    const { error: err } = await supabase.from('cocina_lotes_masa').insert({
      receta_id: recetaId,
      fecha: hoy(),
      kg_producidos: parseDecimal(kgProducidos),
      responsable: responsable.trim(),
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
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              value={kgProducidos}
              onChange={(e) => setKgProducidos(normalizarDecimal(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
              placeholder="Ej: 10,5"
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
    if (kgSobrante === '' || parseDecimal(kgSobrante) < 0) {
      setError('Indicá el kg sobrante (0 si no queda)');
      return;
    }
    if (parseDecimal(kgSobrante) > 0 && !destinoSobrante) {
      setError('Indicá el destino del sobrante');
      return;
    }
    setGuardando(true);
    setError('');

    const sobrante = parseDecimal(kgSobrante);
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
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.,]?[0-9]*"
            value={kgSobrante}
            onChange={(e) => setKgSobrante(normalizarDecimal(e.target.value))}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="0"
          />
        </div>

        {parseDecimal(kgSobrante) > 0 && (
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

// ── FormGenerico (salsa/postre/pasteleria/panaderia) ───────────────────────────

const CATEGORIA_LABEL: Record<CategoriaGenerica, string> = {
  salsa: 'Salsa',
  postre: 'Postre',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
};

function unidadesDisponibles(
  categoria: CategoriaGenerica,
  permitirLitros?: boolean,
): { value: 'kg' | 'unid' | 'lt'; label: string }[] {
  const base: { value: 'kg' | 'unid' | 'lt'; label: string }[] = [
    { value: 'kg', label: 'kg' },
    { value: 'unid', label: 'unid' },
  ];
  if (permitirLitros || categoria === 'salsa') {
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
  recetaIdsPlan?: Map<string, number>;
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

  // Salsa es overwrite: avisar al cocinero si ya cargó esa receta hoy,
  // así no se duplican filas en el detalle ni hay sorpresa de stock pisado.
  const { data: cargasHoy } = useQuery({
    queryKey: ['cocina-lotes-produccion-qr', local, categoria, hoy()],
    queryFn: async () => {
      const { data, error: qerr } = await supabase
        .from('cocina_lotes_produccion')
        .select('receta_id, cantidad_producida, unidad, created_at')
        .eq('fecha', hoy())
        .eq('local', local)
        .eq('categoria', categoria)
        .not('receta_id', 'is', null)
        .order('created_at', { ascending: true });
      if (qerr) throw qerr;
      return (data ?? []) as {
        receta_id: string;
        cantidad_producida: number;
        unidad: string;
        created_at: string;
      }[];
    },
    enabled: categoria === 'salsa',
  });

  const cargasPorReceta = useMemo(() => {
    const m = new Map<
      string,
      { hora: string; cantidad: number; unidad: string; cargas: number }
    >();
    for (const c of cargasHoy ?? []) {
      if (!c.receta_id) continue;
      const prev = m.get(c.receta_id);
      const hora = new Date(c.created_at).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      m.set(c.receta_id, {
        hora,
        cantidad: Number(c.cantidad_producida),
        unidad: c.unidad,
        cargas: (prev?.cargas ?? 0) + 1,
      });
    }
    return m;
  }, [cargasHoy]);

  const cargaPrevia = recetaId ? cargasPorReceta.get(recetaId) : undefined;

  // Validación de sanidad: si la cantidad cargada supera 3× el rendimiento teórico
  // de la receta, casi seguro hubo un error de tipeo (1.67 → 16700, 1,8 → 1800).
  // Sólo aplica cuando la receta tiene rendimiento_kg cargado y las unidades son
  // comparables (kg/l). Postres en unidades no tienen referencia, se ignoran.
  const cantNum = parseDecimal(cantidad);
  const unidadesComparables =
    (unidad === 'kg' || unidad === 'lt') &&
    (recetaSel?.rendimiento_unidad === 'kg' || recetaSel?.rendimiento_unidad === 'l');
  const valorAnomalo =
    !!recetaSel?.rendimiento_kg &&
    unidadesComparables &&
    cantNum > 0 &&
    cantNum > recetaSel.rendimiento_kg * 3;

  async function guardar() {
    if (!recetaId && !(permitirLibre && nombreLibre.trim())) {
      setError('Seleccioná una receta o escribí el nombre');
      return;
    }
    if (!cantidad || parseDecimal(cantidad) <= 0) {
      setError('Indicá la cantidad producida');
      return;
    }
    if (!responsable.trim()) {
      setError('Indicá tu nombre (responsable)');
      return;
    }
    if (valorAnomalo && recetaSel) {
      const ok = window.confirm(
        `Estás por guardar ${formatNum(cantNum)} ${unidad} de ${recetaSel.nombre}, ` +
          `pero la receta suele rendir ${formatNum(recetaSel.rendimiento_kg ?? 0)} ${unidadReceta(recetaSel)}. ` +
          `¿Es correcto?\n\n` +
          `Si quisiste poner 1,8 (un kilo ochocientos), usá la coma como separador decimal.`,
      );
      if (!ok) return;
    }
    setGuardando(true);
    setError('');

    const { error: err } = await supabase.from('cocina_lotes_produccion').insert({
      fecha: hoy(),
      local,
      categoria,
      receta_id: recetaId || null,
      nombre_libre: permitirLibre && !recetaId ? nombreLibre.trim() : null,
      cantidad_producida: parseDecimal(cantidad),
      unidad,
      merma_cantidad: merma ? parseDecimal(merma) : null,
      merma_motivo: mermaMotivo.trim() || null,
      responsable: responsable.trim(),
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
        {hayPlan ? (
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
        ) : (
          recetas.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
              ⚠️ Sin plan cargado para hoy · mostrando catálogo completo
            </div>
          )
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
              {recetasVisibles.map((r) => {
                const planeada = recetaIdsPlan?.get(r.id);
                const carga = cargasPorReceta.get(r.id);
                const prefix = carga ? '✓ ' : planeada ? '📋 ' : '';
                const sufijoCarga = carga
                  ? ` · ya cargada ${carga.hora} (${carga.cantidad}${carga.unidad})`
                  : '';
                const sufijoPlan =
                  planeada && !carga
                    ? ` · ${planeada} receta${planeada === 1 ? '' : 's'} planificada${planeada === 1 ? '' : 's'}`
                    : '';
                return (
                  <option key={r.id} value={r.id}>
                    {prefix}
                    {r.nombre}
                    {sufijoCarga}
                    {sufijoPlan}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {permitirLibre && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              {recetaId ? 'O escribí un nombre libre (opcional)' : 'Nombre'}
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

        {categoria === 'salsa' && cargaPrevia && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs">
            <p className="font-semibold text-amber-900">
              ⚠️ Ya cargaste {recetaSel?.nombre} hoy
            </p>
            <p className="mt-0.5 text-amber-800">
              {cargaPrevia.cargas === 1
                ? `A las ${cargaPrevia.hora} (${cargaPrevia.cantidad}${cargaPrevia.unidad}).`
                : `${cargaPrevia.cargas} veces · última a las ${cargaPrevia.hora} (${cargaPrevia.cantidad}${cargaPrevia.unidad}).`}{' '}
              Si guardás de nuevo, el stock se <strong>reemplaza</strong> por el nuevo valor.
            </p>
          </div>
        )}

        <IngredientesGrilla recetaId={recetaId || null} onChange={onGrillaChange} />

        <div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Cantidad</label>
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                value={cantidad}
                onChange={(e) => setCantidad(normalizarDecimal(e.target.value))}
                placeholder="Ej: 1,8"
                className={cn(
                  'w-full rounded border px-3 py-2.5 text-sm',
                  valorAnomalo ? 'border-red-500 bg-red-50' : 'border-gray-300',
                )}
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
          {cantNum > 0 && (
            <p
              className={cn(
                'mt-1.5 text-[11px]',
                valorAnomalo ? 'font-semibold text-red-700' : 'text-gray-600',
              )}
            >
              {valorAnomalo ? '⚠️ ' : '📦 '}
              Vas a registrar: <strong>
                {formatNum(cantNum)} {unidad}
              </strong>
              {unidad === 'kg' && equivalenteKgGramos(cantNum)
                ? ` = ${equivalenteKgGramos(cantNum)}`
                : ''}
              {valorAnomalo && recetaSel?.rendimiento_kg
                ? ` · la receta rinde típicamente ${formatNum(recetaSel.rendimiento_kg)} ${unidadReceta(recetaSel)}. Usá coma para decimales (1,8 = un kilo ochocientos).`
                : ''}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Merma (opcional)</label>
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              value={merma}
              onChange={(e) => setMerma(normalizarDecimal(e.target.value))}
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

// ── Formulario Merma ────────────────────────────────────────────────────────────

const TIPO_LABEL_MERMA: Record<string, string> = {
  pasta: 'Pastas',
  panificado: 'Panificados',
  salsa: 'Salsas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  relleno: 'Rellenos',
  masa: 'Masas',
};

// Orden estable de los grupos en el dropdown
const TIPO_ORDEN_MERMA = [
  'pasta',
  'panificado',
  'salsa',
  'postre',
  'pasteleria',
  'panaderia',
  'relleno',
  'masa',
];

// Unidad de la cantidad de merma según el tipo
function unidadMermaPorTipo(tipo: string): string {
  if (tipo === 'salsa') return 'kg';
  if (tipo === 'pasta' || tipo === 'relleno' || tipo === 'masa') return 'porciones';
  return 'unidades'; // postre, panificado, pasteleria, panaderia
}

interface ItemMerma {
  key: string; // valor del select: "p:<uuid>" o "r:<uuid>"
  kind: 'producto' | 'receta';
  id: string;
  nombre: string;
  tipo: string;
}

function FormMerma({
  local,
  productos,
  recetas,
  onGuardado,
  onVolver,
}: {
  local: 'vedia' | 'saavedra';
  productos: Producto[];
  recetas: Receta[];
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  // Combinar productos del catálogo con recetas que no tienen producto en cocina_productos.
  // Productos: pastas (ambos locales) + panificados (Saavedra). Vienen de cocina_productos.
  // Recetas: salsas, postres, pastelería, panadería, rellenos, masas. Vienen de cocina_recetas.
  // Filtramos por local en ambos casos.
  const items = useMemo<ItemMerma[]>(() => {
    const list: ItemMerma[] = [];
    for (const p of productos) {
      if (p.local !== local) continue;
      list.push({
        key: `p:${p.id}`,
        kind: 'producto',
        id: p.id,
        nombre: p.nombre,
        tipo: p.tipo,
      });
    }
    for (const r of recetas) {
      if (r.local !== local) continue;
      // Recetas estructurales que no representan un item vendible/consumible en sí mismo
      if (r.tipo === 'subreceta' || r.tipo === 'otro') continue;
      // Si ya está cubierto como producto del catálogo (mismo nombre + tipo), no duplicar
      if (
        productos.some(
          (p) =>
            p.local === local &&
            p.tipo === r.tipo &&
            p.nombre.toLowerCase().trim() === r.nombre.toLowerCase().trim(),
        )
      ) {
        continue;
      }
      list.push({
        key: `r:${r.id}`,
        kind: 'receta',
        id: r.id,
        nombre: r.nombre,
        tipo: r.tipo,
      });
    }
    return list;
  }, [productos, recetas, local]);

  const itemsPorTipo = useMemo(() => {
    const m = new Map<string, ItemMerma[]>();
    for (const it of items) {
      const arr = m.get(it.tipo) ?? [];
      arr.push(it);
      m.set(it.tipo, arr);
    }
    for (const [, arr] of m) arr.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return m;
  }, [items]);

  const [seleccion, setSeleccion] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [responsable, setResponsable] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const itemSel = items.find((it) => it.key === seleccion);
  const unidad = itemSel ? unidadMermaPorTipo(itemSel.tipo) : 'porciones';

  async function guardar() {
    setError('');
    if (!itemSel) {
      setError('Seleccioná un producto');
      return;
    }
    const cant = parseDecimal(cantidad);
    if (!cantidad || cant <= 0) {
      setError('Indicá una cantidad válida');
      return;
    }
    if (!motivo.trim()) {
      setError('Indicá el motivo de la merma');
      return;
    }
    if (!responsable.trim()) {
      setError('Indicá el responsable');
      return;
    }
    setGuardando(true);
    const payload: {
      fecha: string;
      porciones: number;
      motivo: string;
      responsable: string;
      local: string;
      producto_id: string | null;
      receta_id: string | null;
    } = {
      fecha: new Date().toISOString().split('T')[0],
      porciones: cant,
      motivo: motivo.trim(),
      responsable: responsable.trim(),
      local,
      producto_id: itemSel.kind === 'producto' ? itemSel.id : null,
      receta_id: itemSel.kind === 'receta' ? itemSel.id : null,
    };
    const { error: errIns } = await supabase.from('cocina_merma').insert(payload);
    if (errIns) {
      setError(errIns.message);
      setGuardando(false);
      return;
    }
    setGuardando(false);
    onGuardado(`Merma registrada: ${cant} ${unidad} de ${itemSel.nombre}`);
  }

  const tiposPresentes = TIPO_ORDEN_MERMA.filter((t) => itemsPorTipo.has(t));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">Registrar Merma</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">Producto</label>
        <select
          value={seleccion}
          onChange={(e) => setSeleccion(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">— Seleccionar —</option>
          {tiposPresentes.map((tipo) => (
            <optgroup key={tipo} label={TIPO_LABEL_MERMA[tipo] ?? tipo}>
              {(itemsPorTipo.get(tipo) ?? []).map((it) => (
                <option key={it.key} value={it.key}>
                  {it.nombre}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">
          Cantidad ({unidad})
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={cantidad}
          onChange={(e) => setCantidad(normalizarDecimal(e.target.value))}
          placeholder={unidad === 'kg' ? 'Ej: 1,5' : 'Ej: 10'}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">Motivo</label>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          placeholder="Ej: vencido, se cayó, mal armado…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">Responsable</label>
        <input
          type="text"
          value={responsable}
          onChange={(e) => setResponsable(e.target.value)}
          placeholder="Nombre"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full rounded-lg bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
      >
        {guardando ? 'Guardando...' : 'Registrar Merma'}
      </button>
    </div>
  );
}

