// Lo que se vendió, leído de NUESTRA base.
//
// POR QUÉ EXISTE
// Cinco pantallas de Cocina le preguntaban a la API de Fudo en vivo (Edge Function
// `fudo-productos`). Fudo se va a dejar de usar, y el día que se corte esas
// llamadas devuelven cero: el plan de producción se calcularía con demanda cero, el
// stock mostraría cobertura infinita y el conteo del mostrador diría que sobra todo.
// Todo eso SIN UN SOLO ERROR en pantalla, que es la peor forma de romperse.
//
// Ahora leen `ventas_items`, que ya escriben los dos orígenes: el importador de Fudo
// (cada 15 minutos, mig 180) y el POS propio. El día que Fudo se corte, estas
// pantallas no se enteran.
//
// VALIDADO CONTRA FUDO, misma ventana (1 al 4 de septiembre):
//   Vedia    49 productos, 49 coinciden exacto. 1.067 unidades = 1.067.
//   Saavedra 66 productos, 64 exactos, total 598 = 598. Las 2 diferencias son EL
//            MISMO producto renombrado en Fudo — la API reescribe la historia
//            cuando alguien cambia un nombre, nuestra copia guarda el que tenía.
//
// SIN PLATA A LA VISTA
// La RPC devuelve sólo nombre y cantidad. Eso es lo que permite llamarla desde
// `/mostrador`, que es pantalla pública y entra como `anon`. Las pantallas
// declaraban `facturacion` y `categoria` en sus tipos pero no las usaban en ningún
// lado, así que no se perdió nada.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RankingVenta {
  nombre: string;
  cantidad: number;
}

export interface VentasCocina {
  ranking: RankingVenta[];
  dias: number;
}

/**
 * Argentina no tiene horario de verano, así que el huso es -03:00 todo el año y se
 * puede escribir fijo. Construye el instante que corresponde a las 00:00 de una
 * fecha local.
 */
function inicioDelDiaAR(fecha: string): Date {
  return new Date(`${fecha}T00:00:00-03:00`);
}

function finDelDiaAR(fecha: string): Date {
  const d = inicioDelDiaAR(fecha);
  d.setDate(d.getDate() + 1);
  return d;
}

/** Días de calendario que abarca el rango, ambos inclusive. Mínimo 1. */
function diasDelRango(fechaDesde: string, fechaHasta: string): number {
  const ms = inicioDelDiaAR(fechaHasta).getTime() - inicioDelDiaAR(fechaDesde).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

async function pedirRanking(
  client: SupabaseClient,
  local: string,
  desde: Date,
  hasta: Date,
): Promise<RankingVenta[]> {
  const { data, error } = await client.rpc('cocina_ventas_por_producto', {
    p_local: local,
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
  });
  if (error) throw error;
  return ((data ?? []) as Array<{ nombre: string; cantidad: number | string }>).map((r) => ({
    nombre: r.nombre,
    cantidad: Number(r.cantidad),
  }));
}

/**
 * Lo vendido entre dos fechas, ambas inclusive. Es el reemplazo directo de
 * `invoke('fudo-productos', { local, fechaDesde, fechaHasta })`.
 */
export async function ventasPorDias(
  client: SupabaseClient,
  local: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<VentasCocina> {
  const ranking = await pedirRanking(
    client,
    local,
    inicioDelDiaAR(fechaDesde),
    finDelDiaAR(fechaHasta),
  );
  return { ranking, dias: diasDelRango(fechaDesde, fechaHasta) };
}

/**
 * Lo vendido desde un instante exacto hasta ahora. Lo usa el conteo del mostrador,
 * que necesita "lo vendido desde el último conteo de las 14:35", no "lo vendido hoy".
 *
 * Funciona porque `ventas_tickets` guarda la HORA además de la fecha, y esa hora es
 * argentina (verificado contra la distribución real: los picos caen 12-14h y 21-23h;
 * si fuera UTC el almuerzo aparecería 15-17h).
 */
export async function ventasDesde(
  client: SupabaseClient,
  local: string,
  desdeISO: string,
  hastaISO: string,
): Promise<VentasCocina> {
  const desde = new Date(desdeISO);
  const hasta = new Date(hastaISO);
  const ranking = await pedirRanking(client, local, desde, hasta);
  const dias = Math.max(1, Math.ceil((hasta.getTime() - desde.getTime()) / 86_400_000));
  return { ranking, dias };
}

/**
 * Tickets por día de semana (0 = domingo). Alimenta el factor "mañana se vende más
 * o menos que el promedio" del plan de producción.
 */
export async function ticketsPorDiaSemana(
  client: SupabaseClient,
  local: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<Record<number, { tickets: number }>> {
  const { data, error } = await client.rpc('cocina_tickets_por_dia_semana', {
    p_local: local,
    p_desde: inicioDelDiaAR(fechaDesde).toISOString(),
    p_hasta: finDelDiaAR(fechaHasta).toISOString(),
  });
  if (error) throw error;
  const out: Record<number, { tickets: number }> = {};
  for (const r of (data ?? []) as Array<{ dia_semana: number; tickets: number | string }>) {
    out[Number(r.dia_semana)] = { tickets: Number(r.tickets) };
  }
  return out;
}
