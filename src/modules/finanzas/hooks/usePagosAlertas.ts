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
  // Pagos urgentes CON importe cargado: los únicos que suman a `monto`. Antes esto
  // contaba también las filas sin monto (IVA/F931 vencidos cargados en $0), así que
  // el banner decía "2 pagos · deuda $68.000" cuando la plata estaba en un solo
  // pago — y el número no cerraba contra el calendario, que descarta monto <= 0.
  cantidad: number;
  monto: number;
  // Urgentes sin importe cargado. No son deuda cuantificable, pero hay que
  // completarlos: se muestran aparte en vez de esconderlos dentro de `cantidad`.
  sinMonto: number;
}

export type UrgenciaPago = 'vencido' | 'hoy' | 'semana' | 'proximo' | 'ok';

// Días que faltan para el vencimiento. Negativo = ya venció. null = sin fecha.
export function diasHastaVto(fechaVto: string | null): number | null {
  if (!fechaVto) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vto = new Date(fechaVto + 'T12:00:00');
  vto.setHours(0, 0, 0, 0);
  return Math.floor((vto.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
}

export function urgenciaPago(fechaVto: string | null): UrgenciaPago {
  const diffDias = diasHastaVto(fechaVto);
  if (diffDias == null) return 'ok';

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

      // Los contadores (badge del sidebar, flechas del checklist) cuentan SOLO pagos
      // con importe cargado: son los que representan plata a pagar. Las filas en $0
      // (IVA/F931/cargas sociales cargadas sin monto) inflaban el badge —"21 urgentes"
      // cuando la deuda medible eran menos— y no cerraban contra el calendario, que
      // descarta monto <= 0. No se pierden: van a `sinMonto` por período y el banner
      // del checklist las muestra como "N sin importe" para que se completen.
      const conImporte = pagos.filter((p) => Number(p.monto ?? 0) > 0);
      const vencidos = conImporte.filter((p) => urgenciaPago(p.fecha_vencimiento) === 'vencido');
      const hoy = conImporte.filter((p) => urgenciaPago(p.fecha_vencimiento) === 'hoy');
      const semana = conImporte.filter((p) => urgenciaPago(p.fecha_vencimiento) === 'semana');
      const urgentes = [...vencidos, ...hoy, ...semana];

      // El desglose por período SÍ recorre todo (con y sin importe): separa las dos
      // cosas en vez de esconder las filas sin monto.
      const urgentesTodos = pagos.filter((p) => {
        const u = urgenciaPago(p.fecha_vencimiento);
        return u === 'vencido' || u === 'hoy' || u === 'semana';
      });

      const porPeriodo: Record<string, UrgentesEnPeriodo> = {};
      for (const p of urgentesTodos) {
        if (!p.periodo) continue;
        const agg = porPeriodo[p.periodo] ?? { cantidad: 0, monto: 0, sinMonto: 0 };
        const monto = Number(p.monto ?? 0);
        if (monto > 0) {
          agg.cantidad += 1;
          agg.monto += monto;
        } else {
          agg.sinMonto += 1;
        }
        porPeriodo[p.periodo] = agg;
      }

      return {
        vencidos: vencidos.length,
        hoy: hoy.length,
        semana: semana.length,
        // Solo pagos con importe (ver arriba). Los sin monto: urgentesSinImporte.
        urgentesTotal: urgentes.length,
        urgentesSinImporte: urgentesTodos.length - urgentes.length,
        montoVencido: vencidos.reduce((s, p) => s + (p.monto ?? 0), 0),
        montoUrgente: urgentes.reduce((s, p) => s + (p.monto ?? 0), 0),
        porPeriodo,
      };
    },
    staleTime: 1000 * 60 * 5, // refresca cada 5 min
  });
}
