import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as supabaseAuth } from '@/lib/supabase';

type Local = 'vedia' | 'saavedra';
type TipoCierre = 'pasta' | 'salsa' | 'postre' | 'panaderia';
type TurnoCierre = 'mediodia' | 'noche' | null;

interface CierreFalta {
  tipo: TipoCierre;
  turno: TurnoCierre;
  fecha: string;
  label: string;
}

interface Requisito {
  tipo: TipoCierre;
  turno: TurnoCierre;
  horaMin: number; // hora del día (AR) a partir de la cual el cierre de HOY es obligatorio
  label: string;
  // Si es true, este cierre NO se exige los domingos (ese día se cuenta una sola
  // vez, a la noche). Aplica al turno mediodía de pastas.
  omitirDomingo?: boolean;
}

// Cierres obligatorios por local. El día anterior se exige siempre (sin importar
// la hora); el día actual solo a partir de `horaMin`.
//   - Vedia: Pastas mediodía (16h) / noche (23h) · Salsas (23h) · Postres (23h).
//   - Saavedra: Salsas (23h) · Postres (23h) · Panadería (23h). NO exige cierre de
//     pasta: usa el flujo cámara (espejo de Vedia, sin mostrador) y el recuento de
//     pasta se hace por conteo de cámara en el StockTab, no por cierre de turno.
//   - Los domingos no se exige el cierre de pastas de mediodía (se cuenta solo a la noche).
const REQUISITOS: Record<Local, Requisito[]> = {
  vedia: [
    { tipo: 'pasta', turno: 'mediodia', horaMin: 16, label: 'Pastas · mediodía', omitirDomingo: true },
    { tipo: 'pasta', turno: 'noche', horaMin: 23, label: 'Pastas · noche' },
    { tipo: 'salsa', turno: null, horaMin: 23, label: 'Salsas' },
    { tipo: 'postre', turno: null, horaMin: 23, label: 'Postres' },
  ],
  saavedra: [
    { tipo: 'salsa', turno: null, horaMin: 23, label: 'Salsas' },
    { tipo: 'postre', turno: null, horaMin: 23, label: 'Postres' },
    { tipo: 'panaderia', turno: null, horaMin: 23, label: 'Panadería' },
  ],
};

// Día de la semana (0 = domingo … 6 = sábado) para una fecha operativa 'YYYY-MM-DD'.
// Se parsea al mediodía UTC para evitar corrimientos de zona horaria.
function esDomingo(fecha: string): boolean {
  return new Date(fecha + 'T12:00:00Z').getUTCDay() === 0;
}

// Corte de la jornada operativa (hora AR). El turno noche cierra hasta la ~01hs:
// para que esos cierres se imputen al día que corresponde (y no al siguiente),
// todo lo cargado entre las 00:00 y las 04:59 AR cuenta como el día anterior.
// Debe coincidir con CORTE_JORNADA_H en MostradorPage.tsx.
const CORTE_JORNADA_H = 5;

function hoyAR(): string {
  const offsetMs = (3 + CORTE_JORNADA_H) * 60 * 60 * 1000;
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
export function useCierresFaltantes(local: Local, client?: SupabaseClient) {
  const fecha = hoyAR();
  const fechaAyer = ayerAR(fecha);
  const hora = horaAR();
  // En la madrugada (00:00–04:59 AR) la jornada operativa de `fecha` ya terminó
  // por completo (es el día anterior), así que todos sus requisitos cuentan como
  // vencidos. Fuera de esa franja vale la hora real de pared.
  const horaEfectiva = hora < CORTE_JORNADA_H ? 24 : hora;
  const sb = client ?? supabaseAuth;

  const { data, isLoading } = useQuery({
    queryKey: ['cocina-cierre-faltantes', local, fecha],
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
        tipo: TipoCierre;
        turno: TurnoCierre;
      }>;
    },
  });

  const cierres = data ?? [];
  const tiene = (f: string, tipo: TipoCierre, turno: TurnoCierre) =>
    cierres.some(
      (c) =>
        c.fecha === f &&
        c.tipo === tipo &&
        ((turno === null && c.turno === null) || c.turno === turno),
    );

  const requisitos = REQUISITOS[local];
  const faltantes: CierreFalta[] = [];

  // Día anterior: todos los cierres son obligatorios (atrasados)
  for (const r of requisitos) {
    if (r.omitirDomingo && esDomingo(fechaAyer)) continue;
    if (!tiene(fechaAyer, r.tipo, r.turno))
      faltantes.push({ tipo: r.tipo, turno: r.turno, fecha: fechaAyer, label: `${r.label} (ayer)` });
  }

  // Día actual: obligatorio a partir de su horaMin
  for (const r of requisitos) {
    if (r.omitirDomingo && esDomingo(fecha)) continue;
    if (horaEfectiva >= r.horaMin && !tiene(fecha, r.tipo, r.turno))
      faltantes.push({ tipo: r.tipo, turno: r.turno, fecha, label: `${r.label} (hoy)` });
  }

  return { faltantes, isLoading };
}
