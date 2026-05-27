// Costeo de bebidas reventa (cocina_productos con insumo_reventa_id).
//
// Una "bebida reventa" es un producto del menú que se vende sin transformar
// (Pepsi, Copa Malbec). Su costo depende de si se vende:
//  - como UNIDAD entera (lata Pepsi, botella Malbec) → `ml_por_venta = NULL` →
//    costo = costo_unitario del insumo.
//  - como FORMATO copa/shot (Copa Malbec 200 ml) → `ml_por_venta > 0` →
//    costo prorrateado = costo_unitario * ml_por_venta / contenido_ml.
//
// Centralizado acá para que FichaProductoTab, MenuTab y useCostoCompleto
// apliquen la MISMA regla. Si esto se duplicara, una vista mostraría costo
// proporcional y otra el costo entero de la botella (bug previo real).

export interface InsumoReventa {
  costo_unitario: number | null;
  contenido_ml: number | null;
}

export interface BebidaReventaConfig {
  ml_por_venta: number | null;
}

export function calcularCostoBebidaReventa(
  bebida: BebidaReventaConfig,
  insumo: InsumoReventa | null | undefined,
): number | null {
  if (!insumo || insumo.costo_unitario == null) return null;
  const costoUnit = Number(insumo.costo_unitario);
  if (!isFinite(costoUnit) || costoUnit <= 0) return null;

  const mlVenta = bebida.ml_por_venta != null ? Number(bebida.ml_por_venta) : null;
  if (mlVenta != null && mlVenta > 0) {
    const contenido = insumo.contenido_ml != null ? Number(insumo.contenido_ml) : null;
    if (!contenido || contenido <= 0) return null;
    return (costoUnit / contenido) * mlVenta;
  }
  return costoUnit;
}
