// Hook para detectar cuándo fue la última importación de extractos bancarios.
//
// Usa MAX(fecha) por cuenta como proxy: si las cuentas tienen movimientos
// diarios y la última transacción es de hace >15 días, es señal clara de
// que falta importar el extracto del período.
//
// Umbrales:
//  - 0–14 días: ok (verde)
//  - 15–24 días: aviso (amarillo) — toca importar
//  - 25+ días: critico (rojo) — falta importar urgente

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

export const LABEL_CUENTA: Record<CuentaBanco, string> = {
  mercadopago: 'MercadoPago',
  galicia: 'Galicia',
  icbc: 'ICBC',
};

function clasificar(diasDesde: number, ultimaFecha: string | null): EstadoFrescura {
  if (!ultimaFecha) return 'sin_datos';
  if (diasDesde >= 25) return 'critico';
  if (diasDesde >= 15) return 'aviso';
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
            estado: clasificar(diasDesde, ultimaFecha),
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
