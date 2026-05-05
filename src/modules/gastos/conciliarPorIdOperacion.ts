import { supabase } from '@/lib/supabase';
import {
  matchearPorIdOperacion,
  type MovimientoParaMatchId,
  type PagoParaMatchId,
} from './matchearPorIdOperacion';

export interface ResultadoConciliacion {
  vinculados: number;
  errores: string[];
}

// Conciliacion por igualdad EXACTA de N° de operacion. Se usa despues de
// importar extracto (CSV) o despues de sincronizar egresos MP via API.
// Sin scoring, sin tolerancia: si el N° del pago aparece como substring en
// la referencia/descripcion del movimiento, se vincula.
export async function conciliarPorIdOperacion(): Promise<ResultadoConciliacion> {
  const errores: string[] = [];
  try {
    // Movs candidatos: sin clasificar, egresos
    const movs: MovimientoParaMatchId[] = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('movimientos_bancarios')
        .select('id, cuenta, fecha, descripcion, debito, credito, referencia, tipo, gasto_id')
        .is('tipo', null)
        .is('gasto_id', null)
        .gt('debito', 0)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      movs.push(...(data as MovimientoParaMatchId[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
    if (movs.length === 0) return { vinculados: 0, errores: [] };

    // Pagos candidatos: con N° operacion, sin conciliar
    const { data: pagosRaw, error: ePagos } = await supabase
      .from('pagos_gastos')
      .select(
        'id, gasto_id, fecha_pago, monto, numero_operacion, conciliado_movimiento_id, gasto:gastos(proveedor)',
      )
      .is('conciliado_movimiento_id', null)
      .not('numero_operacion', 'is', null);
    if (ePagos) throw ePagos;

    type RawPago = {
      id: string;
      gasto_id: string;
      fecha_pago: string;
      monto: number;
      numero_operacion: string;
      conciliado_movimiento_id: string | null;
      gasto: { proveedor: string | null } | { proveedor: string | null }[] | null;
    };
    const pagos: PagoParaMatchId[] = ((pagosRaw ?? []) as unknown as RawPago[]).map((p) => {
      const gasto = Array.isArray(p.gasto) ? p.gasto[0] : p.gasto;
      return {
        id: p.id,
        gasto_id: p.gasto_id,
        fecha_pago: p.fecha_pago,
        monto: Number(p.monto),
        numero_operacion: p.numero_operacion,
        conciliado_movimiento_id: p.conciliado_movimiento_id,
        gasto_proveedor: gasto?.proveedor ?? null,
      };
    });

    const matches = matchearPorIdOperacion(movs, pagos);
    if (matches.length === 0) return { vinculados: 0, errores: [] };

    let vinculados = 0;
    for (const m of matches) {
      try {
        const { error: e1 } = await supabase
          .from('movimientos_bancarios')
          .update({ tipo: 'pago_de_gasto', gasto_id: m.gastoId })
          .eq('id', m.movId);
        if (e1) throw e1;
        const { error: e2 } = await supabase
          .from('pagos_gastos')
          .update({ conciliado_movimiento_id: m.movId })
          .eq('id', m.pagoId);
        if (e2) throw e2;
        vinculados++;
      } catch (e) {
        errores.push(
          `${m.gastoProveedor ?? '—'} (N° ${m.numeroOperacion}): ${(e as Error).message}`,
        );
      }
    }
    return { vinculados, errores };
  } catch (e) {
    return { vinculados: 0, errores: [(e as Error).message] };
  }
}
