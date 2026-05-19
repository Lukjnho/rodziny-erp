import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';
import { useConfigCosteo } from '@/modules/cocina/hooks/useConfigCosteo';
import { useProductosCosteoConfig } from './useProductosCosteoConfig';

export type CuadranteME = 'estrella' | 'vaca' | 'puzzle' | 'perro';

export interface ProductoME {
  cocinaProductoId: string | null;
  codigo: string;
  nombre: string;
  tipo: string; // categoría: pasta, salsa, etc.
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
  es_ancla: boolean;
  fudo_nombres: string[];
  costo_empaque: number | null;
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
        .select('id, codigo, nombre, tipo, local, receta_id, es_ancla, fudo_nombres, costo_empaque')
        .eq('activo', true);
      if (error) throw error;
      return data as CocinaProductoRow[];
    },
  });

  const { costos: costosRecetas } = useCostosRecetas();
  const { config: configGen } = useConfigCosteo();
  const { getConfig } = useProductosCosteoConfig();

  return useMemo<{ productos: ProductoME[]; isLoading: boolean; periodos: string[] }>(() => {
    const ventas = ventasQ.data;
    const cocinaProds = productosQ.data;
    const isLoading = ventasQ.isLoading || productosQ.isLoading;
    if (!ventas || !cocinaProds) {
      return { productos: [], isLoading, periodos: opts.periodos };
    }

    // ─── Agrupar ventas por codigo ──────────────────────────────────────────
    const agg = new Map<
      string,
      { codigo: string; nombre: string; categoria: string | null; local: string; uds: number; total: number }
    >();
    for (const v of ventas) {
      const key = `${v.local}|${v.codigo}`;
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

    // ─── Index cocina_productos por (local, codigo) y por (local, nombre normalizado) ──
    const prodByCodigo = new Map<string, CocinaProductoRow>();
    const prodByFudoNombre = new Map<string, CocinaProductoRow>();
    for (const p of cocinaProds) {
      prodByCodigo.set(`${p.local}|${p.codigo}`, p);
      // También indexar fudo_nombres como matching alterno
      for (const fn of p.fudo_nombres ?? []) {
        prodByFudoNombre.set(`${p.local}|${normalizarNombre(fn)}`, p);
      }
    }

    // ─── Construir productos ME ─────────────────────────────────────────────
    const ivaPct = configGen?.iva_pct ?? 0.21;
    const productosME: ProductoME[] = [];

    for (const [, a] of agg) {
      const prod =
        prodByCodigo.get(`${a.local}|${a.codigo}`) ??
        prodByFudoNombre.get(`${a.local}|${normalizarNombre(a.nombre)}`) ??
        null;

      const cocinaProductoId = prod?.id ?? null;
      const tipo = prod?.tipo ?? (a.categoria ?? '').toLowerCase();
      const esAncla = prod?.es_ancla ?? false;

      // Aplicar filtro de categoría si corresponde
      if (opts.categoria && opts.categoria !== 'todas' && tipo !== opts.categoria) continue;

      // Costo estimado: usar costoPorPorcion de la receta + costo_empaque legacy.
      // No incluye packaging y adicionales por canal (eso es el waterfall de
      // useCostoCompleto, requiere conocer canal). Para la matriz usamos una
      // aproximación válida si el producto no varía mucho entre canales.
      let costoUnitario: number | null = null;
      if (prod?.receta_id) {
        const c = costosRecetas.get(prod.receta_id);
        if (c) {
          const base = c.costoPorPorcion ?? c.costoPorKg ?? null;
          if (base != null) costoUnitario = base + (prod.costo_empaque ?? 0);
        }
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
        nombre: prod?.nombre ?? a.nombre,
        tipo,
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
    costosRecetas,
    configGen,
    opts.periodos,
    opts.categoria,
    getConfig,
  ]);
}
