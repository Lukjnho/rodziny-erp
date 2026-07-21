import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useProveedoresMap, nombreProveedor } from '@/modules/gastos/proveedorDisplay';
import { CalendarioPagos, type ItemCalendario, type LocalKey } from '@/components/CalendarioPagos';

// Calendario de pagos fijos: mismo diseño que el de cuenta corriente en Compras,
// pero alimentado con la deuda viva de Finanzas > Pagos Fijos. Cruza TODOS los
// meses (no solo el período en pantalla) para que "atrasado" y "próximos 7 días"
// muestren lo urgente aunque viva en otro mes. Reemplaza los viejos banners de
// urgencia (vencido / hoy / semana), que solo miraban el mes actual.
//
// Dos fuentes, unificadas en el mismo calendario:
//  1. pagos_fijos pendientes (por su fecha de vencimiento).
//  2. echeqs / cheques programados aún no debitados (por su fecha de débito) —
//     así el calendario coincide con la sección "Echeqs y pagos programados".

interface PagoFijoCal {
  id: string;
  periodo: string;
  local: string | null;
  concepto: string;
  monto: number | null;
  fecha_vencimiento: string | null;
}

interface ProgramadoCal {
  id: string;
  fecha_pago: string;
  monto: number;
  gastos: {
    proveedor: string | null;
    proveedor_id: string | null;
    local: string | null;
    comentario: string | null;
  } | null;
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
  const { data: proveedoresMap } = useProveedoresMap();

  // Ventana de meses hacia atrás para no arrastrar filas ancianas, pero amplia
  // para capturar todo lo vencido que siga pendiente.
  const desde = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }, []);

  // Horizonte del calendario: "atrasado + mes en curso". El total tiene que ser la
  // DEUDA REAL de ahora, no la proyección de costos fijos de los próximos meses (que
  // ya están pre-cargados). Sin este tope, sumaba 6 meses futuros y el "pendiente"
  // daba ~$196M en vez de la deuda real (~$20-25M). Los meses siguientes son
  // proyección y viven en el módulo Proyección de Flujo, no acá.
  //  - `periodoActual` (YYYY-MM de hoy): tope para los pagos fijos (se agrupan por período).
  //  - `finMesActual` (último día del mes): tope para los echeqs (se ubican por fecha de débito).
  const { periodoActual, finMesActual } = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-based
    const ultimoDia = new Date(y, m + 1, 0).getDate();
    return {
      periodoActual: `${y}-${String(m + 1).padStart(2, '0')}`,
      finMesActual: `${y}-${String(m + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`,
    };
  }, []);

  const { data: pagosFijos, isLoading: loadingPF } = useQuery({
    queryKey: ['pagos_fijos_calendario', periodoActual],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pagos_fijos')
        .select('id, periodo, local, concepto, monto, fecha_vencimiento')
        .eq('pagado', false)
        // Solo períodos hasta el mes en curso inclusive: capta todo lo atrasado (que
        // vive en meses anteriores) + lo del mes actual, sin arrastrar la proyección
        // de los meses siguientes ya pre-cargados.
        .lte('periodo', periodoActual)
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as PagoFijoCal[];
    },
    staleTime: 60_000,
  });

  const { data: programados, isLoading: loadingProg } = useQuery({
    queryKey: ['pagos_fijos_calendario_programados', desde, finMesActual],
    queryFn: async () => {
      // Solo echeqs aún NO debitados (programado=true) y de gastos vivos. Excluimos
      // los "Pago fijo:" — ese cheque ya está representado por su fila de pago fijo,
      // listarlo de nuevo lo contaría dos veces (mismo criterio que ChecklistPagos).
      // Tope en fin de mes: mismo horizonte "atrasado + mes en curso" que los fijos.
      const { data, error } = await supabase
        .from('pagos_gastos')
        .select('id, fecha_pago, monto, gastos!inner(proveedor, proveedor_id, local, cancelado, comentario)')
        .eq('programado', true)
        .eq('gastos.cancelado', false)
        .gte('fecha_pago', desde)
        .lte('fecha_pago', finMesActual)
        .order('fecha_pago')
        .limit(2000);
      if (error) throw error;
      return (data ?? [])
        .map((r) => {
          const g = Array.isArray(r.gastos) ? (r.gastos[0] ?? null) : r.gastos;
          return { id: r.id, fecha_pago: r.fecha_pago, monto: r.monto, gastos: g } as ProgramadoCal;
        })
        .filter((r) => !(r.gastos?.comentario ?? '').startsWith('Pago fijo:'));
    },
    staleTime: 60_000,
  });

  const items = useMemo<ItemCalendario<PagoFijoPayload>[]>(() => {
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

    for (const pg of programados ?? []) {
      const monto = Number(pg.monto ?? 0);
      if (monto <= 0) continue;
      const nombre = nombreProveedor(pg.gastos ?? {}, proveedoresMap);
      out.push({
        id: `prog:${pg.id}`,
        local: (pg.gastos?.local as LocalKey) ?? 'sas',
        fecha_vencimiento: pg.fecha_pago,
        monto,
        grupoKey: `echeq|${nombre.toLowerCase()}`,
        grupoLabel: nombre,
        payload: { periodo: pg.fecha_pago.slice(0, 7) },
      });
    }

    return out;
  }, [pagosFijos, programados, proveedoresMap]);

  return (
    <CalendarioPagos
      items={items}
      isLoading={loadingPF || loadingProg}
      titulo="🗓 Calendario de pagos fijos"
      subtitulo="Lo vencido + lo que vence este mes (impuestos, servicios, cheques). Los meses siguientes son proyección — se ven en Proyección de Flujo."
      totalLabel="Total pendiente (vencido + este mes)"
      ctaAyuda="ir al mes →"
      onSelectGrupo={(g) => {
        const periodo = g.items[0]?.payload?.periodo;
        if (periodo) onIrAPeriodo?.(periodo);
      }}
    />
  );
}
