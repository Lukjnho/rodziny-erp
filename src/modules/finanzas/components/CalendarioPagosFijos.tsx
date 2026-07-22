import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { CalendarioPagos, type ItemCalendario, type LocalKey } from '@/components/CalendarioPagos';

// Calendario de pagos fijos: mismo diseño que el de cuenta corriente en Compras,
// pero alimentado SOLO con la deuda de Finanzas > Pagos Fijos (impuestos, servicios,
// cargas sociales, etc.). Reemplaza los viejos banners de urgencia (vencido / hoy /
// semana), que solo miraban el mes actual.
//
// NO incluye echeqs de proveedor / capex (Pastorino, Mediterranea, etc.): esa es
// deuda de cuenta corriente / inversiones, vive en el calendario de Compras. Meterla
// acá la duplicaba entre los dos calendarios y rompía la separación "2 espejo".
//
// Dos datasets a partir de la misma query:
//  - `items` (vencido + mes en curso): alimenta el TOTAL, atrasados y los 7 días.
//    Acotado para que el "Total pendiente" sea la deuda real de ahora y no sume la
//    proyección de los meses futuros ya pre-cargados (daría ~$196M en vez de ~$25M).
//  - `itemsMesCompleto` (todos los meses): alimenta el modal "Ver mes completo", para
//    poder navegar y ver los pagos fijos de agosto, septiembre, etc. sin que sumen al
//    total. Los meses futuros son proyección; se planifican acá pero no son deuda hoy.

interface PagoFijoCal {
  id: string;
  periodo: string;
  local: string | null;
  concepto: string;
  monto: number | null;
  fecha_vencimiento: string | null;
}

// Payload que viaja con cada ítem para que, al clickear un grupo del detalle,
// podamos saltar al mes donde vive ese pago.
interface PagoFijoPayload {
  periodo: string;
}

export function CalendarioPagosFijos({
  onIrAPeriodo,
}: {
  // Salta al mes del pago clickeado (cambia el selector de período del tab).
  onIrAPeriodo?: (periodo: string) => void;
}) {
  // YYYY-MM del mes en curso: tope del dataset que alimenta el total (los pagos fijos
  // se agrupan por período). Todo lo de períodos <= este cuenta como "deuda de ahora"
  // (incluye lo atrasado, que vive en meses anteriores); los siguientes son proyección.
  const periodoActual = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const { data: pagosFijos, isLoading } = useQuery({
    queryKey: ['pagos_fijos_calendario'],
    queryFn: async () => {
      // Todos los pagos fijos pendientes, de todos los meses. El recorte "vencido +
      // mes en curso" para el total se hace en el cliente (así el modal de mes completo
      // puede usar el dataset entero sin una segunda query).
      const { data, error } = await supabase
        .from('pagos_fijos')
        .select('id, periodo, local, concepto, monto, fecha_vencimiento')
        .eq('pagado', false)
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
        .limit(3000);
      if (error) throw error;
      return (data ?? []) as PagoFijoCal[];
    },
    staleTime: 60_000,
  });

  // Universo completo (todos los meses) → modal "Ver mes completo".
  const itemsMesCompleto = useMemo<ItemCalendario<PagoFijoPayload>[]>(() => {
    const out: ItemCalendario<PagoFijoPayload>[] = [];
    for (const p of pagosFijos ?? []) {
      const monto = Number(p.monto ?? 0);
      if (monto <= 0) continue; // sin monto no es deuda cuantificable
      out.push({
        id: `pf:${p.id}`,
        local: (p.local as LocalKey) ?? 'sas',
        fecha_vencimiento: p.fecha_vencimiento,
        monto,
        grupoKey: p.concepto.toLowerCase(),
        grupoLabel: p.concepto,
        payload: { periodo: p.periodo },
      });
    }
    return out;
  }, [pagosFijos]);

  // Acotado a "vencido + mes en curso" → total, atrasados y grilla de 7 días.
  const items = useMemo<ItemCalendario<PagoFijoPayload>[]>(
    () => itemsMesCompleto.filter((i) => (i.payload?.periodo ?? '') <= periodoActual),
    [itemsMesCompleto, periodoActual],
  );

  return (
    <CalendarioPagos
      items={items}
      itemsMesCompleto={itemsMesCompleto}
      isLoading={isLoading}
      titulo="🗓 Calendario de pagos fijos"
      subtitulo="Lo vencido + lo que vence este mes (impuestos, servicios, cargas sociales). 'Ver mes completo' muestra también los meses siguientes (proyección)."
      totalLabel="Total pendiente (vencido + este mes)"
      ctaAyuda="ir al mes →"
      onSelectGrupo={(g) => {
        const periodo = g.items[0]?.payload?.periodo;
        if (periodo) onIrAPeriodo?.(periodo);
      }}
    />
  );
}
