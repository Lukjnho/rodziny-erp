// Matcher por igualdad EXACTA de N° de operación. Reemplaza al matcher por
// scoring (PR-U1) que generaba falsos positivos. Aquí no hay ambigüedad: o el
// N° del pago coincide con la referencia/descripción del movimiento, o no.
//
// Funcionamiento:
// 1. Para cada `pago_gasto.numero_operacion` no nulo y SIN conciliar,
//    busca un movimiento bancario sin clasificar cuya `referencia` o
//    `descripcion` contenga ese N° como substring.
// 2. Match 1:1: cada N° pagas vs cada mov. Si dos movs distintos contienen
//    el mismo N° (raro), gana el de fecha más cercana al pago.
// 3. Sin scoring, sin tolerancia, sin sugerencias parciales. Es match o no.
//
// Números cortos (echeqs): el N° de echeq que trae el extracto de Galicia es
// de 1-3 dígitos (ej "ECHEQ GALICIA NRO: 130"). Un substring tan corto, solo,
// daría falsos positivos, así que para esos casos exigimos ADEMÁS que coincidan
// monto (al peso) y fecha (ventana acotada). El N° de echeq es único, y el monto
// exacto + la fecha confirman el movimiento sin riesgo de cruce.

// Umbral: N° de menos de esta cantidad de dígitos requiere respaldo monto+fecha.
const LARGO_MIN_SOLO_NUMERO = 4;
// Tolerancia de monto para números cortos: al peso (el débito del echeq es exacto).
const TOL_MONTO = 1;
// Ventana de fecha para números cortos: el débito puede demorar respecto de la
// fecha de pago del cheque, pero el N° único + monto exacto evitan cruces.
const TOL_FECHA_MS = 30 * 86400000;

export interface MovimientoParaMatchId {
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

export interface PagoParaMatchId {
  id: string;
  gasto_id: string;
  fecha_pago: string;
  monto: number;
  numero_operacion: string;
  conciliado_movimiento_id: string | null;
  // Snapshot del gasto asociado para mostrar en el resumen
  gasto_proveedor: string | null;
}

export interface MatchPorId {
  pagoId: string;
  gastoId: string;
  movId: string;
  numeroOperacion: string;
  // Snapshot para UI
  gastoProveedor: string | null;
  pagoMonto: number;
  movFecha: string;
  movCuenta: string;
}

function normalizar(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

export function matchearPorIdOperacion(
  movs: MovimientoParaMatchId[],
  pagos: PagoParaMatchId[],
): MatchPorId[] {
  // Filtrar candidatos válidos
  const movsCandidatos = movs.filter(
    (m) => m.tipo === null && m.gasto_id === null && Number(m.debito) > 0,
  );
  const pagosCandidatos = pagos.filter(
    (p) => p.conciliado_movimiento_id === null && p.numero_operacion?.trim().length > 0,
  );

  if (movsCandidatos.length === 0 || pagosCandidatos.length === 0) return [];

  const matches: MatchPorId[] = [];
  const movsUsados = new Set<string>();

  for (const pago of pagosCandidatos) {
    const idBuscado = normalizar(pago.numero_operacion);
    if (idBuscado.length === 0) continue;
    // Número corto (echeq): el substring solo no alcanza, pedimos monto + fecha.
    const requiereRespaldo = idBuscado.length < LARGO_MIN_SOLO_NUMERO;

    const candidatos = movsCandidatos.filter((m) => {
      if (movsUsados.has(m.id)) return false;
      const ref = normalizar(m.referencia ?? '');
      const desc = normalizar(m.descripcion ?? '');
      if (!(ref.includes(idBuscado) || desc.includes(idBuscado))) return false;
      if (requiereRespaldo) {
        // El débito del extracto debe coincidir con el monto del pago (al peso)…
        if (Math.abs(Number(m.debito) - pago.monto) > TOL_MONTO) return false;
        // …y la fecha del movimiento debe caer dentro de la ventana del pago.
        const distFecha = Math.abs(
          new Date(m.fecha + 'T12:00:00Z').getTime() -
            new Date(pago.fecha_pago + 'T12:00:00Z').getTime(),
        );
        if (distFecha > TOL_FECHA_MS) return false;
      }
      return true;
    });

    if (candidatos.length === 0) continue;

    // Si hay más de uno (caso raro: el N° aparece en varios), elegir el más
    // cercano en fecha al pago.
    const elegido =
      candidatos.length === 1
        ? candidatos[0]
        : candidatos
            .map((m) => ({
              m,
              dist: Math.abs(
                new Date(m.fecha + 'T12:00:00Z').getTime() -
                  new Date(pago.fecha_pago + 'T12:00:00Z').getTime(),
              ),
            }))
            .sort((a, b) => a.dist - b.dist)[0].m;

    matches.push({
      pagoId: pago.id,
      gastoId: pago.gasto_id,
      movId: elegido.id,
      numeroOperacion: pago.numero_operacion,
      gastoProveedor: pago.gasto_proveedor,
      pagoMonto: pago.monto,
      movFecha: elegido.fecha,
      movCuenta: elegido.cuenta,
    });
    movsUsados.add(elegido.id);
  }

  return matches;
}
