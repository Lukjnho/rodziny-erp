import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useProveedoresMap, nombreProveedor } from '@/modules/gastos/proveedorDisplay';
import { esCategoriaCtaCte } from '../ctaCteExclusiones';
import { CalendarioPagos, type ItemCalendario, type LocalKey } from '@/components/CalendarioPagos';

// Vista consolidada (ambos locales + SAS) de la deuda de cuenta corriente con
// proveedores: cuánto hay que abonar atrasado y cuánto cae cada uno de los
// próximos 7 días. Es self-contained: hace su propia query de TODOS los locales,
// independiente del selector de la página, porque el objetivo es justamente el
// total "empresa" que antes había que sumar a mano. El layout (grilla, modal de
// mes, detalle) lo pone el componente compartido CalendarioPagos.

interface GastoPend {
  id: string;
  local: string;
  proveedor: string | null;
  proveedor_id: string | null;
  importe_total: number;
  fecha: string;
  fecha_vencimiento: string | null;
  comentario: string | null;
  categoria: string | null;
}

export function CalendarioPagosCtaCte({
  onIrAProveedor,
}: {
  // Al clickear un proveedor del detalle, saltamos a su fila en el listado de
  // abajo (lo resuelve ComprasPage: cambia de local, filtra y hace scroll).
  onIrAProveedor?: (proveedor: string, local: LocalKey) => void;
}) {
  // Mapa proveedor_id → display canónico (mismo que el resto del ERP).
  const { data: proveedoresMap } = useProveedoresMap();

  const { data: gastos, isLoading } = useQuery({
    queryKey: ['cta_cte_calendario_consolidado'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gastos')
        .select(
          'id, local, proveedor, proveedor_id, importe_total, fecha, fecha_vencimiento, comentario, categoria, estado_pago',
        )
        .eq('cancelado', false)
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
        .limit(5000);
      if (error) throw error;
      // Solo deuda viva (no pagada) y comercial. Excluimos:
      //  - "Pago fijo:" → tienen su propio flujo en Finanzas > Pagos Fijos.
      //  - categorías no-comerciales (Inversiones, RRHH, Aguinaldo, Impuestos,
      //    Intereses) → no son deuda con proveedores e inflaban el total. Ver
      //    ctaCteExclusiones (misma regla que la lista del tab Pagos).
      return ((data ?? []) as (GastoPend & { estado_pago?: string })[])
        .filter((g) => (g.estado_pago ?? '').toLowerCase() !== 'pagado')
        .filter((g) => !(g.comentario ?? '').startsWith('Pago fijo:'))
        .filter((g) => esCategoriaCtaCte(g.categoria));
    },
    staleTime: 60_000,
  });

  // Pagos ya EJECUTADOS (no programados) por gasto. Un gasto "Parcial" —o con un
  // plan de echeqs a medio ejecutar— sigue vivo pero solo por su SALDO, no por el
  // importe completo. Sin esto la deuda queda inflada por lo ya abonado.
  const { data: pagadoRealMap } = useQuery({
    queryKey: ['cta_cte_pagos_ejecutados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pagos_gastos')
        .select('gasto_id, monto, descuento, programado')
        .limit(20000);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const p of data ?? []) {
        if ((p as { programado?: boolean }).programado) continue; // echeq a futuro: aún no salió
        const id = p.gasto_id as string;
        m.set(id, (m.get(id) ?? 0) + Number(p.monto ?? 0) + Number(p.descuento ?? 0));
      }
      return m;
    },
    staleTime: 60_000,
  });

  // Gastos con el importe ya neteado al saldo real (importe − pagos ejecutados),
  // mapeados al ítem genérico del calendario. Descartamos los que quedan en cero
  // (pagados de hecho aunque el estado esté viejo). El nombre canónico del maestro
  // agrupa "FRESH" + "FRESH Dist." en un solo grupo del detalle.
  const items = useMemo<ItemCalendario[]>(
    () =>
      (gastos ?? [])
        .map((g) => {
          const saldo = Number(g.importe_total) - (pagadoRealMap?.get(g.id) ?? 0);
          const nombre = nombreProveedor(g, proveedoresMap);
          return {
            id: g.id,
            local: (g.local as LocalKey) ?? 'sas',
            fecha_vencimiento: g.fecha_vencimiento,
            monto: saldo,
            grupoKey: nombre.toLowerCase(),
            grupoLabel: nombre,
          } satisfies ItemCalendario;
        })
        .filter((i) => i.monto > 0.01),
    [gastos, pagadoRealMap, proveedoresMap],
  );

  return (
    <CalendarioPagos
      items={items}
      isLoading={isLoading}
      titulo="🗓 Calendario de pagos — Cuenta corriente (Empresa)"
      subtitulo="Total empresa, sumando Vedia + Saavedra + Empresa. Toda la deuda viva con proveedores."
      ctaAyuda="ver en lista ↓"
      onSelectGrupo={(g) => onIrAProveedor?.(g.label, g.local)}
    />
  );
}
