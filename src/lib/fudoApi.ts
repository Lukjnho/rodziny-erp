/**
 * Cliente Fudo — llama a la Edge Function `fudo-ventas` que actúa como proxy.
 * Esto evita problemas de CORS ya que el browser solo habla con Supabase.
 *
 * Flujo: Browser → Supabase Edge Function → Fudo API → respuesta al browser
 */

import { supabase } from './supabase'

// ── IDs de medios de pago Fudo ──────────────────────────────────────────────
export const PAYMENT_METHOD_IDS: Record<string, string> = {
  '1': 'Efectivo',
  '2': 'Cta. Cte.',
  '7': 'Mercadopago Lucas',
  '8': 'Transferencia',
  '11': 'Cheque',
  '14': 'Codigo QR',
  '15': 'Tarjeta de débito',
  '16': 'Tarjeta de crédito',
}

export const PM = {
  efectivo: '1',
  qr: '14',
  debito: '15',
  credito: '16',
  transferencia: '8',
  mpLucas: '7',
  ctaCte: '2',
} as const

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
}

// ── Resultado agrupado por medio de pago ────────────────────────────────────
export interface CajaResumen {
  tickets: number
  total: number
  cajero: string | null
}

export interface VentasFudoResumen {
  fecha: string
  local: string
  totalVentas: number
  cantidadTickets: number
  porMedioPago: Record<string, number>
  efectivo: number
  qr: number
  debito: number
  credito: number
  transferencia: number
  mpLucas: number
  ctaCte: number
  otros: number
  cajero: string | null
  porCaja: Record<string, CajaResumen>
}

// ── Obtener ventas de Fudo via Edge Function ────────────────────────────────
export async function obtenerVentasFudo(
  local: string,
  fecha: string,
  onProgreso?: (msg: string) => void,
  cajaId?: string,
): Promise<VentasFudoResumen> {
  onProgreso?.('Consultando ventas en Fudo...')

  const { data, error } = await supabase.functions.invoke('fudo-ventas', {
    body: { local, fecha, cajaId },
  })

  if (error) {
    throw new Error(`Error Edge Function: ${error.message}`)
  }

  if (!data?.ok) {
    throw new Error(data?.error ?? 'Respuesta inválida de fudo-ventas')
  }

  const resumen = data.data as VentasFudoResumen
  const cajaLabel = cajaId ? ` (caja ${cajaId})` : ''
  onProgreso?.(`${resumen.cantidadTickets} tickets cargados${cajaLabel}`)
  return resumen
}
