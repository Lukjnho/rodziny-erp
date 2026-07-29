import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useProveedoresMap, nombreProveedor } from '@/modules/gastos/proveedorDisplay';
import { esCategoriaCtaCte } from '../ctaCteExclusiones';
import { hoyAR } from '@/lib/fechaAR';
import { esPagoEjecutado } from '@/lib/flujoCaja';
import { CalendarioPagos, type ItemCalendario, type LocalKey } from '@/components/CalendarioPagos';

// Vista consolidada (ambos locales + SAS) de la deuda de cuenta corriente con
// proveedores: cuánto hay que abonar atrasado y cuánto cae cada uno de los
// próximos 7 días. Es self-contained: hace su propia query de TODOS los locales,
// independiente del selector de la página, porque el objetivo es justamente el
// total "empresa" que antes había que sumar a mano. El layout (grilla, modal de
// mes, detalle) lo pone el componente compartido CalendarioPagos.
//
// Se alimenta de DOS fuentes que no se pisan:
//  1. Saldo vivo de los gastos de deuda comercial (ver ctaCteExclusiones).
//  2. Cuotas comprometidas (echeqs) de los gastos que la regla EXCLUYE — capex,
//     típicamente. El gasto no es deuda comercial, pero el cheque que vence sí es
//     plata que sale ese día y antes no figuraba en ningún calendario: cta cte lo
//     filtraba por categoría y Pagos Fijos lo delegaba acá. Ver (2) más abajo.

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

// Fila de pagos_gastos con lo mínimo del gasto padre para decidir si su cuota
// entra al calendario y bajo qué proveedor/local se agrupa.
interface PagoComprometido {
  id: string;
  gasto_id: string;
  fecha_pago: string;
  monto: number | null;
  medio_pago: string | null;
  numero_operacion: string | null;
  gastos: {
    local: string | null;
    proveedor: string | null;
    proveedor_id: string | null;
    categoria: string | null;
    comentario: string | null;
  } | null;
}

// Viaja con cada ítem para poder saltar al listado con el nombre limpio: el
// grupoLabel puede llevar sufijo de echeq y no serviría como término de búsqueda.
interface CtaCtePayload {
  proveedor: string;
}

function esCheque(medio: string | null | undefined): boolean {
  return (medio ?? '').startsWith('cheque');
}

// "00000145" → "145": el número corto es como Lucas lo lee en el banco.
function nroChequeCorto(nro: string | null | undefined): string {
  const limpio = (nro ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return limpio || '';
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

  // Pagos ya EJECUTADOS por gasto. Un gasto "Parcial" —o con un plan de echeqs a
  // medio ejecutar— sigue vivo pero solo por su SALDO, no por el importe completo.
  // "Ejecutado" lo decide la FECHA del pago, no el flag `programado` (nadie lo
  // apaga al debitarse). Misma regla que Compras y el Flujo — src/lib/flujoCaja.ts.
  const { data: pagadoRealMap } = useQuery({
    queryKey: ['cta_cte_pagos_ejecutados'],
    queryFn: async () => {
      const hoy = hoyAR();
      const { data, error } = await supabase
        .from('pagos_gastos')
        .select('gasto_id, fecha_pago, monto, descuento, programado')
        .limit(20000);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const p of data ?? []) {
        if (!esPagoEjecutado(p.fecha_pago as string, hoy)) continue; // fecha futura: aún no salió
        const id = p.gasto_id as string;
        m.set(id, (m.get(id) ?? 0) + Number(p.monto ?? 0) + Number(p.descuento ?? 0));
      }
      return m;
    },
    staleTime: 60_000,
  });

  // Pagos COMPROMETIDOS: fecha futura, o sea plata que todavía no salió. Alimenta
  // dos cosas distintas según de qué gasto cuelguen (ver (2) y (3) más abajo).
  // Una cuota con fecha pasada ya se debitó y no interesa acá (esPagoEjecutado).
  const { data: comprometidos } = useQuery({
    queryKey: ['cta_cte_pagos_comprometidos'],
    queryFn: async () => {
      const hoy = hoyAR();
      const { data, error } = await supabase
        .from('pagos_gastos')
        .select(
          'id, gasto_id, fecha_pago, monto, medio_pago, numero_operacion, gastos!inner(local, proveedor, proveedor_id, categoria, comentario, cancelado)',
        )
        .eq('gastos.cancelado', false)
        .gt('fecha_pago', hoy)
        .limit(2000);
      if (error) throw error;
      return ((data ?? []) as unknown as PagoComprometido[]).filter(
        (p) => !(p.gastos?.comentario ?? '').startsWith('Pago fijo:'),
      );
    },
    staleTime: 60_000,
  });

  // (2) Cuotas de gastos que NO son cta cte: echeqs de capex y similares. Solo las
  // de gastos EXCLUIDOS por categoría — las de un gasto comercial ya viajan dentro
  // de su saldo en (1) y contarlas acá lo duplicaría (esas van por (3)).
  const cuotasCapex = useMemo(
    () => (comprometidos ?? []).filter((p) => !esCategoriaCtaCte(p.gastos?.categoria)),
    [comprometidos],
  );

  // (3) Echeqs pendientes de gastos que SÍ son cta cte, por gasto. No suman nada
  // —el saldo ya los contiene— pero cambian la etiqueta: un vencimiento con cheque
  // emitido detrás no es "hay que pagarle", es "el banco lo debita ese día". Sin
  // esto, el echeq 145 de GRUPOSADAS se leía como deuda común y se pagó a las
  // apuradas cuando avisó el banco (jul 2026).
  const chequesPorGasto = useMemo(() => {
    const m = new Map<string, { nro: string; fecha: string; monto: number }[]>();
    for (const p of comprometidos ?? []) {
      if (!esCheque(p.medio_pago)) continue;
      if (!esCategoriaCtaCte(p.gastos?.categoria)) continue; // esos ya son ítems propios en (2)
      const prev = m.get(p.gasto_id) ?? [];
      prev.push({
        nro: nroChequeCorto(p.numero_operacion),
        fecha: p.fecha_pago,
        monto: Number(p.monto ?? 0),
      });
      m.set(p.gasto_id, prev);
    }
    return m;
  }, [comprometidos]);

  // Gastos con el importe ya neteado al saldo real (importe − pagos ejecutados),
  // mapeados al ítem genérico del calendario. Descartamos los que quedan en cero
  // (pagados de hecho aunque el estado esté viejo). El nombre canónico del maestro
  // agrupa "FRESH" + "FRESH Dist." en un solo grupo del detalle.
  const items = useMemo<ItemCalendario<CtaCtePayload>[]>(
    () =>
      (gastos ?? [])
        .flatMap((g) => {
          const saldo = Number(g.importe_total) - (pagadoRealMap?.get(g.id) ?? 0);
          const nombre = nombreProveedor(g, proveedoresMap);
          const local = (g.local as LocalKey) ?? 'sas';
          const base = { local, payload: { proveedor: nombre } };

          // Con echeqs emitidos detrás, el gasto se PARTE: cada cheque cae el día que
          // el banco lo debita y por su monto, no todo junto en el vencimiento de la
          // factura. Así el total del día es la plata que realmente sale (un gasto con
          // 2 cuotas mostraba las dos en la fecha de la primera) y el proveedor deja de
          // figurar atrasado cuando en realidad tiene cheques a futuro. El label lleva
          // el número para cruzarlo con el listado de cheques del Galicia.
          // Partimos solo si los cheques entran en el saldo; si lo exceden hay datos
          // inconsistentes y preferimos no inventar montos.
          const cheques = chequesPorGasto.get(g.id) ?? [];
          const sumaCheques = cheques.reduce((s, c) => s + c.monto, 0);
          if (!cheques.length || sumaCheques > saldo + 0.01) {
            return [
              {
                ...base,
                id: g.id,
                fecha_vencimiento: g.fecha_vencimiento,
                monto: saldo,
                grupoKey: nombre.toLowerCase(),
                grupoLabel: nombre,
              } satisfies ItemCalendario<CtaCtePayload>,
            ];
          }

          const porCheque: ItemCalendario<CtaCtePayload>[] = cheques.map((c) => {
            const label = `${nombre} · echeq${c.nro ? ` ${c.nro}` : ''}`;
            return {
              ...base,
              id: `${g.id}:${c.fecha}:${c.nro}`,
              fecha_vencimiento: c.fecha,
              monto: c.monto,
              grupoKey: label.toLowerCase(),
              grupoLabel: label,
            } satisfies ItemCalendario<CtaCtePayload>;
          });

          // Lo que el plan de cheques no cubre sigue venciendo con la factura.
          const resto = saldo - sumaCheques;
          if (resto > 0.01) {
            porCheque.push({
              ...base,
              id: g.id,
              fecha_vencimiento: g.fecha_vencimiento,
              monto: resto,
              grupoKey: nombre.toLowerCase(),
              grupoLabel: nombre,
            } satisfies ItemCalendario<CtaCtePayload>);
          }
          return porCheque;
        })
        .filter((i) => i.monto > 0.01),
    [gastos, pagadoRealMap, proveedoresMap, chequesPorGasto],
  );

  // Las cuotas van en su propio grupo ("Proveedor · echeq"): no son deuda comercial,
  // así que no se mezclan con el saldo de cta cte del proveedor, y el sufijo avisa
  // que la fila no va a estar en el listado de abajo. Se pasan por
  // `itemsFueraDelTotal` para que se vean en su día pero el KPI de la cabecera siga
  // midiendo solo deuda con proveedores (decidido con Lucas, jul 2026).
  const itemsCuotas = useMemo<ItemCalendario<CtaCtePayload>[]>(
    () =>
      cuotasCapex
        .map((p) => {
          const nombre = nombreProveedor(
            {
              proveedor: p.gastos?.proveedor ?? null,
              proveedor_id: p.gastos?.proveedor_id ?? null,
            },
            proveedoresMap,
          );
          const nro = nroChequeCorto(p.numero_operacion);
          const tipo = esCheque(p.medio_pago)
            ? `echeq${nro ? ` ${nro}` : ''}`
            : 'pago programado';
          const label = `${nombre} · ${tipo}`;
          return {
            id: `pago:${p.id}`,
            local: (p.gastos?.local as LocalKey) ?? 'sas',
            fecha_vencimiento: p.fecha_pago,
            monto: Number(p.monto ?? 0),
            grupoKey: `pago:${label.toLowerCase()}`,
            grupoLabel: label,
            payload: { proveedor: nombre },
          } satisfies ItemCalendario<CtaCtePayload>;
        })
        .filter((i) => i.monto > 0.01),
    [cuotasCapex, proveedoresMap],
  );

  return (
    <CalendarioPagos
      items={items}
      itemsFueraDelTotal={itemsCuotas}
      isLoading={isLoading}
      titulo="🗓 Calendario de pagos — Cuenta corriente (Empresa)"
      subtitulo="Total empresa, sumando Vedia + Saavedra + Empresa. Deuda viva con proveedores; los echeqs de inversiones se ven en su día, aparte del total."
      ctaAyuda="ver en lista ↓"
      // Los grupos de cuota (prefijo "pago:") no tienen fila en el listado de
      // abajo —su gasto está excluido del cta cte—, así que no navegamos. Para el
      // resto vamos con el nombre del payload: el label puede traer sufijo de echeq
      // y no serviría para filtrar la lista.
      onSelectGrupo={(g) => {
        if (g.key.includes('pago:')) return;
        onIrAProveedor?.(g.items[0]?.payload?.proveedor ?? g.label, g.local);
      }}
    />
  );
}
