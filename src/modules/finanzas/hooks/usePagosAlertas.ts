import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface PagoPendiente {
  id: string;
  concepto: string;
  monto: number | null;
  fecha_vencimiento: string | null;
  periodo: string | null;
}

export interface UrgentesEnPeriodo {
  cantidad: number;
  monto: number;
}

export type UrgenciaPago = 'vencido' | 'hoy' | 'semana' | 'proximo' | 'ok';

export function urgenciaPago(fechaVto: string | null): UrgenciaPago {
  if (!fechaVto) return 'ok';
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vto = new Date(fechaVto + 'T12:00:00');
  vto.setHours(0, 0, 0, 0);
  const diffDias = Math.floor((vto.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDias < 0) return 'vencido';
  if (diffDias === 0) return 'hoy';
  if (diffDias <= 7) return 'semana';
  if (diffDias <= 15) return 'proximo';
  return 'ok';
}

// Hook para alertas globales de pagos (usado en sidebar y dashboards)
export function usePagosAlertas() {
  return useQuery({
    queryKey: ['pagos_alertas_global'],
    queryFn: async () => {
      // Todos los pagos no pagados con fecha de vencimiento
      const { data } = await supabase
        .from('pagos_fijos')
        .select('id, concepto, monto, fecha_vencimiento, periodo')
        .eq('pagado', false)
        .not('fecha_vencimiento', 'is', null);
      const pagos = (data ?? []) as PagoPendiente[];

      const vencidos = pagos.filter((p) => urgenciaPago(p.fecha_vencimiento) === 'vencido');
      const hoy = pagos.filter((p) => urgenciaPago(p.fecha_vencimiento) === 'hoy');
      const semana = pagos.filter((p) => urgenciaPago(p.fecha_vencimiento) === 'semana');
      const urgentes = [...vencidos, ...hoy, ...semana];

      const porPeriodo: Record<string, UrgentesEnPeriodo> = {};
      for (const p of urgentes) {
        if (!p.periodo) continue;
        const agg = porPeriodo[p.periodo] ?? { cantidad: 0, monto: 0 };
        agg.cantidad += 1;
        agg.monto += p.monto ?? 0;
        porPeriodo[p.periodo] = agg;
      }

      return {
        vencidos: vencidos.length,
        hoy: hoy.length,
        semana: semana.length,
        urgentesTotal: urgentes.length,
        montoVencido: vencidos.reduce((s, p) => s + (p.monto ?? 0), 0),
        montoUrgente: urgentes.reduce((s, p) => s + (p.monto ?? 0), 0),
        porPeriodo,
      };
    },
    staleTime: 1000 * 60 * 5, // refresca cada 5 min
  });
}
