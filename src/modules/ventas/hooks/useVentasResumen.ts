import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type LocalVentas = 'vedia' | 'saavedra' | 'consolidado';

interface TicketRow {
  local: string;
  fecha: string;
  hora: string | null;
  total_bruto: number | null;
  medio_pago: string | null;
}

export interface AgregadoMedio {
  medio: string;
  venta: number;
  tickets: number;
}

export interface ResumenVentas {
  periodo: string;
  ventaTotal: number;
  tickets: number;
  ticketPromedio: number;
  diasConVenta: number;
  ventaDiaria: number;
  // desglose por local (sólo relevante en consolidado, pero siempre poblado)
  porLocal: Record<'vedia' | 'saavedra', { venta: number; tickets: number }>;
  porMedio: AgregadoMedio[];
  porHora: { hora: number; venta: number; tickets: number }[];
  porDia: { dia: number; venta: number; tickets: number }[];
  horaPico: { hora: number; tickets: number } | null;
  diaPico: { dia: number; tickets: number } | null;
}

/**
 * Normaliza el medio de pago: el export de Fudo viene sucio (tildes inconsistentes
 * entre locales, vacíos). Devolvemos una etiqueta canónica para agrupar bien.
 */
export function normalizarMedioPago(raw: string | null): string {
  const v = (raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // saca tildes
  if (!v) return 'Sin especificar';
  if (v.includes('qr')) return 'QR';
  if (v.includes('efectivo')) return 'Efectivo';
  if (v.includes('transferencia')) return 'Transferencia';
  if (v.includes('debito')) return 'Tarjeta débito';
  if (v.includes('credito')) return 'Tarjeta crédito';
  if (v.includes('mixto')) return 'Mixto';
  if (v.includes('mercadopago') || v.includes('point')) return 'MercadoPago';
  return raw!.trim();
}

/** 'YYYY-MM' → mes anterior 'YYYY-MM' */
export function periodoAnterior(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number);
  const d = new Date(y, m - 2, 1); // m-2: m es 1-based, restamos 1 mes
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function traerTickets(local: LocalVentas, periodo: string): Promise<TicketRow[]> {
  const PAGE = 1000;
  const filas: TicketRow[] = [];
  let from = 0;
  // paginado igual que el resto del ERP (Supabase corta en 1000 filas)
  while (true) {
    let q = supabase
      .from('ventas_tickets')
      .select('local, fecha, hora, total_bruto, medio_pago')
      .eq('periodo', periodo)
      .neq('estado', 'Cancelada')
      .neq('estado', 'Eliminada')
      .or('es_dividendo.is.null,es_dividendo.eq.false') // excluye dividendos de Lucas
      .range(from, from + PAGE - 1);
    if (local !== 'consolidado') q = q.eq('local', local);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    filas.push(...(data as TicketRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return filas;
}

function agregar(periodo: string, filas: TicketRow[]): ResumenVentas {
  let ventaTotal = 0;
  const porLocal = {
    vedia: { venta: 0, tickets: 0 },
    saavedra: { venta: 0, tickets: 0 },
  };
  const medios = new Map<string, { venta: number; tickets: number }>();
  const horas = new Map<number, { venta: number; tickets: number }>();
  const dias = new Map<number, { venta: number; tickets: number }>();
  const fechas = new Set<string>();

  for (const f of filas) {
    const monto = Number(f.total_bruto) || 0;
    ventaTotal += monto;
    fechas.add(f.fecha);

    if (f.local === 'vedia' || f.local === 'saavedra') {
      porLocal[f.local].venta += monto;
      porLocal[f.local].tickets += 1;
    }

    const medio = normalizarMedioPago(f.medio_pago);
    const m = medios.get(medio) ?? { venta: 0, tickets: 0 };
    m.venta += monto;
    m.tickets += 1;
    medios.set(medio, m);

    if (f.hora) {
      const h = Number(f.hora.slice(0, 2));
      if (!Number.isNaN(h)) {
        const hh = horas.get(h) ?? { venta: 0, tickets: 0 };
        hh.venta += monto;
        hh.tickets += 1;
        horas.set(h, hh);
      }
    }

    const dow = new Date(f.fecha + 'T12:00:00').getDay();
    const dd = dias.get(dow) ?? { venta: 0, tickets: 0 };
    dd.venta += monto;
    dd.tickets += 1;
    dias.set(dow, dd);
  }

  const tickets = filas.length;
  const porMedio = [...medios.entries()]
    .map(([medio, v]) => ({ medio, ...v }))
    .sort((a, b) => b.venta - a.venta);
  const porHora = [...horas.entries()]
    .map(([hora, v]) => ({ hora, ...v }))
    .sort((a, b) => a.hora - b.hora);
  const porDia = [...dias.entries()]
    .map(([dia, v]) => ({ dia, ...v }))
    .sort((a, b) => a.dia - b.dia);

  const horaPico = porHora.length
    ? porHora.reduce((max, h) => (h.tickets > max.tickets ? h : max))
    : null;
  const diaPico = porDia.length
    ? porDia.reduce((max, d) => (d.tickets > max.tickets ? d : max))
    : null;

  const diasConVenta = fechas.size;
  return {
    periodo,
    ventaTotal,
    tickets,
    ticketPromedio: tickets > 0 ? ventaTotal / tickets : 0,
    diasConVenta,
    ventaDiaria: diasConVenta > 0 ? ventaTotal / diasConVenta : 0,
    porLocal,
    porMedio,
    porHora,
    porDia,
    horaPico: horaPico ? { hora: horaPico.hora, tickets: horaPico.tickets } : null,
    diaPico: diaPico ? { dia: diaPico.dia, tickets: diaPico.tickets } : null,
  };
}

export function useVentasResumen(local: LocalVentas, periodo: string) {
  return useQuery({
    queryKey: ['ventas-resumen', local, periodo],
    queryFn: async () => agregar(periodo, await traerTickets(local, periodo)),
    staleTime: 10 * 60 * 1000,
  });
}
