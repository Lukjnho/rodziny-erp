// Regla única de qué gastos son "deuda comercial con proveedores" y por eso
// entran al tab Pagos (cuenta corriente) y su calendario. Se comparte entre
// ComprasPage (lista) y CalendarioPagosCtaCte para no divergir.
//
// Categorías EXCLUIDAS (no son deuda comercial con proveedores):
//  - Inversiones        → capex/bienes de uso; van por amortización + plan de cheques.
//  - Gastos de RRHH     → sueldos, adelantos, cargas sociales; se manejan en RRHH
//                         (se pagan por pagos_sueldos, no por cta cte).
//  - Aguinaldo          → aguinaldos de empleados.
//  - Impuestos y Tasas  → IIBB, Ganancias, ATP, comisiones/impuestos bancarios.
//  - Intereses          → intereses bancarios.
// Decidido con Lucas (jul 2026): la cta cte muestra SOLO deuda comercial, así el
// total refleja lo que realmente se le debe a proveedores.
//
// Ojo: gastos de proveedores reales mal categorizados como RRHH (ej. uniformes de
// Costa Oeste) quedan fuera del cta cte; siguen visibles/pagables en el tab Gastos.
// Si se quiere que aparezcan acá, recategorizarlos a un rubro comercial.
export const CATEGORIAS_NO_CTA_CTE: ReadonlySet<string> = new Set([
  'Inversiones',
  'Gastos de RRHH',
  'Aguinaldo',
  'Impuestos y Tasas',
  'Intereses',
]);

// true si la categoría del gasto corresponde a deuda comercial con proveedores.
export function esCategoriaCtaCte(categoria: string | null | undefined): boolean {
  return !CATEGORIAS_NO_CTA_CTE.has((categoria ?? '').trim());
}
