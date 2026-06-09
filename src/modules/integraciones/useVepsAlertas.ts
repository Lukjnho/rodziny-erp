import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Alerta de VEPs (volantes de pago AFIP/ARCA) sin pagar y próximos a vencer / vencidos.
// Alimenta el badge del sidebar en el ítem Integraciones.
export function useVepsAlertas() {
  return useQuery({
    queryKey: ['veps_alertas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('veps')
        .select('id, vencimiento')
        .eq('pagado', false)
        .not('vencimiento', 'is', null);
      if (error) throw error;

      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      let vencidos = 0;
      let urgentes = 0; // vencidos + vence dentro de 7 días (incluye hoy)
      for (const v of data ?? []) {
        if (!v.vencimiento) continue;
        const dias = Math.round(
          (new Date(v.vencimiento + 'T00:00:00').getTime() - hoy.getTime()) / 86_400_000,
        );
        if (dias < 0) {
          vencidos++;
          urgentes++;
        } else if (dias <= 7) {
          urgentes++;
        }
      }
      return { vencidos, urgentesTotal: urgentes };
    },
    staleTime: 1000 * 60 * 5,
  });
}
