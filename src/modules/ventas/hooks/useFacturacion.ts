import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';

// Configuración fiscal de ARCA por local, y qué medios de pago disparan
// factura sin que nadie la pida. Ver migración 154.

export type Ambiente = 'homologacion' | 'produccion';
export type ModoFacturacion = 'segun_medio' | 'todo' | 'ninguno';

export interface ArcaConfig {
  local: string;
  cuit_emisor: string;
  punto_venta: number;
  ambiente: Ambiente;
  razon_social: string;
  domicilio_comercial: string | null;
  ingresos_brutos: string | null;
  inicio_actividades: string | null;
  activo: boolean;
  modo_facturacion: ModoFacturacion;
}

export interface MedioFacturable {
  id: string;
  codigo: string;
  nombre: string;
  es_efectivo: boolean;
  factura_automatica: boolean;
  cuenta_default_venta: string | null;
}

export function useArcaConfig() {
  return useQuery({
    queryKey: ['arca-config'],
    queryFn: async (): Promise<ArcaConfig[]> => {
      const { data, error } = await supabase
        .from('arca_config')
        .select(
          'local, cuit_emisor, punto_venta, ambiente, razon_social, domicilio_comercial, ingresos_brutos, inicio_actividades, activo, modo_facturacion',
        )
        .order('local');
      if (error) throw error;
      return (data ?? []) as ArcaConfig[];
    },
  });
}

export function useMediosFacturables() {
  return useQuery({
    queryKey: ['medios-facturables'],
    queryFn: async (): Promise<MedioFacturable[]> => {
      const { data, error } = await supabase
        .from('medios_pago')
        .select('id, codigo, nombre, es_efectivo, factura_automatica, cuenta_default_venta')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as MedioFacturable[];
    },
  });
}

export function useGuardarArcaConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ local, cambios }: { local: string; cambios: Partial<ArcaConfig> }) => {
      const { data, error } = await supabase
        .from('arca_config')
        .update({ ...cambios, actualizado_at: new Date().toISOString() })
        .eq('local', local)
        .select('local');
      if (error) throw new Error(mensajeErrorAmigable(error, 'No se pudo guardar la configuración'));
      // Un UPDATE que los permisos bloquean no falla: devuelve cero filas.
      // Sin este chequeo la pantalla diría "guardado" sin haber guardado nada.
      if (!data || data.length === 0) {
        throw new Error(
          'No se guardó nada. Hace falta ser administrador para cambiar la configuración de facturación.',
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['arca-config'] });
    },
  });
}

export function useCambiarFacturaAutomatica() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: boolean }) => {
      const { data, error } = await supabase
        .from('medios_pago')
        .update({ factura_automatica: valor })
        .eq('id', id)
        .select('id');
      if (error) throw new Error(mensajeErrorAmigable(error, 'No se pudo cambiar el medio de pago'));
      if (!data || data.length === 0) {
        throw new Error(
          'No se guardó nada. Hace falta ser administrador para cambiar qué medios facturan solos.',
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['medios-facturables'] });
    },
  });
}
