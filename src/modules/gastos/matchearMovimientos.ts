// Matcher proactivo: dada una lista de movimientos recién importados y una lista
// de gastos pendientes (o pagados-sin-conciliar), sugiere pares (mov ↔ gasto/pago)
// con un score de confianza. Asignación 1:1 greedy por score descendente.
//
// Filosofía:
// - Match contra el GASTO si está pendiente sin pagos cargados (caso común: Lucas
//   anotó la factura, espera el débito).
// - Match contra cada PAGO existente si el gasto ya tiene pagos sin conciliar
//   (caso ChecklistPagos: marcaron pagado pero nunca se cruzó con el extracto).
//   Esto permite que financiaciones AFIP con 6 cuotas sin conciliar matcheen
//   cada cuota con su movimiento correspondiente.

import type { MedioPago } from './types';

export interface MovimientoParaMatch {
  id: string;
  cuenta: string;
  fecha: string;
  descripcion: string | null;
  debito: number;
  credito: number;
  referencia: string | null;
  tipo: string | null;
  gasto_id: string | null;
}

export interface PagoSinConciliar {
  id: string;
  monto: number;
  fecha_pago: string;
}

export interface GastoParaMatch {
  id: string;
  fecha: string;
  proveedor: string | null;
  categoria: string | null;
  importe_total: number;
  estado_pago: string | null;
  local: 'vedia' | 'saavedra' | null;
  medio_pago: string | null;
  pagos_sin_conciliar: PagoSinConciliar[];
}

export interface MatchSugerido {
  movId: string;
  gastoId: string;
  // Si hay pago_gasto sin conciliar elegido para reconciliar, este id != null y
  // el confirmar UPDATEea pagos_gastos.conciliado_movimiento_id en lugar de crear
  // un pago nuevo (evita duplicar en flujo de caja).
  pagoExistenteId: string | null;
  score: number; // 0-100
  diffMonto: number;
  diffDias: number;
  recomendado: boolean; // score >= 90 → pre-marcado en UI
  motivo: string;

  // Snapshot de datos para la UI (evita re-fetchear)
  movFecha: string;
  movCuenta: string;
  movDescripcion: string | null;
  movMonto: number;

  gastoFecha: string;
  gastoProveedor: string | null;
  gastoCategoria: string | null;
  gastoMonto: number; // monto del pago si pagoExistenteId, sino importe_total
  gastoEstadoPago: string | null;
}

const CUENTA_A_MEDIO: Record<string, MedioPago> = {
  mercadopago: 'transferencia_mp',
  galicia: 'cheque_galicia',
  icbc: 'tarjeta_icbc',
};

function diffEnDias(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00Z').getTime();
  const db = new Date(b + 'T12:00:00Z').getTime();
  return Math.round(Math.abs(da - db) / 86400000);
}

function montoEgreso(m: MovimientoParaMatch): number {
  return Number(m.debito) > 0 ? Number(m.debito) : 0;
}

interface UnidadGasto {
  gastoId: string;
  pagoExistenteId: string | null;
  fecha: string;
  monto: number;
  medio_pago: string | null;
  proveedor: string | null;
  categoria: string | null;
  estado_pago: string | null;
}

function expandirUnidades(gastos: GastoParaMatch[]): UnidadGasto[] {
  const u: UnidadGasto[] = [];
  for (const g of gastos) {
    if (g.pagos_sin_conciliar.length > 0) {
      // Una unidad por cada pago sin conciliar (caso ChecklistPagos / financiaciones)
      for (const p of g.pagos_sin_conciliar) {
        u.push({
          gastoId: g.id,
          pagoExistenteId: p.id,
          fecha: p.fecha_pago,
          monto: Number(p.monto),
          medio_pago: g.medio_pago,
          proveedor: g.proveedor,
          categoria: g.categoria,
          estado_pago: g.estado_pago,
        });
      }
    } else if (g.estado_pago !== 'Pagado') {
      // Gasto pendiente sin pagos cargados: matchea contra importe_total
      u.push({
        gastoId: g.id,
        pagoExistenteId: null,
        fecha: g.fecha,
        monto: Number(g.importe_total),
        medio_pago: g.medio_pago,
        proveedor: g.proveedor,
        categoria: g.categoria,
        estado_pago: g.estado_pago,
      });
    }
    // Pagado sin pagos_sin_conciliar: ya conciliado, ignorar
  }
  return u;
}

export function matchearMovsConGastos(
  movs: MovimientoParaMatch[],
  gastos: GastoParaMatch[],
): MatchSugerido[] {
  const unidades = expandirUnidades(gastos);
  const candidatos: MatchSugerido[] = [];

  for (const mov of movs) {
    if (mov.tipo !== null || mov.gasto_id !== null) continue; // ya clasificado
    const monto = montoEgreso(mov);
    if (monto <= 0) continue; // PR-U1 alcance: solo egresos

    const cuentaMedio = CUENTA_A_MEDIO[mov.cuenta];

    for (const u of unidades) {
      const dias = diffEnDias(mov.fecha, u.fecha);
      const diffMonto = Math.abs(u.monto - monto);
      const tol2 = monto * 0.02;

      let score = 0;
      let motivo = '';

      if (diffMonto <= 1 && dias <= 1) {
        score = 100;
        motivo = 'Monto exacto · misma fecha';
      } else if (diffMonto <= 1 && dias <= 5) {
        score = 90;
        motivo = `Monto exacto · ${dias} día${dias === 1 ? '' : 's'}`;
      } else if (diffMonto <= tol2 && dias <= 10) {
        score = 60;
        const deltaPct = monto > 0 ? Math.round((diffMonto / monto) * 1000) / 10 : 0;
        motivo = `Monto similar (Δ ${deltaPct}%) · ${dias} días`;
      } else {
        continue;
      }

      // Bonus si la cuenta del mov coincide con medio_pago del gasto
      if (cuentaMedio && u.medio_pago === cuentaMedio) {
        score = Math.min(100, score + 5);
      }

      candidatos.push({
        movId: mov.id,
        gastoId: u.gastoId,
        pagoExistenteId: u.pagoExistenteId,
        score,
        diffMonto,
        diffDias: dias,
        recomendado: score >= 90,
        motivo,
        movFecha: mov.fecha,
        movCuenta: mov.cuenta,
        movDescripcion: mov.descripcion,
        movMonto: monto,
        gastoFecha: u.fecha,
        gastoProveedor: u.proveedor,
        gastoCategoria: u.categoria,
        gastoMonto: u.monto,
        gastoEstadoPago: u.estado_pago,
      });
    }
  }

  // Greedy 1:1 — un mov solo puede matchear con una unidad y viceversa.
  // Las unidades distintas del mismo gasto (caso 6 cuotas AFIP) son
  // independientes porque cada una tiene su pagoExistenteId único.
  candidatos.sort((a, b) => b.score - a.score);
  const movsUsados = new Set<string>();
  const unidadesUsadas = new Set<string>(); // key = `${gastoId}|${pagoExistenteId ?? '_'}`
  const final: MatchSugerido[] = [];
  for (const c of candidatos) {
    const uKey = `${c.gastoId}|${c.pagoExistenteId ?? '_'}`;
    if (movsUsados.has(c.movId) || unidadesUsadas.has(uKey)) continue;
    final.push(c);
    movsUsados.add(c.movId);
    unidadesUsadas.add(uKey);
  }

  return final;
}
