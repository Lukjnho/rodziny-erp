import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';
import { cn } from '@/lib/utils';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';
import { invalidarStockCocina } from './lib/invalidarStock';
import { IngredientesGrilla, type IngredienteReal } from './components/IngredientesGrilla';
import { ResponsableSelect } from './components/ResponsableSelect';
import {
  parseDecimal as parseDecimalShared,
  normalizarDecimal as normalizarDecimalShared,
  formatNum as formatNumShared,
  equivalenteKgGramos as equivalenteKgGramosShared,
} from '@/lib/numero';
import { TrasladoPastasForm } from '@/modules/compras/components/TrasladoPastasForm';
import { useCierresFaltantes } from './hooks/useCierresFaltantes';

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Producto {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  local: string;
  es_mixto: boolean;
}
interface Receta {
  id: string;
  nombre: string;
  tipo: 'receta' | 'subreceta';
  rol: string | null;
  categoria: string | null;
  rendimiento_kg: number | null;
  rendimiento_unidad: 'kg' | 'l' | 'unidad' | null;
  local: string | null;
  // Si está seteado, el relleno se gestiona por bolsa (ej: puré de papa): el cocinero
  // carga ½/1 bolsa + kg de papa + kg de puré que salió, en vez de "recetas".
  kg_por_bolsa: number | null;
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
// algunos Android en español sólo muestran ",". Reexportamos los helpers del
// módulo compartido @/lib/numero para no duplicar lógica (también usados en
// compras/RecepcionPage).
const parseDecimal = parseDecimalShared;
const normalizarDecimal = normalizarDecimalShared;
const formatNum = formatNumShared;

// Equivalente "humano" para kg: importado de @/lib/numero. Acompaña el display
// numérico para eliminar la ambigüedad punto/coma.
const equivalenteKgGramos = equivalenteKgGramosShared;
// Un lote de pasta no usa más de ~50 kg de masa ni de relleno. Si el valor
// supera esto, casi seguro se cargó en gramos (ej: 1167 = 1,167 kg). Sirve para
// avisar/corregir en el QR antes de ensuciar cocina_lotes_pasta.
const MAX_KG_PASTA = 50;

// Umbrales generales para detectar error de unidad (coma/punto) al cargar
// recetas: si el real ingresado supera 30× el teórico, se bloquea — Rodziny
// no hace lotes tan grandes. >3× pide confirm pero deja pasar.
const RATIO_CONFIRMA = 3;
const RATIO_BLOQUEA = 30;
function evaluarCantidadVsTeorico(
  realPorReceta: number,
  teorico: number,
): 'ok' | 'confirma' | 'bloquea' {
  if (!isFinite(realPorReceta) || !isFinite(teorico) || realPorReceta <= 0 || teorico <= 0)
    return 'ok';
  const ratio = realPorReceta / teorico;
  if (ratio >= RATIO_BLOQUEA) return 'bloquea';
  if (ratio >= RATIO_CONFIRMA) return 'confirma';
  return 'ok';
}
function pareceGramosPasta(raw: string): number | null {
  const v = parseDecimal(raw);
  return isFinite(v) && v > MAX_KG_PASTA ? v : null;
}
// String en kg con coma decimal (sin separador de miles) para meter al input.
function aKgStr(gramos: number): string {
  return String(Math.round(gramos) / 1000).replace('.', ',');
}
function AvisoPosibleGramos({
  raw,
  onCorregir,
}: {
  raw: string;
  onCorregir: (kgStr: string) => void;
}) {
  const v = pareceGramosPasta(raw);
  if (v == null) return null;
  const kgStr = aKgStr(v);
  return (
    <div className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">
      ⚠ {v} kg es muchísimo para un lote. ¿Lo cargaste en gramos?{' '}
      <button
        type="button"
        onClick={() => onCorregir(kgStr)}
        className="ml-1 rounded bg-amber-600 px-1.5 py-0.5 font-semibold text-white"
      >
        Usar {kgStr} kg
      </button>
    </div>
  );
}

// Un ingrediente que se agrega al armar la pasta, definido por kg de papa.
interface IngredienteArmado {
  nombre: string;
  por_kg: number;
  unidad: string;
}

interface LoteRelleno {
  id: string;
  receta_id: string;
  peso_total_kg: number; // en el puré por bolsa = kg de puré
  kg_papa?: number | null; // puré por bolsa: kg de papa que originó este puré (rinde)
  local: string;
  fecha: string;
  created_at?: string | null;
  responsable?: string | null;
  excluido_analisis?: boolean;
  receta?: {
    nombre: string;
    g_semolin_por_kg: number | null;
    g_huevo_por_kg: number | null;
    // Ingredientes que se agregan al armar (ej: ñoqui SG = harinas GF + huevo),
    // por kg de papa. Generaliza el semolin/huevo de Vedia.
    ingredientes_armado: IngredienteArmado[] | null;
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
  created_at?: string | null;
  responsable?: string | null;
  excluido_analisis?: boolean;
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
  | 'pasta-stock'
  | 'milanesa'
  | 'merma'
  | 'traslado'
  | 'exito';

// Saavedra controla TODO el stock con overwrite ("último pesaje manda"): pasta y
// milanesa se cargan por el flujo genérico (cocina_lotes_produccion), no por el
// flujo cámara/traspaso de Vedia. Por eso 'pasta' y 'milanesa' son categorías genéricas.
type CategoriaGenerica = 'salsa' | 'postre' | 'pasteleria' | 'panaderia' | 'pasta' | 'milanesa';

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

// Hora HH:mm a partir de un timestamp ISO. Vacío si no hay dato.
function horaDe(ts?: string | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

// ── Historial "Ya cargado hoy" ───────────────────────────────────────────────
// Panel que va arriba de cada formulario para que el cocinero vea de un vistazo
// qué cargó hoy de ese tipo (ej: si ya cargó el peso del relleno de vacío) y no
// lo cargue dos veces ni se olvide.

interface CargaHoyItem {
  nombre: string;
  detalle: string; // cantidad + unidad ya formateada, ej "12,5 kg" / "40 bandejas"
  hora?: string;
  responsable?: string | null;
}

function CargasHoyResumen({ items }: { items: CargaHoyItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
        Todavía no cargaste nada de esto hoy.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
      <p className="text-[11px] font-semibold text-emerald-800">
        ✓ Ya cargaste hoy ({items.length})
      </p>
      <ul className="mt-1 space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-baseline justify-between gap-2 text-[11px] text-emerald-900">
            <span className="font-medium">{it.nombre}</span>
            <span className="whitespace-nowrap text-emerald-700">
              {it.detalle}
              {it.hora ? ` · ${it.hora}` : ''}
              {it.responsable ? ` · ${it.responsable}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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
        .select('id, nombre, codigo, tipo, local, es_mixto')
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
        .select(
          'id, nombre, tipo, rol, categoria, rendimiento_kg, rendimiento_unidad, local, kg_por_bolsa',
        )
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
          'id, receta_id, peso_total_kg, kg_papa, fecha, local, created_at, responsable, excluido_analisis, receta:cocina_recetas(nombre, g_semolin_por_kg, g_huevo_por_kg, ingredientes_armado)',
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
          'id, receta_id, kg_producidos, kg_sobrante, destino_sobrante, fecha, created_at, responsable, excluido_analisis, receta:cocina_recetas(nombre)',
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

  // Consumo de masa registrado en armados multi-masa (tabla puente). En el caso
  // mixto el lote de pasta queda con lote_masa_id=null y el detalle por masa va
  // acá, así que hay que sumarlo al consumo directo para no descuadrar el
  // disponible de cada masa.
  const { data: masasMixConsumoHoy } = useQuery({
    queryKey: ['cocina-pasta-masas-consumo-qr', desdeLotes, local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta_masas')
        .select('lote_masa_id, masa_kg, pasta:cocina_lotes_pasta!inner(fecha, local)')
        .eq('pasta.local', local)
        .gte('pasta.fecha', desdeLotes);
      if (error) throw error;
      return (data ?? []) as unknown as { lote_masa_id: string; masa_kg: number | null }[];
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
    // Armados multi-masa (tabla puente): el lote de pasta tiene lote_masa_id=null,
    // así que el consumo solo está acá.
    for (const r of masasMixConsumoHoy ?? []) {
      if (r.lote_masa_id && r.masa_kg) {
        m.set(r.lote_masa_id, (m.get(r.lote_masa_id) ?? 0) + Number(r.masa_kg));
      }
    }
    return m;
  }, [pastasConsumoHoy, masasMixConsumoHoy]);

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
        .select('pasta_id, receta_id, receta:cocina_recetas(tipo, rol)');
      if (error) throw error;
      return (data ?? []) as unknown as {
        pasta_id: string;
        receta_id: string;
        receta: { tipo: string; rol: string | null } | { tipo: string; rol: string | null }[] | null;
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

  // Pastas armadas HOY (para el historial "ya cargaste hoy" del form Armar Pasta).
  const { data: lotesPastaHoy } = useQuery({
    queryKey: ['cocina-lotes-pasta-hoy-qr', local, hoy()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select(
          'id, codigo_lote, porciones, cantidad_cajones, created_at, responsable, producto:cocina_productos(nombre)',
        )
        .eq('local', local)
        .eq('fecha', hoy())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        codigo_lote: string;
        porciones: number | null;
        cantidad_cajones: number | null;
        created_at: string | null;
        responsable: string | null;
        producto?: { nombre: string } | null;
      }[];
    },
  });

  // Listas "ya cargado hoy" por tipo, para mostrar arriba de cada formulario.
  const cargasHoyRelleno = useMemo<CargaHoyItem[]>(
    () =>
      (lotesRellenoHoy ?? [])
        .filter((l) => l.fecha === hoy())
        .map((l) => ({
          nombre: l.receta?.nombre ?? 'Relleno',
          detalle: `${formatNum(l.peso_total_kg)} kg`,
          hora: horaDe(l.created_at),
          responsable: l.responsable,
        })),
    [lotesRellenoHoy],
  );

  const cargasHoyMasa = useMemo<CargaHoyItem[]>(
    () =>
      (lotesMasaHoy ?? [])
        .filter((l) => l.fecha === hoy())
        .map((l) => ({
          nombre: l.receta?.nombre ?? 'Masa',
          detalle: `${formatNum(l.kg_producidos)} kg`,
          hora: horaDe(l.created_at),
          responsable: l.responsable,
        })),
    [lotesMasaHoy],
  );

  const cargasHoyPasta = useMemo<CargaHoyItem[]>(
    () =>
      (lotesPastaHoy ?? []).map((l) => ({
        nombre: l.producto?.nombre ?? 'Pasta',
        detalle:
          l.cantidad_cajones != null
            ? `${formatNum(l.cantidad_cajones)} bandejas`
            : l.porciones != null
              ? `${formatNum(l.porciones)} porciones`
              : l.codigo_lote,
        hora: horaDe(l.created_at),
        responsable: l.responsable,
      })),
    [lotesPastaHoy],
  );

  // Filtro estricto por local: solo muestra lo asignado explícitamente a este local.
  // Inlineamos el chequeo en cada useMemo para que no haya un closure intermedio
  // que oculte la dependencia real (local) del linter de hooks.
  // Modelo nuevo: las subrecetas se filtran por `rol` (operativo), las recetas
  // vendibles por `categoria` (comercial). Para los flujos que pueden producir
  // ambas (salsa, postre, panificado), combinamos: subreceta_base + receta_final.
  // Rellenos y masas solo existen como subrecetas (no se venden directo).
  const recetasRelleno = useMemo(
    () => (recetas ?? []).filter((r) => r.rol === 'relleno' && r.local === local),
    [recetas, local],
  );
  // "Cargar Masa" incluye las masas de pasta (rol='masa') Y las de panadería
  // (rol='masa_panaderia'): ambas se producen pesando kg. La diferencia es el
  // destino — las de pasta se consumen al armar pasta; las de panadería se
  // convierten en panes desde el botón "Cargar Panadería" (que las descuenta).
  const recetasMasa = useMemo(
    () =>
      (recetas ?? []).filter(
        (r) => (r.rol === 'masa' || r.rol === 'masa_panaderia') && r.local === local,
      ),
    [recetas, local],
  );
  const recetasSalsa = useMemo(
    () =>
      // QR de producción: el cocinero carga la salsa que realmente produce, que es
      // la subreceta Base (la que tiene la receta cargada). Las recetas vendibles
      // (categoria='salsa') son solo referencia de costeo —1 ingrediente = la base—
      // y NO se muestran acá para no duplicar cada salsa. Mismo criterio en ambos
      // locales. Si hay Bases duplicadas/legacy, se desactivan desde Costeo.
      (recetas ?? []).filter((r) => r.rol === 'salsa_base' && r.local === local),
    [recetas, local],
  );
  const recetasPostre = useMemo(
    () =>
      (recetas ?? []).filter(
        (r) => (r.rol === 'postre_base' || r.categoria === 'postre') && r.local === local,
      ),
    [recetas, local],
  );
  // Pastelería (Saavedra): FormPasteleria es product-driven (lista los postres y
  // carga "cuántas recetas hiciste" → porciones × rinde). No usa lista de recetas acá.
  // Panadería = flujo de 2 etapas: la masa (rol='masa_panaderia') se carga desde
  // "Cargar Masa" (kg); luego "Cargar Panadería" (FormPanaderia) la convierte en
  // panes terminados, sumando al stock del producto y descontando la masa. Por eso
  // acá no hace falta una lista de recetas de panadería: FormPanaderia hace sus
  // propias queries (lotes de masa disponibles + productos con masa_id).
  const recetasLocal = useMemo(
    () => (recetas ?? []).filter((r) => r.local === local),
    [recetas, local],
  );

  // Plan del día: por receta acumulamos cuántas recetas pidió el chef
  // (si hay varios items para la misma receta, se suman). Se usa para
  // filtrar el dropdown y mostrar "N recetas planificadas" en cada opción.
  const planPorTipo = useMemo(() => {
    const m: Record<'relleno' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia' | 'milanesa', Map<string, number>> = {
      relleno: new Map(),
      salsa: new Map(),
      postre: new Map(),
      pasteleria: new Map(),
      panaderia: new Map(),
      milanesa: new Map(),
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
  // Saavedra: catálogo para carga overwrite recipe-independent (pasta/milanesa).
  const pastaLibres = useMemo(
    () =>
      (productos ?? [])
        .filter((p) => p.tipo === 'pasta' && p.local === local)
        .map((p) => ({ id: p.id, nombre: p.nombre })),
    [productos, local],
  );
  // Milanesa (Saavedra): se carga por kg de cuadril contra su subreceta base
  // (rol='milanesa_base'). El form escala la receta y registra kg de milanesa.
  const recetasMilanesa = useMemo(
    () => (recetas ?? []).filter((r) => r.rol === 'milanesa_base' && r.local === local),
    [recetas, local],
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
    // Refrescar todo el stock derivado (StockTab, Dashboard, Resumen, catálogo)
    // para que cualquier carga del QR se vea al instante en las pantallas abiertas.
    invalidarStockCocina(qc);
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
          cargasHoy={cargasHoyRelleno}
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
          cargasHoy={cargasHoyPasta}
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
          cargasHoy={cargasHoyMasa}
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
        <FormPasteleria
          local={local}
          recetaIdsPlan={planPorTipo.pasteleria}
          recetaIdsPlanPostre={planPorTipo.postre}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'panaderia' && (
        <FormPanaderia
          local={local}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'pasta-stock' && (
        <FormGenerico
          local={local}
          categoria="pasta"
          recetas={[]}
          permitirLibre
          productosLibres={pastaLibres}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'milanesa' && (
        <FormMila
          local={local}
          recetasMilanesa={recetasMilanesa}
          recetaIdsPlan={planPorTipo.milanesa}
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
  ];
  if (local === 'vedia') {
    // Vedia: flujo cámara/traspaso (armar bandejas → porcionar → trasladar a mostrador).
    botones.push({
      vista: 'pasta',
      label: 'Armar Pasta (bandejas)',
      color: 'bg-rodziny-700 hover:bg-rodziny-800',
    });
    botones.push({
      vista: 'porcionar-pasta',
      label: frescosPendientes > 0 ? `Porcionar Pasta (${frescosPendientes})` : 'Porcionar Pasta',
      color: 'bg-blue-600 hover:bg-blue-700',
    });
    botones.push({ vista: 'salsa', label: 'Cargar Salsa', color: 'bg-orange-500 hover:bg-orange-600' });
    botones.push({
      vista: 'postre',
      label: 'Cargar Postre',
      color: 'bg-pink-500 hover:bg-pink-600',
    });
  } else {
    // Saavedra: espejo del flujo de Vedia para pasta (cámara + porcionado), pero sin
    // mostrador. Se arma juntando relleno+masa (da código de lote → freezer), se
    // porciona al día siguiente (→ cámara) y el recuento se hace por conteo de cámara
    // en el StockTab. Salsa/postre/milanesa/panadería siguen overwrite.
    botones.push({
      vista: 'pasta',
      label: 'Armar Pasta (bandejas)',
      color: 'bg-rodziny-700 hover:bg-rodziny-800',
    });
    botones.push({
      vista: 'porcionar-pasta',
      label: frescosPendientes > 0 ? `Porcionar Pasta (${frescosPendientes})` : 'Porcionar Pasta',
      color: 'bg-blue-600 hover:bg-blue-700',
    });
    botones.push({
      vista: 'milanesa',
      label: 'Cargar Milanesas',
      color: 'bg-red-700 hover:bg-red-800',
    });
    botones.push({ vista: 'salsa', label: 'Cargar Salsa', color: 'bg-orange-500 hover:bg-orange-600' });
    botones.push({
      vista: 'pasteleria',
      label: 'Cargar Pastelería Terminada',
      color: 'bg-pink-500 hover:bg-pink-600',
    });
    botones.push({
      vista: 'panaderia',
      label: 'Cargar Panadería',
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

      {local === 'vedia' && (
        <div className="pt-2">
          <button
            onClick={() => onIr('traslado')}
            className="w-full rounded-lg border-2 border-blue-700 bg-blue-600 py-3 text-sm font-semibold text-white transition-transform active:scale-[0.98]"
          >
            🚚 Trasladar a mostrador
          </button>
        </div>
      )}

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
  cargasHoy = [],
  onGuardado,
  onVolver,
}: {
  local: string;
  recetas: Receta[];
  recetaIdsPlan?: Map<string, number>;
  cargasHoy?: CargaHoyItem[];
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
  const [pesoKg, setPesoKg] = useState(''); // en modo bolsa = kg de puré que salió
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  // Modo bolsa (puré de papa): kg de papa pesada (las bolsas se derivan solas).
  const [kgPapa, setKgPapa] = useState('');
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([]);
  const [ingredientesOk, setIngredientesOk] = useState(true);
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
  // Modo bolsa: el relleno (puré de papa) se carga por bolsa + kg de papa + kg de puré.
  const esPorBolsa = (recetaSel?.kg_por_bolsa ?? 0) > 0;
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), []);

  async function guardar() {
    if (!recetaId) {
      setError('Seleccioná una receta');
      return;
    }
    // ── Modo bolsa (puré de papa): bolsas + kg papa + kg puré ──────────────────
    if (esPorBolsa) {
      const pure = parseDecimal(pesoKg);
      const papa = parseDecimal(kgPapa);
      if (!papa || papa <= 0) {
        setError('Indicá los kg de papa que pesaste');
        return;
      }
      // Bolsas = derivado de los kg de papa (1 bolsa = kg_por_bolsa). Solo para
      // comparar contra lo planificado; no se lo pedimos al cocinero.
      const kgBolsa = recetaSel?.kg_por_bolsa ?? 0;
      const nBolsas = kgBolsa > 0 ? +(papa / kgBolsa).toFixed(3) : null;
      if (!pure || pure <= 0) {
        setError('Indicá los kg de puré que salió');
        return;
      }
      if (!responsable.trim()) {
        setError('Elegí responsable');
        return;
      }
      if (pure > papa) {
        const ok = window.confirm(
          `El puré (${formatNum(pure)} kg) pesa más que la papa (${formatNum(papa)} kg). ¿Es correcto?`,
        );
        if (!ok) return;
      }
      setGuardando(true);
      setError('');
      // peso_total_kg = kg de puré (stock del relleno). bolsas/kg_papa registran el
      // rinde real papa→puré. excluido_analisis: el rinde no es "por receta teórica".
      const { error: errB } = await supabase.from('cocina_lotes_relleno').insert({
        receta_id: recetaId,
        fecha: hoy(),
        cantidad_recetas: nBolsas ?? 1,
        peso_total_kg: pure,
        bolsas: nBolsas,
        kg_papa: papa,
        responsable: responsable.trim(),
        local,
        notas: notas.trim() || null,
        excluido_analisis: true,
      });
      if (errB) {
        setError(mensajeErrorAmigable(errB, 'No se pudo guardar el puré'));
        setGuardando(false);
        return;
      }
      onGuardado(
        `Puré "${recetaSel?.nombre ?? ''}" — ${formatNum(pure)} kg (de ${formatNum(papa)} kg de papa)`,
      );
      return;
    }
    if (!pesoKg || parseDecimal(pesoKg) <= 0) {
      setError('Indicá el peso total');
      return;
    }
    if (!responsable.trim()) {
      setError('Elegí responsable');
      return;
    }
    if (!ingredientesOk) {
      setError('Tildá todos los ingredientes pesados antes de guardar');
      return;
    }
    // Sanity vs rendimiento teórico de la receta (evita coma/punto).
    const cantRec = Math.max(1, Number(cantRecetas) || 1);
    const realPorReceta = parseDecimal(pesoKg) / cantRec;
    const teoricoR = recetaSel?.rendimiento_kg ?? 0;
    const veredictoR = evaluarCantidadVsTeorico(realPorReceta, teoricoR);
    if (veredictoR === 'bloquea') {
      setError(
        `${formatNum(realPorReceta)} kg por receta es ${Math.round(realPorReceta / teoricoR)}× el rendimiento (${formatNum(teoricoR)} kg). Revisá la coma decimal (1,8 = un kilo ochocientos).`,
      );
      return;
    }
    if (veredictoR === 'confirma') {
      const ok = window.confirm(
        `Vas a cargar ${formatNum(realPorReceta)} kg por receta, ` +
          `pero la receta rinde ~${formatNum(teoricoR)} kg. ¿Es correcto?`,
      );
      if (!ok) return;
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
      setError(mensajeErrorAmigable(err, 'No se pudo guardar el relleno'));
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

      <CargasHoyResumen items={cargasHoy} />

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <ResponsableSelect
          local={local as 'vedia' | 'saavedra'}
          value={responsable}
          onChange={setResponsable}
        />
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

        {esPorBolsa ? (
          <div className="space-y-3">
            <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
              🥔 Pesá los <strong>kg de papa</strong> y anotá cuántos kg de <strong>puré</strong>{' '}
              salieron. Los demás ingredientes (harina, huevo, condimentos) se agregan después al
              armar el ñoqui.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Kg de papa pesada
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  value={kgPapa}
                  onChange={(e) => setKgPapa(normalizarDecimal(e.target.value))}
                  className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
                  placeholder="Ej: 8,5"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Kg de puré que salió
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  value={pesoKg}
                  onChange={(e) => setPesoKg(normalizarDecimal(e.target.value))}
                  className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
                  placeholder="Ej: 6"
                />
              </div>
            </div>
            {parseDecimal(kgPapa) > 0 && parseDecimal(pesoKg) > 0 && (
              <p className="text-[11px] text-gray-600">
                Rinde:{' '}
                <span className="font-semibold text-gray-800">
                  {((parseDecimal(pesoKg) / parseDecimal(kgPapa)) * 100).toFixed(0)}%
                </span>{' '}
                (de papa a puré)
              </p>
            )}
          </div>
        ) : (
          <>
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
                {parseDecimal(pesoKg) > 0 && equivalenteKgGramos(parseDecimal(pesoKg)) && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    = {equivalenteKgGramos(parseDecimal(pesoKg))}
                  </p>
                )}
              </div>
            </div>

            <IngredientesGrilla
              recetaId={recetaId || null}
              onChange={onGrillaChange}
              multiplicador={Number(cantRecetas) || 1}
              onValidezChange={setIngredientesOk}
            />
          </>
        )}

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
        disabled={guardando || !ingredientesOk || !responsable.trim()}
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
  cargasHoy = [],
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
    receta: { tipo: string; rol: string | null } | { tipo: string; rol: string | null }[] | null;
  }[];
  cargasHoy?: CargaHoyItem[];
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
  // Armado itemizado (ñoqui SG): kg de papa a usar + cantidad real por ingrediente
  // (key = nombre del ingrediente). La sugerencia = por_kg × kgPapa, editable.
  const [kgPapa, setKgPapa] = useState('');
  const [armadoReales, setArmadoReales] = useState<Record<string, string>>({});
  const [cantidadCajones, setCantidadCajones] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  // Multi-masa: solo para pastas "mixtas" (es_mixto), que se arman con varios
  // lotes de masa. Cada fila = un lote + los kg usados.
  const [masasMix, setMasasMix] = useState<{ loteMasaId: string; kg: string }[]>([
    { loteMasaId: '', kg: '' },
  ]);
  function setMasaRow(idx: number, patch: Partial<{ loteMasaId: string; kg: string }>) {
    setMasasMix((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function agregarMasaRow() {
    setMasasMix((rows) => [...rows, { loteMasaId: '', kg: '' }]);
  }
  function quitarMasaRow(idx: number) {
    setMasasMix((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows));
  }

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
      if (r?.rol === 'relleno') s.add(pr.pasta_id);
    }
    return s;
  }, [pastaRecetas]);

  const productoSel = productos.find((p) => p.id === productoId);
  const esMixto = !!productoSel?.es_mixto;
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

  // Armado itemizado (ej: ñoqui SG): la receta del relleno define la lista de
  // ingredientes que se agregan por kg de papa. Tiene prioridad sobre el bloque
  // semolín/huevo (Vedia). Cada ingrediente sugiere por_kg × kgPapa, editable.
  const ingredientesArmado = rellenoSel?.receta?.ingredientes_armado ?? null;
  const usaArmadoItemizado = (ingredientesArmado?.length ?? 0) > 0;
  // En modo itemizado el input es "kg de puré a ocupar". Los ingredientes están
  // definidos por kg de PAPA, así que convertimos puré→papa con el rinde guardado
  // del lote (kg_papa / kg_puré). Si el lote no tiene rinde (viejo), 1:1.
  const kgPureNum = parseDecimal(kgPapa);
  const papaPorPure =
    rellenoSel?.kg_papa && rellenoSel.peso_total_kg
      ? rellenoSel.kg_papa / rellenoSel.peso_total_kg
      : null;
  const kgPapaEquiv = kgPureNum * (papaPorPure ?? 1);
  useEffect(() => {
    if (!usaArmadoItemizado || kgPureNum <= 0) {
      setArmadoReales({});
      return;
    }
    const sug: Record<string, string> = {};
    for (const ing of ingredientesArmado ?? []) {
      const cant = kgPapaEquiv * (Number(ing.por_kg) || 0);
      // kg con hasta 3 decimales, unidades enteras.
      sug[ing.nombre] =
        ing.unidad === 'kg' ? String(+cant.toFixed(3)) : String(Math.round(cant));
    }
    setArmadoReales(sug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usaArmadoItemizado, kgPapa, loteRellenoId]);

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
    if (usaArmadoItemizado) {
      if (kgPureNum <= 0) {
        setError('Indicá los kg de puré a ocupar');
        return;
      }
      const faltante = (ingredientesArmado ?? []).find(
        (ing) => !armadoReales[ing.nombre] || Number(armadoReales[ing.nombre]) <= 0,
      );
      if (faltante) {
        setError(`Cargá la cantidad de ${faltante.nombre}`);
        return;
      }
    }
    // Muzzarella obligatoria en ñoquis rellenos: sin gramos no se puede guardar.
    if (esConMuzzarella && (!muzzarellaGramos || Number(muzzarellaGramos) <= 0)) {
      setError('Los ñoquis rellenos llevan muzzarella. Cargá los gramos antes de guardar.');
      return;
    }
    if (!responsable.trim()) {
      setError('Elegí responsable');
      return;
    }
    // Multi-masa (pastas mixtas): validar filas y calcular el total de masa.
    let masasParaInsertar: { lote_masa_id: string; masa_kg: number }[] = [];
    let masaKgTotalMix: number | null = null;
    if (esMixto) {
      masasParaInsertar = masasMix
        .filter((r) => r.loteMasaId && parseDecimal(r.kg) > 0)
        .map((r) => ({ lote_masa_id: r.loteMasaId, masa_kg: parseDecimal(r.kg) }));
      if (masasParaInsertar.length === 0) {
        setError('Elegí al menos una masa con sus kg');
        return;
      }
      masaKgTotalMix = +masasParaInsertar.reduce((s, m) => s + m.masa_kg, 0).toFixed(3);
      // Sanity: >50 kg de masa por lote casi seguro está cargado en gramos.
      const sospechosas = masasParaInsertar.filter((m) => m.masa_kg > 50);
      if (sospechosas.length > 0) {
        const ok = window.confirm(
          `Cargaste masa(s) de ${sospechosas.map((m) => m.masa_kg).join(', ')} kg. ` +
            `Eso parece estar en GRAMOS, no en kg. ¿Confirmás igual estos valores en kg?`,
        );
        if (!ok) return;
      }
    }
    // Sanity de unidades: >50 kg de masa/relleno por lote es casi seguro gramos.
    const masaSospechosa = pareceGramosPasta(masaKg);
    const rellenoSospechoso = pareceGramosPasta(rellenoKg);
    if (masaSospechosa != null || rellenoSospechoso != null) {
      const partes: string[] = [];
      if (masaSospechosa != null)
        partes.push(`masa ${masaSospechosa} kg (¿= ${aKgStr(masaSospechosa)} kg?)`);
      if (rellenoSospechoso != null)
        partes.push(`relleno ${rellenoSospechoso} kg (¿= ${aKgStr(rellenoSospechoso)} kg?)`);
      const ok = window.confirm(
        `Cargaste ${partes.join(' y ')}. Eso parece estar en GRAMOS, no en kg. ` +
          `¿Confirmás igual estos valores en kg?`,
      );
      if (!ok) return;
    }
    setGuardando(true);
    setError('');

    // Detalle del armado itemizado (ñoqui SG) → se registra en notas para trazabilidad.
    const notasArmado = usaArmadoItemizado
      ? `Armado (${formatNum(kgPureNum)} kg puré${papaPorPure ? ` ≈ ${formatNum(kgPapaEquiv)} kg papa` : ''}): ` +
        (ingredientesArmado ?? [])
          .map(
            (ing) =>
              `${ing.nombre} ${armadoReales[ing.nombre]}${ing.unidad === 'kg' ? ' kg' : ' u'}`,
          )
          .join(', ')
      : '';
    const notasFinal = [notas.trim(), notasArmado].filter(Boolean).join(' — ') || null;

    const cantidad = cantidadCajones ? Number(cantidadCajones) : null;
    const { data: loteCreado, error: err } = await supabase
      .from('cocina_lotes_pasta')
      .insert({
        producto_id: productoId,
        lote_relleno_id: loteRellenoId || null,
        // Mixto: el lote no apunta a una sola masa (el detalle por lote va en
        // cocina_lotes_pasta_masas). Guardamos el total en masa_kg.
        lote_masa_id: esMixto ? null : loteMasaId || null,
        fecha: hoy(),
        codigo_lote: codigoLote,
        receta_masa_id: esMixto
          ? null
          : (lotesMasa.find((m) => m.id === loteMasaId)?.receta_id ?? null),
        masa_kg: esMixto ? masaKgTotalMix : masaKg ? parseDecimal(masaKg) : null,
        // Armado itemizado: el input son los kg de PURÉ a ocupar → consume el stock
        // del relleno (puré) directamente en su unidad real (kg de puré).
        relleno_kg: usaArmadoItemizado
          ? kgPureNum > 0
            ? kgPureNum
            : null
          : rellenoKg
            ? parseDecimal(rellenoKg)
            : null,
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
        // Sin relleno entra directo a cámara: estampamos la hora real para que
        // el baseline de cámara (v_cocina_stock_pastas) lo cuente como posterior
        // al último conteo. Con relleno: queda null hasta el paso "Porcionar".
        porcionado_at: esPastaSinRelleno ? new Date().toISOString() : null,
        responsable_porcionado: esPastaSinRelleno ? responsable.trim() : null,
        responsable: responsable.trim(),
        local,
        notas: notasFinal,
      })
      .select('id')
      .single();

    if (err) {
      setError(mensajeErrorAmigable(err, 'No se pudo guardar la pasta'));
      setGuardando(false);
      return;
    }

    // Detalle de masas del armado mixto (tabla puente).
    if (esMixto && loteCreado) {
      const { error: errMasas } = await supabase.from('cocina_lotes_pasta_masas').insert(
        masasParaInsertar.map((m) => ({
          lote_pasta_id: loteCreado.id,
          lote_masa_id: m.lote_masa_id,
          masa_kg: m.masa_kg,
        })),
      );
      if (errMasas) {
        setError(
          mensajeErrorAmigable(errMasas, 'La pasta se guardó, pero falló el detalle de masas'),
        );
        setGuardando(false);
        return;
      }
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

      <CargasHoyResumen items={cargasHoy} />

      <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        {esPastaSinRelleno
          ? 'Fideos (sin relleno): cargá las porciones (bolsitas 140g) que armaste. Van directo a la cámara de congelado.'
          : 'Las pastas armadas quedan en bandejas en el freezer de producción. Al día siguiente las porcionás en bolsitas de 200g y pasan a la cámara de congelado (cajones).'}
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <ResponsableSelect
          local={local as 'vedia' | 'saavedra'}
          value={responsable}
          onChange={setResponsable}
        />
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
              const peso = l.disponible_kg ?? l.peso_total_kg;
              // Lote marcado por error de unidad: sugerimos el valor probable
              // (÷1000) para que el cocinero entienda y use el "correcto" mentalmente
              // hasta que lo corrija desde el admin.
              const sospechoso = l.excluido_analisis === true;
              const pesoSugerido = sospechoso ? +(peso / 1000).toFixed(3) : null;
              const lectura = equivalenteKgGramos(peso);
              return (
                <option key={l.id} value={l.id}>
                  {sospechoso ? '⚠ ' : ''}
                  {l.receta?.nombre ?? 'Relleno'}
                  {fechaSufijo} — {formatNum(peso)} kg
                  {lectura ? ` (${lectura})` : ''}
                  {sospechoso
                    ? ` ¿debería ser ${formatNum(pesoSugerido ?? 0)} kg?`
                    : ''}
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

        {/* Paso 3 — Masa (oculto cuando el relleno es puré: los ñoquis no llevan masa,
            tanto Vedia —semolín/huevo— como Saavedra —ingredientes_armado—).
            Pastas mixtas (es_mixto): lista de varias masas con sus kg. */}
        {!requiereSemolinHuevo &&
          !usaArmadoItemizado &&
          (esMixto ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                3) Masas (pasta mixta)
              </label>
              <div className="space-y-2">
                {masasMix.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={row.loteMasaId}
                      onChange={(e) => {
                        const id = e.target.value;
                        const m = lotesMasa.find((x) => x.id === id);
                        setMasaRow(idx, {
                          loteMasaId: id,
                          kg:
                            m && m.disponible_kg != null
                              ? String(m.disponible_kg)
                              : id
                                ? row.kg
                                : '',
                        });
                      }}
                      className="flex-1 rounded border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="">Elegí masa…</option>
                      {masasFiltradas.map((m) => {
                        const esDeHoy = m.fecha === hoy();
                        const peso = m.disponible_kg ?? m.kg_producidos;
                        return (
                          <option key={m.id} value={m.id}>
                            {m.receta?.nombre ?? 'Masa'}
                            {esDeHoy ? '' : ` (${formatDDMM(m.fecha)})`} — {formatNum(peso)} kg
                          </option>
                        );
                      })}
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      placeholder="kg"
                      value={row.kg}
                      onChange={(e) => setMasaRow(idx, { kg: normalizarDecimal(e.target.value) })}
                      className="w-20 rounded border border-gray-300 px-2 py-2 text-sm"
                    />
                    {masasMix.length > 1 && (
                      <button
                        type="button"
                        onClick={() => quitarMasaRow(idx)}
                        className="px-1 text-sm text-red-500 hover:text-red-700"
                        title="Quitar masa"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={agregarMasaRow}
                className="mt-2 text-xs font-medium text-rodziny-700 underline"
              >
                + agregar masa
              </button>
              {(() => {
                const total = masasMix.reduce((s, r) => s + parseDecimal(r.kg), 0);
                return total > 0 ? (
                  <p className="mt-1 text-[11px] text-gray-500">
                    Total masa: {formatNum(+total.toFixed(3))} kg
                  </p>
                ) : null;
              })()}
            </div>
          ) : (
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
                  const peso = m.disponible_kg ?? m.kg_producidos;
                  const sospechoso = m.excluido_analisis === true;
                  const pesoSugerido = sospechoso ? +(peso / 1000).toFixed(3) : null;
                  const lectura = equivalenteKgGramos(peso);
                  return (
                    <option key={m.id} value={m.id}>
                      {sospechoso ? '⚠ ' : ''}
                      {m.receta?.nombre ?? 'Masa'}
                      {fechaSufijo} — {formatNum(peso)} kg
                      {lectura ? ` (${lectura})` : ''}
                      {sospechoso
                        ? ` ¿debería ser ${formatNum(pesoSugerido ?? 0)} kg?`
                        : ''}
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
                {parseDecimal(masaKg) > 0 && equivalenteKgGramos(parseDecimal(masaKg)) && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    = {equivalenteKgGramos(parseDecimal(masaKg))}
                  </p>
                )}
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
                <AvisoPosibleGramos raw={masaKg} onCorregir={setMasaKg} />
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
                {parseDecimal(rellenoKg) > 0 && equivalenteKgGramos(parseDecimal(rellenoKg)) && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    = {equivalenteKgGramos(parseDecimal(rellenoKg))}
                  </p>
                )}
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
                <AvisoPosibleGramos raw={rellenoKg} onCorregir={setRellenoKg} />
              </div>
            </div>
            </>
          ))}

        {/* Armado itemizado (ñoqui SG): kg de papa → cada harina/huevo escala por
            su ratio. Reemplaza al bloque semolín/huevo cuando la receta lo define. */}
        {usaArmadoItemizado && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3">
            <div className="mb-2">
              <label className="mb-1 block text-xs font-medium text-amber-900">
                Kg de puré a ocupar
              </label>
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                value={kgPapa}
                onChange={(e) => setKgPapa(normalizarDecimal(e.target.value))}
                className="w-full rounded border border-amber-300 bg-white px-3 py-2.5 text-sm"
                placeholder="Ej: 5"
              />
              <p className="mt-1 text-[11px] text-amber-800">
                Poné los kg de puré que vas a usar y se calcula cuánto de cada harina y huevo
                agregar (editable). Se descuenta del stock de puré.
              </p>
              {papaPorPure && kgPureNum > 0 && (
                <p className="mt-1 text-[11px] font-medium text-amber-900">
                  ≈ {formatNum(kgPapaEquiv)} kg de papa (rinde del lote)
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(ingredientesArmado ?? []).map((ing) => {
                const esKg = ing.unidad === 'kg';
                const sug = kgPapaEquiv > 0 ? kgPapaEquiv * (Number(ing.por_kg) || 0) : null;
                return (
                  <div key={ing.nombre}>
                    <label className="mb-1 block text-xs font-medium text-amber-900">
                      {ing.nombre} ({esKg ? 'kg' : 'u'})
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={armadoReales[ing.nombre] ?? ''}
                      onChange={(e) =>
                        setArmadoReales((prev) => ({
                          ...prev,
                          [ing.nombre]: normalizarDecimal(e.target.value),
                        }))
                      }
                      className="w-full rounded border border-amber-300 bg-white px-3 py-2.5 text-sm"
                      placeholder="0"
                    />
                    {sug != null && (
                      <p className="mt-0.5 text-[10px] text-amber-700">
                        Sugerido ~{esKg ? formatNum(+sug.toFixed(3)) : Math.round(sug)}{' '}
                        {esKg ? 'kg' : 'u'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
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
            {parseDecimal(rellenoKg) > 0 && equivalenteKgGramos(parseDecimal(rellenoKg)) && (
              <p className="mt-1 text-[11px] text-gray-500">
                = {equivalenteKgGramos(parseDecimal(rellenoKg))}
              </p>
            )}
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
            <AvisoPosibleGramos raw={rellenoKg} onCorregir={setRellenoKg} />
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
        disabled={guardando || !responsable.trim()}
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
      setError('Elegí responsable');
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
      setError(mensajeErrorAmigable(err, 'No se pudo porcionar el lote'));
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
        <ResponsableSelect
          local={local as 'vedia' | 'saavedra'}
          value={responsable}
          onChange={setResponsable}
        />
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
        disabled={guardando || !responsable.trim()}
        className="w-full rounded-lg bg-blue-600 py-3.5 text-sm font-semibold text-white shadow transition-transform hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50"
      >
        {guardando ? 'Guardando...' : 'Mover a cámara de congelado'}
      </button>
    </div>
  );
}

// ── Formulario Masa ───────────────────────────────────────────────────────────

// ── FormPanaderia (Saavedra) ─────────────────────────────────────────────────
// Etapa 2 del flujo de panadería: convierte una masa de pan ya producida
// (cargada en "Cargar Masa" → cocina_lotes_masa, rol='masa_panaderia') en panes
// terminados. (1) Suma los panes al stock del producto (cocina_lotes_produccion,
// match por receta_id/nombre del producto) y (2) descuenta la masa consumida
// cerrando el lote con kg_sobrante = disponible − usados. El pan destino se deriva
// del vínculo cocina_productos.masa_id = lote.receta_id (mig 115).
interface ProductoPanaderia {
  id: string;
  nombre: string;
  codigo: string;
  receta_id: string | null;
  masa_id: string | null;
  unidad: string;
}
interface LoteMasaDisp {
  id: string;
  receta_id: string;
  kg_producidos: number;
  fecha: string;
  receta:
    | { nombre: string; rol: string | null }
    | { nombre: string; rol: string | null }[]
    | null;
}

function FormPanaderia({
  local,
  onGuardado,
  onVolver,
}: {
  local: string;
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const qc = useQueryClient();

  const { data: productos } = useQuery({
    queryKey: ['panaderia-productos-masa', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, receta_id, masa_id, unidad')
        .eq('local', local)
        .eq('tipo', 'panificado')
        .eq('activo', true)
        .not('masa_id', 'is', null);
      if (error) throw error;
      return (data ?? []) as ProductoPanaderia[];
    },
  });

  const { data: lotesMasa } = useQuery({
    queryKey: ['panaderia-lotes-masa-disp', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_masa')
        .select('id, receta_id, kg_producidos, fecha, receta:cocina_recetas(nombre, rol)')
        .eq('local', local)
        .is('kg_sobrante', null)
        .order('fecha', { ascending: true });
      if (error) throw error;
      return (data ?? []) as LoteMasaDisp[];
    },
  });

  // Cargado hoy (panadería): evita recargar dos veces lo mismo.
  const { data: cargasHoyPan } = useQuery({
    queryKey: ['cocina-lotes-produccion-qr', local, 'panaderia', hoy()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('nombre_libre, cantidad_producida, unidad, responsable, created_at')
        .eq('fecha', hoy())
        .eq('local', local)
        .eq('categoria', 'panaderia')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as {
        nombre_libre: string | null;
        cantidad_producida: number;
        unidad: string;
        responsable: string | null;
        created_at: string;
      }[];
    },
  });
  const cargasHoyItems = useMemo<CargaHoyItem[]>(
    () =>
      (cargasHoyPan ?? []).map((c) => ({
        nombre: c.nombre_libre ?? 'Pan',
        detalle: `${formatNum(Number(c.cantidad_producida))} ${c.unidad === 'unid' ? 'u' : c.unidad}`,
        hora: horaDe(c.created_at),
        responsable: c.responsable,
      })),
    [cargasHoyPan],
  );

  // Solo masas de panadería (las de pasta también están sin kg_sobrante).
  const masasDisp = useMemo(
    () =>
      (lotesMasa ?? []).filter((l) => {
        const r = Array.isArray(l.receta) ? l.receta[0] : l.receta;
        return r?.rol === 'masa_panaderia';
      }),
    [lotesMasa],
  );

  const [responsable, setResponsable] = useState('');
  const [loteId, setLoteId] = useState('');
  // Una masa puede dar varios productos (ej: factura/medialuna salen de la misma
  // masa). Guardamos las unidades por producto_id.
  const [panesPorProducto, setPanesPorProducto] = useState<Record<string, string>>({});
  const [kgUsados, setKgUsados] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const loteSel = masasDisp.find((l) => l.id === loteId);
  // TODOS los productos vinculados a esta masa (no solo el primero): así una masa
  // de factura/medialuna muestra un campo de unidades por cada producto.
  const productosDeMasa = useMemo(
    () =>
      loteSel ? (productos ?? []).filter((p) => p.masa_id === loteSel.receta_id) : [],
    [loteSel, productos],
  );
  const masaNombre = (() => {
    if (!loteSel) return 'Masa';
    const r = Array.isArray(loteSel.receta) ? loteSel.receta[0] : loteSel.receta;
    return r?.nombre ?? 'Masa';
  })();

  // Al elegir la masa, prefijar kg usados = todo el disponible (lo más común:
  // se hornea toda la masa amasada). El panadero lo ajusta si sobró. Y limpiar
  // las unidades cargadas de la masa anterior.
  useEffect(() => {
    if (loteSel) setKgUsados(String(loteSel.kg_producidos).replace('.', ','));
    else setKgUsados('');
    setPanesPorProducto({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loteId]);

  async function guardar() {
    if (!responsable.trim()) {
      setError('Elegí responsable');
      return;
    }
    if (!loteSel) {
      setError('Elegí la masa producida');
      return;
    }
    if (productosDeMasa.length === 0) {
      setError('Esa masa no tiene un producto vinculado. Vinculalo en Productos > Costeo.');
      return;
    }
    // Productos con unidades cargadas (> 0). Al menos uno.
    const items = productosDeMasa
      .map((p) => ({ producto: p, n: parseDecimal(panesPorProducto[p.id] ?? '') }))
      .filter((it) => it.n > 0);
    if (items.length === 0) {
      setError('Indicá cuántas unidades salieron de al menos un producto');
      return;
    }
    const usados = parseDecimal(kgUsados);
    if (!kgUsados || usados <= 0) {
      setError('Indicá cuántos kg de masa usaste');
      return;
    }
    if (usados > loteSel.kg_producidos + 0.001) {
      setError(
        `Usaste más masa (${formatNum(usados)} kg) que la disponible (${formatNum(loteSel.kg_producidos)} kg).`,
      );
      return;
    }
    setGuardando(true);
    setError('');

    // 1) Descontar la masa UNA sola vez: cerrar el lote con el sobrante.
    const sobrante = +(loteSel.kg_producidos - usados).toFixed(3);
    const { error: errMasa } = await supabase
      .from('cocina_lotes_masa')
      .update({ kg_sobrante: sobrante, destino_sobrante: 'panadería' })
      .eq('id', loteSel.id);
    if (errMasa) {
      setError(mensajeErrorAmigable(errMasa, 'No se pudo descontar la masa'));
      setGuardando(false);
      return;
    }

    // 2) Un lote por producto con unidades (aditivo: cada horneada suma al stock).
    const payload = items.map((it) => ({
      fecha: hoy(),
      local,
      categoria: 'panaderia' as const,
      receta_id: it.producto.receta_id,
      nombre_libre: it.producto.nombre,
      cantidad_producida: it.n,
      unidad: 'unid' as const,
      responsable: responsable.trim(),
      notas: `De ${formatNum(usados)} kg de ${masaNombre}`,
      en_stock: true,
    }));
    const { error: errPan } = await supabase.from('cocina_lotes_produccion').insert(payload);
    if (errPan) {
      setError(mensajeErrorAmigable(errPan, 'No se pudo cargar la panadería'));
      setGuardando(false);
      return;
    }

    invalidarStockCocina(qc);
    qc.invalidateQueries({ queryKey: ['panaderia-lotes-masa-disp', local] });
    const resumen = items.map((it) => `${it.producto.nombre}: ${it.n}`).join(' · ');
    onGuardado(`${resumen} (de ${formatNum(usados)} kg de ${masaNombre})`);
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cargar Panadería</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      <CargasHoyResumen items={cargasHoyItems} />

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
        Elegí la <strong>masa que produjiste</strong> y anotá{' '}
        <strong>cuántas unidades salieron</strong> de cada producto. Se suma al
        stock y se descuenta la masa usada.
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <ResponsableSelect
          local={local as 'vedia' | 'saavedra'}
          value={responsable}
          onChange={setResponsable}
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Masa producida</label>
          <select
            value={loteId}
            onChange={(e) => setLoteId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
          >
            <option value="">— Elegí la masa —</option>
            {masasDisp.map((l) => {
              const r = Array.isArray(l.receta) ? l.receta[0] : l.receta;
              return (
                <option key={l.id} value={l.id}>
                  {r?.nombre ?? 'Masa'} — {formatNum(l.kg_producidos)} kg ({l.fecha})
                </option>
              );
            })}
          </select>
          {masasDisp.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-600">
              No hay masa de panadería cargada. Cargala primero desde "Cargar Masa".
            </p>
          )}
        </div>

        {loteSel && (
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            {productosDeMasa.length > 0 ? (
              <span>
                Hay <strong>{formatNum(loteSel.kg_producidos)} kg</strong> de {masaNombre}.
                Anotá cuántas unidades salieron de cada producto.
              </span>
            ) : (
              <span className="text-amber-700">
                Esta masa no tiene un producto vinculado (vinculalo en Productos &gt; Costeo).
              </span>
            )}
          </div>
        )}

        {productosDeMasa.length > 0 && (
          <>
            <div className="space-y-2">
              {productosDeMasa.map((p) => (
                <div key={p.id}>
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    {p.nombre} — ¿cuántas unidades salieron?
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={panesPorProducto[p.id] ?? ''}
                    onChange={(e) =>
                      setPanesPorProducto((prev) => ({
                        ...prev,
                        [p.id]: e.target.value.replace(/[^0-9]/g, ''),
                      }))
                    }
                    className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Kg de masa usados
              </label>
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                value={kgUsados}
                onChange={(e) => setKgUsados(normalizarDecimal(e.target.value))}
                className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
                placeholder="0"
              />
              {loteSel && (
                <p className="mt-1 text-[10px] text-gray-400">
                  Disponible: {formatNum(loteSel.kg_producidos)} kg
                </p>
              )}
            </div>
          </>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full rounded-lg bg-yellow-600 py-2.5 text-sm font-semibold text-white hover:bg-yellow-700 disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Guardar panadería'}
        </button>
      </div>
    </div>
  );
}

function FormMasa({
  local,
  recetas,
  cargasHoy = [],
  onGuardado,
  onVolver,
}: {
  local: string;
  recetas: Receta[];
  cargasHoy?: CargaHoyItem[];
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const [recetaId, setRecetaId] = useState(recetas[0]?.id ?? '');
  const [cantRecetas, setCantRecetas] = useState('1');
  const [kgProducidos, setKgProducidos] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([]);
  const [ingredientesOk, setIngredientesOk] = useState(true);
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
      setError('Elegí responsable');
      return;
    }
    if (!ingredientesOk) {
      setError('Tildá todos los ingredientes pesados antes de guardar');
      return;
    }
    // Sanity vs rendimiento teórico de la receta (evita coma/punto).
    const cantRecM = Math.max(1, Number(cantRecetas) || 1);
    const realPorRecetaM = parseDecimal(kgProducidos) / cantRecM;
    const teoricoM = recetaSel?.rendimiento_kg ?? 0;
    const veredictoM = evaluarCantidadVsTeorico(realPorRecetaM, teoricoM);
    if (veredictoM === 'bloquea') {
      setError(
        `${formatNum(realPorRecetaM)} kg por receta es ${Math.round(realPorRecetaM / teoricoM)}× el rendimiento (${formatNum(teoricoM)} kg). Revisá la coma decimal (1,8 = un kilo ochocientos).`,
      );
      return;
    }
    if (veredictoM === 'confirma') {
      const ok = window.confirm(
        `Vas a cargar ${formatNum(realPorRecetaM)} kg por receta, ` +
          `pero la receta rinde ~${formatNum(teoricoM)} kg. ¿Es correcto?`,
      );
      if (!ok) return;
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
      setError(mensajeErrorAmigable(err, 'No se pudo guardar la masa'));
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

      <CargasHoyResumen items={cargasHoy} />

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <ResponsableSelect
          local={local as 'vedia' | 'saavedra'}
          value={responsable}
          onChange={setResponsable}
        />
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
            {parseDecimal(kgProducidos) > 0 &&
              equivalenteKgGramos(parseDecimal(kgProducidos)) && (
                <p className="mt-1 text-[11px] text-gray-500">
                  = {equivalenteKgGramos(parseDecimal(kgProducidos))}
                </p>
              )}
          </div>
        </div>

        <IngredientesGrilla
          recetaId={recetaId || null}
          onChange={onGrillaChange}
          multiplicador={Number(cantRecetas) || 1}
          onValidezChange={setIngredientesOk}
        />

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
        disabled={guardando || !ingredientesOk || !responsable.trim()}
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
      setError(mensajeErrorAmigable(err, 'No se pudo cerrar la masa'));
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
          {parseDecimal(kgSobrante) > 0 && equivalenteKgGramos(parseDecimal(kgSobrante)) && (
            <p className="mt-1 text-[11px] text-gray-500">
              = {equivalenteKgGramos(parseDecimal(kgSobrante))}
            </p>
          )}
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

// ── FormPasteleria (postres como Relleno/Masa — Saavedra) ──────────────────────
// Product-driven: lista los productos tipo='postre' (Flan, Tiramisú, Carrot, etc.).
// Patrón igual a Relleno/Masa: el cocinero elige el postre, pone cuántas RECETAS
// (tandas) hizo → la IngredientesGrilla escala los insumos por ese multiplicador
// (checklist de pesaje), y aparte anota cuántas PORCIONES salieron → ESO suma al
// stock (aditivo; el cierre re-baselinea). El rinde de la receta es solo sugerencia.
// El lote se sella con receta_id + nombre_libre del producto para que el stock
// reconcilie siempre.
interface ProductoPasteleria {
  id: string;
  nombre: string;
  codigo: string;
  receta_id: string | null;
  unidad: string;
}

function FormPasteleria({
  local,
  recetaIdsPlan,
  recetaIdsPlanPostre,
  onGuardado,
  onVolver,
}: {
  local: string;
  // Plan del pizarrón keyado por receta_id. En Saavedra este form carga tanto
  // pastelería (tipo='pasteleria') como postres reales (tipo='postre'), así que
  // recibe ambos planes y los une para mostrar/priorizar lo planificado.
  recetaIdsPlan?: Map<string, number>;
  recetaIdsPlanPostre?: Map<string, number>;
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const qc = useQueryClient();

  const { data: productos } = useQuery({
    queryKey: ['pasteleria-productos', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, receta_id, unidad')
        .eq('local', local)
        .eq('tipo', 'postre')
        .eq('activo', true)
        .eq('controla_stock', true)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as ProductoPasteleria[];
    },
  });

  // Cargado hoy (postre + pastelería): evita recargar dos veces lo mismo.
  const { data: cargasHoyPast } = useQuery({
    queryKey: ['cocina-lotes-produccion-qr', local, 'pasteleria-postre', hoy()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('nombre_libre, cantidad_producida, unidad, responsable, created_at')
        .eq('fecha', hoy())
        .eq('local', local)
        .in('categoria', ['postre', 'pasteleria'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as {
        nombre_libre: string | null;
        cantidad_producida: number;
        unidad: string;
        responsable: string | null;
        created_at: string;
      }[];
    },
  });
  const cargasHoyItems = useMemo<CargaHoyItem[]>(
    () =>
      (cargasHoyPast ?? []).map((c) => ({
        nombre: c.nombre_libre ?? 'Postre',
        detalle: `${formatNum(Number(c.cantidad_producida))} ${c.unidad === 'unid' ? 'u' : c.unidad}`,
        hora: horaDe(c.created_at),
        responsable: c.responsable,
      })),
    [cargasHoyPast],
  );

  // Rinde + rol por receta en query aparte (NO embed): cocina_productos tiene 2
  // FKs a cocina_recetas —receta_id y masa_id— y el embed ambiguo deja la lista
  // vacía. El `rol` define con qué categoría se guarda el lote (ver guardar()).
  const { data: metaPorReceta } = useQuery({
    queryKey: ['pasteleria-meta-recetas', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, rendimiento_porciones, rol')
        .eq('local', local);
      if (error) throw error;
      const m = new Map<string, { rinde: number; rol: string | null }>();
      for (const r of (data ?? []) as {
        id: string;
        rendimiento_porciones: number | null;
        rol: string | null;
      }[]) {
        m.set(r.id, { rinde: Number(r.rendimiento_porciones) || 0, rol: r.rol });
      }
      return m;
    },
  });

  // Plan unificado (pastelería + postre) keyado por receta_id. El postre pisa solo
  // si una misma receta estuviera en ambos (no debería pasar).
  const planTodos = useMemo(() => {
    const m = new Map<string, number>();
    for (const [k, v] of recetaIdsPlanPostre ?? []) m.set(k, v);
    for (const [k, v] of recetaIdsPlan ?? []) m.set(k, v);
    return m;
  }, [recetaIdsPlan, recetaIdsPlanPostre]);
  const hayPlan = planTodos.size > 0;
  const [verTodas, setVerTodas] = useState(false);

  const [responsable, setResponsable] = useState('');
  const [productoId, setProductoId] = useState('');
  const [cantRecetas, setCantRecetas] = useState('1');
  const [porcionesOut, setPorcionesOut] = useState('');
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([]);
  const [ingredientesOk, setIngredientesOk] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), []);

  // Productos visibles en el dropdown: por defecto solo lo planificado (si hay
  // plan); el toggle "Ver todas" muestra el catálogo completo.
  const productosVisibles = useMemo(() => {
    if (verTodas || planTodos.size === 0) return productos ?? [];
    return (productos ?? []).filter((p) => p.receta_id && planTodos.has(p.receta_id));
  }, [productos, planTodos, verTodas]);

  const productoSel = useMemo(
    () => (productos ?? []).find((p) => p.id === productoId) ?? null,
    [productos, productoId],
  );
  const recetaId = productoSel?.receta_id ?? null;
  // Rinde solo de referencia (sugerencia de porciones): el stock = lo que el
  // cocinero anota que SALIÓ realmente, no el cálculo teórico.
  const rinde = useMemo(
    () => (productoSel?.receta_id ? metaPorReceta?.get(productoSel.receta_id)?.rinde ?? 0 : 0),
    [productoSel, metaPorReceta],
  );
  // Al elegir un producto planificado, pre-cargar la cantidad de recetas del plan.
  useEffect(() => {
    if (!productoSel?.receta_id) return;
    const planeada = planTodos.get(productoSel.receta_id);
    if (planeada) setCantRecetas(String(planeada));
  }, [productoId]); // eslint-disable-line react-hooks/exhaustive-deps
  const nRecetas = Math.max(1, Number(cantRecetas) || 1);
  const porcOut = parseDecimal(porcionesOut);

  async function guardar() {
    if (!responsable.trim()) {
      setError('Elegí responsable');
      return;
    }
    if (!productoSel) {
      setError('Elegí el postre que hiciste');
      return;
    }
    if (!porcionesOut || porcOut <= 0) {
      setError('Indicá cuántas porciones salieron');
      return;
    }
    if (!ingredientesOk) {
      setError('Tildá todos los ingredientes pesados antes de guardar');
      return;
    }
    setGuardando(true);
    setError('');

    // La categoría del lote define contra qué tipo de ítem del pizarrón tacha el
    // trigger trg_pizarron_lote_produccion: las recetas rol='pasteleria_base' se
    // planifican como tipo='pasteleria', el resto (postre real) como 'postre'.
    // El stock y el cierre matchean por receta_id/nombre, no por categoría.
    const rolReceta = productoSel.receta_id
      ? metaPorReceta?.get(productoSel.receta_id)?.rol ?? null
      : null;
    const categoriaLote = rolReceta === 'pasteleria_base' ? 'pasteleria' : 'postre';

    const { error: err } = await supabase.from('cocina_lotes_produccion').insert({
      fecha: hoy(),
      local,
      categoria: categoriaLote,
      receta_id: productoSel.receta_id,
      nombre_libre: productoSel.nombre,
      cantidad_producida: porcOut,
      unidad: 'unid',
      responsable: responsable.trim(),
      notas: `${nRecetas} receta${nRecetas === 1 ? '' : 's'}`,
      ingredientes_reales: ingredientesReales.length > 0 ? ingredientesReales : null,
      en_stock: true,
    });
    if (err) {
      setError(mensajeErrorAmigable(err, 'No se pudo cargar la pastelería'));
      setGuardando(false);
      return;
    }

    invalidarStockCocina(qc);
    onGuardado(
      `${productoSel.nombre} — +${formatNum(porcOut)} porciones (${nRecetas} receta${nRecetas === 1 ? '' : 's'})`,
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cargar Pastelería</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      <CargasHoyResumen items={cargasHoyItems} />

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
        Elegí el <strong>postre</strong>, poné <strong>cuántas recetas (tandas)</strong> hiciste — eso
        escala los insumos del checklist — y anotá <strong>cuántas porciones salieron</strong>. Las
        porciones se suman al stock.
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <ResponsableSelect
          local={local as 'vedia' | 'saavedra'}
          value={responsable}
          onChange={setResponsable}
        />

        {hayPlan ? (
          <div className="flex items-center justify-between rounded border border-rodziny-200 bg-rodziny-50 px-2.5 py-1.5 text-[11px]">
            <span className="font-medium text-rodziny-800">
              📋 {verTodas ? 'Catálogo completo' : `Plan de hoy · ${planTodos.size} receta${planTodos.size === 1 ? '' : 's'}`}
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
          <label className="mb-1 block text-xs font-medium text-gray-700">Postre</label>
          <select
            value={productoId}
            onChange={(e) => {
              setProductoId(e.target.value);
              setError('');
            }}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
          >
            <option value="">— Elegí el postre —</option>
            {productosVisibles.map((p) => {
              const planeada = p.receta_id ? planTodos.get(p.receta_id) : undefined;
              return (
                <option key={p.id} value={p.id}>
                  {planeada ? '📋 ' : ''}
                  {p.nombre}
                  {planeada
                    ? ` · ${planeada} receta${planeada === 1 ? '' : 's'} planificada${planeada === 1 ? '' : 's'}`
                    : ''}
                </option>
              );
            })}
          </select>
          {productos && productos.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-600">
              No hay postres con control de stock en este local.
            </p>
          )}
        </div>

        {productoSel && (
          <>
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
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Porciones que salieron
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={porcionesOut}
                  onChange={(e) => setPorcionesOut(normalizarDecimal(e.target.value))}
                  placeholder={rinde > 0 ? `ej: ${Math.round(nRecetas * rinde)}` : 'ej: 16'}
                  className="w-full rounded border border-gray-300 px-3 py-2.5 text-right text-sm tabular-nums"
                />
              </div>
            </div>
            {rinde > 0 && (
              <p className="text-[11px] text-gray-500">
                Referencia: ~{formatNum(rinde)} porciones por receta × {nRecetas} = ~
                {Math.round(nRecetas * rinde)}. Anotá lo que realmente salió.
              </p>
            )}

            <IngredientesGrilla
              recetaId={recetaId}
              onChange={onGrillaChange}
              multiplicador={nRecetas}
              onValidezChange={setIngredientesOk}
            />
          </>
        )}

        {error && <p className="text-xs font-medium text-red-600">{error}</p>}

        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full rounded bg-pink-600 py-2.5 text-sm font-semibold text-white hover:bg-pink-700 disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Guardar pastelería'}
        </button>
      </div>
    </div>
  );
}

// ── FormMila (milanesa por kg de cuadril — Saavedra) ───────────────────────────
// La subreceta "Milanesa de carne" (rol='milanesa_base') está definida por 1 kg
// de cuadril. El cocinero ingresa los kg de cuadril a empanar; la grilla escala
// los ingredientes (multiplicador = kg) como checklist, y se registra la
// producción en kg de milanesa = kg cuadril × rendimiento. SUMA al stock (no
// reemplaza). Vinculado al plan vía recetaIdsPlan (tipo 'milanesa' del pizarrón).
function FormMila({
  local,
  recetasMilanesa,
  recetaIdsPlan,
  onGuardado,
  onVolver,
}: {
  local: string;
  recetasMilanesa: Receta[];
  recetaIdsPlan?: Map<string, number>;
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const [recetaId, setRecetaId] = useState(
    recetasMilanesa.length === 1 ? recetasMilanesa[0].id : '',
  );
  const [kgBruta, setKgBruta] = useState('');
  const [kgCuadril, setKgCuadril] = useState('');
  const [kgMilanesa, setKgMilanesa] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([]);
  const [ingredientesOk, setIngredientesOk] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), []);

  // Auto-seleccionar si hay una sola receta (puede llegar async).
  useEffect(() => {
    if (!recetaId && recetasMilanesa.length === 1) setRecetaId(recetasMilanesa[0].id);
  }, [recetasMilanesa, recetaId]);

  const recetaSel = recetasMilanesa.find((r) => r.id === recetaId);
  const rinde = recetaSel?.rendimiento_kg ?? null; // kg de milanesa por kg de cuadril (teórico)
  const kg = parseDecimal(kgCuadril); // carne lista para empanar (cuadril limpio)
  // Carne bruta (como viene) − carne lista = desperdicio de la limpieza (venas/grasa).
  const bruta = parseDecimal(kgBruta);
  const desperdicio = bruta > 0 && kg > 0 ? +(bruta - kg).toFixed(3) : null;
  const desperdicioPct = desperdicio != null && bruta > 0 ? (desperdicio / bruta) * 100 : null;
  const kgMilanesaTeorico = rinde && kg > 0 ? kg * rinde : 0;
  const kgMilanesaNum = parseDecimal(kgMilanesa);
  const rindeReal = kg > 0 && kgMilanesaNum > 0 ? kgMilanesaNum / kg : null;
  const planCant = recetaId ? recetaIdsPlan?.get(recetaId) : undefined;

  // Prefill editable: arranca en el teórico (kg cuadril × rinde) y el cocinero lo
  // ajusta al peso REAL que salió. Ese peso real es el que va al stock; comparado
  // con los kg de cuadril, sirve para calibrar el rinde de a poco.
  useEffect(() => {
    if (rinde && kg > 0) setKgMilanesa(String(+(kg * rinde).toFixed(3)).replace('.', ','));
    else setKgMilanesa('');
  }, [kg, rinde]);

  // Cargado hoy (con suma, cargar dos veces duplica → mostrarlo evita duplicar).
  const { data: cargasHoy } = useQuery({
    queryKey: ['cocina-lotes-produccion-qr', local, 'milanesa', hoy()],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('cocina_lotes_produccion')
        .select('cantidad_producida, unidad, responsable, created_at')
        .eq('fecha', hoy())
        .eq('local', local)
        .eq('categoria', 'milanesa')
        .order('created_at', { ascending: false });
      if (e) throw e;
      return (data ?? []) as {
        cantidad_producida: number;
        unidad: string;
        responsable: string | null;
        created_at: string;
      }[];
    },
  });
  const cargasHoyItems = useMemo<CargaHoyItem[]>(
    () =>
      (cargasHoy ?? []).map((c) => ({
        nombre: 'Milanesa',
        detalle: `${formatNum(Number(c.cantidad_producida))} ${c.unidad}`,
        hora: horaDe(c.created_at),
        responsable: c.responsable,
      })),
    [cargasHoy],
  );

  async function guardar() {
    if (!recetaId) {
      setError('Elegí la receta de milanesa');
      return;
    }
    if (!rinde || rinde <= 0) {
      setError('La receta no tiene rendimiento cargado (kg de milanesa por kg de cuadril).');
      return;
    }
    if (!kg || kg <= 0) {
      setError('Indicá los kg de carne lista para empanar');
      return;
    }
    if (bruta > 0 && bruta < kg) {
      setError('La carne bruta no puede ser menor que la carne lista para empanar.');
      return;
    }
    if (!kgMilanesaNum || kgMilanesaNum <= 0) {
      setError('Indicá los kg de milanesa que salieron');
      return;
    }
    if (!responsable.trim()) {
      setError('Elegí responsable');
      return;
    }
    if (!ingredientesOk) {
      setError('Tildá todos los ingredientes pesados antes de guardar');
      return;
    }
    setGuardando(true);
    setError('');
    const { error: err } = await supabase.from('cocina_lotes_produccion').insert({
      fecha: hoy(),
      local,
      categoria: 'milanesa',
      receta_id: recetaId,
      nombre_libre: null,
      cantidad_producida: kgMilanesaNum,
      unidad: 'kg',
      responsable: responsable.trim(),
      notas:
        (bruta > 0 ? `Bruta ${formatNum(bruta)} kg · ` : '') +
        `Lista ${formatNum(kg)} kg de cuadril` +
        (desperdicio != null && desperdicio > 0
          ? ` · desperdicio ${formatNum(desperdicio)} kg${desperdicioPct != null ? ` (${desperdicioPct.toFixed(1).replace('.', ',')}%)` : ''}`
          : '') +
        (rindeReal != null ? ` · rinde ${formatNum(rindeReal)} kg/kg` : '') +
        (notas.trim() ? ` — ${notas.trim()}` : ''),
      ingredientes_reales: ingredientesReales.length > 0 ? ingredientesReales : null,
      en_stock: true,
    });
    if (err) {
      setError(mensajeErrorAmigable(err, 'No se pudo guardar la producción de milanesa'));
      setGuardando(false);
      return;
    }
    onGuardado(`Milanesa — ${formatNum(kgMilanesaNum)} kg (de ${formatNum(kg)} kg de cuadril)`);
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cargar Milanesas</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      <CargasHoyResumen items={cargasHoyItems} />

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <ResponsableSelect
          local={local as 'vedia' | 'saavedra'}
          value={responsable}
          onChange={setResponsable}
        />

        {recetasMilanesa.length === 0 ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            No hay receta de milanesa configurada para este local.
          </div>
        ) : (
          <>
            {recetasMilanesa.length > 1 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Receta de milanesa
                </label>
                <select
                  value={recetaId}
                  onChange={(e) => setRecetaId(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Elegí…</option>
                  {recetasMilanesa.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {planCant != null && planCant > 0 && (
              <div className="rounded border border-rodziny-200 bg-rodziny-50 px-3 py-2 text-xs text-rodziny-800">
                📋 Planificado hoy: {formatNum(planCant * (rinde ?? 1.5))} kg de milanesa (≈{' '}
                {formatNum(planCant)} kg de cuadril a empanar)
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Carne bruta (kg){' '}
                <span className="font-normal text-gray-400">— cuadril como viene</span>
              </label>
              <input
                inputMode="decimal"
                value={kgBruta}
                onChange={(e) => setKgBruta(normalizarDecimal(e.target.value))}
                placeholder="Ej: 6"
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Carne lista para empanar (kg){' '}
                <span className="font-normal text-gray-400">— ya limpio, sin venas/grasa</span>
              </label>
              <input
                inputMode="decimal"
                value={kgCuadril}
                onChange={(e) => setKgCuadril(normalizarDecimal(e.target.value))}
                placeholder="Ej: 5"
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
              />
              {desperdicio != null && desperdicio > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  Desperdicio (limpieza): {formatNum(desperdicio)} kg
                  {desperdicioPct != null
                    ? ` · ${desperdicioPct.toFixed(1).replace('.', ',')}%`
                    : ''}
                </p>
              )}
              {kg > 0 && rinde != null && (
                <p className="mt-1 text-xs text-gray-500">
                  Teórico ≈ {formatNum(kgMilanesaTeorico)} kg ({formatNum(rinde)} kg por kg de cuadril)
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Kg de milanesa que salieron
              </label>
              <input
                inputMode="decimal"
                value={kgMilanesa}
                onChange={(e) => setKgMilanesa(normalizarDecimal(e.target.value))}
                placeholder="Ej: 7,5"
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
              />
              {rindeReal != null && (
                <p className="mt-1 text-xs text-gray-600">
                  Rinde real:{' '}
                  <span className="font-semibold text-gray-800">{formatNum(rindeReal)} kg</span> por kg de
                  cuadril
                  {rinde != null && Math.abs(rindeReal - rinde) > 0.01 && (
                    <span className="text-amber-600"> · teórico {formatNum(rinde)}</span>
                  )}
                </p>
              )}
            </div>

            {recetaId && kg > 0 && (
              <IngredientesGrilla
                recetaId={recetaId}
                multiplicador={kg}
                onChange={onGrillaChange}
                onValidezChange={setIngredientesOk}
              />
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Notas (opcional)</label>
              <input
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Ej: tanda de la mañana"
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button
              onClick={guardar}
              disabled={guardando}
              className="w-full rounded bg-red-700 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {guardando ? 'Guardando...' : 'Sumar milanesas al stock'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── FormGenerico (salsa/postre/pasteleria/panaderia) ───────────────────────────

const CATEGORIA_LABEL: Record<CategoriaGenerica, string> = {
  salsa: 'Salsa',
  postre: 'Postre',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  pasta: 'Pasta',
  milanesa: 'Milanesas',
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
  productosLibres,
  onGuardado,
  onVolver,
}: {
  local: string;
  categoria: CategoriaGenerica;
  recetas: Receta[];
  recetaIdsPlan?: Map<string, number>;
  permitirLibre?: boolean;
  permitirLitros?: boolean;
  // Catálogo de productos para carga recipe-independent (Saavedra pasta/milanesa):
  // el cocinero elige de esta lista y se guarda como nombre_libre. Stock = overwrite.
  productosLibres?: { id: string; nombre: string }[];
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
    categoria === 'salsa' || categoria === 'panaderia' ? 'kg' : 'unid',
  );
  const [merma, setMerma] = useState('');
  const [mermaMotivo, setMermaMotivo] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([]);
  const [ingredientesOk, setIngredientesOk] = useState(true);
  const [enStock, setEnStock] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), []);

  const recetaSel = recetas.find((r) => r.id === recetaId);
  const unidades = unidadesDisponibles(categoria, permitirLitros);
  const titulo = `Cargar ${CATEGORIA_LABEL[categoria]}`;
  // Postres, pastelería y salsa se ACUMULAN: cada carga es un lote nuevo que se
  // suma al stock. El cierre físico (Mostrador) es el único que re-baselinea con
  // el conteo real. Pasta/milanesa siguen overwrite ("último pesaje manda").
  const esAditivo =
    categoria === 'postre' || categoria === 'pasteleria' || categoria === 'salsa';

  // Lo cargado hoy de esta categoría: sirve para (a) el historial "ya cargaste
  // hoy" arriba del form, y (b) avisar en salsas que la próxima carga se suma al
  // total (no reemplaza).
  const { data: cargasHoy } = useQuery({
    queryKey: ['cocina-lotes-produccion-qr', local, categoria, hoy()],
    queryFn: async () => {
      const { data, error: qerr } = await supabase
        .from('cocina_lotes_produccion')
        .select('receta_id, nombre_libre, cantidad_producida, unidad, responsable, created_at')
        .eq('fecha', hoy())
        .eq('local', local)
        .eq('categoria', categoria)
        .order('created_at', { ascending: false });
      if (qerr) throw qerr;
      return (data ?? []) as {
        receta_id: string | null;
        nombre_libre: string | null;
        cantidad_producida: number;
        unidad: string;
        responsable: string | null;
        created_at: string;
      }[];
    },
  });

  // Items para el panel "ya cargaste hoy" (cronológico, más reciente arriba).
  const cargasHoyItems = useMemo<CargaHoyItem[]>(
    () =>
      (cargasHoy ?? []).map((c) => ({
        nombre:
          (c.receta_id ? recetas.find((r) => r.id === c.receta_id)?.nombre : null) ??
          c.nombre_libre ??
          CATEGORIA_LABEL[categoria],
        detalle: `${formatNum(Number(c.cantidad_producida))} ${c.unidad}`,
        hora: horaDe(c.created_at),
        responsable: c.responsable,
      })),
    [cargasHoy, recetas, categoria],
  );

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
      setError('Elegí responsable');
      return;
    }
    if (!ingredientesOk) {
      setError('Tildá todos los ingredientes pesados antes de guardar');
      return;
    }
    if (recetaSel?.rendimiento_kg && unidadesComparables && cantNum > 0) {
      const veredictoG = evaluarCantidadVsTeorico(cantNum, recetaSel.rendimiento_kg);
      if (veredictoG === 'bloquea') {
        setError(
          `${formatNum(cantNum)} ${unidad} es ${Math.round(cantNum / recetaSel.rendimiento_kg)}× el rendimiento de "${recetaSel.nombre}" (${formatNum(recetaSel.rendimiento_kg)} ${unidadReceta(recetaSel)}). Revisá la coma decimal (1,8 = un kilo ochocientos).`,
        );
        return;
      }
      if (veredictoG === 'confirma') {
        const ok = window.confirm(
          `Estás por guardar ${formatNum(cantNum)} ${unidad} de ${recetaSel.nombre}, ` +
            `pero la receta suele rendir ${formatNum(recetaSel.rendimiento_kg)} ${unidadReceta(recetaSel)}. ` +
            `¿Es correcto?\n\n` +
            `Si quisiste poner 1,8 (un kilo ochocientos), usá la coma como separador decimal.`,
        );
        if (!ok) return;
      }
    }
    if (categoria === 'salsa') {
      const nombre = recetaSel?.nombre ?? nombreLibre.trim() ?? 'esta salsa';
      const ok = window.confirm(
        `Vas a sumar ${formatNum(cantNum)} ${unidad} de ${nombre} al stock total.\n\n` +
          `Esta cantidad se suma al stock actual (no lo reemplaza).\n` +
          `El stock se re-baselinea sólo cuando se hace el cierre físico de salsas.\n\n` +
          `¿Confirmás?`,
      );
      if (!ok) return;
    }
    setGuardando(true);
    setError('');

    // Overwrite — "último pesaje manda". Antes de cargar el lote nuevo a stock,
    // desactivamos los lotes activos previos de esta misma receta (o nombre
    // libre) + local, para que no se acumulen batch tras batch. Aplica a pasta /
    // milanesa. Salsa, postres y pastelería NO entran acá: se acumulan (cada
    // carga es un lote más) y el cierre físico de /mostrador re-baselinea el
    // stock con lo contado. Solo cuando este lote va a stock (enStock).
    if (enStock && !esAditivo) {
      let qOff = supabase
        .from('cocina_lotes_produccion')
        .update({ en_stock: false })
        .eq('local', local)
        .eq('en_stock', true);
      if (recetaId) {
        qOff = qOff.eq('receta_id', recetaId);
      } else {
        qOff = qOff.eq('nombre_libre', nombreLibre.trim()).is('receta_id', null);
      }
      const { error: errOff } = await qOff;
      if (errOff) {
        setError(mensajeErrorAmigable(errOff, 'No se pudo actualizar el stock anterior'));
        setGuardando(false);
        return;
      }
    }

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
      setError(mensajeErrorAmigable(err, 'No se pudo guardar la producción'));
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

      <CargasHoyResumen items={cargasHoyItems} />

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <ResponsableSelect
          local={local as 'vedia' | 'saavedra'}
          value={responsable}
          onChange={setResponsable}
        />
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

        {permitirLibre && productosLibres && productosLibres.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              {CATEGORIA_LABEL[categoria]}
            </label>
            <select
              value={nombreLibre}
              onChange={(e) => setNombreLibre(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
            >
              <option value="">— Elegir —</option>
              {productosLibres.map((p) => (
                <option key={p.id} value={p.nombre}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        {permitirLibre && !productosLibres && (
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
              Si guardás de nuevo, esta cantidad <strong>se suma</strong> al stock total.
            </p>
          </div>
        )}

        {esAditivo && (
          <div className="rounded border border-pink-200 bg-pink-50 px-3 py-2 text-[11px] text-pink-800">
            Cada carga <strong>se suma</strong> al stock. Cargá solo lo que
            produjiste recién, no el total — el cierre físico corrige lo que sobró.
          </div>
        )}

        <IngredientesGrilla
          recetaId={recetaId || null}
          onChange={onGrillaChange}
          onValidezChange={setIngredientesOk}
        />

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
              {(unidad === 'kg' || unidad === 'lt') && equivalenteKgGramos(cantNum)
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
            {(unidad === 'kg' || unidad === 'lt') &&
              parseDecimal(merma) > 0 &&
              equivalenteKgGramos(parseDecimal(merma)) && (
                <p className="mt-1 text-[11px] text-gray-500">
                  = {equivalenteKgGramos(parseDecimal(merma))}
                </p>
              )}
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
          disabled={guardando || !ingredientesOk || !responsable.trim()}
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
      // Subrecetas y recetas categorizadas como 'otros' no son items vendibles/consumibles
      if (r.tipo === 'subreceta' || r.categoria === 'otros') continue;
      // r.categoria comparte vocabulario con cocina_productos.tipo (pasta/salsa/postre/etc),
      // así que sirve para detectar duplicación con el catálogo de productos.
      const tipoEquiv = r.categoria ?? '';
      if (
        productos.some(
          (p) =>
            p.local === local &&
            p.tipo === tipoEquiv &&
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
        tipo: tipoEquiv,
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
      setError('Elegí responsable');
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
      setError(mensajeErrorAmigable(errIns, 'No se pudo registrar la merma'));
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

      <ResponsableSelect
        local={local as 'vedia' | 'saavedra'}
        value={responsable}
        onChange={setResponsable}
      />

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
        {unidad === 'kg' &&
          parseDecimal(cantidad) > 0 &&
          equivalenteKgGramos(parseDecimal(cantidad)) && (
            <p className="mt-1 text-[11px] text-gray-500">
              = {equivalenteKgGramos(parseDecimal(cantidad))}
            </p>
          )}
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

      {error && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando || !responsable.trim()}
        className="w-full rounded-lg bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
      >
        {guardando ? 'Guardando...' : 'Registrar Merma'}
      </button>
    </div>
  );
}

