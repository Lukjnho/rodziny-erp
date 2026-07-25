// Recalcula gastos.estado_pago a partir de los pagos REALES (los que ya salieron).
//
// Se usa cuando un echeq pasa a ejecutado (se confirma el débito o se concilia
// con el extracto): la cuota deja de ser "a futuro" y ahora sí cuenta como plata
// que salió. El gasto puede avanzar de Parcial → Pagado.
//
// "Ejecutado" lo decide la FECHA del pago (fecha_pago <= hoy), no el flag
// `programado` — nadie lo apaga cuando el cheque/tarjeta se debita, así que un
// pago a vencer con fecha ya pasada seguiría sin contar para siempre. Misma
// regla única que el listado de Compras y el Flujo de Caja: src/lib/flujoCaja.ts.
//
// Regla:
//   pagadoReal = Σ(monto + descuento) de los pagos con fecha_pago <= hoy
//   estado = 'Pagado'    si pagadoReal cubre el total
//          | 'Parcial'   si cubre algo pero no todo
//          | 'Pendiente' si no hay nada ejecutado todavía
import { supabase } from '@/lib/supabase';
import { hoyAR } from '@/lib/fechaAR';
import { esPagoEjecutado } from '@/lib/flujoCaja';

export async function recomputarEstadoGasto(gastoId: string): Promise<void> {
  // Total del gasto
  const { data: gasto, error: errG } = await supabase
    .from('gastos')
    .select('importe_total')
    .eq('id', gastoId)
    .single();
  if (errG) throw errG;
  const total = Number(gasto?.importe_total ?? 0);

  // Pagos ejecutados (fecha ya pasada — la plata salió)
  const hoy = hoyAR();
  const { data: pagos, error: errP } = await supabase
    .from('pagos_gastos')
    .select('fecha_pago, monto, descuento, programado')
    .eq('gasto_id', gastoId);
  if (errP) throw errP;

  const pagadoReal = (pagos ?? [])
    .filter((p) => esPagoEjecutado((p as { fecha_pago: string }).fecha_pago, hoy))
    .reduce(
      (s, p) => s + Number(p.monto ?? 0) + Number((p as { descuento?: number | null }).descuento ?? 0),
      0,
    );

  const estado =
    pagadoReal >= total - 0.01 ? 'Pagado' : pagadoReal > 0 ? 'Parcial' : 'Pendiente';

  const { error: errU } = await supabase
    .from('gastos')
    .update({ estado_pago: estado })
    .eq('id', gastoId);
  if (errU) throw errU;
}
