import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';
import { useConfigCosteo } from '@/modules/cocina/hooks/useConfigCosteo';
import { useProductosCosteoConfig } from './useProductosCosteoConfig';
import { useComisionMpConfig } from './useComisionMpConfig';
import { usePackagingProducto } from './usePackagingProducto';
import { useAdicionalesProducto } from './useAdicionalesProducto';
import { useManoObra } from './useManoObra';

export type Canal = 'plato' | 'vianda' | 'congelado';

export interface CapaCosto {
  id: string;
  label: string;
  monto: number;
  detalle?: string;
  esResta?: boolean;
  esResultado?: boolean;
}

export interface Alerta {
  tipo: 'margen_bajo' | 'margen_alto' | 'fuera_mercado' | 'costo_alto' | 'sin_precio';
  nivel: 'rojo' | 'amarillo' | 'info';
  mensaje: string;
}

export interface CostoCompleto {
  productoId: string;
  productoNombre: string;
  categoria: string;
  canal: Canal;

  // Capas hacia el costo total
  capas: CapaCosto[];
  costoTotal: number;

  // Cálculo del precio sugerido y márgenes
  markup: number;
  precioSugeridoSinRedondeo: number;
  precioSugerido: number;
  precioActual: number | null;

  // Despeje del precio actual
  precioNeto: number | null;
  ivaContenido: number | null;
  comisionMp: number | null;
  precioRecibido: number | null;
  margenAbs: number | null;
  margenPctSobrePrecio: number | null; // (recibido - costo) / recibido
  markupRealSobreCosto: number | null; // (recibido - costo) / costo

  // Alertas
  alertas: Alerta[];

  // Loading
  isLoading: boolean;
  warnings: string[];
}

interface ProductoElaborado {
  id: string;
  nombre: string;
  tipo: string;
  unidad: string;
  receta_id: string | null;
  insumo_reventa_id: string | null;
  ml_por_venta: number | null;
  precio_venta: number | null;
  costo_empaque: number | null;
}

function redondear(monto: number, paso: number): number {
  if (!paso || paso <= 0) return monto;
  return Math.round(monto / paso) * paso;
}

export function useCostoCompleto(
  productoId: string | null,
  canal: Canal,
  medioPagoEstimado: string = 'qr',
) {
  const productoQ = useQuery({
    queryKey: ['cocina-producto-detalle', productoId],
    enabled: !!productoId,
    queryFn: async (): Promise<ProductoElaborado | null> => {
      if (!productoId) return null;
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, tipo, unidad, receta_id, insumo_reventa_id, ml_por_venta, precio_venta, costo_empaque')
        .eq('id', productoId)
        .maybeSingle();
      if (error) throw error;
      return data as ProductoElaborado | null;
    },
  });

  const { costos: costosRecetas, isLoading: costosLoading } = useCostosRecetas();
  const { config: configGen } = useConfigCosteo();
  const { getConfig } = useProductosCosteoConfig();
  const { getComision } = useComisionMpConfig();
  const packagingQ = usePackagingProducto(productoId);
  const adicionalesQ = useAdicionalesProducto(productoId);
  const manoObra = useManoObra();

  return useMemo<CostoCompleto | null>(() => {
    if (!productoId) return null;
    const producto = productoQ.data;
    if (!producto) {
      return {
        productoId,
        productoNombre: '',
        categoria: '',
        canal,
        capas: [],
        costoTotal: 0,
        markup: 0,
        precioSugeridoSinRedondeo: 0,
        precioSugerido: 0,
        precioActual: null,
        precioNeto: null,
        ivaContenido: null,
        comisionMp: null,
        precioRecibido: null,
        margenAbs: null,
        margenPctSobrePrecio: null,
        markupRealSobreCosto: null,
        alertas: [],
        isLoading: productoQ.isLoading,
        warnings: [],
      };
    }

    const capas: CapaCosto[] = [];
    const warnings: string[] = [];

    // ─── Capa 1+2: Costo base ───────────────────────────────────────────────
    // Elaborado → costo de receta (subrecetas + merma de insumos).
    // Reventa  → costo_unitario del insumo comprado (bebida lata, agua, vino).
    let costoReceta = 0;
    let capaBaseLabel = 'Materia prima + subrecetas (con merma)';
    let capaBaseDetalle = 'Sin receta';
    if (producto.receta_id) {
      const c = costosRecetas.get(producto.receta_id);
      if (c) {
        // Si el producto se mide en porciones, usamos costoPorPorcion; si en
        // kg/L, costoPorKg. Si la unidad no coincide, intentamos fallback.
        const u = (producto.unidad ?? '').toLowerCase();
        const esPeso = u === 'kg' || u === 'litros' || u === 'lt' || u === 'l';
        if (esPeso && c.costoPorKg != null) costoReceta = c.costoPorKg;
        else if (!esPeso && c.costoPorPorcion != null) costoReceta = c.costoPorPorcion;
        else costoReceta = c.costoPorPorcion ?? c.costoPorKg ?? 0;

        if (c.advertencias.length > 0) {
          warnings.push(...c.advertencias.map((a) => `Receta: ${a}`));
        }
      } else {
        warnings.push('No se encontró costeo de la receta vinculada');
      }
      capaBaseDetalle = 'Aplica merma_pct de insumos y costos de subrecetas';
    } else {
      warnings.push('Producto sin receta vinculada (costo base = $0)');
    }
    capas.push({
      id: 'receta',
      label: capaBaseLabel,
      monto: costoReceta,
      detalle: capaBaseDetalle,
    });

    // ─── Capa 3: Packaging según canal ──────────────────────────────────────
    let costoPackaging = 0;
    let packagingDetalle = '';
    for (const p of packagingQ.data ?? []) {
      if (p.canal === canal || p.canal === 'todos') {
        const sub = p.cantidad * (p.insumo_costo_unitario ?? 0);
        costoPackaging += sub;
      }
    }
    if ((packagingQ.data ?? []).length === 0) {
      packagingDetalle = 'Sin packaging cargado';
    } else {
      const items = (packagingQ.data ?? []).filter(
        (p) => p.canal === canal || p.canal === 'todos',
      );
      packagingDetalle = `${items.length} ítem(s) aplicable(s) a ${canal}`;
    }
    capas.push({
      id: 'packaging',
      label: 'Packaging',
      monto: costoPackaging,
      detalle: packagingDetalle,
    });

    // ─── Capa 4: Adicionales del servicio según canal ───────────────────────
    let costoAdicionales = 0;
    let adicionalesDetalle = '';
    if (canal === 'congelado') {
      adicionalesDetalle = 'No aplica a canal congelado';
    } else {
      for (const a of adicionalesQ.data ?? []) {
        if (a.canal !== canal && a.canal !== 'todos') continue;
        let unitCost = 0;
        if (a.origen === 'insumo') {
          unitCost = a.origen_costo_unitario;
        } else if (a.origen === 'elaborado') {
          // Buscar costo del producto elaborado via su receta
          // OJO: esto NO recursivamente vuelve a meter packaging/adicionales,
          // solo materia prima de su receta. Suficiente para pan de Saavedra, aceite saborizado.
          // Mejor approach: leer cocina_productos.receta_id y usar costoRecetas. Pero acá no tengo
          // el receta_id del adicional. Simplificación: costo = 0 con warning.
          // TODO en fase 2: resolver costo de elaborados como adicional.
          warnings.push(
            `Adicional elaborado "${a.origen_nombre}" todavía no costea automáticamente (se cargará en una fase futura)`,
          );
          unitCost = 0;
        }
        costoAdicionales += a.cantidad * unitCost;
      }
      const items = (adicionalesQ.data ?? []).filter(
        (a) => a.canal === canal || a.canal === 'todos',
      );
      adicionalesDetalle = items.length === 0 ? 'Sin adicionales cargados' : `${items.length} ítem(s)`;
    }
    capas.push({
      id: 'adicionales',
      label: 'Adicionales de servicio',
      monto: costoAdicionales,
      detalle: adicionalesDetalle,
    });

    // ─── Capa 5: Costo empaque legacy (cocina_productos.costo_empaque) ──────
    // Mantenemos para no romper datos cargados a mano. En el futuro este
    // campo se migra al modelo de packaging.
    const costoEmpaqueLegacy = producto.costo_empaque ?? 0;
    if (costoEmpaqueLegacy > 0) {
      capas.push({
        id: 'empaque_legacy',
        label: 'Empaque (campo legacy)',
        monto: costoEmpaqueLegacy,
        detalle: 'Migrar a la sección Packaging para que dependa del canal',
      });
    }

    // ─── Capa 5b: Mano de obra (pool fijo mensual repartido por producción) ──
    // El sueldo de producción es fijo. El pool mensual del local se reparte
    // entre lo que se produjo ese mes (lotes Cocina), ponderado por minutos.
    // v1: se imputa la MO de la receta DIRECTA del producto (no recursivo
    // sobre subrecetas relleno/masa — eso es mejora futura).
    let costoManoObra = 0;
    let moDetalle = '';
    if (producto.receta_id) {
      const mo = manoObra.costoPorReceta.get(producto.receta_id);
      if (mo) {
        costoManoObra = mo.costoMoUnitario;
        moDetalle = `Pool ${manoObra.periodo} · producción ${mo.produccionMes.toFixed(0)} ${mo.unidad}${
          mo.minutosLote ? ` · ${mo.minutosLote}min/lote` : ' · sin minutos (reparto por volumen)'
        }`;
      } else if (manoObra.hayProduccion) {
        moDetalle = 'La receta no registró producción este mes → MO no imputable';
        warnings.push(
          'Mano de obra: la receta no tiene lotes producidos este mes. MO = $0 hasta que se registre producción.',
        );
      } else {
        moDetalle = 'Sin datos de producción del mes';
      }
    } else {
      moDetalle = 'Producto sin receta';
    }
    capas.push({
      id: 'mano_obra',
      label: 'Mano de obra (cocina)',
      monto: costoManoObra,
      detalle: moDetalle,
    });

    // ─── Capa 6: Margen de seguridad global ─────────────────────────────────
    const margenSeguridadPct = configGen?.margen_seguridad_pct ?? 0;
    const subtotalSinSeguridad =
      costoReceta + costoPackaging + costoAdicionales + costoEmpaqueLegacy + costoManoObra;
    const colchon = subtotalSinSeguridad * margenSeguridadPct;
    if (margenSeguridadPct > 0) {
      capas.push({
        id: 'colchon',
        label: 'Margen de seguridad',
        monto: colchon,
        detalle: `${(margenSeguridadPct * 100).toFixed(1)}% sobre el subtotal`,
      });
    }

    const costoTotal = subtotalSinSeguridad + colchon;
    capas.push({
      id: 'costo_total',
      label: 'Costo total',
      monto: costoTotal,
      esResultado: true,
    });

    // ─── Precio sugerido y márgenes ─────────────────────────────────────────
    const cfgCat = getConfig(producto.tipo);
    const markup = cfgCat?.markup_objetivo ?? 0.70;
    const redondeo = cfgCat?.redondeo ?? 100;
    const precioSugeridoSinRedondeo = costoTotal * (1 + markup);
    const precioSugerido = redondear(precioSugeridoSinRedondeo, redondeo);

    // ─── Despeje del precio actual ──────────────────────────────────────────
    const precioActual = producto.precio_venta;
    const ivaPct = configGen?.iva_pct ?? 0.21;
    const comisionMpPct = getComision(medioPagoEstimado);

    let precioNeto: number | null = null;
    let ivaContenido: number | null = null;
    let comisionMp: number | null = null;
    let precioRecibido: number | null = null;
    let margenAbs: number | null = null;
    let margenPctSobrePrecio: number | null = null;
    let markupRealSobreCosto: number | null = null;

    if (precioActual != null && precioActual > 0) {
      precioNeto = precioActual / (1 + ivaPct);
      ivaContenido = precioActual - precioNeto;
      comisionMp = precioNeto * comisionMpPct;
      precioRecibido = precioNeto - comisionMp;
      margenAbs = precioRecibido - costoTotal;
      margenPctSobrePrecio = precioRecibido > 0 ? margenAbs / precioRecibido : null;
      markupRealSobreCosto = costoTotal > 0 ? margenAbs / costoTotal : null;
    }

    // ─── Alertas ────────────────────────────────────────────────────────────
    const alertas: Alerta[] = [];
    if (!precioActual) {
      alertas.push({
        tipo: 'sin_precio',
        nivel: 'amarillo',
        mensaje: 'Sin precio de venta cargado. Precio sugerido: ' + precioSugerido.toFixed(0),
      });
    } else if (cfgCat) {
      if (margenPctSobrePrecio != null && margenPctSobrePrecio < cfgCat.margen_min) {
        alertas.push({
          tipo: 'margen_bajo',
          nivel: 'rojo',
          mensaje: `Margen ${(margenPctSobrePrecio * 100).toFixed(1)}% abajo del mínimo (${(
            cfgCat.margen_min * 100
          ).toFixed(0)}%) para categoría "${producto.tipo}"`,
        });
      }
      if (margenPctSobrePrecio != null && margenPctSobrePrecio > cfgCat.margen_max) {
        alertas.push({
          tipo: 'margen_alto',
          nivel: 'amarillo',
          mensaje: `Margen ${(margenPctSobrePrecio * 100).toFixed(1)}% arriba del máximo (${(
            cfgCat.margen_max * 100
          ).toFixed(0)}%). ¿Costo mal cargado o estás dejando plata en la mesa?`,
        });
      }
      if (
        cfgCat.rango_mercado_min != null &&
        cfgCat.rango_mercado_max != null &&
        precioActual != null &&
        (precioActual < cfgCat.rango_mercado_min || precioActual > cfgCat.rango_mercado_max)
      ) {
        alertas.push({
          tipo: 'fuera_mercado',
          nivel: 'amarillo',
          mensaje: `Precio fuera de rango de mercado configurado (${cfgCat.rango_mercado_min.toFixed(
            0,
          )}–${cfgCat.rango_mercado_max.toFixed(0)})`,
        });
      }
    }

    return {
      productoId,
      productoNombre: producto.nombre,
      categoria: producto.tipo,
      canal,
      capas,
      costoTotal,
      markup,
      precioSugeridoSinRedondeo,
      precioSugerido,
      precioActual,
      precioNeto,
      ivaContenido,
      comisionMp,
      precioRecibido,
      margenAbs,
      margenPctSobrePrecio,
      markupRealSobreCosto,
      alertas,
      isLoading:
        productoQ.isLoading ||
        costosLoading ||
        packagingQ.isLoading ||
        adicionalesQ.isLoading ||
        manoObra.isLoading,
      warnings,
    };
  }, [
    productoId,
    productoQ.data,
    productoQ.isLoading,
    costosRecetas,
    costosLoading,
    configGen,
    getConfig,
    getComision,
    medioPagoEstimado,
    canal,
    packagingQ.data,
    packagingQ.isLoading,
    adicionalesQ.data,
    adicionalesQ.isLoading,
    manoObra.costoPorReceta,
    manoObra.isLoading,
    manoObra.hayProduccion,
    manoObra.periodo,
  ]);
}
