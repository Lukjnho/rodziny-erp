// Hook para detectar cuándo fue la última importación de extractos bancarios.
//
// Usa MAX(fecha) por cuenta como proxy. Cada cuenta tiene su propio umbral
// porque tienen ritmos muy distintos:
//  - MP / Galicia: movs diarios → 15/25 días
//  - ICBC: pocos movs/mes (poco usada para operación) → 45/60 días
//
// Estados: 0–warn-1 = ok · warn–critico-1 = aviso · critico+ = critico

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type CuentaBanco = 'mercadopago' | 'galicia' | 'icbc';
export type EstadoFrescura = 'ok' | 'aviso' | 'critico' | 'sin_datos';

export interface FrescuraCuenta {
  cuenta: CuentaBanco;
  ultimaFecha: string | null;
  diasDesde: number;
  estado: EstadoFrescura;
}

const CUENTAS: CuentaBanco[] = ['mercadopago', 'galicia', 'icbc'];

// Umbrales por cuenta — [aviso, crítico]
const UMBRALES: Record<CuentaBanco, { aviso: number; critico: number }> = {
  mercadopago: { aviso: 15, critico: 25 },
  galicia: { aviso: 15, critico: 25 },
  icbc: { aviso: 45, critico: 60 }, // ICBC tiene pocos movs, threshold laxo
};

export const LABEL_CUENTA: Record<CuentaBanco, string> = {
  mercadopago: 'MercadoPago',
  galicia: 'Galicia',
  icbc: 'ICBC',
};

function clasificar(
  cuenta: CuentaBanco,
  diasDesde: number,
  ultimaFecha: string | null,
): EstadoFrescura {
  if (!ultimaFecha) return 'sin_datos';
  const u = UMBRALES[cuenta];
  if (diasDesde >= u.critico) return 'critico';
  if (diasDesde >= u.aviso) return 'aviso';
  return 'ok';
}

export function useExtractosFrescura() {
  return useQuery({
    queryKey: ['extractos_frescura'],
    staleTime: 5 * 60 * 1000, // 5 min — no necesita refrescarse seguido
    queryFn: async (): Promise<FrescuraCuenta[]> => {
      // Una query por cuenta para tomar MAX(fecha) — más simple que groupBy en Supabase
      const resultados = await Promise.all(
        CUENTAS.map(async (cuenta) => {
          const { data } = await supabase
            .from('movimientos_bancarios')
            .select('fecha')
            .eq('cuenta', cuenta)
            .order('fecha', { ascending: false })
            .limit(1)
            .maybeSingle();
          const ultimaFecha = (data?.fecha as string | null) ?? null;
          let diasDesde = 0;
          if (ultimaFecha) {
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            const ult = new Date(ultimaFecha + 'T12:00:00');
            ult.setHours(0, 0, 0, 0);
            diasDesde = Math.floor((hoy.getTime() - ult.getTime()) / (1000 * 60 * 60 * 24));
          }
          return {
            cuenta,
            ultimaFecha,
            diasDesde,
            estado: clasificar(cuenta, diasDesde, ultimaFecha),
          } as FrescuraCuenta;
        }),
      );
      return resultados;
    },
  });
}

// Helper: ¿hay alguna cuenta en estado aviso o crítico?
export function hayCuentasAtrasadas(frescura: FrescuraCuenta[] | undefined): boolean {
  return (frescura ?? []).some((f) => f.estado === 'aviso' || f.estado === 'critico');
}

// Helper: el peor estado entre todas las cuentas (para colorear el banner global)
export function peorEstado(frescura: FrescuraCuenta[] | undefined): EstadoFrescura {
  if (!frescura || frescura.length === 0) return 'ok';
  if (frescura.some((f) => f.estado === 'critico')) return 'critico';
  if (frescura.some((f) => f.estado === 'aviso')) return 'aviso';
  if (frescura.some((f) => f.estado === 'sin_datos')) return 'aviso';
  return 'ok';
}
