import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Detección de cargas duplicadas. Nació de la extrusora de Saavedra: la misma
// factura entró 3 veces (dos personas + Lucas) porque nadie vio que ya estaba.
//
// Dos niveles, siempre AVISO — nunca bloquean la carga:
//  - 'comprobante' → mismo proveedor + mismo N° + mismo importe. Duplicado casi seguro.
//  - 'monto'       → mismo proveedor + mismo importe dentro de la ventana de días.
//                    Atrapa al que recarga sin poner el comprobante (caso extrusora).
//
// Umbrales calibrados contra la base (ene–jul 2026), no elegidos a ojo:
//  · El N° de comprobante SOLO no sirve: una factura partida en varios gastos (por
//    subcategoría o por local) repite el número a propósito — 138 grupos legítimos.
//    Sumando el importe, los pares bajan a 5 en seis meses: casi cero falso positivo.
//  · La ventana de días del amarillo: 3 días → 42 pares; 7 días → 125 (ahí entran las
//    compras semanales recurrentes del mismo importe y el aviso se vuelve ruido).

export type MotivoDuplicado = 'comprobante' | 'monto';

export interface GastoDuplicado {
  id: string;
  fecha: string;
  proveedor: string | null;
  nro_comprobante: string | null;
  importe_total: number;
  local: string | null;
  categoria: string | null;
  motivo: MotivoDuplicado;
}

interface ParamsGasto {
  gastoId?: string | null; // el que se está editando: no es duplicado de sí mismo
  proveedorId?: string | null;
  proveedorTexto?: string | null;
  nroComprobante?: string | null;
  importeTotal?: number | null;
  fecha?: string | null;
  enabled?: boolean;
}

const DIAS_VENTANA = 3;
const TOLERANCIA_PESOS = 1; // los centavos del IVA bailan entre cargas
const SELECT = 'id, fecha, proveedor, nro_comprobante, importe_total, local, categoria';

// Corrimiento de días en UTC puro: evita que el huso de Argentina mueva la fecha un día.
function correrDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function useDuplicadosGasto({
  gastoId,
  proveedorId,
  proveedorTexto,
  nroComprobante,
  importeTotal,
  fecha,
  enabled = true,
}: ParamsGasto) {
  const nro = (nroComprobante ?? '').trim();
  const total = Number(importeTotal) || 0;
  const prov = (proveedorTexto ?? '').trim();

  return useQuery({
    queryKey: ['duplicados_gasto', gastoId, proveedorId, prov, nro, total, fecha],
    // Sin importe no hay nada que comparar: las dos reglas lo exigen.
    enabled: enabled && total > 0 && (!!proveedorId || prov.length >= 3),
    staleTime: 30_000,
    queryFn: async (): Promise<GastoDuplicado[]> => {
      const hallados = new Map<string, GastoDuplicado>();

      // 1) ROJO — mismo proveedor + mismo N° + mismo importe.
      if (nro.length >= 3) {
        let q = supabase
          .from('gastos')
          .select(SELECT)
          .eq('cancelado', false)
          .eq('nro_comprobante', nro)
          .gte('importe_total', total - TOLERANCIA_PESOS)
          .lte('importe_total', total + TOLERANCIA_PESOS)
          .limit(10);
        q = proveedorId ? q.eq('proveedor_id', proveedorId) : q.ilike('proveedor', `%${prov}%`);
        const { data } = await q;
        for (const g of data ?? []) {
          if (g.id === gastoId) continue;
          hallados.set(g.id, { ...(g as Omit<GastoDuplicado, 'motivo'>), motivo: 'comprobante' });
        }
      }

      // 2) AMARILLO — mismo proveedor + mismo importe, dentro de la ventana.
      if (fecha) {
        let q = supabase
          .from('gastos')
          .select(SELECT)
          .eq('cancelado', false)
          .gte('fecha', correrDias(fecha, -DIAS_VENTANA))
          .lte('fecha', correrDias(fecha, DIAS_VENTANA))
          .gte('importe_total', total - TOLERANCIA_PESOS)
          .lte('importe_total', total + TOLERANCIA_PESOS)
          .limit(10);
        q = proveedorId ? q.eq('proveedor_id', proveedorId) : q.ilike('proveedor', `%${prov}%`);
        const { data } = await q;
        for (const g of data ?? []) {
          if (g.id === gastoId || hallados.has(g.id)) continue;
          hallados.set(g.id, { ...(g as Omit<GastoDuplicado, 'motivo'>), motivo: 'monto' });
        }
      }

      return [...hallados.values()];
    },
  });
}

export interface PagoDuplicado {
  id: string;
  gasto_id: string;
  fecha_pago: string | null;
  monto: number;
  medio_pago: string | null;
  numero_operacion: string | null;
  proveedor: string | null;
}

interface ParamsPago {
  numeroOperacion?: string | null;
  gastoId?: string | null; // pagos del mismo gasto no son duplicados entre sí
  pagoId?: string | null; // el que se está editando
  enabled?: boolean;
}

// Ojo: un mismo N° de operación en VARIOS gastos puede ser legítimo — una
// transferencia que paga varias facturas (el modelo de pagos es 1:N). Por eso
// esto avisa y muestra a quién le pegó, pero no impide nada.
export function useDuplicadosPago({
  numeroOperacion,
  gastoId,
  pagoId,
  enabled = true,
}: ParamsPago) {
  const nro = (numeroOperacion ?? '').trim();

  return useQuery({
    queryKey: ['duplicados_pago', nro, gastoId, pagoId],
    enabled: enabled && nro.length >= 3,
    staleTime: 30_000,
    queryFn: async (): Promise<PagoDuplicado[]> => {
      const { data } = await supabase
        .from('pagos_gastos')
        .select(
          'id, gasto_id, fecha_pago, monto, medio_pago, numero_operacion, gastos!inner(proveedor, cancelado)',
        )
        .eq('gastos.cancelado', false)
        .eq('numero_operacion', nro)
        .limit(10);

      return (data ?? [])
        .filter((p) => p.id !== pagoId && p.gasto_id !== gastoId)
        .map((p) => {
          const g = (Array.isArray(p.gastos) ? p.gastos[0] : p.gastos) as {
            proveedor: string | null;
          } | null;
          return {
            id: p.id as string,
            gasto_id: p.gasto_id as string,
            fecha_pago: p.fecha_pago as string | null,
            monto: Number(p.monto ?? 0),
            medio_pago: p.medio_pago as string | null,
            numero_operacion: p.numero_operacion as string | null,
            proveedor: g?.proveedor ?? null,
          };
        });
    },
  });
}
