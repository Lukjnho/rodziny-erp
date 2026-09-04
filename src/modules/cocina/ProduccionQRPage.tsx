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
import { hoyAR } from '@/lib/fechaAR';

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Producto {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  local: string;
  es_mixto: boolean;
  /**
   * Si esta pasta se arma con un lote de relleno. Lo DECLARA el producto: antes
   * se deducía de si el operario había elegido relleno, y esa deducción hizo
   * desaparecer el mezzelune de bondiola (migración 160).
   */
  lleva_relleno: boolean | null;
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
  // Vedia (puré de papa): ratios de semolín/huevo por kg de puré que se agregan
  // recién al armar el ñoqui. Sirven para distinguir el puré "estilo Vedia"
  // (condimentos en el relleno) del de Saavedra (todo itemizado al armar).
  g_semolin_por_kg: number | null;
  g_huevo_por_kg: number | null;
  // Saavedra (puré SG): lista de ingredientes que se agregan al armar el ñoqui.
  // Cuando está cargada, los condimentos NO se piden en el relleno.
  ingredientes_armado: IngredienteArmado[] | null;
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
  receta?: { nombre: string; rol?: string | null } | null;
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

/**
 * Un renglón del plan de hoy, listo para dibujar como botón en la pantalla de
 * inicio. `vista` es adónde lleva el toque y `recetaId` lo que queda elegido al
 * llegar: la idea es que el cocinero NO tenga que adivinar en qué categoría
 * está lo que le toca hacer.
 */
type RenglonPlan = {
  vista: Vista;
  recetaId: string;
  nombre: string;
  cantidad: number;
  color: string;
  /** Ya se cargó un lote contra este renglón. Se sigue pudiendo tocar. */
  hecho: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

// Día operativo AR: una carga de noche debe imputarse al día que se trabajó,
// no al siguiente (que es lo que hacía toISOString() en UTC). Ver hoyAR.
function hoy() {
  return hoyAR();
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

// ── Lo hecho, para MIRAR desde la tablet ─────────────────────────────────────
// Un renglón por lote, venga de la tabla que venga (pasta, relleno, masa o la
// genérica de salsas/postres/panadería/milanesas). Alimenta "✅ Hecho hoy", el
// calendario y la ficha que se abre al tocar un lote: es lo que el chef tenía
// que ir a mirar a la PC (Cocina › Producción › Lotes registrados).

type CatHecho =
  | 'pasta'
  | 'relleno'
  | 'masa'
  | 'salsa'
  | 'postre'
  | 'pasteleria'
  | 'panaderia'
  | 'milanesa';

const CAT_HECHO_ORDEN: CatHecho[] = [
  'pasta',
  'relleno',
  'masa',
  'salsa',
  'postre',
  'pasteleria',
  'panaderia',
  'milanesa',
];
const CAT_HECHO_LABEL: Record<CatHecho, string> = {
  pasta: 'Pastas',
  relleno: 'Rellenos',
  masa: 'Masas',
  salsa: 'Salsas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  milanesa: 'Milanesas',
};
// Mismo color que el botón de cargar de cada cosa, para reconocerlo de un vistazo.
const CAT_HECHO_COLOR: Record<CatHecho, string> = {
  pasta: 'bg-rodziny-700',
  relleno: 'bg-green-600',
  masa: 'bg-amber-500',
  salsa: 'bg-orange-500',
  postre: 'bg-pink-500',
  pasteleria: 'bg-pink-500',
  panaderia: 'bg-yellow-600',
  milanesa: 'bg-red-700',
};
// Adónde lleva "Cargar otra tanda" para lo que vive en la tabla genérica.
const VISTA_POR_CATEGORIA: Record<string, Vista> = {
  salsa: 'salsa',
  postre: 'postre',
  pasteleria: 'pasteleria',
  panaderia: 'panaderia',
  milanesa: 'milanesa',
  pasta: 'pasta-stock',
};

interface LoteHecho {
  id: string;
  cat: CatHecho;
  fecha: string;
  createdAt: string | null;
  nombre: string;
  /** Cantidad ya formateada: "12,5 kg", "40 bandejas", "120 porciones". */
  cantidadStr: string;
  /** Solo las pastas tienen código. Es el que va escrito en el cajón. */
  codigo: string | null;
  responsable: string | null;
  notas: string | null;
  /** Adónde lleva "Cargar otra tanda" y qué queda elegido al llegar. */
  vista: Vista;
  preseleccionId: string | null;
  pasta?: {
    ubicacion: string | null;
    porciones: number | null;
    cantidadCajones: number | null;
    rellenoNombre: string | null;
    rellenoKg: number | null;
    masas: { nombre: string; kg: number | null }[];
    fechaPorcionado: string | null;
    responsablePorcionado: string | null;
    porcionadoAt: string | null;
  };
}

// Supabase devuelve un embed como objeto o como array según cómo esté el FK.
function uno<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

type EmbNombre = { nombre: string } | { nombre: string }[] | null;
type FilaPastaHecho = {
  id: string;
  codigo_lote: string;
  fecha: string;
  created_at: string | null;
  responsable: string | null;
  notas: string | null;
  ubicacion: string | null;
  porciones: number | null;
  cantidad_cajones: number | null;
  producto_id: string;
  relleno_kg: number | null;
  masa_kg: number | null;
  fecha_porcionado: string | null;
  responsable_porcionado: string | null;
  porcionado_at: string | null;
  producto: EmbNombre;
  lote_relleno: { receta: EmbNombre } | { receta: EmbNombre }[] | null;
  receta_masa: EmbNombre;
  masas:
    | {
        masa_kg: number | null;
        lote_masa: { receta: EmbNombre } | { receta: EmbNombre }[] | null;
      }[]
    | null;
};
type FilaSimpleHecho = {
  id: string;
  receta_id: string | null;
  fecha: string;
  created_at: string | null;
  responsable: string | null;
  notas: string | null;
  receta: EmbNombre;
};
type FilaGenericaHecho = FilaSimpleHecho & {
  categoria: string;
  nombre_libre: string | null;
  cantidad_producida: number;
  unidad: string;
};

const SELECT_PASTA_HECHO =
  'id, codigo_lote, fecha, created_at, responsable, notas, ubicacion, porciones, cantidad_cajones, ' +
  'producto_id, relleno_kg, masa_kg, fecha_porcionado, responsable_porcionado, porcionado_at, ' +
  'producto:cocina_productos(nombre), ' +
  'lote_relleno:cocina_lotes_relleno(receta:cocina_recetas(nombre)), ' +
  'receta_masa:cocina_recetas(nombre), ' +
  'masas:cocina_lotes_pasta_masas(masa_kg, lote_masa:cocina_lotes_masa(receta:cocina_recetas(nombre)))';

function kgStr(v: number | null | undefined): string {
  return v == null ? '' : `${formatNum(Number(v))} kg`;
}

function pastaAHecho(r: FilaPastaHecho): LoteHecho {
  const masas: { nombre: string; kg: number | null }[] = [];
  const recetaMasa = uno(r.receta_masa);
  if (recetaMasa) masas.push({ nombre: recetaMasa.nombre, kg: r.masa_kg });
  // Pastas mixtas: el lote no apunta a una masa; el detalle está en la puente.
  for (const m of r.masas ?? []) {
    const rec = uno(uno(m.lote_masa)?.receta);
    masas.push({ nombre: rec?.nombre ?? 'Masa', kg: m.masa_kg });
  }
  // Con relleno nace en bandejas y recién al porcionar tiene porciones; sin
  // relleno nace directo en porciones. Mostramos lo más avanzado que haya.
  const cantidadStr =
    r.porciones != null
      ? `${formatNum(Number(r.porciones))} porciones`
      : r.cantidad_cajones != null
        ? `${formatNum(Number(r.cantidad_cajones))} bandejas`
        : '';
  return {
    id: r.id,
    cat: 'pasta',
    fecha: r.fecha,
    createdAt: r.created_at,
    nombre: uno(r.producto)?.nombre ?? 'Pasta',
    cantidadStr,
    codigo: r.codigo_lote,
    responsable: r.responsable,
    notas: r.notas,
    vista: 'pasta',
    preseleccionId: r.producto_id,
    pasta: {
      ubicacion: r.ubicacion,
      porciones: r.porciones,
      cantidadCajones: r.cantidad_cajones,
      rellenoNombre: uno(uno(r.lote_relleno)?.receta)?.nombre ?? null,
      rellenoKg: r.relleno_kg,
      masas,
      fechaPorcionado: r.fecha_porcionado,
      responsablePorcionado: r.responsable_porcionado,
      porcionadoAt: r.porcionado_at,
    },
  };
}

/**
 * Todo lo que se cargó en el local entre dos fechas (día operativo, ambas
 * incluidas), de las 4 tablas de lotes, del más nuevo al más viejo.
 */
function useLotesHechos(local: 'vedia' | 'saavedra', desde: string, hasta: string) {
  return useQuery({
    queryKey: ['cocina-hechos-qr', local, desde, hasta],
    queryFn: async (): Promise<LoteHecho[]> => {
      const [pastas, rellenos, masas, genericos] = await Promise.all([
        supabase
          .from('cocina_lotes_pasta')
          .select(SELECT_PASTA_HECHO)
          .eq('local', local)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('created_at', { ascending: false }),
        supabase
          .from('cocina_lotes_relleno')
          .select(
            'id, receta_id, peso_total_kg, fecha, created_at, responsable, notas, receta:cocina_recetas(nombre)',
          )
          .eq('local', local)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('created_at', { ascending: false }),
        supabase
          .from('cocina_lotes_masa')
          .select(
            'id, receta_id, kg_producidos, fecha, created_at, responsable, notas, receta:cocina_recetas(nombre)',
          )
          .eq('local', local)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('created_at', { ascending: false }),
        // Solo lo PRODUCIDO: el grueso de esta tabla son filas de cierre (el
        // conteo que vuelve a fijar el stock), y eso no es trabajo hecho.
        supabase
          .from('cocina_lotes_produccion')
          .select(
            'id, categoria, receta_id, nombre_libre, cantidad_producida, unidad, fecha, created_at, responsable, notas, receta:cocina_recetas(nombre)',
          )
          .eq('local', local)
          .eq('origen', 'produccion')
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('created_at', { ascending: false }),
      ]);
      for (const r of [pastas, rellenos, masas, genericos]) if (r.error) throw r.error;

      const out: LoteHecho[] = [];
      for (const r of (pastas.data ?? []) as unknown as FilaPastaHecho[]) out.push(pastaAHecho(r));
      for (const r of (rellenos.data ?? []) as unknown as (FilaSimpleHecho & {
        peso_total_kg: number;
      })[]) {
        out.push({
          id: r.id,
          cat: 'relleno',
          fecha: r.fecha,
          createdAt: r.created_at,
          nombre: uno(r.receta)?.nombre ?? 'Relleno',
          cantidadStr: kgStr(r.peso_total_kg),
          codigo: null,
          responsable: r.responsable,
          notas: r.notas,
          vista: 'relleno',
          preseleccionId: r.receta_id,
        });
      }
      for (const r of (masas.data ?? []) as unknown as (FilaSimpleHecho & {
        kg_producidos: number;
      })[]) {
        out.push({
          id: r.id,
          cat: 'masa',
          fecha: r.fecha,
          createdAt: r.created_at,
          nombre: uno(r.receta)?.nombre ?? 'Masa',
          cantidadStr: kgStr(r.kg_producidos),
          codigo: null,
          responsable: r.responsable,
          notas: r.notas,
          vista: 'masa',
          preseleccionId: r.receta_id,
        });
      }
      for (const r of (genericos.data ?? []) as unknown as FilaGenericaHecho[]) {
        const cat = (CAT_HECHO_ORDEN as string[]).includes(r.categoria)
          ? (r.categoria as CatHecho)
          : 'salsa';
        out.push({
          id: r.id,
          cat,
          fecha: r.fecha,
          createdAt: r.created_at,
          nombre: r.nombre_libre ?? uno(r.receta)?.nombre ?? CAT_HECHO_LABEL[cat],
          cantidadStr: `${formatNum(Number(r.cantidad_producida))} ${r.unidad === 'unid' ? 'u' : r.unidad}`,
          codigo: null,
          responsable: r.responsable,
          notas: r.notas,
          vista: VISTA_POR_CATEGORIA[r.categoria] ?? 'inicio',
          // Pastelería, panadería y milanesa eligen adentro de su formulario.
          preseleccionId: cat === 'salsa' || cat === 'postre' ? r.receta_id : null,
        });
      }
      out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      return out;
    },
  });
}

/** Busca un lote de pasta por su código (lo que está escrito en el cajón). */
async function buscarLotePorCodigo(local: string, codigo: string): Promise<LoteHecho | null> {
  // Los códigos son solo minúsculas, números y guiones (los 389 de la base):
  // se normaliza y se compara exacto. Sin comodines de ningún tipo.
  const limpio = codigo.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!limpio) return null;
  const { data, error } = await supabase
    .from('cocina_lotes_pasta')
    .select(SELECT_PASTA_HECHO)
    .eq('local', local)
    .eq('codigo_lote', limpio)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const fila = (data ?? [])[0] as unknown as FilaPastaHecho | undefined;
  return fila ? pastaAHecho(fila) : null;
}

// Fechas como texto (YYYY-MM-DD) con aritmética local, sin pasar por UTC:
// a las 22:00 de Argentina toISOString() ya está en mañana.
function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const dt = new Date(a, m - 1, d + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
/** Lunes de la semana a la que pertenece la fecha (la cocina opera lun-dom). */
function lunesDe(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const dow = new Date(a, m - 1, d).getDay(); // 0 = domingo
  return sumarDias(fecha, -((dow + 6) % 7));
}
function ddmm(fecha: string): string {
  const [, m, d] = fecha.split('-');
  return `${d}/${m}`;
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
  // Receta que quedó elegida al tocar un renglón del plan. Se limpia al volver
  // al inicio para que la próxima entrada "a mano" no arrastre la anterior.
  const [recetaPreseleccionada, setRecetaPreseleccionada] = useState<string | null>(null);
  const irA = useCallback((v: Vista, recetaId?: string) => {
    setRecetaPreseleccionada(recetaId ?? null);
    setVista(v);
  }, []);
  const [mensajeExito, setMensajeExito] = useState('');
  // Código del lote recién guardado, para mostrarlo grande en la pantalla de OK.
  const [codigoExito, setCodigoExito] = useState<string | null>(null);

  // Catálogos
  const { data: productos } = useQuery({
    queryKey: ['cocina-productos-qr'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, tipo, local, es_mixto, lleva_relleno')
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
          'id, nombre, tipo, rol, categoria, rendimiento_kg, rendimiento_unidad, local, kg_por_bolsa, g_semolin_por_kg, g_huevo_por_kg, ingredientes_armado',
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
          'id, receta_id, kg_producidos, kg_sobrante, destino_sobrante, fecha, created_at, responsable, excluido_analisis, receta:cocina_recetas(nombre, rol)',
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

  // El plan de hoy convertido en botones para la pantalla de inicio. Se resuelve
  // el nombre contra las recetas del local: si una receta del plan no está en el
  // catálogo, ese renglón NO se dibuja — la pantalla no inventa un botón que
  // después no sabe adónde llevar.
  const renglonesPlan = useMemo<RenglonPlan[]>(() => {
    const destino: Partial<Record<keyof typeof planPorTipo, { vista: Vista; color: string }>> = {
      relleno: { vista: 'relleno', color: 'bg-green-600 hover:bg-green-700' },
      salsa: { vista: 'salsa', color: 'bg-orange-500 hover:bg-orange-600' },
      postre: { vista: 'postre', color: 'bg-pink-500 hover:bg-pink-600' },
      pasteleria: { vista: 'pasteleria', color: 'bg-pink-500 hover:bg-pink-600' },
      panaderia: { vista: 'panaderia', color: 'bg-yellow-600 hover:bg-yellow-700' },
      milanesa: { vista: 'milanesa', color: 'bg-red-700 hover:bg-red-800' },
    };
    const acum = new Map<string, RenglonPlan>();
    for (const it of planHoy ?? []) {
      if (!it.receta_id) continue;
      const d = destino[it.tipo as keyof typeof planPorTipo];
      if (!d) continue;
      const receta = recetasLocal.find((r) => r.id === it.receta_id);
      if (!receta) continue;
      const clave = `${it.tipo}|${it.receta_id}`;
      const previo = acum.get(clave);
      const cantidad = (previo?.cantidad ?? 0) + (Number(it.cantidad_recetas) || 1);
      // Se marca hecho solo si TODOS los renglones de esa receta están cerrados.
      // OJO: el pizarrón hoy tacha un pedido con la primera carga, aunque falte
      // cantidad. Por eso el renglón se muestra igual, tildado pero tocable:
      // esconderlo escondería trabajo que puede seguir pendiente de verdad.
      const hecho = (previo ? previo.hecho : true) && it.estado === 'ciclo_completo';
      acum.set(clave, {
        vista: d.vista,
        recetaId: it.receta_id,
        nombre: receta.nombre,
        cantidad,
        color: d.color,
        hecho,
      });
    }
    return [...acum.values()].sort((a, b) => {
      if (a.hecho !== b.hecho) return a.hecho ? 1 : -1; // lo pendiente, arriba
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  }, [planHoy, recetasLocal]);

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

  function onGuardado(msg: string, codigo?: string | null) {
    setMensajeExito(msg);
    setCodigoExito(codigo ?? null);
    setVista('exito');
    // Refrescar lotes para que aparezcan al cargar pasta
    qc.invalidateQueries({ queryKey: ['cocina-lotes-relleno-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-lotes-masa-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-lotes-produccion-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta-frescos-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-pastas-consumo-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-pasta-masas-consumo-qr'] });
    // Lo que se ve en el inicio: "Hecho hoy", el plan tachado y el calendario.
    qc.invalidateQueries({ queryKey: ['cocina-hechos-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta-hoy-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-plan-hoy-qr'] });
    qc.invalidateQueries({ queryKey: ['cocina-plan-mes-qr'] });
    // Refrescar todo el stock derivado (StockTab, Dashboard, Resumen, catálogo)
    // para que cualquier carga del QR se vea al instante en las pantallas abiertas.
    invalidarStockCocina(qc);
  }

  return (
    <Pantalla local={local}>
      {vista === 'inicio' && (
        <Inicio
          local={local}
          onIr={irA}
          lotesHoy={(lotesRellenoHoy ?? []).filter((l) => l.fecha === hoy()).length}
          masasAbiertas={masasAbiertas}
          frescosPendientes={frescosPendientes}
          renglonesPlan={renglonesPlan}
          rellenosDisponibles={rellenosDisponibles}
          masasDisponibles={masasDisponibles}
          lotesFrescos={lotesFrescos ?? []}
        />
      )}

      {vista === 'relleno' && (
        <FormRelleno
          local={local}
          recetas={recetasRelleno}
          recetaIdsPlan={planPorTipo.relleno}
          recetaIdInicial={recetaPreseleccionada ?? undefined}
          cargasHoy={cargasHoyRelleno}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'pasta' && (
        <FormPasta
          local={local}
          productos={productosPasta}
          lotesRelleno={rellenosDisponibles}
          lotesMasa={masasDisponibles.filter((m) => m.kg_sobrante === null)}
          pastaRecetas={pastaRecetas ?? []}
          productoIdInicial={recetaPreseleccionada ?? undefined}
          cargasHoy={cargasHoyPasta}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'porcionar-pasta' && (
        <FormPorcionar
          local={local}
          lotesFrescos={lotesFrescos ?? []}
          sobrantesPendientes={sobrantesPendientes ?? []}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'masa' && (
        <FormMasa
          local={local}
          recetas={recetasMasa}
          recetaIdInicial={recetaPreseleccionada ?? undefined}
          cargasHoy={cargasHoyMasa}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'cerrar-masa' && (
        <FormCerrarMasa
          lotesAbiertos={(lotesMasaHoy ?? []).filter(
            (m) => m.fecha === hoy() && m.kg_sobrante === null,
          )}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'salsa' && (
        <FormGenerico
          local={local}
          categoria="salsa"
          recetas={recetasSalsa}
          recetaIdsPlan={planPorTipo.salsa}
          recetaIdInicial={recetaPreseleccionada ?? undefined}
          onGuardado={onGuardado}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'postre' && (
        <FormGenerico
          local={local}
          categoria="postre"
          recetas={recetasPostre}
          recetaIdsPlan={planPorTipo.postre}
          recetaIdInicial={recetaPreseleccionada ?? undefined}
          onGuardado={onGuardado}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'pasteleria' && (
        <FormPasteleria
          local={local}
          recetaIdsPlan={planPorTipo.pasteleria}
          recetaIdsPlanPostre={planPorTipo.postre}
          onGuardado={onGuardado}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'panaderia' && (
        <FormPanaderia
          local={local}
          onGuardado={onGuardado}
          onVolver={() => irA('inicio')}
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
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'milanesa' && (
        <FormMila
          local={local}
          recetasMilanesa={recetasMilanesa}
          recetaIdsPlan={planPorTipo.milanesa}
          onGuardado={onGuardado}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'merma' && (
        <FormMerma
          local={local}
          productos={productos ?? []}
          recetas={recetas ?? []}
          onGuardado={onGuardado}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'traslado' && (
        <TrasladoPastasForm
          local={local}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => irA('inicio')}
        />
      )}

      {vista === 'exito' && (
        <Exito mensaje={mensajeExito} codigo={codigoExito} onOtro={() => irA('inicio')} />
      )}
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
  renglonesPlan = [],
  rellenosDisponibles = [],
  masasDisponibles = [],
  lotesFrescos = [],
}: {
  local: 'vedia' | 'saavedra';
  onIr: (v: Vista, recetaId?: string) => void;
  lotesHoy: number;
  masasAbiertas: number;
  frescosPendientes: number;
  /**
   * Lo que hay que hacer hoy, sacado del pizarrón. Si viene vacío, esta pantalla
   * queda EXACTAMENTE igual que antes: el peor caso es que no cambie nada.
   */
  renglonesPlan?: RenglonPlan[];
  /** Para "🔥 En curso": relleno sin armar, masa con kg sin usar, pasta sin porcionar. */
  rellenosDisponibles?: LoteRelleno[];
  masasDisponibles?: LoteMasa[];
  lotesFrescos?: LotePastaFresco[];
}) {
  const ahora = new Date();
  const fechaLabel = ahora.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const { faltantes: cierresFaltantes } = useCierresFaltantes(local, supabase);
  const [verMes, setVerMes] = useState(false);
  // Lote tocado (en "Hecho hoy", en el calendario o buscando por código).
  const [loteSel, setLoteSel] = useState<LoteHecho | null>(null);

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

      {/* El plan de hoy, arriba de todo y como botones grandes. Tocar uno lleva
          al formulario que YA existe con la receta puesta. Si no hay plan
          cargado, este bloque no se dibuja y la pantalla queda como siempre. */}
      {renglonesPlan.length > 0 && (
        <div className="rounded-lg border-2 border-rodziny-700 bg-rodziny-50 p-3">
          <p className="text-sm font-bold text-rodziny-800">📋 Hoy hay que hacer</p>
          <p className="mt-0.5 text-xs text-rodziny-700">
            Tocá lo que vas a hacer y se abre con la receta puesta.
          </p>
          <div className="mt-3 space-y-2">
            {renglonesPlan.map((r) => (
              <button
                key={`${r.vista}-${r.recetaId}`}
                onClick={() => onIr(r.vista, r.recetaId)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-4 py-4 text-left text-white shadow transition-transform active:scale-[0.98]',
                  r.color,
                  r.hecho && 'opacity-50',
                )}
              >
                <span className="text-base font-semibold leading-tight">
                  {r.hecho && <span className="mr-1">✓</span>}
                  {r.nombre}
                </span>
                <span className="shrink-0 rounded bg-black/20 px-2 py-1 text-sm font-bold">
                  ×{r.cantidad}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lo que quedó a medio camino y lo que ya se hizo hoy: lo que el chef
          tenía que ir a mirar a la PC. Tocar un lote abre su ficha. */}
      <EnCurso
        onIr={onIr}
        rellenos={rellenosDisponibles}
        masas={masasDisponibles}
        frescos={lotesFrescos}
      />
      <HechoHoy local={local} onVerLote={setLoteSel} />

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

      {/* El mes, plegado por defecto: la pantalla tiene que seguir abriendo en
          lo que hay que hacer AHORA, no en un calendario. */}
      <button
        onClick={() => setVerMes((v) => !v)}
        className="w-full rounded-lg border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 transition-transform active:scale-[0.98]"
      >
        📅 {verMes ? 'Ocultar el calendario' : 'Ver calendario (semana / mes)'}
      </button>
      {verMes && <CalendarioPlan local={local} onVerLote={setLoteSel} />}

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

      {loteSel && (
        <FichaLote
          lote={loteSel}
          onCerrar={() => setLoteSel(null)}
          onIr={(v, id) => {
            setLoteSel(null);
            onIr(v, id);
          }}
        />
      )}
    </div>
  );
}

// ── En curso: lo que quedó a medio camino ────────────────────────────────────
// Relleno hecho que todavía no se armó, masa con kg sin usar y pasta armada que
// no fue a cámara. Si no hay nada, el bloque no se dibuja. Mide lo que de
// verdad se consumió (kg armados contra el lote), NO la "masa abierta" de
// kg_sobrante, que desde este QR no se puede cerrar.
function EnCurso({
  onIr,
  rellenos,
  masas,
  frescos,
}: {
  onIr: (v: Vista) => void;
  rellenos: LoteRelleno[];
  masas: LoteMasa[];
  frescos: LotePastaFresco[];
}) {
  const items: { key: string; icono: string; label: string; detalle: string; vista: Vista }[] = [];
  for (const r of rellenos) {
    items.push({
      key: `r-${r.id}`,
      icono: '🥣',
      label: r.receta?.nombre ?? 'Relleno',
      detalle: `${kgStr(r.disponible_kg)} sin armar · ${ddmm(r.fecha)}`,
      vista: 'pasta',
    });
  }
  for (const m of masas) {
    // La masa de panadería se termina desde "Cargar Panadería", no acá.
    if (m.receta?.rol === 'masa_panaderia') continue;
    items.push({
      key: `m-${m.id}`,
      icono: '🫓',
      label: m.receta?.nombre ?? 'Masa',
      detalle: `${kgStr(m.disponible_kg)} sin usar · ${ddmm(m.fecha)}`,
      vista: 'pasta',
    });
  }
  for (const f of frescos) {
    items.push({
      key: `f-${f.id}`,
      icono: '🧊',
      label: `${f.codigo_lote} · ${f.producto?.nombre ?? 'Pasta'}`,
      detalle: `${f.cantidad_cajones ?? 0} bandejas sin porcionar · ${ddmm(f.fecha)}`,
      vista: 'porcionar-pasta',
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
      <p className="text-sm font-bold text-amber-800">🔥 En curso</p>
      <p className="mt-0.5 text-xs text-amber-700">Quedó a medio camino. Tocá para seguir.</p>
      <div className="mt-2 space-y-1.5">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => onIr(it.vista)}
            className="flex w-full items-center justify-between gap-2 rounded-lg bg-white px-3 py-3 text-left shadow-sm transition-transform active:scale-[0.98]"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-gray-900">
                <span className="mr-1">{it.icono}</span>
                {it.label}
              </span>
              <span className="block text-xs text-gray-500">{it.detalle}</span>
            </span>
            <span className="shrink-0 text-lg text-gray-400">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Hecho hoy: la lista que antes había que ir a mirar a la PC ───────────────
// Todo lo cargado hoy en el local, con chips por categoría, el código grande
// en las pastas, y un buscador que sirve igual tipeando o con la pistola de
// códigos (la pistola es un teclado: escribe y manda Enter).
function HechoHoy({
  local,
  onVerLote,
}: {
  local: 'vedia' | 'saavedra';
  onVerLote: (l: LoteHecho) => void;
}) {
  const hoyStr = hoy();
  const { data: hechos, isLoading, isError } = useLotesHechos(local, hoyStr, hoyStr);
  const [cat, setCat] = useState<CatHecho | 'todos'>('todos');
  const [busq, setBusq] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [msgBusq, setMsgBusq] = useState('');

  const porCat = useMemo(() => {
    const m = new Map<CatHecho, number>();
    for (const h of hechos ?? []) m.set(h.cat, (m.get(h.cat) ?? 0) + 1);
    return m;
  }, [hechos]);

  const q = busq.trim().toLowerCase();
  const visibles = useMemo(
    () =>
      (hechos ?? []).filter(
        (h) =>
          (cat === 'todos' || h.cat === cat) &&
          (!q || h.nombre.toLowerCase().includes(q) || (h.codigo ?? '').toLowerCase().includes(q)),
      ),
    [hechos, cat, q],
  );

  // Enter (o la pistola): si el código es de hoy se abre directo; si no, se
  // busca en la base entre todos los lotes del local, de cualquier fecha.
  async function buscarCodigo() {
    if (!q) return;
    const deHoy = (hechos ?? []).find((h) => h.codigo?.toLowerCase() === q);
    if (deHoy) {
      onVerLote(deHoy);
      setBusq('');
      return;
    }
    setBuscando(true);
    setMsgBusq('');
    try {
      const l = await buscarLotePorCodigo(local, q);
      if (l) {
        onVerLote(l);
        setBusq('');
      } else {
        setMsgBusq(`No hay ningún lote con el código "${busq.trim()}".`);
      }
    } catch (e) {
      setMsgBusq(mensajeErrorAmigable(e, 'No se pudo buscar el código'));
    } finally {
      setBuscando(false);
    }
  }

  const chips: (CatHecho | 'todos')[] = [
    'todos',
    ...CAT_HECHO_ORDEN.filter((c) => (porCat.get(c) ?? 0) > 0),
  ];
  const total = hechos?.length ?? 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-sm font-bold text-gray-800">✅ Hecho hoy{total > 0 ? ` · ${total}` : ''}</p>

      <div className="mt-2 flex gap-2">
        <input
          type="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Buscar o escanear código…"
          value={busq}
          onChange={(e) => {
            setBusq(e.target.value);
            setMsgBusq('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void buscarCodigo();
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-base"
        />
        <button
          type="button"
          onClick={() => void buscarCodigo()}
          disabled={!q || buscando}
          className="shrink-0 rounded-lg bg-gray-800 px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {buscando ? '…' : 'Buscar'}
        </button>
      </div>
      {msgBusq && <p className="mt-1 text-xs text-red-600">{msgBusq}</p>}

      {chips.length > 1 && (
        <div className="-mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3 pb-1">
          {chips.map((c) => {
            const n = c === 'todos' ? total : (porCat.get(c) ?? 0);
            const sel = c === cat;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold',
                  sel
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-300 bg-white text-gray-700',
                )}
              >
                {c === 'todos' ? 'Todos' : CAT_HECHO_LABEL[c]} · {n}
              </button>
            );
          })}
        </div>
      )}

      {isLoading && <p className="mt-2 text-center text-xs text-gray-400">Cargando…</p>}
      {isError && (
        <p className="mt-2 text-xs text-red-600">No se pudo leer lo cargado hoy. Probá de nuevo.</p>
      )}
      {!isLoading && !isError && total === 0 && (
        <p className="mt-2 text-xs text-gray-400">Todavía no se cargó nada hoy.</p>
      )}
      {!isLoading && total > 0 && visibles.length === 0 && (
        <p className="mt-2 text-xs text-gray-400">Nada de hoy coincide con eso.</p>
      )}
      {visibles.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {visibles.map((h) => (
            <FilaHecho key={`${h.cat}-${h.id}`} h={h} onVer={onVerLote} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilaHecho({
  h,
  onVer,
  mostrarFecha,
}: {
  h: LoteHecho;
  onVer: (l: LoteHecho) => void;
  mostrarFecha?: boolean;
}) {
  const enFreezer = h.pasta?.ubicacion === 'freezer_produccion';
  return (
    <button
      type="button"
      onClick={() => onVer(h)}
      className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-transform active:scale-[0.99] active:bg-gray-50"
    >
      <span className={cn('h-10 w-1.5 shrink-0 rounded-full', CAT_HECHO_COLOR[h.cat])} />
      <span className="min-w-0 flex-1">
        {h.codigo && (
          <span className="block font-mono text-lg font-bold uppercase leading-tight text-rodziny-900">
            {h.codigo}
          </span>
        )}
        <span className="block truncate text-sm font-semibold text-gray-900">{h.nombre}</span>
        <span className="block text-xs text-gray-500">
          {mostrarFecha ? `${ddmm(h.fecha)} · ` : ''}
          {horaDe(h.createdAt)}
          {h.responsable ? ` · ${h.responsable}` : ''}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-bold text-gray-800">{h.cantidadStr}</span>
        {h.pasta && (
          <span className={cn('block text-[11px]', enFreezer ? 'text-blue-600' : 'text-emerald-700')}>
            {enFreezer ? '⏳ falta porcionar' : '❄️ en cámara'}
          </span>
        )}
      </span>
    </button>
  );
}

// ── Ficha de un lote ─────────────────────────────────────────────────────────
// Se abre al tocar un lote (de "Hecho hoy", del calendario o buscando por
// código). Muestra el código grande, con qué se hizo y en qué estado está, y
// deja cargar otra tanda de lo mismo con la receta/pasta ya elegida.
function FichaLote({
  lote,
  onCerrar,
  onIr,
}: {
  lote: LoteHecho;
  onCerrar: () => void;
  onIr: (v: Vista, id?: string) => void;
}) {
  const p = lote.pasta;
  const enFreezer = p?.ubicacion === 'freezer_produccion';
  const hora = horaDe(lote.createdAt);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCerrar}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span
              className={cn(
                'inline-block rounded px-2 py-0.5 text-[11px] font-semibold text-white',
                CAT_HECHO_COLOR[lote.cat],
              )}
            >
              {CAT_HECHO_LABEL[lote.cat]}
            </span>
            <h3 className="mt-1 text-lg font-bold leading-tight text-gray-900">{lote.nombre}</h3>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="shrink-0 rounded px-3 py-1 text-2xl leading-none text-gray-400"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {lote.codigo && (
          <div className="mt-3 rounded-lg border-2 border-rodziny-700 bg-rodziny-50 p-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-rodziny-700">
              Código del lote
            </p>
            <p className="mt-0.5 select-all font-mono text-3xl font-bold uppercase text-rodziny-900">
              {lote.codigo}
            </p>
          </div>
        )}

        <dl className="mt-3 space-y-1.5 text-sm">
          <Dato k="Cantidad" v={lote.cantidadStr} />
          <Dato k="Fecha" v={`${ddmm(lote.fecha)}${hora ? ` · ${hora}` : ''}`} />
          <Dato k="Responsable" v={lote.responsable} />
          {p && (
            <Dato
              k="Relleno"
              v={
                p.rellenoNombre
                  ? `${p.rellenoNombre}${p.rellenoKg != null ? ` · ${kgStr(p.rellenoKg)}` : ''}`
                  : 'Sin relleno'
              }
            />
          )}
          {p && p.masas.length > 0 && (
            <Dato
              k={p.masas.length > 1 ? 'Masas' : 'Masa'}
              v={p.masas
                .map((m) => `${m.nombre}${m.kg != null ? ` · ${kgStr(m.kg)}` : ''}`)
                .join(' + ')}
            />
          )}
          {p && (
            <Dato
              k="Estado"
              v={
                enFreezer
                  ? '⏳ En freezer, falta porcionar'
                  : `❄️ En cámara${p.fechaPorcionado ? ` · porcionado ${ddmm(p.fechaPorcionado)}` : ''}${
                      p.responsablePorcionado ? ` por ${p.responsablePorcionado}` : ''
                    }`
              }
            />
          )}
          <Dato k="Notas" v={lote.notas} />
        </dl>

        <div className="mt-4 space-y-2">
          {enFreezer && (
            <button
              type="button"
              onClick={() => onIr('porcionar-pasta')}
              className="w-full rounded-lg bg-blue-600 py-3 text-base font-semibold text-white shadow transition-transform active:scale-[0.98]"
            >
              ✂️ Porcionar
            </button>
          )}
          {lote.vista !== 'inicio' && (
            <button
              type="button"
              onClick={() => onIr(lote.vista, lote.preseleccionId ?? undefined)}
              className="w-full rounded-lg bg-rodziny-700 py-3 text-base font-semibold text-white shadow transition-transform active:scale-[0.98]"
            >
              ➕ Cargar otra tanda
            </button>
          )}
          <button
            type="button"
            onClick={onCerrar}
            className="w-full rounded-lg border border-gray-300 py-3 text-sm font-semibold text-gray-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-gray-500">{k}</dt>
      <dd className="text-right font-medium text-gray-900">{v}</dd>
    </div>
  );
}

// ── Calendario del plan (solo mirar) ─────────────────────────────────────────
// Regla de Lucas (3-sep-2026): "no cambiar los días de las tareas que por ejemplo
// hice ayer, o las que hay que hacer mañana". Por eso esta vista NO carga nada:
// muestra el mes y el detalle del día tocado, y listo. La carga sigue siendo
// siempre contra HOY, así ningún lote queda con fecha de mañana ni una tarea de
// ayer se corre de lugar. Para terminar algo de ayer no hace falta venir acá:
// lo que quedó abierto ya aparece solo en el plan de hoy (carry-over).

const NOMBRE_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

type ItemMes = {
  fecha_objetivo: string;
  tipo: string;
  estado: string;
  cantidad_recetas: number | null;
  receta: { nombre: string } | null;
};

function CalendarioPlan({
  local,
  onVerLote,
}: {
  local: 'vedia' | 'saavedra';
  onVerLote: (l: LoteHecho) => void;
}) {
  const hoyStr = hoy();
  // Semana (lun-dom) por defecto: es lo que el chef mira a diario. El mes
  // queda a un toque.
  const [modo, setModo] = useState<'semana' | 'mes'>('semana');
  const [ancla, setAncla] = useState(() => {
    const [a, m] = hoyStr.split('-').map(Number);
    return { anio: a, mes: m - 1 }; // mes 0-11
  });
  const [lunes, setLunes] = useState(() => lunesDe(hoyStr));
  const [diaSel, setDiaSel] = useState<string | null>(hoyStr);

  const mesStr = `${ancla.anio}-${String(ancla.mes + 1).padStart(2, '0')}`;
  const ultimoDia = new Date(ancla.anio, ancla.mes + 1, 0).getDate();
  const desde = modo === 'mes' ? `${mesStr}-01` : lunes;
  const hasta = modo === 'mes' ? `${mesStr}-${String(ultimoDia).padStart(2, '0')}` : sumarDias(lunes, 6);

  const { data: items, isLoading } = useQuery({
    queryKey: ['cocina-plan-mes-qr', local, desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pizarron_items')
        .select('fecha_objetivo, tipo, estado, cantidad_recetas, receta:cocina_recetas(nombre)')
        .eq('local', local)
        .gte('fecha_objetivo', desde)
        .lte('fecha_objetivo', hasta)
        .neq('estado', 'cancelado');
      if (error) throw error;
      return data as unknown as ItemMes[];
    },
  });
  // Lo que se cargó cada día del rango, para mostrarlo al tocar el día.
  const { data: hechos } = useLotesHechos(local, desde, hasta);

  // Por día: cuántos renglones hay y cuántos siguen abiertos.
  const porDia = useMemo(() => {
    const m = new Map<string, { total: number; abiertos: number }>();
    for (const it of items ?? []) {
      const e = m.get(it.fecha_objetivo) ?? { total: 0, abiertos: 0 };
      e.total += 1;
      if (it.estado !== 'ciclo_completo') e.abiertos += 1;
      m.set(it.fecha_objetivo, e);
    }
    return m;
  }, [items]);

  const hechosPorDia = useMemo(() => {
    const m = new Map<string, LoteHecho[]>();
    for (const h of hechos ?? []) {
      const arr = m.get(h.fecha) ?? [];
      arr.push(h);
      m.set(h.fecha, arr);
    }
    return m;
  }, [hechos]);

  const delDia = useMemo(
    () => (items ?? []).filter((it) => it.fecha_objetivo === diaSel),
    [items, diaSel],
  );
  const hechosDelDia = diaSel ? (hechosPorDia.get(diaSel) ?? []) : [];

  // La grilla. Mes: se rellena con vacíos hasta el día de semana del 1° y
  // arranca en domingo, como el almanaque. Semana: 7 celdas de lunes a domingo.
  const offsetInicial = new Date(ancla.anio, ancla.mes, 1).getDay(); // 0 = domingo
  const celdas: (string | null)[] =
    modo === 'mes'
      ? [
          ...Array<null>(offsetInicial).fill(null),
          ...Array.from({ length: ultimoDia }, (_, i) => `${mesStr}-${String(i + 1).padStart(2, '0')}`),
        ]
      : Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  const cabecera = modo === 'mes' ? ['D', 'L', 'M', 'M', 'J', 'V', 'S'] : ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

  function mover(delta: number) {
    if (modo === 'mes') {
      setAncla((a) => {
        const d = new Date(a.anio, a.mes + delta, 1);
        return { anio: d.getFullYear(), mes: d.getMonth() };
      });
    } else {
      setLunes((l) => sumarDias(l, 7 * delta));
    }
    setDiaSel(null);
  }

  function cambiarModo(m: 'semana' | 'mes') {
    if (m === modo) return;
    setModo(m);
    // Al cambiar de vista, volver a pararse en hoy: es lo que se espera.
    setLunes(lunesDe(hoyStr));
    const [a, mm] = hoyStr.split('-').map(Number);
    setAncla({ anio: a, mes: mm - 1 });
    setDiaSel(hoyStr);
  }

  const titulo =
    modo === 'mes'
      ? `${NOMBRE_MES[ancla.mes]} ${ancla.anio}`
      : `Semana del ${ddmm(lunes)} al ${ddmm(sumarDias(lunes, 6))}`;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex rounded-lg border border-gray-300 p-0.5 text-xs font-semibold">
        {(['semana', 'mes'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => cambiarModo(m)}
            className={cn(
              'flex-1 rounded-md py-1.5 capitalize',
              modo === m ? 'bg-gray-900 text-white' : 'text-gray-600',
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button
          onClick={() => mover(-1)}
          className="rounded px-3 py-2 text-lg font-bold text-gray-600 active:bg-gray-100"
          aria-label={modo === 'mes' ? 'Mes anterior' : 'Semana anterior'}
        >
          ‹
        </button>
        <p className={cn('text-sm font-semibold text-gray-800', modo === 'mes' && 'capitalize')}>
          {titulo}
        </p>
        <button
          onClick={() => mover(1)}
          className="rounded px-3 py-2 text-lg font-bold text-gray-600 active:bg-gray-100"
          aria-label={modo === 'mes' ? 'Mes siguiente' : 'Semana siguiente'}
        >
          ›
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] text-gray-400">
        {cabecera.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {celdas.map((f, i) => {
          if (!f) return <span key={`v${i}`} />;
          const info = porDia.get(f);
          const nHechos = hechosPorDia.get(f)?.length ?? 0;
          const esHoy = f === hoyStr;
          const sel = f === diaSel;
          return (
            <button
              key={f}
              onClick={() => setDiaSel(sel ? null : f)}
              className={cn(
                'flex flex-col items-center justify-center rounded text-xs',
                modo === 'mes' ? 'h-11' : 'h-14',
                sel ? 'bg-rodziny-700 text-white' : 'text-gray-700 active:bg-gray-100',
                !sel && esHoy && 'ring-2 ring-rodziny-600',
                !sel && !info && nHechos === 0 && 'text-gray-300',
              )}
            >
              <span className={cn('leading-none', esHoy && 'font-bold')}>{Number(f.slice(-2))}</span>
              <span className="mt-1 flex h-3 items-center gap-1">
                {info && (
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      sel ? 'bg-white' : info.abiertos > 0 ? 'bg-amber-500' : 'bg-green-500',
                    )}
                  />
                )}
                {nHechos > 0 && (
                  <span className={cn('text-[10px] font-semibold leading-none', sel ? 'text-white' : 'text-gray-500')}>
                    ✓{nHechos}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading && <p className="mt-3 text-center text-xs text-gray-400">Cargando…</p>}

      {diaSel && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-700">
            📋 Plan · {diaSel === hoyStr ? 'hoy' : diaSel.split('-').reverse().join('/')}
          </p>
          {delDia.length === 0 ? (
            <p className="mt-1 text-xs text-gray-400">Sin plan cargado ese día.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {delDia.map((it, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-xs">
                  <span className={cn(it.estado === 'ciclo_completo' && 'text-gray-400 line-through')}>
                    {it.estado === 'ciclo_completo' ? '✓ ' : '· '}
                    {it.receta?.nombre ?? '(sin receta)'}
                  </span>
                  <span className="shrink-0 text-gray-500">×{it.cantidad_recetas ?? 1}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-xs font-semibold text-gray-700">
            ✅ Hecho{hechosDelDia.length > 0 ? ` · ${hechosDelDia.length}` : ''}
          </p>
          {hechosDelDia.length === 0 ? (
            <p className="mt-1 text-xs text-gray-400">Nada cargado ese día.</p>
          ) : (
            <div className="mt-1 space-y-1.5">
              {hechosDelDia.map((h) => (
                <FilaHecho key={`${h.cat}-${h.id}`} h={h} onVer={onVerLote} />
              ))}
            </div>
          )}

          {diaSel !== hoyStr && (
            <p className="mt-2 text-[10px] leading-snug text-gray-400">
              Esto es solo para mirar. Lo que cargues siempre se registra con la fecha de
              hoy, y lo que quedó abierto de días pasados ya te aparece arriba.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Condimentos del puré (Vedia) ─────────────────────────────────────────────
// El puré de papa para ñoqui de Vedia lleva condimentos (queso sardo, pimienta,
// nuez moscada, sal) que se mezclan al hacer el puré. En "Cargar Relleno"
// mostramos cuánto agregar escalado por los kg de puré que salieron. Lee la
// receta canónica (cocina_receta_ingredientes) y EXCLUYE la papa base y el
// semolín/huevo: esos se agregan recién al armar el ñoqui (Armar Pasta).
const EXCLUIR_DE_CONDIMENTOS = /papa|semol[ií]n|huevo/i;

function CondimentosRellenoPure({
  recetaId,
  kgPure,
  onDetalle,
  onTotalKg,
}: {
  recetaId: string | null;
  kgPure: number;
  onDetalle: (detalle: string) => void;
  // Total de condimentos en kg (para sugerir el puré neto = puré + condimentos).
  onTotalKg?: (kg: number) => void;
}) {
  const [reales, setReales] = useState<Record<string, string>>({});

  const { data: condimentos } = useQuery({
    queryKey: ['cocina-condimentos-pure-relleno', recetaId],
    queryFn: async () => {
      if (!recetaId) return [] as { id: string; nombre: string; por_kg: number; unidad: string }[];
      const { data, error } = await supabase
        .from('cocina_receta_ingredientes')
        .select('id, nombre, cantidad, unidad')
        .eq('receta_id', recetaId)
        .order('orden');
      if (error) throw error;
      return (data ?? [])
        .filter((i) => !EXCLUIR_DE_CONDIMENTOS.test(i.nombre))
        .map((i) => ({
          id: i.id as string,
          nombre: i.nombre as string,
          por_kg: Number(i.cantidad) || 0,
          unidad: i.unidad as string,
        }));
    },
    enabled: !!recetaId,
  });

  // Sugerencia = por_kg × kg de puré. Se rellena sola y queda editable.
  useEffect(() => {
    if (!condimentos || kgPure <= 0) {
      setReales({});
      return;
    }
    const sug: Record<string, string> = {};
    for (const c of condimentos) {
      sug[c.id] = String(+(kgPure * c.por_kg).toFixed(3)).replace('.', ',');
    }
    setReales(sug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condimentos, kgPure]);

  // Reportar el detalle al padre para guardarlo en notas (trazabilidad).
  useEffect(() => {
    if (!condimentos || condimentos.length === 0 || kgPure <= 0) {
      onDetalle('');
      return;
    }
    onDetalle(
      `Condimentos (${formatNum(kgPure)} kg puré): ` +
        condimentos.map((c) => `${c.nombre} ${reales[c.id] ?? '0'} ${c.unidad}`).join(', '),
    );
  }, [condimentos, reales, kgPure, onDetalle]);

  // Sumar los condimentos en kg para sugerir el puré neto final.
  useEffect(() => {
    if (!onTotalKg) return;
    if (!condimentos || kgPure <= 0) {
      onTotalKg(0);
      return;
    }
    const totalKg = condimentos
      .filter((c) => c.unidad === 'kg')
      .reduce((s, c) => s + parseDecimalShared(reales[c.id] ?? ''), 0);
    onTotalKg(+totalKg.toFixed(3));
  }, [condimentos, reales, kgPure, onTotalKg]);

  if (!recetaId || !condimentos || condimentos.length === 0) return null;

  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-3">
      <p className="mb-2 text-[11px] text-amber-900">
        🧂 Condimentos del puré según los <strong>{formatNum(kgPure)} kg de puré</strong>{' '}
        (editables). El semolín y el huevo se agregan recién al{' '}
        <strong>armar el ñoqui</strong>.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {condimentos.map((c) => {
          const sug = kgPure > 0 ? kgPure * c.por_kg : null;
          return (
            <div key={c.id}>
              <label className="mb-1 block text-xs font-medium text-amber-900">
                {c.nombre} ({c.unidad})
              </label>
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                value={reales[c.id] ?? ''}
                onChange={(e) =>
                  setReales((prev) => ({ ...prev, [c.id]: normalizarDecimal(e.target.value) }))
                }
                className="w-full rounded border border-amber-300 bg-white px-3 py-2.5 text-sm"
                placeholder="0"
              />
              {sug != null && (
                <p className="mt-0.5 text-[10px] text-amber-700">
                  Sugerido ~{formatNum(+sug.toFixed(3))} {c.unidad}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Formulario Relleno ─────────────────────────────────────────────────────────

function FormRelleno({
  local,
  recetas,
  recetaIdsPlan,
  recetaIdInicial,
  cargasHoy = [],
  onGuardado,
  onVolver,
}: {
  local: string;
  recetas: Receta[];
  recetaIdsPlan?: Map<string, number>;
  /** Viene de tocar un renglón del plan en la pantalla de inicio. */
  recetaIdInicial?: string;
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

  // Si vino con una receta elegida desde el plan, esa manda. Si no, la primera
  // visible, como siempre.
  const idInicial =
    recetaIdInicial && recetasVisibles.some((r) => r.id === recetaIdInicial)
      ? recetaIdInicial
      : (recetasVisibles[0]?.id ?? '');
  const [recetaId, setRecetaId] = useState(idInicial);
  const [cantRecetas, setCantRecetas] = useState(() => {
    const planeada = idInicial ? recetaIdsPlan?.get(idInicial) : undefined;
    return planeada ? String(planeada) : '1';
  });
  const [pesoKg, setPesoKg] = useState(''); // en modo bolsa = kg de puré que salió
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  // Modo bolsa (puré de papa): kg de papa pesada (las bolsas se derivan solas).
  const [kgPapa, setKgPapa] = useState('');
  // Detalle de condimentos del puré (Vedia) para guardar en notas.
  const [condimentosDetalle, setCondimentosDetalle] = useState('');
  // Puré neto final (con condimentos): lo que realmente queda en el depósito.
  const [pureNeto, setPureNeto] = useState('');
  const [condimentosKg, setCondimentosKg] = useState(0);
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
  // Condimentos en el relleno: solo el puré "estilo Vedia" (semolín/huevo al armar,
  // sin lista itemizada). Saavedra usa ingredientes_armado → carga condimentos al armar.
  const muestraCondimentos = esPorBolsa && (recetaSel?.ingredientes_armado?.length ?? 0) === 0;
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), []);

  // Sugerir el puré neto = puré que salió + condimentos agregados (editable, lo
  // pisa el operario si lo pesó distinto). Solo en el puré con condimentos (Vedia).
  useEffect(() => {
    if (!muestraCondimentos) return;
    const base = parseDecimal(pesoKg);
    if (base <= 0) {
      setPureNeto('');
      return;
    }
    setPureNeto(String(+(base + condimentosKg).toFixed(3)).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pesoKg, condimentosKg, muestraCondimentos]);

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
      // Puré neto final (con condimentos) = stock real que va al depósito. Si no
      // se cargó, se usa el puré que salió (sin condimentos).
      const netoNum = muestraCondimentos ? parseDecimal(pureNeto) : 0;
      const stockPure = netoNum > 0 ? netoNum : pure;
      if (netoNum > 0 && netoNum < pure - 0.001) {
        const ok = window.confirm(
          `El puré neto (${formatNum(netoNum)} kg) es menor que el puré que salió (${formatNum(pure)} kg). ` +
            `Con los condimentos debería pesar más o igual. ¿Es correcto?`,
        );
        if (!ok) return;
      }
      const notasBolsa =
        [
          notas.trim(),
          muestraCondimentos ? condimentosDetalle : '',
          netoNum > 0 ? `Puré que salió ${formatNum(pure)} kg → neto con condimentos ${formatNum(netoNum)} kg` : '',
        ]
          .filter(Boolean)
          .join(' — ') || null;
      const { error: errB } = await supabase.from('cocina_lotes_relleno').insert({
        receta_id: recetaId,
        fecha: hoy(),
        // cantidad_recetas es integer NOT NULL: en modo bolsa el dato fino del rinde
        // vive en `bolsas` (numeric) y kg_papa; acá solo va un entero >= 1 de placeholder.
        cantidad_recetas: nBolsas != null ? Math.max(1, Math.round(nBolsas)) : 1,
        peso_total_kg: stockPure,
        bolsas: nBolsas,
        kg_papa: papa,
        responsable: responsable.trim(),
        local,
        notas: notasBolsa,
        excluido_analisis: true,
      });
      if (errB) {
        setError(mensajeErrorAmigable(errB, 'No se pudo guardar el puré'));
        setGuardando(false);
        return;
      }
      onGuardado(
        `Puré "${recetaSel?.nombre ?? ''}" — ${formatNum(stockPure)} kg al depósito (de ${formatNum(papa)} kg de papa)`,
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
              salieron.{' '}
              {muestraCondimentos
                ? 'Abajo te calculo los condimentos según el puré. El semolín y el huevo se agregan recién al armar el ñoqui.'
                : 'Los demás ingredientes (harina, huevo, condimentos) se agregan después al armar el ñoqui.'}
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
            {muestraCondimentos && parseDecimal(pesoKg) > 0 && (
              <>
                <CondimentosRellenoPure
                  recetaId={recetaId || null}
                  kgPure={parseDecimal(pesoKg)}
                  onDetalle={setCondimentosDetalle}
                  onTotalKg={setCondimentosKg}
                />
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    Puré neto final (con condimentos)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    value={pureNeto}
                    onChange={(e) => setPureNeto(normalizarDecimal(e.target.value))}
                    className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm"
                    placeholder="Ej: 7,2"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">
                    Lo que queda después de mezclar todo. Es lo que se suma al depósito.
                    {condimentosKg > 0 && (
                      <> Sugerido ~{formatNum(+(parseDecimal(pesoKg) + condimentosKg).toFixed(3))} kg
                      {' '}(puré + condimentos).</>
                    )}
                  </p>
                </div>
              </>
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
  productoIdInicial,
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
  /** Pasta que quedó elegida al venir de la ficha de un lote ("otra tanda"). */
  productoIdInicial?: string;
  cargasHoy?: CargaHoyItem[];
  /** El segundo argumento es el código del lote tal cual lo guardó la base. */
  onGuardado: (msg: string, codigo?: string | null) => void;
  onVolver: () => void;
}) {
  const [loteRellenoId, setLoteRellenoId] = useState('');
  const [productoId, setProductoId] = useState(() =>
    productoIdInicial && productos.some((p) => p.id === productoIdInicial) ? productoIdInicial : '',
  );
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

  const productoSel = productos.find((p) => p.id === productoId);
  const esMixto = !!productoSel?.es_mixto;
  // Lo dice el producto, no el mapeo de recetas.
  //
  // Antes esto se sacaba de cocina_pasta_recetas: "admite relleno si tiene
  // alguna receta de rol relleno mapeada". Una pasta rellena a la que nadie le
  // había cargado el mapeo quedaba tratada como fideo y el desplegable se le
  // apagaba solo — le pasó al mezzelune de bondiola el día que se creó.
  const productoAdmiteRelleno = productoSel ? productoSel.lleva_relleno !== false : true;

  // Si elegí un fideo, limpiar el relleno que hubiera quedado seleccionado.
  useEffect(() => {
    if (productoSel && productoSel.lleva_relleno === false && loteRellenoId) {
      setLoteRellenoId('');
    }
  }, [productoSel, loteRellenoId]);

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
  // Los fideos (tagliatelles, rigatoni, radiatori...) no llevan paso de
  // porcionado posterior: el equipo arma y embolsa en una sola pasada, así que
  // el lote entra directo a cámara con las porciones cargadas.
  //
  // ⚠️ ESTO ERA EL BUG. Antes decía `!loteRellenoId`, o sea: "si no eligieron
  // relleno, es un fideo". Entonces una pasta RELLENA cargada sin elegir el
  // relleno nacía marcada como ya porcionada y desaparecía del paso Porcionar.
  // Ahora lo decide el producto (columna lleva_relleno, migración 160) y el
  // guardado se bloquea antes de llegar acá si falta el relleno.
  //
  // Mientras no haya pasta elegida se mantiene el comportamiento viejo, para no
  // cambiarle los carteles al formulario en blanco ("Porciones" / "Registrar en
  // cámara"). Al guardar siempre hay pasta elegida, así que lo que se escribe en
  // la base sale del producto y nunca de la deducción.
  const esPastaSinRelleno = prodSel ? prodSel.lleva_relleno === false : !loteRellenoId;

  // Si la receta del relleno define ratios (ej: puré de papa para ñoquis →
  // 350g semolín + 180g huevo por kg), sugerir los gramos a partir del
  // relleno_kg cargado. El operario puede sobreescribir.
  const ratioSemolinPorKg = rellenoSel?.receta?.g_semolin_por_kg ?? null;
  const ratioHuevoPorKg = rellenoSel?.receta?.g_huevo_por_kg ?? null;
  const requiereSemolinHuevo = ratioSemolinPorKg != null && ratioHuevoPorKg != null;

  // Armado itemizado (ej: ñoqui SG): la receta del relleno define la lista de
  // ingredientes que se agregan por kg de PURÉ. Tiene prioridad sobre el bloque
  // semolín/huevo (Vedia). Cada ingrediente sugiere por_kg × kgPuré, editable.
  const ingredientesArmado = rellenoSel?.receta?.ingredientes_armado ?? null;
  const usaArmadoItemizado = (ingredientesArmado?.length ?? 0) > 0;
  // En modo itemizado el input es "kg de puré a ocupar". Los ratios de la receta
  // (por_kg) están definidos por kg de PURÉ, así que se aplican directo sin conversión.
  const kgPureNum = parseDecimal(kgPapa);
  useEffect(() => {
    if (!usaArmadoItemizado || kgPureNum <= 0) {
      setArmadoReales({});
      return;
    }
    const sug: Record<string, string> = {};
    for (const ing of ingredientesArmado ?? []) {
      const cant = kgPureNum * (Number(ing.por_kg) || 0);
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
    // El bloqueo que faltaba: una pasta rellena NO se guarda sin su relleno.
    // Si se guardaba igual, el lote nacía como "ya porcionado" y no aparecía al
    // día siguiente para porcionar (el bug del mezzelune, 1-sep-2026).
    if (prodSel && prodSel.lleva_relleno == null) {
      setError(
        `Falta definir si "${prodSel.nombre}" lleva relleno. ` +
          'Cargalo en Productos y volvé a intentar.',
      );
      return;
    }
    if (prodSel?.lleva_relleno === true && !loteRellenoId) {
      setError(
        `"${prodSel.nombre}" lleva relleno: elegí arriba el lote de relleno que usaste. ` +
          'Sin eso la pasta no aparece después para porcionar.',
      );
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
      ? `Armado (${formatNum(kgPureNum)} kg puré): ` +
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
      // Traemos codigo_lote de vuelta: el codigo definitivo lo pone la BASE
      // (migracion 171 le agrega la letra de tanda si ya existe uno igual ese
      // dia). Mostrar el que calculo el navegador haria que el equipo escriba
      // en el cajon un codigo que no es el que quedo guardado.
      .select('id, codigo_lote')
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
    const codigoGuardado = loteCreado?.codigo_lote ?? codigoLote;
    onGuardado(
      esPastaSinRelleno
        ? `${prodSel?.nombre ?? 'Pasta'} — ${cantidadCajones || '?'} porciones en cámara`
        : `${prodSel?.nombre ?? 'Pasta'} armada — ${cantidadCajones || '?'} bandejas en freezer`,
      codigoGuardado,
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
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(ingredientesArmado ?? []).map((ing) => {
                const esKg = ing.unidad === 'kg';
                const sug = kgPureNum > 0 ? kgPureNum * (Number(ing.por_kg) || 0) : null;
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
  recetaIdInicial,
  cargasHoy = [],
  onGuardado,
  onVolver,
}: {
  local: string;
  recetas: Receta[];
  /** Receta que quedó elegida al venir de la ficha de un lote ("otra tanda"). */
  recetaIdInicial?: string;
  cargasHoy?: CargaHoyItem[];
  onGuardado: (msg: string) => void;
  onVolver: () => void;
}) {
  const [recetaId, setRecetaId] = useState(() =>
    recetaIdInicial && recetas.some((r) => r.id === recetaIdInicial)
      ? recetaIdInicial
      : (recetas[0]?.id ?? ''),
  );
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

function Exito({
  mensaje,
  codigo,
  onOtro,
}: {
  mensaje: string;
  /** Codigo del lote tal cual quedo guardado en la base. Es el que va al cajon. */
  codigo?: string | null;
  onOtro: () => void;
}) {
  return (
    <div className="mt-8 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <span className="text-3xl text-green-600">✓</span>
      </div>
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Registrado</h2>
      <p className="mb-4 text-sm text-gray-600">{mensaje}</p>

      {/* El codigo de la tanda. Es lo que se escribe en el cajon y lo que
          despues se usa para entrar y sacar mercaderia de la camara, asi que
          va grande y en monoespaciado (la letra del final se tiene que
          distinguir bien de la del lote de al lado). */}
      {codigo && (
        <div className="mb-6 rounded-lg border-2 border-rodziny-700 bg-rodziny-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-rodziny-700">
            Código del lote
          </p>
          <p className="mt-1 select-all font-mono text-3xl font-bold uppercase text-rodziny-900">
            {codigo}
          </p>
          <p className="mt-2 text-xs text-rodziny-700">✍️ Anotalo en el cajón</p>
        </div>
      )}
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
    // Milanesa = overwrite ("último pesaje manda", ver comentario esAditivo): apagar
    // el lote activo previo de la receta antes de insertar, para no acumular. El path
    // genérico ya lo hace para no-aditivos; este path dedicado lo había omitido.
    if (recetaId) {
      const { error: errOff } = await supabase
        .from('cocina_lotes_produccion')
        .update({ en_stock: false })
        .eq('local', local)
        .eq('receta_id', recetaId)
        .eq('en_stock', true);
      if (errOff) {
        setError(mensajeErrorAmigable(errOff, 'No se pudo actualizar el stock de milanesa'));
        setGuardando(false);
        return;
      }
    }
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
  recetaIdInicial,
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
  /** Viene de tocar un renglón del plan en la pantalla de inicio. */
  recetaIdInicial?: string;
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

  // Si vino con una receta elegida desde el plan, arranca con esa puesta.
  const [recetaId, setRecetaId] = useState(() =>
    recetaIdInicial && recetas.some((r) => r.id === recetaIdInicial) ? recetaIdInicial : '',
  );

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
  // salsas, masas y rellenos se producen/pesan en kg (cocina_lotes_masa.kg_producidos,
  // cocina_lotes_relleno.peso_total_kg), así que su merma también se carga en kg.
  if (tipo === 'salsa' || tipo === 'masa' || tipo === 'relleno') return 'kg';
  if (tipo === 'pasta') return 'porciones';
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
      fecha: hoy(),
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

