import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';
import { useConfigCosteo } from '@/modules/cocina/hooks/useConfigCosteo';
import { useProductosCosteoConfig } from './useProductosCosteoConfig';
import { calcularCostoBebidaReventa } from '@/modules/productos/lib/bebidaReventaCosto';

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
  margenUnitario: number | null;       // precio_promedio − costo
  margenPctSobrePrecio: number | null; // margen / precio
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

  // Insumos para costear bebidas reventa (productos del menú sin receta pero
  // con insumo_reventa_id, como Pepsi lata o Copa Malbec). Sin esto, los
  // productos de reventa aparecen en la matriz con costo NULL → margen mal.
  const insumosReventaQ = useQuery({
    queryKey: ['menu-engineering-insumos-reventa'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, costo_unitario, contenido_ml');
      if (error) throw error;
      return data as Array<{
        id: string;
        costo_unitario: number;
        contenido_ml: number | null;
      }>;
    },
  });

  const { costos: costosRecetas } = useCostosRecetas();
  const { config: configGen } = useConfigCosteo();
  const { getConfig } = useProductosCosteoConfig();

  return useMemo<{ productos: ProductoME[]; isLoading: boolean; periodos: string[] }>(() => {
    const ventas = ventasQ.data;
    const cocinaProds = productosQ.data;
    // recetasVendibles es fuente opcional: si la query falla (RLS u otro motivo),
    // caemos a [] y el matching usa solo cocina_productos. NO incluir en el gate
    // de !ventas o !cocinaProds porque si la query queda undefined bloquea todo.
    const recetasVendibles: RecetaVendibleRow[] = recetasQ.data ?? [];
    const isLoading =
      ventasQ.isLoading || productosQ.isLoading || insumosReventaQ.isLoading;
    if (!ventas || !cocinaProds) {
      return { productos: [], isLoading, periodos: opts.periodos };
    }

    const insumoById = new Map<string, { costo_unitario: number; contenido_ml: number | null }>();
    for (const i of insumosReventaQ.data ?? [])
      insumoById.set(i.id, { costo_unitario: i.costo_unitario, contenido_ml: i.contenido_ml });

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

    // ─── Construir productos ME ─────────────────────────────────────────────
    const ivaPct = configGen?.iva_pct ?? 0.21;
    const productosME: ProductoME[] = [];

    for (const [, a] of agg) {
      // Matching SOLO explícito (sin fallback por nombre):
      //  1. Receta vendible por fudo_productos[]
      //  2. cocina_productos por fudo_nombres[] (bebidas reventa, legacy)
      // Si nada matchea, el ítem queda sin costear (huérfano) y se ve en la
      // sección informativa del Menú para que Lucas lo vincule manualmente.
      const nombreNorm = normalizarNombre(a.nombre);
      const receta = recetaByFudoProducto.get(`${a.local}|${nombreNorm}`) ?? null;
      const prod = !receta
        ? (prodByFudoNombre.get(`${a.local}|${nombreNorm}`) ?? null)
        : null;

      const cocinaProductoId = prod?.id ?? null;
      const recetaIdMatch = receta?.id ?? prod?.receta_id ?? null;
      // tipo grueso (pasta/salsa/bebida/etc): prioriza categoría de la receta
      // vendible, cae a cocina_producto.tipo, último recurso categoría Fudo.
      const tipo =
        receta?.categoria ?? prod?.tipo ?? (a.categoria ?? '').toLowerCase();
      const categoriaFudo = a.categoria ?? null;
      const esAncla = prod?.es_ancla ?? false;

      // Aplicar filtro de categoría Fudo (la fina, viene de ventas_items.categoria).
      // Comparamos sobre categoriaFudo para que las medianas se calculen únicamente
      // sobre productos comparables (no mezclar Pastas Salón con Bebidas).
      if (opts.categoria && opts.categoria !== 'todas' && categoriaFudo !== opts.categoria) continue;

      // Costo estimado: usar costoPorPorcion de la receta (matcheada directa o
      // via cocina_producto.receta_id) + costo_empaque cuando hay cocina_producto.
      // Para bebidas reventa (sin receta) usamos el helper que prorratea por
      // ml_por_venta cuando es copa/shot.
      let costoUnitario: number | null = null;
      if (recetaIdMatch) {
        const c = costosRecetas.get(recetaIdMatch);
        if (c) {
          const base = c.costoPorPorcion ?? c.costoPorKg ?? null;
          if (base != null) costoUnitario = base + (prod?.costo_empaque ?? 0);
        }
      } else if (prod?.insumo_reventa_id) {
        const ins = insumoById.get(prod.insumo_reventa_id);
        costoUnitario = calcularCostoBebidaReventa(
          { ml_por_venta: prod.ml_por_venta },
          ins ?? null,
        );
      }

      const precioPromedio = a.uds > 0 ? a.total / a.uds : 0;
      // El precio_promedio está en bruto (con IVA). Lo netamos para calcular margen real
      // sin comisión MP (porque la matriz mira todo el período, no un medio puntual).
      const precioNeto = precioPromedio / (1 + ivaPct);

      const margenUnitario =
        costoUnitario != null ? precioNeto - costoUnitario : null;
      const margenPctSobrePrecio =
        margenUnitario != null && precioNeto > 0 ? margenUnitario / precioNeto : null;
      const contribucionAbsoluta =
        margenUnitario != null ? margenUnitario * a.uds : null;

      productosME.push({
        cocinaProductoId,
        codigo: a.codigo,
        nombre: receta?.nombre ?? prod?.nombre ?? a.nombre,
        tipo,
        categoriaFudo,
        local: a.local,
        esAncla,
        unidadesVendidas: a.uds,
        ventaBruta: a.total,
        precioPromedio,
        costoUnitario,
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
    // Eje Y (rentabilidad) = margenPctSobrePrecio (si null, queda sin clasificar)
    const conMargen = productosME.filter((p) => p.margenPctSobrePrecio != null);
    const medianaUds = mediana(conMargen.map((p) => p.unidadesVendidas));
    const medianaMargen = mediana(conMargen.map((p) => p.margenPctSobrePrecio!));

    for (const p of productosME) {
      if (p.margenPctSobrePrecio == null) {
        p.cuadrante = null;
        continue;
      }
      const popOk = p.unidadesVendidas >= medianaUds;
      const rentOk = p.margenPctSobrePrecio >= medianaMargen;
      if (popOk && rentOk) p.cuadrante = 'estrella';
      else if (popOk && !rentOk) p.cuadrante = 'vaca';
      else if (!popOk && rentOk) p.cuadrante = 'puzzle';
      else p.cuadrante = 'perro';

      p.popularidadRelativa = medianaUds > 0 ? p.unidadesVendidas / medianaUds : 0;
      p.rentabilidadRelativa =
        medianaMargen > 0 ? p.margenPctSobrePrecio / medianaMargen : 0;
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
    insumosReventaQ.data,
    insumosReventaQ.isLoading,
    costosRecetas,
    configGen,
    opts.periodos,
    opts.categoria,
    getConfig,
  ]);
}
