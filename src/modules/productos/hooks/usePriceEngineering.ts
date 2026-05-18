import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ProductoCarta {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  local: string;
  precio_venta: number;
}

export interface VentaPorProducto {
  codigo: string;
  local: string;
  uds: number;
  total: number;
}

export interface OmnesResultado {
  // Principio 1: Distribución de precios
  gamaBajaCount: number;
  gamaMediaCount: number;
  gamaAltaCount: number;
  distribucionOk: boolean;
  limiteBajaMedia: number;
  limiteMediaAlta: number;

  // Principio 2: Amplitud de gama
  precioMin: number;
  precioMax: number;
  coeficiente: number; // precio_max / precio_min
  amplitudOk: boolean; // ideal 2.5 a 3.5

  // Principio 3: Relación Calidad-Precio
  precioMedioOfertado: number;
  precioMedioDemandado: number;
  ratioRcp: number; // ofertado / demandado, ideal 0.95-1.05
  rcpOk: boolean;

  // Total de productos analizados
  totalProductos: number;
}

export function usePriceEngineering(
  local: 'vedia' | 'saavedra' | 'todos',
  categoria: string | 'todas',
  periodosVentas: string[],
) {
  const productosQ = useQuery({
    queryKey: ['price-engineering-productos', local, categoria],
    queryFn: async () => {
      let q = supabase
        .from('cocina_productos')
        .select('id, codigo, nombre, tipo, local, precio_venta')
        .eq('activo', true)
        .not('precio_venta', 'is', null)
        .gt('precio_venta', 0);
      if (local !== 'todos') q = q.eq('local', local);
      if (categoria !== 'todas') q = q.eq('tipo', categoria);
      const { data, error } = await q;
      if (error) throw error;
      return data as ProductoCarta[];
    },
  });

  const ventasQ = useQuery({
    queryKey: ['price-engineering-ventas', local, periodosVentas],
    enabled: periodosVentas.length > 0,
    queryFn: async () => {
      let q = supabase
        .from('ventas_items')
        .select('codigo, local, cantidad, total')
        .in('periodo', periodosVentas);
      if (local !== 'todos') q = q.eq('local', local);
      const { data, error } = await q;
      if (error) throw error;
      // Agregar por codigo + local
      const agg = new Map<string, VentaPorProducto>();
      for (const r of data ?? []) {
        const key = `${r.local}|${r.codigo}`;
        const prev = agg.get(key);
        if (prev) {
          prev.uds += Number(r.cantidad);
          prev.total += Number(r.total);
        } else {
          agg.set(key, {
            codigo: r.codigo,
            local: r.local,
            uds: Number(r.cantidad),
            total: Number(r.total),
          });
        }
      }
      return Array.from(agg.values());
    },
  });

  return useMemo<{
    resultado: OmnesResultado | null;
    productos: ProductoCarta[];
    isLoading: boolean;
  }>(() => {
    const productos = productosQ.data;
    const ventas = ventasQ.data ?? [];
    const isLoading = productosQ.isLoading || ventasQ.isLoading;
    if (!productos || productos.length === 0) {
      return { resultado: null, productos: productos ?? [], isLoading };
    }

    const precios = productos.map((p) => p.precio_venta).sort((a, b) => a - b);
    const precioMin = precios[0];
    const precioMax = precios[precios.length - 1];

    // ─── Principio 1: tercios del rango ─────────────────────────────────────
    const tercio = (precioMax - precioMin) / 3;
    const limiteBajaMedia = precioMin + tercio;
    const limiteMediaAlta = precioMin + 2 * tercio;
    let gB = 0,
      gM = 0,
      gA = 0;
    for (const p of productos) {
      if (p.precio_venta <= limiteBajaMedia) gB++;
      else if (p.precio_venta <= limiteMediaAlta) gM++;
      else gA++;
    }
    // Cortijo: cantidad en gama media >= suma de bajas + altas
    const distribucionOk = gM >= gB + gA;

    // ─── Principio 2: coeficiente ────────────────────────────────────────────
    const coeficiente = precioMin > 0 ? precioMax / precioMin : 0;
    const amplitudOk = coeficiente >= 2.5 && coeficiente <= 3.5;

    // ─── Principio 3: RCP ────────────────────────────────────────────────────
    const precioMedioOfertado =
      productos.reduce((s, p) => s + p.precio_venta, 0) / productos.length;

    let udsTotal = 0;
    let recaudadoTotal = 0;
    const ventasMap = new Map<string, VentaPorProducto>();
    for (const v of ventas) ventasMap.set(`${v.local}|${v.codigo}`, v);
    for (const p of productos) {
      const v = ventasMap.get(`${p.local}|${p.codigo}`);
      if (v) {
        udsTotal += v.uds;
        recaudadoTotal += v.total;
      }
    }
    const precioMedioDemandado = udsTotal > 0 ? recaudadoTotal / udsTotal : 0;

    const ratioRcp =
      precioMedioDemandado > 0 ? precioMedioOfertado / precioMedioDemandado : 0;
    const rcpOk = ratioRcp >= 0.95 && ratioRcp <= 1.05;

    return {
      resultado: {
        gamaBajaCount: gB,
        gamaMediaCount: gM,
        gamaAltaCount: gA,
        distribucionOk,
        limiteBajaMedia,
        limiteMediaAlta,
        precioMin,
        precioMax,
        coeficiente,
        amplitudOk,
        precioMedioOfertado,
        precioMedioDemandado,
        ratioRcp,
        rcpOk,
        totalProductos: productos.length,
      },
      productos,
      isLoading,
    };
  }, [productosQ.data, productosQ.isLoading, ventasQ.data, ventasQ.isLoading]);
}
