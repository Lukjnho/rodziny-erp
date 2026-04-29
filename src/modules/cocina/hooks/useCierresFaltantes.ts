import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as supabaseAuth } from '@/lib/supabase';

type Local = 'vedia' | 'saavedra';

interface CierreFalta {
  tipo: 'pasta' | 'salsa' | 'postre';
  turno: 'mediodia' | 'noche' | null;
  fecha: string;
  label: string;
}

function hoyAR(): string {
  const offsetMs = 3 * 60 * 60 * 1000;
  return new Date(new Date().getTime() - offsetMs).toISOString().slice(0, 10);
}

function ayerAR(fecha: string): string {
  const d = new Date(fecha + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function horaAR(): number {
  const offsetMs = 3 * 60 * 60 * 1000;
  return new Date(new Date().getTime() - offsetMs).getUTCHours();
}

// Devuelve la lista de cierres que tendrían que estar y faltan, según la hora del día.
// Reglas (Vedia):
//   - Pastas mediodía: requerido a partir de las 16hs.
//   - Pastas noche: requerido a partir de las 23hs.
//   - Salsas (fin de día): requerido a partir de las 23hs.
//   - Postres (fin de día): requerido a partir de las 23hs.
//   - El día anterior siempre se controla: si quedó algún cierre sin cargar, aparece como "atrasado".
// Saavedra: por ahora no genera alertas (el flujo todavía no está habilitado).
export function useCierresFaltantes(local: Local, client?: SupabaseClient) {
  const fecha = hoyAR();
  const fechaAyer = ayerAR(fecha);
  const hora = horaAR();
  const sb = client ?? supabaseAuth;

  const { data, isLoading } = useQuery({
    queryKey: ['cocina-cierre-faltantes', local, fecha],
    enabled: local === 'vedia',
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb
        .from('cocina_cierre_dia')
        .select('fecha, tipo, turno')
        .eq('local', local)
        .in('fecha', [fecha, fechaAyer]);
      if (error) throw error;
      return (data ?? []) as Array<{
        fecha: string;
        tipo: 'pasta' | 'salsa' | 'postre';
        turno: 'mediodia' | 'noche' | null;
      }>;
    },
  });

  if (local !== 'vedia') {
    return { faltantes: [] as CierreFalta[], isLoading: false };
  }

  const cierres = data ?? [];
  const tiene = (
    f: string,
    tipo: 'pasta' | 'salsa' | 'postre',
    turno: 'mediodia' | 'noche' | null,
  ) =>
    cierres.some(
      (c) =>
        c.fecha === f &&
        c.tipo === tipo &&
        ((turno === null && c.turno === null) || c.turno === turno),
    );

  const faltantes: CierreFalta[] = [];

  // Día anterior: todos los cierres son obligatorios
  if (!tiene(fechaAyer, 'pasta', 'mediodia'))
    faltantes.push({ tipo: 'pasta', turno: 'mediodia', fecha: fechaAyer, label: 'Pastas · mediodía (ayer)' });
  if (!tiene(fechaAyer, 'pasta', 'noche'))
    faltantes.push({ tipo: 'pasta', turno: 'noche', fecha: fechaAyer, label: 'Pastas · noche (ayer)' });
  if (!tiene(fechaAyer, 'salsa', null))
    faltantes.push({ tipo: 'salsa', turno: null, fecha: fechaAyer, label: 'Salsas (ayer)' });
  if (!tiene(fechaAyer, 'postre', null))
    faltantes.push({ tipo: 'postre', turno: null, fecha: fechaAyer, label: 'Postres (ayer)' });

  // Día actual: según hora
  if (hora >= 16 && !tiene(fecha, 'pasta', 'mediodia'))
    faltantes.push({ tipo: 'pasta', turno: 'mediodia', fecha, label: 'Pastas · mediodía (hoy)' });
  if (hora >= 23 && !tiene(fecha, 'pasta', 'noche'))
    faltantes.push({ tipo: 'pasta', turno: 'noche', fecha, label: 'Pastas · noche (hoy)' });
  if (hora >= 23 && !tiene(fecha, 'salsa', null))
    faltantes.push({ tipo: 'salsa', turno: null, fecha, label: 'Salsas (hoy)' });
  if (hora >= 23 && !tiene(fecha, 'postre', null))
    faltantes.push({ tipo: 'postre', turno: null, fecha, label: 'Postres (hoy)' });

  return { faltantes, isLoading };
}
