/**
 * Cliente Fudo — llama a la Edge Function `fudo-ventas` que actúa como proxy.
 * Esto evita problemas de CORS ya que el browser solo habla con Supabase.
 *
 * Flujo: Browser → Supabase Edge Function → Fudo API → respuesta al browser
 */

import { supabase } from './supabase';

// 🗑️ Acá vivían PAYMENT_METHOD_IDS y PM: un segundo catálogo de medios de pago,
// con los ids de Fudo y sus nombres escritos a mano ('Mercadopago Lucas' entre
// ellos). Estaban exportados y NADIE los importaba — el único que usa este
// archivo se lleva obtenerVentasFudo y CAJA_FUDO_ID.
//
// No se reemplazan por nada: el catálogo de verdad es la tabla `medios_pago`
// con sus alias, y el disparador de la base traduce el texto que manda Fudo
// (mig 138, mig 205). Un segundo catálogo dormido es la forma en que después
// aparece un tercero.

// ── Mapeo de cajas ERP → CashRegister IDs de Fudo ──────────────────────────
export const CAJA_FUDO_ID: Record<string, Record<string, string>> = {
  vedia: {
    'Principal Pastas 1': '1',
    'Barra Bebidas': '4',
  },
  saavedra: {
    // Completar cuando Saavedra tenga API habilitada
    'Caja Principal': '1',
  },
  // Bienal 2026: cajas del Fudo de Saavedra (mismos CashRegister IDs).
  bienal: {
    'Stand Saavedra': '3',
    'Stand Vedia': '4',
  },
};

// ── Resultado agrupado por medio de pago ────────────────────────────────────
export interface CajaResumen {
  tickets: number;
  total: number;
  cajero: string | null;
}

export interface VentasFudoResumen {
  fecha: string;
  local: string;
  totalVentas: number;
  cantidadTickets: number;
  porMedioPago: Record<string, number>;
  efectivo: number;
  qr: number;
  debito: number;
  credito: number;
  transferencia: number;
  mpLucas: number;
  ctaCte: number;
  otros: number;
  cajero: string | null;
  porCaja: Record<string, CajaResumen>;
  nrosArqueo: string[];
}

// ── Obtener ventas de Fudo via Edge Function ────────────────────────────────
export async function obtenerVentasFudo(
  local: string,
  fecha: string,
  onProgreso?: (msg: string) => void,
  cajaId?: string,
  horaDesde?: string,
  horaHasta?: string,
  userId?: string,
): Promise<VentasFudoResumen> {
  onProgreso?.('Consultando ventas en Fudo...');

  const { data, error } = await supabase.functions.invoke('fudo-ventas', {
    body: { local, fecha, cajaId, horaDesde, horaHasta, userId },
  });

  if (error) {
    throw new Error(`Error Edge Function: ${error.message}`);
  }

  if (!data?.ok) {
    throw new Error(data?.error ?? 'Respuesta inválida de fudo-ventas');
  }

  const resumen = data.data as VentasFudoResumen;
  const cajaLabel = cajaId ? ` (caja ${cajaId})` : '';
  onProgreso?.(`${resumen.cantidadTickets} tickets cargados${cajaLabel}`);
  return resumen;
}
