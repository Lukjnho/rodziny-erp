import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ORIGEN_VENTAS_OFICIAL } from '@/lib/origenVentas';
import { normalizarNombre } from './useMenuEngineering';
import { useCatalogoCaja } from '@/modules/caja/useCaja';

// ─────────────────────────────────────────────────────────────────────────────
// La carta que analiza la Ley de Omnes es LA MISMA que cobra el mostrador:
// useCatalogoCaja = recetas vendibles del local + precio del canal 'plato'
// (cocina_recetas_precios_canal), que es lo que escribe el tab Menú.
//
// Antes esto leía cocina_productos.precio_venta: un ESPEJO CONGELADO que
// escribía el trigger trg_sync_precio_venta_salon colgado de la tabla VIEJA
// cocina_productos_precios_canal (sin escrituras desde may-2026). Cubría 34 de
// los 163 ítems de carta y la mayoría ni siquiera eran ítems de carta (rellenos,
// masas de producción). O sea: Omnes analizaba precios de mayo de una lista que
// no era la carta.
//
// La demanda se cruza por los nombres de Fudo (cocina_recetas.fudo_productos[]),
// mismo criterio que Menu Engineering. NO por `codigo`: el código del ERP es
// autogenerado y no es el SKU de Fudo → daba 0 filas SIEMPRE, en silencio, y el
// principio 3 quedaba en rojo permanente.
//
// NO reusar useMenuEngineering para la demanda: su ProductoME mezcla unidades
// (udsTotal, incluye líneas M.E) con facturación (baseTotal, las excluye), así
// que dividir uno por otro da un precio medio subvaluado sin avisar. Además
// arrastraría costeo, comisiones y config, que Omnes no necesita.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductoCarta {
  id: string; // id de la receta vendible
  nombre: string;
  tipo: string; // categoría del Menú: pasta, salsa, postre, bebida…
  precio: number; // canal 'plato' = precio de lista, con IVA
}

interface VentaFudoRow {
  nombre: string;
  cantidad: number;
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
  coeficiente: number;
  amplitudOk: boolean;

  // Principio 3: Relación Calidad-Precio
  precioMedioOfertado: number;
  precioMedioDemandado: number;
  ratioRcp: number;
  rcpOk: boolean;

  totalProductos: number;
  // De esos, cuántos tuvieron ventas en la ventana. Si da 0, el ratio no
  // significa nada: es el síntoma de que se rompió el cruce con Fudo.
  itemsConVenta: number;
}

export function usePriceEngineering(
  local: 'vedia' | 'saavedra',
  categoria: string | 'todas',
  periodosVentas: string[],
) {
  // La carta: MISMA fuente que el catálogo del mostrador.
  const { data: catalogo, isLoading: catalogoLoading } = useCatalogoCaja(local);

  const ventasQ = useQuery({
    queryKey: ['price-engineering-ventas-fudo', local, periodosVentas],
    enabled: periodosVentas.length > 0,
    queryFn: async (): Promise<VentaFudoRow[]> => {
      const { data, error } = await supabase
        .from('ventas_items')
        .select('nombre, cantidad, total')
        .eq('origen', ORIGEN_VENTAS_OFICIAL) // no mezclar con el POS propio
        .eq('local', local)
        .in('periodo', periodosVentas);
      if (error) throw error;
      return (data ?? []) as VentaFudoRow[];
    },
  });

  return useMemo<{
    resultado: OmnesResultado | null;
    productos: ProductoCarta[];
    categorias: string[];
    isLoading: boolean;
  }>(() => {
    const ventas = ventasQ.data ?? [];
    const isLoading = catalogoLoading || ventasQ.isLoading;
    if (!catalogo) return { resultado: null, productos: [], categorias: [], isLoading };

    // Carta COMPLETA (sin filtrar) → de acá salen las categorías del desplegable,
    // para que siga ofreciendo todas las secciones aunque haya una elegida.
    const todas: ProductoCarta[] = catalogo.map((c) => ({
      id: c.refId,
      nombre: c.nombre,
      tipo: (c.categoria ?? 'otros').toLowerCase(),
      precio: c.precio,
    }));
    const categorias = Array.from(new Set(todas.map((p) => p.tipo))).sort();
    const productos = categoria === 'todas' ? todas : todas.filter((p) => p.tipo === categoria);
    if (productos.length === 0) {
      return { resultado: null, productos: [], categorias, isLoading };
    }

    const precios = productos.map((p) => p.precio).sort((a, b) => a - b);
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
      if (p.precio <= limiteBajaMedia) gB++;
      else if (p.precio <= limiteMediaAlta) gM++;
      else gA++;
    }
    const distribucionOk = gM >= gB + gA;

    // ─── Principio 2: coeficiente ────────────────────────────────────────────
    const coeficiente = precioMin > 0 ? precioMax / precioMin : 0;
    const amplitudOk = coeficiente >= 2.5 && coeficiente <= 3.5;

    // ─── Principio 3: RCP ────────────────────────────────────────────────────
    // Ofertado = promedio SIMPLE de los precios de lista de la carta.
    // Demandado = facturado / unidades de las ventas Fudo de esos mismos ítems.
    const precioMedioOfertado =
      productos.reduce((s, p) => s + p.precio, 0) / productos.length;

    // Índice nombre de Fudo → id de receta. Si una receta no tiene sus nombres
    // Fudo cargados no aparece en la demanda: se vinculan a mano desde Costeo.
    const enCarta = new Set(productos.map((p) => p.id));
    const recetaPorFudoNombre = new Map<string, string>();
    for (const c of catalogo) {
      for (const fp of c.fudoProductos) {
        recetaPorFudoNombre.set(normalizarNombre(fp), c.refId);
      }
    }

    let udsTotal = 0;
    let recaudadoTotal = 0;
    const conVenta = new Set<string>();
    for (const v of ventas) {
      const uds = Number(v.cantidad);
      const tot = Number(v.total);
      if (uds <= 0 || tot <= 0) continue; // renglones en 0 (incluye los M.E de Vedia)
      const recetaId = recetaPorFudoNombre.get(normalizarNombre(v.nombre));
      if (!recetaId || !enCarta.has(recetaId)) continue;
      udsTotal += uds;
      recaudadoTotal += tot;
      conVenta.add(recetaId);
    }
    const precioMedioDemandado = udsTotal > 0 ? recaudadoTotal / udsTotal : 0;

    const ratioRcp = precioMedioDemandado > 0 ? precioMedioOfertado / precioMedioDemandado : 0;
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
        itemsConVenta: conVenta.size,
      },
      productos,
      categorias,
      isLoading,
    };
  }, [catalogo, catalogoLoading, ventasQ.data, ventasQ.isLoading, categoria]);
}
