import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';
import { useConfigCosteo } from '@/modules/cocina/hooks/useConfigCosteo';
import { useComisionMpConfig } from './useComisionMpConfig';
import { useProductosCosteoConfig } from './useProductosCosteoConfig';

export type CuadranteME = 'estrella' | 'vaca' | 'puzzle' | 'perro';

export interface ProductoME {
  cocinaProductoId: string | null;
  codigo: string;
  nombre: string;
  tipo: string; // categoría gruesa del ERP: pasta, salsa, etc.
  categoriaFudo: string | null; // categoría fina de Fudo (Pastas Salón, Bebidas Sin Alcohol, etc.) — base del filtro
  local: string;
  esAncla: boolean;

  // De ventas Fudo (período)
  unidadesVendidas: number;
  ventaBruta: number;
  precioPromedio: number;

  // Costeo (estimado)
  costoUnitario: number | null;

  // Métricas derivadas
  margenUnitario: number | null;       // recibido (neto − comisión) − costo = ganancia $/unidad
  margenPctSobrePrecio: number | null; // margen / recibido
  contribucionAbsoluta: number | null; // margen × unidades = $/período

  // Clasificación
  cuadrante: CuadranteME | null;
  popularidadRelativa: number; // unidades / mediana unidades
  rentabilidadRelativa: number; // margenPct / mediana margenPct
}

interface VentaItemRow {
  codigo: string;
  nombre: string;
  categoria: string | null;
  subcategoria: string | null;
  local: string;
  cantidad: number;
  total: number;
  periodo: string;
}

interface CocinaProductoRow {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  local: string;
  receta_id: string | null;
  insumo_reventa_id: string | null;
  ml_por_venta: number | null;
  es_ancla: boolean;
  fudo_nombres: string[];
  costo_empaque: number | null;
}

// Recetas vendibles del tab Menú. Modelo actual del ERP: los productos
// vendibles viven en cocina_recetas con vendible=true. El mapeo a Fudo
// se hace vía fudo_productos[] (array de nombres como llegan en
// ventas_items.nombre).
interface RecetaVendibleRow {
  id: string;
  nombre: string;
  tipo: string;
  categoria: string | null;
  local: string | null;
  fudo_productos: string[] | null;
}

function mediana(arr: number[]): number {
  if (arr.length === 0) return 0;
  const ord = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(ord.length / 2);
  return ord.length % 2 === 0 ? (ord[mid - 1] + ord[mid]) / 2 : ord[mid];
}

function normalizarNombre(n: string): string {
  return (n ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Ruido de Fudo: NO son productos vendibles, son adicionales/modificadores
// ("+ Queso", "+ Aceite"), líneas de ajuste ("ADICIONAL POR SERVICIO/DESC.") o
// renglones con venta/precio en 0. Se excluyen de la matriz para no ensuciar las
// medianas ni la advertencia de "sin costo".
// Línea de Menú Ejecutivo: en Vedia son los postres a $0 ("Flan M.E"), en
// Saavedra los principales a precio de menú ("M.E. Ñoquis"). NO son ruido: su
// demanda se suma al producto suelto (la etiqueta M.E sólo marca qué postre/
// plato va con el menú ejecutivo). El precio se toma del producto suelto.
function esLineaME(nombre: string): boolean {
  return normalizarNombre(nombre).includes('m.e');
}

function esRuidoAdicional(nombre: string, venta: number, precio: number): boolean {
  const n = normalizarNombre(nombre);
  if (esLineaME(nombre)) return false; // las M.E son demanda, no ruido
  if (venta <= 0 || precio <= 0) return true;
  if (n.startsWith('+')) return true;
  if (n.includes('adicional')) return true;
  return false;
}

export interface MenuEngineeringOptions {
  periodos: string[]; // formato YYYY-MM, ej ['2026-04','2026-05']
  local?: 'vedia' | 'saavedra';
  categoria?: string | 'todas';
}

export function useMenuEngineering(opts: MenuEngineeringOptions) {
  const ventasQ = useQuery({
    queryKey: ['menu-engineering-ventas', opts.periodos, opts.local],
    enabled: opts.periodos.length > 0,
    queryFn: async () => {
      let q = supabase
        .from('ventas_items')
        .select('codigo, nombre, categoria, subcategoria, local, cantidad, total, periodo')
        .in('periodo', opts.periodos);
      if (opts.local) q = q.eq('local', opts.local);
      const { data, error } = await q;
      if (error) throw error;
      return data as VentaItemRow[];
    },
  });

  const productosQ = useQuery({
    queryKey: ['menu-engineering-productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, codigo, nombre, tipo, local, receta_id, insumo_reventa_id, ml_por_venta, es_ancla, fudo_nombres, costo_empaque')
        .eq('activo', true);
      if (error) throw error;
      return data as CocinaProductoRow[];
    },
  });

  // Recetas vendibles del tab Menú (fuente principal del matching para platos
  // costeados). Query independiente porque la tabla es distinta a cocina_productos.
  // Si falla por RLS u otro motivo, el matching cae al modelo de cocina_productos.
  const recetasQ = useQuery({
    queryKey: ['menu-engineering-recetas-vendibles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, categoria, local, fudo_productos')
        .eq('vendible', true)
        .eq('activo', true);
      if (error) throw error;
      return (data ?? []) as RecetaVendibleRow[];
    },
  });

  const { costos: costosRecetas } = useCostosRecetas();
  const { config: configGen } = useConfigCosteo();
  const { data: comisiones } = useComisionMpConfig();
  const { getConfig } = useProductosCosteoConfig();

  return useMemo<{ productos: ProductoME[]; isLoading: boolean; periodos: string[] }>(() => {
    const ventas = ventasQ.data;
    const cocinaProds = productosQ.data;
    // recetasVendibles es fuente opcional: si la query falla (RLS u otro motivo),
    // caemos a [] y el matching usa solo cocina_productos. NO incluir en el gate
    // de !ventas o !cocinaProds porque si la query queda undefined bloquea todo.
    const recetasVendibles: RecetaVendibleRow[] = recetasQ.data ?? [];
    const isLoading = ventasQ.isLoading || productosQ.isLoading;
    if (!ventas || !cocinaProds) {
      return { productos: [], isLoading, periodos: opts.periodos };
    }

    // ─── Agrupar ventas por (local, codigo) o (local, nombre) cuando codigo vacío ──
    // Muchos productos de Fudo no tienen `code` (Saavedra: todos; Vedia: ~30%).
    // Si agrupamos solo por codigo, todos esos productos colapsan en un único
    // bucket "${local}|" y se pierden nombres + categorías → el dropdown de
    // categorías queda incompleto y los cuadrantes se rompen.
    const agg = new Map<
      string,
      { codigo: string; nombre: string; categoria: string | null; local: string; uds: number; total: number }
    >();
    for (const v of ventas) {
      const tieneCodigo = v.codigo && v.codigo.trim().length > 0;
      const key = tieneCodigo
        ? `${v.local}|c:${v.codigo}`
        : `${v.local}|n:${normalizarNombre(v.nombre)}`;
      const prev = agg.get(key);
      if (prev) {
        prev.uds += Number(v.cantidad);
        prev.total += Number(v.total);
      } else {
        agg.set(key, {
          codigo: v.codigo,
          nombre: v.nombre,
          categoria: v.categoria,
          local: v.local,
          uds: Number(v.cantidad),
          total: Number(v.total),
        });
      }
    }

    // ─── Index cocina_productos por fudo_nombres[] ──
    // Solo matching explícito. El código autogenerado del ERP no coincide
    // con el SKU de Fudo así que no se usa.
    const prodByFudoNombre = new Map<string, CocinaProductoRow>();
    for (const p of cocinaProds) {
      for (const fn of p.fudo_nombres ?? []) {
        prodByFudoNombre.set(`${p.local}|${normalizarNombre(fn)}`, p);
      }
    }

    // ─── Index cocina_recetas vendibles por (local, fudo_producto) ──
    // Solo matching EXPLÍCITO vía fudo_productos[]. Si la receta no tiene
    // nombres Fudo cargados, no aparece — Lucas vincula manualmente desde el
    // editor de Costeo y el selector inteligente le sugiere los huérfanos.
    const recetaByFudoProducto = new Map<string, RecetaVendibleRow>();
    for (const r of recetasVendibles) {
      if (!r.local) continue;
      for (const fp of r.fudo_productos ?? []) {
        recetaByFudoProducto.set(`${r.local}|${normalizarNombre(fp)}`, r);
      }
    }
    // Set de ids de recetas VENDIBLES (platos), para el guard de costeo de abajo.
    const vendibleIds = new Set(recetasVendibles.map((r) => r.id));

    // ─── Construir productos ME ─────────────────────────────────────────────
    const ivaPct = configGen?.iva_pct ?? 0.21;
    // Comisión bancaria MÁS ALTA (criterio conservador, igual que el tab Menú).
    // Acá NO aplicamos descuentos comerciales (efectivo/convenio): el precio
    // promedio sale de las ventas reales de Fudo, que ya incluyen los descuentos
    // que efectivamente se dieron. Sí restamos comisión para que el margen sea
    // consistente con el tab Menú.
    const comisionMax = Math.max(0, ...(comisiones ?? []).map((c) => Number(c.pct)));
    // Acumulador de consolidación: distintas líneas de Fudo del mismo producto
    // vendible (ej. "Flan" + "Flan M.E", o "Ñoquis de papa" + "M.E. Ñoquis")
    // matchean la misma receta y se fusionan en UNA fila. Las líneas M.E suman
    // DEMANDA pero no aportan precio (el del menú ejecutivo no es el del producto
    // suelto); el margen se calcula con el precio del producto suelto.
    interface AcumME {
      cocinaProductoId: string | null;
      codigo: string;
      nombre: string;
      tipo: string;
      categoriaFudo: string | null;
      local: string;
      esAncla: boolean;
      costoUnitario: number | null;
      udsTotal: number; // demanda total (incluye líneas M.E)
      baseUds: number; // unidades de líneas NO-M.E (con precio real)
      baseTotal: number; // venta bruta de líneas NO-M.E
    }
    const acum = new Map<string, AcumME>();

    for (const [, a] of agg) {
      // Excluir adicionales/ruido de Fudo (+ Queso, + Aceite, ADICIONAL POR…,
      // o renglones con venta/precio 0). Las líneas M.E NO son ruido: son demanda.
      const precioProm0 = a.uds > 0 ? a.total / a.uds : 0;
      if (esRuidoAdicional(a.nombre, a.total, precioProm0)) continue;

      // Matching SOLO explícito (sin fallback por nombre):
      //  1. Receta vendible por fudo_productos[]
      //  2. cocina_productos por fudo_nombres[] (bebidas reventa, legacy)
      const nombreNorm = normalizarNombre(a.nombre);
      const receta = recetaByFudoProducto.get(`${a.local}|${nombreNorm}`) ?? null;
      const prod = !receta
        ? (prodByFudoNombre.get(`${a.local}|${nombreNorm}`) ?? null)
        : null;

      const cocinaProductoId = prod?.id ?? null;
      // Costo: la receta vendible matcheada directo SIEMPRE vale. Si el match vino
      // del camino legacy (cocina_producto.fudo_nombres) y su receta_id NO es una
      // receta vendible (típicamente apunta a una subreceta/relleno), NO costeamos:
      // el costo del relleno no es el del plato. Queda "sin costo".
      const recetaIdMatch =
        receta?.id ??
        (prod?.receta_id && vendibleIds.has(prod.receta_id) ? prod.receta_id : null);
      const tipo =
        receta?.categoria ?? prod?.tipo ?? (a.categoria ?? '').toLowerCase();
      const categoriaFudo = a.categoria ?? null;
      const esAncla = prod?.es_ancla ?? false;

      // Filtro de categoría Fudo (la fina, viene de ventas_items.categoria): las
      // medianas se calculan sólo sobre productos comparables.
      if (opts.categoria && opts.categoria !== 'todas' && categoriaFudo !== opts.categoria) continue;

      // Costo estimado: costoPorPorcion de la receta + costo_empaque del cocina_producto.
      let costoUnitario: number | null = null;
      if (recetaIdMatch) {
        const c = costosRecetas.get(recetaIdMatch);
        if (c) {
          const baseCosto = c.costoPorPorcion ?? c.costoPorKg ?? null;
          if (baseCosto != null) costoUnitario = baseCosto + (prod?.costo_empaque ?? 0);
        }
      }

      const esME = esLineaME(a.nombre);
      // Clave de consolidación: misma receta/cocina_producto = misma fila. Los
      // canales (plato/vianda/congelado) son recetas distintas → no se fusionan.
      const key = recetaIdMatch ?? cocinaProductoId ?? `n:${a.local}:${nombreNorm}`;

      const prev = acum.get(key);
      if (prev) {
        prev.udsTotal += a.uds;
        if (!esME) {
          prev.baseUds += a.uds;
          prev.baseTotal += a.total;
          // Preferir la metadata de la línea base (nombre canónico, categoría).
          prev.nombre = receta?.nombre ?? prod?.nombre ?? prev.nombre;
          prev.categoriaFudo = categoriaFudo ?? prev.categoriaFudo;
          if (!prev.codigo && a.codigo) prev.codigo = a.codigo;
        }
        if (prev.costoUnitario == null && costoUnitario != null) prev.costoUnitario = costoUnitario;
        if (!prev.esAncla && esAncla) prev.esAncla = esAncla;
        if (!prev.cocinaProductoId && cocinaProductoId) prev.cocinaProductoId = cocinaProductoId;
      } else {
        acum.set(key, {
          cocinaProductoId,
          codigo: a.codigo,
          nombre: receta?.nombre ?? prod?.nombre ?? a.nombre,
          tipo,
          categoriaFudo,
          local: a.local,
          esAncla,
          costoUnitario,
          udsTotal: a.uds,
          baseUds: esME ? 0 : a.uds,
          baseTotal: esME ? 0 : a.total,
        });
      }
    }

    // ─── Materializar productos ME desde el acumulador ──────────────────────
    const productosME: ProductoME[] = [];
    for (const it of acum.values()) {
      // Precio promedio SOLO de líneas con precio real (no M.E). Las unidades M.E
      // se valúan a ese precio del producto suelto. El precio está en bruto (con
      // IVA): lo netamos y le restamos la comisión más alta (modelo del tab Menú).
      const precioPromedio = it.baseUds > 0 ? it.baseTotal / it.baseUds : 0;
      const precioNeto = precioPromedio / (1 + ivaPct);
      const recibido = precioNeto - precioNeto * comisionMax;
      const tienePrecio = recibido > 0;

      const margenUnitario =
        tienePrecio && it.costoUnitario != null ? recibido - it.costoUnitario : null;
      const margenPctSobrePrecio =
        margenUnitario != null ? margenUnitario / recibido : null;
      // Contribución sobre la demanda TOTAL (incluye unidades M.E al margen base).
      const contribucionAbsoluta =
        margenUnitario != null ? margenUnitario * it.udsTotal : null;

      productosME.push({
        cocinaProductoId: it.cocinaProductoId,
        codigo: it.codigo,
        nombre: it.nombre,
        tipo: it.tipo,
        categoriaFudo: it.categoriaFudo,
        local: it.local,
        esAncla: it.esAncla,
        unidadesVendidas: it.udsTotal,
        ventaBruta: it.baseTotal,
        precioPromedio,
        costoUnitario: it.costoUnitario,
        margenUnitario,
        margenPctSobrePrecio,
        contribucionAbsoluta,
        cuadrante: null,
        popularidadRelativa: 0,
        rentabilidadRelativa: 0,
      });
    }

    // ─── Clasificación: matriz 2x2 por mediana de cada eje ──────────────────
    // Eje X (popularidad) = unidadesVendidas
    // Eje Y (rentabilidad) = margenUnitario en PESOS (método clásico de
    // ingeniería de menú: lo que importa es la ganancia $ por plato, no el %.
    // Un % alto sobre un producto barato deja menos plata que un % menor sobre
    // un plato fuerte). Si el margen $ es null, queda sin clasificar.
    const conMargen = productosME.filter((p) => p.margenUnitario != null);
    const medianaUds = mediana(conMargen.map((p) => p.unidadesVendidas));
    const medianaMargen = mediana(conMargen.map((p) => p.margenUnitario!));

    for (const p of productosME) {
      if (p.margenUnitario == null) {
        p.cuadrante = null;
        continue;
      }
      const popOk = p.unidadesVendidas >= medianaUds;
      const rentOk = p.margenUnitario >= medianaMargen;
      if (popOk && rentOk) p.cuadrante = 'estrella';
      else if (popOk && !rentOk) p.cuadrante = 'vaca';
      else if (!popOk && rentOk) p.cuadrante = 'puzzle';
      else p.cuadrante = 'perro';

      p.popularidadRelativa = medianaUds > 0 ? p.unidadesVendidas / medianaUds : 0;
      p.rentabilidadRelativa =
        medianaMargen !== 0 ? p.margenUnitario / medianaMargen : 0;
    }

    // Ordenar por contribución absoluta desc (los que más mueven el EBITDA arriba)
    productosME.sort(
      (a, b) => (b.contribucionAbsoluta ?? 0) - (a.contribucionAbsoluta ?? 0),
    );

    return { productos: productosME, isLoading, periodos: opts.periodos };
  }, [
    ventasQ.data,
    ventasQ.isLoading,
    productosQ.data,
    productosQ.isLoading,
    recetasQ.data,
    recetasQ.isLoading,
    costosRecetas,
    configGen,
    comisiones,
    opts.periodos,
    opts.categoria,
    getConfig,
  ]);
}
