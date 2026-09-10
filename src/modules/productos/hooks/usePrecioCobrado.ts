import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { hoyAR } from '@/lib/fechaAR';

// A qué precio se está cobrando REALMENTE cada receta, según las ventas de los
// últimos días. Sirve para contrastarlo contra el precio de la carta
// (cocina_recetas_precios_canal) y avisar cuando no coinciden.
//
// Por qué importa: desde la mig 192 el POS propio cobra el precio de la CARTA,
// no el que manda la pantalla. O sea que el día que se prenda la caja, todo
// producto cuya carta esté desalineada empieza a cobrarse por un precio
// distinto al de hoy — sin que nadie lo haya decidido. Este aviso saca esos
// casos a la luz ANTES de prender la caja, no después.

// Ventana corta a propósito: un aumento aplicado hace dos semanas ya no tiene
// que seguir gritando. Con 7 días, un cambio se apaga solo a la semana.
const DIAS_VENTANA = 7;

// Mínimo de unidades a un mismo precio para tomarlo en serio. Con una sola
// venta no se distingue un precio nuevo de un dedazo del cajero.
const UDS_MINIMAS = 2;

export interface PrecioCobrado {
  recetaId: string;
  /** El precio al que más unidades se vendieron en la ventana. */
  precio: number;
  /** Unidades vendidas a ESE precio. */
  uds: number;
  /** Unidades vendidas en toda la ventana, a cualquier precio. */
  udsTotales: number;
  /** Última fecha en que se cobró ese precio (AAAA-MM-DD). */
  ultima: string;
}

interface FilaVenta {
  receta_id: string;
  precio_unitario: number;
  cantidad: number;
  fecha: string;
}

function desdeAR(dias: number): string {
  // hoyAR() ya contempla el corte de jornada; restar días sobre esa fecha
  // evita que la ventana se corra sola entre las 21:00 y la medianoche.
  const d = new Date(`${hoyAR()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Devuelve, por receta del local, el precio al que más se vendió en los últimos
 * días. No filtra por `origen`: la pregunta es a qué precio se cobró de verdad,
 * venga la venta de Fudo o de la caja propia.
 */
export function usePrecioCobrado(local: 'vedia' | 'saavedra' | null) {
  const desde = useMemo(() => desdeAR(DIAS_VENTANA), []);

  const ventasQ = useQuery({
    queryKey: ['menu-precio-cobrado', local, desde],
    enabled: !!local,
    queryFn: async () => {
      // 💣 Paginado obligatorio: Supabase corta en 1000 filas y NO avisa. Una
      // semana de Vedia son ~2.200 renglones, así que sin esto el precio más
      // vendido se calculaba sobre un pedazo arbitrario de la semana y salía
      // mal en silencio. Mismo patrón que useVentasResumen.
      const PAGE = 1000;
      const filas: FilaVenta[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('ventas_items')
          .select('receta_id, precio_unitario, cantidad, fecha')
          .eq('local', local!)
          .gte('fecha', desde)
          .not('receta_id', 'is', null)
          .gt('precio_unitario', 0)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        filas.push(...(data as FilaVenta[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return filas;
    },
  });

  const data = useMemo(() => {
    const porReceta = new Map<string, Map<number, { uds: number; ultima: string }>>();
    const totales = new Map<string, number>();

    for (const v of ventasQ.data ?? []) {
      const uds = Number(v.cantidad) || 0;
      if (uds <= 0) continue;
      const precio = Number(v.precio_unitario);
      if (!Number.isFinite(precio) || precio <= 0) continue;

      totales.set(v.receta_id, (totales.get(v.receta_id) ?? 0) + uds);

      let porPrecio = porReceta.get(v.receta_id);
      if (!porPrecio) {
        porPrecio = new Map();
        porReceta.set(v.receta_id, porPrecio);
      }
      const prev = porPrecio.get(precio);
      if (prev) {
        prev.uds += uds;
        if (v.fecha > prev.ultima) prev.ultima = v.fecha;
      } else {
        porPrecio.set(precio, { uds, ultima: v.fecha });
      }
    }

    const out = new Map<string, PrecioCobrado>();
    for (const [recetaId, porPrecio] of porReceta) {
      // El precio de referencia es el que movió más unidades. Ante empate, el
      // más reciente: si un aumento arrancó a mitad de semana, es el que vale.
      let mejor: { precio: number; uds: number; ultima: string } | null = null;
      for (const [precio, { uds, ultima }] of porPrecio) {
        if (
          !mejor ||
          uds > mejor.uds ||
          (uds === mejor.uds && ultima > mejor.ultima)
        ) {
          mejor = { precio, uds, ultima };
        }
      }
      if (!mejor || mejor.uds < UDS_MINIMAS) continue;
      out.set(recetaId, {
        recetaId,
        precio: mejor.precio,
        uds: mejor.uds,
        udsTotales: totales.get(recetaId) ?? mejor.uds,
        ultima: mejor.ultima,
      });
    }
    return out;
  }, [ventasQ.data]);

  return { data, dias: DIAS_VENTANA, isLoading: ventasQ.isLoading, error: ventasQ.error };
}
